# @glyphcss/charts — agent guide

- `buildGlyphChart`: validate → transforms → scales → layout → paint → build, no strings.
- `encodeGlyphChart(build, "text" | "html")`; `renderGlyphChart` composes.
- `./3d`: `GlyphSceneObject`s via `compileScene`; imports root helpers, never reverse.

## Invariants

- Ledgers: `ledger.ts` (3D: `src/3d/ledger.ts`); kebab codes, sentences, details.
- `GLYPH_CHART_VALIDATION_RULES` owns ids/hints; `validate.ts` schema keeps Ajv parity. `mixed-x-scale`/`sankey-cycle`: tagged errors.
- 3D codes: `GLYPH_CHART_3D_VALIDATION_RULES` only.
- Defaults: `reviewFixtures.ts`.
- HTML-only `textScale` scales text/ticks/widths/gaps/padding/gutters, never data.
- Solid `regionFill`: colour exits only; text keeps textures.
- Text: `canvas.text`; numbers: SI/drop, never truncate. Pie leaders clear disc.
- Effects/3D: preview.
- Chart titles: scaled blank row toward content if room; preserve rows, log `title-gap-omitted`. Sankey planner vetoes lost flows/nodes; funnel reuses its gap. Quadrant low x starts at axis origin.
- Top y titles: scaled gap if room; tight plots log `axis-title-gap-omitted`.
- Bar/area domains include zero, except floating intervals; explicit zero-excluding domains reject. Log domains keep one sign.
- Sankey/funnel/treemap: no x/y scales/transforms (`bad-options`).
- `cell`-only + two band scales: heatmap (`heatmap.ts`), flush integer-partitioned `2k`×`k` cells; shrink canvas to grid. An unsigned heatmap's ramp has no blank level and a range key; a signed one blank only at zero.
- 3D: axis triad starts at data-min; axes are fine sub-cell meshes, never glyphs; `p.texture` uses the namespaced object sampler key; static exits round-trip `resolved.camera`.
- Journey: compact 0–5 bars, scores/actors beside. Centred table; own title; left-aligned sections; one blank between sections. Wrap words; long actors under bars. Log omissions/fallback; auto-height. No band actors/sections.
- Mermaid: `@glyphcss/core/mermaid` preamble/entities/comments; own tokenizer. Inert config: `mermaid-degraded`. Native marks; keep directive prefixes. Errors: `GLYPH_MERMAID_SYNTAX` / `GLYPH_MERMAID_NOT_CHART_TYPE`; source ledger in both reports. Folds: `label-folded` (role/before/after), before wrapping. Strip `%%` comments/directives before label protection/recognition; preserve quoted/CSV/free-title literals and treemap indentation. Journey/timeline have `#` comments; timeline event/title/section tokens retain hashes. Journey empty scores use the logged clamp. XY spans its range from implicit x=1; horizontal XY swaps bars/lines; quadrant endpoints replace 0/1 ticks. Reuse `resolveSankeyRows`; cycles become flow lists.
- Bars default vertical. Horizontal: value x/category y; `x0` starts intervals, otherwise include zero. Bars/labels share integer rows: label on first bar, contiguous series, one scaled blank row/group if room; no transforms. Sub-cell intervals become dots (`bar-interval-collapsed`). Band axes/legends follow content, spare rows trail. Line/area/vertical plots and treemaps keep proportional height.
- Gantt: calendar schedule; latest `after`/earliest `until`; forward refs; rowless `vert`; aligned status tags. Sections at column 0; tasks indented two cells/right-aligned; blank before later sections. Native geometry; never thin authored rows. Ticks use coarser date/axis precision (local/DST-aware); hidden/empty ticks never count as thinned. Log milestone dots, approximate ticks, unshaded exclusions, inert today/layout. Partial dates: 1970; missing starts: epoch, logged.
- Radar: ids/labels, keyed/positional curves, range/grids/ticks/legend. Box/ascii: grouped bars; braille/blocks: aspect-correct line/text, 256-segment circles/all spokes. Native swatches/styles; color solid; no vertex letters. Captions: ≥1-cell ink gap, nearest own endpoint; fixed or logged drop, no nudge/abbreviation. `radarGrid: "outer"`: contour/spokes; default all; ticks 0 unchanged; log omissions. `radarSeries: "cells"`: one canvas, every edge cell •/○/×/+ cycling; first series wins overlaps; symbol legends omit generated prefixes. Default line; native unchanged. Mono guides dotted/coalesced, logged; omit interior ticks. Log fallbacks, missing/clamped values, unfilled curves. Treemap: unique acyclic ids, nonnegative finite leaves, branch sums, aspect-aware squarify; probe alternate aspects for lost labels; invalid trees use `treemap-hierarchy`. Siblings share borders/junctions; children share parent sides/bottom. Leaves put values below labels; reserve scaled blank cells inside side borders. Omit tiny tiles/unfittable whole labels (`treemap-omitted`); value config inert, logged.
- Structure annotations survive shallow copies, not JSON; auto-height; fixed height logs omissions. Timeline: centred table, periods two cells under left-aligned headers; one blank row between sections. Events beside periods; only whitespace-followed colons split events, retaining times/URLs. Wrap words, honor `<br>`/`</br>`; stack narrow columns with the same indent; log oversized words. Packet: 32-bit rows, ascending absolute vertical decimal ticks, sharp shared borders (OR masks), padded whole-word labels; grid-aligned keys (stack multi-digit keys). Log narrow rows, inert config, overlaps, invalid ranges, 256-row cap.
- Kanban: preserve indent, skip blanks; title/accessibility only unindented, nested data stays data. Hashes/label `%%` are data. Bare/anonymous/repeated ids keep occurrences. Single-quoted backslashes are literal. Sharp lanes/cards; whole words; minimize height, then balance equal-card lanes or minimize wraps; log lane wraps. Shared lane bottoms; body row only if empty. Metadata wraps between whole ticket/assigned/priority items; log inert URLs.
- Gantt/journey/timeline: ≤2 extra rows/gap; Gantt header→task shares gaps; later sections keep base blank. Axes/chrome follow tasks; omit orphan sections. Web centres compact content; chat top anchors. Gantt/journey subcell bars: lower halves; milestones: dots.
- Legends: 3 swatch cells + blank. Mermaid: whole-entry bottom rows before abbreviation; native defaults unchanged. Unnamed multi-series XY uses logged mark-type names. Subcell lines preserve full bar cells as backgrounds.

## Don't

- Don't default chat to braille/colour: fonts lack braille; paste drops ANSI. `TargetPreview` enforces both.
- Don't gate `isHtml` on target; `TargetPreview` decides what each frame shows.
- Don't use `font-family: inherit` or `line-height` >1 on glyph `<pre>`: shell lacks Glyph Mono; `█` rows must overlap.
- Don't swap region glyphs after painting for solid fills; repaint with `regionFill: "solid"` into a second canvas that only colour-carrying exits read.
- Don't use `grid.char !== " "` as coverage; `canvas.ink` is coverage (a painted blank counts).
- Keep `textScale` integral; round density/font size/width together.
- Don't copy dense grids; ASCII/ANSI Copy uses density 1 at the measured viewport.
- Probe `chartsBuildBoundMark`; don't duplicate mark-fit rules or clean rows at render time (`?c=` must byte-match).
- Keep dataset ids (`CHARTS_DATASET_ID_ALIASES`), Random order, `Math.random()` draw count.
- Don't remount 3D on mark/colour changes; use handle `update()` and `scene.setOptions` to preserve camera.
- Don't combine `rotX`/`rotY` with `mat` (`bad-camera`) or bypass `compileScene` for 3D rasterization.
- Notes: Dock `disabledReason` or frame chrome.
- Sankey: no filled ribbons; use stubs, a bracket and one line/flow (`sankeyLines.ts`).
- Don't texture funnel stages or size them linearly; one solid shape with √value widths, a blank row between stages and one label line each keeps late stages visible and readable (`paintFunnelMark`).
- Keep sankey's row-monotonicity bound ≥2; reclaim and fold-stub each cost a row.
- Don't narrow `RangeSlider` native `min`/`max`; cap on commit; align thumb/fill.

## Gates

- Tests and fixture/schema parity.
- 3D: schema, surface, axes.

Tests: `Europe/Berlin`. Labels: `</br>` like `<br>`.
