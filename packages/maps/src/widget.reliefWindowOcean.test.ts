/**
 * A terrain floored at sea level and the ocean `fill` draped on the datum
 * (`685dcd3`) both describe the sea's surface at elevation 0. This file
 * pins how they compose, and records the one thing that surprised.
 *
 * The composition is STABLE: the frame is identical render to render, the
 * sea is one contiguous surface, and nothing is left blank. What changes is
 * WHO paints it. Measured on this fixture at span 33, 140x63:
 *
 * | terrain floor | ocean-fill cells | terrain-water cells |
 * |---|---|---|
 * | none (seabed at -6,000 m) | 8,820 | 0 |
 * | 0 m | 0 | 8,820 |
 * | -20 m | 1 | 8,819 |
 * | -100 m | 38 | 8,782 |
 * | -400 m | 728 | 8,092 |
 * | -1,500 m | 8,820 | 0 |
 *
 * So a floored terrain takes the ocean fill's cells, and it does so even at
 * a floor of -1 m — this is NOT a coplanar depth tie. It is the FILL's own
 * tessellation: `glyphMapVectorMesh` refines a ring until the projection is
 * locally affine, and the resulting chords sag INSIDE the sphere, while the
 * relief mesh's much finer quads sit close to it. The ~1,500 m crossover is
 * that sagitta. It is a property the fill has always had; the ocean fill
 * only ever won these cells because the unfloored seabed sat 144 km of world
 * beneath it at `exaggeration: 24`. Raising the terrain to the datum simply
 * uncovers it.
 *
 * That is left as it is rather than tuned. `685dcd3` settled, with its own
 * measurements, that a `"flat"`-draped ocean takes NO
 * `GLYPH_MAP_FILL_DRAPE_LIFT_M`, and re-opening that on the strength of a
 * different feature's fixture would be exactly the "shift the bug one layer
 * down" move. The picture a reader gets is coherent either way: one smooth
 * sea at the datum, in the terrain palette's own sea band. The ocean fill
 * becomes redundant under a floored terrain rather than broken by it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapBreaks } from "./classify";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider, GlyphMapProviderZoomLevel } from "./provider";
import type { GlyphMapVectorFeature } from "./vector/types";
import type { GlyphMapBounds } from "./types";

const COLS = 140;
const ROWS = 63;
const WATER = "#2a55a8";
const LAND = "#2f5a36";
const OCEAN_FILL = "#123f8f";
const classifier = glyphMapBreaks([0], { id: "sea-level" });
const DEEP_OCEAN_M = -6000;
const SUMMIT_M = 5000;
const COAST_LON = 5;

function tileBounds(level: GlyphMapProviderZoomLevel, x: number, y: number): GlyphMapBounds {
  const lonMin = -180 + x * level.tileLonSpan;
  const latMax = 90 - y * level.tileLatSpan;
  return { west: lonMin, east: lonMin + level.tileLonSpan, south: latMax - level.tileLatSpan, north: latMax };
}
function makeProvider(): GlyphMapProvider {
  const zooms: GlyphMapProviderZoomLevel[] = [];
  for (let z = 0; z <= 4; z++) {
    const n = 2 ** z;
    zooms.push({ z, cols: n, rows: n, tileLonSpan: 360 / n, tileLatSpan: 180 / n, tileCols: 180, tileRows: 90 });
  }
  return {
    id: "ocean-compose",
    zooms,
    bounds: (z, x, y) => tileBounds(zooms[z]!, x, y),
    loadTile: (z, x, y): Promise<GlyphMapGeoTile> => {
      const level = zooms[z]!;
      const bounds = tileBounds(level, x, y);
      const elevation = new Float32Array((level.tileCols + 1) * (level.tileRows + 1));
      const dLon = level.tileLonSpan / level.tileCols;
      for (let row = 0; row <= level.tileRows; row++) {
        for (let col = 0; col <= level.tileCols; col++) {
          elevation[row * (level.tileCols + 1) + col] = bounds.west + col * dLon >= COAST_LON ? SUMMIT_M : DEEP_OCEAN_M;
        }
      }
      return Promise.resolve({ bounds, cols: level.tileCols, rows: level.tileRows, elevation, source: "synthetic", sampler: "nearest" });
    },
  };
}

/** The ocean west of the coast, as the one polygon a `"flat"` drape is for. */
const ocean: GlyphMapVectorFeature = {
  id: "ocean",
  geometryType: "polygon",
  rings: [[[-40, -20], [COAST_LON, -20], [COAST_LON, 20], [-40, 20], [-40, -20]]],
  properties: { class: "ocean" },
};

const mounted: { destroy(): void }[] = [];
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const m of mounted.splice(0)) m.destroy();
  for (const h of hosts.splice(0)) h.remove();
});

async function render(window: Record<string, number>): Promise<{ text: string; colors: (string | null)[][] }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hosts.push(host);
  const map = createGlyphMap(host, {
    view: { center: [-15, 0], span: 33, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: 24 }),
    tilt: 0,
    layers: [
      { type: "raster", id: "terrain", source: makeProvider(), classifier, colors: [WATER, LAND], ...window },
      { type: "fill", id: "ocean", source: { features: [ocean] }, color: OCEAN_FILL, drape: "flat" },
    ],
    scene: { mode: "solid", useColors: true },
  });
  mounted.push(map);
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
  return { text: map.scene.output.textContent ?? "", colors: grid };
}

describe("createGlyphMap — a floored terrain and a datum-draped ocean fill", () => {
  it("renders the same frame twice — a coplanar tie does not shimmer", async () => {
    const a = await render({ minElevation: 0 });
    const b = await render({ minElevation: 0 });
    expect(a.text).toBe(b.text);
    expect(a.text.length).toBeGreaterThan(1000);
  }, 40000);

  it("draws the sea as one contiguous surface, with nothing left blank", async () => {
    const { colors } = await render({ minElevation: 0 });
    let water = 0, runs = 0;
    for (const row of colors) {
      let inRun = false;
      for (const c of row) {
        if (c === null) { inRun = false; continue; }
        const n = Number.parseInt(c.slice(1), 16);
        const g = (n >> 8) & 255, b = n & 255;
        if (b > 20 && g < b) { water++; if (!inRun) { runs++; inRun = true; } } else inRun = false;
      }
    }
    expect(water).toBeGreaterThan(2000);
    // Speckle is many short runs; a surface is few long ones. Two meshes
    // fighting over the sea would show up here first.
    expect(water / runs).toBeGreaterThan(8);
  }, 40000);

  it("hands the sea to the terrain once it is floored — the fill's own chord sag, measured", async () => {
    // See this file's header: the crossover is ~1,500 m and is the fill
    // tessellation's sagitta, not a coplanar tie. Pinned at both ends so a
    // change to either mesh's refinement is caught here.
    const count = async (w: Record<string, number>): Promise<{ fill: number; terrain: number }> => {
      const { colors } = await render(w);
      let fill = 0, terrain = 0;
      for (const row of colors) for (const c of row) {
        if (!c) continue;
        const n = Number.parseInt(c.slice(1), 16);
        const g = (n >> 8) & 255, b = n & 255;
        if (b < 20 || g >= b) continue;
        if (g / b < 0.47) fill++; else terrain++;
      }
      return { fill, terrain };
    };
    const unfloored = await count({});
    const floored = await count({ minElevation: 0 });
    expect(unfloored.terrain).toBe(0);
    expect(unfloored.fill).toBeGreaterThan(2000);
    expect(floored.fill).toBe(0);
    expect(floored.terrain).toBe(unfloored.fill);
  }, 60000);

  it("puts the fill on ground it agrees with, which it did not before the window", async () => {
    // Unfloored, the terrain's sea is 6,000 m below the fill's datum plane —
    // 144 km of world at exaggeration 24 — so the fill floats far above the
    // surface beside it. Floored, the two are the same plane. Both render;
    // what changes is that they now describe the same place.
    const unfloored = await render({});
    const floored = await render({ minElevation: 0 });
    expect(unfloored.text).not.toBe(floored.text);
    let diff = 0;
    for (let i = 0; i < Math.min(unfloored.text.length, floored.text.length); i++) {
      if (unfloored.text[i] !== floored.text[i]) diff++;
    }
    expect(diff).toBeGreaterThan(100);
  }, 40000);
});
