// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// React 19 requires this flag for `act()`-based tests (createRoot + act, no
// React Testing Library here) — mirrors `MapsProjectionControls.test.tsx`.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// `useRenderingFolder.ts` calls `ensureCalibratedPalette()` at IMPORT TIME, a
// real-browser-only canvas measurement happy-dom cannot do. Stub just that
// one measurement, exactly as `MapsProjectionControls.test.tsx` does for the
// same import chain.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import { Dock, DockRendering, type RenderingFolderInputs } from "../index";

/**
 * The scene-level "Glyph palette" row moved onto the individual layer cards
 * on `/maps` (`LayersPanel.glyphPalette.test.tsx` covers that side). This
 * folder is SHARED with `/gallery`, so the old row had to become an opt-out
 * (`showGlyphPalette`, mirroring `showRenderMode`/`showDensity`) rather than
 * being deleted outright — deleting it would have silently removed Gallery's
 * only glyph-ramp control.
 */

let root: Root | null = null;
let container: HTMLElement | null = null;

function baseInputs(overrides: Partial<RenderingFolderInputs> = {}): RenderingFolderInputs {
  return {
    renderMode: "solid",
    semanticAvailable: false,
    featureEdges: 30,
    glyphPalette: "default",
    charMode: "ascii",
    wireframeJunctions: false,
    hiddenLines: "show",
    solidWeightRamp: false,
    colorEncoding: "spans",
    atlasReason: null,
    density: 1,
    dragDensity: 1,
    useColors: true,
    smoothShading: true,
    creaseAngle: 60,
    onRenderModeChange: () => {},
    onUpdateScene: () => {},
    ...overrides,
  };
}

function mount(inputs: RenderingFolderInputs): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <Dock>
        <DockRendering {...inputs} />
      </Dock>,
    );
  });
  return container;
}

/** The lil-gui row whose name label reads "Glyph palette", or null if absent. */
function glyphPaletteRow(host: HTMLElement): HTMLElement | null {
  return Array.from(host.querySelectorAll<HTMLElement>(".controller")).find(
    (row) => row.querySelector(".name")?.textContent === "Glyph palette",
  ) ?? null;
}

afterEach(() => {
  // Same happy-dom double-teardown swallow `MapsProjectionControls.test.tsx`
  // uses — a folder and its controllers both racing to remove the same DOM
  // node on unmount.
  try { act(() => { root?.unmount(); }); } catch { /* happy-dom teardown */ }
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("useRenderingFolder — scene-level Glyph palette row", () => {
  it("stays visible by default, as Gallery relies on (no opt-out prop passed)", () => {
    const host = mount(baseInputs());
    const row = glyphPaletteRow(host);
    expect(row).not.toBeNull();
    expect(row!.style.display).not.toBe("none");
  });

  it("/maps hides it via showGlyphPalette={false} — the ramp now lives per-layer", () => {
    const host = mount(baseInputs({ showGlyphPalette: false }));
    const row = glyphPaletteRow(host);
    expect(row).not.toBeNull();
    expect(row!.style.display).toBe("none");
  });
});
