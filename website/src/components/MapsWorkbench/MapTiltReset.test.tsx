// @vitest-environment happy-dom
/**
 * The on-map "Level" control: the one affordance that makes the pitch
 * gesture reversible without opening the Dock.
 *
 * `MapsWorkbench.tsx` cannot be mounted under this vitest config, so the
 * component is driven in isolation here — the same split `MapSearchBox
 * .test.tsx` and every other test in this folder uses.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { MapTiltReset } from "./MapTiltReset";
import { MAP_TILT_SHEET_HOME, mapTiltIsLevel, mapTiltResetValue } from "./mapsView";

let root: Root | null = null;
let container: HTMLElement | null = null;

function render(node: React.ReactNode): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(node); });
  return container;
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
});

function button(host: HTMLElement): HTMLButtonElement | null {
  return host.querySelector<HTMLButtonElement>("button.maps-tilt-reset");
}

describe("MapTiltReset", () => {
  it("renders nothing while the globe is level — no permanent chrome", () => {
    const host = render(<MapTiltReset tilt={0} isOrbitProjection onReset={() => {}} />);
    expect(button(host)).toBeNull();
    expect(host.textContent).toBe("");
  });

  it("appears the moment the camera is pitched, and shows the angle", () => {
    const host = render(<MapTiltReset tilt={37.4} isOrbitProjection onReset={() => {}} />);
    const el = button(host);
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("37°");
    expect(el!.getAttribute("aria-label")).toContain("37");
  });

  it("appears on the first pixel of a pitch gesture (half a degree)", () => {
    // `GLYPH_MAP_TILT_DRAG_DEG_PER_PX` is 0.5, so one pixel of Ctrl+drag has
    // to be enough to raise the control — otherwise the reader's first
    // stroke gives no feedback that anything is reversible.
    const host = render(<MapTiltReset tilt={0.5} isOrbitProjection onReset={() => {}} />);
    expect(button(host)).not.toBeNull();
  });

  it("appears for a NEGATIVE pitch too — an orbit tilt is signed", () => {
    const host = render(<MapTiltReset tilt={-18} isOrbitProjection onReset={() => {}} />);
    expect(button(host)!.textContent).toContain("-18°");
  });

  it("names the gesture in its tooltip, for the reader who found it by accident", () => {
    const host = render(<MapTiltReset tilt={20} isOrbitProjection onReset={() => {}} />);
    const title = button(host)!.getAttribute("title") ?? "";
    expect(title).toMatch(/Ctrl\+drag/i);
    expect(title).toMatch(/right-drag/i);
  });

  it("clicking it asks for a reset exactly once", () => {
    const onReset = vi.fn();
    const host = render(<MapTiltReset tilt={40} isOrbitProjection onReset={onReset} />);
    act(() => { button(host)!.click(); });
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("a SHEET is level at its own home pitch, not at zero", () => {
    const level = render(<MapTiltReset tilt={MAP_TILT_SHEET_HOME} isOrbitProjection={false} onReset={() => {}} />);
    expect(button(level)).toBeNull();
    act(() => { root!.render(<MapTiltReset tilt={70} isOrbitProjection={false} onReset={() => {}} />); });
    expect(button(container!)).not.toBeNull();
    // ...and a sheet at 0 is a plan view, which is a pitch change like any
    // other, not the neutral pose.
    act(() => { root!.render(<MapTiltReset tilt={0} isOrbitProjection={false} onReset={() => {}} />); });
    expect(button(container!)).not.toBeNull();
  });
});

describe("mapTiltResetValue / mapTiltIsLevel", () => {
  it("an orbit projection goes home to head-on, a sheet to the page's own starting pitch", () => {
    expect(mapTiltResetValue(true)).toBe(0);
    expect(mapTiltResetValue(false)).toBe(MAP_TILT_SHEET_HOME);
  });

  it("level is a neighbourhood, not an equality — a float round-trip must not flicker the control", () => {
    expect(mapTiltIsLevel(1e-13, true)).toBe(true);
    expect(mapTiltIsLevel(0.5, true)).toBe(false);
    expect(mapTiltIsLevel(MAP_TILT_SHEET_HOME + 1e-13, false)).toBe(true);
  });
});
