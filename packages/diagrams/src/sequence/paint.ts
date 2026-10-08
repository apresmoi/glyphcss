import {
  createGlyphCanvas, GLYPH_CANVAS_TIERS, GLYPH_CANVAS_DIRECTION_BITS,
  encodeGlyphCanvasText, encodeGlyphCanvasAnsi, encodeGlyphCanvasHtml,
  type GlyphCanvasTierName,
} from "glyphcss";
import { glyphDiagramTruncateLabel } from "../labels";
import { glyphDiagramCenterOffset } from "../center";
import { glyphDiagramPaletteColor, resolveGlyphDiagramColor } from "../color";
import { diagramLedgerEntryFromCanvasMessage, ledgerRouteConflict, type GlyphDiagramLedgerEntry } from "../ledger";
import type { GlyphSequenceColumn, GlyphSequenceRow } from "./layout";
import type { GlyphSequenceParticipant } from "./types";
import type { GlyphSequenceRenderOptions } from "./render";

const { n: N, e: E, s: S, w: W } = GLYPH_CANVAS_DIRECTION_BITS;

export interface GlyphSequencePaintResult {
  readonly text: string; readonly html?: string; readonly canvas: ReturnType<typeof createGlyphCanvas>;
  readonly ledger: GlyphDiagramLedgerEntry[]; readonly unsupportedGlyphs: string[];
}

/**
 * Paints one panel: the participant header, every lifeline (a full-height
 * `line()`, painted FIRST so every later call simply overwrites the cells
 * it needs — no junction resolver, no route registration; a sequence
 * diagram's geometry is two fixed axes, so a hand-placed tee/arrowhead/cross
 * per cell is simpler and more precise than the graph pipeline's general
 * crossing resolver). Always a fresh canvas — re-registering a route can't
 * erase old glyphs, the package's own standing rule (`AGENTS.md`'s Don't
 * list), even though this painter never calls `edge()`/`route()` itself.
 */
export function paintGlyphSequence(
  participants: readonly GlyphSequenceParticipant[],
  columns: readonly GlyphSequenceColumn[],
  rows: readonly GlyphSequenceRow[],
  bodyHeight: number,
  width: number,
  options: GlyphSequenceRenderOptions & { readonly width: number; readonly height: number },
): GlyphSequencePaintResult {
  const charset: GlyphCanvasTierName = options.charset ?? "box";
  const colored = options.color !== "none";
  const color = colored ? "#94a3b8" : null, accent = colored ? "#38bdf8" : null;
  // Per-participant colour, resolved and validated ONCE per participant
  // (never per cell) — default cycles the shared palette by the
  // participant's own position in `participants`, so column order alone
  // decides the default, same as `laneColor`'s column-index default.
  const participantColors = new Map(participants.map((p, i) =>
    [p.id, colored ? resolveGlyphDiagramColor(options.participantColor, p, glyphDiagramPaletteColor(i), "participantColor") : null]));
  const hasActor = columns.some((c) => c.shape === "actor");
  const headerRows = hasActor ? 2 : 1;
  const contentHeight = headerRows + 1 + bodyHeight + 1;
  const canvasRows = Math.max(contentHeight, options.height);
  /**
   * CENTRE the diagram in the canvas it was given. USER FEEDBACK, verbatim:
   * "why are they rendering in a corner? shouldn't they render in the same
   * kind of canvas size as the other diagrams? centered?" — on `web` the page
   * hands this form the whole measured viewport (`glyphDiagramsWorkbenchWebGridSize`),
   * exactly as it does the graph pipeline, so a layout anchored at 0,0 left a
   * 2-participant sequence in the top-left of a 120x36 grid (measured: ink at
   * rows 0-6, cols 1-15 — a 105-column right margin). The layout stays
   * origin-relative; only the paint is offset, so every x/y below is shifted
   * once here rather than at each of its ~20 call sites.
   */
  // `width` is the LAYOUT's own content width; `options.width`/`.height` is
  // the requested grid. The offset comes from the package's ONE shared
  // definition (`glyphDiagramCenterOffset`), the same one the graph
  // pipeline's `centered()` uses, so every form centres identically.
  const canvasCols = Math.max(width, options.width);
  // Centre the INK, not the layout box. The column layout is asymmetric by
  // design — a 1-cell left gutter against a 2-cell right margin (plus room
  // for a trailing self-loop) — so centring `width` itself left the diagram
  // one cell off centre where the graph pipeline sat exactly symmetric.
  // `canvas.text(x, y, .., { align: "center" })` puts a k-glyph label at
  // `x - floor(k/2) .. x - floor(k/2) + k - 1` — NOT `x ± floor(k/2)`, which
  // overstates the right edge by one for an even-length label and left the
  // diagram a cell off centre. The lifelines' own columns are included too,
  // since a 1-glyph label is narrower than the rule beneath it.
  const labelLeft = (c: { readonly x: number; readonly label: string }): number => c.x - Math.floor(c.label.length / 2);
  const inkLeft = Math.min(...columns.map((c) => Math.min(labelLeft(c), c.x)));
  const inkRight = Math.max(...columns.map((c) => Math.max(labelLeft(c) + c.label.length - 1, c.x)));
  const { dx, dy: padY } = glyphDiagramCenterOffset(
    { width: inkRight - inkLeft + 1, height: contentHeight },
    { width: canvasCols, height: canvasRows },
  );
  const padX = dx - inkLeft;
  // Every x/y the LAYOUT produced shifts together — the columns AND each
  // row's own endpoints. Shifting only the columns left the arrows and
  // marker boxes detached from their lifelines.
  columns = columns.map((c) => ({ ...c, x: c.x + padX }));
  rows = rows.map((row) => row.type === "message"
    ? { ...row, fromX: row.fromX + padX, toX: row.toX + padX }
    : row.type === "marker"
      ? { ...row, x0: row.x0 + padX, x1: row.x1 + padX, centerX: row.centerX + padX }
      : row);
  const height = contentHeight + padY;
  const canvas = createGlyphCanvas({ cols: canvasCols, rows: canvasRows, tier: charset });
  const tier = GLYPH_CANVAS_TIERS[charset];
  const ledger: GlyphDiagramLedgerEntry[] = [];

  for (const column of columns) {
    const participantColor = participantColors.get(column.id) ?? (colored ? accent : null);
    if (column.shape === "actor") canvas.text(column.x, padY, ["o"], { align: "center", color: participantColor });
    canvas.text(column.x, padY + headerRows - 1, [column.label], { align: "center", color: participantColor });
  }
  // Whole-cell `canvas.text`, never `canvas.line()` — mirrors the graph
  // pipeline's own node-border discipline (`paint.ts`'s comment there):
  // `braille`/`blocks` rasterise `line()` at SUB-CELL dot resolution by
  // default, which would draw every other glyph in this function (the tee/
  // corner/arrowhead junction table, all whole-cell box-drawing) against a
  // lifeline made of unrelated dots instead of the same rule glyph.
  for (const column of columns) { const lineColor = participantColors.get(column.id) ?? (colored ? color : null); for (let y = padY + headerRows; y < height; y++) canvas.text(column.x, y, [tier.straight.v], { color: lineColor }); }

  const bodyTop = padY + headerRows + 1;
  const xs = columns.map((c) => c.x);

  // `rowColor` is the ORIGINATING participant's own colour (`message.from`
  // — never `to`, the whole point of a per-participant read: "the arrows
  // originating from it"), falling back to the plain base defaults when
  // uncoloured or when `participants` (a caller could in principle hand a
  // shorter list to a lower-level call) doesn't carry that id.
  const paintArrowRow = (y: number, fromX: number, toX: number, dashed: boolean, rowColor: string | null): void => {
    const forward = toX > fromX;
    const sourceGlyph = tier.junction[forward ? N | S | E : N | S | W]!;
    canvas.text(fromX, y, [sourceGlyph], { color: rowColor });
    const tipX = forward ? toX - 1 : toX + 1;
    let phase = 0;
    for (let x = fromX + (forward ? 1 : -1); forward ? x <= tipX : x >= tipX; x += forward ? 1 : -1) {
      const crossing = xs.includes(x) && x !== fromX && x !== toX;
      const glyph = crossing ? tier.junction[N | E | S | W]! : dashed ? (phase % 2 === 0 ? tier.hop.h : " ") : tier.straight.h;
      phase++;
      canvas.text(x, y, [glyph], { color: rowColor });
    }
    canvas.arrowhead(tipX, y, forward ? "e" : "w", { color: rowColor });
  };

  for (const row of rows) {
    if (row.type === "marker") {
      const { x0, x1, centerX } = row;
      const top = bodyTop + row.top;
      for (let x = x0; x <= x1; x++) {
        const isCorner = x === x0 || x === x1;
        const crossesLifeline = !isCorner && xs.includes(x);
        canvas.text(x, top, [x === x0 ? tier.junction[S | E]! : x === x1 ? tier.junction[S | W]! : crossesLifeline ? tier.junction[N | E | W]! : tier.straight.h], { color });
        canvas.text(x, top + 2, [x === x0 ? tier.junction[N | E]! : x === x1 ? tier.junction[N | W]! : crossesLifeline ? tier.junction[E | S | W]! : tier.straight.h], { color });
      }
      canvas.text(x0, top + 1, [tier.straight.v], { color });
      canvas.text(x1, top + 1, [tier.straight.v], { color });
      const text = glyphDiagramTruncateLabel(row.text, Math.max(0, x1 - x0 - 1), charset);
      canvas.text(centerX, top + 1, [text], { align: "center", color: accent });
      continue;
    }
    const { message, self, fromX, toX, top } = row;
    const y = bodyTop + top;
    const dashed = message.style === "dashed";
    // The ORIGINATING participant's own colour — "each lifeline and the
    // arrows originating from it" (`render.ts`'s own doc on this option);
    // a message this participant only RECEIVES never recolours.
    const rowColor = participantColors.get(message.from) ?? (colored ? (self ? accent : color) : null);
    if (self) {
      if (message.label) {
        const maxWidth = Math.max(0, width - fromX - 4);
        canvas.text(fromX + 2, y, [glyphDiagramTruncateLabel(message.label, maxWidth, charset)], { color: rowColor, align: "left" });
      }
      canvas.text(fromX, y + 1, [tier.junction[N | S | E]!], { color: rowColor });
      canvas.text(fromX + 1, y + 1, [dashed ? tier.hop.h : tier.straight.h], { color: rowColor });
      canvas.text(fromX + 2, y + 1, [tier.junction[S | W]!], { color: rowColor });
      canvas.text(fromX, y + 2, [tier.straight.v], { color: rowColor });
      canvas.text(fromX + 2, y + 2, [tier.junction[N | W]!], { color: rowColor });
      canvas.arrowhead(fromX + 1, y + 2, "w", { color: rowColor });
      continue;
    }
    if (message.label) {
      const left = Math.min(fromX, toX), right = Math.max(fromX, toX);
      const maxWidth = Math.max(0, right - left - 3);
      canvas.text(left + 2, y, [glyphDiagramTruncateLabel(message.label, maxWidth, charset)], { color: rowColor, align: "left" });
    }
    paintArrowRow(y + 1, fromX, toX, dashed, rowColor);
  }

  ledger.push(...canvas.report.ledger.map(diagramLedgerEntryFromCanvasMessage), ...canvas.report.routeConflicts.map((c) => ledgerRouteConflict(c)));
  const colorMode = options.color ?? "none";
  const text = colorMode === "none" || colorMode === "css" ? encodeGlyphCanvasText(canvas) : encodeGlyphCanvasAnsi(canvas, { colors: colorMode === "ansi16" ? "16" : colorMode === "ansi256" ? "256" : "truecolor", env: options.env });
  const html = colorMode === "css" ? encodeGlyphCanvasHtml(canvas) : undefined;
  return { text, ...(html === undefined ? {} : { html }), canvas, ledger, unsupportedGlyphs: [...canvas.report.unsupportedGlyphs] };
}
