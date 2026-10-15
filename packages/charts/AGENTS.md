# @glyphcss/charts — agent guide

## What it is

Cell-canvas plots (ascii/box/blocks/braille); no 3D pipeline.

- **Model:** `buildGlyphChart(input, options)`: validate → transforms → scales → layout → paint → `GlyphChartBuild` (`canvas`, `colorCanvas`, `plot`, `meta`, `report`, `resolved`), no strings.
- **Encode:** `encodeGlyphChart(build, "text" | "html")`; `renderGlyphChart` composes both.
- **`./3d`:** surface/scatter/parametric/bars/line → `GlyphSceneObject`s via `compileScene`; may import root helpers, never the reverse.

## Invariants

- Ledgers: `ledger.ts` (3D: `src/3d/ledger.ts`); kebab codes, sentence messages, structured details.
- `GLYPH_CHART_VALIDATION_RULES` supplies ids/hints; schema derives from `validate.ts`; keep Ajv parity. Runtime data checks (`mixed-x-scale`, `sankey-cycle`) are tagged errors, not rule entries.
- 3D uses `GLYPH_CHART_3D_VALIDATION_RULES`; no 3D codes in root validation/table.
- Defaults stay byte-identical; pin parent fixtures (`src/reviewFixtures.ts`) and `goodSpecs`.
- `textScale` scales text AND fixed cell-count geometry (tick budgets, sankey/funnel widths, gaps and padding, callout gutters). Data-proportional quantities never scale.
- Only colour exits read solid `regionFill`; `build.canvas`/plain text keep textures.
- Paint text through `canvas.text`, never direct grid writes. Numeric labels use SI or drop, never truncate.
- `textScale`: web HTML only; text/ANSI ignore it.
- Effects/3D: preview-only; no Copy/CLI/JSON.
- A bar/area value domain includes zero, except floating intervals; explicit zero-excluding domains reject. Log domains keep one sign.
- Sankey/funnel/treemap are non-cartesian: no x/y scales or transforms (`bad-options`).
- `cell`-only + two band scales: heatmap (`heatmap.ts`), flush integer-partitioned `2k`×`k` cells; shrink canvas to grid. An unsigned heatmap's ramp has no blank level and a range key; a signed one keeps blank for exactly zero.
- 3D: the axis-triad origin is the fixed data-min corner; axis lines are real mesh geometry (a fine sub-cell line), never stamped glyphs; `p.texture` uses the namespaced object sampler key; the static exit must round-trip `resolved.camera`.
- Journey: compact 0–5 task bars with score/actors beside them. Left section headers; one blank between sections, none between tasks. Wrap words; long actors under bars. Log omissions and face/timeline fallback. Auto-height fits. Never use actors/sections as bands.
- Mermaid: `@glyphcss/core/mermaid` preamble/entities/comments; own tokenizer. Inert config: `mermaid-degraded`. Native marks; keep directive prefixes. Errors: `GLYPH_MERMAID_SYNTAX` / `GLYPH_MERMAID_NOT_CHART_TYPE`; source ledger in both reports. Folds: `label-folded` (role/before/after), before wrapping. Strip `%%` comments/directives before label protection/recognition; preserve quoted/CSV/free-title literals and treemap indentation. Only journey/timeline have `#` comments; timeline event/title/section tokens retain hashes. Journey empty scores use the logged clamp. XY spans its range from implicit x=1; horizontal XY swaps bars/lines; quadrant endpoints replace 0/1 ticks. Reuse `resolveSankeyRows`; cycles become flow lists.
- Bars stay vertical by default. Horizontal: value x/category y; `x0` starts intervals, otherwise include zero. Bars/labels share integer rows: label on first bar, contiguous series, one scaled blank row/group when room; no transforms. Sub-cell intervals become dots (`bar-interval-collapsed`). Band axes/legends follow content, spare rows trail. Line/area/vertical plots and treemaps keep proportional height.
- Gantt: calendar durations/exclusions, latest `after`/earliest `until`, forward refs, rowless `vert`, status labels. Column-zero sections; tasks indented two cells/right-aligned; contiguous rows, one blank before later sections. Native time/bar geometry; authored rows never thin as ticks. Tick candidates use the coarser date/axis format precision before label layout (local calendar, DST-aware). Hidden/empty ticks never count as thinned. Log milestone dots, approximate ticks, unshaded exclusions and inert today/layout settings. Clock-free: partial dates use 1970; missing starts use epoch, logged.
- Radar: ids/labels, positional/keyed curves, min/max, grids/ticks/legend. Box/ascii use grouped horizontal bars; braille/blocks use aspect-correct scales, precise lines, 256-segment circles, every spoke, solid curves/swatches, lettered vertices; omit interior tick values. Log these fallbacks, missing/clamped values and straight unfilled curves. Treemap: unique acyclic ids, finite nonnegative leaves, branch sums, aspect-aware squarify; invalid hierarchies use `treemap-hierarchy`. Siblings share borders/junctions; children share parent sides/bottom. Labels reserve a scaled blank cell inside each side border. Omit tiny tiles/unfittable whole labels (`treemap-omitted`); value configuration stays inert, logged.
- Structure annotations survive shallow copies, not JSON; auto-height fits, explicit height logs omitted groups. Timeline: authored periods vertical, indented two cells under column-zero headers; one blank row between sections, none inside. Events beside periods; only whitespace-followed colons split events, retaining times/URLs. Wrap words, honor `<br>`; stack narrow columns with the same indent; log oversized words. Packet: 32-bit rows, ascending absolute vertical decimal ticks, sharp shared borders (OR masks), whole-word labels and numbered keys (stack multi-digit keys). Log narrower rows, inert config, overlaps, invalid ranges and the 256-row field cap.
- Kanban: preserve indent, skip blanks; title/accessibility only unindented, nested data stays data. Hashes/label `%%` are data. Bare/anonymous/repeated ids keep occurrences. Single-quoted backslashes are literal. Sharp lanes/cards; whole words; minimize wrapped card rows; wrap lanes, logged. Shared lane bottoms; empty-body row only if empty. Metadata: ticket, assigned, priority. Log inert URLs.
- Legends: three swatch cells + blank on every tier/placement.

## Don't

- Don't default chat to braille/colour: fonts lack braille; paste drops ANSI. `TargetPreview` enforces both.
- Don't gate `isHtml` on target; `TargetPreview` decides what each frame shows.
- Don't paint glyph `<pre>` with `font-family: inherit` or `line-height` above 1: the shell lacks Glyph Mono, and `█` must overlap rows to read solid.
- Don't swap region glyphs after painting for solid fills; repaint with `regionFill: "solid"` into a second canvas that only colour-carrying exits read.
- Don't use `grid.char !== " "` as coverage; `canvas.ink` is coverage (a painted blank counts).
- Keep `textScale` integral; round density/font size/width together.
- Don't copy dense grids; ASCII/ANSI Copy uses density 1 at the measured viewport.
- Probe `chartsBuildBoundMark`; don't duplicate mark-fit rules or clean rows at render time (`?c=` must byte-match).
- Keep dataset ids (`CHARTS_DATASET_ID_ALIASES`), Random order and `Math.random()` draw count.
- Don't remount 3D on mark/colour changes; use handle `update()` and `scene.setOptions` to preserve camera.
- Don't pass `rotX`/`rotY` with `mat` to `renderGlyphChart3d` (`bad-camera`), and don't hand-roll 3D rasterization instead of `compileScene` (a raw sampler key hides there).
- Don't put notes in renders; use Dock `disabledReason` or frame chrome.
- Sankey: no filled ribbons; use stubs, a bracket and one line/flow (`sankeyLines.ts`).
- Don't texture funnel stages or size them linearly; one solid shape with √value widths, a blank row between stages and one label line each keeps late stages visible and readable (`paintFunnelMark`).
- Keep sankey's row-monotonicity bound ≥2; reclaim and fold-stub each cost a row.
- Don't narrow `RangeSlider` native `min`/`max`; cap only on commit, keeping thumb/fill aligned.

## Gates

- Tests, parent fixtures/schema parity.
- 3D: render/schema, surface, axis origin, per-axis options.

Vitest pins `Europe/Berlin` for local-calendar output.
