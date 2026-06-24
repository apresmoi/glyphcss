/**
 * encodeStaticGlyphHtml — re-encode a rendered colored `<pre>` body into a more
 * compact / different static representation. The renderer emits inline-color
 * runs (`<span style="color:#rgb">chars</span>` interleaved with literal spaces);
 * for a *static* artifact (a CodePen, an inlined SSG fragment) we can do better:
 *
 *   - "inline"  — passthrough (one `style="color:…"` per run). Simplest.
 *   - "classes" — dedupe colors into `.cN{color:…}` rules + class spans, and
 *     trim trailing spaces. Smallest for typical (many runs, few colors) renders.
 *   - "grid"    — CSS-grid-place each colored run by column/row; NO literal
 *     spaces in the markup. Wins only for sparse renders with big empty gaps.
 *
 * Best choice is model-dependent — hence the flag. Returns the `<style>` body and
 * the element HTML separately so the caller can add its own font CSS.
 */
export type GlyphStaticEncoding = "inline" | "classes" | "grid";

interface Run {
  color: string | null;
  text: string;
}

const SPAN_RE = /<span style="color:(#[0-9a-fA-F]+)">([^<]*)<\/span>/g;

function tokenizeLine(line: string): Run[] {
  const runs: Run[] = [];
  let last = 0;
  SPAN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPAN_RE.exec(line)) !== null) {
    if (m.index > last) runs.push({ color: null, text: line.slice(last, m.index) });
    runs.push({ color: m[1], text: m[2] });
    last = SPAN_RE.lastIndex;
  }
  if (last < line.length) runs.push({ color: null, text: line.slice(last) });
  return runs;
}

export interface EncodeStaticResult {
  /** CSS rule body to drop into a `<style>` (color classes, grid setup). */
  css: string;
  /** The element HTML (`<pre>` or `<div>`). */
  html: string;
}

export interface EncodeStaticOptions {
  preClass?: string;
  /** Grid-mode row track height — must match the rendered line-height (e.g. "16px"). Default "1em". */
  rowHeight?: string;
  /** Grid-mode column track width. Default "1ch" (monospace advance). */
  colWidth?: string;
  /** Crop to the content bounding box (drop empty margin rows/columns) so the block centers tight. */
  crop?: boolean;
}

/** Crop tokenized lines to the bounding box of their non-space glyphs. */
function cropLines(lines: Run[][]): Run[][] {
  let minCol = Infinity, maxCol = -1, minRow = Infinity, maxRow = -1;
  lines.forEach((runs, row) => {
    let col = 0;
    let has = false;
    for (const r of runs) {
      for (let i = 0; i < r.text.length; i++) {
        if (r.text[i] !== " ") {
          const c = col + i;
          if (c < minCol) minCol = c;
          if (c > maxCol) maxCol = c;
          has = true;
        }
      }
      col += r.text.length;
    }
    if (has) { if (row < minRow) minRow = row; if (row > maxRow) maxRow = row; }
  });
  if (maxCol < 0) return lines; // nothing but whitespace
  const out: Run[][] = [];
  for (let row = minRow; row <= maxRow; row++) {
    const cropped: Run[] = [];
    let col = 0;
    for (const r of lines[row]) {
      const start = col, end = col + r.text.length;
      col = end;
      const s = Math.max(start, minCol), e = Math.min(end, maxCol + 1);
      if (e > s) cropped.push({ color: r.color, text: r.text.slice(s - start, e - start) });
    }
    out.push(cropped);
  }
  return out;
}

/**
 * Crop a single rendered frame to its content bounding box, returning the inner
 * string (colored spans or plain text) WITHOUT a `<pre>` wrapper. Handy for the
 * terminal/auto path where the wrapper isn't wanted.
 */
export function cropGlyphInner(inner: string): string {
  const lines = cropLines(inner.split("\n").map(tokenizeLine));
  return lines.map((runs) => {
    let out = "";
    for (const r of runs) out += r.color !== null ? `<span style="color:${r.color}">${r.text}</span>` : r.text;
    return out.replace(/[ ]+$/g, "");
  }).join("\n");
}

/**
 * Crop a set of turntable frames to ONE common content box (across all frames)
 * so they stay equal-size and the model sits centered, with no empty margin.
 * Returns the cropped frame strings (inline-span format) + the new row count.
 */
export function cropGlyphFrames(frameInners: string[]): { frames: string[]; rows: number } {
  if (frameInners.length === 0) return { frames: frameInners, rows: 0 };
  const tokenized = frameInners.map((f) => f.split("\n").map(tokenizeLine));
  let minCol = Infinity, maxCol = -1, minRow = Infinity, maxRow = -1;
  for (const frame of tokenized) {
    frame.forEach((runs, row) => {
      let col = 0;
      let has = false;
      for (const r of runs) {
        for (let i = 0; i < r.text.length; i++) {
          if (r.text[i] !== " ") { const c = col + i; if (c < minCol) minCol = c; if (c > maxCol) maxCol = c; has = true; }
        }
        col += r.text.length;
      }
      if (has) { if (row < minRow) minRow = row; if (row > maxRow) maxRow = row; }
    });
  }
  if (maxCol < 0) return { frames: frameInners, rows: frameInners[0].split("\n").length };
  const cropOne = (frame: Run[][]): string => {
    const out: string[] = [];
    for (let row = minRow; row <= maxRow; row++) {
      const runs = frame[row] ?? [];
      let col = 0, line = "";
      for (const r of runs) {
        const start = col, end = col + r.text.length;
        col = end;
        const s = Math.max(start, minCol), e = Math.min(end, maxCol + 1);
        if (e > s) {
          const t = r.text.slice(s - start, e - start);
          line += r.color !== null ? `<span style="color:${r.color}">${t}</span>` : t;
        }
      }
      out.push(line);
    }
    return out.join("\n");
  };
  return { frames: tokenized.map(cropOne), rows: maxRow - minRow + 1 };
}

export function encodeStaticGlyphHtml(
  inner: string,
  mode: GlyphStaticEncoding = "classes",
  opts: EncodeStaticOptions = {},
): EncodeStaticResult {
  const preClass = opts.preClass ?? "glyph-output";
  let lines = inner.split("\n").map(tokenizeLine);
  if (opts.crop) lines = cropLines(lines);

  if (mode === "inline") {
    const body = lines.map((runs) => {
      let out = "";
      for (const r of runs) out += r.color !== null ? `<span style="color:${r.color}">${r.text}</span>` : r.text;
      return out.replace(/[ ]+$/g, "");
    }).join("\n");
    return { css: "", html: `<pre class="${preClass}">${body}</pre>` };
  }

  const colorIndex = new Map<string, number>();
  const colorList: string[] = [];
  const idxOf = (c: string): number => {
    let i = colorIndex.get(c);
    if (i === undefined) { i = colorList.length; colorIndex.set(c, i); colorList.push(c); }
    return i;
  };

  if (mode === "grid") {
    const cells: string[] = [];
    let cols = 0;
    lines.forEach((runs, row) => {
      let col = 0;
      for (const r of runs) {
        if (r.color !== null && r.text.length > 0) {
          const i = idxOf(r.color);
          cells.push(`<s class="c${i}" style="grid-area:${row + 1}/${col + 1}/auto/span ${r.text.length}">${r.text}</s>`);
        }
        col += r.text.length;
      }
      if (col > cols) cols = col;
    });
    const colorCss = colorList.map((c, i) => `.${preClass} .c${i}{color:${c}}`).join("");
    const colW = opts.colWidth ?? "1ch";
    const rowH = opts.rowHeight ?? "1em";
    // Reserve EVERY row (incl. blank leading/trailing) so the block height and
    // line-height match the <pre> exactly — grid-auto-rows would drop empty tails.
    const css = `.${preClass}{display:inline-grid;grid-template-columns:repeat(${cols},${colW});grid-template-rows:repeat(${lines.length},${rowH});white-space:pre}.${preClass} s{font-style:normal;line-height:${rowH}}${colorCss}`;
    return { css, html: `<div class="${preClass}">${cells.join("")}</div>` };
  }

  // "classes"
  const body = lines.map((runs) => {
    let out = "";
    for (const r of runs) {
      if (r.color !== null) out += `<span class="c${idxOf(r.color)}">${r.text}</span>`;
      else out += r.text;
    }
    return out.replace(/[ ]+$/g, ""); // trailing spaces are invisible + fragile
  }).join("\n");
  const css = colorList.map((c, i) => `.${preClass} .c${i}{color:${c}}`).join("");
  return { css, html: `<pre class="${preClass}">${body}</pre>` };
}
