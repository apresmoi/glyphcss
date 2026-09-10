import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// No jsdom in this monorepo (vitest.config.ts's environment is "node", and
// the happy-dom component tests next door have no layout engine), so there is
// no meaningful `getComputedStyle` to assert against. This instead parses the
// checked-in stylesheet text directly — a legitimate regression trap for the
// two things that actually matter here: the maps rows carry the Dock's own
// row geometry, and this file never redeclares a selector /synth and
// /loaders also read (maps-workbench.css's own doc above these rules).
const css = readFileSync(new URL("./maps-workbench.css", import.meta.url), "utf8");
const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.[\]()/]/g, (c) => `\\${c}`);
  const match = new RegExp(`(?:^|,|\\})\\s*${escaped}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`, "m").exec(rules);
  if (!match) throw new Error(`no rule found for selector: ${selector}`);
  return match[1];
}

/** Every selector in the group that declares the shared maps row geometry. */
const ROW_GROUP = [
  ".maps-layer-card .maps-layer-body .voice-slider",
  ".maps-layer-card .maps-layer-body .maps-layer-select-row",
  ".maps-layer-card .maps-layer-body .maps-layer-color-row",
  ".maps-layer-card .maps-layer-body .maps-layer-info-row",
  ".maps-layer-background-row .maps-layer-color-row",
];

describe("maps-workbench.css: the Dock's controller row, reproduced", () => {
  it("gives every card row the Dock's three-column geometry", () => {
    // The Dock's `.controller` is `.name` at `--name-width: 45%` +
    // `.widget`; on a number row the widget ends in a value input sized
    // `clamp(45px, 27%, 70px)` (lil-gui's `--slider-input-min-width` /
    // `--slider-input-width`, gallery-workbench.css keeps both). These rows
    // reproduce that as a grid: name / widget / value.
    for (const selector of ROW_GROUP) {
      const body = ruleBody(selector);
      const cols = /grid-template-columns:\s*([^;]+);/.exec(body);
      expect(cols, selector).not.toBeNull();
      const spec = cols![1].trim();
      const name = spec.slice(0, spec.indexOf(" "));
      const value = spec.slice(spec.lastIndexOf(" ") + 1);
      expect(name, selector).toBe("45%");
      // Inside the Dock's own 45-70px band — see the rule's doc for why this
      // rail sits at the upper end of it rather than on the 45px floor.
      const px = parseFloat(value);
      expect(px, selector).toBeGreaterThanOrEqual(45);
      expect(px, selector).toBeLessThanOrEqual(70);
      // The Dock's own `--spacing`, and its `--widget-height`.
      expect(body, selector).toMatch(/gap:\s*5px/);
      expect(body, selector).toMatch(/min-height:\s*24px/);
      expect(body, selector).toMatch(/font-size:\s*11px/);
    }
  });

  it("spans a valueless widget across the value column, as the Dock's .widget does", () => {
    // A `<select>` row and a read-only provenance row have no value column of
    // their own; in the Dock their `.widget` fills everything after `.name`.
    for (const selector of [
      ".maps-layer-card .maps-layer-body .maps-layer-select-row .gx-select",
      ".maps-layer-card .maps-layer-body .maps-layer-info-value",
    ]) {
      expect(ruleBody(selector), selector).toMatch(/grid-column:\s*2\s*\/\s*4/);
    }
  });

  it("dims a gated row the way the Dock dims a disabled controller", () => {
    // lil-gui's `.controller.disabled` is `opacity: 0.5`, and the Dock dims
    // its `.name` to 0.38 on top of that. The previous 0.35 whole-row dim
    // matched neither.
    expect(ruleBody(".maps-layer-slider--off")).toMatch(/opacity:\s*0\.5/);
    expect(ruleBody(".maps-layer-slider--off > span:first-child")).toMatch(/rgba\(255,\s*232,\s*184,\s*0\.38\)/);
  });

  it("never re-declares a shared selector in this file", () => {
    // instrument-workbench.css owns these and is loaded verbatim by /synth
    // and /loaders. This file must only ever reach them through a descendant
    // selector (higher specificity, no risk of leaking into those pages) —
    // never redeclare the class itself, which would either fight the base
    // rule on source order or (worse) get hoisted into the shared file later
    // and change both pages.
    for (const shared of [
      "voice-slider", "voice-slider-track", "voice-slider-readout", "voice-color",
      "gx-select", "layer-group", "layer-group-head", "layer-group-body", "layer-group-check",
    ]) {
      expect(rules, shared).not.toMatch(new RegExp(`(?:^|,)\\s*\\.${shared}\\b`, "m"));
    }
  });
});
