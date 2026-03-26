/**
 * Unit tests for voxcss shape renderers and shape utilities.
 *
 * Targets uncovered lines in:
 *   - cube.ts (lines 47-49, 60-61, 73)
 *   - shapeUtils.ts (lines 39, 55-63, 229-238)
 *   - spike.ts (lines 26-28)
 *   - wedge.ts (lines 26-28)
 *   - index.ts (re-exports)
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { GridContext, Voxel, WallsMask, CubeFace } from "@layoutit/voxcss-core/types";
import { DEFAULT_OFFSETS, DEFAULT_WALLS } from "@layoutit/voxcss-core/types";

// Import from index.ts to cover re-exports
import {
  cubeShapeRenderer,
  ensureCubeDomCache,
  disposeCubeDom,
  rampShapeRenderer,
  wedgeShapeRenderer,
  spikeShapeRenderer
} from "./index";

import {
  prepareShapeRoot,
  resolveSurfaceTexture,
  isBottomOccluded,
  shouldRenderBottom,
  createSvgSlopeElement,
  getSurfaceColor,
  applyTextureBrightness
} from "./shapeUtils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal GridContext for testing. */
function makeContext(overrides: Partial<GridContext> = {}): GridContext {
  const voxelMap = new Map<string, Voxel>();
  return {
    rows: 8,
    cols: 8,
    depth: 4,
    tileSize: 50,
    layerElevation: 50,
    projection: "cubic",
    walls: { ...DEFAULT_WALLS },
    offsets: { ...DEFAULT_OFFSETS },
    showWalls: false,
    showFloor: false,
    wallColor: "#3e3e4d",
    getVoxel: (x, y, z) => voxelMap.get(`${x}:${y}:${z}`) ?? null,
    ...overrides
  };
}

/** Create a GridContext that can be populated with voxels for neighbor lookups. */
function makeContextWithVoxels(
  voxels: Voxel[],
  overrides: Partial<GridContext> = {}
): GridContext {
  const voxelMap = new Map<string, Voxel>();
  for (const v of voxels) {
    const x2 = v.x2 ?? v.x + 1;
    const y2 = v.y2 ?? v.y + 1;
    for (let x = v.x; x < x2; x++) {
      for (let y = v.y; y < y2; y++) {
        voxelMap.set(`${x}:${y}:${v.z}`, v);
      }
    }
  }
  return {
    rows: 8,
    cols: 8,
    depth: 4,
    tileSize: 50,
    layerElevation: 50,
    projection: "cubic",
    walls: { ...DEFAULT_WALLS },
    offsets: { ...DEFAULT_OFFSETS },
    showWalls: false,
    showFloor: false,
    wallColor: "#3e3e4d",
    getVoxel: (x, y, z) => voxelMap.get(`${x}:${y}:${z}`) ?? null,
    ...overrides
  };
}

function makeRoot(): HTMLElement {
  return document.createElement("div");
}

// ---------------------------------------------------------------------------
// index.ts re-exports
// ---------------------------------------------------------------------------

describe("shapes/index.ts re-exports", () => {
  it("exports cubeShapeRenderer", () => {
    expect(typeof cubeShapeRenderer).toBe("function");
  });

  it("exports ensureCubeDomCache", () => {
    expect(typeof ensureCubeDomCache).toBe("function");
  });

  it("exports disposeCubeDom", () => {
    expect(typeof disposeCubeDom).toBe("function");
  });

  it("exports rampShapeRenderer", () => {
    expect(typeof rampShapeRenderer).toBe("function");
  });

  it("exports wedgeShapeRenderer", () => {
    expect(typeof wedgeShapeRenderer).toBe("function");
  });

  it("exports spikeShapeRenderer", () => {
    expect(typeof spikeShapeRenderer).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// cube.ts
// ---------------------------------------------------------------------------

describe("cubeShapeRenderer", () => {
  // Lines 47-49: When no faces are visible, root should be hidden and DOM disposed
  describe("when all faces are occluded", () => {
    it("hides the root and disposes cube DOM when no faces are visible", () => {
      const root = makeRoot();
      root.style.display = "";

      // A voxel completely surrounded by neighbors on all non-wall-hidden faces
      const centerVoxel: Voxel = { x: 2, y: 2, z: 1, color: "#ff0000" };

      // Build neighbors for all 6 directions
      const neighbors: Voxel[] = [
        { x: 2, y: 2, z: 2 }, // above (t)
        { x: 2, y: 2, z: 0 }, // below (b)
        { x: 2, y: 3, z: 1 }, // fr
        { x: 3, y: 2, z: 1 }, // fl
        { x: 2, y: 1, z: 1 }, // bl
        { x: 1, y: 2, z: 1 }  // br
      ];

      // All walls visible (none hidden) so we rely purely on neighbor occlusion
      const allWallsVisible: WallsMask = {
        t: false,
        b: false,
        bl: false,
        br: false,
        fl: false,
        fr: false
      };

      const context = makeContextWithVoxels(
        [centerVoxel, ...neighbors],
        { walls: allWallsVisible }
      );

      // First render some faces
      cubeShapeRenderer({ voxel: centerVoxel, context, root });

      expect(root.style.display).toBe("none");
    });
  });

  // Lines 60-61: When a previously-visible face becomes invisible,
  // the cached face element should be removed
  describe("face cache cleanup", () => {
    it("removes cached face elements that are no longer visible", () => {
      const root = makeRoot();
      const voxel: Voxel = { x: 2, y: 2, z: 0, color: "#00ff00" };

      // First render with top visible (default walls hide b, bl, br)
      const context1 = makeContext({
        walls: { t: false, b: true, bl: true, br: true, fl: false, fr: false }
      });

      cubeShapeRenderer({ voxel, context: context1, root });
      // Should have faces: t, fl, fr
      const initialFaceCount = root.querySelectorAll(".voxcss-cube-face").length;
      expect(initialFaceCount).toBeGreaterThan(0);

      // Now render with top hidden (walls.t = true) — this removes the "t" face
      const context2 = makeContext({
        walls: { t: true, b: true, bl: true, br: true, fl: false, fr: false }
      });

      cubeShapeRenderer({ voxel, context: context2, root });

      // The top face should have been removed from DOM
      const topFace = root.querySelector(".voxcss-cube-face--t");
      expect(topFace).toBeNull();

      // fl and fr should still be present
      expect(root.querySelector(".voxcss-cube-face--fl")).not.toBeNull();
      expect(root.querySelector(".voxcss-cube-face--fr")).not.toBeNull();
    });
  });

  // Line 73: Re-append face element whose parent changed
  describe("face re-attachment", () => {
    it("re-appends a cached face element that was detached from root", () => {
      const root = makeRoot();
      const voxel: Voxel = { x: 1, y: 1, z: 0, color: "#0000ff" };
      const context = makeContext({
        walls: { t: false, b: true, bl: true, br: true, fl: false, fr: false }
      });

      // Initial render creates faces
      cubeShapeRenderer({ voxel, context, root });

      const faces = ensureCubeDomCache(root);
      // Take a face element from the cache and move it to a different parent
      const topFace = faces.get("t" as CubeFace);
      expect(topFace).toBeTruthy();

      // Move the face element to another parent (simulates DOM manipulation)
      const otherParent = document.createElement("div");
      otherParent.appendChild(topFace!);
      expect(topFace!.parentElement).toBe(otherParent);

      // Re-render — should re-append the detached face to root
      cubeShapeRenderer({ voxel, context, root });

      expect(topFace!.parentElement).toBe(root);
    });
  });

  describe("area voxels", () => {
    it("computes correct offsets for area voxels (x2/y2 spans)", () => {
      const root = makeRoot();
      const voxel: Voxel = { x: 0, y: 0, z: 0, x2: 3, y2: 2, color: "#aabbcc" };
      const context = makeContext();

      cubeShapeRenderer({ voxel, context, root });

      // spanX = 3 * 50 = 150, spanY = 2 * 50 = 100
      // offsetSpanX = 150 - 25 = 125
      // offsetSpanY = 100 - 25 = 75
      expect(root.style.getPropertyValue("--voxcss-side-offset-x")).toBe("125px");
      expect(root.style.getPropertyValue("--voxcss-side-offset-y")).toBe("75px");
      expect(root.style.getPropertyValue("--voxcss-fr-offset")).toBe("100px");
    });
  });

  describe("precomputedFaces", () => {
    it("uses precomputedFaces when provided instead of computing visibility", () => {
      const root = makeRoot();
      const voxel: Voxel = { x: 1, y: 1, z: 0, color: "#ff0000" };
      const context = makeContext();

      // Pass only "t" as the visible face, regardless of context walls
      const precomputed: CubeFace[] = ["t"];
      cubeShapeRenderer({ voxel, context, root, precomputedFaces: precomputed });

      expect(root.querySelector(".voxcss-cube-face--t")).not.toBeNull();
      // Other faces that would normally be visible should NOT be present
      const allFaces = root.querySelectorAll(".voxcss-cube-face");
      expect(allFaces.length).toBe(1);
    });
  });
});

describe("ensureCubeDomCache / disposeCubeDom", () => {
  it("creates a new cache and clears innerHTML on first call", () => {
    const root = makeRoot();
    root.innerHTML = "<span>old</span>";
    const cache = ensureCubeDomCache(root);
    expect(cache).toBeInstanceOf(Map);
    expect(root.innerHTML).toBe("");
  });

  it("returns the same cache on subsequent calls", () => {
    const root = makeRoot();
    const cache1 = ensureCubeDomCache(root);
    const cache2 = ensureCubeDomCache(root);
    expect(cache1).toBe(cache2);
  });

  it("disposeCubeDom removes face elements and clears the cache", () => {
    const root = makeRoot();
    const cache = ensureCubeDomCache(root);
    const faceEl = document.createElement("div");
    root.appendChild(faceEl);
    cache.set("t" as CubeFace, faceEl);

    disposeCubeDom(root);

    expect(root.innerHTML).toBe("");
    // After dispose, ensureCubeDomCache should create a new cache
    const newCache = ensureCubeDomCache(root);
    expect(newCache).not.toBe(cache);
    expect(newCache.size).toBe(0);
  });

  it("disposeCubeDom is a no-op when no cache exists", () => {
    const root = makeRoot();
    root.innerHTML = "<span>keep</span>";
    // No cache set up for this root — should not throw
    disposeCubeDom(root);
    // innerHTML is unchanged because the early return fires before clearing
    expect(root.innerHTML).toBe("<span>keep</span>");
  });
});

// ---------------------------------------------------------------------------
// shapeUtils.ts
// ---------------------------------------------------------------------------

describe("resolveSurfaceTexture", () => {
  it("returns undefined for hash-starting texture keys", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "#ff0000" };
    const context = makeContext();
    expect(resolveSurfaceTexture(voxel, "primary", context)).toBeUndefined();
  });

  it("returns undefined when texture key is empty", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "" };
    const context = makeContext();
    expect(resolveSurfaceTexture(voxel, "primary", context)).toBeUndefined();
  });

  it("returns resolved texture from context.resolveTexture", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "grass" };
    const context = makeContext({
      resolveTexture: (name, face) => `resolved-${name}-${face}`
    });
    expect(resolveSurfaceTexture(voxel, "primary", context)).toBe("resolved-grass-primary");
  });

  it("returns the texture key as-is for URL-like values", () => {
    const context = makeContext();
    const urlPatterns = [
      "/textures/stone.png",
      "./stone.png",
      "../stone.png",
      "http://example.com/tex.png",
      "https://example.com/tex.png",
      "data:image/png;base64,abc",
      "texture.png"
    ];
    for (const url of urlPatterns) {
      const voxel: Voxel = { x: 0, y: 0, z: 0, texture: url };
      expect(resolveSurfaceTexture(voxel, "slope", context)).toBe(url);
    }
  });

  // Line 39: returns undefined when texture key is not a recognized URL pattern
  it("returns undefined for a bare texture key that is not URL-like", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "grass" };
    const context = makeContext(); // no resolveTexture
    expect(resolveSurfaceTexture(voxel, "primary", context)).toBeUndefined();
  });
});

describe("isBottomOccluded", () => {
  // Lines 55-63: check all cells below for occlusion
  it("returns false when z is 0 (no layer below)", () => {
    const voxel: Voxel = { x: 1, y: 1, z: 0 };
    const context = makeContext();
    expect(isBottomOccluded(voxel, context)).toBe(false);
  });

  it("returns true when all cells directly below are occupied", () => {
    const voxel: Voxel = { x: 1, y: 1, z: 1 };
    const below: Voxel = { x: 1, y: 1, z: 0 };
    const context = makeContextWithVoxels([voxel, below]);
    expect(isBottomOccluded(voxel, context)).toBe(true);
  });

  it("returns false when some cells below an area voxel are not occupied", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 1, x2: 2, y2: 2 };
    // Only fill one of the four cells below
    const below: Voxel = { x: 0, y: 0, z: 0 };
    const context = makeContextWithVoxels([voxel, below]);
    expect(isBottomOccluded(voxel, context)).toBe(false);
  });

  it("returns true when all cells below a 2x2 area voxel are occupied", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 1, x2: 2, y2: 2 };
    const belowVoxels: Voxel[] = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 1, y: 1, z: 0 }
    ];
    const context = makeContextWithVoxels([voxel, ...belowVoxels]);
    expect(isBottomOccluded(voxel, context)).toBe(true);
  });
});

describe("shouldRenderBottom", () => {
  it("returns false when walls.b is true (bottom face hidden by wall mask)", () => {
    const voxel: Voxel = { x: 1, y: 1, z: 1 };
    const context = makeContext({ walls: { ...DEFAULT_WALLS, b: true } });
    expect(shouldRenderBottom(voxel, context)).toBe(false);
  });

  it("returns true when bottom face is visible and not occluded", () => {
    const voxel: Voxel = { x: 1, y: 1, z: 1 };
    const context = makeContext({
      walls: { t: true, b: false, bl: false, br: false, fl: false, fr: false }
    });
    expect(shouldRenderBottom(voxel, context)).toBe(true);
  });

  it("returns false when bottom is visible but occluded", () => {
    const voxel: Voxel = { x: 1, y: 1, z: 1 };
    const below: Voxel = { x: 1, y: 1, z: 0 };
    const context = makeContextWithVoxels([voxel, below], {
      walls: { t: true, b: false, bl: false, br: false, fl: false, fr: false }
    });
    expect(shouldRenderBottom(voxel, context)).toBe(false);
  });
});

describe("prepareShapeRoot", () => {
  // Lines 229-238: the else branch when mountToRoot is false (default)
  describe("when mountToRoot is false (default)", () => {
    it("creates an inner container element", () => {
      const root = makeRoot();
      const voxel: Voxel = { x: 1, y: 1, z: 0, color: "#ff0000" };
      const context = makeContext();

      const result = prepareShapeRoot({
        shape: "ramp",
        voxel,
        context,
        root
      });

      expect(result).not.toBeNull();
      // The inner container should be the first child
      const inner = root.querySelector(".voxcss-shape-inner");
      expect(inner).not.toBeNull();
      expect(result!.container).toBe(inner);
    });

    it("reuses existing inner container on re-render", () => {
      const root = makeRoot();
      const voxel: Voxel = { x: 1, y: 1, z: 0, color: "#ff0000" };
      const context = makeContext();

      const result1 = prepareShapeRoot({
        shape: "ramp",
        voxel,
        context,
        root
      });

      // Add some content to inner
      result1!.container.innerHTML = "<span>old content</span>";

      const result2 = prepareShapeRoot({
        shape: "ramp",
        voxel,
        context,
        root
      });

      expect(result2).not.toBeNull();
      // Should reuse the same inner element
      const inners = root.querySelectorAll(".voxcss-shape-inner");
      expect(inners.length).toBe(1);
      // The inner's content should have been cleared
      expect(result2!.container.innerHTML).toBe("");
    });
  });

  describe("when mountToRoot is true", () => {
    it("uses root directly as the container and clears it", () => {
      const root = makeRoot();
      root.innerHTML = "<div>old</div>";
      const voxel: Voxel = { x: 1, y: 1, z: 0, color: "#00ff00" };
      const context = makeContext();

      const result = prepareShapeRoot({
        shape: "wedge",
        voxel,
        context,
        root,
        options: { mountToRoot: true }
      });

      expect(result).not.toBeNull();
      expect(result!.container).toBe(root);
      expect(root.innerHTML).toBe("");
    });

    it("removes existing inner container when mountToRoot is true", () => {
      const root = makeRoot();
      const voxel: Voxel = { x: 1, y: 1, z: 0, color: "#00ff00" };
      const context = makeContext();

      // First render without mountToRoot (creates .voxcss-shape-inner)
      prepareShapeRoot({ shape: "ramp", voxel, context, root });
      expect(root.querySelector(".voxcss-shape-inner")).not.toBeNull();

      // Now render with mountToRoot — should remove the inner
      const result = prepareShapeRoot({
        shape: "ramp",
        voxel,
        context,
        root,
        options: { mountToRoot: true }
      });

      expect(result).not.toBeNull();
      expect(root.querySelector(".voxcss-shape-inner")).toBeNull();
    });
  });

  describe("covered by voxel above", () => {
    it("returns null and hides root when covered by a voxel above", () => {
      const root = makeRoot();
      const voxel: Voxel = { x: 1, y: 1, z: 0, color: "#ff0000" };
      const above: Voxel = { x: 1, y: 1, z: 1 };
      const context = makeContextWithVoxels([voxel, above]);

      const result = prepareShapeRoot({
        shape: "ramp",
        voxel,
        context,
        root
      });

      expect(result).toBeNull();
      expect(root.style.display).toBe("none");
    });

    it("does not hide root when there is no voxel above", () => {
      const root = makeRoot();
      const voxel: Voxel = { x: 1, y: 1, z: 0, color: "#ff0000" };
      const context = makeContext();

      const result = prepareShapeRoot({
        shape: "spike",
        voxel,
        context,
        root
      });

      expect(result).not.toBeNull();
      expect(root.style.display).toBe("");
    });
  });

  describe("rotation / orientation", () => {
    it("applies east orientation for rotation 0", () => {
      const root = makeRoot();
      const voxel: Voxel = { x: 1, y: 1, z: 0, rot: 0 };
      const context = makeContext();

      prepareShapeRoot({ shape: "ramp", voxel, context, root });
      expect(root.classList.contains("voxcss-east")).toBe(true);
    });

    it("applies south orientation for rotation 90", () => {
      const root = makeRoot();
      const voxel: Voxel = { x: 1, y: 1, z: 0, rot: 90 };
      const context = makeContext();

      prepareShapeRoot({ shape: "ramp", voxel, context, root });
      expect(root.classList.contains("voxcss-south")).toBe(true);
    });

    it("applies west orientation for rotation 180", () => {
      const root = makeRoot();
      const voxel: Voxel = { x: 1, y: 1, z: 0, rot: 180 };
      const context = makeContext();

      prepareShapeRoot({ shape: "ramp", voxel, context, root });
      expect(root.classList.contains("voxcss-west")).toBe(true);
    });

    it("applies north orientation for rotation 270", () => {
      const root = makeRoot();
      const voxel: Voxel = { x: 1, y: 1, z: 0, rot: 270 };
      const context = makeContext();

      prepareShapeRoot({ shape: "ramp", voxel, context, root });
      expect(root.classList.contains("voxcss-north")).toBe(true);
    });

    it("snaps non-90 rotation to nearest 90 degrees", () => {
      const root = makeRoot();
      // Math.round(47/90) = 1 → 1*90 = 90 → south
      const voxel: Voxel = { x: 1, y: 1, z: 0, rot: 47 };
      const context = makeContext();

      prepareShapeRoot({ shape: "ramp", voxel, context, root });
      expect(root.classList.contains("voxcss-south")).toBe(true);
    });

    it("removes previous orientation class on re-render", () => {
      const root = makeRoot();
      const voxel1: Voxel = { x: 1, y: 1, z: 0, rot: 0 };
      const voxel2: Voxel = { x: 1, y: 1, z: 0, rot: 180 };
      const context = makeContext();

      prepareShapeRoot({ shape: "ramp", voxel: voxel1, context, root });
      expect(root.classList.contains("voxcss-east")).toBe(true);

      prepareShapeRoot({ shape: "ramp", voxel: voxel2, context, root });
      expect(root.classList.contains("voxcss-east")).toBe(false);
      expect(root.classList.contains("voxcss-west")).toBe(true);
    });

    it("defaults to east when rot is undefined", () => {
      const root = makeRoot();
      const voxel: Voxel = { x: 1, y: 1, z: 0 };
      const context = makeContext();

      prepareShapeRoot({ shape: "ramp", voxel, context, root });
      expect(root.classList.contains("voxcss-east")).toBe(true);
    });
  });

  describe("lighting", () => {
    it("returns computed lighting in the result", () => {
      const root = makeRoot();
      const voxel: Voxel = { x: 1, y: 1, z: 0, color: "#ff0000" };
      const context = makeContext();

      const result = prepareShapeRoot({
        shape: "ramp",
        voxel,
        context,
        root
      });

      expect(result).not.toBeNull();
      expect(result!.lighting).toBeInstanceOf(Array);
      expect(result!.baseColor).toBe("#ff0000");
    });
  });
});

describe("getSurfaceColor", () => {
  it("returns the lighting color for a matching surface id", () => {
    const prepared = {
      baseColor: "#cccccc",
      container: document.createElement("div"),
      lighting: [
        { id: "slope", angle: 0, level: 2, delta: 8, color: "rgb(212, 212, 212)" }
      ]
    };
    expect(getSurfaceColor(prepared, "slope")).toBe("rgb(212, 212, 212)");
  });

  it("returns baseColor when no matching surface id", () => {
    const prepared = {
      baseColor: "#cccccc",
      container: document.createElement("div"),
      lighting: []
    };
    expect(getSurfaceColor(prepared, "nonexistent")).toBe("#cccccc");
  });
});

describe("applyTextureBrightness", () => {
  it("sets filter brightness when delta is non-zero", () => {
    const el = document.createElement("div");
    applyTextureBrightness(el, -40);
    expect(el.style.filter).toContain("brightness(");
  });

  it("clears filter when brightness is approximately 1", () => {
    const el = document.createElement("div");
    el.style.filter = "brightness(0.5)";
    applyTextureBrightness(el, 0);
    expect(el.style.filter).toBe("");
  });
});

describe("createSvgSlopeElement", () => {
  it("creates an element with an SVG path and correct class", () => {
    const prepared = {
      baseColor: "#ff0000",
      container: document.createElement("div"),
      lighting: [{ id: "primary", angle: 0, level: 2, delta: 8, color: "rgb(255, 8, 8)" }]
    };

    const el = createSvgSlopeElement(document, prepared, {
      className: "voxcss-test-slope",
      surfaceId: "primary",
      path: "M0 0 L480 0 L0 480 Z"
    });

    expect(el.className).toBe("voxcss-test-slope");
    const svg = el.querySelector("svg");
    expect(svg).not.toBeNull();
    const pathEl = svg!.querySelector("path");
    expect(pathEl).not.toBeNull();
    expect(pathEl!.getAttribute("d")).toBe("M0 0 L480 0 L0 480 Z");
  });

  it("applies texture pattern when textureUrl is provided", () => {
    const prepared = {
      baseColor: "#00ff00",
      container: document.createElement("div"),
      lighting: [{ id: "primary", angle: 0, level: 2, delta: 8, color: "rgb(8, 255, 8)" }]
    };

    const el = createSvgSlopeElement(document, prepared, {
      className: "voxcss-test-slope",
      surfaceId: "primary",
      path: "M0 0 L480 0 L0 480 Z"
    }, { textureUrl: "https://example.com/tex.png", brightnessDelta: -20 });

    const svg = el.querySelector("svg");
    const defs = svg!.querySelector("defs");
    expect(defs).not.toBeNull();
    const pattern = defs!.querySelector("pattern");
    expect(pattern).not.toBeNull();
    const image = pattern!.querySelector("image");
    expect(image).not.toBeNull();
    expect(image!.getAttribute("href")).toBe("https://example.com/tex.png");

    const pathEl = svg!.querySelector("path");
    const fill = pathEl!.getAttribute("fill");
    expect(fill).toMatch(/^url\(#voxcss-slope-texture-\d+\)$/);
  });

  it("uses custom viewBox, width, and height when provided", () => {
    const prepared = {
      baseColor: "#0000ff",
      container: document.createElement("div"),
      lighting: []
    };

    const el = createSvgSlopeElement(document, prepared, {
      className: "test",
      surfaceId: "secondary",
      path: "M0 0 L100 100 Z",
      viewBox: "0 0 100 100",
      width: "100",
      height: "100"
    });

    const svg = el.querySelector("svg");
    expect(svg!.getAttribute("viewBox")).toBe("0 0 100 100");
    expect(svg!.getAttribute("width")).toBe("100");
    expect(svg!.getAttribute("height")).toBe("100");
  });
});

// ---------------------------------------------------------------------------
// wedge.ts
// ---------------------------------------------------------------------------

describe("wedgeShapeRenderer", () => {
  it("renders a wedge with slope surfaces", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 1, y: 1, z: 0, shape: "wedge", color: "#aabb00" };
    const context = makeContext({
      walls: { t: true, b: false, bl: false, br: false, fl: false, fr: false }
    });

    wedgeShapeRenderer({ voxel, context, root });

    expect(root.classList.contains("voxcss-wedge")).toBe(true);
    const slopes = root.querySelectorAll(".voxcss-wedge-slope");
    expect(slopes.length).toBe(2);
    // Bottom should be rendered (b: false, nothing below)
    const bottom = root.querySelector(".voxcss-wedge-bottom");
    expect(bottom).not.toBeNull();
  });

  // Lines 26-28: Bottom face with texture applied
  it("applies texture to the bottom face when voxel has a texture URL", () => {
    const root = makeRoot();
    const voxel: Voxel = {
      x: 1, y: 1, z: 0,
      shape: "wedge",
      color: "#aabb00",
      texture: "https://example.com/stone.png"
    };
    const context = makeContext({
      walls: { t: true, b: false, bl: false, br: false, fl: false, fr: false }
    });

    wedgeShapeRenderer({ voxel, context, root });

    const bottom = root.querySelector(".voxcss-wedge-bottom") as HTMLElement;
    expect(bottom).not.toBeNull();
    expect(bottom.style.backgroundImage).toContain("https://example.com/stone.png");
    expect(bottom.style.backgroundColor).toBe("");
  });

  it("returns early when covered by a voxel above", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 1, y: 1, z: 0, shape: "wedge" };
    const above: Voxel = { x: 1, y: 1, z: 1 };
    const context = makeContextWithVoxels([voxel, above]);

    wedgeShapeRenderer({ voxel, context, root });

    expect(root.style.display).toBe("none");
    expect(root.querySelector(".voxcss-wedge-slope")).toBeNull();
  });

  it("does not render bottom when walls.b is true", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 1, y: 1, z: 0, shape: "wedge" };
    const context = makeContext({
      walls: { ...DEFAULT_WALLS, b: true }
    });

    wedgeShapeRenderer({ voxel, context, root });

    expect(root.querySelector(".voxcss-wedge-bottom")).toBeNull();
  });

  it("applies texture to slope surfaces when voxel has texture", () => {
    const root = makeRoot();
    const voxel: Voxel = {
      x: 1, y: 1, z: 0,
      shape: "wedge",
      color: "#ff0000",
      texture: "https://example.com/tex.png"
    };
    const context = makeContext({
      walls: { ...DEFAULT_WALLS, b: true }
    });

    wedgeShapeRenderer({ voxel, context, root });

    const slopes = root.querySelectorAll(".voxcss-wedge-slope");
    expect(slopes.length).toBe(2);
    // Each slope should have an SVG with a texture pattern
    for (const slope of slopes) {
      const svg = slope.querySelector("svg");
      expect(svg).not.toBeNull();
      const defs = svg!.querySelector("defs");
      expect(defs).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// spike.ts
// ---------------------------------------------------------------------------

describe("spikeShapeRenderer", () => {
  it("renders a spike with slope surfaces", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 1, y: 1, z: 0, shape: "spike", color: "#00aaff" };
    const context = makeContext({
      walls: { t: true, b: false, bl: false, br: false, fl: false, fr: false }
    });

    spikeShapeRenderer({ voxel, context, root });

    expect(root.classList.contains("voxcss-spike")).toBe(true);
    const slopes = root.querySelectorAll(".voxcss-spike-slope");
    expect(slopes.length).toBe(2);
    const bottom = root.querySelector(".voxcss-spike-bottom");
    expect(bottom).not.toBeNull();
  });

  // Lines 26-28: Bottom face with texture applied
  it("applies texture to the bottom face when voxel has a texture URL", () => {
    const root = makeRoot();
    const voxel: Voxel = {
      x: 1, y: 1, z: 0,
      shape: "spike",
      color: "#00aaff",
      texture: "https://example.com/lava.png"
    };
    const context = makeContext({
      walls: { t: true, b: false, bl: false, br: false, fl: false, fr: false }
    });

    spikeShapeRenderer({ voxel, context, root });

    const bottom = root.querySelector(".voxcss-spike-bottom") as HTMLElement;
    expect(bottom).not.toBeNull();
    expect(bottom.style.backgroundImage).toContain("https://example.com/lava.png");
    expect(bottom.style.backgroundColor).toBe("");
  });

  it("returns early when covered by a voxel above", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 1, y: 1, z: 0, shape: "spike" };
    const above: Voxel = { x: 1, y: 1, z: 1 };
    const context = makeContextWithVoxels([voxel, above]);

    spikeShapeRenderer({ voxel, context, root });

    expect(root.style.display).toBe("none");
    expect(root.querySelector(".voxcss-spike-slope")).toBeNull();
  });

  it("does not render bottom when walls.b is true", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 1, y: 1, z: 0, shape: "spike" };
    const context = makeContext({
      walls: { ...DEFAULT_WALLS, b: true }
    });

    spikeShapeRenderer({ voxel, context, root });

    expect(root.querySelector(".voxcss-spike-bottom")).toBeNull();
  });

  it("applies texture to slope surfaces when voxel has texture", () => {
    const root = makeRoot();
    const voxel: Voxel = {
      x: 1, y: 1, z: 0,
      shape: "spike",
      color: "#ff0000",
      texture: "https://example.com/tex.png"
    };
    const context = makeContext({
      walls: { ...DEFAULT_WALLS, b: true }
    });

    spikeShapeRenderer({ voxel, context, root });

    const slopes = root.querySelectorAll(".voxcss-spike-slope");
    expect(slopes.length).toBe(2);
    for (const slope of slopes) {
      const svg = slope.querySelector("svg");
      expect(svg).not.toBeNull();
      const defs = svg!.querySelector("defs");
      expect(defs).not.toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// ramp.ts (bonus coverage, exercising via shapes/index re-export)
// ---------------------------------------------------------------------------

describe("rampShapeRenderer", () => {
  it("renders a ramp with slope surface", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 1, y: 1, z: 0, shape: "ramp", color: "#ff8800" };
    const context = makeContext({
      walls: { t: true, b: false, bl: false, br: false, fl: false, fr: false }
    });

    rampShapeRenderer({ voxel, context, root });

    expect(root.classList.contains("voxcss-ramp")).toBe(true);
    const slope = root.querySelector(".voxcss-ramp-slope");
    expect(slope).not.toBeNull();
    const bottom = root.querySelector(".voxcss-ramp-bottom");
    expect(bottom).not.toBeNull();
  });

  it("applies texture to slope and bottom when voxel has texture", () => {
    const root = makeRoot();
    const voxel: Voxel = {
      x: 1, y: 1, z: 0,
      shape: "ramp",
      color: "#ff8800",
      texture: "https://example.com/wood.png"
    };
    const context = makeContext({
      walls: { t: true, b: false, bl: false, br: false, fl: false, fr: false }
    });

    rampShapeRenderer({ voxel, context, root });

    const slope = root.querySelector(".voxcss-ramp-slope") as HTMLElement;
    expect(slope).not.toBeNull();
    expect(slope.style.backgroundImage).toContain("https://example.com/wood.png");

    const bottom = root.querySelector(".voxcss-ramp-bottom") as HTMLElement;
    expect(bottom).not.toBeNull();
    expect(bottom.style.backgroundImage).toContain("https://example.com/wood.png");
  });
});
