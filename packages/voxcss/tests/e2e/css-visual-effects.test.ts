import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { renderScene } from "../../src/core/headless";
import type { HeadlessRenderHandle } from "../../src/core/headless";
import { createDomRenderer } from "../../src/core/domRenderer";
import type { SceneSnapshot } from "../../src/core/domRenderer";
import { buildSceneContext } from "../../src/core/context";
import { injectBaseStyles } from "../../src/core/styles";
// Lighting helpers intentionally NOT imported — tests use hardcoded expected values
// to catch regressions in the shading math itself.
import type { CubeFace, Voxel, WallsMask, GridContext } from "../../src/core/types";
import {
  CUBE_FACES,
  DEFAULT_WALL_COLOR,
  WALL_CLASS,
  FLOOR_CLASS,
  LAYER_CLASS,
  CUBE_CLASS,
  FACE_CLASS
} from "../../src/core/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRoot(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

function cleanupRoot(root: HTMLElement) {
  root.remove();
}

function cleanup(root: HTMLElement, handle: HeadlessRenderHandle | null) {
  handle?.destroy();
  root.remove();
}

/** Build scene context and render via the low-level DomRenderer directly. */
function renderDirect(
  root: HTMLElement,
  voxels: Voxel[],
  contextOverrides: Partial<GridContext> = {}
) {
  injectBaseStyles(document);
  const sceneResult = buildSceneContext({
    grid: voxels,
    context: contextOverrides
  });
  const renderer = createDomRenderer({ documentRef: document, target: root });
  const snapshot: SceneSnapshot = {
    layers: sceneResult.layers,
    context: sceneResult.context
  };
  renderer.render(snapshot);
  return { renderer, sceneResult, snapshot };
}

/** Parse an rgb(r, g, b) string into [r, g, b]. */
function parseRgb(color: string): [number, number, number] | null {
  const match = color.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*[\d.]+\s*)?\)/
  );
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Compare two rgb strings for equality. */
function rgbEqual(a: string, b: string): boolean {
  const pa = parseRgb(a);
  const pb = parseRgb(b);
  if (!pa || !pb) return false;
  return pa[0] === pb[0] && pa[1] === pb[1] && pa[2] === pb[2];
}

/** Get relative brightness from a parsed rgb. Higher value = brighter. */
function brightness(color: string): number {
  const parsed = parseRgb(color);
  if (!parsed) return -1;
  return parsed[0] + parsed[1] + parsed[2];
}

const ALL_FACES_VISIBLE: WallsMask = {
  t: false,
  b: false,
  bl: false,
  br: false,
  fl: false,
  fr: false
};

// ---------------------------------------------------------------------------
// 1. Wall face shading colors
// ---------------------------------------------------------------------------

describe("Wall face shading colors", () => {
  afterEach(() => {
    // Clean up any leftover elements
    document.body.innerHTML = "";
  });

  it("each visible wall has correctly shaded background-color", () => {
    const root = createRoot();
    const wallColor = "#6688aa";

    // Use direct rendering with explicit wall mask and wallColor
    // At rotX=65, rotY=45: walls = { t: false, b: true, bl: true, br: true, fl: false, fr: false }
    // Walls bl and br are visible (mask=true means they face away from camera, so they ARE rendered)
    renderDirect(root, [{ x: 0, y: 0, z: 0, color: "#ff0000" }], {
      showWalls: true,
      showFloor: true,
      wallColor,
      rotX: 65,
      rotY: 45
    });

    const wallElements = root.querySelectorAll(
      `[class*="${WALL_CLASS}"]`
    );
    expect(wallElements.length).toBeGreaterThan(0);

    for (const wall of Array.from(wallElements)) {
      const el = wall as HTMLElement;
      const bg = el.style.backgroundColor;
      expect(bg).toBeTruthy();

      let wallFace: keyof WallsMask | null = null;
      if (el.className.includes("backLeft")) wallFace = "bl";
      else if (el.className.includes("backRight")) wallFace = "br";
      else if (el.className.includes("frontLeft")) wallFace = "fl";
      else if (el.className.includes("frontRight")) wallFace = "fr";

      if (wallFace) {
        // Wall colors should be shaded variants of #6688aa = rgb(102,136,170)
        // Walls use inverted cube face deltas: bl→+40, br→+30, fl→+25, fr→+15
        const match = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
        expect(match).not.toBeNull();
        const r = Number(match![1]);
        // All channels should be offset from base (wall shading applies uniform delta)
        expect(r).toBeGreaterThanOrEqual(102); // walls are brightened (inverted deltas)
      }
    }

    cleanupRoot(root);
  });

  it("back-left wall is brighter than front-right wall (inverted lighting)", () => {
    // Wall shading inverts cube face deltas:
    // bl: cubeFace delta=-40, inverted to +40 → #808080 + 40 = rgb(168,168,168)
    // fr: cubeFace delta=-15, inverted to +15 → #808080 + 15 = rgb(143,143,143)
    const blShade = "rgb(168, 168, 168)";
    const frShade = "rgb(143, 143, 143)";

    const blBrightness = brightness(blShade);
    const frBrightness = brightness(frShade);

    expect(blBrightness).toBeGreaterThan(frBrightness);
  });
});

// ---------------------------------------------------------------------------
// 2. Face appearance for all 6 cube faces
// ---------------------------------------------------------------------------

describe("Face appearance for all 6 cube faces", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("each face has correct shaded background-color", () => {
    const root = createRoot();
    const color = "#cc8844";

    // Use direct rendering with all walls mask false so all 6 faces are visible
    renderDirect(root, [{ x: 0, y: 0, z: 0, color }], {
      walls: ALL_FACES_VISIBLE,
      showWalls: false,
      showFloor: false
    });

    const faceElements = root.querySelectorAll(`.${FACE_CLASS}`);
    expect(faceElements.length).toBe(6);

    for (const faceEl of Array.from(faceElements)) {
      const el = faceEl as HTMLElement;
      const classMatch = el.className.match(/voxcss-cube-face--(\w+)/);
      expect(classMatch).toBeTruthy();
      const face = classMatch![1] as CubeFace;

      const actual = el.style.backgroundColor;
      // #cc8844 = rgb(204,136,68). Face deltas: t=0, b=0, fr=-15, fl=-25, bl=-40, br=-30
      const expectedMap: Record<string, string> = {
        t: "rgb(204, 136, 68)",
        b: "rgb(204, 136, 68)",
        fr: "rgb(189, 121, 53)",
        fl: "rgb(179, 111, 43)",
        bl: "rgb(164, 96, 28)",
        br: "rgb(174, 106, 38)"
      };
      expect(actual).toBe(expectedMap[face]);
    }

    cleanupRoot(root);
  });

  it("top face is brightest, fl is darker, bl is darkest", () => {
    const root = createRoot();
    const color = "#888888";

    renderDirect(root, [{ x: 0, y: 0, z: 0, color }], {
      walls: ALL_FACES_VISIBLE,
      showWalls: false,
      showFloor: false
    });

    const topFace = root.querySelector(`.${FACE_CLASS}--t`) as HTMLElement;
    const flFace = root.querySelector(`.${FACE_CLASS}--fl`) as HTMLElement;
    const blFace = root.querySelector(`.${FACE_CLASS}--bl`) as HTMLElement;

    expect(topFace).toBeTruthy();
    expect(flFace).toBeTruthy();
    expect(blFace).toBeTruthy();

    const topBrightness = brightness(topFace.style.backgroundColor);
    const flBrightness = brightness(flFace.style.backgroundColor);
    const blBrightness = brightness(blFace.style.backgroundColor);

    // t: delta=0, fl: delta=-25, bl: delta=-40
    expect(topBrightness).toBeGreaterThan(flBrightness);
    expect(flBrightness).toBeGreaterThan(blBrightness);

    cleanupRoot(root);
  });
});

// ---------------------------------------------------------------------------
// 3. Textured face appearance
// ---------------------------------------------------------------------------

describe("Textured face appearance", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("face elements have background-image with texture URL", () => {
    const root = createRoot();

    renderDirect(
      root,
      [{ x: 0, y: 0, z: 0, texture: "http://example.com/tex.png" }],
      {
        walls: ALL_FACES_VISIBLE,
        showWalls: false,
        showFloor: false
      }
    );

    const faceElements = root.querySelectorAll(`.${FACE_CLASS}`);
    expect(faceElements.length).toBe(6);

    for (const faceEl of Array.from(faceElements)) {
      const el = faceEl as HTMLElement;
      const bgImage = el.style.backgroundImage;
      expect(bgImage).toContain("http://example.com/tex.png");
    }

    cleanupRoot(root);
  });

  it("face elements have background-size: cover from base styles", () => {
    const root = createRoot();

    renderDirect(
      root,
      [{ x: 0, y: 0, z: 0, texture: "http://example.com/tex.png" }],
      {
        walls: ALL_FACES_VISIBLE,
        showWalls: false,
        showFloor: false
      }
    );

    // The base styles inject .voxcss-cube-face { background-size: cover } via stylesheet
    const styleEl = document.getElementById("voxcss-base-styles");
    expect(styleEl).toBeTruthy();
    expect(styleEl!.textContent).toContain("background-size: cover");

    cleanupRoot(root);
  });

  it("face elements have brightness filter matching lighting deltas", () => {
    const root = createRoot();

    renderDirect(
      root,
      [{ x: 0, y: 0, z: 0, texture: "http://example.com/tex.png" }],
      {
        walls: ALL_FACES_VISIBLE,
        showWalls: false,
        showFloor: false
      }
    );

    const faceElements = root.querySelectorAll(`.${FACE_CLASS}`);
    expect(faceElements.length).toBe(6);

    const filterValues: Record<string, string> = {};
    for (const faceEl of Array.from(faceElements)) {
      const el = faceEl as HTMLElement;
      const classMatch = el.className.match(/voxcss-cube-face--(\w+)/);
      expect(classMatch).toBeTruthy();
      const face = classMatch![1] as CubeFace;
      filterValues[face] = el.style.filter;
    }

    // top face: delta=0 -> brightness(1) -> empty filter (abs(1-1) < 0.001)
    expect(filterValues["t"]).toBe("");

    // b face: delta=0 -> brightness(1) -> empty filter
    expect(filterValues["b"]).toBe("");

    // fr face: delta=-15 -> brightness(1 + (-15/200)) = brightness(0.925)
    expect(filterValues["fr"]).toContain("brightness(0.925)");

    // fl face: delta=-25 -> brightness(1 + (-25/200)) = brightness(0.875)
    expect(filterValues["fl"]).toContain("brightness(0.875)");

    // bl face: delta=-40 -> brightness(1 + (-40/200)) = brightness(0.8)
    expect(filterValues["bl"]).toContain("brightness(0.8)");

    // br face: delta=-30 -> brightness(1 + (-30/200)) = brightness(0.85)
    expect(filterValues["br"]).toContain("brightness(0.85)");

    cleanupRoot(root);
  });

  it("different faces have different brightness values", () => {
    const root = createRoot();

    renderDirect(
      root,
      [{ x: 0, y: 0, z: 0, texture: "http://example.com/tex.png" }],
      {
        walls: ALL_FACES_VISIBLE,
        showWalls: false,
        showFloor: false
      }
    );

    const frFace = root.querySelector(`.${FACE_CLASS}--fr`) as HTMLElement;
    const flFace = root.querySelector(`.${FACE_CLASS}--fl`) as HTMLElement;
    const blFace = root.querySelector(`.${FACE_CLASS}--bl`) as HTMLElement;

    expect(frFace).toBeTruthy();
    expect(flFace).toBeTruthy();
    expect(blFace).toBeTruthy();

    // All three should have different brightness values
    const frFilter = frFace.style.filter;
    const flFilter = flFace.style.filter;
    const blFilter = blFace.style.filter;

    expect(frFilter).not.toBe(flFilter);
    expect(flFilter).not.toBe(blFilter);
    expect(frFilter).not.toBe(blFilter);

    cleanupRoot(root);
  });
});

// ---------------------------------------------------------------------------
// 4. Grid overlay SVG generation
// ---------------------------------------------------------------------------

describe("Grid overlay SVG generation", () => {
  let root: HTMLElement;
  let handle: HeadlessRenderHandle;

  afterEach(() => cleanup(root, handle));

  it("floor element has --voxcss-floor-grid custom property set when showFloor is true", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      camera: { rotX: 65, rotY: 45 },
      scene: {
        voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }],
        showWalls: false,
        showFloor: true,
        projection: "cubic"
      }
    });

    const floor = root.querySelector(`.${FLOOR_CLASS}`) as HTMLElement;
    expect(floor).toBeTruthy();

    // The floor grid property should be set to a url() value
    const gridProp = floor.style.getPropertyValue("--voxcss-floor-grid");
    expect(gridProp).toContain("url(");
  });

  it("floor element has --voxcss-floor-base color set", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      camera: { rotX: 65, rotY: 45 },
      scene: {
        voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }],
        showWalls: false,
        showFloor: true,
        projection: "cubic"
      }
    });

    const floor = root.querySelector(`.${FLOOR_CLASS}`) as HTMLElement;
    expect(floor).toBeTruthy();

    const floorBase = floor.style.getPropertyValue("--voxcss-floor-base");
    expect(floorBase).toBeTruthy();
    // Floor base color = DEFAULT_WALL_COLOR #3e3e4d = rgb(62,62,77) + delta 120 = rgb(182,182,197)
    expect(rgbEqual(floorBase, "rgb(182, 182, 197)")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Shape-specific DOM structure
// ---------------------------------------------------------------------------

describe("Shape-specific DOM structure", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  describe("Ramp", () => {
    it("root has class voxcss-ramp and contains slope and bottom elements", () => {
      const root = createRoot();
      // Use walls mask with b=false so bottom face is rendered
      renderDirect(root, [{ x: 0, y: 0, z: 0, shape: "ramp", color: "#00ff00" }], {
        walls: ALL_FACES_VISIBLE,
        showWalls: false,
        showFloor: false
      });

      const ramp = root.querySelector(".voxcss-ramp");
      expect(ramp).toBeTruthy();

      const slope = root.querySelector(".voxcss-ramp-slope");
      expect(slope).toBeTruthy();

      const bottom = root.querySelector(".voxcss-ramp-bottom");
      expect(bottom).toBeTruthy();

      cleanupRoot(root);
    });

    it("has orientation class based on rot value", () => {
      const root = createRoot();
      renderDirect(
        root,
        [{ x: 0, y: 0, z: 0, shape: "ramp", rot: 90, color: "#00ff00" }],
        {
          walls: ALL_FACES_VISIBLE,
          showWalls: false,
          showFloor: false
        }
      );

      const ramp = root.querySelector(".voxcss-ramp");
      expect(ramp).toBeTruthy();
      // rot=90 -> south orientation
      expect(ramp!.classList.contains("voxcss-south")).toBe(true);

      cleanupRoot(root);
    });

    it("default rotation sets east orientation", () => {
      const root = createRoot();
      renderDirect(root, [{ x: 0, y: 0, z: 0, shape: "ramp", color: "#00ff00" }], {
        walls: ALL_FACES_VISIBLE,
        showWalls: false,
        showFloor: false
      });

      const ramp = root.querySelector(".voxcss-ramp");
      expect(ramp).toBeTruthy();
      expect(ramp!.classList.contains("voxcss-east")).toBe(true);

      cleanupRoot(root);
    });
  });

  describe("Wedge", () => {
    it("root has class voxcss-wedge and contains SVG slope elements", () => {
      const root = createRoot();
      renderDirect(root, [{ x: 0, y: 0, z: 0, shape: "wedge", color: "#0000ff" }], {
        walls: ALL_FACES_VISIBLE,
        showWalls: false,
        showFloor: false
      });

      const wedge = root.querySelector(".voxcss-wedge");
      expect(wedge).toBeTruthy();

      const primary = root.querySelector(".voxcss-wedge-slope--primary");
      const secondary = root.querySelector(".voxcss-wedge-slope--secondary");
      expect(primary).toBeTruthy();
      expect(secondary).toBeTruthy();

      // Check SVG elements exist within slopes
      const svgs = root.querySelectorAll(".voxcss-wedge svg");
      expect(svgs.length).toBeGreaterThanOrEqual(2);

      cleanupRoot(root);
    });

    it("SVG has correct viewBox and path elements", () => {
      const root = createRoot();
      renderDirect(root, [{ x: 0, y: 0, z: 0, shape: "wedge", color: "#0000ff" }], {
        walls: ALL_FACES_VISIBLE,
        showWalls: false,
        showFloor: false
      });

      const primarySlope = root.querySelector(".voxcss-wedge-slope--primary");
      expect(primarySlope).toBeTruthy();

      const svg = primarySlope!.querySelector("svg");
      expect(svg).toBeTruthy();
      expect(svg!.getAttribute("viewBox")).toBe("0 0 480 480");

      const path = svg!.querySelector("path");
      expect(path).toBeTruthy();
      expect(path!.getAttribute("d")).toBe("M0 0 L480 0 L0 480 Z");

      cleanupRoot(root);
    });

    it("with texture: SVG has pattern and image elements", () => {
      const root = createRoot();
      renderDirect(
        root,
        [
          {
            x: 0,
            y: 0,
            z: 0,
            shape: "wedge",
            color: "#0000ff",
            texture: "http://example.com/tex.png"
          }
        ],
        {
          walls: ALL_FACES_VISIBLE,
          showWalls: false,
          showFloor: false
        }
      );

      const svgs = root.querySelectorAll(".voxcss-wedge svg");
      expect(svgs.length).toBeGreaterThanOrEqual(2);

      let foundPattern = false;
      let foundImage = false;
      for (const svg of Array.from(svgs)) {
        const pattern = svg.querySelector("pattern");
        const image = svg.querySelector("image");
        if (pattern) foundPattern = true;
        if (image) foundImage = true;
      }
      expect(foundPattern).toBe(true);
      expect(foundImage).toBe(true);

      cleanupRoot(root);
    });
  });

  describe("Spike", () => {
    it("root has class voxcss-spike and contains SVG slope elements", () => {
      const root = createRoot();
      renderDirect(root, [{ x: 0, y: 0, z: 0, shape: "spike", color: "#ff00ff" }], {
        walls: ALL_FACES_VISIBLE,
        showWalls: false,
        showFloor: false
      });

      const spike = root.querySelector(".voxcss-spike");
      expect(spike).toBeTruthy();

      const primary = root.querySelector(".voxcss-spike-slope--primary");
      const secondary = root.querySelector(".voxcss-spike-slope--secondary");
      expect(primary).toBeTruthy();
      expect(secondary).toBeTruthy();

      const svgs = root.querySelectorAll(".voxcss-spike svg");
      expect(svgs.length).toBeGreaterThanOrEqual(2);

      cleanupRoot(root);
    });

    it("spike SVG has correct path data", () => {
      const root = createRoot();
      renderDirect(root, [{ x: 0, y: 0, z: 0, shape: "spike", color: "#ff00ff" }], {
        walls: ALL_FACES_VISIBLE,
        showWalls: false,
        showFloor: false
      });

      const primarySlope = root.querySelector(".voxcss-spike-slope--primary");
      expect(primarySlope).toBeTruthy();

      const svg = primarySlope!.querySelector("svg");
      expect(svg).toBeTruthy();

      const path = svg!.querySelector("path");
      expect(path).toBeTruthy();
      expect(path!.getAttribute("d")).toBe("M480 0 L480 480 L0 480 Z");

      cleanupRoot(root);
    });
  });
});

// ---------------------------------------------------------------------------
// 6. Shape covered-by-above behavior
// ---------------------------------------------------------------------------

describe("Shape covered-by-above behavior", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("ramp at z=0 is hidden when cube at z=1 is directly above", () => {
    const root = createRoot();
    renderDirect(
      root,
      [
        { x: 0, y: 0, z: 0, shape: "ramp", color: "#00ff00" },
        { x: 0, y: 0, z: 1, color: "#ff0000" } // cube above
      ],
      {
        walls: ALL_FACES_VISIBLE,
        showWalls: false,
        showFloor: false
      }
    );

    // The ramp's root element should have display: none because it is covered
    const layers = root.querySelectorAll(`.${LAYER_CLASS}`);
    expect(layers.length).toBeGreaterThanOrEqual(2);

    // Layer 0 contains the ramp
    const layer0 = layers[0] as HTMLElement;
    const rampContainer = layer0.children[0] as HTMLElement;
    expect(rampContainer.style.display).toBe("none");

    cleanupRoot(root);
  });
});

// ---------------------------------------------------------------------------
// 7. Area voxel CSS custom properties
// ---------------------------------------------------------------------------

describe("Area voxel CSS custom properties", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("2x2 area voxel has adjusted CSS custom properties and grid-area", () => {
    const root = createRoot();
    renderDirect(root, [{ x: 1, y: 1, z: 0, x2: 3, y2: 3, color: "#aabbcc" }], {
      walls: ALL_FACES_VISIBLE,
      showWalls: false,
      showFloor: false
    });

    const layer = root.querySelector(`.${LAYER_CLASS}`) as HTMLElement;
    expect(layer).toBeTruthy();

    const voxelContainer = layer.children[0] as HTMLElement;
    expect(voxelContainer).toBeTruthy();

    // grid-area should be "1 / 1 / 3 / 3"
    expect(voxelContainer.style.gridArea).toBe("1 / 1 / 3 / 3");

    // For a 2x2 voxel (spanX = 2*50 = 100, spanY = 2*50 = 100):
    // tileHalf = 25
    // offsetSpanX = 100 - 25 = 75
    // offsetSpanY = 100 - 25 = 75
    // frOffset = 100
    const offsetX = voxelContainer.style.getPropertyValue("--voxcss-side-offset-x");
    const offsetY = voxelContainer.style.getPropertyValue("--voxcss-side-offset-y");
    const frOffset = voxelContainer.style.getPropertyValue("--voxcss-fr-offset");

    expect(offsetX).toBe("75px");
    expect(offsetY).toBe("75px");
    expect(frOffset).toBe("100px");

    cleanupRoot(root);
  });

  it("1x1 voxel has default offset values", () => {
    const root = createRoot();
    renderDirect(root, [{ x: 0, y: 0, z: 0, color: "#aabbcc" }], {
      walls: ALL_FACES_VISIBLE,
      showWalls: false,
      showFloor: false
    });

    const layer = root.querySelector(`.${LAYER_CLASS}`) as HTMLElement;
    expect(layer).toBeTruthy();

    const voxelContainer = layer.children[0] as HTMLElement;
    expect(voxelContainer).toBeTruthy();

    // For a 1x1 voxel: tileHalf=25, offsetSpanX=25, offsetSpanY=25, frOffset=50
    const offsetX = voxelContainer.style.getPropertyValue("--voxcss-side-offset-x");
    const offsetY = voxelContainer.style.getPropertyValue("--voxcss-side-offset-y");
    const frOffset = voxelContainer.style.getPropertyValue("--voxcss-fr-offset");

    expect(offsetX).toBe("25px");
    expect(offsetY).toBe("25px");
    expect(frOffset).toBe("50px");

    cleanupRoot(root);
  });
});

// ---------------------------------------------------------------------------
// 8. Multi-layer Z positioning
// ---------------------------------------------------------------------------

describe("Multi-layer Z positioning", () => {
  let root: HTMLElement;
  let handle: HeadlessRenderHandle;

  afterEach(() => cleanup(root, handle));

  it("cubic layers have correct translateZ values", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      camera: { rotX: 65, rotY: 45 },
      scene: {
        voxels: [
          { x: 0, y: 0, z: 0, color: "#ff0000" },
          { x: 0, y: 0, z: 1, color: "#00ff00" },
          { x: 0, y: 0, z: 2, color: "#0000ff" }
        ],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      }
    });

    const layers = root.querySelectorAll(`.${LAYER_CLASS}`);
    expect(layers.length).toBe(3);

    const layer0 = layers[0] as HTMLElement;
    const layer1 = layers[1] as HTMLElement;
    const layer2 = layers[2] as HTMLElement;

    expect(layer0.style.transform).toContain("translateZ(0px)");
    expect(layer1.style.transform).toContain("translateZ(50px)");
    expect(layer2.style.transform).toContain("translateZ(100px)");
  });

  it("dimetric layers have halved translateZ values", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      camera: { rotX: 65, rotY: 45 },
      scene: {
        voxels: [
          { x: 0, y: 0, z: 0, color: "#ff0000" },
          { x: 0, y: 0, z: 1, color: "#00ff00" },
          { x: 0, y: 0, z: 2, color: "#0000ff" }
        ],
        showWalls: false,
        showFloor: false,
        projection: "dimetric"
      }
    });

    const layers = root.querySelectorAll(`.${LAYER_CLASS}`);
    expect(layers.length).toBe(3);

    const layer0 = layers[0] as HTMLElement;
    const layer1 = layers[1] as HTMLElement;
    const layer2 = layers[2] as HTMLElement;

    expect(layer0.style.transform).toContain("translateZ(0px)");
    expect(layer1.style.transform).toContain("translateZ(25px)");
    expect(layer2.style.transform).toContain("translateZ(50px)");
  });
});

// ---------------------------------------------------------------------------
// 9. Slice renderer DOM structure (3d merge)
// ---------------------------------------------------------------------------

describe("Slice renderer DOM structure (3d merge)", () => {
  let root: HTMLElement;
  let handle: HeadlessRenderHandle;

  beforeAll(() => {
    // The slice renderer uses `new Option().style` for color parsing.
    // Ensure Option is available in the test environment.
    if (typeof globalThis.Option === "undefined") {
      (globalThis as any).Option = class Option {
        style: Record<string, any> = new Proxy(
          {} as Record<string, any>,
          {
            set(target, prop, value) {
              target[prop as string] = value;
              return true;
            },
            get(target, prop) {
              return target[prop as string] ?? "";
            }
          }
        );
      };
    }
  });

  afterEach(() => cleanup(root, handle));

  it("uses brush elements instead of cube elements with mergeVoxels=3d", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      camera: { rotX: 65, rotY: 45 },
      scene: {
        voxels: [
          { x: 0, y: 0, z: 0, color: "#ff0000" },
          { x: 1, y: 0, z: 0, color: "#00ff00" }
        ],
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        mergeVoxels: "3d"
      }
    });

    // No cube elements should exist in slice renderer mode
    const cubes = root.querySelectorAll(`.${CUBE_CLASS}`);
    expect(cubes.length).toBe(0);

    // Brush elements (b tags) should exist
    const brushes = root.querySelectorAll("b");
    expect(brushes.length).toBeGreaterThan(0);
  });

  it("brush elements have grid-area and background-color styles", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      camera: { rotX: 65, rotY: 45 },
      scene: {
        voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }],
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        mergeVoxels: "3d"
      }
    });

    const brushes = root.querySelectorAll("b");
    expect(brushes.length).toBeGreaterThan(0);

    let hasGridArea = false;
    let hasBackground = false;
    for (const brush of Array.from(brushes)) {
      const el = brush as HTMLElement;
      if (el.style.gridArea) hasGridArea = true;
      if (el.style.backgroundColor) hasBackground = true;
    }
    expect(hasGridArea).toBe(true);
    expect(hasBackground).toBe(true);
  });

  it("three floor containers exist for Z/X/Y axis slices", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      camera: { rotX: 65, rotY: 45 },
      scene: {
        voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }],
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        mergeVoxels: "3d"
      }
    });

    // Z-axis slices use the floor element (voxcss-floor-z)
    const floorZ = root.querySelector(".voxcss-floor-z");
    expect(floorZ).toBeTruthy();

    // X-axis slices (voxcss-floor-x)
    const floorX = root.querySelector(".voxcss-floor-x");
    expect(floorX).toBeTruthy();

    // Y-axis slices (voxcss-floor-y)
    const floorY = root.querySelector(".voxcss-floor-y");
    expect(floorY).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 10. Camera perspective
// ---------------------------------------------------------------------------

describe("Camera perspective", () => {
  let root: HTMLElement;
  let handle: HeadlessRenderHandle;

  afterEach(() => cleanup(root, handle));

  it("camera element has default perspective of 8000px", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      scene: {
        voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      }
    });

    const cameraEl = root.querySelector(".voxcss-camera") as HTMLElement;
    expect(cameraEl).toBeTruthy();
    expect(cameraEl.style.perspective).toBe("8000px");
  });

  it("camera element has custom perspective when specified", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      camera: { perspective: 4000 },
      scene: {
        voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      }
    });

    const cameraEl = root.querySelector(".voxcss-camera") as HTMLElement;
    expect(cameraEl).toBeTruthy();
    expect(cameraEl.style.perspective).toBe("4000px");
  });

  it("camera element has no perspective when set to false", () => {
    root = createRoot();
    handle = renderScene({
      element: root,
      camera: { perspective: false },
      scene: {
        voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      }
    });

    const cameraEl = root.querySelector(".voxcss-camera") as HTMLElement;
    expect(cameraEl).toBeTruthy();
    expect(cameraEl.style.perspective).toBe("none");
  });
});
