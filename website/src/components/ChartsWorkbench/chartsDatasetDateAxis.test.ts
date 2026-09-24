// AGENTS.md's "Charts" ("Data layer") — item 4: every date-bearing dataset,
// rendered through the REAL `renderGlyphChart`, at a spread of widths, with
// a real d3 multi-scale time axis (never a raw ISO/epoch string truncated
// to fit). The finding behind it: a
// date COLUMN is a plain ISO STRING (JSON has no `Date`), and
// `inferGlyphChartScaleType` used to infer a bare string as `band`
// regardless of its content, so `chartsWorkbenchState.ts`'s dataset-apply
// flow set an EXPLICIT `scales.x.type: "time"` whenever the profiled x
// column was `type: "date"` (`dataProfile.ts`) as a workaround. The
// inference itself is now fixed at the library level (`@glyphcss/charts`'
// own "ONE extra library item"): a column whose every string value is a
// calendar-valid ISO date infers `time` with no explicit type needed, so
// the CLI/JSON path gets the same real date ticks the page always did.
// This file's own cases below all still pass the explicit type (so they
// stay byte-identical whichever layer is doing the inferring), and the
// final describe block pins the FIXED behaviour rather than the old defect.
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

// ── The finding, now fixed at the library level ─────────────────────────
describe("a date column left on the default (auto) x scale IS now a time axis", () => {
  it("infers 'time' for ISO-string x values with no explicit scales.x.type, printing real d3 date labels", () => {
    const dataset = findChartsDataset("global-temperature")!;
    // No explicit `scales.x.type` — this is exactly what an un-fixed
    // dataset-apply flow (skipping `chartsDataSource.ts`'s `xChannelIsDate`
    // workaround) would produce; `inferGlyphChartScaleType` now reads the
    // column's own ISO-date-shaped strings as `time` on its own.
    const spec = glyphChartPlot({ marks: [glyphChartLine(dataset.rows, { x: "year", y: "anomaly_c" })], title: "t", axes: { x: { title: "" } } });
    const result = renderGlyphChart(spec, { target: "chat", width: 96, height: 24 });
    const labels = labelsOf(xAxisLabelRow(result.text));
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) expect(looksLikeRawDate(label)).toBe(false);
  });

  it("renders byte-identically to the same spec with the explicit scales.x.type: 'time' override", () => {
    const dataset = findChartsDataset("global-temperature")!;
    const auto = glyphChartPlot({ marks: [glyphChartLine(dataset.rows, { x: "year", y: "anomaly_c" })], title: "t", axes: { x: { title: "" } } });
    const explicit = { ...auto, scales: { x: { type: "time" as const } } };
    expect(renderGlyphChart(auto, { target: "chat", width: 96, height: 24 }).text).toBe(
      renderGlyphChart(explicit, { target: "chat", width: 96, height: 24 }).text,
    );
  });
});
