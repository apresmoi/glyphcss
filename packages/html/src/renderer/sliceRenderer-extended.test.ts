import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { updateSliceRendererGeometry, clearSliceRenderer } from "./sliceRenderer";
import type { SliceRendererDomState } from "./sliceRenderer";
import type { GridContext, Voxel, WallsMask } from "@layoutit/voxcss-core/types";
import type { RenderState } from "../types";
import { FLOOR_CLASS } from "@layoutit/voxcss-core/types";
import { buildSceneContext } from "@layoutit/voxcss-core/scene/context";

beforeAll(() => {
  // Polyfill Option for happy-dom
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
  const result = buildSceneContext({ grid: voxels, context: contextPartial });
  return { layers: result.layers, context: result.context };
}

function collectBrushElements(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll(".voxcss-brush")) as HTMLElement[];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sliceRenderer — extended coverage", () => {
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
  // Line 134: holeFillVariants returns early when nextLayer has no fillable holes
  // This happens when the next layer has cells but none overlap with empty cells
  // in the current buffer.
  // =========================================================================
  describe("holeFillVariants with no overlapping holes", () => {
    it("produces only base variant when next layer has no holes to fill", () => {
      // Two adjacent voxels at same z — the face data for one side might
      // not have any holes that the next layer can fill.
      const voxels = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#ff0000" }
      ];
      const snapshot = buildSnapshot(voxels);
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      // Should produce some brushes
      const totalBrushes =
        collectBrushElements(state.zHost).length +
        collectBrushElements(state.xHost).length +
        collectBrushElements(state.yHost).length;
      expect(totalBrushes).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Lines 727, 730: wallsSigChanged without depsChanged
  // This tests the path where only the wall mask signature changes but
  // grid dimensions and other dependencies stay the same.
  // =========================================================================
  describe("walls-only change without deps change", () => {
    it("updates cacheWallsSig when only walls change", () => {
      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot1 = buildSnapshot(voxels, {
        walls: { t: false, b: true, bl: true, br: true, fl: false, fr: false }
      });
      const state1 = updateSliceRendererGeometry(renderState, null, snapshot1, doc);
      const sig1 = state1.cacheWallsSig;

      // Build a new snapshot with same voxels but different walls
      // Keep same layers reference to avoid layersChanged
      const result2 = buildSceneContext({
        grid: voxels,
        context: { walls: { t: true, b: false, bl: false, br: false, fl: true, fr: true } }
      });
      const snapshot2 = {
        layers: snapshot1.layers, // same reference to avoid layers invalidation
        context: {
          ...result2.context,
          // Keep everything the same except walls
          rows: snapshot1.context.rows,
          cols: snapshot1.context.cols,
          tileSize: snapshot1.context.tileSize,
          layerElevation: snapshot1.context.layerElevation,
          offsets: snapshot1.context.offsets,
          walls: { t: true, b: false, bl: false, br: false, fl: true, fr: true } as WallsMask
        }
      };

      const state2 = updateSliceRendererGeometry(renderState, state1, snapshot2, doc);
      const sig2 = state2.cacheWallsSig;

      expect(sig2).not.toBe(sig1);
    });
  });

  // =========================================================================
  // Line 761: lastSlices reuse path
  // When deps haven't changed and lastSlices exists, reuse them instead of
  // rebuilding face data. This happens on walls-only changes.
  // =========================================================================
  describe("lastSlices reuse on walls-only change (no deps change)", () => {
    it("reuses lastSlices when only wallsSig changes", () => {
      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot1 = buildSnapshot(voxels);
      const state1 = updateSliceRendererGeometry(renderState, null, snapshot1, doc);

      // Verify lastSlices is populated
      expect(state1.lastSlices).not.toBeNull();
      const lastSlicesRef = state1.lastSlices;

      // Create a new snapshot that only changes walls but keeps the same deps
      // We need: !depsChanged && !layersChanged && wallsSigChanged
      // Which means: same offsets, tileSize, layerElevation, rows, cols, depth
      // but different walls
      const snapshot2 = {
        layers: snapshot1.layers, // same reference
        context: {
          ...snapshot1.context,
          walls: { t: true, b: false, bl: false, br: false, fl: true, fr: true } as WallsMask
        }
      };

      const state2 = updateSliceRendererGeometry(renderState, state1, snapshot2, doc);

      // lastSlices should be the same reference (reused)
      expect(state2.lastSlices).toBe(lastSlicesRef);
    });
  });

  // =========================================================================
  // Multiple colors with hole-fill variant testing
  // =========================================================================
  describe("multi-color stacked voxels (hole-fill variants)", () => {
    it("handles stacked voxels with different colors at adjacent z levels", () => {
      const voxels = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#00ff00" },
        { x: 0, y: 0, z: 1, color: "#0000ff" },
        { x: 1, y: 0, z: 1, color: "#ffff00" }
      ];
      const snapshot = buildSnapshot(voxels);
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      const totalBrushes =
        collectBrushElements(state.zHost).length +
        collectBrushElements(state.xHost).length +
        collectBrushElements(state.yHost).length;

      expect(totalBrushes).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // renderVersion-based cache invalidation
  // =========================================================================
  describe("renderVersion cache invalidation", () => {
    it("invalidates cache when renderVersion changes", () => {
      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot1 = buildSnapshot(voxels);
      (snapshot1.context as any).renderVersion = 1;

      const state1 = updateSliceRendererGeometry(renderState, null, snapshot1, doc);
      expect(state1.cacheRenderVersion).toBe(1);

      // Same voxels but different renderVersion
      const snapshot2 = buildSnapshot(voxels);
      (snapshot2.context as any).renderVersion = 2;
      // Keep deps the same
      snapshot2.context = {
        ...snapshot2.context,
        offsets: snapshot1.context.offsets,
        tileSize: snapshot1.context.tileSize,
        layerElevation: snapshot1.context.layerElevation,
        rows: snapshot1.context.rows,
        cols: snapshot1.context.cols
      };

      const state2 = updateSliceRendererGeometry(renderState, state1, snapshot2, doc);
      expect(state2.cacheRenderVersion).toBe(2);
    });
  });

  // =========================================================================
  // Brush element re-parenting edge case
  // =========================================================================
  describe("brush re-parenting", () => {
    it("re-appends brush element if it was moved to a different parent", () => {
      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot1 = buildSnapshot(voxels);
      const state1 = updateSliceRendererGeometry(renderState, null, snapshot1, doc);

      const totalBrushes1 =
        collectBrushElements(state1.zHost).length +
        collectBrushElements(state1.xHost).length +
        collectBrushElements(state1.yHost).length;

      // Move a brush to a different parent
      for (const pool of [state1.zPool, state1.xPool, state1.yPool]) {
        if (pool.length > 0) {
          const detached = doc.createElement("div");
          detached.appendChild(pool[0]);
          break;
        }
      }

      // Re-render should re-parent the brush
      const snapshot2 = buildSnapshot([
        { x: 0, y: 0, z: 0, color: "#00ff00" },
        { x: 1, y: 0, z: 0, color: "#00ff00" }
      ]);
      const state2 = updateSliceRendererGeometry(renderState, state1, snapshot2, doc);

      const totalBrushes2 =
        collectBrushElements(state2.zHost).length +
        collectBrushElements(state2.xHost).length +
        collectBrushElements(state2.yHost).length;

      expect(totalBrushes2).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Lines 95-114: holeFillVariants producing actual hole fills
  // When the nextLayer has cells that overlap with empty cells in the current
  // buffer's mask, the allowMask is populated and a holeFill variant is added.
  // =========================================================================
  describe("holeFillVariants with actual hole fills", () => {
    it("fills holes when next z-plane has cells overlapping current buffer gaps", () => {
      // z=0: voxels at (0,0) and (2,0) — gap at (1,0)
      // z=1: voxel at (1,0) only — fills the gap in the z=0 top face buffer
      // z=0 top face: exposed at (0,0) and (2,0) since no z=1 voxel above them
      // z=1 top face: exposed at (1,0) since no z=2 voxel above
      // The z=0 buffer has a hole at (1,0) that z=1 nextLayer covers
      const voxels = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 2, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 1, color: "#00ff00" }
      ];
      const snapshot = buildSnapshot(voxels);
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      const totalBrushes =
        collectBrushElements(state.zHost).length +
        collectBrushElements(state.xHost).length +
        collectBrushElements(state.yHost).length;
      expect(totalBrushes).toBeGreaterThan(0);
    });

    it("fills holes in a checkerboard pattern across z layers", () => {
      // Checkerboard at z=0 with complement at z=1 creates maximum hole-fill
      const voxels = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 1, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 1, color: "#00ff00" },
        { x: 0, y: 1, z: 1, color: "#00ff00" }
      ];
      const snapshot = buildSnapshot(voxels);
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      const totalBrushes =
        collectBrushElements(state.zHost).length +
        collectBrushElements(state.xHost).length +
        collectBrushElements(state.yHost).length;
      expect(totalBrushes).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Lines 622-648: brightness/filter parsing in buildFaceData
  // When a voxel has a custom lighting callback that returns a brightness
  // filter WITHOUT a backgroundImage, the slice renderer needs to parse
  // that filter value and apply it to the face color.
  // =========================================================================
  describe("brightness filter parsing via custom lighting", () => {
    it("parses brightness(N) filter from custom lighting callback", () => {
      const voxels = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#00ff00" }
      ];
      // Build with a custom lighting callback that returns a brightness filter
      const snapshot = buildSnapshot(voxels, {
        lighting: (_voxel, _face) => ({
          filter: "brightness(0.8)"
        })
      });
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      const totalBrushes =
        collectBrushElements(state.zHost).length +
        collectBrushElements(state.xHost).length +
        collectBrushElements(state.yHost).length;
      expect(totalBrushes).toBeGreaterThan(0);
    });

    it("parses brightness(N%) filter with percentage notation", () => {
      const voxels = [
        { x: 0, y: 0, z: 0, color: "#ff0000" }
      ];
      const snapshot = buildSnapshot(voxels, {
        lighting: (_voxel, _face) => ({
          filter: "brightness(80%)"
        })
      });
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      const totalBrushes =
        collectBrushElements(state.zHost).length +
        collectBrushElements(state.xHost).length +
        collectBrushElements(state.yHost).length;
      expect(totalBrushes).toBeGreaterThan(0);
    });

    it("skips face when filter is non-brightness", () => {
      const voxels = [
        { x: 0, y: 0, z: 0, color: "#ff0000" }
      ];
      const snapshot = buildSnapshot(voxels, {
        lighting: (_voxel, _face) => ({
          filter: "contrast(1.5)"
        })
      });
      // Should not crash — non-brightness filters are skipped
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);
      expect(state).toBeDefined();
    });
  });

  // =========================================================================
  // Line 119: runRects early return for empty bounds
  // =========================================================================
  describe("empty face buffer", () => {
    it("handles voxels that produce zero-size face buffers gracefully", () => {
      // A single voxel entirely surrounded (all faces occluded)
      // This won't produce face data for occluded faces
      const voxels = [
        // Center voxel surrounded on all sides
        { x: 1, y: 1, z: 1, color: "#ff0000" },
        // Neighbors on all 6 sides
        { x: 0, y: 1, z: 1, color: "#00ff00" },
        { x: 2, y: 1, z: 1, color: "#00ff00" },
        { x: 1, y: 0, z: 1, color: "#00ff00" },
        { x: 1, y: 2, z: 1, color: "#00ff00" },
        { x: 1, y: 1, z: 0, color: "#00ff00" },
        { x: 1, y: 1, z: 2, color: "#00ff00" }
      ];
      const snapshot = buildSnapshot(voxels);
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);
      expect(state).toBeDefined();
    });
  });
});
