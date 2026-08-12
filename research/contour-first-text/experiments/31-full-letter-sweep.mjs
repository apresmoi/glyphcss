import { readFileSync } from "node:fs";
import { parseFont, composeText } from "../../../packages/fonts/dist/index.js";
const font = parseFont(readFileSync("../../../packages/fonts/test/fixtures/Roboto-Bold.ttf").buffer);

function hist(polys, keyFn) {
  const edgeMap = new Map();
  const add = (a,b) => {
    const ka=keyFn(a), kb=keyFn(b);
    if (ka===kb) return;
    const canon = ka<kb;
    const k = canon? `${ka}|${kb}` : `${kb}|${ka}`;
    edgeMap.set(k, (edgeMap.get(k)||0)+1);
  };
  for (const q of polys) {
    const v = q.vertices;
    for (let i=1;i+1<v.length;i++) { add(v[0],v[i]); add(v[i],v[i+1]); add(v[i+1],v[0]); }
  }
  const h = {};
  for (const c of edgeMap.values()) h[c]=(h[c]??0)+1;
  return h;
}
const exactKey = (v) => `${v[0]},${v[1]},${v[2]}`;
const round4Key = (v) => v.map(n=>n.toFixed(4)).join(",");

for (const [label, profile] of [["flat","flat"], ["bevel", { edge:"bevel", raised:false, segments:3 }]]) {
  for (const ch of ["h","p","y","o"]) {
    const polys = composeText(font, ch, { size:100, depth:80, profile, letterSpacing:0, lineHeight:1.15,
      align:"center", curveSteps:4, simplify:2,
      faces: { front:{color:"#fff"}, sides:{color:"#888"}, back:{color:"#444"} } });
    const he = hist(polys, exactKey);
    const hq = hist(polys, round4Key);
    console.log(label.padEnd(6), ch, "exact:", JSON.stringify(he), " quant4:", JSON.stringify(hq));
  }
}
