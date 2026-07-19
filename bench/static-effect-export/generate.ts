/**
 * Generate both export strategies for the representative case, write the pens to
 * disk, and print raw + gzipped payload sizes for the results table.
 */
import { gzipSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { makeBaked, buildStrategyA, buildStrategyB, COLS, ROWS, LOOP_SECONDS } from "./harness";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, "out");
mkdirSync(outDir, { recursive: true });

const gz = (s: string) => gzipSync(Buffer.from(s, "utf8"), { level: 9 }).length;
const kb = (n: number) => (n / 1024).toFixed(1);

const baked = makeBaked();

const A_FRAMES = [12, 24, 36];
const results: { name: string; raw: number; gz: number }[] = [];

for (const n of A_FRAMES) {
  const html = buildStrategyA(baked, n);
  writeFileSync(resolve(outDir, `strategyA-${n}.html`), html);
  results.push({ name: `A (N=${n})`, raw: html.length, gz: gz(html) });
}

const b = buildStrategyB(baked);
writeFileSync(resolve(outDir, "strategyB.html"), b);
results.push({ name: "B (inlined JS)", raw: b.length, gz: gz(b) });

console.log(`\nRepresentative case: sphere, ${COLS}x${ROWS} grid, ${LOOP_SECONDS}s loop, field-synth (space:"surface")\n`);
console.log("Strategy            | Raw (KB) | Gzip (KB)");
console.log("--------------------|----------|----------");
for (const r of results) {
  console.log(`${r.name.padEnd(19)} | ${kb(r.raw).padStart(8)} | ${kb(r.gz).padStart(8)}`);
}

const bGz = results.find((r) => r.name.startsWith("B"))!.gz;
console.log(`\nStrategy B gzip = ${bGz} bytes (${kb(bGz)} KB).`);
// crossover: per-frame gzip cost of A
const a12 = results.find((r) => r.name.includes("12"))!.gz;
const a36 = results.find((r) => r.name.includes("36"))!.gz;
const perFrame = (a36 - a12) / (36 - 12);
const base = a12 - perFrame * 12;
const crossover = (bGz - base) / perFrame;
console.log(`A gzip ≈ ${base.toFixed(0)} + ${perFrame.toFixed(0)}*N bytes  →  A exceeds B at N ≈ ${crossover.toFixed(1)} frames.`);

writeFileSync(resolve(outDir, "sizes.json"), JSON.stringify({ results, perFrameGz: perFrame, baseGz: base, crossover }, null, 2));
console.log(`\nWrote pens + sizes.json to ${outDir}`);
