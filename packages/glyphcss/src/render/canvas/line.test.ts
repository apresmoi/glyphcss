import { describe, expect, it } from "vitest";
import { createGlyphCanvas } from "./canvas";
import { encodeGlyphCanvasText } from "./encode";

describe("line(): the walk visits every cell the segment's interior crosses (supercover/DDA, not a fixed sample count)", () => {
  it("MUTATION CAUGHT: a short, sub-cell-endpoint horizontal segment inks the middle cell it crosses, not just its two sampled endpoints", () => {
    // The exact round-3 repro (codex-astra finding 1 / opus P1): the old
    // walker picked `steps = round(length)` evenly-spaced samples and
    // rounded each to a cell. `(0.49, 0) -> (1.51, 0)` on a 3-wide canvas
    // rounds to samples at cell 0 and cell 2 only ("- -"), even though the
    // segment's interior passes straight through cell 1. Reverting the walk
    // to `round(length)` samples reddens this.
    const canvas = createGlyphCanvas({ cols: 3, rows: 1, tier: "ascii" });
    canvas.line({ x: 0.49, y: 0 }, { x: 1.51, y: 0 }, { style: "solid", color: "#ffffff" });
    expect(encodeGlyphCanvasText(canvas)).toBe("---");
  });

  it("a vertical equivalent inks both rows it crosses, not just the sampled endpoints", () => {
    const canvas = createGlyphCanvas({ cols: 1, rows: 2, tier: "ascii" });
    canvas.line({ x: 0, y: 0.49 }, { x: 0, y: 1.51 }, { style: "solid", color: "#ffffff" });
    expect(encodeGlyphCanvasText(canvas)).toBe("|\n|");
  });

  it("a shallow diagonal leaves no gap: every column between the endpoints is inked in at least one row", () => {
    const cols = 10;
    const canvas = createGlyphCanvas({ cols, rows: 3, tier: "box" });
    canvas.line({ x: 0.3, y: 0.2 }, { x: 9.7, y: 1.8 }, { style: "solid" });
    for (let c = 0; c < cols; c++) {
      let inked = false;
      for (let r = 0; r < 3; r++) {
        if (canvas.grid.char[r * cols + c] !== " ") inked = true;
      }
      expect(inked, `column ${c} has no inked cell`).toBe(true);
    }
  });

  it("a 45-degree diagonal visits exactly the cells a DDA visits: the diagonal run itself, no orthogonal neighbours either side of a corner crossing", () => {
    const size = 5;
    const canvas = createGlyphCanvas({ cols: size, rows: size, tier: "box" });
    canvas.line({ x: 0, y: 0 }, { x: size - 1, y: size - 1 }, { style: "solid" });
    let inkedCount = 0;
    for (let i = 0; i < size; i++) {
      expect(canvas.grid.char[i * size + i]).toBe("\\");
      inkedCount++;
    }
    expect(canvas.grid.char.filter((g) => g !== " ").length).toBe(inkedCount);
  });
});

describe("line(): dash/dot pattern is independent of occlusion", () => {
  it("MUTATION CAUGHT: occluding one cell does not shift the pattern read by every LATER cell", () => {
    // Codex round-2's repro: an unoccluded dashed run of 7 cells reads
    // "-- -- -" (period-3 dash: on, on, off, on, on, off, on). Occluding
    // ONLY the second cell must blank exactly that cell and leave every
    // other cell's pattern phase untouched — "-  -- -", not "- - -- "
    // (which is what happens when the occluded cell is skipped BEFORE the
    // pattern index advances, silently renumbering everything after it).
    const baseline = createGlyphCanvas({ cols: 7, rows: 1, tier: "ascii" });
    baseline.line({ x: 0, y: 0 }, { x: 6, y: 0 }, { style: "dashed", color: "#ffffff" });
    expect(encodeGlyphCanvasText(baseline)).toBe("-- -- -");

    const occluded = createGlyphCanvas({ cols: 7, rows: 1, tier: "ascii" });
    occluded.grid.occluded = new Uint8Array(7);
    occluded.grid.occluded[1] = 1;
    occluded.line({ x: 0, y: 0 }, { x: 6, y: 0 }, { style: "dashed", color: "#ffffff" });
    expect(encodeGlyphCanvasText(occluded)).toBe("-  -- -");
  });
});

describe("line(): \"double\" on a sloped run is a documented contract narrowing", () => {
  it("renders identically to \"solid\" on a diagonal, and records the narrowing in report.ledger", () => {
    // No font in this glyph set has a double-line diagonal — the tier
    // table's `diagonal` entries are single glyphs per raw ink shape, with
    // no doubled variant to select. Rather than throw (a chart author
    // rarely controls whether a given edge happens to be diagonal) this
    // degrades to solid and SAYS SO, once, in `report.ledger`.
    const solid = createGlyphCanvas({ cols: 4, rows: 4, tier: "box" });
    solid.line({ x: 0, y: 0 }, { x: 3, y: 3 }, { style: "solid" });

    const double = createGlyphCanvas({ cols: 4, rows: 4, tier: "box" });
    double.line({ x: 0, y: 0 }, { x: 3, y: 3 }, { style: "double" });

    expect(encodeGlyphCanvasText(double)).toBe(encodeGlyphCanvasText(solid));
    expect(double.report.ledger).toHaveLength(1);
    expect(double.report.ledger[0]).toMatch(/"double"/);
    expect(double.report.ledger[0]).toMatch(/diagonal/);
  });

  it("logs the narrowing only ONCE per line() call, not once per diagonal cell", () => {
    const canvas = createGlyphCanvas({ cols: 10, rows: 10, tier: "box" });
    canvas.line({ x: 0, y: 0 }, { x: 8, y: 8 }, { style: "double" });
    expect(canvas.report.ledger).toHaveLength(1);
  });
});

describe("line(): styled runs (mutation: ignore the requested style -> red)", () => {
  it("dashed on an axis-aligned run blanks every third cell", () => {
    const canvas = createGlyphCanvas({ cols: 7, rows: 1, tier: "ascii" });
    canvas.line({ x: 0, y: 0 }, { x: 6, y: 0 }, { style: "dashed", color: "#ffffff" });
    expect(encodeGlyphCanvasText(canvas)).toBe("-- -- -");
  });

  it("dotted on an axis-aligned run uses the tier's dot glyph and blanks every other cell", () => {
    // Dotted uses `tier.dot` ("." on ascii), not the axis-aligned straight
    // glyph ("-") — a distinct assertion from the dashed case above, which
    // DOES use the straight glyph.
    const canvas = createGlyphCanvas({ cols: 7, rows: 1, tier: "ascii" });
    canvas.line({ x: 0, y: 0 }, { x: 6, y: 0 }, { style: "dotted", color: "#ffffff" });
    expect(encodeGlyphCanvasText(canvas)).toBe(". . . .");
  });

  it("solid on an axis-aligned run paints every cell", () => {
    const canvas = createGlyphCanvas({ cols: 7, rows: 1, tier: "ascii" });
    canvas.line({ x: 0, y: 0 }, { x: 6, y: 0 }, { style: "solid", color: "#ffffff" });
    expect(encodeGlyphCanvasText(canvas)).toBe("-------");
  });

  it("dashed on a SLOPED (diagonal) run blanks every third cell along the slope, not just axis-aligned ones", () => {
    // A pure 45-degree diagonal from (0,0) to (3,3): every cell renders
    // "\\" (box's diagonal table is the identity on `inkGlyphForTangent`'s
    // own vocabulary here). Dashed blanks pattern index 3 of 4.
    const canvas = createGlyphCanvas({ cols: 4, rows: 4, tier: "box" });
    canvas.line({ x: 0, y: 0 }, { x: 3, y: 3 }, { style: "dashed" });
    expect(canvas.grid.char[0 * 4 + 0]).toBe("\\");
    expect(canvas.grid.char[1 * 4 + 1]).toBe("\\");
    expect(canvas.grid.char[2 * 4 + 2]).toBe(" ");
    expect(canvas.grid.char[3 * 4 + 3]).toBe("\\");
  });

  it("dotted on a SLOPED (diagonal) run blanks every other cell along the slope", () => {
    const canvas = createGlyphCanvas({ cols: 4, rows: 4, tier: "box" });
    canvas.line({ x: 0, y: 0 }, { x: 3, y: 3 }, { style: "dotted" });
    expect(canvas.grid.char[0 * 4 + 0]).toBe("\\");
    expect(canvas.grid.char[1 * 4 + 1]).toBe(" ");
    expect(canvas.grid.char[2 * 4 + 2]).toBe("\\");
    expect(canvas.grid.char[3 * 4 + 3]).toBe(" ");
  });

  it("solid on a SLOPED (diagonal) run paints every cell along the slope", () => {
    const canvas = createGlyphCanvas({ cols: 4, rows: 4, tier: "box" });
    canvas.line({ x: 0, y: 0 }, { x: 3, y: 3 }, { style: "solid" });
    expect(canvas.grid.char[0 * 4 + 0]).toBe("\\");
    expect(canvas.grid.char[1 * 4 + 1]).toBe("\\");
    expect(canvas.grid.char[2 * 4 + 2]).toBe("\\");
    expect(canvas.grid.char[3 * 4 + 3]).toBe("\\");
  });
});
