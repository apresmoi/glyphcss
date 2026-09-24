import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { GLYPH_LANE_JSON_SCHEMA_KEYWORDS, glyphLaneJsonSchema } from "./schema";
import { GLYPH_LANE_VALIDATION_RULES, glyphLaneDagRepairHint, validateGlyphLaneDag } from "./validate";
import { glyphLaneBadFixtures } from "./validate.test";

const schema = glyphLaneJsonSchema();
const ajv = new Ajv2020({ strict: false, strictNumbers: true });
for (const keyword of GLYPH_LANE_JSON_SCHEMA_KEYWORDS) ajv.addKeyword(keyword);
const validate = ajv.compile(schema);

const base = {
  nodes: [
    { id: "a", label: "A", parents: ["b"], marks: ["main"] },
    { id: "b", label: "B", parents: [] },
  ],
};

describe("lane DAG JSON Schema and runtime parity", () => {
  it("serializes as JSON and carries each runtime rule's own dedicated repair hint", () => {
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
    expect(Object.keys(schema["x-glyphcss-validation-rules"])).toEqual([...GLYPH_LANE_VALIDATION_RULES]);
    for (const id of GLYPH_LANE_VALIDATION_RULES) expect(schema["x-glyphcss-validation-rules"][id]).toBe(glyphLaneDagRepairHint(id));
  });

  it("accepts a valid IR with real Ajv", () => {
    const json = JSON.parse(JSON.stringify(base));
    expect(validate(json), JSON.stringify(validate.errors)).toBe(true);
    expect(validateGlyphLaneDag(json)).toEqual(base);
  });

  it.each(glyphLaneBadFixtures)("rejects $id in both the runtime and Ajv", ({ id, value }) => {
    expect(() => validateGlyphLaneDag(value)).toThrow(expect.objectContaining({ code: id }));
    expect(validate(value), JSON.stringify(validate.errors)).toBe(false);
  });

  it("requires the custom keyword for relational rules instead of claiming standard Schema can compare ids/order", () => {
    const structuralAjv = new Ajv2020({ strict: false });
    const structural = structuralAjv.compile(schema);
    const missing = { nodes: [{ id: "a", label: "A", parents: ["ghost"] }] };
    expect(structural(missing)).toBe(true);
    expect(validate(missing)).toBe(false);
    expect(schema.$comment).toContain("Register GLYPH_LANE_JSON_SCHEMA_KEYWORDS");
  });
});
