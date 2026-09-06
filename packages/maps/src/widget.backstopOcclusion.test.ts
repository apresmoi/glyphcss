import { describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapBreaks } from "./classify";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import type { GlyphMapBounds } from "./types";

/**
 * A raster layer mounts three tiers of the SAME terrain at once — the target
 * LOD ("fine"), a coarser retained fallback, and a permanent floor — so that
 * panning never opens a blank hole (`widget.ts`'s tier doc). All three are
 * opaque meshes in ONE glyphcss scene, so which one a cell shows is settled
 * by the shared per-cell depth buffer, not by which tier is "the real one".
 *
 * That is a problem the moment relief is exaggerated. A floor quad spans
 * ~11 degrees; where it straddles a coast its four corners interpolate
 * LINEARLY from the sea floor up to the summit, and over the ocean half of
 * that span the interpolated chord sits kilometres ABOVE the fine tier's own
 * (flat, deep) sea floor. The backstop therefore WINS the depth test over
 * open ocean and paints it in the colour of its own quad — whose elevation
 * statistic is the majority of a block that is mostly land. Reported live as
 * "the sea is basically GREEN" on `/maps` over the Peru-Chile trench, and
 * measured there at 486 of 4,462 sea cells rendered in a land band against
 * 16 for the fine tier alone.
 *
 * The fix is `GLYPH_MAP_RELIEF_BACKSTOP_SINK_M`: a tier that is NOT the
 * target LOD is mounted sunk along the projection's own elevation axis, far
 * enough that its chord can never rise above a finer tier's surface. These
 * tests pin the resulting invariant — open ocean, well away from any coast,
 * is never painted in a land band — end to end through the real widget, at
 * every mesh resolution the tier ladder can pick.
 */

const WATER = "#2a55a8";
const LAND = "#2f5a36";
/** Band 0 below sea level, band 1 at or above it — `GlyphMapClassifiers.etopo1V1`'s own first break. */
const classifier = glyphMapBreaks([0], { id: "sea-level" });

const DEEP_OCEAN_M = -6000;
const SUMMIT_M = 5000;
/**
 * The coast sits INSIDE a floor quad, not on its edge: floor quads at the
 * 32-per-axis backstop cap have edges at multiples of 11.25 degrees, so a
 * coast at lon 5 leaves lon 0..5 of that quad as ocean with a land corner
 * pulling the chord up over it. A coast ON a quad edge would give every quad
 * a uniform field and reproduce nothing.
 */
const COAST_LON = 5;

function tileBounds(level: GlyphMapProviderZoomLevel, x: number, y: number): GlyphMapBounds {
  const lonMin = -180 + x * level.tileLonSpan;
  const latMax = 90 - y * level.tileLatSpan;
  return { west: lonMin, east: lonMin + level.tileLonSpan, south: latMax - level.tileLatSpan, north: latMax };
}

function elevationAt(lon: number): number {
  return lon >= COAST_LON ? SUMMIT_M : DEEP_OCEAN_M;
}

/** The real ETOPO1 pyramid's shape (180x90 quads at every level) over a step-function continent. */
function makeProvider(maxZ: number): GlyphMapProvider {
  const zooms: GlyphMapProviderZoomLevel[] = [];
  for (let z = 0; z <= maxZ; z++) {
    const n = 2 ** z;
    zooms.push({ z, cols: n, rows: n, tileLonSpan: 360 / n, tileLatSpan: 180 / n, tileCols: 180, tileRows: 90 });
  }
  return {
    id: "step-continent",
    zooms,
    bounds: (z, x, y) => tileBounds(zooms[z], x, y),
    loadTile: (z, x, y): Promise<GlyphMapGeoTile> => {
      const level = zooms[z];
      const bounds = tileBounds(level, x, y);
      const elevation = new Float32Array((level.tileCols + 1) * (level.tileRows + 1));
      const dLon = level.tileLonSpan / level.tileCols;
      for (let row = 0; row <= level.tileRows; row++) {
        for (let col = 0; col <= level.tileCols; col++) {
          elevation[row * (level.tileCols + 1) + col] = elevationAt(bounds.west + col * dLon);
        }
      }
      return Promise.resolve({ bounds, cols: level.tileCols, rows: level.tileRows, elevation, source: "synthetic", sampler: "nearest" });
    },
  };
}

interface Rendered {
  readonly cellColor: (col: number, row: number) => string | null;
  readonly lonLat: (col: number, row: number) => readonly [number, number] | null;
  readonly cols: number;
  readonly rows: number;
  readonly teardown: () => void;
}

/**
 * `span` picks the target LOD (and so how many tiers sit under it);
 * `center` picks how much open ocean is in frame. Both are swept below so
 * the invariant is pinned across the whole `GLYPH_MAP_RELIEF_FRACTIONS`
 * ladder rather than at one lucky resolution.
 */
async function render(span: number, center: [number, number], maxZ = 4): Promise<Rendered> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const cols = 160;
  const rows = 64;
  const map = createGlyphMap(host, {
    view: { center, span, cols, rows },
    projection: glyphMapGlobe({ exaggeration: 24 }),
    tilt: 0,
    layers: [{ type: "raster", id: "terrain", source: makeProvider(maxZ), classifier, colors: [WATER, LAND] }],
    scene: { mode: "solid", useColors: true },
  });
  for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 10));
  map.scene.rerender();

  // One colour per output cell, read back off the base <pre> in document
  // order: a run's colour comes from the enclosing span, a blank cell has
  // none. `colorTolerance` is off, so a run's colour is the cell's own.
  const grid: (string | null)[][] = [[]];
  const walk = (node: Node, color: string | null): void => {
    if (node.nodeType === 3) {
      for (const ch of node.textContent ?? "") {
        if (ch === "\n") grid.push([]);
        else grid[grid.length - 1].push(ch === " " ? null : color);
      }
      return;
    }
    const el = node as HTMLElement;
    const own = el.style?.color || color;
    for (const child of Array.from(el.childNodes)) walk(child, own);
  };
  for (const child of Array.from(map.scene.output.childNodes)) walk(child, null);

  return {
    cellColor: (col, row) => grid[row]?.[col] ?? null,
    lonLat: (col, row) => map.unproject([col + 0.5, row + 0.5]),
    cols,
    rows,
    teardown: () => { map.destroy(); host.remove(); },
  };
}

/** Every cell whose own geography is open ocean at least `marginDeg` west of the coast. */
function openOceanCells(r: Rendered, marginDeg: number): { total: number; land: number; sample: string | null } {
  let total = 0;
  let land = 0;
  let sample: string | null = null;
  for (let row = 0; row < r.rows; row++) {
    for (let col = 0; col < r.cols; col++) {
      const color = r.cellColor(col, row);
      if (color === null) continue;
      const ll = r.lonLat(col, row);
      if (!ll) continue;
      if (ll[0] > COAST_LON - marginDeg) continue;
      total++;
      // Colours are shaded by the scene's own Lambert lighting, so compare
      // hue family (the land band is green-dominant, water blue-dominant)
      // rather than the palette's literal hex.
      const n = Number.parseInt(color.slice(1), 16);
      const green = (n >> 8) & 255;
      const blue = n & 255;
      if (green >= blue) {
        land++;
        sample ??= `cell(${col},${row}) lon=${ll[0].toFixed(2)} lat=${ll[1].toFixed(2)} rendered=${color}`;
      }
    }
  }
  return { total, land, sample };
}

describe("createGlyphMap — a backstop tier never occludes the target tier", () => {
  // Each entry picks a different target LOD, and so a different rung of the
  // relief-fraction ladder for the tiers under it.
  const views: readonly { readonly name: string; readonly span: number }[] = [
    { name: "span 33 (the reported view's zoom)", span: 33 },
    { name: "span 60", span: 60 },
    { name: "span 90", span: 90 },
    { name: "span 12", span: 12 },
  ];

  for (const { name, span } of views) {
    it(`paints open ocean as water at ${name}`, async () => {
      const r = await render(span, [-15, 0]);
      try {
        const ocean = openOceanCells(r, 4);
        expect(ocean.total).toBeGreaterThan(500);
        expect(`${ocean.land} land-coloured of ${ocean.total} open-ocean cells; first: ${ocean.sample}`).toBe(
          `0 land-coloured of ${ocean.total} open-ocean cells; first: null`,
        );
      } finally {
        r.teardown();
      }
    }, 20000);
  }

  it("still paints open ocean as water when the floor level IS the target LOD", async () => {
    // A single-level provider: the floor is the target, gets no sink, and
    // must keep rendering exactly as it always did.
    const r = await render(120, [-40, 0], 0);
    try {
      const ocean = openOceanCells(r, 12);
      expect(ocean.total).toBeGreaterThan(500);
      expect(`${ocean.land} land-coloured of ${ocean.total}`).toBe(`0 land-coloured of ${ocean.total}`);
    } finally {
      r.teardown();
    }
  }, 20000);
});
