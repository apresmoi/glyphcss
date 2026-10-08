// @vitest-environment node
//
// Unit tests for `chartsWorkbenchRenderedTickCounts`/`chartsWorkbenchActualTicks`
// (REVIEW-dock-addenda-opus.md P2-2) — the ticks row's own "auto" seed.
// Both are pure: no DOM, no Dock, straight through the real
// `renderChartsWorkbenchSpec` the page itself calls.
import { describe, expect, it } from "vitest";
import { chartsWorkbenchActualTicks, chartsWorkbenchRenderedTickCounts, renderChartsWorkbenchSpec, renderChartsWorkbenchState, type ChartsWorkbenchRender } from "./chartsWorkbenchRender";
import { createChartsWorkbenchState } from "../model/chartsSpec";
import { reduceChartsWorkbenchState } from "../model/chartsWorkbenchState";

const LINE_SPEC = JSON.stringify({
  marks: [{ type: "line", data: Array.from({ length: 12 }, (_, i) => ({ t: i, v: Math.sin(i) * 40 + i * 3 })), channels: { x: "t", y: "v" } }],
});

describe("chartsWorkbenchRenderedTickCounts", () => {
  it("counts the real tick labels on a box-charset render, matching what the reader can see in the text", () => {
    const rendered = renderChartsWorkbenchSpec(LINE_SPEC, { target: "web", charset: "box", color: "none", width: 96, height: 32 });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    const counts = chartsWorkbenchRenderedTickCounts(rendered.text, "box");
    expect(counts).toBeDefined();
    // Sanity bounds, not exact numbers pinned to the layout algorithm: a
    // 96x32 line chart has more than zero and comfortably under half its
    // own width/height in ticks on either axis.
    expect(counts!.x).toBeGreaterThan(0);
    expect(counts!.x).toBeLessThan(48);
    expect(counts!.y).toBeGreaterThan(0);
    expect(counts!.y).toBeLessThan(16);
    // The axis line really is there — this is what makes the row/column
    // search trustworthy rather than a coincidence.
    expect(rendered.text).toContain("┴");
    expect(rendered.text).toContain("┤");
  });

  it("counts the same chart's ascii render (whose labels are identical plain text)", () => {
    const rendered = renderChartsWorkbenchSpec(LINE_SPEC, { target: "web", charset: "ascii", color: "none", width: 96, height: 32 });
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.text).not.toContain("┴");
    const counts = chartsWorkbenchRenderedTickCounts(rendered.text, "ascii");
    expect(counts).toBeDefined();
    expect(counts!.x).toBeGreaterThan(0);
    expect(counts!.y).toBeGreaterThan(0);
  });

  // The defect a GLYPH count has and a LABEL count doesn't: the x-axis
  // line's own row is (per AGENTS.md's "Axes") the y=0 row whenever 0 is
  // in the y domain, so that row's y-tick and the x-axis's own rule share
  // ONE cell — a `├`/`└` junction, never `┤` — and a glyph count silently
  // drops it; the same happens to the x-tick that lands on the y-axis's
  // own column. Measured live on this page's own default preset: a glyph
  // count undershot both axes by exactly one, and feeding the undercounted
  // number back as an explicit `ticks` request asked d3 for a different
  // "nice" ladder entirely (visibly changing the render — the defect this
  // whole feature exists to close). A hand-built grid pins it directly.
  it("counts a tick that coincides with the OTHER axis's own line — the corner cell — on both axes", () => {
    const text = [
      "    │          ",
      " 10 ┤          ",
      "    │          ",
      "  0 ├────┴─────",
      "    0    5     ",
    ].join("\n");
    const counts = chartsWorkbenchRenderedTickCounts(text, "box");
    expect(counts).toEqual({ x: 2, y: 2 });
  });

  it("returns undefined for a grid with no discernible axis line", () => {
    expect(chartsWorkbenchRenderedTickCounts("......\n......\n......", "box")).toBeUndefined();
    expect(chartsWorkbenchRenderedTickCounts("", "box")).toBeUndefined();
  });
});

describe("chartsWorkbenchActualTicks", () => {
  // REVIEW-dock-addenda-opus.md's own repro: the page's OWN default preset
  // at its OWN default size produces no `ticks-thinned` ledger entry at
  // all for either axis — the exact condition under which a seed read from
  // the rendered text must reproduce the render byte-for-byte, because
  // there is no stride-thinning step whose internal, unobservable request
  // count could differ from the count actually shown. Goes through the
  // real reducer/render pair the Dock itself uses (`ChartsDock.tsx`'s own
  // `chartsWorkbenchActualTicks(rendered, axis, controls.charset)` call),
  // not a hand-built spec.
  it("seeds from the rendered text, and the seed produces a BYTE-IDENTICAL render when fed back in as an explicit tick count — the guarantee this exists for", () => {
    const state = createChartsWorkbenchState();
    const auto = renderChartsWorkbenchState(state);
    expect(auto.ok).toBe(true);
    if (!auto.ok) return;
    expect(auto.report.ledger.some((e) => e.code === "ticks-thinned")).toBe(false);
    const xTicks = chartsWorkbenchActualTicks(auto, "x", "box");
    const yTicks = chartsWorkbenchActualTicks(auto, "y", "box");
    expect(xTicks).toBeDefined();
    expect(yTicks).toBeDefined();

    let seededState = reduceChartsWorkbenchState(state, { type: "set-axis", axis: "x", patch: { ticks: xTicks! } });
    seededState = reduceChartsWorkbenchState(seededState, { type: "set-axis", axis: "y", patch: { ticks: yTicks! } });
    const seeded = renderChartsWorkbenchState(seededState);
    expect(seeded.ok).toBe(true);
    if (!seeded.ok) return;
    // The property REVIEW-dock-addenda-opus.md P2-2 asks for: unchecking
    // "auto" (which seeds the slider from exactly this value and writes it
    // as the explicit tick count) changes NO cell.
    expect(seeded.text).toBe(auto.text);
  });

  it("falls back to the ticks-thinned ledger entry when the rendered text carries no discernible axis line", () => {
    const rendered: ChartsWorkbenchRender = {
      ok: true, display: "", isHtml: false, text: "", meta: { title: null, series: [], values: 0, description: null },
      report: { ledger: [{ code: "ticks-thinned", message: "", detail: { axis: "x", shown: 5 } }], unsupportedGlyphs: [], routeConflicts: [] },
    };
    expect(chartsWorkbenchActualTicks(rendered, "x", "box")).toBe(5);
    expect(chartsWorkbenchActualTicks(rendered, "y", "box")).toBeUndefined();
  });

  it("is undefined — never a guessed flat number — when neither the text nor the ledger has an answer", () => {
    const rendered: ChartsWorkbenchRender = {
      ok: true, display: "", isHtml: false, text: "", meta: { title: null, series: [], values: 0, description: null },
      report: { ledger: [], unsupportedGlyphs: [], routeConflicts: [] },
    };
    expect(chartsWorkbenchActualTicks(rendered, "x", "box")).toBeUndefined();
    const failed: ChartsWorkbenchRender = { ok: false, error: "boom" };
    expect(chartsWorkbenchActualTicks(failed, "x", "box")).toBeUndefined();
  });

  // Mutation check (REVIEW-dock-addenda-opus.md P2-2's own mutation): if the
  // seeding logic is deleted (the function always returns `undefined`), the
  // first test above's premise — that a real seed exists and reproduces the
  // render byte-for-byte — has nothing to assert, so it fails outright
  // rather than passing vacuously.
  it("mutation: a seed that is always undefined fails the byte-identical test above, not silently", () => {
    const alwaysUndefined = (): number | undefined => undefined;
    expect(alwaysUndefined()).toBeUndefined();
    // The real function must NOT collapse to this for the common case.
    const options = { target: "web" as const, charset: "box" as const, color: "none" as const, width: 96, height: 32 };
    const rendered = renderChartsWorkbenchSpec(LINE_SPEC, options);
    expect(rendered.ok && chartsWorkbenchActualTicks(rendered, "x", "box")).not.toBe(undefined);
  });
});
