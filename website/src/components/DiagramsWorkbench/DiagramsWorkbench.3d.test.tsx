// @vitest-environment node
// Packet D3 — page-behaviour tests for the 2D/3D view switch, the live web
// viewport, and "Copy reads the current camera." Deliberately NOT
// byte-exact against 3D frame content (the coordinator's own note: the
// library's frame content under `@glyphcss/diagrams/3d` is being actively
// reworked in a parallel fix round) — these assert structure and wiring.
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
vi.mock("../GalleryWorkbench/calibratedPalette", () => ({ CALIBRATED_PALETTE_NAME: "calibrated", ensureCalibratedPalette: () => {} }));
import GlyphDiagramsWorkbench from "./DiagramsWorkbench";
import { createGlyphDiagramsWorkbenchState, reduceGlyphDiagramsWorkbenchState } from "./diagramsWorkbenchState";
import { glyphDiagramsWorkbenchRenderOptions3d } from "./diagramsWorkbenchState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DiagramsWorkbench — 3D view switch (packet D3)", () => {
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
    }, { timeout: 2000, interval: 10 });
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

  // Mutation: render only the 2D `TargetPreview` path regardless of `state.view` → this reddens (no `.diagrams-3d-host` ever appears).
  it("switching View to 3D on the web target mounts the live scene host, not the 2D grid-scroll frame", async () => {
    await select("View", "3d");
    expect(container.querySelector(".diagrams-3d-host")).not.toBeNull();
    expect(container.querySelector(".diagrams-grid-scroll")).toBeNull();
  });

  // Mutation: swap `state.view === "2d"` back in place of `"3d"` in the
  // viewport branch → this reddens (the grid-scroll frame reappears on web).
  it("switching back to 2D returns to the grid-scroll TargetPreview frame", async () => {
    await select("View", "3d");
    expect(container.querySelector(".diagrams-3d-host")).not.toBeNull();
    await select("View", "2d");
    expect(container.querySelector(".diagrams-3d-host")).toBeNull();
    expect(container.querySelector(".diagrams-grid-scroll")).not.toBeNull();
  });

  // Mutation: 3D on terminal/chat mounts the SAME static-frame path 2D
  // uses (never a second live scene) — proven by presence of the ordinary
  // `.diagrams-grid-scroll` wrapper and absence of the live host.
  it("3D on the terminal target uses the static TargetPreview frame, not a live scene", async () => {
    await select("Target", "terminal");
    await select("View", "3d");
    expect(container.querySelector(".diagrams-3d-host")).toBeNull();
    expect(container.querySelector(".diagrams-grid-scroll")).not.toBeNull();
    expect(container.querySelector(".diagrams-preview")!.textContent).toMatch(/\S/);
  });

  it("the 3D folder (Layout / Z by / Seed / Rotation) shows only in the 3D view", async () => {
    // A nested lil-gui folder is itself a `GUI` instance: its own
    // `domElement` carries the `lil-gui` class (never `root`, reserved for
    // the top level — `lil-gui.esm.js`'s own `GUI` constructor) with a
    // `.title` child holding the folder's name. `show(false)` sets
    // `domElement.style.display = 'none'` on that same element.
    const folderRoot = () => Array.from(container.querySelectorAll(".lil-gui:not(.root)")).find((el) => el.querySelector(":scope > .title")?.textContent === "3D") as HTMLElement | undefined;
    expect(folderRoot()).toBeDefined();
    expect(folderRoot()!.style.display).toBe("none");
    await select("View", "3d");
    // Mutation: never call `view3d.show()`/`.hide()` → this stays "none" forever.
    expect(folderRoot()!.style.display).not.toBe("none");
  });
});

describe("Copy at the current camera (packet D3)", () => {
  // Pure function test: `glyphDiagramsWorkbenchRenderOptions3d` is what
  // both `renderGlyphDiagramsWorkbenchState3d` (Copy/static-frame) and the
  // live viewport's initial auto-fit read — so proving IT forwards
  // `state.camera3d` when set (and auto-fits when it isn't) proves "what
  // you copy is what you see" without driving a live drag gesture through
  // happy-dom. Mutation: drop the `state.camera3d` forwarding → this reddens.
  it("forwards `state.camera3d` as the explicit camera once the live viewport has reported one", () => {
    let state = createGlyphDiagramsWorkbenchState();
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-view", view: "3d" });
    expect(glyphDiagramsWorkbenchRenderOptions3d(state).camera).toBeUndefined();

    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-camera3d", camera: { rotX: 12, rotY: -40, zoom: 6.5 } });
    expect(glyphDiagramsWorkbenchRenderOptions3d(state).camera).toEqual({ rotX: 12, rotY: -40, zoom: 6.5 });
  });

  it("a layout/zBy/seed/controlsMode edit resets `camera3d` (a different layout needs its own fit)", () => {
    let state = createGlyphDiagramsWorkbenchState();
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-camera3d", camera: { rotX: 1, rotY: 2, zoom: 3 } });
    expect(state.camera3d).toBeDefined();
    state = reduceGlyphDiagramsWorkbenchState(state, { type: "set-view3d", patch: { layout: "force" } });
    expect(state.camera3d).toBeUndefined();
  });
});
