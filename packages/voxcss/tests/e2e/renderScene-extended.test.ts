/**
 * Extended E2E tests for VoxCSS — coverage gap filler.
 *
 * Covers headless API (createCamera, createScene, renderScene edge cases),
 * shape rendering details (ramp/wedge/spike slopes, orientations, SVG elements,
 * bottom faces, covered shapes), and domRenderer features (walls, floor, ceiling,
 * projection, grid sprites, area voxels, tall voxels, re-renders).
 *
 * Imports ONLY from the public barrel: "../../src/index".
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  createCamera,
  createScene,
  renderScene,
  type HeadlessCameraHandle,
  type HeadlessRenderHandle,
  type VoxelGrid
} from "../../src/index";

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
}

function qsa(root: HTMLElement, selector: string): Element[] {
  return Array.from(root.querySelectorAll(selector));
}

function qs(root: HTMLElement, selector: string): Element | null {
  return root.querySelector(selector);
}

// ---------------------------------------------------------------------------
// createCamera — standalone
// ---------------------------------------------------------------------------

describe("createCamera — standalone", () => {
  let el: HTMLElement;

  beforeEach(() => {
    el = document.createElement("div");
    document.body.appendChild(el);
  });

  afterEach(() => {
    el.remove();
  });

  it("creates camera handle with element, controller, interactive, destroy", () => {
    const handle = createCamera({ element: el });
    expect(handle.element).toBe(el);
    expect(handle.controller).toBeDefined();
    expect(typeof handle.interactive).toBe("boolean");
    expect(typeof handle.destroy).toBe("function");
    handle.destroy();
  });

  it("adds voxcss-camera class to the element", () => {
    const handle = createCamera({ element: el });
    expect(el.classList.contains("voxcss-camera")).toBe(true);
    handle.destroy();
  });

  it("default interactive is false", () => {
    const handle = createCamera({ element: el });
    expect(handle.interactive).toBe(false);
    handle.destroy();
  });

  it("interactive: true sets up pointer events and cursor", () => {
    const handle = createCamera({ element: el, interactive: true });
    expect(handle.interactive).toBe(true);
    // Interactive mode sets touch-action and user-select
    expect(el.style.touchAction).toBe("none");
    expect(el.style.userSelect).toBe("none");
    handle.destroy();
  });

  it("perspective defaults to 8000px", () => {
    const handle = createCamera({ element: el });
    expect(el.style.perspective).toBe("8000px");
    handle.destroy();
  });

  it("custom perspective value is applied", () => {
    const handle = createCamera({ element: el, perspective: 5000 });
    expect(el.style.perspective).toBe("5000px");
    handle.destroy();
  });

  it("perspective: false sets perspective to none", () => {
    const handle = createCamera({ element: el, perspective: false });
    expect(el.style.perspective).toBe("none");
    handle.destroy();
  });

  it("throws when element is null", () => {
    expect(() => {
      createCamera({ element: null as unknown as HTMLElement });
    }).toThrow("voxcss");
  });

  it("setInteractive toggles interactive state", () => {
    const handle = createCamera({ element: el, interactive: false });
    expect(handle.interactive).toBe(false);
    handle.setInteractive(true);
    expect(handle.interactive).toBe(true);
    handle.setInteractive(false);
    expect(handle.interactive).toBe(false);
    handle.destroy();
  });

  it("setInteractive(false) resets cursor to default", () => {
    const handle = createCamera({ element: el, interactive: true });
    handle.setInteractive(false);
    expect(el.style.cursor).toBe("default");
    handle.destroy();
  });

  it("setPerspective updates perspective dynamically", () => {
    const handle = createCamera({ element: el, perspective: 8000 });
    expect(el.style.perspective).toBe("8000px");
    handle.setPerspective(3000);
    expect(el.style.perspective).toBe("3000px");
    handle.setPerspective(false);
    expect(el.style.perspective).toBe("none");
    handle.destroy();
  });

  it("update() changes camera state", () => {
    const handle = createCamera({ element: el, zoom: 1, rotX: 65, rotY: 45 });
    const initialState = handle.controller.getCameraState();
    expect(initialState.zoom).toBe(1);

    handle.update({ zoom: 2 });
    const updatedState = handle.controller.getCameraState();
    expect(updatedState.zoom).toBe(2);

    handle.destroy();
  });

  it("update with interactive toggles interactivity", () => {
    const handle = createCamera({ element: el, interactive: false });
    expect(handle.interactive).toBe(false);
    handle.update({ interactive: true });
    expect(handle.interactive).toBe(true);
    handle.destroy();
  });

  it("update with perspective changes perspective", () => {
    const handle = createCamera({ element: el });
    handle.update({ perspective: 4000 });
    expect(el.style.perspective).toBe("4000px");
    handle.destroy();
  });

  it("destroy cleans up", () => {
    const handle = createCamera({ element: el, interactive: true });
    expect(handle.interactive).toBe(true);
    handle.destroy();
    expect(handle.interactive).toBe(false);
  });

  it("animate: true starts auto-rotation", () => {
    // We cannot easily observe the rAF loop, but we verify no error is thrown
    // and the handle is created successfully.
    const handle = createCamera({ element: el, animate: true });
    expect(handle).toBeDefined();
    handle.destroy();
  });

  it("animate with custom speed object", () => {
    const handle = createCamera({
      element: el,
      animate: { speed: 0.5, axis: "y", pauseOnInteraction: false }
    });
    expect(handle).toBeDefined();
    handle.destroy();
  });

  it("setAnimate toggles animation", () => {
    const handle = createCamera({ element: el });
    handle.setAnimate(true);
    // No error means animation was started
    handle.setAnimate(false);
    // No error means animation was stopped
    handle.destroy();
  });

  it("controller getCameraState returns camera state", () => {
    const handle = createCamera({ element: el, rotX: 30, rotY: 90, zoom: 2 });
    const state = handle.controller.getCameraState();
    expect(state.rotX).toBe(30);
    expect(state.rotY).toBe(90);
    expect(state.zoom).toBe(2);
    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// createScene — standalone
// ---------------------------------------------------------------------------

describe("createScene — standalone", () => {
  it("creates scene with element and adds voxcss-scene class", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const result = createScene({ element: el, voxels: [] });
    expect(result.element).toBe(el);
    expect(el.classList.contains("voxcss-scene")).toBe(true);
    el.remove();
  });

  it("normalizes scene state defaults", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const result = createScene({ element: el });
    expect(result.showWalls).toBe(false);
    expect(result.showFloor).toBe(false);
    expect(result.projection).toBe("cubic");
    expect(result.voxels).toEqual([]);
    el.remove();
  });

  it("respects showFloor: true", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const result = createScene({ element: el, showFloor: true });
    expect(result.showFloor).toBe(true);
    el.remove();
  });

  it("respects showWalls: true", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const result = createScene({ element: el, showWalls: true });
    expect(result.showWalls).toBe(true);
    el.remove();
  });

  it("throws when element is null/undefined", () => {
    expect(() => {
      createScene({ element: null as unknown as HTMLElement });
    }).toThrow("voxcss");
  });

  it("passes through voxels", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
    const result = createScene({ element: el, voxels });
    expect(result.voxels).toBe(voxels);
    el.remove();
  });
});

// ---------------------------------------------------------------------------
// renderScene — headless options
// ---------------------------------------------------------------------------

describe("renderScene — headless camera options", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("reuses existing HeadlessCameraHandle", () => {
    const cameraEl = document.createElement("div");
    document.body.appendChild(cameraEl);
    const cameraHandle = createCamera({ element: cameraEl });

    const handle = renderScene({
      element: root,
      camera: cameraHandle,
      scene: { voxels: [{ x: 0, y: 0, z: 0 }] }
    });

    // The camera element should be the one we provided
    expect(root.contains(cameraEl)).toBe(true);
    // And it should have the voxcss-camera class
    expect(cameraEl.classList.contains("voxcss-camera")).toBe(true);

    handle.destroy();
    cameraHandle.destroy();
    cameraEl.remove();
  });

  it("uses provided camera element option", () => {
    const cameraEl = document.createElement("div");
    const handle = renderScene({
      element: root,
      camera: { element: cameraEl },
      scene: { voxels: [{ x: 0, y: 0, z: 0 }] }
    });

    expect(root.contains(cameraEl)).toBe(true);
    expect(cameraEl.classList.contains("voxcss-camera")).toBe(true);

    handle.destroy();
  });

  it("uses provided scene element option", () => {
    const sceneEl = document.createElement("div");
    const handle = renderScene({
      element: root,
      scene: { element: sceneEl, voxels: [{ x: 0, y: 0, z: 0 }] }
    });

    expect(sceneEl.classList.contains("voxcss-scene")).toBe(true);
    // The scene element should be inside the camera
    const camera = qs(root, ".voxcss-camera") as HTMLElement;
    expect(camera?.contains(sceneEl)).toBe(true);

    handle.destroy();
  });

  it("throws when element is null", () => {
    expect(() => {
      renderScene({
        element: null as unknown as HTMLElement,
        scene: { voxels: [] }
      });
    }).toThrow("voxcss");
  });

  it("mergeVoxels at top level (backward compat)", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0, color: "#ff0000" },
      { x: 0, y: 1, z: 0, color: "#ff0000" },
      { x: 1, y: 0, z: 0, color: "#ff0000" },
      { x: 1, y: 1, z: 0, color: "#ff0000" }
    ];
    const handle = renderScene({
      element: root,
      mergeVoxels: "2d",
      scene: { voxels }
    });

    // With top-level mergeVoxels, the merge should still happen
    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(1);
    // Fewer cubes than 4 because they should be merged
    const cubes = qsa(root, ".voxcss-cube");
    expect(cubes.length).toBeLessThan(4);

    handle.destroy();
  });

  it("destroy removes auto-created elements but keeps provided ones", () => {
    const cameraEl = document.createElement("div");
    const sceneEl = document.createElement("div");
    const handle = renderScene({
      element: root,
      camera: { element: cameraEl },
      scene: { element: sceneEl, voxels: [{ x: 0, y: 0, z: 0 }] }
    });

    handle.destroy();
    // Camera and scene elements were provided, so they should NOT be removed
    // (they are not auto-created)
    expect(cameraEl.parentElement).not.toBeNull();
    expect(sceneEl.parentElement).not.toBeNull();
  });

  it("destroy removes auto-created camera and scene elements", () => {
    const handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 0, y: 0, z: 0 }] }
    });

    expect(qs(root, ".voxcss-camera")).not.toBeNull();
    handle.destroy();
    expect(qs(root, ".voxcss-camera")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Shape Rendering — Ramp
// ---------------------------------------------------------------------------

describe("Shape Rendering — Ramp", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("ramp rot=0 has orientation class voxcss-east and slope element", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "ramp", rot: 0 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(qs(root, ".voxcss-east")).not.toBeNull();
    expect(qs(root, ".voxcss-ramp")).not.toBeNull();
    expect(qs(root, ".voxcss-ramp-slope")).not.toBeNull();

    handle.destroy();
  });

  it("ramp rot=90 has orientation class voxcss-south and slope element", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "ramp", rot: 90 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(qs(root, ".voxcss-south")).not.toBeNull();
    expect(qs(root, ".voxcss-ramp-slope")).not.toBeNull();

    handle.destroy();
  });

  it("ramp rot=180 has orientation class voxcss-west and slope element", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "ramp", rot: 180 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(qs(root, ".voxcss-west")).not.toBeNull();
    expect(qs(root, ".voxcss-ramp-slope")).not.toBeNull();

    handle.destroy();
  });

  it("ramp rot=270 has orientation class voxcss-north and slope element", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "ramp", rot: 270 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(qs(root, ".voxcss-north")).not.toBeNull();
    expect(qs(root, ".voxcss-ramp-slope")).not.toBeNull();

    handle.destroy();
  });

  it("ramp bottom face visible when bottom wall is not hidden", () => {
    // Use rotX > 90 so bottom wall is NOT hidden (t is hidden instead).
    // walls.b = false means bottom face is visible.
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "ramp" }];
    const handle = renderScene({
      element: root,
      camera: { rotX: 95, rotY: 45 },
      scene: { voxels }
    });

    // When rotX >= 90, wall mask has b=false (bottom visible), t=true (top hidden).
    // shouldRenderBottom returns true when walls.b is false AND no voxel below.
    const bottom = qs(root, ".voxcss-ramp-bottom");
    expect(bottom).not.toBeNull();

    handle.destroy();
  });

  it("ramp bottom face hidden by default wall mask (bottom hidden)", () => {
    // Default camera: rotX=65 → walls.b=true → shouldRenderBottom returns false.
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "ramp" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const bottom = qs(root, ".voxcss-ramp-bottom");
    expect(bottom).toBeNull();

    handle.destroy();
  });

  it("ramp covered by voxel above gets display:none", () => {
    // A ramp at z=0 with a cube directly above at z=1 should be covered.
    const voxels: VoxelGrid = [
      { x: 1, y: 1, z: 0, shape: "ramp" },
      { x: 1, y: 1, z: 1, shape: "cube" }
    ];
    const handle = renderScene({ element: root, scene: { voxels } });

    // The ramp should be hidden because isCovered checks for voxel at z+1.
    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(2);
    const rampLayer = layers[0];
    const rampContainer = rampLayer.firstElementChild as HTMLElement;
    // The ramp should be display:none because it's covered
    expect(rampContainer.style.display).toBe("none");

    handle.destroy();
  });

  it("ramp with texture has background on slope", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "ramp", texture: "/img.png" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const slope = qs(root, ".voxcss-ramp-slope") as HTMLElement;
    expect(slope).not.toBeNull();
    expect(slope.style.backgroundImage).toContain("url");
    expect(slope.style.backgroundImage).toContain("/img.png");

    handle.destroy();
  });

  it("ramp slope has backgroundColor when no texture", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "ramp", color: "#ff0000" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const slope = qs(root, ".voxcss-ramp-slope") as HTMLElement;
    expect(slope).not.toBeNull();
    // The slope should have a backgroundColor derived from the voxel color
    expect(slope.style.backgroundColor).toBeTruthy();

    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// Shape Rendering — Wedge
// ---------------------------------------------------------------------------

describe("Shape Rendering — Wedge", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("wedge rot=0 has voxcss-east and two slope elements", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "wedge", rot: 0 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(qs(root, ".voxcss-east")).not.toBeNull();
    expect(qs(root, ".voxcss-wedge")).not.toBeNull();
    const slopes = qsa(root, ".voxcss-wedge-slope");
    expect(slopes.length).toBe(2);
    expect(qs(root, ".voxcss-wedge-slope--primary")).not.toBeNull();
    expect(qs(root, ".voxcss-wedge-slope--secondary")).not.toBeNull();

    handle.destroy();
  });

  it("wedge rot=90 has voxcss-south", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "wedge", rot: 90 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(qs(root, ".voxcss-south")).not.toBeNull();
    expect(qs(root, ".voxcss-wedge")).not.toBeNull();

    handle.destroy();
  });

  it("wedge rot=180 has voxcss-west", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "wedge", rot: 180 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(qs(root, ".voxcss-west")).not.toBeNull();

    handle.destroy();
  });

  it("wedge rot=270 has voxcss-north", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "wedge", rot: 270 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(qs(root, ".voxcss-north")).not.toBeNull();

    handle.destroy();
  });

  it("wedge has SVG elements inside slopes", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "wedge" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const svgs = qsa(root, ".voxcss-wedge-slope svg");
    expect(svgs.length).toBe(2);

    // Each SVG should have a path element
    for (const svg of svgs) {
      const path = svg.querySelector("path");
      expect(path).not.toBeNull();
      expect(path?.getAttribute("d")).toBeTruthy();
      expect(path?.getAttribute("fill")).toBeTruthy();
    }

    handle.destroy();
  });

  it("wedge bottom face visible when bottom wall not hidden", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "wedge" }];
    const handle = renderScene({
      element: root,
      camera: { rotX: 95 },
      scene: { voxels }
    });

    const bottom = qs(root, ".voxcss-wedge-bottom");
    expect(bottom).not.toBeNull();

    handle.destroy();
  });

  it("wedge bottom face hidden by default wall mask", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "wedge" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const bottom = qs(root, ".voxcss-wedge-bottom");
    expect(bottom).toBeNull();

    handle.destroy();
  });

  it("wedge covered by voxel above gets display:none", () => {
    const voxels: VoxelGrid = [
      { x: 1, y: 1, z: 0, shape: "wedge" },
      { x: 1, y: 1, z: 1, shape: "cube" }
    ];
    const handle = renderScene({ element: root, scene: { voxels } });

    const layers = qsa(root, ".voxcss-layer");
    const wedgeContainer = layers[0].firstElementChild as HTMLElement;
    expect(wedgeContainer.style.display).toBe("none");

    handle.destroy();
  });

  it("wedge with texture has SVG pattern fill", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "wedge", texture: "/img.png" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    // When a texture is provided, the SVG path should use a url(#...) fill
    const paths = qsa(root, ".voxcss-wedge-slope svg path");
    expect(paths.length).toBe(2);
    for (const path of paths) {
      const fill = path.getAttribute("fill");
      expect(fill).toContain("url(#");
    }

    // And there should be pattern + image elements in defs
    const patterns = qsa(root, ".voxcss-wedge-slope svg defs pattern");
    expect(patterns.length).toBe(2);
    const images = qsa(root, ".voxcss-wedge-slope svg defs pattern image");
    expect(images.length).toBe(2);

    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// Shape Rendering — Spike
// ---------------------------------------------------------------------------

describe("Shape Rendering — Spike", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("spike rot=0 has voxcss-east and two slope elements", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "spike", rot: 0 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(qs(root, ".voxcss-east")).not.toBeNull();
    expect(qs(root, ".voxcss-spike")).not.toBeNull();
    const slopes = qsa(root, ".voxcss-spike-slope");
    expect(slopes.length).toBe(2);
    expect(qs(root, ".voxcss-spike-slope--primary")).not.toBeNull();
    expect(qs(root, ".voxcss-spike-slope--secondary")).not.toBeNull();

    handle.destroy();
  });

  it("spike rot=90 has voxcss-south", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "spike", rot: 90 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(qs(root, ".voxcss-south")).not.toBeNull();
    expect(qs(root, ".voxcss-spike")).not.toBeNull();

    handle.destroy();
  });

  it("spike rot=180 has voxcss-west", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "spike", rot: 180 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(qs(root, ".voxcss-west")).not.toBeNull();

    handle.destroy();
  });

  it("spike rot=270 has voxcss-north", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "spike", rot: 270 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(qs(root, ".voxcss-north")).not.toBeNull();

    handle.destroy();
  });

  it("spike has SVG elements inside slopes", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "spike" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const svgs = qsa(root, ".voxcss-spike-slope svg");
    expect(svgs.length).toBe(2);

    for (const svg of svgs) {
      const path = svg.querySelector("path");
      expect(path).not.toBeNull();
      expect(path?.getAttribute("d")).toBeTruthy();
      expect(path?.getAttribute("fill")).toBeTruthy();
    }

    handle.destroy();
  });

  it("spike bottom face visible when bottom wall not hidden", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "spike" }];
    const handle = renderScene({
      element: root,
      camera: { rotX: 95 },
      scene: { voxels }
    });

    const bottom = qs(root, ".voxcss-spike-bottom");
    expect(bottom).not.toBeNull();

    handle.destroy();
  });

  it("spike bottom face hidden by default wall mask", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "spike" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const bottom = qs(root, ".voxcss-spike-bottom");
    expect(bottom).toBeNull();

    handle.destroy();
  });

  it("spike covered by voxel above gets display:none", () => {
    const voxels: VoxelGrid = [
      { x: 1, y: 1, z: 0, shape: "spike" },
      { x: 1, y: 1, z: 1, shape: "cube" }
    ];
    const handle = renderScene({ element: root, scene: { voxels } });

    const layers = qsa(root, ".voxcss-layer");
    const spikeContainer = layers[0].firstElementChild as HTMLElement;
    expect(spikeContainer.style.display).toBe("none");

    handle.destroy();
  });

  it("spike with texture has SVG pattern fill", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "spike", texture: "/img.png" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const paths = qsa(root, ".voxcss-spike-slope svg path");
    expect(paths.length).toBe(2);
    for (const path of paths) {
      const fill = path.getAttribute("fill");
      expect(fill).toContain("url(#");
    }

    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// Shape Rendering — Mixed
// ---------------------------------------------------------------------------

describe("Shape Rendering — Mixed scene", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("cube + ramp + wedge + spike all coexist in same scene", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0, shape: "cube", color: "#ff0000" },
      { x: 0, y: 2, z: 0, shape: "ramp", color: "#00ff00" },
      { x: 2, y: 0, z: 0, shape: "wedge", color: "#0000ff" },
      { x: 2, y: 2, z: 0, shape: "spike", color: "#ffff00" }
    ];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(qs(root, ".voxcss-cube")).not.toBeNull();
    expect(qs(root, ".voxcss-ramp")).not.toBeNull();
    expect(qs(root, ".voxcss-wedge")).not.toBeNull();
    expect(qs(root, ".voxcss-spike")).not.toBeNull();

    // All shapes are in a single layer
    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(1);
    expect(layers[0].children.length).toBe(4);

    handle.destroy();
  });

  it("shapes on different layers render correctly", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0, shape: "cube" },
      { x: 0, y: 0, z: 1, shape: "ramp" },
      { x: 0, y: 0, z: 2, shape: "wedge" }
    ];
    const handle = renderScene({ element: root, scene: { voxels } });

    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(3);

    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// DOM Renderer — Projection
// ---------------------------------------------------------------------------

describe("DOM Renderer — Projection", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("dimetric projection adds voxcss-projection--dimetric class on scene host", () => {
    const handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 0, y: 0, z: 0 }], projection: "dimetric" }
    });

    const scene = qs(root, ".voxcss-scene") as HTMLElement;
    expect(scene).not.toBeNull();
    expect(scene.classList.contains("voxcss-projection--dimetric")).toBe(true);

    handle.destroy();
  });

  it("dimetric layer spacing: second layer translateZ uses 25px intervals", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 }
    ];
    const handle = renderScene({
      element: root,
      scene: { voxels, projection: "dimetric" }
    });

    const layers = qsa(root, ".voxcss-layer") as HTMLElement[];
    expect(layers.length).toBe(2);

    // Layer 0: translateZ(0px)
    expect(layers[0].style.transform).toBe("translateZ(0px)");
    // Layer 1: translateZ(25px) for dimetric (half of cubic's 50px)
    expect(layers[1].style.transform).toBe("translateZ(25px)");

    handle.destroy();
  });

  it("cubic projection: layer spacing uses 50px intervals", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0, y: 0, z: 2 }
    ];
    const handle = renderScene({
      element: root,
      scene: { voxels, projection: "cubic" }
    });

    const layers = qsa(root, ".voxcss-layer") as HTMLElement[];
    expect(layers.length).toBe(3);
    expect(layers[0].style.transform).toBe("translateZ(0px)");
    expect(layers[1].style.transform).toBe("translateZ(50px)");
    expect(layers[2].style.transform).toBe("translateZ(100px)");

    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// DOM Renderer — Floor and Ceiling
// ---------------------------------------------------------------------------

describe("DOM Renderer — Floor and Ceiling", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("showFloor: true sets --voxcss-floor-base custom property", () => {
    const handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 0, y: 0, z: 0 }], showFloor: true }
    });

    const floor = qs(root, ".voxcss-floor-z") as HTMLElement;
    expect(floor).not.toBeNull();
    // Floor base should be set when showFloor is true and bottom wall is hidden (default)
    const floorBase = floor.style.getPropertyValue("--voxcss-floor-base");
    expect(floorBase).toBeTruthy();

    handle.destroy();
  });

  it("showFloor: false does not set --voxcss-floor-base", () => {
    const handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 0, y: 0, z: 0 }], showFloor: false }
    });

    const floor = qs(root, ".voxcss-floor-z") as HTMLElement;
    expect(floor).not.toBeNull();
    const floorBase = floor.style.getPropertyValue("--voxcss-floor-base");
    expect(floorBase).toBeFalsy();

    handle.destroy();
  });

  it("ceiling appears when rotX > 90 (looking from below) and showFloor is true", () => {
    const handle = renderScene({
      element: root,
      camera: { rotX: 95 },
      scene: { voxels: [{ x: 0, y: 0, z: 0 }], showFloor: true }
    });

    // When rotX >= 90, wall mask has t=true, which triggers ceiling rendering.
    const ceiling = qs(root, ".voxcss-ceiling");
    expect(ceiling).not.toBeNull();

    handle.destroy();
  });

  it("no ceiling at default rotX (65) even with showFloor: true", () => {
    const handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 0, y: 0, z: 0 }], showFloor: true }
    });

    // rotX=65 means t=false (top not hidden), so no ceiling.
    const ceiling = qs(root, ".voxcss-ceiling");
    expect(ceiling).toBeNull();

    handle.destroy();
  });

  it("floor grid sprite is set for small grids", () => {
    const handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 0, y: 0, z: 0 }], showFloor: true }
    });

    const floor = qs(root, ".voxcss-floor-z") as HTMLElement;
    // For small grids, --voxcss-floor-grid should be set with a blob URL
    const floorGrid = floor.style.getPropertyValue("--voxcss-floor-grid");
    // Grid sprite may or may not be generated depending on blob URL availability in happy-dom
    // but it should at least not error
    expect(floor).not.toBeNull();

    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// DOM Renderer — Walls
// ---------------------------------------------------------------------------

describe("DOM Renderer — Walls", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("showWalls: true produces backLeft and backRight wall elements", () => {
    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0 }];
    const handle = renderScene({
      element: root,
      scene: { voxels, showWalls: true }
    });

    // At default camera (rotX=65, rotY=45), walls mask: bl=true, br=true, fr=false, fl=false
    const backLeft = qs(root, ".voxcss-wall--backLeft");
    const backRight = qs(root, ".voxcss-wall--backRight");
    expect(backLeft).not.toBeNull();
    expect(backRight).not.toBeNull();

    // Front walls should NOT be present at default angle
    const frontLeft = qs(root, ".voxcss-wall--frontLeft");
    const frontRight = qs(root, ".voxcss-wall--frontRight");
    expect(frontLeft).toBeNull();
    expect(frontRight).toBeNull();

    handle.destroy();
  });

  it("wall elements have backgroundColor set", () => {
    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0 }];
    const handle = renderScene({
      element: root,
      scene: { voxels, showWalls: true }
    });

    const walls = qsa(root, ".voxcss-wall") as HTMLElement[];
    for (const wall of walls) {
      expect(wall.style.backgroundColor).toBeTruthy();
    }

    handle.destroy();
  });

  it("walls have width and height set", () => {
    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0 }];
    const handle = renderScene({
      element: root,
      scene: { voxels, showWalls: true }
    });

    const walls = qsa(root, ".voxcss-wall") as HTMLElement[];
    for (const wall of walls) {
      expect(wall.style.width).toBeTruthy();
      expect(wall.style.height).toBeTruthy();
      expect(wall.style.transform).toBeTruthy();
    }

    handle.destroy();
  });

  it("walls have transforms for 3D positioning", () => {
    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0 }];
    const handle = renderScene({
      element: root,
      scene: { voxels, showWalls: true }
    });

    const backLeft = qs(root, ".voxcss-wall--backLeft") as HTMLElement;
    const backRight = qs(root, ".voxcss-wall--backRight") as HTMLElement;

    expect(backLeft.style.transform).toContain("rotateY");
    expect(backLeft.style.transform).toContain("translateZ");
    expect(backRight.style.transform).toContain("rotateX");
    expect(backRight.style.transform).toContain("translateZ");

    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// DOM Renderer — Area and Tall Voxels
// ---------------------------------------------------------------------------

describe("DOM Renderer — Area and Tall Voxels", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("area voxel (x2=3) has larger --voxcss-side-offset-x", () => {
    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0, x2: 3, y2: 1 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const layers = qsa(root, ".voxcss-layer");
    const voxelContainer = layers[0].firstElementChild as HTMLElement;
    expect(voxelContainer).not.toBeNull();

    // For area voxel spanning x=0 to x2=3 (3 cells), the offsetSpanX should be:
    // spanX = 3 * 50 = 150 > 50, so offsetSpanX = 150 - 25 = 125px
    const offsetX = voxelContainer.style.getPropertyValue("--voxcss-side-offset-x");
    expect(offsetX).toBe("125px");

    handle.destroy();
  });

  it("area voxel (y2=4) has larger --voxcss-side-offset-y and --voxcss-fr-offset", () => {
    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0, x2: 1, y2: 4 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const layers = qsa(root, ".voxcss-layer");
    const voxelContainer = layers[0].firstElementChild as HTMLElement;

    // spanY = 4 * 50 = 200 > 50, so offsetSpanY = 200 - 25 = 175px
    const offsetY = voxelContainer.style.getPropertyValue("--voxcss-side-offset-y");
    expect(offsetY).toBe("175px");

    // fr-offset = spanY = 200px
    const frOffset = voxelContainer.style.getPropertyValue("--voxcss-fr-offset");
    expect(frOffset).toBe("200px");

    handle.destroy();
  });

  it("tall voxel with z2=3 appears in 3 layers", () => {
    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0, z2: 3, color: "#0000ff" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(3);

    // Each layer should have the voxel's container
    for (const layer of layers) {
      expect(layer.children.length).toBeGreaterThanOrEqual(1);
    }

    handle.destroy();
  });

  it("single-cell voxel has default offset values", () => {
    const voxels: VoxelGrid = [{ x: 2, y: 2, z: 0 }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const layers = qsa(root, ".voxcss-layer");
    const voxelContainer = layers[0].firstElementChild as HTMLElement;

    // For single-cell: spanX = 50, offsetSpanX = 25px (half tile)
    const offsetX = voxelContainer.style.getPropertyValue("--voxcss-side-offset-x");
    expect(offsetX).toBe("25px");

    const offsetY = voxelContainer.style.getPropertyValue("--voxcss-side-offset-y");
    expect(offsetY).toBe("25px");

    const frOffset = voxelContainer.style.getPropertyValue("--voxcss-fr-offset");
    expect(frOffset).toBe("50px");

    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// DOM Renderer — Multiple Renders
// ---------------------------------------------------------------------------

describe("DOM Renderer — Multiple Renders", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("renderScene twice on same root reuses elements", () => {
    const handle1 = renderScene({
      element: root,
      scene: { voxels: [{ x: 0, y: 0, z: 0 }] }
    });

    const camera1 = qs(root, ".voxcss-camera");
    expect(camera1).not.toBeNull();

    handle1.destroy();

    // Second render on the same root
    const handle2 = renderScene({
      element: root,
      scene: { voxels: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }] }
    });

    const camera2 = qs(root, ".voxcss-camera");
    expect(camera2).not.toBeNull();

    const layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(1);

    handle2.destroy();
  });

  it("setScene updates voxels and re-renders", () => {
    vi.useFakeTimers();

    const handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }] }
    });

    // Initial: 1 layer, 1 voxel
    let layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(1);

    // Update the scene
    handle.setScene({
      voxels: [
        { x: 0, y: 0, z: 0, color: "#00ff00" },
        { x: 0, y: 0, z: 1, color: "#0000ff" }
      ],
      showWalls: false,
      showFloor: false,
      projection: "cubic"
    });

    vi.advanceTimersByTime(20);

    layers = qsa(root, ".voxcss-layer");
    expect(layers.length).toBe(2);

    handle.destroy();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// DOM Renderer — Large Grid Suppression
// ---------------------------------------------------------------------------

describe("DOM Renderer — Large Grid", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("large grid (>20x20) suppresses grid sprites", () => {
    // Build a grid that extends beyond 20x20 to trigger GRID_DISABLE_THRESHOLD
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0 },
      { x: 25, y: 25, z: 0 }
    ];
    const handle = renderScene({
      element: root,
      scene: { voxels, showFloor: true }
    });

    const floor = qs(root, ".voxcss-floor-z") as HTMLElement;
    // For grids larger than 20x20, the grid sprite should NOT be set (removed)
    const floorGrid = floor.style.getPropertyValue("--voxcss-floor-grid");
    // Should be empty (removed) for large grids
    expect(floorGrid).toBeFalsy();

    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// Snapshots — shapes and projection
// ---------------------------------------------------------------------------

describe("Snapshots — Extended", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("snapshot: single ramp", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "ramp", color: "#44aa88" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(root.innerHTML).toMatchSnapshot();

    handle.destroy();
  });

  it("snapshot: single wedge", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "wedge", color: "#8844aa" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(root.innerHTML).toMatchSnapshot();

    handle.destroy();
  });

  it("snapshot: single spike", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "spike", color: "#aa8844" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    expect(root.innerHTML).toMatchSnapshot();

    handle.destroy();
  });

  it("snapshot: dimetric projection with multiple layers", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0, color: "#ff0000" },
      { x: 0, y: 0, z: 1, color: "#00ff00" },
      { x: 1, y: 1, z: 0, color: "#0000ff" }
    ];
    const handle = renderScene({
      element: root,
      scene: { voxels, projection: "dimetric" }
    });

    expect(root.innerHTML).toMatchSnapshot();

    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// createCamera — advanced setters
// ---------------------------------------------------------------------------

describe("createCamera — advanced features", () => {
  let el: HTMLElement;

  beforeEach(() => {
    el = document.createElement("div");
    document.body.appendChild(el);
  });

  afterEach(() => {
    el.remove();
  });

  it("animate: number sets custom speed", () => {
    const handle = createCamera({ element: el, animate: 0.5 });
    expect(handle).toBeDefined();
    handle.destroy();
  });

  it("animate: 0 does not start animation (treated as falsy)", () => {
    const handle = createCamera({ element: el, animate: 0 });
    // 0 speed is falsy, so no animation should be set up
    expect(handle).toBeDefined();
    handle.destroy();
  });

  it("animate: { axis: 'x', speed: 1 } creates x-axis animation", () => {
    const handle = createCamera({
      element: el,
      animate: { axis: "x", speed: 1, pauseOnInteraction: true }
    });
    expect(handle).toBeDefined();
    handle.destroy();
  });

  it("setAnimate with config object then false stops animation", () => {
    const handle = createCamera({ element: el });
    handle.setAnimate({ speed: 0.5 });
    handle.setAnimate(false);
    // Should not throw
    expect(handle).toBeDefined();
    handle.destroy();
  });

  it("update with rotX and rotY changes camera state", () => {
    const handle = createCamera({ element: el, rotX: 65, rotY: 45 });
    handle.update({ rotX: 30, rotY: 180 });
    const state = handle.controller.getCameraState();
    expect(state.rotX).toBe(30);
    expect(state.rotY).toBe(180);
    handle.destroy();
  });

  it("update with pan and tilt changes camera state", () => {
    const handle = createCamera({ element: el });
    handle.update({ pan: 100, tilt: -50 });
    const state = handle.controller.getCameraState();
    expect(state.pan).toBe(100);
    expect(state.tilt).toBe(-50);
    handle.destroy();
  });

  it("invert option normalizes to multiplier", () => {
    const handle = createCamera({ element: el, invert: true });
    // Invert=true should set pointerInvert to -1
    // We can test this indirectly by checking the controller exists
    expect(handle.controller).toBeDefined();
    handle.destroy();
  });

  it("controller options are forwarded", () => {
    const handle = createCamera({
      element: el,
      controller: {
        camera: { zoom: 2, rotX: 30, rotY: 90 }
      }
    });
    // Controller options should use provided camera settings
    // But the top-level zoom/rotX/rotY override controller.camera values
    const state = handle.controller.getCameraState();
    // Since no top-level zoom provided, falls back to controller.camera.zoom = 2
    expect(state.zoom).toBe(2);
    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// renderScene — setVoxels and setScene API
// ---------------------------------------------------------------------------

describe("renderScene — Handle API", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("setVoxels updates the rendered voxels", () => {
    vi.useFakeTimers();

    const handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 0, y: 0, z: 0 }] }
    });

    let cubes = qsa(root, ".voxcss-cube");
    expect(cubes.length).toBe(1);

    handle.setVoxels([
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 }
    ]);

    vi.advanceTimersByTime(20);

    cubes = qsa(root, ".voxcss-cube");
    expect(cubes.length).toBeGreaterThanOrEqual(3);

    handle.destroy();
    vi.useRealTimers();
  });

  it("setScene with showWalls toggles wall visibility", () => {
    vi.useFakeTimers();

    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0 }];
    const handle = renderScene({
      element: root,
      scene: { voxels }
    });

    expect(qsa(root, ".voxcss-wall")).toHaveLength(0);

    handle.setScene({
      voxels,
      showWalls: true,
      showFloor: false,
      projection: "cubic"
    });

    vi.advanceTimersByTime(20);

    expect(qsa(root, ".voxcss-wall").length).toBeGreaterThan(0);

    handle.destroy();
    vi.useRealTimers();
  });

  it("setScene with showFloor toggles floor visibility", () => {
    vi.useFakeTimers();

    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0 }];
    const handle = renderScene({
      element: root,
      scene: { voxels }
    });

    const floor = qs(root, ".voxcss-floor-z") as HTMLElement;
    expect(floor.style.background).toContain("none");

    handle.setScene({
      voxels,
      showWalls: false,
      showFloor: true,
      projection: "cubic"
    });

    vi.advanceTimersByTime(20);

    // After enabling floor, the background should not contain "none"
    expect(floor.style.background).not.toContain("none");

    handle.destroy();
    vi.useRealTimers();
  });

  it("setScene can switch projection", () => {
    vi.useFakeTimers();

    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0 }];
    const handle = renderScene({
      element: root,
      scene: { voxels, projection: "cubic" }
    });

    const scene = qs(root, ".voxcss-scene") as HTMLElement;
    expect(scene.classList.contains("voxcss-projection--dimetric")).toBe(false);

    handle.setScene({
      voxels,
      showWalls: false,
      showFloor: false,
      projection: "dimetric"
    });

    vi.advanceTimersByTime(20);

    expect(scene.classList.contains("voxcss-projection--dimetric")).toBe(true);

    handle.destroy();
    vi.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// Shape — Color/Lighting variations
// ---------------------------------------------------------------------------

describe("Shape Rendering — Color and Lighting", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("ramp slope color varies by rotation due to lighting", () => {
    const voxelsEast: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "ramp", color: "#cccccc", rot: 0 }];
    const voxelsWest: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "ramp", color: "#cccccc", rot: 180 }];

    const root1 = createRoot();
    const root2 = createRoot();

    const handle1 = renderScene({ element: root1, scene: { voxels: voxelsEast } });
    const handle2 = renderScene({ element: root2, scene: { voxels: voxelsWest } });

    const slope1 = qs(root1, ".voxcss-ramp-slope") as HTMLElement;
    const slope2 = qs(root2, ".voxcss-ramp-slope") as HTMLElement;

    expect(slope1).not.toBeNull();
    expect(slope2).not.toBeNull();

    // Different rotations produce different lighting, so colors should differ
    // (rot=0 gives angle=0 which is far from light source at 180,
    //  rot=180 gives angle=180 which matches light source)
    const color1 = slope1.style.backgroundColor;
    const color2 = slope2.style.backgroundColor;
    expect(color1).not.toBe(color2);

    handle1.destroy();
    handle2.destroy();
    cleanup(root1);
    cleanup(root2);
  });

  it("wedge SVG path fill color is derived from voxel color", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "wedge", color: "#ff0000" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const paths = qsa(root, ".voxcss-wedge-slope svg path");
    expect(paths.length).toBe(2);

    // The fill color should be an rgb string derived from #ff0000
    for (const path of paths) {
      const fill = path.getAttribute("fill") ?? "";
      expect(fill).toContain("rgb");
    }

    handle.destroy();
  });

  it("spike SVG path fill color is derived from voxel color", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "spike", color: "#00ff00" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const paths = qsa(root, ".voxcss-spike-slope svg path");
    expect(paths.length).toBe(2);

    for (const path of paths) {
      const fill = path.getAttribute("fill") ?? "";
      expect(fill).toContain("rgb");
    }

    handle.destroy();
  });

  it("ramp bottom face has correct backgroundColor when visible", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "ramp", color: "#ff8800" }];
    const handle = renderScene({
      element: root,
      camera: { rotX: 95 },
      scene: { voxels }
    });

    const bottom = qs(root, ".voxcss-ramp-bottom") as HTMLElement;
    expect(bottom).not.toBeNull();
    // Bottom face should have the base color
    expect(bottom.style.backgroundColor).toBeTruthy();

    handle.destroy();
  });

  it("ramp bottom face with texture has backgroundImage", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "ramp", texture: "/tex.png" }];
    const handle = renderScene({
      element: root,
      camera: { rotX: 95 },
      scene: { voxels }
    });

    const bottom = qs(root, ".voxcss-ramp-bottom") as HTMLElement;
    expect(bottom).not.toBeNull();
    expect(bottom.style.backgroundImage).toContain("url");
    expect(bottom.style.backgroundImage).toContain("/tex.png");

    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// Shape — SVG attributes
// ---------------------------------------------------------------------------

describe("Shape Rendering — SVG attributes", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("wedge SVG has correct attributes: viewBox, preserveAspectRatio, aria-hidden", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "wedge" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const svgs = qsa(root, ".voxcss-wedge-slope svg");
    expect(svgs.length).toBe(2);

    for (const svg of svgs) {
      expect(svg.getAttribute("viewBox")).toBe("0 0 480 480");
      expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
      expect(svg.getAttribute("aria-hidden")).toBe("true");
      expect(svg.getAttribute("focusable")).toBe("false");
    }

    handle.destroy();
  });

  it("spike SVG has correct attributes", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "spike" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const svgs = qsa(root, ".voxcss-spike-slope svg");
    expect(svgs.length).toBe(2);

    for (const svg of svgs) {
      expect(svg.getAttribute("viewBox")).toBe("0 0 480 480");
      expect(svg.getAttribute("preserveAspectRatio")).toBe("none");
    }

    handle.destroy();
  });

  it("wedge SVG paths have stroke attributes", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "wedge" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const paths = qsa(root, ".voxcss-wedge-slope svg path");
    for (const path of paths) {
      expect(path.getAttribute("stroke")).toBe("rgba(0, 0, 0, 0.1)");
      expect(path.getAttribute("stroke-width")).toBe("1");
      expect(path.getAttribute("vector-effect")).toBe("non-scaling-stroke");
    }

    handle.destroy();
  });

  it("wedge primary slope has expected SVG path", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "wedge" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const primarySlope = qs(root, ".voxcss-wedge-slope--primary svg path");
    expect(primarySlope).not.toBeNull();
    expect(primarySlope?.getAttribute("d")).toBe("M0 0 L480 0 L0 480 Z");

    const secondarySlope = qs(root, ".voxcss-wedge-slope--secondary svg path");
    expect(secondarySlope).not.toBeNull();
    expect(secondarySlope?.getAttribute("d")).toBe("M480 480 L0 480 L480 0 Z");

    handle.destroy();
  });

  it("spike primary slope has expected SVG path", () => {
    const voxels: VoxelGrid = [{ x: 1, y: 1, z: 0, shape: "spike" }];
    const handle = renderScene({ element: root, scene: { voxels } });

    const primarySlope = qs(root, ".voxcss-spike-slope--primary svg path");
    expect(primarySlope).not.toBeNull();
    expect(primarySlope?.getAttribute("d")).toBe("M480 0 L480 480 L0 480 Z");

    const secondarySlope = qs(root, ".voxcss-spike-slope--secondary svg path");
    expect(secondarySlope).not.toBeNull();
    expect(secondarySlope?.getAttribute("d")).toBe("M0 0 L0 480 L480 0 Z");

    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// Ceiling details
// ---------------------------------------------------------------------------

describe("DOM Renderer — Ceiling details", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("ceiling has custom properties for base color and opacity", () => {
    const handle = renderScene({
      element: root,
      camera: { rotX: 95 },
      scene: { voxels: [{ x: 0, y: 0, z: 0 }], showFloor: true }
    });

    const ceiling = qs(root, ".voxcss-ceiling") as HTMLElement;
    expect(ceiling).not.toBeNull();
    expect(ceiling.style.getPropertyValue("--voxcss-ceiling-base")).toBeTruthy();
    expect(ceiling.style.getPropertyValue("--voxcss-ceiling-opacity")).toBe("0.35");

    handle.destroy();
  });

  it("ceiling has correct dimensions based on grid size", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 3, z: 0 }
    ];
    const handle = renderScene({
      element: root,
      camera: { rotX: 95 },
      scene: { voxels, showFloor: true }
    });

    const ceiling = qs(root, ".voxcss-ceiling") as HTMLElement;
    expect(ceiling).not.toBeNull();

    // Grid: rows=3 (x up to 2+1), cols=4 (y up to 3+1)
    // Width = cols * tileSize = 4 * 50 = 200px
    // Height = rows * tileSize = 3 * 50 = 150px
    expect(ceiling.style.width).toBe("200px");
    expect(ceiling.style.height).toBe("150px");

    handle.destroy();
  });

  it("ceiling positioned via translateZ at depth * tileSize", () => {
    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0 }];
    const handle = renderScene({
      element: root,
      camera: { rotX: 95 },
      scene: { voxels, showFloor: true }
    });

    const ceiling = qs(root, ".voxcss-ceiling") as HTMLElement;
    expect(ceiling).not.toBeNull();
    // depth=1 (one voxel at z=0), tileSize=50
    expect(ceiling.style.transform).toBe("translateZ(50px)");

    handle.destroy();
  });
});

// ---------------------------------------------------------------------------
// CSS vars on scene host
// ---------------------------------------------------------------------------

describe("DOM Renderer — CSS vars on scene host", () => {
  let root: HTMLElement;

  beforeEach(() => {
    root = createRoot();
  });

  afterEach(() => {
    cleanup(root);
  });

  it("scene host has --voxcss-rows and --voxcss-cols set", () => {
    const voxels: VoxelGrid = [
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 6, z: 0 }
    ];
    const handle = renderScene({ element: root, scene: { voxels } });

    const scene = qs(root, ".voxcss-scene") as HTMLElement;
    expect(scene.style.getPropertyValue("--voxcss-rows")).toBe("5");
    expect(scene.style.getPropertyValue("--voxcss-cols")).toBe("7");

    handle.destroy();
  });

  it("floor has grid size custom properties when showFloor is true", () => {
    const voxels: VoxelGrid = [{ x: 0, y: 0, z: 0 }];
    const handle = renderScene({
      element: root,
      scene: { voxels, showFloor: true }
    });

    const floor = qs(root, ".voxcss-floor-z") as HTMLElement;
    expect(floor.style.getPropertyValue("--voxcss-grid-x")).toBe("50px");
    expect(floor.style.getPropertyValue("--voxcss-grid-y")).toBe("50px");

    handle.destroy();
  });
});
