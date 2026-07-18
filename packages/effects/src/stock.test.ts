import { describe, expect, it } from "vitest";
import {
  GlyphEffectNoColor,
  GlyphEffectOutputChannel,
  parseGlyphEffectColor,
  type GlyphEffectParamSchema,
} from "glyphcss";
import {
  GlyphEffectCatalog,
  defaultGlyphEffectParams,
  fieldSynth,
  flowText,
  getGlyphEffect,
  glitch,
  matrixRain,
  noiseDissolve,
  ripple,
  scan,
  scramble,
  wipe,
  type GlyphStockEffect,
} from "./stock";

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
  normal?: Float32Array;
  cellToSceneGrid?: GridAffine;
  worldToSceneScale?: number;
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

  it("uses surface shade for every monochrome rain glyph", () => {
    const shade = new Float32Array(12 * 6).fill(0.25);
    const output = evaluate(matrixRain, {
      colorMode: "monochrome",
      color: "#804020",
      space: "scene",
      time: 1.25,
      speedMin: 5,
      speedMax: 5,
      density: 1,
      trail: 4,
    }, { shade });
    const shaded = parseGlyphEffectColor("#201008").packed;
    const rainColors: number[] = [];

    for (let i = 0; i < output.coverage.length; i++) {
      if (output.coverage[i]! <= 0) continue;
      expect(output.channels[i]! & GlyphEffectOutputChannel.Color).toBeTruthy();
      rainColors.push(output.color[i]!);
    }

    expect(rainColors.length).toBeGreaterThan(0);
    expect(new Set(rainColors)).toEqual(new Set([shaded]));
  });

  it("falls back to the selected monochrome color when surface shade is unavailable", () => {
    const output = evaluate(matrixRain, {
      colorMode: "monochrome",
      color: "#37c96f",
      space: "scene",
      time: 1.25,
      speedMin: 5,
      speedMax: 5,
      density: 1,
      trail: 4,
    });
    const selected = parseGlyphEffectColor("#37c96f").packed;
    const activeColors = Array.from(output.color).filter((_, index) => output.coverage[index]! > 0);

    expect(activeColors.length).toBeGreaterThan(0);
    expect(new Set(activeColors)).toEqual(new Set([selected]));
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
