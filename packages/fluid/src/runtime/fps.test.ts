import { describe, expect, it } from "vitest";
import { createGlyphFluidFpsGovernor } from "./fps";

const run = (g: ReturnType<typeof createGlyphFluidFpsGovernor>, gaps: number[], start = 1000) => {
  let t = start;
  g.drawn(t);
  for (const gap of gaps) g.drawn((t += gap));
};

describe("fps governor", () => {
  it("stays at 60 while frames land on vsync", () => {
    const g = createGlyphFluidFpsGovernor(60, true);
    run(g, Array(600).fill(16.7));
    expect(g.fps).toBe(60);
  });

  it("drops to 30 for good after a window with more than 20 % missed vsyncs", () => {
    const g = createGlyphFluidFpsGovernor(60, true);
    run(g, Array.from({ length: 60 }, (_, i) => (i % 4 === 0 ? 33.4 : 16.7)));
    expect(g.fps).toBe(30);
    run(g, Array(600).fill(16.7), 9000);
    expect(g.fps).toBe(30);
  });

  it("tolerates a few misses, ignores idle gaps, and never drops when disabled or capped at 30", () => {
    const few = createGlyphFluidFpsGovernor(60, true);
    run(few, Array.from({ length: 120 }, (_, i) => (i % 10 === 0 ? 33.4 : 16.7)));
    expect(few.fps).toBe(60);
    const idle = createGlyphFluidFpsGovernor(60, true);
    run(idle, Array.from({ length: 120 }, (_, i) => (i % 3 === 0 ? 5000 : 16.7)));
    expect(idle.fps).toBe(60);
    const off = createGlyphFluidFpsGovernor(60, false);
    run(off, Array(120).fill(50));
    expect(off.fps).toBe(60);
  });
});
