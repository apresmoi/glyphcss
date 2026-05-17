import { useEffect, useRef } from "react";
import type { GlyphcssMetrics, SceneOptionsState } from "../GalleryWorkbench/types";
import type { ParseAnimationClip } from "@layoutit/polycss-core";

// Mirror of the handle shape exposed by glyphcss-runtime on demoEl.glyphcssDemo.
interface DemoHandle {
  setMeshUrl: (url: string) => Promise<void>;
  setTunables: (partial: Record<string, number | string | boolean>) => void;
  setControlState: (partial: {
    autoCenter?: boolean;
    dragEnabled?: boolean;
    wheelEnabled?: boolean;
  }) => void;
  getCameraState: () => { rotX: number; rotY: number; scale: number; target: [number, number, number] };
  getStats: () => { cols: number; rows: number; edges: number; verts: number; triangles: number; bakeMs: number };
  setAnimation: (clipIndex: number) => void;
  setAnimationPaused: (paused: boolean) => void;
  setAnimationTimeScale: (scale: number) => void;
  getAnimationInfo: () => { clips: ParseAnimationClip[]; current: number; time: number; paused: boolean };
  resumeAutoRotate: () => void;
  setProjection: (kind: "perspective" | "orthographic") => void;
  setDragMode: (mode: "orbit" | "pan" | "fpv") => void;
  getDragMode: () => "orbit" | "pan" | "fpv";
  setFpvOptions: (partial: {
    look?: boolean;
    move?: boolean;
    jump?: boolean;
    crouch?: boolean;
    moveSpeed?: number;
    jumpVelocity?: number;
    gravity?: number;
    eyeHeight?: number;
    crouchHeight?: number;
    lookSensitivity?: number;
    invertY?: boolean;
  }) => void;
  setLighting: (partial: {
    azimuth?: number;
    elevation?: number;
    keyIntensity?: number;
    ambientIntensity?: number;
    keyColor?: string;
    ambientColor?: string;
  }) => void;
}

export interface GlyphcssSceneProps {
  meshUrl: string;
  options: SceneOptionsState;
  onBuild: (ms: number) => void;
  onCameraChange?: (cam: { rotX: number; rotY: number; zoom: number; target?: [number, number, number] }) => void;
  onStatsChange: (stats: GlyphcssMetrics) => void;
  onAnimationInfoChange: (info: { clips: Array<{ index: number; name: string; duration: number }> }) => void;
  selectedAnimation: string;
  animationPaused: boolean;
  animationTimeScale: number;
}

const FRAMES = 60;
const POLL_INTERVAL_MS = 500;

export function GlyphcssScene({
  meshUrl,
  options,
  onBuild,
  onCameraChange,
  onStatsChange,
  onAnimationInfoChange,
  selectedAnimation,
  animationPaused,
  animationTimeScale,
}: GlyphcssSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(false);
  const demoIdRef = useRef(`glyphcss-scene-${Math.random().toString(36).slice(2)}`);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevClipCountRef = useRef(0);
  const prevBakeMsRef = useRef(0);
  // Last camera state applied via setTunables — guards against echo: when the
  // sidebar sets a value and the poll reads it back, we must not re-fire onCameraChange.
  const lastAppliedCameraRef = useRef<{ rotX: number; rotY: number; zoom: number; target: [number, number, number] } | null>(null);

  function getHandle(): DemoHandle | null {
    const host = hostRef.current;
    if (!host) return null;
    const demoEl = host.querySelector(".glyphcss-demo") as (HTMLElement & { glyphcssDemo?: DemoHandle }) | null;
    return demoEl?.glyphcssDemo ?? null;
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!host || mountedRef.current) return;
    mountedRef.current = true;

    const defaults = JSON.stringify({
      scale: options.zoom,
      rotX: (options.rotX * Math.PI) / 180,
      rotY: (options.rotY * Math.PI) / 180,
    });

    const demoId = demoIdRef.current;
    host.innerHTML = `
      <div class="glyphcss-demo no-autorotate" id="${demoId}"
        data-geometry="cuboctahedron"
        data-mesh="${meshUrl}"
        data-defaults='${defaults.replace(/'/g, "&apos;")}'
        data-no-controls="1">
        <div class="glyphcss-demo__viewer not-content" data-layout="canvas-only">
          <div class="glyphcss-demo__canvas">
            <div class="glyphcss-demo__scene-host">
              <div class="glyphcss-demo__viewport">
                <pre class="glyphcss-demo__strip"></pre>
              </div>
              <div class="glyphcss-demo__hit-layer"></div>
              <div class="glyphcss-demo__stats"></div>
            </div>
            <div class="glyphcss-demo__loading">Loading…</div>
          </div>
        </div>
      </div>`;

    import("../../glyphcss-runtime").then(({ initAllGlyphcssDemos }) => {
      initAllGlyphcssDemos();

      // Start polling for stats and animation info once the demo initializes.
      // The handle appears asynchronously (after the initial mesh load).
      let attempts = 0;
      const waitForHandle = (): void => {
        const handle = getHandle();
        if (!handle) {
          if (attempts++ < 40) setTimeout(waitForHandle, 200);
          return;
        }
        // Apply all option-driven state once now that the handle exists.
        // The dep-array useEffects below fired once at initial mount with a
        // null handle and won't re-fire because the options haven't changed.
        handle.setProjection(options.perspective === false ? "orthographic" : "perspective");
        if (options.perspective !== false) {
          handle.setTunables({ distance: options.perspective });
        }
        handle.setTunables({
          renderMode: options.renderMode,
          featureEdges: options.featureEdges,
          glyphPalette: options.glyphPalette,
          useColors: options.useColors,
        });
        handle.setDragMode(options.dragMode);
        handle.setFpvOptions({
          look: options.fpvLook,
          move: options.fpvMove,
          jump: options.fpvJump,
          crouch: options.fpvCrouch,
          moveSpeed: options.fpvMoveSpeed,
          jumpVelocity: options.fpvJumpVelocity,
          gravity: options.fpvGravity,
          eyeHeight: options.fpvEyeHeight,
          crouchHeight: options.fpvCrouchHeight,
          lookSensitivity: options.fpvLookSensitivity,
          invertY: options.fpvInvertY,
        });
        handle.setLighting({
          azimuth: options.lightAzimuth,
          elevation: options.lightElevation,
          keyIntensity: options.lightIntensity,
          ambientIntensity: options.ambientIntensity,
          keyColor: options.lightColor,
          ambientColor: options.ambientColor,
        });
        startPolling(handle);
      };
      setTimeout(waitForHandle, 300);
    });

    return () => {
      if (pollIntervalRef.current !== null) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, []);

  function startPolling(handle: DemoHandle): void {
    if (pollIntervalRef.current !== null) return;

    pollIntervalRef.current = setInterval(() => {
      const stats = handle.getStats();
      const animInfo = handle.getAnimationInfo();

      const metrics: GlyphcssMetrics = {
        measuredAt: Date.now(),
        cells: stats.cols * stats.rows,
        edges: stats.edges,
        triangles: stats.triangles,
        vertices: stats.verts,
        frames: FRAMES,
        bakeMs: stats.bakeMs,
      };

      onStatsChange(metrics);

      if (stats.bakeMs !== prevBakeMsRef.current) {
        prevBakeMsRef.current = stats.bakeMs;
        if (stats.bakeMs > 0) onBuild(stats.bakeMs);
      }

      if (animInfo.clips.length !== prevClipCountRef.current) {
        prevClipCountRef.current = animInfo.clips.length;
        onAnimationInfoChange({ clips: animInfo.clips });
      }

      // Sync camera state back to the sidebar. Skipped during FPV: the FPV loop
      // continuously mutates camera.rotX, camera.rotY, and camera.target. If we
      // let those changes propagate through onCameraChange → setSceneOptions →
      // setTunables useEffect → rebuildSceneFromGeometry, the camera is recreated
      // every 500 ms and the FPV state resets. FPV manages its own camera; the
      // sidebar values should be left at the pre-FPV snapshot until exit.
      if (onCameraChange && handle.getDragMode() !== "fpv") {
        const cam = handle.getCameraState();
        const rotXDeg = (cam.rotX * 180) / Math.PI;
        const rotYDeg = (((cam.rotY * 180) / Math.PI) % 360 + 360) % 360;
        const last = lastAppliedCameraRef.current;
        const TOL = 0.01;
        // Only fire if the runtime camera meaningfully diverges from the last value
        // the sidebar sent, preventing the setTunables → getCameraState echo loop.
        if (
          !last ||
          Math.abs(rotXDeg - last.rotX) > TOL ||
          Math.abs(rotYDeg - last.rotY) > TOL ||
          Math.abs(cam.scale - last.zoom) > TOL ||
          Math.abs(cam.target[0] - last.target[0]) > TOL ||
          Math.abs(cam.target[1] - last.target[1]) > TOL ||
          Math.abs(cam.target[2] - last.target[2]) > TOL
        ) {
          lastAppliedCameraRef.current = { rotX: rotXDeg, rotY: rotYDeg, zoom: cam.scale, target: cam.target };
          onCameraChange({ rotX: rotXDeg, rotY: rotYDeg, zoom: cam.scale, target: cam.target });
        }
      }
    }, POLL_INTERVAL_MS);
  }

  // React to meshUrl changes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !mountedRef.current) return;
    const handle = getHandle();
    if (!handle) return;
    void handle.setMeshUrl(meshUrl);
    // Reset clip tracking so the Dock updates on next poll.
    prevClipCountRef.current = -1;
  }, [meshUrl]);

  // React to camera/zoom/rotX/rotY changes.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setTunables({
      scale: options.zoom,
      rotX: (options.rotX * Math.PI) / 180,
      rotY: (options.rotY * Math.PI) / 180,
    });
    // Record what the sidebar applied so the poll does not echo it back.
    const prev = lastAppliedCameraRef.current;
    lastAppliedCameraRef.current = {
      rotX: options.rotX,
      rotY: options.rotY,
      zoom: options.zoom,
      target: prev?.target ?? options.target,
    };
  }, [options.zoom, options.rotX, options.rotY]);

  // React to perspective/orthographic mode.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setProjection(options.perspective === false ? "orthographic" : "perspective");
    if (options.perspective !== false) {
      handle.setTunables({ distance: options.perspective });
    }
  }, [options.perspective]);

  // React to autoCenter.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setControlState({ autoCenter: options.autoCenter });
  }, [options.autoCenter]);

  // React to target changes.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setTunables({
      targetX: options.target[0],
      targetY: options.target[1],
      targetZ: options.target[2],
    });
    const prev = lastAppliedCameraRef.current;
    if (prev) {
      lastAppliedCameraRef.current = { ...prev, target: options.target };
    }
  }, [options.target[0], options.target[1], options.target[2]]);

  // React to lineHeight.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setTunables({ lineHeight: options.lineHeight });
  }, [options.lineHeight]);

  // React to renderMode changes.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setTunables({ renderMode: options.renderMode });
  }, [options.renderMode]);

  // React to featureEdges threshold.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setTunables({ featureEdges: options.featureEdges });
  }, [options.featureEdges]);

  // React to glyphPalette changes.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setTunables({ glyphPalette: options.glyphPalette });
  }, [options.glyphPalette]);

  // React to useColors toggle.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setTunables({ useColors: options.useColors });
  }, [options.useColors]);

  // React to animation clip selection.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    if (selectedAnimation === "") {
      // "None" — no direct API to deselect a clip; restart at clip 0 but pause immediately
      // so the baked-frames path picks up. The runtime handles this via no active clip.
      return;
    }
    const clipIndex = parseInt(selectedAnimation, 10);
    if (Number.isFinite(clipIndex) && clipIndex >= 0) {
      handle.setAnimation(clipIndex);
    }
  }, [selectedAnimation]);

  // React to animationPaused.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setAnimationPaused(animationPaused);
  }, [animationPaused]);

  // React to animationTimeScale.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setAnimationTimeScale(animationTimeScale);
  }, [animationTimeScale]);

  // React to dragMode changes.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setDragMode(options.dragMode);
  }, [options.dragMode]);

  // React to FPV sub-option changes.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setFpvOptions({
      look: options.fpvLook,
      move: options.fpvMove,
      jump: options.fpvJump,
      crouch: options.fpvCrouch,
      moveSpeed: options.fpvMoveSpeed,
      jumpVelocity: options.fpvJumpVelocity,
      gravity: options.fpvGravity,
      eyeHeight: options.fpvEyeHeight,
      crouchHeight: options.fpvCrouchHeight,
      lookSensitivity: options.fpvLookSensitivity,
      invertY: options.fpvInvertY,
    });
  }, [
    options.fpvLook,
    options.fpvMove,
    options.fpvJump,
    options.fpvCrouch,
    options.fpvMoveSpeed,
    options.fpvJumpVelocity,
    options.fpvGravity,
    options.fpvEyeHeight,
    options.fpvCrouchHeight,
    options.fpvLookSensitivity,
    options.fpvInvertY,
  ]);

  // React to Lighting changes (azimuth, elevation, intensities, colors).
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setLighting({
      azimuth: options.lightAzimuth,
      elevation: options.lightElevation,
      keyIntensity: options.lightIntensity,
      ambientIntensity: options.ambientIntensity,
      keyColor: options.lightColor,
      ambientColor: options.ambientColor,
    });
  }, [
    options.lightAzimuth,
    options.lightElevation,
    options.lightIntensity,
    options.ambientIntensity,
    options.lightColor,
    options.ambientColor,
  ]);

  return (
    <div
      ref={hostRef}
      className="dn-vanilla-host"
      style={{ width: "100%", height: "100%" }}
    />
  );
}
