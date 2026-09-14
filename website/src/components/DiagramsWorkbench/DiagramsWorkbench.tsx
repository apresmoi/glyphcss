import { useEffect, useMemo, useReducer, useRef, useState, type Dispatch } from "react";
import { glyphGraphFromMermaid, renderGlyphDiagram, type GlyphGraph } from "@glyphcss/diagrams";
import { renderGlyphDiagram3d } from "@glyphcss/diagrams/3d";
import { Dock } from "../Dock/Dock";
import { CodePanel } from "../GalleryWorkbench/CodePanel";
import { InstrumentBody, InstrumentMain, InstrumentMobileTabs, InstrumentRail, InstrumentShell, InstrumentTray, InstrumentViewport } from "../InstrumentWorkbench/InstrumentWorkbench";
import { downloadGlyphSvg } from "../../lib/glyphSvgExport";
import { readUrlParam, writeUrlParam } from "../../lib/urlState";
import { TargetPreview } from "../TargetPreview/TargetPreview";
import { GlyphDiagramsDock } from "./DiagramsDock";
import { Diagrams3DViewport } from "./Diagrams3DViewport";
import {
  GLYPH_DIAGRAM_WORKBENCH_PRESETS, buildGlyphDiagramsWorkbenchGraph, createGlyphDiagramsWorkbenchState, generateGlyphDiagramsWorkbenchSnippets, reduceGlyphDiagramsWorkbenchState, resolveGlyphDiagramsWorkbenchControls,
  type GlyphDiagramsWorkbenchAction, type GlyphDiagramsWorkbenchState,
} from "./diagramsWorkbenchState";
import { DIAGRAMS_URL_PARAM, createDiagramsUrlWriter, decodeDiagramsUrlState, encodeDiagramsUrlState } from "./diagramsUrlState";
import {
  glyphDiagramsWorkbenchDisplayResult, renderGlyphDiagramsWorkbenchState, renderGlyphDiagramsWorkbenchState3d,
  type GlyphDiagramsWorkbenchRender, type GlyphDiagramsWorkbenchRender3d,
} from "./diagramsWorkbenchRender";
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
  // Fix round 1, P1-1 — the resolved (default-applied) target/charset/colour,
  // shared by the 3D thumbnail/render options above and the live viewport's
  // own scene options below.
  const resolvedControls = resolveGlyphDiagramsWorkbenchControls(state.controls);
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

  // Packet D3 — the 3D static render. Computed whenever `state.view` is
  // "3d", for EVERY target (`web` included): terminal/chat mount it
  // directly (below), and `web`'s own live orbit viewport still needs it
  // for Copy ASCII/ANSI at the CURRENT camera ("what you copy is what you
  // see" — AGENTS.md's D3 row) — a live scene has no string to copy on its
  // own. Skips entirely in 2D, so a reader who never opens 3D pays nothing.
  const [completed3d, setCompleted3d] = useState<{ state: GlyphDiagramsWorkbenchState; result: GlyphDiagramsWorkbenchRender3d } | null>(null);
  const rendered3d = state.view === "3d" && completed3d?.state === state ? completed3d.result : null;
  const lastGoodResult3dRef = useRef<Extract<GlyphDiagramsWorkbenchRender3d, { ok: true }> | null>(null);
  if (rendered3d?.ok) lastGoodResult3dRef.current = rendered3d;
  const displayResult3d = rendered3d?.ok ? rendered3d : state.view === "3d" ? lastGoodResult3dRef.current : null;

  const isPending = state.view === "2d" ? rendered === null : rendered3d === null;
  const hasError = state.view === "2d" ? rendered !== null && !rendered.ok : rendered3d !== null && !rendered3d.ok;
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
    if (state.view !== "3d") return;
    let current = true;
    void renderGlyphDiagramsWorkbenchState3d(state).then((result) => { if (current) setCompleted3d({ state, result }); });
    return () => { current = false; };
  }, [state]);
  // The 3D-mounted LIVE viewport (`web` target only — terminal/chat mount
  // the static frame above through the same `TargetPreview` the 2D path
  // uses). `graph3d` depends only on the fields that change what gets
  // MOUNTED — target/charset/color/terminal edits must not tear down and
  // re-fit an orbiting scene the reader is mid-drag on.
  const graph3d = useMemo<GlyphGraph | null>(() => {
    try { return buildGlyphDiagramsWorkbenchGraph(state); }
    catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.sourceKind, state.mermaid, state.json, state.nodes, state.edges, state.tableGraph, state.layout.direction]);
  useEffect(() => {
    let current = true;
    void Promise.all(GLYPH_DIAGRAM_WORKBENCH_PRESETS.map(async (preset) => {
      try {
        if ("dimension" in preset && preset.dimension === "3d") {
          const graph = glyphGraphFromMermaid(preset.source);
          return (await renderGlyphDiagram3d(graph, { ...preset.view3d, target: "web", width: 60, height: 24 })).text;
        }
        return (await renderGlyphDiagram(preset.source, { target: state.controls.target, width: 60, height: 24 })).text;
      } catch { return "Preview unavailable"; }
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
  // Packet D3: in 3D, Copy reads `rendered3d` — a fresh `renderGlyphDiagram3d`
  // at the CURRENT camera (`state.camera3d`, set by the live viewport's own
  // orbit-end handler below) — so what Copy produces is what the reader is
  // actually looking at, on every target including `web`'s own live scene.
  const copy = async (encoding: "text" | "ansi") => {
    const source = state.view === "3d" ? rendered3d : rendered;
    if (!source?.ok) return;
    const value = encoding === "text" ? source.text : source.ansi;
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
  const currentRendered = state.view === "3d" ? rendered3d : rendered;
  const exportActions = <>
    <button type="button" className="gw-code-panel__action" disabled={!currentRendered?.ok} onClick={() => void copy("text")}>
      {copyTextState === "copied" ? "Copied" : copyTextState === "error" ? "Copy failed" : "Copy as text"}
    </button>
    {/* Hidden on `chat` (CHARTS-RESEARCH `DIAGNOSIS-target-matrix.md` C3,
     *  mirrored from `ChartsWorkbench.tsx`'s own export bar): a chat paste
     *  shows SGR escapes as literal `\x1b[38;2;…m` text, so Copy as text
     *  (above) is the honest export there. */}
    {currentRendered?.ok && currentRendered.ansi !== undefined && state.controls.target !== "chat" && <button type="button" className="gw-code-panel__action" onClick={() => void copy("ansi")}>
      {copyAnsiState === "copied" ? "Copied" : copyAnsiState === "error" ? "Copy failed" : "Copy ANSI"}
    </button>}
    <button type="button" className="gw-code-panel__action" onClick={() => void copyLink()}>
      {copyLinkState === "copied" ? "Copied" : copyLinkState === "error" ? "Copy failed" : "Copy link"}
    </button>
    {/* Download SVG reads the visible `<pre>` node (`glyphSvgExport.ts`) —
     *  the live 3D viewport's own `<pre>` is a real one (created by
     *  `createGlyphScene`) but this button's `preRef` only ever attaches
     *  to `TargetPreview`'s own node, so it stays disabled while a live
     *  scene, rather than that `<pre>`, is what's on screen. */}
    <button type="button" className="gw-code-panel__action" disabled={!currentRendered?.ok || (state.view === "3d" && state.controls.target === "web")} onClick={download}>
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
            {state.view === "2d" && rendered && !rendered.ok && <p className="diagrams-readout diagrams-error" role="alert">{rendered.error}</p>}
            {state.view === "3d" && rendered3d && !rendered3d.ok && <p className="diagrams-readout diagrams-error" role="alert">{rendered3d.error}</p>}
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
            {state.view === "3d" && state.controls.target === "web"
              // Live, orbitable scene — AGENTS.md's D3 row: no fixed cell
              // budget to scroll around, so this skips `.diagrams-grid-scroll`
              // entirely. Remounts only when the GRAPH or layout/seed/
              // rotation genuinely changes (see `Diagrams3DViewport.tsx`'s
              // own doc); target/charset/color edits leave it alone.
              ? (graph3d && <div className="diagrams-3d-frame">
                  {/* Fix round 4 — "why do we have this in the rendering
                   *  area?" (user feedback on /charts 3D, applying here too).
                   *  The viewport holds only the scene: a charset/colour
                   *  choice the live 3D view can't express is now surfaced
                   *  in the Dock, where the choice is made (see
                   *  `DiagramsDock.tsx`'s Charset/Color rows), never as
                   *  chrome floating over the render. */}
                  <Diagrams3DViewport
                    graph={graph3d} layout={state.view3d.layout} seed={state.view3d.seed}
                    direction={state.layout.direction} nodesep={state.layout.nodesep} ranksep={state.layout.ranksep}
                    controlsMode={state.view3d.controlsMode} initialCamera={state.camera3d}
                    charset={resolvedControls.charset} color={resolvedControls.color}
                    effectId={state.effect3d.effectId} effectTargetNodeId={state.effect3d.targetId}
                    onCameraSettled={(camera) => dispatch({ type: "set-camera3d", camera })}
                    onError={() => {/* surfaced via `rendered3d` above — its own effect independently renders the same graph/options */}}
                  />
                </div>)
              : <div className={`diagrams-grid-scroll${isViewportStale ? " is-stale" : ""}${isPending ? " is-loading" : ""}`}>
                  <TargetPreview ref={preRef} target={state.controls.target} commandTitle="glyphcss diagram …"
                    isHtml={Boolean(state.view === "2d" ? displayResult?.isHtml : displayResult3d?.html !== undefined)}
                    text={(state.view === "2d" ? displayResult?.text : displayResult3d?.text) ?? ""}
                    html={state.view === "2d" ? (displayResult?.isHtml ? displayResult.display : undefined) : displayResult3d?.html}
                    ansi={(state.view === "2d" ? displayResult?.ansi : displayResult3d?.ansi)}
                    charsetDowngraded={(state.view === "2d" ? displayResult?.charsetDowngraded : displayResult3d?.charsetDowngraded)}
                    ariaLabel={state.diagram.title || "Diagram preview"} ariaDescription={state.view === "2d" ? displayResult?.meta.description ?? undefined : undefined} />
                </div>}
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
      {GLYPH_DIAGRAM_WORKBENCH_PRESETS.map((preset, index) => {
        // Packet D3 — a labelled divider before the FIRST 3D preset (never
        // interleaved: a 3D tile changes what the viewport IS, not merely
        // what it shows — AGENTS.md's D3 row).
        const is3d = "dimension" in preset && preset.dimension === "3d";
        const previous = GLYPH_DIAGRAM_WORKBENCH_PRESETS[index - 1];
        const startsSection = is3d && (index === 0 || !("dimension" in previous! && previous.dimension === "3d"));
        return [
          startsSection && <span key={`${preset.id}-divider`} className="diagrams-tray-divider" role="separator" aria-label="3D presets">3D</span>,
          <button type="button" className="synth-tile" key={preset.id} title={`Apply “${preset.label}”`} aria-label={`Apply ${preset.label}`} onClick={() => dispatch({ type: "apply-preset", id: preset.id })}>
            <span className="synth-tile-scene diagrams-tile-preview" aria-hidden="true"><pre>{thumbnails[index] ?? ""}</pre></span><span className="synth-tile-label">{preset.label}</span>
          </button>,
        ];
      })}
    </InstrumentTray>
    <InstrumentMobileTabs label="Diagrams panels" items={(["source", "controls", "presets", "export"] as const).map((panel) => ({
      id: panel, label: panel[0]!.toUpperCase() + panel.slice(1), controls: `diagrams-${panel}-panel`, expanded: mobilePanel === panel,
      onClick: () => { setCodeOpen(false); setMobilePanel((current) => current === panel ? null : panel); },
    }))} />
  </InstrumentShell>;
}
