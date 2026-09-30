// Random's own combined dataset pool for `/charts`' data overlay
// (AGENTS.md's "Charts" — "Data layer" — "Random"): the 16 built-in
// datasets PLUS the curated Hugging Face ids (`datasets/remoteIndex.ts`,
// already verified to load and chart) PLUS the vendored 3D presets — NEVER
// raw live search results, which are unverified and can 404, be gated, or
// turn out to have no chartable column at all (`datasets/remoteIndex.ts`'s
// own P2-3 doc: the three ids it dropped all "loaded" but charted nothing).
// Uniform over the union, excluding whatever is currently loaded so Random
// always lands on something different — the SAME exclusion-key SHAPE
// `chartsWorkbenchState.ts`'s own `dataSourceKey` uses (`dataset:<id>` /
// `remote:<ref>`), so a caller passes `dataSourceKey(state.data.source)`
// straight through as `excludeKey`.
//
// The page's COLD-MOUNT pick stays built-in only (`randomChartsDatasetId`,
// `datasets/index.ts`) — instant, no network on first paint — so this
// wider pool is the Random BUTTON's own, never the mount path's.
import type { DatasetHit } from "../../../services/datasets/datasetSearch";
import { CHARTS_3D_DATASETS } from "../data/chart3d/index";
import { CHARTS_3D_REMOTE_DATASET_INDEX } from "../data/chart3dRemoteIndex";
import { CHARTS_DATASETS } from "../data/index";
import { CHARTS_REMOTE_DATASET_INDEX } from "../data/remoteIndex";

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
  | { readonly kind: "chart3d"; readonly id: string }
  // Packet C6 — a curated Hugging Face table verified to fit a 3D chart
  // (`chartsBestFit3dFromRows` at load time), APPENDED after `chart3d` for
  // the same "never renumber an earlier fixture's index" reason.
  | { readonly kind: "chart3d-remote"; readonly hit: DatasetHit };

function chartsRandomDatasetPickKey(pick: ChartsRandomDatasetPick): string {
  if (pick.kind === "dataset") return `dataset:${pick.id}`;
  if (pick.kind === "chart3d") return `chart3d:${pick.id}`;
  // `"remote"` and `"chart3d-remote"` share ONE key namespace deliberately —
  // both name the same Hugging Face `ref`, just bound to a different chart
  // shape, and there is no separate "currently loaded" tracking for an
  // inline-sourced 3D table to key against anyway (mirrors the "Surface"
  // inline-from-local-table fit's own no-dedup-tracking precedent).
  return `remote:${pick.hit.ref}`;
}

const CHARTS_RANDOM_DATASET_POOL: readonly ChartsRandomDatasetPick[] = [
  ...CHARTS_DATASETS.map((dataset): ChartsRandomDatasetPick => ({ kind: "dataset", id: dataset.id })),
  ...CHARTS_REMOTE_DATASET_INDEX.map((hit): ChartsRandomDatasetPick => ({ kind: "remote", hit })),
  ...CHARTS_3D_DATASETS.map((dataset): ChartsRandomDatasetPick => ({ kind: "chart3d", id: dataset.id })),
  ...CHARTS_3D_REMOTE_DATASET_INDEX.map((hit): ChartsRandomDatasetPick => ({ kind: "chart3d-remote", hit })),
];
/** The `dimension: "3d"` subset — every pick that resolves to (or can
 *  become) a 3D chart, i.e. every kind but plain 2D `"dataset"`/`"remote"`
 *  entries. Precomputed once, not filtered per call, since the pool itself
 *  never changes at runtime. */
const CHARTS_RANDOM_DATASET_POOL_3D: readonly ChartsRandomDatasetPick[] = CHARTS_RANDOM_DATASET_POOL.filter(
  (pick) => pick.kind === "chart3d" || pick.kind === "chart3d-remote",
);

/**
 * Uniform pick over the combined built-in + curated-Hugging-Face (+ 3D)
 * pool, excluding `excludeKey` (the currently loaded dataset's own
 * `dataSourceKey`, when there is one) so Random always lands on something
 * different — mirrors `randomChartsDatasetId`'s own `excludeId` contract
 * (falling back to the full pool only if excluding would leave nothing,
 * which never happens at this pool's size), widened to a pool that isn't
 * all one kind. `dimension` (packet C6, coordinator's own "Random in 3D
 * picks from 3D-fitting datasets only" instruction): `"3d"` narrows the
 * pool to `chart3d`/`chart3d-remote` picks ONLY, so Random never bounces a
 * reader who is looking at a 3D chart back to a 2D one; `"2d"` (the
 * default, and every EXISTING call site's own behaviour, unchanged) keeps
 * drawing from the FULL combined pool — a 2D reader's Random can still land
 * on a 3D dataset, exactly as it always could. The caller
 * (`ChartsWorkbench.tsx`'s `handleRandomDataset`) routes a `"dataset"` pick
 * through the existing `select-dataset` action, a `"remote"` pick through
 * `loadRemoteDataset` (which draws that dataset's top-ranked chart), a
 * `"chart3d"` pick through `select-3d-dataset`, and a `"chart3d-remote"`
 * pick through `loadRemote3dDataset`.
 */
export function randomChartsDatasetPick(excludeKey?: string, dimension: "2d" | "3d" = "2d"): ChartsRandomDatasetPick {
  const basePool = dimension === "3d" ? CHARTS_RANDOM_DATASET_POOL_3D : CHARTS_RANDOM_DATASET_POOL;
  const pool = excludeKey ? basePool.filter((pick) => chartsRandomDatasetPickKey(pick) !== excludeKey) : basePool;
  const candidates = pool.length > 0 ? pool : basePool;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? basePool[0]!;
}
