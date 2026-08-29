/**
 * Cross-SCENE occlusion: `getOpaqueCoverage` (producer) +
 * `setForeignOcclusion` (consumer) join two stacked scenes over one host into
 * a single occlusion domain, and per-mesh `occlusionPriority` gives an opaque
 * detail mesh a foreground-layer privilege (occludes the base world, is never
 * occluded by it) inside one scene's shared id-map.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createGlyphScene, type GlyphOcclusionCoverage, type GlyphSceneOptions } from "./createGlyphScene";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
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

const FLAT = {
  directionalLight: { direction: [0, 0, 1] as [number, number, number], intensity: 0 },
  ambientLight: { intensity: 1 },
};

function quad(z: number, a0 = -1, a1 = 1, b0 = -1, b1 = 1): Polygon[] {
  // world[0] → rows, world[1] → cols (voxcss axis map).
  return [{ vertices: [[a0, b0, z], [a0, b1, z], [a1, b1, z], [a1, b0, z]], color: "#ffffff" }];
}

function makeScene(host: HTMLElement, extra: Partial<GlyphSceneOptions> = {}) {
  return createGlyphScene(host, {
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 160 }),
    cols: COLS, rows: ROWS, cellAspect: 2,
    mode: "solid", useColors: false, doubleSided: true,
    ...FLAT,
    ...extra,
  });
}

/** Flush `scheduleRender`'s microtask queue. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function fullMask(): GlyphOcclusionCoverage {
  return { covered: new Uint8Array(COLS * ROWS).fill(1), cols: COLS, rows: ROWS };
}

/** Base-grid text rows (length ROWS, each COLS chars). */
function baseRows(scene: ReturnType<typeof makeScene>): string[] {
  return (scene.output.textContent ?? "").split("\n");
}

function detailPres(host: HTMLElement): HTMLPreElement[] {
  return Array.from(host.querySelectorAll("pre.glyph-output--detail"));
}

const CENTER_R = ROWS >> 1;
const CENTER_C = COLS >> 1;

describe("cross-scene occlusion coverage", () => {
  it("getOpaqueCoverage reports the opaque detail mesh's cells at output resolution", () => {
    const scene = makeScene(makeHost());
    scene.add(quad(0), { density: 2 });
    scene.rerender();
    const coverage = scene.getOpaqueCoverage();
    expect(coverage).not.toBeNull();
    expect(coverage!.cols).toBe(COLS);
    expect(coverage!.rows).toBe(ROWS);
    // The ±1-world quad covers the grid centre and not the far corner.
    expect(coverage!.covered[CENTER_R * COLS + CENTER_C]).toBe(1);
    expect(coverage!.covered[0]).toBe(0);
    scene.destroy();
  });

  it("setForeignOcclusion blanks the BASE grid under the covered cells only", () => {
    const scene = makeScene(makeHost());
    scene.add(quad(0)); // base mesh, covers the centre region
    scene.rerender();
    const before = baseRows(scene);
    expect(before[CENTER_R]![CENTER_C - 4]).not.toBe(" ");
    expect(before[CENTER_R]![CENTER_C + 4]).not.toBe(" ");

    // Foreign coverage: the LEFT half of the (same-resolution) grid.
    const covered = new Uint8Array(COLS * ROWS);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS / 2; c++) covered[r * COLS + c] = 1;
    scene.setForeignOcclusion({ covered, cols: COLS, rows: ROWS });
    scene.rerender();
    const after = baseRows(scene);
    expect(after[CENTER_R]![CENTER_C - 4]).toBe(" ");        // under the mask → blanked
    expect(after[CENTER_R]![CENTER_C + 4]).not.toBe(" ");    // outside → untouched

    // Clearing restores the full base.
    scene.setForeignOcclusion(null);
    scene.rerender();
    expect(baseRows(scene)[CENTER_R]![CENTER_C - 4]).not.toBe(" ");
    scene.destroy();
  });

  it("a TRANSPARENT detail mesh still yields to the foreign occluder (and only to it)", () => {
    const host = makeHost();
    const scene = makeScene(host);
    // A near base mesh that would occlude the detail mesh if it participated —
    // transparent must keep ignoring it.
    scene.add(quad(2, -0.5, 0.5, -0.5, 0.5));
    scene.add(quad(0), { density: 2, transparent: true });
    scene.rerender();
    const pre = detailPres(host)[0]!;
    const beforeText = pre.textContent ?? "";
    expect(beforeText.trim().length).toBeGreaterThan(0); // drew despite the near base mesh

    // Foreign mask covering EVERYTHING → the transparent layer blanks fully.
    const covered = new Uint8Array(COLS * ROWS).fill(1);
    scene.setForeignOcclusion({ covered, cols: COLS, rows: ROWS });
    scene.rerender();
    const afterText = detailPres(host)[0]?.textContent ?? "";
    expect(afterText.trim().length).toBe(0);
    scene.destroy();
  });
});

describe("occlusionPriority end-to-end (foreground-layer privilege)", () => {
  it("without priority a nearer base mesh blanks the opaque detail mesh", () => {
    const host = makeHost();
    const scene = makeScene(host);
    scene.add(quad(2)); // near "wall" in the base grid
    scene.add(quad(0, -0.5, 0.5, -0.5, 0.5), { density: 2 }); // far foreground layer
    scene.rerender();
    const pre = detailPres(host)[0]!;
    expect((pre.textContent ?? "").trim().length).toBe(0); // swallowed by the wall
  });

  it("with occlusionPriority the detail mesh draws AND blanks the base beneath it", () => {
    const host = makeHost();
    const scene = makeScene(host);
    scene.add(quad(2)); // near "wall"
    scene.add(quad(0, -0.5, 0.5, -0.5, 0.5), { density: 2, occlusionPriority: 1 });
    scene.rerender();
    const pre = detailPres(host)[0]!;
    expect((pre.textContent ?? "").trim().length).toBeGreaterThan(0); // never swallowed
    // The base is punched out under the foreground layer's cells…
    const rows = baseRows(scene);
    expect(rows[CENTER_R]![CENTER_C]).toBe(" ");
    // …but still draws outside them (quad(0,±0.5) spans ~±1.6 rows/±3.2 cols).
    expect(rows[CENTER_R]![CENTER_C + 5]).not.toBe(" ");
  });
});

/** Foreign coverage over the left half of a same-resolution grid. */
function leftHalfMask(): GlyphOcclusionCoverage {
  const covered = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS / 2; c++) covered[r * COLS + c] = 1;
  return { covered, cols: COLS, rows: ROWS };
}

describe("getOpaqueCoverage sees the base grid", () => {
  it("a scene with a foreign mask and no opaque details still reports its OWN base ownership", () => {
    // The middle scene of a 3-deep stack: it consumes a mask from above and
    // must still relay what its base grid opaquely paints to the scene below.
    const scene = makeScene(makeHost());
    scene.add(quad(0));
    scene.setForeignOcclusion(leftHalfMask());
    scene.rerender();
    const coverage = scene.getOpaqueCoverage();
    expect(coverage).not.toBeNull();
    expect(coverage!.covered[CENTER_R * COLS + CENTER_C + 4]).toBe(1); // base-owned, unmasked
    expect(coverage!.covered[CENTER_R * COLS + CENTER_C - 4]).toBe(0); // under the foreign stamp
    expect(coverage!.covered[0]).toBe(0);                              // no geometry there
    scene.destroy();
  });

  it("a foreign stamp is never relayed as this scene's own coverage", () => {
    const scene = makeScene(makeHost());
    scene.add(quad(0), { density: 2 }); // opaque detail mesh over the centre
    // A mask on the top-left corner, disjoint from the detail mesh's cells.
    const covered = new Uint8Array(COLS * ROWS);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) covered[r * COLS + c] = 1;
    scene.setForeignOcclusion({ covered, cols: COLS, rows: ROWS });
    scene.rerender();
    const coverage = scene.getOpaqueCoverage()!;
    expect(coverage.covered[CENTER_R * COLS + CENTER_C]).toBe(1); // the detail mesh: ours
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 6; c++) expect(coverage.covered[r * COLS + c]).toBe(0);
    }
    scene.destroy();
  });

  it("a plain base-only scene publishes nothing until trackOpaqueCoverage asks it to", () => {
    const off = makeScene(makeHost());
    off.add(quad(0));
    off.rerender();
    expect(off.getOpaqueCoverage()).toBeNull();

    const on = makeScene(makeHost(), { trackOpaqueCoverage: true });
    on.add(quad(0));
    on.rerender();
    const coverage = on.getOpaqueCoverage();
    expect(coverage).not.toBeNull();
    expect(coverage!.cols).toBe(COLS);
    expect(coverage!.rows).toBe(ROWS);
    expect(coverage!.covered[CENTER_R * COLS + CENTER_C]).toBe(1);
    expect(coverage!.covered[0]).toBe(0);

    // The forced base raster must not change a single output cell.
    expect(on.output.textContent).toBe(off.output.textContent);
    off.destroy();
    on.destroy();
  });
});

describe("setForeignOcclusion publish discipline", () => {
  it("re-publishing identical coverage schedules no render", async () => {
    let renders = 0;
    const scene = makeScene(makeHost(), { transformCells: (grid) => { renders += 1; return grid; } });
    scene.add(quad(0));
    scene.rerender();
    const baseline = renders;

    scene.setForeignOcclusion(leftHalfMask());
    await flush();
    expect(renders).toBe(baseline + 1);

    // Four more publishes of the SAME bytes — the documented "publish after
    // every render" pattern on a static stack.
    for (let i = 0; i < 4; i++) scene.setForeignOcclusion(leftHalfMask());
    await flush();
    expect(renders).toBe(baseline + 1);

    // A genuinely different mask still renders.
    scene.setForeignOcclusion(fullMask());
    await flush();
    expect(renders).toBe(baseline + 2);

    // Clearing renders once; clearing again does not.
    scene.setForeignOcclusion(null);
    await flush();
    expect(renders).toBe(baseline + 3);
    scene.setForeignOcclusion(null);
    await flush();
    expect(renders).toBe(baseline + 3);
    scene.destroy();
  });

  it("a producer reusing ONE buffer is still seen to change", async () => {
    let renders = 0;
    const scene = makeScene(makeHost(), { transformCells: (grid) => { renders += 1; return grid; } });
    scene.add(quad(0));
    scene.rerender();
    const baseline = renders;

    const reused = new Uint8Array(COLS * ROWS);
    scene.setForeignOcclusion({ covered: reused, cols: COLS, rows: ROWS });
    await flush();
    expect(renders).toBe(baseline + 1);

    reused.fill(1); // mutated in place, republished as the same object
    scene.setForeignOcclusion({ covered: reused, cols: COLS, rows: ROWS });
    await flush();
    expect(renders).toBe(baseline + 2);
    scene.destroy();
  });

  it("rejects a coverage buffer whose length does not match its dims", () => {
    const scene = makeScene(makeHost());
    scene.add(quad(0));
    scene.rerender();
    expect(() => scene.setForeignOcclusion({
      covered: new Uint8Array(COLS * ROWS - 1), cols: COLS, rows: ROWS,
    })).toThrow(TypeError);
    scene.destroy();
  });
});

describe("detail layer data-glyph-mesh-id", () => {
  it("tracks the mesh's live name, not the one it had when the layer was created", () => {
    const host = makeHost();
    const scene = makeScene(host);
    const mesh = scene.add(quad(0), { density: 2 });
    scene.rerender();
    expect(detailPres(host)[0]!.dataset.glyphMeshId).toBeUndefined();

    mesh.setTransform({ density: 2, id: "hud" });
    scene.rerender();
    expect(detailPres(host)[0]!.dataset.glyphMeshId).toBe("hud");

    mesh.setTransform({ density: 2, id: "hud2" });
    scene.rerender();
    expect(detailPres(host)[0]!.dataset.glyphMeshId).toBe("hud2");

    mesh.setTransform({ density: 2 });
    scene.rerender();
    expect(detailPres(host)[0]!.dataset.glyphMeshId).toBeUndefined();
    scene.destroy();
  });
});
