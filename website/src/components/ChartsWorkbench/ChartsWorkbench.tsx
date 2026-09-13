import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { renderGlyphChart } from "@glyphcss/charts";
import { Dock } from "../Dock/Dock";
import { CodePanel } from "../GalleryWorkbench/CodePanel";
import {
  InstrumentBody, InstrumentMain, InstrumentMobileTabs, InstrumentRail,
  InstrumentShell, InstrumentTray, InstrumentViewport,
} from "../InstrumentWorkbench/InstrumentWorkbench";
import { downloadGlyphSvg } from "../../lib/glyphSvgExport";
import { TargetPreview } from "../TargetPreview/TargetPreview";
import { ChartsDock } from "./ChartsDock";
import { ChartsMarkCard } from "./ChartsMarkCard";
import { CHART_PRESETS, createChartsWorkbenchState, generateChartsWorkbenchSnippets, reduceChartsWorkbenchState, type ChartsWorkbenchState } from "./chartsWorkbenchState";
import { renderChartsWorkbenchState } from "./chartsWorkbenchRender";
import "../GalleryWorkbench/gallery-workbench.css";
import "./charts-workbench.css";

type MobilePanel = "marks" | "controls" | "presets" | "export";
const EXPORT_TABS = [{ id: "typescript", label: "TypeScript" }, { id: "json", label: "JSON" }] as const;

export default function ChartsWorkbench({ initialState }: { initialState?: ChartsWorkbenchState } = {}) {
  const [state, dispatch] = useReducer(reduceChartsWorkbenchState, initialState, (initial) => initial ?? createChartsWorkbenchState());
  const [mobilePanel, setMobilePanel] = useState<MobilePanel | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const preRef = useRef<HTMLPreElement | null>(null);
  const rendered = useMemo(() => renderChartsWorkbenchState(state), [state]);
  const thumbnails = useMemo(() => CHART_PRESETS.map((preset) => renderGlyphChart(preset.spec, { target: state.controls.target, width: 24, height: 8 }).text), [state.controls.target]);
  const snippets = useMemo(() => {
    try { return generateChartsWorkbenchSnippets(state); }
    catch { return null; }
  }, [state]);

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
  const download = () => {
    try { setFeedback(downloadGlyphSvg(preRef.current, "glyphcss-chart.svg") ? "Downloaded SVG" : "Download failed"); }
    catch { setFeedback("Download failed"); }
  };
  const exportActions = <>
    <button type="button" className="gw-code-panel__action" disabled={!rendered.ok} onClick={() => void copy("ascii")}>Copy ASCII</button>
    {rendered.ok && rendered.ansi !== undefined && <button type="button" className="gw-code-panel__action" onClick={() => void copy("ansi")}>Copy ANSI</button>}
    <button type="button" className="gw-code-panel__action" disabled={!rendered.ok} onClick={download}>Download SVG</button>
  </>;
  const togglePanel = (panel: MobilePanel) => {
    setCodeOpen(false);
    setMobilePanel((current) => current === panel ? null : panel);
  };

  return <InstrumentShell kind="synth" className="charts-shell">
    <InstrumentBody>
      <InstrumentRail id="charts-marks-panel" title="Marks" open={mobilePanel === "marks"}
        action={<button type="button" className="voice-add" onClick={() => dispatch({ type: "add-mark" })}>+ Add mark</button>}>
        {state.marks.map((mark, index) => <ChartsMarkCard key={mark.id} mark={mark} index={index} dispatch={dispatch} />)}
        {state.marks.length === 0 && <p className="synth-empty">No marks — add one to start.</p>}
      </InstrumentRail>
      <InstrumentMain>
        <InstrumentViewport className="charts-viewport">
          <div className="charts-preview">
            <div className="charts-grid-scroll">
              <TargetPreview ref={preRef} target={state.controls.target} commandTitle="glyphcss chart …"
                isHtml={rendered.ok && rendered.isHtml} text={rendered.ok ? rendered.text : ""}
                html={rendered.ok && rendered.isHtml ? rendered.display : undefined} ansi={rendered.ok ? rendered.ansi : undefined}
                ariaLabel={state.chart.title || "Chart preview"} ariaDescription={state.chart.description || undefined} />
            </div>
            {!rendered.ok && <p className="charts-error" role="alert">{rendered.error}</p>}
            {rendered.ok && rendered.ansi !== undefined && <p className="charts-readout" role="status">Preview decodes the terminal colours for display. ANSI escapes are included only with Copy ANSI.</p>}
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
        <ChartsDock state={state} dispatch={dispatch} />
      </Dock>
    </InstrumentBody>
    <InstrumentTray id="charts-presets-panel" label="Chart presets" open={mobilePanel === "presets"}>
      {CHART_PRESETS.map((preset, index) => <button type="button" className="synth-tile" key={preset.id} title={`Apply “${preset.label}”`} aria-label={`Apply ${preset.label}`} onClick={() => dispatch({ type: "apply-preset", id: preset.id })}>
        <span className="synth-tile-scene charts-tile-preview" aria-hidden="true"><pre>{thumbnails[index]}</pre></span>
        <span className="synth-tile-label">{preset.label}</span>
      </button>)}
    </InstrumentTray>
    <InstrumentMobileTabs label="Charts panels" items={(["marks", "controls", "presets", "export"] as const).map((panel) => ({
      id: panel, label: panel[0]!.toUpperCase() + panel.slice(1), controls: `charts-${panel}-panel`, expanded: mobilePanel === panel, onClick: () => togglePanel(panel),
    }))} />
  </InstrumentShell>;
}
