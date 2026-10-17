import { describe, expect, it } from "vitest";
import { chartText, glyphChartLabelLayout } from "./labels";
import type { GlyphChartLedgerEntry } from "./ledger";

describe("chartText folding notes", () => {
  it.each(["ascii", "box", "blocks", "braille"] as const)("reports unsupported graphemes on %s without changing the fold", (charset) => {
    const ledger: GlyphChartLedgerEntry[] = [];
    const before = "東京 👩‍💻 e\u0301";
    const after = chartText(before, charset);
    expect(chartText(before, charset, { ledger, role: "label" })).toBe(after);
    expect(after).toBe("?? ? e");
    expect(ledger).toEqual([expect.objectContaining({ code: "label-folded", detail: { role: "label", before, after } })]);
  });

  it("reports ASCII substitutions but preserves supported box text and ignores trailing space", () => {
    const ledger: GlyphChartLedgerEntry[] = [];
    const note = { ledger, role: "label" };
    expect(chartText("Café · µ…", "box", note)).toBe("Café · µ…");
    expect(chartText("plain  ", "box", note)).toBe("plain");
    expect(ledger).toEqual([]);
    expect(chartText("Café · µ…", "ascii", note)).toBe("Cafe - u...");
    expect(ledger).toEqual([expect.objectContaining({ code: "label-folded", detail: { role: "label", before: "Café · µ…", after: "Cafe - u..." } })]);
  });

  it("does not repeat a note when the same label is measured again", () => {
    const ledger: GlyphChartLedgerEntry[] = [];
    for (let i = 0; i < 3; i++) chartText("東京", "box", { ledger, role: "label" });
    expect(ledger).toHaveLength(1);
  });
});

describe("glyphChartLabelLayout", () => {
  // Gate: "labels never overflow the viewport; a designed long label is
  // abbreviated and appears in the ledger" (mutation: allow overflow, i.e.
  // skip the abbreviate() call and place the label as-authored -> the
  // bounds assertion below reddens because the placed label would run past
  // column `cols - 1`).
  it("abbreviates a label wider than the viewport and never overflows it", () => {
    const result = glyphChartLabelLayout(
      [{ id: "long", x: 5, y: 0, text: "a very long label that will not fit" }],
      { obstacles: [], viewport: { cols: 10, rows: 3 } },
    );
    expect(result.placed).toHaveLength(1);
    const label = result.placed[0]!;
    expect(label.x).toBeGreaterThanOrEqual(0);
    expect(label.x + label.text.length - 1).toBeLessThan(10);
    expect(label.abbreviated).toBe(true);
    expect(result.ledger.some((entry) => entry.code === "label-abbreviated")).toBe(true);
  });

  it("abbreviates a numeric label with an SI prefix before truncating", () => {
    const result = glyphChartLabelLayout(
      [{ id: "n", x: 2, y: 0, text: "1234567", priority: 1 }],
      { obstacles: [], viewport: { cols: 6, rows: 1 } },
    );
    // Mutation: truncate digits instead of using SI -> content differs.
    expect(result.placed[0]!.text).toBe("1.2M");
  });

  it("leaves a label that already fits untouched", () => {
    const result = glyphChartLabelLayout(
      [{ id: "ok", x: 2, y: 0, text: "hi" }],
      { obstacles: [], viewport: { cols: 20, rows: 3 } },
    );
    expect(result.placed[0]).toMatchObject({ text: "hi", abbreviated: false });
  });

  it("dodges an obstacle in the same row rather than overlapping it", () => {
    const result = glyphChartLabelLayout(
      [{ id: "dodge", x: 5, y: 0, text: "hi" }],
      { obstacles: [{ x0: 4, y0: 0, x1: 6, y1: 0 }], viewport: { cols: 20, rows: 1 } },
    );
    expect(result.placed).toHaveLength(1);
    const l = result.placed[0]!;
    expect(l.x > 6 || l.x + l.text.length - 1 < 4).toBe(true);
  });

  it("higher-priority candidates are placed first and claim the obstacle list", () => {
    const result = glyphChartLabelLayout(
      [
        { id: "low", x: 0, y: 0, text: "lo", priority: 0 },
        { id: "high", x: 0, y: 0, text: "hi", priority: 10 },
      ],
      { obstacles: [], viewport: { cols: 20, rows: 1 } },
    );
    expect(result.placed[0]!.id).toBe("high");
  });

  // codex P2-11: a scaled label whose whole `scale`-row box overflows the
  // viewport's height was silently pushed to `dropped` with no
  // `report.ledger` entry — every OTHER drop reason in this function
  // (width overflow, no free space, numeric overflow) logs one. Mutation:
  // revert the height-bounds branch to `{ dropped.push(c.id); continue; }`
  // with no ledger push -> this goes red.
  it("logs a label-dropped ledger entry when a scaled label's box overflows the viewport height", () => {
    const result = glyphChartLabelLayout(
      [{ id: "a", x: 0, y: 9, text: "AAA", scale: 2 }],
      { obstacles: [], viewport: { cols: 40, rows: 10 } },
    );
    expect(result.placed).toHaveLength(0);
    expect(result.dropped).toEqual(["a"]);
    expect(result.ledger.some((entry) => entry.code === "label-dropped")).toBe(true);
  });
});
