import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseFont } from "./parseFont";
import { textPolygons } from "./textPolygons";

function loadFixture(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(__dirname, "../test/fixtures", name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const roboto = parseFont(loadFixture("Roboto-Bold.ttf"));

function bounds(polys: ReturnType<typeof textPolygons>) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of polys) {
    for (const [x, y, z] of p.vertices) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

describe("textPolygons", () => {
  it("produces polygons for a word", () => {
    const polys = textPolygons(roboto, "Poly");
    expect(polys.length).toBeGreaterThan(0);
    for (const p of polys) expect(p.vertices.length).toBeGreaterThanOrEqual(3);
  });

  it("centers the run horizontally around the origin (world Y)", () => {
    const b = bounds(textPolygons(roboto, "Poly"));
    expect(Math.abs(b.minY + b.maxY)).toBeLessThan(b.maxY - b.minY); // roughly symmetric
  });

  it("flat profile depth matches the requested depth on world Z", () => {
    const depth = 30;
    const b = bounds(textPolygons(roboto, "I", { depth, profile: "flat" }));
    expect(b.maxZ - b.minZ).toBeCloseTo(depth, 5);
  });

  it("longer text produces more polygons", () => {
    expect(textPolygons(roboto, "Polygon").length).toBeGreaterThan(textPolygons(roboto, "Po").length);
  });

  it("round and bevel profiles add side rings (more polys than flat)", () => {
    const flat = textPolygons(roboto, "o", { profile: "flat" }).length;
    const round = textPolygons(roboto, "o", { profile: "round" }).length;
    const bevel = textPolygons(roboto, "o", { profile: "bevel" }).length;
    expect(round).toBeGreaterThan(flat);
    expect(bevel).toBeGreaterThan(flat);
  });

  it("applies cap and side colors", () => {
    const polys = textPolygons(roboto, "o", { color: "#ff0000", sideColor: "#00ff00" });
    const colors = new Set(polys.map((p) => p.color));
    expect(colors.has("#ff0000")).toBe(true);
    expect(colors.has("#00ff00")).toBe(true);
  });

  it("ignores whitespace-only glyphs but advances layout", () => {
    const withSpace = textPolygons(roboto, "a b");
    const noSpace = textPolygons(roboto, "ab");
    // Same glyph geometry count; the space only shifts positions.
    expect(withSpace.length).toBe(noSpace.length);
    expect(bounds(withSpace).maxY - bounds(withSpace).minY)
      .toBeGreaterThan(bounds(noSpace).maxY - bounds(noSpace).minY);
  });
});
