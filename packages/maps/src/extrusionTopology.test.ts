import { expect, it, vi } from "vitest";
import type { Polygon, Vec3 } from "glyphcss";
import { createGlyphMapExtrusionTopology as compile } from "./extrusionOutline";
import { createGlyphMapExtrusionTopology as reference } from "./test/extrusionTopology28Reference";
import type { GlyphMapExtrusionGeometry } from "./layers";

function compare(polygons: Polygon[], groups: GlyphMapExtrusionGeometry[] = []) {
  const actual = compile(polygons, groups), expected = reference(polygons, groups);
  const fields = ({ vertexId, incidentFaces, prepare, ...data }: ReturnType<typeof compile>) => data;
  expect(fields(actual)).toEqual(fields(expected));
  return { actual, expected, fields };
}

it("retains first-seen coordinates, SameValueZero, repeated-face adjacency and directed edges", () => {
  const a: Vec3 = [-0, NaN, Infinity], b: Vec3 = [0, NaN, Infinity], c: Vec3 = [1, 2, 3];
  const polygons: Polygon[] = [{ vertices: [a, b, c, a] }, { vertices: [c, a, c] }];
  const geometry: GlyphMapExtrusionGeometry = { polygons, roof: [[a, c]], base: [[b, c]], roofEdges: [[a, c], [c, a], [b, c]] };
  const { actual, expected } = compare(polygons, [geometry]);
  expect(actual.vertices).toHaveLength(2);
  expect(Object.is(actual.vertices[0]![0], -0)).toBe(true);
  expect(actual.vertexId([0, NaN, Infinity])).toBe(0);
  for (const [x, y] of [[a, c], [c, a], [a, a]]) {
    expect([...actual.incidentFaces(x!, y!)]).toEqual([...expected.incidentFaces(x!, y!)]);
    expect(actual.incidentFaces(x!, y!)).toBe(actual.incidentFaces(x!, y!));
  }
});

it("retains all fields when outline-only vertices and directed pairs outgrow the initial tables", () => {
  const roof = Array.from({ length: 200 }, (_, i): Vec3 => [i / 13, i % 7, i / 19]);
  const base = roof.map(([x, y]): Vec3 => [x, y, -1]);
  const geometry: GlyphMapExtrusionGeometry = { polygons: [], roof: [roof], base: [base], roofEdges: [...roof.map((a, i) => [a, roof[(i + 1) % roof.length]!] as const), [roof[0]!, roof[1]!]] };
  const { actual, expected, fields } = compare([], [geometry]);
  expect(actual.vertices).toHaveLength(400);
  for (const v of roof) expect(actual.vertexId([...v] as Vec3)).toBe(expected.vertexId([...v] as Vec3));
  actual.prepare([]); expected.prepare([]);
  actual.prepare([geometry]); expected.prepare([geometry]);
  expect(fields(actual)).toEqual(fields(expected));
});

it("retains the left-associated BVH sort expression even for equal bounds", () => {
  // This sum rounds down: ((0.2 + 0.5) - 0.2) - 0.5 is not a centre difference.
  const polygons = Array.from({ length: 65 }, (): Polygon => ({ vertices: [[0.2, 0, 0], [0.5, 0, 0], [0.2, 0.01, 0]] }));
  compare(polygons);
});

it("compiles incident sets before direct queries rather than deferring their allocation", () => {
  const NativeSet = Set;
  let allocations = 0;
  class CountingSet<T> extends NativeSet<T> {
    constructor(values?: Iterable<T> | null) { super(values); allocations++; }
  }
  vi.stubGlobal("Set", CountingSet);
  let delta: number;
  try {
    const roof: Vec3[] = [[0, 0, 1], [1, 0, 1], [0, 1, 1]];
    const polygons: Polygon[] = [{ vertices: roof }];
    const geometry: GlyphMapExtrusionGeometry = { polygons, roof: [roof], base: [roof], roofEdges: [] };
    const topology = compile(polygons, [geometry]), before = allocations;
    for (const outline of topology.outlines) for (const edge of outline.edges) {
      topology.incidentFaces(topology.vertices[topology.edgeVertices[edge * 2]!]!, topology.vertices[topology.edgeVertices[edge * 2 + 1]!]!);
    }
    delta = allocations - before;
  } finally { vi.unstubAllGlobals(); }
  expect(delta).toBe(0);
});
