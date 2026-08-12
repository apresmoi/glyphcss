import { describe, expect, it } from "vitest";
import { buildReferenceSignals } from "../src/referenceSignals.mjs";

describe("reference G5 signals", () => {
  it("derives reset frequency from trace events and marks absent neural events unavailable", () => {
    const spans = Array.from({ length: 20 }, (_, index) => ({ run: Math.floor(index / 10), reset: index % 10 === 0, presentationMs: 4 + index / 10, coveredCells: 100, validCells: 95, disoccludedCells: 5, validPixelError: .01 }));
    const signals = buildReferenceSignals(spans, 10, 2);
    expect(signals["reset-frequency"]).toEqual({ value: .1 });
    expect(signals["coverage"]).toEqual({ value: .95 });
    expect(signals["disocclusion-recovery-latency"]?.value).toBeNull();
    expect(signals["correction-magnitude"]?.value).toBeNull();
    expect(signals["stale-result-rejection"]?.value).toBeNull();
    expect(() => buildReferenceSignals(spans, 9, 2)).toThrow(/TRACE_SHAPE/);
  });
});
