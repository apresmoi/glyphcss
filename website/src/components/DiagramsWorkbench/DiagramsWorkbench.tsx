import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { renderGlyphDiagram, type GlyphDiagramReport } from "@glyphcss/diagrams";
import { Dock } from "../Dock/Dock";
import { CodePanel } from "../GalleryWorkbench/CodePanel";
import { InstrumentBody, InstrumentMain, InstrumentMobileTabs, InstrumentRail, InstrumentShell, InstrumentTray, InstrumentViewport } from "../InstrumentWorkbench/InstrumentWorkbench";
import { downloadGlyphSvg } from "../../lib/glyphSvgExport";
import { GlyphDiagramsDock } from "./DiagramsDock";
import { GLYPH_DIAGRAM_WORKBENCH_PRESETS, createGlyphDiagramsWorkbenchState, generateGlyphDiagramsWorkbenchSnippets, reduceGlyphDiagramsWorkbenchState, type GlyphDiagramsWorkbenchState } from "./diagramsWorkbenchState";
import { renderGlyphDiagramsWorkbenchState, type GlyphDiagramsWorkbenchRender } from "./diagramsWorkbenchRender";
import "../GalleryWorkbench/gallery-workbench.css";
import "./diagrams-workbench.css";

type MobilePanel = "source" | "controls" | "presets" | "export";
const EXPORT_TABS = [{ id: "typescript", label: "TS" }, { id: "mermaid", label: "Mermaid" }, { id: "json", label: "JSON" }] as const;

export function GlyphDiagramsReport({ report }: { report: GlyphDiagramReport }) {
  if (!report.ledger.length && !report.unsupportedGlyphs.length && !report.unroutable.length) return null;
  return <div className="diagrams-ledger" aria-label="Rendering report">
    {report.ledger.map((entry, index) => <p key={index}>{entry}</p>)}
    {report.unsupportedGlyphs.map((entry, index) => <p key={`glyph-${index}`}>Unsupported glyph: {entry}</p>)}
    {report.unroutable.map((entry, index) => <p key={`route-${index}`}>Unroutable edge: {entry}</p>)}
  </div>;
}

export default function GlyphDiagramsWorkbench({ initialState }: { initialState?: GlyphDiagramsWorkbenchState } = {}) {
  const [state, dispatch] = useReducer(reduceGlyphDiagramsWorkbenchState, initialState, (initial) => initial ?? createGlyphDiagramsWorkbenchState());
  const [mobilePanel, setMobilePanel] = useState<MobilePanel | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [completed, setCompleted] = useState<{ state: GlyphDiagramsWorkbenchState; result: GlyphDiagramsWorkbenchRender } | null>(null);
  const [thumbnails, setThumbnails] = useState<readonly string[]>([]);
  const preRef = useRef<HTMLPreElement | null>(null);
  // State identity prevents an old result from becoming copyable during a new layout.
  const rendered = completed?.state === state ? completed.result : null;
  const snippets = useMemo(() => {
    try { return generateGlyphDiagramsWorkbenchSnippets(state); }
    catch { return null; }
  }, [state]);

  useEffect(() => {
    let current = true;
    void renderGlyphDiagramsWorkbenchState(state).then((result) => { if (current) setCompleted({ state, result }); });
    return () => { current = false; };
  }, [state]);
  useEffect(() => {
    let current = true;
    void Promise.all(GLYPH_DIAGRAM_WORKBENCH_PRESETS.map(async (preset) => {
      try { return (await renderGlyphDiagram(preset.source, { target: "chat", width: 60, height: 24 })).text; }
      catch { return "Preview unavailable"; }
    })).then((previews) => { if (current) setThumbnails(previews); });
    return () => { current = false; };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setMobilePanel(null); setCodeOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { setFeedback(""); }, [state]);
  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(""), 1800);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const copy = async (encoding: "text" | "ansi") => {
    if (!rendered?.ok) return;
    const value = encoding === "text" ? rendered.text : rendered.ansi;
    if (value === undefined) return;
    try { await navigator.clipboard.writeText(value); setFeedback(encoding === "text" ? "Copied text" : "Copied ANSI"); }
    catch { setFeedback("Copy failed — select the diagram to copy it manually."); }
  };
  const download = () => {
    try { setFeedback(downloadGlyphSvg(preRef.current, "glyphcss-diagram.svg") ? "Downloaded SVG" : "Download failed"); }
    catch { setFeedback("Download failed"); }
  };
  const exportActions = <>
    <button type="button" className="gw-code-panel__action" disabled={!rendered?.ok} onClick={() => void copy("text")}>Copy as text</button>
    {rendered?.ok && rendered.ansi !== undefined && <button type="button" className="gw-code-panel__action" onClick={() => void copy("ansi")}>Copy ANSI</button>}
    <button type="button" className="gw-code-panel__action" disabled={!rendered?.ok} onClick={download}>Download SVG</button>
  </>;

  return <InstrumentShell kind="synth" className="diagrams-shell">
    <InstrumentBody>
      <InstrumentRail id="diagrams-source-panel" title="Graph" open={mobilePanel === "source"}>
        <div className="voice-card diagrams-source-card">
          <div className="voice-controls">
            <div className="gx-toggle" role="tablist" aria-label="Graph source format">
              {(["mermaid", "json"] as const).map((editor) => <button type="button" key={editor} id={`diagrams-${editor}-tab`} role="tab" aria-selected={state.editor === editor} aria-controls={`diagrams-${editor}-editor`} className={`gx-toggle-btn gx-toggle-text${state.editor === editor ? " is-active" : ""}`} onClick={() => dispatch({ type: "set-editor", editor })}>{editor === "mermaid" ? "Mermaid" : "nodes/edges JSON"}</button>)}
            </div>
            <div role="tabpanel" id={`diagrams-${state.editor}-editor`} aria-labelledby={`diagrams-${state.editor}-tab`}>
              <textarea className="diagrams-source" aria-label={state.editor === "mermaid" ? "Mermaid source" : "Nodes and edges JSON"} value={state[state.editor]} onChange={(event) => dispatch({ type: "edit-source", value: event.target.value })} spellCheck={false} />
            </div>
            <p className="diagrams-readout">{state.editor === "mermaid" ? "Mermaid flowcharts and graphs. Styling and click directives are ignored." : "Edit nodes, edges, groups and direction. TS and JSON exports preserve every graph field."}</p>
          </div>
        </div>
      </InstrumentRail>
      <InstrumentMain>
        <InstrumentViewport className="diagrams-viewport">
          <div className="diagrams-preview" aria-busy={rendered === null}>
            <div className="diagrams-grid-scroll">
              <pre ref={preRef} className="glyph-output" aria-label={state.diagram.title || "Diagram preview"} aria-description={rendered?.ok ? rendered.meta.description ?? undefined : undefined}
                {...(rendered?.ok && rendered.isHtml ? { dangerouslySetInnerHTML: { __html: rendered.display } } : { children: rendered?.ok ? rendered.text : "" })} />
            </div>
            {!rendered && <p className="diagrams-readout" role="status">Laying out diagram…</p>}
            {rendered && !rendered.ok && <p className="diagrams-error" role="alert">{rendered.error}</p>}
            {rendered?.ok && <GlyphDiagramsReport report={rendered.report} />}
            {rendered?.ok && rendered.ansi !== undefined && <p className="diagrams-readout" role="status">Preview shows plain text. ANSI escapes are included only with Copy ANSI.</p>}
            {feedback && <p className="diagrams-readout" role="status">{feedback}</p>}
          </div>
        </InstrumentViewport>
        <div className="synth-export-bar">{exportActions}
          <button type="button" className={`gw-code-panel__action${codeOpen ? " is-active" : ""}`} aria-controls="diagrams-export-panel" aria-expanded={codeOpen} onClick={() => { setMobilePanel(null); setCodeOpen((current) => !current); }}>Export</button>
        </div>
        {(codeOpen || mobilePanel === "export") && <CodePanel id="diagrams-export-panel" className={`synth-code-panel${mobilePanel === "export" ? " is-mobile-open" : ""}`}
          override={{ snippets: snippets ?? { typescript: "Fix the graph errors to export.", mermaid: "Fix the graph errors to export.", json: "Fix the graph errors to export." }, tabs: EXPORT_TABS }} actions={exportActions} />}
      </InstrumentMain>
      <Dock id="diagrams-controls-panel" className={mobilePanel === "controls" ? "is-mobile-open" : ""}><GlyphDiagramsDock state={state} dispatch={dispatch} /></Dock>
    </InstrumentBody>
    <InstrumentTray id="diagrams-presets-panel" label="Diagram presets" open={mobilePanel === "presets"}>
      {GLYPH_DIAGRAM_WORKBENCH_PRESETS.map((preset, index) => <button type="button" className="synth-tile" key={preset.id} title={`Apply “${preset.label}”`} aria-label={`Apply ${preset.label}`} onClick={() => dispatch({ type: "apply-preset", id: preset.id })}>
        <span className="synth-tile-scene diagrams-tile-preview" aria-hidden="true"><pre>{thumbnails[index] ?? ""}</pre></span><span className="synth-tile-label">{preset.label}</span>
      </button>)}
    </InstrumentTray>
    <InstrumentMobileTabs label="Diagrams panels" items={(["source", "controls", "presets", "export"] as const).map((panel) => ({
      id: panel, label: panel[0]!.toUpperCase() + panel.slice(1), controls: `diagrams-${panel}-panel`, expanded: mobilePanel === panel,
      onClick: () => { setCodeOpen(false); setMobilePanel((current) => current === panel ? null : panel); },
    }))} />
  </InstrumentShell>;
}
