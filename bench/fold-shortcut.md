# min/max fold short-circuit — foldVoices and evaluateFieldProgram

`foldVoices` (per-voice fold) and `evaluateFieldProgram` (cross-layer fold),
both in `packages/effects/src/fieldProgram.ts`, always evaluated every active
voice and every layer, even under a `min`/`max`-bounded fold where a later
voice or layer provably cannot move the running value once it hits its
bound:

- Every voice sample is within `[-1, 1]` regardless of field/wave/override
  kind — `sampleFieldVoice`'s own doc ("One voice -> value in ~[-1, 1]"),
  confirmed across every branch (linear/radial family, `noise`'s `2n-1`, and
  the SDF family + `rawOverride`, both of which route through the same
  `synthWave` shaping every other field uses).
- A `thresholdOn` layer's shaped output is always exactly `+-1`,
  unconditionally, regardless of that layer's own combine/amp/voice count —
  the `v = v > threshold ? 1 : -1` clamp doesn't care what `foldVoices`
  returned.

Once a `min` fold reaches `<= -1` (or a `max` fold reaches `>= 1`), every
remaining voice/layer's contribution is a convex-combination delta of
exactly 0 — **for any `amp`, even `amp > 1` from an unclamped hand-built
program** (`combineSynth("min", locked, o) === locked` whenever `o >= locked`
and `locked <= -1`, so the mix-weight delta `amp * (combine - locked)` is
`amp * 0 = 0`) — so the remaining voices/layers can be skipped outright
without changing the result.

Two short-circuits, at the two places this fold happens:

1. **`foldVoices`** (per-voice, within one layer): fires when that layer's
   own `combine` is `"min"`/`"max"`. Never fires under `"argmax"`
   (categorical, not value-folding).
2. **`evaluateFieldProgram`** (cross-layer): fires when a `thresholdOn`
   layer's `blend` is `"min"`/`"max"` and the stack is already locked from a
   prior layer — skips that layer's entire `foldVoices` call (every one of
   its voices), not just a partial voice list. Deliberately conservative: a
   layer WITHOUT `thresholdOn` has no unconditional output bound (an `add`
   fold, or an unclamped-amp voice, can exceed `+-1`) and is never skipped,
   even if its own `combine` happens to be `min`/`max` — this needs no
   amp-range assumption to stay exact.

`active` (drives the empty-layer-skip rule) is derived from `amp > 0` alone
in both cases — a cheap pre-scan, never from evaluating a voice — so skipping
never corrupts it.

## Why both short-circuits are needed on the real preset

The Menger membership recipe `GlyphCssGraphicsMengerPreset` inlines (stock.ts
— the same recipe a standalone "Menger sponge" preset used to ship before a
later preset cull removed it, see AGENTS.md's "Preset named exports") folds
each layer's 3 voices with
**`combine: "add"`** (unbounded — short-circuit 1 does NOT fire there) but
sets **`thresholdOn: true`** on every layer, cross-layer-folded with
**`blend: "min"`** — that's short-circuit 2's target, not short-circuit 1's.
Short-circuit 1 matters for a different, real, supported case: a patch that
sets a layer's own voice `combine` to `"min"`/`"max"` directly (field-synth
exposes `layerCombineN` in the schema).

## Measured: `bench/fold-shortcut.mjs`

The real recipe the preset compiles to (3 layers x 3 axis voices, `add`
combine, duty-1/3 square wave, threshold+invert, `min` blend — freq 1/3/9,
matching `GlyphCssGraphicsMengerPreset`'s own field1/field4/field7), hand-built via
the public `buildGlyphFieldProgram` (verified structurally identical to the
real compiled IR by `fieldProgram.test.ts`'s own builder-equality test).
400,000 sample points over `[0,1]^3` via an irrational per-axis sequence (no
periodic aliasing against the duty-1/3 lattice). "Before" is a faithful,
UNMODIFIED reimplementation of the pre-shortcut fold, calling the REAL
`sampleFieldVoice`/`combineSynth` (temporarily re-exported for this run only
— see the script's own header comment for exactly what to revert) so the
timing comparison isn't skewed by a cheaper stand-in function; "after" is the
real, unmodified, shipped `evaluateGlyphFieldProgram`. Both run in the same
process, back to back, on the same points. Apple Silicon laptop, Node 22,
warm build:

```
voice evals (before, no shortcut): 3,600,000 (= 400,000 x 9, every voice always evaluated)
voice evals (after, shortcut):     2,747,202 (23.7% saved)

ms/evaluate (before, no shortcut): 0.00017-0.00018
ms/evaluate (after,  shortcut):    0.00014-0.00015
speedup: ~1.17x-1.29x (3 runs)
```

23.7% fewer voice evaluations on this preset (all from short-circuit 2 — the
cross-layer skip; short-circuit 1 never fires here, since the per-layer
combine is `add`) shows up as a real, reproducible **~17-25% per-`evaluate()`
speedup**, not just a lower count that doesn't move wall time — the eval
count saving is real work skipped (trig-heavy `synthWave` calls), not
overhead that was already dominated by something else.

This is a smaller win than a layer whose own voice `combine` is directly
`"min"`/`"max"` would see from short-circuit 1 alone (that case can skip
mid-layer, voice by voice, not just whole-layer blocks) — the real preset's
`add`-then-threshold shape only lets the cross-layer, whole-layer-at-a-time
skip fire, and only after at least one full layer (3 voices) has already
been evaluated to establish the lock.

## Correctness

Every existing `fieldProgram.test.ts`/`stock.test.ts` acceptance test
(digit-rule Menger/Sierpinski membership on a 27^3 grid, the SDF-family
equivalence bar, every shipped preset's own tests) is unchanged and green
with both short-circuits active — including tests that already exercise the
exact `thresholdOn` + `blend: min` multi-layer shape this bench targets.
`fieldProgram.test.ts`'s own `"foldVoices min/max short-circuit"` describe
block adds a direct A/B (real evaluator vs. a from-scratch, shortcut-free
reimplementation) across min-fold, max-fold, argmax (including an explicit
tie), `amp < 1` (both at the per-voice and per-layer level), a multi-layer
thresholded patch, an SDF/`step` patch, and a noise patch — every case
byte-identical.
