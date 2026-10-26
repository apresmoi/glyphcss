// The sim-owning half of a fluid: queued ops → adopt the target frame → step → cells →
// encode. The worker and the main-thread fallback both run THIS class on the same
// inputs, which is what makes their output identical (`pipeline.parity.test.ts`).
import { GlyphFluidSim, type GlyphFluidTuning } from "../sim/sim";
import { applyGlyphFluidOp, configureGlyphFluidDisc, configureGlyphFluidRect, stepGlyphFluidSim, type GlyphFluidOp, type GlyphFluidStepParams, type RGB } from "../sim/ops";
import { computeGlyphFluidCells, createGlyphFluidCells, type GlyphFluidCells } from "../cells/cells";
import { GlyphFluidEncoder, type GlyphFluidEncoding, type GlyphFluidFace, type GlyphFluidFrame } from "../cells/encode";
import { unpackGlyphFluidTargets } from "../targets/frame";
import { GLYPH_FLUID_PROBE_IN, GLYPH_FLUID_PROBE_OUT, sampleGlyphFluidProbes } from "../cells/probes";

export interface GlyphFluidCoreInit {
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  fieldColor: RGB;
  fieldLevel: number;
  tuning: Partial<GlyphFluidTuning>;
  encoding: GlyphFluidEncoding;
  monoColor: string;
  /** Default `"dots"`. */
  face?: GlyphFluidFace;
  /** `"rect"` (default) fills the grid; `"circle"` keeps molty's disc inscribed in it. */
  shape?: "rect" | "circle";
}

export interface GlyphFluidStepInput {
  ops: GlyphFluidOp[];
  params: GlyphFluidStepParams;
  /** Packed target fields (`GLYPH_FLUID_TARGET_FIELDS`), `cols × rows` each. */
  targets: Float32Array;
  /** Dither shimmer amplitude. */
  shimmer: number;
  /** Letter probes (`GLYPH_FLUID_PROBE_IN` per probe); sampled after the step. */
  probes?: Float64Array;
  /** Echoed on the frame with the probe results. */
  probeTag?: number;
}

export class GlyphFluidCore {
  readonly sim: GlyphFluidSim;
  readonly cells: GlyphFluidCells;
  private encoder: GlyphFluidEncoder;
  private clockMs = 0;
  private skip: Uint8Array;

  constructor(init: GlyphFluidCoreInit) {
    const sim = new GlyphFluidSim(init.cols, init.rows, init.cellW, init.cellH);
    const field = { fieldColor: init.fieldColor, fieldLevel: init.fieldLevel };
    if (init.shape === "circle") configureGlyphFluidDisc(sim, init.cellW, field);
    else configureGlyphFluidRect(sim, init.cellW, field);
    Object.assign(sim.p, init.tuning);
    this.sim = sim;
    this.cells = createGlyphFluidCells(init.cols, init.rows);
    this.skip = new Uint8Array(init.cols * init.rows);
    this.encoder = new GlyphFluidEncoder({ encoding: init.encoding, monoColor: init.monoColor, face: init.face, now: () => this.clockMs });
  }

  /** Apply ops in order and adopt targets, without stepping (reduced-motion settling). */
  prepare(input: GlyphFluidStepInput): void {
    for (const op of input.ops) applyGlyphFluidOp(this.sim, op);
    unpackGlyphFluidTargets(this.sim, input.targets);
  }

  /** Simulate one frame; does not encode. */
  advance(input: GlyphFluidStepInput): void {
    this.prepare(input);
    stepGlyphFluidSim(this.sim, input.params);
  }

  /** Sample the letter probes, decide cells (blank under shown letters) and encode the current view. */
  render(time: number, shimmer: number, probes?: Float64Array, probeTag?: number): GlyphFluidFrame {
    this.clockMs = time * 1000;
    let out: Float64Array | undefined;
    if (probes?.length) {
      out = new Float64Array((probes.length / GLYPH_FLUID_PROBE_IN) * GLYPH_FLUID_PROBE_OUT);
      sampleGlyphFluidProbes(this.sim, probes, this.skip, out);
    }
    computeGlyphFluidCells(this.sim, time, shimmer, this.cells, out ? this.skip : null);
    const frame = this.encoder.encode(this.cells);
    if (probes) {
      frame.probes = out ?? new Float64Array(0);
      frame.probeTag = probeTag;
    }
    return frame;
  }

  step(input: GlyphFluidStepInput): GlyphFluidFrame {
    this.advance(input);
    return this.render(input.params.t, input.shimmer, input.probes, input.probeTag);
  }
}
