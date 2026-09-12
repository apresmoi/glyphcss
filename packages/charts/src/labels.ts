/**
 * Charts' OWN label-collision policy — NOT maps' `glyphMapDeclutterLabels`
 * (PLAN.md Phase 1: "charts and diagrams write their own with obstacles in
 * their own phases"). A label never overflows the viewport: one that cannot
 * fit as authored is abbreviated (`d3-format` SI for a numeric label, then
 * truncated with `…`) and the abbreviation is recorded in `report.ledger` —
 * silent overflow would corrupt the row past the viewport edge exactly the
 * way an unchecked `canvas.text` call would.
 */

import { format as d3format } from "d3-format";
import { createGlyphCanvas, type GlyphCanvasTierName } from "glyphcss";

export interface GlyphChartObstacleRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface GlyphChartLabelCandidate {
  readonly id: string;
  /** Anchor column/row the label is centred on. */
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly priority?: number;
  readonly maxWidth?: number;
  /** Hint forwarded to `abbreviateChartText` — see its own doc. */
  readonly numeric?: boolean;
}

export interface GlyphChartLabelLayoutOptions {
  readonly charset?: GlyphCanvasTierName;
  readonly obstacles: readonly GlyphChartObstacleRect[];
  readonly viewport: { readonly cols: number; readonly rows: number };
}

export interface GlyphChartPlacedLabel {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly abbreviated: boolean;
}

export interface GlyphChartLabelLayoutResult {
  readonly placed: readonly GlyphChartPlacedLabel[];
  readonly dropped: readonly string[];
  readonly ledger: readonly string[];
}

/** Measure the same folded cells text() paints, including the ASCII repertoire. */
export function chartText(text: string, charset: GlyphCanvasTierName = "box"): string {
  // NFD routes accented graphemes through the canvas's existing fold. The
  // frozen canvas accepts other single-cell Unicode; ASCII is chart policy.
  const input = charset === "ascii" ? text.normalize("NFD").replace(/−/g, "-").replace(/…/g, "...").replace(/µ/g, "u") : text;
  const scratch = createGlyphCanvas({ cols: Math.max(1, input.length), rows: 1, tier: charset });
  scratch.text(0, 0, [input]);
  const folded = scratch.grid.char.join("").trimEnd();
  return charset === "ascii" ? folded.replace(/[^\x20-\x7e]/gu, "?") : folded;
}

export interface GlyphChartAbbreviateResult {
  readonly text: string;
  readonly changed: boolean;
  /**
   * `true` iff a NUMERIC label could not be made to fit even after SI
   * abbreviation — `text` is `""` in that case, and the caller must DROP the
   * label rather than paint it. Truncating a category label with `…` loses
   * a word; truncating a NUMBER produces a different, plausible, WRONG
   * number (review finding 4: `"1.5M"` sliced to fit 1 cell reads as `"1"`,
   * off by a factor of 1,500,000). Category labels have no such failure mode
   * and keep the existing ellipsis truncation.
   */
  readonly dropped?: boolean;
}

/**
 * `numeric` is an explicit HINT from the caller (an axis tick candidate
 * whose scale is continuous-numeric, `layout.ts`'s `axisTicks`) rather than
 * something re-derived from `text` alone: a numeric tick's `label` already
 * went through `formatLinearTick`'s own SI formatting (`"1.5M"`), so
 * `Number(text)` on the DISPLAY string fails (`Number("1.5M")` is `NaN`) —
 * without the hint, an already-abbreviated tick label would fall through to
 * the category-style ellipsis truncation this function exists to avoid for
 * numbers. `text.trim() !== "" && Number.isFinite(Number(text))` remains
 * the fallback for a caller (a `text` mark, a legend) that has no such hint
 * and passed a RAW (unformatted) number as a string.
 */
export function abbreviateChartText(text: string, maxWidth: number, charset: GlyphCanvasTierName = "box", numeric = false): GlyphChartAbbreviateResult {
  const original = text;
  text = chartText(text, charset);
  if (text.length <= maxWidth) return { text, changed: text !== original };
  const asNumber = Number(text);
  const rawNumeric = Number.isFinite(asNumber) && text.trim() !== "";
  if (numeric || rawNumeric) {
    if (rawNumeric) {
      const si = chartText(d3format(".2~s")(asNumber), charset);
      if (si.length <= maxWidth) return { text: si, changed: true };
    }
    // SI abbreviation still doesn't fit — or `text` is already an
    // SI-abbreviated/formatted number with nothing left to shrink without
    // cutting digits: DROP, never truncate a number.
    return { text: "", changed: true, dropped: true };
  }
  const ellipsis = charset === "ascii" ? "..." : "…";
  if (maxWidth <= ellipsis.length) return { text: text.slice(0, Math.max(0, maxWidth)), changed: true };
  return { text: text.slice(0, maxWidth - ellipsis.length) + ellipsis, changed: true };
}

function rectFor(x: number, y: number, width: number): GlyphChartObstacleRect {
  const half = Math.floor(width / 2);
  return { x0: x - half, y0: y, x1: x - half + width - 1, y1: y };
}

function overlaps(a: GlyphChartObstacleRect, b: GlyphChartObstacleRect): boolean {
  return !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
}

/**
 * Places `candidates` (in registration/priority order — no re-sorting, the
 * caller decides priority by list order, matching the canvas's own
 * "earlier call wins" convention) against `obstacles` and the viewport
 * bounds, growing the obstacle list with every placed label so later
 * candidates avoid earlier ones too.
 */
export function glyphChartLabelLayout(
  candidates: readonly GlyphChartLabelCandidate[],
  opts: GlyphChartLabelLayoutOptions,
): GlyphChartLabelLayoutResult {
  const ordered = [...candidates].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  const ledger: string[] = [];
  const dropped: string[] = [];
  const placed: GlyphChartPlacedLabel[] = [];
  const obstacles = [...opts.obstacles];
  const { cols, rows } = opts.viewport;

  for (const c of ordered) {
    if (c.y < 0 || c.y >= rows) { dropped.push(c.id); continue; }
    const maxWidth = Math.max(1, Math.min(cols, c.maxWidth ?? cols));
    const { text, changed, dropped: numericOverflow } = abbreviateChartText(c.text, maxWidth, opts.charset, c.numeric);
    if (numericOverflow) {
      dropped.push(c.id);
      ledger.push(`label "${c.id}": dropped — numeric value "${c.text}" cannot be abbreviated to fit width ${maxWidth} without truncating the number.`);
      continue;
    }
    if (changed) ledger.push(`label "${c.id}": abbreviated "${c.text}" -> "${text}" to fit width ${maxWidth}.`);

    // Clamp the centred placement so it never runs off either edge.
    const half = Math.floor(text.length / 2);
    let startX = c.x - half;
    startX = Math.max(0, Math.min(cols - text.length, startX));
    let rect = rectFor(startX + half, c.y, text.length);

    // Nudge along the row (both directions) to dodge an obstacle/prior label
    // before giving up — a label that simply vanished on the first collision
    // would make "labels never overflow" trivially true by never trying.
    let ok = !obstacles.some((o) => overlaps(o, rect));
    if (!ok) {
      for (let d = 1; d <= cols && !ok; d++) {
        for (const dir of [-1, 1]) {
          const nx = Math.max(0, Math.min(cols - text.length, startX + dir * d));
          const candidateRect = { x0: nx, y0: c.y, x1: nx + text.length - 1, y1: c.y };
          if (!obstacles.some((o) => overlaps(o, candidateRect))) {
            startX = nx;
            rect = candidateRect;
            ok = true;
            break;
          }
        }
      }
    }

    if (!ok) {
      dropped.push(c.id);
      ledger.push(`label "${c.id}": dropped — no free cell for "${text}".`);
      continue;
    }

    placed.push({ id: c.id, x: startX, y: c.y, text, abbreviated: changed });
    obstacles.push(rect);
  }

  return { placed, dropped, ledger };
}
