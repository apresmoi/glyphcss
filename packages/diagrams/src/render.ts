import { glyphGraphFromMermaid } from "./mermaid";
import { glyphGraphFromJson } from "./adapters";
import { glyphDiagramError, glyphDiagramRepairHint, parseGlyphDiagramJson } from "./validate";
import { canonicalizeGlyphGraph } from "./pipeline";
import { paintGlyphDiagram } from "./paint";
import { glyphDiagramDropDecoration, glyphDiagramMergeDuplicates, glyphDiagramCollapseLeaves, splitGlyphGraph } from "./degrade";
import { fitGlyphGraph, type GlyphDiagramAttempt } from "./fit";
import { dedupeGlyphDiagramLedger, ledgerBudgetStage, ledgerDetailFaithful, ledgerLayoutExpanded, ledgerLayoutOverflow, ledgerRoutingAttempt, ledgerSplitPanelDropped, ledgerUnroutable, type GlyphDiagramLedgerEntry } from "./ledger";
import type { GlyphGraph } from "./types";
import type { GlyphDiagramRenderOptions, GlyphDiagramResult, GlyphDiagramTarget, GlyphDiagramCharset, GlyphDiagramColorMode } from "./renderTypes";

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
  const opts = resolvedOptions(options);
  const original = canonicalizeGlyphGraph(typeof input === "string" ? glyphGraphFromMermaid(input) : glyphGraphFromJson(input));
  let graph: GlyphGraph = options.direction ? { ...original, direction: options.direction } : original;
  const ledger: GlyphDiagramLedgerEntry[] = [], unroutable = new Set<string>();
  const attempt = (candidate: GlyphGraph): Promise<GlyphDiagramAttempt> => fitGlyphGraph(candidate, opts);
  // Ports outside the viewport indicate size overflow, not failed routing.
  const overflowOrRoutingAttempt = (current: GlyphDiagramAttempt, stage: "degrade" | "split"): GlyphDiagramLedgerEntry[] =>
    current.fits
      ? current.routing.unroutable.map((id) => ledgerRoutingAttempt({ edgeId: id, stage }))
      : [ledgerLayoutOverflow({ stage, layoutWidth: current.layout.width, layoutHeight: current.layout.height, requestedWidth: opts.width, requestedHeight: opts.height })];
  let current = await attempt(graph);
  if (current.adjusted) ledger.push(ledgerBudgetStage("compaction"));
  if (opts.detail === "simplified" || !current.okay) {
    ledger.push(...overflowOrRoutingAttempt(current, "degrade"));
    if (opts.detail !== "faithful") {
      // Gated on `!current.okay`: running decoration unconditionally threw
      // away labels and shapes on diagrams compaction had already rescued.
      if (opts.detail === "simplified" || !current.okay) {
        ledger.push(ledgerBudgetStage("decoration"));
        graph = glyphDiagramDropDecoration(graph); current = await attempt(graph);
        if (!current.okay) {
          const merged = glyphDiagramMergeDuplicates(graph); graph = merged.graph;
          ledger.push(ledgerBudgetStage("duplicates"), ...merged.ledger); current = await attempt(graph);
        }
        if (!current.okay) {
          const collapsed = glyphDiagramCollapseLeaves(graph); graph = collapsed.graph;
          ledger.push(ledgerBudgetStage("leaf-clusters"), ...collapsed.ledger); current = await attempt(graph);
        }
      }
    } else ledger.push(ledgerDetailFaithful());
  }
  const attempts = [current];
  if (!current.okay) {
    ledger.push(...overflowOrRoutingAttempt(current, "split"), ledgerBudgetStage("split"));
    attempts.length = 0;
    for (const panel of splitGlyphGraph(graph)) attempts.push(await attempt(panel));
  }
  const pages = attempts.map(({ layout, routing, fits, width, height }, index) => {
    if (width > opts.width || height > opts.height) ledger.push(ledgerLayoutExpanded({ requestedWidth: opts.width, requestedHeight: opts.height, canvasWidth: width, canvasHeight: height }));
    if (!fits) {
      // A too-small viewport cannot legally show a partial box or a dangling clipped transit.
      ledger.push(ledgerSplitPanelDropped({ panel: index + 1, requestedWidth: opts.width, requestedHeight: opts.height, nodes: layout.nodes.map((n) => n.id) }));
      layout.edges.forEach((e) => { unroutable.add(e.id); ledger.push(ledgerUnroutable({ edgeId: e.id, reason: "it's too large for the viewport" })); });
      layout = { ...layout, nodes: [], edges: [], groups: [], ports: [] }; routing = { routes: [], unroutable: [], ledger: [] };
    }
    routing.unroutable.forEach((id) => unroutable.add(id));
    ledger.push(...layout.ledger, ...routing.ledger);
    const painted = paintGlyphDiagram(layout, routing, { ...opts, width, height });
    ledger.push(...painted.ledger);
    return painted;
  });
  const first = pages[0]!;
  return { ...first, text: pages.map((p) => p.text).join("\n\n"), ...(first.html === undefined ? {} : { html: pages.map((p) => p.html).join("\n\n") }),
    pages: pages.map(({ ledger: _ledger, unsupportedGlyphs: _glyphs, ...page }) => page),
    meta: { nodes: original.nodes, edges: original.edges, groups: original.groups ?? [], description: `${options.title ? `${options.title}. ` : ""}${original.nodes.length} nodes, ${original.edges.length} edges, ${(original.groups ?? []).length} groups; ${current.layout.direction}; ${pages.length} panel${pages.length === 1 ? "" : "s"}.` },
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
