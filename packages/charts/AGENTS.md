# @glyphcss/charts — agent guide

`CLAUDE.md` is a symlink to this file; edit `AGENTS.md`. Public usage: `README.md`. Measurements and history live in git; the why of a single function lives in a comment beside it.

## What it is

An Observable-Plot-flavoured chart spec rendered as text (ascii/box/blocks/braille) through glyphcss's cell canvas. The root entry has no camera, mesh or depth test and never touches `compileScene`/`rasterize.ts`.

- **Model step:** `buildGlyphChart(input, options)` runs validate → transforms → scales → layout → paint and returns a `GlyphChartBuild` (`canvas`, `colorCanvas`, `plot`, `meta`, `report`, `resolved`). No strings.
- **Encode step:** `encodeGlyphChart(build, "text" | "html")`. `renderGlyphChart` is the two composed.
- **Root vs `./3d`:** `@glyphcss/charts/3d` is a separate subpath (surface, scatter, parametric, bars, line) that builds `GlyphSceneObject`s and renders static frames through `compileScene`. The root never imports scene-object code; `./3d` may import root helpers, never the reverse.

## Invariants

- Every ledger entry is built by a constructor in `ledger.ts` (`src/3d/ledger.ts` for 3D): stable kebab `code`, one plain-English `message`, numbers in `detail`.
- Every validation failure uses a rule id in `GLYPH_CHART_VALIDATION_RULES` with its own repair hint; `schema.ts` derives its vocabularies from `validate.ts`, and Ajv parity tests must stay green. A runtime-only data check (`mixed-x-scale`, `sankey-cycle`) is a tagged error, not a rule entry.
- 3D has its own table, `GLYPH_CHART_3D_VALIDATION_RULES`. Never add 3D codes to the root table or touch `src/validate.ts` for 3D.
- New options default to byte-identical output. Deliberate divergences from the parent build are listed in the comment at the top of `src/reviewFixtures.ts`; any other diff in `goodSpecs` is a regression.
- `textScale` scales text AND fixed cell-count geometry (tick budgets, sankey/funnel widths, gaps and padding, callout gutters). Data-proportional quantities never scale.
- Only the colour-carrying exits read the solid `regionFill` paint. `build.canvas` and plain `text` always keep textures.
- Every chart string is painted through `canvas.text`; no direct grid writes. Numeric labels abbreviate (SI) or drop, never truncate.
- Plain-text and ANSI exits ignore `textScale`; it is a web-only HTML affordance.
- Effects (`composeGlyphChartEffects`, and 3D effect layers) are preview-only: Copy, CLI and JSON exits never see a composed build.
- A bar or area domain includes zero; explicit domains excluding it reject. Log domains keep one sign.
- Sankey/funnel are non-cartesian like `arc`: no x/y scales, no transforms (`bad-options`).
- A `cell`-only chart on two band scales is a heatmap: flush bands tiled by integer partition, `2k`×`k` cells, and the canvas shrinks to the grid (`heatmap.ts`). An unsigned heatmap's ramp has no blank level and a range key; a signed one keeps blank for exactly zero.
- 3D: the axis-triad origin is the fixed data-min corner; axis lines are real mesh geometry (a fine sub-cell line), never stamped glyphs; `p.texture` uses the namespaced object sampler key; the static exit must round-trip `resolved.camera`.
- Public API changes land in `README.md` in the same PR.

## Don't

- Don't default `chat` to braille, or show it colour: chat fonts carry 0/256 braille glyphs and a paste drops ANSI. `TargetPreview` enforces both itself, whatever the caller passes.
- Don't gate the page's `isHtml` on target; the library emits `html` on every target and `TargetPreview` decides what each frame may show.
- Don't paint a glyph `<pre>` with `font-family: inherit` or `line-height` above 1 (main, terminal, chat fence, tray tile): the workbench shell's stack has no Glyph Mono, and `█` must overlap rows to read solid.
- Don't swap region glyphs after painting for solid fills; repaint with `regionFill: "solid"` into a second canvas that only colour-carrying exits read.
- Don't use `grid.char !== " "` as coverage; `canvas.ink` is coverage (a painted blank counts).
- Don't pass a fractional `textScale`; the page rounds density and corrects `font-size` and `width` together, or later columns drift.
- Don't copy the dense grid; Copy ASCII/ANSI read a density-1 render at the same measured viewport.
- Don't decide mark-type fit by restating library rules; build through `chartsBuildBoundMark` and paint-probe the result.
- Don't clean mark rows at render time: `?c=` omission byte-matches a mark's data against a fresh derivation.
- Don't rename a vendored dataset id (add to `CHARTS_DATASET_ID_ALIASES`), insert a Random pool segment before existing ones, or add a second `Math.random()` draw.
- Don't key the live 3D viewport's mount on the mark or colour; use the object handle's `update()` and `scene.setOptions`, or every edit resets the camera.
- Don't pass `rotX`/`rotY` with `mat` to `renderGlyphChart3d` (`bad-camera`), and don't hand-roll 3D rasterization instead of `compileScene` (a raw sampler key hides there).
- Don't put notes inside a render area; reasons go on the Dock toggle (`disabledReason`) or frame chrome.
- Don't gate sankey choices on a crossing-count proxy; `sankeyLostCells` counts exact lost cells.
- Don't tighten the sankey row-monotonicity bound below 2; reclaim and fold-stub steals each cost a row.
- Don't narrow a `RangeSlider` thumb's native `min`/`max`; caps apply only on commit, or thumbs and fill disagree.
- Don't prove byte-identity against this branch's defaults; pin fixtures rendered from the parent commit.
- Don't assert a painted cell is merely non-blank; an axis glyph satisfies that. Assert the expected glyph.
- Don't give an unsigned heatmap ramp a blank level; a blank cell reads as missing data.

## Key gates

- Package: `reviewFixtures.ts` (the `goodSpecs` byte-identity fixtures), `review.test.ts`, `validate.test.ts`, `schema.test.ts`, `rootIsolation.test.ts`, `ledger.test.ts`, `regionFill.test.ts`, `solidSubcell.test.ts`, `stackedArea.test.ts`, `sankeyOrderGate.test.ts`, `skipLevelSankey.test.ts`, `flowMarks.test.ts`, `arcShape.test.ts`, `textScale.test.ts`, `strokeWidth.test.ts`, `tickFormat.test.ts`, `effectsBridge.test.ts`.
- 3D: `src/3d/render.test.ts`, `schema3d.test.ts`, `surface.test.ts`, `axisOriginCorner.test.ts`, `axisPerAxisOptions.test.ts`.
- Website: `chartsMarkTypeFit.test.ts`, `chartsUrlState.test.ts`, `chartsWorkbenchTargetMatrix.test.tsx`, `TargetPreview/glyphMonoCmap.test.ts`.

Run targeted tests while iterating; `pnpm test && pnpm build` before a PR.
Vitest pins `Europe/Berlin` before workers start because the parent-build fixtures capture local-calendar time scales in that zone; preserve those fixtures and the renderer's local-time behavior.
