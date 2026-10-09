// @vitest-environment node
// The full 3×4×5 target×charset×colour matrix (CHARTS-RESEARCH
// `DIAGNOSIS-target-matrix.md`) driven through the REAL mounted
// `DiagramsWorkbench`, mirroring `ChartsWorkbench/chartsWorkbenchTargetMatrix.test.tsx`
// — same shared `TargetPreview`, same C1-C4 fixes, a distinct diagram graph
// exercising the layout path instead of a chart spec.
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
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
vi.mock("../../services/rendering/calibratedPalette", () => ({ CALIBRATED_PALETTE_NAME: "calibrated", ensureCalibratedPalette: () => {} }));
import GlyphDiagramsWorkbench from "./DiagramsWorkbench";
import { createGlyphDiagramsWorkbenchState } from "../../features/diagrams/model/diagramsWorkbenchState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CHART_TARGETS = ["chat", "terminal", "web"] as const;
const CHART_CHARSETS = ["ascii", "box", "blocks", "braille"] as const;
const CHART_COLORS = ["none", "ansi16", "ansi256", "truecolor", "css"] as const;
const BRAILLE_RANGE = /[⠀-⣿]/;

describe("DiagramsWorkbench — target × charset × colour matrix (CHARTS-RESEARCH C1-C4)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<GlyphDiagramsWorkbench initialState={createGlyphDiagramsWorkbenchState()} />));
    await settlePreview();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function settlePreview() {
    await vi.waitFor(async () => {
      await act(async () => { await vi.dynamicImportSettled(); });
      expect(container.querySelector(".diagrams-preview[aria-busy='false']")).not.toBeNull();
    }, { timeout: 10_000, interval: 10 });
  }
  function toggleRow(label: string): Element {
    return Array.from(container.querySelectorAll(".dock-toggle-row")).find((node) => node.querySelector(".dock-toggle-row-label")?.textContent === label)!;
  }
  function toggleOption(button: HTMLButtonElement): string {
    const parts = (button.getAttribute("aria-label") ?? "").split(": ");
    return parts[parts.length - 1]!;
  }
  async function select(name: string, value: string) {
    await act(async () => {
      Array.from(toggleRow(name).querySelectorAll<HTMLButtonElement>("button")).find((b) => toggleOption(b) === value)!.click();
    });
    await settlePreview();
  }
  function exportButtons(): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll<HTMLButtonElement>(".gw-code-panel__action"));
  }

  for (const target of CHART_TARGETS) {
    for (const charset of CHART_CHARSETS) {
      for (const color of CHART_COLORS) {
        it(`${target} / ${charset} / ${color}`, async () => {
          await select("Target", target);
          await select("Charset", charset);
          await select("Color", color);

          const frame = container.querySelector(".diagrams-grid-scroll")!;
          const pre = frame.querySelector("pre.glyph-output")!;

          expect(frame.innerHTML).not.toContain("\x1b");

          const colourRequested = color !== "none";
          const hasColourSpan = pre.querySelector('span[style*="color:"]') !== null;

          if (target === "chat") {
            expect(hasColourSpan).toBe(false);
            if (colourRequested) {
              const note = frame.querySelector(".target-preview__note");
              expect(note, `expected a chrome note for ${target}/${charset}/${color}`).not.toBeNull();
              expect(note!.textContent).toMatch(/colour/i);
            }
            expect(exportButtons().some((b) => b.textContent?.startsWith("Copy ANSI"))).toBe(false);
          } else if (colourRequested) {
            expect(hasColourSpan, `expected a coloured span for ${target}/${charset}/${color}`).toBe(true);
          }

          if (target === "chat" && charset === "braille") {
            expect(BRAILLE_RANGE.test(pre.textContent ?? "")).toBe(false);
            expect(frame.querySelector(".target-preview__note")?.textContent).toMatch(/braille/i);
          }
        }, 10_000);
      }
    }
  }
});
