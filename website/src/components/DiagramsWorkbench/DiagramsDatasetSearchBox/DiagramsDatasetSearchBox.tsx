/**
 * `/diagrams`' graph dataset search box — mirrors `ChartsWorkbench/
 * ChartsDatasetSearchBox.tsx` almost exactly (packet D5): the SAME
 * `instrument-search-*` field/list/option/group shape
 * `MapsWorkbench/MapSearchBox.tsx` and the charts twin both render through,
 * built-in presets under a "Built-in" heading, curated Hugging Face graph
 * datasets under "Hugging Face", typing narrows both (built-ins locally,
 * Hugging Face merging a local curated match with a live Hub search a beat
 * later), and a pasted URL/bare `org/name` id short-circuits to one "Load
 * `<ref>`" result. The only real difference from the charts version: a
 * built-in "hit" here is a tray preset (`{ id, label }`), which has no
 * description/context line to show — so a Built-in row shows just its
 * title, and Hugging Face rows keep their description/downloads exactly
 * like the charts box's own.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { DIAGRAMS_REMOTE_GRAPH_INDEX } from "../../../features/diagrams/data/remoteGraphIndex";
import {
  parseDatasetHitFromQuery,
  searchGraphDatasets,
  type DatasetHit,
  type GraphDatasetSearchFetch,
} from "../../../features/diagrams/services/graphDatasetSearch";

export const DIAGRAMS_DATASET_SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY = 2;

export interface DiagramsBuiltInGraph {
  readonly id: string;
  readonly label: string;
}

type DiagramsBrowseResult =
  | { readonly kind: "builtin"; readonly preset: DiagramsBuiltInGraph }
  | { readonly kind: "remote"; readonly hit: DatasetHit };

interface DiagramsBrowseRow {
  readonly key: string;
  readonly result: DiagramsBrowseResult;
  readonly heading?: string;
}

export interface DiagramsDatasetSearchBoxProps {
  readonly builtIn: readonly DiagramsBuiltInGraph[];
  readonly loadedTitle: string;
  readonly onSelectBuiltIn: (id: string) => void;
  readonly onSelectRemote: (hit: DatasetHit) => void;
  search?: (
    query: string,
    options: { fetchJson?: GraphDatasetSearchFetch; signal?: AbortSignal },
  ) => Promise<readonly DatasetHit[]>;
  suggestions?: readonly DatasetHit[];
}

export function DiagramsDatasetSearchBox({
  builtIn,
  loadedTitle,
  onSelectBuiltIn,
  onSelectRemote,
  search = searchGraphDatasets,
  suggestions = DIAGRAMS_REMOTE_GRAPH_INDEX,
}: DiagramsDatasetSearchBoxProps) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [remote, setRemote] = useState<readonly DatasetHit[]>([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
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

  const filteredBuiltIn = useMemo(() => {
    if (!trimmed) return builtIn;
    const q = trimmed.toLowerCase();
    return builtIn.filter((p) => p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
  }, [builtIn, trimmed]);

  const filteredSuggestions = useMemo(() => {
    if (!trimmed) return suggestions;
    const q = trimmed.toLowerCase();
    return suggestions.filter((s) => s.title.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
  }, [suggestions, trimmed]);

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
    }, DIAGRAMS_DATASET_SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, parsed, open]);

  const rows = useMemo<readonly DiagramsBrowseRow[]>(() => {
    if (parsed) return [{ key: parsed.ref, result: { kind: "remote", hit: parsed } }];
    const out: DiagramsBrowseRow[] = [];
    filteredBuiltIn.forEach((preset, i) => {
      out.push({
        key: `b:${preset.id}`,
        result: { kind: "builtin", preset },
        heading: i === 0 ? "Built-in" : undefined,
      });
    });
    const merged = trimmed
      ? [...remote, ...filteredSuggestions.filter((s) => !remote.some((r) => r.ref === s.ref))]
      : filteredSuggestions;
    merged.forEach((hit, i) =>
      out.push({ key: `h:${hit.ref}`, result: { kind: "remote", hit }, heading: i === 0 ? "Hugging Face" : undefined }),
    );
    return out;
  }, [parsed, filteredBuiltIn, trimmed, filteredSuggestions, remote]);

  const listOpen = open && (rows.length > 0 || (trimmed.length > 0 && !parsed));

  const choose = useCallback(
    (result: DiagramsBrowseResult) => {
      setQuery("");
      setOpen(false);
      setActive(-1);
      if (result.kind === "builtin") onSelectBuiltIn(result.preset.id);
      else onSelectRemote(result.hit);
      inputRef.current?.blur();
    },
    [onSelectBuiltIn, onSelectRemote],
  );

  const openBrowse = useCallback(() => {
    setQuery("");
    setOpen(true);
    setActive(-1);
    inputRef.current?.focus();
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
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
    <div className="diagrams-dataset-search" role="search">
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
          placeholder="Search graph datasets…"
          title="Browse built-in graphs or search Hugging Face's graphs-datasets org, or paste a dataset URL/id. Typed text (other than a pasted URL/id) is sent to huggingface.co."
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
          className="diagrams-search-chevron"
          aria-label="Browse graph datasets"
          aria-haspopup="listbox"
          aria-controls={listId}
          aria-expanded={listOpen}
          title="Browse built-in and Hugging Face graph datasets"
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
                data-preset-id={row.result.kind === "builtin" ? row.result.preset.id : undefined}
                className={`instrument-search-option${i === active ? " is-active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(row.result)}
              >
                <span className="instrument-search-name">
                  {row.result.kind === "builtin"
                    ? row.result.preset.label
                    : parsed && i === 0
                      ? `Load ${row.result.hit.title}`
                      : row.result.hit.title}
                </span>
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
          <a href="https://huggingface.co/datasets?other=graph-ml" target="_blank" rel="noreferrer">
            huggingface.co
          </a>{" "}
          — what you type is sent there.
        </p>
      )}
    </div>
  );
}
