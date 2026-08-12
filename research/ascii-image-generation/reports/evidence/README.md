# Measurement evidence

`reports/evidence/raw/` is the production ingestion root. It intentionally
contains no placeholder report: `build:evidence` fails closed until all G0–G7
raw reports and their hashed source artifacts exist. The command stages and
atomically publishes `generated/summary.json`, `generated/differential-testing.json`,
`generated/visual-parity.json`, and `generated/performance-tracing.json`.

Every raw report is bound to a `metric-source-artifact/v1`: it must repeat the
artifact's signals exactly and record the pinned Chromium 140.0.7339.80,
WebGPU-only runtime, and LeDeluge RTX 4090 Laptop GPU (16 GB). A report cannot
self-author different values under a valid artifact hash.

The committed production-shaped test corpus is isolated at
`fixtures/evidence/production/`. Run it with:

```sh
pnpm --filter @glyphcss/ascii-image-generation build:evidence -- --fixtures --check
```
