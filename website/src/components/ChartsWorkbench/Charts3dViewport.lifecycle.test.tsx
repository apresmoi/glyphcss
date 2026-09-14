// @vitest-environment node
// Packet C3, fix round 1, P2-3 (codex review): `chartsWorkbench3d.test.ts`
// only exercises the pure resolvers — this file drives the REAL live
// viewport (a genuine `createGlyphScene`/`createGlyphOrbitControls` mount
// through a real DOM), mirroring `DiagramsWorkbench.3d.test.tsx`'s own
// disposal-spy idiom (D3's own P2-3 round) since that is the reference this
// file was studied from: a real PointerEvent drag reaching Copy, a
// trackball drag committing `mat`, `createGlyphScene` called exactly ONCE
// across a charset/colour/shading edit (P1-2's own guarantee — `setOptions`/
// `update` in place of a remount), and scene/controls disposal on switching
// back to 2D and on unmount. Each test is a genuine mutation check: reverting
// `Charts3dViewport.tsx`'s own P1-2 fix (recombining the mount/mark/colour
// effects back into one `[mark, sceneOptions.useColors]`-keyed effect) turns
// the "called once" assertions red.
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
  for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Event", "MouseEvent", "PointerEvent", "KeyboardEvent", "DOMException", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? window : window[key] });
  }
});
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
vi.mock("../GalleryWorkbench/calibratedPalette", () => ({ CALIBRATED_PALETTE_NAME: "calibrated", ensureCalibratedPalette: () => {} }));

// Real factories, thinly wrapped so a spy call proves a REAL scene/controls
// object was actually built/destroyed/updated — never a fake standing in
// for glyphcss's own mount/dispose/update contract.
const sceneSpies = vi.hoisted(() => ({
  createGlyphSceneCalls: 0,
  sceneDestroy: vi.fn(),
  controlsDestroy: vi.fn(),
  setOptions: vi.fn(),
  objectUpdate: vi.fn(),
}));
vi.mock("glyphcss", async (importOriginal) => {
  const actual = await importOriginal<typeof import("glyphcss")>();
  return {
    ...actual,
    createGlyphScene: (...args: Parameters<typeof actual.createGlyphScene>) => {
      sceneSpies.createGlyphSceneCalls += 1;
      const scene = actual.createGlyphScene(...args);
      const originalDestroy = scene.destroy.bind(scene);
      scene.destroy = () => { sceneSpies.sceneDestroy(); originalDestroy(); };
      const originalSetOptions = scene.setOptions.bind(scene);
      scene.setOptions = (opts) => { sceneSpies.setOptions(opts); return originalSetOptions(opts); };
      const originalAddObject = scene.addObject.bind(scene);
      scene.addObject = (...addArgs: Parameters<typeof scene.addObject>) => {
        const handle = originalAddObject(...addArgs);
        const originalUpdate = handle.update.bind(handle);
        handle.update = (object) => { sceneSpies.objectUpdate(); return originalUpdate(object); };
        return handle;
      };
      return scene;
    },
    createGlyphOrbitControls: (...args: Parameters<typeof actual.createGlyphOrbitControls>) => {
      const controls = actual.createGlyphOrbitControls(...args);
      const originalDestroy = controls.destroy.bind(controls);
      controls.destroy = () => { sceneSpies.controlsDestroy(); originalDestroy(); };
      return controls;
    },
  };
});
import ChartsWorkbench from "./ChartsWorkbench";
import { CHART_CHARSETS, createChartsWorkbenchState, reduceChartsWorkbenchState } from "./chartsWorkbenchState";
import { CHARTS_3D_DATASETS } from "./datasets/chart3d";
import { decodeChartsUrlState } from "./chartsUrlState";
import { glyphChart3dCharsetDegrades } from "@glyphcss/charts/3d";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChartsWorkbench — live 3D viewport lifecycle (packet C3, fix round 1 P2-3)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    sceneSpies.createGlyphSceneCalls = 0;
    sceneSpies.sceneDestroy.mockClear();
    sceneSpies.controlsDestroy.mockClear();
    sceneSpies.setOptions.mockClear();
    sceneSpies.objectUpdate.mockClear();
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
  function enter3d(): HTMLElement {
    const tile = container.querySelector<HTMLButtonElement>(`[aria-label="View ${CHARTS_3D_DATASETS[0]!.title} in 3D"]`)!;
    act(() => tile.click());
    const host = container.querySelector<HTMLElement>(".charts-3d-viewport-host")!;
    expect(host.querySelector(".glyph-output")).not.toBeNull(); // the real live mount, synchronous under `createGlyphScene`
    return host;
  }
  function dispatchPointer(target: Element, type: string, x: number, y: number, pointerId = 1) {
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId, isPrimary: true, bubbles: true }));
  }
  function dragHost(host: Element, dx: number, dy: number) {
    act(() => {
      dispatchPointer(host, "pointerdown", 100, 100);
      dispatchPointer(host, "pointermove", 100 + dx / 2, 100 + dy / 2);
      dispatchPointer(host, "pointermove", 100 + dx, 100 + dy);
      dispatchPointer(host, "pointerup", 100 + dx, 100 + dy);
    });
  }
  function copyAsciiButton(): HTMLButtonElement {
    return Array.from(container.querySelectorAll<HTMLButtonElement>(".gw-code-panel__action")).find((b) => b.textContent === "Copy ASCII" || b.textContent === "Copied")!;
  }
  async function copiedAscii(): Promise<string> {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    await act(async () => { copyAsciiButton().click(); });
    const text = writeText.mock.calls.at(-1)?.[0] as string | undefined;
    writeText.mockRestore();
    expect(text).toBeDefined();
    return text!;
  }
  async function copiedLinkChart3dCamera() {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>(".gw-code-panel__action")).find((b) => b.textContent === "Copy link" || b.textContent === "Copied")!;
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    // `copyLink`'s own `onClick={() => void copyLink()}` is fire-and-forget
    // — the click itself returns before the async body runs, so this waits
    // for the spy separately (`DiagramsWorkbench.3d.test.tsx`'s own idiom).
    act(() => button.click());
    await act(async () => { await vi.waitFor(() => expect(writeText).toHaveBeenCalled()); });
    const link = writeText.mock.calls.at(-1)?.[0] as string;
    writeText.mockRestore();
    const param = new URLSearchParams(link.split("?")[1] ?? "").get("c");
    const decoded = await decodeChartsUrlState(param);
    expect(decoded).not.toBeNull();
    return decoded!.chart3d.camera;
  }

  // Mutation: drop `orbitControls.addEventListener("end", onEnd)` in
  // `Charts3dViewport.tsx`'s mount effect -> `state.chart3d.camera` never
  // updates and this reddens (copied ASCII before/after the drag stays
  // identical, since `renderCharts3dStatic` always reads the current camera).
  it("a real turntable drag on the live host changes the camera, and Copy ASCII afterwards reflects it", async () => {
    const host = enter3d();
    const before = await copiedAscii();
    dragHost(host, 260, 90);
    const after = await copiedAscii();
    expect(after).not.toBe(before);
  }, 15_000);

  // Rotate: trackball — a single-pointer drag composes into `camera.mat`/
  // `useMat` (`createGlyphOrbitControls`'s own trackball path), never
  // `rotX`/`rotY`. Mutation: hardcode `mode: "turntable"` in
  // `Charts3dViewport.tsx`'s `createGlyphOrbitControls` call -> the drag
  // still changes Copy (both modes rotate), but the `mat` assertion below
  // reddens (`?c=`'s own `chart3d.camera` keeps its `rotX`/`rotY`-only shape).
  it("a real drag under Rotate: Trackball commits camera.mat/useMat, verified via the real Copy-link round trip", async () => {
    const host = enter3d();
    pickToggle("Rotate", "Trackball");
    dragHost(host, 180, 140);
    const camera = await copiedLinkChart3dCamera();
    expect(camera.useMat).toBe(true);
    expect(camera.mat).toBeDefined();
    expect(camera.mat).toHaveLength(9);
  }, 15_000);

  // P1-2 fix round 1 (codex review) — the core guarantee: `createGlyphScene`
  // is called ONCE for the viewport's whole mounted lifetime, across a
  // charset edit, a colour edit AND a shading/colorscale edit (each of
  // which used to tear the scene down and rebuild it, resetting the
  // camera). Mutation: restore the old single `[mark, sceneOptions.
  // useColors]`-keyed mount effect -> `createGlyphSceneCalls` climbs past 1
  // on the colour/shading edits below.
  it("createGlyphScene is called exactly once across a charset change, a colour change and a shading/colorscale change", async () => {
    enter3d();
    expect(sceneSpies.createGlyphSceneCalls).toBe(1);

    // Charset: never reaches the live scene at all (`chartsWorkbench3dSceneOptions`'s
    // own doc — a 3D chart's box/tick overlay always disables the halfblock
    // encoder, so charset carries no scene-option payload); still asserted
    // here as the literal case the finding named.
    pickToggle("Charset", "ascii");
    expect(sceneSpies.createGlyphSceneCalls).toBe(1);

    // Colour: `color: css` -> `color: none` flips `useColors` — applied via
    // `scene.setOptions`, never a remount.
    pickToggle("Color", "none");
    expect(sceneSpies.createGlyphSceneCalls).toBe(1);
    expect(sceneSpies.setOptions).toHaveBeenCalledWith({ useColors: false });

    // Shading: a new mark (different `glyphChartSurface` build) — applied
    // via the scene-object handle's `update()`, never a remount.
    pickToggle("Shading", "Value");
    expect(sceneSpies.createGlyphSceneCalls).toBe(1);
    expect(sceneSpies.objectUpdate).toHaveBeenCalled();

    // Colorscale: same mechanism as shading — one more `update()`, still no remount.
    const colorscaleUpdatesBefore = sceneSpies.objectUpdate.mock.calls.length;
    pickToggle("Colorscale", "magma");
    expect(sceneSpies.createGlyphSceneCalls).toBe(1);
    expect(sceneSpies.objectUpdate.mock.calls.length).toBeGreaterThan(colorscaleUpdatesBefore);
  });

  // Disposal — `scene.destroy()`/`controls.destroy()` must run on a type
  // switch away from 3D. Mutation: drop `scene?.destroy()`/`orbitControls.
  // destroy()` from `Charts3dViewport.tsx`'s cleanup -> these spies stay at
  // 0 even though the host `<div>` still leaves the DOM (React's own
  // removal is unconditional; the glyphcss-side cleanup is what these pin).
  it("disposes the live scene's controls and scene on switching the mark type back to 2D", () => {
    const host = enter3d();
    expect(sceneSpies.sceneDestroy).not.toHaveBeenCalled();
    expect(sceneSpies.controlsDestroy).not.toHaveBeenCalled();
    expect(host.isConnected).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>('.charts-mark-row[data-row="type"] [aria-label$=": line"]')!.click());
    expect(sceneSpies.sceneDestroy).toHaveBeenCalledTimes(1);
    expect(sceneSpies.controlsDestroy).toHaveBeenCalledTimes(1);
    expect(host.isConnected).toBe(false);
    expect(container.querySelector(".charts-3d-viewport-host")).toBeNull();
  });

  it("disposes the live scene's controls and scene on unmount", () => {
    const host = enter3d();
    expect(host.isConnected).toBe(true);
    act(() => root.unmount());
    expect(sceneSpies.sceneDestroy).toHaveBeenCalledTimes(1);
    expect(sceneSpies.controlsDestroy).toHaveBeenCalledTimes(1);
    expect(host.isConnected).toBe(false);
  });

  // C3 fix round 2 (user feedback: "why do we have this in the rendering
  // area?" — the old `.charts-3d-downgrade-note` banner violated AGENTS.md's
  // own "TargetPreview" rule). Mutation: re-adding any note/banner element
  // inside `.charts-3d-viewport` (the old `sceneOptions.downgradeNote`
  // branch, or a lookalike) reddens this — `.charts-3d-viewport`'s only
  // child must always be the bare scene host, for every charset, including
  // one the library predicate flags as unsupported.
  // Matches by aria-label PREFIX, not `optionOf`'s "text after the last
  // ': '" (a DISABLED option's own aria-label appends " — <reason>" after
  // its value with no colon in it, which `optionOf` would fold into the
  // match key and break an exact-equality lookup).
  function charsetButton(charset: string): HTMLButtonElement {
    return Array.from(toggleRow("Charset").querySelectorAll<HTMLButtonElement>("button"))
      .find((b) => (b.getAttribute("aria-label") ?? "").startsWith(`Character set: ${charset}`))!;
  }

  it("the viewport never renders a note or banner element, for every charset", () => {
    enter3d();
    for (const charset of CHART_CHARSETS) {
      act(() => charsetButton(charset).click()); // a no-op click on a disabled option, exactly like a real browser
      const viewport = container.querySelector(".charts-3d-viewport")!;
      expect(viewport.children, charset).toHaveLength(1);
      expect(viewport.children[0]!.className, charset).toBe("charts-3d-viewport-host");
      expect(viewport.querySelector(".charts-3d-downgrade-note"), charset).toBeNull();
    }
  });

  // The reason instead lives on the Charset toggle's own button — the
  // `mapDirectionLocked` idiom this page already uses for an unfit mark
  // type — derived from the library's real `glyphChart3dCharsetDegrades`
  // predicate (never a hardcoded charset), so it also proves the dimmed
  // set actually tracks the predicate through the REAL mounted page, not
  // just the pure `chartsCharsetToggle` unit test in `chartsWorkbench3d.test.ts`.
  // Mutation: dropping `disabled`/`disabledReason` from `chartsCharsetToggle`
  // reddens this (the button stays enabled with no title reason).
  it("a charset the library predicate flags is dimmed on the Charset toggle with a plain-English reason, in 3D only", () => {
    enter3d();
    for (const charset of CHART_CHARSETS) {
      const button = charsetButton(charset);
      const shouldDegrade = glyphChart3dCharsetDegrades(charset);
      expect(button.disabled, charset).toBe(shouldDegrade);
      if (shouldDegrade) {
        expect(button.title, charset).toContain("Not available for 3D surfaces yet");
        expect(button.getAttribute("aria-label"), charset).toContain("Not available for 3D surfaces yet");
      }
    }
  });

  // Item 3 of the round-2 brief: an EXPLICIT override (unreachable through
  // the now-dimmed toggle button, which a disabled `<button>` refuses a
  // synthetic `.click()` for exactly like a real browser does) still lands
  // an unsupported charset on the live scene — a hand-built `?c=` link
  // could carry one from before this charset degraded, or a link saved
  // under a since-changed library predicate. The scene must still mount
  // and render (the faithful SILENT downgrade — there was never a live
  // `charMode` to set for it either way), with no banner anywhere.
  it("an explicit override handing the 3D view an unsupported charset still renders silently, with no banner", () => {
    act(() => root.unmount());
    let state = createChartsWorkbenchState();
    state = reduceChartsWorkbenchState(state, { type: "select-3d-dataset", id: CHARTS_3D_DATASETS[0]!.id });
    state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "charset", value: "braille" } });
    expect(glyphChart3dCharsetDegrades("braille")).toBe(true); // the premise this test exercises
    root = createRoot(container);
    act(() => root.render(<ChartsWorkbench initialState={state} />));
    const host = container.querySelector<HTMLElement>(".charts-3d-viewport-host")!;
    expect(host.querySelector(".glyph-output")).not.toBeNull(); // the scene mounted and rendered
    expect(container.querySelector(".charts-3d-viewport")!.children).toHaveLength(1);
    expect(container.querySelector(".charts-3d-downgrade-note")).toBeNull();
  });
});
