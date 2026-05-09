/**
 * `<Select>` — selection wrapper that auto-tracks descendant
 * `<PolyMesh>` clicks and exposes the current selection via the
 * `useSelect()` composable. Mirrors the React API and the vanilla
 * `createSelect` so users get the same UX across all three packages.
 *
 * Usage:
 *   <Select :multiple="true" @change="onChange">
 *     <PolyMesh id="a" :polygons="..." />
 *     <PolyMesh id="b" :polygons="..." />
 *   </Select>
 *
 *   // anywhere inside the tree:
 *   const selected = useSelect();        // ComputedRef<PolyMeshHandle[]>
 *   const api = useSelectionApi();        // imperative add/remove/toggle
 *
 * Single-mode toggle UX: clicking the currently-selected mesh
 * deselects it (same as three.js editor / React Select). Background
 * clicks clear by default — set `clearOnMiss=false` to keep selection.
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
import { findMeshHandle, findMeshUnderPoint as findMeshUnderPointShared, type PolyMeshHandle } from "../scene/events";
import { PolyCameraContextKey } from "../camera";

export interface SelectionApi {
  selected: ReadonlyArray<PolyMeshHandle>;
  set(next: PolyMeshHandle[]): void;
  add(handle: PolyMeshHandle): void;
  remove(handle: PolyMeshHandle): void;
  toggle(handle: PolyMeshHandle): void;
  clear(): void;
  has(handle: PolyMeshHandle): boolean;
}

export const SelectionContextKey: InjectionKey<{
  selected: ComputedRef<PolyMeshHandle[]>;
  api: SelectionApi;
}> = Symbol("polycss.selection");

export const Select = defineComponent({
  name: "Select",
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

    const api: SelectionApi = {
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

    provide(SelectionContextKey, { selected, api });

    // cameraEl click delegation. polycss polygons render via the
    // `border-shape` CSS property which clips native hit-testing to the
    // visible polygon shape — clicks on transparent corners fall
    // through to cameraEl, so a wrapper-level handler would miss them.
    // Listening on cameraEl + JS bbox hit-test fallback covers both.
    const cameraCtx = inject(PolyCameraContextKey, undefined);
    const findUnderPoint = (clientX: number, clientY: number): PolyMeshHandle | null =>
      findMeshUnderPointShared(
        clientX,
        clientY,
        // Skip gizmo PolyMeshes — managed by TransformControls.
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
          findMeshHandle(event.target as Element) ??
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

    // display:contents wrapper — matches React's Select. Stays out of
    // the layout / 3D context so wrapping doesn't flatten the camera-
    // transformed scene the children render in.
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

/** Read the current selection from the nearest enclosing `<Select>`.
 *  Returns an empty array when called outside one. */
export function useSelect(): ComputedRef<PolyMeshHandle[]> {
  const ctx = inject(SelectionContextKey, undefined);
  if (!ctx) return ref<PolyMeshHandle[]>([]) as unknown as ComputedRef<PolyMeshHandle[]>;
  return ctx.selected;
}

/** Read the imperative selection API. Throws when called outside a `<Select>`. */
export function useSelectionApi(): SelectionApi {
  const ctx = inject(SelectionContextKey, undefined);
  if (!ctx) {
    throw new Error("polycss: useSelectionApi must be used inside <Select>.");
  }
  return ctx.api;
}
