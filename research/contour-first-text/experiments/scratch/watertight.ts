import { readFileSync } from "node:fs";
import { parseFont } from "../../../../packages/fonts/src/parseFont.ts";
import { composeText, type Profile } from "../../../../packages/fonts/src/composeText.ts";
import type { Polygon } from "../../../../packages/core/src/index.ts";

const fontPath = process.argv[2] ?? __dirname + "/roboto-700.ttf";
const bytes = readFileSync(fontPath);
const font = parseFont(new Uint8Array(bytes));

// Repro options from the URL: depth=80, curve=4, density=3.8 (render-only),
// mode=ink (render-only). simplify default 2, profileSegments ("edge") default 3.
function buildPolysForChar(ch: string, profile: Profile): Polygon[] {
  return composeText(font, ch, {
    size: 100,
    depth: 80,
    profile,
    curveSteps: 4,
    simplify: 2,
  });
}

// Round vertex key at a tolerance to identify "same point" like a watertight
// checker normally would need exact shared indices; extrude.ts should be
// emitting EXACT shared floats for a truly watertight mesh (same numeric
// expression evaluated once), so use a small epsilon only to bucket, and
// separately report raw nearest-neighbor gap stats for degree-1 edges.
function keyOf(p: [number, number, number], scale: number): string {
  const q = 1 / scale;
  return `${Math.round(p[0] * q)}_${Math.round(p[1] * q)}_${Math.round(p[2] * q)}`;
}

function edgeDegreeHistogram(polys: Polygon[]) {
  // exact-float vertex identity (as rasterize.ts's adjacency map would use)
  const vertKey = (p: number[]) => p.map((n) => n.toFixed(9)).join(",");
  const vmap = new Map<string, number>();
  const vid = (p: number[]) => {
    const k = vertKey(p);
    let id = vmap.get(k);
    if (id === undefined) {
      id = vmap.size;
      vmap.set(k, id);
    }
    return id;
  };
  const edgeCount = new Map<string, number>();
  const edgeSample = new Map<string, { a: number[]; b: number[] }>();
  for (const poly of polys) {
    const n = poly.vertices.length;
    for (let i = 0; i < n; i++) {
      const a = poly.vertices[i] as unknown as number[];
      const b = poly.vertices[(i + 1) % n] as unknown as number[];
      const ai = vid(a);
      const bi = vid(b);
      const k = ai < bi ? `${ai}_${bi}` : `${bi}_${ai}`;
      edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1);
      if (!edgeSample.has(k)) edgeSample.set(k, { a, b });
    }
  }
  const hist: Record<number, number> = {};
  for (const c of edgeCount.values()) hist[c] = (hist[c] ?? 0) + 1;
  const degree1: { a: number[]; b: number[] }[] = [];
  for (const [k, c] of edgeCount) if (c === 1) degree1.push(edgeSample.get(k)!);
  return { hist, degree1, vertCount: vmap.size, polyCount: polys.length };
}

// Nearest-vertex gap analysis for degree-1 edge endpoints, to see if these are
// float noise (should merge under a tiny epsilon) or real gaps (a ring point
// count / ordering mismatch — no nearby vertex to weld to at all).
function nearestGap(polys: Polygon[], degree1: { a: number[]; b: number[] }[]) {
  const allVerts: number[][] = [];
  for (const poly of polys) for (const v of poly.vertices) allVerts.push(v as unknown as number[]);
  const endpoints = new Set<string>();
  for (const e of degree1) {
    endpoints.add(e.a.join(","));
    endpoints.add(e.b.join(","));
  }
  const uniqueEndpoints = [...endpoints].map((s) => s.split(",").map(Number));
  const gaps: number[] = [];
  for (const p of uniqueEndpoints) {
    let best = Infinity;
    for (const v of allVerts) {
      if (v[0] === p[0] && v[1] === p[1] && v[2] === p[2]) continue;
      const dx = v[0] - p[0], dy = v[1] - p[1], dz = v[2] - p[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 0 && d < best) best = d;
    }
    gaps.push(best);
  }
  return gaps.sort((a, b) => a - b);
}

function bbDiag(polys: Polygon[]): number {
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const poly of polys) for (const v of poly.vertices) {
    const [x, y, z] = v as unknown as number[];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
}

const chars = [..."h p y o a b d e g q A B D O G C S s Glyph".replace(/ /g, "")];
for (const profile of ["flat", "bevel"] as const) {
  console.log(`\n=== profile: ${profile} ===`);
  for (const ch of chars) {
    const polys = buildPolysForChar(ch, profile === "flat" ? "flat" : { edge: "bevel", segments: 3 });
    const { hist, degree1, vertCount, polyCount } = edgeDegreeHistogram(polys);
    const diag = bbDiag(polys);
    console.log(`  '${ch}': polys=${polyCount} verts=${vertCount} hist=${JSON.stringify(hist)}`);
    if (degree1.length) {
      const gaps = nearestGap(polys, degree1);
      const pct = gaps.map((g) => ((g / diag) * 100).toFixed(2) + "%");
      console.log(`    degree1 edges: ${degree1.length}, nearest-gap range: [${gaps[0]?.toFixed(3)}, ${gaps[gaps.length - 1]?.toFixed(3)}] world units (diag=${diag.toFixed(1)}), pct: [${pct[0]}, ${pct[pct.length - 1]}]`);
    }
  }
}
