// @vitest-environment happy-dom
/**
 * The on-map WALK control.
 *
 * It was a checkbox in the Dock's View folder, and was rejected as such:
 * "that walk shouldn't be a toggle ... it feels stupid as a checkbox". Walk
 * is a MODE the reader steps into and back out of, and every map product
 * that ships one puts it ON the map — Google Maps' pegman is the reference,
 * always present in a corner, greyed where the mode cannot be entered, and
 * carrying its own icon rather than a word and a tick.
 *
 * So this is a sibling of `MapCompass` and `MapSearchBox`, the page's two
 * existing map overlays, and it is tested the way they are: driven in
 * isolation, because `MapsWorkbench.tsx` cannot be mounted under this vitest
 * config.
 *
 * The property that carries over from the Dock row is the page's
 * dim-with-a-reason idiom (`mapDirectionLocked`'s Azimuth/Elev rows,
 * `charModeReason`): a control the reader cannot use is never hidden and
 * never silently inert — it says WHY, in the same words, from the overlay
 * instead of from a dimmed row.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { MapWalkButton } from "./MapWalkButton";
import { mapWalkBudgetLabel, mapWalkReason } from "./mapsWalk";

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

const noop = () => {};
const BUDGET = mapWalkBudgetLabel();

function button(host: HTMLElement): HTMLButtonElement {
  return host.querySelector<HTMLButtonElement>("button.maps-walk__toggle")!;
}

describe("MapWalkButton — where it lives", () => {
  it("is an overlay ON the map, like the compass and the search box", () => {
    const host = render(<MapWalkButton walking={false} reason={null} budget={BUDGET} onToggle={noop} />);
    // The same hook the other two overlays hang their absolute positioning
    // off (`.maps-compass`, `.maps-search`), so the three are one system.
    expect(host.querySelector(".maps-walk")).not.toBeNull();
    expect(button(host)).not.toBeNull();
  });

  it("is an ICON control, not a labelled checkbox", () => {
    const host = render(<MapWalkButton walking={false} reason={null} budget={BUDGET} onToggle={noop} />);
    expect(host.querySelector("input[type=checkbox]")).toBeNull();
    expect(button(host).querySelector("svg")).not.toBeNull();
    // It still names itself for a screen reader and for a hover.
    expect(button(host).getAttribute("aria-label")).toMatch(/walk/i);
  });

  it("is ALWAYS there — a mode the reader cannot find is a mode that does not exist", () => {
    const host = render(<MapWalkButton walking={false} reason="too far out" budget={BUDGET} onToggle={noop} />);
    expect(button(host).isConnected).toBe(true);
  });
});

describe("MapWalkButton — the altitude gate, and saying why", () => {
  it("is live, with a description of the mode, when walk mode is available", () => {
    const host = render(<MapWalkButton walking={false} reason={null} budget={BUDGET} onToggle={noop} />);
    expect(button(host).disabled).toBe(false);
    expect(button(host).getAttribute("title") ?? "").toMatch(/eye height/i);
  });

  it("is DISABLED and carries the reason VERBATIM when it is not", () => {
    // The real string, from the real gate, so the overlay cannot drift from
    // the words the page already uses.
    const reason = mapWalkReason({ projectionId: "globe", span: 40 })!;
    expect(reason).toMatch(/near the ground/i);
    const host = render(<MapWalkButton walking={false} reason={reason} budget={BUDGET} onToggle={noop} />);
    expect(button(host).disabled).toBe(true);
    expect(button(host).getAttribute("title")).toBe(reason);
    expect(button(host).getAttribute("aria-label")).toContain(reason);
  });

  it("carries the PROJECTION reason just as verbatim — the gate owns the words", () => {
    const reason = mapWalkReason({ projectionId: "mercator", span: 0.01 })!;
    const host = render(<MapWalkButton walking={false} reason={reason} budget={BUDGET} onToggle={noop} />);
    expect(button(host).getAttribute("title")).toBe(reason);
  });

  it("does not fire while it is gated, however hard it is clicked", () => {
    const onToggle = vi.fn();
    const host = render(<MapWalkButton walking={false} reason="nope" budget={BUDGET} onToggle={onToggle} />);
    act(() => { button(host).click(); });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("goes live again when the reason clears, without a remount", () => {
    const host = render(<MapWalkButton walking={false} reason="nope" budget={BUDGET} onToggle={noop} />);
    expect(button(host).disabled).toBe(true);
    act(() => { root!.render(<MapWalkButton walking={false} reason={null} budget={BUDGET} onToggle={noop} />); });
    expect(button(container!).disabled).toBe(false);
  });
});

describe("MapWalkButton — entering and leaving", () => {
  it("asks to enter exactly once", () => {
    const onToggle = vi.fn();
    const host = render(<MapWalkButton walking={false} reason={null} budget={BUDGET} onToggle={onToggle} />);
    act(() => { button(host).click(); });
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("becomes the way OUT while walking, and stays live even though the gate is about ENTERING", () => {
    const onToggle = vi.fn();
    // A walker standing in a street is inside the gate by construction; the
    // reason prop is about entering, so it must never be able to trap them.
    const host = render(<MapWalkButton walking reason="stale gate" budget={BUDGET} onToggle={onToggle} />);
    expect(button(host).disabled).toBe(false);
    expect(button(host).getAttribute("aria-pressed")).toBe("true");
    act(() => { button(host).click(); });
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("says how to walk and how to look, only while walking", () => {
    const host = render(<MapWalkButton walking={false} reason={null} budget={BUDGET} onToggle={noop} />);
    expect(host.querySelector(".maps-walk__legend")).toBeNull();
    act(() => { root!.render(<MapWalkButton walking reason={null} budget={BUDGET} onToggle={noop} />); });
    const legend = container!.querySelector(".maps-walk__legend")!;
    expect(legend.textContent).toMatch(/WASD/i);
    expect(legend.textContent).toMatch(/shift/i);
    expect(legend.textContent).toMatch(/look/i);
    expect(legend.textContent).toMatch(/esc/i);
  });

  it("keeps the horizon and its tile budget on screen while walking", () => {
    const host = render(<MapWalkButton walking reason={null} budget={BUDGET} onToggle={noop} />);
    expect(host.textContent).toContain(BUDGET);
    // ...and does not carry it when there is no walker to spend it.
    act(() => { root!.render(<MapWalkButton walking={false} reason={null} budget={BUDGET} onToggle={noop} />); });
    expect(container!.textContent).not.toContain(BUDGET);
  });
});
