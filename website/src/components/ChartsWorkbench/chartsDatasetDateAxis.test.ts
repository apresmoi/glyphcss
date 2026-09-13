// AGENTS.md's "Charts" ("Data layer") — item 4: every date-bearing dataset,
// rendered through the REAL `renderGlyphChart`, at a spread of widths, with
// a real d3 multi-scale time axis (never a raw ISO/epoch string truncated
// to fit). See the finding recorded in AGENTS.md/docs/design/charts.md: a
// date COLUMN is a plain ISO STRING (JSON has no `Date`), and
// `inferGlyphChartScaleType` (Plot's own rule) infers a bare string as
// `band`, not `time` — so the x scale here is EXPLICITLY `{ type: "time" }`,
// exactly what `chartsWorkbenchState.ts`'s dataset-apply flow now sets
// whenever the profiled x column is `type: "date"` (`dataProfile.ts`).
// Without that explicit type, this same render prints truncated raw ISO
// text ("2010-…", "201…") instead of "2011"/"April" — reproduced and killed
// off in the second describe block below.
import { describe, expect, it } from "vitest";
import { glyphChartArea, glyphChartLine, glyphChartPlot, renderGlyphChart, type GlyphChartSpec } from "@glyphcss/charts";
import { findChartsDataset } from "./datasets";

const WIDTHS = [40, 72, 96, 140] as const;

function xAxisLabelRow(text: string): string {
  // The x tick-label row is always the LAST non-empty row of the grid —
  // every `buildSpec` below passes `axes.x.title: ""` specifically so
  // there's no x-axis TITLE row underneath it to confuse this (AGENTS.md's
  // "Charts": an explicit title, "" included, always shows/suppresses
  // regardless of size, where the un-suppressed default would print the
  // channel's own field name — "year"/"month" — as one more row below the
  // labels this test actually wants).
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.trim() !== "") return lines[i]!;
  }
  return "";
}
function labelsOf(row: string): string[] {
  return row.trim().split(/\s+/).filter(Boolean);
}
function looksLikeRawDate(label: string): boolean {
  // A raw ISO string or truncation of one ("2010-01-01T00:00:00.000Z",
  // "2010-…", "201…") or a bare epoch-millisecond number — none of which a
  // real d3 time-scale tick format ever produces (that's always a
  // year/month/day/time-of-day fragment: "2011", "April", "Jul 12", "14:00").
  return /^\d{4}-\d{2}(-\d{2})?/.test(label) || /T\d{2}:\d{2}/.test(label) || /^\d{10,}$/.test(label) || label.includes("…") && /^\d/.test(label);
}

interface Case { readonly id: string; readonly x: string; readonly y: string; readonly buildSpec: (data: readonly Record<string, unknown>[], x: string, y: string) => GlyphChartSpec }
const CASES: readonly Case[] = [
  { id: "global-temperature", x: "year", y: "anomaly_c", buildSpec: (data, x, y) => glyphChartPlot({ marks: [glyphChartLine(data, { x, y })], title: "Global temperature anomaly", scales: { x: { type: "time" } }, axes: { x: { title: "" } } }) },
  { id: "co2-mauna-loa", x: "month", y: "co2_ppm", buildSpec: (data, x, y) => glyphChartPlot({ marks: [glyphChartLine(data, { x, y })], title: "Atmospheric CO2", scales: { x: { type: "time" } }, axes: { x: { title: "" } } }) },
  { id: "us-unemployment", x: "month", y: "unemployment_rate", buildSpec: (data, x, y) => glyphChartPlot({ marks: [glyphChartArea(data, { x, y })], title: "US unemployment rate", scales: { x: { type: "time" } }, axes: { x: { title: "" } } }) },
  { id: "treasury-yield-10y", x: "date", y: "yield_10y_pct", buildSpec: (data, x, y) => glyphChartPlot({ marks: [glyphChartLine(data, { x, y })], title: "US 10-year Treasury yield", scales: { x: { type: "time" } }, axes: { x: { title: "" } } }) },
];

describe("date-bearing datasets render a real time axis at every preset width", () => {
  for (const { id, x, y, buildSpec } of CASES) {
    const dataset = findChartsDataset(id)!;
    const spec = buildSpec(dataset.rows, x, y);

    for (const width of WIDTHS) {
      it(`${id} at ${width} cols: multi-scale labels, no raw date/epoch text, no consecutive duplicate`, () => {
        const result = renderGlyphChart(spec, { target: "chat", width, height: 24 });
        const labels = labelsOf(xAxisLabelRow(result.text));
        expect(labels.length).toBeGreaterThan(0);
        for (const label of labels) expect(looksLikeRawDate(label)).toBe(false);
        for (let i = 1; i < labels.length; i++) expect(labels[i]).not.toBe(labels[i - 1]);
      });
    }

    it(`${id} at 40 cols: at least 2 x-axis tick labels survive`, () => {
      const result = renderGlyphChart(spec, { target: "chat", width: 40, height: 24 });
      expect(labelsOf(xAxisLabelRow(result.text)).length).toBeGreaterThanOrEqual(2);
    });
  }
});

describe("96-col renders (eyeball snapshots)", () => {
  for (const { id, x, y, buildSpec } of CASES) {
    it(`${id}`, () => {
      const dataset = findChartsDataset(id)!;
      const spec = buildSpec(dataset.rows, x, y);
      const result = renderGlyphChart(spec, { target: "chat", width: 96, height: 24 });
      expect(result.text).toMatchSnapshot();
    });
  }
});

// ── The finding, reproduced and pinned ─────────────────────────────────
describe("a date column left on the default (auto) x scale is NOT a time axis", () => {
  it("infers 'band' for ISO-string x values, printing truncated raw text instead of d3 date labels", () => {
    const dataset = findChartsDataset("global-temperature")!;
    // No explicit `scales.x.type` — reproduces what an un-fixed dataset-
    // apply flow would have produced (see this file's header comment).
    const spec = glyphChartPlot({ marks: [glyphChartLine(dataset.rows, { x: "year", y: "anomaly_c" })], title: "t", axes: { x: { title: "" } } });
    const result = renderGlyphChart(spec, { target: "chat", width: 96, height: 24 });
    const labels = labelsOf(xAxisLabelRow(result.text));
    // At least one surviving label is still a raw/truncated ISO fragment —
    // the defect this file's real cases (which DO pass `scales.x.type:
    // "time"`) are required to avoid.
    expect(labels.some(looksLikeRawDate)).toBe(true);
  });
});
