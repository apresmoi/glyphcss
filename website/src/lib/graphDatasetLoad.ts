/**
 * Graph-dataset LOAD: turning a Hugging Face `graphs-datasets` id into a
 * `GlyphGraph` `/diagrams` can render — the graph analogue of
 * `datasetLoad.ts`'s tabular loader (packet D5, AGENTS.md's "Diagrams" —
 * mirrors "Charts" "Data layer"). Pure except one injected transport seam
 * (`fetch`); every failure mode is a structured `{ ok: false, kind, error }`,
 * never a throw into React — the same contract `datasetLoad.ts` documents.
 *
 * ## Where this reads
 *
 * The `graphs-datasets` Hugging Face org (verified live, 2026-09-15) serves
 * one graph per ROW through the public, unauthenticated
 * `datasets-server.huggingface.co` `/splits` + `/rows` service — the same
 * dataset-viewer backend `datasetLoad.ts`'s own rows path already uses, so
 * every row arrives as plain JSON with no client-side Parquet/Arrow
 * decoding. A row carries:
 *
 *  - `edge_index`: `[[src, ...], [dst, ...]]` — column-major edge pairs.
 *    Verified live on MUTAG/ZINC/AIDS/twitch_egos/deezer_ego_nets/
 *    reddit_threads/IMDB-BINARY: an undirected relationship is typically
 *    stored as BOTH `(a, b)` and `(b, a)`, which this module dedupes down
 *    to one `GlyphGraphEdge`, reporting the count removed.
 *  - `num_nodes`: the graph's node count.
 *  - `node_feat` (optional): per-node features — a one-hot atom-type vector
 *    for a molecule dataset, absent for a plain social/ego-net graph.
 *  - `edge_attr` (optional): per-edge features. Not surfaced today — a
 *    `GlyphGraphEdge` has no numeric-feature slot, only `label`/`style`.
 *  - `y`: the graph's own label (a classification integer or a regression
 *    float), recorded into the returned {@link GraphDatasetLoadOk.label}.
 *
 * ## Node labelling
 *
 * `node_feat`'s own one-hot ORDER is a modelling convention, not something
 * `datasets-server` states — and, checked live against both cards this
 * module curates a vocabulary for, neither HF dataset card documents it
 * either (both show only shapes/dtypes). MUTAG's card explicitly says its
 * graphs come from "the PyGeometric version of the dataset provided by
 * OGB", which is the canonical TU Dortmund 7-way atom order (C, N, O, F, I,
 * Cl, Br) used by every GNN benchmark suite — kept here on that strength.
 * ZINC's atom code (a single integer per node, not a one-hot vector) has no
 * such anchor on ITS card, and guessing a 28-way chemistry vocabulary wrong
 * would mislabel every atom silently — so ZINC nodes fall back to their
 * bare index, same as every other dataset with no documented vocabulary.
 *
 * ## Size budget
 *
 * A raw row can be far larger than a legible diagram — `deezer_ego_nets`
 * averages 287 nodes. {@link GRAPH_DATASET_NODE_CAP} truncates to the first
 * `cap` node indices (dropping every edge that touches a dropped node) and
 * reports `simplified: true` with the original counts, so a caller can say
 * so in the rail. `loadRandomGraphDatasetRow` additionally RETRIES a few
 * different row indices before accepting a truncation, so a random pick
 * only simplifies when the dataset genuinely has no small graph nearby —
 * `loadGraphDatasetRow` itself never retries (a specific `rowIdx`, from a
 * `?d=` link or a search-box "Load X" pick, must resolve to THAT row,
 * truncated if it has to be, not a different one).
 */
import type { GlyphGraph, GlyphGraphEdge, GlyphGraphNode } from "@glyphcss/diagrams";

const HF_SPLITS_ENDPOINT = "https://datasets-server.huggingface.co/splits";
const HF_ROWS_ENDPOINT = "https://datasets-server.huggingface.co/rows";

/** Sized off what was actually measured (`docs/design/diagrams.md`'s "D5"
 *  section): the 2D engine's own 9-node/12-edge budget before it reaches
 *  for compaction, and past it a `split` fallback that renders as a wall of
 *  one-edge-per-page fragments rather than one legible picture — verified
 *  by rendering real MUTAG rows through `renderGlyphDiagram` at 13 nodes.
 *  40 nodes is comfortably inside every curated molecule's own average
 *  (MUTAG 18, AIDS 15.6, ZINC 23.2) while still excluding
 *  `deezer_ego_nets`' much larger ego-nets (avg 287) from an unsimplified
 *  render. */
export const GRAPH_DATASET_NODE_CAP = 40;
/** How many different row indices `loadRandomGraphDatasetRow` tries before
 *  accepting a truncated (simplified) graph. */
const GRAPH_DATASET_RANDOM_ROW_ATTEMPTS = 5;
/** `datasets-server`'s own per-request row cap — one row is all this module
 *  ever asks for, so this is only the ceiling `offset` may reach. */
const HF_ROWS_PAGE_SIZE = 100;

export interface GraphDatasetSource {
  readonly name: string;
  readonly url: string;
}

export interface GraphDatasetRowOk {
  readonly ok: true;
  readonly graph: GlyphGraph;
  readonly rowIdx: number;
  readonly totalRows: number;
  /** The row's own `y` field, formatted for display (`"1"`, `"0, 1"`, a
   *  rounded float) — `undefined` when the row carries no `y` at all. */
  readonly label: string | undefined;
  /** `true` when {@link GRAPH_DATASET_NODE_CAP} truncated this graph. */
  readonly simplified: boolean;
  readonly originalNodeCount: number;
  readonly originalEdgeCount: number;
  /** How many `edge_index` columns were dropped as an undirected mirror of
   *  an edge already kept (this module's own "say so" — see the file doc). */
  readonly dedupedMirrorEdges: number;
  readonly source: GraphDatasetSource;
}
export type GraphDatasetLoadResult =
  | GraphDatasetRowOk
  | { readonly ok: false; readonly kind: "gated" | "not-found" | "network" | "not-graph" | "row-not-found"; readonly error: string };

/** The transport seam — defaults to a real `fetch`; injected by tests,
 *  which must never touch the network. Mirrors `datasetLoad.ts`'s
 *  `DatasetLoadFetch` shape. */
export type GraphDatasetLoadFetch = (url: string, init?: { signal?: AbortSignal }) => Promise<{ readonly ok: boolean; readonly status: number; text(): Promise<string> }>;

export interface GraphDatasetLoadOptions {
  readonly fetch?: GraphDatasetLoadFetch;
  readonly signal?: AbortSignal;
}

export function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/** Best-effort one-hot atom vocabularies for a curated few graph datasets —
 *  see the file doc's "Node labelling" section for why only MUTAG gets one. */
const GRAPH_NODE_LABEL_VOCAB: Readonly<Record<string, readonly string[]>> = {
  "graphs-datasets/MUTAG": ["C", "N", "O", "F", "I", "Cl", "Br"],
};

function nodeLabel(index: number, vocab: readonly string[] | undefined, nodeFeat: readonly (readonly number[])[] | undefined): string {
  const feat = vocab && nodeFeat ? nodeFeat[index] : undefined;
  if (feat) {
    const oneHotIndex = feat.findIndex((v) => v === 1);
    const symbol = oneHotIndex >= 0 ? vocab![oneHotIndex] : undefined;
    if (symbol) return symbol;
  }
  return String(index);
}

function formatGraphDatasetLabel(y: unknown): string | undefined {
  if (y === null || y === undefined) return undefined;
  const values = Array.isArray(y) ? y : [y];
  const parts = values
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
    .map((v) => (Number.isInteger(v) ? String(v) : v.toFixed(3)));
  return parts.length > 0 ? parts.join(", ") : undefined;
}

interface RawGraphRow {
  readonly edge_index?: unknown;
  readonly num_nodes?: unknown;
  readonly node_feat?: unknown;
  readonly y?: unknown;
}

function isFiniteNumberArray(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.every((v) => typeof v === "number" && Number.isFinite(v));
}

/** Validates and maps one raw `datasets-server` row into a `GlyphGraph`,
 *  applying the node cap and the undirected-mirror dedupe described in the
 *  file doc. `null` (never a throw) when the row doesn't have the shape a
 *  graph dataset row must — a caller reports `"not-graph"`. */
function graphDatasetRowToGraph(ref: string, row: RawGraphRow, cap: number): { readonly graph: GlyphGraph; readonly simplified: boolean; readonly originalNodeCount: number; readonly originalEdgeCount: number; readonly dedupedMirrorEdges: number } | null {
  const numNodes = row.num_nodes;
  if (typeof numNodes !== "number" || !Number.isFinite(numNodes) || numNodes <= 0) return null;
  const edgeIndex = row.edge_index;
  if (!Array.isArray(edgeIndex) || edgeIndex.length !== 2 || !isFiniteNumberArray(edgeIndex[0]) || !isFiniteNumberArray(edgeIndex[1]) || edgeIndex[0].length !== edgeIndex[1].length) return null;
  const srcs = edgeIndex[0], dsts = edgeIndex[1];

  const nodeFeatRaw = row.node_feat;
  const nodeFeat = Array.isArray(nodeFeatRaw) && nodeFeatRaw.every((f) => isFiniteNumberArray(f)) ? (nodeFeatRaw as readonly (readonly number[])[]) : undefined;
  const vocab = GRAPH_NODE_LABEL_VOCAB[ref];

  const keepNodeCount = Math.min(numNodes, cap);
  const nodes: GlyphGraphNode[] = [];
  for (let i = 0; i < keepNodeCount; i++) nodes.push({ id: String(i), label: nodeLabel(i, vocab, nodeFeat) });

  const seen = new Set<string>();
  const edges: GlyphGraphEdge[] = [];
  let dedupedMirrorEdges = 0;
  for (let i = 0; i < srcs.length; i++) {
    const s = srcs[i]!, d = dsts[i]!;
    if (!Number.isInteger(s) || !Number.isInteger(d) || s < 0 || d < 0) continue;
    if (s >= keepNodeCount || d >= keepNodeCount) continue; // dropped by the node cap
    const key = s <= d ? `${s}:${d}` : `${d}:${s}`;
    if (seen.has(key)) { dedupedMirrorEdges++; continue; }
    seen.add(key);
    edges.push({ from: String(s), to: String(d) });
  }

  return {
    graph: { nodes, edges, direction: "LR" },
    simplified: numNodes > cap,
    originalNodeCount: numNodes,
    originalEdgeCount: srcs.length,
    dedupedMirrorEdges,
  };
}

interface ResolvedGraphSplit { readonly config: string; readonly split: string }

async function resolveGraphDatasetSplit(ref: string, options: GraphDatasetLoadOptions): Promise<{ readonly ok: true; readonly split: ResolvedGraphSplit } | { readonly ok: false; readonly result: Extract<GraphDatasetLoadResult, { ok: false }> }> {
  const load = options.fetch ?? ((u, init) => fetch(u, init));
  let res: Awaited<ReturnType<GraphDatasetLoadFetch>>;
  try {
    res = await load(`${HF_SPLITS_ENDPOINT}?dataset=${encodeURIComponent(ref)}`, { signal: options.signal });
  } catch (error) {
    if (isAbort(error)) throw error;
    return { ok: false, result: { ok: false, kind: "network", error: "Could not reach Hugging Face." } };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, result: { ok: false, kind: "gated", error: `"${ref}" needs a Hugging Face account/token — not supported here.` } };
  if (res.status === 404) return { ok: false, result: { ok: false, kind: "not-found", error: `"${ref}" was not found on Hugging Face.` } };
  if (!res.ok) return { ok: false, result: { ok: false, kind: "network", error: `Hugging Face responded ${res.status}.` } };
  let body: unknown;
  try { body = JSON.parse(await res.text()); } catch { return { ok: false, result: { ok: false, kind: "not-graph", error: `"${ref}" has no readable split listing.` } }; }
  const splits = body && typeof body === "object" ? (body as Record<string, unknown>).splits : undefined;
  const first = Array.isArray(splits) ? splits[0] : undefined;
  const config = first && typeof first === "object" ? (first as Record<string, unknown>).config : undefined;
  const split = first && typeof first === "object" ? (first as Record<string, unknown>).split : undefined;
  if (typeof config !== "string" || typeof split !== "string") return { ok: false, result: { ok: false, kind: "not-graph", error: `"${ref}" has no usable split.` } };
  return { ok: true, split: { config, split } };
}

async function fetchGraphDatasetRow(ref: string, split: ResolvedGraphSplit, rowIdx: number, options: GraphDatasetLoadOptions): Promise<{ readonly ok: true; readonly row: RawGraphRow; readonly totalRows: number } | { readonly ok: false; readonly result: Extract<GraphDatasetLoadResult, { ok: false }> }> {
  const load = options.fetch ?? ((u, init) => fetch(u, init));
  const offset = Math.max(0, Math.min(rowIdx, HF_ROWS_PAGE_SIZE * 100000));
  const url = `${HF_ROWS_ENDPOINT}?dataset=${encodeURIComponent(ref)}&config=${encodeURIComponent(split.config)}&split=${encodeURIComponent(split.split)}&offset=${offset}&length=1`;
  let res: Awaited<ReturnType<GraphDatasetLoadFetch>>;
  try {
    res = await load(url, { signal: options.signal });
  } catch (error) {
    if (isAbort(error)) throw error;
    return { ok: false, result: { ok: false, kind: "network", error: "Could not reach Hugging Face." } };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, result: { ok: false, kind: "gated", error: `"${ref}" needs a Hugging Face account/token — not supported here.` } };
  if (!res.ok) return { ok: false, result: { ok: false, kind: "network", error: `Hugging Face responded ${res.status}.` } };
  let body: unknown;
  try { body = JSON.parse(await res.text()); } catch { return { ok: false, result: { ok: false, kind: "not-graph", error: `"${ref}" returned an unreadable response.` } }; }
  if (!body || typeof body !== "object") return { ok: false, result: { ok: false, kind: "not-graph", error: `"${ref}" returned an unreadable response.` } };
  const rows = (body as Record<string, unknown>).rows;
  const totalRows = (body as Record<string, unknown>).num_rows_total;
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, result: { ok: false, kind: "row-not-found", error: `Row ${rowIdx} of "${ref}" was not found.` } };
  const row = (rows[0] as Record<string, unknown> | null)?.row;
  if (!row || typeof row !== "object") return { ok: false, result: { ok: false, kind: "not-graph", error: `Row ${rowIdx} of "${ref}" has no usable data.` } };
  return { ok: true, row: row as RawGraphRow, totalRows: typeof totalRows === "number" ? totalRows : offset + 1 };
}

/**
 * Loads a SPECIFIC row of a `graphs-datasets`-shaped Hugging Face dataset —
 * the entry point for a `?d=` remote-graph link (a pinned `rowIdx`) and for
 * a search-box "Load X" pick (row 0). Never retries a different row: the
 * caller asked for THIS one, so an oversized graph is truncated and
 * reported via `simplified` rather than silently swapped for another.
 */
export async function loadGraphDatasetRow(ref: string, rowIdx: number, options: GraphDatasetLoadOptions = {}): Promise<GraphDatasetLoadResult> {
  const resolvedSplit = await resolveGraphDatasetSplit(ref, options);
  if (!resolvedSplit.ok) return resolvedSplit.result;
  const fetched = await fetchGraphDatasetRow(ref, resolvedSplit.split, rowIdx, options);
  if (!fetched.ok) return fetched.result;
  const mapped = graphDatasetRowToGraph(ref, fetched.row, GRAPH_DATASET_NODE_CAP);
  if (!mapped) return { ok: false, kind: "not-graph", error: `Row ${rowIdx} of "${ref}" isn't shaped like a graph (no edge_index/num_nodes).` };
  return {
    ok: true, graph: mapped.graph, rowIdx, totalRows: fetched.totalRows,
    label: formatGraphDatasetLabel(fetched.row.y), simplified: mapped.simplified,
    originalNodeCount: mapped.originalNodeCount, originalEdgeCount: mapped.originalEdgeCount,
    dedupedMirrorEdges: mapped.dedupedMirrorEdges,
    source: { name: ref, url: `https://huggingface.co/datasets/${ref}` },
  };
}

/**
 * Random's own pick within `ref` (see the file doc's "Size budget"): tries
 * up to {@link GRAPH_DATASET_RANDOM_ROW_ATTEMPTS} different row indices,
 * keeping the first one that fits under {@link GRAPH_DATASET_NODE_CAP}
 * unsimplified; if every attempt is oversized (a dataset like
 * `deezer_ego_nets`, whose average graph already exceeds the cap), the LAST
 * attempt is returned truncated rather than failing outright — a Random
 * click always lands on something, simplified or not.
 */
export async function loadRandomGraphDatasetRow(ref: string, options: GraphDatasetLoadOptions = {}): Promise<GraphDatasetLoadResult> {
  const resolvedSplit = await resolveGraphDatasetSplit(ref, options);
  if (!resolvedSplit.ok) return resolvedSplit.result;
  // Row 0 also tells us `totalRows`, which nothing else can — datasets-server
  // reports it only alongside real row data, never as a cheap standalone count.
  const probe = await fetchGraphDatasetRow(ref, resolvedSplit.split, 0, options);
  if (!probe.ok) return probe.result;
  const totalRows = probe.totalRows;
  let best: { readonly row: RawGraphRow; readonly rowIdx: number } = { row: probe.row, rowIdx: 0 };
  let bestFits = false;
  for (let attempt = 0; attempt < GRAPH_DATASET_RANDOM_ROW_ATTEMPTS && !bestFits; attempt++) {
    const rowIdx = attempt === 0 ? 0 : Math.floor(Math.random() * totalRows);
    const fetched = rowIdx === 0 ? probe : await fetchGraphDatasetRow(ref, resolvedSplit.split, rowIdx, options);
    if (!fetched.ok) continue; // keep trying other indices rather than failing the whole pick on one bad row
    const numNodes = typeof fetched.row.num_nodes === "number" ? fetched.row.num_nodes : Infinity;
    best = { row: fetched.row, rowIdx };
    bestFits = numNodes <= GRAPH_DATASET_NODE_CAP;
  }
  const mapped = graphDatasetRowToGraph(ref, best.row, GRAPH_DATASET_NODE_CAP);
  if (!mapped) return { ok: false, kind: "not-graph", error: `"${ref}" isn't shaped like a graph (no edge_index/num_nodes).` };
  return {
    ok: true, graph: mapped.graph, rowIdx: best.rowIdx, totalRows,
    label: formatGraphDatasetLabel(best.row.y), simplified: mapped.simplified,
    originalNodeCount: mapped.originalNodeCount, originalEdgeCount: mapped.originalEdgeCount,
    dedupedMirrorEdges: mapped.dedupedMirrorEdges,
    source: { name: ref, url: `https://huggingface.co/datasets/${ref}` },
  };
}
