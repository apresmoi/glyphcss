/**
 * `/charts`' dataset search box — the remote half of the Data folder
 * (AGENTS.md's "Charts" — "Data layer"), matching `MapsWorkbench/MapSearchBox.tsx`'s
 * own look, debounce, keyboard and result-list behaviour: a type-ahead
 * whose local list (curated suggestions, then "Recent") is instant and
 * whose remote list (Hugging Face Hub search, `lib/datasetSearch.ts`) is
 * debounced and abortable. Sits in the rail HEADER, above the stock
 * dataset `<select>` — see `ChartsWorkbench.tsx`'s own header layout doc.
 *
 * Unlike the map's geocoder, there is no "local index" to build lazily —
 * the curated suggestions (`datasets/remoteIndex.ts`) are a static import,
 * already in memory — so this box has no `loadIndex`/`ensureIndex` step at
 * all; the only async work is the live Hub search itself.
 *
 * A pasted URL or bare `org/name` id ({@link parseDatasetHitFromQuery})
 * short-circuits the live search entirely: it is a precise reference, not
 * a search phrase, so typing one shows exactly one result — "Load
 * `<ref>`" — rather than a Hub query for the literal URL string.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { parseDatasetHitFromQuery, searchDatasets, type DatasetHit, type DatasetSearchFetch } from "../../lib/datasetSearch";
import { CHARTS_REMOTE_DATASET_INDEX } from "./datasets/remoteIndex";

export const CHARTS_DATASET_SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY = 2;
export const CHARTS_DATASET_SEARCH_RECENT_KEY = "glyphcss:charts:recent-remote-datasets";
const RECENT_LIMIT = 5;

/** Reads the "Recent" list from `localStorage` — swallows every failure (a private window, cleared/blocked site data) and returns `[]`, never throwing into render. */
export function readRecentRemoteDatasets(): readonly DatasetHit[] {
  try {
    const raw = window.localStorage.getItem(CHARTS_DATASET_SEARCH_RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is DatasetHit =>
      !!entry && typeof entry === "object" && typeof (entry as DatasetHit).ref === "string" && typeof (entry as DatasetHit).title === "string");
  } catch { return []; }
}

/** Records a loaded remote dataset at the front of the "Recent" list, de-duped by `ref`, capped at {@link RECENT_LIMIT}. A convenience only — a failure to persist (quota, a private window) is silently dropped. */
export function pushRecentRemoteDataset(hit: DatasetHit): void {
  try {
    const next = [hit, ...readRecentRemoteDatasets().filter((h) => h.ref !== hit.ref)].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(CHARTS_DATASET_SEARCH_RECENT_KEY, JSON.stringify(next));
  } catch { /* best-effort only */ }
}

export interface ChartsDatasetSearchBoxProps {
  /** A search hit (live, curated, "Recent", or a parsed paste) was chosen — load it. */
  onSelect: (hit: DatasetHit) => void;
  /** Transport seam for the live half. Defaults to `searchDatasets`; injected by tests, which must never touch the network. */
  search?: (query: string, options: { fetchJson?: DatasetSearchFetch; signal?: AbortSignal }) => Promise<readonly DatasetHit[]>;
  /** Offline/zero-typing suggestions. Defaults to the vendored curated index; injected by tests for a small deterministic list. */
  suggestions?: readonly DatasetHit[];
  /** Read at focus/mount time; injected by tests instead of touching real `localStorage`. */
  recent?: () => readonly DatasetHit[];
}

export function ChartsDatasetSearchBox({ onSelect, search = searchDatasets, suggestions = CHARTS_REMOTE_DATASET_INDEX, recent = readRecentRemoteDatasets }: ChartsDatasetSearchBoxProps) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [remote, setRemote] = useState<readonly DatasetHit[]>([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const searchRef = useRef(search);
  searchRef.current = search;

  const parsed = useMemo(() => parseDatasetHitFromQuery(query), [query]);
  const recentHits = useMemo(() => (open && !query.trim() ? recent() : []), [open, query, recent]);
  const trimmed = query.trim();
  const listOpen = open && (trimmed.length > 0 || recentHits.length > 0 || suggestions.length > 0);

  useEffect(() => {
    if (!open || parsed || trimmed.length < MIN_QUERY) {
      setRemote([]); setRemoteBusy(false); setRemoteError(null);
      return;
    }
    setRemote([]); setRemoteError(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setRemoteBusy(true);
      void searchRef.current(trimmed, { signal: controller.signal }).then(
        (hits) => {
          if (!live.current || controller.signal.aborted) return;
          setRemoteBusy(false);
          setRemote(hits);
          if (hits.length === 0) setRemoteError("No match on Hugging Face.");
        },
        () => {
          if (!live.current || controller.signal.aborted) return;
          setRemoteBusy(false);
          setRemoteError("Hugging Face search unavailable.");
        },
      );
    }, CHARTS_DATASET_SEARCH_DEBOUNCE_MS);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [trimmed, parsed, open]);

  /** Parsed paste first (exactly one), else Recent (query empty only), then curated suggestions (query empty only), then live Hub hits. One flat array so keyboard nav and `aria-activedescendant` stay index-based, same idiom as `MapSearchBox`'s local-then-remote blend. */
  const results = useMemo<readonly DatasetHit[]>(() => {
    if (parsed) return [parsed];
    if (!trimmed) return [...recentHits, ...suggestions.filter((s) => !recentHits.some((r) => r.ref === s.ref))];
    return remote;
  }, [parsed, trimmed, recentHits, suggestions, remote]);

  const choose = useCallback((hit: DatasetHit) => {
    setQuery(""); setOpen(false); setActive(-1);
    onSelect(hit);
  }, [onSelect]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length === 0) return;
      setOpen(true);
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => {
        const next = i < 0 ? (step > 0 ? 0 : results.length - 1) : i + step;
        return ((next % results.length) + results.length) % results.length;
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[active >= 0 ? active : 0];
      if (pick) choose(pick);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      if (listOpen) { setOpen(false); setActive(-1); return; }
      setQuery(""); setActive(-1);
    }
  }, [active, choose, listOpen, results]);

  const note = remoteError ?? (remoteBusy ? "Searching Hugging Face…" : null);

  return (
    <div className="charts-dataset-search" role="search">
      <div className="charts-dataset-search-field">
        <span className="charts-dataset-search-glyph" aria-hidden="true">{">"}</span>
        <input
          ref={inputRef}
          type="text"
          className="charts-dataset-search-input"
          role="combobox"
          aria-expanded={listOpen && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && results[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search Hugging Face, or paste a dataset URL/id"
          title="Search public Hugging Face datasets, or paste a raw CSV/JSON URL or an org/name id. Typed text (other than a pasted URL/id) is sent to huggingface.co."
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(-1); }}
          onKeyDown={onKeyDown}
          onBlur={() => { window.setTimeout(() => { if (live.current) setOpen(false); }, 0); }}
        />
        {query && (
          <button type="button" className="charts-dataset-search-clear" title="Clear the search" aria-label="Clear the search"
            onMouseDown={(e) => e.preventDefault()} onClick={() => { setQuery(""); setActive(-1); inputRef.current?.focus(); }}>×</button>
        )}
      </div>
      {listOpen && results.length > 0 && (
        <ul className="charts-dataset-search-list" id={listId} role="listbox">
          {!trimmed && recentHits.length > 0 && <li className="charts-dataset-search-group" role="presentation">Recent</li>}
          {results.map((hit, i) => {
            const isFirstSuggestion = !trimmed && !parsed && i === recentHits.length;
            return <li key={`${hit.ref}-${i}`}>
              {isFirstSuggestion && <p className="charts-dataset-search-group" role="presentation">Suggested</p>}
              <button
                type="button"
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`charts-dataset-search-option${i === active ? " is-active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(hit)}
              >
                <span className="charts-dataset-search-name">{parsed && i === 0 ? `Load ${hit.title}` : hit.title}</span>
                {hit.description && <span className="charts-dataset-search-context">{hit.description}</span>}
                {typeof hit.downloads === "number" && <span className="charts-dataset-search-metric">{hit.downloads.toLocaleString()} downloads</span>}
              </button>
            </li>;
          })}
        </ul>
      )}
      {listOpen && note && <p className="charts-dataset-search-note" role="status">{note}</p>}
      {open && trimmed.length > 0 && !parsed && (
        <p className="charts-dataset-search-egress">
          Searched at <a href="https://huggingface.co/datasets" target="_blank" rel="noreferrer">huggingface.co</a> — what you type is sent there.
        </p>
      )}
    </div>
  );
}
