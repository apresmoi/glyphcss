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
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "DOMException", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? window : window[key] });
  }
});
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
vi.mock("../GalleryWorkbench/calibratedPalette", () => ({ CALIBRATED_PALETTE_NAME: "calibrated", ensureCalibratedPalette: () => {} }));
// P2-3, fix round 1 — spy on the REAL `scene.destroy()`/`controls.destroy()`
// (never a fake implementation: `importOriginal` + a thin wrapper around the
// factories' own returned handles) so the disposal tests below assert the
// call itself happened, not merely that the host `<div>` left the DOM.
const disposalSpies = vi.hoisted(() => ({ sceneDestroy: vi.fn(), controlsDestroy: vi.fn() }));
vi.mock("glyphcss", async (importOriginal) => {
  const actual = await importOriginal<typeof import("glyphcss")>();
  return {
    ...actual,
    createGlyphScene: (...args: Parameters<typeof actual.createGlyphScene>) => {
      const scene = actual.createGlyphScene(...args);
      const originalDestroy = scene.destroy.bind(scene);
      scene.destroy = () => { disposalSpies.sceneDestroy(); originalDestroy(); };
      return scene;
    },
    createGlyphOrbitControls: (...args: Parameters<typeof actual.createGlyphOrbitControls>) => {
      const controls = actual.createGlyphOrbitControls(...args);
      const originalDestroy = controls.destroy.bind(controls);
      controls.destroy = () => { disposalSpies.controlsDestroy(); originalDestroy(); };
      return controls;
    },
  };
});
import GlyphDiagramsWorkbench from "./DiagramsWorkbench";
import { createGlyphDiagramsWorkbenchState, reduceGlyphDiagramsWorkbenchState } from "./diagramsWorkbenchState";
import { glyphDiagramsWorkbenchRenderOptions3d } from "./diagramsWorkbenchState";
import { decodeDiagramsUrlState } from "./diagramsUrlState";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DiagramsWorkbench — 3D view switch (packet D3)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    disposalSpies.sceneDestroy.mockClear();
    disposalSpies.controlsDestroy.mockClear();
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
  // The plain lil-gui dropdown rows ("Layout"/"Z by"/"Seed"/"Rotation" in
  // the "3D" folder) — same shape `DiagramsWorkbench.test.tsx`'s own
  // `controller()` helper reads.
  function controller(name: string): Element {
    return Array.from(container.querySelectorAll("#diagrams-controls-panel .controller")).find((node) => node.querySelector(".name")?.textContent?.toLowerCase() === name.toLowerCase())!;
  }
  async function selectDropdown(name: string, optionText: string) {
    const field = controller(name).querySelector("select")!;
    const index = Array.from(field.options).findIndex((o) => o.textContent === optionText);
    await act(async () => {
      field.selectedIndex = index;
      field.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settlePreview();
  }
  function button(label: string): HTMLButtonElement {
    return Array.from(container.querySelectorAll<HTMLButtonElement>(".gw-code-panel__action")).find((b) => b.textContent === label)!;
  }
  /** Waits for the live scene's own `<pre class="glyph-output">` to appear inside `.diagrams-3d-host` — the async `createGlyphScene`/`scene.addObject` mount signal this file's tests otherwise have no hook into. */
  async function waitForLiveScene(): Promise<HTMLElement> {
    return vi.waitFor(async () => {
      await act(async () => { await vi.dynamicImportSettled(); });
      const pre = container.querySelector<HTMLElement>(".diagrams-3d-host .glyph-output");
      expect(pre).not.toBeNull();
      return container.querySelector<HTMLElement>(".diagrams-3d-host")!;
    }, { timeout: 3000, interval: 10 });
  }
  function dispatchPointer(target: Element, type: string, x: number, y: number, pointerId = 1) {
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId, isPrimary: true, bubbles: true }));
  }
  /** A real drag gesture on the live host: pointerdown, a few pointermoves, pointerup — the SAME sequence `createGlyphOrbitControls.test.ts`'s own helpers drive. */
  async function dragHost(host: Element, dx: number, dy: number) {
    await act(async () => {
      dispatchPointer(host, "pointerdown", 100, 100);
      dispatchPointer(host, "pointermove", 100 + dx / 2, 100 + dy / 2);
      dispatchPointer(host, "pointermove", 100 + dx, 100 + dy);
      dispatchPointer(host, "pointerup", 100 + dx, 100 + dy);
    });
    await settlePreview(); // the drag's "end" event dispatches `set-camera3d`, which re-triggers the 3D static render `completed3d` effect
  }
  /** The export bar's FIRST action button is always "Copy as text" — found
   *  by POSITION, not text, because its own label flips to "Copied" for
   *  1200ms after a click (`flashButtonState`, real timers, un-advanced
   *  here) and this helper is deliberately called twice per interaction
   *  test. */
  function copyAsTextButton(): HTMLButtonElement {
    return container.querySelectorAll<HTMLButtonElement>(".gw-code-panel__action")[0]!;
  }
  async function copiedText(): Promise<string> {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await act(async () => copyAsTextButton().click());
    const text = writeText.mock.calls.at(-1)?.[0] ?? "";
    writeText.mockRestore();
    return text;
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

  // P2-3, fix round 1 — a REAL orbit drag (turntable, the default
  // `Rotation`), synthesized pointer events through `createGlyphOrbitControls`
  // itself (the same `pointerdown`/`pointermove`/`pointerup` sequence
  // `createGlyphOrbitControls.test.ts`'s own helpers drive), proving the
  // drag actually reaches the live scene's camera and that camera actually
  // reaches Copy — not merely that the wiring TYPE-CHECKS.
  // Mutation: drop the `controls.addEventListener("end", reportCamera)`
  // call in `Diagrams3DViewport.tsx` → `state.camera3d` never updates and
  // this reddens (copied text before/after the drag stays identical).
  it("a real orbit drag (turntable) changes the live camera, and Copy afterwards reflects it", async () => {
    await select("View", "3d");
    const host = await waitForLiveScene();
    const before = await copiedText();
    await dragHost(host, 220, 90);
    const after = await copiedText();
    expect(after).not.toBe(before);
  }, 15_000);

  // Same property, `Rotation: trackball` — AGENTS.md's `pitchRange`+
  // trackball contract: a single-pointer drag in trackball mode rotates
  // about the screen axis perpendicular to the drag (`camera.mat`/`useMat`)
  // rather than `rotX`/`rotY`, reaching any orientation including roll —
  // the mechanism the user's "rotates in any direction" requirement rests
  // on. Mutation: hardcode `mode: "turntable"` in `Diagrams3DViewport.tsx`'s
  // `createGlyphOrbitControls` call → this reddens exactly like the
  // turntable case above (dragging still moves rotX/rotY, so Copy still
  // changes — the MUTATION this test actually catches is under "asserts
  // the mat-camera shape", not this bare "Copy changes" clause alone; see
  // the follow-up assertion below).
  it("a real drag under Rotation: trackball also changes the live camera, and Copy reflects it", async () => {
    await select("View", "3d");
    await waitForLiveScene();
    await selectDropdown("Rotation", "trackball");
    const host = container.querySelector(".diagrams-3d-host")!;
    const before = await copiedText();
    await dragHost(host, 140, 160);
    const after = await copiedText();
    expect(after).not.toBe(before);
  }, 15_000);

  // The mutation `mode: "turntable"` above can't be distinguished by "Copy
  // changed" alone (both modes rotate on drag) — this checks the CAMERA
  // SHAPE trackball mode actually commits: a `mat`-based camera, never
  // `rotX`/`rotY`. Mutation: hardcode `mode: "turntable"` → this reddens
  // (`state.camera3d` keeps the `{ rotX, rotY, zoom }` shape).
  it("trackball mode reports a `mat`-based camera after a drag, not rotX/rotY", async () => {
    await select("View", "3d");
    await waitForLiveScene();
    await selectDropdown("Rotation", "trackball");
    const host = container.querySelector(".diagrams-3d-host")!;
    await dragHost(host, 160, 120);
    // The mounted page's own React state isn't directly readable from
    // outside — this reads the SAME signal `diagramsUrlState.test.ts`'s own
    // "round-trips a trackball (mat) camera" pure-function case checks,
    // via the REAL "Copy link" button (mirrors `DiagramsWorkbench.test.tsx`'s
    // own final-gate-2 Copy-link test idiom) — proving a REAL drag, not
    // just a hand-built `set-camera3d` dispatch, is what produces it.
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    act(() => button("Copy link").click());
    await act(async () => { await vi.waitFor(() => expect(writeText).toHaveBeenCalled()); });
    const link = writeText.mock.calls.at(-1)![0] as string;
    const param = new URLSearchParams(link.split("?")[1] ?? "").get("d");
    const decoded = await decodeDiagramsUrlState(param);
    expect(decoded).not.toBeNull();
    expect(decoded!.camera3d?.mat).toBeDefined();
    expect(decoded!.camera3d?.rotX).toBeUndefined();
    expect(decoded!.camera3d?.rotY).toBeUndefined();
  }, 15_000);

  // P2-3 — disposal. `scene.destroy()`/`controls.destroy()` must run on a
  // view switch away from 3D AND on unmount, never leaking the live
  // scene's own render loop or event listeners.
  // Mutation: drop `controls?.destroy()` or `scene?.destroy()` from
  // `Diagrams3DViewport.tsx`'s cleanup → these redden (the spy is never called).
  // Mutation: drop `scene?.destroy()`/`controls?.destroy()` from
  // `Diagrams3DViewport.tsx`'s cleanup function → `disposalSpies` stay at 0
  // even though the host `<div>` still leaves the DOM (React's own removal
  // is unconditional; the glyphcss-side cleanup is what these spies pin).
  it("disposes the live scene's controls and scene on a view switch away from 3D", async () => {
    await select("View", "3d");
    const host = await waitForLiveScene();
    expect(disposalSpies.sceneDestroy).not.toHaveBeenCalled();
    expect(disposalSpies.controlsDestroy).not.toHaveBeenCalled();
    expect(host.isConnected).toBe(true);
    await select("View", "2d");
    expect(disposalSpies.sceneDestroy).toHaveBeenCalledTimes(1);
    expect(disposalSpies.controlsDestroy).toHaveBeenCalledTimes(1);
    expect(host.isConnected).toBe(false);
    expect(container.querySelector(".diagrams-3d-host")).toBeNull();
  });

  it("disposes the live scene's controls and scene on unmount", async () => {
    await select("View", "3d");
    const host = await waitForLiveScene();
    expect(host.isConnected).toBe(true);
    await act(async () => root.unmount());
    expect(disposalSpies.sceneDestroy).toHaveBeenCalledTimes(1);
    expect(disposalSpies.controlsDestroy).toHaveBeenCalledTimes(1);
    expect(host.isConnected).toBe(false);
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
