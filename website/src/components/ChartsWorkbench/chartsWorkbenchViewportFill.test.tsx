// @vitest-environment node
//
// Web viewport fill (AGENTS.md's "Charts" "Targets and page"): on `web` the
// 2D render fills the measured browser viewport instead of a fixed logical
// grid — this file drives that through a REAL mounted `ChartsWorkbench`,
// with the DOM's own `ResizeObserver` replaced by a controllable mock (the
// task's own framing: "the render's width/height follow a MOCKED viewport
// size and update on resize" — happy-dom has no layout engine, so no real
// resize ever fires on its own, this file's own `MockResizeObserver` is
// what stands in for it). `chartsWorkbenchState.test.tsx` covers the pure
// size-derivation math directly; this file covers the DOM wiring: the ref
// that gets observed, the render that follows a resize, and the Dock's own
// Width/Height lock.
vi.hoisted(async () => {
  const { Window } = await import("happy-dom");
  const window = new Window({ url: "http://localhost/charts" });
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
vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
vi.mock("../GalleryWorkbench/calibratedPalette", () => ({ CALIBRATED_PALETTE_NAME: "calibrated", ensureCalibratedPalette: () => {} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A controllable stand-in for the real `ResizeObserver` — happy-dom has no
// layout engine (AGENTS.md's own testing note, and this repo's existing
// idiom, `ChartsWorkbench.test.tsx`'s "happy-dom does not compute CSS
// cascade" comment), so nothing ever resizes on its own; tests drive the
// SAME callback a real browser would invoke, with a fabricated `contentRect`.
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

import ChartsWorkbench from "./ChartsWorkbench";
import { createChartsWorkbenchState } from "./chartsWorkbenchState";

describe("ChartsWorkbench — web viewport fill (live DOM)", () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalResizeObserver: typeof ResizeObserver;

  beforeEach(() => {
    originalResizeObserver = globalThis.ResizeObserver;
    MockResizeObserver.instances = [];
    (globalThis as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(<ChartsWorkbench initialState={createChartsWorkbenchState()} />));
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    (globalThis as { ResizeObserver: unknown }).ResizeObserver = originalResizeObserver;
    vi.restoreAllMocks();
  });

  function pre(): HTMLPreElement {
    return container.querySelector<HTMLPreElement>("pre.glyph-output")!;
  }
  function previewObserver(): MockResizeObserver {
    // `.charts-preview` is the ONE element `useElementSize` observes
    // (`ChartsWorkbench.tsx`'s own `chartsPreviewRef`) — a fresh mount with
    // no 3D scene means this is the only live `ResizeObserver` instance.
    const observer = MockResizeObserver.instances.find((o) => o.target?.className === "charts-preview");
    expect(observer, "the preview element must be observed").toBeDefined();
    return observer!;
  }
  function controller(name: string): Element {
    return Array.from(container.querySelectorAll("#charts-controls-panel .controller")).find((node) => node.querySelector(".name")?.textContent?.toLowerCase() === name.toLowerCase())!;
  }
  function pickToggle(rowLabel: string, optionLabel: string): void {
    const row = Array.from(container.querySelectorAll(".dock-toggle-row")).find((node) => node.querySelector(".dock-toggle-row-label")?.textContent === rowLabel)!;
    const btn = Array.from(row.querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.getAttribute("aria-label") ?? "").split(": ").at(-1) === optionLabel)!;
    act(() => btn.click());
  }

  // Mutation: reverting `chartsWorkbenchWebGridSize`'s viewportPx branch (or
  // dropping `chartsPreviewRef`'s `useElementSize` wiring in
  // `ChartsWorkbench.tsx`) freezes the render at the default 96x32 grid
  // regardless of what `trigger()` reports below — reddening every
  // assertion here.
  it("on web, the render's width/height follow a mocked viewport size", () => {
    // Default web mount, before any measurement: the target's own default
    // grid (96x32) — pre-measurement fallback, `chartsWorkbenchWebGridSize`'s
    // own doc.
    expect(pre().textContent!.split("\n")).toHaveLength(32);
    expect(pre().textContent!.split("\n")[0]).toHaveLength(96);

    // 13px cells at density 1: cellW = 13 * 0.5859375 = 7.6171875px, cellH = 13px.
    act(() => previewObserver().trigger(761.71875, 130));
    const lines = pre().textContent!.split("\n");
    expect(lines).toHaveLength(10);
    expect(lines[0]).toHaveLength(100);
  });

  it("updates again on a SECOND resize — not just the first measurement", () => {
    act(() => previewObserver().trigger(761.71875, 130));
    expect(pre().textContent!.split("\n")).toHaveLength(10);
    act(() => previewObserver().trigger(1523.4375, 260));
    const lines = pre().textContent!.split("\n");
    expect(lines).toHaveLength(20);
    expect(lines[0]).toHaveLength(200);
  });

  // terminal/chat have no viewport of this page's own to measure — the
  // Width/Height sliders keep owning their size exactly as before this
  // feature existed, and a viewport resize (however this mock reports it)
  // changes nothing there.
  it("terminal and chat still use the Width/Height sliders, unaffected by a viewport resize", () => {
    act(() => previewObserver().trigger(761.71875, 130)); // primes a measurement — must still be ignored below
    pickToggle("Target", "terminal");
    expect(pre().textContent!.split("\n")).toHaveLength(24); // terminal's own default height
    expect(pre().textContent!.split("\n")[0]).toHaveLength(80); // terminal's own default width

    const setInputValue = (input: HTMLInputElement, value: string) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
    };
    const widthInput = controller("Width").querySelector<HTMLInputElement>("input")!;
    setInputValue(widthInput, "30");
    expect(pre().textContent!.split("\n")[0]).toHaveLength(30);

    pickToggle("Target", "chat");
    // The override is ONE shared value across every target (`GlyphChartsWorkbenchControls.overrides`,
    // not per-target) — it survives the switch to chat exactly like every
    // other override does, unrelated to this feature.
    expect(pre().textContent!.split("\n")[0]).toHaveLength(30);
  });

  // Mutation: dropping the `useEffect` that calls `widthCtrl.setEnabled`/
  // `heightCtrl.setEnabled` in `ChartsDock.tsx` leaves these rows always
  // enabled with no reason -> every assertion below reddens.
  it("the Width/Height sliders are dimmed on web with the reason 'Web fills the viewport.', and re-enable on terminal/chat", () => {
    const widthInput = () => controller("Width").querySelector<HTMLInputElement>("input")!;
    const heightInput = () => controller("Height").querySelector<HTMLInputElement>("input")!;
    expect(widthInput().disabled).toBe(true);
    expect(heightInput().disabled).toBe(true);
    expect(controller("Width").classList.contains("disabled")).toBe(true);
    expect((controller("Width") as HTMLElement).title).toBe("Web fills the viewport.");
    expect((controller("Height") as HTMLElement).title).toBe("Web fills the viewport.");

    pickToggle("Target", "terminal");
    expect(widthInput().disabled).toBe(false);
    expect(heightInput().disabled).toBe(false);
    expect(controller("Width").classList.contains("disabled")).toBe(false);
    expect((controller("Width") as HTMLElement).title).toBe("");
  });
});
