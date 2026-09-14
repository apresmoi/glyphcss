/**
 * `/charts`' dataset LOAD: turning a {@link DatasetHit} (`datasetSearch.ts`)
 * into rows the Data folder can profile and chart — the second half of the
 * remote-dataset feature. Pure except for one injected transport seam
 * (`fetch`), same shape as `datasetSearch.ts`/`MapsWorkbench/mapsGeocode.ts`:
 * every failure mode is a structured `{ ok: false, error, kind }`, never a
 * throw into React.
 *
 * ## Two paths for a Hugging Face id
 *
 * 1. **Rows server** (preferred) — `datasets-server.huggingface.co`'s
 *    `/splits` then `/rows` endpoints. This is the SAME service the Hub's
 *    own dataset viewer uses, so it already resolves whatever loader script
 *    a dataset needs (CSV/Parquet/a custom builder) into plain JSON rows —
 *    no client-side Parquet/Arrow decoding required here at all.
 * 2. **Raw file fallback** — for a dataset the rows server can't serve (no
 *    splits at all — an old, gated-but-metadata-visible, or otherwise
 *    unindexed repo): the Hub's own `/api/datasets/<id>` metadata lists
 *    `siblings` (every file in the repo); the first `.csv`/`.tsv`/`.json`
 *    one is fetched raw via `resolve/main/<file>` and parsed with this
 *    package's own `tabularParse.ts` — the exact same parser a pasted
 *    GitHub/direct URL goes through.
 *
 * A GATED dataset (one that needs a signed-in, token-bearing request) fails
 * fast with `kind: "gated"` at the `/splits` call — Section 2's own
 * requirement is "no APIs with auth," so a gated dataset is reported, not
 * worked around.
 */
import { parseTabular, type TabularRow } from "./tabularParse";
import type { DatasetHit } from "./datasetSearch";

export const DATASET_LOAD_DEFAULT_MAX_ROWS = 200;
export const DATASET_LOAD_DEFAULT_MAX_BYTES = 256 * 1024;
/** `datasets-server`'s own per-request row cap. */
const HF_ROWS_PAGE_SIZE = 100;

export interface DatasetLoadSource {
  readonly name: string;
  readonly url: string;
  readonly licence?: string;
}

export type DatasetLoadResult =
  | { readonly ok: true; readonly rows: readonly TabularRow[]; readonly columns: readonly string[]; readonly source: DatasetLoadSource; readonly truncated: boolean }
  | { readonly ok: false; readonly kind: "gated" | "not-found" | "network" | "too-big" | "not-tabular"; readonly error: string };

/** The transport seam — defaults to a real `fetch`; injected by tests, which must never touch the network. `status` and a capped, decoded `text` are what every caller here actually needs (never `.json()` directly — a fallback path must inspect the raw body before deciding how to parse it). */
export type DatasetLoadFetch = (url: string, init?: { signal?: AbortSignal; redirect?: "follow" }) => Promise<{ readonly ok: boolean; readonly status: number; readonly headers: { get(name: string): string | null }; text(): Promise<string>; body?: ReadableStream<Uint8Array> | null }>;

export interface DatasetLoadOptions {
  readonly fetch?: DatasetLoadFetch;
  readonly signal?: AbortSignal;
  readonly maxRows?: number;
  readonly maxBytes?: number;
}

// agy P3-3 (`REVIEW-batch4-agy.md`): every real `fetch` call below passes
// `redirect: "follow"` EXPLICITLY — a browser's own default, so this is a
// no-op there, but the Node test harness `datasetLoad.test.ts` runs
// against (and any other non-browser `fetch` implementation this module
// might someday run under) is not guaranteed to share that default.

/** Exported so `ChartsWorkbench.tsx`'s own catch (codex P2-13) can tell a
 *  cancelled/superseded load apart from any OTHER throw that escapes this
 *  module, rather than assuming every throw is an abort — the one shared
 *  definition, not a second copy drifting from this one. */
export function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

/**
 * Reads a response body up to `maxBytes`, decoding as UTF-8 text —
 * streamed where the runtime exposes a body stream, falling back to a
 * plain `.text()` + slice otherwise (Node's `fetch`, or a test double with
 * no `body`). Stops the underlying stream the moment the cap is crossed
 * rather than downloading a multi-megabyte file only to discard most of
 * it.
 */
async function readTextCapped(res: { text(): Promise<string>; body?: ReadableStream<Uint8Array> | null }, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!res.body) {
    const full = await res.text();
    const bytes = new TextEncoder().encode(full);
    if (bytes.length <= maxBytes) return { text: full, truncated: false };
    return { text: new TextDecoder().decode(bytes.subarray(0, maxBytes)), truncated: true };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let out = "";
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        const allowed = Math.max(0, value.byteLength - (received - maxBytes));
        out += decoder.decode(value.subarray(0, allowed));
        truncated = true;
        break;
      }
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    if (truncated) { try { await reader.cancel(); } catch { /* already closing */ } }
  }
  return { text: out, truncated };
}

/** A truncated CSV/TSV's last line is very likely a cut-off row — dropped before parsing rather than fed to the parser as a malformed record. A truncated JSON body has no such recovery (an array/object cut mid-token is not valid JSON at any prefix length), so `parseTabular` is left to fail it honestly. */
function dropTrailingPartialLine(text: string, filename: string | undefined): string {
  if (!/\.(csv|tsv)$/i.test(filename ?? "")) return text;
  const lastBreak = text.lastIndexOf("\n");
  return lastBreak >= 0 ? text.slice(0, lastBreak) : text;
}

function filenameOf(url: string): string {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || url); }
  catch { return url; }
}

async function loadRawFile(url: string, source: DatasetLoadSource, options: DatasetLoadOptions): Promise<DatasetLoadResult> {
  const load = options.fetch ?? ((u, init) => fetch(u, init));
  const maxBytes = options.maxBytes ?? DATASET_LOAD_DEFAULT_MAX_BYTES;
  const maxRows = options.maxRows ?? DATASET_LOAD_DEFAULT_MAX_ROWS;
  let res: Awaited<ReturnType<DatasetLoadFetch>>;
  try {
    res = await load(url, { signal: options.signal, redirect: "follow" });
  } catch (error) {
    if (isAbort(error)) throw error;
    return { ok: false, kind: "network", error: `Could not reach ${url}.` };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, kind: "gated", error: "This file needs a Hugging Face token — not supported here." };
  if (res.status === 404) return { ok: false, kind: "not-found", error: `${filenameOf(url)} was not found.` };
  if (!res.ok) return { ok: false, kind: "network", error: `${filenameOf(url)} responded ${res.status}.` };
  const declaredLength = Number(res.headers.get("content-length") ?? "");
  // A CORS-blocked request never reaches here — the browser rejects it
  // before `fetch` resolves at all (surfaces through the `network` catch
  // above instead; there is no distinct `DatasetLoadResult` kind for it —
  // P3-6, REVIEW-arc-density-search-opus.md — a consumer switching
  // exhaustively over `kind` would otherwise write a branch that can never
  // run).
  //
  // P3-9: this rejects at `maxBytes * 4`, not `maxBytes` — a file under
  // that is instead streamed and TRUNCATED at `maxBytes` (`readTextCapped`
  // below), which is the intended, working behaviour, not a failure. The
  // message used to cite `maxBytes` (implying that was the threshold that
  // rejected it), which was never the number this branch actually compared
  // against. Named honestly instead: the file is too large to even load a
  // useful truncated prefix of.
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes * 4) {
    return { ok: false, kind: "too-big", error: `${filenameOf(url)} is ${Math.ceil(declaredLength / 1024)} KB — too large to load even truncated.` };
  }
  // codex P2-13 (`REVIEW-batch4-codex.md`): an HTTP-200 response can still
  // fail while its BODY streams (a dropped connection mid-transfer) —
  // `readTextCapped`'s `reader.read()`/`res.text()` calls had no guard at
  // all, so that rejection escaped `loadRawFile`, then `loadDatasetRows`,
  // as an uncaught throw. `ChartsWorkbench.tsx`'s own catch assumed every
  // throw from `loadDatasetRows` meant "cancelled" (a superseded/aborted
  // load) and silently cleared the loading state with no notice and no
  // fallback — the READER never learned the load failed at all. Reported
  // here as the SAME structured `network` failure a request that never
  // even connected gets, so every body-read failure reaches the page as
  // a `DatasetLoadResult`, never a throw.
  let text: string, truncated: boolean;
  try {
    ({ text, truncated } = await readTextCapped(res, maxBytes));
  } catch (error) {
    if (isAbort(error)) throw error;
    return { ok: false, kind: "network", error: `${filenameOf(url)}'s body could not be read.` };
  }
  const filename = filenameOf(url);
  const parsed = parseTabular(truncated ? dropTrailingPartialLine(text, filename) : text, { filename });
  if (!parsed.ok) return { ok: false, kind: truncated ? "too-big" : "not-tabular", error: truncated ? `${filename} is too large and could not be parsed from a truncated copy.` : parsed.error };
  const rows = parsed.kind === "rows" ? parsed.rows : null;
  if (!rows || rows.length === 0) return { ok: false, kind: "not-tabular", error: `${filename} doesn't look like tabular data.` };
  const capped = rows.slice(0, maxRows);
  const columns = [...new Set(capped.flatMap((row) => Object.keys(row)))];
  return { ok: true, rows: capped, columns, source, truncated: truncated || rows.length > maxRows };
}

interface HfSplit { readonly config: string; readonly split: string }

async function loadHfRows(id: string, split: HfSplit, source: DatasetLoadSource, options: DatasetLoadOptions): Promise<DatasetLoadResult | null> {
  const load = options.fetch ?? ((u, init) => fetch(u, init));
  const maxRows = options.maxRows ?? DATASET_LOAD_DEFAULT_MAX_ROWS;
  const rows: TabularRow[] = [];
  let offset = 0;
  let totalKnown: number | undefined;
  // P3-7 (REVIEW-arc-density-search-opus.md): the loop used to be bounded
  // by USABLE rows (`rows.length < maxRows`), advancing `offset` by
  // `pageRows.length` every page but only ever appending an entry whose
  // `.row` is a real object — a response whose rows are all unusable
  // (malformed, or a hostile server) left `rows.length` static forever,
  // so the ONLY things that could end the loop were an empty page or
  // `num_rows_total` — neither guaranteed on a malformed source. Bounded
  // by PAGES fetched too, independent of how many rows each page yields.
  const maxPages = Math.ceil(maxRows / HF_ROWS_PAGE_SIZE) + 1;
  let pages = 0;
  while (rows.length < maxRows) {
    if (++pages > maxPages) break;
    const length = Math.min(HF_ROWS_PAGE_SIZE, maxRows - rows.length);
    const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(id)}&config=${encodeURIComponent(split.config)}&split=${encodeURIComponent(split.split)}&offset=${offset}&length=${length}`;
    let res: Awaited<ReturnType<DatasetLoadFetch>>;
    try {
      res = await load(url, { signal: options.signal, redirect: "follow" });
    } catch (error) {
      if (isAbort(error)) throw error;
      return rows.length > 0 ? { ok: true, rows, columns: [...new Set(rows.flatMap((r) => Object.keys(r)))], source, truncated: true } : null;
    }
    if (!res.ok) return rows.length > 0 ? { ok: true, rows, columns: [...new Set(rows.flatMap((r) => Object.keys(r)))], source, truncated: true } : null;
    let body: unknown;
    try { body = JSON.parse(await res.text()); } catch { return null; }
    if (!body || typeof body !== "object") return null;
    const pageRows = (body as Record<string, unknown>).rows;
    if (!Array.isArray(pageRows)) return null;
    if (typeof (body as Record<string, unknown>).num_rows_total === "number") totalKnown = (body as Record<string, unknown>).num_rows_total as number;
    for (const entry of pageRows) {
      const row = (entry as Record<string, unknown> | null)?.row;
      if (row && typeof row === "object" && !Array.isArray(row)) rows.push(flattenHfRow(row as Record<string, unknown>));
    }
    if (pageRows.length === 0) break;
    offset += pageRows.length;
    if (totalKnown !== undefined && offset >= totalKnown) break;
  }
  if (rows.length === 0) return null;
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const hitPageCap = pages > maxPages;
  return { ok: true, rows: rows.slice(0, maxRows), columns, source, truncated: hitPageCap || (totalKnown !== undefined && totalKnown > rows.length) };
}

/** A datasets-server row's own field can be a nested object/array (an image reference, a list column) — outside `TabularRow`'s `TabularCell` union, so it is stringified rather than silently dropped: a reader can still see the column exists, and `dataProfile.ts` reads it as `text` rather than mis-typing it. */
function flattenHfRow(row: Record<string, unknown>): TabularRow {
  const out: TabularRow = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value
      : value === undefined ? null : JSON.stringify(value);
  }
  return out;
}

/**
 * P3-5 (REVIEW-arc-density-search-opus.md): the raw-file fallback used to
 * take `siblings.find(name matches /\.(csv|tsv|json)$/i)` — the FIRST
 * match in the Hub's own listing order, which is routinely `dataset_
 * infos.json` or `config.json` (both common repo metadata that sorts
 * ahead of the real data file) rather than an actual data file.
 * `parseTabular` then either rejects it (`not-tabular`, reported as if the
 * dataset had no readable file at all) or parses a nested metadata object
 * into one nonsense row. Two fixes: a small metadata deny-list, and a
 * preference for `.csv`/`.tsv` (unambiguous tabular data) over `.json`
 * (which the Hub also uses for non-tabular repo config).
 */
const HF_SIBLING_DENY_RE = /^(dataset_infos\.json|config\.json|\.gitattributes|.*\.lock)$/i;
function pickHfSiblingFilename(siblings: unknown): string | undefined {
  if (!Array.isArray(siblings)) return undefined;
  const names = siblings
    .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>).rfilename : undefined))
    .filter((name): name is string => typeof name === "string");
  const candidates = names.filter((name) => /\.(csv|tsv|json)$/i.test(name) && !HF_SIBLING_DENY_RE.test(name));
  return candidates.find((name) => /\.(csv|tsv)$/i.test(name)) ?? candidates[0];
}

async function loadHfDataset(id: string, options: DatasetLoadOptions): Promise<DatasetLoadResult> {
  const load = options.fetch ?? ((u, init) => fetch(u, init));
  const source: DatasetLoadSource = { name: `Hugging Face — ${id}`, url: `https://huggingface.co/datasets/${id}` };
  let splitsRes: Awaited<ReturnType<DatasetLoadFetch>>;
  try {
    splitsRes = await load(`https://datasets-server.huggingface.co/splits?dataset=${encodeURIComponent(id)}`, { signal: options.signal, redirect: "follow" });
  } catch (error) {
    if (isAbort(error)) throw error;
    return { ok: false, kind: "network", error: "Could not reach Hugging Face." };
  }
  if (splitsRes.status === 401 || splitsRes.status === 403) return { ok: false, kind: "gated", error: `"${id}" needs a Hugging Face account/token — not supported here.` };
  if (splitsRes.ok) {
    let splitsBody: unknown;
    try { splitsBody = JSON.parse(await splitsRes.text()); } catch { splitsBody = null; }
    const splits = splitsBody && typeof splitsBody === "object" ? (splitsBody as Record<string, unknown>).splits : undefined;
    const first = Array.isArray(splits) ? splits[0] : undefined;
    const config = first && typeof first === "object" ? (first as Record<string, unknown>).config : undefined;
    const split = first && typeof first === "object" ? (first as Record<string, unknown>).split : undefined;
    if (typeof config === "string" && typeof split === "string") {
      const rowsResult = await loadHfRows(id, { config, split }, source, options);
      if (rowsResult) return rowsResult;
    }
  }
  // Rows server has nothing (an unindexed/script-loader dataset) — fall
  // back to the Hub's own file listing.
  let metaRes: Awaited<ReturnType<DatasetLoadFetch>>;
  try {
    metaRes = await load(`https://huggingface.co/api/datasets/${encodeURIComponent(id)}`, { signal: options.signal, redirect: "follow" });
  } catch (error) {
    if (isAbort(error)) throw error;
    return { ok: false, kind: "network", error: "Could not reach Hugging Face." };
  }
  if (metaRes.status === 401 || metaRes.status === 403) return { ok: false, kind: "gated", error: `"${id}" needs a Hugging Face account/token — not supported here.` };
  if (metaRes.status === 404) return { ok: false, kind: "not-found", error: `"${id}" was not found on Hugging Face.` };
  if (!metaRes.ok) return { ok: false, kind: "network", error: `Hugging Face responded ${metaRes.status}.` };
  let metaBody: unknown;
  try { metaBody = JSON.parse(await metaRes.text()); } catch { return { ok: false, kind: "not-tabular", error: `"${id}" has no readable file listing.` }; }
  const siblings = metaBody && typeof metaBody === "object" ? (metaBody as Record<string, unknown>).siblings : undefined;
  const filename = pickHfSiblingFilename(siblings);
  if (!filename) return { ok: false, kind: "not-tabular", error: `"${id}" has no CSV/TSV/JSON file this page can read.` };
  return loadRawFile(`https://huggingface.co/datasets/${id}/resolve/main/${filename}`, source, options);
}

/**
 * Resolves a {@link DatasetHit} into rows — the one entry point
 * `select-remote-dataset` (`chartsWorkbenchState.ts`) needs already-loaded
 * data for. Never throws for a network/parse failure (a caller sees
 * `{ ok: false, kind, error }`); an aborted `signal` DOES reject (the same
 * "abort propagates, everything else is a structured outcome" split
 * `mapsGeocode.ts` documents), since a caller that cancelled a load has no
 * use for a settled result either way.
 */
export async function loadDatasetRows(hit: DatasetHit, options: DatasetLoadOptions = {}): Promise<DatasetLoadResult> {
  if (hit.kind === "hf") return loadHfDataset(hit.ref, options);
  const source: DatasetLoadSource = { name: hit.title, url: hit.url, licence: hit.licence };
  return loadRawFile(hit.ref, source, options);
}
