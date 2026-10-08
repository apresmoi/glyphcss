/**
 * `/diagrams`' graph-dataset SEARCH: turning a typed query into a ranked
 * list of {@link DatasetHit}s that plausibly load through
 * `graphDatasetLoad.ts` — the graph analogue of `datasetSearch.ts`'s
 * tabular search (packet D5). Reuses `DatasetHit` and
 * `parseDatasetHitFromQuery` from `datasetSearch.ts` directly (both are
 * already dataset-shape-agnostic: a hit is just an id/title/url, and a
 * pasted `org/name` id recognizes any Hugging Face dataset, not only a
 * tabular one) — only the LIVE SEARCH query itself differs, since a graph
 * dataset needs a different filter than `isLikelyTabularHit`'s tag
 * heuristic.
 *
 * ## Where this searches
 *
 * The same public, unauthenticated `https://huggingface.co/api/datasets`
 * search endpoint, narrowed server-side with `filter=task_categories:
 * graph-ml` — verified live (2026-09-15): `?search=protein&filter=
 * task_categories:graph-ml` returns exactly `graphs-datasets/PROTEINS`
 * ahead of an unrelated protein dataset the plain `search=` query alone
 * also returns. This is the SAME "graphs-datasets/graph-tagged" scoping the
 * task brief asked for, expressed as one query parameter rather than a
 * client-side tag re-filter.
 */
import type { DatasetHit } from "../../../services/datasets/datasetSearch";
export { parseDatasetHitFromQuery, type DatasetHit } from "../../../services/datasets/datasetSearch";

const GRAPH_DATASET_SEARCH_ENDPOINT = "https://huggingface.co/api/datasets";
export const GRAPH_DATASET_SEARCH_FETCH_LIMIT = 50;
export const GRAPH_DATASET_SEARCH_RESULT_LIMIT = 8;

export type GraphDatasetSearchFetch = (url: string, signal?: AbortSignal) => Promise<unknown>;

async function fetchSearchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Hugging Face responded ${res.status}.`);
  return res.json();
}

export interface GraphDatasetSearchOptions {
  readonly fetchJson?: GraphDatasetSearchFetch;
  readonly signal?: AbortSignal;
  readonly limit?: number;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function firstLine(description: unknown): string | undefined {
  const raw = text(description);
  if (!raw) return undefined;
  const line = raw
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line || undefined;
}

function toGraphHit(entry: unknown): DatasetHit | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  if (e.private === true || e.gated === true || e.disabled === true) return null;
  const id = text(e.id);
  if (!id) return null;
  const tags = Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === "string") : [];
  const cardData = e.cardData && typeof e.cardData === "object" ? (e.cardData as Record<string, unknown>) : {};
  const licenceTag = tags.find((t) => t.startsWith("license:"));
  return {
    id,
    kind: "hf",
    ref: id,
    title: text(cardData.pretty_name) || id,
    description: firstLine(e.description),
    downloads: typeof e.downloads === "number" ? e.downloads : undefined,
    likes: typeof e.likes === "number" ? e.likes : undefined,
    tags,
    url: `https://huggingface.co/datasets/${id}`,
    licence: licenceTag ? licenceTag.slice("license:".length) : undefined,
  };
}

/**
 * Live search against the Hugging Face Hub, narrowed to `task_categories:
 * graph-ml`-tagged datasets and ranked by downloads. Never throws — a
 * network failure or a malformed body resolves to an EMPTY array (the
 * caller's curated `remoteGraphIndex.ts` suggestions are the offline
 * fallback, mirroring `searchDatasets`'s own contract). A hit passing this
 * filter is not guaranteed to actually load as a graph — `graphDatasetLoad.ts`'s
 * own `"not-graph"` failure kind is the real verification, same as a
 * tabular hit's own load-time check.
 */
export async function searchGraphDatasets(
  query: string,
  options: GraphDatasetSearchOptions = {},
): Promise<readonly DatasetHit[]> {
  const q = query.trim();
  if (!q) return [];
  const load = options.fetchJson ?? fetchSearchJson;
  const url = `${GRAPH_DATASET_SEARCH_ENDPOINT}?search=${encodeURIComponent(q)}&filter=${encodeURIComponent("task_categories:graph-ml")}&limit=${GRAPH_DATASET_SEARCH_FETCH_LIMIT}&sort=downloads&direction=-1&full=true`;
  let body: unknown;
  try {
    body = await load(url, options.signal);
  } catch {
    return [];
  }
  if (!Array.isArray(body)) return [];
  const hits = body.map(toGraphHit).filter((h): h is DatasetHit => h !== null);
  hits.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
  return hits.slice(0, options.limit ?? GRAPH_DATASET_SEARCH_RESULT_LIMIT);
}
