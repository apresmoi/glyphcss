import { GLYPH_DIAGRAM_EDGE_WAYPOINTS, GLYPH_MERMAID_STATE_REGION, type GlyphMermaidStateRegion } from "./layoutHints";
import { GLYPH_DIAGRAM_DIAMOND_MARKER, glyphDiagramHasDiamondMarker } from "./presentation";
import { renderGlyphMermaidGit } from "./mermaidGitRender";
import { glyphParseMermaid } from "./mermaid";
import { glyphTryRenderMermaidBlock } from "./mermaidBlockRender";
import { GLYPH_MERMAID_ADAPTIVE, type GlyphMermaidBlockGraph } from "./mermaidStructured";
import { glyphGraphFromJson } from "./adapters";
import { glyphDiagramError, glyphDiagramRepairHint, parseGlyphDiagramJson } from "./validate";
import { canonicalizeGlyphGraph, glyphDiagramFoldLabel, glyphDiagramWords } from "./pipeline";
import { paintGlyphDiagram } from "./paint";
import { glyphDiagramDropDecoration, glyphDiagramMergeDuplicates, glyphDiagramCollapseLeaves, splitGlyphGraph } from "./degrade";
import { fitGlyphGraph, glyphDiagramDecorationScore, type GlyphDiagramAttempt } from "./fit";
import { dedupeGlyphDiagramLedger, ledgerBudgetStage, ledgerDiamondMarkersDropped, ledgerLabelFolded, ledgerDetailFaithful, ledgerLayoutExpanded, ledgerLayoutOverflow, ledgerRoutingAttempt, ledgerSplitPanelDropped, ledgerUnroutable, ledgerWordsCut, type GlyphDiagramLedgerEntry } from "./ledger";
import type { GlyphGraph } from "./types";
import type { GlyphDiagramRenderOptions, GlyphDiagramResult, GlyphDiagramTarget, GlyphDiagramCharset, GlyphDiagramColorMode } from "./renderTypes";
import { glyphDiagramGraphLabels } from "./graphLabels";
import { glyphDiagramCompactGeometry } from "./compact";
import { GLYPH_DIAGRAM_WORK, GlyphDiagramWork } from "./work";

// Mirrors `@glyphcss/charts`' `GLYPH_CHART_TARGET_DEFAULTS` for contract
// consistency across the two packages — braille is the default wherever a
// sub-cell tier is safe, `chat` stays `box` (Slack/Discord fonts break
// braille and junctions sometimes). A diagram paints whole-cell borders
// regardless of charset, so this is a naming/contract match only, not a
// rendering change.
export const GLYPH_DIAGRAM_TARGET_DEFAULTS: Readonly<Record<GlyphDiagramTarget, { width: number; height: number; charset: GlyphDiagramCharset; color: GlyphDiagramColorMode }>> = Object.freeze({
  chat: { width: 72, height: 24, charset: "box", color: "none" },
  terminal: { width: 80, height: 24, charset: "braille", color: "truecolor" },
  web: { width: 96, height: 32, charset: "braille", color: "css" },
});
function resolvedOptions(options: GlyphDiagramRenderOptions) {
  // Default "web" (final-gate-2 review, codex #8 / Opus P3): mirrors
  // `@glyphcss/charts`' bare `renderGlyphChart(x)` default exactly — "targets
  // mirror charts" was documentation until this matched it in code too.
  const target = options.target ?? "web";
  if (!["chat", "terminal", "web"].includes(target)) glyphDiagramError("bad-options", "target must be chat, terminal, or web.");
  const defaults = GLYPH_DIAGRAM_TARGET_DEFAULTS[target];
  const result = { ...options, target, width: options.width ?? defaults.width, height: options.height ?? defaults.height,
    charset: options.charset ?? defaults.charset, color: options.color ?? defaults.color };
  if (![result.width, result.height].every((v) => Number.isInteger(v) && v > 0)) glyphDiagramError("bad-size", "width and height must be positive integers.");
  if (!["ascii", "box", "blocks", "braille"].includes(result.charset) || !["none", "ansi16", "ansi256", "truecolor", "css"].includes(result.color)
    || (options.detail !== undefined && !["auto", "faithful", "balanced", "simplified"].includes(options.detail))
    || (options.direction !== undefined && !["TB", "LR", "BT", "RL"].includes(options.direction))
    || (options.autoDirection !== undefined && typeof options.autoDirection !== "boolean")
    || (options.overflow !== undefined && !["paginate", "expand"].includes(options.overflow))
    || (options.title !== undefined && typeof options.title !== "string")) glyphDiagramError("bad-options", "Use supported output, detail, direction and title options.");
  return result;
}
export async function renderGlyphDiagram(input: GlyphGraph | string, options: GlyphDiagramRenderOptions = {}): Promise<GlyphDiagramResult> {
  let opts = resolvedOptions(options);
  const parsed = typeof input === "string" ? glyphParseMermaid(input) : { graph: glyphGraphFromJson(input), notes: [] };
  if ("lanes" in parsed && parsed.lanes) return renderGlyphMermaidGit(parsed.graph, parsed.lanes, parsed.notes, opts);
  if (((parsed.graph as GlyphMermaidBlockGraph)[GLYPH_MERMAID_ADAPTIVE]
    || parsed.graph.edges.some(edge => edge.label) && parsed.graph.groups?.some(group => (group as GlyphMermaidStateRegion)[GLYPH_MERMAID_STATE_REGION])) && options.autoDirection === undefined && options.direction === undefined) opts = { ...opts, autoDirection: true };
  const block = glyphTryRenderMermaidBlock(parsed.graph, parsed.notes, opts);
  if (block) return block;
  const original = canonicalizeGlyphGraph(parsed.graph);
  let graph: GlyphGraph = options.direction ? { ...original, direction: options.direction } : original;
  let diamondMarkers = graph.nodes.filter(node => glyphDiagramHasDiamondMarker(node)).map(node => node.id);
  let drawDiamondMarkers = true;
  const ledger: GlyphDiagramLedgerEntry[] = parsed.notes, unroutable = new Set<string>();
  const work = new GlyphDiagramWork(original, opts.width, opts.height);
  const attempt = async (candidate: GlyphGraph, markers = drawDiamondMarkers): Promise<GlyphDiagramAttempt> => {
    const presentation = { ...opts, [GLYPH_DIAGRAM_DIAMOND_MARKER]: markers, [GLYPH_DIAGRAM_WORK]: work };
    if (!work.terminal && !work.canLayout(candidate)) {
      work.limited = true; work.terminal = true;
      // An unfunded first layout has no geometry to retain. A boundary panel
      // supplies the normal attempt shape; only the complete split is painted.
      return { ...await fitGlyphGraph(splitGlyphGraph(candidate)[0]!, presentation), okay: false };
    }
    const result = await fitGlyphGraph(candidate, presentation);
    // A budget exhausted before splitting is still part of the render's work.
    ledger.push(...result.layout.ledger.filter(entry => entry.code === "fit-search-limited"));
    return result;
  };
  // Ports outside the viewport indicate size overflow, not failed routing.
  const overflowOrRoutingAttempt = (current: GlyphDiagramAttempt, stage: "degrade" | "split"): GlyphDiagramLedgerEntry[] =>
    current.fits
      ? current.routing.unroutable.map((id) => ledgerRoutingAttempt({ edgeId: id, stage }))
      : [ledgerLayoutOverflow({ stage, layoutWidth: current.layout.width, layoutHeight: current.layout.height, requestedWidth: opts.width, requestedHeight: opts.height })];
  // The title is folded where it is painted; the fold is reported here, with every other label's.
  if (options.title && glyphDiagramFoldLabel(options.title, opts.charset) !== options.title.split(/\r?\n/).map((line) => line.trimEnd()).join("\n")) ledger.push(ledgerLabelFolded({ role: "title", owner: "diagram", before: options.title, after: glyphDiagramFoldLabel(options.title, opts.charset) }));
  let current = await attempt(graph);
  if (diamondMarkers.length && !work.limited) {
    const score = glyphDiagramDecorationScore(current, opts);
    // Clean fits retain their approved look. A troubled fit tries the smallest
    // decoration loss before removing shapes or semantic captions, even in faithful mode.
    if (score.slice(0, 5).some(value => value > 0)) {
      const candidate = await attempt(graph, false);
      const plainScore = glyphDiagramDecorationScore(candidate, opts);
      const difference = plainScore.findIndex((value, i) => value !== score[i]);
      if (difference >= 0 && plainScore[difference]! < score[difference]!) {
        drawDiamondMarkers = false; current = candidate;
        ledger.push(ledgerDiamondMarkersDropped(diamondMarkers));
        diamondMarkers = [];
      }
    }
  }
  if (current.adjusted) ledger.push(ledgerBudgetStage("compaction"));
  if (opts.detail === "simplified" || !current.okay) {
    ledger.push(...overflowOrRoutingAttempt(current, "degrade"));
    if (opts.detail !== "faithful" && !work.limited) {
      // Gated on `!current.okay`: running decoration unconditionally threw
      // away labels and shapes on diagrams compaction had already rescued.
      if (opts.detail === "simplified" || !current.okay) {
        ledger.push(ledgerBudgetStage("decoration"));
        if (diamondMarkers.length) {
          drawDiamondMarkers = false;
          ledger.push(ledgerDiamondMarkersDropped(diamondMarkers));
          diamondMarkers = [];
        }
        graph = glyphDiagramDropDecoration(graph); current = await attempt(graph);
        if (!current.okay && !work.limited) {
          const merged = glyphDiagramMergeDuplicates(graph); graph = merged.graph;
          ledger.push(ledgerBudgetStage("duplicates"), ...merged.ledger); current = await attempt(graph);
        }
        if (!current.okay && !work.limited) {
          const collapsed = glyphDiagramCollapseLeaves(graph); graph = collapsed.graph;
          ledger.push(ledgerBudgetStage("leaf-clusters"), ...collapsed.ledger); current = await attempt(graph);
        }
      }
    } else if (opts.detail === "faithful") ledger.push(ledgerDetailFaithful());
  }
  const attempts = [current];
  if (!current.okay) {
    ledger.push(...overflowOrRoutingAttempt(current, "split"), ledgerBudgetStage("split"));
    attempts.length = 0;
    work.terminal = work.limited;
    for (const panel of splitGlyphGraph(graph)) attempts.push(await attempt(panel));
  }
  ledger.push(...work.ledger());
  const pages = attempts.map(({ layout, routing, fits, width, height }, index) => {
    if (!fits) {
      // A too-small viewport cannot legally show a partial box or a dangling clipped transit.
      ledger.push(ledgerSplitPanelDropped({ panel: index + 1, requestedWidth: opts.width, requestedHeight: opts.height, nodes: layout.nodes.map((n) => n.id) }));
      layout.edges.forEach((e) => { unroutable.add(e.id); ledger.push(ledgerUnroutable({ edgeId: e.id, reason: "it's too large for the viewport" })); });
      layout = { ...layout, nodes: [], edges: [], groups: [], ports: [], loops: [] }; routing = { routes: [], unroutable: [], ledger: [] };
    }
    routing.unroutable.forEach((id) => unroutable.add(id));
    ledger.push(...layout.ledger, ...routing.ledger);
    // A word the layout had to break across lines is a fidelity loss the reader cannot otherwise see: every node's drawn rows
    // and every loop label's rows are compared with the words that were written.
    const broken = (label: string, lines: readonly string[]) => {
      const shown = new Set(lines.flatMap(line => glyphDiagramWords(line)));
      // The whole label is folded once, as it was when measured, then its words are compared.
      return glyphDiagramFoldLabel(label, opts.charset).split(/\s+/).filter(Boolean)
        .filter(word => glyphDiagramWords(word).some(piece => !shown.has(piece)));
    };
    const cut = [
      ...layout.nodes.filter((node) => node.shape !== "point").map((node) => ({ id: node.id, words: broken([node.label, ...(node.compartments ?? []).flat()].join("\n"), node.lines) })),
      ...layout.loops.map((loop) => ({ id: `${loop.nodeId} loop`, words: broken(layout.edges.find((e) => e.id === loop.edgeId)?.label ?? "", loop.lines) })),
    ].filter((entry) => entry.words.length > 0);
    if (cut.length) ledger.push(ledgerWordsCut({ nodes: cut }));
    let labels = glyphDiagramGraphLabels(layout, routing, { ...opts, width, height });
    if (fits && routing.unroutable.length === 0) {
      const compact = glyphDiagramCompactGeometry(layout, routing, labels.placed, { width, height });
      // Keep the caller's canvas size; only expanded canvases shrink back toward the requested budget.
      width = Math.max(opts.width, compact.width); height = Math.max(opts.height, compact.height);
      const dx = Math.floor((width - compact.width) / 2), dy = Math.floor((height - compact.height) / 2);
      const point = (p: { x: number; y: number }) => ({ x: p.x + dx, y: p.y + dy });
      const rect = (r: { x0: number; x1: number; y0: number; y1: number }) => ({ x0: r.x0 + dx, x1: r.x1 + dx, y0: r.y0 + dy, y1: r.y1 + dy });
      layout = { ...compact.layout,
        ...(compact.layout[GLYPH_DIAGRAM_EDGE_WAYPOINTS] ? { [GLYPH_DIAGRAM_EDGE_WAYPOINTS]: Object.fromEntries(Object.entries(compact.layout[GLYPH_DIAGRAM_EDGE_WAYPOINTS]!).map(([id, points]) => [id, points.map(point)])) } : {}),
        nodes: compact.layout.nodes.map(n => ({ ...n, ...rect(n) })),
        ports: compact.layout.ports.map(p => ({ ...p, anchor: point(p.anchor), escape: point(p.escape) })) };
      routing = { ...compact.routing, routes: compact.routing.routes.map(r => ({ ...r, cells: r.cells.map(point) })) };
      labels = { ...labels, placed: compact.labels.map(l => ({ ...l, ...point(l), ...rect(l) })) };
    }
    const painted = paintGlyphDiagram(layout, routing, { ...opts, width, height, labelLayout: labels });
    if (width > opts.width || height > opts.height) ledger.push(ledgerLayoutExpanded({ requestedWidth: opts.width, requestedHeight: opts.height, canvasWidth: width, canvasHeight: height }));
    ledger.push(...painted.ledger);
    return painted;
  });
  const first = pages[0]!;
  return { ...first, text: pages.map((p) => p.text).join("\n\n"), ...(first.html === undefined ? {} : { html: pages.map((p) => p.html).join("\n\n") }),
    pages: pages.map(({ ledger: _ledger, unsupportedGlyphs: _glyphs, ...page }) => page),
    meta: { nodes: [...original.nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), edges: original.edges, groups: original.groups ?? [], description: `${options.title ? `${options.title}. ` : ""}${original.nodes.length} nodes, ${original.edges.length} edges, ${(original.groups ?? []).length} groups; ${current.layout.direction}; ${pages.length} panel${pages.length === 1 ? "" : "s"}.` },
    report: { ledger: dedupeGlyphDiagramLedger(ledger), unsupportedGlyphs: pages.flatMap((p) => p.unsupportedGlyphs), unroutable: [...unroutable].sort() } };
}
export async function renderGlyphDiagramJson(json: string, options: GlyphDiagramRenderOptions = {}): Promise<string> {
  try {
    const result = await renderGlyphDiagram(glyphGraphFromJson(parseGlyphDiagramJson(json)), options);
    return JSON.stringify({ text: result.text, ...(result.html === undefined ? {} : { html: result.html }), meta: result.meta, report: result.report });
  } catch (e) {
    const error = e as Error & { code?: string };
    return JSON.stringify({ error: error.message, code: error.code ?? null, hint: error.code ? glyphDiagramRepairHint(error.code) : "Pass a JSON object with nodes and edges arrays." });
  }
}
