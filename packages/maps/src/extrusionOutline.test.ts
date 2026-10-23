import { expect, it } from "vitest";
import type { CellGrid, Polygon, Vec3 } from "glyphcss";
import { createGlyphMapExtrusionSurface, stampGlyphMapExtrusionOutlines } from "./extrusionOutline";
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
