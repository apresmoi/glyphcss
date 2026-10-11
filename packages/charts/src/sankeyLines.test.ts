/**
 * Sankey flows as lines (`sankeyLines.ts`): bars sized by throughput, one
 * stub per row of a flow's share, a bracket gathering them into one line
 * that carries the flow's value, and a mirrored bracket at the target.
 */
import { describe, expect, it } from "vitest";
import { renderGlyphChart } from "./render";
import { glyphChartSankey } from "./spec";
import type { GlyphChartCharset, GlyphChartSpec } from "./types";

const power = [
  { from: "Coal", to: "Power", amount: 40 },
  { from: "Gas", to: "Power", amount: 60 },
  { from: "Power", to: "Homes", amount: 70 },
  { from: "Power", to: "Industry", amount: 30 },
];
const traffic = [
  { from: "Search", to: "Home", amount: 50 }, { from: "Social", to: "Home", amount: 20 }, { from: "Social", to: "Blog", amount: 15 },
  { from: "Email", to: "Blog", amount: 10 }, { from: "Home", to: "Signup", amount: 25 }, { from: "Home", to: "Pricing", amount: 30 },
  { from: "Blog", to: "Signup", amount: 12 }, { from: "Pricing", to: "Signup", amount: 14 },
];
const spec = (data: typeof power): GlyphChartSpec => ({ marks: [glyphChartSankey(data, { source: "from", target: "to", value: "amount" })] });
const render = (data: typeof power, width = 50, height = 16, charset: GlyphChartCharset = "box", extra: Partial<GlyphChartSpec> = {}) =>
  renderGlyphChart({ ...spec(data), ...extra }, { target: "chat", width, height, charset, color: "none" });
const rows = (text: string) => text.split("\n");

describe("sankey lines", () => {
  it("draws one stub per row of a source share, gathered by a bracket into one line", () => {
    // Mutation: drop the stubs, or put the bracket on the bar's own column -> red.
    const lines = rows(render(power).text);
    const coal = lines.filter((l) => l.includes("█─")).slice(0, 6);
    expect(coal.map((l) => l.slice(l.indexOf("█") + 1, l.indexOf("█") + 3))).toEqual(["─╮", "─┤", "─┼", "─┤", "─┤", "─╯"]);
  });

  it("labels every node with its name and throughput, and every flow with its value", () => {
    // Mutation: skip the value labels, or drop the outer-column gutters -> red.
    const r = render(power);
    for (const label of ["Coal 40", "Gas 60", "Power 100", "Homes 70", "Industry 30", " 40 ", " 60 ", " 70 ", " 30 "]) expect(r.text, label).toContain(label);
    expect(r.report.ledger.filter((e) => e.code === "label-dropped")).toEqual([]);
  });

  it("keeps every flow value and node label on a four-column graph with crossings and a skip-level flow", () => {
    // Mutation: bend in the middle of the gap again -> the short runs drop values.
    const r = render(traffic, 72, 24);
    expect(r.report.ledger.filter((e) => e.code === "label-dropped" || e.code === "sankey-crossings-merged")).toEqual([]);
    for (const v of [50, 20, 15, 10, 25, 30, 12, 14]) expect(r.text).toContain(` ${v} `);
    for (const n of ["Search 50", "Social 35", "Email 10", "Home 70", "Blog 25", "Pricing 30", "Signup 51"]) expect(r.text).toContain(n);
  });

  it("weights a line by the flow's share of the largest one", () => {
    const r = render(traffic, 72, 24);
    const grid = r.build.canvas.grid.char;
    // 50 is the largest flow (heavy), 25 is half of it (light), 10 a fifth (dashed).
    expect(grid).toContain("━");
    expect(grid).toContain("─");
    expect(grid).toContain("┄");
  });

  it("passes a vertical over a line it crosses", () => {
    // Mutation: paint bends before the horizontal runs -> the crossing horizontal erases the vertical.
    const text = render(traffic, 72, 24).text;
    // A vertical sits between two cells of the line it crosses only at a crossing.
    expect(text).toMatch(/[─━┄╰╭┗┏][│┃┆][─━┄]/u);
  });

  it("stays 7-bit on ascii: # bars, - = . lines, + corners", () => {
    const r = render(power, 50, 16, "ascii");
    expect(r.text).toMatch(/^[\x20-\x7e\n]*$/);
    expect(r.text).toContain("#");
    expect(r.text).toContain("=");
  });

  it("shows no legend unless asked for one", () => {
    // Mutation: drop sankey from the legend-off default -> red.
    const count = (text: string) => text.split("Coal").length - 1;
    expect(count(render(power).text)).toBe(1);
    expect(count(render(power, 50, 16, "box", { legend: true }).text)).toBe(2);
  });
});
