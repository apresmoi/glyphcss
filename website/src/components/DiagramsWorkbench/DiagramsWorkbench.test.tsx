import "../../test/dom";
import { readCss } from "../../test/styles";
import path from "node:path";
// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import GlyphDiagramsWorkbench from "./DiagramsWorkbench";
import { GLYPH_DIAGRAM_WORKBENCH_PRESETS, createGlyphDiagramsWorkbenchState, reduceGlyphDiagramsWorkbenchState } from "../../features/diagrams/model/diagramsWorkbenchState";
import { decodeDiagramsUrlState } from "../../features/diagrams/services/diagramsUrlState";
import * as renderModule from "../../features/diagrams/render/diagramsWorkbenchRender";
import * as urlStateModule from "../../services/url-state/history";
import langgraphExport from "../../../../packages/diagrams/fixtures/langgraph.mmd?raw";
import { cleanPresetMermaid } from "../../features/diagrams/model/diagramsWorkbenchState";
const langgraph = cleanPresetMermaid(langgraphExport);

// Standalone Vitest lacks Astro's alias; only unused palette calibration needs a stub.
vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
vi.mock("../../services/rendering/calibratedPalette", () => ({ CALIBRATED_PALETTE_NAME: "calibrated", ensureCalibratedPalette: () => {} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DiagramsWorkbench mounted integration", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<GlyphDiagramsWorkbench />));
    await settlePreview();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });
  const preview = () => container.querySelector<HTMLPreElement>(".diagrams-viewport pre.glyph-output")!;
  const button = (label: string) => Array.from(container.querySelectorAll("button")).find((node) => node.textContent === label)!;
  const controller = (name: string) => Array.from(container.querySelectorAll("#diagrams-controls-panel .controller")).find((node) => node.querySelector(".name")?.textContent?.toLowerCase() === name.toLowerCase())!;
  async function settlePreview() {
    // Every layout awaits the real engine, including cached imports. act() on
    // the input event alone does not promise that this async work has finished.
    await vi.waitFor(async () => {
      await act(async () => { await vi.dynamicImportSettled(); });
      expect(container.querySelector(".diagrams-preview[aria-busy='false']")).not.toBeNull();
    }, { timeout: 10_000, interval: 10 });
  }
  // Target/Charset/Color are icon-button toggle rows (owner packet item 3:
  // "buttons with symbols not dropdowns"), like ChartsDock.tsx's own —
  // Engine/Detail stay plain `<select>`s, so `select()` still
  // handles those.
  const TOGGLE_ROWS = ["Target", "Charset", "Color"];
  function toggleRow(label: string): Element {
    return Array.from(container.querySelectorAll(".dock-toggle-row")).find((node) => node.querySelector(".dock-toggle-row-label")?.textContent === label)!;
  }
  // `IconToggle`'s F5 a11y pass (synthKit.tsx) prefixes `aria-label` with
  // the row's own `groupTitle` ("Output target: web") — the bare option is
  // the text after the LAST ": ".
  function toggleOption(button: HTMLButtonElement): string {
    const parts = (button.getAttribute("aria-label") ?? "").split(": ");
    return parts[parts.length - 1]!;
  }
  async function select(name: string, value: string) {
    if (TOGGLE_ROWS.includes(name)) {
      await act(async () => {
        Array.from(toggleRow(name).querySelectorAll<HTMLButtonElement>("button")).find((b) => toggleOption(b) === value)!.click();
      });
    } else if (name === "Direction") {
      await act(async () => {
        container.querySelector<HTMLButtonElement>(`[aria-label="Direction: ${value}"]`)!.click();
      });
    } else {
      await act(async () => {
        const field = controller(name).querySelector("select")!;
        field.selectedIndex = Array.from(field.options).findIndex((option) => option.textContent === value);
        field.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    await settlePreview();
  }
  // REVIEW-dock-addenda-opus.md P3-5 — the Output reset now lives on the
  // folder's own title bar (`InstrumentWorkbench/useFolderTitleReset`,
  // shared with `/charts`), superseding the old `.dock-folder-header-reset`
  // row.
  function resetOutputButton(): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>(".dock-folder-title-reset-button")!;
  }
  // The source editor debounces its commits (`DiagramsSourceEditor.tsx`)
  // and flushes on blur — so an edit here types, then leaves the field,
  // exactly the reader's own "type, then look at the render" sequence. The
  // debounce itself is under test in `DiagramsSourceEditor.test.tsx`.
  async function edit(value: string, settle = true) {
    await act(async () => {
      const textarea = container.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.dispatchEvent(new Event("focusout", { bubbles: true }));
    });
    if (settle) await settlePreview();
  }

  it("final-gate-2 (Opus finding 3, closing the missing M5 gate): the diagrams CSS declares Glyph Mono + line-height 1 on the main pre, the terminal frame, AND the tray tile previews, never font-family: inherit", () => {
    // happy-dom does not compute CSS cascade, so this mirrors
    // ChartsWorkbench.test.tsx's own A4 test exactly: confirm the DOM shape
    // the rule selects, and that the CSS source itself declares an
    // explicit, non-"inherit" font-family starting with "Glyph Mono" plus
    // line-height: 1. Mutation: revert any of these three rules in
    // diagrams-workbench.css to font-family: inherit -> red.
    const pre = container.querySelector(".diagrams-grid-scroll > pre.glyph-output");
    expect(pre).not.toBeNull();
    const css = readCss(path.resolve(__dirname, "./DiagramsWorkbench.module.css"));
    const mainRule = css.match(/\.diagrams-grid-scroll > \.glyph-output \{[^}]*\}/)![0];
    expect(mainRule).toMatch(/font-family:\s*"Glyph Mono"/);
    expect(mainRule).not.toContain("font-family: inherit");
    expect(mainRule).toMatch(/line-height:\s*1\s*;/);
    const terminalRule = readCss(path.resolve(__dirname, "../TargetPreview/TargetPreview.module.css")).match(/\.target-preview__terminal-body \.glyph-output \{[^}]*\}/)![0];
    expect(terminalRule).toMatch(/font-family:\s*"Glyph Mono"/);
    expect(terminalRule).not.toContain("font-family: inherit");
    expect(terminalRule).toMatch(/line-height:\s*1\s*;/);
    const tileRule = css.match(/\.diagrams-tile-preview pre \{[^}]*\}/)![0];
    expect(tileRule).toMatch(/font-family:\s*"Glyph Mono"/);
    expect(tileRule).not.toContain("font-family: inherit");
    expect(tileRule).toMatch(/line-height:\s*1\s*;/);
  });

  it("preloads the vendored LangGraph bytes and mounts the shared instrument shell", () => {
    expect(container.querySelector("textarea")!.value).toBe(langgraph);
    expect(preview().textContent).toContain("agent");
    expect(container.querySelector(".synth-shell.dn-root.dn-root--synth")).not.toBeNull();
    expect(container.querySelector("#diagrams-controls-panel .lil-gui")).not.toBeNull();
    expect(container.querySelector("[aria-label='Diagram presets']")).not.toBeNull();
    expect(container.querySelector("[aria-busy='false']")).not.toBeNull();
  });

  // Mutation: disconnect a preset button or use a placeholder preview instead of rendering its source.
  // 2D presets: byte-exact against the 2D render module, unchanged.
  const PRESETS_2D = GLYPH_DIAGRAM_WORKBENCH_PRESETS;
  it.each(PRESETS_2D)("renders $label through its real preset button in 7-bit ASCII", async (preset) => {
    await select("Charset", "ascii");
    await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="Apply ${preset.label}"]`)!.click());
    await settlePreview();
    let state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "apply-preset", id: preset.id });
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-control", control: { type: "charset", value: "ascii" } });
    const expected = await renderModule.renderGlyphDiagramsWorkbenchState(state);
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(container.querySelector("textarea")!.value).toBe(preset.source);
    expect(preview().textContent).toMatch(/\S/);
    expect(preview().textContent).toMatch(/^[\x00-\x7f]+$/);
    expect(preview().textContent).toBe(expected.text);
  });

  it("updates untouched target defaults and resets every explicit override", async () => {
    await select("Target", "terminal");
    expect(controller("Width").querySelector("input")!.value).toBe("80");
    expect(controller("Height").querySelector("input")!.value).toBe("24");
    expect(preview().textContent!.split("\n")[0]).toHaveLength(80);
    await select("Charset", "ascii");
    await select("Color", "none");
    await select("Target", "web");
    expect(preview().textContent).toMatch(/^[\x00-\x7f]+$/);
    expect(preview().querySelector("span")).toBeNull();
    await act(async () => resetOutputButton().click());
    await settlePreview();
    expect(controller("Width").querySelector("input")!.value).toBe("96");
    expect(controller("Height").querySelector("input")!.value).toBe("32");
    expect(preview().querySelector("span[style]")).not.toBeNull();
  });

  it("copies plain text separately from ANSI and honours terminal env controls", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await select("Target", "terminal");
    const plain = preview().textContent!;
    expect(plain).not.toContain("\x1b");
    await act(async () => button("Copy as text").click());
    expect(writeText).toHaveBeenLastCalledWith(plain);
    await act(async () => button("Copy ANSI").click());
    const ansi = writeText.mock.calls.at(-1)![0];
    expect(ansi).toContain("\x1b[");
    expect(ansi.replace(/\x1b\[[0-9;]*m/g, "")).toBe(plain);
    await act(async () => controller("NO_COLOR").querySelector<HTMLInputElement>("input")!.click());
    await settlePreview();
    expect(button("Copy ANSI")).toBeUndefined();
    await act(async () => controller("FORCE_COLOR").querySelector<HTMLInputElement>("input")!.click());
    await settlePreview();
    // The button's OWN label may still transiently read "Copied" from the
    // earlier click above (`flashButtonState`'s 1.2s revert, real time,
    // hasn't necessarily elapsed yet) — either label proves the Copy ANSI
    // affordance is back, which is what this assertion is actually for.
    expect(button("Copy ANSI") ?? button("Copied")).toBeDefined();
  });

  it("renders CSS colour overrides on any target", async () => {
    await select("Color", "css");
    expect(preview().querySelector("span[style]")).not.toBeNull();
    expect(preview().textContent).not.toContain("<span");
  });

  it("edits both formats, keeps invalid drafts visible and recovers from a preset", async () => {
    await edit("flowchart LR\nA[Alpha] --> B[Beta]");
    expect(preview().textContent).toContain("Alpha");
    await act(async () => button("JSON").click());
    await settlePreview();
    const graph = JSON.parse(container.querySelector("textarea")!.value);
    graph.nodes[0].label = "Updated";
    await edit(JSON.stringify(graph));
    expect(preview().textContent).toContain("Updated");
    await act(async () => button("Mermaid").click());
    await settlePreview();
    expect(container.querySelector("textarea")!.value).toContain("Updated");
    expect(preview().textContent).toContain("Updated");
    await edit("sequenceDiagram\nAlice->>Bob: hello");
    // Render-area cleanup: the error names itself in the RAIL (never the
    // viewport), and the viewport keeps the LAST GOOD diagram ("Updated")
    // dimmed rather than collapsing to blank — the user's own words: "it
    // shouldn't be in the rendering area — it moves the chart".
    const railError = container.querySelector("#diagrams-source-panel [role='alert']");
    expect(railError).not.toBeNull();
    expect(railError!.textContent).toContain("GLYPH_MERMAID_UNSUPPORTED_");
    expect(container.querySelector(".diagrams-viewport [role='alert']")).toBeNull();
    expect(preview().textContent).toContain("Updated");
    expect(container.querySelector(".diagrams-grid-scroll")!.classList.contains("is-stale")).toBe(true);
    expect(button("Copy as text").disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='Apply Chain']")!.click());
    await settlePreview();
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(preview().textContent).toMatch(/\S/);
    expect(container.querySelector(".diagrams-grid-scroll")!.classList.contains("is-stale")).toBe(false);
    await act(async () => button("JSON").click());
    await edit("{");
    expect(container.querySelector("textarea")!.value).toBe("{");
    expect(container.querySelector("[role='alert']")!.textContent).toMatch(/JSON/);
  });

  // The source editor (`DiagramsSourceEditor.tsx`) — the ONE editor every
  // form's tabs mount: a line-number gutter, a highlight layer, and a
  // render failure placed on its line with the library's own rule code and
  // repair hint. Mutation: drop `locateDiagramsSourceError`'s fragment
  // search -> the strip reads "Line unknown" and the gutter has no
  // `.is-error` -> red.
  it("the source editor shows line numbers, highlights the source, and places a Mermaid syntax error on its line with the rule's repair hint", async () => {
    const gutter = container.querySelector(".diagrams-editor-gutter")!;
    expect(gutter.querySelectorAll("span").length).toBe(langgraph.split("\n").length);
    expect(container.querySelector(".diagrams-editor-highlight .diagrams-tok-keyword")!.textContent).toMatch(/^(?:flowchart|graph)$/);
    expect(container.querySelector(".diagrams-editor-highlight .diagrams-tok-arrow")).not.toBeNull();
    await edit("flowchart LR\n  a[Alpha] --> b[Beta]\n  b --> c[Broken\n  c --> a");
    const strip = container.querySelector("#diagrams-source-panel [role='alert']")!;
    expect(strip.textContent).toContain("GLYPH_MERMAID_SYNTAX");
    expect(strip.querySelector(".diagrams-editor-jump")!.textContent).toBe("Line 3");
    expect(strip.querySelector(".diagrams-editor-hint")!.textContent).toContain("close every shape and subgraph");
    expect(Array.from(gutter.querySelectorAll("span")).findIndex((span) => span.classList.contains("is-error"))).toBe(2);
    expect(container.querySelector("textarea")!.getAttribute("aria-invalid")).toBe("true");
    // Clicking the line button moves the caret to that line's start.
    await act(async () => strip.querySelector<HTMLButtonElement>(".diagrams-editor-jump")!.click());
    expect(container.querySelector("textarea")!.selectionStart).toBe("flowchart LR\n  a[Alpha] --> b[Beta]\n".length);
  });

  // The rail IS the editor (user feedback: "too much borders and boxes...
  // without edit source button"): no disclosure, no card, the toolbar and
  // editor directly under the dialect tabs, the loaded preset named in the
  // rail header instead of a card of its own.
  it("the rail carries the editor directly — no disclosure, no card — with the toolbar, and names the loaded preset in its header", async () => {
    const rail = container.querySelector("#diagrams-source-panel")!;
    expect(rail.querySelector("details")).toBeNull();
    expect(rail.querySelector(".voice-card")).toBeNull();
    expect(rail.querySelector(".synth-voices-head > span")!.textContent).toBe("Graph · LangGraph agent");
    expect(rail.querySelector("[role='toolbar']")).not.toBeNull();
    expect(rail.querySelector("[aria-haspopup='menu']")!.textContent).toBe("+ Node ▾");
    expect(Array.from(rail.querySelectorAll("[role='tab']")).map((t) => t.textContent)).toEqual(["Mermaid", "JSON"]);
    expect(container.querySelector(".diagrams-grid-scroll")!.classList.contains("has-hotspots")).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='Apply Chain']")!.click());
    await settlePreview();
    expect(rail.querySelector(".synth-voices-head > span")!.textContent).toBe("Graph · Chain");
  });

  it("selection is two-way: a hotspot click selects that node's label in the editor, ready to type over; Tab-walking the fields moves the marked hotspot", async () => {
    // Mutation: make the hotspot click `jumpToLine` instead of selecting the
    // field -> the selected text is "" -> red. Mutation: drop
    // `onSelectionChange` wiring -> no `.is-selected` -> red.
    const layer = container.querySelector(".diagrams-hotspot-layer")!;
    expect(layer.querySelectorAll(".diagrams-hotspot.is-node").length).toBe(4);
    expect(layer.querySelectorAll(".diagrams-hotspot.is-edge").length).toBeGreaterThan(0);
    expect(layer.querySelector(".is-selected")).toBeNull();
    const end = layer.querySelector<HTMLButtonElement>("[data-item='node:__end__']")!;
    expect(end.getAttribute("aria-label")).toBe("Edit node __end__");
    await act(async () => end.click());
    const textarea = container.querySelector("textarea")!;
    expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe("__end__");
    expect(textarea.value.slice(textarea.selectionStart - 2, textarea.selectionStart)).toBe("([");
    expect(Array.from(layer.querySelectorAll(".is-selected")).map((el) => el.getAttribute("data-item"))).toEqual(["node:__end__"]);
    expect(end.getAttribute("aria-pressed")).toBe("true");
    // Tab walks on; the mark follows the caret's field to the next node it belongs to.
    for (let i = 0; i < 3 && layer.querySelector(".is-selected")?.getAttribute("data-item") !== "node:__start__"; i++) {
      await act(async () => { textarea.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Tab" })); });
    }
    expect(Array.from(layer.querySelectorAll(".is-selected")).map((el) => el.getAttribute("data-item"))).toEqual(["node:__start__"]);
  });

  it("completion in the mounted rail offers the live graph's own node ids", async () => {
    await edit("flowchart LR\n  alpha[Alpha] --> beta[Beta]\n  beta --> gamma[Gamma]");
    await act(async () => {
      const textarea = container.querySelector("textarea")!;
      const typed = "flowchart LR\n  alpha[Alpha] --> beta[Beta]\n  beta --> gamma[Gamma]\n  gamma --> al";
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, typed);
      textarea.setSelectionRange(typed.length, typed.length);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(Array.from(container.querySelectorAll("[role='option']")).map((o) => o.textContent)).toEqual(["alphaAlpha"]);
  });

  it("a JSON syntax error lands on the line the parser's character offset names", async () => {
    await act(async () => button("JSON").click());
    await settlePreview();
    await edit('{\n  "nodes": [\n    { "id": "a", "label": "A" }\n    { "id": "b", "label": "B" }\n  ],\n  "edges": [],\n  "direction": "TB"\n}');
    const strip = container.querySelector("#diagrams-source-panel [role='alert']")!;
    expect(strip.textContent).toContain("GLYPH_DIAGRAM_BAD_JSON");
    expect(strip.querySelector(".diagrams-editor-jump")!.textContent).toBe("Line 4");
    expect(container.querySelector(".diagrams-editor-highlight .diagrams-tok-key")!.textContent).toBe('"nodes"');
  });

  it("exports only framework integrations and keeps Mermaid/JSON in the source editor", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await select("Direction", "RL");
    await select("Detail", "faithful");
    await act(async () => button("Export").click());
    const panel = container.querySelector("#diagrams-export-panel")!;
    const selectFormat = panel.querySelector<HTMLSelectElement>('[aria-label="Export format"]')!;
    const tabs = Array.from(selectFormat.options);
    const pickFormat = (value: string) => { selectFormat.value = value; selectFormat.dispatchEvent(new Event("change", {bubbles:true})); };
    expect(tabs.map((tab) => tab.textContent)).toEqual(["HTML", "TypeScript", "React", "Vue"]);
    expect(panel.querySelector("code")!.textContent).toContain('"direction": "RL"');
    expect(panel.querySelector("code")!.textContent).toContain('"detail": "faithful"');
    for (const tab of tabs) {
      await act(async () => pickFormat(tab.value));
      await act(async () => panel.querySelector<HTMLButtonElement>("[title='Copy current snippet']")!.click());
      expect(writeText).toHaveBeenLastCalledWith(panel.querySelector("code")!.textContent);
    }
    await act(async () => button("JSON").click());
    expect(JSON.parse(container.querySelector("textarea")!.value).direction).toBe("RL");
    await act(async () => button("Mermaid").click());
    expect(container.querySelector("textarea")!.value).toMatch(/^flowchart RL/);
  });

  it("opens only one mobile drawer and closes it with Escape", async () => {
    const tabs = container.querySelectorAll<HTMLButtonElement>(".dn-mobile-tabs button");
    await act(async () => tabs[0]!.click());
    expect(container.querySelector("#diagrams-source-panel")!.classList.contains("is-mobile-open")).toBe(true);
    await act(async () => tabs[1]!.click());
    expect(container.querySelector("#diagrams-source-panel")!.classList.contains("is-mobile-open")).toBe(false);
    expect(container.querySelector("#diagrams-controls-panel")!.classList.contains("is-mobile-open")).toBe(true);
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(container.querySelectorAll(".is-mobile-open")).toHaveLength(0);
  });

  it("final-gate-2 (codex #7): Copy link encodes the CURRENT state at click time, not whatever the debounced URL writer last committed", async () => {
    // Mutation: revert `copyLink` to `navigator.clipboard.writeText(window
    // .location.href)` -> applying Chain and copying immediately (before
    // the 150ms debounce fires) copies the PREVIOUS (default LangGraph)
    // diagram's link -> the decoded mermaid source below reddens.
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='Apply Chain']")!.click());
    // No settlePreview()/timer advance — the debounced urlWriter has NOT fired yet.
    act(() => button("Copy link").click());
    await act(async () => { await vi.waitFor(() => expect(writeText).toHaveBeenCalled()); });
    const link = writeText.mock.calls.at(-1)![0] as string;
    const param = new URLSearchParams(link.split("?")[1] ?? "").get("d");
    const decoded = await decodeDiagramsUrlState(param);
    expect(decoded).not.toBeNull();
    expect(decoded!.diagram.title).toBe("Chain");
  });

  // Mutation: remove the effect cleanup guard and let the older Promise win.
  it("discards an older async result that completes after a newer edit", async () => {
    const realRender = renderModule.renderGlyphDiagramsWorkbenchState;
    let finishOld: ((value: renderModule.GlyphDiagramsWorkbenchRender) => void) | undefined;
    let oldResult: renderModule.GlyphDiagramsWorkbenchRender | undefined;
    vi.spyOn(renderModule, "renderGlyphDiagramsWorkbenchState").mockImplementationOnce(async (state) => {
      oldResult = await realRender(state);
      return new Promise((resolve) => { finishOld = resolve; });
    });
    await edit("flowchart LR\nA[Old] --> B[Result]", false);
    await vi.waitFor(() => expect(finishOld).toBeTypeOf("function"));
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(button("Copy as text").disabled).toBe(true);
    await edit("flowchart LR\nA[New] --> B[Result]");
    expect(preview().textContent).toContain("New");
    await act(async () => finishOld!(oldResult!));
    expect(preview().textContent).toContain("New");
    expect(preview().textContent).not.toContain("Old");
  });

  // Rule 3/4 (render-area cleanup): a layout still in flight for the
  // CURRENT state keeps showing the LAST GOOD diagram, dimmed AND pulsing
  // (the page's own animation — no "Laying out diagram…" text anywhere),
  // rather than collapsing the viewport to blank while it computes.
  it("a layout still in flight dims and pulses the viewport over the last good diagram, with no text readout", async () => {
    const before = preview().textContent!;
    let finishNew: ((value: renderModule.GlyphDiagramsWorkbenchRender) => void) | undefined;
    vi.spyOn(renderModule, "renderGlyphDiagramsWorkbenchState").mockImplementationOnce(() => new Promise((resolve) => { finishNew = resolve; }));
    await edit("flowchart LR\nA[Pending] --> B[Result]", false);
    await vi.waitFor(() => expect(finishNew).toBeTypeOf("function"));
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(preview().textContent).toBe(before);
    expect(container.querySelector(".diagrams-grid-scroll")!.classList.contains("is-stale")).toBe(true);
    expect(container.querySelector(".diagrams-grid-scroll")!.classList.contains("is-loading")).toBe(true);
    expect(container.querySelector(".diagrams-viewport p")).toBeNull();
    // Resolve the hung layout so this test's own pending work doesn't leak
    // into whatever runs next — the settled content isn't under test here.
    await act(async () => finishNew!({ ok: false, error: "resolved for teardown" }));
    expect(container.querySelector(".diagrams-grid-scroll")!.classList.contains("is-loading")).toBe(false);
  });

  it("the viewport holds only the pre frame — no readout ever renders beside it", () => {
    expect(container.querySelectorAll(".diagrams-viewport p")).toHaveLength(0);
    expect(container.querySelector(".diagrams-viewport")!.querySelectorAll("pre")).toHaveLength(1);
  });
});

// The pulse (`is-loading`) is a PAGE animation, applied via a plain CSS
// class — `prefers-reduced-motion` disables it with no JS branch, so this
// is a CSS-source assertion, mirroring ChartsWorkbench.test.tsx's own.
describe("DiagramsWorkbench — reduced motion disables the viewport pulse", () => {
  it("the loading pulse keyframes are disabled under prefers-reduced-motion: reduce", () => {
    const css = readCss(path.resolve(__dirname, "./DiagramsWorkbench.module.css"));
    const reducedMotionBlock = css.match(/@media \(prefers-reduced-motion: reduce\) \{[^]*?\n\}/)![0];
    expect(reducedMotionBlock).toContain(".diagrams-grid-scroll.is-loading");
    expect(reducedMotionBlock).toMatch(/animation:\s*none/);
    expect(css).toMatch(/\.diagrams-grid-scroll\.is-stale\s*\{[^}]*opacity:\s*0\.45/);
  });
});

// Every copy/export action confirms on its OWN button label (the CodePanel/
// SynthWorkbench idiom), reverting after a short delay — kept in its own
// describe block, mounted separately, and using a plain awaited real delay
// rather than `vi.waitFor` for the revert (ChartsWorkbench.test.tsx's own
// hard-won lesson: this file's `window` is a happy-dom instance installed
// onto `globalThis`, not `globalThis` itself, so a component's
// `window.setTimeout` is never one `vi.useFakeTimers` would patch, and
// `vi.waitFor`'s own polling did not reliably observe it either — a plain
// awaited `setTimeout` does). `writeUrlParam` is stubbed so this block draws
// nothing from `lib/urlState.ts`'s shared, real-clock rate-limited write
// budget; nothing here asserts on the visible address bar.
describe("DiagramsWorkbench — copy/export button confirmations", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    vi.spyOn(urlStateModule, "writeUrlParam").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<GlyphDiagramsWorkbench />));
    await vi.waitFor(async () => {
      await act(async () => { await vi.dynamicImportSettled(); });
      expect(container.querySelector(".diagrams-preview[aria-busy='false']")).not.toBeNull();
    }, { timeout: 10_000, interval: 10 });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });
  const button = (label: string): HTMLButtonElement => Array.from(container.querySelectorAll("button")).find((node) => node.textContent === label)!;

  it("Copy as text flips its own button label to Copied and reverts", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    act(() => button("Copy as text").click());
    await act(async () => { await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1)); });
    expect(button("Copied")).toBeDefined();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1500)); });
    expect(button("Copy as text")).toBeDefined();
  }, 10_000);

  it("Copy link flips its own button label to Copied and reverts", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    act(() => button("Copy link").click());
    await act(async () => { await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1)); });
    expect(button("Copied")).toBeDefined();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1500)); });
    expect(button("Copy link")).toBeDefined();
  }, 10_000);

  it("Download SVG flips its own button label and reverts", async () => {
    act(() => button("Download SVG").click());
    expect(button("Downloaded") ?? button("Download failed")).toBeDefined();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1500)); });
    expect(button("Download SVG")).toBeDefined();
  }, 10_000);
});

beforeEach(() => { window.history.replaceState(null, "", "/"); });
