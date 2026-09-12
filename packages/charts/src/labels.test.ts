import { describe, expect, it } from "vitest";
import { glyphChartLabelLayout } from "./labels";

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
});
