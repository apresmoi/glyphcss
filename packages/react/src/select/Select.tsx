/**
 * <Select> — selection wrapper that auto-tracks descendant `<PolyMesh>`
 * clicks and exposes the current selection via `useSelect()`.
 *
 * API mirrors @react-three/drei's `<Select>` so devs migrating from
 * three.js / R3F use the same mental model:
 *
 *   <Select multiple onChange={setSelected}>
 *     <PolyMesh id="a" polygons={...} />
 *     <PolyMesh id="b" polygons={...} />
 *   </Select>
 *
 *   // anywhere inside:
 *   const selected = useSelect();          // PolyMeshHandle[]
 *   const api = useSelectionApi();         // imperative add/remove/toggle
 *
 * Differences from drei:
 *   - No `box` prop (drag-rectangle select) — deferred until requested.
 *     drei's box-select uses three.js `SelectionBox` (frustum cast) which
 *     has no clean DOM analogue; we'd need a different implementation.
 *   - Adds `useSelectionApi()` for imperative mutation. drei keeps state
 *     internal and only reports via `onChange`; we expose the API so a
 *     `<TransformControls>` or sidebar can call `api.set([mesh])` directly.
 *   - Adds `clearOnMiss` (default true). When the click resolves to no
 *     mesh ancestor (background click), clears selection. Pass `false` to
 *     disable. drei achieves this via the canvas' `onPointerMissed` prop.
 *
 * Click delegation: a single listener on the wrapper resolves the deepest
 * mesh ancestor of the event target via `findMeshHandle`. PolyMesh's own
 * `onClick` handler runs first; if it calls `event.stopPropagation()` the
 * click never reaches the Select wrapper, giving consumers an escape
 * hatch to handle clicks without triggering selection.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import {
  findPolyMeshHandle,
  findMeshUnderPoint as findMeshUnderPointShared,
  type PolyMeshHandle,
} from "../scene/events";
import { PolyCameraContext } from "../camera/context";

export interface PolySelectionApi {
  /** Current selection. Stable reference between renders unless changed. */
  selected: PolyMeshHandle[];
  /** Replace selection wholesale. */
  set(next: PolyMeshHandle[]): void;
  /** Add to selection (or replace, when `multiple` is false). */
  add(handle: PolyMeshHandle): void;
  /** Remove from selection. No-op if not present. */
  remove(handle: PolyMeshHandle): void;
  /** Toggle membership. With `multiple=false`, toggling a non-selected
   *  mesh replaces selection; toggling the selected mesh clears. */
  toggle(handle: PolyMeshHandle): void;
  /** Clear selection. */
  clear(): void;
  /** Membership test. */
  has(handle: PolyMeshHandle): boolean;
}

const SelectContext = createContext<PolySelectionApi | null>(null);

export interface PolySelectProps {
  /** Allow multiple meshes selected at once. Default false. */
  multiple?: boolean;
  /** Optional filter applied to every selection change. Returned array
   *  becomes the new selection. */
  filter?: (meshes: PolyMeshHandle[]) => PolyMeshHandle[];
  /** Fires after every selection change with the new array. */
  onChange?: (meshes: PolyMeshHandle[]) => void;
  /** Fires when a click lands inside the Select wrapper but resolves to
   *  no mesh ancestor (i.e. the background). Receives the click event. */
  onPointerMissed?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  /** When true (default), clicking the background clears selection. */
  clearOnMiss?: boolean;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Selection wrapper. The host element uses `display: contents` by default
 * so it doesn't affect CSS layout — its descendants render as if it
 * weren't there, while pointer events still bubble through it.
 */
export function PolySelect({
  multiple = false,
  filter,
  onChange,
  onPointerMissed,
  clearOnMiss = true,
  children,
  className,
  style,
}: PolySelectProps) {
  const [selected, setSelectedState] = useState<PolyMeshHandle[]>([]);
  // Stash latest props in refs so the API closures don't re-create on
  // every render — the consumer's <PolyMesh> tree shouldn't reconcile
  // because Select's internal state shifted.
  const filterRef = useRef(filter);
  filterRef.current = filter;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const multipleRef = useRef(multiple);
  multipleRef.current = multiple;

  const apply = useCallback((next: PolyMeshHandle[]) => {
    const filtered = filterRef.current ? filterRef.current(next) : next;
    setSelectedState(filtered);
    if (onChangeRef.current) onChangeRef.current(filtered);
  }, []);

  const api = useMemo<PolySelectionApi>(() => {
    return {
      selected,
      set: (next) => apply(next),
      add: (h) => {
        setSelectedState((prev) => {
          const next = multipleRef.current
            ? prev.includes(h) ? prev : [...prev, h]
            : [h];
          const filtered = filterRef.current ? filterRef.current(next) : next;
          if (onChangeRef.current) onChangeRef.current(filtered);
          return filtered;
        });
      },
      remove: (h) => {
        setSelectedState((prev) => {
          if (!prev.includes(h)) return prev;
          const next = prev.filter((x) => x !== h);
          const filtered = filterRef.current ? filterRef.current(next) : next;
          if (onChangeRef.current) onChangeRef.current(filtered);
          return filtered;
        });
      },
      toggle: (h) => {
        setSelectedState((prev) => {
          const next = prev.includes(h)
            ? prev.filter((x) => x !== h)
            : multipleRef.current
              ? [...prev, h]
              : [h];
          const filtered = filterRef.current ? filterRef.current(next) : next;
          if (onChangeRef.current) onChangeRef.current(filtered);
          return filtered;
        });
      },
      clear: () => apply([]),
      has: (h) => selected.includes(h),
    };
  }, [selected, apply]);

  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const cameraCtx = useContext(PolyCameraContext);
  const cameraElRef = cameraCtx?.cameraElRef;
  const clearOnMissRef = useRef(clearOnMiss);
  clearOnMissRef.current = clearOnMiss;
  const onPointerMissedRef = useRef(onPointerMissed);
  onPointerMissedRef.current = onPointerMissed;

  // JS hit-testing fallback. polycss polygons render via the
  // CSS-Borders-Level-4 `border-shape` property which clips both paint
  // AND hit-testing to the polygon shape — clicking on the visible
  // chicken often targets `cameraEl` itself rather than any `<i>`,
  // because the click point lies outside every polygon's clipped hit
  // region (the `<i>` rects extend past their visible shapes).
  //
  // Walk every `.polycss-mesh` wrapper, then every `<i>` polygon
  // child's post-3D bounding rect. If the click point lies inside any
  // polygon's rect, we resolve the owning mesh. Coarse compared to a
  // true raycast (we only test rect membership, not polygon
  // membership), but cheap and good enough for "click anywhere on the
  // visible mesh = select".
  // Skip gizmo PolyMeshes — they register in MESH_REGISTRY just like
  // user content; without this filter, clicking an axis arrow would
  // resolve to the arrow itself as a "selectable mesh".
  const findMeshUnderPoint = useCallback(
    (clientX: number, clientY: number): PolyMeshHandle | null =>
      findMeshUnderPointShared(
        clientX,
        clientY,
        (meshEl) => !meshEl.closest("[data-poly-transform-controls]"),
      ),
    [],
  );

  // Camera-level click listener does the actual work. Inside
  // <PolyCamera>, polygons may not be hit-testable (border-shape
  // clipping) so clicks frequently target cameraEl directly. A wrapper-
  // level React onClick wouldn't fire in that case — cameraEl is an
  // ancestor of the wrapper, so events on cameraEl don't bubble down.
  // Listening on cameraEl catches every click within the scene.
  useEffect(() => {
    const cameraEl = cameraElRef?.current;
    if (!cameraEl) return;
    const onClick = (event: MouseEvent): void => {
      // Skip clicks on the transform-controls gizmo — those are
      // selection-internal interactions (axis grab) and shouldn't
      // re-trigger Select. Without this guard, clicking an axis arrow
      // hits the cameraEl listener with no resolved mesh, gets treated
      // as a background click, and clears selection — unmounting the
      // gizmo mid-grab.
      const target = event.target as Element | null;
      if (target?.closest?.("[data-poly-transform-controls]")) return;
      // Native DOM bubbling resolves the mesh in O(depth). The JS
      // bbox fallback runs only when native hit-testing missed —
      // typically because something in the embedding application has
      // forced `pointer-events: none` on polycss elements, or an edge
      // case where `border-shape` clips a polygon's hit area.
      const handle =
        findPolyMeshHandle(event.target as Element) ??
        findMeshUnderPoint(event.clientX, event.clientY);
      if (!handle) {
        if (onPointerMissedRef.current) onPointerMissedRef.current(event as unknown as ReactMouseEvent<HTMLDivElement>);
        if (clearOnMissRef.current) apply([]);
        return;
      }
      const additive =
        multipleRef.current &&
        (event.shiftKey || event.metaKey || event.ctrlKey);
      // Single-click toggle: clicking the currently-selected mesh
      // deselects it. Clicking a different mesh replaces selection
      // (single-mode) or adds (multi+modifier). Mirrors three.js
      // editor's single-select UX.
      setSelectedState((prev) => {
        let next: PolyMeshHandle[];
        if (additive) {
          next = prev.includes(handle)
            ? prev.filter((x) => x !== handle)
            : [...prev, handle];
        } else if (prev.length === 1 && prev[0] === handle) {
          next = [];
        } else {
          next = [handle];
        }
        const filtered = filterRef.current ? filterRef.current(next) : next;
        if (onChangeRef.current) onChangeRef.current(filtered);
        return filtered;
      });
    };
    cameraEl.addEventListener("click", onClick);
    return () => cameraEl.removeEventListener("click", onClick);
  }, [cameraElRef, findMeshUnderPoint, apply]);

  // Wrapper-level React onClick — only meaningful when there's no
  // <PolyCamera> ancestor (the cameraEl listener above is the primary
  // path and runs first). Kept as a fallback so <Select> still works
  // outside a camera context.
  const handleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (cameraCtx) return;
    const handle =
      findPolyMeshHandle(e.target as Element) ??
      findMeshUnderPoint(e.clientX, e.clientY);
    if (!handle) {
      if (onPointerMissed) onPointerMissed(e);
      if (clearOnMiss) apply([]);
      return;
    }
    if (multiple && (e.shiftKey || e.metaKey || e.ctrlKey)) {
      api.toggle(handle);
    } else if (selected.length === 1 && selected[0] === handle) {
      apply([]);
    } else {
      apply([handle]);
    }
  };

  // display:contents keeps the wrapper invisible to CSS layout AND CSS
  // 3D context — important because polycss-camera relies on an
  // unbroken `transform-style: preserve-3d` chain from camera → scene →
  // mesh → polygon for 3D rendering. A plain block-level wrapper, even
  // with preserve-3d via the `.polycss-camera *` rule, flattens the
  // scene (the chicken renders as a pancake). Event delivery to a
  // display:contents element is unreliable in some browsers, but we
  // don't depend on it — the native pointerdown listener attaches to
  // the parent scene element instead (see useEffect above).
  const wrapperStyle: CSSProperties = { display: "contents", ...style };

  return (
    <SelectContext.Provider value={api}>
      <div
        ref={wrapperRef}
        className={className}
        style={wrapperStyle}
        onClick={handleClick}
        data-poly-select
      >
        {children}
      </div>
    </SelectContext.Provider>
  );
}

/**
 * Read the current selection from the nearest enclosing `<Select>`.
 * Returns an empty array when used outside a `<Select>` (matches drei).
 */
export function usePolySelect(): PolyMeshHandle[] {
  return useContext(SelectContext)?.selected ?? [];
}

/**
 * Read the imperative selection API. Throws when used outside `<PolySelect>`
 * — fail loudly because callers expect to mutate.
 */
export function usePolySelectionApi(): PolySelectionApi {
  const ctx = useContext(SelectContext);
  if (!ctx) {
    throw new Error("polycss: usePolySelectionApi must be used inside <PolySelect>.");
  }
  return ctx;
}
