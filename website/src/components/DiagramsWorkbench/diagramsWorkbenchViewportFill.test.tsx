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
vi.mock("../GalleryWorkbench/calibratedPalette", () => ({ CALIBRATED_PALETTE_NAME: "calibrated", ensureCalibratedPalette: () => {} }));
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
import { createGlyphDiagramsWorkbenchState } from "./diagramsWorkbenchState";

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
    }, { timeout: 2000, interval: 10 });
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
    // page's own FIRST row width (not the total row count — a small grid
    // this diagram doesn't fit in whole splits into several stacked pages,
    // AGENTS.md's "Diagrams" split rung, joined by a blank separator row;
    // that's orthogonal to this feature) is the direct signature of the
    // computed grid width actually reaching the render.
    await resize(761.71875, 130);
    const afterFirst = preview().textContent!;
    expect(afterFirst.split("\n")[0]).toHaveLength(100);

    await resize(1523.4375, 260);
    const afterSecond = preview().textContent!;
    expect(afterSecond.split("\n")[0]).toHaveLength(200);
    expect(afterSecond).not.toBe(afterFirst); // genuinely re-rendered at the new size, not a frozen first measurement
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
    const css = readFileSync(fileURLToPath(new URL("./diagrams-workbench.css", import.meta.url)), "utf8");
    const rule = css.match(/\.diagrams-preview \{[^}]*\}/)![0];
    expect(rule).toMatch(/(?<!min-)height:\s*100%/);
    expect(rule).not.toMatch(/min-height:\s*100%/);
  });

  // A SECOND, diagrams-only ratchet (agy review, found by direct
  // Playwright measurement AFTER the `.diagrams-preview` fix above already
  // landed): `.diagrams-3d-host` used to carry an explicit `height: 100%`
  // ALONGSIDE `flex: 1 1 auto` — a percentage flex-basis, which itself
  // needs the flex CONTAINER's height to be "definite" the same way a
  // plain `height: 100%` does, and `.diagrams-3d-frame`'s own height comes
  // from flex-grow distribution, not an explicit value. Measured live: the
  // live 3D scene's own host WIDTH tracked every resize correctly while
  // its HEIGHT froze at the very first measurement and never moved again
  // — `.charts-3d-viewport-host` (no explicit `height` at all, `flex: 1 1
  // auto` alone) never had this defect, which is what exposed the
  // diagrams-only difference. Fixed by dropping the redundant `height`/
  // `width` entirely and relocating the 420px floor onto the WRAPPER
  // (`.diagrams-3d-frame`), mirroring `.charts-3d-viewport`'s/`.charts-3d-
  // viewport-host`'s own split exactly.
  it("(CSS invariant, agy review) .diagrams-3d-host relies on flex-grow alone, never an explicit height fighting it, and its floor lives on the wrapper", () => {
    const css = readFileSync(fileURLToPath(new URL("./diagrams-workbench.css", import.meta.url)), "utf8");
    const hostRule = css.match(/\.diagrams-3d-host \{[^}]*\}/)![0];
    expect(hostRule).toMatch(/flex:\s*1\s+1\s+auto/);
    expect(hostRule).not.toMatch(/(?<!min-)height:/);
    expect(hostRule).not.toMatch(/(?<!min-)width:/);
    expect(hostRule).toMatch(/min-height:\s*0/);
    const frameRule = css.match(/\.diagrams-3d-frame \{[^}]*\}/)![0];
    expect(frameRule).toMatch(/min-height:\s*420px/);
  });
});
