// @vitest-environment node
// The full 3×4×5 target×charset×colour matrix (CHARTS-RESEARCH
// `DIAGNOSIS-target-matrix.md`) driven through the REAL mounted
// `ChartsWorkbench` and its own Dock toggles — not `renderChartsWorkbenchSpec`
// called directly, so a wiring defect between the Dock's state and
// `TargetPreview`'s props (exactly what caused C1/C2) would still be caught
// here even if the pure render function were individually correct. Mirrors
// `ChartsWorkbench.test.tsx`'s own mount/toggle harness verbatim (same
// happy-dom bootstrap, same `pickToggle`/`toggleRow`/`optionOf` idiom) rather
// than importing it, since that file has no exported test-utility surface.
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
import ChartsWorkbench from "./ChartsWorkbench";
import { createChartsWorkbenchState, CHART_TARGETS, CHART_CHARSETS, CHART_COLORS } from "./chartsWorkbenchState";

// happy-dom has no canvas; this unused gallery palette calibrates at Dock import time.
vi.mock("../GalleryWorkbench/calibratedPalette", () => ({ CALIBRATED_PALETTE_NAME: "calibrated", ensureCalibratedPalette: () => {} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BRAILLE_RANGE = /[⠀-⣿]/;

describe("ChartsWorkbench — target × charset × colour matrix (CHARTS-RESEARCH C1-C4)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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
  function applyPreset(label: string): void {
    act(() => container.querySelector<HTMLButtonElement>(`[aria-label="Apply ${label}"]`)!.click());
  }
  function exportButtons(): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll<HTMLButtonElement>(".gw-code-panel__action"));
  }

  for (const markLabel of ["Line", "Pie"] as const) {
    describe(`mark: ${markLabel}`, () => {
      beforeEach(() => {
        if (markLabel === "Pie") applyPreset("Pie");
      });

      for (const target of CHART_TARGETS) {
        for (const charset of CHART_CHARSETS) {
          for (const color of CHART_COLORS) {
            it(`${target} / ${charset} / ${color}`, () => {
              pickToggle("Target", target);
              pickToggle("Charset", charset);
              pickToggle("Color", color);

              const frame = container.querySelector(".charts-grid-scroll")!;
              const pre = frame.querySelector("pre.glyph-output")!;

              // No raw SGR escape bytes in the rendered FRAME, on any target
              // — the page always decodes through `ansiToSpans` or copies
              // from `grid.char`, never forwards `\x1b[...m` verbatim. Scoped
              // to the frame (not the whole page): the preset tray's own
              // thumbnails are a pre-existing, unrelated ANSI text surface.
              expect(frame.innerHTML).not.toContain("\x1b");

              const colourRequested = color !== "none";
              const hasColourSpan = pre.querySelector('span[style*="color:"]') !== null;

              if (target === "chat") {
                // C3: chat never shows colour, whatever was requested.
                expect(hasColourSpan).toBe(false);
                if (colourRequested) {
                  const note = frame.querySelector(".target-preview__note");
                  expect(note, `expected a chrome note for ${target}/${charset}/${color}`).not.toBeNull();
                  expect(note!.textContent).toMatch(/colour/i);
                }
                // C3: Copy ANSI is hidden on chat, even when an ANSI mode
                // produced an SGR payload.
                expect(exportButtons().some((b) => b.textContent?.startsWith("Copy ANSI"))).toBe(false);
              } else if (colourRequested) {
                // C1 (web) / existing behaviour (terminal): colour requested
                // on a target that can show it renders a real coloured span.
                expect(hasColourSpan, `expected a coloured span for ${target}/${charset}/${color}`).toBe(true);
              }

              if (target === "chat" && charset === "braille") {
                // C4: braille under chat silently downgrades to box glyphs
                // (never a misaligned braille cell) and says so in the chrome.
                expect(BRAILLE_RANGE.test(pre.textContent ?? "")).toBe(false);
                expect(frame.querySelector(".target-preview__note")?.textContent).toMatch(/braille/i);
              }
            });
          }
        }
      }
    });
  }

  // P1-3 (CHARTS-RESEARCH `REVIEW-batch4-codex.md`/`-fable.md` P1-5): the
  // 120-cell matrix above runs at density 1, where a non-`css` colour mode
  // never carried `.glyph-text` scaled-text markup at all — invisible
  // there since no cell is scaled at `textScale === 1`. Sweeping `web` at
  // density 2 across every colour mode is what actually exercises the fix
  // (`chartsWorkbenchRender.ts`'s web-target rebuild).
  describe("web × density 2 × colour — Density's own textScale survives every colour mode", () => {
    function densityInput(): HTMLInputElement {
      return Array.from(container.querySelectorAll("#charts-controls-panel .controller"))
        .find((node) => node.querySelector(".name")?.textContent === "Density")!
        .querySelector<HTMLInputElement>("input")!;
    }
    function setDensity(value: string): void {
      const input = densityInput();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
      act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
    }

    for (const color of CHART_COLORS) {
      it(`web / density 2 / ${color} keeps scaled text markup in every cell`, () => {
        pickToggle("Target", "web");
        pickToggle("Color", color);
        setDensity("2");

        const frame = container.querySelector(".charts-grid-scroll")!;
        const pre = frame.querySelector("pre.glyph-output")!;
        expect(pre.innerHTML, `color=${color}`).toContain("glyph-text");
        expect(pre.innerHTML, `color=${color}`).toContain("font-size:2em");
      });
    }
  });
});
