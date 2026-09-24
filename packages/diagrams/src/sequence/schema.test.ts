import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import { GLYPH_SEQUENCE_JSON_SCHEMA_KEYWORDS, glyphSequenceJsonSchema } from "./schema";
import { GLYPH_SEQUENCE_VALIDATION_RULES, glyphSequenceRepairHint, validateGlyphSequence } from "./validate";
import { glyphSequenceBadFixtures } from "./validate.test";

const schema = glyphSequenceJsonSchema();
const ajv = new Ajv2020({ strict: false, strictNumbers: true });
for (const keyword of GLYPH_SEQUENCE_JSON_SCHEMA_KEYWORDS) ajv.addKeyword(keyword);
const validate = ajv.compile(schema);

const base = {
  participants: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
  messages: [{ from: "a", to: "b" }],
  frames: [{ kind: "alt", label: "x", from: 0, to: 0 }],
  notes: [{ text: "n", over: ["a", "b"], at: 1 }],
};

describe("sequence JSON Schema and runtime parity", () => {
  it("serializes as JSON and carries each runtime rule's own dedicated repair hint", () => {
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
    expect(Object.keys(schema["x-glyphcss-validation-rules"])).toEqual([...GLYPH_SEQUENCE_VALIDATION_RULES]);
    for (const id of GLYPH_SEQUENCE_VALIDATION_RULES) expect(schema["x-glyphcss-validation-rules"][id]).toBe(glyphSequenceRepairHint(id));
  });

  it("accepts a valid IR with real Ajv, including frames and notes", () => {
    const json = JSON.parse(JSON.stringify(base));
    expect(validate(json), JSON.stringify(validate.errors)).toBe(true);
    expect(validateGlyphSequence(json)).toEqual(base);
  });

  it.each(glyphSequenceBadFixtures)("rejects $id in both the runtime and Ajv", ({ id, value }) => {
    expect(() => validateGlyphSequence(value)).toThrow(expect.objectContaining({ code: id }));
    expect(validate(value), JSON.stringify(validate.errors)).toBe(false);
  });

  it("requires the custom keyword for relational rules instead of claiming standard Schema can compare ids/ranges", () => {
    const structuralAjv = new Ajv2020({ strict: false });
    const structural = structuralAjv.compile(schema);
    const missing = { ...base, messages: [{ from: "a", to: "ghost" }] };
    expect(structural(missing)).toBe(true);
    expect(validate(missing)).toBe(false);
    expect(schema.$comment).toContain("Register GLYPH_SEQUENCE_JSON_SCHEMA_KEYWORDS");
  });
});
