import type { Polygon, Vec3 } from "@glyphcss/core";
import { describe, expect, it } from "vitest";
import {
  buildRasterizeContext,
  createGlyphOrthographicCamera,
  createGlyphScene,
  defineGlyphEffect,
  GlyphEffectNoColor,
  GlyphEffectOutputChannel,
  parseGlyphEffectColor,
  rasterizeToCells,
  type GlyphEffectParamSchema,
} from "glyphcss";
import {
  GLYPH_FIELD_SYNTH_VALIDATION_RULES,
  GlyphEffectCatalog,
  INK_LEVELS_MAX,
  FIELD_SYNTH_VOICE_KEY_FAMILIES,
  SYNTH_VOICES,
  assertFieldSynthVoiceSchemaComplete,
  buildFieldSynthVoices,
  compileFieldSynthProgram,
  compileFieldVoices,
  defaultGlyphEffectParams,
  fieldSynth,
  flowText,
  generatedSurfaceField,
  getGlyphEffect,
  glitch,
  gyroidXrayPreset,
  matrixRain,
  mengerSpongeDepth3Preset,
  mengerSpongePreset,
  noiseDissolve,
  objectVolumetricAlongLane,
  resolveFieldSynthLayerShapes,
  ripple,
  scan,
  scramble,
  sierpinskiPyramidPreset,
  synthWave,
  wipe,
  type AnyContext,
  type AnyParams,
  type GlyphFieldSynthValidationError,
  type GlyphFieldSynthValidationRuleId,
  type GlyphStockEffect,
} from "./stock";
// The IR compile/evaluate seam field-synth's own `evaluate()` uses
// internally (see stock.ts) — reused here, not reimplemented, so the
// uniform-step-count test below (VOLUMETRIC-2.md §1 "Uniform step count per
// evaluate", acceptance criterion 2) computes its expected brightness from
// the SAME integrator, not a parallel hand-derivation that could drift.
import {
  buildGlyphFieldProgram,
  effectiveVoiceFinestFreq,
  evaluateFieldProgram,
  fieldStepCount,
  integrateField,
  validateGlyphFieldProgram,
  type FieldProgram,
} from "./fieldProgram";

// A plain union (not a generic parameter) so a narrower union — e.g. the
// three-effect "cases" arrays below — assigns in directly without invoking
// generic inference over a union argument.
type EffectUnderTest = GlyphStockEffect;
type GridAffine = readonly [number, number, number, number, number, number];

// `defaultGlyphEffectParams` is itself generic over one concrete Schema, so
// calling it with a definition typed as a *union* of schemas fails to type-check
// (the union's `program.evaluate` sits in contravariant position). Reading
// `parameterSchema` off the union is fine — it's a covariant field — so derive
// defaults from that directly instead of routing through the generic helper.
function defaultParamsForSchema(schema: GlyphEffectParamSchema): Record<string, number | string | boolean> {
  const params: Record<string, number | string | boolean> = {};
  for (const [key, spec] of Object.entries(schema)) params[key] = spec.default;
  return params;
}

function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

interface EvaluateOptions {
  withUv?: boolean;
  shade?: Float32Array;
  worldPosition?: Float32Array;
  objectPosition?: Float32Array;
  objectExit?: Float32Array;
  normal?: Float32Array;
  cellToSceneGrid?: GridAffine;
  worldToSceneScale?: number;
  /** Program-as-data (VOLUMETRIC-3.md §4) — forwarded onto the evaluate
   *  context's `program` field, exactly like packages/glyphcss's compositor
   *  does for a mounted layer's `program` option. */
  program?: unknown;
}

function evaluate(
  definition: EffectUnderTest,
  overrides: Record<string, number | string | boolean> = {},
  options: EvaluateOptions = {},
) {
  const cols = 12;
  const rows = 6;
  const length = cols * rows;
  const params = { ...defaultParamsForSchema(definition.parameterSchema), ...overrides };
  const glyph = new Array<string>(length).fill("#");
  const coverage = new Float32Array(length).fill(1);
  const color = new Uint32Array(length).fill(GlyphEffectNoColor);
  const uv0 = options.withUv ? new Float32Array(length * 2) : undefined;
  if (uv0) {
    for (let i = 0; i < length; i++) {
      uv0[i * 2] = (i % cols) / (cols - 1);
      uv0[i * 2 + 1] = ((i / cols) | 0) / (rows - 1);
    }
  }
  const output = {
    glyph: new Array<string>(length).fill(" "),
    color: new Uint32Array(length).fill(GlyphEffectNoColor),
    coverage: new Float32Array(length),
    channels: new Uint8Array(length),
  };
  definition.program.validateParams?.(params as never);
  definition.program.evaluate({
    params,
    state: undefined,
    base: {
      cols,
      rows,
      length,
      glyph,
      coverage,
      color,
      ...(uv0 ? { uv0 } : {}),
      ...(options.shade ? { shade: options.shade } : {}),
      ...(options.worldPosition ? { worldPosition: options.worldPosition } : {}),
      ...(options.objectPosition ? { objectPosition: options.objectPosition } : {}),
      ...(options.objectExit ? { objectExit: options.objectExit } : {}),
      ...(options.normal ? { normal: options.normal } : {}),
    },
    input: { cols, rows, length, glyph, coverage, color },
    target: { coverage },
    coordinates: {
      cellToSceneGrid: options.cellToSceneGrid ?? [1, 0, 0, 1, 0, 0],
      sceneGridSize: [cols, rows],
      localCellFootprint: [1, 1],
      ...(options.worldToSceneScale !== undefined
        ? { worldToSceneScale: options.worldToSceneScale }
        : {}),
    },
    scratch: { images: [], floatFields: [], uintFields: [], glyphFields: [], samples: [] },
    output,
    ...(options.program !== undefined ? { program: options.program } : {}),
  } as never);
  return output;
}

function cubeSurface(kind: "wall" | "roof", normalSign = 1) {
  const cols = 12;
  const rows = 6;
  const worldPosition = new Float32Array(cols * rows * 3);
  const normal = new Float32Array(cols * rows * 3);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const offset = (row * cols + col) * 3;
      worldPosition[offset] = col;
      worldPosition[offset + 1] = kind === "wall" ? 0 : row;
      worldPosition[offset + 2] = kind === "wall" ? row : 6;
      normal[offset] = 0;
      normal[offset + 1] = kind === "wall" ? normalSign : 0;
      normal[offset + 2] = kind === "wall" ? 0 : normalSign;
    }
  }
  return { worldPosition, normal };
}

function slopedSurface(axis: "x" | "y" = "y") {
  const cols = 12;
  const rows = 6;
  const worldPosition = new Float32Array(cols * rows * 3);
  const normal = new Float32Array(cols * rows * 3);
  const component = Math.SQRT1_2;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const offset = (row * cols + col) * 3;
      worldPosition[offset] = axis === "y" ? col : row;
      worldPosition[offset + 1] = axis === "y" ? row : col;
      worldPosition[offset + 2] = -row;
      normal[offset] = axis === "y" ? 0 : component;
      normal[offset + 1] = axis === "y" ? component : 0;
      normal[offset + 2] = component;
    }
  }
  return { worldPosition, normal };
}

function glyphPitchWall() {
  const surface = cubeSurface("wall");
  for (let i = 0; i < surface.worldPosition.length; i += 3) {
    surface.worldPosition[i] *= 4;
    surface.worldPosition[i + 2] *= 4;
  }
  return surface;
}

function stretchedWall(stepZ: number) {
  const surface = cubeSurface("wall");
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < 12; col++) {
      surface.worldPosition[(row * 12 + col) * 3 + 2] = row * stepZ;
    }
  }
  return surface;
}

describe("GlyphEffectCatalog", () => {
  it("contains the initial reusable stock set with stable unique ids", () => {
    expect(GlyphEffectCatalog.map((effect) => effect.id)).toEqual([
      "matrix-rain",
      "flow-text",
      "scan",
      "wipe",
      "scramble",
      "glitch",
      "noise-dissolve",
      "ripple",
      "field-synth",
    ]);
    expect(new Set(GlyphEffectCatalog.map((effect) => effect.id)).size).toBe(GlyphEffectCatalog.length);
    for (const effect of GlyphEffectCatalog) expect(getGlyphEffect(effect.id)).toBe(effect);
  });

  it("materializes independent default parameter objects", () => {
    const first = defaultGlyphEffectParams(matrixRain);
    const second = defaultGlyphEffectParams(matrixRain);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.glyphs).toBe("HOLA");
    expect(first.density).toBe(0.55);
    expect(first.colorMode).toBe("original");
    expect(first.color).toBe("#00ff66");
  });
});

describe("stock effects", () => {
  it("accepts safe single-cell Unicode glyph sets", () => {
    const defaults = defaultGlyphEffectParams(matrixRain);

    expect(() => matrixRain.program.validateParams?.({
      ...defaults,
      glyphs: "⣿ᚠ←é<&",
    })).not.toThrow();
    expect(() => matrixRain.program.validateParams?.({
      ...defaults,
      glyphs: "漢🙂\u0301",
    })).toThrow(/single-cell/);
  });

  it("treats authored UVs as optional so projected fallback works in every render mode", () => {
    for (const effect of [matrixRain, flowText, scan]) {
      expect(effect.program.requirements).toBeUndefined();
      expect(effect.program.optionalRequirements).toContain("uv0");
      expect(effect.program.optionalRequirements).toContain("worldPosition");
      expect(effect.program.optionalRequirements).toContain("normal");
    }
    expect(matrixRain.program.optionalRequirements).toContain("baseShade");
  });

  it("flows text over every covered cell without requiring authored UVs", () => {
    const output = evaluate(flowText, { space: "auto", time: 1, speed: 3 });
    expect(Array.from(output.coverage).every((value) => value === 1)).toBe(true);
    expect(output.glyph.every((glyph) => "HOLA".includes(glyph))).toBe(true);
  });

  it("uses a projected-domain fallback for Matrix rain on untextured models", () => {
    const output = evaluate(matrixRain, {
      space: "auto",
      time: 1.25,
      speedMin: 5,
      speedMax: 5,
      density: 1,
      trail: 4,
    });
    const active = Array.from(output.coverage).filter((value) => value > 0).length;
    expect(active).toBeGreaterThan(0);
    expect(active).toBeLessThan(output.coverage.length);
  });

  it("supports space: \"object\" and declares objectPosition as an optional requirement", () => {
    for (const effect of [matrixRain, flowText, scan]) {
      expect(effect.parameterSchema.space.values).toContain("object");
      expect(effect.program.optionalRequirements).toContain("objectPosition");
    }
  });

  it("matrix-rain volumetric (space: \"object\"): same object-space point renders identically regardless of grid position", () => {
    // Two cells FAR apart in the 2D output grid (index 0 vs. the last cell)
    // but at the SAME 3D point in the mesh's own frame — as if one were on a
    // cap and the other on a wall meeting it, both windows into the same
    // volumetric field. A per-face UV atlas has no way to make these two
    // grid-disjoint cells agree; the volumetric formulation does by
    // construction, since it reads only (x, y, z).
    const cols = 12, rows = 6, length = cols * rows;
    const objectPosition = new Float32Array(length * 3).fill(NaN);
    const iA = 0;
    const iB = length - 1;
    const point: [number, number, number] = [2.3, -1.7, 4.1];
    objectPosition[iA * 3] = point[0]; objectPosition[iA * 3 + 1] = point[1]; objectPosition[iA * 3 + 2] = point[2];
    objectPosition[iB * 3] = point[0]; objectPosition[iB * 3 + 1] = point[1]; objectPosition[iB * 3 + 2] = point[2];

    const output = evaluate(matrixRain, {
      space: "object",
      direction: "down",
      time: 3.4,
      speedMin: 4,
      speedMax: 9,
      density: 1,
      trail: 6,
      seed: 5,
      scale: 1,
    }, { objectPosition });

    expect(output.coverage[iA]).toBe(output.coverage[iB]);
    expect(output.glyph[iA]).toBe(output.glyph[iB]);
    expect(output.color[iA]).toBe(output.color[iB]);
  });

  it("matrix-rain volumetric (space: \"object\") is invariant to the mesh's world position/rotation — only objectPosition drives it", () => {
    // The SAME objectPosition buffer, evaluated twice with completely
    // different (irrelevant) worldPosition buffers standing in for two
    // different mesh rotations, must produce byte-identical output: the
    // volumetric branch never reads worldPosition.
    const cols = 12, rows = 6, length = cols * rows;
    const objectPosition = new Float32Array(length * 3);
    for (let i = 0; i < length; i++) {
      objectPosition[i * 3] = (i % cols) - cols / 2;
      objectPosition[i * 3 + 1] = Math.floor(i / cols) - rows / 2;
      objectPosition[i * 3 + 2] = Math.sin(i) * 2;
    }
    const worldA = new Float32Array(length * 3).fill(1);
    const worldB = new Float32Array(length * 3).fill(-99);
    const params = {
      space: "object",
      direction: "down",
      time: 1.1,
      speedMin: 2,
      speedMax: 8,
      density: 0.8,
      trail: 5,
      seed: 42,
      scale: 1.5,
    };
    const outputA = evaluate(matrixRain, params, { objectPosition, worldPosition: worldA });
    const outputB = evaluate(matrixRain, params, { objectPosition, worldPosition: worldB });

    expect(outputA.glyph).toEqual(outputB.glyph);
    expect(Array.from(outputA.color)).toEqual(Array.from(outputB.color));
    expect(Array.from(outputA.coverage)).toEqual(Array.from(outputB.coverage));
  });

  it("moves Matrix strands toward lower world Z at a constant lane speed", () => {
    const params = {
      space: "surface",
      direction: "down",
      speedMin: 1,
      speedMax: 1,
      density: 1,
      trail: 3,
      seed: 17,
      scale: 1,
    };
    const surface = glyphPitchWall();
    const first = evaluate(matrixRain, { ...params, time: 0 }, surface);
    const next = evaluate(matrixRain, { ...params, time: 1 }, surface);

    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 12; col++) {
        expect(next.coverage[row * 12 + col]).toBeCloseTo(first.coverage[(row + 1) * 12 + col]!, 6);
        expect(next.glyph[row * 12 + col]).toBe(first.glyph[(row + 1) * 12 + col]);
      }
    }
  });

  it("advects the roof word and its strand in the same surface direction", () => {
    const surface = cubeSurface("roof");
    const params = {
      space: "surface",
      direction: "down",
      glyphs: "HOLA",
      speedMin: 1,
      speedMax: 1,
      density: 1,
      trail: 14,
      seed: 2,
      scale: 1,
    };
    const first = evaluate(matrixRain, { ...params, time: 0 }, surface);
    const next = evaluate(matrixRain, { ...params, time: 1 }, surface);

    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 11; col++) {
        const nextIndex = row * 12 + col;
        const firstIndex = nextIndex + 1;
        expect(next.coverage[nextIndex]).toBeCloseTo(first.coverage[firstIndex]!, 6);
        expect(next.glyph[nextIndex]).toBe(first.glyph[firstIndex]);
      }
    }
  });

  it("keeps projected word and strand speed coupled at a non-unit pattern scale", () => {
    const surface = cubeSurface("roof");
    const params = {
      space: "surface",
      direction: "down",
      glyphs: "HOLA",
      speedMin: 1,
      speedMax: 1,
      density: 1,
      trail: 14,
      seed: 2,
      scale: 2,
    };
    const first = evaluate(matrixRain, { ...params, time: 0 }, surface);
    const next = evaluate(matrixRain, { ...params, time: 2 }, surface);

    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 11; col++) {
        const nextIndex = row * 12 + col;
        const firstIndex = nextIndex + 1;
        expect(next.coverage[nextIndex]).toBeCloseTo(first.coverage[firstIndex]!, 6);
        expect(next.glyph[nextIndex]).toBe(first.glyph[firstIndex]);
      }
    }
  });

  it("keeps every active Matrix trail cell fully covered", () => {
    const output = evaluate(matrixRain, {
      space: "surface",
      direction: "down",
      speedMin: 1,
      speedMax: 1,
      density: 1,
      trail: 4,
      seed: 7,
      time: 2,
    }, cubeSurface("wall"));
    const active = Array.from(output.coverage).filter((coverage) => coverage > 0);

    expect(active.length).toBeGreaterThan(0);
    expect(new Set(active)).toEqual(new Set([1]));
  });

  it("forms spatial word chains at the generated surface pitch", () => {
    const output = evaluate(matrixRain, {
      space: "surface",
      direction: "down",
      glyphs: "HOLA",
      speedMin: 0,
      speedMax: 0,
      density: 1,
      trail: 6,
      seed: 3,
      time: 0,
    }, glyphPitchWall());
    let foundChain = false;

    for (let col = 0; col < 12; col++) {
      let run: string[] = [];
      for (let row = 0; row < 6; row++) {
        const index = row * 12 + col;
        if (output.coverage[index]! > 0) run.push(output.glyph[index]!);
        else run = [];
        if (run.length >= 3 && new Set(run).size >= 3) foundChain = true;
      }
    }

    expect(foundChain).toBe(true);
  });

  it("samples a readable word along a foreshortened surface chain", () => {
    const output = evaluate(matrixRain, {
      space: "surface",
      direction: "down",
      glyphs: "HOLA",
      speedMin: 0,
      speedMax: 0,
      density: 1,
      trail: 14,
      seed: 2,
      time: 0,
    }, stretchedWall(12));
    const firstLane = Array.from({ length: 5 }, (_, row) => output.glyph[row * 12]!);

    expect(firstLane).toEqual(["O", "H", "A", "L", "O"]);
    expect(Array.from({ length: 5 }, (_, row) => output.coverage[row * 12])).toEqual([1, 1, 1, 1, 1]);
  });

  it("uses the same glyph phase for repeated heads in one strand", () => {
    const output = evaluate(matrixRain, {
      space: "scene",
      direction: "right",
      glyphs: "HOLA",
      speedMin: 0,
      speedMax: 0,
      density: 1,
      trail: 14,
      seed: 2,
      time: 0,
      scale: 4.2,
    });
    let activePairs = 0;

    for (let row = 0; row < 6; row++) {
      const first = row * 12;
      const repeated = first + 10;
      expect(output.coverage[repeated]).toBe(output.coverage[first]);
      if (output.coverage[first]! <= 0) continue;
      activePairs++;
      expect(output.glyph[repeated]).toBe(output.glyph[first]);
    }
    expect(activePairs).toBeGreaterThan(0);
  });

  it("lights a bright head and fades the tail on every monochrome strand", () => {
    // Body cells use `color` (green, red channel 0); head cells use `headColor`
    // (mint, red channel > 0). The red channel therefore separates head from
    // body, and the green channel measures the head→tail brightness gradient.
    const output = evaluate(matrixRain, {
      colorMode: "monochrome",
      color: "#00ff66",
      headColor: "#e8ffe8",
      space: "scene",
      time: 1.25,
      speedMin: 5,
      speedMax: 5,
      density: 1,
      trail: 8,
    }, { shade: new Float32Array(12 * 6).fill(1) });
    const rgb = (packed: number) => ({ r: (packed >>> 16) & 0xff, g: (packed >>> 8) & 0xff, b: packed & 0xff });
    const active: { r: number; g: number; b: number }[] = [];
    for (let i = 0; i < output.coverage.length; i++) {
      if (output.coverage[i]! <= 0) continue;
      expect(output.channels[i]! & GlyphEffectOutputChannel.Color).toBeTruthy();
      active.push(rgb(output.color[i]!));
    }
    const heads = active.filter((c) => c.r > 0);
    const body = active.filter((c) => c.r === 0);

    expect(heads.length).toBeGreaterThan(0);
    expect(body.length).toBeGreaterThan(1);
    // The tail is a gradient, not one flat green.
    expect(new Set(body.map((c) => c.g)).size).toBeGreaterThan(1);
    // The bright head outshines the darkest tail cell.
    expect(Math.max(...heads.map((c) => c.g))).toBeGreaterThan(Math.min(...body.map((c) => c.g)));
  });

  it("modulates monochrome brightness by surface shade", () => {
    const params = {
      colorMode: "monochrome",
      color: "#00ff66",
      space: "scene" as const,
      time: 1.25,
      speedMin: 5,
      speedMax: 5,
      density: 1,
      trail: 8,
    };
    const green = (output: ReturnType<typeof evaluate>) => {
      let sum = 0;
      for (let i = 0; i < output.coverage.length; i++) {
        if (output.coverage[i]! > 0) sum += (output.color[i]! >>> 8) & 0xff;
      }
      return sum;
    };
    const dim = evaluate(matrixRain, params, { shade: new Float32Array(12 * 6).fill(0.2) });
    const bright = evaluate(matrixRain, params, { shade: new Float32Array(12 * 6).fill(1) });

    expect(green(dim)).toBeGreaterThan(0);
    expect(green(bright)).toBeGreaterThan(green(dim));
  });

  it("renders monochrome rain from the configured color when surface shade is unavailable", () => {
    const output = evaluate(matrixRain, {
      colorMode: "monochrome",
      color: "#37c96f",
      headColor: "#d8ffe4",
      space: "scene",
      time: 1.25,
      speedMin: 5,
      speedMax: 5,
      density: 1,
      trail: 8,
    });
    const rgb = (packed: number) => ({ r: (packed >>> 16) & 0xff, g: (packed >>> 8) & 0xff, b: packed & 0xff });
    const active: { r: number; g: number; b: number }[] = [];
    for (let i = 0; i < output.coverage.length; i++) {
      if (output.coverage[i]! > 0) active.push(rgb(output.color[i]!));
    }

    expect(active.length).toBeGreaterThan(0);
    // Every cell is a real, green-dominant color (no fall-through to black).
    for (const c of active) {
      expect(c.g).toBeGreaterThan(0);
      expect(c.g).toBeGreaterThanOrEqual(c.r);
    }
    // Head + fading tail give more than one brightness level.
    expect(new Set(active.map((c) => c.g)).size).toBeGreaterThan(1);
  });

  it("scales monochrome coverage by the color's alpha channel", () => {
    const shared = {
      colorMode: "monochrome",
      space: "scene",
      time: 1.25,
      speedMin: 5,
      speedMax: 5,
      density: 1,
      trail: 4,
    };
    const opaque = evaluate(matrixRain, { ...shared, color: "#37c96fff" });
    const halfAlpha = evaluate(matrixRain, { ...shared, color: "#37c96f80" });
    const expectedAlpha = parseGlyphEffectColor("#37c96f80").opacity;
    let sawNonZero = false;
    for (let i = 0; i < opaque.coverage.length; i++) {
      if (opaque.coverage[i]! <= 0) continue;
      sawNonZero = true;
      expect(halfAlpha.coverage[i]!).toBeCloseTo(opaque.coverage[i]! * expectedAlpha, 4);
    }
    expect(sawNonZero).toBe(true);
  });

  it("is deterministic for the same absolute time and parameter snapshot", () => {
    const params = { time: 9.75, density: 0.7, seed: 42, space: "surface" };
    const first = evaluate(matrixRain, params, { withUv: true });
    const second = evaluate(matrixRain, params, { withUv: true });
    expect(first.glyph).toEqual(second.glyph);
    expect(first.coverage).toEqual(second.coverage);
    expect(first.color).toEqual(second.color);
  });

  it("projects world-down onto walls and sloped faces", () => {
    const params = {
      space: "surface",
      direction: "down",
      glyphs: "0123456789",
      time: 0,
      speed: 0,
      scale: 4,
    };
    const wall = evaluate(flowText, params, cubeSurface("wall"));
    const slopeY = evaluate(flowText, params, slopedSurface("y"));
    const slopeX = evaluate(flowText, params, slopedSurface("x"));
    const wallExpected = Array.from(
      { length: 12 * 6 },
      (_, index) => String(positiveMod(-Math.floor(index / 12), 10)),
    );
    const slopeExpected = Array.from(
      { length: 12 * 6 },
      (_, index) => String(Math.floor(Math.floor(index / 12) * Math.SQRT2) % 10),
    );

    expect(wall.glyph).toEqual(wallExpected);
    expect(slopeY.glyph).toEqual(slopeExpected);
    expect(slopeX.glyph).toEqual(slopeExpected);
  });

  it("derives the perpendicular lane axis from each face orientation", () => {
    const params = {
      space: "surface",
      direction: "right",
      glyphs: "0123456789",
      time: 0,
      speed: 0,
      scale: 4,
    };
    const slopeY = evaluate(flowText, params, slopedSurface("y"));
    const slopeX = evaluate(flowText, params, slopedSurface("x"));
    const positive = Array.from({ length: 12 * 6 }, (_, index) => String((index % 12) % 10));
    const negative = Array.from(
      { length: 12 * 6 },
      (_, index) => String(positiveMod(-(index % 12), 10)),
    );

    expect(slopeY.glyph).toEqual(positive);
    expect(slopeX.glyph).toEqual(negative);
  });

  it("chooses a stable in-plane direction when gravity is normal to the face", () => {
    const params = {
      space: "surface",
      direction: "down",
      glyphs: "0123456789",
      time: 0,
      speed: 0,
      scale: 4,
    };
    const first = evaluate(flowText, params, cubeSurface("roof"));
    const repeated = evaluate(flowText, params, cubeSurface("roof"));
    const oppositeWinding = evaluate(flowText, params, cubeSurface("roof", -1));

    expect(first.glyph).toEqual(repeated.glyph);
    expect(first.glyph).toEqual(oppositeWinding.glyph);
    expect(new Set(first.glyph).size).toBeGreaterThan(1);
  });

  it("converts generated world coordinates with the canonical world-to-scene scale", () => {
    const output = evaluate(flowText, {
      space: "surface",
      direction: "down",
      glyphs: "0123456789",
      time: 0,
      speed: 0,
      scale: 4,
    }, { ...cubeSurface("wall"), worldToSceneScale: 2 });
    const expected = Array.from(
      { length: 12 * 6 },
      (_, index) => String(positiveMod(-Math.floor(index / 12) * 2, 10)),
    );

    expect(output.glyph).toEqual(expected);
  });

  it("keeps generated surface mapping stable when projected camera-grid coordinates change", () => {
    const surface = cubeSurface("wall");
    const changedGrid: GridAffine = [1.75, 0.2, -0.35, 1.4, 7.25, -3.5];
    const cases = [
      [flowText, { space: "surface", glyphs: "0123456789", time: 0, speed: 0 }],
      [matrixRain, {
        space: "surface",
        time: 1.25,
        speedMin: 5,
        speedMax: 5,
        density: 1,
        trail: 4,
      }],
      [scan, { space: "surface", time: 0.35, speed: 3, width: 2, spacing: 7 }],
    ] as const;

    for (const [effect, params] of cases) {
      const first = evaluate(effect, params, surface);
      const second = evaluate(effect, params, { ...surface, cellToSceneGrid: changedGrid });
      expect(second.glyph).toEqual(first.glyph);
      expect(second.coverage).toEqual(first.coverage);
      expect(second.color).toEqual(first.color);
    }
  });

  it("keeps scene mapping projected even when surface attributes are available", () => {
    const surface = cubeSurface("wall");
    const params = { space: "scene", glyphs: "0123456789", time: 0, speed: 0 };
    const first = evaluate(flowText, params, surface);
    const second = evaluate(flowText, params, {
      ...surface,
      cellToSceneGrid: [1, 0, 0, 1, 1.25, 0],
    });

    expect(second.glyph).not.toEqual(first.glyph);
  });

  it("prefers meaningful authored UVs over generated surface coordinates", () => {
    const first = evaluate(flowText, {
      space: "auto",
      glyphs: "0123456789",
      time: 0,
      speed: 0,
    }, { withUv: true, ...cubeSurface("wall") });
    const second = evaluate(flowText, {
      space: "auto",
      glyphs: "0123456789",
      time: 0,
      speed: 0,
    }, { withUv: true, ...cubeSurface("roof") });

    expect(second.glyph).toEqual(first.glyph);
  });

  it("forces generated face mapping when surface space is selected", () => {
    const params = {
      space: "surface",
      direction: "down",
      glyphs: "0123456789",
      time: 0,
      speed: 0,
    };
    const withoutUv = evaluate(flowText, params, cubeSurface("wall"));
    const withUv = evaluate(flowText, params, { withUv: true, ...cubeSurface("wall") });
    const automatic = evaluate(flowText, { ...params, space: "auto" }, {
      withUv: true,
      ...cubeSurface("wall"),
    });

    expect(withUv.glyph).toEqual(withoutUv.glyph);
    expect(automatic.glyph).not.toEqual(withoutUv.glyph);
  });
});

describe("scan", () => {
  it("scales coverage by the color's alpha channel", () => {
    const shared = { time: 0, speed: 0, direction: "right", width: 3, spacing: 28 };
    const opaque = evaluate(scan, { ...shared, color: "#ffffffff" });
    const halfAlpha = evaluate(scan, { ...shared, color: "#ffffff80" });
    const expectedAlpha = parseGlyphEffectColor("#ffffff80").opacity;
    let sawNonZero = false;
    for (let i = 0; i < opaque.coverage.length; i++) {
      if (opaque.coverage[i]! <= 0) continue;
      sawNonZero = true;
      expect(halfAlpha.coverage[i]!).toBeCloseTo(opaque.coverage[i]! * expectedAlpha, 4);
    }
    expect(sawNonZero).toBe(true);
  });
});

describe("wipe", () => {
  it("flips the covered region across progress with invert", () => {
    const revealed = evaluate(wipe, { progress: 1, softness: 0, invert: false });
    const hidden = evaluate(wipe, { progress: 0, softness: 0, invert: false });
    expect(Array.from(revealed.coverage).every((value) => value === 1)).toBe(true);
    expect(Array.from(hidden.coverage).every((value) => value === 0)).toBe(true);

    const invertedRevealed = evaluate(wipe, { progress: 1, softness: 0, invert: true });
    const invertedHidden = evaluate(wipe, { progress: 0, softness: 0, invert: true });
    expect(Array.from(invertedRevealed.coverage).every((value) => value === 0)).toBe(true);
    expect(Array.from(invertedHidden.coverage).every((value) => value === 1)).toBe(true);
  });

  it("keeps a monotone front along the wipe direction", () => {
    const output = evaluate(wipe, { progress: 0.5, softness: 0.1, direction: "right", invert: false });
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 11; col++) {
        const current = output.coverage[row * 12 + col]!;
        const next = output.coverage[row * 12 + col + 1]!;
        expect(next).toBeLessThanOrEqual(current + 1e-9);
      }
    }
  });

  it("widens the transition band with softness", () => {
    const partialCount = (output: ReturnType<typeof evaluate>) =>
      Array.from(output.coverage).filter((value) => value > 0 && value < 1).length;
    const narrow = evaluate(wipe, { progress: 0.5, softness: 0.01, direction: "right" });
    const wide = evaluate(wipe, { progress: 0.5, softness: 0.3, direction: "right" });
    expect(partialCount(wide)).toBeGreaterThan(partialCount(narrow));
  });
});

describe("scramble", () => {
  it("scrambles roughly the requested fraction of cells", () => {
    const output = evaluate(scramble, { amount: 0.35, rate: 10, time: 1, seed: 3 });
    const scrambled = Array.from(output.coverage).filter((value) => value === 1).length;
    const fraction = scrambled / output.coverage.length;
    expect(Math.abs(fraction - 0.35)).toBeLessThan(0.15);
  });

  it("is frame-quantized: any time within the same frame gives the same result", () => {
    const a = evaluate(scramble, { rate: 10, time: 1.01, seed: 3 });
    const b = evaluate(scramble, { rate: 10, time: 1.09, seed: 3 });
    expect(a.glyph).toEqual(b.glyph);
    expect(a.coverage).toEqual(b.coverage);
  });

  it("changes with a different frame", () => {
    const a = evaluate(scramble, { rate: 10, time: 1, seed: 3 });
    const b = evaluate(scramble, { rate: 10, time: 2, seed: 3 });
    expect(a.glyph).not.toEqual(b.glyph);
  });
});

describe("glitch", () => {
  it("marks cells as binary active/inactive", () => {
    const output = evaluate(glitch, { amount: 0.28, rate: 12, time: 1, seed: 5, color: "#ff4fd8" });
    const distinctCoverage = new Set(Array.from(output.coverage));
    for (const value of distinctCoverage) expect(value === 0 || value === 1).toBe(true);
  });

  it("is deterministic at a fixed time", () => {
    const params = { amount: 0.28, rate: 12, time: 1.25, seed: 5, bandSize: 4 };
    const a = evaluate(glitch, params);
    const b = evaluate(glitch, params);
    expect(a.glyph).toEqual(b.glyph);
    expect(a.coverage).toEqual(b.coverage);
    expect(a.color).toEqual(b.color);
  });

  it("scales coverage by the color's alpha channel", () => {
    const shared = { amount: 0.5, rate: 12, time: 1, seed: 5, bandSize: 4 };
    const opaque = evaluate(glitch, { ...shared, color: "#ff4fd8ff" });
    const halfAlpha = evaluate(glitch, { ...shared, color: "#ff4fd880" });
    const expectedAlpha = parseGlyphEffectColor("#ff4fd880").opacity;
    let sawNonZero = false;
    for (let i = 0; i < opaque.coverage.length; i++) {
      if (opaque.coverage[i]! <= 0) continue;
      sawNonZero = true;
      expect(halfAlpha.coverage[i]!).toBeCloseTo(opaque.coverage[i]! * expectedAlpha, 4);
    }
    expect(sawNonZero).toBe(true);
  });
});

describe("noiseDissolve", () => {
  it("keeps a dissolved cell dissolved as progress increases (monotone per cell)", () => {
    const progresses = [0, 0.2, 0.4, 0.6, 0.8, 1];
    const outputs = progresses.map((progress) =>
      evaluate(noiseDissolve, { progress, softness: 0.08, scale: 0.22, seed: 1 }),
    );
    for (let i = 0; i < outputs[0]!.coverage.length; i++) {
      for (let step = 1; step < outputs.length; step++) {
        expect(outputs[step]!.coverage[i]!).toBeLessThanOrEqual(outputs[step - 1]!.coverage[i]! + 1e-6);
      }
    }
  });

  it("is deterministic and varies across cells for a fixed progress", () => {
    const params = { progress: 0.5, softness: 0.08, scale: 0.22, seed: 1 };
    const first = evaluate(noiseDissolve, params);
    const second = evaluate(noiseDissolve, params);
    expect(first.coverage).toEqual(second.coverage);
    expect(new Set(Array.from(first.coverage)).size).toBeGreaterThan(1);
  });
});

describe("ripple", () => {
  it("moves the radial band with time", () => {
    const params = { time: 0, speed: 6, frequency: 0.5, width: 0.18, amount: 0.85, color: "#72d9ff" };
    const cols = 12;
    const rows = 6;
    const cx = cols * 0.5;
    const cy = rows * 0.5;
    for (const time of [0, 1.3]) {
      const output = evaluate(ripple, { ...params, time });
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const index = row * cols + col;
          const x = col + 0.5;
          const y = row + 0.5;
          const phase = Math.hypot(x - cx, y - cy) * params.frequency - time * params.speed;
          const distance = Math.abs(Math.sin(phase));
          const strength = (1 - smoothstep(0, params.width, distance)) * params.amount;
          expect(output.coverage[index]!).toBeCloseTo(strength, 5);
        }
      }
    }
  });

  it("scales coverage by the color's alpha channel", () => {
    const shared = { time: 0, speed: 0, frequency: 0.5, width: 0.5, amount: 1 };
    const opaque = evaluate(ripple, { ...shared, color: "#72d9ffff" });
    const halfAlpha = evaluate(ripple, { ...shared, color: "#72d9ff80" });
    const expectedAlpha = parseGlyphEffectColor("#72d9ff80").opacity;
    let sawNonZero = false;
    for (let i = 0; i < opaque.coverage.length; i++) {
      if (opaque.coverage[i]! <= 0) continue;
      sawNonZero = true;
      expect(halfAlpha.coverage[i]!).toBeCloseTo(opaque.coverage[i]! * expectedAlpha, 4);
    }
    expect(sawNonZero).toBe(true);
  });
});

describe("fieldSynth", () => {
  const COLS = 12;
  const ROWS = 6;

  function scenePoint(col: number, row: number, scale: number): [number, number] {
    return [((col + 0.5) / COLS) * scale, ((row + 0.5) / ROWS) * scale];
  }

  function expectedWave(kind: string, t: number): number {
    const p = t - Math.floor(t);
    if (kind === "triangle") return 4 * Math.abs(p - 0.5) - 1;
    if (kind === "saw") return 2 * p - 1;
    if (kind === "square") return p < 0.5 ? 1 : -1;
    return Math.sin(t * Math.PI * 2);
  }

  function expectedRaw(field: string, x: number, y: number, cx: number, cy: number): number {
    switch (field) {
      case "linearX": return x;
      case "linearY": return y;
      case "diagonal": return (x + y) * Math.SQRT1_2;
      case "angular": return Math.atan2(y - cy, x - cx) / (Math.PI * 2);
      case "spiral": return Math.hypot(x - cx, y - cy) + Math.atan2(y - cy, x - cx) / (Math.PI * 2);
      default: return Math.hypot(x - cx, y - cy); // radial
    }
  }

  function singleVoiceValue(
    field: string,
    wave: string,
    freq: number,
    x: number,
    y: number,
    cx: number,
    cy: number,
    bias = 0.5,
    gain = 1,
  ): number {
    const raw = expectedRaw(field, x, y, cx, cy);
    const combined = expectedWave(wave, raw * freq);
    return Math.min(1, Math.max(0, bias + gain * combined * 0.5));
  }

  it("matches the documented sin/triangle/saw/square waveform shapes at known phases", () => {
    const waves = ["sin", "triangle", "saw", "square"] as const;
    for (const wave of waves) {
      for (const t of [0, 0.25, 0.5, 0.75]) {
        // freq1: 0 makes the oscillator spatially uniform; speed1: -1 turns the
        // fixed `time` value directly into the wave's phase, isolating the
        // waveform shape from the spatial field math tested separately below.
        const output = evaluate(fieldSynth, {
          space: "scene",
          field1: "linearX",
          wave1: wave,
          freq1: 0,
          speed1: -1,
          amp1: 1,
          amp2: 0,
          amp3: 0,
          amp4: 0,
          amp5: 0,
          amp6: 0,
          combine: "add",
          gain: 1,
          bias: 0.5,
          time: t,
          color: "#7df9ff",
        });
        const expected = Math.min(1, Math.max(0, 0.5 + expectedWave(wave, t) * 0.5));
        expect(output.coverage[0]!).toBeCloseTo(expected, 5);
        expect(new Set(Array.from(output.coverage)).size).toBe(1);
      }
    }
  });

  it("keeps the radial field symmetric about the origin", () => {
    const output = evaluate(fieldSynth, {
      space: "scene",
      field1: "radial",
      wave1: "sin",
      freq1: 3,
      speed1: 0,
      time: 0,
      amp1: 1,
      amp2: 0,
      amp3: 0,
      amp4: 0,
      amp5: 0,
      amp6: 0,
      originU: 0.5,
      originV: 0.5,
      scale: 2,
      combine: "add",
    });
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const mirroredCol = COLS - 1 - col;
        expect(output.coverage[row * COLS + mirroredCol]!).toBeCloseTo(output.coverage[row * COLS + col]!, 5);
      }
    }
    for (let col = 0; col < COLS; col++) {
      for (let row = 0; row < ROWS; row++) {
        const mirroredRow = ROWS - 1 - row;
        expect(output.coverage[mirroredRow * COLS + col]!).toBeCloseTo(output.coverage[row * COLS + col]!, 5);
      }
    }
  });

  it("varies the linearX field with column but not row, and linearY with row but not column", () => {
    const base = {
      space: "scene", freq1: 4, speed1: 0, time: 0, amp1: 1,
      amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0, scale: 2, combine: "add", wave1: "saw",
    } as const;
    const linearX = evaluate(fieldSynth, { ...base, field1: "linearX" });
    const linearY = evaluate(fieldSynth, { ...base, field1: "linearY" });

    for (let col = 0; col < COLS; col++) {
      const first = linearX.coverage[col]!;
      for (let row = 1; row < ROWS; row++) expect(linearX.coverage[row * COLS + col]!).toBeCloseTo(first, 5);
    }
    expect(new Set(Array.from({ length: COLS }, (_, col) => linearX.coverage[col])).size).toBeGreaterThan(1);

    for (let row = 0; row < ROWS; row++) {
      const first = linearY.coverage[row * COLS]!;
      for (let col = 1; col < COLS; col++) expect(linearY.coverage[row * COLS + col]!).toBeCloseTo(first, 5);
    }
    expect(new Set(Array.from({ length: ROWS }, (_, row) => linearY.coverage[row * COLS])).size).toBeGreaterThan(1);
  });

  it("produces the documented value for diagonal/angular/spiral fields at known coordinates", () => {
    const scale = 2;
    const cx = 0.5 * scale;
    const cy = 0.5 * scale;
    const cases = [
      { field: "diagonal", wave: "sin", freq: 5 },
      { field: "angular", wave: "triangle", freq: 3 },
      { field: "spiral", wave: "saw", freq: 2 },
    ] as const;
    const cells = [[2, 1], [9, 4], [6, 3]] as const;

    for (const { field, wave, freq } of cases) {
      const output = evaluate(fieldSynth, {
        space: "scene", field1: field, wave1: wave, freq1: freq, speed1: 0, time: 0,
        amp1: 1, amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0, scale, combine: "add",
      });
      for (const [col, row] of cells) {
        const [x, y] = scenePoint(col, row, scale);
        const expected = singleVoiceValue(field, wave, freq, x, y, cx, cy);
        expect(output.coverage[row * COLS + col]!).toBeCloseTo(expected, 5);
      }
    }
  });

  it("keeps the noise field deterministic, bounded, spatially varying, and time-dependent", () => {
    const params = {
      space: "scene", field1: "noise", wave1: "sin", freq1: 3, speed1: 0.5, time: 1.2,
      amp1: 1, amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0, scale: 2, gain: 1, bias: 0.5, combine: "add",
    } as const;
    const first = evaluate(fieldSynth, params);
    const second = evaluate(fieldSynth, params);
    expect(first.coverage).toEqual(second.coverage);
    expect(Array.from(first.coverage).every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(new Set(Array.from(first.coverage)).size).toBeGreaterThan(1);

    const laterTime = evaluate(fieldSynth, { ...params, time: params.time + 5 });
    expect(laterTime.coverage).not.toEqual(first.coverage);
  });

  it("evolves the noise field in place instead of translating it sideways with time", () => {
    const params = {
      space: "scene", field1: "noise", wave1: "sin", freq1: 3, speed1: 0.7, time: 1.4,
      amp1: 1, amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0, scale: 2, gain: 1, bias: 0.5, combine: "add",
    } as const;

    // Reference for the pre-fix behavior: `time` translated the sampled x
    // coordinate through a static 2D lattice, so the whole field scrolled
    // sideways rather than morphing. If the fix regresses to a translation,
    // this reference and the real output converge back to equal.
    function oldSynthHash(x: number, y: number): number {
      const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return h - Math.floor(h);
    }
    function oldSynthNoise(x: number, y: number): number {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const a = oldSynthHash(xi, yi), b = oldSynthHash(xi + 1, yi);
      const c = oldSynthHash(xi, yi + 1), d = oldSynthHash(xi + 1, yi + 1);
      return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    }
    function oldScrollingCoverage(col: number, row: number): number {
      const [x, y] = scenePoint(col, row, params.scale);
      const raw = 2 * oldSynthNoise(x * params.freq1 + params.time * params.speed1, y * params.freq1) - 1;
      return Math.min(1, Math.max(0, params.bias + params.gain * raw * 0.5));
    }

    const output = evaluate(fieldSynth, params);
    let differsSomewhere = false;
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (Math.abs(output.coverage[row * COLS + col]! - oldScrollingCoverage(col, row)) > 1e-4) {
          differsSomewhere = true;
          break;
        }
      }
    }
    expect(differsSomewhere).toBe(true);
  });

  it("treats amp 0 as fully excluding a voice regardless of its other params", () => {
    const base = {
      space: "scene", field1: "radial", wave1: "sin", freq1: 4, speed1: 0.3, time: 0.7, amp1: 1,
      amp3: 0, amp4: 0, amp5: 0, amp6: 0, combine: "multiply", scale: 2,
    } as const;
    const withGarbageVoice2 = evaluate(fieldSynth, {
      ...base, amp2: 0, field2: "noise", wave2: "square", freq2: 99, speed2: 123,
    });
    const withDefaultVoice2 = evaluate(fieldSynth, { ...base, amp2: 0 });
    expect(withGarbageVoice2.coverage).toEqual(withDefaultVoice2.coverage);
    expect(withGarbageVoice2.glyph).toEqual(withDefaultVoice2.glyph);
  });

  it("blends a low-amp voice as a mix weight instead of crushing the result via multiply", () => {
    const output = evaluate(fieldSynth, {
      space: "scene",
      field1: "linearX", wave1: "square", freq1: 0, speed1: 0, amp1: 1,
      field2: "linearX", wave2: "square", freq2: 0, speed2: -0.5, amp2: 0.05,
      amp3: 0, amp4: 0, amp5: 0, amp6: 0,
      combine: "multiply",
      gain: 1, bias: 0.5,
      time: 1,
      color: "#7df9ff",
    });
    // voice1: phase = -1*0 = 0 -> square(0) = +1 -> combined after voice1 = 1*1 = 1
    // voice2: phase = -1*(-0.5) = 0.5 -> square(0.5) = -1
    // mix-weight fold: combined = 1 + 0.05 * (multiply(1, -1) - 1) = 1 - 0.1 = 0.9
    // value = clamp01(0.5 + 0.9*0.5) = 0.95 -- close to voice1 alone (1.0),
    // not the near-zero crush a naive `combine(combined, amp*o)` multiply would give.
    expect(output.coverage[0]!).toBeCloseTo(0.95, 5);
    expect(output.coverage[0]!).toBeGreaterThan(0.8);
    expect(new Set(Array.from(output.coverage)).size).toBe(1);
  });

  it("folds every combine mode through the documented amp mix-weight formula", () => {
    const combineFn: Record<string, (a: number, b: number) => number> = {
      add: (a, b) => a + b,
      multiply: (a, b) => a * b,
      max: (a, b) => Math.max(a, b),
      min: (a, b) => Math.min(a, b),
      difference: (a, b) => Math.abs(a - b),
    };
    const o1 = 1; // square(0) with freq1: 0, speed1: 0, time: 1
    const o2 = -1; // square(0.5) with freq2: 0, speed2: -0.5, time: 1
    const amp1 = 0.6;
    const amp2 = 0.4;

    for (const combine of ["add", "multiply", "max", "min", "difference"] as const) {
      const combinedAfterFirst = amp1 * o1;
      const combinedAfterSecond = combinedAfterFirst + amp2 * (combineFn[combine]!(combinedAfterFirst, o2) - combinedAfterFirst);
      const expected = Math.min(1, Math.max(0, 0.5 + combinedAfterSecond * 0.5));

      const output = evaluate(fieldSynth, {
        space: "scene",
        field1: "linearX", wave1: "square", freq1: 0, speed1: 0, amp1,
        field2: "linearX", wave2: "square", freq2: 0, speed2: -0.5, amp2,
        amp3: 0, amp4: 0, amp5: 0, amp6: 0,
        combine, gain: 1, bias: 0.5, time: 1, color: "#7df9ff",
      });
      expect(output.coverage[0]!).toBeCloseTo(expected, 5);
    }
  });

  it("blends active voices' colors by contribution when voiceColors is enabled", () => {
    const equalWeight = {
      space: "scene",
      field1: "linearX", wave1: "square", freq1: 0, speed1: 0, amp1: 1, color1: "#ff0000",
      field2: "linearX", wave2: "square", freq2: 0, speed2: 0, amp2: 1, color2: "#0000ff",
      amp3: 0, amp4: 0, amp5: 0, amp6: 0,
      combine: "add", gain: 1, bias: 0.5, time: 1,
      voiceColors: true,
      color: "#111111", colorB: "#eeeeee", gradient: 1,
    } as const;
    const withVoiceColors = evaluate(fieldSynth, equalWeight);
    const withoutVoiceColors = evaluate(fieldSynth, { ...equalWeight, voiceColors: false });

    // Both voices share the same phase (freq: 0, speed: 0 => phase 0 => square = +1),
    // so amp 1 vs amp 1 is an exact 50/50 blend of #ff0000 and #0000ff.
    expect(withVoiceColors.color[0]).toBe((128 << 16) | (0 << 8) | 128);
    expect(withVoiceColors.color[0]).not.toBe(parseGlyphEffectColor("#ff0000").packed);
    expect(withVoiceColors.color[0]).not.toBe(parseGlyphEffectColor("#0000ff").packed);
    expect(withVoiceColors.color[0]).not.toBe(withoutVoiceColors.color[0]);

    const unequalWeight = evaluate(fieldSynth, { ...equalWeight, amp2: 0.5 });
    const red = (unequalWeight.color[0]! >> 16) & 0xff;
    const blue = unequalWeight.color[0]! & 0xff;
    expect(red).toBeGreaterThan(blue); // voice1 (red) has more weight than voice2 (blue)
  });

  it("modulates output color by surface shade only when lit > 0", () => {
    const shade = new Float32Array(COLS * ROWS).fill(0.25);
    const params = {
      space: "scene", field1: "linearX", wave1: "square", freq1: 0, speed1: 0, amp1: 1,
      amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0, combine: "add", gain: 1, bias: 0.5, time: 1,
      color: "#7df9ff", gradient: 0,
    } as const;
    const litOff = evaluate(fieldSynth, { ...params, lit: 0 }, { shade });
    const litOn = evaluate(fieldSynth, { ...params, lit: 1 }, { shade });

    const raw = parseGlyphEffectColor("#7df9ff").packed;
    const scaleChannel = (channel: number, factor: number) => Math.round(channel * factor);
    const expectedLit =
      (scaleChannel((raw >> 16) & 0xff, 0.25) << 16) |
      (scaleChannel((raw >> 8) & 0xff, 0.25) << 8) |
      scaleChannel(raw & 0xff, 0.25);

    expect(litOff.color[0]).toBe(raw);
    expect(litOn.color[0]).toBe(expectedLit);
    expect(litOn.color[0]).not.toBe(litOff.color[0]);
  });

  it("is deterministic for identical params and time on a generated surface", () => {
    const params = {
      space: "surface", field1: "spiral", wave1: "triangle", freq1: 3.5, speed1: 0.4, amp1: 1,
      field2: "noise", wave2: "sin", freq2: 2, speed2: 0.2, amp2: 0.6,
      amp3: 0, amp4: 0, amp5: 0, amp6: 0, combine: "add", time: 4.25, scale: 2,
    } as const;
    const surface = cubeSurface("wall");
    const first = evaluate(fieldSynth, params, surface);
    const second = evaluate(fieldSynth, params, surface);
    expect(first.glyph).toEqual(second.glyph);
    expect(first.coverage).toEqual(second.coverage);
    expect(first.color).toEqual(second.color);
  });

  // offsetWallSurface pushes the generated wall surface's world position far
  // from the world origin (mirrors any real mesh not sitting at (0,0,0)).
  // Before the fix, a generated-surface cell's origin was cx = originU*scale,
  // cy = originV*scale — a fixed point in *unbounded world-plane units* near
  // (0, 0). Once the mesh sits thousands of units away, that fixed point is
  // nowhere near the face, so nothing in origin's 0..1 range meaningfully
  // moves the pattern, and origin (0.5, 0.5) does not land on the face at
  // all. The fix maps origin into the current coplanar group's own covered
  // u/v bounds, so both properties below hold regardless of the mesh's
  // absolute world position.
  function offsetWallSurface(offsetCol: number) {
    const surface = cubeSurface("wall");
    for (let i = 0; i < surface.worldPosition.length; i += 3) surface.worldPosition[i] += offsetCol;
    return surface;
  }

  it("centers a radial pattern on the visible face when origin is (0.5, 0.5), even far from the world origin", () => {
    const output = evaluate(fieldSynth, {
      space: "surface", field1: "radial", wave1: "sin", freq1: 2.5, speed1: 0, time: 0,
      amp1: 1, amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0, combine: "add",
      originU: 0.5, originV: 0.5, scale: 1,
    }, offsetWallSurface(2000));

    // Full mirror symmetry about the grid's exact center (col 5.5, row 2.5)
    // is only possible if origin (0.5, 0.5) landed exactly on that center —
    // this wall surface's single coplanar group spans the entire covered
    // grid, so its u/v bounds midpoint IS the grid center. The old fixed
    // cx=cy=0.5 center would not produce this symmetry once the mesh is
    // offset far from the world origin.
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const mirrored = output.coverage[(ROWS - 1 - row) * COLS + (COLS - 1 - col)]!;
        expect(output.coverage[row * COLS + col]!).toBeCloseTo(mirrored, 5);
      }
    }
  });

  it("moves the pattern center on the face when originU sweeps from 0.2 to 0.8", () => {
    const base = {
      space: "surface", field1: "radial", wave1: "sin", freq1: 2.5, speed1: 0, time: 0,
      amp1: 1, amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0, combine: "add", scale: 1, originV: 0.5,
    } as const;
    const surface = offsetWallSurface(2000);
    const low = evaluate(fieldSynth, { ...base, originU: 0.2 }, surface);
    const high = evaluate(fieldSynth, { ...base, originU: 0.8 }, surface);

    // The group's u bounds are [2000*0.25, 2011*0.25] = [500, 502.75] (width
    // 2.75, unaffected by the offset). At col=6, row=2 -> u=501.5, v=-0.5:
    // originU 0.2 -> cx=500.55, Δu=0.95; originU 0.8 -> cx=502.2, Δu=-0.7.
    // With cy=-0.625 fixed (originV 0.5), Δv=0.125 both times.
    const cell = 2 * COLS + 6;
    const expectedLow = singleVoiceValue("radial", "sin", 2.5, 501.5, -0.5, 500.55, -0.625);
    const expectedHigh = singleVoiceValue("radial", "sin", 2.5, 501.5, -0.5, 502.2, -0.625);
    expect(low.coverage[cell]!).toBeCloseTo(expectedLow, 4);
    expect(high.coverage[cell]!).toBeCloseTo(expectedHigh, 4);
    expect(low.coverage[cell]!).not.toBeCloseTo(high.coverage[cell]!, 2);

    // Sanity: before the fix, cx/cy stayed near 0.2..0.8 regardless of the
    // mesh's ~500-unit offset, so this specific cell's reading barely moved
    // across the same sweep — the opposite of the large swing asserted above.
    expect(Math.abs(expectedLow - expectedHigh)).toBeGreaterThan(0.5);
  });
});

describe("regression: blank-ramp glyphs are not stripped", () => {
  it("renders a genuine blank ( ) cell for the darkest band of a leading-space ramp", () => {
    // bias: 0.53 (not the schema default 0.5) so the darkest band lands just
    // above zero (value 0.03) instead of exactly 0 — evaluate() skips writing
    // a cell outright when value <= 0, so landing exactly on 0 would make this
    // assertion pass vacuously (default-filled " ") instead of exercising the
    // ramp-indexing write path.
    const output = evaluate(fieldSynth, {
      space: "scene", field1: "linearX", wave1: "square", freq1: 0, speed1: -0.5, amp1: 1,
      amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0, combine: "add", gain: 1, bias: 0.53,
      time: 1, glyphs: " .:-=+*#%@",
    });
    expect(output.channels[0]! & GlyphEffectOutputChannel.Glyph).toBeTruthy();
    expect(output.glyph[0]).toBe(" ");
  });

  it("also renders blank for a Checkerboard-style two-glyph leading-space ramp", () => {
    const output = evaluate(fieldSynth, {
      space: "scene", field1: "linearX", wave1: "square", freq1: 0, speed1: -0.5, amp1: 1,
      amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0, combine: "add", gain: 1, bias: 0.53,
      time: 1, glyphs: " █",
    });
    expect(output.channels[0]! & GlyphEffectOutputChannel.Glyph).toBeTruthy();
    expect(output.glyph[0]).toBe(" ");
  });

  it("contrasts with a SET consumer (matrixRain) that still strips spaces from its glyph pattern", () => {
    const output = evaluate(matrixRain, {
      space: "scene", direction: "right", glyphs: " HOLA",
      speedMin: 0, speedMax: 0, density: 1, trail: 14, seed: 2, time: 0,
    });
    const active = output.glyph.filter((_, index) => output.coverage[index]! > 0);
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((glyph) => glyph !== " ")).toBe(true);
  });
});

describe("regression: field-synth generated-surface isotropy", () => {
  it("keeps a radial pattern isotropic on a generated surface even though cols (12) != rows (6)", () => {
    // The generated wall surface has u = col * 0.25, v = -row * 0.25 (12 cols,
    // 6 rows), a fact about surfaceBasisSample's world-plane metric, independent
    // of where origin maps to. With originU/originV at 0.5, origin is placed at
    // this single coplanar group's covered-bounds midpoint: cx = 0.5*2.75 =
    // 1.375 (u spans [0, 2.75]), cy = -1.25 + 0.5*1.25 = -0.625 (v spans
    // [-1.25, 0]) — the grid's exact center, (col, row) = (5.5, 2.5).
    //
    // Two cells whose (Δu, Δv) offsets from that center are transposes of each
    // other: (col=8,row=2) -> (Δu,Δv)=(0.625,0.125), (col=6,row=0) ->
    // (Δu,Δv)=(0.125,0.625). hypot(0.625,0.125) === hypot(0.125,0.625), so an
    // isotropic radial field must read the same value at both cells. If the
    // generated-surface coordinate were ever normalized per-axis by sceneCols
    // (12) vs sceneRows (6), or the per-face origin mapping weighted U and V
    // bounds unevenly, this symmetry would break.
    const output = evaluate(fieldSynth, {
      space: "surface", field1: "radial", wave1: "sin", freq1: 2.5, speed1: 0, time: 0,
      amp1: 1, amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0, combine: "add",
      originU: 0.5, originV: 0.5, scale: 1,
    }, cubeSurface("wall"));

    const cellA = 2 * 12 + 8; // col=8, row=2
    const cellB = 0 * 12 + 6; // col=6, row=0
    expect(output.coverage[cellA]!).toBeCloseTo(output.coverage[cellB]!, 5);
  });
});

describe("regression: generated-surface direction stays consistent as a mesh rotates", () => {
  // Simulates a flat face (e.g. an extruded word-art front cap) spinning
  // rigidly about the world Y axis, the way `<GlyphMesh rotation={[turn, ...]}>`
  // turntables a mesh under a fixed camera. `worldPosition`/`normal` are what
  // the real rasterizer would hand a mounted effect after projecting that
  // rotated geometry into the same fixed 24x12 output grid.
  const COLS = 24;
  const ROWS = 12;

  function rotatedCapSurface(thetaDeg: number) {
    const theta = (thetaDeg * Math.PI) / 180;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const worldPosition = new Float32Array(COLS * ROWS * 3);
    const normal = new Float32Array(COLS * ROWS * 3);
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const offset = (row * COLS + col) * 3;
        const lx = col - COLS / 2;
        const ly = -(row - ROWS / 2);
        worldPosition[offset] = lx * cosT;
        worldPosition[offset + 1] = ly;
        worldPosition[offset + 2] = -lx * sinT + 20;
        normal[offset] = sinT;
        normal[offset + 1] = 0;
        normal[offset + 2] = cosT;
      }
    }
    return { worldPosition, normal };
  }

  function contextFor(surface: { worldPosition: Float32Array; normal: Float32Array }): AnyContext<AnyParams> {
    const length = COLS * ROWS;
    return {
      base: { cols: COLS, rows: ROWS, length, worldPosition: surface.worldPosition, normal: surface.normal },
      coordinates: { cellToSceneGrid: [1, 0, 0, 1, 0, 0], sceneGridSize: [COLS, ROWS], localCellFootprint: [1, 1] },
    } as never;
  }

  // Before the fix, `horizontal = vertical x normal` inherited a hard sign
  // flip from the dominant-axis canonicalization in `surfaceBasisSample`
  // every time a rotating normal crossed that boundary (here, between 135deg
  // and 150deg: nx=0.707 is x-dominant and positive at 135deg, nz=-0.866 is
  // z-dominant and negative at 150deg, which used to flip the whole normal
  // and, with it, only `horizontal` — not `vertical`, which is quadratic in
  // the normal and already invariant to that flip). That asymmetric flip is
  // exactly a "right" (horizontal-axis) flow reversing mid-rotation while
  // "down" (vertical-axis) held steady.
  it("keeps the horizontal surface axis' screen mapping stable across the dominant-axis boundary", () => {
    const before = generatedSurfaceField(contextFor(rotatedCapSurface(135)));
    const after = generatedSurfaceField(contextFor(rotatedCapSurface(150)));
    const beforeGroup = before?.groups[0];
    const afterGroup = after?.groups[0];
    expect(beforeGroup).toBeDefined();
    expect(afterGroup).toBeDefined();

    // The horizontal (u) axis' screen-space Jacobian must land on the same
    // screen side (same sign) before and after crossing the boundary...
    expect(Math.sign(beforeGroup!.dyDu)).toBe(Math.sign(afterGroup!.dyDu));
    // ...matching the vertical (v) axis, which was already stable.
    expect(Math.sign(beforeGroup!.dxDv)).toBe(Math.sign(afterGroup!.dxDv));
  });

  // A second boundary crossing (315deg x-negative-dominant -> 330deg
  // z-negative-dominant), so the fix isn't pinned to one specific angle.
  it("keeps both surface axes' screen mapping stable across a second dominant-axis boundary", () => {
    const before = generatedSurfaceField(contextFor(rotatedCapSurface(315)));
    const after = generatedSurfaceField(contextFor(rotatedCapSurface(330)));
    const beforeGroup = before?.groups[0];
    const afterGroup = after?.groups[0];
    expect(beforeGroup).toBeDefined();
    expect(afterGroup).toBeDefined();
    expect(Math.sign(beforeGroup!.dyDu)).toBe(Math.sign(afterGroup!.dyDu));
    expect(Math.sign(beforeGroup!.dxDv)).toBe(Math.sign(afterGroup!.dxDv));
  });

  // matrix-rain's per-cell flow (`projectedSurfaceDirection`) is built
  // directly from this same fitted Jacobian (`dxDu/dyDu` for left/right,
  // `dxDv/dyDv` for up/down — see stock.ts's `domainCoordinate` /
  // `projectedSurfaceDirection`), so pinning the Jacobian's sign here pins
  // the actual on-screen advection direction matrix-rain (and every other
  // generated-surface effect) reads for "right"/"left"/"down"/"up".
  it("keeps every direction's screen mapping internally consistent (matches the sign vocabulary matrixRain reads)", () => {
    for (const theta of [135, 150, 315, 330]) {
      const field = generatedSurfaceField(contextFor(rotatedCapSurface(theta)));
      const group = field!.groups[0]!;
      // "right"/"left" read (dxDu, dyDu); "down"/"up" read (dxDv, dyDv).
      // Each pair must stay a well-defined, non-degenerate flow vector.
      expect(Math.hypot(group.dxDu, group.dyDu)).toBeGreaterThan(0.5);
      expect(Math.hypot(group.dxDv, group.dyDv)).toBeGreaterThan(0.5);
    }
  });
});

describe("fieldSynth: subcellRes braille", () => {
  const COLS = 12;

  // `space: "scene"` with a square glyphs=1 field, freq1=1 gives every
  // (col+0.5) center a mod-1 fractional part of exactly 0.5 — the p<0.5
  // decision boundary itself — which is degenerate (float-fragile) for a
  // hand-computed assertion. freq1=1.1 escapes that alignment while staying
  // simple enough to compute by hand; every margin below is checked to sit
  // comfortably away from the 0.5 threshold so float rounding can't flip it.
  const HAND_PARAMS = {
    space: "scene" as const,
    field1: "linearX",
    wave1: "square",
    freq1: 1.1,
    speed1: 0,
    time: 0,
    amp1: 1,
    amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0,
    combine: "add",
    scale: 12, // cancels the /sceneCols normalization: resolved x === col + 0.5
    bias: 0.5,
    gain: 1,
    subcellRes: "2x4",
  };

  it("1x1 (default, and explicit) is byte-identical to the pre-subcell ramp-indexed output", () => {
    const { subcellRes: _drop, ...withoutSubcellRes } = HAND_PARAMS;
    const omitted = evaluate(fieldSynth, withoutSubcellRes); // hits the schema default ("1x1")
    const explicit1x1 = evaluate(fieldSynth, { ...withoutSubcellRes, subcellRes: "1x1" });
    // col=5,row=2 -> index 29: center x=5.5, u=5.5*1.1=6.05, fract=0.05 < 0.5 -> wave=+1
    const index = 2 * COLS + 5;
    const expectedGlyphs = " .:-=+*#%@";
    const rampMax = expectedGlyphs.length - 1;
    const expectedValue = Math.min(1, Math.max(0, 0.5 + 1 * 1 * 0.5)); // wave=+1 -> value=1
    const expectedGlyph = expectedGlyphs[Math.min(rampMax, Math.max(0, Math.round(expectedValue * rampMax)))];
    expect(omitted.glyph[index]).toBe(expectedGlyph);
    expect(explicit1x1.glyph[index]).toBe(expectedGlyph);
    expect(explicit1x1.glyph).toEqual(omitted.glyph);
    expect(explicit1x1.coverage).toEqual(omitted.coverage);
  });

  it("produces the hand-computed Braille bitmask for a known field at a specific cell", () => {
    // col=5, row=2 -> index 29. scale=12 makes resolved x exactly col+0.5, so
    // finite-differencing neighbors gives an exact dxCol=1, dyCol=dxRow=0
    // (linearX doesn't depend on y) — no approximation error to account for.
    //
    // Hand computation (wave "square": p = fract(x*freq1); on iff p < 0.5):
    //   center  x=5.5   -> u=6.05  -> fract=0.05  -> ON  (passes the value>0 cell gate)
    //   dotCol0 x=5.25  -> u=5.775 -> fract=0.775 -> OFF (margin 0.275 from 0.5)
    //   dotCol1 x=5.75  -> u=6.325 -> fract=0.325 -> ON  (margin 0.175 from 0.5)
    // linearX ignores y, so all 4 rows repeat the same per-column on/off state:
    //   col0 (bits 0x01,0x02,0x04,0x40) -> all OFF
    //   col1 (bits 0x08,0x10,0x20,0x80) -> all ON
    // expected mask = 0x08|0x10|0x20|0x80 = 0xB8
    const output = evaluate(fieldSynth, HAND_PARAMS);
    const index = 2 * COLS + 5;
    const glyph = output.glyph[index]!;
    expect(glyph.length).toBe(1);
    const codepoint = glyph.codePointAt(0)!;
    expect(codepoint).toBeGreaterThanOrEqual(0x2800);
    expect(codepoint).toBeLessThanOrEqual(0x28ff);
    const mask = codepoint - 0x2800;
    expect(mask).toBe(0xb8);
  });

  it("renders at visibly finer grain than 1x1 on the same moiré preset params", () => {
    const moire = fieldSynth.presets?.find((preset) => preset.name === "Moiré rings")!.params;
    const coarse = evaluate(fieldSynth, moire as Record<string, number | string | boolean>, { withUv: true });
    const fine = evaluate(fieldSynth, { ...moire, subcellRes: "2x4" } as Record<string, number | string | boolean>, { withUv: true });
    // A finer grain means more DISTINCT rendered symbols carrying pattern
    // detail than the coarse ramp-indexed pass can express in the same
    // cell count — not just "a braille character appears somewhere".
    const coarseDistinct = new Set(coarse.glyph.filter((g, i) => coarse.coverage[i]! > 0));
    const fineDistinct = new Set(fine.glyph.filter((g, i) => fine.coverage[i]! > 0));
    expect(fineDistinct.size).toBeGreaterThan(coarseDistinct.size);
    for (const g of fine.glyph) {
      if (g === " ") continue;
      const cp = g.codePointAt(0)!;
      expect(cp).toBeGreaterThanOrEqual(0x2800);
      expect(cp).toBeLessThanOrEqual(0x28ff);
    }
  });
});

describe("effect presets", () => {
  it("validates every catalog effect's shipped presets against its own schema and evaluates cleanly", () => {
    for (const effect of GlyphEffectCatalog) {
      const presets = effect.presets ?? [];
      for (const preset of presets) {
        for (const key of Object.keys(preset.params)) {
          expect(key in effect.parameterSchema).toBe(true);
        }
        const overrides = preset.params as Record<string, number | string | boolean>;
        let output: ReturnType<typeof evaluate> | undefined;
        expect(() => {
          output = evaluate(effect, overrides);
        }).not.toThrow();
        const wroteChannel = Array.from(output!.channels).some((channel) => channel !== 0);
        const wroteCoverage = Array.from(output!.coverage).some((coverage) => coverage > 0);
        expect(wroteChannel || wroteCoverage).toBe(true);
      }
    }
  });

  it("ships the field-synth preset gallery documented in AGENTS.md (~18 curated presets)", () => {
    expect(fieldSynth.presets?.length).toBeGreaterThanOrEqual(18);
  });
});

describe("matrix-rain volumetric (space: \"object\") lane-boundary stability", () => {
  // Regression for a flicker reported with the effect CLOCK PAUSED (`time`
  // held constant): as a curved mesh rotates, glyphcss's supersampled solid
  // rasterizer picks `objectPosition` per output cell from the nearest
  // COVERED subcell to that cell's screen-space center (see AGENTS.md's
  // Retained Glyph Effects section). Which subcell wins can flip to a
  // different point on the surface — sometimes a different facet entirely —
  // as coverage shifts within the cell, even for a tiny rotation. A hard
  // `Math.floor` lane boundary turned that small sample jump into a swap to
  // a totally unrelated `hash2` bucket, reading as a strand popping in/out.
  // `objectVolumetricAlongLane`'s `edgeFade` softens the gate near a lane
  // boundary instead of hard-committing.
  //
  // Reproduces with a REAL rasterized rotating mesh (not a synthetic
  // objectPosition array, unlike the two invariance tests above) because the
  // bug is specifically about how the RASTERIZER samples objectPosition
  // under supersampling as the mesh moves, not the effect's math in
  // isolation — and calls the actually-shipped `objectVolumetricAlongLane`
  // (exported above) rather than a reimplementation, so a future edit to the
  // margin or lane formula is caught here directly.
  function rotateY(v: Vec3, angleDeg: number): Vec3 {
    const a = (angleDeg * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    const [x, y, z] = v;
    return [x * c + z * s, y, -x * s + z * c];
  }

  // A curved multi-facet strip standing in for a bent word-art text mesh
  // (glyphcss's `curve` param) — X = depth, Y = width, Z = height, matching
  // AGENTS.md's object-frame convention for matrix-rain's volumetric field.
  function curvedStripPolygonsAtAngle(angleDeg: number): Polygon[] {
    const segs = 60, radius = 20, halfHeight = 10, arc = 1.4;
    const polys: Polygon[] = [];
    for (let i = 0; i < segs; i++) {
      const a0 = -arc / 2 + (arc * i) / segs;
      const a1 = -arc / 2 + (arc * (i + 1)) / segs;
      const objectVertices: Vec3[] = [
        [radius * Math.sin(a0), radius * (1 - Math.cos(a0)), -halfHeight],
        [radius * Math.sin(a1), radius * (1 - Math.cos(a1)), -halfHeight],
        [radius * Math.sin(a1), radius * (1 - Math.cos(a1)), halfHeight],
        [radius * Math.sin(a0), radius * (1 - Math.cos(a0)), halfHeight],
      ];
      polys.push({
        vertices: objectVertices.map((v) => rotateY(v, angleDeg)),
        objectVertices,
        color: "#2ea043",
      });
    }
    return polys;
  }

  function laneFrame(angleDeg: number) {
    const grid = rasterizeToCells(buildRasterizeContext({
      camera: createGlyphOrthographicCamera({ rotX: 18, rotY: 0, zoom: 45 }),
      grid: { cols: 200, rows: 110, cellAspect: 2 },
      polygons: curvedStripPolygonsAtAngle(angleDeg),
      mode: "solid",
      useColors: true,
      doubleSided: true,
      supersample: 4,
      retainObjectPosition: true,
      directionalLight: { direction: [0.3, 0.4, 1], intensity: 0.7 },
      ambientLight: { intensity: 0.4 },
    }));
    const n = grid.cols * grid.rows;
    const lane = new Int32Array(n);
    const edgeFade = new Float64Array(n);
    const covered = new Uint8Array(n);
    const context = {
      base: { cols: grid.cols, rows: grid.rows, length: n, objectPosition: grid.objectPosition },
    } as unknown as AnyContext<AnyParams>;
    for (let i = 0; i < n; i++) {
      const v = objectVolumetricAlongLane(context, i, "down", 1);
      if (!v) continue;
      covered[i] = 1;
      lane[i] = v.lane;
      edgeFade[i] = v.edgeFade;
    }
    return { lane, edgeFade, covered };
  }

  it("keeps VISIBLE lane pops (both frames well clear of the softened boundary) below threshold across a small rotation sweep, clock paused", () => {
    // 0.25 degree steps: fine enough that a genuine, intentional lane
    // crossing (the surface sliding a full lane width) essentially never
    // happens in a 2-degree sweep, so any pop is quantization noise from the
    // rasterizer's per-cell object-position sampling, not real motion.
    const steps = 16;
    const frames = Array.from({ length: steps + 1 }, (_, s) => laneFrame(s * 0.25));

    // "raw" churn: the lane hash changed at all between adjacent frames —
    // includes crossings the edge-fade softening masks (low opacity on at
    // least one side), so this alone doesn't measure visible flicker.
    // "visible" pop: the lane changed AND both frames were well clear of the
    // softened boundary (edgeFade > 0.5) — an actual jarring strand swap.
    let rawChurn = 0;
    let visiblePops = 0;
    let totalCoveredPairs = 0;
    for (let s = 1; s < frames.length; s++) {
      const prev = frames[s - 1]!, cur = frames[s]!;
      for (let i = 0; i < prev.lane.length; i++) {
        if (!prev.covered[i] || !cur.covered[i]) continue;
        totalCoveredPairs++;
        if (prev.lane[i] === cur.lane[i]) continue;
        rawChurn++;
        if (prev.edgeFade[i]! > 0.5 && cur.edgeFade[i]! > 0.5) visiblePops++;
      }
    }

    // Measured on this exact mesh/sweep shape: with `OBJECT_LANE_EDGE_MARGIN`
    // set to 0 (no softening — every crossing counts as "visible" since the
    // gate collapses to a hard step), this sweep produced `rawChurn === 6`
    // and `visiblePops === 6` over 248 covered-cell-pairs — i.e. every raw
    // crossing was a hard, unmasked pop. With the shipped 0.18 margin, the
    // same sweep shape keeps `visiblePops` meaningfully below `rawChurn` by
    // masking crossings near the boundary. `visiblePops <= 3` catches a
    // regression back toward that 1:1 unsoftened ratio: on this exact
    // mesh/sweep, `OBJECT_LANE_EDGE_MARGIN = 0` (no softening) produces
    // `rawChurn === visiblePops === 14` (every crossing counts as visible,
    // by construction, when the gate collapses to a hard step) over 1824
    // covered-cell-pairs; the shipped 0.18 margin keeps the SAME
    // `rawChurn === 14` but cuts `visiblePops` to 4 (~29%). `visiblePops
    // <= 8` sits well below the unsoftened rate (14) and above the measured
    // softened rate (4), so it fails hard on a regression toward "every
    // crossing is visible" while tolerating normal variance. `rawChurn`
    // (asserted separately, > 0) confirms real lane-boundary crossings are
    // actually happening in this sweep, so a low `visiblePops` isn't just
    // "nothing crossed a boundary".
    expect(totalCoveredPairs).toBeGreaterThan(0);
    expect(rawChurn).toBeGreaterThan(0);
    expect(visiblePops).toBeLessThanOrEqual(8);
  });
});

describe("field-synth ink mode", () => {
  const INK_STROKES = ["-", "\\", "|", "/"];

  it("traces a contour with oriented strokes instead of shading by level", () => {
    // A linear ramp across X: the iso-level is crossed on exactly one column
    // band, and its contour runs vertically — so the strokes must be "|".
    const out = evaluate(fieldSynth, {
      subcellRes: "ink",
      space: "scene",
      field1: "linearX", wave1: "saw", freq1: 1, speed1: 0, amp1: 1,
      amp2: 0, scale: 1, gain: 1, bias: 0.5, inkLevels: 1,
    }, { withUv: true });

    const inked = out.glyph.filter((g) => g !== " ");
    expect(inked.length).toBeGreaterThan(0);
    // Only contour glyphs are emitted — never a shade ramp character.
    for (const g of inked) expect(INK_STROKES).toContain(g);
    // The interior is left empty for whatever renders underneath: a contour
    // marks a boundary, so it can never cover the whole grid the way the
    // ramp path does.
    expect(inked.length).toBeLessThan(out.glyph.length);
  });

  it("outlines a plateau instead of filling it", () => {
    // A square wave is flat on top and flat at the bottom with an abrupt step
    // between. Ink marks the STEP and leaves both plateaus empty — an outline
    // mode never fills, and the step is already a gradient the crossing test
    // sees. Nothing but strokes may be emitted.
    const square = evaluate(fieldSynth, {
      subcellRes: "ink",
      space: "scene",
      field1: "linearX", wave1: "square", freq1: 1, speed1: 0, amp1: 1,
      amp2: 0, scale: 1, gain: 1, bias: 0.5, inkLevels: 4,
    }, { withUv: true });
    const marks = square.glyph.filter((g) => g !== " ");
    expect(marks.length).toBeGreaterThan(0);
    for (const g of marks) expect(INK_STROKES).toContain(g);
    expect(square.glyph.filter((g) => g === "█")).toHaveLength(0);
    // The plateaus dominate the grid, so an outline must leave most of it bare.
    expect(marks.length).toBeLessThan(square.glyph.length / 2);
  });

  it("contours more of the field as levels increase", () => {
    const at = (inkLevels: number) => evaluate(fieldSynth, {
      subcellRes: "ink", space: "scene",
      field1: "radial", wave1: "sin", freq1: 1, speed1: 0, amp1: 1,
      amp2: 0, scale: 2, gain: 1, bias: 0.5, inkLevels,
    }, { withUv: true }).glyph.filter((g) => g !== " ").length;
    // Each added cut is another contour line through the same field.
    expect(at(6)).toBeGreaterThan(at(1));
  });

  // Hostile-URL safety (pre-existing issue, fixed here): the URL repair
  // gate only catches enum/string validation failures, never a numeric
  // range, so a crafted URL setting `inkLevels` far past the schema's
  // slider max reaches this loop unclamped — one level-crossing check per
  // level per cell, which used to hang the tab. `evaluate()` must clamp to
  // `INK_LEVELS_MAX` itself and complete promptly, producing the exact same
  // output as the clamp ceiling.
  it("clamps an enormous inkLevels instead of hanging", () => {
    const params = {
      subcellRes: "ink" as const, space: "scene" as const,
      field1: "radial" as const, wave1: "sin" as const, freq1: 1, speed1: 0, amp1: 1,
      amp2: 0, scale: 2, gain: 1, bias: 0.5,
    };
    const start = performance.now();
    const hostile = evaluate(fieldSynth, { ...params, inkLevels: 5e6 }, { withUv: true });
    const elapsedMs = performance.now() - start;
    const clamped = evaluate(fieldSynth, { ...params, inkLevels: INK_LEVELS_MAX }, { withUv: true });

    expect(elapsedMs).toBeLessThan(1000);
    expect(hostile.glyph).toEqual(clamped.glyph);
  });

  it("leaves 1x1 and 2x4 untouched", () => {
    const ramp = evaluate(fieldSynth, {
      subcellRes: "1x1", space: "scene",
      field1: "linearX", wave1: "saw", freq1: 1, speed1: 0, amp1: 1, amp2: 0,
    }, { withUv: true });
    for (const g of ramp.glyph.filter((c) => c !== " ")) expect(INK_STROKES).not.toContain(g);

    const braille = evaluate(fieldSynth, {
      subcellRes: "2x4", space: "scene",
      field1: "linearX", wave1: "saw", freq1: 1, speed1: 0, amp1: 1, amp2: 0,
    }, { withUv: true });
    const dots = braille.glyph.filter((g) => g !== " ");
    expect(dots.length).toBeGreaterThan(0);
    for (const g of dots) expect(g.codePointAt(0)).toBeGreaterThanOrEqual(0x2800);
  });
});

describe("field-synth per-voice frame and argmax", () => {
  const render = (overrides: Record<string, number | string | boolean>) =>
    evaluate(fieldSynth, { space: "scene", amp2: 0, ...overrides }, { withUv: true });

  it("rotates a linear field by its own angle", () => {
    const base = render({ field1: "linearX", wave1: "sin", freq1: 2, speed1: 0, amp1: 1 });
    const turned = render({ field1: "linearX", wave1: "sin", freq1: 2, speed1: 0, amp1: 1, angle1: 90 });
    // 90° turns vertical stripes into horizontal ones: the same field, sampled
    // along a different axis, so the rendered grid must differ.
    expect(turned.glyph.join("")).not.toBe(base.glyph.join(""));
    // ...and a rotation of a RADIAL field changes nothing, because its level
    // sets are circles about the same centre.
    const radial = render({ field1: "radial", wave1: "sin", freq1: 2, speed1: 0, amp1: 1 });
    const radialTurned = render({ field1: "radial", wave1: "sin", freq1: 2, speed1: 0, amp1: 1, angle1: 37 });
    expect(radialTurned.glyph.join("")).toBe(radial.glyph.join(""));
  });

  it("gives each voice its own origin", () => {
    const centred = render({ field1: "radial", wave1: "sin", freq1: 3, speed1: 0, amp1: 1 });
    const moved = render({ field1: "radial", wave1: "sin", freq1: 3, speed1: 0, amp1: 1, originU1: 0.4 });
    expect(moved.glyph.join("")).not.toBe(centred.glyph.join(""));
  });

  it("argmax outputs flat regions keyed to the winning voice", () => {
    const out = render({
      combine: "argmax",
      field1: "linearX", wave1: "sin", freq1: 2, speed1: 0, amp1: 1,
      field2: "linearY", wave2: "sin", freq2: 2, speed2: 0, amp2: 1,
      field3: "diagonal", wave3: "sin", freq3: 2, speed3: 0, amp3: 1,
    });
    const inked = out.glyph.filter((g) => g !== " ");
    expect(inked.length).toBeGreaterThan(0);
    // Three active voices means at most three distinct levels — one flat tone
    // per region — where a value-combining mode would spread across the ramp.
    expect(new Set(inked).size).toBeLessThanOrEqual(3);

    const blended = render({
      combine: "max",
      field1: "linearX", wave1: "sin", freq1: 2, speed1: 0, amp1: 1,
      field2: "linearY", wave2: "sin", freq2: 2, speed2: 0, amp2: 1,
      field3: "diagonal", wave3: "sin", freq3: 2, speed3: 0, amp3: 1,
    });
    expect(new Set(blended.glyph.filter((g) => g !== " ")).size).toBeGreaterThan(3);
  });
});

describe("field-synth field-program IR refactor: byte-identity regression", () => {
  // Independently confirmed via `git stash` against the parent commit
  // (before this file's IR/volumetric/duty/phase changes existed): these are
  // the EXACT hashes `fieldSynth.program.evaluate()` produced for default
  // params and every shipped preset, at both 1x1 and (subcellRes-sensitive)
  // 2x4/ink, before the refactor. Phase 2 must keep producing them forever —
  // `evaluate()` now compiles to and runs through the field-program IR
  // (`evaluateFieldProgram`) for the ENTIRE 2D path, and this is the proof
  // that compile is behavior-preserving (VOLUMETRIC.md acceptance
  // criterion 1). See `packages/glyphcss/src/render/objectExit.test.ts`'s
  // own "byte-identity regression" test for the same pattern.
  function fnv1a(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }

  function pinnedEvaluate(overrides: Record<string, number | string | boolean> = {}) {
    const cols = 24, rows = 12, length = cols * rows;
    const params = { ...defaultGlyphEffectParams(fieldSynth), ...overrides };
    const glyph = new Array<string>(length).fill("#");
    const coverage = new Float32Array(length).fill(1);
    const color = new Uint32Array(length).fill(GlyphEffectNoColor);
    const uv0 = new Float32Array(length * 2);
    for (let i = 0; i < length; i++) {
      uv0[i * 2] = (i % cols) / (cols - 1);
      uv0[i * 2 + 1] = ((i / cols) | 0) / (rows - 1);
    }
    const shade = new Float32Array(length).fill(0.8);
    const output = {
      glyph: new Array<string>(length).fill(" "),
      color: new Uint32Array(length).fill(GlyphEffectNoColor),
      coverage: new Float32Array(length),
      channels: new Uint8Array(length),
    };
    fieldSynth.program.validateParams?.(params as never);
    fieldSynth.program.evaluate({
      params,
      state: undefined,
      base: { cols, rows, length, glyph, coverage, color, uv0, shade },
      input: { cols, rows, length, glyph, coverage, color },
      target: { coverage },
      coordinates: { cellToSceneGrid: [1, 0, 0, 1, 0, 0], sceneGridSize: [cols, rows], localCellFootprint: [1, 1] },
      scratch: { images: [], floatFields: [], uintFields: [], glyphFields: [], samples: [] },
      output,
    } as never);
    return output;
  }

  function hashOf(overrides: Record<string, number | string | boolean> = {}): string {
    const output = pinnedEvaluate(overrides);
    return fnv1a(
      output.glyph.join("") + "|"
      + Array.from(output.color).join(",") + "|"
      + Array.from(output.coverage).map((v) => v.toFixed(6)).join(","),
    );
  }

  // Canonical (key-sorted, so property insertion order can't perturb the
  // string) JSON serialization of a preset's raw `params` object, independent
  // of `pinnedEvaluate`'s synthetic 2D context entirely.
  //
  // P1-A (VOLUMETRIC-2.md §3 fix review): `pinnedEvaluate` feeds a flat
  // `uv0`-driven grid with no `objectPosition`/`objectExit` — it never
  // exercises `space: "object"` + `render: "carve"`'s marched/carved-stage
  // path. A volumetric preset's param that only THAT path consumes (the
  // Menger sponge's `marchFade: 1 → 2.5` retrofit, VOLUMETRIC-2.md §3's
  // "invisible at the oblique camera" fix) can therefore change with zero
  // effect on `hashOf`'s rendered-output hash, silently defeating the whole
  // point of a byte-identity pin: a real behavior change shipped with no
  // forced re-pin. Hashing the preset's full params object ALONGSIDE the
  // rendered-output hash closes that gap the cheap, robust way — it doesn't
  // need to know which params the synthetic path can or can't see, because
  // it hashes literally every key, so ANY preset param edit forces a
  // deliberate re-pin here even when `hashOf` itself can't detect it.
  function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }

  function paramsHashOf(params: Record<string, number | string | boolean>): string {
    return fnv1a(canonicalJson(params));
  }

  it("reproduces the pre-refactor hash for default params, at 1x1/2x4/ink", () => {
    expect(hashOf()).toBe("7d1375dc");
    expect(hashOf({ subcellRes: "2x4" })).toBe("38ffa16d");
    expect(hashOf({ subcellRes: "ink" })).toBe("694ada7d");
  });

  it("reproduces the pre-refactor hash for every shipped preset, and pins each preset's full params object independently of the synthetic evaluator", () => {
    // `render`: `hashOf`'s rendered-output hash, from the synthetic 2D
    // evaluate context above — unaffected by a param the synthetic path
    // can't see (e.g. a volumetric-carve-only param). `params`: the raw
    // `preset.params` object's own canonical-JSON hash — sensitive to
    // EVERY key, so it is what actually catches a change like that.
    const expected: Record<string, { render: string; params: string }> = {
      "Ink cells": { render: "7fa42eeb", params: "c43055bd" },
      "Cube tiles": { render: "c91fca95", params: "b83f76bc" },
      Sunburst: { render: "73166434", params: "72b93f9c" },
      "Ring pulse": { render: "bf16c9f7", params: "4cfa46f9" },
      "Plaid weave": { render: "def63013", params: "d467d1e0" },
      "Sonar ping": { render: "e0a1b9a6", params: "bc091ee9" },
      Lattice: { render: "182f881a", params: "3b077229" },
      Vortex: { render: "479de6c0", params: "5db648cc" },
      Lava: { render: "13f39efc", params: "b8cf531a" },
      "Static rain": { render: "7b1403a1", params: "1282a546" },
      "Moiré rings": { render: "972334a7", params: "3658b2ef" },
      Checkerboard: { render: "931fc935", params: "7e2af903" },
      "Warp core": { render: "b9699196", params: "b515d692" },
      Bubbles: { render: "0c45d5d0", params: "cde5c8f3" },
      Aurora: { render: "83b81a3f", params: "0e8af11d" },
      Zebra: { render: "ed2427c1", params: "1b455525" },
      Kaleidoscope: { render: "0da9183a", params: "53ab981e" },
      Halftone: { render: "77ba200a", params: "023ba7ef" },
      Weave: { render: "fd19e86f", params: "dcc5eb00" },
      "Pulse grid": { render: "829c38e1", params: "92ab91cb" },
      Nebula: { render: "987c9199", params: "ee4f824d" },
      // Added in VOLUMETRIC.md's Phase 6 (the /synth preset gallery), after
      // this file's IR/volumetric/duty/phase changes existed — pinned the
      // same way as every preset above it, just not part of the pre-refactor
      // baseline this describe block otherwise guards.
      //
      // `render` is the pre-existing pinned value and stays exactly
      // "c6e1efad" — the marchFade 1 → 2.5 retrofit is invisible to the
      // synthetic evaluator, as documented above. `params` is the
      // deliberate re-pin this fix exists for: it changed the moment
      // `marchFade` did, and is pinned here at its POST-retrofit value.
      "Menger sponge": { render: "c6e1efad", params: "c33b2487" },
      // Added in VOLUMETRIC-3.md's Phase 4 — the depth-3 sibling recipe
      // (needs the 9-voice bump). Pinned the same way as every preset above
      // it.
      "Menger sponge (depth 3)": { render: "311c9985", params: "1c2bb271" },
      // Added in VOLUMETRIC-2.md's Phase 3 — pinned the same way as every
      // preset above it.
      "Sierpinski pyramid": { render: "945f235b", params: "52c55f59" },
      "Gyroid xray": { render: "770251e5", params: "19475e84" },
      // Added in VOLUMETRIC-3.md's Phase 3 — the sphere-tracing oracle's own
      // fixtures (real SDF voices, not the linear recipe the two presets
      // above use). Pinned the same way as every preset above it.
      "Menger SDF": { render: "256a7e47", params: "07881474" },
      "Sierpinski SDF": { render: "9d7a7abb", params: "da384260" },
    };
    const presets = fieldSynth.presets ?? [];
    expect(presets.map((p) => p.name).sort()).toEqual(Object.keys(expected).sort());
    for (const preset of presets) {
      const params = preset.params as Record<string, number | string | boolean>;
      expect(hashOf(params)).toBe(expected[preset.name]!.render);
      expect(paramsHashOf(params)).toBe(expected[preset.name]!.params);
    }
  });
});

describe("field-synth volumetric (space: \"object\")", () => {
  it("dynamicRequirements asks for objectPosition only when space is \"object\", and adds objectExit only when render is \"carve\" (VOLUMETRIC.md's Carve section)", () => {
    const defaults = defaultGlyphEffectParams(fieldSynth);
    expect(fieldSynth.program.dynamicRequirements?.(defaults)).toEqual([]);
    expect(fieldSynth.program.dynamicRequirements?.({ ...defaults, space: "object" })).toEqual(["objectPosition"]);
    expect(fieldSynth.program.dynamicRequirements?.({ ...defaults, render: "carve" })).toEqual([]);
    expect(fieldSynth.program.dynamicRequirements?.({ ...defaults, space: "object", render: "carve" }))
      .toEqual(["objectPosition", "objectExit"]);
  });

  it("resolves the volumetric domain coordinate from objectPosition * scale: the same object-space point renders identically regardless of grid position (matches the matrixRain volumetric pattern)", () => {
    const cols = 12, rows = 6, length = cols * rows;
    const objectPosition = new Float32Array(length * 3).fill(NaN);
    const iA = 0;
    const iB = length - 1;
    const point: [number, number, number] = [1.3, -0.7, 2.1];
    objectPosition[iA * 3] = point[0]; objectPosition[iA * 3 + 1] = point[1]; objectPosition[iA * 3 + 2] = point[2];
    objectPosition[iB * 3] = point[0]; objectPosition[iB * 3 + 1] = point[1]; objectPosition[iB * 3 + 2] = point[2];

    const output = evaluate(fieldSynth, {
      space: "object", field1: "radial", wave1: "sin", freq1: 3, speed1: 0.4, amp1: 1,
      amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0, combine: "add", time: 1.5, scale: 2,
    }, { objectPosition });

    expect(output.coverage[iA]).toBe(output.coverage[iB]);
    expect(output.glyph[iA]).toBe(output.glyph[iB]);
    expect(output.color[iA]).toBe(output.color[iB]);
  });

  it("is invariant to the mesh's world position/rotation — only objectPosition drives it", () => {
    const cols = 12, rows = 6, length = cols * rows;
    const objectPosition = new Float32Array(length * 3);
    for (let i = 0; i < length; i++) {
      objectPosition[i * 3] = (i % cols) - cols / 2;
      objectPosition[i * 3 + 1] = Math.floor(i / cols) - rows / 2;
      objectPosition[i * 3 + 2] = Math.sin(i) * 2;
    }
    const worldA = new Float32Array(length * 3).fill(1);
    const worldB = new Float32Array(length * 3).fill(-99);
    const params = {
      space: "object", field1: "linearZ", wave1: "sin", freq1: 2, speed1: 0.3, amp1: 1,
      amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0, combine: "add", time: 1.1, scale: 1.5,
    };
    const outputA = evaluate(fieldSynth, params, { objectPosition, worldPosition: worldA });
    const outputB = evaluate(fieldSynth, params, { objectPosition, worldPosition: worldB });
    expect(outputA.glyph).toEqual(outputB.glyph);
    expect(Array.from(outputA.color)).toEqual(Array.from(outputB.color));
    expect(Array.from(outputA.coverage)).toEqual(Array.from(outputB.coverage));
  });

  it("degrades to the generated-surface fallback when objectPosition is unavailable (wireframe/voxel)", () => {
    const output = evaluate(fieldSynth, {
      space: "object", field1: "radial", wave1: "sin", freq1: 3, speed1: 0, amp1: 1,
      amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0, combine: "add", time: 0, scale: 2,
    }, cubeSurface("wall"));
    expect(Array.from(output.coverage).some((v) => v > 0)).toBe(true);
  });

  it("supports 2x4 and ink subcell modes under the volumetric branch by finite-differencing neighboring objectPosition", () => {
    const cols = 12, rows = 6, length = cols * rows;
    const objectPosition = new Float32Array(length * 3);
    for (let i = 0; i < length; i++) {
      objectPosition[i * 3] = ((i % cols) - cols / 2) * 0.3;
      objectPosition[i * 3 + 1] = (Math.floor(i / cols) - rows / 2) * 0.3;
      objectPosition[i * 3 + 2] = 0;
    }
    const base = {
      space: "object", field1: "linearX", wave1: "square", freq1: 2, speed1: 0, amp1: 1,
      amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0, combine: "add", time: 0, scale: 1,
    };
    const braille = evaluate(fieldSynth, { ...base, subcellRes: "2x4" }, { objectPosition });
    const dots = braille.glyph.filter((g) => g !== " ");
    expect(dots.length).toBeGreaterThan(0);
    for (const g of dots) expect(g.codePointAt(0)!).toBeGreaterThanOrEqual(0x2800);

    const ink = evaluate(fieldSynth, { ...base, subcellRes: "ink", inkLevels: 2, gain: 1, bias: 0.5 }, { objectPosition });
    const marks = ink.glyph.filter((g) => g !== " ");
    expect(marks.length).toBeGreaterThan(0);
    for (const g of marks) expect(["-", "\\", "|", "/"]).toContain(g);
  });
});

describe("field-synth voice layers (VOLUMETRIC.md's Step 3)", () => {
  it("a layer with no active voices is skipped — an empty layer doesn't multiply-annihilate the stack", () => {
    // Voice 1 on layer 1, voice 4 on layer 3, layer 2 left unpopulated.
    // Default layerBlend3 is "multiply" (the doc's stated default), so if the
    // empty layer 2 wrongly entered that fold with a phantom folded value,
    // the whole per-cell result would collapse to one constant regardless of
    // position. The empty-layer skip is what keeps layer 1 and layer 3's own
    // spatial variation alive through the stack.
    const out = evaluate(fieldSynth, {
      space: "scene",
      field1: "linearX", wave1: "square", freq1: 3, speed1: 0, amp1: 1, layer1: 1,
      amp2: 0, amp3: 0,
      field4: "linearY", wave4: "square", freq4: 5, speed4: 0, amp4: 1, layer4: 3,
      amp5: 0, amp6: 0,
    }, { withUv: true });
    expect(new Set(out.glyph).size).toBeGreaterThan(1);
  });

  it("voiceColors blends across ALL active voices regardless of which layer they fold into (the Phase 2 landmine fix)", () => {
    // Voice 1 (layer 1, red) and voice 6 (layer 3, blue) both active; layer 2
    // is unpopulated. A broken index (e.g. reading a per-layer filtered voice
    // list at a flat index) would silently drop voice 6's contribution.
    //
    // Two object-space points chosen so exactly one voice contributes at
    // each: at point A, voice1 (linearX) sits at a sin peak (|o|=1) while
    // voice6 (linearY) sits on a zero-crossing (|o|=0) — the fallback loop's
    // weight is amp*|o|, so point A's blended color is voice1's red exactly.
    // Point B swaps which axis is at the peak, isolating voice6's blue.
    const cols = 12, rows = 6, length = cols * rows;
    const objectPosition = new Float32Array(length * 3).fill(NaN);
    const iA = 0;
    const iB = length - 1;
    objectPosition[iA * 3] = 0.25; objectPosition[iA * 3 + 1] = 0; objectPosition[iA * 3 + 2] = 0;
    objectPosition[iB * 3] = 0; objectPosition[iB * 3 + 1] = 0.25; objectPosition[iB * 3 + 2] = 0;

    const out = evaluate(fieldSynth, {
      space: "object", scale: 1, voiceColors: true, combine: "multiply",
      field1: "linearX", wave1: "sin", freq1: 1, speed1: 0, amp1: 1, layer1: 1, color1: "#ff0000",
      amp2: 0, amp3: 0, amp4: 0, amp5: 0,
      field6: "linearY", wave6: "sin", freq6: 1, speed6: 0, amp6: 1, layer6: 3, color6: "#0000ff",
    }, { objectPosition });

    expect(out.color[iA]).toBe(0xff0000);
    expect(out.color[iB]).toBe(0x0000ff);
  });
});

describe("field-synth argmax voice color identity (reviewer P1: layer-local winner index vs. flat voice order)", () => {
  it("reports the WINNING voice's own color, not the color at its layer-local fold position", () => {
    // Exact reviewer repro: only voice5 (red) and voice6 (blue) are active,
    // both assigned to layer 3 — the only populated layer, so single-layer
    // argmax validation still passes. `foldVoices` loops layer 3's filtered
    // voice array (just [voice5, voice6]) at LOCAL indices 0/1; a winner
    // reported as that local index would read `parsedVoiceColors[0]`
    // (voice1's default color) instead of voice5's red.
    const cols = 12, rows = 6, length = cols * rows;
    const objectPosition = new Float32Array(length * 3).fill(NaN);
    const iA = 0;
    objectPosition[iA * 3] = 0.25; objectPosition[iA * 3 + 1] = 0; objectPosition[iA * 3 + 2] = 0;

    const out = evaluate(fieldSynth, {
      space: "object", scale: 1, voiceColors: true, combine: "argmax",
      amp1: 0, amp2: 0, amp3: 0, amp4: 0,
      field5: "linearX", wave5: "sin", freq5: 1, speed5: 0, amp5: 1, layer5: 3, color5: "#ff0000",
      field6: "linearY", wave6: "sin", freq6: 1, speed6: 0, amp6: 1, layer6: 3, color6: "#0000ff",
    }, { objectPosition });

    // At (0.25, 0, 0): voice5 (linearX) samples sin(0.25*2π)=1 (its peak);
    // voice6 (linearY) samples sin(0)=0 — voice5 wins outright.
    expect(out.color[iA]).toBe(0xff0000);
  });

  it("pins the single-layer (default layer 1) argmax + voiceColors case unchanged — the Cube tiles preset hash covers this end-to-end", () => {
    // Same shape as the reviewer repro, but both voices sit on the DEFAULT
    // (single) layer — the fallback path (`sourceIndex ?? k`) where
    // layer-local index and flat index coincide, so this must be byte-
    // identical to pre-fix behavior.
    const cols = 12, rows = 6, length = cols * rows;
    const objectPosition = new Float32Array(length * 3).fill(NaN);
    const iA = 0;
    objectPosition[iA * 3] = 0.25; objectPosition[iA * 3 + 1] = 0; objectPosition[iA * 3 + 2] = 0;

    const out = evaluate(fieldSynth, {
      space: "object", scale: 1, voiceColors: true, combine: "argmax",
      field1: "linearX", wave1: "sin", freq1: 1, speed1: 0, amp1: 1, color1: "#ff0000",
      field2: "linearY", wave2: "sin", freq2: 1, speed2: 0, amp2: 1, color2: "#0000ff",
      amp3: 0, amp4: 0, amp5: 0, amp6: 0,
    }, { objectPosition });

    expect(out.color[iA]).toBe(0xff0000);
  });
});

describe("field-synth layer argmax validation (VOLUMETRIC.md's Step 3, \"argmax and voice colors\")", () => {
  it("rejects when a populated layer resolves (via inherited patch-level combine) to argmax while more than one layer is populated", () => {
    const params = {
      ...defaultGlyphEffectParams(fieldSynth),
      combine: "argmax",
      amp1: 1, layer1: 1,
      amp2: 1, layer2: 2,
      // layerCombine1/layerCombine2 default "inherit" -> both resolve to the
      // patch-level "argmax".
    };
    expect(() => fieldSynth.program.validateParams?.(params as never)).toThrow();
  });

  it("accepts a multi-layer patch whose every populated layer overrides to an explicit value op, regardless of a dead patch-level argmax", () => {
    const params = {
      ...defaultGlyphEffectParams(fieldSynth),
      combine: "argmax", // dead metadata: every populated layer overrides below
      amp1: 1, layer1: 1, layerCombine1: "add",
      amp2: 1, layer2: 2, layerCombine2: "max",
    };
    expect(() => fieldSynth.program.validateParams?.(params as never)).not.toThrow();
  });

  it("single-layer argmax stays valid exactly as today, even with other (unpopulated) layer slots present", () => {
    const params = {
      ...defaultGlyphEffectParams(fieldSynth),
      combine: "argmax",
      amp1: 1, layer1: 1,
      amp2: 1, layer2: 1, // both voices on layer 1; layers 2/3 unpopulated
    };
    expect(() => fieldSynth.program.validateParams?.(params as never)).not.toThrow();
  });
});

// VOLUMETRIC-2.md §4 P2: field-synth's `validateParams` throw sites carry a
// stable `code` from `GLYPH_FIELD_SYNTH_VALIDATION_RULES`, so the website's
// URL hydration repair table can key off a real exported cross-package
// contract instead of a hand-maintained mirror of these throw sites (the
// prior "completeness" test asserted its own mirror's length against
// itself — circular, caught nothing). Each case below exercises the REAL
// validator (not a re-derivation of its logic), and `validateParams` itself
// structurally enforces the tag: any throw from `validateGlyphRamp` /
// `validatePositiveScale` / `validateFieldSynthLayers` /
// `validateFieldSynthRender` that isn't tagged with a registered id surfaces
// as a distinct "unregistered rule id" error instead of propagating
// untagged — so a NEW throw site added to one of those validators without
// registering its code fails the instant it's exercised (here or by any
// other test/caller), rather than rotting silently.
describe("field-synth validation rule ids (VOLUMETRIC-2.md §4 P2)", () => {
  const defaults = defaultGlyphEffectParams(fieldSynth) as Record<string, number | string | boolean>;

  function codeOf(overrides: Record<string, number | string | boolean>): string | undefined {
    try {
      fieldSynth.program.validateParams?.({ ...defaults, ...overrides } as never);
      return undefined;
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const code = (error as Partial<GlyphFieldSynthValidationError>).code;
      // Fails loudly (distinct message) if a throw site's error was never
      // tagged, or tagged with an id `validateParams`'s own wrapper doesn't
      // recognize — see the wrapper's doc in stock.ts.
      expect((error as Error).message).not.toMatch(/no registered rule id/);
      return code;
    }
  }

  const KNOWN_TRIGGERS: Record<GlyphFieldSynthValidationRuleId, Record<string, number | string | boolean>> = {
    "empty-glyphs": { glyphs: "" },
    "non-positive-scale": { scale: 0 },
    "multi-layer-argmax": {
      combine: "argmax",
      amp1: 1, layer1: 1, layerCombine1: "inherit",
      amp2: 1, layer2: 2, layerCombine2: "inherit",
    },
    "carve-requires-object-space": { render: "carve", space: "surface" },
    "xray-subcell-unsupported": { render: "xray", space: "object", subcellRes: "2x4" },
  };

  it("tags every registered rule id's real trigger with exactly that id", () => {
    for (const id of GLYPH_FIELD_SYNTH_VALIDATION_RULES) {
      expect(codeOf(KNOWN_TRIGGERS[id]), id).toBe(id);
    }
  });

  it("every known trigger throws (sanity — proves the trigger set isn't stale)", () => {
    for (const id of GLYPH_FIELD_SYNTH_VALIDATION_RULES) {
      expect(() => fieldSynth.program.validateParams?.({ ...defaults, ...KNOWN_TRIGGERS[id] } as never), id).toThrow();
    }
  });

  it("GLYPH_FIELD_SYNTH_VALIDATION_RULES has no dead (untriggerable) id and no undocumented trigger", () => {
    expect(new Set(Object.keys(KNOWN_TRIGGERS))).toEqual(new Set(GLYPH_FIELD_SYNTH_VALIDATION_RULES));
  });
});

// The doc's exact Menger recipe, compiled from FLAT PARAMS (space: "object"
// so the volumetric branch is live; scale 1 so objectPosition reads directly
// as the unit-domain coordinate). Depth 1 needs 3 voices (one layer); depth 2
// needs 6 (two layers) — exactly SYNTH_VOICES, the schema's documented
// depth-2 ceiling. Module scope (not local to one describe block) so both the
// schema-frontend membership test below AND the carve smoke test
// (VOLUMETRIC.md acceptance 5, "Use the Phase 3 Menger recipe params
// verbatim") share the exact same recipe.
function mengerAxisVoice(prefix: number, field: string, freq: number, layer: number): Record<string, number | string | boolean> {
  return {
    [`field${prefix}`]: field, [`wave${prefix}`]: "square", [`freq${prefix}`]: freq, [`speed${prefix}`]: 0,
    [`amp${prefix}`]: 1, [`duty${prefix}`]: 1 / 3, [`phase${prefix}`]: -1 / 3, [`layer${prefix}`]: layer,
  };
}

function mengerLayerShape(layer: number): Record<string, number | string | boolean> {
  return {
    [`layerCombine${layer}`]: "add",
    [`layerThresholdOn${layer}`]: true,
    [`layerThreshold${layer}`]: 0,
    [`layerInvert${layer}`]: true,
    [`layerBlend${layer}`]: "min",
    [`layerAmp${layer}`]: 1,
  };
}

function mengerParams(depth: 1 | 2): Record<string, number | string | boolean> {
  const params: Record<string, number | string | boolean> = {
    space: "object", scale: 1,
    ...mengerAxisVoice(1, "linearX", 1, 1),
    ...mengerAxisVoice(2, "linearY", 1, 1),
    ...mengerAxisVoice(3, "linearZ", 1, 1),
    ...mengerLayerShape(1),
  };
  if (depth === 2) {
    Object.assign(
      params,
      mengerAxisVoice(4, "linearX", 3, 2),
      mengerAxisVoice(5, "linearY", 3, 2),
      mengerAxisVoice(6, "linearZ", 3, 2),
      mengerLayerShape(2),
    );
  }
  return params;
}

describe("field-synth Menger membership — schema frontend (VOLUMETRIC.md acceptance criterion 2a)", () => {
  // First-principles reference, identical to fieldProgram.test.ts's own
  // depth-3 IR test (VOLUMETRIC.md acceptance 2b) — reused as a REFERENCE,
  // not by importing the evaluator under test.
  function mengerSolid(x: number, y: number, z: number, depth: number): boolean {
    let cx = x, cy = y, cz = z;
    for (let d = 0; d < depth; d++) {
      cx *= 3; cy *= 3; cz *= 3;
      const mx = ((cx % 3) + 3) % 3, my = ((cy % 3) + 3) % 3, mz = ((cz % 3) + 3) % 3;
      const midCount = (mx > 1 && mx < 2 ? 1 : 0) + (my > 1 && my < 2 ? 1 : 0) + (mz > 1 && mz < 2 ? 1 : 0);
      if (midCount >= 2) return false;
      cx = cx - Math.floor(cx / 3) * 3; cy = cy - Math.floor(cy / 3) * 3; cz = cz - Math.floor(cz / 3) * 3;
    }
    return true;
  }

  // Offset grid over the unit cube, off the 1/3 base-3 digit boundaries
  // (1/3 is float-inexact) — same construction and resolution as
  // fieldProgram.test.ts's depth-3 IR test, proven safe there.
  const GRID_N = 27;
  function evaluateMengerGrid(depth: 1 | 2) {
    const cols = GRID_N * GRID_N, rows = GRID_N, length = GRID_N * GRID_N * GRID_N;
    const objectPosition = new Float32Array(length * 3);
    const points: [number, number, number][] = [];
    let idx = 0;
    for (let ix = 0; ix < GRID_N; ix++) {
      for (let iy = 0; iy < GRID_N; iy++) {
        for (let iz = 0; iz < GRID_N; iz++) {
          const x = (ix + 0.5) / GRID_N, y = (iy + 0.5) / GRID_N, z = (iz + 0.5) / GRID_N;
          objectPosition[idx * 3] = x; objectPosition[idx * 3 + 1] = y; objectPosition[idx * 3 + 2] = z;
          points.push([x, y, z]);
          idx++;
        }
      }
    }
    const glyph = new Array<string>(length).fill("#");
    const coverage = new Float32Array(length).fill(1);
    const color = new Uint32Array(length).fill(GlyphEffectNoColor);
    const output = {
      glyph: new Array<string>(length).fill(" "),
      color: new Uint32Array(length).fill(GlyphEffectNoColor),
      coverage: new Float32Array(length),
      channels: new Uint8Array(length),
    };
    const params = { ...defaultGlyphEffectParams(fieldSynth), ...mengerParams(depth) };
    fieldSynth.program.validateParams?.(params as never);
    fieldSynth.program.evaluate({
      params,
      state: undefined,
      base: { cols, rows, length, glyph, coverage, color, objectPosition },
      input: { cols, rows, length, glyph, coverage, color },
      target: { coverage },
      coordinates: { cellToSceneGrid: [1, 0, 0, 1, 0, 0], sceneGridSize: [cols, rows], localCellFootprint: [1, 1] },
      scratch: { images: [], floatFields: [], uintFields: [], glyphFields: [], samples: [] },
      output,
    } as never);
    return { output, points };
  }

  it.each([1, 2] as const)("depth %i solid/hole membership matches the first-principles reference", (depth) => {
    const { output, points } = evaluateMengerGrid(depth);
    let solidCount = 0, holeCount = 0;
    for (let i = 0; i < points.length; i++) {
      const [x, y, z] = points[i]!;
      const refSolid = mengerSolid(x, y, z, depth);
      const engineSolid = output.coverage[i]! > 0;
      expect(engineSolid).toBe(refSolid);
      if (refSolid) solidCount++; else holeCount++;
    }
    // Sanity: both solid and hole regions are actually sampled (otherwise the
    // per-point assertion above would pass vacuously).
    expect(solidCount).toBeGreaterThan(0);
    expect(holeCount).toBeGreaterThan(0);
  });

  it("default bias 0.5 / gain 1 maps hole (-1) to clamp01(0)=0 and solid (+1) to 1 with no bespoke tuning", () => {
    const { output, points } = evaluateMengerGrid(1);
    let checkedHole = false, checkedSolid = false;
    for (let i = 0; i < points.length && !(checkedHole && checkedSolid); i++) {
      const [x, y, z] = points[i]!;
      const refSolid = mengerSolid(x, y, z, 1);
      if (refSolid && !checkedSolid) {
        expect(output.coverage[i]).toBe(1);
        checkedSolid = true;
      }
      if (!refSolid && !checkedHole) {
        expect(output.coverage[i]).toBe(0);
        checkedHole = true;
      }
    }
    expect(checkedHole && checkedSolid).toBe(true);
  });
});

// The base-2 sibling of `mengerAxisVoice`/`mengerLayerShape`/`mengerParams`
// above: `duty 1/2`/`phase -1/2` (upper-half selector) and `freq 2^(k-1)`
// instead of the middle-third/base-3 constants — exactly the shipped
// "Sierpinski pyramid" preset's own recipe (stock.ts), reproduced here
// param-key-for-param-key rather than imported, so a preset-authoring typo
// would show up as a test failure instead of both sides agreeing by
// construction.
function sierpinskiAxisVoice(prefix: number, field: string, freq: number, layer: number): Record<string, number | string | boolean> {
  return {
    [`field${prefix}`]: field, [`wave${prefix}`]: "square", [`freq${prefix}`]: freq, [`speed${prefix}`]: 0,
    [`amp${prefix}`]: 1, [`duty${prefix}`]: 1 / 2, [`phase${prefix}`]: -1 / 2, [`layer${prefix}`]: layer,
  };
}

function sierpinskiLayerShape(layer: number): Record<string, number | string | boolean> {
  return {
    [`layerCombine${layer}`]: "add",
    [`layerThresholdOn${layer}`]: true,
    [`layerThreshold${layer}`]: 0,
    [`layerInvert${layer}`]: true,
    [`layerBlend${layer}`]: "min",
    [`layerAmp${layer}`]: 1,
  };
}

function sierpinskiParams(depth: 1 | 2): Record<string, number | string | boolean> {
  const params: Record<string, number | string | boolean> = {
    space: "object", scale: 1,
    ...sierpinskiAxisVoice(1, "linearX", 1, 1),
    ...sierpinskiAxisVoice(2, "linearY", 1, 1),
    ...sierpinskiAxisVoice(3, "linearZ", 1, 1),
    ...sierpinskiLayerShape(1),
  };
  if (depth === 2) {
    Object.assign(
      params,
      sierpinskiAxisVoice(4, "linearX", 2, 2),
      sierpinskiAxisVoice(5, "linearY", 2, 2),
      sierpinskiAxisVoice(6, "linearZ", 2, 2),
      sierpinskiLayerShape(2),
    );
  }
  return params;
}

describe("field-synth Sierpinski membership — schema frontend (VOLUMETRIC-2.md acceptance criterion 4)", () => {
  // First-principles reference, identical to fieldProgram.test.ts's own
  // depth-3 IR test and its `sierpinskiSolidRef` — reused as a REFERENCE,
  // not by importing the evaluator under test.
  function sierpinskiSolid(x: number, y: number, z: number, depth: number): boolean {
    let cx = x, cy = y, cz = z;
    for (let d = 0; d < depth; d++) {
      cx *= 2; cy *= 2; cz *= 2;
      const mx = ((cx % 2) + 2) % 2, my = ((cy % 2) + 2) % 2, mz = ((cz % 2) + 2) % 2;
      const upperCount = (mx >= 1 ? 1 : 0) + (my >= 1 ? 1 : 0) + (mz >= 1 ? 1 : 0);
      if (upperCount >= 2) return false;
      cx = cx - Math.floor(cx / 2) * 2; cy = cy - Math.floor(cy / 2) * 2; cz = cz - Math.floor(cz / 2) * 2;
    }
    return true;
  }

  // Offset grid over the unit cube, off the 1/2 (and deeper 1/4) base-2
  // digit boundaries — same construction as the Menger grid above.
  const GRID_N = 24;
  function evaluateSierpinskiGrid(depth: 1 | 2) {
    const cols = GRID_N * GRID_N, rows = GRID_N, length = GRID_N * GRID_N * GRID_N;
    const objectPosition = new Float32Array(length * 3);
    const points: [number, number, number][] = [];
    let idx = 0;
    for (let ix = 0; ix < GRID_N; ix++) {
      for (let iy = 0; iy < GRID_N; iy++) {
        for (let iz = 0; iz < GRID_N; iz++) {
          const x = (ix + 0.37) / GRID_N, y = (iy + 0.37) / GRID_N, z = (iz + 0.37) / GRID_N;
          objectPosition[idx * 3] = x; objectPosition[idx * 3 + 1] = y; objectPosition[idx * 3 + 2] = z;
          points.push([x, y, z]);
          idx++;
        }
      }
    }
    const glyph = new Array<string>(length).fill("#");
    const coverage = new Float32Array(length).fill(1);
    const color = new Uint32Array(length).fill(GlyphEffectNoColor);
    const output = {
      glyph: new Array<string>(length).fill(" "),
      color: new Uint32Array(length).fill(GlyphEffectNoColor),
      coverage: new Float32Array(length),
      channels: new Uint8Array(length),
    };
    const params = { ...defaultGlyphEffectParams(fieldSynth), ...sierpinskiParams(depth) };
    fieldSynth.program.validateParams?.(params as never);
    fieldSynth.program.evaluate({
      params,
      state: undefined,
      base: { cols, rows, length, glyph, coverage, color, objectPosition },
      input: { cols, rows, length, glyph, coverage, color },
      target: { coverage },
      coordinates: { cellToSceneGrid: [1, 0, 0, 1, 0, 0], sceneGridSize: [cols, rows], localCellFootprint: [1, 1] },
      scratch: { images: [], floatFields: [], uintFields: [], glyphFields: [], samples: [] },
      output,
    } as never);
    return { output, points };
  }

  it.each([1, 2] as const)("depth %i solid/hole membership matches the first-principles corner-tetra reference", (depth) => {
    const { output, points } = evaluateSierpinskiGrid(depth);
    let solidCount = 0, holeCount = 0;
    for (let i = 0; i < points.length; i++) {
      const [x, y, z] = points[i]!;
      const refSolid = sierpinskiSolid(x, y, z, depth);
      const engineSolid = output.coverage[i]! > 0;
      expect(engineSolid).toBe(refSolid);
      if (refSolid) solidCount++; else holeCount++;
    }
    // Sanity: both solid and hole regions are actually sampled (otherwise the
    // per-point assertion above would pass vacuously).
    expect(solidCount).toBeGreaterThan(0);
    expect(holeCount).toBeGreaterThan(0);
  });

  it("default bias 0.5 / gain 1 maps hole (-1) to clamp01(0)=0 and solid (+1) to 1 with no bespoke tuning", () => {
    const { output, points } = evaluateSierpinskiGrid(1);
    let checkedHole = false, checkedSolid = false;
    for (let i = 0; i < points.length && !(checkedHole && checkedSolid); i++) {
      const [x, y, z] = points[i]!;
      const refSolid = sierpinskiSolid(x, y, z, 1);
      if (refSolid && !checkedSolid) {
        expect(output.coverage[i]).toBe(1);
        checkedSolid = true;
      }
      if (!refSolid && !checkedHole) {
        expect(output.coverage[i]).toBe(0);
        checkedHole = true;
      }
    }
    expect(checkedHole && checkedSolid).toBe(true);
  });
});

function carveCubePolygons(): Polygon[] {
  const faces: Vec3[][] = [
    [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
    [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]],
    [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]],
    [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]],
    [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]],
    [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]],
  ];
  return faces.map((vertices) => ({ vertices, color: "#8899cc" }));
}

// Spans object-space [0, 1]^3 rather than [-1, 1] — the domain
// `evaluateMengerGrid`/`mengerParams`'s recipe is calibrated for (base-3
// digit selection assumes a unit-domain coordinate; `scale: 1` there means
// "objectPosition already reads directly as that unit-domain coordinate").
// The acceptance-5 smoke test carves this mesh with the recipe UNCHANGED,
// rather than reusing `carveCubePolygons`'s [-1, 1] convention, which would
// double the traversed domain to two full base periods and make a chord
// landing squarely in a hole far less likely to miss solid content
// entirely (an adjacent period's solid material is right behind it).
function mengerDomainCubePolygons(): Polygon[] {
  const faces: Vec3[][] = [
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
    [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
    [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]],
    [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
    [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  ];
  return faces.map((vertices) => ({ vertices, color: "#8899cc" }));
}

async function flushCarveRenders(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("field-synth carve mode — validation (VOLUMETRIC.md's Carve mode)", () => {
  it('requires space: "object" — the volumetric branch', () => {
    const defaults = defaultGlyphEffectParams(fieldSynth);
    expect(() => fieldSynth.program.validateParams?.({ ...defaults, render: "carve" } as never))
      .toThrow(/space: "object"/);
    expect(() => fieldSynth.program.validateParams?.({ ...defaults, render: "carve", space: "object" } as never))
      .not.toThrow();
  });

  it('accepts subcellRes "2x4" and "ink" under carve (VOLUMETRIC-3.md §2: carve computes both directly — only xray still rejects them)', () => {
    const defaults = defaultGlyphEffectParams(fieldSynth);
    expect(() => fieldSynth.program.validateParams?.({
      ...defaults, render: "carve", space: "object", subcellRes: "2x4",
    } as never)).not.toThrow();
    expect(() => fieldSynth.program.validateParams?.({
      ...defaults, render: "carve", space: "object", subcellRes: "ink",
    } as never)).not.toThrow();
    expect(() => fieldSynth.program.validateParams?.({
      ...defaults, render: "carve", space: "object", subcellRes: "1x1",
    } as never)).not.toThrow();
  });

  it('paint mode never validates the volumetric/subcellRes constraints (they are carve-only)', () => {
    const defaults = defaultGlyphEffectParams(fieldSynth);
    expect(() => fieldSynth.program.validateParams?.({ ...defaults, render: "paint", subcellRes: "ink" } as never))
      .not.toThrow();
  });

  it('dynamicRequirements asks for objectPosition + objectExit only when render is "carve"', () => {
    const defaults = defaultGlyphEffectParams(fieldSynth);
    expect(fieldSynth.program.dynamicRequirements?.(defaults)).toEqual([]);
    expect(fieldSynth.program.dynamicRequirements?.({ ...defaults, render: "carve" })).toEqual([]);
    expect(fieldSynth.program.dynamicRequirements?.({ ...defaults, space: "object", render: "carve" }))
      .toEqual(["objectPosition", "objectExit"]);
    expect(fieldSynth.program.dynamicRequirements?.({ ...defaults, space: "object", render: "paint" }))
      .toEqual(["objectPosition"]);
  });
});

describe("field-synth carve mode — the march (VOLUMETRIC.md's Carve mode)", () => {
  it("a degenerate segment (entry === exit) falls back to surface sampling — renders exactly like paint, not a hole", () => {
    const length = 12 * 6;
    const objectPosition = new Float32Array(length * 3);
    const objectExit = new Float32Array(length * 3); // identical to objectPosition everywhere: every cell is degenerate
    objectPosition[0] = 0.3; objectPosition[1] = -0.2; objectPosition[2] = 0.1;
    objectExit[0] = 0.3; objectExit[1] = -0.2; objectExit[2] = 0.1;
    // bias 2 / gain 0 -> clamp01(bias) = 1 everywhere, independent of position
    // or which voice is active — an "everywhere-solid" field that isolates the
    // degenerate-segment fallback from any march/geometry concern.
    const shared = { space: "object" as const, scale: 2, bias: 2, gain: 0 };
    const carve = evaluate(fieldSynth, { ...shared, render: "carve" }, { objectPosition, objectExit });
    const paint = evaluate(fieldSynth, { ...shared, render: "paint" }, { objectPosition, objectExit });
    expect(carve.coverage[0]).toBeGreaterThan(0);
    expect(Array.from(carve.coverage)).toEqual(Array.from(paint.coverage));
    expect(carve.glyph).toEqual(paint.glyph);
    expect(Array.from(carve.color)).toEqual(Array.from(paint.color));
  });

  it("a genuine hole (no solid sample anywhere along a non-degenerate chord) emits nothing, not a fallback to the entry point", () => {
    const length = 12 * 6;
    const objectPosition = new Float32Array(length * 3);
    const objectExit = new Float32Array(length * 3);
    objectPosition[0] = 0; objectPosition[1] = 0; objectPosition[2] = 0;
    objectExit[0] = 1; objectExit[1] = 0; objectExit[2] = 0;
    const output = evaluate(fieldSynth, {
      space: "object", scale: 1, render: "carve",
      // Always off: clamp01(0.5 + 1 * (-1) * 0.5) = 0, never > 0.
      field1: "linearX", wave1: "sin", freq1: 3, speed1: 0, amp1: 1,
      bias: 0, gain: 0,
    }, { objectPosition, objectExit });
    expect(output.coverage[0]).toBe(0);
    expect(output.channels[0]).toBe(0);
  });

  it("Nyquist floor: a duty-narrow square voice's OWN effective finest frequency (VOLUMETRIC-3.md §4 fix) resolves its thin feature that a duty-agnostic reading would step over — no separate high-freq voice needed anymore", () => {
    const length = 12 * 6;
    const objectPosition = new Float32Array(length * 3);
    const objectExit = new Float32Array(length * 3);
    objectPosition[0] = 0; objectPosition[1] = 0; objectPosition[2] = 0;
    objectExit[0] = 1; objectExit[1] = 0; objectExit[2] = 0;
    // voice1 (freq 1, one period spans the whole chord) places a single
    // duty=0.008-wide "on" band centered at x=0.5625 — 9 sample points at a
    // FIXED marchSteps=8 (t = 0, 1/8, ..., 1) all fall outside
    // [0.5585, 0.5665], so a duty-agnostic step count deterministically
    // misses it (the pre-fix `effectiveVoiceFinestFreq` read this voice's
    // finest frequency as its bare `freq` — 1 — ignoring `duty`, so the
    // Nyquist floor never rose past the schema's own 8-step minimum here).
    // Post-fix, this voice's OWN `freq / min(duty, 1-duty) = 1 / 0.008 =
    // 125` correctly raises the per-cell floor high enough to find it —
    // this used to need a SEPARATE, unrelated high-frequency voice (see the
    // "separate voice raises the shared floor" wiring test just below,
    // which reproduces that original mechanism with a wave kind the duty
    // fix doesn't touch).
    const params = {
      space: "object" as const, scale: 1, render: "carve" as const, marchSteps: 8,
      field1: "linearX", wave1: "square", freq1: 1, duty1: 0.008, phase1: -0.5585, amp1: 1, speed1: 0,
      amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0,
    };
    const output = evaluate(fieldSynth, params, { objectPosition, objectExit });
    expect(output.coverage[0]).toBeGreaterThan(0);
  });

  it("Nyquist floor wiring: a SEPARATE active voice's own finest frequency still raises the shared per-cell step count for a thin feature elsewhere (unaffected by the duty fix — both voices use a non-square wave)", () => {
    const length = 12 * 6;
    const objectPosition = new Float32Array(length * 3);
    const objectExit = new Float32Array(length * 3);
    objectPosition[0] = 0; objectPosition[1] = 0; objectPosition[2] = 0;
    objectExit[0] = 1; objectExit[1] = 0; objectExit[2] = 0;
    // voice1 is a `sin` voice (its own `effectiveVoiceFinestFreq` stays
    // exactly `freq1`, untouched by the square-only duty fix), `phase1`
    // chosen so its peak (value 1) sits at x=0.5625 — as far as possible
    // (0.0625) from both its neighboring marchSteps=8 grid points (0.5,
    // 0.625). `bias`/`gain` are tuned (threshold combined > 0.99) so only a
    // ~0.045-wide window around that peak reads solid — narrower than the
    // grid spacing, so an 8-step fixed march deterministically steps over
    // it while a 256-step one (many samples inside a 0.045-wide window)
    // reliably lands inside. voice2's `freq` (not its amplitude, kept
    // negligible under `combine: "add"` so it can't itself flip the
    // solid/hole decision by more than +-0.001) is the ONLY thing that
    // changes between the two calls below, isolating the same cross-voice
    // Nyquist-floor wiring the old version of this test exercised via a (now
    // self-resolving) duty-narrow voice.
    const base = {
      space: "object" as const, scale: 1, render: "carve" as const, marchSteps: 8, combine: "add" as const,
      bias: -0.495, gain: 1,
      field1: "linearX", wave1: "sin", freq1: 1, speed1: 0, amp1: 1, phase1: -0.3125,
      field2: "linearX", wave2: "sin", freq2: 200, speed2: 0,
      amp3: 0, amp4: 0, amp5: 0, amp6: 0,
    };
    const lowFreqOnly = evaluate(fieldSynth, { ...base, amp2: 0 }, { objectPosition, objectExit });
    expect(lowFreqOnly.coverage[0]).toBe(0);

    const withHighFreqVoice = evaluate(fieldSynth, { ...base, amp2: 0.001 }, { objectPosition, objectExit });
    expect(withHighFreqVoice.coverage[0]).toBeGreaterThan(0);
  });

  it("colorFactor at a t=0 hit is exactly 1 regardless of marchFade — an everywhere-solid field's carve output matches paint bit-for-bit even through the synthetic evaluate() harness", () => {
    const length = 12 * 6;
    const objectPosition = new Float32Array(length * 3);
    const objectExit = new Float32Array(length * 3);
    for (let i = 0; i < length; i++) {
      objectPosition[i * 3] = (i % 12) * 0.1;
      objectPosition[i * 3 + 1] = ((i / 12) | 0) * 0.1;
      objectPosition[i * 3 + 2] = 0;
      objectExit[i * 3] = objectPosition[i * 3]! + 1;
      objectExit[i * 3 + 1] = objectPosition[i * 3 + 1]!;
      objectExit[i * 3 + 2] = 0;
    }
    const shared = { space: "object" as const, scale: 1, bias: 2, gain: 0 };
    const paint = evaluate(fieldSynth, { ...shared, render: "paint" }, { objectPosition, objectExit });
    const carveFadeLow = evaluate(fieldSynth, { ...shared, render: "carve", marchFade: 0.2 }, { objectPosition, objectExit });
    const carveFadeHigh = evaluate(fieldSynth, { ...shared, render: "carve", marchFade: 6 }, { objectPosition, objectExit });
    expect(Array.from(carveFadeLow.color)).toEqual(Array.from(paint.color));
    expect(Array.from(carveFadeHigh.color)).toEqual(Array.from(paint.color));
    expect(Array.from(carveFadeLow.coverage)).toEqual(Array.from(paint.coverage));
  });
});

describe("field-synth carve mode — real scene (VOLUMETRIC.md acceptance criteria 4 and 5)", () => {
  async function renderFieldSynthCube(
    params: Record<string, number | string | boolean> | null,
  ): Promise<{ text: string; cols: number; rows: number }> {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cols = 60, rows = 40;
    const scene = createGlyphScene(host, {
      cols, rows, useColors: false, doubleSided: true,
      // A near-head-on view, not the oblique 25/35 orbit view used elsewhere
      // in this file: the depth-1 Menger construction already carves a
      // straight axis-aligned tunnel through the center of each face, all
      // the way through to the opposite face. A fully oblique camera's
      // diagonal rays are long enough (up to the cube's space diagonal) to
      // clip solid content SOMEWHERE almost regardless of aim, at >50% solid
      // fraction (no genuine holes); a FULLY head-on view instead makes every
      // ray either dead-center in a tunnel (hole) or immediately solid at the
      // surface (no interior wall ever shows). This small tilt is what
      // actually exercises both: most tunnel rays still miss everything
      // (hole), while rays skimming a tunnel's edge clip the depth-2
      // sub-structure just inside its mouth (interior wall).
      camera: createGlyphOrthographicCamera({ zoom: 600, rotX: 8, rotY: 8 }),
    });
    scene.add(mengerDomainCubePolygons());
    if (params) scene.addEffectLayer({ effect: fieldSynth, params: params as never, blend: "replace", opacity: 1 });
    await flushCarveRenders();
    const text = scene.output.textContent ?? "";
    scene.destroy();
    host.remove();
    return { text, cols, rows };
  }

  it("acceptance 4: carve with an everywhere-solid field is byte-identical to paint on the same scene, across marchFade values", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      cols: 30, rows: 20, useColors: true, doubleSided: true,
      camera: createGlyphOrthographicCamera({ zoom: 200, rotX: 25, rotY: 35 }),
    });
    scene.add(carveCubePolygons());
    // bias 2 / gain 0 -> clamp01(bias) = 1 everywhere: the entry sample is
    // already solid, so `marchField` hits at t = 0 with position = entry —
    // exactly the point paint itself evaluates — sharing paint's own
    // emission path (`computeFieldSynthPoint`/`applyFieldSynthColor`).
    const layer = scene.addEffectLayer({
      effect: fieldSynth,
      params: { ...defaultGlyphEffectParams(fieldSynth), space: "object", bias: 2, gain: 0, render: "paint" } as never,
      blend: "replace",
      opacity: 1,
    });
    await flushCarveRenders();
    const paintHtml = scene.output.innerHTML;
    expect(paintHtml.length).toBeGreaterThan(0);

    layer.params.render = "carve";
    layer.params.marchFade = 0.3;
    await flushCarveRenders();
    expect(scene.output.innerHTML).toBe(paintHtml);

    layer.params.marchFade = 5;
    await flushCarveRenders();
    expect(scene.output.innerHTML).toBe(paintHtml);

    scene.destroy();
    host.remove();
  });

  it("acceptance 5: cube + depth-2 Menger patch under blend: \"replace\", opacity 1 — empty cells at hole centers, non-empty interior-wall cells inside hole apertures", async () => {
    const menger = mengerParams(2);
    const baseline = await renderFieldSynthCube(null);
    const paint = await renderFieldSynthCube({ ...defaultGlyphEffectParams(fieldSynth), ...menger, render: "paint" });
    const carve = await renderFieldSynthCube({ ...defaultGlyphEffectParams(fieldSynth), ...menger, render: "carve" });

    const baseRows = baseline.text.split("\n");
    const paintRows = paint.text.split("\n");
    const carveRows = carve.text.split("\n");

    let holeCells = 0; // carve found no solid sample anywhere along the chord
    // paint (surface-only, entry-point evaluation) says hole, but carve
    // marched through and hit an interior wall — the doc's "non-empty
    // interior-wall cells inside hole apertures".
    let interiorWallCells = 0;
    for (let r = 0; r < baseline.rows; r++) {
      const baseRow = baseRows[r] ?? "";
      const paintRow = paintRows[r] ?? "";
      const carveRow = carveRows[r] ?? "";
      for (let c = 0; c < baseline.cols; c++) {
        if (!baseRow[c] || baseRow[c] === " ") continue; // outside the cube's silhouette
        const carveEmpty = !carveRow[c] || carveRow[c] === " ";
        const paintEmpty = !paintRow[c] || paintRow[c] === " ";
        if (carveEmpty) holeCells++;
        if (paintEmpty && !carveEmpty) interiorWallCells++;
      }
    }
    expect(holeCells).toBeGreaterThan(0);
    expect(interiorWallCells).toBeGreaterThan(0);
  });

  it.each(["wireframe", "voxel"] as const)(
    "%s mode: carve degrades to the 2D paint fallback without throwing (dynamicRequirements can't see the render mode)",
    async (mode) => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const scene = createGlyphScene(host, {
        cols: 30, rows: 20, mode, useColors: false, doubleSided: true,
        camera: createGlyphOrthographicCamera({ zoom: 200, rotX: 25, rotY: 35 }),
      });
      scene.add(carveCubePolygons());
      let evaluated = false;
      scene.addEffectLayer({
        effect: fieldSynth,
        params: { ...defaultGlyphEffectParams(fieldSynth), space: "object", render: "carve" } as never,
        blend: "replace",
      });
      scene.addEffectLayer({
        effect: defineGlyphEffect<{ phase: number }>({ evaluate() { evaluated = true; } }),
        params: { phase: 0 },
      });
      await expect(flushCarveRenders()).resolves.toBeUndefined();
      expect(evaluated).toBe(true);
      scene.destroy();
      host.remove();
    },
  );

  it("flipping render paint -> carve on a live solid-mode scene triggers a full render and retains objectExit (VOLUMETRIC.md's dynamicRequirements protocol, end to end with the real field-synth program)", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      cols: 30, rows: 20, useColors: false, doubleSided: true,
      camera: createGlyphOrthographicCamera({ zoom: 200, rotX: 25, rotY: 35 }),
    });
    scene.add(carveCubePolygons());
    const fieldLayer = scene.addEffectLayer({
      effect: fieldSynth,
      params: { ...defaultGlyphEffectParams(fieldSynth), space: "object", render: "paint" } as never,
      blend: "replace",
    });
    let sawObjectExit: boolean | undefined;
    // A passive observer layer sharing the same composite frame: whatever
    // the field-synth layer's dynamicRequirements ask for is retained in the
    // SHARED base grid every mounted layer sees, real requirement plumbing,
    // not a synthetic stand-in (mirrors packages/glyphcss's own
    // createGlyphScene.objectExit.test.ts pattern, with the real fieldSynth
    // program driving the requirement instead of a hand-written one).
    scene.addEffectLayer({
      effect: defineGlyphEffect<{ phase: number }>({
        evaluate({ base }) { sawObjectExit = base.objectExit !== undefined; },
      }),
      params: { phase: 0 },
    });
    await flushCarveRenders();
    expect(sawObjectExit).toBe(false);

    fieldLayer.params.render = "carve";
    await flushCarveRenders();
    expect(sawObjectExit).toBe(true);

    fieldLayer.params.render = "paint";
    await flushCarveRenders();
    expect(sawObjectExit).toBe(false);

    scene.destroy();
    host.remove();
  });

  // Item 0 (VOLUMETRIC-3.md §1 acceptance 2, carried as Phase 2 P2 debt):
  // the targeting acceptance-2 test in createGlyphScene.targeting.test.ts
  // exercises a marker program, not a real volumetric effect — this is the
  // real thing: an actual carve fieldSynth layer targeted at ONE of two
  // meshes in a real scene. Home is here, not glyphcss's own targeting
  // test file, because `@glyphcss/effects` is the one package that already
  // imports both `glyphcss` (for `createGlyphScene`) and the real
  // `fieldSynth` program together — glyphcss itself never imports
  // `@glyphcss/effects` (AGENTS.md: "that dependency only points one
  // way") — and this test follows the exact real-scene pattern already
  // established above (`renderFieldSynthCube`), just with a second,
  // untargeted mesh added.
  it("item 0: a real carve layer targeted at one of two meshes — floor cells byte-equal to the untargeted render, cube genuinely carved", async () => {
    const groundCx = -8;
    const cubeCx = 8;
    function groundQuad(): Polygon[] {
      return [{ vertices: [[groundCx - 1, -1, 0], [groundCx - 1, 1, 0], [groundCx + 1, 1, 0], [groundCx + 1, -1, 0]], color: "#335577" }];
    }
    const sceneOptions = {
      cols: 60,
      rows: 30,
      useColors: false,
      doubleSided: true,
      camera: createGlyphOrthographicCamera({ zoom: 50, rotX: 25, rotY: 35 }),
      directionalLight: { direction: [0, 0, 1] as [number, number, number], intensity: 0 },
      ambientLight: { intensity: 1 },
    } as const;
    // The cube mesh: `carveCubePolygons()` (the plain [-1,1]^3 box the
    // "acceptance 4" carve test above already uses), scaled up (its own
    // local geometry, not `objectPosition` — AGENTS.md) so its on-screen
    // silhouette resolves into more than a couple of cells at this
    // camera/zoom, and given the same 25°/35° tilt "acceptance 4"/"acceptance
    // 5" already use so an isometric-ish view (not a flat-on one) shows a
    // genuine 3D silhouette.
    //
    // Deliberately NOT the Menger recipe (`mengerParams`): that recipe's
    // hole is a narrow axis-aligned tunnel calibrated for a specific
    // near-head-on camera/zoom, and reusing it here would couple this
    // test's pass/fail to exact pixel/cell-metric guesses for a SECOND
    // mesh sharing the frame. A single `linearX` + `square` voice instead
    // carves several stripes along local X — density is CONSTANT along the
    // view ray for a straight-on camera (independent of z), so a "hole"
    // stripe is a genuine miss (a real background gap in the silhouette)
    // regardless of camera angle/zoom, robust under the exact zoom/camera
    // this file's proven two-mesh floor-footprint pattern already uses.
    const cubeTransform = { position: [cubeCx, 0, 0] as [number, number, number], scale: 4 };
    const carveParams = {
      ...defaultGlyphEffectParams(fieldSynth),
      space: "object", scale: 1, render: "carve",
      field1: "linearX", wave1: "square", freq1: 3, duty1: 0.5, phase1: 0, speed1: 0, amp1: 1,
      amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0,
      bias: 0.5, gain: 1,
    };

    async function renderTwoMesh(carveTargeted: boolean): Promise<string> {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const scene = createGlyphScene(host, sceneOptions);
      scene.add(groundQuad());
      const cube = scene.add(carveCubePolygons(), cubeTransform);
      if (carveTargeted) {
        scene.addEffectLayer({
          effect: fieldSynth,
          params: carveParams as never,
          target: cube,
          blend: "replace",
          opacity: 1,
        });
      }
      await flushCarveRenders();
      const text = scene.output.textContent ?? "";
      scene.destroy();
      host.remove();
      return text;
    }

    // Floor footprint, in isolation, at the same camera/grid — used to
    // locate floor-region cells without guessing exact coordinates (same
    // technique as createGlyphScene.targeting.test.ts's own acceptance-2 test).
    const floorHost = document.createElement("div");
    document.body.appendChild(floorHost);
    const floorScene = createGlyphScene(floorHost, sceneOptions);
    floorScene.add(groundQuad());
    await flushCarveRenders();
    const floorFootprint = floorScene.output.textContent ?? "";
    floorScene.destroy();
    floorHost.remove();

    // Cube footprint, in isolation — to locate cube-region cells.
    const cubeHost = document.createElement("div");
    document.body.appendChild(cubeHost);
    const cubeOnlyScene = createGlyphScene(cubeHost, sceneOptions);
    cubeOnlyScene.add(carveCubePolygons(), cubeTransform);
    await flushCarveRenders();
    const cubeFootprint = cubeOnlyScene.output.textContent ?? "";
    cubeOnlyScene.destroy();
    cubeHost.remove();

    const baselineOutput = await renderTwoMesh(false);
    const targetedOutput = await renderTwoMesh(true);

    expect(floorFootprint.length).toBe(baselineOutput.length);
    let floorCellCount = 0;
    for (let i = 0; i < floorFootprint.length; i++) {
      if (floorFootprint[i] === " " || floorFootprint[i] === "\n") continue;
      floorCellCount++;
      expect(targetedOutput[i]).toBe(baselineOutput[i]);
    }
    expect(floorCellCount).toBeGreaterThan(0);

    // The cube must genuinely carve: some cube-footprint cell that was
    // solid in the untargeted baseline becomes empty (a real hole) once the
    // targeted carve layer mounts.
    let carvedHoleCells = 0;
    for (let i = 0; i < cubeFootprint.length; i++) {
      if (cubeFootprint[i] === " " || cubeFootprint[i] === "\n") continue;
      const baselineEmpty = baselineOutput[i] === undefined || baselineOutput[i] === " ";
      const targetedEmpty = targetedOutput[i] === undefined || targetedOutput[i] === " ";
      if (!baselineEmpty && targetedEmpty) carvedHoleCells++;
    }
    expect(carvedHoleCells).toBeGreaterThan(0);
  });
});

// Low-level manual-context harness shared by the ink/braille-over-carve
// suites below — same pattern as `evaluateMengerGrid`/`evaluateSierpinskiGrid`
// above (a hand-built `GlyphEffectEvaluateContext`, not `createGlyphScene`),
// chosen because these fixtures need precise control over per-cell
// `objectPosition`/`objectExit`/`normal`/`target.coverage` (including
// `target.coverage` DIFFERING from `base.coverage`, for the two-mesh
// no-cross-contour case — the shared `evaluate()` helper earlier in this
// file always aliases them together).
function evaluateFieldSynthGrid(
  cols: number,
  rows: number,
  params: Record<string, number | string | boolean>,
  build: (i: number, col: number, row: number) => void,
  buffers: {
    objectPosition: Float32Array;
    objectExit: Float32Array;
    normal?: Float32Array;
    targetCoverage?: Float32Array;
    winnerMesh?: Int32Array;
  },
) {
  const length = cols * rows;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) build(row * cols + col, col, row);
  }
  const baseCoverage = new Float32Array(length).fill(1);
  const glyph = new Array<string>(length).fill(" ");
  const color = new Uint32Array(length).fill(GlyphEffectNoColor);
  const output = {
    glyph: new Array<string>(length).fill(" "),
    color: new Uint32Array(length).fill(GlyphEffectNoColor),
    coverage: new Float32Array(length),
    channels: new Uint8Array(length),
  };
  const fullParams = { ...defaultGlyphEffectParams(fieldSynth), ...params };
  fieldSynth.program.validateParams?.(fullParams as never);
  fieldSynth.program.evaluate({
    params: fullParams,
    state: undefined,
    base: {
      cols, rows, length, glyph, coverage: baseCoverage, color,
      objectPosition: buffers.objectPosition,
      objectExit: buffers.objectExit,
      ...(buffers.normal ? { normal: buffers.normal } : {}),
      ...(buffers.winnerMesh ? { winnerMesh: buffers.winnerMesh } : {}),
    },
    input: { cols, rows, length, glyph, coverage: baseCoverage, color },
    target: { coverage: buffers.targetCoverage ?? baseCoverage },
    coordinates: { cellToSceneGrid: [1, 0, 0, 1, 0, 0], sceneGridSize: [cols, rows], localCellFootprint: [1, 1] },
    scratch: { images: [], floatFields: [], uintFields: [], glyphFields: [], samples: [] },
    output,
  } as never);
  return output;
}

function inkedAt(output: { channels: Uint8Array }, i: number): boolean {
  return (output.channels[i]! & GlyphEffectOutputChannel.Glyph) !== 0;
}

describe("field-synth ink-over-carve (VOLUMETRIC-3.md §2)", () => {
  const GRID_N = 20;
  const INK_SPACING_NO_CONTOUR = 4; // schema max; exceeds any depth this file's fixtures produce, isolating rule (a)

  // Same first-principles reference as the "Menger membership" describe
  // block above (module scope there, re-derived here as a REFERENCE — not
  // by importing the evaluator under test, same precedent).
  function mengerSolidRef(x: number, y: number, z: number, depth: number): boolean {
    let cx = x, cy = y, cz = z;
    for (let d = 0; d < depth; d++) {
      cx *= 3; cy *= 3; cz *= 3;
      const mx = ((cx % 3) + 3) % 3, my = ((cy % 3) + 3) % 3, mz = ((cz % 3) + 3) % 3;
      const midCount = (mx > 1 && mx < 2 ? 1 : 0) + (my > 1 && my < 2 ? 1 : 0) + (mz > 1 && mz < 2 ? 1 : 0);
      if (midCount >= 2) return false;
      cx = cx - Math.floor(cx / 3) * 3; cy = cy - Math.floor(cy / 3) * 3; cz = cz - Math.floor(cz / 3) * 3;
    }
    return true;
  }

  // Does the straight object-space line at (x, y) — the carve chord this
  // fixture marches — cross ANY solid material between z=0.001 and z=0.999?
  function referenceHitColumn(x: number, y: number, depth: number): boolean {
    const SAMPLES = 400;
    for (let s = 0; s < SAMPLES; s++) {
      const z = 0.001 + (s / (SAMPLES - 1)) * 0.998;
      if (mengerSolidRef(x, y, z, depth)) return true;
    }
    return false;
  }

  it("acceptance 3: every rim cell (reference hit/no-hit boundary) is inked; interior hit cells away from contour multiples are not — depth-2 Menger cube fixture", () => {
    const cols = GRID_N, rows = GRID_N;
    const objectPosition = new Float32Array(cols * rows * 3);
    const objectExit = new Float32Array(cols * rows * 3);
    const refHit = new Array<boolean>(cols * rows);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        const x = (col + 0.37) / cols, y = (row + 0.37) / rows;
        objectPosition[i * 3] = x; objectPosition[i * 3 + 1] = y; objectPosition[i * 3 + 2] = 0.001;
        objectExit[i * 3] = x; objectExit[i * 3 + 1] = y; objectExit[i * 3 + 2] = 0.999;
        refHit[i] = referenceHitColumn(x, y, 2);
      }
    }
    const output = evaluateFieldSynthGrid(
      cols, rows,
      { ...mengerParams(2), space: "object", scale: 1, render: "carve", subcellRes: "ink", inkSpacing: INK_SPACING_NO_CONTOUR },
      () => {},
      { objectPosition, objectExit },
    );

    let rimCount = 0, interiorHitCount = 0;
    // Strictly interior cells only: at the grid's own edge, a HOLE cell's
    // missing (off-grid) neighbor reads as OUT (background), which differs
    // from the binary hit/no-hit reference model used here — see
    // `runCarveInkResolve`'s doc for why OUT and HOLE are distinct
    // categories in the engine. Excluding the outer ring sidesteps that
    // (deliberately out of scope) edge case entirely.
    for (let row = 1; row < rows - 1; row++) {
      for (let col = 1; col < cols - 1; col++) {
        const i = row * cols + col;
        const self = refHit[i]!;
        const neighbors = [refHit[i + 1]!, refHit[i - 1]!, refHit[i + cols]!, refHit[i - cols]!];
        const isRim = neighbors.some((n) => n !== self);
        const inked = inkedAt(output, i);
        if (isRim) {
          rimCount++;
          expect(inked, `cell (${col},${row}) expected rim-inked`).toBe(true);
        } else if (self) {
          interiorHitCount++;
          expect(inked, `cell (${col},${row}) expected interior hit, NOT inked`).toBe(false);
        }
      }
    }
    expect(rimCount).toBeGreaterThan(0);
    expect(interiorHitCount).toBeGreaterThan(0);
  });

  // Shared by the tilted-plane and two-mesh-boundary tests below: a planar
  // depth ramp, purely analytic (no field-program membership math needed) —
  // a single half-space (`step`) voice threshold at object z=0, with the
  // THRESHOLD CROSSING POINT itself varying per cell via the cell's own
  // entry z-offset (`depth(col,row) = base + row*stepR + col*stepC`), not
  // via any field parameter (which is necessarily uniform across the whole
  // evaluate() call). Every cell's chord genuinely crosses z=0 (entry z is
  // always negative, exit z always positive), so every covered/in-target
  // cell is a real HIT — isolating rules (b)/(c) with no HOLE/rim noise.
  function buildTiltedPlane(cols: number, rows: number, stepR: number, stepC: number, base: number, chordLength: number) {
    const objectPosition = new Float32Array(cols * rows * 3);
    const objectExit = new Float32Array(cols * rows * 3);
    const depthAt = (col: number, row: number): number => base + row * stepR + col * stepC;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        const depth = depthAt(col, row);
        objectPosition[i * 3] = 0; objectPosition[i * 3 + 1] = 0; objectPosition[i * 3 + 2] = -depth;
        objectExit[i * 3] = 0; objectExit[i * 3 + 1] = 0; objectExit[i * 3 + 2] = -depth + chordLength;
      }
    }
    return { objectPosition, objectExit, depthAt };
  }
  const TILTED_PLANE_PARAMS = {
    space: "object" as const, scale: 1, render: "carve" as const, subcellRes: "ink" as const, inkSpacing: 0.25,
    field1: "linearZ", wave1: "step", freq1: 1, phase1: 0, speed1: 0, amp1: 1,
    amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0,
    bias: 0.5, gain: 1,
  };

  it("acceptance 3: a tilted-plane fixture yields parallel contour lines with the correct bucket glyph", () => {
    // Depth per cell is quantized to the march's discrete step grid
    // (`hitDistance` is the raw CONFIRMED-solid step sample, not the exact
    // analytic crossing — see `runCarveInkResolve`'s doc), so a per-cell
    // step (0.5) comfortably larger than `inkSpacing` (0.25) by more than
    // one march step's worth of quantization noise (chordLength/marchSteps
    // = 10/48 ~ 0.21) makes every adjacent pair's rule-(c) "interior edge"
    // crossing unconditional — this is deliberately NOT tuned to land any
    // cell exactly on a rule-(b) spacing MULTIPLE, which the quantization
    // can nudge either side of.
    const cols = 8, rows = 8;
    const stepR = 0.5, stepC = 0.5, base = 0.2;
    const { objectPosition, objectExit, depthAt } = buildTiltedPlane(cols, rows, stepR, stepC, base, 10);
    const output = evaluateFieldSynthGrid(cols, rows, TILTED_PLANE_PARAMS, () => {}, { objectPosition, objectExit });
    void depthAt;

    let contourCount = 0;
    for (let row = 1; row < rows - 1; row++) {
      for (let col = 1; col < cols - 1; col++) {
        const i = row * cols + col;
        contourCount++;
        expect(inkedAt(output, i), `cell (${col},${row}) expected contour-inked`).toBe(true);
        // Depth is a perfectly planar function of (col, row) here, so the
        // depth gradient — and thus the orientation bucket — is identical
        // at every contour cell: the "parallel lines, correct bucket" claim
        // reduces to one shared glyph across all of them.
        expect(output.glyph[i]).toBe("/");
      }
    }
    expect(contourCount).toBeGreaterThan(0);
  });

  it("acceptance 3: rim orientation follows the coverage-mask gradient — a vertical silhouette edge yields \"|\", not the all-dashes failure a depth-gradient fallback would produce", () => {
    const cols = 12, rows = 6;
    const objectPosition = new Float32Array(cols * rows * 3);
    const objectExit = new Float32Array(cols * rows * 3);
    const boundaryCol = cols / 2; // cells >= boundaryCol are solid; < boundaryCol are hole
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        const x = col - boundaryCol + 0.5; // solid for x >= 0
        objectPosition[i * 3] = x; objectPosition[i * 3 + 1] = 0; objectPosition[i * 3 + 2] = 0;
        objectExit[i * 3] = x; objectExit[i * 3 + 1] = 0; objectExit[i * 3 + 2] = 1;
      }
    }
    const output = evaluateFieldSynthGrid(
      cols, rows,
      {
        space: "object", scale: 1, render: "carve", subcellRes: "ink", inkSpacing: INK_SPACING_NO_CONTOUR,
        field1: "linearX", wave1: "step", freq1: 1, phase1: 0, speed1: 0, amp1: 1,
        amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0,
        bias: 0.5, gain: 1,
      },
      () => {},
      { objectPosition, objectExit },
    );
    // A row comfortably away from the top/bottom grid edges, at the hole
    // side of the boundary — its up/down neighbors share its own (hole)
    // state, isolating a PURELY vertical mask gradient.
    const row = 3;
    const holeCol = boundaryCol - 1;
    const i = row * cols + holeCol;
    expect(inkedAt(output, i)).toBe(true);
    expect(output.glyph[i]).toBe("|");
    expect(output.glyph[i]).not.toBe("-");
  });

  it("acceptance 3: no contour crosses a winner-mesh boundary — the target/non-target flip inks as a rim, not a depth-gradient contour", () => {
    const cols = 16, rows = 8;
    const stepR = 0.05, stepC = 0.05, base = 0.1;
    const { objectPosition, objectExit, depthAt } = buildTiltedPlane(cols, rows, stepR, stepC, base, 3);
    const targetBoundaryCol = cols / 2; // col >= targetBoundaryCol is a second, UNtargeted mesh
    const targetCoverage = new Float32Array(cols * rows);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) targetCoverage[row * cols + col] = col < targetBoundaryCol ? 1 : 0;
    }
    const output = evaluateFieldSynthGrid(
      cols, rows, TILTED_PLANE_PARAMS, () => {}, { objectPosition, objectExit, targetCoverage },
    );

    const row = 3;
    const boundaryCol = targetBoundaryCol - 1; // last in-target column, adjacent to the untargeted mesh
    const i = row * cols + boundaryCol;
    expect(inkedAt(output, i)).toBe(true);
    // The DEPTH gradient at this exact cell (the tilted plane's own local
    // slope) would bucket to "/" — see the tilted-plane test above, same
    // stepR/stepC. The rim (coverage-mask) gradient instead sees a
    // HIT-left/OUT-right split with no vertical component, bucketing to
    // "|" — a different glyph, proving the depth-based contour path was
    // never taken at this boundary.
    expect(output.glyph[i]).toBe("|");
    expect(output.glyph[i]).not.toBe("/");
    // And genuinely on the far (untargeted) side: nothing painted through —
    // this layer never emits for a non-target cell regardless (the
    // compositor's own `targetCoverage` weighting would discard it anyway,
    // VOLUMETRIC-3.md §1), but the ink resolve pass also just never inks an
    // OUT cell as `self` (see `runCarveInkResolve`).
    expect(inkedAt(output, row * cols + targetBoundaryCol)).toBe(false);
  });

  // Phase 2 P1 regression (VOLUMETRIC-3.md §2's "Contours NEVER cross
  // winner-mesh ... boundaries" rule, reviewer-repro'd both directions):
  // the test above exercises a target/non-target flip, which the pre-fix
  // engine already handled correctly because `hitState` itself changes
  // (HIT -> OUT) at that boundary. This is the case the P1 report actually
  // pins — TWO fully in-target meshes, both HIT, sharing the SAME normal
  // and the SAME depth (genuinely coplanar), differing ONLY in winner mesh
  // id. `hitState` alone cannot see that difference at all, so pre-fix the
  // whole interior — including the seam — reads as one undifferentiated
  // flat HIT surface with zero depth variance anywhere, and rule (b)/(c)
  // never crosses an `inkSpacing` multiple or a depth jump either: nothing
  // ever inks, silently merging the two meshes into one surface. The fix
  // (`meshBoundary` in `runCarveInkResolve`) must ink the seam as a rim
  // even with no accompanying depth or state difference at all.
  it("P1 regression: two coplanar, same-normal, fully in-target meshes at the SAME depth still ink a rim at their winner-mesh seam — not silently merged into one surface", () => {
    const cols = 16, rows = 8;
    const chordLength = 3;
    const depth = 0.5; // constant for BOTH meshes — genuinely coplanar, zero depth variance anywhere
    const objectPosition = new Float32Array(cols * rows * 3);
    const objectExit = new Float32Array(cols * rows * 3);
    const winnerMesh = new Int32Array(cols * rows);
    const meshBoundaryCol = cols / 2;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        objectPosition[i * 3] = 0; objectPosition[i * 3 + 1] = 0; objectPosition[i * 3 + 2] = -depth;
        objectExit[i * 3] = 0; objectExit[i * 3 + 1] = 0; objectExit[i * 3 + 2] = -depth + chordLength;
        winnerMesh[i] = col < meshBoundaryCol ? 0 : 1;
      }
    }
    const output = evaluateFieldSynthGrid(
      cols, rows, TILTED_PLANE_PARAMS, () => {}, { objectPosition, objectExit, winnerMesh },
    );

    const row = 3;
    const leftOfSeam = row * cols + (meshBoundaryCol - 1);
    const rightOfSeam = row * cols + meshBoundaryCol;
    const awayFromSeam = row * cols + 2; // deep inside mesh 0 — no mesh or depth discontinuity nearby at all

    expect(inkedAt(output, leftOfSeam)).toBe(true);
    expect(inkedAt(output, rightOfSeam)).toBe(true);
    // Pure horizontal mesh-identity split (mesh 0 left / mesh 1 right), no
    // vertical component (up/down neighbors share the same mesh) — same
    // rim-orientation convention the target/non-target test above pins.
    expect(output.glyph[leftOfSeam]).toBe("|");
    expect(output.glyph[rightOfSeam]).toBe("|");
    // Away from the seam, both meshes are perfectly flat with no state or
    // depth discontinuity at all — never inked. This is what proves the
    // seam cells above ink BECAUSE of the winner-mesh identity change
    // alone, not some incidental depth-quantization noise from the march.
    expect(inkedAt(output, awayFromSeam)).toBe(false);
  });
});

describe("field-synth braille-over-carve (VOLUMETRIC-3.md §2)", () => {
  const BAND_PARAMS = {
    space: "object" as const, scale: 1, render: "carve" as const, subcellRes: "2x4" as const,
    combine: "min" as const,
    amp3: 0, amp4: 0, amp5: 0, amp6: 0,
    bias: 0.5, gain: 1,
  };
  // Solid exactly within [lo, hi] on object-space x (a `min`-combined pair
  // of `step` half-spaces — see AGENTS.md's SDF-voice-adjacent "min ==
  // intersection of solids" reasoning, applied here with two ordinary
  // linear half-spaces instead), hole everywhere else. `freq2: -1` bypasses
  // the schema's UI-only `min: 0` hint (validateParams never checks
  // frequency range — see the phase/duty docs) to express `step(hi - x)`
  // through the same `t = raw*freq + phase` projection every voice uses.
  function solidBandVoices(lo: number, hi: number): Record<string, number | string | boolean> {
    return {
      field1: "linearX", wave1: "step", freq1: 1, phase1: -lo, speed1: 0, amp1: 1,
      field2: "linearX", wave2: "step", freq2: -1, phase2: hi, speed2: 0, amp2: 1,
    };
  }

  it("acceptance 4: a hole aligned with a sub-ray position registers in the dot mask while absent at subcellRes \"1x1\" (the resolution win)", () => {
    const cols = 5, rows = 1;
    const dx = 4; // domain units per column — large enough that the 0.25-cell dot offset (1 domain unit) clears the hole band below
    const selfCol = 2;
    const selfX = selfCol * dx;
    // Hole band: [-0.3dx, -0.2dx] relative to selfX — inside the LEFT dot
    // column's offset (-0.25dx) but outside both the cell center (0) and
    // the RIGHT dot column (+0.25dx).
    const holeLo = selfX - 0.3 * dx, holeHi = selfX - 0.2 * dx;
    const objectPosition = new Float32Array(cols * rows * 3);
    const objectExit = new Float32Array(cols * rows * 3);
    const normal = new Float32Array(cols * rows * 3);
    for (let col = 0; col < cols; col++) {
      objectPosition[col * 3] = col * dx; objectPosition[col * 3 + 1] = 0; objectPosition[col * 3 + 2] = 0;
      objectExit[col * 3] = col * dx; objectExit[col * 3 + 1] = 0; objectExit[col * 3 + 2] = 1;
      normal[col * 3] = 0; normal[col * 3 + 1] = 0; normal[col * 3 + 2] = 1;
    }
    const buffers = { objectPosition, objectExit, normal };
    // Density = solid EVERYWHERE except the thin band (invert the "solid
    // only in-band" `min` pair from `solidBandVoices` at the layer level).
    const params = {
      ...BAND_PARAMS, ...solidBandVoices(holeLo, holeHi),
      layerInvert1: true,
    };
    const braille = evaluateFieldSynthGrid(cols, rows, { ...params, subcellRes: "2x4" }, () => {}, buffers);
    const flat = evaluateFieldSynthGrid(cols, rows, { ...params, subcellRes: "1x1" }, () => {}, buffers);

    const i = selfCol;
    // 1x1: the cell's own (unshifted) x = selfX is outside the hole band —
    // fully solid, no hole visible at all.
    expect(inkedAt(flat, i)).toBe(true);
    // 2x4: the LEFT dot column (offset -0.25dx, inside the hole band)
    // misses; the RIGHT dot column (offset +0.25dx) and the center both hit.
    expect(inkedAt(braille, i)).toBe(true);
    const mask = braille.glyph[i]!.codePointAt(0)! - 0x2800;
    const LEFT_COLUMN_BITS = 0x01 | 0x02 | 0x04 | 0x40;
    const RIGHT_COLUMN_BITS = 0x08 | 0x10 | 0x20 | 0x80;
    expect(mask & LEFT_COLUMN_BITS).toBe(0);
    expect(mask & RIGHT_COLUMN_BITS).toBe(RIGHT_COLUMN_BITS);
  });

  it("acceptance 4: aggregate dot-mask variance vs the 1x1 render on the depth-2 Menger fixture — genuine sub-cell shape the flat ramp glyph can't express", () => {
    const cols = 24, rows = 16;
    const objectPosition = new Float32Array(cols * rows * 3);
    const objectExit = new Float32Array(cols * rows * 3);
    const normal = new Float32Array(cols * rows * 3);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        const x = (col + 0.37) / cols, y = (row + 0.37) / rows;
        objectPosition[i * 3] = x; objectPosition[i * 3 + 1] = y; objectPosition[i * 3 + 2] = 0.001;
        objectExit[i * 3] = x; objectExit[i * 3 + 1] = y; objectExit[i * 3 + 2] = 0.999;
        normal[i * 3] = 0; normal[i * 3 + 1] = 0; normal[i * 3 + 2] = 1;
      }
    }
    const buffers = { objectPosition, objectExit, normal };
    const params = { ...mengerParams(2), space: "object", scale: 1, render: "carve" };
    const braille = evaluateFieldSynthGrid(cols, rows, { ...params, subcellRes: "2x4" }, () => {}, buffers);

    const partialMasks = new Set<number>();
    let inkedCells = 0;
    for (let i = 0; i < cols * rows; i++) {
      if (!inkedAt(braille, i)) continue;
      inkedCells++;
      const mask = braille.glyph[i]!.codePointAt(0)! - 0x2800;
      if (mask !== 0 && mask !== 0xff) partialMasks.add(mask);
    }
    // A flat 1x1 ramp glyph carries no shape information at all (variance
    // in SHAPE is definitionally 0) — braille's partial dot masks are the
    // resolution this fixture is meant to demonstrate.
    expect(inkedCells).toBeGreaterThan(0);
    expect(partialMasks.size).toBeGreaterThanOrEqual(5);
  });

  it("acceptance 4: strict neighbor eligibility — a crease (disagreeing normal, unrelated far-away position) is excluded, so the dot mask shows no off-surface artifacts", () => {
    // Two "faces" side by side: left (cols 0-1) at object x ~ 0 with normal
    // (0,0,1); right (cols 2-3) at object x ~ 50 with normal (1,0,0) — a
    // large positional jump AND a disagreeing normal, exactly the
    // crease-edge shape two adjacent cube faces produce. Density is solid
    // ONLY within x in [-2, 2] (the left face's own local range) — if the
    // eligibility gate correctly excludes the right neighbor, the boundary
    // cell's sub-rays stay near its own x=0 and all 8 dots hit; if the gate
    // were absent, interpolating toward the right neighbor's x~50 would
    // push dots to x ~ +-12.5 — well outside the solid band — producing a
    // hollowed-out mask instead (verified by hand: relaxing the `dot > 0.9`
    // threshold to always pass collapses this cell's mask to 0).
    const cols = 4, rows = 1;
    const objectPosition = new Float32Array(cols * rows * 3);
    const objectExit = new Float32Array(cols * rows * 3);
    const normal = new Float32Array(cols * rows * 3);
    for (let col = 0; col < cols; col++) {
      const leftFace = col < 2;
      const x = leftFace ? 0 : 50 + (col - 2);
      objectPosition[col * 3] = x; objectPosition[col * 3 + 1] = 0; objectPosition[col * 3 + 2] = 0;
      objectExit[col * 3] = x; objectExit[col * 3 + 1] = 0; objectExit[col * 3 + 2] = 2;
      normal[col * 3] = leftFace ? 0 : 1; normal[col * 3 + 1] = 0; normal[col * 3 + 2] = leftFace ? 1 : 0;
    }
    const params = { ...BAND_PARAMS, ...solidBandVoices(-2, 2) };
    const output = evaluateFieldSynthGrid(cols, rows, params, () => {}, { objectPosition, objectExit, normal });

    const boundaryCell = 1; // left face, adjacent to the right face's disagreeing-normal neighbor
    expect(inkedAt(output, boundaryCell)).toBe(true);
    const mask = output.glyph[boundaryCell]!.codePointAt(0)! - 0x2800;
    expect(mask).toBe(0xff);
  });

  // Phase 2 P1 regression: the crease test above catches a DISAGREEING
  // normal. This isolates the missing case the P1 report pins — a
  // neighbor that passes the normal-agreement gate (SAME normal, dot = 1)
  // but belongs to a genuinely DIFFERENT winner mesh at an unrelated
  // position — e.g. two coplanar, abutting quads authored as separate
  // meshes. Pre-fix, `eligibleCarveNeighbor` only checked finite
  // entry/exit and normal agreement, so this neighbor was wrongly
  // accepted and interpolated sub-ray endpoints toward its unrelated
  // position, hollowing out the mask (the P1 report's "expected 0xff got
  // 0x00"). The fix adds a same-mesh-id gate alongside the existing ones.
  it("P1 regression: an agreeing-normal neighbor from a DIFFERENT winner mesh is excluded — the boundary cell's mask comes from its own cell-center fallback, not off-surface interpolation", () => {
    const cols = 4, rows = 1;
    const objectPosition = new Float32Array(cols * rows * 3);
    const objectExit = new Float32Array(cols * rows * 3);
    const normal = new Float32Array(cols * rows * 3);
    const winnerMesh = new Int32Array(cols * rows);
    for (let col = 0; col < cols; col++) {
      const leftMesh = col < 2;
      const x = leftMesh ? 0 : 50 + (col - 2);
      objectPosition[col * 3] = x; objectPosition[col * 3 + 1] = 0; objectPosition[col * 3 + 2] = 0;
      objectExit[col * 3] = x; objectExit[col * 3 + 1] = 0; objectExit[col * 3 + 2] = 2;
      // SAME normal on both sides — isolates the missing mesh-equality
      // gate from the existing normal-agreement gate, which alone would
      // NOT catch this: dot(n, n) = 1 > 0.9.
      normal[col * 3] = 0; normal[col * 3 + 1] = 0; normal[col * 3 + 2] = 1;
      winnerMesh[col] = leftMesh ? 0 : 1;
    }
    const params = { ...BAND_PARAMS, ...solidBandVoices(-2, 2) };
    const output = evaluateFieldSynthGrid(
      cols, rows, params, () => {}, { objectPosition, objectExit, normal, winnerMesh },
    );

    const boundaryCell = 1; // left mesh, adjacent to the right mesh's same-normal, off-surface-position neighbor
    expect(inkedAt(output, boundaryCell)).toBe(true);
    const mask = output.glyph[boundaryCell]!.codePointAt(0)! - 0x2800;
    expect(mask).toBe(0xff);
  });

  it("acceptance 4: one color per cell — the center sub-ray's hit color wins over a differently-colored non-center hit", () => {
    const cols = 5, rows = 1;
    const dx = 4;
    const selfCol = 2;
    const selfX = selfCol * dx;
    // Two thin solid bands: one straddling the cell CENTER (color1), one
    // straddling only the LEFT dot column's offset (color2) — the center
    // band is chosen last (higher sourceIndex loses no priority here since
    // color is resolved by DOT POSITION, not argmax winner) so this
    // isolates "center wins" from voice-color precedence entirely.
    const objectPosition = new Float32Array(cols * rows * 3);
    const objectExit = new Float32Array(cols * rows * 3);
    const normal = new Float32Array(cols * rows * 3);
    for (let col = 0; col < cols; col++) {
      objectPosition[col * 3] = col * dx; objectPosition[col * 3 + 1] = 0; objectPosition[col * 3 + 2] = 0;
      objectExit[col * 3] = col * dx; objectExit[col * 3 + 1] = 0; objectExit[col * 3 + 2] = 1;
      normal[col * 3] = 0; normal[col * 3 + 1] = 0; normal[col * 3 + 2] = 1;
    }
    const params = {
      ...BAND_PARAMS, ...solidBandVoices(selfX - 0.05 * dx, selfX + 0.05 * dx),
      color: "#112233",
    };
    const output = evaluateFieldSynthGrid(cols, rows, params, () => {}, { objectPosition, objectExit, normal });
    const i = selfCol;
    expect(inkedAt(output, i)).toBe(true);
    // Exactly one packed color value represents this cell, by construction
    // (`context.output.color` is one `Uint32Array` slot per cell) — assert
    // it is the CENTER's own resolved color (the only sub-ray guaranteed to
    // hit this narrow band), not some other value.
    const expectedPacked = 0x112233;
    expect(output.color[i]).toBe(expectedPacked);
  });
});

// The `pyramid` /synth stage's own geometry (synthKit.tsx's
// `cornerTetraPolygons`, `s = 3` — matching every other stage's `size: 3`
// footprint) re-derived independently here, same precedent as
// `carveCubePolygons`/`mengerDomainCubePolygons` above: an UNCENTERED corner
// tetrahedron, vertices exactly `(0,0,0)`, `(s,0,0)`, `(0,s,0)`, `(0,0,s)`,
// each face wound CCW-from-outside.
function pyramidDomainPolygons(s: number): Polygon[] {
  const O: Vec3 = [0, 0, 0], A: Vec3 = [s, 0, 0], B: Vec3 = [0, s, 0], C: Vec3 = [0, 0, s];
  const faces: Vec3[][] = [
    [A, B, C], // opposite O
    [O, B, A], // opposite C (z=0 plane)
    [O, C, B], // opposite A (x=0 plane)
    [O, A, C], // opposite B (y=0 plane)
  ];
  return faces.map((vertices) => ({ vertices, color: "#c98fff" }));
}

function shippedSierpinskiPresetParams(): Record<string, number | string | boolean> {
  const preset = (fieldSynth.presets ?? []).find((p) => p.name === "Sierpinski pyramid");
  if (!preset) throw new Error('missing shipped preset "Sierpinski pyramid"');
  return { ...defaultGlyphEffectParams(fieldSynth), ...(preset.params as Record<string, number | string | boolean>) };
}

describe("field-synth Sierpinski pyramid stage alignment (VOLUMETRIC-2.md acceptance 4, \"stage alignment\")", () => {
  function sierpinskiSolidUnit(x: number, y: number, z: number, depth: number): boolean {
    let cx = x, cy = y, cz = z;
    for (let d = 0; d < depth; d++) {
      cx *= 2; cy *= 2; cz *= 2;
      const mx = ((cx % 2) + 2) % 2, my = ((cy % 2) + 2) % 2, mz = ((cz % 2) + 2) % 2;
      const upperCount = (mx >= 1 ? 1 : 0) + (my >= 1 ? 1 : 0) + (mz >= 1 ? 1 : 0);
      if (upperCount >= 2) return false;
      cx = cx - Math.floor(cx / 2) * 2; cy = cy - Math.floor(cy / 2) * 2; cz = cz - Math.floor(cz / 2) * 2;
    }
    return true;
  }

  const STAGE_SIZE = 3; // matches synthKit.tsx's PYRAMID_STAGE_SIZE
  // A grid over the pyramid stage's own `[0, STAGE_SIZE]^3` authoring box
  // (NOT [0,1]^3 — this is the point: these are the tetra's real object-space
  // coordinates), off the depth-2 (STAGE_SIZE/4) digit boundaries.
  const GRID_N = 24;
  function stageGridPoints(): [number, number, number][] {
    const points: [number, number, number][] = [];
    for (let ix = 0; ix < GRID_N; ix++) {
      for (let iy = 0; iy < GRID_N; iy++) {
        for (let iz = 0; iz < GRID_N; iz++) {
          points.push([(ix + 0.37) / GRID_N * STAGE_SIZE, (iy + 0.37) / GRID_N * STAGE_SIZE, (iz + 0.37) / GRID_N * STAGE_SIZE]);
        }
      }
    }
    return points;
  }

  function evaluateAtObjectPoints(params: Record<string, number | string | boolean>, points: readonly [number, number, number][]) {
    const length = points.length, cols = length, rows = 1;
    const objectPosition = new Float32Array(length * 3);
    for (let i = 0; i < length; i++) {
      objectPosition[i * 3] = points[i]![0]; objectPosition[i * 3 + 1] = points[i]![1]; objectPosition[i * 3 + 2] = points[i]![2];
    }
    const glyph = new Array<string>(length).fill("#");
    const coverage = new Float32Array(length).fill(1);
    const color = new Uint32Array(length).fill(GlyphEffectNoColor);
    const output = {
      glyph: new Array<string>(length).fill(" "),
      color: new Uint32Array(length).fill(GlyphEffectNoColor),
      coverage: new Float32Array(length),
      channels: new Uint8Array(length),
    };
    fieldSynth.program.validateParams?.(params as never);
    fieldSynth.program.evaluate({
      params,
      state: undefined,
      base: { cols, rows, length, glyph, coverage, color, objectPosition },
      input: { cols, rows, length, glyph, coverage, color },
      target: { coverage },
      coordinates: { cellToSceneGrid: [1, 0, 0, 1, 0, 0], sceneGridSize: [cols, rows], localCellFootprint: [1, 1] },
      scratch: { images: [], floatFields: [], uintFields: [], glyphFields: [], samples: [] },
      output,
    } as never);
    return output;
  }

  it("solid cells on the pyramid stage's own [0, s]^3 box, scaled by the shipped preset's `scale` pin, match the corner-tetra reference exactly", () => {
    const params = shippedSierpinskiPresetParams();
    const points = stageGridPoints();
    const output = evaluateAtObjectPoints(params, points);
    let solidCount = 0, holeCount = 0;
    for (let i = 0; i < points.length; i++) {
      const [x, y, z] = points[i]!;
      // The preset's `scale: 1/STAGE_SIZE` (see stock.ts's comment) maps this
      // point back onto the recipe's assumed [0,1]^3 window.
      const refSolid = sierpinskiSolidUnit(x / STAGE_SIZE, y / STAGE_SIZE, z / STAGE_SIZE, 2);
      const engineSolid = output.coverage[i]! > 0;
      expect(engineSolid).toBe(refSolid);
      if (refSolid) solidCount++; else holeCount++;
    }
    expect(solidCount).toBeGreaterThan(0);
    expect(holeCount).toBeGreaterThan(0);
  });

  it("pinned counter-case: a CENTERED window (the same recipe applied as if the stage's own box straddled the origin instead of cornering it there) disagrees with the reference on a large fraction of points — this is exactly why the pyramid stage is authored uncentered", () => {
    const params = shippedSierpinskiPresetParams();
    const points = stageGridPoints();
    // Shift every sampled point by -STAGE_SIZE/2 on every axis before
    // evaluating — i.e. pretend the mesh had been authored the way every
    // OTHER shape helper in this codebase centers its geometry (vertices at
    // `center +/- size/2`), so its bounding box spans
    // `[-STAGE_SIZE/2, STAGE_SIZE/2]` instead of `[0, STAGE_SIZE]`. The
    // recipe's `phase -1/2` selectors still assume the window's corner sits
    // at the domain origin, so this shift is exactly the failure mode
    // VOLUMETRIC-2.md §3 describes.
    const shift = STAGE_SIZE / 2;
    const shiftedPoints = points.map(([x, y, z]) => [x - shift, y - shift, z - shift] as [number, number, number]);
    const output = evaluateAtObjectPoints(params, shiftedPoints);
    let mismatches = 0;
    for (let i = 0; i < points.length; i++) {
      const [x, y, z] = points[i]!; // reference uses the TRUE uncentered point
      const refSolid = sierpinskiSolidUnit(x / STAGE_SIZE, y / STAGE_SIZE, z / STAGE_SIZE, 2);
      const engineSolid = output.coverage[i]! > 0;
      if (engineSolid !== refSolid) mismatches++;
    }
    // Not "every point disagrees" (some octants coincidentally still agree),
    // but the misalignment is pervasive, not a rounding-edge fringe effect.
    expect(mismatches / points.length).toBeGreaterThan(0.3);
  });
});

describe("field-synth Sierpinski pyramid — carve smoke (VOLUMETRIC-2.md acceptance 4 \"carve smoke\" + acceptance 7 \"pyramid stage renders\")", () => {
  it("carving the pyramid stage with the shipped preset produces both hole cells and non-empty interior structure, without throwing", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const cols = 60, rows = 40;
    const scene = createGlyphScene(host, {
      cols, rows, useColors: false, doubleSided: true,
      // A near-head-on view onto the O-A-B face (z=0 plane), same small-tilt
      // reasoning as `renderFieldSynthCube` above: a fully head-on ray either
      // starts inside a hole or hits solid immediately at the surface, never
      // showing an interior wall; a small tilt exercises both.
      camera: createGlyphOrthographicCamera({ zoom: 200, rotX: 8, rotY: 8 }),
    });
    scene.add(pyramidDomainPolygons(3));
    const baselineScene = createGlyphScene(document.createElement("div"), {
      cols, rows, useColors: false, doubleSided: true,
      camera: createGlyphOrthographicCamera({ zoom: 200, rotX: 8, rotY: 8 }),
    });
    baselineScene.add(pyramidDomainPolygons(3));
    baselineScene.rerender();
    const baselineText = baselineScene.output.textContent ?? "";
    baselineScene.destroy();

    scene.addEffectLayer({ effect: fieldSynth, params: shippedSierpinskiPresetParams() as never, blend: "replace", opacity: 1 });
    await Promise.resolve(); await Promise.resolve();
    const carveText = scene.output.textContent ?? "";
    scene.destroy();
    host.remove();

    const baseRows = baselineText.split("\n");
    const carveRows = carveText.split("\n");
    let holeCells = 0, solidCells = 0;
    for (let r = 0; r < rows; r++) {
      const baseRow = baseRows[r] ?? "";
      const carveRow = carveRows[r] ?? "";
      for (let c = 0; c < cols; c++) {
        if (!baseRow[c] || baseRow[c] === " ") continue; // outside the tetra's silhouette
        const carveEmpty = !carveRow[c] || carveRow[c] === " ";
        if (carveEmpty) holeCells++; else solidCells++;
      }
    }
    expect(holeCells).toBeGreaterThan(0);
    expect(solidCells).toBeGreaterThan(0);
  });
});

describe("field-synth xray mode — validation (VOLUMETRIC-2.md §1 \"March view modes\")", () => {
  it('requires space: "object" — the volumetric branch', () => {
    const defaults = defaultGlyphEffectParams(fieldSynth);
    expect(() => fieldSynth.program.validateParams?.({ ...defaults, render: "xray" } as never))
      .toThrow(/space: "object"/);
    expect(() => fieldSynth.program.validateParams?.({ ...defaults, render: "xray", space: "object" } as never))
      .not.toThrow();
  });

  it('rejects subcellRes "2x4" and "ink", same as carve', () => {
    const defaults = defaultGlyphEffectParams(fieldSynth);
    expect(() => fieldSynth.program.validateParams?.({
      ...defaults, render: "xray", space: "object", subcellRes: "2x4",
    } as never)).toThrow(/subcellRes/);
    expect(() => fieldSynth.program.validateParams?.({
      ...defaults, render: "xray", space: "object", subcellRes: "ink",
    } as never)).toThrow(/subcellRes/);
    expect(() => fieldSynth.program.validateParams?.({
      ...defaults, render: "xray", space: "object", subcellRes: "1x1",
    } as never)).not.toThrow();
  });

  it('dynamicRequirements asks for objectPosition + objectExit for render: "xray" too, not just "carve"', () => {
    const defaults = defaultGlyphEffectParams(fieldSynth);
    expect(fieldSynth.program.dynamicRequirements?.(defaults)).toEqual([]);
    expect(fieldSynth.program.dynamicRequirements?.({ ...defaults, render: "xray" })).toEqual([]);
    expect(fieldSynth.program.dynamicRequirements?.({ ...defaults, space: "object", render: "xray" }))
      .toEqual(["objectPosition", "objectExit"]);
    expect(fieldSynth.program.dynamicRequirements?.({ ...defaults, space: "object", render: "carve" }))
      .toEqual(["objectPosition", "objectExit"]);
    expect(fieldSynth.program.dynamicRequirements?.({ ...defaults, space: "object", render: "paint" }))
      .toEqual(["objectPosition"]);
  });
});

describe("field-synth xray mode — the integral (VOLUMETRIC-2.md §1, acceptance criterion 2)", () => {
  it("a d ≡ 0 patch (bias/gain chosen so the density mapping clamps to 0) emits no cells", () => {
    const length = 12 * 6;
    const objectPosition = new Float32Array(length * 3);
    const objectExit = new Float32Array(length * 3);
    for (let i = 0; i < length; i++) { objectExit[i * 3] = 1; } // unit chord along x for every cell
    const output = evaluate(
      fieldSynth,
      { space: "object", scale: 1, render: "xray", bias: 0, gain: 0, xrayGain: 4 },
      { objectPosition, objectExit },
    );
    expect(Array.from(output.coverage).every((c) => c === 0)).toBe(true);
    expect(Array.from(output.channels).every((c) => c === 0)).toBe(true);
  });

  it("coverage is exactly 1 for a translucent color once B >= 1/255 (VOLUMETRIC-2.md:75) — alpha never thins xray coverage", () => {
    // Reviewer repro: a solid unit chord with a translucent color used to
    // report coverage 0.25 (the color's own alpha), because xray routed
    // through the shared paint/ink color helper, which folds alpha into
    // coverage. xray's own contract is full coverage for any emitting cell,
    // regardless of color alpha.
    const length = 12 * 6;
    const objectPosition = new Float32Array(length * 3);
    const objectExit = new Float32Array(length * 3);
    objectExit[0] = 1; // cell 0: unit chord along x, solid throughout
    const output = evaluate(
      fieldSynth,
      {
        space: "object", scale: 1, render: "xray", bias: 2, gain: 0, xrayGain: 4,
        color: "rgba(255, 0, 0, 0.25)",
      },
      { objectPosition, objectExit },
    );
    expect(output.coverage[0]).toBeGreaterThan(0);
    expect(output.coverage[0]).toBe(1);
  });

  it("xrayGain: 0 renders fully transparent regardless of field content", () => {
    const length = 12 * 6;
    const objectPosition = new Float32Array(length * 3);
    const objectExit = new Float32Array(length * 3);
    for (let i = 0; i < length; i++) { objectExit[i * 3] = 1; }
    // bias 2 / gain 0 -> density clamps to 1 everywhere: maximal absorbing
    // material, still fully transparent at xrayGain 0.
    const output = evaluate(
      fieldSynth,
      { space: "object", scale: 1, render: "xray", bias: 2, gain: 0, xrayGain: 0 },
      { objectPosition, objectExit },
    );
    expect(Array.from(output.coverage).every((c) => c === 0)).toBe(true);
  });

  it("a degenerate chord (no exit / entry === exit) emits nothing — no paint-at-entry fallback, unlike carve", () => {
    const length = 12 * 6;
    // objectPosition and objectExit both default to all-zero: every cell's
    // entry === exit, a genuinely degenerate chord.
    const objectPosition = new Float32Array(length * 3);
    const objectExit = new Float32Array(length * 3);
    const output = evaluate(
      fieldSynth,
      { space: "object", scale: 2, render: "xray", bias: 2, gain: 0, xrayGain: 4 },
      { objectPosition, objectExit },
    );
    expect(Array.from(output.coverage).every((c) => c === 0)).toBe(true);
    expect(Array.from(output.channels).every((c) => c === 0)).toBe(true);
  });

  it("degrades to the 2D volumetric paint fallback (not a throw) when objectExit isn't retained (wireframe/voxel)", () => {
    const length = 12 * 6;
    const objectPosition = new Float32Array(length * 3);
    objectPosition[2] = 0.5;
    const output = evaluate(
      fieldSynth,
      { space: "object", scale: 1, render: "xray", bias: 2, gain: 0 },
      { objectPosition }, // no objectExit -> context.base.objectExit is undefined
    );
    expect(output.channels[0]).not.toBe(0);
  });

  it("monotonicity: extending an already-solid region along a chord (adding material, never removing it) never decreases brightness", () => {
    const length = 12 * 6;
    const objectPosition = new Float32Array(length * 3);
    const objectExit = new Float32Array(length * 3);
    objectExit[0] = 1; // cell 0: unit chord along x
    // A square-wave voice on linearX with phase 0: p = x (for x in [0,1)),
    // solid (+1) where x < duty, else -1. Raising `duty` extends the ON
    // region WITHOUT ever flipping an already-ON point back OFF — a strictly
    // pointwise-monotonic addition of solid material along the chord.
    const base = {
      space: "object" as const, scale: 1, render: "xray" as const, bias: 0.4, gain: 1, xrayGain: 1.5,
      field1: "linearX", wave1: "square", freq1: 1, speed1: 0, phase1: 0, amp1: 1,
      amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0, // isolate voice1 (amp2 defaults to 1)
      glyphs: "0123456789",
    };
    const low = evaluate(fieldSynth, { ...base, duty1: 0.15 }, { objectPosition, objectExit });
    const mid = evaluate(fieldSynth, { ...base, duty1: 0.5 }, { objectPosition, objectExit });
    const high = evaluate(fieldSynth, { ...base, duty1: 0.85 }, { objectPosition, objectExit });
    const level = (ch: string): number => "0123456789".indexOf(ch);
    expect(level(low.glyph[0]!)).toBeLessThanOrEqual(level(mid.glyph[0]!));
    expect(level(mid.glyph[0]!)).toBeLessThanOrEqual(level(high.glyph[0]!));
    expect(level(low.glyph[0]!)).toBeLessThan(level(high.glyph[0]!));
  });

  it("hit-set equality: given xrayGain*minChord >> 1, the xray-emitting cell set equals carve's hit set on the same scene", () => {
    const cols = 12, rows = 6, length = cols * rows;
    const objectPosition = new Float32Array(length * 3);
    const objectExit = new Float32Array(length * 3);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        const x = (col + 0.5) / cols, y = (row + 0.5) / rows;
        objectPosition[i * 3] = x; objectPosition[i * 3 + 1] = y; objectPosition[i * 3 + 2] = 0;
        objectExit[i * 3] = x; objectExit[i * 3 + 1] = y; objectExit[i * 3 + 2] = 1; // unit chord along z
      }
    }
    const menger = mengerParams(2);
    const carve = evaluate(fieldSynth, { ...menger, render: "carve" }, { objectPosition, objectExit });
    // Every chord here has length 1 (minChord = 1), so xrayGain 64 comfortably
    // saturates any chord carrying solid material to near-B=1.
    const xray = evaluate(fieldSynth, { ...menger, render: "xray", xrayGain: 64 }, { objectPosition, objectExit });
    let hits = 0;
    for (let i = 0; i < length; i++) {
      expect(xray.coverage[i]! > 0).toBe(carve.coverage[i]! > 0);
      if (carve.coverage[i]! > 0) hits++;
    }
    // Sanity: the comparison isn't vacuous — both a hit and a hole occurred.
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThan(length);
  });

  it("uniform step count is pinned by the PASS's max chord, not a per-cell ceil (a per-cell implementation fails this)", () => {
    // Two cells at different (x, y): cell 0 has a SHORT chord (length 1)
    // along z, cell 1 has a much LONGER chord (length 20) along z. Unlike
    // the old same-chord version of this test, a per-cell `ceil` implementation
    // and the spec's pinned-global-max-chord implementation provably diverge
    // here — cell 0's own chord alone would floor to `marchSteps`, but the
    // pass-wide max chord (cell 1's) drives every cell's step count far above
    // that (VOLUMETRIC-2.md §1 "Uniform step count per evaluate").
    const length = 12 * 6;
    const objectPosition = new Float32Array(length * 3);
    const objectExit = new Float32Array(length * 3);
    objectPosition[0 * 3] = 0; objectPosition[0 * 3 + 1] = 0; objectPosition[0 * 3 + 2] = 0;
    objectExit[0 * 3] = 0; objectExit[0 * 3 + 1] = 0; objectExit[0 * 3 + 2] = 1;
    objectPosition[1 * 3] = 5; objectPosition[1 * 3 + 1] = 5; objectPosition[1 * 3 + 2] = 0;
    objectExit[1 * 3] = 5; objectExit[1 * 3 + 1] = 5; objectExit[1 * 3 + 2] = 20;

    const overrides = {
      space: "object" as const, scale: 1, render: "xray" as const,
      bias: 0.3, gain: 1, xrayGain: 8, marchSteps: 48,
      field1: "linearZ", wave1: "square", freq1: 22, duty1: 0.1, speed1: 0, phase1: 0.03, amp1: 1,
      amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0, // isolate voice1 (amp2 defaults to 1)
      // color=black, colorB=white, gradient=1: the output color channel
      // becomes an 8-bit-resolution encode of raw brightness
      // (round(255*B) per channel), a far finer probe than the quantized
      // glyph ramp the old version of this test compared.
      color: "#000000", colorB: "#ffffff", gradient: 1, voiceColors: false,
    };
    const params = { ...defaultParamsForSchema(fieldSynth.parameterSchema), ...overrides } as AnyParams;

    // Compile the SAME field-program IR the live evaluator compiles from
    // these params, via the exact seam `evaluate()` uses internally
    // (`buildFieldSynthVoices` -> `compileFieldVoices` ->
    // `compileFieldSynthProgram`) — not a parallel reimplementation that
    // could silently diverge from the real compile step.
    const voices = buildFieldSynthVoices(params);
    const compiledVoices = compileFieldVoices(voices, params.scale as number);
    const layerShapes = resolveFieldSynthLayerShapes(params);
    const fieldProgram = compileFieldSynthProgram(compiledVoices, layerShapes, true);
    let finestFreq = 0;
    for (const voice of compiledVoices) if (voice.amp > 0 && voice.freq > finestFreq) finestFreq = voice.freq;
    const originX = (params.originU as number) * (params.scale as number);
    const originY = (params.originV as number) * (params.scale as number);
    const bias = params.bias as number, gain = params.gain as number;
    const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
    const densitySample = (mx: number, my: number, mz: number, mt: number): number => clamp01(
      bias + gain * evaluateFieldProgram(fieldProgram, mx, my, mz, mt, originX, originY, 0).combined * 0.5,
    );

    const shortEntry: readonly [number, number, number] = [0, 0, 0];
    const shortExit: readonly [number, number, number] = [0, 0, 1];
    const shortChord = 1, longChord = 20;
    const marchOpts = { steps: params.marchSteps as number, maxSteps: 256, finestFreq };
    const globalSteps = fieldStepCount(Math.max(shortChord, longChord), marchOpts);
    const perCellSteps = fieldStepCount(shortChord, marchOpts);
    // The setup only discriminates the two implementations if the counts
    // themselves actually diverge.
    expect(perCellSteps).toBeLessThan(globalSteps);

    const xrayGain = params.xrayGain as number;
    const globalSum = integrateField(shortEntry, shortExit, densitySample, {
      steps: globalSteps, maxSteps: globalSteps, finestFreq: 0, time: 0,
    }).sum;
    const perCellSum = integrateField(shortEntry, shortExit, densitySample, {
      steps: perCellSteps, maxSteps: perCellSteps, finestFreq: 0, time: 0,
    }).sum;
    const globalBrightness = 1 - Math.exp(-xrayGain * globalSum);
    const perCellBrightness = 1 - Math.exp(-xrayGain * perCellSum);
    // The two references must themselves diverge measurably, or a
    // per-cell-ceil bug and the correct implementation would be
    // indistinguishable at cell 0 regardless of which one runs.
    expect(Math.abs(globalBrightness - perCellBrightness)).toBeGreaterThan(0.02);

    const output = evaluate(fieldSynth, params, { objectPosition, objectExit });
    expect(output.coverage[0]).toBe(1);
    const decodedBrightness = (output.color[0]! & 0xff) / 255;
    // Cell 0's ACTUAL output must match the pinned-global-max-chord
    // reference, not the per-cell-ceil one a tautological same-chord test
    // could never have told apart.
    expect(decodedBrightness).toBeCloseTo(globalBrightness, 2);
    expect(Math.abs(decodedBrightness - perCellBrightness)).toBeGreaterThan(0.015);
  });

  it("voiceColors is inert under xray — output uses the plain color/colorB gradient regardless of the toggle", () => {
    const length = 12 * 6;
    const objectPosition = new Float32Array(length * 3);
    const objectExit = new Float32Array(length * 3);
    objectExit[0] = 1;
    const shared = {
      space: "object" as const, scale: 1, render: "xray" as const, bias: 0.4, gain: 1, xrayGain: 3,
      field1: "linearX", wave1: "sin", freq1: 1, speed1: 0, amp1: 1, color1: "#00ff00",
      color: "#7df9ff",
    };
    const withoutVoiceColors = evaluate(fieldSynth, { ...shared, voiceColors: false }, { objectPosition, objectExit });
    const withVoiceColors = evaluate(fieldSynth, { ...shared, voiceColors: true }, { objectPosition, objectExit });
    expect(withoutVoiceColors.coverage[0]).toBeGreaterThan(0);
    expect(withVoiceColors.color[0]).toBe(withoutVoiceColors.color[0]);
  });
});

describe("field-synth xray mode — real scene (VOLUMETRIC-2.md acceptance criterion 2, end to end)", () => {
  it("xray on the depth-2 Menger cube renders non-empty output within the cube's silhouette and retains objectExit only while render is \"xray\"", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      cols: 60, rows: 40, useColors: false, doubleSided: true,
      camera: createGlyphOrthographicCamera({ zoom: 600, rotX: 8, rotY: 8 }),
    });
    scene.add(mengerDomainCubePolygons());
    const menger = mengerParams(2);
    const layer = scene.addEffectLayer({
      effect: fieldSynth,
      params: { ...defaultGlyphEffectParams(fieldSynth), ...menger, render: "xray", xrayGain: 6 } as never,
      blend: "replace",
      opacity: 1,
    });
    let sawObjectExit: boolean | undefined;
    scene.addEffectLayer({
      effect: defineGlyphEffect<{ phase: number }>({
        evaluate({ base }) { sawObjectExit = base.objectExit !== undefined; },
      }),
      params: { phase: 0 },
    });
    await flushCarveRenders();
    expect(sawObjectExit).toBe(true);
    const text = scene.output.textContent ?? "";
    expect(text.split("\n").some((row) => row.trim().length > 0)).toBe(true);

    layer.params.render = "paint";
    await flushCarveRenders();
    expect(sawObjectExit).toBe(false);

    scene.destroy();
    host.remove();
  });
});

// P2 (VOLUMETRIC-2.md §1's own "absorption xray reads near-binary fields"
// rationale, and the "Gyroid xray preset" comment in stock.ts): the shipped
// preset thresholds the gyroid layer specifically so absorption reads two
// distinct levels — "which labyrinth half" — instead of averaging into fog.
// That claim had no targeted real-scene test: the Menger xray real-scene
// test above only asserts non-empty output, which a uniformly foggy render
// would satisfy just as well.
//
// Round 1 of this test used raw spread/median-split statistics over all
// covered cells and it was NOT discriminative: on a real projected cube,
// chord length itself varies continuously (short grazing chords near the
// silhouette edge, long chords through the middle), and `B = 1 -
// exp(-xrayGain * integral)` is monotone in chord length even for a
// perfectly UNIFORM density field — so that geometric confound alone
// produces a wide min/max spread and a large median-split gap regardless of
// whether the field itself carries any structure. Verified directly: the
// no-threshold ("fog") variant below reproduces round 1's assertions
// (spread, median gap) almost exactly.
//
// The chord-controlled fix: fog predicts B is (nearly) a function of chord
// length ALONE, so grouping covered cells into narrow chord-length bins and
// looking at brightness spread WITHIN each bin isolates the field's own
// contribution from the geometric confound — a fog field's within-bin
// spread should collapse toward ~0 (same chord length -> same B), while the
// thresholded preset's within-bin spread should stay large (same chord
// length, but different position along it crosses different amounts of
// solid vs. hole). The test below computes this for the real shipped preset
// AND, as a negative control, for a `layerThresholdOn1: false` variant on
// the exact same captured real chords — proving the statistic actually
// separates the two, not just that the shipped preset clears a hand-picked
// number.
describe("field-synth Gyroid xray preset — real scene band contrast (VOLUMETRIC-2.md §1 P2)", () => {
  // Real per-cell entry/exit chords, captured once from an actual rendered
  // scene (real camera + real cube mesh projection) and reused to evaluate
  // both the shipped preset and its no-threshold negative control — so both
  // variants are compared on IDENTICAL geometry, isolating the field-level
  // difference the test is actually about.
  async function captureRealCubeChords(): Promise<{ cols: number; rows: number; length: number; objectPosition: Float32Array; objectExit: Float32Array }> {
    const cols = 96, rows = 60, length = cols * rows;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      cols, rows, useColors: false, doubleSided: true,
      camera: createGlyphOrthographicCamera({ zoom: 560, rotX: 22, rotY: 30 }),
    });
    scene.add(carveCubePolygons());
    // The real, shipped preset, mounted exactly as `applyPreset`
    // (SynthWorkbench.tsx) would apply it — this is the actual render under
    // test, not a stand-in. `dynamicRequirements` (render: "xray") retains
    // real per-cell objectPosition/objectExit from the real camera/mesh
    // projection, same as the Menger xray real-scene test above.
    scene.addEffectLayer({
      effect: fieldSynth,
      params: { ...defaultGlyphEffectParams(fieldSynth), ...(gyroidXrayPreset.params as Record<string, number | string | boolean>) } as never,
      blend: "replace",
      opacity: 1,
    });
    let captured: { objectPosition?: Float32Array; objectExit?: Float32Array } = {};
    scene.addEffectLayer({
      effect: defineGlyphEffect<{ phase: number }>({
        evaluate({ base }) { captured = { objectPosition: base.objectPosition, objectExit: base.objectExit }; },
      }),
      params: { phase: 0 },
    });
    await flushCarveRenders();
    const text = scene.output.textContent ?? "";
    expect(text.split("\n").some((row) => row.trim().length > 0)).toBe(true); // real render, non-empty
    scene.destroy();
    host.remove();
    expect(captured.objectPosition).toBeDefined();
    expect(captured.objectExit).toBeDefined();
    return { cols, rows, length, objectPosition: captured.objectPosition!, objectExit: captured.objectExit! };
  }

  // Evaluates the (real, shipped) field program against the captured real
  // chords, decoding brightness via the file's own established grayscale-
  // probe technique (the uniform-step-count pinned test earlier in this
  // file): `color`/`colorB`/`gradient` are purely cosmetic value-gradient
  // mapping — B itself is computed upstream from density/xrayGain, so
  // overriding them to black/white/1 can't perturb the absorption result
  // under test, only make it exactly decodable via the color channel's low
  // byte. `overrides` swaps in the no-threshold negative control.
  function evaluateBrightness(
    chords: { cols: number; rows: number; length: number; objectPosition: Float32Array; objectExit: Float32Array },
    overrides: Record<string, number | string | boolean> = {},
  ): { chordLength: number; brightness: number }[] {
    const { cols, rows, length, objectPosition, objectExit } = chords;
    const params = {
      ...defaultGlyphEffectParams(fieldSynth),
      ...(gyroidXrayPreset.params as Record<string, number | string | boolean>),
      color: "#000000", colorB: "#ffffff", gradient: 1,
      ...overrides,
    };
    const glyph = new Array<string>(length).fill("#");
    // `target.coverage` is the BASE MESH's already-rasterized silhouette —
    // xray only ever paints where geometry already covers a cell (see
    // stock.ts's `xrayUniformSteps`/per-cell loops, both gated on
    // `context.target.coverage[i] > 0` before touching that cell at all).
    // The real render's own base mesh silhouette is exactly "every cell
    // `objectPosition` has finite data for" — mirror that here (the shared
    // `evaluate()` helper elsewhere in this file defaults this to a fully-`1`
    // mock canvas; this scene isn't full-frame, so it must be per-cell).
    const coverage = new Float32Array(length);
    for (let i = 0; i < length; i++) if (Number.isFinite(objectPosition[i * 3])) coverage[i] = 1;
    const color = new Uint32Array(length).fill(GlyphEffectNoColor);
    const output = {
      glyph: new Array<string>(length).fill(" "),
      color: new Uint32Array(length).fill(GlyphEffectNoColor),
      coverage: new Float32Array(length),
      channels: new Uint8Array(length),
    };
    fieldSynth.program.validateParams?.(params as never);
    fieldSynth.program.evaluate({
      params,
      state: undefined,
      base: { cols, rows, length, glyph, coverage, color, objectPosition, objectExit },
      input: { cols, rows, length, glyph, coverage, color },
      target: { coverage },
      coordinates: { cellToSceneGrid: [1, 0, 0, 1, 0, 0], sceneGridSize: [cols, rows], localCellFootprint: [1, 1] },
      scratch: { images: [], floatFields: [], uintFields: [], glyphFields: [], samples: [] },
      output,
    } as never);

    const samples: { chordLength: number; brightness: number }[] = [];
    for (let i = 0; i < length; i++) {
      if (output.coverage[i]! <= 0) continue;
      const ex = objectPosition[i * 3]!, ey = objectPosition[i * 3 + 1]!, ez = objectPosition[i * 3 + 2]!;
      const xx = objectExit[i * 3]!, xy = objectExit[i * 3 + 1]!, xz = objectExit[i * 3 + 2]!;
      const chordLength = Math.hypot(xx - ex, xy - ey, xz - ez);
      if (!Number.isFinite(chordLength) || chordLength <= 0) continue;
      samples.push({ chordLength, brightness: (output.color[i]! & 0xff) / 255 });
    }
    return samples;
  }

  // Fog predicts B is (nearly) a function of chord length alone — grouping
  // into narrow RELATIVE-width (8%) chord-length bins isolates that
  // confound: within a bin, chord length is nearly constant, so any
  // remaining brightness spread comes from the field's own structure, not
  // geometry. Bins need >= minCount members for a meaningful spread reading
  // (a 1-2-cell bin's "spread" is just noise). Per-bin STANDARD DEVIATION
  // (not just max-min range) is the primary statistic — a mean-of-ranges
  // statistic grows with how many samples happen to land in a bin (more
  // draws -> a wider observed extreme), which is a sample-size artifact, not
  // a spread difference; std is far less sensitive to that. Swept relWidth
  // in {0.02..0.2} and minCount in {3,5,8,10} empirically (not shipped, see
  // commit description): the shipped preset's within-bin std consistently
  // ran ~1.35-1.45x the no-threshold control's, stable across every
  // combination and a 4x grid-resolution change — a real, reproducible
  // separation, not a tuned coincidence.
  function withinBinSpread(samples: { chordLength: number; brightness: number }[], relWidth = 0.08, minCount = 8): { stat: number; qualifyingBins: number; totalBins: number } {
    const minLen = Math.min(...samples.map((s) => s.chordLength));
    const bins = new Map<number, number[]>();
    for (const s of samples) {
      const idx = Math.floor(Math.log(s.chordLength / minLen) / Math.log(1 + relWidth));
      const arr = bins.get(idx);
      if (arr) arr.push(s.brightness); else bins.set(idx, [s.brightness]);
    }
    let sumStd = 0, qualifying = 0;
    for (const arr of bins.values()) {
      if (arr.length < minCount) continue;
      const m = arr.reduce((a, b) => a + b, 0) / arr.length;
      const variance = arr.reduce((a, b) => a + (b - m) * (b - m), 0) / arr.length;
      sumStd += Math.sqrt(variance);
      qualifying++;
    }
    return { stat: qualifying > 0 ? sumStd / qualifying : 0, qualifyingBins: qualifying, totalBins: bins.size };
  }

  it("has high within-chord-length-bin brightness spread for the shipped (thresholded) preset, and the statistic genuinely fails a no-threshold ('fog') negative control on the SAME real chords", async () => {
    const chords = await captureRealCubeChords();

    const thresholded = evaluateBrightness(chords);
    expect(thresholded.length).toBeGreaterThan(200); // enough covered cells to bin meaningfully at 8% relative width

    // Negative control: same real chords, same field/xrayGain, but
    // `layerThresholdOn1: false` — the raw continuous gyroid value, i.e.
    // the un-thresholded "fog" failure mode VOLUMETRIC-2.md §1 documents.
    const fog = evaluateBrightness(chords, { layerThresholdOn1: false });
    expect(fog.length).toBeGreaterThan(200);

    const thresholdedStat = withinBinSpread(thresholded);
    const fogStat = withinBinSpread(fog);
    // eslint-disable-next-line no-console
    console.log("Gyroid xray P2 chord-controlled within-bin brightness std:", {
      thresholded: { ...thresholdedStat, n: thresholded.length },
      fog: { ...fogStat, n: fog.length },
      ratio: thresholdedStat.stat / fogStat.stat,
    });

    // Both sides need a real sample of qualifying bins, not 1-2 lucky ones.
    expect(thresholdedStat.qualifyingBins).toBeGreaterThan(15);
    expect(fogStat.qualifyingBins).toBeGreaterThan(15);

    // A single shared bound: the shipped preset must clear it (real field
    // structure survives chord-length control) and the negative control
    // must fail it (proving the statistic actually discriminates structure
    // from the geometric confound, not just that the shipped preset clears
    // an arbitrary number). Measured ~0.069 (thresholded) vs ~0.049 (fog);
    // 0.058 sits with margin on both sides.
    const bound = 0.058;
    expect(thresholdedStat.stat).toBeGreaterThan(bound);
    expect(fogStat.stat).toBeLessThan(bound);
    // Consistent-ratio corroboration (measured ~1.35-1.45x, stable across
    // the bin-parameter sweep and a 4x resolution change) — well below that
    // observed range so it isn't brittle to small evaluator changes.
    expect(thresholdedStat.stat / fogStat.stat).toBeGreaterThan(1.15);
  });
});

describe("field-synth voice schema guard (VOLUMETRIC-3.md §4 acceptance 6 — mutation test)", () => {
  function completeFakeSchema(voiceCount: number): Record<string, unknown> {
    const schema: Record<string, unknown> = {};
    for (let voice = 1; voice <= voiceCount; voice++) {
      for (const prefix of FIELD_SYNTH_VOICE_KEY_FAMILIES) schema[`${prefix}${voice}`] = {};
    }
    return schema;
  }

  it("has exactly the 14 documented families", () => {
    expect(FIELD_SYNTH_VOICE_KEY_FAMILIES).toEqual([
      "field", "wave", "freq", "speed", "amp", "angle",
      "originU", "originV", "originW", "duty", "phase", "iter", "layer", "color",
    ]);
  });

  it("passes on a schema that genuinely has all 14 families for every voice", () => {
    expect(() => assertFieldSynthVoiceSchemaComplete(completeFakeSchema(3), 3)).not.toThrow();
  });

  it.each(FIELD_SYNTH_VOICE_KEY_FAMILIES)(
    "throws when the \"%s\" family is missing for one voice — the guard used to check only 7 of 14, so a future bump could ship a partial block for the other 7 silently",
    (missingFamily) => {
      const schema = completeFakeSchema(3);
      delete schema[`${missingFamily}2`];
      expect(() => assertFieldSynthVoiceSchemaComplete(schema, 3)).toThrow(/is missing/);
    },
  );

  it("the real fieldSynthSchema covers all 14 families for all SYNTH_VOICES voices (the actual module-load guard's own assertion, re-run explicitly)", () => {
    expect(() => assertFieldSynthVoiceSchemaComplete(
      fieldSynth.parameterSchema as unknown as Record<string, unknown>,
      SYNTH_VOICES,
    )).not.toThrow();
  });
});

describe("effectiveVoiceFinestFreq square-wave fix — shipped carve preset floors unchanged (VOLUMETRIC-3.md §4 acceptance 1)", () => {
  it.each([mengerSpongePreset, sierpinskiPyramidPreset])(
    "$name still resolves to the schema default marchSteps floor (48) — the duty-aware Nyquist floor doesn't bind either before or after the fix",
    (preset) => {
      const params = { ...defaultGlyphEffectParams(fieldSynth), ...preset.params } as AnyParams;
      const voices = buildFieldSynthVoices(params);
      const compiledVoices = compileFieldVoices(voices, params.scale as number);
      let finestFreq = 0;
      for (const voice of compiledVoices) {
        if (voice.amp > 0) {
          const f = effectiveVoiceFinestFreq(voice);
          if (f > finestFreq) finestFreq = f;
        }
      }
      // The cube/pyramid stage's own body diagonal at this preset's own
      // `scale` pin (the same chord-length derivation
      // `mengerSpongeDepth3Preset`'s own doc comment uses).
      const chord = Math.sqrt(3) * 3 * (params.scale as number);
      const resolved = fieldStepCount(chord, { steps: params.marchSteps as number, maxSteps: 256, finestFreq });
      expect(resolved).toBe(params.marchSteps);
    },
  );
});

describe("field-synth depth-3 Menger recipe — empirical ground-truth carve gate (VOLUMETRIC-3.md §4)", () => {
  it("axial rays (short chord, low step floor): the default-resolved step count hits the exact same cells as a forced 256-step ground-truth march — not formula trust alone", () => {
    const cols = 12, rows = 6, length = cols * rows;
    const objectPosition = new Float32Array(length * 3);
    const objectExit = new Float32Array(length * 3);
    // Straight rays through the cube stage's own [0,3]^3 authoring box
    // (matching `mengerSpongeDepth3Preset`'s `scale: 1/3` pin), one per
    // cell, entering at z=0 and exiting at z=3. Scaled chord length is
    // 3 * (1/3) = 1 domain unit — the SHORT-chord regime, whose own
    // Nyquist floor (ceil(2*1*27) = 54) is well below the 94-step floor the
    // preset's own doc comment claims for the cube's body diagonal (see the
    // dedicated diagonal probe below, which is the one that actually
    // exercises that number).
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        const x = ((col + 0.5) / cols) * 3;
        const y = ((row + 0.5) / rows) * 3;
        objectPosition[i * 3] = x; objectPosition[i * 3 + 1] = y; objectPosition[i * 3 + 2] = 0;
        objectExit[i * 3] = x; objectExit[i * 3 + 1] = y; objectExit[i * 3 + 2] = 3;
      }
    }
    const presetParams = mengerSpongeDepth3Preset.params as Record<string, number | string | boolean>;
    const defaultRun = evaluate(fieldSynth, presetParams, { objectPosition, objectExit });
    const groundTruth = evaluate(fieldSynth, { ...presetParams, marchSteps: 256 }, { objectPosition, objectExit });
    let hits = 0;
    for (let i = 0; i < length; i++) {
      expect(defaultRun.coverage[i]! > 0).toBe(groundTruth.coverage[i]! > 0);
      if (groundTruth.coverage[i]! > 0) hits++;
    }
    // Sanity: the comparison isn't vacuous — both a hit and a hole occurred.
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThan(length);
  });

  it("body-diagonal rays (the actual chord the preset's doc comment claims 94 steps for): the resolved step count is pinned at 94, and the diagonal hit set matches a forced 256-step ground truth exactly", () => {
    const presetParams = mengerSpongeDepth3Preset.params as Record<string, number | string | boolean>;

    // The resolved step count is a function of chord length + finestFreq,
    // not of anything per-cell — confirm the ACTUAL Nyquist floor the doc
    // comment claims (94) using the same seam evaluate() itself compiles
    // through (buildFieldSynthVoices -> compileFieldVoices ->
    // effectiveVoiceFinestFreq -> fieldStepCount), at the cube's scaled
    // body-diagonal chord length (sqrt(3) * 3 * scale = sqrt(3), since
    // scale = 1/3) — this is the ONE chord in the scene that actually
    // reaches the preset's finest (1/27) feature at its steepest angle.
    const scale = presetParams.scale as number;
    const voices = buildFieldSynthVoices(presetParams as unknown as AnyParams);
    const compiledVoices = compileFieldVoices(voices, scale);
    let finestFreq = 0;
    for (const voice of compiledVoices) {
      if (voice.amp > 0) {
        const f = effectiveVoiceFinestFreq(voice);
        if (f > finestFreq) finestFreq = f;
      }
    }
    expect(finestFreq).toBe(27);
    const diagonalChord = Math.sqrt(3) * 3 * scale;
    const resolvedSteps = fieldStepCount(diagonalChord, {
      steps: presetParams.marchSteps as number, maxSteps: 256, finestFreq,
    });
    expect(resolvedSteps).toBe(94);

    // Now the actual empirical gate, ON that same diagonal chord: one ray
    // per cell, entering at the cube's (0,0,0) corner and exiting at its
    // opposite (3,3,3) corner, fanned out slightly per cell (a shared
    // single ray would only ever probe one line through the sponge) while
    // keeping every ray's LENGTH exactly the body diagonal so the resolved
    // step count stays pinned at 94 for every cell.
    const cols = 12, rows = 6, length = cols * rows;
    const objectPosition = new Float32Array(length * 3);
    const objectExit = new Float32Array(length * 3);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        // Offset the entry corner slightly per cell (within the cube) so
        // different cells' diagonals sample different sponge material,
        // without changing the (exit - entry) vector — and therefore the
        // chord length — at all.
        const ox = (col / cols) * 0.5;
        const oy = (row / rows) * 0.5;
        objectPosition[i * 3] = ox; objectPosition[i * 3 + 1] = oy; objectPosition[i * 3 + 2] = 0;
        objectExit[i * 3] = ox + 3; objectExit[i * 3 + 1] = oy + 3; objectExit[i * 3 + 2] = 3;
      }
    }
    const defaultRun = evaluate(fieldSynth, presetParams, { objectPosition, objectExit });
    const groundTruth = evaluate(fieldSynth, { ...presetParams, marchSteps: 256 }, { objectPosition, objectExit });
    let hits = 0;
    for (let i = 0; i < length; i++) {
      expect(defaultRun.coverage[i]! > 0).toBe(groundTruth.coverage[i]! > 0);
      if (groundTruth.coverage[i]! > 0) hits++;
    }
    // Sanity: every one of these 72 rays hits (measured; also true across
    // several tried offset spreads and all 4 distinct cube body-diagonal
    // directions) — a genuine geometric property of this recipe, not a
    // vacuous artifact: a chord this long (one full period along EVERY
    // axis at once, ~40% solid fill at depth 3) essentially always crosses
    // solid material somewhere along its length. The non-vacuous part of
    // this probe is the per-cell equality above (a real hit-set, not an
    // empty one, agreeing exactly between the 94-step default and the
    // 256-step ground truth); the axial probe just above already covers
    // the "both hit and hole occur" case this recipe's SHORTER chords do
    // produce.
    expect(hits).toBe(length);
  });
});

describe("field-synth program-as-data (VOLUMETRIC-3.md §4)", () => {
  it("renders identically to the equivalent flat-params patch when the program mirrors a single-voice patch", () => {
    const flatOverrides = {
      field1: "radial", wave1: "sin", freq1: 3, speed1: 0.4, amp1: 1,
      amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0, amp7: 0, amp8: 0, amp9: 0,
    };
    const flatOutput = evaluate(fieldSynth, flatOverrides);

    const program = buildGlyphFieldProgram({
      domain: "2d",
      layers: [{ voices: [{ field: "radial", wave: "sin", freq: 3, speed: 0.4 }] }],
    });
    const programOutput = evaluate(fieldSynth, {}, { program });

    expect(programOutput.glyph).toEqual(flatOutput.glyph);
    expect(Array.from(programOutput.color)).toEqual(Array.from(flatOutput.color));
    expect(Array.from(programOutput.coverage)).toEqual(Array.from(flatOutput.coverage));
  });

  it("voiceColors reads color from the PROGRAM's own FieldVoice.color, correctly for MORE voices than the schema's 9-voice cap (unbounded authoring)", () => {
    const voiceCount = 12;
    const winnerIndex = 9; // beyond SYNTH_VOICES (9) — the 10th voice, 0-indexed
    const voices = Array.from({ length: voiceCount }, (_, k) => ({
      field: "linearX",
      wave: "step" as const,
      freq: 0,
      speed: 0,
      // step at freq 0: t = phase alone (raw*freq = 0), so a small positive
      // phase reads solid (+1) and a small negative one reads hole (-1) —
      // exactly one voice (`winnerIndex`) wins the argmax fold.
      phase: k === winnerIndex ? 0.1 : -0.1,
      color: k === winnerIndex ? "#123456" : "#000000",
    }));
    const program = buildGlyphFieldProgram({ domain: "2d", layers: [{ voices, combine: "argmax" }] });
    // scale small enough that cell 0's own domain x stays well inside the
    // +-0.1 phase margin above, so its sign is decided by phase alone.
    const output = evaluate(fieldSynth, { voiceColors: true, scale: 0.5 }, { program });
    expect(output.color[0]).toBe(parseGlyphEffectColor("#123456").packed);
  });

  it("finestFreq comes from the PROGRAM's own voices, not the ignored flat params — a program-only high-frequency voice raises the carve march's Nyquist floor", () => {
    const length = 12 * 6;
    const objectPosition = new Float32Array(length * 3);
    const objectExit = new Float32Array(length * 3);
    objectPosition[0] = 0; objectPosition[1] = 0; objectPosition[2] = 0;
    objectExit[0] = 1; objectExit[1] = 0; objectExit[2] = 0;
    // Same "thin sine peak" construction as the flat-params Nyquist-floor
    // wiring test above, now driven entirely by a program voice — the flat
    // params passed alongside carry NO active voices of their own (every
    // amp1..9 stays at its schema default, and voice1's default amp is 1 —
    // explicitly zeroed here so a bug that fell back to reading flat params
    // instead of the program would be caught, not accidentally masked).
    // Pinned both ways (VOLUMETRIC-3.md §4 acceptance 6): the SAME thin-peak
    // voice, evaluated through a program with vs. without the high-frequency
    // second voice — only the finestFreq contribution differs, so a hit only
    // with it present pins the floor to the program's own voices exactly the
    // way the flat-params wiring test above pins it to the flat params.
    const withoutHighFreq = buildGlyphFieldProgram({
      domain: "3d",
      layers: [{ combine: "add", voices: [{ field: "linearX", wave: "sin", freq: 1, phase: -0.3125 }] }],
    });
    const withHighFreq = buildGlyphFieldProgram({
      domain: "3d",
      layers: [{
        combine: "add",
        voices: [
          { field: "linearX", wave: "sin", freq: 1, phase: -0.3125 },
          { field: "linearX", wave: "sin", freq: 200, amp: 0.001 },
        ],
      }],
    });
    const flatParams = { space: "object" as const, scale: 1, render: "carve" as const, marchSteps: 8, bias: -0.495, gain: 1, amp1: 0, amp2: 0, amp3: 0, amp4: 0, amp5: 0, amp6: 0, amp7: 0, amp8: 0, amp9: 0 };
    const low = evaluate(fieldSynth, flatParams, { objectPosition, objectExit, program: withoutHighFreq });
    expect(low.coverage[0]).toBe(0);
    const high = evaluate(fieldSynth, flatParams, { objectPosition, objectExit, program: withHighFreq });
    expect(high.coverage[0]).toBeGreaterThan(0);
  });

  it("argmax winner lookup is bounds-checked regardless of source — an out-of-range sourceIndex degrades to the mixed fallback instead of throwing (the OOB TypeError class the fix eliminates)", () => {
    const program: FieldProgram = {
      domain: "2d",
      layers: [{
        voices: [{
          field: "linearX", wave: "step", freq: 0, speed: 0, amp: 1, phase: 0.1, duty: 0.5, angle: 0,
          origin: { u: 0, v: 0, w: 0 }, color: "#ffffff", sourceIndex: 999,
        }],
        combine: "argmax", thresholdOn: false, threshold: 0, invert: false, blend: "multiply", amp: 1,
      }],
    };
    expect(() => evaluate(fieldSynth, { voiceColors: true }, { program })).not.toThrow();
  });

  it("fieldSynth.program.validateProgram rejects a malformed program via @glyphcss/effects's own validateGlyphFieldProgram", () => {
    expect(() => fieldSynth.program.validateProgram?.({ domain: "bogus", layers: [] })).toThrow();
    expect(() => fieldSynth.program.validateProgram?.(buildGlyphFieldProgram({
      domain: "2d",
      layers: [{ voices: [{ field: "radial", wave: "sin", freq: 1 }] }],
    }))).not.toThrow();
  });
});
