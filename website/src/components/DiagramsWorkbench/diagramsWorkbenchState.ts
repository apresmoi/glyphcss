import {
  GLYPH_DIAGRAM_TARGET_DEFAULTS, glyphGraphFromJson, glyphGraphFromMermaid,
  type GlyphDiagramCharset, type GlyphDiagramColorMode, type GlyphDiagramDetail,
  type GlyphDiagramRenderOptions, type GlyphDiagramTarget, type GlyphGraph,
} from "@glyphcss/diagrams";
import chain from "../../../../packages/diagrams/fixtures/chain.mmd?raw";
import diamond from "../../../../packages/diagrams/fixtures/diamond.mmd?raw";
import fanOut from "../../../../packages/diagrams/fixtures/fan-out.mmd?raw";
import cycle from "../../../../packages/diagrams/fixtures/cycle.mmd?raw";
import subgraph from "../../../../packages/diagrams/fixtures/subgraph.mmd?raw";
import langgraph from "../../../../packages/diagrams/fixtures/langgraph.mmd?raw";

export const GLYPH_DIAGRAM_WORKBENCH_PRESETS = [
  { id: "chain", label: "Chain", source: chain },
  { id: "diamond", label: "Diamond", source: diamond },
  { id: "fan-out", label: "Fan-out", source: fanOut },
  { id: "cycle", label: "Cycle", source: cycle },
  { id: "subgraph", label: "Subgraph", source: subgraph },
  { id: "langgraph", label: "LangGraph agent", source: langgraph },
  { id: "crew", label: "CrewAI-style crew", source: `flowchart LR
  request[Request] --> manager[Manager]
  subgraph crew[Crew]
    researcher[Researcher] --> writer[Writer]
  end
  manager --> researcher
  writer --> review{Review}
  review -->|approved| result[Result]
  review -.->|revise| writer
` },
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

export interface GlyphDiagramsWorkbenchState {
  readonly editor: "mermaid" | "json";
  readonly sourceKind: "mermaid" | "json";
  readonly mermaid: string;
  readonly json: string;
  readonly controls: GlyphDiagramsWorkbenchControls;
  readonly layout: { readonly direction?: GlyphGraph["direction"]; readonly engine: "dagre"; readonly nodesep: number; readonly ranksep: number };
  readonly diagram: { readonly title: string; readonly detail: GlyphDiagramDetail };
  readonly terminal: { readonly NO_COLOR: boolean; readonly FORCE_COLOR: boolean };
}
export type GlyphDiagramsWorkbenchAction =
  | { type: "set-editor"; editor: GlyphDiagramsWorkbenchState["editor"] }
  | { type: "edit-source"; value: string }
  | { type: "apply-preset"; id: string }
  | { type: "set-control"; control: GlyphDiagramsWorkbenchControlAction }
  | { type: "set-layout"; patch: Partial<GlyphDiagramsWorkbenchState["layout"]> }
  | { type: "set-diagram"; patch: Partial<GlyphDiagramsWorkbenchState["diagram"]> }
  | { type: "set-terminal"; flag: "NO_COLOR" | "FORCE_COLOR"; value: boolean };

export function createGlyphDiagramsWorkbenchState(): GlyphDiagramsWorkbenchState {
  return {
    editor: "mermaid", sourceKind: "mermaid", mermaid: langgraph, json: JSON.stringify(glyphGraphFromMermaid(langgraph), null, 2),
    controls: { target: "web", overrides: {} }, layout: { engine: "dagre", nodesep: 4, ranksep: 4 },
    diagram: { title: "LangGraph agent", detail: "auto" }, terminal: { NO_COLOR: false, FORCE_COLOR: false },
  };
}
export function buildGlyphDiagramsWorkbenchGraph(state: GlyphDiagramsWorkbenchState): GlyphGraph {
  const graph = state.sourceKind === "mermaid" ? glyphGraphFromMermaid(state.mermaid) : glyphGraphFromJson(JSON.parse(state.json));
  return state.layout.direction ? { ...graph, direction: state.layout.direction } : graph;
}

export function reduceGlyphDiagramsWorkbenchState(state: GlyphDiagramsWorkbenchState, action: GlyphDiagramsWorkbenchAction): GlyphDiagramsWorkbenchState {
  switch (action.type) {
    case "set-editor": {
      if (action.editor === "json" && state.editor === "mermaid") {
        try { return { ...state, editor: "json", json: JSON.stringify(buildGlyphDiagramsWorkbenchGraph(state), null, 2) }; }
        catch { return { ...state, editor: "json", sourceKind: "json" }; }
      }
      if (action.editor === "mermaid" && state.editor === "json") {
        try { return { ...state, editor: "mermaid", mermaid: glyphDiagramsWorkbenchMermaid(buildGlyphDiagramsWorkbenchGraph(state)) }; }
        catch { return { ...state, editor: "mermaid", sourceKind: "mermaid" }; }
      }
      return { ...state, editor: action.editor };
    }
    case "edit-source": return { ...state, sourceKind: state.editor, [state.editor]: action.value };
    case "apply-preset": {
      const preset = GLYPH_DIAGRAM_WORKBENCH_PRESETS.find((item) => item.id === action.id);
      if (!preset) return state;
      return { ...state, sourceKind: "mermaid", mermaid: preset.source, json: JSON.stringify(glyphGraphFromMermaid(preset.source), null, 2),
        layout: { ...state.layout, direction: undefined }, diagram: { ...state.diagram, title: preset.label } };
    }
    case "set-control": return { ...state, controls: reduceGlyphDiagramsWorkbenchControls(state.controls, action.control) };
    case "set-layout": return { ...state, layout: { ...state.layout, ...action.patch } };
    case "set-diagram": return { ...state, diagram: { ...state.diagram, ...action.patch } };
    case "set-terminal": return { ...state, terminal: { ...state.terminal, [action.flag]: action.value } };
  }
}
export function glyphDiagramsWorkbenchRenderOptions(state: GlyphDiagramsWorkbenchState): GlyphDiagramRenderOptions {
  return { ...resolveGlyphDiagramsWorkbenchControls(state.controls), ...state.layout, ...state.diagram,
    ...(state.controls.target === "terminal" ? { env: { ...(state.terminal.NO_COLOR ? { NO_COLOR: "1" } : {}), ...(state.terminal.FORCE_COLOR ? { FORCE_COLOR: "1" } : {}) } } : {}) };
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
