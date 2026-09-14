# 3D charts, 3D diagrams, and composition

Design record for the composition work described in `CHARTS-RESEARCH/PLAN-3d.md` (untracked, never committed). It carries rationale and measurements only — the contracts themselves live in `AGENTS.md`'s "Charts", "Diagrams" and "Scene objects" sections.

## Packet F4: `GlyphSceneObject`, `scene.addObject()`, the overlay registry, the shared label arbiter

### Why a generic primitive, not chart-specific plumbing

A 3D chart and a 3D diagram both need: meshes that cast/receive shadows and participate in occlusion like any other geometry, axis/edge/label paint that survives Glyph Effects, and a way to be targeted by `scene.addEffectLayer`. None of that is chart- or diagram-specific — it is "how does a self-contained fragment of scene content mount into a host scene it doesn't own or configure." Building it once in glyphcss (`api/sceneObject.ts`) means `@glyphcss/charts/3d` and `@glyphcss/diagrams/3d` (later packets) are producers of `GlyphSceneObject`, never scene owners, and React/Vue/the custom element mirror exactly ONE primitive (`<GlyphObject>`) instead of a family of chart-shaped and diagram-shaped wrappers.

### `glyphChartPlaneObject` is deliberately NOT in this packet

PLAN-3d.md §3.1 lists `glyphChartPlaneObject(build, { width })` — a 2D chart mounted as a textured plane `GlyphSceneObject` — as one of the eventual producers of this primitive. It is out of scope for F4 on purpose: it consumes `glyphChartTextureSampler`, which is packet F2's own deliverable (`glyphCanvasTextureSampler` + the per-tier ink-mask tables, PLAN-3d.md §7), and F2 has not landed yet. Building it here would mean either duplicating F2's sampler machinery ahead of time or shipping a producer with no real sampler behind it — both worse than waiting. It gets its own packet once F2 exists; `scene.addObject()` itself needs no change to accept it when it does, since a plane object is just another `GlyphSceneObject` (one mesh, no overlays, one texture sampler in its `textureSamplers` map).

### Why the overlay registry lives inside `runLegacyCellHook`, not beside it

The render path already has exactly one seam where a fully-composed `CellGrid` is available before it becomes a string: `runLegacyCellHook`, called once per output grid (base, then each detail mesh's own, then each viewport overlay), always AFTER effect composition (`transformEffectCells` calls it as its last step) and always BEFORE the scene's own `options.transformCells` hook. Putting the object-overlay pass at the START of that function — before the user hook runs — gets "overlays run after effects, before the user's hook" for free, from the EXISTING ordering, rather than needing a new composition stage with its own risk of getting inserted at the wrong point relative to effects. The alternative (a parallel hook slot beside `transformCells`) would have required deciding, and re-deciding at every future call site, where in the pipeline it runs; this way there is exactly one place that could get the order wrong, and the mutation test (swap overlay-before-effects) reddens by construction.

### Byte-identity: why `withTransformCellsLayer` is the gate, not `applyGlyphSceneObjectOverlays` alone

`applyGlyphSceneObjectOverlays` returning `grid` unchanged when no object has an overlay is necessary but not sufficient — the real cost a "no scene objects" render must not pay is the `CellGrid` ALLOCATION itself. `rasterize.ts` only builds one when `scene.transformCells` is defined at all (`if (scene.transformCells) { … }` gates the whole cell-buffer path); the fast direct-string path otherwise never runs. So `withTransformCellsLayer` — which decides what `ctx.transformCells` becomes for a given layer — has to know "is there ANY reason to pay for a CellGrid this render," and that reason is now `hook !== undefined || objectHasAnyOverlay()`, not just `hook !== undefined`. Measured (this repo's own full `glyphcss` suite, 111 files / 1,167 tests, and the `@glyphcss/maps` widget tests that exercise `transformCells` — `widget.layerLifecycle`, `widget.strokeDensityOcclusion`, `widget.sun`, `widget.walkDetailOcclusion`, `widget.walkStrokePlacement`, plus `stroke.test.ts`, `widget.strokeOcclusion.test.ts`, `widget.contourRelief.test.ts`, `layers.test.ts`): all green, unmodified, with the registry code present and zero objects mounted anywhere in those suites — the actual empirical form of "byte-identical with no object mounted."

One property this does NOT prove, and isn't meant to: forcing every render through the `CellGrid` path (deleting the `objectHasAnyOverlay()` half of the gate) does not change any test's output either. That is expected, not a gap — `encodeCellGridOutput`'s roundtrip is already required to be byte-identical to the direct `rasterize()` path for the effects feature (AGENTS.md: "With no effect and no hook, the direct renderer is byte-identical") — so the fast-path guard is a COST optimization (skip the allocation and the extra encode pass), not a correctness one, and no unit test can turn red on losing an allocation it never observes. The `withTransformCellsLayer` gate is kept anyway, on the same reasoning `interactiveDownscale` and `trackOpaqueCoverage` already use elsewhere in this file: pay for a scene-wide buffer only when something asked for it.

### The label arbiter: two-phase, one per grid per frame, occlusion via `winnerMesh`

`@glyphcss/maps`' `glyphMapDeclutterLabels` (`packages/maps/src/layers.ts`) is a pure batch function: collect every candidate, sort by `(priority desc, index asc)`, greedily keep non-overlapping ones. glyphcss cannot depend on `@glyphcss/maps` (the dependency runs the other way), so `render/overlay/labelArbiter.ts` re-derives the same shape generically, keyed on `CellGrid` rather than on maps' own `GlyphMapLabelCandidate`. The two-phase split (an overlay REGISTERS during `stamp()`, the scene RESOLVES once every overlay for that grid has run) is required, not a style choice: overlays run in REGISTRY order (their own `order`, mount order, declaration order), while a correct arbiter must resolve in PRIORITY order — the two orders are unrelated, so painting immediately during `stamp()` would make the visible winner a function of registration order, which is exactly the defect a per-object arbiter (the F4 gate's own reddening mutation) exhibits: each object's own labels are decided against only that object's own candidates, so two objects sharing a cell resolve by "whichever painted last," not by priority.

Occlusion (a label hides behind a mesh that isn't its own) reads `CellGrid.winnerMesh` at the label's own anchor cell. That buffer is solid-mode-only and requirement-gated — retained only when something asks for it — so `createGlyphScene`'s existing OR-gate for `retainWinnerMesh` (previously `effectsActive && hasMeshTargetedLayers()`, for per-object effect targeting) grew one more clause: `options.mode === "solid" && objectHasAnyOverlay()`. Checked once per render, not per candidate — the buffer is scene-wide, exactly like the effect-targeting case beside it. A candidate with no `ownMeshIds`, or a grid with no `winnerMesh` (wireframe/voxel/ink, or nothing else requested it and no object overlay exists to trigger the OR-gate), never hides — matching AGENTS.md's own rule for per-object effect targeting ("solid-only; elsewhere the layer is inactive, never a throw").

### `stampGlyphOverlayCell` / `stampGlyphOverlayLine`: the generic stamp

An overlay author's alternative to these two functions is touching `CellGrid.char`/`.color`/`.depth` arrays directly, which means re-deriving, at every call site, the three rules `@glyphcss/maps`' hand-written `line`/`contour` stamps already learned the hard way (AGENTS.md's own Maps section): bounds are a no-op not a throw, a cross-layer-occluded cell (`CellGrid.occluded`) must never be painted over, and an optional depth test lets a stamp stand IN the scene instead of always floating on top of it. `stampGlyphOverlayCell` is that primitive, generalized off `CellGrid` alone (no camera, no scene, no notion of "object"); `stampGlyphOverlayLine` is a depth-tested Bresenham walk built on it, the shape a later packet's axis/edge overlay reaches for. Deliberately NOT a public general-purpose polyline router (no junction resolution, no dash/style vocabulary) — that is the cell canvas's job (`render/canvas/`), which is for TEXT/CHART/DIAGRAM 2D layout with no camera at all; an overlay stamp exists for content that has already been PROJECTED into cell space by its own mesh/camera math and just needs a safe place to land.

### Object mount transform: why one transform for every member mesh

`GlyphSceneObjectMesh.options` deliberately excludes `position`/`rotation`/`scale` (`Omit<GlyphMeshTransform, "position" | "rotation" | "scale">`) — glyphcss has no nested-group concept, so a member mesh's own local transform would need its own compose-with-parent math, machinery the render path doesn't otherwise have. Instead `addObject`'s own `transform` argument applies UNIFORMLY to every member via `buildObjectMeshTransform`, and `GlyphOverlayFrame.toWorld(p)` (used by an overlay wanting a data-space anchor in world space) is the SAME point transform, factored out of `applyTransform`'s per-vertex math (`transformObjectPoint`). A producer wanting per-mesh offsets (e.g. a diagram's per-node position) bakes them into that mesh's own polygon vertices instead — which is also what keeps `bounds` (object space) meaningful as one coordinate frame for the whole object, not one per member.

### Rejected: per-object arbiter, hook-only registry, no fast-path gate

- **Per-object arbiter.** Simpler to implement (each object's overlay closure owns its own arbiter instance) but fails the composition promise outright: PLAN-3d.md's own acceptance clause exists because it fails, and the F4 mutation test (swap a shared arbiter for one per object) demonstrates it concretely — priority stops mattering and the last-painted object wins regardless.
- **A second, parallel `transformOverlayCells` hook slot beside `transformCells`.** Rejected because it duplicates the "which grid, what layer identity" plumbing `withTransformCellsLayer`/`GlyphTransformCellsLayer` already carries, and re-opens the ordering question (effects vs. overlays vs. user hook) at a second site instead of the one seam that already has the right order by construction.
- **Always building the `CellGrid`, dropping `objectHasAnyOverlay()`'s half of the gate.** Not wrong (as measured above, output is unaffected), but a pure cost regression for every scene with no scene objects mounted — kept out on the same "pay only when asked" principle `interactiveDownscale`/`trackOpaqueCoverage` already establish in this codebase.

## Gates and mutations (packet F4)

| Gate | Mutation applied | Result |
|---|---|---|
| Byte-identical with no object mounted | (see above — measured via the full existing suite, not a single mutable line) | 111/111 glyphcss files, 5/5 targeted maps suites green, unmodified |
| Two objects' labels never overlap | Give each object its own `GlyphLabelArbiter` instead of one shared | RED — priority-losing candidate paints anyway, overwriting the winner |
| Labels hide behind a foreign mesh | Drop the `winnerMesh`/`ownMeshIds` check in `labelArbiter.resolve()` | RED — the hidden label's text appears |
| Overlays run after effects | Stamp overlays into the retained BASE grid before effect composition, instead of after | RED — the glitch/scramble effect overwrites the label |
| An object's mesh casts and receives a shadow | Drop `buildObjectMeshTransform`'s spread of `spec.options` (so `castShadow`/`receiveShadow` never reach `add()`) | RED — the shadow-on/shadow-off renders become identical |

Each mutation was applied to the working tree, run against `packages/glyphcss/src/api/createGlyphScene.sceneObject.test.ts`, observed red, then reverted and re-verified green — see that file's own per-`it` comments for the exact mutation each guards.

## F2 — canvas ink coverage/shade/surfaceUv, `glyphCanvasTextureSampler`

**Goal.** PLAN-3d.md §7 "A 2D chart as a texture": a `GlyphCanvas` (a chart's
or a diagram's painted plot) becomes a `TextureSampler` a HOST scene can put
on any other mesh via `scene.setTextureSamplers`, so a chart or diagram
reads as texture on a wall, a card, a plane — reusing the renderer's existing
per-cell texture path (AGENTS.md's "Per-cell textures") rather than
inventing a second one.

### Why a separate module for ink density, not a `canvas.ts` branch

`glyphInk.ts` (`packages/glyphcss/src/render/canvas/`) owns the whole
glyph → ink-mask/density engine and imports nothing from `canvas.ts`.
`sampler.ts` imports BOTH `glyphInk.ts` (for the mask) and `canvas.ts`
(for the `GlyphCanvas` type it samples); `canvas.ts` imports `glyphInk.ts`
back (for the `shade` bookkeeping every painter now writes). Had the density
engine lived inside `canvas.ts` instead, `sampler.ts`'s own need to import
`canvas.ts` for the type would have made `canvas.ts` depend on `sampler.ts`
right back — a cycle. Splitting the engine out breaks it cleanly: `glyphInk.ts`
depends on nothing but `tiers.ts` (the tier tables), and both `canvas.ts` and
`sampler.ts` depend on it one-directionally.

### Three families, never a fourth silent path

`glyphInkMask(glyph, tier, dims) → Uint8Array` and its cheaper sibling
`glyphInkDensity(glyph, tier) → number` (no texel-grid allocation — O(1) per
call, since `canvas.ts` calls it on every `line()`/`text()`/`arrowhead()`
write and a diagram can paint thousands of cells) resolve every glyph
through exactly one of three families, in this order:

1. **Exact decode.** A real braille codepoint (`tier === "braille"`,
   U+2800..28FF) or a `GLYPH_CANVAS_QUADRANT_GLYPHS` member
   (`tier === "blocks" | "braille"` — braille's own `fillSubGlyph` reuses the
   SAME quadrant table for solid fills, so both tiers must recognise it,
   verified directly: `braille.fillSubGlyph!(rawDotMask)` and
   `blocks.subGlyph!(rawDotMask)` resolve to the identical glyph string for
   the same input). The glyph's own dot/quadrant BITS are the mask,
   nearest-scaled (`resampleBitGrid`) to whatever resolution the caller asks
   for.
2. **Structural line art.** The Unicode box-drawing stems (`│─└┘┌┐├┤┬┴┼═║╌╎`),
   the diagonal family (`‾▔▏▕/\_`), the dedicated dot (`·`) and the four
   arrows render a real stroke/diagonal-walk/edge/half-fill shape
   (`strokeMask` derives corners/tees/crosses from one N/E/S/W expression —
   a corner is just "vertical stroke stops at centre, horizontal stroke
   starts at centre"). Deliberately EXCLUDES every ASCII substitute for the
   same stem (`| - + = # ~ :`) — `canvas.text("+")` is far more likely a
   plus sign than a crossing, so ASCII falls through to family 3 instead
   (verified: `glyphInkMask("│", "box", [5,5])` and `glyphInkMask("|", "box",
   [5,5])` are NOT equal).
3. **Flat density, ordered-dithered.** Everything else — a shading-ramp
   glyph (density = its own ramp INDEX, `index/(len-1)`, read live off
   `GLYPH_CANVAS_TIERS[*].shadeRamp` rather than duplicated), a glyph with a
   measured entry in a small `GLYPH_INK_DENSITY` table (duplicated from
   `packages/charts/src/fixtures/glyphInkCoverage.json`'s `glyphMonoFt`
   column — glyphcss cannot depend on `@glyphcss/charts`, the dependency
   runs the other way), or a flat default (`0.3`) for arbitrary text — turns
   into a mask via a tiled order-4 Bayer matrix (`orderedFillMask`), so an
   unrecognised glyph still reads as PATTERNED texture rather than a solid
   blob or nothing.

Every glyph any of the four `GLYPH_CANVAS_TIERS` tables can emit — walked
programmatically in `glyphInk.test.ts` (`staticTierGlyphs`/
`subcellTierGlyphs`, mirroring the style of the website's own
`glyphMonoCmap.test.ts` cmap gate) — resolves through one of the three,
never throws, never returns a wrong-length array.

### `glyphCanvasTextureSampler`

Each canvas cell becomes a `texelsPerCell` (default `[2, 4]`, the braille/
blocks dot-lattice aspect) block of texels: an ink texel is the cell's own
`grid.color` at full alpha (opaque WHITE when unset, so the host's own
colour passes the per-cell multiply through unmodulated and the texel's
luminance still drives the host's glyph pick — "the chart reads as the
host's own ramp, patterned by the chart's ink", PLAN-3d.md §7); a non-ink
texel is the cell's `bg` at full alpha, or fully transparent (alpha 0) —
never black — so an un-backgrounded chart cell reads as open sky, and
alpha-aware claims (AGENTS.md's "Per-cell textures") already keep a
transparent texel from occluding. Row 0 of the buffer is the canvas's own
row 0 (top): no flip needed, since `sampleUv`'s OBJ convention (`v=1` = a
texture's visual top) already reads row 0 at `v=1`. Dimensions are exact —
`cellCols * texelsPerCell[0]` by `cellRows * texelsPerCell[1]`, an optional
`rect` narrows which cells are sampled, never rounded or padded.

`@glyphcss/charts`' `glyphChartTextureSampler(build, { source?, ...})` and
`@glyphcss/diagrams`' `glyphDiagramTextureSampler(page, opts?)` are the
whole of `bridge.ts` in each package — they hand `build.canvas`/
`build.colorCanvas`/`page.canvas` straight to `glyphCanvasTextureSampler`.
Neither builds a scene object or a plane mesh (a later packet's
`glyphChartPlaneObject`) — this packet's job stops at "produces something
`scene.setTextureSamplers` accepts."

### Contract 5's other two additions: `ink` and `shade`, `setSurfaceUvRect`

`canvas.ink: Uint8Array` (`1` where any painter actually wrote a cell) and
`canvas.grid.shade: Float32Array` (that painter's own ink density —
`fillRect`'s exact `shade` argument, `glyphInkDensity(glyph, tier)` for the
other three painters, `NaN` where unpainted, reusing `CellGrid`'s own
already-existing optional `shade` field and its "empty cells are NaN"
convention) are bookkeeping for a LATER consumer's `baseShade`/coverage read
(a compositor packet) — `glyphCanvasTextureSampler` itself does NOT read
either buffer; it derives its mask fresh from `grid.char`/`grid.color`/`bg`
at sampler-build time, so their presence changes no rendered texel. Verified
directly (`sampler.test.ts`'s "existing canvas encodes are byte-identical"
posture): `encode.ts` (`encodeGlyphCanvasText`/`Html`/`Ansi`) reads neither
field (grepped), so every existing `encode.test.ts` case is unchanged byte
for byte.

`canvas.setSurfaceUvRect(rect | null)` declares a plot rect in cell
coordinates and fills `grid.surfaceUv` (`[u, v]` normalized to it row-major,
`[NaN, NaN]` outside) — purely geometric (never reads `grid.char`), callable
before or after painting, allocated lazily on first call. Not wired into
`@glyphcss/charts`'/`@glyphcss/diagrams`' own paint pipelines by this packet
— that is the effects-compositor packet's job, once it needs `uv0` to sweep
along a chart's own data axis; the capability exists on the canvas now so
that packet has nowhere else to add it.

**Known residual.** `canvas.resolveJunctions()` (`junctions.ts`, diagrams'
own edge/route paint — a diagram registers routes via `canvas.edge()`/
`canvas.route()` and paints them ENTIRELY inside `resolveJunctions()`, never
through `canvas.line()`) does not update `ink`/`shade`. Left alone rather
than threading a `GlyphCanvasTierName` + the `ink` buffer through
`resolveGlyphCanvasJunctions`'s signature (a heavily-tested file, out of this
packet's stated scope: "the texture sampler plumbing it needs", and the
sampler itself is unaffected by the gap). A diagram's edge cells therefore
read `shade: NaN` until whichever packet needs accurate `baseShade` closes
this — `glyphChartTextureSampler`/`glyphDiagramTextureSampler` are both
unaffected either way.

### Gates and mutations (packet F2)

| Gate | Mutation applied | Result |
|---|---|---|
| Braille exact decode covers every 8-bit dot pattern | Comment out the `tier === "braille"` codepoint-decode branch | RED — 2 tests (`U+2800`/`U+28FF` exactness, the tier-discriminator test) |
| Quadrant exact decode (shared by `blocks`/`braille`) | Comment out the `GLYPH_CANVAS_QUADRANT_GLYPHS` decode branch | RED — 2 tests (`▘`'s exact quadrant shape, the braille-`fillSubGlyph`-reuses-`blocks`-table case) |
| Structural line art (box-drawing stems/diagonals/edges) | Remove the `LINE_ART_GLYPHS` lookup, falling through to flat density | RED — 7 tests (`┼`/`└`/`│`/`/`/`\`/`_`/`▏` exact shapes) |
| The sampler's ink/non-ink split | Invert `mask[...] === 1` to `!== 1` in `glyphCanvasTextureSampler` | RED — 6 of 10 `sampler.test.ts` tests (left/right quad colours, bg/transparency, null-fg-is-white) |
| Existing canvas encodes stay byte-identical | (verified structurally: `encode.ts` reads neither `ink` nor `shade`, grepped) | `encode.test.ts`'s 46 cases pass unmodified |

Every mutation above was applied to the working tree, the affected test file
run, observed red, then reverted and re-verified green.

### Residuals for later packets

- `ink`/`shade` are not yet wired into `resolveJunctions()` (above).
- `setSurfaceUvRect` is not yet called by `@glyphcss/charts`/
  `@glyphcss/diagrams` — the capability exists, the wiring is the effects
  compositor packet's.
- `glyphChartPlaneObject`/a diagram's own plane object (the scene-object
  producer that actually MOUNTS a sampler on a mesh) is a later packet;
  this one only guarantees the sampler it would use.

## F1 — the 2D entrypoint split

**Goal.** Give a later consumer (a texture sampler, a decal effect, a scene
object — packets F2/F3/F4) a way to reach the painted `GlyphCanvas`es a 2D
chart or diagram already builds, without paying for the text/HTML encode work
twice and without inventing a second render path. The 2D pipeline itself
(`spec → resolve → scales → layout → paint`) is completely unchanged; only
where it stops became public.

**Charts.** `renderGlyphChart` used to do validate → resolve → scales →
layout → paint → encode in one function and hand back
`{ text, html?, grid: { cols, rows, char }, meta, report }`. That `grid` was
already a reduced projection of the real painted `GlyphCanvas` (cols/rows/char
only, no colour, no report) — a caller that wanted the canvas itself, or the
plot rect, or the second (solid) canvas a `regionFill: "solid"` render paints,
had no way to get it.

The function is now two: `buildGlyphChart(input, options) → GlyphChartBuild`
runs the model (validate/resolve/scales/layout/paint, no encoding) and
`encodeGlyphChart(build, "text" | "html") → string` turns a build into a
string, replaying the exact exit rule `render.ts`'s header doc has always
stated (`text` reads the plain `canvas` under `none`/`css` and the ANSI-
encoded `colorCanvas` under an ANSI mode; `html` always reads `colorCanvas`,
which is `canvas` itself whenever `regionFill` didn't resolve solid — so
`color: "none"`'s `html` needs no special case to stay colourless).
`renderGlyphChart` is exactly the two composed, and its own behaviour did not
change: same defaults, same validation order, same paint calls, same ledger.

`GlyphChartBuild` is `{ canvas, colorCanvas, plot, meta, report, resolved }`:

- `canvas`/`colorCanvas`: the two `GlyphCanvas`es `renderGlyphChart` already
  painted (`glyphcss`'s public type). `colorCanvas === canvas` by reference
  whenever nothing distinguishes them (the common case) — never a second
  allocation for a chart that isn't `regionFill: "solid"`.
- `plot`: the plot rect in cells (`GlyphChartPlotRect`, moved from being a
  `layout.ts`-local type to a public one in `types.ts` — `layout.ts` now
  re-exports it so no existing `from "./layout"` import needed touching).
  This is what a mesh's `uv0` mapping will read once a chart becomes a
  texture (F2) or a plane object (F4).
- `resolved`: the render's own settled options (target/charset/color/width/
  height/detail/cellAspect/textScale/env) — everything `encodeGlyphChart`
  needs to pick an exit, and everything a later bridge needs to know how the
  model was built.

`GlyphChartResult` is now `{ text, html?, build, meta, report }` — `grid` is
gone, a clean break (AGENTS.md's "Backward compatibility": no shim, no
alias). `renderGlyphChartJson` never emitted `grid` in the first place
(it destructured it out); it now destructures `build` out instead, for the
same reason — a `GlyphCanvas` carries live painter methods and is not
JSON-representable, and was never part of this entry's contract.

**Diagrams.** Diagrams already expose their pipeline stages
(`layout`/`routes`/`labels`), so the only change is `GlyphDiagramPage.grid:
GlyphCanvas["grid"]` becoming `canvas: GlyphCanvas` — `page.canvas.grid` is
the identical `CellGrid` `page.grid` used to hold directly, so every existing
consumer of the DATA needed only its access path widened by one property, not
its shape changed. `renderGlyphDiagramJson`'s output was unaffected either
way (it always built its own explicit `{ text, html?, meta, report }`
object, never spreading the page).

**Every caller in the same commit.** Grepped for `.grid` on a render-result
type (not a `GlyphCanvas`'s own `.grid`, which is unchanged and stays a
`CellGrid` under `createGlyphCanvas`) across `packages/charts`,
`packages/diagrams`, `packages/compile`, and `website/src`:

- `packages/charts`: `render.ts` (the split itself), `json.ts` (strip
  `build` instead of `grid`), `index.ts` (export `buildGlyphChart`,
  `encodeGlyphChart`, `GlyphChartBuild`, `GlyphChartResolved`,
  `GlyphChartPlotRect`), `layout.ts` (re-export the moved type). ~20 test
  files read `.grid` on a `renderGlyphChart(...)` result and moved to
  `.build.canvas.grid`; picture()-style test helpers that call
  `paintGlyphChart` directly on their own `createGlyphCanvas()` were
  untouched (their `canvas.grid` was never the removed field).
- `packages/diagrams`: `renderTypes.ts` (the field rename), `paint.ts` (the
  construction site), and the two test files that read a page's grid
  (`fixtureRules.test.ts`, `render.test.ts`).
- `packages/compile`: `chartCli.ts`/`diagramCli.ts` are type-only pass-
  through (they read `text`/`html`/`report`, never `grid`/`build`) — grepped
  and confirmed unchanged; both CLIs and their tests are green with no edit.
- `website`: `chartsWorkbenchRender.ts` (a `result.grid.char`/`.cols`/`.rows`
  loop, moved to `result.build.canvas.grid`) and
  `diagramsWorkbenchRender.ts` (a `result.pages.map(({ grid }) => ...)`
  destructure — the one site a plain `\.grid\b` grep missed, since it never
  wrote a literal `.grid`; caught by the DiagramsWorkbench target-matrix
  test suite going red with `ok: false` after the field rename, fixed by
  destructuring `{ canvas }` and reading `canvas.grid`).

**A `toEqual` casualty.** One test (`render.test.ts`'s "toggles the legend
line" case) compared two full `renderGlyphChart(...)` results with `toEqual`
to assert "the default is byte-identical to an explicit `legend: true`".
That worked when the result's only large field was a plain `{ cols, rows,
char }` object; once `build.canvas`/`build.colorCanvas` carry the real
`GlyphCanvas` (painter methods included), two separately-built canvases are
never `toEqual` — different closures per call, however identical their
painted content. Fixed by comparing the JSON-serializable surface
(`text`/`html`/`meta`/`report`) plus the grid's own data
(`build.canvas.grid`) and the model's own resolved settings
(`build.plot`/`build.resolved`) instead of the whole result object. This is
the one place the split changed a TEST's own comparison strategy, not the
library's behaviour.

**Gate.** `pnpm --filter @glyphcss/charts test` (1370 tests) and
`pnpm --filter @glyphcss/diagrams test` (208 tests) pass, including every
`reviewFixtures.ts` `goodSpecs` byte-identity suite (`regionFill.test.ts`,
`solidSubcell.test.ts`, `strokeWidth.test.ts`, `axisTitlePlacement.test.ts`,
`textScale.test.ts`, `tickFormat.test.ts`) — each of these hashes
`build.canvas.grid.char.join("")` (and `.text`/`.html`) across every
`goodSpecs` entry, at every charset, against a JSON of hashes captured from a
real pre-feature build, so passing them is byte-identity against a real
historical build, not merely "the new code agrees with itself". The website's
own target × charset × colour matrices
(`chartsWorkbenchTargetMatrix.test.tsx`, 125 cells;
`diagramsWorkbenchTargetMatrix.test.tsx`, 60 cells) both pass through this
same split render path. `pnpm --filter @glyphcss/website test` (2296 tests),
`pnpm build:packages`, and `pnpm build:website` all pass.

**Mutation: drop `colorCanvas`.** Reddened deliberately to confirm the gate
is load-bearing: with `colorCanvas` always aliased to `canvas` (the branch
that paints a second, solid canvas removed), 18 tests across
`regionFill.test.ts` and `solidSubcell.test.ts` fail — the ones asserting a
solid region fill's colour-carrying exits (`html` under `css`,
`text`/`html` under ANSI) actually differ from the textured paint. Restoring
the branch turns them green again.
