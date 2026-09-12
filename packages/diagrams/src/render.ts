import { glyphGraphFromMermaid } from "./mermaid";
import { glyphGraphFromJson } from "./adapters";
import { glyphDiagramError, glyphDiagramRepairHint, parseGlyphDiagramJson } from "./validate";
import { canonicalizeGlyphGraph, layoutGlyphGraph, type GlyphDiagramLayout } from "./pipeline";
import { routeGlyphGraphEdges } from "./route";
import { paintGlyphDiagram } from "./paint";
import { glyphDiagramWithinBudget, glyphDiagramDropDecoration, glyphDiagramMergeDuplicates, glyphDiagramCollapseLeaves, splitGlyphGraph } from "./degrade";
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
  const target = options.target ?? "chat";
  if (!["chat", "terminal", "web"].includes(target)) glyphDiagramError("bad-options", "target must be chat, terminal, or web.");
  const defaults = GLYPH_DIAGRAM_TARGET_DEFAULTS[target];
  const result = { ...options, target, width: options.width ?? defaults.width, height: options.height ?? defaults.height,
    charset: options.charset ?? defaults.charset, color: options.color ?? defaults.color };
  if (![result.width, result.height].every((v) => Number.isInteger(v) && v > 0)) glyphDiagramError("bad-size", "width and height must be positive integers.");
  if (!["ascii", "box", "blocks", "braille"].includes(result.charset) || !["none", "ansi16", "ansi256", "truecolor", "css"].includes(result.color)
    || (options.detail !== undefined && !["auto", "faithful", "balanced", "simplified"].includes(options.detail))
    || (options.direction !== undefined && !["TB", "LR", "BT", "RL"].includes(options.direction))
    || (options.title !== undefined && typeof options.title !== "string")) glyphDiagramError("bad-options", "Use supported output, detail, direction and title options.");
  return result;
}
function centered(layout: GlyphDiagramLayout, width: number, height: number): GlyphDiagramLayout {
  const dx = Math.max(0, Math.floor((width - layout.width) / 2));
  const dy = Math.max(0, Math.floor((height - layout.height) / 2));
  return { ...layout, nodes: layout.nodes.map((n) => ({ ...n, x0: n.x0 + dx, x1: n.x1 + dx, y0: n.y0 + dy, y1: n.y1 + dy })),
    ports: layout.ports.map((p) => ({ ...p, anchor: { x: p.anchor.x + dx, y: p.anchor.y + dy }, escape: { x: p.escape.x + dx, y: p.escape.y + dy } })) };
}
export async function renderGlyphDiagram(input: GlyphGraph | string, options: GlyphDiagramRenderOptions = {}): Promise<GlyphDiagramResult> {
  const opts = resolvedOptions(options);
  const original = canonicalizeGlyphGraph(typeof input === "string" ? glyphGraphFromMermaid(input) : glyphGraphFromJson(input));
  let graph: GlyphGraph = options.direction ? { ...original, direction: options.direction } : original;
  const ledger: string[] = [], unroutable = new Set<string>();
  const attempt = async (candidate: GlyphGraph) => {
    const rawLayout = await layoutGlyphGraph(candidate, { ...opts, labelWidth: opts.labelWidth ?? Math.max(1, Math.min(18, opts.width - 8)) });
    const layout = centered(rawLayout, opts.width, opts.height);
    const fits = rawLayout.width <= opts.width && rawLayout.height <= opts.height;
    const routing = routeGlyphGraphEdges(layout, { width: opts.width, height: opts.height });
    return { layout, routing, fits, okay: fits && glyphDiagramWithinBudget(candidate) && routing.unroutable.length === 0 };
  };
  let current = await attempt(graph);
  if (opts.detail === "simplified" || !current.okay) {
    ledger.push(...current.routing.unroutable.map((id) => `routing-attempt: edge "${id}" requires degradation.`));
    if (opts.detail !== "faithful") {
      ledger.push("decoration: dropped optional shapes, group captions, edge labels and stroke decoration to meet the cell/node/edge budget; originals remain in meta.");
      graph = glyphDiagramDropDecoration(graph); current = await attempt(graph);
      if (!current.okay) {
        const merged = glyphDiagramMergeDuplicates(graph); graph = merged.graph;
        ledger.push("duplicates: tried merging parallel duplicate connections.", ...merged.ledger); current = await attempt(graph);
      }
      if (!current.okay) {
        const collapsed = glyphDiagramCollapseLeaves(graph); graph = collapsed.graph;
        ledger.push("leaf-clusters: tried collapsing sibling leaves.", ...collapsed.ledger); current = await attempt(graph);
      }
    } else ledger.push("faithful: retained decorations, duplicate edges and leaf identity; splitting is the only permitted degradation.");
  }
  const attempts = [current];
  if (!current.okay) {
    ledger.push(...current.routing.unroutable.map((id) => `routing-attempt: edge "${id}" requires a split panel.`), "split: edge-induced panels repeat boundary nodes and preserve every remaining connection; each panel keeps the requested viewport.");
    attempts.length = 0;
    for (const panel of splitGlyphGraph(graph)) attempts.push(await attempt(panel));
  }
  const pages = attempts.map(({ layout, routing, fits }, index) => {
    if (!fits) {
      // A too-small viewport cannot legally show a partial box or a dangling clipped transit.
      ledger.push(`split: panel ${index + 1} cannot fit ${opts.width}x${opts.height}; nodes [${layout.nodes.map((n) => n.id).join(", ")}] remain in meta; no partial nodes or transit drawn.`);
      layout.edges.forEach((e) => { unroutable.add(e.id); ledger.push(`GLYPH_DIAGRAM_UNROUTABLE: edge "${e.id}" exceeds the viewport; no transit drawn.`); });
      layout = { ...layout, nodes: [], edges: [], groups: [], ports: [] }; routing = { routes: [], unroutable: [], ledger: [] };
    }
    routing.unroutable.forEach((id) => unroutable.add(id));
    ledger.push(...layout.ledger, ...routing.ledger);
    const painted = paintGlyphDiagram(layout, routing, opts);
    ledger.push(...painted.ledger);
    return painted;
  });
  const first = pages[0]!;
  return { ...first, text: pages.map((p) => p.text).join("\n\n"), ...(first.html === undefined ? {} : { html: pages.map((p) => p.html).join("\n\n") }),
    pages: pages.map(({ ledger: _ledger, unsupportedGlyphs: _glyphs, ...page }) => page),
    meta: { nodes: original.nodes, edges: original.edges, groups: original.groups ?? [], description: `${options.title ? `${options.title}. ` : ""}${original.nodes.length} nodes, ${original.edges.length} edges, ${(original.groups ?? []).length} groups; ${graph.direction}; ${pages.length} panel${pages.length === 1 ? "" : "s"}.` },
    report: { ledger: [...new Set(ledger)], unsupportedGlyphs: pages.flatMap((p) => p.unsupportedGlyphs), unroutable: [...unroutable].sort() } };
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
