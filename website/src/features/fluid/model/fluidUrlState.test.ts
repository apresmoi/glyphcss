import { describe, expect, it } from "vitest";
import { findFluidExample, fluidExampleDefaults, fluidTuningDefaults } from "./fluidExamples";
import { decodeFluidConfig, decodeFluidTuning, encodeFluidConfig, encodeFluidTuning, readFluidUrlState } from "./fluidUrlState";

const reader = findFluidExample("reader-plain")!;
const heading = findFluidExample("heading")!;

describe("fluid URL state", () => {
  it("writes nothing for an example's own defaults", () => {
    expect(encodeFluidConfig(fluidExampleDefaults(reader), fluidExampleDefaults(reader))).toBeNull();
    expect(encodeFluidTuning(fluidTuningDefaults(heading), fluidTuningDefaults(heading))).toBeNull();
  });

  it("round-trips every changed option through the link", () => {
    const defaults = fluidExampleDefaults(reader);
    const changed = {
      encoding: "mono",
      fps: 30,
      worker: false,
      fieldColor: "#123456",
      fieldLevel: 0.3,
      targetCols: 80,
      shimmer: 0.2,
      text: "Three short words.",
      wpm: 600,
      look: "glyph",
      font: "ui",
      meshRotX: -30,
      condensed: false,
      zoneKind: "pool",
      ariaLive: "polite",
    } as const;
    const raw = encodeFluidConfig({ ...defaults, ...changed }, defaults)!;
    expect(decodeFluidConfig(raw)).toEqual(changed);
    const search = `?example=reader-plain&f=${encodeURIComponent(raw)}`;
    expect(readFluidUrlState(search)).toEqual({ example: reader, config: changed, tuning: {} });
  });

  it("round-trips the sim tuning", () => {
    const defaults = fluidTuningDefaults(heading);
    const raw = encodeFluidTuning({ ...defaults, swirl: 1.25, damp: 0.95 }, defaults)!;
    expect(decodeFluidTuning(raw)).toEqual({ swirl: 1.25, damp: 0.95 });
  });

  it("degrades malformed fields to absent", () => {
    expect(readFluidUrlState("?example=nope&f=garbage&sim=%%%")).toEqual({ example: undefined, config: {}, tuning: {} });
    // Out-of-range numbers, an impossible fps and an empty text are dropped; the rest stays.
    const defaults = fluidExampleDefaults(heading);
    const raw = encodeFluidConfig(
      { ...defaults, targetCols: 9999, fps: 45 as 60, text: " ", fieldLevel: 0.25 },
      defaults,
    )!;
    expect(decodeFluidConfig(raw)).toEqual({ fieldLevel: 0.25 });
    // A truncated tail keeps everything before it.
    const valid = encodeFluidConfig({ ...defaults, encoding: "mono" }, defaults)!;
    expect(decodeFluidConfig(`${valid}q`)).toEqual({ encoding: "mono" });
    expect(decodeFluidTuning(encodeFluidTuning({ ...fluidTuningDefaults(heading), vmax: 500 }, fluidTuningDefaults(heading)))).toEqual({});
  });
});
