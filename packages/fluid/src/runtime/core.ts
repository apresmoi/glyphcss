// The sim-owning half of a fluid: queued ops → adopt the target frame → step → cells →
// encode. The worker and the main-thread fallback both run THIS class on the same
// inputs, which is what makes their output identical (`pipeline.parity.test.ts`).
import { GlyphFluidSim, type GlyphFluidTuning } from "../sim/sim";
import { applyGlyphFluidOp, configureGlyphFluidRect, stepGlyphFluidSim, type GlyphFluidOp, type GlyphFluidStepParams, type RGB } from "../sim/ops";
import { computeGlyphFluidCells, createGlyphFluidCells, type GlyphFluidCells } from "../cells/cells";
import { GlyphFluidEncoder, type GlyphFluidEncoding, type GlyphFluidFrame } from "../cells/encode";
import { unpackGlyphFluidTargets } from "../targets/frame";

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
}

export interface GlyphFluidStepInput {
  ops: GlyphFluidOp[];
  params: GlyphFluidStepParams;
  /** Packed target fields (`GLYPH_FLUID_TARGET_FIELDS`), `cols × rows` each. */
  targets: Float32Array;
  /** Dither shimmer amplitude. */
  shimmer: number;
}

export class GlyphFluidCore {
  readonly sim: GlyphFluidSim;
  readonly cells: GlyphFluidCells;
  private encoder: GlyphFluidEncoder;
  private clockMs = 0;

  constructor(init: GlyphFluidCoreInit) {
    const sim = new GlyphFluidSim(init.cols, init.rows, init.cellW, init.cellH);
    configureGlyphFluidRect(sim, init.cellW, { fieldColor: init.fieldColor, fieldLevel: init.fieldLevel });
    Object.assign(sim.p, init.tuning);
    this.sim = sim;
    this.cells = createGlyphFluidCells(init.cols, init.rows);
    this.encoder = new GlyphFluidEncoder({ encoding: init.encoding, monoColor: init.monoColor, now: () => this.clockMs });
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

  /** Decide cells and encode the current view. */
  render(time: number, shimmer: number): GlyphFluidFrame {
    this.clockMs = time * 1000;
    computeGlyphFluidCells(this.sim, time, shimmer, this.cells);
    return this.encoder.encode(this.cells);
  }

  step(input: GlyphFluidStepInput): GlyphFluidFrame {
    this.advance(input);
    return this.render(input.params.t, input.shimmer);
  }
}
