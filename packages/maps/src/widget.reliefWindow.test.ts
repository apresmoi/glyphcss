/**
 * A `raster` layer's elevation window across the TIER LADDER
 * (`GlyphMapRasterLayer.minElevation`/`maxElevation`).
 *
 * A raster layer mounts three tiers of the same terrain at once — the target
 * LOD, a coarser retained fallback, and a permanent floor — so a pan never
 * opens a blank hole (`widget.ts`'s tier doc). That is exactly what decides
 * how a window has to behave, and it is why terrain outside the window is
 * HELD AT the window edge rather than dropped:
 *
 * - Dropping the out-of-window quads is EXACT for one tier. Rendered alone
 *   over the real ETOPO1 pyramid, a cropped floor of 0 left precisely the
 *   cells the unwindowed render painted in a land band and removed precisely
 *   the ones it painted as water — 150 of 1,752 sea cells over the
 *   Mediterranean at span 40 either way, 13 of 2,932 over the Peru-Chile
 *   trench at span 33.
 * - It is not exact for the LADDER and cannot be made so: each tier resolves
 *   the window against its own quad grid, so their coastlines disagree by up
 *   to a coarse quad, and a dropped quad is a HOLE the backstop underneath
 *   simply fills. Measured with all three tiers up, that same cropped floor
 *   painted 641 of those 1,752 sea cells in a land band against the target
 *   tier's own 150, and 344 of 2,932 against 13 — the "sea is basically
 *   GREEN" defect reintroduced at the magnitude it was first reported at
 *   (486 of 4,462). `GLYPH_MAP_RELIEF_BACKSTOP_SINK_M` cannot answer it: the
 *   sink ORDERS two surfaces where both exist and says nothing about what
 *   shows through a gap in one. Cropping also ate coastline — 200 land cells
 *   went blank, each a quad whose statistic fell below the floor taking its
 *   land half with it.
 * - Clamping has no hole, so none of that arises, and the tiers agree
 *   EXACTLY rather than by ordering: wherever every sample a tier covers is
 *   below the floor, every tier's surface is the same constant plane, so no
 *   coarse chord can rise above a finer one.
 *
 * The harness is `widget.backstopOcclusion.test.ts`' step-continent provider
 * — the same z0-z4 shape the real pyramid has (180x90 quads at every level)
 * over a deep-ocean/summit step, which is the harness the backstop defect
 * itself is pinned with. The mesh-level half of the feature, on real ETOPO1
 * samples, is `mesh.elevationWindow.test.ts`.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapBreaks } from "./classify";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapHandle } from "./widget";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import type { GlyphMapBounds } from "./types";

const WATER = "#2a55a8";
const LAND = "#2f5a36";
/** Band 0 below sea level, band 1 at or above it — `etopo1V1`'s own first break. */
const classifier = glyphMapBreaks([0], { id: "sea-level" });

const DEEP_OCEAN_M = -6000;
const SUMMIT_M = 5000;
/** The coast sits INSIDE a floor quad, never on its edge — see `widget.backstopOcclusion.test.ts`. */
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
function makeProvider(maxZ: number, onlyDeepest = false): GlyphMapProvider {
  const zooms: GlyphMapProviderZoomLevel[] = [];
  for (let z = onlyDeepest ? maxZ : 0; z <= maxZ; z++) {
    const n = 2 ** z;
    zooms.push({ z, cols: n, rows: n, tileLonSpan: 360 / n, tileLatSpan: 180 / n, tileCols: 180, tileRows: 90 });
  }
  return {
    id: `step-continent-${maxZ}-${onlyDeepest}`,
    zooms,
    bounds: (z, x, y) => tileBounds(zooms.find((l) => l.z === z)!, x, y),
    loadTile: (z, x, y): Promise<GlyphMapGeoTile> => {
      const level = zooms.find((l) => l.z === z)!;
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

const COLS = 160;
const ROWS = 64;
const mounted: { map: GlyphMapHandle; host: HTMLElement }[] = [];
afterEach(() => {
  for (const { map, host } of mounted.splice(0)) { map.destroy(); host.remove(); }
});

interface Rendered {
  readonly text: string;
  readonly cellColor: (col: number, row: number) => string | null;
  readonly lonLat: (col: number, row: number) => readonly [number, number] | null;
  readonly ground: (lon: number, lat: number) => number | null;
}

async function render(span: number, center: [number, number], window: Record<string, number> = {}, maxZ = 4, onlyDeepest = false): Promise<Rendered> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center, span, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: 24 }),
    tilt: 0,
    layers: [{ type: "raster", id: "terrain", source: makeProvider(maxZ, onlyDeepest), classifier, colors: [WATER, LAND], ...window }],
    scene: { mode: "solid", useColors: true },
  });
  mounted.push({ map, host });
  for (let i = 0; i < 60; i++) await new Promise((r) => setTimeout(r, 10));
  map.scene.rerender();

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

  return {
    text: map.scene.output.textContent ?? "",
    cellColor: (col, row) => grid[row]?.[col] ?? null,
    lonLat: (col, row) => map.unproject([col + 0.5, row + 0.5]),
    ground: (lon, lat) => map.getGroundElevation?.(lon, lat) ?? null,
  };
}

/** Every painted cell whose own geography is open ocean at least `marginDeg` west of the coast. */
function openOcean(r: Rendered, marginDeg: number): { total: number; land: number; blank: number; sample: string | null } {
  let total = 0, land = 0, blank = 0;
  let sample: string | null = null;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const ll = r.lonLat(col, row);
      if (!ll || ll[0] > COAST_LON - marginDeg) continue;
      const color = r.cellColor(col, row);
      total++;
      if (color === null) { blank++; continue; }
      const n = Number.parseInt(color.slice(1), 16);
      if (((n >> 8) & 255) >= (n & 255)) {
        land++;
        sample ??= `cell(${col},${row}) lon=${ll[0].toFixed(2)} lat=${ll[1].toFixed(2)} rendered=${color}`;
      }
    }
  }
  return { total, land, blank, sample };
}

describe("createGlyphMap — an omitted elevation window is byte-identical", () => {
  it("renders the exact same text as before the option existed", async () => {
    const plain = await render(33, [-15, 0]);
    const undef = await render(33, [-15, 0], { minElevation: undefined as unknown as number, maxElevation: undefined as unknown as number });
    expect(undef.text).toBe(plain.text);
    expect(plain.text.length).toBeGreaterThan(1000);
  }, 40000);
});

describe("createGlyphMap — a windowed raster layer keeps the tier ladder honest", () => {
  // Each span picks a different target LOD, and so a different rung of the
  // relief-fraction ladder for the tiers beneath it.
  for (const span of [33, 60, 90]) {
    it(`never opens a hole for a backstop to fill at span ${span}`, async () => {
      const floored = await render(span, [-15, 0], { minElevation: 0 });
      const ocean = openOcean(floored, 4);
      expect(ocean.total).toBeGreaterThan(500);
      // A CROP would blank these cells and let the sunk backstop paint them
      // in a land band. A clamp leaves the surface closed, so open ocean is
      // still open ocean: painted, and painted as water.
      expect(`${ocean.land} land-coloured, ${ocean.blank} blank, of ${ocean.total} open-ocean cells; first: ${ocean.sample}`).toBe(
        `0 land-coloured, 0 blank, of ${ocean.total} open-ocean cells; first: null`,
      );
    }, 40000);
  }

  it("paints open ocean exactly as the unwindowed render did — the window moves position, not colour", async () => {
    const plain = await render(33, [-15, 0]);
    const floored = await render(33, [-15, 0], { minElevation: 0 });
    const before = openOcean(plain, 4);
    const after = openOcean(floored, 4);
    expect({ total: after.total, land: after.land, blank: after.blank })
      .toEqual({ total: before.total, land: before.land, blank: before.blank });
  }, 40000);

  it("changes the picture it is supposed to change — the relief goes", async () => {
    // Not vacuous: a floor of 0 over a 6,000 m basin at exaggeration 24
    // removes 144 km of world, so the shading over the ocean must move even
    // though the colour band does not.
    const plain = await render(33, [-15, 0]);
    const floored = await render(33, [-15, 0], { minElevation: 0 });
    let diff = 0;
    const a = plain.text, b = floored.text;
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) diff++;
    expect(diff).toBeGreaterThan(200);
  }, 40000);
});

describe("createGlyphMap — every tier takes the same window", () => {
  it("renders open ocean exactly as the target tier does alone", async () => {
    // The whole ladder (z0-z4: target LOD + coarser fallback + permanent
    // floor) against a provider exposing ONLY the deepest level, which
    // mounts neither a fallback nor a floor (`provider.zooms.length <= 1`).
    // A CROP fails here by construction: the tiers resolve the window
    // against different quad grids, so the backstop's own coastline is up to
    // a coarse quad away from the target's and shows through the hole.
    const ladder = await render(33, [-15, 0], { minElevation: 0 });
    const targetAlone = await render(33, [-15, 0], { minElevation: 0 }, 4, true);
    const a = openOcean(ladder, 4);
    const b = openOcean(targetAlone, 4);
    expect(a.total).toBeGreaterThan(500);
    expect({ total: a.total, land: a.land, blank: a.blank })
      .toEqual({ total: b.total, land: b.land, blank: b.blank });
  }, 40000);

  it("reaches the permanent FLOOR tier, at the span where the floor is the visible surface", async () => {
    // Zoomed out past the pyramid's shallowest level the floor IS the target
    // LOD: it takes no backstop sink and is the surface the render shows.
    // This is the one span at which a tier missing the window is OBSERVABLE
    // — everywhere else an unwindowed backstop is sunk behind a closed
    // windowed surface, which is itself the clamp's own safety property
    // (a CROP has no such cover, which is the whole argument in the header).
    // Span 360 on 160 columns is 2.25 degrees per cell against the z0
    // level's own 2 degrees per quad, so `sweepLOD` lands on z0.
    const floored = await render(360, [-15, 0], { minElevation: 0 });
    const plain = await render(360, [-15, 0]);
    let diff = 0;
    for (let i = 0; i < Math.min(plain.text.length, floored.text.length); i++) {
      if (plain.text[i] !== floored.text[i]) diff++;
    }
    // Measured 135 with the floor windowed, exactly 0 with it left out.
    expect(diff).toBeGreaterThan(50);

    const a = openOcean(floored, 4);
    const b = openOcean(plain, 4);
    expect(a.total).toBeGreaterThan(300);
    // No land-banded ocean either way, and the window never opens a cell the
    // unwindowed render had covered. It legitimately CLOSES some: a 6,000 m
    // basin at exaggeration 24 sinks 144 km, so the unwindowed globe's own
    // silhouette has ocean cells falling off it that a floored one fills
    // back in. That is the sphere becoming round, and it is the one
    // direction this may move.
    // At this span the visible surface is the floor's own 2-degree quads, so
    // a coastal quad or two is land-banded over water in BOTH renders — the
    // ordinary coarse-quad quantization, not a window defect. What the
    // window must not do is make it worse, or open a cell the unwindowed
    // render had covered. (It legitimately CLOSES some: a 6,000 m basin at
    // exaggeration 24 sinks 144 km, so the unwindowed globe's own silhouette
    // has ocean cells falling off it that a floored one fills back in. That
    // is the sphere becoming round, and it is the one direction this moves.)
    expect({ landGrew: a.land > b.land, blankGrew: a.blank > b.blank }).toEqual({ landGrew: false, blankGrew: false });
  }, 40000);
});
