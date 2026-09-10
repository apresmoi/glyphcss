// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// React 19 requires this flag for `act()`-based tests (createRoot + act, no
// React Testing Library here) — mirrors `MapsSunControls.test.tsx`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `Dock/slots.tsx` -> `useRenderingFolder.ts` calls `ensureCalibratedPalette()`
// at IMPORT TIME, a real-browser-only canvas measurement happy-dom cannot do.
// Stub just that one measurement, exactly as `MapsSunControls.test.tsx` does
// for the same import chain.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import { Dock, DockLighting } from "../Dock";
import { useDockGui } from "../Dock/slots";
import {
  DEFAULT_MAP_LIGHTING,
  MapsProjectionControls,
  MapsSunControls,
  type MapProjectionId,
} from "./mapsKit";

/**
 * The projection picker was moved out of the left rail (a plain, un-portaled
 * React tree) into the Dock — through the SAME `useDockSlot`/`.dock-subcell`
 * portal mechanism `MapsSunControls` already uses, but against the Dock's
 * ROOT `GUI` (via `useDockGui()`) rather than a folder, so it lands above
 * every folder rather than inside one. This file exercises that wiring the
 * same way `MapsSunControls.test.tsx` exercises the Sun toggle: mount
 * against a REAL lil-gui, alongside `DockLighting`'s own Sun toggle, so the
 * two read as siblings in one system rather than two.
 */

let root: Root | null = null;
let container: HTMLElement | null = null;
const onProjectionId = vi.fn();
const onSunMode = vi.fn();

// A Dock child (so `useDockGui()` resolves) that forwards the root `GUI` to
// `MapsProjectionControls` exactly as `MapsWorkbench.tsx`'s `MapsDockFolders`
// does.
function ProjectionHost({ projectionId }: { projectionId: MapProjectionId }) {
  const gui = useDockGui();
  return <MapsProjectionControls folder={gui} projectionId={projectionId} onProjectionId={onProjectionId} />;
}

function tree(projectionId: MapProjectionId) {
  return (
    <Dock>
      {/*
        `DockLighting` deliberately mounts BEFORE `ProjectionHost` here — the
        opposite of `MapsWorkbench.tsx`'s own JSX order — so the "lands above
        EVERY folder" assertions below are proven by `useDockSlot`'s
        `position: "top"` (an `insertBefore` against whatever is already the
        root's first child) rather than by an accident of mount order: the
        Lighting folder is created first, and the slot still has to jump
        ahead of it.
      */}
      <DockLighting
        lightAzimuth={DEFAULT_MAP_LIGHTING.lightAzimuth}
        lightElevation={DEFAULT_MAP_LIGHTING.lightElevation}
        lightIntensity={DEFAULT_MAP_LIGHTING.lightIntensity}
        lightColor={DEFAULT_MAP_LIGHTING.lightColor}
        ambientIntensity={DEFAULT_MAP_LIGHTING.ambientIntensity}
        ambientColor={DEFAULT_MAP_LIGHTING.ambientColor}
        directionLocked={false}
        directionLockedReason=""
        onUpdateScene={() => {}}
        extras={(folder) => (
          <MapsSunControls
            folder={folder}
            mode="off"
            day={172}
            hour={12}
            onMode={onSunMode}
            onDay={() => {}}
            onHour={() => {}}
          />
        )}
      />
      <ProjectionHost projectionId={projectionId} />
    </Dock>
  );
}

function mount(projectionId: MapProjectionId) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(tree(projectionId)); });
}

afterEach(() => {
  onProjectionId.mockClear();
  onSunMode.mockClear();
  // Same happy-dom double-teardown swallow `MapsSunControls.test.tsx` uses.
  try { act(() => root?.unmount()); } catch { /* happy-dom teardown */ }
  container?.remove();
  root = null;
  container = null;
});

describe("MapsProjectionControls at the top of the Dock", () => {
  it("portals a three-button Projection toggle above every folder, laid out inline like the Sun control", () => {
    mount("globe");
    const toggleRow = container!.querySelector(".dock-subcell");
    expect(toggleRow).not.toBeNull();
    expect(toggleRow!.querySelector(".dock-subcell-label")!.textContent).toBe("Projection");
    expect(toggleRow!.querySelectorAll(".gx-toggle-btn").length).toBe(3);

    // The slot sits directly under the ROOT gui's own children container —
    // i.e. above every `<GUI>.addFolder(...)` folder (Lighting included),
    // not merely above the rows of one folder.
    const slot = toggleRow!.parentElement!;
    expect(slot.classList.contains("dock-subcell-slot")).toBe(true);
    expect(slot.parentElement!.firstElementChild).toBe(slot);
    expect(container!.textContent).toContain("Lighting"); // the Lighting folder exists...
    expect(Array.from(slot.parentElement!.children).indexOf(slot)).toBe(0); // ...but the slot is still first.
  });

  it("clicking a button reports the new projection, from its new mount point", () => {
    mount("equirectangular");
    const buttons = container!.querySelectorAll<HTMLButtonElement>(".dock-subcell .gx-toggle-btn");
    act(() => { buttons[1].click(); });
    expect(onProjectionId).toHaveBeenCalledWith("mercator");
    act(() => { buttons[2].click(); });
    expect(onProjectionId).toHaveBeenCalledWith("globe");
  });

  it("gives every Projection AND Sun button a real explanatory tooltip, not a restated label", () => {
    mount("equirectangular");
    const dockSubcells = container!.querySelectorAll(".dock-subcell");
    expect(dockSubcells.length).toBe(2); // Projection (root) + Sun (inside Lighting)

    const [projectionCell, sunCell] = Array.from(dockSubcells);
    expect(projectionCell.querySelector(".dock-subcell-label")!.textContent).toBe("Projection");
    expect(sunCell.querySelector(".dock-subcell-label")!.textContent).toBe("Sun");

    const projectionButtons = Array.from(projectionCell.querySelectorAll<HTMLButtonElement>(".gx-toggle-btn"));
    const projectionTitles = projectionButtons.map((b) => b.title);
    expect(projectionTitles).toHaveLength(3);
    // Every tooltip explains the projection, not just names it — mutation
    // check below proves this assertion is load-bearing.
    for (const title of projectionTitles) {
      expect(title.startsWith("Equirectangular —") || title.startsWith("Mercator —") || title.startsWith("Globe —")).toBe(true);
      expect(title.length).toBeGreaterThan(20);
    }
    const mercatorTitle = projectionTitles.find((t) => t.startsWith("Mercator"))!;
    expect(mercatorTitle).toMatch(/pole/i);
    const globeTitle = projectionTitles.find((t) => t.startsWith("Globe"))!;
    expect(globeTitle).toMatch(/sphere/i);
    const equirectTitle = projectionTitles.find((t) => t.startsWith("Equirectangular"))!;
    expect(equirectTitle).toMatch(/grid/i);
    // The group itself also carries an explanatory title.
    expect(projectionCell.querySelector(".gx-toggle")!.getAttribute("title")).toMatch(/map's shape/i);

    const sunButtons = Array.from(sunCell.querySelectorAll<HTMLButtonElement>(".gx-toggle-btn"));
    const sunTitles = sunButtons.map((b) => b.title);
    expect(sunTitles).toHaveLength(3);
    for (const title of sunTitles) {
      expect(title.length).toBeGreaterThan(15);
    }
    expect(sunTitles.find((t) => t.startsWith("Full"))).toMatch(/lit/i);
    expect(sunTitles.find((t) => t.startsWith("Real time"))).toMatch(/terminator|advan/i);
    expect(sunTitles.find((t) => t.startsWith("Manual"))).toMatch(/day|hour/i);
  });
});
