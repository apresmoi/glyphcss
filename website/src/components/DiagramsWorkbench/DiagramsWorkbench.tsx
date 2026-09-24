import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { glyphGraphFromJson, glyphGraphFromMermaid, renderGlyphDiagram, type GlyphGraph } from "@glyphcss/diagrams";
import { renderGlyphDiagram3d } from "@glyphcss/diagrams/3d";
import { Dock } from "../Dock/Dock";
import { CodePanel } from "../GalleryWorkbench/CodePanel";
import { InstrumentBody, InstrumentMain, InstrumentMobileTabs, InstrumentRail, InstrumentShell, InstrumentTray, InstrumentViewport } from "../InstrumentWorkbench/InstrumentWorkbench";
import { useElementSize, type ElementPixelSize } from "../InstrumentWorkbench/useElementSize";
import { downloadGlyphSvg } from "../../lib/glyphSvgExport";
import { readUrlParam, writeUrlParam } from "../../lib/urlState";
import { TargetPreview } from "../TargetPreview/TargetPreview";
import { renderGlyphSequence } from "@glyphcss/diagrams/sequence";
import { glyphLaneDagFromGitLog, renderGlyphLaneDag, validateGlyphLaneDag } from "@glyphcss/diagrams/lanes";
import { GlyphDiagramsDock } from "./DiagramsDock";
import { Diagrams3DViewport } from "./Diagrams3DViewport";
import {
  GLYPH_DIAGRAM_WORKBENCH_PRESETS, GLYPH_DIAGRAMS_FORMS, GLYPH_DIAGRAMS_TRAY, GLYPH_LANES_WORKBENCH_PRESETS, GLYPH_SEQUENCE_WORKBENCH_PRESETS, buildGlyphDiagramsWorkbenchGraph, buildGlyphDiagramsWorkbenchLanes, buildGlyphDiagramsWorkbenchSequence, createGlyphDiagramsWorkbenchState, generateGlyphDiagramsWorkbenchSnippets, reduceGlyphDiagramsWorkbenchState, resolveGlyphDiagramsWorkbenchControls,
  type GlyphDiagramsWorkbenchState,
} from "./diagramsWorkbenchState";
import { DIAGRAMS_URL_PARAM, createDiagramsUrlWriter, decodeDiagramsUrlState, encodeDiagramsUrlState } from "./diagramsUrlState";
import {
  glyphDiagramsWorkbenchDisplayResult, renderGlyphDiagramsWorkbenchLanesState, renderGlyphDiagramsWorkbenchSequenceState, renderGlyphDiagramsWorkbenchState, renderGlyphDiagramsWorkbenchState3d,
  type GlyphDiagramsWorkbenchRender, type GlyphDiagramsWorkbenchRender3d,
} from "./diagramsWorkbenchRender";
import { DiagramsDataOverlay } from "./DiagramsDataOverlay";
import { DiagramsGraphSourceCard } from "./DiagramsGraphSourceCard";
import { DiagramsSourceEditor, type DiagramsSourceEditorHandle } from "./DiagramsSourceEditor";
import { DIAGRAMS_SHAPE_CATALOGUE, diagramsSourceSnippets, type DiagramsSourceCompletion } from "./diagramsSourceAid";
import type { DiagramsSourceDialect } from "./diagramsSourceTokens";
import { DiagramsHotspotLayer } from "./DiagramsHotspotLayer";
import type { DiagramsSourceItem } from "./diagramsSourceSelection";
import { diagramsGraphSourceKey, randomDiagramsGraphPick } from "./diagramsRandomGraph";
import { DIAGRAMS_MOLECULE_GRAPH_REFS, DIAGRAMS_REMOTE_GRAPH_INDEX } from "./datasets/remoteGraphIndex";
import { isAbort as isGraphAbort, loadGraphDatasetRow, loadRandomGraphDatasetRow, type GraphDatasetLoadResult } from "../../lib/graphDatasetLoad";
import "../GalleryWorkbench/gallery-workbench.css";
import "./diagrams-workbench.css";

type MobilePanel = "source" | "controls" | "presets" | "export";
// The SAME tab labels `/charts` uses for the same formats ("TypeScript",
// "JSON") — one export vocabulary across the instrument pages.
const EXPORT_TABS = [{ id: "typescript", label: "TypeScript" }, { id: "mermaid", label: "Mermaid" }, { id: "json", label: "JSON" }] as const;
// The lane-DAG form has no Mermaid concept at all (`packages/diagrams/AGENTS.md`'s
// "Lane DAGs" — its own textual syntax is git-log, not Mermaid), so its own
// export tabs swap that slot for "Git log" rather than mislabeling git-log
// text as Mermaid. `generateGlyphDiagramsWorkbenchSnippets` returns a
// `gitlog` key (not `mermaid`) for this form, matching these ids exactly.
const EXPORT_TABS_LANES = [{ id: "typescript", label: "TypeScript" }, { id: "gitlog", label: "Git log" }, { id: "json", label: "JSON" }] as const;

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
  // Packet D5 — a decoded link naming an un-edited remote graph
  // (`graphSource.omitted`, `diagramsUrlState.ts`'s own doc) carries no
  // node/edge data at all; this is the ONE thing the outer wrapper computes
  // from `resolved` before handing off, mirroring `ChartsWorkbench.tsx`'s
  // own `initialRemoteRef` split.
  const initialRemoteGraph = resolved.graphSource?.kind === "remote" && resolved.graphSource.omitted
    ? { ref: resolved.graphSource.ref, rowIdx: resolved.graphSource.rowIdx, title: resolved.graphSource.title, description: resolved.graphSource.description, licence: resolved.graphSource.source.licence }
    : undefined;
  return <GlyphDiagramsWorkbenchInner initialState={resolved} initialRemoteGraph={initialRemoteGraph} />;
}

function GlyphDiagramsWorkbenchInner({ initialState, initialRemoteGraph }: {
  readonly initialState: GlyphDiagramsWorkbenchState;
  readonly initialRemoteGraph?: { readonly ref: string; readonly rowIdx: number; readonly title: string; readonly description?: string; readonly licence?: string };
}) {
  const [state, dispatch] = useReducer(reduceGlyphDiagramsWorkbenchState, initialState);
  // Fix round 1, P1-1 — the resolved (default-applied) target/charset/colour,
  // shared by the 3D thumbnail/render options above and the live viewport's
  // own scene options below.
  const resolvedControls = resolveGlyphDiagramsWorkbenchControls(state.controls, state.form);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  // Two independent render slots, one per pipeline (`completedGraph` was
  // simply `completed` before the sequence form existed) — each effect below
  // only computes for its OWN form, so an edit to the inactive form's source
  // never triggers a wasted `renderGlyphDiagram`/`renderGlyphSequence` call,
  // and switching form back and forth reads whichever slot last completed
  // for the state now on screen rather than recomputing from scratch.
  const [completedGraph, setCompletedGraph] = useState<{ state: GlyphDiagramsWorkbenchState; viewportPx: ElementPixelSize | undefined; result: GlyphDiagramsWorkbenchRender } | null>(null);
  const [completedSequence, setCompletedSequence] = useState<{ state: GlyphDiagramsWorkbenchState; viewportPx: ElementPixelSize | undefined; result: GlyphDiagramsWorkbenchRender } | null>(null);
  const [completedLanes, setCompletedLanes] = useState<{ state: GlyphDiagramsWorkbenchState; viewportPx: ElementPixelSize | undefined; result: GlyphDiagramsWorkbenchRender } | null>(null);
  const [thumbnails, setThumbnails] = useState<Readonly<Record<string, string>>>({});
  const preRef = useRef<HTMLPreElement | null>(null);
  // `web` fills the measured viewport instead of a fixed logical grid
  // (AGENTS.md's "Diagrams" "Targets and page" — mirrors `/charts`'
  // identical feature; see `ChartsWorkbench.tsx`'s own doc for the full
  // "why `.diagrams-preview` itself is the WRONG thing to observe"
  // reasoning). Observes `.diagrams-viewport` (`InstrumentViewport`'s own
  // element) instead — a genuinely definite, content-independent box —
  // never `.diagrams-preview`, whose `height: auto` block sizing lets a
  // previously-rendered large grid inflate it, which would ratchet the
  // measured size on a window shrink (agy review finding, verified in a
  // real Chromium). `diagrams-workbench.css`'s own `.diagrams-preview`
  // rule (`height: 100%`) closes the matching hole for anything further
  // down this flex chain this component has no ref to redirect.
  const diagramsViewportRef = useRef<HTMLDivElement | null>(null);
  const measuredViewportPx = useElementSize(diagramsViewportRef);
  const viewportPx = measuredViewportPx ?? undefined;
  // State AND viewportPx identity together prevent an old (or now
  // viewport-stale) result from becoming copyable during a new layout —
  // `useElementSize` keeps the SAME object across a no-op remeasurement, so
  // this comparison never restarts a layout pass that isn't actually stale.
  // `rendered` is FORM-polymorphic (the task's own "the Form axis is a data
  // entry, not a refactor" brief carried down to this variable): every
  // downstream reader below (`lastGoodResultRef`, `displayResult`, the error
  // banner, the viewport, Copy ASCII/ANSI, the export snippets) reads it
  // exactly as before this feature existed and needs no per-form branch of
  // its own, because `GlyphDiagramsWorkbenchRender` is the SAME shape for
  // both pipelines (`diagramsWorkbenchRender.ts`'s own doc on that type).
  const completed = state.form === "graph" ? completedGraph : state.form === "sequence" ? completedSequence : completedLanes;
  const rendered = completed?.state === state && completed.viewportPx === viewportPx ? completed.result : null;
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
    try { return generateGlyphDiagramsWorkbenchSnippets(state, viewportPx); }
    catch { return null; }
  }, [state, viewportPx]);
  // One writer for the component's lifetime — see diagramsUrlState.ts's doc
  // (150ms debounced, `history.replaceState`-only, skip-when-unchanged). No
  // size-warning readout lives on this page — diagrams carry no "custom
  // source" concept a legacy link could still blow the cap with.
  const urlWriter = useRef(createDiagramsUrlWriter()).current;
  useEffect(() => { urlWriter(state); }, [state, urlWriter]);

  useEffect(() => {
    if (state.form !== "graph") return;
    let current = true;
    void renderGlyphDiagramsWorkbenchState(state, viewportPx).then((result) => { if (current) setCompletedGraph({ state, viewportPx, result }); });
    return () => { current = false; };
  }, [state, viewportPx]);
  useEffect(() => {
    if (state.form !== "sequence") return;
    let current = true;
    void renderGlyphDiagramsWorkbenchSequenceState(state, viewportPx).then((result) => { if (current) setCompletedSequence({ state, viewportPx, result }); });
    return () => { current = false; };
  }, [state, viewportPx]);
  useEffect(() => {
    if (state.form !== "lanes") return;
    let current = true;
    void renderGlyphDiagramsWorkbenchLanesState(state, viewportPx).then((result) => { if (current) setCompletedLanes({ state, viewportPx, result }); });
    return () => { current = false; };
  }, [state, viewportPx]);
  useEffect(() => {
    if (state.view !== "3d") return;
    let current = true;
    void renderGlyphDiagramsWorkbenchState3d(state).then((result) => { if (current) setCompleted3d({ state, result }); });
    return () => { current = false; };
  }, [state]);
  // The CURRENT graph, parsed from whichever source is authoritative —
  // `null` while the draft doesn't parse. Feeds the 3D-mounted LIVE
  // viewport (`web` target only — terminal/chat mount the static frame
  // above through the same `TargetPreview` the 2D path uses) and the graph
  // source card's own node/edge counts. Depends only on the fields that
  // change what gets MOUNTED — target/charset/color/terminal edits must not
  // tear down and re-fit an orbiting scene the reader is mid-drag on.
  const parsedGraph = useMemo<GlyphGraph | null>(() => {
    try { return buildGlyphDiagramsWorkbenchGraph(state); }
    catch { return null; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.sourceKind, state.mermaid, state.json, state.layout.direction]);
  // The ids the active form's editor completes (`diagramsSourceAid.ts`):
  // graph nodes, sequence participants, lane nodes — whatever the live
  // parse last produced, so a draft mid-edit keeps offering the ids that
  // parsed before it broke (the same "don't disable the controls needed to
  // repair it" rule the Dock's own Direction read follows).
  const lastIdsRef = useRef<readonly DiagramsSourceCompletion[]>([]);
  const editorIds = useMemo<readonly DiagramsSourceCompletion[]>(() => {
    try {
      if (state.form === "graph") return (parsedGraph ?? buildGlyphDiagramsWorkbenchGraph(state)).nodes.map((node) => ({ id: node.id, label: node.label }));
      if (state.form === "sequence") return buildGlyphDiagramsWorkbenchSequence(state).participants.map((p) => ({ id: p.id, label: p.label }));
      return buildGlyphDiagramsWorkbenchLanes(state).nodes.map((node) => ({ id: node.id, label: node.label }));
    } catch { return lastIdsRef.current; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.form, parsedGraph, state.sequence.sourceKind, state.sequence.mermaid, state.sequence.json, state.lanes.sourceKind, state.lanes.gitlog, state.lanes.json]);
  lastIdsRef.current = editorIds;
  // The shape legend's LIVE previews — every shape the renderer supports,
  // drawn by the real library at the Dock's current charset, so the menu
  // doubles as documentation that cannot drift from what renders.
  const [shapePreviews, setShapePreviews] = useState<Readonly<Partial<Record<string, string>>>>({});
  useEffect(() => {
    if (state.form !== "graph") return;
    let current = true;
    void Promise.all(DIAGRAMS_SHAPE_CATALOGUE.map(async ({ shape }) => {
      try {
        const result = await renderGlyphDiagram({ nodes: [{ id: "n", label: "Label", shape }], edges: [], direction: "TB" }, { target: "web", charset: resolvedControls.charset, color: "none", width: 16, height: 7 });
        const lines = result.pages[0]!.text.split("\n").filter((line) => line.trim().length > 0);
        const indent = Math.min(...lines.map((line) => line.length - line.trimStart().length));
        return [shape, lines.map((line) => line.slice(indent).trimEnd()).join("\n")] as const;
      } catch { return [shape, ""] as const; }
    })).then((pairs) => { if (current) setShapePreviews(Object.fromEntries(pairs)); });
    return () => { current = false; };
  }, [state.form, resolvedControls.charset]);
  // The active form's source rail — ONE editor mount, parameterised by the
  // form's own tabs/dialect/slice; the per-form differences are data here,
  // not three copies of the rail.
  const rail = state.form === "graph"
    ? {
        tablist: "Graph source format", idPrefix: "diagrams", editor: state.editor as DiagramsSourceDialect,
        tabs: [{ id: "mermaid", label: "Mermaid" }, { id: "json", label: "JSON" }] as const,
        label: state.editor === "mermaid" ? "Mermaid source" : "Nodes and edges JSON", value: state[state.editor],
        setEditor: (editor: string) => dispatch({ type: "set-editor", editor: editor as "mermaid" | "json" }),
        onChange: (value: string) => dispatch({ type: "edit-source", value }),
        note: state.editor === "mermaid" ? "Mermaid flowcharts and graphs. Styling and click directives are ignored." : "Nodes, edges, groups and direction. TypeScript and JSON exports preserve every graph field.",
      }
    : state.form === "sequence"
      ? {
          tablist: "Sequence source format", idPrefix: "diagrams-sequence", editor: state.sequence.editor as DiagramsSourceDialect,
          tabs: [{ id: "mermaid", label: "Mermaid" }, { id: "json", label: "JSON" }] as const,
          label: state.sequence.editor === "mermaid" ? "Sequence Mermaid source" : "Sequence JSON", value: state.sequence[state.sequence.editor],
          setEditor: (editor: string) => dispatch({ type: "set-sequence-editor", editor: editor as "mermaid" | "json" }),
          onChange: (value: string) => dispatch({ type: "edit-sequence-source", value }),
        }
      : {
          tablist: "Lane DAG source format", idPrefix: "diagrams-lanes", editor: state.lanes.editor as DiagramsSourceDialect,
          tabs: [{ id: "gitlog", label: "Git log" }, { id: "json", label: "JSON" }] as const,
          label: state.lanes.editor === "gitlog" ? "Lane DAG git log source" : "Lane DAG nodes JSON", value: state.lanes[state.lanes.editor],
          setEditor: (editor: string) => dispatch({ type: "set-lanes-editor", editor: editor as "gitlog" | "json" }),
          onChange: (value: string) => dispatch({ type: "edit-lanes-source", value }),
        };
  const editorRef = useRef<DiagramsSourceEditorHandle | null>(null);
  // Selection is ONE thing, owned by the editor's caret: the node or edge
  // whose field the caret is in (`diagramsSourceSelection.ts`). The render's
  // hotspot layer marks it, and a hotspot click only asks the editor to
  // select that item's field — the marked hotspot then follows from the
  // caret like any other caret move, so the two can never disagree.
  const [selection, setSelection] = useState<DiagramsSourceItem | null>(null);
  // Hover is the OTHER direction and a separate thing from selection: the
  // pointer resting on a hotspot lights that item's fields in the rail
  // without disturbing the caret, so "which node is this" is answered where
  // it can be acted on. The render itself draws nothing (USER: "the chart
  // should remain pure").
  const [hovered, setHovered] = useState<DiagramsSourceItem | null>(null);
  // The `<pre>` as a VALUE too (the hotspot layer measures it and must
  // re-measure when the element itself is swapped, e.g. a target change).
  const [preEl, setPreEl] = useState<HTMLPreElement | null>(null);
  const attachPre = useCallback((el: HTMLPreElement | null) => { preRef.current = el; setPreEl(el); }, []);
  const hotspotResult = state.view === "2d" && rendered?.ok && rendered.hotspots && rendered.grid ? rendered : null;
  // The rail header names what is loaded (the `/charts` rail's own idiom:
  // the dataset title, never a generic label above a card that repeats it).
  const formLabel = GLYPH_DIAGRAMS_FORMS.find((f) => f.id === state.form)?.label ?? state.form;
  const loadedLabel = state.form === "graph"
    ? (state.graphSource?.kind === "remote" ? state.graphSource.title : GLYPH_DIAGRAM_WORKBENCH_PRESETS.find((p) => state.graphSource?.kind === "builtin" && p.id === state.graphSource.presetId)?.label)
    : state.form === "sequence" ? GLYPH_SEQUENCE_WORKBENCH_PRESETS.find((p) => p.id === state.sequence.presetId)?.label
    : GLYPH_LANES_WORKBENCH_PRESETS.find((p) => p.id === state.lanes.presetId)?.label;
  const railTitle = loadedLabel ? `${formLabel} · ${loadedLabel}` : formLabel;
  useEffect(() => {
    let current = true;
    // The tray carries EVERY form's presets at once, keyed per preset rather
    // than by index into one form's list. Gating the list on the ACTIVE form
    // was circular: the form defaults to `graph`, so a sequence preset could
    // only be reached by finding the Dock's Form toggle FIRST — which is
    // exactly the "there is no preset of sequence" report. Picking a tile is
    // what switches the form (`apply-sequence-preset` sets `form`).
    void Promise.all(GLYPH_DIAGRAMS_TRAY.map(async (entry) => {
      const key = `${entry.kind}:${entry.preset.id}`;
      try {
        if (entry.kind === "sequence") {
          return [key, (await renderGlyphSequence(entry.preset.source, { target: state.controls.target, width: 60, height: 24 })).text] as const;
        }
        if (entry.kind === "lanes") {
          const dag = entry.preset.sourceKind === "gitlog" ? glyphLaneDagFromGitLog(entry.preset.source) : validateGlyphLaneDag(JSON.parse(entry.preset.source));
          return [key, (await renderGlyphLaneDag(dag, { target: state.controls.target, width: 60, height: 24 })).text] as const;
        }
        const preset = entry.preset;
        if ("dimension" in preset && preset.dimension === "3d") {
          // D2 round 6 — a JSON-sourced 3D preset (LeNet-5, Transformer:
          // explicit per-node `size`, no Mermaid vocabulary for it) parses
          // through `glyphGraphFromJson`, never `glyphGraphFromMermaid`.
          const graph = "sourceKind" in preset && preset.sourceKind === "json"
            ? glyphGraphFromJson(JSON.parse(preset.source)) : glyphGraphFromMermaid(preset.source);
          return [key, (await renderGlyphDiagram3d(graph, { ...preset.view3d, target: "web", width: 60, height: 24 })).text] as const;
        }
        return [key, (await renderGlyphDiagram(preset.source, { target: state.controls.target, width: 60, height: 24 })).text] as const;
      } catch { return [key, "Preview unavailable"] as const; }
    })).then((pairs) => { if (current) setThumbnails(Object.fromEntries(pairs)); });
    return () => { current = false; };
  }, [state.controls.target]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { setMobilePanel(null); setCodeOpen(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Graph dataset search (packet D5, mirrors `ChartsWorkbench.tsx`'s own
  // `loadRemoteDataset`): loads a specific row (or, `rowIdx === "random"`,
  // Random's own within-dataset pick) off-network, then commits it with
  // ONE synchronous dispatch once it lands. `hitInfo` supplies the display
  // title/description/licence — from the search box's own `DatasetHit`, a
  // curated-index lookup by ref (Random's own pick, or a decoded link whose
  // ref happens to be curated), or (a pasted arbitrary id) just the ref
  // itself. The generation guard mirrors `ChartsWorkbench.tsx`'s own
  // `remoteLoadSeq`: a superseded load's result is dropped on arrival
  // rather than clobbering whatever the reader picked next.
  const [remoteGraphLoadingTitle, setRemoteGraphLoadingTitle] = useState<string | undefined>(undefined);
  const [graphNotice, setGraphNotice] = useState<string | undefined>(undefined);
  const graphNoticeTimer = useRef<number | null>(null);
  const showGraphNotice = useCallback((message: string) => {
    setGraphNotice(message);
    if (graphNoticeTimer.current !== null) window.clearTimeout(graphNoticeTimer.current);
    graphNoticeTimer.current = window.setTimeout(() => setGraphNotice(undefined), 4000);
  }, []);
  useEffect(() => () => { if (graphNoticeTimer.current !== null) window.clearTimeout(graphNoticeTimer.current); }, []);
  const remoteGraphController = useRef<AbortController | null>(null);
  const remoteGraphSeq = useRef(0);
  useEffect(() => () => remoteGraphController.current?.abort(), []);
  const loadRemoteGraph = useCallback(async (
    ref: string, rowIdx: number | "random",
    hitInfo: { readonly title: string; readonly description?: string; readonly licence?: string } | undefined,
    fromRandom = false,
  ) => {
    remoteGraphController.current?.abort();
    const controller = new AbortController();
    remoteGraphController.current = controller;
    const seq = ++remoteGraphSeq.current;
    const info = hitInfo ?? DIAGRAMS_REMOTE_GRAPH_INDEX.find((h) => h.ref === ref) ?? { title: ref, description: undefined, licence: undefined };
    setRemoteGraphLoadingTitle(info.title);
    let result: GraphDatasetLoadResult;
    try {
      result = rowIdx === "random"
        ? await loadRandomGraphDatasetRow(ref, { signal: controller.signal })
        : await loadGraphDatasetRow(ref, rowIdx, { signal: controller.signal });
    } catch (error) {
      if (seq !== remoteGraphSeq.current) return;
      setRemoteGraphLoadingTitle(undefined);
      if (isGraphAbort(error)) return; // superseded — a newer load (or nothing) already owns the UI
      showGraphNotice(`Couldn't load "${info.title}": ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (seq !== remoteGraphSeq.current) return; // superseded while in flight
    setRemoteGraphLoadingTitle(undefined);
    if (!result.ok) {
      showGraphNotice(`Couldn't load "${info.title}": ${result.error}`);
      // Random's own remote pick falls back to a random BUILT-IN preset
      // (never a blank/unchanged diagram on the button that just promised
      // a new one, and never a SECOND remote pick that could fail again the
      // same way) — a manual search-box pick or a stale link stays on the
      // reader's current graph with only the notice.
      if (fromRandom) {
        const fallback = GLYPH_DIAGRAM_WORKBENCH_PRESETS[Math.floor(Math.random() * GLYPH_DIAGRAM_WORKBENCH_PRESETS.length)]!;
        dispatch({ type: "apply-preset", id: fallback.id });
      }
      return;
    }
    dispatch({
      type: "select-remote-graph", graph: result.graph, ref, rowIdx: result.rowIdx, totalRows: result.totalRows,
      title: info.title, description: info.description, label: result.label, simplified: result.simplified,
      source: { name: info.title, url: result.source.url, licence: info.licence },
      preferred3d: DIAGRAMS_MOLECULE_GRAPH_REFS.has(ref),
      originalNodeCount: result.originalNodeCount, logicalEdgeCount: result.logicalEdgeCount, edgeDirection: result.edgeDirection,
    });
    // P3 — names how much the node cap trimmed, nodes AND edges, not just
    // nodes: a graph can lose real edges to the cap even when its own node
    // count barely exceeds it (a hub node just past the cap takes every one
    // of its own edges with it).
    if (result.simplified) {
      showGraphNotice(`Simplified "${info.title}" for legibility — showing ${result.graph.nodes.length} of ${result.originalNodeCount} nodes, ${result.graph.edges.length} of ${result.logicalEdgeCount} edges.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, showGraphNotice]);

  const handleRandomGraph = useCallback(() => {
    const pick = randomDiagramsGraphPick(diagramsGraphSourceKey(state.graphSource));
    if (pick.kind === "preset") { dispatch({ type: "apply-preset", id: pick.id }); return; }
    void loadRemoteGraph(pick.hit.ref, "random", { title: pick.hit.title, description: pick.hit.description, licence: pick.hit.licence }, true);
  }, [state.graphSource, loadRemoteGraph]);

  // A `?d=` link naming an un-edited remote graph carries no node/edge data
  // (`diagramsUrlState.ts`'s own doc) — re-fetch the SAME `ref`/`rowIdx`
  // exactly once on mount, mirroring `ChartsWorkbench.tsx`'s own
  // `initialRemoteRef` effect.
  const remoteGraphLoadedOnMount = useRef(false);
  useEffect(() => {
    if (!initialRemoteGraph || remoteGraphLoadedOnMount.current) return;
    remoteGraphLoadedOnMount.current = true;
    void loadRemoteGraph(initialRemoteGraph.ref, initialRemoteGraph.rowIdx, { title: initialRemoteGraph.title, description: initialRemoteGraph.description, licence: initialRemoteGraph.licence });
    // Runs once on mount only — `loadRemoteGraph`'s own identity is stable
    // across the reducer's lifetime (it closes only over `dispatch`/
    // `showGraphNotice`, neither of which `useReducer`/this component ever
    // changes across renders).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  // The active form's own render failure, handed to the editor to place on
  // its line (`DiagramsSourceEditor`) — never over the render, which keeps
  // showing the last diagram that actually laid out (the viewport below).
  const sourceError = currentRendered && !currentRendered.ok ? currentRendered : null;
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
      <InstrumentRail id="diagrams-source-panel" title={railTitle} open={mobilePanel === "source"}
        action={<div className="gx-toggle diagrams-source-tabs" role="tablist" aria-label={rail.tablist}>
          {rail.tabs.map((tab) => <button type="button" key={tab.id} id={`${rail.idPrefix}-${tab.id}-tab`} role="tab" aria-selected={rail.editor === tab.id} aria-controls={`${rail.idPrefix}-${tab.id}-editor`}
            className={`gx-toggle-btn gx-toggle-text${rail.editor === tab.id ? " is-active" : ""}`} onClick={() => rail.setEditor(tab.id)}>{tab.label}</button>)}
        </div>}>
        {/* The rail IS the editor (user feedback: "too much borders and
         *  boxes... that mermaid editor can basically fill the whole
         *  sidebar"): no card, no disclosure — the dialect tabs share the
         *  header row with the title ("mermaid/json could be next to
         *  graph"), then the insert toolbar, the editor filling the
         *  remaining height, and its own error strip. The only thing above
         *  it is the remote graph's provenance (title, credit, licence,
         *  node cap), which a Hugging Face pick genuinely owes its source;
         *  a tray preset names itself in the rail header instead. A render
         *  error names itself INSIDE the editor, on its line — never over
         *  the render, which keeps showing the last diagram that actually
         *  laid out. No syntax note under the editor: what a dialect
         *  accepts is what the error strip says when it does not. */}
        {state.form === "graph" && <DiagramsGraphSourceCard
          graphSource={state.graphSource} loadingTitle={remoteGraphLoadingTitle} notice={graphNotice}
          nodeCount={parsedGraph?.nodes.length} edgeCount={parsedGraph?.edges.length}
        />}
        <div role="tabpanel" id={`${rail.idPrefix}-${rail.editor}-editor`} aria-labelledby={`${rail.idPrefix}-${rail.editor}-tab`} className="diagrams-source-panel">
          <DiagramsSourceEditor
            ref={editorRef} id={`${rail.idPrefix}-${rail.editor}-source`} form={state.form} dialect={rail.editor}
            label={rail.label} value={rail.value} onChange={rail.onChange} error={sourceError}
            ids={editorIds} snippets={diagramsSourceSnippets(state.form, rail.editor)} previews={state.form === "graph" ? shapePreviews : undefined}
            onSelectionChange={setSelection} highlight={hovered}
          />
        </div>
      </InstrumentRail>
      <InstrumentMain>
        {/* Search + Random, floating over the viewport — the SAME overlay
         *  shape `ChartsWorkbench.tsx`'s own `<ChartsDataOverlay>` uses,
         *  a sibling of `<InstrumentViewport>` (packet D5). Graph-only —
         *  sequence has no remote search/random today (this file's own rail
         *  doc above). */}
        {state.form === "graph" && <DiagramsDataOverlay
          loadedTitle={state.graphSource?.kind === "remote" ? state.graphSource.title : (GLYPH_DIAGRAM_WORKBENCH_PRESETS.find((p) => state.graphSource?.kind === "builtin" && p.id === state.graphSource.presetId)?.label ?? "")}
          onSelectBuiltIn={(id) => dispatch({ type: "apply-preset", id })}
          onSelectRemote={(hit) => void loadRemoteGraph(hit.ref, "random", { title: hit.title, description: hit.description, licence: hit.licence })}
          onRandom={handleRandomGraph}
        />}
        <InstrumentViewport className="diagrams-viewport" elementRef={diagramsViewportRef}>
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
              ? (parsedGraph && <div className="diagrams-3d-frame">
                  {/* Fix round 4 — "why do we have this in the rendering
                   *  area?" (user feedback on /charts 3D, applying here too).
                   *  The viewport holds only the scene: a charset/colour
                   *  choice the live 3D view can't express is now surfaced
                   *  in the Dock, where the choice is made (see
                   *  `DiagramsDock.tsx`'s Charset/Color rows), never as
                   *  chrome floating over the render. */}
                  <Diagrams3DViewport
                    graph={parsedGraph} layout={state.view3d.layout} seed={state.view3d.seed}
                    direction={state.layout.direction} nodesep={state.layout.nodesep} ranksep={state.layout.ranksep}
                    controlsMode={state.view3d.controlsMode} initialCamera={state.camera3d}
                    charset={resolvedControls.charset} color={resolvedControls.color}
                    effectId={state.effect3d.effectId} effectTargetNodeId={state.effect3d.targetId}
                    onCameraSettled={(camera) => dispatch({ type: "set-camera3d", camera })}
                    onError={() => {/* surfaced via `rendered3d` above — its own effect independently renders the same graph/options */}}
                  />
                </div>)
              : <div className={`diagrams-grid-scroll${isViewportStale ? " is-stale" : ""}${isPending ? " is-loading" : ""}${rendered?.ok && rendered.hotspots?.length ? " has-hotspots" : ""}`}>
                  <TargetPreview ref={attachPre} target={state.controls.target} commandTitle="glyphcss diagram …"
                    isHtml={Boolean(state.view === "2d" ? displayResult?.isHtml : displayResult3d?.html !== undefined)}
                    text={(state.view === "2d" ? displayResult?.text : displayResult3d?.text) ?? ""}
                    html={state.view === "2d" ? (displayResult?.isHtml ? displayResult.display : undefined) : displayResult3d?.html}
                    ansi={(state.view === "2d" ? displayResult?.ansi : displayResult3d?.ansi)}
                    charsetDowngraded={(state.view === "2d" ? displayResult?.charsetDowngraded : displayResult3d?.charsetDowngraded)}
                    ariaLabel={state.diagram.title || "Diagram preview"} ariaDescription={state.view === "2d" ? displayResult?.meta.description ?? undefined : undefined} />
                  {hotspotResult && <DiagramsHotspotLayer pre={preEl} hotspots={hotspotResult.hotspots!} grid={hotspotResult.grid!} selected={selection}
                    onSelect={(item) => { editorRef.current?.selectItem(item); }} onHover={setHovered} />}
                </div>}
          </div>
        </InstrumentViewport>
        <div className="synth-export-bar">{exportActions}
          <button type="button" className={`gw-code-panel__action${codeOpen ? " is-active" : ""}`} aria-controls="diagrams-export-panel" aria-expanded={codeOpen} onClick={() => { setMobilePanel(null); setCodeOpen((current) => !current); }}>Export</button>
        </div>
        {(codeOpen || mobilePanel === "export") && <CodePanel id="diagrams-export-panel" className={`synth-code-panel${mobilePanel === "export" ? " is-mobile-open" : ""}`}
          override={{
            // A single object shape (both `mermaid` and `gitlog` keys always
            // present) rather than a form-conditional union — `tabs` below
            // decides which key is ever actually shown, so an unused key
            // here is harmless, and this keeps the type a plain
            // `Record<string, string>` instead of a union CodePanel's own
            // `Readonly<Record<string, string>>` prop can't accept.
            snippets: snippets ?? {
              typescript: state.form === "lanes" ? "Fix the lane DAG errors to export." : "Fix the graph errors to export.",
              mermaid: "Fix the graph errors to export.", gitlog: "Fix the lane DAG errors to export.",
              json: state.form === "lanes" ? "Fix the lane DAG errors to export." : "Fix the graph errors to export.",
            },
            tabs: state.form === "lanes" ? EXPORT_TABS_LANES : EXPORT_TABS,
          }} actions={exportActions} />}
      </InstrumentMain>
      <Dock id="diagrams-controls-panel" className={mobilePanel === "controls" ? "is-mobile-open" : ""}><GlyphDiagramsDock state={state} dispatch={dispatch} /></Dock>
    </InstrumentBody>
    <InstrumentTray id="diagrams-presets-panel" label="Diagram presets" open={mobilePanel === "presets"}>
      {GLYPH_DIAGRAMS_TRAY.map((entry, index) => {
        const key = `${entry.kind}:${entry.preset.id}`;
        const previous = GLYPH_DIAGRAMS_TRAY[index - 1];
        // A labelled divider before the FIRST tile of each section (never
        // interleaved: a 3D tile changes what the viewport IS, and a
        // sequence tile changes which pipeline renders it).
        const divider = entry.section && entry.section !== previous?.section ? entry.section : null;
        return [
          divider && <span key={`${key}-divider`} className="diagrams-tray-divider" role="separator" aria-label={`${divider} presets`}>{divider}</span>,
          <button type="button" className="synth-tile" key={key} title={`Apply “${entry.preset.label}”`} aria-label={`Apply ${entry.preset.label}`}
            onClick={() => dispatch(entry.kind === "sequence" ? { type: "apply-sequence-preset", id: entry.preset.id } : entry.kind === "lanes" ? { type: "apply-lanes-preset", id: entry.preset.id } : { type: "apply-preset", id: entry.preset.id })}>
            <span className="synth-tile-scene diagrams-tile-preview" aria-hidden="true"><pre>{thumbnails[key] ?? ""}</pre></span><span className="synth-tile-label">{entry.preset.label}</span>
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
