import { computed, onMounted, onBeforeUnmount, watch, ref } from "vue";
import type { Ref, VNode } from "vue";
import { h, defineComponent } from "vue";
import type { PropType } from "vue";
import type { Voxel, GridContext, WallsMask } from "@layoutit/voxcss-core";
import {
  type PlaneAxis,
  type FaceData,
  type SlicePlan,
  buildSlicePlan,
  buildFaceDataFromSnapshot,
  NEXT_LAYER_STEP,
} from "@layoutit/voxcss-core";
import type { SceneStore } from "../store";

const BRUSH_CLASS = "voxcss-brush";

function applyBrush(
  el: HTMLElement,
  gridArea: string,
  backgroundColor: string,
  zOffset: string
): void {
  const state = ((el as any).__voxBrush ??= {} as Record<string, string>);
  if (state.className !== BRUSH_CLASS) {
    el.className = BRUSH_CLASS;
    state.className = BRUSH_CLASS;
  }
  if (state.gridArea !== gridArea) {
    el.style.gridArea = gridArea;
    state.gridArea = gridArea;
  }
  if (state.backgroundColor !== backgroundColor) {
    el.style.backgroundColor = backgroundColor;
    state.backgroundColor = backgroundColor;
  }
  if (state.zOffset !== zOffset) {
    el.style.setProperty("--vox-z", zOffset);
    state.zOffset = zOffset;
  }
}

function renderBrushesToHost(
  host: HTMLElement,
  pool: HTMLElement[],
  plans: SlicePlan[],
  walls: WallsMask,
  tileSize: number,
  layerElevation: number,
  axes: Set<PlaneAxis>,
): number {
  const doc = host.ownerDocument;
  let poolIndex = 0;

  for (const plan of plans) {
    const { axis, plane, face } = plan.key;
    if (!axes.has(axis)) continue;
    if (walls[face]) continue;

    const planeOffset = axis === "z"
      ? plane * layerElevation
      : -1 * (plane - 1) * tileSize;
    const brushZ = `${planeOffset}px`;
    const originRow = plan.buffer.minRow;
    const originCol = plan.buffer.minCol;

    for (const brush of plan.brushes) {
      const gridArea = `${originRow + brush.r0} / ${originCol + brush.c0} / ${originRow + brush.r1} / ${originCol + brush.c1}`;
      let el = pool[poolIndex];
      if (!el) {
        el = doc.createElement("b");
        pool[poolIndex] = el;
      }
      if (el.parentElement !== host) {
        host.appendChild(el);
      }
      applyBrush(el, gridArea, brush.baseColor, brushZ);
      poolIndex++;
    }
  }

  // Remove excess from DOM (keep in pool)
  for (let i = poolIndex; i < pool.length; i++) {
    pool[i]?.remove();
  }

  return poolIndex;
}

export function useSliceBrushes(
  layers: Ref<Voxel[][]>,
  context: Ref<GridContext>,
) {
  const plans = computed(() => {
    const tileSize = context.value.tileSize ?? 50;
    const layerElevation = context.value.layerElevation ?? tileSize;
    void tileSize;
    void layerElevation;

    const faces = buildFaceDataFromSnapshot({ layers: layers.value, context: context.value });
    const faceIndex = new Map<string, FaceData>();
    for (const face of faces) {
      faceIndex.set(`${face.key.axis}:${face.key.plane}:${face.key.face}`, face);
    }
    const result: SlicePlan[] = [];
    for (const face of faces) {
      const nextPlane = face.key.plane + NEXT_LAYER_STEP[face.key.face];
      const nextKey = `${face.key.axis}:${nextPlane}:${face.key.face}`;
      const nextFace = faceIndex.get(nextKey);
      const nextBuffer = nextFace?.buffer ?? null;
      result.push(buildSlicePlan(face, nextBuffer));
    }
    return result;
  });

  return { plans };
}

const Z_SET = new Set<PlaneAxis>(["z"]);
const X_SET = new Set<PlaneAxis>(["x"]);
const Y_SET = new Set<PlaneAxis>(["y"]);

/**
 * Imperatively renders brushes into a host element.
 * Subscribes directly to the scene store for wall mask changes —
 * bypasses Vue reconciliation entirely for face visibility toggling.
 */
function useImperativeBrushRenderer(
  plans: Ref<SlicePlan[]>,
  store: SceneStore,
  tileSize: Ref<number>,
  layerElevation: Ref<number>,
  axisSet: Set<PlaneAxis>,
  hostRef: Ref<HTMLElement | null>,
) {
  const pool: HTMLElement[] = [];
  let unsubscribe: (() => void) | null = null;

  function render() {
    const host = hostRef.value;
    if (!host) return;
    const walls = store.getState().wallMask;
    renderBrushesToHost(host, pool, plans.value, walls, tileSize.value, layerElevation.value, axisSet);
  }

  // Initial render + plan changes
  watch([plans, tileSize, layerElevation, hostRef], () => {
    render();
  }, { flush: "post" });

  onMounted(() => {
    render();
    // Subscribe to store for wall mask changes — direct DOM, no Vue
    unsubscribe = store.subscribe(() => {
      render();
    });
  });

  onBeforeUnmount(() => {
    unsubscribe?.();
    unsubscribe = null;
  });
}

/**
 * Z-axis brushes — renders directly into the floor div via ref.
 * Does NOT create a wrapper div.
 */
export const SliceZBrushes = defineComponent({
  name: "SliceZBrushes",
  props: {
    floorRef: { type: Object as PropType<Ref<HTMLElement | null>>, required: true },
    plans: { type: Array as PropType<SlicePlan[]>, required: true },
    store: { type: Object as PropType<SceneStore>, required: true },
    tileSize: { type: Number, required: true },
    layerElevation: { type: Number, required: true },
  },
  setup(props) {
    useImperativeBrushRenderer(
      computed(() => props.plans),
      props.store,
      computed(() => props.tileSize),
      computed(() => props.layerElevation),
      Z_SET,
      props.floorRef,
    );
    return () => null; // No Vue elements — brushes managed imperatively
  },
});

/**
 * Axis host for x/y brushes. Vue owns the wrapper div, brushes are imperative.
 */
export const SliceAxisHost = defineComponent({
  name: "SliceAxisHost",
  props: {
    className: { type: String, required: true },
    hostStyle: { type: Object as PropType<Record<string, string>>, required: true },
    plans: { type: Array as PropType<SlicePlan[]>, required: true },
    store: { type: Object as PropType<SceneStore>, required: true },
    tileSize: { type: Number, required: true },
    layerElevation: { type: Number, required: true },
    axes: { type: Object as PropType<Set<PlaneAxis>>, required: true },
  },
  setup(props) {
    const hostRef = ref<HTMLElement | null>(null);

    useImperativeBrushRenderer(
      computed(() => props.plans),
      props.store,
      computed(() => props.tileSize),
      computed(() => props.layerElevation),
      props.axes,
      hostRef,
    );

    return () => {
      if (props.plans.length === 0) return null;
      return h("div", { ref: hostRef, class: props.className, style: props.hostStyle });
    };
  },
});
