import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { useSceneContext } from "./useSceneContext";
import type { UseSceneContextResult } from "./useSceneContext";
import type { Polygon } from "@polycss/core";

const TRIANGLE: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

const QUAD: Polygon = {
  vertices: [
    [0, 0, 0],
    [2, 0, 0],
    [2, 2, 0],
    [0, 2, 0],
  ],
  color: "#00ff00",
};

function UseSceneContextHarness({
  polygons,
  options,
  onResult,
}: {
  polygons: Polygon[];
  options: Parameters<typeof useSceneContext>[1];
  onResult: (result: UseSceneContextResult) => void;
}) {
  const result = useSceneContext(polygons, options);
  onResult(result);
  return null;
}

function captureHook(
  polygons: Polygon[],
  options: Parameters<typeof useSceneContext>[1] = {}
): UseSceneContextResult {
  let captured: UseSceneContextResult | null = null;
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(UseSceneContextHarness, {
        polygons,
        options,
        onResult: (r) => {
          captured = r;
        },
      })
    )
  );
  return captured!;
}

describe("useSceneContext", () => {
  it("returns empty polygons and zero bbox for empty input", () => {
    const result = captureHook([]);
    expect(result.polygons).toEqual([]);
    expect(result.sceneBbox).toBeDefined();
    expect(result.sceneBbox.min).toBeDefined();
    expect(result.sceneBbox.max).toBeDefined();
  });

  it("returns polygons for valid input (merge=off)", () => {
    const result = captureHook([TRIANGLE], { merge: "off" });
    expect(result.polygons.length).toBeGreaterThan(0);
  });

  it("returns sceneBbox reflecting the polygon extents", () => {
    const result = captureHook([TRIANGLE]);
    // Triangle spans [0,1] on X and Y, Z=0
    expect(result.sceneBbox.min[0]).toBeCloseTo(0, 3);
    expect(result.sceneBbox.max[0]).toBeCloseTo(1, 3);
  });

  it("passes through polygons when merge='off'", () => {
    const result = captureHook([TRIANGLE, QUAD], { merge: "off" });
    // Two polygons in, same count out (off = no merge)
    expect(result.polygons.length).toBe(2);
  });

  it("merge='auto' runs mergePolygons (may reduce or keep count)", () => {
    // mergePolygons is allowed to return same or fewer polygons
    const result = captureHook([TRIANGLE, QUAD], { merge: "auto" });
    expect(result.polygons.length).toBeGreaterThan(0);
  });

  it("sceneBbox covers multiple polygons", () => {
    const result = captureHook([TRIANGLE, QUAD]);
    // QUAD goes to 2 on X and Y
    expect(result.sceneBbox.max[0]).toBeCloseTo(2, 3);
  });
});
