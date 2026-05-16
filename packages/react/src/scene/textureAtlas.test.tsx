import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import {
  buildTextureEdgeRepairSets,
  computeTextureAtlasPlan,
  isSolidTrianglePlan,
  useTextureAtlas,
  type TextureAtlasPlan,
  type TextureAtlasResult,
} from "./textureAtlas";
import type { Polygon } from "@layoutit/polycss-core";

const TEXTURED_QUAD_60: Polygon = {
  vertices: [
    [0, 0, 0],
    [60, 0, 0],
    [60, 60, 0],
    [0, 60, 0],
  ],
  color: "#ffffff",
  texture: "https://example.com/crate.png",
};

function planFor(polygon: Polygon, index = 0): TextureAtlasPlan | null {
  return computeTextureAtlasPlan(polygon, index, {});
}

function Harness({
  plans,
  onResult,
}: {
  plans: Array<TextureAtlasPlan | null>;
  onResult: (result: TextureAtlasResult) => void;
}) {
  const atlas = useTextureAtlas(plans, "baked");
  onResult(atlas);
  return null;
}

function renderAtlas(plans: Array<TextureAtlasPlan | null>): TextureAtlasResult {
  let captured: TextureAtlasResult | null = null;
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(Harness, {
        plans,
        onResult: (r) => {
          captured = r;
        },
      }),
    ),
  );
  act(() => root.unmount());
  return captured!;
}

describe("computeTextureAtlasPlan", () => {
  it("returns a plan for a textured quad", () => {
    const plan = planFor(TEXTURED_QUAD_60);
    expect(plan).not.toBeNull();
    expect(plan!.texture).toBe("https://example.com/crate.png");
    expect(plan!.canvasW).toBeGreaterThan(0);
    expect(plan!.canvasH).toBeGreaterThan(0);
  });

  it("returns a plan for an untextured solid quad too", () => {
    const quad: Polygon = { ...TEXTURED_QUAD_60, texture: undefined };
    const plan = planFor(quad);
    expect(plan).not.toBeNull();
    expect(plan!.texture).toBeUndefined();
  });

  it("enables textured edge repair without changing geometry", () => {
    const normal = computeTextureAtlasPlan(TEXTURED_QUAD_60, 0, {});
    const repaired = computeTextureAtlasPlan(TEXTURED_QUAD_60, 0, {
      textureEdgeRepairEdges: new Set([1]),
    });

    expect(repaired).not.toBeNull();
    expect(normal).not.toBeNull();
    expect(repaired!.canvasW).toBe(normal!.canvasW);
    expect(repaired!.canvasH).toBe(normal!.canvasH);
    expect(repaired!.textureEdgeRepair).toBe(true);
  });

  it("keeps textured edge repair disabled when there are no shared texture edges", () => {
    const repaired = computeTextureAtlasPlan(TEXTURED_QUAD_60, 0, {});

    expect(repaired).not.toBeNull();
    expect(repaired!.textureEdgeRepair).toBe(false);
  });
});

describe("buildTextureEdgeRepairSets", () => {
  it("returns only shared edges between textured polygons", () => {
    const left: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
      texture: "https://example.com/a.png",
    };
    const right: Polygon = {
      vertices: [[1, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0]],
      texture: "https://example.com/b.png",
    };
    const isolated: Polygon = {
      vertices: [[3, 0, 0], [4, 0, 0], [4, 1, 0], [3, 1, 0]],
      texture: "https://example.com/c.png",
    };

    const repairEdges = buildTextureEdgeRepairSets([left, right, isolated]);

    expect(repairEdges[0]).toEqual(new Set([1]));
    expect(repairEdges[1]).toEqual(new Set([3]));
    expect(repairEdges[2]).toBeUndefined();
  });
});

describe("isSolidTrianglePlan", () => {
  it("true for an untextured 3-vertex polygon", () => {
    const tri: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      color: "#ff0000",
    };
    const plan = planFor(tri)!;
    expect(isSolidTrianglePlan(plan)).toBe(true);
  });

  it("false for a textured 3-vertex polygon", () => {
    const tri: Polygon = {
      vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      texture: "https://example.com/t.png",
    };
    const plan = planFor(tri)!;
    expect(isSolidTrianglePlan(plan)).toBe(false);
  });

  it("false for an untextured quad (4 vertices)", () => {
    const quad: Polygon = { ...TEXTURED_QUAD_60, texture: undefined };
    const plan = planFor(quad)!;
    expect(isSolidTrianglePlan(plan)).toBe(false);
  });
});

describe("useTextureAtlas", () => {
  function buildSixFaceCrateScene(): TextureAtlasPlan[] {
    const polys = Array.from({ length: 6 }, () => ({ ...TEXTURED_QUAD_60 }));
    return polys.map((p, i) => computeTextureAtlasPlan(p, i, {})!);
  }

  it("packs a multi-face textured scene into atlas pages", () => {
    const atlas = renderAtlas(buildSixFaceCrateScene());
    expect(atlas.pages.length).toBeGreaterThan(0);
    // One entry per input polygon (null when not atlas-eligible).
    expect(atlas.entries.length).toBe(6);
    // Textured polys must end up in the atlas — none should be null.
    expect(atlas.entries.every((e) => e !== null)).toBe(true);
  });

  it("returns an empty atlas for empty input", () => {
    const atlas = renderAtlas([]);
    expect(atlas.pages.length).toBe(0);
    expect(atlas.entries.length).toBe(0);
  });

  it("filters out null plan entries (degenerate polygons)", () => {
    const plans: Array<TextureAtlasPlan | null> = [...buildSixFaceCrateScene(), null];
    const atlas = renderAtlas(plans);
    // The trailing null produces a null entry, not a packed one.
    expect(atlas.entries.length).toBe(plans.length);
    expect(atlas.entries[atlas.entries.length - 1]).toBeNull();
  });
});
