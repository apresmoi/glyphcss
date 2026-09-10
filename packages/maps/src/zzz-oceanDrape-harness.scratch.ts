/**
 * The SEA is not the SEABED: an ocean `fill` stands at the datum while every
 * other water body still stands on the terrain under it.
 *
 * ## The report
 *
 * `/maps?m=p3x5f8dcgy5n2t9ms32i8t21xE1j26zb1kF21eL1dO33d0T212N1kI31jkR1M1a1a1q1k1n1t1t1a1a1aJ1a2141a`
 * — the Aegean at 25.585 E / 38.762 N, span 5.07 degrees, tilt 69, bearing
 * 20, globe, `exaggeration: 24`, with the terrain raster and the OSM
 * `omt-water` row both on: *"the sea is a mess"*, *"there is a ton of black
 * lines"*, *"and weird shapes"*.
 *
 * ## The defect
 *
 * `62100e2` made a `fill` drape per vertex onto `groundElevationSampler`,
 * whose answer is the TERRAIN elevation. Over the ocean the terrain is
 * BATHYMETRY — the sea FLOOR — so the sea SURFACE was being built on the sea
 * floor. Measured on the real z6 OpenFreeMap ocean polygon vendored beside
 * this file against the real ETOPO1 pyramid, over its 37,599 draped cap
 * vertices: min -890 m, p25 -67, p50 -1, p95 +200, max +622, with 50.7% of
 * them below sea level. That is not a wash on a surface, it is a relief map
 * of the seabed painted blue: 2,891 of the ocean's 12,499 cap faces stood
 * steeper than 45 degrees off the local up, one face of the "flat" sea
 * spanned up to 20,746 m of world vertically, and a face at 90 degrees is
 * edge-on to the camera — one dark line, which is what the report calls a
 * black line.
 *
 * ## The rule, and why it is not the water rule `62100e2` rejected
 *
 * That slice rejected a "flat lake level" ESTIMATOR (a min/median/mean over
 * the ring) and was right to: where a DEM resolves a lake it already encodes
 * the lake's SURFACE, so the per-vertex drape is flat for free. Measured
 * across every vendored OpenFreeMap tile plus the Aegean one, the ground
 * under each water class's own ring vertices:
 *
 * | `water.class` | n | min | p50 | max | below sea level |
 * |---|---|---|---|---|---|
 * | `lake` | 4,278 | +4 | +1,166 | +1,413 | 0% |
 * | `pond` | 90 | +415 | +430 | +438 | 0% |
 * | `river` | 988 | +22 | +411 | +1,121 | 0% |
 * | `swimming_pool` | 240 | +22 | +23 | +442 | 0% |
 * | `ocean` | 16,375 | **-5,296** | +1 | +2,587 | **48.8%** |
 *
 * The premise holds for every water class the schema has EXCEPT the ocean,
 * and it fails there for a reason in the DATA rather than in the renderer: a
 * DEM's zero IS mean sea level, so the ocean is the one body of water whose
 * surface a DEM never stores — it stores what is under it. The ocean's
 * surface therefore needs no estimator and no statistic: it is the datum, by
 * the definition of the datum.
 *
 * A blanket `max(ground, 0)` clamp was rejected rather than shipped: it does
 * not fix the ocean's own +622 m coastal probes (the sea would still climb
 * the hills wherever a 0.125-degree DEM cell straddles a coast), and it
 * breaks the land that is genuinely below sea level — Death Valley (-86 m),
 * the Dead Sea shore (-430 m), the Caspian (-28 m), a Dutch polder (-7 m) —
 * floating a landcover wash up to 10 km of world above the ground it
 * describes at `exaggeration: 24`.
 *
 * ## The fixtures are real
 *
 * `fixtures/openfreemap/z6-36-24-aegean.mvt` is the live OpenFreeMap tile the
 * reported view actually loads (Web Mercator 6/36/24, lon 22.4..28.2 by lat
 * 36.5..41.0): one `ocean` feature of 4 groups, 109 island holes and 12,449
 * ring vertices, beside 9 `lake` features. `AEGEAN_BLOCK` is a literal 35x30
 * slice of the z4 ETOPO1 tile `4/9_4` that `website/scripts/bake-geo-tiles.mjs`
 * bakes — lon 23.5..27.75 by lat 37.0..40.625 at the pyramid's own
 * 0.125-degree vertex spacing — because the full pyramid under
 * `website/public/data/geo-tiles/` is gitignored and so cannot be a test
 * dependency. It reads -1,460 m at the bottom of the Cretan basin, +1,139 m
 * in the Anatolian hills, and 699 of its 1,050 samples are below sea level.
 */
import { expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createGlyphMap } from "./widget";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapGlobe } from "./projection";
import { glyphMapVectorMesh } from "./layers";
import { glyphMapBreaks } from "./classify";
import { glyphMapDecodeMVT } from "./vector/pmtiles";
import { GLYPH_MAP_OPENMAPTILES_LAYERS, glyphMapOpenMapTilesLayers } from "./vector/openmaptiles";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import type { GlyphMapVectorFeature } from "./vector/types";
import type { GlyphMapBounds } from "./types";
import type { GlyphMapFillDrape, GlyphMapFillLayer } from "./widget";

/**
 * Real ETOPO1, as baked: z4 tile `9_4`, columns 8..42 and rows 35..64 of its
 * own 180x90 vertex grid, i.e. lon 23.5..27.75 by lat 40.625..37.0 at 0.125
 * degrees, north row first. Whole metres, exactly as the int16 payload holds
 * them.
 */
const AEGEAN_BLOCK: readonly (readonly number[])[] = [
  [52, 382, 123, -65, -83, -99, -108, -161, -81, 218, 371, -113, -135, -141, -115, -91, -83, -48, -48, -40, -28, 59, 33, 122, 17, -3, -13, 6, 337, 86, -49, -118, -30, 393, -8],
  [420, 535, 367, -72, -59, -132, -207, -333, -230, -112, -218, -289, -278, -238, -119, -96, -2, -6, -49, -46, -48, -28, -396, -344, -170, 45, 81, -14, -54, -54, -64, -54, 43, 1, 177],
  [573, 187, 252, 100, 20, -24, -192, -497, -641, -646, -505, -289, -325, -498, -265, -126, -191, -585, -703, -874, -631, -470, -95, 218, 124, -1, 50, 128, 44, 114, 42, -17, -33, -8, -8],
  [-9, 133, -43, -424, -621, -525, 370, -196, -806, -801, -829, -660, -246, -893, -1460, -667, -715, -438, -154, -34, -66, -21, -30, 86, -47, 78, 318, 479, 232, 35, 21, 106, 342, 71, 102],
  [-212, -220, 42, 528, -396, -496, -868, -165, -1002, -918, -795, -513, -554, -644, -367, -159, -120, -72, 200, 202, 16, -81, 59, -11, 47, 446, 548, 191, 267, 340, 372, 480, 402, 70, 84],
  [236, -41, -238, -29, -2, -532, -910, -1073, -983, -856, -268, -389, -183, 3, -5, 37, -39, -51, -77, -75, -66, -32, 22, 206, 377, 402, 485, 148, 103, 263, 269, 335, 172, 461, 422],
  [-373, -534, -456, -892, -976, -1042, -1107, -698, -867, -475, -301, -251, -98, 151, -5, -33, -77, -72, -90, -65, -28, -5, 36, 302, 298, 142, 286, 475, 284, 719, 626, 169, 243, 297, 167],
  [-341, -419, -457, -612, -922, -1078, -734, -1053, -449, -400, -357, -210, -190, -130, -90, -102, -106, -110, -96, -83, -64, -8, 176, 100, 159, 436, 313, 1139, 865, 581, 433, 541, 306, 404, 344],
  [-497, -665, -825, -1188, -1274, -1020, -1017, -393, -304, -342, -285, -162, -148, -98, -101, -144, -158, -158, -128, -104, -90, -12, 313, 274, 403, 636, 722, 480, 321, 334, 510, 501, 348, 177, 272],
  [-709, -1150, -1132, -1137, -1050, -224, -246, -316, -332, -355, -219, -109, 183, -143, -165, -242, -252, -206, -309, -292, -172, 306, 251, 65, -116, -81, -62, -7, 20, 462, 728, 371, 433, 587, 262],
  [-1250, -1157, -1105, -1242, -437, -104, -391, -266, -298, -373, -357, -304, -188, -284, -437, -368, -435, -250, -179, -259, -238, -152, -6, -49, -78, 19, -5, 71, 203, 754, 1003, 695, 565, 246, 509],
  [-215, -1063, -1113, -169, -92, -379, -408, -329, -245, -463, -592, -730, -843, -788, -325, -158, -273, -285, -210, 58, 109, 379, 73, 169, -42, -7, 16, 192, 602, 727, 241, 280, 284, 289, 742],
  [8, 80, 5, -48, -117, -245, -339, -300, -178, -657, -838, -772, -798, -399, -343, -300, -199, -189, -216, -106, 228, -1, 47, 167, 82, -12, -6, 31, 275, 412, 32, 42, 265, 822, 170],
  [-624, -1045, -394, -239, -253, -379, -302, -198, -26, -699, -962, -936, -447, -283, -196, -242, -234, -228, -295, -301, -360, -309, -241, 252, 147, -56, -48, 294, 3, 227, 308, 567, 445, 366, 242],
  [-480, -541, -411, -285, -303, -346, -255, -251, 317, -132, -430, -274, -196, -186, -141, -87, -198, -248, -170, -257, -279, -336, -476, -385, -174, -97, -128, -54, -42, 210, 483, 666, 231, 110, 87],
  [129, 107, -509, -900, -834, -413, -459, -506, -398, -153, -507, -436, -425, -465, -240, -158, -339, -350, -169, -339, -327, -295, -233, -165, -133, -77, -26, -33, 165, 302, 319, 280, 33, 46, 136],
  [38, 264, 295, 484, 832, -5, -173, -375, -520, -912, -563, -534, -412, -603, -697, -534, -135, -151, -338, -58, -67, -94, -118, 144, 492, -64, -13, -2, 4, 60, 274, 93, 29, 50, 524],
  [-3, 18, 197, 453, 323, 103, -313, -424, -176, -615, -491, -285, -433, -592, -596, -423, -363, -510, -421, 121, 555, 169, -1, -13, 687, 21, -16, -2, 2, 188, 478, 401, 797, 61, 82],
  [205, 25, -5, -5, -5, 43, -127, -132, -451, -513, -248, -504, -719, -660, -576, -513, -364, -590, -250, -331, 172, 21, -44, -40, 107, 76, 137, 31, 299, 81, 294, 947, 602, 956, 928],
  [424, 301, 203, 467, 3, 0, 66, -531, -618, -586, -441, -732, -684, -647, -647, -629, -310, -366, -455, 66, 182, -64, -33, 11, 100, 262, 59, 276, 548, 115, 142, 123, 537, 537, 283],
  [308, 481, 294, 438, -2, -5, 381, 413, 450, -158, -617, -653, -577, -633, -425, -518, -472, -490, -410, -200, -110, -241, -309, -236, -191, -139, -179, 247, 492, 191, 186, 13, 17, 85, 67],
  [71, 271, 191, 183, 44, -33, 207, 84, 428, -431, 10, -176, -452, -575, -443, -403, -563, -641, -355, -252, -419, -662, -917, -777, -431, -385, -315, -136, -185, 50, 199, 47, 119, 454, 683],
  [-78, -83, 19, 154, 242, -134, -149, -125, -100, -240, -1, 667, -134, -393, -458, -787, -892, -647, -738, -484, -360, -822, -1140, -1138, -1083, -468, -268, -330, -236, -118, -7, 205, 55, 48, 60],
  [158, -154, -161, -48, 189, 49, -121, -115, -183, -273, -251, -32, -21, -297, -391, -613, -830, -783, -735, -796, -691, -1145, -1300, -458, -714, 810, 372, 259, 161, -205, -9, 182, 11, 225, 117],
  [-185, -194, -178, -215, -148, -262, -87, 120, -307, -81, -27, -213, -44, 27, -8, -680, -840, -892, -619, -449, -79, 401, 808, -121, -8, -113, -89, -95, -84, -3, 2, 4, 108, 596, 385],
  [7, -188, -140, -85, -181, -347, -357, -276, -273, -242, -210, 34, -136, -99, -108, -23, -170, -138, -432, -358, -167, -617, -412, -234, -4, -99, -88, -83, -41, -59, 128, 33, -2, 865, 769],
  [-3, -339, -213, -492, -754, -514, -503, -5, -192, -259, -211, 4, -75, -97, -19, -83, -116, -160, -284, -370, -458, -620, -647, -210, -107, -81, 8, -82, -82, -73, 32, -1, 179, 164, 31],
  [-253, -523, -549, -583, -765, -716, -466, -210, -113, -110, -261, -135, -90, -95, -104, -98, -92, -136, -245, -228, -181, -265, -426, -544, -369, -172, -79, -84, -88, -73, -85, -54, -5, 1, 48],
  [-495, -454, -661, -911, -835, -830, -492, -149, 70, -278, -287, -158, -105, -5, 33, 2, 524, -90, -100, -184, -257, -391, -313, -293, -431, -232, -313, 79, -101, -91, -4, 49, -1, 25, 211],
  [-863, -721, -795, -935, -920, -848, -588, -626, -428, -221, -87, -152, -56, 14, -1, -1, 464, -60, -227, -298, -368, -384, -260, 1, -33, -380, -386, -135, 239, -70, 2, 1, 186, 167, 32]];
const BLOCK_WEST = 23.5;
const BLOCK_NORTH = 40.625;
const BLOCK_STEP = 0.125;

const COLS = 120;
const ROWS = 54;
const CELL_W = 7;
const CELL_H = 12;
/** The reported view's own centre, at the widest span this fixture's own block covers. */
const CENTER: readonly [number, number] = [25.584784, 38.76241];
const SPAN = 2.5;
const TILT = 45;
const BEARING = 20;
const EXAGGERATION = 24;

/** `/maps`' own terrain palette and classifier, so band 0 is genuinely "below sea level". */
const TERRAIN_COLORS = ["#2a55a8", "#2f5a36", "#3f6b32", "#5f7536", "#86713f", "#9c7b50", "#b09471", "#cdb49a", "#f0f0f0"];
const classifier = glyphMapBreaks([0, 250, 800, 1600, 2600, 3600, 4600, 5600], { id: "etopo1-v1" });
/** `GLYPH_MAP_OPENMAPTILES_WATER_COLORS.ocean`, the colour the shipped row paints the sea. */
const OCEAN = "#1b3f66";

/**
 * Self-consistent cell metrics — `widget.fillCrack.test.ts`'s own reader, and
 * for its reason: `stubMonospaceMetrics` never reaches glyphcss's own cell
 * probe (a fresh `<pre>` inside its hidden sandbox), so the widget would frame
 * the camera for one cell size while the rasterizer projected with another and
 * `map.unproject()` would not name the cell it is handed.
 */
function installConsistentMetrics(): () => void {
  const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "getBoundingClientRect");
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: function (this: HTMLElement) {
      const rect = (w: number, h: number) => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) });
      if (this.tagName !== "PRE") return rect(0, 0);
      if (this.parentElement?.getAttribute("aria-hidden") !== "true") return rect(COLS * CELL_W, ROWS * CELL_H);
      const lines = (this.textContent ?? "").split("\n");
      return rect(Math.max(1, ...lines.map((l) => l.length)) * CELL_W, Math.max(1, lines.length) * CELL_H);
    },
  });
  return () => {
    if (original) Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", original);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>).getBoundingClientRect;
  };
}

function blockElevation(lon: number, lat: number): number {
  const fx = (lon - BLOCK_WEST) / BLOCK_STEP;
  const fy = (BLOCK_NORTH - lat) / BLOCK_STEP;
  const cols = AEGEAN_BLOCK[0]!.length - 1;
  const rows = AEGEAN_BLOCK.length - 1;
  const c0 = Math.min(cols - 1, Math.max(0, Math.floor(fx)));
  const r0 = Math.min(rows - 1, Math.max(0, Math.floor(fy)));
  const tx = Math.min(1, Math.max(0, fx - c0));
  const ty = Math.min(1, Math.max(0, fy - r0));
  const a = AEGEAN_BLOCK[r0]![c0]!, b = AEGEAN_BLOCK[r0]![c0 + 1]!;
  const c = AEGEAN_BLOCK[r0 + 1]![c0]!, d = AEGEAN_BLOCK[r0 + 1]![c0 + 1]!;
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

function tileBounds(level: GlyphMapProviderZoomLevel, x: number, y: number): GlyphMapBounds {
  const west = -180 + x * level.tileLonSpan;
  const north = 90 - y * level.tileLatSpan;
  return { west, east: west + level.tileLonSpan, south: north - level.tileLatSpan, north };
}

/**
 * The REAL z0 reading at the Anatolian plateau below (27.3125 E / 39.5625 N),
 * where the block's own z4 samples run 306..1,003 m. The whole planet in
 * 180x90 samples smooths that hill down to 147 m, which is what the COARSE
 * tiers answer here so a render can say which tier a fill is standing on.
 */
const AEGEAN_COARSE_M = 147;

/** The real pyramid's shape (180x90 quads per tile, z0..z4) over the vendored block. */
function makeProvider(coarseUntil = -1): GlyphMapProvider {
  const zooms: GlyphMapProviderZoomLevel[] = [];
  for (let z = 0; z <= 4; z++) {
    const n = 2 ** z;
    zooms.push({ z, cols: n, rows: n, tileLonSpan: 360 / n, tileLatSpan: 180 / n, tileCols: 180, tileRows: 90 });
  }
  return {
    id: "aegean",
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
            ? AEGEAN_COARSE_M
            : blockElevation(bounds.west + col * dLon, bounds.north - row * dLat);
        }
      }
      return Promise.resolve({ bounds, cols: level.tileCols, rows: level.tileRows, elevation, source: "etopo1-fixture", sampler: "nearest" });
    },
  };
}

/** The live OpenFreeMap 6/36/24 tile's own `water` features — real data, read fresh per test. */
function waterFeatures(): readonly GlyphMapVectorFeature[] {
  const bytes = readFileSync(path.resolve(__dirname, "../fixtures/openfreemap/z6-36-24-aegean.mvt"));
  const layers = glyphMapDecodeMVT(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, 6, 36, 24, ["water"]);
  return layers.water ?? [];
}

const oceanOnly = (features: readonly GlyphMapVectorFeature[]) => features.filter((f) => f.properties?.class === "ocean");

/** The shipped `omt-water` row's own drape rule, read off the schema table rather than restated. */
function shippedWaterDrape(): GlyphMapFillLayer["drape"] {
  const built = glyphMapOpenMapTilesLayers({ features: [] }, { include: ["omt-water"] });
  const water = built.find((l) => l.id === "omt-water");
  expect(water?.type).toBe("fill");
  return (water as GlyphMapFillLayer).drape;
}

function inRing(ring: readonly (readonly [number, number])[], lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Even-odd against the real ring set: inside an outer ring and outside every hole. */
function isOpenWater(features: readonly GlyphMapVectorFeature[], lon: number, lat: number): boolean {
  for (const feature of features) {
    for (const group of feature.polygons ?? []) {
      const [outer, ...holes] = group;
      if (!outer || !inRing(outer, lon, lat)) continue;
      if (holes.some((hole) => inRing(hole, lon, lat))) continue;
      return true;
    }
  }
  return false;
}

const mounted: { destroy(): void }[] = [];
const hosts: HTMLElement[] = [];
const restores: (() => void)[] = [];


interface Rendered {
  readonly text: string;
  readonly grid: readonly (readonly (string | null)[])[];
  readonly map: ReturnType<typeof createGlyphMap>;
}

/** One colour per output cell off the base `<pre>` — `widget.fillDrape.test.ts`'s own reader. */
function cellGrid(pre: HTMLElement): (string | null)[][] {
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
  for (const child of Array.from(pre.childNodes)) walk(child, null);
  return grid;
}

async function render(options: {
  readonly features: readonly GlyphMapVectorFeature[];
  readonly drape?: GlyphMapFillLayer["drape"];
  readonly terrain?: boolean;
  /** A ground with no `raster` layer drawing it — the only way to see the sea's OWN mesh against nothing else. */
  readonly groundElevation?: (lon: number, lat: number) => number | null;
  readonly provider?: GlyphMapProvider;
  readonly color?: string;
}): Promise<Rendered> {
  restores.push(installConsistentMetrics());
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const map = createGlyphMap(host, {
    view: { center: [CENTER[0], CENTER[1]], span: SPAN, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: EXAGGERATION }),
    tilt: TILT,
    bearing: BEARING,
    groundElevation: options.groundElevation,
    layers: [
      ...(options.terrain === false ? [] : [{ type: "raster" as const, id: "terrain", source: options.provider ?? makeProvider(), classifier, colors: TERRAIN_COLORS }]),
      { type: "fill" as const, id: "water", source: { features: options.features }, color: options.color ?? OCEAN, drape: options.drape },
    ],
    scene: { mode: "solid", useColors: true },
  });
  mounted.push(map);
  for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 10));
  map.scene.rerender();
  return { text: map.scene.output.textContent ?? "", grid: cellGrid(map.scene.output), map };
}

/** A blank cell with ink on both sides in one axis — `widget.fillCrack.test.ts`'s own hole test. */
function holeCells(text: string): [number, number][] {
  const lines = text.split("\n");
  const ink = (row: number, col: number): boolean => {
    const ch = lines[row]?.[col];
    return ch !== undefined && ch !== " ";
  };
  const out: [number, number][] = [];
  for (let row = 0; row < lines.length; row++) {
    for (let col = 0; col < (lines[row]?.length ?? 0); col++) {
      if (ink(row, col)) continue;
      if ((ink(row, col - 1) && ink(row, col + 1)) || (ink(row - 1, col) && ink(row + 1, col))) out.push([col, row]);
    }
  }
  return out;
}


import { createHash } from "node:crypto";
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

export async function scenarios(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const ocean = oceanOnly(waterFeatures());
  const lakes = waterFeatures().filter((f) => f.properties?.class === "lake");
  const a = await render({ features: ocean, drape: shippedWaterDrape() });
  out["ocean-flat"] = sha(a.map.scene.output.innerHTML);
  const b = await render({ features: ocean, drape: "surface" });
  out["ocean-surface"] = sha(b.map.scene.output.innerHTML);
  const c = await render({ features: ocean, drape: shippedWaterDrape(), terrain: false, groundElevation: blockElevation });
  out["ocean-noterrain"] = sha(c.map.scene.output.innerHTML);
  const d = await render({ features: lakes, drape: shippedWaterDrape() });
  out["lakes"] = sha(d.map.scene.output.innerHTML);
  for (const m of mounted.splice(0)) m.destroy();
  for (const h of hosts.splice(0)) h.remove();
  for (const r of restores.splice(0)) r();
  return out;
}
