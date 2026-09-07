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
 * ## Where the results come from — two halves, blended
 *
 * `mapsSearch.ts` owns the LOCAL index (Natural Earth's 242 countries and
 * 1,251 places, baked into this repo), the ranking and the flight;
 * `mapsGeocode.ts` owns the REMOTE half (Photon, over live OpenStreetMap).
 * This file owns only what a reader touches.
 *
 * The two are BLENDED, never swapped. The local index is instant, works
 * offline and cannot fail, so its hits are computed on every keystroke and
 * listed first; the OSM hits are appended under their own heading, so a reader
 * can always tell which is which. That order is the whole argument: the fast
 * half never waits on the slow one, and the slow one going away — a dropped
 * network, a rate limit, a malformed body — takes nothing with it
 * (`geocodeMapSearch` never throws; see its own contract).
 *
 * The local index is built LAZILY, on the first focus or keystroke, and at
 * most once: it sweeps ~230 tiles (~1 MB) out of the two point pyramids, which
 * no reader who never opens the search box should pay for.
 *
 * ## What leaves the machine, and when
 *
 * Only the remote half sends anything, and it is gated four ways:
 * {@link MAP_GEOCODE_MIN_QUERY} characters, a {@link MAP_GEOCODE_DEBOUNCE_MS}
 * trailing debounce, no request at all for a query the local index already
 * answers exactly (`mapGeocodeShouldQuery`), and an `AbortController` that
 * drops the in-flight request the moment the query changes or the list
 * closes. The reader is told: the disclosure line under the field is rendered
 * from the moment the box is focused — before the first keystroke — and it
 * names the service and carries the OSM credit, which the map's own
 * attribution line cannot, because `createGlyphMap` derives that from mounted
 * LAYERS and a geocoder is not one.
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
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  MAP_SEARCH_LIMIT,
  mapSearchFold,
  searchMapIndex,
  type MapSearchIndex,
  type MapSearchResult,
} from "./mapsSearch";
import {
  MAP_GEOCODE_ATTRIBUTION,
  MAP_GEOCODE_DEBOUNCE_MS,
  geocodeMapSearch,
  mapGeocodeShouldQuery,
  type MapGeocodeOutcome,
  type MapGeocodeRequest,
  type MapGeocodeView,
} from "./mapsGeocode";
import { formatPeople } from "./mapsKit";

export interface MapSearchBoxProps {
  /** Builds the local index. Called at most once, and only once the reader engages. */
  loadIndex: () => Promise<MapSearchIndex>;
  /** A result was chosen — fly there. */
  onSelect: (result: MapSearchResult) => void;
  /**
   * What the map is looking at right now, for the geocoder's location bias.
   * Read at REQUEST time (not at render time) so the bias is the reader's
   * current view, not whatever it was when they focused the field. Returning
   * `null` — or omitting this entirely — simply drops the bias.
   */
  getView?: () => MapGeocodeView | null;
  /** Transport seam for the remote half. Defaults to {@link geocodeMapSearch}; injected by tests, which must never touch the network. */
  geocode?: (request: MapGeocodeRequest) => Promise<MapGeocodeOutcome>;
}

/** The right-hand column: an OSM row says WHAT it is, a place states its population, a country states that it is one. All three are what tells two same-named rows apart. */
function metricOf(result: MapSearchResult): string {
  if (result.kind === "osm") return result.metric ?? "osm";
  return result.kind === "country" ? "country" : formatPeople(result.prominence);
}

export function MapSearchBox({ loadIndex, onSelect, getView, geocode }: MapSearchBoxProps) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState<MapSearchIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [remote, setRemote] = useState<readonly MapSearchResult[]>([]);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // The in-flight (or settled) build. A ref, not state: "have we started" must
  // be true the instant the first focus fires, or a focus and the keystroke
  // right behind it both start a sweep.
  const requested = useRef(false);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  // Held in refs so the geocoding effect below depends only on the QUERY.
  // Otherwise a parent that re-creates either callback per render would abort
  // and re-issue the request on every render it does.
  const getViewRef = useRef(getView);
  getViewRef.current = getView;
  const geocodeRef = useRef(geocode);
  geocodeRef.current = geocode;

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

  const local = useMemo(
    () => (index ? searchMapIndex(index, query, MAP_SEARCH_LIMIT) : []),
    [index, query],
  );
  const listOpen = open && query.trim().length > 0;

  /**
   * Whether the local index answered this query with a result whose whole
   * NAME is the query — a boolean rather than the array itself, so the
   * geocoding effect re-runs on a change of ANSWER, not on every re-render
   * that produces a fresh array.
   */
  const localExact = useMemo(() => {
    const folded = mapSearchFold(query);
    return folded.length > 0 && local.some((r) => mapSearchFold(r.name) === folded);
  }, [local, query]);

  useEffect(() => {
    const q = query.trim();
    if (!open || !mapGeocodeShouldQuery(q, localExact)) {
      setRemote([]);
      setRemoteBusy(false);
      setRemoteError(null);
      return;
    }
    // Stale rows are worse than no rows: they answer a query the reader has
    // already typed past. The LOCAL half is untouched here and keeps updating
    // on every keystroke, so the list never goes empty while this waits.
    setRemote([]);
    setRemoteError(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setRemoteBusy(true);
      void (geocodeRef.current ?? geocodeMapSearch)({
        query: q,
        view: getViewRef.current?.() ?? null,
        signal: controller.signal,
      }).then(
        (outcome) => {
          if (!live.current || controller.signal.aborted || outcome.kind === "aborted") return;
          setRemoteBusy(false);
          if (outcome.kind === "failed") { setRemoteError(outcome.reason); return; }
          setRemote(outcome.results);
        },
        // `geocodeMapSearch` resolves every failure mode itself and never
        // rejects. This arm exists because `geocode` is a PROP: an injected
        // transport is somebody else's code, and a rejection escaping here
        // would be an unhandled rejection rather than a note under the list.
        () => {
          if (!live.current || controller.signal.aborted) return;
          setRemoteBusy(false);
          setRemoteError("OpenStreetMap search unavailable");
        },
      );
    }, MAP_GEOCODE_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      // Drops the in-flight request the moment the query changes: the answer
      // is already worthless, and Photon should not be finishing it.
      controller.abort();
    };
  }, [query, localExact, open]);

  /** Local first, OSM appended. One flat array so the keyboard model and `aria-activedescendant` stay index-based. */
  const results = useMemo(() => [...local, ...remote], [local, remote]);

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
      // A geocoder outage is reported UNDER the local results, never instead
      // of them — the local half is still a complete, correct answer to the
      // part of the question it covers.
      : remoteError
        ? `${remoteError} — showing countries and cities only.`
        : remoteBusy
          ? "Searching OpenStreetMap…"
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
          placeholder="Search a place, street or landmark"
          title="Fly to a country, city, street, landmark or address. Countries and cities come from Natural Earth's own baked pyramids; streets and landmarks are looked up at photon.komoot.io, which means what you type is sent there."
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
            <Fragment key={result.id}>
              {/* The seam between the two halves, named. Emitted once, before
                  the first OSM row, so the reader can see which results are
                  baked into the page and which came off the network. */}
              {result.kind === "osm" && results[i - 1]?.kind !== "osm" && (
                <li className="maps-search-group" role="presentation">OpenStreetMap</li>
              )}
              <li
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
            </Fragment>
          ))}
        </ul>
      )}
      {listOpen && note && <p className="maps-search-note">{note}</p>}
      {/* Rendered from the moment the field is focused — BEFORE the first
          keystroke — because a disclosure that only appears after the request
          has gone is not a disclosure. It doubles as the OSM credit: the map's
          own attribution line is derived from mounted layers, and a geocoder
          is not one. */}
      {open && (
        <p className="maps-search-egress">
          Streets and landmarks are looked up at{" "}
          <a href="https://photon.komoot.io" target="_blank" rel="noreferrer">photon.komoot.io</a>
          {" "}— what you type is sent there. Data:{" "}
          {MAP_GEOCODE_ATTRIBUTION.map((credit, i) => (
            <span key={credit.name}>
              {i > 0 && " · "}
              <a href={credit.url} target="_blank" rel="noreferrer">{credit.name}</a>
              {credit.license ? ` (${credit.license})` : ""}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
