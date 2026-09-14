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
//
// Fix round 2 — the SAME wrapping pattern extended to: `sceneCreate` (counts
// `createGlyphScene` CALLS, for P2-4's "no remount on a charset/colour edit"
// gate), `sceneSetOptions` (records every `scene.setOptions(...)` argument,
// same reason), and `effectLayerDispose` (P2-5's effect-layer disposal
// gate) — every wrapper still forwards to the REAL implementation, never a
// fake one.
const disposalSpies = vi.hoisted(() => ({
  sceneDestroy: vi.fn(), controlsDestroy: vi.fn(),
  sceneCreate: vi.fn(), sceneSetOptions: vi.fn(), effectLayerDispose: vi.fn(),
}));
vi.mock("glyphcss", async (importOriginal) => {
  const actual = await importOriginal<typeof import("glyphcss")>();
  return {
    ...actual,
    createGlyphScene: (...args: Parameters<typeof actual.createGlyphScene>) => {
      disposalSpies.sceneCreate();
      const scene = actual.createGlyphScene(...args);
      const originalDestroy = scene.destroy.bind(scene);
      scene.destroy = () => { disposalSpies.sceneDestroy(); originalDestroy(); };
      const originalSetOptions = scene.setOptions.bind(scene);
      scene.setOptions = ((opts: unknown) => { disposalSpies.sceneSetOptions(opts); return originalSetOptions(opts as never); }) as typeof scene.setOptions;
      const originalAddEffectLayer = scene.addEffectLayer.bind(scene);
      scene.addEffectLayer = ((opts: unknown) => {
        const layer = originalAddEffectLayer(opts as never);
        const originalDispose = layer.dispose.bind(layer);
        layer.dispose = () => { disposalSpies.effectLayerDispose(); originalDispose(); };
        return layer;
      }) as typeof scene.addEffectLayer;
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
import { resolveDiagrams3dSceneOptions } from "./diagrams3dSceneOptions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("DiagramsWorkbench — 3D view switch (packet D3)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    disposalSpies.sceneDestroy.mockClear();
    disposalSpies.controlsDestroy.mockClear();
    disposalSpies.sceneCreate.mockClear();
    disposalSpies.sceneSetOptions.mockClear();
    disposalSpies.effectLayerDispose.mockClear();
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
    // P2-5 (fix round 2) — an active effect layer's own `dispose()` and its
    // `requestAnimationFrame` loop's `cancelAnimationFrame` must run on the
    // SAME view-switch cleanup, not just the scene/controls. Mounted here
    // (rather than a separate test) so the cleanup under test is the exact
    // one `sceneDestroy`/`controlsDestroy` below already pin.
    await selectDropdown("Effect", "glitch");
    const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");
    expect(disposalSpies.sceneDestroy).not.toHaveBeenCalled();
    expect(disposalSpies.controlsDestroy).not.toHaveBeenCalled();
    expect(disposalSpies.effectLayerDispose).not.toHaveBeenCalled();
    expect(host.isConnected).toBe(true);
    await select("View", "2d");
    expect(disposalSpies.sceneDestroy).toHaveBeenCalledTimes(1);
    expect(disposalSpies.controlsDestroy).toHaveBeenCalledTimes(1);
    // Mutation: drop `disposeEffect()` from `Diagrams3DViewport.tsx`'s
    // mount-effect cleanup (leaving only `controls?.destroy()`/
    // `scene?.destroy()`) → these two redden (the layer and its rAF loop
    // leak past the view switch).
    expect(disposalSpies.effectLayerDispose, "the mounted effect layer must be disposed too").toHaveBeenCalledTimes(1);
    expect(cancelSpy, "the effect's own rAF loop must be cancelled").toHaveBeenCalled();
    expect(host.isConnected).toBe(false);
    expect(container.querySelector(".diagrams-3d-host")).toBeNull();
    cancelSpy.mockRestore();
  });

  it("disposes the live scene's controls and scene on unmount", async () => {
    await select("View", "3d");
    const host = await waitForLiveScene();
    await selectDropdown("Effect", "glitch"); // P2-5 — same effect-layer/rAF disposal, now via unmount
    const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");
    expect(host.isConnected).toBe(true);
    await act(async () => root.unmount());
    expect(disposalSpies.sceneDestroy).toHaveBeenCalledTimes(1);
    expect(disposalSpies.controlsDestroy).toHaveBeenCalledTimes(1);
    // Mutation: same as above, for the unmount path.
    expect(disposalSpies.effectLayerDispose, "the mounted effect layer must be disposed too").toHaveBeenCalledTimes(1);
    expect(cancelSpy, "the effect's own rAF loop must be cancelled").toHaveBeenCalled();
    expect(host.isConnected).toBe(false);
    cancelSpy.mockRestore();
  });

  // P2-5 (fix round 2) — a genuine effect-id CHANGE (not a target-only
  // retarget) must dispose the OLD layer and its rAF loop before mounting
  // the new one, never leak the old alongside it.
  // Mutation: `applyEffect()`'s "same effect" retarget branch mistakenly
  // reused for a genuinely different effect id (so the old layer is never
  // disposed, only reconfigured) → `effectLayerDispose` stays uncalled.
  it("changing the effect disposes the old layer and cancels its rAF loop", async () => {
    await select("View", "3d");
    await waitForLiveScene();
    await selectDropdown("Effect", "glitch");
    expect(disposalSpies.effectLayerDispose).not.toHaveBeenCalled();
    const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");
    await selectDropdown("Effect", "scan");
    expect(disposalSpies.effectLayerDispose).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalled();
    cancelSpy.mockRestore();
  });

  // P2-4 (fix round 2) — a charset OR colour edit must call `scene.setOptions`
  // with the newly resolved options and must NOT remount the scene.
  // Mutation: delete the `[charset, color]` `scene.setOptions` effect in
  // `Diagrams3DViewport.tsx` → `sceneSetOptions` is never called here.
  // Mutation: fold charset/colour into the mount effect's own dependency
  // array (so an edit remounts the whole scene) → `sceneCreate`'s call
  // count increases here, reddening the "without remounting" assertions.
  it("a charset or colour change calls scene.setOptions once, without remounting the scene", async () => {
    await select("View", "3d");
    await waitForLiveScene();
    // Move off the default charset first (its default happens to already
    // be a charset the SAME "solid"/"ascii" scene options apply to — this
    // isolates the transition actually under test).
    await select("Charset", "box");

    const createCallsAfterMount = disposalSpies.sceneCreate.mock.calls.length;
    disposalSpies.sceneSetOptions.mockClear();
    await select("Charset", "ascii");
    expect(disposalSpies.sceneSetOptions).toHaveBeenCalled();
    const afterCharset = disposalSpies.sceneSetOptions.mock.calls.at(-1)![0] as Record<string, unknown>;
    const expectedCharset = resolveDiagrams3dSceneOptions("ascii", "css");
    expect(afterCharset).toMatchObject({ mode: expectedCharset.mode, charMode: expectedCharset.charMode, useColors: expectedCharset.useColors });
    expect(disposalSpies.sceneCreate.mock.calls.length, "createGlyphScene must not be called again for a charset edit").toBe(createCallsAfterMount);

    disposalSpies.sceneSetOptions.mockClear();
    await select("Color", "none");
    expect(disposalSpies.sceneSetOptions).toHaveBeenCalled();
    const afterColor = disposalSpies.sceneSetOptions.mock.calls.at(-1)![0] as Record<string, unknown>;
    const expectedColor = resolveDiagrams3dSceneOptions("ascii", "none");
    expect(afterColor).toMatchObject({ mode: expectedColor.mode, charMode: expectedColor.charMode, useColors: expectedColor.useColors });
    expect(disposalSpies.sceneCreate.mock.calls.length, "createGlyphScene must not be called again for a colour edit").toBe(createCallsAfterMount);
  });

  // Fix round 2, P1-1 — the live OBJECT's own overlay tier must match the
  // selected charset, not just the scene's render mode. "box" and "ascii"
  // resolve to the IDENTICAL `mode`/`charMode` (both `solid`/`ascii`, only
  // `canvasTier` differs — `diagrams3dSceneOptions.test.ts`'s own matrix),
  // so `scene.setOptions` alone (round 1's fix) produces NO visible change
  // between them; only rebuilding the object's own box-outline tier does.
  // Mutation: drop `charset` from the `[charset]` object-rebuild effect's
  // `glyphDiagramObject` call in `Diagrams3DViewport.tsx` (or from the mount
  // effect's own `renderGlyphDiagram3d` probe call) → the live picture never
  // loses its Unicode box-drawing glyphs when switching to "ascii", reddening.
  it("switching Charset from box to ascii replaces the live object's Unicode box-outline glyphs with plain ASCII ones", async () => {
    await select("View", "3d");
    const host = await waitForLiveScene();
    await select("Charset", "box");
    const pre = host.querySelector(".glyph-output")!;
    expect(pre.textContent, "the box tier's straight box-outline glyphs (U+2500/U+2502) should be present").toMatch(/[─│]/);
    await select("Charset", "ascii");
    expect(pre.textContent, "the ascii tier draws no Unicode box-drawing glyphs at all (AGENTS.md: ASCII is 7-bit throughout)").not.toMatch(/[─│]/);
  });

  // Fix round 2 (found while implementing P1-1's own object-rebuild reuse
  // of `applyEffect()`) — glyphcss's own effect-layer `target` is IMMUTABLE
  // after mount (verified against the real library: `setOptions` with a
  // DIFFERENT mesh-id set throws "an effect layer's mesh target is
  // immutable after mount"), so the round-1 code's "retarget without
  // remounting" branch actually THREW the moment a reader picked a
  // DIFFERENT node while an effect was already mounted. `applyEffect()` now
  // always fully disposes and remounts on a genuine target change.
  it("picking a different effect target node while an effect is mounted retargets without throwing", async () => {
    await select("View", "3d");
    const host = await waitForLiveScene();
    await selectDropdown("Effect", "glitch");
    const targetOptions = Array.from(controller("Target").querySelectorAll<HTMLOptionElement>("select option")).map((o) => o.textContent!);
    expect(targetOptions.length, "the default preset graph needs at least two real nodes for this test").toBeGreaterThanOrEqual(3);
    await selectDropdown("Target", targetOptions[1]!);
    disposalSpies.effectLayerDispose.mockClear();
    // Mutation: revert to `layer.setOptions({ target })` for a same-effect
    // retarget → this `await` throws (an uncaught exception inside the
    // component's own effect, surfaced through `act()`), failing the test
    // before either assertion below runs.
    await selectDropdown("Target", targetOptions[2]!);
    expect(disposalSpies.effectLayerDispose, "a genuine retarget disposes the old layer and mounts a fresh one").toHaveBeenCalled();
    expect(host.querySelector(".glyph-output")?.textContent).toMatch(/\S/);
  });

  // A STALE target (a `?d=` link naming a node id from a graph that no
  // longer has it) must mount no effect layer and never throw — glyphcss's
  // own `addEffectLayer` REJECTS a literal empty-array target outright
  // (verified against the real library: "an effect target mesh array must
  // contain at least one GlyphMeshHandle"), so `resolveEffectTarget`'s
  // stale case now resolves to `null` ("mount nothing") rather than `[]`.
  // Mutation: resolve a stale target back to `[]` and pass it straight to
  // `scene.addEffectLayer` → the live viewport's own mount effect throws
  // during its post-mount `applyEffect()` call and the scene never settles,
  // timing out `vi.waitFor` below.
  it("a stale effect target (a removed/unknown node id) mounts no effect layer and never throws", async () => {
    // `applyEffect()` runs from inside the mount effect's own unawaited
    // async IIFE, so a throw there is an UNHANDLED PROMISE REJECTION, not
    // an exception `act()` surfaces synchronously — `.glyph-output` still
    // appears (the scene/object mount ahead of the effect layer), so a
    // plain content assertion alone passes even under the `[]`-to-
    // `addEffectLayer` mutation this test exists to catch. Listening for
    // the rejection directly is what actually pins it.
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => { rejections.push(reason); };
    process.on("unhandledRejection", onRejection);
    try {
      const badState = { ...createGlyphDiagramsWorkbenchState(), view: "3d" as const, effect3d: { effectId: "glitch", targetId: "not-a-real-node-id" } };
      const badContainer = document.createElement("div");
      document.body.append(badContainer);
      const badRoot = createRoot(badContainer);
      await act(async () => badRoot.render(<GlyphDiagramsWorkbench initialState={badState} />));
      await vi.waitFor(async () => {
        await act(async () => { await vi.dynamicImportSettled(); });
        expect(badContainer.querySelector(".diagrams-3d-host .glyph-output")).not.toBeNull();
      }, { timeout: 3000, interval: 10 });
      expect(badContainer.querySelector(".diagrams-3d-host .glyph-output")!.textContent).toMatch(/\S/);
      expect(disposalSpies.effectLayerDispose).not.toHaveBeenCalled(); // nothing was ever mounted to dispose
      await act(async () => badRoot.unmount());
      badContainer.remove();
      // Let any pending unhandled-rejection microtask surface before asserting.
      await new Promise((resolve) => setTimeout(resolve, 0));
      // Mutation: resolve a stale target back to `[]` and pass it straight
      // to `scene.addEffectLayer` → this reddens (a real, caught rejection
      // from glyphcss's own "must contain at least one GlyphMeshHandle").
      expect(rejections, "mounting with a stale effect target must never throw/reject").toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
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
