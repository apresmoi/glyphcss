/**
 * createSelect — additive selection layer for vanilla polycss scenes.
 * Mirrors the React `<Select>` API: tracks one or more selected
 * meshes, fires `onChange` whenever the set changes, supports
 * single-click toggle (re-clicking the selected mesh deselects it),
 * shift/meta/ctrl + click for multi-select extension, and a JS bbox
 * hit-test fallback for clicks that fall through native polygon
 * hit-testing (e.g. CSS `border-shape` clipping).
 *
 * Usage:
 *   const select = createSelect(scene, { onChange: (meshes) => ... });
 *   select.set([handle]);            // imperative selection
 *   select.toggle(handle);
 *   select.clear();
 *   select.destroy();                // remove listeners
 */
import type { MeshHandle, SceneHandle } from "./createPolyScene";

export interface CreateSelectOptions {
  /** Allow multiple meshes selected at once. Default false. */
  multiple?: boolean;
  /** When true (default), clicking the background clears selection.
   *  Set false to keep the current selection on background clicks. */
  clearOnMiss?: boolean;
  /** Optional filter applied to every selection change — return the
   *  array that should become the new selection (drop / reorder). */
  filter?: (meshes: MeshHandle[]) => MeshHandle[];
  /** Fires after every selection change with the new array. */
  onChange?: (meshes: MeshHandle[]) => void;
  /** Fires when a click resolves to no mesh (background click). */
  onPointerMissed?: (event: MouseEvent) => void;
}

export interface SelectionHandle {
  /** Current selection. Reference is stable until selection changes. */
  readonly selected: ReadonlyArray<MeshHandle>;
  /** Replace selection wholesale. */
  set(next: MeshHandle[]): void;
  /** Add to selection (or replace, when `multiple` is false). */
  add(mesh: MeshHandle): void;
  /** Remove from selection. No-op if not present. */
  remove(mesh: MeshHandle): void;
  /** Toggle membership. With single-mode, toggling a non-selected
   *  mesh replaces selection; toggling the selected mesh clears. */
  toggle(mesh: MeshHandle): void;
  /** Clear selection. */
  clear(): void;
  /** Membership test. */
  has(mesh: MeshHandle): boolean;
  /** Remove the host listener. Idempotent. */
  destroy(): void;
}

/** Test whether `(clientX, clientY)` falls inside any `<i>` polygon
 *  child of `meshEl`'s post-3D bounding rect. */
function pointInMeshElement(
  meshEl: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  const polys = Array.from(meshEl.querySelectorAll("i")) as HTMLElement[];
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

export function createSelect(
  scene: SceneHandle,
  options: CreateSelectOptions = {},
): SelectionHandle {
  let selected: MeshHandle[] = [];
  const subscribers = new Set<(meshes: MeshHandle[]) => void>();
  if (options.onChange) subscribers.add(options.onChange);

  function notify(): void {
    const filtered = options.filter ? options.filter(selected) : selected;
    selected = filtered;
    for (const fn of subscribers) {
      try { fn(selected); } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[polycss/createSelect] onChange threw:", err);
      }
    }
  }

  function set(next: MeshHandle[]): void {
    selected = next;
    notify();
  }

  function add(mesh: MeshHandle): void {
    if (options.multiple) {
      if (!selected.includes(mesh)) selected = [...selected, mesh];
    } else {
      selected = [mesh];
    }
    notify();
  }

  function remove(mesh: MeshHandle): void {
    if (!selected.includes(mesh)) return;
    selected = selected.filter((m) => m !== mesh);
    notify();
  }

  function toggle(mesh: MeshHandle): void {
    if (selected.includes(mesh)) {
      selected = selected.filter((m) => m !== mesh);
    } else if (options.multiple) {
      selected = [...selected, mesh];
    } else {
      selected = [mesh];
    }
    notify();
  }

  function clear(): void {
    if (selected.length === 0) return;
    selected = [];
    notify();
  }

  function has(mesh: MeshHandle): boolean {
    return selected.includes(mesh);
  }

  function findMeshUnderPoint(clientX: number, clientY: number): MeshHandle | null {
    for (const mesh of scene.meshes()) {
      // Skip gizmo meshes — they're managed by transform-controls and
      // shouldn't resolve as user-selectable content. The shared
      // `polycss-transform-gizmo` class is set on every gizmo mesh
      // (translate arrows + rotate rings).
      if (mesh.element.classList.contains("polycss-transform-gizmo")) continue;
      if (pointInMeshElement(mesh.element, clientX, clientY)) return mesh;
    }
    return null;
  }

  // Click delegation on the scene host. Matches the React equivalent
  // — we listen on the host (not the scene root) because:
  //   1. polygons may not be hit-testable when a downstream stylesheet
  //      forces `pointer-events: none`, so clicks bubble up to the host
  //      directly with target=host.
  //   2. `border-shape` (Chrome) clips polygon hit areas to the visible
  //      shape, so even with pointer-events enabled, clicks on the
  //      transparent corners of a polygon `<i>` rect fall through.
  // The JS bbox fallback covers both cases.
  const onClick = (event: MouseEvent): void => {
    const target = event.target as Element | null;
    if (target?.closest(".polycss-transform-gizmo")) return;
    const handle =
      scene.findMeshByElement(target) ??
      findMeshUnderPoint(event.clientX, event.clientY);
    if (!handle) {
      if (options.onPointerMissed) options.onPointerMissed(event);
      if (options.clearOnMiss !== false) clear();
      return;
    }
    const additive = options.multiple && (event.shiftKey || event.metaKey || event.ctrlKey);
    if (additive) {
      toggle(handle);
    } else if (selected.length === 1 && selected[0] === handle) {
      // Re-clicking the only-selected mesh deselects it. Mirrors the
      // single-select UX of three.js editor and the React <Select>.
      clear();
    } else {
      set([handle]);
    }
  };
  scene.host.addEventListener("click", onClick);

  function destroy(): void {
    scene.host.removeEventListener("click", onClick);
    subscribers.clear();
  }

  return {
    get selected() { return selected; },
    set,
    add,
    remove,
    toggle,
    clear,
    has,
    destroy,
  };
}
