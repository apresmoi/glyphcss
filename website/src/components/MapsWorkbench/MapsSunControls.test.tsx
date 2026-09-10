// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// React 19 requires this flag for `act()`-based tests (createRoot + act, no
// React Testing Library here) — mirrors `SynthWorkbench/LayerGroup.test.tsx`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `Dock/slots.tsx` -> `useRenderingFolder.ts` calls `ensureCalibratedPalette()`
// at IMPORT TIME, a real-browser-only canvas measurement happy-dom cannot do.
// Stub just that one measurement (the rest of `@glyphcss/effects` stays real),
// exactly as `SynthWorkbench/LayerGroup.test.tsx` already does for the same
// import chain. `vi.mock` is hoisted above every import in this file.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import { Dock, DockLighting } from "../Dock";
import { DEFAULT_MAP_LIGHTING, MapsSunControls, type MapSunMode } from "./mapsKit";

/**
 * The sun controls live INSIDE the shared Dock Lighting folder, through
 * `DockLighting`'s `extras` seam — mounted against a REAL lil-gui here,
 * because what is worth testing is exactly that wiring: the toggle portals in
 * above the rows it gates, the manual-time rows exist but stay hidden outside
 * manual mode, and Azimuth/Elev dim (with a reason) when something else owns
 * the key light's direction.
 */

let root: Root | null = null;
let container: HTMLElement | null = null;
const onMode = vi.fn();

function tree(mode: MapSunMode, directionLocked: boolean) {
  return (
    <Dock>
      <DockLighting
        lightAzimuth={DEFAULT_MAP_LIGHTING.lightAzimuth}
        lightElevation={DEFAULT_MAP_LIGHTING.lightElevation}
        lightIntensity={DEFAULT_MAP_LIGHTING.lightIntensity}
        lightColor={DEFAULT_MAP_LIGHTING.lightColor}
        ambientIntensity={DEFAULT_MAP_LIGHTING.ambientIntensity}
        ambientColor={DEFAULT_MAP_LIGHTING.ambientColor}
        directionLocked={directionLocked}
        directionLockedReason="the sun owns it"
        onUpdateScene={() => {}}
        extras={(folder) => (
          <MapsSunControls
            folder={folder}
            mode={mode}
            day={172}
            hour={12}
            onMode={onMode}
            onDay={() => {}}
            onHour={() => {}}
          />
        )}
      />
    </Dock>
  );
}

function mount(mode: MapSunMode, directionLocked = false) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(tree(mode, directionLocked)); });
  return (nextMode: MapSunMode, nextLocked = false) => {
    act(() => { root!.render(tree(nextMode, nextLocked)); });
  };
}

/** lil-gui hides a controller with `style.display = "none"`, not a class. */
function row(name: string): HTMLElement | undefined {
  return Array.from(container!.querySelectorAll<HTMLElement>(".controller"))
    .find((c) => c.querySelector(".name")?.textContent === name);
}
const isVisible = (name: string) => !!row(name) && row(name)!.style.display !== "none";

afterEach(() => {
  onMode.mockClear();
  // lil-gui and React both think they own the controller DOM on teardown;
  // `Dock/primitives.tsx`'s `destroyController` already swallows the
  // NotFoundError that causes in a real browser, but happy-dom throws its own
  // DOMException class, which that `instanceof` check does not match. The
  // nodes are gone either way and nothing under test runs after this.
  try { act(() => root?.unmount()); } catch { /* happy-dom teardown, see above */ }
  container?.remove();
  root = null;
  container = null;
});

describe("MapsSunControls inside the shared Dock Lighting folder", () => {
  it("portals a three-button Sun toggle above the folder's own rows", () => {
    mount("off");
    const toggleRow = container!.querySelector(".dock-subcell");
    expect(toggleRow).not.toBeNull();
    expect(toggleRow!.querySelector(".dock-subcell-label")!.textContent).toBe("Sun");
    expect(toggleRow!.querySelectorAll(".gx-toggle-btn").length).toBe(3);
    // First child of the folder body — above the Azimuth/Elev rows it gates.
    const slot = toggleRow!.parentElement!;
    expect(slot.classList.contains("dock-subcell-slot")).toBe(true);
    expect(slot.parentElement!.firstElementChild).toBe(slot);
  });

  it("clicking a button reports the new mode", () => {
    mount("off");
    const buttons = container!.querySelectorAll<HTMLButtonElement>(".gx-toggle-btn");
    act(() => { buttons[1].click(); });
    expect(onMode).toHaveBeenCalledWith("realtime");
    act(() => { buttons[2].click(); });
    expect(onMode).toHaveBeenCalledWith("manual");
  });

  it("creates the manual-time rows always, but shows them only in manual mode", () => {
    const rerender = mount("off");
    expect(row("Sun day")).toBeTruthy();
    expect(row("Sun hour")).toBeTruthy();
    expect(isVisible("Sun day")).toBe(false);
    expect(isVisible("Sun hour")).toBe(false);

    rerender("manual");
    expect(isVisible("Sun day")).toBe(true);
    expect(isVisible("Sun hour")).toBe(true);

    rerender("realtime");
    expect(isVisible("Sun day")).toBe(false);
  });

  it("dims Azimuth/Elev only when the direction is locked, and says why", () => {
    const rerender = mount("off", false);
    expect(row("Azimuth")!.classList.contains("disabled")).toBe(false);
    expect(row("Elev.")!.classList.contains("disabled")).toBe(false);

    rerender("realtime", true);
    expect(row("Azimuth")!.classList.contains("disabled")).toBe(true);
    expect(row("Elev.")!.classList.contains("disabled")).toBe(true);
    expect(row("Azimuth")!.title).toBe("the sun owns it");
    // Only the DIRECTION is taken over — intensity/ambient stay live.
    expect(row("Key")!.classList.contains("disabled")).toBe(false);
    expect(row("Ambient")!.classList.contains("disabled")).toBe(false);

    rerender("off", false);
    expect(row("Azimuth")!.classList.contains("disabled")).toBe(false);
    expect(row("Azimuth")!.title).toBe("");
  });
});
