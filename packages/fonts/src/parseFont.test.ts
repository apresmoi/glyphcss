import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parseFont } from "./parseFont";

function loadFixture(name: string): ArrayBuffer {
  const buf = readFileSync(resolve(__dirname, "../test/fixtures", name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const roboto = parseFont(loadFixture("Roboto-Bold.ttf"));

describe("parseFont", () => {
  it("reads font metrics", () => {
    expect(roboto.unitsPerEm).toBe(2048);
    expect(roboto.ascender).toBeGreaterThan(0);
    expect(roboto.descender).toBeLessThan(0);
  });

  it("outlines a simple glyph with a positive advance", () => {
    const g = roboto.glyph("o".codePointAt(0)!);
    // 'o' is a ring: an outer contour plus one hole.
    expect(g.contours.length).toBe(2);
    expect(g.advanceWidth).toBeGreaterThan(0);
    for (const c of g.contours) expect(c.length).toBeGreaterThanOrEqual(3);
  });

  it("gives a blank glyph but real advance for the space character", () => {
    const space = roboto.glyph(" ".codePointAt(0)!);
    expect(space.contours.length).toBe(0);
    expect(space.advanceWidth).toBeGreaterThan(0);
  });

  it("resolves composite glyphs (accented letters)", () => {
    // 'é' is composed from 'e' + an acute accent component.
    const plain = roboto.glyph("e".codePointAt(0)!);
    const accented = roboto.glyph("é".codePointAt(0)!);
    expect(accented.contours.length).toBeGreaterThan(plain.contours.length);
  });

  it("returns the .notdef outline (gid 0) for unmapped codepoints", () => {
    const missing = roboto.glyph(0x10ffff);
    expect(missing.advanceWidth).toBeGreaterThanOrEqual(0);
  });

  it("flattens curves more finely at higher curveSteps", () => {
    const coarse = roboto.glyph("o".codePointAt(0)!, 1);
    const fine = roboto.glyph("o".codePointAt(0)!, 12);
    const count = (g: typeof coarse) => g.contours.reduce((n, c) => n + c.length, 0);
    expect(count(fine)).toBeGreaterThan(count(coarse));
  });

  it("reads GPOS pair kerning, tightening a known pair like AV", () => {
    const av = roboto.kerning("A".codePointAt(0)!, "V".codePointAt(0)!);
    expect(av).toBeLessThan(0);
    // A pair with no kerning rule (or a font with no GPOS/kern feature) is 0,
    // never undefined/NaN — callers can always add it straight into advance.
    const nn = roboto.kerning("n".codePointAt(0)!, "n".codePointAt(0)!);
    expect(nn).toBe(0);
  });

  it("rejects non-TrueType data", () => {
    const otto = new Uint8Array([0x4f, 0x54, 0x54, 0x4f, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => parseFont(otto)).toThrow(/CFF|OpenType|\.otf/);
    const garbage = new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(() => parseFont(garbage)).toThrow(/not a TrueType/);
  });
});
