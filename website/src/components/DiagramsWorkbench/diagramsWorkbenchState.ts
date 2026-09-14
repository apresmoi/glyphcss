import {
  GLYPH_DIAGRAM_TARGET_DEFAULTS, glyphGraphFromJson, glyphGraphFromMermaid,
  type GlyphDiagramCharset, type GlyphDiagramColorMode, type GlyphDiagramDetail,
  type GlyphDiagramRenderOptions, type GlyphDiagramTarget, type GlyphGraph,
  type GlyphGraphDirection, type GlyphGraphEdge, type GlyphGraphGroup, type GlyphGraphNode,
} from "@glyphcss/diagrams";
import type { GlyphDiagram3dCamera, GlyphDiagram3dLayoutKind, GlyphDiagram3dRenderOptions, GlyphDiagram3dZBy } from "@glyphcss/diagrams/3d";
import type { GlyphOrbitControlsMode } from "glyphcss";
import chain from "../../../../packages/diagrams/fixtures/chain.mmd?raw";
import diamond from "../../../../packages/diagrams/fixtures/diamond.mmd?raw";
import fanOut from "../../../../packages/diagrams/fixtures/fan-out.mmd?raw";
import cycle from "../../../../packages/diagrams/fixtures/cycle.mmd?raw";
import subgraph from "../../../../packages/diagrams/fixtures/subgraph.mmd?raw";
import langgraph from "../../../../packages/diagrams/fixtures/langgraph.mmd?raw";
import agentSupervisor from "../../../../packages/diagrams/fixtures/agent-supervisor.mmd?raw";
import karateClub from "../../../../packages/diagrams/fixtures/karate-club.mmd?raw";

const crewSource = `flowchart LR
  request[Request] --> manager[Manager]
  subgraph crew[Crew]
    researcher[Researcher] --> writer[Writer]
  end
  manager --> researcher
  writer --> review{Review}
  review -->|approved| result[Result]
  review -.->|revise| writer
`;

/**
 * `dimension`/`view3d` (packet D3, PLAN-3d.md §10) mark a preset that opens
 * the 3D viewport instead of the 2D one — see `datasets3d/LICENSES.md` for
 * where each 3D preset's data comes from (a real vendored dataset or a
 * hand-authored, explicitly labelled example; never invented data presented
 * as real). Omitted `dimension` (every pre-D3 preset) is `"2d"`,
 * byte-identical to before this field existed.
 */
export const GLYPH_DIAGRAM_WORKBENCH_PRESETS = [
  { id: "chain", label: "Chain", source: chain },
  { id: "diamond", label: "Diamond", source: diamond },
  { id: "fan-out", label: "Fan-out", source: fanOut },
  { id: "cycle", label: "Cycle", source: cycle },
  { id: "subgraph", label: "Subgraph", source: subgraph },
  { id: "langgraph", label: "LangGraph agent", source: langgraph },
  { id: "crew", label: "CrewAI-style crew", source: crewSource },
  {
    id: "agent-supervisor-3d", label: "Agent supervisor (3D, example)", source: agentSupervisor,
    dimension: "3d" as const, view3d: { layout: "layered" as const, zBy: "group" as const },
  },
  {
    id: "crew-3d", label: "Multi-agent crew (3D, example)", source: crewSource,
    dimension: "3d" as const, view3d: { layout: "layered" as const, zBy: "group" as const },
  },
  {
    id: "karate-club-3d", label: "Zachary's karate club (3D)", source: karateClub,
    dimension: "3d" as const, view3d: { layout: "force" as const, zBy: "none" as const },
  },
] as const;

export interface GlyphDiagramsWorkbenchControls {
  readonly target: GlyphDiagramTarget;
  readonly overrides: {
    readonly charset?: GlyphDiagramCharset;
    readonly color?: GlyphDiagramColorMode;
    readonly width?: number;
    readonly height?: number;
  };
}
export type GlyphDiagramsWorkbenchControlAction =
  | { type: "target"; value: GlyphDiagramTarget }
  | { type: "charset"; value: GlyphDiagramCharset }
  | { type: "color"; value: GlyphDiagramColorMode }
  | { type: "width" | "height"; value: number }
  | { type: "reset" };

export function reduceGlyphDiagramsWorkbenchControls(state: GlyphDiagramsWorkbenchControls, action: GlyphDiagramsWorkbenchControlAction): GlyphDiagramsWorkbenchControls {
  if (action.type === "target") return { ...state, target: action.value };
  if (action.type === "reset") return { target: state.target, overrides: {} };
  return { ...state, overrides: { ...state.overrides, [action.type]: action.value } };
}
export function resolveGlyphDiagramsWorkbenchControls(state: GlyphDiagramsWorkbenchControls) {
  return { target: state.target, ...GLYPH_DIAGRAM_TARGET_DEFAULTS[state.target], ...state.overrides };
}

/**
 * `view3d` (packet D3) — the layout/rotation knobs the Rail/Dock exposes
 * for the 3D viewport (AGENTS.md's "Diagrams 3D"): `layout`/`zBy`/`seed`
 * forward straight to `glyphDiagramObject`'s own options, `controlsMode`
 * picks turntable (default, axis-locked) vs. trackball (free rotation —
 * the user's "rotates in any direction" requirement) on the SAME
 * `createGlyphOrbitControls` the rest of the site's 3D surfaces use.
 */
export interface GlyphDiagramsWorkbenchView3d {
  readonly layout: GlyphDiagram3dLayoutKind;
  readonly zBy: GlyphDiagram3dZBy;
  readonly seed: number;
  readonly controlsMode: GlyphOrbitControlsMode;
}
/**
 * The resolved 3D camera — mirrors `renderGlyphDiagram3d`'s own `camera`
 * result shape (`rotX`/`rotY` XOR `mat`). `undefined` means "let the
 * library's own auto-fit choose one" (a fresh mount, or a just-applied
 * preset); set once the live viewport's orbit controls report a
 * `"end"` interaction, so Copy ASCII/ANSI and the `?d=` link both read the
 * camera the reader is actually looking through — AGENTS.md's D3 packet
 * "what you copy is what you see".
 */
export type GlyphDiagramsWorkbenchCamera3d = GlyphDiagram3dCamera & { readonly zoom: number };

export const GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_VIEW3D: GlyphDiagramsWorkbenchView3d = { layout: "layered", zBy: "group", seed: 1, controlsMode: "turntable" };

export interface GlyphDiagramsWorkbenchState {
  readonly editor: "mermaid" | "json" | "table";
  readonly sourceKind: "mermaid" | "json" | "table";
  readonly mermaid: string;
  readonly json: string;
  /** The "table" source (packet item 7) — a nodes table (id, label, kind)
   * and an edges table (from, to, label), beside the Mermaid/JSON tabs.
   * `group`/`shape` on a node and `id`/`style`/`priority` on an edge are
   * preserved verbatim (not editable here) so switching INTO the table and
   * back out never silently drops them. */
  readonly nodes: readonly GlyphGraphNode[];
  readonly edges: readonly GlyphGraphEdge[];
  /** GRAPH-level fields the table doesn't expose — `groups` and the
   * source's own `direction` — carried verbatim beside `nodes`/`edges` so
   * a table edit never silently drops them (final-gate-2 review, both P1
   * #4/#2: without this, `buildGlyphDiagramsWorkbenchGraph`'s table branch
   * rebuilt `{ nodes, edges, direction: "TB" }` with no `groups` at all,
   * so editing one cell on the Subgraph/CrewAI presets replaced the whole
   * render with an `unknown-group` error and silently reset LR to TB).
   * Updated together with `nodes`/`edges` everywhere they're set from a
   * freshly parsed graph (initial state, `apply-preset`, switching INTO
   * the table); untouched by every table-only edit (`set-node`,
   * `add-edge`, ...), which only ever touch `nodes`/`edges`. */
  readonly tableGraph: { readonly groups?: readonly GlyphGraphGroup[]; readonly direction: GlyphGraphDirection };
  readonly controls: GlyphDiagramsWorkbenchControls;
  readonly layout: { readonly direction?: GlyphGraph["direction"]; readonly engine: "dagre"; readonly nodesep: number; readonly ranksep: number };
  readonly diagram: { readonly title: string; readonly detail: GlyphDiagramDetail };
  readonly terminal: { readonly NO_COLOR: boolean; readonly FORCE_COLOR: boolean };
  /**
   * `view`/`view3d`/`camera3d` (packet D3) — APPENDED fields (see
   * `diagramsUrlState.ts`'s own append-only rule): a link saved before this
   * packet existed decodes with `view: "2d"`, `view3d` at its default, and
   * `camera3d` absent, i.e. exactly today's page. `view` picks which
   * viewport `DiagramsWorkbench.tsx` mounts for the SAME graph — 2D
   * (`TargetPreview`) or 3D (a live orbitable scene on `web`, a static
   * `renderGlyphDiagram3d` frame through the SAME `TargetPreview` on
   * `terminal`/`chat`, per AGENTS.md's Charts "Targets and page" export
   * boundary this page mirrors).
   */
  readonly view: "2d" | "3d";
  readonly view3d: GlyphDiagramsWorkbenchView3d;
  readonly camera3d?: GlyphDiagramsWorkbenchCamera3d;
}
export type GlyphDiagramsWorkbenchAction =
  | { type: "set-editor"; editor: GlyphDiagramsWorkbenchState["editor"] }
  | { type: "edit-source"; value: string }
  | { type: "apply-preset"; id: string }
  | { type: "set-control"; control: GlyphDiagramsWorkbenchControlAction }
  | { type: "set-layout"; patch: Partial<GlyphDiagramsWorkbenchState["layout"]> }
  | { type: "set-diagram"; patch: Partial<GlyphDiagramsWorkbenchState["diagram"]> }
  | { type: "set-terminal"; flag: "NO_COLOR" | "FORCE_COLOR"; value: boolean }
  // Table editor (packet item 7).
  | { type: "set-node"; index: number; patch: Partial<Pick<GlyphGraphNode, "id" | "label" | "kind">> }
  | { type: "add-node" }
  | { type: "remove-node"; index: number }
  | { type: "set-edge"; index: number; patch: Partial<Pick<GlyphGraphEdge, "from" | "to" | "label">> }
  | { type: "add-edge" }
  | { type: "remove-edge"; index: number }
  // 3D (packet D3).
  | { type: "set-view"; view: "2d" | "3d" }
  | { type: "set-view3d"; patch: Partial<GlyphDiagramsWorkbenchView3d> }
  | { type: "set-camera3d"; camera: GlyphDiagramsWorkbenchCamera3d | undefined };

function nextGlyphDiagramNodeId(existing: readonly GlyphGraphNode[]): string {
  let i = existing.length + 1;
  const ids = new Set(existing.map((n) => n.id));
  while (ids.has(`node${i}`)) i++;
  return `node${i}`;
}

export function createGlyphDiagramsWorkbenchState(): GlyphDiagramsWorkbenchState {
  const initialGraph = glyphGraphFromMermaid(langgraph);
  return {
    editor: "mermaid", sourceKind: "mermaid", mermaid: langgraph, json: JSON.stringify(initialGraph, null, 2),
    nodes: initialGraph.nodes, edges: initialGraph.edges,
    tableGraph: { groups: initialGraph.groups, direction: initialGraph.direction },
    controls: { target: "web", overrides: {} }, layout: { engine: "dagre", nodesep: 4, ranksep: 4 },
    diagram: { title: "LangGraph agent", detail: "auto" }, terminal: { NO_COLOR: false, FORCE_COLOR: false },
    view: "2d", view3d: GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_VIEW3D, camera3d: undefined,
  };
}
export function buildGlyphDiagramsWorkbenchGraph(state: GlyphDiagramsWorkbenchState): GlyphGraph {
  const graph = state.sourceKind === "mermaid" ? glyphGraphFromMermaid(state.mermaid)
    : state.sourceKind === "json" ? glyphGraphFromJson(JSON.parse(state.json))
    : { nodes: state.nodes, edges: state.edges, groups: state.tableGraph.groups, direction: state.tableGraph.direction };
  return state.layout.direction ? { ...graph, direction: state.layout.direction } : graph;
}

export function reduceGlyphDiagramsWorkbenchState(state: GlyphDiagramsWorkbenchState, action: GlyphDiagramsWorkbenchAction): GlyphDiagramsWorkbenchState {
  switch (action.type) {
    case "set-editor": {
      // Switching tabs REFRESHES the newly-shown representation's text from
      // whichever source is currently authoritative (`sourceKind`) — it
      // never steals authority itself, only an actual edit does (below),
      // which is what lets JSON-only metadata (`kind`, `priority`, ...)
      // survive a round trip through the Mermaid tab it has no vocabulary
      // for, right up until the reader edits Mermaid directly.
      if (action.editor === state.editor) return state;
      try {
        const graph = buildGlyphDiagramsWorkbenchGraph(state);
        if (action.editor === "json") return { ...state, editor: "json", json: JSON.stringify(graph, null, 2) };
        if (action.editor === "mermaid") return { ...state, editor: "mermaid", mermaid: glyphDiagramsWorkbenchMermaid(graph) };
        return { ...state, editor: "table", nodes: graph.nodes, edges: graph.edges, tableGraph: { groups: graph.groups, direction: graph.direction } };
      } catch {
        return { ...state, editor: action.editor, sourceKind: action.editor };
      }
    }
    case "edit-source": return { ...state, sourceKind: state.editor, [state.editor]: action.value };
    case "apply-preset": {
      const preset = GLYPH_DIAGRAM_WORKBENCH_PRESETS.find((item) => item.id === action.id);
      if (!preset) return state;
      const graph = glyphGraphFromMermaid(preset.source);
      // A 3D preset (`dimension: "3d"`) switches the viewport AND resets
      // `camera3d` to `undefined` so the newly-mounted object re-runs the
      // library's own auto-fit (AGENTS.md D3: never a page-tuned camera) —
      // a 2D preset resets `view3d` back to the shared default so an
      // earlier 3D preset's `layout`/`zBy` choice doesn't leak into the
      // next graph's own Rail/Dock reading.
      const is3d = "dimension" in preset && preset.dimension === "3d";
      const view3dPatch = is3d && "view3d" in preset ? preset.view3d : GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_VIEW3D;
      return { ...state, sourceKind: "mermaid", mermaid: preset.source, json: JSON.stringify(graph, null, 2), nodes: graph.nodes, edges: graph.edges,
        tableGraph: { groups: graph.groups, direction: graph.direction },
        layout: { ...state.layout, direction: undefined }, diagram: { ...state.diagram, title: preset.label },
        view: is3d ? "3d" : "2d", view3d: { ...GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_VIEW3D, ...view3dPatch }, camera3d: undefined };
    }
    case "set-control": return { ...state, controls: reduceGlyphDiagramsWorkbenchControls(state.controls, action.control) };
    case "set-layout": return { ...state, layout: { ...state.layout, ...action.patch } };
    case "set-diagram": return { ...state, diagram: { ...state.diagram, ...action.patch } };
    case "set-terminal": return { ...state, terminal: { ...state.terminal, [action.flag]: action.value } };
    case "set-node": return { ...state, sourceKind: "table", nodes: state.nodes.map((n, i) => i === action.index ? { ...n, ...action.patch } : n) };
    case "add-node": return { ...state, sourceKind: "table", nodes: [...state.nodes, { id: nextGlyphDiagramNodeId(state.nodes), label: "New node" }] };
    case "remove-node": return { ...state, sourceKind: "table", nodes: state.nodes.filter((_, i) => i !== action.index) };
    case "set-edge": return { ...state, sourceKind: "table", edges: state.edges.map((e, i) => i === action.index ? { ...e, ...action.patch } : e) };
    case "add-edge": return { ...state, sourceKind: "table", edges: [...state.edges, { from: state.nodes[0]?.id ?? "", to: state.nodes[1]?.id ?? state.nodes[0]?.id ?? "" }] };
    case "remove-edge": return { ...state, sourceKind: "table", edges: state.edges.filter((_, i) => i !== action.index) };
    // 3D (packet D3). A view switch clears `camera3d` — the fresh viewport
    // (or, on terminal/chat, the next static render) picks its own
    // auto-fit rather than inheriting a pose framed for the OTHER mode.
    case "set-view": return action.view === state.view ? state : { ...state, view: action.view, camera3d: undefined };
    // A layout/zBy/seed/controlsMode edit invalidates the mounted object's
    // geometry (a different layout is a different set of node positions),
    // so the camera resets to auto-fit for the SAME reason a view switch
    // does — an old camera framed for the previous layout can clip or
    // misplace the new one.
    case "set-view3d": return { ...state, view3d: { ...state.view3d, ...action.patch }, camera3d: undefined };
    case "set-camera3d": return { ...state, camera3d: action.camera };
  }
}
export function glyphDiagramsWorkbenchRenderOptions(state: GlyphDiagramsWorkbenchState): GlyphDiagramRenderOptions {
  return { ...resolveGlyphDiagramsWorkbenchControls(state.controls), ...state.layout, ...state.diagram,
    ...(state.controls.target === "terminal" ? { env: { ...(state.terminal.NO_COLOR ? { NO_COLOR: "1" } : {}), ...(state.terminal.FORCE_COLOR ? { FORCE_COLOR: "1" } : {}) } } : {}) };
}
/**
 * `renderGlyphDiagram3d`'s own options for the CURRENT state — shared by
 * the live viewport's initial auto-fit render, the static terminal/chat
 * frame, Copy ASCII/ANSI, and preset thumbnails (packet D3). `direction`/
 * `nodesep`/`ranksep` ride on the SAME "Layout" Dock folder the 2D path
 * already exposes (`GlyphDiagram3dLayoutOptions` and `GlyphDiagramLayoutOptions`
 * share those field names) rather than a duplicated 3D-only row set.
 */
export function glyphDiagramsWorkbenchRenderOptions3d(state: GlyphDiagramsWorkbenchState): GlyphDiagram3dRenderOptions {
  const controls = resolveGlyphDiagramsWorkbenchControls(state.controls);
  return {
    layout: state.view3d.layout, zBy: state.view3d.zBy, seed: state.view3d.seed,
    ...(state.layout.direction ? { direction: state.layout.direction } : {}),
    nodesep: state.layout.nodesep, ranksep: state.layout.ranksep,
    target: controls.target, charset: controls.charset, color: controls.color,
    width: controls.width, height: controls.height, title: state.diagram.title,
    ...(state.camera3d ? { camera: state.camera3d } : {}),
    ...(state.controls.target === "terminal" ? { env: { ...(state.terminal.NO_COLOR ? { NO_COLOR: "1" } : {}), ...(state.terminal.FORCE_COLOR ? { FORCE_COLOR: "1" } : {}) } } : {}),
  };
}
export function generateGlyphDiagramsWorkbenchSnippets(state: GlyphDiagramsWorkbenchState) {
  const graph = buildGlyphDiagramsWorkbenchGraph(state);
  const json = JSON.stringify(graph, null, 2);
  const input = state.sourceKind === "mermaid" ? JSON.stringify(state.mermaid) : json;
  const mermaid = state.sourceKind === "mermaid" && !state.layout.direction ? state.mermaid : glyphDiagramsWorkbenchMermaid(graph);
  return { json, mermaid, typescript: `import { renderGlyphDiagram } from "@glyphcss/diagrams";\n\nconst diagram = await renderGlyphDiagram(${input}, ${JSON.stringify(glyphDiagramsWorkbenchRenderOptions(state), null, 2)});\n` };
}

export function glyphDiagramsWorkbenchMermaid(graph: GlyphGraph): string {
  // Keep canonical ordering stable; aliases are only needed for JSON-only ids.
  const safeId = /^[\p{L}\p{N}_](?:[\p{L}\p{N}_.]|:(?!:)|-(?=[\p{L}\p{N}_]))*$/u;
  const used = new Set(graph.nodes.filter((node) => safeId.test(node.id)).map((node) => node.id));
  const ids = new Map(graph.nodes.map((node, index) => {
    if (safeId.test(node.id)) return [node.id, node.id];
    let id = `glyph_node_${index}`;
    while (used.has(id)) id += "_";
    used.add(id);
    return [node.id, id];
  }));
  const label = (text: string) => `"${text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\\/g, "&#92;").replace(/\n/g, "<br/>")}"`;
  const shapes = { rect: ["[", "]"], rounded: ["(", ")"], diamond: ["{", "}"], circle: ["((", "))"], subroutine: ["[[", "]]"], asymmetric: [">(", "]"], stadium: ["([", "])"] };
  const groups = graph.groups ?? [];
  // Same collision avoidance as node aliases: a group whose own id already
  // happens to equal another group's generated fallback alias (e.g.
  // "glyph_group_0") must not collide with it.
  const usedGroupIds = new Set(groups.filter((group) => safeId.test(group.id)).map((group) => group.id));
  const groupIds = new Map(groups.map((group, index) => {
    if (safeId.test(group.id)) return [group.id, group.id];
    let id = `glyph_group_${index}`;
    while (usedGroupIds.has(id)) id += "_";
    usedGroupIds.add(id);
    return [group.id, id];
  }));
  const lines = [`flowchart ${graph.direction}`];
  for (const node of graph.nodes) {
    const [open, close] = shapes[node.shape ?? "rect"]!;
    lines.push(`  ${ids.get(node.id)}${open}${label(node.label)}${close}`);
  }
  for (const group of groups) {
    lines.push(`  subgraph ${groupIds.get(group.id)}[${label(group.label ?? group.id)}]`, ...group.members.map((id) => `    ${ids.get(id)}`), "  end");
  }
  for (const edge of graph.edges) {
    const arrow = edge.style === "dotted" ? "-.->" : edge.style === "thick" ? "==>" : edge.style === "undirected" ? "---" : "-->";
    lines.push(`  ${ids.get(edge.from)} ${arrow}${edge.label ? `|${label(edge.label)}|` : ""} ${ids.get(edge.to)}`);
  }
  return `${lines.join("\n")}\n`;
}
