/**
 * Phenomenological CSS / DOM-structure tests for VoxCSS.
 *
 * These tests assert on the exact CSS custom properties, class names,
 * inline styles, and DOM hierarchy produced by the rendering pipeline.
 *
 * Environment: vitest + happy-dom
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { renderScene } from "../../src/core/headless";
import { injectBaseStyles } from "../../src/core/styles";
import { STYLE_ID, FLOOR_CLASS, LAYER_CLASS, WALL_CLASS, CEILING_CLASS, CUBE_CLASS, FACE_CLASS } from "../../src/core/types";
// Lighting helpers intentionally NOT imported — tests use hardcoded expected values
// to catch regressions in the shading math itself.

// ---------------------------------------------------------------------------
// Option polyfill - happy-dom may not have Option constructor
// ---------------------------------------------------------------------------
beforeAll(() => {
  if (typeof globalThis.Option === "undefined") {
    (globalThis as Record<string, unknown>).Option = class Option {
      value: string;
      text: string;
      constructor(text = "", value = "", defaultSelected = false, selected = false) {
        this.text = text;
        this.value = value;
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

/** Query the first element matching the selector inside root, or throw. */
function q(root: HTMLElement, selector: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  return el;
}

/** Query all elements matching the selector inside root. */
function qa(root: HTMLElement, selector: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector));
}

// ---------------------------------------------------------------------------
// 1. Base stylesheet injection
// ---------------------------------------------------------------------------
describe("Base stylesheet injection", () => {
  beforeEach(() => {
    const existing = document.getElementById(STYLE_ID);
    if (existing) existing.remove();
  });

  it("injects a <style> element with the expected id", () => {
    injectBaseStyles(document);
    const style = document.getElementById(STYLE_ID);
    expect(style).not.toBeNull();
    expect(style!.tagName.toLowerCase()).toBe("style");
  });

  it("does not inject twice", () => {
    injectBaseStyles(document);
    injectBaseStyles(document);
    const all = document.querySelectorAll(`#${STYLE_ID}`);
    expect(all.length).toBe(1);
  });

  it("stylesheet contains .voxcss-camera with perspective: 8000px", () => {
    injectBaseStyles(document);
    const text = document.getElementById(STYLE_ID)!.textContent!;
    expect(text).toContain(".voxcss-camera");
    expect(text).toContain("perspective: 8000px");
  });

  it("stylesheet contains .voxcss-camera * with transform-style: preserve-3d", () => {
    injectBaseStyles(document);
    const text = document.getElementById(STYLE_ID)!.textContent!;
    expect(text).toContain(".voxcss-camera *");
    expect(text).toContain("transform-style: preserve-3d");
  });

  it("stylesheet contains .voxcss-cube-face rules", () => {
    injectBaseStyles(document);
    const text = document.getElementById(STYLE_ID)!.textContent!;
    expect(text).toContain(".voxcss-cube-face");
    expect(text).toContain(".voxcss-cube-face--t");
    expect(text).toContain(".voxcss-cube-face--fl");
    expect(text).toContain(".voxcss-cube-face--fr");
    expect(text).toContain(".voxcss-cube-face--bl");
    expect(text).toContain(".voxcss-cube-face--br");
    expect(text).toContain(".voxcss-cube-face--b");
  });

  it("stylesheet contains .voxcss-layer rules", () => {
    injectBaseStyles(document);
    const text = document.getElementById(STYLE_ID)!.textContent!;
    expect(text).toContain(".voxcss-layer");
    expect(text).toContain("display: grid");
    expect(text).toContain("grid-template-columns: repeat(var(--voxcss-cols, 8), 50px)");
    expect(text).toContain("grid-template-rows: repeat(var(--voxcss-rows, 8), 50px)");
  });

  it("stylesheet contains wall positioning rules", () => {
    injectBaseStyles(document);
    const text = document.getElementById(STYLE_ID)!.textContent!;
    expect(text).toContain(".voxcss-wall");
    expect(text).toContain(".voxcss-wall--frontRight");
    expect(text).toContain(".voxcss-wall--backRight");
    expect(text).toContain(".voxcss-wall--backLeft");
    // Note: .voxcss-wall--frontLeft is used in DOM but has no dedicated CSS rule in the base stylesheet
  });

  it("stylesheet contains .voxcss-cube-face outline rule", () => {
    injectBaseStyles(document);
    const text = document.getElementById(STYLE_ID)!.textContent!;
    expect(text).toContain("outline: 1px solid rgba(0, 0, 0, 0.08)");
  });

  it("stylesheet contains floor pointer-events: none", () => {
    injectBaseStyles(document);
    const text = document.getElementById(STYLE_ID)!.textContent!;
    // .voxcss-layer has pointer-events: none in the base stylesheet
    expect(text).toContain("pointer-events: none");
  });
});

// ---------------------------------------------------------------------------
// 2. CSS custom properties on scene elements
// ---------------------------------------------------------------------------
describe("CSS custom properties on scene elements", () => {
  let root: HTMLElement;
  let handle: ReturnType<typeof renderScene>;

  afterEach(() => {
    handle?.destroy();
    root?.remove();
  });

  it("sets --voxcss-rows and --voxcss-cols matching grid dimensions", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [
          { x: 1, y: 1, z: 0 },
          { x: 3, y: 4, z: 0 }
        ]
      }
    });
    // The scene host element (child of camera) should have these properties.
    const sceneHost = root.querySelector<HTMLElement>(".voxcss-scene");
    expect(sceneHost).not.toBeNull();
    const rows = sceneHost!.style.getPropertyValue("--voxcss-rows");
    const cols = sceneHost!.style.getPropertyValue("--voxcss-cols");
    // Voxels go up to x=3 (+1=4 rows) and y=4 (+1=5 cols)
    expect(rows).toBe("4");
    expect(cols).toBe("5");
  });

  it("sets --voxcss-layer-elevation to 50px for cubic projection (via stylesheet)", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0 }] }
    });
    // The .voxcss-camera element gets --voxcss-layer-elevation: 50px from the stylesheet
    const text = document.getElementById(STYLE_ID)!.textContent!;
    expect(text).toContain("--voxcss-layer-elevation: 50px");
  });

  it("sets --voxcss-layer-elevation to 25px for dimetric projection (via stylesheet)", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [{ x: 1, y: 1, z: 0 }],
        projection: "dimetric"
      }
    });
    const text = document.getElementById(STYLE_ID)!.textContent!;
    expect(text).toContain(".voxcss-projection--dimetric");
    expect(text).toContain("--voxcss-layer-elevation: 25px");
  });

  it("sets --voxcss-layer-half via stylesheet", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0 }] }
    });
    const text = document.getElementById(STYLE_ID)!.textContent!;
    expect(text).toContain("--voxcss-layer-half: calc(var(--voxcss-layer-elevation, 50px) / 2)");
  });

  it("sets --voxcss-side-offset-x and --voxcss-side-offset-y to 25px on 1x1 cube elements", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0 }] }
    });
    const cube = root.querySelector<HTMLElement>(`.${CUBE_CLASS}`);
    expect(cube).not.toBeNull();
    expect(cube!.style.getPropertyValue("--voxcss-side-offset-x")).toBe("25px");
    expect(cube!.style.getPropertyValue("--voxcss-side-offset-y")).toBe("25px");
  });

  it("sets --voxcss-fr-offset to 50px on a 1x1 cube", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0 }] }
    });
    const cube = root.querySelector<HTMLElement>(`.${CUBE_CLASS}`);
    expect(cube).not.toBeNull();
    expect(cube!.style.getPropertyValue("--voxcss-fr-offset")).toBe("50px");
  });

  it("adjusts --voxcss-side-offset for area voxels", () => {
    root = createRoot();
    // A 2x3 area voxel: x=1..3, y=1..4
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0, x2: 3, y2: 4 }] }
    });
    const cube = root.querySelector<HTMLElement>(`.${CUBE_CLASS}`);
    expect(cube).not.toBeNull();
    // spanX = (3-1) * 50 = 100, offsetSpanX = 100 - 25 = 75
    expect(cube!.style.getPropertyValue("--voxcss-side-offset-x")).toBe("75px");
    // spanY = (4-1) * 50 = 150, offsetSpanY = 150 - 25 = 125
    expect(cube!.style.getPropertyValue("--voxcss-side-offset-y")).toBe("125px");
    // fr offset = spanY = 150
    expect(cube!.style.getPropertyValue("--voxcss-fr-offset")).toBe("150px");
  });
});

// ---------------------------------------------------------------------------
// 3. Cube face CSS transforms
// ---------------------------------------------------------------------------
describe("Cube face CSS transforms", () => {
  let root: HTMLElement;
  let handle: ReturnType<typeof renderScene>;

  afterEach(() => {
    handle?.destroy();
    root?.remove();
  });

  it("renders face elements with correct class names", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0 }] }
    });
    // Default walls mask hides b, bl, br, so only t, fr, fl should be visible
    const faces = qa(root, `.${FACE_CLASS}`);
    const classNames = faces.map((f) => f.className);
    expect(classNames).toContain(`${FACE_CLASS} ${FACE_CLASS}--t`);
    expect(classNames).toContain(`${FACE_CLASS} ${FACE_CLASS}--fl`);
    expect(classNames).toContain(`${FACE_CLASS} ${FACE_CLASS}--fr`);
  });

  it("face transform rules are present in stylesheet", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0 }] }
    });
    const text = document.getElementById(STYLE_ID)!.textContent!;
    // Top face
    expect(text).toContain(".voxcss-cube-face--t");
    expect(text).toContain("transform: translateZ(var(--voxcss-layer-half))");
    // Front-left face
    expect(text).toContain(".voxcss-cube-face--fl");
    expect(text).toContain("rotateX(90deg) translateZ(calc(-1 * var(--voxcss-side-offset-x, 25px)))");
    // Front-right face
    expect(text).toContain(".voxcss-cube-face--fr");
    expect(text).toContain("rotateY(90deg) translateZ(var(--voxcss-side-offset-y, 25px))");
    // Back-left face
    expect(text).toContain(".voxcss-cube-face--bl");
    // Bottom face
    expect(text).toContain(".voxcss-cube-face--b");
    expect(text).toContain("transform: translateZ(calc(-1 * var(--voxcss-layer-half)))");
    // Back-right face
    expect(text).toContain(".voxcss-cube-face--br");
    expect(text).toContain("rotateX(90deg) translateZ(var(--voxcss-layer-half))");
  });

  it("fr face width is set to layer-elevation in stylesheet", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0 }] }
    });
    const text = document.getElementById(STYLE_ID)!.textContent!;
    // .voxcss-cube-face--fr has width: var(--voxcss-layer-elevation, 50px)
    expect(text).toContain("width: var(--voxcss-layer-elevation, 50px)");
  });

  it("fl face height is set to layer-elevation in stylesheet", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0 }] }
    });
    const text = document.getElementById(STYLE_ID)!.textContent!;
    // .voxcss-cube-face--fl has height: var(--voxcss-layer-elevation, 50px)
    expect(text).toContain("height: var(--voxcss-layer-elevation, 50px)");
  });
});

// ---------------------------------------------------------------------------
// 4. Wall CSS transforms
// ---------------------------------------------------------------------------
describe("Wall CSS transforms", () => {
  let root: HTMLElement;
  let handle: ReturnType<typeof renderScene>;

  afterEach(() => {
    handle?.destroy();
    root?.remove();
  });

  it("renders wall elements when showWalls is true", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [{ x: 1, y: 1, z: 0 }],
        showWalls: true,
        showFloor: true
      }
    });
    // Default walls: b=true, bl=true, br=true, fl=false, fr=false
    // With showWalls=true, walls matching mask=true should appear
    const walls = qa(root, `.${WALL_CLASS}`);
    expect(walls.length).toBeGreaterThan(0);
  });

  it("wall elements have correct class names", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [{ x: 1, y: 1, z: 0 }],
        showWalls: true,
        showFloor: true
      }
    });
    const wallClasses = qa(root, `.${WALL_CLASS}`).map((w) => w.className);
    // Default mask: bl=true, br=true. (b=true is floor, not a wall element here)
    expect(wallClasses.some((c) => c.includes(`${WALL_CLASS}--backLeft`))).toBe(true);
    expect(wallClasses.some((c) => c.includes(`${WALL_CLASS}--backRight`))).toBe(true);
  });

  it("wall elements have inline transforms with translateZ and rotateY/rotateX", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [{ x: 1, y: 1, z: 0 }],
        showWalls: true,
        showFloor: true
      }
    });
    const backLeft = root.querySelector<HTMLElement>(`.${WALL_CLASS}--backLeft`);
    expect(backLeft).not.toBeNull();
    const transform = backLeft!.style.transform;
    expect(transform).toContain("rotateY(-90deg)");
    expect(transform).toContain("translateZ");

    const backRight = root.querySelector<HTMLElement>(`.${WALL_CLASS}--backRight`);
    expect(backRight).not.toBeNull();
    const brTransform = backRight!.style.transform;
    expect(brTransform).toContain("rotateX(90deg)");
    expect(brTransform).toContain("translateZ");
  });

  it("wall elements have dimensions set via inline styles", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [{ x: 1, y: 1, z: 0 }],
        showWalls: true,
        showFloor: true
      }
    });
    const backLeft = root.querySelector<HTMLElement>(`.${WALL_CLASS}--backLeft`);
    expect(backLeft).not.toBeNull();
    expect(backLeft!.style.width).toBeTruthy();
    expect(backLeft!.style.height).toBeTruthy();
  });

  it("wall shading colors are applied as backgroundColor", () => {
    root = createRoot();
    const wallColor = "#3e3e4d";
    handle = renderScene({
      element: root,
      scene: {
        voxels: [{ x: 1, y: 1, z: 0 }],
        showWalls: true,
        showFloor: true
      }
    });
    // #3e3e4d = rgb(62,62,77). Wall shading inverts cube deltas: bl→+40, br→+30
    const backLeft = root.querySelector<HTMLElement>(`.${WALL_CLASS}--backLeft`);
    expect(backLeft).not.toBeNull();
    expect(backLeft!.style.backgroundColor).toBe("rgb(102, 102, 117)");

    const backRight = root.querySelector<HTMLElement>(`.${WALL_CLASS}--backRight`);
    expect(backRight).not.toBeNull();
    expect(backRight!.style.backgroundColor).toBe("rgb(92, 92, 107)");
  });
});

// ---------------------------------------------------------------------------
// 5. Layer positioning
// ---------------------------------------------------------------------------
describe("Layer positioning", () => {
  let root: HTMLElement;
  let handle: ReturnType<typeof renderScene>;

  afterEach(() => {
    handle?.destroy();
    root?.remove();
  });

  it("each layer has translateZ based on z-index * layer elevation", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [
          { x: 1, y: 1, z: 0 },
          { x: 1, y: 1, z: 1 },
          { x: 1, y: 1, z: 2 }
        ]
      }
    });
    const layers = qa(root, `.${LAYER_CLASS}`);
    expect(layers.length).toBe(3);
    // Cubic projection: layerElevation = 50px
    expect(layers[0].style.transform).toBe("translateZ(0px)");
    expect(layers[1].style.transform).toBe("translateZ(50px)");
    expect(layers[2].style.transform).toBe("translateZ(100px)");
  });

  it("dimetric projection uses 25px layer elevation", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [
          { x: 1, y: 1, z: 0 },
          { x: 1, y: 1, z: 1 },
          { x: 1, y: 1, z: 2 }
        ],
        projection: "dimetric"
      }
    });
    const layers = qa(root, `.${LAYER_CLASS}`);
    expect(layers.length).toBe(3);
    expect(layers[0].style.transform).toBe("translateZ(0px)");
    expect(layers[1].style.transform).toBe("translateZ(25px)");
    expect(layers[2].style.transform).toBe("translateZ(50px)");
  });

  it("layer grid template uses repeat(cols, 50px) / repeat(rows, 50px) from stylesheet", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0 }] }
    });
    const text = document.getElementById(STYLE_ID)!.textContent!;
    expect(text).toContain("grid-template-columns: repeat(var(--voxcss-cols, 8), 50px)");
    expect(text).toContain("grid-template-rows: repeat(var(--voxcss-rows, 8), 50px)");
  });
});

// ---------------------------------------------------------------------------
// 6. Cube element positioning within layers
// ---------------------------------------------------------------------------
describe("Cube element positioning within layers", () => {
  let root: HTMLElement;
  let handle: ReturnType<typeof renderScene>;

  afterEach(() => {
    handle?.destroy();
    root?.remove();
  });

  it("cube container uses grid-area for positioning: x / y / x+1 / y+1", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [{ x: 2, y: 3, z: 0 }]
      }
    });
    const layer = q(root, `.${LAYER_CLASS}`);
    const voxelContainer = layer.firstElementChild as HTMLElement;
    expect(voxelContainer).not.toBeNull();
    // grid-area: x / y / x2 / y2 = 2 / 3 / 3 / 4
    expect(voxelContainer.style.gridArea).toBe("2 / 3 / 3 / 4");
  });

  it("area voxels get correct expanded grid-area", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [{ x: 1, y: 1, z: 0, x2: 4, y2: 5 }]
      }
    });
    const layer = q(root, `.${LAYER_CLASS}`);
    const voxelContainer = layer.firstElementChild as HTMLElement;
    expect(voxelContainer).not.toBeNull();
    expect(voxelContainer.style.gridArea).toBe("1 / 1 / 4 / 5");
  });

  it("multiple voxels in same layer get separate grid-area values", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [
          { x: 1, y: 1, z: 0 },
          { x: 3, y: 4, z: 0 }
        ]
      }
    });
    const layer = q(root, `.${LAYER_CLASS}`);
    const children = Array.from(layer.children) as HTMLElement[];
    expect(children.length).toBe(2);
    const gridAreas = children.map((c) => c.style.gridArea);
    expect(gridAreas).toContain("1 / 1 / 2 / 2");
    expect(gridAreas).toContain("3 / 4 / 4 / 5");
  });
});

// ---------------------------------------------------------------------------
// 7. Floor and ceiling
// ---------------------------------------------------------------------------
describe("Floor and ceiling", () => {
  let root: HTMLElement;
  let handle: ReturnType<typeof renderScene>;

  afterEach(() => {
    handle?.destroy();
    root?.remove();
  });

  it("floor element has background color derived from --voxcss-floor-base", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [{ x: 1, y: 1, z: 0 }],
        showFloor: true
      }
    });
    const floor = root.querySelector<HTMLElement>(`.${FLOOR_CLASS}`);
    expect(floor).not.toBeNull();
    // The floor base color is set as a custom property
    const floorBase = floor!.style.getPropertyValue("--voxcss-floor-base");
    expect(floorBase).toBeTruthy();
  });

  it("floor has grid overlay SVG when dimensions are reasonable", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [{ x: 1, y: 1, z: 0 }],
        showFloor: true
      }
    });
    const floor = root.querySelector<HTMLElement>(`.${FLOOR_CLASS}`);
    expect(floor).not.toBeNull();
    const floorGrid = floor!.style.getPropertyValue("--voxcss-floor-grid");
    // Grid should be a url("blob:...") or similar when dims < 20
    expect(floorGrid).toContain("url(");
  });

  it("ceiling appears when walls.t === true and showFloor === true", () => {
    root = createRoot();
    // To get walls.t = true, we need rotX >= 90
    handle = renderScene({
      element: root,
      camera: { rotX: 95, rotY: 45 },
      scene: {
        voxels: [{ x: 1, y: 1, z: 0 }],
        showFloor: true
      }
    });
    const ceiling = root.querySelector<HTMLElement>(`.${CEILING_CLASS}`);
    expect(ceiling).not.toBeNull();
  });

  it("ceiling is positioned at correct Z height", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      camera: { rotX: 95, rotY: 45 },
      scene: {
        voxels: [{ x: 1, y: 1, z: 0 }],
        showFloor: true
      }
    });
    const ceiling = root.querySelector<HTMLElement>(`.${CEILING_CLASS}`);
    expect(ceiling).not.toBeNull();
    // depth=1 (one voxel at z=0 => depth inferred to 1), tileSize=50
    // translateZ(depth * tileSize) = translateZ(50px)
    expect(ceiling!.style.transform).toBe("translateZ(50px)");
  });

  it("no ceiling when walls.t === false (default angle)", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [{ x: 1, y: 1, z: 0 }],
        showFloor: true
      }
    });
    const ceiling = root.querySelector<HTMLElement>(`.${CEILING_CLASS}`);
    expect(ceiling).toBeNull();
  });

  it("floor pointer-events set to none", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [{ x: 1, y: 1, z: 0 }],
        showFloor: true
      }
    });
    const floor = root.querySelector<HTMLElement>(`.${FLOOR_CLASS}`);
    expect(floor).not.toBeNull();
    // The renderer sets floor.style.pointerEvents = "none" in syncSceneStructure
    expect(floor!.style.pointerEvents).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// 8. Dimetric projection
// ---------------------------------------------------------------------------
describe("Dimetric projection", () => {
  let root: HTMLElement;
  let handle: ReturnType<typeof renderScene>;

  afterEach(() => {
    handle?.destroy();
    root?.remove();
  });

  it("scene has class voxcss-projection--dimetric", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [{ x: 1, y: 1, z: 0 }],
        projection: "dimetric"
      }
    });
    const sceneHost = root.querySelector<HTMLElement>(".voxcss-scene");
    expect(sceneHost).not.toBeNull();
    expect(sceneHost!.classList.contains("voxcss-projection--dimetric")).toBe(true);
  });

  it("layer Z offsets use 25px increments for dimetric", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [
          { x: 1, y: 1, z: 0 },
          { x: 1, y: 1, z: 1 }
        ],
        projection: "dimetric"
      }
    });
    const layers = qa(root, `.${LAYER_CLASS}`);
    expect(layers[0].style.transform).toBe("translateZ(0px)");
    expect(layers[1].style.transform).toBe("translateZ(25px)");
  });

  it("stylesheet defines dimetric-specific rules", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [{ x: 1, y: 1, z: 0 }],
        projection: "dimetric"
      }
    });
    const text = document.getElementById(STYLE_ID)!.textContent!;
    expect(text).toContain(".voxcss-projection--dimetric .voxcss-cube");
    expect(text).toContain(".voxcss-projection--dimetric .voxcss-cube-face--t");
  });
});

// ---------------------------------------------------------------------------
// 9. Camera transform
// ---------------------------------------------------------------------------
describe("Camera transform", () => {
  let root: HTMLElement;
  let handle: ReturnType<typeof renderScene>;

  afterEach(() => {
    handle?.destroy();
    root?.remove();
  });

  it("camera element has correct CSS transform string", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      camera: { zoom: 0.65, rotX: 65, rotY: 45, pan: 0, tilt: 0 },
      scene: { voxels: [{ x: 1, y: 1, z: 0 }] }
    });
    const cameraEl = root.querySelector<HTMLElement>(".voxcss-camera");
    expect(cameraEl).not.toBeNull();
    // The scene host (child of camera) gets the transform from controller.getBoxStyle()
    const sceneHost = root.querySelector<HTMLElement>(".voxcss-scene");
    expect(sceneHost).not.toBeNull();
    const transform = sceneHost!.style.transform;
    expect(transform).toContain("scale(");
    expect(transform).toContain("translateY(");
    expect(transform).toContain("translateX(");
    expect(transform).toContain("rotateX(");
    expect(transform).toContain("rotate(");
  });

  it("camera element has perspective set", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0 }] }
    });
    const cameraEl = root.querySelector<HTMLElement>(".voxcss-camera");
    expect(cameraEl).not.toBeNull();
    expect(cameraEl!.style.perspective).toBe("8000px");
  });

  it("custom perspective is applied", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      camera: { perspective: 5000 },
      scene: { voxels: [{ x: 1, y: 1, z: 0 }] }
    });
    const cameraEl = root.querySelector<HTMLElement>(".voxcss-camera");
    expect(cameraEl).not.toBeNull();
    expect(cameraEl!.style.perspective).toBe("5000px");
  });

  it("perspective: false sets perspective to none", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      camera: { perspective: false },
      scene: { voxels: [{ x: 1, y: 1, z: 0 }] }
    });
    const cameraEl = root.querySelector<HTMLElement>(".voxcss-camera");
    expect(cameraEl).not.toBeNull();
    expect(cameraEl!.style.perspective).toBe("none");
  });

  it("camera transform includes the correct values for zoom, rotX, rotY", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      camera: { zoom: 1.5, rotX: 70, rotY: 30, pan: 10, tilt: -5 },
      scene: { voxels: [{ x: 1, y: 1, z: 0 }] }
    });
    const sceneHost = root.querySelector<HTMLElement>(".voxcss-scene");
    expect(sceneHost).not.toBeNull();
    const transform = sceneHost!.style.transform;
    expect(transform).toContain("scale(1.5)");
    expect(transform).toContain("rotateX(70deg)");
    expect(transform).toContain("rotate(30deg)");
    expect(transform).toContain("translateX(10px)");
    expect(transform).toContain("translateY(-5px)");
  });
});

// ---------------------------------------------------------------------------
// 10. Shape rotation CSS property
// ---------------------------------------------------------------------------
describe("Shape rotation CSS property", () => {
  let root: HTMLElement;
  let handle: ReturnType<typeof renderScene>;

  afterEach(() => {
    handle?.destroy();
    root?.remove();
  });

  it("ramp with rot=0 gets voxcss-east class", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0, shape: "ramp", rot: 0 }] }
    });
    const layer = q(root, `.${LAYER_CLASS}`);
    const voxelContainer = layer.firstElementChild as HTMLElement;
    expect(voxelContainer.classList.contains("voxcss-east")).toBe(true);
  });

  it("ramp with rot=90 gets voxcss-south class", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0, shape: "ramp", rot: 90 }] }
    });
    const layer = q(root, `.${LAYER_CLASS}`);
    const voxelContainer = layer.firstElementChild as HTMLElement;
    expect(voxelContainer.classList.contains("voxcss-south")).toBe(true);
  });

  it("ramp with rot=180 gets voxcss-west class", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0, shape: "ramp", rot: 180 }] }
    });
    const layer = q(root, `.${LAYER_CLASS}`);
    const voxelContainer = layer.firstElementChild as HTMLElement;
    expect(voxelContainer.classList.contains("voxcss-west")).toBe(true);
  });

  it("ramp with rot=270 gets voxcss-north class", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0, shape: "ramp", rot: 270 }] }
    });
    const layer = q(root, `.${LAYER_CLASS}`);
    const voxelContainer = layer.firstElementChild as HTMLElement;
    expect(voxelContainer.classList.contains("voxcss-north")).toBe(true);
  });

  it("stylesheet defines --voxcss-shape-rotation for each orientation", () => {
    injectBaseStyles(document);
    const text = document.getElementById(STYLE_ID)!.textContent!;
    expect(text).toContain(".voxcss-east");
    expect(text).toContain("--voxcss-shape-rotation: 0deg");
    expect(text).toContain(".voxcss-south");
    expect(text).toContain("--voxcss-shape-rotation: 90deg");
    expect(text).toContain(".voxcss-west");
    expect(text).toContain("--voxcss-shape-rotation: 180deg");
    expect(text).toContain(".voxcss-north");
    expect(text).toContain("--voxcss-shape-rotation: 270deg");
  });

  it("wedge shape gets correct orientation class", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0, shape: "wedge", rot: 90 }] }
    });
    const layer = q(root, `.${LAYER_CLASS}`);
    const voxelContainer = layer.firstElementChild as HTMLElement;
    expect(voxelContainer.classList.contains("voxcss-south")).toBe(true);
  });

  it("spike shape gets correct orientation class", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0, shape: "spike", rot: 270 }] }
    });
    const layer = q(root, `.${LAYER_CLASS}`);
    const voxelContainer = layer.firstElementChild as HTMLElement;
    expect(voxelContainer.classList.contains("voxcss-north")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 11. Face appearance inline styles
// ---------------------------------------------------------------------------
describe("Face appearance inline styles", () => {
  let root: HTMLElement;
  let handle: ReturnType<typeof renderScene>;

  afterEach(() => {
    handle?.destroy();
    root?.remove();
  });

  it("colored cube has correct shaded background-color on each visible face", () => {
    root = createRoot();
    const color = "#ff0000";
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0, color }] }
    });
    // Default visible faces: t, fr, fl
    // #ff0000 = rgb(255,0,0). t delta=0, fr delta=-15, fl delta=-25
    const topFace = root.querySelector<HTMLElement>(`.${FACE_CLASS}--t`);
    expect(topFace).not.toBeNull();
    expect(topFace!.style.backgroundColor).toBe("rgb(255, 0, 0)");

    const frFace = root.querySelector<HTMLElement>(`.${FACE_CLASS}--fr`);
    expect(frFace).not.toBeNull();
    expect(frFace!.style.backgroundColor).toBe("rgb(240, 0, 0)");

    const flFace = root.querySelector<HTMLElement>(`.${FACE_CLASS}--fl`);
    expect(flFace).not.toBeNull();
    expect(flFace!.style.backgroundColor).toBe("rgb(230, 0, 0)");
  });

  it("top face has delta=0, fr has delta=-15, fl has delta=-25", () => {
    root = createRoot();
    const color = "#808080"; // gray
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0, color }] }
    });
    // #808080 = rgb(128,128,128). t: delta=0, fr: delta=-15, fl: delta=-25
    const topFace = root.querySelector<HTMLElement>(`.${FACE_CLASS}--t`);
    expect(topFace!.style.backgroundColor).toBe("rgb(128, 128, 128)");

    const frFace = root.querySelector<HTMLElement>(`.${FACE_CLASS}--fr`);
    expect(frFace!.style.backgroundColor).toBe("rgb(113, 113, 113)");

    const flFace = root.querySelector<HTMLElement>(`.${FACE_CLASS}--fl`);
    expect(flFace!.style.backgroundColor).toBe("rgb(103, 103, 103)");
  });

  it("textured cube has background-image with the texture URL", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0, texture: "https://example.com/texture.png" }] }
    });
    const topFace = root.querySelector<HTMLElement>(`.${FACE_CLASS}--t`);
    expect(topFace).not.toBeNull();
    // happy-dom may quote the URL; accept both quoted and unquoted forms
    expect(topFace!.style.backgroundImage).toContain("https://example.com/texture.png");
  });

  it("textured cube fr face has brightness filter", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0, texture: "https://example.com/texture.png" }] }
    });
    const frFace = root.querySelector<HTMLElement>(`.${FACE_CLASS}--fr`);
    expect(frFace).not.toBeNull();
    // fr delta=-15, brightness = 1 + (-15/200) = 0.925
    expect(frFace!.style.filter).toContain("brightness(0.925)");
  });

  it("textured cube top face has no brightness filter (delta=0)", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0, texture: "https://example.com/texture.png" }] }
    });
    const topFace = root.querySelector<HTMLElement>(`.${FACE_CLASS}--t`);
    expect(topFace).not.toBeNull();
    // delta=0, brightness=1.0, so no filter (abs(1-1) < 0.001)
    expect(topFace!.style.filter).toBe("");
  });

  it("default color #cccccc is used when no color is specified", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: { voxels: [{ x: 1, y: 1, z: 0 }] }
    });
    const topFace = root.querySelector<HTMLElement>(`.${FACE_CLASS}--t`);
    expect(topFace).not.toBeNull();
    // #cccccc = rgb(204,204,204), top face delta=0
    expect(topFace!.style.backgroundColor).toBe("rgb(204, 204, 204)");
  });
});

// ---------------------------------------------------------------------------
// 12. Cube face outline
// ---------------------------------------------------------------------------
describe("Cube face outline", () => {
  it("stylesheet defines outline for .voxcss-cube-face", () => {
    injectBaseStyles(document);
    const text = document.getElementById(STYLE_ID)!.textContent!;
    expect(text).toContain("outline: 1px solid rgba(0, 0, 0, 0.08)");
    expect(text).toContain("outline-offset: -1px");
  });
});

// ---------------------------------------------------------------------------
// 13. Pointer events on floor
// ---------------------------------------------------------------------------
describe("Pointer events on floor", () => {
  let root: HTMLElement;
  let handle: ReturnType<typeof renderScene>;

  afterEach(() => {
    handle?.destroy();
    root?.remove();
  });

  it("floor element has pointer-events: none inline style", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [{ x: 1, y: 1, z: 0 }],
        showFloor: true
      }
    });
    const floor = root.querySelector<HTMLElement>(`.${FLOOR_CLASS}`);
    expect(floor).not.toBeNull();
    expect(floor!.style.pointerEvents).toBe("none");
  });

  it("layer element has pointer-events: none from stylesheet", () => {
    injectBaseStyles(document);
    const text = document.getElementById(STYLE_ID)!.textContent!;
    // .voxcss-layer has pointer-events: none
    expect(text).toContain(".voxcss-layer");
    expect(text).toContain("pointer-events: none");
  });

  it("layer children have pointer-events: all from stylesheet", () => {
    injectBaseStyles(document);
    const text = document.getElementById(STYLE_ID)!.textContent!;
    expect(text).toContain(".voxcss-layer > *");
    expect(text).toContain("pointer-events: all");
  });
});
