import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveReferenceTraceContract, disposeReferenceTrace, hashReferenceFrame, hashReferenceResult, materializeReferenceTrace } from "../src/referenceTrace.mjs";

const fixture = resolve(import.meta.dirname, "../fixtures/reprojection/reference-trace-v1.json");
const gates = resolve(import.meta.dirname, "../config/measurement-gates.json");
const normalizationFile = resolve(import.meta.dirname, "../config/control-normalization.json");
const contract = async () => JSON.parse(await readFile(fixture, "utf8"));

describe("reference-trace-contract", () => {
  it("freezes the actual B7-derived trace while recording its red structural signals", async () => {
    const trace = await deriveReferenceTraceContract({ enforceStructural: false });
    try {
      expect(trace.events).toHaveLength(326);
      expect(trace.structural).toEqual({ coverage: 0.04, newlyRevealedArea: 0.96, resetFrequency: 0.018404907975460124 });
      expect(trace.events.some((event: any) => event.kind === "occlusion-swap" && event.winnerSwapCells > 0)).toBe(true);
      expect(trace.events.some((event: any) => event.kind === "reveal" && event.newlyCoveredCells > 0 && event.disoccludedCells > 0)).toBe(true);
      expect(trace.events.filter((event: any) => event.reset)).toHaveLength(6);
      const mean = (kind: string) => { const selected = trace.events.filter((event: any) => event.kind === kind && !event.reset); return selected.reduce((sum: number, event: any) => sum + event.cameraMotion, 0) / selected.length; };
      expect(mean("fast")).toBeGreaterThan(mean("slow"));
      expect(trace.contract.supersedes.only).toBe("G5 measurement population");
      expect(trace.contract.supersedes.preserved).toBe(true);
      const g5 = (JSON.parse(await readFile(gates, "utf8")) as { gates: Array<{ id: string; metrics: Array<{ id: string; threshold: number; aggregation: string }> }> }).gates.find((gate) => gate.id === "G5")!;
      expect(g5.metrics.find((metric) => metric.id === "coverage")).toMatchObject({ threshold: .9, aggregation: "min" });
      expect(g5.metrics.find((metric) => metric.id === "newly-revealed-area")).toMatchObject({ threshold: .2, aggregation: "max" });
      expect(g5.metrics.find((metric) => metric.id === "reset-frequency")).toMatchObject({ threshold: .1, aggregation: "mean" });
    } finally {
      await disposeReferenceTrace(trace);
    }
    const materialized = await materializeReferenceTrace();
    try {
      expect(materialized.transitions).toHaveLength(326);
      expect(materialized.transitions.map((transition: any) => transition.resultSha256)).toEqual(materialized.events.map((event: any) => event.resultSha256));
      expect(materialized.structural).toEqual({ coverage: 0.04, newlyRevealedArea: 0.96, resetFrequency: 0.018404907975460124 });
      const normalization = JSON.parse(await readFile(normalizationFile, "utf8"));
      const frame = materialized.transitions[0].targetFrame;
      const identity = hashReferenceFrame(frame, normalization);
      const depth = new Float64Array(frame.depth); depth[depth.findIndex(Number.isFinite)] += 1e-4;
      const surfaceId = new Int32Array(frame.surfaceId);
      const surfaces = [...new Set(surfaceId)].filter((value) => value >= 0);
      surfaceId[surfaceId.findIndex((value) => value === surfaces[0])] = surfaces[1];
      const instanceLookup = [...frame.instanceLookup];
      [instanceLookup[0], instanceLookup[1]] = [instanceLookup[1], instanceLookup[0]];
      const glyphIndex = [...frame.visibleAscii].findIndex((value) => value !== "\n");
      const visibleAscii = `${frame.visibleAscii.slice(0, glyphIndex)}${frame.visibleAscii[glyphIndex] === "A" ? "B" : "A"}${frame.visibleAscii.slice(glyphIndex + 1)}`;
      expect(surfaces.length).toBeGreaterThan(1);
      expect(instanceLookup).toHaveLength(frame.instanceLookup.length);
      expect(new Set(instanceLookup)).toEqual(new Set(frame.instanceLookup));
      expect(visibleAscii).toHaveLength(frame.visibleAscii.length);
      expect(visibleAscii).not.toBe(frame.visibleAscii);
      expect(hashReferenceFrame({ ...frame, depth }, normalization)).not.toBe(identity);
      expect(hashReferenceFrame({ ...frame, surfaceId }, normalization)).not.toBe(identity);
      expect(hashReferenceFrame({ ...frame, instanceLookup }, normalization)).not.toBe(identity);
      expect(hashReferenceFrame({ ...frame, visibleAscii }, normalization)).not.toBe(identity);
    } finally {
      await disposeReferenceTrace(materialized);
    }
  }, 300_000);

  it("fails the prescribed result hash on hostile output corruption including atlas confidence", () => {
    const result = {
      warpRgb: new Float32Array([0.1, -0]),
      reprojectionValid: new Float32Array([1]),
      disocclusion: new Float32Array([0]),
      atlasConfidence: new Float32Array([0.75]),
      state: { contentSha256: "a".repeat(64) },
    };
    const expected = hashReferenceResult(result);
    const corrupted = { ...result, atlasConfidence: new Float32Array([0.5]) };
    expect(hashReferenceResult(corrupted)).not.toBe(expected);
  });

  it("proves the representative structural signals remain red under full G5", async () => {
    await expect(deriveReferenceTraceContract({ enforceStructural: true })).rejects.toThrow(/REFERENCE_TRACE_G5_STRUCTURAL_DOMAIN:0\.04\/0\.96\//);
  }, 300_000);

  it("fails closed on corpus, frame schedule, and expected-event hash drift", async () => {
    const original = await contract();
    const variants = [
      { ...original, corpus: { ...original.corpus, configSha256: "0".repeat(64) } },
      { ...original, corpus: { ...original.corpus, manifestSha256: "1".repeat(64) } },
      { ...original, segments: original.segments.map((segment: any, index: number) => index ? segment : { ...segment, subdivisionsPerLeg: segment.subdivisionsPerLeg + 1 }) },
      { ...original, expected: { ...original.expected, frameSha256: "e".repeat(64) } },
      { ...original, expected: { ...original.expected, eventSha256: "f".repeat(64) } },
    ];
    for (const altered of variants) await expect(deriveReferenceTraceContract({ contract: altered, enforceStructural: false })).rejects.toThrow(/REFERENCE_TRACE_(CORPUS_CONFIG_HASH_DRIFT|CORPUS_MANIFEST_HASH_DRIFT|EXPECTED_EVENT_HASH_DRIFT)/);
  }, 600_000);
});
