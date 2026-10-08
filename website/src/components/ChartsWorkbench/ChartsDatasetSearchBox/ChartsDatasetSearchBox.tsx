/**
 * `/charts`' dataset search box — the ENTIRE dataset picker now (AGENTS.md's
 * "Charts" — "Data layer"), rendering through the SAME `instrument-search-*`
 * field/list/option shape `MapsWorkbench/MapSearchBox.tsx` uses
 * (`instrument-workbench.css`'s shared block). The old three-control bar
 * (this search box + a stock `<select>` + "Random") is gone — the user's
 * own words: "the dataset dropdown could be just an arrow inside the
 * search field — I don't need two dataset pickers." A chevron button
 * (`.charts-search-chevron`, right edge of the field, "the instrument-
 * search-* look" reproduced locally since `instrument-workbench.css` is
 * shared with `/maps` and stays untouched) opens the SAME results list
 * typing already filters, pre-filled with the 16 vendored datasets under a
 * "Built-in" heading and the curated Hugging Face suggestions under a
 * "Hugging Face" heading — `/maps`' own local-index-first, remote-second
 * blend (`MapSearchBox.tsx`'s own doc), just with a page-owned local list
 * instead of a lazily-built one.
 *
 * Idle display (not focused): the field shows the CURRENTLY LOADED
 * dataset's title (`loadedTitle`, `ChartsDataOverlay.tsx`'s own job to
 * track — it knows both a vendored `activeDatasetId` and a remote pick,
 * neither of which this box has on its own). Focusing clears the field so
 * typing starts fresh; blurring with no pick reverts to the idle title
 * (both fall out of `focused ? query : loadedTitle` — nothing to
 * explicitly "restore").
 *
 * Typing filters BOTH groups: "Built-in" locally (title/id substring,
 * free — no network), "Hugging Face" locally too (same substring match
 * over the curated list) MERGED with the live Hub search
 * (`lib/datasetSearch.ts`) once it lands — so the list narrows the instant
 * a reader types, and gains fresher network hits a beat later, never
 * replacing one with the other.
 *
 * A pasted URL or bare `org/name` id ({@link parseDatasetHitFromQuery})
 * still short-circuits everything to one "Load `<ref>`" result.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ChartsDataset } from "../../../features/charts/data/index";
import { CHARTS_REMOTE_DATASET_INDEX } from "../../../features/charts/data/remoteIndex";
import {
  parseDatasetHitFromQuery,
  searchDatasets,
  type DatasetHit,
  type DatasetSearchFetch,
} from "../../../services/datasets/datasetSearch";

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
    return parsed.filter(
      (entry): entry is DatasetHit =>
        !!entry &&
        typeof entry === "object" &&
        typeof (entry as DatasetHit).ref === "string" &&
        typeof (entry as DatasetHit).title === "string",
    );
  } catch {
    return [];
  }
}

/** Records a loaded remote dataset at the front of the "Recent" list, de-duped by `ref`, capped at {@link RECENT_LIMIT}. A convenience only — a failure to persist (quota, a private window) is silently dropped. */
export function pushRecentRemoteDataset(hit: DatasetHit): void {
  try {
    const next = [hit, ...readRecentRemoteDatasets().filter((h) => h.ref !== hit.ref)].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(CHARTS_DATASET_SEARCH_RECENT_KEY, JSON.stringify(next));
  } catch {
    /* best-effort only */
  }
}

/** One row of the combined browse/search list — a vendored dataset or a remote (curated/live/recent/pasted) hit, kept as a discriminated union so `choose()` can route to the right callback without guessing from shape. */
type ChartsBrowseResult =
  | { readonly kind: "builtin"; readonly dataset: ChartsDataset }
  | { readonly kind: "remote"; readonly hit: DatasetHit };

interface ChartsBrowseRow {
  readonly key: string;
  readonly result: ChartsBrowseResult;
  /** Set only on the first row of a new group — `instrument-search-group`'s own "emit once" idiom (`MapSearchBox.tsx`). */
  readonly heading?: string;
}

export interface ChartsDatasetSearchBoxProps {
  /** The 16 vendored datasets, browsable under "Built-in" — `ChartsDataOverlay.tsx` passes `CHARTS_DATASETS`. */
  readonly builtIn: readonly ChartsDataset[];
  /** What the field shows when idle (not focused, no typed query) — the currently loaded dataset's title, tracked by the caller since it alone knows about a remote pick. */
  readonly loadedTitle: string;
  /** A vendored ("Built-in") result was chosen. */
  readonly onSelectBuiltIn: (id: string) => void;
  /** A remote (curated, live, recent, or pasted) result was chosen. */
  readonly onSelectRemote: (hit: DatasetHit) => void;
  /** Transport seam for the live half. Defaults to `searchDatasets`; injected by tests, which must never touch the network. */
  search?: (
    query: string,
    options: { fetchJson?: DatasetSearchFetch; signal?: AbortSignal },
  ) => Promise<readonly DatasetHit[]>;
  /** Curated "Hugging Face" suggestions. Defaults to the vendored curated index; injected by tests for a small deterministic list. */
  suggestions?: readonly DatasetHit[];
  /** Read at focus/mount time; injected by tests instead of touching real `localStorage`. */
  recent?: () => readonly DatasetHit[];
}

export function ChartsDatasetSearchBox({
  builtIn,
  loadedTitle,
  onSelectBuiltIn,
  onSelectRemote,
  search = searchDatasets,
  suggestions = CHARTS_REMOTE_DATASET_INDEX,
  recent = readRecentRemoteDatasets,
}: ChartsDatasetSearchBoxProps) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [remote, setRemote] = useState<readonly DatasetHit[]>([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  // Whether the live half has a real answer for the CURRENT query (settled
  // — resolved or rejected — or trivially so for a too-short/parsed query,
  // which never searches at all). Drives "no match", which must never
  // fire merely because the debounce timer hasn't gone off yet.
  const [remoteSettled, setRemoteSettled] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );
  const searchRef = useRef(search);
  searchRef.current = search;

  const parsed = useMemo(() => parseDatasetHitFromQuery(query), [query]);
  const trimmed = query.trim();
  const recentHits = useMemo(() => (open && !trimmed ? recent() : []), [open, trimmed, recent]);

  const filteredBuiltIn = useMemo(() => {
    if (!trimmed) return builtIn;
    const q = trimmed.toLowerCase();
    return builtIn.filter((d) => d.title.toLowerCase().includes(q) || d.id.toLowerCase().includes(q));
  }, [builtIn, trimmed]);

  const filteredSuggestions = useMemo(() => {
    if (!trimmed) return suggestions;
    const q = trimmed.toLowerCase();
    return suggestions.filter((s) => s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
  }, [suggestions, trimmed]);

  // The live half — unchanged from before this feature merged in the
  // "Built-in" group: debounced, abortable, gated on a minimum length and
  // skipped entirely for a parsed paste. Its results MERGE with the local
  // curated matches above rather than replacing them, so "Hugging Face"
  // narrows the instant a reader types (offline) and gains fresher network
  // hits a beat later — never a swap that would blank the group while the
  // request is in flight.
  useEffect(() => {
    if (!open || parsed || trimmed.length < MIN_QUERY) {
      setRemote([]);
      setRemoteBusy(false);
      setRemoteError(null);
      setRemoteSettled(true);
      return;
    }
    setRemote([]);
    setRemoteError(null);
    setRemoteSettled(false);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setRemoteBusy(true);
      void searchRef.current(trimmed, { signal: controller.signal }).then(
        (hits) => {
          if (!live.current || controller.signal.aborted) return;
          setRemoteBusy(false);
          setRemote(hits);
          setRemoteSettled(true);
        },
        () => {
          if (!live.current || controller.signal.aborted) return;
          setRemoteBusy(false);
          setRemoteError("Hugging Face search unavailable.");
          setRemoteSettled(true);
        },
      );
    }, CHARTS_DATASET_SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, parsed, open]);

  /** Built-in first (local, instant — mirrors `/maps`' own local-index-first blend), then the remote group: Recent + curated suggestions when idle, curated matches merged with live hits once typing. One flat, headed list so keyboard nav and `aria-activedescendant` stay index-based. */
  const rows = useMemo<readonly ChartsBrowseRow[]>(() => {
    if (parsed) return [{ key: parsed.ref, result: { kind: "remote", hit: parsed } }];
    const out: ChartsBrowseRow[] = [];
    filteredBuiltIn.forEach((dataset, i) => {
      out.push({
        key: `b:${dataset.id}`,
        result: { kind: "builtin", dataset },
        heading: i === 0 ? "Built-in" : undefined,
      });
    });
    if (!trimmed) {
      recentHits.forEach((hit, i) =>
        out.push({ key: `r:${hit.ref}`, result: { kind: "remote", hit }, heading: i === 0 ? "Recent" : undefined }),
      );
      const rest = filteredSuggestions.filter((s) => !recentHits.some((r) => r.ref === s.ref));
      rest.forEach((hit, i) =>
        out.push({
          key: `h:${hit.ref}`,
          result: { kind: "remote", hit },
          heading: i === 0 ? "Hugging Face" : undefined,
        }),
      );
    } else {
      const merged = [...remote, ...filteredSuggestions.filter((s) => !remote.some((r) => r.ref === s.ref))];
      merged.forEach((hit, i) =>
        out.push({
          key: `h:${hit.ref}`,
          result: { kind: "remote", hit },
          heading: i === 0 ? "Hugging Face" : undefined,
        }),
      );
    }
    return out;
  }, [parsed, filteredBuiltIn, trimmed, recentHits, filteredSuggestions, remote]);

  // Open whenever there's something to show — real rows, OR a typed query
  // with none (so "No match on Hugging Face." still has somewhere to
  // render; an empty result set is itself information, not nothing).
  const listOpen = open && (rows.length > 0 || (trimmed.length > 0 && !parsed));

  const choose = useCallback(
    (result: ChartsBrowseResult) => {
      setQuery("");
      setOpen(false);
      setActive(-1);
      if (result.kind === "builtin") onSelectBuiltIn(result.dataset.id);
      else onSelectRemote(result.hit);
      // Settles the field back to `loadedTitle` (the pick) rather than
      // leaving it blank-but-focused — a blur is also what "restored on
      // blur with no pick" already relies on, so this is the same rule.
      inputRef.current?.blur();
    },
    [onSelectBuiltIn, onSelectRemote],
  );

  /** The chevron's own click handler — "the explicit way to open" the browse list (the task's own framing): clears any typed query and opens with the full Built-in + Hugging Face groups, exactly like focusing an empty field. */
  const openBrowse = useCallback(() => {
    setQuery("");
    setOpen(true);
    setActive(-1);
    inputRef.current?.focus();
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Nothing behind this overlay gets to see a keystroke aimed at the field.
      e.stopPropagation();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (rows.length === 0) return;
        setOpen(true);
        const step = e.key === "ArrowDown" ? 1 : -1;
        setActive((i) => {
          const next = i < 0 ? (step > 0 ? 0 : rows.length - 1) : i + step;
          return ((next % rows.length) + rows.length) % rows.length;
        });
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const pick = rows[active >= 0 ? active : 0];
        if (pick) choose(pick.result);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        if (listOpen) {
          setOpen(false);
          setActive(-1);
          return;
        }
        setQuery("");
        setActive(-1);
      }
    },
    [active, choose, listOpen, rows],
  );

  // "No match" is scoped to the Hugging Face HALF of the list — a Built-in
  // match can still be showing above it, so this only fires once the live
  // search has settled (not busy, no error) AND neither it nor a local
  // curated match found anything, never merely because the debounce
  // hasn't fired yet for a short query.
  const noRemoteMatch =
    !parsed &&
    trimmed.length > 0 &&
    remoteSettled &&
    !remoteError &&
    remote.length === 0 &&
    filteredSuggestions.length === 0;
  const note =
    remoteError ?? (remoteBusy ? "Searching Hugging Face…" : noRemoteMatch ? "No match on Hugging Face." : null);
  const displayValue = focused ? query : loadedTitle;

  return (
    <div className="charts-dataset-search" role="search">
      <div className="instrument-search-field">
        <span className="instrument-search-glyph" aria-hidden="true">
          {">"}
        </span>
        <input
          ref={inputRef}
          type="text"
          className="instrument-search-input"
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && rows[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search datasets…"
          title="Browse the built-in datasets or search Hugging Face, or paste a dataset URL/id. Typed text (other than a pasted URL/id) is sent to huggingface.co."
          value={displayValue}
          onFocus={() => {
            setFocused(true);
            setQuery("");
            setOpen(true);
            setActive(-1);
          }}
          onChange={(e) => {
            setFocused(true);
            setQuery(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          // A click on a result (or the chevron) fires after blur, so the
          // list has to survive the blur long enough for it to land — the
          // option's/chevron's own `onMouseDown` preventDefault is what
          // stops the blur; this close is deferred for the pointer paths
          // that do blur (tab away, click on the chart).
          onBlur={() => {
            window.setTimeout(() => {
              if (!live.current) return;
              setFocused(false);
              setOpen(false);
            }, 0);
          }}
        />
        {focused && query && (
          <button
            type="button"
            className="instrument-search-clear"
            title="Clear the search"
            aria-label="Clear the search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setQuery("");
              setActive(-1);
              inputRef.current?.focus();
            }}
          >
            ×
          </button>
        )}
        <button
          type="button"
          className="charts-search-chevron"
          aria-label="Browse datasets"
          aria-haspopup="listbox"
          aria-controls={listId}
          aria-expanded={listOpen}
          title="Browse built-in and Hugging Face datasets"
          onMouseDown={(e) => e.preventDefault()}
          onClick={openBrowse}
        >
          ▾
        </button>
      </div>
      {listOpen && rows.length > 0 && (
        <ul className="instrument-search-list" id={listId} role="listbox">
          {rows.map((row, i) => (
            <li key={row.key}>
              {row.heading && (
                <p className="instrument-search-group" role="presentation">
                  {row.heading}
                </p>
              )}
              <button
                type="button"
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                data-dataset-id={row.result.kind === "builtin" ? row.result.dataset.id : undefined}
                className={`instrument-search-option${i === active ? " is-active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(row.result)}
              >
                <span className="instrument-search-name">
                  {row.result.kind === "builtin"
                    ? row.result.dataset.title
                    : parsed && i === 0
                      ? `Load ${row.result.hit.title}`
                      : row.result.hit.title}
                </span>
                {row.result.kind === "builtin" && (
                  <span className="instrument-search-context">{row.result.dataset.description}</span>
                )}
                {row.result.kind === "remote" && row.result.hit.description && (
                  <span className="instrument-search-context">{row.result.hit.description}</span>
                )}
                {row.result.kind === "remote" && typeof row.result.hit.downloads === "number" && (
                  <span className="instrument-search-metric">
                    {row.result.hit.downloads.toLocaleString()} downloads
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {listOpen && note && (
        <p className="instrument-search-note" role="status">
          {note}
        </p>
      )}
      {open && trimmed.length > 0 && !parsed && (
        <p className="instrument-search-egress">
          Searched at{" "}
          <a href="https://huggingface.co/datasets" target="_blank" rel="noreferrer">
            huggingface.co
          </a>{" "}
          — what you type is sent there.
        </p>
      )}
    </div>
  );
}
