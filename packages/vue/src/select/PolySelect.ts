/**
 * `<PolySelect>` — selection wrapper that auto-tracks descendant
 * `<PolyMesh>` clicks and exposes the current selection via the
 * `usePolySelect()` composable. Mirrors the React API and the vanilla
 * `createSelect` so users get the same UX across all three packages.
 *
 * Usage:
 *   <PolySelect :multiple="true" @change="onChange">
 *     <PolyMesh id="a" :polygons="..." />
 *     <PolyMesh id="b" :polygons="..." />
 *   </PolySelect>
 *
 *   // anywhere inside the tree:
 *   const selected = usePolySelect();        // ComputedRef<PolyMeshHandle[]>
 *   const api = usePolySelectionApi();       // imperative add/remove/toggle
 */
import {
  defineComponent,
  h,
  inject,
  onBeforeUnmount,
  onMounted,
  provide,
  reactive,
  ref,
  computed,
  type ComputedRef,
  type InjectionKey,
  type PropType,
} from "vue";
import { findPolyMeshHandle, findMeshUnderPoint as findMeshUnderPointShared, type PolyMeshHandle } from "../scene/events";
import { PolyCameraContextKey } from "../camera";

export interface PolySelectProps {
  multiple?: boolean;
  clearOnMiss?: boolean;
  filter?: (meshes: PolyMeshHandle[]) => PolyMeshHandle[];
  onChange?: (meshes: PolyMeshHandle[]) => void;
  onPointerMissed?: (event: MouseEvent) => void;
}

export interface PolySelectionApi {
  selected: ReadonlyArray<PolyMeshHandle>;
  set(next: PolyMeshHandle[]): void;
  add(handle: PolyMeshHandle): void;
  remove(handle: PolyMeshHandle): void;
  toggle(handle: PolyMeshHandle): void;
  clear(): void;
  has(handle: PolyMeshHandle): boolean;
}

export const PolySelectionContextKey: InjectionKey<{
  selected: ComputedRef<PolyMeshHandle[]>;
  api: PolySelectionApi;
}> = Symbol("polycss.selection");

export const PolySelect = defineComponent({
  name: "PolySelect",
  props: {
    multiple: { type: Boolean, default: false },
    clearOnMiss: { type: Boolean, default: true },
    filter: {
      type: Function as PropType<(meshes: PolyMeshHandle[]) => PolyMeshHandle[]>,
      default: undefined,
    },
  },
  emits: {
    change: (_meshes: PolyMeshHandle[]) => true,
    pointerMissed: (_event: MouseEvent) => true,
  },
  setup(props, { emit, slots }) {
    const state = reactive<{ selected: PolyMeshHandle[] }>({ selected: [] });
    const selected = computed(() => state.selected);

    function apply(next: PolyMeshHandle[]): void {
      const filtered = props.filter ? props.filter(next) : next;
      state.selected = filtered;
      emit("change", filtered);
    }

    const api: PolySelectionApi = {
      get selected() { return state.selected; },
      set: (next) => apply(next),
      add: (h) => {
        if (props.multiple) {
          if (!state.selected.includes(h)) apply([...state.selected, h]);
        } else {
          apply([h]);
        }
      },
      remove: (h) => {
        if (!state.selected.includes(h)) return;
        apply(state.selected.filter((x) => x !== h));
      },
      toggle: (h) => {
        if (state.selected.includes(h)) {
          apply(state.selected.filter((x) => x !== h));
        } else if (props.multiple) {
          apply([...state.selected, h]);
        } else {
          apply([h]);
        }
      },
      clear: () => apply([]),
      has: (h) => state.selected.includes(h),
    };

    provide(PolySelectionContextKey, { selected, api });

    const cameraCtx = inject(PolyCameraContextKey, undefined);
    const findUnderPoint = (clientX: number, clientY: number): PolyMeshHandle | null =>
      findMeshUnderPointShared(
        clientX,
        clientY,
        (meshEl) => !meshEl.closest("[data-poly-transform-controls]"),
      );

    let detach: (() => void) | null = null;
    onMounted(() => {
      const cameraEl = cameraCtx?.cameraElRef.value;
      if (!cameraEl) return;
      const onClick = (event: MouseEvent): void => {
        const target = event.target as Element | null;
        if (target?.closest("[data-poly-transform-controls]")) return;
        const handle =
          findPolyMeshHandle(event.target as Element) ??
          findUnderPoint(event.clientX, event.clientY);
        if (!handle) {
          emit("pointerMissed", event);
          if (props.clearOnMiss) apply([]);
          return;
        }
        const additive = props.multiple && (event.shiftKey || event.metaKey || event.ctrlKey);
        if (additive) {
          api.toggle(handle);
        } else if (state.selected.length === 1 && state.selected[0] === handle) {
          apply([]);
        } else {
          apply([handle]);
        }
      };
      cameraEl.addEventListener("click", onClick);
      detach = () => cameraEl.removeEventListener("click", onClick);
    });
    onBeforeUnmount(() => {
      detach?.();
    });

    return () =>
      h(
        "div",
        {
          style: { display: "contents" },
          "data-poly-select": "",
        },
        slots.default?.(),
      );
  },
});

/** Read the current selection from the nearest enclosing `<PolySelect>`.
 *  Returns an empty array when called outside one. */
export function usePolySelect(): ComputedRef<PolyMeshHandle[]> {
  const ctx = inject(PolySelectionContextKey, undefined);
  if (!ctx) return ref<PolyMeshHandle[]>([]) as unknown as ComputedRef<PolyMeshHandle[]>;
  return ctx.selected;
}

/** Read the imperative selection API. Throws when called outside a `<PolySelect>`. */
export function usePolySelectionApi(): PolySelectionApi {
  const ctx = inject(PolySelectionContextKey, undefined);
  if (!ctx) {
    throw new Error("polycss: usePolySelectionApi must be used inside <PolySelect>.");
  }
  return ctx.api;
}
