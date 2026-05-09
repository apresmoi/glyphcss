import { describe, it, expect, afterEach } from "vitest";
import {
  registerMeshElement,
  unregisterMeshElement,
  findMeshHandle,
  pointInMeshElement,
  findMeshUnderPoint,
  type PolyMeshHandle,
} from "./events";
import type { Polygon, Vec3 } from "@polycss/core";

afterEach(() => {
  document.body.innerHTML = "";
});

// ── Minimal PolyMeshHandle stub ────────────────────────────────────────────

function makeHandle(el: HTMLDivElement, id?: string): PolyMeshHandle {
  return {
    element: el,
    id,
    getPosition: () => undefined,
    getRotation: () => undefined,
    getScale: () => undefined,
    getPolygons: (): Polygon[] => [],
  };
}

// ── pointInMeshElement ──────────────────────────────────────────────────────

/** Create an <i> child with a faked getBoundingClientRect. */
function addPoly(parent: HTMLElement, rect: { left: number; top: number; width: number; height: number }): HTMLElement {
  const i = document.createElement("i");
  parent.appendChild(i);
  i.getBoundingClientRect = () =>
    ({
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
      x: rect.left,
      y: rect.top,
      toJSON() { return this; },
    } as DOMRect);
  return i;
}

describe("pointInMeshElement", () => {
  it("returns true when point is inside a polygon bounding rect", () => {
    const mesh = document.createElement("div");
    addPoly(mesh, { left: 10, top: 10, width: 100, height: 100 });
    expect(pointInMeshElement(mesh, 50, 50)).toBe(true);
  });

  it("returns false when point is outside all polygon rects", () => {
    const mesh = document.createElement("div");
    addPoly(mesh, { left: 10, top: 10, width: 100, height: 100 });
    expect(pointInMeshElement(mesh, 200, 200)).toBe(false);
  });

  it("returns false when there are no <i> children", () => {
    const mesh = document.createElement("div");
    expect(pointInMeshElement(mesh, 50, 50)).toBe(false);
  });

  it("skips zero-width rects (happy-dom / SSR pre-layout)", () => {
    const mesh = document.createElement("div");
    // Add a zero-area rect first
    addPoly(mesh, { left: 50, top: 50, width: 0, height: 0 });
    // That point should not match the zero-area rect
    expect(pointInMeshElement(mesh, 50, 50)).toBe(false);
  });

  it("returns true for the first matching polygon among multiple", () => {
    const mesh = document.createElement("div");
    addPoly(mesh, { left: 0, top: 0, width: 10, height: 10 });
    addPoly(mesh, { left: 100, top: 100, width: 50, height: 50 });
    expect(pointInMeshElement(mesh, 120, 120)).toBe(true);
    expect(pointInMeshElement(mesh, 5, 5)).toBe(true);
    expect(pointInMeshElement(mesh, 50, 50)).toBe(false);
  });
});

// ── findMeshHandle ──────────────────────────────────────────────────────────

describe("findMeshHandle", () => {
  it("returns null for null input", () => {
    expect(findMeshHandle(null)).toBeNull();
  });

  it("finds the handle on the element itself", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const handle = makeHandle(el, "mesh-a");
    registerMeshElement(el, handle);
    expect(findMeshHandle(el)).toBe(handle);
    unregisterMeshElement(el);
  });

  it("finds the handle by walking up to a registered ancestor", () => {
    const parent = document.createElement("div");
    const child = document.createElement("span");
    parent.appendChild(child);
    document.body.appendChild(parent);
    const handle = makeHandle(parent as unknown as HTMLDivElement, "mesh-b");
    registerMeshElement(parent, handle);
    expect(findMeshHandle(child)).toBe(handle);
    unregisterMeshElement(parent);
  });

  it("returns null when no registered ancestor exists", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(findMeshHandle(el)).toBeNull();
  });

  it("unregisterMeshElement removes the handle so findMeshHandle returns null", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const handle = makeHandle(el, "mesh-c");
    registerMeshElement(el, handle);
    unregisterMeshElement(el);
    expect(findMeshHandle(el)).toBeNull();
  });
});

// ── findMeshUnderPoint ──────────────────────────────────────────────────────

describe("findMeshUnderPoint", () => {
  it("returns null when no .polycss-mesh elements exist", () => {
    document.body.innerHTML = "";
    expect(findMeshUnderPoint(50, 50)).toBeNull();
  });

  it("returns the handle of the mesh whose polygon rect contains the point", () => {
    const mesh = document.createElement("div");
    mesh.className = "polycss-mesh";
    document.body.appendChild(mesh);
    addPoly(mesh, { left: 0, top: 0, width: 200, height: 200 });
    const handle = makeHandle(mesh, "found");
    registerMeshElement(mesh, handle);

    const result = findMeshUnderPoint(100, 100);
    expect(result).toBe(handle);

    unregisterMeshElement(mesh);
  });

  it("returns null when the point is outside all mesh polygon rects", () => {
    const mesh = document.createElement("div");
    mesh.className = "polycss-mesh";
    document.body.appendChild(mesh);
    addPoly(mesh, { left: 0, top: 0, width: 50, height: 50 });
    const handle = makeHandle(mesh, "miss");
    registerMeshElement(mesh, handle);

    expect(findMeshUnderPoint(200, 200)).toBeNull();

    unregisterMeshElement(mesh);
  });

  it("respects the filter — skips meshes where filter returns false", () => {
    const mesh = document.createElement("div");
    mesh.className = "polycss-mesh";
    document.body.appendChild(mesh);
    addPoly(mesh, { left: 0, top: 0, width: 200, height: 200 });
    const handle = makeHandle(mesh, "filtered-out");
    registerMeshElement(mesh, handle);

    const result = findMeshUnderPoint(100, 100, () => false);
    expect(result).toBeNull();

    unregisterMeshElement(mesh);
  });

  it("skips mesh elements that have no registered handle", () => {
    const mesh = document.createElement("div");
    mesh.className = "polycss-mesh";
    document.body.appendChild(mesh);
    addPoly(mesh, { left: 0, top: 0, width: 200, height: 200 });
    // Intentionally not calling registerMeshElement

    expect(findMeshUnderPoint(100, 100)).toBeNull();
  });
});
