/**
 * Static effect-export benchmark harness.
 *
 * Scenario: "effect only, static camera" — one mesh, a fixed camera, and the
 * field-synth effect animating its texture over `time`. We prototype two
 * self-contained (CodePen-style) export strategies and measure them.
 *
 *   A — prebaked frames (zero JS): bake N grids at time = i/N * loop, stack
 *       them, cycle with a pure-CSS steps() animation. Mirrors
 *       buildGlyphFramesExport but varies effect time instead of rotY.
 *   B — minimal inlined JS (no libraries): bake the static per-cell effect-domain
 *       coordinate (x,y,cx,cy) + shade + base color, then ship a tiny vanilla-JS
 *       field-synth evaluator that recomputes each cell per rAF frame.
 *
 * The bake path runs the REAL, pure glyphcss render + effect compositor in Node
 * (no browser globals), so A is byte-faithful to the runtime render. B's runtime
 * evaluator is a hand-written faithful port of the field-synth per-cell math; the
 * per-cell domain coordinates it consumes are computed here at build time with a
 * copy of glyphcss's own surface-basis math (build-time only — never shipped).
 */
import type { Polygon } from "@glyphcss/core";
import { spherePolygons } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "glyphcss";
import { buildRasterizeContext } from "glyphcss";
import { rasterize } from "glyphcss";
import { encodeCellGrid } from "glyphcss";
import type { CellGrid } from "../../packages/glyphcss/src/render/cells";
import {
  createRuntimeGlyphEffectLayer,
  prepareRuntimeGlyphEffectLayers,
  retainGlyphEffectOutput,
  composeRetainedGlyphEffectOutput,
  type GlyphEffectOutputMetadata,
  type RetainedGlyphEffectOutput,
} from "../../packages/glyphcss/src/render/effectCompositor";
import { GlyphFieldSynthEffect as fieldSynth } from "@glyphcss/effects";
import { encodeStaticGlyphHtml } from "glyphcss";
import { cropGlyphFrames } from "../../packages/glyphcss/src/api/staticEncode";

// ── Scene / effect configuration (the representative case) ───────────────────
export const COLS = 100;
export const ROWS = 40;
export const CELL_ASPECT = 2.0;
export const LOOP_SECONDS = 4;
export const FONT_PX = 12;
export const LINE_PX = 12; // cell = fontPx wide (1ch) × linePx tall

// Fixed camera (does NOT move) + one mesh.
const ROT_X = 62;
const ROT_Y = 38;
const ZOOM = 110;
const SPHERE_SIZE = 9;
const SPHERE_SUBDIV = 3;

// field-synth params — surface-mapped moiré, periodic over LOOP_SECONDS so the
// steps() loop (Strategy A) is seamless (speed*loop must be integer; no noise
// voice, which is not periodic in its time axis).
export const FIELD_SYNTH_PARAMS = {
  time: 0,
  space: "surface",
  scale: 2.5,
  originU: 0.4,
  originV: 0.6,
  field1: "radial", wave1: "sin", freq1: 12, speed1: 0.5, amp1: 1,
  field2: "radial", wave2: "sin", freq2: 12.6, speed2: -0.5, amp2: 1,
  field3: "linearX", wave3: "sin", freq3: 4, speed3: 0.25, amp3: 0,
  field4: "linearY", wave4: "sin", freq4: 4, speed4: 0.25, amp4: 0,
  field5: "diagonal", wave5: "sin", freq5: 6, speed5: 0.25, amp5: 0,
  field6: "noise", wave6: "sin", freq6: 5, speed6: 0.25, amp6: 0,
  combine: "multiply",
  gain: 1,
  bias: 0.5,
  glyphs: " .·:+*#%@",
  color: "#9ddfff",
  colorB: "#ff4fa3",
  gradient: 0.5,
  lit: 1,
  voiceColors: false,
  color1: "#7df9ff", color2: "#ff4fa3", color3: "#8affc1",
  color4: "#ffcf5a", color5: "#c78bff", color6: "#ff7a45",
} as const;

export function sceneMesh(): Polygon[] {
  return spherePolygons({ center: [0, 0, 0], size: SPHERE_SIZE, subdivisions: SPHERE_SUBDIV, color: "#8fb3d9" });
}

// ── Bake: run the real render + effect compositor once, retain the base grid ─
interface Baked {
  retained: RetainedGlyphEffectOutput;
  layer: ReturnType<typeof createRuntimeGlyphEffectLayer>;
  worldToSceneScale: number;
}

function bake(): Baked {
  const polygons = sceneMesh();
  const camera = createGlyphOrthographicCamera({ rotX: ROT_X, rotY: ROT_Y, zoom: ZOOM });

  // world→scene scale exactly as createGlyphScene computes it for worldPosition.
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of polygons) for (const v of p.vertices) {
    if (v[0] < minX) minX = v[0]; if (v[1] < minY) minY = v[1]; if (v[2] < minZ) minZ = v[2];
    if (v[0] > maxX) maxX = v[0]; if (v[1] > maxY) maxY = v[1]; if (v[2] > maxZ) maxZ = v[2];
  }
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const worldToSceneScale = Number.isFinite(span) && span > 1e-9 ? Math.min(COLS, ROWS) / span : 1;

  const layer = createRuntimeGlyphEffectLayer(
    // blend "replace" = field-synth's own defaultBlend (the definition value is
    // UI metadata, not auto-applied to a layer, so we set it explicitly): the
    // texture fully replaces the surface, coverage = value, dither gates low cells.
    { effect: fieldSynth, params: { ...FIELD_SYNTH_PARAMS }, blend: "replace" },
    0,
    () => {},
    () => {},
  );

  const metadata: GlyphEffectOutputMetadata = {
    id: "base",
    pre: null as unknown as HTMLPreElement,
    isBase: true,
    cellToSceneGrid: [1, 0, 0, 1, 0, 0],
    sceneGridSize: [COLS, ROWS],
    localCellFootprint: [1, 1],
    worldToSceneScale,
  };

  let retained: RetainedGlyphEffectOutput | null = null;
  const ctx = buildRasterizeContext({
    camera,
    grid: { cols: COLS, rows: ROWS, cellAspect: CELL_ASPECT },
    polygons,
    mode: "solid",
    directionalLight: { direction: [0.5, 0.7, 0.5], intensity: 1 },
    ambientLight: { intensity: 0.4 },
    useColors: true,
    retainShade: true,
    retainWorldPosition: true,
    retainNormal: true,
  });
  ctx.transformCells = (grid: CellGrid) => {
    retained = retainGlyphEffectOutput(grid, metadata);
    return grid;
  };
  rasterize(ctx);
  if (!retained) throw new Error("bake: transformCells hook did not run");
  return { retained, layer, worldToSceneScale };
}

// Compose the effect grid at a given time (the real compositor path).
function composeAt(baked: Baked, time: number): CellGrid {
  baked.layer.paramsTarget.time = time;
  const prepared = prepareRuntimeGlyphEffectLayers([baked.layer], [COLS, ROWS]);
  return composeRetainedGlyphEffectOutput(baked.retained, prepared);
}

// ── Strategy A — prebaked frames, zero JS (steps() CSS animation) ────────────
export function buildStrategyA(baked: Baked, frameCount: number): string {
  const inners: string[] = [];
  for (let i = 0; i < frameCount; i++) {
    const t = (i / frameCount) * LOOP_SECONDS;
    const grid = composeAt(baked, t);
    inners.push(encodeCellGrid(grid, true));
  }
  const cropped = cropGlyphFrames(inners);
  const enc = encodeStaticGlyphHtml(cropped.frames.join("\n"), "classes");
  const frameH = cropped.rows * LINE_PX;
  const totalShift = frameCount * frameH;
  const css = `html,body{margin:0;height:100%;background:#0b0d10;display:grid;place-items:center}
.glyph-roll{height:${frameH}px;overflow:hidden}
.glyph-roll .glyph-output{margin:0;white-space:pre;font-family:ui-monospace,Menlo,monospace;font-size:${FONT_PX}px;line-height:${LINE_PX}px;animation:glyph-roll ${LOOP_SECONDS}s steps(${frameCount}) infinite}
@keyframes glyph-roll{from{transform:translateY(0)}to{transform:translateY(-${totalShift}px)}}
${enc.css}`;
  const body = `<div class="glyph-roll">${enc.html}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Strategy A — prebaked frames (N=${frameCount})</title><style>${css}</style></head><body>${body}</body></html>`;
}

// ── Build-time surface-basis math (a copy of glyphcss's own; NEVER shipped) ──
// Used only to resolve the per-cell field-synth domain coordinate at build time
// for Strategy B, so the runtime ships plain numbers, not projection/fitting.
function hash2(a: number, b: number): number {
  let h = Math.imul((a | 0) + 1, -1640531527) ^ Math.imul((b | 0) + 1, -2048144789);
  h ^= h >>> 16;
  return h >>> 0;
}
const GENERATED_SURFACE_PITCH = 4;
interface Basis { u: number; v: number; key: string; }
function surfaceBasis(pos: Float32Array, nor: Float32Array, i: number, worldToSceneScale0: number): Basis | null {
  const o = i * 3;
  const px = pos[o]!, py = pos[o + 1]!, pz = pos[o + 2]!;
  let nx = nor[o]!, ny = nor[o + 1]!, nz = nor[o + 2]!;
  if (![px, py, pz, nx, ny, nz].every(Number.isFinite)) return null;
  const nl = Math.hypot(nx, ny, nz);
  if (nl < 1e-6) return null;
  nx /= nl; ny /= nl; nz /= nl;
  const absX = Math.abs(nx), absY = Math.abs(ny), absZ = Math.abs(nz);
  const dominant = absX >= absY && absX >= absZ ? nx : absY >= absZ ? ny : nz;
  if (dominant < 0) { nx = -nx; ny = -ny; nz = -nz; }
  const authoredScale = worldToSceneScale0;
  const worldToSceneScale = authoredScale !== undefined && Number.isFinite(authoredScale) && authoredScale > 0
    ? authoredScale / GENERATED_SURFACE_PITCH : 1 / GENERATED_SURFACE_PITCH;
  let vx = nz * nx, vy = nz * ny, vz = nz * nz - 1;
  const vl = Math.hypot(vx, vy, vz);
  let verticalCoordinate: number;
  if (vl < 1e-4) {
    let tx = absX < 0.9 ? 1 : 0, ty = absX < 0.9 ? 0 : 1, tz = 0;
    const td = tx * nx + ty * ny + tz * nz;
    tx -= nx * td; ty -= ny * td; tz -= nz * td;
    const tl = Math.hypot(tx, ty, tz);
    tx /= tl; ty /= tl; tz /= tl;
    const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    const planeOffset = px * nx + py * ny + pz * nz;
    const normalHash = hash2(hash2(Math.round(nx * 32767), Math.round(ny * 32767)), Math.round(nz * 32767));
    const orientation = hash2(normalHash, Math.round(planeOffset * 1024));
    const sign = orientation & 2 ? -1 : 1;
    if (orientation & 1) { vx = bx * sign; vy = by * sign; vz = bz * sign; }
    else { vx = tx * sign; vy = ty * sign; vz = tz * sign; }
    verticalCoordinate = px * vx + py * vy + pz * vz;
  } else {
    vx /= vl; vy /= vl; vz /= vl;
    verticalCoordinate = px * vx + py * vy + pz * vz;
  }
  const hx = vy * nz - vz * ny, hy = vz * nx - vx * nz, hz = vx * ny - vy * nx;
  const planeOffset = px * nx + py * ny + pz * nz;
  const u = (px * hx + py * hy + pz * hz) * worldToSceneScale;
  const v = verticalCoordinate * worldToSceneScale;
  const key = `${Math.round(nx * 4096)},${Math.round(ny * 4096)},${Math.round(nz * 4096)},${Math.round(planeOffset * worldToSceneScale * 1024)},${Math.round(hx * 4096)},${Math.round(hy * 4096)},${Math.round(hz * 4096)},${Math.round(vx * 4096)},${Math.round(vy * 4096)},${Math.round(vz * 4096)}`;
  return { u, v, key };
}

interface CellData { col: number; row: number; x: number; y: number; cx: number; cy: number; shade: number; }

function bakeCells(baked: Baked): CellData[] {
  const base = baked.retained.base;
  const pos = base.worldPosition!;
  const nor = base.normal!;
  const shade = base.shade;
  const scale = FIELD_SYNTH_PARAMS.scale;
  const { originU, originV } = FIELD_SYNTH_PARAMS;
  // Group covered cells by surface key; track per-group u/v bounds (field-synth's
  // origin maps into the group's own covered bounds).
  interface Group { minU: number; maxU: number; minV: number; maxV: number; }
  const groups = new Map<string, Group>();
  const perCell: { col: number; row: number; u: number; v: number; key: string; sh: number }[] = [];
  for (let i = 0; i < base.length; i++) {
    if (baked.retained.baseCoverage[i]! <= 0) continue;
    const b = surfaceBasis(pos, nor, i, baked.worldToSceneScale);
    if (!b) continue;
    let g = groups.get(b.key);
    if (!g) { g = { minU: Infinity, maxU: -Infinity, minV: Infinity, maxV: -Infinity }; groups.set(b.key, g); }
    if (b.u < g.minU) g.minU = b.u; if (b.u > g.maxU) g.maxU = b.u;
    if (b.v < g.minV) g.minV = b.v; if (b.v > g.maxV) g.maxV = b.v;
    const sh = shade ? shade[i]! : NaN;
    perCell.push({ col: i % COLS, row: (i / COLS) | 0, u: b.u, v: b.v, key: b.key, sh: Number.isFinite(sh) ? sh : 1 });
  }
  const out: CellData[] = [];
  for (const c of perCell) {
    const g = groups.get(c.key)!;
    const cx = (g.minU + originU * (g.maxU - g.minU)) * scale;
    const cy = (g.minV + originV * (g.maxV - g.minV)) * scale;
    out.push({ col: c.col, row: c.row, x: c.u * scale, y: c.v * scale, cx, cy, shade: c.sh });
  }
  return out;
}

// ── Strategy B — minimal inlined vanilla-JS field-synth (zero dependencies) ──
export function buildStrategyB(baked: Baked): string {
  const cells = bakeCells(baked);
  // Determine crop origin so the block sits like Strategy A (tight box).
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (const c of cells) {
    if (c.col < minCol) minCol = c.col; if (c.col > maxCol) maxCol = c.col;
    if (c.row < minRow) minRow = c.row; if (c.row > maxRow) maxRow = c.row;
  }
  const gridCols = maxCol - minCol + 1;
  const gridRows = maxRow - minRow + 1;

  // Flat typed arrays keep the baked payload compact. Quantize coords to a fixed
  // decimal to shrink the JSON without visible drift.
  const q = (n: number) => Math.round(n * 1000) / 1000;
  const col: number[] = [], row: number[] = [], X: number[] = [], Y: number[] = [], CX: number[] = [], CY: number[] = [], SH: number[] = [];
  for (const c of cells) {
    col.push(c.col - minCol); row.push(c.row - minRow);
    X.push(q(c.x)); Y.push(q(c.y)); CX.push(q(c.cx)); CY.push(q(c.cy));
    SH.push(Math.round(c.shade * 100) / 100);
  }
  const data = { c: col, r: row, x: X, y: Y, cx: CX, cy: CY, sh: SH };

  // Active voices only (amp>0) — the baked param set is fixed.
  const P = FIELD_SYNTH_PARAMS;
  const voices = [
    { field: P.field1, wave: P.wave1, freq: P.freq1, speed: P.speed1, amp: P.amp1 },
    { field: P.field2, wave: P.wave2, freq: P.freq2, speed: P.speed2, amp: P.amp2 },
    { field: P.field3, wave: P.wave3, freq: P.freq3, speed: P.speed3, amp: P.amp3 },
    { field: P.field4, wave: P.wave4, freq: P.freq4, speed: P.speed4, amp: P.amp4 },
    { field: P.field5, wave: P.wave5, freq: P.freq5, speed: P.speed5, amp: P.amp5 },
    { field: P.field6, wave: P.wave6, freq: P.freq6, speed: P.speed6, amp: P.amp6 },
  ].filter((v) => v.amp > 0);

  const hex = (h: string) => parseInt(h.slice(1), 16);
  const cfg = {
    cols: gridCols, rows: gridRows,
    loop: LOOP_SECONDS,
    scale: P.scale, gain: P.gain, bias: P.bias,
    combine: P.combine, gradient: P.gradient, lit: P.lit,
    ramp: P.glyphs,
    cA: hex(P.color), cB: hex(P.colorB),
    voices,
  };

  const runtime = `
"use strict";
const D=DATA,C=CFG,N=D.c.length,ramp=C.ramp,rmax=ramp.length-1,V=C.voices;
const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
function pmod(a,m){return((a%m)+m)%m}
function wave(k,t){const p=t-Math.floor(t);if(k==="triangle")return 4*Math.abs(p-0.5)-1;if(k==="saw")return 2*p-1;if(k==="square")return p<0.5?1:-1;return Math.sin(t*Math.PI*2)}
function h3(x,y,z){const h=Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453;return h-Math.floor(h)}
function noise3(x,y,z){const xi=Math.floor(x),yi=Math.floor(y),zi=Math.floor(z),xf=x-xi,yf=y-yi,zf=z-zi;
const u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf),w=zf*zf*(3-2*zf);
const a000=h3(xi,yi,zi),a100=h3(xi+1,yi,zi),a010=h3(xi,yi+1,zi),a110=h3(xi+1,yi+1,zi),a001=h3(xi,yi,zi+1),a101=h3(xi+1,yi,zi+1),a011=h3(xi,yi+1,zi+1),a111=h3(xi+1,yi+1,zi+1);
const f0=(a000*(1-u)+a100*u)*(1-v)+(a010*(1-u)+a110*u)*v,f1=(a001*(1-u)+a101*u)*(1-v)+(a011*(1-u)+a111*u)*v;return f0*(1-w)+f1*w}
function osc(o,x,y,cx,cy,t){if(o.field==="noise")return 2*noise3(x*o.freq,y*o.freq,t*o.speed)-1;let raw;
switch(o.field){case"linearX":raw=x;break;case"linearY":raw=y;break;case"diagonal":raw=(x+y)*0.70710678;break;
case"angular":raw=Math.atan2(y-cy,x-cx)/(Math.PI*2);break;case"spiral":raw=Math.hypot(x-cx,y-cy)+Math.atan2(y-cy,x-cx)/(Math.PI*2);break;default:raw=Math.hypot(x-cx,y-cy)}
return wave(o.wave,raw*o.freq-t*o.speed)}
function combine(a,b){switch(C.combine){case"add":return a+b;case"max":return Math.max(a,b);case"min":return Math.min(a,b);case"difference":return Math.abs(a-b);default:return a*b}}
function clamp01(v){return v<0?0:v>1?1:v}
function lerp(a,b,t){const ar=(a>>16)&255,ag=(a>>8)&255,ab=a&255,br=(b>>16)&255,bg=(b>>8)&255,bb=b&255;
return(Math.round(ar+(br-ar)*t)<<16)|(Math.round(ag+(bg-ag)*t)<<8)|Math.round(ab+(bb-ab)*t)}
function shade(p,s){const r=Math.round(((p>>16)&255)*s),g=Math.round(((p>>8)&255)*s),b=Math.round((p&255)*s);return(r<<16)|(g<<8)|b}
function thr(col,rw){const x=col+0.5,y=rw+0.5,mx=Math.floor(4*x),my=Math.floor(4*y);
const coarse=BAYER[pmod(Math.floor(my/4),4)*4+pmod(Math.floor(mx/4),4)],fine=BAYER[pmod(my,4)*4+pmod(mx,4)];return(16*coarse+fine+0.5)/256}
const pre=document.getElementById("g");
const rowBuf=new Array(C.rows);for(let i=0;i<C.rows;i++)rowBuf[i]="";
const glyphOf=new Array(N),colorOf=new Array(N);
function frame(now){const t=(now/1000)%C.loop;
for(let i=0;i<C.rows;i++)rowBuf[i]=[];
for(let k=0;k<N;k++){const x=D.x[k],y=D.y[k],cx=D.cx[k],cy=D.cy[k];
let combined=0,active=0;
for(let j=0;j<V.length;j++){const o=osc(V[j],x,y,cx,cy,t);if(active===0)combined=V[j].amp*o;else combined+=V[j].amp*(combine(combined,o)-combined);active++}
const value=clamp01(C.bias+C.gain*combined*0.5);
const col=D.c[k],rw=D.r[k];
if(value<=0){continue}
const cov=value;// opacity 1 for #rrggbb color
if(!(cov>=1||cov>thr(col,rw))){continue}
let packed=C.gradient>0?lerp(C.cA,C.cB,clamp01(value*C.gradient)):C.cA;
if(C.lit>0){packed=shade(packed,1-C.lit*(1-clamp01(D.sh[k])))}
const g=ramp[Math.min(rmax,Math.max(0,Math.round(value*rmax)))];
rowBuf[rw].push([col,g,packed])}
let html="";
for(let r=0;r<C.rows;r++){const cells=rowBuf[r];cells.sort((a,b)=>a[0]-b[0]);
let line="",cur=-1,prevColor=-1,open=false;
for(const cell of cells){const[cc,g,pk]=cell;while(cur<cc-1){if(open){line+="</span>";open=false;prevColor=-1}line+=" ";cur++}
if(pk!==prevColor){if(open)line+="</span>";line+="<span style=color:#"+pk.toString(16).padStart(6,"0")+">";open=true;prevColor=pk}
line+=g;cur=cc}
if(open)line+="</span>";html+=line+"\\n"}
pre.innerHTML=html;requestAnimationFrame(frame)}
requestAnimationFrame(frame);
`;

  const css = `html,body{margin:0;height:100%;background:#0b0d10;display:grid;place-items:center}
#g{margin:0;white-space:pre;font-family:ui-monospace,Menlo,monospace;font-size:${FONT_PX}px;line-height:${LINE_PX}px;color:#888}`;
  const js = `const DATA=${JSON.stringify(data)};const CFG=${JSON.stringify(cfg)};${runtime}`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Strategy B — inlined vanilla-JS field-synth</title><style>${css}</style></head><body><pre id="g"></pre><script>${js}</script></body></html>`;
}

export function makeBaked() {
  return bake();
}

// ── Node mirror of Strategy B's shipped evaluator (for cross-check only) ─────
// Reproduces the exact per-cell math the inlined runtime performs, over the FULL
// grid (index = row*COLS+col), so it can be diffed against the compositor grid.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function pmod(a: number, m: number): number { return ((a % m) + m) % m; }
function bwave(k: string, t: number): number {
  const p = t - Math.floor(t);
  if (k === "triangle") return 4 * Math.abs(p - 0.5) - 1;
  if (k === "saw") return 2 * p - 1;
  if (k === "square") return p < 0.5 ? 1 : -1;
  return Math.sin(t * Math.PI * 2);
}
function bh3(x: number, y: number, z: number): number { const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return h - Math.floor(h); }
function bnoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const a000 = bh3(xi, yi, zi), a100 = bh3(xi + 1, yi, zi), a010 = bh3(xi, yi + 1, zi), a110 = bh3(xi + 1, yi + 1, zi);
  const a001 = bh3(xi, yi, zi + 1), a101 = bh3(xi + 1, yi, zi + 1), a011 = bh3(xi, yi + 1, zi + 1), a111 = bh3(xi + 1, yi + 1, zi + 1);
  const f0 = (a000 * (1 - u) + a100 * u) * (1 - v) + (a010 * (1 - u) + a110 * u) * v;
  const f1 = (a001 * (1 - u) + a101 * u) * (1 - v) + (a011 * (1 - u) + a111 * u) * v;
  return f0 * (1 - w) + f1 * w;
}
function bosc(o: { field: string; wave: string; freq: number; speed: number }, x: number, y: number, cx: number, cy: number, t: number): number {
  if (o.field === "noise") return 2 * bnoise3(x * o.freq, y * o.freq, t * o.speed) - 1;
  let raw: number;
  switch (o.field) {
    case "linearX": raw = x; break;
    case "linearY": raw = y; break;
    case "diagonal": raw = (x + y) * 0.70710678; break;
    case "angular": raw = Math.atan2(y - cy, x - cx) / (Math.PI * 2); break;
    case "spiral": raw = Math.hypot(x - cx, y - cy) + Math.atan2(y - cy, x - cx) / (Math.PI * 2); break;
    default: raw = Math.hypot(x - cx, y - cy);
  }
  return bwave(o.wave, raw * o.freq - t * o.speed);
}
function bcombine(mode: string, a: number, b: number): number {
  switch (mode) { case "add": return a + b; case "max": return Math.max(a, b); case "min": return Math.min(a, b); case "difference": return Math.abs(a - b); default: return a * b; }
}
function bthr(col: number, rw: number): number {
  const x = col + 0.5, y = rw + 0.5, mx = Math.floor(4 * x), my = Math.floor(4 * y);
  const coarse = BAYER[pmod(Math.floor(my / 4), 4) * 4 + pmod(Math.floor(mx / 4), 4)]!;
  const fine = BAYER[pmod(my, 4) * 4 + pmod(mx, 4)]!;
  return (16 * coarse + fine + 0.5) / 256;
}

export function evalStrategyBGrid(baked: Baked, time: number): string[] {
  const cells = bakeCells(baked);
  const P = FIELD_SYNTH_PARAMS;
  const voices = [
    { field: P.field1, wave: P.wave1, freq: P.freq1, speed: P.speed1, amp: P.amp1 },
    { field: P.field2, wave: P.wave2, freq: P.freq2, speed: P.speed2, amp: P.amp2 },
    { field: P.field3, wave: P.wave3, freq: P.freq3, speed: P.speed3, amp: P.amp3 },
    { field: P.field4, wave: P.wave4, freq: P.freq4, speed: P.speed4, amp: P.amp4 },
    { field: P.field5, wave: P.wave5, freq: P.freq5, speed: P.speed5, amp: P.amp5 },
    { field: P.field6, wave: P.wave6, freq: P.freq6, speed: P.speed6, amp: P.amp6 },
  ].filter((v) => v.amp > 0);
  const ramp = Array.from(P.glyphs);
  const rmax = ramp.length - 1;
  const out = new Array<string>(COLS * ROWS).fill(" ");
  const q = (n: number) => Math.round(n * 1000) / 1000; // match baked quantization
  for (const c of cells) {
    const x = q(c.x), y = q(c.y), cx = q(c.cx), cy = q(c.cy);
    let combined = 0, active = 0;
    for (const v of voices) {
      const o = bosc(v, x, y, cx, cy, time);
      if (active === 0) combined = v.amp * o; else combined += v.amp * (bcombine(P.combine, combined, o) - combined);
      active++;
    }
    const value = Math.min(1, Math.max(0, P.bias + P.gain * combined * 0.5));
    if (value <= 0) continue;
    const cov = value;
    if (!(cov >= 1 || cov > bthr(c.col, c.row))) continue;
    out[c.row * COLS + c.col] = ramp[Math.min(rmax, Math.max(0, Math.round(value * rmax)))]!;
  }
  return out;
}
