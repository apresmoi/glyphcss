/**
 * <TransformControls> — drag gizmo for translating a `<PolyMesh>` along
 * the six world-axis directions (±X, ±Y, ±Z). Mirrors three.js's
 * TransformControls API (`mode`, `space`, `size`, `showX/Y/Z`,
 * `translationSnap`, events `onChange` / `onObjectChange` / `onMouseDown`
 * / `onMouseUp` / `onDraggingChanged`).
 *
 * Geometry: each arrow is a polycss `<PolyMesh>` whose vertices come
 * from `arrowPolygons` (a thin axis-aligned cuboid shaft + a 4-sided
 * pyramid head). This matches how `<PolyAxesHelper>` is built — same
 * 3D primitives, so the gizmo's lit appearance composes naturally with
 * the rest of the scene.
 *
 * Drag math: project pointer screen-pixel delta onto the screen
 * projection of the world axis. Screen-axis is snapshotted at
 * pointerdown via a probe element placed `axis × beamLength` from the
 * gizmo origin, then normalized — `getBoundingClientRect()` deltas give
 * px-per-scene-px automatically (handles camera tilt + zoom).
 *
 * `position` / drag deltas live in scene-CSS pixels, matching `<PolyMesh
 * position>` (which is `translate3d(x px, y px, z px)`). Polygon
 * vertices live in WORLD units; we convert via `SCENE_TILE_SIZE` (the
 * default `tileSize` PolyScene applies to atlas geometry).
 *
 * `space="local"` is accepted in the type but only "world" is implemented.
 */
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  arrowPolygons,
  DEFAULT_CAMERA_STATE,
  eulerXYZFromQuat,
  planePolygons,
  quatFromAxisAngle,
  quatFromEulerXYZ,
  quatMultiply,
  ringQuadPolygons,
  type Polygon,
  type Vec3,
} from "@layoutit/polycss-core";
import { PolyMesh } from "../scene/PolyMesh";
import { pointInMeshElement, type PolyMeshHandle, type PolyPointerEvent } from "../scene/events";
import { PolyCameraContext } from "../camera/context";
import { createSceneStore, useStoreSelector } from "../store/sceneStore";

// Stable no-op store used as a hook-rule-compliant fallback when
// PolyTransformControls is rendered outside a PolyCamera. We always pass a
// store to useStoreSelector; this one never changes, so it never re-renders.
const FALLBACK_CAMERA_STORE = createSceneStore(DEFAULT_CAMERA_STATE);

// Three.js convention: X red, Y green, Z blue. Kept identical so muscle
// memory carries over.
const COLOR_X = "#ff3653";
const COLOR_Y = "#8adb00";
const COLOR_Z = "#2c8fff";

// Alpha applied to the base colors at idle / hover / dragging states.
// Translucency is baked into each polygon's color (rgba) rather than a
// CSS `opacity` on the gizmo wrapper — `opacity` creates a flattened
// stacking context, which would collapse the arrow's 3D depth into a
// single 2D image and break the way the cuboid + pyramid compose with
// the rest of the scene. Per-polygon rgba leaves the 3D pipeline alone.
const ALPHA_IDLE = 0.6;
const ALPHA_HOVER = 0.8;
const ALPHA_DRAGGING = 1.0;

/** Convert a `#rrggbb` color to `rgba(r, g, b, a)`. Falls back to the
 *  input string unchanged if it doesn't look like a 6-digit hex. */
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// PolyScene's default `tileSize` (50 px / world unit). Polygon vertex
// coords are world units; the scene renderer multiplies by tileSize to
// place them in scene-CSS pixel space.
const SCENE_TILE_SIZE = 50;

// Fallback shaft length (in scene-CSS px) used only when the target
// mesh has no polygons to bbox-derive from.
const FALLBACK_SHAFT_LENGTH = 60;

// Shaft length as a fraction of the mesh's largest bbox extent. ~60%
// makes arrows clearly stick out of the silhouette without dwarfing it.
const SHAFT_LENGTH_RATIO = 0.6;

// Arrow visual proportions — fractions of the shaft length, expressed
// as HALF-extents (the value passed to arrowPolygons is `…HalfThickness`).
// Shaft full-width = 2.5% of length, matching <PolyAxesHelper>'s
// `thickness=0.025` so the gizmo arrows visually weigh the same as
// the axes overlay. Heads are ~3× wider than the shaft so the 3D
// pyramid reads as a clear arrowhead at any size.
const SHAFT_HALF_THICKNESS_RATIO = 0.0125;  // → 2.5% full
const HEAD_LENGTH_RATIO = 0.15;
const HEAD_HALF_THICKNESS_RATIO = 0.04;     // → 8% full

// Rotate-mode rings. Radius matches the arrow length so translate /
// rotate gizmos look the same scale; thickness is similar to a shaft
// so each ring reads as a thin band, not a disc.
const RING_RADIUS_RATIO = 1.0;
// Visible band half-width relative to mid-radius. Drives ONLY the CSS mask;
// the click target (quad bbox) is sized by RING_QUAD_OUTER_RATIO so we can
// show a thin ring without shrinking the hit footprint.
const RING_HALF_THICKNESS_RATIO = 0.02;
// Outer radius of the ring's quad polygon as a multiple of mid-radius. The
// quad's bbox IS the click target. 1.04 leaves a 2% margin past the visible
// ring's outer edge while keeping the prior hit footprint.
const RING_QUAD_OUTER_RATIO = 1.04;

// Plane handle proportions (translate-mode planar drag). Small square at
// the corner between two axis arrows — sits inside the arrow tips so it
// doesn't compete with single-axis hits on the shaft.
const PLANE_HALF_SIZE_RATIO = 0.1;
const PLANE_OFFSET_RATIO = 0.25;

// Squared length (in screen-px-per-scene-px) below which the axis is
// considered edge-on — its on-screen projection is too short for stable
// dragging. 0.0001 ≈ scene must shrink an axis-unit to ≥ 0.01 screen
// pixels for drags to engage; below that, a 1-pixel pointer drag would
// produce 100+ scene-px of mesh movement.
const SCREEN_AXIS_DEAD_ZONE_SQ = 0.0001;

/** Return the largest bbox extent of `polygons` in scene-CSS pixels. */
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

/**
 * Return the bbox center of `polygons` in scene-CSS pixels, mapped via the
 * standard polycss world→CSS axis remap (vertex[1]→CSS X, vertex[0]→CSS Y,
 * vertex[2]→CSS Z).
 *
 * Used to offset the gizmo wrapper so it sits at the mesh's visual center
 * rather than at its wrapper origin. When the mesh's vertices live at their
 * native positions (PolyMesh.autoCenter unset, e.g. when PolyScene's
 * autoCenter is doing the centering) the wrapper origin is OFFSET from the
 * visible mesh by -bboxCenter; without this compensation the gizmo would
 * sit where world (0,0,0) ends up on screen, not on the mesh.
 */
function gizmoCenterForMesh(polygons: Polygon[]): Vec3 {
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

/** Optional ref-or-direct binding to a target mesh. */
export type PolyTransformControlsObject =
  | PolyMeshHandle
  | RefObject<PolyMeshHandle | null>
  | null;

export interface PolyTransformControlsObjectChangeEvent {
  /** The mesh being transformed. */
  object: PolyMeshHandle;
  /** The new position. Only emitted when `mode` is "translate". */
  position?: Vec3;
  /** The new Euler rotation (degrees, X/Y/Z). Only emitted when
   *  `mode` is "rotate". */
  rotation?: Vec3;
}

export interface PolyTransformControlsProps {
  /** Mesh to attach to. Pass a ref returned from `useRef<PolyMeshHandle>()`
   *  or a handle directly. `null` hides the gizmo. */
  object: PolyTransformControlsObject;
  /** Drag mode. "translate" → axial arrows, "rotate" → axial rings. */
  mode?: "translate" | "rotate";
  /** Axis basis. Only "world" is implemented in v1. */
  space?: "world" | "local";
  /** Multiplier on gizmo size (shaft length / ring radius). Default 1. */
  size?: number;
  /** Show / hide axis gizmo PAIRS. Default true. In translate mode this
   *  hides both the +/- arrows for that axis; in rotate mode this hides
   *  the corresponding ring. */
  showX?: boolean;
  showY?: boolean;
  showZ?: boolean;
  /** Snap step (CSS pixels) for translate-mode dragging. */
  translationSnap?: number | null;
  /** Snap step (degrees) for rotate-mode dragging. */
  rotationSnap?: number | null;
  /** Disable interaction without unmounting. Default true. */
  enabled?: boolean;
  /** Fires for any transform change. Argument-less, mirrors three.js. */
  onChange?: () => void;
  /** Fires with the new transform during drag. Use this to update
   *  position state — controlled flow, parent owns state. */
  onObjectChange?: (event: PolyTransformControlsObjectChangeEvent) => void;
  /** Fires once on drag start. */
  onMouseDown?: () => void;
  /** Fires once on drag end. */
  onMouseUp?: () => void;
  /** Fires with `true` on drag start, `false` on drag end. Mirrors
   *  three.js's `'dragging-changed'` event (kebab-case preserved here
   *  via the boolean payload, since react prop naming is camelCase). */
  onDraggingChanged?: (dragging: boolean) => void;
}

function resolveObject(o: PolyTransformControlsObject): PolyMeshHandle | null {
  if (o == null) return null;
  if (typeof o === "object" && "current" in o) return o.current ?? null;
  return o as PolyMeshHandle;
}

function snap(value: number, step: number | null | undefined): number {
  if (!step || step <= 0) return value;
  return Math.round(value / step) * step;
}

/** Six signed-axis directions to render as arrows.
 *
 * `cssAxis` is the CSS-pixel direction the arrow points in (0=x
 * horizontal, 1=y vertical, 2=z depth) — that's both the direction the
 * user sees the arrow and the direction `<PolyMesh position>` deltas
 * apply along, since position is in scene-CSS pixels.
 *
 * polycss's world→CSS remap (core/src/scene/polygonGeometry.ts) sends
 * world-Y → CSS-x and world-X → CSS-y, so to draw an arrow visually
 * along CSS-x we have to feed `arrowPolygons` axis=1 (world-Y), and
 * vice versa. `WORLD_AXIS_FOR_CSS` is that lookup — used only when
 * generating the polygon geometry. Everything else (probe, drag math,
 * position deltas) operates in CSS coords directly.
 */
const WORLD_AXIS_FOR_CSS: Record<0 | 1 | 2, 0 | 1 | 2> = { 0: 1, 1: 0, 2: 2 };

const ARROW_SPECS: Array<{ cssAxis: 0 | 1 | 2; sign: 1 | -1; key: string; color: string }> = [
  { cssAxis: 0, sign:  1, key:  "x", color: COLOR_X },
  { cssAxis: 0, sign: -1, key: "-x", color: COLOR_X },
  { cssAxis: 1, sign:  1, key:  "y", color: COLOR_Y },
  { cssAxis: 1, sign: -1, key: "-y", color: COLOR_Y },
  { cssAxis: 2, sign:  1, key:  "z", color: COLOR_Z },
  { cssAxis: 2, sign: -1, key: "-z", color: COLOR_Z },
];

/** Three rotate-mode rings, one per user-axis. `cssAxis` is the
 *  rotation axis in CSS coords (matches `<PolyMesh rotation>`'s Vec3
 *  index, which corresponds directly to rotateX / rotateY / rotateZ).
 *  The ring lies in the plane perpendicular to that axis. */
const RING_SPECS: Array<{ cssAxis: 0 | 1 | 2; key: string; color: string }> = [
  { cssAxis: 0, key: "x", color: COLOR_X },
  { cssAxis: 1, key: "y", color: COLOR_Y },
  { cssAxis: 2, key: "z", color: COLOR_Z },
];

/** Resolve a user-facing axis letter from an ARROW_SPECS key. */
function userAxisLetterOf(key: string): "x" | "y" | "z" {
  const last = key.replace("-", "")[0];
  return last as "x" | "y" | "z";
}


/** True when the signed CSS-space axis points AWAY from the viewer after
 *  the scene's rotateZ(rotY) · rotateX(rotX) transform. Used to drop the
 *  shaft on back-facing translate arrows so the gizmo silhouette stays
 *  clean — both halves of a pair otherwise share a shaft volume at the
 *  gizmo origin and overdraw. */
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
  const bx = a[0] * Math.cos(ry) - a[1] * Math.sin(ry);
  const by = a[0] * Math.sin(ry) + a[1] * Math.cos(ry);
  const bz = a[2];
  const cz = by * Math.sin(rx) + bz * Math.cos(rx);
  void bx;
  return cz < 0;
}

/** Three plane specs (translate mode — planar drag). `perpAxis` is the
 *  axis perpendicular to the plane (the one the drag does NOT move along);
 *  `axisA` and `axisB` are the two CSS axes the drag DOES update. */
// Plane color = perpendicular axis color: XY plane → blue (Z), XZ → green
// (Y), YZ → red (X). "The axis you can't drag along is this color."
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

interface DragOptions {
  /** CSS axis index this arrow drives (0=x, 1=y, 2=z). The probe is
   *  placed along this CSS direction; pointer-px deltas project onto
   *  it; the resulting `t` updates `position[cssAxis]`. */
  cssAxis: 0 | 1 | 2;
  sign: 1 | -1;
  shaftLengthCss: number;
  wrapper: HTMLElement;
  target: PolyMeshHandle;
  startClientX: number;
  startClientY: number;
  translationSnap: number | null;
  onChange?: () => void;
  onObjectChange?: (event: PolyTransformControlsObjectChangeEvent) => void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onDraggingChanged?: (dragging: boolean) => void;
}

/** Project the screen-space delta of a CSS-axis vector via a probe
 *  placed `axis × shaftLengthCss` from the gizmo wrapper origin, then
 *  run a pointermove/up loop translating pointer-px deltas into
 *  scene-px along the axis. Shared by the per-arrow
 *  PolyMesh.onPointerDown handler AND the cameraEl JS hit-test
 *  fallback so both paths produce identical drag behavior. */
function startAxisDrag(opts: DragOptions): void {
  const {
    cssAxis,
    sign,
    shaftLengthCss,
    wrapper,
    target,
    startClientX,
    startClientY,
    translationSnap,
    onChange,
    onObjectChange,
    onMouseDown,
    onMouseUp,
    onDraggingChanged,
  } = opts;

  const probeDistance = shaftLengthCss;
  const axisVec: Vec3 = [0, 0, 0];
  axisVec[cssAxis] = sign;
  const probe = document.createElement("div");
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

  const startPos = target.getPosition() ?? ([0, 0, 0] as Vec3);

  onMouseDown?.();
  onDraggingChanged?.(true);

  const handleMove = (ev: PointerEvent): void => {
    const dx = ev.clientX - startClientX;
    const dy = ev.clientY - startClientY;
    let t = (dx * screenAxisX + dy * screenAxisY) / screenAxisLenSq;
    t = snap(t, translationSnap);
    const newPos: Vec3 = [
      startPos[0] + t * axisVec[0],
      startPos[1] + t * axisVec[1],
      startPos[2] + t * axisVec[2],
    ];
    onObjectChange?.({ object: target, position: newPos });
    onChange?.();
  };
  const handleUp = (): void => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleUp);
    // Defang the synthesized `click` that follows pointerup. Without
    // this, releasing a gizmo drag over the chicken's polygons fires
    // Select's click listener and (since the chicken is already
    // selected) immediately toggles it off. Capture-phase one-shot
    // listener stops the click before it bubbles to cameraEl. The
    // setTimeout(0) cleanup handles the case where the browser
    // didn't synthesize a click (large pointer movement) — the
    // listener would otherwise stay armed and eat the next real click.
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
  /** Distance (CSS px) the probe is offset along each in-plane axis. Uses
   *  the same scale as the arrow's shaftLengthCss so screen projection is
   *  proportional to one axis-unit of mesh translation. */
  probeDistanceCss: number;
  wrapper: HTMLElement;
  target: PolyMeshHandle;
  startClientX: number;
  startClientY: number;
  translationSnap: number | null;
  onChange?: () => void;
  onObjectChange?: (event: PolyTransformControlsObjectChangeEvent) => void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onDraggingChanged?: (dragging: boolean) => void;
}

/** Project pointer screen-px deltas onto the screen projections of TWO
 *  world axes (the plane's basis), solve a 2x2 system, and update the
 *  mesh position along both axes. Same probe trick as `startAxisDrag`,
 *  extended to two basis vectors. */
function startPlaneDrag(opts: PlaneDragOptions): void {
  const {
    axisA,
    axisB,
    probeDistanceCss,
    wrapper,
    target,
    startClientX,
    startClientY,
    translationSnap,
    onChange,
    onObjectChange,
    onMouseDown,
    onMouseUp,
    onDraggingChanged,
  } = opts;

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
  const det = pA.x * pB.y - pB.x * pA.y;
  if (Math.abs(det) < SCREEN_AXIS_DEAD_ZONE_SQ) return;

  const startPos = target.getPosition() ?? ([0, 0, 0] as Vec3);
  onMouseDown?.();
  onDraggingChanged?.(true);

  const handleMove = (ev: PointerEvent): void => {
    const dx = ev.clientX - startClientX;
    const dy = ev.clientY - startClientY;
    let tA = (pB.y * dx - pB.x * dy) / det;
    let tB = (-pA.y * dx + pA.x * dy) / det;
    if (translationSnap !== null) {
      tA = Math.round(tA / translationSnap) * translationSnap;
      tB = Math.round(tB / translationSnap) * translationSnap;
    }
    const next: Vec3 = [
      startPos[0] + tA * axisAVec[0] + tB * axisBVec[0],
      startPos[1] + tA * axisAVec[1] + tB * axisBVec[1],
      startPos[2] + tA * axisAVec[2] + tB * axisBVec[2],
    ];
    onObjectChange?.({ object: target, position: next });
    onChange?.();
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
  /** CSS axis the ring rotates around (0=x, 1=y, 2=z). Maps directly
   *  to PolyMesh's `rotation[cssAxis]` slot (rotateX/rotateY/rotateZ). */
  cssAxis: 0 | 1 | 2;
  wrapper: HTMLElement;
  target: PolyMeshHandle;
  startClientX: number;
  startClientY: number;
  rotationSnap: number | null;
  onChange?: () => void;
  onObjectChange?: (event: PolyTransformControlsObjectChangeEvent) => void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onDraggingChanged?: (dragging: boolean) => void;
}

/** Rotation drag: track the pointer's screen-space angle around the
 *  gizmo wrapper's screen center, accumulate the unwrapped delta
 *  across moves, and apply it as degrees-of-rotation around the ring's
 *  CSS axis. Coarser than three.js's true ray-onto-rotation-plane
 *  projection (which would reproject through the camera per move) but
 *  reads naturally for the intuitive case of dragging a ring face-on,
 *  and degenerates predictably when the ring is edge-on (rotation
 *  speed scales with the apparent ring size). */
function startRingDrag(opts: RingDragOptions): void {
  const {
    cssAxis,
    wrapper,
    target,
    startClientX,
    startClientY,
    rotationSnap,
    onChange,
    onObjectChange,
    onMouseDown,
    onMouseUp,
    onDraggingChanged,
  } = opts;

  const wRect = wrapper.getBoundingClientRect();
  // Wrapper is a 0×0 anchor at the gizmo origin — its bounding rect
  // collapses to a single point in screen space, which is exactly the
  // ring's center (we want angle relative to the rotation pivot).
  const centerX = wRect.left;
  const centerY = wRect.top;

  let lastAngle = Math.atan2(startClientY - centerY, startClientX - centerX);
  let cumulative = 0; // accumulated radians since drag start
  const startRotation = (target.getRotation() ?? [0, 0, 0]) as Vec3;

  onMouseDown?.();
  onDraggingChanged?.(true);

  // World-frame quaternion compose. The gizmo's rings stay at fixed world
  // axes (the wrapper isn't rotated with the mesh), so the user clicks a
  // ring expecting rotation around the WORLD axis they see. We pre-multiply:
  //   Qnew = Qdelta · Qstart
  // → rotation applies in the WORLD frame, then the prior orientation. Each
  // ring drag composes cumulatively on top of the mesh's current orientation
  // without resetting it — which Euler-add couldn't do for repeated axes.
  const qStart = quatFromEulerXYZ(startRotation);
  const handleMove = (ev: PointerEvent): void => {
    const a = Math.atan2(ev.clientY - centerY, ev.clientX - centerX);
    let d = a - lastAngle;
    // Unwrap so a drag that crosses the ±π boundary doesn't jump by 2π.
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    cumulative += d;
    lastAngle = a;
    let degrees = (cumulative * 180) / Math.PI;
    degrees = snap(degrees, rotationSnap);
    const axisVec: Vec3 = [0, 0, 0];
    axisVec[cssAxis] = 1;
    const qDelta = quatFromAxisAngle(axisVec, (degrees * Math.PI) / 180);
    const newRotation = eulerXYZFromQuat(quatMultiply(qDelta, qStart));
    onObjectChange?.({ object: target, rotation: newRotation });
    onChange?.();
  };
  const handleUp = (): void => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleUp);
    // Same click-swallow trick as the translate drag — release-over-
    // chicken would otherwise toggle selection off mid-rotation.
    const swallow = (e: Event): void => {
      e.stopPropagation();
      e.stopImmediatePropagation();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    onMouseUp?.();
    onDraggingChanged?.(false);
    // Rebake the atlas with the new rotation baked in. Must come after the
    // callbacks above so consumers have already committed the final rotation
    // to state before the atlas snapshot runs.
    target.rebakeAtlas();
  };
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
  window.addEventListener("pointercancel", handleUp);
}

export function PolyTransformControls({
  object,
  mode = "translate",
  space = "world",
  size = 1,
  showX = true,
  showY = true,
  showZ = true,
  translationSnap = null,
  rotationSnap = null,
  enabled = true,
  onChange,
  onObjectChange,
  onMouseDown,
  onMouseUp,
  onDraggingChanged,
}: PolyTransformControlsProps) {
  // Refs don't trigger React re-renders. When `object` is a RefObject
  // whose `.current` lands AFTER first render (the common case — the
  // target <PolyMesh> mounts in the same pass and only sets the ref
  // after our first render), we need a single follow-up render to
  // pick it up. useEffect with `object` in the deps array handles
  // both first-mount and ref-identity changes cleanly.
  const [, forceRender] = useState(0);
  useEffect(() => {
    forceRender((n) => n + 1);
  }, [object]);

  // Camera rotation, reactively. Used to compute which translate arrows are
  // pointing AWAY from the viewer so we can render them as head-only. The
  // store subscription means the gizmo geometry re-evaluates whenever the
  // user orbits the camera — no stale back/front state.
  const cameraCtxForRot = useContext(PolyCameraContext);
  // Two primitive selectors — returning an object literal each call would
  // make useSyncExternalStore see a "changed" snapshot every render and
  // trigger an infinite re-render loop.
  const rotX = useStoreSelector(
    cameraCtxForRot?.store ?? FALLBACK_CAMERA_STORE,
    (s) => s.cameraState.rotX,
  );
  const rotY = useStoreSelector(
    cameraCtxForRot?.store ?? FALLBACK_CAMERA_STORE,
    (s) => s.cameraState.rotY,
  );

  // Per-arrow hover + dragging state. Lifted here so both the React
  // PolyMesh.onPointerDown handler and the cameraEl JS hit-test
  // fallback can keep them in sync. Each render re-evaluates which
  // arrow is hot, and TranslateArrow paints its polygons at the
  // matching alpha (idle / hover / drag).
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  // Pin everything the cameraEl fallback listener needs. The listener
  // is attached once per cameraEl identity and reads through the refs,
  // so prop changes don't re-bind window listeners during a drag.
  const cameraCtx = useContext(PolyCameraContext);
  const cameraElRef = cameraCtx?.cameraElRef;
  const dragRef = useRef<{
    target: PolyMeshHandle | null;
    mode: "translate" | "rotate";
    shaftLengthCss: number;
    enabled: boolean;
    show: { x: boolean; y: boolean; z: boolean };
    translationSnap: number | null;
    rotationSnap: number | null;
    onChange?: () => void;
    onObjectChange?: (event: PolyTransformControlsObjectChangeEvent) => void;
    onMouseDown?: () => void;
    onMouseUp?: () => void;
    onDraggingChanged?: (dragging: boolean) => void;
  }>({
    target: null,
    mode: "translate",
    shaftLengthCss: 0,
    enabled: true,
    show: { x: true, y: true, z: true },
    translationSnap: null,
    rotationSnap: null,
  });

  // cameraEl JS hit-test fallback. Native polygon hit-testing handles
  // the common case (PolyMesh.onPointerDown fires when an arrow's
  // `<i>` is clicked), but if something upstream forces
  // `pointer-events: none` on polycss elements, OR `border-shape`
  // clipping suppresses the click on the visible-but-transparent
  // corners of an arrow rect, the click falls through to cameraEl.
  // This bubble-phase listener catches those misses, walks the six
  // arrow elements testing each polygon's bounding rect against the
  // click point, and dispatches the same `startAxisDrag`.
  //
  // Skips events whose target is already inside an arrow PolyMesh —
  // those will trigger the per-arrow handler shortly via React
  // synthetic dispatch; falling through here would double-fire.
  useEffect(() => {
    const cameraEl = cameraElRef?.current;
    if (!cameraEl) return;
    const onPointerDown = (event: PointerEvent): void => {
      const state = dragRef.current;
      if (!state.target || !state.enabled) return;
      const targetEl = event.target as Element | null;
      // Don't double-fire when the click already hit one of our gizmo
      // PolyMeshes — React's per-arrow/per-ring synthetic handler will
      // pick it up. The shared `polycss-transform-gizmo` class is set
      // on both translate arrows and rotate rings.
      if (targetEl?.closest(".polycss-transform-gizmo")) return;
      if (state.mode === "translate") {
        // Plane handles hit-tested FIRST so they win over arrow shafts at
        // overlapping corners.
        for (const spec of PLANE_SPECS) {
          const aL = (["x", "y", "z"] as const)[spec.axisA];
          const bL = (["x", "y", "z"] as const)[spec.axisB];
          if (!state.show[aL] || !state.show[bL]) continue;
          const planeEl = document.querySelector(
            `.polycss-transform-plane--${spec.key}`,
          ) as HTMLElement | null;
          if (!planeEl) continue;
          if (!pointInMeshElement(planeEl, event.clientX, event.clientY)) continue;
          event.preventDefault();
          event.stopPropagation();
          const wrapper = planeEl.closest(
            "[data-poly-transform-controls]",
          ) as HTMLElement | null;
          if (!wrapper) return;
          setDraggingKey(spec.key);
          startPlaneDrag({
            axisA: spec.axisA,
            axisB: spec.axisB,
            probeDistanceCss: state.shaftLengthCss,
            wrapper,
            target: state.target,
            startClientX: event.clientX,
            startClientY: event.clientY,
            translationSnap: state.translationSnap,
            onChange: state.onChange,
            onObjectChange: state.onObjectChange,
            onMouseDown: state.onMouseDown,
            onMouseUp: state.onMouseUp,
            onDraggingChanged: (d) => {
              if (!d) setDraggingKey(null);
              state.onDraggingChanged?.(d);
            },
          });
          return;
        }
        for (const spec of ARROW_SPECS) {
          if (!state.show[userAxisLetterOf(spec.key)]) continue;
          const arrowEl = document.querySelector(
            `.polycss-transform-arrow--${spec.key}`,
          ) as HTMLElement | null;
          if (!arrowEl) continue;
          if (!pointInMeshElement(arrowEl, event.clientX, event.clientY)) continue;
          event.preventDefault();
          event.stopPropagation();
          const wrapper = arrowEl.closest(
            "[data-poly-transform-controls]",
          ) as HTMLElement | null;
          if (!wrapper) return;
          setDraggingKey(spec.key);
          startAxisDrag({
            cssAxis: spec.cssAxis,
            sign: spec.sign,
            shaftLengthCss: state.shaftLengthCss,
            wrapper,
            target: state.target,
            startClientX: event.clientX,
            startClientY: event.clientY,
            translationSnap: state.translationSnap,
            onChange: state.onChange,
            onObjectChange: state.onObjectChange,
            onMouseDown: state.onMouseDown,
            onMouseUp: state.onMouseUp,
            onDraggingChanged: (d) => {
              if (!d) setDraggingKey(null);
              state.onDraggingChanged?.(d);
            },
          });
          return;
        }
      } else if (state.mode === "rotate") {
        for (const spec of RING_SPECS) {
          if (!state.show[spec.key as "x" | "y" | "z"]) continue;
          const ringEl = document.querySelector(
            `.polycss-transform-ring--${spec.key}`,
          ) as HTMLElement | null;
          if (!ringEl) continue;
          // Regular bbox-containment hit. The visible donut mask is only
          // decoration — the WHOLE ring quad bbox is clickable so the rings
          // are easy to land on. Clicks inside the inner hole also trigger
          // rotation; selecting the wrapped mesh is done via clicks outside
          // any ring's bbox (or via the Scene panel).
          if (!pointInMeshElement(ringEl, event.clientX, event.clientY)) continue;
          event.preventDefault();
          event.stopPropagation();
          const wrapper = ringEl.closest(
            "[data-poly-transform-controls]",
          ) as HTMLElement | null;
          if (!wrapper) return;
          setDraggingKey(spec.key);
          startRingDrag({
            cssAxis: spec.cssAxis,
            wrapper,
            target: state.target,
            startClientX: event.clientX,
            startClientY: event.clientY,
            rotationSnap: state.rotationSnap,
            onChange: state.onChange,
            onObjectChange: state.onObjectChange,
            onMouseDown: state.onMouseDown,
            onMouseUp: state.onMouseUp,
            onDraggingChanged: (d) => {
              if (!d) setDraggingKey(null);
              state.onDraggingChanged?.(d);
            },
          });
          return;
        }
      }
    };
    cameraEl.addEventListener("pointerdown", onPointerDown);
    return () => cameraEl.removeEventListener("pointerdown", onPointerDown);
  }, [cameraElRef]);

  const target = resolveObject(object);
  if (!target) return null;

  const position = target.getPosition() ?? ([0, 0, 0] as Vec3);
  const polygons = target.getPolygons();
  const bboxCenter = gizmoCenterForMesh(polygons);
  // Mesh wrapper pivots around `bboxCenter` via `transform-origin`, so the
  // visible center stays at `position + bboxCenter` regardless of scale or
  // rotation. The gizmo wrapper sits on the same point. When `autoCenter` is
  // set on PolyMesh, bboxCenter collapses to (0,0,0) and this is a no-op.
  const wrapperPos: Vec3 = [
    position[0] + bboxCenter[0],
    position[1] + bboxCenter[1],
    position[2] + bboxCenter[2],
  ];
  const baseLength = gizmoLengthForMesh(polygons);
  const shaftLengthCss = baseLength * size;

  dragRef.current = {
    target,
    mode,
    shaftLengthCss,
    enabled,
    show: { x: showX, y: showY, z: showZ },
    translationSnap,
    rotationSnap,
    onChange,
    onObjectChange,
    onMouseDown,
    onMouseUp,
    onDraggingChanged,
  };

  // Gizmo stays at world-axis orientation (NOT rotated with the mesh). This
  // keeps the arrows in fixed screen positions so panning + repeated drags
  // stay predictable. The MATH still composes rotations correctly — see
  // `startRingDrag` for the world-frame quaternion compose.
  const wrapperStyle: CSSProperties = {
    transform: `translate3d(${wrapperPos[0]}px, ${wrapperPos[1]}px, ${wrapperPos[2]}px)`,
    position: "absolute",
    transformStyle: "preserve-3d",
    // No `pointer-events: none` here — that property is inherited, so
    // setting it on the wrapper would cascade to every arrow polygon
    // and disable native hit-testing on the gizmo entirely. The
    // wrapper is a 0×0 anchor so it has no surface to be hit on its
    // own; descendants opt in via the default `auto`.
    zIndex: 1000,
  };

  return (
    <div
      className="polycss-transform-controls"
      data-poly-transform-controls
      data-poly-mode={mode}
      data-poly-space={space}
      style={wrapperStyle}
    >
      {mode === "translate" && ARROW_SPECS.map((spec) => {
        const show = { x: showX, y: showY, z: showZ }[userAxisLetterOf(spec.key)];
        if (!show) return null;
        const hovered = hoveredKey === spec.key;
        const dragging = draggingKey === spec.key;
        const alpha = dragging ? ALPHA_DRAGGING : hovered ? ALPHA_HOVER : ALPHA_IDLE;
        const backFacing = isAxisBackFacing(spec.cssAxis, spec.sign, rotX, rotY);
        return (
          <TranslateArrow
            key={spec.key}
            cssAxis={spec.cssAxis}
            sign={spec.sign}
            axisKey={spec.key}
            color={withAlpha(spec.color, alpha)}
            shaftLengthCss={shaftLengthCss}
            includeShaft={!backFacing}
            target={target}
            enabled={enabled}
            translationSnap={translationSnap}
            onChange={onChange}
            onObjectChange={onObjectChange}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onDraggingChanged={onDraggingChanged}
            onHoverChange={(h) => setHoveredKey(h ? spec.key : (cur) => (cur === spec.key ? null : cur))}
            onDraggingStart={() => setDraggingKey(spec.key)}
            onDraggingStop={() => setDraggingKey((cur) => (cur === spec.key ? null : cur))}
          />
        );
      })}
      {mode === "translate" && PLANE_SPECS.map((spec) => {
        const aLetter = (["x", "y", "z"] as const)[spec.axisA];
        const bLetter = (["x", "y", "z"] as const)[spec.axisB];
        const show = ({ x: showX, y: showY, z: showZ }[aLetter])
          && ({ x: showX, y: showY, z: showZ }[bLetter]);
        if (!show) return null;
        const hovered = hoveredKey === spec.key;
        const dragging = draggingKey === spec.key;
        const alpha = dragging ? ALPHA_DRAGGING : hovered ? ALPHA_HOVER : ALPHA_IDLE;
        return (
          <TranslatePlane
            key={spec.key}
            axisA={spec.axisA}
            axisB={spec.axisB}
            perpAxis={spec.perpAxis}
            planeKey={spec.key}
            color={withAlpha(spec.color, alpha)}
            shaftLengthCss={shaftLengthCss}
            rotX={rotX}
            rotY={rotY}
            target={target}
            enabled={enabled}
            translationSnap={translationSnap}
            onChange={onChange}
            onObjectChange={onObjectChange}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onDraggingChanged={onDraggingChanged}
            onHoverChange={(h) => setHoveredKey(h ? spec.key : (cur) => (cur === spec.key ? null : cur))}
            onDraggingStart={() => setDraggingKey(spec.key)}
            onDraggingStop={() => setDraggingKey((cur) => (cur === spec.key ? null : cur))}
          />
        );
      })}
      {mode === "rotate" && RING_SPECS.map((spec) => {
        const show = { x: showX, y: showY, z: showZ }[spec.key as "x" | "y" | "z"];
        if (!show) return null;
        const hovered = hoveredKey === spec.key;
        const dragging = draggingKey === spec.key;
        const alpha = dragging ? ALPHA_DRAGGING : hovered ? ALPHA_HOVER : ALPHA_IDLE;
        return (
          <RotateRing
            key={spec.key}
            cssAxis={spec.cssAxis}
            axisKey={spec.key}
            color={withAlpha(spec.color, alpha)}
            radiusCss={shaftLengthCss * RING_RADIUS_RATIO}
            target={target}
            enabled={enabled}
            rotationSnap={rotationSnap}
            onChange={onChange}
            onObjectChange={onObjectChange}
            onMouseDown={onMouseDown}
            onMouseUp={onMouseUp}
            onDraggingChanged={onDraggingChanged}
            onHoverChange={(h) => setHoveredKey(h ? spec.key : (cur) => (cur === spec.key ? null : cur))}
            onDraggingStart={() => setDraggingKey(spec.key)}
            onDraggingStop={() => setDraggingKey((cur) => (cur === spec.key ? null : cur))}
          />
        );
      })}
    </div>
  );
}

interface TranslateArrowProps {
  cssAxis: 0 | 1 | 2;
  sign: 1 | -1;
  axisKey: string;
  color: string;
  shaftLengthCss: number;
  /** Emit the shaft cuboid. Caller sets false when this arrow is on the
   *  camera-facing-away side of an axis pair, leaving just the head. */
  includeShaft: boolean;
  target: PolyMeshHandle;
  enabled: boolean;
  translationSnap: number | null;
  onChange?: () => void;
  onObjectChange?: (event: PolyTransformControlsObjectChangeEvent) => void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onDraggingChanged?: (dragging: boolean) => void;
  /** Local hover-state notifications, lifted to the parent so it can
   *  mark the right arrow as hovered without per-arrow render plumbing. */
  onHoverChange?: (hovered: boolean) => void;
  onDraggingStart?: () => void;
  onDraggingStop?: () => void;
}

function TranslateArrow({
  cssAxis,
  sign,
  axisKey,
  color,
  shaftLengthCss,
  includeShaft,
  target,
  enabled,
  translationSnap,
  onChange,
  onObjectChange,
  onMouseDown,
  onMouseUp,
  onDraggingChanged,
  onHoverChange,
  onDraggingStart,
  onDraggingStop,
}: TranslateArrowProps) {
  // Pin callback refs so the pointerdown handler always reads fresh
  // closures without re-binding window listeners.
  const cbRef = useRef({
    onChange,
    onObjectChange,
    onMouseDown,
    onMouseUp,
    onDraggingChanged,
    onDraggingStart,
    onDraggingStop,
    enabled,
    translationSnap,
  });
  cbRef.current = {
    onChange,
    onObjectChange,
    onMouseDown,
    onMouseUp,
    onDraggingChanged,
    onDraggingStart,
    onDraggingStop,
    enabled,
    translationSnap,
  };

  // Build the polygon geometry. Vertex coords are in WORLD units; the
  // scene multiplies by tileSize when rendering, so the arrow ends up
  // `shaftLengthCss` scene-CSS pixels long. Convert from CSS axis to
  // world axis here — the rest of the component (probe, drag math)
  // operates in CSS coords.
  const polygons = useMemo<Polygon[]>(() => {
    const lengthWorld = shaftLengthCss / SCENE_TILE_SIZE;
    return arrowPolygons({
      axis: WORLD_AXIS_FOR_CSS[cssAxis],
      sign,
      shaftLength: lengthWorld,
      shaftHalfThickness: lengthWorld * SHAFT_HALF_THICKNESS_RATIO,
      headLength: lengthWorld * HEAD_LENGTH_RATIO,
      headHalfThickness: lengthWorld * HEAD_HALF_THICKNESS_RATIO,
      color,
      shaft: includeShaft,
    });
  }, [cssAxis, sign, color, shaftLengthCss, includeShaft]);

  const onPointerDown = useCallback(
    (e: PolyPointerEvent<PointerEvent>): void => {
      if (!cbRef.current.enabled) return;
      // Stop propagation BOTH on the polycss event (React tree) AND on
      // the underlying native event — the latter prevents PolyControls'
      // camera-drag bubble listener on .polycss-camera from starting a
      // rotation in parallel with our axis drag, and also signals the
      // gizmo's own cameraEl fallback listener (in TransformControls)
      // not to redundantly start a second drag.
      e.stopPropagation();
      const meshEl = e.eventObject.element;
      const wrapper = meshEl?.closest("[data-poly-transform-controls]") as HTMLElement | null;
      if (!wrapper) return;
      cbRef.current.onDraggingStart?.();
      startAxisDrag({
        cssAxis,
        sign,
        shaftLengthCss,
        wrapper,
        target,
        startClientX: e.nativeEvent.clientX,
        startClientY: e.nativeEvent.clientY,
        translationSnap: cbRef.current.translationSnap,
        onChange: cbRef.current.onChange,
        onObjectChange: cbRef.current.onObjectChange,
        onMouseDown: cbRef.current.onMouseDown,
        onMouseUp: cbRef.current.onMouseUp,
        onDraggingChanged: (d) => {
          if (!d) cbRef.current.onDraggingStop?.();
          cbRef.current.onDraggingChanged?.(d);
        },
      });
    },
    [cssAxis, sign, target, shaftLengthCss],
  );

  // Render the arrow as a <PolyMesh> directly under
  // .polycss-transform-controls — no intermediate wrapper. An extra
  // <div> between PolyScene and PolyMesh flattens the 3D context (the
  // intermediate generates its own group and composites its children
  // as a flat bitmap before drawing into the scene's 3D space), so the
  // cuboid shaft + pyramid head end up as a single 2D strip even
  // though every polygon has a real matrix3d transform. Hanging axis
  // identification on the PolyMesh wrapper via className keeps the
  // 3D chain unbroken while still giving us a queryable marker.
  return (
    <PolyMesh
      polygons={polygons}
      onPointerDown={onPointerDown}
      onPointerOver={() => onHoverChange?.(true)}
      onPointerOut={() => onHoverChange?.(false)}
      className={`polycss-transform-gizmo polycss-transform-arrow polycss-transform-arrow--${axisKey}`}
      // Force baked rendering: in dynamic mode every color change
      // (hover / drag) re-builds the texture atlas asynchronously,
      // and the polygon `<i>`'s background-image briefly resolves to
      // null mid-rebuild — visually the arrow disappears for a frame.
      // Baked mode renders solid polygons via inline `color` / currentColor
      // (TextureBorderShapePoly path) which updates synchronously
      // with no atlas hop, giving instant hover/drag feedback.
      textureLighting="baked"
    />
  );
}

interface TranslatePlaneProps {
  axisA: 0 | 1 | 2;
  axisB: 0 | 1 | 2;
  perpAxis: 0 | 1 | 2;
  planeKey: "xy" | "xz" | "yz";
  color: string;
  shaftLengthCss: number;
  /** Scene rotation (degrees) used to pick the camera-facing octant for
   *  the plane handle. */
  rotX: number;
  rotY: number;
  target: PolyMeshHandle;
  enabled: boolean;
  translationSnap: number | null;
  onChange?: () => void;
  onObjectChange?: (event: PolyTransformControlsObjectChangeEvent) => void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onDraggingChanged?: (dragging: boolean) => void;
  onHoverChange?: (hovered: boolean) => void;
  onDraggingStart?: () => void;
  onDraggingStop?: () => void;
}

function TranslatePlane({
  axisA,
  axisB,
  perpAxis,
  planeKey,
  color,
  shaftLengthCss,
  rotX,
  rotY,
  target,
  enabled,
  translationSnap,
  onChange,
  onObjectChange,
  onMouseDown,
  onMouseUp,
  onDraggingChanged,
  onHoverChange,
  onDraggingStart,
  onDraggingStop,
}: TranslatePlaneProps) {
  const cbRef = useRef({
    onChange, onObjectChange, onMouseDown, onMouseUp,
    onDraggingChanged, onDraggingStart, onDraggingStop, enabled, translationSnap,
  });
  cbRef.current = {
    onChange, onObjectChange, onMouseDown, onMouseUp,
    onDraggingChanged, onDraggingStart, onDraggingStop, enabled, translationSnap,
  };

  const polygons = useMemo<Polygon[]>(() => {
    const lengthWorld = shaftLengthCss / SCENE_TILE_SIZE;
    // Place the quad in the camera-facing octant: for each in-plane axis,
    // flip the offset if its CSS +direction is back-facing the viewer.
    // planePolygons uses WORLD axes (a/b derived from perp); WORLD_AXIS_FOR_CSS
    // is involutive so the CSS axis we test is WORLD_AXIS_FOR_CSS[worldA].
    const worldPerp = WORLD_AXIS_FOR_CSS[perpAxis];
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
  }, [perpAxis, color, shaftLengthCss, rotX, rotY]);

  const onPointerDown = useCallback(
    (e: PolyPointerEvent<PointerEvent>): void => {
      if (!cbRef.current.enabled) return;
      e.stopPropagation();
      const meshEl = e.eventObject.element;
      const wrapper = meshEl?.closest("[data-poly-transform-controls]") as HTMLElement | null;
      if (!wrapper) return;
      cbRef.current.onDraggingStart?.();
      startPlaneDrag({
        axisA,
        axisB,
        probeDistanceCss: shaftLengthCss,
        wrapper,
        target,
        startClientX: e.nativeEvent.clientX,
        startClientY: e.nativeEvent.clientY,
        translationSnap: cbRef.current.translationSnap,
        onChange: cbRef.current.onChange,
        onObjectChange: cbRef.current.onObjectChange,
        onMouseDown: cbRef.current.onMouseDown,
        onMouseUp: cbRef.current.onMouseUp,
        onDraggingChanged: (d) => {
          if (!d) cbRef.current.onDraggingStop?.();
          cbRef.current.onDraggingChanged?.(d);
        },
      });
    },
    [axisA, axisB, target, shaftLengthCss],
  );

  return (
    <PolyMesh
      polygons={polygons}
      onPointerDown={onPointerDown}
      onPointerOver={() => onHoverChange?.(true)}
      onPointerOut={() => onHoverChange?.(false)}
      className={`polycss-transform-gizmo polycss-transform-plane polycss-transform-plane--${planeKey}`}
      textureLighting="baked"
    />
  );
}

interface RotateRingProps {
  cssAxis: 0 | 1 | 2;
  axisKey: string;
  color: string;
  radiusCss: number;
  target: PolyMeshHandle;
  enabled: boolean;
  rotationSnap: number | null;
  onChange?: () => void;
  onObjectChange?: (event: PolyTransformControlsObjectChangeEvent) => void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onDraggingChanged?: (dragging: boolean) => void;
  onHoverChange?: (hovered: boolean) => void;
  onDraggingStart?: () => void;
  onDraggingStop?: () => void;
}

function RotateRing({
  cssAxis,
  axisKey,
  color,
  radiusCss,
  target,
  enabled,
  rotationSnap,
  onChange,
  onObjectChange,
  onMouseDown,
  onMouseUp,
  onDraggingChanged,
  onHoverChange,
  onDraggingStart,
  onDraggingStop,
}: RotateRingProps) {
  const cbRef = useRef({
    onChange,
    onObjectChange,
    onMouseDown,
    onMouseUp,
    onDraggingChanged,
    onDraggingStart,
    onDraggingStop,
    enabled,
    rotationSnap,
  });
  cbRef.current = {
    onChange,
    onObjectChange,
    onMouseDown,
    onMouseUp,
    onDraggingChanged,
    onDraggingStart,
    onDraggingStop,
    enabled,
    rotationSnap,
  };

  // Single square quad covering the ring's outer bounding box; CSS mask
  // (`mask: radial-gradient(...)`) clips it to the donut shape. The mask
  // reads `--ring-inner-ratio` so the donut's inner cutout scales with our
  // chosen RING_HALF_THICKNESS_RATIO without hardcoding it in CSS. One DOM
  // node per ring instead of `segments` segment quads.
  const polygons = useMemo<Polygon[]>(() => {
    const radiusWorld = radiusCss / SCENE_TILE_SIZE;
    const outerWorld = radiusWorld * RING_QUAD_OUTER_RATIO;
    return ringQuadPolygons({
      axis: WORLD_AXIS_FOR_CSS[cssAxis],
      outerRadius: outerWorld,
      color,
    });
  }, [cssAxis, color, radiusCss]);
  // Visible band start/end as fractions of the quad edge. The quad covers
  // ±RING_QUAD_OUTER_RATIO · mid-radius; the visible ring is mid ±
  // halfThickness. Normalize against the quad outer to get mask positions.
  const ringInnerRatio = (1 - RING_HALF_THICKNESS_RATIO) / RING_QUAD_OUTER_RATIO;
  const ringOuterRatio = (1 + RING_HALF_THICKNESS_RATIO) / RING_QUAD_OUTER_RATIO;

  const onPointerDown = useCallback(
    (e: PolyPointerEvent<PointerEvent>): void => {
      if (!cbRef.current.enabled) return;
      // No donut hit-test — let any click on the ring's quad bbox start
      // the drag. The whole bbox is the click target so the rings are
      // easy to land on; the visible donut mask is decoration only.
      e.stopPropagation();
      const meshEl = e.eventObject.element;
      const wrapper = meshEl?.closest("[data-poly-transform-controls]") as HTMLElement | null;
      if (!wrapper) return;
      cbRef.current.onDraggingStart?.();
      startRingDrag({
        cssAxis,
        wrapper,
        target,
        startClientX: e.nativeEvent.clientX,
        startClientY: e.nativeEvent.clientY,
        rotationSnap: cbRef.current.rotationSnap,
        onChange: cbRef.current.onChange,
        onObjectChange: cbRef.current.onObjectChange,
        onMouseDown: cbRef.current.onMouseDown,
        onMouseUp: cbRef.current.onMouseUp,
        onDraggingChanged: (d) => {
          if (!d) cbRef.current.onDraggingStop?.();
          cbRef.current.onDraggingChanged?.(d);
        },
      });
    },
    [cssAxis, target],
  );

  return (
    <PolyMesh
      polygons={polygons}
      onPointerDown={onPointerDown}
      onPointerOver={() => onHoverChange?.(true)}
      onPointerOut={() => onHoverChange?.(false)}
      className={`polycss-transform-gizmo polycss-transform-ring polycss-transform-ring--${axisKey}`}
      // CSS variable consumed by the .polycss-transform-ring radial-gradient
      // mask in styles.ts. Carries the donut's inner/outer radius ratio.
      style={{
        ["--ring-inner-ratio" as string]: ringInnerRatio,
        ["--ring-outer-ratio" as string]: ringOuterRatio,
      }}
      // Same baked-mode reasoning as the translate arrows: avoid the
      // dynamic-mode atlas-rebuild flash on hover/drag color changes.
      textureLighting="baked"
    />
  );
}
