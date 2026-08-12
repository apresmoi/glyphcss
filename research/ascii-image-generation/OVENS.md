# Measurement Ovens

The Burnlist Ovens are read-only views, not the measurement system. B25 owns
the schemas, raw artifacts, thresholds, hash checks, and normalized summaries.
The adapters here preserve that boundary: a bound payload is generated from a
read-only B25 JSON document and carries its source hash and source path.

`differential-testing` renders the B25 differential summary; `visual-parity`
renders a one-pixel status transport marker for B25's visual summary; and
`performance-tracing` renders the B25 performance summary. The visual marker
is deliberately not a screenshot-quality claim. The performance fixture is a
runtime-contract transport fixture, not a substitute for a raw browser trace.
Production binding remains prohibited until real capture supplies the required
image/trace material.

`glyph-generation-gates` is a local custom Oven. It only lists G0–G7 fields
and their already-computed source links. Its pointer validation cannot prove
the metrics: `build:evidence` and the project schemas remain authoritative.

Recreate the local, ignored Oven state after a clean checkout:

```sh
pnpm --filter @glyphcss/ascii-image-generation build:evidence -- --fixtures --check
pnpm --filter @glyphcss/ascii-image-generation build:ovens
burnlist oven create glyph-generation-gates --dir research/ascii-image-generation/fixtures/ovens/glyph-generation-gates --repo "$PWD"
burnlist oven set differential-testing research/ascii-image-generation/fixtures/ovens/production/differential-testing.json --repo "$PWD"
burnlist oven set visual-parity research/ascii-image-generation/fixtures/ovens/production/visual-parity.json --repo "$PWD"
burnlist oven set performance-tracing research/ascii-image-generation/fixtures/ovens/production/performance-tracing.json --repo "$PWD"
burnlist oven set glyph-generation-gates research/ascii-image-generation/fixtures/ovens/production/generation-gates.json --repo "$PWD"
pnpm --filter @glyphcss/ascii-image-generation check:ovens
```

The checker pins the shipped Oven revisions, exact binding paths, runtime
validators, B25 source hashes, every B25 metric mapping, and deliberate
non-green and stale fixture paths. It restores production-shaped fixture
bindings after testing the failure fixtures.
