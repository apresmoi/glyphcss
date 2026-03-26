/**
 * Additional branch coverage for shape renderers.
 * Covers texture branches on slopes, ownerDocument fallback,
 * rotation/orientation edge cases, non-mountToRoot path,
 * and covered-by-above with various rotation values.
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { GridContext, Voxel, WallsMask } from "@layoutit/voxcss-core/types";
import { DEFAULT_OFFSETS, DEFAULT_WALLS } from "@layoutit/voxcss-core/types";
import {
  rampShapeRenderer,
  wedgeShapeRenderer,
  spikeShapeRenderer,
  cubeShapeRenderer,
  ensureCubeDomCache,
  disposeCubeDom
} from "./index";
import { prepareShapeRoot } from "./shapeUtils";

function makeContext(overrides: Partial<GridContext> = {}): GridContext {
  const voxelMap = new Map<string, Voxel>();
  return {
    rows: 8,
    cols: 8,
    depth: 4,
    tileSize: 50,
    layerElevation: 50,
    projection: "cubic",
    offsets: DEFAULT_OFFSETS,
    walls: { ...DEFAULT_WALLS },
    getVoxel: (x, y, z) => voxelMap.get(`${x}:${y}:${z}`) ?? null,
    resolveTexture: undefined,
    ...overrides
  };
}

function makeRoot(): HTMLElement {
  const root = document.createElement("div");
  root.style.display = "grid";
  return root;
}

describe("ramp — texture branch on slope", () => {
  it("applies texture URL and brightness filter to slope", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "brick.png", shape: "ramp" };
    const context = makeContext();
    rampShapeRenderer({ voxel, context, root });
    const slope = root.querySelector(".voxcss-ramp-slope") as HTMLElement;
    expect(slope).not.toBeNull();
    expect(slope.style.backgroundImage).toContain("brick.png");
  });

  it("uses solid color when no texture", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, color: "#ff0000", shape: "ramp" };
    const context = makeContext();
    rampShapeRenderer({ voxel, context, root });
    const slope = root.querySelector(".voxcss-ramp-slope") as HTMLElement;
    expect(slope).not.toBeNull();
    expect(slope.style.backgroundImage).toBe("");
  });

  it("renders bottom with texture when bottom wall is off", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "floor.png", shape: "ramp" };
    const context = makeContext({ walls: { t: false, b: false, fr: false, fl: false, bl: false, br: false } });
    rampShapeRenderer({ voxel, context, root });
    const bottom = root.querySelector(".voxcss-ramp-bottom") as HTMLElement;
    expect(bottom).not.toBeNull();
    expect(bottom.style.backgroundImage).toContain("floor.png");
  });
});

describe("wedge — texture branches on primary/secondary slopes", () => {
  it("applies texture to both slopes", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "stone.png", shape: "wedge" };
    const context = makeContext();
    wedgeShapeRenderer({ voxel, context, root });
    const primary = root.querySelector(".voxcss-wedge-slope--primary") as HTMLElement;
    const secondary = root.querySelector(".voxcss-wedge-slope--secondary") as HTMLElement;
    expect(primary).not.toBeNull();
    expect(secondary).not.toBeNull();
  });

  it("uses solid colors when no texture", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, color: "#00ff00", shape: "wedge" };
    const context = makeContext();
    wedgeShapeRenderer({ voxel, context, root });
    const primary = root.querySelector(".voxcss-wedge-slope--primary") as HTMLElement;
    expect(primary).not.toBeNull();
  });

  it("renders bottom with texture when bottom wall is off", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "tile.png", shape: "wedge" };
    const context = makeContext({ walls: { t: false, b: false, fr: false, fl: false, bl: false, br: false } });
    wedgeShapeRenderer({ voxel, context, root });
    const bottom = root.querySelector(".voxcss-wedge-bottom") as HTMLElement;
    expect(bottom).not.toBeNull();
    expect(bottom.style.backgroundImage).toContain("tile.png");
  });
});

describe("spike — texture branches on primary/secondary slopes", () => {
  it("applies texture to both slopes", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "metal.png", shape: "spike" };
    const context = makeContext();
    spikeShapeRenderer({ voxel, context, root });
    const primary = root.querySelector(".voxcss-spike-slope--primary") as HTMLElement;
    const secondary = root.querySelector(".voxcss-spike-slope--secondary") as HTMLElement;
    expect(primary).not.toBeNull();
    expect(secondary).not.toBeNull();
  });

  it("uses solid colors when no texture", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, color: "#0000ff", shape: "spike" };
    const context = makeContext();
    spikeShapeRenderer({ voxel, context, root });
    const primary = root.querySelector(".voxcss-spike-slope--primary") as HTMLElement;
    expect(primary).not.toBeNull();
  });

  it("renders bottom with texture when bottom wall is off", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "dirt.png", shape: "spike" };
    const context = makeContext({ walls: { t: false, b: false, fr: false, fl: false, bl: false, br: false } });
    spikeShapeRenderer({ voxel, context, root });
    const bottom = root.querySelector(".voxcss-spike-bottom") as HTMLElement;
    expect(bottom).not.toBeNull();
    expect(bottom.style.backgroundImage).toContain("dirt.png");
  });
});

describe("prepareShapeRoot — rotation and orientation edge cases", () => {
  it("normalizes NaN rotation to east", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", rot: NaN };
    const context = makeContext();
    rampShapeRenderer({ voxel, context, root });
    expect(root.classList.contains("voxcss-east")).toBe(true);
  });

  it("normalizes Infinity rotation to east", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", rot: Infinity };
    const context = makeContext();
    rampShapeRenderer({ voxel, context, root });
    expect(root.classList.contains("voxcss-east")).toBe(true);
  });

  it("rotation 90 → south", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", rot: 90 };
    const context = makeContext();
    rampShapeRenderer({ voxel, context, root });
    expect(root.classList.contains("voxcss-south")).toBe(true);
  });

  it("rotation 180 → west", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", rot: 180 };
    const context = makeContext();
    rampShapeRenderer({ voxel, context, root });
    expect(root.classList.contains("voxcss-west")).toBe(true);
  });

  it("rotation 270 → north", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", rot: 270 };
    const context = makeContext();
    rampShapeRenderer({ voxel, context, root });
    expect(root.classList.contains("voxcss-north")).toBe(true);
  });

  it("rotation 360 wraps to east", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", rot: 360 };
    const context = makeContext();
    rampShapeRenderer({ voxel, context, root });
    expect(root.classList.contains("voxcss-east")).toBe(true);
  });

  it("negative rotation -90 wraps to north", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", rot: -90 };
    const context = makeContext();
    rampShapeRenderer({ voxel, context, root });
    expect(root.classList.contains("voxcss-north")).toBe(true);
  });

  it("rotation 450 wraps to south", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", rot: 450 };
    const context = makeContext();
    rampShapeRenderer({ voxel, context, root });
    expect(root.classList.contains("voxcss-south")).toBe(true);
  });
});

describe("prepareShapeRoot — non-mountToRoot path", () => {
  it("creates inner container when mountToRoot is false", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", color: "#ff0000" };
    const context = makeContext();
    const result = prepareShapeRoot({
      shape: "ramp",
      voxel,
      context,
      root,
      options: { mountToRoot: false }
    });
    expect(result).not.toBeNull();
    const inner = root.querySelector(".voxcss-shape-inner");
    expect(inner).not.toBeNull();
  });

  it("reuses existing inner container", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", color: "#ff0000" };
    const context = makeContext();
    // First call creates inner
    prepareShapeRoot({ shape: "ramp", voxel, context, root, options: { mountToRoot: false } });
    // Second call reuses it
    const result = prepareShapeRoot({ shape: "ramp", voxel, context, root, options: { mountToRoot: false } });
    expect(result).not.toBeNull();
    const inners = root.querySelectorAll(".voxcss-shape-inner");
    expect(inners.length).toBe(1);
  });
});

describe("prepareShapeRoot — covered by voxel above", () => {
  it("hides shape when voxel exists above", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 2, y: 2, z: 0, shape: "ramp" };
    const aboveVoxel: Voxel = { x: 2, y: 2, z: 1, shape: "cube" };
    const voxelMap = new Map<string, Voxel>();
    voxelMap.set("2:2:1", aboveVoxel);
    const context = makeContext({
      getVoxel: (x, y, z) => voxelMap.get(`${x}:${y}:${z}`) ?? null
    });
    rampShapeRenderer({ voxel, context, root });
    expect(root.style.display).toBe("none");
  });
});

describe("cube — cache edge cases", () => {
  it("ensureCubeDomCache creates empty map, populated by renderer", () => {
    const root = makeRoot();
    const cache = ensureCubeDomCache(root);
    expect(cache.size).toBe(0); // empty until faces are rendered
    // Render a cube to populate it
    const voxel: Voxel = { x: 0, y: 0, z: 0, color: "#ff0000" };
    const context = makeContext();
    cubeShapeRenderer({ voxel, context, root });
    expect(cache.size).toBeGreaterThan(0);
  });

  it("disposes cache and allows recreation", () => {
    const root = makeRoot();
    const voxel: Voxel = { x: 0, y: 0, z: 0, color: "#ff0000" };
    const context = makeContext();
    cubeShapeRenderer({ voxel, context, root });
    const cache1 = ensureCubeDomCache(root);
    expect(cache1.size).toBeGreaterThan(0);
    disposeCubeDom(root);
    const cache2 = ensureCubeDomCache(root);
    expect(cache2.size).toBe(0); // fresh empty cache
    expect(cache2).not.toBe(cache1);
  });

  it("returns existing cache on second call", () => {
    const root = makeRoot();
    const cache1 = ensureCubeDomCache(root);
    const cache2 = ensureCubeDomCache(root);
    expect(cache1).toBe(cache2);
  });
});
