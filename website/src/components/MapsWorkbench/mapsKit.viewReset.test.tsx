// @vitest-environment happy-dom
/**
 * The View folder's two reset rows.
 *
 * The reader asked for them by name ("can we add some 'reset' buttons on the
 * VIEW section ... maybe we could have a reset for the tilt and bearing"),
 * and the thing that makes them worth a test file is that "reset" does NOT
 * mean "zero" for one of them: an ORBIT projection's `tilt` is a signed
 * offset on top of `cameraForCenter`, so its home is 0, while a SHEET's
 * `tilt` IS `camera.rotX` and its home is the pitch the page opens at
 * (`MAP_TILT_SHEET_HOME`, 40). A button that wrote 0 to both would flatten
 * a sheet into a plan view and call it a reset — which is worse than no
 * button, because the reader cannot get back without knowing the number.
 *
 * The second property held here is that the resets go through the folder's
 * OWN `onTilt`/`onBearing` — the same callbacks the sliders drive, which are
 * what `MapsWorkbench` wires to `map.setTilt`/`map.setBearing`. Writing the
 * page's state directly would skip the widget's tilt clamp, the bearing
 * normalization, the motion loop and the URL write in one go.
 *
 * `MapsWorkbench.tsx` cannot be mounted under this vitest config, so the
 * folder hook is driven directly against a real lil-gui root — the same split
 * `mapsKit.viewFolder.test.tsx` uses, harness and all.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import GUI from "lil-gui";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Same import-time canvas stub `LayersPanel.dockRows.test.tsx` documents.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import { useViewFolder, type ViewFolderInputs } from "./mapsKit";
import { MAP_BEARING_HOME, MAP_TILT_SHEET_HOME } from "./mapsView";

let root: Root | null = null;
let container: HTMLElement | null = null;
let guiHost: HTMLElement | null = null;
let gui: GUI | null = null;
const noop = () => {};

function Harness({ inputs }: { inputs: ViewFolderInputs }) {
  useViewFolder(gui, inputs);
  return null;
}

function baseInputs(over: Partial<ViewFolderInputs> = {}): ViewFolderInputs {
  return {
    centerLon: 0, centerLat: 0, span: 40, maxSpan: 360,
    tilt: 0, maxTilt: 85, bearing: 0,
    isOrbitProjection: true, lod: 3, degPerCell: 0.25,
    onCenter: noop, onSpan: noop, onTilt: noop, onBearing: noop,
    ...over,
  };
}

/** See `mapsKit.viewFolder.test.tsx` for why the lil-gui root lives outside React and in its own host. */
function render(inputs: ViewFolderInputs): HTMLElement {
  container = document.createElement("div");
  guiHost = document.createElement("div");
  document.body.append(container, guiHost);
  gui = new GUI({ container: guiHost });
  root = createRoot(container);
  act(() => { root!.render(<Harness inputs={inputs} />); });
  return guiHost;
}

function rerender(inputs: ViewFolderInputs): HTMLElement {
  act(() => { root!.render(<Harness inputs={inputs} />); });
  return guiHost!;
}

function names(host: HTMLElement): (string | null)[] {
  return Array.from(host.querySelectorAll<HTMLElement>(".controller .name")).map((n) => n.textContent);
}

/** The lil-gui row whose name cell reads `label`. */
function row(host: HTMLElement, label: string): HTMLElement {
  for (const el of Array.from(host.querySelectorAll<HTMLElement>(".controller"))) {
    if (el.querySelector(".name")?.textContent === label) return el;
  }
  throw new Error(`no Dock row named ${label}`);
}

/** A button row IS its own `<button>` in lil-gui — the name cell lives inside it. */
function button(host: HTMLElement, label: string): HTMLButtonElement {
  return row(host, label).querySelector<HTMLButtonElement>(".widget button")!;
}

/** The row's editable value box, for the slider rows. */
function input(host: HTMLElement, label: string): HTMLInputElement {
  return row(host, label).querySelector<HTMLInputElement>(".widget input")!;
}

function click(el: HTMLElement): void {
  act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

afterEach(() => {
  // happy-dom teardown artefact — see `mapsKit.viewFolder.test.tsx`.
  try { act(() => { root?.unmount(); }); } catch { /* see above */ }
  root = null;
  gui?.destroy();
  gui = null;
  container?.remove();
  container = null;
  guiHost?.remove();
  guiHost = null;
});

describe("View folder — reset rows", () => {
  it("gives Tilt and Bearing one reset row each, without splitting the pair", () => {
    const host = render(baseInputs({ tilt: 30, bearing: 90 }));
    const n = names(host);
    expect(n).toContain("Reset tilt");
    expect(n).toContain("Reset bearing");
    // The two sliders stay adjacent: they are the two halves of ONE gesture,
    // so nothing may be inserted between them (`useViewFolder`'s own doc).
    expect(n.indexOf("Bearing °")).toBe(n.indexOf("Tilt °") + 1);
    // The resets follow the pair in the same order as the sliders, and LOD
    // still closes the folder.
    expect(n.indexOf("Reset tilt")).toBe(n.indexOf("Bearing °") + 1);
    expect(n.indexOf("Reset bearing")).toBe(n.indexOf("Reset tilt") + 1);
    expect(n[n.length - 1]).toBe("LOD");
  });

  it("resets an ORBIT tilt to 0 — head-on, the canonical globe", () => {
    const onTilt = vi.fn();
    const host = render(baseInputs({ isOrbitProjection: true, tilt: 37, onTilt }));
    click(button(host, "Reset tilt"));
    expect(onTilt).toHaveBeenCalledWith(0);
  });

  it("resets a SHEET tilt to the pitch the page opens at, NOT to 0", () => {
    // The load-bearing one. A sheet's `tilt` IS `camera.rotX`, so 0 is a plan
    // view looking straight down — a different map from the isometric one
    // this page ships. Home is `MAP_TILT_SHEET_HOME`.
    const onTilt = vi.fn();
    const host = render(baseInputs({ isOrbitProjection: false, tilt: 12, onTilt }));
    click(button(host, "Reset tilt"));
    expect(onTilt).toHaveBeenCalledWith(MAP_TILT_SHEET_HOME);
    expect(onTilt).not.toHaveBeenCalledWith(0);
    expect(MAP_TILT_SHEET_HOME).toBe(40);
  });

  it("reads the projection family LIVE — the map can be reshaped with the Dock open", () => {
    const onTilt = vi.fn();
    render(baseInputs({ isOrbitProjection: true, tilt: 12, onTilt }));
    const host = rerender(baseInputs({ isOrbitProjection: false, tilt: 12, onTilt }));
    click(button(host, "Reset tilt"));
    expect(onTilt).toHaveBeenCalledWith(MAP_TILT_SHEET_HOME);
  });

  it("resets the bearing to north, on either projection family", () => {
    for (const isOrbitProjection of [true, false]) {
      const onBearing = vi.fn();
      const host = render(baseInputs({ isOrbitProjection, bearing: 215, onBearing }));
      click(button(host, "Reset bearing"));
      expect(onBearing).toHaveBeenCalledWith(MAP_BEARING_HOME);
      expect(MAP_BEARING_HOME).toBe(0);
      // Torn down here rather than in afterEach so the second pass gets a
      // fresh root; afterEach still runs harmlessly on the last one.
      try { act(() => { root!.unmount(); }); } catch { /* see afterEach */ }
      gui!.destroy();
      container!.remove();
      guiHost!.remove();
    }
  });

  it("goes through the SAME callback the slider does, so the widget's clamp and normalization still apply", () => {
    // `MapsWorkbench` wires these two props to `map.setTilt`/`map.setBearing`;
    // a reset that wrote page state directly would skip the tilt ceiling, the
    // `[0, 360)` normalization, the motion loop and the URL write at once.
    const onTilt = vi.fn();
    const onBearing = vi.fn();
    const host = render(baseInputs({ isOrbitProjection: true, tilt: 37, bearing: 215, onTilt, onBearing }));
    const tiltBox = input(host, "Tilt °");
    act(() => {
      tiltBox.value = "12";
      tiltBox.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onTilt).toHaveBeenLastCalledWith(12);
    click(button(host, "Reset tilt"));
    expect(onTilt).toHaveBeenLastCalledWith(0);
    expect(onTilt).toHaveBeenCalledTimes(2);

    const bearingBox = input(host, "Bearing °");
    act(() => {
      bearingBox.value = "300";
      bearingBox.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onBearing).toHaveBeenLastCalledWith(300);
    click(button(host, "Reset bearing"));
    expect(onBearing).toHaveBeenLastCalledWith(0);
    expect(onBearing).toHaveBeenCalledTimes(2);
  });
});

describe("View folder — a reset with nothing to do is inert", () => {
  it("disables the tilt reset at an ORBIT home, and arms it off home", () => {
    const onTilt = vi.fn();
    const host = render(baseInputs({ isOrbitProjection: true, tilt: 0, onTilt }));
    expect(button(host, "Reset tilt").disabled).toBe(true);
    expect(row(host, "Reset tilt").classList.contains("disabled")).toBe(true);
    click(button(host, "Reset tilt"));
    expect(onTilt).not.toHaveBeenCalled();
    rerender(baseInputs({ isOrbitProjection: true, tilt: 18, onTilt }));
    expect(button(guiHost!, "Reset tilt").disabled).toBe(false);
    click(button(guiHost!, "Reset tilt"));
    expect(onTilt).toHaveBeenCalledWith(0);
  });

  it("disables the tilt reset at a SHEET home — which is 40, and is ARMED at 0", () => {
    // The same discriminator as the value test, read off the enabled state:
    // if home were 0 for both families these two expectations would swap.
    const host = render(baseInputs({ isOrbitProjection: false, tilt: MAP_TILT_SHEET_HOME }));
    expect(button(host, "Reset tilt").disabled).toBe(true);
    rerender(baseInputs({ isOrbitProjection: false, tilt: 0 }));
    expect(button(guiHost!, "Reset tilt").disabled).toBe(false);
  });

  it("disables the bearing reset at north, including a hair either side of it", () => {
    const onBearing = vi.fn();
    const host = render(baseInputs({ bearing: 0, onBearing }));
    expect(button(host, "Reset bearing").disabled).toBe(true);
    click(button(host, "Reset bearing"));
    expect(onBearing).not.toHaveBeenCalled();
    // 359.9 is a hair anticlockwise of north, not 359.9 degrees from it.
    rerender(baseInputs({ bearing: 359.9, onBearing }));
    expect(button(guiHost!, "Reset bearing").disabled).toBe(true);
    rerender(baseInputs({ bearing: 12, onBearing }));
    expect(button(guiHost!, "Reset bearing").disabled).toBe(false);
  });

  it("keeps the two resets independent: a turned, level map arms only the bearing", () => {
    const host = render(baseInputs({ isOrbitProjection: true, tilt: 0, bearing: 137 }));
    expect(button(host, "Reset tilt").disabled).toBe(true);
    expect(button(host, "Reset bearing").disabled).toBe(false);
    rerender(baseInputs({ isOrbitProjection: true, tilt: 44, bearing: 0 }));
    expect(button(guiHost!, "Reset tilt").disabled).toBe(false);
    expect(button(guiHost!, "Reset bearing").disabled).toBe(true);
  });
});
