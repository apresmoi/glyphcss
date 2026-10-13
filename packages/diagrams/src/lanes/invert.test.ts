import { describe, expect, it } from "vitest";
import { glyphLaneOutsideParents, invertGlyphLaneDag } from "./invert";
import { layoutGlyphLaneRows } from "./layout";
import type { GlyphLaneDag } from "./types";

const FORK: GlyphLaneDag = {
  nodes: [
    { id: "join", label: "join", parents: ["l", "r"] },
    { id: "r", label: "r", parents: ["root"], marks: ["m"] },
    { id: "l", label: "l", parents: ["root"] },
    { id: "root", label: "root", parents: [] },
  ],
};

describe("invertGlyphLaneDag", () => {
  it("reverses nodes and replaces each node's parents with its children, in reversed-array order", () => {
    // Mutation: collect children walking the original (newest-first) order -> root's children come out [r, l] -> red.
    const { dag } = invertGlyphLaneDag(FORK);
    expect(dag.nodes.map((n) => n.id)).toEqual(["root", "l", "r", "join"]);
    expect(dag.nodes.map((n) => n.parents)).toEqual([["l", "r"], ["join"], ["join"], []]);
    expect(dag.nodes[2]!.marks).toEqual(["m"]);
  });

  it("produces a DAG whose every parent occurs later, so the shared layout reads a fork as a branch below it", () => {
    const { rows } = layoutGlyphLaneRows(invertGlyphLaneDag(FORK).dag);
    expect(rows.map((r) => r.type)).toEqual(["node", "connector", "node", "node", "connector", "node"]);
    expect(rows[1]).toMatchObject({ branchLanes: [1], mergeLanes: [] });
    expect(rows[4]).toMatchObject({ mergeLanes: [1], branchLanes: [] });
  });

  it("turns each absent parent into one incoming entry for the node that named it, and none for a complete history", () => {
    // Mutation: compute incoming from present parents instead -> empty/wrong -> red.
    const window: GlyphLaneDag = { truncated: true, nodes: [{ id: "a", label: "a", parents: ["g1", "g2"] }, { id: "b", label: "b", parents: ["g1"] }] };
    expect(invertGlyphLaneDag(window).incoming).toEqual([{ id: "b", source: "g1" }, { id: "a", source: "g1" }, { id: "a", source: "g2" }]);
    expect(invertGlyphLaneDag(window).continuesFrom).toEqual(new Map([["a", "g1"], ["b", "g1"]]));
    expect(glyphLaneOutsideParents(window)).toHaveLength(3);
    expect(invertGlyphLaneDag(FORK).incoming).toEqual([]);
  });
});
