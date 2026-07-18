import { h } from "vue";
import { expectTypeOf, test } from "vitest";
import type {
  GlyphEffectDefinition,
  GlyphEffectParamsOf,
  GlyphEffectProgram,
} from "glyphcss";
import {
  GlyphEffectLayer,
  type GlyphEffectLayerExposed,
} from "./GlyphEffectLayer";

const definitionSchema = {
  time: { kind: "number", default: 0, animation: "continuous" },
  glyphs: { kind: "string", default: "ABC", animation: "discrete" },
} as const;

const definition = {
  id: "type-test",
  version: 1,
  parameterSchema: definitionSchema,
  program: { evaluate() {} },
} satisfies GlyphEffectDefinition<typeof definitionSchema>;

type DefinitionParams = GlyphEffectParamsOf<typeof definition>;

const rawProgram: GlyphEffectProgram<{ phase: number; active: boolean }> = {
  evaluate() {},
};

test("infers definition parameters from the effect prop", () => {
  const layer = GlyphEffectLayer({
    effect: definition,
    params: { time: 1, glyphs: "XYZ" },
  });

  expectTypeOf(layer.__ctx).toEqualTypeOf<
    GlyphEffectLayerExposed<DefinitionParams> | undefined
  >();

  h(GlyphEffectLayer, {
    effect: definition,
    params: { time: 1 },
  });

  // @ts-expect-error parameter keys come from the selected definition schema
  GlyphEffectLayer({ effect: definition, params: { unknown: 1 } });
  // @ts-expect-error parameter value types come from the selected definition schema
  GlyphEffectLayer({ effect: definition, params: { time: "fast" } });
  // @ts-expect-error render-function calls use the same inferred schema
  h(GlyphEffectLayer, { effect: definition, params: { unknown: 1 } });
});

test("requires the complete parameter object for raw programs", () => {
  GlyphEffectLayer({
    effect: rawProgram,
    params: { phase: 0, active: true },
  });

  // @ts-expect-error raw programs require params
  GlyphEffectLayer({ effect: rawProgram });
  // @ts-expect-error raw program params are complete rather than partial
  GlyphEffectLayer({ effect: rawProgram, params: { phase: 0 } });
  // @ts-expect-error raw program parameter keys are inferred from the program
  GlyphEffectLayer({ effect: rawProgram, params: { phase: 0, active: true, unknown: 1 } });
});
