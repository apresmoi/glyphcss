/**
 * Shared "decode a rendered stage `<pre>` into a per-cell grid, then merge
 * adjacent same-color runs" support — the substrate both `glyphSvgExport.ts`
 * ("Download SVG") and `glyphAnsiExport.ts` ("Copy ANSI" / "Download .ans")
 * build on. Factored out of `glyphSvgExport.ts` (which introduced this grid)
 * once a second exporter needed the exact same decode: SVG turns a run into
 * a `<text>`/`<rect>` pair, ANSI turns it into an escape sequence, but "walk
 * the `<pre>` into `(glyph, color, background)` cells, then merge adjacent
 * same-`(color,background)` cells within a row" is identical either way.
 *
 * ── Per-cell representation, not per-encoding ────────────────────────────
 *
 * `colorEncoding: "atlas"` output carries no `<span>`s at all (PUA code
 * points naming palette slots — see `asciiClipboard.ts`'s own doc comment),
 * so a naive implementation that walks `<span>` elements would silently
 * produce nothing under atlas. {@link glyphExportGridFromPre} decodes atlas
 * output through `glyphAtlasCellsFromPre` when a palette is present, and
 * otherwise walks the `<pre>`'s DOM directly (a bare text node is an
 * uncolored cell, a `<span style="color:…;background-color:…">` supplies
 * both to every character inside it — the same `(fg, bg)` pair
 * `encodeGlyphBuffersDual` (halfblock/quadrant) produces).
 */
import { glyphAtlasCellsFromPre } from "./asciiClipboard";

/** One decoded cell of the shared grid: glyph, foreground fill, background fill. */
export interface GlyphExportCell {
  ch: string;
  color: string | null;
  background: string | null;
}

/** Row-major per-cell grid — the shared substrate for both `colorEncoding`s. */
export type GlyphExportGrid = GlyphExportCell[][];

/** A merged run of adjacent same-color, same-background cells within one row. */
export interface GlyphExportRun {
  row: number;
  col: number;
  text: string;
  charCount: number;
  color: string | null;
  background: string | null;
}

/**
 * Build the shared per-cell grid from a rendered stage `<pre>`. `null` when
 * there's nothing rendered — mirrors `extractAsciiFromPre`'s own
 * null-for-empty contract.
 *
 * Adjacent text nodes are already merged by the browser's own HTML parser
 * (verified against both real browsers and the happy-dom test environment),
 * so no special-casing is needed for a run that happens to span more than
 * one text node.
 */
export function glyphExportGridFromPre(pre: HTMLElement | null): GlyphExportGrid | null {
  if (!pre) return null;
  const atlasRows = glyphAtlasCellsFromPre(pre);
  if (atlasRows) {
    return atlasRows.map((row) => row.map((c) => ({ ch: c.ch, color: c.color ?? null, background: null })));
  }
  if (!(pre.textContent ?? "").trim()) return null;

  const rows: GlyphExportCell[][] = [[]];
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

/**
 * Trim trailing whitespace cells from one row — but a trailing cell carrying
 * a `background` is visible (a halfblock/quadrant two-tone cell) even when
 * its glyph is a plain space, and must not be dropped. In practice
 * `encodeGlyphBuffersDual` never pairs a literal space glyph with a
 * background (an uncovered half paints no background at all — see
 * AGENTS.md's halfblock/quadrant decision table), so this is a documented
 * safety condition rather than a behavior change over a plain space-only
 * trim, not merely a hypothetical.
 */
export function trimRowTrailingWhitespace(row: GlyphExportCell[]): GlyphExportCell[] {
  let end = row.length;
  while (end > 0 && row[end - 1]!.background === null && (row[end - 1]!.ch === " " || row[end - 1]!.ch === "\t")) end--;
  return row.slice(0, end);
}

/**
 * Merge each row's adjacent same-`(color, background)` cells into runs.
 * Trailing whitespace is dropped per row (see {@link trimRowTrailingWhitespace});
 * leading whitespace survives as the first run's own `col` offset, exactly
 * as the art's own left offset.
 */
export function glyphExportRuns(grid: GlyphExportGrid): GlyphExportRun[][] {
  return grid.map((rawRow, row) => {
    const cells = trimRowTrailingWhitespace(rawRow);
    const runs: GlyphExportRun[] = [];
    let current: GlyphExportRun | null = null;
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
