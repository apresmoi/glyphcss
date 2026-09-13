// @vitest-environment node
//
// P1-3 (CHARTS-RESEARCH `REVIEW-batch4-codex.md`, confirmed by
// `-fable.md` F-P1-5) + P2-1 (`-fable.md`): Density's own `textScale`
// only reached the rendered `<pre>` when `color: "css"` was requested —
// every other colour mode fell back to the plain grid join / ANSI decode,
// neither of which carries the `.glyph-text` scaled-text markup, so a
// reader's title/ticks/legend shrank right along with the marks under
// Density outside `css`. Pins `renderChartsWorkbenchState`'s fix directly
// (not through the DOM — `chartsWorkbenchTargetMatrix.test.tsx` covers the
// mounted page) and the non-integer-density em correction alongside it.
import { describe, expect, it } from "vitest";
import { renderChartsWorkbenchState } from "./chartsWorkbenchRender";
import { createChartsWorkbenchState, CHART_COLORS, type ChartsWorkbenchState } from "./chartsWorkbenchState";

function stateAtDensity(density: number, color: ChartsWorkbenchState["controls"]["overrides"]["color"]): ChartsWorkbenchState {
  const base = createChartsWorkbenchState();
  return { ...base, controls: { target: "web", overrides: { ...base.controls.overrides, color, density } } };
}

describe("renderChartsWorkbenchState — Density text scale across every colour mode (P1-3)", () => {
  for (const color of CHART_COLORS) {
    it(`web / density 2 / ${color} carries scaled text markup`, () => {
      const rendered = renderChartsWorkbenchState(stateAtDensity(2, color));
      expect(rendered.ok).toBe(true);
      if (!rendered.ok) return;
      expect(rendered.isHtml, `color=${color}`).toBe(true);
      expect(rendered.display, `color=${color}`).toContain("glyph-text");
      expect(rendered.display, `color=${color}`).toContain("font-size:2em");
    });
  }

  it("density 1 (no textScale) never re-renders — every non-css mode stays plain, byte-identical to before this fix", () => {
    for (const color of CHART_COLORS) {
      const rendered = renderChartsWorkbenchState(stateAtDensity(1, color));
      expect(rendered.ok).toBe(true);
      if (!rendered.ok) continue;
      if (color === "css") { expect(rendered.isHtml, `color=${color}`).toBe(true); continue; }
      expect(rendered.isHtml, `color=${color}`).toBe(false);
      expect(rendered.display).not.toContain("glyph-text");
    }
  });

  it("`none` strips colour but keeps the scaled span", () => {
    const rendered = renderChartsWorkbenchState(stateAtDensity(2, "none"));
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.display).toContain("glyph-text");
    // A stripped span keeps its `font-size`/`line-height` styling only —
    // no `color:`/`background-color:` declaration survives anywhere in
    // the markup (the whole point of "none").
    expect(rendered.display).not.toMatch(/style="[^"]*(?:^|;)\s*color:#[0-9a-f]{6}/);
    expect(rendered.display).not.toContain("background-color:#");
  });

  it("`ansi16`/`ansi256` requantize colour but keep the scaled span; `truecolor` matches `css` exactly", () => {
    const truecolor = renderChartsWorkbenchState(stateAtDensity(2, "truecolor"));
    const css = renderChartsWorkbenchState(stateAtDensity(2, "css"));
    expect(truecolor.ok && css.ok).toBe(true);
    if (!truecolor.ok || !css.ok) return;
    expect(truecolor.display).toBe(css.display);

    const ansi16 = renderChartsWorkbenchState(stateAtDensity(2, "ansi16"));
    expect(ansi16.ok).toBe(true);
    if (!ansi16.ok) return;
    expect(ansi16.display).toContain("glyph-text");
    // The true `ansi` (SGR) export is still the REAL ansi16-encoded text —
    // untouched by the display-only html rebuild.
    expect(ansi16.ansi).toBeDefined();
    expect(ansi16.ansi).not.toContain("38;2;"); // ansi16 never emits truecolor escapes
  });

  it("Copy ASCII/Copy ANSI (`text`/`ansi`) are unaffected by the display rebuild — still the true requested-colour-mode text", () => {
    const none = renderChartsWorkbenchState(stateAtDensity(2, "none"));
    expect(none.ok).toBe(true);
    if (!none.ok) return;
    // The plain `text` field is the RAW dense grid join (Copy ASCII's
    // logical-density correction lives in `ChartsWorkbench.tsx`, not
    // here) — it must still contain no HTML markup at all.
    expect(none.text).not.toContain("<span");
  });

  it("P2-1: a fractional density (1.5) lands the scaled span at its own exact em, not the rounded textScale", () => {
    const rendered = renderChartsWorkbenchState(stateAtDensity(1.5, "none"));
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.display).toContain("glyph-text");
    // `textScale` (the library's own integer layout unit) is `round(1.5)
    // === 2`, so the RESERVED box is still 2 cells — but the painted em
    // must read the fractional density itself, not the rounded 2.
    expect(rendered.display).toContain("font-size:1.5em");
    expect(rendered.display).toContain("line-height:calc(1 / 1.5)");
    expect(rendered.display).not.toContain("font-size:2em");
  });

  it("P2-1: an integer density (3) needs no correction — the baked textScale em already matches", () => {
    const rendered = renderChartsWorkbenchState(stateAtDensity(3, "css"));
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) return;
    expect(rendered.display).toContain("font-size:3em");
    expect(rendered.display).toContain("line-height:calc(1 / 3)");
  });
});
