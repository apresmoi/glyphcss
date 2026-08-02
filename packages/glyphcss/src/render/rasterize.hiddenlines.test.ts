import { describe, it, expect, vi } from "vitest";
import { rasterize } from "./rasterize";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { getWireframeGlyphs } from "./ramps";
import type { GlyphCamera } from "../api/createGlyphCamera";
import type { WireframeEdge, Polygon } from "@glyphcss/core";

/**
 * `hiddenLines: "show" | "hide"` — public `RasterizeContextOptions` field,
 * threaded through `createGlyphScene`/`compileScene` and mirrored across the
 * React/Vue bindings and the `<glyph-scene>` custom element's `hidden-lines`
 * attribute. Fixes the wireframe path having no depth reference at all
 * (`drawLineToStamp` resolves ties by edge WEIGHT, not depth): a back edge
 * can paint over a front one, braille strokes bleed through each other, and
 * a darker `sideColor` edge can overwrite a brighter front-face color.
 *
 * A fake camera whose `project` passes `v` straight through (including `z`)
 * is used so edges land on exact integer/subcell coordinates AND camera-space
 * depth is directly authored via each vertex's `z` — this test is about the
 * depth-test/bias logic, not real camera projection math.
 */
function passthroughCamera(): GlyphCamera {
  return {
    project: (v: readonly [number, number, number]) => [v[0], v[1], v[2], 1],
  } as unknown as GlyphCamera;
}

const COLS = 12;
const ROWS = 12;

/** A flat quad surface at constant depth `z`, covering the whole `COLS × ROWS` grid. */
function surfaceQuad(z: number): Polygon {
  return {
    vertices: [
      [0, 0, z],
      [COLS, 0, z],
      [COLS, ROWS, z],
      [0, ROWS, z],
    ],
    color: "#888888",
  } as unknown as Polygon;
}

/**
 * HTML-aware cellAt: walks a rendered row, skipping `<span style="...">`/
 * `</span>` tags, and returns the glyph plus the currently-open span's color
 * (or `null` for a plain/blank cell) at output column `col`.
 */
function cellAt(output: string, col: number, row: number): { char: string; color: string | null } {
  const line = output.split("\n")[row]!;
  let i = 0, c = 0, color: string | null = null;
  while (i < line.length) {
    if (line[i] === "<") {
      const close = line.indexOf(">", i);
      const tag = line.slice(i, close + 1);
      if (tag.startsWith("<span")) {
        const m = tag.match(/color:(#[0-9a-fA-F]{6})/);
        color = m ? m[1]! : null;
      } else if (tag === "</span>") {
        color = null;
      }
      i = close + 1;
      continue;
    }
    if (c === col) return { char: line[i]!, color };
    c++;
    i++;
  }
  throw new Error(`column ${col} not found in row ${row} ("${line}")`);
}

describe("rasterize — wireframe hidden-line removal (hiddenLines)", () => {
  it("is off by default and byte-identical to the pre-existing weight-wins-ties stamp", () => {
    const base = {
      camera: passthroughCamera(),
      grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
      polygons: [surfaceQuad(1)],
      wireframe: [
        { from: [5, 5, 1], to: [5, 5, 1], weight: 2, color: "#00ff00" },
        { from: [5, 5, 0], to: [5, 5, 0], weight: 3, color: "#ff0000" },
      ] as WireframeEdge[],
      mode: "wireframe" as const,
      useColors: true,
    };
    // Per-cell glyph pick within a weight tier is itself randomized — pin it
    // so this comparison isolates the option's effect only.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const withoutOption = rasterize(buildRasterizeContext(base));
      const explicitlyShow = rasterize(buildRasterizeContext({ ...base, hiddenLines: "show" }));
      expect(explicitlyShow).toBe(withoutOption);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('"show" (today\'s behavior): a farther edge with higher weight paints over a nearer one — the reported bug', () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const ctx = buildRasterizeContext({
        camera: passthroughCamera(),
        grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
        polygons: [surfaceQuad(1)],
        // Front edge lies ON the surface (z=1); back edge is authored at z=0,
        // clearly behind it, but has a HIGHER weight, exactly like a darker
        // `sideColor` extrusion wall being thicker than the front contour.
        wireframe: [
          { from: [5, 5, 1], to: [5, 5, 1], weight: 2, color: "#00ff00" },
          { from: [5, 5, 0], to: [5, 5, 0], weight: 3, color: "#ff0000" },
        ],
        mode: "wireframe",
        useColors: true,
        hiddenLines: "show",
      });
      const out = rasterize(ctx);
      const cell = cellAt(out, 5, 5);
      const glyphs = getWireframeGlyphs("default");
      // Weight comparison alone decides the winner — the farther (z=0), higher
      // weight edge overwrites the nearer (z=1) one.
      expect(cell.color).toBe("#ff0000");
      expect(cell.char).toBe(glyphs.core[0]);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('"hide" depth-tests each stroke: the occluded back edge never touches the cell, so the front edge survives', () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const build = (hiddenLines: "show" | "hide") => buildRasterizeContext({
        camera: passthroughCamera(),
        grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
        polygons: [surfaceQuad(1)],
        wireframe: [
          { from: [5, 5, 1], to: [5, 5, 1], weight: 2, color: "#00ff00" },
          { from: [5, 5, 0], to: [5, 5, 0], weight: 3, color: "#ff0000" },
        ],
        mode: "wireframe",
        useColors: true,
        hiddenLines,
      });

      const hideOut = rasterize(build("hide"));
      const showOut = rasterize(build("show"));
      const glyphs = getWireframeGlyphs("default");

      // Ground truth: the front edge rendered alone (no competing back edge at
      // all) — `"hide"` must reproduce this exactly.
      const frontOnly = rasterize(buildRasterizeContext({
        camera: passthroughCamera(),
        grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
        wireframe: [{ from: [5, 5, 1], to: [5, 5, 1], weight: 2, color: "#00ff00" }],
        mode: "wireframe",
        useColors: true,
      }));

      const hideCell = cellAt(hideOut, 5, 5);
      expect(hideCell.color).toBe("#00ff00");
      expect(hideCell.char).toBe(glyphs.normal[0]);
      expect(hideOut).toBe(frontOnly);

      // Confirm "show" really did regress this cell (sanity — proven above too).
      expect(cellAt(showOut, 5, 5).color).toBe("#ff0000");
      expect(hideOut).not.toBe(showOut);
    } finally {
      randomSpy.mockRestore();
    }
  });

  it('"hide" leaves a stroke visible when there is no surface at that cell at all (nothing to occlude against)', () => {
    const ctx = buildRasterizeContext({
      camera: passthroughCamera(),
      grid: { cols: COLS, rows: ROWS, cellAspect: 2.0 },
      // No polygons at all: an empty surface prepass never hides anything.
      wireframe: [{ from: [3, 3, -50], to: [3, 3, -50], weight: 2, color: "#00ff00" }],
      mode: "wireframe",
      useColors: true,
      hiddenLines: "hide",
    });
    const out = rasterize(ctx);
    expect(cellAt(out, 3, 3).color).toBe("#00ff00");
  });
});

describe("rasterize — braille hidden-line removal (hiddenLines, charMode: \"braille\")", () => {
  const glyphCols = COLS, glyphRows = ROWS;

  function crossingEdges(): { front: WireframeEdge; back: WireframeEdge } {
    // Both diagonals land entirely inside output cell (col 5, row 5)'s 2×4
    // subcell block: subcol ∈ {10, 11}, subrow ∈ {20..23}.
    return {
      front: { from: [5.0, 5.0, 1], to: [5.9, 5.9, 1], weight: 2, color: "#00ff00" },
      back: { from: [5.9, 5.0, 0], to: [5.0, 5.9, 0], weight: 2, color: "#ff0000" },
    };
  }

  it("bleeds a farther crossing stroke's dots into the same braille glyph under \"show\"", () => {
    const { front, back } = crossingEdges();
    const frontOnly = rasterize(buildRasterizeContext({
      camera: passthroughCamera(),
      grid: { cols: glyphCols, rows: glyphRows, cellAspect: 2.0 },
      wireframe: [front],
      mode: "wireframe",
      charMode: "braille",
      useColors: false,
    }));
    const both = rasterize(buildRasterizeContext({
      camera: passthroughCamera(),
      grid: { cols: glyphCols, rows: glyphRows, cellAspect: 2.0 },
      polygons: [surfaceQuad(1)],
      wireframe: [front, back],
      mode: "wireframe",
      charMode: "braille",
      useColors: false,
      hiddenLines: "show",
    }));
    // The back stroke's dots bleed in — the combined glyph differs from the
    // front-only glyph even though the back stroke is behind the surface.
    expect(both).not.toBe(frontOnly);
  });

  it('"hide" suppresses the occluded crossing stroke\'s dots entirely, reproducing the front-only braille glyph', () => {
    const { front, back } = crossingEdges();
    const frontOnly = rasterize(buildRasterizeContext({
      camera: passthroughCamera(),
      grid: { cols: glyphCols, rows: glyphRows, cellAspect: 2.0 },
      wireframe: [front],
      mode: "wireframe",
      charMode: "braille",
      useColors: false,
    }));
    const hidden = rasterize(buildRasterizeContext({
      camera: passthroughCamera(),
      grid: { cols: glyphCols, rows: glyphRows, cellAspect: 2.0 },
      polygons: [surfaceQuad(1)],
      wireframe: [front, back],
      mode: "wireframe",
      charMode: "braille",
      useColors: false,
      hiddenLines: "hide",
    }));
    expect(hidden).toBe(frontOnly);
  });

  it("is off by default and byte-identical to the pre-existing braille path", () => {
    const { front, back } = crossingEdges();
    const base = {
      camera: passthroughCamera(),
      grid: { cols: glyphCols, rows: glyphRows, cellAspect: 2.0 },
      polygons: [surfaceQuad(1)],
      wireframe: [front, back],
      mode: "wireframe" as const,
      charMode: "braille" as const,
      useColors: false,
    };
    const withoutOption = rasterize(buildRasterizeContext(base));
    const explicitlyShow = rasterize(buildRasterizeContext({ ...base, hiddenLines: "show" }));
    expect(explicitlyShow).toBe(withoutOption);
  });
});
