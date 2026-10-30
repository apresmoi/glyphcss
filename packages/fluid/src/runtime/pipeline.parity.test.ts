// Worker vs main thread: the same scripted inputs through (a) GlyphFluidCore in-process
// and (b) the real worker client + the exact handler a worker runs, with messages
// structured-cloned and buffers transferred like postMessage does, one frame pipelined.
// Every frame must be identical. A planted transport bug must go red.
import { describe, expect, it } from "vitest";
import { GlyphFluidCore, type GlyphFluidCoreInit, type GlyphFluidStepInput } from "./core";
import { GlyphFluidWorkerPipeline } from "./pipeline";
import { handleGlyphFluidWorkerMessage, type GlyphFluidWorkerMessage, type GlyphFluidWorkerState } from "./protocol";
import { createGlyphFluidTargetFrame } from "../targets/frame";
import type { GlyphFluidOp } from "../sim/ops";
import type { GlyphFluidFrame } from "../cells/encode";

const INIT: GlyphFluidCoreInit = {
  cols: 72, rows: 40, cellW: 8, cellH: 12.8, fieldColor: [0.43, 0.56, 0.51], fieldLevel: 0.18,
  tuning: {}, encoding: "atlas", monoColor: "#6f8f82",
};

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Frame n's inputs: every op type, a moving coloured target with features, a zone. */
function inputs(count: number): GlyphFluidStepInput[] {
  const rand = rng(42);
  const out: GlyphFluidStepInput[] = [];
  let t = 0;
  for (let n = 0; n < count; n++) {
    const dt = 1 / 60;
    t += dt;
    const ops: GlyphFluidOp[] = [];
    if (n % 5 === 0) ops.push(["impulse", rand() * 2 - 1, rand() * 2 - 1, 0.5 + rand(), 0.04]);
    if (n % 3 === 1) ops.push(["push", rand() * 2 - 1, rand() * 2 - 1, rand() * 6 - 3, rand() * 6 - 3, 0.05]);
    if (n % 20 === 7) ops.push(["kick", 1.2]);
    if (n % 25 === 12) ops.push(["scroll", n % 2 ? 2 : -1]);
    const f = createGlyphFluidTargetFrame(INIT.cols, INIT.rows);
    f.BGM.fill(1);
    const ci = 20 + (n % 30), cj = 20;
    for (let j = 10; j < 30; j++)
      for (let i = ci - 8; i < ci + 8; i++) {
        const k = j * INIT.cols + i, d = Math.hypot((i - ci) / 8, (j - cj) / 10);
        if (d >= 1) continue;
        f.T[k] = 1 - d;
        f.TR[k] = 0.9; f.TG[k] = 0.3 + 0.3 * rand(); f.TB[k] = 0.6;
        f.TF[k] = d < 0.15 ? 1 : 0;
        // an accented band that moves and switches off every fourth stretch (accent removal)
        if (n % 40 < 30 && Math.abs(i - ci + 3) < 3) f.TA[k] = 0.4 + 0.6 * rand();
      }
    for (let k = 0; k < 200; k++) f.BGM[k] = 0.12;
    // reader letters riding over the blob: centre, cell box, threshold (rising like a melt)
    const probes = new Float64Array(4 * 7);
    for (let l = 0; l < 4; l++) probes.set([ci - 4 + l * 2.5, cj + 0.5, ci - 5 + l * 2, cj - 1, ci - 4 + l * 2, cj + 1, 0.14 + (n % 50) / 100], l * 7);
    out.push({ ops, params: { t, breath: 0.5 + 0.5 * Math.sin(t), dt, hold: Math.min(1, n / 60) }, targets: f.packed, shimmer: 0.12, probes, probeTag: n });
  }
  return out;
}

/** postMessage semantics: deep clone, listed buffers detached at the sender. */
const send = <T>(msg: T, transfer: Transferable[] = []): T => structuredClone(msg, { transfer });

/** A Worker stand-in that runs the real handler on cloned messages, asynchronously. */
function fakeWorker(mutate?: (m: GlyphFluidWorkerMessage) => GlyphFluidWorkerMessage) {
  const state: GlyphFluidWorkerState = { core: null, gen: -1 };
  const w = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as ((e: unknown) => void) | null,
    postMessage(msg: GlyphFluidWorkerMessage, transfer: Transferable[] = []) {
      const received = send(msg, transfer);
      queueMicrotask(() =>
        handleGlyphFluidWorkerMessage(state, mutate ? mutate(received) : received, (reply, tr) => {
          const back = send(reply, tr);
          queueMicrotask(() => w.onmessage?.({ data: back } as MessageEvent));
        }),
      );
    },
    terminate() {},
  };
  return w as unknown as Worker;
}

const settle = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

function diffFrames(a: GlyphFluidFrame, b: GlyphFluidFrame): number {
  let n = 0;
  const x = [...a.text], y = [...b.text];
  if (x.length !== y.length) return Math.max(x.length, y.length);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) n++;
  if (a.palette.join() !== b.palette.join()) n++;
  if (a.paletteGeneration !== b.paletteGeneration) n++;
  if (a.probeTag !== b.probeTag || a.probes?.join() !== b.probes?.join()) n++;
  return n;
}

async function run(mutate?: (m: GlyphFluidWorkerMessage) => GlyphFluidWorkerMessage) {
  const frames = inputs(150);
  const core = new GlyphFluidCore(INIT);
  const ref = frames.map((f) => core.step({ ...f, targets: f.targets.slice() }));
  const pipe = new GlyphFluidWorkerPipeline(fakeWorker(mutate), (e) => { throw e; });
  pipe.init(INIT);
  const got: GlyphFluidFrame[] = [];
  for (const f of frames) {
    await settle();
    expect(pipe.busy()).toBe(false);
    const buf = pipe.targetBuffer();
    buf.set(f.targets);
    const out = pipe.submit({ ...f, targets: buf });
    if (out) got.push(out);
  }
  await settle();
  const last = pipe.submit({ ...frames[0]!, targets: pipe.targetBuffer() });
  got.push(last!);
  let diffs = 0, lit = 0, shown = 0;
  expect(got).toHaveLength(ref.length);
  for (let i = 0; i < ref.length; i++) {
    diffs += diffFrames(ref[i]!, got[i]!);
    lit += ref[i]!.drawn;
    for (let p = 3; p < ref[i]!.probes!.length; p += 4) shown += ref[i]!.probes![p]!;
  }
  return { diffs, lit, shown, repools: ref[ref.length - 1]!.paletteGeneration };
}

describe("worker pipeline parity", () => {
  it("draws exactly the main-thread frames, one frame late", async () => {
    const r = await run();
    expect(r.lit).toBeGreaterThan(100_000);
    expect(r.repools).toBeGreaterThan(0);
    expect(r.shown).toBeGreaterThan(50); // letters condensed (and blanked cells) on many frames
    expect(r.diffs).toBe(0);
  });

  it("goes red when the worker loses the letter probes", async () => {
    const r = await run((m) => (m.kind === "step" ? { ...m, input: { ...m.input, probes: undefined } } : m));
    expect(r.diffs).toBeGreaterThan(0);
  });

  it("goes red when probe centres are corrupted on the wire", async () => {
    const r = await run((m) => (m.kind === "step" ? { ...m, input: { ...m.input, probes: m.input.probes?.map((v, i) => (i % 7 === 1 ? v + 0.5 : v)) } } : m));
    expect(r.diffs).toBeGreaterThan(0);
  });

  it("goes red when the worker drops push ops", async () => {
    const r = await run((m) => (m.kind === "step" ? { ...m, input: { ...m.input, ops: m.input.ops.filter((o) => o[0] !== "push") } } : m));
    expect(r.diffs).toBeGreaterThan(0);
  });

  it("goes red when the worker loses the accent (TA) field", async () => {
    const r = await run((m) => {
      if (m.kind !== "step") return m;
      const N = INIT.cols * INIT.rows;
      m.input.targets.fill(0, 6 * N, 7 * N);
      return m;
    });
    expect(r.diffs).toBeGreaterThan(0);
  });

  it("ignores target colour in cells no target wrote (poisoned with NaN on the wire)", async () => {
    const r = await run((m) => {
      if (m.kind !== "step") return m;
      const N = INIT.cols * INIT.rows, t = m.input.targets;
      for (let k = 0; k < N; k++) if (!(t[k]! > 0)) t[N + k] = t[2 * N + k] = t[3 * N + k] = NaN;
      return m;
    });
    expect(r.diffs).toBe(0);
  });

  it("goes red when the worker steps on a stale target frame (a recycling bug)", async () => {
    let prev: Float32Array | null = null;
    const r = await run((m) => {
      if (m.kind !== "step") return m;
      const cur = m.input.targets.slice();
      if (prev) m.input.targets.set(prev);
      prev = cur;
      return m;
    });
    expect(r.diffs).toBeGreaterThan(0);
  });
});
