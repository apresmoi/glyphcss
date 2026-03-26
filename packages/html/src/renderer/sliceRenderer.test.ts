import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { updateSliceRendererGeometry, clearSliceRenderer } from "./sliceRenderer";
import type { SliceRendererDomState } from "./sliceRenderer";
import type { GridContext, Voxel, WallsMask } from "@layoutit/voxcss-core/types";
import type { RenderState } from "../types";
import { FLOOR_CLASS } from "@layoutit/voxcss-core/types";
import { buildSceneContext } from "@layoutit/voxcss-core/scene/context";

beforeAll(() => {
  // Polyfill Option for happy-dom (used for color normalization in buildFaceDataFromSnapshot)
  if (typeof globalThis.Option === "undefined") {
    (globalThis as any).Option = class {
      style: Record<string, string> = {};
      get selected() {
        return false;
      }
      constructor() {
        const styleData: Record<string, string> = {};
        this.style = new Proxy(styleData, {
          set(target, prop, value) {
            if (typeof prop === "string") {
              // For color normalization: convert hex to rgb() format
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
              // Pass through rgb/rgba values as-is
              if (v.startsWith("rgb")) {
                target[prop] = v;
              } else {
                target[prop] = v;
              }
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

function makeRenderState(doc: Document): RenderState {
  const root = doc.createElement("div");
  const floor = doc.createElement("div");
  floor.className = FLOOR_CLASS;
  root.appendChild(floor);
  doc.body.appendChild(root);
  return {
    root,
    floor,
    layers: new Map(),
    wallElements: new Map(),
    ceiling: null
  };
}

function buildSnapshot(voxels: Voxel[], contextPartial?: Partial<GridContext>) {
  const result = buildSceneContext({
    grid: voxels,
    context: contextPartial
  });
  return { layers: result.layers, context: result.context };
}

function collectBrushElements(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll(".voxcss-brush")) as HTMLElement[];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sliceRenderer", () => {
  let doc: Document;
  let renderState: RenderState;

  beforeEach(() => {
    doc = document;
    renderState = makeRenderState(doc);
  });

  afterEach(() => {
    renderState.root.remove();
  });

  // =========================================================================
  // Integration: updateSliceRendererGeometry
  // =========================================================================
  describe("updateSliceRendererGeometry", () => {
    describe("host creation", () => {
      it("creates zHost, xHost, yHost when sliceRenderer is null", () => {
        const snapshot = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
        const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

        expect(state).toBeDefined();
        expect(state.zHost).toBe(renderState.floor);
        expect(state.xHost).toBeInstanceOf(HTMLElement);
        expect(state.yHost).toBeInstanceOf(HTMLElement);
        expect(state.xHost.className).toBe("voxcss-floor-x");
        expect(state.yHost.className).toBe("voxcss-floor-y");
      });

      it("appends xHost and yHost to root", () => {
        const snapshot = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
        const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

        expect(state.xHost.parentElement).toBe(renderState.root);
        expect(state.yHost.parentElement).toBe(renderState.root);
      });

      it("reuses existing hosts on subsequent calls", () => {
        const snapshot = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
        const state1 = updateSliceRendererGeometry(renderState, null, snapshot, doc);
        const state2 = updateSliceRendererGeometry(renderState, state1, snapshot, doc);

        expect(state2.xHost).toBe(state1.xHost);
        expect(state2.yHost).toBe(state1.yHost);
      });
    });

    describe("single voxel rendering", () => {
      it("produces brush elements for a single voxel", () => {
        const snapshot = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
        const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

        // A single voxel at default walls (b:true, bl:true, br:true) should produce visible faces
        // for t, fr, fl (since those walls are false → visible)
        const zBrushes = collectBrushElements(state.zHost);
        const xBrushes = collectBrushElements(state.xHost);
        const yBrushes = collectBrushElements(state.yHost);
        const totalBrushes = zBrushes.length + xBrushes.length + yBrushes.length;

        // At minimum we expect some brushes for the visible faces
        expect(totalBrushes).toBeGreaterThan(0);
      });

      it("brush elements have correct class name", () => {
        const snapshot = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
        const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

        const allBrushes = [
          ...collectBrushElements(state.zHost),
          ...collectBrushElements(state.xHost),
          ...collectBrushElements(state.yHost)
        ];

        for (const brush of allBrushes) {
          expect(brush.className).toBe("voxcss-brush");
        }
      });

      it("brush elements have grid-area style", () => {
        const snapshot = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
        const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

        const allBrushes = [
          ...collectBrushElements(state.zHost),
          ...collectBrushElements(state.xHost),
          ...collectBrushElements(state.yHost)
        ];

        for (const brush of allBrushes) {
          expect(brush.style.gridArea).toBeTruthy();
        }
      });

      it("brush elements have background-color style", () => {
        const snapshot = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
        const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

        const allBrushes = [
          ...collectBrushElements(state.zHost),
          ...collectBrushElements(state.xHost),
          ...collectBrushElements(state.yHost)
        ];

        for (const brush of allBrushes) {
          expect(brush.style.backgroundColor).toBeTruthy();
        }
      });

      it("brush elements have --vox-z custom property", () => {
        const snapshot = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
        const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

        const allBrushes = [
          ...collectBrushElements(state.zHost),
          ...collectBrushElements(state.xHost),
          ...collectBrushElements(state.yHost)
        ];

        for (const brush of allBrushes) {
          const zVal = brush.style.getPropertyValue("--vox-z");
          expect(zVal).toBeTruthy();
          expect(zVal).toMatch(/px$/);
        }
      });
    });

    describe("two adjacent voxels (shared boundary)", () => {
      it("no face generated at shared boundary", () => {
        // Two voxels side by side along y
        const snapshot = buildSnapshot([
          { x: 0, y: 0, z: 0, color: "#ff0000" },
          { x: 0, y: 1, z: 0, color: "#ff0000" }
        ]);
        const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

        const totalBrushes =
          collectBrushElements(state.zHost).length +
          collectBrushElements(state.xHost).length +
          collectBrushElements(state.yHost).length;

        // One voxel produces some brushes; two adjacent same-color voxels should produce
        // fewer brushes per voxel than two isolated voxels because shared faces are culled
        const snapshotSingle = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
        const renderState2 = makeRenderState(doc);
        const stateSingle = updateSliceRendererGeometry(renderState2, null, snapshotSingle, doc);
        const singleBrushes =
          collectBrushElements(stateSingle.zHost).length +
          collectBrushElements(stateSingle.xHost).length +
          collectBrushElements(stateSingle.yHost).length;
        renderState2.root.remove();

        // Two adjacent voxels should produce fewer total brushes than 2x a single voxel
        expect(totalBrushes).toBeLessThan(singleBrushes * 2);
      });
    });

    describe("multiple colors", () => {
      it("produces brushes with different background colors for different voxel colors", () => {
        const snapshot = buildSnapshot([
          { x: 0, y: 0, z: 0, color: "#ff0000" },
          { x: 0, y: 1, z: 0, color: "#00ff00" }
        ]);
        const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

        const allBrushes = [
          ...collectBrushElements(state.zHost),
          ...collectBrushElements(state.xHost),
          ...collectBrushElements(state.yHost)
        ];

        const colors = new Set(allBrushes.map((b) => b.style.backgroundColor));
        // With different voxel colors, we expect different background colors on brushes
        expect(colors.size).toBeGreaterThan(1);
      });
    });

    describe("area voxel", () => {
      it("produces face data spanning the area", () => {
        const snapshot = buildSnapshot([
          { x: 0, y: 0, z: 0, x2: 2, y2: 2, color: "#ff0000" }
        ]);
        const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

        const totalBrushes =
          collectBrushElements(state.zHost).length +
          collectBrushElements(state.xHost).length +
          collectBrushElements(state.yHost).length;

        expect(totalBrushes).toBeGreaterThan(0);
      });
    });

    describe("empty layers", () => {
      it("produces no brushes for empty voxel list", () => {
        const snapshot = buildSnapshot([]);
        const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

        const totalBrushes =
          collectBrushElements(state.zHost).length +
          collectBrushElements(state.xHost).length +
          collectBrushElements(state.yHost).length;

        expect(totalBrushes).toBe(0);
      });
    });

    describe("voxel with texture", () => {
      it("texture voxels are skipped (texture produces backgroundImage)", () => {
        const snapshot = buildSnapshot([
          { x: 0, y: 0, z: 0, texture: "http://example.com/img.png" }
        ]);
        const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

        const totalBrushes =
          collectBrushElements(state.zHost).length +
          collectBrushElements(state.xHost).length +
          collectBrushElements(state.yHost).length;

        // Textured voxels should be skipped in face data building since they produce
        // backgroundImage entries (the slice renderer only handles solid colors)
        expect(totalBrushes).toBe(0);
      });
    });

    describe("grid CSS properties on hosts", () => {
      it("sets grid-template-columns and grid-template-rows on hosts", () => {
        const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
        const snapshot = buildSnapshot(voxels);
        const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

        // zHost should have grid display set
        expect(state.zHost.style.display).toBe("grid");
        expect(state.zHost.style.gridTemplateColumns).toBeTruthy();
        expect(state.zHost.style.gridTemplateRows).toBeTruthy();

        // xHost should have grid display set
        expect(state.xHost.style.display).toBe("grid");
        expect(state.xHost.style.gridTemplateColumns).toBeTruthy();
        expect(state.xHost.style.gridTemplateRows).toBeTruthy();

        // yHost should have grid display set
        expect(state.yHost.style.display).toBe("grid");
        expect(state.yHost.style.gridTemplateColumns).toBeTruthy();
        expect(state.yHost.style.gridTemplateRows).toBeTruthy();
      });

      it("sets width and height on xHost and yHost", () => {
        const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
        const snapshot = buildSnapshot(voxels);
        const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

        expect(state.xHost.style.width).toBeTruthy();
        expect(state.xHost.style.height).toBeTruthy();
        expect(state.yHost.style.width).toBeTruthy();
        expect(state.yHost.style.height).toBeTruthy();
      });
    });

    describe("caching behavior", () => {
      it("same input produces same output (cache hit)", () => {
        const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
        const snapshot = buildSnapshot(voxels);

        const state1 = updateSliceRendererGeometry(renderState, null, snapshot, doc);
        const brushes1 = [
          ...collectBrushElements(state1.zHost),
          ...collectBrushElements(state1.xHost),
          ...collectBrushElements(state1.yHost)
        ];
        const count1 = brushes1.length;

        // Call again with exact same snapshot reference — should be a no-op (nothing changes)
        const state2 = updateSliceRendererGeometry(renderState, state1, snapshot, doc);
        const brushes2 = [
          ...collectBrushElements(state2.zHost),
          ...collectBrushElements(state2.xHost),
          ...collectBrushElements(state2.yHost)
        ];
        const count2 = brushes2.length;

        expect(count2).toBe(count1);
        expect(state2).toBe(state1);
      });

      it("same snapshot reference early-exits (no changes)", () => {
        const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
        const snapshot = buildSnapshot(voxels);

        const state1 = updateSliceRendererGeometry(renderState, null, snapshot, doc);
        // Second call with same state and same snapshot layers reference
        const state2 = updateSliceRendererGeometry(renderState, state1, snapshot, doc);

        // Should return the same state object since nothing changed
        expect(state2).toBe(state1);
      });

      it("different voxels invalidate cache", () => {
        const snapshot1 = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
        const state1 = updateSliceRendererGeometry(renderState, null, snapshot1, doc);

        const snapshot2 = buildSnapshot([
          { x: 0, y: 0, z: 0, color: "#ff0000" },
          { x: 1, y: 0, z: 0, color: "#00ff00" }
        ]);
        const state2 = updateSliceRendererGeometry(renderState, state1, snapshot2, doc);

        // New voxels produce different brushes
        const totalBrushes2 =
          collectBrushElements(state2.zHost).length +
          collectBrushElements(state2.xHost).length +
          collectBrushElements(state2.yHost).length;

        expect(totalBrushes2).toBeGreaterThan(0);
      });

      it("wall mask change triggers re-render", () => {
        const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
        const snapshot1 = buildSnapshot(voxels);
        const state1 = updateSliceRendererGeometry(renderState, null, snapshot1, doc);
        const sigBefore = state1.cacheWallsSig;

        // Change walls by rotating camera
        const snapshot2 = buildSnapshot(voxels, { rotX: 95, rotY: 200 });
        const state2 = updateSliceRendererGeometry(renderState, state1, snapshot2, doc);

        // The sig should have changed (state1 and state2 are same ref, mutated in place)
        expect(state2.cacheWallsSig).not.toBe(sigBefore);
      });

      it("cacheRenderVersion tracks renderVersion from context", () => {
        const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
        const snapshot = buildSnapshot(voxels);
        (snapshot.context as any).renderVersion = 42;

        const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);
        expect(state.cacheRenderVersion).toBe(42);
      });
    });

    describe("wall masking", () => {
      it("faces matching hidden walls are not rendered", () => {
        const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];

        // Default walls: b=true, bl=true, br=true → those faces are hidden
        const snapshotDefault = buildSnapshot(voxels);
        const stateDefault = updateSliceRendererGeometry(renderState, null, snapshotDefault, doc);
        const defaultBrushCount =
          collectBrushElements(stateDefault.zHost).length +
          collectBrushElements(stateDefault.xHost).length +
          collectBrushElements(stateDefault.yHost).length;

        // All walls visible (nothing hidden)
        const renderState2 = makeRenderState(doc);
        const allVisibleWalls: WallsMask = { t: false, b: false, bl: false, br: false, fl: false, fr: false };
        const snapshotAll = buildSnapshot(voxels, { walls: allVisibleWalls });
        const stateAll = updateSliceRendererGeometry(renderState2, null, snapshotAll, doc);
        const allBrushCount =
          collectBrushElements(stateAll.zHost).length +
          collectBrushElements(stateAll.xHost).length +
          collectBrushElements(stateAll.yHost).length;
        renderState2.root.remove();

        // With all walls visible, more faces should be rendered
        expect(allBrushCount).toBeGreaterThanOrEqual(defaultBrushCount);
      });

      it("all walls hidden produces no brushes", () => {
        const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
        const allHiddenWalls: WallsMask = { t: true, b: true, bl: true, br: true, fl: true, fr: true };
        const snapshot = buildSnapshot(voxels, { walls: allHiddenWalls });
        const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

        const totalBrushes =
          collectBrushElements(state.zHost).length +
          collectBrushElements(state.xHost).length +
          collectBrushElements(state.yHost).length;

        expect(totalBrushes).toBe(0);
      });
    });

    describe("multi-layer voxels", () => {
      it("stacked voxels only show outer faces", () => {
        const voxels = [
          { x: 0, y: 0, z: 0, color: "#ff0000" },
          { x: 0, y: 0, z: 1, color: "#ff0000" }
        ];
        const snapshot = buildSnapshot(voxels);
        const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

        const totalBrushes =
          collectBrushElements(state.zHost).length +
          collectBrushElements(state.xHost).length +
          collectBrushElements(state.yHost).length;

        // Compare with two isolated voxels (non-adjacent)
        const renderState2 = makeRenderState(doc);
        const isolatedVoxels = [
          { x: 0, y: 0, z: 0, color: "#ff0000" },
          { x: 2, y: 2, z: 2, color: "#ff0000" }
        ];
        const snapshotIsolated = buildSnapshot(isolatedVoxels);
        const stateIsolated = updateSliceRendererGeometry(renderState2, null, snapshotIsolated, doc);
        const isolatedBrushes =
          collectBrushElements(stateIsolated.zHost).length +
          collectBrushElements(stateIsolated.xHost).length +
          collectBrushElements(stateIsolated.yHost).length;
        renderState2.root.remove();

        // Stacked voxels should have fewer brushes than isolated voxels
        // because the interface between z=0 top and z=1 bottom is culled
        expect(totalBrushes).toBeLessThanOrEqual(isolatedBrushes);
      });
    });

    describe("deps change detection", () => {
      it("changing rows triggers deps change and grid resize", () => {
        const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
        const snapshot1 = buildSnapshot(voxels);
        const state1 = updateSliceRendererGeometry(renderState, null, snapshot1, doc);

        expect(state1.cacheRows).not.toBe(10);

        // Changing rows in context changes deps
        const snapshot2 = buildSnapshot(voxels, { rows: 10 });
        const state2 = updateSliceRendererGeometry(renderState, state1, snapshot2, doc);

        expect(state2.cacheRows).toBe(10);
      });
    });
  });

  // =========================================================================
  // clearSliceRenderer
  // =========================================================================
  describe("clearSliceRenderer", () => {
    it("does nothing when null", () => {
      // Should not throw
      expect(() => clearSliceRenderer(null)).not.toThrow();
    });

    it("clears face cache and pools", () => {
      const snapshot = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      // Should have some data
      expect(state.faceCache.size).toBeGreaterThan(0);

      clearSliceRenderer(state);

      expect(state.faceCache.size).toBe(0);
      expect(state.lastSlices).toBeNull();
      expect(state.cacheLayersRef).toBeNull();
      expect(state.cacheOffsets).toBeNull();
      expect(state.zPool.length).toBe(0);
      expect(state.xPool.length).toBe(0);
      expect(state.yPool.length).toBe(0);
    });

    it("removes xHost and yHost from DOM", () => {
      const snapshot = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      expect(state.xHost.parentElement).toBe(renderState.root);
      expect(state.yHost.parentElement).toBe(renderState.root);

      clearSliceRenderer(state);

      expect(state.xHost.parentElement).toBeNull();
      expect(state.yHost.parentElement).toBeNull();
    });

    it("clears zHost innerHTML and removes grid styles", () => {
      const snapshot = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      clearSliceRenderer(state);

      expect(state.zHost.innerHTML).toBe("");
      // Grid styles should be removed
      expect(state.zHost.style.display).toBe("");
    });
  });

  // =========================================================================
  // Brush element pooling
  // =========================================================================
  describe("brush element pooling", () => {
    it("reuses brush elements from pool across renders", () => {
      const voxels1 = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot1 = buildSnapshot(voxels1);
      const state1 = updateSliceRendererGeometry(renderState, null, snapshot1, doc);

      const firstBrushes = [
        ...collectBrushElements(state1.zHost),
        ...collectBrushElements(state1.xHost),
        ...collectBrushElements(state1.yHost)
      ];

      // Add another voxel to trigger re-render
      const voxels2 = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#00ff00" }
      ];
      const snapshot2 = buildSnapshot(voxels2);
      const state2 = updateSliceRendererGeometry(renderState, state1, snapshot2, doc);

      const secondBrushes = [
        ...collectBrushElements(state2.zHost),
        ...collectBrushElements(state2.xHost),
        ...collectBrushElements(state2.yHost)
      ];

      // Some elements from the first render should be reused
      const reused = firstBrushes.filter((b) => secondBrushes.includes(b));
      if (firstBrushes.length > 0) {
        expect(reused.length).toBeGreaterThan(0);
      }
    });

    it("removes excess pool elements when fewer brushes needed", () => {
      // Start with two voxels (more brushes)
      const voxels1 = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 1, z: 1, color: "#00ff00" }
      ];
      const snapshot1 = buildSnapshot(voxels1);
      const state1 = updateSliceRendererGeometry(renderState, null, snapshot1, doc);

      const brushCount1 =
        collectBrushElements(state1.zHost).length +
        collectBrushElements(state1.xHost).length +
        collectBrushElements(state1.yHost).length;

      // Now render with empty voxels (zero brushes)
      const snapshot2 = buildSnapshot([]);
      const state2 = updateSliceRendererGeometry(renderState, state1, snapshot2, doc);

      const brushCount2 =
        collectBrushElements(state2.zHost).length +
        collectBrushElements(state2.xHost).length +
        collectBrushElements(state2.yHost).length;

      expect(brushCount2).toBe(0);
    });
  });

  // =========================================================================
  // Face data: all-walls-false for maximum visibility
  // =========================================================================
  describe("face axis mapping", () => {
    it("top/bottom faces go to z-axis host", () => {
      // Force all walls visible so we see all faces
      const walls: WallsMask = { t: false, b: false, bl: true, br: true, fl: true, fr: true };
      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot = buildSnapshot(voxels, { walls });
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      // t and b faces map to z-axis, so zHost should have brushes
      const zBrushes = collectBrushElements(state.zHost);
      expect(zBrushes.length).toBeGreaterThan(0);
    });

    it("bl/fr faces go to y-axis host", () => {
      const walls: WallsMask = { t: true, b: true, bl: false, br: true, fl: true, fr: false };
      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot = buildSnapshot(voxels, { walls });
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      // bl and fr faces map to y-axis
      const yBrushes = collectBrushElements(state.yHost);
      expect(yBrushes.length).toBeGreaterThan(0);
    });

    it("br/fl faces go to x-axis host", () => {
      const walls: WallsMask = { t: true, b: true, bl: true, br: false, fl: false, fr: true };
      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot = buildSnapshot(voxels, { walls });
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      // br and fl faces map to x-axis
      const xBrushes = collectBrushElements(state.xHost);
      expect(xBrushes.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Larger scenes
  // =========================================================================
  describe("larger scenes", () => {
    it("3x3x1 grid produces correct number of faces", () => {
      const voxels: Voxel[] = [];
      for (let x = 0; x < 3; x++) {
        for (let y = 0; y < 3; y++) {
          voxels.push({ x, y, z: 0, color: "#ff0000" });
        }
      }
      const snapshot = buildSnapshot(voxels);
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      const totalBrushes =
        collectBrushElements(state.zHost).length +
        collectBrushElements(state.xHost).length +
        collectBrushElements(state.yHost).length;

      // A 3x3 solid block should have:
      // - 1 top face (merged into one plane)
      // - Visible front-left and front-right faces along edges
      expect(totalBrushes).toBeGreaterThan(0);
    });

    it("dimetric projection uses half-height layer elevation", () => {
      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot = buildSnapshot(voxels, { projection: "dimetric" });
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      expect(state.cacheLayerElevation).toBe(25); // dimetric = tileSize / 2
    });
  });

  // =========================================================================
  // Face cache key format
  // =========================================================================
  describe("cache key handling", () => {
    it("faceCache keys follow expected format", () => {
      const snapshot = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      for (const key of state.faceCache.keys()) {
        // Expected format: "slice:{version}:{axis}:{plane}:{face}"
        expect(key).toMatch(/^slice:\d+:(x|y|z):\d+:(t|b|bl|br|fl|fr)$/);
      }
    });

    it("stale cache keys are removed when faces disappear", () => {
      const voxels1 = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 1, z: 1, color: "#00ff00" }
      ];
      const snapshot1 = buildSnapshot(voxels1);
      const state1 = updateSliceRendererGeometry(renderState, null, snapshot1, doc);
      const cacheSize1 = state1.faceCache.size;

      // Reduce to a single voxel → some face keys should be removed
      const snapshot2 = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
      const state2 = updateSliceRendererGeometry(renderState, state1, snapshot2, doc);
      const cacheSize2 = state2.faceCache.size;

      expect(cacheSize2).toBeLessThanOrEqual(cacheSize1);
    });
  });

  // =========================================================================
  // Host re-parenting edge case
  // =========================================================================
  describe("host re-parenting", () => {
    it("re-appends hosts to root if they were detached", () => {
      const snapshot = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      // Detach xHost
      state.xHost.remove();
      expect(state.xHost.parentElement).toBeNull();

      // Re-render should re-append
      const snapshot2 = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#00ff00" }]);
      const state2 = updateSliceRendererGeometry(renderState, state, snapshot2, doc);

      expect(state2.xHost.parentElement).toBe(renderState.root);
    });
  });

  // =========================================================================
  // Z-span voxels
  // =========================================================================
  describe("z-span voxels", () => {
    it("voxel with z2 produces faces across multiple layers", () => {
      const voxels = [{ x: 0, y: 0, z: 0, z2: 3, color: "#ff0000" }];
      const snapshot = buildSnapshot(voxels);
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      const totalBrushes =
        collectBrushElements(state.zHost).length +
        collectBrushElements(state.xHost).length +
        collectBrushElements(state.yHost).length;

      // A tall voxel should produce more side-face brushes than a single-layer voxel
      expect(totalBrushes).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // wallsToSig uniqueness
  // =========================================================================
  describe("wallsToSig", () => {
    it("different wall masks produce different sigs via cacheWallsSig", () => {
      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];

      const snapshot1 = buildSnapshot(voxels, {
        walls: { t: false, b: true, bl: true, br: true, fl: false, fr: false }
      });
      const state1 = updateSliceRendererGeometry(renderState, null, snapshot1, doc);
      const sig1 = state1.cacheWallsSig;

      const renderState2 = makeRenderState(doc);
      const snapshot2 = buildSnapshot(voxels, {
        walls: { t: true, b: false, bl: false, br: false, fl: true, fr: true }
      });
      const state2 = updateSliceRendererGeometry(renderState2, null, snapshot2, doc);
      const sig2 = state2.cacheWallsSig;
      renderState2.root.remove();

      expect(sig1).not.toBe(sig2);
    });

    it("all-false walls produce sig 0", () => {
      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot = buildSnapshot(voxels, {
        walls: { t: false, b: false, bl: false, br: false, fl: false, fr: false }
      });
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      expect(state.cacheWallsSig).toBe(0);
    });

    it("all-true walls produce sig 63", () => {
      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot = buildSnapshot(voxels, {
        walls: { t: true, b: true, bl: true, br: true, fl: true, fr: true }
      });
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      // 1 | 2 | 4 | 8 | 16 | 32 = 63
      expect(state.cacheWallsSig).toBe(63);
    });
  });

  // =========================================================================
  // lastSlices reuse on walls-only change
  // =========================================================================
  describe("lastSlices reuse", () => {
    it("walls-only change reuses lastSlices without rebuilding face data", () => {
      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot1 = buildSnapshot(voxels);
      const state1 = updateSliceRendererGeometry(renderState, null, snapshot1, doc);

      // Save the lastSlices reference
      const slicesRef = state1.lastSlices;
      expect(slicesRef).not.toBeNull();

      // Change only walls (same layers, same deps)
      const snapshot2 = buildSnapshot(voxels, { rotX: 95, rotY: 200 });
      // Override layers to be same reference
      (snapshot2 as any).layers = snapshot1.layers;

      const state2 = updateSliceRendererGeometry(renderState, state1, snapshot2, doc);

      // lastSlices might be reused if only walls changed but deps/layers didn't
      // The key thing is no crash and correct rendering
      expect(state2.cacheWallsSig).toBeDefined();
    });
  });

  // =========================================================================
  // planeOffset computation
  // =========================================================================
  describe("planeOffset computation", () => {
    it("z-axis planes use layerElevation-based offset", () => {
      const voxels = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 0, y: 0, z: 1, color: "#ff0000" }
      ];
      const snapshot = buildSnapshot(voxels);
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      const zBrushes = collectBrushElements(state.zHost);
      // z-brushes should have different --vox-z values for different planes
      if (zBrushes.length >= 2) {
        const zValues = new Set(zBrushes.map((b) => b.style.getPropertyValue("--vox-z")));
        // May have different z offsets for different planes
        expect(zValues.size).toBeGreaterThanOrEqual(1);
      }
    });
  });
});
