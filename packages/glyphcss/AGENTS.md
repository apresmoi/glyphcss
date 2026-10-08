# glyphcss — package agent guide

Vanilla renderer: the ASCII rasteriser, scene/mesh/effect/hotspot/object APIs, cameras and controls, custom elements, the 2D cell canvas, and `compileScene`. Repo-wide rules live in the root `AGENTS.md`; the why behind each mechanism lives in comments beside the code.

## Model

One render pass walks all meshes in scene order, projects through the camera, fills a `cols × rows` grid (per-cell depth test, glyph by mode) and writes ONE string per `<pre>`: the base `<pre>` plus one write and one `transform` per detail layer. Hooks, effects and object overlays run inside that pass. Hotspots update with one inline-style assignment each; controls mutate one camera state object.

## Invariants

- No cell-by-cell patching, no double writes, no per-polygon DOM.
- No hook, effect, object overlay, shadow or detail layer mounted: output byte-identical and nothing extra allocated.
- Hook order: effects → object overlays → `transformCells` (always last). A scene render always passes the hook its `GlyphTransformCellsLayer`; the hook must still tolerate `undefined`.
- `CellGrid.occluded` rides across effects (cloned into the retained snapshot, carried onto the composed grid); allocated only when a shared id-map and a hook both exist.
- The occlusion id-map raster uses the paint rasterizer's own conventions: integer `(col,row)` samples with the exact-sign inside test, `area2 > 0` back-face cull when single-sided, `project()[3] ?? [2]` depth, near-plane clip via `eyeDepth`, skips `Polygon.hidden`, same cull runs per group.
- Ownership compares two surfaces at the SAME point; `density` must never change who occludes whom.
- A `detailGroup` never separates a mesh by itself; members must agree on layer options or throw `RangeError`.
- A mesh-set effect target is immutable after mount (`setOptions` throws; remove and re-add). Mesh targeting is solid-only and inactive elsewhere, never a throw.
- `program`/`colorProgram` are opaque, validated once at mount, immutable. glyphcss never imports `@glyphcss/effects`.
- `composeGlyphEffects`: an unavailable hard requirement throws `GLYPH_EFFECT_REQUIREMENT_UNAVAILABLE`; optional/dynamic requirements degrade.
- Shadows: caster set is the scene's, one map shared across passes; `hidden` polygons cast nothing and leave the light volume; acne guard is internal and slope-scaled.
- `Polygon.shadingNormal` changes shading and `CellGrid.normal` only; visibility, depth, shadows and id-map read geometry.
- halfblock/quadrant with a hook: override only cells the hook wrote (pre/post diff); the no-hook fast path stays untouched.
- Wireframe `charMode: "braille"`/`"quadrant"`/`"halfblock"` all rasterize edges DIRECTLY at a sub-cell resolution (never folded down from a finer mask — folding over-inks) via one data table (`WIREFRAME_SUBCELL_CONFIGS`), never a branch per charMode name; single colour per cell, so `transformCells`/`captureCells`/`hiddenLines`/`colorEncoding` all work exactly as plain wireframe's do. `"halfblock"`/`"quadrant"` ALSO have a separate, unrelated solid-mode two-colour-per-cell encoding — the two never share code or eligibility rules.
- Label arbiter hides a label whole if any of its cells is foreign-won or `occluded`.
- Canvas painters validate colours as canonical lowercase `#rrggbb` at write time and refuse `occluded`/`textFiller` cells; `resolveJunctions()` is idempotent; tiers are data tables, never branches on tier name.
- `compileScene` is byte-identical to the runtime render; its `grid` is `null` for SOLID-mode halfblock/quadrant only (wireframe's single-colour sub-cell charModes always get a real grid); detail-layer options on object members throw; `objects` with semantic output throws.
- `interactiveDownscale` divides `cols`/`rows` in place during a gesture; DOM-overlay consumers read `getBaseResolution()`.
- Render-path cost reductions (cull runs, vertex index, memoization, depth before texture) must stay byte-identical; alpha rejection stays ahead of the depth write.
- `atlas` encoding falls back to spans as a whole-scene decision; `fontAtlas` is fixed at creation; `dense` stays printable ASCII.
- Public API changes land in `@glyphcss/react` and `@glyphcss/vue` in the same PR; data-shaped element options are JS properties.

## Don't

- Don't build the shadow map from one pass's polygons: casters are scene-wide, or a mesh that separates for `density`/`mode`/`glyphPalette` silently stops casting and receiving.
- Don't expect a `transformCells` stamp to receive shadows: the shadow term is consumed inside `scanFillTriangle`, and `CellGrid.shade` is only the light term.
- Don't write a polygon loop that ignores `Polygon.hidden`, the single-sided back-face verdict or near-plane clipping: the id-map once did, and a claim by a polygon that paints nothing blanks other layers.
- Don't compare occlusion depths taken at different screen points (a gradient allowance, a nearest-in-cell verdict): both made `density` change who occludes. Walk the owner's plane to the asking cell.
- Don't mix `project()[2]` (linear `cssZ`) with `[3] ?? [2]` (z-buffer): equal under ortho, different units under perspective. `CellGrid.depth`, the id-map and overlay depth use the z-buffer; only the wireframe hidden-line prepass uses `[2]`.
- Don't drop `occluded` or the `GlyphTransformCellsLayer` argument on the retained-effect path: either one silently broke ownership and stroke placement for every scene with an effect mounted.
- Don't fix a seam between abutting detail meshes with an occlusion tolerance: give them one `detailGroup`. Don't group surfaces built at different mesh resolutions either; one depth buffer reads as speckle.
- Don't make a render-path optimisation reorder polygons (`depthEpsilon` breaks coplanar ties by draw order) or change which triangle reaches `litCache` first. The latter moves colours but no glyphs, so diff colours too.
- Don't pin the atlas `font-family` from the option: pin it from the encoding the frame produced. The atlas cmap covers `U+0020`, so a spans frame under the pin mixes two advances.
- Don't add fields to `CellGrid` for the canvas: `bg`, `sub` and the text-scale buffers stay canvas-owned, so the rasterizer's encoders stay byte-identical.
- Don't let `encodeGlyphCanvasHtml` delegate to the atlas encoder without returning the palette and encoding: PUA text without its palette cannot be decoded.
- Don't join canvas edges on shared node ids or mask shape: only route coincidence is a local answer.

## Key gates

- Occlusion: `rasterize.occlusionSeam`, `rasterize.occlusionPerspective`, `rasterize.occlusionHidden`, `rasterize.occlusionCullChunks`, `createGlyphScene.foreignOcclusion`, `createGlyphScene.detailGroup`.
- Encoders: `rasterize.halfblock`, `rasterize.quadrant`, `rasterize.braille`, `rasterize.wireframeSubcell`, `colorEncoding.*`, `colorTolerance`.
- Effects: `createGlyphScene.effects`, `createGlyphScene.targeting`, `composeGlyphEffects`, `effectCompositor`.
- Scene: `shadow`, `shadow.hidden`, `rasterize.shadingNormal`, `textureWrap`, `rasterize.nearClipTexture`, `createGlyphScene.sceneObject`, `labelArbiter`, `styles.hotspotSelect`, `createGlyphOrbitControls`.
- Canvas: `text`, `subcell`, `junctions`, `tiers`, `glyphInk`, `sampler`.
- Static and perf: `compileScene`, `rasterize.cullChunks`, `rasterize.backfaceChunks`, `vertexIndex`, `rasterize.fillBounds`, `rasterize.depthBeforeTexture`, `createGlyphScene.baseResolution`.
