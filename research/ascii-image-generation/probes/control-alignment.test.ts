import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Polygon } from "@glyphcss/core";
import {
  createGlyphOrthographicCamera,
  createGlyphPerspectiveCamera,
  type GlyphCamera,
} from "../../../packages/glyphcss/src/api/createGlyphCamera";
import { buildRasterizeContext, type OcclusionMap } from "../../../packages/glyphcss/src/api/rasterizeContext";
import { rasterize, rasterizeToCells } from "../../../packages/glyphcss/src/render/rasterize";

type DictionaryEntry = { id: number; semanticGlyph: string; controlColor: string };
type SceneManifest = {
  contentSha256: string;
  instances: { id: string; classId: number }[];
  surfaces: { id: string; instanceId: string }[];
  polygonSurfaceIds: string[];
};
type GoldenFixture = { records: { dictionary: { classes: DictionaryEntry[] }; scenes: SceneManifest[] } };
type GoldenRaster = {
  cases: Record<string, {
    winnerMask: string[];
    coverageMask: string[];
    winnerSha256: string;
    coverageSha256: string;
    landmarks: { row: number; col: number; winner: number; coverage: number }[];
  }>;
};
type Resolution = {
  polygon: number;
  surfaceId: string;
  instanceId: string;
  classId: number;
  semanticGlyph: string;
  controlColor: string;
};

const root = resolve(process.cwd(), "../..");
const golden = JSON.parse(readFileSync(resolve(root, "research/ascii-image-generation/fixtures/schema/valid/golden.json"), "utf8")) as GoldenFixture;
const dictionary = JSON.parse(readFileSync(resolve(root, "research/ascii-image-generation/config/glyph-object-dictionary.json"), "utf8")) as { classes: DictionaryEntry[] };
const scene = golden.records.scenes[0]!;
const goldenRaster = JSON.parse(readFileSync(resolve(root, "research/ascii-image-generation/fixtures/lineage/control-alignment-golden.json"), "utf8")) as GoldenRaster;

// These expectations deliberately live independently of the lineage resolver.
// Polygon 1 and 2 are separate triangles/polygons of one authored surface;
// polygon 3 is a second instance of the same cube class.
const expectedByPolygon: readonly Resolution[] = [
  { polygon: 0, surfaceId: "surface/cube-a-front", instanceId: "instance/cube-a", classId: 1, semanticGlyph: "A", controlColor: "#e63946" },
  { polygon: 1, surfaceId: "surface/cube-a-front", instanceId: "instance/cube-a", classId: 1, semanticGlyph: "A", controlColor: "#e63946" },
  { polygon: 2, surfaceId: "surface/cube-b-front", instanceId: "instance/cube-b", classId: 1, semanticGlyph: "A", controlColor: "#e63946" },
  { polygon: 3, surfaceId: "surface/floor-a-top", instanceId: "instance/floor-a", classId: 2, semanticGlyph: "B", controlColor: "#457b9d" },
];

function polygon(vertices: [number, number, number][], uvs: [number, number][]): Polygon {
  return { vertices, uvs, color: "#ffffff" };
}

function labeledFixture(): Polygon[] {
  return [
    polygon([[-1.7, -1.35, 1], [-1.7, -0.72, 1], [1.7, -0.72, 1], [1.7, -1.35, 1]], [[0, 0], [0, 1], [0.25, 1], [0.25, 0]]),
    polygon([[-1.7, -0.69, 1], [-1.7, -0.06, 1], [1.7, -0.06, 1], [1.7, -0.69, 1]], [[0.25, 0], [0.25, 1], [0.5, 1], [0.5, 0]]),
    polygon([[-1.7, 0.1, 1], [-1.7, 1.35, 1], [1.7, 1.35, 1], [1.7, 0.1, 1]], [[0.5, 0], [0.5, 1], [0.75, 1], [0.75, 0]]),
    polygon([[-2, -1.6, 0], [-2, 1.6, 0], [2, 1.6, 0], [2, -1.6, 0]], [[0.75, 0], [0.75, 1], [1, 1], [1, 0]]),
  ];
}

function camera(kind: "orthographic" | "perspective", rotY = 0): GlyphCamera {
  return kind === "orthographic"
    ? createGlyphOrthographicCamera({ rotX: 0, rotY, zoom: 100 })
    : createGlyphPerspectiveCamera({ rotX: 0, rotY, zoom: 100, perspective: 800, distance: 4 });
}

function context(cameraValue: GlyphCamera, polygons = labeledFixture(), supersample = 1, occlusion: OcclusionMap | null = null) {
  return buildRasterizeContext({
    camera: cameraValue,
    grid: { cols: 32, rows: 20, cellAspect: 1 },
    polygons,
    mode: "solid",
    useColors: false,
    doubleSided: true,
    supersample,
    directionalLight: { direction: [0, 0, 1], intensity: 0 },
    ambientLight: { intensity: 1 },
    retainWinnerPolygon: true,
    retainShade: true,
    retainWorldPosition: true,
    retainNormal: true,
    occlusion,
  });
}

function frameText(chars: readonly string[], cols: number): string {
  return Array.from({ length: chars.length / cols }, (_, row) => chars.slice(row * cols, (row + 1) * cols).join("")).join("\n");
}

function resolveWinner(polygonIndex: number): Resolution {
  const surfaceId = scene.polygonSurfaceIds[polygonIndex];
  if (!surfaceId) throw new Error(`fixture lacks surface for polygon ${polygonIndex}`);
  const surface = scene.surfaces.find((candidate) => candidate.id === surfaceId);
  if (!surface) throw new Error(`fixture lacks surface ${surfaceId}`);
  const instance = scene.instances.find((candidate) => candidate.id === surface.instanceId);
  if (!instance) throw new Error(`fixture lacks instance ${surface.instanceId}`);
  const entry = dictionary.classes.find((candidate) => candidate.id === instance.classId);
  if (!entry) throw new Error(`fixture lacks dictionary class ${instance.classId}`);
  return { polygon: polygonIndex, surfaceId, instanceId: instance.id, classId: entry.id, semanticGlyph: entry.semanticGlyph, controlColor: entry.controlColor };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function mask(values: readonly number[], cols: number): string[] {
  return Array.from({ length: values.length / cols }, (_, row) => values.slice(row * cols, (row + 1) * cols).map((value) => value < 0 ? "." : String(value)).join(""));
}

function coverageMask(chars: readonly string[], cols: number): string[] {
  return Array.from({ length: chars.length / cols }, (_, row) => chars.slice(row * cols, (row + 1) * cols).map((glyph) => glyph === " " ? "." : "#").join(""));
}

function assertGoldenRaster(name: string, grid: ReturnType<typeof rasterizeToCells>): void {
  const expected = goldenRaster.cases[name];
  const winners = Array.from(grid.winnerPolygon ?? []);
  const actualWinnerMask = mask(winners, grid.cols);
  const actualCoverageMask = coverageMask(grid.char, grid.cols);
  if (!expected) throw new Error(`missing checked-in B3 raster golden ${name}`);
  expect(actualWinnerMask).toEqual(expected.winnerMask);
  expect(actualCoverageMask).toEqual(expected.coverageMask);
  expect(sha256(actualWinnerMask.join("\n"))).toBe(expected.winnerSha256);
  expect(sha256(actualCoverageMask.join("\n"))).toBe(expected.coverageSha256);
  for (const landmark of expected.landmarks) {
    const index = landmark.row * grid.cols + landmark.col;
    expect(winners[index]).toBe(landmark.winner);
    expect(grid.char[index] === " " ? 0 : 1).toBe(landmark.coverage);
  }
}

function semanticFromWinners(winners: Int32Array): { ascii: string[]; colors: (string | null)[]; resolved: (Resolution | null)[] } {
  const resolved = Array.from(winners, (winner) => winner < 0 ? null : resolveWinner(winner));
  return {
    ascii: resolved.map((entry) => entry?.semanticGlyph ?? " "),
    colors: resolved.map((entry) => entry?.controlColor ?? null),
    resolved,
  };
}

function assertCapturedLineage(name: string, kind: "orthographic" | "perspective", supersample: number, rotY = 0): void {
  const source = context(camera(kind, rotY), labeledFixture(), supersample);
  const visibleText = rasterize(source);
  const grid = rasterizeToCells(source);
  const winners = grid.winnerPolygon;
  expect(winners).toBeInstanceOf(Int32Array);
  expect(grid.shade).toBeInstanceOf(Float32Array);
  expect(grid.depth).toBeInstanceOf(Float64Array);
  expect(grid.worldPosition).toBeInstanceOf(Float32Array);
  expect(grid.normal).toBeInstanceOf(Float32Array);
  expect(grid.surfaceUv).toBeInstanceOf(Float32Array);
  expect(visibleText).toBe(frameText(grid.char, grid.cols));
  assertGoldenRaster(name, grid);

  const semantic = semanticFromWinners(winners!);
  const coveredWinners = new Set(Array.from(winners!).filter((winner) => winner >= 0));
  expect(coveredWinners).toEqual(new Set([0, 1, 2, 3]));
  expect(semantic.ascii.some((glyph) => glyph === "A")).toBe(true);
  expect(semantic.ascii.some((glyph) => glyph === "B")).toBe(true);
  expect(frameText(semantic.ascii, grid.cols)).not.toBe(visibleText);

  for (let index = 0; index < winners!.length; index++) {
    const winner = winners![index]!;
    const resolution = semantic.resolved[index]!;
    if (winner < 0) {
      expect(grid.char[index]).toBe(" ");
      expect(semantic.ascii[index]).toBe(" ");
      expect(semantic.colors[index]).toBeNull();
      expect(grid.depth[index]).toBe(-Infinity);
      expect(Number.isNaN(grid.shade![index]!)).toBe(true);
      expect(Number.isNaN(grid.worldPosition![index * 3]!)).toBe(true);
      expect(Number.isNaN(grid.normal![index * 3]!)).toBe(true);
      expect(Number.isNaN(grid.surfaceUv![index * 2]!)).toBe(true);
      continue;
    }
    expect(resolution).toEqual(expectedByPolygon[winner]);
    expect(grid.char[index]).not.toBe(" ");
    expect(semantic.ascii[index]).toBe(expectedByPolygon[winner]!.semanticGlyph);
    expect(semantic.colors[index]).toBe(expectedByPolygon[winner]!.controlColor);
    expect(Number.isFinite(grid.depth[index]!)).toBe(true);
    expect(Number.isFinite(grid.shade![index]!)).toBe(true);
    expect(Number.isFinite(grid.worldPosition![index * 3]!)).toBe(true);
    expect(Number.isFinite(grid.normal![index * 3]!)).toBe(true);
    expect(Number.isFinite(grid.surfaceUv![index * 2]!)).toBe(true);
    if (supersample === 1) expect(grid.shade![index]).toBeCloseTo(1, 6);
    else {
      expect(grid.shade![index]).toBeGreaterThan(0);
      expect(grid.shade![index]).toBeLessThanOrEqual(1);
    }
    expect(grid.normal![index * 3 + 2]).toBeCloseTo(-1, 6);
    expect(grid.worldPosition![index * 3 + 2]).toBeCloseTo(winner === 3 ? 0 : 1, 5);
    const [minU, maxU] = winner === 0 ? [0, 0.25]
      : winner === 1 ? [0.25, 0.5]
      : winner === 2 ? [0.5, 0.75]
      : [0.75, 1];
    expect(grid.surfaceUv![index * 2]).toBeGreaterThanOrEqual(minU - 1e-5);
    expect(grid.surfaceUv![index * 2]).toBeLessThanOrEqual(maxU + 1e-5);
  }
}

function assertSs1SemanticColorPass(kind: "orthographic" | "perspective", rotY = 0): void {
  const source = context(camera(kind, rotY));
  const retained = rasterizeToCells(source);
  const colored = rasterizeToCells({
    ...source,
    useColors: true,
    polygons: source.polygons.map((value, polygonIndex) => ({ ...value, color: resolveWinner(polygonIndex).controlColor })),
  });
  for (let index = 0; index < retained.char.length; index++) {
    const winner = retained.winnerPolygon![index]!;
    expect(colored.char[index] === " ").toBe(retained.char[index] === " ");
    if (winner < 0) expect(colored.color[index]).toBeNull();
    else expect(colored.color[index]).toBe(resolveWinner(winner).controlColor);
  }
}

describe("B3 control alignment: retained winner lineage", () => {
  it("uses the frozen B31 scene and B4 dictionary contracts for every opaque winner", () => {
    expect(scene.polygonSurfaceIds).toEqual([
      "surface/cube-a-front", "surface/cube-a-front", "surface/cube-b-front", "surface/floor-a-top",
    ]);
    expect(scene.contentSha256).toBe("0c45248d9d01d36cfa00ae15a18aafe2d1af3d8efa661297a794c2d4ea6a9d05");
    expect(scene.polygonSurfaceIds).toEqual(expectedByPolygon.map((entry) => entry.surfaceId));
    expect(dictionary.classes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1, semanticGlyph: "A", controlColor: "#e63946" }),
      expect.objectContaining({ id: 2, semanticGlyph: "B", controlColor: "#457b9d" }),
    ]));
    expect(expectedByPolygon[0]!.surfaceId).toBe(expectedByPolygon[1]!.surfaceId);
    expect(expectedByPolygon[0]!.instanceId).not.toBe(expectedByPolygon[2]!.instanceId);
    expect(expectedByPolygon[0]!.classId).toBe(expectedByPolygon[2]!.classId);
    assertCapturedLineage("orthographic", "orthographic", 1);
    assertCapturedLineage("perspective", "perspective", 1);
    assertSs1SemanticColorPass("orthographic");
    assertSs1SemanticColorPass("perspective");
  });

  it("keeps retained ownership aligned through adjacent cameras and supersampling", () => {
    assertCapturedLineage("orthographic", "orthographic", 1, 0);
    assertCapturedLineage("orthographic-adjacent", "orthographic", 1, 1);
    assertCapturedLineage("perspective-ss2", "perspective", 2, 0);
    assertSs1SemanticColorPass("orthographic", 1);
  });

  it("uses the retained -1 sentinel, rather than a second projector, for partial cross-layer occlusion", () => {
    const plain = context(camera("orthographic"));
    const unoccluded = rasterizeToCells(plain);
    const idMap = new Int32Array(plain.grid.cols * plain.grid.rows).fill(-1);
    for (let index = 0; index < idMap.length; index++) {
      if (unoccluded.winnerPolygon![index]! >= 0 && index % 3 === 0) idMap[index] = 99;
    }
    const occlusion: OcclusionMap = {
      idMap,
      layerId: 1,
      cols: plain.grid.cols,
      rows: plain.grid.rows,
      colScale: 1,
      colOffset: 0,
      rowScale: 1,
      rowOffset: 0,
    };
    const grid = rasterizeToCells(context(camera("orthographic"), labeledFixture(), 1, occlusion));
    assertGoldenRaster("orthographic-partial-occlusion", grid);
    expect(grid.winnerPolygon!.some((winner) => winner === -1)).toBe(true);
    expect(grid.winnerPolygon!.some((winner) => winner >= 0)).toBe(true);
    for (let index = 0; index < grid.winnerPolygon!.length; index++) {
      const occluded = idMap[index] === 99;
      expect(grid.winnerPolygon![index] === -1).toBe(occluded || unoccluded.winnerPolygon![index] === -1);
      expect(grid.char[index] === " ").toBe(grid.winnerPolygon![index] === -1);
    }
    expect(semanticFromWinners(grid.winnerPolygon!).ascii.some((glyph) => glyph === " ")).toBe(true);
    expect(semanticFromWinners(grid.winnerPolygon!).ascii.some((glyph) => glyph !== " ")).toBe(true);
  });

  it("fails a checked-in golden when ownership is spatially shifted or swapped", () => {
    const grid = rasterizeToCells(context(camera("orthographic")));
    const shifted = { ...grid, winnerPolygon: new Int32Array(grid.winnerPolygon!) };
    const left = 7 * grid.cols + 14;
    const right = 7 * grid.cols + 15;
    [shifted.winnerPolygon![left], shifted.winnerPolygon![right]] = [shifted.winnerPolygon![right]!, shifted.winnerPolygon![left]!];
    expect(() => assertGoldenRaster("orthographic", shifted)).toThrow();
  });

  it("rejects the no-buffer path at SS=2: box-averaged semantic colors cannot name the retained winner", () => {
    const labels = {
      floor: { semanticColor: "#ff0000" },
      cube: { semanticColor: "#00ff00" },
    };
    const left = polygon([[-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, -0.01, 0], [-0.5, -0.01, 0]], [[0, 0], [0, 1], [1, 1], [1, 0]]);
    const right = polygon([[-0.5, 0, 0], [0.5, 0, 0], [0.5, 0.5, 0], [-0.5, 0.5, 0]], [[0, 0], [0, 1], [1, 1], [1, 0]]);
    const base = buildRasterizeContext({
      camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 50 }),
      grid: { cols: 1, rows: 1, cellAspect: 1 },
      polygons: [left, right], mode: "solid", useColors: true, doubleSided: true, supersample: 2,
      directionalLight: { direction: [0, 0, 1], intensity: 0 }, ambientLight: { intensity: 1 },
    });
    const semanticColorPass = rasterizeToCells({
      ...base,
      polygons: [
        { ...left, color: labels.floor.semanticColor },
        { ...right, color: labels.cube.semanticColor },
      ],
    });
    const retained = rasterizeToCells({ ...base, retainWinnerPolygon: true });
    expect(retained.winnerPolygon![0]).toBe(0);
    expect(retained.worldPosition![1]).toBeLessThan(0);
    expect(semanticColorPass.color[0]).toMatch(/^#(?:7f|80)(?:7f|80)00$/);
    expect(semanticColorPass.color[0]).not.toBe(labels.floor.semanticColor);
    expect(semanticColorPass.color[0]).not.toBe(labels.cube.semanticColor);
  });
});
