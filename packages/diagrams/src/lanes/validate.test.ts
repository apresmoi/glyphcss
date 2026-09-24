import { describe, expect, it } from "vitest";
import { GLYPH_LANE_VALIDATION_RULES, glyphLaneDagRepairHint, validateGlyphLaneDag } from "./validate";

const valid = {
  nodes: [
    { id: "a", label: "A", parents: ["b"] },
    { id: "b", label: "B", parents: [] },
  ],
};

export const glyphLaneBadFixtures: readonly { id: string; value: unknown }[] = [
  { id: "bad-lane-dag", value: { ...valid, surprise: true } },
  { id: "empty-nodes", value: { nodes: [] } },
  { id: "bad-lane-node", value: { nodes: [{ id: " ", label: "bad", parents: [] }] } },
  { id: "bad-lane-node", value: { nodes: [{ id: "a", label: "A", parents: "b" }] } },
  { id: "bad-lane-node", value: { nodes: [{ id: "a", label: "A", parents: [], marks: [1] }] } },
  { id: "duplicate-node-id", value: { nodes: [...valid.nodes, { id: "a", label: "Again", parents: [] }] } },
  { id: "unknown-parent", value: { nodes: [{ id: "a", label: "A", parents: ["ghost"] }] } },
  { id: "self-parent", value: { nodes: [{ id: "a", label: "A", parents: ["a"] }] } },
  { id: "bad-parent-order", value: { nodes: [{ id: "a", label: "A", parents: ["b"] }, { id: "b", label: "B", parents: ["a"] }] } },
];

describe("GlyphLaneDag validation", () => {
  it("returns owned arrays without changing the input", () => {
    const input = { nodes: [{ id: "a", label: "A", parents: ["b"], marks: ["main"] }, { id: "b", label: "B", parents: [] }] };
    const dag = validateGlyphLaneDag(input);
    expect(dag.nodes).not.toBe(input.nodes);
    expect(dag.nodes[0]).not.toBe(input.nodes[0]);
    expect(dag.nodes[0]!.parents).not.toBe(input.nodes[0]!.parents);
    expect(dag.nodes[0]!.marks).not.toBe(input.nodes[0]!.marks);
  });

  it.each(glyphLaneBadFixtures)("rejects $id with a table rule and repair hint", ({ id, value }) => {
    expect(GLYPH_LANE_VALIDATION_RULES).toContain(id);
    expect(() => validateGlyphLaneDag(value)).toThrow(expect.objectContaining({ code: id }));
    expect(glyphLaneDagRepairHint(id)).toBeTruthy();
  });

  it("allows a single rootless node and a node with no marks", () => {
    expect(validateGlyphLaneDag({ nodes: [{ id: "a", label: "A", parents: [] }] })).toBeTruthy();
  });

  it("carries no domain vocabulary in the IR: marks is an open string array, never a closed git ref/tag enum", () => {
    // Any strings are valid marks — the whole point of leaving it open. A
    // caller modelling a CI run's status badges or a lineage graph's
    // provenance tags must not need git's own ref vocabulary to pass
    // validation.
    const dag = validateGlyphLaneDag({ nodes: [{ id: "a", label: "A", parents: [], marks: ["deployed", "verified"] }] });
    expect(dag.nodes[0]!.marks).toEqual(["deployed", "verified"]);
  });

  it("gives every validation rule id its own repair hint, not the generic fallback", () => {
    const fallback = glyphLaneDagRepairHint("not-a-real-rule-id");
    for (const id of GLYPH_LANE_VALIDATION_RULES) {
      // Mutation: delete a rule's REPAIR_HINTS entry -> its hint falls back
      // to the generic message and this goes red instead of merely being truthy.
      expect(glyphLaneDagRepairHint(id)).not.toBe(fallback);
    }
  });
});
