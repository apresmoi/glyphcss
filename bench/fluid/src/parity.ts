// Real-Worker parity: the runtime's worker client against a REAL dedicated worker running
// the package's worker entry, vs GlyphFluidCore on the main thread, over scripted inputs
// that hit every op type. Frame-by-frame diff of text, palette and generation.
// ?mutate=drop-push plants a transport bug (the posted step loses its push ops) and must
// produce diffs; ?frames=N.
import { GlyphFluidCore, createGlyphFluidTargetFrame, type GlyphFluidCoreInit, type GlyphFluidStepInput, type GlyphFluidOp, type GlyphFluidFrame } from "@glyphcss/fluid";
import { GlyphFluidWorkerPipeline } from "../../../packages/fluid/src/runtime/pipeline";

const q = new URLSearchParams(location.search);
const FRAMES = Number(q.get("frames") ?? 600);
const MUTATE = q.get("mutate");
const INIT: GlyphFluidCoreInit = {
  cols: 144, rows: 66, cellW: 10, cellH: 16, fieldColor: [0x6f / 255, 0x8f / 255, 0x82 / 255], fieldLevel: 0.18,
  tuning: {}, encoding: "atlas", monoColor: "#6f8f82",
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function inputs(count: number): GlyphFluidStepInput[] {
  const rand = rng(42), out: GlyphFluidStepInput[] = [];
  let t = 0;
  for (let n = 0; n < count; n++) {
    const dt = 1 / 60;
    t += dt;
    const ops: GlyphFluidOp[] = [];
    if (n % 5 === 0) ops.push(["impulse", rand() * 2 - 1, rand() * 2 - 1, 0.5 + rand(), 0.04]);
    if (n % 2 === 1) ops.push(["push", rand() * 2 - 1, rand() * 2 - 1, rand() * 6 - 3, rand() * 6 - 3, 0.05]);
    if (n % 40 === 7) ops.push(["kick", 1.2]);
    if (n % 50 === 12) ops.push(["scroll", n % 2 ? 2 : -1]);
    const f = createGlyphFluidTargetFrame(INIT.cols, INIT.rows);
    f.BGM.fill(1);
    const ci = 40 + (n % 60), cj = 30;
    for (let j = 10; j < 50; j++)
      for (let i = ci - 20; i < ci + 20; i++) {
        const k = j * INIT.cols + i, d = Math.hypot((i - ci) / 20, (j - cj) / 15);
        if (d >= 1) continue;
        f.T[k] = 1 - d;
        f.TR[k] = 0.9; f.TG[k] = 0.3 + 0.3 * rand(); f.TB[k] = 0.6;
        f.TF[k] = d < 0.1 ? 1 : 0;
      }
    for (let k = 0; k < 500; k++) f.BGM[k] = 0.12;
    out.push({ ops, params: { t, breath: 0.5 + 0.5 * Math.sin(t), dt, hold: Math.min(1, (n % 200) / 60) }, targets: f.packed, shimmer: 0.12 });
  }
  return out;
}

async function run() {
  const frames = inputs(FRAMES);
  const core = new GlyphFluidCore(INIT);
  const ref = frames.map((f) => core.step({ ...f, targets: f.targets.slice() }));
  const worker = new Worker("fluid-worker.bundle.js", { type: "module" });
  if (MUTATE === "drop-push") {
    const post = worker.postMessage.bind(worker);
    worker.postMessage = ((m: { kind: string; input?: GlyphFluidStepInput }, t: Transferable[]) => {
      if (m.kind === "step") m.input!.ops = m.input!.ops.filter((o) => o[0] !== "push");
      post(m, t);
    }) as typeof worker.postMessage;
  }
  const pipe = new GlyphFluidWorkerPipeline(worker, (e) => console.error(e));
  pipe.init(INIT);
  const got: GlyphFluidFrame[] = [];
  const idle = () => new Promise<void>((r) => { const w = () => (pipe.busy() ? setTimeout(w, 0) : r()); w(); });
  for (const f of [...frames, frames[0]!]) {
    await idle();
    const buf = pipe.targetBuffer();
    buf.set(f.targets);
    const out = pipe.submit({ ...f, targets: buf });
    if (out) got.push(out);
  }
  let textDiff = 0, paletteDiff = 0, lit = 0;
  for (let i = 0; i < ref.length; i++) {
    const a = [...ref[i]!.text], b = [...(got[i]?.text ?? "")];
    for (let k = 0; k < Math.max(a.length, b.length); k++) if (a[k] !== b[k]) textDiff++;
    if (ref[i]!.palette.join() !== got[i]?.palette.join() || ref[i]!.paletteGeneration !== got[i]?.paletteGeneration) paletteDiff++;
    lit += ref[i]!.drawn;
  }
  pipe.dispose();
  return { frames: ref.length, received: got.length, lit, textDiff, paletteDiff, repools: ref[ref.length - 1]!.paletteGeneration, mutate: MUTATE };
}

(window as unknown as Record<string, unknown>).__parity = run();
