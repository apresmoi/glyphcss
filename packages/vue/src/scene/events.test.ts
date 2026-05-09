/**
 * Unit tests for the pure helper functions in events.ts:
 *  - pointInMeshElement  (lines 96-115 — the bb hit-test)
 *  - findMeshUnderPoint  (lines 117-133 — DOM scan + hit-test)
 *  - findMeshHandle      (already covered via PolyMesh.test.ts, added edge cases)
 *  - registerMeshElement / unregisterMeshElement
 *
 * We avoid mounting PolyMesh here so the registry state is fully controlled.
 * Each element gets its getBoundingClientRect monkey-patched inline.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  pointInMeshElement,
  findMeshUnderPoint,
  findMeshHandle,
  registerMeshElement,
  unregisterMeshElement,
  type PolyMeshHandle,
} from "./events";
import type { Polygon, Vec3 } from "@layoutit/polycss-core";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Monkeypatch getBoundingClientRect on `el` to return the supplied rect. */
function withFakeRect(
  el: HTMLElement,
  rect: { left: number; top: number; right: number; bottom: number; width: number; height: number },
): void {
  el.getBoundingClientRect = () => ({
    ...rect,
    x: rect.left,
    y: rect.top,
    toJSON() { return this; },
  }) as DOMRect;
}

/** Build a minimal PolyMeshHandle stub. */
function makeHandle(el: HTMLElement, id = "test"): PolyMeshHandle {
  return {
    element: el as HTMLDivElement,
    id,
    getPosition: () => [0, 0, 0] as Vec3,
    getRotation: () => [0, 0, 0] as Vec3,
    getScale: () => 1,
    getPolygons: () => [] as Polygon[],
    rebakeAtlas: () => {},
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

// ── pointInMeshElement ───────────────────────────────────────────────────────

describe("pointInMeshElement", () => {
  it("returns false when the mesh element has no <i> children", () => {
    const meshEl = document.createElement("div");
    expect(pointInMeshElement(meshEl, 50, 50)).toBe(false);
  });

  it("returns false when the only <i> child has zero dimensions (line 104 guard)", () => {
    const meshEl = document.createElement("div");
    const poly = document.createElement("i");
    withFakeRect(poly, { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
    meshEl.appendChild(poly);
    expect(pointInMeshElement(meshEl, 5, 5)).toBe(false);
  });

  it("returns false when point is outside the bounding rect", () => {
    const meshEl = document.createElement("div");
    const poly = document.createElement("i");
    withFakeRect(poly, { left: 100, top: 100, right: 200, bottom: 200, width: 100, height: 100 });
    meshEl.appendChild(poly);
    // Point is clearly outside (left/above)
    expect(pointInMeshElement(meshEl, 50, 50)).toBe(false);
  });

  it("returns true when point is inside one of the <i> polygon rects (line 105-109)", () => {
    const meshEl = document.createElement("div");
    const poly = document.createElement("i");
    withFakeRect(poly, { left: 100, top: 100, right: 200, bottom: 200, width: 100, height: 100 });
    meshEl.appendChild(poly);
    // Point at the center of the rect
    expect(pointInMeshElement(meshEl, 150, 150)).toBe(true);
  });

  it("returns true when point is on the boundary of the rect (inclusive)", () => {
    const meshEl = document.createElement("div");
    const poly = document.createElement("i");
    withFakeRect(poly, { left: 10, top: 20, right: 110, bottom: 120, width: 100, height: 100 });
    meshEl.appendChild(poly);
    // All four corners should be inclusive
    expect(pointInMeshElement(meshEl, 10, 20)).toBe(true);
    expect(pointInMeshElement(meshEl, 110, 120)).toBe(true);
  });

  it("returns true when any one of multiple <i> children contains the point (line 111-112)", () => {
    const meshEl = document.createElement("div");

    const poly1 = document.createElement("i");
    withFakeRect(poly1, { left: 0, top: 0, right: 50, bottom: 50, width: 50, height: 50 });

    const poly2 = document.createElement("i");
    withFakeRect(poly2, { left: 200, top: 200, right: 300, bottom: 300, width: 100, height: 100 });

    meshEl.appendChild(poly1);
    meshEl.appendChild(poly2);

    // Point is only in poly2's rect
    expect(pointInMeshElement(meshEl, 250, 250)).toBe(true);
    // Point is in neither
    expect(pointInMeshElement(meshEl, 100, 100)).toBe(false);
  });
});

// ── findMeshUnderPoint ───────────────────────────────────────────────────────

describe("findMeshUnderPoint", () => {
  it("returns null when no .polycss-mesh elements are in the DOM", () => {
    const result = findMeshUnderPoint(50, 50);
    expect(result).toBeNull();
  });

  it("returns null when a .polycss-mesh exists but has no registered handle", () => {
    const meshEl = document.createElement("div");
    meshEl.className = "polycss-mesh";
    document.body.appendChild(meshEl);
    // No registerMeshElement call → MESH_REGISTRY has no entry
    expect(findMeshUnderPoint(0, 0)).toBeNull();
  });

  it("returns null when registered mesh does not contain the point", () => {
    const meshEl = document.createElement("div");
    meshEl.className = "polycss-mesh";
    document.body.appendChild(meshEl);

    const poly = document.createElement("i");
    withFakeRect(poly, { left: 500, top: 500, right: 600, bottom: 600, width: 100, height: 100 });
    meshEl.appendChild(poly);

    const handle = makeHandle(meshEl, "far-away");
    registerMeshElement(meshEl, handle);

    expect(findMeshUnderPoint(0, 0)).toBeNull();

    unregisterMeshElement(meshEl);
  });

  it("returns the handle when the registered mesh contains the point", () => {
    const meshEl = document.createElement("div");
    meshEl.className = "polycss-mesh";
    document.body.appendChild(meshEl);

    const poly = document.createElement("i");
    withFakeRect(poly, { left: 10, top: 10, right: 100, bottom: 100, width: 90, height: 90 });
    meshEl.appendChild(poly);

    const handle = makeHandle(meshEl, "hit-me");
    registerMeshElement(meshEl, handle);

    const found = findMeshUnderPoint(50, 50);
    expect(found).toBe(handle);
    expect(found?.id).toBe("hit-me");

    unregisterMeshElement(meshEl);
  });

  it("respects the filter callback — skips meshes the filter rejects", () => {
    const meshA = document.createElement("div");
    meshA.className = "polycss-mesh";
    meshA.dataset.polyMeshId = "a";
    document.body.appendChild(meshA);

    const polyA = document.createElement("i");
    withFakeRect(polyA, { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 });
    meshA.appendChild(polyA);
    registerMeshElement(meshA, makeHandle(meshA, "a"));

    // Filter rejects everything → null
    const result = findMeshUnderPoint(50, 50, () => false);
    expect(result).toBeNull();

    unregisterMeshElement(meshA);
  });

  it("respects the filter callback — returns handle when filter accepts it", () => {
    const meshEl = document.createElement("div");
    meshEl.className = "polycss-mesh";
    document.body.appendChild(meshEl);

    const poly = document.createElement("i");
    withFakeRect(poly, { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 });
    meshEl.appendChild(poly);

    const handle = makeHandle(meshEl, "accepted");
    registerMeshElement(meshEl, handle);

    const result = findMeshUnderPoint(50, 50, () => true);
    expect(result).toBe(handle);

    unregisterMeshElement(meshEl);
  });
});

// ── findMeshHandle (edge cases) ──────────────────────────────────────────────

describe("findMeshHandle (edge cases)", () => {
  it("returns null for null input", () => {
    expect(findMeshHandle(null)).toBeNull();
  });

  it("returns null for an element not in the registry and with no registered ancestors", () => {
    const orphan = document.createElement("div");
    expect(findMeshHandle(orphan)).toBeNull();
  });

  it("walks up ancestors to find a registered parent", () => {
    const parent = document.createElement("div");
    const child = document.createElement("span");
    parent.appendChild(child);

    const handle = makeHandle(parent, "parent-mesh");
    registerMeshElement(parent, handle);

    expect(findMeshHandle(child)).toBe(handle);
    expect(findMeshHandle(child)?.id).toBe("parent-mesh");

    unregisterMeshElement(parent);
  });
});

// ── registerMeshElement / unregisterMeshElement ──────────────────────────────

describe("registerMeshElement / unregisterMeshElement", () => {
  it("unregisterMeshElement removes the handle so findMeshHandle returns null", () => {
    const el = document.createElement("div");
    const handle = makeHandle(el, "to-remove");
    registerMeshElement(el, handle);
    expect(findMeshHandle(el)).toBe(handle);

    unregisterMeshElement(el);
    expect(findMeshHandle(el)).toBeNull();
  });

  it("re-registering an element with a new handle returns the new handle", () => {
    const el = document.createElement("div");
    const h1 = makeHandle(el, "first");
    const h2 = makeHandle(el, "second");

    registerMeshElement(el, h1);
    expect(findMeshHandle(el)?.id).toBe("first");

    registerMeshElement(el, h2);
    expect(findMeshHandle(el)?.id).toBe("second");

    unregisterMeshElement(el);
  });
});
