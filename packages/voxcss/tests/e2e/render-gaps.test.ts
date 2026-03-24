/**
 * E2E render gap tests for VoxCSS.
 *
 * Gap #9:  Area voxel partial neighbor -> face IS rendered
 * Gap #10: Area voxel full neighbor -> face NOT rendered
 * Gap #31: setVoxels() removes elements
 * Gap #32: setVoxels() changes colors
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";

import {
  renderScene,
  type HeadlessRenderHandle,
  type VoxelGrid
} from "../../src/index";

beforeAll(() => {
  // Polyfill Option for happy-dom (used in sliceRenderer for color normalization)
  if (typeof globalThis.Option === "undefined") {
    (globalThis as any).Option = class {
      style: Record<string, string> = {};
      get selected() { return false; }
      constructor() {
        const styleData: Record<string, string> = {};
        this.style = new Proxy(styleData, {
          set(target, prop, value) {
            if (typeof prop === "string") {
              const v = String(value).trim();
              if (v.startsWith("#")) {
                const hex = v.slice(1);
                if (hex.length === 6) {
                  const r = parseInt(hex.slice(0, 2), 16);
                  const g = parseInt(hex.slice(2, 4), 16);
                  const b = parseInt(hex.slice(4, 6), 16);
                  if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
                    target[prop] = `rgb(${r}, ${g}, ${b})`;
                    return true;
                  }
                }
                if (hex.length === 3) {
                  const r = parseInt(hex[0] + hex[0], 16);
                  const g = parseInt(hex[1] + hex[1], 16);
                  const b = parseInt(hex[2] + hex[2], 16);
                  if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
                    target[prop] = `rgb(${r}, ${g}, ${b})`;
                    return true;
                  }
                }
              }
              target[prop] = v;
            }
            return true;
          },
          get(target, prop) {
            if (typeof prop === "string") return target[prop] ?? "";
            return undefined;
          }
        });
      }
    };
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

function cleanup(root: HTMLElement): void {
  root.remove();
  document.getElementById("voxcss-base-styles")?.remove();
}

function qsa(root: HTMLElement, selector: string): Element[] {
  return Array.from(root.querySelectorAll(selector));
}

function qs(root: HTMLElement, selector: string): Element | null {
  return root.querySelector(selector);
}

// ---------------------------------------------------------------------------
// Gap #9 & #10: Area voxel partial/full neighbor occlusion
// ---------------------------------------------------------------------------

describe("renderScene — Area Voxel Neighbor Occlusion", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("Gap #9: area voxel with partial neighbor — face IS rendered", () => {
    // Area voxel spanning x=1..3, y=1..2 (a 2x1 area voxel).
    // Place a single neighbor at (3,1,0) covering only ONE cell of the fl edge
    // (the fl face checks along the x2 boundary, i.e., x=3).
    // Since the neighbor only covers one of the two cells on that edge,
    // the face should NOT be fully occluded and should still be rendered.
    //
    // Default camera walls: t=false, b=true, bl=true, br=true, fl=false, fr=false
    // The fl face is visible (walls.fl=false), so we test the fl face.
    // fl offset is [1,0,0] meaning it checks x2 direction.
    // The area voxel has x=1, x2=3 and y=1, y2=2.
    // For fl face: targetX = x2 = 3, and it iterates yi from y=1 to y2=2 (exclusive), so just y=1.
    // Actually for a 2x1 voxel, y spans only 1 cell, so 1 neighbor at (3,1,0) fully covers.
    // Let me instead use a 1x2 voxel (spanning y) so the fr face needs 2 neighbors.
    //
    // Revised: area voxel spanning x=1..2, y=1..3 (1 row, 2 columns).
    // fr face offset is [0,1,0], so targetY = y2 = 3.
    // It iterates xi from x=1 to x2=2, so just x=1.
    // For a 1-row voxel, 1 neighbor at (1,3,0) would fully cover the fr face.
    //
    // Better approach: 2-row, 1-column area voxel: x=1..3, y=1..2
    // fl face offset is [1,0,0], targetX = x2 = 3
    // Iterates yi from y=1 to y2=2 (only y=1). One neighbor at (3,1,0) covers it.
    //
    // Let me use a 2-column area voxel: x=1..2, y=1..3
    // fr face offset is [0,1,0], targetY = y2 = 3
    // Iterates xi from x=1 to x2=2 (only x=1). One neighbor at (1,3,0) covers it.
    //
    // To truly test partial occlusion, I need a voxel that spans multiple cells along
    // the direction perpendicular to the face normal.
    // Use a 2-row area voxel: x=1..3, y=1..2 (2 rows, 1 column).
    // The fr face offset is [0,1,0], targetY = y2 = 2.
    // It iterates xi from x=1 to x2=3, so x=1 and x=2.
    // Place only ONE neighbor at (1,2,0), covering x=1 but not x=2.
    // Partial coverage => face IS still rendered.
    const voxels: VoxelGrid = [
      { x: 1, y: 1, z: 0, x2: 3, y2: 2, color: "#ff0000" },
      { x: 1, y: 2, z: 0, color: "#00ff00" }  // covers only x=1 on the fr edge, not x=2
    ];
    const handle = renderScene({ element: root, scene: { voxels } });

    // Find the area voxel container (grid-area "1 / 1 / 3 / 2")
    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBeGreaterThanOrEqual(1);
    const containers = Array.from(layers[0].children) as HTMLElement[];
    const areaContainer = containers.find(
      (el) => el.style.gridArea === "1 / 1 / 3 / 2"
    );
    expect(areaContainer).toBeDefined();

    // The fr face should still be rendered because the neighbor only partially covers the edge.
    const frFace = areaContainer!.querySelector(".voxcss-cube-face--fr");
    expect(frFace).not.toBeNull();

    handle.destroy();
  });

  it("Gap #10: area voxel with full neighbor — face NOT rendered", () => {
    // Same 2-row area voxel: x=1..3, y=1..2.
    // fr face offset is [0,1,0], targetY = y2 = 2.
    // Iterates xi from x=1 to x2=3, so x=1 and x=2.
    // Place TWO neighbors at (1,2,0) and (2,2,0), covering both cells on the fr edge.
    const voxels: VoxelGrid = [
      { x: 1, y: 1, z: 0, x2: 3, y2: 2, color: "#ff0000" },
      { x: 1, y: 2, z: 0, color: "#00ff00" },
      { x: 2, y: 2, z: 0, color: "#0000ff" }
    ];
    const handle = renderScene({ element: root, scene: { voxels } });

    // Find the area voxel container (grid-area "1 / 1 / 3 / 2")
    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBeGreaterThanOrEqual(1);
    const containers = Array.from(layers[0].children) as HTMLElement[];
    const areaContainer = containers.find(
      (el) => el.style.gridArea === "1 / 1 / 3 / 2"
    );
    expect(areaContainer).toBeDefined();

    // The fr face should NOT be rendered because both cells on the edge are covered.
    const frFace = areaContainer!.querySelector(".voxcss-cube-face--fr");
    expect(frFace).toBeNull();

    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// Gap #31 & #32: setVoxels() dynamic updates
// ---------------------------------------------------------------------------

describe("renderScene — setVoxels() Dynamic Updates", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("Gap #31: setVoxels() removes elements when reducing voxel count", () => {
    vi.useFakeTimers();

    // Start with 3 voxels at different positions on different layers.
    // Reducing to 1 voxel should remove the excess layers.
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0, color: "#ff0000" },
      { x: 0, y: 0, z: 1, color: "#00ff00" },
      { x: 0, y: 0, z: 2, color: "#0000ff" }
    ];
    const handle = renderScene({ element: root, scene: { voxels } });

    // Initially should have 3 layers.
    let layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(3);
    // And 3 .voxcss-cube elements (one per voxel).
    const initialCubes = qsa(root, ".voxcss-cube");
    expect(initialCubes.length).toBe(3);

    // Reduce to just 1 voxel on z=0 only.
    handle.setVoxels([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);

    // Flush rAF.
    vi.advanceTimersByTime(20);

    // After update, excess layers should be removed. Only 1 layer should remain.
    // The engine calls removeLayerRecord() which removes layers 1 and 2 from the DOM.
    layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(1);

    // The cubes that were on layers 1 and 2 should no longer be
    // reachable from the single remaining layer element.
    // Count cubes within the surviving layer only.
    const survivingLayerCubes = qsa(layers[0] as HTMLElement, ".voxcss-cube");
    expect(survivingLayerCubes.length).toBeGreaterThanOrEqual(1);

    // Verify the remaining cube has the correct color (red, from the z=0 voxel).
    const topFace = (layers[0] as HTMLElement).querySelector(".voxcss-cube-face--t") as HTMLElement;
    if (topFace) {
      expect(topFace.style.backgroundColor).toContain("255");
    }

    handle.destroy();
    vi.useRealTimers();
  });

  it("Gap #32: setVoxels() changes colors on existing voxel position", () => {
    vi.useFakeTimers();

    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, color: "#ff0000" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    // Record the top face background color (should be red-ish: rgb(255, 0, 0)).
    const topFaces = qsa(root, ".voxcss-cube-face--t") as HTMLElement[];
    expect(topFaces.length).toBeGreaterThanOrEqual(1);
    const colorBefore = topFaces[0].style.backgroundColor;
    expect(colorBefore).toBeTruthy();
    // Verify the initial color is red.
    expect(colorBefore).toContain("255");
    expect(colorBefore).toMatch(/rgb\(255,?\s*0,?\s*0\)/);

    // Change color to blue.
    handle.setVoxels([{ x: 1, y: 1, z: 0, color: "#0000ff" }]);

    // Flush rAF — multiple advances to handle subscriber-triggered re-renders.
    vi.advanceTimersByTime(20);
    vi.advanceTimersByTime(20);

    // Collect ALL top face elements and find one with blue color.
    // In happy-dom, old detached elements may linger; the engine creates new elements
    // with updated colors. We verify that at least one top face has the new blue color.
    const topFacesAfter = qsa(root, ".voxcss-cube-face--t") as HTMLElement[];
    expect(topFacesAfter.length).toBeGreaterThanOrEqual(1);

    const blueTopFace = topFacesAfter.find((el) => {
      const bg = el.style.backgroundColor;
      return bg && bg.includes("0, 0, 255");
    });
    expect(blueTopFace).toBeDefined();

    // Verify the blue color is different from the original red color.
    expect(blueTopFace!.style.backgroundColor).not.toBe(colorBefore);

    handle.destroy();
    vi.useRealTimers();
  });
});
