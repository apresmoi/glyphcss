// @vitest-environment node
// Lane-DAG form — page-behaviour tests: the Form selector, the FOOTER TRAY
// carrying the lanes presets (the exact thing the coordinator reported
// missing for sequence — "there is no preset of sequence" — reachable only
// from the Dock toggle is invisible), the three lanes presets actually
// rendering real content through the live page, 3D staying graph-only
// (dimmed with a reason, `mapDirectionLocked` idiom), and the source card's
// git-log/JSON tabs. Mirrors `DiagramsWorkbench.sequence.test.tsx`'s
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
import { GLYPH_LANES_WORKBENCH_PRESETS } from "./diagramsWorkbenchState";

vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
vi.mock("../GalleryWorkbench/calibratedPalette", () => ({ CALIBRATED_PALETTE_NAME: "calibrated", ensureCalibratedPalette: () => {} }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DiagramsWorkbench — lanes form", () => {
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

  it("the footer tray carries a 'Lanes' section with all three lane presets, reachable without touching the Dock's Form toggle first", () => {
    const divider = Array.from(container.querySelectorAll("#diagrams-presets-panel .diagrams-tray-divider")).find((node) => node.textContent === "Lanes");
    expect(divider).toBeTruthy();
    for (const preset of GLYPH_LANES_WORKBENCH_PRESETS) expect(trayButton(preset.label)).toBeTruthy();
  });

  it("clicking a lanes tray tile switches the form itself (never requires the Dock toggle first)", async () => {
    expect(toggleRow("Form").querySelector('[aria-label$=": Graph"]')?.getAttribute("aria-pressed")).not.toBe("false");
    await act(async () => { trayButton(GLYPH_LANES_WORKBENCH_PRESETS[0]!.label).click(); });
    await settlePreview();
    const active = Array.from(toggleRow("Form").querySelectorAll<HTMLButtonElement>("button")).find((b) => toggleOption(b) === "Lanes")!;
    expect(active.classList.contains("is-active") || active.getAttribute("aria-pressed") === "true").toBe(true);
  });

  describe.each(GLYPH_LANES_WORKBENCH_PRESETS)("preset '$label'", (preset) => {
    it("applying the preset via the tray renders a real diagram", async () => {
      await act(async () => { trayButton(preset.label).click(); });
      await settlePreview();
      const text = preview().textContent ?? "";
      expect(text.trim().length).toBeGreaterThan(0);
      // A real lane-DAG render carries no raw error text — a loose but
      // genuine "this is a diagram" check that still goes red if the lanes
      // pipeline throws or renders blank.
      expect(text).not.toContain("GLYPH_LANE");
      expect(container.querySelector(".diagrams-error")).toBeNull();
    });
  });

  it("the 3D View option is dimmed with a reason while the Lanes form is active, and never opens the 3D frame", async () => {
    await act(async () => { trayButton("CI matrix").click(); });
    await settlePreview();
    const view3dBtn = Array.from(toggleRow("View").querySelectorAll<HTMLButtonElement>("button")).find((b) => (b.getAttribute("aria-label") ?? "").includes(": 3d"))!;
    expect(view3dBtn.disabled).toBe(true);
    expect(view3dBtn.title || view3dBtn.getAttribute("aria-label")).toBeTruthy();
    await act(async () => { view3dBtn.click(); });
    await settlePreview();
    expect(container.querySelector(".diagrams-3d-frame")).toBeNull();
    expect(container.querySelector(".diagrams-grid-scroll")).not.toBeNull();
  });

  it("switching the lanes source's git-log/JSON tabs refreshes rather than stealing authority, and the JSON tab is valid parsed IR", async () => {
    await act(async () => { trayButton("Release train (git)").click(); });
    await settlePreview();
    const jsonTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) => b.textContent === "JSON")!;
    await act(async () => { jsonTab.click(); });
    const textarea = container.querySelector<HTMLTextAreaElement>(".diagrams-source")!;
    const parsed = JSON.parse(textarea.value);
    expect(parsed.nodes.length).toBeGreaterThan(0);
    const gitlogTab = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((b) => b.textContent === "Git log")!;
    await act(async () => { gitlogTab.click(); });
    const gitlogTextarea = container.querySelector<HTMLTextAreaElement>(".diagrams-source")!;
    expect(gitlogTextarea.value).toContain("Release 2.1.0");
  });

  it("a git-log edit reaches the live render, and a malformed line is placed on its own line with the lane rule's repair hint", async () => {
    await act(async () => { trayButton("Release train (git)").click(); });
    await settlePreview();
    const textarea = container.querySelector<HTMLTextAreaElement>(".diagrams-source")!;
    expect(container.querySelector(".diagrams-editor-highlight .diagrams-tok-keyword")!.textContent).toContain("HEAD -> main");
    const edit = async (value: string) => {
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        textarea.dispatchEvent(new Event("focusout", { bubbles: true }));
      });
      await settlePreview();
    };
    await edit(textarea.value.replace("Release 2.1.0", "Edited release"));
    expect(preview().textContent).toContain("Edited release");
    expect(container.querySelector(".diagrams-error")).toBeNull();
    await edit("b|a||Second\nthis line has no pipes\na|||First");
    const strip = container.querySelector("#diagrams-source-panel [role='alert']")!;
    expect(strip.textContent).toContain("GLYPH_LANE_GIT_SYNTAX");
    expect(strip.querySelector(".diagrams-editor-jump")!.textContent).toBe("Line 2");
    expect(strip.querySelector(".diagrams-editor-hint")!.textContent).toContain("newest first");
  });

  it("Copy as text reads the lanes render when the lanes form is active", async () => {
    await act(async () => { trayButton("CI matrix").click(); });
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
