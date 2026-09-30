import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { glyphGraphFromMermaid } from "./mermaid";
import { GLYPH_DIAGRAM_JSON_SCHEMA_KEYWORDS, glyphDiagramJsonSchema } from "./schema";
import { GLYPH_DIAGRAM_VALIDATION_RULES, glyphDiagramRepairHint, validateGlyphGraph } from "./validate";

const schema = glyphDiagramJsonSchema();
const ajv = new Ajv2020({ strict: false, strictNumbers: true });
for (const keyword of GLYPH_DIAGRAM_JSON_SCHEMA_KEYWORDS) ajv.addKeyword(keyword);
const validate = ajv.compile(schema);
const base = { nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }], direction: "TB" };
const bad: { rule: string; graph: unknown }[] = [
  { rule: "bad-graph", graph: { ...base, extra: 1 } },
  { rule: "bad-graph", graph: { ...base, edges: null } },
  { rule: "empty-nodes", graph: { ...base, nodes: [] } },
  { rule: "bad-node", graph: { ...base, nodes: [{ id: "a", label: 3 }] } },
  { rule: "bad-node", graph: { ...base, nodes: [{ id: " ", label: "A" }] } },
  { rule: "bad-node", graph: { ...base, nodes: [{ id: "a", label: "A", shape: "triangle" }] } },
  { rule: "bad-node", graph: { ...base, nodes: [{ id: "a", label: "A", extra: true }] } },
  { rule: "bad-node", graph: { ...base, nodes: [{ id: "a", label: "A", size: [2, 3, 4] }] } },
  { rule: "duplicate-node-id", graph: { ...base, nodes: [...base.nodes, { id: "a", label: "A again" }] } },
  { rule: "bad-edge", graph: { ...base, edges: [{ from: "a", to: "b", style: "wavy" }] } },
  { rule: "bad-edge", graph: { ...base, edges: [{ from: "a", to: "b", priority: Infinity }] } },
  { rule: "bad-edge", graph: { ...base, edges: [{ from: "a", to: "b", extra: 1 }] } },
  { rule: "duplicate-edge-id", graph: { ...base, edges: [{ id: "e", from: "a", to: "b" }, { id: "e", from: "b", to: "a" }] } },
  { rule: "unknown-node", graph: { ...base, edges: [{ from: "a", to: "ghost" }] } },
  { rule: "bad-group", graph: { ...base, groups: [{ id: "g", members: null }] } },
  { rule: "bad-group", graph: { ...base, groups: [{ id: "g", members: [12] }] } },
  { rule: "bad-group", graph: { ...base, groups: [{ id: "g", members: ["a"], extra: 1 }] } },
  { rule: "duplicate-group-id", graph: { ...base, groups: [{ id: "g", members: ["a"] }, { id: "g", members: ["b"] }] } },
  { rule: "unknown-node", graph: { ...base, groups: [{ id: "g", members: ["ghost"] }] } },
  { rule: "unknown-group", graph: { ...base, nodes: [{ id: "a", label: "A", group: "ghost" }, base.nodes[1]] } },
  { rule: "group-membership", graph: { ...base, groups: [{ id: "g", members: ["a", "a"] }] } },
  { rule: "group-membership", graph: { ...base, nodes: [{ id: "a", label: "A", group: "g" }, base.nodes[1]], groups: [{ id: "g", members: ["b"] }] } },
  { rule: "bad-direction", graph: { ...base, direction: "TD" } },
];

describe("diagram JSON Schema and runtime parity", () => {
  it("serializes as JSON and carries each runtime rule's own dedicated repair hint", () => {
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
    expect(Object.keys(schema["x-glyphcss-validation-rules"])).toEqual([...GLYPH_DIAGRAM_VALIDATION_RULES]);
    // Mutation: hardcode a shared/generic string for "x-glyphcss-validation-rules"
    // instead of deriving each entry from glyphDiagramRepairHint -> this fails.
    for (const id of GLYPH_DIAGRAM_VALIDATION_RULES) expect(schema["x-glyphcss-validation-rules"][id]).toBe(glyphDiagramRepairHint(id));
  });

  it.each(["chain", "diamond", "fan-out", "cycle", "subgraph", "langgraph", "six-port"])("accepts the JSON IR for %s with real Ajv", (name) => {
    const graph = glyphGraphFromMermaid(readFileSync(resolve(__dirname, "../fixtures", `${name}.mmd`), "utf8"));
    const json = JSON.parse(JSON.stringify(graph));
    expect(validate(json), JSON.stringify(validate.errors)).toBe(true);
    expect(validateGlyphGraph(json)).toEqual(graph);
  });

  it.each(bad)("rejects $rule in both the runtime and Ajv", ({ rule, graph }) => {
    // Each bad shape is independent of the implementation: deleting either
    // its runtime clause or schema clause makes one side accept this input.
    expect(() => validateGlyphGraph(graph)).toThrow(expect.objectContaining({ code: rule }));
    expect(validate(graph), JSON.stringify(validate.errors)).toBe(false);
  });

  it("requires the custom keyword for relational rules instead of claiming standard Schema can compare ids", () => {
    const structuralAjv = new Ajv2020({ strict: false });
    const structural = structuralAjv.compile(schema);
    const missing = { ...base, edges: [{ from: "a", to: "missing" }] };
    expect(structural(missing)).toBe(true);
    expect(validate(missing)).toBe(false);
    expect(schema.$comment).toContain("Register GLYPH_DIAGRAM_JSON_SCHEMA_KEYWORDS");
  });
});
