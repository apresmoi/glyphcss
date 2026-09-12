import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import { glyphChartJsonSchema } from "./schema";
import { GLYPH_CHART_VALIDATION_RULES, glyphChartRepairHint, validateGlyphChartSpec } from "./validate";
import { renderGlyphChart } from "./render";
import { goodSpecs, badSpecs } from "./reviewFixtures";

const schema = glyphChartJsonSchema();
const ajv = new Ajv2020({ strict: false, strictNumbers: true });
const validate = ajv.compile(schema);
function runtime(spec: Parameters<typeof validateGlyphChartSpec>[0]): boolean {
  try { validateGlyphChartSpec(spec); return true; } catch { return false; }
}

describe("schema and runtime enforce one contract (review 10/11)", () => {
  it("round-trips as JSON", () => expect(JSON.parse(JSON.stringify(schema))).toEqual(schema));
  it.each(goodSpecs.map((spec, i) => ({ spec, i })))("fixture $i passes real Ajv and runtime, and paints", ({ spec }) => {
    // Mutation: skip schema x/y conditions, restrict valid band dots, or delete a painter -> red in this suite and its picture gates.
    const json = JSON.parse(JSON.stringify(spec));
    expect(validate(json), JSON.stringify(validate.errors)).toBe(true);
    expect(runtime(json)).toBe(true);
    expect(renderGlyphChart(json).meta.values).toBeGreaterThan(0);
  });
  it.each(badSpecs)("$id rejects with the designed rule and matches Ajv", ({ id, spec, options }) => {
    // Mutation: delete the rule's check -> no tagged throw; delete its table entry -> missing membership/hint.
    expect(GLYPH_CHART_VALIDATION_RULES).toContain(id);
    expect(glyphChartRepairHint(id as never)).toBeTruthy();
    expect(schema["x-glyphcss-validation-rules"][id as keyof typeof schema["x-glyphcss-validation-rules"]]).toBeTruthy();
    expect(() => renderGlyphChart(spec, options)).toThrow(expect.objectContaining({ code: id }));
    if (options) {
      const sizeSchema = ajv.compile({ type: "object", properties: { width: { type: "integer", minimum: 1 }, height: { type: "integer", minimum: 1 } } });
      expect(sizeSchema(options)).toBe(false);
    } else {
      expect(validate(spec), JSON.stringify(validate.errors)).toBe(false);
      expect(validate(spec)).toBe(runtime(spec));
    }
  });
  it("every rule has an independent executable bad case", () => {
    // Mutation: delete/add a rule without its bad-case gate -> literal fixture-set equality fails.
    expect([...new Set(badSpecs.map((f) => f.id))].sort()).toEqual([...GLYPH_CHART_VALIDATION_RULES].sort());
  });
});
