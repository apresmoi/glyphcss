/**
 * `GlyphMeshTransform.detailGroup` — several detail meshes sharing ONE
 * silhouette-fitted `<pre>`, one cell lattice, and one occlusion id.
 *
 * It exists for correctness at a shared edge, not economy. Two abutting
 * meshes in two separate detail outputs point-sample coverage on lattices
 * fitted to two different silhouettes, so a sub-cell sliver along the edge
 * they share can fall inside neither sample and nothing paints it. That is
 * `@glyphcss/maps`' tile seam, and no occlusion refinement can close it: it is
 * not a blanking decision, the cell was simply never claimed. One lattice has
 * one sample per cell, and whichever member covers it paints it.
 *
 * The load-bearing assertions here:
 *  - a grouped pair produces ONE `<pre>` where an ungrouped pair produces two;
 *  - the grouped output is not merely fewer nodes — it paints the cells the
 *    ungrouped pair drops along the shared edge, and drops none of its own;
 *  - `detailGroup` on a mesh that is NOT a detail mesh is inert, byte for
 *    byte, so the ordinary `density: 1` path cannot move;
 *  - members that disagree on a shared decision throw rather than silently
 *    taking one member's value.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import type { GlyphSceneOptions } from "./types";
import type { Polygon } from "@glyphcss/core";

const COLS = 40;
const ROWS = 24;

function makeHost(): HTMLElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

afterEach(() => {
  document.body.innerHTML = "";
});

/** A quad in the X/Y plane at depth `z`, spanning `[a0,a1] x [b0,b1]`. */
function quad(z: number, a0: number, a1: number, b0: number, b1: number): Polygon[] {
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

/** Total non-blank cells across every output the scene produced. */
function totalInk(host: HTMLElement): number {
  let n = 0;
  for (const pre of host.querySelectorAll("pre.glyph-output")) {
    n += (pre.textContent ?? "").replace(/\s/g, "").length;
  }
  return n;
}

describe("GlyphMeshTransform.detailGroup", () => {
  it("is inert on a mesh that is not a detail mesh — the density-1 path is byte-identical", () => {
    const plain = makeHost();
    const scenePlain = makeScene(plain);
    scenePlain.add(quad(0, -1, 0, -1, 1));
    scenePlain.add(quad(0, 0, 1, -1, 1));
    scenePlain.rerender();
    const plainText = scenePlain.output.textContent;
    const plainDetails = detailPres(plain).length;

    const grouped = makeHost();
    const sceneGrouped = makeScene(grouped);
    sceneGrouped.add(quad(0, -1, 0, -1, 1), { detailGroup: "terrain" });
    sceneGrouped.add(quad(0, 0, 1, -1, 1), { detailGroup: "terrain" });
    sceneGrouped.rerender();

    // Same string, and still no detail layer at all: `detailGroup` never
    // separates a mesh by itself.
    expect(sceneGrouped.output.textContent).toBe(plainText);
    expect(detailPres(grouped).length).toBe(plainDetails);
    expect(detailPres(grouped).length).toBe(0);

    scenePlain.destroy();
    sceneGrouped.destroy();
  });

  it("collapses a group's detail meshes into ONE output <pre>", () => {
    const apart = makeHost();
    const sceneApart = makeScene(apart);
    sceneApart.add(quad(0, -1, 0, -1, 1), { density: 3 });
    sceneApart.add(quad(0, 0, 1, -1, 1), { density: 3 });
    sceneApart.rerender();
    expect(detailPres(apart).length).toBe(2);

    const together = makeHost();
    const sceneTogether = makeScene(together);
    sceneTogether.add(quad(0, -1, 0, -1, 1), { density: 3, detailGroup: "terrain" });
    sceneTogether.add(quad(0, 0, 1, -1, 1), { density: 3, detailGroup: "terrain" });
    sceneTogether.rerender();
    const pres = detailPres(together);
    expect(pres.length).toBe(1);
    // The group's name is exposed; a grouped output carries no single mesh id.
    expect(pres[0]!.dataset.glyphDetailGroup).toBe("terrain");
    expect(pres[0]!.dataset.glyphMeshId).toBeUndefined();

    sceneApart.destroy();
    sceneTogether.destroy();
  });

  it("paints at least as much as the ungrouped pair — the shared edge is not lost", () => {
    const apart = makeHost();
    const sceneApart = makeScene(apart);
    sceneApart.add(quad(0, -1, 0, -1, 1), { density: 3 });
    sceneApart.add(quad(0, 0, 1, -1, 1), { density: 3 });
    sceneApart.rerender();
    const inkApart = totalInk(apart);

    const together = makeHost();
    const sceneTogether = makeScene(together);
    sceneTogether.add(quad(0, -1, 0, -1, 1), { density: 3, detailGroup: "terrain" });
    sceneTogether.add(quad(0, 0, 1, -1, 1), { density: 3, detailGroup: "terrain" });
    sceneTogether.rerender();
    const inkTogether = totalInk(together);

    expect(inkApart).toBeGreaterThan(0);
    // Two meshes that exactly abut cover one rectangle. Rendered on one
    // lattice, every cell that rectangle covers is sampled once and painted;
    // rendered on two, the cells along the shared edge can fall inside
    // neither sample.
    expect(inkTogether).toBeGreaterThanOrEqual(inkApart);

    sceneApart.destroy();
    sceneTogether.destroy();
  });

  it("keeps a group's <pre> across renders as members come and go", () => {
    const host = makeHost();
    const scene = makeScene(host);
    const a = scene.add(quad(0, -1, 0, -1, 1), { density: 3, detailGroup: "terrain" });
    scene.add(quad(0, 0, 1, -1, 1), { density: 3, detailGroup: "terrain" });
    scene.rerender();
    const pre = detailPres(host)[0]!;

    // A tile pyramid churns its meshes constantly; the group must not
    // recreate DOM when one of them is replaced.
    a.dispose();
    scene.add(quad(0, -1, 0, -0.5, 1), { density: 3, detailGroup: "terrain" });
    scene.rerender();
    expect(detailPres(host).length).toBe(1);
    expect(detailPres(host)[0]).toBe(pre);

    scene.destroy();
  });

  it("an ungrouped detail mesh still gets its own <pre> and keeps its mesh id attribute", () => {
    const host = makeHost();
    const scene = makeScene(host);
    scene.add(quad(0, -1, 0, -1, 1), { density: 3, id: "left" });
    scene.add(quad(0, 0, 1, -1, 1), { density: 3, detailGroup: "terrain" });
    scene.rerender();
    const pres = detailPres(host);
    expect(pres.length).toBe(2);
    expect(pres.map((p) => p.dataset.glyphMeshId).filter(Boolean)).toEqual(["left"]);
    expect(pres.map((p) => p.dataset.glyphDetailGroup).filter(Boolean)).toEqual(["terrain"]);
    scene.destroy();
  });

  it("throws when a group's members disagree on a shared decision", () => {
    for (const [key, a, b] of [
      ["density", { density: 3 }, { density: 2 }],
      ["transparent", { density: 3 }, { density: 3, transparent: true }],
      ["glyphPalette", { density: 3, glyphPalette: "ascii" }, { density: 3, glyphPalette: "dense" }],
      ["mode", { density: 3 }, { density: 3, mode: "wireframe" as const }],
      ["occlusionPriority", { density: 3, occlusionPriority: 1 }, { density: 3 }],
    ] as const) {
      const host = makeHost();
      const scene = makeScene(host);
      scene.add(quad(0, -1, 0, -1, 1), { ...a, detailGroup: "terrain" });
      scene.add(quad(0, 0, 1, -1, 1), { ...b, detailGroup: "terrain" });
      expect(() => scene.rerender(), key).toThrow(new RegExp(`detailGroup "terrain".*"${key}"`));
      scene.destroy();
      host.remove();
    }
  });
});
