// @vitest-environment happy-dom
/**
 * The View folder's two inline `[reset]` controls.
 *
 * The reader asked for them by name ("can we add some 'reset' buttons on the
 * VIEW section ... maybe we could have a reset for the tilt and bearing"),
 * and then rejected the first shape outright — two full-width lil-gui button
 * rows: "NO, THE RESET BUTTONS HAVE TO BE NEXT TO THE TILT ° AND BEARING °
 * LABELS WE CANNOT ADD THOSE HUGE BUTTONS ... tiny reset button ... [reset]".
 * So each one now lives INSIDE its own row's name cell, beside the label, and
 * the View folder has exactly the rows it had before they existed.
 *
 * The name cell is where the room is, and it is also the only place this can
 * go for free: a number row is `.name` at 45% plus a widget that ends in a
 * 45..70px value box, so an affordance in the WIDGET would come out of the
 * slider TRACK — the part of the row a reader drags. Two clauses below pin
 * that (the button's own cell, and the widget left byte-for-byte identical to
 * an untouched slider row's).
 *
 * The thing that makes the BEHAVIOUR worth a file of its own is that "reset"
 * does NOT mean "zero" for one of them: an ORBIT projection's `tilt` is a
 * signed offset on top of `cameraForCenter`, so its home is 0, while a
 * SHEET's `tilt` IS `camera.rotX` and its home is the pitch the page opens at
 * (`MAP_TILT_SHEET_HOME`, 40). A control that wrote 0 to both would flatten a
 * sheet into a plan view and call it a reset — worse than no control, because
 * the reader cannot get back without knowing the number.
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
import { readFileSync } from "node:fs";
import path from "node:path";
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

/** A row's own label: the name cell's leading text node, which it now shares with the `[reset]` button. */
function nameOf(controller: Element): string | null {
  return controller.querySelector(".name")?.firstChild?.textContent ?? null;
}

function names(host: HTMLElement): (string | null)[] {
  return Array.from(host.querySelectorAll<HTMLElement>(".controller")).map(nameOf);
}

/** The lil-gui row whose name cell reads `label`. */
function row(host: HTMLElement, label: string): HTMLElement {
  for (const el of Array.from(host.querySelectorAll<HTMLElement>(".controller"))) {
    if (nameOf(el) === label) return el;
  }
  throw new Error(`no Dock row named ${label}`);
}

/** The `[reset]` sitting in the NAME cell of the row labelled `label`. */
function reset(host: HTMLElement, label: string): HTMLButtonElement {
  const el = row(host, label).querySelector<HTMLButtonElement>(".name button.maps-view-reset");
  if (!el) throw new Error(`no inline reset on the ${label} row`);
  return el;
}

/** The row's editable value box. */
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

describe("View folder — where the reset lives", () => {
  it("puts a tiny `[reset]` in the Tilt and Bearing rows' own NAME cells", () => {
    const host = render(baseInputs({ tilt: 30, bearing: 90 }));
    for (const label of ["Tilt °", "Bearing °"]) {
      const button = reset(host, label);
      expect(button.textContent).toBe("[reset]");
      // In the NAME cell, and provably not in the widget: an affordance in
      // the widget comes out of the slider track.
      expect(button.closest(".name")).not.toBeNull();
      expect(button.closest(".widget")).toBeNull();
      expect(row(host, label).querySelector(".widget button")).toBeNull();
    }
  });

  it("adds NO rows of its own, and does not split the Tilt/Bearing pair", () => {
    const host = render(baseInputs({ tilt: 30, bearing: 90 }));
    const n = names(host);
    // The two sliders stay adjacent: they are the two halves of ONE gesture,
    // so nothing may be inserted between them (`useViewFolder`'s own doc).
    expect(n.indexOf("Bearing °")).toBe(n.indexOf("Tilt °") + 1);
    // The rejected shape was two extra rows. There are none — the folder is
    // Center lon / Center lat / Span / Tilt / Bearing / LOD, as before.
    expect(n).toEqual(["Center lon", "Center lat", "Span °", "Tilt °", "Bearing °", "LOD"]);
    expect(host.querySelectorAll(".maps-view-reset").length).toBe(2);
  });

  it("leaves the slider WIDGET — and so the track — exactly as an untouched row's", () => {
    // No layout engine here (happy-dom), so the width is held structurally
    // plus in the stylesheet clause below: the widget subtree of a row that
    // carries a reset is identical to that of `Span °`, which carries none.
    const host = render(baseInputs({ tilt: 30, bearing: 90 }));
    const shape = (label: string) => {
      const widget = row(host, label).querySelector<HTMLElement>(".widget")!;
      return Array.from(widget.children).map((c) => `${c.tagName}.${c.className}`);
    };
    const untouched = shape("Span °");
    expect(untouched.length).toBeGreaterThan(0);
    expect(shape("Tilt °")).toEqual(untouched);
    expect(shape("Bearing °")).toEqual(untouched);
    // The reset does not sit on the row itself either — it would then be a
    // flex sibling of the widget and take width from it.
    for (const label of ["Tilt °", "Bearing °"]) {
      const children = Array.from(row(host, label).children).map((c) => c.className);
      expect(children).toEqual(["name maps-view-name", "widget"]);
    }
  });

  it("cannot steal track width: the name cell is capped at the width it already had", () => {
    // lil-gui gives `.controller > .name` a `min-width: var(--name-width)`
    // and NO max, so a name cell whose content overflowed 45% would push the
    // widget — and the slider track inside it — narrower. `.maps-view-name`
    // caps it at that same `--name-width`, which is what makes "the track is
    // unchanged" a property of the stylesheet rather than of how long the
    // labels happen to be. Nothing in the block may size the widget side.
    const css = readFileSync(path.resolve(__dirname, "maps-workbench.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const nameRule = /\.controller\s*>\s*\.name\.maps-view-name\s*\{([^}]*)\}/.exec(css);
    expect(nameRule).not.toBeNull();
    expect(nameRule![1]).toMatch(/max-width:\s*var\(--name-width\)/);
    for (const [selector, body] of Array.from(css.matchAll(/([^{}]*maps-view-(?:reset|name)[^{}]*)\{([^}]*)\}/g))) {
      expect(selector, selector).not.toMatch(/\.widget|\.slider|input/);
      expect(body, selector).not.toMatch(/--name-width:|--slider-input/);
    }
  });
});

describe("View folder — what the reset writes", () => {
  it("resets an ORBIT tilt to 0 — head-on, the canonical globe", () => {
    const onTilt = vi.fn();
    const host = render(baseInputs({ isOrbitProjection: true, tilt: 37, onTilt }));
    click(reset(host, "Tilt °"));
    expect(onTilt).toHaveBeenCalledWith(0);
  });

  it("resets a SHEET tilt to the pitch the page opens at, NOT to 0", () => {
    // The load-bearing one. A sheet's `tilt` IS `camera.rotX`, so 0 is a plan
    // view looking straight down — a different map from the isometric one
    // this page ships. Home is `MAP_TILT_SHEET_HOME`.
    const onTilt = vi.fn();
    const host = render(baseInputs({ isOrbitProjection: false, tilt: 12, onTilt }));
    click(reset(host, "Tilt °"));
    expect(onTilt).toHaveBeenCalledWith(MAP_TILT_SHEET_HOME);
    expect(onTilt).not.toHaveBeenCalledWith(0);
    expect(MAP_TILT_SHEET_HOME).toBe(40);
  });

  it("reads the projection family LIVE — the map can be reshaped with the Dock open", () => {
    const onTilt = vi.fn();
    render(baseInputs({ isOrbitProjection: true, tilt: 12, onTilt }));
    const host = rerender(baseInputs({ isOrbitProjection: false, tilt: 12, onTilt }));
    click(reset(host, "Tilt °"));
    expect(onTilt).toHaveBeenCalledWith(MAP_TILT_SHEET_HOME);
  });

  it("resets the bearing to north, on either projection family", () => {
    for (const isOrbitProjection of [true, false]) {
      const onBearing = vi.fn();
      const host = render(baseInputs({ isOrbitProjection, bearing: 215, onBearing }));
      click(reset(host, "Bearing °"));
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
    click(reset(host, "Tilt °"));
    expect(onTilt).toHaveBeenLastCalledWith(0);
    expect(onTilt).toHaveBeenCalledTimes(2);

    const bearingBox = input(host, "Bearing °");
    act(() => {
      bearingBox.value = "300";
      bearingBox.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onBearing).toHaveBeenLastCalledWith(300);
    click(reset(host, "Bearing °"));
    expect(onBearing).toHaveBeenLastCalledWith(0);
    expect(onBearing).toHaveBeenCalledTimes(2);
  });
});

describe("View folder — a reset with nothing to do is inert", () => {
  it("disables the tilt reset at an ORBIT home, and arms it off home", () => {
    const onTilt = vi.fn();
    const host = render(baseInputs({ isOrbitProjection: true, tilt: 0, onTilt }));
    expect(reset(host, "Tilt °").disabled).toBe(true);
    click(reset(host, "Tilt °"));
    expect(onTilt).not.toHaveBeenCalled();
    rerender(baseInputs({ isOrbitProjection: true, tilt: 18, onTilt }));
    expect(reset(guiHost!, "Tilt °").disabled).toBe(false);
    click(reset(guiHost!, "Tilt °"));
    expect(onTilt).toHaveBeenCalledWith(0);
  });

  it("never disables the ROW: the slider beside it stays live at home", () => {
    // The rejected button-row shape could dim the whole controller, because
    // the controller WAS the button. Here the row is the slider's, and
    // lil-gui's `.controller.disabled` sets `pointer-events: none` on every
    // descendant — it would take the slider down with the reset.
    const host = render(baseInputs({ isOrbitProjection: true, tilt: 0, bearing: 0 }));
    for (const label of ["Tilt °", "Bearing °"]) {
      expect(reset(host, label).disabled).toBe(true);
      expect(row(host, label).classList.contains("disabled")).toBe(false);
      expect(input(host, label).disabled).toBe(false);
    }
  });

  it("disables the tilt reset at a SHEET home — which is 40, and is ARMED at 0", () => {
    // The same discriminator as the value test, read off the enabled state:
    // if home were 0 for both families these two expectations would swap.
    const host = render(baseInputs({ isOrbitProjection: false, tilt: MAP_TILT_SHEET_HOME }));
    expect(reset(host, "Tilt °").disabled).toBe(true);
    rerender(baseInputs({ isOrbitProjection: false, tilt: 0 }));
    expect(reset(guiHost!, "Tilt °").disabled).toBe(false);
  });

  it("disables the bearing reset at north, including a hair either side of it", () => {
    const onBearing = vi.fn();
    const host = render(baseInputs({ bearing: 0, onBearing }));
    expect(reset(host, "Bearing °").disabled).toBe(true);
    click(reset(host, "Bearing °"));
    expect(onBearing).not.toHaveBeenCalled();
    // 359.9 is a hair anticlockwise of north, not 359.9 degrees from it.
    rerender(baseInputs({ bearing: 359.9, onBearing }));
    expect(reset(guiHost!, "Bearing °").disabled).toBe(true);
    rerender(baseInputs({ bearing: 12, onBearing }));
    expect(reset(guiHost!, "Bearing °").disabled).toBe(false);
  });

  it("keeps the two resets independent: a turned, level map arms only the bearing", () => {
    const host = render(baseInputs({ isOrbitProjection: true, tilt: 0, bearing: 137 }));
    expect(reset(host, "Tilt °").disabled).toBe(true);
    expect(reset(host, "Bearing °").disabled).toBe(false);
    rerender(baseInputs({ isOrbitProjection: true, tilt: 44, bearing: 0 }));
    expect(reset(guiHost!, "Tilt °").disabled).toBe(false);
    expect(reset(guiHost!, "Bearing °").disabled).toBe(true);
  });
});
