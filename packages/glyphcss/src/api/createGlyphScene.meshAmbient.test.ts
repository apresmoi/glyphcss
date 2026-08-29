/**
 * Per-mesh `ambientIntensity` (GlyphMeshTransform.ambientIntensity): a mesh's
 * own detail layer rasterizes under its OWN ambient light intensity — glyph
 * choice follows it — while the rest of the scene keeps the scene ambient.
 *
 * Discriminator glyphs: a flat white quad under the "ascii" ramp renders its
 * BRIGHTEST character ("@") at full ambient and a dark-tail character at a
 * dim ambient. Deleting the per-mesh ambient override in the detail-layer
 * context turns the dim expectations red; deleting the separation-predicate
 * clause turns the pop-out expectation red.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import type { GlyphSceneOptions } from "./types";
import type { Polygon } from "@glyphcss/core";

const COLS = 32;
const ROWS = 24;

function makeHost(): HTMLElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

afterEach(() => {
  document.body.innerHTML = "";
});

function quad(z: number, a0 = -1, a1 = 1, b0 = -1, b1 = 1): Polygon[] {
  return [{ vertices: [[a0, b0, z], [a0, b1, z], [a1, b1, z], [a1, b0, z]], color: "#ffffff" }];
}

function makeScene(host: HTMLElement, extra: Partial<GlyphSceneOptions> = {}) {
  return createGlyphScene(host, {
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 160 }),
    cols: COLS, rows: ROWS, cellAspect: 2,
    mode: "solid", useColors: false, doubleSided: true,
    glyphPalette: "ascii",
    directionalLight: { direction: [0, 0, 1], intensity: 0 },
    ambientLight: { intensity: 1 },
    ...extra,
  });
}

function detailPres(host: HTMLElement): HTMLPreElement[] {
  return Array.from(host.querySelectorAll("pre.glyph-output--detail"));
}

describe("per-mesh ambientIntensity", () => {
  it("a detail mesh rasterizes under its own dim ambient while the base keeps the scene's", () => {
    const host = makeHost();
    const scene = makeScene(host);
    scene.add(quad(0));                                              // base: ambient 1 → "@"
    scene.add(quad(1, -0.5, 0.5, -0.5, 0.5), { density: 2, ambientIntensity: 0.12 });
    scene.rerender();

    const base = scene.output.textContent ?? "";
    expect(base).toContain("@");                                     // full ambient, brightest

    const detail = detailPres(host).map((p) => p.textContent ?? "").join("\n");
    expect(detail.trim().length).toBeGreaterThan(0);                 // the mesh did render
    expect(detail).not.toContain("@");                               // dim: never the brightest
    scene.destroy();
  });

  it("ambientIntensity ALONE pops the mesh into its own layer (base cell size)", () => {
    const host = makeHost();
    const scene = makeScene(host);
    scene.add(quad(0));
    scene.add(quad(1, -0.5, 0.5, -0.5, 0.5), { ambientIntensity: 0.12 });
    scene.rerender();

    const pres = detailPres(host);
    expect(pres.length).toBe(1);                                     // separated by ambient alone
    expect(pres[0]!.textContent ?? "").not.toContain("@");
    scene.destroy();
  });

  it("names its layer's <pre> via data-glyph-mesh-id when the transform has an id", () => {
    const host = makeHost();
    const scene = makeScene(host);
    scene.add(quad(0));
    scene.add(quad(1, -0.5, 0.5, -0.5, 0.5), { id: "logo", density: 2, ambientIntensity: 0.5 });
    scene.rerender();

    const named = host.querySelector('pre.glyph-output--detail[data-glyph-mesh-id="logo"]');
    expect(named).not.toBeNull();
    scene.destroy();
  });
});
