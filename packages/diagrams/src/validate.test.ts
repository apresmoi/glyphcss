import { describe, expect, it } from "vitest";
import { glyphGraphFromJson } from "./adapters";
import { GLYPH_DIAGRAM_VALIDATION_RULES, glyphDiagramRepairHint, validateGlyphGraph } from "./validate";

const valid = { nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }], direction: "TB" };

export const glyphDiagramBadGraphFixtures: readonly { id: string; value: unknown }[] = [
  { id: "bad-graph", value: { ...valid, surprise: true } },
  { id: "empty-nodes", value: { ...valid, nodes: [] } },
  { id: "bad-node", value: { ...valid, nodes: [{ id: " ", label: "bad" }] } },
  { id: "duplicate-node-id", value: { ...valid, nodes: [...valid.nodes, { id: "a", label: "Again" }] } },
  { id: "bad-edge", value: { ...valid, edges: [{ from: "a", to: "b", style: "wavy" }] } },
  { id: "duplicate-edge-id", value: { ...valid, edges: [{ id: "same", from: "a", to: "b" }, { id: "same", from: "b", to: "a" }] } },
  { id: "unknown-node", value: { ...valid, edges: [{ from: "a", to: "missing" }] } },
  { id: "bad-group", value: { ...valid, groups: [{ id: "g", members: [42] }] } },
  { id: "duplicate-group-id", value: { ...valid, groups: [{ id: "g", members: ["a"] }, { id: "g", members: ["b"] }] } },
  { id: "unknown-group", value: { ...valid, nodes: [{ id: "a", label: "A", group: "missing" }, valid.nodes[1]] } },
  { id: "group-membership", value: { ...valid, nodes: [{ id: "a", label: "A", group: "g" }, valid.nodes[1]], groups: [{ id: "g", members: ["b"] }] } },
  { id: "bad-direction", value: { ...valid, direction: "TD" } },
];

describe("GlyphGraph validation and JSON adapter", () => {
  it("defaults JSON direction and returns owned arrays without changing the input", () => {
    const input = { nodes: valid.nodes, edges: valid.edges, groups: [{ id: "g", members: ["a"] }] };
    const graph = glyphGraphFromJson(input);
    expect(graph.direction).toBe("TB");
    expect(graph.nodes).not.toBe(input.nodes);
    expect(graph.nodes[0]).not.toBe(input.nodes[0]);
    expect(graph.edges).not.toBe(input.edges);
    expect(graph.groups?.[0]?.members).not.toBe(input.groups[0]!.members);
    expect(input).not.toHaveProperty("direction");
    expect(glyphGraphFromJson({ ...input, direction: undefined }).direction).toBe("TB");
  });

  it.each(glyphDiagramBadGraphFixtures)("rejects $id with a table rule and repair hint", ({ id, value }) => {
    expect(GLYPH_DIAGRAM_VALIDATION_RULES).toContain(id);
    expect(() => validateGlyphGraph(value)).toThrow(expect.objectContaining({ code: id }));
    expect(glyphDiagramRepairHint(id)).toBeTruthy();
  });

  it("requires finite edge priorities and supported node shapes, including from JavaScript", () => {
    for (const priority of [NaN, Infinity, -Infinity]) expect(() => validateGlyphGraph({ ...valid, edges: [{ ...valid.edges[0], priority }] })).toThrow(expect.objectContaining({ code: "bad-edge" }));
    expect(() => validateGlyphGraph({ ...valid, nodes: [{ id: "a", label: "A", shape: "hexagon" }] })).toThrow(expect.objectContaining({ code: "bad-node" }));
  });

  it("rejects unknown group members and duplicate membership separately", () => {
    expect(() => validateGlyphGraph({ ...valid, groups: [{ id: "g", members: ["ghost"] }] })).toThrow(expect.objectContaining({ code: "unknown-node" }));
    expect(() => validateGlyphGraph({ ...valid, groups: [{ id: "g", members: ["a", "a"] }] })).toThrow(expect.objectContaining({ code: "group-membership" }));
  });

  it("allows disconnected nodes, cycles, self loops, repeated labels, and implicit parallel edges", () => {
    const graph = { nodes: [{ id: "a", label: "Same" }, { id: "b", label: "Same" }], edges: [{ from: "a", to: "a" }, { from: "a", to: "a" }], direction: "RL" };
    expect(validateGlyphGraph(graph)).toEqual(graph);
  });

  it.each([null, [], "{}", { nodes: valid.nodes }])("rejects non-graph JSON data %j", (input) => {
    expect(() => glyphGraphFromJson(input)).toThrow(expect.objectContaining({ code: "bad-graph" }));
  });

  it("gives every validation rule id its own repair hint, not the generic fallback", () => {
    const fallback = glyphDiagramRepairHint("not-a-real-rule-id");
    for (const id of GLYPH_DIAGRAM_VALIDATION_RULES) {
      // Mutation: delete a rule's REPAIR_HINTS entry -> its hint falls back to
      // the generic message and this goes red instead of merely being truthy.
      expect(glyphDiagramRepairHint(id)).not.toBe(fallback);
    }
  });
});
