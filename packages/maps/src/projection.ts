import type { Vec3 } from "glyphcss";
import type { GlyphMapBounds } from "./types";

const DEG = Math.PI / 180;

/**
 * Mean Earth radius in meters (IUGG). Elevation (meters, from the source
 * grid) is converted to a fraction of this before being scaled by a
 * projection's own `exaggeration`, so `exaggeration: 1` means "true-scale
 * relief" for every projection in this file, globe included — the same
 * convention `website/scripts/bake-globe.mjs`'s `HEIGHT_EXAGG` uses (there
 * called `EARTH_RADIUS_M`). Exported so a bake script computing the same
 * displacement outside `project()` (or comparing against a pre-projected
 * reference) doesn't need its own copy of the constant (MAPS.md §10 — "the
 * package must own the resampling math").
 */
export const GLYPH_MAP_EARTH_RADIUS_M = 6_371_000;

/**
 * A projection is a vertex transform (MAPS.md §7): flat and globe are one
 * geometry under two functions. Units are DEGREES in (repo convention, not
 * d3's radians — {@link glyphMapFromD3Raw} converts). `domain` is the
 * projection's valid lon/lat WINDOW: equirectangular is unbounded (the full
 * range), Mercator crops at `±maxLat`, globe is the whole sphere, and
 * orthographic/a d3 raw projection show at most a hemisphere. `domain` is a
 * coarse lon/lat BOUNDING BOX for tile culling — for orthographic (a
 * spherical cap, not a box) it is a conservative over-approximation; the
 * authoritative per-point validity check is `project()` itself, which
 * returns `[NaN, NaN, NaN]` for a point outside its true valid region
 * (mirroring `GlyphMapField`'s NaN-for-invalid convention). A mesh builder
 * "crops, not clamps" (§7) by skipping any quad with a NaN corner, never by
 * clamping the coordinate.
 */
export interface GlyphMapProjection {
  readonly id: string;
  /** DEGREES in. Returns `[NaN, NaN, NaN]` when `(lon, lat)` is outside this projection's valid window. */
  project(lon: number, lat: number, elev: number): Vec3;
  /**
   * The relief scale this projection multiplies every `elev` by — `1` is
   * true-scale relief, `/maps`' own default of `24` makes terrain legible at
   * planet scale (Everest is 0.14% of Earth's radius, so true scale is
   * invisible there).
   *
   * READABLE, not merely a constructor option, because exaggeration is a
   * TERRAIN concept and not every vertical quantity is terrain. A structure's
   * height is a real measured metre count that must render at true scale
   * whatever the relief around it is doing (see
   * {@link glyphMapTrueScaleElevation} and `glyphMapVectorMesh`'s extrusion
   * height), and there is no way to put a true-metre quantity onto this
   * projection's exaggerated elevation axis without knowing this number:
   * `project` is the package's ONE elevation conversion (AGENTS.md, "every
   * projection treats elevation the same way"), and the world-units-per-metre
   * it implies is not recoverable from its output — `X`/`Y` are degrees for a
   * sheet and Earth radii for the globe, so no probe of `project` can tell a
   * caller how much of the `Z` it returns was exaggeration.
   */
  readonly exaggeration: number;
  /** Inverse of the `(x, y)` plane position. Elevation is not round-tripped — a projection's `z` axis is one-way relief, never re-derived from world space. */
  unproject(p: Vec3): readonly [lon: number, lat: number];
  readonly domain: GlyphMapBounds;
  /**
   * Near/far-side visibility (MAPS.md §7, §13 slice 3: "the interface must
   * carry more than `project`"). Every flat projection (equirectangular,
   * Mercator, orthographic, a d3 raw adapter) already excludes an invisible
   * point through `project()` returning `[NaN, NaN, NaN]` — for those,
   * `visible` is absent, and every point `project()` accepts is on-screen-
   * eligible. {@link glyphMapGlobe} is different: EVERY `(lon, lat)` is a
   * geometrically valid point on the sphere, front or back, so `project()`
   * alone cannot tell a widget which half faces the camera — that needs a
   * SEPARATE test, which is what this hook is for.
   *
   * `depthOf` is the caller's own `camera.project(...)[2]` (larger = nearer,
   * `rasterize.ts`'s convention — verified directly against `fillDepthTri`
   * and `createGlyphOrthographicCamera`'s `project()`, not assumed). A point
   * is on the near side when it is at least as near as the projection's own
   * reference point (`depthOf(project(anchorLon, anchorLat, 0))` for
   * whichever anchor the projection is centered on) — comparing against that
   * reference, not a fixed sign or zero threshold, is what keeps this correct
   * under ANY camera orientation: depth's zero point is camera/target
   * dependent, not geometry-dependent, so a hardcoded `depth < 0` check
   * (the bug this hook exists to fix — see `createGlyphMap`'s docs) silently
   * resolves the ANTIPODE under some camera states and the correct point
   * under others.
   */
  visible?(world: Vec3, depthOf: (world: Vec3) => number): boolean;
  /**
   * Camera rotation (`rotX`/`rotY`, DEGREES, `createGlyphOrthographicCamera`'s
   * own convention) that centers `[lon, lat]` under this projection's own
   * geometry. Present ONLY on a projection whose geometry is fixed once in
   * world space and navigated by ORBITING the camera around it (the globe) —
   * a flat sheet has no equivalent (there, `createGlyphMap` centers a view by
   * setting `camera.target = project(lon, lat, 0)` directly, which needs no
   * projection-specific support). This is the "gesture semantics (target-pan-
   * with-clamp vs orbit)" MAPS.md §7/§13 slice 3 requires the interface to
   * carry: a widget checks for this method's PRESENCE (a capability, not a
   * branch on `id`/kind) to pick orbit-drag over pan-drag, and never needs to
   * know globe geometry itself.
   */
  cameraForCenter?(lon: number, lat: number): { rotX: number; rotY: number };
  /** Inverse of {@link cameraForCenter} — the `[lon, lat]` this projection's fixed geometry currently centers under camera rotation `rotX`/`rotY`. Present exactly where `cameraForCenter` is. */
  centerForCamera?(rotX: number, rotY: number): readonly [lon: number, lat: number];
}

const FULL_DOMAIN: GlyphMapBounds = { west: -180, east: 180, south: -90, north: 90 };

function reliefZ(elev: number, exaggeration: number): number {
  return (elev / GLYPH_MAP_EARTH_RADIUS_M) * exaggeration;
}

/**
 * A TRUE-METRE vertical quantity expressed on `projection`'s own (exaggerated)
 * elevation axis — the value to hand `project()` so the result is displaced by
 * `metres` of REAL height, whatever the terrain's exaggeration is.
 *
 * Exaggeration is a terrain concept: it exists so a 8,849 m mountain is
 * visible against a 6,371 km radius. A measured structure height is not that
 * kind of quantity, and inheriting the terrain's factor draws a 20 m building
 * 480 m tall at `/maps`' default. Dividing here is exact rather than
 * approximate because every projection in this file is affine in `elev`
 * (`reliefZ` is one multiply), so `project(lon, lat, base + metres / exag)` is
 * `project(lon, lat, base)` displaced along that projection's own local up by
 * exactly `metres / EARTH_RADIUS_M` world units.
 *
 * `exaggeration: 0` (relief switched off entirely) is the one singular case:
 * that axis has collapsed, so there is no elevation at all to express a true
 * metre on and the metres pass through unchanged — projecting to the same
 * flat `Z` the terrain got, which is what a caller asking for no relief
 * already gets today for BOTH quantities.
 */
export function glyphMapTrueScaleElevation(metres: number, projection: GlyphMapProjection): number {
  const { exaggeration } = projection;
  return exaggeration !== 0 && Number.isFinite(exaggeration) ? metres / exaggeration : metres;
}

/**
 * Unrolled lon/lat plane, no projection math at all — "unbounded" (§7): every
 * `(lon, lat)` is valid, including past ±180°/±90° (a caller normalizes if it
 * cares). World frame (documented, not incidental — MAPS.md §7's "the world
 * frame and handedness are stated explicitly and tested"): `X` = north/south
 * (increasing SOUTH — `X` is NEGATED latitude), `Y` = east/west (increasing
 * east — the same "east is `+Y`" chirality {@link glyphMapGlobe} pins below),
 * `Z` = relief. `X` is negated because `glyphcss`'s real camera maps a
 * GREATER world `X` to a GREATER (i.e. lower-on-screen) row — verified
 * directly against `chirality.test.ts`'s camera fixture — so un-negated
 * latitude on `X` renders north at the BOTTOM. `website/scripts/bake-globe.
 * mjs`'s `flatToPlane` already does this (`-mercY`, "north maps to -X (top)")
 * for exactly this reason. `X`/`Y` are plain degrees, not radians — nothing
 * here needs the d3-radian convention, and keeping this projection's own
 * domain in the same units as its output keeps `exaggeration`'s meaning (a
 * fraction of Earth's radius) legible next to a `Y` that reads directly as
 * "degrees east of the prime meridian".
 */
export function glyphMapEquirectangular(opts: { exaggeration?: number } = {}): GlyphMapProjection {
  const exaggeration = opts.exaggeration ?? 1;
  return {
    id: "glyph-map-equirectangular",
    exaggeration,
    domain: FULL_DOMAIN,
    project(lon, lat, elev) {
      return [-lat, lon, reliefZ(elev, exaggeration)];
    },
    unproject(p) {
      return [p[1], -p[0]];
    },
  };
}

/**
 * Web Mercator. Conformal, so shape is preserved locally at the cost of
 * badly distorting area near the poles — cropped at `±maxLat` (default
 * `85.0511287798...°`, the standard Web Mercator limit where the projected
 * plane would otherwise reach `±Infinity`) rather than clamped: a clamped
 * pole collapses a whole row of vertices onto one point, producing
 * zero-area quads a mesh builder would still draw as boundary edges (§7).
 * Same `X` = negated north/south (`+X` reads south, so north renders at the
 * TOP under `glyphcss`'s real camera — see {@link glyphMapEquirectangular}'s
 * doc comment), `Y` = east/west, `Z` = relief frame as
 * {@link glyphMapEquirectangular}.
 */
export function glyphMapMercator(opts: { maxLat?: number; exaggeration?: number } = {}): GlyphMapProjection {
  const maxLat = opts.maxLat ?? 85.05112877980659;
  const exaggeration = opts.exaggeration ?? 1;
  return {
    id: "glyph-map-mercator",
    exaggeration,
    domain: { west: -180, east: 180, south: -maxLat, north: maxLat },
    project(lon, lat, elev) {
      if (lat < -maxLat || lat > maxLat) return [NaN, NaN, NaN];
      const y = Math.log(Math.tan(Math.PI / 4 + (lat * DEG) / 2));
      return [-(y / DEG), lon, reliefZ(elev, exaggeration)];
    },
    unproject(p) {
      const lat = (2 * Math.atan(Math.exp(-p[0] * DEG)) - Math.PI / 2) / DEG;
      return [p[1], lat];
    },
  };
}

/**
 * A 3D sphere mesh — every `(lon, lat)` is valid (the whole globe), unlike
 * every other projection here, which flattens to a 2D plane plus one-way
 * relief. `radius` is the sphere's base (sea-level) radius in world units;
 * `exaggeration` scales elevation as a FRACTION of Earth's true radius
 * (`elev / {@link GLYPH_MAP_EARTH_RADIUS_M}`) before it displaces that
 * radius outward — `exaggeration: 1` is true-scale relief (imperceptible at
 * globe scale, since Everest is ~0.14% of Earth's radius), matching
 * `website/scripts/bake-globe.mjs`'s `HEIGHT_EXAGG` (there applied at
 * `radius: 1`).
 *
 * World frame — pinned explicitly and tested (MAPS.md §7's chirality gate),
 * not derived incidentally from "wherever the math lands":
 *
 *     X = radius · cos(lat) · cos(lon)     (toward lon=0°,  lat=0° — Greenwich/equator)
 *     Y = radius · cos(lat) · sin(lon)     (increasing EAST)
 *     Z = radius · sin(lat)                (increasing NORTH — the sphere's polar axis)
 *
 * This is the textbook right-handed spherical-to-Cartesian map (X toward the
 * reference meridian, Z the polar axis, Y completing a right-handed frame —
 * so `+lon` reads as `+Y`, matching what "east" must mean under this
 * package's own camera convention, see `projection.test.ts`'s chirality
 * gate). It is DELIBERATELY NOT `website/scripts/bake-globe.mjs`'s
 * `latLonToXYZ`, which negates `Y`: that negation mirrors every `(lon, lat)`
 * pair across the prime-meridian plane (a point at 30°E lands where this
 * formula would put 30°W), and the chirality gate below proves that
 * mirroring is backwards under `glyphcss`'s own camera axis convention — see
 * the "known deviation" note in `parity.test.ts` for the full account and
 * the exact, isolated relationship (`Y` is negated; `X`/`Z` already agree)
 * between this projection and those checked-in tiles.
 */
export function glyphMapGlobe(opts: { radius?: number; exaggeration?: number } = {}): GlyphMapProjection {
  const radius = opts.radius ?? 1;
  const exaggeration = opts.exaggeration ?? 1;
  return {
    id: "glyph-map-globe",
    exaggeration,
    domain: FULL_DOMAIN,
    project(lon, lat, elev) {
      const latR = lat * DEG;
      const lonR = lon * DEG;
      const cosLat = Math.cos(latR);
      const r = radius * (1 + reliefZ(elev, exaggeration));
      return [r * cosLat * Math.cos(lonR), r * cosLat * Math.sin(lonR), r * Math.sin(latR)];
    },
    unproject(p) {
      const rho = Math.hypot(p[0], p[1], p[2]);
      if (rho < 1e-12) return [0, 0];
      const lat = Math.asin(Math.max(-1, Math.min(1, p[2] / rho)));
      const lon = Math.atan2(p[1], p[0]);
      return [lon / DEG, lat / DEG];
    },
    // The sphere's centre (world origin) is the natural reference point: for
    // ANY camera rotation, `depthOf([0,0,0])` is the depth of the ORIGIN, and
    // a point AT THE DATUM is on the near side exactly when it is no
    // farther than the origin along the camera's own view axis — origin
    // depth is 0 for an orthographic camera with `target: [0,0,0]` (the
    // depth functional is linear/homogeneous), but this reads it from
    // `depthOf` rather than assuming that, so it stays correct even if a
    // caller ever pans a globe camera's `target` off the sphere's centre.
    //
    // The centre plane is NOT the whole story for a RAISED point, and taking
    // it as such is what hid a `fill-extrusion`'s walls the moment its base
    // ring crossed the limb (`widget.extrusionHorizon.test.ts`). A point at
    // height `h` clears the horizon from `acos(r / (r + h))` of extra arc —
    // the ship's-mast-before-the-hull effect — so its top is genuinely in
    // view while its base is not. Under the orthographic camera every caller
    // here uses, the sphere's silhouette is a CYLINDER of radius `radius`
    // about the view axis (not a cone), so the exact test for a point behind
    // the centre plane is "is it outside that cylinder?": with `axial` the
    // point's own component along the view axis, its distance from the axis
    // is `sqrt(|world|² - axial²)`, compared against `radius`.
    //
    // `axial` is in WORLD units and needs no camera metrics: subtracting the
    // origin's depth cancels the camera's `target` translation, and
    // `createGlyphOrthographicCamera` applies `zoom`/`fovScale` to col/row
    // only — its returned depth is the raw rotated `z`, and rotation is
    // norm-preserving, so `|world|` and `axial` are in the same units.
    //
    // A point at the datum has `|world| === radius`, so `|world|² - axial²`
    // is `radius² - axial² < radius²` for every `axial < 0`: this is exactly
    // the old verdict there, and every datum-level caller (tile culling,
    // stroke clipping, `unproject`, markers at the default elevation) is
    // unchanged. Only a point genuinely raised above the sphere can differ.
    visible(world, depthOf) {
      const axial = depthOf(world) - depthOf([0, 0, 0]);
      if (axial >= 0) return true;
      const rho2 = world[0] * world[0] + world[1] * world[1] + world[2] * world[2];
      return rho2 - axial * axial >= radius * radius;
    },
    // Exact, closed-form inverse of `createGlyphOrthographicCamera`'s own
    // rotation math (`rotateVec3Voxcss`), not a search/scan (the bug
    // `createGlyphMap` fixes — see its docs). The camera's projected DEPTH
    // of a world point is `rz2 = (Y·sinRotY + X·cosRotY)·sinRotX + Z·cosRotX`
    // — LINEAR in (X, Y, Z) — so the point on the unit sphere that MAXIMIZES
    // depth (i.e. the sub-observer / near-pole point the camera is centred
    // on) is exactly the functional's gradient direction, normalized:
    // `n = (sinRotX·cosRotY, sinRotX·sinRotY, cosRotX)`. Equating that to
    // this projection's own `(X, Y, Z) = (cosLat·cosLon, cosLat·sinLon,
    // sinLat)` and solving gives `rotX = 90 - lat`, `rotY = lon` exactly —
    // verified against `chirality.test.ts`'s independently-authored camera
    // fixture (`rotX: 90, rotY: 0` faces Greenwich ⇔ `lat: 0, lon: 0`).
    cameraForCenter(lon, lat) {
      return { rotX: 90 - lat, rotY: lon };
    },
    centerForCamera(rotX, rotY) {
      const rx = rotX * DEG;
      const ry = rotY * DEG;
      const sinRotX = Math.sin(rx);
      const nx = sinRotX * Math.cos(ry);
      const ny = sinRotX * Math.sin(ry);
      const nz = Math.cos(rx);
      const lat = Math.asin(Math.max(-1, Math.min(1, nz))) / DEG;
      const lon = Math.atan2(ny, nx) / DEG;
      return [lon, lat];
    },
  };
}

/**
 * Orthographic: the sphere as seen from infinitely far away, centered on
 * `(lon0, lat0)`. Only the near hemisphere is representable — a point on the
 * far side (`cosC < 0`) projects to `[NaN, NaN, NaN]` (§7's "crop, don't
 * clamp"; `domain` is a conservative bounding box for the same near
 * hemisphere, not the exact spherical cap). Same `X` = negated north/south,
 * `Y` = east/west chirality as the flat projections above (`+X` reads south
 * so north renders at the TOP under `glyphcss`'s real camera — see
 * {@link glyphMapEquirectangular}'s doc comment): standard orthographic
 * `x = cos(lat)·sin(lon−lon0)` (east/west) is returned as this projection's
 * `Y`, and standard `y = cos(lat0)·sin(lat) − sin(lat0)·cos(lat)·cos(lon−lon0)`
 * (north/south) is NEGATED into this projection's `X`.
 */
export function glyphMapOrthographic(opts: { lon0?: number; lat0?: number; exaggeration?: number } = {}): GlyphMapProjection {
  const lon0 = opts.lon0 ?? 0;
  const lat0 = opts.lat0 ?? 0;
  const exaggeration = opts.exaggeration ?? 1;
  const lat0R = lat0 * DEG;
  const sinLat0 = Math.sin(lat0R);
  const cosLat0 = Math.cos(lat0R);
  const domainWest = ((lon0 - 90 + 540) % 360) - 180;
  const domainEast = ((lon0 + 90 + 540) % 360) - 180;
  return {
    id: "glyph-map-orthographic",
    exaggeration,
    domain: {
      west: domainWest > domainEast ? -180 : domainWest,
      east: domainWest > domainEast ? 180 : domainEast,
      south: Math.max(-90, lat0 - 90),
      north: Math.min(90, lat0 + 90),
    },
    project(lon, lat, elev) {
      const latR = lat * DEG;
      const dLon = (lon - lon0) * DEG;
      const cosLat = Math.cos(latR);
      const sinLat = Math.sin(latR);
      const cosC = sinLat0 * sinLat + cosLat0 * cosLat * Math.cos(dLon);
      if (cosC < 0) return [NaN, NaN, NaN];
      const stdX = cosLat * Math.sin(dLon);
      const stdY = cosLat0 * sinLat - sinLat0 * cosLat * Math.cos(dLon);
      return [-stdY, stdX, reliefZ(elev, exaggeration)];
    },
    unproject(p) {
      const stdY = -p[0];
      const stdX = p[1];
      const rho = Math.hypot(stdX, stdY);
      if (rho < 1e-12) return [lon0, lat0];
      const c = Math.asin(Math.max(-1, Math.min(1, rho)));
      const sinC = Math.sin(c);
      const cosC = Math.cos(c);
      const lat = Math.asin(Math.max(-1, Math.min(1, cosC * sinLat0 + (stdY * sinC * cosLat0) / rho)));
      const lon = lon0 * DEG + Math.atan2(stdX * sinC, rho * cosLat0 * cosC - stdY * sinLat0 * sinC);
      return [lon / DEG, lat / DEG];
    },
  };
}

/**
 * A d3-geo "raw" projection is `(λ, φ) → [x, y]` in RADIANS with an optional
 * `.invert` — structurally the shape {@link GlyphMapProjection} needs, so
 * `d3-geo-projection`'s ~50 raw projections (Mollweide, Winkel Tripel,
 * Robinson, Albers, Lambert, ...) work through this thin adapter (MAPS.md
 * §7). This package does not depend on `d3-geo-projection` at runtime — only
 * the raw function's call SHAPE is required, never the module.
 */
export interface GlyphMapD3RawProjection {
  (lambda: number, phi: number): readonly [number, number];
  /** d3's own convention: two scalar args in, `[lambda, phi]` out — NOT a single `[x, y]` tuple in. */
  invert?(x: number, y: number): readonly [number, number];
}

export interface GlyphMapD3RawOptions {
  readonly id?: string;
  /** Defaults to the full lon/lat range — most d3 raw projections (Mollweide, Robinson, ...) are defined everywhere; pass a narrower box for one that isn't (e.g. a conic). */
  readonly domain?: GlyphMapBounds;
  readonly exaggeration?: number;
}

/**
 * `raw`'s own `(x, y)` output becomes this package's `(-Y, X)` — swapped AND
 * the latitude axis negated, not passed through — so a d3-adapted projection
 * shares the same `X` = negated north/south, `Y` = east/west world frame
 * every hand-rolled projection in this file uses (d3's own convention is the
 * opposite: `x` tracks longitude, `y` tracks latitude, increasing NORTH,
 * which reads upside down under `glyphcss`'s real camera — see
 * {@link glyphMapEquirectangular}'s doc comment).
 */
export function glyphMapFromD3Raw(raw: GlyphMapD3RawProjection, opts: GlyphMapD3RawOptions = {}): GlyphMapProjection {
  const id = opts.id ?? "glyph-map-d3-raw";
  const domain = opts.domain ?? FULL_DOMAIN;
  const exaggeration = opts.exaggeration ?? 1;
  return {
    id,
    exaggeration,
    domain,
    project(lon, lat, elev) {
      const [x, y] = raw(lon * DEG, lat * DEG);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return [NaN, NaN, NaN];
      return [-y, x, reliefZ(elev, exaggeration)];
    },
    unproject(p) {
      if (!raw.invert) {
        throw new TypeError(`glyphcss/maps: d3 raw projection "${id}" has no .invert — unproject is unavailable.`);
      }
      const [lambda, phi] = raw.invert(p[1], -p[0]);
      return [lambda / DEG, phi / DEG];
    },
  };
}
