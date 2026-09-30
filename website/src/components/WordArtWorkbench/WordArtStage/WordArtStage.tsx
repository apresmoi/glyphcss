import type { GlyphEffectLayerHandle, Polygon, Vec3 } from "@glyphcss/react";
import {
  GlyphEffectLayer,
  GlyphMesh,
  GlyphOrthographicCamera,
  GlyphPerspectiveCamera,
  GlyphScene,
  useGlyphSceneContext,
} from "@glyphcss/react";
import type { GlyphEffectDefinition, GlyphEffectParamSchema } from "glyphcss";
import { useEffect, useMemo, useRef, useState } from "react";
import { type GalleryEffectDefinition } from "../../../features/gallery/model/effects";
import type { GalleryEffectBlend, GalleryEffectParamValue } from "../../../features/gallery/model/types";
import {
  BASE_FONT_PX,
  type WordArtCharMode,
  type WordArtHiddenLines,
  type WordArtRenderMode,
  fitWordArtZoom,
} from "../../../features/wordart/model/parameters";
import { computeGlyphAtlasAvailability } from "../../../services/rendering/glyphAtlasAvailability";

/** Center the word's bbox on the origin so the camera frames it (glyphcss has
 *  no scene-side autoCenter). NO axis swap: @glyphcss/fonts emits Z-up polygons
 *  (world Z = letter height, world Y = letter width, world X = extrusion depth
 *  — see extrude.ts), viewed by this page's `rotX={90}` camera (see `Stage`). */
export function centerMesh(polygons: Polygon[]): Polygon[] {
  if (polygons.length === 0) return polygons;
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (const p of polygons)
    for (const v of p.vertices) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }
  const cx = (minX + maxX) / 2,
    cy = (minY + maxY) / 2,
    cz = (minZ + maxZ) / 2;
  return polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map(([x, y, z]) => [x - cx, y - cy, z - cz] as Vec3),
  }));
}

/** World-frame XYZ Euler rotation (degrees), R = Rx·Ry·Rz — the exact
 *  convention `createGlyphScene`'s internal mesh-transform applies for a
 *  `<GlyphMesh rotation>` prop. Used by the preset tiles to angle a static
 *  letter without touching the camera (whose own `rotX`/`rotY` orbits in a
 *  different, camera-specific convention). */
export function rotateMeshVerticesDeg(polygons: Polygon[], [rxDeg, ryDeg, rzDeg]: Vec3): Polygon[] {
  const DEG2RAD = Math.PI / 180;
  const rx = rxDeg * DEG2RAD,
    ry = ryDeg * DEG2RAD,
    rz = rzDeg * DEG2RAD;
  const cosX = Math.cos(rx),
    sinX = Math.sin(rx);
  const cosY = Math.cos(ry),
    sinY = Math.sin(ry);
  const cosZ = Math.cos(rz),
    sinZ = Math.sin(rz);
  function rotate([x, y, z]: Vec3): Vec3 {
    let nx = cosZ * x - sinZ * y;
    let ny = sinZ * x + cosZ * y;
    let nz = z;
    x = cosY * nx + sinY * nz;
    y = ny;
    z = -sinY * nx + cosY * nz;
    nx = x;
    ny = cosX * y - sinX * z;
    nz = sinX * y + cosX * z;
    return [nx, ny, nz];
  }
  return polygons.map((p) => ({ ...p, vertices: p.vertices.map(rotate) }));
}

interface StageProps {
  polygons: Polygon[];
  scaleXFrac: number;
  scaleYFrac: number;
  zoomScale: number;
  setZoomScale: (updater: (prev: number) => number) => void;
  turn: number;
  setTurn: (updater: (prev: number) => number) => void;
  tilt: number;
  setTilt: (updater: (prev: number) => number) => void;
  density: number;
  renderMode: WordArtRenderMode;
  charMode: WordArtCharMode;
  hiddenLines: WordArtHiddenLines;
  colorEncoding: "spans" | "atlas";
  /** Reports the real reason `colorEncoding: "atlas"` isn't available right
   *  now (`null` when it is) — see `AtlasAvailabilityWatcher` below. */
  onAtlasAvailability: (reason: string | null) => void;
  perspective: boolean;
  lightDir: Vec3;
  lightIntensity: number;
  lightColor: string;
  ambient: number;
  spin: boolean;
  effectDefinition: GalleryEffectDefinition | null;
  effectParams: Record<string, GalleryEffectParamValue>;
  effectBlend: GalleryEffectBlend;
  effectPaused: boolean;
  effectTimeScale: number;
  /** Always-fresh mesh-rotation + effective-zoom snapshot, read (not
   *  subscribed to) by the Export panel's "CodePen" action when it fires —
   *  mirrors `SynthWorkbench`'s `cameraRef`/`snapshotCamera()`, except here
   *  it's the MESH that turntables (the camera is pinned at rot 0), so what's
   *  snapshotted is `<GlyphMesh rotation>` + the fitted `zoom`, not a camera
   *  orientation. */
  snapshotRef: React.MutableRefObject<{ rotation: Vec3; zoom: number }>;
}

/**
 * Isolated render surface. Auto-spin / drag drive the MESH rotation (turntable
 * Rx + tilt Ry); the camera is pinned at rot 0. glyphcss projects geometry to an
 * ASCII <pre>, so there's no CSS-3D wrapper to spin like polycss. Kept small so
 * the per-frame spin re-render doesn't touch the parent's controls +
 * 2000-option font datalist.
 */
/**
 * `<GlyphScene autoSize>` only re-measures cols/rows via a `ResizeObserver`
 * on the HOST BOX size (`createGlyphScene`'s `fitToHost`) — changing the
 * Density slider's font-size alone doesn't resize that box, so the grid
 * would stay stale until something else (e.g. a window resize) happened to
 * trigger a refit. Mounted as a scene child (same `useGlyphSceneContext`
 * seam `GlyphMesh` itself uses) so it can call the imperative `scene.fit()`
 * + `rerender()` explicitly whenever `density` changes — mirrors
 * `SynthWorkbench`'s own density effect (`host.style.fontSize = …; scene.fit();
 * scene.rerender();`), just declared as a child instead of an imperative ref.
 */
function DensityFit({ density }: { density: number }) {
  const { sceneRef } = useGlyphSceneContext();
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.fit();
    scene.rerender();
  }, [density, sceneRef]);
  return null;
}

/**
 * Keeps the "atlas available?" reason current by watching the stage `<pre>`
 * directly — a `MutationObserver`, not a dependency list — mirroring
 * `SynthWorkbench`'s own watcher. Mounted as a scene child (same
 * `useGlyphSceneContext` seam `DensityFit` uses) so it has imperative access
 * to the real `<pre>` DOM `@glyphcss/react`'s declarative `<GlyphScene>`
 * doesn't otherwise expose.
 */
function AtlasAvailabilityWatcher({
  charMode,
  onAvailability,
}: {
  charMode: WordArtCharMode;
  onAvailability: (reason: string | null) => void;
}) {
  const { sceneRef } = useGlyphSceneContext();
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const pre = scene.output;
    const recompute = (): void => {
      onAvailability(computeGlyphAtlasAvailability(pre, { useColors: true, charMode }).reason);
    };
    recompute();
    const observer = new MutationObserver(recompute);
    observer.observe(pre, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [sceneRef, charMode, onAvailability]);
  return null;
}

export function Stage({
  polygons,
  scaleXFrac,
  scaleYFrac,
  zoomScale,
  setZoomScale,
  turn,
  setTurn,
  tilt,
  setTilt,
  density,
  renderMode,
  charMode,
  hiddenLines,
  colorEncoding,
  onAtlasAvailability,
  perspective,
  lightDir,
  lightIntensity,
  lightColor,
  ambient,
  spin,
  effectDefinition,
  effectParams,
  effectBlend,
  effectPaused,
  effectTimeScale,
  snapshotRef,
}: StageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 900, h: 600 });
  const draggingRef = useRef(false);
  const lastPtr = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStage({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Auto-spin advances the mesh turntable (turn = Rx) each frame (paused while dragging).
  useEffect(() => {
    if (!spin) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (!draggingRef.current) setTurn((t) => (t + dt * 32) % 360);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spin]);

  const onPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    lastPtr.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - lastPtr.current.x;
    const dy = e.clientY - lastPtr.current.y;
    lastPtr.current = { x: e.clientX, y: e.clientY };
    setTurn((t) => t + dx * 0.4);
    setTilt((t) => Math.max(-85, Math.min(85, t + dy * 0.4)));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };
  // Wheel drives the same zoomScale the sidebar slider does (so they agree).
  const onWheel = (e: React.WheelEvent) => {
    const factor = Math.pow(0.95, e.deltaY * 0.012);
    setZoomScale((z) => Math.max(0.1, Math.min(6, z * factor)));
  };

  const centered = useMemo(() => centerMesh(polygons), [polygons]);
  const zoom = fitWordArtZoom(centered, stage.w, stage.h, scaleXFrac, scaleYFrac) * zoomScale;
  const Cam = perspective ? GlyphPerspectiveCamera : GlyphOrthographicCamera;
  // Always-fresh — read only when the Export panel/CodePen action fires (see
  // `StageProps.snapshotRef`), never subscribed to, so this plain assignment
  // (not a `useEffect`) is fine even though `turn` changes every spin frame.
  snapshotRef.current = { rotation: [0, tilt, turn], zoom };

  return (
    <div
      className="wa-stage"
      ref={stageRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    >
      <Cam rotX={90} rotY={0} zoom={zoom}>
        <GlyphScene
          autoSize
          mode={renderMode}
          charMode={charMode}
          hiddenLines={hiddenLines}
          colorEncoding={colorEncoding}
          className="wa-scene"
          style={{ fontSize: `${BASE_FONT_PX / density}px` }}
          directionalLight={{ direction: lightDir, intensity: lightIntensity, color: lightColor }}
          ambientLight={{ intensity: ambient }}
        >
          <DensityFit density={density} />
          <AtlasAvailabilityWatcher charMode={charMode} onAvailability={onAtlasAvailability} />
          {/* Font mesh is Z-up: local Z = text height, local Y = text width,
              local X = extrusion depth (see extrude.ts). The camera is tilted
              `rotX={90}` (instead of the flat `rotX={0}` a screen-plane-authored
              mesh would use) so that vertical axis reads on screen — this
              reproduces byte-identical output to the old X-up mesh at rotX=0
              (verified: both project to the same screen col/row for every
              vertex). "Scale X" stretches horizontally, so it maps directly to
              local Y; "Scale Y" maps directly to local Z. Depth (local X) is
              baked into the geometry, so it stays 1. */}
          <GlyphMesh polygons={centered} rotation={[0, tilt, turn]} scale={[1, scaleXFrac, scaleYFrac]} />
          {effectDefinition && (
            <WordArtEffectLayer
              key={effectDefinition.id}
              definition={effectDefinition}
              params={effectParams}
              blend={effectBlend}
              paused={effectPaused}
              timeScale={effectTimeScale}
            />
          )}
        </GlyphScene>
      </Cam>
    </div>
  );
}

interface WordArtEffectLayerProps {
  definition: GalleryEffectDefinition;
  params: Record<string, GalleryEffectParamValue>;
  blend: GalleryEffectBlend;
  paused: boolean;
  timeScale: number;
  /** Caps how often the rAF clock actually PUSHES `params.time` (and so
   *  triggers a re-render/re-paint) — the sim clock itself still advances
   *  every real frame, so effect speed is unaffected, only paint cadence.
   *  `undefined` (the main Stage's usage) means uncapped, unchanged 60fps
   *  behavior. Used by the footer `LiveEffectTile`s (see below): measured
   *  with Chrome DevTools Protocol `Performance.getMetrics` `TaskDuration`,
   *  two tiny 16×11 tiles animating uncapped added ~20-25 percentage points
   *  of sustained main-thread busy time versus zero live tiles (idle
   *  ~6% → ~30%) — disproportionate to their cell count, because the fixed
   *  per-frame cost (effect eval + colored-span innerHTML re-paint × 2
   *  layers × 60fps) dominates at this tiny grid size, not the cell count
   *  itself. A tile only needs to visibly be moving, not track wall-clock
   *  time exactly, so capping repaint cadence recovers most of that cost
   *  for ~free perceived smoothness — see `LiveEffectTile`. */
  maxFps?: number;
}

/**
 * One `@glyphcss/effects` layer applied to the word-art mesh — the
 * doc-canonical React pattern (`<GlyphEffectLayer ref>` + a `requestAnimationFrame`
 * loop mutating `ref.current.params.time` directly, bypassing React state so
 * the clock never re-renders the composition/Dock tree) mirroring the
 * gallery's own paused/timeScale-aware `configureEffect`/`startEffectLoop`
 * clock in `glyph-runtime.ts`. Effects without a `time` parameter mount with
 * no clock at all — same `"time" in parameterSchema` gate the Effects folder
 * uses to enable/disable its own Paused/Speed controls.
 */
export function WordArtEffectLayer({ definition, params, blend, paused, timeScale, maxFps }: WordArtEffectLayerProps) {
  const layerRef = useRef<GlyphEffectLayerHandle<Record<string, GalleryEffectParamValue>>>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const timeScaleRef = useRef(timeScale);
  timeScaleRef.current = timeScale;
  const maxFpsRef = useRef(maxFps);
  maxFpsRef.current = maxFps;
  const hasTime = "time" in definition.parameterSchema;

  useEffect(() => {
    if (!hasTime) return;
    let raf = 0;
    let last: number | null = null;
    let lastPaint: number | null = null;
    let time = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (pausedRef.current) {
        last = now;
        return;
      }
      const elapsed = last === null ? 0 : Math.min(Math.max(now - last, 0) / 1000, 0.1);
      last = now;
      time += elapsed * timeScaleRef.current;
      const fps = maxFpsRef.current;
      if (fps && lastPaint !== null && now - lastPaint < 1000 / fps) return;
      lastPaint = now;
      if (layerRef.current) layerRef.current.params.time = time;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hasTime]);

  return (
    <GlyphEffectLayer
      ref={layerRef}
      effect={definition as GlyphEffectDefinition<GlyphEffectParamSchema>}
      params={params}
      target="surfaces"
      blend={blend}
    />
  );
}
