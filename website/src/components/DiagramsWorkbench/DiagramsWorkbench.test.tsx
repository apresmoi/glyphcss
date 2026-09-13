// @vitest-environment node
vi.hoisted(async () => {
  const { Window } = await import("happy-dom");
  const window = new Window();
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
import GlyphDiagramsWorkbench from "./DiagramsWorkbench";
import { GLYPH_DIAGRAM_WORKBENCH_PRESETS, createGlyphDiagramsWorkbenchState, reduceGlyphDiagramsWorkbenchState } from "./diagramsWorkbenchState";
import { decodeDiagramsUrlState } from "./diagramsUrlState";
import * as renderModule from "./diagramsWorkbenchRender";
import langgraph from "../../../../packages/diagrams/fixtures/langgraph.mmd?raw";

// Standalone Vitest lacks Astro's alias; only unused palette calibration needs a stub.
vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
vi.mock("../GalleryWorkbench/calibratedPalette", () => ({ CALIBRATED_PALETTE_NAME: "calibrated", ensureCalibratedPalette: () => {} }));
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
    }, { timeout: 2000, interval: 10 });
  }
  // Target/Charset/Color are icon-button toggle rows (owner packet item 3:
  // "buttons with symbols not dropdowns"), like ChartsDock.tsx's own —
  // Direction/Engine/Detail stay plain `<select>`s, so `select()` still
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
    } else {
      await act(async () => {
        const field = controller(name).querySelector("select")!;
        field.selectedIndex = Array.from(field.options).findIndex((option) => option.textContent === value);
        field.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    await settlePreview();
  }
  function resetOutputButton(): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>(".dock-folder-header-reset")!;
  }
  async function edit(value: string, settle = true) {
    await act(async () => {
      const textarea = container.querySelector("textarea")!;
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
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
    const css = readFileSync(fileURLToPath(new URL("./diagrams-workbench.css", import.meta.url)), "utf8");
    const mainRule = css.match(/\.diagrams-grid-scroll > \.glyph-output \{[^}]*\}/)![0];
    expect(mainRule).toMatch(/font-family:\s*"Glyph Mono"/);
    expect(mainRule).not.toContain("font-family: inherit");
    expect(mainRule).toMatch(/line-height:\s*1\s*;/);
    const terminalRule = css.match(/\.target-preview__terminal-body \.glyph-output \{[^}]*\}/)![0];
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
  it.each(GLYPH_DIAGRAM_WORKBENCH_PRESETS)("renders $label through its real preset button in 7-bit ASCII", async (preset) => {
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
    expect(container.textContent).toContain("ANSI escapes are included only with Copy ANSI");
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
    expect(button("Copy ANSI")).toBeDefined();
  });

  it("renders CSS colour overrides on any target", async () => {
    await select("Color", "css");
    expect(preview().querySelector("span[style]")).not.toBeNull();
    expect(preview().textContent).not.toContain("<span");
  });

  it("edits both formats, keeps invalid drafts visible and recovers from a preset", async () => {
    await edit("flowchart LR\nA[Alpha] --> B[Beta]");
    expect(preview().textContent).toContain("Alpha");
    await act(async () => button("nodes/edges JSON").click());
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
    expect(container.querySelector("[role='alert']")!.textContent).toContain("GLYPH_MERMAID_UNSUPPORTED_");
    expect(preview().textContent).toBe("");
    expect(button("Copy as text").disabled).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>("[aria-label='Apply Chain']")!.click());
    await settlePreview();
    expect(container.querySelector("[role='alert']")).toBeNull();
    expect(preview().textContent).toMatch(/\S/);
    await act(async () => button("nodes/edges JSON").click());
    await edit("{");
    expect(container.querySelector("textarea")!.value).toBe("{");
    expect(container.querySelector("[role='alert']")!.textContent).toMatch(/JSON/);
  });

  // Packet item 7 — a nodes table (id, label, kind) and an edges table
  // (from, to, label), beside the Mermaid/JSON tabs.
  it("the Table tab shows nodes/edges tables and an edit reaches the live render and the other tabs", async () => {
    await act(async () => button("Table").click());
    await settlePreview();
    expect(container.querySelector('table[aria-label="Nodes"]')).not.toBeNull();
    expect(container.querySelector('table[aria-label="Edges"]')).not.toBeNull();
    const firstLabelInput = container.querySelector<HTMLInputElement>('table[aria-label="Nodes"] tbody tr:first-child input[aria-label$="label"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(firstLabelInput, "Renamed node");
      firstLabelInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settlePreview();
    expect(preview().textContent).toContain("Renamed node");
    await act(async () => button("Mermaid").click());
    await settlePreview();
    expect(container.querySelector("textarea")!.value).toContain("Renamed node");
  });

  it("Table tab: + node / + edge grow both tables live", async () => {
    await act(async () => button("Table").click());
    await settlePreview();
    const nodeRowsBefore = container.querySelectorAll('table[aria-label="Nodes"] tbody tr').length;
    await act(async () => button("+ node").click());
    expect(container.querySelectorAll('table[aria-label="Nodes"] tbody tr').length).toBe(nodeRowsBefore + 1);
    const edgeRowsBefore = container.querySelectorAll('table[aria-label="Edges"] tbody tr').length;
    await act(async () => button("+ edge").click());
    expect(container.querySelectorAll('table[aria-label="Edges"] tbody tr').length).toBe(edgeRowsBefore + 1);
  });

  it("uses real Layout and Diagram controls in the current TS/Mermaid/JSON exports", async () => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await select("Direction", "RL");
    await select("Detail", "faithful");
    await act(async () => button("Export").click());
    const panel = container.querySelector("#diagrams-export-panel")!;
    const tabs = Array.from(panel.querySelectorAll<HTMLButtonElement>(".gw-code-panel__tab"));
    expect(tabs.map((tab) => tab.textContent)).toEqual(["TS", "Mermaid", "JSON"]);
    expect(panel.querySelector("code")!.textContent).toContain('"direction": "RL"');
    expect(panel.querySelector("code")!.textContent).toContain('"detail": "faithful"');
    for (const tab of tabs) {
      await act(async () => tab.click());
      await act(async () => panel.querySelector<HTMLButtonElement>("[title='Copy current snippet']")!.click());
      expect(writeText).toHaveBeenLastCalledWith(panel.querySelector("code")!.textContent);
    }
    expect(JSON.parse(panel.querySelector("code")!.textContent!).direction).toBe("RL");
    await act(async () => tabs[1]!.click());
    expect(panel.querySelector("code")!.textContent).toMatch(/^flowchart RL/);
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
});
