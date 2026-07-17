import { describe, expect, it, vi } from "vitest";
import {
  GlyphEffectOutputChannel,
  defineGlyphEffect,
  type GlyphEffectDefinition,
} from "../api/effects";
import { buildCellGrid } from "./cells";
import {
  composeRetainedGlyphEffectOutput,
  createRuntimeGlyphEffectLayer,
  prepareRuntimeGlyphEffectLayers,
  retainGlyphEffectOutput,
  type GlyphEffectOutputMetadata,
  type RuntimeGlyphEffectLayer,
} from "./effectCompositor";

function metadata(cols: number, rows: number): GlyphEffectOutputMetadata {
  return {
    id: "base",
    pre: document.createElement("pre"),
    isBase: true,
    cellToSceneGrid: [1, 0, 0, 1, 0, 0],
    sceneGridSize: [cols, rows],
    localCellFootprint: [1, 1],
  };
}

function coveredGrid(chars: string[], colors: (string | null)[]) {
  const depth = new Float64Array(chars.length);
  return buildCellGrid(chars, colors, depth, chars.length, 1);
}

function prepare(layers: readonly RuntimeGlyphEffectLayer[], cols: number, rows = 1) {
  return prepareRuntimeGlyphEffectLayers(layers, [cols, rows]);
}

describe("retained effect compositor", () => {
  it("validates string-keyed defineProperty writes while permitting symbol metadata", () => {
    const schema = {
      phase: { kind: "number", default: 0 },
    } as const;
    const definition = {
      id: "test.proxy",
      version: 1,
      parameterSchema: schema,
      program: defineGlyphEffect<{ phase: number }>({ evaluate() {} }),
    } satisfies GlyphEffectDefinition<typeof schema>;
    const dirty = vi.fn();
    const layer = createRuntimeGlyphEffectLayer(
      { effect: definition },
      0,
      dirty,
      () => {},
    );
    const params = layer.handle.params;

    Object.defineProperty(params, "phase", { value: 2 });
    expect(params.phase).toBe(2);
    expect(Object.keys(params)).toEqual(["phase"]);
    expect(dirty).toHaveBeenCalledTimes(1);

    dirty.mockClear();
    const animeMetadata = Symbol("anime");
    expect(Reflect.defineProperty(params, animeMetadata, { value: { target: true } })).toBe(true);
    expect(Reflect.get(params, animeMetadata)).toEqual({ target: true });
    expect(dirty).not.toHaveBeenCalled();

    expect(() => Object.defineProperty(params, "unknown", { value: 1 })).toThrow(/unknown effect parameter/);
    expect(() => Object.defineProperty(params, "phase", { value: {} })).toThrow(/finite number/);
    expect(() => Object.defineProperty(params, "phase", { get: () => 1 })).toThrow(/data property/);
    expect(() => Object.defineProperty(params, "phase", { value: 3, writable: false }))
      .toThrow(/writable, enumerable, and configurable/);

    layer.handle.dispose();
    expect(() => Object.defineProperty(params, "phase", { value: 3 })).toThrow(/disposed/);
  });

  it("clears emitted glyphs before every layer evaluation", () => {
    const writeGlyph = defineGlyphEffect<{ phase: number }>({
      evaluate({ target, output }) {
        for (let i = 0; i < output.coverage.length; i++) {
          if (target.coverage[i]! <= 0) continue;
          output.glyph[i] = "X";
          output.coverage[i] = 1;
          output.channels[i] = GlyphEffectOutputChannel.Glyph;
        }
      },
    });
    const omitGlyph = defineGlyphEffect<{ phase: number }>({
      evaluate({ target, output }) {
        for (let i = 0; i < output.coverage.length; i++) {
          if (target.coverage[i]! <= 0) continue;
          output.coverage[i] = 1;
          output.channels[i] = GlyphEffectOutputChannel.Glyph;
        }
      },
    });
    const first = createRuntimeGlyphEffectLayer(
      { effect: writeGlyph, params: { phase: 0 }, blend: "replace" },
      0,
      () => {},
      () => {},
    );
    const second = createRuntimeGlyphEffectLayer(
      { effect: omitGlyph, params: { phase: 0 }, blend: "replace" },
      1,
      () => {},
      () => {},
    );
    const retained = retainGlyphEffectOutput(coveredGrid(["B"], [null]), metadata(1, 1));

    const composed = composeRetainedGlyphEffectOutput(retained, prepare([first, second], 1));

    expect(composed.char).toEqual([" "]);
  });

  it("reuses base color strings and caches each changed packed color once per composition", () => {
    const retained = retainGlyphEffectOutput(
      coveredGrid(["A", "B", "C"], ["#010203", "#010203", "#010203"]),
      metadata(3, 1),
    );

    const unchanged = composeRetainedGlyphEffectOutput(retained, []);
    expect(unchanged.color).toEqual(["#010203", "#010203", "#010203"]);
    expect(retained.packedColorCache.size).toBe(0);

    const recolor = defineGlyphEffect<{ phase: number }>({
      evaluate({ target, output }) {
        for (let i = 0; i < output.coverage.length; i++) {
          if (target.coverage[i]! <= 0) continue;
          output.color[i] = 0x112233;
          output.coverage[i] = 1;
          output.channels[i] = GlyphEffectOutputChannel.Color;
        }
      },
    });
    const layer = createRuntimeGlyphEffectLayer(
      { effect: recolor, params: { phase: 0 }, blend: "replace" },
      0,
      () => {},
      () => {},
    );
    const prepared = prepare([layer], 3);

    const changed = composeRetainedGlyphEffectOutput(retained, prepared);
    expect(changed.color).toEqual(["#112233", "#112233", "#112233"]);
    expect(retained.packedColorCache).toEqual(new Map([[0x112233, "#112233"]]));

    retained.packedColorCache.set(0x112233, "#ffffff");
    const recomposed = composeRetainedGlyphEffectOutput(retained, prepared);
    expect(recomposed.color).toEqual(["#112233", "#112233", "#112233"]);
    expect(retained.packedColorCache).toEqual(new Map([[0x112233, "#112233"]]));
  });
});
