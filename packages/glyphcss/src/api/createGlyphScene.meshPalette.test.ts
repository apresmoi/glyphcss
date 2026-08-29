/**
 * Per-mesh `glyphPalette` (GlyphMeshTransform.glyphPalette) + layer-tagged
 * `transformCells`: a mesh can rasterize against its OWN solid ramp in its own
 * detail layer while the rest of the scene keeps the scene palette, and the
 * post-rasterize hook is told which layer's grid it is transforming.
 *
 * Discriminator glyphs: a flat fully-lit white quad renders each palette's
 * BRIGHTEST solid-ramp character — "@" for the "ascii" palette, "N" for the
 * "dense" palette. Deleting the per-mesh override in renderDetailLayers turns
 * the detail expectations red; deleting the layer-info wrapper turns the hook
 * expectations red.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import type { GlyphSceneOptions } from "./types";
import type { Polygon } from "@glyphcss/core";
import type { GlyphTransformCellsLayer } from "../render/cells";

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

describe("per-mesh glyphPalette", () => {
  it("a detail mesh rasterizes with its own ramp while the base keeps the scene's", () => {
    const host = makeHost();
    const scene = makeScene(host);
    scene.add(quad(0));                                            // base: scene palette
    scene.add(quad(1, -0.5, 0.5, -0.5, 0.5), { density: 2, glyphPalette: "dense" });
    scene.rerender();

    const base = scene.output.textContent ?? "";
    expect(base).toContain("@");                                   // "ascii" brightest
    expect(base).not.toContain("N");                               // never the dense ramp

    const detail = detailPres(host).map((p) => p.textContent ?? "").join("\n");
    expect(detail).toContain("N");                                 // "dense" brightest
    expect(detail).not.toContain("@");                             // not the scene ramp
    scene.destroy();
  });

  it("glyphPalette ALONE pops the mesh into its own layer (base cell size)", () => {
    const host = makeHost();
    const scene = makeScene(host);
    scene.add(quad(0));
    scene.add(quad(1, -0.5, 0.5, -0.5, 0.5), { glyphPalette: "dense" });
    scene.rerender();

    const pres = detailPres(host);
    expect(pres.length).toBe(1);                                   // separated, no density needed
    expect(pres[0]!.textContent ?? "").toContain("N");
    scene.destroy();
  });

  it("a mesh without the override keeps the scene palette in its detail layer", () => {
    const host = makeHost();
    const scene = makeScene(host);
    scene.add(quad(0));
    scene.add(quad(1, -0.5, 0.5, -0.5, 0.5), { density: 2 });
    scene.rerender();

    const detail = detailPres(host).map((p) => p.textContent ?? "").join("\n");
    expect(detail).toContain("@");
    expect(detail).not.toContain("N");
    scene.destroy();
  });
});

describe("transformCells layer identity", () => {
  it("the hook is told base vs detail, with the detail mesh's id and density", () => {
    const seen: (GlyphTransformCellsLayer | undefined)[] = [];
    const host = makeHost();
    const scene = makeScene(host, {
      transformCells: (_grid, layer) => { seen.push(layer); },
    });
    scene.add(quad(0));
    scene.add(quad(1, -0.5, 0.5, -0.5, 0.5), { density: 2, id: "logo" });
    scene.rerender();

    const base = seen.filter((l) => l?.detail === false);
    const detail = seen.filter((l) => l?.detail === true);
    expect(base.length).toBeGreaterThan(0);
    expect(detail.length).toBeGreaterThan(0);
    expect(base.every((l) => l!.mesh === undefined)).toBe(true);
    expect(detail[detail.length - 1]).toMatchObject({ detail: true, mesh: "logo", density: 2 });
    scene.destroy();
  });
});
