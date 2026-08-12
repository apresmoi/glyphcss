#!/usr/bin/env node
// Some authored surfaces are single quads with no thickness — a fence panel is
// one polygon, so once backface culling works it vanishes when viewed from
// behind. PolyCSS has no per-material double-sided flag, so we publish an
// explicit reversed twin for those classes: same vertices and same UVs, wound
// the other way, giving both sides identical texture.
//
// This runs at PUBLISH time only. The spray pipeline keeps the original
// single-sided polygon list, so its face-index -> packed-atlas-cell identity
// (face i -> cell i) is untouched and no re-bake is needed.
import { readFile, writeFile } from "node:fs/promises";

const [input, output, ...classes] = process.argv.slice(2);
if (!input || !output || !classes.length) {
  console.error("usage: double-side-obj.mjs <in.obj> <out.obj> <material...>");
  process.exit(2);
}
const wanted = new Set(classes);
const lines = (await readFile(input, "utf8")).split("\n");

const out = [];
let material = null;
let doubled = 0;
for (const line of lines) {
  out.push(line);
  if (line.startsWith("usemtl ")) { material = line.slice(7).trim(); continue; }
  if (!line.startsWith("f ") || !material || !wanted.has(material)) continue;
  // Reverse corner order; each corner keeps its own v/vt/vn indices, so the
  // twin samples the identical atlas chart rather than a mirrored one.
  const corners = line.trim().split(/\s+/).slice(1);
  out.push(`f ${[...corners].reverse().join(" ")}`);
  doubled++;
}
await writeFile(output, out.join("\n"), "utf8");
console.log(JSON.stringify({ input, output, classes: [...wanted], doubled }));
