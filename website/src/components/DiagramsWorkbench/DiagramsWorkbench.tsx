import { useEffect, useMemo, useReducer, useRef, useState, type Dispatch } from "react";
import { renderGlyphDiagram } from "@glyphcss/diagrams";
import { Dock } from "../Dock/Dock";
import { CodePanel } from "../GalleryWorkbench/CodePanel";
import { InstrumentBody, InstrumentMain, InstrumentMobileTabs, InstrumentRail, InstrumentShell, InstrumentTray, InstrumentViewport } from "../InstrumentWorkbench/InstrumentWorkbench";
import { downloadGlyphSvg } from "../../lib/glyphSvgExport";
import { readUrlParam, writeUrlParam } from "../../lib/urlState";
import { TargetPreview } from "../TargetPreview/TargetPreview";
import { GlyphDiagramsDock } from "./DiagramsDock";
import { GLYPH_DIAGRAM_WORKBENCH_PRESETS, createGlyphDiagramsWorkbenchState, generateGlyphDiagramsWorkbenchSnippets, reduceGlyphDiagramsWorkbenchState, type GlyphDiagramsWorkbenchAction, type GlyphDiagramsWorkbenchState } from "./diagramsWorkbenchState";
import { DIAGRAMS_URL_PARAM, createDiagramsUrlWriter, decodeDiagramsUrlState, encodeDiagramsUrlState } from "./diagramsUrlState";
import { glyphDiagramsWorkbenchDisplayResult, renderGlyphDiagramsWorkbenchState, type GlyphDiagramsWorkbenchRender } from "./diagramsWorkbenchRender";
import "../GalleryWorkbench/gallery-workbench.css";
import "./diagrams-workbench.css";

type MobilePanel = "source" | "controls" | "presets" | "export";
const EXPORT_TABS = [{ id: "typescript", label: "TS" }, { id: "mermaid", label: "Mermaid" }, { id: "json", label: "JSON" }] as const;

/**
 * A copy/export confirmation lives on the CLICKED BUTTON's own label
 * (`ChartsWorkbench.tsx`'s own `flashButtonState`, the CodePanel/
 * SynthWorkbench idiom) — never a separate element that could shift the
 * layout around it. `idle` reverts automatically after `ms`.
 */
function flashButtonState<T extends string>(setState: (value: T) => void, idle: T, value: T, ms = 1200): void {
  setState(value);
  window.setTimeout(() => setState(idle), ms);
}

/**
 * Table editor (packet item 7) — a nodes table (id, label, kind) and an
 * edges table (from, to, label), beside the Mermaid/JSON tabs. Every
 * `<input>` dispatches straight to the reducer's own `setNode`/`addNode`/
 * `removeNode`/`setEdge`/`addEdge`/`removeEdge` actions
 * (`diagramsWorkbenchState.ts`), so this is one more VIEW of the same
 * `state.nodes`/`state.edges`, not a parallel copy.
 */
function DiagramsGraphTable({ state, dispatch }: { state: GlyphDiagramsWorkbenchState; dispatch: Dispatch<GlyphDiagramsWorkbenchAction> }) {
  return <div className="diagrams-table-group">
    <div className="diagrams-table-wrap">
      <table className="diagrams-table" aria-label="Nodes">
        <thead><tr><th>id</th><th>label</th><th>kind</th><th /></tr></thead>
        <tbody>
          {state.nodes.map((node, i) => <tr key={i}>
            <td><input value={node.id} aria-label={`Node ${i + 1} id`} onChange={(event) => dispatch({ type: "set-node", index: i, patch: { id: event.target.value } })} /></td>
            <td><input value={node.label} aria-label={`Node ${i + 1} label`} onChange={(event) => dispatch({ type: "set-node", index: i, patch: { label: event.target.value } })} /></td>
            <td><input value={node.kind ?? ""} aria-label={`Node ${i + 1} kind`} onChange={(event) => dispatch({ type: "set-node", index: i, patch: { kind: event.target.value || undefined } })} /></td>
            <td><button type="button" className="diagrams-table-remove" title={`Remove node ${i + 1}`} aria-label={`Remove node ${i + 1}`} onClick={() => dispatch({ type: "remove-node", index: i })}>×</button></td>
          </tr>)}
        </tbody>
      </table>
      <button type="button" className="gw-code-panel__action" onClick={() => dispatch({ type: "add-node" })}>+ node</button>
    </div>
    <div className="diagrams-table-wrap">
      <table className="diagrams-table" aria-label="Edges">
        <thead><tr><th>from</th><th>to</th><th>label</th><th /></tr></thead>
        <tbody>
          {state.edges.map((edge, i) => <tr key={i}>
            <td><input value={edge.from} aria-label={`Edge ${i + 1} from`} onChange={(event) => dispatch({ type: "set-edge", index: i, patch: { from: event.target.value } })} /></td>
            <td><input value={edge.to} aria-label={`Edge ${i + 1} to`} onChange={(event) => dispatch({ type: "set-edge", index: i, patch: { to: event.target.value } })} /></td>
            <td><input value={edge.label ?? ""} aria-label={`Edge ${i + 1} label`} onChange={(event) => dispatch({ type: "set-edge", index: i, patch: { label: event.target.value || undefined } })} /></td>
            <td><button type="button" className="diagrams-table-remove" title={`Remove edge ${i + 1}`} aria-label={`Remove edge ${i + 1}`} onClick={() => dispatch({ type: "remove-edge", index: i })}>×</button></td>
          </tr>)}
        </tbody>
      </table>
      <button type="button" className="gw-code-panel__action" onClick={() => dispatch({ type: "add-edge" })}>+ edge</button>
    </div>
  </div>;
}

/**
 * Gates the FIRST render on the `?d=` URL param (AGENTS.md's "## Diagrams"
 * — "URL state"), same split as ChartsWorkbench.tsx's own gate: the common
 * no-param case resolves the default state synchronously (no gate at all),
 * and only a page actually carrying a `?d=` link waits — briefly, and
 * without ever showing the default graph first — for the async decode
 * (deflate is inherently async; see jsonUrlState.ts's doc) to settle.
 * `initialState` (DiagramsWorkbench.test.tsx's synchronous mount) bypasses
 * the URL entirely, exactly as before this feature existed.
 */
export default function GlyphDiagramsWorkbench({ initialState }: { initialState?: GlyphDiagramsWorkbenchState } = {}) {
  const [resolved, setResolved] = useState<GlyphDiagramsWorkbenchState | null>(() => {
    if (initialState) return initialState;
    return readUrlParam(DIAGRAMS_URL_PARAM) ? null : createGlyphDiagramsWorkbenchState();
  });
  useEffect(() => {
    if (initialState || resolved) return;
    let cancelled = false;
    void decodeDiagramsUrlState(readUrlParam(DIAGRAMS_URL_PARAM)).then((decoded) => {
      if (!cancelled) setResolved(decoded ?? createGlyphDiagramsWorkbenchState());
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!resolved) return null;
  return <GlyphDiagramsWorkbenchInner initialState={resolved} />;
}

function GlyphDiagramsWorkbenchInner({ initialState }: { initialState: GlyphDiagramsWorkbenchState }) {
  const [state, dispatch] = useReducer(reduceGlyphDiagramsWorkbenchState, initialState);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  const [completed, setCompleted] = useState<{ state: GlyphDiagramsWorkbenchState; result: GlyphDiagramsWorkbenchRender } | null>(null);
  const [thumbnails, setThumbnails] = useState<readonly string[]>([]);
  const preRef = useRef<HTMLPreElement | null>(null);
  // State identity prevents an old result from becoming copyable during a new layout.
  const rendered = completed?.state === state ? completed.result : null;
  // The viewport's own content: while a layout is in flight for the
  // CURRENT state (`rendered === null`) or the current one errored, this
  // stays on the last one that actually succeeded — dimmed, never blank —
  // so an edit never collapses the frame (the user's own words: "it
  // shouldn't be in the rendering area — it moves the chart"). Mutated
  // during render (not an effect): must be current for THIS render's JSX.
  const lastGoodResultRef = useRef<Extract<GlyphDiagramsWorkbenchRender, { ok: true }> | null>(null);
  if (rendered?.ok) lastGoodResultRef.current = rendered;
  const displayResult = glyphDiagramsWorkbenchDisplayResult(rendered, lastGoodResultRef.current);
  const isPending = rendered === null;
  const hasError = rendered !== null && !rendered.ok;
  const isViewportStale = isPending || hasError;
  const snippets = useMemo(() => {
    try { return generateGlyphDiagramsWorkbenchSnippets(state); }
    catch { return null; }
  }, [state]);
  // One writer for the component's lifetime — see diagramsUrlState.ts's doc
  // (150ms debounced, `history.replaceState`-only, skip-when-unchanged). No
  // size-warning readout lives on this page — diagrams carry no "custom
  // source" concept a legacy link could still blow the cap with.
  const urlWriter = useRef(createDiagramsUrlWriter()).current;
  useEffect(() => { urlWriter(state); }, [state, urlWriter]);

  useEffect(() => {
    let current = true;
    void renderGlyphDiagramsWorkbenchState(state).then((result) => { if (current) setCompleted({ state, result }); });
    return () => { current = false; };
  }, [state]);
  useEffect(() => {
    let current = true;
    void Promise.all(GLYPH_DIAGRAM_WORKBENCH_PRESETS.map(async (preset) => {
      try { return (await renderGlyphDiagram(preset.source, { target: state.controls.target, width: 60, height: 24 })).text; }
      catch { return "Preview unavailable"; }
    })).then((previews) => { if (current) setThumbnails(previews); });
    return () => { current = false; };
  }, [state.controls.target]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setMobilePanel(null); setCodeOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Every export/copy action confirms on its OWN button label
  // (`flashButtonState`, above) rather than a separate readout.
  const [copyTextState, setCopyTextState] = useState<"idle" | "copied" | "error">("idle");
  const [copyAnsiState, setCopyAnsiState] = useState<"idle" | "copied" | "error">("idle");
  const [copyLinkState, setCopyLinkState] = useState<"idle" | "copied" | "error">("idle");
  const [downloadState, setDownloadState] = useState<"idle" | "downloaded" | "error">("idle");
  const copy = async (encoding: "text" | "ansi") => {
    if (!rendered?.ok) return;
    const value = encoding === "text" ? rendered.text : rendered.ansi;
    if (value === undefined) return;
    const setState = encoding === "text" ? setCopyTextState : setCopyAnsiState;
    try { await navigator.clipboard.writeText(value); flashButtonState(setState, "idle", "copied"); }
    catch { flashButtonState(setState, "idle", "error"); }
  };
  // Final-gate-2 review (codex #7, same fix as ChartsWorkbench.tsx's own
  // `copyLink`): copying `window.location.href` directly copied whatever
  // the 150ms-debounced `urlWriter` had last committed, not the state on
  // screen. Encode `state` fresh at click time and build the link from
  // that instead of reading the address bar back.
  const copyLink = async () => {
    try {
      const raw = await encodeDiagramsUrlState(state);
      writeUrlParam(DIAGRAMS_URL_PARAM, raw || null);
      const params = new URLSearchParams(window.location.search);
      if (raw) params.set(DIAGRAMS_URL_PARAM, raw); else params.delete(DIAGRAMS_URL_PARAM);
      const search = params.toString();
      const link = `${window.location.origin}${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
      await navigator.clipboard.writeText(link);
      flashButtonState(setCopyLinkState, "idle", "copied");
    } catch { flashButtonState(setCopyLinkState, "idle", "error"); }
  };
  const download = () => {
    let ok = false;
    try { ok = downloadGlyphSvg(preRef.current, "glyphcss-diagram.svg"); } catch { ok = false; }
    flashButtonState(setDownloadState, "idle", ok ? "downloaded" : "error");
  };
  const exportActions = <>
    <button type="button" className="gw-code-panel__action" disabled={!rendered?.ok} onClick={() => void copy("text")}>
      {copyTextState === "copied" ? "Copied" : copyTextState === "error" ? "Copy failed" : "Copy as text"}
    </button>
    {rendered?.ok && rendered.ansi !== undefined && <button type="button" className="gw-code-panel__action" onClick={() => void copy("ansi")}>
      {copyAnsiState === "copied" ? "Copied" : copyAnsiState === "error" ? "Copy failed" : "Copy ANSI"}
    </button>}
    <button type="button" className="gw-code-panel__action" onClick={() => void copyLink()}>
      {copyLinkState === "copied" ? "Copied" : copyLinkState === "error" ? "Copy failed" : "Copy link"}
    </button>
    <button type="button" className="gw-code-panel__action" disabled={!rendered?.ok} onClick={download}>
      {downloadState === "downloaded" ? "Downloaded" : downloadState === "error" ? "Download failed" : "Download SVG"}
    </button>
  </>;

  return <InstrumentShell kind="synth" className="diagrams-shell">
    <InstrumentBody>
      <InstrumentRail id="diagrams-source-panel" title="Graph" open={mobilePanel === "source"}>
        <div className="voice-card diagrams-source-card">
          <div className="voice-controls">
            {/* A render error (invalid Mermaid/JSON) names itself here, in
             *  the rail — never over the render, which keeps showing the
             *  last diagram that actually laid out (see the viewport
             *  below). */}
            {rendered && !rendered.ok && <p className="diagrams-readout diagrams-error" role="alert">{rendered.error}</p>}
            <div className="gx-toggle" role="tablist" aria-label="Graph source format">
              {(["mermaid", "json", "table"] as const).map((editor) => <button type="button" key={editor} id={`diagrams-${editor}-tab`} role="tab" aria-selected={state.editor === editor} aria-controls={`diagrams-${editor}-editor`} className={`gx-toggle-btn gx-toggle-text${state.editor === editor ? " is-active" : ""}`} onClick={() => dispatch({ type: "set-editor", editor })}>{editor === "mermaid" ? "Mermaid" : editor === "json" ? "nodes/edges JSON" : "Table"}</button>)}
            </div>
            <div role="tabpanel" id={`diagrams-${state.editor}-editor`} aria-labelledby={`diagrams-${state.editor}-tab`}>
              {state.editor === "table"
                ? <DiagramsGraphTable state={state} dispatch={dispatch} />
                : <textarea className="diagrams-source" aria-label={state.editor === "mermaid" ? "Mermaid source" : "Nodes and edges JSON"} value={state[state.editor]} onChange={(event) => dispatch({ type: "edit-source", value: event.target.value })} spellCheck={false} />}
            </div>
            <p className="diagrams-readout">{state.editor === "mermaid" ? "Mermaid flowcharts and graphs. Styling and click directives are ignored." : state.editor === "json" ? "Edit nodes, edges, groups and direction. TS and JSON exports preserve every graph field." : "Edit nodes and edges directly. Group/shape/style/priority fields carry over untouched from whichever source was authoritative before."}</p>
          </div>
        </div>
      </InstrumentRail>
      <InstrumentMain>
        <InstrumentViewport className="diagrams-viewport">
          <div className="diagrams-preview" aria-busy={isPending}>
            {/* The viewport holds only the render; feedback lives on the
             *  buttons and in the rail. `is-stale` (a config error or a
             *  layout still in flight) dims the LAST GOOD diagram instead
             *  of collapsing the frame; `is-loading` (in flight only) also
             *  pulses it — the page's own animation, never the render's. */}
            <div className={`diagrams-grid-scroll${isViewportStale ? " is-stale" : ""}${isPending ? " is-loading" : ""}`}>
              <TargetPreview ref={preRef} target={state.controls.target} commandTitle="glyphcss diagram …"
                isHtml={Boolean(displayResult?.isHtml)} text={displayResult?.text ?? ""}
                html={displayResult?.isHtml ? displayResult.display : undefined} ansi={displayResult?.ansi}
                ariaLabel={state.diagram.title || "Diagram preview"} ariaDescription={displayResult?.meta.description ?? undefined} />
            </div>
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
