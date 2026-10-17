import { build } from "esbuild";
import { Worker } from "node:worker_threads";
import { readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import type { GlyphDiagramRenderOptions } from "../src/renderTypes.ts";
import type { GlyphDiagramQuality } from "../src/quality.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const { values } = parseArgs({ options: {
  "time-cap-ms": { type: "string", default: "180000" },
  output: { type: "string", default: resolve(here, "baseline.json") },
  filter: { type: "string" },
  help: { type: "boolean" },
} });
if (values.help) {
  console.log("Usage: pnpm --filter @glyphcss/diagrams bench [--time-cap-ms 180000] [--output FILE] [--filter NAME]\nEach render runs in a terminable worker; timings exclude worker startup and quality computation.");
  process.exit(0);
}
const timeCapMs = Number(values["time-cap-ms"]);
if (!Number.isSafeInteger(timeCapMs) || timeCapMs < 1) throw new Error("--time-cap-ms must be a positive integer.");
const output = resolve(values.output!);
const manifest = JSON.parse(await readFile(resolve(here, "manifest.json"), "utf8")) as { corpus: string[] };
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// Bundle the package and workspace dependencies from source. No built package
// entry points participate, and the worker needs no DOM beyond import-time HTMLElement.
const built = await build({
  stdin: { contents: `export { renderGlyphDiagram } from "./packages/diagrams/src/render.ts";
    export { glyphGraphFromMermaid } from "./packages/diagrams/src/mermaid.ts";
    export { computeGlyphDiagramQuality } from "./packages/diagrams/src/quality.ts";`, resolveDir: root },
  bundle: true, platform: "node", format: "cjs", write: false,
  alias: { glyphcss: resolve(root, "packages/glyphcss/src/index.ts"), "@glyphcss/core": resolve(root, "packages/core/src/index.ts") },
});
const bundle = built.outputFiles[0]!.text;
const workerSource = `globalThis.HTMLElement = class {};
${bundle}
const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  try {
    const graph = module.exports.glyphGraphFromMermaid(workerData.source);
    parentPort.postMessage({ kind: "start", nodes: graph.nodes.length, edges: graph.edges.length });
    const start = performance.now();
    const result = await module.exports.renderGlyphDiagram(workerData.source, workerData.options);
    const ms = performance.now() - start;
    parentPort.postMessage({ kind: "result", ms,
      metrics: module.exports.computeGlyphDiagramQuality(result, workerData.options),
      sizes: result.pages.map(p => ({ width: p.canvas.cols, height: p.canvas.rows })),
      ledger: result.report.ledger });
  } catch (error) {
    parentPort.postMessage({ kind: "error", error: error.message, code: error.code ?? null });
  }
})();`;

interface RecordResult {
  file: string; options: GlyphDiagramRenderOptions; sourceSha256: string; invocations: number;
  status: "rendered" | "timeout" | "error";
  nodes?: number; edges?: number; ms?: number; elapsedMs: number;
  metrics?: GlyphDiagramQuality; sizes?: { width: number; height: number }[];
  ledger?: unknown[]; error?: string; code?: string | null;
}
async function render(source: string, options: GlyphDiagramRenderOptions): Promise<Omit<RecordResult, "file" | "options" | "sourceSha256" | "invocations">> {
  const start = performance.now();
  const worker = new Worker(workerSource, { eval: true, workerData: { source, options } });
  let counts: { nodes?: number; edges?: number } = {};
  const outcome = await new Promise<Omit<RecordResult, "file" | "options" | "sourceSha256" | "invocations">>((done) => {
    let settled = false;
    const finish = (value: Parameters<typeof done>[0]) => {
      if (settled) return;
      settled = true; clearTimeout(timer); done(value);
    };
    // A Promise.race around renderGlyphDiagram cannot interrupt its synchronous
    // routing search. Terminate the isolated worker when the parent cap fires.
    const timer = setTimeout(() => finish({ status: "timeout", ...counts, elapsedMs: performance.now() - start }), timeCapMs);
    worker.on("message", (message) => {
      if (message.kind === "start") { counts = { nodes: message.nodes, edges: message.edges }; return; }
      const { kind, ...payload } = message;
      finish({ status: kind === "result" ? "rendered" : "error", ...counts, ...payload, elapsedMs: performance.now() - start });
    });
    worker.on("error", (error) => finish({ status: "error", ...counts, error: error.message, elapsedMs: performance.now() - start }));
    worker.on("exit", (code) => finish({ status: "error", ...counts, error: `Worker exited (${code}) without a result.`, elapsedMs: performance.now() - start }));
  });
  await worker.terminate();
  return outcome;
}

const baseline = {
  schemaVersion: 1, generatedAt: new Date().toISOString(),
  gitRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  sourceBundleSha256: sha256(bundle), nodeVersion: process.version, platform: process.platform, arch: process.arch,
  timeCapMs, filter: values.filter ?? null, complete: false, records: [] as RecordResult[],
};
async function checkpoint() {
  await writeFile(`${output}.tmp`, `${JSON.stringify(baseline, null, 2)}\n`);
  await rename(`${output}.tmp`, output);
}
console.log("fixture                              n/e   ms      cuts cross bends max  detour(mean/max) heads expand blank% drop(e/l) pages");
for (const file of manifest.corpus) {
  if (values.filter && !file.includes(values.filter)) continue;
  const source = await readFile(resolve(here, "corpus", file), "utf8");
  const sidecar = JSON.parse(await readFile(resolve(here, "corpus", file.replace(/\.mmd$/, ".json")), "utf8")) as {
    sha256: string; renders: { options: GlyphDiagramRenderOptions; invocations: unknown[] }[];
  };
  if (sha256(source) !== sidecar.sha256) throw new Error(`Frozen source hash mismatch: ${file}`);
  for (const variant of sidecar.renders) {
    const record: RecordResult = { file, options: variant.options, sourceSha256: sidecar.sha256, invocations: variant.invocations.length,
      ...await render(source, variant.options) };
    baseline.records.push(record);
    await checkpoint();
    const name = file.replace(/\.mmd$/, "").padEnd(36);
    if (record.status !== "rendered") {
      console.log(`${name} ${record.nodes ?? "?"}/${record.edges ?? "?"} ${record.status.toUpperCase()} after ${Math.round(record.elapsedMs)} ms ${record.error ?? ""}`);
      continue;
    }
    const q = record.metrics!;
    console.log(`${name} ${`${record.nodes}/${record.edges}`.padEnd(5)} ${String(Math.round(record.ms!)).padEnd(7)} ${String(q.wordCuts).padEnd(4)} ${String(q.crossings).padEnd(5)} ${String(q.bends.total).padEnd(5)} ${String(q.bends.max).padEnd(4)} ${`${q.detourRatio.mean.toFixed(2)}/${q.detourRatio.max.toFixed(2)}`.padEnd(16)} ${String(q.maxArrowheadsOnSide).padEnd(5)} ${q.expansionRatio.toFixed(2).padEnd(6)} ${(100 * q.whitespaceFraction).toFixed(1).padEnd(6)} ${`${q.droppedEdges}/${q.droppedLabels}`.padEnd(9)} ${q.pages}`);
  }
}
if (!baseline.records.length) throw new Error("No corpus renders selected.");
baseline.complete = true;
await checkpoint();
const failed = baseline.records.filter((r) => r.status !== "rendered").length;
console.log(`Recorded ${baseline.records.length} renders (${failed} timeouts/errors) in ${output}`);
if (failed) process.exitCode = 1;
