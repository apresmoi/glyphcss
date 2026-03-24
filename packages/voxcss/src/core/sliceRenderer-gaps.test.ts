/**
 * Slice renderer gap tests for VoxCSS.
 *
 * Gap #96:  Single-color -> 1 brush per face plane
 * Gap #98:  verify() confirms brushes reproduce buffer (no verification errors)
 * Gap #99:  Row merging — 3 voxels in a row produce 1 brush per face plane
 * Gap #100: Column merging — 3 voxels in a column produce 1 brush per face plane
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { updateSliceRendererGeometry } from "./sliceRenderer";
import type { SliceRendererDomState } from "./sliceRenderer";
import type { GridContext, RenderState, Voxel, WallsMask } from "./types";
import { FLOOR_CLASS } from "./types";
import { buildSceneContext } from "./context";

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

/**
 * Group brushes by their --vox-z value (which identifies the plane offset).
 * Returns a map from z-offset string to array of brush elements.
 */
function groupBrushesByPlane(host: HTMLElement): Map<string, HTMLElement[]> {
  const brushes = collectBrushElements(host);
  const groups = new Map<string, HTMLElement[]>();
  for (const brush of brushes) {
    const z = brush.style.getPropertyValue("--vox-z");
    const list = groups.get(z);
    if (list) list.push(brush);
    else groups.set(z, [brush]);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("sliceRenderer — gap tests", () => {
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
  // Gap #96: Single-color -> 1 brush per face plane
  // =========================================================================
  describe("Gap #96: single-color produces 1 brush per face plane", () => {
    it("a single voxel produces exactly 1 brush per visible face plane", () => {
      const snapshot = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      // For each axis host, check that each plane (identified by --vox-z) has exactly 1 brush.
      // A single same-color face on a plane should be covered by 1 brush.
      for (const host of [state.zHost, state.xHost, state.yHost]) {
        const groups = groupBrushesByPlane(host);
        for (const [plane, brushes] of groups) {
          expect(brushes.length).toBe(1);
        }
      }
    });
  });

  // =========================================================================
  // Gap #98: verify() confirms brushes reproduce buffer
  // =========================================================================
  describe("Gap #98: verify() confirms brushes reproduce buffer", () => {
    it("rendering a scene with 3d merge does not throw verification errors", () => {
      // The slice planner internally calls verify() during buildSlicePlan/evaluateVariant.
      // If verification fails, the candidate is discarded. If ALL variants fail verification,
      // the plan would have empty brushes. We test that a non-trivial scene produces
      // valid plans (non-empty brushes), which means verify() passed for at least one variant.
      const voxels: Voxel[] = [];
      for (let x = 0; x < 3; x++) {
        for (let y = 0; y < 3; y++) {
          for (let z = 0; z < 2; z++) {
            voxels.push({ x, y, z, color: z === 0 ? "#ff0000" : "#00ff00" });
          }
        }
      }

      // This should not throw.
      const snapshot = buildSnapshot(voxels);
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      const totalBrushes =
        collectBrushElements(state.zHost).length +
        collectBrushElements(state.xHost).length +
        collectBrushElements(state.yHost).length;

      // A 3x3x2 multi-color scene must produce brushes — if verify() had failed for all
      // variants, we would get 0 brushes for some face planes.
      expect(totalBrushes).toBeGreaterThan(0);

      // Additionally, verify that the faceCache has entries (plans were cached successfully).
      expect(state.faceCache.size).toBeGreaterThan(0);

      // Check that all cached plans have non-empty brushes (verify passed).
      for (const [key, cached] of state.faceCache) {
        // Only check plans for faces that are not hidden by the wall mask.
        const faceStr = key.split(":").pop() as string;
        const walls = snapshot.context.walls;
        if (walls[faceStr as keyof typeof walls]) continue;
        expect(cached.plan.brushes.length).toBeGreaterThan(0);
      }
    });

    it("complex multi-color scene verification succeeds", () => {
      // Create a checkerboard pattern that exercises the verify path more thoroughly.
      const voxels: Voxel[] = [];
      const colors = ["#ff0000", "#00ff00", "#0000ff", "#ffff00"];
      for (let x = 0; x < 4; x++) {
        for (let y = 0; y < 4; y++) {
          voxels.push({ x, y, z: 0, color: colors[(x + y) % colors.length] });
        }
      }

      // Should not throw.
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
  // Gap #99: Row merging
  // =========================================================================
  describe("Gap #99: row merging — 3 voxels in a row", () => {
    it("3 same-color voxels in a row produce 1 brush for the top face plane", () => {
      // 3 voxels along y-axis (same x, same z, different y), same color.
      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 0, y: 1, z: 0, color: "#ff0000" },
        { x: 0, y: 2, z: 0, color: "#ff0000" }
      ];

      const snapshot = buildSnapshot(voxels);
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      // The top face (z-axis) should have 1 brush spanning all 3 columns.
      // Top face maps to zHost. The plane for "t" face at z=0 is plane=1 (z+1).
      const zGroups = groupBrushesByPlane(state.zHost);

      // There should be exactly 1 z-plane for the top face.
      expect(zGroups.size).toBe(1);

      // The single plane should have exactly 1 brush (merged across the row).
      for (const [, brushes] of zGroups) {
        expect(brushes.length).toBe(1);

        // The brush grid-area should span all 3 columns.
        const gridArea = brushes[0].style.gridArea;
        // grid-area format: "row / col / row2 / col2"
        const parts = gridArea.split("/").map((s) => parseInt(s.trim(), 10));
        const colSpan = parts[3] - parts[1];
        expect(colSpan).toBe(3);
      }
    });
  });

  // =========================================================================
  // Gap #100: Column merging
  // =========================================================================
  describe("Gap #100: column merging — 3 voxels in a column", () => {
    it("3 same-color voxels in a column produce 1 brush for the top face plane", () => {
      // 3 voxels along x-axis (same y, same z, different x), same color.
      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#ff0000" },
        { x: 2, y: 0, z: 0, color: "#ff0000" }
      ];

      const snapshot = buildSnapshot(voxels);
      const state = updateSliceRendererGeometry(renderState, null, snapshot, doc);

      // The top face (z-axis) should have 1 brush spanning all 3 rows.
      const zGroups = groupBrushesByPlane(state.zHost);

      // There should be exactly 1 z-plane for the top face.
      expect(zGroups.size).toBe(1);

      // The single plane should have exactly 1 brush (merged across the column).
      for (const [, brushes] of zGroups) {
        expect(brushes.length).toBe(1);

        // The brush grid-area should span all 3 rows.
        const gridArea = brushes[0].style.gridArea;
        // grid-area format: "row / col / row2 / col2"
        const parts = gridArea.split("/").map((s) => parseInt(s.trim(), 10));
        const rowSpan = parts[2] - parts[0];
        expect(rowSpan).toBe(3);
      }
    });
  });
});
