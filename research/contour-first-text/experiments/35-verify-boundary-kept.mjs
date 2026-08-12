// Diagnose ink's missing h/p/y strokes on the wordart page's REAL path:
// runtime Google font (Roboto 700, fetched from the same fontsource CDN the
// website uses), composeText "Glyph\nCSS" with the page's actual defaults
// (profile: bevel, edge segments 3, simplify 2), GlyphMesh rotation=[turn,tilt,0]
// via the SAME rotateVec3 the mesh transform uses, mode: ink, hiddenLines: show.
//
// This is a standalone REIMPLEMENTATION of rasterizeInk's classification
// logic (copied from packages/glyphcss/src/render/rasterize.ts, not a source
// edit) so we can instrument per-edge without touching shipped code.
import { readFileSync } from "node:fs";
import { parseFont, composeText } from "../../../packages/fonts/dist/index.js";
import { createGlyphOrthographicCamera } from "../../../packages/glyphcss/dist/index.js";
import { recenterPolygons } from "../../../packages/core/dist/index.js";

const fontBuf = readFileSync("/tmp/roboto700.ttf");
const font = parseFont(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));

const raw = composeText(font, "Glyph\nCSS", {
  size: 100,
  depth: 80,
  profile: { edge: "bevel", raised: false, segments: 3 },
  letterSpacing: 0,
  lineHeight: 1.15,
  align: "center",
  underline: false,
  strike: false,
  curveSteps: 4,
  simplify: 2,
  warp: { shape: "none", amount: 0.5 },
  faces: {
    front: { color: "#d4a82a" },
    sides: { color: "#7c5e16" },
    back: { color: "#7c5e16" },
  },
});
console.log("total polygons:", raw.length);

// Match GlyphMesh's CSS-style rotateX(rx) rotateY(ry) rotateZ(rz) — copied
// from packages/core/src/math/rotation.ts (rotateVec3), rot = [turn, tilt, 0].
function rotateVec3(v, rxDeg, ryDeg, rzDeg) {
  const dx = (rxDeg * Math.PI) / 180, dy = (ryDeg * Math.PI) / 180, dz = (rzDeg * Math.PI) / 180;
  let [x, y, z] = v;
  if (dz !== 0) { const c = Math.cos(dz), s = Math.sin(dz); [x, y] = [x * c - y * s, x * s + y * c]; }
  if (dy !== 0) { const c = Math.cos(dy), s = Math.sin(dy); [x, z] = [x * c + z * s, -x * s + z * c]; }
  if (dx !== 0) { const c = Math.cos(dx), s = Math.sin(dx); [y, z] = [y * c - z * s, y * s + z * c]; }
  return [x, y, z];
}
function rotatePolys(ps, turn, tilt) {
  return ps.map((q) => ({ ...q, vertices: q.vertices.map((v) => rotateVec3(v, turn, tilt, 0)) }));
}

const INK_CREASE_ANGLE_DEG = 35;
const INK_CREASE_COS_THRESHOLD = Math.cos((INK_CREASE_ANGLE_DEG * Math.PI) / 180);
const EPS_REL = 1e-7;
function computeQuantum(tris) {
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for (const t of tris) for (const v of [t.v0,t.v1,t.v2]) {
    if (v[0]<minX) minX=v[0]; if (v[0]>maxX) maxX=v[0];
    if (v[1]<minY) minY=v[1]; if (v[1]>maxY) maxY=v[1];
    if (v[2]<minZ) minZ=v[2]; if (v[2]>maxZ) maxZ=v[2];
  }
  const diag = Math.hypot(maxX-minX, maxY-minY, maxZ-minZ);
  return diag > 0 ? diag * EPS_REL : 1e-9;
}
function makeTolerantKey(q) {
  const inv = 1/q;
  return (v) => `${Math.round(v[0]*inv)},${Math.round(v[1]*inv)},${Math.round(v[2]*inv)}`;
}
const exactKey = (v) => `${v[0]},${v[1]},${v[2]}`;
let inkVertexKey = exactKey;

// Verbatim re-derivation of rasterizeInk's edge classification (hiddenLines
// "show" path — no occlusion map), instrumented with counters and per-edge
// bounding-box tagging so we can find which named stroke each dropped edge
// belongs to.
function classifyInk(polygons, camera, cols, rows, cellAspect, useTolerant) {
  const tris = [];
  for (const poly of polygons) {
    const verts = poly.vertices;
    if (verts.length < 3 || poly.hidden) continue;
    for (let f = 1; f < verts.length - 1; f++) {
      const v0 = verts[0], v1 = verts[f], v2 = verts[f + 1];
      const ux = v1[0] - v0[0], uy = v1[1] - v0[1], uz = v1[2] - v0[2];
      const vx = v2[0] - v0[0], vy = v2[1] - v0[1], vz = v2[2] - v0[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      const normal = [nx / nLen, ny / nLen, nz / nLen];
      const pa = camera.project(v0, cols, rows, cellAspect);
      const pb = camera.project(v1, cols, rows, cellAspect);
      const pc = camera.project(v2, cols, rows, cellAspect);
      const projected = pa[0] === pa[0] && pb[0] === pb[0] && pc[0] === pc[0];
      const area2 = projected ? (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) : 0;
      tris.push({ id: tris.length, v0, v1, v2, normal, frontFacing: projected && area2 <= 0 });
    }
  }

  const keyFn = useTolerant ? makeTolerantKey(computeQuantum(tris)) : exactKey;
  const edgeMap = new Map();
  const addEdge = (a, b, normal, frontFacing) => {
    const ka = keyFn(a), kb = keyFn(b);
    if (ka === kb) return;
    const canon = ka < kb;
    const key = canon ? `${ka}|${kb}` : `${kb}|${ka}`;
    let entry = edgeMap.get(key);
    if (!entry) { entry = { a, b, contribs: [] }; edgeMap.set(key, entry); }
    entry.contribs.push({ normal, frontFacing });
  };
  for (const t of tris) {
    addEdge(t.v0, t.v1, t.normal, t.frontFacing);
    addEdge(t.v1, t.v2, t.normal, t.frontFacing);
    addEdge(t.v2, t.v0, t.normal, t.frontFacing);
  }

  const stats = { boundaryKept: 0, boundaryDroppedBackface: 0, silhouette: 0, crease: 0, silhouetteAndCrease: 0, droppedNoFrontNoSilNoCrease: 0, droppedAllBack: 0, moreThan2: 0 };
  const kept = [];
  const dropped = [];
  for (const entry of edgeMap.values()) {
    const { contribs, a, b } = entry;
    if (contribs.length > 2) stats.moreThan2++;
    if (contribs.length === 1) {
      if (contribs[0].frontFacing) { stats.boundaryKept++; kept.push({ a, b, why: "boundary" }); }
      else { stats.boundaryDroppedBackface++; dropped.push({ a, b, why: "boundary-backface" }); }
      continue;
    }
    let silhouette = false, crease = false, anyFront = false;
    for (let i = 0; i < contribs.length; i++) {
      if (contribs[i].frontFacing) anyFront = true;
      for (let j = i + 1; j < contribs.length; j++) {
        if (contribs[i].frontFacing !== contribs[j].frontFacing) silhouette = true;
        const ni = contribs[i].normal, nj = contribs[j].normal;
        const dot = ni[0] * nj[0] + ni[1] * nj[1] + ni[2] * nj[2];
        if (dot < INK_CREASE_COS_THRESHOLD) crease = true;
      }
    }
    if (!anyFront) { stats.droppedAllBack++; dropped.push({ a, b, why: "all-backfacing" }); continue; }
    if (silhouette && crease) { stats.silhouetteAndCrease++; kept.push({ a, b, why: "silhouette+crease" }); }
    else if (silhouette) { stats.silhouette++; kept.push({ a, b, why: "silhouette" }); }
    else if (crease) { stats.crease++; kept.push({ a, b, why: "crease" }); }
    else { stats.droppedNoFrontNoSilNoCrease++; dropped.push({ a, b, why: "flat-nonboundary" }); }
  }
  return { stats, kept, dropped, edgeCount: edgeMap.size, triCount: tris.length };
}

for (const [label, turn, tilt] of [
  ["worst", 47.7, 27.9],
  ["also-bad", 31.5, 28.8],
  ["better", 0.7, 24.7],
  ["best", -4.7, -4.4],
]) {
  const polys = recenterPolygons(rotatePolys(recenterPolygons(raw), turn, tilt));
  const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 1 });
  camera.zoom = 3.2;
  const cols = 160, rows = 60, cellAspect = 2;
  const before = classifyInk(polys, camera, cols, rows, cellAspect, false);
  const after = classifyInk(polys, camera, cols, rows, cellAspect, true);
  console.log(`\n=== ${label} (turn ${turn}, tilt ${tilt}) ===`);
  console.log("BEFORE (exact key)    boundaryKept:", before.stats.boundaryKept, "  edges:", before.edgeCount, "  stats:", before.stats);
  console.log("AFTER  (tolerant key) boundaryKept:", after.stats.boundaryKept, "  edges:", after.edgeCount, "  stats:", after.stats);
}
