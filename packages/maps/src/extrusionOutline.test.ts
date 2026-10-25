import { expect, it, vi } from "vitest";
import type { CellGrid, Polygon, Vec3 } from "glyphcss";
import { createGlyphMapExtrusionSurface, createGlyphMapExtrusionTopology, stampGlyphMapExtrusionOutlines } from "./extrusionOutline";
import * as reference from "./test/extrusionOutlineReference";
import type { GlyphMapExtrusionGeometry } from "./layers";
const project = (v: Vec3) => ({ col:v[0],row:v[1],depth:v[2] });
const eye = () => Infinity;
const roof: Vec3[] = [[2.25,2.25,1],[2.25,6.25,1],[6.25,6.25,1],[6.25,2.25,1]];
const polygon: Polygon = {vertices:roof};
const geometry: GlyphMapExtrusionGeometry = {roof:[roof],base:[roof.map(v => [v[0],v[1],0])],roofEdges:[],polygons:[polygon],color:"#94a3b8"};
function grid(depth = -Infinity): CellGrid {
  return {cols:10,rows:10,screenX:new Int32Array(100),screenY:new Int32Array(100),char:Array(100).fill("@"),color:Array(100).fill("#94a3b8"),depth:new Float64Array(100).fill(depth)};
}
const ink = (g: CellGrid) => g.char.filter(c => /[\u2801-\u28ff]/u.test(c)).length;
it("retains exact edge adjacency while projected winding and visibility remain frame-local", () => {
  const p = { vertices: roof.map(v => [...v] as Vec3) };
  const topology = createGlyphMapExtrusionTopology([p]);
  const incident = topology.incidentFaces(p.vertices[0]!, p.vertices[1]!);
  expect([...incident]).toEqual([0]);
  expect(topology.incidentFaces([...p.vertices[0]!] as Vec3, [...p.vertices[1]!] as Vec3)).toBe(incident);
  for (const hidden of [false, true, false]) {
    const polygon = p as Polygon; polygon.hidden = hidden;
    const frozen = grid(), actual = createGlyphMapExtrusionSurface(frozen, [polygon], project, eye, topology);
    const expected = reference.createGlyphMapExtrusionSurface(frozen, [polygon], project, eye);
    for (const [col, row] of [[2.25, 3], [3, 3], [6, 4]]) {
      expect(actual.occludes(p.vertices[0]!, p.vertices[1]!)(col!, row!, 1)).toBe(expected.occludes(p.vertices[0]!, p.vertices[1]!)(col!, row!, 1));
    }
    expect(topology.incidentFaces(p.vertices[0]!, p.vertices[1]!)).toBe(incident);
  }
});
it("terrain nearer than a roof hides all outline dots", () => {
  const g = grid(2);
  const frozen = {...g,depth:g.depth.slice()};
  const surface = createGlyphMapExtrusionSurface(frozen,[polygon],project,eye);
  stampGlyphMapExtrusionOutlines(g,[geometry],surface,project,eye,false);
  expect(ink(g)).toBe(0);
  expect(g.char.every(c => c === "@")).toBe(true);
});
it("uses the frozen surface even after earlier ink changes live depths", () => {
  const g = grid();
  const surface = createGlyphMapExtrusionSurface({...g,depth:g.depth.slice()},[polygon],project,eye);
  g.depth.fill(100);
  stampGlyphMapExtrusionOutlines(g,[geometry],surface,project,eye,false);
  expect(ink(g)).toBeGreaterThan(12);
});
it("rejects hidden and back-facing roofs even without terrain", () => {
  for (const p of [{...polygon,hidden:true},{vertices:[...roof].reverse()}]) {
    const g = grid();
    const surface = createGlyphMapExtrusionSurface(g,[p],project,eye);
    stampGlyphMapExtrusionOutlines(g,[{...geometry,polygons:[p]}],surface,project,eye,false);
    expect(ink(g)).toBe(0);
  }
});
it("retains courtyard rings", () => {
  const hole: Vec3[] = [[3.25,3.25,1],[4.75,3.25,1],[4.75,4.75,1],[3.25,4.75,1]];
  // An incident front-facing face for each courtyard edge, as triangulation supplies.
  const faces = hole.map((a,i): Polygon => ({vertices:[a,hole[(i+1)%4]!,roof[(i+1)%4]!]}));
  const g = grid();
  const surface = createGlyphMapExtrusionSurface(g,[polygon,...faces],project,eye);
  stampGlyphMapExtrusionOutlines(g,[{...geometry,roof:[roof,hole],base:[roof,hole],polygons:[polygon,...faces]}],surface,project,eye,false);
  expect(g.char[3*10+4]).toMatch(/[\u2801-\u28ff]/u);
});


it("self surface reconstruction accepts a roof beside a depth discontinuity", () => {
  const g = grid();
  for (let row = 3; row <= 6; row++) {
    for (let col = 3; col <= 6; col++) g.depth[row*10+col] = 1;
    // A different surface owns the next integer sample, beyond this roof.
    g.depth[row*10+7] = 2;
  }
  const frozen = {...g,depth:g.depth.slice()};
  const surface = createGlyphMapExtrusionSurface(frozen,[polygon],project,eye);
  stampGlyphMapExtrusionOutlines(g,[geometry],surface,project,eye,false);
  for (let row = 3; row <= 5; row++) expect(g.char[row*10+6]).toMatch(/[\u2801-\u28ff]/u);
});

it("replays identical frames and invalidates on camera, live/frozen depth, ink, ownership and visibility changes", () => {
  const p = { ...polygon }, gs = [{ ...geometry, polygons: [p] }];
  const topology = createGlyphMapExtrusionTopology([p]);
  let offset = 0, key = 0;
  const shifted = (v: Vec3) => ({ col: v[0] + offset, row: v[1], depth: v[2] });
  const render = (live = grid(), frozen = { ...live, depth: live.depth.slice() }) => {
    const expected = { ...live, char: live.char.slice(), color: live.color.slice(), depth: live.depth.slice() };
    const old = reference.createGlyphMapExtrusionSurface(frozen, [p], shifted, eye);
    reference.stampGlyphMapExtrusionOutlines(expected, gs, old, shifted, eye, false);
    const surface = createGlyphMapExtrusionSurface(frozen, [p], shifted, eye, topology, [key]);
    stampGlyphMapExtrusionOutlines(live, gs, surface, shifted, eye, false);
    expect(live.char).toEqual(expected.char); expect(live.color).toEqual(expected.color); expect(live.depth).toEqual(expected.depth);
    return live;
  };
  const first = render();
  const surface = createGlyphMapExtrusionSurface(grid(), [p], shifted, eye, topology, [key]);
  const replayed = grid();
  expect(surface.replay!(replayed, gs, false)).toBe(true);
  expect(replayed.char).toEqual(first.char); expect(replayed.depth).toEqual(first.depth);
  offset = 2; key++; render();
  render(grid(2));
  render(grid(100), grid()); // Frozen surface is independent of subsequent live ink.
  render(grid(100), grid(2));
  render(grid(100), grid()); render(grid(200), grid());
  const inked = grid(); inked.char.fill(" "); render(); render(inked);
  const colored = grid(); colored.color.fill("#ff0000"); render(); render(colored);
  const owned = grid(); owned.occluded = new Uint8Array(100).fill(1); render(); render(owned);
  render();
  p.hidden = true; render(); p.hidden = false; render();
});

it("keeps eye-plane-straddling bounds and unrelated small occluders identical to packet 11", () => {
  const front: Polygon = { vertices: [[3,3,2], [3,4,2], [4,4,2], [4,3,2]] };
  for (const eyeDepth of [eye, (v: Vec3) => v[0] - 3]) {
    const g = grid(), expected = grid(), polygons = [polygon, front];
    stampGlyphMapExtrusionOutlines(g, [geometry], createGlyphMapExtrusionSurface(grid(), polygons, project, eyeDepth), project, eyeDepth, true);
    reference.stampGlyphMapExtrusionOutlines(expected, [geometry], reference.createGlyphMapExtrusionSurface(grid(), polygons, project, eyeDepth), project, eyeDepth, true);
    expect(g.char).toEqual(expected.char); expect(g.depth).toEqual(expected.depth);
  }
});

it("excludes incident planes independently of reconstructed depth, without excluding unrelated planes", () => {
  const g = grid();
  const own = createGlyphMapExtrusionSurface(g, [polygon], project, eye);
  const depth = 1 - Number.EPSILON * 64;
  expect(own.occludes(roof[0]!, roof[1]!)(2.25, 4, depth)).toBe(false);
  const unrelated: Polygon = { vertices: [[2,3,2], [2,5,2], [3,5,2], [3,3,2]] };
  const covered = createGlyphMapExtrusionSurface(g, [polygon, unrelated], project, eye);
  expect(covered.occludes(roof[0]!, roof[1]!)(2.25, 4, depth)).toBe(true);
});


it("unfilled roofs preserve terrain ink and still depth-test against terrain", () => {
  const unrelated: Polygon = {vertices:[[8,8,1],[8,9,1],[9,9,1],[9,8,1]]};
  for (const noFill of [new Set<Polygon>(), new Set([unrelated])]) for (const depth of [1, 2]) {
    const g = grid(depth);
    const surface = createGlyphMapExtrusionSurface(g, [polygon,unrelated], project, eye, undefined, undefined, noFill);
    expect(surface.owns(3 * 10 + 3, new Set([polygon]))).toBe(false);
    stampGlyphMapExtrusionOutlines(g, [geometry], surface, project, eye, false);
    if (depth === 2) expect(ink(g)).toBe(0);
    else expect(ink(g)).toBeGreaterThan(12);
    expect(g.char[4 * 10 + 4]).toBe("@");
  }
});

it("unfilled faces cannot substitute for sloping terrain in the frozen depth buffer", () => {
  const g = grid();
  for (let row = 0; row < 10; row++) for (let col = 0; col < 10; col++) g.depth[row*10+col] = col - 5.5;
  // At integer (6,4) the roof is nearer; at its edge (6.25,4) terrain is nearer.
  const lowRoof: Vec3[] = roof.map(v => [v[0],v[1],0.6]);
  const p: Polygon = { vertices: lowRoof };
  const unrelated: Polygon = {vertices:[[8,8,1],[8,9,1],[9,9,1],[9,8,1]]};
  for (const filled of [new Set<Polygon>(), new Set([unrelated])]) {
    const surface = createGlyphMapExtrusionSurface(g, [p,unrelated], project, eye, undefined, undefined, filled);
    expect(surface.occludes(lowRoof[2]!, lowRoof[3]!)(6.25,4,0.6)).toBe(true);
  }
});

it("changing which faces are filled invalidates replay", () => {
  const topology = createGlyphMapExtrusionTopology([polygon]);
  const gs = [geometry], g = grid(1);
  const filled = createGlyphMapExtrusionSurface(g, [polygon], project, eye, topology, [0]);
  stampGlyphMapExtrusionOutlines(g, gs, filled, project, eye, false);
  const unfilled = createGlyphMapExtrusionSurface(grid(1), [polygon], project, eye, topology, [0], new Set());
  expect(unfilled.replay!(grid(1), gs, false)).toBe(false);
});

const blankSurface = (g: CellGrid, faces: readonly Polygon[] = [polygon], filled = new Set<Polygon>()) =>
  createGlyphMapExtrusionSurface({...g,depth:g.depth.slice()}, faces, project, eye, undefined, undefined, filled, new Set(faces));

it("blanks rear ink to spaces and null colours, keeps nearer terrain and elevated content, then stamps its own outline", () => {
  const g = grid(0);
  g.char[44] = "R"; // rear road
  g.depth[45] = 2; g.char[45] = "B"; // nearer bridge or terrain
  const surface = blankSurface(g);
  stampGlyphMapExtrusionOutlines(g,[geometry],surface,project,eye,false);
  expect(g.char[44]).toBe(" "); expect(g.color[44]).toBeNull(); expect(g.depth[44]).toBe(1);
  expect(g.char[45]).toBe("B"); expect(g.depth[45]).toBe(2);
  expect(g.char[11]).toBe("@"); expect(ink(g)).toBeGreaterThan(12);
});

it("blanking uses integer face samples, not a hull or the whole face bin", () => {
  const g = grid(0), surface = blankSurface(g);
  surface.blank!(g);
  expect(g.char[22]).toBe("@"); // bbox bin, outside roof at (2,2)
  for (let row = 3; row <= 6; row++) for (let col = 3; col <= 6; col++) expect(g.char[row*10+col]).toBe(" ");
  const triangle: Polygon = {vertices:[[2,2,1],[2,7,1],[7,2,1]]};
  const t = grid(0); blankSurface(t,[triangle]).blank!(t);
  expect(t.char[33]).toBe(" "); expect(t.char[66]).toBe("@");
});

it("blanking preserves courtyards and concave notches", () => {
  const rect = (l:number,t:number,r:number,b:number): Polygon => ({vertices:[[l,t,1],[l,b,1],[r,b,1],[r,t,1]]});
  const courtyard = [rect(2,2,3,7),rect(6,2,7,7),rect(3,2,6,3),rect(3,6,6,7)];
  const g = grid(0); blankSurface(g,courtyard).blank!(g);
  expect(g.char[44]).toBe("@"); expect(g.char[42]).toBe(" ");
  const notch = grid(0); blankSurface(notch,[rect(2,2,3,7),rect(3,6,7,7)]).blank!(notch);
  expect(notch.char[44]).toBe("@"); expect(notch.char[64]).toBe(" ");
});

it("nearest face depth wins independently of building order, including crossing depth planes", () => {
  const a: Polygon = {vertices:[[2,2,0],[2,7,0],[7,7,5],[7,2,5]]};
  const b: Polygon = {vertices:[[2,2,5],[2,7,5],[7,7,0],[7,2,0]]};
  const first = grid(0), second = grid(0);
  blankSurface(first,[a,b]).blank!(first); blankSurface(second,[b,a]).blank!(second);
  expect(first).toEqual(second); expect(first.depth[33]).toBe(4); expect(first.depth[36]).toBe(4);
});

it("blanking rejects hidden, back-facing and eye-behind faces, but covers sub-two-cell faces", () => {
  for (const p of [{...polygon,hidden:true},{vertices:[...roof].reverse()}]) {
    const g = grid(0); blankSurface(g,[p]).blank!(g); expect(g.char.every(c => c === "@")).toBe(true);
  }
  const g = grid(0);
  createGlyphMapExtrusionSurface(g,[polygon],project,()=>-1,undefined,undefined,new Set(),new Set([polygon])).blank!(g);
  expect(g.char.every(c => c === "@")).toBe(true);
  const tiny: Polygon = {vertices:[[3.5,3.5,1],[3.5,4.5,1],[4.5,4.5,1],[4.5,3.5,1]]};
  blankSurface(g,[tiny]).blank!(g); expect(g.char[44]).toBe(" ");
});

it("blanked replay includes spaces, colours and depth, and invalidates on opt-out and ink changes", () => {
  const topology = createGlyphMapExtrusionTopology([polygon]), faces = new Set([polygon]), gs = [geometry];
  const render = (blank?: ReadonlySet<Polygon>) => {
    const g = grid(0);
    const s = createGlyphMapExtrusionSurface({...g,depth:g.depth.slice()},[polygon],project,eye,topology,[0],undefined,blank);
    stampGlyphMapExtrusionOutlines(g,gs,s,project,eye,false); return g;
  };
  const first = render(faces), again = render(faces);
  expect(first).toEqual(again); expect(first.char[44]).toBe(" ");
  expect(render().char[44]).toBe("@");
  const changed = grid(0); changed.depth[44] = 2;
  const surface = createGlyphMapExtrusionSurface({...changed,depth:changed.depth.slice()},[polygon],project,eye,topology,[0],undefined,faces);
  expect(surface.replay!(changed,gs,false)).toBe(false);
});

it("only requested blank faces erase ink; ordinary filled surfaces keep their colour", () => {
  const other: Polygon = {vertices:[[7,2,2],[7,7,2],[9,7,2],[9,2,2]]};
  const g = grid(0);
  const surface = createGlyphMapExtrusionSurface(g,[polygon,other],project,eye,undefined,undefined,new Set([other]),new Set([polygon]));
  surface.blank!(g);
  expect(g.char[44]).toBe(" "); expect(g.char[48]).toBe("@"); expect(g.color[48]).toBe("#94a3b8");
});

it("walks compiled ids without consulting coordinate, edge or polygon identity maps", () => {
  const gs = [geometry], topology = createGlyphMapExtrusionTopology([polygon], gs);
  const vertex = vi.spyOn(topology, "vertexId").mockImplementation(() => { throw Error("frame vertex lookup"); });
  const incident = vi.spyOn(topology, "incidentFaces").mockImplementation(() => { throw Error("frame edge lookup"); });
  try {
    for (let frame = 0; frame < 3; frame++) {
      const g = grid(), shifted = (v: Vec3) => ({ col: v[0] + frame / 8, row: v[1], depth: v[2] });
      const surface = createGlyphMapExtrusionSurface(grid(), [polygon], shifted, eye, topology);
      stampGlyphMapExtrusionOutlines(g, gs, surface, shifted, eye, true);
      expect(ink(g)).toBeGreaterThan(12);
    }
    expect(vertex).not.toHaveBeenCalled(); expect(incident).not.toHaveBeenCalled();
  } finally { vertex.mockRestore(); incident.mockRestore(); }
});

it("indexes only conservative triangle coverage, including sub-cell grazes and signed depth planes", () => {
  const faces: Polygon[] = [
    { vertices: [[-20,-20,1],[-20,120,2],[120,-20,3]] },
    { vertices: [[0.999999,0.999999,4],[8.999999,9.000001,-4],[9.000001,8.999999,8]] },
    { vertices: [[0,0,-8],[0,9,-2],[9,9,-4]] },
    { vertices: [[1,1,1e-30],[1,8,1e-30],[8,1,1e-30]] },
  ];
  const all = new Set(faces), topology = createGlyphMapExtrusionTopology(faces);
  const g = grid(1), actual = createGlyphMapExtrusionSurface(g, faces, project, eye, topology);
  const expected = reference.createGlyphMapExtrusionSurface(g, faces, project, eye);
  const queries = faces.map(p => [actual.occludes(p.vertices[0]!, p.vertices[1]!), expected.occludes(p.vertices[0]!, p.vertices[1]!)]);
  for (let idx = 0; idx < 100; idx++) {
    expect(actual.owns(idx, all)).toBe(expected.owns(idx, all));
    const x = idx % 10, y = Math.floor(idx / 10);
    for (const [a, b] of queries) for (const sub of [0, 1 / 8, 0.5, 1 - Number.EPSILON]) for (const d of [-9, 0, 1, 5]) {
      expect(a!(x + sub, y + sub, d)).toBe(b!(x + sub, y + sub, d));
    }
  }
  const triangle: Polygon = { vertices: [[0,0,1],[0,99,1],[99,0,1]] };
  const large = { ...grid(), cols: 100, rows: 100, depth: new Float64Array(10_000) };
  const compiled = createGlyphMapExtrusionTopology([triangle]);
  createGlyphMapExtrusionSurface(large, [triangle], project, eye, compiled);
  // A fan diagonal must not populate the entire 100×100 bounding box.
  expect(compiled.scratch.offsets[10_000]).toBeLessThan(5_500);
});

it("reuses capacity across output sizes without carrying stale triangles, bins or replay visibility", () => {
  const faces = [{ ...polygon }], gs = [{ ...geometry, polygons: faces }];
  const topology = createGlyphMapExtrusionTopology(faces, gs);
  for (const [size, hidden] of [[16,false],[10,true],[10,false],[8,false],[16,false]] as const) {
    faces[0]!.hidden = hidden;
    const make = () => ({ ...grid(), cols: size, rows: size, char: Array(size * size).fill("@"),
      color: Array(size * size).fill("#94a3b8"), depth: new Float64Array(size * size).fill(-Infinity) });
    const g = make(), expected = make();
    const surface = createGlyphMapExtrusionSurface(make(), faces, project, eye, topology, [size]);
    stampGlyphMapExtrusionOutlines(g, gs, surface, project, eye, false);
    reference.stampGlyphMapExtrusionOutlines(expected, gs, reference.createGlyphMapExtrusionSurface(make(), faces, project, eye), project, eye, false);
    expect(g.char).toEqual(expected.char); expect(g.color).toEqual(expected.color); expect(g.depth).toEqual(expected.depth);
  }
});

it("does not replay stale output when a failed replay has not yet been stamped", () => {
  const topology = createGlyphMapExtrusionTopology([polygon], [geometry]), gs = [geometry];
  const g = grid();
  stampGlyphMapExtrusionOutlines(g, gs, createGlyphMapExtrusionSurface(grid(), [polygon], project, eye, topology, [0]), project, eye, false);
  const changed = createGlyphMapExtrusionSurface(grid(2), [polygon], project, eye, topology, [1]);
  expect(changed.replay!(grid(2), gs, false)).toBe(false);
  const next = createGlyphMapExtrusionSurface(grid(2), [polygon], project, eye, topology, [1]);
  expect(next.replay!(grid(2), gs, false)).toBe(false);
});

it("reuses camera-identical planes before projection and binds fresh frozen depth/ownership", () => {
  const polygons = [{ ...polygon }], gs = [{ ...geometry, polygons }];
  const topology = createGlyphMapExtrusionTopology(polygons, gs), projectSpy = vi.fn(project);
  const first = createGlyphMapExtrusionSurface(grid(), polygons, projectSpy, eye, topology, [0]);
  stampGlyphMapExtrusionOutlines(grid(), gs, first, projectSpy, eye, false);
  projectSpy.mockClear();
  const frozen = grid(100);
  const second = createGlyphMapExtrusionSurface(frozen, polygons, projectSpy, eye, topology, [0]);
  expect(second).toBe(first); expect(projectSpy).not.toHaveBeenCalled();
  const actual = grid(), expected = grid();
  stampGlyphMapExtrusionOutlines(actual, gs, second, projectSpy, eye, false);
  reference.stampGlyphMapExtrusionOutlines(expected, gs, reference.createGlyphMapExtrusionSurface(frozen, polygons, projectSpy, eye), projectSpy, eye, false);
  expect(actual.char).toEqual(expected.char); expect(actual.color).toEqual(expected.color); expect(actual.depth).toEqual(expected.depth);
  const third = createGlyphMapExtrusionSurface(grid(), polygons, projectSpy, eye, topology, [1]);
  expect(third).not.toBe(second);
  polygons[0].hidden = true;
  expect(createGlyphMapExtrusionSurface(grid(), polygons, projectSpy, eye, topology, [1])).not.toBe(third);
});

it("conservative walk bins match uncullled planes for behind, grazing and near-plane-straddling faces", () => {
  const behind = Array.from({ length: 80 }, (_, i) => ({ vertices: roof.map(v => [v[0] + i, v[1], -10] as Vec3) }));
  const hiddenTopology = createGlyphMapExtrusionTopology(behind);
  const eyeSpy = vi.fn((v: Vec3) => v[2]);
  createGlyphMapExtrusionSurface(grid(), behind, project, eyeSpy, hiddenTopology, undefined, undefined, undefined, true);
  expect(eyeSpy.mock.calls.length).toBe(12);
  const pieces = [polygon, ...behind, { vertices: roof.map(v => [v[0] - 6.5, v[1], 1] as Vec3) },
    { vertices: [[0, 0, -1], [0, 5, 1], [5, 5, 1]] as Vec3[] }];
  const gs = [{ ...geometry, polygons: pieces }];
  const a = grid(), b = grid(), depth = (v: Vec3) => v[2];
  const frozen = grid();
  stampGlyphMapExtrusionOutlines(a, gs, createGlyphMapExtrusionSurface(frozen, pieces, project, depth,
    createGlyphMapExtrusionTopology(pieces, gs), undefined, undefined, undefined, true), project, depth, true);
  reference.stampGlyphMapExtrusionOutlines(b, gs, reference.createGlyphMapExtrusionSurface(frozen, pieces, project, depth), project, depth, true);
  expect(a.char).toEqual(b.char); expect(a.color).toEqual(b.color); expect(a.depth).toEqual(b.depth);
});
it("evaluates a triangle whose depth bound underflows, exactly as the ungated compiler does", () => {
  const tiny = Number.MIN_VALUE;
  const a: Polygon = { vertices: [[2.25, 2.25, -tiny], [2.25, 2.26, -tiny], [2.26, 2.25, -tiny]] };
  const incident: Polygon = { vertices: [[2, 2, 1], [2, 3, 1], [3, 2, 1]] };
  const g = grid();
  const actual = createGlyphMapExtrusionSurface(g, [a, incident], project, eye);
  const expected = reference.createGlyphMapExtrusionSurface(g, [a, incident], project, eye);
  const edge = [incident.vertices[0]!, incident.vertices[1]!] as const;
  // The plane's evaluated depth underflows to 0, which is above the query's -MIN.
  expect(expected.occludes(...edge)(2.251, 2.251, -tiny)).toBe(true);
  expect(actual.occludes(...edge)(2.251, 2.251, -tiny)).toBe(true);
});

// ── Prepared sample plans ──────────────────────────────────────────────

/** Heights shift the picture, so a roof's vertical edges are real segments rather than points. */
const slanted = (v: Vec3) => ({ col: v[0] + 0.4 * v[2], row: v[1] + 0.9 * v[2], depth: v[2] });

/** A deterministic scene of overlapping blocks at different heights, so planes occlude one another's edges. */
function blocks(count: number) {
  let seed = 12345;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const polygons: Polygon[] = [], geometries: GlyphMapExtrusionGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const x = 1 + rand() * 30, y = 1 + rand() * 30, w = 3 + rand() * 5, h = 1 + rand() * 6;
    const top: Vec3[] = [[x, y, h], [x, y + w, h], [x + w, y + w, h], [x + w, y, h]];
    const base = top.map(v => [v[0], v[1], 0] as Vec3), p: Polygon = { vertices: top };
    // Walls in both windings, so whichever side the projection shows has its vertical edges visible.
    const walls = top.flatMap((v, k): Polygon[] => {
      const n = (k + 1) % 4, quad = [v, top[n]!, base[n]!, base[k]!];
      return [{ vertices: quad }, { vertices: [...quad].reverse() }];
    });
    polygons.push(p, ...walls);
    geometries.push({ roof: [top], base: [base], roofEdges: [], polygons: [p, ...walls], color: i % 2 ? "#94a3b8" : "#ff8800" });
  }
  return { polygons, geometries };
}
function field(cols: number, rows: number, kind: "empty" | "low" | "rough"): CellGrid {
  const n = cols * rows;
  let seed = 99;
  const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const g: CellGrid = { cols, rows, screenX: new Int32Array(n), screenY: new Int32Array(n), char: Array(n).fill("@"), color: Array(n).fill("#445566"), depth: new Float64Array(n) };
  for (let i = 0; i < n; i++) {
    g.depth[i] = kind === "empty" ? -Infinity : kind === "low" ? 0.5 : rand() < 0.1 ? -Infinity : rand() * 7;
    if (kind === "rough" && rand() < 0.15) { g.char[i] = String.fromCodePoint(0x2800 + ((rand() * 256) | 0)); g.color[i] = rand() < 0.5 ? "#ff8800" : "#94a3b8"; }
  }
  if (kind === "rough") { g.occluded = new Uint8Array(n); for (let i = 0; i < n; i++) g.occluded[i] = rand() < 0.1 ? 1 : 0; }
  return g;
}
const clone = (g: CellGrid): CellGrid => ({ ...g, char: g.char.slice(), color: g.color.slice(), depth: g.depth.slice(), occluded: g.occluded?.slice() });
/** Runs a generator to completion and counts its steps. */
const drain = (steps: Generator<void, void>): number => { let n = 0; while (!steps.next().done) n++; return n; };

/** The plain surface and the surface whose camera-only samples were prepared against a gridless stub, stamped into the same live grid. */
function stampBoth(scene: ReturnType<typeof blocks>, frozen: CellGrid, live: CellGrid, tilted: boolean, prepared?: { geometries?: GlyphMapExtrusionGeometry[]; tilt?: boolean }) {
  const key = ["k"];
  const plain = createGlyphMapExtrusionSurface(frozen, scene.polygons, slanted, eye, createGlyphMapExtrusionTopology(scene.polygons), key);
  const a = clone(live), b = clone(live), expected = clone(live);
  stampGlyphMapExtrusionOutlines(a, scene.geometries, plain, slanted, eye, tilted);
  const topology = createGlyphMapExtrusionTopology(scene.polygons, scene.geometries);
  const stub = { cols: frozen.cols, rows: frozen.rows, char: [], color: [], depth: new Float64Array(0) } as unknown as CellGrid;
  const first = createGlyphMapExtrusionSurface(stub, scene.polygons, slanted, eye, topology, key);
  drain(first.prepareSamples!(scene.geometries, prepared?.tilt ?? tilted));
  expect(first.plan).toBeDefined();
  const surface = createGlyphMapExtrusionSurface(frozen, scene.polygons, slanted, eye, topology, key);
  expect(surface).toBe(first);
  stampGlyphMapExtrusionOutlines(b, prepared?.geometries ?? scene.geometries, surface, slanted, eye, tilted);
  const old = reference.createGlyphMapExtrusionSurface(frozen, scene.polygons, slanted, eye);
  reference.stampGlyphMapExtrusionOutlines(expected, prepared?.geometries ?? scene.geometries, old, slanted, eye, tilted);
  return { a, b, expected };
}

it.each([false, true])("a prepared sample plan stamps the bytes of the unprepared walk and of the reference compiler (tilted %s)", tilted => {
  const scene = blocks(14);
  for (const kind of ["empty", "low", "rough"] as const) {
    const frozen = field(40, 40, kind), live = field(40, 40, kind === "empty" ? "rough" : "rough");
    const { a, b, expected } = stampBoth(scene, frozen, live, tilted);
    expect(b.char).toEqual(a.char); expect(b.color).toEqual(a.color); expect(b.depth).toEqual(a.depth);
    expect(b.char).toEqual(expected.char); expect(b.depth).toEqual(expected.depth);
    // The comparison is not between two blank grids.
    expect(b.char.filter(c => /[⠁-⣿]/u.test(c)).length).toBeGreaterThan(live.char.filter(c => /[⠁-⣿]/u.test(c)).length);
  }
});

it("a prepared sample plan is refused under another tilt or other geometries, and drawn as the plain walk would", () => {
  const scene = blocks(14), frozen = field(40, 40, "low"), live = field(40, 40, "rough");
  // Vertical edges exist only when tilted: a plan made for one answer cannot serve the other.
  for (const tilted of [false, true]) {
    const { a, b } = stampBoth(scene, frozen, live, tilted, { tilt: !tilted });
    expect(b.char).toEqual(a.char); expect(b.color).toEqual(a.color);
  }
  const recoloured = scene.geometries.map(g => ({ ...g, color: "#00ff00" }));
  const { b } = stampBoth(scene, frozen, live, true, { geometries: recoloured });
  const plain = clone(live);
  const topology = createGlyphMapExtrusionTopology(scene.polygons, recoloured);
  stampGlyphMapExtrusionOutlines(plain, recoloured, createGlyphMapExtrusionSurface(frozen, scene.polygons, slanted, eye, topology, ["k"]), slanted, eye, true);
  expect(b.color).toEqual(plain.color);
  expect(b.color).toContain("#00ff00");
});

it("prepares a large outline set in bounded steps and never finishes against a surface that was replaced mid-walk", () => {
  const scene = blocks(60), frozen = field(40, 40, "low");
  const topology = createGlyphMapExtrusionTopology(scene.polygons, scene.geometries);
  const stub = { cols: 40, rows: 40, char: [], color: [], depth: new Float64Array(0) } as unknown as CellGrid;
  const surface = createGlyphMapExtrusionSurface(stub, scene.polygons, slanted, eye, topology, ["a"]);
  expect(drain(surface.prepareSamples!(scene.geometries, true))).toBeGreaterThan(5);
  expect(surface.plan).toBeDefined();

  const interrupted = createGlyphMapExtrusionSurface(stub, scene.polygons, slanted, eye, topology, ["b"]);
  const steps = interrupted.prepareSamples!(scene.geometries, true);
  expect(steps.next().done).toBe(false);
  // Another camera's surface now owns the topology's scratch buffers.
  createGlyphMapExtrusionSurface(frozen, scene.polygons, (v: Vec3) => ({ col: v[0] + 1, row: v[1] + 0.9 * v[2], depth: v[2] }), eye, topology, ["c"]);
  drain(steps);
  expect(interrupted.plan).toBeUndefined();
});
