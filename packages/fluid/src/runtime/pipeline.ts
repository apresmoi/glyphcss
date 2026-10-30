// Where the sim runs. Both pipelines take one frame's inputs and give back a frame to
// draw; the runtime does not know which one it has.
//
// Worker: ONE frame pipelined, never lockstep (the main thread cannot block on a worker).
// Frame N draws the result posted at frame N−1, then posts N: +1 frame of latency for
// input and target changes. While a step is still in flight the runtime skips the vsync
// instead of queueing a second one. Target buffers move by transfer and come back with
// the reply for reuse.
import { GlyphFluidCore, type GlyphFluidCoreInit, type GlyphFluidStepInput } from "./core";
import { GLYPH_FLUID_TARGET_FIELDS } from "../targets/frame";
import type { GlyphFluidFrame } from "../cells/encode";
import type { GlyphFluidWorkerMessage, GlyphFluidWorkerReply } from "./protocol";
import { stepGlyphFluidSim } from "../sim/ops";

export interface GlyphFluidPipeline {
  readonly kind: "worker" | "main";
  init(init: GlyphFluidCoreInit): void;
  /** A target buffer for this frame (length = fields × cells). */
  targetBuffer(): Float32Array;
  /** True while a previous frame is still being computed: skip this vsync. */
  busy(): boolean;
  /** Hand over this frame's inputs; returns the newest finished frame, or null if none yet. */
  submit(input: GlyphFluidStepInput): GlyphFluidFrame | null;
  /** In-pipeline ms of the last finished step. */
  lastMs(): number;
  dispose(): void;
}

export class GlyphFluidMainPipeline implements GlyphFluidPipeline {
  readonly kind = "main" as const;
  core: GlyphFluidCore | null = null;
  private buf = new Float32Array(0);
  private ms = 0;

  init(init: GlyphFluidCoreInit): void {
    this.core = new GlyphFluidCore(init);
    this.buf = new Float32Array(GLYPH_FLUID_TARGET_FIELDS.length * init.cols * init.rows);
  }
  targetBuffer(): Float32Array {
    return this.buf;
  }
  busy(): boolean {
    return false;
  }
  submit(input: GlyphFluidStepInput): GlyphFluidFrame | null {
    const t0 = performance.now();
    const frame = this.core!.step(input);
    this.ms = performance.now() - t0;
    return frame;
  }
  /**
   * Reduced motion: run the sim forward without drawing until EVERY cell's ink is within
   * `tolerance` of its target (or `maxSteps`), with the shape held, then encode one
   * still frame. Per cell, not `sim.err`: that is a mean over the whole grid, so one
   * small target could be "settled" while still half-formed.
   */
  settle(input: GlyphFluidStepInput, maxSteps: number, tolerance = 0.02): GlyphFluidFrame {
    const core = this.core!, sim = core.sim;
    core.prepare(input);
    const p = { ...input.params, hold: 1, dt: 1 / 30 };
    for (let s = 0; s < maxSteps; s++) {
      p.t += p.dt;
      stepGlyphFluidSim(sim, p);
      let worst = 0;
      for (let k = 0; k < sim.N; k++) if (sim.mask[k]) worst = Math.max(worst, Math.abs(sim.T[k]! - sim.ink[k]!));
      if (worst < tolerance) break;
    }
    const frame = core.render(p.t, 0, input.probes, input.probeTag);
    if (input.rowOrigin !== undefined) frame.rowOrigin = input.rowOrigin;
    return frame;
  }
  lastMs(): number {
    return this.ms;
  }
  dispose(): void {
    this.core = null;
  }
}

export class GlyphFluidWorkerPipeline implements GlyphFluidPipeline {
  readonly kind = "worker" as const;
  private gen = 0;
  private nextId = 0;
  private inflight = 0;
  private pending: GlyphFluidWorkerReply | null = null;
  private pool: Float32Array[] = [];
  private size = 0;
  private ms = 0;
  /** Results that arrived but were superseded before being drawn. */
  skipped = 0;

  constructor(private worker: Worker, private onError: (e: unknown) => void) {
    worker.onmessage = (e: MessageEvent<GlyphFluidWorkerReply>) => this.onReply(e.data);
    worker.onerror = (e) => onError(e);
  }

  init(init: GlyphFluidCoreInit): void {
    this.gen++;
    this.inflight = 0;
    this.pending = null;
    this.pool = [];
    this.size = GLYPH_FLUID_TARGET_FIELDS.length * init.cols * init.rows;
    const msg: GlyphFluidWorkerMessage = { kind: "init", gen: this.gen, init };
    this.worker.postMessage(msg);
  }
  targetBuffer(): Float32Array {
    return this.pool.pop() ?? new Float32Array(this.size);
  }
  busy(): boolean {
    return this.inflight > 0;
  }
  submit(input: GlyphFluidStepInput): GlyphFluidFrame | null {
    const r = this.pending;
    this.pending = null;
    const msg: GlyphFluidWorkerMessage = { kind: "step", gen: this.gen, id: this.nextId++, input };
    this.worker.postMessage(msg, [input.targets.buffer]);
    this.inflight++;
    return r ? r.frame : null;
  }
  private onReply(r: GlyphFluidWorkerReply): void {
    if (r.gen !== this.gen) return;
    this.inflight--;
    if (r.targets.length === this.size) this.pool.push(r.targets);
    if (this.pending) this.skipped++;
    this.pending = r;
    this.ms = r.ms;
  }
  lastMs(): number {
    return this.ms;
  }
  dispose(): void {
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    this.pending = null;
  }
}
