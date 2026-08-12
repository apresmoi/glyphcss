# References

Seeded from the prior-art survey in `/PRIOR_ART.md` and from the shipped
implementation; extend with real papers/repos as the subpaths are researched.

- `packages/glyphcss/src/render/rasterize.ts` — `rasterizeInk`, its shared-edge
  adjacency map, the `area2 <= 0` facing convention, and `inkGlyphForTangent`.
- `packages/fonts/src/extrude.ts` — `groupShapes` and the contour → shape step;
  this is where contour polylines exist BEFORE fill triangulation.
- `packages/core/src/scene/featureEdges.ts` — `trianglesToEdges` / feature-edge
  angle threshold, the current source of wireframe (and therefore braille) edges.
- `/PRIOR_ART.md` — MonoSketch (box-drawing junction resolution) and mapscii
  (braille sub-cell rasterization), the two surveys that motivated these modes.
- (to add) Prior art on analytic silhouettes of extruded 2D shapes / prism
  silhouette computation — not yet researched. **(unverified)**

## Prior-art mining pass: braille rasterisation (2026-08-02)

Read-for-mechanism only, per repo-clone licence. No code, tables, or data copied;
findings below are paraphrased mechanism descriptions with file:line pointers into
`research/_prior-art/`.

### mapscii — MIT (Michael Straßburger + MapSCII authors)

- `research/_prior-art/mapscii/src/BrailleBuffer.js:32-99` — canonical drawille dot
  layout (`brailleMap`, a `[[0x1,0x8],[0x2,0x10],[0x4,0x20],[0x40,0x80]]` 2×4 table
  identical in shape to ours), `_project` packs `(x,y)` to a cell index by `x>>1,
  y>>2`, `_locate` ORs the dot mask into a `Buffer`-backed `pixelBuffer`. Pure
  bitmask, no coverage/AA — confirms this is a solved, trivial data layout, same
  conclusion we'd already reached.
- `BrailleBuffer.js:101-134` (`_mapBraille`) — a **non-braille fallback**: for
  every possible 8-bit dot pattern, picks the best-matching glyph from a tiny
  fixed ASCII/block set (`▀ ▄ ■ ▌ ▐ █`, see `asciiMap` at line 19-29) by raw
  **popcount overlap** (`utils.population(mask.mask & braille)`), no coverage
  weighting, ties broken by object insertion order. This is argmax-by-popcount,
  materially the same family of technique as chafa's per-cell argmin (already
  mined and ruled out) — nothing new, just a much smaller glyph set and a
  cruder tie-break.
- Colour: `BrailleBuffer.js:75-79` (`setPixel`) ORs the dot bit into
  `pixelBuffer` **and unconditionally overwrites** `foregroundBuffer[idx]` with
  the incoming color. There is no depth or blending: when two draw calls land
  dots in the same cell, dots accumulate (bitwise OR) but the cell's single
  foreground colour is **last-write-wins** — whichever draw call touched that
  cell most recently owns the colour for every dot in it, including dots set by
  an earlier call. There is no per-dot colour and no notion of occlusion;
  mapscii is a flat 2D map renderer with no depth buffer at all. This directly
  answers Q1's colour-resolution question: they don't resolve it, they just
  let the last write win. Our depth-tested resolution (pick winning geometry
  per cell before rasterizing, one colour per cell) is already strictly better
  and there's nothing to adopt here.
- `research/_prior-art/mapscii/src/Canvas.js:37-46` (`line`/`polyline`) and
  `Canvas.js:94-146` (`_line`) — line drawing is delegated to the `bresenham`
  npm package for the zero-width case (`Canvas.js:96-99`), i.e. plain
  Bresenham, no anti-aliasing. For width > 1, `_line` implements a **thick-line
  variant** explicitly credited to Alois Zingl's "The Beauty of Bresenham's
  Algorithm" (comment at `Canvas.js:92-93`): it walks the same Bresenham error
  term but at each step also walks perpendicular to the primary axis while the
  accumulated error stays under `ed * width` (`ed = hypot(dx,dy)`), thickening
  the line symmetrically. This is a genuine technique we don't have — glyphcss
  wireframe edges are always drawn at a fixed "one dot/cell wide" weight; a
  Zingl-style perpendicular-thickening pass is a real option for a future
  "line weight" wireframe/braille feature. Not line-continuity-across-cells
  though — it thickens, it doesn't help two adjacent cells' strokes join up.
  Polygon fill (`Canvas.js:57-86, 148-197`) triangulates with `earcut` then
  scanline-fills via three Bresenham edge walks sorted by y — irrelevant to us
  (we already scanline/depth-test triangles natively).
- **Continuity across cells / angle disambiguation (Q4):** nothing. mapscii
  never resolves same-weight-glyph ties by angle, and doesn't do anything
  special to keep a diagonal line's dots visually continuous beyond plain
  Bresenham's usual guarantee of one dot per column/row step. No solution to
  our open problem here.
- **Verdict: nothing new for our core braille encoding.** The one artifact
  worth a future look is the Zingl thick-line perpendicular-walk for an
  eventual "line width" option — orthogonal to the continuity problem we
  actually have open.

### drawille — **AGPL-3.0** (Adam Tauber). Copyleft — mechanism-read only, nothing may be adapted verbatim; even paraphrased structure should be treated as inspiration-of-last-resort given the licence.

- `research/_prior-art/drawille/drawille.py:43-46` — the same canonical
  `pixel_map` 2×4 dot-bit table as mapscii/ours. `set`/`unset`/`toggle`
  (`drawille.py:116-165`) just OR/AND-NOT/branch on a Python `defaultdict`
  keyed by `(row, col)`, storing one int bitmask (or a literal text char, for
  `set_text`) per cell. This is, bluntly, the textbook trivial bitmask
  implementation — there is no coverage, no anti-aliasing, no color at all
  (drawille predates color support; mapscii's `BrailleBuffer` is a fork that
  *added* color, per mapscii's own file header at `BrailleBuffer.js:7-9`).
  Confirms Q2's expected answer.
- `line()` (`drawille.py:258-288`) is a float-interpolated Bresenham-like
  stepper (`r = max(xdiff, ydiff)` steps, lerp x/y by `i/r`), not the
  integer-error-term classic Bresenham — functionally equivalent, no
  antialiasing, no coverage.
- **Verdict: nothing new.** Confirms drawille is exactly the minimal reference
  bitmask implementation everyone else (including mapscii) builds on; we
  already have an equal-or-better version (endpoint-order-independent,
  4-connected `drawSubcellLine`, integrated with depth-tested occlusion).

### ascii-art (khrome) — MIT (Abbey Hawk Sparrow)

- The depth-1 clone at `research/_prior-art/ascii-art` is the **CLI/composition
  layer only** (`art.js`, 579 lines) — it requires `ascii-art-image` as an npm
  dependency (`art.js:16-22`) for the actual pixel→braille/lineart mechanism,
  and that package's source is **not present in this clone** (no
  `node_modules`, no vendored copy — confirmed via `find`/`grep`). `art.js`
  itself only calls through to `image.writeLineArt(...)` (`art.js:315-317`);
  it contains no braille/threshold/dither logic of its own. Being honest: the
  actual "how do the dots get chosen" mechanism for this family is not
  answerable from what's on disk, only from documentation.
- What IS answerable, from `research/_prior-art/ascii-art/README.md:224-277`:
  the public contract is a single **user-supplied, non-adaptive threshold**
  (`threshold: 40` in the example at README.md:239, explicitly documented as
  "0-255" at README.md:271/273) — i.e. one fixed cutoff the caller picks, no
  auto-threshold, no per-region adaptation, and — per the README's own prose —
  **no dithering** is mentioned anywhere in the option set. `lineart` (block
  characters) and `stipple` (braille) are two independent boolean output modes
  keyed off that same threshold; `posterize`/`blended` layer stipple over a
  separately-quantized colour background rather than changing how the
  threshold itself works. This directly answers Q3: their "threshold-based
  detail control" is exactly what it sounds like — a fixed manual cutoff, same
  category as our fixed `> 0.5` in field-synth, just user-exposed as a CLI/JS
  option rather than hardcoded. **No dithering, no adaptivity** — so this
  doesn't surface the error-diffusion idea we were wondering about; if we want
  dithered braille thresholding, no prior art examined in this pass provides
  it and it would be net-new work (Floyd–Steinberg or ordered dithering against
  the coverage buffer before the `>threshold` test is a well-known generic
  technique, not something mined from any of these repos).
- **Verdict: partially new to us (the "expose threshold as a tunable knob"
  packaging), but the actual interesting mechanism (dithering, adaptive
  detail) is absent from this repo and unverified anywhere in this pass.**

## Summary — ranked recommendation

1. **Nothing worth adopting for braille dot-selection itself.** All three
   braille implementations mined (mapscii, drawille, and ascii-art's public
   contract) use the identical trivial 2×4 bitmask with no coverage weighting,
   no anti-aliasing, and no cross-cell continuity handling. Our
   `drawSubcellLine` (endpoint-order-independent, 4-connected) is already at or
   above this bar. **Dead end — do not re-derive.**
2. **The "continuous thin line across cells" and "pick among same-weight
   glyphs by angle" problems remain fully unsolved by everything read in this
   pass.** mapscii/drawille don't attempt it (flat Bresenham dots, no
   junction/continuity pass at all); ascii-art's public docs don't describe
   the internals. This is still our own problem to solve, most likely via
   `ink`'s tangent-smoothing approach (already shipped) generalized rather
   than anything found here.
2b. Colour-per-cell-with-two-features conflict: mapscii's answer is
   last-write-wins with no depth notion at all. Our depth-tested single-colour
   resolution is already a strict improvement; nothing to change.
3. **(Low priority, speculative, not from any mined repo) Dithering the
   braille/halfblock threshold** (Floyd–Steinberg or ordered/Bayer dithering
   applied to the supersampled coverage buffer before the fixed `>0.5` cut)
   is a generic technique, not sourced from mapscii/drawille/ascii-art — none
   of them do it — so if pursued it should be logged as an independently
   motivated idea in `ideas/log.md`, not attributed to this prior-art pass.
4. **(Low priority, orthogonal to this direction) Zingl-style perpendicular
   line thickening** (mapscii `Canvas.js:94-146`) is a real, distinct
   technique for a future wireframe/braille "line width" option — but it
   solves thickness, not continuity, so it doesn't address the open problem
   this direction cares about. Worth a one-line mention in a future
   line-weight subpath, not urgent here.
