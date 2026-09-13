import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { glyphChartSeriesPreview, renderGlyphChart, type GlyphChartSeriesPreviewEntry } from "@glyphcss/charts";
import { Dock } from "../Dock/Dock";
import { CodePanel } from "../GalleryWorkbench/CodePanel";
import {
  InstrumentBody, InstrumentMain, InstrumentMobileTabs, InstrumentRail,
  InstrumentShell, InstrumentTray, InstrumentViewport,
} from "../InstrumentWorkbench/InstrumentWorkbench";
import { downloadGlyphSvg } from "../../lib/glyphSvgExport";
import { readUrlParam, writeUrlParam } from "../../lib/urlState";
import { TargetPreview } from "../TargetPreview/TargetPreview";
import { ChartsDataFolder } from "./ChartsDataFolder";
import { ChartsDock } from "./ChartsDock";
import { ChartsMarkCard } from "./ChartsMarkCard";
import {
  CHART_PRESETS, CHARTS_DENSITY_BASE_FONT_PX, chartsWorkbenchEffectiveDensity, createChartsWorkbenchState,
  generateChartsWorkbenchSnippets, randomChartsDatasetId, reduceChartsWorkbenchState, resolveGlyphChartsWorkbenchControls,
  type ChartsWorkbenchState,
} from "./chartsWorkbenchState";
import { CHARTS_URL_PARAM, CHARTS_URL_SIZE_WARN_BYTES, createChartsUrlWriter, decodeChartsUrlState, encodeChartsUrlStateInfo } from "./chartsUrlState";
import { buildStyledChartsWorkbenchSpec, renderChartsWorkbenchState } from "./chartsWorkbenchRender";
import "../GalleryWorkbench/gallery-workbench.css";
import "./charts-workbench.css";

type MobilePanel = "data" | "controls" | "presets" | "export";
const EXPORT_TABS = [{ id: "typescript", label: "TypeScript" }, { id: "json", label: "JSON" }] as const;

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
 * action the rail's own dropdown and "⚄ Random" button dispatch.
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
  useEffect(() => {
    if (initialState || resolved) return;
    let cancelled = false;
    void decodeChartsUrlState(readUrlParam(CHARTS_URL_PARAM)).then((decoded) => {
      if (!cancelled) setResolved(decoded ?? createRandomChartsWorkbenchState());
    });
    return () => { cancelled = true; };
    // Only ever runs once: `resolved` starts non-null (no gate needed) or
    // this effect's own setResolved call makes it non-null on next render,
    // and the guard above then short-circuits for good.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!resolved) return null;
  return <ChartsWorkbenchInner initialState={resolved} />;
}

function ChartsWorkbenchInner({ initialState }: { initialState: ChartsWorkbenchState }) {
  const [state, dispatch] = useReducer(reduceChartsWorkbenchState, initialState);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel | null>(null);
  // Portal target for the dataset `<select>` — the rail's own header
  // `action` slot, mirroring `InstrumentRail`'s synth precedent (Voices'
  // header carries its own mode toggle + "+ Add" the same way). Null on the
  // very first render (the ref hasn't committed yet); `ChartsDataFolder`
  // renders the select inline for that one frame instead of dropping it.
  const [dataSelectSlot, setDataSelectSlot] = useState<HTMLElement | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [urlSizeBytes, setUrlSizeBytes] = useState(0);
  const preRef = useRef<HTMLPreElement | null>(null);
  const rendered = useMemo(() => renderChartsWorkbenchState(state), [state]);
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
  // (150ms debounced, `history.replaceState`-only, skip-when-unchanged).
  const urlWriter = useRef(createChartsUrlWriter(({ sizeBytes }) => {
    setUrlSizeBytes(sizeBytes);
  })).current;
  useEffect(() => { urlWriter(state); }, [state, urlWriter]);
  const urlTooLong = urlSizeBytes > CHARTS_URL_SIZE_WARN_BYTES;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMobilePanel(null); setCodeOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { setFeedback(""); }, [state]);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 1800);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const copy = async (encoding: "ascii" | "ansi") => {
    if (!rendered.ok) return;
    const value = encoding === "ascii" ? rendered.text : rendered.ansi;
    if (value === undefined) return;
    try { await navigator.clipboard.writeText(value); setFeedback(encoding === "ascii" ? "Copied ASCII" : "Copied ANSI"); }
    catch { setFeedback("Copy failed — select the chart to copy it manually."); }
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
      const { raw, sizeBytes, tooLarge } = await encodeChartsUrlStateInfo(state);
      setUrlSizeBytes(sizeBytes);
      // `tooLarge` (an oversized "Custom…" payload) is unreachable through
      // this page's own UI now — there's no way left to install a custom
      // source — but the reducer/URL layer still accepts one from a
      // hand-built or legacy link, so this stays a real safety net rather
      // than an assumption this branch can't fire.
      if (tooLarge) { setFeedback(`Link too large to share (${Math.ceil(sizeBytes / 1024)} KB).`); return; }
      writeUrlParam(CHARTS_URL_PARAM, raw || null);
      const params = new URLSearchParams(window.location.search);
      if (raw) params.set(CHARTS_URL_PARAM, raw); else params.delete(CHARTS_URL_PARAM);
      const search = params.toString();
      const link = `${window.location.origin}${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
      await navigator.clipboard.writeText(link);
      setFeedback("Copied link");
    } catch { setFeedback("Copy failed — copy the address bar manually."); }
  };
  const download = () => {
    try { setFeedback(downloadGlyphSvg(preRef.current, "glyphcss-chart.svg") ? "Downloaded SVG" : "Download failed"); }
    catch { setFeedback("Download failed"); }
  };
  const exportActions = <>
    <button type="button" className="gw-code-panel__action" disabled={!rendered.ok} onClick={() => void copy("ascii")}>Copy ASCII</button>
    {rendered.ok && rendered.ansi !== undefined && <button type="button" className="gw-code-panel__action" onClick={() => void copy("ansi")}>Copy ANSI</button>}
    <button type="button" className="gw-code-panel__action" onClick={() => void copyLink()}>Copy link</button>
    <button type="button" className="gw-code-panel__action" disabled={!rendered.ok} onClick={download}>Download SVG</button>
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
    const currentId = state.data.source?.kind === "dataset" ? state.data.source.id : undefined;
    dispatch({ type: "select-dataset", id: randomChartsDatasetId(currentId) });
  };

  return <InstrumentShell kind="synth" className="charts-shell">
    <InstrumentBody>
      {/* Data is this page's own "model" (AGENTS.md's "Charts" — "Data
       *  layer"), exactly as synth's rail is the voice/model picker: the
       *  header action carries the dataset picker + the "⚄ Random" button
       *  (GalleryWorkbench.tsx's own "Load Random" idiom), the body shows
       *  the dataset as a card (`ChartsDataFolder` — title, description,
       *  source credit, a read-only "View data" disclosure), and a second
       *  section below holds the mark this is a showcase of one chart at a
       *  time, not a builder: picking a dataset REPLACES the chart
       *  immediately (`select-dataset`), with no separate Apply step and
       *  no add/remove-mark controls. */}
      <InstrumentRail id="charts-data-panel" title="Data" open={mobilePanel === "data"}
        action={<span className="charts-rail-header-actions">
          <span className="charts-dataset-select-slot" ref={setDataSelectSlot} />
          <button type="button" className="control-btn charts-random-btn" title="Load a random dataset" aria-label="Load random dataset" onClick={handleRandomDataset}>⚄ Random</button>
        </span>}>
        <ChartsDataFolder data={state.data} dispatch={dispatch} selectSlot={dataSelectSlot} />
        <div className="charts-marks-section">
          {state.marks.map((mark, index) => <ChartsMarkCard key={mark.id} mark={mark} index={index} series={seriesPreview} colorDisabled={colorDisabled} dispatch={dispatch} />)}
        </div>
      </InstrumentRail>
      <InstrumentMain>
        <InstrumentViewport className="charts-viewport">
          <div className="charts-preview">
            <div className="charts-grid-scroll">
              <TargetPreview ref={preRef} target={state.controls.target} commandTitle="glyphcss chart …"
                isHtml={rendered.ok && rendered.isHtml} text={rendered.ok ? rendered.text : ""}
                html={rendered.ok && rendered.isHtml ? rendered.display : undefined} ansi={rendered.ok ? rendered.ansi : undefined}
                style={densityStyle}
                ariaLabel={state.chart.title || "Chart preview"} ariaDescription={state.chart.description || undefined} />
            </div>
            {!rendered.ok && <p className="charts-error" role="alert">{rendered.error}</p>}
            {rendered.ok && rendered.ansi !== undefined && <p className="charts-readout" role="status">Preview decodes the terminal colours for display. ANSI escapes are included only with Copy ANSI.</p>}
            {urlTooLong && <p className="charts-readout" role="status">Link is {Math.ceil(urlSizeBytes / 1024)} KB.</p>}
            {feedback && <p className="charts-readout" role="status">{feedback}</p>}
          </div>
        </InstrumentViewport>
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
