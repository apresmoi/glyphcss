import type { GlyphcssMeshHandle } from "./context";

const MESH_REGISTRY = new WeakMap<HTMLElement, GlyphcssMeshHandle>();

export function registerMeshElement(el: HTMLElement, handle: GlyphcssMeshHandle): void {
  MESH_REGISTRY.set(el, handle);
}

export function unregisterMeshElement(el: HTMLElement): void {
  MESH_REGISTRY.delete(el);
}

export function findGlyphcssMeshHandle(el: Element | null): GlyphcssMeshHandle | null {
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
): GlyphcssMeshHandle | null {
  if (typeof document === "undefined") return null;
  const meshEls = Array.from(
    document.querySelectorAll(".glyphcss-mesh"),
  ) as HTMLElement[];
  for (const meshEl of meshEls) {
    if (filter && !filter(meshEl)) continue;
    const handle = findGlyphcssMeshHandle(meshEl);
    if (!handle) continue;
    if (pointInMeshElement(meshEl, clientX, clientY)) return handle;
  }
  return null;
}
