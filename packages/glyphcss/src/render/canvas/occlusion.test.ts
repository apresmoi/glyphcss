import { describe, expect, it } from "vitest";
import { createGlyphCanvas } from "./canvas";

/**
 * Every painter must refuse a cell whose `grid.occluded` byte is `1` — the
 * same ownership rule a scene's cross-layer occlusion id-map already
 * expresses on `CellGrid` (see AGENTS.md's "Post-rasterize cell hook").
 * Each test here individually removes its own painter's guard in spirit —
 * the assertion is the guard itself, so dropping the corresponding `if
 * (isOccludedCell(...)) continue/return` in `canvas.ts` reddens exactly one
 * of these four. `fillRect`'s test additionally protects `bg`/`sub` — the
 * two buffers `CellGrid` itself has no field for — since those are written
 * in the SAME loop body and a guard removed there would leak into them too.
 */
describe("cell canvas: occlusion refusal", () => {
  it("fillRect refuses an occluded cell (char, color, bg, and sub)", () => {
    const canvas = createGlyphCanvas({ cols: 4, rows: 4, tier: "blocks" });
    canvas.grid.occluded = new Uint8Array(16);
    canvas.grid.occluded[1 * 4 + 1] = 1;
    canvas.fillRect(0, 0, 3, 3, { fill: { shade: 0.5 }, color: "#ff0000", bg: "#0000ff" });
    const occludedIdx = 1 * 4 + 1;
    expect(canvas.grid.char[occludedIdx]).toBe(" ");
    expect(canvas.grid.color[occludedIdx]).toBe(null);
    expect(canvas.bg[occludedIdx]).toBe(null);
    expect(canvas.sub[occludedIdx]).toBe(0);
    // A non-occluded neighbour in the same rect DOES get painted, proving
    // the guard is cell-specific, not a whole-call bail-out.
    expect(canvas.grid.char[0]).not.toBe(" ");
    expect(canvas.bg[0]).toBe("#0000ff");
    expect(canvas.sub[0]).not.toBe(0);
  });

  it("line refuses an occluded cell", () => {
    const canvas = createGlyphCanvas({ cols: 6, rows: 4, tier: "box" });
    canvas.grid.occluded = new Uint8Array(24);
    canvas.grid.occluded[0 * 6 + 3] = 1;
    canvas.line({ x: 0, y: 0 }, { x: 5, y: 0 }, { color: "#00ff00" });
    expect(canvas.grid.char[0 * 6 + 3]).toBe(" ");
    expect(canvas.grid.char[0 * 6 + 0]).not.toBe(" ");
    expect(canvas.grid.char[0 * 6 + 5]).not.toBe(" ");
  });

  it("text refuses an occluded cell", () => {
    const canvas = createGlyphCanvas({ cols: 6, rows: 4, tier: "box" });
    canvas.grid.occluded = new Uint8Array(24);
    canvas.grid.occluded[0 * 6 + 1] = 1;
    canvas.text(0, 0, ["abcde"], { color: "#333333" });
    expect(canvas.grid.char[0 * 6 + 1]).toBe(" ");
    expect(canvas.grid.char[0 * 6 + 0]).toBe("a");
    expect(canvas.grid.char[0 * 6 + 2]).toBe("c");
  });

  it("arrowhead refuses an occluded cell", () => {
    const canvas = createGlyphCanvas({ cols: 4, rows: 4, tier: "box" });
    canvas.grid.occluded = new Uint8Array(16);
    canvas.grid.occluded[1 * 4 + 1] = 1;
    canvas.arrowhead(1, 1, "n");
    expect(canvas.grid.char[1 * 4 + 1]).toBe(" ");
  });

  it("resolveJunctions refuses an occluded cell", () => {
    const canvas = createGlyphCanvas({ cols: 5, rows: 5, tier: "box" });
    canvas.grid.occluded = new Uint8Array(25);
    canvas.grid.occluded[2 * 5 + 2] = 1;
    canvas.edge("a", { from: "a0", to: "a1" });
    canvas.edge("b", { from: "b0", to: "b1" });
    canvas.route("a", [{ x: 2, y: 2 }, { x: 2, y: 1 }]);
    canvas.route("b", [{ x: 2, y: 2 }, { x: 3, y: 2 }]);
    canvas.resolveJunctions();
    expect(canvas.grid.char[2 * 5 + 2]).toBe(" ");
  });
});
