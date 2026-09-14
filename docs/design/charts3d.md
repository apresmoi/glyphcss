# 3D charts, 3D diagrams, and composition

Design record for the composition work described in `CHARTS-RESEARCH/PLAN-3d.md` (untracked, never committed). It carries rationale and measurements only — the contracts themselves live in `AGENTS.md`'s "Charts", "Diagrams" and "Scene objects" sections.

## Packet F4: `GlyphSceneObject`, `scene.addObject()`, the overlay registry, the shared label arbiter

### Why a generic primitive, not chart-specific plumbing

A 3D chart and a 3D diagram both need: meshes that cast/receive shadows and participate in occlusion like any other geometry, axis/edge/label paint that survives Glyph Effects, and a way to be targeted by `scene.addEffectLayer`. None of that is chart- or diagram-specific — it is "how does a self-contained fragment of scene content mount into a host scene it doesn't own or configure." Building it once in glyphcss (`api/sceneObject.ts`) means `@glyphcss/charts/3d` and `@glyphcss/diagrams/3d` (later packets) are producers of `GlyphSceneObject`, never scene owners, and React/Vue/the custom element mirror exactly ONE primitive (`<GlyphObject>`) instead of a family of chart-shaped and diagram-shaped wrappers.

### F4b: `glyphChartPlaneObject` / `glyphDiagramPlaneObject`

PLAN-3d.md §3.1 lists `glyphChartPlaneObject(build, { width })` — a 2D chart mounted as a textured plane `GlyphSceneObject` — as one of the eventual producers of this primitive; F4's own "deliberately NOT in this packet" note deferred it until F2 (`glyphChartTextureSampler`) landed. It has now landed, in `packages/charts/src/planeObject.ts` and `packages/diagrams/src/planeObject.ts` (`glyphDiagramPlaneObject` mirrors it exactly, reading `page.canvas` instead of a chart `build`'s), needing no change to `scene.addObject()` itself — a plane object is just another `GlyphSceneObject`: one mesh (`"surface"`), no overlays, one texture sampler in its `textureSamplers` map.

**One new export, not a producer-owned one.** The plane's polygon needs its `texture` field to name a key that will resolve inside the HOST scene's merged sampler map once mounted — `encodeGlyphSceneObjectSamplerKey(objectId, name)`, which `createGlyphScene.ts` already used internally to namespace `GlyphSceneObject.textureSamplers` entries but never exported. Every producer needs the identical key derivation (a producer computing its own scheme would silently diverge from the scene's the moment either changed), so this packet's one export-line change is promoting that existing function to `glyphcss`'s public surface rather than re-deriving it in `@glyphcss/charts`/`@glyphcss/diagrams`.

**Sizing: world aspect, not cell count.** The quad's `width` (object-space X extent) is the caller's only size input; `height = width * rows / (cols * canvas.cellAspect)`. Cell COUNT alone (`rows/cols`) would stretch the chart whenever `cellAspect !== 1` — the same reason `arcRadii` reads `cellAspect` for a pie's own radius (AGENTS.md's "Charts" "Arc shape and callouts"). `rect` (when a caller samples only `build.plot`, say) narrows both the sampled region and the sizing calc identically, so the plane's aspect always matches whatever region it actually displays.

**Orientation: XY-plane, `+X = v=0` (canvas bottom), chosen so it needs no rotation at all under the library's own default, untransformed orthographic camera.** `rotateVec3Voxcss` at `rotX=0, rotY=0` (no camera options set) projects world X to screen ROW and world Y to screen COLUMN, with depth `= world Z` (larger Z nearer). Working through the algebra once (verified against the real rasterizer, not merely asserted): a quad wound bottom-left/bottom-right/top-right/top-left in `(X=+h/2, Y=-w/2)…(X=-h/2, Y=-w/2)` order has front-face normal `+Z` (facing a camera that is, by the depth convention above, on the `+Z` side looking toward `-Z`) and reproduces the canvas right-side up, left-to-right, with `output row == canvas row` and `output col == canvas col` at every cell — no `rotation` needed for a caller who just wants "the chart, mounted." This is the SAME vertex/UV order `@glyphcss/maps`' facade walls use (AGENTS.md's "Layers" `facade` clause: `[bi, bj, tj, ti]` against `uvs: [[0,0],[bays,0],[bays,floors],[0,floors]]`) — one convention, reused, not invented per producer.

**`color: "#ffffff"` on the polygon**, not left unset (which would fall back to the same default gray "#cccccc" a broken texture load falls back to) — AGENTS.md's own per-cell texture rule is `sourceRgb = texel * base / 255`, so white is the only base that leaves the sampler's own fg/bg colours unmodified by the host's own Lambert/tint math, which is what "reproduces the chart's colours" in the gate below actually requires.

### Gates and mutations (packet F4b)

| Gate | Mutation applied | Result |
|---|---|---|
| Facing the camera at 1:1 (default orientation, no rotation), reproduces fg/bg cell for cell | Invert the sampler's own ink/non-ink split (`sampler.ts`'s `mask[...] === 1` → `!== 1`, packet F2's own mutation, re-run end to end through a real mounted mesh) | RED — 4 of 7 tests per package, including this one |
| Rotated 45° about Y, still paints the texture (not flat-coloured) | (same mutation as above — the rotated render loses its second colour identically) | RED |
| Casts a shadow onto a ground mesh; receives one from a box | Drop `castShadow`/`receiveShadow` forwarding in `planeObject.ts` (`options: undefined` unconditionally) | RED — both shadow tests per package (the caster-side and receiver-side renders, each compared against a `false`-toggled sibling scene, become byte-identical) |
| `remove()` leaves no sampler key behind | Comment out `teardownGlyphSceneObject`'s `objectSamplers.delete(key)` loop in `createGlyphScene.ts` | RED — a probe mesh reusing the removed object's exact encoded sampler key renders the stale chart's colours instead of its own flat one |

Each mutation was applied to the working tree, the affected package's test file run, observed red, then reverted and re-verified green — `packages/charts/src/planeObject.test.ts` (7 tests) and `packages/diagrams/src/planeObject.test.ts` (7 tests, identical structure). A backward-facing receiver (the wrong quad winding for its own light) reads pure ambient shading everywhere and shows no shadow at all regardless of casting — both shadow tests wind their ground/box meshes to face `+Z`, the same convention the plane object itself uses, rather than leaving that to chance.

**Exact-glyph alternative:** when a chart plane's own labels need to stay legible rather than degrade to texels, mount `@glyphcss/effects`' `glyphGridDecalEffect` (packet F3) on the plane's `"surface"` mesh instead; it writes the source grid's own glyphs through `uv0`.

### F4b fix round 1 — a codex review

**P1: sizing read the RAW `rect`, the sampler read the NORMALIZED one.** `planeObject.ts` computed `cols`/`rows` straight off `rect.x1 - rect.x0 + 1` (etc.) while `glyphCanvasTextureSampler` clamps that same `rect` to the canvas bounds and swaps a reversed pair before sampling — two different rectangles for the same option. An out-of-bounds `rect` therefore sized the quad from a wildly wrong extent (measured: a `{ x1: 200, y1: 1000 }` rect on an 8x4 canvas sized from a raw 201x1001 instead of the clamped 8x4), and a `rect` reversed on ONE axis only (`y1 < y0`, `x1 >= x0`) sized a NEGATIVE height (`rows = y1 - y0 + 1` went negative while `cols` stayed positive, and dividing a negative by a positive is still negative — the "both reversed" case that cancels sign never surfaces this). Fixed at the layer that owns the rule: `sampler.ts`'s own clamp/swap logic was already exactly what was needed, so it is now `resolveGlyphCanvasTextureSamplerRect(canvas, rect)`, exported from `glyphcss`, and both `planeObject.ts` files call it for their own `cols`/`rows` — the SAME function the sampler itself calls a moment later for the identical `rect`, so the two can never disagree (verified, not merely argued: a temporary revert to the raw-rect math reddens exactly the two new tests below and nothing else).

**P2: the acceptance gates were weak.** Four gaps, each closed:
- The aspect-sizing test used `cellAspect: 1`, under which dropping `cellAspect` from the formula entirely still passes by coincidence (`height = rows/cols` either way). Replaced with the real web target's `0.5859375`, where a dropped `cellAspect` gives `32` instead of the correct `32 / 0.5859375 ≈ 54.61` — `toBeCloseTo` at 3 decimals catches it.
- The texture tests only asserted "both colours occur somewhere," which a mirrored (flipped) UV mapping would still pass. Added a corner-mark test: a SINGLE top-left canvas cell is painted, and after mounting the plane the render's own top-left OUTPUT cell (walked from the real DOM via a `colorGrid` helper — never a flat regex over the HTML string, which cannot recover a position) must carry that colour and no other corner may. A swapped `uvs` order (the mutation table's own vertical-flip case) reddens it directly.
- The rotation test only rotated the OBJECT. Added a second case rotating the CAMERA instead (object untransformed, `doubleSided: true` so winding is never the reason it would fail) — the same "still paints the texture, not flat-coloured" assertion, now covering both halves of "a rotation."
- No test mounted a REAL chart/diagram and checked legibility, only the hand-painted 8x4 fixture. Added one: a real 96x32 web chart (`buildGlyphChart`) / a real rendered diagram (`renderGlyphDiagram("graph LR; …")`), mounted head-on. **The naive 1:1 render (`k=1`, one output cell per canvas cell) is genuinely illegible** — measured directly: the chart's own y-axis rule column showed 0 of 31 rows inked, because the per-cell texture sampler takes ONE UV sample per OUTPUT cell, and a structural glyph's own ink occupies only a FRACTION of its `texelsPerCell` (default `[2, 4]`) texel block, so a single sample per canvas cell has no guarantee of landing on it — this is exactly the documented "below `texelsPerCell`, degrades to a density blob" residual, not a test bug. The legibility test therefore supersamples (`k = 4` output cells per canvas cell, via a generalized `exactPlaneSceneOptions(canvas, k)` — `zoom = BASE_TILE * cellAspect * k`, `sceneCellAspect` unchanged) and checks each canvas cell's own `k x k` OUTPUT block for ink rather than one exact cell; at `k = 4` the chart's y-axis (31/31 rows), x-axis (93/93 columns) and interior mark ink (270 cells) all come through exactly, and the diagram's own node boxes (`page.layout.nodes[i].{x0,y0,x1,y1}`, real cell coordinates) each contain at least one inked cell with LR ordering preserved (`Start.x0 < End.x0`).

**Residual, newly precise:** the legibility test's own measurement is the sharpest statement yet of "what is lost, honestly" (PLAN-3d.md §7) — not merely "labels become texels below `texelsPerCell`" but a MEASURED floor (`k = 4`, matching the sampler's own `texelsPerCell` row default) below which even a solid axis RULE, not just a label, can vanish entirely. `glyphGridDecalEffect` (packet F3, already noted above) is the alternative that removes the floor rather than raising it.

Gate counts after this round: `packages/charts/src/planeObject.test.ts` and `packages/diagrams/src/planeObject.test.ts`, 12 tests each (was 7). Every mutation in both tables above was re-verified against the CURRENT test files (applied, observed red, reverted, re-verified green) rather than assumed still valid after the rewrite.

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

### Fix round 1 (codex gpt-5.6-sol) and round 2 (codex terra) — `createGlyphScene.sceneObject.fixRound1.test.ts`

Round 1 fixed five static-review findings (P1-a hotspot re-planting on `setTransform`, P2-a's colliding sampler keys and their `encodeGlyphSceneObjectSamplerKey` fix, P2-b's atomic duplicate-mesh-name rejection, P2-c's id-stable label tie-break, P2-d's lazy object-map allocation). A round-2 re-review confirmed every fix correct but found four of round 1's OWN tests insufficiently mutation-sensitive — reproduced and closed here:

- **Chained `setTransform()` (P1-a).** The round-1 test called `setTransform` exactly once, so a mutation that re-plants hotspots only on a handle's FIRST `setTransform` call cannot redden it (call #1 IS the first call). Replaced with an A → B → A sequence, each step checked against a reference scene mounted DIRECTLY at that position (never via `setTransform`) — both the hotspot's planted style and the mesh's own rendered output.
- **`update()` after `setTransform()`.** No round-1 test called `update()` after moving an object, so a mutation that has `update()` remount at an implicit identity transform instead of `entry.transform` went unnoticed. New test: `setTransform` to a moved position, then `update()` with a new mesh/hotspot spec, checked against a reference object mounted directly at that position with the same new spec.
- **A rejected `update()` (P2-b).** The round-1 duplicate-name test only exercised `addObject`, never `update()` — a mutation that tears the EXISTING object down before validating the new one's names (`teardownGlyphSceneObject(entry)` moved ahead of `assertUniqueObjectMeshNames(nextObject)`) had no test standing between it and green. New test mounts a real object (meshes, hotspot, sampler, overlay), rejects an `update()` with duplicate names, and asserts the SAME mesh-handle-map entries, hotspot element, byte-identical render and a still-running overlay survive the rejection.
- **Lazy object-map allocation (P2-d).** The round-1 test was an INDIRECT behavioural proxy ("cycle addObject/remove/addObject renders like a scene that never touched addObject") — real, but not sensitive to the actual allocation-eagerness mutation (confirmed empirically in round 1: forcing the `CellGrid` path unconditionally left the full suite green, since the guarantee has no publicly observable side effect through the existing API). Round 2 adds a direct test via a new opt-in test seam, `globalThis.__glyphSceneObjectMapsAlloc` — the same idiom `__glyphPerf`/`__glyphRenderStage` already use elsewhere in `createGlyphScene.ts` (an inert global hook, fired only when a test sets it, at the exact moment `objectEntriesMap()`/`objectSamplersMap()` actually allocate). The behavioural test is KEPT alongside it (still useful — it pins the observable no-leak contract the direct probe doesn't cover), not replaced.

All four are mutation-verified: each named mutation was applied to `createGlyphScene.ts`, its test run in isolation and observed RED, then the file restored via `diff` against a pre-mutation copy and re-verified GREEN.

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

## D1 — 3D graph layout, `glyphDiagramObject` (`@glyphcss/diagrams/3d`)

**Goal.** Turn the existing `GlyphGraph` IR (the same one Mermaid/JSON
adapters already build, unchanged) into a `GlyphSceneObject` any
`createGlyphScene` can mount — an agent-architecture graph rendered as 3D
boxes on floors, with cell-space edges and labels, reusing F4's
composition primitive rather than inventing a parallel mesh/label system.

**Why layout is split into `layout3d` (pure data) and `glyphDiagramObject`
(mesh/overlay authoring).** The acceptance gates are almost entirely about
the LAYOUT math (rank order, determinism, face-anchoring) and have nothing to
do with `Polygon` authoring or the overlay/arbiter wiring — keeping
`layout3d` free of `boxPolygons`/`spherePolygons`/`GlyphSceneObject` lets
every layout gate run as a plain data test (no `document`, no scene, no
camera), the same split `@glyphcss/charts`' `buildGlyphChart`/`encodeGlyphChart`
(F1, above) already established for a different reason (reuse) applying here
for testability.

**Layered vs. force, and why `zBy` is layered-only.** Layered calls the
EXISTING 2D pipeline (`layoutGlyphGraph`, dagre) for X/Y verbatim — the same
`nodesep`/`ranksep`/compound-group machinery every 2D diagram already uses —
and adds Z as a purely semantic axis (`zBy: "group" | "kind" | "rank" |
"none"`, default `"group"`): each floor is `GLYPH_DIAGRAM_3D_LAYER_HEIGHT`
world units apart, indexed by the SORTED distinct key set (so re-running with
the same graph always assigns the same floor to the same group — no ordering
dependence on input order), with `undefined`/`""` always the baseline floor
`0`. `"group"` resolves a node's floor via the SMALLEST containing
`graph.groups` entry — deliberately mirroring `layoutGlyphGraph`'s own
compound-parent choice (`pipeline.ts`'s `.sort((a, b) => a.members.length -
b.members.length || …)[0]`) rather than the node's own `group` field, since
`graph.groups[].members` is what the 2D pipeline (and Mermaid's own subgraph
parsing) actually treats as authoritative; a node's plain `group` string is
descriptive metadata a caller may or may not have set. `"rank"` re-derives
rank BUCKETS from the already-computed 2D rank axis (Y for TB/BT, X for
LR/RL) rather than reaching into dagre's own internal rank numbering a
second time — the 2D layout already encodes it.

Force is a hand-rolled, SEEDED (`mulberry32`, a tiny public-domain 32-bit
PRNG — never `Date.now()`/`Math.random()`) Fruchterman-Reingold-style
simulation directly in 3D (repulsion every pair, spring attraction along
edges, an extra spring pulling each group's members toward their own
centroid) over a FIXED `iterations` count with a geometric cooling schedule —
no convergence check, no wall-clock budget, so "the same seed gives the same
digest" holds by construction rather than by luck. `zBy` does not apply to
it: force ALREADY places every node's Z from the simulation (springs act on
all three axes at once), so there is no separate "floor" concept left to
assign — passing `zBy` alongside `layout: "force"` is silently ignored
rather than rejected, since a caller sharing one options object across both
layout kinds (e.g. a UI toggle) shouldn't have to strip it.

**`boxPolygons` (core), not a rectangular special case of `cubePolygons`.**
`cubePolygons`'s `size` is one shared edge length; a diagram node's
footprint (from its label) is essentially never square. `boxPolygons` is the
same 8-vertex/6-face/CCW-from-outside construction with independent
`width`/`depth`/`height`, verified to reproduce `cubePolygons` byte-for-byte
at `width === depth === height` (`helpers.test.ts`) so the two stay
interchangeable rather than diverging geometry conventions. `circle`-shaped
nodes get `spherePolygons` instead (per the packet's own narrowed scope —
diamond/octahedron and stadium/cylinder are left to a later packet); every
other shape (`rect`/`rounded`/`subroutine`/`asymmetric`/`stadium`) is a box.

**A generic box-or-sphere surface anchor, not a per-layout anchor.** Both
layouts, both node shapes, and both same-floor and cross-floor edges go
through ONE function: walk from the node's center toward the OTHER
point, clamped to the box's half-extents by a standard 3D slab method (or to
the sphere's radius) — `t = min over axes of half[i] / |direction[i]|`. This
is what "edge endpoints land on node faces" reduces to as a single, layout-
agnostic property, gated directly (`layout3d.test.ts`) rather than asserted
per-layout. A cross-floor (layered) edge is built as an orthogonal 3D
polyline — anchor on the source's own floor toward the XY midpoint, step Z
at that midpoint (the "rank gap"), anchor into the target's own floor — so
the anchor computation for EACH end only ever sees a same-Z direction
vector, keeping the slab method's degenerate axis (`direction[2] === 0`)
trivially correct rather than a special case.

**Edges are overlay stamps, never tube meshes** (AGENTS.md's "Scene
objects" and this packet's own scope) — `stampGlyphOverlayLine` per segment,
picking one of four slope glyphs (`- | / \`) from the projected screen-space
delta, WITH `depth` (the real occlusion mechanism: a node box standing
between the camera and an edge segment wins the depth test, so an edge is
genuinely hidden behind a node rather than always drawn on top). No
arrowhead table — the full PLAN's §6 arrow-table sourcing from the 2D
canvas tier is out of D1's narrowed scope (a plain slope glyph is D2/D3's
to upgrade).

**Node labels: no `depth` on the candidate — a real bug, not a style
choice.** The first cut passed the anchor's own projected depth to
`frame.labels.place()`, on the theory that a label should depth-test like
anything else. It measurably broke: `glyphDiagramObject.test.ts`'s full-scene
mount test rendered `"Planner"` as `"@@--@\\--nner"` — an edge segment's
own per-cell INTERPOLATED depth (`stampGlyphOverlayLine`'s linear lerp along
the walk) happened to read fractionally NEARER than the label's own
`camera.project()` value at the shared cell, so `stampGlyphOverlayCell`'s
`existing > write.depth` check refused three of the label's seven
characters. The fix is not a tolerance fudge — it is recognizing that a
node's own label has NOTHING to depth-test against: occlusion by a genuinely
FOREIGN mesh is already the `ownMeshIds`/`winnerMesh` check the arbiter runs
(AGENTS.md's "Scene objects" Occlusion clause), and a label sitting just
above its own box, or crossing its own object's edge stamps, should always
win there. Omitting `depth` entirely (rather than, say, nudging the anchor
further above the box) is what makes that true unconditionally rather than
"true until a box gets tall enough" — the mutation gate reintroducing `depth`
on the candidate is exactly what would reproduce the cut-off-label defect.

**Group meshes: one mesh, not `detailGroup`.** PLAN-3d.md §6 describes
floor plates/volumes as needing to "cost one extra rasterizer pass in
total" across every group in the diagram — satisfied for free by building
ONE `"groups"` mesh whose polygon array concatenates every group's own quad
(layered, `transparent: true` — an x-ray floor a node can stand through
without being occluded) or wireframe box (force, `mode: "wireframe"`),
rather than one mesh per group sharing a `detailGroup` string. `detailGroup`
exists to remove the SEAM between multiple meshes forced into one pass; a
single mesh has no seam to remove, so reaching for it here would be
AGENTS.md's own "no defensive code for cases that can't happen".

**Rejected: a rectangular `planePolygons` call for the floor plate.**
`planePolygons` (core) takes one shared `size` half-extent for both in-plane
axes — square only. A group's XY bounding box is essentially never square,
so the floor plate is a small local quad builder instead (four vertices, CCW
from `+Z`), not a forced-square approximation of the group's real footprint.

**Gate.** `pnpm --filter @glyphcss/core exec vitest run` (780 tests,
including 5 new `boxPolygons` cases) and
`pnpm --filter @glyphcss/diagrams exec vitest run` (226 tests, including 11
`layout3d.test.ts` + 5 `glyphDiagramObject.test.ts` cases) pass;
`pnpm --filter @glyphcss/diagrams exec tsc --noEmit` is clean;
`pnpm --filter glyphcss exec vitest run src/api/createGlyphScene.sceneObject.test.ts`
(F4's own suite, untouched by this packet) stays green; `pnpm build:packages`
builds every package including the new `dist/3d.{js,cjs,d.ts}` entry, with
`glyphcss` staying an external `require`/`import` in it (grepped) rather than
bundled, and the diagrams root `dist/index.{js,cjs}` carrying no reference to
`buildCellGrid`/`createGlyphScene` (grepped) — confirming the root entry
never pulls the scene-object surface in.

**Mutation table.**

| Property | Mutation | Result |
|---|---|---|
| Top view reproduces 2D rank order | Map dagre's Y onto world X instead of world Y | `layout3d.test.ts`'s rank-order test reddens |
| Same seed → same digest | Seed `mulberry32` from `Date.now()` instead of `options.seed` | The PINNED golden-digest test reddens (fixed in D2's review pass — the original two-live-call comparison could pass by clock coincidence; see "D1 review fixes folded into D2") |
| Edge endpoints on node faces | Return the raw node center instead of the slab-clamped anchor | Both the layered and the force face-anchor tests reddens |
| Cross-floor edge actually crosses | Drop the Z-step bend, emit `[p0, p3]` only | The "z step in the rank gap" test's `new Set(zs).size > 1` assertion reddens |
| No two labels overlap | Omit `priority`/`degree` from the candidate | The degenerate-projection arbiter test's surviving-cell assertion reddens |
| `boxPolygons`/`cubePolygons` parity | Diverge the face/winding table between the two helpers | `helpers.test.ts`'s "reproduces cubePolygons exactly" case reddens |
| Root entry stays 3D-free | Add a `./3d` import to `src/index.ts` | The `dist/index.{js,cjs}` grep for `buildCellGrid`/`createGlyphScene` starts matching |

**Residuals (explicitly out of D1's narrowed scope, per §11's D2/D3/D4
rows).** No arrowhead table (plain slope glyphs only — still true after D2,
see below). No octahedron/cylinder node shapes (diamond/stadium fall back to
a box). No `/diagrams` page wiring (D2 added `renderGlyphDiagram3d`/CLI
dispatch — see the D2 section below; the page toggle/camera-in-URL/tray
tiles stay D3). No edge labels or cluster volumes beyond the group mesh
(D4). No performance gate at 200 nodes (D4) — the force O(n²) simulation is
unbounded here, matching the PLAN's own stated ~200-node ceiling for a
future Barnes-Hut upgrade.

**Fixed: the shared arbiter printed a label straight through a foreign mesh
covering a middle character.** D1's node labels carry no `depth` (the
comment above `frame.labels.place` in `glyphDiagramObject.ts` explains why
not), which is what made the defect reachable from this packet — the arbiter
itself lives in `packages/glyphcss/src/render/overlay/labelArbiter.ts`, not
here, and is shared with C1's surface tick labels. `resolve()` checked
occlusion at the candidate's ANCHOR cell only; a foreign `winnerMesh` under
any LATER character (a node box straddling behind an edge or a taller
neighbour's box) painted the whole label anyway, since
`stampGlyphOverlayCell` silently no-ops an individually-occluded cell rather
than refusing the label. Fixed by scanning every one of a label's own cells
before painting any of them and dropping the whole label — treated as
unplaced, like a collision — the instant one is covered by a foreign mesh
(`CellGrid.winnerMesh` outside `ownMeshIds`) or cross-layer `occluded`; a
label's own object's mesh still never hides it, and a plain
grid-with-neither-buffer render is byte-identical. AGENTS.md's "Scene
objects" Declutter clause carries the contract; `labelArbiter.test.ts`'s
mutation table (anchor-only check, own-mesh-as-foreign, no-`occluded`-check,
no-mesh-buffers-at-all) is the gate, reproduced against the pre-fix code to
confirm each one actually reddens there.

## D1 review fixes folded into D2

The codex (`gpt-5.6-sol`) review of D1 came back REJECT on three findings,
addressed here rather than as a separate D1 fixer round (the coordinator's
call — they sit in files D2 already owns).

**P1-a: the default/showcase framing painted ZERO node boxes, not just a
label.** Reproduced directly: `glyphDiagramObject`'s node boxes are sized in
the 2D layout's own CELL units (halfX/halfY 4.5-9 world units for the
4-node fixture) while `createGlyphOrthographicCamera`'s own default `zoom`
is `0.65` — CSS pixels per world unit, tuned for unit-scale authored
geometry — and the D1 test's own hardcoded `zoom: 4` was in the same wrong
regime. `col = centerCol + r[0]*zoom/cellPxW` with `cellPxW = 25` (the
headless `BASE_TILE / cellAspect` default): a 16-unit-wide box projects to
under half an output COLUMN at either zoom, so the solid rasterizer's own
depth-tested fill painted nothing — the ONE label that survived did so
because a label anchor is a single POINT, not an area, so it needs no
minimum screen size to register. This was not a rendering bug (`boxPolygons`
reproduces `cubePolygons` byte-for-byte, `render3d.test.ts`'s own isolated
box-render sweep across zoom/rotation confirms plain `boxPolygons` geometry
paints correctly once zoom is in the right regime) — it was every consumer
of this object needing to pick a camera scaled to the object's OWN world
extent, which is exactly what D2's `fitCamera` (below) does. Fixed at the
root two ways: (1) `renderGlyphDiagram3d`'s auto-fit, so the library itself
never ships a wrong default; (2) `glyphDiagramObject.test.ts`'s own
scene-mounting test now calls `renderGlyphDiagram3d` to pick its camera and
asserts REAL painted geometry (a non-label, non-blank cell count) — reverting
to the old `zoom: 4` reproduces the zero-cell regression and reddens it.

**P1-c: a self-loop's two endpoints collapsed onto the same point.**
`nodeSurfaceAnchor`'s `toward === center` degenerate case (`len === 0`)
returns bare `center` — correct for "no direction to anchor toward," wrong
for a self-loop, where `from`/`to` are literally the same node and `toward`
IS `center` by construction, not degenerately. Fixed with `selfLoopPoints`
(`layout3d.ts`): two DIFFERENT off-axis directions (tilted toward `+X`-ish
and `+Y`-ish, each nudged up in Z so a `zBy` floor's own gap can't
re-collapse them) through the SAME `nodeSurfaceAnchor` slab clamp every
other edge uses, plus a third point bulged out past the corner so the
3-point polyline reads as a loop leaving and re-entering the box rather than
a chord across it. Both endpoints verified on the node's own face/surface
for box AND sphere shapes, in both layouts (`layout3d.test.ts`'s new
"self-loops" block).

**P2: three mutation tests that couldn't fail.** The rank-order test used a
forward chain (`n0 -> n1 -> ... -> n(k-1)`) where id order and rank order
coincide, so a mutation swapping which dagre axis maps to world Y left the
sorted output unchanged whenever the "spread" axis was degenerate (one node
per rank) — reversed to `reverseChainGraph` (`n(k-1) -> ... -> n0`), where
rank order is the EXACT REVERSE of declaration order; reproduced the
mutation against the fixed test to confirm it now reddens
(`order2d: ["n4","n3","n2","n1","n0"]` vs. the mutated `order3d`'s
declaration-order fallback). The force-digest determinism test compared two
LIVE calls against each other, which a `Date.now()`-seeded PRNG can pass by
coincidence (two calls in one tick, same millisecond) — replaced with a
PINNED golden digest computed once and hardcoded. The force face-anchor test
asserted only "inside the box's half-extents," which a no-op clamp
(returning the box centre) also satisfies — added the layered test's own
"at least one axis is genuinely AT its half-extent" clause. The
shared-anchor label-priority test asserted only "some label survived,"
which passes even with `priority`/`degree` dropped (the id tie-break still
picks a winner) — rewritten to assert the SPECIFIC node degree analysis says
must win ("Planner", degree 3, strictly higher than every other node in the
fixture).

Out of scope here per the coordinator: labels painting through a foreign
mesh under one occluded character was fixed in glyphcss's shared label
arbiter by a different packet (this file's own "Fixed: the shared arbiter"
note under D1, folded in by the `feat/diagrams` merge); the diagrams-root-
loads-glyphcss-root P2 predates D1 and stays deferred.

## D2 — `renderGlyphDiagram3d`, CLI dispatch (`@glyphcss/diagrams/3d`)

**Goal.** A static frame of a `glyphDiagramObject`, the export boundary the
user approved (§11, "Decisions"): terminal, chat, Copy ASCII and the CLI get
a static frame at the current camera; a turntable stays a web-only export;
effects are preview-only everywhere. No DOM anywhere in this path.

**Why not extend `compileScene`.** F5 (§2.4 contract 3) was planned to teach
`compileScene` to accept `objects`/`textureSamplers` directly, but that
packet had not landed by the time D2 needed it, and D2's own scope is
`packages/diagrams/src/3d` plus the diagram CLI — not glyphcss's
`compileScene.ts`. `render3d.ts` instead composes the same PUBLIC primitives
`compileScene` itself is built from — `buildRasterizeContext` +
`rasterizeToCells` — with the `GlyphSceneObject` overlay contract
(`GlyphSceneOverlay.stamp(grid, frame)`, `createGlyphLabelArbiter`) that
`scene.addObject()` already runs on (`createGlyphScene.ts`'s
`applyGlyphSceneObjectOverlays`). Every mesh is flattened into ONE polygon
array with a `polygonMeshIds` parallel array (so `CellGrid.winnerMesh`
still resolves label occlusion), overlays stamp directly onto the resulting
grid, and the arbiter resolves through the SAME
`(arbiter as unknown as { resolve(grid) }).resolve(grid)` cast
`glyphDiagramObject.test.ts`'s own gate already uses — `resolve` is
deliberately not on the public `GlyphLabelArbiter` type (only `place` is;
resolving is the scene's own call), so this reaches it exactly the way the
existing test does rather than inventing a second contract.

**Byte-identity, and its one honest exception.** `render3d.test.ts`'s own
gate builds an EXPLICIT camera (auto-fit off, so nothing is computed
independently on either side), renders through `renderGlyphDiagram3d`, then
mounts the SAME object in a real `createGlyphScene` with the identical
`rotX`/`rotY`/`zoom`/`target`/lighting and asserts `result.text ===
scene.output.textContent` — verified to actually compare (skipping the
overlay-stamp loop in `render3d.ts` reddens it, confirmed by mutation).
What this CANNOT cover: `glyphDiagramObject`'s own `groups` mesh sets
`transparent: true` (layered) or `mode: "wireframe"` (force) — either
triggers AGENTS.md's own detail-layer separation rule in a LIVE scene (a
private, translated `<pre>`), which a flat static render has no
representation for at all (AGENTS.md's "Compilation": "Static compile takes
a flat polygon list and cannot represent detail layers" — an existing,
pre-D2 constraint, not a new gap this packet opened). `render3d.ts`
flattens `groups` into the SAME single pass regardless, matching
`compileScene`'s own precedent; the byte-identity gate therefore only
claims equality for a GROUPLESS graph, and says so in the module's own doc
comment rather than silently.

**Auto-fit: measure, don't estimate.** A node's LABEL is a fixed cell width
regardless of zoom (unlike geometry, which scales with it), so no closed-form
expression over `object.bounds` alone can promise every label stays on
screen — the same reason `compilePolygons`' own `autoFit`
(`@glyphcss/compile`) probes a real render and measures rather than
computing a bound. `fitCamera` does the same in two passes: (1) render at a
CONSERVATIVELY SMALL probe zoom (derived from the object's own world extent,
so a probe never overflows its own generous 220x130 frame) and measure the
occupied cell box — geometry AND stamped labels, since both painted the
SAME real grid; (2) scale `zoom` by exactly the ratio needed to fill the
REQUESTED `cols`x`rows` minus a fixed margin, and RECENTRE via
`camera.center` rather than `camera.target`: `col = centerCol +
r[0]*zoom/cellPxW` and `centerCol = cols*center[0]` is a pure ADDITIVE term
in the already-rotated projection, so shifting `center` shifts every
projected column by the identical amount with no rotation to invert — moving
`target` instead would shift the PRE-rotation input, needing the camera's
own inverse rotation to solve for. Gate: `render3d.test.ts` renders the
4-node fixture AND a 6-node, denser supervisor-style fixture at the SAME
`cols`x`rows` and asserts every label is on screen in BOTH — a zoom hardcoded
for one graph provably cannot also fit the other, so this is the genuine
"auto-fit, not a lucky constant" proof; reproduced the "fixed zoom" mutation
directly (bypassing the probe/scale computation) to confirm it reddens the
smaller graph's own assertion first.

**Charset maps onto the SCENE's render vocabulary, not 2D's canvas tiers.**
2D diagrams paint through `GLYPH_CANVAS_TIERS` (`ascii`/`box`/`blocks`/
`braille`), a hand-painted box-drawing/junction glyph set with no analogue
in a Lambert-shaded rasterized scene. `resolveCharset` maps each 2D charset
name onto the (`mode`, `charMode`) pair the scene rasterizer actually has:
`ascii`/`box` -> solid + `charMode: "ascii"` (no visual difference between
the two for a rasterized mesh — the distinction is real in 2D's own
box-drawing junction table, not here); `blocks` -> the SAME solid ascii
render, because `charMode: "quadrant"`/`"halfblock"`'s dual-colour encoder
is a documented no-op with `CellGrid`/`transformCells`
(`RasterizeContextOptions.charMode`'s own doc: "so `CellGrid`/
`transformCells`/the generic effect [system] don't apply") — exactly the
buffer this renderer's overlay stamps depend on, so honouring the request
literally would silently drop every edge and label; `braille` -> wireframe
(AGENTS.md's render-modes table: braille is a documented no-op outside
wireframe). Both degrades log `ledger3dCharsetDegraded` (a new
`3d-charset-degraded` code, `ledger3d.ts`) rather than silently drawing
something else. Target defaults are their OWN table
(`GLYPH_DIAGRAM_3D_TARGET_DEFAULTS`), not 2D's `GLYPH_DIAGRAM_TARGET_DEFAULTS`
— 2D defaults to `braille` on terminal/web for its own sub-cell box-drawing
reasons; a solid Lambert-shaded 3D scene wants `box`/ascii as its natural
default everywhere, matching the website plan's own "Output: braille dims
in 3D" note.

**Three exits, over a real `GlyphCanvas`.** `text`/`ansi`/`html` reuse
`encodeGlyphCanvasText`/`Ansi`/`Html` — the same NO_COLOR/FORCE_COLOR-aware,
HTML-escaping exits 2D diagrams use — rather than the bare-`CellGrid`
encoders (`encodeGlyphBuffers`/`encodeCellGrid`), which have neither
property and would let a Mermaid-authored label's own `<`/`>`/`&` leak
unescaped into HTML output. The rasterized+overlaid `CellGrid` is copied
cell-by-cell into a fresh `createGlyphCanvas` via `canvas.text()` (paying
one call per non-space cell — trivial at 72x24..96x32) rather than mutating
`canvas.grid` directly, so every canvas invariant (single-cell-glyph
validation, canonical-hex colour validation) still runs on this content
exactly as it does on 2D's own hand-painted cells.

**CLI.** `glyphcss diagram <file> --3d [--layout layered|force] [--camera
rotX,rotY[,zoom]]` (`diagramCli.ts`) — `--3d` dispatches `renderCli` to
`renderGlyphDiagram3d` instead of the 2D pipeline; every other flag
(`--target`/`--charset`/`--color`/`--width`/`--height`/`--direction`/
`--title`) is shared verbatim between both paths, since both render
options accept the same names. The ledger prints to stderr one entry per
line (`glyphcss: <code>: <message>`), a bad `--camera`/`--layout` value
throws `bad-options` at PARSE time (before any render), and a good render
still exits 0 even when the requested camera clips content — a camera
choice, never an error.

**Gate.** `pnpm --filter @glyphcss/diagrams exec vitest run` (244 tests:
14 `layout3d.test.ts` + 5 `glyphDiagramObject.test.ts` + 8
`render3d.test.ts`, plus every pre-existing 2D suite untouched) and
`pnpm --filter @glyphcss/compile exec vitest run` (67 tests, 24 in
`diagramCli.test.ts` including the new `--3d` block) pass;
`pnpm --filter @glyphcss/diagrams run typecheck` is clean; `pnpm
build:packages` builds every package including `packages/diagrams/dist/
3d.{js,cjs,d.ts}` and `packages/compile/dist/cli.{js,cjs}` with no errors.

**Mutation table.**

| Property | Mutation | Result |
|---|---|---|
| Auto-fit shows every label at both graph sizes | Skip the probe/scale computation, use a fixed zoom | `render3d.test.ts`'s "every node label visible" case reddens on the smaller graph |
| Static frame equals live frame | Skip the `overlay.stamp()` loop in `renderObjectGrid` | The byte-identity test's `toBe` reddens |
| `blocks`/`braille` degrade, never silently misrender | Drop the `ledger3dCharsetDegraded` push | The target×charset×colour matrix test's ledger-code assertion reddens |
| NO_COLOR honoured | (inherited from `encodeGlyphCanvasAnsi`, not re-implemented here) | The matrix test's no-SGR-escape assertion reddens if `env` isn't forwarded |
| `--3d` actually dispatches to the 3D pipeline | Route `is3d` through `renderGlyphDiagram` instead of `renderGlyphDiagram3d` | `diagramCli.test.ts`'s "real 3D frame" case reddens (no box-drawing/solid-ramp glyphs, no plain-slope edge chars) |
| Bad `--camera`/`--layout` rejected before rendering | Skip the `Number.isFinite`/`choice()` validation | `diagramCli.test.ts`'s malformed-option cases reddens |

**Residuals.** The arrowhead table stays plain slope glyphs (D1's own
residual, unchanged by D2 — see the review-fixes section above). A grouped
graph's `groups` mesh renders in the SAME pass as every node (no
translucent floor plate / wireframe volume distinction a live scene would
give it its own detail layer for) — the byte-identity claim is scoped to
groupless graphs, stated in `render3d.ts`'s own doc comment. `/diagrams`
page wiring (View 2D/3D toggle, camera in `?d=`, 3D tray tiles) is D3's
scope, untouched here.

## D3 — `/diagrams` page: view switch, live orbit viewport, presets, effects

**Goal.** `/diagrams` hosts both 2D and 3D, per §11's D3 row: a Dock View
toggle, a live orbitable `web` viewport reusing D2's own auto-fit, Copy at
the current camera, `?d=` state, 3D tray presets, and the target × charset
× colour matrix extended to 3D. All page code; `packages/diagrams/src`
untouched (the coordinator's own mid-task note: D2's frame content was
being fixed in a parallel round, so this packet asserts PAGE BEHAVIOUR —
the view switch, URL round-trip, Copy-at-camera, faithful downgrade — never
specific 3D frame bytes, which change under it).

**Why the live viewport reuses `renderGlyphDiagram3d` for its initial pose,
not a second fit implementation.** `fitCamera` (D2, `render3d.ts`) is not
exported — it is an implementation detail of the static-frame renderer — so
`Diagrams3DViewport.tsx` calls the PUBLIC `renderGlyphDiagram3d` itself,
once, at a fixed 96×32 probe target, and takes its `{ object, camera }`
verbatim as the live scene's starting mesh and camera. This is exact, not
approximate: `camera.center` is a FRACTION of the grid and `zoom` is
CSS-px-per-world-unit (this file's own numeric conventions), both invariant
to the live scene's OWN `cols`/`rows` (which `autoSize` derives from the
host element's measured size, unknown at fit time) — a camera fitted at one
grid size therefore centres and scales correctly at any other. This is the
"reuse it, never tune a constant" requirement satisfied literally: the page
never computes a zoom, never picks a margin, never estimates a bounding
box — it calls the same function the CLI and Copy do.

**Why orbit controls, once mounted, ignore `state.camera3d` in their
effect's dependency array.** The live viewport's `useEffect` deps are
`[graph, layout, zBy, seed, direction, nodesep, ranksep, controlsMode]` —
deliberately NOT `initialCamera` (`state.camera3d`) or either callback,
which are read through a `latest` ref inside the effect instead. Including
`camera3d` would create a mount→drag→settle→remount loop: the orbit
controls' own `"end"` handler writes `state.camera3d`, which would then
re-trigger the mounting effect, tearing down and rebuilding the whole scene
on every drag release purely to hand it back the pose it already has.
Excluding it means the SAME scene survives an arbitrary number of drags;
only a genuine mesh change (a different graph, layout, `zBy`, seed, or
`nodesep`/`ranksep`) remounts it, which is also the only case the OLD
camera could be wrong for a NEW mesh.

**Why `state.camera3d` resets on a `set-view3d`/`apply-preset` dispatch,
never on a target/charset/colour edit.** The reducer clears `camera3d`
exactly when the MESH changes (`set-view3d`'s `layout`/`zBy`/`seed`/
`controlsMode` patch, any `apply-preset`, any `set-view` switch) — a
different layout has a different `bounds`, so an old camera can clip or
mis-centre it; a target/charset/colour edit changes only how the SAME mesh
is encoded, so the camera the reader chose survives it. This is what makes
"Copy reads the current camera" and "the live viewport survives a Dock
edit" the same invariant rather than two rules that could drift.

**Copy ASCII/ANSI: one static render, shared by every target.**
`renderGlyphDiagramsWorkbenchState3d` — the SAME function whether the
target is `web`, `terminal` or `chat` — passes `state.camera3d` straight
through to `renderGlyphDiagram3d` when set, and omits it (auto-fit) when
not. On `terminal`/`chat` this IS the on-screen frame (mounted through
`TargetPreview`, per D2's export boundary). On `web` it is a SEPARATE
static render at the SAME camera the live scene is currently posed at —
Copy on `web` has no `<pre>` string of its own to read (a live scene is
geometry + overlays, not text until rasterized), so this is the only way
"what you copy is what you see" can be literally true there; it is
computed by its own effect (gated on `state.view === "3d"`, so 2D pays
nothing) rather than read off the live scene's own last-rendered string,
because the live scene's `<pre>` content is glyphcss's own internal
render, not a value this page holds.

**Why `chat` needs a SECOND, page-level braille downgrade on top of D2's
own.** D2's `resolveCharset` degrades `braille` from solid to WIREFRAME —
but a wireframe rendered with `charMode: "braille"` still draws REAL
braille dot glyphs, which is the charset working as designed, not a
downgrade a chat client needs protecting from. What chat actually can't
show is the braille Unicode BLOCK itself (no chat client's fenced-code font
carries U+2800-28FF — the same fact AGENTS.md's "Targets and page" states
for 2D). `chatCharsetDowngrade3d` (`diagramsWorkbenchRender.ts`) applies
the identical `braille -> box` substitution the 2D path already does,
before D2's own render call, so `charsetDowngraded` is `true` whenever
EITHER downgrade fired and the text genuinely contains no braille glyphs
on `chat` specifically — verified by asserting the OPPOSITE on `terminal`
(same charset, same options, real braille glyphs expected) in the same
test, so the assertion can't pass by coincidence.

**Datasets: two labelled examples, one real vendored graph.** The
supervisor→workers and multi-agent-crew 3D presets are hand-authored,
explicitly labelled "(3D, example)" — never presented as telemetry from a
real system. Zachary's karate club (`karate-club.mmd`) is the one real
dataset: 34 members, 78 edges, reproduced from the standard, widely-cited
edge list (verified against script-generated counts before being checked
in — see `datasets3d/LICENSES.md`), with the historical Mr. Hi / officer
faction split encoded as two Mermaid `subgraph`s so the force layout's
group-attraction spring (AGENTS.md's "Diagrams 3D") pulls each faction
toward its own centroid — the split reads as spatial clustering the layout
DISCOVERS from real edges plus real group membership, not a claim drawn on
top of the picture.

**Target × charset × colour matrix: unit-level, not a second 60-cell DOM
sweep.** The existing 2D matrix (`diagramsWorkbenchTargetMatrix.test.tsx`)
drives the full mounted page through all 60 cells; repeating that at full
DOM cost for 3D would roughly double the suite's slowest file for redundant
coverage, since the DOWNGRADE and ENCODING logic under test
(`renderGlyphDiagramsWorkbenchState3d`) is pure and target/charset/colour
never touch the DOM layer differently in 3D than in 2D (both funnel through
the SAME `TargetPreview`). `diagramsWorkbenchRender3d.targetMatrix.test.ts`
instead sweeps all 60 cells at the pure-function level (asserts every cell
renders non-empty text, never throws) plus dedicated cases for the two
degrade paths (braille -> wireframe always; the chat-only braille-glyph
strip; blocks -> solid ascii always) and the `color: "css"` -> `html`
guarantee — cheap enough to run the full sweep rather than sampling it.

**Effects folder — built, minimally.** §11's D3 row lists "the Effects
folder with per-node targeting" in its scope; §3's acceptance is narrow
("highlighting one node's mesh leaves the others unchanged"). Residual, not
built in this pass: the coordinator's own scope note prioritised the
literal D3 bullet list (view switch, camera, URL state, presets, matrix)
given the parallel library fix round in progress under `packages/diagrams/
src` — see this packet's own top-of-file "Goal" paragraph. A minimal wiring
(`scene.addEffectLayer(effect, { target: handle.meshes.get("node:<id>")
})`, reading `GlyphSceneObjectHandle.meshes` off `Diagrams3DViewport`'s own
mount) is the documented next step; `glyphDiagramObject`'s stable
`node:<id>`/`groups` mesh names (D1) are exactly what it would target.

**Gate.** `pnpm --filter @glyphcss/website exec vitest run
src/components/DiagramsWorkbench` — 218 tests across 7 files (the existing
60-cell 2D matrix untouched, 65 in the new 3D matrix file, 29 state tests,
26 URL round-trip tests including every tray preset — 2D and 3D alike — and
the pinned pre-D3 historical link, 6 view-switch/camera tests, 28 in the
mounted-integration suite including both 3D preset cases). `pnpm --filter
@glyphcss/website exec vitest run` — full website suite, 137 files / 2376
tests, green (confirms no collateral damage to `/charts`, `/maps`, or any
other page). `pnpm build:packages && pnpm -C website build` — both clean.

**Mutation table.**

| Property | Mutation | Result |
|---|---|---|
| View switch mounts the live scene, not the 2D frame | Render `TargetPreview` unconditionally regardless of `state.view` | `DiagramsWorkbench.3d.test.tsx`'s "mounts the live scene host" case reddens |
| 3D on terminal/chat uses the static frame, never a live scene | Route the live viewport branch on `state.view === "3d"` alone (drop the `target === "web"` clause) | The "uses the static TargetPreview frame" case reddens |
| Copy reads `state.camera3d` when set | Drop the `camera` field from `glyphDiagramsWorkbenchRenderOptions3d`'s return | The pure options test reddens |
| A layout/zBy/seed/controlsMode edit re-fits (never keeps a stale camera) | Drop the `camera3d: undefined` reset from the `set-view3d` reducer case | The reset test reddens |
| `?d=` round-trips `view`/`view3d`/`camera3d`, old links unaffected | Remove the append-only validators, or mutate the pinned historical-link fixture's expected decode | `diagramsUrlState.test.ts`'s new round-trip cases AND the pre-existing historical-link pin both reddens |
| Every 3D target × charset × colour cell renders | Force `renderGlyphDiagram3d` to reject `charset: "blocks"` | `diagramsWorkbenchRender3d.targetMatrix.test.ts`'s full sweep reddens on every `blocks` cell |
| `chat` + `braille` strips actual braille glyphs (page-level, on top of D2's own wireframe degrade) | Drop `chatCharsetDowngrade3d` | The chat-strips/terminal-keeps pair reddens (only the `chat` half) |
| Karate club's two real factions cluster via the layout's own group-attraction | Delete the fixture's `subgraph` blocks | `layout3d`'s own group-attraction has no groups to pull toward (visual-only; no dedicated D3 gate — D1's own layout gates cover the mechanism) |

**Residuals.** Per-node effects targeting (documented above, not built).
No edge labels in 3D (D1's own residual, unchanged). No cluster volumes
beyond the existing group mesh (D4). No performance gate at 200 nodes (D4).

## Packet F3 — the DOM-free compositor, `composeGlyphChartEffects`, `glyphGridDecalEffect`

### Why `pre` had to leave the metadata type, and what replaced it

`GlyphEffectOutputMetadata` carried `pre: HTMLPreElement` because the scene
needed, at compose time, to know which output element a retained output's
encoded string gets written to (`commitRender`'s `writes` array). That is a
real need, but it belongs to `createGlyphScene.ts`, not to the compositor —
`composeGlyphEffects`'s whole point is running with no DOM at all, and a
required-but-ignorable `pre` field is exactly the kind of "never
dereferenced, just satisfies the type" field `@glyphcss/effects`'
`staticExport.ts` was already carrying (`pre: null as unknown as
HTMLPreElement`, with a comment explaining why) before this packet — a
tell that the field was in the wrong place. The fix is not a new persistent
map (`id -> pre`) either, which would have to be kept in sync with every
detail-layer mount/removal and outlive layers it no longer describes;
instead `renderRetainedEffects` resolves a `pre` element BY THE SAME ID
SPACE the metadata already uses (`"base"` or `` `detail:${group.id}` ``)
through `detailLayers` — the persistent, self-cleaning `Map<number,
DetailLayerState>` every other detail-layer write already reads from in the
same function. Zero new state, and it cannot go stale: a removed detail
group is a removed `detailLayers` entry, the same event that already ends
its participation in `retainedEffectOutputs`.

### Why coverage became an explicit parameter instead of a derived one

`retainGlyphEffectOutput` used to compute `baseCoverage[i] =
Number.isFinite(baseGrid.depth[i]) ? 1 : 0` unconditionally — a rule that is
exactly right for a scene render (a finite depth IS "something is here") and
meaningless for a grid with no camera, where `depth` is a required
`CellGrid` field carrying whatever a caller happened to put there (often
`-Infinity` everywhere, from `buildCellGrid`'s own default). Baking the rule
in meant a camera-less caller had no way to say what "covered" means for
its own kind of grid. `GlyphEffectRetainOptions` splits it into two
independent, explicit inputs: `coverage` (required — what `"surfaces"`/
`"viewport"` targeting and `base.coverage` read) and `hasDepth` (optional,
default `true` — whether `base.depth` is populated AT ALL). The scene keeps
its exact prior behaviour with a one-line change at each of its two
`retainGlyphEffectOutput` call sites (`{ coverage:
glyphEffectDepthCoverage(grid) }`, the extracted helper); `hasDepth`'s
default staying `true` there is what makes that a no-op rather than a
second required change. `composeGlyphEffects` inverts both defaults for the
opposite reason: `coverage` defaults to fully-covered (the least-surprising
answer with no scene to ask), and `hasDepth` defaults `false` ("no camera"
is precisely what a grid with no real depth means).

### Why `depth` needed a new hard-requirement guard, and why it never mattered before

`composeRetainedGlyphEffectOutput` already guarded six requirements
(`baseShade`, `worldPosition`, `objectPosition`, `objectExit`, `normal`,
`objectNormal`) against being requested by a program when the retained
`base` view doesn't actually carry that buffer. `depth` was never on that
list, because before this packet it was IMPOSSIBLE for `base.depth` to be
missing — `retainGlyphEffectOutput` copied `baseGrid.depth` into `base`
unconditionally, since `CellGrid.depth` is a non-optional field. Once
`hasDepth` can be `false`, `base.depth` genuinely becomes absent for the
first time, so the guard needed a seventh clause — and it needed to REJECT,
not silently hand a program `undefined`/garbage depth, which is what
motivated the new tagged error rather than reusing the existing bare
`Error` throws: `GLYPH_EFFECT_REQUIREMENT_UNAVAILABLE` is a `code` a caller
(a Dock, a test, `composeGlyphChartEffects`'s own callers) can match on
without parsing a message string. The other six guards were converted to
the same tagged class in the same edit — not because their behaviour
changed (same throw, same message text, same call sites), but because
having two different "a hard requirement can't be met" error shapes in one
file depending on which requirement failed would have been an arbitrary
distinction with no caller-visible reason.

### `composeGlyphEffects`: reusing the mount path with no live handle

The temptation was to write a second, simpler param-validation/blend path
for the one-shot case. Instead `composeGlyphEffects` calls
`createRuntimeGlyphEffectLayer` once per layer (with no-op `onDirty`/
`onDispose` — nothing here ever mutates a layer's params after construction,
so they are never invoked in practice), then the EXACT `prepareRuntimeGlyphEffectLayers`
→ `retainGlyphEffectOutput` → `composeRetainedGlyphEffectOutput` sequence
the scene's own `renderRetainedEffects` runs. This is what makes "runs the
SAME compositor a mounted scene layer does" true by construction rather
than by two implementations happening to agree, and it is what gives byte-
identical determinism for free: a fresh `RuntimeGlyphEffectLayer` (and, for
a program declaring one, a fresh `program.createState()`) is built on every
call, and `retainGlyphEffectOutput` is handed no `previous` to pool a
working buffer against — there is no persistent object anywhere a second
call could observe the first one having happened. `field-synth`'s own
`createState()` (`{ carveInk: createCarveInkScratch() }`) was checked
specifically: it is a per-frame SCRATCH allocation for the volumetric
render path, not accumulated state, so discarding and rebuilding it every
call changes nothing about the computed output.

### `composeGlyphChartEffects`: what a canvas can honestly offer, computed at the bridge, not the canvas

Contract 5 (canvas-owned ink coverage/shade/`surfaceUv`) is F2's packet, not
landed as of F3. Rather than block on it or duplicate its future storage,
`composeGlyphChartEffects` computes `baseShade` (ink coverage: painted =
`1`, blank = `0`) and `uv0` (plot-rect-normalized position, `NaN` outside
the plot rect) itself, on a SHALLOW clone of the canvas's own grid
(`{ ...grid, shade, surfaceUv }` — safe because `composeGlyphEffects`, via
`retainGlyphEffectOutput`, deep-copies every field into its own snapshot
before the original could be read again, so sharing the untouched
`char`/`color`/`depth` array references costs nothing and mutates nothing).
If/when F2 lands real canvas-owned buffers for these, this bridge is the
one place that would stop re-deriving them — the bridge's own contract
(`baseShade` = ink, `uv0` = plot-rect position) does not change either way.
Every OTHER requirement (`depth`/`normal`/`worldPosition`/`objectPosition`/
`objectExit`) is simply absent on a `createGlyphCanvas` grid already (it
only ever calls `buildCellGrid` with `char`/`color`/`depth`, nothing else),
so no chart-specific exclusion logic was needed for them at all — they
fall out of the SAME structural gating `retainGlyphEffectOutput` already
does for a scene's optional buffers.

The returned `GlyphChartBuild`'s `canvas`/`colorCanvas` are
`GlyphCanvas`-shaped wrappers (`composedCanvas`) around the composed grid,
carrying every OTHER canvas buffer (`bg`/`sub`/`textScale`/`textFiller`/
`textFillerBelowOrigin`/`report`) through unchanged — effects replace glyph
and colour only, never a canvas's own background or sub-cell occupancy,
mirroring the scene's own retained-effect contract. The six painter methods
(`fillRect`/`line`/`text`/`arrowhead`/`edge`/`route`/`resolveJunctions`)
are stubs that throw: a composed canvas is a TERMINAL artifact for
encoding, the same role a mounted effect layer's own retained output plays
for a scene — nothing paints on it again. `time`, when passed, merges into
a DEFINITION-shaped layer's own `params.time` only when that layer's
`parameterSchema` actually declares a `time` key AND the caller didn't
already set one — checked structurally (`"time" in schema`) rather than by
name-matching a stock effect, so it works for any definition with a `time`
parameter, present or future, and is a true no-op for a raw-program layer
(which has no schema to introspect and must already supply complete
params).

### `glyphGridDecalEffect`: nearest, never bilinear, and why colour is the gate

The effect samples `uv0` per output cell, floors it to the SOURCE grid's
own `(col, row)`, and writes that cell's exact `char`/`color` — no
interpolation. The design note this replaces briefly considered bilinear
colour blending for a softer look at non-integer scale factors, and
rejected it for the reason the packet's own acceptance clause names
directly: there is no such thing as a blended GLYPH (`char` is a single
codepoint, not a continuous quantity), so averaging colour while picking
glyph from an arbitrary one of the blend's sources would silently corrupt
colour with no visible glyph-level symptom. `decal.test.ts`'s 1:1 gate
therefore asserts `composed.color` (not only `composed.char`) against a
CHECKERBOARD of high-contrast adjacent colours specifically — a colour-only
assertion is what a bilinear mutation actually reddens; a glyph-only one
would not. Verified directly: patching the effect to average each sampled
colour with its right neighbour's turns the 1:1 test red (`#ff0000`/
`#0000ff` corners land on `#808000`/`#808080` instead of their own exact
hex), confirming the gate is load-bearing before the patch was reverted.

The source grid rides as `program` (VOLUMETRIC-3.md §4's opaque,
definition-owned payload) rather than a data param, because that IS the
shape `program` exists for — and it makes a live chart update a `program`
change, which is immutable after mount by the existing rule (remove and
re-add the layer), so a decal never has to reconcile a grid resize or
dimension change mid-flight.

### Gates and mutations (packet F3)

| Gate | Mutation applied | Result |
|---|---|---|
| All nine stock effects run on a chart grid | — (positive assertion; `composeOnChart.test.ts` iterates `GlyphEffectCatalog`) | 9/9 compose with no throw |
| A hard requirement the grid can't supply rejects with its code | — (`composeGlyphEffects.test.ts`/`effectsBridge.test.ts` mount a `requirements: ["depth"\|"worldPosition"]` program on a camera-less grid) | `GlyphEffectRequirementUnavailableError`, `.code === GLYPH_EFFECT_REQUIREMENT_UNAVAILABLE` |
| Composing twice at the same `time` gives identical bytes | — (call `composeGlyphEffects`/`composeGlyphChartEffects` twice with the same inputs) | `char`/`color`/encoded text deep-equal across calls |
| The decal writes the exact chart glyph at 1:1 | Nearest sample → average with the right-neighbour cell's colour | RED — corner colours land on a blended hex no source cell carries |
| The existing scene effects suites stay byte-identical | — (full `pnpm --filter glyphcss test`, `pnpm --filter @glyphcss/effects test`) | 1188/1188 and 679/679 pass, unmodified |

Each mutation above (the decal's) was applied to the working tree, run,
observed red, then reverted and re-verified green.

### F3 fix round 1 (codex review of cfaf86e0)

Four findings, each fixed at the layer that owns the behaviour:

1. **Coverage/`baseShade` ignored `canvas.ink`.** `effectsBridge.ts` derived
   both from `grid.char !== " "`, which reports 0 for a `shade: 0`
   painted-but-blank cell — exactly the case "Cell canvas" contract 5 exists
   to distinguish from "never addressed". Fixed by reading `canvas.ink`
   directly; `baseShade` stays binary (painted = 1, blank = 0), matching the
   AGENTS.md wording that was already correct — only the SOURCE was wrong.
2. **Field-synth carve/xray silently became paint on a camera-less grid.**
   PLAN-3d.md §8 requires a reject, but `objectPosition`/`objectExit` reach
   the compositor only through `dynamicRequirements`, which is deliberately
   degrade-only (a mounted scene's wireframe/voxel fallback depends on
   that). Hard-failing every dynamic requirement would also kill field-
   synth's legitimate `space: "object"`/`render: "paint"` 2D fallback on a
   camera-less grid — not what §8 asks for. Fixed with a new, narrower
   program hook, `hardDynamicRequirements(params)` (`packages/glyphcss/src/
   api/effects.ts`), checked ONLY by `composeGlyphEffects` (never by a
   mounted scene's `composeRetainedGlyphEffectOutput`, whose own guard stays
   static-only): field-synth's own `hardDynamicRequirements` names
   `objectPosition`/`objectExit` exactly when `render` is `"carve"`/`"xray"`
   (`packages/effects/src/stock.ts`), so a scene's wireframe/voxel degrade
   is untouched and a camera-less carve/xray patch rejects.
3. **The decal wasn't exact over blanks/null colours.** A blank source
   glyph emitted `coverage: 0` (`blend: "over"` then let the mesh's own
   glyph show through); a null source colour never set the COLOR channel at
   all (the mesh's own colour survived underneath). Both are "not exact
   1:1" — fixed by always emitting `coverage: 1` on a valid `uv0` hit and
   always emitting the COLOR channel, with `GlyphEffectNoColor` for a null
   source colour (`packages/effects/src/decal.ts`).
4. **The mutation gates were too weak to catch a regression on any of the
   above.** The decal's checkerboard test sampled only exact texel centres,
   where a bilinear reconstruction is indistinguishable from nearest (zero
   distance to either candidate texel); added an off-centre uv0 near the
   shared corner of all four source cells, where a bilinear blend would
   diverge furthest. The determinism test used a constant custom effect,
   which can't reveal a hidden non-deterministic source (`Date.now()`,
   `Math.random()`, leftover `state`) that only shows up when output
   actually varies with `time`; added `@glyphcss/charts`' own compose test
   against `@glyphcss/effects`' real `GlyphScrambleEffect` at a fixed `time`
   (`packages/charts` gained a `@glyphcss/effects` devDependency, aliased to
   source in `vitest.config.ts` like `glyphcss`/`@glyphcss/core` already
   are, so no `pnpm build:packages` is required to run the test).

Every row below was VERIFIED, not asserted: the fix was reverted in the
working tree, the named test run and observed red, then the revert undone
and the suite re-verified green.

| Finding | Fix location | Mutation (revert fix -> test red) |
|---|---|---|
| 1: coverage/baseShade ignore `canvas.ink` | `packages/charts/src/effectsBridge.ts` | Reverted `inkCoverage` to `canvas.grid.char[i] === " " ? 0 : 1` -> the new painted-blank-cell test failed (`expected [1] to deeply equal [0]`) |
| 2: carve/xray silently paint camera-less | `packages/glyphcss/src/render/effectCompositor.ts`, `packages/glyphcss/src/api/effects.ts`, `packages/effects/src/stock.ts` | Removed field-synth's `hardDynamicRequirements` entry -> both new `composeOnChart.test.ts` carve/xray reject tests failed (`expected undefined to be an instance of GlyphEffectRequirementUnavailableError`) |
| 3a: decal blank source coverage | `packages/effects/src/decal.ts` | Reverted `coverage[i] = 1` to `glyph === " " ? 0 : 1` -> the new painted-target blank-cell test failed (the target's own `"Q"` survived at cell 1 instead of `" "`) |
| 3b: decal null source colour | `packages/effects/src/decal.ts` | Reverted to the old `if (color != null)` gate (no `GlyphEffectNoColor` emission) -> the new painted-target null-colour test failed (the target's own `"#111111"` survived at cell 1 instead of `null`) |
| 4a: decal nearest-vs-bilinear gate | `packages/effects/src/decal.test.ts` | Inserted a real bilinear colour blend into `evaluate()`'s colour pick, in place of the nearest sample: the PRE-EXISTING exact-centre test still PASSED (`#ff0000` at its own texel centre — zero blend distance either way, the false negative the finding named), while the new off-centre test correctly failed (`expected "#807f40" to be "#ff0000"`) |
| 4b: determinism gate strength | `packages/charts/src/effectsBridge.test.ts` | Injected a module-level counter into `scramble`'s own `frame` calculation (`Math.floor(params.time * params.rate) + leftoverState++`, simulating a hidden non-deterministic source surviving between calls): the PRE-EXISTING constant-`paintZ` determinism test still PASSED, while the new scramble-based test correctly failed (two composes of the identical layers at the identical `time` produced different encoded text) |

## F5b — `compileScene` accepts `objects`, `textureSamplers`, returns `grid`

Contract 3's compile half (the orbit half, `pitchRange`/`mode: "trackball"`,
landed separately as F5). `createGlyphScene.ts`'s own object machinery
(`mountGlyphSceneObjectInto`, `applyGlyphSceneObjectOverlays`,
`withTransformCellsLayer`) is untouched — `compileScene.ts` re-derives the
same three things standalone (mesh-id assignment, the overlay registry, the
hotspot flatten) rather than importing scene internals, because a scene's
version is entangled with live mesh handles, `scheduleRender()`, and the
detail-layer machinery a flat static compile has none of. The one function
actually reused across the boundary is `encodeGlyphSceneObjectSamplerKey`
(pure, already exported) — duplicating its escaping rule would have been the
one place a drift could silently break the `glyph-object:<id>:<name>` key
two independent implementations must agree on byte-for-byte.

**No second transform parameter.** `scene.addObject(object, transform?)` has
one; `compileScene({ objects })` does not — every object mounts at the
identity, matching how the base `polygons` field already expects
already-positioned geometry rather than a transform to apply. Since
`transformObjectPoint(p, {})` reduces to identity anyway, a live scene's
`scene.addObject(object)` (no transform argument) and `compileScene`'s own
`toWorld: (p) => p` hand every overlay the IDENTICAL frame — which is what
makes byte-for-byte parity between the two paths provable rather than
merely plausible.

**One raster pass when overlays exist, not two.** The obvious shape — stamp
overlays into the string-producing pass, then call `rasterizeToCells`
separately for `grid` — invokes `overlay.stamp()` TWICE per `compileScene()`
call, silently wrong for any overlay carrying its own mutable state (a
counter, a running id) across calls, since a live scene calls it exactly
once per render. Instead the SAME hook attached to the string pass captures
a durable clone of the grid (`cloneCellGrid`, already public) as a side
effect the instant after stamping, so both outputs come from one walk of
the geometry. With NO overlay, `ctx.transformCells` is never set at all
(matching the option's total absence before this packet) and `grid` is
captured via a wholly separate `rasterizeToCells(ctx)` pass instead — this
is the byte-identity gate: `charMode: "halfblock"`/`"quadrant"` are
documented no-ops the INSTANT any hook is attached (`wantsHalfblockSolid`/
`wantsQuadrantSolid` in `rasterize.ts` both check `!scene.transformCells`),
so unconditionally attaching a capture-only hook to always return `grid`
would have silently broken both charModes for every existing caller who
never touched `objects`. Measured: reverting the conditional (`if (true)`
in place of `if (merged.overlayEntries.length > 0)`) reddens the two
pre-existing halfblock/quadrant parity tests AND the new no-objects
byte-identity test — three failures, one root cause.

**Mesh ids are local and disposable.** A live scene's `nextMeshId` is a
module-level counter shared across every scene for the process's lifetime
(mesh handles must stay distinguishable across `addObject`/`add` calls on
the SAME scene over its whole life); `compileScene` has no such lifetime —
one call, one render, done — so `mergeCompileObjects` assigns ids from a
FRESH counter starting at 1 every call, with `0` reserved for the caller's
own non-object `polygons` (never an object's own mesh, so a base-geometry
winner is always "foreign" to every object's `ownMeshIds`, exactly the
occlusion rule the live scene's `winnerMesh !== -1 own-vs-foreign` check
encodes). `polygonMeshIds`/`retainWinnerMesh` are only ever attached to the
rasterize context when at least one overlay exists (mirroring
`createGlyphScene`'s own `objectHasAnyOverlay()` gate) — an object with
meshes but no overlay pays nothing for winner-mesh tracking.

**`glyphOutput: "semantic"` rejects `objects` outright.** A semantic frame's
`sceneManifest`/`dictionary` describe the caller's OWN `polygons` array 1:1
(polygon index → surface → instance → class); an object's meshes have no
corresponding manifest entries to align with, and there is no way to
extend the manifest for polygons the caller never declared. At runtime,
overlay stamping already never runs under semantic output either
(`createGlyphScene.ts`'s `ctx.transformCells` is set only when
`options.glyphOutput === "visible"`), so silently dropping the objects'
overlays there would already be a divergence from "objects render like the
live scene" — rejecting explicitly, with a `TypeError` naming the
combination, was the only choice that doesn't either silently misalign the
manifest or silently drop half of what the caller asked for.

**Ripple: `@glyphcss/compile`'s `autoFit` crop.** `compilePolygons`'s
`autoFit` branch was the one caller in the tree that builds a
`CompileSceneResult` object literal by hand (cropping `inner` via
`cropGlyphInner`, then recomputing `cols`/`rows` from the cropped text) —
adding required `grid`/`hotspots` fields to the type is a clean break with
no BC shim, so this literal stopped type-checking the moment the DTS build
ran. Returning the PRE-crop `full.grid` unmodified would have shipped a
`CompileSceneResult` whose `grid.cols`/`.rows` disagree with its own
`.cols`/`.rows` — a new, self-inconsistent result shape nothing asks for.
`cropCellGrid` (`packages/compile/src/compileFile.ts`) re-derives the exact
same non-space bounding box `cropGlyphInner`'s internal `cropLines` computes
from the STRING, directly from `grid.char` instead — simpler than
re-tokenizing already-cropped HTML, and provably dimension-consistent: the
row/column that establishes the bounding box's own `maxCol`/`maxRow` always
has real content there, so `cropGlyphInner`'s per-line trailing-whitespace
strip can never shrink the measured width/height below what the grid crop
already computed. `hotspots` passes through unshifted — `CompileFileOptions`
does not accept `objects` (out of this packet's scope), so it is always `[]`
on every path through `compilePolygons` today.

### Gates and mutations (packet F5b)

| Gate | Mutation applied | Result |
|---|---|---|
| A mounted object's mesh, overlay, and hotspot all reach the compiled string exactly like the live scene | Disable the overlay-stamping hook (`if (false && …)`) | RED — 2 tests: the overlay's own `@` marker and the shared-arbiter `HIGH`/`LOW` label both vanish from `compiled.inner` |
| `objects`/`textureSamplers` absent is byte-identical, and `grid` never disables `halfblock`/`quadrant` | Always attach the capture hook (`if (true)`) regardless of overlays | RED — 3 tests: both pre-existing halfblock/quadrant parity tests AND the new no-objects byte-identity test |
| An object's own `textureSamplers` merge in exactly like the live scene | — (positive: `compiled.inner === runtimeHtml` with a real per-cell texel; a second assertion drops the sampler and requires a DIFFERENT render) | Parity holds; dropping the sampler measurably changes the render |
| An explicit `textureSamplers` entry wins a key collision (contract 9) | — (positive: a differently-colored explicit sampler at the SAME encoded key must change the render vs the object-only version) | Confirms the explicit map actually reaches the rasterizer, not merely accepted and ignored |
| `glyphOutput: "semantic"` + `objects` rejects, never silently drops or misaligns | — (positive: asserts a thrown `TypeError`) | Explicit rejection, matching the "static export of a mounted effect rejects explicitly" precedent |
| `@glyphcss/compile`'s `autoFit` crop keeps `grid` dimension-consistent with `cols`/`rows`/`inner` | — (`pnpm --filter @glyphcss/compile test`, `labelParity.test.ts`'s CLI/Vite/Node parity suite) | 60/60 pass; `cropCellGrid`'s bounding box matches `cropGlyphInner`'s own exactly |

Every mutation above was applied to the working tree, run, observed red
(with the exact reddened test names above), then reverted and re-verified
green.

### Gate counts (packet F5b)

`pnpm --filter glyphcss test`: 114 files / 1238 tests. `pnpm --filter
@glyphcss/react test`: 24 / 210. `pnpm --filter @glyphcss/vue test`: 26 /
214. `pnpm --filter @glyphcss/compile test`: 8 / 60 (needs
`@glyphcss/charts`/`@glyphcss/diagrams` built locally — unrelated packages
this packet doesn't touch, built once to unblock the CLI-parity suite's
module resolution). `pnpm --filter @glyphcss/core --filter glyphcss
--filter @glyphcss/react --filter @glyphcss/vue --filter @glyphcss/compile
build`: all five build clean, DTS included (the type gate this contract's
public-surface change lives or dies by).

### F5b fix round 1

A codex review of the F5b commit found four defects, all in the shape of the
work above rather than in a separate area: the "one raster pass" claim was
false for the common (no-overlay) case, `grid` could diverge from `inner`,
an object's member mesh options were silently dropped, and `@glyphcss/compile`'s
`autoFit` crop threw away every buffer but `char`/`color`. Fixed at the layer
each behaviour actually lives in — `rasterize.ts`/`cells.ts` (P1-1/P1-2),
`compileScene.ts`/`rasterizeContext.ts` (P1-3), `compileFile.ts` (P2-4).

**P1-1 — every ordinary compile rasterized twice.** The "with NO overlay,
`grid` is captured via a wholly separate `rasterizeToCells(ctx)` pass"
sentence above was the bug, not a design note: EVERY caller with no overlay
mounted — which is every caller before this packet existed, and `autoFit`
four times over (one probe, one full render, times two for the pass) — paid
a second full rasterize to get `grid`, and that second pass forced its own
`transformCells`-shaped hook, which is exactly what P1-2 turns out to also
depend on. Fixed with a new, independent grid-OBSERVER field on
`RasterizeContext`, `captureCells?: (grid: CellGrid) => void`
(`rasterizeContext.ts`), invoked from inside the ONE existing rasterize pass
at each render mode's own final buffer-construction point
(`applyCellHook`'s new trailing `capture` parameter, `cells.ts`) — never
counted as a `transformCells` hook, so it does not gate
`charMode: "halfblock"`/`"quadrant"`'s own no-hook fast path the way a real
hook would. Gate: `compileScene.test.ts`'s `vi.spyOn(rasterizeModule,
"rasterize")` count — asserts exactly 1 call for a plain `compileScene()`
with no overlay; reverting to the old two-pass shape reddens it at "expected
1, got 2".

**P1-2 — `grid` could differ from the cells that produced `inner`.** Two
distinct risks, both closed by capturing FROM the same computation that
builds the string rather than a second traversal: (1) the OLD two-pass
shape's forced hook disabled halfblock/quadrant's dual-colour encoder for
that second pass only, so `grid` could have single-colour fallback glyphs
where `inner` had real halfblock ones — moot now that there is no second
pass, but recorded because it is exactly why `captureCells` must never act
like a hook; (2) `stampToGlyphs()` (the wireframe/voxel/ink no-hook
stringifier) independently calls `wireframeGlyphForCell()`, which makes an
internal `Math.random()`-based tier choice — a naive capture-only
implementation that ran `stampToGlyphs` a SECOND time purely to build the
capture buffer produced a DIFFERENT random glyph per cell than the actual
returned string on every such render (caught by this fix's own new test on
first write: captured `◈⊙╳` against returned `⊚╬▼` for the same cells).
Fixed by moving capture INSIDE `stampToGlyphs()`'s own loop, reading the
exact `g`/`col` locals that also build the returned string, so the two
outputs cannot diverge by construction. The chosen, documented honest
contract for a cell `CellGrid` genuinely cannot represent: `grid` is `null`
precisely when `inner` used the halfblock/quadrant encoder (a `CellGrid`
cell is one glyph, one colour; a halfblock/quadrant cell is two of each) —
not a rejection, not a silently-wrong single-colour fallback. Gate: a
grid-to-`inner` identity test (`gridToPlainText()` reconstructs a plain
string from `grid.char`/`.cols`/`.rows` and compares it, tags stripped,
against `inner`) across solid, wireframe and ink; a separate test asserts
`grid === null` for halfblock and for quadrant.

**P1-3 — compiled objects dropped member mesh options.** `mergeCompileObjects`
copied only `spec.polygons`; the runtime (`createGlyphScene.ts`) also reads
`spec.options` per member (`depthBias`, `castShadow`, `receiveShadow`, and
the detail-layer-triggering options this file's own "Per-mesh detail
layers" section lists). Every option a FLAT compile can represent —
`depthBias`, `castShadow`, `receiveShadow` — is now applied: `mergeCompileObjects`
builds parallel `depthBiases`/`castShadowFlags`/`receiveShadowFlags` arrays
(gated `undefined` when every member is default, mirroring
`createGlyphScene`'s own all-default gate) threaded through
`buildRasterizeContext`, a genuinely new capability (a flat static compile
can now cast/receive shadows and win a `depthBias` coplanar tie). An option
a flat compile CANNOT represent — `density`, `fontSize`/`lineHeight`,
`transparent`, a differing `mode`, `glyphPalette`, `ambientIntensity`, all
of which pop a mesh into its own detail-layer `<pre>` at runtime — is
REJECTED, not flattened: `assertCompileMeshOptionsRepresentable` throws a
`RangeError` naming the object id, mesh name, and field. Flattening was
considered and rejected — silently rendering a detail-layer mesh into the
shared base grid changes what a reader sees (no separate density/palette/
transparency) with no signal that anything was dropped, which is exactly
the silent-mismatch failure mode this whole fix round exists to close; a
loud, specific rejection matches this file's own precedent ("Static compile
takes a flat polygon list and cannot represent detail layers") and gives
the caller the object/mesh/field to fix. Gate: a parity test asserting a
`depthBias`-losing mesh wins a coplanar tie exactly like the equivalent live
`createGlyphScene` render (sign direction verified empirically against a
real scene, not assumed — positive bias on the otherwise-winning mesh makes
it LOSE); a `castShadow`/`receiveShadow` parity test reusing the geometry
`shadow.hidden.test.ts` already proves shadow-casting correct with; a
rejection test for `density`; a non-rejection test confirming a `mode` that
merely MATCHES the scene's own mode is not mistaken for "differing" and
rejected.

**P2-4 — the `autoFit` crop kept only `char`/`color`.** `cropCellGrid`
(`packages/compile/src/compileFile.ts`) rebuilt its result with
`depthSrc: null` and every optional buffer argument omitted — every
`autoFit` render lost `depth` and any effect-input buffer the grid carried.
Rewritten with two generic row-major crop helpers, `cropTypedField`
(any `TypedArray`, parametrized on `stride` — 1 for a scalar field like
`depth`, 2 for `surfaceUv`, 3 for a `[x,y,z]` field like `worldPosition`,
preserving the source's own typed-array constructor) and `cropPlainField`
(for `char`/`color`) — every buffer `CellGrid` can carry is now cropped to
the identical content bounding box, `screenX`/`screenY` freshly regenerated
for the cropped dimensions via `buildCellGrid` rather than literally copied
(the coordinate system changed size). `cropCellGrid` also now accepts and
returns `CellGrid | null`, honoring the same P1-2 contract — a `null` grid
crops to `null` — even though `CompileFileOptions` does not currently
expose `charMode` (so `full.grid` is never actually `null` through this
specific caller today; the type says `CellGrid | null` and this stays
correct either way rather than assuming). Gate: a synthetic 6x4 `CellGrid`
built via `buildCellGrid` with every optional buffer populated with
distinct, position-derived values at every cell (not just painted ones),
cropped, and compared field-by-field against the matching window of the
uncropped source; plus an end-to-end `compilePolygons({ autoFit })` test
asserting the real cropped grid's `depth` varies across painted cells
(reverting to `depthSrc: null` collapses every painted cell's depth to one
constant, which this catches without needing to reconstruct the renderer's
own geometry by hand).

### Gates and mutations (fix round 1)

| Gate | Mutation applied | Result |
|---|---|---|
| A plain `compileScene()` with no overlay rasterizes exactly once | Restore the old two-pass shape (`rasterizeToCells` fallback) | RED — spy count 2, expected 1 |
| `grid` is exactly the cells that produced `inner` (solid/wireframe/ink) | Capture via a second independent `stampToGlyphs`-style traversal instead of reading the same loop's locals | RED — captured glyphs differ from `inner`'s own glyphs on a wireframe render (caught on first write, not a synthetic mutation) |
| `grid` is `null` for `charMode: "halfblock"`/`"quadrant"` | — (positive: asserts `grid === null` for both) | Both pass; the encoder's own no-hook fast path is the mechanism, verified never to run `captureCells` |
| An object member's `depthBias` resolves a coplanar tie like the live scene | Drop `depthBiases` from the `mergeCompileObjects`/`buildRasterizeContext` threading | RED — the loser wins instead |
| An object member's `castShadow`/`receiveShadow` matches the live scene | Drop `castShadowFlags`/`receiveShadowFlags` threading | RED — the shadow this test asserts present is absent |
| A member declaring `density` (or another detail-layer-only option) rejects loudly | Remove the `assertCompileMeshOptionsRepresentable` call | RED — the option is silently accepted, no `RangeError` |
| `autoFit`'s cropped grid carries every buffer, matching the uncropped window | Revert `cropCellGrid` to `char`/`color`-only with `depthSrc: null` | RED — synthetic-grid test: `expected 10.75, got 0`; end-to-end test: painted-cell depth set size `expected > 1, got 1` |

Every mutation above was applied to the working tree, run, observed red
(exact failures above), then reverted and re-verified green.

## C1 — `gridSurfacePolygons`, the surface model, `glyphChartObject`

**Goal.** A `z(x, y)` height-field mesh (core), a validated surface model
(`@glyphcss/charts/3d`), and a producer turning that model into a mounted
`GlyphSceneObject` — the surface mesh plus a 3D axis box, ticks and labels
as overlays. No `renderGlyphChart3d`, no CLI, no page (C2/C3).

### Why the geometry is a `@glyphcss/core` helper, not a `@glyphcss/charts` internal

`gridSurfacePolygons` (`packages/core/src/helpers/gridSurfacePolygons.ts`)
takes only normalized `x`/`y`/`z` numbers and a colour callback keyed on
ORIGINAL (pre-decimation) grid indices — it knows nothing about chart
specs, colour scales, or data domains, matching every other helper in that
directory (`cubePolygons`, `planePolygons`, …: pure geometry, no "Glyph"
prefix, per AGENTS.md's naming exception for generic math/geometry). This
keeps the door open for a second consumer with no chart vocabulary at all
(a hand-authored terrain mesh, a future non-chart 3D surface) without
routing through `@glyphcss/charts`.

### The area-median statistic is LIFTED, not duplicated

`@glyphcss/maps`' `mesh.ts` already had exactly the statistic C1 needs — the
median of a bilinearly-interpolated field over a block, closed-form via a
piecewise-linear CDF (AGENTS.md's "Relief mesh": "the level that halves the
AREA … not the mean of its 4 corners and not the median of the SAMPLES it
covers"). Copying it would drift; maps cannot be imported by glyphcss or by
charts (the dependency direction runs the other way, and glyphcss must stay
free of both). The fix is the same shape F4 used for the label arbiter:
generalize the algorithm's field accessor from `GlyphMapGeoTile`'s own
`elevation`/`cols` to a bare `{ stride, values }` row-major pair
(`packages/core/src/math/surfaceMedian.ts`, `surfaceMedianOfBlock`) and move
it to `@glyphcss/core`, where both `@glyphcss/maps` (a two-line accessor
wrapper, `mesh.ts`'s own `surfaceMedianElevation`) and
`@glyphcss/charts/3d`'s `object.ts` (flattening the resolved `z` grid to a
`Float64Array` once per mesh build) can reach it with no cross-package
import. The algorithm itself — strip count, CDF construction, the atom
special-case for a flat cell — is byte-for-byte unchanged; only the
accessor moved. Gate: `packages/maps/src/mesh.surfaceMedian.test.ts`,
`mesh.seaLevelBand.test.ts`, `widget.reliefSurfaceBand.test.ts` (all still
green, unmodified, against the wrapped call) plus a new
`packages/core/src/math/surfaceMedian.test.ts` exercising the same
properties the maps design record documents (a flat field, an area
majority the corner mean gets wrong, a point-mass "atom" tie, non-finite
cells skipped, the empty-block fallback) directly against the generic
`{ stride, values }` shape.

### Decimation: nudge, don't append, and protect a forced slot from a later one

`gridSurfacePolygons`' decimation mirrors `@glyphcss/maps`' own
`gridLineIndices` (uniform point-sampling of grid LINES) but must also
"always keep the argmax and argmin lines" (PLAN-3d.md §5, C1's own gate) —
so the uniform sample is nudged: each required index REPLACES its nearest
kept neighbour rather than growing the kept count, which is what keeps the
decimation ratio exactly what `maxQuadsX`/`maxQuadsY` asked for. The first
implementation nudged blindly and had a real bug, caught by the packet's own
mutation test (`object.test.ts`'s "the argmax survives decimation" case,
which is also gated one layer down in `gridSurfacePolygons.test.ts`): two
required indices equidistant from the SAME nearest slot (the routine case —
an argmax and an argmin symmetric around one uniform sample point) took
turns evicting each other, and the SECOND one processed silently walked the
slot back to where it started, dropping the first one's own forced value
entirely (measured: a peak at row 2 requiring slot 0's neighbour on a
`[0, 4, 8]` lattice for a required pair `[2, 0]` — processing `2` first
correctly claimed slot 0, but processing `0` second then found slot 0
"nearest" to itself too and reclaimed it, undoing the peak's own claim).
The fix marks a slot FORCED the instant a required index claims it, and
excludes forced slots from every later required index's own nearest search
— a slot, once forced, is never evicted again. Two required indices per
axis (argmax, argmin) against a budget of at least 2 kept lines means a
free slot is always available for the second one; the fallback path for
"no free slot" is intentionally absent (AGENTS.md's "no defensive code for
cases that can't happen") since that configuration is unreachable from
every caller in this repo.

### Colour: quantized bands over an approximate colorscale, not a continuous ramp

`glyphChart3dBandIndex`/`glyphChart3dBandColor` (`3d/colorscale.ts`)
quantize the z-domain into `bands` (default 9) discrete levels before
resolving a colour, the same "quantize so span-runs and the atlas palette
survive" discipline `cell`'s own 5-level shade ramp already follows
(AGENTS.md's "Charts" "Series and shading") — a continuous per-quad hue
would produce as many distinct colours as there are quads, destroying both
span-run merging in the text/ANSI exits and the 30-slot atlas palette (C2's
concern once a static/live exit exists; the model layer quantizes
regardless, so C2 inherits a bounded palette for free). The named
colorscale anchors (`viridis`/`cividis`/`magma`/`greys`) are hand-picked
reference stops for each published map, not a pixel-exact port of
matplotlib's own spline — adequate for a monospace-cell render (`docs/design/render-modes.md`'s font-atlas budget is the actual fidelity ceiling here, not the anchor count), and a caller who needs exact fidelity supplies a custom anchor array, validated the same way.

### "Matches the 2D `cell` heatmap band for band" — the concrete, testable form taken

PLAN-3d.md's own honesty gate ("a surface viewed from straight above … must
match the 2D `cell` heatmap of the same grid band for band") is stated
against a page that doesn't exist until C2/C3 (`renderGlyphChart3d`, the
`/charts` page). What C1 can and does prove at the model layer: an
UNDECIMATED quad's band is a deterministic, monotone function of its own
(exact, since a single undecimated quad's area-median is bounded by its own
corners — and for a FLAT quad equals them exactly) z value, under the SAME
linear domain-quantization scheme `2D cell` marks use (`(z - domainMin) /
domainSpan`, quantized to `bands` levels — `paint.ts`'s own `shadeFor`
convention for a non-diverging domain). `object.test.ts`'s "top view" case
builds a grid of four DISTINCT flat quads and confirms each one's built
colour equals the colour the SAME quantization function predicts for its
own (exact) value — the honest, C1-scoped form of "band for band" until a
real 2D-vs-3D pixel comparison exists to check against once C2 lands.

### Overlays: a full box wireframe, per-axis nearest-edge ticks, no back-wall gridlines yet

PLAN-3d.md describes gridlines on the camera's own back walls and ticks on
the nearest edge, chosen per frame. C1 implements the tick half in full —
`nearestEdge` compares the projected depth of each of an axis's 4 parallel
edges' midpoints and picks the nearest (largest depth, this repo's
"larger = nearer" convention) every `stamp()` call, so ticks visibly move
to a different edge as the object (or the host camera) rotates — but
DEFERS the interior back-wall gridlines: the box's own 12-edge wireframe
(always drawn, one glyph per straight edge chosen from its screen-space
slope) already gives the reader the 3D frame the acceptance gates need
(no label overlaps, a real box + ticks + labels rendered), and gridlines
are additive polish with no gate of their own in C1's acceptance list. A
label (tick or axis title) is pushed outward from its own on-edge tick
point along the SAME two axes the chosen edge's own corner already fixes
(object-space, not screen-space — so no screen-direction math is needed at
all: whichever screen direction that becomes is simply where the
projection sends it), depth-tested via `stampGlyphOverlayCell`'s own
`depth` field against the real surface, and registered through the shared
`GlyphLabelArbiter` (`frame.labels.place`) with `ownMeshIds: frame.ownMeshIds`
— so a tick or title never hides behind this object's OWN surface, only
behind something else's.

### Gates and mutations (packet C1)

| Gate | Mutation applied | Result |
|---|---|---|
| The argmax/argmin survive decimation | Revert `decimateIndices`' forced-slot protection (let a later required index evict an earlier one) | RED — `gridSurfacePolygons.test.ts` and `object.test.ts`'s decimation cases both fail: the peak's own row/column drops out |
| A quad's band is the area-median | Swap `object.ts`'s `surfaceMedianOfBlock` call for the 4-corner mean | RED — `object.test.ts`'s Buenos-Aires-shaped fixture (designed so the two statistics land on different bands) asserts the built colour against the median reference and fails against the mean |
| Top view matches the domain-quantization a `cell` heatmap band uses | (verified directly, not mutation-gated: an UNDECIMATED flat quad's colour is checked against the shared quantization function for its own exact value) | — |
| `objectPosition` is data space | (verified directly: the mesh's own x/y/z vertex coordinates are asserted affine and monotone in the resolved axis domains) | — |
| The render is deterministic | Two builds from identical input are compared by `JSON.stringify` equality | Passes; any source of nondeterminism (iteration order, `Set`/`Map` insertion order leaking into output) would fail it |
| Mounted in a real scene with an orbit-style camera, the surface plus axis labels render, with no overlaps | A real `createGlyphScene`/`camera`/`addObject` integration test | Passes; overlap-freedom itself is F4's own gate (the shared arbiter), exercised here through a real object rather than re-proven |

**Gate.** `pnpm --filter @glyphcss/core test` (795 tests, +20 new: 13
`gridSurfacePolygons`, 7 `surfaceMedianOfBlock`), `pnpm --filter
@glyphcss/charts test` (1414 tests, +42 new under `src/3d/`), the targeted
`@glyphcss/maps` surface-median suites (`mesh.surfaceMedian.test.ts`,
`mesh.seaLevelBand.test.ts`, `mesh.test.ts`, `widget.reliefSurfaceBand.test.ts`
— 30 tests) plus a full `pnpm --filter @glyphcss/maps test` run (1337 tests)
as a safety net for the lifted shared code, the glyphcss scene/overlay
suites this packet depends on (`createGlyphScene.sceneObject.test.ts`,
`createGlyphScene.viewportOverlay.test.ts`, `GlyphObjectElement.test.ts` —
17 tests), `tsc --noEmit` on `@glyphcss/charts`, and `pnpm build:packages`
(all 17 workspace packages) all pass.

### C1 review fixes (folded in during C2)

A codex review of `a5512ab2` found 8 issues in the packet above; all are
fixed at the layer that actually owns the behaviour, each with a
mutation-sensitive test:

- **P1-1 (crop):** `decimateIndices` now forces slot 0 and the last slot
  (the box's own two endpoints) BEFORE any required-index nudging runs, so
  an argmax/argmin whose nearest unforced slot happened to be an endpoint
  can no longer evict it — the box's own boundary always survives; an
  interior extremum is best-effort alongside it (silently dropped only when
  `keep` is too small to seat all of endpoints + both extrema at once, the
  provably infeasible case). `gridSurfacePolygons.test.ts` reproduces the
  review's own 9x9/keep-3 fixture.
- **P1-2 (domain mismatch):** `object.ts`'s `buildSurfaceMesh` now reads
  `mark.axes.z.domain` (the NICE domain, same as the ticks) instead of the
  raw `mark.zDomain` — a mesh vertex and its own axis tick are now
  guaranteed the same function of z. `mark.zDomain` itself is untouched
  (still the public raw-extent field).
- **P1-3 (winding):** `surface.ts`'s grid-shape resolver now checks an
  explicit `channels.x`/`.y` vector's own order and, if strictly
  descending, reverses it AND the matching z columns/rows (never a silent
  winding flip); a genuinely non-monotonic vector rejects with the new
  `surface-axis-unsorted` rule.
- **P1-4 (unusable default framing):** see "C2" below —
  `glyphChart3dFitCamera` plus `renderGlyphChart3d`'s own auto-fit call.
- **P1-5 (missing schema):** `3d/schema.ts`'s `glyphChart3dSurfaceJsonSchema()`,
  Ajv-parity-tested in `schema.test.ts` against the same rule ids.
- **P2-6 (untagged crashes):** `surface.ts` now checks `Array.isArray` on
  `z[0]` and every `z[r]` before touching `.length`/`.map`, rejecting a
  malformed row with a tagged `surface-ragged` instead of a bare TypeError.
- **P2-7 (unenforced monotone lightness):** `colorscale.ts`'s
  `resolveGlyphChart3dColorscaleAnchors` computes each custom anchor's
  CIELAB L* (`hexLStar`, the standard `f(Y/Yn)` formula — only `Y`,
  relative luminance, is needed for `L*` alone) and rejects a non-monotone
  sequence with `colorscale-not-monotone`; the 4 named presets are gated
  monotone at 9 bands too, as a regression guard on the hand-picked anchors.
- **P2-8 (test coverage):** `object.test.ts` gained a camera-sweep case
  proving `nearestEdge` actually migrates (two cameras deliberately NOT 180
  degrees apart — a square-footprint box's own point symmetry makes a
  180-degree flip land the migrated edge at a near-identical column even
  with a correct implementation, which would have made that the wrong
  fixture), a trackball (`mat`/`useMat`) case, and an un-reversed-text case;
  `surface.test.ts`/`colorscale.test.ts` gained `.code`-asserting coverage
  for every rule; `rootIsolation.test.ts` gates that no root-level
  `@glyphcss/charts` source file imports from `./3d`.

## C2 — `renderGlyphChart3d`, the static-frame exit, canvas chrome, CLI dispatch

**Goal.** A static frame of a `GlyphChart3dSurfaceMark` at a given (or
auto-fitted) camera, through the same `text`/`html` exits and
target/charset/colour vocabulary the 2D entry uses, plus canvas chrome (a
title row, a value colorbar) and a CLI dispatch. No live orbit, no `/charts`
UI (C3), no effects (out of the approved export boundary for this slice).

### No scene, no DOM: driving `buildRasterizeContext`/`rasterize` directly

`compileScene` does not yet accept `GlyphSceneObject`s or procedural
`textureSamplers` on this branch (that is packet F5b's own work, tracked
separately) — waiting for it would have blocked C2 entirely, and the
contract it will eventually expose (`compileScene(objects, textureSamplers)
→ CellGrid`) is a strict superset of what a SINGLE static surface object
needs. So `render.ts` reproduces the relevant slice itself, using only
already-PUBLIC `glyphcss` primitives: `buildRasterizeContext` + `rasterize`
with a `transformCells` hook that (1) runs the object's own `overlays`,
sorted by `order` then declaration order — the identical rule
`createGlyphScene`'s `applyGlyphSceneObjectOverlays` uses — through a
hand-built `GlyphOverlayFrame` (`toWorld` is the identity function, since
there is no scene-level mount transform here; `ownMeshIds` is an empty set,
since a single mounted object with one mesh can never hide behind a
FOREIGN mesh and no `retainWinnerMesh` is even requested), (2) resolves the
shared `GlyphLabelArbiter`, then (3) captures the resulting `CellGrid` via
the exact clone-through-`buildCellGrid` technique `rasterizeToCells` itself
uses (mirrored rather than reused, since `rasterizeToCells` installs its OWN
capturing `transformCells` and would silently discard this one). This is
provably byte-identical to a real scene at the same camera and grid —
`render.test.ts`'s own gate mounts the SAME object into a real
`createGlyphScene` at the SAME camera/cols/rows/cellAspect and asserts the
two `text` outputs are equal, not merely similar.

### Charset and colour: reusing the 2D vocabulary, never re-deriving it

`renderGlyphChart3d` imports `GLYPH_CHART_TARGET_DEFAULTS` and
`glyphChartColorEnabled` from the ROOT package directly (a relative import
within the same package — the one direction PLAN-3d.md's isolation rule
allows, `rootIsolation.test.ts` gates only that the root never imports back)
so `target`/`charset`/`color`/`width`/`height`/`cellAspect` mean EXACTLY
what they mean for a 2D chart, with the identical NO_COLOR/FORCE_COLOR
handling. Charset maps onto the rasterizer's own `charMode`, not the 2D cell
canvas's tier system (a 3D chart rasterizes real geometry, it never touches
`createGlyphCanvas`'s tier tables for the SURFACE itself — only for the
chrome painted around it): `ascii`/`box` share the default solid ramp (no
distinct "box" solid mode exists at the scene layer); `blocks` requests
`charMode: "halfblock"`; `braille` is wireframe-only in glyphcss (AGENTS.md's
"Render modes"), so a 3D chart — always solid — downgrades it to the
default ramp and logs `chart3d-braille-unsupported`, never throwing and
never silently pretending to honour it. The CHROME canvas's own tier
(`chromeTier`) follows the same charset, with `braille → box` for the same
reason.

### Auto-fit camera: a pure, reusable helper, not inline math

P1-4's own defect — the library's bare orthographic default (`zoom: 0.65`,
an untransformed object) renders one lonely tick mark and no surface at all
on an 80x24-ish grid — is fixed by `glyphChart3dFitCamera` (`3d/camera.ts`),
a PURE function taking any `GlyphSceneObject.bounds` plus a
viewport/camera-angle description and returning `{ target, zoom }`: it
builds a REAL `createGlyphOrthographicCamera` at a reference `zoom: 1`
(never a re-derived rotation formula — this is what makes it exact for a
`mat`/`useMat` trackball rotation too, not only Euler `rotX`/`rotY`),
probes the 8 AABB corners of the bounds EXPANDED outward by `margin`
(default `0.45`, approximating the label/tick push-out the axis overlay
itself performs — object.ts's own `TICK_LABEL_MARGIN`/`AXIS_TITLE_MARGIN`
plus slack for label text width, which this function has no glyph metrics
to measure exactly) through that camera, and picks the largest zoom that
keeps every probed corner within `safety` (default `0.92`) of the
viewport's own half-extent in both columns and rows. `renderGlyphChart3d`
calls it whenever `options.camera?.zoom` is omitted, at
`GLYPH_CHART_3D_DEFAULT_CAMERA` (`rotX: 65, rotY: 45` — this repo's own
documented isometric convention, reused rather than inventing a second
default) unless `rotX`/`rotY` are overridden too. It is exported publicly
specifically so a DIFFERENT scene consumer mounting the SAME (or any other)
object gets the identical fitting math with no re-derivation — the "mount
in any scene" half of composition (PLAN-3d.md §3.1) needs a camera that
actually shows the thing it mounted, and this is that primitive.
`camera.test.ts` proves it (target = bounds center; larger viewport → larger
zoom; a wider margin → a smaller-or-equal zoom; a trackball `mat` case) and
`render.test.ts`'s own P1-4 gate mounts a volcano-like fixture at the
library's OWN default camera/target constants (no cherry-picked zoom) and
requires all 3 axis titles plus real surface ink, contrasted against the
SAME fixture at a fixed `zoom: 0.65` (materially less content — never an
absolute magic-number threshold, which is fragile against unrelated layout
changes).

### `shading: "value"`: a procedural texture, not a lighting trick alone

C1 left `shading: "value"` typed but unwired ("a C2/rendering-layer
concern"). The wiring lives in `object.ts` (in scope for this packet, not
`render.ts`), because the mechanism is MESH authoring, not a render-time
light choice: `applyValueShadingTexture` walks every triangle
`gridSurfacePolygons` returns, computes its own vertex-average object-space
z (already `aspect[2]`-scaled, so no domain re-lookup is needed), quantizes
it into the mark's own `bands` via the SAME `glyphChart3dBandIndex` the
colour callback uses, and authors `uvs`/`texture` pointing into a 64-texel
grey-ramp `TextureSampler` (`GLYPH_CHART_3D_VALUE_STRIP_TEXTURE_KEY`,
luminance strictly increasing left to right) — carried on
`GlyphSceneObject.textureSamplers`, the same public field the composition
contract already defines (AGENTS.md's "Scene objects"). Per AGENTS.md's
"Rendering model" "Per-cell textures", the texel LUMINANCE multiplies into
the cell's own picked-glyph intensity, so glyph DENSITY reads z regardless
of face normal. `renderGlyphChart3d` layers one more thing on top — under
`shading: "value"` it renders with `ambientLight: { intensity: 1 }` and
`directionalLight: { intensity: 0 }`, so slope contributes NOTHING to the
picture at all, not merely "little"; this is a render-time convenience
(removing a confound), not what makes the guarantee true — a mutation test
that instead disables ONLY the texture authoring (keeping the ambient-only
light) is what actually reddens `render.test.ts`'s own gate, proving the
texture is the load-bearing half.

**Building the gate itself took two false starts, kept here because the
same mistake is easy to repeat**: a first version sampled `glyphInkDensity`
(a MEASURED per-glyph ink-coverage function, `docs/design/canvas.md`'s own
texture-bridge machinery) on the default solid ramp's own characters and
found it NON-monotone in ramp position for several of them (e.g. `"@"`
measures LESS ink than `"#"` in a real font, even though `"@"` is the
ramp's own densest INTENDED level) — the right authority for "which glyph
means more ink" is the ramp's own declared ORDER (`SOLID_RAMP`, exported
from `glyphcss`), not a measured coverage function built for a different
purpose. A second version then filtered "non-blank" cells to find a
representative sample column/row and picked up FALSE signal from two
sources that happen to share characters with `SOLID_RAMP`: a blank
BACKGROUND cell (`" "` is `SOLID_RAMP[0]`) and the axis overlay's own tick
mark glyph (`"+"` is `SOLID_RAMP[5]`) — both silently counted as "surface
data at a specific band", and a version of the test with the feature
DISABLED still passed because the tick glyphs alone produced enough
spurious row-correlated noise. The gate that shipped excludes both
explicitly (`NON_SURFACE_GLYPHS`) and correlates the REMAINING cells'
`SOLID_RAMP` INDEX against screen row via a plain Pearson correlation
(`|r| > 0.85`) computed over every surface-glyph cell in the whole frame —
not one sampled row/column, since a quad's own two triangles split on their
shorter 3D diagonal and can disagree by one band right at a boundary,
noise a broad sample averages out but a single strict step-by-step
monotonicity check would wrongly fail on.

### Canvas chrome: title and colorbar, painted onto the SAME canvas the surface is pasted into

The rasterized surface `CellGrid` is pasted CELL-BY-CELL (`pasteCellGrid`)
into a `GlyphCanvas` at the plot rect's own offset (`char`/`color` copied
directly, `ink` marked for any non-blank cell) — the canvas exists ONLY for
chrome (a title row via `canvas.text({ align: "center" })`, and, whenever
`mark.colorAnchors !== null`, a right-edge colorbar via `canvas.fillRect`
swatches + `canvas.text` z max/min labels) and for its own encoders
(`encodeGlyphCanvasText`/`Html`/`Ansi`, the IDENTICAL functions the 2D entry
calls). The colorbar reserves `COLORBAR_COLS` (9) columns only when the
remaining plot width still clears `COLORBAR_MIN_PLOT_WIDTH` (24); otherwise
it is skipped with a `chart3d-colorbar-omitted` ledger entry rather than
crushing the plot. Each colorbar row's `fill.shade` is the band's own
normalized index (never `"solid"`) so the SAME "shape reads value" property
`shading: "value"` gives the surface also holds for the legend swatch, even
under `color: "none"`.

### Gates and mutations (packet C2)

| Gate | Mutation applied | Result |
|---|---|---|
| Static frame equals a real scene at the same camera | (verified directly: `createGlyphScene`/`addObject` at the identical camera/grid, `text` compared for equality) | — |
| Every target x charset x colour cell renders (or dims with its reason) | 60-cell sweep, `render.test.ts` | All pass; `braille` always logs `chart3d-braille-unsupported` |
| NO_COLOR honoured for ANSI text | env-injected `NO_COLOR: "1"` against `ansi16`/`ansi256`/`truecolor` | No `\x1b[` in `text` |
| `shading: "value"` glyph density correlates with z | Disable `applyValueShadingTexture` in `object.ts` | RED — Pearson correlation check fails (the whole surface renders one glyph) |
| Auto-fit shows the whole surface + all 3 axis titles | Force a fixed `zoom: 0.65` (the bare library default) instead of auto-fitting | RED (relative to the fitted render) — non-blank character count drops by more than 3x |
| Render-option/camera validation | Bad `width`/`height`/`target`/`charset`/`color`/`camera.rotX`/`camera.zoom` | Each rejects with its own tagged code (`bad-render-size`/`bad-render-options`/`bad-camera`) |
| CLI `--3d`/`--camera` dispatch | `chartCli.test.ts`: parses `--camera rotX,rotY[,zoom]`, writes a real frame, surfaces `chart3d-braille-unsupported` and a bad-input tagged code to stderr with exit 1 | Green |

**Gate.** `pnpm --filter @glyphcss/charts test` (42 files, 1537 tests, +141
under `src/3d/`), `pnpm --filter @glyphcss/core test` (26 files, 801 tests,
unchanged count — the P1-1 fix reshapes one existing fixture rather than
adding a new one, plus one new endpoints test), `pnpm --filter
@glyphcss/compile` `chartCli`/full suite (8 files, 67 tests, +9 new),
`tsc --noEmit` on `@glyphcss/charts` and `@glyphcss/compile` clean, and
`pnpm build:packages` (`@glyphcss/core`, `glyphcss`, `@glyphcss/charts`,
`@glyphcss/diagrams` rebuilt for this packet) all pass.
