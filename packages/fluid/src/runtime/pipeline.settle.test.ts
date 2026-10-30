import { describe, expect, it } from "vitest";
import { GlyphFluidMainPipeline } from "./pipeline";
import { createGlyphFluidTargetFrame } from "../targets/frame";

describe("reduced-motion settle", () => {
  it("runs until every cell reaches its target, not until the grid-wide mean error is small", () => {
    const cols = 72, rows = 40;
    const pipe = new GlyphFluidMainPipeline();
    pipe.init({ cols, rows, cellW: 8, cellH: 12.8, fieldColor: [0.4, 0.5, 0.5], fieldLevel: 0, tuning: {}, encoding: "atlas", monoColor: "#6f8f82" });
    const f = createGlyphFluidTargetFrame(cols, rows);
    f.BGM.fill(1);
    const k = 20 * cols + 36;
    f.T[k] = 1;
    f.TR[k] = 1; f.TG[k] = 0.2; f.TB[k] = 0.2;
    const frame = pipe.settle({ ops: [], params: { t: 0, breath: 0.5, dt: 1 / 60, hold: 0 }, targets: f.packed, shimmer: 0 }, 120);
    expect(pipe.core!.sim.ink[k]).toBeGreaterThan(0.98);
    expect(frame.drawn).toBeGreaterThan(0);
  });
});
