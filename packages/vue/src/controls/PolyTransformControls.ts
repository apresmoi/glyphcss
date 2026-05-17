/**
 * `<PolyTransformControls>` (Vue) — drag gizmo for translating / rotating
 * a `<PolyMesh>` along the six axis arrows or three axis rings.
 * Mirrors the React PolyTransformControls API and the vanilla
 * createTransformControls behavior.
 *
 * Geometry: arrows use `arrowPolygons`, rings use `ringPolygons`
 * (both from @layoutit/polycss-core). Each is rendered through a regular
 * `<PolyMesh>` so it composes with the scene's lighting / atlas
 * pipeline. baked mode is forced on the gizmo PolyMeshes so hover/
 * drag color updates are instant (no atlas rebuild flash).
 *
 * Drag math: probe-based screen-axis projection for translate; pointer-
 * angle accumulation for rotate. Same algorithms as the React/vanilla
 * versions.
 */
import {
  defineComponent,
  h,
  inject,
  onBeforeUnmount,
  onMounted,
  ref,
  computed,
  watch,
  type ComputedRef,
  type PropType,
  type Ref,
} from "vue";
import {
  arrowPolygons,
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
import {
  pointInMeshElement,
  type PolyMeshHandle,
  type PolyPointerEvent,
} from "../scene/events";
import { PolyCameraContextKey } from "../camera";

const COLOR_X = "#ff3653";
const COLOR_Y = "#8adb00";
const COLOR_Z = "#2c8fff";

const ALPHA_IDLE = 0.6;
const ALPHA_HOVER = 0.8;
const ALPHA_DRAGGING = 1.0;

const SCENE_TILE_SIZE = 50;
const FALLBACK_SHAFT_LENGTH = 60;
const SHAFT_LENGTH_RATIO = 0.6;
const SHAFT_HALF_THICKNESS_RATIO = 0.0125;
const HEAD_LENGTH_RATIO = 0.15;
const HEAD_HALF_THICKNESS_RATIO = 0.04;
const RING_RADIUS_RATIO = 1.0;
// Thick enough to be an easy click target — matches arrow head half thickness.
const RING_HALF_THICKNESS_RATIO = 0.02;
// Outer radius of the ring's quad polygon as a multiple of mid-radius —
// independent of the visible band thickness, so the click target stays
// generous even when the ring looks thin.
const RING_QUAD_OUTER_RATIO = 1.04;
const PLANE_HALF_SIZE_RATIO = 0.1;
const PLANE_OFFSET_RATIO = 0.25;
const SCREEN_AXIS_DEAD_ZONE_SQ = 0.0001;

const WORLD_AXIS_FOR_CSS: Record<0 | 1 | 2, 0 | 1 | 2> = { 0: 1, 1: 0, 2: 2 };

const ARROW_SPECS: Array<{ cssAxis: 0 | 1 | 2; sign: 1 | -1; key: string; color: string }> = [
  { cssAxis: 0, sign:  1, key:  "x", color: COLOR_X },
  { cssAxis: 0, sign: -1, key: "-x", color: COLOR_X },
  { cssAxis: 1, sign:  1, key:  "y", color: COLOR_Y },
  { cssAxis: 1, sign: -1, key: "-y", color: COLOR_Y },
  { cssAxis: 2, sign:  1, key:  "z", color: COLOR_Z },
  { cssAxis: 2, sign: -1, key: "-z", color: COLOR_Z },
];

const RING_SPECS: Array<{ cssAxis: 0 | 1 | 2; key: string; color: string }> = [
  { cssAxis: 0, key: "x", color: COLOR_X },
  { cssAxis: 1, key: "y", color: COLOR_Y },
  { cssAxis: 2, key: "z", color: COLOR_Z },
];

// Plane color = perpendicular axis color: XY plane → blue (Z), XZ → green
// (Y), YZ → red (X).
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

function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function snap(v: number, step: number | null | undefined): number {
  if (!step || step <= 0) return v;
  return Math.round(v / step) * step;
}

function userAxisLetterOf(key: string): "x" | "y" | "z" {
  return key.replace("-", "")[0] as "x" | "y" | "z";
}


/** True when the signed CSS-space axis points AWAY from the viewer after
 *  the scene's rotateZ(rotY) · rotateX(rotX). Mirrors React's helper. */
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
  const by = a[0] * Math.sin(ry) + a[1] * Math.cos(ry);
  const bz = a[2];
  const cz = by * Math.sin(rx) + bz * Math.cos(rx);
  return cz < 0;
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
  return Math.max(maxX - minX, maxY - minY, maxZ - minZ) * SCENE_TILE_SIZE * SHAFT_LENGTH_RATIO;
}

/** Polygon bbox center in scene-CSS pixels, via the standard polycss
 *  world→CSS axis remap (v[1]→x, v[0]→y, v[2]→z). Used to plant the
 *  gizmo wrapper at the mesh's visible center rather than at its
 *  wrapper origin — necessary whenever the mesh's vertices don't sit
 *  on `(0,0,0)` in mesh-local space (e.g. PolyMesh.autoCenter unset). */
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

export interface PolyTransformControlsObjectChangeEvent {
  object: PolyMeshHandle;
  position?: Vec3;
  rotation?: Vec3;
}

export interface PolyTransformControlsProps {
  object: PolyTransformControlsObject;
  mode?: "translate" | "rotate";
  space?: "world" | "local";
  size?: number;
  showX?: boolean;
  showY?: boolean;
  showZ?: boolean;
  translationSnap?: number | null;
  rotationSnap?: number | null;
  enabled?: boolean;
  onChange?: () => void;
  onObjectChange?: (event: PolyTransformControlsObjectChangeEvent) => void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onDraggingChanged?: (dragging: boolean) => void;
}

interface AxisDragOptions {
  cssAxis: 0 | 1 | 2;
  sign: 1 | -1;
  shaftLengthCss: number;
  wrapper: HTMLElement;
  target: PolyMeshHandle;
  startClientX: number;
  startClientY: number;
  translationSnap: number | null;
  onChange?: () => void;
  onObjectChange?: (e: PolyTransformControlsObjectChangeEvent) => void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onDraggingChanged?: (d: boolean) => void;
}

function startAxisDrag(opts: AxisDragOptions): void {
  const probeDistance = opts.shaftLengthCss;
  const axisVec: Vec3 = [0, 0, 0];
  axisVec[opts.cssAxis] = opts.sign;
  const probe = opts.wrapper.ownerDocument!.createElement("div");
  probe.style.position = "absolute";
  probe.style.left = "0";
  probe.style.top = "0";
  probe.style.width = "0";
  probe.style.height = "0";
  probe.style.transform = `translate3d(${axisVec[0] * probeDistance}px, ${axisVec[1] * probeDistance}px, ${axisVec[2] * probeDistance}px)`;
  opts.wrapper.appendChild(probe);
  const wRect = opts.wrapper.getBoundingClientRect();
  const pRect = probe.getBoundingClientRect();
  opts.wrapper.removeChild(probe);
  const screenAxisX = (pRect.left - wRect.left) / probeDistance;
  const screenAxisY = (pRect.top - wRect.top) / probeDistance;
  const screenAxisLenSq = screenAxisX * screenAxisX + screenAxisY * screenAxisY;
  if (screenAxisLenSq < SCREEN_AXIS_DEAD_ZONE_SQ) return;

  const startPos = (opts.target.getPosition() ?? [0, 0, 0]) as Vec3;
  opts.onMouseDown?.();
  opts.onDraggingChanged?.(true);

  const handleMove = (ev: PointerEvent): void => {
    const dx = ev.clientX - opts.startClientX;
    const dy = ev.clientY - opts.startClientY;
    let t = (dx * screenAxisX + dy * screenAxisY) / screenAxisLenSq;
    t = snap(t, opts.translationSnap);
    const newPos: Vec3 = [
      startPos[0] + t * axisVec[0],
      startPos[1] + t * axisVec[1],
      startPos[2] + t * axisVec[2],
    ];
    opts.onObjectChange?.({ object: opts.target, position: newPos });
    opts.onChange?.();
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
    opts.onMouseUp?.();
    opts.onDraggingChanged?.(false);
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
  onChange?: () => void;
  onObjectChange?: (e: PolyTransformControlsObjectChangeEvent) => void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onDraggingChanged?: (d: boolean) => void;
}

/** Planar drag: probe both in-plane axes for their screen projections,
 *  then solve a 2x2 system per move and apply position deltas along both
 *  axes simultaneously. Mirror of vanilla `startPlaneDrag`. */
function startPlaneDrag(opts: PlaneDragOptions): void {
  const axisAVec: Vec3 = [0, 0, 0]; axisAVec[opts.axisA] = 1;
  const axisBVec: Vec3 = [0, 0, 0]; axisBVec[opts.axisB] = 1;
  const probeDistance = opts.probeDistanceCss;
  function probe(axisVec: Vec3): { x: number; y: number } {
    const el = opts.wrapper.ownerDocument!.createElement("div");
    el.style.position = "absolute";
    el.style.left = "0";
    el.style.top = "0";
    el.style.width = "0";
    el.style.height = "0";
    el.style.transform = `translate3d(${axisVec[0] * probeDistance}px, ${axisVec[1] * probeDistance}px, ${axisVec[2] * probeDistance}px)`;
    opts.wrapper.appendChild(el);
    const wR = opts.wrapper.getBoundingClientRect();
    const pR = el.getBoundingClientRect();
    opts.wrapper.removeChild(el);
    return {
      x: (pR.left - wR.left) / probeDistance,
      y: (pR.top - wR.top) / probeDistance,
    };
  }
  const pA = probe(axisAVec);
  const pB = probe(axisBVec);
  const det = pA.x * pB.y - pB.x * pA.y;
  if (Math.abs(det) < SCREEN_AXIS_DEAD_ZONE_SQ) return;

  const startPos = (opts.target.getPosition() ?? [0, 0, 0]) as Vec3;
  opts.onMouseDown?.();
  opts.onDraggingChanged?.(true);

  const handleMove = (ev: PointerEvent): void => {
    const dx = ev.clientX - opts.startClientX;
    const dy = ev.clientY - opts.startClientY;
    let tA = (pB.y * dx - pB.x * dy) / det;
    let tB = (-pA.y * dx + pA.x * dy) / det;
    tA = snap(tA, opts.translationSnap);
    tB = snap(tB, opts.translationSnap);
    const next: Vec3 = [
      startPos[0] + tA * axisAVec[0] + tB * axisBVec[0],
      startPos[1] + tA * axisAVec[1] + tB * axisBVec[1],
      startPos[2] + tA * axisAVec[2] + tB * axisBVec[2],
    ];
    opts.onObjectChange?.({ object: opts.target, position: next });
    opts.onChange?.();
  };
  const handleUp = (): void => {
    window.removeEventListener("pointermove", handleMove);
    window.removeEventListener("pointerup", handleUp);
    window.removeEventListener("pointercancel", handleUp);
    opts.onMouseUp?.();
    opts.onDraggingChanged?.(false);
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
  onChange?: () => void;
  onObjectChange?: (e: PolyTransformControlsObjectChangeEvent) => void;
  onMouseDown?: () => void;
  onMouseUp?: () => void;
  onDraggingChanged?: (d: boolean) => void;
}

function startRingDrag(opts: RingDragOptions): void {
  const wRect = opts.wrapper.getBoundingClientRect();
  const centerX = wRect.left;
  const centerY = wRect.top;
  let lastAngle = Math.atan2(opts.startClientY - centerY, opts.startClientX - centerX);
  let cumulative = 0;
  const startRot = (opts.target.getRotation() ?? [0, 0, 0]) as Vec3;
  // See React's RingDrag: snapshot Qstart, right-multiply Qdelta around
  // the ring's CSS axis to compose in the mesh's LOCAL frame. Plain
  // Euler-add breaks for repeated / non-XYZ-order ring drags.
  const qStart = quatFromEulerXYZ(startRot);
  opts.onMouseDown?.();
  opts.onDraggingChanged?.(true);
  const handleMove = (ev: PointerEvent): void => {
    const a = Math.atan2(ev.clientY - centerY, ev.clientX - centerX);
    let d = a - lastAngle;
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    cumulative += d;
    lastAngle = a;
    let degrees = (cumulative * 180) / Math.PI;
    degrees = snap(degrees, opts.rotationSnap);
    const axisVec: Vec3 = [0, 0, 0];
    axisVec[opts.cssAxis] = 1;
    const qDelta = quatFromAxisAngle(axisVec, (degrees * Math.PI) / 180);
    // World-frame compose (pre-mult): rings stay at world axes visually,
    // so each ring drag rotates around the world axis the ring points to,
    // cumulatively on top of the mesh's current orientation.
    const next = eulerXYZFromQuat(quatMultiply(qDelta, qStart));
    opts.onObjectChange?.({ object: opts.target, rotation: next });
    opts.onChange?.();
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
    opts.onMouseUp?.();
    opts.onDraggingChanged?.(false);
    opts.target.rebakeAtlas();
  };
  window.addEventListener("pointermove", handleMove);
  window.addEventListener("pointerup", handleUp);
  window.addEventListener("pointercancel", handleUp);
}

/** `object` prop: either a PolyMeshHandle directly or a Vue ref to one
 *  (e.g. a template ref via `:object="meshRef"`). */
export type PolyTransformControlsObject =
  | PolyMeshHandle
  | Ref<PolyMeshHandle | null | undefined>
  | ComputedRef<PolyMeshHandle | null | undefined>
  | null;

function isVueRef(x: unknown): x is Ref<PolyMeshHandle | null | undefined> {
  return !!x && typeof x === "object" && "value" in (x as object);
}

function resolveObject(o: PolyTransformControlsObject): PolyMeshHandle | null {
  if (!o) return null;
  if (isVueRef(o)) return o.value ?? null;
  return o;
}

export const PolyTransformControls = defineComponent({
  name: "PolyTransformControls",
  props: {
    object: { type: null as unknown as PropType<PolyTransformControlsObject>, default: null },
    mode: { type: String as PropType<"translate" | "rotate">, default: "translate" },
    space: { type: String as PropType<"world" | "local">, default: "world" },
    size: { type: Number, default: 1 },
    showX: { type: Boolean, default: true },
    showY: { type: Boolean, default: true },
    showZ: { type: Boolean, default: true },
    translationSnap: { type: Number as PropType<number | null>, default: null },
    rotationSnap: { type: Number as PropType<number | null>, default: null },
    enabled: { type: Boolean, default: true },
  },
  emits: {
    change: () => true,
    objectChange: (_e: PolyTransformControlsObjectChangeEvent) => true,
    mouseDown: () => true,
    mouseUp: () => true,
    draggingChanged: (_d: boolean) => true,
  },
  setup(props, { emit }) {
    const hoveredKey = ref<string | null>(null);
    const draggingKey = ref<string | null>(null);
    const arrowRefs = ref(new Map<string, PolyMeshHandle>());

    const target = computed(() => resolveObject(props.object));

    // Force one re-render after mount so a ref-based `object` prop
    // (whose `.value` lands AFTER first render) gets picked up.
    const tick = ref(0);
    onMounted(() => { tick.value++; });

    // Subscribe to camera state so back-facing arrow geometry re-evaluates
    // when the user orbits the camera. cameraTick is read inside arrowEntries
    // so the computed re-runs on every camera change.
    const cameraTick = ref(0);
    const cameraCtxForRot = inject(PolyCameraContextKey, undefined);
    let unsubscribeCamera: (() => void) | null = null;
    onMounted(() => {
      const store = cameraCtxForRot?.store;
      if (!store) return;
      unsubscribeCamera = store.subscribe(() => { cameraTick.value++; });
    });
    onBeforeUnmount(() => { unsubscribeCamera?.(); });
    function currentRot(): { rotX: number; rotY: number } {
      void cameraTick.value;
      const s = cameraCtxForRot?.store.getState().cameraState;
      return { rotX: s?.rotX ?? 65, rotY: s?.rotY ?? 45 };
    }

    const baseLength = computed(() => {
      void tick.value; // re-evaluate after first render so target.polygons resolves
      return gizmoLengthForMesh(target.value?.getPolygons() ?? []);
    });
    const shaftLengthCss = computed(() => baseLength.value * props.size);

    function alphaFor(key: string): number {
      if (draggingKey.value === key) return ALPHA_DRAGGING;
      if (hoveredKey.value === key) return ALPHA_HOVER;
      return ALPHA_IDLE;
    }

    function emitChange(): void { emit("change"); }
    function emitObjectChange(e: PolyTransformControlsObjectChangeEvent): void { emit("objectChange", e); }
    function emitDragging(d: boolean): void { emit("draggingChanged", d); }
    function emitMouseDown(): void { emit("mouseDown"); }
    function emitMouseUp(): void { emit("mouseUp"); }

    // cameraEl JS hit-test fallback for clicks that fall through the
    // gizmo polygons (border-shape clipping or external pointer-events
    // overrides). Same pattern as React/vanilla.
    const cameraCtx = inject(PolyCameraContextKey, undefined);
    let detach: (() => void) | null = null;
    onMounted(() => {
      const cameraEl = cameraCtx?.cameraElRef.value;
      if (!cameraEl) return;
      const onPointerDown = (event: PointerEvent): void => {
        const t = target.value;
        if (!t || !props.enabled) return;
        const targetEl = event.target as Element | null;
        if (targetEl?.closest(".polycss-transform-gizmo")) return;
        const showByKey = { x: props.showX, y: props.showY, z: props.showZ };
        if (props.mode === "translate") {
          // Plane handles hit-tested first so they win at corner overlaps.
          for (const spec of PLANE_SPECS) {
            const aL = (["x", "y", "z"] as const)[spec.axisA];
            const bL = (["x", "y", "z"] as const)[spec.axisB];
            if (!showByKey[aL] || !showByKey[bL]) continue;
            const planeEl = document.querySelector(
              `.polycss-transform-plane--${spec.key}`,
            ) as HTMLElement | null;
            if (!planeEl) continue;
            if (!pointInMeshElement(planeEl, event.clientX, event.clientY)) continue;
            event.preventDefault();
            event.stopPropagation();
            const wrapper = planeEl.closest("[data-poly-transform-controls]") as HTMLElement | null;
            if (!wrapper) return;
            draggingKey.value = spec.key;
            startPlaneDrag({
              axisA: spec.axisA,
              axisB: spec.axisB,
              probeDistanceCss: shaftLengthCss.value,
              wrapper,
              target: t,
              startClientX: event.clientX,
              startClientY: event.clientY,
              translationSnap: props.translationSnap,
              onChange: emitChange,
              onObjectChange: emitObjectChange,
              onMouseDown: emitMouseDown,
              onMouseUp: emitMouseUp,
              onDraggingChanged: (d) => {
                if (!d) draggingKey.value = null;
                emitDragging(d);
              },
            });
            return;
          }
        }
        const specs = props.mode === "translate" ? ARROW_SPECS : RING_SPECS;
        for (const spec of specs) {
          const userAxis = spec.key.replace("-", "")[0] as "x" | "y" | "z";
          if (!showByKey[userAxis]) continue;
          const arrowEl = document.querySelector(
            `.polycss-transform-${props.mode === "translate" ? "arrow" : "ring"}--${spec.key}`,
          ) as HTMLElement | null;
          if (!arrowEl) continue;
          // Rings use donut-shaped hit-testing (CSS mask doesn't block
          // pointer events, so we have to gate clicks here).
          const hit = props.mode === "rotate"
            ? pointInMeshElement(arrowEl, event.clientX, event.clientY)
            : pointInMeshElement(arrowEl, event.clientX, event.clientY);
          if (!hit) continue;
          event.preventDefault();
          event.stopPropagation();
          const wrapper = arrowEl.closest("[data-poly-transform-controls]") as HTMLElement | null;
          if (!wrapper) return;
          draggingKey.value = spec.key;
          if (props.mode === "translate") {
            const arrowSpec = spec as typeof ARROW_SPECS[number];
            startAxisDrag({
              cssAxis: arrowSpec.cssAxis,
              sign: arrowSpec.sign,
              shaftLengthCss: shaftLengthCss.value,
              wrapper,
              target: t,
              startClientX: event.clientX,
              startClientY: event.clientY,
              translationSnap: props.translationSnap,
              onChange: emitChange,
              onObjectChange: emitObjectChange,
              onMouseDown: emitMouseDown,
              onMouseUp: emitMouseUp,
              onDraggingChanged: (d) => {
                if (!d) draggingKey.value = null;
                emitDragging(d);
              },
            });
          } else {
            startRingDrag({
              cssAxis: spec.cssAxis,
              wrapper,
              target: t,
              startClientX: event.clientX,
              startClientY: event.clientY,
              rotationSnap: props.rotationSnap,
              onChange: emitChange,
              onObjectChange: emitObjectChange,
              onMouseDown: emitMouseDown,
              onMouseUp: emitMouseUp,
              onDraggingChanged: (d) => {
                if (!d) draggingKey.value = null;
                emitDragging(d);
              },
            });
          }
          return;
        }
      };
      cameraEl.addEventListener("pointerdown", onPointerDown);
      detach = () => cameraEl.removeEventListener("pointerdown", onPointerDown);
    });
    onBeforeUnmount(() => {
      detach?.();
    });

    // Rebuild geometry caches whenever the visible specs / size /
    // hover / drag change. Computeds keep these reactive without
    // explicit watchers.
    const arrowEntries = computed(() => {
      if (props.mode !== "translate") return [];
      void tick.value;
      const length = shaftLengthCss.value;
      const lengthWorld = length / SCENE_TILE_SIZE;
      const { rotX, rotY } = currentRot();
      return ARROW_SPECS
        .filter((spec) => ({ x: props.showX, y: props.showY, z: props.showZ }[userAxisLetterOf(spec.key)]))
        .map((spec) => {
          const alpha = alphaFor(spec.key);
          const backFacing = isAxisBackFacing(spec.cssAxis, spec.sign, rotX, rotY);
          return {
            spec,
            polygons: arrowPolygons({
              axis: WORLD_AXIS_FOR_CSS[spec.cssAxis],
              sign: spec.sign,
              shaftLength: lengthWorld,
              shaftHalfThickness: lengthWorld * SHAFT_HALF_THICKNESS_RATIO,
              headLength: lengthWorld * HEAD_LENGTH_RATIO,
              headHalfThickness: lengthWorld * HEAD_HALF_THICKNESS_RATIO,
              color: withAlpha(spec.color, alpha),
              shaft: !backFacing,
            }),
          };
        });
    });
    const planeEntries = computed(() => {
      if (props.mode !== "translate") return [];
      void tick.value;
      const length = shaftLengthCss.value;
      const lengthWorld = length / SCENE_TILE_SIZE;
      const show = { x: props.showX, y: props.showY, z: props.showZ };
      const ax = (["x", "y", "z"] as const);
      const { rotX, rotY } = currentRot();
      const mag = lengthWorld * PLANE_OFFSET_RATIO;
      return PLANE_SPECS
        .filter((spec) => show[ax[spec.axisA]] && show[ax[spec.axisB]])
        .map((spec) => {
          const alpha = alphaFor(spec.key);
          // Place the quad in the camera-facing octant — see vanilla/React.
          const worldPerp = WORLD_AXIS_FOR_CSS[spec.perpAxis];
          const worldA = ((worldPerp + 1) % 3) as 0 | 1 | 2;
          const worldB = ((worldPerp + 2) % 3) as 0 | 1 | 2;
          const cssAForOffset = WORLD_AXIS_FOR_CSS[worldA];
          const cssBForOffset = WORLD_AXIS_FOR_CSS[worldB];
          const signA = isAxisBackFacing(cssAForOffset, 1, rotX, rotY) ? -1 : 1;
          const signB = isAxisBackFacing(cssBForOffset, 1, rotX, rotY) ? -1 : 1;
          return {
            spec,
            polygons: planePolygons({
              axis: worldPerp,
              size: lengthWorld * PLANE_HALF_SIZE_RATIO,
              offset: [signA * mag, signB * mag],
              color: withAlpha(spec.color, alpha),
            }),
          };
        });
    });
    const ringEntries = computed(() => {
      if (props.mode !== "rotate") return [];
      void tick.value;
      const length = shaftLengthCss.value;
      const radiusWorld = (length * RING_RADIUS_RATIO) / SCENE_TILE_SIZE;
      const outerWorld = radiusWorld * RING_QUAD_OUTER_RATIO;
      return RING_SPECS
        .filter((spec) => ({ x: props.showX, y: props.showY, z: props.showZ }[spec.key as "x" | "y" | "z"]))
        .map((spec) => {
          const alpha = alphaFor(spec.key);
          // Single square quad masked to a donut via CSS (see
          // .polycss-transform-ring rule in styles.ts).
          return {
            spec,
            polygons: ringQuadPolygons({
              axis: WORLD_AXIS_FOR_CSS[spec.cssAxis],
              outerRadius: outerWorld,
              color: withAlpha(spec.color, alpha),
            }),
          };
        });
    });
    // Visible band start/end as fractions of the quad edge. The quad covers
    // ±RING_QUAD_OUTER_RATIO · mid-radius; the visible ring is mid ±
    // halfThickness. Normalize against the quad outer to get mask positions.
    const ringInnerRatio = (1 - RING_HALF_THICKNESS_RATIO) / RING_QUAD_OUTER_RATIO;
    const ringOuterRatio = (1 + RING_HALF_THICKNESS_RATIO) / RING_QUAD_OUTER_RATIO;

    function makeArrowPointerDown(spec: typeof ARROW_SPECS[number]) {
      return (e: PolyPointerEvent<PointerEvent>): void => {
        if (!props.enabled) return;
        const t = target.value;
        if (!t) return;
        e.stopPropagation();
        const meshEl = e.eventObject.element;
        const wrapper = meshEl?.closest("[data-poly-transform-controls]") as HTMLElement | null;
        if (!wrapper) return;
        draggingKey.value = spec.key;
        startAxisDrag({
          cssAxis: spec.cssAxis,
          sign: spec.sign,
          shaftLengthCss: shaftLengthCss.value,
          wrapper,
          target: t,
          startClientX: e.nativeEvent.clientX,
          startClientY: e.nativeEvent.clientY,
          translationSnap: props.translationSnap,
          onChange: emitChange,
          onObjectChange: emitObjectChange,
          onMouseDown: emitMouseDown,
          onMouseUp: emitMouseUp,
          onDraggingChanged: (d) => {
            if (!d) draggingKey.value = null;
            emitDragging(d);
          },
        });
      };
    }

    function makePlanePointerDown(spec: typeof PLANE_SPECS[number]) {
      return (e: PolyPointerEvent<PointerEvent>): void => {
        if (!props.enabled) return;
        const t = target.value;
        if (!t) return;
        e.stopPropagation();
        const meshEl = e.eventObject.element;
        const wrapper = meshEl?.closest("[data-poly-transform-controls]") as HTMLElement | null;
        if (!wrapper) return;
        draggingKey.value = spec.key;
        startPlaneDrag({
          axisA: spec.axisA,
          axisB: spec.axisB,
          probeDistanceCss: shaftLengthCss.value,
          wrapper,
          target: t,
          startClientX: e.nativeEvent.clientX,
          startClientY: e.nativeEvent.clientY,
          translationSnap: props.translationSnap,
          onChange: emitChange,
          onObjectChange: emitObjectChange,
          onMouseDown: emitMouseDown,
          onMouseUp: emitMouseUp,
          onDraggingChanged: (d) => {
            if (!d) draggingKey.value = null;
            emitDragging(d);
          },
        });
      };
    }

    function makeRingPointerDown(spec: typeof RING_SPECS[number]) {
      return (e: PolyPointerEvent<PointerEvent>): void => {
        if (!props.enabled) return;
        const t = target.value;
        if (!t) return;
        // No donut hit-test — the whole ring quad bbox is the click target
        // so the rings are easy to land on. The donut mask is decoration.
        const meshEl = e.eventObject.element;
        e.stopPropagation();
        const wrapper = meshEl?.closest("[data-poly-transform-controls]") as HTMLElement | null;
        if (!wrapper) return;
        draggingKey.value = spec.key;
        startRingDrag({
          cssAxis: spec.cssAxis,
          wrapper,
          target: t,
          startClientX: e.nativeEvent.clientX,
          startClientY: e.nativeEvent.clientY,
          rotationSnap: props.rotationSnap,
          onChange: emitChange,
          onObjectChange: emitObjectChange,
          onMouseDown: emitMouseDown,
          onMouseUp: emitMouseUp,
          onDraggingChanged: (d) => {
            if (!d) draggingKey.value = null;
            emitDragging(d);
          },
        });
      };
    }

    function makeHoverHandlers(key: string) {
      return {
        onPointerOver: () => { hoveredKey.value = key; },
        onPointerOut: () => { if (hoveredKey.value === key) hoveredKey.value = null; },
      };
    }

    // Suppress unused variable warning — arrowRefs is used by the component
    void arrowRefs;

    return () => {
      const t = target.value;
      if (!t) return null;
      const position = t.getPosition() ?? ([0, 0, 0] as Vec3);
      // Mesh wrapper pivots around `bboxCenter` via `transform-origin`, so
      // its visible bbox center stays at `position + bboxCenter` regardless
      // of scale or rotation. The gizmo wrapper sits on the same point. When
      // PolyMesh autoCenters its vertices, bboxCenter collapses to (0,0,0).
      const bboxCenter = gizmoCenterForMesh(t.getPolygons());
      const wx = position[0] + bboxCenter[0];
      const wy = position[1] + bboxCenter[1];
      const wz = position[2] + bboxCenter[2];
      const wrapperStyle: Record<string, string | number> = {
        transform: `translate3d(${wx}px, ${wy}px, ${wz}px)`,
        position: "absolute",
        transformStyle: "preserve-3d",
        zIndex: 1000,
      };

      const children = props.mode === "translate"
        ? [
            ...arrowEntries.value.map(({ spec, polygons }) =>
              h(PolyMesh, {
                key: `arrow-${spec.key}`,
                polygons,
                class: `polycss-transform-gizmo polycss-transform-arrow polycss-transform-arrow--${spec.key}`,
                textureLighting: "baked",
                onPointerDown: makeArrowPointerDown(spec),
                ...makeHoverHandlers(spec.key),
              }),
            ),
            ...planeEntries.value.map(({ spec, polygons }) =>
              h(PolyMesh, {
                key: `plane-${spec.key}`,
                polygons,
                class: `polycss-transform-gizmo polycss-transform-plane polycss-transform-plane--${spec.key}`,
                textureLighting: "baked",
                onPointerDown: makePlanePointerDown(spec),
                ...makeHoverHandlers(spec.key),
              }),
            ),
          ]
        : ringEntries.value.map(({ spec, polygons }) =>
            h(PolyMesh, {
              key: spec.key,
              polygons,
              class: `polycss-transform-gizmo polycss-transform-ring polycss-transform-ring--${spec.key}`,
              // CSS var read by the .polycss-transform-ring radial-gradient
              // mask to size the donut cutout.
              style: {
                ["--ring-inner-ratio" as string]: ringInnerRatio,
                ["--ring-outer-ratio" as string]: ringOuterRatio,
              },
              textureLighting: "baked",
              onPointerDown: makeRingPointerDown(spec),
              ...makeHoverHandlers(spec.key),
            }),
          );

      return h(
        "div",
        {
          class: "polycss-transform-controls",
          "data-poly-transform-controls": "",
          "data-poly-mode": props.mode,
          "data-poly-space": props.space,
          style: wrapperStyle,
        },
        children,
      );
    };
  },
});
