import { type GlyphGraph, renderGlyphDiagram } from "@glyphcss/diagrams";
import { glyphLaneDagFromGitLog, renderGlyphLaneDag, validateGlyphLaneDag } from "@glyphcss/diagrams/lanes";
import { renderGlyphSequence } from "@glyphcss/diagrams/sequence";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { DIAGRAMS_REMOTE_GRAPH_INDEX } from "../../../features/diagrams/data/remoteGraphIndex";
import { diagramsGraphSourceKey, randomDiagramsGraphPick } from "../../../features/diagrams/model/diagramsRandomGraph";
import {
  type DiagramsSourceCompletion,
  DIAGRAMS_SHAPE_CATALOGUE,
} from "../../../features/diagrams/model/diagramsSourceAid";
import type { DiagramsSourceItem } from "../../../features/diagrams/model/diagramsSourceSelection";
import type { DiagramsSourceDialect } from "../../../features/diagrams/model/diagramsSourceTokens";
import {
  type GlyphDiagramsWorkbenchState,
  buildGlyphDiagramsWorkbenchGraph,
  buildGlyphDiagramsWorkbenchLanes,
  buildGlyphDiagramsWorkbenchSequence,
  DIAGRAMS_WEB_BASE_FONT_PX,
  glyphDiagramsWorkbenchEffectiveDensity,
  generateGlyphDiagramsWorkbenchSnippets,
  GLYPH_DIAGRAM_WORKBENCH_PRESETS,
  GLYPH_DIAGRAMS_FORMS,
  GLYPH_DIAGRAMS_TRAY,
  GLYPH_LANES_WORKBENCH_PRESETS,
  GLYPH_SEQUENCE_WORKBENCH_PRESETS,
  reduceGlyphDiagramsWorkbenchState,
  resolveGlyphDiagramsWorkbenchControls,
} from "../../../features/diagrams/model/diagramsWorkbenchState";
import {
  type GlyphDiagramsWorkbenchRender,
  glyphDiagramsWorkbenchDisplayResult,
  renderGlyphDiagramsWorkbenchLanesState,
  renderGlyphDiagramsWorkbenchSequenceState,
  renderGlyphDiagramsWorkbenchState,
} from "../../../features/diagrams/render/diagramsWorkbenchRender";
import {
  createDiagramsUrlWriter,
  DIAGRAMS_URL_PARAM,
  encodeDiagramsUrlState,
} from "../../../features/diagrams/services/diagramsUrlState";
import {
  type GraphDatasetLoadResult,
  isAbort as isGraphAbort,
  loadGraphDatasetRow,
  loadRandomGraphDatasetRow,
} from "../../../features/diagrams/services/graphDatasetLoad";
import { type ElementPixelSize, useElementSize } from "../../../hooks/useElementSize";
import { downloadGlyphSvg } from "../../../services/export/glyphSvgExport";
import { writeUrlParam } from "../../../services/url-state/history";
import { useViewportPan } from "../../../hooks/useViewportPan";
import { flashButtonState } from "../controllerHelpers";
import { type DiagramsSourceEditorHandle } from "../DiagramsSourceEditor";
import { type MobilePanel } from "../types";

export function useDiagramsWorkbenchInner({
  initialState,
  initialRemoteGraph,
}: {
  readonly initialState: GlyphDiagramsWorkbenchState;
  readonly initialRemoteGraph?: {
    readonly ref: string;
    readonly rowIdx: number;
    readonly title: string;
    readonly description?: string;
    readonly licence?: string;
  };
}) {
  const [state, dispatch] = useReducer(reduceGlyphDiagramsWorkbenchState, initialState);

  const resolvedControls = resolveGlyphDiagramsWorkbenchControls(state.controls, state.form);

  const [mobilePanel, setMobilePanel] = useState<MobilePanel | null>(null);

  const [codeOpen, setCodeOpen] = useState(false);

  // Two independent render slots, one per pipeline (`completedGraph` was
  // simply `completed` before the sequence form existed) — each effect below
  // only computes for its OWN form, so an edit to the inactive form's source
  // never triggers a wasted `renderGlyphDiagram`/`renderGlyphSequence` call,
  // and switching form back and forth reads whichever slot last completed
  // for the state now on screen rather than recomputing from scratch.
  const [completedGraph, setCompletedGraph] = useState<{
    state: GlyphDiagramsWorkbenchState;
    viewportPx: ElementPixelSize | undefined;
    result: GlyphDiagramsWorkbenchRender;
  } | null>(null);

  const [completedSequence, setCompletedSequence] = useState<{
    state: GlyphDiagramsWorkbenchState;
    viewportPx: ElementPixelSize | undefined;
    result: GlyphDiagramsWorkbenchRender;
  } | null>(null);

  const [completedLanes, setCompletedLanes] = useState<{
    state: GlyphDiagramsWorkbenchState;
    viewportPx: ElementPixelSize | undefined;
    result: GlyphDiagramsWorkbenchRender;
  } | null>(null);

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
  const panViewportRef = useRef<HTMLDivElement | null>(null);
  const panContentRef = useRef<HTMLDivElement | null>(null);
  const { canPan, isPanning, resetView } = useViewportPan(panViewportRef, panContentRef, state);

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
  const completed =
    state.form === "graph" ? completedGraph : state.form === "sequence" ? completedSequence : completedLanes;

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

  const density = glyphDiagramsWorkbenchEffectiveDensity(state.controls);
  const previewStyle = useMemo(
    () => (state.controls.target === "web" ? { fontSize: DIAGRAMS_WEB_BASE_FONT_PX / density } : undefined),
    [state.controls.target, density],
  );

  const isPending = rendered === null;
  const hasError = rendered !== null && !rendered.ok;

  const isViewportStale = isPending || hasError;

  const snippets = useMemo(() => {
    try {
      return generateGlyphDiagramsWorkbenchSnippets(state, viewportPx);
    } catch {
      return null;
    }
  }, [state, viewportPx]);

  // One writer for the component's lifetime — see diagramsUrlState.ts's doc
  // (150ms debounced, `history.replaceState`-only, skip-when-unchanged). No
  // size-warning readout lives on this page — diagrams carry no "custom
  // source" concept a legacy link could still blow the cap with.
  const urlWriter = useRef(createDiagramsUrlWriter()).current;

  useEffect(() => {
    urlWriter(state);
  }, [state, urlWriter]);

  useEffect(() => {
    if (state.form !== "graph") return;
    let current = true;
    void renderGlyphDiagramsWorkbenchState(state, viewportPx).then((result) => {
      if (current) setCompletedGraph({ state, viewportPx, result });
    });
    return () => {
      current = false;
    };
  }, [state, viewportPx]);

  useEffect(() => {
    if (state.form !== "sequence") return;
    let current = true;
    void renderGlyphDiagramsWorkbenchSequenceState(state, viewportPx).then((result) => {
      if (current) setCompletedSequence({ state, viewportPx, result });
    });
    return () => {
      current = false;
    };
  }, [state, viewportPx]);

  useEffect(() => {
    if (state.form !== "lanes") return;
    let current = true;
    void renderGlyphDiagramsWorkbenchLanesState(state, viewportPx).then((result) => {
      if (current) setCompletedLanes({ state, viewportPx, result });
    });
    return () => {
      current = false;
    };
  }, [state, viewportPx]);

  // Parse once for the source card and editor completions.
  const parsedGraph = useMemo<GlyphGraph | null>(() => {
    try {
      return buildGlyphDiagramsWorkbenchGraph(state);
    } catch {
      return null;
    }
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
      if (state.form === "graph")
        return (parsedGraph ?? buildGlyphDiagramsWorkbenchGraph(state)).nodes.map((node) => ({
          id: node.id,
          label: node.label,
        }));
      if (state.form === "sequence")
        return buildGlyphDiagramsWorkbenchSequence(state).participants.map((p) => ({ id: p.id, label: p.label }));
      return buildGlyphDiagramsWorkbenchLanes(state).nodes.map((node) => ({ id: node.id, label: node.label }));
    } catch {
      return lastIdsRef.current;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.form,
    parsedGraph,
    state.sequence.sourceKind,
    state.sequence.mermaid,
    state.sequence.json,
    state.lanes.sourceKind,
    state.lanes.gitlog,
    state.lanes.json,
  ]);

  lastIdsRef.current = editorIds;

  // The shape legend's LIVE previews — every shape the renderer supports,
  // drawn by the real library at the Dock's current charset, so the menu
  // doubles as documentation that cannot drift from what renders.
  const [shapePreviews, setShapePreviews] = useState<Readonly<Partial<Record<string, string>>>>({});

  useEffect(() => {
    if (state.form !== "graph") return;
    let current = true;
    void Promise.all(
      DIAGRAMS_SHAPE_CATALOGUE.map(async ({ shape }) => {
        try {
          const result = await renderGlyphDiagram(
            { nodes: [{ id: "n", label: "Label", shape }], edges: [], direction: "TB" },
            { target: "web", charset: resolvedControls.charset, color: "none", width: 16, height: 7 },
          );
          const lines = result.pages[0]!.text.split("\n").filter((line) => line.trim().length > 0);
          const indent = Math.min(...lines.map((line) => line.length - line.trimStart().length));
          return [shape, lines.map((line) => line.slice(indent).trimEnd()).join("\n")] as const;
        } catch {
          return [shape, ""] as const;
        }
      }),
    ).then((pairs) => {
      if (current) setShapePreviews(Object.fromEntries(pairs));
    });
    return () => {
      current = false;
    };
  }, [state.form, resolvedControls.charset]);

  // The active form's source rail — ONE editor mount, parameterised by the
  // form's own tabs/dialect/slice; the per-form differences are data here,
  // not three copies of the rail.
  const rail =
    state.form === "graph"
      ? {
          tablist: "Graph source format",
          idPrefix: "diagrams",
          editor: state.editor as DiagramsSourceDialect,
          tabs: [
            { id: "mermaid", label: "Mermaid" },
            { id: "json", label: "JSON" },
          ] as const,
          label: state.editor === "mermaid" ? "Mermaid source" : "Nodes and edges JSON",
          value: state[state.editor],
          setEditor: (editor: string) => dispatch({ type: "set-editor", editor: editor as "mermaid" | "json" }),
          onChange: (value: string) => dispatch({ type: "edit-source", value }),
          note:
            state.editor === "mermaid"
              ? "Mermaid flowcharts and graphs. Styling and click directives are ignored."
              : "Nodes, edges, groups and direction. TypeScript and JSON exports preserve every graph field.",
        }
      : state.form === "sequence"
        ? {
            tablist: "Sequence source format",
            idPrefix: "diagrams-sequence",
            editor: state.sequence.editor as DiagramsSourceDialect,
            tabs: [
              { id: "mermaid", label: "Mermaid" },
              { id: "json", label: "JSON" },
            ] as const,
            label: state.sequence.editor === "mermaid" ? "Sequence Mermaid source" : "Sequence JSON",
            value: state.sequence[state.sequence.editor],
            setEditor: (editor: string) =>
              dispatch({ type: "set-sequence-editor", editor: editor as "mermaid" | "json" }),
            onChange: (value: string) => dispatch({ type: "edit-sequence-source", value }),
          }
        : {
            tablist: "Lane DAG source format",
            idPrefix: "diagrams-lanes",
            editor: state.lanes.editor as DiagramsSourceDialect,
            tabs: [
              { id: "gitlog", label: "Git log" },
              { id: "json", label: "JSON" },
            ] as const,
            label: state.lanes.editor === "gitlog" ? "Lane DAG git log source" : "Lane DAG nodes JSON",
            value: state.lanes[state.lanes.editor],
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

  const attachPre = useCallback((el: HTMLPreElement | null) => {
    preRef.current = el;
    setPreEl(el);
  }, []);

  const hotspotResult = rendered?.ok && rendered.hotspots && rendered.grid ? rendered : null;

  // The rail header names what is loaded (the `/charts` rail's own idiom:
  // the dataset title, never a generic label above a card that repeats it).
  const formLabel = GLYPH_DIAGRAMS_FORMS.find((f) => f.id === state.form)?.label ?? state.form;

  const loadedLabel =
    state.form === "graph"
      ? state.graphSource?.kind === "remote"
        ? state.graphSource.title
        : GLYPH_DIAGRAM_WORKBENCH_PRESETS.find(
            (p) => state.graphSource?.kind === "builtin" && p.id === state.graphSource.presetId,
          )?.label
      : state.form === "sequence"
        ? GLYPH_SEQUENCE_WORKBENCH_PRESETS.find((p) => p.id === state.sequence.presetId)?.label
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
    void Promise.all(
      GLYPH_DIAGRAMS_TRAY.map(async (entry) => {
        const key = `${entry.kind}:${entry.preset.id}`;
        try {
          if (entry.kind === "sequence") {
            return [
              key,
              (await renderGlyphSequence(entry.preset.source, { target: state.controls.target, width: 60, height: 24 }))
                .text,
            ] as const;
          }
          if (entry.kind === "lanes") {
            const dag =
              entry.preset.sourceKind === "gitlog"
                ? glyphLaneDagFromGitLog(entry.preset.source)
                : validateGlyphLaneDag(JSON.parse(entry.preset.source));
            return [
              key,
              (await renderGlyphLaneDag(dag, { target: state.controls.target, width: 60, height: 24 })).text,
            ] as const;
          }
          const preset = entry.preset;
          return [
            key,
            (await renderGlyphDiagram(preset.source, { target: state.controls.target, width: 60, height: 24 })).text,
          ] as const;
        } catch {
          return [key, "Preview unavailable"] as const;
        }
      }),
    ).then((pairs) => {
      if (current) setThumbnails(Object.fromEntries(pairs));
    });
    return () => {
      current = false;
    };
  }, [state.controls.target]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobilePanel(null);
        setCodeOpen(false);
      }
    };
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

  useEffect(
    () => () => {
      if (graphNoticeTimer.current !== null) window.clearTimeout(graphNoticeTimer.current);
    },
    [],
  );

  const remoteGraphController = useRef<AbortController | null>(null);

  const remoteGraphSeq = useRef(0);

  useEffect(() => () => remoteGraphController.current?.abort(), []);

  const loadRemoteGraph = useCallback(
    async (
      ref: string,
      rowIdx: number | "random",
      hitInfo: { readonly title: string; readonly description?: string; readonly licence?: string } | undefined,
      fromRandom = false,
    ) => {
      remoteGraphController.current?.abort();
      const controller = new AbortController();
      remoteGraphController.current = controller;
      const seq = ++remoteGraphSeq.current;
      const info = hitInfo ??
        DIAGRAMS_REMOTE_GRAPH_INDEX.find((h) => h.ref === ref) ?? {
          title: ref,
          description: undefined,
          licence: undefined,
        };
      setRemoteGraphLoadingTitle(info.title);
      let result: GraphDatasetLoadResult;
      try {
        result =
          rowIdx === "random"
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
          const fallback =
            GLYPH_DIAGRAM_WORKBENCH_PRESETS[Math.floor(Math.random() * GLYPH_DIAGRAM_WORKBENCH_PRESETS.length)]!;
          dispatch({ type: "apply-preset", id: fallback.id });
        }
        return;
      }
      dispatch({
        type: "select-remote-graph",
        graph: result.graph,
        ref,
        rowIdx: result.rowIdx,
        totalRows: result.totalRows,
        title: info.title,
        description: info.description,
        label: result.label,
        simplified: result.simplified,
        source: { name: info.title, url: result.source.url, licence: info.licence },
        originalNodeCount: result.originalNodeCount,
        logicalEdgeCount: result.logicalEdgeCount,
        edgeDirection: result.edgeDirection,
      });
      // P3 — names how much the node cap trimmed, nodes AND edges, not just
      // nodes: a graph can lose real edges to the cap even when its own node
      // count barely exceeds it (a hub node just past the cap takes every one
      // of its own edges with it).
      if (result.simplified) {
        showGraphNotice(
          `Simplified "${info.title}" for legibility — showing ${result.graph.nodes.length} of ${result.originalNodeCount} nodes, ${result.graph.edges.length} of ${result.logicalEdgeCount} edges.`,
        );
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [dispatch, showGraphNotice],
  );

  const handleRandomGraph = useCallback(() => {
    const pick = randomDiagramsGraphPick(diagramsGraphSourceKey(state.graphSource));
    if (pick.kind === "preset") {
      dispatch({ type: "apply-preset", id: pick.id });
      return;
    }
    void loadRemoteGraph(
      pick.hit.ref,
      "random",
      { title: pick.hit.title, description: pick.hit.description, licence: pick.hit.licence },
      true,
    );
  }, [state.graphSource, loadRemoteGraph]);

  // A `?d=` link naming an un-edited remote graph carries no node/edge data
  // (`diagramsUrlState.ts`'s own doc) — re-fetch the SAME `ref`/`rowIdx`
  // exactly once on mount, mirroring `ChartsWorkbench.tsx`'s own
  // `initialRemoteRef` effect.
  const remoteGraphLoadedOnMount = useRef(false);

  useEffect(() => {
    if (!initialRemoteGraph || remoteGraphLoadedOnMount.current) return;
    remoteGraphLoadedOnMount.current = true;
    void loadRemoteGraph(initialRemoteGraph.ref, initialRemoteGraph.rowIdx, {
      title: initialRemoteGraph.title,
      description: initialRemoteGraph.description,
      licence: initialRemoteGraph.licence,
    });
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

  const copy = async (encoding: "text" | "ansi") => {
    const source = rendered;
    if (!source?.ok) return;
    const value = encoding === "text" ? source.text : source.ansi;
    if (value === undefined) return;
    const setState = encoding === "text" ? setCopyTextState : setCopyAnsiState;
    try {
      await navigator.clipboard.writeText(value);
      flashButtonState(setState, "idle", "copied");
    } catch {
      flashButtonState(setState, "idle", "error");
    }
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
      if (raw) params.set(DIAGRAMS_URL_PARAM, raw);
      else params.delete(DIAGRAMS_URL_PARAM);
      const search = params.toString();
      const link = `${window.location.origin}${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
      await navigator.clipboard.writeText(link);
      flashButtonState(setCopyLinkState, "idle", "copied");
    } catch {
      flashButtonState(setCopyLinkState, "idle", "error");
    }
  };

  const download = () => {
    let ok = false;
    try {
      ok = downloadGlyphSvg(preRef.current, "glyphcss-diagram.svg");
    } catch {
      ok = false;
    }
    flashButtonState(setDownloadState, "idle", ok ? "downloaded" : "error");
  };

  const currentRendered = rendered;

  // The active form's own render failure, handed to the editor to place on
  // its line (`DiagramsSourceEditor`) — never over the render, which keeps
  // showing the last diagram that actually laid out (the viewport below).
  const sourceError = currentRendered && !currentRendered.ok ? currentRendered : null;
  return {
    currentRendered,
    copy,
    copyTextState,
    state,
    copyAnsiState,
    copyLink,
    copyLinkState,
    download,
    downloadState,
    railTitle,
    mobilePanel,
    rail,
    remoteGraphLoadingTitle,
    graphNotice,
    parsedGraph,
    editorRef,
    sourceError,
    editorIds,
    shapePreviews,
    setSelection,
    hovered,
    dispatch,
    loadRemoteGraph,
    handleRandomGraph,
    diagramsViewportRef,
    panViewportRef,
    panContentRef,
    canPan,
    isPanning,
    resetView,
    isPending,
    resolvedControls,
    isViewportStale,
    rendered,
    renderedViewportPx: completed?.viewportPx,
    attachPre,
    displayResult,
    previewStyle,
    hotspotResult,
    preEl,
    selection,
    setHovered,
    codeOpen,
    setMobilePanel,
    setCodeOpen,
    snippets,
    thumbnails,
  };
}
