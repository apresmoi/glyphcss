/**
 * Cell-buffer contract — the shared, renderer-agnostic representation of a
 * rasterized glyph grid, plus the post-rasterize `transformCells` hook.
 *
 * This is the SAME contract the web effect layer (`@glyphcss/effects` cell
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

/**
 * A rasterized glyph grid. Row-major, `idx = row * cols + col`. Buffers passed
 * to `transformCells` are callback-scoped; `rasterizeToCells` returns copies.
 */
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
   * nearer the viewer (glyphcss convention). Under supersampling this is copied
   * from the same nearest-center winning subcell as world/normal/UV fields.
   * Length `cols*rows`.
   */
  depth: Float64Array;
  /**
   * Final solid-mode shading scalar that selected the depth-winning glyph.
   * Values are clamped to `0..1`; empty cells are `NaN`. Present only when a
   * consumer requested retained shading data.
   */
  shade?: Float32Array;
  /**
   * Interleaved depth-winning world positions: `[x0, y0, z0, ...]`. Empty
   * cells contain `NaN`. Present only when requested by an effect program.
   */
  worldPosition?: Float32Array;
  /**
   * Interleaved depth-winning positions in the mesh's own PRE-TRANSFORM 3D
   * frame: `[x0, y0, z0, ...]`. Empty cells contain `NaN`. Present only when
   * requested by an effect program (`objectPosition` requirement). Unlike
   * `worldPosition`, stays fixed relative to the mesh across rotation —
   * faces sampling it agree on one field filling the object's volume
   * instead of each having its own 2D UV parameterisation.
   */
  objectPosition?: Float32Array;
  /**
   * Interleaved object-space EXIT positions: `[x0, y0, z0, ...]` — the
   * farthest intersection of the depth-winning mesh along each cell's view
   * ray, in the same pre-transform frame as `objectPosition`. Empty cells
   * contain `NaN`. Present only when requested by an effect program
   * (`objectExit` requirement). The object-space ray is not its own field —
   * it is `normalize(objectExit − objectPosition)` per cell.
   */
  objectExit?: Float32Array;
  /**
   * Interleaved depth-winning geometric face normals: `[x0, y0, z0, ...]`.
   * Empty cells contain `NaN`. Present only when requested by an effect program.
   */
  normal?: Float32Array;
  /**
   * Interleaved depth-winning geometric face normals in the mesh's own
   * PRE-TRANSFORM 3D frame: `[x0, y0, z0, ...]`, the object-space sibling of
   * `normal` (which is built from baked WORLD vertices). Empty cells contain
   * `NaN`. Present only when requested by an effect program (`objectNormal`
   * requirement) — the self-consistent frame to pair with `objectPosition`/
   * `objectExit`, since a world normal cannot be dotted against the
   * object-space ray for a rotated mesh. No inverse-transpose is applied, so
   * under non-uniform scale this is the object-frame GEOMETRIC normal.
   */
  objectNormal?: Float32Array;
  /**
   * Positional index into the source polygon array for the depth-winning solid
   * surface. `-1` marks an empty cell. This is deliberately opaque: callers
   * resolve it through their own immutable scene lineage rather than treating
   * it as a semantic class ID.
   */
  winnerPolygon?: Int32Array;
  /**
   * Winning MESH id (see `RasterizeContext.polygonMeshIds`) for the
   * depth-winning solid surface. `-1` marks an empty or occlusion-blanked
   * cell. Solid-mode-only (never populated by wireframe/voxel/ink). It is
   * the substrate for per-object effect targeting (`targetCoverage`) AND,
   * as of VOLUMETRIC-3.md Phase 2, is also read-only-surfaced on
   * `GlyphEffectFrameView.winnerMesh` (never a `GlyphEffectRequirement` —
   * a program cannot request it) so a volumetric subcell program can test
   * exact mesh-boundary equality between neighboring cells instead of only
   * position/normal, which two coplanar same-normal meshes can't
   * distinguish.
   */
  winnerMesh?: Int32Array;
  /** Packed `0xRRGGBB` unlit albedo from the same depth-winning surface cell. */
  albedoRgb?: Uint32Array;
  /** Packed `0xRRGGBB` final lit RGB from the same depth-winning surface cell. */
  targetRgb?: Uint32Array;
  /** Per-cell column index (`= idx % cols`). Length `cols*rows`. */
  screenX: Int32Array;
  /** Per-cell row index (`= (idx / cols) | 0`). Length `cols*rows`. */
  screenY: Int32Array;
  /**
   * Interleaved UV coordinates from the depth-winning solid surface:
   * `[u0, v0, u1, v1, ...]`. Present when at least one rendered polygon
   * authors UVs; empty/non-UV cells contain `NaN, NaN`. Effects can use these
   * coordinates for geometry-attached glyph patterns that rotate and
   * foreshorten with polygon faces instead of swimming in screen space.
   */
  surfaceUv?: Float32Array;
  /**
   * SPIKE (B7, internal/opt-in): per-cell CSS `font-weight` override, e.g.
   * `700` for bold. `0` means "no override" (span carries no `font-weight`
   * style, byte-identical to today). Length `cols*rows`. Not populated by
   * the default rasterizer; nothing sets this yet — `encodeGlyphBuffers`
   * threading it through is the feasibility spike only. See B7 in the
   * burnlist for the measurement that justified this (advance width is
   * stable across weight 400/700 in every tested monospace stack, so a
   * weight-bearing span cannot desync the character grid).
   */
  weight?: Uint16Array;
}

/**
 * Post-rasterize cell hook. Receives the final {@link CellGrid} just before the
 * string is built. May mutate the grid in place (return `void`) or return a new
 * grid. Only `char` + `color` are read back for output; `depth`/`screenX`/
 * `screenY`/`surfaceUv` are inputs the effect can read to order/gate its
 * transform.
 */
export type TransformCells = (grid: CellGrid) => CellGrid | void;

const cellIndexCache: {
  cols: number;
  rows: number;
  screenX: Int32Array;
  screenY: Int32Array;
}[] = [];

function screenIndices(cols: number, rows: number): { screenX: Int32Array; screenY: Int32Array } {
  const cached = cellIndexCache.find((entry) => entry.cols === cols && entry.rows === rows);
  if (cached) return cached;
  const n = cols * rows;
  const screenX = new Int32Array(n);
  const screenY = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    screenX[i] = i % cols;
    screenY[i] = (i / cols) | 0;
  }
  cellIndexCache.push({ cols, rows, screenX, screenY });
  if (cellIndexCache.length > 8) cellIndexCache.shift();
  return { screenX, screenY };
}

/**
 * Build a {@link CellGrid} from the rasterizer's final per-cell buffers. Copies
 * `char`/`color` so the hook can mutate freely without corrupting the
 * rasterizer's reused scratch buffers. `depthSrc` is copied when its length
 * matches; otherwise a coverage proxy is derived from `char`.
 */
export function buildCellGrid(
  char: string[],
  color: (string | null)[] | null,
  depthSrc: Float64Array | null,
  cols: number,
  rows: number,
  surfaceUvSrc: Float32Array | null = null,
  shadeSrc: Float32Array | null = null,
  worldPositionSrc: Float32Array | null = null,
  normalSrc: Float32Array | null = null,
  winnerPolygonSrc: Int32Array | null = null,
  albedoRgbSrc: Uint32Array | null = null,
  targetRgbSrc: Uint32Array | null = null,
  weightSrc: Uint16Array | null = null,
  objectPositionSrc: Float32Array | null = null,
  objectExitSrc: Float32Array | null = null,
  winnerMeshSrc: Int32Array | null = null,
  objectNormalSrc: Float32Array | null = null,
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
  const { screenX: cachedScreenX, screenY: cachedScreenY } = screenIndices(cols, rows);
  const screenX = new Int32Array(cachedScreenX);
  const screenY = new Int32Array(cachedScreenY);
  const haveDepth = depthSrc !== null && depthSrc.length >= n;
  for (let i = 0; i < n; i++) {
    if (haveDepth) depth[i] = depthSrc![i]!;
    else depth[i] = outChar[i] === " " ? -Infinity : 0;
  }
  const grid: CellGrid = { cols, rows, char: outChar, color: outColor, depth, screenX, screenY };
  if (surfaceUvSrc !== null && surfaceUvSrc.length >= n * 2) {
    grid.surfaceUv = new Float32Array(surfaceUvSrc.subarray(0, n * 2));
  }
  if (shadeSrc !== null && shadeSrc.length >= n) {
    grid.shade = new Float32Array(shadeSrc.subarray(0, n));
  }
  if (worldPositionSrc !== null && worldPositionSrc.length >= n * 3) {
    grid.worldPosition = new Float32Array(worldPositionSrc.subarray(0, n * 3));
  }
  if (normalSrc !== null && normalSrc.length >= n * 3) {
    grid.normal = new Float32Array(normalSrc.subarray(0, n * 3));
  }
  if (objectNormalSrc !== null && objectNormalSrc.length >= n * 3) {
    grid.objectNormal = new Float32Array(objectNormalSrc.subarray(0, n * 3));
  }
  if (objectPositionSrc !== null && objectPositionSrc.length >= n * 3) {
    grid.objectPosition = new Float32Array(objectPositionSrc.subarray(0, n * 3));
  }
  if (objectExitSrc !== null && objectExitSrc.length >= n * 3) {
    grid.objectExit = new Float32Array(objectExitSrc.subarray(0, n * 3));
  }
  if (winnerPolygonSrc !== null && winnerPolygonSrc.length >= n) {
    grid.winnerPolygon = new Int32Array(winnerPolygonSrc.subarray(0, n));
  }
  if (winnerMeshSrc !== null && winnerMeshSrc.length >= n) {
    grid.winnerMesh = new Int32Array(winnerMeshSrc.subarray(0, n));
  }
  if (albedoRgbSrc !== null && albedoRgbSrc.length >= n) grid.albedoRgb = new Uint32Array(albedoRgbSrc.subarray(0, n));
  if (targetRgbSrc !== null && targetRgbSrc.length >= n) grid.targetRgb = new Uint32Array(targetRgbSrc.subarray(0, n));
  if (weightSrc !== null && weightSrc.length >= n) grid.weight = new Uint16Array(weightSrc.subarray(0, n));
  return grid;
}

function assertCellBufferLength(
  value: { readonly length: number },
  expected: number,
  label: string,
): void {
  if (value.length < expected) {
    throw new RangeError(`glyphcss: ${label} must contain at least ${expected} cells.`);
  }
}

function assertCellGridShape(grid: CellGrid): void {
  if (!Number.isInteger(grid.cols) || grid.cols < 0 || !Number.isInteger(grid.rows) || grid.rows < 0) {
    throw new RangeError("glyphcss: cell-grid dimensions must be non-negative integers.");
  }
  const n = grid.cols * grid.rows;
  assertCellBufferLength(grid.char, n, "cell-grid char buffer");
  assertCellBufferLength(grid.color, n, "cell-grid color buffer");
  assertCellBufferLength(grid.depth, n, "cell-grid depth buffer");
  assertCellBufferLength(grid.screenX, n, "cell-grid screenX buffer");
  assertCellBufferLength(grid.screenY, n, "cell-grid screenY buffer");
  if (grid.shade) assertCellBufferLength(grid.shade, n, "cell-grid shade buffer");
  if (grid.worldPosition) assertCellBufferLength(grid.worldPosition, n * 3, "cell-grid worldPosition buffer");
  if (grid.objectPosition) assertCellBufferLength(grid.objectPosition, n * 3, "cell-grid objectPosition buffer");
  if (grid.objectExit) assertCellBufferLength(grid.objectExit, n * 3, "cell-grid objectExit buffer");
  if (grid.normal) assertCellBufferLength(grid.normal, n * 3, "cell-grid normal buffer");
  if (grid.objectNormal) assertCellBufferLength(grid.objectNormal, n * 3, "cell-grid objectNormal buffer");
  if (grid.winnerPolygon) assertCellBufferLength(grid.winnerPolygon, n, "cell-grid winnerPolygon buffer");
  if (grid.winnerMesh) assertCellBufferLength(grid.winnerMesh, n, "cell-grid winnerMesh buffer");
  if (grid.albedoRgb) assertCellBufferLength(grid.albedoRgb, n, "cell-grid albedoRgb buffer");
  if (grid.targetRgb) assertCellBufferLength(grid.targetRgb, n, "cell-grid targetRgb buffer");
  if (grid.surfaceUv) assertCellBufferLength(grid.surfaceUv, n * 2, "cell-grid surfaceUv buffer");
  if (grid.weight) assertCellBufferLength(grid.weight, n, "cell-grid weight buffer");
}

/** Return a durable deep copy of a cell grid and all of its typed buffers. */
export function cloneCellGrid(grid: CellGrid): CellGrid {
  assertCellGridShape(grid);
  const n = grid.cols * grid.rows;
  const clone: CellGrid = {
    cols: grid.cols,
    rows: grid.rows,
    char: grid.char.slice(0, n),
    color: grid.color.slice(0, n),
    depth: new Float64Array(grid.depth.subarray(0, n)),
    screenX: new Int32Array(grid.screenX.subarray(0, n)),
    screenY: new Int32Array(grid.screenY.subarray(0, n)),
  };
  if (grid.shade) clone.shade = new Float32Array(grid.shade.subarray(0, n));
  if (grid.worldPosition) clone.worldPosition = new Float32Array(grid.worldPosition.subarray(0, n * 3));
  if (grid.objectPosition) clone.objectPosition = new Float32Array(grid.objectPosition.subarray(0, n * 3));
  if (grid.objectExit) clone.objectExit = new Float32Array(grid.objectExit.subarray(0, n * 3));
  if (grid.normal) clone.normal = new Float32Array(grid.normal.subarray(0, n * 3));
  if (grid.objectNormal) clone.objectNormal = new Float32Array(grid.objectNormal.subarray(0, n * 3));
  if (grid.winnerPolygon) clone.winnerPolygon = new Int32Array(grid.winnerPolygon.subarray(0, n));
  if (grid.winnerMesh) clone.winnerMesh = new Int32Array(grid.winnerMesh.subarray(0, n));
  if (grid.albedoRgb) clone.albedoRgb = new Uint32Array(grid.albedoRgb.subarray(0, n));
  if (grid.targetRgb) clone.targetRgb = new Uint32Array(grid.targetRgb.subarray(0, n));
  if (grid.surfaceUv) clone.surfaceUv = new Float32Array(grid.surfaceUv.subarray(0, n * 2));
  if (grid.weight) clone.weight = new Uint16Array(grid.weight.subarray(0, n));
  return clone;
}

function escapeGlyphHtml(glyph: string): string {
  if (glyph === "&") return "&amp;";
  if (glyph === "<") return "&lt;";
  if (glyph === ">") return "&gt;";
  return glyph;
}

const nonAsciiGlyphValidity = new Map<string, boolean>();
const NON_CELL_CODE_POINT = /[\p{Cc}\p{Cf}\p{M}\p{Zl}\p{Zp}]/u;

function isWideBmpCodePoint(code: number): boolean {
  return code >= 0x1100 && (
    code <= 0x115f || code === 0x2329 || code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

export function isSingleCellGlyph(glyph: unknown): glyph is string {
  if (typeof glyph !== "string" || glyph.length !== 1) return false;
  const code = glyph.charCodeAt(0);
  if (code >= 0x20 && code <= 0x7e) return true;
  const cached = nonAsciiGlyphValidity.get(glyph);
  if (cached !== undefined) return cached;
  const valid = !NON_CELL_CODE_POINT.test(glyph) && !isWideBmpCodePoint(code);
  if (nonAsciiGlyphValidity.size >= 512) nonAsciiGlyphValidity.clear();
  nonAsciiGlyphValidity.set(glyph, valid);
  return valid;
}

function assertGlyph(glyph: unknown, index: number): asserts glyph is string {
  if (!isSingleCellGlyph(glyph)) {
    throw new TypeError(`glyphcss: cell ${index} must contain exactly one printable glyph.`);
  }
}

function assertColor(color: unknown, index: number): asserts color is string | null {
  if (color !== null && (typeof color !== "string" || !/^#[\da-f]{6}$/i.test(color))) {
    throw new TypeError(`glyphcss: cell ${index} color must be null or #rrggbb.`);
  }
}

/**
 * Test-only instrumentation for `colorTolerance` (COLOR-TOLERANCE.md Phase 1):
 * counts actual `parseInt` calls made by {@link packColorCached} (cache
 * misses only), so a test can observe that repeated comparisons against the
 * same distinct color string only ever parse once. A single integer
 * increment per cache miss costs nothing in production; these two functions
 * exist purely so a test can observe it.
 */
let colorParseCallCountForTests = 0;

export function resetGlyphColorParseCountForTests(): void {
  colorParseCallCountForTests = 0;
}

export function getGlyphColorParseCountForTests(): number {
  return colorParseCallCountForTests;
}

/**
 * Test-only instrumentation for `colorTolerance` (COLOR-TOLERANCE.md Phase 1):
 * counts every {@link withinColorTolerance} INVOCATION (not cache misses —
 * that's {@link colorParseCallCountForTests}), so a test can pin the cost
 * claim in COLOR-TOLERANCE.md's "Cost" section: the `===` fast path in
 * `encodeGlyphBuffers` must keep the number of NUMERIC comparisons bounded by
 * the pre-merge span count, not the cell count. Counting distinct-string
 * parses alone can't catch a fast-path regression — with the memo in place,
 * parses are bounded by the number of distinct colors regardless of how many
 * times each one gets numerically compared, so a test needs the call count,
 * not the parse count, to observe the fast path actually firing.
 */
let colorToleranceCallCountForTests = 0;

export function resetGlyphColorToleranceCallCountForTests(): void {
  colorToleranceCallCountForTests = 0;
}

export function getGlyphColorToleranceCallCountForTests(): number {
  return colorToleranceCallCountForTests;
}

/**
 * Memoized `#rrggbb` string -> packed `0xRRGGBB` parse, scoped to a single
 * `encodeGlyphBuffers` call. A rasterized row only ever contains a handful of
 * distinct color strings, so this turns a worst case of one parse per
 * mismatched cell into one parse per distinct string — same call-scoped,
 * no-unbounded-growth shape as `packCellColorCached` in
 * `effectCompositor.ts` (commit 6006461). `assertColor` already guarantees
 * canonical `#rrggbb` by the time a color reaches here, so parsing is a
 * direct `parseInt(slice, 16)` with no regex and no named-colour table.
 */
function packColorCached(cache: Map<string, number>, color: string): number {
  let packed = cache.get(color);
  if (packed === undefined) {
    packed = parseInt(color.slice(1), 16);
    cache.set(color, packed);
    colorParseCallCountForTests++;
  }
  return packed;
}

/**
 * Redmean distance (squared, compared against `tolerance^2` to avoid a
 * per-cell `sqrt`) between two ALREADY-canonical `#rrggbb` colors, via the
 * shared per-call {@link packColorCached} memo. Only called on a string
 * mismatch — the `===` fast path in `encodeGlyphBuffers` never reaches here.
 */
function withinColorTolerance(
  cache: Map<string, number>,
  tolerance2: number,
  anchor: string,
  candidate: string,
): boolean {
  colorToleranceCallCountForTests++;
  const a = packColorCached(cache, anchor);
  const c = packColorCached(cache, candidate);
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const cr = (c >> 16) & 0xff;
  const cg = (c >> 8) & 0xff;
  const cb = c & 0xff;
  const rm = (ar + cr) / 2;
  const dr = ar - cr;
  const dg = ag - cg;
  const db = ab - cb;
  const d2 = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
  return d2 <= tolerance2;
}

/**
 * Encode final cell buffers for a `<pre>`. Colored output is HTML-escaped and
 * accepts only canonical hex colors; plain output is suitable for textContent.
 */
function assertWeight(weight: unknown, index: number): asserts weight is number {
  if (typeof weight !== "number" || !Number.isFinite(weight) || weight < 0) {
    throw new TypeError(`glyphcss: cell ${index} weight must be a non-negative number.`);
  }
}

/**
 * Encode final cell buffers for a `<pre>`. Colored output is HTML-escaped and
 * accepts only canonical hex colors; plain output is suitable for textContent.
 *
 * `weight` (SPIKE, B7, opt-in) is an optional trailing per-cell CSS
 * `font-weight` buffer, same length/index convention as `color`. `0` (or
 * omitting the buffer) means "no override" — completely unaffected output,
 * byte-identical to calling this without the parameter. A non-zero weight
 * only has an effect under `useColors: true` (plain `textContent` cannot
 * carry a style), and starts a new run alongside color so `font-weight`
 * lands in the same `<span style="...">` as the existing color styling.
 *
 * `colorTolerance` (COLOR-TOLERANCE.md Phase 1, default `0` = off, byte-
 * identical) is row-wise greedy run-extension against an ANCHOR color: while
 * `colorTolerance > 0`, a run keeps extending as long as each next cell's
 * true color is within `colorTolerance` of the run's anchor (redmean
 * distance, compared squared to avoid a per-cell `sqrt`) — not against the
 * previous cell, so error never drifts across a run. A merged cell is
 * EMITTED at the anchor's color, not its own true color; that substitution
 * is exactly what a higher tolerance trades for fewer spans. The anchor
 * itself resets on any non-extending cell, including a blank (space) cell,
 * which already forces `nextColor = null` and so already breaks any run
 * (verified, not assumed). The `===` string check is the fast path with no
 * parse; only a string mismatch reaches {@link withinColorTolerance}, which
 * parses through the call-scoped {@link packColorCached} memo — bounding
 * parse calls by the number of DISTINCT color strings actually compared,
 * itself bounded by the pre-merge span count, never the cell count.
 */
export function encodeGlyphBuffers(
  char: readonly string[],
  color: readonly (string | null)[],
  cols: number,
  rows: number,
  useColors = true,
  weight: ArrayLike<number> | null = null,
  colorTolerance = 0,
): string {
  if (!Number.isInteger(cols) || cols < 0 || !Number.isInteger(rows) || rows < 0) {
    throw new RangeError("glyphcss: cell-buffer dimensions must be non-negative integers.");
  }
  const n = cols * rows;
  assertCellBufferLength(char, n, "cell char buffer");
  assertCellBufferLength(color, n, "cell color buffer");
  if (weight) assertCellBufferLength(weight, n, "cell weight buffer");

  const tolerance2 = colorTolerance > 0 ? colorTolerance * colorTolerance : 0;
  const colorPackCache = colorTolerance > 0 ? new Map<string, number>() : null;

  const parts: string[] = [];
  let runColor: string | null = null;
  let runWeight = 0;
  let runText = "";
  const flushRun = () => {
    if (!runText) return;
    if (useColors && (runColor !== null || runWeight !== 0)) {
      const style =
        runColor !== null && runWeight !== 0
          ? `color:${runColor};font-weight:${runWeight}`
          : runColor !== null
            ? `color:${runColor}`
            : `font-weight:${runWeight}`;
      parts.push(`<span style="${style}">${runText}</span>`);
    } else {
      parts.push(runText);
    }
    runText = "";
  };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      const glyph = char[index];
      assertGlyph(glyph, index);
      const nextColor = useColors && glyph !== " " ? color[index] ?? null : null;
      if (useColors) assertColor(nextColor, index);
      const nextWeight = useColors && glyph !== " " && weight ? weight[index]! : 0;
      if (useColors && weight) assertWeight(nextWeight, index);
      let extendsColorRun = nextColor === runColor;
      if (!extendsColorRun && colorPackCache && nextColor !== null && runColor !== null) {
        extendsColorRun = withinColorTolerance(colorPackCache, tolerance2, runColor, nextColor);
      }
      if (!extendsColorRun || nextWeight !== runWeight) {
        flushRun();
        runColor = nextColor;
        runWeight = nextWeight;
      }
      runText += useColors ? escapeGlyphHtml(glyph) : glyph;
    }
    flushRun();
    runColor = null;
    runWeight = 0;
    if (row < rows - 1) parts.push("\n");
  }
  return parts.join("");
}

/** Encode a validated cell grid for innerHTML (colored) or textContent (plain). */
export function encodeCellGrid(grid: CellGrid, useColors = true): string {
  assertCellGridShape(grid);
  return encodeGlyphBuffers(grid.char, grid.color, grid.cols, grid.rows, useColors, grid.weight ?? null);
}

/**
 * Encode TWO independent per-cell colors (`charMode: "halfblock"` — B4). A run
 * only merges consecutive cells when BOTH `fg` (foreground / `color`, drawn
 * where the glyph itself paints — the whole cell for `█`, the top half for
 * `▀`, the bottom half for `▄`) AND `bg` (`background-color`, painted behind
 * the WHOLE cell) match, unlike {@link encodeGlyphBuffers}'s single-color run
 * key. `bg === null` renders no `background-color` at all — the cell must NOT
 * paint an opaque rectangle over an empty subcell, so callers only pass a
 * non-null `bg` when BOTH the top and bottom subcells are actually covered by
 * geometry (see `rasterize.ts`'s `encodeHalfblockSolid`). This is a sibling to
 * `encodeGlyphBuffers`, not a variant of it: it deliberately does NOT touch
 * {@link CellGrid} (single color per cell), so the `transformCells` hook and
 * the generic effect compositor (`effectCompositor.ts`, one-color-per-cell
 * until its own item) are completely unaffected by this two-color path.
 *
 * `colorTolerance` (COLOR-TOLERANCE.md Phase 2, default `0` = off, byte-
 * identical) is the same row-wise greedy anchor run-extension
 * {@link encodeGlyphBuffers} does, applied independently to `fg` and `bg`: a
 * run keeps extending only when BOTH the next cell's true `fg` is within
 * tolerance of the run's `fg` anchor AND its true `bg` is within tolerance of
 * the run's `bg` anchor (redmean distance, compared squared). Requiring BOTH
 * channels to hold is strictly harder than the single-color case, so the win
 * is smaller — measured 1.5x-2.2x span reduction at tolerance 32-128 on a
 * smooth-shaded icosphere rendered through the real `charMode: "halfblock"`/
 * `"quadrant"` pipeline, per-cell buffers reconstructed losslessly from the
 * real HTML output, vs. the single-color path's 1.6x-31x range in
 * COLOR-TOLERANCE.md's own table — but it is real on every scene measured
 * (never zero), so it ships rather than being a documented no-op. `null`
 * only ever matches `null` (an empty/half-covered subcell can't tolerance-
 * merge into a covered one, exactly like
 * {@link encodeGlyphBuffers}'s own blank-cell reset), and the `===` fast path
 * (both channels reference-equal) never parses.
 */
export function encodeGlyphBuffersDual(
  char: readonly string[],
  fg: readonly (string | null)[],
  bg: readonly (string | null)[],
  cols: number,
  rows: number,
  useColors = true,
  colorTolerance = 0,
): string {
  if (!Number.isInteger(cols) || cols < 0 || !Number.isInteger(rows) || rows < 0) {
    throw new RangeError("glyphcss: cell-buffer dimensions must be non-negative integers.");
  }
  const n = cols * rows;
  assertCellBufferLength(char, n, "cell char buffer");
  assertCellBufferLength(fg, n, "cell fg buffer");
  assertCellBufferLength(bg, n, "cell bg buffer");

  const tolerance2 = colorTolerance > 0 ? colorTolerance * colorTolerance : 0;
  const colorPackCache = colorTolerance > 0 ? new Map<string, number>() : null;
  const channelExtends = (runColor: string | null, nextColor: string | null): boolean => {
    if (nextColor === runColor) return true;
    if (!colorPackCache || nextColor === null || runColor === null) return false;
    return withinColorTolerance(colorPackCache, tolerance2, runColor, nextColor);
  };

  const parts: string[] = [];
  let runFg: string | null = null;
  let runBg: string | null = null;
  let runText = "";
  const flushRun = () => {
    if (!runText) return;
    if (useColors && (runFg !== null || runBg !== null)) {
      const style =
        runFg !== null && runBg !== null
          ? `color:${runFg};background-color:${runBg}`
          : runFg !== null
            ? `color:${runFg}`
            : `background-color:${runBg}`;
      parts.push(`<span style="${style}">${runText}</span>`);
    } else {
      parts.push(runText);
    }
    runText = "";
  };

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col;
      const glyph = char[index];
      assertGlyph(glyph, index);
      const nextFg = useColors && glyph !== " " ? fg[index] ?? null : null;
      const nextBg = useColors && glyph !== " " ? bg[index] ?? null : null;
      if (useColors) {
        assertColor(nextFg, index);
        assertColor(nextBg, index);
      }
      const extendsRun = channelExtends(runFg, nextFg) && channelExtends(runBg, nextBg);
      if (!extendsRun) {
        flushRun();
        runFg = nextFg;
        runBg = nextBg;
      }
      runText += useColors ? escapeGlyphHtml(glyph) : glyph;
    }
    flushRun();
    runFg = null;
    runBg = null;
    if (row < rows - 1) parts.push("\n");
  }
  return parts.join("");
}

/**
 * Apply the optional `transformCells` hook to the rasterizer's final cell
 * buffers and return the (possibly replaced) `char`/`color` arrays to stringify.
 *
 * When `hook` is `undefined` this returns the exact same array references it was
 * given — the no-op path that guarantees byte-identical output. With a hook, the
 * grid borrows final rasterizer buffers for this synchronous call; use
 * {@link buildCellGrid} or `rasterizeToCells` when a durable copy is needed.
 */
export function applyCellHook(
  hook: TransformCells | undefined,
  char: string[],
  color: (string | null)[] | null,
  depthSrc: Float64Array | null,
  cols: number,
  rows: number,
  surfaceUvSrc: Float32Array | null = null,
  shadeSrc: Float32Array | null = null,
  worldPositionSrc: Float32Array | null = null,
  normalSrc: Float32Array | null = null,
  winnerPolygonSrc: Int32Array | null = null,
  albedoRgbSrc: Uint32Array | null = null,
  targetRgbSrc: Uint32Array | null = null,
  objectPositionSrc: Float32Array | null = null,
  weightSrc: Uint16Array | null = null,
  objectExitSrc: Float32Array | null = null,
  winnerMeshSrc: Int32Array | null = null,
  objectNormalSrc: Float32Array | null = null,
): { char: string[]; color: (string | null)[] | null; weight: Uint16Array | null } {
  if (!hook) return { char, color, weight: weightSrc };
  const n = cols * rows;
  const hookColor = color ?? new Array<string | null>(n).fill(null);
  let depth: Float64Array;
  if (depthSrc !== null && depthSrc.length >= n) {
    depth = depthSrc;
  } else {
    depth = new Float64Array(n);
    for (let i = 0; i < n; i++) depth[i] = char[i] === " " ? -Infinity : 0;
  }
  const { screenX, screenY } = screenIndices(cols, rows);
  const grid: CellGrid = { cols, rows, char, color: hookColor, depth, screenX, screenY };
  if (shadeSrc !== null && shadeSrc.length >= n) grid.shade = shadeSrc;
  if (worldPositionSrc !== null && worldPositionSrc.length >= n * 3) {
    grid.worldPosition = worldPositionSrc;
  }
  if (normalSrc !== null && normalSrc.length >= n * 3) grid.normal = normalSrc;
  if (objectNormalSrc !== null && objectNormalSrc.length >= n * 3) grid.objectNormal = objectNormalSrc;
  if (objectPositionSrc !== null && objectPositionSrc.length >= n * 3) grid.objectPosition = objectPositionSrc;
  if (objectExitSrc !== null && objectExitSrc.length >= n * 3) grid.objectExit = objectExitSrc;
  if (surfaceUvSrc !== null && surfaceUvSrc.length >= cols * rows * 2) {
    grid.surfaceUv = surfaceUvSrc;
  }
  if (winnerPolygonSrc !== null && winnerPolygonSrc.length >= n) {
    grid.winnerPolygon = winnerPolygonSrc;
  }
  if (winnerMeshSrc !== null && winnerMeshSrc.length >= n) {
    grid.winnerMesh = winnerMeshSrc;
  }
  if (albedoRgbSrc !== null && albedoRgbSrc.length >= n) grid.albedoRgb = albedoRgbSrc;
  if (targetRgbSrc !== null && targetRgbSrc.length >= n) grid.targetRgb = targetRgbSrc;
  if (weightSrc !== null && weightSrc.length >= n) grid.weight = weightSrc;
  const result = hook(grid) ?? grid;
  assertCellGridShape(result);
  if (result.cols !== cols || result.rows !== rows) {
    throw new RangeError("glyphcss: transformCells cannot change cell-grid dimensions.");
  }
  // Write char back always; color only when the scene renders colored output.
  return { char: result.char, color: color ? result.color : color, weight: weightSrc !== null ? result.weight ?? null : null };
}
