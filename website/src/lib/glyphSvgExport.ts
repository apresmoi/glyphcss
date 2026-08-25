/**
 * Shared "export the rendered glyph output as SVG" support — the sibling of
 * `asciiClipboard.ts`'s "Copy ASCII". `/synth` and `/wordart` both mount a
 * "Download SVG" button next to "Copy ASCII"; this file is the one
 * implementation both call into, so a future page with the same export bar
 * doesn't need its own.
 *
 * ── Per-cell representation, not per-encoding ────────────────────────────
 *
 * `colorEncoding: "atlas"` output carries no `<span>`s at all (PUA code
 * points naming palette slots — see `asciiClipboard.ts`'s own doc comment),
 * so a naive implementation that walks `<span>` elements would silently
 * produce an EMPTY svg under atlas. Every function here instead goes
 * through one shared per-cell grid ({@link SvgGrid}):
 * {@link glyphSvgGridFromPre} decodes atlas output through
 * `glyphAtlasCellsFromPre` when a palette is present, and otherwise walks
 * the `<pre>`'s DOM directly (a bare text node is an uncolored cell, a
 * `<span style="color:…;background-color:…">` supplies both to every
 * character inside it — the same `(fg, bg)` pair `encodeGlyphBuffersDual`
 * (halfblock/quadrant) produces, so those two-tone cells round-trip through
 * this file too, as a `<rect>` layer beneath the `<text>`).
 *
 * ── Why `textLength` ──────────────────────────────────────────────────────
 *
 * A monospace font's advance width isn't identical across stacks/platforms.
 * `textLength="…" lengthAdjust="spacingAndGlyphs"` forces each `<text>` run
 * to occupy exactly `charCount × cellWidthPx` regardless of the SVG
 * viewer's actual font metrics — the standard fix for the "shears sideways
 * in a different font" failure mode of exported ASCII-art SVG. Because the
 * geometry is pinned by `textLength`, not by the declared `font-family`,
 * changing `metrics.fontFamily` alone never moves an `x`/`textLength`
 * value — verified in the test file by generating the same grid under two
 * different font stacks and diffing the numeric attributes.
 *
 * ── One `<text>` per colour run ───────────────────────────────────────────
 *
 * {@link glyphSvgRuns} merges each row's adjacent same-`(color,background)`
 * cells, the same row-scoped coalescing `encodeGlyphBuffers`/
 * `encodeGlyphBuffersDual` already apply when they build the `<pre>` in the
 * first place — read back off the rendered grid instead of re-derived from
 * scratch, so the run count this produces matches today's `<span>` count
 * rather than one element per cell. A run of pure, uncolored spaces is
 * dropped entirely when the SVG is built (invisible either way, and
 * dropping it is what keeps the `<text>` count matching the original
 * render's span count instead of counting every gap) — but a null-color
 * run that carries real (non-space) content still renders, with
 * `metrics.defaultColor` as its fill, so a legitimately uncolored glyph
 * (e.g. a `useColors:false` render) is never silently dropped.
 */
import { glyphAtlasCellsFromPre, trimTrailingWhitespacePerLine } from "./asciiClipboard";

/** One decoded cell of the shared grid: glyph, foreground fill, background fill. */
export interface SvgCell {
  ch: string;
  color: string | null;
  background: string | null;
}

/** Row-major per-cell grid — the shared substrate for both `colorEncoding`s. */
export type SvgGrid = SvgCell[][];

/** A merged run of adjacent same-color, same-background cells within one row. */
export interface SvgRun {
  row: number;
  col: number;
  text: string;
  charCount: number;
  color: string | null;
  background: string | null;
}

export interface GlyphSvgMetrics {
  cellWidthPx: number;
  cellHeightPx: number;
  fontSizePx: number;
  fontFamily: string;
  /** Fallback fill for a cell with real (non-space) content but no assigned
   *  color. Solid mode always colors every drawn cell, so this only fires
   *  for a render that legitimately has none (e.g. `useColors:false`). */
  defaultColor?: string;
  /** Stage background rect fill. Omitted → no background rect (transparent). */
  background?: string;
}

const DEFAULT_FONT_STACK = 'ui-monospace, "JetBrains Mono", "SF Mono", "Menlo", monospace';

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Build the shared per-cell grid from a rendered stage `<pre>`. `null` when
 * there's nothing rendered — mirrors {@link trimTrailingWhitespacePerLine}'s
 * sibling `extractAsciiFromPre`'s own null-for-empty contract.
 *
 * Adjacent text nodes are already merged by the browser's own HTML parser
 * (verified against both real browsers and the happy-dom test environment),
 * so no special-casing is needed for a run that happens to span more than
 * one text node.
 */
export function glyphSvgGridFromPre(pre: HTMLElement | null): SvgGrid | null {
  if (!pre) return null;
  const atlasRows = glyphAtlasCellsFromPre(pre);
  if (atlasRows) {
    return atlasRows.map((row) => row.map((c) => ({ ch: c.ch, color: c.color ?? null, background: null })));
  }
  if (!(pre.textContent ?? "").trim()) return null;

  const rows: SvgCell[][] = [[]];
  let row = rows[0]!;
  const pushRun = (text: string, color: string | null, background: string | null) => {
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      for (const ch of line) row.push({ ch, color, background });
      if (i < lines.length - 1) {
        row = [];
        rows.push(row);
      }
    });
  };
  pre.childNodes.forEach((node) => {
    if (node.nodeType === 3 /* Node.TEXT_NODE */) {
      pushRun(node.nodeValue ?? "", null, null);
    } else if (node.nodeType === 1 /* Node.ELEMENT_NODE */) {
      const el = node as HTMLElement;
      pushRun(el.textContent ?? "", el.style.color || null, el.style.backgroundColor || null);
    }
  });
  return rows;
}

function trimRowTrailingWhitespace(row: SvgCell[]): SvgCell[] {
  let end = row.length;
  while (end > 0 && (row[end - 1]!.ch === " " || row[end - 1]!.ch === "\t")) end--;
  return row.slice(0, end);
}

/**
 * Merge each row's adjacent same-`(color, background)` cells into runs.
 * Trailing whitespace is dropped per row (matching
 * `trimTrailingWhitespacePerLine`); leading whitespace survives as the
 * first run's own `col` offset, exactly as the art's own left offset.
 */
export function glyphSvgRuns(grid: SvgGrid): SvgRun[][] {
  return grid.map((rawRow, row) => {
    const cells = trimRowTrailingWhitespace(rawRow);
    const runs: SvgRun[] = [];
    let current: SvgRun | null = null;
    for (let col = 0; col < cells.length; col++) {
      const cell = cells[col]!;
      if (current && current.color === cell.color && current.background === cell.background) {
        current.text += cell.ch;
        current.charCount++;
      } else {
        current = { row, col, text: cell.ch, charCount: 1, color: cell.color, background: cell.background };
        runs.push(current);
      }
    }
    return runs;
  });
}

const isBlankRun = (run: SvgRun): boolean =>
  run.color === null && run.background === null && /^[ \t]*$/.test(run.text);

/**
 * Render a grid to a self-contained SVG string. One `<text>` per non-blank
 * run; a run carrying a `background` (halfblock/quadrant two-tone cells)
 * also gets a `<rect>` layer beneath its `<text>`.
 */
export function buildGlyphSvg(grid: SvgGrid, metrics: GlyphSvgMetrics): string {
  const rows = grid.length;
  const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const width = round(cols * metrics.cellWidthPx);
  const height = round(rows * metrics.cellHeightPx);
  const fontFamily = metrics.fontFamily || DEFAULT_FONT_STACK;
  const defaultColor = metrics.defaultColor ?? "currentColor";

  const rects: string[] = [];
  const texts: string[] = [];
  for (const rowRuns of glyphSvgRuns(grid)) {
    for (const run of rowRuns) {
      if (isBlankRun(run)) continue;
      const x = round(run.col * metrics.cellWidthPx);
      const y = round(run.row * metrics.cellHeightPx);
      const w = round(run.charCount * metrics.cellWidthPx);
      if (run.background) {
        rects.push(
          `<rect x="${x}" y="${y}" width="${w}" height="${round(metrics.cellHeightPx)}" fill="${escapeXml(run.background)}"/>`,
        );
      }
      const fill = run.color ?? defaultColor;
      texts.push(
        `<text x="${x}" y="${y}" xml:space="preserve" fill="${escapeXml(fill)}" textLength="${w}" lengthAdjust="spacingAndGlyphs">${escapeXml(run.text)}</text>`,
      );
    }
  }

  const bgRect = metrics.background
    ? `<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeXml(metrics.background)}"/>`
    : "";

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    bgRect +
    `<g font-family="${escapeXml(fontFamily)}" font-size="${round(metrics.fontSizePx)}" dominant-baseline="hanging">` +
    rects.join("") +
    texts.join("") +
    `</g>` +
    `</svg>`
  );
}

/**
 * Walk up from `el` for the first non-transparent `background-color` —
 * the flat colour a viewer would actually see behind the `<pre>`. Used as
 * the SVG's background rect fill when the caller doesn't supply one
 * explicitly. A gradient `background-image` (e.g. `/wordart`'s stage) has
 * no flat SVG equivalent, so this deliberately reads `background-color`
 * only and keeps climbing past a gradient-only ancestor to the nearest
 * flat one — every stage shell in this app sets a real
 * `background-color` a few ancestors up for exactly this reason.
 */
function resolveEffectiveBackground(el: HTMLElement | null): string | undefined {
  let node: HTMLElement | null = el;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
    node = node.parentElement;
  }
  return undefined;
}

/**
 * Real cell metrics from the LIVE `<pre>` — `/synth` and `/wordart` render
 * at different sizes, and `/synth`'s density control changes its own, so
 * nothing here is assumed. `cellWidthPx`/`cellHeightPx` come from the
 * rendered bounding box divided by the grid's own col/row count (the same
 * measurement the static CodePen export already uses to fit its own baked
 * grid), not a font-metrics guess.
 */
export function measureGlyphSvgMetrics(pre: HTMLElement, grid: SvgGrid, background?: string): GlyphSvgMetrics {
  const rows = grid.length;
  const cols = grid.reduce((m, r) => Math.max(m, r.length), 0);
  const rect = pre.getBoundingClientRect();
  const cs = getComputedStyle(pre);
  const fontSizePx = parseFloat(cs.fontSize) || 13;
  const lineHeightPx = cs.lineHeight === "normal" ? fontSizePx * 1.2 : parseFloat(cs.lineHeight) || fontSizePx;
  return {
    cellWidthPx: cols > 0 && rect.width > 0 ? rect.width / cols : fontSizePx * 0.6,
    cellHeightPx: rows > 0 && rect.height > 0 ? rect.height / rows : lineHeightPx,
    fontSizePx,
    fontFamily: cs.fontFamily || DEFAULT_FONT_STACK,
    defaultColor: cs.color || undefined,
    background: background ?? resolveEffectiveBackground(pre),
  };
}

/**
 * Build the export SVG string for a stage `<pre>`, or `null` if there's
 * nothing rendered — mirrors `extractAsciiFromPre`'s own contract.
 */
export function glyphSvgFromPre(pre: HTMLElement | null): string | null {
  const grid = glyphSvgGridFromPre(pre);
  if (!grid) return null;
  return buildGlyphSvg(grid, measureGlyphSvgMetrics(pre!, grid));
}

/**
 * Download the currently rendered stage `<pre>` as a standalone SVG file —
 * the "Download SVG" button's handler, next to "Copy ASCII". Returns
 * `false` (nothing downloaded) when there's nothing rendered, so the caller
 * can surface the same idle/error transient `handleCopyAscii` already uses.
 */
export function downloadGlyphSvg(pre: HTMLElement | null, filename: string): boolean {
  const svg = glyphSvgFromPre(pre);
  if (svg === null) return false;
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
