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

/** Same as {@link coveredGrid} but with a `winnerMesh` buffer attached (the
 *  per-object targeting substrate — VOLUMETRIC-3.md §1). */
function coveredGridWithWinnerMesh(chars: string[], colors: (string | null)[], winnerMesh: number[]) {
  const depth = new Float64Array(chars.length);
  return buildCellGrid(
    chars, colors, depth, chars.length, 1,
    null, null, null, null, null, null, null, null, null, null,
    new Int32Array(winnerMesh),
  );
}

function metadataFor(cols: number, rows: number, isBase: boolean): GlyphEffectOutputMetadata {
  return { ...metadata(cols, rows), isBase };
}

/** A fake `GlyphMeshHandle` for compositor-level unit tests — only `.id` is
 *  duck-typed by `normalizeTarget`, so a plain object suffices. */
function fakeMesh(id: number): { readonly id: number } {
  return { id };
}

const emitEverywhereIgnoringTarget = defineGlyphEffect<{ phase: number }>({
  evaluate({ output }) {
    // Deliberately does NOT self-skip on `target.coverage[i] <= 0` — this is
    // the "naive" program shape the erasure counter-case exercises: the
    // compositor's `targetCoverage`-based gate must protect non-targeted
    // cells even when the program itself ignores targeting.
    for (let i = 0; i < output.coverage.length; i++) {
      output.glyph[i] = "Z";
      output.coverage[i] = 1;
      output.channels[i] = GlyphEffectOutputChannel.Glyph;
    }
  },
});

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

  it("carries a blank ' ' output glyph through assertSingleGlyph and encode without throwing, rendering it as an empty cell", () => {
    // " " is a valid isSingleCellGlyph (ASCII 0x20), so an effect emitting it
    // as a real glyph output (not just an omitted channel) must survive
    // assertSingleGlyph and reach the final grid as a genuine blank cell —
    // this is the compositor-level half of the blank-ramp glyph fix.
    const blankAndVisible = defineGlyphEffect<{ phase: number }>({
      evaluate({ target, output }) {
        for (let i = 0; i < output.coverage.length; i++) {
          if (target.coverage[i]! <= 0) continue;
          output.glyph[i] = i % 2 === 0 ? " " : "X";
          output.coverage[i] = 1;
          output.channels[i] = GlyphEffectOutputChannel.Glyph;
        }
      },
    });
    const layer = createRuntimeGlyphEffectLayer(
      { effect: blankAndVisible, params: { phase: 0 }, blend: "replace" },
      0,
      () => {},
      () => {},
    );
    const retained = retainGlyphEffectOutput(
      coveredGrid(["A", "B", "C", "D"], [null, null, null, null]),
      metadata(4, 1),
    );

    let composed: ReturnType<typeof composeRetainedGlyphEffectOutput> | undefined;
    expect(() => {
      composed = composeRetainedGlyphEffectOutput(retained, prepare([layer], 4));
    }).not.toThrow();

    expect(composed!.char).toEqual([" ", "X", " ", "X"]);
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

describe("per-object effect targeting (VOLUMETRIC-3.md §1)", () => {
  it("erasure counter-case: replace-blend at opacity 1 does NOT blank non-targeted cells even when the program itself ignores targeting", () => {
    // Cells 0,1 are won by mesh 10; cells 2,3 by mesh 20. The layer targets
    // only mesh 10. If an implementation zeroed the program's EMISSION
    // instead of `targetCoverage`, `inputWeight = inputCoverage * (1 -
    // opacity*targetCoverage)` — the naive program above unconditionally
    // emits full coverage everywhere — would erase cells 2/3 under
    // `blend: "replace"` at opacity 1. The correct mechanism (zeroing
    // `targetCoverage` itself) leaves them exactly passthrough instead.
    const layer = createRuntimeGlyphEffectLayer(
      { effect: emitEverywhereIgnoringTarget, params: { phase: 0 }, blend: "replace", opacity: 1, target: fakeMesh(10) as never },
      0,
      () => {},
      () => {},
    );
    const retained = retainGlyphEffectOutput(
      coveredGridWithWinnerMesh(["A", "B", "C", "D"], [null, null, null, null], [10, 10, 20, 20]),
      metadata(4, 1),
    );

    const composed = composeRetainedGlyphEffectOutput(retained, prepare([layer], 4));
    expect(composed.char).toEqual(["Z", "Z", "C", "D"]);
  });

  it("filters targetCoverage by winner-mesh membership for a multi-mesh target set", () => {
    const layer = createRuntimeGlyphEffectLayer(
      {
        effect: emitEverywhereIgnoringTarget, params: { phase: 0 }, blend: "replace", opacity: 1,
        target: [fakeMesh(1), fakeMesh(3)] as never,
      },
      0,
      () => {},
      () => {},
    );
    const retained = retainGlyphEffectOutput(
      coveredGridWithWinnerMesh(["A", "B", "C", "D"], [null, null, null, null], [1, 2, 3, 4]),
      metadata(4, 1),
    );

    const composed = composeRetainedGlyphEffectOutput(retained, prepare([layer], 4));
    expect(composed.char).toEqual(["Z", "B", "Z", "D"]);
  });

  it("degrades a mesh-targeted layer to fully inactive when no winner-mesh data exists (non-solid render, missing buffer) — never a throw", () => {
    const layer = createRuntimeGlyphEffectLayer(
      { effect: emitEverywhereIgnoringTarget, params: { phase: 0 }, blend: "replace", opacity: 1, target: fakeMesh(10) as never },
      0,
      () => {},
      () => {},
    );
    // No winnerMesh buffer at all — the wireframe/voxel/ink degradation case.
    const retained = retainGlyphEffectOutput(coveredGrid(["A", "B"], [null, null]), metadata(2, 1));

    let composed: ReturnType<typeof composeRetainedGlyphEffectOutput> | undefined;
    expect(() => {
      composed = composeRetainedGlyphEffectOutput(retained, prepare([layer], 2));
    }).not.toThrow();
    expect(composed!.char).toEqual(["A", "B"]);
  });

  it("treats a removed/never-present mesh id as an empty target — inactive, no throw", () => {
    const layer = createRuntimeGlyphEffectLayer(
      { effect: emitEverywhereIgnoringTarget, params: { phase: 0 }, blend: "replace", opacity: 1, target: fakeMesh(99) as never },
      0,
      () => {},
      () => {},
    );
    const retained = retainGlyphEffectOutput(
      coveredGridWithWinnerMesh(["A", "B"], [null, null], [10, 20]),
      metadata(2, 1),
    );
    const composed = composeRetainedGlyphEffectOutput(retained, prepare([layer], 2));
    expect(composed.char).toEqual(["A", "B"]);
  });

  it("applies mesh targeting identically on a detail grid (isBase: false) — targeting is per-output-grid, not base-only", () => {
    const layer = createRuntimeGlyphEffectLayer(
      { effect: emitEverywhereIgnoringTarget, params: { phase: 0 }, blend: "replace", opacity: 1, target: fakeMesh(7) as never },
      0,
      () => {},
      () => {},
    );
    const retained = retainGlyphEffectOutput(
      coveredGridWithWinnerMesh(["A", "B"], [null, null], [7, 8]),
      metadataFor(2, 1, false),
    );
    const composed = composeRetainedGlyphEffectOutput(retained, prepare([layer], 2));
    expect(composed.char).toEqual(["Z", "B"]);
  });

  it("occlusion-blanked cells (winner -1) are never in any target set", () => {
    const layer = createRuntimeGlyphEffectLayer(
      { effect: emitEverywhereIgnoringTarget, params: { phase: 0 }, blend: "replace", opacity: 1, target: fakeMesh(10) as never },
      0,
      () => {},
      () => {},
    );
    const retained = retainGlyphEffectOutput(
      coveredGridWithWinnerMesh([" ", "B"], [null, null], [-1, 10]),
      metadata(2, 1),
    );
    const composed = composeRetainedGlyphEffectOutput(retained, prepare([layer], 2));
    expect(composed.char).toEqual([" ", "Z"]);
  });

  it("setOptions on a mesh-targeted layer: an equivalent set is a no-op, a different set throws", () => {
    const layer = createRuntimeGlyphEffectLayer(
      { effect: emitEverywhereIgnoringTarget, params: { phase: 0 }, target: [fakeMesh(1), fakeMesh(2)] as never },
      0,
      () => {},
      () => {},
    );
    // Same ids, fresh array, different order — must be a no-op (no throw).
    expect(() => layer.handle.setOptions({ target: [fakeMesh(2), fakeMesh(1)] as never })).not.toThrow();
    // A genuinely different mesh set — live retargeting is out of scope.
    expect(() => layer.handle.setOptions({ target: [fakeMesh(1), fakeMesh(3)] as never }))
      .toThrow(/immutable after mount/i);
    // A layer mounted with the default "surfaces" target cannot switch to a
    // mesh set post-mount either.
    const surfaceLayer = createRuntimeGlyphEffectLayer(
      { effect: emitEverywhereIgnoringTarget, params: { phase: 0 } },
      1,
      () => {},
      () => {},
    );
    expect(() => surfaceLayer.handle.setOptions({ target: fakeMesh(5) as never }))
      .toThrow(/immutable after mount/i);
    // Plain "surfaces" <-> "viewport" retargeting remains freely mutable.
    expect(() => surfaceLayer.handle.setOptions({ target: "viewport" })).not.toThrow();
  });

  it("rejects a malformed mesh-target array at mount", () => {
    expect(() => createRuntimeGlyphEffectLayer(
      { effect: emitEverywhereIgnoringTarget, params: { phase: 0 }, target: [] as never },
      0,
      () => {},
      () => {},
    )).toThrow(/at least one GlyphMeshHandle/i);
  });
});

// `program` is a definition-layer-only option (VOLUMETRIC-3.md §4): a raw
// `GlyphEffectProgramLayerOptions` effect (a bare `defineGlyphEffect(...)`
// result, like `emitEverywhereIgnoringTarget` above) has no separate
// definition-level `validateProgram` hook to call it through — only a full
// `GlyphEffectDefinition` (id/version/parameterSchema/program) does, the
// same "definition" shape `isDefinition()` (effectCompositor.ts) checks.
function definitionOf(program: ReturnType<typeof defineGlyphEffect<{ phase: number }>>): GlyphEffectDefinition<{ phase: { kind: "number"; default: 0 } }> {
  return {
    id: "test.program-as-data",
    version: 1,
    parameterSchema: { phase: { kind: "number", default: 0 } },
    program,
  } satisfies GlyphEffectDefinition<{ phase: { kind: "number"; default: 0 } }>;
}

describe("program-as-data (VOLUMETRIC-3.md §4)", () => {
  it("forwards a mounted layer's `program` option onto the evaluate context unchanged", () => {
    let seenProgram: unknown;
    const reportsProgram = definitionOf(defineGlyphEffect<{ phase: number }>({
      evaluate({ program, output }) {
        seenProgram = program;
        output.coverage.fill(0);
      },
    }));
    const payload = { domain: "2d", layers: [] };
    const layer = createRuntimeGlyphEffectLayer(
      { effect: reportsProgram, params: { phase: 0 }, program: payload },
      0,
      () => {},
      () => {},
    );
    const retained = retainGlyphEffectOutput(coveredGrid(["A"], [null]), metadata(1, 1));
    composeRetainedGlyphEffectOutput(retained, prepare([layer], 1));
    expect(seenProgram).toBe(payload);
  });

  it("leaves context.program undefined when no `program` option was supplied", () => {
    let seenProgram: unknown = "sentinel";
    let sawProgramKey = true;
    const reportsProgram = definitionOf(defineGlyphEffect<{ phase: number }>({
      evaluate(context) {
        seenProgram = context.program;
        sawProgramKey = "program" in context;
        context.output.coverage.fill(0);
      },
    }));
    const layer = createRuntimeGlyphEffectLayer(
      { effect: reportsProgram, params: { phase: 0 } },
      0,
      () => {},
      () => {},
    );
    const retained = retainGlyphEffectOutput(coveredGrid(["A"], [null]), metadata(1, 1));
    composeRetainedGlyphEffectOutput(retained, prepare([layer], 1));
    expect(seenProgram).toBeUndefined();
    expect(sawProgramKey).toBe(false);
  });

  it("calls the definition's own validateProgram hook once at mount when a program option is present, and never when absent", () => {
    const validateProgram = vi.fn();
    const withValidator = definitionOf(defineGlyphEffect<{ phase: number }>({
      validateProgram,
      evaluate({ output }) { output.coverage.fill(0); },
    }));
    createRuntimeGlyphEffectLayer(
      { effect: withValidator, params: { phase: 0 }, program: { domain: "2d", layers: [] } },
      0,
      () => {},
      () => {},
    );
    expect(validateProgram).toHaveBeenCalledTimes(1);
    expect(validateProgram).toHaveBeenCalledWith({ domain: "2d", layers: [] });

    validateProgram.mockClear();
    createRuntimeGlyphEffectLayer(
      { effect: withValidator, params: { phase: 0 } },
      1,
      () => {},
      () => {},
    );
    expect(validateProgram).not.toHaveBeenCalled();
  });

  it("a validateProgram hook that throws on a malformed payload rejects the layer at mount, not silently later", () => {
    const strict = definitionOf(defineGlyphEffect<{ phase: number }>({
      validateProgram(program) {
        if (!program || typeof program !== "object" || !("layers" in program)) {
          throw new TypeError("bad program");
        }
      },
      evaluate({ output }) { output.coverage.fill(0); },
    }));
    expect(() => createRuntimeGlyphEffectLayer(
      { effect: strict, params: { phase: 0 }, program: "not a program" },
      0,
      () => {},
      () => {},
    )).toThrow(/bad program/);
  });

  it("a program option on a definition with no validateProgram hook mounts fine and still forwards the payload", () => {
    let seenProgram: unknown;
    const noValidator = definitionOf(defineGlyphEffect<{ phase: number }>({
      evaluate({ program, output }) {
        seenProgram = program;
        output.coverage.fill(0);
      },
    }));
    const payload = { anything: true };
    expect(() => createRuntimeGlyphEffectLayer(
      { effect: noValidator, params: { phase: 0 }, program: payload },
      0,
      () => {},
      () => {},
    )).not.toThrow();
    const layer = createRuntimeGlyphEffectLayer(
      { effect: noValidator, params: { phase: 0 }, program: payload },
      1,
      () => {},
      () => {},
    );
    const retained = retainGlyphEffectOutput(coveredGrid(["A"], [null]), metadata(1, 1));
    composeRetainedGlyphEffectOutput(retained, prepare([layer], 1));
    expect(seenProgram).toBe(payload);
  });

  it("setOptions rejects a DIFFERENT program value; the SAME value (by reference) is a no-op", () => {
    const noop = definitionOf(defineGlyphEffect<{ phase: number }>({ evaluate({ output }) { output.coverage.fill(0); } }));
    const payload = { domain: "2d", layers: [] };
    const layer = createRuntimeGlyphEffectLayer(
      { effect: noop, params: { phase: 0 }, program: payload },
      0,
      () => {},
      () => {},
    );
    expect(() => layer.handle.setOptions({ program: payload } as never)).not.toThrow();
    expect(() => layer.handle.setOptions({ program: { domain: "2d", layers: [] } } as never))
      .toThrow(/immutable after mount/i);
    // A layer mounted with NO program option can't gain one post-mount either.
    const bareLayer = createRuntimeGlyphEffectLayer(
      { effect: noop, params: { phase: 0 } },
      1,
      () => {},
      () => {},
    );
    expect(() => bareLayer.handle.setOptions({ program: payload } as never))
      .toThrow(/immutable after mount/i);
  });
});
