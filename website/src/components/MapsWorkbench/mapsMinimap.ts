/**
 * The /maps page's MINIMAP: the plan-view inset that answers "where am I"
 * once the main map has stopped being able to.
 *
 * ## Why it exists
 *
 * At street level — and at any span where the frame is a few hundred metres
 * across — the main map is a picture of a place, not of a location. Walk mode
 * makes that acute: the reader is standing between two buildings under a
 * perspective camera with a 600 m horizon
 * ({@link GLYPH_MAP_WALK_FAR_M}), and nothing on screen says which
 * neighbourhood, which river, which way the main road runs. Every map product
 * that puts a reader on the ground ships the same answer, and has since paper
 * — a small PLAN of the surroundings with the reader at its centre.
 *
 * ## What it is, mechanically
 *
 * A SECOND `createGlyphMap` on its own small host, sharing the page's one
 * OpenStreetMap source instance (`mapsOsm.ts`'s {@link createOsmSource},
 * whose in-flight guard is per-instance, so sharing the object is what makes
 * a shared address a shared REQUEST). It is not a different renderer and not
 * a canvas: the page is an ASCII map and so is its inset.
 *
 * Everything below is pure so it can be tested without mounting either widget
 * — `MapsWorkbench.tsx` cannot be mounted under this vitest config, and
 * happy-dom has no layout to give a second scene.
 */
import {
  GLYPH_MAP_OPENMAPTILES_LAYERS,
  GLYPH_MAP_WALK_FAR_M,
  GLYPH_MAP_WALK_FOV_DEG,
  glyphMapOpenMapTilesFeatureFilter,
  type GlyphMapLayer,
  type GlyphMapVectorSource,
} from "@glyphcss/maps";

/** Metres per degree of great circle — the same conversion `mapsWalk.ts` states, so one page speaks one unit. */
const METRES_PER_DEGREE = (Math.PI / 180) * 6_371_000;

/**
 * The inset's grid.
 *
 * NOT `autoSize`: the widget's default is that `view.cols`/`view.rows` own
 * the grid (MAPS.md §3b), and an inset whose resolution followed a CSS box
 * would move its own tile LOD every time the page reflowed. 48x26 at the 7px
 * cell {@link maps-workbench.css} gives it is a ~202x182 px box — a corner
 * overlay, and 1,248 cells against the main map's 8,820.
 */
export const MAP_MINIMAP_COLS = 48;
export const MAP_MINIMAP_ROWS = 26;

/**
 * How wide the inset is, in metres of ground — 2.5x the walker's own horizon.
 *
 * Two constraints pin this, and they close on each other:
 *
 *  1. **It has to show more than you can already see.** The walker's horizon
 *     is a 600 m radius, so anything at or below 2x {@link
 *     GLYPH_MAP_WALK_FAR_M} is a picture of the frame the reader is already
 *     looking at. 2.5x puts the horizon disc at 80% of the half-width: the
 *     cone is unmistakably the middle of the inset, and there is a real
 *     ring of context outside it.
 *  2. **It has to land on a tile level that HAS buildings.** OpenMapTiles
 *     serves `building` from z13, and `glyphMapTargetLOD` picks the
 *     shallowest level whose native cell is no coarser than the view's own
 *     `span / cols`. At 48 cols this span is 2.81e-4 deg/cell, which falls
 *     between z13's 1.72e-4 and z12's 3.43e-4 — so z13, the shallowest level
 *     that carries a building at all. One notch wider and the buildings row
 *     is silently empty; z14 would need the span under 916 m, i.e. narrower
 *     than the horizon it is supposed to contain.
 */
export const MAP_MINIMAP_SPAN_M = 2.5 * GLYPH_MAP_WALK_FAR_M;

/** {@link MAP_MINIMAP_SPAN_M} as the widget's own unit. */
export const MAP_MINIMAP_SPAN_DEG = MAP_MINIMAP_SPAN_M / METRES_PER_DEGREE;

/** How much ground one inset cell covers, metres — the unit both update thresholds are quoted in. */
export const MAP_MINIMAP_METRES_PER_CELL = MAP_MINIMAP_SPAN_M / MAP_MINIMAP_COLS;

/**
 * How far the reader must travel before the inset is re-centred, metres.
 *
 * HALF A CELL. Below that the re-render is provably almost the same picture:
 * no feature can have moved a whole character, and the "you are here" dot is
 * fixed at the centre either way, so the entire visible consequence is that
 * the reader's true position is up to half a cell off centre — 15 m on a
 * 1,500 m plan. At the walker's 6 m/s that is an update every ~2.5 s instead
 * of one per displayed frame.
 */
export const MAP_MINIMAP_MOVE_M = MAP_MINIMAP_METRES_PER_CELL / 2;

/**
 * How far the reader must turn before the inset is re-oriented, degrees.
 *
 * The inset is HEADING-UP, so a turn rotates the whole picture and the
 * threshold is an angle rather than a distance. One CELL at the inset's own
 * half-width is the smallest step that changes anything at all:
 * `atan(31.25 m / 750 m)` = 2.4 deg. Rounded to 2.5, which also divides the
 * compass into 144 steps — the residual the cone is drawn wrong by between
 * steps, and 2.5 deg of that is below what an eye reads off a 200 px inset.
 */
export const MAP_MINIMAP_TURN_DEG = 2.5;

/**
 * The widest main-map span the inset is worth drawing at, degrees.
 *
 * DERIVED: an overview that shows less than four times the area of the map it
 * overviews is not an overview, it is a crop. Half the inset's width each
 * way is exactly that factor of four, so the ceiling is half
 * {@link MAP_MINIMAP_SPAN_DEG} — 750 m, which is street scale and is where
 * the reader's complaint starts. Above it the main map IS the overview and
 * the inset would be a second, worse copy of it; at globe scale it would be
 * a 1,500 m dot.
 */
export const MAP_MINIMAP_MAX_MAIN_SPAN_DEG = MAP_MINIMAP_SPAN_DEG / 2;

export interface MapMinimapGate {
  /** Whether street-level walk mode is live (`MapsWorkbench`'s `walkOn`). */
  readonly walking: boolean;
  /** The live `map.getView().span`, degrees. */
  readonly span: number;
}

/**
 * Whether the inset is on screen.
 *
 * Walking, ALWAYS — that is the mode with no orientation of its own, and the
 * one the whole thing was asked for. Otherwise only once the main view is
 * inside {@link MAP_MINIMAP_MAX_MAIN_SPAN_DEG}.
 */
export function mapMinimapVisible(gate: MapMinimapGate): boolean {
  return gate.walking || gate.span <= MAP_MINIMAP_MAX_MAIN_SPAN_DEG;
}

/** Where the inset is looking — the only two numbers it takes from the main map. */
export interface MapMinimapPose {
  readonly lon: number;
  readonly lat: number;
  /** The main map's heading, degrees. While walking this IS the walker's heading (`GlyphMapWalkState.heading`). */
  readonly bearing: number;
}

/**
 * Ground distance between two lon/lats, metres.
 *
 * Equirectangular, with the longitude leg scaled by `cos(lat)`. Over the tens
 * of metres this is ever asked about, the difference from a haversine is
 * parts per billion, and it costs one `cos`.
 */
export function mapMinimapMetresApart(a: MapMinimapPose, b: MapMinimapPose): number {
  const midLat = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  let dLon = b.lon - a.lon;
  // The antimeridian: a step across it is a step, not half a planet.
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  const x = dLon * Math.cos(midLat);
  const y = b.lat - a.lat;
  return Math.hypot(x, y) * METRES_PER_DEGREE;
}

/** Shortest angular distance between two headings, degrees, always in `[0, 180]`. */
export function mapMinimapTurnApart(a: MapMinimapPose, b: MapMinimapPose): number {
  const d = Math.abs(((b.bearing - a.bearing) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/** What {@link mapMinimapPoseStep} decides: which of the two writes the inset actually owes. */
export interface MapMinimapPoseStep {
  /** Re-centre the inset on `next` (`map.setView`). */
  readonly move: boolean;
  /** Re-orient the inset to `next` (`map.setBearing`). */
  readonly turn: boolean;
}

/**
 * THE UPDATE RULE — the whole reason a second widget is affordable.
 *
 * Both of the inset's writes (`setView`, `setBearing`) rerender the scene
 * SYNCHRONOUSLY, so pushing the main map's pose through on every `move` event
 * would buy one or two extra full renders per displayed frame for a picture
 * that had not changed. Each write is therefore gated on its own threshold,
 * and each threshold is the point below which the rendered characters cannot
 * differ: half a cell of travel ({@link MAP_MINIMAP_MOVE_M}) and one cell of
 * rotation at the edge ({@link MAP_MINIMAP_TURN_DEG}).
 *
 * They are decided SEPARATELY, not as one "pose changed" verdict, because
 * they cost separately: walking in a straight line owes one write, not two.
 *
 * `prev === null` is the first pose after a mount and owes nothing — the
 * widget was constructed at that pose.
 */
export function mapMinimapPoseStep(prev: MapMinimapPose | null, next: MapMinimapPose): MapMinimapPoseStep {
  if (prev === null) return { move: false, turn: false };
  return {
    move: mapMinimapMetresApart(prev, next) >= MAP_MINIMAP_MOVE_M,
    turn: mapMinimapTurnApart(prev, next) >= MAP_MINIMAP_TURN_DEG,
  };
}

/** The pose the inset holds after applying `step` — the fields it did NOT write keep their old values. */
export function mapMinimapAppliedPose(prev: MapMinimapPose, next: MapMinimapPose, step: MapMinimapPoseStep): MapMinimapPose {
  return {
    lon: step.move ? next.lon : prev.lon,
    lat: step.move ? next.lat : prev.lat,
    bearing: step.turn ? next.bearing : prev.bearing,
  };
}

/** The inset's ground colour — the page's own near-black, so an area with no data reads as "no data" rather than as a hole in the page. */
export const MAP_MINIMAP_BACKGROUND = "#0b0f16";

/**
 * Which OpenStreetMap rows the inset draws, in draw order.
 *
 * Three, and every one of them chosen for a plan view:
 *
 *  - **water** as `fill`, because a river or a lake is the single strongest
 *    orientation cue a city plan has;
 *  - **buildings** as `fill` and NEVER `fill-extrusion` — this is a PLAN, and
 *    an extrusion here would be four walls and a roof per building rendered
 *    top-down, i.e. the cost of a 3D layer for the silhouette a flat
 *    footprint already gives;
 *  - **roads** as `line`, which is what the reader is standing in.
 *
 * Every one is derived from {@link GLYPH_MAP_OPENMAPTILES_LAYERS}, the same
 * table the page's OSM card mounts from, so a source layer, a class filter or
 * a colour cannot drift between the map and its own inset.
 *
 * They are mounted whether or not the reader has the page's OSM card on: the
 * inset is an instrument, not a view of the card, and an inset with no
 * streets in it answers no question.
 */
export function mapMinimapLayers(source: GlyphMapVectorSource): readonly GlyphMapLayer[] {
  return [
    { type: "background", id: "minimap-background", color: MAP_MINIMAP_BACKGROUND },
    minimapFill("omt-water", "minimap-water"),
    minimapFill("omt-buildings", "minimap-buildings"),
    minimapLine("omt-roads", "minimap-roads"),
  ];

  function spec(id: string) {
    const found = GLYPH_MAP_OPENMAPTILES_LAYERS.find((s) => s.id === id);
    if (!found) throw new RangeError(`glyphcss/maps website: no OpenMapTiles spec "${id}" for the minimap.`);
    return found;
  }
  function minimapFill(specId: string, id: string): GlyphMapLayer {
    const s = spec(specId);
    return {
      type: "fill", id, source, sourceLayer: s.sourceLayer,
      // `geometry` alone for buildings, `geometry` + the spec's own classes
      // for anything that declares them — the same filter the card mounts,
      // rebuilt because the card's `fill-extrusion` row is the wrong TYPE
      // here, not the wrong data.
      filter: glyphMapOpenMapTilesFeatureFilter({ geometry: s.geometry, classes: s.classes }),
      color: s.color,
    };
  }
  function minimapLine(specId: string, id: string): GlyphMapLayer {
    const s = spec(specId);
    return {
      type: "line", id, source, sourceLayer: s.sourceLayer,
      filter: glyphMapOpenMapTilesFeatureFilter({ geometry: s.geometry, classes: s.classes }),
      color: s.color,
    };
  }
}

/**
 * The view cone, as a fraction of the inset's own WIDTH.
 *
 * The inset's grid is aspect-locked (`GlyphMapView`), so one metre is the
 * same number of pixels on both axes and the cone is a real circular sector
 * rather than an ellipse — which is why it can be a percentage of one
 * dimension and an `aspect-ratio: 1` box.
 */
export function mapMinimapConeWidthFraction(farM = GLYPH_MAP_WALK_FAR_M, spanM = MAP_MINIMAP_SPAN_M): number {
  return (2 * farM) / spanM;
}

/**
 * The cone as an SVG `d`, in a viewBox whose origin is the walker and whose
 * unit circle is `radius` — apex at the centre, opening straight UP, because
 * the inset is heading-up and "up" is where the reader is facing.
 */
export function mapMinimapConePath(fovDeg = GLYPH_MAP_WALK_FOV_DEG, radius = 100): string {
  const half = (Math.min(Math.max(fovDeg, 0), 359.9) / 2) * (Math.PI / 180);
  const x = radius * Math.sin(half);
  const y = -radius * Math.cos(half);
  const largeArc = fovDeg > 180 ? 1 : 0;
  return `M 0 0 L ${round(-x)} ${round(y)} A ${radius} ${radius} 0 ${largeArc} 1 ${round(x)} ${round(y)} Z`;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** The inset's one-line explanation of itself, for the hover and the screen reader. */
export function mapMinimapLabel(walking: boolean): string {
  const across = `${Math.round(MAP_MINIMAP_SPAN_M)} m across`;
  return walking
    ? `Where you are standing — ${across}, facing up. The wedge is what you can see (${Math.round(GLYPH_MAP_WALK_FAR_M)} m).`
    : `Where the map is looking — ${across}, oriented like the map.`;
}
