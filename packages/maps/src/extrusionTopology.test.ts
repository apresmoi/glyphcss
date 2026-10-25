import { expect, it, vi } from "vitest";
import type { Polygon, Vec3 } from "glyphcss";
import { compileGlyphMapExtrusionTopology, createGlyphMapExtrusionTopology as compile, prepareGlyphMapExtrusionOutlines, sameGlyphMapOutlineInputs } from "./extrusionOutline";
import { createGlyphMapExtrusionTopology as reference } from "./test/extrusionTopology28Reference";
import type { GlyphMapExtrusionGeometry } from "./layers";
import { expectConservativeTree } from "./test/conservativeTree";

type Topology = ReturnType<typeof compile>;

function compare(polygons: Polygon[], groups: GlyphMapExtrusionGeometry[] = []) {
  const actual = compile(polygons, groups), expected = reference(polygons, groups);
  const fields = ({ vertexId, incidentFaces, prepare, root, ...data }: Topology) => data;
  expect(fields(actual)).toEqual(fields(expected));
  expectConservativeTree(actual);
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

it("partitions equal, NaN and infinite bounds into conservative leaves", () => {
  // Equal sums once broke a comparator sort's ties; a select must still split them.
  const equal = Array.from({ length: 65 }, (): Polygon => ({ vertices: [[0.2, 0, 0], [0.5, 0, 0], [0.2, 0.01, 0]] }));
  const odd = Array.from({ length: 200 }, (_, i): Polygon => ({ vertices: [[i % 3 ? i : NaN, i % 7, 0], [i % 5 ? i + 1 : Infinity, -i, 1], [i, i, i % 11 ? 2 : -Infinity]] }));
  for (const polygons of [equal, odd, [...equal, ...odd]]) {
    const leaves = expectConservativeTree(compare(polygons).actual);
    expect(leaves.length).toBe(polygons.length);
  }
});

it("splits a large real-sized set into balanced leaves rather than one", () => {
  const polygons = Array.from({ length: 5000 }, (_, i): Polygon => ({ vertices: [[i % 97, (i * 31) % 89, i % 5], [i % 97 + 1, (i * 31) % 89, i % 5], [i % 97, (i * 31) % 89 + 1, i % 5 + 1]] }));
  const { actual } = compare(polygons);
  let leaves = 0, depth = 0;
  const walk = (node: typeof actual.root, d: number): void => {
    depth = Math.max(depth, d);
    if (node.faces) { leaves++; expect(node.faces.length).toBeGreaterThanOrEqual(16); } else { walk(node.children![0], d + 1); walk(node.children![1], d + 1); }
  };
  walk(actual.root, 0);
  expect(leaves).toBeGreaterThanOrEqual(5000 / 32);
  expect(depth).toBeLessThanOrEqual(Math.ceil(Math.log2(5000 / 16)));
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

it("compiles identically when run as a resumable job in slices (tree, faces and outlines all pause)", () => {
  const polygons = Array.from({ length: 5000 }, (_, i): Polygon => ({ vertices: [[i % 97, (i * 31) % 89, i % 5], [i % 97 + 1, (i * 31) % 89, i % 5], [i % 97, (i * 31) % 89 + 1, i % 5 + 1]] }));
  const groups = Array.from({ length: 300 }, (_, i): GlyphMapExtrusionGeometry => {
    const a: Vec3 = [i % 97, (i * 31) % 89, i % 5], b: Vec3 = [i % 97 + 1, (i * 31) % 89, i % 5], c: Vec3 = [i % 97, (i * 31) % 89 + 1, i % 5 + 1];
    return { polygons: [polygons[i]!], roof: [[a, b, c]], base: [[a, b, c]], roofEdges: [] };
  });
  const job = compileGlyphMapExtrusionTopology(polygons, groups);
  let steps = 0, next = job.next();
  while (!next.done) { steps++; next = job.next(); }
  // Faces (5000/512), the tree's large splits and the outlines (300/128) each paused it.
  expect(steps).toBeGreaterThanOrEqual(12);
  const sliced = next.value, expected = reference(polygons, groups);
  const fields = ({ vertexId, incidentFaces, prepare, root, ...data }: Topology) => data;
  expect(fields(sliced)).toEqual(fields(expected));
  // The tree is this compiler's own (the reference partitions differently); pausing must not change it.
  expectConservativeTree(sliced);
  expect(sliced.root).toEqual(compile(polygons, groups).root);
  // And an outline set added later through the job is the one `prepare` makes.
  const later = compile(polygons), viaJob = compile(polygons);
  later.prepare(groups);
  for (const step = prepareGlyphMapExtrusionOutlines(viaJob, groups); !step.next().done;);
  expect(fields(viaJob)).toEqual(fields(later));
});

it("treats a compiled topology as another's only for the same arrays and outlines in the same order", () => {
  const a: Polygon[] = [{ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] }], b: Polygon[] = [{ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] }];
  const g1 = { polygons: a, roof: [], base: [], roofEdges: [] } as GlyphMapExtrusionGeometry, g2 = { ...g1 };
  expect(sameGlyphMapOutlineInputs({ meshes: [a, b], geometries: [g1, g2] }, { meshes: [a, b], geometries: [g1, g2] })).toBe(true);
  // An equal-looking copy, another order, a missing or an extra mesh or outline: each is a different compile.
  expect(sameGlyphMapOutlineInputs({ meshes: [a, b], geometries: [g1] }, { meshes: [a, [...b]], geometries: [g1] })).toBe(false);
  expect(sameGlyphMapOutlineInputs({ meshes: [a, b], geometries: [g1] }, { meshes: [b, a], geometries: [g1] })).toBe(false);
  expect(sameGlyphMapOutlineInputs({ meshes: [a, b], geometries: [g1] }, { meshes: [a], geometries: [g1] })).toBe(false);
  expect(sameGlyphMapOutlineInputs({ meshes: [a], geometries: [g1, g2] }, { meshes: [a], geometries: [g1] })).toBe(false);
  expect(sameGlyphMapOutlineInputs({ meshes: [a], geometries: [g1] }, { meshes: [a], geometries: [{ ...g1 }] })).toBe(false);
});
