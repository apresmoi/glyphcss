/**
 * Street-level WALK mode — the pure half.
 *
 * `createGlyphMap` navigates by orbiting an ORTHOGRAPHIC camera about a
 * surface point. Walk mode replaces that camera with a POSITIONED
 * PERSPECTIVE one at eye height and steps its position geodesically. This
 * file holds every part of that which is a function of numbers alone: the
 * lens, the step, and the footprint. The widget owns the camera, the input
 * and the tile sweep.
 *
 * ## Why it is a GATED mode and not a general capability
 *
 * The widget's tile sweep, `unprojectSphere`, `fill-extrusion` wall culling
 * and marker visibility all consult `glyphMapGlobe.visible()`, whose own doc
 * says it is derived for the orthographic camera ("the sphere's silhouette
 * is a CYLINDER of radius `radius` about the view axis"). Measured under a
 * positioned perspective camera at 1.7 m it reports the ground ONE METRE IN
 * FRONT OF THE WALKER invisible, and every one of those consumers fails
 * together — a blank map, not a degraded one. Generalising it is a real
 * interface change to a heavily-tested capability that serves a camera walk
 * mode does not use.
 *
 * Walk mode does not need it. Over the few hundred metres a walker can see,
 * the Earth is locally flat: the visibility question reduces to "is this
 * within `far` metres of where I am standing", which is
 * {@link glyphMapWalkFootprint} and {@link glyphMapWalkWithinHorizon} — two
 * closed-form tests with no camera in them at all. So the widget branches on
 * "walk mode is active", `projection.visible` is never consulted while it
 * is, and the orthographic path is untouched.
 *
 * ## The lens
 *
 * glyphcss's non-`eyeMode` perspective camera is the browser's own CSS
 * `perspective: Npx` math, and three of its knobs are entangled:
 *
 * ```
 *   near-plane distance   d_near = P / BASE_TILE / 100   world units
 *   horizontal FOV        tan(fov/2) = 25 * W / (zoom * P)
 *   the eye sits          P / BASE_TILE world units behind camera.target
 * ```
 *
 * `P` alone sets the near plane; the product `zoom * P` alone sets the FOV;
 * and `P` ALSO sets how far in front of the eye `camera.target` has to be
 * put. So {@link glyphMapWalkLens} solves the first two from a
 * metre-denominated near plane and a field of view, and the caller never has
 * to think in CSS pixels — but the third is why a lens change is a POSE
 * change here, and why every look re-poses (see {@link
 * GLYPH_MAP_WALK_LOOK_DEG_PER_PX}).
 *
 * ## Why `P` is a four-orders-of-magnitude-below-one-pixel number, and right
 *
 * `website/src/pages/examples/parthenon.astro` is the reference FPV, and its
 * lens model is a REAL CSS-pixel focal length (`FPV_PERSPECTIVE = 1000`)
 * scaled with the rendered width so the horizontal FOV stays put across a
 * phone and a desktop. That model cannot be lifted verbatim, because the
 * parthenon is authored at 1 world unit = 1 METRE and this package's world
 * unit is an EARTH RADIUS: at `P = 1000` the near plane above is
 * `1000 / 50 / 100 = 0.2` world units, i.e. 1,274 km in front of the eye,
 * which clips the entire planet.
 *
 * Solved in the map's own units the same lens comes out at
 * `P = 0.5 / 6371000 * 50 / 0.01 = 3.9240e-4` CSS pixels at the default
 * entry, which looks broken and is not: measured through the real
 * `project()` it produces exactly {@link GLYPH_MAP_WALK_FOV_DEG} degrees of
 * horizontal field of view (`widget.walkLens.test.ts` bisects for the
 * off-axis angle that lands on the last column). What the parthenon's model
 * DOES carry over is the invariant rather than the constant: the FOV must be
 * the same on a narrow viewport as on a wide one, and must be re-solved when
 * the rendered width changes — which is exactly what solving `zoom` from
 * `viewportWidthPx` gives, and what the widget's own resize observer keeps
 * true while walking.
 *
 * `BASE_TILE` is deliberately NOT hardcoded here — the widget recovers it by
 * probing the live camera's own `eyeDepth` (which is affine in the world
 * point, so two evaluations give the slope exactly), so the eye lands where
 * this arithmetic says it does even if glyphcss's constant ever moves.
 */
const DEG = Math.PI / 180;

/** Metres per degree of latitude on the sphere this package models (`GLYPH_MAP_EARTH_RADIUS_M * DEG`). */
const METRES_PER_DEGREE = 6_371_000 * DEG;

/**
 * Eye height, metres. The pedestrian standard (roughly a 1.75 m person's
 * eyes), and the height every camera-arithmetic figure in the spike that
 * preceded this feature was measured at.
 */
export const GLYPH_MAP_WALK_EYE_HEIGHT_M = 1.7;

/**
 * Horizontal field of view, degrees — the parthenon example's own lens.
 *
 * 70 shipped first and was reported as "the buildings are not straight". The
 * camera was measured innocent (a world vertical projects with dcol 0.000 at
 * the centre AND both edges, at every bearing; the view axis is level to
 * within two thousandths of a row; the picture is isotropic to 0.18%), so
 * what the reader is seeing is the LENS being correct: a rectilinear
 * projection magnifies an object at angle t off-axis by exactly 1/cos(t),
 * which at 70 deg means 1.2208x at the frame edge. Nothing is bent — wide
 * angle simply looks like that, and the only lever is the number itself.
 * 56 deg puts the edge at 1.1126x, and it is the focal length the walkthrough
 * this mode was modelled on already uses.
 */
export const GLYPH_MAP_WALK_FOV_DEG = 56;

/**
 * Near plane, metres. Half a metre is closer than a walker can put their
 * face against a wall, and it is what sets `P` — which then sets the FOV
 * denominator, so it is a lens constant rather than a tuning knob.
 */
export const GLYPH_MAP_WALK_NEAR_M = 0.5;

/**
 * How far the walker can see, metres — the LOCAL horizon, and the whole
 * reason walk mode is affordable.
 *
 * A true geometric horizon at 1.7 m is 4.65 km, whose footprint is 36
 * OpenFreeMap z14 tiles — already at the edge of the widget's measured
 * budget (<= 24 at a city view, never more than 100), and every metre of
 * eye height makes it worse fast: 196 tiles at 10 m, 1,849 at 100 m. It is
 * also where the picture stops working: past ~400 m a building is a couple
 * of rows tall and the far field reads as an undifferentiated band, so this
 * bound is an AESTHETIC requirement that happens to also be the performance
 * one. 400 m at Zurich's latitude is a 4-tile footprint at z14.
 */
export const GLYPH_MAP_WALK_FAR_M = 400;

/**
 * Walking pace, metres per second.
 *
 * NOT a real walking pace, deliberately. Anatomical walking is ~1.4 m/s and
 * shipping that read as glacial: a first-person camera has none of the
 * peripheral flow, head motion or body sense that make 1.4 m/s feel like
 * walking to a body that is actually doing it, so the only motion cue left
 * is how fast the scene changes — and through a 56 deg lens at a 400 m
 * horizon, that is nearly nothing. Games have always paid the same tax and
 * settled around the same place (Half-Life 3.3 m/s, Minecraft 4.3); this
 * sits there rather than at the anthropometric number, which is honest
 * about being a CAMERA speed, not a gait.
 */
export const GLYPH_MAP_WALK_SPEED_M_PER_S = 6;

/** Multiplier while a Shift key is held — crossing the 400 m horizon in ~22 s, still well inside what the tile sweep keeps up with (3.2 m per 180 ms debounce). */
export const GLYPH_MAP_WALK_RUN_MULTIPLIER = 3;

/**
 * The camera pitch that looks along the LOCAL HORIZONTAL, in the widget's
 * own `tilt` units.
 *
 * This is not a new convention, it is the existing one read at its limit.
 * `tilt` pitches the camera about the surface point under the view centre,
 * and its ceiling is the horizon angle `asin(R / (R + h))`, which opens to
 * 90 deg as the altitude `h` goes to zero. At `tilt: 90` the camera's own
 * depth-gradient direction `n` is the local horizontal, so the view axis
 * `-n` is too: the walker is looking dead ahead. `tilt` beyond 90 looks UP.
 * That is why walk mode needs no separate pitch state — the widget's
 * `tiltRequest`/`appliedTilt` pair IS the walker's pitch, and `bearing`
 * (already a rotation about the pivot's local up) IS the walker's heading.
 */
export const GLYPH_MAP_WALK_HORIZON_TILT_DEG = 90;

/**
 * How far above and below the horizontal a walker may look, degrees.
 *
 * 84 puts the clamp at exactly the parthenon's own `FPV_MIN_PITCH = 6` /
 * `FPV_MAX_PITCH = 174`, because both are measured from the same horizontal:
 * that page's `rotX = 90` looks dead ahead and so does
 * {@link GLYPH_MAP_WALK_HORIZON_TILT_DEG}, so `90 -+ 84` IS `6..174`. What
 * the bound is actually protecting is the YAW AXIS, not the picture: at
 * exactly straight up or straight down the view axis is parallel to the axis
 * a heading rotates about, so the heading stops meaning anything and the
 * horizon flips through itself. A few degrees short of the pole is the whole
 * requirement.
 *
 * It was 55, on the argument that "looking far up puts the true horizon back
 * in shot, which is what the `far` cap exists to keep out". That argument is
 * backwards — looking UP removes ground from the frame, it never adds any —
 * and the cost was real: at 55 a reader standing 20 m from a building could
 * not see the top of anything taller than 28 m, which in a city is most of
 * what they came to look at.
 */
export const GLYPH_MAP_WALK_MAX_PITCH_DEG = 84;

/**
 * Mouselook sensitivity, degrees per pixel of mouse travel under pointer
 * lock. `createGlyphFirstPersonControls`' own `lookSensitivity` default, so
 * a walk on the map and a walk through the parthenon aim at the same rate.
 *
 * Deliberately NOT the map's own `GLYPH_MAP_BEARING_DRAG_DEG_PER_PX` (0.8)
 * or `GLYPH_MAP_TILT_DRAG_DEG_PER_PX` (0.5): those are DIRECT-MANIPULATION
 * rates, tuned so a grabbed map follows the hand, and a first-person camera
 * is not being grabbed — the pointer is captured and the hand has the whole
 * desk to travel across. At 0.8 deg/px a 5 px twitch was a 4 degree turn.
 */
export const GLYPH_MAP_WALK_LOOK_DEG_PER_PX = 0.15;

/**
 * Drag-to-look sensitivity, degrees per pixel, for the pointers that cannot
 * take a pointer lock — touch, and any mouse whose lock request the browser
 * refuses. The parthenon's own `LOOK_SENS`, and higher than the locked rate
 * for the reason that page implies: a finger has a screen's worth of travel,
 * not a desk's.
 */
export const GLYPH_MAP_WALK_DRAG_DEG_PER_PX = 0.24;

/**
 * The widest `view.span` (degrees) walk mode may be ENTERED from.
 *
 * The ALTITUDE clause, and the one that makes the whole mode safe: it is only
 * because the eye ends up near the surface that the Earth is locally flat
 * over the visible frame, which is what lets walk mode leave
 * `projection.visible` and the orthographic path it was derived for alone.
 *
 * 0.05 deg is ~5.6 km across, ~40 m per cell on a 140-column grid. The number
 * comes from the walker's OWN horizon rather than from any one data source:
 * at eye height the visible footprint is `2 * far` = 800 m, so this is about
 * seven footprints across — close enough that most of what is on screen
 * survives the transition. Wider than that and stepping down discards every
 * tile in frame, which reads as the map blanking rather than as a mode
 * changing. It is deliberately NOT justified by a tile pyramid's depth: walk
 * mode is a CAMERA mode, and a walk over relief has to be offered on the same
 * terms as a walk down a street.
 */
export const GLYPH_MAP_WALK_MAX_ENTRY_SPAN_DEG = 0.05;

/** Options a caller may override; every one has a documented default above. */
export interface GlyphMapWalkOptions {
  /** Eye height above the terrain, TRUE metres. Default {@link GLYPH_MAP_WALK_EYE_HEIGHT_M}. */
  readonly eyeHeight?: number;
  /** Horizontal field of view, degrees. Default {@link GLYPH_MAP_WALK_FOV_DEG}. */
  readonly fov?: number;
  /** Near plane, metres. Default {@link GLYPH_MAP_WALK_NEAR_M}. */
  readonly near?: number;
  /** Local horizon, metres — bounds both the tile footprint and the picture. Default {@link GLYPH_MAP_WALK_FAR_M}. */
  readonly far?: number;
  /** Walking speed, metres per second. Default {@link GLYPH_MAP_WALK_SPEED_M_PER_S}. */
  readonly speed?: number;
  /** Neck limit above/below the horizontal, degrees. Default {@link GLYPH_MAP_WALK_MAX_PITCH_DEG}. */
  readonly maxPitch?: number;
}

/** {@link GlyphMapWalkOptions} with every default filled in — what the widget actually holds while walking. */
export interface GlyphMapResolvedWalkOptions {
  readonly eyeHeight: number;
  readonly fov: number;
  readonly near: number;
  readonly far: number;
  readonly speed: number;
  readonly maxPitch: number;
}

/** What `map.getWalk()` reports while walking (`null` when it is off). */
export interface GlyphMapWalkState extends GlyphMapResolvedWalkOptions {
  /** Where the walker is standing, lon/lat. Same value as `getView().center`. */
  readonly center: readonly [number, number];
  /** Compass heading the walker faces, degrees. Same value as `getBearing()`. */
  readonly heading: number;
  /** Pitch above the horizontal, degrees; `+` looks up. `getTilt() - 90`. */
  readonly pitch: number;
  /** Terrain elevation under the walker's feet, metres — whatever the mounted raster layers report, `0` with none. */
  readonly groundElevation: number;
}

export function resolveGlyphMapWalkOptions(opts: GlyphMapWalkOptions = {}): GlyphMapResolvedWalkOptions {
  return {
    eyeHeight: opts.eyeHeight ?? GLYPH_MAP_WALK_EYE_HEIGHT_M,
    fov: opts.fov ?? GLYPH_MAP_WALK_FOV_DEG,
    near: opts.near ?? GLYPH_MAP_WALK_NEAR_M,
    far: opts.far ?? GLYPH_MAP_WALK_FAR_M,
    speed: opts.speed ?? GLYPH_MAP_WALK_SPEED_M_PER_S,
    maxPitch: opts.maxPitch ?? GLYPH_MAP_WALK_MAX_PITCH_DEG,
  };
}

/** The two numbers a walk pose writes onto a `GlyphPerspectiveCamera`. */
export interface GlyphMapWalkLens {
  /** `camera.perspective` — CSS-perspective distance, virtual pixels. */
  readonly perspective: number;
  /** `camera.zoom` — CSS pixels per world unit. */
  readonly zoom: number;
}

/**
 * Solve `{ perspective, zoom }` for a metre-denominated near plane and a
 * horizontal field of view. See this file's header for the derivation and
 * the parthenon cross-check.
 *
 * `nearWorld` is the near plane in WORLD units (the caller converts metres
 * through the projection, which is the only thing that knows the scale);
 * `viewportWidthPx` is the rendered width the FOV is measured across, i.e.
 * `cols * cellWidth`, so the FOV is invariant to grid resolution exactly as
 * `camera.zoom` is.
 *
 * `baseTilePx` is glyphcss's world-unit-to-perspective-Z factor, which the
 * widget PROBES off the live camera rather than assuming.
 */
export function glyphMapWalkLens(args: {
  readonly nearWorld: number;
  readonly fovDeg: number;
  readonly viewportWidthPx: number;
  readonly baseTilePx: number;
}): GlyphMapWalkLens {
  const { nearWorld, fovDeg, viewportWidthPx, baseTilePx } = args;
  // d_near = P / baseTilePx * PERSPECTIVE_NEAR_FRACTION (0.01), inverted.
  const perspective = (nearWorld * baseTilePx) / 0.01;
  const halfWidthPx = viewportWidthPx / 2;
  const tanHalf = Math.tan((fovDeg / 2) * DEG);
  // tan(fov/2) = (halfWidthPx / zoom) * (baseTilePx / P), inverted for zoom.
  const zoom = (halfWidthPx * baseTilePx) / (tanHalf * perspective);
  return { perspective, zoom };
}

/**
 * One geodesic step on the sphere: from `(lon, lat)`, facing compass
 * `headingDeg`, walk `forward` metres ahead and `strafe` metres to the
 * right, and report where you now stand.
 *
 * The direct spherical formula, not a flat-Earth delta. That matters less
 * for a single 20 mm frame step than for the INTEGRAL of a long walk — a
 * planar step accumulates a heading error with latitude, so a reader walking
 * due north for a kilometre would drift — and it costs four trig calls.
 *
 * Zero displacement returns the input verbatim (not a round trip through
 * `asin`/`atan2`), so a frame with no key held cannot jitter the position.
 */
export function glyphMapWalkStep(
  lon: number,
  lat: number,
  headingDeg: number,
  forwardM: number,
  strafeM: number,
  radiusM = 6_371_000,
): readonly [number, number] {
  const distance = Math.hypot(forwardM, strafeM);
  if (!(distance > 0)) return [lon, lat];
  // A strafe is the same walk under a turned heading: `atan2(right, ahead)`
  // is the offset from the way the walker is facing, so both axes reduce to
  // ONE azimuth and ONE distance rather than two chained steps (which would
  // not commute).
  const azimuth = (headingDeg + (Math.atan2(strafeM, forwardM) / DEG)) * DEG;
  const delta = distance / radiusM;
  const lat1 = lat * DEG;
  const sinLat1 = Math.sin(lat1), cosLat1 = Math.cos(lat1);
  const sinDelta = Math.sin(delta), cosDelta = Math.cos(delta);
  const sinLat2 = Math.max(-1, Math.min(1, sinLat1 * cosDelta + cosLat1 * sinDelta * Math.cos(azimuth)));
  const lat2 = Math.asin(sinLat2);
  const lon2 = lon * DEG + Math.atan2(
    Math.sin(azimuth) * sinDelta * cosLat1,
    cosDelta - sinLat1 * sinLat2,
  );
  const outLon = ((lon2 / DEG + 180) % 360 + 360) % 360 - 180;
  return [outLon, lat2 / DEG];
}

/**
 * The `view.span` (degrees of longitude across the grid) that describes a
 * walk footprint.
 *
 * `view.span` stays meaningful in walk mode because everything downstream of
 * it — tile LOD (`glyphMapTargetLOD` keys on `span / cols`), the URL codec,
 * the Dock's readouts — is written against it and none of them should have
 * to learn about a camera mode. The camera's own framing does NOT come from
 * it while walking (the lens does), so this is a DESCRIPTION of the
 * footprint rather than a control over it.
 */
export function glyphMapWalkSpan(farM: number): number {
  return (2 * farM) / METRES_PER_DEGREE;
}

/**
 * Is `(lon, lat)` inside the walker's LOCAL horizon?
 *
 * The per-point half of {@link glyphMapWalkFootprint} — what replaces
 * `projection.visible` for wall culling and marker/hotspot visibility while
 * walking. Great-circle distance rather than the box, because a box test
 * would keep the corners: a wall at 1.41 x `far` diagonally away is exactly
 * the far-field noise the cap exists to remove.
 */
export function glyphMapWalkWithinHorizon(
  walkerLon: number,
  walkerLat: number,
  lon: number,
  lat: number,
  farM: number,
  radiusM = 6_371_000,
): boolean {
  const phi1 = walkerLat * DEG, phi2 = lat * DEG;
  const dPhi = phi2 - phi1;
  const dLambda = (lon - walkerLon) * DEG;
  const sinHalfPhi = Math.sin(dPhi / 2);
  const sinHalfLambda = Math.sin(dLambda / 2);
  const h = sinHalfPhi * sinHalfPhi + Math.cos(phi1) * Math.cos(phi2) * sinHalfLambda * sinHalfLambda;
  const distance = 2 * radiusM * Math.asin(Math.min(1, Math.sqrt(h)));
  return distance <= farM;
}

/** One movement key's contribution, in the walker's own frame (`+forward` is ahead, `+strafe` is right). */
export interface GlyphMapWalkAxis {
  readonly forward: number;
  readonly strafe: number;
}

/**
 * The movement bindings: WASD and the arrow keys, both, because a reader who
 * has ever played a game reaches for one and a reader who has not reaches
 * for the other.
 *
 * Keyed on `KeyboardEvent.key` LOWERCASED, so a held Shift (the run
 * modifier) does not turn `w` into an unbound `W`. Arrow names are matched
 * case-insensitively by the same lowercasing.
 */
export const GLYPH_MAP_WALK_KEYS: Readonly<Record<string, GlyphMapWalkAxis>> = {
  w: { forward: 1, strafe: 0 },
  arrowup: { forward: 1, strafe: 0 },
  s: { forward: -1, strafe: 0 },
  arrowdown: { forward: -1, strafe: 0 },
  a: { forward: 0, strafe: -1 },
  arrowleft: { forward: 0, strafe: -1 },
  d: { forward: 0, strafe: 1 },
  arrowright: { forward: 0, strafe: 1 },
};

/** The axis a key drives, or `null` for a key walk mode does not claim (which the widget must then leave to the page). */
export function glyphMapWalkAxisForKey(key: string): GlyphMapWalkAxis | null {
  return GLYPH_MAP_WALK_KEYS[key.toLowerCase()] ?? null;
}

/**
 * The net movement axis for a set of held keys, normalized to unit length so
 * a diagonal is not `sqrt(2)` times faster than a straight line. Returns
 * `null` when nothing is held, which is what tells the motion loop it has no
 * walking to do this frame.
 */
export function glyphMapWalkAxis(heldKeys: Iterable<string>): GlyphMapWalkAxis | null {
  let forward = 0, strafe = 0;
  for (const key of heldKeys) {
    const axis = glyphMapWalkAxisForKey(key);
    if (!axis) continue;
    forward += axis.forward;
    strafe += axis.strafe;
  }
  const length = Math.hypot(forward, strafe);
  if (!(length > 0)) return null;
  return { forward: forward / length, strafe: strafe / length };
}
