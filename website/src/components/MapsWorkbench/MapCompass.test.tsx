// @vitest-environment happy-dom
/**
 * The on-map COMPASS: the one affordance that makes the orient gesture
 * reversible without opening the Dock. It reports whichever of pitch and
 * heading is off home, and one click puts both back.
 *
 * `MapsWorkbench.tsx` cannot be mounted under this vitest config, so the
 * component is driven in isolation here — the same split `MapSearchBox
 * .test.tsx` and every other test in this folder uses.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { MapCompass, mapCompassPoint } from "./MapCompass";
import { MAP_BEARING_RESET_EPSILON, MAP_TILT_SHEET_HOME, mapBearingIsNorth, mapOrientIsHome, mapTiltIsLevel, mapTiltResetValue } from "./mapsView";

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
  return host.querySelector<HTMLButtonElement>("button.maps-compass");
}

describe("MapCompass", () => {
  it("renders nothing while the globe is level — no permanent chrome", () => {
    const host = render(<MapCompass bearing={0} tilt={0} isOrbitProjection onReset={() => {}} />);
    expect(button(host)).toBeNull();
    expect(host.textContent).toBe("");
  });

  it("appears the moment the camera is pitched, and shows the angle", () => {
    const host = render(<MapCompass bearing={0} tilt={37.4} isOrbitProjection onReset={() => {}} />);
    const el = button(host);
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("37°");
    expect(el!.getAttribute("aria-label")).toContain("37");
  });

  it("appears on the first pixel of a pitch gesture (half a degree)", () => {
    // `GLYPH_MAP_TILT_DRAG_DEG_PER_PX` is 0.5, so one pixel of Ctrl+drag has
    // to be enough to raise the control — otherwise the reader's first
    // stroke gives no feedback that anything is reversible.
    const host = render(<MapCompass bearing={0} tilt={0.5} isOrbitProjection onReset={() => {}} />);
    expect(button(host)).not.toBeNull();
  });

  it("appears for a NEGATIVE pitch too — an orbit tilt is signed", () => {
    const host = render(<MapCompass bearing={0} tilt={-18} isOrbitProjection onReset={() => {}} />);
    expect(button(host)!.textContent).toContain("-18°");
  });

  it("names the gesture in its tooltip, for the reader who found it by accident", () => {
    const host = render(<MapCompass bearing={0} tilt={20} isOrbitProjection onReset={() => {}} />);
    const title = button(host)!.getAttribute("title") ?? "";
    expect(title).toMatch(/Ctrl\+drag/i);
    expect(title).toMatch(/right-drag/i);
  });

  it("clicking it asks for a reset exactly once", () => {
    const onReset = vi.fn();
    const host = render(<MapCompass bearing={0} tilt={40} isOrbitProjection onReset={onReset} />);
    act(() => { button(host)!.click(); });
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("a SHEET is level at its own home pitch, not at zero", () => {
    const level = render(<MapCompass bearing={0} tilt={MAP_TILT_SHEET_HOME} isOrbitProjection={false} onReset={() => {}} />);
    expect(button(level)).toBeNull();
    act(() => { root!.render(<MapCompass bearing={0} tilt={70} isOrbitProjection={false} onReset={() => {}} />); });
    expect(button(container!)).not.toBeNull();
    // ...and a sheet at 0 is a plan view, which is a pitch change like any
    // other, not the neutral pose.
    act(() => { root!.render(<MapCompass bearing={0} tilt={0} isOrbitProjection={false} onReset={() => {}} />); });
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

describe("MapCompass — the heading half", () => {
  it("appears for a TURN alone, with the map still perfectly level", () => {
    const host = render(<MapCompass bearing={73} tilt={0} isOrbitProjection onReset={() => {}} />);
    const el = button(host);
    expect(el).not.toBeNull();
    expect(el!.textContent).toContain("73°");
    // ...and says nothing about a pitch that is not there.
    expect(el!.textContent).not.toContain("0°");
    expect(el!.getAttribute("aria-label")).toContain("heading is 73 degrees");
    expect(el!.getAttribute("aria-label")).not.toContain("pitch");
  });

  it("appears on the first pixel of a TURN (0.8 of a degree)", () => {
    // `GLYPH_MAP_BEARING_DRAG_DEG_PER_PX` is 0.8, so one pixel of Ctrl+drag
    // has to raise the control — the same first-pixel feedback the pitch half
    // gets.
    expect(MAP_BEARING_RESET_EPSILON).toBeLessThan(0.8);
    expect(button(render(<MapCompass bearing={0.8} tilt={0} isOrbitProjection onReset={() => {}} />))).not.toBeNull();
  });

  it("a turn a hair ANTICLOCKWISE of north is still a turn, not 359 degrees of one", () => {
    const host = render(<MapCompass bearing={359.9} tilt={0} isOrbitProjection onReset={() => {}} />);
    // Within the epsilon the short way round, so this IS north and the
    // control stays away.
    expect(button(host)).toBeNull();
    act(() => { root!.render(<MapCompass bearing={358} tilt={0} isOrbitProjection onReset={() => {}} />); });
    expect(button(container!)!.textContent).toContain("358°");
  });

  it("shows BOTH angles when the reader did both in one stroke", () => {
    const host = render(<MapCompass bearing={120} tilt={35} isOrbitProjection onReset={() => {}} />);
    const el = button(host)!;
    expect(el.textContent).toContain("120°");
    expect(el.textContent).toContain("35°");
    expect(el.getAttribute("aria-label")).toContain("heading is 120 degrees and pitch is 35 degrees");
  });

  it("names BOTH axes of the gesture in its tooltip", () => {
    const title = button(render(<MapCompass bearing={45} tilt={0} isOrbitProjection onReset={() => {}} />))!.getAttribute("title") ?? "";
    expect(title).toMatch(/Ctrl\+drag/i);
    expect(title).toMatch(/right-drag/i);
    expect(title).toMatch(/sideways/i);
    expect(title).toMatch(/pitch/i);
    expect(title).toMatch(/north/i);
  });

  it("the needle turns with the map, so the control reads as an instrument", () => {
    const host = render(<MapCompass bearing={90} tilt={0} isOrbitProjection onReset={() => {}} />);
    const svg = host.querySelector("svg")!;
    expect(svg.getAttribute("style") ?? "").toContain("rotate(-90deg)");
  });

  it("one click resets BOTH — a compass squares the map up, it does not half-do it", () => {
    const onReset = vi.fn();
    const host = render(<MapCompass bearing={200} tilt={50} isOrbitProjection onReset={onReset} />);
    act(() => { button(host)!.click(); });
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("carries a compass POINT beside the number, so the heading reads at a glance", () => {
    expect(mapCompassPoint(0)).toBe("N");
    expect(mapCompassPoint(90)).toBe("E");
    expect(mapCompassPoint(180)).toBe("S");
    expect(mapCompassPoint(270)).toBe("W");
    expect(mapCompassPoint(46)).toBe("NE");
    expect(mapCompassPoint(359)).toBe("N");
    expect(mapCompassPoint(-45)).toBe("NW");
    expect(button(render(<MapCompass bearing={90} tilt={0} isOrbitProjection onReset={() => {}} />))!.textContent).toContain("E");
  });
});

describe("mapBearingIsNorth / mapOrientIsHome", () => {
  it("north is a neighbourhood measured the SHORT way round", () => {
    expect(mapBearingIsNorth(0)).toBe(true);
    expect(mapBearingIsNorth(360)).toBe(true);
    expect(mapBearingIsNorth(359.99)).toBe(true);
    expect(mapBearingIsNorth(0.8)).toBe(false);
    expect(mapBearingIsNorth(359)).toBe(false);
    expect(mapBearingIsNorth(180)).toBe(false);
  });

  it("home is both at once — either one off home raises the control", () => {
    expect(mapOrientIsHome(0, 0, true)).toBe(true);
    expect(mapOrientIsHome(20, 0, true)).toBe(false);
    expect(mapOrientIsHome(0, 20, true)).toBe(false);
    expect(mapOrientIsHome(MAP_TILT_SHEET_HOME, 0, false)).toBe(true);
    expect(mapOrientIsHome(0, 0, false)).toBe(false);
  });
});
