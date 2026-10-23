import { expect, it } from "vitest";
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
