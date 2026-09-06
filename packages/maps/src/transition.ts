/**
 * Animated projection transitions (MAPS.md §13 slice 4). Projection is
 * applied CLIENT-SIDE per vertex (slice 2's headline decision — see
 * `projection.ts`), so morphing between two projections is a matter of
 * building a third `GlyphMapProjection` whose `project()` answers for blend
 * fraction `t`. `glyphMapProjectionTransition(a, b, t)` builds exactly that,
 * on ONE of two paths, picked by CAPABILITY (never by `projection.id`):
 *
 * - **Sheet <-> sheet** (neither endpoint has `cameraForCenter`, or both do):
 *   the per-component LERP of `a.project()` and `b.project()`. Two flat maps
 *   are already the same kind of surface at the same world scale, so the
 *   straight-line average of their vertex positions IS a flat map the whole
 *   way through — equirectangular -> Mercator is a well-behaved 2D morph and
 *   needs nothing more.
 *
 * - **Orbit <-> sheet** (exactly one endpoint has `cameraForCenter` — the
 *   globe) WITH an `anchor`: an UNWRAP. The lerp is wrong here, and visibly so: a sphere and a
 *   flat sheet are neither the same shape nor the same world scale
 *   (`glyphMapGlobe`'s default radius is 1 world unit for the whole planet;
 *   `glyphMapEquirectangular`'s world unit is one DEGREE, ~57x larger per
 *   unit of arc), so at t=0.5 every vertex sits on the straight line between
 *   a point on the sphere and a point on a sheet 57x its size. The sphere
 *   collapses THROUGH its own interior toward the sheet, the intermediate
 *   surface is not a coherent shape at all, and — because a caller lerps
 *   `camera.zoom` linearly while the geometry's own extent lerps linearly
 *   too — the on-screen size is the PRODUCT of two linear ramps running in
 *   opposite directions, which bulges hard in the middle. Measured on
 *   globe <-> equirectangular (world extent x the linearly-lerped camera
 *   zoom, sampled at 0.1 steps): 114.6 at t=0, peaking at 5683.9 at t=0.5,
 *   back to 390.0 at t=1 — a 49.6x mid-flight zoom-in followed by a 14.6x
 *   zoom-out, in both directions. That is the "it's like a zoom in and zoom
 *   out" the unwrap path exists to fix; see {@link buildUnwrapProject}.
 *
 *   The `anchor` (normally the caller's view centre) is what ENGAGES this
 *   path — an orbit<->sheet pair with no anchor keeps the lerp. See
 *   {@link GlyphMapProjectionTransitionOptions.anchor} for why the unwrap
 *   cannot place its surface without knowing where the caller is looking.
 *
 * What this file deliberately does NOT attempt: a blended projection's
 * `unproject()` — see its own doc below — and a blended projection's camera
 * FRAMING for an orbit-navigated endpoint (the globe) — `cameraForCenter`/
 * `centerForCamera` take `(lon, lat)` with no `t` parameter and no slot for
 * a translation, so they cannot represent "this projection's frame at blend
 * fraction t" at all; a caller that needs to interpolate camera framing
 * across a sheet<->orbit transition (`createGlyphMap`'s `setProjection` is
 * the reference caller) does so itself, from the two ENDPOINT projections'
 * own capabilities, not from anything exposed here.
 */

import type { Vec3 } from "glyphcss";
import type { GlyphMapProjection } from "./projection";
import type { GlyphMapBounds } from "./types";

const DEG = Math.PI / 180;
const HALF_PI = Math.PI / 2;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function isFiniteVec3(v: Vec3): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

/**
 * `project()`'s own NaN convention ("crop, don't clamp" — projection.ts):
 * `[NaN, NaN, NaN]` means "outside this projection's valid window". A blend
 * where EITHER endpoint is outside its window must stay `[NaN, NaN, NaN]` —
 * never interpolate against a NaN (which propagates a single NaN coordinate
 * while leaving the other two as a nonsense partial position) and never
 * substitute 0 (which would drag the vertex to the origin and draw a
 * garbage strip across the map, exactly the failure mode "crop, don't
 * clamp" exists to prevent in a single projection). So the check is
 * ALL-OR-NOTHING and per-endpoint, not per-component: if any component of
 * EITHER endpoint is non-finite, the whole result is `[NaN, NaN, NaN]`.
 * Both blend paths below share this rule — the unwrap needs BOTH endpoints
 * evaluated anyway (the sheet's for the developed map position, the orbit's
 * for the relief displacement), so neither path can quietly render a vertex
 * the other would have cropped.
 */
function blendVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  if (!isFiniteVec3(a) || !isFiniteVec3(b)) return [NaN, NaN, NaN];
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/**
 * A coarse over-approximation, matching `domain`'s own documented role
 * (projection.ts: "a coarse lon/lat BOUNDING BOX for tile culling... the
 * authoritative per-point validity check is `project()` itself"). The union
 * (not the intersection) is the safe direction for a culling box: it can
 * only ever admit an extra tile a mid-transition frame doesn't actually
 * need, never wrongly exclude one this frame DOES need, which an
 * intersection could do the moment the blend leans toward the wider
 * endpoint.
 */
function unionBounds(a: GlyphMapBounds, b: GlyphMapBounds): GlyphMapBounds {
  return {
    west: Math.min(a.west, b.west),
    east: Math.max(a.east, b.east),
    south: Math.min(a.south, b.south),
    north: Math.max(a.north, b.north),
  };
}

/** An ORBIT projection — geometry fixed in world space, navigated by orbiting the camera around it. Capability presence, never `id` (projection.ts / widget.ts follow the same rule everywhere). */
function isOrbitProjection(p: GlyphMapProjection): boolean {
  return !!(p.cameraForCenter && p.centerForCamera);
}

/**
 * World units per DEGREE of arc along the equator at `lon0` — each
 * projection's own linear scale, measured through its public `project()`
 * rather than read off a constructor option this function never sees. This
 * is the quantity the unwrap's scale schedule interpolates, and the quantity
 * `createGlyphMap.computeZoomForSpan` inverts to get `camera.zoom`, so the
 * two are talking about the same number.
 */
function degreeScaleAt(p: GlyphMapProjection, lon0: number): number | null {
  const eps = 1e-4;
  const west = p.project(lon0 - eps, 0, 0);
  const east = p.project(lon0 + eps, 0, 0);
  if (!isFiniteVec3(west) || !isFiniteVec3(east)) return null;
  const s = Math.hypot(east[0] - west[0], east[1] - west[1], east[2] - west[2]) / (2 * eps);
  return Number.isFinite(s) && s > 0 ? s : null;
}

/**
 * The same measure as {@link degreeScaleAt}, but taken AT the anchor's own
 * latitude rather than on the equator, and taken from a LOCAL central
 * difference that never touches a far, possibly-cropped sample — the exact
 * shape `createGlyphMap.computeZoomForSpan` uses to fit a sheet projection's
 * `camera.zoom` (its `rateEstimate`), so the two agree cell for cell about
 * how big a degree is where the caller is looking.
 *
 * The unwrap needs the equatorial one instead: its tangency is always on the
 * equator (see {@link GlyphMapProjectionTransitionOptions.anchor}), so that
 * is where its cap's arc-length scale is defined. Two different questions,
 * two functions, deliberately not merged.
 */
function anchorScaleAt(p: GlyphMapProjection, lon: number, lat: number): number | null {
  const eps = 1e-4;
  const west = p.project(lon - eps, lat, 0);
  const east = p.project(lon + eps, lat, 0);
  if (!isFiniteVec3(west) || !isFiniteVec3(east)) return null;
  const s = Math.hypot(east[0] - west[0], east[1] - west[1], east[2] - west[2]) / (2 * eps);
  return Number.isFinite(s) && s > 0 ? s : null;
}

/**
 * The lon/lat points {@link sphereRadiusOf} checks. Deliberately spread over
 * both hemispheres, both signs of longitude, a pole and the antimeridian: an
 * origin-centred sphere is a 3-parameter claim (radius, centre, graticule
 * orientation) and a probe clustered near one point would confirm the radius
 * while missing a rotated or off-centre graticule.
 */
const SPHERE_PROBE_POINTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [90, 0],
  [180, 0],
  [-90, 45],
  [30, -60],
  [0, 90],
];

/**
 * The orbit endpoint's sphere radius, or `null` if it is not an
 * origin-centred sphere carrying the ordinary equirectangular graticule
 * (`X = r cos(lat) cos(lon)`, `Y = r cos(lat) sin(lon)`, `Z = r sin(lat)` —
 * {@link import("./projection").glyphMapGlobe}'s documented, chirality-pinned
 * frame).
 *
 * The unwrap develops the orbit endpoint as that graticule, which is the ONE
 * development under which re-wrapping at full curvature reproduces the
 * sphere EXACTLY. `cameraForCenter` promises "navigated by orbiting", not
 * "is that specific sphere", so this VERIFIES the geometry instead of
 * inferring it from the capability — a future orbit projection with a
 * different shape falls back to the plain lerp (a worse animation, but never
 * a discontinuity at t->0). Six `project()` calls, once per transition build
 * (i.e. once per animation frame), not once per vertex.
 */
function sphereRadiusOf(p: GlyphMapProjection): number | null {
  const anchor = p.project(0, 0, 0);
  if (!isFiniteVec3(anchor)) return null;
  const radius = Math.hypot(anchor[0], anchor[1], anchor[2]);
  if (!Number.isFinite(radius) || radius <= 0) return null;
  for (const [lon, lat] of SPHERE_PROBE_POINTS) {
    const actual = p.project(lon, lat, 0);
    if (!isFiniteVec3(actual)) return null;
    const latR = lat * DEG;
    const lonR = lon * DEG;
    const cosLat = Math.cos(latR);
    const ex = radius * cosLat * Math.cos(lonR);
    const ey = radius * cosLat * Math.sin(lonR);
    const ez = radius * Math.sin(latR);
    if (Math.hypot(actual[0] - ex, actual[1] - ey, actual[2] - ez) > radius * 1e-9) return null;
  }
  return radius;
}

export interface GlyphMapProjectionTransitionOptions {
  /**
   * The `[lon, lat]` the globe<->sheet unwrap is anchored on — normally the
   * caller's own view centre. **Supplying it is what ENGAGES the unwrap**;
   * with no anchor an orbit<->sheet pair falls back to the plain lerp, i.e.
   * to this function's pre-unwrap behaviour exactly.
   *
   * That gate is not caution, it is a hard requirement, and it is worth
   * stating precisely because it is the one thing this file cannot decide for
   * itself. A caller animating a transition interpolates BOTH halves of the
   * camera linearly — `camera.zoom` (which is proportional to `1 /
   * degreeScale` of each endpoint) and `camera.target` (which is the
   * endpoint's own `project(centre)`, so proportional to `degreeScale`).
   * Those two demands are mutually exclusive for any single world-scale
   * schedule: the reciprocal schedule the zoom lerp needs to keep apparent
   * size steady is precisely the one that puts a point `d` degrees from the
   * anchor somewhere other than where the linearly-lerped target expects it.
   * Anchoring the surface ON the view centre resolves it — the anchor point
   * is then placed at `lerp(orbit.project(centre), sheet.project(centre), t)`
   * exactly, which the lerped `camera.target` tracks to within the sphere's
   * own radius — but only a caller knows where it is looking. Without that,
   * an off-centre view would frame empty space (measured on a view centred at
   * 140E: the surface's centre sits ~70 world units, ~2000 screen px, from
   * where the camera is pointing at t=0.5), which is a worse defect than the
   * bulge the unwrap exists to remove.
   *
   * The LATITUDE places the surface; only the LONGITUDE also moves the
   * TANGENCY the peel opens around, and that asymmetry is geometric rather
   * than an omission: the equirectangular development is covariant under
   * rotation about the POLAR axis (a longitude shift is exactly a rotation of
   * the graticule), so a peel tangent at any meridian still re-wraps to the
   * identical sphere at full curvature. A latitude tangency would need a
   * MERIDIONAL rotation, under which the graticule is not covariant — the
   * wrapped surface would no longer coincide with the globe endpoint,
   * breaking the "t=0/t=1 are byte-identical to the endpoints" guarantee this
   * file is built around.
   *
   * Ignored entirely on the sheet<->sheet lerp path, which needs no anchor:
   * two flat maps share a world scale, so a linear position lerp already
   * agrees with a linear target lerp.
   */
  readonly anchor?: readonly [lon: number, lat: number];
}

/**
 * The UNWRAP: `project()` for a globe<->sheet blend, or `null` when the
 * orbit endpoint is not the sphere this construction develops (see
 * {@link sphereRadiusOf}) or either endpoint has no measurable linear scale.
 *
 * `w` is the ORBIT end's weight — `1` is the pure sphere, `0` the pure flat
 * sheet; `1 - w` is the sheet end's weight (`tSheet` below).
 *
 * ## The surface family
 *
 * At every `w` the surface is a real SPHERICAL CAP of radius `rho(w)`,
 * tangent to a fixed anchor point, carrying the map at a fixed arc-length
 * scale. Curvature `1/rho` runs from `1/R` (the globe) to `0` (the plane) —
 * the interpolation is over the SURFACE, not over two unrelated endpoint
 * positions, which is what keeps every intermediate frame a coherent,
 * continuously-flattening shape instead of a straight-line average.
 *
 *     u, v   developed map coordinates, in DEGREES of arc, anchor-relative
 *     lambda = u * DEG * w,  phi = v * DEG * w      (angles shrink with w)
 *     rho    = s / (DEG * w)                        (radius grows as 1/w)
 *
 * `rho * lambda == s * u` for every `w`, so a degree of map is always `s`
 * world units of ARC: the map does not stretch or shrink as it flattens, it
 * only unbends. At `w = 1` the cap closes into the full sphere of radius
 * `s / DEG == R`; as `w -> 0` the cap flattens and `(rho*lambda, rho*phi)`
 * tends to the plane `(s*u, s*v)`.
 *
 * The developed coordinates themselves interpolate between the two
 * endpoints' own developments — plain `(lon - lon0, lat)` for the sphere
 * (its equirectangular graticule) and the sheet's OWN projected plane,
 * expressed in degrees at the sheet's own scale. For an equirectangular
 * sheet those two are identical, so the animation is a pure unbend with no
 * in-plane morph at all; for Mercator the extra term is the latitude
 * stretch, and it rides along as a flat-map morph exactly like the
 * sheet<->sheet path's own.
 *
 * ## Why the scale schedule is RECIPROCAL, not linear
 *
 * On-screen size is `worldScale * camera.zoom`, and a caller animating a
 * transition lerps `camera.zoom` LINEARLY between the two endpoints' zooms
 * (`createGlyphMap.applyProjectionFrame`), each of which is proportional to
 * `1 / degreeScale` of its endpoint. So holding apparent size steady requires
 * `1 / s(t)` to be the LINEAR interpolant — i.e. `s(t)` itself is the
 * reciprocal (harmonic) one. A linear `s(t)` instead multiplies two ramps
 * running in opposite directions, which is precisely the measured
 * mid-transition bulge quoted at the top of this file. With the reciprocal
 * schedule, `extent(t) / s(t)` — the apparent size, up to the caller's fixed
 * pixel width — depends on `w` ALONE, and it grows monotonically by exactly
 * a factor of pi as the sphere opens out: a great circle of circumference
 * `C` presents a diameter of `C/pi` while the same arc laid flat presents
 * its full length `C`. That growth IS the unwrap, and it is monotone.
 *
 * ## Frames and placement
 *
 * The cap is built in the sphere's own frame (north on `+Z`, east on `+Y`,
 * the tangency's outward normal on `+X`) and carried to the sheet's frame
 * (north on `-X`, east on `+Y`, relief on `+Z` — `projection.ts`'s documented
 * flat frame) by a rigid rotation of `-90 * (1 - w)` degrees about `Y`,
 * composed with a `lon0 * w` degree rotation about the polar axis that puts
 * the tangency meridian back where the globe keeps it. Both are exactly
 * identity at their own endpoint, and a rigid rotation changes orientation
 * without touching apparent SIZE, so neither disturbs the monotonicity
 * argument above.
 *
 * The finished cap is then TRANSLATED so its anchor point sits exactly at
 * `lerp(orbit.project(anchor), sheet.project(anchor), tSheet)` — the position
 * a caller's own linearly-lerped `camera.target` is tracking (see
 * {@link GlyphMapProjectionTransitionOptions.anchor}). At either end that
 * translation collapses to the tangency meridian's own endpoint position, so
 * exactness survives it for ANY anchor, latitude included.
 *
 * Relief rides the local surface normal, its magnitude interpolated between
 * the two endpoints' own displacements: radial `|pOrbit| - R` for the
 * sphere, and the sheet's world `Z` (the flat frame puts relief on `Z`
 * alone, so the sheet's `Z` IS its relief displacement). At either end this
 * reproduces that endpoint's relief exactly.
 */
function buildUnwrapProject(
  orbit: GlyphMapProjection,
  sheet: GlyphMapProjection,
  w: number,
  anchor: readonly [number, number],
): GlyphMapProjection["project"] | null {
  const [anchorLon, anchorLat] = anchor;
  const radius = sphereRadiusOf(orbit);
  if (radius === null) return null;
  const orbitScale = degreeScaleAt(orbit, anchorLon);
  const sheetScale = degreeScaleAt(sheet, anchorLon);
  if (orbitScale === null || sheetScale === null) return null;

  const tangentSheet = sheet.project(anchorLon, 0, 0);
  const anchorOrbit = orbit.project(anchorLon, anchorLat, 0);
  const anchorSheet = sheet.project(anchorLon, anchorLat, 0);
  if (!isFiniteVec3(tangentSheet) || !isFiniteVec3(anchorOrbit) || !isFiniteVec3(anchorSheet)) return null;

  const tSheet = 1 - w;
  // The reciprocal (harmonic) schedule — see this function's doc.
  const scale = 1 / lerp(1 / orbitScale, 1 / sheetScale, tSheet);
  const rho = scale / (DEG * w);

  // Rigid frame carry: -90deg about Y at the flat end, identity at the
  // sphere end; the polar rotation returns the tangency meridian to the
  // longitude the globe keeps it at.
  const flatten = HALF_PI * tSheet;
  const cosBeta = Math.cos(flatten);
  const sinBeta = Math.sin(flatten);
  const polar = anchorLon * DEG * w;
  const cosPolar = Math.cos(polar);
  const sinPolar = Math.sin(polar);

  // The sheet's own developed map, in degrees at its own scale, measured
  // from the tangency (which is always ON the equator — see the anchor
  // option's doc for why the tangency takes only the longitude).
  const tangentSheetU = tangentSheet[1] / sheetScale;
  const tangentSheetV = -tangentSheet[0] / sheetScale;

  /** The cap position for a point, in the blend's own frame, before placement. */
  const capAt = (lon: number, lat: number, pSheet: Vec3, relief: number): Vec3 => {
    const u = lerp(lon - anchorLon, pSheet[1] / sheetScale - tangentSheetU, tSheet);
    const v = lerp(lat, -pSheet[0] / sheetScale - tangentSheetV, tSheet);
    const lambda = u * DEG * w;
    const phi = v * DEG * w;
    const cosPhi = Math.cos(phi);
    const r = rho + relief;
    // `rho * (cos(phi)cos(lambda) - 1)` written through half-angle versines:
    // `rho` grows as `1/w` while the bracket shrinks as `w^2`, so the naive
    // difference of two large numbers loses most of its significant digits
    // exactly where the surface is flattest.
    const sinHalfPhi = Math.sin(phi / 2);
    const sinHalfLambda = Math.sin(lambda / 2);
    const versine = 2 * sinHalfPhi * sinHalfPhi + cosPhi * 2 * sinHalfLambda * sinHalfLambda;
    const capX = -rho * versine + relief * cosPhi * Math.cos(lambda);
    const capY = r * cosPhi * Math.sin(lambda);
    const capZ = r * Math.sin(phi);
    const spunX = capX * cosPolar - capY * sinPolar;
    const spunY = capX * sinPolar + capY * cosPolar;
    return [spunX * cosBeta - capZ * sinBeta, spunY, spunX * sinBeta + capZ * cosBeta];
  };

  const capAnchor = capAt(anchorLon, anchorLat, anchorSheet, 0);
  const placeX = lerp(anchorOrbit[0], anchorSheet[0], tSheet) - capAnchor[0];
  const placeY = lerp(anchorOrbit[1], anchorSheet[1], tSheet) - capAnchor[1];
  const placeZ = lerp(anchorOrbit[2], anchorSheet[2], tSheet) - capAnchor[2];

  return (lon, lat, elev) => {
    const pSheet = sheet.project(lon, lat, elev);
    const pOrbit = orbit.project(lon, lat, elev);
    if (!isFiniteVec3(pSheet) || !isFiniteVec3(pOrbit)) return [NaN, NaN, NaN];
    const relief = lerp(Math.hypot(pOrbit[0], pOrbit[1], pOrbit[2]) - radius, pSheet[2], tSheet);
    const cap = capAt(lon, lat, pSheet, relief);
    return [cap[0] + placeX, cap[1] + placeY, cap[2] + placeZ];
  };
}

/**
 * How close two sheets' degree scales must be for the plain lerp to already
 * be uniformly paced — a relative difference below this and
 * {@link buildSheetBlendProject} declines, so equirectangular <-> Mercator
 * (both exactly one world unit per degree of longitude, at every latitude)
 * keeps the untouched, component-wise `lerp` it has always had.
 */
const SHEET_SCALE_MATCH_EPSILON = 1e-9;

/**
 * The SCALE-NORMALIZED lerp for a sheet <-> sheet pair whose two world scales
 * DIFFER, or `null` when the plain lerp is already right (matching scales, an
 * unmeasurable scale, a cropped anchor).
 *
 * The plain component-wise lerp is only uniformly paced in `t` when both
 * endpoints put a degree at roughly the same number of world units.
 * Equirectangular and Mercator do, so their morph has always been fine.
 * ORTHOGRAPHIC does not: it frames a whole visible hemisphere in ~1 world
 * unit, ~57x smaller per degree than either of the others. `lerp(pOrtho,
 * pEqui, t)` is then numerically dominated by the equirectangular term for
 * all but `t < ~1/58` — so, once the camera is fitted to the surface each
 * frame (`createGlyphMap.applyProjectionFrame`), the map holds the
 * equirectangular SHAPE for ~99% of the flight and snaps into orthographic's
 * limb compression inside the final percent (measured end to end: a rendered
 * terrain's inked-cell count sat flat at 6,240 through `t = 0.9` and then
 * fell to 4,733 over the last 1%). That is the "zoom jump at the end", one
 * layer down from the zoom itself.
 *
 * The fix is to interpolate the two maps in their OWN scale-free units and
 * re-apply an interpolated scale:
 *
 *     q(t) = s(t) * lerp(pA / sA, pB / sB, t) + place(t)
 *
 * `pA / sA` and `pB / sB` are both O(1) per degree, so the SHAPE morphs
 * uniformly in `t`. `s(t)` is the same reciprocal (harmonic) schedule the
 * unwrap uses — with `applyProjectionFrame` now fitting `camera.zoom` to the
 * live blend, the schedule no longer has a linear zoom lerp to cancel and any
 * smooth one would do for apparent size; sharing the unwrap's keeps one story
 * about how a blend's world scale moves.
 *
 * `place(t)` translates the anchor to exactly `lerp(a.project(anchor),
 * b.project(anchor), t)` — the position the caller's own linearly-lerped
 * `camera.target` is pointing at, the same reconciliation
 * {@link buildUnwrapProject} does for the same reason. At `t=0` and `t=1` the
 * translation is exactly zero and `s` is exactly that endpoint's own scale,
 * so both endpoints reproduce their own `project()` to the bit.
 *
 * ORBIT endpoints are excluded by the caller: an orbit projection is framed
 * by orbiting the camera about the WORLD ORIGIN, so translating its geometry
 * to place an anchor would swing the whole sphere off that pivot.
 */
function buildSheetBlendProject(
  a: GlyphMapProjection,
  b: GlyphMapProjection,
  t: number,
  anchor: readonly [number, number],
): GlyphMapProjection["project"] | null {
  const [anchorLon, anchorLat] = anchor;
  const scaleA = anchorScaleAt(a, anchorLon, anchorLat);
  const scaleB = anchorScaleAt(b, anchorLon, anchorLat);
  if (scaleA === null || scaleB === null) return null;
  if (Math.abs(scaleA - scaleB) <= Math.max(scaleA, scaleB) * SHEET_SCALE_MATCH_EPSILON) return null;

  const anchorA = a.project(anchorLon, anchorLat, 0);
  const anchorB = b.project(anchorLon, anchorLat, 0);
  if (!isFiniteVec3(anchorA) || !isFiniteVec3(anchorB)) return null;

  const scale = 1 / lerp(1 / scaleA, 1 / scaleB, t);
  const placeX = lerp(anchorA[0], anchorB[0], t) - scale * lerp(anchorA[0] / scaleA, anchorB[0] / scaleB, t);
  const placeY = lerp(anchorA[1], anchorB[1], t) - scale * lerp(anchorA[1] / scaleA, anchorB[1] / scaleB, t);
  const placeZ = lerp(anchorA[2], anchorB[2], t) - scale * lerp(anchorA[2] / scaleA, anchorB[2] / scaleB, t);

  return (lon, lat, elev) => {
    const pA = a.project(lon, lat, elev);
    const pB = b.project(lon, lat, elev);
    if (!isFiniteVec3(pA) || !isFiniteVec3(pB)) return [NaN, NaN, NaN];
    return [
      scale * lerp(pA[0] / scaleA, pB[0] / scaleB, t) + placeX,
      scale * lerp(pA[1] / scaleA, pB[1] / scaleB, t) + placeY,
      scale * lerp(pA[2] / scaleA, pB[2] / scaleB, t) + placeZ,
    ];
  };
}

/**
 * Builds the `GlyphMapProjection` for blend fraction `t` between `a` (t=0)
 * and `b` (t=1). `t` is clamped to `[0, 1]` — a caller driving an animation
 * off `elapsed / duration` can overshoot slightly on the last frame without
 * this needing to reject it.
 *
 * **t=0 and t=1 return the ENDPOINT OBJECTS THEMSELVES** (`a`/`b`, not a
 * freshly built stand-in that merely computes the same values) — the
 * strongest possible form of "byte-identical to the pure projection" this
 * slice's normative constraints demand: every method, not just `project()`,
 * is then LITERALLY the endpoint's own, so a caller checking `visible`/
 * `cameraForCenter`/`centerForCamera` presence at either boundary sees
 * exactly what it would see with no transition involved at all.
 *
 * For `0 < t < 1` the returned projection carries `project()` (the unwrap or
 * the lerp — see this file's own top-of-file doc for which pairs take which,
 * and why the choice is made by CAPABILITY) and `domain` (the union above)
 * but deliberately NO `visible`/`cameraForCenter`/`centerForCamera` — see
 * this file's own top-of-file doc comment for why those three don't have a
 * meaningful `t`-parameterized form here — plus `unproject()`, which throws
 * (see below).
 */
export function glyphMapProjectionTransition(
  a: GlyphMapProjection,
  b: GlyphMapProjection,
  t: number,
  opts: GlyphMapProjectionTransitionOptions = {},
): GlyphMapProjection {
  const clamped = Math.max(0, Math.min(1, t));
  if (clamped <= 0) return a;
  if (clamped >= 1) return b;
  const domain = unionBounds(a.domain, b.domain);

  const aIsOrbit = isOrbitProjection(a);
  const bIsOrbit = isOrbitProjection(b);
  let project: GlyphMapProjection["project"] | null = null;
  if (opts.anchor && aIsOrbit !== bIsOrbit) {
    const orbit = aIsOrbit ? a : b;
    const sheet = aIsOrbit ? b : a;
    project = buildUnwrapProject(orbit, sheet, aIsOrbit ? 1 - clamped : clamped, opts.anchor);
  } else if (opts.anchor && !aIsOrbit && !bIsOrbit) {
    // Sheet <-> sheet. Only engages when the two sheets' world scales
    // actually differ (orthographic against equirectangular/Mercator); a
    // matched pair keeps the plain lerp untouched. See
    // {@link buildSheetBlendProject} for why an ORBIT pair is excluded
    // outright rather than normalized too.
    project = buildSheetBlendProject(a, b, clamped, opts.anchor);
  }
  const blend: GlyphMapProjection["project"] = project
    ?? ((lon, lat, elev) => blendVec3(a.project(lon, lat, elev), b.project(lon, lat, elev), clamped));

  return {
    id: `glyph-map-transition(${a.id}->${b.id})`,
    domain,
    project: blend,
    /**
     * A blended vertex position is a nonlinear function (the unwrap's
     * spherical cap, or a per-vertex lerp) of two ARBITRARY, independently
     * nonlinear maps `a.project`/`b.project` — that has no general
     * closed-form inverse (unlike, say, `glyphMapGlobe.unproject`, which
     * inverts ONE known parametric surface). Rather than ship a numeric
     * solve that LOOKS like it works on the projections this package ships
     * today and silently breaks for a future pair with a nastier
     * interpolation path, this is an explicit, loud reject — the same "throw
     * with a clear reason" precedent `glyphMapFromD3Raw`'s `unproject`
     * already sets for the structurally analogous "no correct answer
     * available" case (a raw projection with no `.invert`). Every real caller
     * of this (`createGlyphMap`'s `setProjection`) degrades gracefully
     * instead of propagating the throw — see its own doc for the resulting
     * mid-transition behavior (click-to-lonlat and contour sampling both go
     * quiet, not crash, for the transition's duration).
     */
    unproject() {
      throw new TypeError(
        `glyphcss/maps: ${`glyph-map-transition(${a.id}->${b.id})`} has no closed-form unproject — a blend of two independently nonlinear projections is not generally invertible. Unproject through one of the endpoint projections instead.`,
      );
    },
  };
}
