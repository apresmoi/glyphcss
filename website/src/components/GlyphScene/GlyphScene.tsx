import { useEffect, useLayoutEffect, useRef } from "react";
import type { GlyphMetrics, PresetModel, SceneOptionsState } from "../GalleryWorkbench/types";
import type { GlyphControlSceneManifest, GlyphObjectDictionary, GlyphSemanticCellLineage } from "glyphcss";
import type { LoadMeshOptions, ParseAnimationClip, Polygon } from "@glyphcss/core";
import type { GalleryEffectBlend, GalleryEffectParamValue } from "../GalleryWorkbench/types";

export interface GlyphSceneEffectConfig {
  effect: unknown;
  params: Record<string, GalleryEffectParamValue>;
  blend: GalleryEffectBlend;
  paused: boolean;
  timeScale: number;
}

// Mirror of the handle shape exposed by glyph-runtime on demoEl.glyphcssDemo.
interface DemoHandle {
  setMeshUrl: (url: string, mtlUrl?: string, options?: LoadMeshOptions) => Promise<void>;
  setPolygons: (polygons: Polygon[]) => void;
  setAutoRotate: (enabled: boolean) => void;
  setTunables: (partial: Record<string, number | string | boolean>) => void;
  setInteractiveDownscale: (value: number) => void;
  setControlState: (partial: {
    autoCenter?: boolean;
    dragEnabled?: boolean;
    wheelEnabled?: boolean;
  }) => void;
  getCameraState: () => { rotX: number; rotY: number; scale: number; target: [number, number, number] };
  getStats: () => {
    cols: number;
    rows: number;
    glyphs: number;
    textChars: number;
    colorSpans: number;
    domNodes: number;
    layers: number;
    bakeMs: number;
  };
  setAnimation: (clipIndex: number) => void;
  clearAnimation: () => void;
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
  setShadow: (partial: {
    enabled?: boolean;
    opacity?: number;
    lift?: number;
    color?: string;
    castShadow?: boolean;
    receiveShadow?: boolean;
    floor?: boolean;
  }) => void;
  configureEffect: (config: GlyphSceneEffectConfig | null) => void;
  setPresentation: (renderMode: SceneOptionsState["renderMode"], semanticOutput: { sceneManifest: GlyphControlSceneManifest; dictionary: GlyphObjectDictionary } | null) => void;
  getSemanticCellFrame: () => { cols: number; rows: number; cells: readonly (GlyphSemanticCellLineage | null)[] } | null;
}

export interface GlyphSceneProps {
  meshUrl: string;
  selectedPreset?: PresetModel;
  options: SceneOptionsState;
  onBuild: (ms: number) => void;
  onCameraChange?: (cam: { rotX: number; rotY: number; zoom?: number; target?: [number, number, number] }) => void;
  onStatsChange: (stats: GlyphMetrics) => void;
  onAnimationInfoChange: (info: { clips: Array<{ index: number; name: string; duration: number }> }) => void;
  selectedAnimation: string;
  animationPaused: boolean;
  animationTimeScale: number;
  effect: GlyphSceneEffectConfig | null;
  semanticOutput?: { sceneManifest: GlyphControlSceneManifest; dictionary: GlyphObjectDictionary } | null;
  onSemanticCellLineage?: (lineage: GlyphSemanticCellLineage | null) => void;
}

const POLL_INTERVAL_MS = 500;
const GALLERY_ZOOM_COMPAT = 50;

function toRuntimeZoom(galleryZoom: number): number {
  return galleryZoom * GALLERY_ZOOM_COMPAT;
}

function fromRuntimeZoom(runtimeZoom: number): number {
  return runtimeZoom / GALLERY_ZOOM_COMPAT;
}

function dragDensityToDownscale(dragDensity: number): number {
  if (!Number.isFinite(dragDensity)) return 2;
  return 1 / Math.min(Math.max(dragDensity, 0.1), 1);
}

function loadOptionsForPreset(preset: PresetModel | undefined): LoadMeshOptions | undefined {
  if (!preset || preset.kind === "primitive" || !preset.options) return undefined;
  if (preset.kind === "obj") return { objOptions: preset.options as LoadMeshOptions["objOptions"] };
  if (preset.kind === "glb" || preset.kind === "gltf") return { gltfOptions: preset.options as LoadMeshOptions["gltfOptions"] };
  if (preset.kind === "vox") return { voxOptions: preset.options as LoadMeshOptions["voxOptions"] };
  if (preset.kind === "stl") return { stlOptions: preset.options as LoadMeshOptions["stlOptions"] };
  return undefined;
}

function htmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function GlyphScene({
  meshUrl,
  selectedPreset,
  options,
  onBuild,
  onCameraChange,
  onStatsChange,
  onAnimationInfoChange,
  selectedAnimation,
  animationPaused,
  animationTimeScale,
  effect,
  semanticOutput = null,
  onSemanticCellLineage,
}: GlyphSceneProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(false);
  const demoIdRef = useRef(`glyph-scene-${Math.random().toString(36).slice(2)}`);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevClipCountRef = useRef(0);
  const prevBakeMsRef = useRef(0);
  // Keep a live ref to selectedPreset so the initial waitForHandle callback
  // (which closes over mount-time values) can access the current preset.
  const selectedPresetRef = useRef(selectedPreset);
  selectedPresetRef.current = selectedPreset;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const effectRef = useRef(effect);
  effectRef.current = effect;
  const semanticOutputRef = useRef(semanticOutput);
  semanticOutputRef.current = semanticOutput;
  // Last camera state applied via setTunables — guards against echo: when the
  // sidebar sets a value and the poll reads it back, we must not re-fire onCameraChange.
  const lastAppliedCameraRef = useRef<{ rotX: number; rotY: number; zoom: number; target: [number, number, number] } | null>(null);
  // Track auto-rotate so the poll doesn't echo rotY changes back through setTunables
  // while the RAF loop is spinning, which would cause setTunables to call stopAutoRotate.
  const autoRotateRef = useRef(false);

  function getHandle(): DemoHandle | null {
    const host = hostRef.current;
    if (!host) return null;
    const demoEl = host.querySelector(".glyph-demo") as (HTMLElement & { glyphcssDemo?: DemoHandle }) | null;
    return demoEl?.glyphcssDemo ?? null;
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!host || mountedRef.current) return;
    mountedRef.current = true;
    let cancelled = false;

    const defaults = JSON.stringify({
      // The gallery UI/presets mirror voxcss's legacy unitless zoom. The glyph
      // runtime and public API use absolute px-per-world-unit zoom.
      ...(options.zoom > 0 ? { zoom: toRuntimeZoom(options.zoom) } : {}),
      rotX: options.rotX,
      rotY: options.rotY,
    });

    const demoId = demoIdRef.current;
    const isPrimitive = selectedPresetRef.current?.kind === "primitive";
    const initialMtl = selectedPresetRef.current?.mtlUrl;
    const initialLoadOptions = loadOptionsForPreset(selectedPresetRef.current);
    const parserOptionsAttr = initialLoadOptions
      ? ` data-load-options="${htmlAttr(JSON.stringify(initialLoadOptions))}"`
      : "";
    host.innerHTML = `
      <div class="glyph-demo no-autorotate" id="${demoId}"
        data-geometry="cuboctahedron"
        ${isPrimitive ? `data-primitive="1"` : `data-mesh="${htmlAttr(meshUrl)}"${initialMtl ? ` data-mtl="${htmlAttr(initialMtl)}"` : ""}${parserOptionsAttr}`}
        data-defaults='${defaults.replace(/'/g, "&apos;")}'
        data-interactive-downscale="${htmlAttr(String(dragDensityToDownscale(options.dragDensity)))}"
        data-no-hotspots="1"
        data-no-controls="1">
        <div class="glyph-demo__viewer not-content" data-layout="canvas-only">
          <div class="glyph-demo__canvas">
            <div class="glyph-demo__scene-host">
              <div class="glyph-demo__stats"></div>
            </div>
            <div class="glyph-demo__loading">Loading…</div>
          </div>
        </div>
      </div>`;

    import("../../glyph-runtime").then(({ initAllGlyphDemos }) => {
      if (cancelled) return;
      initAllGlyphDemos();

      // Start polling for stats and animation info once the demo initializes.
      // The handle appears asynchronously (after the initial mesh load).
      let attempts = 0;
      const waitForHandle = (): void => {
        if (cancelled) return;
        const handle = getHandle();
        if (!handle) {
          if (attempts++ < 40) setTimeout(waitForHandle, 200);
          return;
        }
        const currentOptions = optionsRef.current;
        handle.setTunables(
          currentOptions.zoom > 0
            ? { zoom: toRuntimeZoom(currentOptions.zoom), rotX: currentOptions.rotX, rotY: currentOptions.rotY }
            : { rotX: currentOptions.rotX, rotY: currentOptions.rotY },
        );
        lastAppliedCameraRef.current = {
          rotX: currentOptions.rotX,
          rotY: currentOptions.rotY,
          zoom: currentOptions.zoom,
          target: currentOptions.target,
        };
        // Apply all option-driven state once now that the handle exists.
        // The dep-array useEffects below fired once at initial mount with a
        // null handle and won't re-fire because the options haven't changed.
        handle.setProjection(currentOptions.perspective === false ? "orthographic" : "perspective");
        if (currentOptions.perspective !== false) {
          handle.setTunables({ perspective: currentOptions.perspective });
        }
        handle.setTunables({
          renderMode: currentOptions.renderMode,
          featureEdges: currentOptions.featureEdges,
          glyphPalette: currentOptions.glyphPalette,
          charMode: currentOptions.charMode,
          wireframeJunctions: currentOptions.wireframeJunctions,
          useColors: currentOptions.useColors,
          smoothShading: currentOptions.smoothShading,
          creaseAngle: currentOptions.creaseAngle,
        });
        handle.setInteractiveDownscale(dragDensityToDownscale(currentOptions.dragDensity));
        handle.setDragMode(currentOptions.dragMode);
        handle.setFpvOptions({
          look: currentOptions.fpvLook,
          move: currentOptions.fpvMove,
          jump: currentOptions.fpvJump,
          crouch: currentOptions.fpvCrouch,
          moveSpeed: currentOptions.fpvMoveSpeed,
          jumpVelocity: currentOptions.fpvJumpVelocity,
          gravity: currentOptions.fpvGravity,
          eyeHeight: currentOptions.fpvEyeHeight,
          crouchHeight: currentOptions.fpvCrouchHeight,
          lookSensitivity: currentOptions.fpvLookSensitivity,
          invertY: currentOptions.fpvInvertY,
        });
        handle.setLighting({
          azimuth: currentOptions.lightAzimuth,
          elevation: currentOptions.lightElevation,
          keyIntensity: currentOptions.lightIntensity,
          ambientIntensity: currentOptions.ambientIntensity,
          keyColor: currentOptions.lightColor,
          ambientColor: currentOptions.ambientColor,
        });
        handle.setShadow({
          enabled: currentOptions.shadowEnabled,
          opacity: currentOptions.shadowOpacity,
          lift: currentOptions.shadowLift,
          color: currentOptions.shadowColor,
          castShadow: currentOptions.shadowCast,
          receiveShadow: currentOptions.shadowReceive,
          floor: currentOptions.shadowFloor,
        });
        // If the initial preset is a primitive, load its polygons now. The
        // runtime had no data-mesh attribute so it rendered the placeholder
        // cuboctahedron; replace it with the actual primitive geometry.
        const initialPreset = selectedPresetRef.current;
        if (initialPreset?.kind === "primitive") {
          handle.setPolygons(initialPreset.generatePolygons());
        }
        handle.configureEffect(effectRef.current);
        handle.setPresentation(currentOptions.renderMode, semanticOutputRef.current);
        startPolling(handle);
      };
      setTimeout(waitForHandle, 300);
    });

    return () => {
      cancelled = true;
      getHandle()?.configureEffect(null);
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

      const metrics: GlyphMetrics = {
        measuredAt: Date.now(),
        cols: stats.cols,
        rows: stats.rows,
        glyphs: stats.glyphs,
        textChars: stats.textChars,
        colorSpans: stats.colorSpans,
        domNodes: stats.domNodes,
        layers: stats.layers,
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
      //
      // Skip rotY sync while auto-rotate is running: auto-rotate's RAF loop
      // continuously advances camera.rotY, and if that propagates through
      // onCameraChange → setTunables({ rotY }) it calls stopAutoRotate()
      // on every poll cycle, killing the animation after one tick.
      if (onCameraChange && handle.getDragMode() !== "fpv") {
        const cam = handle.getCameraState();
        const rotXDeg = cam.rotX;
        const rotYDeg = ((cam.rotY % 360) + 360) % 360;
        const zoom = fromRuntimeZoom(cam.scale);
        const last = lastAppliedCameraRef.current;
        const TOL = 0.01;
        const isAutoRotating = autoRotateRef.current;
        const rotYChanged = !isAutoRotating && (!last || Math.abs(rotYDeg - last.rotY) > TOL);
        const rotXChanged = !last || Math.abs(rotXDeg - last.rotX) > TOL;
        const zoomChanged = !last || Math.abs(zoom - last.zoom) > TOL;
        const targetChanged = !last ||
          Math.abs(cam.target[0] - last.target[0]) > TOL ||
          Math.abs(cam.target[1] - last.target[1]) > TOL ||
          Math.abs(cam.target[2] - last.target[2]) > TOL;
        // Only fire if the runtime camera meaningfully diverges from the last value
        // the sidebar sent, preventing the setTunables → getCameraState echo loop.
        if (rotYChanged || rotXChanged || zoomChanged || targetChanged) {
          lastAppliedCameraRef.current = { rotX: rotXDeg, rotY: rotYDeg, zoom, target: cam.target };
          onCameraChange({
            rotX: rotXDeg,
            rotY: rotYDeg,
            ...(zoomChanged ? { zoom } : {}),
            target: cam.target,
          });
        }
      }
    }, POLL_INTERVAL_MS);
  }

  // React to meshUrl/preset changes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !mountedRef.current) return;
    const handle = getHandle();
    if (!handle) return;
    if (selectedPreset?.kind === "primitive") {
      handle.setPolygons(selectedPreset.generatePolygons());
    } else {
      void handle.setMeshUrl(meshUrl, selectedPreset?.mtlUrl, loadOptionsForPreset(selectedPreset));
    }
    // Reset clip tracking so the Dock updates on next poll.
    prevClipCountRef.current = -1;
  }, [meshUrl, selectedPreset?.id]);

  // React to camera/zoom/rotX/rotY changes.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    // zoom === 0 remains an old-route auto-fit sentinel. Normal gallery state
    // uses preset/UI zoom converted to glyphcss's absolute camera zoom.
    handle.setTunables(
      options.zoom > 0
        ? { zoom: toRuntimeZoom(options.zoom), rotX: options.rotX, rotY: options.rotY }
        : { rotX: options.rotX, rotY: options.rotY },
    );
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
      handle.setTunables({ perspective: options.perspective });
    }
  }, [options.perspective]);

  // React to autoCenter.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setControlState({ autoCenter: options.autoCenter });
  }, [options.autoCenter]);

  // React to autoRotate toggle.
  useEffect(() => {
    autoRotateRef.current = options.autoRotate;
    const handle = getHandle();
    if (!handle) return;
    handle.setAutoRotate(options.autoRotate);
  }, [options.autoRotate]);

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

  // React to density — scene-wide glyph resolution, driven via the render
  // font-size (base 13px ÷ density). Larger density = smaller cells = more glyphs.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setTunables({ fontSize: 13 / (options.density || 1) });
  }, [options.density]);

  // React to drag density — the temporary render density used while pointer
  // controls are active. User-facing value is a ratio; runtime option is a divisor.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setInteractiveDownscale(dragDensityToDownscale(options.dragDensity));
  }, [options.dragDensity]);

  // One bridge owns the coupled core mode + glyph output transaction. Keeping
  // these in separate effects allowed a later visible transition to retain
  // the forced semantic solid mode.
  useLayoutEffect(() => {
    getHandle()?.setPresentation(options.renderMode, semanticOutput ?? null);
  }, [options.renderMode, semanticOutput]);

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

  // React to charMode changes.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setTunables({ charMode: options.charMode });
  }, [options.charMode]);

  // React to wireframeJunctions changes.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setTunables({ wireframeJunctions: options.wireframeJunctions });
  }, [options.wireframeJunctions]);

  // React to useColors toggle.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setTunables({ useColors: options.useColors });
  }, [options.useColors]);

  // React to smoothShading toggle.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setTunables({ smoothShading: options.smoothShading });
  }, [options.smoothShading]);

  // React to creaseAngle slider.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setTunables({ creaseAngle: options.creaseAngle });
  }, [options.creaseAngle]);


  // React to animation clip selection.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    if (selectedAnimation === "") {
      handle.clearAnimation();
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

  // React to Shadow changes.
  useEffect(() => {
    const handle = getHandle();
    if (!handle) return;
    handle.setShadow({
      enabled: options.shadowEnabled,
      opacity: options.shadowOpacity,
      lift: options.shadowLift,
      color: options.shadowColor,
      castShadow: options.shadowCast,
      receiveShadow: options.shadowReceive,
      floor: options.shadowFloor,
    });
  }, [
    options.shadowEnabled,
    options.shadowOpacity,
    options.shadowLift,
    options.shadowColor,
    options.shadowCast,
    options.shadowReceive,
    options.shadowFloor,
  ]);

  useEffect(() => {
    getHandle()?.configureEffect(effect);
  }, [effect]);


  useEffect(() => {
    if (!onSemanticCellLineage) return;
    const handle = getHandle();
    if (!handle) return;
    const output = hostRef.current?.querySelector(".glyph-output");
    const onPointerDown = (event: PointerEvent) => {
      const frame = handle.getSemanticCellFrame();
      if (!frame || !output) { onSemanticCellLineage(null); return; }
      const rect = output.getBoundingClientRect();
      const col = Math.floor((event.clientX - rect.left) / (rect.width / frame.cols));
      const row = Math.floor((event.clientY - rect.top) / (rect.height / frame.rows));
      onSemanticCellLineage(col >= 0 && col < frame.cols && row >= 0 && row < frame.rows ? frame.cells[row * frame.cols + col] ?? null : null);
    };
    output?.addEventListener("pointerdown", onPointerDown);
    return () => output?.removeEventListener("pointerdown", onPointerDown);
  }, [onSemanticCellLineage, semanticOutput]);

  return (
    <div
      ref={hostRef}
      className="dn-vanilla-host"
      style={{ width: "100%", height: "100%" }}
    />
  );
}
