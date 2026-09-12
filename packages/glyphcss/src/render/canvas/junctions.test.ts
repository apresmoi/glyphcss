import { describe, expect, it } from "vitest";
import { createGlyphCanvas } from "./canvas";
import { GLYPH_CANVAS_TIERS } from "./tiers";

const IDX = (cols: number, x: number, y: number) => y * cols + x;

/** Turn a list of `[x, y]` pairs into the `{x, y}[]` shape `canvas.route()`
 * expects. */
function pts(coords: readonly (readonly [number, number])[]): { x: number; y: number }[] {
  return coords.map(([x, y]) => ({ x, y }));
}

describe("route() requires edge() registration first", () => {
  it("throws a RangeError naming the edge when route() is called before edge()", () => {
    const canvas = createGlyphCanvas({ cols: 5, rows: 5, tier: "box" });
    expect(() => canvas.route("unregistered", pts([[2, 2], [3, 2]]))).toThrow(RangeError);
    expect(() => canvas.route("unregistered", pts([[2, 2], [3, 2]]))).toThrow(/unregistered/);
  });
});

describe("route() validates cell adjacency", () => {
  it("throws a RangeError when consecutive cells are not 4-adjacent (a gap)", () => {
    const canvas = createGlyphCanvas({ cols: 6, rows: 6, tier: "box" });
    canvas.edge("a", { from: "a0", to: "a1" });
    expect(() => canvas.route("a", pts([[0, 0], [2, 0]]))).toThrow(RangeError);
  });

  it("throws a RangeError when consecutive cells are diagonal, not orthogonal", () => {
    const canvas = createGlyphCanvas({ cols: 6, rows: 6, tier: "box" });
    canvas.edge("a", { from: "a0", to: "a1" });
    expect(() => canvas.route("a", pts([[0, 0], [1, 1]]))).toThrow(RangeError);
  });

  it("throws for an unregistered edge before ever checking adjacency", () => {
    const canvas = createGlyphCanvas({ cols: 6, rows: 6, tier: "box" });
    expect(() => canvas.route("ghost", pts([[0, 0], [5, 5]]))).toThrow(/ghost/);
  });
});

describe("resolveGlyphCanvasJunctions: real joins via a shared hub", () => {
  it("three edges leaving one hub cell (a real T) resolve to the tee glyph", () => {
    const canvas = createGlyphCanvas({ cols: 5, rows: 5, tier: "box" });
    canvas.edge("edgeA", { from: "hub", to: "a1" });
    canvas.edge("edgeB", { from: "hub", to: "b1" });
    canvas.edge("edgeC", { from: "hub", to: "c1" });
    canvas.route("edgeA", pts([[2, 2], [3, 2], [4, 2]])); // east
    canvas.route("edgeB", pts([[2, 2], [2, 3], [2, 4]])); // south
    canvas.route("edgeC", pts([[2, 2], [1, 2], [0, 2]])); // west
    canvas.resolveJunctions();
    expect(canvas.grid.char[IDX(5, 2, 2)]).toBe("┬");
    expect(canvas.report.routeConflicts).toHaveLength(0);
  });

  it("four edges leaving one hub cell (a real 4-way join) resolve to the cross glyph", () => {
    const canvas = createGlyphCanvas({ cols: 5, rows: 5, tier: "box" });
    canvas.edge("edgeA", { from: "hub", to: "a1" });
    canvas.edge("edgeB", { from: "hub", to: "b1" });
    canvas.edge("edgeC", { from: "hub", to: "c1" });
    canvas.edge("edgeD", { from: "hub", to: "d1" });
    canvas.route("edgeA", pts([[2, 2], [2, 1]])); // north
    canvas.route("edgeB", pts([[2, 2], [3, 2]])); // east
    canvas.route("edgeC", pts([[2, 2], [2, 3]])); // south
    canvas.route("edgeD", pts([[2, 2], [1, 2]])); // west
    canvas.resolveJunctions();
    expect(canvas.grid.char[IDX(5, 2, 2)]).toBe("┼");
    expect(canvas.report.routeConflicts).toHaveLength(0);
  });
});

describe("resolveGlyphCanvasJunctions: crossings (no shared node)", () => {
  it("two unrelated straight transits never produce a join glyph, and the winner's own axis carries the hop", () => {
    const canvas = createGlyphCanvas({ cols: 5, rows: 5, tier: "box" });
    canvas.edge("horizontal", { from: "h-start", to: "h-end" });
    canvas.edge("vertical", { from: "v-start", to: "v-end" });
    canvas.route("horizontal", pts([[1, 2], [2, 2], [3, 2]]));
    canvas.route("vertical", pts([[2, 1], [2, 2], [2, 3]]));
    canvas.resolveJunctions();
    const glyph = canvas.grid.char[IDX(5, 2, 2)];
    expect(glyph).not.toBe("┼");
    expect(glyph).not.toBe("+");
    // "horizontal" registered first = higher priority = WINNER, on ITS OWN
    // axis — never the loser's, which would read as a hole punched through
    // the winner's own line.
    expect(glyph).toBe(GLYPH_CANVAS_TIERS.box.hop.h);
    expect(canvas.report.routeConflicts).toHaveLength(0);
  });

  it("priority is registration order: the earlier-registered edge wins the crossing", () => {
    const first = createGlyphCanvas({ cols: 5, rows: 5, tier: "box" });
    first.edge("vertical", { from: "v-start", to: "v-end" });
    first.edge("horizontal", { from: "h-start", to: "h-end" });
    first.route("vertical", pts([[2, 1], [2, 2], [2, 3]]));
    first.route("horizontal", pts([[1, 2], [2, 2], [3, 2]]));
    first.resolveJunctions();
    // "vertical" registered first now, so it wins and the hop is
    // vertical-oriented — the opposite of the earlier test, confirming the
    // outcome tracks CALL ORDER, not the edgeId string or the mask value.
    expect(first.grid.char[IDX(5, 2, 2)]).toBe(GLYPH_CANVAS_TIERS.box.hop.v);
  });

  it("an explicit higher priority overrides registration order", () => {
    const canvas = createGlyphCanvas({ cols: 5, rows: 5, tier: "box" });
    canvas.edge("horizontal", { from: "h-start", to: "h-end", priority: 0 });
    canvas.edge("vertical", { from: "v-start", to: "v-end", priority: 10 });
    canvas.route("horizontal", pts([[1, 2], [2, 2], [3, 2]]));
    canvas.route("vertical", pts([[2, 1], [2, 2], [2, 3]]));
    canvas.resolveJunctions();
    expect(canvas.grid.char[IDX(5, 2, 2)]).toBe(GLYPH_CANVAS_TIERS.box.hop.v);
  });
});

describe("resolveGlyphCanvasJunctions: route coincidence, not node identity — the round-2 fix", () => {
  it("MUTATION CAUGHT (union masks for any shared node -> red): two siblings out of the SAME hub, whose legs cross far from it, draw a hop at the crossing, never ┼, and log no conflict", () => {
    // Opus round-2's repro: A and B both leave "hub" but the routes only
    // coincide AT the hub itself — by the time their legs cross seven-plus
    // cells away, the two paths have long since diverged. A resolver that
    // joins on "these two edges share a `from`/`to` string SOMEWHERE" (the
    // round-1 defect) draws a false ┼ at the distant crossing; this one only
    // joins where the routes actually coincide back to the shared node.
    const canvas = createGlyphCanvas({ cols: 10, rows: 10, tier: "box" });
    canvas.edge("A", { from: "hub", to: "a-end" });
    canvas.edge("B", { from: "hub", to: "b-end" });
    canvas.route("A", pts([
      [2, 2], [2, 3], [2, 4], [2, 5], [2, 6],
      [3, 6], [4, 6], [5, 6], [6, 6], [7, 6], [8, 6],
      [8, 5], [8, 4], [8, 3], [8, 2],
    ]));
    canvas.route("B", pts([
      [2, 2], [3, 2], [4, 2], [5, 2],
      [5, 3], [5, 4], [5, 5], [5, 6], [5, 7], [5, 8], [5, 9],
    ]));
    canvas.resolveJunctions();
    // The crossing cell: A's horizontal leg (row 6) meets B's vertical leg
    // (column 5) at (5, 6) — nowhere near "hub" at (2, 2).
    const crossing = canvas.grid.char[IDX(10, 5, 6)];
    expect(crossing).not.toBe("┼");
    expect(crossing).toBe(GLYPH_CANVAS_TIERS.box.hop.h);
    expect(canvas.report.routeConflicts).toHaveLength(0);
  });

  it("a merge into a common target renders the tee/cross glyph at the merge point, not only at the literal endpoint", () => {
    const canvas = createGlyphCanvas({ cols: 8, rows: 8, tier: "box" });
    canvas.edge("A", { from: "srcA", to: "sink" });
    canvas.edge("B", { from: "srcB", to: "sink" });
    // Both approach (4, 3) from opposite sides, then share the SAME trunk
    // (4,3)->(5,3)->(6,3) into "sink".
    canvas.route("A", pts([[4, 1], [4, 2], [4, 3], [5, 3], [6, 3]]));
    canvas.route("B", pts([[4, 5], [4, 4], [4, 3], [5, 3], [6, 3]]));
    canvas.resolveJunctions();
    // At the merge point, A arrives from the north and B from the south;
    // both then continue east together — a real 3-way join (├).
    expect(canvas.grid.char[IDX(8, 4, 3)]).toBe("├");
    // Along the coincident shared trunk, both edges agree on every cell, so
    // there is nothing to log — this is one continuous line, not a crossing.
    expect(canvas.report.routeConflicts).toHaveLength(0);
  });

  it("a fan-out from a common source renders the tee/cross glyph at the split point", () => {
    const canvas = createGlyphCanvas({ cols: 8, rows: 8, tier: "box" });
    canvas.edge("A", { from: "hub2", to: "endA" });
    canvas.edge("B", { from: "hub2", to: "endB" });
    // Both leave "hub2" along the SAME trunk, then split at (4, 3): A turns
    // north, B turns south.
    canvas.route("A", pts([[2, 3], [3, 3], [4, 3], [4, 2], [4, 1]]));
    canvas.route("B", pts([[2, 3], [3, 3], [4, 3], [4, 4], [4, 5]]));
    canvas.resolveJunctions();
    expect(canvas.grid.char[IDX(8, 4, 3)]).toBe("┤");
    expect(canvas.report.routeConflicts).toHaveLength(0);
  });

  it("MUTATION CAUGHT: a transitive chain A->B, B->C, C->D sharing only ADJACENT node names (never a common node) is a route conflict, not a join", () => {
    // The round-1 defect: A.to === B.from === "n2" and B.to === C.from ===
    // "n3" used to transitively union ALL THREE into one component via
    // plain string equality, with no regard for whether the cell in
    // question is actually where "n2"/"n3" physically sit for both sides.
    // Here none of the three pairs' walks back to their nominally shared
    // node actually coincide, so none of them may join — however many
    // node-id strings line up on paper.
    const canvas = createGlyphCanvas({ cols: 10, rows: 10, tier: "box" });
    canvas.edge("AB", { from: "n1", to: "n2" });
    canvas.edge("BC", { from: "n2", to: "n3" });
    canvas.edge("CD", { from: "n3", to: "n4" });
    canvas.route("AB", pts([[2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5]]));
    canvas.route("BC", pts([[5, 2], [5, 3], [5, 4], [5, 5], [5, 6], [5, 7], [5, 8]]));
    canvas.route("CD", pts([[6, 8], [6, 7], [6, 6], [6, 5], [5, 5]]));
    canvas.resolveJunctions();
    const glyph = canvas.grid.char[IDX(10, 5, 5)];
    expect(glyph).not.toBe("┼");
    expect(glyph).not.toBe("+");
    // AB (registered first) is a plain straight transit here, so it wins
    // and is upgraded to its own dashed hop — the contested-crossing rule,
    // never a false join.
    expect(glyph).toBe(GLYPH_CANVAS_TIERS.box.hop.h);
    expect(canvas.report.routeConflicts).toContainEqual({
      edgeIds: ["AB", "BC", "CD"],
      col: 5,
      row: 5,
      kind: "multi",
    });
  });

  it("MUTATION CAUGHT (skip the axis check -> red): two coincident same-axis transits are a route conflict, never a classic (perpendicular) crossing", () => {
    const canvas = createGlyphCanvas({ cols: 7, rows: 1, tier: "box" });
    canvas.edge("p1", { from: "p1-a", to: "p1-b" });
    canvas.edge("p2", { from: "p2-a", to: "p2-b" });
    canvas.route("p1", pts([[1, 0], [2, 0], [3, 0], [4, 0], [5, 0]]));
    canvas.route("p2", pts([[2, 0], [3, 0], [4, 0]]));
    canvas.resolveJunctions();
    // Both are E|W straight transits at (3, 0) — the SAME axis, not
    // perpendicular, so this is never the routine "wires cross in open
    // space" shape: it's two routes physically coincident without ever
    // sharing a node, which is exactly what a router avoiding overlaps
    // needs to be told about.
    expect(canvas.grid.char[IDX(7, 3, 0)]).toBe(GLYPH_CANVAS_TIERS.box.hop.h);
    expect(canvas.report.routeConflicts).toContainEqual({
      edgeIds: ["p1", "p2"],
      col: 3,
      row: 0,
      kind: "parallel",
    });
  });
});

describe("resolveGlyphCanvasJunctions: route conflict kinds", () => {
  it("an unrelated stub meeting a straight transit is a \"corner\"-kind conflict, and the winner's hop carries no false join", () => {
    const canvas = createGlyphCanvas({ cols: 5, rows: 5, tier: "box" });
    canvas.edge("ew", { from: "ew-a", to: "ew-b" });
    canvas.edge("n", { from: "n-a", to: "n-b" });
    canvas.route("ew", pts([[1, 2], [2, 2], [3, 2]]));
    canvas.route("n", pts([[2, 2], [2, 1]]));
    canvas.resolveJunctions();
    const glyph = canvas.grid.char[IDX(5, 2, 2)];
    expect(glyph).not.toBe("┴");
    expect(glyph).not.toBe("┼");
    expect(glyph).toBe(GLYPH_CANVAS_TIERS.box.hop.h);
    expect(canvas.report.routeConflicts).toEqual([
      { edgeIds: ["ew", "n"], col: 2, row: 2, kind: "corner" },
    ]);
  });

  it("three mutually unrelated groups at one cell is a \"multi\"-kind conflict, never ┼", () => {
    const canvas = createGlyphCanvas({ cols: 5, rows: 5, tier: "box" });
    canvas.edge("ew", { from: "ew-a", to: "ew-b" });
    canvas.edge("ns", { from: "ns-a", to: "ns-b" });
    canvas.edge("e", { from: "e-a", to: "e-b" });
    canvas.route("ew", pts([[1, 2], [2, 2], [3, 2]]));
    canvas.route("ns", pts([[2, 1], [2, 2], [2, 3]]));
    canvas.route("e", pts([[2, 2], [3, 2]]));
    canvas.resolveJunctions();
    const glyph = canvas.grid.char[IDX(5, 2, 2)];
    expect(glyph).not.toBe("┼");
    expect(glyph).not.toBe("+");
    expect(glyph).toBe(GLYPH_CANVAS_TIERS.box.hop.h);
    // "e"'s single step necessarily reuses one of (2,2)'s four neighbour
    // cells — already claimed by "ew" or "ns" — so it also logs its own
    // incidental two-edge conflict there; the cell under test is (2, 2).
    expect(canvas.report.routeConflicts).toContainEqual(
      { edgeIds: ["ew", "ns", "e"], col: 2, row: 2, kind: "multi" },
    );
  });

  it("a winning corner survives an unrelated crossing transit unchanged — never destroyed into a hop", () => {
    const canvas = createGlyphCanvas({ cols: 5, rows: 5, tier: "box" });
    // "corner" registers FIRST (outranks "ew" by registration order) and its
    // own mask (N|E) is a turn, not a plain straight transit, so
    // `resolveOwnGlyph` renders its ordinary corner glyph — a hop would
    // destroy the turn's shape.
    canvas.edge("corner", { from: "corner-a", to: "corner-b" });
    canvas.edge("ew", { from: "ew-a", to: "ew-b" });
    canvas.route("corner", pts([[2, 1], [2, 2], [3, 2]]));
    canvas.route("ew", pts([[1, 2], [2, 2], [3, 2]]));
    canvas.resolveJunctions();
    expect(canvas.grid.char[IDX(5, 2, 2)]).toBe("└");
    // Both routes' east leg necessarily shares cell (3, 2) too (there is
    // only one cell east of (2, 2)), logging its own incidental conflict
    // there; the cell under test is (2, 2).
    expect(canvas.report.routeConflicts).toContainEqual(
      { edgeIds: ["corner", "ew"], col: 2, row: 2, kind: "corner" },
    );
  });

  it("a third unrelated corner doesn't change the winner's glyph, and all three are logged as \"multi\"", () => {
    const canvas = createGlyphCanvas({ cols: 5, rows: 5, tier: "box" });
    canvas.edge("ew", { from: "ew-a", to: "ew-b" });
    canvas.edge("ns", { from: "ns-a", to: "ns-b" });
    canvas.edge("ne", { from: "ne-a", to: "ne-b" });
    canvas.route("ew", pts([[1, 2], [2, 2], [3, 2]]));
    canvas.route("ns", pts([[2, 1], [2, 2], [2, 3]]));
    canvas.route("ne", pts([[2, 1], [2, 2], [3, 2]]));
    canvas.resolveJunctions();
    expect(canvas.grid.char[IDX(5, 2, 2)]).toBe(GLYPH_CANVAS_TIERS.box.hop.h);
    // "ne"'s two neighbour cells are each already claimed by "ns" or "ew",
    // logging two more incidental two-edge conflicts elsewhere; the cell
    // under test is (2, 2).
    expect(canvas.report.routeConflicts).toContainEqual(
      { edgeIds: ["ew", "ns", "ne"], col: 2, row: 2, kind: "multi" },
    );
  });
});
