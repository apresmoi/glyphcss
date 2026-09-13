// /diagrams' whole workbench configuration in one shareable `?d=` query
// param — same envelope as chartsUrlState.ts (see that file's doc and
// website/src/lib/jsonUrlState.ts): a graph's nodes/edges are an open-ended
// array, so this packs as a JSON blob rather than urlState.ts's flat
// packed-field schema.
//
// Envelope is append-only per version, same rule as chartsUrlState.ts: `v1`
// covers every field `GlyphDiagramsWorkbenchState` has today; a future
// additive field is optional/defaulted in the `v1` validator, and only an
// incompatible reshaping of an existing field bumps to `v2`.
import {
  type GlyphDiagramsWorkbenchControls,
  type GlyphDiagramsWorkbenchState,
} from "./diagramsWorkbenchState";
import type { GlyphDiagramCharset, GlyphDiagramColorMode, GlyphDiagramDetail, GlyphDiagramTarget, GlyphGraph, GlyphGraphEdge, GlyphGraphNode } from "@glyphcss/diagrams";
import { createDebouncedJsonUrlWriter, createJsonUrlEnvelope } from "../../lib/jsonUrlState";

export const DIAGRAMS_URL_PARAM = "d";
const VERSION = "v1";
/** Same advisory threshold as chartsUrlState.ts — the link is written in
 *  full either way; this only gates the page's "link is N KB" notice. */
export const DIAGRAMS_URL_SIZE_WARN_BYTES = 8192;

const EDITOR_KINDS = ["mermaid", "json", "table"] as const;
const DIAGRAM_TARGETS: readonly GlyphDiagramTarget[] = ["chat", "terminal", "web"];
const DIAGRAM_CHARSETS: readonly GlyphDiagramCharset[] = ["ascii", "box", "blocks", "braille"];
const DIAGRAM_COLORS: readonly GlyphDiagramColorMode[] = ["none", "ansi16", "ansi256", "truecolor", "css"];
const DIAGRAM_DETAILS: readonly GlyphDiagramDetail[] = ["auto", "faithful", "balanced", "simplified"];
const GRAPH_DIRECTIONS: readonly GlyphGraph["direction"][] = ["TB", "LR", "BT", "RL"];
const GRAPH_NODE_SHAPES: readonly NonNullable<GlyphGraphNode["shape"]>[] = ["rect", "rounded", "diamond", "circle", "subroutine", "asymmetric", "stadium"];
const GRAPH_EDGE_STYLES: readonly NonNullable<GlyphGraphEdge["style"]>[] = ["solid", "dotted", "thick", "undirected"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function validateNode(value: unknown): GlyphGraphNode | null {
  if (!isRecord(value)) return null;
  const { id, label, kind, group, shape } = value;
  if (typeof id !== "string" || typeof label !== "string") return null;
  if (kind !== undefined && typeof kind !== "string") return null;
  if (group !== undefined && typeof group !== "string") return null;
  if (shape !== undefined && !oneOf(shape, GRAPH_NODE_SHAPES)) return null;
  return { id, label, ...(kind !== undefined ? { kind } : {}), ...(group !== undefined ? { group } : {}), ...(shape !== undefined ? { shape } : {}) };
}

function validateEdge(value: unknown): GlyphGraphEdge | null {
  if (!isRecord(value)) return null;
  const { id, from, to, label, style, priority } = value;
  if (typeof from !== "string" || typeof to !== "string") return null;
  if (id !== undefined && typeof id !== "string") return null;
  if (label !== undefined && typeof label !== "string") return null;
  if (style !== undefined && !oneOf(style, GRAPH_EDGE_STYLES)) return null;
  if (priority !== undefined && (typeof priority !== "number" || !Number.isFinite(priority))) return null;
  return {
    from, to,
    ...(id !== undefined ? { id } : {}), ...(label !== undefined ? { label } : {}),
    ...(style !== undefined ? { style } : {}), ...(priority !== undefined ? { priority } : {}),
  };
}

function validateControls(value: unknown): GlyphDiagramsWorkbenchControls | null {
  if (!isRecord(value)) return null;
  const { target, overrides } = value;
  if (!oneOf(target, DIAGRAM_TARGETS)) return null;
  if (!isRecord(overrides)) return null;
  const clean: GlyphDiagramsWorkbenchControls["overrides"] = {};
  if (overrides.charset !== undefined) {
    if (!oneOf(overrides.charset, DIAGRAM_CHARSETS)) return null;
    clean.charset = overrides.charset;
  }
  if (overrides.color !== undefined) {
    if (!oneOf(overrides.color, DIAGRAM_COLORS)) return null;
    clean.color = overrides.color;
  }
  if (overrides.width !== undefined) {
    if (typeof overrides.width !== "number" || !Number.isFinite(overrides.width)) return null;
    clean.width = overrides.width;
  }
  if (overrides.height !== undefined) {
    if (typeof overrides.height !== "number" || !Number.isFinite(overrides.height)) return null;
    clean.height = overrides.height;
  }
  return { target, overrides: clean };
}

function validateDiagramsWorkbenchState(value: unknown): GlyphDiagramsWorkbenchState | null {
  if (!isRecord(value)) return null;
  const { editor, sourceKind, mermaid, json, nodes, edges, controls, layout, diagram, terminal } = value;

  if (!oneOf(editor, EDITOR_KINDS) || !oneOf(sourceKind, EDITOR_KINDS)) return null;
  if (typeof mermaid !== "string" || typeof json !== "string") return null;

  if (!Array.isArray(nodes) || !Array.isArray(edges)) return null;
  const cleanNodes: GlyphGraphNode[] = [];
  for (const rawNode of nodes) {
    const node = validateNode(rawNode);
    if (!node) return null;
    cleanNodes.push(node);
  }
  const cleanEdges: GlyphGraphEdge[] = [];
  for (const rawEdge of edges) {
    const edge = validateEdge(rawEdge);
    if (!edge) return null;
    cleanEdges.push(edge);
  }

  const cleanControls = validateControls(controls);
  if (!cleanControls) return null;

  if (!isRecord(layout)) return null;
  const { direction, engine, nodesep, ranksep } = layout;
  if (direction !== undefined && !oneOf(direction, GRAPH_DIRECTIONS)) return null;
  if (engine !== "dagre") return null;
  if (typeof nodesep !== "number" || !Number.isFinite(nodesep)) return null;
  if (typeof ranksep !== "number" || !Number.isFinite(ranksep)) return null;

  if (!isRecord(diagram)) return null;
  if (typeof diagram.title !== "string" || !oneOf(diagram.detail, DIAGRAM_DETAILS)) return null;

  if (!isRecord(terminal)) return null;
  if (typeof terminal.NO_COLOR !== "boolean" || typeof terminal.FORCE_COLOR !== "boolean") return null;

  return {
    editor, sourceKind, mermaid, json, nodes: cleanNodes, edges: cleanEdges,
    controls: cleanControls,
    layout: { engine: "dagre", nodesep, ranksep, ...(direction !== undefined ? { direction } : {}) },
    diagram: { title: diagram.title, detail: diagram.detail },
    terminal: { NO_COLOR: terminal.NO_COLOR, FORCE_COLOR: terminal.FORCE_COLOR },
  };
}

const diagramsUrlEnvelope = createJsonUrlEnvelope<GlyphDiagramsWorkbenchState>(VERSION, validateDiagramsWorkbenchState);

export function encodeDiagramsUrlState(state: GlyphDiagramsWorkbenchState): Promise<string> {
  return diagramsUrlEnvelope.encode(state);
}
export function decodeDiagramsUrlState(raw: string | null | undefined): Promise<GlyphDiagramsWorkbenchState | null> {
  return diagramsUrlEnvelope.decode(raw);
}

/** One writer per mounted page (see DiagramsWorkbench.tsx) — same
 *  150ms-debounced, replaceState-only, skip-when-unchanged writer as
 *  chartsUrlState.ts's. */
export function createDiagramsUrlWriter(onEncoded?: (info: { raw: string; sizeBytes: number }) => void): (state: GlyphDiagramsWorkbenchState) => void {
  return createDebouncedJsonUrlWriter(diagramsUrlEnvelope, DIAGRAMS_URL_PARAM, 150, onEncoded);
}
