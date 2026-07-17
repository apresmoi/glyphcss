import { describe, expect, it } from "vitest";
import {
  GlyphEffectNoColor,
  GlyphEffectOutputChannel,
  parseGlyphEffectColor,
} from "glyphcss";
import {
  GlyphEffectCatalog,
  defaultGlyphEffectParams,
  flowText,
  getGlyphEffect,
  matrixRain,
  scan,
} from "./stock";

type EffectUnderTest = typeof matrixRain | typeof flowText | typeof scan;
type GridAffine = readonly [number, number, number, number, number, number];

function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
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
  const params = { ...defaultGlyphEffectParams(definition), ...overrides };
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
