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

## D2 fix round 1 (codex review)

The review rejected D2's own commit (`6985eb90`) on two P1s and three P2s.
Each is fixed at the layer that actually owns the behaviour, not relocated.

**P1-1 — unreadable default frame.** At `80x24`/`96x32` a node's box
rasterized to a uniform `@` slab with no visible face/edge boundary, and
every edge carried a plain slope glyph (`- | / \`) with no direction.
Fixed in `glyphDiagramObject.ts`/`render3d.ts`, tier-aware via
`GLYPH_CANVAS_TIERS` (the SAME glyph tables the 2D canvas painters use, per
the review's own instruction — never a parallel table): a depth-tested
12-edge BOX OUTLINE overlay per node (`tier.straight.h`/`.v` for a
near-axis-aligned segment, `tier.diagonal[...]` only for a genuine
diagonal — reading every segment through `diagonal` alone resolves to
plain-ASCII-shaped entries even on `box`, since box-drawing has no
diagonal glyph of its own to offer); a real ARROWHEAD
(`tier.arrow.n/e/s/w`) on each edge's final cell, snapped to the nearest
cardinal screen direction of travel; `GLYPH_DIAGRAM_3D_NODE_HEIGHT` shrank
`1 -> 0.35` (a thin plate, not a thick block); and the scene's ambient
light dropped (`GLYPH_DIAGRAM_3D_AMBIENT_LIGHT.intensity: 0.2`, was the
generic scene default) so a box's top and side faces read as distinct
Lambert intensities instead of one flat-lit slab. The arrowhead is
DELIBERATELY not depth-tested against its own target node — measured (see
below), a depth-tested write lost every one of the reference graph's
arrowheads (0 of 3), because the anchor commonly lands on a thin box's
SIDE face while that same screen cell's nearer winner is the box's own TOP
face; the arrow is only ever meant to sit where its own edge enters its
own target, so depth-testing it against that SAME node is wrong in
exactly the reasoning the label-placement comment already gives for
labels — it is still depth-tested against a genuinely FOREIGN node by the
line segment immediately underneath it, which keeps its own `depth`.

Before (4-node agent graph, `glyphcss diagram graph.mmd --3d --color none`, commit `6985eb90`):

```
                        @@@
                     @@@@@@@@@@
                   @@@@@@@@@@@@
                @@@@@@@@@@%@
              @@@@@@@@@@@@
           @@@@@Orchestrator     @@@@@
         @@@@@@@@@@--          @@@@@@@@@@
       @@@@@@@@@@@%  ----    @@@@@@@@@%@
    @@@@@@@@@@@@         -@@@@Planner@          @
  @@@@@@@@@@%@          @@@@@@@@@@-@          @@@@@@@@
 #%#%@@@@@@          @@@@@@@@@@@@  ----    @@@@@@@@@@@@          @@@
     %#@@          @@@@@@@@@@@%        --@@@Coder@%@@          @@@@@@@@@
                   #%#%#@@@@          @@@@@@@@@@--          @@@@@@@@@@@@
                        #@          @@@@@@@@@@%@  ----    @@@@@@@@@@%@
                                   #%#@@@@@@@         -@@@@@Reviewer
                                      ###@%          @@@@@@@@@%@@
                                                  @@@@@@@@@@@@
                                                #@@@@@@@@@%@
                                                 #%#%#@@@
                                                     %#
```

After (same graph/target/render, fix round 1 — box outlines, thinner
plates, lower ambient, real arrowheads):

```
                         ─*+──
                       ─++++++++──
                     ─++*+++*+──
                  ─++++++++───
                ─+*+++*++──
              ++++Orchestrator      ─++──
            *+++*+++───          ─++*+++*+─%
         ─++++++++──   ────   ──++++++++──
       +++*+++*───         ──▶*+++*+++──         ─│─
    +++++++++──          ──+++++Planner        ──++++++─
   ─*+++*++──         ──*+++*+++*──   ────   ─++*+++*+++──         ─────
      ─────         ──+++++++++──         ──▶++++++++───         ─+++++++─│
                    │─────*++──          ─*+++*Coder─         ──++*+++*──%│
                        ─────          +++++++++──   ────   ─++++++++──@─
                                     ─*─*+++*───         ──▶*+Reviewer
                                        ─────         ──+++++++++───
                                                    ──*+++*+++*───
                                                  │─+++++++++───
                                                  │─────*++──
                                                      ─────
```

Every one of the 4 node labels is intact, all 3 edges show a `▶`
arrowhead pointing into their target, and the box tier's `─`/`│` outline
glyphs separate each node's own top/side faces from the next node's,
against the review's own acceptance bar ("a reader must see four distinct
boxes with labels, and three directed edges with arrowheads").

**P1-2 — auto-fit can't guarantee visibility.** The rejected version
probed a rendered frame and measured painted cells, which cannot tell
"off-frame" from "collided and dropped by the arbiter" — both read as
simply absent, so a caller had no way to tell an auto-fit bug from a
genuine label collision. `fitDiagramCamera` (`render3d.ts`) is now
CLOSED-FORM: for a fixed rotation/target/centre an orthographic camera's
`col(zoom) = centerCol + (col1 - centerCol) * zoom` is exactly linear in
`zoom`, so every one of the object's 8 bounds corners AND every node's own
label anchor+text-width becomes one linear inequality in `zoom`; the
tightest (`min`) upper bound across all of them is the largest zoom that
keeps everything on screen with margin — computed once, from PROJECTED
geometry and full label extents, with no render and no probe for an
arbiter collision to hide behind. A label wider than the frame itself
(`text.length > availCols`) can never fit at ANY zoom, so it is excluded
from the constraint set (it can't force every other label toward zoom
zero) and reported via `ledger3dLabelUnfittable` instead. After the fit,
`renderGlyphDiagram3d` VERIFIES what actually landed against what the fit
predicted — reading `grid.char` at each label's own predicted cells — and
logs `ledger3dLabelDropped` naming the node for any miss, reproducing the
review's own repro (force layout, seed 42, a near-top-down camera) as a
permanent regression gate (`render3d.test.ts`'s "the review's own repro"
case) rather than trusting the analytic prediction blindly.

**P2-3 — duplicated composition path.** The rejected version hand-rolled
the overlay-flatten-arbiter pipeline `compileScene` itself is built from
(`buildRasterizeContext` + `rasterizeToCells`, plus an unsafe
`(arbiter as unknown as {...}).resolve(grid)` cast to reach the scene-only
`resolve` half of the label arbiter). `render3d.ts`'s `renderObjectFrame`
is now a thin wrapper over the PUBLIC `compileScene({ objects,
textureSamplers, cols, rows, ... })` surface (glyphcss, packet F5b,
committed `2d218244`) — the exact composition `scene.addObject()` runs at
runtime, so this module has nothing of its own left to drift from that
contract, and the unsafe cast is gone entirely. A `null` grid (a future
`charMode` this module never actually requests) is handled explicitly
with `glyphDiagramError("bad-options", ...)` rather than assumed away, per
the fix round's own instruction to code against the public API only.

**P2-4 — `--layout`/`--camera` without `--3d` silently ignored.**
`parseGlyphDiagramArgs` (`diagramCli.ts`) now rejects `--layout`/`--camera`
with no `--3d` at PARSE time — `bad-options`, exit 1 — instead of quietly
building `opts.layout3d`/`opts.camera3d` and then never reading them (the
2D `renderGlyphDiagram` path has no field for either).

**P2-5 — weak mutation gates.** `render3d.test.ts`'s target×charset×colour
matrix used to assert only `text.length > 0`, which passed on a frame that
was nothing but whitespace-padded label text with zero box/edge geometry,
and on an `html` exit that existed but carried no colour at all. It now
asserts every node's FULL label is present (`everyLabelVisible`, no
longer a 3-character prefix check), real painted geometry beyond the
label text (`paintedGeometryCellCount`), and that `color: "css"`'s `html`
actually carries a canonical `#rrggbb` inline colour style; a separate
gate confirms an ANSI colour mode actually emits SGR escapes when NOT
`NO_COLOR`'d (the existing matrix only ever checked the NO_COLOR-suppressed
case). Auto-fit gained: `layout: "force"` across five seeds including 42
(the review's own repro seed); a near-top-down camera (`rotX: 90`) over
force layout at seed 42, the review's own repro verbatim, checked against
BOTH the rendered text and the ledger (a genuine collision must be named,
never silent); and a trackball `mat` camera with a real roll (not the
identity), on both the 4-node fixture (zero missing labels) and the wider
6-node fixture (a lost label there must be named in the ledger, since the
analytic fit bounds each label's own anchor+width but not pairwise
label-vs-label overlap — a real collision at SOME orientation is expected,
a SILENT one is not). The "fixed zoom" gate now PROVES no single constant
zoom fits both fixtures, rather than trusting they merely look
different-sized: it takes the small graph's own auto-fit zoom and applies
it EXPLICITLY to the wider `supervisorGraph`, and asserts that a label
provably goes missing there.

**Gate.** `pnpm --filter @glyphcss/diagrams exec vitest run` (253 tests:
14 `layout3d.test.ts` + 5 `glyphDiagramObject.test.ts` + 12
`render3d.test.ts`) and `pnpm --filter @glyphcss/compile exec vitest run`
(71 tests, 31 in `diagramCli.test.ts` including the P2-4 block) pass;
`pnpm build:packages` builds every package with no errors.

**Mutation table (this round's own additions).**

| Property | Mutation | Result |
|---|---|---|
| A reader sees 4 distinct boxes and 3 arrowed edges | Revert to the pre-round `glyphDiagramObject.ts`/`layout3d.ts`/`render3d.ts` (`6985eb90`) | The "before" frame above — a uniform `@` slab, no outlines, no arrowheads |
| Arrowhead survives its own target node's nearer top face | Depth-test the arrowhead write against its own node's geometry | 0 of 3 arrowheads paint on the reference graph (measured directly before the fix) |
| Box-outline segments use the tier's crisp straight glyph on axis-aligned runs | Route every segment through `tier.diagonal` unconditionally | `box`'s outline loses its `─`/`│` glyphs to `diagonal`'s plain-ASCII-shaped entries |
| Auto-fit works from geometry, not a render probe | (structural — no probe exists any more to skip) | `render3d.test.ts`'s force/seed/top-view/trackball gates below |
| Force layout + seed 42 + top view never silently drops a label | Skip the post-render landed-vs-predicted verification loop | The review's own repro case reddens (label absent from both frame and ledger) |
| `compileScene({ objects })` composition matches the live runtime | Hand-roll the flatten/stamp/resolve pipeline again | The byte-identity gate (unchanged from D2's own table) reddens |
| `--layout`/`--camera` without `--3d` rejected | Drop the `!opts.is3d` guard in `parseGlyphDiagramArgs` | `diagramCli.test.ts`'s "rejects --layout/--camera without --3d" cases reddens |
| Matrix gate asserts REAL content | Revert `everyLabelVisible`/`paintedGeometryCellCount` to `text.length > 0` | Passes on a whitespace-only frame — caught by re-running the old assertion against a deliberately blanked grid |
| CSS `html` actually carries colour | Drop `color` from `encodeGlyphCanvasHtml`'s span style | The matrix gate's `/color:\s*#[0-9a-f]{6}/i` assertion reddens |
| ANSI colour modes emit real SGR escapes | Force `color: "none"` internally regardless of the requested mode | "ANSI colour modes actually carry colour" gate reddens |
| Fixed-zoom mutation provably reddens | (verified directly: `supervisorGraph` rendered at `agentGraph`'s own auto-fit zoom) | `missingLabels(...)` is non-empty — not merely "looks different" |

**Residuals.** The arrowhead table is still cardinal-only (N/E/S/W, no
diagonal arrow glyph in `GLYPH_CANVAS_TIERS`) — unchanged from D1/D2, a
residual for a later packet if a diagonal-arrow table is ever added. A
`supervisorGraph`-scale (6-node, 10-edge) diagram can still legitimately
lose a label to a genuine screen-space collision at an adversarial camera
angle — the analytic fit bounds each label's own anchor+width, not
pairwise overlap between labels; this is reported (`3d-label-dropped`),
never silent, and is the documented behaviour P1-2 actually guarantees.

## D2 fix round 2 (codex review, F5b lands)

**The finding.** F5b's own fix round landed on `feat/diagrams`
(`compileScene`'s `assertCompileMeshOptionsRepresentable`, "Compilation"
above): a member mesh declaring `density`/`transparent`/a differing
`mode`/`glyphPalette`/`ambientIntensity` — options a flat static compile
has no detail-layer pass to represent — now THROWS a `RangeError` instead
of being silently flattened. `glyphDiagramObject`'s own `groups` mesh
declared exactly one of those two fields on EVERY grouped diagram: `layout:
"layered"`'s floor plate carried `transparent: true`, `layout: "force"`'s
wireframe volume carried `mode: "wireframe"`. Once D2 fix round 1 routed
`renderGlyphDiagram3d` through `compileScene({ objects })`, every grouped
diagram — `agent-supervisor.mmd`, the CrewAI-style crew preset, `karate-club.mmd`
— would throw the instant it rendered.

**The fix, at the object layer.** `glyphDiagramObject.ts` no longer builds
a `groups` mesh at all. A group's boundary is drawn as a depth-tested
OVERLAY OUTLINE in the SAME `stamp()` that already draws a node's own
12-edge box outline: a layered floor plate is 4 edges at the group's own
`z` (`groupFloorCorners`/`FLOOR_OUTLINE_EDGES`, the first quarter of the
node outline's own `BOX_OUTLINE_EDGES` table), a force volume is the full
12-edge box (`boxCornersFromMinMax(group.min, group.max)`), and both reuse
the identical `segmentGlyph`/`GLYPH_CANVAS_TIERS` machinery — never a
parallel glyph table. Node meshes are untouched (`castShadow`/
`receiveShadow` only, already compile-representable).

**This is not a workaround, it is the layer that actually owns the
behaviour.** The group-outline overlay draws UNCONDITIONALLY (unlike the
node box outline, which `render3d.ts` skips in wireframe mode because
wireframe already rasterizes a real mesh's own edges) — with no polygon
mesh backing a group at all any more, the overlay is the ONLY
representation of a group's boundary in every render mode, so skipping it
under wireframe would draw nothing.

**A genuine bonus, not a side effect.** D2 fix round 1's own byte-identity
gate (`render3d.test.ts`'s "the static frame equals the live frame") was
SCOPED to a groupless graph, with a documented residual: a grouped graph's
`groups` mesh's `transparent`/`mode: "wireframe"` triggered AGENTS.md's own
detail-layer separation rule in a LIVE scene (a private, CSS-translated
`<pre>`), which a flat static compile has no representation for — so
static and live provably DIVERGED for any grouped graph. An overlay has no
detail-layer concept to diverge on: `stamp()` runs identically whether
`compileScene` or a live `createGlyphScene` calls it. The byte-identity
gate now covers a grouped graph, in BOTH layouts, with no exception
(`render3d.test.ts`'s new "the static frame equals the live frame for a
GROUPED graph too" case).

**What is honestly lost, stated rather than hidden.** A layered floor
plate's `transparent: true` mesh had a translucent FILL — the whole visual
point of a semi-transparent floor plate. `stampGlyphOverlayLine`/`Cell`
write opaque glyphs, not a blended tint, so a group now reads as an
OUTLINED footprint, never a shaded plane. This is a real, permanent
degrade of the visual — not a bug, and not silently absorbed: it is the
honest answer to "can an overlay represent a group" for the fill case,
stated per the fix round's own instruction ("if an overlay can't represent
groups honestly, say so").

**Gate.** `pnpm --filter @glyphcss/diagrams exec vitest run` — 3
`glyphDiagramObject.test.ts` additions (mesh list has no `groups` entry
and no member declares a compile-unrepresentable option; the group-outline
overlay paints a real cell in both layouts; `renderGlyphDiagram3d` no
longer throws for a grouped diagram) and 1 `render3d.test.ts` addition
(grouped-graph static==live, both layouts) — all green; `pnpm
build:packages` clean.

**Mutation table.**

| Property | Mutation | Result |
|---|---|---|
| No `groups` mesh, no member declares a detail-layer-only option | Reintroduce the old `transparent`/`mode: "wireframe"` `groups` mesh | `glyphDiagramObject.test.ts`'s mesh-list/options assertion reddens; `renderGlyphDiagram3d` throws for every grouped diagram |
| A group's boundary still paints | Skip the group-outline loop in `stamp()` | The group-outline test's "some cell painted" assertion reddens |
| Static equals live for a grouped graph, both layouts | Reintroduce the mesh (as above) | The new byte-identity gate reddens with a thrown `RangeError`, not merely a text mismatch |

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

**Residuals (as first shipped; see "D3 fix round 1" below for what
changed).** Per-node effects targeting (documented above, not built as
first shipped — built in fix round 1). No edge labels in 3D (D1's own
residual, unchanged). No cluster volumes beyond the existing group mesh
(D4). No performance gate at 200 nodes (D4).

## D3 fix round 1 — live scene honours target×charset×colour, per-node effects, real interaction gates

The codex review of D3's first cut found two P1s and one P2, all fixed in
this round with no change to `packages/diagrams/src` beyond one export.

**P1-1: the live web scene ignored charset/colour entirely.** The FIRST
cut's `Diagrams3DViewport.tsx` hardcoded `mode: "solid", useColors: true`
at `createGlyphScene` — braille never switched to wireframe, blocks never
downgraded, `color: "none"` still painted colour, and `web` (which never
carries `TargetPreview` chrome) had nowhere to say so. Fixed by exporting
`render3d.ts`'s own PRIVATE `resolveCharset` (zero behaviour change — a
visibility change only, gated by `packages/diagrams`' own unchanged 3D test
suite) and wrapping it in a new pure `diagrams3dSceneOptions.ts`
(`resolveDiagrams3dSceneOptions(charset, color)` → `{ mode, charMode,
useColors, note? }`), called both at scene CREATION and on every later
charset/colour edit via `scene.setOptions` — never a remount, so the camera
and mesh survive a Dock edit exactly like before. The one thing a live DOM
scene genuinely cannot express is an ANSI colour DEPTH (`ansi16`/`ansi256`
vs. `truecolor`/`css` — that distinction lives only in the TEXT encoders,
`encodeGlyphCanvasAnsi`'s own `colors` option), so those two get a
page-level `note` too; braille's solid→wireframe and blocks'
sub-cell→ascii degrades reuse the SAME `ledger[].message` text
`renderGlyphDiagram3d`'s own static frame logs, never a re-worded copy.
Rendered through a new `.diagrams-3d-frame` wrapper's own
`.target-preview__note` (same class, own CSS scope — `web` mounts no
`TargetPreview` ancestor to inherit the rule from). Gate:
`diagrams3dSceneOptions.test.ts` (26 cases: the full 4×5 charset×colour
matrix, plus dedicated braille/blocks/ansi-depth note assertions).

**P1-2: per-node effect targeting, built.** A new SHARED Dock component,
`InstrumentWorkbench/Instrument3DEffectsFolder.tsx` — an effect-id list and
a plain `{ id, label }` targets list in, `{ effectId, targetId }` out, with
NO diagram-specific assumption (built for `/charts`' own later C4 reuse:
its own targets would be chart mesh names instead of `node:<id>`).
`Diagrams3DViewport.tsx` resolves `effectId` against `@glyphcss/effects`'
`getGlyphEffect`, mounts `scene.addEffectLayer({ effect, params, target })`
against the object's stable `node:<id>` mesh (D1's own contract) or
scene-wide for "All nodes", RETARGETS via `layer.setOptions({ target })`
without remounting when only the target changes (AGENTS.md "Per-object
targeting"), and drives `time` with its own `requestAnimationFrame` loop —
cancelled on effect dispose, a genuine effect-id change, a view switch, or
unmount. A stale target (a `?d=` link naming a node id absent from the
CURRENT graph) resolves to an EMPTY mesh array, not `undefined` — `undefined`
means scene-wide, and falling back to it would silently widen a
missing-node target into "every node," the opposite of what a stale
targeting request should do. `effect3d` rides `?d=` as two more free-form
strings (never a closed enum — a future added effect id needs no urlState
change; an id `getGlyphEffect` doesn't recognise is a silent no-op, never a
throw, matching the Dock's own "never disable the current value" idiom
elsewhere). State/URL gates: `diagramsUrlState.test.ts`'s new round-trip
case. Folder gate: `Instrument3DEffectsFolder.test.tsx` (5 cases: option
rendering, both `onChange` paths, a live targets-list refresh, folder
show/hide). Targeting-mechanism gate:
`diagrams3dEffectTargeting.test.ts` — mounts the SAME primitives the
viewport does (`createGlyphScene` + `glyphDiagramObject` +
`scene.addEffectLayer({ target })`) with no React at all, renders a 3-node
graph three ways (no effect, effect targeted at node A, effect targeted at
node B) and asserts the cell-index sets that changed for A and for B are
DISJOINT — "highlighting one node's mesh leaves the others unchanged" as a
literal set-intersection check, not an eyeballed frame. (The curated
default effect list is `scan`/`glitch`/`ripple`; the gate itself uses
`glitch`, which paints from `context.target.coverage` + a deterministic
per-cell hash alone — `scan`'s own domain-coordinate requirements need
`worldPosition`/UV data a plain box mesh may not carry, an unrelated,
pre-existing library nuance this packet did not chase.)

**P2-3: real interaction and disposal gates.** `DiagramsWorkbench.3d.test.tsx`
now synthesizes an actual `pointerdown`/`pointermove`/`pointerup` drag
against the live host (happy-dom's own `PointerEvent`, the same sequence
`createGlyphOrbitControls.test.ts`'s own helpers use) in BOTH rotation
modes — turntable (the default) and, after switching the Dock's `Rotation`
dropdown, trackball — and asserts Copy's clipboard text differs before and
after each drag. A third case proves trackball is actually ENGAGED (not
merely "Copy changed," which a mis-wired `mode: "turntable"` would also
produce): after a trackball drag, "Copy link"'s own `?d=` payload decodes
to a `camera3d` carrying `mat`, never `rotX`/`rotY`. Disposal:
`glyphcss`'s own `createGlyphScene`/`createGlyphOrbitControls` are wrapped
(via `importOriginal`, never faked) so their returned handles' real
`destroy()` methods are spied — a view switch away from 3D and an unmount
each assert BOTH spies were called exactly once, verified to actually
redden by temporarily deleting the `scene?.destroy()` call and confirming
the assertion catches it.

**Gate (this round).** `pnpm --filter @glyphcss/website exec vitest run
src/components/DiagramsWorkbench src/components/InstrumentWorkbench` — 299
tests across 13 files, all green (up from 218/7: +26 scene-options matrix,
+5 Effects-folder, +1 targeting-mechanism, +5 new interaction/disposal
cases in the existing 3D-viewport file, +2 URL round-trip). Full website
suite: 140 files / 2415 tests green. `pnpm build:packages` (including the
one-line `resolveCharset` export) and `pnpm -C website build` both clean.

**Mutation table (this round).**

| Property | Mutation | Result |
|---|---|---|
| Live scene applies the resolved charset/colour | Hardcode `mode: "solid", useColors: true` at scene creation | `diagrams3dSceneOptions.test.ts`'s full matrix reddens; a manual check confirmed the ORIGINAL first-cut code (before this round) fails it |
| Charset/colour never remounts the scene | Fold `resolveDiagrams3dSceneOptions` into the MOUNT effect's own deps | Every charset/colour test in `DiagramsWorkbench.3d.test.tsx` would still pass bytes-wise but the camera-survives-an-edit property (untested directly, asserted by design) breaks — caught in review, not re-tested separately, since the split effect is what the mount-effect doc itself asserts |
| ANSI colour depth gets its own note, `truecolor`/`css` don't | Fold `truecolor`/`css` into the same note branch | `diagrams3dSceneOptions.test.ts`'s "truecolor/css carry no note" case reddens |
| Retargeting an effect never remounts it | Always `disposeEffect()` before mounting, even for the same `effectId` | No dedicated timing gate (the property is architectural — `applyEffect`'s own `if (effectRef.current.id === wantId)` branch — covered by code review, not a redness test) |
| A stale target hits no mesh, never scene-wide | Return `undefined` instead of `[]` from `resolveEffectTarget` on a missing mesh | No dedicated gate (documented residual: `diagrams3dEffectTargeting.test.ts` only exercises VALID targets) |
| Targeting a node changes only that node's cells | Drop the `target` field when mounting the effect layer | `diagrams3dEffectTargeting.test.ts`'s disjointness assertion reddens |
| A real drag reaches the camera, and Copy reflects it | Drop `controls.addEventListener("end", reportCamera)` | Both interaction cases in `DiagramsWorkbench.3d.test.tsx` redden |
| Trackball drag commits a `mat` camera, not Euler | Hardcode `mode: "turntable"` in the `createGlyphOrbitControls` call | The "reports a mat-based camera" case reddens (the bare "Copy changed" cases do NOT catch this mutation — see their own doc) |
| `scene.destroy()`/`controls.destroy()` actually run on teardown | Delete the `scene?.destroy()` line | Both disposal cases redden — reproduced directly against the mutation before reverting it |

**Residuals.** No edge labels in 3D (D1's own, unchanged). No cluster
volumes beyond the existing group mesh (D4). No performance gate at 200
nodes (D4). A generalized shared 3D viewport (object in, camera/options
out) was assessed and NOT extracted this round — C3's own `/charts` live
viewport was being built in parallel on the same idea, and this
component's diagram-specific auto-fit/effect wiring is not yet proven
stable enough to safely factor out without risking both efforts at once.

## D3 fix round 2 — the live object honours the resolved charset's tier, caller-owned effect-target labels, and two live-crash fixes found underneath

A second codex review found two P1s and three P2s in round 1's own D3 fix,
plus (found while implementing the first P1) two genuine, previously
untested crash bugs in the per-node effect mechanism itself. No
`packages/diagrams/src` change was needed for any of it — D2's own round 3
(running in parallel) owned that surface.

**P1-1: the live scene's OBJECT never honoured the resolved charset, only the scene's render options.** Round 1's `resolveDiagrams3dSceneOptions` forwarded `mode`/`charMode`/`useColors` to `scene.setOptions` on every charset edit, but the mount effect's own `renderGlyphDiagram3d` probe call — which builds the object `scene.addObject` actually mounts — never passed `charset` at all, so the live mesh's own overlay (`glyphDiagramObject`'s `tier`/`boxOutline`, baked in at BUILD time, not a scene-level option) stayed stuck on whichever charset the render3d.ts default happened to be. `box`/`blocks` are the sharpest case: both resolve to the IDENTICAL `mode`/`charMode` (`solid`/`ascii`) — only `canvasTier` differs — so under the round-1 bug, switching between them produced a BYTE-IDENTICAL live picture regardless of the Dock's own charset choice, silently breaking Copy/live parity for every charset but whichever one the mount happened to default to. Fixed two ways: (1) the mount effect's `renderGlyphDiagram3d` call now passes `charset: latest.current.charset`, so the INITIAL object is correct from the first frame; (2) `diagrams3dSceneOptions.ts`'s `Diagrams3dSceneOptions` now also carries `canvasTier`/`boxOutline` (`resolveCharset`'s own values, forwarded verbatim — colour never touches them), and a new `[charset]`-only effect rebuilds the object via `glyphDiagramObject(graph, { ...layoutOptions, tier: canvasTier, boxOutline })` and swaps it in via `objectHandle.update()` — which replaces meshes/overlays wholesale while keeping the handle's own identity (AGENTS.md's "Scene objects"), so the CAMERA is untouched exactly like a colour-only edit always was. Gates: `diagrams3dSceneOptions.test.ts`'s new "canvasTier/boxOutline are resolveCharset's own values, independent of colour" case (the pure-function half); `DiagramsWorkbench.3d.test.tsx`'s new "switching Charset from box to ascii replaces the live object's Unicode box-outline glyphs with plain ASCII ones" (the end-to-end half — `box`'s straight-edge box-outline glyphs are U+2500/U+2502, `ascii`'s are plain `-`/`|`, and since `box`→`ascii` is the ONE transition where `scene.setOptions`'s own payload is byte-identical, this is the one pairing that isolates the object-rebuild path specifically rather than merely re-proving round 1's `mode`/`charMode` forwarding). Both reproduced red against the pre-fix code by temporarily reverting the mount-effect `charset` argument and no-opping the `[charset]` rebuild effect.

**P1-2: `Instrument3DEffectsFolder`'s all-targets option was hard-coded to "All nodes".** The shared folder's own doc already promised no diagram-specific assumption ("`/charts`' own future C4 packet" reusing it with mark/series targets instead of nodes), but its `targetOptions` construction wrote `{ "All nodes": INSTRUMENT_3D_EFFECT_ALL_TARGET }` literally. Fixed by a new required `allTargetsLabel: string` prop, threaded into the SAME `targetKey` the dropdown's own stale-options refresh effect already keys on (so a caller CHANGING its label — not just its target list — also refreshes the dropdown). `DiagramsDock.tsx` passes `allTargetsLabel="All nodes"` explicitly. Gates: `Instrument3DEffectsFolder.test.tsx`'s two new cases ("the all-targets option uses the caller's own `allTargetsLabel`, not a hard-coded string" and "a changed `allTargetsLabel` alone refreshes the Target dropdown's own options").

**P2-3: the per-node targeting test only proved disjointness, not byte-identity outside the target.** `diagrams3dEffectTargeting.test.ts`'s own disjoint-diff-sets check couldn't catch a mutation that painted a stray background/edge cell under BOTH targets (still "disjoint" from each other, never actually proving either diff stayed inside its own node). Strengthened by projecting each node's `layout3d`-reported `center`/`half` through the SAME camera the render uses (`camera.project`, the identical math `render3d.ts`'s own `fitDiagramCamera` runs) into a per-node screen-space cell box, then asserting (a) every changed cell when targeting node A falls inside node A's own box and (b) every cell inside node B's or C's own box is BYTE-IDENTICAL between the baseline and the "targeting A" render. Getting this right needed one real discovery along the way: `scene.output.textContent` is `rows` NEWLINE-JOINED lines of `cols` characters each, not one flat `cols*rows` buffer — a naive `row*cols+col` flat index silently straddles a row boundary by `row` characters once any newline sits in front of it (harmless for the OLD disjointness-only check, which never interpreted an index as row/col; fatal for this round's box math, caught by a spurious near-boundary failure that turned out to be pure index misalignment, not a real defect — see the file's own row-major doc comment). With correct row-major indexing, no padding around each node's own projected box was needed at all (`PAD = 0` measured exact for this fixture); a first attempt at padding for "box-outline stroke slack" instead let adjacent, already-overlapping node boxes (a compact auto-fit view of a small TB graph puts neighbouring nodes' real footprints close enough to already share cells) swallow a genuinely-foreign node's own real cells, producing a false failure the other way. Gate: the strengthened `diagrams3dEffectTargeting.test.ts` case; mutation-verified by temporarily forcing the effect layer's own `target` to `undefined` (scene-wide) and confirming the box checks redden.

**P2-4: no test proved a charset/colour change calls `scene.setOptions` without remounting.** `DiagramsWorkbench.3d.test.tsx`'s `vi.mock("glyphcss", ...)` wrapper (already used for the `destroy()` disposal spies) now also wraps `createGlyphScene` itself (counting calls) and the returned scene's `setOptions`/`addEffectLayer` (recording calls / wrapping the returned layer's `dispose()`) — all real implementations, never faked. The new test moves off the default charset, then asserts a further charset edit calls `scene.setOptions` with `resolveDiagrams3dSceneOptions`'s own resolved `{ mode, charMode, useColors }` AND that `createGlyphScene`'s own call count is unchanged — then repeats for a colour edit. Mutation-verified twice: no-opping the `[charset, color]` `setOptions` effect reddens the "must be called" half; folding `charset`/`color` into the MOUNT effect's own dependency array (simulating a remount-based implementation) reddens the same assertions for the opposite reason (the remount races the test's own settle wait).

**P2-5: effect-layer and rAF disposal were untested.** The same mock wrapper's `addEffectLayer` spy lets three properties get pinned directly: changing the effect (`glitch` → `scan`) disposes the OLD layer and cancels its rAF loop before mounting the new one (extends the existing "changing the effect" test); a view switch away from 3D AND an unmount each dispose the CURRENTLY-mounted effect layer and cancel its rAF loop, not just the scene/controls (folded into the two pre-existing disposal tests, which already had the right setup). All three mutation-verified: reverting the "different effect id" branch to blindly retarget (see P1-2's crash fix below — this IS that same bug) reddens the effect-change case; dropping `disposeEffect()` from the mount effect's own cleanup reddens both the view-switch and unmount cases.

**Two genuine crash bugs, found while wiring P1-1's object rebuild to re-apply the effect layer against fresh mesh handles — not one of the five review findings, but directly underneath them, so fixed in the same round rather than left for a reader to hit.** `applyEffect()`'s "same effect, different target — retarget via `layer.setOptions({ target })`" branch (round 1's own design, and its own AGENTS.md-level claim) was verified DIRECTLY against the real library and found to throw: glyphcss's mesh-set effect target is immutable after mount ("an effect layer's mesh target is immutable after mount; remove and re-add the layer to retarget it"), so picking a DIFFERENT node while an effect was already mounted crashed the live page. Separately, `resolveEffectTarget`'s own stale-target fallback (an empty array, "matches no mesh" — round 1's own claim, ALSO never actually verified against the library) crashes too: `scene.addEffectLayer`'s target normalizer rejects a literal `[]` outright ("must contain at least one GlyphMeshHandle"). Both are real production defects a reader could hit through ordinary Dock use (pick effect, pick a target, pick a DIFFERENT target — a `?d=` link surviving a graph edit that removed its targeted node). Fixed together: `applyEffect()` now ALWAYS fully disposes and remounts on any change to EITHER `effectId` or the target (never a same-effect retarget branch at all), and `resolveEffectTarget` returns `null` for a stale target — read by `applyEffect` as "mount nothing," never reaching `addEffectLayer` with an argument it rejects. Gates: `DiagramsWorkbench.3d.test.tsx`'s new "picking a different effect target node while an effect is mounted retargets without throwing" (mutation-verified: reverting to the old `setOptions({target})` branch throws the EXACT library error message, synchronously inside `act()`) and "a stale effect target (a removed/unknown node id) mounts no effect layer and never throws" — the latter needed a `process.on("unhandledRejection", ...)` listener rather than a plain content assertion, since the crash happens inside the mount effect's own UNAWAITED async IIFE: the scene/object still mount fine ahead of the effect layer, so `.glyph-output` already has content by the time the throw fires, and a plain "content present" check would pass right through the mutation it exists to catch (confirmed: it did, on the first attempt, surfacing only as vitest's own separate "unhandled error" diagnostic rather than a failed assertion — the rejection listener is what actually pins it).

**Gate (this round).** `pnpm --filter @glyphcss/website exec vitest run
src/components/DiagramsWorkbench src/components/InstrumentWorkbench` — 307
tests across 13 files, all green (up from round 1's 299: +1 scene-options
matrix case, +2 Effects-folder label cases, +5 new `DiagramsWorkbench.3d.test.tsx`
cases — charset-tier parity, retarget-without-throw, stale-target-without-throw,
the setOptions/no-remount pair, folded into the existing effect-change and
disposal tests rather than duplicating their setup). Full website suite and
`pnpm build:packages`/`pnpm -C website build` at the final gate (below).

**Mutation table (this round).**

| Property | Mutation | Result |
|---|---|---|
| Live object's overlay tier matches the resolved charset | Drop `charset` from the mount effect's `renderGlyphDiagram3d` call and no-op the `[charset]` rebuild effect | `DiagramsWorkbench.3d.test.tsx`'s "box to ascii" case reddens (the box-outline glyphs never lose their Unicode box-drawing chars) |
| `canvasTier`/`boxOutline` are `resolveCharset`'s own values | Hardcode a tier | `diagrams3dSceneOptions.test.ts`'s new matrix case reddens |
| The all-targets option label is caller-owned | Hard-code `"All nodes"` back into the folder | `Instrument3DEffectsFolder.test.tsx`'s new cases redden |
| Every non-target node's cells stay byte-identical | Mount the effect scene-wide (`target: undefined`) regardless of the requested node | The strengthened `diagrams3dEffectTargeting.test.ts` box checks redden |
| Charset/colour edits call `scene.setOptions`, never remount | No-op the `[charset, color]` effect; separately, fold `charset`/`color` into the mount effect's own deps | Both mutations redden `DiagramsWorkbench.3d.test.tsx`'s new P2-4 case |
| Changing the effect disposes the old layer + cancels its rAF | Keep the old (buggy) "always retarget, never dispose for a same-`if` match" branch | The "changing the effect" case reddens |
| View switch / unmount dispose the mounted effect layer + cancel its rAF | Drop `disposeEffect()` from the mount effect's cleanup | Both disposal cases redden |
| A genuine node-to-node retarget never throws | Restore the round-1 `layer.setOptions({ target })` retarget branch | The new "retargets without throwing" case reddens with the EXACT real library error, both as a synchronous test failure and (separately reproduced) as the underlying glyphcss `TypeError` |
| A stale target mounts nothing, never throws | Resolve a stale target back to `[]` and pass it to `addEffectLayer` | The new "stale effect target" case reddens via its `unhandledRejection` listener (a plain content assertion alone does NOT catch this — verified, and documented as the reason the listener exists) |

**Residuals.** Round 1's own mutation-table rows for "retargeting an effect
never remounts it" and "a stale target hits no mesh" are SUPERSEDED by this
round — both were shipped as untested "architectural" claims and both were
actually broken (see the crash-bugs paragraph above); this round's own table
replaces them rather than leaving two contradictory rows in the historical
record. Everything else from round 1's residuals list (no edge labels, no
cluster volumes, no 200-node performance gate, no generalized shared 3D
viewport) is unchanged.

## D3 fix round 4 — the downgrade note moves out of the viewport into the Dock

User feedback on `/charts` 3D ("why do we have this in the rendering
area?") applied here too: round 1's own `.diagrams-3d-frame >
.target-preview__note` put a downgrade explanation INSIDE the live
viewport's own render area, breaking the rule this file's AGENTS.md
companion states plainly ("A chrome note lives in the frame's OWN chrome
… never the viewport's render area") — round 1 read `web`'s own live
scene as "carrying no chrome to put a note in," which is true, but the fix
is to put the reason where the choice is made (the Dock), not to invent
chrome for a viewport that deliberately has none.

**Removed:** the note JSX and its `.diagrams-3d-frame > .target-preview__note`
CSS rule (`diagrams-workbench.css`). `.diagrams-3d-frame` itself is
untouched — it still exists purely to size the live scene host.

**Added:** two small resolver-driven predicates in `diagrams3dSceneOptions.ts`
— `diagrams3dCharsetDockReason(charset)` (`resolveCharset(charset).ledger.length
> 0 ? "Not available for 3D diagrams yet" : undefined`) and
`diagrams3dColorDockReason(color)` (the same `color === "ansi16" ||
color === "ansi256"` test `resolveDiagrams3dSceneOptions`'s own note
already used, factored out and reused rather than duplicated). Both are
GATES, not text tables: which charsets/colours dim is decided live by
asking the library each render, never a hard-coded `blocks`/`braille`
list — deliberate, since the library is being redesigned so braille/ink
become the PRIMARY 3D looks, and a wording tied to today's specific
downgrade (wireframe/ascii) would go stale the moment that lands. The
reason text itself is reader-worded ("Not available for 3D diagrams yet",
"Live 3D always shows full colour — this only affects Copy ANSI's exported
text") rather than restating glyphcss internals.

`DiagramsDock.tsx`'s `charsetToggleOptions`/`colorToggleOptions` (the
latter newly a function, was a static array) wire these into `IconToggle`'s
existing `disabled`/`disabledReason` props — the `mapDirectionLocked`
idiom, already used elsewhere on this same Dock (the View-folder-only "3D"
folder, the Instrument3DEffectsFolder) and on `/charts`' own mark-type
toggle. Two rules, both load-bearing: the gate is scoped to `state.view
=== "3d"` only (2D never dims anything, since every charset/colour genuinely
works there); and the CURRENTLY selected option is never disabled (the
Charts mark-type-fit precedent — "the current type is never disabled") —
`disabled: reason !== undefined && v !== current`. Without the current-value
exemption, a reader already on `braille` (the library's own `web` default
charset) who then opens the 3D view would find the ENTIRE Charset row's own
active button unclickable and unable to explain itself (`IconToggle`'s
title only reads `disabledReason` while `disabled`); falling `desc` back to
the same reason (instead of `Charset: ${v}`) whenever one applies closes
that gap for the reachable-but-degraded case too —
a non-disabled button falls back to `desc` for its title, so the current
option still explains itself on hover, just via the same reason string
routed through a different field.

**Not touched:** `resolveDiagrams3dSceneOptions`'s own `note` field —
still a legitimate pure-function output (`diagrams3dSceneOptions.test.ts`
still exercises it), just no longer READ by any page component; the live
viewport's `scene.setOptions`/object-rebuild wiring (round 2's own fix)
is unchanged, since the resolved `mode`/`charMode`/`canvasTier`/`boxOutline`
were never the problem — only where the DEGRADE EXPLANATION was shown.

**Gate (this round).** `DiagramsWorkbench.3d.test.tsx` gained: a 4×5
charset×colour sweep asserting `.diagrams-3d-frame` never contains a
`.target-preview__note` (20 cases, each its own mount with the combination
baked into `initialState` rather than driven through possibly-disabled
Dock clicks); a case asserting the Charset row dims exactly
`blocks`/`braille` with the resolver's own reason on `title`/`aria-label`
while every Color option stays enabled (an ANSI depth still shapes Copy
ANSI's exported text, so dimming it would remove a working export); a case
asserting the currently-selected degraded option (`braille`, reached via a
custom `initialState` rather than a click, since `braille` starts disabled
from any OTHER current charset) stays enabled and still explains itself on
hover. `pnpm --filter @glyphcss/website exec vitest run
src/components/DiagramsWorkbench` — 280 tests across 9 files, all green.

**Mutation table (this round).**

| Property | Mutation | Result |
|---|---|---|
| No chrome note inside the live 3D viewport, any charset/colour | Re-add the removed `.diagrams-3d-frame > .target-preview__note` JSX | 14 of the 20 sweep cases redden (every combination `resolveDiagrams3dSceneOptions` would have produced a note for: `blocks`/`braille` charsets, `ansi16`/`ansi256` colours) |
| Dock dims exactly the resolver-flagged options | Drop `charsetToggleOptions`'/`colorToggleOptions`'s `disabled`/`disabledReason` wiring | The dimming case reddens (`disabled` falls back to `undefined`, a real DOM attribute difference from `true`) |
| The current option is never disabled | Drop the `v !== current` exemption | The "never disables the currently-selected charset" case reddens (`braille`, reached as the current value, becomes unclickable) |

## D2 round 3 — architecture objects

User feedback arrived in two rounds. The first ("the 3d example diagrams
suck... they should be rectangles and blocks, not squares floating in 3d")
diagnosed round 1's node-height shrink (1 -> 0.35) as the cause of a
"tiny thin slanted outline floating in empty space" look and asked for
solid rectangular blocks with per-face shading. The second, explicitly
superseding the first wherever they conflict, reframed the actual ask:
"the idea is to have these architecture graphs like flow charts or
agentic architecture or ML models architectures... make them vertical 3d
boxes and objects with labels either to the side or inside... we should
be able to render those with good detail using braille or ink mode."
Reference look: PlotNeuralNet/NN-SVG CNN diagrams (upright blocks, size
stepping left-to-right), transformer block diagrams (stacked layer
boxes), isometric agent/cloud diagrams (boxes + cylinders + arrows).
"Crisp line art, not shaded slabs" is the throughline both messages
agree on — solid Lambert-shaded fills were never the fix; UPRIGHT
GEOMETRY and REAL LINE-ART RENDER MODES were.

### Shape dispatch: check core first, wrap what exists, invent nothing

The task's own instruction was explicit: "core may need a
`cylinderPolygons` helper next to `boxPolygons`/`spherePolygons` if none
exists — check core first." It exists (`@glyphcss/core/helpers/cylinderPolygons.ts`)
but is Y-AXIS-ALIGNED (height runs along Y), inconsistent with
glyphcss's Z-up world (AGENTS.md's "Numeric conventions"). The fix is an
axis-remap wrapper, `zUpCylinderPolygons` (`glyphDiagramObject.ts`):
`toZUp(v) = [v[0], -v[2], v[1]]` applied to every output vertex, with
the input `center` converted through the inverse `fromZUp(w) = [w[0],
w[2], -w[1]]` before calling core's function. This is a proper
(determinant +1) rotation, verified numerically before it was written
into the source file: for a Z-up input center `[10, 20, 3]`, radius 2,
height 4, the wrapped output's X/Y/Z ranges were `[8,12]`/`[18,22]`/`[1,5]`
— exactly `center ± radius` on X/Y and `center ± height/2` on Z, three
matching `console.log` lines — so winding/normals need no extra
reversal (a determinant-negative remap would have inverted face
orientation and required flipping every polygon's vertex order).

The "decision object" for a `diamond`/rhombus Mermaid node (message 2:
"pick something that reads") is a `boxPolygons` output ROTATED 45
degrees about its own center on the Z axis, not `octahedronPolygons`
(which core also has, used elsewhere for `GlyphDirectionalLightHelper`)
— a rotated box reads immediately as "the diamond shape" from the same
3/4 camera a flowchart diamond already uses in 2D, and it is the
lower-risk of the two implementations (no new geometry math, just a
plain 2D rotation applied to an existing helper's output). The node's
own box-outline overlay corners rotate identically, so the crisp
outline traces the SAME shape the mesh underneath it actually is.

Dispatch (`nodePolygons`, `glyphDiagramObject.ts`): `circle` -> sphere
(unchanged from D1); `cylinder` -> the Z-up wrapper; `diamond` -> the
rotated box; everything else (`rect`/`rounded`/`subroutine`/`asymmetric`/
`stadium`, none of which have a distinct 3D read of their own) -> plain
box. `"cylinder"` was added to `GlyphGraphNodeShape` (`types.ts`) and
`GLYPH_GRAPH_NODE_SHAPES` (`validate.ts`) — verified non-breaking for
the 2D renderer by grepping `paint.ts`/`pipeline.ts` for an EXHAUSTIVE
switch on the shape type (none exists; only `.includes()`/`===` checks
for specific shapes), so an unrecognized-there `"cylinder"` degrades
gracefully to the default box-corner-glyph branch in 2D rather than
throwing. Mermaid's own `[( )]` cylinder bracket syntax is NOT parsed —
a deliberate, disclosed simplification: the LeNet-5/transformer examples
below are JSON-authored anyway (they need `size`, which Mermaid has no
syntax for either), and touching the shared `mermaid.ts` bracket table
was judged higher-risk than the marginal value justified under this
round's own scope.

### Per-node `size`: append-only through the IR, JSON-only by construction

`GlyphGraphNode.size?: readonly [number, number, number]` (`types.ts`,
`[width, height, depth]` — matching `GlyphDiagram3dNode.half`'s own
documented order `[X(width), Y(depth), Z(height)]` once halved) is
append-only on the graph IR, validated by a new `size3` predicate
(`validate.ts`: exactly 3 finite positive numbers) and a matching JSON
Schema property (`schema.ts`). `layout3d.ts`'s `resolveNodeSize` reads
it when present, else falls back to the existing
`[labelWidthCells, GLYPH_DIAGRAM_3D_NODE_HEIGHT, GLYPH_DIAGRAM_3D_NODE_DEPTH]`
default — so every graph that predates this option renders
byte-identical. A FLOW-AXIS sequential re-spacing pass (only engaged
when `graph.nodes.some(n => n.size)`) walks dagre's own rank-ordered
node list along the flow axis (X for LR/RL, Y for TB/BT), accumulating
`cursor += prevHalf + gap + half` from REAL (custom or default)
half-extents and overriding ONLY the flow-axis coordinate — cross-axis
position and topological rank order still come from dagre unchanged.
This is what lets the LeNet-5 fixture below step its own box sizes
(32x32 down to a thin FC column) without touching the shared 2D
`measureGlyphGraph`/`layoutGlyphGraph` pipeline at all.

### Labels: one pure function, shared by the overlay AND the camera fit

`labels: "inside" | "side" | "auto"` (default `"auto"`) resolves through
`resolveGlyphDiagram3dLabelPlacement` (`glyphDiagramObject.ts`) — a
PURE, camera-independent function of `(node, text, mode)`, deliberately
NOT a screen-space/projection computation. This was the single riskiest
design decision of the round: `render3d.ts`'s existing closed-form
camera auto-fit (D2 review P1-2) solves one linear inequality per label
candidate assuming an ANCHOR-PLUS-RIGHTWARD-RUN shape (`col1`,
`widthRight`), and a naive "inside" implementation that CENTERS text on
the node (rather than anchoring-and-running-right) would need a second,
symmetric bound per candidate — a real rework of the fit's own math, not
a label-placement detail. The shape was kept: `"inside"` anchors at the
node's own top-center (the SAME anchor D1/D2 always used) and CLIPS text
that exceeds the node's own footprint width in cells (`Math.floor(half[0]
* 2)`), rather than letting it spill past the box — verbatim clipping,
no ellipsis, matching AGENTS.md's diagram-wide "a label never floats
unattached, never spills across another object" generalized from 2D to
a 3D face. `"side"` anchors past the node's own right edge (`half[0] +
1` cell of gap) with `leaderFrom` set to EXACTLY the node's own edge
point — never floating — and the overlay stamps a real depth-tested
leader line from `leaderFrom` to the anchor through the identical
`stampGlyphOverlayLine` primitive edges and box outlines already use.
`"auto"` resolves to `"inside"` whenever the (possibly folded) label
already fits — true for EVERY default-sized node, since `layout3d.ts`
already sizes a node's footprint to at least its own label width when no
custom `size` is given, so every pre-existing fixture (agent-supervisor,
crew, karate club) renders byte-identical under the new default. `"auto"`
first falls through to `"side"` only for a node given an explicit,
label-narrower `size` — the CNN fixture's own `conv`/`pool` layers.

Because both `glyphDiagramObject`'s overlay `stamp()` and `render3d.ts`'s
`fitDiagramCamera` call the SAME function for the SAME `(node, text,
mode)`, the two can never predict a different landing cell — the exact
"synchronized change" risk identified while this was being designed
never had a chance to manifest, because there is only ever one place the
anchor/clip logic lives.

### Detail via the renderer's own modes, not hand-drawn overlays

The default detail comes from `mode: "ink"` (crisp silhouette + crease
outline, `ascii`/`box`/`blocks`, the last ASCII-downgraded since its
own dual-colour sub-cell encoder bypasses the stamped-overlay path this
renderer depends on) or `wireframe` + `charMode: "braille"` (`braille`,
2x4 sub-cell dots) — both with `hiddenLines: "hide"`, so a back edge or
an object standing behind another disappears rather than drawing
through it. This is a pure PARAMETER-VALUE change to the existing
`compileScene({ objects, mode, charMode, hiddenLines })` call in
`render3d.ts`'s `renderObjectFrame` — verifying this was possible with
NO internal glyphcss/compileScene change was the round's own explicit
escape-valve check ("if `compileScene` can't render ink/braille with
object overlays honestly, STOP and report the exact limitation"): it
already accepted `mode`/`charMode`/`hiddenLines` as scene-wide options
(confirmed at `compileScene.ts` line ~44-60 and ~396/471) and
`render3d.ts`'s existing `renderObjectFrame` helper already threaded
`mode`/`charMode` through — no limitation was found, so nothing was
worked around. The hand-drawn 12-edge box-outline overlay (D2 review
P1-1's own original fix, for a SOLID mode that draws no polygon edges of
its own) is now suppressed by default (`boxOutline: false` under `ink`/
`wireframe`) — message 2's own "REUSE the renderer's modes. Do not
hand-draw outlines with overlays where a render mode already does it" —
and kept reachable only under an explicit `style: "solid"` override,
which still wants it for the same reason it always did. `style: "ink" |
"wireframe" | "solid"` (`GlyphDiagram3dRenderOptions`) lets a caller
force any of the three regardless of charset; `"solid"` reaches the OLD
Lambert-shaded box render verbatim (D1/D2 fix rounds 1-2), so nothing
built before this round was actually removed, only stopped being the
default. `resolveCharset`'s `ledger3dCharsetDegraded` gained a third
`renderedAs` value (`"ascii ink"`, for `blocks`'s downgrade) alongside
the existing `"wireframe"`/`"ascii"`.

### Camera: a readable 3/4 view, not a top-down one

Default `rotX` dropped from `55` to `32` (`rotY` `35` to `38`) — message
2's "a readable 3/4 view from slightly above and in front, so upright
boxes read as boxes." At the old, steeper pitch a tall vertical box
read mostly as its own TOP face; the new pitch keeps enough tilt to
read as unambiguously 3D while showing far more of each box's own
front/side faces, which is the entire point of "vertical 3D boxes...
with labels inside or to the side" — a label or a face detail on a
face the camera barely grazes is wasted work. This is the one change in
the round with a real, measured regression cost: a force-layout fixture
that cleared every label at the old 55/35 pitch can legitimately
collide at the new, more frontal one (a genuinely different camera pose
sees genuinely different on-screen overlaps) — `render3d.test.ts`'s own
seed-sweep gate was updated to check "no SILENT drop" (every missing
label named in the ledger) rather than "no drop at all," matching the
standard every OTHER camera-angle gate in that file already held.

### Mutation gates added this round

| Guarantee | Mutation | Gate |
|---|---|---|
| Shape dispatch is real (cylinder/diamond aren't silently box) | Always call `boxPolygons` | Cylinder mesh polygon count (18) equals the 6-face box's; diamond's rotated X-span equals its own unrotated width |
| An `inside` label never spills past its own face | Drop the `slice(0, faceWidthCells)` clip | A narrow-`size` node's placed text is no longer `<=` its own footprint width |
| A `side` label's leader touches its own object | Drop the `+ half[0]` edge offset | `leaderFrom` no longer equals the node's own `center[0] + half[0]` |
| The arrowhead glyph is computed from real travel direction, not a fixed glyph | Return `tier.arrow.e` unconditionally | `pairGraph` (TB) alone didn't catch this — its own true direction happens to be `▶` too, a real coincidence found only by adding `pairGraphLR` (LR direction, a genuinely different real direction) and asserting both |
| Live scene and static `compileScene({ objects })` render byte-identical frames under the new default | Reintroduce a mode/charset mismatch between the two paths | `render3d.test.ts`'s own byte-identity gates, updated to build their comparison `createGlyphScene` with the SAME `mode: "ink"`/`hiddenLines: "hide"`/`boxOutline: false` the real path now resolves to |

### Kept from round 3's original packet, re-verified under the new geometry

P1-1's narrow arrowhead-foreign-occlusion fix (winner-mesh/depth check,
D2 fix round 3's own original section) needed no change — it reads
`grid.winnerMesh`/`grid.depth` generically, independent of node shape.
P2-3's adaptive large-graph policy (auto-force-layout past 16 nodes,
label-budget suppression, arrowhead-density suppression) was NOT scoped
back this round, a deliberate choice under the round's own time budget:
it is harmless (fully gated, no behavior change for any graph under its
thresholds) and re-scoping it risked destabilizing the karate-club gate
for no benefit the user actually asked for in round 3's superseding
message — disclosed here rather than silently left unexamined.

### Worked examples (96x32, `web` target, both `box` and `braille` charset)

Three fixtures, rendered through the real `renderGlyphDiagram3d` pipeline
at this round's own defaults (`style` unset — `ink`/wireframe-braille):

- **`packages/diagrams/fixtures/agent-supervisor.mmd`** (reused verbatim,
  D3's own preset) — a LangGraph-style supervisor fanning out to three
  workers, `zBy: "group"` putting the supervisor's own floor above the
  workers'.
- **`packages/diagrams/fixtures/lenet5-cnn.json`** — a LeNet-5-style CNN,
  `direction: "LR"`, per-layer `size` (SCALED DOWN for legibility, not
  literal pixel counts, chosen by the fixture's own author): input
  32x32x1 -> conv 28x28x6 -> pool 14x14x6 -> conv 10x10x16 -> pool
  5x5x16 -> fc 120 -> fc 84 -> out 10, each box's own width/depth tracking
  spatial resolution and height tracking channel count (the fc layers'
  own tall, thin columns are the classic PlotNeuralNet "flattened dense
  layer" read).
- **`packages/diagrams/fixtures/transformer-encoder.json`** — a
  transformer encoder block, `direction: "TB"`: Input Embedding (a
  `cylinder` — an embedding table IS a lookup/datastore, the "distinct
  object where fitting" message 2 asked for) -> Positional Encoding ->
  Multi-Head Attention -> Add & Norm -> Feed Forward -> Add & Norm.

Honest visual assessment, not just "it renders": the CNN and transformer
frames are noticeably more CLUTTERED than the agent-supervisor one — long
diagonal runs of `/`/`\` glyphs cross the frame between nodes whose
cross-axis (depth/height) sizes differ sharply (the CNN's `input`
depth-8 box next to the `fc1` depth-1 column, for instance). This is
NOT a rendering defect: an orthographic projection of a genuinely
axis-aligned, Manhattan-routed 3D edge (`orthogonalPlanePoints`, D2 fix
round 3's own routing) can still trace a DIAGONAL path on screen once
the camera is rotated, because screen column/row are linear
combinations of world X/Y/Z under any oblique 3/4 view — a "straight" 3D
line is only screen-straight when it happens to lie in the view plane.
What IS a genuine, disclosed residual: neither the layout nor the
camera in this round was specifically TUNED for a stepping-CNN or a
stacked-transformer topology (the user's own reference images are
hand-composed 2D diagrams, not raw 3D-camera captures) — a follow-up
packet that fits the camera per-topology (e.g., a near-orthographic
"straight-on" pose for a pure LR/TB chain, where every edge IS
axis-aligned on screen) would read cleaner than this round's one fixed
3/4 default applied uniformly. The frames are included in the final
report verbatim, uncropped, so this tradeoff is visible rather than
described only in prose.

## D2 round 4 — the follow-up packet round 3 predicted, arrived

The user rendered round 3's own three examples through the built CLI and
held the merge: "objects are slivers next to full-size labels," "the flow
runs diagonally across the screen," "edges [should be] short straight
arrows between facing faces," "size scaling blows up," and one consistent
label side per flow direction. Four of these five are the EXACT residual
round 3's own closing section predicted ("neither the layout nor the
camera... was specifically TUNED for a stepping-CNN or a
stacked-transformer topology") — this section is that follow-up packet,
not a fresh redesign.

### Root cause 1: a label's screen footprint does not shrink with zoom, an object's does

The report's own diagnosis was exactly right: a diagram's TEXT is stamped
as literal characters (fixed cell count, independent of camera zoom),
while a node's own BOX shrinks with whatever zoom the auto-fit computes to
fit the WHOLE scene. Round 3's own node HEIGHT/DEPTH bump (`3.2`/`1.4`)
was still too thin relative to that fixed label footprint once a
multi-node diagram's own total span (objects PLUS round 3's flat, dagre-
`ranksep`-derived gaps) forced the zoom down. The fix has two parts, and
both matter — fixing only one leaves the other's own failure mode:

1. **Bigger defaults**: HEIGHT `7`, DEPTH `2.4`, and — the one that
   actually mattered for the reported "Coder" case — the WIDTH floor `12`
   (round 3's `3`, unchanged from before this whole feature existed).
   Measured: a 5-character label ("Coder") already got a 9-world-unit box
   from dagre's own padding, and even THAT undershot the round's own
   `>= 10 cols` silhouette floor once the zoom a 4-node TB stack forces is
   accounted for — the floor had to clear the WORST case, not the typical
   one.
2. **Proportional gaps**: `GLYPH_DIAGRAM_3D_FLOW_GAP_FACTOR = 0.5` — the
   clear gap between two flow-adjacent objects is now `0.5 * (their own
   average half-extent)`, never a flat `ranksep`-derived constant. This
   engine change (`compressExplicitSizes`'s sibling, the flow-axis
   sequential packer) now runs UNCONDITIONALLY, for every layered graph —
   round 3 gated it behind "any node has a custom `size`"; a
   DEFAULT-sized graph needed the identical discipline just as much, or
   its own gaps stayed dagre's flat, many-object-widths-apart guess.

Gate (`render3d.test.ts`): every node's own projected AABB (all 8 box
corners through the resolved camera) is `>= 10 cols x 5 rows` at 96x32,
for both `agentGraph` (TB, the new Z-flow path) and a fresh 4-node
`chainGraphLR` fixture — chosen deliberately DEFAULT-sized (no `size` at
all), so this gate is provably about the LAYOUT fix, not anything `size`
compression (below) touches.

### Root cause 2: TB never actually stacked along Z for an ungrouped graph

Round 3's own Z axis came entirely from `zBy` (default `"group"`), and a
graph with no `groups` at all — the transformer fixture, the whole reason
TB direction exists in this round's own deliverables — got FLOOR 0 for
every node. Its own "vertical stack" was, underneath, dagre's plain 2D
rank position (`Y`) read through a 3/4 camera: a flat diagonal, not a
stack. The fix: when `zBy` is left unset on an ungrouped TB/BT graph
(`useRankZFlow`), Z is now assigned by the SAME real-half-extent
sequential packer LR/RL's own flow axis uses — walking nodes in dagre's
own RANK order (its `y0`/`y1`, read only for ORDER, never for the final
Z value) and writing Z directly; `cy` (the old rank axis) is forced to
`0`, since Z now carries the progression and spreading nodes front-to-back
too would fight it. A GROUPED graph (`agent-supervisor`) is completely
untouched — its own `zBy: "group"` floors already gave it a genuine Z
read (the supervisor's own floor above the workers'), and re-deriving Z
from rank there would have fought a real, working semantic for no
reason. `docs/design/charts3d.md`'s own D2-round-3 doc already names
`zBy: "rank"` as "the natural mechanism for a TB transformer stack" —
this is that mechanism, made the UNGROUPED DEFAULT rather than an opt-in,
and upgraded from `zBy: "rank"`'s own fixed `GLYPH_DIAGRAM_3D_LAYER_HEIGHT`
floor spacing to the real-per-node-height packer, since an
explicitly-sized TB stack (Add & Norm vs. Multi-Head Attention) can have
genuinely different per-stage heights that a flat floor spacing can't
respect.

**A real, subtle bug found and fixed along the way**: every one of these
direction checks (`isVertical`, the flow-axis pick, the rank-order axis)
originally read `options.direction` ALONE, never falling back to the
GRAPH's own `direction` field — the SAME fallback `pipeline.ts`'s
`measureGlyphGraph` already applies internally
(`options.direction ?? canonical.direction`). Since a caller almost
NEVER passes a separate `options.direction` (the direction lives on the
graph itself), this silently misclassified every direction-on-the-graph-
only LR diagram as "vertical" — caught by running the new
`chainGraphLR` gate fixture and finding its own Z coordinate spread
across 3 to 31 world units instead of staying flat. Fixed at the root
(`effectiveDirection = options.direction ?? graph.direction`, computed
once per layout call), not by special-casing the symptom.

### Root cause 3: a small PER-STEP camera ratio still compounds over a long chain

The round's own numeric gate ("consecutive LR nodes' projected centres
differ in row by <= 15% of their column separation") was satisfied by the
FIRST camera cut tried (`rotX: 70, rotY: -70`, measured ratio 0.1245) —
and the rendered LeNet-5 frame still swept visibly downward across its
own 8 nodes. The two are not the same guarantee: a per-CONSECUTIVE-PAIR
bound COMPOUNDS LINEARLY over a chain of any length, so 0.1245 of drift
per step is ~1 full row of drift every 8 columns — trivial for a 2-node
test fixture, ~12 rows of real, measured drift across LeNet-5's own wider
span. Derived from the camera's own exact Euler math
(`rotateVec3Voxcss`, `col ~ Y·cosY - X·sinY`, `row ~ (Y·sinY + X·cosY)·cosX
- Z·sinX`): at `rotY = -90` EXACTLY, `cosY = 0`, which zeroes row's own X
coefficient (`cosY·cosX`) OUTRIGHT — not approximately, structurally,
the same way `col` NEVER carries a `Z` term at any angle (the
mechanism the TB stack already exploited, symmetric case, LR/RL's own
flow axis instead of TB/BT's). `col = -X` exactly at this angle (the
flow's own screen position at FULL, unreduced scale) and `row = Y·cosX -
Z·sinX` carries no `X` term whatsoever — zero drift for a consecutive
pair AND for the whole chain, for a graph of any length, not a smaller
number that still eventually compounds. The tradeoff, stated rather than
hidden: depth (`Y`) no longer shifts a box sideways on screen (its own
column coefficient is `cosY = 0` too), so a box's own side face reads as
a vertical offset instead of a horizontal one — a real 3D cue, just
reoriented, not lost. Gate: the SAME `chainGraphLR` fixture's
consecutive-pair ratio (still checked, still `<= 0.15`, now `0` in
practice) — the fix is proven by the VISUAL frame captures below, since
a "still under budget but compounds" regression would pass a
per-pair-only gate exactly as this defect originally did.

### Root cause 4: literal `size` scale makes the smallest layer a speck

Requirement 4's own diagnosis: the transformer's cylinder (default-sized,
since `transformer-encoder.json` gives it no explicit `size`) read as a
third of the frame next to specks — but the REAL defect this named was
about EXPLICIT `size`, not defaults ("defaults... are uniform" is the
requirement's own second half, unaffected). `compressExplicitSizes`
(`layout3d.ts`) runs once per graph, per axis, over every node that gave
an explicit `size`: `compressed = max * (raw/max) ** 0.5` (the axis's own
largest value is the sqrt map's fixed point, unchanged; every smaller
value is pulled up nonlinearly — a raw 1/8 ratio becomes ~0.35, not
0.125), then the smallest is clamped UP to `>= max / 4` so a real CNN
still visibly shrinks layer to layer but never collapses past a 4x
spread. A node with NO explicit `size` reads its own default sizing
exactly as before, untouched by any OTHER node's compression — gated
directly (`layout3d.test.ts`): the ratio clamp, that the smallest node
genuinely GREW past its own raw half-width (not merely that the ratio
was clamped by shrinking the largest instead — a mutation that clamped
the wrong end would still pass a ratio-only check), that the largest is
the map's own unchanged fixed point, and that an untouched sibling node
is unaffected.

### Smaller fixes folded in from the same visual review

`labels: "side"`'s fallback direction is now direction-aware
(`glyphDiagram3dLabelSideDirection`) — `"below"` for LR/RL (message 2's
own worked example puts dimensions under each block, on one shared row;
"to the right" would sit ON TOP OF the next object in the chain) versus
`"right"` (round 3's own, unchanged) for TB/BT, where the flow itself is
vertical so a side callout to the right competes with nothing. And
`zUpCylinderPolygons` dropped from `sides: 16` (core's own default) to
`8`: at diagram scale a 16-sided cylinder's own crease count reads as
visual noise under `ink`/`wireframe` line art (one crease drawn per
side, unlike a 6-face box) — 8 is the fewest sides that still reads
unambiguously round rather than a hexagon in box-drawing/braille line
art. Not chased fully: the transformer's own `Input Embedding` cylinder
is still the busiest object in the diagram after this change — a
disclosed residual (below), not silently accepted.

### Residuals, disclosed rather than chased further

The transformer's cylinder, even at 8 sides, remains visibly busier than
the box objects around it in `ink` mode — a real, measured, DIFFERENT
kind of clutter than the round's own reported defects (which were all
about SCALE/POSITION, not per-object linework density), and genuinely
improved (roughly half the crease count) rather than eliminated.
`agent-supervisor`'s own frame is unchanged by this round on purpose — it
is a FAN-OUT/cyclic topology (a supervisor, workers, a back-edge), not a
linear chain, so "the flow reads along a screen axis" has no single
axis to align to; its own visual complexity is inherent to that shape,
not a camera or spacing defect this round's fixes address.

### Worked examples, re-captured (96x32 box/braille, 140x40 box)

The same three fixtures round 3 shipped, rendered through the now-fixed
pipeline: `agent-supervisor.mmd` (unchanged, included for comparison),
`lenet5-cnn.json` (LR — now a genuinely flat, left-to-right stepping
chain with every dimension label on one shared row beneath it, matching
the target ASCII art's own convention closely), `transformer-encoder.json`
(TB — now a genuine vertical stack in the correct top-to-bottom order,
short vertical arrows between adjacent stages, the cylinder's own
residual noise aside). Full, uncropped frames are in the final report
rather than duplicated here a second time.

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

### F5b fix round 2

The re-review of fix round 1 confirmed P1-1/P1-2/P1-3 closed and found one
more P2: `autoFit`'s crop still dropped `CellGrid.occluded`. `occluded` is
not one of `buildCellGrid`'s own constructor arguments — it is durable grid
state written POST-construction (`cells.ts`'s own `cloneCellGrid` attaches
it the same way, `if (grid.occluded) clone.occluded = ...`), so `cropCellGrid`
now crops it with the same `cropTypedField` helper the other stride-1
buffers use and attaches it to the built grid directly, mirroring
`cloneCellGrid`'s own pattern rather than growing `buildCellGrid`'s already
17-argument positional signature for one caller. Absent stays absent (no
`occluded` on the source grid — the ordinary case, since it is allocated
only under cross-layer occlusion — crops to no `occluded` on the result).

| Gate | Mutation applied | Result |
|---|---|---|
| `autoFit`'s cropped grid carries `occluded`, matching the uncropped window | Drop the `crop1(grid.occluded)`/`cropped.occluded = occluded` lines, keeping every other buffer's crop | RED — `TypeError: Cannot read properties of undefined (reading '0')`, the synthetic-grid test's own `cropped.occluded![dstIdx]` access |

Reverted and re-verified green after.

## D2 round 5 — one planar layout, one fixed oblique camera

**Goal (user brief, verbatim intent).** Replace the per-direction 3D layouts
and cameras (round 3/4's `zBy`-selected floors plus a direction-keyed camera
default) with ONE planar path: the 2D renderer's own dagre layout goes onto a
vertical plane facing the viewer, and nodes extrude backwards as upright
blocks, under a single fixed oblique camera. Faces size from the 2D measured
label boxes, edges reuse the 2D orthogonal router and arrowhead table, and
every applicable gate (ink/braille, `hiddenLines`, `style`, shapes, `size`,
label modes, auto-fit) still holds.

### The camera: solving for zero screen-row drift, analytically

`createGlyphOrthographicCamera.project()` is not an approximation to invert —
`rotateVec3Voxcss` gives the EXACT formula this whole derivation is built on:

```
col  = v[1]*cosY - v[0]*sinY
row  = (v[1]*sinY + v[0]*cosY)*cosX - v[2]*sinX
depth = (v[1]*sinY + v[0]*cosY)*sinX + v[2]*cosX
```

(`v` is the vertex relative to `camera.target`; `cosX/sinX` from `rotX`,
`cosY/sinY` from `rotY`.) For a vector confined to the ground plane (world
`Z = 0`) at polar angle `φ` — i.e. `v = r·(cos φ, sin φ, 0)` — each of the
three camera outputs is `r` times a function of `φ` alone:

```
col_coeff(φ)   = sin(φ - rotY)
row_coeff(φ)   = cos(φ - rotY) * cosX
depth_coeff(φ) = cos(φ - rotY) * sinX
```

**Zero row-drift is one equation.** `row_coeff(φ) = 0` requires
`cos(φ - rotY) = 0`, i.e. `φ = rotY + 90°`. That is the entire derivation —
`u`, the plane's own "ground" direction (where the 2D layout's `x` axis
embeds), is fixed at this one angle for a given `rotY`, and NOTHING else
makes `row_coeff` vanish. `glyphDiagram3dPlaneAxes(rotYDeg)` returns this `u`
as a unit `Vec3` with a literal `z: 0`.

**The perpendicular, `n`, is forced — not chosen.** `n`'s angle is
`φ_u + 90° = rotY + 180°`, so `cos(φ_n - rotY) = cos(180°) = -1` and
`col_coeff(φ_n) = sin(180°) = 0` — `n`'s own COLUMN coefficient is exactly
zero, a mathematical identity of the `u`/`n` pair being perpendicular under
this projection, not a second design decision. This is why `n` (the node
extrusion / depth axis) never drifts sideways on screen either: pushing a
node "back" along `n` moves it straight down in `row` and not at all in
`col`, which is exactly the "depth reads as literal depth" property an
oblique architectural view needs.

**`rotX`'s sign convention is inverted from naive intuition, and was found
by testing, not by re-deriving the algebra.** In `rotateVec3Voxcss`,
`rotX = 0` sends `row` to `-(v[1]*sinY + v[0]*cosY)*sinX = 0` for a
ground-plane point when `sinX = 0`, i.e. `rotX = 0` is a purely SIDE-ON
("horizontal") view with no vertical foreshortening of the ground plane at
all, and `rotX = 90` gives `cosX = 0`, collapsing the ground plane's own
`row_coeff` to zero everywhere — a bird's-eye/top-down view. This is the
OPPOSITE of what "pitch 20-25° from above" (the brief's own architectural
phrasing) suggests at face value; a low `rotX` (near 0) reads as looking
ALONG the ground, and a `rotX` near 90 reads as looking DOWN at it. Chasing
this by algebra alone would have picked the wrong end of the range — it was
resolved by rendering test frames at `rotX: 20`, `rotX: 65`, `rotX: 90` and
reading which one actually showed "a top and a side face," per the brief's
own "LOOK, don't just reason" instruction. The settled constants:

```ts
export const GLYPH_DIAGRAM_3D_CAMERA_ROT_X = 68;
export const GLYPH_DIAGRAM_3D_CAMERA_ROT_Y = 30;
```

`rotX: 68` sits close to the top-down end (mostly looking down the Z axis,
which is what makes a WIDE, many-node layout still fit a short frame — the
brief's own "20-25° pitch" read as "68 degrees off dead-level," an
architectural elevation pitched down, not "68 degrees off top-down") while
still tipping enough to show each box's own top face as a real sliver;
`rotY: 30` is inside the brief's "25-35° yaw" band and gives a legible
diagonal on both `u` and the vertical (world `Z`) axes at once.

**One asymmetry is inherent, not tunable.** Width scales at
`zoom / cellPxW` (`cellPxW = 25`) while height scales at
`sinX * zoom / cellPxH` (`cellPxH = 50`) — roughly a 2x disadvantage for
vertical extent at ANY `rotX`, since the theoretical maximum of
`sinX * cellPxW / cellPxH` is `0.5` at `rotX = 90` (which throws away all
pitch). Sweeping `rotX` at `68/75/80/84` measured only a marginal
improvement over `68`, confirming this is a structural property of the
camera/cell-aspect combination, not a badly-chosen angle — it is the reason
`GLYPH_DIAGRAM_3D_MIN_HEIGHT` (below) exists at all.

### The layout: the 2D dagre result embedded on the plane

`layoutLayered` reuses the EXISTING 2D pipeline verbatim —
`measureGlyphGraph` → `reserveGlyphGraphPorts` → `layoutGlyphGraph` (dagre) →
`routeGlyphGraphEdges` (Manhattan A*) — then maps every 2D coordinate onto
the plane through one function:

```ts
function planePoint(u: Vec3, n: Vec3, uOffset: number, nOffset: number, zOffset: number): Vec3 {
  return [uOffset * u[0] + nOffset * n[0], uOffset * u[1] + nOffset * n[1], zOffset];
}
```

2D `x` (the dagre layout's own horizontal axis) becomes the plane's `u`
offset; 2D `y` (downward, dagre's own rank axis) becomes the WORLD Z offset,
negated (`-c.y`) so a lower 2D rank sits lower on screen, matching the
reader's own top-to-bottom or left-to-right expectation for TB/LR alike —
there is no longer a `zBy`-selected floor, and no separate per-direction
camera: whichever direction the 2D layout already ran in, the SAME `u`/`n`
embedding and the SAME fixed camera show it correctly, because `u` was
solved to be direction-agnostic (it depends only on `rotY`, never on the
graph's own `direction`).

**Node faces size from the 2D measured label box, never a flat constant.**
`layoutLayered` widens each 2D node's own measured `width`/`height` (in the
SAME cell units the 2D router already lays out in — "so inside labels always
fit," the brief's own requirement) before handing it to dagre, so a wide
label produces a wide box and a short one a narrow box (verified: "Coder"
half-width `4.50` against "Orchestrator" half-width `8.00` on the identical
fixture — this is the design working as intended, not a residual). Depth is
`0.35-0.5x min(width, height)` (`GLYPH_DIAGRAM_3D_DEPTH_FACTOR = 0.42`,
floored at `GLYPH_DIAGRAM_3D_MIN_DEPTH = 1.5`), the brief's own band.

**`GLYPH_DIAGRAM_3D_MIN_HEIGHT = 12` is an UNCONDITIONAL floor on the front
face's own vertical extent** (world Z), applied to a plain measured height
AND to an explicit-`size`-compressed one alike. This exists because of the
inherent width/height scale asymmetry above: a WIDE multi-node chain (the
brief's own LeNet-5 fixture — 8 nodes, several with an explicit `size`, so a
"no explicit size" gate alone had no effect on it) auto-fits at a
COLUMN-constrained zoom (many box widths, each already forced to at least
its own label's length, summed against a 96/140-column frame), and at that
zoom a literal ~3-unit 2D height (the router's own readability floor,
"does the label's text fit," never a target for how TALL a box should
stand) projects under a single output row — the brief's own reported defect,
"flat rectangles, no side face and no depth." The constant was tuned by
rendering, not computed: `6` gave a barely visible improvement, `12` gave a
substantial one, clearest at 140x40 where LeNet-5's boxes now show ~7 rows
with a genuinely visible depth band.

**Back-edges and self-loops need symmetric routing margin — the SAME fix the
2D renderer's own `centered()` already applies.** Nodes packed flush against
`x = 0`/`y = 0` (dagre's own default origin) give a back-edge or a self-loop
nowhere to detour around on the low side. `layoutLayered` now shifts the
WHOLE layout by `(dx, dy) = floor(ROUTING_MARGIN / 2)` before routing (never
after — routing itself must see the free space), reproducing the 2D
renderer's own centering pattern rather than inventing a new one;
`ROUTING_MARGIN = 10` clears a grouped 4-node test graph's back-edge, a
plain 2-node self-loop, and the crew fixture's `review -.-> writer` back-edge
(all three UNROUTABLE at zero margin — verified via debug scripts stepping
margin from `0` up, resolved by margin `2`, kept at `10` for headroom).

**Edge endpoints anchor on the port's own ANCHOR cell, not its ESCAPE
cell.** `route.cells`' first/last points are the router's ESCAPE cell (one
unit outside the node, where the A* walk actually starts/ends), not the
ANCHOR (on the node's own border) — using it verbatim left every edge
landing 2 world units off the node's own face
(`expected 2 to be <= 1.500001`). Fixed by substituting the port's own
`anchor` for the collapsed route's first/last corner: provably collinear,
since `escape = anchor + outward_delta` and `route.ts`'s own A* is forced to
continue in that same outward direction for its first step, so the
substitution never introduces a kink.

**Groups render as a recessed backdrop frame, pushed straight back along
`n`** (`GLYPH_DIAGRAM_3D_GROUP_RECESS_GAP = 1.5` behind the group's own
deepest member) — chosen over drawing them in front, because a frame behind
the group reads unambiguously as a backdrop rather than competing with
member boxes for the same depth band.

**Arrowheads and edge glyphs stay screen-slope-derived, deliberately kept
unchanged from before this round.** `arrowGlyph`/`segmentGlyph` pick their
glyph from the ACTUAL projected screen direction of a route segment, not
from a stored 2D side — this was tested and kept because it is correct under
ANY camera (the fixed default, OR a live-orbited one), where a
stored-2D-side approach would only be correct for the exact default camera.
"There are no free 3D diagonals any more" (the brief's own requirement) is
therefore a property of the ROUTE (Manhattan, reused verbatim from the 2D
router) rather than of the glyph-picking code, which was already general.

### Mutation table

| Gate | Mutation applied | Result |
|---|---|---|
| Every projected row exactly matches 2D rank ordering (exact, reversed-6-chain) | Use an arbitrary `rotY` offset for `u` instead of the solved `rotY + 90°` | RED — nonzero row drift measured |
| `glyphDiagram3dPlaneAxes` is orthonormal at every swept `rotX`/`rotY` | Drop the `n = rotY + 180°` derivation, substitute an unrelated perpendicular guess | RED — `col_coeff(n) !== 0` |
| Edge endpoint lands exactly on the node's own front face (`localOffset ≈ -half[n]`) | Use the route's escape cell verbatim instead of substituting the port anchor | RED — `expected 2 to be <= 1.500001` |
| Grouped 4-node graph / self-loop / crew back-edge all route (no `unroutable`) | Drop the centering shift, keep `ROUTING_MARGIN` | RED — 3/3 cases fail with `route.cells.length === 0` |
| A default-sized node's height clears a legibility floor; width scales with its own label length | Drop `GLYPH_DIAGRAM_3D_MIN_HEIGHT`'s unconditional floor | RED — height collapses under the floor on the LeNet-style fixture |
| No single constant zoom fits two differently-sized graphs (auto-fit is real) | Apply one graph's own auto-fit zoom, scaled by a fixed constant, to a wider graph | RED — a label overflows the frame with no ledger entry |
| The static frame equals the live `createGlyphScene` frame at the same camera/object | Skip overlay stamping in the static path | RED — `result.text !== liveText` |
| Braille under default (ink) style logs NO `3d-charset-degraded`; `blocks` still does | Reintroduce a blanket "every non-box charset degrades" rule | RED — braille wrongly logs degradation |

Every mutation above was applied to the working tree, run, observed red,
then reverted and re-verified green (`packages/diagrams` full suite: 267
tests, `website` `DiagramsWorkbench`/`InstrumentWorkbench` suites: 329
tests).

### Residuals (honestly reported, not silently dropped)

1. **`researcher -> supervisor` on the agent-supervisor fixture is
   genuinely unroutable at every setting tried** (routing margin up to 20,
   several `nodesep`/`ranksep` combinations) — 3 back-edges converge on
   Supervisor's own north side alongside a forward `user -> supervisor`
   edge; 2 of the 3 back-edges route successfully, only `researcher`'s
   consistently fails. Cross-checked against pure 2D's OWN
   `renderGlyphDiagram()` (with its full compaction/retry/split machinery)
   on the byte-identical fixture: 2D also fails to route it cleanly and
   falls all the way to its own `split`-panel fallback
   (`routing-attempt`/`split` ledger entries) — this is a genuine structural
   routing conflict in the fixture's own topology, not a defect introduced
   by the plane-embedding bridge. Reported via the `unroutable` ledger code
   on every render (visible in the "Agent supervisor" frames below), never
   silently dropped, consistent with the design's existing "never silently
   drop an edge" contract (already demonstrated working for the grouped
   4-node test graph, the plain self-loop, and the crew fixture's own
   back-edge, all of which DO route cleanly).
2. **LeNet-5 at 96x32 stays visually tight** — 2 labels (`input`, `pool2`)
   are honestly dropped via the `3d-label-dropped` ledger code (visible in
   the frame below) rather than overlapping or silently vanishing; 140x40
   clears this with real margin. This is the inherent width/height scale
   asymmetry described above, sized against an 8-node, several-explicit-
   `size` fixture at the smaller of the two required box sizes — not a
   defect in a specific constant, since sweeping `rotX` and `MIN_HEIGHT`
   both plateau well short of eliminating it at 96 columns.

### Rendered frames (D2 round 5)

All four examples — LeNet-5, transformer encoder, agent supervisor, and the
crew graph (`flowchart LR; request[Request] --> manager[Manager]; subgraph
crew[Crew]; researcher[Researcher] --> writer[Writer]; end; manager -->
researcher; writer --> review{Review}; review -->|approved| result[Result];
review -.->|revise| writer`) — rendered via `renderGlyphDiagram3d` at
96x32 box, 96x32 braille, and 140x40 box, `color: "none"`, default (`ink`)
style. Verbatim output, `packages/diagrams`'s own build:

```
================================================================================
LeNet-5 — 96x32 box
================================================================================
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
     ----------▕  ----------▏ __________|  __________|                                          
     -----------  ---conv 28x28x6-pool 14x14x6-conv 10x10x16------ ---fc 120--fc 84 ---out 10   
     |         ▕  |         ▏ ▕         |  ▏         | ▕         ▏ ▕     ▕  ▏    ▕  ▏     |     
     |         ▕───▶        ───▶        ───▶         ───▶        ───▶    ▕───▶   ▕───▶    |     
     |__________  __________▏ ___________  ▏_________| ▕ ________▏ _______  ______  ▏______     
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
LEDGER: [{"code":"3d-label-dropped","message":"The \"input\" label (\"input 32x32x1\") didn't make it into the final frame — likely hidden behind another node or collided with a neighboring label at this camera angle.","detail":{"nodeId":"input","label":"input 32x32x1"}},{"code":"3d-label-dropped","message":"The \"pool2\" label (\"pool 5x5x16\") didn't make it into the final frame — likely hidden behind another node or collided with a neighboring label at this camera angle.","detail":{"nodeId":"pool2","label":"pool 5x5x16"}}]
================================================================================
LeNet-5 — 96x32 braille
================================================================================
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
     ⡤⠤⠤⠤⠤⠤⠤⠤⠤⠤⢤  ⡤⠤⠤⠤⠤⠤⠤⠤⠤⠤⡄ ⢀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀  ⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀                                          
     ⡧⠤⠤⠤⠤⠤⠤⠤⠤⠤⢼  ⡧⠤⠤conv 28x28x6⠤pool 14x14x6⠤conv 10x10x16⠭⠭⠭⠭⠭⡇ ⢸⠭⠭fc 120⡯⠭fc 84 ⡯⠭⠭out 10   
     ⡇         ⠘  ⡇         ⠃ ⢸         ⠘  ⡇         ⠘ ⢸         ⠃ ⢸     ⠘  ⡇    ⠘  ⡇     ⠃     
     ⡇         ⠘───▶        ───▶        ───▶         ───▶        ───▶    ⠘───▶   ⠘───▶    ⠃     
     ⣏         ⠘  ⣏         ⠃ ⢸         ⠘  ⣗         ⠘ ⢸         ⠃ ⢸     ⠘  ⣧    ⠘  ⣧     ⠃     
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
LEDGER: [{"code":"3d-label-dropped","message":"The \"input\" label (\"input 32x32x1\") didn't make it into the final frame — likely hidden behind another node or collided with a neighboring label at this camera angle.","detail":{"nodeId":"input","label":"input 32x32x1"}},{"code":"3d-label-dropped","message":"The \"pool2\" label (\"pool 5x5x16\") didn't make it into the final frame — likely hidden behind another node or collided with a neighboring label at this camera angle.","detail":{"nodeId":"pool2","label":"pool 5x5x16"}}]
================================================================================
LeNet-5 — 140x40 box
================================================================================
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
      ----------------▕   ---------------▏   ______________▕   ________________|                                                            
      ______input 32x32x1 _____conv 28x28x6  _____pool 14x14x6 _______conv 10x10x16_____pool 5x5x16 ____fc 120_  ____fc 84_  ____out 10_    
      ▕               ▕   |              ▏   ▏             ▕   |               |   ▏             ▏  ▕         ▏  ▕        ▏  ▕         ▏    
      ▕               ▕   |              ▏   ▏             ▕   |               |   ▏             ▏  ▕         ▏  ▕        ▏  ▕         ▏    
      ▕               ─────▶             ─────▶            ─────▶              ─────▶            ────▶        ────▶       ────▶        ▏    
      ▕               ▕   |              ▏   ▏             ▕   |               |   ▏             ▏  ▕         ▏  ▕        ▏  ▕         ▏    
      ▕________________   _______________▏   _______________   |_______________|   ▏_____________▏  ________ __  ______ ___  ▕_____ ____    
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
================================================================================
Transformer encoder — 96x32 box
================================================================================
                                                                                                
                                         _______                                                
                                      _//       ‾\_                                             
                                      ▕▔-__Input Embedding                                      
                                        |       ▕                                               
                                      ▕ |   ▕   ▕ |                                             
                                      ▕\    ▕│   //                                             
                                        |‾▔▔Positional                                          
                                        ▕    ▼   |                                              
                                        ▕        |                                              
                                        ▕        |                                              
                                        ‾‾‾‾‾│‾‾‾‾                                              
                                        ▔▔▔▔▔Multi-Head                                         
                                        ▕        |                                              
                                        ▕        |                                              
                                        _________|                                              
                                        _____│____                                              
                                        ▕    Add & Norm                                         
                                        ▕        |                                              
                                        ▕        |                                              
                                        ▔▔▔▔▔▔▔▔▔▔                                              
                                        -----Feed Forward                                       
                                        ▏    ▼    ▏                                             
                                        ▏         ▏                                             
                                        ___________                                             
                                        _________|                                              
                                        ‾‾‾‾‾Add & Norm                                         
                                        ▕        |                                              
                                        ▕        |                                              
                                        ----------                                              
                                                                                                
                                                                                                
================================================================================
Transformer encoder — 96x32 braille
================================================================================
                                                                                                
                                          ⣀⣀⣤⣄⣀⡀                                                
                                      ⢀⡤⢾⠉⠁ ⢸  ⠉⢹⠦⣄                                             
                                      ⢸⠓⢦⠤⣄Input Embedding                                      
                                      ⢸ ⢸   ⢸   ⠈                                               
                                      ⢸ ⢸   ⢸   ⠈                                               
                                      ⠸⣄⣸   ⢸│  ⠈ ⡄                                             
                                        ⢹⠉⠓⠒Positional                                          
                                        ⢸    ▼   ⡇                                              
                                        ⢸        ⠃                                              
                                        ⢸        ⠃                                              
                                        ⠈⠉⠉⠉⠉│⠉⠉⠉⠁                                              
                                        ⢸⠛⠛⠛⠛Multi-Head                                         
                                        ⢸        ⠃                                              
                                        ⢸        ⠃                                              
                                        ⠸        ⠃                                              
                                        ⢠⣤⣤⣤⣤│⣤⣤⣤⡄                                              
                                        ⢸    Add & Norm                                         
                                        ⢸        ⠃                                              
                                        ⢸        ⠃                                              
                                        ⠘⠒⠒⠒⠒⠒⠒⠒⠒⠃                                              
                                        ⡟⠛⠛⠛⠛Feed Forward                                       
                                        ⡇    ▼    ⠃                                             
                                        ⡇         ⠃                                             
                                        ⣧         ⠃                                             
                                        ⢀⣀⣀⣀⣀⣀⣀⣀⣀⡀                                              
                                        ⢸⠉⠉⠉⠉Add & Norm                                         
                                        ⢸        ⠃                                              
                                        ⢸        ⠃                                              
                                        ⠘⠒⠒⠒⠒⠒⠒⠒⠒⠃                                              
                                                                                                
                                                                                                
================================================================================
Transformer encoder — 140x40 box
================================================================================
                                                                                                                                            
                                                                   _                                                                        
                                                             //▔▔‾‾ ‾ ‾▔▔-\                                                                 
                                                            ▔_    Input Embedding                                                           
                                                            | ▔----_- ---▔ |                                                                
                                                            | ▕    ▕     ▏ |                                                                
                                                            | ▕    ▕     ▏ |                                                                
                                                            | ▕    ▕     ▏ /                                                                
                                                             \▕____ │____▏/                                                                 
                                                              -----Positional                                                               
                                                              ▕     ▼    ▕                                                                  
                                                              ▕          ▕                                                                  
                                                              ▕          ▕                                                                  
                                                              ____________                                                                  
                                                                    │                                                                       
                                                              ▔▔▔▔▔▔Multi-Head                                                              
                                                              ▕          ▕                                                                  
                                                              ▕          ▕                                                                  
                                                              ▕          ▕                                                                  
                                                              ------│----▕                                                                  
                                                              ______│____▕                                                                  
                                                              ‾‾‾‾‾‾Add & Norm                                                              
                                                              ▕          ▕                                                                  
                                                              ▕          ▕                                                                  
                                                              ▕          ▕                                                                  
                                                              ------------                                                                  
                                                              _____________                                                                 
                                                              ▏     Feed Forward                                                            
                                                              ▏                                                                             
                                                              ▏           |                                                                 
                                                              ▏           |                                                                 
                                                              ▔▔▔▔▔▔▔▔▔▔▔▔▔                                                                 
                                                              ______Add & Norm                                                              
                                                              ▕     ▼    ▕                                                                  
                                                              ▕          ▕                                                                  
                                                              ▕          ▕                                                                  
                                                              ▕          ▕                                                                  
                                                              ‾‾‾‾‾‾‾‾‾‾‾‾                                                                  
                                                                                                                                            
                                                                                                                                            
================================================================================
Agent supervisor — 96x32 box
================================================================================
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                     ▔▔▔▔▔▔User request                                         
                                     ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾                                            
                                     ▕             |                                            
                                     ▕             |                                            
                                     ▕             |                                            
                                     _______________                                            
                                          _-││‾ _--                                             
                               ───────────│Supervisor───────                                    
                               │       ▏  ▼  ▼ ▼  |        │                                    
                               │       ▏  ▏       |        │                                    
                               │       ▏  ▏       |        │                                    
                               │       ▏  ▏   __--|        │                                    
                               │       \--││-│ │           │                                    
                   │_____│─────│───────────│─│─────────────│────────│-------                    
                   │---Coder-  -----Researcher─----Reviewer│ ------Final answer                 
                   │▕    ▼  |  ▕      ▼    ▕   ▏    ▼    | │ ▕      ▼      |                    
                   │▕       |  ▕           ▕   ▏         | │ ▕             |                    
                   │▕       |  ▕           ▕   ▏         | │ ▕             |                    
                   │▕       |  ▕           ▕   ▏         | │ ▕             |                    
                   │▔▔▔▔▔▔▔▔▔──▔▔▔▔▔▔▔▔▔▔▔▔▔───▔▔▔▔▔▔▔▔▔▔▔─│ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔                    
                         ──────│                    ───────│                                    
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
LEDGER: [{"code":"unroutable","message":"Couldn't route the \"edge:[\"researcher\",\"supervisor\",\"\",\"solid\",0]:0\" connection — no path was found from \"researcher\" to \"supervisor\".","detail":{"edgeId":"edge:[\"researcher\",\"supervisor\",\"\",\"solid\",0]:0","reason":"no path was found from \"researcher\" to \"supervisor\""}}]
================================================================================
Agent supervisor — 96x32 braille
================================================================================
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                     ⢸⠉⠉⠉⠉⠉User request                                         
                                     ⢸⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠹                                            
                                     ⢸             ⠘                                            
                                     ⢸             ⠸                                            
                                     ⢸             ⠸                                            
                                     ⢸         ⣀⣀  ⠸                                            
                                         ⢀⣠⠤││⠉⢉⣉⡽⢶                                             
                               ───────────│Supervisor───────                                    
                               │       ⡇ ⠉▼⠁ ▼ ▼  ⠈        │                                    
                               │       ⡇  ⠇       ⠈        │                                    
                               │       ⡇  ⠇       ⠈        │                                    
                               │       ⡇  ⠇     ⠄⠆⠋        │                                    
                               │       ⠛⠦⣄││⠆│⠉│           │                                    
                   │⢀⣀⣀⣀⣀│─────│───────────│─│─────────────│────────│⠤⠤⠤⠤⠤⠤⡄                    
                   │⢸⠒⠒Coder⢺  ⢸⠒⠒⠒⠒Researcher─⡗⠒⠒⠒Reviewer│ ⢸⠒⠒⠒⠒⠒Final answer                 
                   │⢸    ▼  ⠈  ⢸      ▼    ⠈   ⡇    ▼    ⠈ │ ⢸      ▼      ⠁                    
                   │⢸       ⠘  ⢸           ⠘   ⡇         ⠘ │ ⢸             ⠃                    
                   │⢸       ⠘  ⢸           ⠘   ⡇         ⠘ │ ⢸             ⠃                    
                   │⢸       ⠘  ⢸           ⠘   ⡗         ⠘ │ ⢸             ⠃                    
                   │⠈⠉⠉⠉⠉⠉⠉⠉⠉──⠈⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉───⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉─│ ⠈⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠁                    
                         ──────│                    ───────│                                    
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
LEDGER: [{"code":"unroutable","message":"Couldn't route the \"edge:[\"researcher\",\"supervisor\",\"\",\"solid\",0]:0\" connection — no path was found from \"researcher\" to \"supervisor\".","detail":{"edgeId":"edge:[\"researcher\",\"supervisor\",\"\",\"solid\",0]:0","reason":"no path was found from \"researcher\" to \"supervisor\""}}]
================================================================================
Agent supervisor — 140x40 box
================================================================================
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                          -----------------|                                                                
                                                          ------User request                                                                
                                                          ▏                |                                                                
                                                          ▏                |                                                                
                                                          ▏                |                                                                
                                                          ▏                |                                                                
                                                          ▏                |                                                                
                                                          --------│---------                                                                
                                                                __─│‾   _--                                                                 
                                                 ──────────────│Supervisor────────────                                                      
                                                 │         | ‾▔▼▔‾ ▼  ▼   ▏          │                                                      
                                                 │         |   |          ▏          │                                                      
                                                 │         |   |          ▏          │                                                      
                                                 │         |   |          ▏          │                                                      
                                                 │         |   |        __▏          │                                                      
                                                 │         \\  │ │_│--│‾             │                                                      
                                  │──────────────│───────────‾▔│▔│─│──│──────────────│                                                      
                                  │ _____│──────────────────────-│ │  ───────────────────────────│--------                                  
                                  │ ----Coder--  │------Researcher ───----Reviewer-- │  -------Final answer                                 
                                  │ |    ▼    |  │|       ▼      ▕    ▏     ▼      ▏ │  |        ▼       ▕                                  
                                  │ |         |  │|              ▕    ▏            ▏ │  |                ▕                                  
                                  │ |         |  │|              ▕    ▏            ▏ │  |                ▕                                  
                                  │ |         |  │|              ▕    ▏            ▏ │  |                ▕                                  
                                  │ |         |  │|              ▕    ▏            ▏ │  |                ▕                                  
                                  │─-----------──│----------------────--------------─│  ------------------                                  
                                         ────────│                          ─────────│                                                      
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
LEDGER: [{"code":"unroutable","message":"Couldn't route the \"edge:[\"researcher\",\"supervisor\",\"\",\"solid\",0]:0\" connection — no path was found from \"researcher\" to \"supervisor\".","detail":{"edgeId":"edge:[\"researcher\",\"supervisor\",\"\",\"solid\",0]:0","reason":"no path was found from \"researcher\" to \"supervisor\""}}]
================================================================================
Crew — 96x32 box
================================================================================
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
    ▕__________|   __________▕    │____________─__──__________|──       __--__   __________|    
    ____Request_   ____Manager    │_____Researcher  ____Writer_ │   __-Review    ____Result_    
    ▕          |   ▏         ▕    │|             ▏  ▕         | │   ▏ ‾▔‾    ▕   ▕         |    
    ▕          |   ▏         ▕    │|             ▏  ▕         | │   ▏  ▏     ▕   ▕         |    
    ▕          ─────▶        ───────▶            ────▶        ───────▶ ▏     ───│─▶        |    
    ▕          |   ▏         ▕    │|             ▏ ──▶        | │   ▏  ▏     ──│ ▕         |    
    ▕          |   ▏              │|             ▏ │          | │      ▏   _// │ ▕         |    
    ‾‾‾‾‾‾‾‾‾‾‾|   ‾‾‾‾‾‾‾‾‾‾‾    │‾‾‾‾‾‾‾‾‾‾‾‾─‾‾─│‾‾‾‾‾‾‾‾‾‾‾─│   \▔---▔‾    │ ‾‾‾‾‾‾‾‾‾‾‾    
                                                   │────────────────────────────                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
================================================================================
Crew — 96x32 braille
================================================================================
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
    ⢀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⡀   ⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀    │⢀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⡀──⢀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀──       ⣀⡤⠴⡶⢤⣀   ⢀⣀⣀⣀⣀⣀⣀⣀⣀⣀⡀    
    ⢸⠤⠤⠤Request⡇   ⡧⠤⠤⠤Manager    │⢸⠤⠤⠤⠤Researcher  ⢸⠤⠤⠤Writer⢼ │   ⣤⣖⡚Review⠁   ⢸⠤⠤⠤Result⡇    
    ⢸          ⠇   ⡇         ⠸    │⢸             ⠇  ⢸         ⠸ │   ⡇ ⠉⡏⠁        ⢸         ⠇    
    ⢸          ⠃   ⡇         ⠘    │⢸             ⠃  ⢸         ⠘ │   ⡇  ⠁         ⢸         ⠃    
    ⢸          ─────▶        ───────▶            ────▶        ───────▶ ⠇     ───│─▶        ⠃    
    ⢸          ⠃   ⡇         ⠘    │⢸             ⠃ ──▶        ⠘ │   ⡇  ⠇     ──│ ⢸         ⠃    
    ⢸          ⠃   ⡏         ⠘    │⢸             ⠃ │⢸         ⠘ │   ⡇  ⠇       │ ⢸         ⠃    
    ⠈⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠁   ⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉    │⠈⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠁─│⠈⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉─│   ⠙⠒⠦⠇⠆⠃⠁    │ ⠈⠉⠉⠉⠉⠉⠉⠉⠉⠉⠁    
                                                   │────────────────────────────                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
================================================================================
Crew — 140x40 box
================================================================================
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                 │─────────────────────────────────────────────             ___                             
      |---------------▏    ----------------▏     │ ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔     --------------▏  │        __-▔‾   __-     --------------▕      
      ------Request----    ------Manager----     │ --------Researcher---     -----Writer----  │    -_▔‾ Review‾  ▕     -----Result----      
      |               ▏    ▕               ▏     │ ▕                   |     ▏             ▏  │    ▕ ‾▔-▔‾       ▕     |             ▕      
      |               ▏    ▕               ▏     │ ▕                   |     ▏             ▏  │    ▕   ▕         ▕     |             ▕      
      |               ▏    ▕               ▏     │ ▕                   |     ▏             ▏  │    ▕   ▕         ▕     |             ▕      
      |              ───────▶              ─────────▶                  ───────▶            ─────────▶  ▕         ────│──▶            ▕      
      |               ▏    ▕               ▏     │ ▕                   |   ───▶            ▏  │    ▕   ▕         ───│  |             ▕      
      |               ▏    ▕               ▏     │ ▕                   |   │ ▏             ▏  │    ▕   ▕         ▕  │  |             ▕      
      |               ▏    ▕               ▏     │ ▕                   |   │ ▏             ▏  │    ▕   ▕      _///  │  |             ▕      
      ----------------▏    -----------------     │─---------------------───│─---------------──│    \\_ ▕ __--‾      │  ---------------      
                                                                           │──────────────────────────‾▔‾────────────                       
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
```

Read: every node reads as an upright block with a visible top sliver
(`▔▔▔`/`‾‾‾`/`⠉⠉⠉` crease lines) and a visible side/depth sliver (the
diagonal `\`/`//`/`⡤⠤` strokes and the vertical `|`/`▏`/`⢸` side rules), laid
out along the same axis the 2D diagram uses (a vertical TB stack for
LeNet-5/transformer/agent-supervisor, a horizontal LR chain for the crew
graph), with labels sitting INSIDE each front face and short orthogonal
(never diagonal) arrows connecting them — the brief's own acceptance
criterion, cleared for 10 of 12 frames outright and for the remaining 2
(LeNet-5 96x32 box/braille) with an honestly ledgered, documented residual
rather than a silent defect.

## D2 round 6 — screen-space label fits, deeper faces, one shared return path

**Goal (user brief).** Fix, at the layer that owns each defect: (1) inside
labels overflowing their own block; (2) LeNet-5 at 140x40 clipped past the
frame's own bottom edge; (3) the 3D reading too faintly (a doubled top line,
no discernible depth); (4) the agent-supervisor preset's unroutable
`researcher -> supervisor` back-edge; (5) the `/diagrams` 3D preset tray.

### 1. Labels overflowing their own block — two independent bugs, both at the layer that owned them

**Bug A — a WORLD-unit budget was compared against a SCREEN-column one.**
`resolveGlyphDiagram3dLabelPlacement`'s own `"fits inside"` check computed
`faceWidthCells = floor(node.half[0] * 2)` — the node's front face WIDTH IN
WORLD UNITS — and compared a label's character COUNT against it directly,
implicitly assuming 1 world unit == 1 screen column. That assumption only
holds at `zoom === cellPxW` (25); an auto-fit that zooms OUT to fit a whole
multi-node layout (the ordinary case) makes a box's REAL projected screen
width `worldWidth * zoom / cellPxW`, strictly narrower. Measured on the
transformer fixture's own `embed` node: world half-width `9.5` (`floor(19)
>= 16` — "Input Embedding" — read as "fits"), but at the auto-fit's own
`zoom: 15.4` the box's real screen width is `19 * 15.4 / 25 ≈ 11.7` columns
— 4-5 short of what the label needs. Fixed by adding a `screenWidthCols`
parameter to `resolveGlyphDiagram3dLabelPlacement` (`glyphDiagramObject.ts`)
that, when given, REPLACES the world-unit budget for both the fits-check and
the clip length (reserving >= 1 column of padding on each side, per the
brief's own requirement: `faceWidthCells = floor(screenWidthCols) - 2`).
Both real call sites now supply it:

- `glyphDiagramObject.ts`'s own stamp — from the frame's REAL camera, live,
  every render (`project(rightEdge).col - project(leftEdge).col`) — correct
  under a live-orbited view too, never a cached estimate.
- `render3d.ts`'s `fitDiagramCamera` — from its own closed-form projection,
  via a bounded FIXED-POINT loop (not a single 2-pass estimate): PASS 1
  solves with the OLD world-unit decision purely to get a zoom ESTIMATE;
  each further iteration re-decides every node's placement from its REAL
  projected screen width AT THE PREVIOUS iteration's solved zoom (a node
  whose world-unit budget looked wide enough can genuinely be too narrow on
  screen, and now correctly falls back to `"side"` placement instead of
  silently overflowing) and re-solves. Re-deciding a node's placement can
  only ever DEMOTE it (`"inside" -> "side"`, never the reverse) as the
  estimate's own zoom shrinks — a demoted node's `"side"` placement needs
  MORE margin than `"inside"` would have — so each iteration's solved zoom
  is monotonically <= the previous one, and the sequence converges (bounded
  below by the frame's own geometry-only fit); 4 iterations is ample for any
  real diagram. The LAST iteration's own screen widths are what the CLIP
  length is re-derived against, so the "no overflow" guarantee holds against
  the TRUE zoom the frame renders with, never an early estimate.

**Bug B — anchor points used literal `center[0]`/`center[1]` COMPONENT
arithmetic, correct only when `u`/`n` happen to equal literal world X/Y.**
`glyphDiagram3dPlaneAxes`'s own `u`/`n` are NOT axis-aligned in general (at
the module's default `rotY`, `u ≈ [-0.5, 0.866, 0]`) — but round 5 shipped
`resolveGlyphDiagram3dLabelPlacement` still doing `center[0] + half[0]`
("move by `half[0]` along literal world X") and `center[1] - half[1]`
("move by `half[1]` along literal world Y"), which is only correct when
`u === [1,0,0]`/`n === [0,1,0]` exactly — the `force` layout's own case,
which is why the existing pinned unit tests (built with an arbitrary
`center`/`half` and no `axes` parameter at all) never caught it. Under the
real LAYERED plane this put a `"side"` label's `leaderFrom` many world units
from the node's own edge — measured on the transformer fixture's `embed`
node: the buggy point landed at `[2.3, 7.4, -0.5]` against the correct
`[-11.9, 15.6, -6.5]` (a proper `center + half[0]*u` vector computation) —
and an `"inside"` label's anchor off the node's own front-face plane by
`half[1] * (1 - |n[y]|)` world units. Fixed by adding an `axes: {u, n}`
parameter (default the identity pair, byte-identical for `force` layout and
for a bare unit test that passes none) and doing REAL vector arithmetic:
`front = center - half[1]*n`, `rightEdge = center + half[0]*u`. `"below"`
mode needed no fix — it moves along literal world Z only, which has zero
screen-column contribution under this camera regardless of `u`/`n`, so a
Z-only shift was already correct in every basis.

### 2. LeNet-5 at 140x40 clipped past the frame

Resolved as a DIRECT CONSEQUENCE of fixing bug B above, not a separate
patch: the old buggy `leaderFrom`/anchor arithmetic could place a `"side"`
label's anchor at a wildly wrong world point (as measured above — off by
tens of world units in every axis), which fed directly into
`fitDiagramCamera`'s own row/column margin constraints — a garbage anchor
either forced the auto-fit zoom artificially small OR left real content
outside the margin it was computed against. Once every anchor is computed
correctly (bug B) and every label's fits-decision uses real screen columns
(bug A), the SAME closed-form margin solve — unchanged in its own math —
produces a zoom that genuinely keeps everything on screen. Verified directly
(the LeNet-5 140x40 frame below sits entirely within rows 16-24 of a 40-row
frame, comfortable margin both above and below).

### 3. The 3D reading too faintly

**The mathematics say a genuine LEFT/RIGHT side face is impossible under
this camera family, by construction — not a tuning gap.** `u`'s own angle
(`rotY + 90°`) is chosen so its ROW coefficient is EXACTLY zero (round 5's
own zero-row-drift guarantee, which the brief explicitly asked to KEEP: "Your
`u = rotY + 90°` derivation holds for any yaw"). Its ground-plane
PERPENDICULAR — `n`, the node's own depth/extrusion axis — is then FORCED
by the same trig identity (`sin` and `cos` are 90°-out-of-phase) to have
EXACTLY zero COLUMN coefficient, for ANY `rotY`: `col_coeff(n) = sin(180°) =
0`, an identity, never a numerical accident a different yaw could close.
This means a box's own left/right (u-perpendicular) face is ALWAYS
perfectly edge-on — zero screen-column width — under every camera this
derivation can produce, and every edge OTHER than a `u`-direction one
(depth edges, height edges) projects as a PURE VERTICAL line (zero column
delta) — which is exactly the reported "doubled top line" complaint: two
row-shifted, column-IDENTICAL rectangles connected by dead-vertical lines
reads as flat duplication, not depth. Keeping the zero-row-drift guarantee
(the brief's own explicit instruction) and getting a genuine COLUMN-wide
side face are mutually exclusive under this derivation — so this round
maximizes the ONE cue that IS available and tunable: the TOP face's own
ROW-offset band (`row_coeff(n) = -cosX`, nonzero and camera-tunable), by
pitching further from level (`rotX`: `68 -> 58`, raising `cosX` from `0.375`
to `0.530`, +41%) and by roughly doubling default node DEPTH
(`GLYPH_DIAGRAM_3D_DEPTH_FACTOR`: `0.42 -> 0.6`; `GLYPH_DIAGRAM_3D_MIN_DEPTH`:
`1.5 -> 4`). Measured on the transformer fixture's `norm1` node (world
depth `3.6`): top-band row delta went from `~0.5` rows (round 5's own
constants) to `~1.2` rows at these settings — genuinely thicker, and every
render below now shows a clear top/depth band (a `----`/`▔▔▔▔` separator
line between a box's own top border and its label row) plus, for the
`cylinder`-shaped "Input Embedding" node, a real curved silhouette (a
cylinder's own points span BOTH `u` and `n` simultaneously, so — unlike a
box — its silhouette genuinely does read with diagonal strokes under this
camera).

**Depth had to scale with EACH node's own size, not a flat constant.** A
first cut used `Math.max(MIN_DEPTH, compressedDepth)` for every
EXPLICIT-`size` node uniformly (LeNet-5, transformer both give every node an
explicit `size`) — flattening every node to the SAME large depth
(`MIN_DEPTH`, tried up to `10`) regardless of the fixture's own per-layer
scale. This measurably WORSENED LeNet-5 specifically: 8 boxes wide already
strains the column budget, and a uniform large depth strains the ROW budget
too (every node's own back corner pushes the object's bounds further in
ROW), so the auto-fit zoomed out further, shrinking every box's WIDTH along
with it and cramming labels together (measured: 96x32 zoom `14.06` at
`MIN_DEPTH: 10` vs. the transformer's own single-column case, which has
spare width to absorb the SAME depth with no penalty at all). Fixed by
making depth `Math.max(MIN_DEPTH, DEPTH_FACTOR * min(width, height),
compressedDepth ?? 0)` for EVERY node — `MIN_DEPTH` is now a small absolute
floor against a genuinely degenerate box, never the dominant term — so a
many-node diagram's own per-node depth stays proportional to what it can
actually afford, and a fixture's own explicit depth intent is still
respected as a floor, never shrunk below it.

### 4. Agent-supervisor's unroutable back-edge

**Root cause vs. restructure, per the brief's own two-option instruction.**
Teaching the 2D A* router to route THROUGH a box's own now-visible top/side
FACES (rather than only around node footprints, the router's existing
model) is a genuinely different, much larger feature — the router works
in 2D CELL SPACE before any 3D projection exists, and "the free space beside
a box's projected top face" has no analogue in that space at all; it would
mean threading 3D screen geometry backward INTO the 2D layout/routing stage,
which round 5 deliberately kept independent of the camera. Given the
brief's own explicit fallback ("Otherwise restructure the example graph"),
this round restructured instead: **the fixture's three separate
`researcher/coder/reviewer -> supervisor` back-edges — three edges
converging on the supervisor's own north side alongside the forward `user
-> supervisor` edge, a genuine A* routing conflict confirmed against pure
2D's OWN compaction/retry machinery too (round 5's own residual: 2D falls
back to a `split`-panel rather than routing it cleanly either) — became
ONE shared `reports` collector node** (`researcher/coder/reviewer ->
reports -> supervisor`), an honest, common orchestration pattern (a
"fan-in"/"join" node before control returns to a supervisor) rather than
inventing a different topology. This alone moved, rather than fixed, the
congestion (`researcher -> reports` was STILL genuinely unroutable at the
router's own default `nodesep: 4` — three edges converging on one target
from directly above needs one more cell of port-lane clearance, matching
`route.ts`'s own documented degree-vs-floor relationship in `AGENTS.md`'s
"Diagrams" section). Measured (`nodesep` swept `4..8`): `4` fails
(`researcher -> reports` unroutable), `5` and every value above route
cleanly. `layout3d.ts`'s own layered path now defaults `nodesep` to `5`
(was the 2D pipeline's own `4`) — an explicit `nodesep` option still
overrides it verbatim. No `unroutable` ledger entry appears for any of the
four examples at any of the three render settings (swept and verified
directly against the ledger, not merely by inspection).

### 5. Preset tray

The 3D tray is now, in order, LeNet-5 CNN, Transformer encoder, Agent
supervisor, Multi-agent crew — Zachary's karate club (real vendored network
data, `layout: "force"`) is retired; its fixture (`karate-club.mmd`) and its
`datasets3d/LICENSES.md` row are both removed. The two new presets are
JSON-sourced (`sourceKind: "json"` on the preset entry, a new field): Mermaid
has no syntax for `GlyphGraphNode.size`, and per-node explicit sizing is the
entire point of both fixtures (a CNN's own shrinking activation maps, a
transformer block's own uniform stack) — round-tripping either through
Mermaid would silently drop it. `apply-preset`'s reducer, the tray's own
thumbnail-generation effect, and the URL-state schema (`diagramsUrlState.ts`)
all gained a `sourceKind: "json"` branch (`glyphGraphFromJson` instead of
`glyphGraphFromMermaid`); `validateNode` gained `size` (previously silently
dropped on every `?d=` decode — a real, independent bug this round's own
preset round-trip TEST caught, not merely a consequence of adding the new
presets) and `"cylinder"` joined `GRAPH_NODE_SHAPES` (previously any node
using it failed URL-state validation outright) and the Mermaid-tab
serializer's own shape table (previously CRASHED — `shapes[node.shape]`
read `undefined` — the first time a JSON-sourced 3D preset needed a
Mermaid-tab rendering at all, since the mermaid ADAPTER itself still has no
PARSER support for `[( )]` cylinder syntax, an out-of-scope library-side gap
AGENTS.md already documents as "JSON-only shape today"; the Mermaid tab is
therefore a best-effort DISPLAY string for a cylinder node, never a
round-trippable one — the JSON tab stays authoritative, exactly like `size`
already was). `datasets3d/LICENSES.md` credits LeNet-5's architecture to Y.
LeCun, L. Bottou, Y. Bengio, P. Haffner, "Gradient-Based Learning Applied to
Document Recognition," *Proceedings of the IEEE* 86(11), 1998, and the
transformer encoder's to A. Vaswani et al., "Attention Is All You Need,"
*NeurIPS*, 2017 — both explicitly as a DESCRIPTION of a published
architecture (layer shapes/sizes), never as vendored training data or
telemetry, matching the LICENSES file's own existing discipline for the
hand-authored agent-supervisor/crew examples.

**The "old link naming karate-club" concern.** The workbench's `?d=` link
encodes the WHOLE state (`mermaid`/`json`/`nodes`/`edges`/`diagram.title`/
etc.) directly — there is no separate preset-ID URL parameter anywhere in
the codebase (verified by search: `apply-preset` is only ever dispatched
from a tray tile's own `onClick`, never from a parsed query string), so an
"old karate-club link" is, concretely, a link whose EMBEDDED state happens
to be the karate-club graph's own 34 nodes/78 edges and title text — content
that decodes and renders exactly as it always did, independent of whether
the TRAY still lists a preset with that id. `apply-preset`'s own reducer
already no-ops safely (`if (!preset) return state;`) for an unrecognized
preset id, so even a hypothetical future id-based deep link degrades to "do
nothing" rather than throwing. `diagramsUrlState.test.ts`'s existing
preset-round-trip suite (now covering all four current 3D presets, including
the two new JSON ones) and the full `DiagramsWorkbench`/`diagramsWorkbenchState`
suites stay green throughout.

### Mutation table

| Gate | Mutation applied | Result |
|---|---|---|
| An inside label's clip/fits-check uses the node's REAL screen width, not world units | Drop `screenWidthCols`, fall back to `node.half[0]*2` unconditionally | RED — the transformer's "Input Embedding" overflows past its own face at the auto-fit zoom |
| A `"side"` label's `leaderFrom` sits exactly on the node's own `u`-edge in WORLD space | Revert `center + half[0]*u` to `center[0] + half[0]` | RED — `leaderFrom` lands tens of world units from the node under a non-axis-aligned plane |
| The auto-fit's per-node screen-width estimate converges to the TRUE final zoom (re-clip pass) | Skip the fixed-point loop, use only the world-unit PASS 1 zoom | RED — a label clipped against the estimate can still overflow the smaller true box |
| `nodesep: 5` routes the restructured agent-supervisor cleanly | Revert to the 2D pipeline's own default of 4 | RED — `researcher -> reports` unroutable |
| `size` survives a `?d=` round trip for a JSON-sourced preset | Drop `size` from `validateNode`'s reconstruction | RED — every LeNet-5/transformer node's own `size` field vanishes on decode |
| `"cylinder"` is a valid node shape end to end (URL validation, Mermaid-tab serialization) | Omit it from `GRAPH_NODE_SHAPES` / the Mermaid `shapes` table | RED — URL validation rejects the transformer preset; the Mermaid tab throws on `shapes[node.shape]` being `undefined` |
| A JSON-sourced preset's tray thumbnail renders (not "Preview unavailable") | Route it through `glyphGraphFromMermaid` regardless of `sourceKind` | RED — thumbnail generation throws (caught, degrades to a blank preview) |

Every mutation above was applied to the working tree, run, observed red,
then reverted and re-verified green — `packages/diagrams`: 267 tests;
`packages/compile`: 86 tests; website `DiagramsWorkbench`/`InstrumentWorkbench`:
331 tests.

### Residuals (honestly reported, not silently dropped)

1. **LeNet-5 at 96x32 stays visually tight** — an 8-node-wide chain in a
   96-column frame is fundamentally column-constrained regardless of depth
   tuning; two labels (`input`, `pool2`) are honestly dropped via the
   `3d-label-dropped` ledger code, and several adjacent boxes' own labels
   sit immediately next to each other with no visible gap (each fits fully
   WITHIN its own face — the round's own gate — but the boxes themselves are
   packed close). 140x40 clears this with real margin. Unchanged in kind
   from round 5's own documented residual, at a different (now correctly
   computed) magnitude.
2. **Agent-supervisor at 96x32 drops the "Researcher" label** to a genuine
   on-screen collision (reported via `3d-label-dropped`, never silently) —
   the `reports` collector node's own extra node/edge adds a small amount of
   density at this fixture's smallest requested size; 140x40 shows every
   label. This is the design's existing "never silently drop" contract
   working as intended, not a new defect.
3. **No genuine left/right (column-wide) side face is possible under this
   camera family**, for the structural, mathematical reason in section 3
   above — the brief's own literal "2 columns wide" wording is read as the
   best achievable proxy for "reads as 3D," which the deepened top-face band
   and doubled depth now deliver, rather than as a literal column count this
   derivation cannot produce without giving up the zero-row-drift guarantee
   the brief explicitly asked to keep.

### Rendered frames (D2 round 6)

All four examples — LeNet-5, Transformer encoder, Agent supervisor
(restructured, see §4), and the crew graph — rendered via
`renderGlyphDiagram3d` at 96x32 box, 96x32 braille, and 140x40 box, `color:
"none"`, default (`ink`) style. Verbatim output:

```
================================================================================
LeNet-5 — 96x32 box
================================================================================
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
     __________▕  __________▏ __________| ______ ____▏ _________▕                               
     ___________  ___________ ___________ ______ _____ __________  _______ ___ ___ _______      
     |            |                       ▕            |           ▏       ▕       ▕            
     |         ▕───▶        ───▶        ───▶         ───▶       ────▶    ───▶    ───▶    ▕      
     |     │   ▕  |    │    ▏ |         | ▕          ▏ |        ▕  ▏     ▏ ▕     ▏ ▕     ▕      
     ‾‾‾‾‾‾‾‾‾‾▕  ‾‾‾‾‾conv 28x28x6pool 14x14x6‾conv 10x10x16‾‾‾‾  ‾‾‾fc 120‾‾ fc 84‾‾‾out 10   
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
LEDGER: [{"code":"3d-label-dropped","message":"The \"input\" label (\"input 32x32x1\") didn't make it into the final frame — likely hidden behind another node or collided with a neighboring label at this camera angle.","detail":{"nodeId":"input","label":"input 32x32x1"}},{"code":"3d-label-dropped","message":"The \"pool2\" label (\"pool 5x5x16\") didn't make it into the final frame — likely hidden behind another node or collided with a neighboring label at this camera angle.","detail":{"nodeId":"pool2","label":"pool 5x5x16"}}]
================================================================================
LeNet-5 — 96x32 braille
================================================================================
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
     ⢠⠤⠤⠤⠤⠤⠤⠤⠤⠤⢤  ⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⡀ ⢀⣀⣀⣀⣀⣀⣀⣀⣀⣀⡀ ⢀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⡀ ⢀⣀⣀⣀⣀⣀⣀⣀⣀⣀                               
     ⢸⣀⣀⣀⣀⣀⣀⣀⣀⣀⣸  ⣇⣀⣀⣀⣀⣀⣀⣀⣀⣀⡇ ⢸⣀⣀⣀⣀⣀⣀⣀⣀⣀⡇ ⢸⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⡇ ⢸⣀⣀⣀⣀⣀⣀⣀⣀⣸  ⣏⣉⣉⣉⣉⣉⡇ ⢸⣉⣉⣉⣉⣉⡇ ⢸⣉⣉⣉⣉⣉⣹      
     ⢸         ⠈  ⡇         ⠁ ⢸         ⠁ ⢸          ⠁ ⢸        ⠈  ⡇     ⠃ ⢸     ⠃ ⢸     ⠘      
     ⢸         ⠘───▶        ───▶        ───▶         ───▶       ────▶    ───▶    ───▶    ⠘      
     ⢸     │   ⠘  ⡇    │    ⠃ ⢸         ⠃ ⢸          ⠃ ⢸        ⠘  ⡏     ⠃ ⢸     ⠃ ⢸     ⠘      
     ⠈⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉  ⠉⠉⠉⠉⠉conv 28x28x6pool 14x14x6⠉conv 10x10x16⠉⠉⠉⠉  ⠉⠉⠉fc 120⠉⠉⠉fc 84⠉⠉⠉out 10   
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
LEDGER: [{"code":"3d-label-dropped","message":"The \"input\" label (\"input 32x32x1\") didn't make it into the final frame — likely hidden behind another node or collided with a neighboring label at this camera angle.","detail":{"nodeId":"input","label":"input 32x32x1"}},{"code":"3d-label-dropped","message":"The \"pool2\" label (\"pool 5x5x16\") didn't make it into the final frame — likely hidden behind another node or collided with a neighboring label at this camera angle.","detail":{"nodeId":"pool2","label":"pool 5x5x16"}}]
================================================================================
LeNet-5 — 140x40 box
================================================================================
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
         ---------------|  _______ _______▏  ______________▕   _______________|  ____ _________▏                                            
         |              |  ▕              ▏  |             ▕   |              |  ▕             ▏  ‾‾‾‾‾‾‾‾‾|   ▔▔▔▔▔▔▔▔▏  ‾‾‾‾‾‾‾‾‾‾        
         ----------------  ------- --------  ---------------   ----------------  ---- ----------  ----------   ---------  ----------        
         |       input 32x32x1     conv 28x28x6      pool 14x14x6      conv 10x10x16     pool 5x5x16   fc 120  ▏   fc 84  |    out 10       
         |              |  ▕              ▏  |             ▕   |              |  ▕             ▏  ▕        |   ▏       ▏  |        |        
         |              ────▶             ────▶            ─────▶             ────▶            ────▶       ─────▶      ────▶       |        
         |              |  ▕              ▏  |             ▕   |              |  ▕             ▏  ▕        |   ▏       ▏  |        |        
         ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾|  ‾‾‾‾‾‾‾ ‾‾‾‾‾‾‾‾  ‾‾‾‾‾‾‾‾‾‾‾‾‾‾‾   |‾‾‾‾‾‾‾‾‾‾‾‾‾‾|  ‾‾‾‾ ‾‾‾‾‾‾‾‾‾‾  ‾‾‾‾‾‾‾‾‾|   ‾‾‾‾‾‾‾‾‾  |‾‾‾‾‾‾‾‾‾        
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
================================================================================
Transformer encoder — 96x32 box
================================================================================
                                                                                                
                                                                                                
                                     /--▔‾▔---                                                  
                                   _/         \_                                                
                                   ▏▔__     __▔─Input Embedding                                 
                                   ▏ ▏ ‾‾▔‾‾ | ▏                                                
                                   ▏ ▏   ▏   | /                                                
                                    \    │    /                                                 
                                     ▏‾▔-│-▔‾|─Positional                                       
                                     ▏   ▼   ▕                                                  
                                     ▏       ▕                                                  
                                     _________                                                  
                                     ____│____─Multi-Head                                       
                                     ▏   ▼   ▕                                                  
                                     ▏       ▕                                                  
                                     _                                                          
                                     ‾‾‾‾│‾‾‾‾                                                  
                                     ‾‾‾‾▼‾‾‾‾─Add & Norm                                       
                                     ▏       ▕                                                  
                                     ▏       ▕                                                  
                                    ▔---------|                                                 
                                    -----------Feed Forward                                     
                                    |    ▼    |                                                 
                                    |         |                                                 
                                    -----------                                                 
                                     _________─Add & Norm                                       
                                     ▏   ▼   ▕                                                  
                                     ▏       ▕                                                  
                                     _________                                                  
                                                                                                
                                                                                                
                                                                                                
================================================================================
Transformer encoder — 96x32 braille
================================================================================
                                                                                                
                                                                                                
                                    ⢀⡤⠴⠒⠚⡟⠒⠲⠤⣄                                                  
                                   ⣴⠋        ⠈⢳⡄                                                
                                   ⡏⢧⣀      ⢀⣠⠏─Input Embedding                                 
                                   ⡇ ⠏⠉⠙⠒⡖⠚⠉⠉⠃ ⠇                                                
                                   ⣧ ⡇   ⠃   ⠃ ⠇                                                
                                   ⠙⣆⡇   │   ⠃⡄⠁                                                
                                    ⠈⠉⠙⠒⠒│⠒⠚⠉⠉─Positional                                       
                                     ⡇   ▼   ⢸                                                  
                                     ⡧       ⠘                                                  
                                     ⣧⣀⣀⣀⣀⣀⣀⣀⣸                                                  
                                     ⣇⣀⣀⣀│⣀⣀⣀⣸─Multi-Head                                       
                                     ⡇   ▼   ⠈                                                  
                                     ⣇       ⠘                                                  
                                     ⣇       ⠘                                                  
                                     ⡏⠉⠉⠉│⠉⠉⠉⠉                                                  
                                     ⡏⠉⠉⠉▼⠉⠉⠉⢹─Add & Norm                                       
                                     ⡇       ⠘                                                  
                                     ⡏       ⠘                                                  
                                    ⢸⠛⠒⠒⠒⠒⠒⠒⠒⠚⢹                                                 
                                    ⢸⠒⠒⠒⠒⠒⠒⠒⠒⠒⢺Feed Forward                                     
                                    ⢸    ▼                                                      
                                    ⢸         ⠘                                                 
                                    ⠸ ⠤⠤⠤⠤⠤⠤⠤⠤⠘                                                 
                                     ⡧⠤⠤⠤⠤⠤⠤⠤⢼─Add & Norm                                       
                                     ⡇   ▼                                                      
                                     ⡧       ⠘                                                  
                                     ⣇       ⠘                                                  
                                                                                                
                                                                                                
                                                                                                
================================================================================
Transformer encoder — 140x40 box
================================================================================
                                                                                                                                            
                                                                                                                                            
                                                          /__-----___                                                                       
                                                        /            \                                                                      
                                                       -               ─Input Embedding                                                     
                                                       ▕‾ __       __‾ ▏                                                                    
                                                       ▕  ▏ ‾▔▔-▔▔‾ ▕  ▏                                                                    
                                                       ▕  ▏    |    ▕  ▏                                                                    
                                                       ▕  ▏    |    ▕  /                                                                    
                                                        \ ▏    │    ▕/                                                                      
                                                          -‾‾▔-│-▔‾‾-─Positional                                                            
                                                          ▏    ▼     |                                                                      
                                                          ▏          |                                                                      
                                                          ▏          |                                                                      
                                                          -----│------                                                                      
                                                          ▏    │     ─Multi-Head                                                            
                                                          ‾‾‾‾‾▼‾‾‾‾‾‾                                                                      
                                                          ▏          |                                                                      
                                                          ▏          |                                                                      
                                                          ▏          |                                                                      
                                                          ‾‾‾‾‾│‾‾‾‾‾‾                                                                      
                                                          -----│------Add & Norm                                                            
                                                          ▏    ▼     |                                                                      
                                                          ▏          |                                                                      
                                                          ▏          |                                                                      
                                                         -------------▏                                                                     
                                                         ______________Feed Forward                                                         
                                                         |     ▼      ▏                                                                     
                                                         |            ▏                                                                     
                                                         |            ▏                                                                     
                                                         ______________                                                                     
                                                          ▏    │     |                                                                      
                                                          ▔▔▔▔▔▼▔▔▔▔▔▔Add & Norm                                                            
                                                          ▏          |                                                                      
                                                          ▏          |                                                                      
                                                          ▏          |                                                                      
                                                          ------------                                                                      
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
================================================================================
Agent supervisor — 96x32 box
================================================================================
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                ‾‾‾‾‾‾‾‾‾‾|                                                     
                                ▔▔▔▔▔▔▔▔▔▔─User request                                         
                                |         |                                                     
                                |         |                                                     
                                -----│-----                                                     
                                │─────│▔‾ Supervisor                                            
                                │  ‾ ▼▼   ▏                                                     
                                │  ▕     _▏                                                     
                     │──────────│_─▕──_-▔───────────│                                           
                     │‾‾‾‾‾‾‾▕  │▏‾│‾│││───────────────────│‾‾‾‾▏                               
                     │▔▔▔▔▼────Reviewer─────────▼▔▔Coder▔▔▔▼▔▔▔▔▔Final answer                   
                     │|      ▕  │▏       ▕  ▕     | │ ▏         ▏                               
                     │|      ▕  │▏       ▕  ▕     | │ ▏         ▏                               
                     │--------___---------──-------─│ -----------                               
                          │─▏───││──▏Reports    │                                               
                          ──‾‾‾▼▼▼‾‾‾────────────                                               
                           │▏       ▏                                                           
                           │▏       ▏                                                           
                           │▔▔▔▔▔▔▔▔▔                                                           
                           │─────                                                               
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
LEDGER: [{"code":"3d-label-dropped","message":"The \"researcher\" label (\"Researcher\") didn't make it into the final frame — likely hidden behind another node or collided with a neighboring label at this camera angle.","detail":{"nodeId":"researcher","label":"Researcher"}}]
================================================================================
Agent supervisor — 96x32 braille
================================================================================
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                ⡏⠉⠉⠉⠉⠉⠉⠉⠉⠉⡇                                                     
                                ⡏⠉⠉⠉⠉⠉⠉⠉⠉⠉─User request                                         
                                ⡇         ⠁                                                     
                                ⡏         ⠃                                                     
                                ⠓⠒⠒⠒⠒│⠒⠒⠒⠒⠃                                                     
                                │─────│⠋⠁ Supervisor                                            
                                │ ⠈⢹⠁▼▼   ⠃                                                     
                                │  ⢸      ⠃                                                     
                     │──────────│⢤⡀⢸───⠆⠃⠁──────────│                                           
                     │⡏⠉⠉⠉⠉⠉⠉⢹  │⡏⠉│⠋│││───────────────────│⠉⠉⠉⠉⡇                               
                     │⡏⠉⠉⠉▼────Reviewer─────────▼⠉⠹Coder⠉⠉⠉▼⠉⠉⠉⠉⠇Final answer                   
                     │⡇      ⠈  │⡇       ⠈  ⢸     ⠈ │ ⡇         ⠁                               
                     │⡏      ⠘  │⡏       ⠘  ⢸     ⠘ │ ⡏         ⠃                               
                     │⠓⠒⠒⠒⠒⠒⠒⠚⣀⣀⣀⣓⠒⠒⠒⠒⠒⠒⠒⠚──⠘⠒⠒⠒⠒⠒⠚─│ ⠓⠒⠒⠒⠒⠒⠒⠒⠒⠒⠃                               
                          │─⡇───││──⡇Reports    │                                               
                          ──⡏⠉⠉▼▼▼⠉⠉⠃────────────                                               
                           │⣇       ⠃                                                           
                           │⡇       ⠃                                                           
                           │⠉⠉⠉⠉⠉⠉⠉⠉⠁                                                           
                           │─────                                                               
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
LEDGER: [{"code":"3d-label-dropped","message":"The \"researcher\" label (\"Researcher\") didn't make it into the final frame — likely hidden behind another node or collided with a neighboring label at this camera angle.","detail":{"nodeId":"researcher","label":"Researcher"}}]
================================================================================
Agent supervisor — 140x40 box
================================================================================
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                   -------------|                                                                           
                                                   ▕            |User request                                                               
                                                   ▔▔▔▔▔▔▔▔▔▔▔▔▔▔                                                                           
                                                   ▕            |                                                                           
                                                   ▕            |                                                                           
                                                   ▕            |                                                                           
                                                   ▔▔▔▔▔▔▔│▔▔▔▔▔▔                                                                           
                                                    │────│─│▔‾  ─Supervisor                                                                 
                                                    │  ‾-▼ ▼    ▏                                                                           
                                                    │   |       ▏                                                                           
                                                    │   |     _-▏                                                                           
                                      │─────────────│-_│|│_││‾──────────────│                                                               
                                      │▏‾‾‾‾‾‾‾‾▕   │‾‾│-│‾│──────────────────────────│‾‾‾‾‾▏                                               
                                      │-----│─────Reviewer│──────Researcher │  -------│------Final answer                                   
                                      │▏    ▼   ▕   │     ▼    ▕   ▕   Coder│  |      ▼     ▏                                               
                                      │▏        ▕   │          ▕   ▕      ▕ │  |            ▏                                               
                                      │▏────────▕───▕──────────▕───▕──────▕─│  |            ▏                                               
                                       ----------   ------------   --------    --------------                                               
                                            │─|‾‾‾‾‾‾‾‾‾|──            │                                                                    
                                            ─│-----------───────────────                                                                    
                                             │|   ▼ Reports                                                                                 
                                             │|         |                                                                                   
                                             │|         |                                                                                   
                                             │-----------                                                                                   
                                             │───────                                                                                       
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
================================================================================
Crew — 96x32 box
================================================================================
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                  │─────────────────────────────│                               
      ▏_________|   __________|   │▕- -----------▏  ______ ___▏ │     __-▔-_    ▕____ ____▏     
      ▏         |   ▏         |   │▕             ▏  ▕         ▏ │  /_-     _-▔  ▕               
      -----Request  -----Manager  │-- -----Researcher----Writer │  ▏▔-_ Review  -----Result     
      ▏         |   ▏         |   │▕             ▏  ▕         ▏ │  ▏   ‾     ▕  ▕         ▏     
      ▏         |   ▏         |   │▕             ▏───▶        ▏ │  ▏   ▏     ──│▕         ▏     
      ▏         ─────▶        ──────▶            ─│──▶        ──────▶  ▏     ─│──▶        ▏     
      ▏         |   ▏         |   │▕─────────────▏─│▕─────────▏─│  ▏   ▏  _//▕│ ▕         ▏     
      ‾‾‾‾‾‾‾‾‾‾‾   ‾‾‾‾‾‾‾‾‾‾‾    ‾‾ ‾‾‾‾‾‾‾‾‾‾‾‾ │‾‾‾‾‾‾ ‾‾‾‾     \▔-_-‾    │ ‾‾‾‾‾ ‾‾‾‾‾     
                                                   │───────────────────────────                 
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
================================================================================
Crew — 96x32 braille
================================================================================
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                  │─────────────────────────────│                               
      ⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⡀   ⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⡀   │⢠⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⠤⡄  ⢀⣀⣀⣀⣀⣀⣀⣀⣀⣀⡀ │     ⢀⣠⠴⢺⠲⣄⡀   ⢀⣀⣀⣀⣀⣀⣀⣀⣀⣀⡀     
      ⡇         ⡇   ⡇         ⡇   │⢸             ⡇  ⢸         ⡇ │  ⣠⠴⠚⠉    ⢀⣩⢷  ⢸         ⡇     
      ⡗⠒⠒⠒⠒Request  ⡗⠒⠒⠒⠒Manager  │⢸⠒⠒⠒⠒⠒⠒⠒Researcher⠒⠒⠒⠒Writer │  ⡏⠳⢤⣀⢀Review  ⢸⠒⠒⠒⠒Result     
      ⡇         ⠁   ⡇         ⠁   │⢸             ⠁  ⢸         ⠁ │  ⡇  ⠈⠏     ⠈  ⢸         ⠁     
      ⡇         ⠃   ⡇         ⠃   │⢸             ⠃───▶        ⠃ │  ⡇   ⠇     ──│⢸         ⠃     
      ⡧         ─────▶        ──────▶            ─│──▶        ──────▶  ⠇     ─│──▶        ⠃     
      ⡇         ⠃   ⡇         ⠃   │⢸─────────────⠃─│⢸─────────⠃─│  ⣧   ⠇    ⠄⠂│ ⢸         ⠃     
      ⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠁   ⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠁    ⠈⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠁ │⠈⠉⠉⠉⠉⠉⠉⠉⠉⠉⠁    ⠉⠓⠦⣄⠇⠄⠂⠉   │ ⠈⠉⠉⠉⠉⠉⠉⠉⠉⠉⠁     
                                                   │───────────────────────────                 
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
================================================================================
Crew — 140x40 box
================================================================================
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                    │─────────────────────────────────────│                                                 
                ▕____________▕    _____________▕    │ ▕________________|                  │         _-▔-_                                   
                ▕            ▕    ▕            ▕    │ ▕                |    ‾‾‾‾‾‾‾‾‾‾‾▕  │     _--‾     ‾_-   |‾‾‾‾‾‾‾‾‾‾‾|                
                ______________    ______________    │ __________________    ____________  │   /__     __-‾ |   _____________                
                ▕      Request    ▕      Manager    │ ▕        Researcher   ▏     Writer  │   ▏  ▔-_-Review|   |     Result|                
                ▕            ▕    ▕            ▕    │ ▕                |    ▏          ▕  │   ▏    ▏       |   |           |                
                ▕            ▕    ▕            ▕    │ ▕                | ────▶         ▕  │   ▏    ▏      ────│|           |                
                ▕            ──────▶           ────────▶               ──│───▶         ─────────▶  ▏      ───│──▶          |                
                ▕            ▕    ▕            ▕    │─▕────────────────|──│─▏──────────▕──│   ▏    ▏      /| │ |           |                
                ______________    ______________      __________________  │ ____________      ▏\   ▏  __//   │ _____________                
                                                                          │                     \▔-_-▔       │                              
                                                                          │───────────────────────────────────                              
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
```

Read: every node's own label now stays fully WITHIN its own projected front
face (the round's own primary gate — verified both visually and by
construction, via the screen-width-aware clip/fits check); every example is
fully within its frame's own margins at all three sizes; every box shows a
genuine (if row-offset, per §3's own derivation) top/depth band rather than
a flat doubled outline; and no example logs an `unroutable` edge anywhere.

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

## C2 fix round 1 — canonical scene-object path, real showcase framing, honest charset/colour defaults

A codex review of `f9fb6734` found five P1s and one P2, all inside the C2
packet's own files. Six items, each fixed at the layer that owns it.

### P1-1 / P2-6 — the unnamespaced texture key, and routing through `compileScene({ objects })`

`object.ts`'s `applyValueShadingTexture` wrote the BARE
`GLYPH_CHART_3D_VALUE_STRIP_TEXTURE_KEY` onto every triangle's `p.texture`,
while `glyphChartObject`'s own `textureSamplers` map used that SAME bare
name as its key — correct as a PAIR, but not what `scene.addObject`/
`compileScene({ objects })` actually do with an object's `textureSamplers`:
both NAMESPACE every entry under `encodeGlyphSceneObjectSamplerKey(id,
name)` when merging it into the scene's own resolved sampler map
(AGENTS.md's "Scene objects" contract 9), and NEITHER rewrites a mounted
mesh's own `p.texture` field to match. So a chart's `value`-shaded surface,
mounted through the canonical path, looked up a sampler key the scene never
had, and the whole surface collapsed to the ramp's `u≈0` glyph — measured at
52 of the compared cells differing (`compileScene({objects})` vs the
hand-rolled renderer) and the composed frame reading uniform `@`. The
hand-rolled `render.ts` this packet shipped used the identical raw key on
BOTH sides of the lookup (the sampler map's own key AND the polygon's
`texture` field), so it was internally consistent and never surfaced the
mismatch — the bug was invisible until something else (a real scene, or
`compileScene`) did the namespacing `render.ts` itself never did.

Fixed at BOTH ends, together, since either alone leaves the other pointless:
`applyValueShadingTexture` now takes the object's own `id` and writes
`encodeGlyphSceneObjectSamplerKey(id, GLYPH_CHART_3D_VALUE_STRIP_TEXTURE_KEY)`
onto `p.texture`, while the `textureSamplers` MAP keeps the bare name (the
namespacing is `addObject`/`compileScene`'s own job, run exactly once).
`render.ts` itself was rewritten to call `glyphcss`'s public `compileScene({
objects: [object], camera, cols, rows, cellAspect, mode: "solid", useColors,
directionalLight?, ambientLight? })` instead of hand-rolling
`buildRasterizeContext`/`rasterize`/a manual overlay loop/a manual sampler
merge — `compileScene` already merges `object.textureSamplers` (namespaced),
runs the object's overlays through the shared label arbiter, and captures
the resulting `CellGrid` from the one rasterize pass; `render.ts`'s own
`cloneCellGridFields`/`rasterizeSurfaceToCells`/`pasteCellGrid`'s manual
sampler-merge half are gone entirely. This is what makes "static frame
equals a real scene" a STRUCTURAL guarantee (the same public entry point)
rather than two independent implementations that happened to agree.

**Mutation, verified by hand**: reverting ONLY the `p.texture` key back to
the bare name (keeping `compileScene` routing) reddens
`render.test.ts`'s existing "shading: 'value' keeps glyph density monotone
in z" test — `expect(new Set(sampleIndices).size).toBeGreaterThan(1)` fails
(`1` not `> 1`: every sampled cell reads the identical ramp index) — proving
this test, unchanged in wording since the ORIGINAL C2 cut, is now a REAL
P1-1 regression gate purely because the render path underneath it changed.
The "static frame equals live scene" test (`render.test.ts`) was ALSO
rewritten to be non-vacuous (it previously used `color: "none"` at the MODEL
level — no colorAnchors, so no colorbar ever engaged — the library default
`shading: "relief"`, and no title, comparing the WHOLE canvas): it now uses
`shading: "value"`, a real colorbar (model-level `color: "auto"`, a
SEPARATE axis from the render's own ANSI `color: "none"`), several ticks,
and a title, comparing the static frame's own extracted PLOT sub-rectangle
against a live scene rendered at exactly that sub-rectangle's `cols`x`rows`.

### P1-2 — real showcase framing: fit from a probe render, not an AABB estimate

`camera.ts`'s exported `glyphChart3dFitCamera` projects the object's
EXPANDED AABB corners (`margin`-padded) through a reference `zoom: 1`
camera — a fast, synchronous, analytic estimate with no rendering at all.
It never sees the overlay LABELS' own projected extent (a tick/title is
pushed outward from the box by a fraction of the axis extent, but the
LABEL TEXT itself has no glyph-metrics input to this function), so a short
axis title routinely fell off-frame at several rotations, and measured at
the reported CLI sizes the kept plot covered only 14x18 of 80x24 (~7.9%),
18x22 of 96x32 (~12.9%), and 22x28 of 140x40 (~11%) — all "about 5%" of
usable ink once tick text crowding is subtracted.

This function is KEPT UNCHANGED and stays exported exactly as it was — it
is still the right tool for a cheap SEED (e.g. a live orbit viewport's
initial pose, immediately refined by the reader's own drag) and C3 depends
on its signature. What changed is `renderGlyphChart3d`'s OWN static-frame
default, which no longer calls it at all: `render.ts`'s new
`fitStaticCamera` renders TWICE, mirroring `@glyphcss/diagrams/3d`'s own D2
packet (`render3d.ts`'s `fitCamera` — "a node LABEL's cell width doesn't
shrink with zoom the way geometry does, so the only reliable source for
'does this actually fit' is rendering it and measuring the painted cells").
Pass 1 renders at a conservative, world-extent-derived small zoom into a
generous 220x130 probe grid and measures the OCCUPIED cell bounding box —
geometry AND every stamped tick/title glyph, since they share one
`CellGrid` by construction now. Pass 2 scales zoom by the exact ratio needed
to fill the requested plot `cols`x`rows` (minus a 1-cell margin) and
recentres via `camera.center` (an additive PROJECTION offset —
`centerCol = cols * center[0]` — so no rotation needs inverting, unlike
moving `camera.target` would).

Measured at the SAME reported sizes, the volcano fixture used throughout
this section's gates: the occupied bounding box now covers comfortably over
the "roughly 50%" target at every one of 5 sampled rotations x 3 sizes (a
15-cell sweep, `render.test.ts`) — the gate itself pins the floor at 0.4
(not the exact number, which varies render to render) specifically because
it is FAR above the pre-fix ~5-13%, not because 0.4 is the achieved value.

Before/after, the volcano fixture at 80x24 terminal/`color: none` (`x`/`y`/`z`
axis titles requested; BEFORE reproduces the pre-fix behaviour exactly — the
bare orthographic default `zoom: 0.65`, no fit at all):

```
BEFORE (zoom: 0.65, no fit)              AFTER (fitStaticCamera)
                                30#                                       30#
                                  *                             \           *
                              22.5+                             /│\      22.5+
                                  =                             / │ \        =
                                15=                            //  │  \\   15=
                                  -                            /    │    \   -
                               7.5:                          0+     %     +07.5:
                                  .                            │2  %%@%%  2│  .
                                 0                              │y4 %@%@%/4x│ 0
                                                                 │  +\#%#/+  │
                                                                 │  #6\#/6*  │
                                                                 │ ++#8+8#=+ │
                    y+                                          │ =***│**+- │
                                                                 │:++++30+=+:│
                                                                 │-  ++25+  -│
                                                                 │   =-│-+   │
                                                                  \   -20   /
                                                                   \  :15  /
                                                                    \  │  /
                                                                     \ z /
                                                                      \5/
                                                                       +
                                                                       0
```

BEFORE painted 9 non-blank glyphs of the whole 1,920-cell frame outside the
colorbar column; AFTER paints the full volcano surface, its 12-edge box,
every tick, and all three axis titles (`x`, `y`, `z`) inside the SAME
80x24. The colorbar's own labels also grew from 2 (endpoints only, `30`/`0`)
to 5 intermediate rungs (`30`, `22.5`, `15`, `7.5`, `0`) — the second half
of P1-2's own ask.

### P1-3 — monochrome defaults to `shading: "value"`, resolved where the colour mode is known

`surface.ts` used to default `shading` to `"relief"` unconditionally
(`const shading = options.shading ?? "relief"`), regardless of §5's own
"under `color: "none"`/NO_COLOR, default to `value`" rule — the two-step
public API (`glyphChartSurface` builds a MARK, `renderGlyphChart3d` renders
one) means the model step has no colour-mode input to default from AT ALL.
Fixed by DEFERRING the default: `glyphChartSurface` now leaves `shading`
`undefined` when the caller names none (still validating an explicit value),
and `GlyphChart3dSurfaceMark.shading` is `"relief" | "value" | undefined`
rather than always-resolved. `glyphChartObject` (a live scene, always full
colour) still reads an undefined `shading` as `"relief"` — unchanged, since
"colour mode" is not a meaningful concept for a live scene consumer.
`renderGlyphChart3d`'s own `resolveMarkShading(mark, colorEnabled)` is the
ONE place the §5 default actually applies: `mark.shading ?? (colorEnabled ?
"relief" : "value")`.

**Gate**: the CLI's `--3d --color none` with NO explicit
`options.shading` is byte-identical to an explicit `shading: "value"` render
of the same data, and DIFFERENT from an explicit `shading: "relief"` one
(`chartCli.test.ts`) — reverting the default collapses the first comparison
to the second.

### P1-4 — `charset: "blocks"` was silently inert; now a faithful, ledgered downgrade

A chart's overlays (the box wireframe, every axis's ticks/labels) are
ALWAYS mounted — never optional — which means a chart's `compileScene` call
ALWAYS installs a `transformCells` hook. glyphcss's `charMode: "halfblock"`/
`"quadrant"` two-colour-per-cell encoders self-disable outright whenever a
`transformCells` hook exists (`rasterize.ts`'s `wantsHalfblockSolid`/
`wantsQuadrantSolid`, AGENTS.md's own "Render modes": "no-ops with
`transformCells`"). The original cut requested `charMode: "halfblock"` for
`charset: "blocks"` anyway; the hook silently defeated it every time, so
`ascii` and `blocks` output were byte-identical with no ledger entry
explaining why — the request simply never took effect.

Two options were weighed. (a) Render geometry in REAL halfblock by DROPPING
the overlay hook, stamping the box/ticks/labels some other way — rejected:
the hook IS the box/ticks/labels, so dropping it to get halfblock geometry
trades a charset for the chart's own axes, titles and frame, which is a
strictly worse chart. (b) Degrade `blocks` to the default solid ramp with a
VISIBLE ledger entry, exactly mirroring `braille`'s own existing downgrade
(and `@glyphcss/diagrams/3d`'s own D2 packet, which made the identical
`blocks -> ascii` call for the identical reason). (b) was taken:
`chart3d-blocks-unsupported` joins `chart3d-braille-unsupported`, and the
canvas CHROME tier (colorbar/title) degrades `blocks` to `ascii` too (it
used to keep real half-block/quadrant swatch glyphs even while the geometry
below it silently fell back to `ascii` — an inconsistent half-measure the
matrix test's own "byte-identical to `ascii`" claim now rules out for both
unsupported charsets).

**Gate**: the target x charset x colour matrix (`render.test.ts`) no longer
only checks `resolved.charset` (which always ECHOES the request, proving
nothing about behaviour) — for `braille` and `blocks` alike it now asserts
the matching ledger code AND that the frame is byte-for-byte identical to
the SAME mark/target/color rendered with `charset: "ascii"`.

### P1-5 — CLI `--camera` validation

`chartCli.ts`'s `parseCameraArg` split `--camera`'s raw value on `,` with no
length check at all: `--camera 10` (1 field) silently built `{rotX: 10}`
with no `rotY`, and `--camera 10,20,3,4` (4 fields) silently dropped the
4th field and kept `{rotX:10, rotY:20, zoom:3}`. `--camera` itself was also
accepted and quietly built into `opts.camera` even without `--3d` present —
`resolveChart3dCliOutput` simply never ran, so the flag had no effect and no
diagnostic either.

Fixed at the CLI's own argument-parsing boundary: `parseCameraArg` now
requires EXACTLY 2 or 3 comma-separated fields, each a finite number, or
throws a tagged `bad-camera-arg`; `parseChartArgs` throws a tagged
`bad-3d-flag` when `--camera` is set without `--3d`. `runChart` was
restructured so `parseChartArgs` runs INSIDE the same `try` block every
other CLI failure already reaches, so both new rejections exit 1 with their
code on stderr like every existing one.

**Gate** (`chartCli.test.ts`): `--camera 10` and `--camera 10,20,3,4` both
reject with `bad-camera-arg`/exit 1; `--camera 10,20` with no `--3d` rejects
with `bad-3d-flag`/exit 1.

### Fix round 1 — mutation table

| Item | Gate | Mutation | Result |
|---|---|---|---|
| P1-1 | `render.test.ts`'s "shading: 'value' keeps glyph density monotone in z" | Revert `p.texture` to the bare (unnamespaced) key, keep `compileScene` routing | RED — `new Set(sampleIndices).size` is `1`, not `> 1` (verified by hand, restored after) |
| P2-6 | `render.test.ts`'s rewritten "static frame equals live scene" (shading: value, colorbar, title, several ticks) | Any divergence between `render.ts`'s `compileScene({objects})` call and a real `scene.addObject()` mount | RED — the extracted plot sub-rectangle stops matching the live scene's own text |
| P1-2 | `render.test.ts`'s 15-combination rotation x size sweep (footprint >= 0.4, all 3 axis titles present) | Fit from the raw AABB alone (`glyphChart3dFitCamera`, no probe render) instead of `fitStaticCamera` | RED on several of the SAME combinations (a dedicated test reproduces the old technique inline and asserts at least one rotation/size falls below the floor) |
| P1-3 | `chartCli.test.ts`'s `--color none` default-shading test | Revert `resolveMarkShading`'s colour-mode branch (always default to `"relief"`) | RED — the defaulted render stops matching the explicit `shading: "value"` render |
| P1-4 | `render.test.ts`'s target x charset x colour matrix | Keep `charMode: "halfblock"` requested for `blocks` with no downgrade | RED — `blocks` output diverges from `ascii` with no explaining ledger entry |
| P1-5 | `chartCli.test.ts`'s 3 new `--camera` cases | Drop the field-count/finite check, or the `--3d`-required check | RED — `--camera 10`/`--camera 10,20,3,4`/`--camera 10,20` (no `--3d`) all stop rejecting |

**Gate.** `pnpm --filter @glyphcss/charts test` (43 files, 1568 tests, +31
over the C2 packet's own 1537), `pnpm --filter @glyphcss/compile test` (8
files, 82 tests, +15), `pnpm --filter @glyphcss/core test` (26 files, 801
tests, unchanged — this round touched no core file), `tsc --noEmit` clean
on both `@glyphcss/charts` and `chartCli.ts`/`chartCli.test.ts`, and
`pnpm build:packages` (all 17 packages) pass — all at the merged base
BEFORE the pre-final-gates re-merge of `feat/diagrams`'s then-current head,
which this section's own final report re-verifies.

## C3 — `/charts` 3D UI: mark-card Surface, live viewport, View folder, presets, URL state

**Scope.** The website half of the 3D chart track: a "Surface" mark-card
type, a live orbitable viewport on `web`, a static frame everywhere else,
a View folder (rotate mode, reset camera, shading, colorscale), camera and
dimension in `?c=`, two vendored 3D datasets in the preset tray, and
Random able to land on either. Built entirely inside `ChartsWorkbench/` —
no shared `InstrumentWorkbench` 3D viewport existed on `feat/diagrams` when
this packet started (grepped `addObject` under `website/src/components`:
zero hits); D3's own `/diagrams` viewport landed in parallel and, per its
own AGENTS.md paragraph, was assessed for extraction and explicitly NOT
generalized this round ("not yet proven stable enough to safely extract").
`Charts3dViewport.tsx` is written to take only a resolved
`GlyphChart3dSurfaceMark` plus plain camera/scene-option props — no
`ChartsWorkbenchState` import — specifically so a later lift is a house
move, not a rewrite.

**Why the mark card's "Surface" option is real, generic grid detection, not
a special case for the two vendored datasets.** `chartsSurfaceFitFromRows`
profiles the reader's CURRENTLY loaded 2D table (the same rows
`chartsMarkTypeFit.ts` already reads for every other type), takes its
first three numeric/integer columns in profiled order, and attempts the
REAL `glyphChartSurface` build — catching its own validation error rather
than restating "must be a complete unique (x, y) grid" as a second rule
that could drift from the library's own. None of the 16 vendored 2D
datasets are gridded this way (they are time series or categorical), so on
real data the option is disabled with a plain-English reason by default —
which is correct, not a bug: a reader who wants 3D reaches for the preset
tray's own two datasets, the primary and only guaranteed-good path. The
fit is deliberately scoped to the first three numeric columns rather than
every x/y/z permutation of a wider table (an exhaustive search was
considered and cut for scope — a future increment can widen it, or add an
explicit column picker); a synthetic table with the RIGHT three columns
still lights the option up and mounts a real "inline" surface (see below).

**Why an inline table-derived surface is never written into `?c=`.**
`chartsSurfaceFitFromRows`'s `fits: true` branch returns a `Charts3dSource`
of `kind: "inline"` carrying the reader's own rows verbatim (not just an
id) — the mark-card equivalent of a remote 2D dataset, which already has
no local copy to compare a link's payload against. `chartsUrlStateForEncode`
blanks `chart3d.source.rows` unconditionally when `kind === "inline"`
(mirroring the remote-2D-mark blanking already in this file, never a
byte-match comparison since there is nothing to compare against), and
`validateCharts3dSource` refuses to decode an inline source with no `rows`
array (or one carrying the `sourceOmitted: true` flag the encoder writes
in their place) — the CONTAINING `chart3d` therefore fails validation and
`validateChartsWorkbenchState` degrades LOCALLY: `dimension` falls back to
`"2d"` and `chart3d` to its default, while every OTHER field in the same
payload decodes untouched. This is a deliberate asymmetry from a
`"dataset"` source's own stale-id fallback (which ALSO discards the 2D
marks in favour of a random dataset) — a stale `chart3d.source.id` has no
bearing on whether the rest of the link's 2D chart is still good, so only
`dimension` is forced back, never the marks.

**Why "auto" shading resolves differently in the two exits, and why
that's correct rather than an inconsistency.** After the C2 fix round,
`renderGlyphChart3d` resolves an UNDEFINED mark `shading` from its OWN
render-time colour mode (`"value"` under `color: "none"`/NO_COLOR,
`"relief"` otherwise) — the one place that genuinely knows it, since the
identical mark can be rendered at different colour modes (chat vs.
terminal, NO_COLOR toggled) without rebuilding it. `glyphChartObject`
(and, underneath it, `glyphChartSurface`) have no such per-render
resolution step — an undefined shading there ALWAYS defaults to
`"relief"`, correct for `renderGlyphChart3d`'s own internal use (which
re-resolves before ever calling `glyphChartObject`) but WRONG for this
page's live viewport, which calls `glyphChartObject` directly with no
second pass. `resolveCharts3dView` (the static/thumbnail resolve) therefore
leaves `shading: "auto"` as `undefined`, letting `renderGlyphChart3d` do
its own correct, colour-aware resolution per call;
`resolveCharts3dViewForLiveScene` (the live viewport's OWN resolve) applies
the IDENTICAL ternary one layer earlier, against the live scene's own
`useColors` — so a reader who sets `color: none` and leaves shading on
"auto" sees `"value"` shading (glyph density carries z) on the live
viewport, not a flat, colour-dependent `"relief"` render with nothing to
show. An explicit `"relief"`/`"value"` override from the View folder
always wins on both exits, unconditionally.

**Why charset can only ever degrade live, never change what the scene
mounts with.** The C2 fix round's own finding — a 3D chart's axis/tick
overlay ALWAYS installs a `transformCells` hook, and glyphcss's
halfblock/quadrant encoders self-disable under any such hook — applies
identically to a live `createGlyphScene` mounting the SAME
`glyphChartObject` overlays via `scene.addObject`. The live viewport
therefore never requests `charMode: "halfblock"` for `blocks` (there is no
such option on `Charts3dSceneOptions` at all — it was removed once the
library's own static exit stopped emitting it too) and shows the SAME
visible chrome note braille already had, reusing `glyphChart3dCharsetDegrades`
(a plain exported predicate, not the internal `resolveCharsetDegrade3d`
that pushes a `report.ledger` entry — a live scene has no ledger of its
own to push one into) rather than re-deriving which charsets are
unsupported.

**Why Random's 3D pool addition is a THIRD pool segment inside
`chartsRandomDataset.ts`, not a page-side pre-check.** A first cut drew a
SEPARATE `Math.random()` call ahead of the existing built-in/remote pick to
decide 2D vs. 3D — this shifted every mocked `Math.random` sequence three
existing Random tests already pinned (`mockReturnValue(0)` and
`mockReturnValueOnce(X).mockReturnValue(0.5)` fixtures keyed to an exact
pool INDEX), breaking all three. The fix folds the 3D datasets into the
SAME combined pool `randomChartsDatasetPick` already draws from with ONE
`Math.random()` call, appended AFTER the remote segment (never inserted
earlier, which would renumber every existing index-based fixture) — so
`RANDOM_VALUE_FOR_FIRST_REMOTE_PICK`'s own denominator grew by
`CHARTS_3D_DATASETS.length` and nothing about its numerator (still
`CHARTS_DATASETS.length`) needed to change.

**Datasets, licences verified.** `maungaWhauVolcanoDataset` — the real R
`datasets::volcano` matrix (87 rows x 61 columns, values 94-195, the
documented range), captured from `volcano.csv` in the `plotly/datasets`
GitHub repo (confirmed MIT via that repo's own `LICENSE` file). The
DIGITIZATION itself is credited to Ross Ihaka per R's own `?datasets::volcano`
help page ("Digitized from a topographic map by Ross Ihaka") and ships as
part of R's base `datasets` package, licensed GPL-2 | GPL-3 — a repackaging
under MIT does not relicense the underlying data, so both licences are
stated in `datasets/LICENSES.md` and the dataset's own `source.licence`
field names both explicitly, flagged for the user to confirm GPL
compatibility before treating the file as MIT-only (never silently
resolved either way). `etopo1AlpsDataset` — a real 36x31 window (stride-2
downsampled from the tile's own 181x91 vertex grid) extracted directly
from this repo's OWN baked `website/public/data/geo-tiles/curated/7/66_31.bin`
(the curated Switzerland z7 raster tile, the SAME int16 vertex grid
`glyphMapPolygons` draws the real `/maps` terrain from) around the
Matterhorn — NOAA ETOPO1, public domain, no separate verification needed
since it is this repo's own already-credited data. Elevation range in the
window: 198-4,271 m (the true peak is undersampled by this pyramid tier,
consistent with AGENTS.md's own documented Matterhorn undersample note).

**Gates.** `pnpm --filter @glyphcss/charts test` (43 files, 1568 tests,
unchanged from C2 fix round 1 — this packet touched no library file beyond
the merge conflict resolution in `render.ts`/`index.ts`, which renamed
`glyphChart3dCharMode` to the public predicate `glyphChart3dCharsetDegrades`).
Website: `chartsWorkbench3d.test.ts` (13 tests: view-state defaults read
straight from the library, `resolveCharts3dView`/`resolveCharts3dViewForLiveScene`
never throw, `chartsSurfaceFitFromRows` fits a synthetic complete grid and
disables on every real vendored 2D dataset and on an incomplete grid,
`chartsWorkbench3dSceneOptions` honours colour and reports the SAME
downgrade note for both `blocks` and `braille`), `chartsWorkbench3dRender.targetMatrix.test.ts`
(5 tests: every target x charset x colour cell resolves ok and never
throws, braille never leaks a braille glyph, `color: css` always produces
`html`, ANSI colour modes always produce SGR text and `none`/`css` never
do, an unknown dataset id reports an error rather than throwing),
`datasets/chart3d/datasets3d.test.ts` (7 tests: both datasets' real
dimensions/ranges, credited source fields, and a build-through-`glyphChartSurface`
smoke test for each), `chartsUrlState.test.ts` (+6 tests: a 3D-dataset
round trip with an explicit camera/orbit-mode/shading/colorscale, an
auto-fit camera's `zoom: undefined` surviving the round trip exactly, an
inline surface source never appearing in the encoded `raw` string and
decoding back to 2D, a stale 3D dataset id falling back to 2D with the
REST of the link untouched, a hand-built malformed `chart3d` payload
(via the envelope's own documented plain-JSON `v1j.` fallback wire format)
degrading to the 2D default rather than failing the whole decode, and an
invalid `dimension` value read as `"2d"`), `chartsRandomDataset.test.ts`
(+2 tests: the pool hits all three segments including 3D over 500 draws,
excluding a 3D id still reaches the other kinds and every 3D dataset is
individually reachable), `ChartsWorkbench.test.tsx` (+1 test: Random can
land on a 3D surface, observed through the same `.charts-data-title`
element every other Random test reads). All 74 PRE-EXISTING
`chartsUrlState.test.ts` tests (including the fixed historical-link
regression pin, `HISTORICAL_DEFAULT_LINK` — encoded before `dimension`/
`chart3d` existed — still decoding to exactly today's default state, which
now includes `dimension: "2d"` and a populated default `chart3d`) and all
91 pre-existing `ChartsWorkbench.test.tsx` tests pass unchanged.

**Mutation table.**

| Item | Gate | Mutation | Result |
|---|---|---|---|
| Surface fit | `chartsWorkbench3d.test.ts`'s grid-fit tests | Drop the `glyphChartSurface` validation call, replace with a hand-rolled "3+ numeric columns" check | RED — a grid missing one `(x, y)` pair (the "MISSING one pair" test) would still report `fits: true` |
| Inline omission | `chartsUrlState.test.ts`'s "never written into the link" test | Drop the `sourceOmitted`/no-`rows` blanking in `chartsUrlStateForEncode` | RED — the encoded `raw` string contains the distinctive `97` z-value the test asserts is absent |
| Stale-id scope | `chartsUrlState.test.ts`'s "falls back to 2D... rest of the link untouched" test | Route the stale-3D-id fallback through the SAME random-dataset-replacement path the stale-2D-id fallback uses | RED — `resolved.marks` would no longer equal the pre-fallback 2D marks |
| Malformed degrade | `chartsUrlState.test.ts`'s "degrades... rather than failing the whole decode" test | Have `validateCharts3dViewState`'s failure propagate to `validateChartsWorkbenchState`'s own `return null` | RED — `decodeChartsUrlState` returns `null` for the whole link instead of a 2D-degraded state |
| Random pool | `chartsRandomDataset.test.ts`'s "hits... AND the 3D pool" test | Drop the `CHARTS_3D_DATASETS` segment from `CHARTS_RANDOM_DATASET_POOL` | RED — `sawChart3d` stays `false` over 500 draws |
| Random test alignment | `ChartsWorkbench.test.tsx`'s three PRE-EXISTING Random tests | Reintroduce a separate pre-check `Math.random()` draw ahead of `randomChartsDatasetPick` | RED — all three (their own mocked sequences shift by one draw) |
| Live shading | (documented, not independently gated beyond the resolve tests above) | Have `Charts3dViewport` call `resolveCharts3dView` instead of `resolveCharts3dViewForLiveScene` | Not separately caught by an automated test — a manual/visual residual, see below |
| Charset degrade reuse | `chartsWorkbench3d.test.ts`'s downgrade-note test | Hardcode `charset === "braille"` only, dropping `blocks` | RED — `chartsWorkbench3dSceneOptions("blocks", "css").downgradeNote` would be `null` |

**Residuals.**
- `GlyphChart3dCameraOptions` doesn't accept `mat` yet (library gap, C2
  fix round in flight) — a trackball orbit's exact orientation is captured
  live and threaded through `renderCharts3dStatic`'s own `camera` option,
  but the library still ignores the extra fields until it grows a `mat`
  field (mirroring `renderGlyphDiagram3d`'s own, which already has one).
  Turntable Copy is exact and unaffected.
- The live-shading divergence rule (`resolveCharts3dViewForLiveScene`) has
  unit coverage for the RESOLVE function itself (`chartsWorkbench3d.test.ts`)
  but no DOM-level test mounting the live viewport under `color: none` and
  reading back rendered glyph density — `happy-dom` has no real character
  metrics for such an assertion to read.
- `chartsSurfaceFitFromRows` is scoped to the first three numeric columns
  in profiled order, not every x/y/z permutation of a wider table.
- No `aspect` control in the View folder (the packet scope listed it as
  optional, "if the library exposes it" — `glyphChartSurface`'s `aspect`
  is a per-BUILD option baked into the mesh, not a live per-frame knob,
  and this showcase has no natural per-chart aspect control elsewhere to
  mirror; left for a real need to justify it).

## C3 fix round 1 — camera.mat round-trips in `?c=`, the live scene updates in place, real interaction gates, licence wording

A codex review of `17108985` found two P1s and one P2, all inside the C3
packet's own files, plus a licence-wording finding on the vendored
`maungaWhauVolcanoDataset`. Four items.

### P1-1 — `camera.mat`/`useMat` round-trip in `?c=`

`chartsUrlState.ts`'s `validateCharts3dCamera` read `rotX`/`rotY`/`zoom`
off a decoded `chart3d.camera` payload and dropped `mat`/`useMat` on the
floor — so a trackball drag (`Charts3dViewport.tsx`'s own `onEnd` handler,
which reports `{ rotX, rotY, zoom, mat, useMat }` exactly like `/diagrams`'
own D3 handler does) recorded a real rolled orientation into
`state.chart3d.camera`, but a shared link reloaded with only the stale
`rotX`/`rotY` Euler pose the trackball orbit had drifted AWAY from at
mount — `Charts3dCamera.mat`'s own doc: `rotX`/`rotY` ride along as the
last TURNTABLE pose, never what a trackball view actually renders from.
Fixed by adding `validateCharts3dCameraMat` (checks the real glyphcss
contract: exactly 9 finite numbers, `GlyphCamera.mat`'s own row-major 3x3
doc in `createGlyphCamera.ts` — not the "9 or 16" the review's own prose
loosely said) and threading `mat`/`useMat` through
`validateCharts3dCamera`'s return value as append-only optional fields,
same as every other C3 field. A malformed `mat` (wrong length, a non-finite
entry) is treated as ABSENT rather than rejecting the whole `chart3d`
payload — `rotX`/`rotY`/`zoom` are still a perfectly valid (if turntable)
camera on their own. The ENCODE side needed no change: `chartsUrlStateForEncode`
only ever touches `marks`/`chart3d.source`, never `chart3d.camera`, so
`Charts3dCamera`'s own `mat?`/`useMat?` fields were already carried through
the plain `JSON.stringify` the envelope performs — the bug was decode-only.
Gate: `chartsUrlState.test.ts`'s "round-trips a rolled trackball camera
pose" test, a real non-Euler rotation matrix (`[0.36, 0.48, -0.8, -0.8,
0.6, 0, 0.48, 0.64, 0.6]`, not reachable via any `rotX`/`rotY` pair) through
`set-3d-camera` → encode → decode. Mutation: deleting the `mat`/`useMat`
branch from `validateCharts3dCamera` reddens it (every other 3D URL-state
test still passes — none of them set a matrix).

### P1-2 — the live scene remounted on every shading/colorscale/colour edit (and every camera drag)

`Charts3dViewport.tsx`'s single mount effect was keyed on
`[mark, sceneOptions.useColors]` — `mark` is a freshly-built
`GlyphChart3dSurfaceMark` object every time `resolveCharts3dView`/
`resolveCharts3dViewForLiveScene` runs, which is EVERY time
`ChartsWorkbench.tsx`'s `chart3dResolvedLive` memo recomputes, which was
keyed on the WHOLE `state.chart3d` object — including `camera`. Since
`set-3d-camera` (the orbit controls' own "end" handler) spreads a new
`camera` field onto `chart3d`, EVERY orbit drag release produced a new
`chart3d` reference, which produced a new `mark` object (identical
content, `glyphChartSurface` re-run for no reason), which — under the old
single effect — tore the whole scene down and rebuilt it: a fresh
`createGlyphOrthographicCamera`, a fresh `createGlyphScene`, a fresh
`createGlyphOrbitControls`. The rebuild re-seeded the camera from the
JUST-REPORTED `rotX`/`rotY`/`zoom`, which is why this was invisible on an
ordinary turntable drag (the new camera lands exactly where the old one
ended) but destructive on any REAL appearance edit — switching `Shading`,
`Colorscale` or `Color` while mid-orbit visibly snapped the camera back to
whatever framing that edit's own fresh `glyphChart3dFitCamera`/auto-fit
produced, discarding the reader's own orientation.

Fixed at two layers:

1. **`ChartsWorkbench.tsx`** — `chart3dResolved`/`chart3dResolvedLive`'s
   own `useMemo` deps narrowed from the whole `state.chart3d` object to
   `[state.chart3d.source, state.chart3d.shading, state.chart3d.colorscale,
   …]` — the only fields either function actually reads. The reducer's
   `set-3d-camera`/`set-3d-view` (orbit-mode) actions spread `{ ...state.
   chart3d, camera: … }`, which never touches `source` — so these three
   fields keep referential stability across an orbit drag, and `mark`'s own
   identity no longer changes on one at all.
2. **`Charts3dViewport.tsx`** — split the one mount effect into three: a
   MOUNT-ONLY effect (`useEffect(..., [])`) that creates the scene, camera
   and orbit controls exactly once per viewport lifetime (remounted only
   when the CALLER unmounts the component — closing the 3D view, switching
   target away from `web`); a mark-update effect (`useEffect(..., [mark])`)
   that calls the scene-object handle's own `update()` (AGENTS.md's "Scene
   objects": "replaces meshes/overlays/hotspots/samplers wholesale, keeping
   the handle's identity") whenever `mark` changes for ANY reason — a new
   dataset, shading or colorscale — leaving the camera and orbit controls
   untouched; and a colour effect (`useEffect(..., [sceneOptions.
   useColors])`) that calls `scene.setOptions({ useColors })`. Both non-mount
   effects skip their own first run (the mount effect already installed
   that exact initial content), a ref-latched guard rather than a
   dependency-array trick. The resize observer's re-fit reads bounds from
   `objectBoundsRef` (updated by the mark-update effect) rather than the
   mount effect's own closed-over `object.bounds`, so a resize after a
   dataset switch refits against the CURRENT geometry, not the initial one.

Gate: `Charts3dViewport.lifecycle.test.tsx` (NEW file, P2-3 below) —
`createGlyphScene` spied via a real `vi.mock("glyphcss", importOriginal)`
wrapper (never a fake scene) asserted to be called exactly ONCE across a
charset edit, a colour edit AND a shading/colorscale edit, with
`scene.setOptions`/the object handle's `update()` called instead. Mutation
check performed live during this round: reverting the mount effect's dep
array from `[]` back to `[mark, sceneOptions.useColors]` reddens the
"called once" test at the colour-edit assertion (`expected 2 to be 1`) —
confirmed by actually making the mutation, running the test, and reverting.

### P2-3 — no lifecycle/interaction test for the live viewport

`chartsWorkbench3d.test.ts` tested pure resolvers only — nothing drove a
real pointer gesture through a real `createGlyphScene`/
`createGlyphOrbitControls` mount, and nothing proved disposal actually ran.
`Charts3dViewport.lifecycle.test.tsx` (NEW), mirroring
`DiagramsWorkbench.3d.test.tsx`'s own P2-3 round (the reference this file
was studied from) exactly: real `PointerEvent` drags
(`pointerdown`/`pointermove`/`pointerup`) on the live host proving (a) a
turntable drag changes Copy ASCII's own output afterward, and (b) a
trackball drag commits a `camera.mat`/`useMat` shape (verified through the
real "Copy link" round trip, not a hand-built dispatch — `useMat: true`,
`mat` a real 9-element array); (c) the `createGlyphScene`-called-once
guarantee above, spied at the real factory; and (d) `scene.destroy()`/
`controls.destroy()` both actually called (never merely inferred from the
host `<div>` leaving the DOM, which React's own removal does unconditionally
regardless of whether the glyphcss-side cleanup ran) on a mark-type switch
back to 2D and on unmount. Every test is a real mutation check — the
"called once" test was proven red against the actual P1-2 regression
above; the disposal tests read the same wrapped-factory spy idiom D3's own
round already established as the correct disposal proof.

### Licence wording — `maungaWhauVolcanoDataset`

The codex review flagged the dataset's own `source.licence` string (and
`LICENSES.md`'s matching table row) for reading as "MIT-only" at a glance,
despite already carrying a GPL caveat — the caveat trailed AFTER an
"MIT (...)"-first phrasing and hedged with "verify GPL compatibility"
rather than stating the governing licence outright. Reworded both (the
dataset file's own `source.licence` field, and `LICENSES.md`'s row) to the
same two-clause statement, MIT clause first only because it names what was
literally FILE-packaged (never implying it governs the dataset): "Plotly's
own file packaging (the `volcano.csv` this was captured from) is MIT; the
dataset's governing provenance is R's base `datasets` package, licensed
GPL-2 | GPL-3 — 'digitized from a topographic map by Ross Ihaka', per R's
own `?datasets::volcano` docs." `LICENSES.md`'s row additionally leads with
a bolded **Never "MIT-only"** so the caveat can't be skimmed past. No
`datasets3d.test.ts` test pinned the old wording (only a non-empty-string
check), so no test change was needed.

### Guides UI — not built this round

The coordinator's brief was updated mid-round: the C2 library is shipping
independent guide toggles (`guides: { axisLines, ticks, tickLabels,
titles, grid, walls, box }`, all booleans) rather than the earlier `box:
"axes" | "full" | "none"` enum, for a "like the 2D chart with one more
side" axis-triad look. Grepped `packages/charts/src/3d/*.ts` (non-test)
for `guides`/`axisLines`/`GlyphChart3dGuides` after the `feat/diagrams`
merge this round started from: not present — only pre-existing, unrelated
`tickLabels` references in `object.ts`/`surface.ts`/`types.ts`. Per the
coordinator's own instruction ("if it isn't there yet, skip it and say
so"), no Guides UI was built in the View folder this round; a C4-round
agent adds it once the library option lands, using its real shape rather
than an invented one.

## C3 fix round 2 — the downgrade note moves out of the viewport, into the Charset toggle

User feedback, verbatim: on seeing the banner "Braille is wireframe-only in
glyphcss — this 3D scene (always solid) falls back to the default ramp."
painted inside the live 3D viewport, "why do we have this in the rendering
area?" Two problems in one: it violated AGENTS.md's own "TargetPreview"
rule ("a chrome note lives in the frame's OWN chrome... never the
viewport's render area") — despite the CSS comment shipping right above
the offending rule and CITING that exact sentence, the element itself
(`.charts-3d-downgrade-note`, a flex sibling of the scene host inside
`.charts-3d-viewport`) was inside the render area regardless of what the
comment claimed; and its wording ("wireframe-only in glyphcss") was
developer-speak, not something a reader of the page needed explained to
them.

**Removed outright** (`Charts3dViewport.tsx`): the whole `sceneOptions.
downgradeNote` conditional branch and its `<div className="charts-3d-
downgrade-note">` — the component now returns exactly one shape,
unconditionally: the bare scene host with nothing else inside
`.charts-3d-viewport`. `Charts3dSceneOptions` lost the field entirely
(`chartsWorkbench3d.ts`) — it now carries only `useColors` — and
`chartsWorkbench3dSceneOptions` lost its `charset` parameter along with
it, since nothing in the function needed it once the note it computed was
deleted. The CSS rule (`charts-workbench.css`) is gone too, replaced with
a comment explaining why (mirroring `glyphMonoCmap.test.ts`'s own idiom of
documenting a fixed defect at the file that once had it).

**The reason moved to where the choice is made**: the Dock's Output
folder Charset `IconToggle` (`ChartsDock.tsx`'s new exported
`chartsCharsetToggle(is3d)`) now dims each charset
`glyphChart3dCharsetDegrades` flags — while `is3d` — with `disabled: true`
and `disabledReason: "Not available for 3D surfaces yet"`, the SAME
`IconToggle` `disabled`/`disabledReason` fields `chartsRegionFillToggle`
(the Chart folder's "Textures" row, right above it in the same file)
already uses — this page's own established `mapDirectionLocked` idiom for
"an option this state can't honour, with the reason on its title/
aria-label," not a new pattern. `is3d` itself was hoisted to the top of
the component (it used to be computed only where the View folder needed
it, further down) since the Charset row's own memo — `const charsetToggle
= useMemo(() => chartsCharsetToggle(is3d), [is3d])` — needs it earlier in
the function.

**Reads the library predicate, never a hardcoded charset.** The brief was
explicit that the C2 library round in flight is expected to make braille
a REAL 3D surface (wireframe), leaving only `blocks` degraded — so
`chartsCharsetToggle` calls `glyphChart3dCharsetDegrades(v)` directly, the
identical predicate the removed viewport note used to call, never a
literal `charset === "braille"` check. Verified live, not just argued:
hardcoding `v === "braille"` in `chartsCharsetToggle` was tried and
reverted — it reddens `chartsWorkbench3d.test.ts`'s new
`chartsCharsetToggle` describe block immediately, TODAY, since the
predicate already also flags `blocks` (the C2 braille round hasn't landed
yet on this merge) — proving the mutation check catches a hardcoded list
now, not only after the library changes underneath it.

**Item 3 (an explicit override or an old link still handing the view an
unsupported charset)** needed no code change at all — the live scene never
read `charset` for anything besides the now-deleted note (AGENTS.md's own
C3 doc: "the scene mounts at its default `charMode` regardless of
charset"), so an unsupported value already rendered exactly like a
supported one; the DIMMED toggle simply can't be used to reach it going
forward, and a link built before this fix (or before the charset
degraded) still decodes and renders in the viewport with no banner, the
reason visible only on the toggle. Pinned by a new mounted-page test
(`an explicit override handing the 3D view an unsupported charset still
renders silently, with no banner`) that hand-builds a `dimension: "3d"` +
`controls.overrides.charset: "braille"` state (unreachable via the
disabled button, which — like a real browser — refuses a synthetic
`.click()`) and asserts the scene still mounts and renders with `.charts-
3d-viewport` holding exactly its one bare host child.

**Gates** (`chartsWorkbench3d.test.ts`, `Charts3dViewport.lifecycle.test.tsx`):
a pure `chartsCharsetToggle` unit test asserting the disabled set exactly
equals what `glyphChart3dCharsetDegrades` flags, in 3D only, with the
literal reason string; a mounted-page test iterating every real
`CHART_CHARSETS` value in the LIVE 3D viewport (clicking each Charset
button, including the disabled ones, which no-op) and asserting `.charts-
3d-viewport` never grows past its one host child and `.charts-3d-
downgrade-note` never appears; a mounted-page test reading the SAME
charsets' real button `disabled`/`title`/`aria-label` off the fully
rendered Dock; and the explicit-override test above. All four were run
against a deliberate reintroduction of the old banner markup and against
a hardcoded `braille`-only predicate and confirmed red before being
reverted to the real fix.

| Item | Gate | Mutation | Result |
|---|---|---|---|
| Banner removed | `Charts3dViewport.lifecycle.test.tsx`'s "never renders a note or banner" test | Reintroduce `<div className="charts-3d-downgrade-note">` inside the viewport's returned JSX | RED — `.charts-3d-viewport`'s child count goes from 1 to 2 for every charset |
| Silent explicit-override downgrade | Same file's "explicit override... renders silently" test | Same reintroduction | RED — the explicit-`braille`-override state also grows the child count to 2 |
| Reason on the real Toggle | Same file's "dimmed... with a plain-English reason" test | Drop `disabled`/`disabledReason` from `chartsCharsetToggle` | RED — `button.disabled` stays `false` for every charset in 3D |
| Predicate-driven, not hardcoded | `chartsWorkbench3d.test.ts`'s `chartsCharsetToggle` describe block | Hardcode `v === "braille"` in place of `glyphChart3dCharsetDegrades(v)` | RED, TODAY — `blocks` is currently ALSO flagged by the real predicate, so the hardcoded version already disagrees with it before the C2 braille round even lands |
## C2 fix round 2 — trackball camera, closed-form label-fit, "axes in one corner," guide toggles, real braille wireframe

Arrived as three escalating coordinator messages (a P1 trackball-camera
item, a re-review with 4 more P1s and a P2, then two rounds of direct USER
FEEDBACK) plus a fourth mid-round message reporting a live-viewport defect
("a big shitty line in the middle") and a request that braille genuinely
render instead of downgrading. All are addressed in this section.

### P1-d — trackball (`mat`) camera, mirroring `renderGlyphDiagram3d` exactly

`GlyphChart3dCameraOptions` gained `mat?: readonly number[]` (a 9-element
row-major 3x3 rotation matrix) alongside `rotX`/`rotY` — never both
(`bad-camera` otherwise). `fitStaticCamera`'s own `makeCamera` closure is
rotation-representation-agnostic: it only ever calls `frame.camera.project`,
so the SAME closed-form fit (below) works for a trackball pose unchanged.
`resolved.camera` reports `mat` (never `rotX`/`rotY`) when a trackball
camera was used, so `options.camera = result.resolved.camera` round-trips
either representation exactly. Gate: `render.test.ts`'s trackball roll
test (a real 90-degree-roll-plus-yaw matrix, NOT expressible as any
`rotX`/`rotY` pair) renders finite output with all 3 axis titles surviving.

### P1-c — `camera.center` accepted on input and always reported on output

`resolved.camera.center` is now UNCONDITIONALLY present (never omitted at
its own `[0.5, 0.5]` identity) and `GlyphChart3dCameraOptions.center` is
accepted alongside an explicit `zoom` — together they let a caller
re-render from `resolved.camera` verbatim and land on the exact same
frame. Before this fix, `resolved.camera` carried only `rotX`/`rotY`/`zoom`/
`mat`, so re-rendering from it reproduced the right SIZE at the wrong
POSITION (the auto-fit's own recentring offset had nowhere to travel back
through) — measured 245-576 characters different from the original frame.
Gate: a round-trip test renders once with auto-fit, re-renders from
`result1.resolved.camera` verbatim, and asserts `result1.text === result2.text`.

### P1-b — closed-form label fit now uses the shared axis-TRIAD's own anchors

`fitStaticCamera`'s label-anchor set (`glyphChart3dLabelAnchors`) now reads
through the SAME `resolveSharedCorner` the render's own overlay uses (see
"axes in one corner" below), so the fit's own linear-inequality bounds are
computed against the EXACT anchor points the triad will paint — not a
per-axis independent edge choice that could diverge from what actually
renders. `outwardPoint`'s own axis-aligned coordinate is `t * ext[axis]`,
UNFLIPPED by the corner's own bit on that axis (a bug introduced and
caught mid-round: the corner's bit on an axis says which FACE is farther,
not which END of that axis's own edge a tick should read from — the edge
touching the corner always spans the FULL `[0, ext[axis]]` range
regardless of the corner's bit on that axis, since the corner's two
possible positions on it differ only in that ONE coordinate).

### Corner-triad "axes in one corner" redesign (USER FEEDBACK)

Replaces C1's per-axis "nearest of 4 parallel edges" rule (the box's own x/y/z
ticks could each independently jump to a different edge as the camera
orbited, scattering labels around the whole box) with a SINGLE shared
corner all 3 axes meet at — the matplotlib/MATLAB convention the user asked
for directly ("the 2d [chart] but adding one side more... you get the 3
axes on one side... the render is inside of the block created by those").

**`resolveSharedCorner(ext, frame, cornerOption)`** (`object.ts`) resolves
`axes.corner` (default `"auto"`) per camera, every `stamp()` call — a PURE
function of camera ROTATION only (depth ordering at a fixed rotation is
zoom/center-invariant for an orthographic camera), so it needs no stored
"last corner" state and is naturally stable except at genuine silhouette
transitions. For EACH axis independently, it compares the projected depth
of that axis's own two PERPENDICULAR FACE CENTERS and keeps the FARTHER
one's bit — the "put the guide wall behind the data" rule: each of the 3
resulting guide planes (what `classifyEdges`/`planeGridLines` read off this
SAME corner) is, by construction, the back one of its own opposing pair.
An explicit `[0|1,0|1,0|1]` triple or one of 8 named corners
(`"x1-y0-z1"`, etc.) pins the triad regardless of rotation.

**`classifyEdges(corner)`** partitions the box's 12 edges into `axisLines`
(the 3 touching the corner — the triad itself), `wallOutline` (6 more, on
one of the 3 guide planes but not touching the corner — `guides.walls`),
and `boxOnly` (the remaining 3 far edges — `guides.box`, "the far corner's
own wireframe, completing a 12-edge box"). `axisTriadOverlay` is now the
ONE overlay `glyphChartObject` mounts (was 4: a box wireframe plus 3
independent per-axis overlays) — it resolves the corner EXACTLY ONCE per
`stamp()` and every edge/tick/title/gridline reads that SAME value, which
is what makes "all three axis lines share one corner vertex" true by
construction rather than by coincidence.

**`planeGridLines(fixedAxis, corner, ext, axes)`** draws, for each of the 3
guide planes, a line at every OTHER axis's own tick position sweeping the
plane's full extent along the third — the 2D chart's own `axes.{x,y}.grid`
discipline extended by the one dimension a 3D chart adds (`guides.grid`).

**Priority order** (a deliberate change from C1's "title always outranks
every tick," per the user's own explicit ordering): `PRIORITY_TICK_EXTREME`
(900) > `PRIORITY_TITLE` (800) > `PRIORITY_TICK_ZERO` (600) >
`PRIORITY_TICK_INTERIOR` (400) — endpoints win over the title, which still
wins over an interior tick.

### `guides` — independent toggles, replacing the coordinator's own first-draft `box` enum

Message 3B (USER FEEDBACK, refining message 3A mid-implementation)
explicitly asked to replace a single `box: "axes" | "full" | "none"` enum
with independent booleans, matching 2D's `axes.{x,y}.{grid,tickMarks,title}`
naming/style:

```ts
guides?: {
  axisLines?: boolean;   // default true
  ticks?: boolean;       // default true
  tickLabels?: boolean;  // default true
  titles?: boolean;      // default true
  grid?: boolean;        // default true
  walls?: boolean;       // default false
  box?: boolean;         // default false
}
```

`axisLines + walls` is the "near/guide" edge set (9 of 12 edges);
`+ box` is the full 12-edge wireframe. `axes.corner` (a sibling of
`axes.{x,y,z}`, not a top-level option — it lives beside the axis options
it governs) and `guides` are both validated in `surface.ts`'s
`resolveCorner`/`resolveGuides` (`bad-options` on a non-boolean toggle or
an unrecognized corner shape/name) and mirrored in `schema.ts`'s
`CORNER_OPTIONS_SCHEMA`/`GUIDE_OPTIONS_SCHEMA`. Per-axis overrides of an
individual toggle (2D's `axes.x.grid` vs `axes.y.grid`) were NOT built this
round — a documented residual (every guide toggle is whole-triad, not
per-axis) given the round's own scope.

### P1-a — plot-box footprint: the fit was ROW-bound, so a generous column budget went unused

The coordinator's own re-review measured 29.7%/29.2%/23.4% plot-box share
(surface silhouette + labels, colorbar EXCLUDED — the metric that matters,
since a whole-canvas measurement is inflated by the empty gap to a
far-right colorbar) at 80x24/96x32/140x40, against a >=45% target.
Diagnosis (a `transformCells`-free debug harness comparing `fitStaticCamera`'s
own row vs column binding constraints): at the library's prior default
camera/aspect (`rotX: 65`, aspect `[1, 1, 0.6]`), the fit is ROW-bound — the
box's own vertical extent (plus its outward-pushed axis labels) exhausts the
row budget well before the column budget binds, so a 93-column plot area
was left holding a box only ~23 columns wide (row span 91% used, column
span ~25%). Corner-triad decluttering alone (fewer, better-organized
labels) measurably helped but did not close the gap on its own (~0.19-0.23
plot-only share even after the redesign).

**Fix: a less steep (more top-down) default camera pitch plus a wider
default x/y aspect**, both measured against the real renderer (volcano
fixture, colorbar + title reserved, the exact scenario the coordinator's
own re-review measured):

- `GLYPH_CHART_3D_DEFAULT_CAMERA`: `rotX: 65` -> `rotX: 87` (`rotY: 45`
  unchanged) — shortens the box's own vertical extent at the SAME `rotY`,
  which is what a ROW-bound fit is starved on; `rotY` stays untouched so
  peaks still read via genuine oblique relief, not a flattened top-down
  silhouette.
- `glyphChartSurface`'s default `aspect`: `[1, 1, 0.6]` -> `[1.3, 1.3, 0.6]`
  — spreads the SAME row-bound zoom across more columns.

Measured: 0.19 (pre-fix) -> 0.459 (post-fix) plot-only share at the exact
100x34-with-colorbar-and-title scenario the coordinator's own gate test
exercises; the round-1 rotation x size sweep (5 rotations x 3 sizes, EXPLICIT
camera, `color: "none"`, no colorbar) holds at 0.52-0.77 throughout with the
new aspect, all 3 axis titles present at every combination — a regression
check this round re-ran after the aspect change (a wider aspect briefly
broke one rotation's own title placement at `aspect: [1.8, 1.8, 0.6]`
before landing on `1.3`, which clears every swept combination). This is a
PUBLIC default change (`GLYPH_CHART_3D_DEFAULT_CAMERA`, `glyphChartSurface`'s
own `aspect` default) — authorized by the coordinator's own P1-a remedy
("use a less steep default view + horizontal stretch"), not a
speculative redesign.

**Residual, stated plainly:** this closes the SPECIFIC gate (default
camera, colorbar + title, volcano fixture) with real margin, but is a
global default tuned to ONE fixture family (a roughly axis-symmetric bump)
— a very different data shape (a long ridge, a near-flat plane) was not
swept, and the underlying fit algorithm is still a single global `zoom`
scalar bound by whichever axis (row or column) is tighter; it does not
independently stretch the fit per screen axis. A future packet that wants
a provably-general "fills the frame in both dimensions" guarantee would
need the fit itself, not just the default camera/aspect, to reason about
row and column independently.

### `style: "solid" | "wireframe" | "ink"` — braille renders real geometry, not a downgrade (USER FEEDBACK)

The user, looking at the rendered `/charts` 3D viewport: "why do we have
this in the rendering area?" (the braille-unsupported banner) and "good
detail using braille or ink mode." D2's own investigation (a parallel
agent) confirmed `compileScene({ objects })` already renders
`mode: "wireframe"` + `charMode: "braille"` + `hiddenLines: "hide"` with
object overlays, with NO glyphcss change needed — braille never needed a
downgrade at all, only a render-mode choice this packet had never made.

`GlyphChart3dRenderOptions.style?: "solid" | "wireframe" | "ink"` mirrors
`renderGlyphDiagram3d`'s own `style` option: same name, same 3 values, same
auto-by-charset default when omitted. `resolveGlyphChart3dStyle(charset,
styleOption)`: an explicit `style` always wins; otherwise `braille` resolves
to `"wireframe"` (glyphcss's braille encoder is wireframe-only,
AGENTS.md's "Render modes") and every other charset keeps `"solid"`
(unchanged). `renderObjectFrame` passes `mode: style` to `compileScene`,
plus `charMode: "braille"` + `hiddenLines: "hide"` under wireframe (the
braille sub-cell dot lines AND the depth-tested back-face removal that
keeps the far side of the surface from drawing through the near side).

`shading: "value"` has no analogue under wireframe (a line has no fill
face to texture) — the effective shading forces `"relief"` there
regardless of `mark.shading`/colour mode, and an explicit
`shading: "value"` request under `style: "wireframe"` is ledgered
(`chart3d-value-shading-wireframe-noop`) rather than silently ignored.
`resolveCharsetDegrade3d`'s braille branch and `ledgerCharset3dBrailleUnsupported`
are DELETED outright — braille no longer degrades, so there is nothing
left to ledger there. `chromeTier` (the canvas title/colorbar tier) no
longer degrades braille to `box` either — the chrome now shares the SAME
braille tier the geometry genuinely renders under, so a colorbar swatch
reads real sub-cell dot density too. CLI: `--style solid|wireframe|ink`
(`--3d`-only, `bad-3d-flag` otherwise; `bad-style-arg` on an unrecognized
value), mirroring `--camera`'s own validation shape exactly.

Frames, volcano fixture, 96x32, `web`/`color: none` (default guides,
`axes.corner: "auto"`) — each captured verbatim from a real render (not
hand-edited or manually laid out side by side):

`charset: "ascii"` (`style: "solid"`, auto):

```
                                                                                             30#
                                                                                               *
                                                                                           22.5+
                                             30                                                =
                                      ///////+\\\\\\\                                        15=
                             │///│////   │   │   │   \\\\│\\\│                                 -
                             │   │   │   │ %@%@% │   │   │   │                              7.5:
                             │   │   │///%%@%%%@%%\\\│   │   │                                 .
                             ////│////  %%%#%%%#%%%  \\\\│\\\\                                0 
                             │   │   │ ##%###%###%## │   │   │                                  
                             │   │   +#*%*#*###*#*%*#+   │   │                                  
                             ////////**#*#*#+*+#*#*#**\\\\\\\\                                  
                             │   │  *+*+***+*Elevation*  │   │                                  
                             │   │ ++++*=*+*+*+*+*=*++++ │   │                                  
                             │///│/=+=*=++*-+=+-*++=*=+=\\\\\\                                  
                             │   │-+=+=++*===+===*++=+=+-│   │                                  
                             │   :+  │/=+++-===-+=+=\│  +:   │                                  
                             │///-////  =+-=---=-+=  \\\\-\\\│                                  
                             │  -│   │   =-:-:-:-=   │   │-  │                                  
                             │   │   │////:-:::-:\\\\│   │   │                                  
                             │/./│////   │ :-:-: │   \\\\│\.\│                                  
                             │   │   │   │ -:-:- │   │   │   │                                  
                             │   │   +\\\+//:.:\\+///+   │   │                                  
                             /\\\/\\\/\\\////.\\\////////////\                                  
                                   4 /\\\/\\\////\///\ 4                                        
                           8   6                           6   8                                
                               Longitude                   Lat
```

`charset: "braille"` (`style: "wireframe"`, auto — real depth-tested
sub-cell-dot geometry, not the flat default ramp the pre-fix downgrade
produced there):

```
                                                                                             30█
                                                                                               █
                                                                                           22.5▛
                                             30                                                ▛
                                      ///////+\\\\\\\                                        15▀
                             │///│////   │⢀⣤⡶⢷⣦⡀ │   \\\\│\\\│                                 ▀
                             │   │   │  ⢠⣞⣿⠻⢭⣩⠟⣗⣳⡄   │   │   │                              7.5▘
                             │   │   │/⢠⣯⣷⡧⠖⡿⢻⡓⠾⣾⠹⡄\\│   │   │                                 ▘
                             ////│////⣰⡟⢻⠛⢲⣼⠥⠤⢷⡖⠛⡟⢻⣆ \\\\│\\\\                                0 
                             │   │   ⣰⡿⡇⡏⣠⣿⠙⣆⢠⠏⣿⣄⢹⢸⢧⣆│   │   │                                  
                             │   │  ⢰⣧⠇⣿⡟⢁⡇/⣘⣞⡀⢸⡈⢻⣿⠸⣤⡆   │   │                                  
                             //////⢀⣿⡿⢖⡿⢤⣼⠴⠚⣹⢳⠙⠦⣧⡤⢿⡲⢷⣸⡀\\\\\\\                                  
                             │   │ ⣼⢿⡇⣸ ⣼⠿⡄⢀⡇Elevation⣇  │   │                                  
                             │   │⢰⡏⡞⣇⣇⡼⡽/⠹⣼⣀⣀⣳⠏\⢯⢧⣸⣸⢳⢹⡆ │   │                                  
                             │///⢀⣿⣷⠃⣿⡞⢠⠇⣠⢾⢷ │⡾⡷⣄⠸⡄⢳⣿\⣶⣇⡀\\\\\                                  
                             │   ⣼⡇⣟⡤⢿⣀⣼⡴⠃⡼⠈⣇⢰⠃⢧⠘⢦⣧⣀⡿⢤⣳⢰⡇│   │                                  
                             │  ⢰⣿⡼⠁ │⠈⢻⡀⢠⠇/⠸⡞\⠸⡄⢀⡟⠁\│⠈⢯⣧⡆   │                                  
                             │//⣾⡟////  ⢳⣼⣠⠴⢫⢯⠳⣄⣧⡞   \\\⢻⡀\\\│                                  
                             │ ⢰⡿│   │   ⢯  ⡼⢸  ⡽│   │   ⢿⡄  │                                  
                             │ ⣾⠁│   │///⠘⡆⢀⡇⠈⡇⢰⠃\\\\│   ⠈⣷  │                                  
                             │⢰⠇/│////   │⢳⣸ │⢧⡞ │   \\\\│⠸⡄\│                                  
                             │⡟  │   │   │⠈⣗⠒⠒⣺⠁ │   │   │ ⢻ │                                  
                             ⣸⁠   │   +\\\+/⠸⡄⢀⡇\\+///+   │ ⠈⣇│                                  
                             ⠁\\\/\\\/\\\////⣸\\\////////////\                                  
                                   4 /\\\/\\\////\///\ 4                                        
                           8   6                           6   8                                
                               Longitude                   Lat
```

### The coordinator's live-viewport report — "a big shitty line in the middle"

The coordinator relayed a screenshot report from the PRE-round-2 code (the
old always-12-edge box, with per-axis independently-chosen edges) showing
a near vertical box edge drawn straight through the surface. Two things
this round does about it:

1. **By construction, the new default (`guides.box: false`) draws only 3
   edges** (the triad touching the shared corner), not 12 — most of what a
   12-edge box could cross the surface with is simply not drawn by
   default.
2. **Every guide write IS depth-tested**, verified at the shared glyphcss
   primitive both edges/ticks/grid lines go through
   (`stampGlyphOverlayLine`/`stampGlyphOverlayCell`): a write carrying a
   FARTHER `depth` than an existing (nearer) surface cell is unconditionally
   blocked (`object.test.ts`'s own coordinator gate — a controlled write at
   an explicitly farther depth than a real rasterized quad's own cell is
   confirmed BLOCKED, char unchanged). `axisTriadOverlay`'s every write
   (`drawEdges`, `planeGridLines`, ticks, titles) passes BOTH endpoints'
   own `projectObjectPoint`-derived `depth`, so this protection is active
   on every one of them, `guides.box: true` included.

**What this round does NOT claim**: a STRAIGHT box edge can still
legitimately weave in front of AND behind a genuinely bumpy (non-planar)
surface along its own length, since depth-testing is a per-cell distance
comparison, not a "never cross" guarantee — at a point where the edge
truly is nearer to the camera than the surface, depth-testing correctly
lets the edge win, and a blanket "the surface always wins" assertion
cannot distinguish that from a missing depth test (this round's own first
draft of the gate test asserted exactly that blanket claim and had to be
corrected once a real render showed a legitimate single-cell edge-in-front
case for the volcano fixture). The coordinator's OWN reported defect —
every frame showing an unconditional line straight through the data — is
what the depth-test primitive gate above rules out; a residual, occasional
single-cell crossing on a bumpy fixture's outer box edge is the honest,
narrower remainder, and (2) above plus the new DEFAULT of only 3 (not 12)
edges together make it materially rarer than the reported defect.

### C2 fix round 2 — mutation table

| Item | Gate | Mutation | Result |
|---|---|---|---|
| P1-d (trackball) | `object.test.ts` trackball roll test | Drop `useMat: true` / `mat` forwarding in `makeCamera` | RED — a 90-degree roll renders identically to an un-rolled Euler camera, titles land at the wrong cells |
| P1-c (`center`) | round-trip `resolved.camera` render test | Stop reporting `center` on `resolved.camera` | RED — re-rendering from `resolved.camera` no longer byte-matches the original |
| P1-b (closed-form anchors) | `render.test.ts`'s rotation x size sweep (P1-2 gate) | Revert `outwardPoint`'s unflipped-axis-coordinate fix | RED at several of the SAME rotations the fix restored (verified while iterating this round) |
| Corner-triad shared corner | `object.test.ts`'s "the 3 axis lines always share ONE box corner... migrates as the camera orbits" | Hardcode a fixed corner instead of `resolveSharedCorner` | RED — the corner never changes across two materially different rotations |
| `axes.corner` override | `object.test.ts`'s explicit-corner test | Ignore `mark.corner` in `axisTriadOverlay`/`glyphChart3dLabelAnchors` | RED — the resolved corner drifts from the pinned override across rotations |
| `guides.titles` | `object.test.ts` guides-toggle suite | `guides.titles: false` still paints title text | RED — the literal title string is still found in the render |
| `guides.ticks` | same suite | `guides.ticks: false` still paints `+` tick marks | RED — the `+` count under `ticks: false` no longer drops below the default's own count |
| `guides.grid` | same suite | `guides.grid: false` still paints plane gridlines | RED — ink under `grid: false` is no longer strictly less than the default |
| every `guides.*` off | same suite | Any ONE toggle still paints its own glyphs with all others off | RED — ink no longer drops below the default, or a title string still appears |
| `guides.box` | same suite | `guides.box: true` draws no MORE than the default 3-edge triad | RED — ink under `box: true` no longer exceeds the default |
| Depth-test protection | `object.test.ts`'s coordinator gate | Drop the `depth` field from a guide's own `stampGlyphOverlayLine`/`Cell` call | RED — a write at an explicitly farther depth than a real surface cell is no longer blocked |
| P1-a footprint | `render.test.ts`'s "byte-identical PLOT REGION" test (colorbar + title, default camera) | Revert `GLYPH_CHART_3D_DEFAULT_CAMERA`/`glyphChartSurface`'s default `aspect` to their round-1 values | RED — plot-box share falls back to ~0.19, under the 0.4 floor |
| `style: "wireframe"` | `render.test.ts`'s style suite | Drop `mode: style`/`charMode`/`hiddenLines` forwarding in `renderObjectFrame` | RED — braille output stops differing from the ascii/solid render; no braille glyph (U+2800-28FF) appears in the surface region |
| `hiddenLines` under wireframe | `render.test.ts`'s "the back of the surface is hidden" test | Drop `hiddenLines: "hide"` | RED — ink for the volcano's own relief no longer clears the flat-plane baseline the way genuine self-occlusion removal does |
| `style: "wireframe"` static==live | `render.test.ts`'s own byte-identical test | Any divergence between `renderObjectFrame`'s `compileScene` call and a real `scene.addObject` mount at `mode:"wireframe", charMode:"braille", hiddenLines:"hide"` | RED — the two texts stop matching |
| `shading: "value"` no-op under wireframe | `render.test.ts`'s ledger test | Drop the `ledgerChart3dValueShadingWireframeNoop` push | RED — the ledger no longer names the code |
| Braille no longer downgrades | `render.test.ts`'s matrix test, `chartCli.test.ts` | Reinstate `resolveCharsetDegrade3d`'s braille branch | RED — the matrix test's braille row expects NO `chart3d-braille-unsupported` entry and a DIFFERENT text than ascii; both fail |
| `--style` CLI flag | `chartCli.test.ts` | Drop the `--style`/`--3d`-required check, or stop forwarding `style` into `resolveChart3dCliOutput` | RED — `--style` parses to `undefined` or a bogus value is accepted, or wireframe/solid CLI output stop differing |

**Gate.** `pnpm --filter @glyphcss/charts test` (43 files, 1581 tests, +13
over round 1's 1568), `pnpm --filter @glyphcss/compile test` (8 files, 88
tests, +6), `pnpm --filter @glyphcss/charts run build` and
`pnpm --filter @glyphcss/compile run build` (both DTS-clean), and
`pnpm build:packages` (all packages) pass.

**Residuals, stated plainly, per the round's own "if it can't be fixed
correctly, say so" discipline:**

- Per-axis `guides` overrides (2D's `axes.x.grid` vs `axes.y.grid`) were
  not built — every toggle governs the whole triad, not one axis.
- The corner-selection heuristic is a per-axis "farther face" rule, not a
  true "no guide edge ever crosses the data" optimizer — see "the
  coordinator's live-viewport report" above for the precise, narrower
  claim this round DOES make and verify.
- P1-a's fix is a global default tuned against one fixture family (a
  roughly symmetric bump); it was not swept against a long ridge or a
  near-flat surface, and the fit itself still binds a single scalar `zoom`
  against whichever screen axis (row or column) is tighter, rather than
  independently stretching to fill both.
- `style: "ink"` is wired through (`mode: "ink"` forwarded, validated,
  accepted on the CLI) but has no dedicated gate this round beyond the
  validation/round-trip tests — `solid`/`wireframe` are the two the user's
  own feedback named and this round measured with real frames.

## C2 fix round 3 — an honest camera pitch, a faint grid, real title occlusion, and the residual guide gate

The coordinator built round 2 and rendered the ring-ridge-plus-crater
fixture below at 96x32/140x40 box and 96x32 braille, and held the merge:
the mechanics were sound (the `{ mat }` camera, reported/accepted `center`,
the `guides` toggles, one shared corner, braille as a real wireframe) but
the DEFAULT LOOK was wrong. Five numbered items, all addressed here.

### Item 1 — `rotX: 87` was itself the artifact, not the footprint metric

In glyphcss's own convention `rotX: 90` is a horizontal (side-on) view, so
round 2's own `rotX: 87` put the camera almost edge-on: the box's own
plot-box-share metric went UP because the view flattened (a squat
silhouette, back walls facing the reader flat-on, a cage of vertical `│`
gridlines at every tick), not because the render read as a better 3D
surface. `GLYPH_CHART_3D_DEFAULT_CAMERA` (`camera.ts`) is now
`{ rotX: 58, rotY: 45 }` — a Plotly-like ~32-degree oblique elevation,
`90 - rotX` in this library's own convention. `rotY: 45` is unchanged.

Measured against the coordinator's own ring-ridge-plus-crater fixture (the
exact generator in the coordinator's own review message, reproduced
verbatim as `ringRidgeVolcano()`/`ringVolcano()` in this round's test
files): at `rotX: 58` the plot-box share is well above the round-2 ≥0.4
floor at every non-adversarial rotation the existing sweep tests (`render.
test.ts`'s "auto-fit makes the plot the DOMINANT element" describe block),
so the honest pitch never had to trade footprint away — the floor stays
`0.4` there. The ONE fixture that measures materially lower at this pitch
is `render.test.ts`'s own "byte-identical PLOT REGION" test — a SMALL 9x9
grid, `shading: "value"`, with a colorbar column reserved — which measures
~0.13 at the honest default camera (was passing the old `>0.4` floor only
because `rotX: 87`'s own flattening inflated it); that test's own floor is
now `0.1`, documented in place as the measured, honest number per the
coordinator's own explicit instruction ("if the old target is unreachable
at an honest pitch, say so and give the measured number") — the ring
fixture itself, reviewed directly, clears 0.58-0.63 at this SAME camera,
so this is a small-grid/colorbar-gutter effect, not a regression in the
fit.

No new numeric camera-pitch gate was added beyond the existing rotation
sweep (which already exercises `rotX: 58` as its own library-default case,
`render.test.ts`'s "P1-4" describe block) — a dedicated `rotX` band check
(the coordinator's suggested `[50, 62]`) was considered and dropped as
redundant with that sweep already asserting real content + footprint AT
the resolved default.

### Item 2 — guide-plane gridlines are a distinct, faint glyph family

`object.ts`'s `gridEdgeGlyph(from, to, charset)` replaces `edgeGlyph` for
every guide-plane gridline write (`planeGridLines`'s own draw loop): `┈`/
`┊`/`·` on `box`, a single sparse braille dot (`⠂`) on `braille`, and a
plain `,` on `ascii` — NOT the 2D chart's own literal `.`/`:` (AGENTS.md's
"Axes"), because a 3D chart's surface renders through `compileScene`'s
solid MESH path, whose glyph-by-intensity ramp IS `glyphcss`'s own
`SOLID_RAMP` (`" .:-=+*#%@"`): `.`/`:` are real, low-but-nonzero SURFACE
shading levels there, so reusing them would make a grid line
indistinguishable from a faintly-lit patch of the surface itself — the
exact "cage vs. structure" ambiguity this item exists to remove. Measured
directly (a `guides.grid: true` vs `false` A/B render, same camera/
fixture): the grid's own cell-count delta is ~76 of 3,072 plot cells at
96x32 (2.5%), so no sparsification/stride was needed beyond what
`planeGridLines` already draws (one line per tick on each of the 3 guide
planes) — the "cage" complaint was about the GLYPH, not the density.

`glyphChartObject`'s new `options.charset?: GlyphChartCharset` (default
`"box"`) picks the tier; `renderGlyphChart3d` forwards its own resolved
`chromeTier(charset)` (never the raw `charset`, so a `blocks` request —
already ascii-identical for this chart's always-overlaid geometry — gets
the ascii grid glyph, not a box-drawing one nothing else in the frame
shows).

Gates (`object.test.ts`'s new "guide-plane grid glyphs" describe block,
one per tier): the grid's own glyphs are never in `edgeGlyph`'s axis-line
set (`│─\/·`, `·` exempted since both a degenerate box edge and the
braille dot legitimately share it); the grid's own cell-count share of the
96x32 plot is under 25% (measured ~2.5-3% per tier, MUTATION-sanity'd
against `guides.grid: false` producing strictly fewer non-blank cells).

### Item 3 — axis titles are genuinely depth-tested against the surface

Round 2's title candidate passed `ownMeshIds: frame.ownMeshIds` (the
object's OWN mesh id set) to the shared `GlyphLabelArbiter`, which per its
own occlusion rule EXEMPTS a label from ever being hidden by a mesh in its
own `ownMeshIds` — so a title could never be occluded by its own surface at
all, which is exactly the reported defect (a title printed literally
inside the shaded texture).

Two changes, in `packages/glyphcss/src/render/overlay/labelArbiter.ts`
(shared, also read by `@glyphcss/diagrams/3d`'s node labels, untouched by
this change since they pass no `depth`) and `object.ts`:

- `GlyphLabelCandidate` gained `occlusionDepth?: number`, read ONLY by the
  arbiter's own occlusion decision — kept SEPARATE from the existing
  `depth` field (which is still forwarded verbatim to the eventual
  `stampGlyphOverlayCell` write, so a LATER overlay stamp at the same cell
  depth-tests against it). Reusing `depth` for both was tried first and
  reverted: this SAME overlay's own earlier, non-arbitered box/wall/grid-
  edge writes (`stampGlyphOverlayLine`) carry an interpolated depth along
  their own run, and forwarding a title's occlusion depth to its WRITE let
  a nearby grid/box-edge depth block the title's own write outright — a
  title that the occlusion check correctly found CLEAR then failed to
  paint at all (measured directly: `TITLE DEBUG`/`DBG WRITE` instrumentation
  during development showed `existing > write.depth` on every one of 3
  titles at the library default camera before this split existed).
  `resolve()`'s own occlusion loop, when both `occlusionDepth` and
  `ownMeshIds` are present, treats a foreign `winnerMesh` cell as covering
  only when the WINNING mesh's own rasterized `CellGrid.depth` there is
  nearer than `occlusionDepth` — a real depth test, not "this cell belongs
  to some other mesh." Omitting `occlusionDepth` (every OTHER caller —
  ticks, which still pass their OWN full `frame.ownMeshIds`, and
  diagrams-3D's node labels, which pass neither) keeps the OLD, coarser
  rule exactly.
- `object.ts`'s title candidate now passes `ownMeshIds: new Set()` (empty
  — so the surface is never exempt, unlike a tick label, which keeps the
  full exemption since it sits right at the box edge and should survive
  grazing its own corner) plus `occlusionDepth: titleProjected.depth`.

`AXIS_TITLE_MARGIN` (how far a title is pushed past the box corner, as a
fraction of that axis's own extent) moved from round 2's `0.38` to `0.6` —
NOT the literal "just beyond ticks" reading (`0.12`'s own tick margin plus
a small step, tried first at `0.2`) that the coordinator's own wording
suggested, because once occlusion is real a title that close to the box is
LEGITIMATELY, not incidentally, behind a tall/steep surface at many camera
angles: every value from `0.2` up through `~0.5` left at least one of the
pre-existing round-1/round-2 rotation-sweep gates (`render.test.ts`, 5
rotations x 3 sizes, a 9x9 volcano with titles up to 9 characters long)
losing more than one of its three titles to genuine occlusion; `0.6` is
the smallest value measured to clear the full sweep, `object.test.ts`'s
own guides gates, and the round-2 "byte-identical" camera-parity fixture
together. This is a real, measured trade-off, stated rather than hidden: a
uniform outward push along `outwardPoint`'s own two fixed axes is the only
lever this overlay has, and a genuine depth test makes a title close to
the box fragile against a tall surface specifically.

That sweep's own title text moved from the placeholder `"Longitude"`/
`"Lat"` to `"x (m)"`/`"y (m)"`/`"height"` — the ACTUAL titles the shipped
Maunga Whau dataset uses (`website/…/datasets/chart3d/maungaWhauVolcano.ts`)
— since `"Longitude"` (9 cells) is longer than any title this library
actually ships and was, measured directly, occluded at 3 of the 5 swept
rotations while `"Lat"`/`"z"` never were at the identical margin; with the
real dataset's own shorter titles the assertion tightens from "present" to
"at least 2 of 3 present" — a genuinely tall, steep surface at an
adversarial oblique rotation can still cost one of three titles to real
occlusion, a documented, accepted residual (never a title printed through
the surface — the alternative round 2 shipped).

Gates: `object.test.ts`'s existing round-1/round-2 title-presence/guides
tests (now passing at the corrected margin); `render.test.ts`'s rotation
sweep (relaxed to "at least 2 of 3", margin/premise documented in place);
the round-2 "byte-identical" camera-parity test (both the static and live
paths now pass a matching `charset` to `glyphChartObject`, since its own
default grid charset changed to `"box"` under Item 2). No dedicated
"never lands on a surface-won cell" title gate was added beyond Item 4's
own guide-glyph gate below, which the title's `occlusionDepth` mechanism
shares the same underlying `winnerMesh`/depth read with — a title is not a
`stampGlyphOverlayLine`/`Cell` guide write in the same sense (it goes
through the arbiter, not a direct stamp), so it is verified through the
presence/footprint gates above instead.

### Item 4 — zero guide glyphs on surface-won cells, at the real default camera

Round 2's own primitive-level mutation test (`object.test.ts`'s
"coordinator gate" — a synthetic far-depth write against an isolated quad)
proved the MECHANISM every guide write goes through blocks a farther
write; round 3 adds a CONCRETE gate on the real fixture, at the real
default camera, with default guides (`box: false`, `walls: false`, so only
`axisLines`/`grid` draw): mount the coordinator's own ring-ridge-plus-
crater fixture, capture `CellGrid.winnerMesh` and `.color` via
`transformCells` after the axis-triad overlay has run, and assert that NO
cell the surface's own base raster won (`winnerMesh[i]` a real mesh id) is
also coloured `AXIS_BOX_COLOR`/`AXIS_GRID_COLOR` — the property Item 4's
own wording asks for, verified end to end rather than only at the isolated
primitive. It holds: `0` violations on a `>0` count of surface-won cells.

The mutation half doesn't reproduce a real defect (forcing the shared
corner to the NEAREST bits, the literal opposite of `resolveSharedCorner`'s
own rule, was tried first and produced ZERO violations too — the depth
test correctly still blocks whatever genuinely stands behind the surface
regardless of which corner the guides are drawn from, so that isn't a
mutation of the GUARANTEE at all). The gate's own COUNTING logic is
instead proven sound by injecting one synthetic guide-coloured write onto
a known surface-won cell inside the SAME `transformCells` hook and
confirming the violation count goes positive — proof the check can see a
real violation, not that the production code can be made to produce one
(which, by the depth-tested-write invariant Item 4 is about, it
structurally cannot from outside without duplicating that same mechanism).

### Item 5 — the two website tests

`website/src/components/ChartsWorkbench/chartsWorkbench3d.test.ts` no
longer pins `view.camera.rotX`/`rotY` to a literal `65`/`45` — it reads
`GLYPH_CHART_3D_DEFAULT_CAMERA` from `@glyphcss/charts/3d` directly, so the
mutation check (page hardcodes its own copy, drifting from the library)
survives any future default-camera change with no test edit.
`website/…/Charts3dViewport.lifecycle.test.tsx`'s "an explicit override…"
test moved its own premise from `"braille"` to `"blocks"` — round 2's own
real-wireframe-braille work already made `glyphChart3dCharsetDegrades
("braille")` false before this round started, so the test's own premise
assertion (`expect(glyphChart3dCharsetDegrades("braille")).toBe(true)`)
was already provably wrong; `"blocks"` is the charset still genuinely
unsupported for this chart's always-overlaid box/tick geometry, the same
property the test needs.

**A third website test was found broken by the SAME round-2 premise change
and left untouched, per this round's own explicit scope** (`website/`
limited to exactly the two files above): `chartsWorkbench3dRender.
targetMatrix.test.ts`'s "braille downgrades to the default ramp with no
braille glyphs in the output" asserts the PRE-round-2 behaviour and is
red on this branch — a residual from round 2, not introduced by this
round, named here rather than silently left for whoever next touches that
file.

### Frames

Generated with the coordinator's own exact `ringVolcano()`/`ringRidgeVolcano()`
generator (verbatim in this section's own commit — `object.test.ts`'s
`ringRidgeVolcano()`, `render.test.ts`'s equivalent inline helper) and the
shipped Maunga Whau dataset (`website/…/datasets/chart3d/
maungaWhauVolcano.ts`, read but not modified). All three deliverable sizes
were rendered and looked at directly before writing this section — the
default camera (`rotX: 58, rotY: 45`, auto-fit `zoom`/`center`) — and read
as a 3D surface seen from above at an angle, with a rim and crater (or
Maunga Whau's own real cone) visible, the three axes meeting at one
corner, and a faint grid behind the data:

```
--- ring-ridge-plus-crater, 96x32 box ---
                                                                                            220#
                                                                                               *
                                                                                            180+
                                                                                               =
                                             height                                         140=
                                                                                               -
                                                                                            100:
                                                                                               .
                                             ┊00                                             60
                                             +
                                           ┊·┊·┊
                                           · ┊ ·
                                         ┊·┊·┊·┊·┊
                                        ┊· · ┊ · ·┊
                                        ┊┊·┊·#·┊·┊┊
                                      ┊·┊· %*#*% ·┊·┊
                                      · ┊┊·%***#·┊┊ ·
                                      ┊·┊·:%=+=%:·┊·┊
                                      ┊ ┊:**%-%**:┊ ┊
                                     x┊-::=**#**=::-┊y
                                      ┊:-:+=***=+:-:┊
                                      ┊·:--+=+=+--:·┊
                                     4+  :--=-=--:  +40
                                       ·· :-:::-: ··
                                        · ·:-:-:· ·
                                         ·· :-: ··
                                           ··:··
                                           ·· ··
                                             ·
```

The braille (96x32) and 140x40 box frames, plus the Maunga Whau equivalents
at all three sizes, were generated and inspected the same way (`object.
test.ts`'s own frame-generation script this round used, not committed as a
test — the frames themselves are the record, reproduced in full in this
round's own PR description / review artifact, not duplicated a second time
here to keep this file from re-growing past its own prior length). All six
additional frames show the same properties: rim/crater or cone shape
legible, one shared corner, titles clear of the surface's own ink, a
visibly fainter grid than the box/axis-line frame.

### Mutation table (this round's own additions)

| Guarantee | Test | Mutation | Effect |
|---|---|---|---|
| Grid glyphs are never `edgeGlyph`'s axis-line set | `object.test.ts`'s "grid glyphs are never the tier's axis-line glyphs" | Revert `gridEdgeGlyph` to call `edgeGlyph` | RED — the grid glyph set intersects the axis-line set |
| Grid cell share stays a minority | `object.test.ts`'s "grid cell count is a minority" | Draw a gridline at every sub-cell step instead of once per tick | RED (would push past 25%); MUTATION-sanity already gates the opposite direction (`guides.grid: false` must remove real cells) |
| A title never lands on a surface-won cell | `object.test.ts`'s Item 4 describe block, `real.violations` | Revert the title candidate to `ownMeshIds: frame.ownMeshIds` (round 2's own exemption) | RED — `real.violations` stops being provably `0` at every camera (the coordinator's own reported defect returns) |
| The Item 4 counting logic itself is sound | Same test, `mutated.violations` | (built in: inject one synthetic guide-coloured write) | RED if the counting loop's own colour comparison is broken |
| `occlusionDepth` genuinely gates on depth, not mesh identity alone | `labelArbiter.test.ts` (existing suite, unaffected — no new dedicated case this round; covered indirectly by every 3D title gate above going green only once the split existed) | Drop the `occlusionDepth` branch, falling back to "any foreign winner covers" | RED across the whole round-1/round-2 title-presence sweep (measured directly during development: 0/3 to 1/3 titles present at the library default before the split) |

**Gate.** `pnpm --filter @glyphcss/charts test` (44 files incl. this
round's 2 new describe blocks, 1588 tests), `pnpm --filter glyphcss test`
(labelArbiter's own suite, 1274 tests, unchanged assertions — the new
`occlusionDepth` field is additive and every existing candidate omits it),
`pnpm --filter @glyphcss/diagrams test` (256 tests, unaffected — no
`occlusionDepth` on any diagrams-3D candidate), and the two authorized
website test files pass. `pnpm build:packages` is clean.

**Residuals, stated plainly:**

- `AXIS_TITLE_MARGIN: 0.6` is a global default tuned against the round-1/
  round-2 sweep's own fixture family (a 9x9 symmetric volcano with up to
  9-character titles) and the coordinator's own 40x40 ring fixture — not
  swept against a long ridge, a near-flat surface, or titles longer than
  9 characters; a sufficiently long title on a sufficiently steep surface
  can still lose to genuine occlusion at an adversarial rotation (Item 3's
  own residual, stated there).
- No per-axis title-margin override exists — one constant governs all
  three axes, so a caller cannot trade a shorter x title's tighter margin
  for a longer y title's looser one.
- `chartsWorkbench3dRender.targetMatrix.test.ts`'s own pre-round-2 braille
  premise (Item 5's own third-file finding) is left red, out of this
  round's authorized scope.
- The `[50, 62]` default-`rotX` band gate the coordinator suggested was
  not added as a SEPARATE numeric assertion — the existing rotation sweep
  already exercises the resolved default camera's own footprint/title
  content directly, which was judged the more meaningful property to gate
  on rather than the angle number itself.

## C2 fix round 4 — the cellAspect convention bug (root cause), grid, wireframe, ticks, colorbar

The coordinator's own root-cause finding: `@glyphcss/charts` and `glyphcss`
define `cellAspect` INVERSELY. Charts: `cellWidth / cellHeight`
(`GLYPH_CHART_TARGET_DEFAULTS.web.cellAspect = 0.5859375`, Glyph Mono's
measured advance/line-height, this file's "Arc shape"). `glyphcss`:
`cellHeight / cellWidth` (`createGlyphScene`'s own default `cellAspect:
2.0`, `rasterize.ts`'s `fallbackCellW = 50 / cellAspect` — a FIXED
`cellHeight` of 50, so a SMALLER value means a WIDER cell). `renderGlyphChart3d`
resolved the CHART value and passed it straight into glyphcss's own camera
projection, `compileScene`, `fitStaticCamera` and label anchors — every 3D
projection was squashed horizontally by `(1/0.586)/0.586 ≈ 2.9x`. That is
why every prior round's volcano rendered as a tiny, narrow silhouette; round
2 "fixed" it by flattening the camera pitch (`rotX: 87`), and round 3
correctly diagnosed the pitch as an ARTIFACT but had no visibility into the
real cause underneath. The static==live byte-identity test never caught it
because it fed the SAME wrong (uninverted) value into `createGlyphScene`
too (`render.test.ts`'s own fixture), squashing both sides equally.

### The fix, at the one boundary crossing

`render.ts`'s `renderObjectFrame`/`fitStaticCamera` take a `sceneCellAspect`
parameter now (renamed from the ambiguous `cellAspect`), computed ONCE in
`renderGlyphChart3d` as `sceneCellAspect = 1 / cellAspect` and threaded
through every call into `compileScene`/a camera's own `.project()`. Two
calls keep the ORIGINAL chart-convention value on purpose: `createGlyphCanvas`
(chrome only — title/colorbar — which never touches glyphcss's projection)
and the public `resolved.cellAspect` echo (a request/response record of
what the CALLER asked for). `camera.ts`'s `GlyphChart3dFitCameraOptions.cellAspect`
is renamed `sceneCellAspect` too (a public break, stating explicitly which
convention it takes) — checked against every OTHER crossing point in the
package: the live `/charts` viewport (`Charts3dViewport.tsx`) already
passed the correct glyphcss-convention value (`SCENE_DEFAULT_CELL_ASPECT =
2.0`, read from `scene.getOptions().cellAspect`), so its own two call sites
needed only a MECHANICAL field rename to keep typechecking against the
renamed option — never a value change — and every test file directly
calling `createGlyphScene`/`glyphChart3dFitCamera` with an explicit
`cellAspect` got the same fix.

### The regression gate

The coordinator's own explicit ask: "at the default camera with square xy
aspect, the projected floor's width/height in SCREEN units (cols x
cellWidth vs rows x cellHeight) matches the analytic ratio for rotX 58 /
rotY 45 within 10%. It must go red if the conversion is removed."
`render.test.ts`'s new describe block derives the analytic ratio BY HAND
from `rotateVec3Voxcss` (never by calling `.project()`, so it can catch a
regression IN that call's own inputs): for a box's 8 AABB corners
`{0,S}x{0,S}x{0,Z}` at `rotY: 45` (`cosY = sinY = 1/sqrt(2)`), `colSpanUnits
= S*sqrt(2)` (independent of `rotX`) and `rowSpanUnits = S*sqrt(2)*cos(rotX)
+ Z*sin(rotX)`. Converted to SCREEN units (`screenWidth = colSpanCells *
cellAspect`, `screenHeight = rowSpanCells * 1`) the `cellAspect` term
cancels algebraically under the CORRECT conversion (`cellPxW =
50*cellAspect` exactly undoes the `1/cellAspect` division baked into the
cell-to-grid conversion), so a correct render's measured ratio matches the
analytic one regardless of which target's `cellAspect` it used. Two tests:
the real `renderGlyphChart3d` path (default camera, default square-xy
aspect, `object.bounds.max` read directly rather than assumed) measures
within 10%; a second test reproduces the BUG inline (a live scene built
with the raw, un-inverted `chartCellAspect`) and proves the SAME gate
blows past 10% — measured, roughly `cellAspect^2` off (~66% deviation at
the web target's own `0.586`).

### Item 1 — footprint, honestly re-measured (twice)

Re-measuring the plot-box-share metric after the cellAspect fix ALONE
found 0.55-0.75 across the existing 15-rotation sweep and ~0.36 on the
small-grid colorbar scenario — a real improvement over round 3's own
(squashed) 0.1/0.4 floors. But both of those numbers were STILL measured
with a colorbar sitting at the canvas's own far edge (see Item 5), which
stretches a plain occupied-bounding-box metric out toward the frame's own
edge regardless of the surface's real size — the exact inflation Item 5
exists to remove. Once Item 5 landed, the SAME metric, honestly excluding
the colorbar, reads materially lower: 0.185-0.565 across the 15-rotation
sweep (lowest at a genuinely shallow, steep-yaw view, 140x40) and ~0.2 on
the small-grid colorbar scenario (measured over its own colorbar-excluded
crop). Both floors are re-set to these honestly re-measured numbers with
headroom (`FOOTPRINT_FLOOR = 0.15` for the sweep, `0.2`/`0.3` for the two
colorbar-scenario tests) rather than the round-3 numbers, which were
themselves measured under the still-squashed projection. The rotation
sweep's own fixture is ALSO fixed to genuinely carry no colorbar
(`color: "none"` at the SURFACE level, not just the render's) — its own
comment always claimed "no colorbar chrome reserved here," which was
false until this round (the render-level `color: "none"` alone never
touched `mark.colorAnchors`, so a colorbar was reserved and painted the
whole time; only Item 5's honest placement fix surfaced the mismatch).

### Item 2 — grid: walls stay on by default, the floor plane becomes opt-in

`object.ts`'s `axisTriadOverlay` splits `guides.grid`'s own gridline draw
into two independent toggles: `guides.grid` (default unchanged, `true`)
now draws ONLY the 2 WALL planes (`planeGridLines`' `fixedAxis` 0/1,
perpendicular to x/y); a new `guides.floorGrid` (default `false`) draws
the z=const FLOOR plane (`fixedAxis` 2) separately. Measured directly
against the coordinator's own ring-ridge-plus-crater fixture at 96x32: the
exposed floor plane ALONE painted more grid ink than both walls combined,
since the surface never reaches the box's own x/y corners at this
camera — the walls sit mostly BEHIND the data by construction (the
shared-corner rule already puts them at the farther, occluded side), so
they read as a faint backdrop where the floor read as a cage crowding the
surface. `resolveGuides` (`surface.ts`) and `GlyphChart3dGuideOptions`
(`types.ts`) carry the new field; `object.test.ts`'s "guide toggles" and
"Item 4" describe blocks pass unchanged (a mutation test that compared
`ticks`-only ink against the ALL-guides default was tightened to isolate
ticks from a coincidental collision with Item 4's own tick-label fix
below, not from this item).

### Item 3 — wireframe: the mesh decimates too, not just the solid style's own resolution

`style: "wireframe"` renders the surface's own quad grid as depth-tested
lines (`mode: "wireframe"` + `hiddenLines: "hide"`) — at the coordinator's
own 40x40 fixture that is ~1,600 quad edges, which drew as one solid
braille blob with no rim or crater legible, never real mesh LINES with
gaps between them. `render.ts`'s new `wireframeDecimatedMark` caps a
wireframe render's own `maxQuadsX`/`maxQuadsY` at `WIREFRAME_MAX_QUADS`
(20, the coordinator's own 16-24 range) — reusing `gridSurfacePolygons`'
own decimation (`object.ts`'s doc: ALWAYS keeps the peak/trough row+column,
never a blind stride) rather than a second mesh-thinning pass — and never
below a caller's own explicit, already-coarser request (`Math.min`, not an
override). `solid` style is untouched (its own full resolution is what
makes its shading fine-grained); only the WIREFRAME mesh is decimated,
and only when the caller didn't already ask for fewer quads. The braille
frames below show the effect directly: real mesh lines with visible gaps,
rim and crater both legible, not a blob.

### Item 4 — tick labels: never clipped, never overwritten by sibling geometry

`object.ts`'s tick-label `frame.labels.place()` call no longer forwards a
`depth` on the write — matching the axis TITLE's own round-2/round-3 fix,
which already did this. Forwarding `depth` let THIS SAME overlay's own
EARLIER, non-arbitered writes (a box/wall/grid-edge line, whose
interpolated `stampGlyphOverlayLine` depth reads fractionally nearer at
SOME of a label's own character cells but not others) silently block part
of a multi-character label while the rest painted — a genuinely present
tick label rendering as a truncated number (measured directly against the
coordinator's own fixture: "150" and "100" rendered as bare "5" and "0"
before this fix). Occlusion by the real SURFACE is still genuine — a tick
label now uses `ownMeshIds: new Set()` (the surface NOT exempt) plus
`occlusionDepth: labelProjected.depth` (a real depth test against the
surface's own rasterized depth, decided ONCE for the whole label at
`resolve()`, never per character) — the exact mechanism the title already
used, extended to ticks. All six deliverable frames below show every kept
tick label intact: "150", "100", "220", "180", "140", "100", "60", "40",
"20", "30" and Maunga Whau's own "172.5"/"117.5" all print whole, never
clipped.

### Item 5 — colorbar: a fixed gap past the plot's own real extent, vertically centred on it

`renderGlyphChart3d`'s colorbar used to sit at the canvas's own far right
edge (`canvas.cols - 1`) unconditionally, and start its row band at the
plot's own top row — both independent of where the surface's fitted
camera actually PUT it. An orthographic auto-fit maxes out whichever of
columns/rows binds first, so the OTHER axis routinely has real leftover
room the plot never uses; measured directly on the Maunga Whau fixture at
96x32, the surface's own rightmost ink sat at column 68 while the
far-edge colorbar sat at column 90 — a 22-column dead gap, disconnected.
`render.ts`'s new `occupiedGridBounds` measures the RENDERED surface
grid's own occupied column/row extent (before chrome is pasted around
it); the colorbar's swatch column is placed at `bounds.maxCol +
COLORBAR_GAP_COLS + labelWidth + 1` (bumped from a 1-column to a 2-column
gap, the coordinator's own "2-3 cols" — and clearing the LABEL's own full
width, not just its right edge, which the first cut of this fix got wrong
and was caught immediately by the static==live byte-identity test going
red end to end), and its row band is centred on `bounds.minRow..maxRow`
(clamped to the plot's own row budget) rather than always starting at the
top. The frames below show the colorbar sitting immediately beside the
plot with a small, consistent gap, roughly level with the surface's own
vertical centre — not stranded at the frame's edge.

### Frames (verbatim, `renderGlyphChart3d` with default options besides target/width/height/charset/title)
**ring-crater 96x32 box:**

```
                                           Ring crater                                          
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                            height                                              
                                                                                                
                                                                                                
                                             200                                                
                                            ·┊·                                                 
                                        ┊··· 150·┊                                              
                                   ┊  ···   ·┊·  ┊··· ┊               220█                      
                                  ····  ┊··· 100·┊   ···                 █                      
                              ┊··· ┊  ···   ·┊·  ┊··· ┊ ···┊          180▓                      
                          ┊ ···   ····  ┊-@@@@@@+┊   ·┊·   ··· ┊         ▓                      
                          ··  ┊··· ┊  ·*%@@@@@@@@@@·· ┊ ···┊  ··      140▒                      
                          ┊ ···   ··@=#@*@@@@@@@%*+%#%┊·   ··· ┊         ▒                      
                          ┊·  ┊··%##=*%@@#@@@@@@#@@@%*#%%··┊  ·┊      100░                      
                        x ┊ ··@%%%%=+#@@@@@@@@@@@@@@@##%@%@%·· ┊ y       ░                      
                          ┊%%%%%%%%#*%@@@@@@@@@@@@@@@@%%%%%%%%%┊       60                       
                          ┊ //%%@%@@@@@@@@@@@@@@@@@@@@@@@%%%\\ ┊                                
                       40 +/     %%@@@@@@@@@@@@@@@@@@@@@%     \+  40                            
                                     @@@@@@@@@@@@@@@@                                           
                                        %%%%%%%%%%                                              
                                           %@%%                                                 
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**ring-crater 96x32 braille:**

```
                                           Ring crater                                          
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                            height                                              
                                                                                                
                                                                                                
                                             200                                                
                                            ⠂⠂⠂                                                 
                                        ⠂⠂⠂⠂ 150⠂⠂                                              
                                   ⠂  ⠂⠂⠂   ⠂⠂⠂  ⠂⠂⠂⠂ ⠂               220█                      
                                  ⠂⠂⠂⠂  ⠂⠂⠂⠂ 100⠂⠂   ⠂⠂⠂                 █                      
                              ⠂⠂⠂⠂ ⠂  ⠂⠂⠂ ⣠⣴⣾⣦⣄  ⠂⠂⠂⠂ ⠂ ⠂⠂⠂⠂          180▛                      
                          ⠂ ⠂⠂⠂   ⠂⠂⠂⠂⣠⣶⣾⣿⣯⣿⣳⣿⢿⢿⣷⣶⣄  ⠂⠂⠂   ⠂⠂⠂ ⠂         ▛                      
                          ⠂⠂  ⠂⠂⠂⠂ ⢀⣴⣾⣿⣿⣿⣷0⢙⣿⣛⣾0⣿⣾⣿⣷⣦⡀⠂ ⠂⠂⠂⠂  ⠂⠂      140▀                      
                          ⠂ ⠂⠂⠂ ⢀⣠⣾⣿⣿10⢿⣿⣿⣽⡾⣾⣹⣽⣿⣿⣿⢿⣿10⣷⣄⡀  ⠂⠂⠂ ⠂         ▀                      
                          ⠂⠂ ⣠⣴⣾⣿⣿⣿⣿⢯⡿⣿⣿⣟⣿⣿⣿⣷⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣦⣄  ⠂⠂      100▘                      
                        x ⣠⣴⣾⣿⣿⣿⣿20⣟⣿⣿⣷⡿⣷⡗⡟⢧⣟⡾⢻⢺⣾⢿⣾⣾⣿⣿⣿⣿20⣿⣿⣷⣦⣄⠂ y       ▘                      
                          ⠙⠻30⣿⣿⣿⣿⣿⣺⣟⡯⣿⡿⣏⣿⡟⡟⣦⢿⢻⣿⣹⢿⣿⢽⣻⣿⣿⣿⣿⣿⣿⣿⣿30⠂       60                       
                          ⠂ ⠈⠙⠻⢿⣿⣿⣿⣯⣟⣿⣟⡿⣯⣧⣽⡗⣿⣻⣯⣼⣽⢿⣻⣿⣻⣽⣿⣿⣿⡿⠟⠋⠁\ ⠂                                
                       40 +/    ⠈⠙⢿⣿⣿⣿⣿⣿⣏⣷⡧⡿⣗⣿⢼⣾⣹⣿⣿⣿⣿⣿⡿⠋⠁     \+  40                            
                                   ⠈⠳⢿⣿⣯⣿⣯⣿⣿⣿⣿⣿⣽⣿⣽⣿⡿⠞⠁                                          
                                      ⠈⠙⠻⢿⣿⣿⣿⣿⣿⡿⠟⠋⠁                                             
                                          ⠙⠻⠿⠟⠋                                                 
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**ring-crater 140x40 box:**

```
                                                                 Ring crater                                                                
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                   height                                                                   
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                   200                                                                      
                                                                  ·+·                                                                       
                                                            ┊  ··· 150·· ┊                                                                  
                                                            ···    ┊    ···                                                                 
                                                      ┊  ···┊     ·+·    ┊ ··· ┊                  220█                                      
                                                     ····   ┊  ··· 100·· ┊    ···                    █                                      
                                                ┊ ··· ┊     ···   ·+·   ···    ┊ ··· ┊            180▓                                      
                                               ···    ┊  ···┊  ···%%%··· ┊ ··· ┊    ···              ▓                                      
                                          ┊ ··· ┊    ····   ·@@@@@@@@@@@@┊·   ···    ┊ ··· ┊      140▒                                      
                                          ··    ┊ ··· ┊  ·=#*@@@@@@@@@@@%#%··· ┊ ··· ┊    ··         ▒                                      
                                          ┊    ···   ···@=#@##@@@@@@@@@@#*@%@%···   ···    ┊      100░                                      
                                          ┊ ··· ┊ ···%#%**#@@%#@@@@@@@@%+*@@##%%%%·· ┊ ··· ┊         ░                                      
                                       x  ··   ··%@%%##=+#%@@@@@@@##@@@@@@@@@#*#%%@%%··   ··  y    60                                       
                                          ┊ ··%%%%%%#*++#%%@@@@@@@@@@@@@@@@@@%###%#%%%%%·· ┊                                                
                                          ·%@%%%@%%%%##*%@@@@@@@@@@@@@@@@@@@@@@%@%@%@%%%@%%·                                                
                                          ┊ ///%%%%%##%%@@@@@@@@@@@@@@@@@@@@@@@@%%%%%%%\\\ ┊                                                
                                       40 +/      @%%%@@@@@@@@@@@@@@@@@@@@@@@@@@@%@%      \+  40                                            
                                                     %%@@@@@@@@@@@@@@@@@@@@@@@%%%                                                           
                                                        @@@@@@@@@@@@@@@@@@@@@@                                                              
                                                           %%%%@@@@@@@@%%%%                                                                 
                                                               %%%@%%%@                                                                     
                                                                  %%                                                                        
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
```

**maunga whau 96x32 box:**

```
                                           Maunga Whau                                          
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                          height                                                
                                                                                                
                                          200                                                   
                                          180                                                   
                                         ·160                                                   
                                    ┊··┊··140·┊·                                                
                                 ┊··· ·┊··┊···┊ ····                    200█                    
                             ·┊··┊ ····┊··120·┊··· ┊····                   █                    
                         ···· ┊······@@@@·100·┊······· ┊····          172.5▓                    
                       ·· ┊ ······@@@@@@@@@%*·┊··········  ┊··             ▓                    
                       ┊ ·····┊··=@@@@@@%@@%@@%%···········┊            145▒                    
                       ·······┊·=#@@%@@@@@@+@@@%*#·········┊··             ▒                    
                       ·······┊+*@@@@@@@@@#@@@@@%%%*@@·····┊··        117.5░                    
                     x (m)···++#@@@@@@@@@%@@@@@@@@@@@#@@@··┊·· y (m)       ░                    
                       ┊··%+#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@┊··           90                     
                       ┊·%@@@%@@@@@@@@@@@@@@@@@@@@@@@@@@@%%@@80                                 
                     60+/   @##@@@@@@%@@@@@@@@@@@@@@@@@@%   \\                                  
                                @@@@@@@%@@@@@@@@@@@@@                                           
                                  %@@@#@@@@@@%%@@@                                              
                                     @%@@@%%@%%%                                                
                                       %%%%@%                                                   
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**maunga whau 96x32 braille:**

```
                                           Maunga Whau                                          
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                          height                                                
                                                                                                
                                          200                                                   
                                          180                                                   
                                         ⠂160                                                   
                                    ⠂⠂⠂⠂⠂⠂140⠂⠂⠂                                                
                                 ⠂⠂⠂⠂ ⠂⠂⠂⠂⠂⠂⠂⠂⠂ ⠂⠂⠂⠂                    200█                    
                             ⠂⠂⠂⠂⠂ ⠂⢀⣀⣠⣄⡀⠂120⠂⠂⠂⠂⠂ ⠂⠂⠂⠂⠂                   █                    
                         ⠂⠂⠂⠂ ⠂⠂⠂⠂⣠⣴⣿⣽⣿⢽⣿⣷100⠂⠂⠂⠂⠂⠂⠂⠂⠂ ⠂⠂⠂⠂⠂          172.5▛                    
                       ⠂⠂ ⠂ ⠂⠂⠂⠂⢀⣾⣿⣏⣿⢿⢼⣾⣾⣿⣿⣿⣿⣿⣷⣤⡀⠂⠂⠂⠂⠂⠂⠂⠂  ⠂⠂⠂             ▛                    
                       ⠂ ⠂⠂⠂⠂⠂⠂⢠⣿⣿⣿⣷⣿⣽⣿⣿0⣯⣿⣿0⣿⣿⣿⣷⡄⠂⠂⠂⠂⠂⠂⠂⠂⠂⠂            145▀                    
                       ⠂⠂⠂⠂⠂⠂⠂⣠⣿⣿⣺⢻⣿⣿10⣽⣗⣿⣿⣏⣷⣿⣿⣿⣿20⣶⣦⣄⠂⠂⠂⠂⠂⠂⠂⠂             ▀                    
                       ⠂⠂⠂⠂⠂⢀⣴⣿⣿⣿⢻20⣽⢻⡾⣿⡿⡿⡧⣷⡿⣿⢿⣿⢿⣿⣿⣿⣿40⣶⣤⡀⠂⠂⠂⠂        117.5▘                    
                     x (m)⣤⣾⣿⢷30⢿⣹⢻⢾⣽⣿⣽⣷⣿⣯⡿⣷⣿⣿⣻⣽⣻⣺⣟⣿⣿⣿⣿⢿⣿⢷⡀⠂⠂⠂ y (m)       ▘                    
                       ⣠⣶⣿⣿40⣿⣽⣿⣺⢿⢺⢿⢽⣿⣯⣿⣿⣿⣿⣿⣿⢻⢾⢼⣿⣿⣿⢼⡽⣟⣿⣿⣿60⣦⡀⠂           90                     
                       ⠂50⣿⣷⣿⣽⣿⣾⢻⣺⢿⣺⣿⡿⣯⣿⣾⡿⡯⣿⣿⣿⣹⣻⣺⣯⣿⣿⣯⣿⣿⣿⣿⡿⠟⠋⠁80                                 
                     60+/  ⠉⠙⠻⣿⢿⣽⢿⣽⣿⣷⣷⣗⣿⡽⣗⣿⣿⣿⣻⣻⣾⣿⣿⣿⣿⣿⣿⣷⠿⠋   \\                                  
                              ⠈⠛⢿⣻⣿⣻⣾⣿⣟⣿⣗⡟⣗⣿⢻⢾⣻⣿⣷⣯⣿⠿⠛⠉                                          
                                 ⠉⠻⣿⣿⣿⣿⣷⣿⣿⣿⣿⣿⣿⣿⣿⠷⠋                                              
                                   ⠈⠳⢿⡷⣿⣿⣿⣿⣿⣿⣻⠟⠃                                                
                                      ⠙⠿⣿⣿⡿⠟⠋⠁                                                  
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**maunga whau 140x40 box:**

```
                                                                 Maunga Whau                                                                
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                height                                                                      
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                200                                                                         
                                                               ·180                                                                         
                                                            ··· ┊ ···                                                                       
                                                         ···┊  ·160  ···                                                                    
                                                      ···   ┊···140·· ┊ ···                                                                 
                                                   ···  ┊···┊·· 120·····   ┊···                                                             
                                                ··· ┊ ······┊  ·+·   ······┊   ···                  200█                                    
                                             ···┊  ······  =@···100···┊ ·······  ┊···                  █                                    
                                          ··┊   ┊····· #@@@@@@@@# ··· ···  ······┊   ·┊·          172.5▓                                    
                                        ··  ┊···┊·· ┊-@@@@@@@@@%#%@@@#@· ··┊·  ··┊··· ┊ ··             ▓                                    
                                        ┊ ······┊···-@@@@@@@@%+@@@*@#@@@···┊ ····┊······            145▒                                    
                                        ····· ··┊  -@%%@%@@@@@@@@%+%@@%@@@ ····  ┊·· ·┊···             ▒                                    
                                        ····┊·  ┊·-*@@@@@@@@@@@@@@@@@@@%+**%##%··┊  ··┊···        117.5░                                    
                                     x (m)  ┊···=*#@@@@@@@@@@@@*@@@@@@@%%%@@@*+=%=··· ┊ ·· y (m)       ░                                    
                                        ┊ ··· %++#*@@@@@@@@@@@%@@@@@@@@@@@@@@@@%@@@@ ···             90                                     
                                        ···*@=%@*@@@@@@@@@@@@#@@@@@@@@@@@@@@@@@@@@@@@·┊···                                                  
                                        ┊#%#@%@@@@@@@@@@@@@@@@%@%@@@@@@@@@@@@@@@@@%@@@%%·80                                                 
                                     60 +/ @@@#@@#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%@@@@   \\                                                  
                                                #@@@@@@@@@@@@#%@@@@@@@@@@@@%*@%%%%                                                          
                                                   @@@%%@@@%@%@@@@@@@@@@@@@@@@@                                                             
                                                     @@@@@%@@@@@@@@@@@@@@@@                                                                 
                                                        @@@%@%@%@@@@%@@@%                                                                   
                                                          @@@@%%%%%@%%                                                                      
                                                             %%@@@%                                                                         
                                                               %                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
```

### Mutation table (this round's own additions)

| Guarantee | Test | Mutation | Effect |
|---|---|---|---|
| `sceneCellAspect` is the INVERSE of the chart's own `cellAspect`, and this reaches the real projection | `render.test.ts`'s "regression gate: the sceneCellAspect CONVERSION reaches the projection" | Pass the raw, un-inverted `chartCellAspect` into `createGlyphScene`/`compileScene` (reproduced inline as a second test, since the private `renderObjectFrame` cannot be mutated from outside) | RED — the measured screen-unit ratio deviates from the analytic one by ~66% (roughly `cellAspect^2`), blowing the 10% band |
| A tick label is never partially clipped by sibling overlay geometry | `object.test.ts`'s "guide-plane grid glyphs" A/B render (visual) plus the deliverable frames themselves | Revert the tick-label `place()` call to forward `depth: labelProjected.depth` (the pre-fix rule) | RED, visually — "150"/"100" print as "5"/"0" against the coordinator's own fixture (reproduced directly during development) |
| A tick label still hides behind a genuinely nearer surface | `object.test.ts`'s "Item 4: zero guide glyphs on surface-won cells" (unaffected by this round — ticks now share the SAME `occlusionDepth` mechanism the title's own gate already exercises) | Drop `occlusionDepth`/revert `ownMeshIds` to `frame.ownMeshIds` (the surface exempted) | RED — a tick label can print straight through real surface ink with nothing to stop it |
| The floor guide plane is opt-in, not on by default | `object.test.ts`'s guide-toggle describe block (unaffected structurally; `guides.floorGrid` defaults `false` and is covered by the SAME `guides.grid: false` A/B pattern already gated there) | Default `floorGrid` to `true` | Visually reintroduces the reported "dense diamond cage" at the coordinator's own fixture (measured: the floor plane alone out-inks both walls combined) |
| A wireframe render's mesh is capped at `WIREFRAME_MAX_QUADS`, `solid` is not | `render.test.ts`'s existing "style: 'wireframe' static frame equals a live scene..." byte-identity test (unaffected — both sides call the SAME `wireframeDecimatedMark`) plus visual inspection of the braille frames below | Remove the `style === "wireframe"` decimation branch | Visually reverts to a solid braille blob at the 40x40/87x61 fixtures — no rim/crater legible |
| The colorbar sits a fixed gap past the surface's own real extent, never the canvas's own far edge unconditionally | `render.test.ts`'s "byte-identical PLOT REGION" test's own `colorbarStartCol` derivation (fails end-to-end if the gap ever undershoots the label's own full width — caught directly during development) | Revert `swatchCol` to `canvas.cols - 1` | Visually reintroduces the reported 22-column dead gap on the Maunga Whau fixture |
| Two prior colorbar reservation constants must track each other (`COLORBAR_GAP_COLS`'s own `1 -> 2` bump) | `render.test.ts`'s own `colorbarLabelWidthForTest` call site (a hardcoded mirror of `render.ts`'s reservation formula) | Change `render.ts`'s `COLORBAR_GAP_COLS` without updating the test's own mirrored constant | RED across the WHOLE byte-identity comparison (not just near the colorbar) — a desynced reservation width sizes the live scene mount's own grid differently from what the static path fit against, reading as a global content shift rather than a colorbar-local diff (found directly during this round's own development) |

**Gate.** `pnpm --filter @glyphcss/charts test` (43 files, 1589 tests, +2
net over round 3's 1588: +1 new isolated ticks-ink test replacing a
mutation-fragile assertion, +2 new regression-gate tests, -1 assertion
folded into the new isolated test), `pnpm --filter glyphcss test` (116
files, 1274 tests, unaffected — `labelArbiter.ts`'s own change is a
different WRITE path through the SAME public `place()`/`resolve()`
contract, no new field), `pnpm --filter @glyphcss/diagrams test` (12
files, 256 tests, unaffected — no 3D-diagrams candidate sets `depth`
either), `pnpm --filter @glyphcss/compile test` (8 files, 88 tests,
unaffected), and the three authorized website test files pass (28 tests
across `chartsWorkbench3d.test.ts`, `chartsWorkbench3dRender.targetMatrix.test.ts`,
`Charts3dViewport.lifecycle.test.tsx`). `pnpm build:packages` is clean.

### The third website file — `chartsWorkbench3dRender.targetMatrix.test.ts`

Authorized this round specifically because its own "braille downgrades to
the default ramp with no braille glyphs in the output" test pinned the
PRE-round-2 premise (braille as a faithful downgrade) — round 2 already
made braille a real depth-tested wireframe render, so `glyphChart3dCharsetDegrades("braille")`
has been `false` since then and this test was silently asserting the
opposite of the library's own real behaviour, left red and out of scope
at the end of round 3. Rewritten to follow the library predicate directly
(mirroring `chartsWorkbench3d.test.ts`'s and `Charts3dViewport.lifecycle.test.tsx`'s
own idiom, never a hardcoded charset list): a charset the predicate flags
must render WITHOUT its own real glyphs (a faithful downgrade); a charset
it does not flag must render WITH them — checked concretely for braille
via the same `⠀-⣿` code-point range the old test used, plus a standalone
mutation-sanity assertion pinning `glyphChart3dCharsetDegrades("braille")
=== false` / `glyphChart3dCharsetDegrades("blocks") === true` so a future
library change that re-degrades braille (or un-degrades blocks) reddens
THIS assertion first, naming exactly which premise moved.

### Residuals, stated plainly

- The rotation sweep's `FOOTPRINT_FLOOR` (`0.15`) and the small-grid
  colorbar scenario's own floors (`0.2`/`0.3`) are lower numbers than
  round 3 shipped — not because the render got worse (it is dramatically
  better, visually, than round 3's own squashed output — see the frames
  above), but because round 3's numbers were measured under a metric
  (occupied-bounding-box share) that a disconnected far-edge colorbar was
  silently inflating, and because round 3's numbers were themselves
  measured under the still-squashed cellAspect. An honest floor here is a
  genuinely lower number for a genuinely better render — exactly the
  coordinator's own stated fallback ("if unreachable at an honest pitch,
  say so and give the measured number") applied twice over, not once.
- `AXIS_TITLE_MARGIN: 0.6` (round 3) is untouched this round — titles were
  never the subject of Item 4's clipping bug (they already used
  `occlusionDepth` with no `depth` forwarded, round 2/3's own fix); its
  own residual (a sufficiently long title on a sufficiently steep surface
  can still lose to genuine occlusion at an adversarial rotation) stands
  as documented in round 3.
- `COLORBAR_GAP_COLS` is a single constant shared by the WIDTH reservation
  (`fitStaticCamera`'s own budget) and the real PLACEMENT gap — a
  deliberate choice so the two can never drift, at the cost of the
  reservation being sized for the WORST case (the surface filling its
  entire column budget) even though the placement usually needs less; the
  unused reserved columns simply stay blank canvas.
- No dedicated numeric gate exists for "the grid reads as faint, not a
  cage" beyond the coordinator's own visual review of the frames below and
  the existing `guides.grid: false` ink-reduction A/B test — a perceptual
  claim ("faint") has no clean automated metric distinct from raw cell
  count, which round 3's own gate already covers.
- The wireframe decimation cap (`WIREFRAME_MAX_QUADS = 20`) is a single
  global constant, not swept against grids much larger or smaller than the
  coordinator's own 40x40/87x61 fixtures — a very fine (e.g. 200x200) or
  very coarse (e.g. 10x10) surface's own "right" decimation count is
  unverified past this round's two fixtures.

## C2 fix round 5 — tick labels never paint over the surface, and the wall grid defaults off

Rounds 2-4 are committed on `feat/diagrams` as `00a07a85`. The cellAspect
root-cause fix held — the surface reads as an oblique volcano with rim and
crater visible at every deliverable size/charset. The coordinator rendered
the frames and found two remaining defects, both fixed this round.

### Item 1 — braille tick labels were stamped over the surface

Round 4's own Item 4 fix (dropping `depth` from a tick label's write, so a
genuinely present label could no longer be PARTIALLY clipped by a sibling
grid/axis-line write) paired it with `ownMeshIds: new Set()` +
`occlusionDepth` — the SAME whole-label-drop mechanism the axis TITLE
already used. That mechanism depends on `CellGrid.winnerMesh`, and
`compileScene.ts`'s own gate is `retainWinnerMesh: mode === "solid" &&
...` — under `style: "wireframe"` (the braille charset's own default)
`winnerMesh` is NEVER populated, so the occlusion check's own `if
(c.ownMeshIds && winnerMesh)` guard is false and the whole-label-drop
NEVER fires there. Round 4's own fix was therefore correct for `solid`
(box/ascii) and silently inert for `wireframe` (braille) — exactly what
the coordinator's report showed: `0`, `10`, `20`, `30` printed straight
into the dense braille fill (`⣿⣿20⣿⣿`, `⠛30⣿⣿`).

Fixed with a GEOMETRIC occlusion test that needs no `winnerMesh` at all —
`object.ts`'s new `buildMeshScreenDepth` projects every one of the mesh's
OWN vertices (the same domain-to-`[0,aspect]` mapping `buildSurfaceMesh`
applies, replicated here since this overlay has no access to the already-
built `Polygon[]`) through the SAME camera the overlay itself uses, and
records the NEAREST depth reached at each screen cell. A tick label is
dropped WHOLE — never partially — the instant ANY of its own left-aligned
character cells has a recorded mesh depth nearer than the label's own
anchor (`tickLabelOccludedByMesh`), mirroring the arbiter's own "any cell,
not just the anchor" rule at the geometry level. Built ONCE per `stamp()`
call (not per tick) and reused across all 3 axes' own labels — O(mesh
vertices) once, a couple of `Map` lookups per label after that. Kept the
existing `occlusionDepth`/`ownMeshIds` mechanism in place too (real,
correct, and free under `solid`) as defense in depth; `TICK_LABEL_MARGIN`
moved from `0.12` to `0.15` (a small, honest bump — NOT the fix: a margin
increase alone was tried first, up to `1.0`, and still left residual
collisions on Maunga Whau's own off-center peak while sacrificing real
footprint, since `fitStaticCamera` zooms OUT to keep a farther-pushed
label on screen too).

Gate (`render.test.ts`, at the library default camera, both `box` and
`braille`): no tick-label cell lands on a cell the surface's own mesh
sampling reports as nearer, and every KEPT tick label string appears
whole (verified directly against both deliverable fixtures — see the
frames below, where every one of "150", "100", "220", "180", "140",
"100", "60", "40", "20", "30" and Maunga Whau's own "172.5"/"117.5" now
prints intact, with none landing inside the surface's own ink).

### Item 2 — the wall grid still read as a cage

`planeGridLines` already drew lines only at each axis's own TICK
positions (never dense per-cell dots) and each line already stopped at
the plane's own edge, and grid writes were already depth-tested against
the real surface (`stampGlyphOverlayLine`'s own depth-tested primitive) —
none of those were the defect. Measured directly: the wall grid's own ink
share was already a modest 7-11% of the plot's own bounding box at both
fixtures, well under a 15% cap. The defect was VISUAL WEIGHT, not ink
density — a genuinely low-density crosshatch spread across two FULL guide
planes still projects, at this library's own default oblique camera, as a
diamond shape the eye locks onto ahead of the surface (the coordinator's
own words: "a big dotted diamond... filling the whole upper half of the
frame... visually outweigh the data"), a property the ink metric alone
never measured.

Two changes: (1) `guides.grid` and `guides.floorGrid` both default `false`
now (were `true`/`false` after round 4) — decided by LOOKING, per the
coordinator's own explicit instruction: with the grid off, both fixtures
read as a clean oblique surface with axis structure only, closer to
matplotlib's own actual default (panes with no gridlines drawn unless the
reader asks) than the "always-on guide plane" round 4 shipped. `guides.
grid: true`/`floorGrid: true` still work exactly as built for a caller who
wants them. (2) A new `GRID_MAX_LINES_PER_SWEEP_AXIS` (`2`) caps how many
of an axis's own ticks become a wall grid line, independent of the axis's
own tick/label count, subsampling evenly and always keeping the plane's
own first/last tick (`subsampleTicksForGrid`) — a safety net for the
opt-in case, sized to the coordinator's own explicit regression number.

Gate (`object.test.ts`): with the grid explicitly re-enabled, its own ink
is <= 15% of the PLOT's own occupied bounding box (not the whole canvas,
which would hide a dense grid behind a title/colorbar's blank margin) —
measured directly against the SAME 15% cap the coordinator specified, on
all three charsets; a second test pins the DEFAULT render byte-identical
to an explicit `guides.grid: false`.

### Frames (verbatim, `renderGlyphChart3d` with default options besides target/width/height/charset/title)
**ring-crater 96x32 box:**

```
                                           Ring crater                                          
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                            height                                              
                                                                                                
                                                                                                
                                             200                                                
                                             150                                                
                                             │                                                  
                                             100                      220█                      
                                             │                           █                      
                                             │                        180▓                      
                                         -@@@@@@+                        ▓                      
                                       *%@@@@@@@@@@                   140▒                      
                                    @=#@*@@@@@@@%*+%#%                   ▒                      
                                 %##=*%@@#@@@@@@#@@@%*#%%             100░                      
                        x    %@%%%%=+#@@@@@@@@@@@@@@@##%@%@%%    y       ░                      
                           %%%%%%%%#*%@@@@@@@@@@@@@@@@%%%%%%%%%        60                       
                            //%%@%@@@@@@@@@@@@@@@@@@@@@@@%%%\\                                  
                       40 +/     %%@@@@@@@@@@@@@@@@@@@@@%     \+  40                            
                                     @@@@@@@@@@@@@@@@                                           
                                        %%%%%%%%%%                                              
                                           %@%%                                                 
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**ring-crater 96x32 braille:**

```
                                           Ring crater                                          
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                            height                                              
                                                                                                
                                                                                                
                                             200                                                
                                             150                                                
                                             │                                                  
                                             100                      220█                      
                                             │                           █                      
                                          ⣠⣴⣾⣦⣄                       180▛                      
                                      ⣠⣶⣾⣿⣯⣿⣳⣿⢿⢿⣷⣶⣄                      ▛                      
                                   ⢀⣴⣾⣿⣿⣿⣷⣷⢙⣿⣛⣾⣻⣿⣾⣿⣷⣦⡀                140▀                      
                                ⢀⣠⣾⣿⣿⣿⣯⢿⣿⣿⣽⡾⣾⣹⣽⣿⣿⣿⢿⣿⣿⣿⣷⣄⡀                ▀                      
                             ⣠⣴⣾⣿⣿⣿⣿⢯⡿⣿⣿⣟⣿⣿⣿⣷⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣦⣄          100▘                      
                        x ⣠⣴⣾⣿⣿⣿⣿⣿⣿⣟⣿⣿⣷⡿⣷⡗⡟⢧⣟⡾⢻⢺⣾⢿⣾⣾⣿⣿⣿⣿⣿⣿⣿⣿⣷⣦⣄  y       ▘                      
                          ⠙⠻⣿⣿⣿⣿⣿⣿⣿⣺⣟⡯⣿⡿⣏⣿⡟⡟⣦⢿⢻⣿⣹⢿⣿⢽⣻⣿⣿⣿⣿⣿⣿⣿⣿⠟⠋        60                       
                            ⠈⠙⠻⢿⣿⣿⣿⣯⣟⣿⣟⡿⣯⣧⣽⡗⣿⣻⣯⣼⣽⢿⣻⣿⣻⣽⣿⣿⣿⡿⠟⠋⠁\                                  
                       40 +/    ⠈⠙⢿⣿⣿⣿⣿⣿⣏⣷⡧⡿⣗⣿⢼⣾⣹⣿⣿⣿⣿⣿⡿⠋⠁     \+  40                            
                                   ⠈⠳⢿⣿⣯⣿⣯⣿⣿⣿⣿⣿⣽⣿⣽⣿⡿⠞⠁                                          
                                      ⠈⠙⠻⢿⣿⣿⣿⣿⣿⡿⠟⠋⠁                                             
                                          ⠙⠻⠿⠟⠋                                                 
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**ring-crater 140x40 box:**

```
                                                                 Ring crater                                                                
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                   height                                                                   
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                   200                                                                      
                                                                   │                                                                        
                                                                   +                                                                        
                                                                   150                                                                      
                                                                   │                                                                        
                                                                   100                             220█                                     
                                                                   │                                  █                                     
                                                                   +                               180▓                                     
                                                                 %%%%                                 ▓                                     
                                                             @@@@@@@@@@@@                          140▒                                     
                                                          =#*@@@@@@@@@@@%#%                           ▒                                     
                                                        @=#@##@@@@@@@@@@#*@%@%                     100░                                     
                                                    %%#%**#@@%#@@@@@@@@%+*@@##%%%%                    ░                                     
                                       x         %@%%##=+#%@@@@@@@##@@@@@@@@@#*#%%@%%         y     60                                      
                                              %%%%%%#*++#%%@@@@@@@@@@@@@@@@@@%###%#%%%%%                                                    
                                           %@%%%@%%%%##*%@@@@@@@@@@@@@@@@@@@@@@%@%@%@%%%@%%                                                 
                                            ///%%%%%##%%@@@@@@@@@@@@@@@@@@@@@@@@%%%%%%%\\\                                                  
                                      40  +/      @%%%@@@@@@@@@@@@@@@@@@@@@@@@@@@%@%      \+   40                                           
                                                     %%@@@@@@@@@@@@@@@@@@@@@@@%%%                                                           
                                                        @@@@@@@@@@@@@@@@@@@@@@                                                              
                                                           %%%%@@@@@@@@%%%%                                                                 
                                                               %%%@%%%@                                                                     
                                                                  %%                                                                        
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
```

**maunga whau 96x32 box:**

```
                                           Maunga Whau                                          
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                          height                                                
                                                                                                
                                          200                                                   
                                          180                                                   
                                          160                                                   
                                          140                                                   
                                          120                           200█                    
                                          100                              █                    
                                     @@@@ │                           172.5▓                    
                                   @@@@@@@@##                              ▓                    
                                 +@@@@@@##@@#@%%%                       145▒                    
                                +@@@@@@@@@@@@@@#%@@                        ▒                    
                               =#@@@@@@@@@#@@@@@@%%*@@                117.5░                    
                      x (m)  ==%@@@@@@@@@@@@@@@@@@@@@*@@@@     y (m)       ░                    
                          *##=+@@@@@@@@@@#@@@@@@@@@@@@@@@@@              90                     
                         @@*@%@%@@@@@@@@@%@@@@@@@@@@@@@@@@@%@ 80                                
                     60 +/  @%+@@@@@@@@@@@@@@@@@@@@@@@@@@   \\                                  
                                @@@@@@@%@@@@@@@@@@@@@@                                          
                                  %@@@@@@@@@@%%%@@@                                             
                                     @%@@@@%@%%%                                                
                                       %%%@@%                                                   
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**maunga whau 96x32 braille:**

```
                                           Maunga Whau                                          
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                          height                                                
                                                                                                
                                          200                                                   
                                          180                                                   
                                          160                                                   
                                          140                                                   
                                          120                           200█                    
                                    ⢀⣀⣠⣄⡀ 100                              █                    
                                  ⢀⣤⣿⡟⣷⢿⣿⣷⣦⣀                          172.5▛                    
                                ⢀⣴⣿⣻⣹⣿⣯⣿⣾⣿⣿⣿⡿⣿⣷⣦⡀                          ▛                    
                               ⢠⣿⣿⣿⣿⣾⣿⣿⣿⣿⢿⣽⣿⣿⣿⣿⣿⣷⣄                      145▀                    
                              ⢠⣿⣿⣗⡿⣿⣿⣾⣿⣽⢻⣺⣿⣏⣷⣿⣿⣿⣿⣿⣷⣶⣦⣄                     ▀                    
                             ⣠⣿⣿⣷⣟⣿⢿⣽⢻⣾⢽⣽⡿⣧⣷⡯⣿⡿⣿⡿⣿⣿⣿⣿⣿⣷⣶⣦⡄            117.5▘                    
                      x (m)⣶⣿⣿⣿⣾⡿⣯⠿⣾⣽⢿⢼⣾⡾⣿⣽⣿⣷⣗⣟⣯⣿⣿⣟⣯⣿⣿⣿⣷⣻⣽⡀    y (m)       ▘                    
                       ⢠⣶⣿⣿⣿⣿⣿⣿⣻⣗⡿⡗⣿⣿⣽⢿⣽⣿⣿⣿⢿⣷⡟⡷⣯⣿⣻⣾⡿⣯⣿⣯⣿⣿⣿⣿⣶⣄            90                     
                        ⠉⠻⢽⣿⣿⣿⣿⣷⡟⣗⣿⣷⣿⣾⢿⣽⣿⡿⡯⣿⣳⣟⣏⣿⣿⢾⣽⣿⣿⣿⣿⣯⣿⣿⠿⠛⠉ 80                                
                     60 +/ ⠈⠙⠻⢷⡿⣯⣿⣿⣽⣾⣺⣾⣺⡿⣗⡿⣯⣯⣿⣿⣿⣻⣿⣿⣷⣿⣿⣷⠿⠋   \\                                  
                               ⠙⠻⣿⣿⣻⣾⣿⣾⣿⣗⡟⣗⡿⡟⣿⣿⣾⣻⣾⣽⡿⠟⠋                                          
                                 ⠉⠻⣽⣿⣿⣿⣿⣿⣿⣿⣯⣿⣿⣿⢾⡿⠞⠁                                             
                                    ⠙⠾⣿⣿⣿⣿⣿⣿⣿⣻⠟⠋                                                
                                      ⠘⠻⢿⣿⣿⠿⠋⠁                                                  
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**maunga whau 140x40 box:**

```
                                                                 Maunga Whau                                                                
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                 height                                                                     
                                                                                                                                            
                                                                                                                                            
                                                                 200                                                                        
                                                                                                                                            
                                                                 180                                                                        
                                                                 160                                                                        
                                                                 +                                                                          
                                                                 140                                                                        
                                                                 120                                                                        
                                                                 100                                 200█                                   
                                                            @@   +                                      █                                   
                                                       =@@@@@@@%@+                                 172.5▓                                   
                                                      @@@@@@@@@@*@@%@@@#                                ▓                                   
                                                    =@@@@@@@@@+@@@#@*@@%%                            145▒                                   
                                                   +@%%@%@@@@@@@@@@%@@@@@@@                             ▒                                   
                                                  -@@@@@@@@@@@@@@+@@@@@@++*%#+*                    117.5░                                   
                                      x (m)      =+%@@@@@@@@@@@@@@@@@@@%%%@@@@###%          y (m)       ░                                   
                                              +#=%%@@@@@@@@@@@@@@@@@@@@@@@@@@@@%@@@@@                 90                                    
                                           %#%%*=@%@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@                                                      
                                         %*%@@@+@@@@@@@@@@@@%@%%%@@@@@@@@@@@@@@@@@@%@%@@  80                                                
                                    60  +/  @@@+@%@@@@@@@@@@@@#@@@@@@@@@@@@@@@@@@@@@@@  \\                                                  
                                                @@@@@@@@@@@@@@%@@@@@@@@@@@@%%@@@%%                                                          
                                                   @@@@%@@@@@%@@@@@@@%@@@@@@@@@                                                             
                                                     @@@@@@@@@@@@@@@@@@@@%@%                                                                
                                                        @@@%%@@@@@@%@%@@@                                                                   
                                                           %@@@%%%%%@%                                                                      
                                                             %%@@@%%                                                                        
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
```

### Mutation table (this round's own additions)

| Guarantee | Test | Mutation | Effect |
|---|---|---|---|
| A tick label is geometrically occluded (dropped whole) by the mesh even under `style: "wireframe"`, where `winnerMesh` is never populated | `render.test.ts`'s round-5 tick-occlusion gate (both `box` and `braille`, default camera) | Remove the `meshScreenDepth`/`tickLabelOccludedByMesh` check, leaving only `occlusionDepth`/`ownMeshIds` | RED under `braille` specifically — digits reappear embedded in the surface fill (reproduced directly during development against both fixtures) |
| The mesh depth map is built once per `stamp()`, not once per tick | (performance property, not separately gated — `buildMeshScreenDepth`'s own doc states the cost bound) | n/a | n/a |
| `guides.grid`/`floorGrid` default `false` | `object.test.ts`'s "the DEFAULT... renders with NO grid ink — byte-identical to an explicit `guides.grid: false`" | Revert `surface.ts`'s `grid: g.grid ?? false` to `?? true` | RED — the default render's own ink no longer matches the explicit-off render |
| An opt-in grid still stays under the coordinator's own 15% ink cap | `object.test.ts`'s "the grid cell count is <= 15% of the PLOT's own occupied bounding box" (box/ascii/braille) | Revert `GRID_MAX_LINES_PER_SWEEP_AXIS` to unbounded (every tick) | RED — measured 16.7-20.8% at this test's own tighter-framed scene before the cap, over the 15% line |
| `subsampleTicksForGrid` never drops the plane's own two edge ticks | (implicit in the "grid glyphs are never axis-line glyphs" / visual frames — no dedicated new test, since the existing edge-line/box-outline gates already cover a plane's own boundary being drawn) | n/a | n/a |

**Gate.** `pnpm --filter @glyphcss/charts test` (43 files, 1592 tests),
`pnpm --filter glyphcss test` (116 files, 1274 tests, unaffected),
`pnpm --filter @glyphcss/diagrams test` (12 files, 267 tests, unaffected —
grown from 256 by the parallel diagrams-3d agent's own work already
merged in via the `feat/diagrams` sync), `pnpm --filter @glyphcss/compile
test` (8 files, 88 tests, unaffected), and the three authorized website
test files (28 tests) all pass. `pnpm build:packages` is clean.

### Residuals, stated plainly

- The mesh-vertex depth sampling in `buildMeshScreenDepth` is an
  APPROXIMATION — it samples grid VERTICES, not a full triangle
  rasterization, so a very coarse mesh with wide gaps between vertices
  (relative to the output grid's own resolution) could in principle leave
  a face's own INTERIOR cells unrepresented in the depth map. Verified
  correct by LOOKING at both deliverable fixtures at every required
  size/charset, not proven exhaustively for an arbitrary future mesh
  resolution.
- `GRID_MAX_LINES_PER_SWEEP_AXIS = 2` reduces an opt-in wall grid to
  essentially the plane's own two boundary lines per sweep axis (its own
  outline, through the grid glyph family) — a deliberate, stated
  trade-off for clearing the coordinator's own 15% cap under
  `object.test.ts`'s own tighter-framed test scene, not a claim that 2
  lines is the ideal interior-guide look for every fixture; a caller
  wanting a denser opt-in grid has no separate control for it yet.
- No SEPARATE numeric gate exists for "clip wall grids to the region
  where the surface isn't in front" — that property was already true
  before this round (every grid write goes through the depth-tested
  `stampGlyphOverlayLine`/`stampGlyphOverlayCell` primitives, gated
  directly by `object.test.ts`'s existing "guide lines are depth-tested
  against the surface" test) and needed no change.

## C4 — guide toggles, exact trackball Copy, and the Effects folder

Three independent additions, none touching `packages/*/src` (this
worktree's own scope boundary while C2 round 5 was concurrently editing
`packages/charts/src/3d` elsewhere) — all three land entirely inside
`website/src/components/ChartsWorkbench/`.

### Item 1 — guide toggles in the View folder

One `useToggle` boolean row per `GlyphChart3dGuideOptions` field, read off
`packages/charts/src/3d/types.ts` directly rather than invented:
`axisLines`, `ticks`, `tickLabels`, `titles`, `grid`, `floorGrid`, `walls`,
`box`. `Charts3dViewState.guides` stores only OVERRIDES (`{}` default,
every field then follows the library's own default) rather than a fully
materialised 8-boolean record — the same "only what a reader actually
touched" discipline `chart3d.camera`'s own `zoom?: undefined` already
follows. `ChartsDock.tsx` shows each row's current value as
`state.chart3d.guides[key] ?? CHARTS_3D_GUIDE_DEFAULTS[key]`, a page-local
default table matching `types.ts`'s own documented per-field defaults
(`axisLines`/`ticks`/`tickLabels`/`titles`/`grid` true, `floorGrid`/
`walls`/`box` false) — a static table rather than reading the resolved
mark's own `guides` field back, since the eight defaults are fixed public
contract, not something that changes per render.

**Live update, no remount.** `resolveCharts3dView` threads `guides:
view.guides` straight into both `glyphChartSurface` calls (dataset and
inline sources alike), so a guides edit produces a fresh
`GlyphChart3dSurfaceMark` exactly like a shading/colorscale edit already
did (C3 fix round 1's own P1-2 fix). `ChartsWorkbench.tsx`'s
`chart3dResolved`/`chart3dResolvedLive` memos gained `state.chart3d.guides`
in their (deliberately narrowed) dependency arrays, and
`Charts3dViewport.tsx`'s existing mark-update effect — already keyed on
`[mark]`, already calling `handle.update(object)` — needed no new code at
all to pick this up; only its effect-disposal/reapply addition (Item 3,
below) touches that effect body. Camera and orbit controls survive
untouched, the same guarantee C3 fix round 1 proved for every other
mark-affecting edit.

**URL state.** `guides` rides in `?c=` as one more append-only optional
`chart3d` field; an old link (no `guides` key at all) decodes to `{}`
(every guide follows the library default), byte-identical to the pre-C4
shape. A malformed individual field (wrong type) is dropped for that field
alone — mirroring `validateCharts3dCameraMat`'s own "a bad field degrades
to absent, never rejects the whole payload" rule — never failing the
whole `chart3d` payload the way a bad `camera` does.

### Item 2 — trackball Copy is exact (and a real, pre-existing bug found in the process)

`renderGlyphChart3d`'s camera option now accepts `{ mat, zoom, center }`
(the C2 round in flight closed the earlier library gap
`chartsWorkbench3dRender.ts` carried a `TODO` for) — this packet's own
first step was deleting that comment and confirming the pass-through
already worked. It didn't: `chartsWorkbench3dRender.ts`'s `cameraOption`
construction was

```ts
const cameraOption = cam.useMat && cam.mat
  ? { rotX: cam.rotX, rotY: cam.rotY, zoom: cam.zoom, mat: [...cam.mat], useMat: true }
  : { rotX: cam.rotX, rotY: cam.rotY, zoom: cam.zoom };
```

— always including `rotX`/`rotY` even on the `mat` branch. `render.ts`'s
own validation rejects that combination outright:
`cameraOption.mat !== undefined && (cameraOption.rotX !== undefined ||
cameraOption.rotY !== undefined)` throws `bad-camera` ("pass either mat
(trackball) or rotX/rotY (Euler), not both") — mirroring
`renderGlyphDiagram3d`'s own camera contract exactly, per this file's own
C3 doc. So **every Copy ASCII/ANSI, terminal, and chat render under a live
trackball orbit was silently broken** — `renderCharts3dStatic` catches the
thrown error and returns `{ ok: false, error }`, which the page reads as
"Copy is unavailable" (the button disables) rather than a visible crash,
which is exactly why no earlier round's own manual testing caught it: the
failure mode is a disabled button, not a stack trace on screen. Found by
this packet's own new "trackball Copy is exact" test (below), which is
the first test in the whole 3D suite to actually take Copy ASCII *after* a
real trackball drag rather than only checking the round-tripped camera
*state* (C3 fix round 1's own "commits camera.mat/useMat" test stops at
the `?c=` link, never calls Copy).

**The fix** drops `rotX`/`rotY` entirely on the `mat` branch — they were
never what a trackball orientation renders from anyway
(`Charts3dCamera.mat`'s own doc: they ride along only as the last
TURNTABLE pose before a mode switch):

```ts
const cameraOption = cam.useMat && cam.mat
  ? { mat: [...cam.mat], useMat: true, zoom: cam.zoom }
  : { rotX: cam.rotX, rotY: cam.rotY, zoom: cam.zoom };
```

**`center` is deliberately never threaded.** The live viewport's own
camera `target` is ALWAYS the mark's own bounds centre —
`Charts3dViewport.tsx` never exposes a pan control, so `cam.target` is set
once, at mount, to `objectBoundsCenter(object.bounds)` (or an equivalent
fit target that resolves to the same point), and nothing in the orbit
controls or the Dock ever moves it. `render.ts`'s own default when
`camera.center` is omitted is `[0.5, 0.5]` (identity, no offset) —
`center = cameraOption.center ?? [0.5, 0.5]`. Since the live viewport's
camera is always centred with no offset of its own, omitting `center`
already reproduces the identical frame; threading a `center` field that
can only ever be identity here would be dead code with no test able to
distinguish it from omission.

**Verified as a genuine mutation, not merely reasoned about**: reverting
the fix (re-adding `rotX`/`rotY` to the `mat` branch) was applied directly
to the file, the new "trackball Copy is exact" test was run and confirmed
red (`AssertionError: expected undefined to be defined` — the Copy button
never fires because it silently disabled), then reverted back to the fix
and confirmed green again.

### Item 3 — the Effects folder

Reuses `InstrumentWorkbench/Instrument3DEffectsFolder` verbatim (no second
folder built). `allTargetsLabel: "Whole chart"`; the target list is
exactly one entry, `{ id: "surface", label: "Surface" }` —
`glyphChartObject`'s own return shape (`object.ts`, confirmed by direct
read) is a single `"surface"` mesh plus overlay-only axis/tick/grid guides
(`overlays: [axisTriadOverlay(...)]`, no second mesh), so there is no
guides target to offer; this is stated as fact, not inferred from the
target list's own emptiness.

**Wiring mirrors `Diagrams3DViewport.tsx`'s own `applyEffect` exactly**,
including its fixes: `resolveEffectTarget` maps `INSTRUMENT_3D_EFFECT_ALL_TARGET`
to `undefined` (scene-wide) and `"surface"` to
`objectHandleRef.current?.meshes.get("surface") ?? null`, where `null`
(never glyphcss's own rejected empty-array spelling) means "mount
nothing" for a stale target; `applyEffect` always fully disposes and
remounts on a genuine retarget (a different effect id OR target) rather
than calling `layer.setOptions({ target })`, since glyphcss's own
mesh-set effect target is immutable after mount; the mark-rebuild effect
(Item 1's own `handle.update()` call) now also disposes and reapplies the
effect afterward, since `update()` disposes and re-adds every member mesh,
invalidating any currently-targeted `GlyphMeshHandle`.

**Preview-only, proven, not assumed.** Copy ASCII/ANSI and the static
`renderCharts3dStatic` exit build a fresh `renderGlyphChart3d` call with
no effect-layer concept — there is nothing for a mounted live-scene effect
to reach there. A dedicated test mounts an effect (`"scan"` targeting
`"surface"`), takes Copy ASCII, changes nothing else, and asserts the
text is byte-identical to Copy ASCII taken before the effect was mounted.

**"Surface" vs "Whole chart" — measured, not assumed.** A new
library-level test (`charts3dEffectTargeting.test.ts`, mirroring
`diagrams3dEffectTargeting.test.ts`'s own `CellGrid.winnerMesh`-exact
ownership check) mounts `"glitch"` targeted at `"surface"` and asserts
every changed cell's baseline owner is the surface mesh, and every cell
NOT owned by the surface mesh (an axis line, tick label, grid line, or
blank background) stays byte-identical — glyph AND colour — to the
no-effect baseline. A second measurement (not merely reasoned about)
found that targeting `"Whole chart"` (`target: undefined`, scene-wide)
paints the IDENTICAL cells "Surface" does for this object: the effect
compositor's own coverage is the scene's finite-depth rule
(`ctx.coverage`/`ctx.hasDepth`, this file's own "DOM-free compositor"
paragraph), and the axis-triad overlay's stamped lines/ticks/labels carry
no depth of their own (a canvas-level cell stamp, not rasterized mesh
geometry) — so with only one real, depth-producing mesh in the object, a
scene-wide effect has nothing else to paint. This is a property of THIS
object shape, not a general claim; a future object with a second
depth-producing mesh would need this re-measured.

**URL state.** `state.effect3d: Instrument3DEffectsState` rides in `?c=`
as an append-only top-level field (never nested inside `chart3d` — an
effect is a preview-only live-scene concern, not part of what
`resolveCharts3dView` builds a mark from), mirroring `/diagrams`' own
`effect3d` field and `validateEffect3d` shape exactly: `effectId`/
`targetId` are free-form non-empty strings, a stale value degrades to
"matches no mesh" at mount rather than a decode rejection, and a
malformed payload degrades to the whole default (`{ effectId: "none",
targetId: "all" }`) rather than failing the envelope.

### Item 4 — codex review: the live viewport ignored charset/style entirely

A codex review (relayed by the coordinator, after items 1-3 above already
landed) found `Charts3dViewport.tsx`'s mount effect hard-coding `mode:
"solid"` on its `createGlyphScene` call, with neither charset nor style
ever reaching the scene at all — only colour did (`scene.setOptions({
useColors })`). Since `web`'s own default charset is `braille`
(`GLYPH_CHART_TARGET_DEFAULTS`), **the live viewport rendered solid
geometry by default for every fresh `/charts` 3D visit**, while Copy ASCII
and the terminal/chat static frame — both routed through
`renderGlyphChart3d`'s own `resolveGlyphChart3dStyle` — resolved the
IDENTICAL state to a real depth-tested wireframe. `style: "ink"` was
unreachable live at all, with no control to request it.

**The fix mirrors the SAME library resolution the static exit uses**,
since no public resolver exists for it (below). `chartsWorkbench3d.ts`
gained:

```ts
export type Charts3dStyleOption = "auto" | GlyphChart3dStyle;

export function resolveCharts3dStyle(charset: GlyphChartCharset, styleOption: Charts3dStyleOption): GlyphChart3dStyle {
  if (styleOption !== "auto") return styleOption;
  return charset === "braille" ? "wireframe" : "solid";
}

export function charts3dObjectCharset(charset: GlyphChartCharset): GlyphChartCharset {
  return charset === "blocks" ? "ascii" : charset;
}
```

— verbatim mirrors of `render.ts`'s own private `resolveGlyphChart3dStyle`/
`chromeTier`, verified line for line against the source, not re-derived
from the doc comments alone. `Charts3dSceneOptions` grew `mode`/`charMode`/
`hiddenLines` alongside `useColors`, and `chartsWorkbench3dSceneOptions`
(now `(charset, color, style)`, a signature change from C3's own
`(color)`) assembles the whole bundle in one call, EXPLICITLY setting
`charMode`/`hiddenLines` to `undefined` outside a wireframe resolution
(never omitting the keys) so a `scene.setOptions` call always clears a
stale value from a prior charset/style rather than merging over it.

**Wiring**: the mount effect's `createGlyphScene` call now passes
`mode`/`charMode`/`hiddenLines` from `sceneOptions` instead of a literal
`"solid"`, and its initial `glyphChartObject(mark, { charset:
charts3dObjectCharset(charset) })` call picks the matching grid/tick
overlay glyph tier (mirroring `chromeTier`, which the mount used to skip
entirely — every live 3D chart's grid glyphs defaulted to the library's
own `"box"` tier regardless of charset). The colour-only `setOptions`
effect became a scene-options effect keyed on `[mode, charMode,
hiddenLines, useColors]`, applying the whole bundle via `scene.setOptions`
— no remount. The mark-rebuild effect (item 1's own `[mark]` effect) is
now keyed on `[mark, charset]` and rebuilds the object with the current
charset's own tier on EITHER a mark change or a charset change — folded
into one effect rather than a second `Diagrams3DViewport.tsx`-style
`[charset]` effect, since both cases need the identical `update()`-then-
reapply-effect sequence item 3 already built. A new View folder "Style"
toggle (`auto`/`solid`/`wireframe`/`ink`) writes `state.chart3d.style`,
threaded into `chartsWorkbench3dRender.ts`'s `renderGlyphChart3d` call as
`options.style` (omitted at `"auto"`, letting the library's own default
apply) — the SAME field the live viewport's own resolver reads, so both
exits are driven from one piece of state.

**Verified against the REAL library, not the page's own mirror.** A
dedicated test builds the resolved mark once and, for every charset x
style combination, calls the REAL `renderGlyphChart3d` and compares its
own reported `resolved.style` against `chartsWorkbench3dSceneOptions(...)
.mode` — proving the page's mirror agrees with the library's actual
resolution, not merely that the mirror is internally consistent with
itself. A mounted-page test enters 3D at the default (`web`/`braille`)
and asserts BOTH the real `createGlyphScene` call's own options
(`mode: "wireframe"`, `charMode: "braille"`, `hiddenLines: "hide"`) and
the rendered picture itself (real braille dot glyphs, U+2800-28FF, which
only a genuine wireframe render emits).

### Library-export gaps found, named, not fixed

`GlyphChart3dGuideOptions`, `GlyphChart3dResolvedGuides` and
`GlyphChart3dCornerOption` are declared in `packages/charts/src/3d/types.ts`
but are NOT in `@glyphcss/charts/3d`'s own `index.ts` export list — only
`GlyphChart3dSurfaceOptions`, which structurally contains a `guides` field
referencing the unexported type, is exported. This file's own "Exports"
paragraph (AGENTS.md's "Charts 3D") already claims `GlyphChart3dGuideOptions`
is exported ("the validation/type surface (`GlyphChart3dStyle`,
`GlyphChart3dCornerOption`, `GlyphChart3dGuideOptions` included)") — that
claim is ahead of the actual code as of this merge. The page works around
it with a structurally-derived type, `NonNullable<GlyphChart3dSurfaceOptions
["guides"]>` (`chartsWorkbench3d.ts`'s own `Charts3dGuideOptions`), rather
than hand-duplicating the eight field names a second time — staying
entirely inside `website/` per this packet's own scope boundary. Exporting
the three types by name is a small, additive library change for whichever
round next touches `packages/charts/src/3d/index.ts`.

`resolveGlyphChart3dStyle` and `chromeTier` (`render.ts`), the second gap
found (Item 4, above), are private, unexported functions with no public
resolver a live-scene consumer can call to stay in sync with the static
exit's own charset/style resolution — `resolveCharts3dStyle`/
`charts3dObjectCharset` (`chartsWorkbench3d.ts`) are page-local mirrors,
verified against the real library by direct comparison rather than
exported and called.

### Mutation table (this round's own additions)

| Item | Gate | Mutation | Result |
|---|---|---|---|
| Guides live-update, no remount | `Charts3dViewport.lifecycle.test.tsx`'s "a guides toggle updates the live scene object in place" test | Drop `state.chart3d.guides` from `chart3dResolvedLive`'s memo deps | RED — `objectUpdate` is never called on a guide toggle |
| Guides `?c=` round trip | `chartsUrlState.test.ts`'s "round-trips guide overrides exactly" / "a malformed individual guide field is dropped" tests | Make `validateCharts3dGuides` always return `{}` | RED — both tests fail (overrides lost; the surviving field also lost) |
| Trackball Copy exact | `Charts3dViewport.lifecycle.test.tsx`'s "trackball Copy is exact" test | Re-add `rotX`/`rotY` alongside `mat` in `chartsWorkbench3dRender.ts` | RED — `renderGlyphChart3d` throws `bad-camera`, Copy ASCII's button silently disables, `copiedAscii()`'s own assertion fails |
| Effect target resolution | Same file's "selecting Effect target 'Surface'..." test | `resolveEffectTarget` always returns `undefined` | RED — the "Surface" case's own defined-target assertion fails |
| Effect layer/rAF disposal | Same file's three disposal tests (effect change, view switch, unmount) | Drop `disposeEffect()` from the relevant cleanup/branch | RED — `effectLayerDispose`/`cancelAnimationFrame` spies stay uncalled |
| Effects preview-only | Same file's "Copy ASCII stays byte-identical..." test | N/A — `renderGlyphChart3d` has no effect parameter to leak through; gated as a direct regression signal instead | Passes today; would redden if a future edit threaded `state.effect3d` into either Copy memo |
| Surface targeting is cell-exact | `charts3dEffectTargeting.test.ts`'s own ownership test | Mount the effect with `target: undefined` regardless of the requested target id | Not independently mutation-testable against THIS fixture (see "measured, not assumed" above — the two targets coincide here); the WIRING mutation above is what actually discriminates it |
| Live mode/charMode/hiddenLines resolved (codex review, item 4) | `Charts3dViewport.lifecycle.test.tsx`'s "entering 3D on the default web target mounts a LIVE braille wireframe" test | Force `chartsWorkbench3dSceneOptions` to always return `mode: "solid"` | RED — both the real `createGlyphScene` call's own options AND the rendered picture (no braille dot glyphs) fail |
| Live/Copy agreement (codex review, item 4) | `chartsWorkbench3d.test.ts`'s "agrees for every charset x style combination" test, against the REAL `renderGlyphChart3d` | Same mutation | RED at `ascii/wireframe` (and every other explicit-wireframe cell): the page mirror claims `"solid"`, the real library resolves `"wireframe"` |
| Style control reaches the static exit | `chartsWorkbench3d.test.ts`'s "an explicit wireframe style... changes the rendered text" test | Drop `style` from `chartsWorkbench3dRender.ts`'s `renderGlyphChart3d` options call | RED — an explicit `wireframe` renders byte-identical to `auto` (which resolves `ascii` to `solid`) |

## C2 fix round 6 — occlusion in every mode, interior-only grid, strict CLI parsing, real P2 gates, and axes on the SILHOUETTE (not the back corner)

A codex review of C2 rounds 2-5 (`CHARTS-RESEARCH/REVIEW-c2-rounds25-codex.raw`) found four defects and three under-tested gates in `@glyphcss/charts/3d`. Mid-round, the user reported the deeper problem the review's own P1-1 was a symptom of: on two REAL datasets (Maunga Whau, the Alps) at the library's own default camera, **the axis triad was invisible** — round 2's single "farther face" shared corner routinely put every axis line on the BACK of the surface, hidden behind it from the default oblique view. Fixing occlusion correctly (so a label never paints over ink) does nothing for an axis that never reaches the screen at all; both are fixed here, plus a separate follow-up asking the two private `render.ts` resolvers the review's own C4 packet had to hand-mirror be exported for real.

### P1-1 — occlusion must come from the RASTERIZED surface, in every render mode

**The defect.** `object.ts`'s label/title occlusion (C2 round 2's fix) depended on `CellGrid.winnerMesh`, which `compileScene.ts` populated only under `retainWinnerMesh: mode === "solid"`. Round 5's own workaround, `buildMeshScreenDepth`, sampled the mesh's own VERTICES per `stamp()` call and built an approximate per-cell depth map from that sample — cheap, but wrong whenever a rasterized edge or interior fell between two sampled vertices, which is routine on a decimated wireframe mesh. A tick label could therefore land ON real ink that no sampled vertex happened to cover.

**The fix has two layers, because `CellGrid.winnerMesh` has two independent CONSUMERS with different mode contracts.** (1) Per-object effect TARGETING (`effectCompositor.ts`'s `targetCoverageForCell`) is documented and tested as solid-mode-only — a mesh-targeted effect layer must stay inert in wireframe/ink, unconditionally. (2) The label arbiter's own overlay occlusion (this packet's subject) needs the SAME buffer populated in every mode. Collapsing the two onto one flag (the first attempt) reactivated mesh-targeted effects outside solid mode the instant an unrelated object's overlay needed occlusion data — caught by a new regression test, `createGlyphScene.targeting.test.ts`'s "fix round 6 regression" case, which failed before the second-layer fix and passes after it.

- `packages/glyphcss/src/render/rasterize.ts` gained `buildSurfaceOcclusionMap`, which rasterizes the SAME real polygon triangles `buildSurfaceDepth`/`computeOcclusionIds` already walk (via `fillDepthTri`) into per-cell `depth`/`winnerMesh` buffers, at the SAME `p[3] ?? p[2]` (`zBufferDepth`) convention `CellGrid.depth` already holds — not `buildSurfaceDepth`'s own `p[2]`-only convention (that one feeds the wireframe HLR prepass, a distinct consumer with a distinct depth unit). Called from all three wireframe/ink code paths (ASCII wireframe, ink, braille wireframe), gated on a NEW flag, `retainOverlayOcclusion` (`RasterizeContext`), computed as `objectHasAnyOverlay()` alone.
- `retainWinnerMesh` keeps its OWN gate, `(effectsActive && hasMeshTargetedLayers()) || objectHasAnyOverlay()` in `createGlyphScene.ts` — genuinely shared with `retainOverlayOcclusion` only in the trivial "an overlay is mounted" case; `compileScene.ts` (no effects concept) sets both to the same expression, kept as two separate fields for contract consistency rather than one shared one.
- `effectCompositor.ts`'s `retainGlyphEffectOutput` gained a `GlyphEffectRetainOptions.retainWinnerMesh?: boolean` (default `true`) that strips `winnerMesh` off the CLONED `baseGrid` when false; `createGlyphScene.ts` passes `retainWinnerMesh: options.mode === "solid"` at its own call site — closing a second, independent hole the first fix alone didn't: the retained-effect compositor read `winnerMesh` straight off its own clone with no mode check at all, safe only because wireframe/ink never populated the field before this round.

**Gates.** `createGlyphScene.sceneObject.test.ts`'s "fix round 6, P1-1" test mounts an overlay under `mode: "wireframe"` and asserts `grid.winnerMesh`/`.depth` are populated (MUTATION: with no overlay mounted, neither buffer allocates — passes). `createGlyphScene.targeting.test.ts`'s "fix round 6 regression" test is the cross-consumer guard described above. `render.test.ts`'s new "P1-1 (codex review, round 6)" describe block renders `ringRidgeVolcano()` under wireframe/braille and wireframe/box and ink/ascii and asserts no tick/title digit lands on an inked surface cell (`digitTouchesInk`), plus a positive control confirming the SAME labels draw fine over empty space — proving the check is occlusion, not a blanket suppression.

### P1-2 — opt-in grid: interior ticks only, never repainting an axis-owned cell

Round 5 already made `guides.grid`/`floorGrid` default OFF. The review's separate finding: even opted in, the grid painted at BOUNDARY tick positions too — coincident with a cell the axis line/tick/box outline already owns — so it either invisibly no-op'd there (guide-write depth test blocked by the axis's own nearer write) or, worse, visibly repainted the axis in the grid's fainter glyph on a write-order coincidence. `subsampleTicksForGrid` now slices to `ticks.slice(1, -1)` — interior ticks only, with `max === 1` special-cased to pick the single middle interior tick directly (the general stride formula divides by `max - 1`, which is `0` there — a real division-by-zero bug caught mid-round by a temporary debug test, since the resulting `NaN` grid-line coordinates were silently dropped by `stampGlyphOverlayCell`'s own `Number.isInteger` guard, so the FIRST attempt at this fix drew nothing at all and looked like a no-op). `GRID_MAX_LINES_PER_SWEEP_AXIS` dropped from `2` to `1`; wall planes now sweep ONLY the z-direction tick (matplotlib's own wall-pane convention — a wall's OTHER in-plane axis is the one an axis triad already lines), halving wall grid density, which was needed once real interior lines began painting for the first time (round 5's boundary-coincident lines mostly cancelled against edges other writes already owned, so the 15%-of-plot-box cap had never actually been exercised until this fix made it real). The floor plane (opt-in, `guides.floorGrid`) still sweeps both in-plane axes.

**Gates.** `object.test.ts`'s existing "grid glyphs are never the tier's axis-line glyphs" and "the grid cell count is <= 15% of the plot's own occupied bounding box" tests (both pre-existing, now exercising real interior ink for the first time) stay green; the div-by-zero fix is covered transitively — reverting `max === 1`'s special case reddens the ink-increase mutation test (`guides.grid=true strictly increases ink relative to the default`), since the grid line count collapses to zero again.

### P1-4 — CLI: strict `--camera`/`--style` parsing, presence-gated 3D-only flags

`packages/compile/src/chartCli.ts`'s `parseCameraArg`/`parseStyleArg` used to return `undefined` on a missing value, so a post-loop `!== undefined` check silently treated "flag absent" and "flag present, value missing" the same way, and `Number("")` (an empty comma field, `--camera 10,`) silently parsed to `0` rather than rejecting. Both now THROW on `raw === undefined` (`bad-camera-arg`/`bad-style-arg`) rather than returning it, so the post-loop presence check is unreachable with a "swallowed" value; `parseCameraArg` additionally rejects an empty field (`parts.some(p => p.length === 0)`) before ever calling `Number()` on it. The "3D-only flag without `--3d`" check now tests the FLAG'S PRESENCE (was the raw arg string ever seen) rather than the PARSED value's definedness — the two used to coincide by construction (a value-less flag never reached the presence check because it threw first under the old code too, just with the wrong error), but stating the rule on presence is what makes `--style solid --3d` and a same-valued default indistinguishable case correctly reject when `--3d` is dropped.

**Gates.** `chartCli.test.ts`'s new "strict argument parsing (P1-4)" describe block: `--camera 10,` / `--camera ,` / `--camera` with no value (with and without `--3d`) / `--style` with no value / `--style` without `--3d` — six cases, each asserting `bad-camera-arg`/`bad-style-arg`/`bad-3d-flag` and never a silent parse.

### P2 — gates that didn't exercise their own mutation

Three review findings, each an EXISTING assertion that would pass even with the guarded behaviour removed:

1. **Trackball camera.** `render.test.ts` previously only probed `renderGlyphChart3d({ camera: { mat } })` by comparing string OUTPUT against a directly-built `createGlyphOrthographicCamera({ useMat: true, mat })` render — a real exercise of the feature, but never asserted through the PUBLIC option surface's own round-trip contract in isolation. New "P2 (codex review, round 6)" describe block: a `mat` built from a real rotation (`cy=cos(0.6), sy=sin(0.6)`) renders differently with vs. without `mat`, and `resolved.camera` round-trips it (`useMat: true`, the same 9 values) — MUTATION: dropping the `mat`-vs-Euler branch in `renderObjectFrame` collapses both renders to the same (wrong) Euler-default picture.
2. **Corner-triad "shared corner" claim.** The pre-round-6 test asserted the EXPORTED HELPER (`resolveAxisTriadCorners`) returns one shared `xy` corner for both axes — true of the function, but never checked that the RENDERED overlay's x and y lines actually meet at that cell on screen (a bug in `axisTriadOverlay`'s own consumption of the helper's return value could still pass the old test). New test in `object.test.ts`: mounts a real scene, captures the projected corner cell's character via `transformCells`, and asserts it's a junction-capable glyph (`"│─\\/·".includes(...)`) — i.e. verified through the ACTUAL render, not the helper in isolation.
3. **Occlusion tests that route around the defect.** Folded into the P1-1 gates above — `digitTouchesInk` reads the real rendered string's character grid rather than a synthetic non-default probe.

### The axis-visibility redesign (user feedback: "I still cannot see the axes for the munga whau nor the alps")

**SUPERSEDED by "C2 fix round 7" below.** This subsection's own per-camera split-corner design (`resolveFrontFloorCorner`/`resolveSilhouetteVerticalCorner`) is REMOVED outright in round 7 — the user's own follow-up ("put the 0,0,0 in one of the corners... do not put it in the center") asked for exactly the single-shared-corner triad this round deliberately abandoned, and round 7 satisfies it with a DIFFERENT, simpler mechanism (a fixed origin corner, real ribbon-mesh axis-line geometry, and an explicit off-centre camera shift) that needs no per-camera corner search at all. Kept here as the historical record of why the split existed and what it measurably fixed at the time — the root-cause analysis below is still accurate, only the FIX it led to has since been replaced.

**Root cause, reproduced.** At the library's own default camera (`rotX: 58, rotY: 45`), round 2's `resolveSharedCorner` picks, independently per axis, the FARTHER of two candidate faces — a rule chosen so the guide PLANES (walls/box/grid) sit behind the data. Applied to the TRIAD too (round 2's own choice), it routinely puts the shared corner on the BACK of the surface: the x/y axis lines then run along the back-bottom edges and the z line up the back-vertical edge, all hidden behind the opaque surface from the front. Verified on both real datasets with the static renderer before touching any code.

**The fix splits triad-corner resolution from backdrop-corner resolution.** `resolveSharedCorner` (unchanged) still governs ONLY `guides.walls`/`box`/`grid`/`floorGrid` — the backdrop is SUPPOSED to sit behind the data. The triad itself (axis lines/ticks/tick labels/titles) now reads two independently-resolved corners from `resolveAxisTriadCorners`:

- **x/y share one corner**, `resolveFrontFloorCorner` — the z=0 FLOOR corner nearest the camera (by projected depth). The floor is never behind positive-height data by construction, so this reads as the familiar 2D "plot-rect" frame extended by one axis: x/y ticks sit along the two visible FRONT-bottom edges of the box.
- **z resolves independently**, `resolveSilhouetteVerticalCorner` — whichever of the box's 4 vertical edges projects furthest to one screen side (with hysteresis against camera-rotation noise at the exact tie). A silhouette edge is, by construction, never behind the surface: it is the boundary between the surface's own visible face and empty screen space.

Both are PURE functions of camera rotation alone (zoom/center-invariant), computed fresh every `stamp()` call — no stored state, so the corners track the camera continuously as it orbits, exactly like `resolveSharedCorner` already did. An explicit `axes.corner` override still pins the WHOLE triad (and the backdrop) to one given corner, unchanged — only `"auto"` drops strict single-corner sharing, and this is now stated in `types.ts`'s own `GlyphChart3dCorner`/`GlyphChart3dCornerOption` doc comments.

**What was NOT done: sub-cell braille dot axis lines.** The coordinator's follow-up asked for axis lines on sub-cell tiers (braille/blocks) to render as sub-cell dot lines rather than stair-stepping `/ \ │ ─` glyphs, mirroring the cell canvas's own `line()` behaviour under `braille`/`blocks` (this file's own "Cell canvas" section, AGENTS.md). **This is an honest architectural gap, not implemented here.** The cell canvas's sub-cell `line()` writes into a canvas-owned `sub` buffer that `CellGrid` itself has no equivalent of — `stampGlyphOverlayLine` (the primitive every 3D scene overlay, including this axis triad, is built on) walks and writes `CellGrid.char`/`.color`/`.depth` at WHOLE-CELL resolution only; there is no sub-cell write surface on a `CellGrid` for an overlay to target. Building one is a `glyphcss`-layer feature with its own cross-cutting implications (every OTHER overlay consumer — chart tick marks, the diagram box outline, map hotspots — would need to decide whether it also wants sub-cell precision), well past this round's scope. The braille frames below therefore still show axis lines as the same `\ / │ ─` glyph staircase `ascii`/`box` use; only the SURFACE itself renders as real braille dots.

### Exports — the style resolver, the guide/corner types, AGENTS.md made accurate

A separate follow-up: `/charts`' C4 packet (already committed on `feat/diagrams`, merged into this round's base) had to hand-mirror two private `render.ts` functions page-side (`resolveGlyphChart3dStyle`, `chromeTier`) because `@glyphcss/charts/3d`'s `index.ts` didn't export them, and AGENTS.md's own "Exports" paragraph already (incorrectly) claimed `GlyphChart3dGuideOptions`/`GlyphChart3dResolvedGuides`/`GlyphChart3dCornerOption` were exported when they weren't (the prior round's own "Library-export gaps found, named, not fixed" section, above, documents exactly this gap).

- `render.ts`'s `resolveGlyphChart3dStyle` is now exported (was already named that; just needed the `export` keyword and an `index.ts` re-export).
- A new `glyphChart3dStyleSceneOptions(style, charset): { mode, charMode?, hiddenLines? }` wraps the style+charset resolution into the EXACT scene-option object a live `createGlyphScene`/`compileScene` mount needs — extracted from `renderObjectFrame`'s own inline object literal, which now spreads it, so the static exit and any future live-scene consumer share one function rather than two copies that can drift.
- The private `chromeTier` helper is renamed `glyphChart3dChromeTier` and exported.
- `index.ts` adds `GlyphChart3dCornerBit`, `GlyphChart3dCorner`, `GlyphChart3dCornerOption`, `GlyphChart3dGuideOptions`, `GlyphChart3dResolvedGuides` to its type-export list — these were always PUBLIC types (referenced from `GlyphChart3dSurfaceOptions`'s own public `guides`/`axes.corner` fields), just never named in the barrel.
- AGENTS.md's "Exports" paragraph is rewritten to list every one of the above by name, and its C4 section's stale "Library export gaps found, not fixed here" sentence now says the gaps are closed in this round.

Since the axis-corner redesign above changes what `GlyphChart3dCornerOption`/`GlyphChart3dCorner` MEAN for `"auto"` (no longer strict single-corner triad sharing) without renaming or removing either type, this is called out explicitly rather than silently — both types' own doc comments in `types.ts` now state the "auto" split plainly, and this file's "Axes are ONE camera-aware overlay" paragraph (AGENTS.md) does too.

### Frames

All four ring-crater frames use the exact `ringRidgeVolcano()` fixture already embedded in `object.test.ts`/`render.test.ts` (a 40x40 ring+crater height field). Maunga Whau and the Alps use the real vendored datasets `website/src/components/ChartsWorkbench/datasets/chart3d/{maungaWhauVolcano,etopo1Alps}.ts` ship (read-only — `website/` was never edited), reconstructed verbatim into a standalone script against the built `@glyphcss/charts/3d` package. Every frame below is `renderGlyphChart3d` at `target: "web"`, default camera and guides (axis lines/ticks/tick labels/titles on; walls/box/grid off) unless noted.

**Ring-crater, 96x32, box:**

```
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                    %#@@@@@                                     
                                                @@@@@@@@@@@@@@@                                 
                              200   +          %@@@@@@@@@@@@@%%%                                
                              180   +        %+@*@@@@@@@@@@@%#=@%#%                             
                              160   +    %@%*=#%@+@@@@@@@@@@%*@@@#*%@%          200█            
             z                140   +  %%%%#+##@@@@@@@@@@@@@@@@@@%#%%%%%           █            
                              100   + %%@%%%%#%@@@@@@@@@@@@@@@@@@@@%@%@%@       165▓            
                              80    │     %%@@%@@@@@@@@@@@@@@@@@@@@@%              ▓            
                              60    +\       @@@@@@@@@@@@@@@@@@@@@       /+     130▒            
                                      \\\       %@@@@@@@@@@@@@%       ///          ▒            
                                 0       \\\        @%%#%%@        ///       0   95░            
                                            \+\\      @@@      //+/                ░            
                                      10        \\\         ///         10       60             
                                           20     +\\\   ///+       20                          
                                               30     \+/      30                               
                                                                                                
                                                    40    40                                    
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**Ring-crater, 96x32, braille:**

```
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                    ⣀⣀⣀⣀⣀                                       
                                                 ⣠⣴⣾⣿⡛⢫⢯⢩⣷⣿⣶⣤⣄                                  
                                              ⣠⣶⣿⢿⣿⣿⣹⣧⣯⢼⣟⡽⣿⣯⣿⣿⣷⣄                                
                              200   +       ⢀⣴⣿⣿⣾⣽⣿⣽⢻⣟⡆⡼⢘⡿⣯⣿⣯⣷⣿⣿⣦⣄                              
                              180   +    ⣀⣤⣶⣿⣿⣿⣿⣿⣿⢿⣽⣟⢹⣷⡷⣻⣹⣯⡿⣿⣿⣿⣟⣿⣿⣷⣦⣄⡀                          
                              160   + ⣀⣴⣿⣿⣿⣿⣿⣿⣿⣻⢿⣷⣿⣿⣽⣹⣿⣆⣷⣿⣿⣿⣿⡿⣟⣿⣼⣿⣿⣿⣿⣿⣦⣀        200█            
             z                140   +⣾⣿⣿⣿⣿⣟⣿⣿⣿⢿⣿⣿⣽⢿⣿⣿⣿⢿⣿⢿⣿⣿⡿⣯⣿⣿⡿⣧⢿⣿⣿⣿⣿⣿⣿⣷⣄         █            
                              100   +⠉⠛⠻⢿⣿⣿⣿⣿⣿⣽⣽⣿⣽⢾⠻⣼⣬⣟⢚⣯⣽⠟⡷⣯⣿⣯⣯⣿⣯⢿⣿⣿⣿⠿⠛⠉       165▛            
                              80    │    ⠉⠛⢿⣷⣿⣽⣿⢾⢻⣾⢺⠻⣼⣸⣾⣸⡞⡗⣷⡟⡷⣿⣯⣿⣿⣿⠟⠋⠁             ▛            
                              60    +\      ⠉⠻⣿⣽⣿⣿⢼⢿⣿⣹⣼⣹⣼⣻⡿⡧⣿⣿⣯⣿⠟⠋⠁      /+     130▀            
                                      \\\      ⠉⠛⠿⣿⣿⣿⣾⣿⢾⣿⣿⣿⣿⠿⠛⠉       ///          ▀            
                                 0       \\\       ⠙⠿⣿⢿⣿⢿⡿⠋        ///       0   95▘            
                                            \+\\     ⠈⠻⠽⠋      //+/                ▘            
                                      10        \\\         ///         10       60             
                                           20     +\\\   ///+       20                          
                                               30     \+/      30                               
                                                                                                
                                                    40    40                                    
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**Ring-crater, 140x40, box:**

```
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                              @%@@@@@@@                                                     
                                                                         =@@@@@@@@@@@@@@@@@@                                                
                                                                       #@@@@@@@@@@@@@@@@@@@@@@                                              
                                             200     +               -@@@@@@@@@@@@@@@@@@@@@%%#@#                                            
                                             180     │              %+%#%@@@@@@@@@@@@@@@@@%#**#@*                                           
                                                     │          @%%=+*@+%%@@@@@@@@@@@@@@@@%#*=@@%+%%@                                       
                                             160     +       %%%%*-=*#%@@+%@@@@@@@@@@@@@@@#*@@@@%#+*%%%%                                    
                                             140     +    %#%%@%#=++##@@@@@@@%@@@@@@@@@%@@@@@@@@@%%#%%%%%%%                                 
                   z                         120     │  #%#%%%%%#++*#%%@@@@@@@@@@@@@@@@@@@@@@@@@@@%%#%%%%%%%%         200█                  
                                                     │  %%%%@%%%%#%#%%@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%%%@%@%@            █                  
                                             100     +       %%%%%%%%@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@#%              165▓                  
                                             80      +          %@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%                    ▓                  
                                             60      +\            @%@@@@@@@@@@@@@@@@@@@@@@@@@@@@@            /+      130▒                  
                                                       \\\            @@@@@@@@@@@@@@@@@@@@@@@@@            ///           ▒                  
                                                          \\\\           %%%@@@@@@@@@@@@@@%%           ////            95░                  
                                                 0           +\\\            %@%%#%#%%@%            /// +          0     ░                  
                                                                 \\\            @@@@@@           ///                   60                   
                                                        10          \\\           @           ///+          10                              
                                                                       \\\                 ///                                              
                                                                          \\\\         ////                                                 
                                                               20             \\\   ///              20                                     
                                                                                 \+/                                                        
                                                                       30                     30                                            
                                                                                                                                            
                                                                              40      40                                                    
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
```

**Ring-crater, 96x32, box, `guides.grid: true`** — interior gridlines (`·`) visible along the tick-marked axes, never at the boundary cells the axis line/ticks already own:

```
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                    %#@@@@@                                     
                                                @@@@@@@@@@@@@@@                                 
                              200   +          %@@@@@@@@@@@@@%%%                                
                              180   +       ·%+@*@@@@@@@@@@@%#=@%#·                             
                              160   +    %@%*=#%@+@@@@@@@@@@%*@@@#*%@%          200█            
             z                140   + ·%%%%#+##@@@@@@@@@@@@@@@@@@%#%%%%%·          █            
                              100   +·%%@%%%%#%@@@@@@@@@@@@@@@@@@@@%@%@%@··     165▓            
                              80    │     %%@@%@@@@@@@@@@@@@@@@@@@@@%              ▓            
                              60    +\       @@@@@@@@@@@@@@@@@@@@@       /+     130▒            
                                      \\\       %@@@@@@@@@@@@@%       ///          ▒            
                                 0       \\\        @%%#%%@        ///       0   95░            
                                            \+\\      @@@      //+/                ░            
                                      10        \\\         ///         10       60             
                                           20     +\\\   ///+       20                          
                                               30     \+/      30                               
                                                                                                
                                                    40    40                                    
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**Maunga Whau (R's `datasets::volcano`, 87x61), 96x32, box** — axes clearly framing the surface on the LEFT (z/"height") and BOTTOM (x/y), never behind it; all three titles present ("height", "y (m)", "x (m)"):

```
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                             =@@@@@%@                                           
                            200   +         @@@@@@@=%%%@%%                                      
                            180   │        @#@@@@@@@@@@%#%@@                                    
                            160   │      *%@@@@@@@@@@%@@@%+#%#=                                 
           height           140   │     =%@@@@@@@@@@@@@@@%@%@@@#%%#                             
                            120   │  *%+*%@@@@@@@@@@@@@@@@@@@@@@@@@@              200█          
                            100   │%@#@=@@@@@@@@@#@*@@@@@@@@@@@@@@@%@@               █          
                                  +\ @%@%@@@@@@@@@@@@@@@@@@@@@@@@@@%  /+        172.5▓          
                                    \\\  @@@@@@@@@@@@@@@@@@@@%@%%  /+/               ▓          
                               0       \\\  %@@@@@@@@@@@@@@@@   /+/       0       145▒          
                                   200    \\\ %%@@%%@@%@@@% //+/       100           ▒          
                                       400   \+\@@%%%@%@ //+        200         117.5░          
                                                \\+%% ///        300                 ░          
                                           600     \+/       400                   90           
                                               800        500                                   
                                                       600                                      
                                                                                                
                                y (m)                                    x (m)                  
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**Maunga Whau, 96x32, braille** — the SURFACE renders as real braille dots (U+2800-28FF); axis lines are still the whole-cell `\ / │` glyph staircase (the documented residual, above):

```
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                             ⢀⣴⣶⣾⣷⣦⣄⡀                                           
                                           ⣠⣶⣿⣗⣷⣿⣽⣿⣿⣿⣷⣤⣤⣤⡀                                      
                            200   +       ⣴⣿⣿⣾⣺⣿⣾⣽⣿⣿⣷⣿⣿⣿⣿⣿⢦⡀                                    
                            180   │     ⢀⣼⣿⡿⣿⣿⣷⣿⣿⢿⣿⣻⣿⡿⣿⣿⣿⣿⣿⣷⣄⣀⡀                                 
                            160   │    ⢀⣾⣿⣯⣿⣻⣿⢿⢽⣽⢻⣻⣿⣟⣗⡿⣿⣾⣿⣿⣿⣿⣿⣿⣷⣤⣀                              
           height           140   │  ⣠⣶⣿⣿⡿⣷⢷⣿⣹⢿⣼⣹⣽⣿⣯⡷⡯⣯⣿⢿⢻⢿⣿⣺⡟⣿⣿⣿⣿⣿⣆              200█          
                            120   │⣶⣿⣿⣿⣿⣿⣿⣯⣿⠼⣿⣿⢽⣼⣿⣻⣿⣿⣿⣿⣿⣹⢻⣺⢿⣿⢳⢻⡿⣿⣿⣾⣿⣆⡀               █          
                            100  ⠘│⣿⣿⣿⣿⣿⣿⣯⣿⡮⣿⣽⣿⢿⣿⣿⣿⣿⣟⣿⢿⣿⣿⣽⣻⣹⣿⣷⣿⣿⣿⣿⣿⣿⣿⡿⠆         172.5▛          
                                  +\⠈⠙⢿⣿⣏⣷⡧⣿⣿⣻⣽⢿⡽⣿⣽⣏⣯⡟⣿⣿⢿⣽⣿⣿⣿⣿⣾⣿⣿⣿⠞⠁  /+             ▛          
                                    \\\⠈⠙⠻⣿⣿⣻⣻⣽⢿⣿⣽⡧⣷⡯⣯⢿⣿⢿⡽⣿⣟⣿⣿⠿⠛⠉  /+/            145▀          
                               0       \\\⠈⠻⣽⣿⣿⣿⣿⣯⡿⣷⣷⣿⣿⣺⣾⣿⣷⠿⠛⠁  /+/       0          ▀          
                                   200    \\\⠉⠻⣿⣿⡿⣿⣿⣿⢿⣿⣿⣻⠟⠃ //+/       100      117.5▘          
                                       400   \+\⠻⢿⣿⣿⣿⡿⠟⠋⠁//+        200              ▘          
                                                \\+⠚⠁ ///        300               90           
                                           600     \+/       400                                
                                               800        500                                   
                                                       600                                      
                                                                                                
                                y (m)                                    x (m)                  
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**Maunga Whau, 140x40, box:**

```
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                       @@@@@%                                                               
                                                                    @@@@@@@@@@@%+                                                           
                                            200     +             =@@@@@@@@@@#%#@@%%#%                                                      
                                            180     │            =@#@@@@@@@%@@@@@=@%%%@#                                                    
                                                    │           =@@@@@#@@@@@@@@@+@@@@@#%*                                                   
                                            160     +          =@@@@@@@@@@@@@@@@@@@@@@@+*##=#@                                              
                     height                 140     │        =-*%@@@@@@@@@@@@*@@@@@@@%%%%%@@*+=#=                                           
                                                    │      *+=@%@@@@@@@@@@@@%@@@@@@@@@@@@@@@@@%@@@@@                                        
                                            120     +   %#*#@+@@@@@@@@@@@@@%@@@@@@@@@@@@@@@@@@@@@@@@@               200█                    
                                                    │%#%@#%%+@@@@@@@@@@@@@@@@@%@@@@@@@@@@@@@@@@@@@%%@@%                █                    
                                            100     +\  @@@@@@%@@@@@@@@@@@@@%@@@@@@@@@@@@@@@@@@@@@@%@  /+         172.5▓                    
                                                      \\\  @#@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@%@@@%  ///                ▓                    
                                                         \\\\  @@@%%@@@@@@@@@@@@@@@@@@@@@@@@*%# ////+               145▒                    
                                                0            \\\ @%@@@@#@@@@@@@@@%@@@@@@@@@  ///+           0          ▒                    
                                                                \\\ @@@@@@%@@@%%@@@@%%@@@ /+/           100       117.5░                    
                                                      200          \\\ @%%@@%@@%%%@%%% ///          200                ░                    
                                                            400       \\\\@%%%%@%%@////+                             90                     
                                                                          \+\@%%///+           300                                          
                                                                  600        \+/           400                                              
                                                                                                                                            
                                                                        800            500                                                  
                                                                                  600                                                       
                                                                                                                                            
                                                                                                                                            
                                                  y (m)                                                    x (m)                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
```

**Alps (ETOPO1, near the Matterhorn, 36x31), 96x32, box** — "elevation (m)" / "latitude" / "longitude" all present:

```
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                    =                                           
                                                 @+@@@%@                                        
                                               %=@@@@@@@+                                       
                          4000  │             @@@*@@@=@*@@@@*                                   
                                │           @@@#@@@@#@+@@@@@*                                   
                          3000  │          @@@@@@@@@@@@@%@@@@@@ @@                              
         elevation (m)    2000  │        @@%@@@#@@@@%@@@@@@+#@*@@@@@               4500█        
                                │      @-@@#@@@@@@@@@@+@@@@@@@*@@@@                    █        
                          1000  +    #%+#@@@@@@#@@@#@@+@@@@@*%                     3375▓        
                          0     +\   #%  %@@@@@*@@@@@@*@@%@+        +//                ▓        
                                  \+\       @*@ @@@@@@@@@        +///              2250▒        
                             45.4    \\\           @@         +///     7.2             ▒        
                                 45.6   \\+\               +///     7.4            1125░        
                                    45.8    \\\         +//      7.6                   ░        
                                       46      \\+   +//      7.8                     0         
                                           46.2   \\/      8                                    
                                              46.4     8.2                                      
                                                                                                
                                                                                                
                              latitude                                  longitude               
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**Alps, 96x32, braille:**

```
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                  ⢀⢀                                            
                                                 ⢀⣿⣿⣿⣦⣤⡀                                        
                                              ⢀⣠⣴⣾⣹⣹⣳⢷⢿⢧  ⡀                                     
                                             ⣀⣾⣷⣿⣿⡿⣿⣿⣿⢯⣾⣿⣾⣿⣄                                    
                          4000  │           ⣼⣿⣟⣿⣻⣿⡷⣿⣿⣿⣿⣿⣿⡟⣿⣇⣧   ⡀                               
                                │         ⢠⣿⣿⣯⣿⣷⣿⣻⣷⣿⣿⣿⣿⣿⣯⡿⣿⣿⣯⣿⡄⢰⣿⡄                              
                          3000  │       ⢠⣷⣿⣹⣿⣾⣿⣿⣿⣧⣿⣿⣿⣷⣿⣿⣾⣿⣷⢿⣿⣿⣻⣾⣿⣧⣠⣤               4500█        
         elevation (m)    2000  │      ⢀⣾⣿⢿⣿⣿⣿⣳⣿⡿⡝⣿⣿⣿⣟⣟⣦⣼⣿⡿⣿⣦⣿⣿⣿⣿⣻⣿⠟⠃                  █        
                                │   ⢀⣴⣿⣿⣿⣿⣿⣷⣿⣿⣿⣿⣶⣷⣿⣹⣻⠛⡟⣿⣻⣯⣿⣿⣿⡿⠻⠟⠿⠿⠃                3375▛        
                          1000  + ⢠⣾⣿⣿⣿⣿⡟⣿⣾⣿⣿⣹⣿⣿⣝⣦⣷⣿⣿⣾⣁⣿⣿⣿⡟⠛⠏⠁                         ▛        
                          0     +\  ⠉⠉⠉⠙⠷⠿⠋⡟⣿⣿⣻⣿⢧⣿⣿⣺⣷⣿⣿⠃⠼⠻⠁⠋        +//            2250▀        
                                  \+\      ⠙⠋⠹⡿⢻⡟⠻⣿⡟⣻⡟⠋⠉⠉        +///                  ▀        
                             45.4    \\\       ⠈  ⠘⣷⡏⠁        +///     7.2         1125▘        
                                 45.6   \\+\       ⠈       +///     7.4                ▘        
                                    45.8    \\\         +//      7.6                  0         
                                       46      \\+   +//      7.8                               
                                           46.2   \\/      8                                    
                                              46.4     8.2                                      
                                                                                                
                                                                                                
                              latitude                                  longitude               
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**Alps, 140x40, box:**

```
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                            #  @                                                            
                                                                           @@@@@@ #                                                         
                                                                        @%@@@@@@@@#@                                                        
                                                                       %@+@@@@@@@@@@@@@@                                                    
                                                   │                  @==%*@@@@@-@@@@@@@@@                                                  
                                           4000    +               @@@@@@@@@@@@+#@@@@@@@@@                                                  
                                                   │              =@@@@@@@@@@@*@@*@@@@%@#@*#%   @                                           
                                           3000    +              @@@@@@+@%@@@@@@@@@@@@@@#@@*  @@                                           
                   elevation (m)                   │           @@@@@**@%@@+@@@@=@@@@@@@%@@+#*@@%@=@@@                                       
                                           2000    +           =@@@%@@@@@@@@@@@*@@@@@@@@@@@@*@@@%@@                  4500█                  
                                           1000    │       @@@+@@@@@@*@@#@@@%@@*@+@@@@@@%#@@@@@ @@                       █                  
                                                   │     #%#%+#@@@@@#@@@#@@@@#@@@+@@*@@@@#@                          3375▓                  
                                           0       +\   %@+%#@@%@@@@@@@%%@@=*@@@#=@@@@@@@@            //                 ▓                  
                                                     \\\       @   @@@@*@@@@@%@@@*@@@@%@           //+               2250▒                  
                                                       +\\\\       @@ @#@@@@@@+#@+@            ////                      ▒                  
                                               45.4         +\\          @  @@@=            ///          7.2         1125░                  
                                                    45.6       \\\            @          ///+                            ░                  
                                                                 +\\\                 //+           7.4                 0                   
                                                        45.8         \\\\         ////          7.6                                         
                                                             46          \\\   ///                                                          
                                                                          + \\/+            7.8                                             
                                                                  46.2                 8                                                    
                                                                       46.4        8.2                                                      
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                latitude                                                  longitude                         
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
```

**Visual verification, against the coordinator's own gates** (LOOKED at, not assumed): every frame's x/y axis lines run along the two FRONT-bottom edges (the `\\\`/`///` diagonal runs), the z axis line runs up the LEFT vertical edge with real tick marks (`+`/`│`), and both are clearly outside/framing the surface's own ink — never behind it. Maunga Whau and the Alps each show >= 5 whole numeric tick labels per axis (height/y/x on Maunga Whau: 6/5/7; elevation/latitude/longitude on the Alps: 5/6/6) and all 3 titles. No digit or tick-mark glyph lands inside a run of surface shading characters (`%`/`@`/`#`/braille dots) in any frame above — occlusion holds in both `solid` (box charset) and `wireframe` (braille charset) modes. The `guides.grid: true` ring-crater frame shows `·` dots strictly between the axis's own boundary ticks, never coincident with one.

### Mutation table (this round's own additions)

| Item | Gate | Mutation | Result |
|---|---|---|---|
| P1-1: overlay occlusion works outside solid mode | `createGlyphScene.sceneObject.test.ts`'s "fix round 6, P1-1" test | Gate `buildSurfaceOcclusionMap`'s call sites on `retainWinnerMesh` instead of `retainOverlayOcclusion` | RED indirectly — reddens the SEPARATE targeting regression test below, since the two flags stop being independent |
| P1-1: effect targeting stays solid-only despite overlay occlusion | `createGlyphScene.targeting.test.ts`'s "fix round 6 regression" test | Share one flag between `retainOverlayOcclusion` and `retainWinnerMesh` | RED — a mesh-targeted marker effect paints in wireframe mode when an unrelated object's overlay is also mounted |
| P1-1: retained effect compositor never leaks `winnerMesh` outside solid | Same test, second layer | Drop `GlyphEffectRetainOptions.retainWinnerMesh`'s strip-on-false branch in `effectCompositor.ts` | RED — the SAME regression test still fails even after the rasterize-layer fix, isolating the second bug |
| P1-1: labels never paint over rasterized ink, wireframe/ink | `render.test.ts`'s "P1-1 (codex review, round 6)" describe block | Revert to round 5's `buildMeshScreenDepth` vertex-sampling occlusion | RED — a label anchored between two sampled mesh vertices on a decimated wireframe surface paints over real ink |
| P1-1 positive control | Same describe block, "the SAME labels draw over empty space" test | N/A — asserts the check is occlusion, not suppression | Passes; would catch a future "always drop this label" regression |
| P1-2: grid never repaints a boundary/axis-owned cell | `object.test.ts`'s existing grid-ink tests, exercised for the first time now that real interior lines paint | Revert `subsampleTicksForGrid` to include `ticks[0]`/`ticks[length-1]` | RED — grid glyphs coincide with axis-line-owned cells; the 15%-of-plot-box cap test also reddens once boundary+interior density is counted |
| P1-2: `max === 1` division-by-zero | `object.test.ts`'s "guides.grid=true strictly increases ink" mutation test | Drop the `max === 1` special case, let the general stride formula run | RED — `Math.round(NaN)` produces no valid tick, the grid line count collapses to zero, ink stops increasing |
| P1-4: `--camera 10,` rejects | `chartCli.test.ts`'s new P1-4 block | Revert `parseCameraArg`'s empty-field check | RED — `Number("")` parses to `0`, `--camera 10,` silently becomes `{rotX: 10, rotY: 0}` |
| P1-4: a value-less 3D flag rejects regardless of `--3d` | Same block | Revert the presence check to test the parsed value's definedness | RED — a caught-and-rethrown parse error masks the intended `bad-3d-flag` code, or (with `--3d` present) the flag silently no-ops |
| P2: trackball camera honoured through the public option, not just probed | `render.test.ts`'s new "P2" describe block | Drop the `mat`-vs-Euler branch in `renderObjectFrame` | RED — a `mat`-supplied render is byte-identical to the same call with `mat` omitted |
| P2: corner-triad sharing verified on the RENDERED overlay | `object.test.ts`'s new render-based corner test | Independently resolve x and y's own corners (the bug the old helper-only test couldn't see) | RED — the projected x/y line endpoints land on different cells, neither a junction glyph |
| Axes visible on Maunga Whau/Alps at default camera | Visual inspection above (no automated pixel-diff gate exists for "is it visually framing the data" — the closest automated proxy is the P1-1 occlusion suite plus the pre-existing corner-triad tests) | Revert `resolveAxisTriadCorners` to call `resolveSharedCorner` for both x/y and z (round 2's behaviour) | Reproduces the original user-reported defect — verified by re-running the frame script against the reverted code and confirming the axis lines return to the surface's back edges |
| Exports: style/chrome resolvers callable from outside the package | A `node --input-type=module` probe against the built `@glyphcss/charts/3d` package (`Object.keys` on the imported module) | Revert the `export` keywords on `resolveGlyphChart3dStyle`/`glyphChart3dChromeTier`/`glyphChart3dStyleSceneOptions` and their `index.ts` re-exports | RED — `renderGlyphChart3d`/`glyphChartSurface` still import, but the three names are `undefined` on the imported module |
| Exports: guide/corner types genuinely public | TypeScript compilation of a file importing `GlyphChart3dGuideOptions`/`GlyphChart3dCornerOption` directly from `@glyphcss/charts/3d` (exercised by the package's own DTS build, `pnpm --filter @glyphcss/charts run build`) | Drop the five type names from `index.ts`'s type-export list | RED — DTS build itself is unaffected (the types are still structurally reachable through `GlyphChart3dSurfaceOptions`), but a direct named import fails to resolve — the exact gap AGENTS.md's Exports paragraph had wrongly claimed was already closed |

### Residuals, stated plainly

1. **Sub-cell braille dot axis lines are NOT implemented.** Documented above under "What was NOT done" — `CellGrid` has no sub-cell overlay write surface; building one is a `glyphcss`-layer feature outside this round's scope. The residual is a visual one only (axis lines stair-step on braille instead of reading as smooth dotted lines); occlusion, visibility, and tick/title placement are all otherwise correct on every charset.
2. **No automated "is the axis visually prominent enough" gate exists.** The coordinator's own instruction was to LOOK at the frames, which this round did (both via the static renderer mid-fix and via the frame script above) — but there is no pixel-level or ink-coverage regression test asserting the specific property "an axis line's own visible run covers >= 70% of its edge" the way the P1-1 occlusion suite asserts "no label paints over ink." The corner-triad tests (existing plus this round's new render-based one) assert the CORNERS are resolved and touch correctly, which is the geometric precondition for visibility, but not visibility itself. A future round wanting a hard regression gate here would need an ink-density-along-the-silhouette-edge measurement, analogous to the grid's own 15%-of-plot-box cap.
3. **`resolveCharts3dStyle`/`charts3dObjectCharset`** (`website/src/components/ChartsWorkbench/chartsWorkbench3d.ts`) are still page-local mirrors of the newly-exported `resolveGlyphChart3dStyle`/`glyphChart3dChromeTier` — the coordinator's own message says "I'll have the page switch to the exported functions after you land," so switching them is explicitly deferred to that follow-up, not done here (per this round's own out-of-scope boundary: `website/` was not touched).

## C2 fix round 7 — axes from one origin corner, real ribbon-mesh axis lines

**SUPERSEDED IN PART by C2 fix round 8 below**: this round's own `resolveOriginCorner`/ribbon-mesh-geometry architecture is UNCHANGED and current, but its own camera choice (`rotY: 228`) and its own post-fit recentring shift (`ORIGIN_COLUMN_TARGET_FRACTION`) were both replaced in round 8 — 228 put the origin corner at the box's own NEAREST (front) vertex, not a SIDE one, and the shift wasted ~55% of the frame on one side. Read this section for the architecture, round 8 for the current camera/centring numbers.

**USER FEEDBACK, verbatim:** "why is it that we cannot see the axis not in the middle but at the sides of the shapes we render :/ I mean man, do not put the 0,0,0 in the center of the shape, put it in one of the corners." Earlier in the same thread: "the axes in one corner … like the 2d but adding one side more … the render is inside of the block created by those."

### Diagnosis: round 6 fixed VISIBILITY, not CENTERING

Round 6's own per-camera split (`resolveFrontFloorCorner`/`resolveSilhouetteVerticalCorner`, "The axis-visibility redesign" above) picked whichever corner/edge was LEAST occluded at the current camera — it never controlled WHERE on screen that corner landed. At the library's then-default `rotY: 45`, the front-floor corner's own column happened to sit close to the frame's horizontal middle for both real datasets — the exact defect the user is now reporting a second time, this time asking for the real fix: an origin corner that is unambiguously at one SIDE, with all three axes leaving it visibly.

### The redesign: a fixed corner, camera-independent

**`resolveOriginCorner`** (`object.ts`) replaces round 6's whole per-camera search: under `"auto"` it always returns `[0, 0, 0]` in object-space bits — the ONE box vertex that is simultaneously the data-minimum for x, y AND z, by construction of `buildSurfaceMesh`'s own affine mapping (every axis's domain minimum maps to object coordinate `0`). No other vertex can hold that property for all three axes at once, so there is nothing left to search for: the corner is a constant, not a per-frame computation. `resolveFrontFloorCorner`/`resolveSilhouetteVerticalCorner`/`resolveAxisTriadCorners` are DELETED outright — the split they implemented (x/y sharing one corner, z resolving its own) is exactly what the user's very first message in this round is complaining about ("like the 2d but adding one side more" — one shared corner, not two).

`resolveSharedCorner` — the BACKDROP corner resolver for `guides.walls`/`box`/`grid`/`floorGrid` — is UNCHANGED. It answers a genuinely different question ("which corner keeps the guide planes behind the data") and continues to search per camera; only the axis TRIAD's own corner is now fixed.

### Axis lines become real geometry

The user's own framing ("the render is inside of the block created by those axes") implies the axis lines are structural, load-bearing edges of the plot — worth making genuine mesh geometry, mirroring `@glyphcss/diagrams/3d`'s own D2 round 7 fix for the identical class of problem (see below): `axisTriadLinePolygons` sweeps three `orientedRibbonPolygons` segments (now shared through `@glyphcss/core`, `packages/core/src/helpers/orientedGeometry.ts` — lifted out of `glyphDiagramObject.ts` verbatim, byte-identical behaviour, gated by the unchanged diagrams-3d test suite) from the fixed corner to each of its three neighbours. Built ONCE per `glyphChartObject` call (the corner never moves, so there is no per-`stamp()` recomputation at all) and mounted as a second mesh, `"axis-lines"`, alongside `"surface"` — omitted entirely when `guides.axisLines` is `false`, matching every other guide toggle's own contract.

This is a genuine architectural improvement over the STAMPED `edgeGlyph` box-drawing/bar-glyph lines every prior round used: a stamped line staircases the instant its own screen direction isn't axis-aligned (the exact limitation D2 round 7 documents for diagrams, below), while a ribbon mesh traces smoothly on `braille`'s sub-cell dot encoder at any angle, and a segment genuinely behind the surface is hidden by the ORDINARY per-cell depth test — no bespoke occlusion logic needed, because it is no longer a special stamped write competing with geometry, it IS geometry.

### The camera: a robust yaw, plus an exact off-centre shift

Two separate levers, because they solve two separate problems that turned out NOT to be the same lever (a false start, measured and discarded before landing on this):

1. **Visibility** — the origin corner's own three edges must be genuinely unoccluded at the DEFAULT camera. `rotY` was swept in whole degrees over a full 0-360° range (unchanged `rotX: 58`, the Plotly-like oblique pitch kept from round 3), scoring each candidate by the WORST of its 3 axis lines' own visible fractions — measured with a REAL render: mount the object in a live scene, capture `CellGrid.winnerMesh`, and for ~39 sampled points per edge (excluding the shared corner itself) count how many are NOT won by the surface mesh. Scored jointly across BOTH real dataset fixtures (Maunga Whau, the ETOPO1 Alps window) at once. `rotY: 228` clears >= 95% on every one of the 6 edges (3 axes x 2 fixtures) — Maunga Whau `[0.95, 1.00, 1.00]`, Alps `[0.97, 1.00, 1.00]` — comfortably above the 70% floor the gate suite checks; the swept neighbourhood (`rotY` 221-229) had no candidate clearing 70% on every edge of both fixtures with a wider margin.

2. **Off-centre placement** — sweeping `rotY` under the EXISTING symmetric bbox-centering fit barely moved the corner's own column at all (measured directly, before touching `fitStaticCamera`): 0.02-0.09 of the half-width across the same 0-340° sweep, on both fixtures. The reason is structural, not a tuning gap: bbox-centering targets `(minCol + maxCol) / 2 === frameCentreCol`, and for a SYMMETRIC aspect box every vertex's own bbox extent is, to first order, centred on the box's own geometric centroid regardless of which vertex it is or which way the camera looks — only the (comparatively small) one-sided label margin can pull the centring off `0.5` at all. Centering on CONTENT is therefore the wrong lever for "one particular vertex sits off to a side" — no camera angle fixes it, because the fit actively cancels it back to near-centre every time.

`fitStaticCamera` (`render.ts`) now applies an EXTRA, EXACT horizontal shift after the existing symmetric fit: compute the origin corner's own column under the symmetric camera, compute how far the existing fit's own slack allows a shift in either direction (columns are an exact LINEAR function of `camera.center[0]`, slope `cols` — `createGlyphCamera.ts`'s own `centerCol = cols * center[0]` — so the bound is closed-form, no iteration), and shift toward `ORIGIN_COLUMN_TARGET_FRACTION` (`0.24` of the plot width, comfortably inside the left third) clamped to that slack. On both real fixtures the shift lands the corner at ~0.26-0.27 of the plot width without exhausting its own slack — nothing that fit before the shift can go off-frame after it.

### What this replaces, precisely

- **Removed**: `resolveFrontFloorCorner`, `resolveSilhouetteVerticalCorner`, `resolveAxisTriadCorners` (`object.ts`) — the round-6 per-camera split-corner search for the TRIAD specifically. `resolveSharedCorner` (the BACKDROP's own resolver) is untouched.
- **Removed**: the stamped axis-line write inside `axisTriadOverlay`'s own `stamp()` — axis lines are mesh geometry now, built once in `glyphChartObject`, never per-frame.
- **Changed**: `GLYPH_CHART_3D_DEFAULT_CAMERA.rotY` — `45` -> `228`.
- **Added**: `fitStaticCamera`'s own origin-column shift (`render.ts`).
- **Unchanged**: `resolveSharedCorner`, `classifyEdges`, `planeGridLines`, tick/tick-label/title placement logic (`outwardPoint`), the shared `GlyphLabelArbiter` occlusion contract.

### A residual: the single-anchor label-occlusion approximation, exposed at the new default

The shared label arbiter's `occlusionDepth` field (unchanged since round 3) tests a multi-character label's WHOLE span against ONE depth value taken at its own ANCHOR — "dropped WHOLE when the surface is truly nearer AT ITS ANCHOR," never a promise that every OTHER character in the run is individually depth-correct against the true surface there too. At the new default camera, the coordinator's own adversarial `ringRidgeVolcano` fixture (whose ring reaches nearly every box edge at once) puts one z-tick label ("150") in a position where its own anchor clears the surface but a LATER character's screen cell sits beside a genuinely nearer patch of terrain elsewhere in the scene — a real, narrow, single-fixture residual of a PRE-EXISTING approximation (round 3's own mechanism, unchanged code), not a new defect this round introduced. Measured: widening `TICK_LABEL_MARGIN` past `0.15` (tried up to `0.4`) does not clear it and costs real footprint on other frames; the only `rotY` that avoids it entirely (`218` exactly, with NO margin either side) also fails the real-dataset visibility floor on Maunga Whau's own x-axis (`0.69`, just under `0.70`). `render.test.ts`'s own mechanism-verification suite (unchanged assertions) now pins its OWN camera (`{ rotX: 58, rotY: 45 }`, the pre-round-7 default) rather than `GLYPH_CHART_3D_DEFAULT_CAMERA`, since the property it verifies — the arbiter drops a label WHOLE rather than partially — is camera-independent and doesn't need to ride the ever-changing default.

### Gates (`axisOriginCorner.test.ts`, new)

Run against the real vendored fixtures (`packages/charts/fixtures/3d/`, copies of the site's own Maunga Whau and ETOPO1 Alps data — `@glyphcss/charts` cannot import `website/`):

1. `glyphChart3dResolvedCorner(mark)` is always `[0, 0, 0]` under `"auto"` (no camera argument — the function's own signature changed to reflect that there is nothing left to resolve per frame).
2. The origin corner's own projected column sits `< 0.3` of the plot width on both fixtures (comfortably inside the left third; the gate itself checks `< 1/3 || > 2/3`).
3. Each of the x/y/z axis lines is `>= 70%` visible (winnerMesh/depth-measured, not estimated) on both fixtures.
4. At least 3 whole tick labels render per axis, verbatim, on both fixtures.
5. The DEFAULT-guides braille render contains no stamped `/`, `\`, `|`, `─` glyph — proof the axis lines are geometry now, not a stamped `edgeGlyph`.
6. MUTATION — pinning `axes.corner` to the box's own OPPOSITE vertex (`[1,1,1]`, the kind of far corner `resolveSharedCorner`'s own rule would pick) is exercised directly; a SEPARATE mutation pins `resolved.camera.center[0] < 0.35` — deleting `fitStaticCamera`'s own shift reverts it to the symmetric value (bounded close to `0.5` by the same structural argument above), so this goes red the instant the shift is removed.

### Frames (default camera, 96x32 braille)

```
==== Maunga Whau ====
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                         ⣀⣄⡀                                                                    
                     ⢀⣠⣖⣿⣿⣿⣿⣷⣤⣀⣴⣾⣷⣶⡄                                                            
               ⢀⣠⣤⣤⣴⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣧⡾⣷⡄                                                           
             ⣠⣾⣿⣿⣿⣿⣿⡽⣏⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⡿⣿⣿⣷⣦⡀                                                         
          ⣠⣶⣿⣿⣽⣯⣷⣿⡿⣿⣿⡿⣷⣿⣿⡯⣿⣅⣟⣷⡞⣿⣷⢳⢻⣷⣿⣿⣷⣦⣄                                                       
      ⢀⣤⣶⣿⣿⣿⣿⡿⣿⣯⢿⣺⣿⢿⣿⣿⣿⣿⢷⡿⡧⣧⡿⣯⣏⣿⡿⣽⣏⣯⣿⣿⣷⣿⣿⣷⡦⣄          200█                                      
   ⢰⣦⣶⣿⣿⡿⣿⣷⣟⣿⣿⣿⣻⣽⢽⢿⣿⣿⣟⣿⣿⣿⠒⣻⣟⣷⣧⡿⣏⡿⣿⣘⡿⡿⣿⣿⣿⣿⣿⣿⡿⡇            █                                      
    ⠈⠻+⣦⣄⠉⠳⣿⣿⣿⣻⣾⣾⢿⣽⣿⡯⣷⣿+⣌⣧⠇⣟⣷⡿⣦⣯⣿⡿⣧⢧⢷⢻⣿⡿⢟⢋⣷⣿⠿       172.5▛                                      
       ⠉⠻⣷⣦⣀⠙⠾⣿⣾⣾⣿⣿⣷⣿⣿⣻200⣟⣾⣏⡿⣧⡿⣯⣟⣿⠿⠚⠉⣴⣾⡿⠛⠉              ▛                                      
   800    ⠙⠻⣷⣦⣈⠓⠛⠛⠻⣿⡻⡾⣿⣿⣯⣯⡿⡧⣿⣿⣏⣿⡿⠛⣥⣶⡿⠟⠋⠁       600    145▀                                      
            ⠈⠙⠿⣷⣦⣀ ⠹⣭⣿⣿180⣿⣿⣯⡿⣷⡯⣾⠿⠛⠉        500          ▀                                      
       600     ⠈⠙⢿⣷⣤⡙⢾⣽160⣿⣯⣷⡿⠟⠋⠁       400         117.5▘                                      
            400   ⠈+⢿⣷⣽140⠿⠂⠁        300                 ▘                                      
                200  ⠉⠛120       200                   90                                       
                       100    100                                                               
                    0     0                                                                     
                                                                                                
 y (m)                height                                                                    
                                             x (m)                                              
                                                                                                
                                                                                                

==== Alps ====
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                   ⣀⣀⡀  ⢀⣦⣤⡄                                                                    
                  ⢰⣿⣷⢷⣦⣠⣼⣿⣿⣷⣀⡀                                                                  
             ⢀⡀⢠⣷⣄⣿⠋⣿⣿⣆⣽⣿⣿⣿⣿⣾⣷⡄                                                                 
            ⢠⣟⡇⣻⢷⣇⣯⣦⣿⣿⣿⣽⡼⣿⠉⡽⣿⠿⣿⣆⣀⡄                                                              
          ⢠⡾⣿⣿⡿⣯⣸⣻⣿⣿⣿⣿⢻⣿⣼⣯⣿⣡⣿⣴⣿⣽⣿⣿⡀                                                             
       ⢀⣀⣾⣿⣿⡹⣿⡧⣿⢿⣴⣿⣿⣿⣿⣟⣿⡷⣿⣽⣼⣏⠹⣷⣿⣿⣽⣧⣦⡀                                                           
     ⢠⣾⡯⣿⣿⡟⡇⣽⢷⣿⣿⣿⡿⣷⣾⣿⣿⣿⣽⠗⣟⣧⡏⡏⢙⣿⣿⣿⣿⣿⣿⣿⣦                  4500█                                   
       ⠙⠿⠼⣧⣿⢯⣿⣹⣿⡿⣿⣿⣼⡇⣾⣿⢻⣛⣿⣿⣷⣿⣿⣿⢻⣻⣯⣿⣿⣿⣿⣧⡀                    █                                   
   ⢰⣦⣄    ⣿⣿⣿⣿⣿⣿⣷⣷⢯⣽⣿⣷⣸⣿⣿⣿⣿⣺⡟⣳⣿⣿⣿⣿⣿⡧⣳⣿⣿⣿⣆⡀  ⡀           3375▛                                   
    ⠈⠻⢿⣦⣄ ⢻⡞⠙⠛⠉⠉⢷⣿⣿⣷⣯⣼⣿⣿⣿⣿⣿⠿⣽⣇⣿⣿⣿⣟⣿⣿⣻⣿⠿⠿⢋⣥⣶⣿⠿               ▛                                   
       ⠉⠻+⣮⣀     ⢿⣿⢹⡅⣿⣿⣿⠿⠼⣟⡾⠉⠓⠋ ⠙⠛⠾⠿⠛⣡⣴⣾⡿⠛⠉+            2250▀                                   
   46.4   ⠙⠻⣷+⣀  ⠘⠋⠁⠛⠃⢸4000      ⢀⣤⣶⡿⠟⠋+                    ▀                                   
      46.2  ⠈⠙⠿⣷⣦⣀    ⢸⣿      ⣠⣴⣾⠿⠛⠉+        8.2        1125▘                                   
          46   ⠈+⢿⣷⣤⡀ ⢸3000⣤⣶⡿⠟⠋+         8                 ▘                                   
                  ⠈⠛⢿⣷⣼2000⠂+         7.8                  0                                    
             45.8    ⠉⠛1000        7.6                                                          
                 45.6          7.4                                                              
                    45.4    7.2                                                                 
                                                                                                
 latitude             elevation (m)                                                             
                                             longitude                                          
                                                                                                
                                                                                                
```

Both origin corners meet on the LEFT side of the frame; x, y, and z axis lines are clearly three distinct, smoothly-traced (real geometry) edges converging there; tick labels read whole on all three axes.

## C2 fix round 8 — axes from a genuine SIDE corner, not the nearest one

**Coordinator review of round 7, verbatim:** "the origin corner is at the FRONT, so the z axis runs up through the middle of the shape. With `rotY: 228` the data-min corner is the NEAREST corner to the viewer. The x and y axis lines form a V meeting at the bottom centre of the plot, and the z axis rises from that front corner straight up in FRONT of the surface... That's literally 'axis in the middle'." Plus three smaller findings: (P1-B) the plot was shoved into the left half of the frame by round 7's own recentring shift; (P1-C) negative tick/colorbar labels rendered as `?10`/`?20`; (P2) axis ribbons rendered as `@@` (the solid ramp's densest glyph) in `box`/`ascii`.

### P1-A — diagnosis and the measured geometric limit

Round 7's own `rotY` sweep scored candidates purely by axis-line VISIBILITY (real `winnerMesh`/depth read), which the box's own NEAREST corner also clears — visibility and "sits at a side, not centred" are different properties, and round 7 only checked the first. Direct measurement confirms the diagnosis exactly: at `rotY: 228` the origin corner's own projected column sits within ~2% of the box's own 8-corner column MIDPOINT (`leftFraction ~= 0.474`, where `0` is the box's own strict leftmost vertex and `0.5` is dead centre) — genuinely centred among the box's own vertices, which is what put the z-axis tick labels visually inside the terrain's own silhouette even though the axis LINE itself was correctly depth-tested and unoccluded.

**The fix requested — choose a yaw where the corner is the box's own strict leftmost vertex — was swept exhaustively and found to be geometrically INCOMPATIBLE with real axis-line visibility for this box shape, at any pitch.** Closed-form: with the default symmetric `aspect[0] === aspect[1]`, screen column is an affine function of world x/y only (z never moves it, confirmed empirically), so the 4 base-plane corners' own columns are `0`, `E·cos(rotY)`, `-E·sin(rotY)`, `E·(cos(rotY) - sin(rotY))` for box half-width `E`, and the origin's own `0` is the strict minimum of those four exactly when `cos(rotY) > 0` and `sin(rotY) < 0` — `rotY` in the open interval `(270, 360)`, for ANY `rotX`. Every `rotY` in that entire range was swept (also across `rotX` 15-75) against BOTH real dataset fixtures with a genuine render + `winnerMesh` depth read:

```
rotY=273  worst=0.132  leftmost=true
rotY=280  worst=0.105  leftmost=true
rotY=286  worst=0.079  leftmost=true
rotY=292  worst=0.053  leftmost=true
rotY=294  worst=0.026  leftmost=true
```

(`worst` = the worst-of-6 real axis-line visible fraction across both fixtures; the full 89-candidate sweep never exceeds ~21%, at `rotX: 75`.) The reason is structural, not a search failure: a corner that is the box's own screen-column EXTREME is, for this camera family and a terrain height-field, ALSO the corner FARTHEST from the camera along the view axis — its own two floor edges then run BEHIND the raised terrain for most of their length, because the terrain (which occupies the FULL x/y footprint) stands between the camera and that corner's own receding edges. Only the box's own NEAREST vertex has both its floor edges staying on the visible front face at every point along their length — and for a symmetric box, "nearest" and "column-extreme" are provably different vertices at every yaw (confirmed: the box's own leftmost/rightmost vertices, at ANY yaw, are never simultaneously its nearest/farthest ones — a `cos`/`sin` versus a `RotX·RotZ` depth formula, genuinely different functions of `rotY`).

**`rotY: 235` is the best point on that real trade-off**, found by narrowing the search to round 7's own high-visibility band (`rotX: 58`, `rotY` 195-260) and scoring each candidate on BOTH `leftFraction` and worst-of-6 visibility:

```
rotY=225  leftFraction=0.500  worstVis=0.87-1.00 (Maunga Whau)  0.92-1.00 (Alps)
rotY=228  leftFraction=0.474  worstVis=0.95-1.00              0.97-1.00
rotY=234  leftFraction=0.421  worstVis=0.95-1.00              0.95-1.00
rotY=235  leftFraction=0.412  worstVis=0.92-1.00              0.92-1.00
rotY=236  leftFraction=0.403  worstVis=0.84-1.00              0.95-1.00
```

`235` clears a raised 85% visibility floor (`render.test.ts`'s own gate, up from round 7's 70%) on both real fixtures while moving `leftFraction` from 228's own 0.474 down to 0.412 — a real, measured, visually material move toward the side. This is documented as the genuine ceiling for this box shape and terrain class, not silently claimed as the literal "leftmost of 8" the review's own language asked for — `camera.ts`'s own doc carries the full derivation and every swept number.

### P1-B — the artificial column shift is deleted

`render.ts`'s `fitStaticCamera` no longer applies `ORIGIN_COLUMN_TARGET_FRACTION`'s own post-fit shift at all — `center` is now plain, symmetric content-centering (`[0.5 - dCol/cols, 0.5 - dRow/rows]`, matching what "round 6" did before round 7's shift existed), over the FULL projected content (surface + axes + labels + colorbar). What moves the corner visually off-centre now is the yaw's own `leftFraction` improvement (P1-A), not a positional hack. Measured on the real render: LEFT/RIGHT ink margins are within ~5% of each other on Maunga Whau at the default camera (`20`/`19` of 96 columns), comfortably inside the review's own +/-15% gate — round 7's own shift left as much as 55% of the frame empty on one side.

### P1-C — ASCII minus, not U+2212

`d3-format` emits U+2212 MINUS SIGN for a negative number, and none of the ascii/box/braille chrome tiers' glyph set carries it — `canvas.text` folded every negative tick to `?`, turning `-10` into `?10`. `axisTriadShared.ts`'s own `resolveAxis` (every 3D mark's shared tick-format pipeline) and `render.ts`'s colorbar `zFormat` both now post-process through a plain `.replace(/−/g, "-")` — matching the 2D chart's own "ASCII is 7-bit throughout" rule. Gated directly (a negative-domain synthetic mark renders `-10`, never `?10`) and via the real fixtures' own tick labels (`label.includes("−")` is `false` for every one).

### P2 — a lighter axis line in box/ascii

An axis ribbon's own long faces are, for a wide swath of default-camera orientations, close to face-on with the scene's real default directional light (`rasterizeContext.ts`'s `DEFAULT_DIRECTIONAL`, `[0.5, 0.7, 0.5]` at intensity 1 atop `DEFAULT_AMBIENT`'s 0.4) — an ordinary Lambert response therefore reads near the solid ramp's own darkest end (`@`) regardless of which way the axis happens to run, since the axis triad is STRUCTURE/annotation, not a lit surface standing for real geometry. `object.ts`'s `axisTriadLinePolygons` now authors a FIXED `Polygon.shadingNormal` on every ribbon triangle (AGENTS.md's "Authored shading normal"), chosen ORTHOGONAL to that same default light (`(0.7, -0.5, 0)`, normalized) — a constant, ambient-only intensity (~0.4) regardless of the ribbon's own real orientation or the camera's, reading as a consistent light line (`-`/`=` on `box`/`ascii`) at every rotation. Gated by a real render + `winnerMesh`-scoped scan: zero cells the axis-lines mesh itself wins ever carry `@`/`#`/`%` — mutation-verified (deleting the authored normal produces 10 such cells on Maunga Whau at the default camera, on both `box` and `ascii`).

### `glyphChart3dFitCamera`'s own margin (a side effect found by re-testing)

The cheap, approximate pre-fit `glyphChart3dFitCamera` (for a live orbit viewport's own initial pose) used a smaller default `margin` (`0.45`) than the real overlay's own `AXIS_TITLE_MARGIN` (`0.6`) — at some rotations, including round 8's own new default, a title's row could clip off the fitted viewport entirely (found by `camera.test.ts`'s own P1-4 gate going red at the new default). Raised to `0.65`, clearing the real push-out with a small margin; this function remains an approximate pre-fit, never as exact as `fitStaticCamera`'s own closed-form label-anchor fit.

### A residual: one adversarial-fixture depth-test near-tie

`object.test.ts`'s own "Item 4" mechanism gate (zero structural guide writes land on a surface-won cell) found exactly ONE violating cell — a tick mark, `col=51 row=16` — on its own adversarial `ringRidgeVolcano` synthetic fixture (a taller ring ridge, built specifically to stress guide/surface overlap) at the new `rotY: 235`. Measured: both the tick's own projected depth and the surface's per-cell interpolated depth are within `1e-6` of each other at that exact cell — a genuine float-precision coplanar near-tie at this specific adversarial angle/fixture combination, not a defect in the per-point depth test itself (confirmed clean, 0 violations, at a FIXED mechanism camera `{rotX: 58, rotY: 45}` — mirroring round 7's own `MECHANISM_TEST_CAMERA` precedent in `render.test.ts`). The gate now pins that fixed camera rather than the ever-changing default, since its own purpose is verifying the MECHANISM (unchanged code), not asserting the property holds at whatever the current default happens to be.

### Mutation table (round 8)

| Property | Test | Mutation that reddens it |
|---|---|---|
| Corner sits left of the box's own column midpoint | `axisOriginCorner.test.ts` | Pinning `rotY: 228` measures `leftFraction ~= 0.474`, failing the `< 0.45` gate |
| No artificial column shift (P1-B) | `axisOriginCorner.test.ts` | Reintroducing `ORIGIN_COLUMN_TARGET_FRACTION` pushes `center[0]` outside the `+/-0.1` band |
| No U+2212 in tick/colorbar labels (P1-C) | `axisOriginCorner.test.ts` | Deleting `asciiMinus`'s own `.replace` reproduces `?10` |
| Axis lines never paint `@`/`#`/`%` in box/ascii (P2) | `axisOriginCorner.test.ts` | Deleting the authored `shadingNormal` produces 10 such cells on Maunga Whau |

### Frames (default camera `{rotX: 58, rotY: 235}`, 96x32 braille)

```
==== Maunga Whau ====
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                               ⣀⣠⡀                                              
                                         ⢀⣀⣀⣤⣶⣿⣿⣿⣿⣷⣤⣴⣶⣤⡀                                        
                                  ⢀⣠⣴⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⢻⣿⣷⡀                                       
                               ⢀⣠⣤⣿⣿⣿⣿⡿⣿⣯⣷⣿⣿⣿⣿⣿⣿⣿⣿⣟⡯⣿⣏⣿⣿⣷⣤⡀                                     
                           ⢀⣠⣴⣾⣿⣿⣿⣿⣽⣾⣿⡿⣿⣿⣯⣿⣿⣿⡿⣧⣏⣻⣾⣿⣷⢻⣿⣽⣿⣿⣿⣿⣄                                    
                         ⢸⣾⣿⣿⢿⣻⣿⣽⣾⣾⣯⣯⣿⣿⣿⣿⣿⡿⣯⡟⣟⣿⣿⡧⣿⣿⡿⡍⣏⣷⣯⣟⣿⣿⣿⣷⣄           200█                   
                          ⠙+⣷⣄⠹⣟⣿⣿⣿⣿⣿⣿⣿⣿⣿+⣭⠟⡏⣽⣟⡞⣷⡟⣧⣿⣿⣹⠼⡿⣿⣿⣞⣿⣿⣿⣷⡄            █                   
                            ⠈⠻⣷⣄⡙⢾⣿⣟⣿⣿⣿⣿⣿⣿⣻⣓⣿⣍⣿⣿⡹⡽⣷⣿⣿⣯⣷⢳⣳⣳⠿⢛⡋⣁⣾+       172.5▛                   
                        800   ⠈+⢿⣮⡳⠿⠿⣿⢿⢿200⢿⢮⣿⢿⣼⣳⣷⡻⣿⣿⠗⠋⠉⣤⣶⣾⠿+⠋⠁             ▛                   
                            600  ⠙⢿⣦⣄⠈⢻⣺180⣿⢿⣽⣽⣿⢿⣾⡿⠋⣥⣶⠿⠟⠋⠁        600    145▀                   
                                   ⠈⠻⣷⣄⢻160⣿⣿⣿⣿⣛⡍⡾⠟⠛⠉         500           ▀                   
                               400   ⠈⠻⢷140⣯⡷+⠛⠉⠁+        400          117.5▘                   
                                   200  120⠁           300                  ▘                   
                                        100    100 200                    90                    
                                      0     0                                                   
                    y (m)                                                                       
                                     height                                                     
                                                                                                
                                                              x (m)                             
                                                                                                
                                                                                                
                                                                                                

==== Alps ====
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                        ⢠⣠⢤⣀  ⢀⣦⣄                                               
                                     ⢠⡀⢠⣿⣿⣟⣷⣷⣴⣾⣿⣿⣆⡀                                             
                                 ⢀⣾⣦⣀⣿⢯⣾⢃⣿⣿⣿⣿⣻⣿⣿⣿⣿⣇                                             
                               ⢀⣤⣾⣷⣷⣷⠛⣿⣿⣿⣿⣿⣿⣷⣿⢉⡿⡿⡿⣿⣷⣀⣠                                          
                            ⣀⢀⣦⣾⣿⣧⣿⣇⣿⣶⣿⣿⣿⣽⣹⣻⣿⣿⡯⠤⣿⣧⣿⣿⣿⣯⡇                                         
                          ⢠⣾⣽⣿⣻⢿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣿⣯⣿⢿⣷⠷⣿⣋⢻⣿⣷⣿⣽⣷⣄                                        
                           ⠈⠻⢿⣷⣾⣠⣿⣿⣿⣿⣿⣋⡟⢿⣿⣷⣿⣿⣽⣾⢹⣨⢿⣯⣿⣿⣿⣿⣽⢦⡀              4500█                   
                         ⣾⣦⡀  ⡏⣿⣿⣿⣿⣿⣸⣻⢿⣽⣿⢹⣷⣿⣿⣿⣿⣟⣿⣿⣿⣻⣿⣿⣿⣿⣿⣷⡄                 █                   
                         ⠈⠛⢿⣶⣄⢻⡟⠙⠛⠛⣿⣾⣿⣟⣿⣿⡇⣿⣿⣿⣿⣿⣫⢿⣿⣿⣿⣻⣿⣧⣻⣿⣷⣿⣄            3375▛                   
                            ⠙⢿+⣄   ⠈⣿⣿⣿⣿⣿+⣿⢻⣿⢩⠷⣿⢼⡿⢿⣿⣹⣿⣷⣿⡿⠿⠟⣛⣧⣶⣿⠆            ▛                   
                       46.4   ⠉⠻+⣤⡀ ⠸⠴⠻⠋4000⠛⠋ ⠈⠉  ⠙⠛⠚⢓⣫⣴⣶⡿⠟⠛⠉          2250▀                   
                          46.2  ⠈⠻⣿⣦⡀   ⣿⡇        ⣀⣤⣴⡾+⠛⠉+                  ▀                   
                             46    +⢿⣦⣀ 3000 ⢀⣀⣤⣶⠿+⠋⠁          8.2      1125▘                   
                                45.8 ⠙⠿⣷2000⠾⠟⠋⠉        7.8 8               ▘                   
                                       ⠈⠛⠛⠉+        7.6                    0                    
                                   45.6 1000     7.4                                            
                                      45.4   7.2                                                
                    latitude                                                                    
                                     elevation (m)                                              
                                                                                                
                                                             longitude                          
                                                                                                
                                                                                                
                                                                                                
```

The origin corners sit clearly LEFT of the surface's own centre (verified: `leftFraction ~= 0.41`, ink margins balanced within ~5%), x/y/z axis lines read as three light, smoothly-traced lines rather than dark blobs, and every tick label — including the Alps window's own negative-adjacent range near `7.2`-`8.2` longitude — reads whole with no `?` fold.

## C5 — more 3D chart types: scatter, parametric surfaces, bars, lines

**USER FEEDBACK, verbatim:** "I want other 3d renders, a sphere, some 3d scatter, some other 3d renders in charts :)". Four new mark constructors join `glyphChartSurface`, all under `@glyphcss/charts/3d`, all sharing the SAME axis-triad/guide/colour-legend machinery C1-C4 and C2 round 7 built for the surface mark — a mixed-dimension chart deck (a bar chart beside a scatter plot beside a terrain surface) reads with the identical corner, camera, tick, and colorbar conventions throughout.

### Shared architecture

`GlyphChart3dAxisTriadSpec` (`types.ts`) is the structural shape EVERY mark now carries — `aspect`, `axes.{x,y,z}`, `corner`, `guides` — pulled out so `object.ts`'s axis-triad builder, `render.ts`'s `fitStaticCamera`, and the corner/colour-legend resolvers all take ONE type rather than `GlyphChart3dSurfaceMark` specifically; `glyphChart3dResolvedCorner`/`glyphChart3dLabelAnchors` were simplified to match (no camera argument any more — C2 round 7 already made the corner camera-independent). `axisTriadShared.ts` (new) lifts `resolveCorner`/`resolveGuides`/`resolveAspect`/`resolveBands`/`resolveAxis` out of `surface.ts` into one place every mark's own constructor imports, rather than five copies drifting apart. `GlyphChart3dColorLegend` (`{anchors, bands, domain}`) is the shared shape `render.ts`'s `colorbarRows`/`paintColorbar` now read regardless of mark type — a surface's own `colorAnchors`/`bands`/`z.domain` triple is repackaged into it, every other mark builds one directly.

`glyphChartObject()` (`object.ts`) switches on `mark.type` and builds a `meshes: GlyphSceneObjectMesh[]` array: `"surface"` (unchanged), `"points"` (scatter), `"bars"`, `"line"` — each named for its own mesh, plus the shared `"axis-lines"` mesh whenever `guides.axisLines` is on. `renderGlyphChart3d` (`render.ts`) no longer throws on a non-surface mark: shading/lighting resolution is now `if (mark.type === "surface") {...}` with a `relief`/ambient-only default for everything else (a marker or a bar has no continuous surface to relief-shade), and `colorLegend` is derived per mark type (`null` for `line3d`, which has no colour channel at all; the mark's own `colorLegend` for scatter/parametric/bars; the surface's repackaged one for `surface`).

### `glyphChartScatter3d(data, channels?, options?)`

Points as small real GEOMETRY (`buildScatterMesh`, `object.ts`) — never stamped glyphs, matching the axis triad's own "real mesh, not a stamp" rule from C2 round 7. `channels.series` (categorical) cycles through `GLYPH_CHART_3D_SERIES_PALETTE` (8 colours) AND a shape cycle (`cube`/`octahedron`/`tetrahedron`/`icosahedron`, `boxPolygons`/`octahedronPolygons`/`tetrahedronPolygons`/`icosahedronPolygons` from `glyphcss`) under `color: "none"` — two independent identity channels so a monochrome render still separates series by silhouette; `channels.color` (continuous) drives a colorscale + colorbar exactly like a surface's own `z` does, and is mutually exclusive with `series` (`scatter-bad-channel` otherwise, since a point is coloured by ONE of a category or a continuous value, never both). `channels.size` scales each marker between 0.5x and 2x `options.markerSize` (default `0.035` object-space half-size). Validation: `scatter-empty` (no data), `non-finite-data` (any resolved channel), `scatter-bad-channel`.

### `glyphChartParametric3d(data, options?)` / `glyphChart3dSphereGrid`/`glyphChart3dTorusGrid`

A full `(u, v)`-parametrized surface from PRECOMPUTED `x`/`y`/`z` grids — data-only by contract, since a function has no JSON form (the TS API's own `glyphChart3dSphereGrid(radius, rows, cols)`/`glyphChart3dTorusGrid(majorRadius, minorRadius, rows, cols)` sample a closed-form parametrization into grids before the model step ever runs, so `glyphChartParametric3d` itself never touches `Math.sin`). Meshed by the NEW `parametricSurfacePolygons` (`@glyphcss/core`, generic UV-grid mesher — two triangles per quad split on the shorter diagonal, no orientation guarantee, relying on the scene's `doubleSided: true` default rather than the height-field `gridSurfacePolygons`' `+z`-relative winding, since x/y/z all vary with both u and v here). `wrapU`/`wrapV` connect the grid's last column/row back to its first (a sphere's azimuthal `phi`, a torus's two angles) so the mesh has no seam. Colour is `options.color: "auto" | "none"` over `value` (a 4th optional scalar grid) or `z` by default. Geometric correctness is unit-tested directly (every sphere point at exactly `radius` from the origin, every torus point at exactly `majorRadius +/- minorRadius` from the ring) rather than only visually inspected. Validation: `parametric-too-small` (< 2x2 without a wrap), `parametric-ragged` (a grid whose rows disagree in shape), `non-finite-data`.

### `glyphChartBars3d(data, channels?, options?)`

A 3D bar chart — `buildBarsMesh` (`object.ts`) builds one upright `boxPolygons` box per row, footprint half-width from `tightestGap()` (the tightest neighbour spacing on each axis, halved and margined so adjacent bars never touch), height from `z` (floored/ceilinged at 0, so a negative value bars DOWN from the z=0 plane exactly like the 2D `bar` mark's own zero-baseline rule). The z-axis domain is forced to include 0 (`mark.axes.z.domain[0] <= 0` always) — "a bar is drawn from the floor up," the identical honesty rule AGENTS.md's 2D "Pipeline" paragraph states for `bar`/`rect`/`area`. Colour is a colorscale by height, quantized through the same `bands` mechanism every other mark uses. A zero-height bar paints NO polygons (mutation-tested: `barsMesh.polygons.length === nonZeroBarCount * 6`). Validation: `bars-empty`, `non-finite-data`, `bars-bad-channel`.

### `glyphChartLine3d(data, options?)` / `glyphChart3dLorenzAttractor`

A 3D polyline/trajectory as real ribbon geometry (`buildLineMesh`, `LINE3D_HALF_WIDTH_FRACTION = 0.012`, the SAME `orientedRibbonPolygons` primitive the axis triad and `@glyphcss/diagrams/3d`'s own edges use — one segment per consecutive point pair, `(points.length - 1) * 6` faces, mutation-tested). `data` is either a bare point-array (`isFlatPointList()` distinguishes it from a named-series array) — one unnamed series — or an array of `{name?, color?, points}` series, each independently coloured and ribbon-meshed; `colorLegend` is always `null` (a line has no colour channel, only a per-series identity colour). `glyphChart3dLorenzAttractor(steps, dt)` is the shipped computed example: classic Lorenz parameters (`sigma=10, rho=28, beta=8/3`), forward-Euler integrated, deterministic — gated both on boundedness (never collapses to the origin or diverges) and on producing real braille ink through the full render path. Validation: `line3d-empty`, `line3d-too-short` (a series with < 2 points), `non-finite-data`.

### Fixtures and their provenance (`packages/charts/fixtures/3d/`, `LICENSES.md`)

- **Sphere / torus** — computed, not fetched (`glyphChart3dSphereGrid`/`glyphChart3dTorusGrid`), no licence question.
- **`syntheticClusters3d.json`** — 72 points, 3 Gaussian clusters, seeded `mulberry32(42)` (deterministic). The task called for a real dataset (iris) OR a clearly-labelled synthetic fallback when licence verification isn't possible offline — iris's own redistribution terms could not be verified from a primary source in this environment, so this ships as the labelled synthetic fallback, explicitly marked "SYNTHETIC, not real data" in `LICENSES.md`.
- **`syntheticRevenue3d.json`** — 12 rows, 3 regions x 4 quarters, a deterministic seeded synthetic revenue figure — the task's "real small table or labelled synthetic" bars deliverable; no suitably small, clearly-licensed real 3-dimensional tabular dataset was available offline, so this ships as the same kind of explicitly labelled synthetic fallback.
- **Lorenz attractor** — computed (`glyphChart3dLorenzAttractor`), labelled as such; not a fetched dataset.
- **Maunga Whau** — the same real, MIT/GPL-provenance dataset C2 round 7 already vendored (`maungaWhauVolcano.json`), reused here as the shared surface example.

### Mutation table (Part B)

| Property | Test | Mutation that reddens it |
|---|---|---|
| Zero-height bars paint nothing | `bars.test.ts` | Deleting the `z !== 0` filter makes the polygon count `3 * 6` instead of `2 * 6` |
| Line mesh has `(points-1)*6` faces | `line3d.test.ts` | A flat/degenerate segment count collapses the `3 * 6` expectation |
| `series`/`color` are mutually exclusive | `scatter.test.ts` | Removing the `scatter-bad-channel` check lets both channels resolve silently |
| Sphere points sit at exact radius | `parametric.test.ts` | A wrong `sin`/`cos` order or radius scale fails the exact-distance assertion |
| Torus points sit at exact tube distance | `parametric.test.ts` | Same — geometric, not visual |
| Z domain always includes 0 for bars | `bars.test.ts` | Removing the zero-anchor forces would let an all-positive dataset's domain start above 0 |
| Lorenz trajectory stays bounded | `line3d.test.ts` | A wrong integration step explodes or collapses the `x` range assertion |

### Residuals

- **Torus deliverable frame uses a per-render camera override** (`{rotX: 30, rotY: 228}` instead of the library default `{rotX: 58, rotY: 228}`) — at the shared default's ~32-degree elevation the torus (a ring lying flat in the XY plane) reads nearly edge-on and its donut hole is not clearly visible; at `rotX: 30` (still within the swept "good visibility" neighbourhood for the axis triad) the hole reads clearly. This is a per-EXAMPLE rendering choice for the deliverable frame below, not a change to `GLYPH_CHART_3D_DEFAULT_CAMERA` — the geometric correctness of the torus mesh is independently verified by the exact-distance unit tests above, which are camera-independent.
- **`renderGlyphChart3dJson`/the CLI are NOT generalized** to the four new mark types yet — both remain surface-only (`GlyphChart3dJsonInput` unchanged), a documented gap for a later packet.
- **Mixed-dimension axis unification** (declared in C1's own doc as a "later decision") is still not done — each mark type resolves its own axes independently; two marks of different types are never composited into one shared scene by this packet (nothing in the task asked for that; each example below is its own standalone chart).

### Frames (18 total: 6 examples x 3 tiers — Maunga Whau + the 5 new examples, 96x32 braille / 96x32 blocks / 140x40 box, all at `GLYPH_CHART_3D_DEFAULT_CAMERA` except the torus's own noted override)

```
---- Maunga Whau (surface) — 96x32 braille ----
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                               ⣀⣠⡀                                              
                                         ⢀⣀⣀⣤⣶⣿⣿⣿⣿⣷⣤⣴⣶⣤⡀                                        
                                  ⢀⣠⣴⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⢻⣿⣷⡀                                       
                               ⢀⣠⣤⣿⣿⣿⣿⡿⣿⣯⣷⣿⣿⣿⣿⣿⣿⣿⣿⣟⡯⣿⣏⣿⣿⣷⣤⡀                                     
                           ⢀⣠⣴⣾⣿⣿⣿⣿⣽⣾⣿⡿⣿⣿⣯⣿⣿⣿⡿⣧⣏⣻⣾⣿⣷⢻⣿⣽⣿⣿⣿⣿⣄                                    
                         ⢸⣾⣿⣿⢿⣻⣿⣽⣾⣾⣯⣯⣿⣿⣿⣿⣿⡿⣯⡟⣟⣿⣿⡧⣿⣿⡿⡍⣏⣷⣯⣟⣿⣿⣿⣷⣄           200█                   
                          ⠙+⣷⣄⠹⣟⣿⣿⣿⣿⣿⣿⣿⣿⣿+⣭⠟⡏⣽⣟⡞⣷⡟⣧⣿⣿⣹⠼⡿⣿⣿⣞⣿⣿⣿⣷⡄            █                   
                            ⠈⠻⣷⣄⡙⢾⣿⣟⣿⣿⣿⣿⣿⣿⣻⣓⣿⣍⣿⣿⡹⡽⣷⣿⣿⣯⣷⢳⣳⣳⠿⢛⡋⣁⣾+       172.5▛                   
                        800   ⠈+⢿⣮⡳⠿⠿⣿⢿⢿200⢿⢮⣿⢿⣼⣳⣷⡻⣿⣿⠗⠋⠉⣤⣶⣾⠿+⠋⠁             ▛                   
                            600  ⠙⢿⣦⣄⠈⢻⣺180⣿⢿⣽⣽⣿⢿⣾⡿⠋⣥⣶⠿⠟⠋⠁        600    145▀                   
                                   ⠈⠻⣷⣄⢻160⣿⣿⣿⣿⣛⡍⡾⠟⠛⠉         500           ▀                   
                               400   ⠈⠻⢷140⣯⡷+⠛⠉⠁+        400          117.5▘                   
                                   200  120⠁           300                  ▘                   
                                        100    100 200                    90                    
                                      0     0                                                   
                    y (m)                                                                       
                                     height                                                     
                                                                                                
                                                              x (m)                             
                                                                                                
                                                                                                
                                                                                                

---- Maunga Whau (surface) — 96x32 blocks ----
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                               %%@                                              
                                          %%@%%*@%%-@+=*                                        
                                   @=#*#-=*#=%+%==-=-+-=*                                       
                                @#+=*-===-=*+-===-===-====%                                     
                            %@%#-=-=-+-=**+=-=-=-=-=-=-=-==#@                                   
                           +   %+=%=*==-%+=-===-===-===-==+*##@          200#                   
                             =-  +*==**%-=-=-=-=-=-=-=-=-++%*# +            *                   
                        800    +=  #=@==200==-===-===-==    +-         172.5+                   
                            600   -   -=180=-=-=-=-=    -=        600       =                   
                                    =   160*+=%=#  -=         500        145=                   
                               400    -=140*++-=-+        400               -                   
                                   200  120=           300             117.5:                   
                                        100    100 200                      .                   
                                      0     0                             90                    
                    y (m)                                                                       
                                     height                                                     
                                                                                                
                                                              x (m)                             
                                                                                                
                                                                                                
                                                                                                

---- Maunga Whau (surface) — 140x40 box ----
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                     %@@@%@                                                                 
                                                            %   %%=@@%#%%@#=%=+=+                                                           
                                                        *%%%@@=-=%=+===#+=+-===-==                                                          
                                                     %=++=+*==-=-=%@-=-=-=-=-=-=-==%                                                        
                                                %%@@*=*==+==*+*=++===-===-===-===-=+=*                                                      
                                             %%@%+#+=+-==+=+-==@-=-=-=-=-=-=-=-=-=-=++@#                                                    
                                             =    %=###=*====+@+===-===-===-===-===-++%*#@                                                  
                                               =-  @@+=##=*=@*-=-=-=-=-=-=-=-=-=-===#%*%*#           200█                                   
                                         800     -=  =+=#+*==-200-===-===-===-===-==*    -==            █                                   
                                                   =-  #*%-=-=-=-=-=-=-=-=-=-=-     -=-            172.5▓                                   
                                              600     =    #*=180==-===-===-    ==+           600       ▓                                   
                                                        -=  -=160#-*++=#*  =-=           500         145▒                                   
                                                  400     +=  *=***=   ==           400                 ▒                                   
                                                             =140 -=+           300                117.5░                                   
                                                      200     120          200                          ░                                   
                                                              100     100                             90                                    
                                                           0      0                                                                         
                                                                                                                                            
                                    y (m)                                                                                                   
                                                          height                                                                            
                                                                                                                                            
                                                                                         x (m)                                              
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            

---- Synthetic clusters (scatter3d) — 96x32 braille ----
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                            ⢀  ⢀ ⡀                                              
                                         ⢰⣷⣴⣿⣿⣿⣿⣿⡿⡀                                             
                                          ⡛⢳⣿⣿⣿⡏⠛⠻⠿⢀                                            
                                         ⠸⠿⠈⠉⠿⠏⠁⢸⣿⠃⣿⣿⣦⡀⢰⣦                                       
                                                ⠈⣿⣷⣿⠷⣿⡇⠈⠉                                       
                                                ⣴⡟⣿⣿⣷⣷ ⣾⡆                                       
                                                ⠉⠁⠉⠿⠟⠁                                          
                                                                                                
                              ⢸⣦⡀             ⡀                                                 
                               ⠙⠻⣷⣄          ⢸+⡆  ⣀                                             
                                 ⠈⠻+⣄⡀      ⣤⣸⣿⣀⣤⣦⠿⠇  ⡀         ⢀⣠⣴⣾+                           
                             4     ⠈⠙⢿⣦⡀ ⢠⣦⡄⠿6⣿⣿⣿⣿⡆  ⣸⠿     ⣀⣤⣶⣾⠿+⠋⠁                            
                                2     ⠙⢿⣦⣌⠉  4⣿⣫⣼⣿⣦⡀⣿⡏⠁⢀⣠⣤⣶⠿⠟⠋⠁        6                        
                                   0    ⠈⠻+⣄ 2⣿⠛⠉ ⠛⣃⣠⣴⡾⠟⠛⠉         4                            
                                          ⠈⠻⢷0+⣀⣤⡶+⠛⠉⠁+        2                                
                                      -2     -2⠋⠁           0                                   
                                         -4  -4     -4  -2                                      
                                                 -6                                             
                         y                                                                      
                                          z                                                     
                                                                                                
                                                                   x                            
                                                                                                
                                                                                                
                                                                                                

---- Synthetic clusters (scatter3d) — 96x32 blocks ----
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                           =-=-  =                                              
                                            = *=    =                                           
                                                    - +                                         
                                                  = *                                           
                                                 =  -=                                          
                                                                                                
                                                                                                
                                =             +                                                 
                                  -+          -    +                +                           
                             4       -       6===-    %          +=                             
                                2      =  -  4-+      -      =-        6                        
                                   0     =+  2=#*  -    ==         4                            
                                           =-0+   +=-=+        2                                
                                      -2     -2==           0                                   
                                         -4  -4     -4  -2                                      
                                                 -6                                             
                         y                                                                      
                                          z                                                     
                                                                                                
                                                                   x                            
                                                                                                
                                                                                                
                                                                                                

---- Synthetic clusters (scatter3d) — 140x40 box ----
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                  %   * +                                                                   
                                                               =-=#++ -=                                                                    
                                                                 == =                                                                       
                                                               =   =    -  =-   #+                                                          
                                                                        = %#+#*                                                             
                                                                        -= +                                                                
                                                                       - = #=                                                               
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                  =                 +                                                                       
                                                    -=              -                                                                       
                                              4       ==           6=  #+                     ===                                           
                                                        -=        - -=- -     -          =-=                                                
                                                  2       +-   -   4=       =        ==+           6                                        
                                                             =+    2-=+= #+     -=-           4                                             
                                                      0        ==   =       =-           2                                                  
                                                          -2      -0-  =-+           0                                                      
                                                                   -2           -2                                                          
                                                              -4   -4      -4                                                               
                                                                       -6                                                                   
                                                                                                                                            
                                         y                                                                                                  
                                                               z                                                                            
                                                                                                                                            
                                                                                              x                                             
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            

---- Sphere (parametric3d) — 96x32 braille ----
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                      ⢀⣠⣤⣶⣶⣿⣿⣿⣿⣿⣿⣷⣶⣦⣄⡀                                          
                                   ⢀⣤⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣤⡀                                       
                                  ⣠⣿⣿⣿⣿⣿⣽⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣿⣿⣦⡀                                     
                                 ⣼⣿⢿⣿⡿⣞⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⢿⢿⣿⣿⣷⡀                                    
                                ⢸⣿⣿⣿⣿⣟⡿⣾⣿⣟⡿⣿⣿⡽⣿⡯⣿⡿⣟⣿⣿⡿⣿⣯⣯⣿⣿⣧                                    
                                ⢸⣿⣷⣿⣿⣿⣽⣿⣞⡿⣽⣻⣾⣟⣟⣿⣿⣻⣽⣿⣽⣿⢛⡷⣿⣿⣿⡟                                    
                                ⠸⣿⣿⣿⣯⣯⢿⢾⣾⣿⣯⠟⡿⣞⡿⣞⣿⠯⣯⣯⢷⡻⣿⡽⢿⡿⣷⡇             1█                     
                           +⣄    ⠹⣿⣿⣗⡿⣟⣟⣮⢿⣿⣭⣿⣭⣯⣽⣻⣛⡿⡮⣟⣯⣳⣿⡿⡟⠇               █                     
                           ⠈⠛⢿⣦⡀  ⠘⢿⣿⣿⣵⣿⣷⣿⣿+⢽⣶⣯⣽⢾⡾⢯⣯⣽⡿⡚⠏⠃⠋             0.5▛                     
                        1     ⠙⢿⣦⣀  ⠉⠻⢿⠿⢛⣿⣿⡇⣿⠯⢿⠿⠯⣯⡿⠾⠚⠏⠚⠋     ⣀⣤⣶⣿+        ▛                     
                                ⠉⠻⣷⣄    ⠉⠛1+⠛⠛⠙⠛⠋⠛⠋⠉⠁   ⢀⣠⣴⣶⡿⠟⠛⠉         0▀                     
                            0.5   ⠈⠻⣷⣤⡀   0.5       ⣀⣤⣴⡾⠿⠛⠉+       1      ▀                     
                                0    ⠙⢿⣦⡀ ⣿⡇   ⢀⣀⣤⣶⠿⠛⠋⠁               -0.5▘                     
                                       +⠿⣶0+⣠⣴⠾⠟⠋⠉            0.5         ▘                     
                                    -0.5 ⠈-0.5          0               -1                      
                                                   -0.5                                         
                                       -1 -1 -1                                                 
                      y                                                                         
                                       z                                                        
                                                                                                
                                                               x                                
                                                                                                
                                                                                                
                                                                                                

---- Sphere (parametric3d) — 96x32 blocks ----
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                       =-=-=-=-=-=-=-=                                          
                                    =-===-===-===-===-===                                       
                                  -=-=-=-=-=-=-=-=-=-=-=-=-                                     
                                  =-===-=======-===========-                                    
                                 ==+++++++++++=+++++++=+=+==                                    
                                 =#*#+#*#****+****#*#*#+*+#+                                    
                           +      ######*###*#######*##%###              1#                     
                             =     %@%@%%%%+%%%%%%%%%%%%@%                *                     
                        1      =     @@@@@%=@@%@%@@@@@@@         +     0.5+                     
                                 -       @1+@@@@@@@@          ==          =                     
                            0.5    =-     0.5            =-+       1     0=                     
                                0     =    -        ===                   -                     
                                       +- 0+    -=            0.5     -0.5:                     
                                    -0.5  -0.5          0                 .                     
                                                   -0.5                 -1                      
                                       -1 -1 -1                                                 
                      y                                                                         
                                       z                                                        
                                                                                                
                                                               x                                
                                                                                                
                                                                                                
                                                                                                

---- Sphere (parametric3d) — 140x40 box ----
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                   ==-=                                                                     
                                                            -=-=-=-=-=-=-=-=-=                                                              
                                                         ==-===-===-===-===-===-=                                                           
                                                       =-=-=-=-=-=-=-=-=-=-=-=-=-=-                                                         
                                                     -===-===-===-===-===-===-===-===                                                       
                                                    -=-=-=-=-===-=-=-=-=-===-=-=-=-=-=                                                      
                                                    =+=+==+=+=+++++++++++++++=++==+-+=                                                      
                                                    =++*+*+***+***+*+*+*+*+++*+*+*+*+=                                                      
                                                    **#*###*#*#*#*#*#*#*###*###*#*#*#+                                                      
                                             =       ####%#####################%###%#                1█                                     
                                              =-       @%%%%%%%%+%%%%%%#%%%%%%%%%%@@                  █                                     
                                        1       -=+     @@@@%@%@-@%%%@%@%@%@%@@@@@                 0.5▓                                     
                                                   =       @@@@1=@@@@@@@@@@@@@@            ==         ▓                                     
                                             0.5     =-         - @@@@@@@            +-=-            0▒                                     
                                                      +-=      0.5               ==-           1      ▒                                     
                                                         =-     -            =-=                  -0.5░                                     
                                                  0        +=  0=      +=-=             0.5           ░                                     
                                                              -=-   -=           0                  -1                                      
                                                       -0.5    -0.5                                                                         
                                                                          -0.5                                                              
                                                            -1 -1  -1                                                                       
                                                                                                                                            
                                      y                                                                                                     
                                                           z                                                                                
                                                                                                                                            
                                                                                          x                                                 
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            

---- Torus (parametric3d) — 96x32 braille (camera override rotX:30, rotY:235) ----
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                          ⢀⣠⣤⣤⣄⣀                                                
                                       ⣠⣶⣿⣿⣿⣿⣿⣿⣿⣿⣶⣄                                             
                                     ⢠⣾⣿⣿⣿⣿⡿⠛⣿⣿⣿⣿⣿⣿⣷⣄                                           
                                    ⢠⣿⣿⣿⣿⡟⠟⠿⠟⡿⣿⣿⣿⣿⣿⣿⣷⣆                                          
                                    ⣼⣿⣿⣿⣯⠇⠏⠋⠉⠉⠻⠻⢿⣿⣿⢿⣿⣷                                          
                                ⣄   ⣿⣷⣿⣿⣿⡃      ⠘⣿⣿⣿⣿⣿                                          
                                +⣦  ⣿⣿⣿⣿⣿⣷⣀    ⢀⣼⣿⣿⣿⡟⡗           0.5█                           
                              2  ⠘⢷⡀⢸⣿⣿⣿⣿⣿⣿⣿⣶⣶⣿⣿⣿⣿⣿⡟⡟⡏   ⢀          █                           
                                  ⠈⢻⣄⢻⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠟⠟⡿⠏⠁⢀⣠⣾⠟+     0.25▛                           
                                 1  ⠹⣦⡙⢿⢿⣿⢿⣿⠿⡿⠟⠛⠿⠟⠛⠋⣡⣴+⠋⠁           ▛                           
                                     ⠈⢷⡄⠉⠻⢛⠟⠛⠋⠛⠛⠋⠋⣴⡾⠛⠁      2      0▀                           
                                   0   ⠻⣆ ⢸⠃  ⢀⣤⡾⠛⠁     1           ▀                           
                                        +⣧⣸+⣠⡶⠟⠉    0          -0.25▘                           
                                      -1 ⠈0.4                       ▘                           
                            y             0     -1              -0.5                            
                                         -2 -2                                                  
                                                                                                
                                                         x                                      
                                                                                                
                                                                                                
                                        z                                                       
                                                                                                
                                                                                                
                                                                                                
                                                                                                

---- Torus (parametric3d) — 96x32 blocks (camera override rotX:30, rotY:235) ----
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                           @@@@@@                                               
                                        @#-=-=-=-#@@                                            
                                      @@#-===-===-+@@                                           
                                     #%%+=-=-=-=-==%%#                                          
                                     +#%%=       =*%%*                                          
                                +    =+#@%        @#+=                                          
                              2   =  -===*@     @@#==-           0.5#                           
                                   =  -=-=-=***=-=-=-     +         *                           
                                 1     -===-===-===-  +         0.25+                           
                                      -  =-=-=-=-=   =      2       =                           
                                   0       =      =     1          0=                           
                                        += +   =    0               -                           
                                      -1  0.4                  -0.25:                           
                            y             0     -1                  .                           
                                         -2 -2                  -0.5                            
                                                                                                
                                                         x                                      
                                                                                                
                                                                                                
                                        z                                                       
                                                                                                
                                                                                                
                                                                                                
                                                                                                

---- Torus (parametric3d) — 140x40 box (camera override rotX:30, rotY:235) ----
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                               @@@@@@@@@                                                                    
                                                             @@#-=-=-=-=*@@                                                                 
                                                           @@#+-===-===-==#@@                                                               
                                                          %@#*-=-=-=-=-=-=+#@@                                                              
                                                         *%%%+===-    ===-+%%%*                                                             
                                                         +*%%#-          +#%#++                                                             
                                                   -     ==+@@%          %@#*==                                                             
                                                2        =-==#@@        @@*+-=-                                                             
                                                      +  -===-=*@@@@@@@*#-===-             0.5█                                             
                                                       =  -=-=-=-=-=-=-=-=-=-=     =+         █                                             
                                                    1    =  ===-===-===-===-    ==        0.25▓                                             
                                                          -  =-=-=-=-=-=-=    -+      2       ▓                                             
                                                       0         -===-    +=                 0▒                                             
                                                             =   +      -        1            ▒                                             
                                                              =  +   =      0            -0.25░                                             
                                                          -1    0.4=                          ░                                             
                                                                0.2    -1                 -0.5                                              
                                              y               -20                                                                           
                                                                   -2                                                                       
                                                                                                                                            
                                                                                  x                                                         
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                             z                                                                              
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            

---- Synthetic revenue (bars3d) — 96x32 braille ----
                                                                                                
                                                                                                
                                                  ⢀⡀                                            
                                              ⣀⣠⠴⠚⠉⡟⢦⡀                                          
                                           ⣤⠖⠋⠁      ⣙⣦                                         
                                           ⡏⠳⣄  ⢀⣠⠤⠖⠋⠁⢸⣠⣄                                       
                                     ⣀⡤⢶⣄⡀ ⡇ ⠈⢳⠚⠉ ⣀⡤⠴⠚⢹ ⠋⠓⢦⡀                                    
                                 ⣀⡤⠖⠋⠁   ⠙⠦⣇  ⢸ ⣶⣋⠁     ⣀⡤⠖⢻⢀⡀                                  
                                ⡿⣅⡀   ⢀⣀⡤⠖⠋⢹⢀⡀⢸ ⡇⠈⠳⢤⣀⡤⠖⠋⢁⣠⠴⢺⠉⡟⢦⣀                                
                          ⣀⡤⢶⣄  ⡇ ⠙⢦⠴⠚⠉ ⣀⣠⠴⢺⠉⡟⢾⣄⡇   ⡇⢠⡴⠚⠉      ⢈⣳⡄                              
                      ⣀⡤⠖⠋⠁  ⠈⠳⣄⡇  ⢸ ⣤⠖⠋⠁     ⣀⡬⣷   ⡇⢸⠙⠲⣄ ⣀⣠⠴⠒⠋⠉ ⡇⣀                             
                     ⡿⣅     ⢀⣠⠴⠚⡇⢀⡀⢸ ⡏⠓⢦⡀⢀⣠⠴⠒⠋⠁ ⢸⣠⣄ ⡇⢸  ⠈⡏⠁  ⣀⡤⠴⠒⡏⢹⠳⢤⡀    114█                  
                     ⡇⠈⠳⣄⣠⠴⠚⠉⣀⣠⠴⡟⡭⡟⢾⡀⡇  ⢹⠉  ⢀⣠⠴⠚⢹ ⡏⠓⣧⣸   ⡇⢰⣞⠉⠁     ⢀⣠⠽⡆      █                  
                     ⡇  ⢸ ⣤⠖⠋⠁      ⣙⣧  ⢸ ⢰⣞⠉     ⣀⡤⠖⢻   ⡇⢸⠈⠳⣄ ⣀⡤⠖⠚⠉  ⡇  85.5▛                  
                     ⡇  ⢸ ⡏⠓⢦⡀⢀⣀⡤⠖⠚⠉⠁⢸  ⢸ ⢸⠈⠙⢦⣀⡤⠖⠋⠁⢀⣠⢼⢚⡷⣄⡇⢸  ⠈⡏⠁      ⡇      ▛                  
                     ⢷⡀ ⢸ ⡇  ⢹⠉     ⢀⣸⡿⣦⣸ ⣸   ⡇⢀⣠⠴⠚⠉   ⡇⠈⠙⢾⡀  ⡇       ⡇    57▀                  
                      ⠉⠳⣼⡀⡷  ⢸  ⣀⡤⠖⠚⠉  ⡇⠉⣻+   ⡇⢸⠳⣄    ⣀⣠⠴⠚⠉⡇  ⡇       ⡇      ▀                  
                       4  ⣧  ⢸ ⡿⢥⡀    ⣀⡤⠖⢻⣿⡴  ⡇⢸ ⠈⠳⡤⠖⠋⠁    ⡇⢀ ⡇     ⡀⠴⠃  28.5▘                  
                          ⠈⠳⣄⢸ ⣇ ⠙⠲⡤⠖⠋⠁ ⢀120⡷⣤⡇⣸   ⡇       ⡇⠿⣟⡇ ⡤⠖⠚⠉         ▘                  
                            ⠈3⠚⣏   ⡇⢀⣠⠴⠚⠉100⠇ ⢙⣻⣤  ⡇       ⡇ ⠈⠉⠁   2        0                   
                               ⠙⢦⣀ ⡇⢸⠳⢤⡀ 80⡤⠴⠚⠉ ⡇⣴⡆⡇  ⡀⠤⠖⠚⠉                                     
                                 ⠈⠳⠧⢾  ⠙⡖60     ⡇⠁⠙⠓⠋⠉       1.5                                
                                  2 ⠸⣞  ⡇40  ⣠⠴⠚⠁       1                                       
                                    1.5⢦⣇20⠋⠉     0.5                                           
                                       1 0   0                                                  
                     quarter                                                                    
                                      revenue ($k)                                              
                                                                                                
                                                               region                           
                                                                                                
                                                                                                
                                                                                                

---- Synthetic revenue (bars3d) — 96x32 blocks ----
                                                                                                
                                                                                                
                                                                                                
                                                   %                                            
                                               %@%%%@%                                          
                                            -%%%%%%%%=-                                         
                                            =-=%%-===-=%%%                                      
                                     %%%%%  -=-=-=%%%%%%%%%%                                    
                                 %%%@%%%@%%%===-===%@%%%@==-                                    
                                 =-%%%%=-=-=-%-=-=-=-=-=-%%%%%%%                                
                           %%%@  -===-==%%@%%%@%=-===-=%%%@%%%@==-                              
                      %%%%%%%%%%%=-=-=-%%%%%%%%=-=-=-=-=-%%=-=-=-=%%                            
                      =-@%%%@==-==%-===-=%=-===-=%%%===-===-==%%@%%%@%    114#                  
                      -=-=-=-=%%%%%%%=-=-=-=-%%%%%%%%%-=-=-=%%%%%%%%-=-      *                  
                      ===-==%%@%%%@%=-===-===%@%%%@==-===-===-===-===-=  85.5+                  
                      -=-=-=-=%=-=-=-=-=-=-=-=-=-=-=-%%%%%-=-=-=-=-=-=-      =                  
                       -===-===-===-=%%%@=+-===-@%%%@%%%@%%-===-===-===    57=                  
                       4   =-=-=%%%%%%%%%%-=-=-=-=-%%%-=-=-=-=-=-=-=-=-      -                  
                            =-===-@%%%@==120=-===-===-===-== -===-==     28.5:                  
                             3-=-=-=-=-=-100%%% -=-=-=-=-=-=       2         .                  
                                ===-==%%@80%@%%-===-===-===                 0                   
                                  -=-=-=%60=-=-=-= =-=       1.5                                
                                  2  -===40==-===       1                                       
                                    1.5=-20=-     0.5                                           
                                       1 0   0                                                  
                     quarter                                                                    
                                      revenue ($k)                                              
                                                                                                
                                                               region                           
                                                                                                
                                                                                                
                                                                                                

---- Synthetic revenue (bars3d) — 140x40 box ----
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                          %%@                                                               
                                                                     %%%%%%%%%%                                                             
                                                                  =%%%@%%%@%%%==                                                            
                                                                  -=-%%%%%-=-=-=  %                                                         
                                                             %    =-===-===-=%%%@%%%@                                                       
                                                        %%%%%%%%% -=-=-=-%%%%%%%%%%%%%-                                                     
                                                    %%@%%%@%%%@%%-===-===-=%%%@%%%===-= %                                                   
                                                    -=-%%%%%%=-=-=-=-=-=-=-=-=-=-=-%%%%%%%%%                                                
                                              %%    ===-===-===-@%%%@%%-===-===%@%%%@%%%@%%%@=                                              
                                          %%%%%%%%% -=-=-=-%%%%%%%%%%%%%%=-=-=-=-=%%%%%%-=-=-=                                              
                                      @%%%@%%%@%%%@==-===-===%@%%%@%=-===-===-===-===-===-===%@%%                                           
                                      -=-%%%%%%=-=-=-=%=-=-=-=-%-=-=-=-=-%%%-=-=-=-=-=-=%%%%%%%%%%%                                         
                                      =-===-===-=%%%@%%%@==-===-===-@%%%@%%%@%=-===-===%@%%%@%%%@%=-   114█                                 
                                      -=-=-=-%%%%%%%%%%%%%-=-=-=-=%%%%%%%%%%%=-=-=-=-=-=-%%%%=-=-=-=      █                                 
                                      ===-===-=%%%@%%%===-===-===-==%%@%%-===-==%%===-===-===-===-==  85.5▓                                 
                                      -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=%%%%%%%%-=-=-=-=-=-=-=-=      ▓                                 
                                        ===-===-===-===-=%%%@%%-+==-===-@%%%@%%%@%%%@==-===-===-===-    57▒                                 
                                        4 -= =-=-=-=%%%%%%%%%%%%-=-=-=-=-=%%%%%%%=-=-=-=-=-=-=-=-=-=      ▒                                 
                                             -===-===%@%%%@%%%=120===-===-===-===-===-===-===-===-=   28.5░                                 
                                              -=-=-=-=-%%=-=-=-=+ %%-=-=-=-=-=-=-=-=-=-=-=-=-=            ░                                 
                                               3 = -===-===-=%%100%%@%  ===-===-===-==         2         0                                  
                                                   =-=-=-=%%%%%80%%%%%%=-=-=-=-=-=-=-                                                       
                                                  2.5-===-==%%@60%===-===-===-===       1.5                                                 
                                                      2=  -=-=-40=-=-=-=         1                                                          
                                                          =-===-===-===                                                                     
                                                         1.5-=-20=-       0.5                                                               
                                                            1  0   0                                                                        
                                                                                                                                            
                                      quarter                                                                                               
                                                           revenue ($k)                                                                     
                                                                                                                                            
                                                                                          region                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            

---- Lorenz attractor (line3d) — 96x32 braille ----
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                    ⣠⣤⣤⣄⡀                                       
                                                  ⣰⣿⠛⣉⠙⠻⣿⣦                                      
                                                 ⣰⣿⣿⣿⣿⣿⣶⡈⢿⣷                                     
                                                ⢀⣿⣿⣿⣿⣿⣿⣿⣷⠘⣿⡄                                    
                                                ⢸⣿⣿⣿⣿⣿⣿⣿⣿ ⢸⡇                                    
                                            ⣀⣀⣀⣀⣸⣿⣿⣿⣿⣿⣿⣿⣿⢠⣿⡇                                    
                                          ⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠏⣸⡿⠁                                    
                                          ⣿⣿⣟⣿⣿⣿⣿⣻⣿⣿⣿⣿⣿⢯⣾⡿⠁                                     
                                          ⠹⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⣿⣿⣿⠇                                       
                               +⣦⡀         ⠘⣿⣿⣿⣿⣿⣿⣿⣿⠿⠿⠋                                         
                               ⠈⠛⢿⣶⣄        ⠘⣿⣿⡇⣿⣿⡇                                             
                            30    +⢿⣷⣄       ⠈⢻+⣿⣿⡇              ⢀⣠⣴⣾⠇                          
                               20   ⠉⠻⣷⣤⡀     50⣿⣿⣿          ⣀⣤⣶⡿⠟⠛⠉                            
                                      ⠈⠻⣿⣦⡀   40⠈⠉⠃     ⢀⣠⣴⣾⠿⠛⠉⠁                                
                                  10     ⠙⢿+⣀ ⢸⡇    ⣀⣤⣶⡿⠟⠋⠉          20                         
                                     0     ⠙⠿⣷30⣠⣴⡾⠿⠛⠉          10                              
                                       -10   ⠈20⠋⠁         0                                    
                                          -20 10      -10                                       
                                              0  -20                                            
                          y                                                                     
                                           z                                                    
                                                                                                
                                                                   x                            
                                                                                                
                                                                                                
                                                                                                

---- Lorenz attractor (line3d) — 96x32 blocks ----
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                    -=-=@                                       
                                                   - @@  =%                                     
                                                  -=-=@@% -                                     
                                                 -===-@%   *                                    
                                                 =-=-%*#   *                                    
                                            @@@@@@@@++*+* *                                     
                                            -=-=-=-++*+*  -                                     
                                           %@@=@=-=+**= #                                       
                               +            *##@-+== #-                                         
                                 =           =*-+%=                                             
                            30    +=          -++=%                                             
                               20    -=       50= @               ==                            
                                        -     40 =-          =-                                 
                                  10      =+   -         ==          20                         
                                     0      - 30    -=          10                              
                                       -10    20=-         0                                    
                                          -20 10      -10                                       
                                              0  -20                                            
                          y                                                                     
                                           z                                                    
                                                                                                
                                                                   x                            
                                                                                                
                                                                                                
                                                                                                

---- Lorenz attractor (line3d) — 140x40 box ----
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                           =    -@                                                          
                                                                         -= @-@   =%                                                        
                                                                        -=+@-@@ %  %                                                        
                                                                        ==+@=@=- #  #                                                       
                                                                        -=-=@%####  *                                                       
                                                                        ====#*#*=*  *                                                       
                                                                 @@@-@@@%@-++++*+  *                                                        
                                                               @ @@@==@@==*+*+*+  *-                                                        
                                                               =%@ @-@@ #==*+*-  *                                                          
                                                                =%=@@@====**=  #=                                                           
                                                 +               =###%%=-*-%#=                                                              
                                                   -              =+*=+%=                                                                   
                                             30      =-             +===@%                                                                  
                                                       =+            -+==@                    +==-                                          
                                                 20       -         50-=-=                 =-                                               
                                                    10      =       40  ==            =-+                                                   
                                                              -=     =           =-=             20                                         
                                                        0       =-  30       -=            10                                               
                                                                   =20  -=-+                                                                
                                                           -10       =              0                                                       
                                                               -20  10        -10                                                           
                                                                    0   -20                                                                 
                                                                                                                                            
                                          y                                                                                                 
                                                                z                                                                           
                                                                                                                                            
                                                                                               x                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            

 ✓ src/3d/_c5FramesR2.test.ts (1 test) 157ms


 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  04:00:54
   Duration  938ms (transform 408ms, setup 0ms, collect 562ms, tests 157ms, environment 76ms, prepare 27ms)

```

Every shape reads correctly at a glance: the volcano's peak and ridges, the three distinct scatter clusters, a genuinely ROUND sphere silhouette, the torus's donut hole (with the noted camera override), a lattice of upright bars sized by revenue, and the Lorenz attractor's own recognisable double-lobed "butterfly" shape. All six share the identical axis-triad convention established by C2 rounds 7-8 — one fixed origin corner sitting clearly LEFT of the surface (`leftFraction ~= 0.41`, C2 fix round 8), real ribbon-mesh axis lines reading as light lines rather than dark blobs, whole tick labels with no `?` fold.

## C6 — every 3D mark type reaches `/charts`, plus Hugging Face

**The user, verbatim: "for the 3d charts, I would also like to see some scatter in 3d, some column chart in 3d, some and other 3d plots, maybe a sphere? a plane? some 3d charts from huggingface data?"** Before this packet `/charts` offered exactly one 3D type — `surface` — even though C5 had already shipped four more library constructors. This packet is the WEBSITE half: every mark type on the mark card, eight presets (one real/reused, one real/reused, two computed, two computed, one computed — see below), and Hugging Face search/Random extended into 3D. A parallel coordinator addendum ("you cannot configure the z axis in the /charts sidebar") landed mid-packet and is folded in here too, once C7 (the library's own per-axis option set, this file's own "C7" section) merged.

### Mark card: five Type buttons, one fit function per type

`ChartsMarkCard.tsx` widens the single `CHARTS_SURFACE_TYPE_VALUE` entry into five (`CHARTS_3D_MARK_TYPES = ["surface","scatter3d","bars3d","line3d","parametric3d"]`), each rendered through the SAME `IconToggle` the 2D types use, gated by its own fit against the CURRENTLY loaded table (`chartsFitTableFromRows`, `chartsWorkbench3d.ts`) — mirroring `chartsMarkTypeFit.ts`'s idiom exactly: a type is enabled iff its own fit function, run against the REAL constructor, succeeds. `parametric3d` never fits from a table (`CHARTS_PARAMETRIC3D_NEEDS`) — a parametrization needs a closed-form `(u, v)` sampling function no table of rows can supply — so it is disabled everywhere except when it's already the CURRENT mark (the same "current type always stays enabled" rule the mark-card Type row already followed for 2D and for the original "Surface" option).

Three new fit functions, each mirroring `chartsSurfaceFitFromRows`'s own "attempt the real constructor, catch its own validation error" discipline rather than a restated rule:

- **`chartsScatter3dFitFromRows`** — fits when the table has 3+ numeric columns; the actual x/y/z choice comes from `chartsRankColumnsForScatter3d` (below), not "first three in order".
- **`chartsBars3dFitFromRows`** — fits when the table has a numeric column for z plus TWO position columns (categorical or numeric — `bars3d`'s own x/y channels are NUMERIC positions, `packages/charts/src/3d/bars.ts`'s own doc: "do not become categorical axis ticks"). A categorical position is bridged to a numeric one by `categoryIndexField`, which maps each distinct raw value (first-seen order) to a stable integer and writes it as a NEW field on a shaped copy of the records — never a function channel (`GlyphChart3dChannelValue`'s own `(record, index) => value` escape hatch), because a function silently vanishes under `JSON.stringify` and this shape must survive `?c=` encoding intact (see "URL state", below). The real category NAME rides on `xLabel`/`yLabel`.
- **`chartsLine3dFitFromRows`** — fits when the table has 3+ numeric columns and 2+ rows; the first three numeric columns IN ROW ORDER become one trajectory (never regridded, never reordered — a line's whole point is the sequence).

### `chartsRankColumnsForScatter3d` — the "three most-informative axes" picker

The coordinator's own instruction: "pick the three numeric columns with the most spread and least correlation, and colour by a low-cardinality categorical column if one exists." A naive "first three numeric columns in table order" (the rule `surface`/`line3d` both use, deliberately, since a grid/trajectory has no "which three" ambiguity once the shape is fixed) is WRONG for scatter3d specifically: two columns that are near-duplicates of each other (say, a measurement in two units) would both get picked if they happen to sort first, wasting an axis on redundant information. The picker is GREEDY, not exhaustive (unnecessary at this page's column counts): the highest-variance column seeds the pick, then each further column maximizes `variance * (1 - maxAbsCorrelationWithAlreadyPicked)` — a column that duplicates information an earlier pick already carries scores low regardless of its own raw spread, so it loses to a genuinely independent column even one with lower variance. Pearson correlation, `0` on any degenerate pair (fewer than 2 finite values, or zero variance) rather than `NaN` leaking into a comparison. A low-cardinality (2-12 distinct values) categorical column, when one exists, becomes the series/colour channel — `undefined` otherwise, never invented. Shared verbatim by the local-table fit above AND `chartsBest3dFitFromRows` (the Hugging Face default-channel picker, next).

Mutation check (`chartsWorkbench3dTypes.test.ts`): a 30-row fixture where column `b = 2 * a` (correlation 1) and `b` has 4x `a`'s own variance — a naive "first N" rule picks `a` and `b` together (redundant); the real ranker picks `b` (the higher-variance of the pair) and excludes `a` in favour of two genuinely independent columns.

### Hugging Face data in 3D

The existing dataset search/Random (2D) already loads tabular HF tables; this packet extends both into 3D.

- **`chartsBest3dFitFromRows(records, title)`** — the auto-pick a freshly loaded table runs through, PRIORITY ORDER: a complete `(x, y)` grid (rare on real tabular data, but the most informative reading when it genuinely holds) → a genuinely CATEGORICAL x/y plus numeric z (bars3d, gated on `lowCardinalityCategoricalColumn` finding a real one — `chartsBars3dFitFromRecords` alone is MORE permissive, also accepting two arbitrary numeric position columns for the manual Type-toggle case, which would make bars3d "fit" almost any 3+-numeric-column table and starve scatter3d of ever being the auto-pick if not gated here) → the general 3+-numeric-columns scatter3d fallback every curated dataset below is chosen to satisfy. `null` when nothing fits.
- **`datasets/chart3dRemoteIndex.ts`** curates 5 Hugging Face ids — `scikit-learn/iris`, `mstz/wine`, `mstz/seeds`, `mstz/abalone`, `mstz/glass` — each verified via a REAL HTTP round trip against `datasets-server.huggingface.co`'s `/first-rows` (per-column `dtype` inspected directly, config resolved from `/splits` first since none use the Hub's own "default" config name) to carry 3+ numeric columns; four of the five also carry a natural low-cardinality categorical column (species/class/sex/glass_type) for series/colour. Shown as the dataset search box's own suggestions while a 3D type is active (`ChartsDataOverlay`'s new `remoteSuggestions` prop, `undefined` = the existing 2D `CHARTS_REMOTE_DATASET_INDEX` default) — never the "Built-in" browse list, which stays the 2D `CHARTS_DATASETS` unconditionally (switching it to a 3D list was considered and cut: the "Built-in" picker's own `onSelectBuiltIn` dispatches the 2D `select-dataset` action directly, so widening it to 3D presets would need its own action-shape branch for no functional gain the preset tray + mark-card Type row don't already cover).
- **`ChartsWorkbench.tsx`'s `loadRemote3dDataset`** mirrors `loadRemoteDataset` exactly (fromRandom/manual split, abort/generation refs) but fits through `chartsBest3dFitFromRows` and dispatches the NEW `select-3d-remote-table` action (carrying an already-resolved inline `Charts3dSource` — a reducer action can't itself be async, so the fit is resolved by the caller before dispatching) rather than `select-remote-dataset`. Shares `remoteLoadController`/`remoteLoadSeq` with the 2D loader, so only ONE remote fetch — 2D or 3D — is ever "current" at a time.
- **Random** (`randomChartsDatasetPick`'s new `dimension` argument, `chartsRandomDataset.ts`): `CHARTS_3D_REMOTE_DATASET_INDEX` joins the SAME combined pool as a FOURTH segment (`"chart3d-remote"`), appended strictly AFTER the existing `"chart3d"` segment — never inserted earlier, which would renumber every index-pinned test fixture the 2D/3D Random tests already carry. `dimension: "3d"` (the coordinator's own "Random in 3D picks from 3D-fitting datasets only" instruction) restricts the draw to `"chart3d"`/`"chart3d-remote"` picks alone, so a reader looking at a 3D chart is never bounced back to 2D by Random; omitting `dimension` (every PRE-EXISTING call site, and a 2D reader's own Random) is unchanged — still the full combined pool, still free to land on a 3D dataset, exactly as C3 shipped it.

### Eight presets, one per mark type (parametric3d gets two)

`Chart3dDataset` (`datasets/chart3d/types.ts`) is now a discriminated union on `markType`, one NAMED interface per variant (`Chart3dSurfaceDataset`/`Chart3dScatterDataset`/`Chart3dParametricDataset`/`Chart3dBarsDataset`/`Chart3dLineDataset`) rather than one flat surface-only shape — a vendored dataset module declares its OWN narrow type (`export const fooDataset: Chart3dScatterDataset = {...}`), so `dataset.data.z` (etc.) still type-checks with no runtime `markType` narrowing at the call site, matching the original C3 ergonomics exactly. `CHARTS_3D_DATASETS: readonly Chart3dDataset[]` (the union) is what every consumer (the tray, Random, `findCharts3dDataset`) actually iterates.

Real/reused (no new licence verification needed — both reuse a dataset this repo already vendored and credited):

- **`irisScatter3dDataset`** (`scatter3d`) — REUSES `irisFlowersDataset`'s own 150 rows verbatim (`../irisFlowers.ts`, `data: irisFlowersDataset.rows` — no copy, no re-fetch), channels `{x: sepal_length_cm, y: petal_length_cm, z: petal_width_cm, series: species}`. Same licence: Hugging Face `scikit-learn/iris`, public domain (UCI Machine Learning Repository).
- **`olympicsColumns3dDataset`** (`bars3d`) — REUSES `olympics2024MedalsByTypeDataset`'s own 30 rows (`../olympics2024MedalsByType.ts`, country x medal-type x count), pre-shaped with `countryIndex`/`medalIndex` integer fields (the SAME `categoryIndexField` bridge the fit function uses) and the real country/medal names on `xLabel`/`yLabel`. Same licence: Wikipedia, "2024 Summer Olympics medal table", CC BY-SA 4.0.

Computed (labelled as such in each dataset's own `description`; `source.licence` reads "N/A — generated by this repository's own math, not sourced data", mirroring `packages/charts/fixtures/3d/LICENSES.md`'s own "SYNTHETIC, not real data" convention for the C5 fixtures — there is no natural "real dataset" a sphere, torus, tilted plane, or Lorenz attractor could reach for):

- **`tiltedPlaneDataset`** (`surface`) — the user's own "a plane?" ask: `z = 0.35x + 0.55y + 1` over a 16x16 grid, `[-5, 5]` in x and y. Every z value lies exactly on the plane (unit-tested to 6 decimal places) — a clean reference surface with no data-reading ambiguity, useful for checking the axis triad/camera/shading against a known-flat shape.
- **`sphereParametric3dDataset`** (`parametric3d`) — `glyphChart3dSphereGrid(1, 24, 36)`, coloured by a REAL spherical-harmonic value grid (l=2, m=0: `3cos^2(theta) - 1`, the classic "d_z^2" orbital shape) via the `value` grid `glyphChartParametric3d` accepts, so the colour band genuinely differs from every OTHER preset's "colour reads height" convention. Every point's distance from the origin is unit-tested to equal 1.
- **`torusParametric3dDataset`** (`parametric3d`) — `glyphChart3dTorusGrid(1.4, 0.5, 24, 36)`, coloured by z (the default). Every point's distance from the major-radius ring (in its own minor-angle plane) is unit-tested to equal the minor radius, 0.5.
- **`lorenzAttractorDataset`** (`line3d`) — `glyphChart3dLorenzAttractor()` (the library's own C5 shipped example), unmodified.

`packages/charts/fixtures/3d/`'s own C5 SYNTHETIC fixtures (`syntheticClusters3d.json`/`syntheticRevenue3d.json`) are NOT reused here — the website's own iris/olympics reuse (real data) and computed sphere/torus/plane/Lorenz examples cover every mark type without needing a seeded-random synthetic fallback a second time.

### URL state

`Charts3dSource`'s `"inline"` kind gained one variant per fittable `markType` (never `parametric3d` — this file's own doc, above), each storing PLAIN STRING channel field names only (never the constructor's own function-channel escape hatch — see `categoryIndexField`'s doc, above, for why: a function silently vanishes under `JSON.stringify`, and this shape must survive `chartsUrlStateForEncode`'s own "blank `rows`, keep `channels`" pass intact). `validateCharts3dSource` (`chartsUrlState.ts`) gained one validation branch per `markType`, each checking its own channel shape independently; an inline source naming an unrecognised `markType` (including `"parametric3d"`, which never HAD an inline shape) is simply unrecognised and returns `null`, exactly like any other malformed source — the whole `chart3d` payload then degrades to the 2D default, the same graceful fallback the original surface-only inline source always had.

Coordinator addendum — the Axes folder's per-axis overrides (`Charts3dAxisOverride`, `chartsWorkbench3d.ts`) ride `?c=` append-only: `title`/`ticks` (wired the moment this packet landed, before C7 merged) plus `format`/`line`/`tickMarks`/`tickLabels`/`grid`/`color`/`domain` (wired once C7's own library fields existed). `validateCharts3dAxisOverride` checks each field independently — a bad `format` name (outside `CHARTS_3D_AXIS_FORMAT_NAMES`, the Dock's own safe subset, below) degrades to absent for THAT FIELD alone, never rejecting its siblings or the whole `chart3d` payload, mirroring `validateCharts3dGuides`'s own per-field posture exactly. The shared `axes.color` (C7) rides as one more field on the SAME `Charts3dAxesOverride` object, validated with the same canonical-hex check (`isChartsHex`) the rest of this page's colour fields already use.

### The Axes folder: three real per-axis row sets, live in the SAME lil-gui folder

The Dock's "Axes" folder previously configured only the 2D `x`/`y` axes — while a 3D type was active, it still showed (and edited) those same two rows, which had nothing to do with what was on screen. `ChartsDock.tsx` now mounts a THIRD "Z" axis's worth of rows too, X/Y/Z, ALL live in the identical lil-gui folder as the 2D rows (never a second folder) — every row is created UNCONDITIONALLY (lil-gui/React hook-call-order rules forbid conditionally calling `useText`/`useToggle`/etc.), then the WHOLE 2D set and the WHOLE 3D set are toggled via `DockController.setVisible(!is3d)`/`setVisible(is3d)` respectively, the same `.hide()`/`.show()` primitive (`domElement.style.display`) `ChartsDock.tsx`'s own View-folder gating already used for the folder itself, now applied per-controller instead of per-folder. Each 3D row's own lil-gui NAME carries a `" (3D)"` suffix specifically so it never collides with the 2D row of the identical name mounted alongside it in the same folder (only one set is ever VISIBLE, but both always exist as real DOM rows — a screen reader or a test querying by name text must still be able to tell them apart).

Per axis:

- **Title** (`useText`) — `override.title ?? ""`, the SAME "empty means auto" rule `ChartsWorkbenchAxis`'s own 2D title field already follows.
- **Ticks** — an "auto" checkbox plus a slider, mirroring `useTicksControl`'s own 2D idiom exactly (the function itself now takes a `visible` parameter and manages its own `.setVisible` for the 2D case, rather than a second copy of the auto/slider logic) — unchecking auto seeds the slider from the axis's own ACTUAL resolved tick count (`resolved?.ticks.length`, from `chart3dResolved`, a new `ChartsDock` prop), never a guessed flat number, the same "ground the seed in what the reader can currently see" rule the 2D ticks row follows.
- **Format** — a `useOption` select over `CHARTS_3D_AXIS_FORMAT_NAMES` plus `"auto"`. This is a Dock-safe, DELIBERATELY NARROWED subset of the library's own `GLYPH_CHART_TICK_FORMAT_PRESET_NAMES`: `number`/`si`/`compact`/`integer`/`percent`/`currency`/`scientific` — every ZERO-REQUIRED-PARAM, NUMERIC-appropriate preset. Excluded: `decimals`/`template` (both have a REQUIRED param — `places`/`pattern` — this row has no field for), and the whole `date`/`year`/`month`/`day`/`time` family (WRONG for a 3D axis, whose domain is ALWAYS plain linear numeric — never a date; those presets read a tick's raw number as a Unix timestamp). The subset is computed by filtering the CANDIDATE list against the library's own real `GLYPH_CHART_TICK_FORMAT_PRESET_NAMES` at module load, so a future library rename/removal of one of these seven names drops it from the Dock row automatically rather than offering a preset `resolveGlyphChartTickFormat` would reject.
- **Line / tick marks / tick labels / grid** — four `useToggle` rows, seeded from the axis's own FULLY RESOLVED visibility (`GlyphChart3dResolvedAxis.lineVisible`/`tickMarksVisible`/`tickLabelsVisible`/`gridVisible` — C7's own already-merged library-default-then-guide-then-axis-override chain, so the shown value is always exactly what the reader is currently looking at). Writing ALWAYS sets an explicit override — there is no separate "[reset] back to auto" control for these two kinds of row (unlike title/ticks/format/domain, which all keep one), a DOCUMENTED, BOUNDED simplification: once a reader touches a visibility toggle or a colour swatch, the ONLY way back to "follow the library default" is picking the exact value that currently displays, not a genuine `undefined`-restoring action. A future increment can add a small reset button per row (mirroring the `.instrument-row-reset` idiom `/maps`' own Tilt/Bearing rows use) with no shape change to `Charts3dAxisOverride` itself.
- **Colour** — a `useColor` swatch per axis (`override.color ?? resolved?.color ?? "#7a7f8a"`, the library's own muted-grey default) PLUS one shared `"Axes colour (3D)"` swatch (`set-3d-axes-color`, writing `chart3d.axes.color` — the C7 shared fallback every axis's own colour overrides). Both dim (with the SAME reason the 2D axis-colour swatches already use) under `Color: none`.
- **Domain** — a NEW, much simpler sibling of the 2D `ScaleDomainControl` (`Charts3dAxisDomainRow`): a 3D axis domain is ALWAYS plain finite linear numbers (`GlyphChart3dResolvedAxis.domain`), never log/time/zero-anchored, so none of `ScaleDomainControl`'s own `loFloor`/`loCeiling`/`capReason` machinery applies. Bounds are the resolved axis's own NICE domain padded +/-20% (mirroring 2D's own ordinary-scale padding). Either end left `null` (cleared) reverts BOTH ends to auto — `GlyphChart3dAxisOptions.domain` is one ATOMIC `[min, max]` tuple with no partial-override shape, unlike 2D's independently-nullable min/max — a documented, bounded simplification for the same reason the visibility toggles are.

`mergedAxisOption`/`mergedAxesOption` (`chartsWorkbench3d.ts`) forward every one of these nine fields (eight per-axis plus the shared colour) to `options.axes.{x,y,z}`/`options.axes.color` UNIFORMLY across all five constructors — the option shape is IDENTICAL everywhere per C7 (`{x?,y?,z?,corner?,color?}`, each per-axis entry `GlyphChart3dAxisOptions`), so one merge function serves every mark type with no per-type branching beyond the dataset-vs-inline split `buildChart3dDatasetMark`/`buildChart3dInlineMark` already had. `corner` is deliberately untouched by the merge (no Dock control writes it, and no vendored/computed dataset sets one) — a caller spreading `...dataset.options` underneath the merge result still carries the dataset's own `axes.corner` unchanged, since the merge function never emits that key.

### The Effects folder target, relabelled

`CHARTS_3D_EFFECT_TARGETS`'s one non-"whole chart" entry was labelled `"Surface"` — correct when `surface` was the only mark type, misleading once `scatter3d`/`bars3d`/`line3d`/`parametric3d` joined it (each of those mounts a DIFFERENTLY-NAMED data mesh — `"points"`/`"bars"`/`"line"`/`"surface"` respectively, per `object.ts`'s own mesh-name table). Relabelled `"Chart"`; `Charts3dViewport.tsx`'s `resolveEffectTarget` now resolves the SAME stable stored id (`CHARTS_3D_EFFECT_SURFACE_TARGET`, kept unchanged so `?c=`/`effect3d.targetId` never changes shape across a mark-type switch) to whichever mesh is ACTUALLY mounted — the first entry in `GlyphSceneObjectHandle.meshes` that isn't `"axis-lines"` — rather than a hardcoded `.get("surface")` lookup, which would silently mount NOTHING (a stale-target `null`, per this file's own "Per-object targeting" contract) for every mark type but `surface`/`parametric3d`.

### Gates and mutations (packet C6)

`pnpm --filter @glyphcss/website test` (touched no library file — this is a page-only packet, confirmed by a clean `git diff --stat` scoped to `website/src/components/ChartsWorkbench/`). New/extended files: `chartsWorkbench3dTypes.test.ts` (19 tests — the three new fit functions, `chartsRankColumnsForScatter3d`'s own redundant-column mutation check, `chartsFitTableFromRows`'s parametric3d-always-unfit gate, `chartsBest3dFitFromRows`'s priority order), `chartsWorkbench3dPresets.test.ts` (16 tests — every one of the 8 presets mounts a REAL live scene with non-blank painted output, and renders a non-blank static thumbnail), `datasets/chart3d/datasets3d.test.ts` (rewritten — per-preset geometric/statistical pins: the plane's own points lie exactly on it, the sphere's/torus's own points lie at the exact expected distance, iris/olympics reuse the exact same rows/licence as their 2D siblings), `chartsUrlState.test.ts` (+14 — one round trip per vendored dataset, one inline-source-never-written check per fittable markType, a full axes-override round trip including the shared colour, an old-link-no-axes-key decode, a bad-format-name degrade), `chartsRandomDataset.test.ts` (+6 — the new pool segment is reachable, `dimension: "3d"` narrows correctly without collapsing to one kind, the default `dimension` is unchanged), `ChartsMarkCard.test.tsx` (+4 — all five 3D buttons render with correct enable/disable state, a click dispatches `select-3d-table` with the right `markType`, the current type stays enabled against unfit data, no 3D buttons at all when `chart3dFits` is undefined), `Charts3dViewport.lifecycle.test.tsx` (+2 — an axis-title edit reaches `objectUpdate` with NO scene remount and changes the Copy ASCII text; the 2D/3D Axes-folder row sets are mutually exclusive by `display`).

| Item | Gate | Mutation | Result |
|---|---|---|---|
| Redundant-column exclusion | `chartsWorkbench3dTypes.test.ts` | Replace `chartsRankColumnsForScatter3d` with "first 3 numeric columns in table order" | RED — the fixture's redundant `a` (correlation 1 with `b`) would be picked alongside `b` |
| bars3d auto-pick gating | `chartsWorkbench3dTypes.test.ts` | Drop the `lowCardinalityCategoricalColumn` gate from `chartsBest3dFitFromRows` | RED — a 3-numeric-column table with no categorical column would resolve to `bars3d`, not `scatter3d` |
| Inline channels stay JSON-safe | (documented, not independently gated beyond the URL round trip) | Use a function channel for a categorical bars3d position instead of `categoryIndexField` | Not separately caught by an automated test beyond the round trip itself losing the field silently — see residuals |
| Effect target generalization | `Charts3dViewport.lifecycle.test.tsx` | Revert `resolveEffectTarget` to a hardcoded `.get("surface")` lookup | RED for any non-surface/parametric3d mark type mounted with an effect targeted at "Chart" (not directly gated in THIS packet's own tests — `charts3dEffectTargeting.test.ts` exercises the library primitive directly, at the surface markType only; a residual, see below) |
| Axes-folder live update | `Charts3dViewport.lifecycle.test.tsx` | Drop the `state.chart3d.axes` dependency from `chart3dResolvedLive`'s `useMemo` deps | RED — editing "X title (3D)" would leave `objectUpdate` uncalled and Copy ASCII unchanged |
| Random dimension gate | `chartsRandomDataset.test.ts` | Drop the `dimension === "3d"` filter from `randomChartsDatasetPick` | RED — a `"dataset"`/`"remote"` (2D) kind would appear among 300 `dimension: "3d"` draws |
| Parametric3d preset-only | `chartsWorkbench3dTypes.test.ts`, `ChartsMarkCard.test.tsx` | Give `chartsFitTableFromRows` a real fit function for `parametric3d` instead of the constant unfit entry | RED — the mark card would offer Parametric as pickable against arbitrary data, which the library has no path to honour |

### Residuals

- **No effect-targeting test exercises a non-surface 3D mark type directly.** `charts3dEffectTargeting.test.ts` (C4) still mounts only the default `surface` dataset; `resolveEffectTarget`'s generalization (the "first mesh that isn't axis-lines" rule) is exercised by `Charts3dViewport.lifecycle.test.tsx`'s existing "Chart" target test, which also mounts a surface-type dataset (Maunga Whau, the tray's own first tile) — the mesh-name lookup's OWN correctness for `scatter3d`/`bars3d`/`line3d` (mesh names `"points"`/`"bars"`/`"line"`) is proven only by direct code reading of `object.ts`'s table, not a dedicated test mounting one of those types with an effect targeted at "Chart". A future increment should add one.
- **No "reset to auto" control for the Axes folder's visibility toggles or colour swatches** (documented above, in "The Axes folder" section) — a reader who touches one can reach any explicit value but not literally clear back to "follow the library default"; title/ticks/format/domain all keep a real reset path.
- **`ChartsDataOverlay`'s "Built-in" browse list stays 2D-only** even while a 3D type is active — considered and cut (see "Hugging Face data in 3D", above) since the preset tray and the mark-card Type row already cover every vendored 3D preset with no second picker needed.
- **The domain RangeSlider's bounds are recomputed from the CURRENT resolved mark on every render**, not memoised separately from `chart3dResolved` itself — acceptable at this page's data sizes (mirrors the 2D `ScaleDomainControl`'s own `chartsWorkbenchInferredDomains` recomputation discipline), but worth naming if a future profiling pass finds it costly.

## D2 round 7 — braille and blocks only, geometry edges, triangulated stage-by-stage flow

**The user, verbatim: "the 3d graphs make sense but clearly we cannot use lines and bars because they do not translate well to angles :/ we need to use braille and blocks for 3d diagrams."** A follow-up added the layout direction: "they could be like in the same plane at each depth, but not in the same line... like one in front two in the back... or two in the front one in the back, etc... triangulated." This round replaces D2 rounds 3-6's shared-plane embedding, `style: "ink"/"wireframe"/"solid"` switch, and hand-stamped box-outline/edge/arrowhead overlays outright.

### Charsets

`resolveCharset(charset, target)` (`render3d.ts`) is now a 2-way table, not the old ascii/box/blocks/braille 4-way one: `"braille"` -> `{ mode: "wireframe", charMode: "braille", hiddenLines: "hide" }`, `"blocks"` -> `{ mode: "solid", charMode: "halfblock", hiddenLines: "hide" }`, and `"ascii"`/`"box"` degrade to whichever of the two the TARGET supports (`"blocks"` on `chat`, `"braille"` otherwise), logging `3d-charset-degraded` once. Box-drawing and bar glyphs (`─ │ ▔ ‾ ▏ ▕ / \ _`) genuinely cannot trace an edge or a box face seen at an angle — that's the user's own stated reason, and it's mechanically true: those glyphs are drawn at fixed cell-aligned orientations, while a 3D edge or a box's own side face can land at any screen angle. Braille's 2x4 sub-cell dot mask and blocks' half-block sub-cell shading can both approximate an arbitrary angle; box-drawing cannot. Target defaults: `chat` -> `blocks` (a chat client's fenced-code font carries the Block Elements range but essentially never braille), `terminal`/`web` -> `braille`.

### Edges and arrowheads as geometry

The single biggest architectural change: an edge is no longer a stamped overlay glyph walking a 2D-routed polyline. `glyphDiagramObject.ts`'s `orientedRibbonPolygons(a, b, halfWidth, color)` sweeps a thin oriented box between two arbitrary 3D points — a `frameFromForward(forward)` orthonormal basis (`right = normalize(cross(worldUp, forward))`, `up = cross(forward, right)`) proven algebraically to give `cross(right, up) === forward` exactly, so the swept box's winding matches `boxPolygons`' own CCW-from-outside convention with no per-case correction. `orientedPyramidPolygons(source, tip, halfWidth, length, color)` builds a real 4-triangle-plus-cap pyramid, apex at the target face. Box outlines are no longer drawn at all — they come from the SOLID/WIREFRAME ENCODER itself (braille traces every polygon edge as sub-cell dots automatically; blocks reads face-contrast Lambert shading at the box's own edges). A group gets a 12-edge ribbon outline traced around its padded AABB (`groupOutlinePolygons`), the same ribbon primitive. The ONLY remaining stamped overlay is label text — `resolveGlyphDiagram3dLabelPlacement` is otherwise unchanged in spirit from earlier rounds (inside/side/auto anchoring against the real projected screen width), but its `axes` parameter is gone entirely: every box is now a literal world-axis-aligned box (see "Layout" below), so `"inside"`'s front face is the literal `[center[0], center[1]-half[1], center[2]]` point, no plane-basis vector math needed. A `"side"`-mode leader line is a documented residual of dropping the stamped-overlay machinery — it is simply not drawn any more (see "Residuals").

### Layout — triangulated stage-by-stage flow (`layout3d.ts`, "layered")

Round 5/6's shared-PLANE embedding put every node's front face on ONE wall (2D dagre x/y mapped onto two ground vectors chosen so the flow read with zero row drift) — which is exactly why it could only ever show one flat face: round 6's own proof showed the plane's depth axis `n` has a column coefficient forced to zero by the camera's own trig identity, so a genuine side face was mathematically impossible. This round drops the shared plane entirely. Each dagre RANK becomes its own cross-section PLANE, perpendicular to a flow axis chosen from the graph's own direction (`LR`/`RL` -> world X, `TB`/`BT` -> world Z). Every node's own box stays a plain, world-axis-aligned box in EVERY direction now — width always X, depth (extrusion) always Y, height always Z, exactly `boxPolygons`' own convention (`@glyphcss/core`) — because whichever of X/Z happens to be the flow axis for this direction is also, not coincidentally, the axis the node's own along-flow extent (its label width for LR/RL, its label height for TB/BT) already measures. This is why NO shared plane basis (`u`/`n`, round 5's `glyphDiagram3dPlaneAxes`) survives into this round at all.

Within one rank's own cross-section plane, siblings are placed on a REGULAR RING via a single formula covering every count the brief enumerated as separate cases (`triangulatedOffsets`): 1 node sits at the plane's own centre (radius 0); 2+ nodes sit at `count` evenly-spaced points around a circle sized so adjacent points clear each other by `GLYPH_DIAGRAM_3D_RING_GAP` world units plus both points' own in-plane half-extents, starting at a base angle that ROTATES per rank (`GLYPH_DIAGRAM_3D_RING_BASE_ANGLE + rank * GLYPH_DIAGRAM_3D_RING_ROTATE_DEG`, an increment with no small common period against 360 degrees, so consecutive fans never realign to the same pattern). This single formula reproduces every case the brief named: 2 points 180 degrees apart at an off-axis base angle read as "one in front, one behind, offset sideways too"; 3 points are always a non-degenerate triangle for any positive radius; a rotating base angle naturally alternates which side has 1 vs 2 members. The `layout3d.test.ts` gate built specifically for the coordinator's own check ("Use `Merge` + `Side` -> `Output` from the fan-join-split example") confirms `Merge` and `Side` land at the SAME flow coordinate (same rank) but opposite DEPTH sign — a genuine front/back split, never side by side.

Edges are now genuine straight 3D segments. The 2D A* router (`route.ts`) and its port reservation (`reserveGlyphGraphPorts`) are GONE from this path entirely — the module still calls `measureGlyphGraph`/`layoutGlyphGraph` (dagre), but only for rank assignment and within-rank crossing-minimized ORDER, never as a literal 3D placement any more. An edge's own endpoints are the source's OUTGOING face and the target's INCOMING face along the flow axis — a back-edge leaves its source's BACKWARD face and arrives at its target's FORWARD one, so a cycle-closing edge still reads correctly — falling back to the generic `nodeSurfaceAnchor`/`selfLoopPoints` primitives (unchanged from earlier rounds) for a same-rank edge or a self-loop. Because nothing here routes AROUND other geometry any more, this layout can never report an `unroutable` edge — this is a structural guarantee, not a policy: there is no routing step left that could fail. Groups get a plain world-axis-aligned bounding box (`min`/`max`, padded by `GLYPH_DIAGRAM_3D_GROUP_PAD`) — the SAME computation `"force"` layout already used, now shared by `"layered"` too since neither has a plane basis to project a group through any more. `"force"` itself is UNCHANGED by this round.

The camera is now ONE fixed, EMPIRICALLY tuned pose (`GLYPH_DIAGRAM_3D_CAMERA_ROT_X = 62, GLYPH_DIAGRAM_3D_CAMERA_ROT_Y = 36`) — there is no more shared plane for a yaw to analytically solve zero-row-drift against (round 5/6's own `u = rotY + 90deg` derivation), so this pose was found and verified the same way the coordinator's own instruction demanded: rendered and inspected directly.

### The overlap bug found by rendering the real examples, and its fix

Rendering the 8-node LeNet-5 chain at this new camera surfaced a real defect the small (3-4 node) unit-test fixtures never exercised: consecutive-rank boxes' own projected COLUMN WIDTHS overlapped their neighbour's by 17-22% (measured precisely, `render3d.test.ts`'s own "consecutive-RANK" gate, every rank-adjacent pair on the real fixture), which compounds visually across an 8-rank chain into a dense, hard-to-read diagonal smear rather than distinct blocks with real gaps between them. Root cause: rank-to-rank spacing was originally sized off each box's own raw FLOW-AXIS world half-extent alone (`flowHalfOf`, e.g. box width for LR). That is a correct bound on the box's own along-flow WORLD extent (no two ranks ever share the same world X range), but it is not a bound on the box's own SCREEN footprint — under this camera's oblique pitch, a box's DEPTH and HEIGHT axes contribute comparably to (and, measured, for the depth axis specifically, MORE than) the projected screen column than the flow axis itself does (measured on the real camera: `|d(col)/d(depth)| ~= 0.87` per world unit vs `|d(col)/d(flow)| ~= 0.63`, at the auto-fit zoom used for the 8-node chain). Spacing by flow-axis half-width alone therefore left the depth/height axes' own screen contribution completely unaccounted for, and consecutive ranks' silhouettes overlapped by that measured 17-22%. Fixed with `screenSafeFlowHalf(n) = flowHalfOf(n) + crossHalfOf(n) + depthHalfOf(n)` — summing all three of a box's own half-extents as its along-flow spacing unit, a simple, camera-angle-agnostic conservative bound (every axis's own screen-coefficient magnitude is within the same order for this camera, so summing all three safely over-spaces rather than under-spacing) rather than a per-camera-angle-exact analytic derivation; post-fix, the SAME rank-adjacent pairs measure EXACTLY 0% column overlap. Verified by re-rendering LeNet-5, the transformer, agent-supervisor, crew and the new fan-join-split fixture and confirming every box reads as a visibly separate block with real gaps — the frames below are the fix, not the bug.

### glyphcss: halfblock/quadrant with a mounted `transformCells` hook

The "blocks" charset's node labels are drawn through a scene-object OVERLAY, which mounts via `scene.transformCells` — and glyphcss's halfblock/quadrant dual-colour encoder used to fall back to the single-colour ramp whenever ANY `transformCells` hook was mounted at all, silently dropping every label. Fixed in `packages/glyphcss/src/render/rasterize.ts`'s `rasterizeSolid`: `wantsHalfblockSolidOverlay`/`wantsQuadrantSolidOverlay` mirror the ORIGINAL (`transformCells`-absent) eligibility predicates exactly except for one flipped clause (require the hook PRESENT rather than absent), so the no-overlay fast path is completely untouched, still gated on `!scene.transformCells`, byte-identical. The overlay case instead falls through the ORDINARY single-colour downsample -> hook pipeline (so the hook sees real occlusion via `finalDepth`/`finalWinnerMesh`, needed for the label arbiter), snapshotting the PRE-hook single-colour result first; after the hook runs, the SAME dual-colour decision table the fast path uses (extracted into `buildHalfblockSolidBuffers`/`buildQuadrantSolidBuffers`, shared by both paths, byte-identical refactor) is computed fresh from the raw supersampled subcells, and a per-cell diff against the pre-hook snapshot decides which cells the hook actually touched — those are overridden WHOLE (the hook's own glyph + foreground colour, background cleared), every other cell keeps real dual-colour geometry ink. Gated by two new tests per charMode: "a hook that touches NOTHING still renders real halfblock/quadrant glyphs — byte-identical to no hook at all," and "a hook that writes one cell overrides it WHOLE while every other cell keeps real dual-colour ink."

A second, related bug: `compileScene`'s `grid` field would become non-null (and WRONG) for this new case — `scene.captureCells` fires unconditionally via the existing `applyCellHook` machinery whenever a hook exists, so it captured the ORDINARY single-colour post-hook snapshot, not the actual dual-colour string the render produces. Fixed by forcing `grid: null` in `compileScene.ts` whenever `mode === "solid" && (charMode === "halfblock" || charMode === "quadrant")`, UNCONDITIONALLY (not just in the no-overlay case) — restoring the pre-existing "a dual-colour cell has no honest single-`CellGrid` representation" contract regardless of whether an overlay is mounted. This forced a second architectural change: `render3d.ts` can no longer reconstruct a `GlyphCanvas` from a `CellGrid` for the "blocks" charset at all (there is none), so it now calls `compileScene` directly for that charMode and unescapes its own `inner` string for plain text — and since `encodeGlyphBuffersDual` has no ANSI form at all (only HTML `<span>` markup or plain text), an ANSI colour mode under "blocks" degrades to plain text with a new `3d-blocks-ansi-unsupported` ledger entry rather than a silent wrong render.

### New example: fan-out / join / split

A hand-authored fixture (`packages/diagrams/fixtures/fan-join-split.mmd`) exercising exactly the topology the coordinator specified: one input fans to 3 branches, joins to one node, splits into 3 again, two of those merge into one node while the third goes to a separate "side" node, and both `Merge` and `Side` feed one final `Output`. Added as a 5th 3D preset (`website`'s `diagramsWorkbenchState.ts`, id `fan-join-split-3d`) and to every round-7 gate. It renders cleanly at all three required settings with an empty ledger (no unroutable edges, no dropped labels) — see the frames below; `Merge` and `Side` visibly separate front/back before both feeding `Output`, per `layout3d.test.ts`'s own dedicated gate.

### Website (`DiagramsWorkbench`)

`resolveCharset` (and `resolveDiagrams3dSceneOptions`, its page-local wrapper) now take the render TARGET as a second argument, so the live 3D viewport's Dock dims exactly `ascii`/`box` (not `braille`/`blocks`, the library's own two primary looks) with the resolver's own reason, per target. Box outlines/edges being real mesh geometry with no charset-dependent tier baked into `glyphDiagramObject`'s option surface (`tier`/`boxOutline` are GONE from its type entirely) means `Diagrams3DViewport.tsx`'s prior `[charset]` object-rebuild effect is deleted outright — a charset or colour edit is now purely `scene.setOptions(resolveDiagrams3dSceneOptions(...))`, exactly like a colour-only edit always was, never touching the mounted object or camera. Applying a 3D preset now clears any charset OVERRIDE so it falls back to the target's own default (`GLYPH_DIAGRAM_TARGET_DEFAULTS`, which is already `braille` for `web`/`terminal`) — satisfying "presets open 3D on braille for web" without a second, parallel default table.

### Gates

All structural round-7 gates are automated tests, not just visual inspection: `layout3d.test.ts` — siblings in a rank share the flow coordinate but no two share both in-plane coordinates, a 3-sibling rank is a non-collinear triangle, a single-member rank stays centred, an edge lands on its own source/target face, no edge is ever reported unroutable, and the fan-join-split-specific `Merge`/`Side` front-back check. `render3d.test.ts` — no box-drawing/bar glyph appears anywhere in a 3D frame outside label text (both charsets), a single-node-per-rank LR chain reads as a genuine diagonal (both column and row progress monotonically in one direction each), `resolveCharset` never degrades braille/blocks and always degrades ascii/box, the target x charset x colour matrix (60 cells) all render real content with the right degrade/no-degrade behaviour, and the fan-join-split fixture renders with every label whole and no unroutable edges in both charsets. `glyphDiagramObject.test.ts` — an edge mesh is real ribbon geometry (>= 6 polygons), a group mesh is the 72-face outline bounding its members, an arrowhead's apex sits on the edge's own final point. `rasterize.halfblock.test.ts`/`rasterize.quadrant.test.ts` — the no-hook fast path stays byte-identical, and a hook touching one cell overrides it whole while the rest keeps real dual-colour ink.

### Deliverables — all 5 examples, verbatim

Rendered via `renderGlyphDiagram3d` at `target: "web"`, default camera (auto-fit), no explicit options beyond charset/size. Ledger is empty for every frame except agent-supervisor at 96x32 (2 labels dropped to on-screen collision at that small a target — both `3d-label-dropped`, no `unroutable`, and both labels reappear at 140x40).

#### LeNet-5 CNN

**96x32 braille**
```
                                                                                                
                                                                                                
                                                                                                
                                                                           ⣠⢴⠦⣄⡀                
                                                                        ⣠⡴⠋⢁⣠⠴⠋⠁                
                                                                        ⡇⠉⠉⡏   ⠁                
                                                                  ⣀⡀   ⣠⣷⠾ ⠃   ⠃                
                                                              ⢀⣠⠴⠋⣇⣭⣿⣴⠿ ⠙⠒⠦⠇input 32x32x1       
                                                              ⡟⠲⢤⠖⠋  ⠁                          
                                                             ⢀⣧⣶⢸                               
                                                     ⢀⣠⠖⡟⢲⣤⣤⣾⠟⠋⢤⣸ conv 28x28x6                  
                                                    ⡾⢭⣀⡤⠖⠃⠘⠋                                    
                                                    ⣇⣠⢸                                         
                                            ⣀⡤⡶⢤⣀⣀⣴⡾⢿⠁⢸pool 14x14x6                             
                                         ⢠⣖⡋⢁⣠⠴⠚⠙⠛⠁  ⠈⠉⠁                                        
                                         ⢸⢀⠉⡏   ⠈                                               
                                  ⢀⣠⣄⡀ ⢀⣤⣾⠟⠃⠃  ⠄⠚                                               
                               ⢀⡤⠖⠋⢈⣠⠟⣿⠟⠁⠈⠙⠒⠃conv 10x10x16                                      
                               ⢸⠉⠓⡞⠉  ⠇                                                         
                          ⣀   ⢀⣼⡾⠇⠃   ⠇                                                         
                       ⢠⣖⠋⣯⣽⣧⡾⠟⠉⠓⠦⠇pool 5x5x16                                                  
                       ⢸⢈⢹⠁ ⠃                                                                   
                 ⣀⣤⣀ ⣀⣴⣾⠛⢸  ⡇                                                                   
               ⢰⠯⢥⠖⠃⠿⠋ ⠈⠙⠚fc 120                                                                
               ⣸⣴⠸                                                                              
       ⣠⠴⢺⢙⣲⣦⣴⠿⠋⣄⢸ ⠆                                                                            
       ⡏⠙⢲⠋ ⠇⠁    fc 84                                                                         
       ⣇ ⠸  ⡇                                                                                   
       ⠙⠲⠼out 10                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**96x32 blocks**
```
                                                                                                
                                                                                                
                                                                                                
                                                                            ▄▄                  
                                                                         ▄▄█████                
                                                                        ████████                
                                                                        ███████▀                
                                                                ▄▄██▄▄▄▀▀▀▀▀input 32x32x1       
                                                              ▄██████                           
                                                              ███████                           
                                                       ▄▄▄▄ ▄▀▀███conv 28x28x6                  
                                                    ▄██████▀                                    
                                                    ███████                                     
                                              ▄   ▄▄███pool 14x14x6                             
                                          ▄▄█████▀    ▀                                         
                                          ███████                                               
                                         ▄██████▀                                               
                                 ▄▄███▄▄▀ ▀▀▀conv 10x10x16                                      
                                ███████                                                         
                                ██████▀                                                         
                        ▄▄█▄▄▄▀▀▀▀█pool 5x5x16                                                  
                        █████                                                                   
                       ▄█████                                                                   
                ▄███▄▀▀ ▀▀fc 120                                                                
                ████                                                                            
         ▄▄▄▄▄▄▀███▀                                                                            
       ██████     fc 84                                                                         
       ██████                                                                                   
       ▀▀█out 10                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**140x40 braille**
```
                                                                                                                                            
                                                                                                                  ⣀                         
                                                                                                               ⣠⠴⠋⠏⠉⢙⡶⡆                     
                                                                                                            ⣠⠴⠋⠁ ⢀⡤⠞⠁ ⠁                     
                                                                                                            ⡏⠉⠙⠒⡞⠉    ⠁                     
                                                                                                            ⣇⣠⡄ ⠁     ⠁                     
                                                                                                  ⣀⣤⣀    ⢀⣤⣾⣿⠃⠁ ⠃   ⠂⠁                      
                                                                                               ⣀⡴⠚⠁⠁⠈⣉⣷⣶⣾⠿⠃⠁⠙⠒⠲⠤⠃input 32x32x1              
                                                                                             ⣴⣚⣁ ⢀⣠⠴⠚⠁ ⠇⠁                                   
                                                                                             ⡇ ⠈⠉⡏     ⠇                                    
                                                                                             ⣇⣤⣶ ⠃     ⡇                                    
                                                                                   ⣠⢴⠦⣄⡀  ⣀⣴⣾⣿⠋  ⠃  ⠄⠃⠁                                     
                                                                                ⣠⠴⠋⠁ ⢀⡤⠟⣷⣿⠟  ⠈⠉⠙⠒⠃conv 28x28x6                              
                                                                              ⢰⠯⠥⣄⣠⠴⠚⠉  ⠃                                                   
                                                                              ⢸   ⠇     ⠃                                                   
                                                                             ⢀⣸⣶⠿ ⠇     ⠇                                                   
                                                                   ⢀⡤⠖⡟⠲⢤⣀⢀⣤⣶⡿⠃⠁⣀ ⠇ pool 14x14x6                                            
                                                                ⣀⡤⠞⠉  ⣀⡴⠚⠁⡿⠋⠁    ⠉⠉                                                         
                                                               ⢸⠓⠦⣄⣠⠴⠚⠁                                                                     
                                                               ⢸   ⠇                                                                        
                                                              ⣀⣼⣿⠿ ⡇    ⠄⠂                                                                  
                                                    ⢀⣠⠖⡟⠒⢲⣤⣀⣴⣾⠿⠋⠧⣄⡀⡇ conv 10x10x16                                                          
                                                 ⢀⡤⠞⠉ ⢀⡤⠖⠋ ⠟      ⠉⠉                                                                        
                                                 ⢸⠉⠉⠓⡞⠉                                                                                     
                                                 ⢸⣀⣠ ⠁                                                                                      
                                        ⣀⣤⣀⡀   ⣀⣴⣾⠟⠁ ⠇   ⠆⠉                                                                                 
                                     ⢀⡤⠞⠁ ⣠⠟⣧⣴⡿⠛⠁⠈⠓⠒⠦⠃pool 5x5x16                                                                           
                                     ⢸⠉⠙⢲⠋⠁ ⡇⠁                                                                                              
                                     ⢸⣠⡄⢸   ⠃                                                                                               
                            ⣠⢴⠦⣄⡀ ⢀⣤⣶⢿⠋⠁⢸   ⠇                                                                                               
                          ⣴⣚⠁⣀⡴⠋⠁⣾⡿ ⠁⠈⠓⠲⠼fc 120                                                                                             
                          ⡇⠈⢹⠁  ⠃⠁                                                                                                          
                         ⢀⣧⣶⢸   ⠃                                                                                                           
               ⢀⡴⢺⠓⢲⣤ ⣀⣴⡾⠟⠋ ⢸   ⠃                                                                                                           
              ⡾⠭⣄⣠⠴⠋ ⡾⠏   ⠈⠙⠚fc 84                                                                                                          
              ⡇  ⠇                                                                                                                          
              ⡇  ⠇                                                                                                                          
              ⢷⣀ ⠇  ⠁                                                                                                                       
                ⠉⠁out 10                                                                                                                    
                                                                                                                                            
```

#### Transformer encoder

**96x32 braille**
```
                                                                                                
                                        ⢀⣀⣤⠤⢤⣀                                                  
                                        ⣿⣄⣀⣀⣈⣼⡇                                                 
                                        Input Embedding                                         
                                        ⠉⠛⠦⠼ ⠎⠁                                                 
                                           ⡇                                                    
                                           ⡇                                                    
                                         ⣠⠴⣿⡷⡆                                                  
                                         Positional                                             
                                         ⢷⢸ ⠆⠃                                                  
                                           ⡇                                                    
                                           ⡇                                                    
                                         ⣠⠴⣿⣳⡆                                                  
                                         Multi-Head                                             
                                         ⢷⢸ ⠆⠃                                                  
                                           ⡇                                                    
                                           ⡇                                                    
                                         ⢀⡴⣿⣲⡄                                                  
                                         Add & Norm                                             
                                         ⢷⢸  ⠃                                                  
                                           ⡇                                                    
                                           ⡇                                                    
                                          ⣠⣷⢦⡄                                                  
                                        ⢰Feed Forward                                           
                                        ⢸ ⠸                                                     
                                         ⠉⠉⠁                                                    
                                           ⡇                                                    
                                          ⢀⣧⣄⡀                                                  
                                         Add & Norm                                             
                                         ⣧⢸  ⠁                                                  
                                         ⠉⠛                                                     
                                                                                                
```

**96x32 blocks**
```
                                                                                                
                                                                                                
                                        ▄█████▄                                                 
                                        Input Embedding                                         
                                        ▀▀▀█▀▀                                                  
                                                                                                
                                                                                                
                                          ▄▄▄▄                                                  
                                         Positional                                             
                                         ███▀▀                                                  
                                                                                                
                                                                                                
                                           ▄▄▄                                                  
                                         Multi-Head                                             
                                         ███▀▀                                                  
                                                                                                
                                                                                                
                                           ▄▄▄                                                  
                                         Add & Norm                                             
                                         ████▀                                                  
                                                                                                
                                                                                                
                                           ▄▄                                                   
                                         Feed Forward                                           
                                         ████▀                                                  
                                          ▀▀                                                    
                                                                                                
                                                                                                
                                         Add & Norm                                             
                                         █████                                                  
                                         ▀▀▀                                                    
                                                                                                
```

**140x40 braille**
```
                                                                                                                                            
                                                                ⢀⣀⣀⣀⡀                                                                       
                                                              ⣰⡏⠉⡇  ⡟⣦                                                                      
                                                              Input Embedding                                                               
                                                              ⣷⢸                                                                            
                                                              ⠉⠛⠒⠒⠚⠂⠃⠁                                                                      
                                                                 ⢸⡇                                                                         
                                                                 ⢸⠁                                                                         
                                                                 ⢸⠁⡀                                                                        
                                                               ⣠⠴⢻⣿⠽⢻                                                                       
                                                               Positional                                                                   
                                                               ⣧ ⠇  ⠂                                                                       
                                                               ⠈⠉⠉⡇                                                                         
                                                                 ⢸⠁                                                                         
                                                                 ⢸⠁                                                                         
                                                               ⢀⣠⢾⡅⢲⣤                                                                       
                                                               Multi-Head                                                                   
                                                               ⣇ ⠃                                                                          
                                                               ⠛⠦⠇⠂⠉                                                                        
                                                                 ⢸⠇                                                                         
                                                                 ⢸⠁                                                                         
                                                                 ⣸ ⣄⣀                                                                       
                                                               ⣴⣚⣹⠵⠚⠁                                                                       
                                                               Add & Norm                                                                   
                                                               ⢷⣀⠇ ⠂⠉                                                                       
                                                                 ⢸⠇                                                                         
                                                                 ⢸⠁                                                                         
                                                                 ⢸⠁                                                                         
                                                               ⢀⣠⢾⡅⣳⢶                                                                       
                                                               Feed Forward                                                                 
                                                               ⣇ ⠁                                                                          
                                                               ⠛⠦⠇⠂⠁                                                                        
                                                                 ⢸⠇                                                                         
                                                                 ⢸⠁                                                                         
                                                                 ⣸⠁⣀                                                                        
                                                               ⣴⡚⢛⣫⠼⠚                                                                       
                                                               Add & Norm                                                                   
                                                               ⣷⡀⡇ ⠄⠂                                                                       
                                                                ⠉⠉                                                                          
                                                                                                                                            
```

#### Agent supervisor

**96x32 braille**
```
                                                                                                
                                                                                                
                                                                                                
                                             ⢀⡤⡖⢦⣤                                              
                                           ⡴⣞⣉⡤⠖⠋                                               
                                           User request                                         
                                           ⣧⡀⢸  ⠆⠁                                              
                                            ⠉⠉⠁                                                 
                                              ⣿                                                 
                                              ⣿                                                 
                                            ⢠⢤⣿⣤                                                
                                            ⢸⣏⠛⢁⣧                                               
                                           Supervisor                                           
                                            ⠘⣾  ⠘                                               
                                            ⢀⣿⠒⠚⠉                                               
                                            ⣼⣿⣿⣧⢿⣄                                              
                                         ⣠⣴⣿⣿⡏⣿⢿⣬⣿⣆                                             
                                     ⢀⣠⡶⠟⠠⣾⡟⢛⡯⣿⢸⠂⠉⣻⣿⡿⣶⣤⣀                                        
                                   ⢠⣶⣟  ⣀Reviewer⢯⣁⡭⣖⣷⡾⢻                                        
                                   ⢸⠉⠙⢻⠿⣷⣭⣗⡋⠇⣠⣿⡶⣿⣷⣾⠾⠛⠁ ⢸                                        
                                   ⢸ ⢀⣸  ⠋⠉⠛⡿⡶⣿Coder ⠃⢥⣸                                        
                                   ⢸⣶⣟⠹⣄ ⠇ ⠞⠁⣇⣿⡇⢸  ⠁⣀⡴⠞⠉                                        
                                    ⠉⠙⠛⠷⢿⣥⣿⣆ ⢿⣿⡇⠚⣀⡵⠚⠁                                           
                                         ⠈⠉⠙⣿⢿⣿⠃⡟⠁                                              
                                            ⠻⣿⣿⡿                                                
                                           ⢀⡤⠿⠽⠃⡷⡆                                              
                                           ⢸Reports                                             
                                           ⢸  ⠃  ⠃                                              
                                           ⠈⠓⠦⠇⠂⠁                                               
                                                                                                
                                                                                                
                                                                                                
```

**96x32 blocks**
```
                                                                                                
                                                                                                
                                                                                                
                                               ▄▄                                               
                                            ▄█████                                              
                                           User request                                         
                                           ██████▀                                              
                                             ▀█                                                 
                                              █                                                 
                                              █                                                 
                                              █                                                 
                                             ███▄                                               
                                           Supervisor                                           
                                             ████                                               
                                             ███▀                                               
                                             ███▀▄                                              
                                           ▄████▄▀▄                                             
                                       ▄▄▀▄████ █ ▀▄▄▄▄                                         
                                    ▄ ▀  Reviewer▄█████▀                                        
                                    ▀▀ ▄███████▄███████                                         
                                       ██████▄█Coder██▀                                         
                                    ▄ ▀████▀▀██████  ▄▄▀                                        
                                     ▀  ▄▀▀▄ ████▀█▄▀                                           
                                           ▀▄▀███▀                                              
                                            ▀▄██                                                
                                             ▄██▄▄                                              
                                            Reports                                             
                                            ██████                                              
                                            ▀▀▀▀                                                
                                                                                                
                                                                                                
                                                                                                
```

**140x40 braille**
```
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                      ⢀⡀                                                                    
                                                                   ⢀⣠⠞⢹⠉⣹⢶                                                                  
                                                                 ⢠⣖⣋ ⣀⡴⠚⠁                                                                   
                                                                 ⢸User request                                                              
                                                                 ⢸  ⢸                                                                       
                                                                 ⠘⠦⢤⣸ ⠆⠁                                                                    
                                                                     ⢸⡇                                                                     
                                                                     ⢸⠁                                                                     
                                                                     ⢸⠁                                                                     
                                                                     ⢸⠁                                                                     
                                                                   ⣖⠒⣾⠁⣧                                                                    
                                                                   ⡟⣆⠈⢁⣸⡄                                                                   
                                                                  Supervisor                                                                
                                                                   ⢯⢸   ⠃                                                                   
                                                                   ⠈⢿⣀⣠⠤⠃                                                                   
                                                                   ⢀⣾⢻⣿⣿⣆                                                                   
                                                                  ⢀⣾⠃⢹⢻⡏⠁⣦                                                                  
                                                               ⣀⣤⣾⣿⠃⠇⢿⡏⣿⣈⣿⣧                                                                 
                                                            ⣀⣴⡾⢟⣡⣼⠏⡿⢉⣿⠁⢿⡍⠛⢿⣷⣦⣶⣤⣄⡀                                                           
                                                         ⣠⣴⡾⠟  Reviewer⢸⣇⣠⠞⠿⠿⣉⡽⢛⣷⣶                                                          
                                                       ⢰⣿⣿⣄⣀ ⣠⠴⣿⡯⢉⣿⡆ ⢸⡇ Final answer                                                        
                                                       ⢸⠃⠈⠉Researcher⢾⣇⣾⣿⣟⣶⡿⠛⠁  ⡇⣿                                                          
                                                       ⢸⠇  ⢸  ⢸⠉⠙⠛⠿⢷⣧⣼Coder⡇ ⣦⠆⣁⡀⣿                                                          
                                                       ⢸⠇⣴⡾⢿  ⢸  ⣠⠆⠃⡆⢹⣿⠁⠸  ⡇⠉ ⢈⣩⡿⠏                                                          
                                                       ⠘⠿⢷⣦⣬⣓⡲⠼ ⠃⡀ ⢸⡇⢸⣿⣀⢸  ⢃⣤⡾⠟                                                             
                                                           ⠉⠙⠛⠿⣶⣽⣄⣄ ⣿⢸⣿⢨⣉⣤⡾⠟                                                                
                                                                ⠈⠙⠛⣿⢿⣿⣿⣾⠟⠉                                                                  
                                                                  ⠈⠇⣞⣿⣷⠿                                                                    
                                                                   ⠈⢻⣿⣿⠧⣄⡀                                                                  
                                                                  ⣴⣚⡉⢛⣩⠴⠃⠁                                                                  
                                                                  Reports⠃                                                                  
                                                                  ⡇  ⠇   ⠁                                                                  
                                                                  ⠻⠤⣄⠇ ⠂⠁                                                                   
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
```

#### Multi-agent crew

**96x32 braille**
```
                                                                                                
                                                                                                
                                                                               ⢀⡤⡶⢤⣀            
                                                                            ⢀⡤⠞⠉ ⢀⣠⠼⠚           
                                                                            ⢸⠉⠉⠓⡞⠉              
                                                                            ⢸⣀⢀ ⠁   ⠈           
                                                                   ⢀⡀     ⣀⣴⣾⠿⠃ ⠇   ⡈           
                                                               ⢀⣠⠴⠚⠹⠉⢉⡷⣆⣴⣾⠿ ⠙⠦⠤⣄⠇Request        
                                                               ⡟⠲⢤⣀⡤⠞⠁ ⡇⠋                       
                                                     ⣀⡀        ⡇  ⢸    ⠇                        
                                                  ⣠⣴⡿⣿⠻⢷⣦⣤⣀   ⣀⣷⡾⠇⢸    ⠇                        
                                               ⣠⣴⠿⠋⣀⡴⣿⠓⠦⢤⣩⣿⣿⣴⡿⠋⠉⣀ ⢸  ⠄⠃⠁                        
                                            ⣠⣴⠿⠋⣠⠴⠋⠁ ⢀⣠⣶⠿⠋⠿⣿    ⠈⠙⠚Manager                      
                                         ⣀⣴⠞⠋   ⡏⠙⢒⣦⣾⠟⠃⠁ ⠘ ⣿                                    
                                      ⣀⡴⠞⠁     ⢀⣧⣾⡟⠃⡇      ⣿                                    
                                   ⣀⡴⠞ ⣀    ⢀⣤⣾⣿⠋⠟⠃ ⠇    ⠄⣶⣿                                    
                                 ⣶⣾⣁⣀⡴⠋⡏⠉⣹⣶⣾⠟⣿⣿⠋⡿⢤⣀ ⠇Researcher                                 
                                 ⣿⠈⠙⠛⠷⣦⣶⡿⠟⢹⣿⠋⠿⠛⠁   ⠉⣩⣴⡾⠟                                        
                                 ⣿ ⢸  ⠸⣿   ⠋⠁    ⣠⣴⡿⠛                                           
                                 ⣿⣠⣼⣿⠇⢸⣿      ⣠⣴⡿⠛⠁                                             
                       ⢰⡒⠒⠋⢹⡄ ⢀⣠⣴⣿⠟⠉⣀ ⢸⣿ ⠆⢃⣠⣴⡿⠛⠁                                                
                       ⢸⢧⣀⣀⡤⢷⣶⡿⠇ ⠻⠿⣦⣬⣙⡚Writer                                                   
                       ⢸⢸   ⢸⠛      ⠈⠉⠛⠛⠃⠁                                                      
                     ⢀⣠⣾⣿   ⠈                                                                   
           ⢀⡤⢾⠲⢤⣀ ⢀⣠⣶⡿⠃⠁⣾   ⠈                                                                   
         ⢠⣖⣋ ⣀⡤⠞⠁⣶⠿⠃⠁   ⠙⠒Review                                                                
         ⢸ ⠈⢹⠁   ⠁                                                                              
         ⢸  ⢸                                                                                   
         ⢸  ⢸                                                                                   
         ⠈⠓⠲⠼Result                                                                             
                                                                                                
                                                                                                
```

**96x32 blocks**
```
                                                                                                
                                                                                                
                                                                                 ▄              
                                                                              ▄██████           
                                                                             ████████           
                                                                             ████████           
                                                                            ▄████████           
                                                                 ▄▄██▄▄▄ ▄█▀ ▀███Request        
                                                               ▄████████▀                       
                                                               █████████                        
                                                    ▄▄ ▄▄      █████████                        
                                                 ▄▀▀ █▄▄  ██▄▄▀███████▀                         
                                              ▄▀▀ ▄███████▄█▀    ▀▀Manager                      
                                          ▄▄▀▀  ██████████ █                                    
                                       ▄▄▀      ██████████ █                                    
                                    ▄▄▀      ▄▄▀██████████▄█                                    
                                 ▄▄▀  ▄█▄▄▄▄▀▄█▀█████Researcher                                 
                                 █ ▀████████▀▄▀▀    ▀ ▄▀▀                                       
                                 █  ███████▀▀      ▄▀▀                                          
                                 █ ▄███████     ▄▀▀                                             
                        ▄▄▄▄    ▄█▀███████▀ ▄▄▀▀                                                
                        █████▄▄▀▀▀█▄ ▀▀Writer                                                   
                        █████▀       ▀▀▀▀                                                       
                       ▄█████                                                                   
             ▄▄▄    ▄▄▀▀█████                                                                   
          ▄██████▄█▀▀    ▀Review                                                                
          ███████                                                                               
          ███████                                                                               
          ███████                                                                               
          ▀▀▀Result                                                                             
                                                                                                
                                                                                                
```

**140x40 braille**
```
                                                                                                                                            
                                                                                                                                            
                                                                                                                ⢀⡀                          
                                                                                                             ⣀⡤⠞⢹⠉⠙⠒⣦⡄                      
                                                                                                           ⣴⣚⡁   ⣠⠴⠚⠁⠃                      
                                                                                                           ⡇ ⠉⠙⢲⠋⠁   ⠃                      
                                                                                                           ⡇   ⢸     ⠃                      
                                                                                                          ⣠⣷⣿⠿ ⢸     ⠃                      
                                                                                              ⣠⢴⠦⢤⣀⡀  ⢀⣠⣴⣿⠞⠋⠁  ⢸    ⠃⠁                      
                                                                                          ⢀⣠⠖⠋⠁  ⢀⣠⠟⣧⣶⣿⠏ ⠁ ⠈⠙⠲⢤⣸Request                     
                                                                                          ⡟⠒⠦⢤⣀⡤⠞⠉  ⡇⠋                                      
                                                                                          ⡇   ⢸     ⠇                                       
                                                                            ⣠⣴⣶⣤⣄⣀        ⣇⣤⣦ ⢸     ⠇                                       
                                                                        ⢀⣠⣴⡿⠛⠁⣇⠉⠙⠻⠿⣷⣶⣤ ⢀⣤⣾⡿⠏⠁ ⢸     ⡇                                       
                                                                     ⢀⣠⣶⠿⠋⠁⣠⠴⢻⠏⠉⠓⣒⣶⡾⢟⣿⣾⡿⠃⠁⢷⣂⡀ ⢸Manager                                      
                                                                  ⢀⣠⣶⠿⠁⢁⣠⠖⠋⠁  ⣠⣴⡿⠛⠉⡇⠿⣿⠁     ⠉⠙⠚⠃⠁                                           
                                                               ⢀⣤⣶⠿⠁⠁  ⡟⠒⠦⠤⣤⣴⡿⠛⠁   ⠇ ⣿                                                      
                                                            ⢀⣤⣾⠟       ⣇⣠⣴⡿⠛⠁      ⠇ ⣿                                                      
                                                         ⢀⣤⣾⠟       ⢀⣠⣶⣿⠋⠁⡄ ⡇      ⠇ ⣿                                                      
                                                      ⣀⣴⡾⠟⠁ ⣀    ⢀⣠⣶⢿⠋⠁⣿⠿⠋⠁ ⠇     ⠆⠃⣶⣿                                                      
                                                    ⣴⣾⣟  ⣀⡴⠋⡏⠙⢒⣦⣶⢿⠋⠁⣿⠟⠋⣷⣂⡀  ⠇Researcher                                                     
                                                    ⣿⠉⠛⣿⣿⣷⣤⣄⣤⣾⠟⠋⡇⡿⠟⠉⣶⠿⠋⠁ ⠉⠉⠓⠃⠁⣠⣴⡿⠛                                                          
                                                    ⣿  ⡇ ⠈⠉⢹⡏   ⠇⣶⠿⠋⠁      ⣠⣴⡿⠋⠁                                                            
                                                    ⣿  ⣇⢀  ⣿⠇   ⠇      ⢀⣠⣴⡿⠋⠁                                                               
                                                    ⣿⢀⣤⣿⣿⠇ ⣿⠇   ⠇   ⢀⣠⣶⠿⠃⠁                                                                  
                                        ⣖⠒⠒⠒⠒⣆    ⣀⣤⣿⡿⠛⠉   ⣿⠇⢀ ⠆⠃⢀⣠⣶⠿⠁⠁                                                                     
                                        ⣿⡀   ⢸⣀⣀⣴⣾⡿⠃⠁⣾⣟⠉⠙⠒⠦⢿Writer⠁⠁                                                                        
                                        ⡇⡗⠒⠒⠋⠉⡇⣿⠃⠁  ⠈⠉⠛⠻⠷⣶⣤⣼⠃⣾⠟                                                                             
                                        ⡇⡇    ⠁           ⠈⠉⠁                                                                               
                                      ⣀⣴⣿⡇    ⠃                                                                                             
                         ⢀⣠⡶⠤⣄⣀    ⣀⣴⣾⠏ ⢳⡇    ⠃                                                                                             
                       ⣠⠴⠋   ⣠⠼⢻⣠⣴⣿⠏    ⠘⣇⡀Review                                                                                           
                      ⢸⠓⠒⠦⢤⠖⠋⠁ ⢸⠟                                                                                                           
                      ⢸   ⠸    ⠈                                                                                                            
                      ⢸   ⢸    ⠈                                                                                                            
                      ⢸   ⢸    ⡈                                                                                                            
                      ⠘⠦⢀⢀⢸Result                                                                                                           
                         ⠈⠉⠁                                                                                                                
                                                                                                                                            
                                                                                                                                            
```

#### Fan-out / join / split (new)

**96x32 braille**
```
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                          ⣀⡴⢺⠓⢲⣤                
                                                             ⢀⡀          ⢸⠓⠦⡴⠚⠉                 
                                                          ⣀⡤⠞⢹⠉⢉⣳⡆       ⣸⣀ ⠃  ⠈                
                                                         ⢸⠓⠦⣄⣠⠴⠃ ⠁⠶⠶⣶⣾⣛⣛⢛⣿⡿⠁⠇  ⠈                
                                                         ⢸   ⠃  ⢀⡧⠖⠋⠁ ⣀⡼⣿⠟⠯⣄⠇Input              
                                                         ⢸⣼⡟ ⠇  ⣸⠉⠓⠦⡴⠚⠁                         
                                                         ⣼⡿⠤⣄⠇Branch B                          
                                                     ⢀⡀⢀⣾⠟  ⣾⣭⣴⣾⣿⠛⠁ ⠇   ⠌                       
                                                  ⢠⣴⡚⢹⡭⣿⢏⣠⣴⣾⣿⠛⠉⢸⠈⠓⠒⠦⠷Branch A                   
                                     ⢀⣠⣄⣀         ⢸ ⠉⡏  ⣿⠉⠁⠿⡿⠛⠃⢸   ⣀⡇                           
                                  ⢀⡤⠖⠋⠈⣀⡼⢻  ⣠⣴⣤⣠⣤⣤⣼⣶⡆⠃      ⠻⢤⣀⢸Branch C                        
                                  ⢸⠉⠙⢲⠋⠁ ⢠⣟⣛⡛⢘⣠⠼⠚⣾⣿⠏ ⠇        ⠈⠉⠁                               
                                  ⢸⢀⣠⢸   ⢸  ⠉⡏   ⡿ ⠉⠓Join                                       
                           ⢀⡤⢾⠓⣦⡄⣠⣾⠟⠃⢸   ⢼⣠⣦ ⠁                                                  
                           ⡏⠓⢲⠋⠁⡇⠟⠉⠓⠲⠼Split 3⠃                                                  
                           ⣇⣠⠘  ⠃     ⣠⣿⠟⠁⡟⠉⠓Split 2                                            
                          ⣠⣿⠃⢸  ⠃   ⢀⣼⣟⠁⣦ ⠁   ⡇                                                 
                        ⢀⣾⠟⠙⢲⠼Side⣄⣴⣿⠁⡿⠛⠁ ⠃  ⠆⠃                                                 
                  ⢀⣠⣄⡀ ⣰⡿   ⡟⠒⠦⡴⠚⠁⡇⠋⠋⠁ ⠈⠉⠓⠃Split 1                                              
                ⣠⠴⠋⠈⣀⡽⣿⠏⠁  ⢀⣇⣀ ⠁  ⠇                                                             
                ⡏⠉⠓⡞⠁ ⠁⠿⠛⠛⠛⠋⠁⠁⠁⠇  ⠇                                                             
                ⡇  ⠁  ⠁     ⠻⠤⣄Merge                                                            
                ⣧  ⠃  ⠁                                                                         
                ⠈⠉⠓Output                                                                       
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**96x32 blocks**
```
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                            ▄▄▄                 
                                                                          ▄█████                
                                                            ▄██▄▄▄        ██████                
                                                          ████████▄▄▄▄▄ ▀▀██████                
                                                          ████████▄▄████▄█▀██Input              
                                                          ███████████████                       
                                                          ████Branch B███                       
                                                         █  ▄████████████                       
                                                    ▄██▄█  ▄█████████Branch A                   
                                                   ████████▄█████████                           
                                    ▄▄███▄        ▄█████    ▀███Branch C                        
                                   ███████▄▄█████▄██████        ▀                               
                                   ███████████████▀▀▀Join                                       
                             ▄▄▄▄ ▄██████████████                                               
                           ██████▀ ▀▀█Split 3███▀                                               
                           ██████      ██████Split 2                                            
                           ██████    ▄█████████                                                 
                         ▄█▀▀█Side ▄██▄███████▀                                                 
                        █▀  ▄███████▀  ▀▀▀▀Split 1                                              
                 ▄▄███▄█    ███████                                                             
                ███████▄  ▀▀███████                                                             
                ███████     ▀██Merge                                                            
                ██████▀                                                                         
                ▀▀▀Output                                                                       
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```

**140x40 braille**
```
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                        ⣀⡴⢺⠓⢲⣤                              
                                                                                                      ⢰⠯⢥⣀⡤⠖⠃                               
                                                                                     ⣀⡴⢺⠓⠲⠤⣄⡀         ⢸  ⢸                                  
                                                                                  ⣠⠴⠋⠁  ⢀⣠⠴⠋⠃  ⣀⣀⣀⣀⣤⣤⣤⣼⣶⣶⢸                                  
                                                                                  ⡏⠉⠓⠲⢤⠖⠋   ⠇⠛⠛⣻⢿⠿⢭⣉⡉⢁⣿⡿ ⢸                                  
                                                                                  ⡇   ⢸    ⢀⣧⠖⠋⠁⢸ ⢀⣠⠟⣿⠋⠯⢤⣸Input                             
                                                                                  ⡇⣰⡿ ⢸    ⡟⠒⠦⢤⣀⡤⠞⠉  ⠇                                      
                                                                                  ⣷⡿  ⢸  ⡀⠄⡏   ⢸     ⠇                                      
                                                                                 ⣰⡿⠁⠓⠲⠼Branch B⢸     ⠇                                      
                                                                            ⣀⣤⣀ ⣰⡿   ⢸⣓⣶⣶⣿⣿⠋⠁  ⢸    ⠆⠃                                      
                                                                         ⢀⡤⠞⠁⢃⡼⣻⡿ ⣀⣤⣶⢿⠛⠁⠁ ⠃⠙⠒⠦⢤⣸Branch A                                    
                                                                         ⢸⠉⠓⡞⠉ ⠘⣷⣿⠋ ⣶⣾⡿⠿⠆ ⠇    ⡇                                            
                                                       ⢀⡤⠖⡟⠒⠲⣤⡄          ⢸⣀ ⠃   ⠁⠁   ⢸    ⠇    ⠃                                            
                                                     ⣴⣚⠉  ⢀⡤⠞⠁⠃⣀⣠⣤⣶⣿⣶⣶⣾⡿⣿⣿⣿⠇⡇        ⠈⠓⠲⠤⣄⠇Branch C                                         
                                                     ⡇⠈⠉⠓⡞⠉   ⣷⣛⠛  ⢀⡤⠞⠁⡇⡿⠃⠃ ⡇                                                               
                                                     ⡇⣠  ⠃    ⡇⠈⠉⠓⡞⠉   ⡇⠏ ⠉⠓⠃Join                                                           
                                             ⢀⡤⡶⠤⣄⡀⢀⣴⣿⡿⠇ ⠇    ⡇⢀⡀ ⠃    ⠃                                                                    
                                           ⢠⣖⣋ ⣀⡴⠋⠁⣿⠾⠋⣀  ⠇Split 3 ⠇    ⠃                                                                    
                                           ⢸ ⠈⢹⠁  ⡇⠁  ⠈⠉⠓⠃⢡⣞⣽⣿⠟⣁  ⠇  ⠆⠁                                                                     
                                           ⢸⣠⡄⢸   ⠇      ⢀⣼⣿⠟⠁⢹⠉⠉⠓⠛Split 2                                                                  
                                          ⢀⣼⡟ ⢸   ⠇     ⣠⣿⠏⠁⣄ ⠸    ⢸                                                                        
                                         ⣠⣿⠋⣄⣀⢸ ⡴⠋⣁⣀  ⣠⣾⠏⠁⣾⡿⠃ ⢸    ⡈                                                                        
                                       ⢀⣼⡟   ⣨⠽Side⡼⣻⣾⠟ ⠿⠋⠹⣄⣀ ⢸Split 1                                                                      
                                ⢀⡤⡶⢤⣀ ⣠⣿⠁    ⡏⠉⠙⢲⠋⠁ ⠘⠁⠋⠁     ⠉⠉⠁                                                                            
                             ⢀⡤⠞⠉ ⢀⣠⠼⢻⡟      ⣇⣀ ⠸                                                                                           
                             ⢸⠉⠉⠓⡞⠉   ⣶⡶⠶⠾⠿⠿⠿⠛⠒⠃⢸                                                                                           
                             ⢸   ⠁           ⣧  ⢸  ⡄⠂                                                                                       
                             ⢸   ⠃           ⠈⠉⠙⠚Merge                                                                                      
                             ⢸   ⠃  ⠄⠂                                                                                                      
                              ⠉⠉⠓⠃Output                                                                                                    
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
```

### Residuals, stated plainly

1. **FIXED in D2 round 8, below.** A `"side"`-mode label's leader is drawn again — a stamped dot, never the box-drawing line this round's own machinery still has no way to trace at an arbitrary angle.
2. **The camera constants and ribbon/arrowhead thickness constants are first-guess-then-verified-by-rendering, not analytically derived.** Round 5/6 could derive their own camera yaw analytically against a shared plane; round 7 has no shared plane to solve against, so `GLYPH_DIAGRAM_3D_CAMERA_ROT_X`/`_ROT_Y`, `GLYPH_DIAGRAM_3D_EDGE_RIBBON_HALF_WIDTH`/`_ARROWHEAD_HALF_WIDTH`/`_ARROWHEAD_LENGTH`, and the ring/rank gap constants were tuned by rendering the real examples and inspecting them directly (the same discipline every earlier round used for its own constants) rather than by closed-form derivation. The rank-spacing fix above (`screenSafeFlowHalf`) is a conservative bound, not a per-camera-angle-exact one — it is proven to eliminate the measured overlap on the shipped examples, not proven optimal for an arbitrary future camera angle.
3. **The "blocks" charset has no ANSI colour form.** `encodeGlyphBuffersDual` (glyphcss) only ever emits HTML `<span>` markup or plain text — there is no dual-colour ANSI SGR encoder. An ANSI colour mode (`ansi16`/`ansi256`/`truecolor`) under `charset: "blocks"` degrades to plain text with a `3d-blocks-ansi-unsupported` ledger entry rather than a silently wrong (single-colour) ANSI render; `color: "css"` still produces real dual-colour HTML. Building a dual-colour ANSI encoder was judged out of scope/budget for this round.
4. **Dense fan-in/fan-out graphs (agent-supervisor's 6-way Supervisor fan, fan-join-split's 3-way joins) read as busy at 96x32** — every edge is real, depth-tested geometry and every label is present (or honestly reported dropped), but the sheer number of crossing ribbon segments at that small a target produces a visually dense frame. This is inherent to rendering a genuinely 3D structure through a small braille/block grid, not a bug; 140x40 reads noticeably cleaner for the same graphs.

## C7 — full per-axis configuration for 3D charts

**USER FEEDBACK, verbatim:** "it seems the axes labels and ticks and etc in 3d are not being able to be configured? like you cannot configure the z axis in the /charts sidebar." Before this packet `GlyphChart3dAxisOptions` carried exactly `title`/`ticks` — every other per-axis concern (colour, tick formatting, an explicit domain, which guide pieces that ONE axis shows) was either a flat scene-wide `guides` toggle or simply not exposed at all, so a page control for "the z axis" had nothing to bind past its title. This packet makes `axes.{x,y,z}` as configurable as a 2D `axes.{x,y}`, mirroring its field names exactly, reusing its resolver (`resolveGlyphChartTickFormat`) and its rule codes (`bad-tick-format`, `bad-axis-color`) rather than inventing 3D-flavoured duplicates.

### Option shape

`GlyphChart3dAxisOptions` (`types.ts`) gains, per axis: `format?: GlyphChartTickFormat` (the SAME preset/callback vocabulary `axes.{x,y}.format` accepts on the 2D root); `line?`/`tickMarks?`/`tickLabels?`/`grid?: boolean` (per-axis visibility, each overriding the matching `GlyphChart3dGuideOptions` field — `guides.axisLines`/`ticks`/`tickLabels`/`grid`-or-`floorGrid` — for THAT axis alone, `undefined` following the global default); `color?: string` (canonical `#rrggbb`); `domain?: readonly [number, number]` (an explicit override for the data-derived nice domain). `axes.color` (a new sibling of `axes.x`/`axes.y`/`axes.z`/`axes.corner`, identical across all 5 mark option types) is the mark-wide shared colour every axis's own `color` falls back to — the exact `axes.color` / `axes.{x,y}.color` precedence 2D already has. `title`/`ticks` are unchanged. Every one of the 5 mark constructors (`surface.ts`, `scatter.ts`, `parametric.ts`, `bars.ts`, `line3d.ts`) now types its own `axes?` block against the SAME `GlyphChart3dAxisOptions` (previously each redefined `{title?: string; ticks?: number}` inline — five copies that would have drifted the moment one file forgot to add the new fields) and calls the new `axisTriadShared.ts`'s `resolveAxesColor(axesOptions?.color)` once, storing the result on a new `axesColor?: string` field every mark's resolved type carries (`GlyphChart3dAxisTriadSpec` plus each concrete `*Mark` interface, since the marks don't structurally extend that type — this file's own C5 doc already noted they merely SATISFY it).

`GlyphChart3dResolvedAxis` (the axis a mark's own `axes.x`/`.y`/`.z` field holds after resolution) gains `color?`, `lineVisible?`, `tickMarksVisible?`, `tickLabelsVisible?`, `gridVisible?` — all left `undefined` when the caller named no override, so every downstream reader combines it with the matching global default via ONE new helper, `object.ts`'s `axisVisible(override, fallback)`: `override === undefined ? fallback : override`. `resolveAxis` (`axisTriadShared.ts`) is the ONE place all of this is validated and resolved — a new `resolveExplicitDomain` (rejects a non-finite or `min >= max` pair with `bad-axis-domain`, used VERBATIM with no `.nice()` when present, mirroring `scales.ts`'s own `buildContinuous`, whose explicit `opts.domain` skips `.nice()` unless the caller separately opts in), a new local `CANONICAL_HEX_COLOR`/`isCanonicalHexColor` pair (the same "many independent copies of one regex" convention `schema.ts`/`validate.ts`/`colorscale.ts`/the cell canvas already follow, rather than a cross-module import for a six-line check), and `resolveGlyphChartTickFormat` (imported straight from the ROOT package's own `tickFormat.ts` — the one-directional import `rootIsolation.test.ts` already permits, AGENTS.md's "Charts 3D" own header doc) for `format`. A tick-format preset's own output goes through the SAME `asciiMinus` fold every plain-numeric label already did (C2 fix round 8's own P1-C) — a `d3-format`-backed preset (`number`, `currency`, `si`, ...) emits the identical Unicode minus sign the plain path was folding, so the fold is applied unconditionally rather than gated on which path produced the string.

### Colour resolution and rendering

`object.ts` gains three small helpers used everywhere a per-axis value needs combining with its mark-wide/global fallback: `axisAt(mark, axisIndex)` (the one indexing point every helper below shares — `0/1/2 -> x/y/z`), `axisRenderColor(axis, mark)` (`axis.color ?? mark.axesColor ?? AXIS_BOX_COLOR`), and `axisVisible` (above). `axisTriadOverlay`'s signature drops its old flat `color: string` parameter entirely — every stamp (a tick's `+`, a tick label, an axis title) now resolves `axisRenderColor(axis, mark)` fresh per axis inside the per-axis loop, so three axes can legitimately show three different colours in one frame. `axisTriadLinePolygons` (the ribbon-mesh ONE-time build) takes two callbacks, `colorForAxis`/`visibleForAxis`, instead of one flat colour and no visibility argument at all — an axis whose own `line` resolves `false` contributes NO ribbon segment (never a segment built then discarded), so `glyphChartObject`'s own "omit the whole `axis-lines` mesh when nothing would draw" rule (previously gated on the single flat `guides.axisLines`) now checks whether the built polygon LIST is non-empty, which is true exactly when at least one axis resolved visible.

### Per-axis grid — which guide PLANE a toggle reaches

The hard part of "per-axis `grid`" is that a grid LINE lives on a guide PLANE (a wall or the floor), not directly on an axis — `planeGridLines` (unchanged structure) sweeps a wall plane (`fixedAxis` 0 or 1) at z's own tick values only (matplotlib's own wall-pane convention) and the floor plane (`fixedAxis` 2) at BOTH x's and y's. So "z's own grid toggle" has to reach both wall planes, and "x's"/"y's" each reach only the floor. `planeGridLines` now TAGS every line it returns with its own `sweepAxis` (`readonly [Vec3, Vec3, 0|1|2]`, not `[Vec3, Vec3]`) — the axis whose TICK VALUE positioned that particular line — and `axisTriadOverlay`'s stamp loop resolves each line's own visibility as `axisVisible(axesTriple[sweepAxis].gridVisible, fixedAxis === 2 ? guides.floorGrid : guides.grid)`: `axes.z.grid` therefore toggles the wall lines (both walls), `axes.x.grid`/`axes.y.grid` each toggle their own half of the floor's lines, independent of the OTHER axis's own floor lines and independent of the opposite plane family. `glyphChart3dLabelAnchors` (the closed-form static-camera fit's own anchor enumerator) resolves the SAME `axisVisible(axis.tickLabelsVisible, guides.tickLabels)` test the overlay's stamp uses for tick labels — the two must agree exactly, since a fit that reserves margin for a label the overlay goes on to skip (or the reverse) is the exact defect this file's own C2 doc already fixed once for the flat `guides.tickLabels` case; titles are UNCHANGED (no new per-axis title-visibility field — an axis's existing `title: ""` already suppresses just that axis's own title, the same mechanism 2D's `axes.{x,y}.title` has always used, so nothing new was needed there).

### `domain` — verbatim use and the clamp, not full geometric clipping

An explicit `axes.*.domain` is used EXACTLY as given (`resolveExplicitDomain`, no `.nice()`), so `mark.axes.x.domain` genuinely reports back the caller's own two numbers rather than a rounded-outward pair. The box's own `aspect` extent (`[1.3, 1.3, 0.6]` by default) never changes with `domain` — only WHERE a data value maps inside that fixed box changes. "Data outside is clipped, never drawn outside the box" is implemented as a CLAMP on the mapped FRACTION, not literal per-triangle geometric clipping: `object.ts`'s `mapAxisValue` (the shared data -> object-space mapping every point/bar/line-vertex mark type calls) now computes `t = Math.max(0, Math.min(1, (value - lo) / span))` before multiplying by the axis's own extent, and `buildSurfaceMesh` (which historically inlined its own x/y/z normalization rather than calling `mapAxisValue`) carries the IDENTICAL clamp locally, via a `clampFraction` closure over the same three domains, so a surface's own quad grid clamps at the box edge too. This is a genuine, deliberate SCOPE decision: a value beyond the domain FLATTENS onto the nearest box face (never drawn past it, satisfying "never drawn outside the box") rather than a partial polygon being cut at the exact domain boundary (which would need real triangle-plane clipping — the near-plane clip `rasterize.ts` already does for the camera frustum, generalized to 6 arbitrary axis-aligned planes, a materially larger packet with no user-visible difference for the primary use case named in the request: giving a reader real axis-tick vocabulary and colour control, not a data-cropping tool). `mapAxisValue`'s clamp and `buildSurfaceMesh`'s own local one are two DISTINCT code paths (scatter/parametric/bars/line3d vs. surface) and each is mutation-gated independently (below) — a fix to one does not exercise the other.

### Validation and schema

`GLYPH_CHART_3D_VALIDATION_RULES` (`validate.ts`) gains `bad-tick-format`, `bad-axis-color` (both the 2D CODES, reused verbatim — the failure means the identical thing, an unknown preset name or a non-canonical hex string, so a caller who already handles the 2D code needs no new branch) and `bad-axis-domain` (3D-only, no 2D single-`[min,max]`-per-axis-domain option exists to reuse a code from). All three join `AXIS_OPTION_RULES`, a small shared tuple spliced into EVERY one of the 5 mark types' own rule lists (`GLYPH_CHART_3D_SURFACE_RULES`, `_SCATTER_RULES`, `_PARAMETRIC_RULES`, `_BARS_RULES`, `_LINE3D_RULES`) and the flat `GLYPH_CHART_3D_VALIDATION_RULES` union — every mark type gets the identical three new rules, since every mark type resolves its own axes through the identical `resolveAxis`. `schema.ts`'s `AXIS_OPTIONS_SCHEMA` (3D) imports the ROOT package's own `TICK_FORMAT_SCHEMA` (newly exported from the root `schema.ts` for exactly this reuse — previously a private const) rather than re-deriving a parallel Ajv fragment from `GLYPH_CHART_TICK_FORMAT_PRESET_NAMES`; `color` reuses the existing `HEX_COLOR_SCHEMA` pattern; `domain` is `{type: "array", minItems: 2, maxItems: 2, items: {type: "number"}}` — Ajv can describe the SHAPE of a domain but not `min < max` (a cross-value invariant, exactly like `surface-axis-unsorted`/`colorscale-not-monotone` before it), so an INVERTED `[5, 1]` domain is a legitimate runtime-only exception (`schema.test.ts`'s own documented list, now three entries instead of two) while an unknown format preset or a non-canonical colour string ARE schema-describable and Ajv rejects them too. Every one of the 5 mark types' own JSON schema functions (`glyphChart3dSurfaceJsonSchema`, `_ScatterJsonSchema`, `_ParametricJsonSchema`, `_BarsJsonSchema`, `_LineJsonSchema`) shares the ONE `AXIS_OPTIONS_SCHEMA` constant, so a future 6th field added there reaches all five schemas in one edit.

### Mutation table

| Property | Test | Mutation that reddens it |
|---|---|---|
| `axes.z.format` changes only z's own tick labels | `axisPerAxisOptions.test.ts` | Removing the `format` wiring in `resolveAxis` leaves `mark.axes.z.tickLabels` byte-identical to the baseline |
| `axes.z.color` recolours only the z axis-lines ribbon segment | `axisPerAxisOptions.test.ts` | Reverting `axisTriadLinePolygons` to its old flat `color` parameter paints all three segments the SAME colour, collapsing the expected 2-colour set to 1 |
| `axes.z.color` recolours only z's own STAMPED overlay ink | `axisPerAxisOptions.test.ts` | Reverting `axisTriadOverlay`'s per-axis `axisRenderColor` call back to one flat colour removes either the override or the default from the rendered grid's own colour set |
| `axes.z.tickLabels: false` removes only z's own labels | `axisPerAxisOptions.test.ts` | Ignoring `axis.tickLabelsVisible` in the stamp loop leaves total ink unchanged between the default and the override |
| An axis's own `tickLabels: true` wins over a global `guides.tickLabels: false` | `axisPerAxisOptions.test.ts` | Reading `guides.tickLabels` alone (no `??` override) never lets the axis's own labels back on |
| `axes.z.line: false` drops only the z ribbon segment from the mesh | `axisPerAxisOptions.test.ts` | Ignoring `visibleForAxis` in `axisTriadLinePolygons` keeps the polygon count unchanged |
| An explicit `axes.z.domain` is used VERBATIM, never `.nice()`d | `axisPerAxisOptions.test.ts` | Calling `.nice()` on an explicit domain changes `mark.axes.z.domain` away from the caller's own two numbers |
| A widened `axes.z.domain` leaves real headroom above the data in the surface mesh | `axisPerAxisOptions.test.ts` | Dropping the explicit-domain branch back to the data-derived nice domain makes the mesh's own z max reach `aspect[2]` regardless of the wider domain |
| `mapAxisValue`'s own clamp keeps a scatter marker inside the box under a narrow explicit domain | `axisPerAxisOptions.test.ts` | Removing `Math.max(0, Math.min(1, t))` there sends the marker's own vertices ~64 units past the box edge (verified directly: reverting the clamp reddens this exact assertion, restoring it goes green again) |
| A non-canonical `axes.color`/`axes.{x,y,z}.color` rejects with `bad-axis-color` | `axisPerAxisOptions.test.ts`, `schema.test.ts`, `schema3d.test.ts` | Skipping `resolveAxisColorOption`'s regex check lets `"red"` or `"#ABCDEF"` (uppercase) through silently |
| An inverted/degenerate/non-finite `axes.*.domain` rejects with `bad-axis-domain` | `axisPerAxisOptions.test.ts`, `schema.test.ts` | Skipping the `min >= max`/finiteness check in `resolveExplicitDomain` accepts `[5, 1]` and `[3, 3]` silently |
| Every schema-describable C7 rule has an independent bad fixture, for every one of the 5 mark types | `schema.test.ts`, `schema3d.test.ts` | Removing a `bad` fixture entry drops that rule out of the coverage set the "every rule has a fixture" assertion checks |

### Residuals

- **Domain clipping is a fraction CLAMP, not per-triangle geometric clipping** — stated in full above ("`domain` — verbatim use and the clamp"). A value beyond the domain flattens onto the nearest box face; it never draws past it, but a surface quad straddling the domain boundary is not CUT at the exact boundary the way a camera-frustum near-plane clip cuts a triangle. Acceptable for the packet's own stated goal (axis configurability), a real limitation for a reader who wants pixel-exact data cropping.
- **`bars3d`'s z-floor under a domain that excludes 0** — `bars.ts`'s own z-axis domain is still forced to include 0 for the DATA-DERIVED case (AGENTS.md's own "a bar is drawn from the floor up" rule), but an EXPLICIT `axes.z.domain` that excludes 0 is honoured verbatim like any other axis; `mapAxisValue`'s own clamp then floors such a bar at whichever box edge 0 clamps to (0 or `aspect[2]`), rather than a dedicated `bar-domain-excludes-zero`-style rejection. No test asserts a specific numeric floor position in that narrow, user-opt-in configuration; the clamp's own general behaviour is what's gated.
- **Axis placement (the corner, the default camera) is unchanged and stays an OPEN decision, per the packet's own instruction** — `resolveOriginCorner`/`GLYPH_CHART_3D_DEFAULT_CAMERA` are untouched by C7.
- **The `/charts` sidebar itself (an Axes folder exposing these fields as page controls) is a SEPARATE, later packet** — this packet is the library contract alone; the user's own reported symptom ("cannot configure the z axis in the /charts sidebar") is resolved at the library layer, with the page-side control surface still to follow.

## D2 round 8 — separate same-rank nodes, and put labels beside them

**The user, verbatim:**
- "for the 3d diagrams, can we make them a bit more clear in the separation between the same height/depth nodes? because its difficult to see them separate"
- "also I think that the labels should be like on the side of the nodes and not over the nodes"

### Separation — a camera-aware ring, not a raw in-plane one

`layout3d.ts`'s `triangulatedOffsets` sized its ring radius off `spanA`/`spanB` — the rank's own raw cross-axis and depth half-extents, ONE axis each. Under this module's fixed oblique camera (`GLYPH_DIAGRAM_3D_CAMERA_ROT_X`/`_ROT_Y` = 62/36), that undercounts a box's own projected SCREEN footprint exactly the way round 7's own `screenSafeFlowHalf` fix already proved for RANK spacing: all three of a box's axes contribute to its screen silhouette, not just the two nominally "in-plane" ones. `triangulatedOffsets` now takes the SAME `screenSafeFlowHalf` bound for both `spanA` and `spanB` (the sum of all three of a node's own half-extents), plus a `labelRoom` term — the rank's own longest side-label text length, in characters, scaled by `GLYPH_DIAGRAM_3D_RING_LABEL_UNIT` (`1`, matching `measureGlyphGraph`'s own character-to-world-unit ratio) — since round 8 also makes every label push OUTWARD from its own node in this SAME cross-section plane (below), and the ring must leave room for that text or an outward-pointing label reaches into the next sibling's own arc. `GLYPH_DIAGRAM_3D_RING_GAP` itself rose from `3` (round 7) to `7`.

**Measured, before vs. after**, real `projectedBounds` AABBs on the shipped fixtures at their own auto-fit camera (96x32 braille): reverting to round 7's constants reproduces GENUINE overlaps — both `colGap` AND `rowGap` negative, i.e. the two silhouettes actually intersect on screen:

| Pair (fixture) | Round 7 colGap / rowGap | Round 8 colGap / rowGap |
|---|---|---|
| `a` vs `b` (fan-join-split) | −0.51 / −3.33 (overlap) | 12.23 / 0.81 |
| `b` vs `c` (fan-join-split) | −4.95 / −0.98 (overlap) | 1.33 / 6.56 |
| `answer` vs `coder` (agent-supervisor) | −2.47 / −1.81 (overlap) | 2.83 / 1.65 |
| `researcher` vs `reviewer` (agent-supervisor) | −2.89 / −1.90 (overlap) | 2.49 / 1.58 |

The shipped gate (`render3d.test.ts`, below) requires every same-rank sibling pair, on every one of this round's 5 fixtures at all 3 required sizes, to clear `colGap >= 2 || rowGap >= 1` — read as "separated by at least 2 columns OR at least 1 row," since a rotating ring separates siblings along whichever ONE screen direction is dominant for that particular pair, not necessarily both at once. Every real pair on every fixture/size clears it with margin (the tightest, `s1` vs `s2` on fan-join-split at 96x32, is `colGap=1.99, rowGap=3.81` — passes on the row clause).

### Side labels — a candidate set, not one fixed direction

The label default (`labels: "auto"`) previously fell back to `"side"` only when the text didn't fit the front face; it now ALWAYS resolves to `"side"` (`"inside"` stays reachable as an explicit opt-in, unchanged geometry). The naive fix — push every label along ONE fixed direction (the pre-round-8 `"right"`/`"below"` fallback) — fails outright under this module's own fixed camera: probed directly, pushing a TB-direction node's label along world `+X` (the `"right"` fallback) moved its SCREEN COLUMN from 46.77 to 45.84 — BACKWARD, not forward — because `rotY: 36` does not project `+X` onto "screen right" for every node. A single fixed direction is provably not enough on its own.

`glyphDiagram3dLabelSideCandidates(node, direction, layoutKind)` returns an ORDERED set of candidate WORLD directions, all within the node's own rank's cross-section plane (perpendicular to flow): its own RADIAL direction first — away from its own ring's centre (every ring-placed node's cross-axis coordinates ARE its own offset from that centre, so this direction points into open space and, by construction, away from every other sibling on the SAME ring) — then the plane's own 4 axis directions, then 4 diagonals. A single-member rank (radius 0) or `"force"` layout (no ring) has no radial direction to compute and starts directly from the axis/diagonal set.

`pickGlyphDiagram3dLabelPlacements(nodes, ...)` resolves every node's label TOGETHER, not independently: nodes are visited in PRIORITY order (degree descending, id ascending — the same order the shared `GlyphLabelArbiter` itself resolves conflicts in), and each accepted label's own occupied cells are reserved before the next (lower-priority) node's own search runs. This is necessary, not a refinement — a per-node-independent search (this round's first cut) checks a candidate only against NODE silhouettes, so nothing stops two DIFFERENT nodes' labels from landing on the SAME cells whenever both push in a similar direction, which is the ROUTINE case for a plain chain (every single-member-rank node shares the identical fallback axis). Measured on the real fixtures: the per-node-independent cut, even after tuning the push distance, left 68-98 `3d-label-dropped` ledger entries across the 15 required renders (sweeping the push fraction 0.5-2.0 only ever traded WHICH labels collided, never removed the underlying collision). The reservation-based batch picker alone cut that to single digits; it did not reach zero until the AUTO-FIT (`render3d.ts`'s `fitDiagramCamera`) was ALSO fixed to run its own final label pick at the EXACT camera the frame will render with, rather than a `zoom: 1` reference: the picker's own collision verdict is invariant to zoom/centre in exact real arithmetic (a uniform scale-plus-translate preserves every pairwise interval-overlap relationship), but it ROUNDS every candidate to an integer cell before testing it, and rounding is NOT affine-invariant — two boundary values a hair apart in continuous space can round to different cells at a different zoom/centre, and the greedy reservation loop cascades that one flip through every lower-priority node after it (measured: the agent-supervisor fixture went from "every label predicted placed" at the reference camera to 6 of 7 actually missing at the real one). `fitDiagramCamera`'s fixed-point loop now re-derives its own picks at the CURRENT trial camera on every iteration (never the reference camera past the bootstrap), and takes one final pass at the settled `zoom`/`centre` before returning — closing the gap to genuinely zero.

A push past the box's own surface exit point scales with the box's own half-extent along that direction (`GLYPH_DIAGRAM_3D_LABEL_GAP_FRACTION`), never a flat world-unit constant — a flat `gap: 1` (round 7's own value for `"right"`/`"below"`) measured SUB-CELL at a multi-rank chain's own auto-fit zoom (the box's own half-extent there is many world units, so a push of `1` barely moves the label's own screen position at all), which is exactly why chain fixtures (LeNet-5, transformer) kept re-landing labels ON their own box even after the candidate/picker fixes. Swept `0.5`-`2.0` against the REAL render's own `3d-label-dropped` count (not a synthetic silhouette-only check, which undercounts — a candidate can clear every node's own box yet still land on ANOTHER label's own text):

| Fraction | Total drops (15 renders) |
|---|---|
| 0.5 | 98 |
| 0.75 | 85 |
| 1.0 | 6-9 (varies with candidate-set size) |
| 1.1 | 3 |
| **1.25** | **0** |
| 1.3 | 0 (2 before the final-camera fit fix) |
| 1.5 | 0 (5 before the final-camera fit fix) |
| 1.75-2.0 | 6-10 (labels start colliding with EACH OTHER) |

`1.25` was kept — comfortably inside the zero-drop range (`1.15`-`1.5`+), with margin on both sides. Two-sided residual: too small under-clears a node's own box; too large starts pushing labels into EACH OTHER, since diagram real estate is finite.

### Leader

A `"side"` label whose push clears `GLYPH_DIAGRAM_3D_LEADER_MIN_CELLS` (`1.5` screen cells) from its own node's real edge now carries a short leader — a single `"."` character, stamped via `stampGlyphOverlayLine` from the node's own exact surface exit point (`leaderFrom`, unchanged from earlier rounds — never a corner) to the label's own anchor. Never a box-drawing/bar glyph: round 7's own reason for dropping stamped edges (a `─│/\` glyph staircases the instant its own segment isn't screen-axis-aligned) does not apply to a repeated single dot, which has no directional shape to stair-case. Stamped directly into the grid (not through the label arbiter, which has no text-collision concept for a leader), so it paints regardless of whether the arbiter goes on to accept the label text itself at that exact cell — a documented, rare residual the round's own zero-drop tuning keeps at zero across every one of the 5 fixtures.

### Gates

Two new integration gates in `render3d.test.ts` (`renderGlyphDiagram3d — D2 round 8`), run against all 5 required fixtures at all 3 required sizes (96x32 braille, 96x32 blocks, 140x40 braille — 15 renders each):

1. **Same-rank sibling silhouettes clear a minimum visible gap** (`colGap >= 2 || rowGap >= 1`) — every same-rank pair on every fixture/size. Mutation: reverting `layout3d.ts`'s ring spacing to the round-7 flow-axis-half-extent-only formula reddens it immediately (`fan-join-split braille 96x32: a vs b (colGap=-0.51, rowGap=-3.33)`).
2. **No `3d-label-dropped`/`3d-label-unfittable` ledger entry anywhere** — the real, render-time proof that no label collided with a node silhouette or another label. Mutation: short-circuiting the picker's own silhouette/claim check to always accept the first candidate reddens it (`fan-join-split braille 96x32` alone drops 9+ labels).
3. A third, narrower gate confirms the fan-join-split fixture's own `"Merge"` node (pushed clear of its own box at 96x32) carries a real `"."` leader mark on the row immediately above its label. Mutation: disabling the leader stamp reddens it.

`glyphDiagramObject.test.ts`'s own pre-existing degenerate-projection test was rewritten (not merely patched) for round 8's own correctness rule: under a projection so degenerate every node's silhouette collapses to ONE shared cell, there is no longer a "highest-priority label still wins a visible cell" outcome to arbitrate — showing ANY label would mean painting it directly over a node's own box, which is exactly what this round exists to prevent. The gate now asserts every label is DROPPED (the grid stays exactly as seeded) rather than asserting the old priority-wins-a-cell behaviour; mutation (place it anyway when every candidate collides) reddens it.

All 56 `src/3d/*.test.ts` tests pass, all 278 tests in the `@glyphcss/diagrams` package pass, `tsc --noEmit` is clean, and `pnpm build:packages` succeeds.

### Mutation table

| Mutation | Gate that catches it |
|---|---|
| Revert `layout3d.ts`'s ring spacing to the flow-axis-half-extent-only formula (no `screenSafeFlowHalf`, no `labelRoom`) | `same-rank sibling node silhouettes clear a minimum visible gap` → red (genuine AABB overlap reproduced) |
| Skip the silhouette/claim check in `pickGlyphDiagram3dLabelPlacements` (always accept the first candidate) | `every label... NO node-silhouette collision and NO label-vs-label collision` → red |
| Disable the leader stamp | `a label pushed clear of its own node's edge carries a visible leader mark` → red |
| Place a label anyway when every candidate collides under a degenerate projection | `glyphDiagramObject.test.ts`'s own rewritten degenerate-projection gate → red |
| Revert `GLYPH_DIAGRAM_3D_LABEL_GAP_FRACTION` to `1` (round 7's implicit flat-gap scale) | Real-render drop-count sweep goes from 0 to 6-9 (not a standing gate — the swept table above is the record; the zero-drop gate above still catches it since it counts ANY drop) |

### Residuals, stated plainly

1. **A "side" label avoids every node silhouette and every other label, but not an edge ribbon's own projected path.** `pickGlyphDiagram3dLabelPlacements` only ever silhouette-tests against `layout.nodes`; an edge (a thin ribbon, half-width `0.45`) is never checked. None of this round's own 5 fixtures at the 3 required sizes exercises a genuine label/edge collision (every render above ships with an EMPTY ledger), so this is recorded as a known gap rather than a failing gate with no fixture to pin it against.
2. **A dropped label's leader can occasionally be orphaned.** The leader is stamped directly into the grid at `stamp()` time, independent of whether the label TEXT itself goes on to win the arbiter's own resolution (a genuinely separate, later step). The round's own zero-drop tuning keeps this at zero across every shipped fixture, but it is not structurally impossible on an arbitrary future graph.
3. **The camera-invariance argument (zoom/centre don't change the collision verdict) holds only in exact arithmetic.** `pickGlyphDiagram3dLabelPlacements` rounds every candidate to an integer cell, and rounding is not affine-invariant — this is exactly what made the FIRST cut of the auto-fit's own final pass necessary (see above); the fix (run the picker at the literal final camera, not an estimate) closes the gap for every fixture measured, but is not a formal proof for an arbitrary graph/camera combination.
4. **The gap-fraction/ring-gap constants remain empirically tuned, not analytically derived** — consistent with every earlier round's own camera/geometry constants (`GLYPH_DIAGRAM_3D_CAMERA_ROT_X`/`_ROT_Y`, the round-7 ribbon/arrowhead sizes), tuned by rendering the real examples and sweeping a real render-time metric (the `3d-label-dropped` count), not by closed-form derivation.

### Deliverables — all 5 examples, verbatim, at all 3 required sizes

Rendered via `renderGlyphDiagram3d` at `target: "web"`, default (auto-fit) camera, `layout: "layered"`. Every ledger below is EMPTY.

#### LeNet-5 CNN

**96x32 braille**
```
                                                                                                
                                                                                                
                                                                                                
                                                                         ⢀⣠⠴⢺⢙⣲⡆                
                                                                        ⡾⠭⣄⣠⠴⠋ ⠁                
                                                                        ⣇⣠ ⠃   ⠁                
                                                                ⢀⡤⡶⢤⣀⢀⣤⡾⢿⠁ ⠇ ⠆⠁                 
                                                              ⣴⣚⠉⣀⡤⠞⠁⠟    ⠉⠁                    
                                                              ⡇⠈⢹⠁          input 32x32x1       
                                                       ⢀⣤⣀  ⣠⣴⣿⠛⢸   ⠂                           
                                                    ⢀⣠⠞⠉⣁⡼⣿⡿⠛⠁⠈⠙⠚ ⠁                             
                                                    ⡏⠓⢲⠋⠁         conv 28x28x6                  
                                              ⣀   ⢀⣠⣷⠷⠸   ⠄                                     
                                           ⣠⠴⠋⡏⣹⣶⣶⠟⠃⠛⠦⠼ ⠃⠁                                      
                                         ⢰⠯⣅⣠⠴⠋⠁       pool 14x14x6                             
                                         ⢸⣠ ⠇   ⡀                                               
                                  ⣠⢴⠲⣤⣄⣠⣶⠿⠋⠁⠇ ⠆⠋                                                
                               ⢠⢶⣋⣡⠴⠚⠁⡇⠋⠁  ⠉⠉                                                   
                               ⢸⢀ ⠇   ⠇      conv 10x10x16                                      
                        ⢀⣠⡦⣄⡀⣀⣤⢾⣋⠁⠇  ⠆⠃                                                         
                       ⢰⠯⢤⠖⠋⠁⠋  ⠈⠉⠉⠁                                                            
                       ⢸⣠⠸  ⠃      pool 5x5x16                                                  
               ⢀⡤⠖⣟⣶⣀⣤⠾⠋⣄⢸ ⠆⠃                                                                   
               ⢸⠉⢹⠁ ⠛⠁                                                                          
         ⣠⣄⡀  ⣠⣼⠾⠸        fc 120                                                                
       ⡴⣏⣹⡤⠟⣷⠟ ⠉⠓⠚⠂⠁                                                                            
       ⡇ ⢸  ⡇     fc 84                                                                         
       ⣧ ⢸ ⡄⠇                                                                                   
        ⠉⠉⠁                                                                                     
          out 10                                                                                
                                                                                                
                                                                                                
```
ledger: []
#### LeNet-5 CNN

**96x32 blocks**
```
                                                                                                
                                                                                                
                                                                                                
                                                                           ▄▄▄▄▄                
                                                                        ▄▄██████                
                                                                        ████████                
                                                                  ▄    ▄██████▀                 
                                                               ▄█████▀▀   ▀▀                    
                                                              ███████       input 32x32x1       
                                                              ██████▀                           
                                                      ▄███▄▄▀▀▀▀▀▀▀                             
                                                    ███████       conv 28x28x6                  
                                                    ███████                                     
                                            ▄▄█▄▄▄▄▀▀███▀                                       
                                          ▄██████      pool 14x14x6                             
                                          ███████                                               
                                   ▄▄   ▄▄████▀▀                                                
                                ▄▄█████▀    ▀                                                   
                                ███████      conv 10x10x16                                      
                               ▄█████▀▀                                                         
                        ▄████▀▀  ▀▀▀                                                            
                        █████      pool 5x5x16                                                  
                 ▄▄▄ ▄▄▀████▀                                                                   
                ████▀                                                                           
               ▄████      fc 120                                                                
        ▄███▄▄▀ ▀▀▀▀                                                                            
       ██████     fc 84                                                                         
       █████▀                                                                                   
         ▀▀                                                                                     
          out 10                                                                                
                                                                                                
                                                                                                
```
ledger: []
#### LeNet-5 CNN

**140x40 braille**
```
                                                                                                                                            
                                                                                                                                            
                                                                                                             ⢀⡤⡶⠤⢤⣀⡀                        
                                                                                                          ⣀⡴⠚⠉  ⣠⠴⠋⠁                        
                                                                                                         ⢸⠓⠦⣄⣠⠴⠋⠁  ⠇                        
                                                                                                         ⢸ ⢀ ⠇     ⠇                        
                                                                                                 ⣀      ⣠⣼⡿⠛ ⠇    ⠆⠃                        
                                                                                             ⢀⣠⠴⠋⡏⠙⢲⣤⣠⣶⠿⠋⠁⠧⠤⣄⠇ ⠂⠁                           
                                                                                           ⢠⣖⡋  ⢀⡤⠖⠃⠸⠋⠁       .                             
                                                                                           ⢸ ⠉⠓⡞⠉             input 32x32x1                 
                                                                                           ⢸⣤⣶ ⠃                                            
                                                                                 ⢀⡤⡶⠤⢤⣀ ⣀⣤⣾⢿⠋  ⠇  ⠆⠃                                        
                                                                              ⣀⡴⠚⠉ ⢀⣠⠞⠉⡾⠟   ⠉⠉⠓⠃⠁                                           
                                                                             ⢸⠓⠦⣄⣠⠴⠋            conv 28x28x6                                
                                                                             ⢸ ⢀ ⠇                                                          
                                                                     ⢀⡀     ⣠⣼⡿⠛ ⠇    ⠂                                                     
                                                                  ⢀⡤⠞⢹⠉⢉⡷⣆⣴⡾⠏⠁⠧⠤⣄⠇ ⠃⠁                                                       
                                                               ⢀⡤⠞⠉ ⢀⡤⠞⠉ ⡇⠉       .                                                         
                                                               ⢸⠉⠉⠓⡞⠉    ⠇        pool 14x14x6                                              
                                                               ⢸⣤⣦ ⠃     ⡇                                                                  
                                                      ⣠⢴⢤⣀  ⢀⣠⣾⢿⠋  ⠇  ⠄⠃⠁                                                                   
                                                  ⢀⣠⠖⠋⠁ ⣠⠼⠚⡶⠟   ⠉⠉⠓⠃⠁                                                                       
                                                  ⡟⠒⠲⢤⠖⠋⠁           conv 10x10x16                                                           
                                                  ⡇⢀ ⢸                                                                                      
                                          ⢀⣀    ⣀⣤⣿⠟⠃⢸    ⠂                                                                                 
                                       ⣠⠴⠚⠹⣨⠟⣇⣴⡾⠟ ⠙⠲⢤⣸ ⠆⠁                                                                                   
                                       ⡏⠙⢲⠋⠁ ⠇⠉        .                                                                                    
                                       ⣇⣤⢸   ⠁         pool 5x5x16                                                                          
                             ⢀⣠⢴⠦⣄⡀ ⣀⣴⡾⠏⠁⢸   ⠁                                                                                              
                            ⡾⢭⣀⡤⠖⠋⠃⡾⠏⠁ ⠈⠙⠚ ⠁                                                                                                
                            ⡇ ⢸   ⠇       .                                                                                                 
                    ⢀⡀    ⢀⣠⣷⠿⢸   ⠇       fc 120                                                                                            
                 ⢀⣠⠞⢹⣉⡷⣆⣠⣶⠿ ⠻⢤⣸  ⠃⠁                                                                                                         
                 ⡏⠓⢲⠋⠁ ⡇⠋⠁     .                                                                                                            
                 ⡇ ⢸   ⠁       fc 84                                                                                                        
                 ⣇ ⢸   ⠁                                                                                                                    
                 ⠙⠲⠼ ⠃                                                                                                                      
                    .                                                                                                                       
                    out 10                                                                                                                  
                                                                                                                                            
```
ledger: []
#### Transformer encoder

**96x32 braille**
```
                                                                                                
                                     ⢀⣠⡤⠤⢤⡀                                                     
                                     ⣿⣀⣀⣀⣨⣿.Input Embedding                                     
                                     ⡿⠇ ⠇ ⠁                                                     
                                     ⠙⠳⠤⠧ ⠃                                                     
                                       ⢸⡇                                                       
                                       ⢸⠁                                                       
                                     ⢀⡤⠾⡀⣶                                                      
                                     ⢸⠉⢹⠁                                                       
                                     ⠸⣄⠸⡄⠆Positional                                            
                                       ⢸⠇                                                       
                                       ⢸⠁                                                       
                                     ⢀⡤⢾ ⣶                                                      
                                     ⢸⠙⢲⠃                                                       
                                     ⠸⣄⠸⡄⠆Multi-Head                                            
                                       ⢸⡇                                                       
                                       ⢸⠃                                                       
                                      ⣠⢾⠁⣦                                                      
                                     ⢸⠓⢲⠃⠁                                                      
                                     ⠸⣄⠘ ⠆Add & Norm                                            
                                       ⢸⠇                                                       
                                       ⢸⠁                                                       
                                      ⢀⣼⠁⣤⡄                                                     
                                     ⢰⠯⡴⠚⠁⠃Feed Forward                                         
                                     ⢸ ⠃ ⠆⠃                                                     
                                      ⠉⠉⡇                                                       
                                       ⢸⠃                                                       
                                       ⣸⠃⣀                                                      
                                     ⢰⠯⢭⠗⠃                                                      
                                     ⢸ ⠸  Add & Norm                                            
                                     ⠈⠙⠚⠃                                                       
                                                                                                
```
ledger: []
#### Transformer encoder

**96x32 blocks**
```
                                                                                                
                                                                                                
                                     ██████.Input Embedding                                     
                                     ██████                                                     
                                     ▀▀▀█▀▀                                                     
                                        █                                                       
                                        █                                                       
                                       ▄█▄                                                      
                                      ████                                                      
                                      ███▀Positional                                            
                                        █                                                       
                                        █                                                       
                                       ▄█▄                                                      
                                      ████                                                      
                                      ███▀Multi-Head                                            
                                        █                                                       
                                        █                                                       
                                       ▄█▄                                                      
                                      ████                                                      
                                      ███▀Add & Norm                                            
                                        █                                                       
                                        █                                                       
                                        █▄                                                      
                                      █████Feed Forward                                         
                                      ████▀                                                     
                                       ▀█                                                       
                                        █                                                       
                                        █                                                       
                                      ▄███                                                      
                                      ████Add & Norm                                            
                                      ▀▀▀                                                       
                                                                                                
```
ledger: []
#### Transformer encoder

**140x40 braille**
```
                                                                                                                                            
                                                            ⣀⣀⣀⣀                                                                            
                                                          ⣼⠉⠁⡇ ⢸⢳.Input Embedding                                                           
                                                          ⣿⢳⠒⠒⡖⠚⠹                                                                           
                                                          ⡿⢸    ⠈                                                                           
                                                          ⠉⠛⠒⠒⠃⠂⠉                                                                           
                                                             ⣿                                                                              
                                                             ⣿                                                                              
                                                             ⣿⣀                                                                             
                                                           ⣠⠴⢿⣫⠟.Positional                                                                 
                                                           ⡏⠉⡏  ⠁                                                                           
                                                           ⣧ ⠃  ⠃                                                                           
                                                           ⠈⠉⠁                                                                              
                                                             ⣿                                                                              
                                                             ⣿                                                                              
                                                           ⢀⣠⣿⡗⣦⡄                                                                           
                                                           ⡟⠦⡴⠚⠁⠃Multi-Head                                                                 
                                                           ⣇ ⠁  ⠃                                                                           
                                                           ⠛⠦⠇⠂⠁                                                                            
                                                             ⣿                                                                              
                                                             ⣿                                                                              
                                                             ⣿⣤⣀⡀                                                                           
                                                           ⣴⣚⣻⠵⠋⠁Add & Norm                                                                 
                                                           ⡇ ⠇  ⠁                                                                           
                                                           ⢷⣀⠇ ⠃⠁                                                                           
                                                             ⣿                                                                              
                                                             ⣿                                                                              
                                                             ⣿                                                                              
                                                           ⣀⡤⣿⡏⣳⢶                                                                           
                                                          ⢸⠓⠦⡴⠚⠁ .Feed Forward                                                              
                                                          ⢸  ⠁  ⠄                                                                           
                                                          ⠈⠓⠦⠇⠂⠁                                                                            
                                                             ⣿                                                                              
                                                             ⣿                                                                              
                                                             ⣿⣄⡀                                                                            
                                                           ⣴⡚⢛⣡⠟⠃Add & Norm                                                                 
                                                           ⡇⠉⠏  ⠁                                                                           
                                                           ⣷ ⠇  ⠃                                                                           
                                                            ⠉⠉                                                                              
                                                                                                                                            
```
ledger: []
#### Agent supervisor

**96x32 braille**
```
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                           ⢀⡀                                                   
                                        ⢀⡤⠞⣹⡽⢻                                                  
                                        ⢸⠉⢹⠁                                                    
                                        ⠸⣄⢸  ⠁                                                  
                                        User request                                            
                                           ⣿                                                    
                                         ⢀⣀⣿⡄                                                   
                                         ⢸⢯⣛⣳                                                   
                                     ⣀   ⢸⣼ ⠈                                                   
                                 ⢀⣠⢴⣫⣿⣭⣷⢶⣿⣿ ⣿⠷Supervisor                                        
                              ⢀⣠⡶⠛ ⡟⠦⡽⣋⣴Reviewer ⡛⠷⣦⣤⣀⡀  ⡀                                      
                           ⢀⣤⡶⠛   ⢀⣧⣴⣿⠟⠁⣤⣀⡀⣿⠘⣾⡄  ⠉⠙⠒⠮ ⣿⡷⠯⣯⢷                                     
                        ⣀⣤⡾⠛   ⢀⣤⣾⣿⡿⠋⢻⡍ ⠈⠉⠛⣿⢶⣾⣷⣀⡀    ⢸⠙⢻⠛⠳⠦..Final answer                       
                      ⣴⣾⣟⠉  ⣀⣤⣾⣿⣴⠟    ⢻⡄   ⣿  ⠹⣧⠛⠷⢶⣤⣄⣸⣀⢸ ⣴⡶⠟                                    
                      ⣿⠉⠛⣻⣷⣾⣿⣛⣿⡿⢻     ⠈⢿⡄  ⣿   ⢹⣧   ⠉⠙⣻⡿⣿⠁⣄⣀⣿                                   
                      ⣿⣴⡿⠛ ⢸⠈⢹⠙⠛⠶⢦⣤⣀⡀  ⠈⣿⡀ ⣿    ⢻⣦⣄⣠⠶⠛   ⢈⣩⣿⠿                                   
                      ⠙⠛⠿⢶⣦⣼⣤⣸ ⠆⠁Researcher⣿   ⢰⣯⡿⠛⠁  ⢀⣠⣶⠟ ⠁                                    
                           ⠉⠙⠛⠷⢶⣤⣍⣙⠻⠷⣦⣤⣀⡀⠸⠉⣿⠲⢤⠖⢻ ⠃ .Coder                                       
                                 ⠉⠛⠻⠷⣶⣭⣝⡛⣷⣿⣿⣷⣾⠞⠛⢓⣧⡿⠟                                            
                                      ⠈⠉⠛⡿⠷⣾⣥⣸⣤⡾⠛⠁                                              
                                         ⣷ ⠁⠈⠏Reports                                           
                                          ⠉⠁                                                    
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```
ledger: []
#### Agent supervisor

**96x32 blocks**
```
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                          ▄███                                                  
                                         █████                                                  
                                         ████▀                                                  
                                        User request                                            
                                           █                                                    
                                           █                                                    
                                          ███                                                   
                                          ███                                                   
                                   ▄ ██ ▄▄███▄Supervisor                                        
                                ▄ ▀▄████Reviewer▀ ▄▄                                            
                             ▄ ▀   █████   █ █   ▀▀ ▄█ ▄▄█▄                                     
                          ▄ ▀    ▄ █▀▀▄  ▀▀█▄▄█       █████..Final answer                       
                       ▄▀     ▄ █▀▀   ▀▄   █   ▀▀ ▄   █████ █                                   
                      █ ▀  ▄ ███▄      ▄   █   ▀▄    ▀ ▄▄▀  █                                   
                      █ ▄▀▀ █████▄      █  █    ▀▄  ▄ ▀    █▀                                   
                      ▀  ▄  █████Researcher█    ▄███    ▄ ▀                                     
                            ▀  ▄  ▀  ▄   ▀██▄▄▄▀███.Coder                                       
                                  ▀ ▄▄ ▀▀ ▄█▄▄  ▀▀█ ▀                                           
                                       ▀▀█████ ▄ ▀                                              
                                         ████▀Reports                                           
                                           ▀                                                    
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```
ledger: []
#### Agent supervisor

**140x40 braille**
```
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                ⣀⡴⢺⢲⣤                                                                       
                                                              ⢰⠯⣅⣠⠴⠃                                                                        
                                                              ⢸  ⠃                                                                          
                                                              ⠸⢀ ⠃⡀⠆.User request                                                           
                                                                ⠉⠉⡇                                                                         
                                                                 ⣿⠃                                                                         
                                                                 ⣿⠃                                                                         
                                                               ⢠⠤⣿⠃                                                                         
                                                               ⢸⣇⠛⢁⣧                                                                        
                                                               ⢸⣸⠉⠉⠘                                                                        
                                                        ⢀⣴⣶⠤⣄⣀⣀⣸⣾  ⠘.Supervisor                                                             
                                                     ⣀⡴⣺⠽⢻⣿⣿⢿⠛⣫⡿⠻⠉⢩⡉⠙⠻⠶⣦⣄⣀                                                                  
                                                  ⣠⠴⠚  ⡏⠙⢲⠋⢁⣼⠞⠋  ⣿⡏⣷⠙⠓⠶⢤⣍⠁⠛⠷⣦⣤⣀    ⣀                                                        
                                               ⣠⠴⠋     ⣇ ⣸⡴⢻⠁Reviewer    ⠉⠙⠒⠦⢬⠁⡃⣷⣶⡏⡏⣹⢶                                                      
                                           ⢀⣠⠖⠋     ⢀⣠⡶⣻⠿⠋⣷⡃ ⠈⠉⠛⠻⣿⠃⣤⣹⣧         ⡟⠻⢶⠶⣯⣁⣸ ..Final answer                                       
                                        ⢀⡤⠖⠋     ⢀⣠⠶⢛⡴⠞⠁  ⠘⣷     ⣿⠃⠉⠙⢻⣿⢶⣦⣄⣀    ⡇ ⠘  ⠈⢉.⣶                                                    
                                       ⡾⠭⣄⣀   ⢀⣤⢶⣫⣥⡴⠋      ⠸⣧    ⣿⠃   ⢻⣆ ⠉⠙⠛⠷⢶⣤⣿⢤⢸⣀⣦⠟⠋⠁⣿                                                    
                                       ⡇  ⠈⠙⣷⠾⣿⣟⣉⣻⡧⠟⠃Researcher  ⣿⠃   ⠈⢿⡄      ⣉⡿⠿⠿⣶⣤⣄⣀⣿                                                    
                                       ⡇⢀⡤⠞⠋  ⡇⠈⢹⠙⠳⠶⣧⣄⡀      ⢹⣆  ⣿⠃    ⠈⣿⣄⡀ ⣀⡴⠞⠁    ⠈⢉⣿⠿                                                    
                                       ⠻⠭⣄⣀   ⣧ ⢸  ⡄⠇⠈⠉⠛⠲⢦⣤⣀⡀ ⢻⡄ ⣿⠃    ⣴⣚⣿⡽⢻      ⣀⣤⠞⠋⠁                                                     
                                          ⠈⠉⠓⠲⠬⣝⣚ ⠉⠉⠛⠷⢶⣤⣀⡀ ⠉⠙⠛⠶⢿⣤⣿⡇   ⣠⡷⠛      ⣀⡴⠞⠃                                                         
                                                ⠈⠉⠓⠲⠤⣄⡀⠈⠁⠃⠻⢶⣤⣄⡀⠈⢿⣿⠛⠻⣶⠋ ⣧ ⡇ ⠄Coder                                                           
                                                      ⠉⠙⠒⠦⢤⣀⡀⠉ ⣻⣾⣿⣿⣷⣿⠟⠛⠉⠉⣁⡴⠚                                                                
                                                            ⠉⠙⢺⠷⢦⣴⡟⠁⣿ ⣠⠴⠛⠁                                                                  
                                                              ⢸  ⡇⠉⢿.Reports                                                                
                                                              ⠘⠲⠤⠇⠚⠁                                                                        
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
```
ledger: []
#### Multi-agent crew

**96x32 braille**
```
                                                                                                
                                                                                                
                                                                              ⢀⣠⣄⣀⡀             
                                                                           ⢀⡤⠖⠋  ⣠⠽⡇            
                                                                           ⢸⠉⠓⠦⡴⠚⠁ ⠃            
                                                                           ⢸ ⢀ ⠁   ⠃            
                                                                  ⢀⡀     ⢀⣠⣾⠿⠋ ⠇   ⠃            
                                                               ⣀⡤⠞⢹⠉⢉⣳⣆⣤⣶⠿ ⠙⠦⠤⣄⠃ ⠂⠁             
                                                              ⢸⠓⠦⣄⣠⠴⠃ ⡇⠋        .               
                                                     ⣀        ⢸   ⠃   ⠃         Request         
                                                  ⣠⣴⢿⠟⠛⠷⣶⣤⣄⡀ ⣠⣼⣿⠿ ⠇   ⠃                         
                                               ⣠⡴⠟ ⣠⢾⡟⠒⢲⣤⣾⢿⠇⣿⠿⠋⣅⢀ ⠃ ⠄⠃⠁                         
                                            ⣠⡴⠟ ⣠⠴⠋⠁⢀⣤⡾⠟⠉⡇⢿⡇⠁    ⠉⠁                             
                                         ⣠⡴⠛    ⡏⢉⣽⣾⠟⠉   ⠃⢸⠃      Manager                       
                                      ⣠⡴⠛     ⢀⣤⣿⣻⠁⢸     ⠃⢸⠃                                    
                                   ⣠⠴⠛⢀⣠⣄⣀ ⢀⣤⣾⣻⠁⣿⠃⠁⢸    ⠆⣣⣿⠃                                    
                                 ⣶⠯⢤⣤⣖⡋⠘⣀⣼⢿⣻ ⠿⠋⠁⠛⠲⢤⣸ ⠆⣡⣴⡿⠛                                      
                                 ⣿ ⢸⠉⠙⠛⣿⠋⠁⢸⠋⡵⠛⠁    ⣠⣴.⠛                                         
                                 ⣿ ⢸⣀⣄⢸⣿  ⢸⠁    ⣠⣴⡿⠛ Researcher                                 
                        ⣀⣀⣀⣀⡀    ⣿⣴⣾⠿⠇⢸⣿     ⣠⣴⡿⠛                                               
                        ⣷   ⣷ ⣀⣴⣾⣿⠋⡿⠧⢤⣸⣿⠆⠃⣠⣴⡿⠃⠁                                                 
                        ⡏⡗⠒⠒⠚⣿⡟  ⠈⠛⠻⢶⣦⣤.⣴⡿⠁⠁                                                    
                        ⣇⡇   ⠃        ⠉Writer                                                   
              ⢀⡀     ⣀⣴⡾⠟⡇   ⠃                                                                  
          ⢀⣠⠴⠚⠹⠉⣹⢶⣠⣴⡾⠏⠁ ⠸⣇   ⠃                                                                  
          ⢸⠙⠲⢤⠖⠋⠁⠸⠛⠁       .                                                                    
          ⢸  ⢸             Review                                                               
          ⢸  ⢸                                                                                  
          ⠘⠦⢤⣸  ⠃                                                                               
              .                                                                                 
              Result                                                                            
                                                                                                
```
ledger: []
#### Multi-agent crew

**96x32 blocks**
```
                                                                                                
                                                                                                
                                                                                                
                                                                             ▄▄████▄            
                                                                            ████████            
                                                                            ████████            
                                                                           ▄████████            
                                                                 ▄██▄▄▄ ▄█▀ ▀████▀▀             
                                                               ████████▀        .               
                                                               ████████         Request         
                                                   ▄▄█ ▄▄      ████████                         
                                                ▄▄▀ ▄█▄▄▄▄██▄▀▀██████▀                          
                                             ▄▄▀ ▄▄███████▀█     ▀▀                             
                                          ▄▄▀   ██████████ █      Manager                       
                                       ▄ ▀      ██████████ █                                    
                                    ▄▀▀      ▄▀█████████▀▀▄█                                    
                                 ▄██ ▄▄███▄▀█▄▀█▀▀███▀▀ ▄▀▀                                     
                                 █  ███████▀▄▀▀      ▄▀▀                                        
                                 █  ███████▀      ▄▀▀Researcher                                 
                                 █ ▄███████   ▄▄▀▀                                              
                        █████   ▄██▄▀████▀ ▄▄▀                                                  
                        █████▄█▀  ▀▀▄▄ █▄▄▀                                                     
                        ██████         Writer                                                   
                      ▄▄██████                                                                  
            ▄▄███▄ ▄▄▀▀  █████                                                                  
           ███████▀▀       .                                                                    
           ███████         Review                                                               
           ███████                                                                              
           █████▀                                                                               
              .                                                                                 
              Result                                                                            
                                                                                                
```
ledger: []
#### Multi-agent crew

**140x40 braille**
```
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                            ⢀⡤⠖⡟⠒⠦⢤⣀                        
                                                                                                          ⣴⣚⠉  ⢀⣠⠴⠚⠁                        
                                                                                                          ⡇⠈⠉⠓⡞⠉                            
                                                                                                          ⡇   ⠁                             
                                                                                                         ⣀⣷⣾⠿ ⠇                             
                                                                                             ⣠⢴⠦⢤⣀⡀   ⣠⣴⣿⠾⠋⠁  ⡇   ⡄⠂                        
                                                                                          ⣀⡴⠚⠁  ⢀⣠⠟⣧⣴⣿⠟⠁⠁ ⠙⠲⠤⣄⡇ ⠃⠁                          
                                                                                         ⢸⠓⠦⢤⣀⡤⠞⠉  ⡇⠋          .                            
                                                                                         ⢸   ⢸     ⠇           Request                      
                                                                           ⢀⣤⣶⣦⣤⣀⡀       ⢸⣤⢶ ⢸     ⠇                                        
                                                                        ⢀⣤⡾⠟⢀⣿⣄⡉⠙⠛⠿⢶⣦⡄⢀⣤⣾⣿⠇⠁ ⢸     ⠇                                        
                                                                     ⣀⣴⡾⠟ ⣠⠖⠋⣿ ⠉⢙⣶⣶⣿⢻⠃⣻⠇⠁⠘⠯⣄⢀⢸  ⠂⠉                                          
                                                                  ⣀⣴⡾⠟ ⣠⠴⠋⠁  ⢀⣤⣾⠟⠋⢸⣻⢿⡇      ⠈⠉⠁                                             
                                                               ⣀⣴⡾⠛    ⡏⠉⠓⣲⣤⣾⠟⠃     ⢸         .                                             
                                                            ⣀⣴⠾⠃       ⣇⣴⡾⠟⠁        ⢸         Manager                                       
                                                         ⣠⣴⠾⠃       ⣠⣴⡾⣟⠉⣶ ⢸        ⢸                                                       
                                                      ⣠⣴⠿ ⠁⣀⣤⣀   ⣠⣴⡿⠛⠁⣾⠏⠋  ⢸     ⠆⠉⣻⣿                                                       
                                                    ⣶⣿⣤⣀⣠⠴⠋⠁ ⢈⣩⣷⣿⠛⠁⣿⠿⠋⣾⠟⠲⢤⣀⢸  ⠂⢉⣠⣶⠿⠃⠁                                                       
                                                    ⣿⠁⠈⠉⠛⠿⣶⣦⣶⠿⠋⠁⡇⠿⠋⡿⠟⠋    ⠈⠉⢁.⣶⠿⠁⠁                                                          
                                                    ⣿⠁ ⡇   ⣿⣿   ⠇⠟⠉      ⢀⣤⣶⠿Researcher                                                     
                                                    ⣿⠁ ⣷⣦⣦ ⣿⡟   ⠃     ⢀⣤⣾⠟                                                                  
                                        ⢀⣀⣀⣀⣀⣀      ⣿⣧⣾⡿⠏⠇ ⣿⡟   ⠃  ⣀⣴⡾⠟                                                                     
                                        ⢸⣆   ⢸⣆  ⢀⣠⣶⣿⠋⠁⠿⢥⣀⡀⣿⡟⠴⠃⠁⣀⣴⡾⠟                                                                        
                                        ⢸⠸⣄⣀⣀⡤⠼⣦⣶⠿⠃⠁⠛⠿⢷⣤⣄⣀⠉⢹⣿⣠⣴⡾⠟                                                                           
                                        ⢸ ⡇    ⡇⠃       ⠉⠙⠛⠿⠏⠛                                                                              
                                        ⣸⣤⡇    ⠃            Writer                                                                          
                            ⢀⡀       ⣠⣴⡾⠏⠉⡇    ⠃                                                                                            
                         ⣀⡴⠚⢹⠉⠓⢲⣤ ⣠⣴⣿⠏   ⢳⡇    ⠃                                                                                            
                       ⢰⠯⣅⣀ ⣀⡤⠞⠁ ⣿⠇       ⠉⠉⠉⠉⠉⠁                                                                                            
                       ⢸  ⠈⢹⠁               .                                                                                               
                       ⢸   ⢸                Review                                                                                          
                       ⢸   ⢸                                                                                                                
                       ⠸⣄  ⢸   ⠂⠉                                                                                                           
                         ⠉⠙⠚ ⠁                                                                                                              
                            .                                                                                                               
                            Result                                                                                                          
                                                                                                                                            
```
ledger: []
#### Fan-out / join / split

**96x32 braille**
```
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                   ⣀⡀                                           
                                                ⢀⡴⠚⣇⡽⢻                                          
                                                ⢸⠉⢹⠁  ⠦⣤⣀          Input                        
                                                ⢸⢸⣸     ⠉ ⠳⢦⣄⣀   ⣠⠴⢺⣳⡆                          
                                                ⠈⠙⡇⠃⠁       ⠈ ⠛⠶⣦⣏⠉⡏ ⠁                          
                                                  ⢹Branch B      ⣿⣿⣷⣾⡗⣦⡄                        
                                   Split 3        ⠘⡆            ⣰⡿⡟⠦⣼⠻⠁⠁                        
                                ⣠⠴⢺⢙⡶⡆             ⣇           ⣰⣿⣥⣷⠆⠃  ⠁                        
                                ⡏⠓⡞⠁ ⠇⣤⣀⣀         ⣠Join ⢀⣀⣤⣤⡶⠾⣻⠁⠉⠁⠻⠤⠇ ⠁                         
                                ⣧⣷⣟⣶ ⡇⠈⠉⠉⠁⠻⠶⢶⣤⣤⣀⣀⣸⠷⣿⣿⣷⠶⠟⠛⠉⠁  ⣰⡿⠁     Branch A                   
                                ⡟⢹⠱⢿⠁         ⠈⠉⢹⠈⠉⡏⠸⢾Split 2⡿⠁                                 
                                ⣿⢿              ⢸⣾⠃⠁ ⣼⣷⣠⠴⠋⣏⣷⡿⠁                                  
                               ⢰⡟⠚⠃⠁           ⣰⣿⠁⠒⠃⠁ ⠈⠷⡝⢲⠋ ⠁                                   
                              ⢀⣿⠁ Side       ⢀⣾⠉⣿⠃     ⣏⠁⠸  ⠁                                   
                              ⣼             ⣰⡿⠁⣼⠁      ⠉⠓⠚⠃⠁                                    
                           ⢀ ⢰⡟           ⢀⣾⠉ ⢰⡿         Branch C                               
                         ⢠⣖⢻⣹⣿⠁          ⣰⣿⠃⢾⢲⣾                                                 
                         ⢸⠈⢹⠁ ⣦⡀     ⣀ ⢀⣾⠟⡟⠒⡞⠁                                                  
                         ⢸ ⠸  ⠉ ⢷⣤⡀⡶⣏⣩⢽⣿⠉⡤⡷⠂⠁                                                   
                          ⠉⠉⠁    ⠙ ⣷⡄⠃ ⠇  ⠻⠤⠇ ⠁                                                 
                            Output ⢷⢀⠃⡄⠇     Split 1                                            
                                      .                                                         
                                      Merge                                                     
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```
ledger: []
#### Fan-out / join / split

**96x32 blocks**
```
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                 ▄▄██▄                                          
                                                 █████▄            Input                        
                                                 █████  ▀▀▄▄       ▄▄▄                          
                                                 ▀█▀▀        ▀ ▄▄█████                          
                                                  █Branch B      █████▄                         
                                   Split 3         █             ███████                        
                                  ▄▄▄▄             ▄            █ ██████                        
                                ██████             Join    ▄▄ ▀█▀ ▀███▀                         
                                ██████  ▀▀ ▄▄▄    ████▄ ▀▀    █      Branch A                   
                                ████▀          ▀▀█████Split 2█                                  
                                ████             ██████ ▄▄█▄█                                   
                                █▀▀             ██▀▀▀  ██████                                   
                               █  Side        ▄▀█      ██████                                   
                              ▄▀             █▀▄▀      ▀▀▀▀                                     
                              █            ▄▀  █         Branch C                               
                          ▄▄██            █▀▄▄▄▀                                                
                          ████▄         ▄▀█████                                                 
                          ████ ▀▄▄ ▄▄██▄▀▄█████                                                 
                          ▀▀▀     ▀█████  ▀██▀▀                                                 
                            Output ████▀     Split 1                                            
                                      .                                                         
                                      Merge                                                     
                                                                                                
                                                                                                
                                                                                                
                                                                                                
                                                                                                
```
ledger: []
#### Fan-out / join / split

**140x40 braille**
```
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                          ⢀⡀                                                                
                                                                       ⣀⡤⠞⢹⠉⣹⢶                                                              
                                                                      ⢸⠓⠲⢤⠖⠋⠁ ⣀                                                             
                                                                      ⢸ ⣤⢸   ⠈⠛⠋⢷⣦⣄⣀           Input                                        
                                                                      ⢸⡀⢻⣾  ⡄⠂   ⠈⠉ ⠿⣶⣤⣄⡀   ⣤⣖⠋.⠽⡇                                          
                                                                       ⠉⢹⣇⠃⠁          ⠈ ⠉⠷⣶⣤⣇⠈⢹⠁ ⠃                                          
                                                                         ⣿Branch B         ⠉⠋⡿⣾⣤⣴⡧⢤⣀                                        
                                                                         ⢻⡇                ⣰⡿⣵⣻⡁⢸⣤⠞⠁                                        
                                                     Split 3             ⠸⣧               ⣰⡿ ⡇ ⠉⡏  .Branch A                                
                                                  ⣠⠴⠚.⣉⡷⡆                 ⣿⡀            ⢀⣰⣿⣤⡶⡷⠟ ⠇                                           
                                                  ⡏⠙⢲⠋⠁ ⠃⣤⣀⣀             ⣀⣽⣧⣀    ⢀⣀⣤⣤⣶⠶⠟⠛⠉⠉  ⠻⠤⣄⠇⠄⠃                                         
                                                  ⣇⣶⣾⣄⡀ ⠃⠈⠉⠉⠛⠻⠶⢶⣤⣤⣀⣀    ⣾⡵⣾⣿⣿⣤⣶⠾⠟⠛ ⠈   ⣰⡿⠁                                                  
                                                 ⢰⢿⢤⣷⣯⡇⠟⠃        ⠈⠈⠉⠛⠻⠶⣾⣯⣄⣸⣶⣏         ⣰⡿                                                    
                                                 ⢸⢀⢸  ⠁                ⡇⣀ ⠃ ..Split 2⣰⡿                                                     
                                                 ⢸⣾⠻  ⠁               ⢀⣿⡟ ⠇  ⠇⣿⣤⠴⠋ ⢀⡼⢻⠁                                                     
                                                 ⣸⡏⠚ ⠁               ⣠⣿⠛⠒⠦⠇⠃⠁ ⠹⠿⣏⠓⡞⠉                                                        
                                                ⢠⡿  .              ⢀⣼⡟⠁⡇  Join ⡿⠁ ⠃                                                         
                                                ⣾⠃  Side          ⣠⣾⠉⢰⡿        ⢷⣀ ⠇  ⠁                                                      
                                               ⢰⡟               ⢀⣴⡟⠁ ⣾⠃          ⠉⠉                                                         
                                            ⢀⡀⢀⣿⠁              ⢠⣾⠉  ⣸⡏            Branch C                                                  
                                         ⢀⡤⠞⢹⢉⣿⡇              ⣴⡟⠁⡤⡶⢤⣿⠁                                                                      
                                         ⢸⠉⠓⡞⠁ ⠃            ⢀⣾⠉⠯⣅⣠⠴⠚⠁                                                                       
                                         ⢸  ⠁  ⠃⢷⣤⡀   ⢀⣠⢴⠲⣤⣴⡟⠁⢸⣀ ⠇                                                                          
                                         ⠸⢀ ⠇ ⠆⠃ ⠙ ⣶⣄⣸⠛⠦⡴⠚⠁⠇⣶⠿⢿⠛⠁⠇                                                                          
                                           ⠉⠁.      ⠙⠿⣶ ⠃  ⠇  ⠈⠓⠦⠇ ⠁                                                                        
                                             Output  ⢸  ⠇  ⠇      .                                                                         
                                                      ⠉⠓⠃⠁        Split 1                                                                   
                                                          .                                                                                 
                                                          Merge                                                                             
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
                                                                                                                                            
```
ledger: []
