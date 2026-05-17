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
import {
  arrowPolygons,
  eulerXYZFromQuat,
  planePolygons,
  quatFromAxisAngle,
  quatFromEulerXYZ,
  quatMultiply,
  ringQuadPolygons,
} from "@layoutit/polycss-core";
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
// Visible band half-width relative to the ring's mid-radius. Drives ONLY
// the CSS mask; the underlying click target (quad bbox) is sized separately
// by RING_QUAD_OUTER_RATIO so we can show a thin ring without shrinking
// the hit area. Keep small for a clean look.
const RING_HALF_THICKNESS_RATIO = 0.02;
// Outer radius of the ring's quad polygon as a multiple of mid-radius. The
// quad's bbox IS the click target — generous quad = generous click margin
// even when the visible band is very thin. 1.04 leaves a 2% margin past the
// visible ring's outer edge while keeping the previous hit footprint.
const RING_QUAD_OUTER_RATIO = 1.04;
// Plane handle proportions, relative to the arrow's shaft length: the square
// sits at ~25% of the arrow length and is ~20% of the arrow length wide.
const PLANE_HALF_SIZE_RATIO = 0.1;
const PLANE_OFFSET_RATIO = 0.25;
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

/** Three plane specs (translate mode — planar drag). `perpAxis` is the
 *  axis perpendicular to the plane (the one the drag does NOT move along);
 *  `axisA` and `axisB` are the two axes the drag DOES update. All three
 *  refer to the CSS axes in `PolyMeshHandle.transform.position`. */
// Each plane handle is colored with the axis it's PERPENDICULAR to — so the
// XY plane (containing the red+green arrows) reads as the blue (Z) handle,
// the XZ plane as the green (Y) handle, and the YZ plane as the red (X)
// handle. Inversion of three.js's convention but maps cleanly to "the axis
// you can't drag along is this color".
const PLANE_SPECS: Array<{
  perpAxis: 0 | 1 | 2;
  axisA: 0 | 1 | 2;
  axisB: 0 | 1 | 2;
  key: "xy" | "xz" | "yz";
  color: string;
}> = [
  { perpAxis: 2, axisA: 0, axisB: 1, key: "xy", color: COLOR_Z },
  { perpAxis: 1, axisA: 0, axisB: 2, key: "xz", color: COLOR_Y },
  { perpAxis: 0, axisA: 1, axisB: 2, key: "yz", color: COLOR_X },
];

/** Returns true when the given signed CSS-space axis points AWAY from the
 *  viewer under the scene's current rotation (rotateZ(rotY) · rotateX(rotX)).
 *  Computed from screen-Z: a CSS-Z component < 0 after applying the scene
 *  rotation = into the screen = back-facing. Used by `<TransformControls>`
 *  to drop the shaft on the back-facing axis of each pair so the gizmo
 *  doesn't double-paint at the gizmo center. */
function isAxisBackFacing(
  cssAxis: 0 | 1 | 2,
  sign: 1 | -1,
  rotXDeg: number,
  rotYDeg: number,
): boolean {
  const rx = (rotXDeg * Math.PI) / 180;
  const ry = (rotYDeg * Math.PI) / 180;
  const a: [number, number, number] = [0, 0, 0];
  a[cssAxis] = sign;
  // rotateZ(rotY)
  const bx = a[0] * Math.cos(ry) - a[1] * Math.sin(ry);
  const by = a[0] * Math.sin(ry) + a[1] * Math.cos(ry);
  const bz = a[2];
  // rotateX(rotX) — only Y and Z change
  const cz = by * Math.sin(rx) + bz * Math.cos(rx);
  return cz < 0;
}

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
 *  position so the gizmo overlays the visible center of the mesh. The
 *  mesh wrapper sets `transform-origin: var(--origin)` to the same bbox
 *  center, so its visible center is `position + bboxCenter` regardless
 *  of scale or rotation — no per-axis scale multiplication needed. */
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

interface PlaneDragOptions {
  axisA: 0 | 1 | 2;
  axisB: 0 | 1 | 2;
  probeDistanceCss: number;
  wrapper: HTMLElement;
  target: PolyMeshHandle;
  startClientX: number;
  startClientY: number;
  translationSnap: number | null;
  onPlaneDelta(tA: number, tB: number, axisAVec: Vec3, axisBVec: Vec3): void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onDraggingChanged?: (dragging: boolean) => void;
}

/** Project pointer screen-px deltas onto a 2D basis (screen projections of
 *  two world axes) and solve a 2x2 system for the planar motion. Mirror of
 *  the single-axis projection in `startAxisDrag`, extended to two axes. */
function startPlaneDrag(opts: PlaneDragOptions): void {
  const {
    axisA,
    axisB,
    probeDistanceCss,
    wrapper,
    startClientX,
    startClientY,
    translationSnap,
    onPlaneDelta,
    onMouseDown,
    onMouseUp,
    onDraggingChanged,
  } = opts;

  // Probe both in-plane axes to measure their screen projections. Same
  // technique as startAxisDrag: place a 0×0 element at `axis * dist`, read
  // its bounding rect against the wrapper's, divide by `dist` to get the
  // unit screen vector for that world axis.
  const axisAVec: Vec3 = [0, 0, 0]; axisAVec[axisA] = 1;
  const axisBVec: Vec3 = [0, 0, 0]; axisBVec[axisB] = 1;
  function probe(axisVec: Vec3): { x: number; y: number } {
    const el = wrapper.ownerDocument!.createElement("div");
    el.style.position = "absolute";
    el.style.left = "0";
    el.style.top = "0";
    el.style.width = "0";
    el.style.height = "0";
    el.style.transform = `translate3d(${axisVec[0] * probeDistanceCss}px, ${axisVec[1] * probeDistanceCss}px, ${axisVec[2] * probeDistanceCss}px)`;
    wrapper.appendChild(el);
    const wR = wrapper.getBoundingClientRect();
    const pR = el.getBoundingClientRect();
    wrapper.removeChild(el);
    return {
      x: (pR.left - wR.left) / probeDistanceCss,
      y: (pR.top - wR.top) / probeDistanceCss,
    };
  }
  const pA = probe(axisAVec);
  const pB = probe(axisBVec);
  // Cramer's rule on the 2x2: [pA.x pB.x; pA.y pB.y] * [tA tB]' = [dx dy]'
  const det = pA.x * pB.y - pB.x * pA.y;
  if (Math.abs(det) < SCREEN_AXIS_DEAD_ZONE_SQ) return; // plane edge-on to camera

  onMouseDown?.();
  onDraggingChanged?.(true);

  const handleMove = (ev: PointerEvent): void => {
    const dx = ev.clientX - startClientX;
    const dy = ev.clientY - startClientY;
    let tA = (pB.y * dx - pB.x * dy) / det;
    let tB = (-pA.y * dx + pA.x * dy) / det;
    tA = snap(tA, translationSnap);
    tB = snap(tB, translationSnap);
    onPlaneDelta(tA, tB, axisAVec, axisBVec);
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

  // Per-key tracking. Each gizmo arrow / ring / plane is a polycss
  // PolyMeshHandle added to the scene, then re-parented under our wrapper.
  type GizmoSpec =
    | { kind: "arrow"; key: string; cssAxis: 0 | 1 | 2; sign: 1 | -1; color: string }
    | { kind: "ring"; key: string; cssAxis: 0 | 1 | 2; color: string }
    | { kind: "plane"; key: string; perpAxis: 0 | 1 | 2; axisA: 0 | 1 | 2; axisB: 0 | 1 | 2; color: string };
  type GizmoMesh = { handle: PolyMeshHandle; spec: GizmoSpec };
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

  function buildPolygonsFor(spec: GizmoSpec, alpha: number): Polygon[] {
    const baseLength = gizmoLengthForMesh(target?.polygons ?? []);
    const shaftLengthCss = baseLength * size;
    const lengthWorld = shaftLengthCss / SCENE_TILE_SIZE;
    const color = withAlpha(spec.color, alpha);
    if (spec.kind === "arrow") {
      // Strip the shaft for back-facing arrows so the visible-only-from-
      // outside silhouette stays clean. Both halves of a pair otherwise
      // share the same shaft volume at the gizmo origin.
      const sceneOpts = scene.getOptions();
      const backFacing = isAxisBackFacing(
        spec.cssAxis,
        spec.sign,
        sceneOpts.rotX ?? 65,
        sceneOpts.rotY ?? 45,
      );
      return arrowPolygons({
        axis: WORLD_AXIS_FOR_CSS[spec.cssAxis],
        sign: spec.sign,
        shaftLength: lengthWorld,
        shaftHalfThickness: lengthWorld * SHAFT_HALF_THICKNESS_RATIO,
        headLength: lengthWorld * HEAD_LENGTH_RATIO,
        headHalfThickness: lengthWorld * HEAD_HALF_THICKNESS_RATIO,
        color,
        shaft: !backFacing,
      });
    }
    if (spec.kind === "plane") {
      // Place the quad in the camera-facing octant: for each in-plane axis,
      // flip the offset sign if the +axis is back-facing. planePolygons
      // works in WORLD axes (a = (perp+1)%3, b = (perp+2)%3); since
      // WORLD_AXIS_FOR_CSS is involutive, the CSS axis we test for back-
      // facing is just WORLD_AXIS_FOR_CSS[worldA / worldB].
      const sceneOpts = scene.getOptions();
      const rotX = sceneOpts.rotX ?? 65;
      const rotY = sceneOpts.rotY ?? 45;
      const worldPerp = WORLD_AXIS_FOR_CSS[spec.perpAxis];
      const worldA = ((worldPerp + 1) % 3) as 0 | 1 | 2;
      const worldB = ((worldPerp + 2) % 3) as 0 | 1 | 2;
      const cssAForOffset = WORLD_AXIS_FOR_CSS[worldA];
      const cssBForOffset = WORLD_AXIS_FOR_CSS[worldB];
      const signA = isAxisBackFacing(cssAForOffset, 1, rotX, rotY) ? -1 : 1;
      const signB = isAxisBackFacing(cssBForOffset, 1, rotX, rotY) ? -1 : 1;
      const mag = lengthWorld * PLANE_OFFSET_RATIO;
      return planePolygons({
        axis: worldPerp,
        size: lengthWorld * PLANE_HALF_SIZE_RATIO,
        offset: [signA * mag, signB * mag],
        color,
      });
    }
    // ring — single square quad masked to a donut via CSS (see
    // .polycss-transform-ring rule in styles.ts). One DOM node per ring
    // instead of N segment quads. Quad outer radius is sized by
    // RING_QUAD_OUTER_RATIO so the hit footprint stays generous even when
    // the visible band (driven by RING_HALF_THICKNESS_RATIO) is thin.
    const radiusWorld = (shaftLengthCss * RING_RADIUS_RATIO) / SCENE_TILE_SIZE;
    const outerWorld = radiusWorld * RING_QUAD_OUTER_RATIO;
    return ringQuadPolygons({
      axis: WORLD_AXIS_FOR_CSS[spec.cssAxis],
      outerRadius: outerWorld,
      color,
    });
  }

  function classPrefixFor(spec: GizmoSpec): string {
    if (spec.kind === "arrow") return "polycss-transform-arrow";
    if (spec.kind === "plane") return "polycss-transform-plane";
    return "polycss-transform-ring";
  }

  /** Resolve the active spec list for the current mode. Translate mode mixes
   *  the 6 axis arrows with the 3 planar handles; rotate mode just rings. */
  function activeSpecs(): GizmoSpec[] {
    if (mode === "translate") {
      const arrows: GizmoSpec[] = ARROW_SPECS.map((a) => ({
        kind: "arrow",
        key: a.key,
        cssAxis: a.cssAxis,
        sign: a.sign,
        color: a.color,
      }));
      const planes: GizmoSpec[] = PLANE_SPECS.map((p) => ({
        kind: "plane",
        key: p.key,
        perpAxis: p.perpAxis,
        axisA: p.axisA,
        axisB: p.axisB,
        color: p.color,
      }));
      return [...arrows, ...planes];
    }
    if (mode === "rotate") {
      return RING_SPECS.map((r) => ({ kind: "ring", key: r.key, cssAxis: r.cssAxis, color: r.color }));
    }
    return [];
  }

  function buildGizmos(): void {
    teardownGizmos();
    if (!target) return;
    const showByKey = {
      x: opts.showX !== false,
      y: opts.showY !== false,
      z: opts.showZ !== false,
    };
    function specVisible(spec: GizmoSpec): boolean {
      if (spec.kind === "arrow") {
        const userAxis = spec.key.replace("-", "")[0] as "x" | "y" | "z";
        return showByKey[userAxis];
      }
      if (spec.kind === "ring") {
        return showByKey[spec.key as "x" | "y" | "z"];
      }
      // Plane handles need BOTH in-plane axes visible.
      const aName = (["x", "y", "z"] as const)[spec.axisA];
      const bName = (["x", "y", "z"] as const)[spec.axisB];
      return showByKey[aName] && showByKey[bName];
    }
    const targetPos = gizmoPosition();
    for (const spec of activeSpecs()) {
      if (!specVisible(spec)) continue;
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
      const classPrefix = classPrefixFor(spec);
      handle.element.classList.add(
        "polycss-transform-gizmo",
        classPrefix,
        `${classPrefix}--${spec.key}`,
      );
      if (spec.kind === "ring") {
        // Two CSS vars consumed by the .polycss-transform-ring mask: where
        // the visible band STARTS and ENDS, both as a fraction of the quad
        // edge (50%). The quad's outer radius is RING_QUAD_OUTER_RATIO ·
        // mid-radius, so we normalize the visible inner/outer edges
        // (mid ± halfThickness) against the quad outer to get the mask
        // positions inside the quad.
        const innerRatio = (1 - RING_HALF_THICKNESS_RATIO) / RING_QUAD_OUTER_RATIO;
        const outerRatio = (1 + RING_HALF_THICKNESS_RATIO) / RING_QUAD_OUTER_RATIO;
        handle.element.style.setProperty("--ring-inner-ratio", `${innerRatio}`);
        handle.element.style.setProperty("--ring-outer-ratio", `${outerRatio}`);
      }
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
      // Plane handles are hit-tested FIRST so they win when overlapping with
      // the arrow shafts at the corner.
      for (const spec of PLANE_SPECS) {
        const aName = (["x", "y", "z"] as const)[spec.axisA];
        const bName = (["x", "y", "z"] as const)[spec.axisB];
        if (!showByKey[aName] || !showByKey[bName]) continue;
        const gm = gizmos.get(spec.key);
        if (!gm) continue;
        if (!pointInMeshElement(gm.handle.element, event.clientX, event.clientY)) continue;
        event.preventDefault();
        event.stopPropagation();
        draggingKey = spec.key;
        rebuildGizmoColors();
        dragStartPosition = (target.transform.position ?? [0, 0, 0]).slice() as Vec3;
        startPlaneDrag({
          axisA: spec.axisA,
          axisB: spec.axisB,
          probeDistanceCss: gizmoLengthForMesh(target.polygons) * size,
          wrapper: gm.handle.element,
          target,
          startClientX: event.clientX,
          startClientY: event.clientY,
          translationSnap: opts.translationSnap ?? null,
          onPlaneDelta: (tA, tB, aVec, bVec) => {
            if (!target || !dragStartPosition) return;
            const next: Vec3 = [
              dragStartPosition[0] + tA * aVec[0] + tB * bVec[0],
              dragStartPosition[1] + tA * aVec[1] + tB * bVec[1],
              dragStartPosition[2] + tA * aVec[2] + tB * bVec[2],
            ];
            target.setTransform({ position: next });
            syncGizmoPositions();
            opts.onObjectChange?.({ object: target, position: next });
            opts.onChange?.();
          },
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
        // Plain bbox-containment hit-test. The donut mask is decoration; the
        // entire ring quad bbox is clickable so the rings are easy to land on.
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
            // World-frame quaternion compose. Rings stay at world axes
            // visually (the gizmo isn't rotated with the mesh), so each
            // ring drag rotates the mesh around the WORLD axis the ring
            // points to — pre-multiply Qdelta · Qstart. Cumulative across
            // repeated drags. X-axis sign stays empirically inverted to
            // match user expectation for CW drag on the red ring.
            const sign = spec.cssAxis === 0 ? -1 : 1;
            const axisVec: Vec3 = [0, 0, 0];
            axisVec[spec.cssAxis] = 1;
            const deltaRad = (degrees * sign * Math.PI) / 180;
            const qStart = quatFromEulerXYZ(dragStartRotation);
            const qDelta = quatFromAxisAngle(axisVec, deltaRad);
            const next = eulerXYZFromQuat(quatMultiply(qDelta, qStart));
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
