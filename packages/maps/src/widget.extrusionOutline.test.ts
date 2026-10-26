import { readFileSync } from "node:fs";
import path from "node:path";
import { glyphMapDecodeMVT } from "./vector/pmtiles";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { GLYPH_FONT_ATLAS, isGlyphInFontAtlas } from "glyphcss";
import { createGlyphMap, type GlyphMapFillExtrusionLayer } from "./widget";
import * as extrusionOutline from "./extrusionOutline";
import { glyphMapEquirectangular, glyphMapGlobe, glyphMapTrueScaleElevation } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";

const hosts = new Set<Element>();
const mounted: ReturnType<typeof createGlyphMap>[] = [];
afterEach(() => { mounted.splice(0).forEach(m => m.destroy()); vi.restoreAllMocks(); document.body.innerHTML = ""; hosts.clear(); });
const cols = 80, rows = 40;
function building(x = 0, y = 0, half = 0.001, height = 60): GlyphMapVectorFeature {
  const ring: [number, number][] = [[x-half,y-half],[x+half,y-half],[x+half,y+half],[x-half,y+half],[x-half,y-half]];
  return { geometryType: "polygon", rings: [ring], polygons: [[ring]], properties: { height, base: 20 } };
}
async function mount(outline: "braille" | null = "braille", tilt = 50, features = [building()], span = 0.012, density = 1, globeCenter?: [number,number], fill?: boolean, blank?: boolean) {
  const host = document.createElement("div"); document.body.append(host); hosts.add(host);
  if (!vi.isMockFunction(Element.prototype.getBoundingClientRect)) vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function(this: Element) {
    const font = parseFloat((this as HTMLElement).style.fontSize) || 16;
    const scale = font / 16;
    const probe = this.tagName === "PRE" && /visibility:\s*hidden/.test((this as HTMLElement).style.cssText);
    const visible = hosts.has(this) || this.tagName === "PRE";
    const width = probe ? 8 * scale : visible ? cols * 8 : 0;
    const height = probe ? 16 * scale * ((this.textContent ?? "").split("\n").length) : visible ? rows * 16 : 0;
    return { x:0,y:0,left:0,top:0,right:width,bottom:height,width,height,toJSON:()=>({}) } as DOMRect;
  });
  const projection = globeCenter ? glyphMapGlobe({ exaggeration:24 }) : glyphMapEquirectangular({ exaggeration: 24 });
  const map = createGlyphMap(host, { view: { center:globeCenter ?? [0,0],span,cols,rows }, projection, tilt, groundElevation: () => 3 });
  mounted.push(map);
  const sceneAdd = vi.spyOn(map.scene, "add");
  const layer: GlyphMapFillExtrusionLayer = { type:"fill-extrusion",source:{features},heightProperty:"height",baseOffsetProperty:"base",heightScale:2,color:"#94a3b8",density, ...(outline ? {outline} : {}), ...(fill === undefined ? {} : {fill}), ...(blank === undefined ? {} : {blank}) };
  map.addLayer(layer);
  await map.idle();
  const logical = () => Array.from(host.querySelectorAll("pre")).map(p => p.textContent ?? "").join("\n");
  const project = (lon: number, lat: number, metres: number) => {
    const world = projection.project(lon,lat,3 + glyphMapTrueScaleElevation(metres,projection));
    return map.scene.camera.project(world,cols,rows,2,{cellWidth:8,cellHeight:16});
  };
  return { map,host,logical,project,sceneAdd };
}
const braille = (text: string) => [...text].filter(c => /[\u2801-\u28ff]/u.test(c)).length;

it("places the full roof ring at the planted, scaled roof height, without self-occlusion", async () => {
  const {logical,project} = await mount();
  const lines = logical().split("\n");
  const ring = building().rings[0]!;
  // A non-integer edge makes interpolation across the roof boundary observable.
  for (let i = 0; i < 4; i++) {
    const a = ring[i]!, b = ring[i+1]!;
    const p = project((a[0]+b[0])/2,(a[1]+b[1])/2,120);
    expect(lines[Math.floor(p[1])]![Math.floor(p[0])], `roof edge ${i}`).toMatch(/[\u2801-\u28ff]/u);
  }
  expect(braille(logical())).toBeGreaterThan(20);
  expect(logical()).toContain(".");
  expect(logical()).not.toContain("@");
});

it("adds vertical corners only when tilted, down to the mesh's offset base", async () => {
  const {logical,project} = await mount();
  const p = project(-0.001,-0.001,75);
  expect(logical().split("\n")[Math.floor(p[1])]![Math.floor(p[0])]).toMatch(/[\u2801-\u28ff]/u);
});

it("nearer tall buildings hide rear roof ink, independent of feature order", async () => {
  const rear = building(0,0.0008,0.0007,60);
  const front = building(0,-0.0008,0.0015,250);
  const alone = await mount("braille",60,[rear]);
  const a = await mount("braille",60,[rear,front]);
  const b = await mount("braille",60,[front,rear]);
  expect(a.logical()).toBe(b.logical());
  const p = a.project(0,0.0001,120);
  const at = (s: string) => s.split("\n")[Math.floor(p[1])]![Math.floor(p[0])];
  expect(at(alone.logical())).toMatch(/[\u2801-\u28ff]/u);
  expect(at(a.logical())).not.toMatch(/[\u2801-\u28ff]/u);
});

it("cuts off by projected footprint and responds to zoom", async () => {
  const small = await mount("braille",0,[building(0,0,0.0001)]);
  expect(braille(small.logical())).toBe(0);
  expect(small.logical()).toContain(".");
  small.map.setView({span:0.003}); await small.map.idle();
  expect(braille(small.logical())).toBeGreaterThan(0);
});

it("keeps the opt-out bytes at the pre-feature baseline", async () => {
  const {host,logical} = await mount(null);
  expect(braille(logical())).toBe(0);
  const html = Array.from(host.querySelectorAll("pre")).map(p => p.innerHTML).join("");
  expect(createHash("sha256").update(html).digest("hex")).toBe("9f8c88aad0ae49f5c51817493661217a13b3225db076e091572a927e52932f90");
});

it("keeps every emitted glyph in the universal atlas, including at detail density", async () => {
  const {logical} = await mount("braille",45,[building()],0.012,1.7);
  expect(braille(logical())).toBeGreaterThan(0);
  for (const c of logical().replace(/\n/g,"")) expect(isGlyphInFontAtlas(c,GLYPH_FONT_ATLAS),c).toBe(true);
});


it("draws atlas-compatible boxes over the vendored OSM city tile on the globe", async () => {
  const decoded = glyphMapDecodeMVT(readFileSync(path.resolve(__dirname,"../fixtures/openfreemap/z14-8579-5736.mvt")),14,8579,5736);
  const features = decoded.building!.map(f => ({...f,properties:{...f.properties,height:f.properties?.render_height,base:f.properties?.render_min_height}}));
  const {logical,map} = await mount("braille",40,features,0.006,1,[8.514404296875,47.39091153623038]);
  const before = logical();
  expect(braille(before)).toBeGreaterThan(10);
  expect(before).toContain(".");
  expect(before).not.toContain("@");
  for (const c of before.replace(/\n/g,"")) expect(isGlyphInFontAtlas(c),c).toBe(true);
  map.scene.rerender();
  expect(logical()).toBe(before);
});


it("unfilled buildings mount no mesh and keep their own roof ring and vertical corners", async () => {
  const { map, logical, project, sceneAdd } = await mount("braille",50,[building()],0.012,1,undefined,false);
  expect(sceneAdd).not.toHaveBeenCalled();
  const before = logical();
  expect(braille(before)).toBeGreaterThan(20);
  expect(before).not.toContain(".");
  const lines = before.split("\n");
  const ring = building().rings[0]!;
  for (let i = 0; i < 4; i++) {
    const a = ring[i]!, b = ring[i+1]!;
    const p = project((a[0]+b[0])/2,(a[1]+b[1])/2,120);
    expect(lines[Math.floor(p[1])]![Math.floor(p[0])], `unfilled roof edge ${i}`).toMatch(/[\u2801-\u28ff]/u);
  }
  const p = project(-0.001,-0.001,75);
  expect(lines[Math.floor(p[1])]![Math.floor(p[0])]).toMatch(/[\u2801-\u28ff]/u);
  map.scene.rerender();
  expect(logical()).toBe(before);
  map.setView({center:[0.0002,0]}); await map.idle();
  expect(sceneAdd).not.toHaveBeenCalled();
  expect(braille(logical())).toBeGreaterThan(20);
});

it("nearer unfilled faces hide rear roof rings and vertical corners at tilt, in either feature order", async () => {
  const rear = building(0,0.0008,0.0007,60);
  const front = building(0,-0.0008,0.0015,250);
  const alone = await mount("braille",60,[rear],0.012,1,undefined,false);
  const a = await mount("braille",60,[rear,front],0.012,1,undefined,false);
  const b = await mount("braille",60,[front,rear],0.012,1,undefined,false);
  expect(a.logical()).toBe(b.logical());
  for (const [lon,lat,height] of [[0,0.0001,120],[-0.0007,0.0001,75]]) {
    const p = a.project(lon!,lat!,height!);
    const at = (s: string) => s.split("\n")[Math.floor(p[1])]![Math.floor(p[0])];
    expect(at(alone.logical())).toMatch(/[\u2801-\u28ff]/u);
    expect(at(a.logical())).not.toMatch(/[\u2801-\u28ff]/u);
  }
  expect(a.sceneAdd).not.toHaveBeenCalled();
});

it("fill omitted keeps the filled outline bytes, and false without outlines keeps the original fill", async () => {
  const omitted = await mount();
  const filled = await mount("braille",50,[building()],0.012,1,undefined,true);
  expect(filled.logical()).toBe(omitted.logical());
  const html = Array.from(omitted.host.querySelectorAll("pre")).map(p => p.innerHTML).join("");
  expect(createHash("sha256").update(html).digest("hex")).toBe("9be3f5972bc609e52396ba52139833b865f983f7bcb04e833ff27c249ba0f4a1");
  const plain = await mount(null);
  const ignored = await mount(null,50,[building()],0.012,1,undefined,false);
  expect(ignored.logical()).toBe(plain.logical());
  expect(ignored.sceneAdd).toHaveBeenCalled();
});


it("blank opt-out retains outline-only bytes; blank mode hides ground fill and road ink without a scene mesh", async () => {
  const hollow = await mount("braille",50,[building()],0.012,1,undefined,false);
  const explicit = await mount("braille",50,[building()],0.012,1,undefined,false,false);
  expect(explicit.logical()).toBe(hollow.logical());
  const solid = await mount("braille",50,[building()],0.012,1,undefined,false,true);
  expect(solid.sceneAdd).not.toHaveBeenCalled();
  for (const {map} of [hollow,solid]) {
    map.addLayer({type:"fill",source:{features:[building(0,0,0.01)]},color:"#ffffff"});
    map.addLayer({type:"line",source:{features:[{geometryType:"line",rings:[[[-0.01,0],[0.01,0]]],properties:{}}]},color:"#ff0000",experimentalGlyphStrategy:"braille"});
    await map.idle();
  }
  const p = solid.project(0,0,120), row = Math.floor(p[1]), col = Math.floor(p[0]);
  expect(hollow.logical().split("\n")[row]![col]).not.toBe(" ");
  expect(solid.logical().split("\n")[row]![col]).toBe(" ");
  expect(braille(solid.logical())).toBeGreaterThan(20);
  const before = solid.logical(); solid.map.scene.rerender(); expect(solid.logical()).toBe(before);
});

it("blank is ignored without unfilled braille outlines", async () => {
  for (const outline of [null,"braille"] as const) {
    const before = await mount(outline);
    const after = await mount(outline,50,[building()],0.012,1,undefined,true,true);
    expect(after.logical()).toBe(before.logical());
  }
});

it("blanks ground strokes in their viewport density grid and preserves the roof in the base grid", async () => {
  const {map,logical} = await mount("braille",50,[building()],0.012,1,undefined,false,true);
  map.addLayer({type:"line",density:1.7,source:{features:Array.from({length:9},(_,i) => ({geometryType:"line" as const,rings:[[[-0.01,(i-4)*0.00025],[0.01,(i-4)*0.00025]]],properties:{}}))},color:"#ff0000",experimentalGlyphStrategy:"braille"});
  await map.idle();
  const create = extrusionOutline.createGlyphMapExtrusionSurface;
  let erased = 0, checked = false;
  const hook = map.scene.getOptions().transformCells!;
  // Inspect the frozen input at the factory and compare after the entire hook,
  // so skipping the viewport mask cannot bypass the assertion.
  let target: {char:string[];color:(string|null)[];depth:Float64Array} | undefined;
  vi.spyOn(extrusionOutline,"createGlyphMapExtrusionSurface").mockImplementation((...args) => {
    const surface = create(...args);
    if (args[0].cols > cols) {
      const g = args[0], copy = {...g,char:g.char.slice(),color:g.color.slice(),depth:g.depth.slice()};
      surface.blank!(copy); erased += g.char.filter((c,i) => c !== " " && copy.char[i] === " ").length;
      target = copy;
    }
    return surface;
  });
  try {
    map.scene.setOptions({transformCells:(g,layer) => {
      const result = hook(g,layer) ?? g;
      if (layer?.viewport) {
        expect(result.char).toEqual(target!.char); expect(result.depth).toEqual(target!.depth); checked = true;
      }
      return result;
    }});
    map.scene.rerender();
    expect(checked).toBe(true); expect(erased).toBeGreaterThan(0); expect(braille(logical())).toBeGreaterThan(20);
  } finally { map.scene.setOptions({transformCells:hook}); }
});
