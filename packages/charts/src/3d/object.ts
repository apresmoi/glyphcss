/**
 * `glyphChartObject` — turns a `GlyphChart3dMark` into a mounted
 * `GlyphSceneObject` (PLAN-3d.md §3.1, §5 "Axes and box"/"Labels"):
 * the surface mesh (`gridSurfacePolygons`, coloured by the area-median band
 * of the FULL-resolution grid a decimated quad stands in for) plus a 3D
 * axis box, ticks, and tick labels as overlays through the shared
 * registry/arbiter (`scene.addObject` — AGENTS.md's "Scene objects").
 *
 * `objectPosition` is DATA SPACE (contract 8): every axis is mapped from
 * its own resolved domain onto `[0, aspect[axis]]` by ONE affine function,
 * so a mesh vertex's object-space coordinate is a monotone, linear image
 * of the underlying data value on that axis — never a re-derived or
 * re-scaled quantity an effect would have to invert.
 */
import { gridSurfacePolygons, surfaceMedianOfBlock, createSurfaceMedianScratch } from "glyphcss";
import { stampGlyphOverlayCell, stampGlyphOverlayLine, encodeGlyphSceneObjectSamplerKey } from "glyphcss";
import type { GlyphCamera, GlyphSceneObject, GlyphSceneOverlay, Polygon, TextureSampler, Vec3 } from "glyphcss";
import { glyphChart3dBandColor, glyphChart3dBandIndex } from "./colorscale";
import type { GlyphChart3dMark, GlyphChart3dObjectOptions, GlyphChart3dResolvedAxis, GlyphChart3dSurfaceMark } from "./types";
import type { GlyphChartCharset } from "../types";

/**
 * `shading: "value"` (PLAN-3d.md §5 "Lighting vs value", C1's own doc: "a
 * C2/rendering-layer concern"). Under `relief`, glyph SHAPE (Lambert
 * intensity) reads the face's own SLOPE — a flat monochrome surface then
 * shades uniformly and carries no per-cell information at all. `value`
 * instead makes glyph shape a function of the surface's own Z, the same
 * "monochrome identity rides on the glyph" discipline 2D's `regionFill`
 * texture path follows: a per-quad UV samples a 1D grey-ramp lookup texture
 * (`glyphInkStripTexture3d`, `bands` texels wide, luminance strictly
 * increasing left to right) whose LUMINANCE multiplies into the cell's own
 * intensity, so higher z always reads denser ink — monotone regardless of
 * the render's own light or colour. The texture is procedural (`glyphcss`'s
 * `scene.setTextureSamplers`/`RasterizeContextOptions.textureSamplers`
 * accept decoded pixels directly, "Per-cell textures", AGENTS.md's
 * "Rendering model" — no fetch, no canvas).
 */
export const GLYPH_CHART_3D_VALUE_STRIP_TEXTURE_KEY = "glyph-chart3d-value-strip";
const VALUE_STRIP_TEXELS = 64;

function buildValueStripTexture(): TextureSampler {
  const data = new Uint8ClampedArray(VALUE_STRIP_TEXELS * 4);
  for (let i = 0; i < VALUE_STRIP_TEXELS; i++) {
    const level = Math.round((i / (VALUE_STRIP_TEXELS - 1)) * 255);
    data[i * 4 + 0] = level;
    data[i * 4 + 1] = level;
    data[i * 4 + 2] = level;
    data[i * 4 + 3] = 255;
  }
  return { width: VALUE_STRIP_TEXELS, height: 1, data, lowDetail: false };
}

/**
 * Authors `texture`/`uvs` on every triangle so its glyph density reads its
 * OWN z-band, using the triangle's own vertex-average object-space z (which
 * is already `aspect[2]`-scaled, so `t = avgZ / aspect[2]` needs no domain
 * lookup) rather than re-deriving the area-median block statistic the
 * colour callback computes — the two agree closely within one quad (three
 * corners sharing the block's own extent) and a per-vertex UV needs no
 * correlation back to `gridSurfacePolygons`' internal block indexing.
 *
 * `p.texture` must carry the NAMESPACED sampler key
 * (`encodeGlyphSceneObjectSamplerKey(objectId, name)`), not the bare
 * `GLYPH_CHART_3D_VALUE_STRIP_TEXTURE_KEY` name: `scene.addObject`/
 * `compileScene({objects})` namespace an object's OWN `textureSamplers`
 * entries under that key when they merge them into the scene's resolved
 * sampler map (AGENTS.md's "Scene objects" contract 9), but they never
 * rewrite a polygon's own `texture` field to match — a mesh polygon is
 * mounted verbatim (`createGlyphScene.ts`'s `mountGlyphSceneObjectInto`
 * calls `add(spec.polygons, ...)` with no texture-key translation). Every
 * raw (unnamespaced) `p.texture` therefore looks up a key the scene's
 * sampler map never has, and the whole surface collapses to the ramp's own
 * `u=0` (or `u=NaN`) glyph — fix round 1's P1-1: `renderGlyphChart3d`'s
 * hand-rolled renderer used the SAME raw key on both sides (the sampler
 * map lookup and the polygon-authored key), which is why it never showed
 * the bug a real `compileScene({objects})`/`scene.addObject` mount does.
 */
function applyValueShadingTexture(polygons: readonly Polygon[], aspect: readonly [number, number, number], bands: number, textureKey: string): void {
  const zExtent = aspect[2] || 1;
  for (const p of polygons) {
    const avgZ = p.vertices.reduce((sum, v) => sum + v[2], 0) / p.vertices.length;
    const t = Math.max(0, Math.min(1, avgZ / zExtent));
    const bandIdx = glyphChart3dBandIndex(t, bands);
    const u = bands <= 1 ? 0.5 : (bandIdx + 0.5) / bands;
    p.texture = textureKey;
    p.uvs = [[u, 0.5], [u, 0.5], [u, 0.5]];
  }
}

/** How far outward (as a fraction of that axis's own box extent) a tick label / axis title is pushed past the box edge. */
const TICK_LABEL_MARGIN = 0.15;
/**
 * Fix round 3, Item 3 ("just beyond its own tick labels" / "never over the
 * surface"). Round 2 pushed this to 0.38 (from an original 0.3) to clear an
 * edge-on-axis tick/title collision found in the round-1 rotation sweep at
 * a near-90-degree pitch — a symptom of round 2's OWN near-edge-on default
 * camera (`camera.ts`'s `rotX: 87`, since corrected to `58`), not a
 * property of the title placement itself.
 *
 * Round 3 tried the literal "just beyond ticks" reading first — 0.2, barely
 * past `TICK_LABEL_MARGIN`'s own 0.12 — once the title candidate ALSO got a
 * genuine depth test against the surface (`labelArbiter.ts`'s
 * `occlusionDepth`, below): a title that close to the box is legitimately,
 * not incidentally, behind a tall/steep surface at many camera angles, and
 * every value from 0.2 up to ~0.5 left at least one of the pre-existing
 * round-1/round-2 rotation-sweep gates (`render.test.ts`) losing more than
 * one of three titles to genuine occlusion. 0.6 is the smallest value
 * measured to clear ALL of them (the full sweep, `object.test.ts`'s own
 * guides gates, and the round-2 "byte-identical" camera-parity fixture)
 * while its own box-share cost is honestly re-floored rather than papered
 * over (`render.test.ts`'s own "byte-identical PLOT REGION" test, whose
 * `shading: "value"` + colorbar fixture measures ~0.13 at this margin,
 * documented there). This is FARTHER than "just beyond ticks" literally
 * asks for, and is recorded here as the actual, measured trade-off: a
 * uniform outward push is the only lever `outwardPoint` gives this overlay,
 * and a real depth test makes a close title genuinely fragile against a
 * tall surface — `docs/design/charts3d.md`'s "C2 fix round 3" carries the
 * full sweep.
 */
const AXIS_TITLE_MARGIN = 0.6;
/**
 * Priorities (fix round 2's "axes in one corner" redesign): endpoints
 * outrank the title, which outranks an interior tick — the user's own
 * explicit ordering ("endpoints > title > interior ticks"), a change from
 * C1's original "title always outranks every tick" rule.
 */
const PRIORITY_TICK_EXTREME = 900;
const PRIORITY_TITLE = 800;
const PRIORITY_TICK_ZERO = 600;
const PRIORITY_TICK_INTERIOR = 400;

type Bit = 0 | 1;
type Corner = readonly [Bit, Bit, Bit];
const CORNERS: readonly Corner[] = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
];
type Edge = readonly [Corner, Corner];
const BOX_EDGES: readonly Edge[] = (() => {
  const edges: Edge[] = [];
  for (let i = 0; i < CORNERS.length; i++) {
    for (let j = i + 1; j < CORNERS.length; j++) {
      const a = CORNERS[i]!, b = CORNERS[j]!;
      const diffs = (a[0] !== b[0] ? 1 : 0) + (a[1] !== b[1] ? 1 : 0) + (a[2] !== b[2] ? 1 : 0);
      if (diffs === 1) edges.push([a, b]);
    }
  }
  return edges;
})();

function cornerPoint(c: Corner, ext: readonly [number, number, number]): Vec3 {
  return [c[0] ? ext[0]! : 0, c[1] ? ext[1]! : 0, c[2] ? ext[2]! : 0];
}

/**
 * The minimal shape `projectObjectPoint`/`nearestEdge` actually need — a
 * `GlyphOverlayFrame` (the real render/stamp path) satisfies this
 * structurally, so both it and a bare `{ camera, cols, rows, cellAspect,
 * toWorld }` probe (`glyphChart3dLabelAnchors`' own reference camera, no
 * grid/scene/arbiter involved) can share this exact geometry.
 */
interface Projector {
  readonly camera: GlyphCamera;
  readonly cols: number;
  readonly rows: number;
  readonly cellAspect: number;
  readonly toWorld: (p: Vec3) => Vec3;
}

interface Projected { readonly col: number; readonly row: number; readonly depth: number; }
function projectObjectPoint(frame: Projector, p: Vec3): Projected {
  const world = frame.toWorld(p);
  const result = frame.camera.project(world, frame.cols, frame.rows, frame.cellAspect);
  const depth = result[3] ?? result[2];
  return { col: Math.round(result[0]), row: Math.round(result[1]), depth };
}

/** A straight box edge needs exactly one glyph for its whole run — the direction never changes along it. */
function edgeGlyph(from: Projected, to: Projected): string {
  const dc = to.col - from.col, dr = to.row - from.row;
  if (dc === 0 && dr === 0) return "·"; // ·
  if (dc === 0) return "│"; // │
  if (dr === 0) return "─"; // ─
  return (dc > 0) === (dr > 0) ? "\\" : "/";
}

/**
 * Fix round 3, Item 2 ("gridlines are a cage"): a guide-plane gridline
 * reuses `edgeGlyph`'s SAME full-weight box-drawing glyphs as the axis
 * lines it shares a colour palette with, so at full weight it reads as a
 * second cage of `│`/`─` strokes across the whole plot — indistinguishable
 * from the axis frame itself at a glance, the coordinator's own complaint.
 * This mirrors the 2D chart's own faint `axes.{x,y}.grid` glyph choice
 * (AGENTS.md's "Axes": `┈`/`┊` on box, `.` on ascii) in SPIRIT, though not
 * literally on `ascii` (see that branch's own doc: `.`/`:` collide with
 * this renderer's `SOLID_RAMP`, which the 2D canvas painter never uses) —
 * a DIFFERENT glyph family per tier from `edgeGlyph`'s solid line-drawing set,
 * never merely a dimmer colour on the same glyphs, so a reader can tell
 * "this is structure" from "this is a guide" without colour at all
 * (`NO_COLOR`/monochrome terminals included). `braille` has no light
 * line-art glyph of its own (it already renders the whole scene as a real
 * depth-tested wireframe of BRAILLE DOTS, `render.ts`'s own
 * `resolveGlyphChart3dStyle`), so a single sparse dot (`⠂`, the low-left
 * dot only — visually the lightest single-dot braille glyph) stands in for
 * "faint line" there instead of a 2-glyph directional pair.
 */
function gridEdgeGlyph(from: Projected, to: Projected, charset: GlyphChartCharset): string {
  if (charset === "braille") return "⠂";
  if (charset === "ascii") {
    // NOT the 2D chart's own literal `.`/`:` pair (AGENTS.md's "Axes"): a
    // 3D chart's surface renders through `compileScene`'s solid MESH path,
    // whose glyph-by-intensity ramp IS `glyphcss`'s `SOLID_RAMP`
    // (`" .:-=+*#%@"`) — `.`/`:` are real, low-but-nonzero SURFACE shading
    // levels there, not free glyphs the way they are in the 2D canvas
    // painter's own, unrelated shading ramps. Reusing them would make a
    // grid line visually indistinguishable from a faintly-lit patch of the
    // surface itself under `ascii` — exactly the "cage vs. structure"
    // ambiguity Item 2 exists to remove. `,` is printable ASCII, outside
    // `SOLID_RAMP` entirely, and reads as a light mark.
    return ",";
  }
  // "box" (a caller passing `charset: "blocks"` here gets treated as `box`
  // too — `renderGlyphChart3d` itself never does, since its own
  // `chromeTier` already downgrades `blocks` to `ascii` before it reaches
  // `glyphChartObject`, AGENTS.md's own C2 doc: "blocks renders byte-
  // identical to ascii" — so this branch is `box`'s in practice).
  const dc = to.col - from.col, dr = to.row - from.row;
  if (dc === 0 && dr === 0) return "·";
  if (dc === 0) return "┊";
  if (dr === 0) return "┈";
  return "·"; // no faint diagonal box-drawing glyph exists; a dot reads as "guide", not "structure".
}

/**
 * The single shared corner the x/y/z axis triad meets at (fix round 2's
 * "axes in one corner" redesign, matplotlib/MATLAB's own convention) —
 * REPLACES C1's per-axis "nearest of 4 parallel edges" rule, which let each
 * axis independently jump to a different box edge and scattered ticks/
 * titles around the whole box.
 *
 * `"auto"`: for EACH axis independently, pick whichever of its two
 * PERPENDICULAR faces is FARTHER from the camera (smaller projected depth
 * at the face's own centre) — the "put the guide wall behind the data"
 * rule the user asked for verbatim: each of the 3 resulting faces (the
 * "guide walls" `planeGridLines`/`classifyEdges` below read off this SAME
 * corner) is, by construction, the back one of its own opposing pair, so
 * together they sit behind the surface from the camera's own side, exactly
 * like a 2D chart's plot rect sits in front of its own axis lines. A pure
 * function of camera ROTATION only (depth ordering is zoom/center-invariant
 * for an orthographic camera) — never a stored, mutated "last corner", so
 * it never needs to reconcile with a different frame's own state; it is
 * naturally STABLE except at genuine silhouette transitions (a rotation
 * angle where a face pair's depths cross), never spuriously flickering
 * near one, because the underlying depth comparison has no dead zone.
 *
 * An explicit `[bx, by, bz]` (this file's own `Bit` convention: 0 = the
 * face at that axis's own 0 coordinate, 1 = the face at `ext[axis]`) pins a
 * fixed layout regardless of rotation.
 */
function resolveSharedCorner(ext: readonly [number, number, number], frame: Projector, cornerOption: "auto" | readonly [Bit, Bit, Bit]): Corner {
  if (cornerOption !== "auto") return cornerOption;
  const bit = (axis: 0 | 1 | 2): Bit => {
    const faceCenter = (b: Bit): Vec3 => {
      const p: [number, number, number] = [ext[0] / 2, ext[1] / 2, ext[2] / 2];
      p[axis] = b ? ext[axis] : 0;
      return p;
    };
    const d0 = projectObjectPoint(frame, faceCenter(0)).depth;
    const d1 = projectObjectPoint(frame, faceCenter(1)).depth;
    return d0 <= d1 ? 0 : 1; // farther (smaller depth) face wins; a tie favours 0, stably
  };
  return [bit(0), bit(1), bit(2)];
}

/**
 * USER FEEDBACK (round 6): "for the 3d charts I still cannot see the axes
 * for the munga whau nor the alps" — reproduced directly on both real
 * datasets at the library default camera. `resolveSharedCorner`'s own
 * "farther face wins" rule (above) is right for the guide WALLS/GRID, which
 * exist to sit BEHIND the data as a backdrop, but a fully opaque solid
 * surface routinely occludes that SAME far corner entirely, and putting the
 * axis TRIAD there too hid it completely: only two short edge stubs and a
 * column of z tick labels survived — the reported defect.
 *
 * The x/y axis lines now sit on the FRONT floor edges instead — the two
 * bottom (z=0) edges meeting at whichever of the 4 base corners is NEAREST
 * the camera (largest projected depth). A floor edge at z=0 is, for any
 * camera looking down at positive-height data, always at least as near the
 * camera as the surface point directly above it, so it reads correctly as
 * the FRAME the data sits inside — the 2D chart's own plot-rect convention,
 * extended by one dimension, rather than round 2's "guide plane behind the
 * data" rule (which is still right for `guides.walls`/`guides.grid`, and is
 * untouched — see `resolveSharedCorner` above).
 */
function resolveFrontFloorCorner(ext: readonly [number, number, number], frame: Projector): readonly [Bit, Bit] {
  let best: [Bit, Bit] = [0, 0];
  let bestDepth = -Infinity;
  for (const bx of [0, 1] as const) {
    for (const by of [0, 1] as const) {
      const d = projectObjectPoint(frame, [bx ? ext[0] : 0, by ? ext[1] : 0, 0]).depth;
      if (d > bestDepth) { bestDepth = d; best = [bx, by]; }
    }
  }
  return best;
}

/**
 * The z (vertical) axis edge is resolved INDEPENDENTLY of the front floor
 * corner above — the reported case had that same corner's own vertical edge
 * behind the surface too at the library default camera, so pinning z to the
 * x/y corner does not, in general, fix z's own visibility. Instead: the
 * SILHOUETTE vertical — whichever of the 4 possible corner verticals
 * projects furthest to one screen side (leftmost, for a stable, deterministic
 * pick) — always stands clear of the data, since nothing in the mesh can
 * project further left than the box's own leftmost edge. Comparing screen
 * COLUMN (not depth) is still a pure function of camera ROTATION alone for
 * an orthographic camera: `zoom` only scales the column delta between two
 * candidates (never flips its sign) and `center` shifts every candidate by
 * the same constant, so the ORDERING used here is `cols`/`rows`/`zoom`/
 * `center`-invariant exactly like `resolveSharedCorner`'s own depth
 * comparison is — no stored "last corner" state, naturally stable except at
 * a genuine silhouette transition.
 */
function resolveSilhouetteVerticalCorner(ext: readonly [number, number, number], frame: Projector): readonly [Bit, Bit] {
  let best: [Bit, Bit] = [0, 0];
  let bestCol = Infinity;
  for (const bx of [0, 1] as const) {
    for (const by of [0, 1] as const) {
      const col = projectObjectPoint(frame, [bx ? ext[0] : 0, by ? ext[1] : 0, 0]).col;
      if (col < bestCol) { bestCol = col; best = [bx, by]; }
    }
  }
  return best;
}

/**
 * The two corners the axis TRIAD (lines/ticks/labels/titles) itself reads —
 * `xy` for the x and y axes (which legitimately share one corner: the front
 * floor corner), `z` for the z axis (independently resolved for visibility,
 * per `resolveSilhouetteVerticalCorner`'s own doc). An explicit
 * `axes.corner` override still pins ALL THREE to the SAME given corner
 * (unchanged from before this round) — only `"auto"` resolution drops
 * strict single-corner sharing, and only because enforcing it can hide an
 * axis outright (the reported defect). `guides.walls`/`guides.box`/
 * `guides.grid`/`floorGrid` are UNTOUCHED by this — they keep reading
 * `resolveSharedCorner`'s own single far corner, since they are meant to sit
 * behind the data as a backdrop, a different design goal from the triad's
 * own "frame the data, stay visible" one.
 */
function resolveAxisTriadCorners(ext: readonly [number, number, number], frame: Projector, cornerOption: "auto" | Corner): { readonly xy: Corner; readonly z: Corner } {
  if (cornerOption !== "auto") return { xy: cornerOption, z: cornerOption };
  const [fx, fy] = resolveFrontFloorCorner(ext, frame);
  const [zx, zy] = resolveSilhouetteVerticalCorner(ext, frame);
  return { xy: [fx, fy, 0], z: [zx, zy, 0] };
}

function flipCorner(corner: Corner, axis: 0 | 1 | 2): Corner {
  const out: [Bit, Bit, Bit] = [corner[0], corner[1], corner[2]];
  out[axis] = corner[axis] ? 0 : 1;
  return out;
}

function cornersEqual(a: Corner, b: Corner): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * Splits the 12 box edges by their relation to `corner`: the 3 edges
 * TOUCHING it (`axisLines` — the triad itself), the 6 remaining edges that
 * bound one of the 3 "guide plane" faces meeting at `corner` (`wallOutline`
 * — `guides.walls`), and the 3 edges left over, on neither (`boxOnly` —
 * `guides.box`, "the remaining far/near box edges completing the block").
 */
function classifyEdges(corner: Corner): { readonly axisLines: readonly Edge[]; readonly wallOutline: readonly Edge[]; readonly boxOnly: readonly Edge[] } {
  const axisLines: Edge[] = [], wallOutline: Edge[] = [], boxOnly: Edge[] = [];
  for (const edge of BOX_EDGES) {
    const [a, b] = edge;
    if (cornersEqual(a, corner) || cornersEqual(b, corner)) { axisLines.push(edge); continue; }
    // An edge lies on one of the 3 guide planes iff it doesn't vary along
    // SOME axis k, and its fixed bit on that axis matches the corner's own.
    const onGuidePlane = a[0] === b[0] && a[0] === corner[0]
      || a[1] === b[1] && a[1] === corner[1]
      || a[2] === b[2] && a[2] === corner[2];
    (onGuidePlane ? wallOutline : boxOnly).push(edge);
  }
  return { axisLines, wallOutline, boxOnly };
}

/**
 * Outward push-out point for a tick/title on `axis`'s triad edge, at
 * parameter `t` along it. The edge touching `corner` always spans the
 * FULL `[0, ext[axis]]` range on its own axis regardless of `corner[axis]`
 * (the two corners it connects differ only in the axis's OWN bit), so the
 * axis's own coordinate is `t * ext[axis]` — data-consistent with the
 * mesh's own vertex position, unflipped. The other two axes push away from
 * the box using the shared corner's OWN fixed bits (0 -> push negative, 1
 * -> push positive) — identical for every axis, since they all share the
 * SAME corner.
 */
function outwardPoint(axis: 0 | 1 | 2, corner: Corner, t: number, ext: readonly [number, number, number], margin: number): Vec3 {
  const p: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const axisK = k as 0 | 1 | 2;
    if (axisK === axis) { p[k] = t * ext[axis]; continue; }
    const bit = corner[axisK];
    const push = margin * ext[axisK];
    p[k] = bit ? ext[axisK] + push : -push;
  }
  return p;
}

/**
 * Fix round 5, Item 2: caps how many of an axis's own TICKS become a grid
 * line on a guide plane, independent of how many tick MARKS/labels that
 * axis itself shows — a "few faint guide lines, like matplotlib panes"
 * (the coordinator's own wording) means fewer lines than the axis's own
 * tick count, not merely fainter glyphs on the same count (which round 3's
 * own `gridEdgeGlyph` fix already did, and the coordinator's round-5
 * report shows was not enough on its own). Always keeps the FIRST and LAST
 * tick (the plane's own two edges, so a capped grid never loses its own
 * outer bound) and evenly subsamples the interior — never a blind
 * `ticks.slice(0, max)`, which would bunch every kept line at one end. At
 * the library default of `2` this reduces to just the plane's own two
 * boundary lines per sweep axis (its own outline, through the SAME faint
 * `gridEdgeGlyph` family and depth test as an interior line would use) —
 * `guides.grid`/`floorGrid` default OFF now (this file's own `types.ts`
 * doc), so this cap is a SAFETY NET for a caller who opts back in, sized
 * to the coordinator's own explicit regression gate (grid ink <= 15% of
 * the plot's own bounding box, `object.test.ts`), not a claim that 2 lines
 * is the ideal look for every fixture.
 */
const GRID_MAX_LINES_PER_SWEEP_AXIS = 1;
/**
 * P1-2 (codex review, round 6): the plane's own first/last tick IS the plane
 * BOUNDARY — an edge every wall/box/axis-line write already owns (whichever
 * of those is on, `edgeGlyph`'s own strong glyph) — so a grid line at that
 * SAME position is a coincident, fainter duplicate of an edge some OTHER
 * write already drew, which used to repaint a real axis-line cell with the
 * grid's own weaker glyph (measured: a flat 8x8 surface's `grid` toggle
 * added 0 cells and downgraded 2 axis-line cells to `┈`). Grid lines now
 * sweep INTERIOR tick positions only — `ticks.slice(1, -1)` — so a plane
 * with only its own two boundary ticks (no interior tick at all) draws NO
 * grid line for that sweep axis, which is correct: there is nothing left to
 * show once the boundary is excluded.
 */
function subsampleTicksForGrid(ticks: readonly number[], max: number): readonly number[] {
  const interior = ticks.length > 2 ? ticks.slice(1, -1) : [];
  if (interior.length === 0 || max < 1) return [];
  if (interior.length <= max) return interior;
  // `max === 1` divides by `max - 1 === 0` in the general stride formula
  // below — pick the single MIDDLE interior tick directly instead (this
  // library's own default, `GRID_MAX_LINES_PER_SWEEP_AXIS`, is exactly 1).
  if (max === 1) return [interior[Math.floor((interior.length - 1) / 2)]!];
  const out: number[] = [];
  for (let i = 0; i < max; i++) {
    const idx = Math.round((i * (interior.length - 1)) / (max - 1));
    const value = interior[idx]!;
    if (out[out.length - 1] !== value) out.push(value);
  }
  return out;
}

/**
 * Grid lines on the guide plane fixed at `fixedAxis = corner[fixedAxis]`
 * (`guides.grid`/`floorGrid`) — at up to `GRID_MAX_LINES_PER_SWEEP_AXIS`
 * ticks of EACH of the plane's other two axes (fix round 5, subsampled —
 * `subsampleTicksForGrid`'s own doc — never every tick, unlike the 2D
 * chart's own `axes.{x,y}.grid`, which this otherwise mirrors in spirit),
 * a line sweeping the plane's own full extent along the remaining axis.
 *
 * P1-2 (codex review, round 6): a WALL plane (`fixedAxis` 0 or 1) sweeps
 * ONLY its own z-tick direction (matplotlib's own wall-pane convention —
 * horizontal HEIGHT gridlines, one per z tick) rather than both in-plane
 * directions — round 5's own fix round-5-Item-1 doc's "boundary tick"
 * removal (`subsampleTicksForGrid`'s own doc) already cut density once;
 * this round's interior-only lines genuinely PAINT (round 5's boundary
 * lines mostly coincided with edges some other write already owned), so
 * sweeping BOTH wall directions measurably exceeded the coordinator's own
 * 15%-of-plot-box cap (`object.test.ts`'s own regression gate) — halving
 * wall density to one direction clears it with margin. The FLOOR plane
 * (`fixedAxis` 2, `guides.floorGrid`, opt-in) is unaffected — a ground
 * plane's own grid conventionally shows both x/y directions.
 */
function planeGridLines(fixedAxis: 0 | 1 | 2, corner: Corner, ext: readonly [number, number, number], axes: readonly [GlyphChart3dResolvedAxis, GlyphChart3dResolvedAxis, GlyphChart3dResolvedAxis]): readonly (readonly [Vec3, Vec3])[] {
  const inPlane = ([0, 1, 2] as const).filter((a) => a !== fixedAxis) as [0 | 1 | 2, 0 | 1 | 2];
  // Wall planes (fixedAxis 0/1) sweep ONLY the z direction — see this
  // function's own doc. The floor (fixedAxis 2) sweeps both in-plane axes.
  const sweepAxes: readonly (0 | 1 | 2)[] = fixedAxis === 2 ? inPlane : inPlane.filter((a) => a === 2);
  const fixedVal = corner[fixedAxis] ? ext[fixedAxis] : 0;
  const lines: (readonly [Vec3, Vec3])[] = [];
  for (const sweepAxis of sweepAxes) {
    const alongAxis = inPlane[0] === sweepAxis ? inPlane[1] : inPlane[0];
    const axisData = axes[sweepAxis];
    const [lo, hi] = axisData.domain;
    const span = hi - lo || 1;
    for (const value of subsampleTicksForGrid(axisData.ticks, GRID_MAX_LINES_PER_SWEEP_AXIS)) {
      const t = (value - lo) / span;
      const p0: [number, number, number] = [0, 0, 0], p1: [number, number, number] = [0, 0, 0];
      p0[fixedAxis] = p1[fixedAxis] = fixedVal;
      p0[sweepAxis] = p1[sweepAxis] = t * ext[sweepAxis];
      p0[alongAxis] = 0;
      p1[alongAxis] = ext[alongAxis];
      lines.push([p0, p1]);
    }
  }
  return lines;
}

const AXIS_BOX_COLOR = "#7a7f8a";
const AXIS_GRID_COLOR = "#4b5058";
const AXIS_NAMES = ["x", "y", "z"] as const;

/**
 * ONE overlay drawing everything the axis triad owns — box/wall/axis-line
 * edges, guide-plane gridlines, ticks, tick labels and axis titles — so
 * every piece resolves its corners EXACTLY ONCE per `stamp()` call.
 *
 * `wallCorner` (`resolveSharedCorner`, unchanged) governs ONLY
 * `guides.walls`/`guides.box`/`guides.grid`/`floorGrid` — the backdrop
 * geometry, meant to sit behind the data. The axis TRIAD itself (lines,
 * ticks, labels, titles) reads `resolveAxisTriadCorners`' own `xy`/`z`
 * corners instead (round 6, USER FEEDBACK — "cannot see the axes"):
 * pinning the triad to the SAME far corner as the backdrop routinely hid it
 * entirely behind a fully opaque surface.
 */
function axisTriadOverlay(mark: GlyphChart3dSurfaceMark, ext: readonly [number, number, number], color: string, charset: GlyphChartCharset): GlyphSceneOverlay {
  const guides = mark.guides;
  return {
    id: "axis-triad",
    order: 0,
    stamp(grid, frame) {
      const wallCorner = resolveSharedCorner(ext, frame, mark.corner);
      const { wallOutline, boxOnly } = classifyEdges(wallCorner);
      const drawEdges = (edges: readonly Edge[]) => {
        for (const [a, b] of edges) {
          const from = projectObjectPoint(frame, cornerPoint(a, ext));
          const to = projectObjectPoint(frame, cornerPoint(b, ext));
          stampGlyphOverlayLine(grid, from, to, edgeGlyph(from, to), color);
        }
      };
      // P1-2 (codex review, round 6): grid lines are stamped BEFORE the
      // axis-line/wall/box edges below, never after — `subsampleTicksForGrid`
      // already excludes the plane's own boundary ticks (the only positions
      // that could coincide with an edge some OTHER write also owns), but
      // drawing the grid FIRST is the belt-and-suspenders guarantee: at a
      // genuinely coincident cell, `stampGlyphOverlayLine`'s own depth test
      // permits an EQUAL-depth overwrite, so the stronger axis/wall/box
      // glyph drawn after always wins over the fainter grid glyph, never
      // the other way around.
      if (guides.grid || guides.floorGrid) {
        // Fix round 4, Item 2: `fixedAxis` 0/1 are the WALL planes
        // (perpendicular to x/y) — `guides.grid`'s own toggle, default
        // `true`. `fixedAxis` 2 is the FLOOR (the z=const plane) —
        // `guides.floorGrid`, default `false`, since the floor sits mostly
        // EXPOSED (not behind the surface) at a typical camera/footprint,
        // where the two walls sit mostly behind it by construction (the
        // shared-corner rule) and read as a faint backdrop instead of a
        // cage. Measured against the coordinator's own ring-ridge-plus-
        // crater fixture at 96x32: the floor plane alone painted MORE grid
        // ink than both walls combined, since the surface never reaches
        // the box's own x/y corners.
        const axesTriple: [GlyphChart3dResolvedAxis, GlyphChart3dResolvedAxis, GlyphChart3dResolvedAxis] = [mark.axes.x, mark.axes.y, mark.axes.z];
        for (const fixedAxis of [0, 1, 2] as const) {
          if (fixedAxis === 2 ? !guides.floorGrid : !guides.grid) continue;
          for (const [p0, p1] of planeGridLines(fixedAxis, wallCorner, ext, axesTriple)) {
            const from = projectObjectPoint(frame, p0);
            const to = projectObjectPoint(frame, p1);
            stampGlyphOverlayLine(grid, from, to, gridEdgeGlyph(from, to, charset), AXIS_GRID_COLOR);
          }
        }
      }

      const { xy: xyCorner, z: zCorner } = resolveAxisTriadCorners(ext, frame, mark.corner);
      const axisCorner = (axisIndex: 0 | 1 | 2): Corner => (axisIndex === 2 ? zCorner : xyCorner);
      if (guides.axisLines) {
        for (const axisIndex of [0, 1, 2] as const) {
          const c = axisCorner(axisIndex);
          const from = projectObjectPoint(frame, outwardPoint(axisIndex, c, 0, ext, 0));
          const to = projectObjectPoint(frame, outwardPoint(axisIndex, c, 1, ext, 0));
          stampGlyphOverlayLine(grid, from, to, edgeGlyph(from, to), color);
        }
      }
      if (guides.walls) drawEdges(wallOutline);
      if (guides.box) drawEdges(boxOnly);

      for (let axisIndex = 0 as 0 | 1 | 2; axisIndex < 3; axisIndex++) {
        const name = AXIS_NAMES[axisIndex];
        const axis = mark.axes[name];
        const [lo, hi] = axis.domain;
        const span = hi - lo;
        const axisPushCorner = axisCorner(axisIndex);
        for (let i = 0; i < axis.ticks.length; i++) {
          const value = axis.ticks[i]!;
          const t = span === 0 ? 0 : (value - lo) / span;
          if (guides.ticks) {
            const onEdge = outwardPoint(axisIndex, axisPushCorner, t, ext, 0);
            const tickProjected = projectObjectPoint(frame, onEdge);
            stampGlyphOverlayCell(grid, { col: tickProjected.col, row: tickProjected.row, char: "+", color, depth: tickProjected.depth });
          }
          if (!guides.tickLabels) continue;
          const label = outwardPoint(axisIndex, axisPushCorner, t, ext, TICK_LABEL_MARGIN);
          const labelProjected = projectObjectPoint(frame, label);
          const priority = i === 0 || i === axis.ticks.length - 1
            ? PRIORITY_TICK_EXTREME
            : value === 0
              ? PRIORITY_TICK_ZERO
              : PRIORITY_TICK_INTERIOR;
          frame.labels.place({
            id: `axis-${name}-tick-${i}`,
            priority,
            col: labelProjected.col,
            row: labelProjected.row,
            text: axis.tickLabels[i]!,
            color,
            // Fix round 4, Item 4 ("a tick label must never be overwritten
            // by the axis-line/tick glyph or clipped"): the tick label now
            // gets EXACTLY the axis TITLE's own two-part treatment (round
            // 2's P1-b / round 3's own `occlusionDepth` field, documented in
            // full on the title's own `place()` call below), not the
            // ORIGINAL round-2 rule this replaces (`ownMeshIds:
            // frame.ownMeshIds`, exempting the surface from occlusion
            // entirely, plus a `depth` forwarded to the WRITE). That
            // original rule had two bugs at once: (1) `depth` compared the
            // label's own write against THIS SAME overlay's own earlier,
            // non-arbitered box/wall/grid-edge writes — whose interpolated
            // `stampGlyphOverlayLine` depth reads fractionally nearer at
            // SOME of the label's own character cells but not others —
            // silently blocking part of a multi-character label while the
            // rest painted (a genuinely present tick label rendering as a
            // truncated number, "200" -> "00", "40" -> "4+"); (2) exempting
            // the surface from occlusion meant a tick label could print
            // straight over real surface ink with nothing to stop it once
            // (1)'s `depth` gate — the only thing that had ever incidentally
            // curbed that — was removed to fix (1) (`object.test.ts`'s own
            // "Item 4: zero guide glyphs on surface-won cells" gate catches
            // this directly). `ownMeshIds: new Set()` (surface NOT exempt)
            // plus `occlusionDepth: labelProjected.depth` (a genuine depth
            // test against the surface's own rasterized depth, checked ONCE
            // for the whole label at `resolve()`, never per character)
            // fixes both: the label is dropped WHOLE when the surface is
            // truly nearer at its anchor, and never partially eaten by
            // sibling overlay geometry either way.
            //
            // Fix round 6, P1-1: this mechanism now works under
            // `style: "wireframe"`/`"ink"` too, not only `solid` — round 5's
            // own `buildMeshScreenDepth`/`tickLabelOccludedByMesh` vertex-
            // sampling workaround (deleted) is no longer needed. The real
            // fix lives in `glyphcss` itself: `CellGrid.winnerMesh` used to
            // be populated ONLY for `mode: "solid"`
            // (`compileScene.ts`/`createGlyphScene.ts`'s own
            // `retainWinnerMesh` gate), which is what made this same
            // `ownMeshIds`/`occlusionDepth` check silently inert under
            // wireframe/ink and let a label print through rasterized surface
            // ink between two sampled mesh vertices — `rasterize.ts`'s
            // `buildSurfaceOcclusionMap` now rasterizes the SAME real
            // triangles (not a vertex sample) into `winnerMesh`/`depth`
            // whenever an overlay is mounted, in every render mode.
            ownMeshIds: new Set(),
            occlusionDepth: labelProjected.depth,
          });
        }
        if (guides.titles && axis.title.length > 0) {
          const titlePoint = outwardPoint(axisIndex, axisPushCorner, 0.5, ext, AXIS_TITLE_MARGIN);
          const titleProjected = projectObjectPoint(frame, titlePoint);
          frame.labels.place({
            id: `axis-${name}-title`,
            priority: PRIORITY_TITLE,
            col: titleProjected.col,
            row: titleProjected.row,
            text: axis.title,
            color,
            // Fix round 3, Item 3 ("never over the surface"): an EMPTY Set,
            // not `frame.ownMeshIds` (what the tick-label placement above
            // still uses) — so the surface is never exempt from covering a
            // title the way it's exempt for a tick. Paired with
            // `occlusionDepth` below, `labelArbiter.ts`'s own fix-round-3
            // field makes this a REAL depth test: the title hides only when
            // the surface is genuinely nearer than the title's own point at
            // that exact cell (the coordinator's reported case — the z title
            // landing on a bulge near the peak), never merely because SOME
            // cell the title's text spans belongs to the surface's
            // silhouette elsewhere on screen. `occlusionDepth` — NOT `depth`
            // — deliberately: `depth` is still omitted here exactly as round
            // 2's own P1-b left it (forwarding it to the WRITE let this SAME
            // overlay's own earlier, non-arbitered box/wall/grid-edge writes
            // — which carry an interpolated depth of their own along
            // `stampGlyphOverlayLine`'s walk — block the title's write via
            // `stampGlyphOverlayCell`'s depth test, even on a cell the
            // occlusion check above correctly found clear; measured directly
            // against this fixture, at the default camera, before adding
            // the separate field).
            ownMeshIds: new Set(),
            occlusionDepth: titleProjected.depth,
          });
        }
      }
    },
  };
}

export interface GlyphChart3dLabelAnchor {
  readonly text: string;
  readonly point: Vec3;
}

/**
 * The axis-triad's own `xy`/`z` corners (`resolveAxisTriadCorners`) the mark's
 * `axes.corner` option would resolve to for `referenceCamera` — the SAME
 * resolution `axisTriadOverlay` calls every `stamp()`, exposed standalone for
 * a caller (a test, a fit) that needs the exact corners without rendering. A
 * pure function of `camera` rotation only (`resolveSharedCorner`'s own doc;
 * `resolveFrontFloorCorner`/`resolveSilhouetteVerticalCorner` share the same
 * invariance property, documented in place). Round 6: was a single shared
 * `[0|1,0|1,0|1]` corner — now `{ xy, z }`, since the triad no longer pins
 * all three axes to one corner under `"auto"` (`resolveAxisTriadCorners`'s
 * own doc: doing so could hide an axis entirely behind the surface).
 */
export function glyphChart3dResolvedCorner(mark: GlyphChart3dSurfaceMark, referenceCamera: GlyphCamera): { readonly xy: readonly [0 | 1, 0 | 1, 0 | 1]; readonly z: readonly [0 | 1, 0 | 1, 0 | 1] } {
  const proj: Projector = { camera: referenceCamera, cols: 1, rows: 1, cellAspect: 1, toWorld: (p) => p };
  return resolveAxisTriadCorners(mark.aspect, proj, mark.corner);
}

/**
 * Every tick + title anchor point (object space) this mark's axis overlays
 * will stamp, via the SAME nearest-edge/outward-point geometry
 * `axisOverlay`'s own `stamp()` uses — extracted standalone (no grid, no
 * arbiter, no scene) so a camera FIT can reason about every label's FULL
 * intended extent analytically, before any clipping or arbiter collision
 * (fix round 2, P1-b: `render.ts`'s own closed-form `fitStaticCamera`). A
 * rendered probe only sees labels that SURVIVED resolution — indistinguishable
 * from "never fit" — which is exactly what let a full title go missing
 * (`Eleva+ion`, a bare newline) at several rotations under the PRIOR probe
 * technique.
 *
 * `referenceCamera` need only carry the right ROTATION — edge selection is
 * "largest projected depth at the edge's own midpoint," and depth is
 * independent of `zoom`/`center`/viewport shape for an orthographic camera,
 * so a fit computing candidate zooms can probe edge selection with any
 * placeholder `cols`/`rows`/`cellAspect` at that rotation.
 */
export function glyphChart3dLabelAnchors(mark: GlyphChart3dSurfaceMark, referenceCamera: GlyphCamera): readonly GlyphChart3dLabelAnchor[] {
  const ext = mark.aspect;
  const proj: Projector = { camera: referenceCamera, cols: 1, rows: 1, cellAspect: 1, toWorld: (p) => p };
  const { xy: xyCorner, z: zCorner } = resolveAxisTriadCorners(ext, proj, mark.corner);
  const anchors: GlyphChart3dLabelAnchor[] = [];
  const axes: readonly (readonly [0 | 1 | 2, GlyphChart3dResolvedAxis])[] = [[0, mark.axes.x], [1, mark.axes.y], [2, mark.axes.z]];
  const guides = mark.guides;
  for (const [axisIndex, axis] of axes) {
    const corner = axisIndex === 2 ? zCorner : xyCorner;
    const [lo, hi] = axis.domain;
    const span = hi - lo || 1;
    // A caller (a camera FIT) must never reserve margin for a label the
    // overlay itself won't draw — `guides.tickLabels`/`titles` off means
    // `axisTriadOverlay`'s own `stamp()` skips these `place()` calls
    // entirely, so the fit's own anchor set has to match.
    if (guides.tickLabels) {
      for (let i = 0; i < axis.ticks.length; i++) {
        const value = axis.ticks[i]!;
        const t = (value - lo) / span;
        anchors.push({ text: axis.tickLabels[i]!, point: outwardPoint(axisIndex, corner, t, ext, TICK_LABEL_MARGIN) });
      }
    }
    if (guides.titles && axis.title.length > 0) {
      anchors.push({ text: axis.title, point: outwardPoint(axisIndex, corner, 0.5, ext, AXIS_TITLE_MARGIN) });
    }
  }
  return anchors;
}

function buildSurfaceMesh(mark: GlyphChart3dSurfaceMark, objectId: string): Polygon[] {
  const { grid, aspect, bands, colorAnchors } = mark;
  const rows = grid.z.length;
  const cols = grid.z[0]!.length;
  // All three axes map through their own resolved (NICE) domain, exactly
  // like the axis overlay's own ticks do — never `mark.zDomain` (the raw,
  // un-niced data extent) for x/y. Mixing a nice x/y domain with a raw z
  // domain put a tick at the wrong fraction of the box (P1-2: a raw [1.3,
  // 8.7] against a nice [1, 9] puts tick "2" at 12.5% up the box instead of
  // the 9.5% its own label claims), because the MESH and the TICKS would
  // then be two different functions of z. `mark.zDomain` itself is left
  // untouched as the public raw-extent field (its own documented meaning).
  const [xLo, xHi] = mark.axes.x.domain;
  const [yLo, yHi] = mark.axes.y.domain;
  const [zLo, zHi] = mark.axes.z.domain;
  const xSpan = xHi - xLo || 1;
  const ySpan = yHi - yLo || 1;
  const zSpan = zHi - zLo || 1;

  const normalizedX = grid.x.map((v) => ((v - xLo) / xSpan) * aspect[0]);
  const normalizedY = grid.y.map((v) => ((v - yLo) / ySpan) * aspect[1]);
  const normalizedZ = grid.z.map((row) => row.map((v) => ((v - zLo) / zSpan) * aspect[2]));

  const flatZ = new Float64Array(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) flatZ[r * cols + c] = grid.z[r]![c]!;
  const scratch = createSurfaceMedianScratch(Math.max(1, rows * cols));

  const { polygons } = gridSurfacePolygons(
    { z: normalizedZ, x: normalizedX, y: normalizedY },
    {
      maxQuadsX: mark.maxQuadsX,
      maxQuadsY: mark.maxQuadsY,
      color: colorAnchors === null
        ? undefined
        : (block) => {
          const median = surfaceMedianOfBlock({ stride: cols, values: flatZ }, scratch, block.col0, block.col1, block.row0, block.row1);
          const t = (median - zLo) / zSpan;
          const bandIdx = glyphChart3dBandIndex(t, bands);
          return glyphChart3dBandColor(colorAnchors, bandIdx, bands);
        },
    },
  );
  if (mark.shading === "value") {
    applyValueShadingTexture(polygons, aspect, bands, encodeGlyphSceneObjectSamplerKey(objectId, GLYPH_CHART_3D_VALUE_STRIP_TEXTURE_KEY));
  }
  return polygons;
}

/** Builds the `GlyphSceneObject` for a `GlyphChart3dMark` — today, a `surface`. `scatter3d` (C5) is a later member of the same union; adding it will fail to typecheck HERE until this function grows its own branch. */
export function glyphChartObject(mark: GlyphChart3dMark, options: GlyphChart3dObjectOptions = {}): GlyphSceneObject {
  if (mark.type !== "surface") {
    throw new TypeError(`glyphcss: unknown 3D mark type ${JSON.stringify((mark as { type?: unknown }).type)}.`);
  }
  const id = options.id ?? "surface";
  const polygons = buildSurfaceMesh(mark, id);
  const ext = mark.aspect;
  // Fix round 3, Item 2: a live scene consumer (`/charts`' own orbit
  // viewport) mounts this object directly with no `renderGlyphChart3d`
  // charset resolution step of its own — `charset` defaults to `"box"`
  // (the richest line-art tier, matching this overlay's own default
  // `AXIS_BOX_COLOR`/`edgeGlyph` box-drawing convention) rather than
  // silently falling back to `"ascii"`.
  const charset = options.charset ?? "box";
  const overlays: GlyphSceneOverlay[] = [axisTriadOverlay(mark, ext, AXIS_BOX_COLOR, charset)];
  return {
    id,
    meshes: [{ name: "surface", polygons }],
    overlays,
    ...(mark.shading === "value"
      ? { textureSamplers: new Map([[GLYPH_CHART_3D_VALUE_STRIP_TEXTURE_KEY, buildValueStripTexture()]]) }
      : {}),
    bounds: { min: [0, 0, 0], max: [ext[0], ext[1], ext[2]] },
  };
}
