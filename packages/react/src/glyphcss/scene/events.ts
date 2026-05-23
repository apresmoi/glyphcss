import type { GlyphMeshHandle } from "./context";

const MESH_REGISTRY = new WeakMap<HTMLElement, GlyphMeshHandle>();

export function registerMeshElement(el: HTMLElement, handle: GlyphMeshHandle): void {
  MESH_REGISTRY.set(el, handle);
}

export function unregisterMeshElement(el: HTMLElement): void {
  MESH_REGISTRY.delete(el);
}

export function findGlyphMeshHandle(el: Element | null): GlyphMeshHandle | null {
  let cur: Element | null = el;
  while (cur) {
    if (cur instanceof HTMLElement) {
      const h = MESH_REGISTRY.get(cur);
      if (h) return h;
    }
    cur = cur.parentElement;
  }
  return null;
}

export function pointInMeshElement(
  meshEl: HTMLElement,
  clientX: number,
  clientY: number,
): boolean {
  const r = meshEl.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

export function findMeshUnderPoint(
  clientX: number,
  clientY: number,
  filter?: (meshEl: HTMLElement) => boolean,
): GlyphMeshHandle | null {
  if (typeof document === "undefined") return null;
  const meshEls = Array.from(
    document.querySelectorAll(".glyph-mesh"),
  ) as HTMLElement[];
  for (const meshEl of meshEls) {
    if (filter && !filter(meshEl)) continue;
    const handle = findGlyphMeshHandle(meshEl);
    if (!handle) continue;
    if (pointInMeshElement(meshEl, clientX, clientY)) return handle;
  }
  return null;
}
