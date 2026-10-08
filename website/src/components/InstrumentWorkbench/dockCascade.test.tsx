import selectStyles from "../BracketSelect/BracketSelect.module.css";
import rangeStyles from "../RangeSlider/RangeSlider.module.css";
import dockStyles from "../Dock/Dock.module.css";
import { readCss } from "../../test/styles";
// @vitest-environment happy-dom
//
// Dock-fix bundle items 1, 2 and 8 (DIAGNOSIS-scale-domain.md) — every one
// of them is the SAME failure mode: a component that carries lil-gui's own
// hook classes (`.controller.number.hasSlider`, or lives inside a real
// `.lil-gui` panel) loses a cascade fight against lil-gui's OWN element
// rules (`.lil-gui button { width: 100% }`, `.lil-gui .controller.number
// .slider { overflow: hidden; height: var(--widget-height) }`, `.lil-gui
// .controller.number.hasSlider input { width: var(--slider-input-width) }`)
// once it is actually mounted where the real theme applies — a fixture that
// mounts only THIS FILE's own CSS, or a happy-dom render with no CSS
// cascade at all (`RangeSlider.test.tsx`, `ChartsWorkbench.test.tsx`), can
// never see it, since neither ever puts the two stylesheets in the ring
// together.
//
// happy-dom has no LAYOUT engine (`getBoundingClientRect` reads all zero),
// but its `getComputedStyle` DOES resolve real CSS cascade/specificity
// against every `<style>` in the document (verified empirically: a bare
// `.a { width: 10px }` loses to a nested `.parent .a.b { width: 20px }` the
// same way a real browser's would) — so every assertion here reads a
// COMPUTED property value, per the task's own "at minimum" fallback, rather
// than a measured pixel box. The real boxes were independently measured in
// a real Chromium (Playwright, `gallery-workbench.css`'s theme loaded, the
// Dock's actual fixed width) and are recorded in the fix's own report: the
// X/Y domain row's auto button ~34px, each number field 27px, the track
// ~62px (floor 60px), and the two `[reset]` buttons 45px wide flush against
// their folder's own right edge — never the reported 170px/346px-wide
// full-row buttons the unscoped rules produced.
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import GUI from "lil-gui";
import { RangeCategorySelect, RangeSlider } from "../RangeSlider/RangeSlider";
import { useFolderTitleReset } from "../Dock/hooks/useFolderTitleReset";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIL_GUI_CSS = readCss(path.join(path.dirname(require.resolve("lil-gui")), "lil-gui.css"));
const INSTRUMENT_CSS = readCss(path.resolve(__dirname, "../BracketSelect/BracketSelect.module.css"), selectStyles) + "\n" + readCss(path.resolve(__dirname, "../RangeSlider/RangeSlider.module.css"), rangeStyles) + "\n" + readCss(path.resolve(__dirname, "../Dock/Dock.module.css"), dockStyles);

/** The exact scoping prefix every contested `.range-slider-*` rule in
 *  `instrument-workbench.css` carries. Stripping it (leaving the bare
 *  `.range-slider-*` selector) is the MUTATION this file checks against —
 *  the P1/P2 fix is precisely that prefix existing at all. */
const RANGE_SLIDER_SCOPE = `.lil-gui .${rangeStyles.root}.controller.number.hasSlider.range-slider `;
/** Same idea for the folder-title-bar reset button (item 8). */
const RESET_BUTTON_SCOPE = `.${dockStyles.root} .lil-gui `;

function stripScope(css: string, scope: string, selectorPrefix: string): string {
  // Only the rules THIS bundle scoped are touched (selectorPrefix), so an
  // unrelated `.lil-gui …` rule elsewhere in the real stylesheet (there are
  // several) is never mutated by accident.
  return css.replaceAll(`${scope}${selectorPrefix}`, selectorPrefix);
}

let styleEls: HTMLStyleElement[] = [];
let root: Root | null = null;
let container: HTMLElement | null = null;
let guiHost: HTMLElement | null = null;
let gui: GUI | null = null;

function loadCss(...sheets: string[]) {
  for (const css of sheets) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    styleEls.push(style);
  }
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
  gui?.destroy();
  gui = null;
  guiHost?.remove();
  guiHost = null;
  for (const el of styleEls) el.remove();
  styleEls = [];
});

describe("RangeSlider inside a real .lil-gui panel (P1/P2)", () => {
  function mountRangeSlider(): HTMLElement {
    guiHost = document.createElement("div");
    guiHost.className = dockStyles.root;
    document.body.appendChild(guiHost);
    gui = new GUI({ container: guiHost });
    const folder = gui.addFolder("Scales");
    container = document.createElement("div");
    folder.$children.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<RangeSlider min={-2} max={12} value={[0, 10]} label="X domain" onChange={() => {}} />);
    });
    return container;
  }

  it("wins width/layout properties against lil-gui's own element rules (real theme + real component CSS)", () => {
    loadCss(LIL_GUI_CSS, INSTRUMENT_CSS);
    const host = mountRangeSlider();
    const reset = host.querySelector(".range-slider-label .instrument-row-reset")!;
    const numbers = host.querySelectorAll(".range-slider-number");
    const track = host.querySelector(".range-slider-track")!;

    // `.lil-gui button { width: 100% }` is exactly what stretched the old
    // in-row auto button across the whole row (DIAGNOSIS P1) — the label
    // cell's `[reset]` must keep its own `width: auto`.
    expect(getComputedStyle(reset).width).toBe("auto");
    // `.lil-gui .controller.number.hasSlider input { width: var(--slider-
    // input-width); min-width: var(--slider-input-min-width) }` (27%, 45px)
    // is what grew each number field past the panel edge — our own
    // content-sized width must win instead ("-2"/"12" are two characters).
    expect(getComputedStyle(numbers[0]!).width).toBe("calc(2 * 1ch + 8px)");
    expect(getComputedStyle(numbers[1]!).width).toBe("calc(2 * 1ch + 8px)");
    // `.lil-gui .controller.number .slider { overflow: hidden; height:
    // var(--widget-height) }` matches the track too (it carries a bare
    // `slider` class for exactly this "read as a real slider row" reason) —
    // our own `overflow: visible`/`height: 10px`/`min-width: 44px` must win
    // so the bracket glyphs aren't clipped and the track never floors out
    // at lil-gui's own 24px minimum (P2). 44px, not the earlier 60px: the
    // row lost its `auto` button, and two `YYYY-MM` fields need the room
    // (CHARTS-RESEARCH `DIAGNOSIS-scale-rows-mark-card.md`).
    expect(getComputedStyle(track).overflow).toBe("visible");
    expect(getComputedStyle(track).height).toBe("10px");
    expect(getComputedStyle(track).minWidth).toBe("44px");
  });

  // P1 mutation check — drop exactly the scoping prefix the fix adds
  // (leaving the bare `.range-slider-number`/
  // `.range-slider-track` selectors this file HAD before the fix) and
  // confirm lil-gui's own rules win again. A red result here on the real
  // source file (not this mutated copy) is the regression this whole test
  // exists to catch.
  it("MUTATION: with the scoping prefix stripped, lil-gui's own rules win again", () => {
    const mutatedInstrumentCss = INSTRUMENT_CSS
      .split("\n").map((line) => stripScope(line, RANGE_SLIDER_SCOPE, ".range-slider-number"))
      .map((line) => stripScope(line, RANGE_SLIDER_SCOPE, ".range-slider-track"))
      .join("\n");
    // Confirms the mutation actually removed the scoped rule text (i.e. the
    // regex above matched something) — otherwise this "mutation" test would
    // pass for the wrong reason (identical CSS, nothing dropped).
    expect(mutatedInstrumentCss).not.toEqual(INSTRUMENT_CSS);
    expect(mutatedInstrumentCss).not.toContain(`${RANGE_SLIDER_SCOPE}.range-slider-number`);
    loadCss(LIL_GUI_CSS, mutatedInstrumentCss);
    const host = mountRangeSlider();
    const numbers = host.querySelectorAll(".range-slider-number");
    const track = host.querySelector(".range-slider-track")!;
    // lil-gui's own `--slider-input-width: 27%` custom property, resolved.
    expect(getComputedStyle(numbers[0]!).width).toBe("27%");
    expect(getComputedStyle(track).overflow).toBe("hidden");
  });
});

describe("Folder-title-bar reset button inside a real .lil-gui panel (item 8)", () => {
  function mountReset(): { folderEl: HTMLElement; button: HTMLElement } {
    guiHost = document.createElement("div");
    guiHost.className = dockStyles.root;
    document.body.appendChild(guiHost);
    gui = new GUI({ container: guiHost });
    const folder = gui.addFolder("Output");
    container = document.createElement("div");
    // `useFolderTitleReset` needs a real component tree to run its effect.
    function Harness() {
      useFolderTitleReset(folder, "Reset", () => {});
      return null;
    }
    root = createRoot(container);
    act(() => { root!.render(<Harness />); });
    const button = folder.domElement.querySelector<HTMLElement>(".dock-folder-title-reset-button")!;
    return { folderEl: folder.domElement, button };
  }

  it("shrinks to its own content instead of stretching across the whole title row", () => {
    loadCss(LIL_GUI_CSS, INSTRUMENT_CSS);
    const { button } = mountReset();
    // `.lil-gui button { width: 100% }` is what stretched this button
    // across the entire title bar, with `right: 6px` then placing its
    // FAR edge correctly while its content (left-aligned inside its own
    // `display: flex`) rendered over the folder's own name — "resetOUTPUT"
    // (DIAGNOSIS bundle item 8, confirmed in a real browser screenshot
    // before this fix). `width: auto` must be what wins instead.
    expect(getComputedStyle(button).width).toBe("auto");
    expect(getComputedStyle(button).position).toBe("absolute");
    expect(getComputedStyle(button).top).toBe("0px");
    expect(getComputedStyle(button).right).toBe("6px");
    // The containing block is the folder's own root, which `.dock-folder-
    // title-reset` (also asserted here) puts into `position: relative` —
    // `top: 0; right: 6px` then resolve against THAT box, i.e. the same
    // vertical band the title occupies, not some ancestor further up.
    expect(button.parentElement).toBe((button.closest(".lil-gui") as HTMLElement));
    expect(getComputedStyle(button.parentElement!).position).toBe("relative");
  });

  it("MUTATION: with the scoping prefix stripped, lil-gui's own button rule wins and the button spans the row again", () => {
    const mutatedCss = stripScope(INSTRUMENT_CSS, RESET_BUTTON_SCOPE, ".dock-folder-title-reset-button");
    expect(mutatedCss).not.toEqual(INSTRUMENT_CSS);
    expect(mutatedCss).not.toContain(`${RESET_BUTTON_SCOPE}.dock-folder-title-reset-button`);
    loadCss(LIL_GUI_CSS, mutatedCss);
    const { button } = mountReset();
    expect(getComputedStyle(button).width).toBe("100%");
  });
});

// CHARTS-RESEARCH `DIAGNOSIS-scale-rows-mark-card.md`: a band axis's domain
// used to be two stacked card rows whose 270px selects started 80px left of
// the widget column and ran past the panel. It is one lil-gui row now; what
// keeps both selects inside the widget is each being a zero-basis flex item
// that may shrink below its own text (`min-width: 0`).
describe("RangeCategorySelect inside a real .lil-gui panel", () => {
  function mountSelect(): HTMLElement {
    guiHost = document.createElement("div");
    guiHost.className = dockStyles.root;
    document.body.appendChild(guiHost);
    gui = new GUI({ container: guiHost });
    const folder = gui.addFolder("Scales");
    container = document.createElement("div");
    folder.$children.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(<RangeCategorySelect label="X domain" categories={["Coal", "Natural gas liquids", "Hydro", "Solar"]}
        value={[null, null]} onSelect={() => {}} onReset={() => {}} />);
    });
    return container;
  }

  it("is one .name + .widget row whose two dropdowns hug their labels and may shrink below their text", () => {
    loadCss(LIL_GUI_CSS, INSTRUMENT_CSS);
    const host = mountSelect();
    const rows = host.querySelectorAll(".controller");
    expect(rows).toHaveLength(1);
    const [name, widget] = Array.from(rows[0]!.children);
    expect(name!.classList.contains("name")).toBe(true);
    expect(widget!.classList.contains("widget")).toBe(true);
    expect(getComputedStyle(widget!).display).toBe("flex");
    expect(parseFloat(getComputedStyle(widget!).minWidth)).toBe(0);
    const selects = widget!.querySelectorAll("select");
    expect(selects).toHaveLength(2);
    for (const select of selects) {
      const cs = getComputedStyle(select.parentElement!);
      expect(cs.flexGrow).toBe("0");
      expect(cs.flexShrink).toBe("1");
      expect(cs.flexBasis).toBe("auto");
      expect(parseFloat(cs.minWidth)).toBe(0);
      expect(cs.width).toBe("fit-content");
    }
  });
});
