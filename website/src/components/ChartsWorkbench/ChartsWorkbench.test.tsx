// @vitest-environment node
// Node module resolution matches the pure suite; happy-dom supplies only the
// mounted UI surface. No chart renderer, reducer, Dock or CodePanel is mocked.
vi.hoisted(async () => {
  const { Window } = await import("happy-dom");
  // A real origin/URL (not happy-dom's default "about:blank") — the
  // showcase-mount describe block below drives `window.history.replaceState`
  // with a relative `/charts?c=…` path (mirroring `lib/urlState.ts`'s own
  // `commitUrlParam`), which happy-dom silently no-ops against an opaque
  // "about:blank" origin (verified: `window.location.href` stays
  // "about:blank" afterward) and throws a SecurityError against an absolute
  // URL there instead.
  const window = new Window({ url: "http://localhost/charts" });
  // Browsers name this exception NotFoundError; happy-dom leaves the name generic.
  const removeChild = window.Node.prototype.removeChild;
  window.Node.prototype.removeChild = function(child) {
    try { return removeChild.call(this, child); }
    catch (error) {
      if (error instanceof window.DOMException && error.message.includes("removeChild")) throw new window.DOMException(error.message, "NotFoundError");
      throw error;
    }
  };
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Event", "MouseEvent", "KeyboardEvent", "DOMException", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? window : window[key] });
  }
});
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GUI } from "lil-gui";
import ChartsWorkbench from "./ChartsWorkbench";
import { CHART_MARK_TYPE_TOGGLE } from "./ChartsMarkCard";
// Standalone Vitest lacks Astro's core alias; use the real module behind it.
vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
import {
  CHART_MARK_TYPES,
  CHARTS_DATASETS,
  createChartsWorkbenchState,
  reduceChartsWorkbenchState,
  reduceGlyphChartsWorkbenchControls,
  resolveGlyphChartsWorkbenchControls,
  type GlyphChartsWorkbenchControls,
} from "./chartsWorkbenchState";
import { chartsWorkbenchDisplayRender, renderChartsWorkbenchSpec, type ChartsWorkbenchRender } from "./chartsWorkbenchRender";
import { CHARTS_URL_PARAM, decodeChartsUrlState, encodeChartsUrlState } from "./chartsUrlState";
import { CHARTS_REMOTE_DATASET_INDEX } from "./datasets/remoteIndex";
import * as urlStateModule from "../../lib/urlState";

// ── Data overlay test helpers (AGENTS.md's "Charts" — "Data layer") — the
// old `<select>` these tests used to drive directly is gone
// (`ChartsDataOverlay.tsx`/`ChartsDatasetSearchBox.tsx`'s own doc): a
// vendored pick now goes through the chevron's browse list, and "what's
// currently loaded" is read off the rail's own dataset-card title
// (`.charts-data-title`, `ChartsDataFolder.tsx`) rather than a `<select>`'s
// `.value` — both are shared across every describe block below that used
// to reach into the select directly.
function selectChartsDataset(container: ParentNode, id: string): void {
  const chevron = container.querySelector<HTMLButtonElement>('[aria-label="Browse datasets"]')!;
  act(() => chevron.click());
  const option = container.querySelector<HTMLButtonElement>(`.instrument-search-option[data-dataset-id="${id}"]`)!;
  act(() => option.click());
}
function chartsActiveDatasetTitle(container: ParentNode): string {
  return container.querySelector(".charts-data-title")?.textContent ?? "";
}

// happy-dom has no canvas; this unused gallery palette calibrates at Dock import time.
vi.mock("../GalleryWorkbench/calibratedPalette", () => ({ CALIBRATED_PALETTE_NAME: "calibrated", ensureCalibratedPalette: () => {} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DEFAULT_SPEC = JSON.stringify({
  marks: [
    { type: "line", data: [{ t: 0, v: 3 }, { t: 1, v: 5 }], channels: { x: "t", y: "v" } },
    { type: "dot", data: [{ t: 0, v: 3 }, { t: 1, v: 5 }], channels: { x: "t", y: "v" } },
    { type: "rule", data: [0], channels: {}, options: { axis: "y" } },
  ],
  title: "line + dot + rule",
});

describe("ChartsWorkbench — renderChartsWorkbenchSpec", () => {
  it("renders the page's own default spec through the same function the page uses", () => {
    const result = renderChartsWorkbenchSpec(DEFAULT_SPEC, { target: "chat", charset: "box", color: "none", width: 60, height: 20 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text.length).toBeGreaterThan(0);
      expect(result.isHtml).toBe(false);
    }
  });

  it("reports a structured error for invalid JSON rather than throwing", () => {
    const result = renderChartsWorkbenchSpec("{not json", { target: "chat", charset: "box", color: "none", width: 40, height: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Invalid JSON");
  });

  it("reports a structured error for a spec that fails validation", () => {
    const result = renderChartsWorkbenchSpec(JSON.stringify({ marks: [] }), { target: "chat", charset: "box", color: "none", width: 40, height: 10 });
    expect(result.ok).toBe(false);
  });

  it("produces an html payload for color: css and marks isHtml", () => {
    const result = renderChartsWorkbenchSpec(DEFAULT_SPEC, { target: "web", charset: "blocks", color: "css", width: 40, height: 12 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.isHtml).toBe(true);
      expect(result.display).toContain("<span");
      expect(result.text).not.toContain("<span");
    }
  });

  // Mutation: forward ANSI result.text into display or the plain clipboard exit.
  it("keeps truecolor escapes only in the separate ANSI payload", () => {
    const result = renderChartsWorkbenchSpec(DEFAULT_SPEC, { target: "terminal", charset: "braille", color: "truecolor", width: 40, height: 12 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.isHtml).toBe(false);
    expect(result.display).toBe(result.text);
    expect(result.text).not.toContain("\x1b");
    expect(result.ansi).toContain("\x1b[");
    expect(result.ansi!.replace(/\x1b\[[0-9;]*m/g, "")).toBe(result.text);
  });

  // Mutation: accept fractional dimensions or round the page value before validation.
  it.each([
    { width: 20.5, height: 6 }, { width: 0.5, height: 6 }, { width: 20, height: 6.5 },
  ])("reports bad-size for fractional page controls %j", (size) => {
    const state = reduceGlyphChartsWorkbenchControls({ target: "chat", overrides: { height: size.height } }, { type: "width", value: size.width });
    const result = renderChartsWorkbenchSpec(JSON.stringify({ marks: [{ type: "line", data: [1, 2], channels: {} }] }), resolveGlyphChartsWorkbenchControls(state));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("bad-size");
      expect(result.error).toContain("bad-size");
    }
  });
});

// Render-area cleanup (the user's own words: "it shouldn't be in the
// rendering area — it moves the chart"): the viewport's own content rule —
// current render if it's ok, else the frozen last-good — pinned with no DOM
// or reducer in the loop.
describe("ChartsWorkbench — chartsWorkbenchDisplayRender (viewport fallback rule)", () => {
  const ok = (text: string): Extract<ChartsWorkbenchRender, { ok: true }> =>
    ({ ok: true, display: text, isHtml: false, text, meta: {} as never, report: { ledger: [] } as never });
  const bad: ChartsWorkbenchRender = { ok: false, error: "boom" };

  it("shows the current render when it's ok, regardless of any last-good on hand", () => {
    const current = ok("current");
    expect(chartsWorkbenchDisplayRender(current, null)).toBe(current);
    expect(chartsWorkbenchDisplayRender(current, ok("stale"))).toBe(current);
  });

  it("falls back to the last-good render when the current one errored", () => {
    const lastGood = ok("stale");
    expect(chartsWorkbenchDisplayRender(bad, lastGood)).toBe(lastGood);
  });

  // Mutation: return the bad render itself, or throw, instead of null when
  // nothing has ever rendered OK.
  it("has nothing to show when the current render errored and no last-good exists", () => {
    expect(chartsWorkbenchDisplayRender(bad, null)).toBeNull();
  });
});

describe("ChartsWorkbench — explicit control overrides", () => {
  // Mutation: preserve the previous target's resolved defaults as overrides.
  it("changes every unmodified control when the target changes", () => {
    const initial: GlyphChartsWorkbenchControls = { target: "chat", overrides: {} };
    const terminal = reduceGlyphChartsWorkbenchControls(initial, { type: "target", value: "terminal" });
    expect(resolveGlyphChartsWorkbenchControls(terminal)).toEqual({ target: "terminal", charset: "braille", color: "truecolor", width: 80, height: 24, cellAspect: 0.5 });
    const web = reduceGlyphChartsWorkbenchControls(terminal, { type: "target", value: "web" });
    expect(resolveGlyphChartsWorkbenchControls(web)).toEqual({ target: "web", charset: "braille", color: "css", width: 96, height: 32, cellAspect: 0.5859375 });
  });

  // Mutation: infer overrides by value inequality, or discard one control's explicit override on target change.
  it.each([
    { type: "charset", value: "box" }, { type: "color", value: "none" },
    { type: "width", value: 72 }, { type: "height", value: 24 },
  ] as const)("keeps an explicitly chosen default for $type", (action) => {
    const changed = reduceGlyphChartsWorkbenchControls({ target: "chat", overrides: {} }, action);
    const switched = reduceGlyphChartsWorkbenchControls(changed, { type: "target", value: "web" });
    expect(resolveGlyphChartsWorkbenchControls(switched)).toEqual({ target: "web", charset: "braille", color: "css", width: 96, height: 32, cellAspect: 0.5859375, [action.type]: action.value });
  });

  // Mutation: reset clears only colour/charset and leaves dimension overrides behind.
  it("clears all four explicit overrides on reset", () => {
    const reset = reduceGlyphChartsWorkbenchControls({ target: "web", overrides: { charset: "ascii", color: "none", width: 20, height: 6 } }, { type: "reset" });
    expect(resolveGlyphChartsWorkbenchControls(reset)).toEqual({ target: "web", charset: "braille", color: "css", width: 96, height: 32, cellAspect: 0.5859375 });
    expect(reset.overrides).toEqual({});
  });
});

describe("ChartsWorkbench — mounted controls and clipboard", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    // A fixed `initialState` (the "Line" preset, no dataset selected) keeps
    // this whole describe block deterministic — with no URL and no
    // `initialState`, the page now opens on a RANDOM vendored dataset
    // (item 2, AGENTS.md's "Charts" — "Data layer"); that behaviour has its
    // own dedicated describe block below rather than being fought here.
    act(() => root.render(<ChartsWorkbench initialState={createChartsWorkbenchState()} />));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  // Target/Charset/Color/Detail are icon-button toggle rows (owner packet
  // item 3: "buttons with symbols not dropdowns"), not lil-gui `<select>`
  // controllers — `toggleRow` finds the row by its own `.dock-toggle-row-
  // label` text, and `pickToggle`/`activeToggleLabel` drive/read it by each
  // button's `aria-label`. `IconToggle`'s F5 a11y pass (synthKit.tsx)
  // prefixes that with the group's own name ("Output target: web") whenever
  // a `groupTitle`/`groupLabel` is given — which every Dock row and the
  // mark-type row both do — so a bare option value is read via `optionOf`
  // below (the text after the LAST ": ", robust to a `groupTitle` that
  // itself contains no colon, true of every row this file exercises).
  function toggleRow(label: string): Element {
    return Array.from(container.querySelectorAll(".dock-toggle-row")).find((node) => node.querySelector(".dock-toggle-row-label")?.textContent === label)!;
  }
  function optionOf(ariaLabel: string): string {
    const parts = ariaLabel.split(": ");
    return parts[parts.length - 1]!;
  }
  function pickToggle(rowLabel: string, optionLabel: string): void {
    const btn = Array.from(toggleRow(rowLabel).querySelectorAll<HTMLButtonElement>("button")).find((b) => optionOf(b.getAttribute("aria-label") ?? "") === optionLabel)!;
    act(() => btn.click());
  }
  function activeToggleLabel(rowLabel: string): string {
    return optionOf(toggleRow(rowLabel).querySelector<HTMLButtonElement>(".gx-toggle-btn.is-active")!.getAttribute("aria-label")!);
  }
  // Mark type is an `IconToggle` too (owner packet item 3, extended to the
  // mark card) — `data-row="type"` scopes to that one row so it's never
  // confused with a type-specific toggle further down the same card (arc
  // shape, rule axis), which share `.charts-mark-row > .gx-toggle` but not
  // this attribute. Reads mark 1 by default; pass an index for a later one.
  function activeMarkType(markIndex = 0): string {
    const cards = container.querySelectorAll(".charts-mark-card");
    return optionOf(cards[markIndex]!.querySelector<HTMLButtonElement>('.charts-mark-row[data-row="type"] .gx-toggle-btn.is-active')!.getAttribute("aria-label")!);
  }
  function controller(name: string): Element {
    return Array.from(container.querySelectorAll("#charts-controls-panel .controller")).find((node) => node.querySelector(".name")?.textContent?.toLowerCase() === name.toLowerCase())!;
  }
  function outputControls() {
    return ["Target", "Charset", "Color"].map((name) => activeToggleLabel(name));
  }
  function outputSize() {
    return ["Width", "Height"].map((name) => controller(name).querySelector("input")!.value);
  }
  // Folder-title-bar reset (REVIEW-dock-addenda-opus.md P3-5) —
  // `InstrumentWorkbench/useFolderTitleReset` mounts one
  // `.dock-folder-title-reset-button` per folder (Output, Chart) as a DOM
  // sibling of that folder's own native `.title`, shared with `/diagrams`;
  // `startsWith` on the button's own `title` (the exact tooltip text
  // `useFolderTitleReset` was given) picks the right one the same way the
  // old `.dock-folder-header-reset` set was disambiguated.
  function folderResetButton(titleStartsWith: string): HTMLButtonElement {
    return Array.from(container.querySelectorAll<HTMLButtonElement>(".dock-folder-title-reset-button")).find((btn) => btn.title.startsWith(titleStartsWith))!;
  }
  function resetOutputButton(): HTMLButtonElement {
    return folderResetButton("Reset target, charset, color");
  }
  function button(label: string): HTMLButtonElement {
    return Array.from(container.querySelectorAll("button")).find((node) => node.textContent === label)!;
  }

  it("the rendered <pre> is the exact element the Glyph Mono font rule targets (CHARTS-RESEARCH diagnosis A4)", () => {
    // happy-dom does not compute CSS cascade (no layout/paint engine), so
    // this cannot re-run the diagnosis's own browser measurement — it can
    // only confirm the DOM shape the fixed CSS rule actually selects
    // (`.charts-grid-scroll > .glyph-output`) and that the rule itself
    // declares an explicit, non-"inherit" `font-family` starting with
    // "Glyph Mono". The real gate is the diagnosis's browser measurement
    // (A9's console snippet): forcing the font and reading every glyph's
    // advance back down to 7.617px. Mutation this catches: reverting
    // `charts-workbench.css`'s rule to `font-family: inherit` — the DOM
    // assertion here doesn't change, but the CSS-source assertion goes red.
    const pre = container.querySelector(".charts-grid-scroll > pre.glyph-output");
    expect(pre).not.toBeNull();
    const css = readFileSync(fileURLToPath(new URL("./charts-workbench.css", import.meta.url)), "utf8");
    const rule = css.match(/\.charts-grid-scroll > \.glyph-output \{[^}]*\}/)![0];
    expect(rule).toMatch(/font-family:\s*"Glyph Mono"/);
    expect(rule).not.toContain("font-family: inherit");
    expect(rule).toMatch(/line-height:\s*1\s*;/);
    const terminalRule = css.match(/\.target-preview__terminal-body \.glyph-output \{[^}]*\}/)![0];
    expect(terminalRule).toMatch(/font-family:\s*"Glyph Mono"/);
    expect(terminalRule).toMatch(/line-height:\s*1\s*;/);
    // Final-gate-2 review (Opus finding 4): the tray THUMBNAIL `<pre>` had
    // the identical `inherit` defect, measured live at braille 4.102px
    // against 3.612px for every other glyph (+13.6%). Mutation: revert
    // `.charts-tile-preview pre` to `font-family: inherit` -> red.
    const tileRule = css.match(/\.charts-tile-preview pre \{[^}]*\}/)![0];
    expect(tileRule).toMatch(/font-family:\s*"Glyph Mono"/);
    expect(tileRule).not.toContain("font-family: inherit");
    expect(tileRule).toMatch(/line-height:\s*1\s*;/);
  });

  it("shows exactly TypeScript and JSON tabs and copies each current snippet", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    act(() => button("Export").click());
    const panel = container.querySelector("#charts-export-panel")!;
    const tabs = Array.from(panel.querySelectorAll<HTMLButtonElement>(".gw-code-panel__tab"));
    expect(tabs.map((tab) => tab.textContent)).toEqual(["TypeScript", "JSON"]);
    const copy = panel.querySelector<HTMLButtonElement>('[title="Copy current snippet"]')!;
    expect(panel.querySelector("code")!.textContent).toContain("renderGlyphChart(glyphChartPlot(");
    await act(async () => copy.click());
    expect(writeText).toHaveBeenLastCalledWith(panel.querySelector("code")!.textContent);
    act(() => tabs[1]!.click());
    expect(JSON.parse(panel.querySelector("code")!.textContent!)).toHaveProperty("marks");
    await act(async () => copy.click());
    expect(writeText).toHaveBeenLastCalledWith(panel.querySelector("code")!.textContent);
  });

  it("hides the series legend without dropping the title or series metadata", () => {
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Apply Multi-series line"]')!.click());
    const before = container.querySelector("pre.glyph-output")!.textContent!;
    expect(before.split("\n").at(-1)).toMatch(/North.*South/);
    const toggle = controller("Legend").querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    act(() => toggle.click());
    const after = container.querySelector("pre.glyph-output")!.textContent!;
    expect(after).not.toBe(before);
    expect(after).not.toMatch(/North|South/);
    expect(after).toContain("Multi-series line");
    act(() => button("Export").click());
    expect(container.querySelector("#charts-export-panel code")!.textContent).toContain('"legend": false');
    act(() => toggle.click());
    expect(container.querySelector("pre.glyph-output")!.textContent).toBe(before);
  });

  // Owner packet items 1/2/3 — the Chart folder's legend-placement and
  // title-align/position rows are icon toggles like the Output folder's,
  // not lil-gui dropdowns; this exercises them through the real mounted
  // Dock rather than only through the pure reducer (chartsWorkbenchState.test.tsx).
  it("the Chart folder's legend-placement and title-align/position toggles reach the live render", () => {
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Apply Line"]')!.click());
    const before = container.querySelector("pre.glyph-output")!.textContent!;
    expect(toggleRow("Legend at")).toBeDefined();
    expect(toggleRow("Title at")).toBeDefined();
    pickToggle("Legend at", "top-left");
    const afterLegendMove = container.querySelector("pre.glyph-output")!.textContent!;
    expect(afterLegendMove).not.toBe(before);
    pickToggle("Title at", "left");
    pickToggle("Title at", "bottom");
    const afterTitleMove = container.querySelector("pre.glyph-output")!.textContent!;
    expect(afterTitleMove).not.toBe(afterLegendMove);
    const rows = afterTitleMove.split("\n");
    expect(rows[rows.length - 1]).toContain("Line");
  });

  // REVIEW-dock-addenda-opus.md P2-1/P2-3 — the ticks row is built from the
  // SAME real lil-gui `useToggle`/`useSlider` primitives Width/Height use
  // (`ChartsDock.tsx`'s `useTicksControl`), not a bespoke `RangeSlider`-
  // classed row: a real `.controller.boolean` row named "X ticks: auto"
  // and a real `.controller.number.hasSlider` row named "X ticks", found
  // through the SAME `controller()` helper every other lil-gui row in this
  // file already uses. Unchecking auto writes an explicit tick count that
  // reaches the built spec (and the live render); re-checking auto drops
  // `axes.x.ticks` entirely.
  it("the X ticks row: unchecking auto writes an explicit count that reaches the render; auto removes it", () => {
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Apply Line"]')!.click());
    const autoCheckbox = controller("X ticks: auto").querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const numberInput = controller("X ticks").querySelector<HTMLInputElement>(".widget input")!;
    expect(autoCheckbox.checked).toBe(true);
    expect(numberInput.disabled).toBe(true);
    act(() => autoCheckbox.click());
    expect(autoCheckbox.checked).toBe(false);
    expect(numberInput.disabled).toBe(false);
    const before = container.querySelector("pre.glyph-output")!.textContent!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(numberInput, "3");
      numberInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const after = container.querySelector("pre.glyph-output")!.textContent!;
    expect(after).not.toBe(before);
    act(() => button("Export").click());
    expect(container.querySelector("#charts-export-panel code")!.textContent).toContain('"ticks": 3');
    act(() => autoCheckbox.click());
    expect(container.querySelector("#charts-export-panel code")!.textContent).not.toContain('"ticks"');
  });

  // REVIEW-dock-addenda-opus.md P2-1 — the defect the old bespoke row had:
  // its number field was a React-controlled `<input value={shown}>` that
  // rewrote itself to the already-clamped PREVIOUS digit on every
  // keystroke, so "1" then "2" committed 22, not 12, and every count in
  // 10..19 was unreachable by typing. A real lil-gui `NumberController`
  // only rewrites its own input's text on `updateDisplay()`, gated on
  // `!this._inputFocused` — never while the field is focused — so nothing
  // fights a value typed keystroke-by-keystroke. Clearing the field goes
  // back to "auto", never `Number("") === 0`.
  it("the X ticks number field: typing two digits commits their real value, and clearing goes back to auto", () => {
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Apply Line"]')!.click());
    const autoCheckbox = controller("X ticks: auto").querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    act(() => autoCheckbox.click());
    const numberInput = controller("X ticks").querySelector<HTMLInputElement>(".widget input")!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(numberInput, "1"); numberInput.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => { setter.call(numberInput, "12"); numberInput.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => numberInput.dispatchEvent(new Event("blur")));
    act(() => button("Export").click());
    expect(container.querySelector("#charts-export-panel code")!.textContent).toContain('"ticks": 12');
    act(() => {
      setter.call(numberInput, "");
      numberInput.dispatchEvent(new Event("input", { bubbles: true }));
      numberInput.dispatchEvent(new Event("blur"));
    });
    expect(autoCheckbox.checked).toBe(true);
    expect(container.querySelector("#charts-export-panel code")!.textContent).not.toContain('"ticks"');
  });

  // agy P3-1 (`REVIEW-batch4-agy.md`): an INVALID (non-empty, non-numeric)
  // draft left in the field on blur — never submitted with Enter — must
  // revert to the last VALID committed count, not stay stuck showing the
  // invalid text. lil-gui's own `NumberController.onInput` never commits
  // a `NaN` parse (`isNaN(value)) return;`, so the internal value stays
  // whatever was last committed, and its own blur handler calls
  // `updateDisplay()` once `_inputFocused` goes false — restoring the
  // displayed text to that same committed value with no page-level code
  // needed for the non-empty case (only the EMPTY case needs this page's
  // own `emptied` tracking, since lil-gui has no "go back to auto"
  // concept of its own — the other test above).
  it("the X ticks number field: an invalid (non-numeric) draft left on blur reverts to the last valid count", () => {
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Apply Line"]')!.click());
    const autoCheckbox = controller("X ticks: auto").querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    act(() => autoCheckbox.click());
    const numberInput = controller("X ticks").querySelector<HTMLInputElement>(".widget input")!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    // Commit a real value first.
    act(() => { setter.call(numberInput, "12"); numberInput.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => numberInput.dispatchEvent(new Event("blur")));
    act(() => button("Export").click());
    expect(container.querySelector("#charts-export-panel code")!.textContent).toContain('"ticks": 12');
    // Now leave an invalid, non-empty draft and blur WITHOUT Enter.
    act(() => { setter.call(numberInput, "abc"); numberInput.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => numberInput.dispatchEvent(new Event("blur")));
    expect(numberInput.value).toBe("12");
    expect(autoCheckbox.checked).toBe(false);
    expect(container.querySelector("#charts-export-panel code")!.textContent).toContain('"ticks": 12');
  });

  // Dock item "Axis Title + Title at" — the X/Y axis Title-at rows reach
  // the real render; specifically, "Title at: end" moves the rendered
  // x-title text to a later column than the library's own "center"
  // default, not merely present-on-the-spec-object.
  it("the Axes folder's X/Y title-at toggles reach the live render, moving the x-title column", () => {
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Apply Line"]')!.click());
    const xTitleInput = controller("X title").querySelector<HTMLInputElement>("input")!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(xTitleInput, "Month");
      xTitleInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(toggleRow("X title at")).toBeDefined();
    expect(toggleRow("Y title at")).toBeDefined();
    const titleColumn = () => {
      const rows = container.querySelector("pre.glyph-output")!.textContent!.split("\n");
      return rows.find((row) => row.includes("Month"))!.indexOf("Month");
    };
    const centerColumn = titleColumn();
    pickToggle("X title at", "end");
    expect(titleColumn()).toBeGreaterThan(centerColumn);
    pickToggle("Y title at", "bottom");
    expect(container.querySelector("pre.glyph-output")!.textContent).toContain("Month");
  });

  // Mutation: target onChange updates an unused state or omits applying target defaults.
  it("applies terminal defaults through the actual target selector", () => {
    pickToggle("Target", "terminal");
    expect(outputControls()).toEqual(["terminal", "braille", "truecolor"]);
    expect(outputSize()).toEqual(["80", "24"]);
    expect(container.querySelector("pre")!.textContent!.split("\n")).toHaveLength(24);
    expect(container.querySelector("pre")!.textContent!.split("\n")[0]).toHaveLength(80);
  });

  // Mutation: reset leaves overrides in state, or the button does not dispatch reset.
  it("resets explicit controls to the current target's defaults", () => {
    pickToggle("Charset", "ascii");
    pickToggle("Color", "ansi16");
    pickToggle("Target", "web");
    expect(outputControls()).toEqual(["web", "ascii", "ansi16"]);
    act(() => resetOutputButton().click());
    expect(outputControls()).toEqual(["web", "braille", "css"]);
    expect(outputSize()).toEqual(["96", "32"]);
  });

  // Mutation: inject result.text with SGR into <pre>, or lose the decoded colour.
  // The viewport carries no explanatory note any more (the render area holds
  // only the chart) — decoded colour and the Copy ANSI affordance are the
  // whole test.
  it("shows a decoded-colour terminal frame, never raw SGR bytes, with no readout in the viewport", () => {
    pickToggle("Target", "terminal");
    expect(container.querySelector(".target-preview--terminal")).not.toBeNull();
    expect(container.querySelector("pre")!.textContent).not.toContain("\x1b");
    expect(container.querySelector("pre span[style]")).not.toBeNull();
    expect(container.querySelector(".charts-viewport p")).toBeNull();
    expect(button("Copy ANSI")).toBeDefined();
  });

  // Mutation: show an ANSI copy affordance for a terminal render explicitly set to no colour.
  it("shows plain text without ANSI controls for a terminal with color none", () => {
    pickToggle("Target", "terminal");
    pickToggle("Color", "none");
    expect(container.querySelector("pre")!.textContent).not.toContain("\x1b");
    expect(container.querySelector("pre span")).toBeNull();
    expect(button("Copy ANSI")).toBeUndefined();
  });

  // Mutation: choose plain display for the web target or escape its HTML rather than mounting the spans.
  it("renders the web target's coloured HTML in the preview", () => {
    pickToggle("Target", "web");
    expect(container.querySelector("pre span[style]")).not.toBeNull();
    expect(container.querySelector("pre")!.textContent).not.toContain("<span");
    expect(container.querySelector("pre")!.textContent).not.toContain("\x1b");
  });

  // Colour controls: an axis colour picked in the Dock (Chart folder's
  // "Axes" row) reaches the real render through `applyChartStyle` — this is
  // a full render-level check (`@glyphcss/charts` now accepts `axes.color`
  // for real, merged from the parallel packet), not just the pure spec
  // assertions in `chartsWorkbenchRender.style.test.ts`.
  it("an axis colour picked in the Dock reaches the HTML preview's own axis span colour", () => {
    pickToggle("Target", "web");
    const axisSpan = () => Array.from(container.querySelectorAll<HTMLElement>("pre span")).find((s) => /[┤┴└│─]/.test(s.textContent ?? ""));
    expect(axisSpan()!.getAttribute("style")).not.toContain("#ff0000");
    const swatch = container.querySelector<HTMLInputElement>('.charts-axis-color input[type="color"]')!;
    expect(swatch).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(swatch, "#ff0000");
      swatch.dispatchEvent(new Event("input", { bubbles: true }));
      swatch.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(axisSpan()!.getAttribute("style")).toContain("#ff0000");
  });

  // P2-6 (REVIEW-dock-colours-sliders-opus.md): the Output folder's reset
  // must never destroy a Chart-folder style choice, and the Chart folder
  // gets its own reset for exactly that — tested at the DOM level, through
  // the actual axis-colour swatch and both header reset buttons, since a
  // reducer-level test alone can't see which folder's button is wired to
  // which action.
  it("the Output reset leaves a picked axis colour alone; the Chart folder's own reset clears it", () => {
    const swatch = container.querySelector<HTMLInputElement>('.charts-axis-color input[type="color"]')!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(swatch, "#ff0000");
      swatch.dispatchEvent(new Event("input", { bubbles: true }));
      swatch.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(swatch.value).toBe("#ff0000");
    act(() => resetOutputButton().click());
    expect(swatch.value).toBe("#ff0000");
    const chartResetButtons = Array.from(container.querySelectorAll<HTMLButtonElement>(".dock-folder-title-reset-button"));
    expect(chartResetButtons).toHaveLength(2);
    const chartReset = folderResetButton("Reset axis colour");
    act(() => chartReset.click());
    expect(swatch.value).not.toBe("#ff0000");
  });

  // REVIEW-dock-addenda-opus.md P3-1/P3-2 — the reset control is a plain
  // DOM sibling of the folder's own native `.title` (lil-gui's title is a
  // `<button>`, so nesting a control inside it is invalid), inserted right
  // after `.title` (P3-1: still the FIRST focus stop after the title, not
  // the last one in the folder — appending it after `.children` used to
  // put it 19 tab stops past the title). A click on it must not ALSO
  // toggle the folder open/closed: the `.closed` CSS class is not a
  // reliable synchronous signal for this (lil-gui's open/close is
  // ANIMATED — `.title`'s own click handler calls `openAnimated`, which
  // defers the `.closed` class toggle to a `requestAnimationFrame` +
  // transition-end callback, so it never lands synchronously in a test and
  // the old assertion here could never have gone red). Spying on lil-gui's
  // OWN `open`/`close`/`openAnimated` methods is the real synchronous
  // signal: every path that actually toggles a folder goes through one of
  // them, and a `stopPropagation`-less, nested-in-`.title` reset (the
  // mutation this test must catch) would call `openAnimated` via the
  // bubbled click.
  it("the folder-title-bar reset sits inside the folder right after .title, and clicking it never toggles the folder — open or closed", () => {
    const outputReset = resetOutputButton();
    const outputFolder = outputReset.closest(".lil-gui.dock-folder-title-reset")!;
    expect(outputFolder).not.toBeNull();
    expect(outputFolder.contains(outputReset)).toBe(true);
    const title = outputFolder.querySelector(":scope > .title")!;
    expect(title.contains(outputReset)).toBe(false);
    // P3-1: the reset is the tab stop right after the title, not the last
    // child in the folder (`.title`, `[reset]`, THEN `.children`).
    expect(Array.from(outputFolder.children).indexOf(outputReset)).toBe(Array.from(outputFolder.children).indexOf(title) + 1);

    const openAnimatedSpy = vi.spyOn(GUI.prototype, "openAnimated");
    const openSpy = vi.spyOn(GUI.prototype, "open");
    const closeSpy = vi.spyOn(GUI.prototype, "close");
    // Case 1: the folder starts open (this page's own default) — reset
    // must not close it.
    act(() => outputReset.click());
    expect(openAnimatedSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
    // Case 2: close the folder through the ONE real interaction lil-gui
    // exposes for it — clicking its own title — then reset must not
    // reopen it.
    act(() => (title as HTMLButtonElement).click());
    expect(openAnimatedSpy).toHaveBeenCalledTimes(1); // sanity: the title itself still works
    openAnimatedSpy.mockClear();
    act(() => outputReset.click());
    expect(openAnimatedSpy).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    expect(closeSpy).not.toHaveBeenCalled();
  });

  // P3-6 (REVIEW-dock-colours-sliders-opus.md): under `Color: none` the
  // library drops every colour, but every swatch stayed fully enabled with
  // no signal — a picked value that paints nothing should read as inert,
  // not broken.
  it("Color: none dims the axis and mark colour swatches, with a reason", () => {
    const axisSwatch = () => container.querySelector<HTMLInputElement>('.charts-axis-color input[type="color"]')!;
    const markSwatch = () => container.querySelector<HTMLInputElement>('.charts-mark-colors input[type="color"]')!;
    expect(axisSwatch().disabled).toBe(false);
    expect(markSwatch().disabled).toBe(false);
    pickToggle("Color", "none");
    expect(axisSwatch().disabled).toBe(true);
    expect(markSwatch().disabled).toBe(true);
    expect(axisSwatch().closest(".charts-color-row")!.getAttribute("title")).toMatch(/Color mode is off/);
    pickToggle("Color", "css");
    expect(axisSwatch().disabled).toBe(false);
    expect(markSwatch().disabled).toBe(false);
  });

  // Mutation: copy result.text (the ANSI encoding) from Copy ASCII, or copy plain cells from Copy ANSI.
  it("copies plain cells from Copy ASCII and escapes from Copy ANSI", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    pickToggle("Target", "terminal");
    const plain = container.querySelector("pre")!.textContent!;
    await act(async () => button("Copy ASCII").click());
    expect(writeText).toHaveBeenLastCalledWith(plain);
    expect(writeText.mock.calls[0]![0]).not.toContain("\x1b");
    await act(async () => button("Copy ANSI").click());
    const ansi = writeText.mock.calls[1]![0];
    expect(ansi).toContain("\x1b[");
    expect(ansi.replace(/\x1b\[[0-9;]*m/g, "")).toBe(plain);
  });

  // Mutation: leave preset buttons disconnected from the editor/render state.
  it("renders a preset selected by its button", () => {
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Apply Bar"]')!.click());
    expect(activeMarkType()).toBe("bar");
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Mark 1 x"]')!.value).toBe("month");
    expect(container.querySelector("pre")!.textContent).toContain("Bar");
  });

  it("final-gate-2 (codex #7): Copy link encodes the CURRENT state at click time, not whatever the debounced URL writer last committed", async () => {
    // Mutation: revert `copyLink` to `navigator.clipboard.writeText(window
    // .location.href)` -> selecting Area and copying immediately (before
    // the 150ms debounce fires) copies the PREVIOUS (default "Line")
    // chart's link -> the decoded title below reddens.
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Apply Area"]')!.click());
    // No timer advance — the debounced urlWriter has NOT fired yet.
    act(() => button("Copy link").click());
    await act(async () => { await vi.waitFor(() => expect(writeText).toHaveBeenCalled()); });
    const link = writeText.mock.calls.at(-1)![0] as string;
    const param = new URLSearchParams(link.split("?")[1] ?? "").get("c");
    const decoded = await decodeChartsUrlState(param);
    expect(decoded).not.toBeNull();
    expect(decoded!.chart.title).toBe("Area");
  });

  // Data folder end-to-end (AGENTS.md's "Charts" — "Data layer"): picking a
  // real vendored dataset from the overlay's browse chevron IMMEDIATELY
  // replaces the marks with its recommended mapping AND sets an explicit
  // time x-scale (see chartsDatasetDateAxis.test.ts's header comment — a
  // date column is a plain ISO string, so nothing downstream infers "time"
  // on its own) — no separate "Apply" step exists any more (item 1).
  it("Data folder: choosing a dataset immediately replaces the chart with its recommended mapping and a real time x-scale", () => {
    selectChartsDataset(container, "global-temperature");
    expect(container.querySelector(".charts-data-info")!.textContent).toContain("NASA GISS");
    expect(container.querySelectorAll(".charts-mark-card")).toHaveLength(1);
    expect(activeMarkType()).toBe("line");
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Mark 1 x"]')!.value).toBe("year");
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Mark 1 y"]')!.value).toBe("anomaly_c");
    expect(container.querySelector(".synth-viewport pre")!.textContent).toContain("Global temperature anomaly");
    // The x scale's "auto" default would infer `band` for a plain ISO
    // string column (see this file's header comment) — `select-dataset`
    // must have forced `time` explicitly, which is directly observable in
    // the rendered preview: a real multi-scale year label, never a raw ISO
    // string fragment.
    expect(container.querySelector(".synth-viewport pre")!.textContent).toMatch(/\b(19|20)\d{2}\b/);
    expect(container.querySelector(".synth-viewport pre")!.textContent).not.toContain("T00:00:00");
  });

  // `buildDatasetMark` grew a 5th `transform` parameter (feat/diagrams
  // `b2278e2f`, vendoring the flow/stacked datasets) and `select-dataset`
  // must forward a curated `recommended.transform` (e.g. this dataset's
  // `"stack"`) through to it — the old 4-arg call silently dropped it, so
  // the mark rendered as an OVERLAPPING (unstacked) area instead of a
  // stacked one, with no ledger reject to notice by (an unstacked area is
  // still valid input). Checked at the DOM layer (the mark's own Transform
  // `<select>`, which mirrors `mark.transform` exactly) rather than the
  // reducer directly, so this is the same "what a reader would see" proof
  // the other Data-folder tests in this block use.
  it("Data folder: choosing a stacked-area dataset (energy-consumption-by-source) carries its curated transform to the mark and renders with no ledger reject", () => {
    selectChartsDataset(container, "energy-consumption-by-source");
    expect(activeMarkType()).toBe("area");
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Mark 1 transform"]')!.value).toBe("stack");
    expect(container.querySelector(".charts-error")).toBeNull();
    const pre = container.querySelector(".synth-viewport pre")!;
    expect(pre.textContent).toContain("World primary energy consumption by source");
    expect(pre.textContent!.trim().length).toBeGreaterThan(0);
  });

  // P3-6 (review fix, REVIEW-showcase-opus.md): the sankey/funnel
  // mark-type buttons must be DISABLED (with a reason, never a raw ledger
  // error a click would otherwise reach) on a dataset that can't feed
  // them, and ENABLED on a genuinely flow-shaped one — proven against the
  // real vendored flow datasets now that `feat/diagrams` `b2278e2f` added
  // them, not just a synthetic fixture.
  it("Data folder: sankey/funnel mark-type buttons are disabled on a line dataset and enabled on their own flow datasets", () => {
    const select = (id: string) => selectChartsDataset(container, id);
    select("global-temperature");
    const sankeyBtn = container.querySelector<HTMLButtonElement>('[aria-label^="Mark 1 type: sankey"]')!;
    const funnelBtn = container.querySelector<HTMLButtonElement>('[aria-label^="Mark 1 type: funnel"]')!;
    expect(sankeyBtn.disabled).toBe(true);
    expect(funnelBtn.disabled).toBe(true);
    expect(sankeyBtn.title.length).toBeGreaterThan(0);

    select("energy-flow-sankey");
    expect(activeMarkType()).toBe("sankey");
    expect(container.querySelector<HTMLButtonElement>('[aria-label^="Mark 1 type: sankey"]')!.disabled).toBe(false);

    select("ecommerce-conversion-funnel");
    expect(activeMarkType()).toBe("funnel");
    expect(container.querySelector<HTMLButtonElement>('[aria-label^="Mark 1 type: funnel"]')!.disabled).toBe(false);
  });

  it("choosing a different dataset replaces the chart again, with no accumulation", () => {
    const select = (id: string) => selectChartsDataset(container, id);
    select("global-temperature");
    select("iris-flowers");
    expect(container.querySelectorAll(".charts-mark-card")).toHaveLength(1);
    expect(activeMarkType()).toBe("dot");
    expect(container.querySelector(".synth-viewport pre")!.textContent).not.toContain("Global temperature");
  });

  it("opens only the selected mobile drawer and closes it with Escape", () => {
    const tabs = container.querySelectorAll<HTMLButtonElement>(".dn-mobile-tabs button");
    act(() => tabs[0]!.click());
    expect(container.querySelector("#charts-data-panel")!.classList.contains("is-mobile-open")).toBe(true);
    act(() => tabs[1]!.click());
    expect(container.querySelector("#charts-data-panel")!.classList.contains("is-mobile-open")).toBe(false);
    expect(container.querySelector("#charts-controls-panel")!.classList.contains("is-mobile-open")).toBe(true);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelectorAll(".is-mobile-open")).toHaveLength(0);
  });

  // ── Data overlay (AGENTS.md's "Charts" — "Data layer"): ONE centered
  // search field (`ChartsDatasetSearchBox.tsx`) plus "Random" pinned to
  // its right, floating over the chart VIEWPORT (`ChartsDataOverlay.tsx`),
  // exactly the way `/maps` places its own centered place search over the
  // map — the user's own words: "the search box should be centered like
  // the one in /maps... and the dataset dropdown could be just an arrow
  // inside the search field — I don't need two dataset pickers — and the
  // random button at the right." The rail keeps only the dataset CARD and
  // the Marks section; the Dock still carries no "Data" folder.
  it("the data overlay is one search field (no <select> anywhere on the page) plus Random, not the rail, and the rail body shows the dataset card with no Data folder left in the Dock", () => {
    const rail = container.querySelector("#charts-data-panel")!;
    const main = container.querySelector(".synth-main")!;
    const overlay = main.querySelector(".charts-data-overlay")!;
    expect(overlay).not.toBeNull();
    // Other selects legitimately remain (mark channel pickers etc.) — only
    // the dataset select is gone.
    expect(container.querySelectorAll('select[aria-label="Dataset"]')).toHaveLength(0);
    expect(overlay.querySelector('input[role="combobox"]')).not.toBeNull();
    expect(overlay.querySelector('[aria-label="Browse datasets"]')).not.toBeNull();
    expect(overlay.querySelector('[aria-label="Load random dataset"]')).not.toBeNull();
    // The rail's own header carries none of the overlay's controls.
    const railHead = rail.querySelector(".synth-voices-head")!;
    expect(railHead.querySelector('[aria-label="Load random dataset"]')).toBeNull();
    expect(railHead.querySelector('input[role="combobox"]')).toBeNull();
    expect(rail.querySelector(".charts-data-folder")).not.toBeNull();
    // The Dock (`#charts-controls-panel`) still owns no "Data" folder —
    // `ChartsDock.tsx` still owns "Output"/"Chart"/"Scales"/"Axes"/"Terminal".
    const dockFolderTitles = Array.from(container.querySelectorAll("#charts-controls-panel .lil-gui > .title")).map((n) => n.textContent);
    expect(dockFolderTitles).not.toContain("Data");
  });

  // Centering parity with `/maps`: happy-dom computes no CSS cascade (no
  // layout/paint engine — this file's own Glyph Mono font test above
  // already establishes the CSS-source-reading idiom for exactly that
  // reason), so this reads both stylesheets' raw text and checks
  // `.charts-dataset-search` carries the SAME left/transform/width/top
  // declarations `.maps-search` does, rather than merely similar ones.
  // Equal left/right margins from a `left: 50%; transform:
  // translateX(-50%)` pair is what "centered" (equal margins) MEANS for an
  // element whose own width is fixed independent of viewport width.
  it("the search field is centered exactly the way /maps' own search field is (same left/transform/width/top)", () => {
    const chartsCss = readFileSync(fileURLToPath(new URL("./charts-workbench.css", import.meta.url)), "utf8");
    const mapsCss = readFileSync(fileURLToPath(new URL("../MapsWorkbench/maps-workbench.css", import.meta.url)), "utf8");
    const fieldRule = chartsCss.match(/\.charts-dataset-search \{[^}]*\}/)![0];
    const mapsRule = mapsCss.match(/\.maps-search \{[^}]*\}/)![0];
    for (const rule of [fieldRule, mapsRule]) {
      expect(rule).toMatch(/left:\s*50%/);
      expect(rule).toMatch(/transform:\s*translateX\(-50%\)/);
      expect(rule).toMatch(/width:\s*min\(340px, calc\(100% - 24px\)\)/);
      expect(rule).toMatch(/top:\s*var\(--overlay-top,\s*12px\)/);
    }
  });

  // The chevron ("Browse datasets") replaces the old stock `<select>`: it
  // opens the SAME results list the search uses, pre-filled with every
  // vendored dataset under "Built-in" and every curated Hugging Face
  // suggestion under "Hugging Face" — the task's own "existing empty-query
  // suggestion behaviour", just with a browse-list entry point that needs
  // no typing at all.
  it("the chevron opens a list with every vendored title under \"Built-in\" and every curated dataset under \"Hugging Face\"", () => {
    const overlay = container.querySelector(".charts-data-overlay")!;
    const chevron = overlay.querySelector<HTMLButtonElement>('[aria-label="Browse datasets"]')!;
    expect(overlay.querySelector(".instrument-search-list")).toBeNull();
    act(() => chevron.click());
    const list = overlay.querySelector(".instrument-search-list")!;
    expect(list).not.toBeNull();
    const headings = Array.from(list.querySelectorAll(".instrument-search-group")).map((n) => n.textContent);
    expect(headings).toContain("Built-in");
    expect(headings).toContain("Hugging Face");
    const names = Array.from(list.querySelectorAll(".instrument-search-name")).map((n) => n.textContent);
    for (const dataset of CHARTS_DATASETS) expect(names).toContain(dataset.title);
    for (const hit of CHARTS_REMOTE_DATASET_INDEX) expect(names).toContain(hit.title);
  });

  // Typing narrows the "Built-in" group locally (title/id substring, no
  // network) — proven with a query that matches exactly one vendored
  // dataset title and nothing else in either group.
  it("typing in the search field filters the \"Built-in\" group", () => {
    const overlay = container.querySelector(".charts-data-overlay")!;
    const chevron = overlay.querySelector<HTMLButtonElement>('[aria-label="Browse datasets"]')!;
    act(() => chevron.click());
    const input = overlay.querySelector<HTMLInputElement>(".instrument-search-input")!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "unemployment");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const list = overlay.querySelector(".instrument-search-list")!;
    const names = Array.from(list.querySelectorAll(".instrument-search-name")).map((n) => n.textContent);
    expect(names).toEqual(["US unemployment rate"]);
  });

  // Picking a vendored entry from the browse list dispatches the SAME
  // `select-dataset` action the old `<select>` did — same assertion the
  // removed select test used (the recommended mapping renders immediately).
  it("picking a vendored entry from the chevron's list renders it immediately", () => {
    selectChartsDataset(container, "iris-flowers");
    expect(chartsActiveDatasetTitle(container)).toBe("Iris flower measurements");
    expect(activeMarkType()).toBe("dot");
  });

  // Idle display: the field shows the currently loaded dataset's title
  // when not focused — cleared on focus so typing starts fresh, restored
  // on blur with no pick (`ChartsDatasetSearchBox.tsx`'s own doc).
  it("the field shows the loaded dataset's title when idle, clears on focus, and restores on blur with no pick", async () => {
    selectChartsDataset(container, "iris-flowers");
    // `choose()` blurs the field itself (settling it back to the idle
    // title) through the SAME deferred `setTimeout(0)` a real blur does
    // (`ChartsDatasetSearchBox.tsx`'s own doc) — this block runs under
    // real timers, so that needs a real tick to actually land.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const overlay = container.querySelector(".charts-data-overlay")!;
    const input = overlay.querySelector<HTMLInputElement>(".instrument-search-input")!;
    expect(input.value).toBe("Iris flower measurements");
    act(() => { input.focus(); input.dispatchEvent(new Event("focus", { bubbles: true })); });
    expect(input.value).toBe("");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "some typed text with no pick");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { input.blur(); input.dispatchEvent(new Event("blur", { bubbles: true })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(input.value).toBe("Iris flower measurements");
  });

  // Keyboard/a11y (owner packet item 4): field -> chevron -> Random is the
  // natural DOM/tab order inside the overlay bar, and the search list's
  // own dropdown is an ABSOLUTELY POSITIONED overlay (never a normal-flow
  // sibling that would push Random sideways when it opens).
  it("the data overlay's tab order is field, then chevron, then Random, and the search list floats rather than reflowing the bar", async () => {
    const overlay = container.querySelector(".charts-data-overlay")!;
    const focusable = Array.from(overlay.querySelectorAll("input, button"));
    expect(focusable[0]!.getAttribute("role")).toBe("combobox");
    expect((focusable[1] as HTMLButtonElement).getAttribute("aria-label")).toBe("Browse datasets");
    expect((focusable[2] as HTMLButtonElement).getAttribute("aria-label")).toBe("Load random dataset");
    // Focusing alone opens the list — the curated suggestions render with
    // no query typed and no network call (`ChartsDatasetSearchBox.tsx`'s
    // own doc), so this needs no timer advance and touches no fetch stub.
    const input = overlay.querySelector<HTMLInputElement>(".instrument-search-input")!;
    act(() => { input.focus(); input.dispatchEvent(new Event("focus", { bubbles: true })); });
    const list = overlay.querySelector(".instrument-search-list");
    expect(list).not.toBeNull();
    // The list is a child of the search box's own wrapper, a SIBLING of
    // (never a wrapper around) Random — so it never displaces it in the
    // DOM, and `charts-workbench.css`'s own `.charts-dataset-search
    // .instrument-search-list` rule is what keeps it floating over the
    // render instead of growing the field's own box.
    expect(list!.closest(".charts-dataset-search")).not.toBeNull();
    expect(overlay.querySelector('[aria-label="Load random dataset"]')).not.toBeNull();
    // Escape closes the list.
    act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    expect(overlay.querySelector(".instrument-search-list")).toBeNull();
  });

  it("the rail also carries the Marks section, below the dataset card, with no add/remove control", () => {
    const rail = container.querySelector("#charts-data-panel")!;
    expect(rail.querySelector(".charts-marks-section")).not.toBeNull();
    expect(rail.querySelectorAll(".charts-mark-card")).toHaveLength(1);
    expect(rail.querySelector('[aria-label="Remove mark 1"]')).toBeNull();
    expect(Array.from(rail.querySelectorAll("button")).some((b) => b.textContent === "+ Add mark")).toBe(false);
  });

  // ── Mark type is now an icon toggle (owner packet item 3, extended to
  // the mark card), replacing the old `<select>`. Switching it must both
  // update the render AND reach the `?c=` link, same as every other
  // dispatched change.
  it("the mark-type icon toggle switches types and the change reaches the encoded URL", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    expect(activeMarkType()).toBe("line");
    const typeGroup = container.querySelector('.charts-mark-row[data-row="type"]')!;
    const barButton = Array.from(typeGroup.querySelectorAll<HTMLButtonElement>(".gx-toggle-btn")).find((b) => optionOf(b.getAttribute("aria-label") ?? "") === "bar")!;
    act(() => barButton.click());
    expect(activeMarkType()).toBe("bar");
    act(() => button("Copy link").click());
    await act(async () => { await vi.waitFor(() => expect(writeText).toHaveBeenCalled()); });
    const link = writeText.mock.calls.at(-1)![0] as string;
    const param = new URLSearchParams(link.split("?")[1] ?? "").get("c");
    const decoded = await decodeChartsUrlState(param);
    expect(decoded).not.toBeNull();
    expect(decoded!.marks[0]!.type).toBe("bar");
  });

  // options.strokeWidth (AGENTS.md's "Charts" — "options.strokeWidth"): a
  // per-mark Stroke row, same shape as innerRadius/axis (`mark.options`,
  // forwarded straight into the built spec — no `applyChartStyle` in the
  // loop). It's a `.voice-slider` (the Width/Height rows' own shape,
  // reimplemented outside lil-gui since a mark card isn't a lil-gui
  // folder), not an `IconToggle` — `@glyphcss/charts`' own
  // `strokeWidth.test.ts` already proves a wider stroke changes rendered
  // ink; this only needs to prove the drag reaches the render.
  function strokeSliderRow(): HTMLElement {
    return container.querySelector<HTMLElement>('.voice-slider[data-row="strokeWidth"]')!;
  }
  function strokeSliderInput(): HTMLInputElement {
    return strokeSliderRow().querySelector<HTMLInputElement>('input[type="range"]')!;
  }
  function setRangeValue(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  it("the Stroke row is enabled for a line mark, and dragging to 3 changes the rendered ink", () => {
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Apply Line"]')!.click());
    expect(strokeSliderInput().disabled).toBe(false);
    expect(strokeSliderInput().value).toBe("1");
    const before = container.querySelector("pre.glyph-output")!.textContent!;
    setRangeValue(strokeSliderInput(), "3");
    expect(strokeSliderInput().value).toBe("3");
    const after = container.querySelector("pre.glyph-output")!.textContent!;
    expect(after).not.toBe(before);
  });

  it("the Stroke row dims with a reason on a mark type with no stroke (bar)", () => {
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Apply Bar"]')!.click());
    expect(strokeSliderInput().disabled).toBe(true);
    expect(strokeSliderRow().title).toMatch(/Only line, area, and rule marks have a stroke\./);
    expect(strokeSliderRow().className).toContain("is-disabled");
  });

  // Arc "Labels" (AGENTS.md's "Charts" — "Arc shape and callouts"): the
  // mark card's own IconToggle for `options.labels`, arc-only. "Off"
  // (`legend-only`) drops the on-chart leader-line callout text (`name ·
  // NN%`) while the legend row (unaffected either way) still names each
  // slice.
  function labelsToggle(): HTMLElement {
    return container.querySelector<HTMLElement>('.charts-mark-row[data-row="labels"]')!;
  }
  it("hides the Labels row on a non-arc mark and shows it on arc", () => {
    expect(container.querySelector('.charts-mark-row[data-row="labels"]')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Apply Pie"]')!.click());
    expect(activeMarkType()).toBe("arc");
    expect(labelsToggle()).not.toBeNull();
  });

  it("switching arc Labels to Off removes the callout text from the render while the legend stays", () => {
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Apply Pie"]')!.click());
    const pre = () => container.querySelector("pre.glyph-output")!.textContent!;
    // Callout is the library default (`options.labels` unset) — a slice's
    // "name · NN%" leader-line label carries a "%" sign the legend's own
    // swatch + name row never does.
    expect(pre()).toContain("%");
    const offButton = Array.from(labelsToggle().querySelectorAll<HTMLButtonElement>(".gx-toggle-btn")).find((b) => optionOf(b.getAttribute("aria-label") ?? "") === "Off")!;
    act(() => offButton.click());
    expect(offButton.getAttribute("aria-pressed")).toBe("true");
    expect(pre()).not.toContain("%");
    expect(container.querySelector(".charts-error")).toBeNull();
  });

  // ── The dataset card's read-only table/JSON views (item 5) are real
  // surfaces a reader rarely needs open — collapsed by default (native
  // `<details>`, no URL state) and revealed only on request.
  it("the dataset card's data table/JSON views are hidden by default and open on clicking \"View data\"", () => {
    selectChartsDataset(container, "iris-flowers");
    const details = container.querySelector<HTMLDetailsElement>(".charts-data-info .charts-mark-data-details")!;
    expect(details.open).toBe(false);
    // Closed by default doesn't mean absent — the tabs/panels still exist,
    // just collapsed; only `open` gates their visibility.
    expect(details.querySelector('[role="tablist"]')).not.toBeNull();
    const summary = details.querySelector("summary")!;
    act(() => summary.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    expect(details.open).toBe(true);
    // Read-only: no `<input>` anywhere in the table view.
    expect(details.querySelector(".charts-grid input")).toBeNull();
    const jsonTab = Array.from(details.querySelectorAll('[role="tab"]')).find((node) => node.textContent === "JSON") as HTMLButtonElement;
    act(() => jsonTab.click());
    expect(details.querySelector<HTMLTextAreaElement>("textarea")?.readOnly).toBe(true);
  });

  // Item 2 — same look/placement as GalleryWorkbench.tsx's own "Load
  // Random" button: picks a DIFFERENT dataset than the one currently
  // loaded, immediately (no Apply step).
  it("the rail's Random button loads a different dataset immediately", () => {
    selectChartsDataset(container, "iris-flowers");
    const randomButton = container.querySelector<HTMLButtonElement>('[aria-label="Load random dataset"]')!;
    for (let i = 0; i < 8; i++) {
      const before = chartsActiveDatasetTitle(container);
      act(() => randomButton.click());
      expect(chartsActiveDatasetTitle(container)).not.toBe(before);
      expect(chartsActiveDatasetTitle(container)).not.toBe("");
    }
  });

  // ── Density (the user's own framing: "like in the 3D renderers we have
  // the density sliders" — AGENTS.md's "Per-mesh detail layers"). Real
  // lil-gui `useSlider`, same NumberController the Width/Height rows use
  // (one `<input type="text">`, no native `<input type="range">` —
  // `NumberController._initInput`), set the SAME way the ticks number
  // field already is (`setter.call` + a bubbled "input" event).
  const setInputValue = (input: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  };
  function densityInput(): HTMLInputElement {
    return controller("Density").querySelector<HTMLInputElement>("input")!;
  }

  it("the Density row sits right after Height, defaults to 1, and doubles the render grid at 2 while halving the pre's own font-size", () => {
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Apply Line"]')!.click());
    const names = Array.from(container.querySelectorAll("#charts-controls-panel .controller .name")).map((n) => n.textContent);
    const widthAt = names.indexOf("Width");
    expect(names.slice(widthAt, widthAt + 3)).toEqual(["Width", "Height", "Density"]);
    expect(densityInput().value).toBe("1");
    const pre = () => container.querySelector<HTMLPreElement>("pre.glyph-output")!;
    // No inline font-size at density 1 — byte-identical to before this control existed.
    expect(pre().style.fontSize).toBe("");
    const before = pre().textContent!.split("\n");
    expect(before).toHaveLength(32); // web's own default height
    expect(before[0]).toHaveLength(96); // web's own default width
    setInputValue(densityInput(), "2");
    const after = pre().textContent!.split("\n");
    expect(after).toHaveLength(64);
    // Density also carries `@glyphcss/charts`' own `textScale: round(density)`
    // (AGENTS.md's "Charts" "Density" paragraph) — the title/tick text a
    // scaled row carries is painted through the HTML exit's own
    // `<span class="glyph-text">`, which emits NOTHING for a label's
    // filler columns (never a literal blank — the point is for the span's
    // own font-size-scaled advance width to fill that space instead), so a
    // row carrying scaled text reads SHORTER in the parsed DOM's own
    // `textContent` than the raw `cols` count. A row untouched by any
    // scaled label (most of the plot) still reads the full doubled width —
    // checked via the row-length MAXIMUM rather than a specific index, so
    // this doesn't depend on which row the preset happens to put its title
    // or a tick label on.
    expect(Math.max(...after.map((row) => row.length))).toBe(192);
    expect(pre().style.fontSize).toBe("calc(13px / 2)");
    expect(pre().style.lineHeight).toBe("1");
    // The library's `textScale: round(density)` (AGENTS.md's "Charts"
    // "Density" paragraph) reaches the mounted page: the HTML exit's own
    // `.glyph-text` spans, at `font-size:2em` RELATIVE to this same `<pre>`'s
    // `calc(13px / 2)` — so a scaled glyph paints at the ORIGINAL 13px,
    // over a `<pre>` whose OWN base size has been halved.
    expect(pre().innerHTML).toContain("glyph-text");
    expect(pre().innerHTML).toContain("font-size:2em");
  });

  it("Density is disabled with a reason on terminal and chat, and the render renders at density 1 there even with a dialed-in value", () => {
    setInputValue(densityInput(), "2");
    expect(container.querySelector("pre")!.textContent!.split("\n")).toHaveLength(64);
    for (const target of ["terminal", "chat"] as const) {
      pickToggle("Target", target);
      expect(densityInput().disabled).toBe(true);
      expect(controller("Density").classList.contains("disabled")).toBe(true);
      expect((controller("Density") as HTMLElement).title).toMatch(/Fixed cell size on this target/);
      const targetDefaults = target === "terminal" ? { rows: 24, cols: 80 } : { rows: 24, cols: 72 };
      const lines = container.querySelector("pre")!.textContent!.split("\n");
      expect(lines).toHaveLength(targetDefaults.rows);
      expect(lines[0]).toHaveLength(targetDefaults.cols);
    }
    pickToggle("Target", "web");
    expect(densityInput().disabled).toBe(false);
    expect(densityInput().value).toBe("2"); // the dialed-in value survived the round trip through terminal/chat
    expect(container.querySelector("pre")!.textContent!.split("\n")).toHaveLength(64);
  });

  it("the Output reset restores density to 1, with the render back at its unscaled grid", () => {
    setInputValue(densityInput(), "3");
    expect(container.querySelector("pre")!.textContent!.split("\n")).toHaveLength(96);
    act(() => resetOutputButton().click());
    expect(densityInput().value).toBe("1");
    expect(container.querySelector("pre")!.textContent!.split("\n")).toHaveLength(32);
    expect(container.querySelector<HTMLPreElement>("pre.glyph-output")!.style.fontSize).toBe("");
  });
});

// Render-area cleanup: a bad chart config's error surfaces in the RAIL's
// dataset card, never over the render, and the viewport dims instead of
// going blank.
describe("ChartsWorkbench — render errors stay out of the viewport", () => {
  let container: HTMLDivElement;
  let root: Root;
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  it("a broken chart config shows its error in the rail's dataset card, not the viewport, with the viewport dimmed", () => {
    // A mark whose `dataText` is invalid JSON fails at render — the mounted
    // page's own controls can no longer produce this (item 5's read-only
    // data view), so the state is built directly the same way the
    // "legacy-shaped link" showcase test below does.
    let state = createChartsWorkbenchState();
    state = reduceChartsWorkbenchState(state, { type: "update-mark", id: state.marks[0]!.id, patch: { dataText: "{not json" } });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<ChartsWorkbench initialState={state} />));
    const railError = container.querySelector("#charts-data-panel .charts-error");
    expect(railError).not.toBeNull();
    expect(railError!.getAttribute("role")).toBe("alert");
    expect(container.querySelector(".charts-viewport .charts-error")).toBeNull();
    expect(container.querySelector(".charts-viewport p")).toBeNull();
    expect(container.querySelector(".charts-grid-scroll")!.classList.contains("is-stale")).toBe(true);
    // Never had a good render to fall back to — the frame is empty (still
    // no readout in it) rather than showing anything wrong.
    expect(container.querySelector("pre.glyph-output")!.textContent).toBe("");
  });
});

// The pulse (`is-loading`) is a PAGE animation, applied via a plain CSS
// class — `prefers-reduced-motion` disables it with no JS branch, so this
// is a CSS-source assertion, the same idiom the Glyph Mono font test above
// (A4) already uses for a rule happy-dom can't compute the cascade for.
describe("ChartsWorkbench — reduced motion disables the viewport pulse", () => {
  it("the loading pulse keyframes are disabled under prefers-reduced-motion: reduce", () => {
    const css = readFileSync(fileURLToPath(new URL("./charts-workbench.css", import.meta.url)), "utf8");
    const reducedMotionBlock = css.match(/@media \(prefers-reduced-motion: reduce\) \{[^]*?\n\}/)![0];
    expect(reducedMotionBlock).toContain(".charts-grid-scroll.is-loading");
    expect(reducedMotionBlock).toMatch(/animation:\s*none/);
    expect(css).toMatch(/\.charts-grid-scroll\.is-stale\s*\{[^}]*opacity:\s*0\.45/);
  });
});

// ── /charts is a SHOWCASE, not a builder (items 2/3, AGENTS.md's "Charts" —
// "Data layer") — these mount the real page with no `initialState`, driving
// the actual `?c=` URL the same way a browser tab would, rather than going
// through the reducer/URL codec in isolation (already covered by
// chartsUrlState.test.ts's own round-trip/omission/rehydration suite).
describe("ChartsWorkbench — showcase mount (items 2/3)", () => {
  let container: HTMLDivElement;
  let root: Root;
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.history.replaceState(null, "", "/charts");
  });
  const mount = () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<ChartsWorkbench />));
  };
  // `vi.waitFor` wrapped in `act(async () => …)` never observes the decode
  // effect's own eventual `setResolved` call here — verified in isolation:
  // React's async `act()` scope defers flushing the state update the
  // `decodeChartsUrlState(...).then(...)` microtask makes, so the polled
  // assertion inside it never sees a change and times out even though the
  // SAME decode resolves and renders correctly within ~100ms when awaited
  // as a plain `setTimeout` poll outside any `act()` wrapper. Poll for the
  // real DOM change with plain timers, then a single trailing `act(() =>
  // {})` to acknowledge the update React already committed (silencing
  // "not wrapped in act" — a real warning about ordering, not a failure).
  const mountWithLink = async (raw: string) => {
    const url = new URL("http://localhost/charts");
    url.searchParams.set(CHARTS_URL_PARAM, raw);
    window.history.replaceState(null, "", url.pathname + url.search);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<ChartsWorkbench />));
    const start = Date.now();
    while (!container.querySelector(".synth-viewport pre")) {
      if (Date.now() - start > 3000) throw new Error("timed out waiting for the decoded chart to render");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    act(() => {});
  };

  it("mount with no ?c= param renders a stock dataset immediately", () => {
    window.history.replaceState(null, "", "/charts");
    mount();
    expect(CHARTS_DATASETS.map((d) => d.title)).toContain(chartsActiveDatasetTitle(container));
    expect(container.querySelectorAll(".charts-mark-card")).toHaveLength(1);
    expect(container.querySelector(".synth-viewport pre")!.textContent).toMatch(/\S/);
  });

  it("round-trips dataset + mark through a real ?c= link, carrying no dataText for the stock-dataset mark", async () => {
    const state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id: "iris-flowers" });
    const raw = await encodeChartsUrlState(state);
    await mountWithLink(raw);
    expect(chartsActiveDatasetTitle(container)).toBe("Iris flower measurements");
    expect(container.querySelector(".synth-viewport pre")!.textContent).toContain("Iris");
  });

  // A "legacy" link — one written before this feature existed — always
  // carried a mark's real data in full, alongside a `"dataset"` source; the
  // page must still render it exactly, with no re-derivation substituting
  // different content.
  it("a legacy-shaped link (real dataText alongside a dataset source) still renders that exact data", async () => {
    let state = reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id: "iris-flowers" });
    const divergentData = JSON.stringify([{ species: "made-up", sepal_length_cm: 1, petal_length_cm: 2 }], null, 2);
    state = reduceChartsWorkbenchState(state, { type: "update-mark", id: state.marks[0]!.id, patch: { dataText: divergentData } });
    const raw = await encodeChartsUrlState(state);
    await mountWithLink(raw);
    expect(container.querySelector(".synth-viewport pre")!.textContent).toContain("made-up");
  });
});

// ── Dataset search (glyphcss dataset-search feature) — the mounted page,
// with `global.fetch` stubbed to real `Response` objects shaped like the
// Hugging Face Hub search + datasets-server endpoints (never the real
// network). Its own `beforeEach`/`afterEach` install and tear down the
// stub so no other describe block in this file is affected.
describe("ChartsWorkbench — dataset search (remote)", () => {
  let container: HTMLDivElement;
  let root: Root;
  const STUB_ID = "stub/demo";
  function stubFetch(overrides: { search?: unknown; splits?: unknown; rows?: unknown; rowsStatus?: number } = {}) {
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("https://huggingface.co/api/datasets?")) {
        return new Response(JSON.stringify(overrides.search ?? [
          { id: STUB_ID, downloads: 42, likes: 1, private: false, gated: false, disabled: false, tags: ["format:csv", "modality:tabular"], cardData: { pretty_name: "Stub Demo" }, description: "A stub demo dataset." },
        ]), { status: 200 });
      }
      if (url.startsWith("https://datasets-server.huggingface.co/splits?")) {
        return new Response(JSON.stringify(overrides.splits ?? { splits: [{ config: "default", split: "train" }] }), { status: 200 });
      }
      if (url.startsWith("https://datasets-server.huggingface.co/rows?")) {
        return new Response(JSON.stringify(overrides.rows ?? {
          features: [{ name: "x" }, { name: "y" }],
          rows: [{ row_idx: 0, row: { x: 1, y: 2 } }, { row_idx: 1, row: { x: 3, y: 4 } }],
          num_rows_total: 2,
        }), { status: overrides.rowsStatus ?? 200 });
      }
      throw new Error(`unstubbed url in test: ${url}`);
    }));
  }
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    window.history.replaceState(null, "", "/charts");
    vi.unstubAllGlobals();
  });
  const mount = () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<ChartsWorkbench initialState={createChartsWorkbenchState()} />));
  };
  // The search box's own 250ms debounce — a plain awaited real-timer delay,
  // the same idiom `mountWithLink` above uses for the async decode effect
  // (see its own comment: `act(async () => vi.waitFor(...))` does not
  // observe a microtask-driven update reliably in this harness).
  const settleDebounce = () => new Promise((resolve) => setTimeout(resolve, 320));

  it("typing → live results → Enter loads and renders the chart, with no Apply step anywhere", async () => {
    stubFetch();
    mount();
    expect(container.querySelector(".charts-error")).toBeNull();
    expect(Array.from(container.querySelectorAll("button")).some((b) => b.textContent === "Apply")).toBe(false);
    const input = container.querySelector<HTMLInputElement>(".instrument-search-input")!;
    act(() => { input.focus(); input.dispatchEvent(new Event("focus", { bubbles: true })); });
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "demo");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { await settleDebounce(); });
    const option = container.querySelector<HTMLButtonElement>(".instrument-search-option");
    expect(option).not.toBeNull();
    expect(option!.textContent).toContain("Stub Demo");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const start = Date.now();
    while (!container.querySelector(".charts-data-info")) {
      if (Date.now() - start > 3000) throw new Error("timed out waiting for the remote dataset to load");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    act(() => {});
    expect(container.querySelector(".charts-data-info")!.textContent).toContain("Stub Demo");
    expect(container.querySelector(".synth-viewport pre")!.textContent).toMatch(/\S/);
    expect(container.querySelector(".charts-error")).toBeNull();
  }, 10_000);

  it("a failing remote load falls back to a random vendored dataset, with the error shown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
    mount();
    // Drive the load directly via a pasted bare id (skips the live-search
    // half entirely — `parseDatasetHitFromQuery` recognizes it with no
    // network call, so this exercises exactly the LOAD failure path).
    const input = container.querySelector<HTMLInputElement>(".instrument-search-input")!;
    act(() => { input.focus(); input.dispatchEvent(new Event("focus", { bubbles: true })); });
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, STUB_ID);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const before = chartsActiveDatasetTitle(container);
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const start = Date.now();
    const hasLoadFailureFeedback = () => Array.from(container.querySelectorAll(".charts-readout")).some((el) => el.textContent?.includes("Couldn't load"));
    while (!hasLoadFailureFeedback()) {
      if (Date.now() - start > 5000) throw new Error("timed out waiting for the load-failure fallback");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    act(() => {});
    // Fell back to SOME vendored dataset (never left on a blank/half state).
    expect(CHARTS_DATASETS.map((d) => d.title)).toContain(chartsActiveDatasetTitle(container));
    expect(container.querySelector(".synth-viewport pre")!.textContent).toMatch(/\S/);
    void before; // (documents intent: a different dataset than "none selected" — the exact id is randomized, not asserted)
  }, 10_000);

  // codex P2-13 (`REVIEW-batch4-codex.md`): a response body that fails to
  // READ (an HTTP 200 that then drops mid-transfer) used to escape both
  // `loadDatasetRows` and `ChartsWorkbench.tsx`'s own catch as a silent
  // no-op — no notice, no fallback, the loading spinner just vanishing.
  // Mounted repro, mirroring the 404 case above exactly but injecting a
  // body-read rejection instead of a bad status — a pasted raw-file URL
  // (`kind: "url"`) rather than a bare HF id, so this actually reaches
  // `loadRawFile`'s OWN body read (`readTextCapped`) rather than the
  // Hugging Face splits/meta calls, which were already individually
  // try/caught before this fix.
  it("a body-read failure after HTTP 200 shows the same load-failure notice and fallback as a network error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true, status: 200, headers: { get: () => null },
      text: async () => { throw new TypeError("network read failed"); },
    })));
    mount();
    const rawFileUrl = "https://raw.githubusercontent.com/o/r/main/d.csv";
    const input = container.querySelector<HTMLInputElement>(".instrument-search-input")!;
    act(() => { input.focus(); input.dispatchEvent(new Event("focus", { bubbles: true })); });
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, rawFileUrl);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    const start = Date.now();
    const hasLoadFailureFeedback = () => Array.from(container.querySelectorAll(".charts-readout")).some((el) => el.textContent?.includes("Couldn't load"));
    while (!hasLoadFailureFeedback()) {
      if (Date.now() - start > 5000) throw new Error("timed out waiting for the load-failure fallback");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    act(() => {});
    expect(CHARTS_DATASETS.map((d) => d.title)).toContain(chartsActiveDatasetTitle(container));
    expect(container.querySelector(".synth-viewport pre")!.textContent).toMatch(/\S/);
    // No stuck spinner — the loading readout is gone, not merely
    // superseded by a later one.
    expect(container.querySelector(".charts-data-loading")).toBeNull();
  }, 10_000);

  it("a ?c= link naming a remote dataset re-fetches on decode (rows are never in the link) and renders the fresh chart", async () => {
    stubFetch();
    const linkState = {
      ...createChartsWorkbenchState(),
      data: { source: { kind: "remote" as const, ref: STUB_ID, title: "Stub Demo", description: "old description", source: { name: "Hugging Face — stub/demo", url: "https://huggingface.co/datasets/stub/demo" } }, pipeline: [] },
    };
    const raw = await encodeChartsUrlState(linkState);
    const url = new URL("http://localhost/charts");
    url.searchParams.set(CHARTS_URL_PARAM, raw);
    window.history.replaceState(null, "", url.pathname + url.search);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<ChartsWorkbench />));
    // NOT `.charts-data-info`'s mere presence — this mount decodes straight
    // into an ALREADY-`remote`-shaped state (`linkState.data.source`, the
    // STALE title/description carried in the link itself, per the doc
    // above: "rows are never in the link"), so `.charts-data-info` (`remote
    // && !loadingTitle`, `ChartsDataFolder.tsx`) can already be satisfied on
    // the very FIRST render — before `loadRemoteDataset`'s effect has even
    // set `remoteLoadingTitle`, let alone resolved the re-fetch — making
    // this a genuine race, not a timing quirk: whichever of "the stale
    // paint" and "the loading effect's first `setState`" React happens to
    // flush first inside `act()` decides whether the poll below observes
    // the stale shell or the real load in flight, and that ordering is
    // exactly the kind of thing sensitive to how much other work shares the
    // process (reproduced: reliably passes when this file's other tests run
    // first and warm up the event loop, reliably fails run alone). Waiting
    // for the FRESH title instead (`parseDatasetHitFromQuery`'s own
    // `title: value` for a bare id, i.e. `STUB_ID` itself — "stub/demo",
    // never the stale "Stub Demo" pretty-name the link carried) only
    // becomes true once `select-remote-dataset` has actually dispatched,
    // which is the one signal this test is actually trying to wait for.
    const start = Date.now();
    while (container.querySelector(".charts-data-title")?.textContent !== STUB_ID) {
      if (Date.now() - start > 3000) throw new Error("timed out waiting for the remote re-fetch to land");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    act(() => {});
    expect(container.querySelector(".synth-viewport pre")!.textContent).toMatch(/\S/);
    expect(container.querySelector(".charts-error")).toBeNull();
  }, 10_000);

  // P1-4 (CHARTS-RESEARCH `REVIEW-batch4-codex.md`): the existing
  // generation guard (this describe block's own doc, above — P2-5) only
  // ever protected a remote load against a LATER remote load. Picking a
  // STOCK dataset while an earlier remote fetch is still in flight left
  // that guard untouched, so the stale remote result landed on TOP of the
  // reader's stock pick once it finally resolved.
  it("selecting a stock dataset while a remote load is in flight keeps the stock pick when the remote response later resolves", async () => {
    let resolveRows: ((response: Response) => void) | undefined;
    const rowsPromise = new Promise<Response>((resolve) => { resolveRows = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.startsWith("https://datasets-server.huggingface.co/splits?")) {
        return new Response(JSON.stringify({ splits: [{ config: "default", split: "train" }] }), { status: 200 });
      }
      if (url.startsWith("https://datasets-server.huggingface.co/rows?")) {
        return rowsPromise; // deferred — this test resolves it explicitly, below
      }
      throw new Error(`unstubbed url in test: ${url}`);
    }));
    mount();
    // Pasted bare id: `parseDatasetHitFromQuery` recognizes it with no
    // search-endpoint call, so only `/splits` + the deferred `/rows` are
    // in flight once this fires (mirrors the "failing remote load" test's
    // own paste-and-Enter path, above).
    const input = container.querySelector<HTMLInputElement>(".instrument-search-input")!;
    act(() => { input.focus(); input.dispatchEvent(new Event("focus", { bubbles: true })); });
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, STUB_ID);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    // The remote load is now in flight (`/rows` deferred) — wait for the
    // rail's own loading readout (`.charts-data-loading`,
    // `ChartsDataFolder.tsx`) so the stock pick below genuinely lands
    // WHILE it's outstanding, not before `loadRemoteDataset` even started.
    const loadingStart = Date.now();
    while (!container.querySelector(".charts-data-loading")?.textContent?.includes(STUB_ID)) {
      if (Date.now() - loadingStart > 3000) throw new Error("timed out waiting for the remote load's loading title");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    act(() => {});

    // Pick a stock dataset via the overlay's own browse chevron — the SAME
    // control `ChartsDataOverlay.tsx` renders, dispatching `select-dataset`
    // directly (never through `loadRemoteDataset`).
    selectChartsDataset(container, "iris-flowers");
    expect(chartsActiveDatasetTitle(container)).toBe("Iris flower measurements");
    expect(container.querySelector(".synth-viewport pre")!.textContent).toContain("Iris");

    // Now let the STALE remote response resolve.
    resolveRows!(new Response(JSON.stringify({
      features: [{ name: "x" }, { name: "y" }],
      rows: [{ row_idx: 0, row: { x: 1, y: 2 } }, { row_idx: 1, row: { x: 3, y: 4 } }],
      num_rows_total: 2,
    }), { status: 200 }));
    // Give the resolved promise's microtask/state-update chain a real beat
    // to run (the same `setTimeout` polling idiom every other test in this
    // block uses) — if the defect were still present this is exactly the
    // window in which the remote dispatch would land on top of the stock
    // pick.
    await new Promise((resolve) => setTimeout(resolve, 100));
    act(() => {});

    expect(chartsActiveDatasetTitle(container)).toBe("Iris flower measurements");
    expect(container.querySelector(".synth-viewport pre")!.textContent).toContain("Iris");
    // The stale remote dispatch never landed — the source is still
    // `"dataset"` (never `"remote"`), so no `.charts-data-loading` readout
    // exists and the dataset title is still the stock one, not the stub.
    expect(container.querySelector(".charts-data-loading")).toBeNull();
    expect(container.querySelector(".charts-data-title")?.textContent).not.toBe(STUB_ID);
  }, 10_000);
});

// Rule 1/2 (render-area cleanup): the viewport is the chart's own `<pre>`
// frame and nothing else, and every copy/export action confirms on its OWN
// button label instead (the CodePanel/SynthWorkbench idiom), reverting
// after a short delay. Kept in its OWN describe block, mounted last, rather
// than folded into "mounted controls and clipboard" above: each revert
// check needs >1.2s of REAL wall time (`window.setTimeout` — this file's
// `window` is a happy-dom instance installed onto `globalThis`, not
// `globalThis` itself, so a faked clock would never patch it), and running
// that many seconds of real waiting BEFORE the async `?c=`-link decode
// tests above measurably raised their flake rate under this file's shared,
// real-clock `writeUrlParam` rate limiter (`lib/urlState.ts`'s own 30-
// second rolling window) — moving it after those tests removes that
// interaction rather than papering over it.
describe("ChartsWorkbench — copy/export button confirmations", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    // Never asserted on here (each test reads the CLIPBOARD mock and the
    // button's own label) — stubbed so this block draws nothing from the
    // file-wide real `history.replaceState` budget.
    vi.spyOn(urlStateModule, "writeUrlParam").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<ChartsWorkbench initialState={createChartsWorkbenchState()} />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });
  const button = (label: string): HTMLButtonElement => Array.from(container.querySelectorAll("button")).find((node) => node.textContent === label)!;

  it("the viewport holds only the pre frame — no readout ever renders beside it", () => {
    expect(container.querySelectorAll(".charts-viewport p")).toHaveLength(0);
    expect(container.querySelector(".charts-viewport")!.querySelectorAll("pre")).toHaveLength(1);
  });

  it("Copy ASCII flips its own button label to Copied, with no readout appearing, and reverts", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    act(() => button("Copy ASCII").click());
    await act(async () => { await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1)); });
    expect(button("Copied")).toBeDefined();
    expect(container.querySelectorAll(".charts-viewport p")).toHaveLength(0);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1500)); });
    expect(button("Copy ASCII")).toBeDefined();
  }, 10_000);

  it("Copy link flips its own button label to Copied and reverts", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    act(() => button("Copy link").click());
    await act(async () => { await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1)); });
    expect(button("Copied")).toBeDefined();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1500)); });
    expect(button("Copy link")).toBeDefined();
  }, 10_000);

  // Download SVG is fully synchronous (no clipboard/network round trip), so
  // its flip needs no `vi.waitFor` — only the revert needs real time to pass.
  it("Download SVG flips its own button label and reverts", async () => {
    act(() => button("Download SVG").click());
    expect(button("Downloaded") ?? button("Download failed")).toBeDefined();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1500)); });
    expect(button("Download SVG")).toBeDefined();
  }, 10_000);
});

// ── Mark-type icon toggle options (owner packet item 3, extended to the
// mark card) — no DOM needed, this is a pure array check pinning "one entry
// per CHART_MARK_TYPES, in the same order, no duplicates".
describe("ChartsMarkCard — CHART_MARK_TYPE_TOGGLE", () => {
  it("has exactly one option per CHART_MARK_TYPES entry, in order, with no duplicate values", () => {
    expect(CHART_MARK_TYPE_TOGGLE.map((o) => o.value)).toEqual([...CHART_MARK_TYPES]);
    expect(new Set(CHART_MARK_TYPE_TOGGLE.map((o) => o.value)).size).toBe(CHART_MARK_TYPES.length);
  });
  it("gives every option a real icon and a one-line description", () => {
    for (const option of CHART_MARK_TYPE_TOGGLE) {
      expect(option.icon).toBeTruthy();
      expect(typeof option.desc).toBe("string");
      expect(option.desc!.length).toBeGreaterThan(0);
    }
  });
});
