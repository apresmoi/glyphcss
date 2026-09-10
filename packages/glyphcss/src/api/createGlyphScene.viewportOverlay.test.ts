/**
 * Meshless, viewport-wide overlay outputs (`GlyphSceneHandle
 * .setViewportOverlayDensities`) — the per-output-grid escape hatch a
 * `line`/`contour` stroke layer in `@glyphcss/maps` uses to get its own
 * independent resolution, decoupled from every mesh's `density`. See
 * AGENTS.md's "Per-mesh detail layers" and `packages/maps/src/widget.ts`'s
 * `strokeLayerStampsIntoGrid` for the consumer.
 */
import { describe, it, expect, afterEach } from "vitest";
import { createGlyphScene, type GlyphTransformCellsLayer } from "./createGlyphScene";
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

function makeScene(host: HTMLElement, extra: Record<string, unknown> = {}) {
  return createGlyphScene(host, {
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 160 }),
    cols: COLS, rows: ROWS, cellAspect: 2,
    mode: "solid", useColors: false, doubleSided: true,
    ...FLAT,
    ...extra,
  });
}

describe("viewport overlay — zero-cost default (NON-NEGOTIABLE)", () => {
  it("never calling setViewportOverlayDensities: byte-identical output, no overlay <pre>, no DOM change", () => {
    const hostA = makeHost();
    const sceneA = makeScene(hostA);
    sceneA.add(quad(0));
    sceneA.rerender();
    const textA = sceneA.output.textContent;
    const siblingCountA = sceneA.output.parentElement!.children.length;

    const hostB = makeHost();
    const sceneB = makeScene(hostB);
    sceneB.add(quad(0));
    sceneB.rerender();

    expect(sceneB.output.textContent).toBe(textA);
    expect(sceneB.output.parentElement!.children.length).toBe(siblingCountA);
    expect(hostB.querySelectorAll("pre[data-glyph-overlay-density]").length).toBe(0);
    sceneA.destroy();
    sceneB.destroy();
  });

  it("setViewportOverlayDensities([]) and setViewportOverlayDensities([1]) are both no-ops — byte-identical, no overlay <pre>", () => {
    const hostA = makeHost();
    const sceneA = makeScene(hostA);
    sceneA.add(quad(0));
    sceneA.rerender();
    const textA = sceneA.output.textContent;

    const hostB = makeHost();
    const sceneB = makeScene(hostB);
    sceneB.add(quad(0));
    sceneB.setViewportOverlayDensities([]);
    sceneB.rerender();
    expect(sceneB.output.textContent).toBe(textA);
    expect(hostB.querySelectorAll("pre[data-glyph-overlay-density]").length).toBe(0);

    const hostC = makeHost();
    const sceneC = makeScene(hostC);
    sceneC.add(quad(0));
    sceneC.setViewportOverlayDensities([1]); // density 1 is the existing base output
    sceneC.rerender();
    expect(sceneC.output.textContent).toBe(textA);
    expect(hostC.querySelectorAll("pre[data-glyph-overlay-density]").length).toBe(0);

    sceneA.destroy();
    sceneB.destroy();
    sceneC.destroy();
  });
});

describe("viewport overlay — creation, resolution, and layer tag", () => {
  it("setViewportOverlayDensities([3]) creates one overlay <pre> at 3x resolution, tagged { detail: true, viewport: true }, with the correct cellToSceneGrid affine", () => {
    const host = makeHost();
    let seenLayer: GlyphTransformCellsLayer | undefined;
    const scene = makeScene(host, {
      transformCells: (grid: unknown, layer?: GlyphTransformCellsLayer) => {
        if (layer?.viewport) seenLayer = layer;
        return grid;
      },
    });
    scene.add(quad(0));
    scene.setViewportOverlayDensities([3]);
    scene.rerender();

    const overlay = host.querySelector("pre[data-glyph-overlay-density='3']") as HTMLPreElement | null;
    expect(overlay).not.toBeNull();
    const rows = (overlay!.textContent ?? "").split("\n");
    expect(rows).toHaveLength(ROWS * 3);
    expect(rows[0]).toHaveLength(COLS * 3);

    expect(seenLayer).toEqual({
      detail: true,
      viewport: true,
      cellToSceneGrid: [1 / 3, 0, 0, 1 / 3, 0, 0],
      density: 3,
    });
    scene.destroy();
  });

  it("dedupes values, ignores density 1, and an empty list removes every overlay", () => {
    const host = makeHost();
    const scene = makeScene(host);
    scene.add(quad(0));
    scene.setViewportOverlayDensities([3, 3, 1, 5, 3]);
    scene.rerender();
    expect(host.querySelectorAll("pre[data-glyph-overlay-density]").length).toBe(2);
    expect(host.querySelector("pre[data-glyph-overlay-density='3']")).not.toBeNull();
    expect(host.querySelector("pre[data-glyph-overlay-density='5']")).not.toBeNull();

    scene.setViewportOverlayDensities([]);
    scene.rerender();
    expect(host.querySelectorAll("pre[data-glyph-overlay-density]").length).toBe(0);
    scene.destroy();
  });
});

describe("viewport overlay — occlusion (the reason it needs its own depth pass)", () => {
  it("overlay depth reflects the NEARER of a base mesh and an opaque detail mesh mounted at a DIFFERENT density", () => {
    const host = makeHost();
    let centerDepth = -Infinity;
    let cornerDepth = -Infinity;
    const scene = makeScene(host, {
      transformCells: (grid: { cols: number; rows: number; depth: Float64Array }, layer?: GlyphTransformCellsLayer) => {
        if (layer?.viewport) {
          const cc = Math.floor(grid.cols / 2), cr = Math.floor(grid.rows / 2);
          centerDepth = grid.depth[cr * grid.cols + cc]!;
          cornerDepth = grid.depth[1 * grid.cols + 1]!;
        }
        return grid;
      },
    });
    // A big flat base plane at z=0, covering the whole grid.
    scene.add(quad(0, -10, 10, -10, 10));
    // A small, NEARER opaque mesh at the grid's centre, rendered at its own
    // density (2) — a separate <pre>, not part of `allPolygons`.
    scene.add(quad(5, -0.5, 0.5, -0.5, 0.5), { density: 2 });
    scene.setViewportOverlayDensities([4]);
    scene.rerender();

    expect(Number.isFinite(centerDepth)).toBe(true);
    expect(Number.isFinite(cornerDepth)).toBe(true);
    // Larger depth = nearer (rasterize.ts's convention): the opaque detail
    // mesh at z=5 must win over the base plane at z=0 in the overlay's OWN
    // depth pass, proving it pulls in opaque detail-mesh geometry too.
    expect(centerDepth).toBeGreaterThan(cornerDepth);
    scene.destroy();
  });

  it("a farther stroke written by transformCells into the overlay is depth-occluded by a nearer opaque mesh", () => {
    const host = makeHost();
    const scene = makeScene(host, {
      transformCells: (grid: { cols: number; rows: number; depth: Float64Array; char: string[] }, layer?: GlyphTransformCellsLayer) => {
        if (!layer?.viewport) return grid;
        const cc = Math.floor(grid.cols / 2), cr = Math.floor(grid.rows / 2);
        // A "stroke" resting at the base plane's own depth (z=0, matching
        // the mesh below) — real stroke code (`stampGlyphMapPolyline`)
        // computes this from an actual projected vertex; here it's just the
        // base plane's own recorded depth at a FAR corner as a stand-in "on
        // the surface" value.
        const strokeDepth = grid.depth[1 * grid.cols + 1]!; // the base plane's own depth
        for (const [r, c] of [[cr, cc], [1, 1]] as const) {
          const idx = r * grid.cols + c;
          // Same test `stroke.ts`'s `stampGlyphMapPolyline` runs: occluded
          // when something at this cell is nearer than the stroke by more
          // than a small bias.
          if (grid.depth[idx]! - strokeDepth <= 0.03) grid.char[idx] = "#"; // not occluded here → draw
        }
        return grid;
      },
    });
    scene.add(quad(0, -10, 10, -10, 10));
    scene.add(quad(5, -0.5, 0.5, -0.5, 0.5), { density: 2 }); // nearer, occludes the centre
    scene.setViewportOverlayDensities([4]);
    scene.rerender();

    const overlay = host.querySelector("pre[data-glyph-overlay-density='4']") as HTMLPreElement;
    const rows = (overlay.textContent ?? "").split("\n");
    const cc = Math.floor(COLS * 4 / 2), cr = Math.floor(ROWS * 4 / 2);
    expect(rows[cr]?.[cc]).toBe(" "); // occluded by the nearer opaque detail mesh
    expect(rows[1]?.[1]).toBe("#");   // the far corner is not occluded
    scene.destroy();
  });

  it("REGRESSION: the overlay's depth pass is projected at exactly `density`× the base grid's own resolution — a mesh's covered column SPAN scales by `density`, not merely its POSITION", () => {
    // A narrow vertical strip (in world cols) spanning the full row range —
    // its covered-column span at the base grid's own resolution is the
    // reference this test scales by `density` and checks the overlay
    // against. This is the exact shape of the regression this guards: an
    // earlier version scaled `centerCol`/`centerRow` by `density` but left
    // `cellWidth`/`cellHeight` at the BASE grid's own (here: unmeasured →
    // `BASE_TILE / cellAspect` fallback) value, which re-centers correctly
    // but leaves the covered SPAN the same absolute width as the base
    // grid's — i.e. `density`× too narrow — rather than scaling both
    // together the way a real `density`× finer grid must.
    const host = makeHost();
    const strip = quad(0, -8, 8, -0.3, 0.3);

    const baseScene = makeScene(makeHost());
    baseScene.add(strip);
    baseScene.rerender();
    const baseRow = (baseScene.output.textContent ?? "").split("\n")[ROWS >> 1] ?? "";
    let c0 = -1, c1 = -1;
    for (let c = 0; c < baseRow.length; c++) {
      if (baseRow[c] !== " ") { if (c0 === -1) c0 = c; c1 = c; }
    }
    expect(c0).toBeGreaterThanOrEqual(0); // sanity: the strip actually covers something
    const baseSpan = c1 - c0 + 1;
    baseScene.destroy();

    const density = 4;
    let overlayC0 = -1, overlayC1 = -1;
    const scene = makeScene(host, {
      transformCells: (grid: { cols: number; rows: number; depth: Float64Array }, layer?: GlyphTransformCellsLayer) => {
        if (!layer?.viewport) return grid;
        const row = (ROWS >> 1) * density;
        for (let c = 0; c < grid.cols; c++) {
          if (Number.isFinite(grid.depth[row * grid.cols + c])) {
            if (overlayC0 === -1) overlayC0 = c;
            overlayC1 = c;
          }
        }
        return grid;
      },
    });
    scene.add(strip);
    scene.setViewportOverlayDensities([density]);
    scene.rerender();

    expect(overlayC0).toBeGreaterThanOrEqual(0); // sanity: the overlay saw coverage at all
    const overlaySpan = overlayC1 - overlayC0 + 1;
    // Exact multiple, not "same absolute width regardless of density" (the
    // bug) and not "roughly density× on average" — a tight tolerance for
    // rounding at the strip's own two edges (at most ~1 base cell of slack
    // per edge, i.e. `density` output cells per edge).
    expect(overlaySpan).toBeGreaterThanOrEqual(baseSpan * density - 2 * density);
    expect(overlaySpan).toBeLessThanOrEqual(baseSpan * density + 2 * density);
    // The specific regression's signature: covered width stayed within one
    // `density` factor of the UNSCALED base span instead of scaling by it.
    expect(overlaySpan).toBeGreaterThan(baseSpan * (density - 1));
    scene.destroy();
  });
});
