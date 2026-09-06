/**
 * The View folder's pure half: what the page reads back off the widget every
 * sync, and what range the Tilt slider offers for it.
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
 */
export function readMapViewState(
  map: Pick<GlyphMapHandle, "getView" | "getMaxSpan" | "getTilt" | "getMaxTilt">,
): MapViewReadout {
  const v = map.getView();
  return {
    centerLon: v.center[0],
    centerLat: v.center[1],
    span: v.span,
    maxSpan: map.getMaxSpan(),
    tilt: map.getTilt(),
    maxTilt: map.getMaxTilt(),
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

/** Whether the "Level" control has anything to do at this pitch. */
export function mapTiltIsLevel(tilt: number, isOrbitProjection: boolean): boolean {
  return Math.abs(tilt - mapTiltResetValue(isOrbitProjection)) < MAP_TILT_RESET_EPSILON;
}
