/**
 * /maps's place search — a type-ahead that OVERLAYS the map, top centre.
 *
 * ## Where it sits
 *
 * An overlay, not a bar in the document flow: `position: absolute` inside
 * `InstrumentMain`, at `var(--overlay-top)`, centred. That is the page's own
 * overlay system — the gallery's `.dn-floating-controls` (top/right, `z-index:
 * 20`, `pointer-events: auto`) and this page's own `.synth-export-bar`
 * (bottom/left) are the two siblings it is built to match; this one is the
 * same idiom with `left: 50%` + a translate instead of an edge inset. The
 * element covers only its own box, so the rest of the map surface keeps every
 * drag and wheel gesture — there is no transparent full-viewport layer here to
 * swallow them.
 *
 * A "Jump to" list used to live in the right rail and was removed on request
 * ("remove the jump to from the right sidebar"). This is not that list coming
 * back into a panel: it is chrome ON the map, the way a map's search box is
 * everywhere else.
 *
 * ## Where the results come from
 *
 * `mapsSearch.ts` owns the index, the ranking and the flight — everything
 * with a right answer. This file owns only what a reader touches. The index is
 * built LAZILY, on the first focus or keystroke, and at most once: it sweeps
 * ~230 tiles (~1 MB) out of the two point pyramids, which no reader who never
 * opens the search box should pay for.
 *
 * ## Keyboard
 *
 * ArrowDown/ArrowUp move through the list and WRAP; Enter selects the
 * highlighted result, or the top one when nothing is highlighted (the
 * common case: type three letters, press Enter); Escape closes the list and,
 * pressed again on a closed list, clears the field. Every keydown is stopped
 * at this input — the widget itself binds no key handlers, but Starlight's
 * shell does (its `/` search shortcut lives on the document), and a search box
 * whose keystrokes reach a second search box is a real defect, not a
 * hypothetical one.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  MAP_SEARCH_LIMIT,
  searchMapIndex,
  type MapSearchIndex,
  type MapSearchResult,
} from "./mapsSearch";
import { formatPeople } from "./mapsKit";

export interface MapSearchBoxProps {
  /** Builds the index. Called at most once, and only once the reader engages. */
  loadIndex: () => Promise<MapSearchIndex>;
  /** A result was chosen — fly there. */
  onSelect: (result: MapSearchResult) => void;
}

/** The right-hand column: a place states its population, a country states that it is one. Both are what tells two same-named rows apart. */
function metricOf(result: MapSearchResult): string {
  return result.kind === "country" ? "country" : formatPeople(result.prominence);
}

export function MapSearchBox({ loadIndex, onSelect }: MapSearchBoxProps) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<MapSearchIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The in-flight (or settled) build. A ref, not state: "have we started" must
  // be true the instant the first focus fires, or a focus and the keystroke
  // right behind it both start a sweep.
  const requested = useRef(false);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const ensureIndex = useCallback(() => {
    if (requested.current) return;
    requested.current = true;
    setLoading(true);
    loadIndex().then(
      (built) => { if (live.current) { setIndex(built); setLoading(false); } },
      (err: unknown) => {
        if (!live.current) return;
        setLoading(false);
        setError(err instanceof Error ? err.message : String(err));
      },
    );
  }, [loadIndex]);

  const results = useMemo(
    () => (index ? searchMapIndex(index, query, MAP_SEARCH_LIMIT) : []),
    [index, query],
  );
  const listOpen = open && query.trim().length > 0;

  const choose = useCallback((result: MapSearchResult) => {
    setQuery(result.name);
    setOpen(false);
    setActive(-1);
    onSelect(result);
  }, [onSelect]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Nothing behind this overlay gets to see a keystroke aimed at the field.
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
      // First Escape retreats from the list; a second one — with nothing left
      // to close — empties the field. Never blurs: a reader who overshot
      // should be able to keep typing.
      if (listOpen) { setOpen(false); setActive(-1); return; }
      setQuery("");
      setActive(-1);
    }
  }, [active, choose, listOpen, results]);

  const note = error
    ? `Search unavailable: ${error}`
    : loading && query.trim()
      ? "Loading places…"
      : index && query.trim() && results.length === 0
        ? "No match"
        : null;

  return (
    <div className="maps-search" role="search">
      <div className="maps-search-field">
        <span className="maps-search-glyph" aria-hidden="true">{">"}</span>
        <input
          ref={inputRef}
          type="text"
          className="maps-search-input"
          role="combobox"
          aria-expanded={listOpen && results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 && results[active] ? `${listId}-${active}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search a place or country"
          title="Fly to a country or city. Natural Earth's own 242 admin-0 label points and 1,251 populated places; the flight levels the map's tilt so the destination lands on screen."
          value={query}
          onFocus={() => { ensureIndex(); setOpen(true); }}
          onChange={(e) => { ensureIndex(); setQuery(e.target.value); setOpen(true); setActive(-1); }}
          onKeyDown={onKeyDown}
          // A click on a result fires after blur, so the list has to survive
          // the blur long enough for the click to land — the option's own
          // `onMouseDown` preventDefault is what stops the blur, and this
          // close is deferred for the pointer paths that do blur (tab away,
          // click on the map).
          onBlur={() => { window.setTimeout(() => { if (live.current) setOpen(false); }, 0); }}
        />
        {query && (
          <button
            type="button"
            className="maps-search-clear"
            title="Clear the search"
            aria-label="Clear the search"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { setQuery(""); setActive(-1); inputRef.current?.focus(); }}
          >
            ×
          </button>
        )}
      </div>
      {listOpen && results.length > 0 && (
        <ul className="maps-search-list" id={listId} role="listbox">
          {results.map((result, i) => (
            <li
              key={result.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={`maps-search-option${i === active ? " is-active" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(result)}
            >
              <span className="maps-search-name">{result.name}</span>
              <span className="maps-search-context">{result.context}</span>
              <span className={`maps-search-metric maps-search-metric--${result.kind}`}>{metricOf(result)}</span>
            </li>
          ))}
        </ul>
      )}
      {listOpen && note && <p className="maps-search-note">{note}</p>}
    </div>
  );
}
