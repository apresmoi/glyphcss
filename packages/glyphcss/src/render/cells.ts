/**
 * Cell-buffer contract — the shared, renderer-agnostic representation of a
 * rasterized glyph grid, plus the post-rasterize `transformCells` hook.
 *
 * This is the SAME contract the web effect layer (`@glyphcss/animate` cell
 * effects: reveal-by-char, ramp-cycle) and the future C device evaluator (M5)
 * consume. It is deliberately flat + typed-array-friendly so a device port can
 * mirror it 1:1.
 *
 * The hook is ADDITIVE and defaults to absent: when no `transformCells` is
 * supplied the rasterizer never builds a {@link CellGrid} and its string output
 * is byte-identical to before. When supplied, the grid is mutated (or a new grid
 * returned) BEFORE the single string is built — preserving glyphcss's
 * `<pre>`-written-once invariant (the hook runs pre-innerHTML).
 */

/** A rasterized glyph grid. Row-major, `idx = row * cols + col`. */
export interface CellGrid {
  cols: number;
  rows: number;
  /** One glyph per cell. `" "` (space) = empty. Length `cols*rows`. */
  char: string[];
  /**
   * Per-cell color (`#rrggbb`) or `null` for the CSS fallback / no color.
   * Length `cols*rows`. Always present so effects can write color uniformly;
   * ignored on output when the scene renders with `useColors:false`.
   */
  color: (string | null)[];
  /**
   * Per-cell surface depth. `-Infinity` = empty (nothing drawn). Larger =
   * nearer the viewer (glyphcss convention). Best-effort: exact at
   * `supersample:1`; a coverage proxy (`0` covered / `-Infinity` empty) under
   * supersampling where the output-resolution depth is not retained.
   * Length `cols*rows`.
   */
  depth: Float64Array;
  /** Per-cell column index (`= idx % cols`). Length `cols*rows`. */
  screenX: Int32Array;
  /** Per-cell row index (`= (idx / cols) | 0`). Length `cols*rows`. */
  screenY: Int32Array;
}

/**
 * Post-rasterize cell hook. Receives the final {@link CellGrid} just before the
 * string is built. May mutate the grid in place (return `void`) or return a new
 * grid. Only `char` + `color` are read back for output; `depth`/`screenX`/
 * `screenY` are inputs the effect can read to order/gate its transform.
 */
export type TransformCells = (grid: CellGrid) => CellGrid | void;

/**
 * Build a {@link CellGrid} from the rasterizer's final per-cell buffers. Copies
 * `char`/`color` so the hook can mutate freely without corrupting the
 * rasterizer's reused scratch buffers. `depthSrc` is used directly when its
 * length matches; otherwise a coverage proxy is derived from `char`.
 */
export function buildCellGrid(
  char: string[],
  color: (string | null)[] | null,
  depthSrc: Float64Array | null,
  cols: number,
  rows: number,
): CellGrid {
  const n = cols * rows;
  const outChar = char.slice(0, n);
  const outColor: (string | null)[] = new Array(n);
  if (color) {
    for (let i = 0; i < n; i++) outColor[i] = color[i] ?? null;
  } else {
    outColor.fill(null);
  }
  const depth = new Float64Array(n);
  const screenX = new Int32Array(n);
  const screenY = new Int32Array(n);
  const haveDepth = depthSrc !== null && depthSrc.length >= n;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      screenX[i] = c;
      screenY[i] = r;
      if (haveDepth) depth[i] = depthSrc![i]!;
      else depth[i] = outChar[i] === " " ? -Infinity : 0;
    }
  }
  return { cols, rows, char: outChar, color: outColor, depth, screenX, screenY };
}

/**
 * Apply the optional `transformCells` hook to the rasterizer's final cell
 * buffers and return the (possibly replaced) `char`/`color` arrays to stringify.
 *
 * When `hook` is `undefined` this returns the exact same array references it was
 * given — the no-op path that guarantees byte-identical output. Only invoked
 * when a hook is present, so building the grid costs nothing in the common case.
 */
export function applyCellHook(
  hook: TransformCells | undefined,
  char: string[],
  color: (string | null)[] | null,
  depthSrc: Float64Array | null,
  cols: number,
  rows: number,
): { char: string[]; color: (string | null)[] | null } {
  if (!hook) return { char, color };
  const grid = buildCellGrid(char, color, depthSrc, cols, rows);
  const result = hook(grid) ?? grid;
  // Write char back always; color only when the scene renders colored output.
  return { char: result.char, color: color ? result.color : color };
}
