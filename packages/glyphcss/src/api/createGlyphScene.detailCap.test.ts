/**
 * F2: the per-mesh detail layer's MAX_DIM cap (`createGlyphScene.ts`, ~1636)
 * must not force a real hidden-`<pre>` layout probe (`measureDetailCell`)
 * every steady-state rerender once it has engaged. Before the fix, the cap
 * block cleared `layer.key` unconditionally whenever it engaged, which forced
 * the DIVERGENT-FONT branch above it to re-derive `layer.cw`/`layer.ch` via a
 * fresh `measureDetailCell` call (a forced synchronous layout flush) on every
 * subsequent render, even though density/cwB/chB/sameFontAsBase never
 * changed — measured: density 400 (`need > 1024`, the cap engages) produced
 * exactly one such probe per rerender, indefinitely; density 2 (cap never
 * engages) produced zero. `measureDetailCell` is now memoized by its own
 * (fontSize, lineHeight, fontFamily) CSS input, so a repeat call with
 * unchanged inputs is a cache hit rather than a fresh layout probe.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import { ensureGlyphAtlasFontFaceStyles } from "../styles/styles";
import type { Polygon } from "@glyphcss/core";

function makeDiv(): HTMLElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

async function flushAtlasRenders(): Promise<void> {
  await ensureGlyphAtlasFontFaceStyles(document);
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

const FLAT_LIGHTING = {
  directionalLight: { direction: [0, 0, 1] as [number, number, number], intensity: 0 },
  ambientLight: { intensity: 1 },
};

function flatQuad(color: string): Polygon[] {
  return [{ vertices: [[-3, -3, 0], [-3, 3, 0], [3, 3, 0], [3, -3, 0]], color }];
}

// A raw CSS colour name (not `#rrggbb`) forwarded unchecked through wireframe
// edges (`rasterize.ts`'s `drawLineToStamp(..., e.color ?? null, ...)`) makes
// this mesh's own detail grid structurally unencodable while the base stays
// atlas — the divergent-font case the redundant-measurement bug needs.
function detailQuad(color: string): Polygon[] {
  return [{ vertices: [[6, -3, 0], [6, 3, 0], [12, 3, 0], [12, -3, 0]] as [number, number, number][], color }];
}

/**
 * Counts real `getBoundingClientRect` calls against `measureDetailCell`'s own
 * hidden probe element (`className` includes `glyph-output--detail`),
 * isolating it from the base cell probe and any other layout read.
 *
 * jsdom has no real layout engine — every element's `getBoundingClientRect`
 * is zero by default — so this ALSO models a realistic monospace advance
 * (proportional to the probed `font-size`) for exactly that probe. Without
 * it, `measureCellOf`'s zero-size fallback (`w: 8, h: 16`) makes the detail
 * layer's derived `kx`/`ky` stay small regardless of the requested `density`,
 * and the MAX_DIM cap this test exists to exercise never actually engages —
 * a false negative that would pass whether or not the redundant-probe bug is
 * present.
 */
function countDetailProbes(): { calls: () => number; reset: () => void } {
  let n = 0;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    const empty = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    if (!el.className?.includes?.("glyph-output--detail")) return empty;
    n++;
    const fontSizePx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? "16");
    const lines = (el.textContent ?? "").split("\n").length || 1;
    const width = fontSizePx * 0.6;
    const height = fontSizePx * 1.2 * lines;
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  });
  return { calls: () => n, reset: () => { n = 0; } };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("createGlyphScene — detail layer MAX_DIM cap does not force a per-frame layout probe (F2)", () => {
  it("bounds the hidden-<pre> detail-cell measurement count in steady state once the cap has engaged", async () => {
    const probes = countDetailProbes();
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      camera: createGlyphOrthographicCamera({ zoom: 20 }),
      cols: 40,
      rows: 16,
      mode: "wireframe",
      // Fully atlas-covered and deterministic (see `colorEncoding.test.ts`'s
      // dedicated describe block) so the BASE grid's own encodability never
      // oscillates and can't confound this measurement.
      glyphPalette: "ascii",
      useColors: true,
      colorEncoding: "atlas",
      atlasPalette: ["#336699"],
      ...FLAT_LIGHTING,
    });
    scene.add(flatQuad("#336699"));
    // density 400: this mesh's on-screen bbox is a handful of base cells, so
    // `need = bbox * density` comfortably exceeds MAX_DIM (1024) — the cap
    // engages every frame, not just once.
    scene.add(detailQuad("red"), { density: 400 });
    await flushAtlasRenders();
    await flushAtlasRenders(); // reach steady state (divergence + cap both settled).

    probes.reset();
    for (let i = 0; i < 20; i++) {
      scene.rerender();
    }
    // "Genuinely once per divergence transition" — no further transition
    // occurred in this loop (no option changed), so this must be 0, not
    // merely "less than 20".
    expect(probes.calls()).toBe(0);

    scene.destroy();
    host.remove();
  });

  it("stays at zero probes when the cap never engages (density 2) — the already-correct baseline this must not regress", async () => {
    const probes = countDetailProbes();
    const host = makeDiv();
    const scene = createGlyphScene(host, {
      camera: createGlyphOrthographicCamera({ zoom: 20 }),
      cols: 40,
      rows: 16,
      mode: "wireframe",
      glyphPalette: "ascii",
      useColors: true,
      colorEncoding: "atlas",
      atlasPalette: ["#336699"],
      ...FLAT_LIGHTING,
    });
    scene.add(flatQuad("#336699"));
    scene.add(detailQuad("red"), { density: 2 });
    await flushAtlasRenders();
    await flushAtlasRenders();

    probes.reset();
    for (let i = 0; i < 20; i++) {
      scene.rerender();
    }
    expect(probes.calls()).toBe(0);

    scene.destroy();
    host.remove();
  });
});
