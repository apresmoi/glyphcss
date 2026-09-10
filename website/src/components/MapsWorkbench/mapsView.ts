/**
 * The View folder's pure half: what the page reads back off the widget every
 * sync, what ranges the Tilt and Bearing sliders offer for it, and when the
 * on-map compass has anything to do.
 *
 * Both live here rather than inside `MapsWorkbench.tsx` for the reason
 * `mapsSearch.ts` gives: that component cannot be mounted under this vitest
 * config, and these two are exactly the parts with a history of drifting out
 * of step with the widget. A readout that omits a field, or a slider whose
 * ceiling is a literal, fails silently — the control simply shows a number
 * the camera does not have.
 */
import type { GlyphMapHandle } from "@glyphcss/maps";

/** Everything the View folder shows that is derived from the widget's own state. */
export interface MapViewReadout {
  readonly centerLon: number;
  readonly centerLat: number;
  readonly span: number;
  readonly maxSpan: number;
  readonly tilt: number;
  readonly maxTilt: number;
  readonly bearing: number;
  readonly cols: number;
  readonly rows: number;
  readonly degPerCell: number;
}

/**
 * The widget's live view state, in the shape the Dock displays.
 *
 * Every field is re-read on EVERY sync, none of them once at mount. Three of
 * them move with the view rather than with the projection:
 *
 *  - `maxSpan` — the cover ceiling follows the projection, the tilt and the
 *    host's shape.
 *  - `maxTilt` — the horizon ceiling is a function of the view's own scale
 *    (`@glyphcss/maps`' `getMaxTilt`): ~21 degrees at a whole-world span,
 *    ~50 at 40 degrees, the 85-degree flat-surface cap by city scale. So it
 *    moves with every wheel notch, and a slider that took it once would let
 *    a reader ask for a pitch that aims past the limb.
 *  - `tilt` — the APPLIED pitch, which is the request clamped to that
 *    ceiling. Without reading it back the slider sat at whatever the page
 *    last wrote (40) while the camera held whatever the ceiling allowed
 *    (21), and the tilt GESTURE — which the page never writes at all —
 *    moved the camera with the slider frozen.
 *
 * `bearing` is here for the SECOND of those reasons and only that one: it has
 * no ceiling to clamp against, but the HORIZONTAL half of the same Ctrl+drag
 * gesture moves it without the page writing it, so a slider that did not read
 * it back would show a stale heading the moment the reader turned the map —
 * the exact defect just fixed for `tilt`.
 */
export function readMapViewState(
  map: Pick<GlyphMapHandle, "getView" | "getMaxSpan" | "getTilt" | "getMaxTilt" | "getBearing">,
): MapViewReadout {
  const v = map.getView();
  return {
    centerLon: v.center[0],
    centerLat: v.center[1],
    span: v.span,
    maxSpan: map.getMaxSpan(),
    tilt: map.getTilt(),
    maxTilt: map.getMaxTilt(),
    bearing: map.getBearing(),
    cols: v.cols,
    rows: v.rows,
    degPerCell: v.span / v.cols,
  };
}

/** A Tweakpane numeric-slider range. */
export interface MapSliderRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/**
 * The Tilt slider's range.
 *
 * `maxTilt` is the widget's own live ceiling ({@link readMapViewState}), not
 * a literal: the pair of literals this replaced (`±70` on an orbit, `5..89`
 * on a sheet) let a reader drag an orbit slider to 70 at a whole-world span,
 * where the widget clamps at ~21 — the control then disagreed with the
 * camera across four fifths of its own travel.
 *
 * The two families keep their different SHAPES, which the ceiling does not
 * settle. A sheet has no view-driven base orientation, so its `tilt` IS the
 * total `camera.rotX` and the range is one-sided from a floor of 5 (a sheet
 * at 0 is edge-on nothing; the page has always started it at 40). An orbit
 * projection's base orientation already comes from `view.center`, so its
 * `tilt` is a signed offset on top of that — head-on at 0, and pitchable in
 * either direction.
 */
export function mapTiltSliderRange(isOrbitProjection: boolean, maxTilt: number): MapSliderRange {
  return isOrbitProjection ? { min: -maxTilt, max: maxTilt, step: 1 } : { min: 5, max: maxTilt, step: 1 };
}

/**
 * The Bearing slider's range: a full compass, `0..360`, one degree a step.
 *
 * FIXED, unlike the Tilt slider's — a heading has no ceiling to follow, on
 * either projection family and at every scale — so this needs no per-sync
 * range push, only the per-sync VALUE push every control in the folder gets.
 *
 * `0..360` rather than `-180..180` because the readout is a COMPASS HEADING
 * and 0..360 is how headings are written; it matches `getBearing()`, which
 * normalizes to `[0, 360)`, so the control and the camera can never disagree
 * about which number names a direction. The cost is a seam at north instead
 * of at south: a gesture turning through 0 makes the HANDLE jump from 359 to
 * 1. That is only a redraw — the slider is written to per sync and never
 * read back into the gesture, so it cannot fight it — and north is the one
 * heading a reader can recognise from the map itself, which makes the jump
 * legible rather than mysterious.
 */
export const MAP_BEARING_SLIDER_RANGE: MapSliderRange = { min: 0, max: 360, step: 1 };

/**
 * The pitch the "Level" control puts the camera back to.
 *
 * Not zero for both families, because zero does not mean the same thing to
 * both. An ORBIT projection's `tilt` is a signed offset on top of
 * `cameraForCenter`, so `0` IS the canonical view — the globe seen head-on,
 * which is what a reader asking to undo a pitch means. A SHEET's `tilt` is
 * the total `camera.rotX`, so `0` there is not "no pitch", it is a plan view
 * looking straight down — a different map from the isometric one this page
 * ships and starts at (`mapsUrlState`'s own default, 40). "Reset" has to
 * mean "put it back the way it was", so each family returns to the pitch the
 * page opened at.
 */
export const MAP_TILT_SHEET_HOME = 40;

export function mapTiltResetValue(isOrbitProjection: boolean): number {
  return isOrbitProjection ? 0 : MAP_TILT_SHEET_HOME;
}

/**
 * How far from {@link mapTiltResetValue} the pitch has to be before the
 * "Level" control appears, in degrees.
 *
 * Half of the gesture's own per-pixel step
 * ({@link import("@glyphcss/maps").GLYPH_MAP_TILT_DRAG_DEG_PER_PX}), so the
 * control shows up on the very first pixel of a pitch gesture and hides again
 * only when the camera is genuinely back home — never flickering on a value
 * a float round-trip left at 1e-14.
 */
export const MAP_TILT_RESET_EPSILON = 0.25;

/** Whether the compass control has anything to do about the PITCH at this angle. */
export function mapTiltIsLevel(tilt: number, isOrbitProjection: boolean): boolean {
  return Math.abs(tilt - mapTiltResetValue(isOrbitProjection)) < MAP_TILT_RESET_EPSILON;
}

/** The heading the compass puts the camera back to. North up, for both projection families — a compass has one home. */
export const MAP_BEARING_HOME = 0;

/**
 * How far from north the heading has to be before the compass counts as
 * turned, in degrees.
 *
 * Half of the bearing gesture's own per-pixel step
 * ({@link import("@glyphcss/maps").GLYPH_MAP_BEARING_DRAG_DEG_PER_PX}), the
 * same rule {@link MAP_TILT_RESET_EPSILON} follows: the control appears on
 * the first pixel of a turn, and hides again only when the map is genuinely
 * back to north.
 */
export const MAP_BEARING_RESET_EPSILON = 0.4;

/**
 * Whether the compass has anything to do about the HEADING.
 *
 * Measured on the SHORT way round, so 359.7 degrees is north — it is a hair
 * anticlockwise of it, not 359.7 degrees away from it. A plain
 * `Math.abs(bearing)` would leave the control permanently up for a reader who
 * turned the map one pixel to the left.
 */
export function mapBearingIsNorth(bearing: number): boolean {
  const off = ((bearing - MAP_BEARING_HOME) % 360 + 360) % 360;
  return Math.min(off, 360 - off) < MAP_BEARING_RESET_EPSILON;
}

/**
 * Whether the map is in its home orientation entirely — level AND north up.
 *
 * One predicate for one control: the compass resets both, so it has to appear
 * when EITHER is off home. Two separate controls would put two buttons in the
 * same corner for one camera; a real map compass does both jobs, and does them
 * with one click.
 */
export function mapOrientIsHome(tilt: number, bearing: number, isOrbitProjection: boolean): boolean {
  return mapTiltIsLevel(tilt, isOrbitProjection) && mapBearingIsNorth(bearing);
}
