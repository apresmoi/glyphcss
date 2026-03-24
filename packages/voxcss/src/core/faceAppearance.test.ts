import { describe, it, expect, vi } from "vitest";
import {
  computeCubeFaceAppearance,
  applyCubeFaceAppearance,
  getCubeFaceAppearanceSignature,
} from "./faceAppearance";
import { buildSceneContext } from "./context";
import type { GridContext, Voxel, WallsMask } from "./types";

function makeContext(
  voxels: Voxel[],
  overrides?: Partial<GridContext>
): GridContext {
  const result = buildSceneContext({
    grid: voxels,
    context: {
      walls: { t: false, b: false, bl: false, br: false, fl: false, fr: false },
      ...overrides,
    },
  });
  return { ...result.context, ...overrides };
}

describe("computeCubeFaceAppearance", () => {
  it("returns shaded background color for voxel without texture", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, color: "#cccccc" };
    const context = makeContext([voxel]);
    const appearance = computeCubeFaceAppearance(voxel, "t", context);
    // Top face delta = 0, so color should remain #cccccc -> rgb(204, 204, 204)
    expect(appearance.backgroundColor).toBe("rgb(204, 204, 204)");
    expect(appearance.backgroundImage).toBe("");
    expect(appearance.filter).toBe("");
  });

  it("applies face-specific shading for side faces", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, color: "#cccccc" };
    const context = makeContext([voxel]);

    const fr = computeCubeFaceAppearance(voxel, "fr", context);
    const fl = computeCubeFaceAppearance(voxel, "fl", context);
    const bl = computeCubeFaceAppearance(voxel, "bl", context);

    // fr is darker by 15, fl by 25, bl by 40
    expect(fr.backgroundColor).not.toBe(fl.backgroundColor);
    expect(fl.backgroundColor).not.toBe(bl.backgroundColor);
  });

  it("uses default color #cccccc when voxel has no color", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0 };
    const context = makeContext([voxel]);
    const appearance = computeCubeFaceAppearance(voxel, "t", context);
    expect(appearance.backgroundColor).toBe("rgb(204, 204, 204)");
  });

  it("sets backgroundImage for voxel with URL texture", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "https://example.com/tex.png" };
    const context = makeContext([voxel]);
    const appearance = computeCubeFaceAppearance(voxel, "t", context);
    expect(appearance.backgroundImage).toBe("url(https://example.com/tex.png)");
    // With texture, backgroundColor should be empty
    expect(appearance.backgroundColor).toBe("");
  });

  it("sets backgroundImage for voxel with relative path texture", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "./textures/wood.png" };
    const context = makeContext([voxel]);
    const appearance = computeCubeFaceAppearance(voxel, "t", context);
    expect(appearance.backgroundImage).toBe("url(./textures/wood.png)");
  });

  it("sets brightness filter for textured side faces", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "tex.png" };
    const context = makeContext([voxel]);
    const fr = computeCubeFaceAppearance(voxel, "fr", context);
    // fr has delta=-15, brightness = max(0, 1 + (-15/200)) = 0.925
    expect(fr.filter).toContain("brightness(");
  });

  it("does not set filter for textured top face (delta=0)", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "tex.png" };
    const context = makeContext([voxel]);
    const top = computeCubeFaceAppearance(voxel, "t", context);
    // delta=0 means brightness=1.0, so filter should be empty
    expect(top.filter).toBe("");
  });

  it("ignores texture starting with #", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "#notaurl", color: "#ff0000" };
    const context = makeContext([voxel]);
    const appearance = computeCubeFaceAppearance(voxel, "t", context);
    expect(appearance.backgroundImage).toBe("");
    expect(appearance.backgroundColor).not.toBe("");
  });

  it("uses resolveTexture callback when provided", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "myTexture" };
    const resolveTexture = vi.fn().mockReturnValue("https://cdn.example.com/resolved.png");
    const context = makeContext([voxel], { resolveTexture });
    const appearance = computeCubeFaceAppearance(voxel, "t", context);
    expect(resolveTexture).toHaveBeenCalledWith("myTexture", "t");
    expect(appearance.backgroundImage).toBe("url(https://cdn.example.com/resolved.png)");
  });

  it("uses custom lighting callback to override backgroundColor", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, color: "#ff0000" };
    const lighting = vi.fn().mockReturnValue({ backgroundColor: "blue" });
    const context = makeContext([voxel], { lighting });
    const appearance = computeCubeFaceAppearance(voxel, "t", context);
    expect(lighting).toHaveBeenCalledWith(voxel, "t");
    expect(appearance.backgroundColor).toBe("blue");
  });

  it("uses custom lighting callback to override filter", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "tex.png" };
    const lighting = vi.fn().mockReturnValue({ filter: "contrast(1.5)" });
    const context = makeContext([voxel], { lighting });
    const appearance = computeCubeFaceAppearance(voxel, "fr", context);
    expect(appearance.filter).toBe("contrast(1.5)");
  });

  it("uses custom lighting callback to override backgroundImage", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0 };
    const lighting = vi.fn().mockReturnValue({ backgroundImage: "url(custom.png)" });
    const context = makeContext([voxel], { lighting });
    const appearance = computeCubeFaceAppearance(voxel, "t", context);
    expect(appearance.backgroundImage).toBe("url(custom.png)");
  });
});

describe("applyCubeFaceAppearance", () => {
  it("sets style properties on the element", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, color: "#ff0000" };
    const context = makeContext([voxel]);
    const el = document.createElement("div");
    applyCubeFaceAppearance(el, "t", voxel, context);
    expect(el.style.backgroundColor).not.toBe("");
    expect(el.style.backgroundImage).toBeDefined();
    expect(el.style.filter).toBeDefined();
  });

  it("sets backgroundImage for textured voxels", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "tex.png" };
    const context = makeContext([voxel]);
    const el = document.createElement("div");
    applyCubeFaceAppearance(el, "t", voxel, context);
    expect(el.style.backgroundImage).toContain("tex.png");
  });

  it("sets filter for textured side faces", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, texture: "tex.png" };
    const context = makeContext([voxel]);
    const el = document.createElement("div");
    applyCubeFaceAppearance(el, "fl", voxel, context);
    expect(el.style.filter).toContain("brightness(");
  });
});

describe("getCubeFaceAppearanceSignature", () => {
  it("returns a JSON string", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, color: "#ff0000" };
    const context = makeContext([voxel]);
    const sig = getCubeFaceAppearanceSignature(voxel, "t", context);
    expect(() => JSON.parse(sig)).not.toThrow();
  });

  it("same voxel and face produce same signature", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, color: "#ff0000" };
    const context = makeContext([voxel]);
    const sig1 = getCubeFaceAppearanceSignature(voxel, "t", context);
    const sig2 = getCubeFaceAppearanceSignature(voxel, "t", context);
    expect(sig1).toBe(sig2);
  });

  it("different faces produce different signatures for non-top faces", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, color: "#cccccc" };
    const context = makeContext([voxel]);
    const sigT = getCubeFaceAppearanceSignature(voxel, "t", context);
    const sigFr = getCubeFaceAppearanceSignature(voxel, "fr", context);
    expect(sigT).not.toBe(sigFr);
  });
});
