/**
 * Palette quantization for `colorEncoding: "atlas"`.
 *
 * The colour-font atlas addresses colour by SLOT — a PUA code point encodes a
 * position in a ≤`maxPaletteSize` (31) palette, never an RGB value (see
 * `fontAtlas.ts`'s mapping doc). A render with more distinct colours than the
 * atlas has slots therefore has to be REDUCED to fit, and this module is that
 * reduction: a frame's colours in, a bounded palette plus a nearest-slot
 * assignment out.
 *
 * ── Why this is not `colorTolerance` ────────────────────────────────────
 *
 * `colorTolerance` (`cells.ts`) is a row-wise, anchor-based RUN-MERGING
 * policy: it bounds the number of `<span>`s a row emits, not the grid-wide
 * distinct-colour count. Measured (`bench/color-font-atlas.md` §3), tolerance
 * 32 cuts field-synth spans 14% and its global distinct-colour count 2%. It
 * can never be the atlas's palette step — the two operate on different axes
 * and both remain, independently.
 *
 * ── Median cut, tuned to the error metric we actually minimize ──────────
 *
 * The reducer is median cut (Heckbert) — recursive binary subdivision of
 * colour space, one box per palette slot — with three deliberate departures,
 * each of which exists because the textbook rule measurably underperforms on
 * the colour distributions glyphcss renders actually emit:
 *
 *   1. **Channel spreads are scaled by the redmean weights** when choosing
 *      which box to split and along which axis. Redmean weights green ~4 and
 *      red/blue ~2.5 ({@link redmeanDistanceSq}), so an unscaled rule would
 *      spend slots resolving blue detail the error metric barely counts.
 *      Scaling by `sqrt` of those weights puts the split decision and the
 *      error we report in the same geometry.
 *   2. **Boxes are ranked, and cut, by weighted squared ERROR, not by extent
 *      or population.** A box's own contribution to total error is what a
 *      slot buys down, and the cut position is the exact 1-D minimum of the
 *      two halves' error (one prefix-sum pass after the sort). A plain
 *      weighted-median cut splits by population instead, which merges two
 *      well-separated clusters while bisecting a third — measured at max
 *      redmean error 237 on a three-cluster histogram this rule keeps under
 *      20. On smooth, gapless data (a Lambert ramp, the common case) the two
 *      rules land in nearly the same place, so this costs nothing there.
 *   3. **Assignment is nearest-palette-entry, not which-box-you-fell-in.**
 *      A box's representative is its weighted mean, and once every box has
 *      one, a colour near a box boundary is frequently closer to the
 *      NEIGHBOURING representative than to its own. Nearest assignment is
 *      never worse than box membership and is cheap (≤31 candidates,
 *      memoized per distinct colour string).
 *
 * When a frame has no more distinct colours than the atlas has slots, the
 * subdivision is skipped entirely and every colour keeps its own slot — the
 * render is then EXACT, byte-for-byte the same colours the span encoder would
 * emit. That is the flat-shaded case (`/wordart` Ink, `/examples/city-lab`),
 * and it must stay lossless.
 *
 * ── Pooling: why a palette is not derived per frame ─────────────────────
 *
 * A palette derived from one frame and held fixed drifts badly as a scene
 * animates: `bench/color-font-atlas.md` §3 measures a single-frame-derived
 * N=32 palette at mean redmean error 32.0 on an animating field-synth patch,
 * against 5.1 for one pooled over a window. §6 then measures the refresh
 * interval that keeps a pooled palette honest — about 1 s for a static
 * camera, 0.25 s under orbit, at well under 1% of the frame budget
 * (~0.5-2 ms per repool, against 0.4 ms for the `@font-palette-values` swap
 * that applies it).
 *
 * {@link createGlyphAtlasPaletteQuantizer} implements that as a CAUSAL pool:
 * every resolved frame's colours accumulate into a pending histogram, and a
 * repool (when it fires) builds the next palette from the window that just
 * elapsed — never from the future, so an offline replay and a live render
 * agree. Two gates guard a repool, and both must pass:
 *
 *   - **Time.** At least `refreshMs` since the last repool.
 *
 *     This is NOT what keeps one frame's outputs on one palette. A scene
 *     resolves once per output `<pre>` — the base at the end of base
 *     rasterization, each detail layer at the end of its OWN raster pass — so
 *     those calls are separated by a whole detail-layer render, which in the
 *     heavy-scene regime this feature targets can easily exceed `refreshMs`.
 *     A repool landing between them would leave the base `<pre>` encoded
 *     against generation N while the scene publishes generation N+1 to the
 *     single `font-palette` custom ident they SHARE, silently recolouring the
 *     base wholesale — permanently, on a static scene. The clock cannot rule
 *     that out, so {@link GlyphAtlasPaletteQuantizer.beginTransaction} does:
 *     within a render transaction the palette is LATCHED at the first resolve
 *     and every later output of that frame gets the same one. Colours still
 *     accumulate from every output, so the pool stays complete and causal.
 *   - **Drift.** The window's drifted-cell fraction exceeds what this palette
 *     already scored on the window it was BUILT from. Measuring against that
 *     baseline rather than against zero is what keeps a static render at
 *     exactly one repool (the bootstrap) however long it runs, INCLUDING a
 *     scene whose colour count 31 slots can never fully cover — a photo always
 *     leaves some cells far from every slot, and reading that irreducible
 *     floor as staleness repooled a motionless `/examples/image` ten times in
 *     three seconds before this was measured. Skipping the repool is then safe
 *     by construction rather than by luck: the condition for skipping is
 *     precisely "the palette is doing no worse than it did on the colours it
 *     was built for".
 */

import { GLYPH_FONT_ATLAS, type GlyphFontAtlas } from "./fontAtlas";

/** Canonical `#rrggbb`, the only colour form glyphcss's cell buffers carry. */
const HEX_COLOR = /^#[\da-f]{6}$/i;

/** Whether `color` is a canonical `#rrggbb` string this module can quantize. */
export function isQuantizableColor(color: unknown): color is string {
  return typeof color === "string" && HEX_COLOR.test(color);
}

/** `#rrggbb` → packed `0xRRGGBB`, or `undefined` when it isn't one. */
export function packHexColor(color: string): number | undefined {
  if (!HEX_COLOR.test(color)) return undefined;
  return parseInt(color.slice(1), 16);
}

/** Packed `0xRRGGBB` → canonical lowercase `#rrggbb`. */
export function unpackHexColor(packed: number): string {
  return `#${(packed >>> 0).toString(16).padStart(6, "0")}`;
}

/**
 * Squared redmean distance between two packed colours — the same metric
 * `colorTolerance` compares against (`cells.ts`'s `withinColorTolerance`), so
 * an error reported here is directly comparable to a tolerance value the user
 * already has a feel for. Squared to avoid a `sqrt` in the inner loops;
 * `Math.sqrt` of it lands in the same 0..765 range the slider uses.
 */
export function redmeanDistanceSq(a: number, b: number): number {
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const rm = (ar + br) / 2;
  const dr = ar - br;
  const dg = ag - bg;
  const db = ab - bb;
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}

/**
 * Index of the entry in `palette` (packed colours) nearest `color` by
 * {@link redmeanDistanceSq}. Ties go to the lower index, so the result is
 * deterministic for a given palette order. `-1` for an empty palette.
 */
export function nearestPaletteIndex(palette: readonly number[], color: number): number {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = redmeanDistanceSq(palette[i]!, color);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

// Per-channel weights for the split decision: sqrt of redmean's own channel
// weights (~2.5 / 4 / ~2.5), so "longest axis" means longest in the space the
// error metric measures, not in raw RGB. See the module doc.
const SPLIT_WEIGHT_R = 1.58;
const SPLIT_WEIGHT_G = 2;
const SPLIT_WEIGHT_B = 1.58;

const SPLIT_WEIGHT = [SPLIT_WEIGHT_R, SPLIT_WEIGHT_G, SPLIT_WEIGHT_B];

interface QuantBox {
  /** Half-open range into the shared, in-place partitioned index array. */
  start: number;
  end: number;
  /** Total weighted squared error this box currently contributes. */
  score: number;
  /** 0 = red, 1 = green, 2 = blue — the axis carrying most of `score`. */
  axis: number;
}

function channelOf(packed: number, axis: number): number {
  return axis === 0 ? (packed >> 16) & 0xff : axis === 1 ? (packed >> 8) & 0xff : packed & 0xff;
}

/**
 * Score a box by the weighted squared error it contributes, per channel, in
 * redmean-scaled units — and remember which channel carries most of it.
 *
 * Scoring by ERROR rather than by extent is what makes the greedy split order
 * right: a wide box holding two cells and a narrow box holding ten thousand
 * are not equally worth a slot, and a range-based rule can't tell them apart.
 * The axis choice follows the same measure, so a box is always cut along the
 * direction where its own error actually lives.
 */
function measureBox(box: QuantBox, order: Uint32Array, colors: Uint32Array, weights: Float64Array): void {
  let total = 0;
  const sum = [0, 0, 0];
  const sumSq = [0, 0, 0];
  for (let i = box.start; i < box.end; i++) {
    const idx = order[i]!;
    const c = colors[idx]!;
    const w = weights[idx]!;
    total += w;
    for (let axis = 0; axis < 3; axis++) {
      const v = channelOf(c, axis);
      sum[axis]! += w * v;
      sumSq[axis]! += w * v * v;
    }
  }
  box.score = 0;
  box.axis = 0;
  if (total <= 0) return;
  let bestAxisError = -1;
  for (let axis = 0; axis < 3; axis++) {
    const scale = SPLIT_WEIGHT[axis]! * SPLIT_WEIGHT[axis]!;
    const error = Math.max(0, sumSq[axis]! - (sum[axis]! * sum[axis]!) / total) * scale;
    box.score += error;
    if (error > bestAxisError) {
      bestAxisError = error;
      box.axis = axis;
    }
  }
}

/**
 * Median-cut reduce a colour histogram to at most `maxSize` representatives.
 *
 * `counts` maps packed `0xRRGGBB` to a weight (cell count). Returns packed
 * representatives sorted ascending — a stable order, so the same histogram
 * always produces the same slot assignment, which matters because a slot is
 * what the encoded `<pre>` actually references.
 *
 * When the histogram already fits, its own colours are returned verbatim: the
 * quantization is then the identity and the render is exact.
 */
export function medianCutPalette(counts: ReadonlyMap<number, number>, maxSize: number): number[] {
  if (!Number.isInteger(maxSize) || maxSize < 1) {
    throw new RangeError(`glyphcss: median-cut maxSize must be a positive integer (got ${maxSize}).`);
  }
  const distinct = counts.size;
  if (distinct === 0) return [];
  if (distinct <= maxSize) return [...counts.keys()].sort((a, b) => a - b);

  const colors = new Uint32Array(distinct);
  const weights = new Float64Array(distinct);
  {
    let i = 0;
    for (const [color, weight] of counts) {
      colors[i] = color;
      weights[i] = weight > 0 ? weight : 1;
      i++;
    }
  }
  const order = new Uint32Array(distinct);
  for (let i = 0; i < distinct; i++) order[i] = i;

  const boxes: QuantBox[] = [{ start: 0, end: distinct, score: 0, axis: 0 }];
  measureBox(boxes[0]!, order, colors, weights);

  while (boxes.length < maxSize) {
    // Greedily split whichever box currently contributes the most error. A box
    // scoring 0 holds one colour (or several at the same point) and can never
    // be usefully split, so a flat field ends the loop early with fewer than
    // `maxSize` entries rather than emitting duplicate slots.
    let pick = -1;
    let pickScore = 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i]!;
      if (box.end - box.start < 2) continue;
      if (box.score > pickScore) {
        pickScore = box.score;
        pick = i;
      }
    }
    if (pick < 0) break;

    const box = boxes[pick]!;
    const axis = box.axis;
    const slice = Array.from(order.subarray(box.start, box.end));
    slice.sort((a, b) => channelOf(colors[a]!, axis) - channelOf(colors[b]!, axis));
    for (let i = 0; i < slice.length; i++) order[box.start + i] = slice[i]!;

    // Cut where the two halves' weighted squared error along `axis` is
    // smallest — the exact 1-D optimum, found in one pass over prefix sums
    // after the sort.
    //
    // This is the one place this deviates from textbook median cut, and it is
    // deliberate. A weighted-MEDIAN cut splits by population, so three tight,
    // well-separated colour clusters do not get one representative each: the
    // median lands inside the most populous cluster and cuts it in half while
    // two genuinely different clusters stay merged (reproduced, then fixed —
    // it left max error 237 on a three-cluster histogram that this rule takes
    // under 20). On smooth, gapless data — a Lambert ramp, the common case —
    // the two rules land in nearly the same place, so this costs nothing
    // there and rescues the clustered case, which is exactly what a
    // field-synth patch with flat colour regions looks like.
    let cut = box.start + 1;
    {
      let wAll = 0, sAll = 0, qAll = 0;
      for (let i = box.start; i < box.end; i++) {
        const idx = order[i]!;
        const v = channelOf(colors[idx]!, axis);
        const w = weights[idx]!;
        wAll += w;
        sAll += w * v;
        qAll += w * v * v;
      }
      let wL = 0, sL = 0, qL = 0;
      let bestError = Infinity;
      for (let i = box.start; i < box.end - 1; i++) {
        const idx = order[i]!;
        const v = channelOf(colors[idx]!, axis);
        const w = weights[idx]!;
        wL += w;
        sL += w * v;
        qL += w * v * v;
        const wR = wAll - wL;
        if (wL <= 0 || wR <= 0) continue;
        const errorL = qL - (sL * sL) / wL;
        const errorR = (qAll - qL) - ((sAll - sL) * (sAll - sL)) / wR;
        const error = errorL + errorR;
        if (error < bestError) {
          bestError = error;
          cut = i + 1;
        }
      }
    }

    const right: QuantBox = { start: cut, end: box.end, score: 0, axis: 0 };
    box.end = cut;
    measureBox(box, order, colors, weights);
    measureBox(right, order, colors, weights);
    boxes.push(right);
  }

  const palette: number[] = [];
  for (const box of boxes) {
    let wr = 0, wg = 0, wb = 0, total = 0;
    for (let i = box.start; i < box.end; i++) {
      const idx = order[i]!;
      const c = colors[idx]!;
      const w = weights[idx]!;
      wr += ((c >> 16) & 0xff) * w;
      wg += ((c >> 8) & 0xff) * w;
      wb += (c & 0xff) * w;
      total += w;
    }
    if (total === 0) continue;
    const r = Math.min(255, Math.max(0, Math.round(wr / total)));
    const g = Math.min(255, Math.max(0, Math.round(wg / total)));
    const b = Math.min(255, Math.max(0, Math.round(wb / total)));
    palette.push((r << 16) | (g << 8) | b);
  }
  // Two boxes can round to the same representative; dedupe so no slot is
  // wasted on a colour another slot already covers exactly.
  return [...new Set(palette)].sort((a, b) => a - b);
}

/**
 * Histogram the non-blank, colour-bearing cells of a rasterized grid. Cells
 * whose glyph is `" "`, whose colour is `null`, or whose colour isn't a
 * canonical `#rrggbb` are skipped — the last of those is already an
 * {@link isGlyphAtlasEncodable} rejection, so skipping it here only avoids
 * poisoning the histogram before that rejection is reached.
 */
export function histogramGridColors(
  char: readonly string[],
  color: readonly (string | null)[],
  n: number,
  into: Map<number, number> = new Map(),
): Map<number, number> {
  for (let i = 0; i < n; i++) {
    if (char[i] === " ") continue;
    const c = color[i];
    if (c === null || c === undefined) continue;
    const packed = packHexColor(c);
    if (packed === undefined) continue;
    into.set(packed, (into.get(packed) ?? 0) + 1);
  }
  return into;
}

/**
 * One-shot quantization: a grid's cells in, a ≤`maxSize` `#rrggbb` palette
 * out. Pure — no pooling, no clock. This is the testable core; a live scene
 * uses {@link createGlyphAtlasPaletteQuantizer}, which pools across frames on
 * top of exactly this.
 */
export function quantizeGlyphAtlasPalette(
  char: readonly string[],
  color: readonly (string | null)[],
  n: number,
  maxSize: number = GLYPH_FONT_ATLAS.maxPaletteSize,
): string[] {
  return medianCutPalette(histogramGridColors(char, color, n), maxSize).map(unpackHexColor);
}

/**
 * Anything that can answer "what palette should this grid encode against?".
 * A plain `readonly string[]` is a fixed palette; a source is a stateful
 * derivation (the pooled quantizer) that also gets to see each grid.
 */
export interface GlyphAtlasPaletteSource {
  /**
   * Palette for THIS grid, and — for a pooling implementation — an ingest of
   * the grid's colours for future refreshes. `undefined` means "no palette
   * available", which routes the caller to the span encoder.
   */
  resolveGlyphAtlasPalette(
    char: readonly string[],
    color: readonly (string | null)[],
    n: number,
  ): readonly string[] | undefined;
}

/** A fixed palette, or a source that derives one. See {@link GlyphAtlasPaletteSource}. */
export type GlyphAtlasPaletteInput = readonly string[] | GlyphAtlasPaletteSource;

/**
 * Resolve either form of {@link GlyphAtlasPaletteInput} to the palette a grid
 * should encode against. A `readonly string[]` passes straight through (no
 * derivation, no ingest — an explicit palette is the caller's to manage).
 */
export function resolveGlyphAtlasPaletteInput(
  input: GlyphAtlasPaletteInput | undefined,
  char: readonly string[],
  color: readonly (string | null)[],
  n: number,
): readonly string[] | undefined {
  if (input === undefined) return undefined;
  if (Array.isArray(input)) return input as readonly string[];
  return (input as GlyphAtlasPaletteSource).resolveGlyphAtlasPalette(char, color, n);
}

export interface GlyphAtlasPaletteQuantizerOptions {
  /** Slot budget. Defaults to the atlas's own `maxPaletteSize`. */
  maxSize?: number;
  /**
   * Minimum interval between repools. Default `250` — `bench/color-font-atlas.md`
   * §6's most accurate measured interval, and the one an orbiting camera
   * needs; a static camera is served by the drift gate long before the clock
   * matters. Values below 250 ms are clamped up: a sub-frame interval would
   * let two outputs of the SAME frame land on different palettes while
   * sharing one `font-palette` ident.
   */
  refreshMs?: number;
  /**
   * Redmean distance at which a cell counts as drifted. Default `32` — the
   * same units and the same value `/synth` ships as `colorTolerance`, so
   * "drifted" means "further from its slot than a merged span already moves".
   */
  driftThreshold?: number;
  /**
   * Extra fraction of a window's cells that must have drifted, ABOVE the
   * current palette's own baseline on its training window, before the clock is
   * even consulted. Default `0.002` — the 0.2% over-tolerance rate
   * `bench/color-font-atlas.md` §3 measured for a pooled N=32 palette and
   * judged acceptable. Measured against the baseline rather than against zero
   * so a palette that is already as good as 31 slots allows is not repooled
   * forever — see `repool`.
   */
  driftFraction?: number;
  /** Injectable clock, for tests. Defaults to `Date.now`. */
  now?: () => number;
}

export interface GlyphAtlasPaletteQuantizer extends GlyphAtlasPaletteSource {
  /** Current palette, or `undefined` before the first colour-bearing grid. */
  readonly palette: readonly string[] | undefined;
  /** Bumped on every repool — a cheap "has the palette changed?" for CSS sync. */
  readonly generation: number;
  /**
   * Open a render transaction: every {@link resolveGlyphAtlasPalette} until
   * the matching {@link endTransaction} returns the SAME palette, whatever
   * the clock and drift gates would otherwise decide. The first resolve
   * inside the transaction still gets to repool — it is only later resolves
   * that are pinned to its result.
   *
   * This exists because a scene's outputs do not resolve microseconds apart:
   * the base `<pre>` resolves at the end of base rasterization and each
   * detail `<pre>` at the end of its own pass, and they all reference ONE
   * `font-palette` custom ident. See the module doc.
   *
   * Optional for a caller that resolves one grid at a time (`compileScene`,
   * a one-shot bake): never opening a transaction keeps the pre-existing
   * per-resolve behaviour exactly.
   */
  beginTransaction(): void;
  /** Close the transaction opened by {@link beginTransaction} and drop the latch. */
  endTransaction(): void;
  /** Drop all pooled state (palette, pending window, memos). */
  reset(): void;
}

/**
 * Pooled, causal palette quantizer — the live-scene counterpart to
 * {@link quantizeGlyphAtlasPalette}. See the module doc for the pooling and
 * refresh policy and the measurements behind it.
 */
export function createGlyphAtlasPaletteQuantizer(
  options: GlyphAtlasPaletteQuantizerOptions = {},
): GlyphAtlasPaletteQuantizer {
  const atlas: GlyphFontAtlas = GLYPH_FONT_ATLAS;
  const maxSize = Math.max(1, Math.min(options.maxSize ?? atlas.maxPaletteSize, atlas.maxPaletteSize));
  const refreshMs = Math.max(250, options.refreshMs ?? 250);
  const driftThreshold = options.driftThreshold ?? 32;
  const driftThreshold2 = driftThreshold * driftThreshold;
  const driftFraction = options.driftFraction ?? 0.002;
  const now = options.now ?? Date.now;

  let packedPalette: number[] = [];
  let hexPalette: string[] | undefined;
  let generation = 0;
  let lastRepoolAt = 0;
  let pending = new Map<number, number>();
  // Nearest-slot distance memo, valid only for the CURRENT palette generation.
  let driftMemo = new Map<number, number>();
  let driftCells = 0;
  let windowCells = 0;
  // Drifted-cell fraction this palette scores on the window it was BUILT from
  // — its own irreducible floor. See `repool` for why this exists.
  let baselineDrift = 0;
  // Render-transaction latch. `inTransaction` is false for a caller that never
  // brackets its resolves, which is what keeps the standalone/one-shot
  // behaviour unchanged; `latched` holds the palette every output of the
  // CURRENT transaction must share. See `beginTransaction`.
  let inTransaction = false;
  let latched: readonly string[] | undefined;

  function repool(): void {
    if (pending.size === 0) return;
    const trained = pending;
    packedPalette = medianCutPalette(trained, maxSize);
    hexPalette = packedPalette.map(unpackHexColor);

    // Measure the new palette against its own training window. A render with
    // thousands of distinct colours (a photo) cannot be covered by 31 slots at
    // ANY threshold — some fixed fraction of its cells is always further than
    // `driftThreshold` from the nearest slot, no matter how good the palette
    // is. Comparing live drift against zero would therefore read that
    // irreducible floor as staleness and repool forever on a scene that never
    // changed (measured: 10 repools over 3 static seconds on
    // `/examples/image`, versus the 1 a static scene should cost). Comparing
    // against this baseline instead asks the question that actually matters —
    // "is the palette doing worse than it did on the colours it was built
    // for?" — which is false for a static photo and true for a hue that has
    // rotated away.
    let bad = 0;
    let total = 0;
    driftMemo = new Map();
    for (const [packed, count] of trained) {
      const idx = nearestPaletteIndex(packedPalette, packed);
      const d = idx < 0 ? Infinity : redmeanDistanceSq(packedPalette[idx]!, packed);
      driftMemo.set(packed, d);
      total += count;
      if (d > driftThreshold2) bad += count;
    }
    baselineDrift = total > 0 ? bad / total : 0;

    pending = new Map();
    driftCells = 0;
    windowCells = 0;
    lastRepoolAt = now();
    generation += 1;
  }

  return {
    get palette(): readonly string[] | undefined {
      return hexPalette;
    },
    get generation(): number {
      return generation;
    },
    beginTransaction(): void {
      inTransaction = true;
      latched = undefined;
    },
    endTransaction(): void {
      inTransaction = false;
      latched = undefined;
    },
    reset(): void {
      packedPalette = [];
      hexPalette = undefined;
      pending = new Map();
      driftMemo = new Map();
      driftCells = 0;
      windowCells = 0;
      lastRepoolAt = 0;
      latched = undefined;
    },
    resolveGlyphAtlasPalette(char, color, n) {
      const frame = histogramGridColors(char, color, n);
      // A blank grid contributes nothing and must not close the latch: an
      // off-screen detail layer would otherwise pin the whole transaction to
      // whatever palette existed before the frame that actually has colour.
      if (frame.size === 0) return latched ?? hexPalette;

      for (const [packed, count] of frame) {
        pending.set(packed, (pending.get(packed) ?? 0) + count);
        windowCells += count;
        if (packedPalette.length > 0) {
          let d = driftMemo.get(packed);
          if (d === undefined) {
            const idx = nearestPaletteIndex(packedPalette, packed);
            d = idx < 0 ? Infinity : redmeanDistanceSq(packedPalette[idx]!, packed);
            driftMemo.set(packed, d);
          }
          if (d > driftThreshold2) driftCells += count;
        }
      }

      // Ingest above always runs — a latched transaction still pools every
      // output's colours, so the window a later repool trains on is complete.
      // Only the DECISION is latched.
      if (latched !== undefined) return latched;

      if (hexPalette === undefined) {
        repool();
      } else if (
        driftCells > 0
        && driftCells >= windowCells * (baselineDrift + driftFraction)
        && now() - lastRepoolAt >= refreshMs
      ) {
        repool();
      }
      if (inTransaction) latched = hexPalette;
      return hexPalette;
    },
  };
}
