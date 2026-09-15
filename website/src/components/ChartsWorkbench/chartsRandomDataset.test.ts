// Pure coverage for Random's own combined dataset pool
// (AGENTS.md's "Charts" — "Data layer" — "Random"; packet C3's own "Random
// can land on a surface"). No DOM, no network — `randomChartsDatasetPick`
// only ever reads the three vendored index modules (`datasets/index.ts`,
// `datasets/remoteIndex.ts`, `datasets/chart3d/index.ts`).
import { describe, expect, it } from "vitest";
import { randomChartsDatasetPick, type ChartsRandomDatasetPick } from "./chartsRandomDataset";
import { CHARTS_DATASETS } from "./datasets";
import { CHARTS_REMOTE_DATASET_INDEX } from "./datasets/remoteIndex";
import { CHARTS_3D_DATASETS } from "./datasets/chart3d";
import { CHARTS_3D_REMOTE_DATASET_INDEX } from "./datasets/chart3dRemoteIndex";

function keyOf(pick: ChartsRandomDatasetPick): string {
  if (pick.kind === "dataset") return `dataset:${pick.id}`;
  if (pick.kind === "chart3d") return `chart3d:${pick.id}`;
  return `remote:${pick.hit.ref}`;
}

describe("randomChartsDatasetPick", () => {
  // Mutation check: if the Hugging Face third of the pool is ever dropped
  // (e.g. the pool built from `CHARTS_DATASETS` alone), `sawRemote` stays
  // false and this test goes red; likewise `sawBuiltIn` and `sawChart3d`.
  // 500 draws makes "missed a whole segment by chance" astronomically
  // unlikely without needing a fixed seed (the 3D segment is the smallest
  // at 2 of 48+ entries: (46/48)^500 is still effectively zero).
  it("over many draws, hits the built-in, the curated Hugging Face, AND the 3D pool — never a raw live search result", () => {
    let sawBuiltIn = false;
    let sawRemote = false;
    let sawChart3d = false;
    for (let i = 0; i < 500; i++) {
      const pick = randomChartsDatasetPick();
      if (pick.kind === "dataset") {
        sawBuiltIn = true;
        expect(CHARTS_DATASETS.some((d) => d.id === pick.id)).toBe(true);
      } else if (pick.kind === "chart3d") {
        sawChart3d = true;
        expect(CHARTS_3D_DATASETS.some((d) => d.id === pick.id)).toBe(true);
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
    expect(sawChart3d).toBe(true);
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

  it("excluding a 3D dataset id still reaches the other kinds, and every 3D dataset is individually reachable", () => {
    let sawNon3dWith3dExcluded = false;
    for (let i = 0; i < 300; i++) {
      if (randomChartsDatasetPick(`chart3d:${CHARTS_3D_DATASETS[0]!.id}`).kind !== "chart3d") sawNon3dWith3dExcluded = true;
    }
    expect(sawNon3dWith3dExcluded).toBe(true);
    for (const dataset of CHARTS_3D_DATASETS) {
      let reached = false;
      for (let i = 0; i < 500 && !reached; i++) {
        const pick = randomChartsDatasetPick();
        if (pick.kind === "chart3d" && pick.id === dataset.id) reached = true;
      }
      expect(reached, dataset.id).toBe(true);
    }
  });

  // Packet C6 — the curated Hugging Face 3D index joins the SAME combined
  // pool as a fourth segment, appended after `chart3d` (never inserted
  // earlier, which would renumber every existing index-based fixture —
  // `chartsRandomDataset.ts`'s own doc).
  it("reaches the curated Hugging Face 3D index too, over many draws", () => {
    let sawChart3dRemote = false;
    for (let i = 0; i < 500; i++) {
      const pick = randomChartsDatasetPick();
      if (pick.kind === "chart3d-remote") {
        sawChart3dRemote = true;
        expect(CHARTS_3D_REMOTE_DATASET_INDEX.some((hit) => hit.ref === pick.hit.ref)).toBe(true);
      }
    }
    expect(sawChart3dRemote).toBe(true);
  });

  // Coordinator addendum — "Random in 3D picks from 3D-fitting datasets
  // only": passing `dimension: "3d"` restricts the draw to `chart3d`/
  // `chart3d-remote` picks alone, never a 2D built-in or 2D remote one —
  // so a reader looking at a 3D chart is never bounced back to 2D by
  // Random. Mutation: dropping the `dimension === "3d"` filter in
  // `randomChartsDatasetPick` → a `"dataset"`/`"remote"` kind shows up here.
  describe("dimension: \"3d\" narrows the pool to 3D-fitting picks only", () => {
    it("every draw is chart3d or chart3d-remote, over many draws", () => {
      for (let i = 0; i < 300; i++) {
        const pick = randomChartsDatasetPick(undefined, "3d");
        expect(["chart3d", "chart3d-remote"]).toContain(pick.kind);
      }
    });
    it("both 3D kinds stay reachable (the restriction narrows the pool, it doesn't collapse it to one kind)", () => {
      let sawChart3d = false, sawChart3dRemote = false;
      for (let i = 0; i < 300; i++) {
        const pick = randomChartsDatasetPick(undefined, "3d");
        if (pick.kind === "chart3d") sawChart3d = true;
        if (pick.kind === "chart3d-remote") sawChart3dRemote = true;
      }
      expect(sawChart3d).toBe(true);
      expect(sawChart3dRemote).toBe(true);
    });
    it("omitting dimension (the default, every pre-existing call site) still reaches every kind, unchanged", () => {
      let sawBuiltIn = false;
      for (let i = 0; i < 300; i++) {
        if (randomChartsDatasetPick().kind === "dataset") sawBuiltIn = true;
      }
      expect(sawBuiltIn).toBe(true);
    });
  });
});
