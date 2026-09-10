/**
 * A `fill` is DRAPED on the terrain: every cap vertex is projected at the
 * ground under its own lon/lat, so a lake that sits at height is drawn at
 * that height instead of under the mountains around it.
 *
 * THE DEFECT THIS PINS. `createMeshFeatureRuntime` built every `fill` at the
 * datum — deliberately, as "a flat overlay, not a structure standing on the
 * ground" — while the terrain mesh, a `fill-extrusion`, a `line`'s vertices
 * and every marker had already been planted on the exaggerated relief.
 * Reported on Lake Titicaca: *"if I look at the map with the terrain layer
 * activated too, I cannot see that lake because it's on the floor below the
 * terrain"*. The lake's surface is 3,812 m, so at `/maps`' own
 * `exaggeration: 24` the datum is ~91 km of world below the ground drawn
 * over it, and not one cell of the fill can win the depth test.
 *
 * THE ELEVATION IS THE TERRAIN'S, BECAUSE THE TILE HAS NONE. OpenMapTiles'
 * `water` layer carries `brunnel`, `class`, `id` and `intermittent` and
 * nothing else; `landcover` carries `class`/`subclass`, `landuse` `class`,
 * `park` `class`/`name`/`rank`. Across the nine real OpenFreeMap tiles
 * vendored under `fixtures/openfreemap/`, `mountain_peak` is the only layer
 * in the whole schema with an `ele` (`vector/openmaptiles.test.ts` re-derives
 * the key sets per run). So the ground under the polygon is the only height
 * there is — the same answer, and the same sampler, the strokes, the markers
 * and the extrusions already take.
 *
 * PER VERTEX, NOT PER GROUP. An extrusion takes ONE ground per rigid piece;
 * a fill is a sheet of ground. Measured on the vendored tiles against the
 * real ETOPO1 pyramid, the ground under ONE polygon's own ring spans up to
 * 520 m (`water`), 508 m (`landcover`) and 739 m (`park`) at a regional LOD
 * — one elevation for the piece would float one end of it and bury the
 * other by 24x that.
 *
 * THE FIXTURE IS REAL ETOPO1. `TITICACA_BLOCK` is a literal 25x25 slice of
 * the z4 tile `4/9` that `website/scripts/bake-geo-tiles.mjs` bakes from
 * ETOPO1 — lon -71..-68, lat -17..-14 at the pyramid's own 0.125 degree
 * vertex spacing (the full pyramid under `website/public/data/geo-tiles/` is
 * gitignored and so cannot be a test dependency). The lake reads a flat
 * 3,815 m across its own footprint there, the altiplano around it 3,800 to
 * 5,000 m, and the Amazon flank falls to 386 m.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapGlobe } from "./projection";
import { glyphMapVectorMesh } from "./layers";
import { glyphMapBreaks } from "./classify";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import type { GlyphMapVectorFeature } from "./vector/types";
import type { GlyphMapBounds } from "./types";

/**
 * Real ETOPO1, as baked: z4 tile `4/9`, columns 152..176 and rows 22..46 of
 * its own 180x90 vertex grid, i.e. lon -71..-68 by lat -14..-17 at 0.125
 * degrees, north row first. Whole metres, exactly as the int16 payload holds
 * them.
 */
const TITICACA_BLOCK: readonly (readonly number[])[] = [
  [4630, 4980, 4622, 4662, 4361, 4619, 4476, 4706, 4118, 4365, 2668, 3136, 1749, 1561, 1385, 1959, 1289, 1320, 1202, 1503, 1114, 676, 921, 643, 386],
  [4410, 4717, 4976, 4950, 4640, 4542, 4697, 4803, 4211, 3831, 4422, 3504, 1771, 2412, 2121, 1835, 1604, 1170, 1344, 2026, 1516, 762, 600, 589, 599],
  [4329, 4869, 4918, 4632, 4783, 4634, 4253, 4573, 4790, 4717, 4585, 3383, 3686, 2794, 2583, 2058, 2045, 1924, 1745, 842, 1340, 1305, 1407, 752, 484],
  [4992, 4631, 4247, 4715, 4705, 4618, 4199, 4123, 4207, 4405, 4608, 4002, 3400, 3251, 2832, 2460, 2627, 2631, 2204, 1294, 992, 2178, 1409, 1420, 616],
  [4901, 4604, 4398, 3990, 4074, 4276, 4093, 4771, 4609, 4707, 4416, 4573, 4465, 3591, 3964, 3985, 2287, 1959, 1192, 1431, 1093, 1929, 2026, 1677, 918],
  [4508, 4234, 4063, 4093, 4083, 4186, 4307, 4799, 4330, 4713, 4671, 4489, 4833, 4801, 4889, 4507, 3008, 1720, 1888, 1699, 1603, 1703, 2242, 1231, 659],
  [4700, 3941, 3921, 4110, 4149, 3926, 4102, 3991, 4089, 4119, 4758, 4551, 4859, 4757, 4760, 4673, 3455, 1662, 1764, 1840, 1443, 1396, 1934, 1952, 1247],
  [4565, 4375, 3945, 3905, 3920, 3996, 4061, 3871, 4307, 3949, 3982, 4350, 4438, 4417, 4750, 5492, 4074, 3675, 2524, 1337, 1331, 1519, 1367, 1832, 876],
  [4318, 4440, 4506, 4239, 3945, 3876, 4284, 3868, 4113, 4208, 4019, 4234, 4699, 4341, 4432, 5056, 4979, 3668, 2428, 1474, 1211, 1146, 1318, 1849, 1394],
  [4666, 4290, 4666, 4625, 4678, 3865, 3919, 3948, 3888, 4194, 4092, 3935, 4162, 4177, 4346, 4412, 3490, 3188, 3415, 2305, 1410, 950, 964, 1426, 1992],
  [4969, 4759, 4743, 4247, 4125, 4175, 3846, 3843, 3825, 3820, 3842, 3950, 3946, 4346, 4581, 4330, 3986, 3945, 2034, 2900, 1800, 1192, 947, 784, 1469],
  [4743, 4850, 4691, 4977, 4258, 3863, 3925, 3834, 3886, 3817, 3815, 3816, 3843, 4179, 4259, 4264, 3601, 4612, 3759, 2719, 1440, 1713, 1018, 680, 781],
  [4485, 4775, 4617, 4424, 4744, 3907, 3843, 3828, 3825, 3815, 3815, 3815, 3815, 3832, 3936, 3990, 3230, 2689, 2793, 2602, 2717, 1798, 1412, 830, 901],
  [4480, 4325, 4713, 4472, 4282, 3994, 3862, 3824, 3820, 3816, 3815, 3815, 3815, 3815, 3875, 3887, 3923, 2632, 1861, 4202, 3517, 2923, 1515, 1643, 1233],
  [4509, 4466, 4194, 4394, 4312, 4088, 3851, 3925, 3817, 3815, 3815, 3815, 3815, 3815, 3815, 3815, 4294, 4288, 3270, 3749, 3924, 3235, 2880, 1306, 1206],
  [4507, 4789, 4225, 4244, 4582, 4355, 4165, 4202, 3897, 3816, 3815, 3815, 3815, 3815, 3815, 3815, 3815, 3990, 4228, 3831, 5058, 4874, 3252, 2198, 2185],
  [4550, 4681, 4535, 3980, 4377, 4513, 4585, 4278, 3902, 4031, 3830, 3821, 3821, 3815, 3815, 3815, 3815, 3815, 3820, 3951, 4789, 5209, 4437, 2792, 2231],
  [4229, 4681, 4594, 4254, 4007, 4308, 4742, 4295, 4007, 3877, 4156, 3844, 3821, 3815, 3815, 3815, 3974, 3899, 4289, 3918, 4174, 4768, 4981, 3156, 3376],
  [4408, 4662, 3770, 4594, 4628, 4929, 4574, 4349, 4066, 4049, 4027, 4001, 3869, 3873, 3815, 3829, 3835, 3901, 3815, 3815, 4174, 4305, 4441, 4455, 3652],
  [4740, 3755, 3510, 4463, 4707, 4564, 4479, 4616, 4267, 4285, 4158, 4120, 4005, 4184, 3921, 4399, 3815, 3815, 3818, 3826, 3852, 3978, 4291, 4543, 4506],
  [4950, 4316, 4665, 4780, 4724, 4453, 4883, 4418, 4298, 4632, 4636, 4122, 4139, 4103, 4001, 3849, 3815, 3815, 3916, 4057, 3880, 3905, 3982, 3617, 4536],
  [2875, 4384, 2621, 4572, 4738, 4333, 4696, 5042, 4840, 4524, 4057, 4272, 4364, 4294, 3874, 3850, 3826, 4130, 4186, 4105, 3929, 3866, 3889, 3779, 3453],
  [1532, 1868, 2335, 4516, 4893, 4510, 4671, 4593, 4793, 4270, 4019, 4051, 4768, 4284, 3883, 3837, 3827, 3837, 4079, 4519, 4169, 3959, 3872, 4128, 3382],
  [2924, 2763, 4267, 4439, 4621, 4555, 4709, 4631, 4601, 4463, 4447, 4539, 4486, 3927, 3883, 3853, 3834, 3858, 3878, 4009, 4305, 4077, 3892, 4144, 3723],
  [2569, 3001, 3665, 3917, 5049, 4886, 4486, 5068, 4560, 4567, 4690, 4175, 4500, 4114, 3881, 3862, 3935, 3831, 3849, 3918, 4215, 4170, 4356, 3952, 4200],
];
const BLOCK_WEST = -71;
const BLOCK_NORTH = -14;
const BLOCK_STEP = 0.125;

/** Lake Titicaca's own surface, as ETOPO1 holds it (the real lake is 3,812 m). */
const LAKE_M = 3815;
/**
 * The real z0 reading at the same point — the whole planet in 180x90
 * samples smooths the altiplano down by half a kilometre. It is what the
 * COARSE tiers answer below, so a render can say which tier it is standing
 * on.
 */
const COARSE_M = 3302;
/**
 * The lake's own footprint, wholly inside the block's flat 3,815 m plateau —
 * its four corners land exactly on the pyramid's own 0.125-degree vertex
 * lines, so EVERY sample over it, edge and interior alike, is 3,815 m. That
 * is the water answer this slice landed on rather than a "one level per
 * ring" rule: where a DEM resolves a lake at all, the per-vertex drape is
 * already flat, because the DEM is.
 */
const LAKE_RING: readonly (readonly [number, number])[] = [
  [-69.75, -15.5], [-69.5, -15.5], [-69.5, -15.875], [-69.75, -15.875], [-69.75, -15.5],
];
const LAKE_CENTER: readonly [number, number] = [-69.625, -15.6875];

const WATER = "#1e6fd9";
const LAND = "#2f5a36";
const HIGH = "#8a7a55";
/** Below sea level / lowland / altiplano — three bands so terrain is never the water colour. */
const classifier = glyphMapBreaks([0, 3000], { id: "titicaca" });
const TERRAIN_COLORS = [WATER, LAND, HIGH];

const COLS = 160;
const ROWS = 64;
const SPAN = 1.4;
const EXAGGERATION = 24;

function blockElevation(lon: number, lat: number): number {
  const fx = (lon - BLOCK_WEST) / BLOCK_STEP;
  const fy = (BLOCK_NORTH - lat) / BLOCK_STEP;
  const cols = TITICACA_BLOCK[0]!.length - 1;
  const rows = TITICACA_BLOCK.length - 1;
  const c0 = Math.min(cols - 1, Math.max(0, Math.floor(fx)));
  const r0 = Math.min(rows - 1, Math.max(0, Math.floor(fy)));
  const tx = Math.min(1, Math.max(0, fx - c0));
  const ty = Math.min(1, Math.max(0, fy - r0));
  const a = TITICACA_BLOCK[r0]![c0]!, b = TITICACA_BLOCK[r0]![c0 + 1]!;
  const c = TITICACA_BLOCK[r0 + 1]![c0]!, d = TITICACA_BLOCK[r0 + 1]![c0 + 1]!;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

function tileBounds(level: GlyphMapProviderZoomLevel, x: number, y: number): GlyphMapBounds {
  const west = -180 + x * level.tileLonSpan;
  const north = 90 - y * level.tileLatSpan;
  return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
}

/**
 * The real pyramid's shape (180x90 quads per tile, z0..z4) over the vendored
 * block. `coarseUntil` is the deepest level that answers `COARSE_M` instead
 * of the block, which is how the "a finer tier landed" clause tells the two
 * apart — no real pyramid disagrees with itself by 513 m over one point, but
 * z0 and z4 genuinely read 3,302 and 3,815 here.
 */
function makeProvider(coarseUntil = -1, id = "titicaca"): GlyphMapProvider {
  const zooms: GlyphMapProviderZoomLevel[] = [];
  for (let z = 0; z <= 4; z++) {
    const n = 2 ** z;
    zooms.push({ z, cols: n, rows: n, tileLonSpan: 360 / n, tileLatSpan: 180 / n, tileCols: 180, tileRows: 90 });
  }
  return {
    id,
    zooms,
    bounds: (z, x, y) => tileBounds(zooms[z]!, x, y),
    loadTile: (z, x, y): Promise<GlyphMapGeoTile> => {
      const level = zooms[z]!;
      const bounds = tileBounds(level, x, y);
      const elevation = new Float32Array((level.tileCols + 1) * (level.tileRows + 1));
      const dLon = level.tileLonSpan / level.tileCols;
      const dLat = level.tileLatSpan / level.tileRows;
      for (let row = 0; row <= level.tileRows; row++) {
        for (let col = 0; col <= level.tileCols; col++) {
          elevation[row * (level.tileCols + 1) + col] = z <= coarseUntil
            ? COARSE_M
            : blockElevation(bounds.west + col * dLon, bounds.north - row * dLat);
        }
      }
      return Promise.resolve({ bounds, cols: level.tileCols, rows: level.tileRows, elevation, source: "etopo1-fixture", sampler: "nearest" });
    },
  };
}

const lakeFeature: GlyphMapVectorFeature = {
  geometryType: "polygon",
  properties: { class: "lake" },
  rings: [LAKE_RING.map(([lon, lat]) => [lon, lat] as [number, number])],
};

const mounted: { destroy(): void }[] = [];
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const m of mounted.splice(0)) m.destroy();
  for (const h of hosts.splice(0)) h.remove();
});

interface Rendered {
  readonly html: string;
  /** Cells painted in the water band's hue family — blue-dominant, whatever Lambert did to the literal hex. */
  readonly waterCells: number;
  readonly waterRows: readonly number[];
  readonly inkedCells: number;
  readonly map: ReturnType<typeof createGlyphMap>;
}

/** One colour per output cell off the base `<pre>`, exactly as `widget.backstopOcclusion.test.ts` reads it. */
function readCells(map: ReturnType<typeof createGlyphMap>): { water: number; rows: number[]; inked: number } {
  const grid: (string | null)[][] = [[]];
  const walk = (node: Node, color: string | null): void => {
    if (node.nodeType === 3) {
      for (const ch of node.textContent ?? "") {
        if (ch === "\n") grid.push([]);
        else grid[grid.length - 1]!.push(ch === " " ? null : color);
      }
      return;
    }
    const el = node as HTMLElement;
    const own = el.style?.color || color;
    for (const child of Array.from(el.childNodes)) walk(child, own);
  };
  for (const child of Array.from(map.scene.output.childNodes)) walk(child, null);
  let water = 0;
  let inked = 0;
  const rows: number[] = [];
  for (let row = 0; row < grid.length; row++) {
    for (const color of grid[row]!) {
      if (color === null) continue;
      inked++;
      const n = Number.parseInt(color.slice(1), 16);
      const green = (n >> 8) & 255;
      const blue = n & 255;
      // The land bands are green/khaki-dominant; only the water band is blue-dominant.
      if (blue > green) { water++; rows.push(row); }
    }
  }
  return { water, rows, inked };
}

async function render(options: {
  drape?: "surface" | "flat";
  terrain?: GlyphMapProvider | null;
  groundElevation?: (lon: number, lat: number) => number | null;
  span?: number;
  tilt?: number;
}): Promise<Rendered> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const map = createGlyphMap(host, {
    view: { center: [LAKE_CENTER[0], LAKE_CENTER[1]], span: options.span ?? SPAN, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: EXAGGERATION }),
    tilt: options.tilt ?? 0,
    groundElevation: options.groundElevation,
    layers: [
      ...(options.terrain === null ? [] : [{ type: "raster" as const, id: "terrain", source: options.terrain ?? makeProvider(), classifier, colors: TERRAIN_COLORS }]),
      { type: "fill" as const, id: "water", source: { features: [lakeFeature] }, color: WATER, drape: options.drape },
    ],
    scene: { mode: "solid", useColors: true },
  });
  mounted.push(map);
  for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 10));
  map.scene.rerender();
  const cells = readCells(map);
  return { html: map.scene.output.innerHTML, waterCells: cells.water, waterRows: cells.rows, inkedCells: cells.inked, map };
}

describe("createGlyphMap — a `fill` stands on the terrain under it", () => {
  it("draws the lake at its own height instead of burying it under the terrain", async () => {
    const flat = await render({ drape: "flat" });
    // The premise: the terrain is genuinely drawn over the lake's footprint,
    // so a datum overlay has something to be buried by.
    expect(flat.inkedCells).toBeGreaterThan(2000);
    expect(flat.waterCells).toBe(0);

    const draped = await render({});
    expect(draped.inkedCells).toBeGreaterThan(2000);
    // 567 cells at the shipped `GLYPH_MAP_FILL_DRAPE_LIFT_M`; the threshold
    // is loose because the count is a framing detail, but the LIFT is not —
    // at a lift of 0 this is exactly 0, since a draped fill is the terrain's
    // own surface and the orthographic depth test hands every tie to
    // whoever drew first.
    expect(draped.waterCells).toBeGreaterThan(300);
  }, 30000);

  it("is byte-identical with no ground to read, whichever way the option is set", async () => {
    // Tilted, because that is the framing in which an elevation is
    // OBSERVABLE at all: at zero pitch a lift moves depth and no row.
    const draped = await render({ terrain: null, tilt: 40 });
    const flat = await render({ terrain: null, drape: "flat", tilt: 40 });
    // Not "both empty": the fill is drawn, it is simply drawn at the datum
    // in both, because nothing can say where the ground is.
    expect(draped.waterCells).toBeGreaterThan(100);
    expect(draped.html).toBe(flat.html);
    // The premise that makes that identity worth something: this comparison
    // CAN see a drape — the same map with a ground source is a different
    // render, so a leaked ground of terrain magnitude cannot hide here.
    const withGround = await render({ terrain: null, groundElevation: () => LAKE_M, tilt: 40 });
    expect(withGround.html).not.toBe(flat.html);
  }, 45000);

  it("follows the ground when a finer tier lands", async () => {
    // z0..z3 answer 3,302 m, z4 answers the block's own 3,815 m. Mounted
    // wide, the fill plants on the coarse tier; zoomed in, the fine tier
    // arrives 513 m higher and the fill has to come with it or the terrain
    // buries it again.
    const wide = await render({ terrain: makeProvider(3, "tiered"), span: 40 });
    expect(wide.waterCells).toBeGreaterThan(0);

    const near = await render({ terrain: makeProvider(3, "tiered"), span: SPAN });
    expect(near.waterCells).toBeGreaterThan(300);
  }, 60000);

  it("takes a caller-supplied ground source over the mounted raster, and its `null` as the datum", async () => {
    // The raster reads 3,815 m under the lake; a source that answers `null`
    // everywhere therefore proves BOTH halves at once — it wins over the
    // raster (or the lake would still be drawn) and `null` means the datum
    // (or it would be drawn somewhere else).
    const supplied = await render({ groundElevation: () => null });
    expect(supplied.waterCells).toBe(0);

    // ...and with no raster layer at all it drapes on the caller's own DEM.
    const own = await render({ terrain: null, groundElevation: () => LAKE_M, tilt: 40 });
    const datum = await render({ terrain: null, drape: "flat", tilt: 40 });
    const mean = (rows: readonly number[]): number => rows.reduce((a, b) => a + b, 0) / rows.length;
    expect(own.waterCells).toBeGreaterThan(100);
    expect(datum.waterCells).toBeGreaterThan(100);
    expect(Math.abs(mean(own.waterRows) - mean(datum.waterRows))).toBeGreaterThan(3);
  }, 60000);

  it("keeps a steep drape's faces out of the sliver path", () => {
    // The Amazon flank of the block: 24x exaggeration turns its real slope
    // into faces tens of degrees off the local up, which is exactly what the
    // cap's ill-conditioning guard is looking for. The verdict is taken on
    // the flat face for that reason, so a steep drape must produce the same
    // face list and the same (empty) camera-dependent list as the flat one.
    const projection = glyphMapGlobe({ exaggeration: EXAGGERATION });
    const slope: GlyphMapVectorFeature = {
      geometryType: "polygon",
      properties: {},
      rings: [[[-68.5, -14.125], [-68.125, -14.125], [-68.125, -14.5], [-68.5, -14.5], [-68.5, -14.125]]],
    };
    const flat = glyphMapVectorMesh([slope], projection, {});
    const draped = glyphMapVectorMesh([slope], projection, { drape: (_f, lon, lat) => blockElevation(lon, lat) });
    // The premise: the terrain under this patch really does fall away.
    const samples = slope.rings[0]!.map(([lon, lat]) => blockElevation(lon, lat));
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(500);
    expect(draped.polygons.length).toBe(flat.polygons.length);
    expect(draped.walls.length).toBe(flat.walls.length);
    expect(draped.polygons.some((p) => p.shadingNormal !== undefined)).toBe(flat.polygons.some((p) => p.shadingNormal !== undefined));
  });

  it("moves vertices and nothing else: the draped mesh has the same faces as the flat one", () => {
    const projection = glyphMapGlobe({ exaggeration: EXAGGERATION });
    const flat = glyphMapVectorMesh([lakeFeature], projection, {});
    const draped = glyphMapVectorMesh([lakeFeature], projection, { drape: (_f, lon, lat) => blockElevation(lon, lat) });
    expect(draped.polygons.length).toBe(flat.polygons.length);
    expect(draped.walls.length).toBe(flat.walls.length);
    // Same faces, genuinely moved: every vertex is further from the globe's
    // centre by the lake's own 3,815 m on the exaggerated axis.
    const radius = (v: readonly number[]): number => Math.hypot(v[0]!, v[1]!, v[2]!);
    for (let i = 0; i < flat.polygons.length; i++) {
      const a = flat.polygons[i]!.vertices;
      const b = draped.polygons[i]!.vertices;
      expect(b.length).toBe(a.length);
      for (let v = 0; v < a.length; v++) {
        expect(radius(b[v]!) - radius(a[v]!)).toBeCloseTo((LAKE_M * EXAGGERATION) / GLYPH_MAP_EARTH_RADIUS_M, 9);
      }
    }
  });
});
