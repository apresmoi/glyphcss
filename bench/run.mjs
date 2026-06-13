// Trace a real pointer-drag on the bench through the chrome-capture-trace skill
// and print frame-time + Chrome trace-group (Script/Style/Layout/Paint) totals.
// Use to confirm render-path changes at the browser level, not just JS timing.
//
//   node bench/run.mjs                       # default heavy condition
//   node bench/run.mjs --lineHeight 0.5 --fill 0.95 --zoom 120
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const RUNNER = resolve(repo, ".claude/skills/chrome-capture-trace/scripts/capture-trace.mjs");

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i >= 0 ? process.argv[i + 1] : d; };
const lineHeight = arg("lineHeight", "0.5");
const fill = arg("fill", "0.99");
const zoom = arg("zoom", "200");
const qs = `lineHeight=${lineHeight}&fill=${fill}` + (zoom ? `&zoom=${zoom}` : "");
mkdirSync(resolve(repo, "bench/results"), { recursive: true });

const out = resolve(repo, "bench/results/trace.json");
execFileSync("node", [
  RUNNER,
  "--url", `http://localhost:5180/bench/index.html?${qs}`,
  "--ready-js", "window.__benchReady === true",
  "--wait-for-selector", "#host",
  "--selector", "#host",
  "--action", "drag",
  "--drag", "320,150",
  "--duration", "2200",
  "--steps", "140",
  "--warmup", "1600",
  "--settle", "400",
  "--summary-out", out,
  "--trace-out", resolve(repo, "bench/results/trace-raw.json"),
], { stdio: ["ignore", "ignore", "inherit"] });

const s = JSON.parse(readFileSync(out, "utf8"));
const g = (name) => (s.trace.groups?.[name]?.duration_ms ?? 0).toFixed(1);
console.log(`\nCondition: lineHeight=${lineHeight} fill=${fill}${zoom ? " zoom=" + zoom : ""}  drag 320,150 / ~2.2s\n`);
console.log(`frame time  p50 ${s.frames.frame_time_p50_ms}ms  p95 ${s.frames.frame_time_p95_ms}ms  p99 ${s.frames.frame_time_p99_ms}ms  (fps ${s.frames.fps_p50})`);
console.log(`slow frames >33ms: ${(s.trace.slowestFrames ?? []).filter((f) => f.dt > 33).length}`);
console.log(`trace ms over window:  script ${g("script")}  style ${g("style")}  layout ${g("layout")}  paint ${g("paint")}  raster ${g("raster")}`);
console.log(`\nraw trace: bench/results/trace-raw.json (open in Chrome DevTools › Performance)`);
