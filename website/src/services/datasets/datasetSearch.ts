/**
 * `/charts`' dataset SEARCH: turning a typed query, or a pasted URL/id,
 * into a ranked list of {@link DatasetHit}s a reader can load — the remote
 * half of the Data folder's dataset picker (AGENTS.md's "Charts" — "Data
 * layer"), mirroring `MapsWorkbench/mapsGeocode.ts`'s own shape: pure
 * except for one injected transport seam, everything with a right answer
 * (what the request looks like, what the response means, what "tabular"
 * means for a search hit) decided here where a test can reach it without
 * mounting anything or touching the network.
 *
 * ## Where this searches
 *
 * The Hugging Face Hub's public, UNAUTHENTICATED datasets search —
 * `https://huggingface.co/api/datasets?search=<q>` — no API key, no
 * registration, `Access-Control-Allow-Origin: *`. Hugging Face hosts
 * hundreds of thousands of datasets; almost all of them are NOT tabular
 * (image sets, audio corpora, raw text corpora for language-model
 * pretraining), so a hit is filtered to ones the Hub's own tags claim are
 * tabular ({@link isLikelyTabularHit}) before it's ever shown, and ranked by
 * `downloads` — the Hub's own popularity signal, and the only ranking a
 * public search endpoint gives for free.
 *
 * ## What a pasted string can mean
 *
 * A reader may paste a URL or type a bare id instead of searching by name;
 * {@link parseDatasetHitFromQuery} recognizes three shapes with NO network
 * call at all (`lib/datasetLoad.ts` is what actually fetches):
 *
 *  - a raw GitHub file URL (`raw.githubusercontent.com/.../file.csv|json|tsv`)
 *  - a Hugging Face resolve URL (`huggingface.co/datasets/<org>/<name>/resolve/<rev>/<file>`)
 *  - a bare Hugging Face dataset id (`"org/name"`)
 *
 * Neither URL shape is authenticated or private-account-specific — both are
 * the same public CDN paths a browser's own address bar would reach.
 */

/** A candidate a reader can load, from either a live search or a parsed paste — what `ChartsDatasetSearchBox` renders one row for and `lib/datasetLoad.ts` resolves into rows. */
export interface DatasetHit {
  /** Stable identity for a list key / de-dup — the same value as `ref` for every kind here, kept separate because a future hit source (a second index) might not share that. */
  readonly id: string;
  readonly kind: "hf" | "url";
  /** What `select-remote-dataset` stores as `data.source.ref`, and what a `?c=` decode re-fetches with: a Hugging Face dataset id (`"org/name"`) for `kind: "hf"`, the exact URL for `kind: "url"`. */
  readonly ref: string;
  readonly title: string;
  readonly description?: string;
  readonly downloads?: number;
  readonly likes?: number;
  readonly tags?: readonly string[];
  /** Where a reader can see the dataset's own page/file — the dataset card's credit link. */
  readonly url: string;
  readonly licence?: string;
}

/** Hugging Face's public search endpoint. No key, no auth header. */
export const DATASET_SEARCH_ENDPOINT = "https://huggingface.co/api/datasets";

/** How many rows the Hub is asked for before local filtering/ranking — generous, since most hits get filtered out as non-tabular. */
export const DATASET_SEARCH_FETCH_LIMIT = 50;

/** How many rows `searchDatasets` returns after filtering/ranking, by default. */
export const DATASET_SEARCH_RESULT_LIMIT = 8;

/**
 * Tag EVIDENCE, split into two kinds, per REVIEW-arc-density-search-opus.md
 * (P2-2) — measured live: `format:parquet` is the Hub's own auto-conversion
 * tag and rides on essentially every modern dataset regardless of modality
 * (query `"cats images"` on the real Hub returned 4 pure image-folder
 * datasets tagged `format:parquet` + `modality:image`, 16 of 17 hits passing
 * the OLD filter), so a `format:*`/`task_categories:tabular*` tag alone is
 * evidence FOR tabular but not proof — a co-occurring `modality:*` tag that
 * names a non-tabular medium overrides it. Only `modality:tabular` or a
 * `task_categories:tabular*` tag is STRONG evidence (never overridden).
 * `size_categories` (row-count bucket) carries NO signal about shape at
 * all and is no longer read here — it used to accept a hit on its own,
 * which is how the image-folder query's 17th hit passed.
 */
const TABULAR_STRONG_TAG_PREFIXES = ["modality:tabular", "task_categories:tabular"];
const TABULAR_WEAK_TAG_PREFIXES = ["format:csv", "format:json", "format:parquet"];
const NON_TABULAR_MODALITY_TAGS = ["modality:image", "modality:audio", "modality:video", "modality:text-only"];

function isLikelyTabularHit(tags: readonly string[]): boolean {
  if (tags.some((tag) => TABULAR_STRONG_TAG_PREFIXES.some((prefix) => tag.startsWith(prefix)))) return true;
  const hasWeakEvidence = tags.some((tag) => TABULAR_WEAK_TAG_PREFIXES.some((prefix) => tag.startsWith(prefix)));
  if (!hasWeakEvidence) return false;
  return !tags.some((tag) => NON_TABULAR_MODALITY_TAGS.includes(tag));
}

/** The transport seam — defaults to `fetch` + a status check + `json()`; injected by tests, which must never touch the network. Mirrors `MapsWorkbench/mapsGeocode.ts`'s `MapGeocodeFetch`. */
export type DatasetSearchFetch = (url: string, signal?: AbortSignal) => Promise<unknown>;

async function fetchSearchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Hugging Face responded ${res.status}.`);
  return res.json();
}

export interface DatasetSearchOptions {
  readonly fetchJson?: DatasetSearchFetch;
  readonly signal?: AbortSignal;
  readonly limit?: number;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** One line of prose from a Hub description — the first non-blank line, since a card's `description` is often a multi-paragraph README dump and only the opener reads as a summary. */
function firstLine(description: unknown): string | undefined {
  const raw = text(description);
  if (!raw) return undefined;
  const line = raw
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line || undefined;
}

function toHit(entry: unknown): DatasetHit | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  if (e.private === true || e.gated === true || e.disabled === true) return null;
  const id = text(e.id);
  if (!id) return null;
  const tags = Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === "string") : [];
  if (!isLikelyTabularHit(tags)) return null;
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
 * Live search against the Hugging Face Hub, filtered to likely-tabular hits
 * and ranked by downloads. Never throws — a network failure or a malformed
 * body resolves to an EMPTY array (the caller's curated `remoteIndex.ts`
 * suggestions are the offline fallback, same contract
 * `mapsGeocode.ts`'s `geocodeMapSearch` documents for its own remote half).
 */
export async function searchDatasets(
  query: string,
  options: DatasetSearchOptions = {},
): Promise<readonly DatasetHit[]> {
  const q = query.trim();
  if (!q) return [];
  const load = options.fetchJson ?? fetchSearchJson;
  const url = `${DATASET_SEARCH_ENDPOINT}?search=${encodeURIComponent(q)}&limit=${DATASET_SEARCH_FETCH_LIMIT}&sort=downloads&direction=-1&full=true`;
  let body: unknown;
  try {
    body = await load(url, options.signal);
  } catch {
    return [];
  }
  if (!Array.isArray(body)) return [];
  const hits = body.map(toHit).filter((h): h is DatasetHit => h !== null);
  hits.sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0));
  return hits.slice(0, options.limit ?? DATASET_SEARCH_RESULT_LIMIT);
}

const RAW_GITHUB_FILE = /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/.+\.(csv|json|tsv)$/i;
const HF_RESOLVE_FILE = /^https:\/\/huggingface\.co\/datasets\/([^/]+)\/([^/]+)\/resolve\/([^/]+)\/(.+)$/i;
/** A Hugging Face dataset id: exactly one `/`, no whitespace, no protocol — deliberately narrow (a bare "titanic" is a SEARCH query, not an id; only the two-segment `org/name` shape a Hub URL/API always uses is accepted). */
const HF_BARE_ID = /^[\w.-]+\/[\w.-]+$/;

/**
 * Parses a pasted string with NO network call — a raw GitHub file URL, a
 * Hugging Face resolve URL, or a bare `org/name` id. `null` for anything
 * else (a plain search phrase, an unsupported URL), which the caller reads
 * as "treat this as a search query instead."
 */
export function parseDatasetHitFromQuery(raw: string): DatasetHit | null {
  const value = raw.trim();
  if (!value) return null;
  const githubMatch = RAW_GITHUB_FILE.exec(value);
  if (githubMatch) {
    const file = value.split("/").pop()!;
    return { id: value, kind: "url", ref: value, title: file, url: value };
  }
  const hfMatch = HF_RESOLVE_FILE.exec(value);
  if (hfMatch) {
    const [, org, name, , file] = hfMatch;
    return { id: value, kind: "url", ref: value, title: file!, description: `${org}/${name}`, url: value };
  }
  if (HF_BARE_ID.test(value) && !value.includes("://")) {
    return { id: value, kind: "hf", ref: value, title: value, url: `https://huggingface.co/datasets/${value}` };
  }
  return null;
}
