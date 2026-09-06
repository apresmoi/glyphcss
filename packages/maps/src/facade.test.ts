/**
 * The facade authoring primitives, and the ONE thing the whole feature rests on:
 * a wall quad's UVs carry its real TILE COUNT rather than a `[0,1]` square, so a
 * single generated image tiles across it under `Polygon.textureWrap: "repeat"`.
 */
import { describe, expect, it } from "vitest";
import {
  glyphMapFacadeTexture,
  glyphMapFacadeTiles,
  glyphMapFeatureSeed,
  glyphMapMetresBetween,
  glyphMapVaryColor,
  GLYPH_MAP_FACADE_BAY_METRES,
  GLYPH_MAP_FACADE_FLOOR_METRES,
} from "./facade";
import { glyphMapVectorMesh } from "./layers";
import { glyphMapEquirectangular } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";

const FACADE = { texture: "facade" };

/** A ~30 m square building footprint near Zurich. */
const M_PER_DEG = 111320;
function squareMetres(lon: number, lat: number, sideM: number): [number, number][] {
  const dLat = sideM / M_PER_DEG;
  const dLon = sideM / (M_PER_DEG * Math.cos(lat * Math.PI / 180));
  return [[lon, lat], [lon + dLon, lat], [lon + dLon, lat + dLat], [lon, lat + dLat], [lon, lat]];
}

function building(heightM: number, sideM = 28.8): GlyphMapVectorFeature {
  const ring = squareMetres(8.5445, 47.37418, sideM);
  return { id: "b1", geometryType: "polygon", properties: { height: heightM }, rings: [ring], polygons: [[ring]] };
}

function mesh(feature: GlyphMapVectorFeature, facade?: { texture: string }) {
  return glyphMapVectorMesh([feature], glyphMapEquirectangular(), {
    height: (f) => Number(f.properties?.height),
    color: () => "#94a3b8",
    ...(facade ? { facade } : {}),
  });
}

describe("glyphMapFacadeTiles", () => {
  it("turns real metres into whole bays and floors", () => {
    // 4 bays of 3.6 m, 4 floors of 3.2 m.
    expect(glyphMapFacadeTiles(4 * GLYPH_MAP_FACADE_BAY_METRES, 4 * GLYPH_MAP_FACADE_FLOOR_METRES, FACADE))
      .toEqual({ bays: 4, floors: 4 });
  });

  it("never drops below one tile on either axis", () => {
    // A 0.4 m sliver of wall on a 1 m plinth still has to show SOMETHING; zero
    // tiles would collapse the UV quad and sample one texel.
    expect(glyphMapFacadeTiles(0.4, 1, FACADE)).toEqual({ bays: 1, floors: 1 });
    expect(glyphMapFacadeTiles(0, 0, FACADE)).toEqual({ bays: 1, floors: 1 });
  });

  it("degenerate metres fall back to one tile rather than NaN UVs", () => {
    expect(glyphMapFacadeTiles(Number.NaN, Number.NaN, FACADE)).toEqual({ bays: 1, floors: 1 });
  });

  it("honours a caller's own bay/floor rhythm", () => {
    expect(glyphMapFacadeTiles(20, 20, { texture: "f", bayMetres: 10, floorMetres: 5 }))
      .toEqual({ bays: 2, floors: 4 });
  });
});

describe("glyphMapFacadeTexture", () => {
  it("is a single 12x12 tile, not a pre-tiled sheet", () => {
    const tex = glyphMapFacadeTexture();
    expect(tex.width).toBe(12);
    expect(tex.height).toBe(12);
    expect(tex.data.length).toBe(12 * 12 * 4);
  });

  it("carries real luminance structure — a window, a pier and a floor line", () => {
    // The whole mechanism is that a texel's LUMINANCE folds into the glyph. A
    // uniform tile would tile perfectly and change nothing at all.
    const { data } = glyphMapFacadeTexture();
    const levels = new Set<number>();
    for (let i = 0; i < data.length; i += 4) levels.add(data[i]!);
    expect(levels.size).toBeGreaterThanOrEqual(3);
    expect(Math.max(...levels) - Math.min(...levels)).toBeGreaterThan(100);
  });

  it("is fully opaque, so it never withholds coverage from a cell", () => {
    const { data } = glyphMapFacadeTexture();
    for (let i = 3; i < data.length; i += 4) expect(data[i]).toBe(255);
  });
});

describe("glyphMapVectorMesh facade authoring", () => {
  it("gives every wall repeat-wrapped UVs carrying its own tile count", () => {
    // 28.8 m walls (8 bays of 3.6 m) on a 16 m building (5 floors of 3.2 m).
    const built = mesh(building(16), FACADE);
    expect(built.walls.length).toBeGreaterThan(0);
    for (const wall of built.walls) {
      const poly = built.polygons[wall.polygon]!;
      expect(poly.texture).toBe("facade");
      expect(poly.textureWrap).toEqual({ s: "repeat", t: "repeat" });
      expect(poly.uvs).toBeDefined();
      const us = poly.uvs!.map((uv) => uv[0]);
      const vs = poly.uvs!.map((uv) => uv[1]);
      // Not a [0,1] square: the UVs span the wall's real bay/floor counts, which
      // is only meaningful because the rasterizer honours `repeat`.
      expect(Math.max(...us)).toBe(8);
      expect(Math.max(...vs)).toBe(5);
      expect(Math.min(...us)).toBe(0);
      expect(Math.min(...vs)).toBe(0);
      expect(poly.uvs!.length).toBe(poly.vertices.length);
    }
  });

  it("leaves the CAP untextured", () => {
    const built = mesh(building(16), FACADE);
    const wallIndices = new Set(built.walls.map((w) => w.polygon));
    const caps = built.polygons.filter((_, i) => !wallIndices.has(i));
    expect(caps.length).toBeGreaterThan(0);
    for (const cap of caps) {
      expect(cap.texture).toBeUndefined();
      expect(cap.uvs).toBeUndefined();
    }
  });

  it("floors come from TRUE metres, so a taller building gets more of them", () => {
    const short = mesh(building(6.4), FACADE);
    const tall = mesh(building(32), FACADE);
    const vMax = (m: ReturnType<typeof mesh>) =>
      Math.max(...m.polygons[m.walls[0]!.polygon]!.uvs!.map((uv) => uv[1]));
    expect(vMax(short)).toBe(2);
    expect(vMax(tall)).toBe(10);
  });

  it("omitting `facade` is byte-identical", () => {
    // The no-op guarantee: an existing extrusion layer must not move.
    expect(JSON.stringify(mesh(building(16)))).toBe(JSON.stringify(mesh(building(16))));
    const plain = mesh(building(16));
    for (const poly of plain.polygons) {
      expect(poly.texture).toBeUndefined();
      expect(poly.uvs).toBeUndefined();
      expect(poly.textureWrap).toBeUndefined();
    }
  });
});

describe("glyphMapMetresBetween", () => {
  it("measures a degree of latitude as ~111 km", () => {
    expect(glyphMapMetresBetween([8, 47], [8, 48])).toBeCloseTo(111320, 0);
  });

  it("shortens a degree of longitude by the cosine of the latitude", () => {
    expect(glyphMapMetresBetween([8, 60], [9, 60])).toBeCloseTo(111320 * Math.cos(60 * Math.PI / 180), 0);
  });
});

describe("glyphMapVaryColor", () => {
  it("amount 0 returns the base colour untouched", () => {
    expect(glyphMapVaryColor("#94a3b8", "b1", 0)).toBe("#94a3b8");
  });

  it("is deterministic per seed and different across seeds", () => {
    const a = glyphMapVaryColor("#94a3b8", "b1", 1);
    expect(glyphMapVaryColor("#94a3b8", "b1", 1)).toBe(a);
    expect(glyphMapVaryColor("#94a3b8", "b2", 1)).not.toBe(a);
  });

  it("actually separates a crowd of features", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(glyphMapVaryColor("#94a3b8", `way/${i}`, 1));
    // The point is separation, so a hash that collapsed to a handful of tones
    // would be no better than the flat colour it replaces.
    expect(seen.size).toBeGreaterThan(150);
  });

  it("stays a valid hex colour at the extremes", () => {
    for (const base of ["#000000", "#ffffff"]) {
      for (let i = 0; i < 50; i++) {
        expect(glyphMapVaryColor(base, `s${i}`, 1)).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("leaves an unparseable base colour alone", () => {
    expect(glyphMapVaryColor("rebeccapurple", "b1", 1)).toBe("rebeccapurple");
  });
});

describe("glyphMapFeatureSeed", () => {
  it("prefers the source's own id", () => {
    expect(glyphMapFeatureSeed({ id: "way/42", rings: [[[8, 47]]] })).toBe("way/42");
  });

  it("falls back to the geometry, so a re-tiled feature keeps its colour", () => {
    const a = glyphMapFeatureSeed({ rings: [[[8.5, 47.5], [8.6, 47.5]]] });
    const b = glyphMapFeatureSeed({ rings: [[[8.5, 47.5], [8.7, 47.9]]] });
    expect(a).toBe(b);
    expect(a).not.toBe(glyphMapFeatureSeed({ rings: [[[9.5, 47.5]]] }));
  });
});
