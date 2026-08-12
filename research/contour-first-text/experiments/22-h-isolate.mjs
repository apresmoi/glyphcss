import { readFileSync } from "node:fs";
import { parseFont, composeText } from "../../../packages/fonts/dist/index.js";
import { createGlyphOrthographicCamera } from "../../../packages/glyphcss/dist/index.js";
import { recenterPolygons } from "../../../packages/core/dist/index.js";

const fontBuf = readFileSync("/tmp/roboto700.ttf");
const font = parseFont(fontBuf.buffer.slice(fontBuf.byteOffset, fontBuf.byteOffset + fontBuf.byteLength));

const raw = composeText(font, "h", {
  size: 100, depth: 80, profile: { edge: "bevel", raised: false, segments: 3 },
  letterSpacing: 0, lineHeight: 1.15, align: "center", underline: false, strike: false,
  curveSteps: 4, simplify: 2, warp: { shape: "none", amount: 0.5 },
  faces: { front: { color: "#d4a82a" }, sides: { color: "#7c5e16" }, back: { color: "#7c5e16" } },
});
const base = recenterPolygons(raw);
let minWY=Infinity,maxWY=-Infinity;
for (const q of base) for (const v of q.vertices) { if (v[1]<minWY) minWY=v[1]; if (v[1]>maxWY) maxWY=v[1]; }
const rightThreshold = minWY + (maxWY-minWY)*0.60;
console.log("world Y range:", minWY.toFixed(1), maxWY.toFixed(1), "right-stem threshold:", rightThreshold.toFixed(1));

function rotateVec3(v, rxDeg, ryDeg, rzDeg) {
  const dx=(rxDeg*Math.PI)/180, dy=(ryDeg*Math.PI)/180, dz=(rzDeg*Math.PI)/180;
  let [x,y,z]=v;
  if (dz!==0){const c=Math.cos(dz),s=Math.sin(dz);[x,y]=[x*c-y*s,x*s+y*c];}
  if (dy!==0){const c=Math.cos(dy),s=Math.sin(dy);[x,z]=[x*c+z*s,-x*s+z*c];}
  if (dx!==0){const c=Math.cos(dx),s=Math.sin(dx);[y,z]=[y*c-z*s,y*s+z*c];}
  return [x,y,z];
}

const INK_CREASE_ANGLE_DEG = 35;
const INK_CREASE_COS_THRESHOLD = Math.cos((INK_CREASE_ANGLE_DEG*Math.PI)/180);
// Key rotated positions to enough precision to dedupe shared verts but tolerate fp noise from rotation.
const rkey = (v) => `${v[0]},${v[1]},${v[2]}`; // EXACT match — same as production inkVertexKey

function classify(turn, tilt) {
  const camera = createGlyphOrthographicCamera({ rotX:0, rotY:0, zoom:1 }); camera.zoom = 3.2;
  const cols=160, rows=60, cellAspect=2;

  const tris = [];
  for (const poly of base) {
    const verts = poly.vertices;
    if (verts.length < 3) continue;
    const rv = verts.map(v => rotateVec3(v, turn, tilt, 0));
    for (let f = 1; f < verts.length - 1; f++) {
      const idxs = [0, f, f+1];
      const [v0,v1,v2] = idxs.map(i=>rv[i]);
      const [o0,o1,o2] = idxs.map(i=>verts[i]);
      const ux=v1[0]-v0[0], uy=v1[1]-v0[1], uz=v1[2]-v0[2];
      const vx=v2[0]-v0[0], vy=v2[1]-v0[1], vz=v2[2]-v0[2];
      const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
      const nLen=Math.hypot(nx,ny,nz)||1;
      const normal=[nx/nLen,ny/nLen,nz/nLen];
      const pa=camera.project(v0,cols,rows,cellAspect);
      const pb=camera.project(v1,cols,rows,cellAspect);
      const pc=camera.project(v2,cols,rows,cellAspect);
      const projected = pa[0]===pa[0] && pb[0]===pb[0] && pc[0]===pc[0];
      const area2 = projected ? (pb[0]-pa[0])*(pc[1]-pa[1])-(pb[1]-pa[1])*(pc[0]-pa[0]) : 0;
      tris.push({v0,v1,v2,o0,o1,o2,normal,frontFacing: projected && area2<=0});
    }
  }
  const edgeMap = new Map();
  const addEdge = (a,b,oa,ob,normal,frontFacing) => {
    const ka=rkey(a), kb=rkey(b);
    if (ka===kb) return;
    const canon = ka<kb;
    const key = canon ? `${ka}|${kb}` : `${kb}|${ka}`;
    let entry = edgeMap.get(key);
    if (!entry) { entry={oa,ob,contribs:[]}; edgeMap.set(key,entry); }
    entry.contribs.push({normal,frontFacing});
  };
  for (const t of tris) {
    addEdge(t.v0,t.v1,t.o0,t.o1,t.normal,t.frontFacing);
    addEdge(t.v1,t.v2,t.o1,t.o2,t.normal,t.frontFacing);
    addEdge(t.v2,t.v0,t.o2,t.o0,t.normal,t.frontFacing);
  }

  const rightStem = [];
  for (const entry of edgeMap.values()) {
    const { contribs, oa, ob } = entry;
    // "right stem" edge: BOTH endpoints' original world-Y at/above threshold
    // AND spans a meaningful Z range (vertical wall) or is a cap-boundary edge there.
    if (oa[1] < rightThreshold || ob[1] < rightThreshold) continue;
    let why;
    if (contribs.length===1) why = contribs[0].frontFacing ? "boundary-kept" : "boundary-backface-dropped";
    else {
      let silhouette=false, crease=false, anyFront=false;
      for (let i=0;i<contribs.length;i++){
        if (contribs[i].frontFacing) anyFront=true;
        for (let j=i+1;j<contribs.length;j++){
          if (contribs[i].frontFacing!==contribs[j].frontFacing) silhouette=true;
          const ni=contribs[i].normal, nj=contribs[j].normal;
          const dot=ni[0]*nj[0]+ni[1]*nj[1]+ni[2]*nj[2];
          if (dot<INK_CREASE_COS_THRESHOLD) crease=true;
        }
      }
      if (!anyFront) why="all-backfacing-dropped";
      else if (silhouette && crease) why="silhouette+crease-kept";
      else if (silhouette) why="silhouette-kept";
      else if (crease) why="crease-kept";
      else why="flat-nonboundary-dropped";
    }
    rightStem.push({ oa, ob, contribs: contribs.length, why });
  }
  return rightStem;
}

for (const [label, turn, tilt] of [["worst",47.7,27.9],["also-bad",31.5,28.8],["better",0.7,24.7],["best",-4.7,-4.4]]) {
  const rs = classify(turn, tilt);
  const tally = {};
  for (const e of rs) tally[e.why] = (tally[e.why]||0)+1;
  console.log(`\n[${label}] turn ${turn} tilt ${tilt} — right-stem-region edges: ${rs.length}`);
  console.log(tally);
}

// Deep dump: cap/wall SEAM edges specifically (both endpoints near frontZ,
// i.e. the boundary between the front cap and the first wall ring) in the
// right-stem region, for the worst rotation — to see exactly why each drops.
console.log("\n\n--- deep dump: cap/wall seam edges, right-stem region, WORST rotation ---");
function classifyVerbose(turn, tilt) {
  const camera = createGlyphOrthographicCamera({ rotX:0, rotY:0, zoom:1 }); camera.zoom = 3.2;
  const cols=160, rows=60, cellAspect=2;
  const tris = [];
  for (const poly of base) {
    const verts = poly.vertices;
    if (verts.length < 3) continue;
    const rv = verts.map(v => rotateVec3(v, turn, tilt, 0));
    for (let f = 1; f < verts.length - 1; f++) {
      const idxs = [0, f, f+1];
      const [v0,v1,v2] = idxs.map(i=>rv[i]);
      const [o0,o1,o2] = idxs.map(i=>verts[i]);
      const ux=v1[0]-v0[0], uy=v1[1]-v0[1], uz=v1[2]-v0[2];
      const vx=v2[0]-v0[0], vy=v2[1]-v0[1], vz=v2[2]-v0[2];
      const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
      const nLen=Math.hypot(nx,ny,nz)||1;
      const normal=[nx/nLen,ny/nLen,nz/nLen];
      const pa=camera.project(v0,cols,rows,cellAspect);
      const pb=camera.project(v1,cols,rows,cellAspect);
      const pc=camera.project(v2,cols,rows,cellAspect);
      const projected = pa[0]===pa[0] && pb[0]===pb[0] && pc[0]===pc[0];
      const area2 = projected ? (pb[0]-pa[0])*(pc[1]-pa[1])-(pb[1]-pa[1])*(pc[0]-pa[0]) : 0;
      tris.push({v0,v1,v2,o0,o1,o2,normal,frontFacing: projected && area2<=0});
    }
  }
  const edgeMap = new Map();
  const addEdge = (a,b,oa,ob,normal,frontFacing) => {
    const ka=rkey(a), kb=rkey(b);
    if (ka===kb) return;
    const canon = ka<kb;
    const key = canon ? `${ka}|${kb}` : `${kb}|${ka}`;
    let entry = edgeMap.get(key);
    if (!entry) { entry={oa,ob,contribs:[]}; edgeMap.set(key,entry); }
    entry.contribs.push({normal,frontFacing});
  };
  for (const t of tris) {
    addEdge(t.v0,t.v1,t.o0,t.o1,t.normal,t.frontFacing);
    addEdge(t.v1,t.v2,t.o1,t.o2,t.normal,t.frontFacing);
    addEdge(t.v2,t.v0,t.o2,t.o0,t.normal,t.frontFacing);
  }
  const frontZ = 40; // depth/2
  let shown = 0;
  for (const entry of edgeMap.values()) {
    const { contribs, oa, ob } = entry;
    if (oa[1] < rightThreshold || ob[1] < rightThreshold) continue;
    // near-front-cap seam: both endpoints close to frontZ
    if (Math.abs(oa[2]-frontZ) > 8 || Math.abs(ob[2]-frontZ) > 8) continue;
    if (shown >= 15) continue;
    shown++;
    const facings = contribs.map(c=>c.frontFacing);
    const dots = [];
    for (let i=0;i<contribs.length;i++) for (let j=i+1;j<contribs.length;j++) {
      const ni=contribs[i].normal, nj=contribs[j].normal;
      dots.push((ni[0]*nj[0]+ni[1]*nj[1]+ni[2]*nj[2]).toFixed(3));
    }
    console.log(`edge o=(${oa.map(n=>n.toFixed(1))})->(${ob.map(n=>n.toFixed(1))}) contribs=${contribs.length} facings=${facings} dots=${dots} threshold=${INK_CREASE_COS_THRESHOLD.toFixed(3)}`);
  }
}
classifyVerbose(47.7, 27.9);

// Focus further: only edges with a LARGE Z-span (genuine vertical wall
// edges connecting front toward back — these are what would render as "|"
// glyphs) within the right-stem region, tallied per rotation.
console.log("\n\n--- vertical wall edges only (|dZ| > 5), right-stem region ---");
for (const [label, turn, tilt] of [["worst",47.7,27.9],["also-bad",31.5,28.8],["better",0.7,24.7],["best",-4.7,-4.4]]) {
  const rs = classify(turn, tilt).filter(e => Math.abs(e.oa[2]-e.ob[2]) > 5);
  const tally = {};
  for (const e of rs) tally[e.why] = (tally[e.why]||0)+1;
  console.log(`[${label}] vertical-wall edges: ${rs.length}`, tally);
}

console.log("\n\n--- boundary-kept edges (contribs.length===1, frontFacing), right-stem region ---");
for (const [label, turn, tilt] of [["worst",47.7,27.9],["best",-4.7,-4.4]]) {
  const rs = classify(turn, tilt).filter(e => e.why === "boundary-kept");
  console.log(`\n[${label}] boundary-kept count: ${rs.length}`);
  for (const e of rs.slice(0, 12)) {
    console.log(`  (${e.oa.map(n=>n.toFixed(1))}) -> (${e.ob.map(n=>n.toFixed(1))})  dZ=${Math.abs(e.oa[2]-e.ob[2]).toFixed(1)}`);
  }
}
