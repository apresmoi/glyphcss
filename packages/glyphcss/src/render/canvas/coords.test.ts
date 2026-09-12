import { describe, expect, it } from "vitest";
import { createGlyphCanvas } from "./canvas";

/**
 * `text()` and `arrowhead()` address exactly one cell each (an anchor, a
 * tip) — the same shape of input `fillRect`'s integer-coordinate check
 * already guards. Before this, a fractional `y` silently displaced the
 * write by `y_frac * cols` columns and could wrap it onto a different row
 * (`text(0, 0.5, ["ab"])` on a 6-wide canvas landed on row 1, not row 0) —
 * a continuous-scale input (`y = scale(value)`, unrounded) producing a
 * plausible-looking wrong render instead of a loud failure. `line()` is
 * deliberately NOT covered here: its endpoints are documented sub-cell
 * quantities (see `walkGlyphCanvasLine` in `canvas.ts`).
 */
describe("text() and arrowhead() require integer cell coordinates", () => {
  it("text() throws a RangeError for a fractional y (mutation: drop the guard -> the round-3 opus repro lands on the wrong row)", () => {
    const canvas = createGlyphCanvas({ cols: 6, rows: 3, tier: "box" });
    expect(() => canvas.text(0, 0.5, ["ab"], { color: "#ff0000" })).toThrow(RangeError);
  });

  it("text() throws a RangeError for a fractional x", () => {
    const canvas = createGlyphCanvas({ cols: 6, rows: 3, tier: "box" });
    expect(() => canvas.text(0.5, 0, ["ab"])).toThrow(RangeError);
  });

  it("text() throws a RangeError for a NaN coordinate", () => {
    const canvas = createGlyphCanvas({ cols: 6, rows: 3, tier: "box" });
    expect(() => canvas.text(0, NaN, ["ab"])).toThrow(RangeError);
    expect(() => canvas.text(NaN, 0, ["ab"])).toThrow(RangeError);
  });

  it("arrowhead() throws a RangeError for a fractional y", () => {
    const canvas = createGlyphCanvas({ cols: 6, rows: 3, tier: "box" });
    expect(() => canvas.arrowhead(0, 0.5, "e")).toThrow(RangeError);
  });

  it("arrowhead() throws a RangeError for a fractional x", () => {
    const canvas = createGlyphCanvas({ cols: 6, rows: 3, tier: "box" });
    expect(() => canvas.arrowhead(1.5, 0, "e")).toThrow(RangeError);
  });

  it("arrowhead() throws a RangeError for a NaN coordinate", () => {
    const canvas = createGlyphCanvas({ cols: 6, rows: 3, tier: "box" });
    expect(() => canvas.arrowhead(NaN, 0, "e")).toThrow(RangeError);
  });

  it("neither painter's guard leaks a fractional key onto the shared grid buffers", () => {
    const canvas = createGlyphCanvas({ cols: 6, rows: 3, tier: "box" });
    try {
      canvas.text(0, 0.5, ["ab"]);
    } catch {
      // expected — the assertion below is that nothing was written first.
    }
    try {
      canvas.arrowhead(1.5, 0, "e");
    } catch {
      // expected
    }
    for (const key of Object.keys(canvas.grid.char)) {
      expect(/^\d+$/.test(key)).toBe(true);
    }
  });

  it("line() is unaffected: fractional sub-cell endpoints remain a documented, accepted contract", () => {
    const canvas = createGlyphCanvas({ cols: 3, rows: 1, tier: "ascii" });
    expect(() => canvas.line({ x: 0.49, y: 0 }, { x: 1.51, y: 0 })).not.toThrow();
  });
});
