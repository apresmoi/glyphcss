import type { GlyphCanvas, GlyphCanvasTierName } from "glyphcss";
import { glyphLaneDagFromGitLog } from "./git";
import { glyphDiagramError } from "../validate";
import { parseGlyphLaneDagJson, glyphLaneDagRepairHint, validateGlyphLaneDag } from "./validate";
import { layoutGlyphLaneRows, applyGlyphLaneCap, type GlyphLaneRow } from "./layout";
import { paintGlyphLaneDag, GLYPH_LANE_COLUMN_WIDTH, GLYPH_LANE_MIN_CONTENT_WIDTH } from "./paint";
import { dedupeGlyphDiagramLedger, type GlyphDiagramLedgerEntry } from "../ledger";
import { ledgerLaneLayoutOverflow, ledgerLaneCapCollapsed, ledgerLanePaged } from "./ledger";
import type { GlyphLaneDag, GlyphLaneNode } from "./types";

export type GlyphLaneTarget = "chat" | "terminal" | "web";
export type GlyphLaneCharset = GlyphCanvasTierName;
export type GlyphLaneColorMode = "none" | "ansi16" | "ansi256" | "truecolor" | "css";

export interface GlyphLaneRenderOptions {
  readonly target?: GlyphLaneTarget;
  readonly charset?: GlyphLaneCharset;
  readonly color?: GlyphLaneColorMode;
  readonly width?: number;
  readonly height?: number;
  readonly title?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Per-lane override — same `string | ((node) => string)` shape as the
   * root graph form's `nodeColor`. Default: the shared `GLYPH_DIAGRAM_PALETTE`,
   * cycled by lane (column) index, so a branch keeps its colour down its
   * whole column and a merge back into a freed column reuses that column's
   * colour — the same convention `git log --graph`'s own colouring uses.
   * A function override is called with the node CURRENTLY occupying that
   * lane at the row being painted (the node that opened a freshly branched
   * lane, until that lane reaches its own next node row). Never the only
   * way to tell two lanes apart: lane position (x) and the node's own
   * id/marks/label text already carry that. Never affects `color: "none"`
   * output.
   */
  readonly laneColor?: string | ((node: GlyphLaneNode) => string);
}

export interface GlyphLaneReport { readonly ledger: readonly GlyphDiagramLedgerEntry[]; readonly unsupportedGlyphs: readonly string[] }
export interface GlyphLanePage { readonly text: string; readonly html?: string; readonly canvas: GlyphCanvas }
export interface GlyphLaneMeta { readonly nodes: GlyphLaneDag["nodes"]; readonly description: string }
export interface GlyphLaneResult extends GlyphLanePage {
  readonly meta: GlyphLaneMeta; readonly report: GlyphLaneReport;
  /** Every time-split panel, including the first — mirrors `GlyphSequenceResult.pages`' own convention. */
  readonly pages: readonly GlyphLanePage[];
}

// Mirrors `GLYPH_SEQUENCE_TARGET_DEFAULTS` exactly: braille wherever a sub-cell
// tier is safe, chat stays box. This painter never calls `line()` (every glyph
// is a whole-cell `canvas.text`, same discipline as the sequence painter), so
// this is a naming/contract match, not a rendering change across tiers.
export const GLYPH_LANE_TARGET_DEFAULTS: Readonly<Record<GlyphLaneTarget, { width: number; height: number; charset: GlyphLaneCharset; color: GlyphLaneColorMode }>> = Object.freeze({
  chat: { width: 72, height: 24, charset: "box", color: "none" },
  terminal: { width: 80, height: 24, charset: "braille", color: "truecolor" },
  web: { width: 96, height: 32, charset: "braille", color: "css" },
});

function resolvedOptions(options: GlyphLaneRenderOptions) {
  const target = options.target ?? "web";
  if (!["chat", "terminal", "web"].includes(target)) glyphDiagramError("bad-options", "target must be chat, terminal, or web.");
  const defaults = GLYPH_LANE_TARGET_DEFAULTS[target];
  const result = { ...options, target, width: options.width ?? defaults.width, height: options.height ?? defaults.height,
    charset: options.charset ?? defaults.charset, color: options.color ?? defaults.color };
  if (![result.width, result.height].every((v) => Number.isInteger(v) && v > 0)) glyphDiagramError("bad-size", "width and height must be positive integers.");
  if (!["ascii", "box", "blocks", "braille"].includes(result.charset) || !["none", "ansi16", "ansi256", "truecolor", "css"].includes(result.color)
    || (options.title !== undefined && typeof options.title !== "string")) glyphDiagramError("bad-options", "Use supported target, charset, color, and title options.");
  return result;
}

/** A node row plus its immediately following connector row (if any) is one atomic unit — a page break never lands between the two. */
function buildUnits(rows: readonly GlyphLaneRow[]): GlyphLaneRow[][] {
  const units: GlyphLaneRow[][] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i]!;
    if (row.type === "node" && rows[i + 1]?.type === "connector") { units.push([row, rows[i + 1]!]); i += 2; }
    else { units.push([row]); i += 1; }
  }
  return units;
}

/** Greedy pack: never splits a unit across panels, and a single unit taller than the budget still gets its own panel rather than being dropped. */
function packPanels(rows: readonly GlyphLaneRow[], budget: number): GlyphLaneRow[][] {
  const units = buildUnits(rows);
  if (!units.length) return [[]];
  const panels: GlyphLaneRow[][] = [];
  let current: GlyphLaneRow[] = [];
  for (const unit of units) {
    if (current.length && current.length + unit.length > budget) { panels.push(current); current = []; }
    current.push(...unit);
  }
  if (current.length) panels.push(current);
  return panels;
}

/** Renumbers `top` to `0..panel.length-1` — every row occupies exactly one line, so index IS the row's panel-local top. */
function renumberRows(rows: readonly GlyphLaneRow[]): GlyphLaneRow[] {
  return rows.map((row, top) => ({ ...row, top }));
}

export async function renderGlyphLaneDag(input: GlyphLaneDag | string, options: GlyphLaneRenderOptions = {}): Promise<GlyphLaneResult> {
  const opts = resolvedOptions(options);
  const dag = validateGlyphLaneDag(typeof input === "string" ? glyphLaneDagFromGitLog(input) : input);
  const ledger: GlyphDiagramLedgerEntry[] = [];

  const natural = layoutGlyphLaneRows(dag);
  const naturalColumns = natural.maxLane + 1;
  // Shrink the lane cap only until the lane area leaves at least this much
  // room for content — never purely until the lane area alone fits, which
  // would keep "collapsing" one lane at a time well past the point where it
  // stops buying back any usable content width (see `applyGlyphLaneCap`'s
  // own doc: collapsing a single lane into its own overflow column saves
  // nothing — only two-or-more collapsing together frees a column).
  let cap = naturalColumns;
  while (cap > 1 && cap * GLYPH_LANE_COLUMN_WIDTH + GLYPH_LANE_MIN_CONTENT_WIDTH > opts.width) cap--;
  const capped = applyGlyphLaneCap(natural, cap);
  if (capped.collapsedLaneIndices.length) {
    ledger.push(ledgerLaneCapCollapsed({ collapsedLanes: capped.collapsedLaneIndices.length, nodeIds: capped.collapsedNodeIds }));
  }

  const bodyHeight = capped.rows.length;
  if (capped.columns * GLYPH_LANE_COLUMN_WIDTH >= opts.width) {
    ledger.push(ledgerLaneLayoutOverflow({ naturalWidth: capped.columns * GLYPH_LANE_COLUMN_WIDTH + 1, naturalHeight: bodyHeight, requestedWidth: opts.width, requestedHeight: opts.height }));
  }

  const panels = bodyHeight <= opts.height ? [capped.rows] : packPanels(capped.rows, Math.max(1, opts.height));
  if (panels.length > 1) ledger.push(ledgerLanePaged({ panels: panels.length }));

  const paintedPages = panels.map((panel) => paintGlyphLaneDag(renumberRows(panel), capped.columns, panel.length, opts.width, opts));
  for (const page of paintedPages) ledger.push(...page.ledger);

  const first = paintedPages[0]!;
  return {
    text: paintedPages.map((p) => p.text).join("\n\n"),
    ...(first.html === undefined ? {} : { html: paintedPages.map((p) => p.html).join("\n\n") }),
    canvas: first.canvas,
    pages: paintedPages.map(({ text, html, canvas }) => ({ text, canvas, ...(html === undefined ? {} : { html }) })),
    meta: {
      nodes: dag.nodes,
      description: `${options.title ? `${options.title}. ` : ""}${dag.nodes.length} nodes, ${naturalColumns} lane${naturalColumns === 1 ? "" : "s"}; ${panels.length} panel${panels.length === 1 ? "" : "s"}.`,
    },
    report: { ledger: dedupeGlyphDiagramLedger(ledger), unsupportedGlyphs: paintedPages.flatMap((p) => p.unsupportedGlyphs) },
  };
}

export async function renderGlyphLaneDagJson(json: string, options: GlyphLaneRenderOptions = {}): Promise<string> {
  try {
    const result = await renderGlyphLaneDag(validateGlyphLaneDag(parseGlyphLaneDagJson(json)), options);
    return JSON.stringify({ text: result.text, ...(result.html === undefined ? {} : { html: result.html }), meta: result.meta, report: result.report });
  } catch (e) {
    const error = e as Error & { code?: string };
    return JSON.stringify({ error: error.message, code: error.code ?? null, hint: error.code ? glyphLaneDagRepairHint(error.code) : "Pass a JSON object with a nodes array." });
  }
}
