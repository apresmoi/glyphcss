import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { glyphChartSeriesPreview, renderGlyphChart, type GlyphChartSeriesPreviewEntry } from "@glyphcss/charts";
import { Dock } from "../Dock/Dock";
import { CodePanel } from "../GalleryWorkbench/CodePanel";
import {
  InstrumentBody, InstrumentMain, InstrumentMobileTabs, InstrumentRail,
  InstrumentShell, InstrumentTray, InstrumentViewport,
} from "../InstrumentWorkbench/InstrumentWorkbench";
import { downloadGlyphSvg } from "../../lib/glyphSvgExport";
import { readUrlParam, writeUrlParam } from "../../lib/urlState";
import { isAbort, loadDatasetRows } from "../../lib/datasetLoad";
import { parseDatasetHitFromQuery, type DatasetHit } from "../../lib/datasetSearch";
import { TargetPreview } from "../TargetPreview/TargetPreview";
import { ChartsDataOverlay } from "./ChartsDataOverlay";
import { ChartsDataFolder } from "./ChartsDataFolder";
import { pushRecentRemoteDataset } from "./ChartsDatasetSearchBox";
import { ChartsDock } from "./ChartsDock";
import { ChartsMarkCard } from "./ChartsMarkCard";
import {
  CHART_PRESETS, CHARTS_DENSITY_BASE_FONT_PX, chartsWorkbenchEffectiveDensity, createChartsWorkbenchState,
  findChartsDataset, generateChartsWorkbenchSnippets, randomChartsDatasetId, reduceChartsWorkbenchState, remoteDatasetRecommendationCheck,
  resolveGlyphChartsWorkbenchControls, type ChartsWorkbenchState,
} from "./chartsWorkbenchState";
import { CHARTS_URL_PARAM, chartsUrlStateResolveDataset, createChartsUrlWriter, decodeChartsUrlState, encodeChartsUrlStateInfo } from "./chartsUrlState";
import { buildStyledChartsWorkbenchSpec, chartsWorkbenchDisplayRender, renderChartsWorkbenchState, type ChartsWorkbenchRender } from "./chartsWorkbenchRender";
import "../GalleryWorkbench/gallery-workbench.css";
import "./charts-workbench.css";

type MobilePanel = "data" | "controls" | "presets" | "export";
const EXPORT_TABS = [{ id: "typescript", label: "TypeScript" }, { id: "json", label: "JSON" }] as const;

/**
 * A copy/export confirmation lives on the CLICKED BUTTON's own label — the
 * `CodePanel.tsx`/`SynthWorkbench.tsx` idiom ("the user's own words: the
 * confirmations when I copy... it shouldn't be in the rendering area") —
 * never a separate element that could shift the layout around it. `idle`
 * reverts automatically after `ms`.
 */
function flashButtonState<T extends string>(setState: (value: T) => void, idle: T, value: T, ms = 1200): void {
  setState(value);
  window.setTimeout(() => setState(idle), ms);
}

/**
 * `/charts` is a SHOWCASE, not a builder (the user's own framing) — mirrors
 * `/gallery`'s own `resolveInitialPreset`/`randomPreset`: with no `?c=`
 * link to restore, the page always opens on a random vendored dataset's own
 * curated chart, rather than the empty/default preset a builder would
 * start from. `createChartsWorkbenchState()` (no dataset) stays exactly
 * what it always was — the historical-link regression pin
 * (`chartsUrlState.test.ts`) and every test that wants a fixed, dataset-free
 * starting point still get it — this is the ONE new entry point that layers
 * a real dataset selection on top via the same `select-dataset` reducer
 * action the rail's own dropdown and "Random" button dispatch.
 */
function createRandomChartsWorkbenchState(): ChartsWorkbenchState {
  return reduceChartsWorkbenchState(createChartsWorkbenchState(), { type: "select-dataset", id: randomChartsDatasetId() });
}

/**
 * Gates the FIRST render on the `?c=` URL param (AGENTS.md's "## Charts" —
 * "URL state") so a shared link never flashes the default chart before its
 * own state lands. Decoding a `?c=` param is inherently async (deflate —
 * see jsonUrlState.ts's doc), so this can't be a plain `useReducer` lazy
 * initializer the way `initialState` (tests, `renderToStaticMarkup`) is —
 * but the by-far-common case (no param at all) needs no async gate: the
 * default state IS correct immediately, so only a page actually carrying a
 * `?c=` link ever renders the brief `null` gap below.
 *
 * `initialState` (used by chartsWorkbenchState.test.tsx's
 * `renderToStaticMarkup` and ChartsWorkbench.test.tsx's synchronous mount)
 * bypasses the URL entirely, exactly as before this feature existed.
 */
export default function ChartsWorkbench({ initialState }: { initialState?: ChartsWorkbenchState } = {}) {
  const [resolved, setResolved] = useState<ChartsWorkbenchState | null>(() => {
    if (initialState) return initialState;
    return readUrlParam(CHARTS_URL_PARAM) ? null : createRandomChartsWorkbenchState();
  });
  const [notice, setNotice] = useState<string | undefined>(undefined);
  // Set only when the decoded link named a REMOTE dataset (`data.source.kind
  // === "remote"`) — its rows are never in the link (`chartsUrlState.ts`'s
  // "URL state" doc), so the page mounts on the decoded shell (mark data
  // still blank) and `ChartsWorkbenchInner`'s own mount effect re-fetches
  // this ref immediately, exactly like a fresh search-box selection would.
  const [remoteRef, setRemoteRef] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (initialState || resolved) return;
    let cancelled = false;
    void decodeChartsUrlState(readUrlParam(CHARTS_URL_PARAM)).then((decoded) => {
      if (cancelled) return;
      if (!decoded) { setResolved(createRandomChartsWorkbenchState()); return; }
      // P2-3 (review fix, REVIEW-showcase-opus.md): an unresolvable stock
      // dataset id degrades to a random vendored dataset with a notice,
      // the same graceful fallback a CORRUPT envelope already gets —
      // never a hard `empty-data` render. A remote source is reported the
      // same way but resolved via `remoteRef` below, not a fallback.
      const { state, notice: fallbackNotice, remoteRef: ref } = chartsUrlStateResolveDataset(decoded);
      setResolved(state);
      setNotice(fallbackNotice);
      setRemoteRef(ref);
    });
    return () => { cancelled = true; };
    // Only ever runs once: `resolved` starts non-null (no gate needed) or
    // this effect's own setResolved call makes it non-null on next render,
    // and the guard above then short-circuits for good.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!resolved) return null;
  return <ChartsWorkbenchInner initialState={resolved} initialNotice={notice} initialRemoteRef={remoteRef} />;
}

function ChartsWorkbenchInner({ initialState, initialNotice, initialRemoteRef }: { initialState: ChartsWorkbenchState; initialNotice?: string; initialRemoteRef?: string }) {
  const [state, dispatch] = useReducer(reduceChartsWorkbenchState, initialState);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  // Dataset-level notices (a failed remote load, a truncated sample, an
  // unresolvable link falling back to a random dataset) live as a quiet
  // line on the rail's dataset card, never over the render — the user's own
  // words: "it shouldn't be in the rendering area". `initialNotice`
  // (seeded from a `?c=` link that had to fall back) must survive the
  // first commit; the plain `useEffect(() => setDatasetNotice(""), [state])`
  // below also runs on mount (React effects always fire after the first
  // commit), so this guard skips exactly that first run.
  const [datasetNotice, setDatasetNotice] = useState(initialNotice ?? "");
  const datasetNoticeClearedOnce = useRef(false);
  // The dataset currently being fetched, or `undefined` when idle — the
  // rail shows this title with a spinner glyph (no "Loading…" word) and the
  // viewport dims + pulses the LAST GOOD render rather than going blank.
  const [remoteLoadingTitle, setRemoteLoadingTitle] = useState<string | undefined>(undefined);
  const preRef = useRef<HTMLPreElement | null>(null);
  const rendered = useMemo(() => renderChartsWorkbenchState(state), [state]);
  // The viewport's own content: the CURRENT render when it's valid, else
  // whatever last rendered OK — so a config error (Dock controls, a bad
  // legacy link) dims the frame instead of collapsing it. Mutated during
  // render, not in an effect: the value must be current for THIS render's
  // JSX, and re-storing the same reference on every ok render is idempotent.
  const lastGoodRenderRef = useRef<Extract<ChartsWorkbenchRender, { ok: true }> | null>(null);
  if (rendered.ok) lastGoodRenderRef.current = rendered;
  const displayRendered = chartsWorkbenchDisplayRender(rendered, lastGoodRenderRef.current);
  const isRemoteLoading = remoteLoadingTitle !== undefined;
  const isViewportStale = !rendered.ok || isRemoteLoading;
  // Density (task's own framing: "the same shapes with more character
  // density") — web only, mirrors glyphcss's own per-mesh `density`
  // (AGENTS.md's "Per-mesh detail layers"): the RENDER grid grows by the
  // multiplier (`chartsWorkbenchRenderOptions`, `chartsWorkbenchState.ts`)
  // while this `font-size` shrinks by the same factor, so the `<pre>`'s
  // on-screen box holds still — only its picture sharpens. `undefined` at
  // density 1 (the overwhelming default) keeps the `<pre>` byte-identical
  // to before this control existed, never an inline `font-size: 13px`
  // fighting the CSS rule that already says so.
  const density = chartsWorkbenchEffectiveDensity(state.controls);
  const densityStyle = density !== 1 ? { fontSize: `calc(${CHARTS_DENSITY_BASE_FONT_PX}px / ${density})`, lineHeight: 1 } : undefined;
  // Copy ASCII/Copy ANSI must read the LOGICAL (density 1) render, not the
  // dense one (CHARTS-RESEARCH `REVIEW-batch4-fable.md` F-P1-5): the
  // plain-text/ANSI exits ignore `textScale` by contract (AGENTS.md's
  // "Charts" "Density" — "The plain-text/ANSI exits … ignore textScale
  // entirely"), so a dense grid's own `text`/`ansi` shows a scaled
  // label's origin glyph plus its now-real filler blanks verbatim —
  // `N a t i o n a l` instead of `National`. Density's own on-screen box
  // holds still while the picture sharpens (this file's own `densityStyle`
  // doc), so what a reader is LOOKING at is not what Copy should hand
  // them; a second density-1 render (skipped entirely at density 1, the
  // overwhelming default) recovers the readable text.
  const logicalRendered = useMemo(
    () => (density === 1 ? rendered : renderChartsWorkbenchState({
      ...state, controls: { ...state.controls, overrides: { ...state.controls.overrides, density: 1 } },
    })),
    [state, density, rendered],
  );
  // Fed to every `ChartsMarkCard`'s colour swatches (P2-3/P2-4/P2-5,
  // REVIEW-dock-colours-sliders-opus.md) — computed on the SAME styled
  // spec the real render uses, so a swatch always shows the colour that
  // spec actually paints (prefill included) rather than a page-side
  // re-derivation that can diverge from it (a numeric `fill`, a `group`
  // transform, a short colour array's cycled entry). `[]` on an invalid
  // spec (bad mark JSON mid-edit) — every card then falls back to
  // `CHARTS_DEFAULT_SWATCH_COLOR`.
  // P3-6 — dims every mark-card swatch (with a reason) under `Color: none`,
  // mirroring the Chart folder's own axis-colour swatches (`ChartsDock.tsx`).
  const colorDisabled = resolveGlyphChartsWorkbenchControls(state.controls).color === "none";
  // NEW-8 (REVIEW-dock-colours-sliders-opus-round2.md): the preview takes
  // the SAME `color` the real render will use, so `Color: none` returns a
  // `null` colour per series (never a colour the render itself won't
  // paint) — `ChartsMarkColorControls` reads that `null` for its swatch's
  // OWN display fallback, and `colorDisabled` above still drives the
  // `disabled`/reason attributes (a distinct concern from what to SHOW).
  const seriesPreview = useMemo<readonly GlyphChartSeriesPreviewEntry[]>(() => {
    try { return glyphChartSeriesPreview(buildStyledChartsWorkbenchSpec(state), { color: colorDisabled ? "none" : undefined }); }
    catch { return []; }
  }, [state, colorDisabled]);
  const thumbnails = useMemo(() => CHART_PRESETS.map((preset) => renderGlyphChart(preset.spec, { target: state.controls.target, width: 24, height: 8 }).text), [state.controls.target]);
  const snippets = useMemo(() => {
    try { return generateChartsWorkbenchSnippets(state); }
    catch { return null; }
  }, [state]);
  // One writer for the component's lifetime — see chartsUrlState.ts's doc
  // (150ms debounced, `history.replaceState`-only, skip-when-unchanged). No
  // size-warning readout lives on this page any more (unreachable through
  // its own UI — a stock dataset's mark data is always omitted from the
  // link and a remote dataset carries only a `ref`, so a normal `?c=` link
  // never approaches the warn threshold; `encodeChartsUrlStateInfo`'s own
  // `tooLarge` safety net for a hand-built/legacy "custom" source link
  // stays, surfaced on the Copy link button itself below), so the writer
  // needs no callback.
  const urlWriter = useRef(createChartsUrlWriter()).current;
  useEffect(() => { urlWriter(state); }, [state, urlWriter]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMobilePanel(null); setCodeOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // A notice set IN THE SAME SYNCHRONOUS SCOPE as a `dispatch` call (a
  // failed/truncated remote load, an unresolvable link's fallback — all
  // below) must survive the state change it rides in on: React 18 batches
  // both `setDatasetNotice` and `dispatch` into ONE commit, so the effect
  // right below would otherwise see `state` as freshly "changed" on that
  // very commit and wipe the notice before a reader ever saw it. Set
  // alongside `setDatasetNotice` at each such call site; the clearing
  // effect consumes (and skips) it exactly once.
  const skipNextNoticeClear = useRef(false);
  useEffect(() => {
    if (!datasetNoticeClearedOnce.current) { datasetNoticeClearedOnce.current = true; return; }
    if (skipNextNoticeClear.current) { skipNextNoticeClear.current = false; return; }
    setDatasetNotice("");
  }, [state]);
  useEffect(() => {
    if (!datasetNotice) return;
    const timer = window.setTimeout(() => setDatasetNotice(""), 1800);
    return () => window.clearTimeout(timer);
  }, [datasetNotice]);

  // Dataset search (glyphcss dataset-search feature): loads a chosen hit
  // off-network (`lib/datasetLoad.ts`) and commits it with ONE synchronous
  // dispatch (`select-remote-dataset`, `chartsWorkbenchState.ts`) once the
  // rows land — a reducer action can't itself be async. A failed load
  // (gated/404/network/too-big/not-tabular — every `DatasetLoadResult`
  // kind) falls back to a random VENDORED dataset with the error named in
  // the rail's dataset-notice line, rather than leaving the page on a
  // stale or half-loaded chart.
  //
  // P2-5 (REVIEW-arc-density-search-opus.md): two picks in a row used to
  // race — no `signal` and no in-flight guard meant the LAST LOAD TO
  // SETTLE won (clearing the loading title and dispatching last), not the
  // last one clicked, and the loads are genuinely not fast (the siblings
  // fallback is 3 sequential requests). `remoteLoadController` holds the
  // current in-flight `AbortController` (aborted at the top of every new
  // call and on unmount) and `remoteLoadSeq` is a generation counter — a
  // settled result whose sequence number is no longer current is dropped
  // rather than touching `remoteLoadingTitle`/`datasetNotice`/`dispatch`,
  // so the load a reader is actually waiting on is always the one that wins.
  const remoteLoadController = useRef<AbortController | null>(null);
  const remoteLoadSeq = useRef(0);
  useEffect(() => () => remoteLoadController.current?.abort(), []);
  // P1-4 (CHARTS-RESEARCH `REVIEW-batch4-codex.md`): the generation guard
  // above only ever protected a remote load against a LATER remote load —
  // picking a STOCK dataset (the overlay's own `<select>`, or "Random")
  // while a remote fetch is still in flight left `remoteLoadSeq`
  // untouched, so the stock pick landed and then the STALE remote result
  // resolved on top of it, silently replacing what the reader just chose.
  // Both stock-pick paths call this before their own `select-dataset`
  // dispatch, so any in-flight remote load's `seq !== remoteLoadSeq.current`
  // check (inside `loadRemoteDataset`, below) discards it on arrival —
  // the same generation mechanism a second remote pick already used,
  // just armed from one more place.
  const cancelInFlightRemoteLoad = useCallback(() => {
    remoteLoadController.current?.abort();
    remoteLoadController.current = null;
    remoteLoadSeq.current += 1;
    // The superseded load's own `if (seq !== remoteLoadSeq.current) return;`
    // early-return (inside `loadRemoteDataset`, below) skips its
    // `setRemoteLoadingTitle(undefined)` call too — by design, since a
    // NEWER remote load already overwrites the title with its own before
    // that matters. A stock pick sets no such replacement, so without this
    // the rail's "Loading stub/demo ⟳" readout would stay stuck on screen
    // showing a fetch nothing is still waiting on.
    setRemoteLoadingTitle(undefined);
  }, []);
  const loadRemoteDataset = useCallback(async (hit: DatasetHit) => {
    remoteLoadController.current?.abort();
    const controller = new AbortController();
    remoteLoadController.current = controller;
    const seq = ++remoteLoadSeq.current;
    setRemoteLoadingTitle(hit.title);
    let result: Awaited<ReturnType<typeof loadDatasetRows>>;
    try {
      result = await loadDatasetRows(hit, { signal: controller.signal });
    } catch (error) {
      if (seq !== remoteLoadSeq.current) return; // superseded while in flight — nothing to report
      setRemoteLoadingTitle(undefined);
      // An aborted load (superseded by a later pick, or the component
      // unmounting) rejects rather than resolving `{ ok: false }` — a
      // newer load (or nothing) already owns the UI, so there's nothing
      // to report and nothing to touch.
      if (isAbort(error)) return;
      // codex P2-13 (`REVIEW-batch4-codex.md`): every OTHER throw used to
      // be treated the same as an abort — a body-read failure after a
      // real HTTP 200 (`datasetLoad.ts`'s own P2-13 fix converts that one
      // specific case to a structured result, but this branch stays
      // honest about the general case: nothing guarantees every future
      // failure mode inside the loader is caught there too) silently
      // cleared the loading state with no notice and no fallback — the
      // SAME feedback a structured `!result.ok` failure gets, below.
      skipNextNoticeClear.current = true;
      dispatch({ type: "select-dataset", id: randomChartsDatasetId() });
      setDatasetNotice(`Couldn't load "${hit.title}": ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (seq !== remoteLoadSeq.current) return; // superseded while in flight
    setRemoteLoadingTitle(undefined);
    if (!result.ok) {
      skipNextNoticeClear.current = true;
      dispatch({ type: "select-dataset", id: randomChartsDatasetId() });
      setDatasetNotice(`Couldn't load "${hit.title}": ${result.error}`);
      return;
    }
    // P2-3: a load can succeed and still have NO usable chart at all —
    // every column reads as category/boolean (`mstz/mushroom`'s real
    // shape). Checked before either the dispatch or `pushRecentRemoteDataset`
    // so a dataset nothing can be charted from is never dispatched (which
    // would silently no-op — `chartsWorkbenchState.ts`'s A1 guard) and
    // never recorded as Recent, and the reader sees exactly why nothing
    // changed instead of a mute loading state that just goes away.
    const check = remoteDatasetRecommendationCheck(result.rows);
    if (!check.ok) {
      setDatasetNotice(`Couldn't pick a chart for "${hit.title}": columns ${check.columns.join(", ")}.`);
      return;
    }
    pushRecentRemoteDataset(hit);
    dispatch({ type: "select-remote-dataset", ref: hit.ref, title: hit.title, description: hit.description ?? "", source: result.source, rows: result.rows });
    if (result.truncated) {
      skipNextNoticeClear.current = true;
      setDatasetNotice(`Loaded a ${result.rows.length}-row sample of "${hit.title}" (it's larger than this page loads).`);
    }
  }, [dispatch]);

  // A `?c=` link naming a remote dataset carries no rows (see
  // `chartsUrlState.ts`'s "URL state" doc) — the page mounts on the
  // decoded shell immediately and this re-fetches the SAME ref exactly
  // once, so "share a remote-dataset chart" behaves like re-running the
  // search box's own selection rather than needing a second code path.
  const remoteRefLoadedOnMount = useRef(false);
  useEffect(() => {
    if (!initialRemoteRef || remoteRefLoadedOnMount.current) return;
    remoteRefLoadedOnMount.current = true;
    const hit = parseDatasetHitFromQuery(initialRemoteRef);
    if (!hit) {
      skipNextNoticeClear.current = true;
      dispatch({ type: "select-dataset", id: randomChartsDatasetId() });
      setDatasetNotice(`Couldn't resolve "${initialRemoteRef}" — showing a random dataset instead.`);
      return;
    }
    void loadRemoteDataset(hit);
    // Runs once on mount only — `loadRemoteDataset`'s own identity is
    // stable across the reducer's lifetime (it closes only over `dispatch`,
    // which `useReducer` never changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every export/copy action confirms on its OWN button label
  // (`flashButtonState`, above) — the CodePanel/SynthWorkbench idiom —
  // rather than a separate readout, so nothing in the render area moves.
  const [copyAsciiState, setCopyAsciiState] = useState<"idle" | "copied" | "error">("idle");
  const [copyAnsiState, setCopyAnsiState] = useState<"idle" | "copied" | "error">("idle");
  const [copyLinkState, setCopyLinkState] = useState<"idle" | "copied" | "error" | "toolarge">("idle");
  const [downloadState, setDownloadState] = useState<"idle" | "downloaded" | "error">("idle");
  const copy = async (encoding: "ascii" | "ansi") => {
    if (!logicalRendered.ok) return;
    const value = encoding === "ascii" ? logicalRendered.text : logicalRendered.ansi;
    if (value === undefined) return;
    const setState = encoding === "ascii" ? setCopyAsciiState : setCopyAnsiState;
    try { await navigator.clipboard.writeText(value); flashButtonState(setState, "idle", "copied"); }
    catch { flashButtonState(setState, "idle", "error"); }
  };
  // Final-gate-2 review (codex #7): copying `window.location.href` directly
  // copied whatever the 150ms-DEBOUNCED `urlWriter` had last committed —
  // selecting a preset and immediately clicking Copy link copied the
  // PREVIOUS chart's payload, with the address bar catching up only later.
  // Encoding `state` fresh at click time and building the link from that
  // (never re-reading `window.location.href` back, which `writeUrlParam`'s
  // own WebKit burst-safety limiting can defer) makes the copied link
  // always the CURRENT state, independent of the debounce or the address
  // bar's own write timing; `writeUrlParam` still runs too so the visible
  // address bar is brought current in the same click.
  const copyLink = async () => {
    try {
      const { raw, tooLarge } = await encodeChartsUrlStateInfo(state);
      // `tooLarge` (an oversized "Custom…" payload) is unreachable through
      // this page's own UI now — there's no way left to install a custom
      // source — but the reducer/URL layer still accepts one from a
      // hand-built or legacy link, so this stays a real safety net rather
      // than an assumption this branch can't fire; the button itself
      // reports it, in place of the KB-count readout this page used to show.
      if (tooLarge) { flashButtonState(setCopyLinkState, "idle", "toolarge"); return; }
      writeUrlParam(CHARTS_URL_PARAM, raw || null);
      const params = new URLSearchParams(window.location.search);
      if (raw) params.set(CHARTS_URL_PARAM, raw); else params.delete(CHARTS_URL_PARAM);
      const search = params.toString();
      const link = `${window.location.origin}${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
      await navigator.clipboard.writeText(link);
      flashButtonState(setCopyLinkState, "idle", "copied");
    } catch { flashButtonState(setCopyLinkState, "idle", "error"); }
  };
  const download = () => {
    let ok = false;
    try { ok = downloadGlyphSvg(preRef.current, "glyphcss-chart.svg"); } catch { ok = false; }
    flashButtonState(setDownloadState, "idle", ok ? "downloaded" : "error");
  };
  const exportActions = <>
    <button type="button" className="gw-code-panel__action" disabled={!logicalRendered.ok} onClick={() => void copy("ascii")}>
      {copyAsciiState === "copied" ? "Copied" : copyAsciiState === "error" ? "Copy failed" : "Copy ASCII"}
    </button>
    {/* Hidden on `chat` (CHARTS-RESEARCH `DIAGNOSIS-target-matrix.md` C3):
     *  a chat paste shows SGR escapes as literal `\x1b[38;2;…m` text, so
     *  offering this export on a target that can never consume it is a
     *  trap, not a convenience — Copy ASCII (above) is the honest export
     *  there. Gated on `logicalRendered` (not `rendered`) since that is
     *  what `copy("ansi")` actually reads — colour mode, not density,
     *  decides whether ANSI text exists, so the two agree in practice. */}
    {logicalRendered.ok && logicalRendered.ansi !== undefined && state.controls.target !== "chat" && <button type="button" className="gw-code-panel__action" onClick={() => void copy("ansi")}>
      {copyAnsiState === "copied" ? "Copied" : copyAnsiState === "error" ? "Copy failed" : "Copy ANSI"}
    </button>}
    <button type="button" className="gw-code-panel__action" onClick={() => void copyLink()}>
      {copyLinkState === "copied" ? "Copied" : copyLinkState === "error" ? "Copy failed" : copyLinkState === "toolarge" ? "Too large" : "Copy link"}
    </button>
    <button type="button" className="gw-code-panel__action" disabled={!rendered.ok} onClick={download}>
      {downloadState === "downloaded" ? "Downloaded" : downloadState === "error" ? "Download failed" : "Download SVG"}
    </button>
  </>;
  const togglePanel = (panel: MobilePanel) => {
    setCodeOpen(false);
    setMobilePanel((current) => current === panel ? null : panel);
  };

  // Item 2 (owner prompt): a different dataset than the one currently
  // loaded, every click — mirrors GalleryWorkbench.tsx's own
  // `handleRandomPreset`/`randomPreset` idiom (`randomChartsDatasetId`'s
  // own `excludeId`).
  const handleRandomDataset = () => {
    cancelInFlightRemoteLoad(); // P1-4 — see this ref's own doc, above
    const currentId = state.data.source?.kind === "dataset" ? state.data.source.id : undefined;
    dispatch({ type: "select-dataset", id: randomChartsDatasetId(currentId) });
  };
  // P1-4: the overlay's own `<select>` dispatches `select-dataset` DIRECTLY
  // (it has no `loadRemoteDataset` of its own to route through), so this
  // wrapper is what gives that pick the same in-flight-remote cancellation
  // `handleRandomDataset` gets — every other action type passes straight
  // through, unmodified.
  const overlayDispatch = useCallback<typeof dispatch>((action) => {
    if (action.type === "select-dataset") cancelInFlightRemoteLoad();
    dispatch(action);
  }, [cancelInFlightRemoteLoad]);

  // The rail's own header (`InstrumentRail`'s mandatory `.synth-voices-head`
  // chrome) reads the SELECTED dataset's own title rather than a static
  // "Data" label — the user's own follow-up: "the rail's FIRST thing is
  // what the selected dataset is about", with no extra header row spent on
  // a generic label above the card. Falls back to "Data" with nothing
  // loaded yet (a fresh `createChartsWorkbenchState()`, no dataset), and to
  // the in-flight title while a remote load is running (the same title the
  // dataset card's own spinner line shows).
  const activeDatasetId = state.data.source?.kind === "dataset" ? state.data.source.id : undefined;
  const railTitle = remoteLoadingTitle
    ?? (activeDatasetId ? findChartsDataset(activeDatasetId)?.title : undefined)
    ?? (state.data.source?.kind === "remote" ? state.data.source.title : undefined)
    ?? "Data";

  return <InstrumentShell kind="synth" className="charts-shell">
    <InstrumentBody>
      {/* Data is this page's own "model" (AGENTS.md's "Charts" — "Data
       *  layer"): the rail carries the dataset CARD (title, description,
       *  source credit, a read-only "View data" disclosure) as its own
       *  first thing, then the Marks section — no add/remove-mark
       *  controls, this is a showcase of one chart at a time, not a
       *  builder. The dataset SEARCH box, the stock `<select>` and
       *  "Random" moved OFF this rail and onto the chart VIEWPORT as one
       *  overlay bar (`ChartsDataOverlay`, below) — the same chrome-on-
       *  the-render idiom `/maps` uses for its own place search. Picking a
       *  dataset from either control REPLACES the chart immediately
       *  (`select-dataset`/`select-remote-dataset`), no separate Apply
       *  step. */}
      <InstrumentRail id="charts-data-panel" title={railTitle} open={mobilePanel === "data"}>
        <ChartsDataFolder data={state.data} marks={state.marks}
          loadingTitle={remoteLoadingTitle} notice={datasetNotice} renderError={!rendered.ok ? rendered.error : undefined} />
        <div className="charts-marks-section">
          {state.marks.map((mark, index) => <ChartsMarkCard key={mark.id} mark={mark} index={index} series={seriesPreview} colorDisabled={colorDisabled} dispatch={dispatch} />)}
        </div>
      </InstrumentRail>
      <InstrumentMain>
        <InstrumentViewport className="charts-viewport">
          <div className="charts-preview">
            {/* The viewport holds only the render; feedback lives on the
             *  buttons and in the rail (the user's own words: "it shouldn't
             *  be in the rendering area — it moves the chart"). While the
             *  live render is bad or a remote dataset is loading, this stays
             *  on the LAST GOOD render, dimmed (`is-stale`) — pulsing too
             *  (`is-loading`) only while something is actually in flight, so
             *  the frame never collapses or shifts. */}
            <div className={`charts-grid-scroll${isViewportStale ? " is-stale" : ""}${isRemoteLoading ? " is-loading" : ""}`}>
              <TargetPreview ref={preRef} target={state.controls.target} commandTitle="glyphcss chart …"
                isHtml={Boolean(displayRendered?.isHtml)} text={displayRendered?.text ?? ""}
                html={displayRendered?.isHtml ? displayRendered.display : undefined} ansi={displayRendered?.ansi}
                charsetDowngraded={displayRendered?.charsetDowngraded}
                style={densityStyle}
                ariaLabel={state.chart.title || "Chart preview"} ariaDescription={state.chart.description || undefined} />
            </div>
          </div>
        </InstrumentViewport>
        {/* Sibling of `<InstrumentViewport>`, exactly where `MapSearchBox`
         *  sits on `/maps` — the same overlay idiom, three controls in one
         *  bar instead of one. */}
        <ChartsDataOverlay activeDatasetId={activeDatasetId} dispatch={overlayDispatch}
          onSelectRemote={(hit) => void loadRemoteDataset(hit)} onRandom={handleRandomDataset} />
        <div className="synth-export-bar">
          {exportActions}
          <button type="button" className={`gw-code-panel__action${codeOpen ? " is-active" : ""}`} aria-controls="charts-export-panel" aria-expanded={codeOpen} onClick={() => { setMobilePanel(null); setCodeOpen((current) => !current); }}>Export</button>
        </div>
        {(codeOpen || mobilePanel === "export") && <CodePanel id="charts-export-panel"
          className={`synth-code-panel${mobilePanel === "export" ? " is-mobile-open" : ""}`}
          override={{ snippets: snippets ?? { typescript: "Fix the chart errors to export.", json: "Fix the chart errors to export." }, tabs: EXPORT_TABS }}
          actions={exportActions} />}
      </InstrumentMain>
      <Dock id="charts-controls-panel" className={mobilePanel === "controls" ? "is-mobile-open" : ""}>
        <ChartsDock state={state} dispatch={dispatch} rendered={rendered} />
      </Dock>
    </InstrumentBody>
    <InstrumentTray id="charts-presets-panel" label="Chart presets" open={mobilePanel === "presets"}>
      {CHART_PRESETS.map((preset, index) => <button type="button" className="synth-tile" key={preset.id} title={`Apply “${preset.label}”`} aria-label={`Apply ${preset.label}`} onClick={() => dispatch({ type: "apply-preset", id: preset.id })}>
        <span className="synth-tile-scene charts-tile-preview" aria-hidden="true"><pre>{thumbnails[index]}</pre></span>
        <span className="synth-tile-label">{preset.label}</span>
      </button>)}
    </InstrumentTray>
    <InstrumentMobileTabs label="Charts panels" items={(["data", "controls", "presets", "export"] as const).map((panel) => ({
      id: panel, label: panel[0]!.toUpperCase() + panel.slice(1), controls: `charts-${panel}-panel`, expanded: mobilePanel === panel, onClick: () => togglePanel(panel),
    }))} />
  </InstrumentShell>;
}
