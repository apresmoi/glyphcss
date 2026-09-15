import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020";
import { glyphChart3dSurfaceJsonSchema } from "./schema";
import { GLYPH_CHART_3D_SURFACE_RULES, GLYPH_CHART_3D_VALIDATION_RULES, glyphChart3dRepairHint } from "./validate";
import { glyphChartSurface } from "./surface";

const schema = glyphChart3dSurfaceJsonSchema();
const ajv = new Ajv2020({ strict: false, strictNumbers: true });
const validate = ajv.compile(schema);

interface Fixture {
  readonly data: unknown;
  readonly channels?: unknown;
  readonly options?: unknown;
}

function runtime(fixture: Fixture): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    glyphChartSurface(fixture.data as any, fixture.channels as any, fixture.options as any);
    return true;
  } catch {
    return false;
  }
}

const goodFixtures: Fixture[] = [
  { data: { z: [[0, 1], [2, 3]] } },
  { data: { z: [[0, 1], [2, 3]] }, channels: { x: [10, 20], y: [-5, 5] } },
  { data: [{ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 2 }, { x: 0, y: 1, z: 3 }, { x: 1, y: 1, z: 4 }] },
  { data: { z: [[0, 1], [2, 3]] }, options: { aspect: [1, 1, 0.6], bands: 9, colorscale: "viridis", shading: "value", color: "none", maxQuadsX: 4, maxQuadsY: 4 } },
  { data: { z: [[0, 1], [2, 3]] }, options: { colorscale: ["#000000", "#ffffff"] } },
  { data: { z: [[0, 1], [2, 3]] }, options: { axes: { x: { title: "east", ticks: 4 }, z: { title: "" } } } },
];

const badFixtures: readonly { readonly id: (typeof GLYPH_CHART_3D_VALIDATION_RULES)[number]; readonly fixture: Fixture }[] = [
  { id: "surface-too-small", fixture: { data: { z: [[0]] } } },
  { id: "surface-ragged", fixture: { data: { z: [[0, 1], [2]] } } },
  { id: "non-finite-data", fixture: { data: { z: [[0, Number.NaN], [1, 2]] } } },
  { id: "surface-not-gridded", fixture: { data: [{ x: 0, y: 0, z: 1 }] } },
  { id: "bad-options", fixture: { data: { z: [[0, 1], [2, 3]] }, options: { bands: 0 } } },
  { id: "surface-axis-unsorted", fixture: { data: { z: [[0, 1, 2], [3, 4, 5]] }, channels: { x: [0, 10, 5] } } },
  { id: "colorscale-not-monotone", fixture: { data: { z: [[0, 1], [2, 3]] }, options: { colorscale: ["#ffffff", "#000000", "#ffffff"] } } },
];

describe("glyphChart3dSurfaceJsonSchema — schema and runtime agree (P1-5)", () => {
  it("round-trips as JSON", () => expect(JSON.parse(JSON.stringify(schema))).toEqual(schema));

  it.each(goodFixtures.map((fixture, i) => ({ fixture, i })))("good fixture $i passes real Ajv and runtime", ({ fixture }) => {
    expect(validate(JSON.parse(JSON.stringify(fixture))), JSON.stringify(validate.errors)).toBe(true);
    expect(runtime(fixture)).toBe(true);
  });

  it.each(badFixtures)("$id rejects at runtime with its own tagged code (schema-level rules also reject in Ajv)", ({ id, fixture }) => {
    expect(GLYPH_CHART_3D_VALIDATION_RULES).toContain(id);
    expect(glyphChart3dRepairHint(id)).toBeTruthy();
    expect(schema["x-glyphcss-validation-rules"][id]).toBeTruthy();
    expect(runtime(fixture)).toBe(false);
    // Only the STRUCTURALLY checkable rules (the grid's own shape) are also
    // schema violations — `surface-axis-unsorted`/`colorscale-not-monotone`
    // are cross-value / numeric invariants no JSON Schema keyword expresses
    // (mirroring the root schema's own `mixed-x-scale`/`sankey-cycle`
    // runtime-only rules), so Ajv legitimately still accepts those two.
    if (id === "surface-axis-unsorted" || id === "colorscale-not-monotone") {
      expect(validate(JSON.parse(JSON.stringify(fixture)))).toBe(true);
    } else {
      expect(validate(JSON.parse(JSON.stringify(fixture))), JSON.stringify(validate.errors)).toBe(false);
    }
  });

  it("every schema-describable rule has an independent bad fixture", () => {
    const covered = new Set(badFixtures.map((f) => f.id));
    // Scoped to the SURFACE mark's own rule subset (C5: the other 4 mark
    // types' own rules — `scatter-empty`, `parametric-ragged`, etc — live in
    // GLYPH_CHART_3D_VALIDATION_RULES too now, but this schema never claims
    // them, so this suite has no reason to cover them).
    for (const rule of GLYPH_CHART_3D_SURFACE_RULES) expect(covered.has(rule)).toBe(true);
  });
});
