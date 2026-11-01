# Line-fidelity bench

An offline measurement of how well glyphcss's line strategies draw a line, and how much better any glyph assignment could do. Nothing here changes package source or render output: the strategies run from the built packages (`packages/*/dist`).

Three parts:

1. **A scorer**: the rubric, on composited glyph rasters measured from the real site faces.
2. **A baseline**: every current line strategy, fed the way the library feeds it.
3. **The headroom**: a lookup-table baseline and a dynamic-programming oracle per test line.

Results are in [`RESULTS.md`](./RESULTS.md).

## Run

```bash
pnpm install --frozen-lockfile && pnpm build:packages
node bench/line-fidelity/run.mjs            # full run, ~4 min on 16 workers
node bench/line-fidelity/run.mjs --quick    # lines every 10°, 1 wiggle, ~1–2 min
```

Flags:

- `--force-rasters` re-measures the glyph masks.
- `--workers N` sets the worker-thread count. The default is CPUs − 2, capped at 16.
- `--M 48` sets the DP's per-node label pruning.
- `--static-only` skips phase 2 (animation + style). `--anim-only` reruns phase 2 against the cached static results (it reuses the fitted tables). `--report-only` rewrites RESULTS.md from `.cache/`.

Phase 2 takes about 15 min on 16 workers; the temporal DP over `all`/`braille` dominates.

Cached masks and the raw `results.json` go to `.cache/`, which is gitignored.

## Pipeline

| file | step |
|---|---|
| `rasters.mjs` | Glyph masks from **real DOM text** in headless Chromium (Playwright). Each glyph sits alone in a `<pre>` styled like `.glyph-output` (line-height 1, no ligatures or kerning) on a transparent page. One `omitBackground` screenshot is taken and alpha is used as coverage. Rendering is at 16 px and devicePixelRatio 4 (64 device-px em), at 4 sub-pixel x phases, on a canvas padded around the cell box so overflow ink is kept. Also produces the safe-set verdict per glyph and the compositing validation. |
| `woff2cmap.mjs` | Reads Glyph Mono's cmap from the WOFF2 (brotli). This shows which glyphs really come from the face rather than a fallback. |
| `composite.mjs` | Places each cell's mask at its offset, picks the phase nearest the fractional advance, sums, and clamps. |
| `geometry.mjs` | The test set, in visual space, converted to cell coordinates. |
| `strategies.mjs` | Adapters that call the real strategy entry points (see below). |
| `rubric.mjs` | The scorer and its weights. |
| `oracle.mjs` | The chain DP, the lookup table, and its fit. |
| `vocab.mjs` | The glyph families the table and DP are restricted to. |
| `worker.mjs`, `run.mjs`, `report.mjs` | Parallel driver and `RESULTS.md` writer. |

### Faces

The site draws lines in two faces, and both are measured:

- **GlyphCssAtlas**: the COLR atlas font (Menlo outlines plus DejaVu fallbacks, at Menlo's advance). This is what scenes and /maps draw on Chromium, where `defaultGlyphColorEncoding()` resolves to `"atlas"`. Cells are PUA code points (palette slot 0). Safe means the glyph is in `atlas.json`.
- **Glyph Mono**: the Cascadia Code subset in `website/public/fonts`. This is used by /charts, /diagrams and every `spans` fallback. Safe means the glyph is in the face's cmap.

In both faces a safe glyph must also have an advance equal to the cell (a 32-glyph DOM run) and draw real ink. A glyph outside a face would be drawn by a fallback font with its own advance, which desyncs the grid (`build-atlas.py` forces every fallback outline to the cell advance for exactly this reason). Those glyphs are never candidates, and a strategy that emits one is reported as unavailable on that face.

Cell metrics come from the DOM: the advance is the run width ÷ 32, the cell height is the line box (line-height 1), and the baseline is read from an inline-block marker.

**Validation.** A 10 × 5 grid of mixed box, braille, ASCII and block glyphs is rendered as one real `<pre>`, screenshotted, and compared with the composite of the single-glyph masks. The relative L1 error is in RESULTS.md. Before sub-pixel phases were added it was 11 %, because Chromium positions outline glyphs at fractional device px. With 4 phases it is 0.03–0.04 %.

### Strategies (current)

| name | entry point |
|---|---|
| `maps-ink` | `stampGlyphMapPolyline` with no `experimentalGlyphStrategy` (`inkGlyphForTangent` on each sample's segment tangent) |
| `maps-box` | the same with `"box"` (/maps `?lines=box`) |
| `maps-braille` | the same with `"braille"` (the /maps default), with a frozen surface copy as `widget.ts` passes |
| `scene-ink` | `rasterize` in mode `"ink"` on a fin mesh: the line extruded along view depth and seen head-on, so its boundary chains project onto the curve. This goes through ink mode's own silhouette chaining, tangent smoothing and `inkGlyphForTangent`. |
| `wire-default` | `rasterize` in `"wireframe"` with explicit edges, default palette, weight 2. The tier pick uses `Math.random`, so it is seeded. |
| `wire-junctions` | the same plus `wireframeJunctions` (`JUNCTION_GLYPHS`) |
| `wire-braille` | wireframe with `charMode: "braille"` |
| `canvas-box` | `createGlyphCanvas({ tier: "box" }).line()`, as used by charts line marks. Geometric (x, y) is passed as (x − ½, y − ½) because `line()` puts cell centres on integers. |
| `canvas-braille` | the same on the `braille` tier |

The scene camera is orthographic with rotX = rotY = 0, zoom 1 and cellWidth = cellHeight = 1, so world `[row, col, z]` projects exactly onto `(col, row)`. This is asserted at load.

### Test set

Angles and roundness are defined in visual px. Lengths are in cell widths (cw).

- **Straight lines**: 0–178° every 2°, × 4 sub-cell offsets (0, ¼, ½, ¾ of a cell on both axes), × lengths 6 and 20 cw. That is 720 lines.
- **Circles**: r = 3, 6 and 12 cw, at offsets 0 and ½.
- **Arcs**: the same radii, 30–150°.
- **Corners**: turns of 30°, 60°, 90° and 135°, × lead angles 0°, 20°, 45° and 70°, with 8 cw legs.
- **Wiggles**: 4 smoothed random walks, about 1 vertex per 1.5 cw (vector-tile density).

Junctions are **not** in v1.

## Rubric

Lower is better for every term. Each term is reported separately; the total is the weighted sum (`WEIGHTS` in `rubric.mjs`, change it there). R is the composited coverage image and P is the true curve, sampled every 0.05 cw.

| term | definition | weight |
|---|---|---|
| `chamfer` | Symmetric mean chamfer distance, in cw. Half is the coverage-weighted mean distance from ink to P (exact EDT of rasterised P). Half is the mean distance from each P sample to the nearest ink with R ≥ 0.3. Distances cap at 3 cw. | 1 / cw |
| `p95` | The larger of the two directions' 95th percentiles, in cw | 0.25 / cw |
| `gap` | Fraction of arc length that is a **break**: no ink (R ≥ 0.3) inside a 0.75 cw tube around P projects within ±0.25 cw of it along the arc | 2 |
| `maxGap` | Longest break, in cw | 0.25 / cw |
| `stray` | Fraction of ink mass farther than 0.5 cw from P | 1 |
| `angle` | Mean over covered samples of the angle between P's tangent and the principal axis of the ink's second-moment tensor in a 1 cw box. Each sample's error is coherence·Δθ + (1 − coherence)·45°, so a blob or dot scores like a random direction. | 1/45 per ° |
| `cv` | Coefficient of variation of ink mass per unit arc length, in 1 cw bins along P (ink assigned to its nearest sample within 0.75 cw) | 0.5 |
| `gapR` | Diagnostic only: the spec-literal gap, "no ink within 0.25 cw" | 0 |

Two deliberate deviations, both measured:

- **Gap is continuity, not displacement.** "No ink within 0.25 cw" scored a perfectly continuous run of `_` sitting 0.26 cw below a horizontal line as gap 1.0 and maxGap 20 cw. That is +7 total, bigger than every other effect combined. Displacement is what chamfer measures, so the spec version is kept as the unweighted `gapR`.
- **Angle uses ink inertia, not image gradients.** A gradient structure tensor reads each braille dot as an isotropic blob. It gave every dotted line 40–45° at any angle, even after σ = 0.15 cw pre-smoothing.

The weights make 45° of angle error ≈ 1 cw of mean displacement ≈ half the line broken. The rubric has no term for glyph-family consistency, absolute stroke weight or "looks like text". A DP output mixing braille with ASCII can score well and still look busier than the number says.

## Oracle

The chain DP is in `oracle.mjs`; its header documents exactly which rubric terms are exact, approximate or omitted.

- **Nodes.** One per cell the curve visits, in arc order.
- **Labels.** Blank, or (δ ∈ {−1, 0, +1} along the node's minor axis) × K safe glyphs. That gives the 1-cell band, 3K + 1 labels.
- **Pruning.** Each node keeps the M = 48 best labels by solo cost, plus blank. RESULTS.md reports a 3M re-run on a subset.
- **Unary terms.** Ink→P distance and stray (normalised by an ink mass re-estimated over 3 Dinkelbach-style rounds), the glyph's inertia orientation vs the tangent, and node ink vs the mean density (for evenness).
- **Pair terms.** Each P sample is charged to its own node and the neighbour on its side. Its distance is the nearer of the two labels' ink, and it counts as covered if either label's ink passes the rubric's break test. Two non-blank labels may not share a cell.
- **Omitted.** p95, maxGap, and the effect of ink from nodes two or more steps away.
- **Re-score.** The output is always re-scored with the full rubric, and each round keeps the best.

Because the decomposition is approximate, the DP is a heuristic optimum. It does not always beat the incumbent. RESULTS.md counts the cases where it loses, and reports **best known** as the per-case minimum over the DP, the table and the incumbents.

**Lookup table.** The key is (16 angle buckets in visual space, band axis, 8 bins of the cell centre's offset from the line along the minor axis). The table puts one glyph, or blank, on each visited cell, with no shift and no DP. It is fit by coordinate descent on the same surrogate over a training subset (lines every 10° plus every curve) and evaluated on every case with the full rubric. That is in-sample for about a quarter of the lines, so treat it as a capacity estimate.

## Phase 2: animation and style

`anim.mjs`, `animWorker.mjs`, `animRun.mjs`, `animReport.mjs`, `style.mjs`.

- **Sequences.** Eight 60-frame sequences: diagonal drift at 0.05 and 0.3 cell/frame (20° and 65°), rotation at 0.5°/frame and 3°/frame, a circle growing r 4 → 8 cw, and a drifting wiggle. Every frame uses one shared grid and is rendered independently. `wire-*` gets a fresh random seed per frame.
- **Temporal metrics.**
  - Change rate.
  - Unjustified flips: a change while the curve inside the cell, grown by ½ cell, moved < 0.1 cell since that cell last changed. It is judged since the last change, not the last frame, so a 0.05 cell/frame drift is not all-unjustified.
  - A→B→A flicker within 3 frames.
  - RMS ink-centroid velocity error.
- **Temporal DP.** This is the static DP plus a causal unary λ·[glyph ≠ previous frame's chosen glyph at that cell], plus λ for vacating a previously inked cell. λ ∈ {0, 0.005, 0.02, 0.08}.
- **Table hysteresis.** A cell keeps its previous glyph unless the fitted table's glyph beats it by margin m on the surrogate solo cost.
- **Style.** The fraction of a stroke's cells outside its majority visual family (dots / strokes / blocks / symbols). It is reported beside the static total, never inside it. *DP all + style* runs the DP per majority family with an exact per-cell penalty and keeps the best on total + style.

## Limits

- Junctions, dashes and styles, stroke widths, colour, and depth occlusion are all out of scope.
- One font size (16 px at DPR 4) is used. Smaller cells change the anti-aliasing, not the shapes.
- Ink-mode input is a synthetic fin mesh, not an authored model.
