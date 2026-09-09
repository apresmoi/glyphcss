/**
 * The /maps page's street-level WALK gate: when the Dock's Walk toggle is
 * live, and what it says when it is not.
 *
 * Walk mode is a CAMERA MODE, not a layer feature. It puts the eye 1.7 m off
 * the ground and swaps a perspective camera in; what it renders is whatever
 * is mounted — OpenStreetMap buildings, a relief mesh, both, neither. Walking
 * up a ridge with only terrain on is the same code path as walking down a
 * street, because the walker's height comes from `groundElevationSampler`,
 * which answers off the mounted `raster` layers' own tiles for ANY raster
 * layer (and answers `null`, i.e. the datum, when none is mounted — correct,
 * not an error). So this gate says nothing at all about WHICH layers are on.
 *
 * Two things have to be true, and each has a reason a reader can act on
 * rather than an inert control — the idiom `mapDirectionLocked` and
 * `charModeReason` already use:
 *
 *  1. **The globe.** Geometry, not preference. A flat sheet puts X/Y in
 *     DEGREES and Z in Earth radii, so a 20 m building on this page's
 *     equirectangular sheet is drawn 85x too short relative to its own
 *     footprint and is invisible from the ground; the same anisotropy
 *     flattens a mountain. Only the globe is metrically isotropic.
 *     `setWalk` itself throws a `RangeError` on a sheet, so this gate is what
 *     stops the reader ever reaching that.
 *  2. **Already near the ground.** {@link MAP_WALK_MAX_ENTRY_SPAN_DEG}
 *     below. This is the ALTITUDE clause, and it is the one that makes walk
 *     mode safe at all: it is only because the eye is near the surface that
 *     the Earth is locally flat over the visible frame, which is what lets
 *     walk mode leave `glyphMapGlobe.visible()` and the orthographic path it
 *     was derived for completely alone.
 *
 * Pure, so it is testable without mounting the Dock (which this vitest config
 * cannot do for `MapsWorkbench.tsx` anyway).
 */
import { GLYPH_MAP_WALK_FAR_M, GLYPH_MAP_WALK_MAX_ENTRY_SPAN_DEG } from "@glyphcss/maps";
import type { MapProjectionId } from "./mapsKit";

/** Re-exported so the page states one number and the package owns it. */
export const MAP_WALK_MAX_ENTRY_SPAN_DEG = GLYPH_MAP_WALK_MAX_ENTRY_SPAN_DEG;

/**
 * The zoom level the tile-budget readout is quoted against — the deepest the
 * page's densest source serves (OpenFreeMap's planet is z0-z14). A terrain
 * walk is cheaper still: this page's relief pyramid stops at a curated z7,
 * whose tiles are 2.8 deg across, so a 400 m footprint is one tile.
 */
export const MAP_WALK_TILE_BUDGET_Z = 14;

/**
 * What the reader's device can actually deliver to the walker.
 *
 * Walk mode is driven by `keydown`/`keyup` (WASD, the arrow keys, Shift, G)
 * and by `mousemove` deltas under `requestPointerLock`, released with Esc —
 * that is the whole input surface, read off `@glyphcss/maps`' own widget and
 * its `widget.walk*.test.ts` gates. Neither exists on a phone: iOS Safari
 * ships no Pointer Lock API at all, and a touch device has no keyboard to
 * send those keys from.
 *
 * A CAPABILITY, never a viewport width — a narrow window on a desktop still
 * has both, and a tablet with a keyboard case is a real reader.
 */
export interface MapWalkInput {
  /** `matchMedia("(pointer: coarse)")` — the reader's primary pointer cannot hover or aim a pixel, so there is no mouselook to lock. */
  readonly coarsePointer: boolean;
  /** Whether the browser implements the Pointer Lock API at all. */
  readonly pointerLock: boolean;
}

export interface MapWalkGate {
  readonly projectionId: MapProjectionId;
  /** The live `map.getView().span`, degrees. */
  readonly span: number;
  /**
   * The device. Omitted means "assume a drivable one" — the shape every
   * caller that predates this clause passes, so their verdicts are unchanged.
   */
  readonly input?: MapWalkInput;
}

/**
 * Why this DEVICE cannot drive walk mode, or `null` when it can.
 *
 * Separate from {@link mapWalkReason} because it answers a different kind of
 * question: the projection and the span are things the reader can change, and
 * this is not. Offering touch controls instead would be a feature (a virtual
 * stick, drag-to-look), not a gate — deliberately out of scope here rather
 * than half-built.
 */
export function mapWalkInputReason(input: MapWalkInput): string | null {
  if (input.coarsePointer || !input.pointerLock) {
    return "Walk needs a keyboard and a mouse: you move with WASD or the arrow keys and look around with the mouse under pointer lock, and a touch device has neither. Open this map on a laptop or desktop to walk it.";
  }
  return null;
}

/**
 * Why walk mode is not available right now, or `null` when it is.
 *
 * One string, not a list: a reader fixes one thing, looks again, and gets the
 * next one. Ordered so the answer is always the cheapest thing to change that
 * is still wrong.
 */
export function mapWalkReason(gate: MapWalkGate): string | null {
  // FIRST, ahead of the "cheapest thing to change" ordering below, because
  // this is the one clause the reader cannot act on at all: telling a phone
  // to zoom in to 400 m is a lie, since arriving there still would not let
  // them walk.
  if (gate.input) {
    const device = mapWalkInputReason(gate.input);
    if (device !== null) return device;
  }
  if (gate.projectionId !== "globe") {
    return "Walk needs the globe. On a flat sheet the ground is measured in degrees and height in Earth radii, so anything standing up — a building, a mountain — draws about 85× too short to see from eye level.";
  }
  if (!(gate.span <= MAP_WALK_MAX_ENTRY_SPAN_DEG)) {
    return `Walk needs the view near the ground: zoom in to about ${formatWalkSpan(MAP_WALK_MAX_ENTRY_SPAN_DEG)} across. At eye height you can see ${Math.round(GLYPH_MAP_WALK_FAR_M)} m, so from further out stepping down would discard everything on screen.`;
  }
  return null;
}

/** `mapWalkReason` as a boolean, for the places that only need the verdict. */
export function mapWalkAvailable(gate: MapWalkGate): boolean {
  return mapWalkReason(gate) === null;
}

/**
 * What a shared LINK's walk state means for the page it lands on.
 *
 * A link carries one walk flag and the pose the walker already had — the
 * position, heading and pitch every /maps link has always carried, because
 * walk mode reuses `view.center`, `bearing` and `getTilt()` rather than
 * adding state of its own (`mapsUrlState.ts`'s `MapsUrlState.walk`). This
 * turns that pair into the page's opening state, and it is where the two
 * things a link cannot be trusted about are settled:
 *
 *  1. **The gate is re-run against the link's OWN view**, never assumed.
 *     `map.setWalk` throws a `RangeError` on a flat sheet, and the altitude
 *     clause is what makes the mode geometrically safe at all — so a link
 *     that asks for a walk somewhere it is not permitted (hand-edited, or
 *     written before a projection change) opens the ordinary map instead.
 *     Degrading is the whole contract: never a throw, never a mode the gate
 *     forbids.
 *  2. **The pitch has to be handed back after entry.** The widget's
 *     `setWalk` stands the walker up looking at the horizon
 *     (`tiltRequest = appliedTilt = GLYPH_MAP_WALK_HORIZON_TILT_DEG`),
 *     discarding whatever pitch the camera had — right for a reader stepping
 *     down off the map, wrong for a link that already knows which way the
 *     sender was looking. {@link MapWalkEntry.tilt} is that pitch, in the
 *     widget's own `tilt` units and unconverted (while walking `getTilt()`
 *     IS the pitch, 90 being the horizontal), for the caller to apply with
 *     `map.setTilt` once walk mode is live. The widget owns the clamp into
 *     the neck's range; this owns only the value.
 */
export interface MapWalkLink {
  /** The link's `walk` flag (`MapsUrlState.walk`). */
  readonly walk: boolean;
  readonly projectionId: MapProjectionId;
  /** The link's `span`, degrees — while walking this is the walker's own footprint, so it is inside the gate by construction. */
  readonly span: number;
  /** The link's `tilt`, degrees, in the widget's units — the walker's pitch measured from 90. */
  readonly tilt: number;
}

/** {@link mapWalkLinkEntry}'s verdict. */
export interface MapWalkEntry {
  /** Whether the page opens in walk mode. */
  readonly walking: boolean;
  /** The pitch to re-apply once walk mode is live, or `null` when the page is not entering it. */
  readonly tilt: number | null;
}

export function mapWalkLinkEntry(link: MapWalkLink): MapWalkEntry {
  if (!link.walk || !mapWalkAvailable({ projectionId: link.projectionId, span: link.span })) {
    return { walking: false, tilt: null };
  }
  return { walking: true, tilt: link.tilt };
}

/** A span in degrees as a distance a reader can picture. */
export function formatWalkSpan(spanDeg: number): string {
  const metres = spanDeg * (Math.PI / 180) * 6_371_000;
  return metres >= 1000 ? `${(metres / 1000).toFixed(1)} km` : `${Math.round(metres)} m`;
}

/**
 * How many tiles of a given level the walker's own horizon covers — the tile
 * budget, stated where the reader can see it.
 *
 * This is the whole reason walk mode is affordable and the reason the horizon
 * is capped at {@link GLYPH_MAP_WALK_FAR_M} rather than at the true 4.65 km
 * geometric horizon of a 1.7 m eye. That cap is not an OpenStreetMap concern:
 * a ground-level footprint reaching the horizon costs the same over a
 * mountain range as over a city, and the relief pyramid is swept by the same
 * `view.span` the vector one is.
 *
 * A footprint of `2 * far` metres against a level whose tiles are
 * `360 / (2 * 2^z)` degrees wide, plus the one tile a disc can always
 * straddle on each axis.
 */
export function mapWalkTileBudget(farM = GLYPH_MAP_WALK_FAR_M, z = MAP_WALK_TILE_BUDGET_Z): number {
  const tileDeg = 360 / (2 * 2 ** z);
  const spanDeg = (2 * farM) / ((Math.PI / 180) * 6_371_000);
  const perAxis = Math.ceil(spanDeg / tileDeg) + 1;
  return perAxis * perAxis;
}

/** The Dock's one readout while walking: the horizon, and what it costs at the densest level the page serves. */
export function mapWalkBudgetLabel(farM = GLYPH_MAP_WALK_FAR_M, z = MAP_WALK_TILE_BUDGET_Z): string {
  return `${Math.round(farM)} m · ≤${mapWalkTileBudget(farM, z)} tiles at z${z}`;
}
