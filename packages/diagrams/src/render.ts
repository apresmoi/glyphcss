import { glyphGraphFromMermaid } from "./mermaid";
import { glyphGraphFromJson } from "./adapters";
import { glyphDiagramError, glyphDiagramRepairHint, parseGlyphDiagramJson } from "./validate";
import { canonicalizeGlyphGraph, layoutGlyphGraph, type GlyphDiagramLayout, type GlyphDiagramLayoutOptions } from "./pipeline";
import { routeGlyphGraphEdges, type GlyphDiagramRoutingResult } from "./route";
import { paintGlyphDiagram } from "./paint";
import { glyphDiagramWithinBudget, glyphDiagramDropDecoration, glyphDiagramMergeDuplicates, glyphDiagramCollapseLeaves, splitGlyphGraph, glyphDiagramCompactionFloor } from "./degrade";
import { dedupeGlyphDiagramLedger, ledgerBudgetStage, ledgerDetailFaithful, ledgerLayoutOverflow, ledgerRoutingAttempt, ledgerSplitPanelDropped, ledgerUnroutable, type GlyphDiagramLedgerEntry } from "./ledger";
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
    || (options.title !== undefined && typeof options.title !== "string")) glyphDiagramError("bad-options", "Use supported output, detail, direction and title options.");
  return result;
}
function centered(layout: GlyphDiagramLayout, width: number, height: number): GlyphDiagramLayout {
  const dx = Math.max(0, Math.floor((width - layout.width) / 2));
  const dy = Math.max(0, Math.floor((height - layout.height) / 2));
  return { ...layout, nodes: layout.nodes.map((n) => ({ ...n, x0: n.x0 + dx, x1: n.x1 + dx, y0: n.y0 + dy, y1: n.y1 + dy })),
    ports: layout.ports.map((p) => ({ ...p, anchor: { x: p.anchor.x + dx, y: p.anchor.y + dy }, escape: { x: p.escape.x + dx, y: p.escape.y + dy } })) };
}
interface GlyphDiagramAttempt { readonly layout: GlyphDiagramLayout; readonly routing: GlyphDiagramRoutingResult; readonly fits: boolean; readonly okay: boolean }
export async function renderGlyphDiagram(input: GlyphGraph | string, options: GlyphDiagramRenderOptions = {}): Promise<GlyphDiagramResult> {
  const opts = resolvedOptions(options);
  const original = canonicalizeGlyphGraph(typeof input === "string" ? glyphGraphFromMermaid(input) : glyphGraphFromJson(input));
  let graph: GlyphGraph = options.direction ? { ...original, direction: options.direction } : original;
  const ledger: GlyphDiagramLedgerEntry[] = [], unroutable = new Set<string>();
  // Once the compaction rung (below) finds a tighter margin/spacing that fits,
  // it stays in effect for every later attempt in this render — there is no
  // reason to revert it before decoration/duplicates/leaf-clusters/split,
  // which can only benefit from the same tightening.
  let spacing: Partial<Pick<GlyphDiagramLayoutOptions, "nodesep" | "ranksep" | "margin">> = {};
  const attempt = async (candidate: GlyphGraph): Promise<GlyphDiagramAttempt> => {
    const rawLayout = await layoutGlyphGraph(candidate, { ...opts, ...spacing, labelWidth: opts.labelWidth ?? Math.max(1, Math.min(18, opts.width - 8)) });
    const layout = centered(rawLayout, opts.width, opts.height);
    const fits = rawLayout.width <= opts.width && rawLayout.height <= opts.height;
    const routing = routeGlyphGraphEdges(layout, { width: opts.width, height: opts.height });
    return { layout, routing, fits, okay: fits && glyphDiagramWithinBudget(candidate) && routing.unroutable.length === 0 };
  };
  // RC4 (DIAGNOSIS-diagrams-fanout.md): a layout that doesn't fit is a SIZE
  // overflow, never a routing failure — `attempt()` still routes against the
  // requested viewport for diagnostics, but a port landing outside it is a
  // consequence of the overflow, not something A* could have avoided.
  const overflowOrRoutingAttempt = (current: GlyphDiagramAttempt, stage: "degrade" | "split"): GlyphDiagramLedgerEntry[] =>
    current.fits
      ? current.routing.unroutable.map((id) => ledgerRoutingAttempt({ edgeId: id, stage }))
      : [ledgerLayoutOverflow({ stage, layoutWidth: current.layout.width, layoutHeight: current.layout.height, requestedWidth: opts.width, requestedHeight: opts.height })];
  let current = await attempt(graph);
  if (opts.detail === "simplified" || !current.okay) {
    // REVIEW-diagrams-fanout-opus.md P2-1/P2-2: a compaction rung before any
    // semantic degradation. Neither candidate touches the graph's content,
    // so it applies in every detail mode including "faithful".
    // `glyphDiagramCompactionFloor` derives, per graph, the smallest
    // nodesep/ranksep its own widest fan-in/out still needs (N+1 — see
    // degrade.ts's doc comment); every integer spacing from the caller's
    // own value down to that floor is tried in order (never skipped
    // straight to the floor, and no longer gated on the caller's spacing
    // exceeding a flat constant — a floor at or below the library default
    // must still be reachable). The first candidate that both fits AND
    // routes every edge wins outright; a candidate that merely fits is kept
    // only as a fallback in case none is fully routable, so a narrower
    // candidate further down the list is never skipped for a wider one that
    // fits but leaves edges stranded.
    if (!current.fits) {
      const preferredNodesep = opts.nodesep ?? 4, preferredRanksep = opts.ranksep ?? 4;
      const floor = glyphDiagramCompactionFloor(graph);
      const candidates: Array<typeof spacing> = [{ margin: 0 }];
      for (let sep = Math.min(preferredNodesep, preferredRanksep) - 1; sep >= floor; sep--) {
        candidates.push({ margin: 0, nodesep: Math.min(preferredNodesep, sep), ranksep: Math.min(preferredRanksep, sep) });
      }
      let fallback: { readonly spacing: typeof spacing; readonly attempt: GlyphDiagramAttempt } | undefined;
      let engaged = false;
      for (const candidate of candidates) {
        spacing = candidate;
        const compacted = await attempt(graph);
        if (compacted.fits && compacted.routing.unroutable.length === 0) { current = compacted; engaged = true; fallback = undefined; break; }
        if (compacted.fits && !fallback) fallback = { spacing: candidate, attempt: compacted };
        spacing = {};
      }
      if (!engaged && fallback) { current = fallback.attempt; spacing = fallback.spacing; engaged = true; }
      if (engaged) ledger.push(ledgerBudgetStage("compaction"));
    }
    // P2-3: pushed AFTER compaction (never before) and only when the
    // diagram still doesn't fit, or genuinely can't route once it does —
    // compaction can turn either into a non-issue, and a stale
    // `layout-overflow` next to a `budget-compaction` entry that rescued
    // the exact same render told the CLI's reader "needs simplifying"
    // about a diagram it had just finished rendering whole.
    ledger.push(...overflowOrRoutingAttempt(current, "degrade"));
    if (opts.detail !== "faithful") {
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
  const pages = attempts.map(({ layout, routing, fits }, index) => {
    if (!fits) {
      // A too-small viewport cannot legally show a partial box or a dangling clipped transit.
      ledger.push(ledgerSplitPanelDropped({ panel: index + 1, requestedWidth: opts.width, requestedHeight: opts.height, nodes: layout.nodes.map((n) => n.id) }));
      layout.edges.forEach((e) => { unroutable.add(e.id); ledger.push(ledgerUnroutable({ edgeId: e.id, reason: "it's too large for the viewport" })); });
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
