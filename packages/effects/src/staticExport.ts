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
var D=DATA,C=CFG,N=D.c.length,ramp=C.ramp,rmax=ramp.length-1,V=C.voices;
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
var x=D.x[k],y=D.y[k],cx=C.cxFixed?C.cx:D.cx[k],cy=C.cyFixed?C.cy:D.cy[k];
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
if(C.lit>0)packed=shadeColor(packed,1-C.lit*(1-clamp01(D.sh[k])))}
var emittedCoverage=value>0?clamp01(value*resolvedOpacity):0;
var inputCoverage=D.bg[k]!==" "?1:0;
var emittedWeight=emittedCoverage*C.opacity;
var inputWeight=C.blend==="over"?inputCoverage*(1-emittedWeight):inputCoverage*(1-C.opacity);
var nextCoverage=clamp01(emittedWeight+inputWeight);
var col=D.c[k],rw=D.r[k];
var visible=nextCoverage>=1||(nextCoverage>0&&nextCoverage>thr(col,rw));
if(!visible)continue;
var chooseEmitted=emittedWeight>=inputWeight;
var g=chooseEmitted?ramp[Math.min(rmax,Math.max(0,Math.round(value*rmax)))]:D.bg[k];
var pk=blendColor(D.bc[k],packed,inputWeight,emittedWeight);
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
  const col: number[] = [], row: number[] = [], X: number[] = [], Y: number[] = [];
  const CXa: number[] = [], CYa: number[] = [], SH: number[] = [], BG: string[] = [], BC: number[] = [];
  // `cx,cy` are per-coplanar-group constants; in the common single-facet /
  // uv-space / scene-space cases they're a SINGLE constant across the whole
  // bake — detected and hoisted to a scalar so the (usually large) per-cell
  // arrays don't repeat it. Multi-facet meshes (several differently-oriented
  // coplanar groups) keep the per-cell arrays; deduping those too by group id
  // is a further, not-yet-implemented win (see module doc / AGENTS.md).
  let cxFixed = true, cyFixed = true;
  const cx0 = baked.cells[0]?.cx ?? 0, cy0 = baked.cells[0]?.cy ?? 0;
  for (const c of baked.cells) {
    if (Math.abs(c.cx - cx0) > 1e-6) cxFixed = false;
    if (Math.abs(c.cy - cy0) > 1e-6) cyFixed = false;
  }
  for (const c of baked.cells) {
    col.push(c.col - minCol);
    row.push(c.row - minRow);
    X.push(q(c.x));
    Y.push(q(c.y));
    if (!cxFixed) CXa.push(q(c.cx));
    if (!cyFixed) CYa.push(q(c.cy));
    SH.push(Math.round(c.shade * 100) / 100);
    BG.push(c.glyph);
    BC.push(c.color);
  }
  const data: Record<string, unknown> = { c: col, r: row, x: X, y: Y, sh: SH, bg: BG, bc: BC };
  if (!cxFixed) data.cx = CXa;
  if (!cyFixed) data.cy = CYa;

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
  };

  const js = `var DATA=${jsonForScript(data)};var CFG=${jsonForScript(cfg)};${RUNTIME_JS}`;
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
