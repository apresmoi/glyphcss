# @glyphcss/charts — agent guide

## What it is

A Plot-style chart spec on the cell canvas (ascii/box/blocks/braille). Root has no camera, mesh, depth test, `compileScene` or rasterizer.

- **Model step:** `buildGlyphChart(input, options)` runs validate → transforms → scales → layout → paint and returns a `GlyphChartBuild` (`canvas`, `colorCanvas`, `plot`, `meta`, `report`, `resolved`). No strings.
- **Encode step:** `encodeGlyphChart(build, "text" | "html")`. `renderGlyphChart` is the two composed.
- **`./3d`:** surface/scatter/parametric/bars/line build `GlyphSceneObject`s through `compileScene`. It may import root helpers; root never imports scene-object code.

## Invariants

- Ledger entries use constructors in `ledger.ts` (`src/3d/ledger.ts` for 3D): kebab `code`, plain-English `message`, numbers in `detail`.
- Every validation failure uses a rule id in `GLYPH_CHART_VALIDATION_RULES` and repair hint; `schema.ts` derives its vocabularies from `validate.ts`, and Ajv parity tests must stay green. A runtime-only data check (`mixed-x-scale`, `sankey-cycle`) is a tagged error, not a rule entry.
- 3D has its own table, `GLYPH_CHART_3D_VALIDATION_RULES`. Never add 3D codes to the root table or touch `src/validate.ts` for 3D.
- New options default byte-identically. Deliberate divergences from the parent build are listed in the comment at the top of `src/reviewFixtures.ts`; any other diff in `goodSpecs` is a regression.
- `textScale` scales text AND fixed cell-count geometry (tick budgets, sankey/funnel widths, gaps and padding, callout gutters). Data-proportional quantities never scale.
- Only the colour-carrying exits read the solid `regionFill` paint. `build.canvas` and plain `text` always keep textures.
- Paint text through `canvas.text`, never direct grid writes. Numeric labels use SI or drop, never truncate.
- Plain-text and ANSI exits ignore `textScale`; it is a web-only HTML affordance.
- Effects (`composeGlyphChartEffects`, and 3D effect layers) are preview-only: Copy, CLI and JSON exits never see a composed build.
- A bar/area value domain includes zero, except floating intervals; explicit zero-excluding domains reject. Log domains keep one sign.
- Sankey/funnel/treemap are non-cartesian: no x/y scales or transforms (`bad-options`).
- A `cell`-only chart on two band scales is a heatmap: flush bands tiled by integer partition, `2k`×`k` cells, and the canvas shrinks to the grid (`heatmap.ts`). An unsigned heatmap's ramp has no blank level and a range key; a signed one keeps blank for exactly zero.
- 3D: the axis-triad origin is the fixed data-min corner; axis lines are real mesh geometry (a fine sub-cell line), never stamped glyphs; `p.texture` uses the namespaced object sampler key; the static exit must round-trip `resolved.camera`.
- Journey: compact task rows reuse horizontal bars on 0–5 with score/actors beside each bar. Left section headers, one blank between sections, none between tasks. Wrap words; long actors go under bars. Log omissions and face/timeline fallback. Auto-height fits rows. Never make actors/sections category bands.
- Mermaid: native marks, inert configuration/directives. Require full per-type directives; preserve name prefixes. Journey `#` comments precede label protection; empty scores become 0 with the logged clamp. Errors: `GLYPH_MERMAID_SYNTAX` / `GLYPH_MERMAID_NOT_CHART_TYPE`; merge source ledger into both reports. Strip trailing comments before directive recognition, preserving quoted `%%`. Strip comments/directives before label protection; respect CSV/free titles and treemap indentation. XY series span their range; implicit x starts at 1. Horizontal XY swaps bars/lines; quadrant endpoint labels replace 0/1 ticks. Reuse `resolveSankeyRows`; cycles become flow lists and CSV quoting survives.
- Bars default vertical byte-identically. `orientation: "horizontal"` reads value x/category y; `channels.x0` supplies an interval start, otherwise x includes zero. Horizontal bars share integer row geometry with labels: label on first bar, contiguous series, one scaled blank row between groups when room; no transforms. A sub-cell interval becomes a dot with `bar-interval-collapsed`. Preserve Date rule channels for Gantt markers.
- Gantt: calendar durations/exclusions, latest `after`/earliest `until`, forward refs, rowless `vert`, section/status rows. Log milestone dots, approximate ticks, unshaded exclusions and inert today/layout settings. No clock: partial dates anchor to 1970; missing starts to epoch, logged.
- Radar: ids/labels, positional/keyed curves, min/max, grids/ticks/legend. Box/ascii use grouped horizontal bars; braille/blocks use lettered vertices and omit interior tick values. Log these fallbacks, missing/clamped values and straight unfilled curves. Treemap: unique acyclic ids, finite nonnegative leaves, branch sums, aspect-aware squarify; invalid hierarchies use `treemap-hierarchy`. Siblings share borders/junctions; children share parent sides/bottom. Labels reserve a scaled blank cell inside each side border. Omit tiny tiles/unfittable whole labels (`treemap-omitted`); value configuration stays inert, logged.
- Line legends reserve three swatch cells plus a blank, including subcell/corners.

## Don't

- Don't default `chat` to braille, or show it colour: chat fonts carry 0/256 braille glyphs and a paste drops ANSI. `TargetPreview` enforces both itself, whatever the caller passes.
- Don't gate `isHtml` on target; `TargetPreview` decides what each frame shows.
- Don't paint glyph `<pre>` with `font-family: inherit` or `line-height` above 1: the shell lacks Glyph Mono, and `█` must overlap rows to read solid.
- Don't swap region glyphs after painting for solid fills; repaint with `regionFill: "solid"` into a second canvas that only colour-carrying exits read.
- Don't use `grid.char !== " "` as coverage; `canvas.ink` is coverage (a painted blank counts).
- Don't pass fractional `textScale`; round density, font size and width together.
- Don't copy the dense grid; Copy ASCII/ANSI read a density-1 render at the same measured viewport.
- Don't restate mark-fit rules; probe `chartsBuildBoundMark`. Don't clean mark rows at render time: `?c=` byte-matches a fresh derivation.
- Don't rename dataset ids (use `CHARTS_DATASET_ID_ALIASES`), reorder Random pool segments or add a `Math.random()` draw.
- Don't key the live 3D viewport's mount on the mark or colour; use the object handle's `update()` and `scene.setOptions`, or every edit resets the camera.
- Don't pass `rotX`/`rotY` with `mat` to `renderGlyphChart3d` (`bad-camera`), and don't hand-roll 3D rasterization instead of `compileScene` (a raw sampler key hides there).
- Don't put notes inside a render area; reasons go on the Dock toggle (`disabledReason`) or frame chrome.
- Don't paint sankey flows as filled ribbons; stubs, a bracket and one line per flow keep each share and each path readable (`sankeyLines.ts`).
- Don't texture funnel stages or size them linearly; one solid shape with √value widths, a blank row between stages and one label line each keeps late stages visible and readable (`paintFunnelMark`).
- Don't tighten the sankey row-monotonicity bound below 2; reclaim and fold-stub steals each cost a row.
- Don't narrow a `RangeSlider` thumb's native `min`/`max`; caps apply only on commit, or thumbs and fill disagree.
- Don't prove byte-identity against this branch's defaults; pin fixtures rendered from the parent commit.
- Don't assert a painted cell is merely non-blank; an axis glyph satisfies that. Assert the expected glyph.
- Don't give an unsigned heatmap ramp a blank level; a blank cell reads as missing data.

## Gates

- Package: all `src/**/*.test.ts`, including parent byte-identity and schema parity.
- 3D: render/schema, surface, axis origin and per-axis options.

Vitest pins `Europe/Berlin` before workers start because the parent-build fixtures capture local-calendar time scales in that zone; preserve those fixtures and the renderer's local-time behavior.
