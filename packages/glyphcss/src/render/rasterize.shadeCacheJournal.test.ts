/**
 * `ShadeCache.journal` — the undo log that lets a caller hand the rasterizer
 * its LIVE shade cache instead of a defensive copy.
 *
 * `createGlyphScene` used to `.slice()` all four arrays into a working copy
 * every render and publish it only once the whole transaction had committed,
 * so a failure in a later stage left the next frame's inputs untouched. At
 * `/maps`' street-level polygon count that copy is ~4 MB of fresh array per
 * displayed frame. The journal buys the same guarantee for the cost of the
 * entries a pass actually FILLS, which on a warm cache is nearly none —
 * because a populated entry is a cache HIT and a hit never writes.
 *
 * The whole guarantee rests on one property, and this is what pins it:
 * **the journal names every index the pass wrote, and nothing else**, so
 * `delete`-ing them restores the cache exactly. If it under-reports, a
 * rolled-back cache keeps an entry it should not have; if it over-reports,
 * a rollback deletes an entry an earlier frame owned.
 */
import { describe, expect, it } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import {
  buildRasterizeContext,
  clearShadeCacheEntry,
  countShadeTriangles,
  createShadeCache,
  type ShadeCache,
} from "../api/rasterizeContext";
import { rasterize } from "./rasterize";

const light = { direction: [0.3, 0.4, 0.86] as [number, number, number], intensity: 0.8 };
const ambient = { intensity: 0.3 };

/** A grid of quads in the XY plane; `zoom` decides how many of them land on the grid. */
function quads(cols: number, rows: number): Polygon[] {
  const out: Polygon[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c - cols / 2) * 0.25;
      const y = (r - rows / 2) * 0.25;
      out.push({
        vertices: [[x, y, 0], [x, y + 0.25, 0], [x + 0.25, y + 0.25, 0], [x + 0.25, y, 0]],
        color: `#${(((c * 7 + r * 13) % 200) + 40).toString(16).padStart(2, "0")}8844`,
      });
    }
  }
  return out;
}

function render(polygons: Polygon[], zoom: number, shadeCache: ShadeCache | null): string {
  const ctx = buildRasterizeContext({
    camera: createGlyphOrthographicCamera({ rotX: 62, rotY: 24, zoom }),
    grid: { cols: 48, rows: 26, cellAspect: 2 },
    polygons,
    mode: "solid",
    useColors: true,
    doubleSided: true,
    directionalLight: light,
    ambientLight: ambient,
  });
  // `shadeCache` lives on the CONTEXT, not on its options — assigned after
  // the build, exactly as `createGlyphScene` assigns it.
  ctx.shadeCache = shadeCache;
  return rasterize(ctx);
}

/** A plain copy of the four arrays — what the rollback must reproduce. */
function snapshot(c: ShadeCache) {
  return { iA: Array.from(c.iA), iB: Array.from(c.iB), iC: Array.from(c.iC), filled: Array.from(c.filled), lit: c.lit.slice() };
}

describe("ShadeCache.journal", () => {
  it("names exactly the entries a pass filled, so deleting them restores the cache", () => {
    const first = quads(40, 20);
    // The same list plus more geometry AFTER it: `triT` is positional in draw
    // order, so every index pass 1 owns still means the same triangle and the
    // appended quads are exactly the misses pass 2 has to journal.
    const grown = [...first, ...quads(12, 12)];
    // Sized for the grown list: pass 1 fills only the first part, so the
    // appended quads are genuine misses for pass 2 to journal.
    const cache = createShadeCache(countShadeTriangles(grown), true);

    render(first, 90, cache);
    expect(cache.journal!.length).toBeGreaterThan(0);
    cache.journal!.length = 0;
    const before = snapshot(cache);

    render(grown, 90, cache);
    expect(cache.journal!.length).toBeGreaterThan(0);
    expect(Array.from(cache.filled).reduce((a, b) => a + b, 0))
      .toBeGreaterThan(before.filled.reduce((a, b) => a + b, 0));

    for (const t of cache.journal!) clearShadeCacheEntry(cache, t);
    expect(snapshot(cache)).toEqual(before);
  });

  it("journals nothing on a pass that is all hits", () => {
    const polygons = quads(40, 20);
    const cache = createShadeCache(countShadeTriangles(polygons), true);
    render(polygons, 40, cache);
    cache.journal!.length = 0;
    // Same geometry, same light, same camera: every triangle is a hit.
    render(polygons, 40, cache);
    expect(cache.journal).toEqual([]);
  });

  it("renders identically whether or not the journal is being kept", () => {
    const polygons = quads(40, 20);
    const journaled = createShadeCache(countShadeTriangles(polygons), true);
    const plain = createShadeCache(countShadeTriangles(polygons));
    expect(render(polygons, 40, journaled)).toBe(render(polygons, 40, plain));
    expect(render(polygons, 90, journaled)).toBe(render(polygons, 90, plain));
  });
});
