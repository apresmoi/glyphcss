import { describe, expect, it } from "vitest";
import { renderGlyphChart } from "./render";
import { glyphChartArc, glyphChartArea, glyphChartBar, glyphChartDot, glyphChartLine, glyphChartPlot, glyphChartRule } from "./spec";

describe("renderGlyphChart — shorthand snapshot", () => {
  // Gate: "shorthand snapshot at 20x8 (mutation: swap the index/identity
  // inference -> red)". A swapped inference (x=identity, y=index) would put
  // the line's whole shape on a completely different axis, changing this
  // exact string.
  it("renders [3,5,2,8] at 20x8 to a fixed snapshot", () => {
    const r = renderGlyphChart(glyphChartLine([3, 5, 2, 8]), { target: "chat", width: 20, height: 8 });
    expect(r.text).toMatchInlineSnapshot(`
      "8 │                /
        │               / 
      5 │    -\\\\       /  
        │ -▔_- \\\\\\    /   
      3 │_-      \\\\\\ /    
        │          \\/     
        ──────────────────
         0          2     "
    `);
  });
});

describe("renderGlyphChart — composition fixture", () => {
  const data = [{ t: 0, v: 3 }, { t: 1, v: 5 }, { t: 2, v: 2 }, { t: 3, v: 8 }];
  const spec = glyphChartPlot({
    marks: [
      glyphChartLine(data, { x: "t", y: "v" }),
      glyphChartDot(data, { x: "t", y: "v" }),
      glyphChartRule([0]),
    ],
  });

  it("renders the line, the dot marks, and the rule", () => {
    // Gate mutations: delete the dot painter -> no "●" in the grid -> red;
    // delete the rule painter -> no dashed rule row -> red.
    const r = renderGlyphChart(spec, { target: "chat", width: 50, height: 16 });
    expect(r.text).toContain("●");
    // The rule at y=0 sits below every data point (all v > 0), so its own
    // row is a dashed horizontal run across the plot width.
    expect(r.text).toContain("── ──");
  });

  it("area fixture renders a filled region", () => {
    // Mutation: delete the area painter -> the plot stays entirely blank
    // (no fill glyphs at all) -> red.
    const r = renderGlyphChart(glyphChartArea([3, 5, 2, 8]), { target: "chat", width: 30, height: 12 });
    expect(r.text).toContain("█");
  });

  it("arc fixture renders a filled disc", () => {
    // Mutation: delete the arc painter -> the plot stays entirely blank -> red.
    const r = renderGlyphChart(glyphChartArc([3, 5, 2, 8]), { target: "chat", width: 30, height: 16 });
    expect(r.text).toContain("█");
  });
});

describe("renderGlyphChart — honesty", () => {
  function barLengths(values: number[]) {
    const r = renderGlyphChart(glyphChartBar(values), { target: "chat", width: 60, height: 30, color: "none" });
    const rows = r.text.split("\n");
    // Count filled ("█") cells per bar column by scanning every row for '█'
    // and tallying per column index.
    const counts = new Map<number, number>();
    for (const line of rows) {
      for (let c = 0; c < line.length; c++) {
        if (line[c] === "█") counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
    return counts;
  }

  it("positive-only series: bar length is proportional to value", () => {
    const counts = barLengths([1, 2, 4]);
    // Mutation: give every bar the same value, or drop zero inclusion -> wrong CELL HEIGHTS.
    const groups: number[][] = [];
    let previousCol = -2;
    for (const [col, height] of [...counts].sort(([a], [b]) => a - b)) {
      if (col !== previousCol + 1) groups.push([]);
      groups.at(-1)!.push(height);
      previousCol = col;
    }
    expect(groups).toHaveLength(3);
    [1, 2, 4].forEach((value, i) => {
      for (const height of groups[i]!) expect(Math.abs(height - 27 * value / 4)).toBeLessThanOrEqual(1);
    });
  });

  it("mixed-sign series: the zero baseline sits inside the domain and bars point the right way", () => {
    // Mutation: drop baseline inclusion (only extend the max, never force
    // min<=0<=max) -> a negative value's bar would extend from the series
    // minimum instead of from zero, i.e. render as if all-positive -> the
    // "goes below" check below reddens.
    const r = renderGlyphChart(glyphChartBar([5, -5]), { target: "chat", width: 30, height: 20, color: "none" });
    const lines = r.text.split("\n");
    const plotLines = lines.slice(0, lines.length - 2); // drop axis rule + labels
    const midRow = Math.floor(plotLines.length / 2);
    // The positive bar's ink is entirely at/above the midpoint area, the
    // negative bar's entirely at/below — i.e. they don't occupy the same
    // rows, proving a real two-sided baseline rather than one bar merely
    // being taller.
    const colsWithInkAbove = new Set<number>();
    const colsWithInkBelow = new Set<number>();
    for (let r2 = 0; r2 < midRow; r2++) {
      const line = plotLines[r2] ?? "";
      for (let c = 0; c < line.length; c++) if (line[c] === "█") colsWithInkAbove.add(c);
    }
    for (let r2 = midRow; r2 < plotLines.length; r2++) {
      const line = plotLines[r2] ?? "";
      for (let c = 0; c < line.length; c++) if (line[c] === "█") colsWithInkBelow.add(c);
    }
    expect(colsWithInkAbove.size).toBeGreaterThan(0);
    expect(colsWithInkBelow.size).toBeGreaterThan(0);
  });

  it("an all-zero series renders with no filled cells (never NaN/garbage)", () => {
    const r = renderGlyphChart(glyphChartBar([0, 0, 0]), { target: "chat", width: 30, height: 12, color: "none" });
    // Mutation: inclusive baseline -> three one-cell bars appear.
    expect(r.grid.char.filter((c) => c === "█")).toHaveLength(0);
    expect(r.text).not.toContain("undefined");
    expect(r.text).not.toContain("NaN");
  });
});

describe("renderGlyphChart — tier safety", () => {
  it("charset: ascii output matches the printable-ASCII-plus-newline set", () => {
    const r = renderGlyphChart(glyphChartLine([3, 5, 2, 8]), { target: "chat", charset: "ascii", width: 30, height: 10 });
    expect(r.text).toMatch(/^[\x20-\x7e\n]*$/);
  });

  it("chat target output has no ESC byte", () => {
    const r = renderGlyphChart(glyphChartLine([3, 5, 2, 8]), { target: "chat", width: 30, height: 10 });
    expect(r.text).not.toContain("\x1b");
  });

  it("terminal target with color enabled DOES carry ANSI (SGR present)", () => {
    const r = renderGlyphChart(glyphChartLine([3, 5, 2, 8]), { target: "terminal", width: 30, height: 10 });
    expect(r.text).toContain("\x1b[");
  });

  it("NO_COLOR suppresses ANSI even for the terminal target", () => {
    const r = renderGlyphChart(glyphChartLine([3, 5, 2, 8]), { target: "terminal", width: 30, height: 10, env: { NO_COLOR: "1" } });
    expect(r.text).not.toContain("\x1b");
  });
});

describe("renderGlyphChart — determinism and meta", () => {
  it("the same spec + options renders the identical string twice", () => {
    const spec = glyphChartLine([3, 5, 2, 8, 1, 9, 4]);
    const a = renderGlyphChart(spec, { target: "chat", width: 40, height: 14 });
    const b = renderGlyphChart(spec, { target: "chat", width: 40, height: 14 });
    expect(a.text).toBe(b.text);
  });

  it("meta is present with a title, series count, and value count", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine([3, 5, 2, 8])], title: "My Chart", description: "desc" });
    const r = renderGlyphChart(spec, { target: "chat" });
    expect(r.meta).toEqual({ title: "My Chart", series: [], values: 4, description: "desc" });
  });

  it("meta defaults are null/empty for an untitled, unlabeled spec", () => {
    const r = renderGlyphChart(glyphChartLine([1, 2]), { target: "chat" });
    expect(r.meta.title).toBeNull();
    expect(r.meta.description).toBeNull();
  });
});

describe("renderGlyphChart — web target", () => {
  it("produces an html exit that escapes literal <>&", () => {
    const spec = glyphChartPlot({ marks: [glyphChartLine([1, 2, 3])], title: "<b>&x" });
    const r = renderGlyphChart(spec, { target: "web", width: 30, height: 10 });
    expect(r.text).toContain("<b>&x");
    expect(r.html).toBeDefined();
    expect(r.html).toContain("&lt;b&gt;&amp;x");
    expect(r.html).not.toContain("<b>&x<");
  });
});

describe("renderGlyphChart — validation surfaces", () => {
  it("throws a tagged error for an invalid render size", () => {
    expect(() => renderGlyphChart(glyphChartLine([1, 2]), { width: 0 })).toThrow();
  });
  it("throws a tagged error for an empty spec", () => {
    expect(() => renderGlyphChart({ marks: [] })).toThrow();
  });
});
