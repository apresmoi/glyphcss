/**
 * Ajv parity for the C5 mark types' own JSON schemas — same discipline as
 * `schema.test.ts`'s own surface suite, condensed to one file per the
 * "lean tests" instruction (four near-identical suites would mostly
 * duplicate `schema.test.ts`'s own structure with no new signal).
 */
import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import { glyphChart3dScatterJsonSchema, glyphChart3dParametricJsonSchema, glyphChart3dBarsJsonSchema, glyphChart3dLineJsonSchema } from "./schema";
import { glyphChartScatter3d } from "./scatter";
import { glyphChartParametric3d } from "./parametric";
import { glyphChartBars3d } from "./bars";
import { glyphChartLine3d } from "./line3d";
import { GLYPH_CHART_3D_BARS_RULES, GLYPH_CHART_3D_LINE3D_RULES, GLYPH_CHART_3D_PARAMETRIC_RULES, GLYPH_CHART_3D_SCATTER_RULES } from "./validate";

const ajv = new Ajv2020({ strict: false, strictNumbers: true });

interface Suite {
  readonly name: string;
  readonly schemaFn: () => ReturnType<typeof glyphChart3dScatterJsonSchema>;
  readonly rules: readonly string[];
  readonly good: readonly unknown[];
  readonly bad: readonly { readonly id: string; readonly fixture: unknown }[];
  readonly runtime: (fixture: any) => boolean;
}

const suites: readonly Suite[] = [
  {
    name: "scatter",
    schemaFn: glyphChart3dScatterJsonSchema,
    rules: GLYPH_CHART_3D_SCATTER_RULES,
    good: [
      { data: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }] },
      { data: [{ x: 0, y: 0, z: 0, g: "a" }, { x: 1, y: 1, z: 1, g: "b" }], channels: { series: "g" } },
    ],
    bad: [
      { id: "scatter-empty", fixture: { data: [] } },
      { id: "non-finite-data", fixture: { data: [{ x: 0, y: 0, z: "nope" }] } },
    ],
    runtime: (f) => { try { glyphChartScatter3d(f.data, f.channels, f.options); return true; } catch { return false; } },
  },
  {
    name: "parametric",
    schemaFn: glyphChart3dParametricJsonSchema,
    rules: GLYPH_CHART_3D_PARAMETRIC_RULES,
    good: [
      { data: { x: [[0, 1], [0, 1]], y: [[0, 0], [1, 1]], z: [[0, 0], [0, 0]] } },
    ],
    bad: [
      { id: "parametric-too-small", fixture: { data: { x: [[0]], y: [[0]], z: [[0]] } } },
    ],
    runtime: (f) => { try { glyphChartParametric3d(f.data, f.options); return true; } catch { return false; } },
  },
  {
    name: "bars",
    schemaFn: glyphChart3dBarsJsonSchema,
    rules: GLYPH_CHART_3D_BARS_RULES,
    good: [
      { data: [{ x: 0, y: 0, z: 1 }, { x: 1, y: 1, z: 2 }] },
    ],
    bad: [
      { id: "bars-empty", fixture: { data: [] } },
    ],
    runtime: (f) => { try { glyphChartBars3d(f.data, f.channels, f.options); return true; } catch { return false; } },
  },
  {
    name: "line3d",
    schemaFn: glyphChart3dLineJsonSchema,
    rules: GLYPH_CHART_3D_LINE3D_RULES,
    good: [
      { data: [[0, 0, 0], [1, 1, 1]] },
      { data: [{ name: "a", points: [[0, 0, 0], [1, 0, 0]] }] },
    ],
    bad: [
      { id: "line3d-empty", fixture: { data: [] } },
    ],
    runtime: (f) => { try { glyphChartLine3d(f.data, f.options); return true; } catch { return false; } },
  },
];

for (const suite of suites) {
  describe(`glyphChart3d${suite.name[0]!.toUpperCase()}${suite.name.slice(1)}JsonSchema — schema and runtime agree`, () => {
    const schema = suite.schemaFn();
    const validate = ajv.compile(schema);

    it("round-trips as JSON", () => expect(JSON.parse(JSON.stringify(schema))).toEqual(schema));

    it.each(suite.good.map((fixture, i) => ({ fixture, i })))("good fixture $i passes real Ajv and runtime", ({ fixture }) => {
      expect(validate(JSON.parse(JSON.stringify(fixture))), JSON.stringify(validate.errors)).toBe(true);
      expect(suite.runtime(fixture)).toBe(true);
    });

    it.each(suite.bad)("$id rejects at runtime with its own tagged code", ({ id, fixture }) => {
      expect(suite.rules).toContain(id);
      expect(schema["x-glyphcss-validation-rules"][id as keyof typeof schema["x-glyphcss-validation-rules"]]).toBeTruthy();
      expect(suite.runtime(fixture)).toBe(false);
    });
  });
}
