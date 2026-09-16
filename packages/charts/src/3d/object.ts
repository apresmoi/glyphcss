/**
 * `glyphChartObject` — turns a `GlyphChart3dMark` into a mounted
 * `GlyphSceneObject` (PLAN-3d.md §3.1, §5 "Axes and box"/"Labels"):
 * the surface mesh (`gridSurfacePolygons`, coloured by the area-median band
 * of the FULL-resolution grid a decimated quad stands in for) plus a 3D
 * axis triad (real ribbon-mesh GEOMETRY, C2 fix round 7), ticks, and tick
 * labels as overlays through the shared registry/arbiter (`scene.addObject`
 * — AGENTS.md's "Scene objects").
 *
 * `objectPosition` is DATA SPACE (contract 8): every axis is mapped from
 * its own resolved domain onto `[0, aspect[axis]]` by ONE affine function,
 * so a mesh vertex's object-space coordinate is a monotone, linear image
 * of the underlying data value on that axis — never a re-derived or
 * re-scaled quantity an effect would have to invert.
 */
import {
  gridSurfacePolygons, parametricSurfacePolygons, surfaceMedianOfBlock, createSurfaceMedianScratch, orientedRibbonPolygons,
  boxPolygons, octahedronPolygons, tetrahedronPolygons, icosahedronPolygons,
} from "glyphcss";
import { stampGlyphOverlayCell, stampGlyphOverlayLine, encodeGlyphSceneObjectSamplerKey } from "glyphcss";
import type { GlyphCamera, GlyphSceneObject, GlyphSceneObjectMesh, GlyphSceneOverlay, Polygon, TextureSampler, Vec3 } from "glyphcss";
import { glyphChart3dBandColor, glyphChart3dBandIndex } from "./colorscale";
import type {
  GlyphChart3dAxisTriadSpec, GlyphChart3dBarsMark, GlyphChart3dColorLegend, GlyphChart3dLineMark, GlyphChart3dMark,
  GlyphChart3dObjectOptions, GlyphChart3dParametricMark, GlyphChart3dResolvedAxis, GlyphChart3dScatterMark, GlyphChart3dSurfaceMark,
} from "./types";
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
 * calls `add(spec.polygons, ...)` with no texture-key translation).
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
 * C2 fix round 9 (USER FEEDBACK, verbatim: "the label is too far from the
 * axis... maybe those labels should be on the end at the tip of the axes in
 * 3d space, instead of being next to the numbers, they could be in the
 * end"). Superseded round 3's own `0.6` The measured sweep that replaced it: `0.08` is the
 * smallest value that never dropped a real title to a tick-label collision
 * across the real Maunga Whau / ETOPO1 Alps fixtures at 96x32/140x40,
 * box/braille (a smaller value, e.g. `0.04`, drops "y (m)" at 96x32 on
 * both fixtures — the title's own reserved box then overlaps the
 * endpoint tick label's, and the tick (higher priority) wins).
 */
const AXIS_TITLE_TIP_OFFSET = 0.15;
/**
 * The `"end"` title's own perpendicular clearance off the triad edge (the
 * OTHER two axes, `axisTitlePoint`'s own `push`) — a SEPARATE, smaller
 * constant from `TICK_LABEL_MARGIN` was tried and rejected: reusing
 * `TICK_LABEL_MARGIN` (`0.15`) exactly put a real title's own reserved box
 * directly athwart the endpoint tick label's (both anchor at the same
 * `t`-neighbourhood with the same perpendicular offset), which the arbiter
 * resolves by dropping the lower-priority title. `0.08` — matched to
 * `AXIS_TITLE_TIP_OFFSET` so a title's along-axis push and its
 * perpendicular clearance read as the same "just past the tip" nudge in
 * every direction — clears that collision on every fixture/size/charset
 * this round measured.
 */
const AXIS_TITLE_PERP_MARGIN = 0.08;
/**
 * `"start"`/`"center"` keep the PRE-round-9 `outwardPoint` mechanism and
 * its own `0.6` margin verbatim — NOT tightened. `"end"` can afford
 * `AXIS_TITLE_PERP_MARGIN`'s tight `0.08` because extending PAST each
 * axis's own, separate tip (`AXIS_TITLE_TIP_OFFSET`) is what keeps three
 * axes' `"end"` titles apart; `"start"` has no such separation to lean on —
 * every axis's `"start"` anchor sits at the SAME shared origin corner, so
 * three titles differ only by which one OTHER axis got the perpendicular
 * push, and at `0.08` that difference is too small to survive an oblique
 * camera: measured directly,
 * tightening `"start"`'s own margin to `0.08` (or even `0.15`) clustered
 * all three titles into the same few screen cells and dropped 2-3 of them
 * at the library's own DEFAULT camera on a small synthetic grid — a
 * regression `"end"`'s own fix must not cause. `"center"` inherits the same
 * legacy margin for the identical reason (its own anchor sits at each
 * edge's midpoint, no natural "further" direction to lean on either).
 */
const AXIS_TITLE_LEGACY_MARGIN = 0.6;
/** Priorities: endpoints outrank the title, which outranks an interior tick. */
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
 * structurally.
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
 * A guide-plane gridline reuses a DIFFERENT glyph family from `edgeGlyph`'s
 * solid line-drawing set (a 2D-chart-flavoured faint pair on `box`, a plain
 * `,` on `ascii` — never `.`/`:`, real SOLID_RAMP shading levels there — a
 * single sparse braille dot on `braille`), so a reader can tell "this is
 * structure" from "this is a guide" without colour at all.
 */
function gridEdgeGlyph(from: Projected, to: Projected, charset: GlyphChartCharset): string {
  if (charset === "braille") return "⠂";
  if (charset === "ascii") return ",";
  const dc = to.col - from.col, dr = to.row - from.row;
  if (dc === 0 && dr === 0) return "·";
  if (dc === 0) return "┊";
  if (dr === 0) return "┈";
  return "·"; // no faint diagonal box-drawing glyph exists; a dot reads as "guide", not "structure".
}

/**
 * The single shared corner the BACKDROP (`guides.walls`/`box`/`grid`/
 * `floorGrid`) resolves per camera — UNCHANGED by C2 fix round 7 (the axis
 * TRIAD itself no longer reads this at all, see `resolveOriginCorner`
 * below). `"auto"`: for EACH axis independently, pick whichever of its two
 * PERPENDICULAR faces is FARTHER from the camera (smaller projected depth
 * at the face's own centre) — the "put the guide wall behind the data"
 * rule: each of the 3 resulting faces is, by construction, the back one of
 * its own opposing pair, so together they sit behind the surface from the
 * camera's own side, exactly like a 2D chart's plot rect sits in front of
 * its own axis lines. A pure function of camera ROTATION only (depth
 * ordering is zoom/center-invariant for an orthographic camera) — never a
 * stored, mutated "last corner".
 *
 * An explicit `[bx, by, bz]` pins a fixed layout regardless of rotation.
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
 * C2 fix round 7 (USER FEEDBACK, verbatim: "do not put the 0,0,0 in the
 * center of the shape, put it in one of the corners"). The axis TRIAD's own
 * corner is now a CONSTANT, not a per-camera search: `[0, 0, 0]` in
 * object-space bits is, by `buildSurfaceMesh`'s own affine data mapping
 * (every axis's domain MINIMUM maps to object coordinate `0`), the ONE box
 * vertex that is simultaneously `(xMin, yMin, zMin)` — the corner where
 * every axis's FIRST tick sits, by definition, for every camera pose. No
 * OTHER box vertex can hold that property (any other corner has at least
 * one axis's bit at `1`, i.e. that axis's DATA MAXIMUM, so its "first tick"
 * would read backwards).
 *
 * This REPLACES round 6's own `resolveAxisTriadCorners` — the per-camera
 * search over `resolveFrontFloorCorner` (x/y's own front-floor pick) and
 * `resolveSilhouetteVerticalCorner` (z's own, independently-resolved
 * silhouette pick), which is REMOVED outright: that split is exactly what
 * the user is asking to undo ("all three axis lines leave that SAME origin
 * corner"), and once the corner is pinned to the single data-min vertex
 * there is nothing left to search FOR — every "which corner" question round
 * 6 asked has exactly one answer.
 *
 * What round 6's search bought was VISIBILITY: a floor/silhouette corner is
 * never occluded. Round 7 keeps that property a different way — the axis
 * LINES are now real RIBBON-MESH GEOMETRY (`axisTriadLinePolygons`, built
 * once, no per-frame resolution needed at all since the corner never
 * moves), depth-tested against the surface by the ORDINARY rasterizer the
 * same way any other mesh in the scene is. A genuinely occluded stretch of
 * an axis line is therefore simply HIDDEN by the nearer surface, cell by
 * cell — never a reason to relocate the whole triad to a different corner,
 * and never a "no corner has all three edges visible" case to special-case,
 * because there is no corner SELECTION left to fail: `GLYPH_CHART_3D_DEFAULT_CAMERA`
 * (`camera.ts`) is chosen so this ONE corner's three edges are themselves
 * >= 70% unoccluded on both of this round's own real-dataset gates
 * (`render.test.ts`), with the geometry's own depth test absorbing
 * whatever residual falls the wrong side of that at an adversarial camera.
 *
 * An EXPLICIT `axes.corner` override still pins the WHOLE triad to that
 * given corner (unchanged) — a caller who explicitly wants a non-data-min
 * anchor still gets one; only `"auto"` is now fixed rather than searched.
 */
function resolveOriginCorner(cornerOption: "auto" | Corner): Corner {
  return cornerOption === "auto" ? [0, 0, 0] : cornerOption;
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
 * TOUCHING it (unused for the axis TRIAD any more — see
 * `axisTriadLinePolygons`, real geometry now — but still the definition
 * `wallOutline`/`boxOnly` are carved relative to), the 6 remaining edges
 * that bound one of the 3 "guide plane" faces meeting at `corner`
 * (`wallOutline` — `guides.walls`), and the 3 edges left over, on neither
 * (`boxOnly` — `guides.box`).
 */
function classifyEdges(corner: Corner): { readonly wallOutline: readonly Edge[]; readonly boxOnly: readonly Edge[] } {
  const wallOutline: Edge[] = [], boxOnly: Edge[] = [];
  for (const edge of BOX_EDGES) {
    const [a, b] = edge;
    if (cornersEqual(a, corner) || cornersEqual(b, corner)) continue; // the triad's own 3 edges — geometry, not a stamp
    const onGuidePlane = a[0] === b[0] && a[0] === corner[0]
      || a[1] === b[1] && a[1] === corner[1]
      || a[2] === b[2] && a[2] === corner[2];
    (onGuidePlane ? wallOutline : boxOnly).push(edge);
  }
  return { wallOutline, boxOnly };
}

/**
 * Outward push-out point for a tick/title on `axis`'s triad edge, at
 * parameter `t` along it. The edge touching `corner` always spans the
 * FULL `[0, ext[axis]]` range on its own axis regardless of `corner[axis]`,
 * so the axis's own coordinate is `t * ext[axis]` — data-consistent with
 * the mesh's own vertex position, unflipped. The other two axes push away
 * from the box using the shared corner's OWN fixed bits (0 -> push
 * negative, 1 -> push positive) — identical for every axis, since (round 7)
 * they ALL share the same corner now.
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
 * Caps how many of an axis's own TICKS become a grid line on a guide
 * plane, independent of how many tick MARKS/labels that axis itself shows.
 * Always keeps the FIRST and LAST tick (the plane's own two edges) and
 * evenly subsamples the interior.
 */
const GRID_MAX_LINES_PER_SWEEP_AXIS = 1;
function subsampleTicksForGrid(ticks: readonly number[], max: number): readonly number[] {
  const interior = ticks.length > 2 ? ticks.slice(1, -1) : [];
  if (interior.length === 0 || max < 1) return [];
  if (interior.length <= max) return interior;
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
 * ticks of EACH of the plane's other two axes, a line sweeping the plane's
 * own full extent along the remaining axis. A WALL plane (`fixedAxis` 0 or
 * 1) sweeps ONLY its own z-tick direction (matplotlib's own wall-pane
 * convention); the FLOOR plane (`fixedAxis` 2, opt-in) sweeps both.
 *
 * Each returned line carries its own `sweepAxis` (C7) — the axis whose TICK
 * value positions it — so a caller can gate it against THAT axis's own
 * `grid` override rather than only the plane's flat `guides.grid`/
 * `floorGrid` default: a wall plane's lines are always z's, a floor plane's
 * are x's and y's, so this is what lets `axes.z.grid` toggle the walls and
 * `axes.x.grid`/`axes.y.grid` toggle the floor independently.
 */
function planeGridLines(fixedAxis: 0 | 1 | 2, corner: Corner, ext: readonly [number, number, number], axes: readonly [GlyphChart3dResolvedAxis, GlyphChart3dResolvedAxis, GlyphChart3dResolvedAxis]): readonly (readonly [Vec3, Vec3, 0 | 1 | 2])[] {
  const inPlane = ([0, 1, 2] as const).filter((a) => a !== fixedAxis) as [0 | 1 | 2, 0 | 1 | 2];
  const sweepAxes: readonly (0 | 1 | 2)[] = fixedAxis === 2 ? inPlane : inPlane.filter((a) => a === 2);
  const fixedVal = corner[fixedAxis] ? ext[fixedAxis] : 0;
  const lines: (readonly [Vec3, Vec3, 0 | 1 | 2])[] = [];
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
      lines.push([p0, p1, sweepAxis]);
    }
  }
  return lines;
}

const AXIS_BOX_COLOR = "#7a7f8a";
const AXIS_GRID_COLOR = "#4b5058";
const AXIS_NAMES = ["x", "y", "z"] as const;

/** C7 (AGENTS.md's "Charts 3D" "C7"): the resolved axis for `axisIndex` — the one indexing point every per-axis helper below shares. */
function axisAt(mark: GlyphChart3dAxisTriadSpec, axisIndex: 0 | 1 | 2): GlyphChart3dResolvedAxis {
  return axisIndex === 0 ? mark.axes.x : axisIndex === 1 ? mark.axes.y : mark.axes.z;
}
/** This axis's own `color` override, else the mark's shared `axesColor`, else the library default — the SAME precedence 2D's `axes.{x,y}.color`/`axes.color` follow. */
function axisRenderColor(axis: GlyphChart3dResolvedAxis, mark: GlyphChart3dAxisTriadSpec): string {
  return axis.color ?? mark.axesColor ?? AXIS_BOX_COLOR;
}
/** An axis's own boolean override, falling back to the matching global `guides` default when it names none. */
function axisVisible(override: boolean | undefined, fallback: boolean): boolean {
  return override === undefined ? fallback : override;
}

/**
 * C2 fix round 9 (USER FEEDBACK, verbatim: "the label is too far from the
 * axis... maybe those labels should be on the end at the tip of the axes in
 * 3d space, instead of being next to the numbers, they could be in the end
 * (other end of 0,0,0) for each axe"). `"end"` (NEW DEFAULT) pushes the
 * title PAST the axis's own last tick, CONTINUING the axis's own line
 * outward (its along-axis coordinate is `ext[axis] + titleOffset *
 * ext[axis]`, past the tip) with a small, fixed perpendicular clearance
 * (`AXIS_TITLE_PERP_MARGIN`) — the SAME "just past the tip" nudge in every
 * direction, matching what `titleOffset`'s own doc always said ("a fraction
 * of THAT axis's own box extent") but the round-3 implementation never
 * actually did (it pushed the OTHER two axes by that fraction instead, not
 * the title's own).
 *
 * `"start"`/`"center"` are UNCHANGED from before this round — the exact
 * pre-round-9 `outwardPoint` call, `AXIS_TITLE_LEGACY_MARGIN`'s own big
 * `0.6` perpendicular push, `t = 0`/`0.5`. They are NOT tightened the way
 * `"end"` is: `"end"`'s tight margin works because three axes' own `"end"`
 * anchors are naturally far apart (each at its OWN, separate tip); `"start"`
 * has no such separation — every axis's `"start"` anchor sits at the SAME
 * shared origin corner, differing only by which ONE other axis got the
 * perpendicular push, so tightening it clusters all three into the same
 * few screen cells under an oblique camera (measured directly,
 * `docs/design/charts3d.md`'s "C2 fix round 9": tightening dropped 2-3 of 3
 * "start" titles at the library's own DEFAULT camera on a small synthetic
 * grid). `"center"` keeps the legacy margin for the identical reason (its
 * anchor sits at each edge's own midpoint, no natural "further" direction
 * either).
 */
function axisTitlePoint(axisIndex: 0 | 1 | 2, corner: Corner, ext: readonly [number, number, number], axis: GlyphChart3dResolvedAxis): Vec3 {
  const titleAt = axis.titleAt ?? "end";
  if (titleAt !== "end") {
    return outwardPoint(axisIndex, corner, titleAt === "start" ? 0 : 0.5, ext, axis.titleOffset ?? AXIS_TITLE_LEGACY_MARGIN);
  }
  const tipOffset = axis.titleOffset ?? AXIS_TITLE_TIP_OFFSET;
  const p: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const axisK = k as 0 | 1 | 2;
    if (axisK === axisIndex) { p[k] = ext[axisIndex] + tipOffset * ext[axisIndex]; continue; }
    const bit = corner[axisK];
    const push = AXIS_TITLE_PERP_MARGIN * ext[axisK];
    p[k] = bit ? ext[axisK] + push : -push;
  }
  return p;
}

/**
 * The axis TRIAD's own ribbon-mesh half-width, as a fraction of the SHORTER
 * of the box's own x/y extents (never the z one, which the default aspect
 * already compresses to 0.6 — sizing off it would make the line's own
 * thickness swing with a caller's own `aspect[2]` for no reason connected
 * to legibility). Tuned by direct rendering
 * "C2 fix round 7"): thin enough that the wireframe/braille encoder still
 * traces it as a single clean line rather than a visibly double-walled
 * ribbon, thick enough that the solid/ascii/box encoder's own Lambert
 * shading gives it at least one full cell of width at this library's own
 * default camera and auto-fit zoom.
 */
const AXIS_LINE_HALF_WIDTH_FRACTION = 0.01;

/**
 * C2 fix round 8, P2 (coordinator review: axis ribbons rendered as `@@` —
 * `SOLID_RAMP`'s own densest glyph — in `ascii`/`box`, reading as thick
 * dark blobs rather than lines). An ORDINARY geometric Lambert response
 * made this unavoidable: a thin ribbon's own long faces are, for a wide
 * swath of default-camera orientations, close to face-on with
 * `rasterizeContext.ts`'s `DEFAULT_DIRECTIONAL` light (`[0.5, 0.7, 0.5]`,
 * intensity 1 atop `DEFAULT_AMBIENT`'s 0.4), so its measured intensity
 * lands near the ramp's own top end regardless of which way the axis
 * happens to run. The axis triad is STRUCTURE/ANNOTATION, not a lit
 * surface standing for real geometry (this file's `gridEdgeGlyph` already
 * treats guide-plane lines the same way, in a glyph family distinct from
 * shaded structure) — so its ribbons author a FIXED `shadingNormal`
 * (AGENTS.md's "Authored shading normal") chosen ORTHOGONAL to that same
 * default directional light, giving a constant, ambient-only intensity
 * (~0.4) regardless of the ribbon's own real orientation or the camera's:
 * a light, even glyph that reads as a LINE at every rotation, never a
 * darkness that happens to track whichever axis is briefly facing the
 * light. Verified by direct rendering
 * round 8"): `@`/`#`/`%` no longer appear in a `box`/`ascii` axis-triad
 * render at the default camera.
 */
const AXIS_LINE_SHADING_NORMAL: Vec3 = (() => {
  // Any unit vector v with v . [0.5, 0.7, 0.5] === 0 — (0.7, -0.5, 0),
  // normalized, is one such vector, chosen for no reason beyond being a
  // simple exact orthogonal solution.
  const v: Vec3 = [0.7, -0.5, 0];
  const len = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / len, v[1] / len, v[2] / len];
})();

/**
 * The axis triad's own 3 ribbon-mesh line segments, meeting at `corner` —
 * REAL GEOMETRY (C2 fix round 7, mirroring `@glyphcss/diagrams/3d`'s D2
 * round 7 edge ribbons, `orientedRibbonPolygons` shared through
 * `@glyphcss/core`), never a stamped `edgeGlyph` box-drawing/bar glyph —
 * so a line traces smoothly at ANY camera angle on `braille`'s sub-cell dot
 * encoder, and a segment genuinely behind the surface is hidden by the
 * ORDINARY per-cell depth test, exactly like any other mesh. Built ONCE,
 * with no camera dependency at all: `corner` is fixed (`resolveOriginCorner`),
 * so the 3 segments' own endpoints never move.
 *
 * C7: `colorForAxis`/`visibleForAxis` read each axis's own `color`/`line`
 * override (`axisRenderColor`/`axisVisible`) — an axis whose own line is
 * hidden contributes NO segment at all, never a segment painted then
 * discarded, so `guides.axisLines: false` for one axis alone is exactly as
 * cheap as it is for all three.
 */
function axisTriadLinePolygons(corner: Corner, ext: readonly [number, number, number], colorForAxis: (axis: 0 | 1 | 2) => string, visibleForAxis: (axis: 0 | 1 | 2) => boolean): Polygon[] {
  const halfWidth = Math.min(ext[0], ext[1]) * AXIS_LINE_HALF_WIDTH_FRACTION;
  const from = cornerPoint(corner, ext);
  const polygons: Polygon[] = [];
  for (const axis of [0, 1, 2] as const) {
    if (!visibleForAxis(axis)) continue;
    const to = cornerPoint(flipCorner(corner, axis), ext);
    const segment = orientedRibbonPolygons(from, to, halfWidth, colorForAxis(axis));
    for (const p of segment) p.shadingNormal = AXIS_LINE_SHADING_NORMAL;
    polygons.push(...segment);
  }
  return polygons;
}

/**
 * ONE overlay drawing everything the axis triad's STAMPED portion owns —
 * wall/box backdrop edges, guide-plane gridlines, ticks, tick labels and
 * axis titles. The axis LINES themselves are no longer stamped here at all
 * (C2 fix round 7) — they are real mesh geometry, built once in
 * `glyphChartObject` (`axisTriadLinePolygons`) and mounted as their own
 * `"axis-lines"` mesh, so they participate in the ORDINARY per-cell depth
 * test alongside the surface with no `stamp()` involvement.
 *
 * `wallCorner` (`resolveSharedCorner`, unchanged) still governs ONLY
 * `guides.walls`/`guides.box`/`guides.grid`/`floorGrid` — the backdrop
 * geometry, meant to sit behind the data. The axis TRIAD's own ticks/
 * labels/titles read `resolveOriginCorner`'s fixed corner instead.
 */
function axisTriadOverlay(mark: GlyphChart3dAxisTriadSpec, ext: readonly [number, number, number], charset: GlyphChartCharset): GlyphSceneOverlay {
  const guides = mark.guides;
  const corner = resolveOriginCorner(mark.corner);
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
          stampGlyphOverlayLine(grid, from, to, edgeGlyph(from, to), AXIS_BOX_COLOR);
        }
      };
      // C7: each grid line carries its own sweep axis (`planeGridLines`'s
      // own doc) — gated against THAT axis's own `grid` override, falling
      // back to the plane's own `guides.grid`/`floorGrid` default.
      {
        const axesTriple: [GlyphChart3dResolvedAxis, GlyphChart3dResolvedAxis, GlyphChart3dResolvedAxis] = [mark.axes.x, mark.axes.y, mark.axes.z];
        for (const fixedAxis of [0, 1, 2] as const) {
          const planeDefault = fixedAxis === 2 ? guides.floorGrid : guides.grid;
          for (const [p0, p1, sweepAxis] of planeGridLines(fixedAxis, wallCorner, ext, axesTriple)) {
            if (!axisVisible(axesTriple[sweepAxis].gridVisible, planeDefault)) continue;
            const from = projectObjectPoint(frame, p0);
            const to = projectObjectPoint(frame, p1);
            stampGlyphOverlayLine(grid, from, to, gridEdgeGlyph(from, to, charset), AXIS_GRID_COLOR);
          }
        }
      }

      if (guides.walls) drawEdges(wallOutline);
      if (guides.box) drawEdges(boxOnly);

      for (let axisIndex = 0 as 0 | 1 | 2; axisIndex < 3; axisIndex++) {
        const name = AXIS_NAMES[axisIndex];
        const axis = mark.axes[name];
        const color = axisRenderColor(axis, mark);
        const showTicks = axisVisible(axis.tickMarksVisible, guides.ticks);
        const showLabels = axisVisible(axis.tickLabelsVisible, guides.tickLabels);
        const [lo, hi] = axis.domain;
        const span = hi - lo;
        for (let i = 0; i < axis.ticks.length; i++) {
          const value = axis.ticks[i]!;
          const t = span === 0 ? 0 : (value - lo) / span;
          if (showTicks) {
            const onEdge = outwardPoint(axisIndex, corner, t, ext, 0);
            const tickProjected = projectObjectPoint(frame, onEdge);
            stampGlyphOverlayCell(grid, { col: tickProjected.col, row: tickProjected.row, char: "+", color, depth: tickProjected.depth });
          }
          if (!showLabels) continue;
          const label = outwardPoint(axisIndex, corner, t, ext, TICK_LABEL_MARGIN);
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
            // A genuine depth test against the surface's own rasterized
            // depth (`rasterize.ts`'s `buildSurfaceOcclusionMap`, every
            // render mode) — the label is dropped WHOLE when the surface is
            // truly nearer at its anchor, never partially eaten.
            ownMeshIds: new Set(),
            occlusionDepth: labelProjected.depth,
          });
        }
        if (guides.titles && axis.title.length > 0) {
          const titlePoint = axisTitlePoint(axisIndex, corner, ext, axis);
          const titleProjected = projectObjectPoint(frame, titlePoint);
          frame.labels.place({
            id: `axis-${name}-title`,
            priority: PRIORITY_TITLE,
            col: titleProjected.col,
            row: titleProjected.row,
            text: axis.title,
            color,
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
 * The axis-triad's own fixed corner (`resolveOriginCorner`) the mark's
 * `axes.corner` option resolves to — a PURE function of the mark alone
 * now (C2 fix round 7: no camera is involved any more, since the corner
 * never moves). Exposed standalone for a caller (a test, a fit) that needs
 * it without rendering.
 */
export function glyphChart3dResolvedCorner(mark: GlyphChart3dAxisTriadSpec): Corner {
  return resolveOriginCorner(mark.corner);
}

/**
 * Every tick + title anchor point (object space) this mark's axis overlay
 * will stamp, via the SAME `outwardPoint` geometry `axisTriadOverlay`'s own
 * `stamp()` uses — extracted standalone (no grid, no arbiter, no scene, and
 * since C2 fix round 7 no CAMERA either, since the origin corner is fixed)
 * so a camera FIT can reason about every label's FULL intended extent
 * analytically, before any clipping or arbiter collision
 * (`render.ts`'s own closed-form `fitStaticCamera`).
 */
export function glyphChart3dLabelAnchors(mark: GlyphChart3dAxisTriadSpec): readonly GlyphChart3dLabelAnchor[] {
  const ext = mark.aspect;
  const corner = resolveOriginCorner(mark.corner);
  const anchors: GlyphChart3dLabelAnchor[] = [];
  const axes: readonly (readonly [0 | 1 | 2, GlyphChart3dResolvedAxis])[] = [[0, mark.axes.x], [1, mark.axes.y], [2, mark.axes.z]];
  const guides = mark.guides;
  for (const [axisIndex, axis] of axes) {
    const [lo, hi] = axis.domain;
    const span = hi - lo || 1;
    // A caller (a camera FIT) must never reserve margin for a label the
    // overlay itself won't draw — `guides.tickLabels`/`titles` (and, C7, an
    // axis's own `tickLabels` override) off means `axisTriadOverlay`'s own
    // `stamp()` skips these `place()` calls entirely, so the fit's own
    // anchor set has to match EXACTLY the same axis-by-axis resolution.
    if (axisVisible(axis.tickLabelsVisible, guides.tickLabels)) {
      for (let i = 0; i < axis.ticks.length; i++) {
        const value = axis.ticks[i]!;
        const t = (value - lo) / span;
        anchors.push({ text: axis.tickLabels[i]!, point: outwardPoint(axisIndex, corner, t, ext, TICK_LABEL_MARGIN) });
      }
    }
    if (guides.titles && axis.title.length > 0) {
      anchors.push({ text: axis.title, point: axisTitlePoint(axisIndex, corner, ext, axis) });
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
  // un-niced data extent) for x/y. `mark.zDomain` itself is left untouched
  // as the public raw-extent field (its own documented meaning).
  const [xLo, xHi] = mark.axes.x.domain;
  const [yLo, yHi] = mark.axes.y.domain;
  const [zLo, zHi] = mark.axes.z.domain;
  const xSpan = xHi - xLo || 1;
  const ySpan = yHi - yLo || 1;
  const zSpan = zHi - zLo || 1;

  // C7: `mapAxisValue`'s own clamp (below) — a value outside an EXPLICIT
  // `axes.{x,y,z}.domain` maps to the nearest box edge rather than past it,
  // so the surface never draws outside its own `aspect` box. A no-op under
  // the default (data-derived, always-containing) domain.
  const clampFraction = (t: number) => Math.max(0, Math.min(1, t));
  const normalizedX = grid.x.map((v) => clampFraction((v - xLo) / xSpan) * aspect[0]);
  const normalizedY = grid.y.map((v) => clampFraction((v - yLo) / ySpan) * aspect[1]);
  const normalizedZ = grid.z.map((row) => row.map((v) => clampFraction((v - zLo) / zSpan) * aspect[2]));

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

/**
 * Maps a raw data value through an axis's own resolved (nice or explicit)
 * domain into `[0, extent]` — the ONE affine function every mark type's own
 * object-space mapping goes through (contract 8, "Scene objects"). C7:
 * CLAMPED to `[0, extent]` — a value outside an explicit `axes.*.domain`
 * (or, for `bars3d`'s z-floor, a domain that happens to exclude 0) maps to
 * the nearest box edge rather than past it, so a mark's own geometry never
 * draws outside its `aspect` box. A no-op whenever the domain already
 * contains every mapped value, which the default (data-derived) domain
 * always does.
 */
function mapAxisValue(value: number, axis: GlyphChart3dResolvedAxis, extent: number): number {
  const [lo, hi] = axis.domain;
  const span = hi - lo || 1;
  const t = Math.max(0, Math.min(1, (value - lo) / span));
  return t * extent;
}

/** A colour-legend band colour for `value` under `legend`'s own domain/bands, or `defaultColor` when there's no legend at all (`color: "none"`, or the mark carries no continuous channel). */
function legendColor(legend: GlyphChart3dColorLegend | null, value: number, defaultColor: string): string {
  if (legend === null) return defaultColor;
  const [lo, hi] = legend.domain;
  const t = (value - lo) / ((hi - lo) || 1);
  return glyphChart3dBandColor(legend.anchors, glyphChart3dBandIndex(t, legend.bands), legend.bands);
}

const DEFAULT_MARK_COLOR = "#4c78a8";

/** `scatter3d` — one polygon set per point, each a small marker solid at its own mapped object-space position. */
function buildScatterMesh(mark: GlyphChart3dScatterMark, monochrome: boolean): Polygon[] {
  const ext = mark.aspect;
  const polygons: Polygon[] = [];
  for (const p of mark.points) {
    const center: Vec3 = [mapAxisValue(p.x, mark.axes.x, ext[0]), mapAxisValue(p.y, mark.axes.y, ext[1]), mapAxisValue(p.z, mark.axes.z, ext[2])];
    const series = p.seriesIndex >= 0 ? mark.series[p.seriesIndex] : undefined;
    const color = p.colorValue !== undefined
      ? legendColor(mark.colorLegend, p.colorValue, DEFAULT_MARK_COLOR)
      : series?.color ?? DEFAULT_MARK_COLOR;
    const shape = monochrome && series ? series.shape : "octahedron";
    const size = p.markerSize;
    switch (shape) {
      case "cube": polygons.push(...boxPolygons({ center, width: size * 2, depth: size * 2, height: size * 2, color })); break;
      case "tetrahedron": polygons.push(...tetrahedronPolygons({ center, size, color })); break;
      case "icosahedron": polygons.push(...icosahedronPolygons({ center, size, color })); break;
      default: polygons.push(...octahedronPolygons({ center, size, color }));
    }
  }
  return polygons;
}

/** `parametric3d` — a UV-grid mesh (`parametricSurfacePolygons`, `@glyphcss/core`) mapped through each axis's own resolved domain, coloured per quad by its own `value` (or `z`) grid's NW-corner sample banded through the mark's colour legend. */
function buildParametricMesh(mark: GlyphChart3dParametricMark): Polygon[] {
  const ext = mark.aspect;
  const { x, y, z, value, wrapU, wrapV } = mark.grid;
  const rows = z.length, cols = z[0]!.length;
  const mappedX: number[][] = [], mappedY: number[][] = [], mappedZ: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const xr: number[] = [], yr: number[] = [], zr: number[] = [];
    for (let c = 0; c < cols; c++) {
      xr.push(mapAxisValue(x[r]![c]!, mark.axes.x, ext[0]));
      yr.push(mapAxisValue(y[r]![c]!, mark.axes.y, ext[1]));
      zr.push(mapAxisValue(z[r]![c]!, mark.axes.z, ext[2]));
    }
    mappedX.push(xr); mappedY.push(yr); mappedZ.push(zr);
  }
  const colourField = value ?? z;
  return parametricSurfacePolygons(
    { x: mappedX, y: mappedY, z: mappedZ, wrapCols: wrapU, wrapRows: wrapV },
    { color: mark.colorLegend === null ? undefined : (ri, ci) => legendColor(mark.colorLegend, colourField[ri]![ci]!, DEFAULT_MARK_COLOR) },
  );
}

/** `bars3d` — one upright box per bar, floor (mapped z=0) to its own mapped height, footprint sized from `barHalfWidth` (DATA units, scaled through the SAME x/y axis extents every other point maps through). */
function buildBarsMesh(mark: GlyphChart3dBarsMark): Polygon[] {
  const ext = mark.aspect;
  const [xLo, xHi] = mark.axes.x.domain, [yLo, yHi] = mark.axes.y.domain;
  const halfWidthX = (mark.barHalfWidth[0] / ((xHi - xLo) || 1)) * ext[0];
  const halfWidthY = (mark.barHalfWidth[1] / ((yHi - yLo) || 1)) * ext[1];
  const zFloor = mapAxisValue(0, mark.axes.z, ext[2]);
  const polygons: Polygon[] = [];
  for (const bar of mark.bars) {
    const cx = mapAxisValue(bar.x, mark.axes.x, ext[0]);
    const cy = mapAxisValue(bar.y, mark.axes.y, ext[1]);
    const cz = mapAxisValue(bar.z, mark.axes.z, ext[2]);
    const height = cz - zFloor;
    if (height === 0) continue; // a zero-valued bar paints nothing, matching the 2D bar mark's own rule
    const color = legendColor(mark.colorLegend, bar.z, DEFAULT_MARK_COLOR);
    polygons.push(...boxPolygons({
      center: [cx, cy, zFloor + height / 2],
      width: halfWidthX * 2, depth: halfWidthY * 2, height: Math.abs(height),
      color,
    }));
  }
  return polygons;
}

/** `line3d`'s own ribbon half-width — a touch thicker than the axis triad's own line (data, not furniture, gets a little more visual weight). */
const LINE3D_HALF_WIDTH_FRACTION = 0.012;

/** `line3d` — each series' own ordered points, connected by ribbon-mesh segments (the SAME primitive the axis triad's own lines use). */
function buildLineMesh(mark: GlyphChart3dLineMark): Polygon[] {
  const ext = mark.aspect;
  const halfWidth = Math.min(ext[0], ext[1]) * LINE3D_HALF_WIDTH_FRACTION;
  const polygons: Polygon[] = [];
  for (const series of mark.series) {
    const mapped = series.points.map((p): Vec3 => [
      mapAxisValue(p[0], mark.axes.x, ext[0]),
      mapAxisValue(p[1], mark.axes.y, ext[1]),
      mapAxisValue(p[2], mark.axes.z, ext[2]),
    ]);
    for (let i = 0; i < mapped.length - 1; i++) {
      polygons.push(...orientedRibbonPolygons(mapped[i]!, mapped[i + 1]!, halfWidth, series.color));
    }
  }
  return polygons;
}

/** Builds the `GlyphSceneObject` for a `GlyphChart3dMark`, dispatching on `mark.type`. Every mark type shares the SAME axis-triad overlay/mesh (`axisTriadOverlay`/`axisTriadLinePolygons`) — only the DATA mesh's own name and geometry differ. */
export function glyphChartObject(mark: GlyphChart3dMark, options: GlyphChart3dObjectOptions = {}): GlyphSceneObject {
  const id = options.id ?? mark.type;
  const ext = mark.aspect;
  // A live scene consumer (`/charts`' own orbit viewport) mounts this
  // object directly with no `renderGlyphChart3d` charset resolution step of
  // its own — `charset` defaults to `"box"` (the richest line-art tier).
  const charset = options.charset ?? "box";
  const overlays: GlyphSceneOverlay[] = [axisTriadOverlay(mark, ext, charset)];
  const meshes: GlyphSceneObjectMesh[] = [];
  let textureSamplers: Map<string, TextureSampler> | undefined;

  switch (mark.type) {
    case "surface": {
      meshes.push({ name: "surface", polygons: buildSurfaceMesh(mark, id) });
      if (mark.shading === "value") {
        textureSamplers = new Map([[GLYPH_CHART_3D_VALUE_STRIP_TEXTURE_KEY, buildValueStripTexture()]]);
      }
      break;
    }
    case "scatter3d":
      meshes.push({ name: "points", polygons: buildScatterMesh(mark, Boolean(options.monochrome)) });
      break;
    case "parametric3d":
      meshes.push({ name: "surface", polygons: buildParametricMesh(mark) });
      break;
    case "bars3d":
      meshes.push({ name: "bars", polygons: buildBarsMesh(mark) });
      break;
    case "line3d":
      meshes.push({ name: "line", polygons: buildLineMesh(mark) });
      break;
    default: {
      const exhaustive: never = mark;
      throw new TypeError(`glyphcss: unknown 3D mark type ${JSON.stringify((exhaustive as { type?: unknown }).type)}.`);
    }
  }

  // C2 fix round 7: the axis LINES are their own mesh, real ribbon
  // geometry, built once (the origin corner never moves) — omitted
  // entirely when NO axis's own line resolves visible, mirroring every
  // other guide toggle's own "the thing simply isn't drawn" contract; C7
  // resolves that PER AXIS (`axisVisible`/`axisRenderColor`) rather than as
  // one flat `guides.axisLines` gate, so `axes.z.line: false` alone omits
  // just the z segment while x/y still mount theirs.
  {
    const corner = resolveOriginCorner(mark.corner);
    const linePolygons = axisTriadLinePolygons(
      corner, ext,
      (axis) => axisRenderColor(axisAt(mark, axis), mark),
      (axis) => axisVisible(axisAt(mark, axis).lineVisible, mark.guides.axisLines),
    );
    if (linePolygons.length > 0) meshes.push({ name: "axis-lines", polygons: linePolygons });
  }
  return {
    id,
    meshes,
    overlays,
    ...(textureSamplers ? { textureSamplers } : {}),
    bounds: { min: [0, 0, 0], max: [ext[0], ext[1], ext[2]] },
  };
}
