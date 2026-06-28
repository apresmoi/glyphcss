// Per-mesh density perf bench: full-screen layers vs fitted+translated vs
// occlusion, scaling object count — through the LOCAL library source.
// Served at /bench/lod.html.
import { createGlyphScene, createGlyphOrthographicCamera, resolveGeometry } from "../packages/glyphcss/src/index";
import type { Polygon, Vec3, GlyphGeometryName, GlyphOrthographicCamera } from "../packages/glyphcss/src/index";

const stage = document.getElementById("stage") as HTMLElement;
const hud = document.getElementById("hud") as HTMLElement;
const loadingEl = document.getElementById("loading") as HTMLElement;
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;

const lighting = {
  directionalLight: { direction: [-0.5, -0.7, -0.5] as Vec3, intensity: 1.1 },
  ambientLight: { intensity: 0.45 },
};
const PRIMS = ["icosahedron", "dodecahedron", "octahedron", "cuboctahedron", "cube", "truncatedIcosahedron"];
const PAD = 3;

// Monospace cell metrics, measured ONCE (ratio of cell px to font-size). autoSize is
// off everywhere — we own cols/rows so fitted small grids can't be clobbered.
let RW = 0.6, RH = 1.2, CA = 2;

function makeMesh(name: string, span: number, offset: Vec3): { centered: Polygon[]; offset: Polygon[] } {
  const polys = resolveGeometry(name as GlyphGeometryName, { size: 1 });
  let mn: Vec3 = [Infinity, Infinity, Infinity], mx: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of polys) for (const v of p.vertices) for (let i = 0; i < 3; i++) {
    if (v[i] < mn[i]) mn[i] = v[i]; if (v[i] > mx[i]) mx[i] = v[i];
  }
  const c = [(mn[0]+mx[0])/2, (mn[1]+mx[1])/2, (mn[2]+mx[2])/2];
  const s = span / (Math.max(mx[0]-mn[0], mx[1]-mn[1], mx[2]-mn[2]) || 1);
  const centered = polys.map((p) => ({ ...p, vertices: p.vertices.map(([x,y,z]) =>
    [ (x-c[0])*s, (y-c[1])*s, (z-c[2])*s ] as Vec3) }));
  const offs = centered.map((p) => ({ ...p, vertices: p.vertices.map(([x,y,z]) =>
    [ x+offset[0], y+offset[1], z+offset[2] ] as Vec3) }));
  return { centered, offset: offs };
}

interface Layer {
  name: string; density: number; centroid: Vec3;
  centered: Polygon[]; offset: Polygon[];
  host: HTMLElement; wrap: HTMLElement | null; pre: HTMLElement | null;
  scene: ReturnType<typeof createGlyphScene>; cam: GlyphOrthographicCamera; handle: { dispose(): void } | null;
  cw: number; ch: number; ox: number; oy: number; cols: number; rows: number; // last render
}
let layers: Layer[] = [];
const refCam = createGlyphOrthographicCamera({ rotX: 62, rotY: 30, zoom: 1 });
const modeFitted = () => $("mode").value === "fitted";

function buildLayers(n: number): void {
  for (const L of layers) { L.handle?.dispose(); L.scene.destroy(); L.host.remove(); }
  layers = [];
  const maxd = parseInt($("maxd").value, 10), side = Math.ceil(Math.sqrt(n)), spacing = parseFloat($("space").value);
  for (let i = 0; i < n; i++) {
    const gx = (i % side) - (side - 1) / 2, gz = Math.floor(i / side) - (side - 1) / 2;
    const offset: Vec3 = [gx * spacing, 0, gz * spacing];
    const host = document.createElement("div");
    host.className = "layer";
    host.style.cssText = "position:absolute;inset:0;overflow:hidden;pointer-events:none";
    stage.insertBefore(host, hud);
    const cam = createGlyphOrthographicCamera({ rotX: 62, rotY: 30, zoom: 1 });
    const scene = createGlyphScene(host, { camera: cam, autoSize: false, cols: 8, rows: 8,
      mode: "solid", useColors: false, glyphPalette: "default", ...lighting });
    const { centered, offset: offs } = makeMesh(PRIMS[i % PRIMS.length], 1.6, offset);
    const handle = scene.add(modeFitted() ? centered : offs);
    layers.push({ name: PRIMS[i % PRIMS.length], density: 1 + (i % maxd), centroid: offset,
      centered, offset: offs, host, wrap: null, pre: null, scene, cam, handle,
      cw: 0, ch: 0, ox: 0, oy: 0, cols: 0, rows: 0 });
  }
}

function measureRatios(): void {
  const L = layers[0]; if (!L) return;
  const F = 24;
  L.host.style.fontSize = `${F}px`;
  L.scene.setOptions({ cols: 24, rows: 24, cellAspect: 2 });
  L.scene.rerender();
  const pre = L.host.querySelector("pre.glyph-output") as HTMLElement | null;
  if (!pre) return;
  const r = pre.getBoundingClientRect();
  RW = (r.width / 24) / F; RH = (r.height / 24) / F; CA = RH / RW;
  L.pre = pre; L.wrap = pre.parentElement;
}

let baseZoom = 1;
function fitAll(cell: number): void {
  const cw = RW * cell, ch = RH * cell; // density-1 cell px
  const cols = Math.max(20, Math.floor(stage.clientWidth / cw)), rows = Math.max(8, Math.floor(stage.clientHeight / ch));
  refCam.zoom = 1; refCam.rotX = parseFloat($("rotx").value); refCam.rotY = parseFloat($("roty").value);
  let minc = Infinity, maxc = -Infinity, minr = Infinity, maxr = -Infinity;
  for (const L of layers) for (const p of L.offset) for (const v of p.vertices) {
    const pr = refCam.project(v, cols, rows, CA);
    if (!isFinite(pr[0]) || !isFinite(pr[1])) continue;
    if (pr[0] < minc) minc = pr[0]; if (pr[0] > maxc) maxc = pr[0];
    if (pr[1] < minr) minr = pr[1]; if (pr[1] > maxr) maxr = pr[1];
  }
  const w = maxc - minc, h = maxr - minr;
  baseZoom = (w > 0 && h > 0) ? Math.min((0.9 * cols) / w, (0.9 * rows) / h) : 1;
}

function extentCells(L: Layer): { w: number; h: number } {
  const REF = 4000;
  let minc = Infinity, maxc = -Infinity, minr = Infinity, maxr = -Infinity;
  for (const p of L.centered) for (const v of p.vertices) {
    const pr = L.cam.project(v, REF, REF, CA);
    if (!isFinite(pr[0]) || !isFinite(pr[1])) continue;
    if (pr[0] < minc) minc = pr[0]; if (pr[0] > maxc) maxc = pr[0];
    if (pr[1] < minr) minr = pr[1]; if (pr[1] > maxr) maxr = pr[1];
  }
  return { w: maxc - minc, h: maxr - minr };
}

function orderByDepth(): void {
  const d = layers.map((L) => ({ L, z: L.cam.project(L.centroid, 100, 100, CA)[2] || 0 }));
  d.sort((a, b) => a.z - b.z);
  d.forEach(({ L }, i) => { L.host.style.zIndex = String(i + 1); });
}

// Camera-depth occlusion: rasterise all objects' depth into one shared low-res
// buffer (nearest object id per cell), then blank any layer cell where a different
// object is nearer. No grids merged — layers read one shared buffer.
function fillTri(p0: number[], p1: number[], p2: number[], id: number,
                 depth: Float64Array, idMap: Int32Array, W: number, H: number): number {
  const [x0,y0,z0]=p0, [x1,y1,z1]=p1, [x2,y2,z2]=p2;
  if (![x0,y0,x1,y1,x2,y2].every(Number.isFinite)) return 0;
  const minX=Math.max(0,Math.floor(Math.min(x0,x1,x2))), maxX=Math.min(W-1,Math.ceil(Math.max(x0,x1,x2)));
  const minY=Math.max(0,Math.floor(Math.min(y0,y1,y2))), maxY=Math.min(H-1,Math.ceil(Math.max(y0,y1,y2)));
  const area=(x1-x0)*(y2-y0)-(x2-x0)*(y1-y0);
  if (Math.abs(area)<1e-9) return 0;
  const inv=1/area; let n=0;
  for (let y=minY;y<=maxY;y++) for (let x=minX;x<=maxX;x++) {
    const px=x+0.5, py=y+0.5;
    const w0=((x1-px)*(y2-py)-(x2-px)*(y1-py))*inv;
    const w1=((x2-px)*(y0-py)-(x0-px)*(y2-py))*inv;
    const w2=1-w0-w1;
    if (w0<-1e-6||w1<-1e-6||w2<-1e-6) continue;
    const z=w0*z0+w1*z1+w2*z2, idx=y*W+x;
    if (z>depth[idx]) { depth[idx]=z; idMap[idx]=id; n++; }
  }
  return n;
}

function applyOcclusion(): number {
  const stageW=stage.clientWidth, stageH=stage.clientHeight, cell=parseInt($("cell").value,10);
  const refCellW=RW*cell, refCellH=RH*cell;       // density-1 grid = scene's screen scale
  const refCols=Math.max(1,Math.ceil(stageW/refCellW)), refRows=Math.max(1,Math.ceil(stageH/refCellH));
  refCam.zoom=baseZoom; refCam.rotX=parseFloat($("rotx").value); refCam.rotY=parseFloat($("roty").value);
  const depth=new Float64Array(refCols*refRows).fill(-Infinity);
  const idMap=new Int32Array(refCols*refRows).fill(-1);
  for (let i=0;i<layers.length;i++) for (const p of layers[i].offset) {
    const vs=p.vertices.map(v=>refCam.project(v,refCols,refRows,CA));
    for (let k=1;k<vs.length-1;k++) fillTri(vs[0],vs[k],vs[k+1],i,depth,idMap,refCols,refRows);
  }
  let blanked=0;
  for (let i=0;i<layers.length;i++) {
    const L=layers[i];
    // Re-query: glyphcss recreates the inner <pre> on each render (reusing the
    // .glyph-scene wrapper), so a cached reference would be a detached orphan.
    const pre=L.host.querySelector("pre.glyph-output") as HTMLElement | null;
    if (!pre) continue;
    const lines=pre.textContent!.split("\n");
    for (let r=0;r<lines.length;r++) {
      let arr: string[] | null = null; const line=lines[r];
      for (let c=0;c<line.length;c++) {
        if (line[c]===" ") continue;
        const rc=Math.floor((L.ox+(c+0.5)*L.cw)/refCellW), rr=Math.floor((L.oy+(r+0.5)*L.ch)/refCellH);
        if (rc<0||rr<0||rc>=refCols||rr>=refRows) continue;
        const nid=idMap[rr*refCols+rc];
        if (nid!==-1 && nid!==i) { if (!arr) arr=line.split(""); arr[c]=" "; blanked++; }
      }
      if (arr) lines[r]=arr.join("");
    }
    pre.textContent=lines.join("\n");
  }
  return blanked;
}

let lastFrameMs = 0, fps = 0, lastBlanked = 0;
function refresh(refit = true): void {
  const t0 = performance.now();
  const cell = parseInt($("cell").value, 10);
  const rx = parseFloat($("rotx").value), ry = parseFloat($("roty").value);
  if (refit) fitAll(cell);
  const stageW = stage.clientWidth, stageH = stage.clientHeight;

  for (const L of layers) {
    const font = cell / L.density, cw = RW * font, ch = RH * font;
    L.host.style.fontSize = `${font}px`;
    L.cam.rotX = rx; L.cam.rotY = ry; L.cam.zoom = baseZoom * L.density;
    if (!modeFitted()) {
      const cols = Math.max(2, Math.floor(stageW / cw)), rows = Math.max(2, Math.floor(stageH / ch));
      L.scene.setOptions({ cols, rows, cellAspect: CA });
      L.scene.rerender();
      L.pre = L.host.querySelector("pre.glyph-output") as HTMLElement | null;
      L.wrap = L.pre?.parentElement || null;
      if (L.wrap) L.wrap.style.transform = "";
      L.cw = cw; L.ch = ch; L.ox = 0; L.oy = 0; L.cols = cols; L.rows = rows;
    } else {
      const ext = extentCells(L);
      const cols = Math.max(2, Math.ceil(ext.w) + PAD * 2), rows = Math.max(2, Math.ceil(ext.h) + PAD * 2);
      L.scene.setOptions({ cols, rows, cellAspect: CA });
      L.scene.rerender();
      L.pre = L.host.querySelector("pre.glyph-output") as HTMLElement | null;
      L.wrap = L.pre?.parentElement || null;
      const tp = L.cam.project(L.centroid, stageW / cw, stageH / ch, CA);
      const ox = tp[0] * cw - (cols * cw) / 2, oy = tp[1] * ch - (rows * ch) / 2;
      if (L.wrap) L.wrap.style.transform = `translate(${ox.toFixed(1)}px, ${oy.toFixed(1)}px)`;
      L.cw = cw; L.ch = ch; L.ox = ox; L.oy = oy; L.cols = cols; L.rows = rows;
    }
  }
  orderByDepth();
  // setOptions() schedules a render via microtask (Promise.then), which fires AFTER
  // this function returns and would overwrite occlusion. So run occlusion in a
  // microtask queued after the scenes' — it lands last and sticks.
  queueMicrotask(() => {
    lastBlanked = $("occ").checked ? applyOcclusion() : 0;
    lastFrameMs = performance.now() - t0;
    updateHud();
  });
}

function updateHud(): void {
  let cells = 0, chars = 0;
  for (const L of layers) { cells += L.cols * L.rows; chars += (L.pre?.textContent?.length ?? 0); }
  hud.innerHTML =
    `<b>${modeFitted() ? "fitted + translated" : "full-screen layers"}</b>\n` +
    `objects     ${layers.length}\n` +
    `<b class="hl">grid cells</b>  ${cells.toLocaleString()}\n` +
    `<b class="hl">text chars</b>  ${chars.toLocaleString()}\n` +
    `~string mem ${((chars*2)/1048576).toFixed(2)} MB\n` +
    `occluded    ${$("occ").checked ? lastBlanked.toLocaleString()+" cells" : "off"}\n` +
    `build ms    ${lastFrameMs.toFixed(1)}\n` +
    (fps ? `spin fps    ${fps.toFixed(0)}` : `(toggle spin for fps)`);
}

for (const id of ["cell", "rotx", "roty", "maxd", "space"]) {
  $(id).addEventListener("input", () => {
    const out = document.getElementById(`${id}-v`); if (out) out.textContent = $(id).value;
    if (id === "maxd" || id === "space") buildLayers(parseInt($("count").value, 10));
    refresh(id !== "rotx" && id !== "roty");
  });
}
$("mode").addEventListener("change", () => {
  for (const L of layers) { L.handle?.dispose(); L.handle = L.scene.add(modeFitted() ? L.centered : L.offset); L.pre = null; L.wrap = null; }
  refresh(true);
});
$("count").addEventListener("change", () => { buildLayers(parseInt($("count").value, 10)); refresh(true); });
$("occ").addEventListener("change", () => refresh(false));

let spinning = false, frames = 0, fpsT0 = 0;
$("spin").addEventListener("change", () => {
  spinning = $("spin").checked; frames = 0; fpsT0 = performance.now();
  if (spinning) tick();
});
function tick(): void {
  if (!spinning) return;
  const ry = (layers[0].cam.rotY + 0.7) % 360;
  $("roty").value = String(Math.round(ry));
  refresh(false);
  frames++;
  const now = performance.now();
  if (now - fpsT0 >= 500) { fps = (frames * 1000) / (now - fpsT0); frames = 0; fpsT0 = now; }
  requestAnimationFrame(tick);
}

// Only refit on a REAL stage size change (not every observer tick) — avoids loops.
if (typeof ResizeObserver !== "undefined") {
  let lastW = 0, lastH = 0, raf = 0;
  new ResizeObserver(() => {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    cancelAnimationFrame(raf); raf = requestAnimationFrame(() => refresh(true));
  }).observe(stage);
}

buildLayers(parseInt($("count").value, 10));
requestAnimationFrame(() => requestAnimationFrame(() => {
  measureRatios();
  loadingEl.style.display = "none";
  refresh(true);
}));
