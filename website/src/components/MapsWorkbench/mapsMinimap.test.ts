/**
 * The minimap's pure half: when it is on screen, what it mounts, and the
 * update rule that is the whole reason a second `createGlyphMap` is
 * affordable.
 *
 * Tested here rather than through the component for the reason every other
 * `/maps` rule is: `MapsWorkbench.tsx` cannot be mounted under this vitest
 * config, and happy-dom has no layout to give a second character grid.
 */
import { describe, expect, it } from "vitest";
import {
  GLYPH_MAP_OPENMAPTILES_LAYERS,
  GLYPH_MAP_WALK_FAR_M,
  GLYPH_MAP_WALK_FOV_DEG,
  glyphMapMercatorZooms,
  glyphMapTargetLOD,
  type GlyphMapVectorProvider,
} from "@glyphcss/maps";
import {
  MAP_MINIMAP_COLS,
  MAP_MINIMAP_MAX_MAIN_SPAN_DEG,
  MAP_MINIMAP_METRES_PER_CELL,
  MAP_MINIMAP_MOVE_M,
  MAP_MINIMAP_ROWS,
  MAP_MINIMAP_SPAN_DEG,
  MAP_MINIMAP_SPAN_M,
  MAP_MINIMAP_TURN_DEG,
  mapMinimapAppliedPose,
  mapMinimapConePath,
  mapMinimapConeWidthFraction,
  mapMinimapLabel,
  mapMinimapLayers,
  mapMinimapMetresApart,
  mapMinimapPoseStep,
  mapMinimapTurnApart,
  mapMinimapVisible,
  type MapMinimapPose,
} from "./mapsMinimap";

const METRES_PER_DEGREE = (Math.PI / 180) * 6_371_000;
const ZURICH: MapMinimapPose = { lon: 8.5417, lat: 47.3769, bearing: 0 };

/** `metres` due north of `from`, at the same heading. */
function north(from: MapMinimapPose, metres: number): MapMinimapPose {
  return { ...from, lat: from.lat + metres / METRES_PER_DEGREE };
}
/** `metres` due east of `from` — the leg that has to be scaled by `cos(lat)`, which at Zurich is a 32% error if it is not. */
function east(from: MapMinimapPose, metres: number): MapMinimapPose {
  return { ...from, lon: from.lon + metres / (METRES_PER_DEGREE * Math.cos(from.lat * (Math.PI / 180))) };
}
function turned(from: MapMinimapPose, deg: number): MapMinimapPose {
  return { ...from, bearing: from.bearing + deg };
}

describe("mapMinimapVisible — walking always, and never at globe scale", () => {
  it("is on while walking, whatever the view says", () => {
    // Walk mode pins `view.span` to the walker's own footprint, but the point
    // stands even if it did not: the mode with no orientation of its own is
    // the mode this was asked for.
    expect(mapMinimapVisible({ walking: true, span: 0.02 })).toBe(true);
    expect(mapMinimapVisible({ walking: true, span: 360 })).toBe(true);
  });

  it("is OFF on a globe-scale view, where the main map already IS the overview", () => {
    expect(mapMinimapVisible({ walking: false, span: 360 })).toBe(false);
    expect(mapMinimapVisible({ walking: false, span: 40 })).toBe(false);
    // The page's own walk-entry gate (0.05 deg, ~5.5 km) is still far too
    // wide: an inset 1.5 km across would be a crop of that frame.
    expect(mapMinimapVisible({ walking: false, span: 0.05 })).toBe(false);
  });

  it("comes on at street scale — the ceiling is half its own width, i.e. four times the area", () => {
    expect(MAP_MINIMAP_MAX_MAIN_SPAN_DEG).toBeCloseTo(MAP_MINIMAP_SPAN_DEG / 2, 12);
    expect(mapMinimapVisible({ walking: false, span: MAP_MINIMAP_MAX_MAIN_SPAN_DEG })).toBe(true);
    expect(mapMinimapVisible({ walking: false, span: MAP_MINIMAP_MAX_MAIN_SPAN_DEG * 1.001 })).toBe(false);
    expect(mapMinimapVisible({ walking: false, span: 0.001 })).toBe(true);
  });
});

describe("the span, and the tile level it lands on", () => {
  it("is 2.5x the walker's own horizon, so the cone is the middle of the inset and not the whole of it", () => {
    expect(MAP_MINIMAP_SPAN_M).toBeCloseTo(2.5 * GLYPH_MAP_WALK_FAR_M, 9);
    // Strictly wider than the disc the walker can see, which is the whole
    // reason it is worth drawing.
    expect(MAP_MINIMAP_SPAN_M).toBeGreaterThan(2 * GLYPH_MAP_WALK_FAR_M);
    expect(MAP_MINIMAP_SPAN_DEG * METRES_PER_DEGREE).toBeCloseTo(MAP_MINIMAP_SPAN_M, 6);
  });

  /**
   * The load-bearing one. `building` exists in OpenMapTiles from z13, and the
   * widget's LOD is a function of `span / cols` — so the inset's grid shape
   * and its span TOGETHER decide whether the buildings row draws anything at
   * all. Asserted against the real Mercator zoom ladder the OpenFreeMap
   * provider declares, not against a number copied out of a comment.
   */
  it("picks the shallowest tile level that carries a building — z13", () => {
    const provider = { zooms: glyphMapMercatorZooms(0, 14) } as Pick<GlyphMapVectorProvider, "zooms">;
    const degPerCell = MAP_MINIMAP_SPAN_DEG / MAP_MINIMAP_COLS;
    expect(glyphMapTargetLOD(provider, degPerCell)).toBe(13);
  });

  it("states its own cell size, which is what both update thresholds are quoted in", () => {
    expect(MAP_MINIMAP_METRES_PER_CELL).toBeCloseTo(MAP_MINIMAP_SPAN_M / MAP_MINIMAP_COLS, 9);
    expect(MAP_MINIMAP_ROWS).toBeLessThan(MAP_MINIMAP_COLS);
  });
});

describe("mapMinimapMetresApart / mapMinimapTurnApart", () => {
  it("measures ground distance, with longitude scaled by the latitude", () => {
    expect(mapMinimapMetresApart(ZURICH, north(ZURICH, 100))).toBeCloseTo(100, 3);
    expect(mapMinimapMetresApart(ZURICH, east(ZURICH, 100))).toBeCloseTo(100, 3);
    expect(mapMinimapMetresApart(ZURICH, ZURICH)).toBe(0);
  });

  it("treats a step across the antimeridian as a step, not as half a planet", () => {
    const west: MapMinimapPose = { lon: 179.9999, lat: 0, bearing: 0 };
    const east2: MapMinimapPose = { lon: -179.9999, lat: 0, bearing: 0 };
    expect(mapMinimapMetresApart(west, east2)).toBeLessThan(50);
  });

  it("measures the SHORT way round the compass", () => {
    expect(mapMinimapTurnApart(ZURICH, turned(ZURICH, 3))).toBeCloseTo(3, 9);
    expect(mapMinimapTurnApart({ ...ZURICH, bearing: 359 }, { ...ZURICH, bearing: 1 })).toBeCloseTo(2, 9);
    expect(mapMinimapTurnApart({ ...ZURICH, bearing: 1 }, { ...ZURICH, bearing: 359 })).toBeCloseTo(2, 9);
    expect(mapMinimapTurnApart({ ...ZURICH, bearing: 0 }, { ...ZURICH, bearing: 180 })).toBeCloseTo(180, 9);
  });
});

describe("mapMinimapPoseStep — the update rule", () => {
  it("owes nothing before the inset exists", () => {
    expect(mapMinimapPoseStep(null, north(ZURICH, 10_000))).toEqual({ move: false, turn: false });
  });

  it("SUPPRESSES a step smaller than half a cell — the whole point", () => {
    expect(MAP_MINIMAP_MOVE_M).toBeCloseTo(MAP_MINIMAP_METRES_PER_CELL / 2, 9);
    // A whole second of walking at the walk camera's 6 m/s is still under it.
    expect(mapMinimapPoseStep(ZURICH, north(ZURICH, 6))).toEqual({ move: false, turn: false });
    expect(mapMinimapPoseStep(ZURICH, north(ZURICH, MAP_MINIMAP_MOVE_M * 0.99))).toEqual({ move: false, turn: false });
    expect(mapMinimapPoseStep(ZURICH, east(ZURICH, MAP_MINIMAP_MOVE_M * 0.99))).toEqual({ move: false, turn: false });
  });

  it("re-centres once half a cell has actually been travelled", () => {
    expect(mapMinimapPoseStep(ZURICH, north(ZURICH, MAP_MINIMAP_MOVE_M * 1.01))).toEqual({ move: true, turn: false });
    expect(mapMinimapPoseStep(ZURICH, east(ZURICH, MAP_MINIMAP_MOVE_M * 1.01))).toEqual({ move: true, turn: false });
  });

  it("SUPPRESSES a turn under one cell at the inset's own edge", () => {
    // The threshold is `atan(cell / half-width)` rounded — a rotation smaller
    // than this cannot move any character.
    expect(MAP_MINIMAP_TURN_DEG).toBeLessThanOrEqual(
      Math.atan(MAP_MINIMAP_METRES_PER_CELL / (MAP_MINIMAP_SPAN_M / 2)) * (180 / Math.PI) + 0.15,
    );
    expect(mapMinimapPoseStep(ZURICH, turned(ZURICH, MAP_MINIMAP_TURN_DEG * 0.99))).toEqual({ move: false, turn: false });
  });

  it("re-orients once the heading has actually moved", () => {
    expect(mapMinimapPoseStep(ZURICH, turned(ZURICH, MAP_MINIMAP_TURN_DEG * 1.01))).toEqual({ move: false, turn: true });
    expect(mapMinimapPoseStep(ZURICH, turned(ZURICH, 90))).toEqual({ move: false, turn: true });
  });

  it("decides the two SEPARATELY, so walking a straight line owes ONE write and not two", () => {
    const straight = north(ZURICH, 100);
    expect(mapMinimapPoseStep(ZURICH, straight)).toEqual({ move: true, turn: false });
    const lookOnly = turned(ZURICH, 40);
    expect(mapMinimapPoseStep(ZURICH, lookOnly)).toEqual({ move: false, turn: true });
    expect(mapMinimapPoseStep(ZURICH, turned(north(ZURICH, 100), 40))).toEqual({ move: true, turn: true });
  });

  it("carries the UNWRITTEN half of the pose forward, so a suppressed axis cannot drift", () => {
    // Nine 5 m steps north are each suppressed; if the applied pose took the
    // rejected value anyway, the tenth would be suppressed too and the inset
    // would never move again.
    let applied: MapMinimapPose = ZURICH;
    let live: MapMinimapPose = ZURICH;
    let writes = 0;
    for (let i = 0; i < 20; i++) {
      live = north(live, 5);
      const step = mapMinimapPoseStep(applied, live);
      if (step.move || step.turn) writes += 1;
      applied = mapMinimapAppliedPose(applied, live, step);
    }
    // 100 m walked in 5 m steps against a 15.625 m threshold: the inset is
    // re-centred at 20, 40, 60, 80 and 100 m — five writes for twenty frames
    // — and ends up within one threshold of the truth rather than stuck at
    // the start, which is what the carried-forward pose buys.
    expect(writes).toBe(5);
    expect(mapMinimapMetresApart(applied, live)).toBeLessThan(MAP_MINIMAP_MOVE_M);
  });

  it("keeps the axis it did NOT write", () => {
    const next = turned(north(ZURICH, 100), 90);
    const applied = mapMinimapAppliedPose(ZURICH, next, { move: true, turn: false });
    expect(applied.bearing).toBe(ZURICH.bearing);
    expect(applied.lat).toBe(next.lat);
    const applied2 = mapMinimapAppliedPose(ZURICH, next, { move: false, turn: true });
    expect(applied2.bearing).toBe(next.bearing);
    expect(applied2.lat).toBe(ZURICH.lat);
  });
});

describe("mapMinimapLayers — a PLAN of three rows, off the page's own OSM table", () => {
  const source = { id: "test-source" } as unknown as GlyphMapVectorProvider;
  const layers = mapMinimapLayers(source);

  it("is a background plus water, buildings and roads — nothing else", () => {
    expect(layers.map((l) => l.id)).toEqual([
      "minimap-background", "minimap-water", "minimap-buildings", "minimap-roads",
    ]);
  });

  it("draws buildings as a FILL, never as an extrusion — this is a plan view", () => {
    const buildings = layers.find((l) => l.id === "minimap-buildings")!;
    expect(buildings.type).toBe("fill");
    // The page's own card mounts the same data as an extrusion; that is the
    // difference under test, so it has to be stated on both sides.
    expect(GLYPH_MAP_OPENMAPTILES_LAYERS.find((s) => s.id === "omt-buildings")!.type).toBe("fill-extrusion");
    expect(layers.some((l) => l.type === "fill-extrusion")).toBe(false);
  });

  it("takes every source layer, filter axis and colour from the OpenMapTiles table, so nothing can drift", () => {
    for (const [id, specId] of [["minimap-water", "omt-water"], ["minimap-buildings", "omt-buildings"], ["minimap-roads", "omt-roads"]] as const) {
      const spec = GLYPH_MAP_OPENMAPTILES_LAYERS.find((s) => s.id === specId)!;
      const layer = layers.find((l) => l.id === id) as { sourceLayer?: string; color?: string; filter?: unknown };
      expect(layer.sourceLayer).toBe(spec.sourceLayer);
      expect(layer.color).toBe(spec.color);
      expect(typeof layer.filter).toBe("function");
    }
  });

  it("mounts every row on the ONE source it was handed", () => {
    for (const layer of layers) {
      if (layer.type === "background") continue;
      expect((layer as { source: unknown }).source).toBe(source);
    }
  });
});

describe("the cone", () => {
  it("is the walker's own horizon as a fraction of the inset's width", () => {
    expect(mapMinimapConeWidthFraction()).toBeCloseTo((2 * GLYPH_MAP_WALK_FAR_M) / MAP_MINIMAP_SPAN_M, 12);
    // It has to FIT: a cone that reached the edge would be saying the inset
    // shows nothing the reader cannot already see.
    expect(mapMinimapConeWidthFraction()).toBeLessThan(1);
  });

  it("opens UPWARD at the walk camera's own field of view", () => {
    const d = mapMinimapConePath(GLYPH_MAP_WALK_FOV_DEG, 100);
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    // `M 0 0 L x1 y1 A r r 0 0 1 x2 y2 Z`
    const [ox, oy, x1, y1] = nums;
    expect([ox, oy]).toEqual([0, 0]);
    // Symmetric about the vertical, and above the apex (SVG y grows downward).
    const x2 = nums[nums.length - 2], y2 = nums[nums.length - 1];
    expect(x1).toBeCloseTo(-x2, 6);
    expect(y1).toBeCloseTo(y2, 6);
    expect(y1).toBeLessThan(0);
    expect(Math.hypot(x1, y1)).toBeCloseTo(100, 3);
    // The half-angle IS the walk camera's half-FOV.
    expect(Math.atan2(x2, -y2) * (180 / Math.PI)).toBeCloseTo(GLYPH_MAP_WALK_FOV_DEG / 2, 3);
  });

  it("stays a valid sector at a wide field of view", () => {
    expect(mapMinimapConePath(200, 100)).toMatch(/A 100 100 0 1 1/);
    expect(mapMinimapConePath(90, 100)).toMatch(/A 100 100 0 0 1/);
  });
});

describe("what it calls itself", () => {
  it("says what it is, how wide it is, and — while walking — what the wedge means", () => {
    expect(mapMinimapLabel(true)).toContain(`${Math.round(MAP_MINIMAP_SPAN_M)} m across`);
    expect(mapMinimapLabel(true)).toContain(`${Math.round(GLYPH_MAP_WALK_FAR_M)} m`);
    expect(mapMinimapLabel(false)).toContain(`${Math.round(MAP_MINIMAP_SPAN_M)} m across`);
    expect(mapMinimapLabel(false)).not.toMatch(/wedge/);
  });
});
