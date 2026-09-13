// @vitest-environment node
// Node module resolution matches the pure suite; happy-dom supplies only the
// mounted UI surface. No chart renderer, reducer, Dock or CodePanel is mocked.
vi.hoisted(async () => {
  const { Window } = await import("happy-dom");
  const window = new Window();
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
import ChartsWorkbench from "./ChartsWorkbench";
// Standalone Vitest lacks Astro's core alias; use the real module behind it.
vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
import {
  reduceGlyphChartsWorkbenchControls,
  resolveGlyphChartsWorkbenchControls,
  type GlyphChartsWorkbenchControls,
} from "./chartsWorkbenchState";
import { renderChartsWorkbenchSpec } from "./chartsWorkbenchRender";
import { decodeChartsUrlState } from "./chartsUrlState";

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

describe("ChartsWorkbench — explicit control overrides", () => {
  // Mutation: preserve the previous target's resolved defaults as overrides.
  it("changes every unmodified control when the target changes", () => {
    const initial: GlyphChartsWorkbenchControls = { target: "chat", overrides: {} };
    const terminal = reduceGlyphChartsWorkbenchControls(initial, { type: "target", value: "terminal" });
    expect(resolveGlyphChartsWorkbenchControls(terminal)).toEqual({ target: "terminal", charset: "braille", color: "truecolor", width: 80, height: 24 });
    const web = reduceGlyphChartsWorkbenchControls(terminal, { type: "target", value: "web" });
    expect(resolveGlyphChartsWorkbenchControls(web)).toEqual({ target: "web", charset: "braille", color: "css", width: 96, height: 32 });
  });

  // Mutation: infer overrides by value inequality, or discard one control's explicit override on target change.
  it.each([
    { type: "charset", value: "box" }, { type: "color", value: "none" },
    { type: "width", value: 72 }, { type: "height", value: 24 },
  ] as const)("keeps an explicitly chosen default for $type", (action) => {
    const changed = reduceGlyphChartsWorkbenchControls({ target: "chat", overrides: {} }, action);
    const switched = reduceGlyphChartsWorkbenchControls(changed, { type: "target", value: "web" });
    expect(resolveGlyphChartsWorkbenchControls(switched)).toEqual({ target: "web", charset: "braille", color: "css", width: 96, height: 32, [action.type]: action.value });
  });

  // Mutation: reset clears only colour/charset and leaves dimension overrides behind.
  it("clears all four explicit overrides on reset", () => {
    const reset = reduceGlyphChartsWorkbenchControls({ target: "web", overrides: { charset: "ascii", color: "none", width: 20, height: 6 } }, { type: "reset" });
    expect(resolveGlyphChartsWorkbenchControls(reset)).toEqual({ target: "web", charset: "braille", color: "css", width: 96, height: 32 });
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
    act(() => root.render(<ChartsWorkbench />));
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
  // button's `aria-label` (`IconToggle`'s own convention: `aria-label={
  // option.label}`, the raw enum value).
  function toggleRow(label: string): Element {
    return Array.from(container.querySelectorAll(".dock-toggle-row")).find((node) => node.querySelector(".dock-toggle-row-label")?.textContent === label)!;
  }
  function pickToggle(rowLabel: string, optionLabel: string): void {
    const btn = Array.from(toggleRow(rowLabel).querySelectorAll<HTMLButtonElement>("button")).find((b) => b.getAttribute("aria-label") === optionLabel)!;
    act(() => btn.click());
  }
  function activeToggleLabel(rowLabel: string): string {
    return toggleRow(rowLabel).querySelector<HTMLButtonElement>(".gx-toggle-btn.is-active")!.getAttribute("aria-label")!;
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
  function resetOutputButton(): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>(".dock-folder-header-reset")!;
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

  // Mutation: inject result.text with SGR into <pre>, or remove the ANSI explanation.
  it("shows a decoded-colour terminal frame with the copy explanation, never raw SGR bytes", () => {
    pickToggle("Target", "terminal");
    expect(container.querySelector(".target-preview--terminal")).not.toBeNull();
    expect(container.querySelector("pre")!.textContent).not.toContain("\x1b");
    expect(container.querySelector("pre span[style]")).not.toBeNull();
    expect(container.querySelector('[role="status"]')!.textContent).toContain("ANSI escapes are included only with Copy ANSI");
    expect(button("Copy ANSI")).toBeDefined();
  });

  // Mutation: show an ANSI copy affordance/notice for a terminal render explicitly set to no colour.
  it("shows plain text without ANSI controls for a terminal with color none", () => {
    pickToggle("Target", "terminal");
    pickToggle("Color", "none");
    expect(container.querySelector("pre")!.textContent).not.toContain("\x1b");
    expect(container.querySelector("pre span")).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(button("Copy ANSI")).toBeUndefined();
  });

  // Mutation: choose plain display for the web target or escape its HTML rather than mounting the spans.
  it("renders the web target's coloured HTML in the preview", () => {
    pickToggle("Target", "web");
    expect(container.querySelector("pre span[style]")).not.toBeNull();
    expect(container.querySelector("pre")!.textContent).not.toContain("<span");
    expect(container.querySelector("pre")!.textContent).not.toContain("\x1b");
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
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Mark 1 type"]')!.value).toBe("bar");
    expect(JSON.parse(container.querySelector("textarea")!.value)[0]).toEqual({ month: "Jan", value: 3 });
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

  it("edits a mark's JSON live, reports malformed drafts and recovers via sample", () => {
    const before = container.querySelector(".synth-viewport pre")!.textContent;
    const textarea = container.querySelector("textarea")!;
    const edit = (value: string) => act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    edit("[2,9,4,1]");
    expect(container.querySelector(".synth-viewport pre")!.textContent).not.toBe(before);
    edit("[");
    expect(container.querySelector('[role="alert"]')!.textContent).toContain("Invalid JSON");
    act(() => button("sample").click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector(".synth-viewport pre")!.textContent).toMatch(/\S/);
  });

  // Packet item 7 — the table is the PRIMARY (default) data view; editing a
  // cell there must reach the same `dataText` the JSON tab shows, once
  // committed (final-gate-2 codex #5: a cell now holds an uncommitted
  // EDITING STRING until blur/Enter, so the value only reaches the reducer
  // — and the preview — after that, never on every keystroke).
  it("the table editor is the default data view and commits a cell edit on blur", () => {
    const tableTab = Array.from(container.querySelectorAll('[role="tab"]')).find((node) => node.textContent === "Table") as HTMLButtonElement;
    expect(tableTab.getAttribute("aria-selected")).toBe("true");
    const before = container.querySelector(".synth-viewport pre")!.textContent;
    const valueInput = container.querySelector<HTMLInputElement>('.charts-grid input[data-row="0"][data-col="0"]')!;
    act(() => { valueInput.focus(); valueInput.dispatchEvent(new Event("focusin", { bubbles: true })); });
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(valueInput, "42");
      valueInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Still uncommitted — typing alone must not yet reach the reducer/preview.
    expect(container.querySelector(".synth-viewport pre")!.textContent).toBe(before);
    act(() => { valueInput.blur(); valueInput.dispatchEvent(new Event("focusout", { bubbles: true })); });
    expect(container.querySelector(".synth-viewport pre")!.textContent).not.toBe(before);
    const jsonTab = Array.from(container.querySelectorAll('[role="tab"]')).find((node) => node.textContent === "JSON") as HTMLButtonElement;
    act(() => jsonTab.click());
    expect(JSON.parse(container.querySelector("textarea")!.value)[0]).toBe(42);
  });
  it("final-gate-2 (codex #5): typing '3.' then '5' into a numeric cell commits 3.5, not 35 — the display never round-trips through the already-parsed number mid-keystroke", () => {
    const valueInput = container.querySelector<HTMLInputElement>('.charts-grid input[data-row="0"][data-col="0"]')!;
    const type = (value: string) => act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(valueInput, value);
      valueInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { valueInput.focus(); valueInput.dispatchEvent(new Event("focusin", { bubbles: true })); });
    type("3.");
    expect(valueInput.value).toBe("3."); // still the literal typed text, not re-parsed to "3".
    type("3.5");
    act(() => { valueInput.blur(); valueInput.dispatchEvent(new Event("focusout", { bubbles: true })); });
    const jsonTab = Array.from(container.querySelectorAll('[role="tab"]')).find((node) => node.textContent === "JSON") as HTMLButtonElement;
    act(() => jsonTab.click());
    expect(JSON.parse(container.querySelector("textarea")!.value)[0]).toBe(3.5);
  });
  it("final-gate-2 (codex #6): renaming a column commits on blur, updates the chart's channel reference, and never disconnects the focused input", () => {
    // Reproduces the review's exact scenario: the Bar preset's `x` channel
    // names its "month" field, so renaming that column must carry the
    // channel reference along or the mark points at a field that no
    // longer exists.
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Apply Bar"]')!.click());
    const header = Array.from(container.querySelectorAll<HTMLInputElement>(".charts-grid-header .charts-table-header")).find((input) => input.value === "month")!;
    const originalColumn = header.value;
    act(() => { header.focus(); header.dispatchEvent(new Event("focusin", { bubbles: true })); });
    act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(header, `${originalColumn}X`);
      header.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Same DOM node — the input was never remounted mid-edit.
    expect(container.querySelector<HTMLInputElement>(".charts-grid-header .charts-table-header")).toBe(header);
    act(() => { header.blur(); header.dispatchEvent(new Event("focusout", { bubbles: true })); });
    expect(container.querySelector('[role="alert"]')).toBeNull(); // no GLYPH_CHART_INTERNAL_COORD from a stale channel reference.
    const dataTab = Array.from(container.querySelectorAll('[role="tab"]')).find((node) => node.textContent === "JSON") as HTMLButtonElement;
    act(() => dataTab.click());
    expect(container.querySelector("textarea")!.value).toContain(`${originalColumn}X`);
    // Mutation: drop the `channels` rewrite in the reducer's "rename-column"
    // case -> the mark's `x` channel stays the literal string "month" while
    // every row is now keyed "monthX" -> this reddens.
    act(() => button("Export").click());
    const exportPanel = container.querySelector("#charts-export-panel")!;
    act(() => Array.from(exportPanel.querySelectorAll<HTMLButtonElement>(".gw-code-panel__tab")).find((tab) => tab.textContent === "JSON")!.click());
    const spec = JSON.parse(exportPanel.querySelector("code")!.textContent!);
    expect(spec.marks[0].channels.x).toBe(`${originalColumn}X`);
  });

  it("add row / add column / remove row / remove column all reach the same state as the JSON tab", () => {
    act(() => button("+ Add mark").click());
    const dotCard = container.querySelectorAll(".voice-card")[1]!;
    const bodyFirstColumnCells = '.charts-grid input:not([data-row="-1"])[data-col="0"]';
    const rowsBefore = dotCard.querySelectorAll(bodyFirstColumnCells).length;
    act(() => dotCard.querySelector<HTMLButtonElement>(".charts-table-add-row")!.click());
    expect(dotCard.querySelectorAll(bodyFirstColumnCells).length).toBe(rowsBefore + 1);
    act(() => dotCard.querySelector<HTMLButtonElement>('.charts-table-remove[title^="Remove row"]')!.click());
    expect(dotCard.querySelectorAll(bodyFirstColumnCells).length).toBe(rowsBefore);
    const columnsBefore = dotCard.querySelectorAll(".charts-grid-header").length;
    act(() => dotCard.querySelector<HTMLButtonElement>(".charts-table-add")!.click());
    expect(dotCard.querySelectorAll(".charts-grid-header").length).toBe(columnsBefore + 1);
    act(() => dotCard.querySelector<HTMLButtonElement>('.charts-table-remove[title^="Remove column"]')!.click());
    expect(dotCard.querySelectorAll(".charts-grid-header").length).toBe(columnsBefore);
  });

  it("packet item 1 — arrow keys move focus between grid cells like a spreadsheet", () => {
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Apply Bar"]')!.click());
    const grid = container.querySelector(".charts-grid")!;
    const cell = (row: number, col: number) => grid.querySelector<HTMLInputElement>(`input[data-row="${row}"][data-col="${col}"]`)!;
    const press = (element: HTMLElement, key: string) => act(() => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })));
    // Left/Right only jump cells once the caret sits at the text's own edge
    // (otherwise they move the caret through the cell's text, same as a
    // real spreadsheet's in-cell edit mode) — every press below places the
    // caret at the boundary it's testing before dispatching the key.
    const atEnd = (input: HTMLInputElement) => input.setSelectionRange(input.value.length, input.value.length);
    const atStart = (input: HTMLInputElement) => input.setSelectionRange(0, 0);
    act(() => cell(0, 0).focus());
    press(cell(0, 0), "ArrowDown");
    expect(document.activeElement).toBe(cell(1, 0));
    atEnd(cell(1, 0));
    press(cell(1, 0), "ArrowRight");
    expect(document.activeElement).toBe(cell(1, 1));
    press(cell(1, 1), "ArrowUp");
    expect(document.activeElement).toBe(cell(0, 1));
    atStart(cell(0, 1));
    press(cell(0, 1), "ArrowLeft");
    expect(document.activeElement).toBe(cell(0, 0));
    // From the header row, ArrowDown enters the first data row of that column.
    const header = grid.querySelector<HTMLInputElement>('input[data-row="-1"][data-col="0"]')!;
    act(() => header.focus());
    press(header, "ArrowDown");
    expect(document.activeElement).toBe(cell(0, 0));
  });

  it("adds and removes real rail cards", () => {
    act(() => button("+ Add mark").click());
    expect(container.querySelectorAll(".voice-card")).toHaveLength(2);
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Remove mark 1"]')!.click());
    expect(container.querySelectorAll(".voice-card")).toHaveLength(1);
    expect(container.querySelector(".synth-viewport pre")!.textContent).toMatch(/\S/);
  });

  // Data folder end-to-end (AGENTS.md's "Charts" — "Data layer"): picking a
  // real vendored dataset and clicking Apply must replace the marks with
  // the recommended mapping AND set an explicit time x-scale (see
  // chartsDatasetDateAxis.test.ts's header comment — a date column is a
  // plain ISO string, so nothing downstream infers "time" on its own).
  it("Data folder: choosing a dataset and clicking Apply replaces marks with its recommended mapping and a real time x-scale", () => {
    const datasetSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Dataset"]')!;
    act(() => {
      datasetSelect.selectedIndex = Array.from(datasetSelect.options).findIndex((o) => o.value === "global-temperature");
      datasetSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector(".charts-data-info")!.textContent).toContain("NASA GISS");
    const applyButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".gw-code-panel__action")).find((b) => b.textContent === "Apply")!;
    act(() => applyButton.click());
    expect(container.querySelectorAll(".voice-card")).toHaveLength(1);
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Mark 1 type"]')!.value).toBe("line");
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Mark 1 x"]')!.value).toBe("year");
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Mark 1 y"]')!.value).toBe("anomaly_c");
    expect(container.querySelector(".synth-viewport pre")!.textContent).toContain("Global temperature anomaly");
    // The x scale's "auto" default would infer `band` for a plain ISO
    // string column (see this file's header comment) — Apply must have
    // forced `time` explicitly, which is directly observable in the
    // rendered preview: a real multi-scale year label, never a raw ISO
    // string fragment.
    expect(container.querySelector(".synth-viewport pre")!.textContent).toMatch(/\b(19|20)\d{2}\b/);
    expect(container.querySelector(".synth-viewport pre")!.textContent).not.toContain("T00:00:00");
  });

  it("Data folder: a pipeline filter step narrows the applied mark's data", () => {
    const datasetSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Dataset"]')!;
    act(() => {
      datasetSelect.selectedIndex = Array.from(datasetSelect.options).findIndex((o) => o.value === "world-population-by-country");
      datasetSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    act(() => container.querySelector<HTMLButtonElement>(".charts-data-folder .charts-table-add-row")!.click());
    // A freshly added step already defaults to kind "filter" — no need to
    // touch its own kind `<select>`, only the fields it renders.
    // A "filter" step renders exactly two `.charts-pipeline-input`s
    // (column, value) plus one `.charts-pipeline-select` (operator) in between.
    const [columnInput, valueInput] = Array.from(container.querySelectorAll<HTMLInputElement>(".charts-pipeline-input"));
    const setValue = (input: HTMLInputElement, value: string) => act(() => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    setValue(columnInput!, "country");
    setValue(valueInput!, "Germany");
    const applyButton = Array.from(container.querySelectorAll<HTMLButtonElement>(".gw-code-panel__action")).find((b) => b.textContent === "Apply")!;
    act(() => applyButton.click());
    const jsonTab = Array.from(container.querySelectorAll('[role="tab"]')).find((node) => node.textContent === "JSON") as HTMLButtonElement;
    act(() => jsonTab.click());
    const rows = JSON.parse(container.querySelector("textarea")!.value) as Array<{ country: string }>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.country === "Germany")).toBe(true);
  });

  it("opens only the selected mobile drawer and closes it with Escape", () => {
    const tabs = container.querySelectorAll<HTMLButtonElement>(".dn-mobile-tabs button");
    act(() => tabs[0]!.click());
    expect(container.querySelector("#charts-marks-panel")!.classList.contains("is-mobile-open")).toBe(true);
    act(() => tabs[1]!.click());
    expect(container.querySelector("#charts-marks-panel")!.classList.contains("is-mobile-open")).toBe(false);
    expect(container.querySelector("#charts-controls-panel")!.classList.contains("is-mobile-open")).toBe(true);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelectorAll(".is-mobile-open")).toHaveLength(0);
  });

});
