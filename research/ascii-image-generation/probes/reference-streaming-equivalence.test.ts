import { describe, expect, it } from "vitest";
import { buildReferenceSignals } from "../src/referenceSignals.mjs";
import { streamReferenceTransitions } from "../src/referenceStreaming.mjs";

describe("reference streaming", () => {
  it("preserves monolithic order, hashes, signals, and sample count with bounded compact returns", async () => {
    const transitions = [
      { id: "slow/00", reset: true, covered: 10, valid: 9, holes: 1 },
      { id: "slow/01", reset: false, covered: 10, valid: 10, holes: 0 },
      { id: "reveal/00", reset: true, covered: 8, valid: 6, holes: 2 },
    ];
    const compact = (run: number, transition: typeof transitions[number], predecessor: string | null) => ({
      hash: `${run}/${predecessor ?? "reset"}>${transition.id}`,
      pageHeapBytes: 100 + run,
      span: { run, frame: transition.id, reset: transition.reset, startMs: run * 100, endMs: run * 100 + 4, presentationMs: 4, coveredCells: transition.covered, validCells: transition.valid, disoccludedCells: transition.holes, validPixelError: 0, stateSha256: `${predecessor ?? "reset"}>${transition.id}` },
    });
    const monolithic = { spans: [] as any[], traceHashes: [] as string[] };
    for (let run = 0; run < 2; run += 1) {
      let predecessor: string | null = null;
      for (const transition of transitions) {
        const value = compact(run, transition, predecessor); monolithic.spans.push(value.span); monolithic.traceHashes.push(value.hash); predecessor = transition.id;
      }
    }
    let activeRun = -1; let predecessor: string | null = null; let runBoundaryResets = 0; const completedRuns: number[] = [];
    const streamed = await streamReferenceTransitions({ runs: 2, transitions, evaluate: async (run, transition) => {
      expect(run).toBe(activeRun);
      const value = compact(run, transition, predecessor); predecessor = transition.id; return value;
    }, beginRun: async (run) => { activeRun = run; predecessor = null; runBoundaryResets += 1; }, afterRun: async (run, snapshot) => {
      expect(predecessor).toBe(transitions.at(-1)!.id);
      expect(snapshot.spans).toHaveLength((run + 1) * transitions.length);
      expect(snapshot.traceHashes).toHaveLength((run + 1) * transitions.length);
      completedRuns.push(run);
    }, nodeHeap: () => 200 });
    expect(streamed.spans).toEqual(monolithic.spans);
    expect(streamed.traceHashes).toEqual(monolithic.traceHashes);
    expect(streamed.spans).toHaveLength(2 * transitions.length);
    expect(runBoundaryResets).toBe(2);
    expect(completedRuns).toEqual([0, 1]);
    expect(streamed.traceHashes[1]).toContain("slow/00>slow/01");
    expect(buildReferenceSignals(streamed.spans, transitions.length, 2)).toEqual(buildReferenceSignals(monolithic.spans, transitions.length, 2));
    expect(streamed.memory).toEqual({ peakNodeHeapBytes: 200, peakPageHeapBytes: 101 });
  });
});
