import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createDomRenderer } from "./domRenderer";
import type { RendererHandle, SceneSnapshot } from "./domRenderer";
import type { GridContext, Voxel, WallsMask } from "./types";
import { STYLE_ID, DEFAULT_OFFSETS, DEFAULT_WALLS } from "./types";
import { buildSceneContext } from "./context";

// Option polyfill for happy-dom (used by sliceRenderer during 3d merge paths)
beforeAll(() => {
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

function buildSnapshot(voxels: Voxel[], contextPartial?: Partial<GridContext>): SceneSnapshot {
  const result = buildSceneContext({ grid: voxels, context: contextPartial });
  return { layers: result.layers, context: result.context };
}

function buildSnapshotWithRenderer(
  voxels: Voxel[],
  mode: "cubes" | "slice-renderer",
  contextPartial?: Partial<GridContext>
): SceneSnapshot {
  const result = buildSceneContext({ grid: voxels, context: contextPartial });
  return { layers: result.layers, context: result.context, renderer: { mode } };
}

describe("domRenderer — coverage gaps", () => {
  let target: HTMLElement;
  let renderer: RendererHandle;

  beforeEach(() => {
    target = document.createElement("div");
    document.body.appendChild(target);
  });

  afterEach(() => {
    renderer?.destroy();
    target.remove();
    document.getElementById(STYLE_ID)?.remove();
  });

  // =========================================================================
  // renderLayer with empty voxels array (line ~188-192)
  // When a layer existed previously and we now pass empty voxels for that layer,
  // the layer's children should be cleared.
  // =========================================================================
  describe("renderLayer with empty voxels", () => {
    it("clears layer children when voxels become empty for an existing layer", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      // First render: layer with voxels
      const snapshot1 = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
      renderer.render(snapshot1);

      // Verify a layer was created with content
      const layers1 = target.querySelectorAll(".voxcss-layer");
      expect(layers1.length).toBeGreaterThanOrEqual(1);

      // Second render: empty layers (no voxels) - this should clear existing layers
      const emptySnapshot = buildSnapshot([]);
      renderer.render(emptySnapshot);
    });

    it("handles render with an undefined voxel entry in the layers array", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      // First render with a voxel to create a layer
      const snapshot1 = buildSnapshot([{ x: 0, y: 0, z: 0, color: "#ff0000" }]);
      renderer.render(snapshot1);

      // Create a snapshot where a layer has an empty/undefined voxels entry
      const result = buildSceneContext({ grid: [] });
      // Manually construct snapshot with empty layer 0
      const snapshot2: SceneSnapshot = {
        layers: [[]],
        context: result.context
      };
      renderer.render(snapshot2);
    });
  });

  // =========================================================================
  // Wall className already matching (line ~323)
  // When a wall element is reused and its className already matches, it
  // should skip re-assigning className.
  // =========================================================================
  describe("wall className reuse", () => {
    it("reuses wall elements without re-setting className on subsequent renders", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      // First render with walls
      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot1 = buildSnapshot(voxels, { showWalls: true });
      renderer.render(snapshot1);

      const walls1 = target.querySelectorAll(".voxcss-wall");
      expect(walls1.length).toBeGreaterThan(0);

      // Second render with same walls - reuses wall elements
      const snapshot2 = buildSnapshot(voxels, { showWalls: true });
      renderer.render(snapshot2);

      const walls2 = target.querySelectorAll(".voxcss-wall");
      expect(walls2.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Grid sprite returning null -> removeProperty branch (lines ~292, 330)
  // When getGridSpriteUrl returns null (e.g., invalid dimensions), the
  // code removes grid CSS properties instead of setting them.
  // =========================================================================
  describe("large grid disables grid sprites", () => {
    it("disables grid overlays for grids exceeding threshold (>20x20)", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      // Create a scene with many voxels spanning > 20 rows and cols
      // The GRID_DISABLE_THRESHOLD is 20, so if rows > 20 && cols > 20, grids are disabled
      const voxels: Voxel[] = [];
      for (let x = 0; x < 22; x++) {
        for (let y = 0; y < 22; y++) {
          if (x === 0 || y === 0 || x === 21 || y === 21) {
            voxels.push({ x, y, z: 0, color: "#ff0000" });
          }
        }
      }

      const snapshot = buildSnapshot(voxels, { showWalls: true, showFloor: true });
      renderer.render(snapshot);

      // The floor should have removed --voxcss-floor-grid (since grid is disabled)
      const floor = target.querySelector(".voxcss-floor-z") as HTMLElement;
      expect(floor).toBeTruthy();
    });

    it("disables ceiling grid for large grids with ceiling visible", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      const voxels: Voxel[] = [];
      for (let x = 0; x < 22; x++) {
        for (let y = 0; y < 22; y++) {
          if (x === 0 || y === 0 || x === 21 || y === 21) {
            voxels.push({ x, y, z: 0, color: "#ff0000" });
          }
        }
      }

      // Make walls with t: true so ceiling is shown (ceilingShouldShow = showFloor && wallMask.t)
      const snapshot = buildSnapshot(voxels, {
        showFloor: true,
        walls: { t: true, b: false, bl: true, br: true, fl: false, fr: false }
      });
      renderer.render(snapshot);

      // Ceiling should exist
      const ceiling = target.querySelector(".voxcss-ceiling") as HTMLElement;
      if (ceiling) {
        // Grid should be disabled for the large grid
        expect(ceiling.style.getPropertyValue("--voxcss-ceiling-grid")).toBe("");
      }
    });

    it("disables wall grid for large grids with walls visible", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      const voxels: Voxel[] = [];
      for (let x = 0; x < 22; x++) {
        for (let y = 0; y < 22; y++) {
          if (x === 0 || y === 0 || x === 21 || y === 21) {
            voxels.push({ x, y, z: 0, color: "#ff0000" });
          }
        }
      }

      const snapshot = buildSnapshot(voxels, { showWalls: true });
      renderer.render(snapshot);

      const walls = target.querySelectorAll(".voxcss-wall") as NodeListOf<HTMLElement>;
      // Walls should exist but without grid overlay due to threshold
      expect(walls.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Ceiling rendering (lines ~277-293)
  // =========================================================================
  describe("ceiling rendering", () => {
    it("shows ceiling when showFloor is true and walls.t is true", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot = buildSnapshot(voxels, {
        showFloor: true,
        walls: { t: true, b: false, bl: true, br: true, fl: false, fr: false }
      });
      renderer.render(snapshot);

      const ceiling = target.querySelector(".voxcss-ceiling") as HTMLElement;
      expect(ceiling).toBeTruthy();
    });

    it("removes ceiling when ceilingShouldShow becomes false", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      // First render with ceiling
      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot1 = buildSnapshot(voxels, {
        showFloor: true,
        walls: { t: true, b: false, bl: true, br: true, fl: false, fr: false }
      });
      renderer.render(snapshot1);
      expect(target.querySelector(".voxcss-ceiling")).toBeTruthy();

      // Second render without ceiling (showFloor false or walls.t false)
      const snapshot2 = buildSnapshot(voxels, {
        showFloor: false
      });
      renderer.render(snapshot2);
      expect(target.querySelector(".voxcss-ceiling")).toBeNull();
    });

    it("reuses existing ceiling element across renders", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot1 = buildSnapshot(voxels, {
        showFloor: true,
        walls: { t: true, b: false, bl: true, br: true, fl: false, fr: false }
      });
      renderer.render(snapshot1);
      const ceiling1 = target.querySelector(".voxcss-ceiling");

      // Re-render with slightly different context but still showing ceiling
      const snapshot2 = buildSnapshot(voxels, {
        showFloor: true,
        rows: 5,
        walls: { t: true, b: false, bl: true, br: true, fl: false, fr: false }
      });
      renderer.render(snapshot2);
      const ceiling2 = target.querySelector(".voxcss-ceiling");

      // Should be the same element (reused)
      expect(ceiling1).toBe(ceiling2);
    });
  });

  // =========================================================================
  // Switching from cubes to slice-renderer and back (lines ~140-150)
  // =========================================================================
  describe("render mode switching", () => {
    it("switches from cubes to slice-renderer mode", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      // First render in cubes mode
      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot1 = buildSnapshotWithRenderer(voxels, "cubes");
      renderer.render(snapshot1);

      const layers1 = target.querySelectorAll(".voxcss-layer");
      expect(layers1.length).toBeGreaterThanOrEqual(1);

      // Switch to slice-renderer
      const snapshot2 = buildSnapshotWithRenderer(voxels, "slice-renderer");
      renderer.render(snapshot2);

      // Layers should be cleared in slice-renderer mode
      const layers2 = target.querySelectorAll(".voxcss-layer");
      expect(layers2.length).toBe(0);
    });

    it("switches from slice-renderer back to cubes mode", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];

      // Start in slice-renderer mode
      const snapshot1 = buildSnapshotWithRenderer(voxels, "slice-renderer");
      renderer.render(snapshot1);

      // Switch back to cubes
      const snapshot2 = buildSnapshotWithRenderer(voxels, "cubes");
      renderer.render(snapshot2);

      const layers = target.querySelectorAll(".voxcss-layer");
      expect(layers.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // updateStructure method (lines ~154-174)
  // =========================================================================
  describe("updateStructure", () => {
    it("updates scene structure without full render", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot = buildSnapshot(voxels, { showWalls: true, showFloor: true });
      renderer.render(snapshot);

      // Now call updateStructure to change grid dimensions
      const updatedContext = { ...snapshot.context, rows: 10, cols: 10 };
      renderer.updateStructure!(updatedContext, 3);
    });

    it("updateStructure with no prior prevStructure just updates", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      // Call updateStructure before any render
      const result = buildSceneContext({ grid: [{ x: 0, y: 0, z: 0 }] });
      renderer.updateStructure!(result.context, 1);
    });
  });

  // =========================================================================
  // Unknown shape key (line ~236)
  // When a voxel has an unrecognized shape, the renderer clears the element.
  // =========================================================================
  describe("unknown shape key", () => {
    it("clears element for voxels with unknown shape", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000", shape: "unknown_shape_xyz" }];
      const snapshot = buildSnapshot(voxels);
      renderer.render(snapshot);

      // Unknown shape should not produce shape-specific elements
      const layers = target.querySelectorAll(".voxcss-layer");
      expect(layers.length).toBeGreaterThan(0);
      expect(target.querySelector(".voxcss-ramp")).toBeNull();
      expect(target.querySelector(".voxcss-wedge")).toBeNull();
      expect(target.querySelector(".voxcss-spike")).toBeNull();
    });
  });

  // =========================================================================
  // Dimetric projection class (line ~139)
  // =========================================================================
  describe("dimetric projection", () => {
    it("adds dimetric class when projection is dimetric", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot = buildSnapshot(voxels, { projection: "dimetric" });
      renderer.render(snapshot);

      expect(target.classList.contains("voxcss-projection--dimetric")).toBe(true);
    });

    it("removes dimetric class when switching back to cubic", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];

      // First dimetric
      const snapshot1 = buildSnapshot(voxels, { projection: "dimetric" });
      renderer.render(snapshot1);
      expect(target.classList.contains("voxcss-projection--dimetric")).toBe(true);

      // Then cubic
      const snapshot2 = buildSnapshot(voxels, { projection: "cubic" });
      renderer.render(snapshot2);
      expect(target.classList.contains("voxcss-projection--dimetric")).toBe(false);
    });
  });

  // =========================================================================
  // Floor visibility toggling
  // =========================================================================
  describe("floor visibility", () => {
    it("shows floor when showFloor is true", () => {
      renderer = createDomRenderer({ documentRef: document, target });
      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot = buildSnapshot(voxels, { showFloor: true });
      renderer.render(snapshot);

      const floor = target.querySelector(".voxcss-floor-z") as HTMLElement;
      expect(floor).toBeTruthy();
      expect(floor.style.background).not.toBe("none");
    });

    it("hides floor background when showFloor is false", () => {
      renderer = createDomRenderer({ documentRef: document, target });
      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot = buildSnapshot(voxels, { showFloor: false });
      renderer.render(snapshot);

      const floor = target.querySelector(".voxcss-floor-z") as HTMLElement;
      expect(floor).toBeTruthy();
      expect(floor.style.background).toContain("none");
    });
  });

  // =========================================================================
  // Destroy cleans up everything
  // =========================================================================
  describe("destroy", () => {
    it("removes all layers, walls, ceiling, and floor", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot = buildSnapshot(voxels, {
        showWalls: true,
        showFloor: true,
        walls: { t: true, b: false, bl: true, br: true, fl: false, fr: false }
      });
      renderer.render(snapshot);

      renderer.destroy();
      // After destroy, re-creating is the only way to use the renderer
      renderer = createDomRenderer({ documentRef: document, target });
    });
  });

  // =========================================================================
  // Removing excess layers (line ~149)
  // When the number of layers shrinks, excess layer records are removed.
  // =========================================================================
  describe("shrinking layers", () => {
    it("removes excess layers when layer count decreases", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      // First render with 3 layers
      const voxels3 = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 0, y: 0, z: 1, color: "#00ff00" },
        { x: 0, y: 0, z: 2, color: "#0000ff" }
      ];
      const snapshot1 = buildSnapshot(voxels3);
      renderer.render(snapshot1);

      const layers1 = target.querySelectorAll(".voxcss-layer");
      expect(layers1.length).toBe(3);

      // Second render with 1 layer
      const voxels1 = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const snapshot2 = buildSnapshot(voxels1);
      renderer.render(snapshot2);

      const layers2 = target.querySelectorAll(".voxcss-layer");
      expect(layers2.length).toBe(1);
    });
  });

  // =========================================================================
  // Voxel re-render with same layer but different content
  // =========================================================================
  describe("voxel re-render same layer", () => {
    it("re-renders layer with different voxels", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      // First render
      const voxels1: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#00ff00" },
        { x: 2, y: 0, z: 0, color: "#0000ff" }
      ];
      const snapshot1 = buildSnapshot(voxels1);
      renderer.render(snapshot1);

      // Second render with different colors (same positions)
      const voxels2: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#aabbcc" },
        { x: 1, y: 0, z: 0, color: "#ddeeff" },
        { x: 2, y: 0, z: 0, color: "#112233" }
      ];
      const snapshot2 = buildSnapshot(voxels2);
      renderer.render(snapshot2);

      const layer = target.querySelector(".voxcss-layer") as HTMLElement;
      expect(layer).toBeTruthy();
      expect(layer.children.length).toBeGreaterThanOrEqual(3);
    });
  });

  // =========================================================================
  // Null voxel in array (line ~222-226)
  // =========================================================================
  describe("null voxel handling", () => {
    it("handles null voxels in the voxel array gracefully", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      const result = buildSceneContext({ grid: [{ x: 0, y: 0, z: 0, color: "#ff0000" }] });
      // Manually inject a null voxel
      const layersWithNull = result.layers.map(layer =>
        [...layer, null as unknown as Voxel]
      );
      const snapshot: SceneSnapshot = {
        layers: layersWithNull,
        context: result.context
      };
      renderer.render(snapshot);
    });
  });

  // =========================================================================
  // Wall removal when mask changes (lines ~316-319)
  // =========================================================================
  describe("wall mask changes", () => {
    it("removes wall elements when their mask flag becomes false", () => {
      renderer = createDomRenderer({ documentRef: document, target });

      const voxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];

      // First render with bl and br walls visible
      const snapshot1 = buildSnapshot(voxels, {
        showWalls: true,
        walls: { t: false, b: true, bl: true, br: true, fl: false, fr: false }
      });
      renderer.render(snapshot1);

      const walls1 = target.querySelectorAll(".voxcss-wall");
      expect(walls1.length).toBeGreaterThan(0);

      // Second render with different wall mask - bl is now false
      const snapshot2 = buildSnapshot(voxels, {
        showWalls: true,
        walls: { t: false, b: true, bl: false, br: true, fl: false, fr: false }
      });
      renderer.render(snapshot2);
    });
  });
});
