import { readFileSync } from "node:fs";
import { parseFont, composeText } from "../../../packages/fonts/dist/index.js";
const font = parseFont(readFileSync("../../../packages/fonts/test/fixtures/Roboto-Bold.ttf").buffer);

for (const ch of ["h","p","y","o"]) {
  const polys = composeText(font, ch, { size: 100, depth: 80, profile: { edge: "bevel", raised: false, segments: 3 },
    letterSpacing: 0, lineHeight: 1.15, align: "center", curveSteps: 4, simplify: 2,
    faces: { front: { color: "#fff" }, sides: { color: "#888" }, back: { color: "#444" } } });
  const allVerts = [];
  for (const p of polys) for (const v of p.vertices) allVerts.push(v);
  let min=[Infinity,Infinity,Infinity], max=[-Infinity,-Infinity,-Infinity];
  for (const v of allVerts) for (let i=0;i<3;i++){ if(v[i]<min[i]) min[i]=v[i]; if(v[i]>max[i]) max[i]=v[i]; }
  const diag = Math.hypot(max[0]-min[0], max[1]-min[1], max[2]-min[2]);
  let minEdge = Infinity;
  for (const p of polys) {
    const v = p.vertices;
    for (let i=0;i<v.length;i++) {
      const a=v[i], b=v[(i+1)%v.length];
      const d = Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
      if (d>1e-9 && d<minEdge) minEdge=d;
    }
  }
  console.log(ch, "diagonal", diag.toFixed(3), "min edge len", minEdge.toFixed(6), "relative", (minEdge/diag).toExponential(3));
}
