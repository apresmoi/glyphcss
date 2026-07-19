/**
 * Static effect export — bakes an "effect only, static camera" scene into a
 * self-contained pen (one HTML document, no imports, no CDN, no
 * `glyphcss`/`@glyphcss/*` at runtime). Productionizes the strategy proven in
 * `bench/static-effect-export.md` (Strategy B: minimal inlined vanilla-JS):
 * bake the static base grid + each covered cell's resolved effect-domain
 * coordinate ONCE, then ship a tiny hand-written evaluator that recomputes the
 * pattern every `requestAnimationFrame` — smaller and smoother than a
 * prebaked-frame `steps()` export for anything past a handful of frames, and
 * unlike the live runtime, ships zero library code.
 *
 * The bake step reuses glyphcss's real, pure render + effect-input machinery
 * (`buildRasterizeContext`, `rasterize`, `retainGlyphEffectOutput`) and this
 * package's own field-synth coordinate resolution (`fieldSynthCoordinate` +
 * friends, exported from `./stock` for exactly this reuse) — so the baked
 * per-cell coordinates are byte-identical to what a mounted `<GlyphEffectLayer
 * effect={GlyphFieldSynthEffect}>` would read, not a hand-copied
 * approximation. Only the PER-FRAME oscillator math is duplicated as plain JS
 * text, because that is the entire point of the deliverable: a standalone
 * evaluator with no glyphcss import.
 *
 * Scope: field-synth only. Generalizing to another stock effect needs two more
 * things per effect id: (1) that effect's own coordinate resolver exported the
 * same way fieldSynthCoordinate is, and (2) a hand-written inlined JS port of
 * its per-cell math (there is no way to ship an arbitrary GlyphEffectProgram's
 * `evaluate()` without shipping a JS engine's worth of glyphcss around it).
 *
 * Two payload cuts beyond the bench's baseline (see `detectAffineCoords` /
 * `skipBase` in `buildRuntime`): a flat, head-on surface with a linear UV map
 * (e.g. the `/synth` page's default fullscreen plane) makes every cell's
 * domain coordinate an exact affine function of (col,row), so the per-cell
 * coordinate table — the bulk of the payload — is replaced with 6 fitted
 * scalars and a one-line formula; and when the effect covers every cell of
 * the grid with `blend:"replace"` at full opacity, the baked base glyph/color
 * grid is provably never read by the compositor and is skipped too. Curved or
 * projected surfaces (cube, sphere, a tilted plane, …) fail the affine
 * residual check and keep the table, unchanged from before.
 */
import {
  buildRasterizeContext,
  rasterize,
  retainGlyphEffectOutput,
  parseGlyphEffectColor,
  type CellGrid,
  type GlyphAmbientLight,
  type GlyphCamera,
  type GlyphDirectionalLight,
  type GlyphEffectBlend,
  type GlyphEffectCoordinates,
  type GlyphEffectOutputMetadata,
  type GlyphEffectParamsOf,
  type GlyphEffectScratchView,
  type Polygon,
  type RenderMode,
  type RetainedGlyphEffectOutput,
  createGlyphOrthographicCamera,
  createGlyphPerspectiveCamera,
  DEFAULT_PERSPECTIVE,
} from "glyphcss";
import {
  fieldSynth,
  findUvBounds,
  generatedSurfaceField,
  fieldSynthCoordinate,
  defaultGlyphEffectParams,
  SYNTH_VOICES,
  type AnyContext,
  type AnyParams,
  type EffectSpace,
} from "./stock";

export type GlyphFieldSynthStaticExportEffect = "field-synth";

export interface GlyphFieldSynthStaticExportOptions {
  /** Which stock effect to export. Only `"field-synth"` is supported today (see module doc). */
  effect?: GlyphFieldSynthStaticExportEffect;
  /** field-synth params (a partial patch over its own defaults — same shape the live layer takes). `time` is ignored (the export always starts its own clock at 0). */
  params: Partial<GlyphEffectParamsOf<typeof fieldSynth>>;
  /** The blend the layer is ACTUALLY mounted with. Read verbatim — never defaulted from the effect definition's `defaultBlend` metadata, since `over` vs `replace` changes the composited look. */
  blend: GlyphEffectBlend;
  /** Effect layer opacity, matching `GlyphEffectLayerCommonOptions.opacity`. Default 1. */
  opacity?: number;
  /** Seconds before the client-side clock wraps (`time = (now/1000) % loopSeconds`). Longer = smoother-feeling for a slow patch, no payload cost either way (the baked table is time-independent). */
  loopSeconds: number;
  cols: number;
  rows: number;
  mode?: RenderMode;
  cellAspect?: number;
  useColors?: boolean;
  rotX?: number;
  rotY?: number;
  zoom?: number;
  projection?: "orthographic" | "perspective";
  perspectivePx?: number;
  fontSizePx?: number;
  lineHeightPx?: number;
  directionalLight?: GlyphDirectionalLight;
  ambientLight?: GlyphAmbientLight;
  title?: string;
}

export interface GlyphFieldSynthStaticExportResult {
  /** Self-contained `<!doctype html>…</html>` document. */
  html: string;
  css: string;
  js: string;
  /** Split for CodePen prefill (mirrors `GlyphInteractiveExportResult.pen`). */
  pen: { html: string; css: string; js: string };
}

const EMPTY_SCRATCH: GlyphEffectScratchView = {
  images: [],
  floatFields: [],
  uintFields: [],
  glyphFields: [],
  samples: [],
};

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

// Mirrors createGlyphScene's identical bbox→worldToSceneScale computation
// (packages/glyphcss/src/api/createGlyphScene.ts) — plain bounding-box
// arithmetic, not effect math, so a local copy carries none of the
// silent-divergence risk the surface-basis functions would.
function computeWorldToSceneScale(polygons: readonly Polygon[], cols: number, rows: number): number {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const polygon of polygons) {
    for (const vertex of polygon.vertices) {
      if (vertex[0] < minX) minX = vertex[0];
      if (vertex[1] < minY) minY = vertex[1];
      if (vertex[2] < minZ) minZ = vertex[2];
      if (vertex[0] > maxX) maxX = vertex[0];
      if (vertex[1] > maxY) maxY = vertex[1];
      if (vertex[2] > maxZ) maxZ = vertex[2];
    }
  }
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  return Number.isFinite(span) && span > 1e-9 ? Math.min(cols, rows) / span : 1;
}

function buildCamera(options: GlyphFieldSynthStaticExportOptions): GlyphCamera {
  if (options.projection === "perspective") {
    return createGlyphPerspectiveCamera({
      rotX: options.rotX,
      rotY: options.rotY,
      zoom: options.zoom,
      perspective: options.perspectivePx ?? DEFAULT_PERSPECTIVE,
    });
  }
  return createGlyphOrthographicCamera({ rotX: options.rotX, rotY: options.rotY, zoom: options.zoom });
}

interface BakedCell {
  col: number;
  row: number;
  x: number;
  y: number;
  cx: number;
  cy: number;
  shade: number;
  glyph: string;
  /** Packed 24-bit RGB, or `-1` for "no color" (matches the runtime's sentinel). */  color: number;
}

interface Baked {
  cells: BakedCell[];
  cols: number;
  rows: number;
}

// Runs the REAL rasterizer + retains the base frame in the exact shape a
// mounted effect layer's evaluate() reads (GlyphEffectFrameView + coverage),
// then resolves each covered cell's field-synth domain coordinate with the
// package's own (real, tested) fieldSynthCoordinate — not a re-derivation.
function bake(
  polygons: Polygon[],
  options: GlyphFieldSynthStaticExportOptions,
  params: GlyphEffectParamsOf<typeof fieldSynth>,
): Baked {
  const mode: RenderMode = options.mode ?? "solid";
  // AGENTS.md: worldPosition/normal/shade retention is solid-mode-only.
  const retainOptional = mode === "solid";
  const camera = buildCamera(options);
  const worldToSceneScale = retainOptional
    ? computeWorldToSceneScale(polygons, options.cols, options.rows)
    : undefined;

  const metadata: GlyphEffectOutputMetadata = {
    id: "static-export",
    // Never dereferenced: retainGlyphEffectOutput / fieldSynthCoordinate only
    // read the geometry fields below; `.pre` only matters to a real DOM write,
    // which this pure builder never performs.
    pre: null as unknown as HTMLPreElement,
    isBase: true,
    cellToSceneGrid: [1, 0, 0, 1, 0, 0],
    sceneGridSize: [options.cols, options.rows],
    localCellFootprint: [1, 1],
    ...(worldToSceneScale !== undefined ? { worldToSceneScale } : {}),
  };

  let retained: RetainedGlyphEffectOutput | null = null;
  const ctx = buildRasterizeContext({
    camera,
    grid: { cols: options.cols, rows: options.rows, cellAspect: options.cellAspect ?? 2 },
    polygons,
    mode,
    directionalLight: options.directionalLight ?? { direction: [0.5, 0.7, 0.5], intensity: 1 },
    ambientLight: options.ambientLight ?? { intensity: 0.4 },
    useColors: options.useColors ?? true,
    retainShade: retainOptional,
    retainWorldPosition: retainOptional,
    retainNormal: retainOptional,
  });
  ctx.transformCells = (grid: CellGrid) => {
    retained = retainGlyphEffectOutput(grid, metadata);
    return grid;
  };
  rasterize(ctx);
  if (retained === null) throw new Error("glyphcss: static field-synth export — rasterize did not produce a base frame.");
  const baked: RetainedGlyphEffectOutput = retained;

  const coordinates: GlyphEffectCoordinates = {
    cellToSceneGrid: metadata.cellToSceneGrid,
    sceneGridSize: metadata.sceneGridSize,
    localCellFootprint: metadata.localCellFootprint,
    ...(metadata.worldToSceneScale !== undefined ? { worldToSceneScale: metadata.worldToSceneScale } : {}),
  };
  const context: AnyContext<AnyParams> = {
    params: params as unknown as AnyParams,
    state: undefined,
    base: baked.base,
    input: baked.base,
    target: { coverage: baked.baseCoverage },
    coordinates,
    scratch: EMPTY_SCRATCH,
    output: baked.emission,
  };

  const uvBounds = findUvBounds(context);
  const [sceneCols, sceneRows] = coordinates.sceneGridSize;
  const generatedSurface = params.space !== "scene" && !(params.space === "auto" && uvBounds)
    ? generatedSurfaceField(context)
    : undefined;

  const cells: BakedCell[] = [];
  const n = baked.base.length;
  for (let i = 0; i < n; i++) {
    if (baked.baseCoverage[i]! <= 0) continue;
    const coord = fieldSynthCoordinate(
      context,
      i,
      params.space as EffectSpace,
      uvBounds,
      params.scale,
      params.originU,
      params.originV,
      sceneCols,
      sceneRows,
      generatedSurface,
    );
    if (!coord) continue;
    const [x, y, cx, cy] = coord;
    const shadeArr = baked.base.shade;
    const sh = shadeArr ? shadeArr[i]! : Number.NaN;
    const glyph = baked.baseGrid.char[i] ?? " ";
    const colorHex = baked.baseGrid.color[i] ?? null;
    cells.push({
      col: i % sceneCols,
      row: (i / sceneCols) | 0,
      x,
      y,
      cx,
      cy,
      shade: Number.isFinite(sh) ? sh : 1,
      glyph,
      color: colorHex ? parseGlyphEffectColor(colorHex).packed : -1,
    });
  }
  return { cells, cols: options.cols, rows: options.rows };
}

interface AffineCoordFit {
  ax: number; bx: number; ecx: number;
  ay: number; by: number; ecy: number;
}

// A flat, head-on surface with a linear UV map (the /synth page's default
// fullscreen plane, and any other surface whose per-cell domain coordinate
// happens to come out affine) needs no per-cell coordinate table at all: the
// per-cell (x,y) is an exact affine function of grid (col,row), so the
// runtime can recompute it from 6 fitted scalars instead of shipping one
// float pair per cell — the ~86% of the payload the bench in
// bench/static-effect-export.md attributes to that table. Curved or
// perspective-projected surfaces (cube, sphere, a tilted/foreshortened
// plane, …) are NOT globally affine in cell space and must keep the baked
// table; the fit below detects that mechanically rather than assuming it
// from the shape name, so any surface that happens to be affine benefits and
// nothing else is misdetected.
//
// Least-squares fit of (col,row) → x and (col,row) → y shares one 3×3
// normal-equations solve (both regressions have the same design matrix).
// "Affine within epsilon" requires the max PER-CELL residual — not an
// average — to be under AFFINE_EPSILON: an average-error check would accept
// a surface that's affine almost everywhere but curves at the edges, which
// would silently corrupt exactly those cells once the table is dropped.
const AFFINE_EPSILON = 1e-3;

function detectAffineCoords(points: { col: number; row: number; x: number; y: number }[]): AffineCoordFit | null {
  const n = points.length;
  if (n < 3) return null;
  let Scc = 0, Scr = 0, Sc = 0, Srr = 0, Sr = 0;
  let Sxc = 0, Sxr = 0, Sx = 0, Syc = 0, Syr = 0, Sy = 0;
  for (const p of points) {
    Scc += p.col * p.col; Scr += p.col * p.row; Sc += p.col;
    Srr += p.row * p.row; Sr += p.row;
    Sxc += p.col * p.x; Sxr += p.row * p.x; Sx += p.x;
    Syc += p.col * p.y; Syr += p.row * p.y; Sy += p.y;
  }
  const m00 = Scc, m01 = Scr, m02 = Sc;
  const m10 = Scr, m11 = Srr, m12 = Sr;
  const m20 = Sc, m21 = Sr, m22 = n;
  const det =
    m00 * (m11 * m22 - m12 * m21)
    - m01 * (m10 * m22 - m12 * m20)
    + m02 * (m10 * m21 - m11 * m20);
  // Singular normal matrix — e.g. a 1-row/1-col grid, or too few points to
  // pin down 3 unknowns per axis. Keep the table; there's nothing to fit.
  if (Math.abs(det) < 1e-9) return null;
  const solve = (r0: number, r1: number, r2: number): [number, number, number] => {
    const dA =
      r0 * (m11 * m22 - m12 * m21)
      - m01 * (r1 * m22 - m12 * r2)
      + m02 * (r1 * m21 - m11 * r2);
    const dB =
      m00 * (r1 * m22 - m12 * r2)
      - r0 * (m10 * m22 - m12 * m20)
      + m02 * (m10 * r2 - r1 * m20);
    const dC =
      m00 * (m11 * r2 - r1 * m21)
      - m01 * (m10 * r2 - r1 * m20)
      + r0 * (m10 * m21 - m11 * m20);
    return [dA / det, dB / det, dC / det];
  };
  const [ax, bx, ecx] = solve(Sxc, Sxr, Sx);
  const [ay, by, ecy] = solve(Syc, Syr, Sy);
  for (const p of points) {
    const px = ax * p.col + bx * p.row + ecx;
    const py = ay * p.col + by * p.row + ecy;
    if (Math.abs(px - p.x) >= AFFINE_EPSILON || Math.abs(py - p.y) >= AFFINE_EPSILON) return null;
  }
  return { ax, bx, ecx, ay, by, ecy };
}

function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

// Shared vanilla-JS runtime, generalized from the bench's validated
// Strategy B evaluator: N active oscillators (not a fixed set), the general
// blend formula (`over` OR `replace`, with opacity) instead of a
// replace-only shortcut, and optional per-voice color mixing. Reproduces
// `combineSynth`/`synthOsc`/`synthWave`/`synthNoise3`/`lerpPacked`/
// `scalePackedColor` (packages/effects/src/stock.ts) and the compositor's
// blend + Bayer coverage dither (packages/glyphcss/src/render/
// effectCompositor.ts `blendPackedColor`/`coverageThreshold`) as plain JS —
// this text is the one piece that can't be "reused" instead of hand-written,
// since it has to run with zero glyphcss/effects code alongside it.
const RUNTIME_JS = `
"use strict";
var D=typeof DATA<"u"?DATA:0,C=CFG,N=C.full?C.cols*C.rows:D.c.length,ramp=C.ramp,rmax=ramp.length-1,V=C.voices;
var BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
function pmod(a,m){return((a%m)+m)%m}
function clamp01(v){return v<0?0:v>1?1:v}
function wave(k,t){var p=t-Math.floor(t);if(k==="triangle")return 4*Math.abs(p-0.5)-1;if(k==="saw")return 2*p-1;if(k==="square")return p<0.5?1:-1;return Math.sin(t*Math.PI*2)}
function h3(x,y,z){var h=Math.sin(x*127.1+y*311.7+z*74.7)*43758.5453;return h-Math.floor(h)}
function noise3(x,y,z){var xi=Math.floor(x),yi=Math.floor(y),zi=Math.floor(z),xf=x-xi,yf=y-yi,zf=z-zi;
var u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf),w=zf*zf*(3-2*zf);
var a000=h3(xi,yi,zi),a100=h3(xi+1,yi,zi),a010=h3(xi,yi+1,zi),a110=h3(xi+1,yi+1,zi),a001=h3(xi,yi,zi+1),a101=h3(xi+1,yi,zi+1),a011=h3(xi,yi+1,zi+1),a111=h3(xi+1,yi+1,zi+1);
var f0=(a000*(1-u)+a100*u)*(1-v)+(a010*(1-u)+a110*u)*v,f1=(a001*(1-u)+a101*u)*(1-v)+(a011*(1-u)+a111*u)*v;return f0*(1-w)+f1*w}
function osc(o,x,y,cx,cy,t){if(o.field==="noise")return 2*noise3(x*o.freq,y*o.freq,t*o.speed)-1;var raw;
switch(o.field){case"linearX":raw=x;break;case"linearY":raw=y;break;case"diagonal":raw=(x+y)*0.70710678;break;
case"angular":raw=Math.atan2(y-cy,x-cx)/(Math.PI*2);break;case"spiral":raw=Math.hypot(x-cx,y-cy)+Math.atan2(y-cy,x-cx)/(Math.PI*2);break;default:raw=Math.hypot(x-cx,y-cy)}
return wave(o.wave,raw*o.freq-t*o.speed)}
function combine(a,b){switch(C.combine){case"add":return a+b;case"max":return Math.max(a,b);case"min":return Math.min(a,b);case"difference":return Math.abs(a-b);default:return a*b}}
function lerp(a,b,t){var ar=(a>>16)&255,ag=(a>>8)&255,ab=a&255,br=(b>>16)&255,bg=(b>>8)&255,bb=b&255;
return(Math.round(ar+(br-ar)*t)<<16)|(Math.round(ag+(bg-ag)*t)<<8)|Math.round(ab+(bb-ab)*t)}
function shadeColor(p,s){var r=Math.round(((p>>16)&255)*s),g=Math.round(((p>>8)&255)*s),b=Math.round((p&255)*s);return(r<<16)|(g<<8)|b}
function blendColor(input,emitted,iw,ew){var ip=input!==-1,ep=emitted!==-1;
if(ip&&ep){var t=iw+ew;if(t<=0)return emitted;
var r=Math.floor((((input>>16)&255)*iw+((emitted>>16)&255)*ew)/t+0.5),g=Math.floor((((input>>8)&255)*iw+((emitted>>8)&255)*ew)/t+0.5),b=Math.floor(((input&255)*iw+(emitted&255)*ew)/t+0.5);
return(r<<16)|(g<<8)|b}
if(ip!==ep)return ew>=iw?emitted:input;return-1}
function thr(col,rw){var x=col+0.5,y=rw+0.5,mx=Math.floor(4*x),my=Math.floor(4*y);
var coarse=BAYER[pmod(Math.floor(my/4),4)*4+pmod(Math.floor(mx/4),4)],fine=BAYER[pmod(my,4)*4+pmod(mx,4)];return(16*coarse+fine+0.5)/256}
var pre=document.getElementById("g");
var rowBuf=new Array(C.rows);
function frame(now){var t=(now/1000)%C.loop;
for(var i=0;i<C.rows;i++)rowBuf[i]=[];
for(var k=0;k<N;k++){
var col0=C.full?k%C.cols:D.c[k],row0=C.full?(k/C.cols)|0:D.r[k];
var x=C.aff?C.aff[0]*col0+C.aff[1]*row0+C.aff[2]:D.x[k];
var y=C.aff?C.aff[3]*col0+C.aff[4]*row0+C.aff[5]:D.y[k];
var cx=C.cxFixed?C.cx:D.cx[k],cy=C.cyFixed?C.cy:D.cy[k];
var sh=C.shFixed?C.sh:D.sh[k];
var combined=0,active=0,cr=0,cg=0,cbv=0,cw=0,co=0,car=0,cag=0,cabv=0,caw=0,cao=0;
for(var j=0;j<V.length;j++){var o=osc(V[j],x,y,cx,cy,t);
if(active===0)combined=V[j].amp*o;else combined+=V[j].amp*(combine(combined,o)-combined);
active++;
if(C.voiceColors){var w=V[j].amp*Math.abs(o),c=V[j].color,r=(c.p>>16)&255,g=(c.p>>8)&255,b=c.p&255;
cr+=r*w;cg+=g*w;cbv+=b*w;co+=c.o*w;cw+=w;car+=r*V[j].amp;cag+=g*V[j].amp;cabv+=b*V[j].amp;cao+=c.o*V[j].amp;caw+=V[j].amp}}
var value=clamp01(C.bias+C.gain*combined*0.5);
var packed=-1,resolvedOpacity=0;
if(value>0){
if(C.voiceColors&&cw>0){packed=(Math.round(cr/cw)<<16)|(Math.round(cg/cw)<<8)|Math.round(cbv/cw);resolvedOpacity=co/cw}
else if(C.voiceColors&&caw>0){packed=(Math.round(car/caw)<<16)|(Math.round(cag/caw)<<8)|Math.round(cabv/caw);resolvedOpacity=cao/caw}
else{packed=C.gradient>0?lerp(C.cA.p,C.cB.p,clamp01(value*C.gradient)):C.cA.p;resolvedOpacity=C.cA.o}
if(C.lit>0)packed=shadeColor(packed,1-C.lit*(1-clamp01(sh)))}
var emittedCoverage=value>0?clamp01(value*resolvedOpacity):0;
var inputCoverage=C.skipBase?1:D.bg[k]!==" "?1:0;
var emittedWeight=emittedCoverage*C.opacity;
var inputWeight=C.blend==="over"?inputCoverage*(1-emittedWeight):inputCoverage*(1-C.opacity);
var nextCoverage=clamp01(emittedWeight+inputWeight);
var col=col0,rw=row0;
var visible=nextCoverage>=1||(nextCoverage>0&&nextCoverage>thr(col,rw));
if(!visible)continue;
var chooseEmitted=emittedWeight>=inputWeight;
var g=chooseEmitted?ramp[Math.min(rmax,Math.max(0,Math.round(value*rmax)))]:(C.skipBase?" ":D.bg[k]);
var pk=blendColor(C.skipBase?-1:D.bc[k],packed,inputWeight,emittedWeight);
rowBuf[rw].push([col,g,pk])}
if(C.useColors){var html="";
for(var r2=0;r2<C.rows;r2++){var cells=rowBuf[r2];cells.sort(function(a,b){return a[0]-b[0]});
var line="",cur=-1,prevColor=-2,open=false;
for(var ci=0;ci<cells.length;ci++){var cell=cells[ci],cc=cell[0],gg=cell[1],pk2=cell[2];
while(cur<cc-1){if(open){line+="</span>";open=false;prevColor=-2}line+=" ";cur++}
if(pk2!==prevColor){if(open)line+="</span>";line+=pk2===-1?"<span>":"<span style=color:#"+pk2.toString(16).padStart(6,"0")+">";open=true;prevColor=pk2}
line+=gg;cur=cc}
if(open)line+="</span>";html+=line+"\\n"}
pre.innerHTML=html}else{var text="";
for(var r3=0;r3<C.rows;r3++){var cells3=rowBuf[r3];cells3.sort(function(a,b){return a[0]-b[0]});
var line3="",cur3=-1;
for(var ci3=0;ci3<cells3.length;ci3++){var cell3=cells3[ci3],cc3=cell3[0];
while(cur3<cc3-1){line3+=" ";cur3++}
line3+=cell3[1];cur3=cc3}
text+=line3+"\\n"}
pre.textContent=text}
requestAnimationFrame(frame)}
requestAnimationFrame(frame);
`;

function buildRuntime(baked: Baked, params: GlyphEffectParamsOf<typeof fieldSynth>, options: GlyphFieldSynthStaticExportOptions): { js: string; gridCols: number; gridRows: number } {
  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (const c of baked.cells) {
    if (c.col < minCol) minCol = c.col;
    if (c.col > maxCol) maxCol = c.col;
    if (c.row < minRow) minRow = c.row;
    if (c.row > maxRow) maxRow = c.row;
  }
  if (!Number.isFinite(minCol)) { minCol = 0; maxCol = -1; minRow = 0; maxRow = -1; }
  const gridCols = Math.max(0, maxCol - minCol + 1);
  const gridRows = Math.max(0, maxRow - minRow + 1);

  const q = (n: number) => Math.round(n * 1000) / 1000;
  const affine = detectAffineCoords(
    baked.cells.map((c) => ({ col: c.col - minCol, row: c.row - minRow, x: c.x, y: c.y })),
  );
  // Plane-fill: every raster cell in `cols×rows` got baked — no silhouette
  // gaps, the surface fills the whole viewport. `bake()` walks the grid in
  // increasing row-major index order (`i = 0..cols*rows-1`, `col=i%cols,
  // row=(i/cols)|0`) and only skips uncovered cells, so a full bake is
  // guaranteed to still be in that exact row-major order — every (col,row)
  // pair appears exactly once, in scan order. That means the per-cell `c`/`r`
  // index arrays carry zero information beyond the loop counter: the runtime
  // can derive them from `k` and `CFG.cols` instead of reading a table.
  // Sparse bakes (silhouette gaps — e.g. a cube or sphere) keep the table;
  // there's no formula for "which cells are covered".
  const full = baked.cells.length === options.cols * options.rows;
  // Plane-fill case, further restricted: the effect also fully overwrites
  // the pixel (`replace` at opacity 1 means the base contributes EXACTLY
  // zero weight to every composited cell: see `inputWeight` in RUNTIME_JS's
  // `frame()` — `inputCoverage*(1-C.opacity)` is 0 whenever opacity is 1).
  // The baked base glyph/color grid is then provably never read, so it's
  // dropped entirely and the runtime hardcodes "no base" instead. Partial
  // coverage, `over`, or opacity < 1 all mean the base genuinely still shows
  // through — keep baking it.
  const skipBase = full && options.blend === "replace" && clamp01(options.opacity ?? 1) === 1;

  const col: number[] = [], row: number[] = [], X: number[] = [], Y: number[] = [];
  const CXa: number[] = [], CYa: number[] = [], SH: number[] = [], BG: string[] = [], BC: number[] = [];
  // `cx,cy` are per-coplanar-group constants; in the common single-facet /
  // uv-space / scene-space cases they're a SINGLE constant across the whole
  // bake — detected and hoisted to a scalar so the (usually large) per-cell
  // arrays don't repeat it. Multi-facet meshes (several differently-oriented
  // coplanar groups) keep the per-cell arrays; deduping those too by group id
  // is a further, not-yet-implemented win (see module doc / AGENTS.md).
  //
  // Shade gets the same treatment: a single flat, evenly-lit facet (a
  // directional light has no position, so Lambert shade only depends on the
  // facet's normal) produces the exact same shade for every cell — hoist it
  // to a scalar too instead of repeating it once per cell.
  let cxFixed = true, cyFixed = true, shFixed = true;
  const cx0 = baked.cells[0]?.cx ?? 0, cy0 = baked.cells[0]?.cy ?? 0;
  const sh0 = Math.round((baked.cells[0]?.shade ?? 1) * 100) / 100;
  for (const c of baked.cells) {
    if (Math.abs(c.cx - cx0) > 1e-6) cxFixed = false;
    if (Math.abs(c.cy - cy0) > 1e-6) cyFixed = false;
    if (Math.round(c.shade * 100) / 100 !== sh0) shFixed = false;
  }
  for (const c of baked.cells) {
    if (!full) { col.push(c.col - minCol); row.push(c.row - minRow); }
    if (!affine) { X.push(q(c.x)); Y.push(q(c.y)); }
    if (!cxFixed) CXa.push(q(c.cx));
    if (!cyFixed) CYa.push(q(c.cy));
    if (!shFixed) SH.push(Math.round(c.shade * 100) / 100);
    if (!skipBase) { BG.push(c.glyph); BC.push(c.color); }
  }
  const data: Record<string, unknown> = {};
  if (!full) { data.c = col; data.r = row; }
  if (!affine) { data.x = X; data.y = Y; }
  if (!skipBase) { data.bg = BG; data.bc = BC; }
  if (!cxFixed) data.cx = CXa;
  if (!cyFixed) data.cy = CYa;
  if (!shFixed) data.sh = SH;
  const hasData = Object.keys(data).length > 0;

  const voices: { field: string; wave: string; freq: number; speed: number; amp: number; color: { p: number; o: number } }[] = [];
  for (let k = 1; k <= SYNTH_VOICES; k++) {
    const amp = (params as unknown as AnyParams)[`amp${k}`] as number;
    if (!(amp > 0)) continue;
    const parsedColor = parseGlyphEffectColor((params as unknown as AnyParams)[`color${k}`] as string);
    voices.push({
      field: (params as unknown as AnyParams)[`field${k}`] as string,
      wave: (params as unknown as AnyParams)[`wave${k}`] as string,
      freq: (params as unknown as AnyParams)[`freq${k}`] as number,
      speed: (params as unknown as AnyParams)[`speed${k}`] as number,
      amp,
      color: { p: parsedColor.packed, o: parsedColor.opacity },
    });
  }
  const cA = parseGlyphEffectColor(params.color);
  const cB = parseGlyphEffectColor(params.colorB);

  const cfg = {
    rows: gridRows,
    loop: options.loopSeconds,
    combine: params.combine,
    gradient: params.gradient,
    lit: params.lit,
    gain: params.gain,
    bias: params.bias,
    ramp: Array.from(params.glyphs),
    cA: { p: cA.packed, o: cA.opacity },
    cB: { p: cB.packed, o: cB.opacity },
    voiceColors: params.voiceColors,
    voices,
    blend: options.blend,
    opacity: clamp01(options.opacity ?? 1),
    useColors: options.useColors ?? true,
    cxFixed,
    cyFixed,
    cx: cxFixed ? q(cx0) : 0,
    cy: cyFixed ? q(cy0) : 0,
    shFixed,
    sh: shFixed ? sh0 : 0,
    // Full precision here, NOT `q()`: these 6 scalars are multiplied by
    // (col,row) — up to a few hundred — at runtime, so 3-decimal rounding
    // (fine for a per-cell coordinate, where the error stays put) would get
    // amplified by that multiplication into an error many times bigger than
    // AFFINE_EPSILON. Six extra full-precision numbers cost a few dozen
    // bytes; that's irrelevant next to the table this replaces.
    aff: affine ? [affine.ax, affine.bx, affine.ecx, affine.ay, affine.by, affine.ecy] : null,
    skipBase,
    full,
    // Only needed to derive (col,row) from the loop index `k` when `full`
    // drops the `c`/`r` tables — omitted otherwise so a sparse bake doesn't
    // pay for a field it never reads.
    ...(full ? { cols: gridCols } : {}),
  };

  // `hasData`: the affine + skipBase + fixed-cx/cy + fixed-shade + full-grid
  // combo (a flat, head-on, fully-covered plane) leaves nothing for `DATA` to
  // carry — every per-cell field has been hoisted to a `CFG` scalar or is
  // derivable from the loop index. `var DATA=...;` is then omitted entirely
  // rather than emitted as an empty object; RUNTIME_JS's `typeof DATA<"u"`
  // guard handles the identifier not existing (every subsequent `D.foo[k]`
  // read is itself gated by the same `CFG` flag that made `DATA` droppable,
  // so `D` is never dereferenced when it's `0`).
  const js = `${hasData ? `var DATA=${jsonForScript(data)};` : ""}var CFG=${jsonForScript(cfg)};${RUNTIME_JS}`;
  return { js, gridCols, gridRows };
}

/**
 * Bake the current field-synth patch over a static-camera mesh into a
 * self-contained pen: inlined per-cell coordinates + a tiny hand-written
 * vanilla-JS evaluator, animated with `requestAnimationFrame`. Zero imports,
 * zero CDN, zero `glyphcss`/`@glyphcss/*` at runtime.
 */
export function buildGlyphFieldSynthStaticExport(
  polygons: Polygon[],
  options: GlyphFieldSynthStaticExportOptions,
): GlyphFieldSynthStaticExportResult {
  if (options.effect !== undefined && options.effect !== "field-synth") {
    throw new Error(
      `glyphcss: buildGlyphFieldSynthStaticExport only supports the "field-synth" effect (got "${options.effect}"). `
      + "Generalizing to another stock effect needs that effect's own coordinate resolver exported from " + "@glyphcss/effects and a hand-written inlined JS port of its per-cell math — see the module doc.",
    );
  }
  if (!(options.cols > 0) || !(options.rows > 0)) {
    throw new RangeError("glyphcss: buildGlyphFieldSynthStaticExport requires cols/rows > 0.");
  }
  if (!(options.loopSeconds > 0)) {
    throw new RangeError("glyphcss: buildGlyphFieldSynthStaticExport requires loopSeconds > 0.");
  }

  const params = { ...defaultGlyphEffectParams(fieldSynth), ...options.params, time: 0 } as GlyphEffectParamsOf<typeof fieldSynth>;
  fieldSynth.program.validateParams?.(params);

  const baked = bake(polygons, options, params);
  const { js, gridCols, gridRows } = buildRuntime(baked, params, options);

  const fontSizePx = options.fontSizePx ?? 12;
  const lineHeightPx = options.lineHeightPx ?? fontSizePx;
  const css = `html,body{margin:0;height:100%;background:#0b0d10;display:grid;place-items:center}
#g{margin:0;white-space:pre;font-family:ui-monospace,Menlo,monospace;font-size:${fontSizePx}px;line-height:${lineHeightPx}px;color:#ccc;width:${gridCols}ch;height:${gridRows * lineHeightPx}px}`;
  const title = options.title ?? "glyphcss field synth";
  const bodyHtml = `<pre id="g"></pre>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>${bodyHtml}<script>${js}</script></body></html>`;

  return {
    html,
    css,
    js,
    pen: { html: bodyHtml, css, js },
  };
}
