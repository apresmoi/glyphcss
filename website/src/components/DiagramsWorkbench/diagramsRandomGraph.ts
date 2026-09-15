// Random's own combined graph pool for `/diagrams`' data overlay (packet
// D5, mirroring `ChartsWorkbench/chartsRandomDataset.ts`): every built-in
// preset (`GLYPH_DIAGRAM_WORKBENCH_PRESETS`, 2D and 3D examples alike —
// charts' own Random pool includes its 3D presets too, this file's the
// same call) PLUS the curated Hugging Face graph datasets
// (`datasets/remoteGraphIndex.ts`, already verified to load) — never raw
// live Hugging Face search results, which are unverified. Uniform over the
// union, excluding whatever is currently loaded so Random always lands on
// something different.
import type { DatasetHit } from "../../lib/graphDatasetSearch";
import { GLYPH_DIAGRAM_WORKBENCH_PRESETS } from "./diagramsWorkbenchState";
import { DIAGRAMS_REMOTE_GRAPH_INDEX } from "./datasets/remoteGraphIndex";

export type DiagramsRandomGraphPick =
  | { readonly kind: "preset"; readonly id: string }
  | { readonly kind: "remote"; readonly hit: DatasetHit };

function diagramsRandomGraphPickKey(pick: DiagramsRandomGraphPick): string {
  return pick.kind === "preset" ? `preset:${pick.id}` : `remote:${pick.hit.ref}`;
}

const DIAGRAMS_RANDOM_GRAPH_POOL: readonly DiagramsRandomGraphPick[] = [
  ...GLYPH_DIAGRAM_WORKBENCH_PRESETS.map((preset): DiagramsRandomGraphPick => ({ kind: "preset", id: preset.id })),
  ...DIAGRAMS_REMOTE_GRAPH_INDEX.map((hit): DiagramsRandomGraphPick => ({ kind: "remote", hit })),
];

/**
 * Uniform pick over the combined built-in + curated-Hugging-Face pool,
 * excluding `excludeKey` (the currently loaded graph's own identity —
 * `preset:<id>` or `remote:<ref>`, mirroring `chartsRandomDataset.ts`'s
 * `dataSourceKey` shape) so Random always lands on something different.
 */
export function randomDiagramsGraphPick(excludeKey?: string): DiagramsRandomGraphPick {
  const pool = excludeKey ? DIAGRAMS_RANDOM_GRAPH_POOL.filter((pick) => diagramsRandomGraphPickKey(pick) !== excludeKey) : DIAGRAMS_RANDOM_GRAPH_POOL;
  const candidates = pool.length > 0 ? pool : DIAGRAMS_RANDOM_GRAPH_POOL;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? DIAGRAMS_RANDOM_GRAPH_POOL[0]!;
}

/** `state.graphSource`'s own identity string — the exclusion key
 *  `randomDiagramsGraphPick` needs, and what a `select-remote-graph`/
 *  `apply-preset` dispatch's own `graphSource` payload resolves to. */
export function diagramsGraphSourceKey(source: { readonly kind: "builtin"; readonly presetId: string } | { readonly kind: "remote"; readonly ref: string } | undefined): string {
  if (!source) return "";
  return source.kind === "builtin" ? `preset:${source.presetId}` : `remote:${source.ref}`;
}
