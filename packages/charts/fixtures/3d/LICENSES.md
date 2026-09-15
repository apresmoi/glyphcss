# `packages/charts/fixtures/3d/` — provenance

Real, vendored copies of the same two datasets `website/src/components/ChartsWorkbench/datasets/chart3d/` ships — `@glyphcss/charts` cannot import from `website/`, so these are independent copies of the identical numeric data, not derived from the website module.

- **`maungaWhauVolcano.json`** — Maunga Whau (Mt Eden), Auckland, 87x61. Source values captured from the plotly/datasets repo's `volcano.csv`. Two licences apply to two different things: Plotly's own file packaging (the csv this was captured from) is MIT; the dataset's governing provenance is R's base `datasets` package, licensed GPL-2 | GPL-3 — R's own docs (`?datasets::volcano`) record it as "digitized from a topographic map by Ross Ihaka". `x`/`y` are metres on the source map's own local grid (column/row index x 10 m); `z` is the map's own height units (94..195).
- **`etopo1Alps.json`** — a 36x31 window of the site's own baked ETOPO1 elevation pyramid (`website/public/data/geo-tiles/`, NOAA ETOPO1, public domain), around the Matterhorn (45.9763N, 7.6586E), stride-2 downsampled from the curated Switzerland z7 tile's own 181x91 vertex grid.

Both are used by `packages/charts/src/3d/axisOriginCorner.test.ts` (C2 fix round 7's gates) and by `docs/design/charts3d.md`'s "C5" rendered frames.

- **`syntheticClusters3d.json`** — 72 points, 3 gaussian clusters (seeded `mulberry32`, deterministic) around `(-3,-3,-3)`, `(3,2,-1)`, `(0,3,4)`. SYNTHETIC, not real data — the task's own fallback when a real dataset's licence can't be verified from a primary source offline; `glyphChartScatter3d`'s C5 example (`docs/design/charts3d.md`'s "C5").
- **`syntheticRevenue3d.json`** — 12 rows, 3 regions x 4 quarters, a deterministic seeded synthetic "revenue" figure. SYNTHETIC, not a real table. `glyphChartBars3d`'s C5 example.
