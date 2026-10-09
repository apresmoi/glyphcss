import { readCss } from "../../test/styles";
import path from "node:path";
// @vitest-environment node
//
// Web viewport fill (AGENTS.md's "Diagrams" "Targets and page") — mirrors
// `ChartsWorkbench/chartsWorkbenchViewportFill.test.tsx` exactly (see that
// file's own doc for why a `MockResizeObserver` stands in for a real
// browser resize under happy-dom); `diagramsWorkbenchState.test.ts` covers
// the pure size-derivation math, this file covers the DOM wiring —
// including the extra wrinkle that diagram layout is ASYNC (an effect, not
// a `useMemo`), so a resize must actually settle a new layout pass.
vi.hoisted(async () => {
  const { Window } = await import("happy-dom");
  const window = new Window({ url: "http://localhost/diagrams" });
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
vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
vi.mock("../../services/rendering/calibratedPalette", () => ({ CALIBRATED_PALETTE_NAME: "calibrated", ensureCalibratedPalette: () => {} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  target: Element | null = null;
  constructor(private readonly cb: ResizeObserverCallback) { MockResizeObserver.instances.push(this); }
  observe(el: Element) { this.target = el; }
  unobserve() { this.target = null; }
  disconnect() { this.target = null; }
  trigger(width: number, height: number) {
    const entry = { target: this.target, contentRect: { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } } as unknown as ResizeObserverEntry;
    this.cb([entry], this as unknown as ResizeObserver);
  }
}

import GlyphDiagramsWorkbench from "./DiagramsWorkbench";
import { buildGlyphDiagramsWorkbenchGraph, createGlyphDiagramsWorkbenchState, reduceGlyphDiagramsWorkbenchState } from "../../features/diagrams/model/diagramsWorkbenchState";
import { renderGlyphDiagramsWorkbenchState } from "../../features/diagrams/render/diagramsWorkbenchRender";

describe("DiagramsWorkbench — web viewport fill (live DOM)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalResizeObserver: typeof ResizeObserver;

  beforeEach(async () => {
    originalResizeObserver = globalThis.ResizeObserver;
    MockResizeObserver.instances = [];
    (globalThis as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<GlyphDiagramsWorkbench initialState={createGlyphDiagramsWorkbenchState()} />));
    await settlePreview();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    (globalThis as { ResizeObserver: unknown }).ResizeObserver = originalResizeObserver;
    vi.restoreAllMocks();
  });

  const preview = () => container.querySelector<HTMLPreElement>(".diagrams-viewport pre.glyph-output")!;
  async function settlePreview() {
    await vi.waitFor(async () => {
      await act(async () => { await vi.dynamicImportSettled(); });
      expect(container.querySelector(".diagrams-preview[aria-busy='false']")).not.toBeNull();
    }, { timeout: 10_000, interval: 10 });
  }
  function previewObserver(): MockResizeObserver {
    // `.diagrams-viewport` (`InstrumentViewport`'s own element), NEVER
    // `.diagrams-preview` inside it — see `chartsWorkbenchViewportFill.test.tsx`'s
    // own matching helper for the full "why not the inner box" doc.
    const observer = MockResizeObserver.instances.find((o) => o.target?.classList.contains("diagrams-viewport"));
    expect(observer, "the viewport element must be observed").toBeDefined();
    return observer!;
  }
  async function resize(width: number, height: number) {
    await act(async () => { previewObserver().trigger(width, height); });
    await settlePreview();
  }
  function controller(name: string): Element {
    return Array.from(container.querySelectorAll("#diagrams-controls-panel .controller")).find((node) => node.querySelector(".name")?.textContent?.toLowerCase() === name.toLowerCase())!;
  }
  function toggleRow(label: string): Element {
    return Array.from(container.querySelectorAll(".dock-toggle-row")).find((node) => node.querySelector(".dock-toggle-row-label")?.textContent === label)!;
  }
  async function pickToggle(rowLabel: string, optionLabel: string) {
    const btn = Array.from(toggleRow(rowLabel).querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.getAttribute("aria-label") ?? "").split(": ").at(-1) === optionLabel)!;
    await act(async () => btn.click());
    await settlePreview();
  }

  // Mutation: reverting `glyphDiagramsWorkbenchWebGridSize`'s viewportPx
  // branch (or dropping `diagramsPreviewRef`'s `useElementSize` wiring in
  // `DiagramsWorkbench.tsx`) freezes the render at the default 96x32 grid
  // regardless of what `resize()` reports below.
  it("on web, the render's width/height follow a mocked viewport size, and update again on a second resize", async () => {
    expect(preview().textContent!.split("\n")[0]).toHaveLength(96); // the target's own default width, pre-measurement

    // 13px cells: cellW = 13 * 0.5859375 = 7.6171875px, cellH = 13px. A
    // The first row width proves that larger viewports still expand the
    // logical grid. Font size remains controlled only by Density.
    await resize(761.71875, 130);
    const afterFirst = preview().textContent!;
    expect(afterFirst.split("\n")[0]).toHaveLength(100);

    await resize(1523.4375, 260);
    const afterSecond = preview().textContent!;
    expect(afterSecond.split("\n")[0]).toHaveLength(200);
    expect(afterSecond).not.toBe(afterFirst); // genuinely re-rendered at the new size, not a frozen first measurement
  }, 15_000);

  it("keeps the complete RAG graph at a stable cell size through shrinking and growing viewports", async () => {
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Apply RAG pipeline"]')!.click());
    await settlePreview();
    const state = reduceGlyphDiagramsWorkbenchState(createGlyphDiagramsWorkbenchState(), { type: "apply-preset", id: "rag-pipeline" });
    const graph = buildGlyphDiagramsWorkbenchGraph(state);
    for (const [width, height] of [[1092, 742], [612, 562], [372, 462], [366, 550], [296, 130], [1092, 742]]) {
      await resize(width!, height!);
      const pre = preview();
      const lines = pre.textContent!.split("\n");
      const fontSize = Number.parseFloat(pre.style.fontSize);
      expect(fontSize).toBe(13);
      expect(lines[0]!.length * fontSize * 0.5859375).toBeLessThanOrEqual(width!);
      // Overflow remains at native cell size in the pannable surface;
      // real drag-to-reach coverage lives in the browser resize test.
      expect(container.querySelector('[aria-label="Diagram viewport"]')).not.toBeNull();
      expect(pre.getAttribute("aria-description")).toContain("1 panel.");
      // Happy DOM has no text geometry. Use the layout's cell boxes to
      // reconstruct wrapped labels from the actual DOM output instead.
      const layout = await renderGlyphDiagramsWorkbenchState(state, { width: width!, height: height! });
      if (!layout.ok) throw new Error(layout.error);
      for (const hotspot of layout.hotspots ?? []) {
        if (hotspot.kind !== "node") continue;
        const label = lines.slice(hotspot.y0 + 1, hotspot.y1).map(line => line.slice(hotspot.x0 + 1, hotspot.x1)).join("").replace(/[^\p{L}\p{N}]/gu, "");
        expect(label).toBe(graph.nodes.find(node => node.id === hotspot.id)!.label.replace(/[^\p{L}\p{N}]/gu, ""));
      }
      if (width === 612 || width === 366) {
        expect(fontSize).toBe(13);
        expect(pre.getAttribute("aria-description")).toContain("TB; 1 panel.");
      }
      expect(Array.from(container.querySelectorAll('.diagrams-hotspot.is-node'), node => node.getAttribute('aria-label')).sort()).toEqual(
        ["docs", "prep", "index", "query", "qembed", "retrieve", "rerank", "generate"].map(id => `Edit node ${id}`).sort(),
      );
    }
    expect(Number.parseFloat(preview().style.fontSize)).toBe(13);
    await pickToggle("Target", "terminal");
    expect(preview().style.fontSize).toBe("");
  }, 15_000);

  it.each(["Login round trip", "Release train (git)"])("reflows %s at fixed density instead of shrinking fonts", async (preset) => {
    await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="Apply ${preset}"]`)!.click());
    await settlePreview();
    for (const [width, height, columns] of [[1092, 742, 143], [366, 550, 48], [296, 130, 38], [1092, 742, 143]]) {
      await resize(width!, height!);
      expect(Number.parseFloat(preview().style.fontSize)).toBe(13);
      expect(preview().textContent!.split("\n")[0]).toHaveLength(columns!);
    }
    const input = controller("Density").querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "2");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settlePreview();
    for (const [width, height] of [[366, 550], [296, 130], [1092, 742]]) {
      await resize(width!, height!);
      expect(Number.parseFloat(preview().style.fontSize)).toBe(6.5);
    }
  }, 15_000);

  it("terminal and chat still use the Width/Height sliders, unaffected by a viewport resize", async () => {
    await resize(761.71875, 130); // primes a measurement — must still be ignored below
    await pickToggle("Target", "terminal");
    expect(preview().textContent!.split("\n")).toHaveLength(24); // terminal's own default height
    expect(preview().textContent!.split("\n")[0]).toHaveLength(80); // terminal's own default width

    const setInputValue = (input: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
    };
    const widthInput = controller("Width").querySelector<HTMLInputElement>("input")!;
    await act(async () => setInputValue(widthInput, "30"));
    await settlePreview();
    expect(preview().textContent!.split("\n")[0]).toHaveLength(30);
  }, 15_000);

  // Mutation: dropping the `useEffect` that calls `widthCtrl.setEnabled`/
  // `heightCtrl.setEnabled` in `DiagramsDock.tsx` leaves these rows always
  // enabled with no reason.
  it("the Width/Height sliders are dimmed on web with the reason 'Web fills the viewport.', and re-enable on terminal/chat", async () => {
    const widthInput = () => controller("Width").querySelector<HTMLInputElement>("input")!;
    const heightInput = () => controller("Height").querySelector<HTMLInputElement>("input")!;
    expect(widthInput().disabled).toBe(true);
    expect(heightInput().disabled).toBe(true);
    expect(controller("Width").classList.contains("disabled")).toBe(true);
    expect((controller("Width") as HTMLElement).title).toBe("Web fills the viewport.");
    expect((controller("Height") as HTMLElement).title).toBe("Web fills the viewport.");

    await pickToggle("Target", "terminal");
    expect(widthInput().disabled).toBe(false);
    expect(heightInput().disabled).toBe(false);
    expect(controller("Width").classList.contains("disabled")).toBe(false);
    expect((controller("Width") as HTMLElement).title).toBe("");
  }, 15_000);

  // The RATCHET fix (agy review finding) — mirrors `chartsWorkbenchViewportFill.test.tsx`'s
  // own matching CSS-invariant test exactly; see that file's doc for why a
  // mocked-resize test cannot itself catch this under happy-dom's real
  // absence of layout, and why the observed box must have a DEFINITE
  // height rather than merely a `min-height` floor.
  it("(CSS invariant, agy review) .diagrams-preview has a DEFINITE height, never merely a min-height floor a stale render could inflate", () => {
    const css = readCss(path.resolve(__dirname, "./DiagramsWorkbench.module.css"));
    const rule = css.match(/\.diagrams-preview \{[^}]*\}/)![0];
    expect(rule).toMatch(/(?<!min-)height:\s*100%/);
    expect(rule).not.toMatch(/min-height:\s*100%/);
  });
});
