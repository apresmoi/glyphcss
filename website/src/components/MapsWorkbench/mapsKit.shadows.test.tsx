// @vitest-environment happy-dom
/**
 * The Lighting folder's Shadows row.
 *
 * Two things worth pinning, and only two. It has to be IN the Lighting
 * folder, beside the Sun toggle it shares a light with — a shadow is thrown
 * by the key light, so separating the two is what would make the control hard
 * to find. And it has to sit BELOW Sun, which is not free: `useDockSlot`'s
 * `position: "top"` inserts each slot before the folder's current first
 * child, so the LAST slot mounted ends up FIRST, and the render order in
 * `MapsWorkbench`'s `extras` is therefore the reverse of the reading order.
 * That inversion is exactly the kind of thing that silently flips on a
 * refactor.
 *
 * `MapsWorkbench.tsx` cannot be mounted under this vitest config, so the two
 * components are driven directly against a real lil-gui root — the split
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

import { MapsShadowControls, MapsSunControls, mapShadowCasterReason } from "./mapsKit";

let root: Root | null = null;
let container: HTMLElement | null = null;
let guiHost: HTMLElement | null = null;
let gui: GUI | null = null;
const noop = () => {};

function Harness({ shadows, onShadows, casterReason }: { shadows: boolean; onShadows: (on: boolean) => void; casterReason?: string | null }) {
  return (
    <>
      {/* The reading order is Sun then Shadows, so the JSX order is the
          reverse — see this file's header. */}
      <MapsShadowControls folder={gui} shadows={shadows} onShadows={onShadows} casterReason={casterReason} />
      <MapsSunControls folder={gui} mode="off" day={172} hour={12} onMode={noop} onDay={noop} onHour={noop} />
    </>
  );
}

function render(shadows: boolean, onShadows: (on: boolean) => void = noop, casterReason?: string | null): HTMLElement {
  container = document.createElement("div");
  guiHost = document.createElement("div");
  document.body.append(container, guiHost);
  gui = new GUI({ container: guiHost });
  root = createRoot(container);
  act(() => { root!.render(<Harness shadows={shadows} onShadows={onShadows} casterReason={casterReason} />); });
  return guiHost;
}

const note = (host: HTMLElement) => host.querySelector<HTMLElement>(".maps-shadow-note")?.textContent ?? null;

/** The `.dock-subcell` row whose label reads `label`. */
function subcell(host: HTMLElement, label: string): HTMLElement {
  for (const el of Array.from(host.querySelectorAll<HTMLElement>(".dock-subcell"))) {
    if (el.querySelector(".dock-subcell-label")?.textContent === label) return el;
  }
  throw new Error(`no dock subcell named ${label}`);
}

const labels = (host: HTMLElement) =>
  Array.from(host.querySelectorAll<HTMLElement>(".dock-subcell-label")).map((n) => n.textContent);

afterEach(() => {
  // See `mapsKit.viewFolder.test.tsx` for why this teardown throw is a
  // harness artefact and is swallowed here.
  try { act(() => { root?.unmount(); }); } catch { /* see above */ }
  root = null;
  gui?.destroy();
  gui = null;
  container?.remove();
  container = null;
  guiHost?.remove();
  guiHost = null;
});

describe("Lighting folder — Shadows", () => {
  it("sits in the same folder as Sun, and directly under it", () => {
    const host = render(false);
    expect(labels(host)).toEqual(["Sun", "Shadows"]);
  });

  it("shows OFF as the live choice by default, and follows the state into Cast", () => {
    const host = render(false);
    const active = () =>
      subcell(host, "Shadows").querySelector<HTMLElement>(".gx-toggle-btn.is-active")?.getAttribute("aria-label");
    expect(active()).toBe("Off");
    // Pushed IN, not clicked: the control is bound to page state (a URL that
    // carries `D`, or the reader clicking through), so it has to re-read.
    act(() => { root!.render(<Harness shadows onShadows={noop} />); });
    expect(active()).toBe("Cast");
  });

  it("reports the choice the reader clicked, both ways", () => {
    const seen: boolean[] = [];
    const host = render(false, (on) => seen.push(on));
    const buttons = Array.from(subcell(host, "Shadows").querySelectorAll<HTMLElement>(".gx-toggle-btn"));
    act(() => { buttons[1]!.click(); });
    act(() => { buttons[0]!.click(); });
    expect(seen).toEqual([true, false]);
  });
});

describe("mapShadowCasterReason — the Shadows toggle says when it would draw nothing", () => {
  const NONE = {} as const;
  const NO_OSM = {} as const;

  it("names a reason on the page's DEFAULT layer set, where nothing can cast", () => {
    // Terrain + borders is what /maps opens on, and neither casts: terrain is
    // deliberately excluded (`GLYPH_MAP_SHADOW_CASTERS`) and a border is a
    // stamped stroke with no mesh at all. So the default map is exactly the
    // case where the toggle is inert, and it has to say so.
    const reason = mapShadowCasterReason(NONE, false, NO_OSM);
    expect(reason).not.toBeNull();
    expect(reason).toContain("Buildings");
  });

  it("goes quiet as soon as something that stands up is mounted", () => {
    expect(mapShadowCasterReason({ "fill-extrusion": true }, false, NO_OSM)).toBeNull();
    expect(mapShadowCasterReason({ model: true }, false, NO_OSM)).toBeNull();
    expect(mapShadowCasterReason(NONE, true, { "omt-buildings": true })).toBeNull();
  });

  it("still warns when the OSM card is on but its Buildings row is not — the reported link's own shape", () => {
    // `?m=...O21f...` mounts landcover, landuse, roads and buildings. With
    // buildings alone switched off, the same card mounts two `fill`s and a
    // `line` — receivers and a stamp, and nothing that casts.
    expect(mapShadowCasterReason(NONE, true, { "omt-landuse": true, "omt-roads": true })).not.toBeNull();
    // ...and the card being OFF does not let its armed Buildings row count.
    expect(mapShadowCasterReason(NONE, false, { "omt-buildings": true })).not.toBeNull();
  });
});

describe("Lighting folder — the Shadows row's inert-state note", () => {
  it("is absent while shadows are OFF, however empty the map is", () => {
    // Nothing is inert yet, so a caveat here would be noise.
    expect(note(render(false, noop, mapShadowCasterReason({}, false, {})))).toBeNull();
  });

  it("appears under the row once shadows are ON and nothing can cast", () => {
    const host = render(true, noop, mapShadowCasterReason({}, false, {}));
    expect(note(host)).toContain("Nothing mounted casts");
    // Still in the Lighting folder, still directly under Sun — the note must
    // not have displaced the row it qualifies.
    expect(labels(host)).toEqual(["Sun", "Shadows"]);
  });

  it("is absent with shadows ON and a caster mounted", () => {
    expect(note(render(true, noop, mapShadowCasterReason({ "fill-extrusion": true }, false, {})))).toBeNull();
  });
});
