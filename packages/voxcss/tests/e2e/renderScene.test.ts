/**
 * Layer 1 — End-to-End render tests for VoxCSS.
 *
 * These tests exercise the public API exclusively (imported from "../../src/index")
 * and assert on the resulting DOM tree produced by `renderScene()`.
 * They are the migration safety net: if a refactor changes any observable DOM
 * output, these tests will catch it.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  renderScene,
  mergeVoxels,
  parseMagicaVoxel,
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

/** Create a fresh root element for each test. */
function createRoot(): HTMLElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  return root;
}

/** Clean up a root element after a test. */
function cleanup(root: HTMLElement): void {
  root.remove();
}

/** Shorthand: query all elements matching a selector inside root. */
function qsa(root: HTMLElement, selector: string): Element[] {
  return Array.from(root.querySelectorAll(selector));
}

/** Shorthand: query the first element matching a selector inside root. */
function qs(root: HTMLElement, selector: string): Element | null {
  return root.querySelector(selector);
}

// ---------------------------------------------------------------------------
// renderScene — Basic Structure
// ---------------------------------------------------------------------------

describe("renderScene — Basic Structure", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  it("empty scene: root has camera div, scene div, floor div, zero layers", () => {
    const handle = renderScene({ element: root, scene: { voxels: [] } });

    const camera = qs(root, ".voxcss-camera");
    expect(camera).not.toBeNull();

    const scene = qs(root, ".voxcss-scene");
    expect(scene).not.toBeNull();

    const floor = qs(root, ".voxcss-floor-z");
    expect(floor).not.toBeNull();

    const layers = qsa(root, ".voxcss-layer");
    expect(layers).toHaveLength(0);

    handle.destroy();
    cleanup(root);
  });

  it("single voxel: 1 layer, voxel has correct grid-area", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 2, z: 0, color: "#ff0000" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBeGreaterThanOrEqual(1);

    // The voxel container is a direct child of the layer.
    const layer = layers[0];
    const voxelContainer = layer.firstElementChild as HTMLElement;
    expect(voxelContainer).not.toBeNull();
    // grid-area should reference x=1, y=2 → "1 / 2 / 2 / 3"
    expect(voxelContainer.style.gridArea).toBe("1 / 2 / 2 / 3");

    handle.destroy();
    cleanup(root);
  });

  it("multiple layers: voxels at z=0, z=1, z=2 → 3 .voxcss-layer elements", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 2 }
    ];
    const handle = renderScene({ element: root, scene: { voxels } });

    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(3);

    handle.destroy();
    cleanup(root);
  });

  it("grid dimensions: 4x6 grid → CSS vars --voxcss-rows and --voxcss-cols", () => {
    // Voxels that force a 4x6 grid extent (max x2=4, max y2=6).
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 5, z: 0 }
    ];
    const handle = renderScene({ element: root, scene: { voxels } });

    const scene = qs(root, ".voxcss-scene") as HTMLElement;
    expect(scene).not.toBeNull();
    // The scene host should have --voxcss-rows and --voxcss-cols set.
    expect(scene.style.getPropertyValue("--voxcss-rows")).toBe("4");
    expect(scene.style.getPropertyValue("--voxcss-cols")).toBe("6");

    handle.destroy();
    cleanup(root);
  });
});

// ---------------------------------------------------------------------------
// renderScene — Face Visibility
// ---------------------------------------------------------------------------

describe("renderScene — Face Visibility", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  it("isolated voxel shows top, front-right, front-left faces", () => {
    // Default camera: rotX=65, rotY=45 → walls: t=false, b=true, bl=true, br=true, fl=false, fr=false
    // An isolated voxel with no neighbors should show t, fr, fl faces (others are back-facing).
    const voxels: VoxelGrid = [{ x: 2, y: 2, z: 0 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const topFace = qs(root, ".voxcss-cube-face--t");
    const frFace = qs(root, ".voxcss-cube-face--fr");
    const flFace = qs(root, ".voxcss-cube-face--fl");
    expect(topFace).not.toBeNull();
    expect(frFace).not.toBeNull();
    expect(flFace).not.toBeNull();

    // Back-facing faces should NOT be present (wall mask hides them).
    const bFace = qs(root, ".voxcss-cube-face--b");
    const blFace = qs(root, ".voxcss-cube-face--bl");
    const brFace = qs(root, ".voxcss-cube-face--br");
    expect(bFace).toBeNull();
    expect(blFace).toBeNull();
    expect(brFace).toBeNull();

    handle.destroy();
    cleanup(root);
  });

  it("two stacked voxels: top voxel has no bottom face, bottom voxel has no top face", () => {
    // At default camera angles, bottom face is already hidden by wall mask.
    // So let's focus on the top face being occluded by the voxel above.
    const voxels: VoxelGrid = [
      { x: 2, y: 2, z: 0 },
      { x: 2, y: 2, z: 1 }
    ];
    const handle = renderScene({ element: root, scene: { voxels } });

    // The layer 0 voxel should have no top face (occluded by z=1 voxel above).
    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(2);

    // Bottom layer (z=0) should have no top face because z=1 is above it.
    const bottomLayerVoxelContainer = layers[0].firstElementChild as HTMLElement;
    const bottomLayerTopFace = bottomLayerVoxelContainer?.querySelector(".voxcss-cube-face--t");
    expect(bottomLayerTopFace).toBeNull();

    // Top layer (z=1) should have a top face (nothing above it).
    const topLayerVoxelContainer = layers[1].firstElementChild as HTMLElement;
    const topLayerTopFace = topLayerVoxelContainer?.querySelector(".voxcss-cube-face--t");
    expect(topLayerTopFace).not.toBeNull();

    handle.destroy();
    cleanup(root);
  });

  it("surrounded voxel hidden: center of 3x3x3 cube has display none", () => {
    // Build a 3x3x3 cube of voxels. The center voxel at (1,1,1) is fully surrounded.
    const voxels: VoxelGrid = [];
    for (let x = 0; x < 3; x++) {
      for (let y = 0; y < 3; y++) {
        for (let z = 0; z < 3; z++) {
          voxels.push({ x, y, z });
        }
      }
    }
    const handle = renderScene({ element: root, scene: { voxels } });

    // The center voxel (x=1, y=1, z=1) is fully occluded and should be display:none.
    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(3);

    // In layer z=1 (index 1), find the element with grid-area "1 / 1 / 2 / 2".
    const middleLayer = layers[1];
    const middleLayerChildren = Array.from(middleLayer.children) as HTMLElement[];
    const centerVoxel = middleLayerChildren.find(
      (el) => el.style.gridArea === "1 / 1 / 2 / 2"
    );
    // Center voxel should be display:none because all its visible faces are occluded.
    if (centerVoxel) {
      expect(centerVoxel.style.display).toBe("none");
    }

    handle.destroy();
    cleanup(root);
  });
});

// ---------------------------------------------------------------------------
// renderScene — Face Appearance
// ---------------------------------------------------------------------------

describe("renderScene — Face Appearance", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  it("color applied: color '#ff0000' → top face backgroundColor contains '255'", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, color: "#ff0000" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const topFace = qs(root, ".voxcss-cube-face--t") as HTMLElement;
    expect(topFace).not.toBeNull();
    // The top face has 0 delta, so #ff0000 stays at rgb(255, 0, 0).
    expect(topFace.style.backgroundColor).toContain("255");

    handle.destroy();
    cleanup(root);
  });

  it("different faces get different shading: --fl face is darker than --t face", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, color: "#cccccc" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const topFace = qs(root, ".voxcss-cube-face--t") as HTMLElement;
    const flFace = qs(root, ".voxcss-cube-face--fl") as HTMLElement;
    expect(topFace).not.toBeNull();
    expect(flFace).not.toBeNull();

    // top face delta=0 → rgb(204,204,204), fl delta=-25 → rgb(179,179,179)
    // Top should be brighter (higher channel values) than fl.
    const parseRgb = (style: string): number[] => {
      const match = style.match(/(\d+)/g);
      return match ? match.map(Number) : [];
    };
    const topRgb = parseRgb(topFace.style.backgroundColor);
    const flRgb = parseRgb(flFace.style.backgroundColor);

    expect(topRgb.length).toBeGreaterThanOrEqual(3);
    expect(flRgb.length).toBeGreaterThanOrEqual(3);
    // Top face channels should be >= fl face channels (top is brighter).
    expect(topRgb[0]).toBeGreaterThan(flRgb[0]);

    handle.destroy();
    cleanup(root);
  });

  it("textured voxel: texture '/img.png' → face has backgroundImage containing url", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, texture: "/img.png" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const topFace = qs(root, ".voxcss-cube-face--t") as HTMLElement;
    expect(topFace).not.toBeNull();
    expect(topFace.style.backgroundImage).toContain("url");
    expect(topFace.style.backgroundImage).toContain("/img.png");

    handle.destroy();
    cleanup(root);
  });
});

// ---------------------------------------------------------------------------
// renderScene — Walls, Floor
// ---------------------------------------------------------------------------

describe("renderScene — Walls, Floor", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  it("no walls by default: zero .voxcss-wall elements", () => {
    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const walls = qsa(root, ".voxcss-wall");
    expect(walls).toHaveLength(0);

    handle.destroy();
    cleanup(root);
  });

  it("walls appear when showWalls: true", () => {
    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0 }];
    const handle = renderScene({
      element: root,
      scene: { voxels, showWalls: true }
    });

    const walls = qsa(root, ".voxcss-wall");
    // At default camera angle, back-left and back-right walls are visible
    // (bl=true, br=true from wall mask). showWalls enables them.
    expect(walls.length).toBeGreaterThan(0);

    handle.destroy();
    cleanup(root);
  });

  it("floor hidden by default", () => {
    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const floor = qs(root, ".voxcss-floor-z") as HTMLElement;
    expect(floor).not.toBeNull();
    // Floor should not have a visible background color when showFloor is false.
    const bg = floor.style.backgroundColor;
    // Either empty or "none" — the floor is not styled with a visible color.
    expect(!bg || bg === "none" || bg === "transparent" || floor.style.background === "none").toBe(true);

    handle.destroy();
    cleanup(root);
  });

  it("floor visible when showFloor: true", () => {
    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0 }];
    const handle = renderScene({
      element: root,
      scene: { voxels, showFloor: true }
    });

    const floor = qs(root, ".voxcss-floor-z") as HTMLElement;
    expect(floor).not.toBeNull();
    // Floor should NOT have "none" background when showFloor is true.
    expect(floor.style.background).not.toBe("none");

    handle.destroy();
    cleanup(root);
  });
});

// ---------------------------------------------------------------------------
// renderScene — Camera
// ---------------------------------------------------------------------------

describe("renderScene — Camera", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  it("camera transform applied: zoom, rotX, rotY", () => {
    const handle = renderScene({
      element: root,
      camera: { zoom: 1.5, rotX: 45, rotY: 90 },
      scene: { voxels: [{ x: 0, y: 0, z: 0 }] }
    });

    // The scene host element gets its transform from the controller snapshot.
    const scene = qs(root, ".voxcss-scene") as HTMLElement;
    expect(scene).not.toBeNull();
    const transform = scene.style.transform;
    expect(transform).toContain("scale(1.5)");
    expect(transform).toContain("rotateX(45deg)");
    expect(transform).toContain("rotate(90deg)");

    handle.destroy();
    cleanup(root);
  });

  it("perspective applied by default", () => {
    const handle = renderScene({
      element: root,
      scene: { voxels: [] }
    });

    const camera = qs(root, ".voxcss-camera") as HTMLElement;
    expect(camera).not.toBeNull();
    expect(camera.style.perspective).toBe("8000px");

    handle.destroy();
    cleanup(root);
  });

  it("perspective disabled when false", () => {
    const handle = renderScene({
      element: root,
      camera: { perspective: false },
      scene: { voxels: [] }
    });

    const camera = qs(root, ".voxcss-camera") as HTMLElement;
    expect(camera).not.toBeNull();
    expect(camera.style.perspective).toBe("none");

    handle.destroy();
    cleanup(root);
  });

  it("interactive cursor: cursor is grab when interactive", () => {
    const handle = renderScene({
      element: root,
      camera: { interactive: true },
      scene: { voxels: [{ x: 0, y: 0, z: 0 }] }
    });

    const camera = qs(root, ".voxcss-camera") as HTMLElement;
    expect(camera).not.toBeNull();
    expect(camera.style.cursor).toBe("grab");

    handle.destroy();
    cleanup(root);
  });
});

// ---------------------------------------------------------------------------
// renderScene — Updates
// ---------------------------------------------------------------------------

describe("renderScene — Updates", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  it("setVoxels() adds layers dynamically", () => {
    vi.useFakeTimers();
    const handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 0, y: 0, z: 0 }] }
    });

    let layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(1);

    // Add more voxels on additional layers.
    handle.setVoxels([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 2 }
    ]);

    // Flush rAF (updates are batched via requestAnimationFrame)
    vi.advanceTimersByTime(20);

    layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(3);

    handle.destroy();
    cleanup(root);
    vi.useRealTimers();
  });

  it("setScene({ showWalls: true/false }) toggles walls", () => {
    vi.useFakeTimers();
    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0 }];
    const handle = renderScene({
      element: root,
      scene: { voxels, showWalls: false }
    });

    let walls = qsa(root, ".voxcss-wall");
    expect(walls).toHaveLength(0);

    handle.setScene({ voxels, showWalls: true, showFloor: false, projection: "cubic" });
    vi.advanceTimersByTime(20);
    walls = qsa(root, ".voxcss-wall");
    expect(walls.length).toBeGreaterThan(0);

    handle.setScene({ voxels, showWalls: false, showFloor: false, projection: "cubic" });
    vi.advanceTimersByTime(20);
    walls = qsa(root, ".voxcss-wall");
    expect(walls).toHaveLength(0);

    handle.destroy();
    cleanup(root);
    vi.useRealTimers();
  });

  it("destroy() removes camera element", () => {
    const handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 0, y: 0, z: 0 }] }
    });

    expect(qs(root, ".voxcss-camera")).not.toBeNull();
    handle.destroy();
    // After destroy, the auto-created camera and scene elements should be removed.
    expect(qs(root, ".voxcss-camera")).toBeNull();

    cleanup(root);
  });
});

// ---------------------------------------------------------------------------
// renderScene — Merge Modes
// ---------------------------------------------------------------------------

describe("renderScene — Merge Modes", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  it("no merge (default): separate voxel container elements per voxel", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0, color: "#ff0000" },
      { x: 0, y: 1, z: 0, color: "#ff0000" },
      { x: 1, y: 0, z: 0, color: "#ff0000" },
      { x: 1, y: 1, z: 0, color: "#ff0000" }
    ];
    const handle = renderScene({
      element: root,
      scene: { voxels }
    });

    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(1);
    // Without merge, each voxel gets its own container element.
    const containers = layers[0].children;
    expect(containers.length).toBe(4);

    handle.destroy();
    cleanup(root);
  });

  it("mergeVoxels '2d': fewer voxel elements (merged)", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0, color: "#ff0000" },
      { x: 0, y: 1, z: 0, color: "#ff0000" },
      { x: 1, y: 0, z: 0, color: "#ff0000" },
      { x: 1, y: 1, z: 0, color: "#ff0000" }
    ];
    const handle = renderScene({
      element: root,
      scene: { voxels, mergeVoxels: "2d" }
    });

    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(1);
    // With 2D merge, same-color adjacent voxels should be merged into fewer containers.
    const containers = layers[0].children;
    expect(containers.length).toBeLessThan(4);

    handle.destroy();
    cleanup(root);
  });

  it("mergeVoxels '3d': slice renderer active (uses <b> elements)", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0, color: "#ff0000" },
      { x: 0, y: 1, z: 0, color: "#ff0000" },
      { x: 1, y: 0, z: 0, color: "#ff0000" },
      { x: 1, y: 1, z: 0, color: "#ff0000" }
    ];
    const handle = renderScene({
      element: root,
      scene: { voxels, mergeVoxels: "3d" }
    });

    // In 3D merge mode, the slice renderer produces <b> elements with class voxcss-brush.
    const brushes = qsa(root, "b");
    expect(brushes.length).toBeGreaterThan(0);

    // Regular cube layers should NOT be present in 3D merge mode.
    const cubes = qsa(root, ".voxcss-cube");
    expect(cubes).toHaveLength(0);

    handle.destroy();
    cleanup(root);
  });
});

// ---------------------------------------------------------------------------
// renderScene — Shapes
// ---------------------------------------------------------------------------

describe("renderScene — Shapes", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  it("cube shape: .voxcss-cube class and face divs", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "cube" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const cube = qs(root, ".voxcss-cube");
    expect(cube).not.toBeNull();

    const faces = qsa(root, ".voxcss-cube-face");
    expect(faces.length).toBeGreaterThan(0);

    handle.destroy();
    cleanup(root);
  });

  it("ramp shape: .voxcss-ramp class present", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "ramp" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const ramp = qs(root, ".voxcss-ramp");
    expect(ramp).not.toBeNull();

    handle.destroy();
    cleanup(root);
  });

  it("wedge shape: .voxcss-wedge class present", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "wedge" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const wedge = qs(root, ".voxcss-wedge");
    expect(wedge).not.toBeNull();

    handle.destroy();
    cleanup(root);
  });

  it("spike shape: .voxcss-spike class present", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "spike" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const spike = qs(root, ".voxcss-spike");
    expect(spike).not.toBeNull();

    handle.destroy();
    cleanup(root);
  });

  it("shape rotation: rot: 90 → orientation class voxcss-south", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "ramp", rot: 90 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const ramp = qs(root, ".voxcss-south");
    expect(ramp).not.toBeNull();

    handle.destroy();
    cleanup(root);
  });

  it("shape rotation: rot: 180 → orientation class voxcss-west", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "wedge", rot: 180 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const wedge = qs(root, ".voxcss-west");
    expect(wedge).not.toBeNull();

    handle.destroy();
    cleanup(root);
  });

  it("shape rotation: rot: 270 → orientation class voxcss-north", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "spike", rot: 270 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const spike = qs(root, ".voxcss-north");
    expect(spike).not.toBeNull();

    handle.destroy();
    cleanup(root);
  });

  it("shape default rotation (0) → orientation class voxcss-east", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "ramp" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const east = qs(root, ".voxcss-east");
    expect(east).not.toBeNull();

    handle.destroy();
    cleanup(root);
  });
});

// ---------------------------------------------------------------------------
// renderScene — Snapshots
// ---------------------------------------------------------------------------

describe("renderScene — Snapshots", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  it("snapshot: single red voxel", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, color: "#ff0000" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(root.innerHTML).toMatchSnapshot();

    handle.destroy();
    cleanup(root);
  });

  it("snapshot: 2x2 flat plane", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0, color: "#00ff00" },
      { x: 0, y: 1, z: 0, color: "#00ff00" },
      { x: 1, y: 0, z: 0, color: "#00ff00" },
      { x: 1, y: 1, z: 0, color: "#00ff00" }
    ];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(root.innerHTML).toMatchSnapshot();

    handle.destroy();
    cleanup(root);
  });

  it("snapshot: mixed shapes", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0, shape: "cube", color: "#ff0000" },
      { x: 1, y: 0, z: 0, shape: "ramp", color: "#00ff00", rot: 90 },
      { x: 0, y: 1, z: 0, shape: "wedge", color: "#0000ff" },
      { x: 1, y: 1, z: 0, shape: "spike", color: "#ffff00", rot: 180 }
    ];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(root.innerHTML).toMatchSnapshot();

    handle.destroy();
    cleanup(root);
  });

  it("snapshot: walls enabled", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0, color: "#aabbcc" },
      { x: 0, y: 0, z: 1, color: "#aabbcc" }
    ];
    const handle = renderScene({
      element: root,
      scene: { voxels, showWalls: true }
    });

    // Walls use blob URLs with non-deterministic UUIDs, so we assert structure
    // instead of exact innerHTML snapshot.
    const walls = qsa(root, ".voxcss-wall");
    expect(walls.length).toBeGreaterThan(0);
    const cubes = qsa(root, ".voxcss-cube");
    expect(cubes.length).toBe(2);
    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(2);

    handle.destroy();
    cleanup(root);
  });

  it("snapshot: merge mode 2d", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0, color: "#ff0000" },
      { x: 0, y: 1, z: 0, color: "#ff0000" },
      { x: 1, y: 0, z: 0, color: "#ff0000" },
      { x: 1, y: 1, z: 0, color: "#ff0000" }
    ];
    const handle = renderScene({
      element: root,
      scene: { voxels, mergeVoxels: "2d" }
    });

    expect(root.innerHTML).toMatchSnapshot();

    handle.destroy();
    cleanup(root);
  });

  it("snapshot: merge mode 3d", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0, color: "#ff0000" },
      { x: 0, y: 1, z: 0, color: "#ff0000" },
      { x: 1, y: 0, z: 0, color: "#ff0000" },
      { x: 1, y: 1, z: 0, color: "#ff0000" }
    ];
    const handle = renderScene({
      element: root,
      scene: { voxels, mergeVoxels: "3d" }
    });

    expect(root.innerHTML).toMatchSnapshot();

    handle.destroy();
    cleanup(root);
  });
});

// ---------------------------------------------------------------------------
// renderScene — Area & Multi-Layer Voxels
// ---------------------------------------------------------------------------

describe("renderScene — Area Voxels", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  it("area voxel with x2/y2 spans has correct grid-area", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, x2: 3, y2: 4, color: "#00ff00" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBeGreaterThanOrEqual(1);

    const voxelContainer = layers[0].firstElementChild as HTMLElement;
    expect(voxelContainer).not.toBeNull();
    // grid-area should be "1 / 1 / 3 / 4"
    expect(voxelContainer.style.gridArea).toBe("1 / 1 / 3 / 4");

    handle.destroy();
    cleanup(root);
  });

  it("tall voxel with z2 expands into multiple layers", () => {
    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0, z2: 3, color: "#0000ff" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(3);

    handle.destroy();
    cleanup(root);
  });
});

// ---------------------------------------------------------------------------
// parseMagicaVoxel E2E
// ---------------------------------------------------------------------------

describe("parseMagicaVoxel E2E", () => {
  it("parse real .vox file, feed to renderScene → DOM has layers, no errors", () => {
    const voxPath = resolve(__dirname, "../../../../examples/models/tree.vox");
    const buffer = readFileSync(voxPath);
    const result = parseMagicaVoxel(buffer.buffer);

    expect(result.voxels.length).toBeGreaterThan(0);
    expect(result.rows).toBeGreaterThan(0);
    expect(result.cols).toBeGreaterThan(0);
    expect(result.depth).toBeGreaterThan(0);

    const root = createRoot();
    const handle = renderScene({
      element: root,
      scene: {
        voxels: result.voxels,
        rows: result.rows,
        cols: result.cols,
        depth: result.depth
      }
    });

    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBeGreaterThan(0);

    // Should have cube faces rendered.
    const faces = qsa(root, ".voxcss-cube-face");
    expect(faces.length).toBeGreaterThan(0);

    handle.destroy();
    cleanup(root);
  });

  it("parsed voxels have color from palette", () => {
    const voxPath = resolve(__dirname, "../../../../examples/models/tree.vox");
    const buffer = readFileSync(voxPath);
    const result = parseMagicaVoxel(buffer.buffer);

    // Every voxel should have a color assigned from the palette.
    for (const voxel of result.voxels) {
      expect(voxel.color).toBeDefined();
      expect(typeof voxel.color).toBe("string");
      expect(voxel.color!.startsWith("#")).toBe(true);
    }
  });

  it("parsed voxels have 1-indexed x/y coordinates", () => {
    const voxPath = resolve(__dirname, "../../../../examples/models/tree.vox");
    const buffer = readFileSync(voxPath);
    const result = parseMagicaVoxel(buffer.buffer);

    for (const voxel of result.voxels) {
      expect(voxel.x).toBeGreaterThanOrEqual(1);
      expect(voxel.y).toBeGreaterThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
// mergeVoxels E2E
// ---------------------------------------------------------------------------

describe("mergeVoxels E2E", () => {
  it("reduces element count: 4x4 same-color → fewer output voxels than input", () => {
    const voxels: VoxelGrid = [];
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        voxels.push({ x, y, z: 0, color: "#ff0000" });
      }
    }
    const merged = mergeVoxels(voxels);
    // 16 input voxels, merged should produce fewer.
    expect(merged.length).toBeLessThan(voxels.length);
    // At minimum, they should all be merged into 1.
    expect(merged.length).toBeGreaterThanOrEqual(1);
  });

  it("different colors not merged", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0, color: "#ff0000" },
      { x: 0, y: 1, z: 0, color: "#00ff00" },
      { x: 1, y: 0, z: 0, color: "#0000ff" },
      { x: 1, y: 1, z: 0, color: "#ffff00" }
    ];
    const merged = mergeVoxels(voxels);
    // All different colors, so nothing should merge.
    expect(merged.length).toBe(4);
  });

  it("non-cube shapes are not merged", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0, shape: "ramp", color: "#ff0000" },
      { x: 0, y: 1, z: 0, shape: "ramp", color: "#ff0000" }
    ];
    const merged = mergeVoxels(voxels);
    // Ramp shapes are not mergeable.
    expect(merged.length).toBe(2);
  });

  it("merged voxels have x2/y2 set for spans", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0, color: "#ff0000" },
      { x: 0, y: 1, z: 0, color: "#ff0000" }
    ];
    const merged = mergeVoxels(voxels);
    expect(merged.length).toBe(1);
    const m = merged[0];
    // Should span x=0..1 or y=0..2 depending on merge direction.
    expect(m.x2! - m.x).toBeGreaterThanOrEqual(1);
    expect(m.y2! - m.y).toBeGreaterThanOrEqual(1);
    // At least one axis should be >1 span.
    const spanX = m.x2! - m.x;
    const spanY = m.y2! - m.y;
    expect(spanX * spanY).toBe(2);
  });

  it("merge preserves voxel colors", () => {
    const voxels: VoxelGrid = [];
    for (let x = 0; x < 3; x++) {
      for (let y = 0; y < 3; y++) {
        voxels.push({ x, y, z: 0, color: "#abcdef" });
      }
    }
    const merged = mergeVoxels(voxels);
    for (const v of merged) {
      expect(v.color).toBe("#abcdef");
    }
  });

  it("merge then renderScene produces valid DOM", () => {
    const voxels: VoxelGrid = [];
    for (let x = 0; x < 4; x++) {
      for (let y = 0; y < 4; y++) {
        voxels.push({ x, y, z: 0, color: "#ff0000" });
      }
    }
    const root = createRoot();
    const handle = renderScene({
      element: root,
      scene: { voxels, mergeVoxels: "2d" }
    });

    // Should still produce a valid layer with cube faces.
    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(1);

    const cubes = qsa(root, ".voxcss-cube");
    expect(cubes.length).toBeGreaterThanOrEqual(1);
    // Should be fewer cubes than 16 (merged).
    expect(cubes.length).toBeLessThan(16);

    handle.destroy();
    cleanup(root);
  });
});

// ---------------------------------------------------------------------------
// renderScene — Projection Modes
// ---------------------------------------------------------------------------

describe("renderScene — Projection Modes", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  it("cubic projection is the default (no dimetric class)", () => {
    const handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 0, y: 0, z: 0 }] }
    });

    const scene = qs(root, ".voxcss-scene") as HTMLElement;
    expect(scene).not.toBeNull();
    expect(scene.classList.contains("voxcss-projection--dimetric")).toBe(false);

    handle.destroy();
    cleanup(root);
  });

  it("dimetric projection adds voxcss-projection--dimetric class", () => {
    const handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 0, y: 0, z: 0 }], projection: "dimetric" }
    });

    const scene = qs(root, ".voxcss-scene") as HTMLElement;
    expect(scene).not.toBeNull();
    expect(scene.classList.contains("voxcss-projection--dimetric")).toBe(true);

    handle.destroy();
    cleanup(root);
  });
});

// ---------------------------------------------------------------------------
// renderScene — Style Injection
// ---------------------------------------------------------------------------

describe("renderScene — Style Injection", () => {
  it("base styles are injected into the document head", () => {
    const root = createRoot();
    const handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 0, y: 0, z: 0 }] }
    });

    const styleEl = document.getElementById("voxcss-base-styles");
    expect(styleEl).not.toBeNull();
    expect(styleEl?.tagName.toLowerCase()).toBe("style");

    handle.destroy();
    cleanup(root);
  });
});

// ---------------------------------------------------------------------------
// renderScene — Multiple Voxels on Same Layer
// ---------------------------------------------------------------------------

describe("renderScene — Multiple Voxels Same Layer", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  it("3 voxels in a row on layer 0 produce 3 containers in the layer", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0, color: "#ff0000" },
      { x: 0, y: 1, z: 0, color: "#00ff00" },
      { x: 0, y: 2, z: 0, color: "#0000ff" }
    ];
    const handle = renderScene({ element: root, scene: { voxels } });

    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(1);
    const containers = layers[0].children;
    expect(containers.length).toBe(3);

    handle.destroy();
    cleanup(root);
  });

  it("adjacent same-color voxels have occluded shared faces", () => {
    // Two cubes side by side along Y axis:
    // Voxel at (0,0,0) and (0,1,0). The fr face of (0,0,0) is occluded by (0,1,0).
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0, color: "#cccccc" },
      { x: 0, y: 1, z: 0, color: "#cccccc" }
    ];
    const handle = renderScene({ element: root, scene: { voxels } });

    const layers = qsa(root, ".voxcss-layer");
    const containers = Array.from(layers[0].children) as HTMLElement[];

    // Find the container for voxel (0,0,0) - grid-area "0 / 0 / 1 / 1".
    const v0 = containers.find((el) => el.style.gridArea === "0 / 0 / 1 / 1");
    if (v0) {
      // fr face of (0,0,0) should be occluded by the neighbor at (0,1,0).
      const frFace = v0.querySelector(".voxcss-cube-face--fr");
      expect(frFace).toBeNull();
    }

    // Find the container for voxel (0,1,0) - grid-area "0 / 1 / 1 / 2".
    const v1 = containers.find((el) => el.style.gridArea === "0 / 1 / 1 / 2");
    if (v1) {
      // The fr face of (0,1,0) should be visible (no neighbor beyond it).
      const frFace = v1.querySelector(".voxcss-cube-face--fr");
      expect(frFace).not.toBeNull();
    }

    handle.destroy();
    cleanup(root);
  });
});

// ---------------------------------------------------------------------------
// renderScene — Edge Cases
// ---------------------------------------------------------------------------

describe("renderScene — Edge Cases", () => {
  it("throws if no element provided", () => {
    expect(() => {
      renderScene({ element: null as unknown as HTMLElement, scene: { voxels: [] } });
    }).toThrow("voxcss");
  });

  it("voxels with default color render correctly", () => {
    const root = createRoot();
    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0 }]; // No color specified.
    const handle = renderScene({ element: root, scene: { voxels } });

    // Default color is #cccccc.
    const topFace = qs(root, ".voxcss-cube-face--t") as HTMLElement;
    expect(topFace).not.toBeNull();
    // Top face delta=0 → rgb(204, 204, 204).
    expect(topFace.style.backgroundColor).toContain("204");

    handle.destroy();
    cleanup(root);
  });

  it("handles voxels at z=0 with no explicit shape (defaults to cube)", () => {
    const root = createRoot();
    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0 }]; // No shape specified.
    const handle = renderScene({ element: root, scene: { voxels } });

    const cube = qs(root, ".voxcss-cube");
    expect(cube).not.toBeNull();

    handle.destroy();
    cleanup(root);
  });

  it("custom perspective value is applied", () => {
    const root = createRoot();
    const handle = renderScene({
      element: root,
      camera: { perspective: 5000 },
      scene: { voxels: [] }
    });

    const camera = qs(root, ".voxcss-camera") as HTMLElement;
    expect(camera.style.perspective).toBe("5000px");

    handle.destroy();
    cleanup(root);
  });
});
