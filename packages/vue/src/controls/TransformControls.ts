/**
 * `<TransformControls>` (Vue) — drag gizmo for translating / rotating
 * a `<PolyMesh>` along the six axis arrows or three axis rings.
 * Mirrors the React TransformControls API and the vanilla
 * createTransformControls behavior.
 *
 * Geometry: arrows use `arrowPolygons`, rings use `ringPolygons`
 * (both from @polycss/core). Each is rendered through a regular
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
import { arrowPolygons, ringPolygons, type Polygon, type Vec3 } from "@polycss/core";
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
const RING_HALF_THICKNESS_RATIO = 0.012;
const RING_SEGMENTS = 64;
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

export interface TransformControlsObjectChangeEvent {
  object: PolyMeshHandle;
  position?: Vec3;
  rotation?: Vec3;
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
  onObjectChange?: (e: TransformControlsObjectChangeEvent) => void;
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

interface RingDragOptions {
  cssAxis: 0 | 1 | 2;
  wrapper: HTMLElement;
  target: PolyMeshHandle;
  startClientX: number;
  startClientY: number;
  rotationSnap: number | null;
  onChange?: () => void;
  onObjectChange?: (e: TransformControlsObjectChangeEvent) => void;
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
    const next: Vec3 = [startRot[0], startRot[1], startRot[2]];
    next[opts.cssAxis] = startRot[opts.cssAxis] + degrees;
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
export type TransformControlsObject =
  | PolyMeshHandle
  | Ref<PolyMeshHandle | null | undefined>
  | ComputedRef<PolyMeshHandle | null | undefined>
  | null;

function isVueRef(x: unknown): x is Ref<PolyMeshHandle | null | undefined> {
  return !!x && typeof x === "object" && "value" in (x as object);
}

function resolveObject(o: TransformControlsObject): PolyMeshHandle | null {
  if (!o) return null;
  if (isVueRef(o)) return o.value ?? null;
  return o;
}

export const TransformControls = defineComponent({
  name: "TransformControls",
  props: {
    object: { type: null as unknown as PropType<TransformControlsObject>, default: null },
    mode: { type: String as PropType<"translate" | "rotate" | "scale">, default: "translate" },
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
    objectChange: (_e: TransformControlsObjectChangeEvent) => true,
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
    function emitObjectChange(e: TransformControlsObjectChangeEvent): void { emit("objectChange", e); }
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
        const specs = props.mode === "translate" ? ARROW_SPECS : props.mode === "rotate" ? RING_SPECS : [];
        for (const spec of specs) {
          const userAxis = spec.key.replace("-", "")[0] as "x" | "y" | "z";
          if (!showByKey[userAxis]) continue;
          const arrowEl = document.querySelector(
            `.polycss-transform-${props.mode === "translate" ? "arrow" : "ring"}--${spec.key}`,
          ) as HTMLElement | null;
          if (!arrowEl) continue;
          if (!pointInMeshElement(arrowEl, event.clientX, event.clientY)) continue;
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
      return ARROW_SPECS
        .filter((spec) => ({ x: props.showX, y: props.showY, z: props.showZ }[userAxisLetterOf(spec.key)]))
        .map((spec) => {
          const alpha = alphaFor(spec.key);
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
            }),
          };
        });
    });
    const ringEntries = computed(() => {
      if (props.mode !== "rotate") return [];
      void tick.value;
      const length = shaftLengthCss.value;
      const radiusWorld = (length * RING_RADIUS_RATIO) / SCENE_TILE_SIZE;
      return RING_SPECS
        .filter((spec) => ({ x: props.showX, y: props.showY, z: props.showZ }[spec.key as "x" | "y" | "z"]))
        .map((spec) => {
          const alpha = alphaFor(spec.key);
          return {
            spec,
            polygons: ringPolygons({
              axis: WORLD_AXIS_FOR_CSS[spec.cssAxis],
              radius: radiusWorld,
              halfThickness: radiusWorld * RING_HALF_THICKNESS_RATIO,
              segments: RING_SEGMENTS,
              color: withAlpha(spec.color, alpha),
            }),
          };
        });
    });

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

    function makeRingPointerDown(spec: typeof RING_SPECS[number]) {
      return (e: PolyPointerEvent<PointerEvent>): void => {
        if (!props.enabled) return;
        const t = target.value;
        if (!t) return;
        e.stopPropagation();
        const meshEl = e.eventObject.element;
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

    return () => {
      const t = target.value;
      if (!t) return null;
      if (props.mode !== "translate" && props.mode !== "rotate") return null;
      const position = t.getPosition() ?? ([0, 0, 0] as Vec3);
      const wrapperStyle: Record<string, string | number> = {
        position: "absolute",
        transformStyle: "preserve-3d",
        transform: `translate3d(${position[0]}px, ${position[1]}px, ${position[2]}px)`,
        // No `pointer-events: none` here — that property is inherited;
        // setting it on the wrapper would cascade to every gizmo
        // polygon and disable native hit-testing on the gizmo entirely.
        zIndex: 1000,
      };

      const children = props.mode === "translate"
        ? arrowEntries.value.map(({ spec, polygons }) =>
            h(PolyMesh, {
              key: spec.key,
              polygons,
              class: `polycss-transform-gizmo polycss-transform-arrow polycss-transform-arrow--${spec.key}`,
              textureLighting: "baked",
              onPointerDown: makeArrowPointerDown(spec),
              ...makeHoverHandlers(spec.key),
            }),
          )
        : ringEntries.value.map(({ spec, polygons }) =>
            h(PolyMesh, {
              key: spec.key,
              polygons,
              class: `polycss-transform-gizmo polycss-transform-ring polycss-transform-ring--${spec.key}`,
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
