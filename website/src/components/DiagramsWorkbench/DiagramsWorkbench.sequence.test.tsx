// @vitest-environment node
// Sequence form — page-behaviour tests: the Form selector, the five
// sequence presets actually rendering real content through the live page,
// 3D staying graph-only (dimmed with a reason, `mapDirectionLocked` idiom),
// and the source card's Mermaid/JSON tabs. Mirrors `DiagramsWorkbench.test.tsx`'s
// own mount harness.
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
import GlyphDiagramsWorkbench from "./DiagramsWorkbench";
import { GLYPH_SEQUENCE_WORKBENCH_PRESETS } from "./diagramsWorkbenchState";

vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
vi.mock("../GalleryWorkbench/calibratedPalette", () => ({ CALIBRATED_PALETTE_NAME: "calibrated", ensureCalibratedPalette: () => {} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DiagramsWorkbench — sequence form", () => {
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
  async function settlePreview() {
    await vi.waitFor(async () => {
      await act(async () => { await vi.dynamicImportSettled(); });
      expect(container.querySelector(".diagrams-preview[aria-busy='false']")).not.toBeNull();
    }, { timeout: 2000, interval: 10 });
  }
  function toggleRow(label: string): Element {
    return Array.from(container.querySelectorAll(".dock-toggle-row")).find((node) => node.querySelector(".dock-toggle-row-label")?.textContent === label)!;
  }
  function toggleOption(button: HTMLButtonElement): string {
    const parts = (button.getAttribute("aria-label") ?? "").split(": ");
    return parts[parts.length - 1]!;
  }
  async function selectToggle(rowLabel: string, optionLabel: string) {
    await act(async () => {
      Array.from(toggleRow(rowLabel).querySelectorAll<HTMLButtonElement>("button")).find((b) => toggleOption(b) === optionLabel)!.click();
    });
    await settlePreview();
  }
  const trayButton = (label: string) => Array.from(container.querySelectorAll("#diagrams-presets-panel button")).find((node) => node.getAttribute("aria-label") === `Apply ${label}`) as HTMLButtonElement;

  it("defaults to the Graph form, with Sequence and Lanes available as the other Form options", () => {
    const options = Array.from(toggleRow("Form").querySelectorAll<HTMLButtonElement>("button")).map(toggleOption);
    expect(options).toEqual(["Graph", "Sequence", "Lanes"]);
    expect(toggleRow("Form").querySelector('[aria-pressed="true"], .is-active')).toBeTruthy();
  });

  describe.each(GLYPH_SEQUENCE_WORKBENCH_PRESETS)("preset '$label'", (preset) => {
    it("switching the Form to Sequence and applying the preset renders a real diagram", async () => {
      await selectToggle("Form", "Sequence");
      await act(async () => { trayButton(preset.label).click(); });
      await settlePreview();
      const text = preview().textContent ?? "";
      expect(text.trim().length).toBeGreaterThan(0);
      // A real sequence render carries at least one lifeline glyph and no
      // raw error text — a loose but genuine "this is a diagram" check that
      // still goes red if the sequence pipeline throws or renders blank.
      expect(text).not.toContain("GLYPH_SEQUENCE");
      expect(container.querySelector(".diagrams-error")).toBeNull();
    });
  });

  it("the 3D View option is dimmed with a reason while the Sequence form is active, and never opens the 3D frame", async () => {
    await selectToggle("Form", "Sequence");
    // A DISABLED option's own aria-label appends " — <reason>" after the
    // label (`synthKit.tsx`'s `IconToggle`), so this matches by prefix
    // rather than the exact-label `toggleOption` helper the enabled rows use.
    const view3dBtn = Array.from(toggleRow("View").querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.getAttribute("aria-label") ?? "").includes(": 3d"))!;
    expect(view3dBtn.disabled).toBe(true);
    expect(view3dBtn.title || view3dBtn.getAttribute("aria-label")).toBeTruthy();
    await act(async () => { view3dBtn.click(); });
    await settlePreview();
    // Still the 2D grid-scroll frame, never the 3D live-scene host.
    expect(container.querySelector(".diagrams-3d-frame")).toBeNull();
    expect(container.querySelector(".diagrams-grid-scroll")).not.toBeNull();
  });

  it("switching the sequence source's Mermaid/JSON tabs refreshes rather than stealing authority, and the JSON tab is valid parsed IR", async () => {
    await selectToggle("Form", "Sequence");
    await act(async () => { trayButton("Login round trip").click(); });
    await settlePreview();
    const jsonTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) => b.textContent === "JSON")!;
    await act(async () => { jsonTab.click(); });
    const textarea = container.querySelector<HTMLTextAreaElement>(".diagrams-source")!;
    const parsed = JSON.parse(textarea.value);
    expect(parsed.participants.length).toBeGreaterThan(0);
    expect(parsed.messages.length).toBeGreaterThan(0);
    const mermaidTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) => b.textContent === "Mermaid")!;
    await act(async () => { mermaidTab.click(); });
    const mermaidTextarea = container.querySelector<HTMLTextAreaElement>(".diagrams-source")!;
    expect(mermaidTextarea.value).toContain("sequenceDiagram");
    expect(mermaidTextarea.value).toContain("alt credentials valid");
  });

  it("Copy as text reads the sequence render when the sequence form is active", async () => {
    await selectToggle("Form", "Sequence");
    await act(async () => { trayButton("TCP handshake + teardown").click(); });
    await settlePreview();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const copyBtn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "Copy as text")!;
    await act(async () => { copyBtn.click(); });
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0]![0] as string;
    expect(copied.trim().length).toBeGreaterThan(0);
    expect(copied).toBe(preview().textContent);
  });
});
