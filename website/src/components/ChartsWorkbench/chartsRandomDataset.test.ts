// Pure coverage for Random's own combined dataset pool
// (AGENTS.md's "Charts" — "Data layer" — "Random"). No DOM, no network —
// `randomChartsDatasetPick` only ever reads the two vendored index modules
// (`datasets/index.ts`, `datasets/remoteIndex.ts`).
import { describe, expect, it } from "vitest";
import { randomChartsDatasetPick, type ChartsRandomDatasetPick } from "./chartsRandomDataset";
import { CHARTS_DATASETS } from "./datasets";
import { CHARTS_REMOTE_DATASET_INDEX } from "./datasets/remoteIndex";

function keyOf(pick: ChartsRandomDatasetPick): string {
  return pick.kind === "dataset" ? `dataset:${pick.id}` : `remote:${pick.hit.ref}`;
}

describe("randomChartsDatasetPick", () => {
  // Mutation check: if the Hugging Face half of the pool is ever dropped
  // (e.g. the pool built from `CHARTS_DATASETS` alone), `sawRemote` stays
  // false and this test goes red; the reverse for `sawBuiltIn`. 500 draws
  // over a 44-entry pool makes "missed a whole half by chance" astronomically
  // unlikely (< (16/44)^500) without needing a fixed seed.
  it("over many draws, hits BOTH the built-in and the curated Hugging Face pool — never a raw live search result", () => {
    let sawBuiltIn = false;
    let sawRemote = false;
    for (let i = 0; i < 500; i++) {
      const pick = randomChartsDatasetPick();
      if (pick.kind === "dataset") {
        sawBuiltIn = true;
        expect(CHARTS_DATASETS.some((d) => d.id === pick.id)).toBe(true);
      } else {
        sawRemote = true;
        // Every remote pick is one of the CURATED, pre-verified entries —
        // never a synthesized shape this module has no way to fabricate
        // anyway, pinned explicitly so a future refactor can't quietly
        // widen the pool to raw (unverified) live search results.
        expect(CHARTS_REMOTE_DATASET_INDEX.some((hit) => hit.ref === pick.hit.ref)).toBe(true);
      }
    }
    expect(sawBuiltIn).toBe(true);
    expect(sawRemote).toBe(true);
  });

  it("never repeats the currently loaded dataset — built-in or remote alike — across many successive picks", () => {
    let current = randomChartsDatasetPick();
    for (let i = 0; i < 200; i++) {
      const next = randomChartsDatasetPick(keyOf(current));
      expect(keyOf(next)).not.toBe(keyOf(current));
      current = next;
    }
  });

  it("excluding a built-in id still leaves remote entries reachable, and excluding a remote ref still leaves built-in entries reachable", () => {
    // Force enough draws that both branches of the union are exercised
    // under each exclusion — proves the exclusion filters by the ONE
    // excluded key, not by kind.
    let sawRemoteWithBuiltInExcluded = false;
    let sawBuiltInWithRemoteExcluded = false;
    for (let i = 0; i < 300; i++) {
      if (randomChartsDatasetPick(`dataset:${CHARTS_DATASETS[0]!.id}`).kind === "remote") sawRemoteWithBuiltInExcluded = true;
      if (randomChartsDatasetPick(`remote:${CHARTS_REMOTE_DATASET_INDEX[0]!.ref}`).kind === "dataset") sawBuiltInWithRemoteExcluded = true;
    }
    expect(sawRemoteWithBuiltInExcluded).toBe(true);
    expect(sawBuiltInWithRemoteExcluded).toBe(true);
  });
});
