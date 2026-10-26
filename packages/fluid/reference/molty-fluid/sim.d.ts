// Types for the vendored reference engine (tests only; never shipped).
export const SIM_TUNING: Record<string, unknown>;
export class FluidSim {
  constructor(W: number, H: number, cellW: number, cellH: number);
  [field: string]: any;
  impulse(x: number, y: number, strength?: number, radius?: number): void;
  push(x: number, y: number, du: number, dv: number, radius?: number): void;
  applyBackground(t: number, breath: number): void;
  step(dt: number): void;
  computeView(ambient: Float32Array | null): void;
}
