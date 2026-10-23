import { readFileSync } from "node:fs";
import path from "node:path";
import { glyphMapDecodeMVT } from "./vector/pmtiles";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { GLYPH_FONT_ATLAS, isGlyphInFontAtlas } from "glyphcss";
import { createGlyphMap, type GlyphMapFillExtrusionLayer } from "./widget";
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
async function mount(outline: "braille" | null = "braille", tilt = 50, features = [building()], span = 0.012, density = 1, globeCenter?: [number,number]) {
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
  const layer: GlyphMapFillExtrusionLayer = { type:"fill-extrusion",source:{features},heightProperty:"height",baseOffsetProperty:"base",heightScale:2,color:"#94a3b8",density, ...(outline ? {outline} : {}) };
  map.addLayer(layer);
  await map.idle();
  const logical = () => Array.from(host.querySelectorAll("pre")).map(p => p.textContent ?? "").join("\n");
  const project = (lon: number, lat: number, metres: number) => {
    const world = projection.project(lon,lat,3 + glyphMapTrueScaleElevation(metres,projection));
    return map.scene.camera.project(world,cols,rows,2,{cellWidth:8,cellHeight:16});
  };
  return { map,host,logical,project };
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
