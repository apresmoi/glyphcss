import { describe, expect, it } from "vitest";
import {
  chartLedgerEntryFromCanvasMessage,
  ledgerDoubleDiagonalSolid,
  ledgerEmptyTotal,
  ledgerLabelAbbreviated,
  ledgerLabelDropped,
  ledgerLegendDropped,
  ledgerSeriesColorConflict,
  ledgerSeriesDodgeDegraded,
  ledgerSliceDropped,
  ledgerTickDuplicateDropped,
  ledgerTicksThinned,
  ledgerTitleDropped,
} from "./ledger";

const SAMPLES = [
  ledgerTicksThinned({ axis: "x", shown: 7, total: 13, stride: 2, band: false }),
  ledgerTicksThinned({ axis: "y", shown: 3, total: 8, stride: 3, band: true }),
  ledgerTickDuplicateDropped({ axis: "x", label: "12 PM" }),
  ledgerTitleDropped({ cols: 20, rows: 6 }),
  ledgerLegendDropped({ series: 3, cols: 40, rows: 10 }),
  ledgerSeriesDodgeDegraded({ count: 3, width: 2 }),
  ledgerSeriesColorConflict({ name: "B", kept: "#222222", rejected: "#aa1111" }),
  ledgerEmptyTotal("pie"),
  ledgerEmptyTotal("funnel"),
  ledgerSliceDropped({ dropped: 1, total: 3 }),
  ledgerSliceDropped({ dropped: 2, total: 2 }),
  ledgerDoubleDiagonalSolid({ col: 4, row: 6 }),
  ledgerLabelAbbreviated({ role: "chart title", before: "A very long chart title", after: "A very long c…" }),
  ledgerLabelAbbreviated({ role: "y-axis label", before: "1500000", after: "1.5M" }),
  ledgerLabelDropped({ role: "legend label", text: "North America", reason: "there was no free space left for it" }),
  ledgerLabelDropped({ role: "y-axis label", text: "1.5M", reason: "the number couldn't be abbreviated to fit" }),
  // Final-gate-2 review (codex #12): quoted USER TEXT (a data label, a
  // series name, ...) can legitimately contain a colon or arrow of its
  // own — a metric literally named "p95: latency" is real, authored data,
  // not this package's own generated wording. The "no colon or arrow" gate
  // exists to keep the GENERATED prose around a quoted value from turning
  // into an internal log line (`layout: dropped tick ->`), so it must
  // apply to the message with quoted spans removed, never to the raw
  // string.
  ledgerLabelDropped({ role: "data label", text: "p95: latency", reason: "no room" }),
];

/** Quoted user text is exempt from the sentence-shape checks below — see
 * the `p95: latency` sample's own comment. */
function stripQuoted(message: string): string {
  return message.replace(/"[^"]*"/g, '"…"');
}

describe("chart ledger entries read like sentences, not internal logs", () => {
  it("every message starts capitalised, ends with a period, and has no colon or arrow OUTSIDE quoted user text", () => {
    // Mutation: apply the regex to the raw `entry.message` instead of
    // `stripQuoted(entry.message)` -> the "p95: latency" sample's own
    // colon (inside its quotes) fails the match -> red.
    for (const entry of SAMPLES) expect(stripQuoted(entry.message)).toMatch(/^[A-Z][^:>]*\.$/);
  });
  it("no message has a broken ordinal (2th) — 1st/2nd/3rd are the only correct forms", () => {
    for (const entry of SAMPLES) expect(entry.message).not.toMatch(/\b[123]th\b/);
  });
  it("every code is a stable kebab id", () => {
    for (const entry of SAMPLES) expect(entry.code).toMatch(/^[a-z][a-z0-9-]*$/);
  });
  it("the numbers live in detail, not only in prose", () => {
    expect(ledgerTicksThinned({ axis: "x", shown: 7, total: 13, stride: 2, band: false }).detail).toMatchObject({ shown: 7, total: 13 });
  });
  it("reproduces the reported '13 -> 7' tick-thinning case with no internal jargon", () => {
    const entry = ledgerTicksThinned({ axis: "x", shown: 7, total: 13, stride: 2, band: false });
    expect(entry).toMatchObject({ code: "ticks-thinned", message: "Showing 7 of 13 x-axis ticks so labels don't overlap." });
  });
  it("parses the canvas's own free-text double-diagonal note into a structured entry", () => {
    const raw = 'line(): "double" style has no diagonal analogue and rendered solid starting at cell (4, 6).';
    expect(chartLedgerEntryFromCanvasMessage(raw)).toEqual(ledgerDoubleDiagonalSolid({ col: 4, row: 6 }));
  });

  it("N9: empty-total keeps arc's own pie message unchanged, and gives funnel its own distinct one — not a shared generic string", () => {
    // Round 2 generalised "chart" for both marks and silently changed what
    // an existing `arc` caller's CLI/log output printed. `code` stays
    // shared (a caller matching on it is unaffected); the wording is now a
    // required `subject` argument at each call site instead.
    expect(ledgerEmptyTotal("pie").message).toBe("Every value in this pie is zero, so no slices are drawn.");
    expect(ledgerEmptyTotal("funnel").message).toBe("Every value in this funnel is zero, so nothing is drawn.");
    expect(ledgerEmptyTotal("pie").message).not.toBe(ledgerEmptyTotal("funnel").message);
  });
});
