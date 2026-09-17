import { describe, expect, it } from "vitest";
import { renderGlyphDiagram } from "./render";
import type { GlyphGraph, GlyphGraphNodeShape } from "./types";

/**
 * Pins every 2D node shape's `box`-charset outline glyphs directly against
 * the approved shape catalogue (user review of a rendered candidate
 * catalogue, ~90 shapes) — independent of `paint.ts`'s own
 * `NODE_SHAPE_GLYPHS` table: this file hardcodes every expected glyph
 * rather than importing that table, so a future edit that silently drops
 * or reverts one shape's override still shows up here instead of both
 * sides drifting together. Every corner/rule/side is read off the exact
 * cell `layout.nodes[0]`'s own rectangle names, never a fixed offset, so
 * this stays correct across a label-width change.
 */
const SHAPE_OUTLINES: Readonly<Record<GlyphGraphNodeShape, {
  readonly corners: readonly [string, string, string, string]; // TL, TR, BL, BR
  readonly topRule: string;
  readonly bottomRule: string;
  readonly sideLeft: string;
  readonly sideRight: string;
}>> = {
  rect: { corners: ["┌", "┐", "└", "┘"], topRule: "─", bottomRule: "─", sideLeft: "│", sideRight: "│" },
  rounded: { corners: ["╭", "╮", "╰", "╯"], topRule: "─", bottomRule: "─", sideLeft: "│", sideRight: "│" },
  stadium: { corners: ["◜", "◝", "◟", "◞"], topRule: "─", bottomRule: "─", sideLeft: "│", sideRight: "│" },
  cylinder: { corners: ["◜", "◝", "◟", "◞"], topRule: "─", bottomRule: "─", sideLeft: "│", sideRight: "│" },
  circle: { corners: ["◜", "◝", "◟", "◞"], topRule: "◠", bottomRule: "◡", sideLeft: "│", sideRight: "│" },
  diamond: { corners: ["╭", "╮", "╰", "╯"], topRule: "─", bottomRule: "─", sideLeft: "│", sideRight: "│" },
  asymmetric: { corners: ["┌", "╲", "└", "╱"], topRule: "─", bottomRule: "─", sideLeft: "│", sideRight: "│" },
  subroutine: { corners: ["┌", "┐", "└", "┘"], topRule: "─", bottomRule: "─", sideLeft: "│", sideRight: "│" },
};

describe("box-charset node shape outlines match the approved catalogue", () => {
  for (const [shape, expected] of Object.entries(SHAPE_OUTLINES) as [GlyphGraphNodeShape, (typeof SHAPE_OUTLINES)[GlyphGraphNodeShape]][]) {
    it(`${shape} paints the catalogue's own corners, rules and sides`, async () => {
      const graph: GlyphGraph = { direction: "TB", nodes: [{ id: "n", label: "Node", shape }], edges: [] };
      const result = await renderGlyphDiagram(graph, { charset: "box", target: "chat", width: 30, height: 8 });
      const node = result.layout.nodes[0]!;
      const { x0, y0, x1, y1 } = node;
      const at = (x: number, y: number) => result.canvas.grid.char[y * result.canvas.grid.cols + x];
      expect([at(x0, y0), at(x1, y0), at(x0, y1), at(x1, y1)]).toEqual(expected.corners);
      for (let x = x0 + 1; x < x1; x++) { expect(at(x, y0)).toBe(expected.topRule); expect(at(x, y1)).toBe(expected.bottomRule); }
      for (let y = y0 + 1; y < y1; y++) { expect(at(x0, y)).toBe(expected.sideLeft); expect(at(x1, y)).toBe(expected.sideRight); }
      // `subroutine`'s nested inset frame sits one cell inside each side —
      // a separate mechanism from the outline table above (AGENTS.md's
      // own "Don't reuse a canvas" note aside, this is the one shape whose
      // border isn't fully described by `SHAPE_OUTLINES`).
      if (shape === "subroutine") for (let y = y0 + 1; y < y1; y++) { expect(at(x0 + 1, y)).toBe("│"); expect(at(x1 - 1, y)).toBe("│"); }
    });
  }

  // Mutation check (P2 loop discipline: "delete the property and confirm
  // something goes red"), performed by hand during authoring and recorded
  // here rather than automated, since there is no seam to swap the table
  // out from under `paint.ts` without exporting an internal it has no
  // other reason to export: removing `circle`'s `topRule: "◠", bottomRule:
  // "◡"` override in `paint.ts` (so it falls back to the plain default
  // `─`/`─`) reddens `circle paints the catalogue's own corners, rules and
  // sides` above at the `topRule`/`bottomRule` assertions — the corner
  // assertion alone would NOT have caught it, since `circle`'s corners are
  // unchanged by that override; verified by temporarily deleting the
  // override, running this file, observing the failure, and restoring it.
  it("circle's rule override is load-bearing (mutation-checked, see comment above)", async () => {
    const graph: GlyphGraph = { direction: "TB", nodes: [{ id: "n", label: "Node", shape: "circle" }], edges: [] };
    const result = await renderGlyphDiagram(graph, { charset: "box", target: "chat", width: 30, height: 8 });
    const node = result.layout.nodes[0]!;
    const at = (x: number, y: number) => result.canvas.grid.char[y * result.canvas.grid.cols + x];
    expect(at(node.x0 + 1, node.y0)).toBe("◠");
    expect(at(node.x0 + 1, node.y1)).toBe("◡");
    expect(at(node.x0 + 1, node.y0)).not.toBe("─");
  });

  it("ascii keeps its pre-existing 7-bit fallback per shape, unaffected by the box-charset catalogue above", async () => {
    const ascii: Readonly<Record<GlyphGraphNodeShape, readonly [string, string, string, string]>> = {
      rect: ["+", "+", "+", "+"], rounded: ["(", ")", "(", ")"], stadium: ["(", ")", "(", ")"],
      cylinder: ["+", "+", "+", "+"], circle: ["(", ")", "(", ")"], diamond: ["/", "\\", "\\", "/"],
      asymmetric: [">", "]", ">", "]"], subroutine: ["+", "+", "+", "+"],
    };
    for (const [shape, corners] of Object.entries(ascii) as [GlyphGraphNodeShape, readonly [string, string, string, string]][]) {
      const graph: GlyphGraph = { direction: "TB", nodes: [{ id: "n", label: "Node", shape }], edges: [] };
      const result = await renderGlyphDiagram(graph, { charset: "ascii", target: "chat", width: 30, height: 8 });
      const node = result.layout.nodes[0]!;
      const { x0, y0, x1, y1 } = node;
      const at = (x: number, y: number) => result.canvas.grid.char[y * result.canvas.grid.cols + x];
      expect([at(x0, y0), at(x1, y0), at(x0, y1), at(x1, y1)]).toEqual(corners);
    }
  });
});
