// @vitest-environment happy-dom
/**
 * The View folder's Bearing row.
 *
 * The defect this exists to stop is the one just fixed for Tilt: a control
 * whose VALUE is written once and never re-read shows a number the camera
 * does not have, and the Ctrl+drag orient gesture moves both angles without
 * this page writing either. `readMapViewState` reporting the heading
 * (`mapsView.test.ts`) is only half of that — the row also has to be BOUND to
 * it, so pushing a new heading in re-renders the control, and typing one out
 * reaches the widget.
 *
 * `MapsWorkbench.tsx` cannot be mounted under this vitest config, so the
 * folder hook is driven directly against a real lil-gui root — the same split
 * every other test in this folder uses.
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
import { MAP_BEARING_SLIDER_RANGE } from "./mapsView";

let root: Root | null = null;
let container: HTMLElement | null = null;
let guiHost: HTMLElement | null = null;
let gui: GUI | null = null;
const noop = () => {};

/**
 * The lil-gui root is built OUTSIDE React and torn down after the unmount,
 * not from an effect inside it. A GUI destroyed by its own component's effect
 * cleanup takes its controllers' DOM with it before `useSlider`'s cleanup
 * runs, and lil-gui then throws `removeChild` on a node it has already
 * removed — an artefact of the harness, nothing the page does.
 */
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

/**
 * Two hosts, deliberately: `createRoot().render()` CLEARS the element it owns,
 * so a lil-gui root mounted into the same div is wiped on the first render.
 * The component under test renders nothing anyway — the DOM being asserted is
 * lil-gui's, in `guiHost`.
 */
function render(inputs: ViewFolderInputs): HTMLElement {
  container = document.createElement("div");
  guiHost = document.createElement("div");
  document.body.append(container, guiHost);
  gui = new GUI({ container: guiHost });
  root = createRoot(container);
  act(() => { root!.render(<Harness inputs={inputs} />); });
  return guiHost;
}

/** The lil-gui row whose name cell reads `label`. */
function row(host: HTMLElement, label: string): HTMLElement {
  for (const el of Array.from(host.querySelectorAll<HTMLElement>(".controller"))) {
    if (el.querySelector(".name")?.textContent === label) return el;
  }
  throw new Error(`no Dock row named ${label}`);
}

/** The row's editable value box. lil-gui's number rows are `type=text` off touch — see its own comment about `[type=number]` desktop quirks. */
function input(host: HTMLElement, label: string): HTMLInputElement {
  return row(host, label).querySelector<HTMLInputElement>(".widget input")!;
}

/** How full the row's slider bar is drawn, 0..1 — the one observable of the RANGE lil-gui puts in the DOM. */
function fill(host: HTMLElement, label: string): number {
  return parseFloat(row(host, label).querySelector<HTMLElement>(".fill")!.style.width) / 100;
}

afterEach(() => {
  // happy-dom names its `removeChild` failure plain `DOMException` rather
  // than `NotFoundError`, so `destroyController`'s own guard
  // (`Dock/primitives.tsx`) does not recognise the folder-before-controller
  // teardown it exists to absorb and it escapes the unmount. A harness
  // artefact — the node is gone either way — swallowed HERE rather than by
  // widening that guard, which is correct against a real DOM.
  try { act(() => { root?.unmount(); }); } catch { /* see above */ }
  root = null;
  gui?.destroy();
  gui = null;
  container?.remove();
  container = null;
  guiHost?.remove();
  guiHost = null;
});

describe("View folder — Bearing", () => {
  it("is a row of its own, immediately after Tilt", () => {
    const host = render(baseInputs());
    const names = Array.from(host.querySelectorAll<HTMLElement>(".controller .name")).map((n) => n.textContent);
    expect(names).toContain("Bearing °");
    expect(names.indexOf("Bearing °")).toBe(names.indexOf("Tilt °") + 1);
  });

  it("offers the FULL compass, and the same one at every scale", () => {
    // The slider bar's own fill is where lil-gui puts the range in the DOM,
    // so 90 degrees drawn a quarter of the way along IS `0..360`.
    const host = render(baseInputs({ bearing: 90 }));
    expect(fill(host, "Bearing °")).toBeCloseTo(90 / MAP_BEARING_SLIDER_RANGE.max, 6);
    expect(MAP_BEARING_SLIDER_RANGE).toEqual({ min: 0, max: 360, step: 1 });
    // ...and, unlike Tilt, it does NOT follow a live ceiling: a heading has
    // none, so nothing about the view may move this row's range.
    act(() => { root!.render(<Harness inputs={baseInputs({ bearing: 90, maxTilt: 21, span: 360 })} />); });
    expect(fill(guiHost!, "Bearing °")).toBeCloseTo(90 / MAP_BEARING_SLIDER_RANGE.max, 6);
  });

  it("is EDITABLE — typing a heading reaches the widget, like typing a tilt does", () => {
    const onBearing = vi.fn();
    const host = render(baseInputs({ onBearing }));
    const box = input(host, "Bearing °");
    act(() => {
      box.value = "215";
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onBearing).toHaveBeenCalledWith(215);
  });

  it("FOLLOWS the widget: a heading pushed in per sync re-renders the row", () => {
    // The stale-slider defect, stated directly. The gesture writes the
    // camera; the page re-reads it and pushes it here; this row has to move.
    const host = render(baseInputs());
    expect(input(host, "Bearing °").value).toBe("0");
    act(() => { root!.render(<Harness inputs={baseInputs({ bearing: 287 })} />); });
    expect(input(guiHost!, "Bearing °").value).toBe("287");
    // ...including straight across the north seam, where the handle jumps
    // from one end of the bar to the other and must not stick.
    act(() => { root!.render(<Harness inputs={baseInputs({ bearing: 1 })} />); });
    expect(input(guiHost!, "Bearing °").value).toBe("1");
    expect(fill(guiHost!, "Bearing °")).toBeCloseTo(1 / 360, 6);
  });

  it("says which way 0 faces, on the row itself", () => {
    const host = render(baseInputs());
    const title = row(host, "Bearing °").getAttribute("title") ?? "";
    expect(title).toMatch(/0°\s*=\s*north up/i);
    expect(title).toMatch(/90°\s*=\s*east up/i);
    expect(title).toMatch(/Ctrl\+drag/i);
  });
});
