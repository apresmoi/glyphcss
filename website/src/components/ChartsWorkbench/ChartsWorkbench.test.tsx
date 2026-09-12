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

  function select(name: string, value: string): void {
    const field = controller(name).querySelector("select")!;
    act(() => {
      field.selectedIndex = Array.from(field.options).findIndex((option) => option.textContent === value);
      field.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  function controller(name: string): Element {
    return Array.from(container.querySelectorAll("#charts-controls-panel .controller")).find((node) => node.querySelector(".name")?.textContent?.toLowerCase() === name.toLowerCase())!;
  }
  function outputControls() {
    return ["Target", "Charset", "Color"].map((name) => (() => { const select = controller(name).querySelector("select")!; return select.options[select.selectedIndex]!.textContent; })());
  }
  function outputSize() {
    return ["Width", "Height"].map((name) => controller(name).querySelector("input")!.value);
  }
  function button(label: string): HTMLButtonElement {
    return Array.from(container.querySelectorAll("button")).find((node) => node.textContent === label)!;
  }

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

  // Mutation: target onChange updates an unused state or omits applying target defaults.
  it("applies terminal defaults through the actual target selector", () => {
    select("target", "terminal");
    expect(outputControls()).toEqual(["terminal", "braille", "truecolor"]);
    expect(outputSize()).toEqual(["80", "24"]);
    expect(container.querySelector("pre")!.textContent!.split("\n")).toHaveLength(24);
    expect(container.querySelector("pre")!.textContent!.split("\n")[0]).toHaveLength(80);
  });

  // Mutation: reset leaves overrides in state, or the button does not dispatch reset.
  it("resets explicit controls to the current target's defaults", () => {
    select("charset", "ascii");
    select("color", "ansi16");
    select("target", "web");
    expect(outputControls()).toEqual(["web", "ascii", "ansi16"]);
    act(() => button("Reset to target defaults").dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(outputControls()).toEqual(["web", "braille", "css"]);
    expect(outputSize()).toEqual(["96", "32"]);
  });

  // Mutation: inject result.text with SGR into <pre>, or remove the ANSI explanation.
  it("shows plain terminal text with the copy explanation, never SGR bytes", () => {
    select("target", "terminal");
    expect(container.querySelector("pre")!.textContent).not.toContain("\x1b");
    expect(container.querySelector('[role="status"]')!.textContent).toContain("ANSI escapes are included only with Copy ANSI");
    expect(button("Copy ANSI")).toBeDefined();
  });

  // Mutation: show an ANSI copy affordance/notice for a terminal render explicitly set to no colour.
  it("shows plain text without ANSI controls for a terminal with color none", () => {
    select("target", "terminal");
    select("color", "none");
    expect(container.querySelector("pre")!.textContent).not.toContain("\x1b");
    expect(container.querySelector("pre span")).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
    expect(button("Copy ANSI")).toBeUndefined();
  });

  // Mutation: choose plain display for the web target or escape its HTML rather than mounting the spans.
  it("renders the web target's coloured HTML in the preview", () => {
    select("target", "web");
    expect(container.querySelector("pre span[style]")).not.toBeNull();
    expect(container.querySelector("pre")!.textContent).not.toContain("<span");
    expect(container.querySelector("pre")!.textContent).not.toContain("\x1b");
  });

  // Mutation: copy result.text (the ANSI encoding) from Copy ASCII, or copy plain cells from Copy ANSI.
  it("copies plain cells from Copy ASCII and escapes from Copy ANSI", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    select("target", "terminal");
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

  it("adds and removes real rail cards", () => {
    act(() => button("+ Add mark").click());
    expect(container.querySelectorAll(".voice-card")).toHaveLength(2);
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Remove mark 1"]')!.click());
    expect(container.querySelectorAll(".voice-card")).toHaveLength(1);
    expect(container.querySelector(".synth-viewport pre")!.textContent).toMatch(/\S/);
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
