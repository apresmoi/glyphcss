// Random's own combined dataset pool for `/charts`' data overlay
// (AGENTS.md's "Charts" — "Data layer" — "Random"): the 16 built-in
// datasets PLUS the curated Hugging Face ids (`datasets/remoteIndex.ts`,
// already verified to load and chart) — NEVER raw live Hugging Face search
// results, which are unverified and can 404, be gated, or turn out to have
// no chartable column at all (`datasets/remoteIndex.ts`'s own P2-3 doc: the
// three ids it dropped all "loaded" but charted nothing). Uniform over the
// union, excluding whatever is currently loaded so Random always lands on
// something different — the SAME exclusion-key SHAPE
// `chartsWorkbenchState.ts`'s own `dataSourceKey` uses (`dataset:<id>` /
// `remote:<ref>`), so a caller passes `dataSourceKey(state.data.source)`
// straight through as `excludeKey`.
//
// The page's COLD-MOUNT pick stays built-in only (`randomChartsDatasetId`,
// `datasets/index.ts`) — instant, no network on first paint — so this
// wider pool is the Random BUTTON's own, never the mount path's.
import type { DatasetHit } from "../../lib/datasetSearch";
import { CHARTS_DATASETS } from "./datasets";
import { CHARTS_REMOTE_DATASET_INDEX } from "./datasets/remoteIndex";
import { CHARTS_3D_DATASETS } from "./datasets/chart3d";

export type ChartsRandomDatasetPick =
  | { readonly kind: "dataset"; readonly id: string }
  | { readonly kind: "remote"; readonly hit: DatasetHit }
  // 3D presets join THIS SAME pool, drawn by the SAME single `Math.random()`
  // call below (packet C3, AGENTS.md's "Charts 3D" "Website" "Tray" — "Random
  // can land on a surface"), rather than a separate pre-check ahead of this
  // function: a second, earlier `Math.random()` draw would silently shift
  // every mocked call sequence this page's own Random tests pin (`vi.spyOn
  // (Math, "random").mockReturnValueOnce(...)`), including one keyed to the
  // exact pool INDEX of the first remote entry. Appended AFTER the remote
  // entries for the same reason — inserting earlier would renumber every
  // existing index-based fixture.
  | { readonly kind: "chart3d"; readonly id: string };

function chartsRandomDatasetPickKey(pick: ChartsRandomDatasetPick): string {
  if (pick.kind === "dataset") return `dataset:${pick.id}`;
  if (pick.kind === "chart3d") return `chart3d:${pick.id}`;
  return `remote:${pick.hit.ref}`;
}

const CHARTS_RANDOM_DATASET_POOL: readonly ChartsRandomDatasetPick[] = [
  ...CHARTS_DATASETS.map((dataset): ChartsRandomDatasetPick => ({ kind: "dataset", id: dataset.id })),
  ...CHARTS_REMOTE_DATASET_INDEX.map((hit): ChartsRandomDatasetPick => ({ kind: "remote", hit })),
  ...CHARTS_3D_DATASETS.map((dataset): ChartsRandomDatasetPick => ({ kind: "chart3d", id: dataset.id })),
];

/**
 * Uniform pick over the combined built-in + curated-Hugging-Face pool,
 * excluding `excludeKey` (the currently loaded dataset's own
 * `dataSourceKey`, when there is one) so Random always lands on something
 * different — mirrors `randomChartsDatasetId`'s own `excludeId` contract
 * (falling back to the full pool only if excluding would leave nothing,
 * which never happens at 46+ entries), widened to a pool that isn't all one
 * kind. The caller (`ChartsWorkbench.tsx`'s `handleRandomDataset`) routes a
 * `"dataset"` pick through the existing `select-dataset` action, a
 * `"remote"` pick through `loadRemoteDataset` (which draws that dataset's
 * top-ranked chart), and a `"chart3d"` pick through `select-3d-dataset`
 * (AGENTS.md's "Charts" "Data layer" "Random"; "Charts 3D" "Website" "Tray").
 */
export function randomChartsDatasetPick(excludeKey?: string): ChartsRandomDatasetPick {
  const pool = excludeKey ? CHARTS_RANDOM_DATASET_POOL.filter((pick) => chartsRandomDatasetPickKey(pick) !== excludeKey) : CHARTS_RANDOM_DATASET_POOL;
  const candidates = pool.length > 0 ? pool : CHARTS_RANDOM_DATASET_POOL;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? CHARTS_RANDOM_DATASET_POOL[0]!;
}
