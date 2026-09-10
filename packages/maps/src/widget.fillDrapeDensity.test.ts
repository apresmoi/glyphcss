// @vitest-environment happy-dom
/**
 * A DRAPED FILL MUST HIDE THE TERRAIN UNDER IT WHATEVER EITHER LAYER'S
 * DENSITY IS.
 *
 * Reported from a `/maps` link over Lake Titicaca (`m=p3x7-15cpliy6-...`,
 * which decodes to `terrainDensity: 1.4` and the OSM `omt-water` row at
 * `1.8`): *"the lake doesn't remove the glyphs from the terrain, right?
 * shouldn't we be culling the underlying layer? since they are different
 * layers? seems it only works if they both share the same density,
 * otherwise they overlap"*.
 *
 * The reporter's own reading was half right and the measurement says which
 * half. A `density !== 1` is what glyphcss's `isDetailMesh` separates on, so
 * each of those rows renders into its OWN `<pre>` and ownership is decided
 * by the shared cross-layer occlusion id-map instead of by the base grid's
 * own per-cell depth test. Measured on this file's fixture BEFORE the fix,
 * as a fraction of the terrain grids' own cells (`density^2` more of them
 * per viewport area, so the raw counts are not comparable and the ratio is):
 *
 * | terrain / water density | terrain cells the lake takes | ideal (`81 * d^2`) |
 * |---|---|---|
 * | 1 / 1     |  81 |  81 |
 * | 1 / 1.8   |  81 |  81 |
 * | 1.4 / 1.4 |  32 | 159 |
 * | 1.4 / 1.8 |  32 | 159 |
 * | 1.8 / 1.8 |   0 | 262 |
 * | 2 / 1     |   0 | 324 |
 *
 * So it is not "different densities" — it is **the terrain being separated
 * at all**. With the terrain in the base grid the ordinary depth test hands
 * the lake every cell it wins, whatever the fill's own density; the moment
 * the terrain leaves the base grid the lake stops taking any.
 *
 * THE INVARIANT THIS FILE STATES. Moving a density slider is an APPEARANCE
 * choice — it must not change WHO OCCLUDES WHOM. So the lake must take the
 * same share of the terrain in every pairing: `hidden / density^2` constant,
 * measured against the base-grid depth test's own verdict as the reference.
 *
 * Fixture traps. happy-dom has no layout, so `stubMonospaceMetrics` gives
 * the hidden cell probes a real advance — without it every detail layer
 * measures a zero-width cell and never renders. A `tilt` is not decoration
 * either: at zero pitch the id-map's depth ramp across one cell is nearly
 * flat and a 10 m lift clears it, so the defect does not reproduce at all —
 * it is the VIEW's own depth ramp under a pitch, not the terrain's
 * roughness, that used to swallow the lift. The terrain, the lake and the
 * elevations are the real-ETOPO1 block `widget.fillDrape.test.ts` documents.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
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

const CELL_W = 8;
const CELL_H = 16;
/** The pitch the reported link carries. Load-bearing — see the header. */
const TILT = 51;

const rect = (w: number, h: number) =>
  ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
const EMPTY_RECT = rect(0, 0);
const stubbedHosts = new Set<HTMLElement>();
function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(COLS * CELL_W, ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? "16");
    const k = fontPx / 16;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  stubbedHosts.clear();
  document.body.innerHTML = "";
});

/** Per-character `#rrggbb` of a rendered `<pre>`, row-major (`widget.walkDetailOcclusion.test.ts`'s own reader). */
function renderedColors(pre: HTMLElement): (string | null)[] {
  const out: (string | null)[] = [];
  for (const node of Array.from(pre.childNodes)) {
    const text = node.textContent ?? "";
    let color: string | null = null;
    if (node.nodeType === 1) {
      const m = /color:\s*(#[0-9a-fA-F]{6})/.exec((node as HTMLElement).getAttribute("style") ?? "");
      color = m ? m[1].toLowerCase() : null;
    }
    for (const ch of text) out.push(ch === "\n" ? null : color);
  }
  return out;
}

/** The land bands are green/khaki-dominant; only the water band is blue-dominant, whatever Lambert did to the literal hex. */
function isWaterColor(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1), 16);
  return (n & 255) > ((n >> 8) & 255);
}

async function mount(terrainDensity: number, waterDensity: number | null) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [LAKE_CENTER[0], LAKE_CENTER[1]] as [number, number], span: SPAN, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: EXAGGERATION }),
    tilt: TILT,
    layers: [
      {
        type: "raster" as const, id: "terrain", source: makeProvider(), classifier, colors: TERRAIN_COLORS,
        ...(terrainDensity === 1 ? {} : { density: terrainDensity }),
      },
      ...(waterDensity === null ? [] : [{
        type: "fill" as const, id: "water", source: { features: [lakeFeature] }, color: WATER,
        ...(waterDensity === 1 ? {} : { density: waterDensity }),
      }]),
    ],
    scene: { mode: "solid", useColors: true },
  });
  // Settle on the RENDER rather than on a clock: the tiles resolve through
  // promises, and a fixed sleep is a flake under a loaded runner. Stop when
  // the grid shapes and the total ink have stopped moving.
  let previous = "";
  let stable = 0;
  let grids: (string | null)[][] = [];
  for (let i = 0; i < 400 && stable < 4; i++) {
    await new Promise((r) => setTimeout(r, 5));
    map.scene.rerender();
    grids = (Array.from(host.querySelectorAll("pre.glyph-output")) as HTMLElement[]).map(renderedColors);
    const signature = grids.map((g) => `${g.length}:${g.reduce((n, c) => n + (c === null ? 0 : 1), 0)}`).join("|");
    stable = signature === previous ? stable + 1 : 0;
    previous = signature;
  }
  const cleanup = () => { map.destroy(); host.remove(); };
  return { grids, cleanup };
}

interface Taken {
  /** Cells of the TERRAIN layer's own output grids that the lake takes — blanked, or repainted in the water band. */
  readonly hidden: number;
  /** Terrain cells inked with the lake mounted, over every terrain grid. */
  readonly terrainInk: number;
  /** Lake cells drawn anywhere, so no clause below can pass because the fill vanished. */
  readonly waterInk: number;
}

/**
 * What the lake takes from the terrain at one density pairing. The terrain's
 * own grids are matched by position against a terrain-ONLY render at the
 * same terrain density — the shape of a detail `<pre>` is fitted to its own
 * mesh's silhouette, so the pairing is by grid index and a length mismatch
 * is a failure to compare, never a silent skip.
 */
async function lakeTakes(terrainDensity: number, waterDensity: number): Promise<Taken> {
  const before = await mount(terrainDensity, null);
  const refGrids = before.grids;
  before.cleanup();
  const after = await mount(terrainDensity, waterDensity);

  let hidden = 0, terrainInk = 0, waterInk = 0;
  for (const grid of after.grids) for (const c of grid) if (c !== null && isWaterColor(c)) waterInk++;
  for (let g = 0; g < refGrids.length; g++) {
    const was = refGrids[g]!, now = after.grids[g]!;
    expect(now.length).toBe(was.length);
    for (let i = 0; i < was.length; i++) {
      if (now[i] !== null) terrainInk++;
      if (was[i] === null || was[i] === now[i]) continue;
      hidden++;
    }
  }
  after.cleanup();
  return { hidden, terrainInk, waterInk };
}

describe("createGlyphMap — a draped `fill` hides the terrain under it at every density", () => {
  /**
   * The reference verdict: both layers in the base `<pre>`, so the ordinary
   * per-cell depth test — not the id-map — decides, and the lake's 10 m
   * `GLYPH_MAP_FILL_DRAPE_LIFT_M` wins it outright.
   */
  let baseline = 0;

  it("takes the terrain's cells with both layers in the base grid", async () => {
    const { hidden, terrainInk, waterInk } = await lakeTakes(1, 1);
    // Premises: the terrain really does cover the lake's footprint, and the
    // lake really is drawn.
    expect(terrainInk).toBeGreaterThan(2000);
    expect(waterInk).toBeGreaterThan(50);
    expect(hidden).toBeGreaterThan(50);
    baseline = hidden;
  }, 120000);

  // Every pairing the reporter can reach with the two density sliders: the
  // fill separated alone, both separated together at one density, both
  // separated at DIFFERENT densities, and the terrain separated alone.
  for (const [terrainDensity, waterDensity] of [[1, 1.8], [1.4, 1.4], [1.4, 1.8], [1.8, 1.8], [2, 1]] as const) {
    it(`takes the same share of the terrain at terrain ${terrainDensity} / water ${waterDensity}`, async () => {
      expect(baseline).toBeGreaterThan(0);
      const { hidden, terrainInk, waterInk } = await lakeTakes(terrainDensity, waterDensity);
      expect(terrainInk).toBeGreaterThan(2000);
      expect(waterInk).toBeGreaterThan(50);
      // A terrain grid at `d` holds `d^2` cells per viewport area, so the
      // lake's own footprint is `d^2` cells too. The tolerance is for the
      // id-map's own resolution at the footprint's BOUNDARY (ownership is
      // all-or-nothing per base cell, coverage is per detail cell) — never
      // for its interior, which must go entirely.
      const ideal = baseline * terrainDensity * terrainDensity;
      expect(hidden).toBeGreaterThan(ideal * 0.7);
    }, 120000);
  }
});
