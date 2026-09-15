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
  createGlyphSceneOptions: vi.fn(),
  sceneDestroy: vi.fn(),
  controlsDestroy: vi.fn(),
  setOptions: vi.fn(),
  objectUpdate: vi.fn(),
  // Bug-fix packet (type-swap crash): counts the SCENE's own `addObject`
  // calls (mount + every genuine type swap) and each mounted object
  // handle's own `remove()` (a type swap only) — the mechanism-level
  // counterpart to `objectUpdate` above, so a same-type swap ("still uses
  // update()") and a type swap ("remove + addObject, never a scene
  // remount") are each pinned on the primitive the fix actually calls,
  // not just on the rendered pixels.
  addObject: vi.fn(),
  objectRemove: vi.fn(),
  // Packet C4, item 3/4 — effect-layer mount/dispose spies, mirroring
  // `DiagramsWorkbench.3d.test.tsx`'s own `disposalSpies.effectLayerDispose`/
  // `addEffectLayer`-args idiom.
  addEffectLayer: vi.fn(),
  effectLayerDispose: vi.fn(),
}));
vi.mock("glyphcss", async (importOriginal) => {
  const actual = await importOriginal<typeof import("glyphcss")>();
  return {
    ...actual,
    createGlyphScene: (...args: Parameters<typeof actual.createGlyphScene>) => {
      sceneSpies.createGlyphSceneCalls += 1;
      sceneSpies.createGlyphSceneOptions(args[1]);
      const scene = actual.createGlyphScene(...args);
      const originalDestroy = scene.destroy.bind(scene);
      scene.destroy = () => { sceneSpies.sceneDestroy(); originalDestroy(); };
      const originalSetOptions = scene.setOptions.bind(scene);
      scene.setOptions = (opts) => { sceneSpies.setOptions(opts); return originalSetOptions(opts); };
      const originalAddObject = scene.addObject.bind(scene);
      scene.addObject = (...addArgs: Parameters<typeof scene.addObject>) => {
        sceneSpies.addObject();
        const handle = originalAddObject(...addArgs);
        const originalUpdate = handle.update.bind(handle);
        handle.update = (object) => { sceneSpies.objectUpdate(); return originalUpdate(object); };
        const originalRemove = handle.remove.bind(handle);
        handle.remove = () => { sceneSpies.objectRemove(); return originalRemove(); };
        return handle;
      };
      const originalAddEffectLayer = scene.addEffectLayer.bind(scene);
      scene.addEffectLayer = ((opts: unknown) => {
        sceneSpies.addEffectLayer(opts);
        const layer = originalAddEffectLayer(opts as never);
        const originalDispose = layer.dispose.bind(layer);
        layer.dispose = () => { sceneSpies.effectLayerDispose(); originalDispose(); };
        return layer;
      }) as typeof scene.addEffectLayer;
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
import { renderGlyphChart3d } from "@glyphcss/charts/3d";
import ChartsWorkbench from "./ChartsWorkbench";
import { CHART_CHARSETS, createChartsWorkbenchState, reduceChartsWorkbenchState, resolveCharts3dView, resolveGlyphChartsWorkbenchControls } from "./chartsWorkbenchState";
import { CHARTS_3D_DATASETS } from "./datasets/chart3d";
import { decodeChartsUrlState } from "./chartsUrlState";
import { glyphChart3dCharsetDegrades } from "@glyphcss/charts/3d";
import { renderCharts3dStatic } from "./chartsWorkbench3dRender";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChartsWorkbench — live 3D viewport lifecycle (packet C3, fix round 1 P2-3)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    sceneSpies.createGlyphSceneCalls = 0;
    sceneSpies.createGlyphSceneOptions.mockClear();
    sceneSpies.sceneDestroy.mockClear();
    sceneSpies.controlsDestroy.mockClear();
    sceneSpies.setOptions.mockClear();
    sceneSpies.objectUpdate.mockClear();
    sceneSpies.addObject.mockClear();
    sceneSpies.objectRemove.mockClear();
    sceneSpies.addEffectLayer.mockClear();
    sceneSpies.effectLayerDispose.mockClear();
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
  // Picks a DIFFERENT tray tile without ever leaving 3D mode — every
  // `CHARTS_3D_DATASETS` entry gets its own always-rendered tile
  // (`ChartsWorkbench.tsx`'s own preset-tray map), so this reaches the
  // reported crash directly: `chart3dResolvedLive.ok` stays `true`
  // throughout, so React keeps mounting the SAME `Charts3dViewport`
  // instance (no `key` differs), and the mark-rebuild effect is what has
  // to cope with the new mark, never a remount.
  function selectDataset(title: string): void {
    const tile = container.querySelector<HTMLButtonElement>(`[aria-label="View ${title} in 3D"]`)!;
    act(() => tile.click());
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

    // Charset (packet C4, codex review): `web`'s own default charset is
    // `braille` (`GLYPH_CHART_TARGET_DEFAULTS`), which `style: "auto"`
    // resolves to a real live WIREFRAME — switching to `ascii` is therefore
    // a genuine mode change (wireframe -> solid), applied via the object's
    // own `update()` (the grid/tick overlay's glyph tier is baked into the
    // mesh at build time) AND `scene.setOptions` (the scene's own `mode`),
    // never a remount.
    const objectUpdatesBeforeCharset = sceneSpies.objectUpdate.mock.calls.length;
    pickToggle("Charset", "ascii");
    expect(sceneSpies.createGlyphSceneCalls).toBe(1);
    expect(sceneSpies.objectUpdate.mock.calls.length).toBeGreaterThan(objectUpdatesBeforeCharset);
    expect(sceneSpies.setOptions).toHaveBeenCalledWith({ mode: "solid", charMode: undefined, hiddenLines: undefined, useColors: true });

    // Colour: `color: css` -> `color: none` flips `useColors` — applied via
    // `scene.setOptions`, never a remount. `mode`/`charMode`/`hiddenLines`
    // ride along in the SAME call (one bundle, `chartsWorkbench3dSceneOptions`'s
    // own doc) — still resolved from the CURRENT charset (`ascii`, from
    // above), so `solid`/`undefined`/`undefined`.
    pickToggle("Color", "none");
    expect(sceneSpies.createGlyphSceneCalls).toBe(1);
    expect(sceneSpies.setOptions).toHaveBeenCalledWith({ mode: "solid", charMode: undefined, hiddenLines: undefined, useColors: false });

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

    // Style (packet C4, codex review): explicitly picking "Wireframe" on
    // the CURRENT charset (`ascii`) mounts a real live wireframe — proving
    // this is reachable at all, which was the coordinator's own literal
    // finding ("ink is unreachable live").
    pickToggle("Style", "Wireframe");
    expect(sceneSpies.createGlyphSceneCalls).toBe(1);
    expect(sceneSpies.setOptions).toHaveBeenCalledWith({ mode: "wireframe", charMode: undefined, hiddenLines: "hide", useColors: false });
    pickToggle("Style", "Ink");
    expect(sceneSpies.createGlyphSceneCalls).toBe(1);
    expect(sceneSpies.setOptions).toHaveBeenCalledWith({ mode: "ink", charMode: undefined, hiddenLines: undefined, useColors: false });
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

  // Packet C4 — the guide toggles (plain `useToggle` checkbox rows) and the
  // Effects folder's dropdown rows (`useOption`, a real lil-gui `<select>`)
  // share the SAME `.controller` shape `ChartsWorkbench.test.tsx`'s own
  // `controller()` helper reads.
  function controller(name: string): Element {
    return Array.from(container.querySelectorAll(".controller")).find((node) => node.querySelector(".name")?.textContent?.toLowerCase() === name.toLowerCase())!;
  }
  function guideCheckbox(label: string): HTMLInputElement {
    return controller(label).querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  }
  function selectDropdown(name: string, optionText: string): void {
    const field = controller(name).querySelector("select")!;
    const index = Array.from(field.options).findIndex((o) => o.textContent === optionText);
    act(() => {
      field.selectedIndex = index;
      field.dispatchEvent(new Event("change", { bubbles: true }));
    });
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
    // Fix round 3 (this file, Item 5): `braille` was the premise this test
    // exercised through round 2, which downgraded it — round 2's OWN "axes
    // in one corner" work made braille a real depth-tested wireframe
    // instead (AGENTS.md's C2 doc, `glyphChart3dCharsetDegrades` now
    // returns `charset === "blocks"` only), so `braille` no longer degrades
    // and this test's own premise assertion below would fail on it.
    // `blocks` is the charset still unsupported for a 3D chart's
    // always-overlaid box/tick geometry (the halfblock/quadrant dual-colour
    // encoder self-disables under any `transformCells` hook) — the same
    // property this test needs, just the current charset that has it.
    state = reduceChartsWorkbenchState(state, { type: "set-control", control: { type: "charset", value: "blocks" } });
    expect(glyphChart3dCharsetDegrades("blocks")).toBe(true); // the premise this test exercises
    root = createRoot(container);
    act(() => root.render(<ChartsWorkbench initialState={state} />));
    const host = container.querySelector<HTMLElement>(".charts-3d-viewport-host")!;
    expect(host.querySelector(".glyph-output")).not.toBeNull(); // the scene mounted and rendered
    expect(container.querySelector(".charts-3d-viewport")!.children).toHaveLength(1);
    expect(container.querySelector(".charts-3d-downgrade-note")).toBeNull();
  });

  // ── Packet C4 (codex review addition) ───────────────────────────────────
  // The coordinator's own literal finding: `Charts3dViewport.tsx` hard-coded
  // `mode: "solid"` and never read charset/style at all, so a live braille
  // selection (the default `web` charset, `GLYPH_CHART_TARGET_DEFAULTS`)
  // rendered SOLID geometry while Copy/terminal resolved the same state to
  // a real wireframe. `enter3d()` mounts at exactly that default — no extra
  // clicks needed to reproduce the premise. Asserted TWO ways: the real
  // `createGlyphScene` call's own options (the exact bundle
  // `chartsWorkbench3dSceneOptions` computed), and the rendered picture
  // itself (real braille dot glyphs, U+2800-28FF, which only a genuine
  // wireframe+braille render emits — a solid Lambert-shaded fill of this
  // fixture never does).
  it("entering 3D on the default web target mounts a LIVE braille wireframe (mode/charMode/hiddenLines resolved, not hard-coded solid)", () => {
    const host = enter3d();
    expect(sceneSpies.createGlyphSceneOptions).toHaveBeenCalledTimes(1);
    const opts = sceneSpies.createGlyphSceneOptions.mock.calls[0]![0] as { mode?: string; charMode?: string; hiddenLines?: string };
    expect(opts.mode).toBe("wireframe");
    expect(opts.charMode).toBe("braille");
    expect(opts.hiddenLines).toBe("hide");
    expect(host.querySelector(".glyph-output")!.textContent).toMatch(/[⠀-⣿]/);
  });

  // ── Packet C4 ──────────────────────────────────────────────────────────

  // Item 1 — a guide toggle updates the EXISTING scene-object handle IN
  // PLACE (`handle.update()`), never remounting `createGlyphScene`, and
  // keeps the camera untouched (auto-fit target/zoom unchanged) — the exact
  // property C3 fix round 1 already proved for shading/colorscale/colour,
  // now extended to guides.
  // Mutation: drop `state.chart3d.guides` from `ChartsWorkbench.tsx`'s
  // `chart3dResolvedLive` memo deps → `mark` never changes on a guide edit,
  // so `objectUpdate` is never called and this reddens.
  it("a guides toggle updates the live scene object in place (update(), no second createGlyphScene), and the camera survives", async () => {
    enter3d();
    expect(sceneSpies.createGlyphSceneCalls).toBe(1);
    const before = container.querySelector("pre.glyph-output")!.textContent!;
    const cameraBefore = await copiedLinkChart3dCamera();
    const updatesBefore = sceneSpies.objectUpdate.mock.calls.length;

    // "Wall outline" (the `walls` field) defaults OFF — flipping it on
    // always adds real geometry to the mesh's own overlay, so the render
    // genuinely changes.
    act(() => guideCheckbox("Wall outline").click());

    expect(sceneSpies.createGlyphSceneCalls, "no remount on a guides edit").toBe(1);
    expect(sceneSpies.objectUpdate.mock.calls.length, "the scene-object handle's update() must run").toBeGreaterThan(updatesBefore);
    const after = container.querySelector("pre.glyph-output")!.textContent!;
    expect(after, "the live frame must actually reflect the toggled guide").not.toBe(before);
    const cameraAfter = await copiedLinkChart3dCamera();
    expect(cameraAfter.rotX).toBe(cameraBefore.rotX);
    expect(cameraAfter.rotY).toBe(cameraBefore.rotY);
    expect(cameraAfter.zoom).toBe(cameraBefore.zoom);
  });

  // Item 3 — the Effects folder's Target row resolves "Chart" (renamed
  // from "Surface" by packet C6, which widened the live viewport to every
  // 3D mark type — `ChartsDock.tsx`'s own `CHARTS_3D_EFFECT_TARGETS` doc)
  // to the real mounted data-mesh handle and "Whole chart" to scene-wide
  // (`undefined`), proving the WIRING (not just the rendered pixels, which
  // `charts3dEffectTargeting.test.ts` already proves coincide for THIS
  // object — guides carry no depth of their own).
  // Mutation: `Charts3dViewport.tsx`'s `resolveEffectTarget` always
  // returning `undefined` regardless of `targetId` → the "Chart" case's
  // own assertion (a defined target) reddens.
  it("selecting Effect target 'Chart' passes the real data-mesh handle to addEffectLayer; 'Whole chart' passes undefined", () => {
    enter3d();
    selectDropdown("Effect", "scan");
    expect(sceneSpies.addEffectLayer).toHaveBeenCalledTimes(1);
    const allTargetCall = sceneSpies.addEffectLayer.mock.calls.at(-1)![0] as { target: unknown };
    expect(allTargetCall.target, "the implicit 'Whole chart' target must be scene-wide (undefined)").toBeUndefined();

    selectDropdown("Target", "Chart");
    expect(sceneSpies.addEffectLayer.mock.calls.length).toBeGreaterThan(1);
    const surfaceTargetCall = sceneSpies.addEffectLayer.mock.calls.at(-1)![0] as { target?: { id: number } };
    expect(surfaceTargetCall.target, "the 'Chart' target must be a real mesh handle, not undefined/null").toBeDefined();
    expect(typeof surfaceTargetCall.target!.id).toBe("number");
  });

  // Coordinator addendum (packet C6) — the Axes folder's per-axis rows:
  // editing one updates the mounted scene-object handle IN PLACE
  // (`objectUpdate`, `GlyphSceneObjectHandle.update`) — never a scene
  // remount (`createGlyphSceneCalls` stays 1, the SAME P1-2 guarantee a
  // shading/colorscale/guides edit already gets) — and the change reaches
  // the static Copy ASCII exit too, proving the override actually flows
  // into the built mark rather than only existing in Dock state.
  function setTextInput(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    act(() => { setter.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  it("editing 'X title (3D)' updates the live object in place (no remount) and reaches Copy ASCII", async () => {
    enter3d();
    expect(sceneSpies.createGlyphSceneCalls).toBe(1);
    const before = await copiedAscii();
    sceneSpies.objectUpdate.mockClear();
    const titleInput = controller("X title (3D)").querySelector<HTMLInputElement>('input[type="text"]')!;
    setTextInput(titleInput, "Custom Longitude Title");
    expect(sceneSpies.objectUpdate, "the mesh handle must update in place").toHaveBeenCalled();
    expect(sceneSpies.createGlyphSceneCalls, "never a scene remount for an axis edit").toBe(1);
    const after = await copiedAscii();
    expect(after).not.toBe(before);
    expect(after).toContain("Custom Longitude Title");
  });
  it("the 2D Axes folder's own 'X title' row is hidden while a 3D type is active, and 'X title (3D)' is hidden in 2D", () => {
    // 2D first (before entering 3D).
    expect(controller("X title").querySelector("input")!.closest(".controller")!.classList.contains("disabled")).toBe(false);
    expect(getComputedStyle(controller("X title (3D)")).display).toBe("none");
    enter3d();
    expect(getComputedStyle(controller("X title (3D)")).display).not.toBe("none");
    expect(getComputedStyle(controller("X title")).display).toBe("none");
  });

  // Item 3/4 — dispose on: effect id change, view switch away from 3D, and
  // unmount. Mirrors `DiagramsWorkbench.3d.test.tsx`'s own three disposal
  // tests exactly.
  it("changing the effect disposes the old layer and cancels its rAF loop", () => {
    enter3d();
    selectDropdown("Effect", "scan");
    expect(sceneSpies.effectLayerDispose).not.toHaveBeenCalled();
    const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");
    // Mutation: `applyEffect()`'s "already correct" no-op guard mistakenly
    // matching a genuinely different effect id → `effectLayerDispose` stays
    // uncalled here.
    selectDropdown("Effect", "glitch");
    expect(sceneSpies.effectLayerDispose).toHaveBeenCalledTimes(1);
    expect(cancelSpy, "the old effect's own rAF loop must be cancelled").toHaveBeenCalled();
    cancelSpy.mockRestore();
  });

  it("disposes the mounted effect layer and its rAF loop on a mark-type switch away from 3D", () => {
    const host = enter3d();
    selectDropdown("Effect", "glitch");
    const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");
    expect(sceneSpies.effectLayerDispose).not.toHaveBeenCalled();
    act(() => container.querySelector<HTMLButtonElement>('.charts-mark-row[data-row="type"] [aria-label$=": line"]')!.click());
    // Mutation: drop `disposeEffect()` from `Charts3dViewport.tsx`'s
    // mount-effect cleanup → these two redden (the layer and its rAF loop
    // leak past the view switch).
    expect(sceneSpies.effectLayerDispose, "the mounted effect layer must be disposed too").toHaveBeenCalledTimes(1);
    expect(cancelSpy, "the effect's own rAF loop must be cancelled").toHaveBeenCalled();
    expect(host.isConnected).toBe(false);
    cancelSpy.mockRestore();
  });

  it("disposes the mounted effect layer and its rAF loop on unmount", () => {
    enter3d();
    selectDropdown("Effect", "glitch");
    const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");
    expect(sceneSpies.effectLayerDispose).not.toHaveBeenCalled();
    act(() => root.unmount());
    expect(sceneSpies.effectLayerDispose, "the mounted effect layer must be disposed too").toHaveBeenCalledTimes(1);
    expect(cancelSpy, "the effect's own rAF loop must be cancelled").toHaveBeenCalled();
    cancelSpy.mockRestore();
  });

  // Item 4 — Copy ASCII/ANSI must never reflect a mounted effect: both
  // exits build a FRESH `renderGlyphChart3d` call with no effect-layer
  // concept, so mounting/changing the live effect must not change what Copy
  // returns. Mutation: threading `state.effect3d` into `chart3dCopyAscii`'s
  // own memo deps or render call in `ChartsWorkbench.tsx` (there is nothing
  // for it to actually DO there, since `renderGlyphChart3d` has no effect
  // parameter — but a deps-array leak alone would still be a real defect
  // worth catching, e.g. an accidental extra render pass) would show up
  // here as `copiedAscii()` differing before/after the effect change, which
  // it must not.
  it("Copy ASCII stays byte-identical whether or not a live effect is mounted", async () => {
    enter3d();
    const before = await copiedAscii();
    selectDropdown("Effect", "glitch");
    selectDropdown("Target", "Chart");
    const after = await copiedAscii();
    expect(after).toBe(before);
  });

  // Item 2/4 — "Trackball Copy is exact": after a trackball drag, Copy
  // ASCII equals a static render built DIRECTLY off the raw library
  // (`renderGlyphChart3d`, never through `renderCharts3dStatic` — the same
  // function under test — so a regression in `chartsWorkbench3dRender.ts`'s
  // own camera-option construction can't hide behind testing itself).
  // Mutation: revert `chartsWorkbench3dRender.ts`'s `cameraOption` back to
  // `{ rotX, rotY, zoom }` only (dropping `mat`/`useMat`) → the live Copy
  // (built through the real orbited `mat`) diverges from `expected` (built
  // here from the SAME reported `mat`), reddening.
  it("trackball Copy is exact: Copy ASCII after a drag equals a static renderGlyphChart3d at that exact mat/zoom", async () => {
    const host = enter3d();
    pickToggle("Rotate", "Trackball");
    dragHost(host, 180, 140);
    const camera = await copiedLinkChart3dCamera();
    expect(camera.mat, "the premise this test exercises — a real trackball pose").toBeDefined();
    const copiedText = await copiedAscii();

    let state = createChartsWorkbenchState();
    state = reduceChartsWorkbenchState(state, { type: "select-3d-dataset", id: CHARTS_3D_DATASETS[0]!.id });
    const resolved = resolveCharts3dView(state.chart3d);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const controls = resolveGlyphChartsWorkbenchControls(state.controls);
    const expectedOut = renderGlyphChart3d(resolved.resolved.mark, {
      target: controls.target, charset: controls.charset, color: "none",
      width: controls.width, height: controls.height,
      camera: { mat: [...camera.mat!], useMat: true, zoom: camera.zoom },
    });
    expect(copiedText).toBe(expectedOut.text);
  }, 15_000);

  // ── Bug fix: switching between 3D preset TYPES no longer crashes ───────
  // `GlyphSceneObjectHandle.update()` refuses an id change by contract
  // (`createGlyphScene.ts`'s own `RangeError`), and each 3D mark type
  // builds its OWN object id (`object.ts`'s `id = options.id ?? mark.
  // type`) — so the mark-rebuild effect used to call `handle.update()`
  // unconditionally and crash with `Uncaught RangeError: ... cannot change
  // an object's id ("surface" -> "bars3d")` the moment a reader picked a
  // different-TYPE tray tile after a same-type one. Mutation: reverting
  // `Charts3dViewport.tsx`'s id-branch back to an unconditional
  // `handle.update(object)` reddens every test in this block (a real
  // uncaught `RangeError` inside a `useEffect`, re-thrown out of `act()`).

  it("switching between 3D presets of DIFFERENT mark types renders each without throwing, with createGlyphScene called exactly once", () => {
    enter3d(); // "Maunga Whau (volcano)" — surface
    expect(sceneSpies.createGlyphSceneCalls).toBe(1);
    const bars3d = CHARTS_3D_DATASETS.find((d) => d.markType === "bars3d")!;
    const parametric3d = CHARTS_3D_DATASETS.find((d) => d.markType === "parametric3d")!;

    expect(() => selectDataset(bars3d.title)).not.toThrow();
    expect(container.querySelector(".charts-3d-error")).toBeNull();
    expect(container.querySelector("pre.glyph-output")!.textContent).not.toBe("");
    expect(sceneSpies.createGlyphSceneCalls, "columns preset — no scene remount").toBe(1);

    expect(() => selectDataset(parametric3d.title)).not.toThrow();
    expect(container.querySelector(".charts-3d-error")).toBeNull();
    expect(container.querySelector("pre.glyph-output")!.textContent).not.toBe("");
    expect(sceneSpies.createGlyphSceneCalls, "sphere preset — still no scene remount").toBe(1);
  });

  it("switching between two presets of the SAME mark type still uses update() in place (never remove+addObject)", () => {
    enter3d(); // "Maunga Whau (volcano)" — surface
    expect(sceneSpies.createGlyphSceneCalls).toBe(1);
    const addObjectCallsAtMount = sceneSpies.addObject.mock.calls.length;
    const updatesBefore = sceneSpies.objectUpdate.mock.calls.length;
    const alps = CHARTS_3D_DATASETS.find((d) => d.markType === "surface" && d.id !== CHARTS_3D_DATASETS[0]!.id)!;

    selectDataset(alps.title);

    expect(sceneSpies.createGlyphSceneCalls, "no scene remount for a same-type swap").toBe(1);
    expect(sceneSpies.objectUpdate.mock.calls.length, "update() must run").toBeGreaterThan(updatesBefore);
    expect(sceneSpies.addObject.mock.calls.length, "no fresh addObject — the SAME object id stays mounted").toBe(addObjectCallsAtMount);
    expect(sceneSpies.objectRemove).not.toHaveBeenCalled();
  });

  it("a genuine type swap removes the old object and mounts a fresh one, never a scene remount", () => {
    enter3d(); // "Maunga Whau (volcano)" — surface
    expect(sceneSpies.createGlyphSceneCalls).toBe(1);
    const addObjectCallsAtMount = sceneSpies.addObject.mock.calls.length;
    const bars3d = CHARTS_3D_DATASETS.find((d) => d.markType === "bars3d")!;

    selectDataset(bars3d.title);

    expect(sceneSpies.createGlyphSceneCalls, "no scene remount for a type swap").toBe(1);
    expect(sceneSpies.objectRemove, "the old (surface) object must be removed").toHaveBeenCalledTimes(1);
    expect(sceneSpies.addObject.mock.calls.length, "a fresh object must be mounted on the SAME scene").toBe(addObjectCallsAtMount + 1);
  });

  it("a mounted effect still targets the right mesh after a type swap", () => {
    const bars3d = CHARTS_3D_DATASETS.find((d) => d.markType === "bars3d")!;
    enter3d(); // "Maunga Whau (volcano)" — surface
    selectDropdown("Effect", "scan");
    selectDropdown("Target", "Chart");
    const surfaceTargetCall = sceneSpies.addEffectLayer.mock.calls.at(-1)![0] as { target?: { id: number } };
    expect(surfaceTargetCall.target, "premise: the surface mesh is targeted before the swap").toBeDefined();
    const disposalsBeforeSwap = sceneSpies.effectLayerDispose.mock.calls.length;

    selectDataset(bars3d.title);

    // A genuine type swap disposes and remounts the effect layer against
    // the NEW mesh handle (`applyEffect`'s own doc: a currently-mounted
    // effect layer's mesh-set target is immutable after mount, so
    // retargeting the OLD layer at the fresh handle would throw).
    expect(sceneSpies.effectLayerDispose.mock.calls.length, "the layer targeting the old (surface) mesh must be disposed").toBeGreaterThan(disposalsBeforeSwap);
    const barsTargetCall = sceneSpies.addEffectLayer.mock.calls.at(-1)![0] as { target?: { id: number } };
    expect(barsTargetCall.target, "the effect must remount against the NEW (bars) mesh handle").toBeDefined();
    expect(typeof barsTargetCall.target!.id).toBe("number");
    expect(barsTargetCall.target!.id, "a genuinely different mesh, not the disposed surface one").not.toBe(surfaceTargetCall.target!.id);
  });

  it("Copy ASCII after a type swap matches the newly selected mark", async () => {
    enter3d(); // "Maunga Whau (volcano)" — surface
    const before = await copiedAscii();
    const bars3d = CHARTS_3D_DATASETS.find((d) => d.markType === "bars3d")!;

    selectDataset(bars3d.title);
    const after = await copiedAscii();
    expect(after).not.toBe(before);

    // `select-3d-dataset` resets `state.chart3d.camera` to auto-fit
    // (`chartsWorkbenchState.ts`'s own doc), so Copy ASCII — which always
    // reads a FRESH `renderCharts3dStatic({ view: state.chart3d, ... })`,
    // never the live viewport's own orbited camera — is reproducible from
    // a plain reducer-built state with no drag involved.
    let refState = createChartsWorkbenchState();
    refState = reduceChartsWorkbenchState(refState, { type: "select-3d-dataset", id: bars3d.id });
    const controls = resolveGlyphChartsWorkbenchControls(refState.controls);
    const expected = renderCharts3dStatic({
      view: refState.chart3d, target: controls.target, charset: controls.charset,
      color: "none", width: controls.width, height: controls.height,
    });
    expect(expected.ok).toBe(true);
    if (expected.ok) expect(after).toBe(expected.text);
  });
});
