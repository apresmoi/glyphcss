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
  GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_EFFECT3D,
  GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_VIEW3D,
  type GlyphDiagramsGraphSource,
  type GlyphDiagramsWorkbenchCamera3d,
  type GlyphDiagramsWorkbenchControls,
  type GlyphDiagramsWorkbenchState,
  type GlyphDiagramsWorkbenchView3d,
} from "./diagramsWorkbenchState";
import type { Instrument3DEffectsState } from "../InstrumentWorkbench/Instrument3DEffectsFolder";
import type { GlyphDiagramCharset, GlyphDiagramColorMode, GlyphDiagramDetail, GlyphDiagramTarget, GlyphGraph, GlyphGraphEdge, GlyphGraphGroup, GlyphGraphNode } from "@glyphcss/diagrams";
import type { GlyphDiagram3dLayoutKind } from "@glyphcss/diagrams/3d";
import type { GlyphOrbitControlsMode } from "glyphcss";
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
const GRAPH_NODE_SHAPES: readonly NonNullable<GlyphGraphNode["shape"]>[] = ["rect", "rounded", "diamond", "circle", "subroutine", "asymmetric", "stadium", "cylinder"];
const GRAPH_EDGE_STYLES: readonly NonNullable<GlyphGraphEdge["style"]>[] = ["solid", "dotted", "thick", "undirected"];
const VIEW_KINDS = ["2d", "3d"] as const;
const VIEW3D_LAYOUTS: readonly GlyphDiagram3dLayoutKind[] = ["layered", "force"];
const VIEW3D_CONTROLS_MODES: readonly GlyphOrbitControlsMode[] = ["turntable", "trackball"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function oneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function validateNode(value: unknown): GlyphGraphNode | null {
  if (!isRecord(value)) return null;
  const { id, label, kind, group, shape, size } = value;
  if (typeof id !== "string" || typeof label !== "string") return null;
  if (kind !== undefined && typeof kind !== "string") return null;
  if (group !== undefined && typeof group !== "string") return null;
  if (shape !== undefined && !oneOf(shape, GRAPH_NODE_SHAPES)) return null;
  // D2 round 6 — `size` (JSON-only, AGENTS.md's "Diagrams 3D": a CNN's
  // per-layer activation-map extent, a transformer block's uniform stack)
  // used to be silently dropped on DECODE — this function reconstructs
  // every node field-by-field rather than spreading the raw value, and
  // `size` was missing from that list, so the LeNet-5/Transformer 3D
  // presets' own `?d=` round trip lost their explicit sizing.
  let cleanSize: readonly [number, number, number] | undefined;
  if (size !== undefined) {
    if (!Array.isArray(size) || size.length !== 3 || !size.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    cleanSize = [size[0], size[1], size[2]];
  }
  return {
    id, label, ...(kind !== undefined ? { kind } : {}), ...(group !== undefined ? { group } : {}),
    ...(shape !== undefined ? { shape } : {}), ...(cleanSize !== undefined ? { size: cleanSize } : {}),
  };
}

function validateGroup(value: unknown): GlyphGraphGroup | null {
  if (!isRecord(value)) return null;
  const { id, label, members } = value;
  if (typeof id !== "string") return null;
  if (label !== undefined && typeof label !== "string") return null;
  if (!Array.isArray(members) || !members.every((m) => typeof m === "string")) return null;
  return { id, members, ...(label !== undefined ? { label } : {}) };
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

/**
 * Packet D3 — append-only, same rule as `tableGraph` above: omitted decodes
 * to the shared default, never rejects the link. D2 round 5 retired `zBy`
 * (the library's own option is gone — `layout: "layered"` is now one fixed
 * planar embedding); a `zBy` key on an OLD link is simply ignored, not
 * rejected — the surrounding object shape still validates.
 */
function validateView3d(value: unknown): GlyphDiagramsWorkbenchView3d | null {
  if (!isRecord(value)) return null;
  const { layout, seed, controlsMode } = value;
  if (!oneOf(layout, VIEW3D_LAYOUTS) || !oneOf(controlsMode, VIEW3D_CONTROLS_MODES)) return null;
  if (typeof seed !== "number" || !Number.isFinite(seed)) return null;
  return { layout, seed, controlsMode };
}
/** `target` is `GlyphDiagramsWorkbenchCamera3d.target`'s own 3-element pan
 *  offset — append-only, mirroring `chartsUrlState.ts`'s own
 *  `validateCharts3dCameraPan`: a malformed value degrades to ABSENT (the
 *  fitted centre) rather than rejecting the whole camera. */
const CAMERA3D_TARGET_LENGTH = 3;
function validateCamera3dTarget(value: unknown): readonly [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== CAMERA3D_TARGET_LENGTH) return null;
  return value.every((n) => typeof n === "number" && Number.isFinite(n)) ? (value as [number, number, number]) : null;
}
/** Packet D3 — `rotX`/`rotY` XOR `mat`, mirroring `GlyphDiagram3dCamera`'s own shape (`render3d.ts`). */
function validateCamera3d(value: unknown): GlyphDiagramsWorkbenchCamera3d | null {
  if (!isRecord(value)) return null;
  const { rotX, rotY, zoom, mat } = value;
  if (typeof zoom !== "number" || !Number.isFinite(zoom)) return null;
  const target = value.target !== undefined ? validateCamera3dTarget(value.target) : null;
  if (mat !== undefined) {
    if (!Array.isArray(mat) || !mat.every((n) => typeof n === "number" && Number.isFinite(n))) return null;
    if (rotX !== undefined || rotY !== undefined) return null;
    return { zoom, mat, ...(target !== null ? { target } : {}) };
  }
  if (rotX !== undefined && (typeof rotX !== "number" || !Number.isFinite(rotX))) return null;
  if (rotY !== undefined && (typeof rotY !== "number" || !Number.isFinite(rotY))) return null;
  return { zoom, ...(rotX !== undefined ? { rotX } : {}), ...(rotY !== undefined ? { rotY } : {}), ...(target !== null ? { target } : {}) };
}

/**
 * Fix round 1, P1-2 — free-form: `effectId` is any non-empty string (a
 * stock `@glyphcss/effects` id today, `"none"` for no layer; a future
 * added effect id needs no urlState change) and `targetId` is any
 * non-empty string (`INSTRUMENT_3D_EFFECT_ALL_TARGET` or a node id — a
 * node id from a graph this link's own nodes/edges no longer contain
 * degrades to "matches no mesh" at mount, `Diagrams3DViewport.tsx`'s own
 * `resolveEffectTarget` doc, never a decode rejection).
 */
function validateEffect3d(value: unknown): Instrument3DEffectsState | null {
  if (!isRecord(value)) return null;
  const { effectId, targetId } = value;
  if (typeof effectId !== "string" || effectId.length === 0) return null;
  if (typeof targetId !== "string" || targetId.length === 0) return null;
  return { effectId, targetId };
}

/**
 * Packet D5 — append-only, same rule as `view3d` above: a link saved before
 * this field existed simply omits `graphSource`, decoding to `undefined`
 * (the graph-source card then shows nothing, rather than guessing an
 * origin the link never recorded) — never a decode rejection. The graph
 * itself never rides in `graphSource` for a `"remote"` source (only `ref`/
 * `rowIdx`/a title SNAPSHOT) — `DiagramsWorkbench.tsx` re-fetches it fresh
 * on mount, mirroring `chartsUrlState.ts`'s own remote-dataset rule.
 */
function validateGraphSource(value: unknown): GlyphDiagramsGraphSource | null {
  if (!isRecord(value)) return null;
  if (value.kind === "builtin") {
    return typeof value.presetId === "string" ? { kind: "builtin", presetId: value.presetId } : null;
  }
  if (value.kind !== "remote") return null;
  const { ref, rowIdx, totalRows, title, description, label, simplified, source, omitted, originalNodeCount, logicalEdgeCount, edgeDirection } = value;
  if (typeof ref !== "string" || typeof title !== "string") return null;
  if (typeof rowIdx !== "number" || !Number.isFinite(rowIdx)) return null;
  if (typeof totalRows !== "number" || !Number.isFinite(totalRows)) return null;
  if (description !== undefined && typeof description !== "string") return null;
  if (label !== undefined && typeof label !== "string") return null;
  if (simplified !== undefined && typeof simplified !== "boolean") return null;
  if (omitted !== undefined && omitted !== true) return null;
  // P3 fix round — append-only, same rule as every other optional field
  // here: absent on an older link, never rejected.
  if (originalNodeCount !== undefined && (typeof originalNodeCount !== "number" || !Number.isFinite(originalNodeCount))) return null;
  if (logicalEdgeCount !== undefined && (typeof logicalEdgeCount !== "number" || !Number.isFinite(logicalEdgeCount))) return null;
  if (edgeDirection !== undefined && !oneOf(edgeDirection, ["directed", "undirected"] as const)) return null;
  if (!isRecord(source) || typeof source.name !== "string" || typeof source.url !== "string") return null;
  if (source.licence !== undefined && typeof source.licence !== "string") return null;
  return {
    kind: "remote", ref, rowIdx, totalRows, title,
    ...(description !== undefined ? { description } : {}), ...(label !== undefined ? { label } : {}), ...(simplified !== undefined ? { simplified } : {}),
    ...(omitted === true ? { omitted: true as const } : {}),
    ...(originalNodeCount !== undefined ? { originalNodeCount } : {}),
    ...(logicalEdgeCount !== undefined ? { logicalEdgeCount } : {}),
    ...(edgeDirection !== undefined ? { edgeDirection } : {}),
    source: { name: source.name, url: source.url, ...(source.licence !== undefined ? { licence: source.licence } : {}) },
  };
}

function validateDiagramsWorkbenchState(value: unknown): GlyphDiagramsWorkbenchState | null {
  if (!isRecord(value)) return null;
  const { editor, sourceKind, mermaid, json, nodes, edges, tableGraph, controls, layout, diagram, terminal, view, view3d, camera3d, effect3d, graphSource, graphEdited } = value;
  if (graphEdited !== undefined && typeof graphEdited !== "boolean") return null;

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

  // `tableGraph` (final-gate-2 review, both P1 #4/#2) is APPEND-ONLY: an
  // older link encoded before this field existed simply omits it, and
  // decodes to `{ direction: "TB" }` — the exact default the pre-fix state
  // always built anyway, so an old link's behaviour doesn't change; only a
  // link saved AFTER a table edit on a grouped preset now round-trips its
  // `groups` too.
  let cleanTableGraph: GlyphDiagramsWorkbenchState["tableGraph"] = { direction: "TB" };
  if (tableGraph !== undefined) {
    if (!isRecord(tableGraph)) return null;
    const { groups, direction: tableDirection } = tableGraph;
    if (tableDirection !== undefined && !oneOf(tableDirection, GRAPH_DIRECTIONS)) return null;
    let cleanGroups: GlyphGraphGroup[] | undefined;
    if (groups !== undefined) {
      if (!Array.isArray(groups)) return null;
      cleanGroups = [];
      for (const rawGroup of groups) {
        const group = validateGroup(rawGroup);
        if (!group) return null;
        cleanGroups.push(group);
      }
    }
    cleanTableGraph = { direction: tableDirection ?? "TB", ...(cleanGroups !== undefined ? { groups: cleanGroups } : {}) };
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

  // Packet D3, append-only (this file's own top-of-file rule): `view`
  // omitted is `"2d"` — an older link decodes to exactly today's page.
  // `view3d` omitted is the shared default; `camera3d` omitted is
  // `undefined` (auto-fit), never a rejection.
  if (view !== undefined && !oneOf(view, VIEW_KINDS)) return null;
  let cleanView3d = GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_VIEW3D;
  if (view3d !== undefined) {
    const resolved = validateView3d(view3d);
    if (!resolved) return null;
    cleanView3d = resolved;
  }
  let cleanCamera3d: GlyphDiagramsWorkbenchCamera3d | undefined;
  if (camera3d !== undefined) {
    const resolved = validateCamera3d(camera3d);
    if (!resolved) return null;
    cleanCamera3d = resolved;
  }
  let cleanEffect3d = GLYPH_DIAGRAMS_WORKBENCH_DEFAULT_EFFECT3D;
  if (effect3d !== undefined) {
    const resolved = validateEffect3d(effect3d);
    if (!resolved) return null;
    cleanEffect3d = resolved;
  }
  let cleanGraphSource: GlyphDiagramsGraphSource | undefined;
  if (graphSource !== undefined) {
    const resolved = validateGraphSource(graphSource);
    if (!resolved) return null;
    cleanGraphSource = resolved;
  }

  return {
    editor, sourceKind, mermaid, json, nodes: cleanNodes, edges: cleanEdges,
    tableGraph: cleanTableGraph,
    controls: cleanControls,
    layout: { engine: "dagre", nodesep, ranksep, ...(direction !== undefined ? { direction } : {}) },
    diagram: { title: diagram.title, detail: diagram.detail },
    terminal: { NO_COLOR: terminal.NO_COLOR, FORCE_COLOR: terminal.FORCE_COLOR },
    view: view ?? "2d", view3d: cleanView3d, ...(cleanCamera3d ? { camera3d: cleanCamera3d } : {}), effect3d: cleanEffect3d,
    ...(cleanGraphSource ? { graphSource: cleanGraphSource } : {}),
    ...(typeof graphEdited === "boolean" ? { graphEdited } : {}),
  };
}

/**
 * Exported for its own direct test — mirrors `chartsUrlState.ts`'s own
 * `chartsUrlStateForEncode`: the state actually handed to the JSON
 * envelope. A remote graph the reader has NOT edited since loading
 * (`!state.graphEdited`) has its `nodes`/`edges`/`mermaid`/`json` blanked
 * and its `graphSource` stamped `omitted: true` — the graph itself is
 * never stored for a remote pick, `DiagramsWorkbench.tsx`'s mount effect
 * re-fetches `ref`/`rowIdx` fresh instead (this file's own "URL state"
 * doc). A remote graph the reader HAS edited rides in the link in full —
 * there is no local copy to re-derive an edit from, so omitting it would
 * silently discard real work. Every other source (`"builtin"`, absent) is
 * untouched — a tray preset already round-trips through its own fixture
 * text with no network dependency.
 */
export function diagramsUrlStateForEncode(state: GlyphDiagramsWorkbenchState): GlyphDiagramsWorkbenchState {
  if (state.graphSource?.kind !== "remote" || state.graphEdited) return state;
  return {
    ...state,
    nodes: [], edges: [], mermaid: "", json: "[]",
    tableGraph: { direction: state.tableGraph.direction },
    graphSource: { ...state.graphSource, omitted: true },
  };
}

const diagramsUrlEnvelope = createJsonUrlEnvelope<GlyphDiagramsWorkbenchState>(VERSION, validateDiagramsWorkbenchState);

export function encodeDiagramsUrlState(state: GlyphDiagramsWorkbenchState): Promise<string> {
  return diagramsUrlEnvelope.encode(diagramsUrlStateForEncode(state));
}
export function decodeDiagramsUrlState(raw: string | null | undefined): Promise<GlyphDiagramsWorkbenchState | null> {
  return diagramsUrlEnvelope.decode(raw);
}

/** One writer per mounted page (see DiagramsWorkbench.tsx) — same
 *  150ms-debounced, replaceState-only, skip-when-unchanged writer as
 *  chartsUrlState.ts's. */
export function createDiagramsUrlWriter(onEncoded?: (info: { raw: string; sizeBytes: number }) => void): (state: GlyphDiagramsWorkbenchState) => void {
  const write = createDebouncedJsonUrlWriter(diagramsUrlEnvelope, DIAGRAMS_URL_PARAM, 150, onEncoded);
  // `diagramsUrlStateForEncode` runs here too (not just in `encodeDiagramsUrlState`,
  // Copy Link's own path) — every write to the live `?d=` param must omit
  // an un-edited remote graph's own data, same as a copied link would.
  return (state) => write(diagramsUrlStateForEncode(state));
}
