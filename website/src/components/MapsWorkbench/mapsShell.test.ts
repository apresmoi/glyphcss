import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { MAPS_SHELL_CLASS, mapsCodePanelClassName } from "./mapsShell";

/**
 * The two shell defects behind "the export dock opens floating and separated
 * from the footer" — see `mapsShell.ts`'s header for the browser
 * measurements. happy-dom has no layout engine, so what is assertable here is
 * the WIRING: the class the positioning rules key on, and the rules
 * themselves as checked-in stylesheet text (the same technique
 * `maps-workbench.rowWidths.test.ts` already uses on this stylesheet).
 */
const instrumentCss = readFileSync(
  new URL("../InstrumentWorkbench/instrument-workbench.css", import.meta.url),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");
const mapsCss = readFileSync(new URL("./maps-workbench.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.[\]()/*+?^$|\\]/g, (c) => `\\${c}`);
  const match = new RegExp(`(?:^|[,}])\\s*${escaped}\\s*(?:,[^{}]*)?\\{([^}]*)\\}`, "m").exec(css);
  if (!match) throw new Error(`no rule found for selector: ${selector}`);
  return match[1];
}

describe("maps code window carries /synth's own positioning class", () => {
  it("always emits `synth-code-panel`, closed or open as the mobile drawer", () => {
    expect(mapsCodePanelClassName(null).split(" ")).toContain("synth-code-panel");
    expect(mapsCodePanelClassName("layers").split(" ")).toContain("synth-code-panel");
    expect(mapsCodePanelClassName("code").split(" ")).toContain("synth-code-panel");
  });

  it("adds `is-mobile-open` only for the Code tab", () => {
    expect(mapsCodePanelClassName("code").split(" ")).toContain("is-mobile-open");
    expect(mapsCodePanelClassName(null).split(" ")).not.toContain("is-mobile-open");
    expect(mapsCodePanelClassName("controls").split(" ")).not.toContain("is-mobile-open");
  });

  // The class above is only worth anything while the rules that read it exist.
  // Both are in the SHARED stylesheet /synth owns, so this is the trap that
  // catches a rename over there taking /maps' code window down with it.
  it("is the class instrument-workbench.css actually positions on, desktop and mobile", () => {
    const desktop = ruleBody(instrumentCss, ".synth-code-panel.gw-code-panel");
    expect(desktop).toMatch(/bottom:\s*calc\(12px \+ 34px\)/);

    // The mobile drawer block: same compound selector, inside the 760px query.
    const mobileBlock = /@media \(max-width: 760px\) \{([\s\S]*?)\n\}/.exec(instrumentCss);
    expect(mobileBlock).not.toBeNull();
    expect(instrumentCss).toMatch(
      /:is\(\.dn-root--synth, \.dn-root--generative\) \.synth-code-panel\.gw-code-panel \{[^}]*bottom:\s*var\(--mobile-panel-bottom\)/,
    );
  });
});

describe("maps shell reserves no footer strip", () => {
  it("zeroes the shared `--synth-footer-height` on the maps root", () => {
    const body = ruleBody(mapsCss, `.dn-root.${MAPS_SHELL_CLASS}`);
    expect(body).toMatch(/--synth-footer-height:\s*0px/);
  });

  // The variable is only worth zeroing while the shared shell still folds it
  // into `--overlay-bottom`; if /synth stops doing that, this override is dead
  // code rather than a fix.
  it("is the variable the shared shell folds into --overlay-bottom", () => {
    expect(instrumentCss).toMatch(
      /--overlay-bottom:\s*calc\(var\(--synth-footer-height\) \+ 12px\)/,
    );
  });
});

/**
 * The shared mobile tab bar sizes itself from the number of tabs.
 *
 * It shipped as `grid-template-columns: repeat(4, minmax(0, 1fr))`, which is
 * right for /gallery and /synth (four tabs each) and leaves a quarter of the
 * row empty on /maps, which has three — visible at 390x844 as three buttons
 * ending well short of the bar's own right edge. `grid-auto-flow: column` is
 * exactly equivalent for four and correct for any count, so the fix is in the
 * shared rule rather than a maps-only override.
 */
const galleryCss = readFileSync(
  new URL("../GalleryWorkbench/gallery-workbench.css", import.meta.url),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

describe("the mobile tab bar fits its own tab count", () => {
  it("lays tabs out by auto-flow, not a hardcoded column count", () => {
    // The bar has two rules: a bare `display: none` outside any query, and
    // the real layout inside the 760px one. Read the one that lays out.
    const bodies = [...galleryCss.matchAll(/(?:^|[,}])\s*\.dn-mobile-tabs\s*\{([^}]*)\}/gm)]
      .map((m) => m[1]!);
    const body = bodies.find((b) => /position:\s*absolute/.test(b));
    expect(body, "no laid-out .dn-mobile-tabs rule found").toBeDefined();
    expect(body!).toMatch(/grid-auto-flow:\s*column/);
    expect(body!).toMatch(/grid-auto-columns:\s*minmax\(0,\s*1fr\)/);
    expect(body!).not.toMatch(/grid-template-columns:\s*repeat\(\d/);
  });

  // The shared bar is overridden a SECOND time for this shell
  // (instrument-workbench.css), which is where the hardcoded four actually
  // won the cascade on /maps — fixing only gallery-workbench.css changed
  // nothing on screen.
  it("does not re-pin a count in the apparatus shell's own override", () => {
    const override = /:is\(\.dn-root--synth, \.dn-root--generative\) \.dn-mobile-tabs \{([^}]*)\}/
      .exec(instrumentCss);
    expect(override, "no shell override for .dn-mobile-tabs found").not.toBeNull();
    expect(override![1]!).not.toMatch(/grid-template-columns:\s*repeat\(\d/);
    expect(override![1]!).toMatch(/grid-auto-flow:\s*column/);
  });
});
