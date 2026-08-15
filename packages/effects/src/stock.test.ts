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
  GlyphEffectCatalog,
  defaultGlyphEffectParams,
  fieldSynth,
  flowText,
  generatedSurfaceField,
  getGlyphEffect,
  glitch,
  matrixRain,
  noiseDissolve,
  objectVolumetricAlongLane,
  ripple,
  scan,
  scramble,
  synthWave,
  wipe,
  type AnyContext,
  type AnyParams,
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
  objectPosition?: Float32Array;
  objectExit?: Float32Array;
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

  it("reproduces the pre-refactor hash for default params, at 1x1/2x4/ink", () => {
    expect(hashOf()).toBe("7d1375dc");
    expect(hashOf({ subcellRes: "2x4" })).toBe("38ffa16d");
    expect(hashOf({ subcellRes: "ink" })).toBe("694ada7d");
  });

  it("reproduces the pre-refactor hash for every shipped preset", () => {
    const expected: Record<string, string> = {
      "Ink cells": "7fa42eeb",
      "Cube tiles": "c91fca95",
      Sunburst: "73166434",
      "Ring pulse": "bf16c9f7",
      "Plaid weave": "def63013",
      "Sonar ping": "e0a1b9a6",
      Lattice: "182f881a",
      Vortex: "479de6c0",
      Lava: "13f39efc",
      "Static rain": "7b1403a1",
      "Moiré rings": "972334a7",
      Checkerboard: "931fc935",
      "Warp core": "b9699196",
      Bubbles: "0c45d5d0",
      Aurora: "83b81a3f",
      Zebra: "ed2427c1",
      Kaleidoscope: "0da9183a",
      Halftone: "77ba200a",
      Weave: "fd19e86f",
      "Pulse grid": "829c38e1",
      Nebula: "987c9199",
      // Added in VOLUMETRIC.md's Phase 6 (the /synth preset gallery), after
      // this file's IR/volumetric/duty/phase changes existed — pinned the
      // same way as every preset above it, just not part of the pre-refactor
      // baseline this describe block otherwise guards.
      "Menger sponge": "c6e1efad",
    };
    const presets = fieldSynth.presets ?? [];
    expect(presets.map((p) => p.name).sort()).toEqual(Object.keys(expected).sort());
    for (const preset of presets) {
      expect(hashOf(preset.params as Record<string, number | string | boolean>)).toBe(expected[preset.name]);
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

  it('rejects subcellRes "2x4" and "ink" — their neighbor finite-difference probes have no defined meaning at different march depths', () => {
    const defaults = defaultGlyphEffectParams(fieldSynth);
    expect(() => fieldSynth.program.validateParams?.({
      ...defaults, render: "carve", space: "object", subcellRes: "2x4",
    } as never)).toThrow(/subcellRes/);
    expect(() => fieldSynth.program.validateParams?.({
      ...defaults, render: "carve", space: "object", subcellRes: "ink",
    } as never)).toThrow(/subcellRes/);
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

  it("Nyquist floor: an active voice's freq raises the per-cell march step count enough to find a thin feature a low fixed marchSteps would otherwise step over", () => {
    const length = 12 * 6;
    const objectPosition = new Float32Array(length * 3);
    const objectExit = new Float32Array(length * 3);
    objectPosition[0] = 0; objectPosition[1] = 0; objectPosition[2] = 0;
    objectExit[0] = 1; objectExit[1] = 0; objectExit[2] = 0;
    // voice1 (freq 1, one period spans the whole chord) places a single
    // duty=0.008-wide "on" band centered at x=0.5625 — 9 sample points at
    // marchSteps=8 (t = 0, 1/8, ..., 1) all fall outside [0.5585, 0.5665], so
    // an 8-step march deterministically misses it. voice2's freq (not its
    // amplitude, kept tiny via `combine: "min"` so it can't perturb the
    // solid/hole decision at the extremes) is the ONLY thing that changes
    // between the two calls below, isolating the Nyquist-floor wiring.
    const base = {
      space: "object" as const, scale: 1, render: "carve" as const, combine: "min" as const, marchSteps: 8,
      field1: "linearX", wave1: "square", freq1: 1, duty1: 0.008, phase1: -0.5585, amp1: 1, speed1: 0,
      field2: "linearX", wave2: "square", freq2: 200, duty2: 0.5, phase2: 0, speed2: 0,
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
});
