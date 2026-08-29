/**
 * Cross-layer occlusion PRIORITY (`computeOcclusionIds` group
 * `occlusionPriority`) and the FOREIGN-occluder blanking contract
 * (`OcclusionMap.foreignOnly` + `GLYPH_FOREIGN_OCCLUDER_ID`).
 *
 * Priority is a foreground/background layer privilege over depth: a
 * higher-priority group claims id-map cells over any lower-priority group
 * regardless of depth; depth only breaks ties within a class. The foreign id
 * is what a scene stamps into its shared id-map for cells covered by ANOTHER
 * scene's opaque output (`setForeignOcclusion`): every local layer blanks
 * under it, while a `foreignOnly` consumer (a `transparent` detail layer)
 * blanks ONLY under it.
 */
import { describe, expect, it } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import { buildRasterizeContext, type OcclusionMap } from "../api/rasterizeContext";
import { computeOcclusionIds, rasterizeToCells, GLYPH_FOREIGN_OCCLUDER_ID } from "./rasterize";

const COLS = 32;
const ROWS = 24;

function quad(z: number, x0 = -1, x1 = 1): Polygon {
  return {
    vertices: [[x0, -1, z], [x0, 1, z], [x1, 1, z], [x1, -1, z]],
    color: "#ffffff",
  };
}

const camera = () => createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 160 });

function centerIdx(): number {
  return (ROWS >> 1) * COLS + (COLS >> 1);
}

describe("computeOcclusionIds occlusionPriority", () => {
  it("without priorities the nearer group wins (baseline depth behaviour)", () => {
    const ids = computeOcclusionIds(
      [
        { polygons: [quad(0)], id: 0 },
        { polygons: [quad(1)], id: 7 }, // larger z = nearer
      ],
      camera(), COLS, ROWS, 2,
    );
    expect(ids[centerIdx()]).toBe(7);
  });

  it("a higher-priority group claims cells over a NEARER lower-priority group", () => {
    const ids = computeOcclusionIds(
      [
        { polygons: [quad(1)], id: 0 },                          // near "wall"
        { polygons: [quad(0)], id: 7, occlusionPriority: 1 },    // far foreground layer
      ],
      camera(), COLS, ROWS, 2,
    );
    expect(ids[centerIdx()]).toBe(7);
  });

  it("depth still decides WITHIN a priority class, and uncontested cells keep their owner", () => {
    const ids = computeOcclusionIds(
      [
        // Two priority-1 groups: nearer one wins the overlap.
        { polygons: [quad(0)], id: 5, occlusionPriority: 1 },
        { polygons: [quad(1)], id: 7, occlusionPriority: 1 },
        // A low-priority group off to the side keeps its own cells.
        { polygons: [quad(2, 1.2, 1.8)], id: 9 },
      ],
      camera(), COLS, ROWS, 2,
    );
    expect(ids[centerIdx()]).toBe(7);
    // The side quad (world[0] 1.2..1.8 → rows below the overlap) is uncontested.
    const owners = new Set(Array.from(ids));
    expect(owners.has(9)).toBe(true);
  });

  // The priority buffer zero-initializes, so an unclaimed cell reads class 0.
  // Without the empty-cell clause in `fillDepthTri` a NEGATIVE class loses to
  // a competitor that isn't there and claims literally nothing.
  it("a NEGATIVE-priority group claims uncontested cells", () => {
    const ids = computeOcclusionIds(
      [{ polygons: [quad(0)], id: 7, occlusionPriority: -1 }],
      camera(), COLS, ROWS, 2,
    );
    expect(ids[centerIdx()]).toBe(7);
  });

  it("two NEGATIVE-priority groups still depth-resolve against each other", () => {
    const near = computeOcclusionIds(
      [
        { polygons: [quad(0)], id: 5, occlusionPriority: -1 },
        { polygons: [quad(1)], id: 7, occlusionPriority: -1 }, // larger z = nearer
      ],
      camera(), COLS, ROWS, 2,
    );
    expect(near[centerIdx()]).toBe(7);
    // Order-independent: the nearer group wins whichever rasterizes first.
    const reversed = computeOcclusionIds(
      [
        { polygons: [quad(1)], id: 7, occlusionPriority: -1 },
        { polygons: [quad(0)], id: 5, occlusionPriority: -1 },
      ],
      camera(), COLS, ROWS, 2,
    );
    expect(reversed[centerIdx()]).toBe(7);
  });

  it("a default-priority group still beats a NEGATIVE one regardless of depth or order", () => {
    // The negative group is NEARER; class must still decide.
    const first = computeOcclusionIds(
      [
        { polygons: [quad(1)], id: 5, occlusionPriority: -1 },
        { polygons: [quad(0)], id: 7 },
      ],
      camera(), COLS, ROWS, 2,
    );
    expect(first[centerIdx()]).toBe(7);
    const second = computeOcclusionIds(
      [
        { polygons: [quad(0)], id: 7 },
        { polygons: [quad(1)], id: 5, occlusionPriority: -1 },
      ],
      camera(), COLS, ROWS, 2,
    );
    expect(second[centerIdx()]).toBe(7);
  });

  it("all-zero priorities stay byte-identical to omitting the field", () => {
    const groups = () => [
      { polygons: [quad(0)], id: 0 },
      { polygons: [quad(1, -0.5, 0.5)], id: 7 },
    ];
    const omitted = computeOcclusionIds(groups(), camera(), COLS, ROWS, 2);
    const explicitZero = computeOcclusionIds(
      groups().map((g) => ({ ...g, occlusionPriority: 0 })),
      camera(), COLS, ROWS, 2,
    );
    expect(Array.from(explicitZero)).toEqual(Array.from(omitted));
  });
});

describe("foreign occluder blanking (OcclusionMap.foreignOnly)", () => {
  function contextWithOcclusion(occlusion: OcclusionMap) {
    const ctx = buildRasterizeContext({
      camera: camera(),
      grid: { cols: COLS, rows: ROWS, cellAspect: 2 },
      polygons: [quad(0, -1, 1)],
      mode: "solid",
      useColors: false,
      doubleSided: true,
      directionalLight: { direction: [0, 0, 1], intensity: 0 },
      ambientLight: { intensity: 1 },
    });
    ctx.occlusion = occlusion;
    return ctx;
  }

  /** id-map: left half foreign-stamped, one column owned by local layer 7. */
  function mixedIdMap(): Int32Array {
    const idMap = new Int32Array(COLS * ROWS).fill(-1);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS / 2; c++) idMap[r * COLS + c] = GLYPH_FOREIGN_OCCLUDER_ID;
      idMap[r * COLS + (COLS / 2 + 2)] = 7; // a different LOCAL layer
    }
    return idMap;
  }

  const mapBase = () => ({
    idMap: mixedIdMap(), cols: COLS, rows: ROWS,
    colScale: 1, colOffset: 0, rowScale: 1, rowOffset: 0,
  });

  it("a normal layer blanks under BOTH the foreign stamp and a different local owner", () => {
    const grid = rasterizeToCells(contextWithOcclusion({ ...mapBase(), layerId: 3 }));
    const r = ROWS >> 1;
    // Covered by the quad, foreign-stamped → blank.
    expect(grid.depth[r * COLS + COLS / 2 - 2]).toBe(-Infinity);
    // Covered, owned by local layer 7 (≠ 3) → blank.
    expect(grid.depth[r * COLS + COLS / 2 + 2]).toBe(-Infinity);
    // Covered, unowned right half → drawn.
    expect(grid.depth[r * COLS + COLS / 2 + 1]).toBeGreaterThan(-Infinity);
  });

  it("a foreignOnly layer blanks ONLY under the foreign stamp (transparent contract)", () => {
    const grid = rasterizeToCells(contextWithOcclusion({ ...mapBase(), layerId: 3, foreignOnly: true }));
    const r = ROWS >> 1;
    // Foreign-stamped → blank.
    expect(grid.depth[r * COLS + COLS / 2 - 2]).toBe(-Infinity);
    // Owned by a different LOCAL layer → KEPT (transparent ignores local layers).
    expect(grid.depth[r * COLS + COLS / 2 + 2]).toBeGreaterThan(-Infinity);
    // Unowned → drawn.
    expect(grid.depth[r * COLS + COLS / 2 + 1]).toBeGreaterThan(-Infinity);
  });
});
