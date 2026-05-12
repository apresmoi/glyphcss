/**
 * createTransformControls — vanilla equivalent of `<TransformControls>`.
 * Builds the same six-arrow translate gizmo / three-ring rotate gizmo
 * around an attached mesh and emits `objectChange` events as the user
 * drags. Mirrors the React API surface (mode, size, snap, draggingChanged
 * event) and uses the same shared geometry helpers in `@layoutit/polycss-core`
 * (`arrowPolygons`, `ringPolygons`).
 *
 * Usage:
 *   const tc = createTransformControls(scene, { mode: "translate" });
 *   tc.attach(meshHandle);
 *   tc.setMode("rotate");
 *   tc.on("objectChange", ({ position, rotation }) => {
 *     // Apply to your own state if you need to keep it in sync; the
 *     // gizmo already calls target.setTransform internally.
 *   });
 *   tc.detach();
 *   tc.destroy();
 */
import { arrowPolygons, ringPolygons } from "@layoutit/polycss-core";
import type { Polygon, Vec3 } from "@layoutit/polycss-core";
import type { PolyMeshHandle, PolySceneHandle } from "./createPolyScene";

type Mode = "translate" | "rotate";

const COLOR_X = "#ff3653";
const COLOR_Y = "#8adb00";
const COLOR_Z = "#2c8fff";

const SCENE_TILE_SIZE = 50;
const FALLBACK_SHAFT_LENGTH = 60;
const SHAFT_LENGTH_RATIO = 0.6;
const SHAFT_HALF_THICKNESS_RATIO = 0.0125;
const HEAD_LENGTH_RATIO = 0.15;
const HEAD_HALF_THICKNESS_RATIO = 0.04;
const RING_RADIUS_RATIO = 1.0;
const RING_HALF_THICKNESS_RATIO = 0.012;
const RING_SEGMENTS = 64;
const SCREEN_AXIS_DEAD_ZONE_SQ = 0.0001;

const ALPHA_IDLE = 0.6;
const ALPHA_HOVER = 0.8;
const ALPHA_DRAGGING = 1.0;

/** polycss world→CSS remap. Match TransformControls in @layoutit/polycss-react. */
const WORLD_AXIS_FOR_CSS: Record<0 | 1 | 2, 0 | 1 | 2> = { 0: 1, 1: 0, 2: 2 };

/** Six arrow specs (translate mode). `cssAxis` is the visible direction
 *  the arrow points and the index in `PolyMeshHandle.transform.position`
 *  the drag updates. */
const ARROW_SPECS: Array<{ cssAxis: 0 | 1 | 2; sign: 1 | -1; key: string; color: string }> = [
  { cssAxis: 0, sign:  1, key:  "x", color: COLOR_X },
  { cssAxis: 0, sign: -1, key: "-x", color: COLOR_X },
  { cssAxis: 1, sign:  1, key:  "y", color: COLOR_Y },
  { cssAxis: 1, sign: -1, key: "-y", color: COLOR_Y },
  { cssAxis: 2, sign:  1, key:  "z", color: COLOR_Z },
  { cssAxis: 2, sign: -1, key: "-z", color: COLOR_Z },
];

/** Three ring specs (rotate mode). */
const RING_SPECS: Array<{ cssAxis: 0 | 1 | 2; key: string; color: string }> = [
  { cssAxis: 0, key: "x", color: COLOR_X },
  { cssAxis: 1, key: "y", color: COLOR_Y },
  { cssAxis: 2, key: "z", color: COLOR_Z },
];

function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function snap(value: number, step: number | null | undefined): number {
  if (!step || step <= 0) return value;
  return Math.round(value / step) * step;
}

/** Compute the bbox center of a mesh's polygons in scene-CSS pixels.
 *  polycss world→CSS axis remap: world-Y → CSS-x, world-X → CSS-y,
 *  world-Z → CSS-z. The result is the offset we add to the gizmo
 *  position so the gizmo overlays the visible center of the mesh —
 *  required because scene-level `autoCenter` translates the
 *  centerWrapper by `-bboxCenter`, which would otherwise leave the
 *  gizmo (whose polygons are generated around world origin) sitting at
 *  `-bboxCenter` in screen space rather than aligned with the mesh. */
function bboxCenterCss(polygons: Polygon[]): Vec3 {
  if (polygons.length === 0) return [0, 0, 0];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const poly of polygons) {
    for (const v of poly.vertices) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }
  }
  if (!Number.isFinite(minX)) return [0, 0, 0];
  return [
    ((minY + maxY) / 2) * SCENE_TILE_SIZE,
    ((minX + maxX) / 2) * SCENE_TILE_SIZE,
    ((minZ + maxZ) / 2) * SCENE_TILE_SIZE,
  ];
}

function gizmoLengthForMesh(polygons: Polygon[]): number {
  if (polygons.length === 0) return FALLBACK_SHAFT_LENGTH;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const poly of polygons) {
    for (const v of poly.vertices) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }
  }
  if (!Number.isFinite(minX)) return FALLBACK_SHAFT_LENGTH;
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  return extent * SCENE_TILE_SIZE * SHAFT_LENGTH_RATIO;
}

function pointInMeshElement(meshEl: HTMLElement, clientX: number, clientY: number): boolean {
  const polys = Array.from(meshEl.querySelectorAll("i,b,s,u")) as HTMLElement[];
  for (const p of polys) {
    const r = p.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom
    ) {
      return true;
    }
  }
  return false;
}

export interface PolyTransformControlsObjectChangeEvent {
  object: PolyMeshHandle;
  position?: Vec3;
  rotation?: Vec3;
}

export interface PolyTransformControlsOptions {
  /** Drag mode. "translate" → axial arrows, "rotate" → axial rings. */
  mode?: Mode;
  /** Multiplier on gizmo size (shaft length / ring radius). Default 1. */
  size?: number;
  /** Snap step (CSS pixels) for translate-mode. */
  translationSnap?: number | null;
  /** Snap step (degrees) for rotate-mode. */
  rotationSnap?: number | null;
  /** Show / hide axis pairs. Default true for all. */
  showX?: boolean;
  showY?: boolean;
  showZ?: boolean;
  /** Disable interaction without unmounting. Default true. */
  enabled?: boolean;
  /** Fires for any transform change. Argument-less, mirrors three.js. */
  onChange?: () => void;
  /** Fires with the new transform during drag. The gizmo also calls
   *  `target.setTransform` internally; this callback lets parent code
   *  mirror the change into its own state. */
  onObjectChange?: (event: PolyTransformControlsObjectChangeEvent) => void;
  /** Fires once on drag start. */
  onMouseDown?: () => void;
  /** Fires once on drag end. */
  onMouseUp?: () => void;
  /** Fires with `true` on drag start, `false` on drag end. */
  onDraggingChanged?: (dragging: boolean) => void;
}

export interface PolyTransformControlsHandle {
  /** Bind to a mesh — gizmo follows the mesh's transform. Pass `null`
   *  to detach. Calling `attach` again with a new target swaps the
   *  binding without rebuilding the gizmo geometry. */
  attach(mesh: PolyMeshHandle | null): void;
  /** Equivalent to `attach(null)`. */
  detach(): void;
  /** Switch between translate and rotate. Tears down the old gizmo
   *  and rebuilds the new one. */
  setMode(mode: Mode): void;
  /** Re-read the target's transform and reposition the gizmo. Call
   *  after mutating `target.setTransform` externally if you want the
   *  gizmo to follow. */
  update(): void;
  /** Remove all listeners + gizmo meshes from the scene. Idempotent. */
  destroy(): void;
}

interface DragOptions {
  cssAxis: 0 | 1 | 2;
  sign: 1 | -1;
  shaftLengthCss: number;
  wrapper: HTMLElement;
  target: PolyMeshHandle;
  startClientX: number;
  startClientY: number;
  translationSnap: number | null;
  onAxisDelta(t: number, axisVec: Vec3): void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onDraggingChanged?: (dragging: boolean) => void;
}

/** Project pointer screen-px deltas onto the screen projection of an
 *  axis vector via a temporary probe element. Matches React's
 *  `startAxisDrag`. */
function startAxisDrag(opts: DragOptions): void {
  const {
    cssAxis,
    sign,
    shaftLengthCss,
    wrapper,
    target: _target,
    startClientX,
    startClientY,
    translationSnap,
    onAxisDelta,
    onMouseDown,
    onMouseUp,
    onDraggingChanged,
  } = opts;

  const probeDistance = shaftLengthCss;
  const axisVec: Vec3 = [0, 0, 0];
  axisVec[cssAxis] = sign;
  const probe = wrapper.ownerDocument!.createElement("div");
  probe.style.position = "absolute";
  probe.style.left = "0";
  probe.style.top = "0";
  probe.style.width = "0";
  probe.style.height = "0";
  probe.style.transform = `translate3d(${axisVec[0] * probeDistance}px, ${axisVec[1] * probeDistance}px, ${axisVec[2] * probeDistance}px)`;
  wrapper.appendChild(probe);
  const wRect = wrapper.getBoundingClientRect();
  const pRect = probe.getBoundingClientRect();
  wrapper.removeChild(probe);
  const screenAxisX = (pRect.left - wRect.left) / probeDistance;
  const screenAxisY = (pRect.top - wRect.top) / probeDistance;
  const screenAxisLenSq = screenAxisX * screenAxisX + screenAxisY * screenAxisY;
  if (screenAxisLenSq < SCREEN_AXIS_DEAD_ZONE_SQ) return;

  onMouseDown?.();
  onDraggingChanged?.(true);

  const handleMove = (ev: PointerEvent): void => {
    const dx = ev.clientX - startClientX;
    const dy = ev.clientY - startClientY;
    let t = (dx * screenAxisX + dy * screenAxisY) / screenAxisLenSq;
    t = snap(t, translationSnap);
    onAxisDelta(t, axisVec);
  };
  const handleUp = (): void => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleUp);
    // Swallow the click that follows pointerup so a release-over-mesh
    // doesn't toggle selection in createSelect.
    const swallow = (e: Event): void => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    onMouseUp?.();
    onDraggingChanged?.(false);
  };
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
  window.addEventListener("pointercancel", handleUp);
}

interface RingDragOptions {
  cssAxis: 0 | 1 | 2;
  wrapper: HTMLElement;
  target: PolyMeshHandle;
  startClientX: number;
  startClientY: number;
  rotationSnap: number | null;
  onAngleDelta(degrees: number): void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onDraggingChanged?: (dragging: boolean) => void;
}

/** Track pointer angle around the gizmo center, accumulate the
 *  unwrapped delta, and feed it back as degrees of rotation. Matches
 *  React's `startRingDrag`. */
function startRingDrag(opts: RingDragOptions): void {
  const {
    cssAxis: _cssAxis,
    wrapper,
    target: _target,
    startClientX,
    startClientY,
    rotationSnap,
    onAngleDelta,
    onMouseDown,
    onMouseUp,
    onDraggingChanged,
  } = opts;

  const wRect = wrapper.getBoundingClientRect();
  const centerX = wRect.left;
  const centerY = wRect.top;

  let lastAngle = Math.atan2(startClientY - centerY, startClientX - centerX);
  let cumulative = 0;

  onMouseDown?.();
  onDraggingChanged?.(true);

  const handleMove = (ev: PointerEvent): void => {
    const a = Math.atan2(ev.clientY - centerY, ev.clientX - centerX);
    let d = a - lastAngle;
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    cumulative += d;
    lastAngle = a;
    let degrees = (cumulative * 180) / Math.PI;
    degrees = snap(degrees, rotationSnap);
    onAngleDelta(degrees);
  };
  const handleUp = (): void => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleUp);
    const swallow = (e: Event): void => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    onMouseUp?.();
    onDraggingChanged?.(false);
  };
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
  window.addEventListener("pointercancel", handleUp);
}

export function createTransformControls(
  scene: PolySceneHandle,
  options: PolyTransformControlsOptions = {},
): PolyTransformControlsHandle {
  let target: PolyMeshHandle | null = null;
  let mode: Mode = options.mode ?? "translate";
  const size = options.size ?? 1;
  const opts: PolyTransformControlsOptions = { ...options };

  // No standalone wrapper element. The earlier draft appended a
  // wrapper to `scene.host`, but that lives OUTSIDE the camera-
  // transformed scene root (`.polycss-camera` carries the scale +
  // rotateX/rotateY), so the gizmo polygons rendered in screen space
  // and ignored the camera. Going through `scene.add` for each gizmo
  // mesh puts it inside the centerWrapper (camera-space), which is
  // exactly the same coordinate frame the user mesh lives in. Each
  // gizmo mesh is positioned at `target.transform.position` via
  // setTransform — that's the gizmo origin.

  // Per-key tracking. Each gizmo arrow / ring is a polycss PolyMeshHandle
  // added to the scene, then re-parented under our wrapper.
  type GizmoMesh = {
    handle: PolyMeshHandle;
    spec: { key: string; cssAxis: 0 | 1 | 2; sign?: 1 | -1; color: string };
  };
  const gizmos = new Map<string, GizmoMesh>();
  let hoveredKey: string | null = null;
  let draggingKey: string | null = null;
  // Offset added to `target.transform.position` to place the gizmo at
  // the mesh's visible center under scene-level autoCenter. Cached on
  // attach because it depends only on the target's polygon bbox.
  let centerOffset: Vec3 = [0, 0, 0];

  function gizmoPosition(): Vec3 {
    if (!target) return [0, 0, 0];
    const t = target.transform.position ?? ([0, 0, 0] as Vec3);
    return [t[0] + centerOffset[0], t[1] + centerOffset[1], t[2] + centerOffset[2]];
  }

  function alphaFor(key: string): number {
    if (draggingKey === key) return ALPHA_DRAGGING;
    if (hoveredKey === key) return ALPHA_HOVER;
    return ALPHA_IDLE;
  }

  function rebuildGizmoColors(): void {
    // Re-emit each arrow/ring's polygons with the updated alpha. Cheap
    // — geometry hasn't changed, just the per-polygon color string.
    for (const [key, gm] of gizmos) {
      const polys = buildPolygonsFor(gm.spec, alphaFor(key));
      gm.handle.setPolygons(polys, { recomputeAutoCenter: false });
    }
  }

  function buildPolygonsFor(
    spec: { key: string; cssAxis: 0 | 1 | 2; sign?: 1 | -1; color: string },
    alpha: number,
  ): Polygon[] {
    const baseLength = gizmoLengthForMesh(target?.polygons ?? []);
    const shaftLengthCss = baseLength * size;
    const lengthWorld = shaftLengthCss / SCENE_TILE_SIZE;
    const color = withAlpha(spec.color, alpha);
    if (mode === "translate") {
      return arrowPolygons({
        axis: WORLD_AXIS_FOR_CSS[spec.cssAxis],
        sign: spec.sign ?? 1,
        shaftLength: lengthWorld,
        shaftHalfThickness: lengthWorld * SHAFT_HALF_THICKNESS_RATIO,
        headLength: lengthWorld * HEAD_LENGTH_RATIO,
        headHalfThickness: lengthWorld * HEAD_HALF_THICKNESS_RATIO,
        color,
      });
    }
    // rotate
    const radiusWorld = (shaftLengthCss * RING_RADIUS_RATIO) / SCENE_TILE_SIZE;
    return ringPolygons({
      axis: WORLD_AXIS_FOR_CSS[spec.cssAxis],
      radius: radiusWorld,
      halfThickness: radiusWorld * RING_HALF_THICKNESS_RATIO,
      segments: RING_SEGMENTS,
      color,
    });
  }

  function buildGizmos(): void {
    teardownGizmos();
    if (!target) return;
    const showByKey = {
      x: opts.showX !== false,
      y: opts.showY !== false,
      z: opts.showZ !== false,
    };
    const specs = mode === "translate" ? ARROW_SPECS : mode === "rotate" ? RING_SPECS : [];
    const classPrefix = mode === "translate" ? "polycss-transform-arrow" : "polycss-transform-ring";
    const targetPos = gizmoPosition();
    for (const spec of specs) {
      const userAxis = spec.key.replace("-", "")[0] as "x" | "y" | "z";
      if (!showByKey[userAxis]) continue;
      const polys = buildPolygonsFor(spec, alphaFor(spec.key));
      // Each gizmo mesh is added directly to the scene at the target's
      // position. scene.add appends to centerWrapper (the camera-
      // transformed scene root), so the arrow inherits the scene's
      // perspective + rotateX/rotateY/scale automatically — no
      // separate wrapper needed.
      const handle = scene.add(
        { polygons: polys, objectUrls: [], warnings: [], dispose: () => {} },
        {
          excludeFromAutoCenter: true,
          id: `__poly-gizmo-${spec.key}`,
          position: targetPos,
        },
      );
      handle.element.classList.add(
        "polycss-transform-gizmo",
        classPrefix,
        `${classPrefix}--${spec.key}`,
      );
      gizmos.set(spec.key, { handle, spec });
    }
  }

  function teardownGizmos(): void {
    for (const { handle } of gizmos.values()) handle.remove();
    gizmos.clear();
    hoveredKey = null;
    draggingKey = null;
  }

  function syncGizmoPositions(): void {
    if (!target) return;
    const pos = gizmoPosition();
    for (const { handle } of gizmos.values()) handle.setTransform({ position: pos });
  }

  function update(): void {
    if (!target) return;
    if (gizmos.size === 0) buildGizmos();
    else syncGizmoPositions();
  }

  function attach(t: PolyMeshHandle | null): void {
    target = t;
    if (!t) {
      centerOffset = [0, 0, 0];
      teardownGizmos();
      return;
    }
    centerOffset = bboxCenterCss(t.polygons);
    teardownGizmos();
    buildGizmos();
  }

  function detach(): void {
    attach(null);
  }

  function setMode(m: Mode): void {
    if (m === mode) return;
    mode = m;
    if (target) {
      teardownGizmos();
      buildGizmos();
    }
  }

  function applyAxisDelta(spec: { cssAxis: 0 | 1 | 2 }, t: number, axisVec: Vec3): void {
    if (!target) return;
    // Snapshot at drag start lives in the closure passed to
    // startAxisDrag — but applyAxisDelta is called per move with the
    // raw cumulative `t`, so we need to anchor each application to
    // the drag-start position, not the live (already-mutated) one.
    // The dragStartPosition snapshot is captured in the pointerdown
    // handler below.
    if (!dragStartPosition) return;
    const next: Vec3 = [
      dragStartPosition[0] + t * axisVec[0],
      dragStartPosition[1] + t * axisVec[1],
      dragStartPosition[2] + t * axisVec[2],
    ];
    target.setTransform({ position: next });
    syncGizmoPositions();
    opts.onObjectChange?.({ object: target, position: next });
    opts.onChange?.();
    void spec;
  }
  let dragStartPosition: Vec3 | null = null;

  // Track the start-of-drag rotation snapshot so accumulated deltas
  // are anchored to the rotation at pointerdown rather than the live
  // (already-mutated) rotation each move.
  let dragStartRotation: Vec3 | null = null;

  // Pointerdown listener on the host. Same JS bbox hit-test the React
  // version uses — reliable regardless of CSS pointer-events / border-
  // shape clipping issues.
  const onPointerDown = (event: PointerEvent): void => {
    if (!target || opts.enabled === false) return;
    const showByKey = {
      x: opts.showX !== false,
      y: opts.showY !== false,
      z: opts.showZ !== false,
    };
    if (mode === "translate") {
      for (const spec of ARROW_SPECS) {
        const userAxis = spec.key.replace("-", "")[0] as "x" | "y" | "z";
        if (!showByKey[userAxis]) continue;
        const gm = gizmos.get(spec.key);
        if (!gm) continue;
        if (!pointInMeshElement(gm.handle.element, event.clientX, event.clientY)) continue;
        event.preventDefault();
        event.stopPropagation();
        draggingKey = spec.key;
        rebuildGizmoColors();
        // Snapshot the position at drag start so each pointermove
        // applies its cumulative `t` against the same anchor instead
        // of compounding off the live (already-mutated) position.
        dragStartPosition = (target.transform.position ?? [0, 0, 0]).slice() as Vec3;
        startAxisDrag({
          cssAxis: spec.cssAxis,
          sign: spec.sign,
          shaftLengthCss: gizmoLengthForMesh(target.polygons) * size,
          // Use the arrow's own mesh wrapper as the probe target —
          // it's positioned at target.position and lives in the same
          // camera-transformed scene root as the polygons we're
          // dragging, so probe-vs-wrapper bbox math gives px-per-
          // scene-px directly.
          wrapper: gm.handle.element,
          target,
          startClientX: event.clientX,
          startClientY: event.clientY,
          translationSnap: opts.translationSnap ?? null,
          onAxisDelta: (t, axisVec) => applyAxisDelta(spec, t, axisVec),
          onMouseDown: opts.onMouseDown,
          onMouseUp: opts.onMouseUp,
          onDraggingChanged: (d) => {
            if (!d) {
              draggingKey = null;
              dragStartPosition = null;
              rebuildGizmoColors();
            }
            opts.onDraggingChanged?.(d);
          },
        });
        return;
      }
    } else if (mode === "rotate") {
      for (const spec of RING_SPECS) {
        if (!showByKey[spec.key as "x" | "y" | "z"]) continue;
        const gm = gizmos.get(spec.key);
        if (!gm) continue;
        if (!pointInMeshElement(gm.handle.element, event.clientX, event.clientY)) continue;
        event.preventDefault();
        event.stopPropagation();
        draggingKey = spec.key;
        rebuildGizmoColors();
        dragStartRotation = (target.transform.rotation ?? [0, 0, 0]).slice() as Vec3;
        startRingDrag({
          cssAxis: spec.cssAxis,
          wrapper: gm.handle.element,
          target,
          startClientX: event.clientX,
          startClientY: event.clientY,
          rotationSnap: opts.rotationSnap ?? null,
          onAngleDelta: (degrees) => {
            if (!target || !dragStartRotation) return;
            const next: Vec3 = [
              dragStartRotation[0],
              dragStartRotation[1],
              dragStartRotation[2],
            ];
            // Invert the X-axis sign empirically — vanilla's rotateX
            // applied around `transform-origin: bboxCenter` reads as
            // backward from what users expect after dragging the red
            // ring CW. Y and Z behave correctly with the raw sign.
            // (The math is the same as React's; the perceptual
            // difference comes from the chicken's polygon coords
            // sitting at world coordinates rather than recentered to
            // origin like React's PolyMesh does.)
            const sign = spec.cssAxis === 0 ? -1 : 1;
            next[spec.cssAxis] = dragStartRotation[spec.cssAxis] + degrees * sign;
            target.setTransform({ rotation: next });
            opts.onObjectChange?.({ object: target, rotation: next });
            opts.onChange?.();
          },
          onMouseDown: opts.onMouseDown,
          onMouseUp: opts.onMouseUp,
          onDraggingChanged: (d) => {
            if (!d) {
              draggingKey = null;
              dragStartRotation = null;
              rebuildGizmoColors();
              // Rebake the atlas now that the rotation is committed. The
              // mesh wrapper's CSS rotation has already been applied via
              // setTransform; rebakeAtlas() inverse-rotates the world light
              // into the mesh's new local frame and re-rasterizes the atlas
              // so baked Lambert shading is correct for the new orientation.
              target?.rebakeAtlas();
            }
            opts.onDraggingChanged?.(d);
          },
        });
        return;
      }
    }
  };
  // Capture-phase so we fire BEFORE createPolyOrbitControls' bubble-phase
  // pointerdown listener on the same host element. If the click hits
  // a gizmo arrow / ring we call stopPropagation, which prevents
  // the orbit/map controls from starting a camera-rotate gesture in parallel.
  // If the click misses every gizmo, we don't stop — PolyControls
  // gets the event during its bubble phase and rotates as usual.
  scene.host.addEventListener("pointerdown", onPointerDown, { capture: true });

  // Hover tracking — listen at the host and figure out which gizmo
  // mesh (if any) is under the cursor. Cheaper than per-element
  // listeners and works regardless of pointer-events quirks.
  const onPointerMove = (event: MouseEvent): void => {
    if (!target || draggingKey || opts.enabled === false) return;
    let next: string | null = null;
    for (const [key, gm] of gizmos) {
      if (pointInMeshElement(gm.handle.element, event.clientX, event.clientY)) {
        next = key;
        break;
      }
    }
    if (next === hoveredKey) return;
    hoveredKey = next;
    rebuildGizmoColors();
  };
  scene.host.addEventListener("pointermove", onPointerMove);

  function destroy(): void {
    scene.host.removeEventListener("pointerdown", onPointerDown, { capture: true });
    scene.host.removeEventListener("pointermove", onPointerMove);
    teardownGizmos();
  }

  return { attach, detach, setMode, update, destroy };
}
