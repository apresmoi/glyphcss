# @glyphcss/effects — package agent guide

Stock effect definitions over glyphcss's generic effect protocol: matrix rain, flow text, scan, wipe, scramble, glitch, noise dissolve, ripple, field synth, grid decal, `GlyphRamps`, ramp calibration, and the field-synth static export.

## Rules

- Owns no clock. Apps drive `params.time`.
- Depends on `glyphcss`; glyphcss never imports this package.
- Field-synth schema key families are append-only; the `/synth` URL codec decodes positionally.
- Every `validateParams` throw carries a rule id from `GLYPH_FIELD_SYNTH_VALIDATION_RULES`.
- `buildGlyphFieldSynthStaticExport` must match the real renderer byte-for-byte; keep `isGlyphFieldSynthStaticExportSupported` in sync with its rejects.

## Don't

- Don't read a dynamic or optional requirement buffer unguarded: it is `undefined` whenever the live params or render mode don't retain it.
- Don't emit box-drawing glyphs from an effect: common monospace faces lack them and a fallback advance desyncs the grid. Use plain ASCII strokes, as `subcellRes: "ink"` does.
- Don't expect the static exporter to generalise: each effect needs its own inlined-JS port verified byte-exact, since an arbitrary `evaluate()` cannot ship without the effect runtime.
