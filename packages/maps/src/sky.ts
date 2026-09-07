/**
 * The SKY, while walking — the pure half.
 *
 * ## The sky is REAL GEOMETRY
 *
 * `website/src/pages/examples/parthenon.astro` is the reference, and the one
 * idea worth taking from it whole: the sky is a large INWARD HEMISPHERE
 * added as an ordinary mesh, not a screen-space wash. Everything follows
 * from that. The renderer projects it exactly like the terrain, so it is
 * anchored to the world with ZERO camera math — no separate sky pass, no
 * "paint the cells above the horizon", no re-derived view axis. It is
 * occluded by whatever is nearer, which is what makes a building's roofline
 * cut into it for free, and it moves under a look the way the world does
 * because it IS in the world.
 *
 * ## Why an EFFECT LAYER colours it, and not the light
 *
 * An inward hemisphere's normals face the viewer from ABOVE, so ordinary
 * Lambert shading fights any gradient authored into the polygons: the dome's
 * own colour would be modulated by wherever the key light happens to point,
 * and a sky is not a lit surface. The parthenon's answer is the one taken
 * here — an appearance program over the dome's OWN surface, which replaces
 * glyph and colour per cell from the dome point's world direction and never
 * consults the shading term at all.
 *
 * It differs from the parthenon in ONE place, and that difference is the
 * whole reason this can live in a map. That page discriminates "am I on the
 * dome" by DISTANCE FROM THE WORLD ORIGIN (`dist < SKY_R * 0.6` skips the
 * foreground), which works only because its world is centred on the camera.
 * A map's origin is the centre of the Earth, and terrain BEYOND the dome
 * radius genuinely renders (the walk horizon culls extrusion walls, markers
 * and points — never the raster relief mesh, which draws to the mounted
 * tile's full extent), so a distance test would paint far terrain as sky.
 * This layer is instead MESH-TARGETED at the dome's own handle
 * (AGENTS.md, "Per-object targeting"), so `target.coverage` is exactly the
 * cells the dome won the depth test on — no radius heuristic at all.
 *
 * Mesh targeting is solid-mode-only by construction (`winnerMesh` is null
 * elsewhere, and the layer then reads as inactive rather than throwing), and
 * `worldPosition` is a hard requirement for the same reason. The widget
 * therefore mounts the dome only in solid mode: an unlit dome is the whole
 * point, and a Lambert-shaded one in wireframe would be a hemisphere of
 * blue rules.
 *
 * ## The sun is the scene's own
 *
 * Nothing here invents a sun. `@glyphcss/maps` already has NOAA solar math
 * and a documented precedence rule, and `getKeyLightDirection()` reports
 * whichever owner is live. The disc is drawn at that direction and the
 * gradient is driven by its ALTITUDE above the walker's local horizontal, so
 * the sky and the terminator the same page renders can never disagree.
 *
 * ## Why the colour is BANDED
 *
 * `stampGlyphMapNight` already found and paid for this lesson: a continuous
 * per-cell ramp gives almost every cell its own colour and destroys the
 * span-run merging this renderer is built on (measured there at 1,679 spans
 * / 9.40 ms against 123 / 1.00 ms). The sky is the largest flat region in a
 * street-level frame, so it is exactly where that matters most. Quantizing
 * the gradient parameter into {@link GLYPH_MAP_SKY_BANDS} steps makes each
 * band ONE colour and ONE glyph, and since a bearing keeps the horizon level
 * the bands run along screen rows — which is a single span per row.
 */
import { defineGlyphEffect } from "glyphcss";
import type { Polygon, Vec3 } from "glyphcss";
import { glyphMapTrueScaleElevation, type GlyphMapProjection } from "./projection";

const DEG = Math.PI / 180;

/**
 * Dome radius as a fraction of the walker's local horizon
 * ({@link GLYPH_MAP_WALK_FAR_M}).
 *
 * JUST INSIDE `far`, and the slack is load-bearing twice over. `far` is the
 * distance past which a `fill-extrusion`'s walls and every point feature are
 * culled (`glyphMapWalkWithinHorizon`), so a dome at `fraction * far` is the
 * backdrop that starts where those stop — nothing the horizon still admits
 * is ever hidden behind it. And the leftover `(1 - fraction) * far` is the
 * budget the RE-CENTRING rule spends: a walker may travel that far from the
 * dome's own centre before the dome's near rim could reach inside the
 * horizon, which is what {@link glyphMapSkyRecentreDistanceM} returns.
 *
 * It is a fraction rather than a metre count so that a caller's own `far`
 * (`setWalk({ far })`, and the render bench's `--walk-far` ladder) carries
 * the dome with it.
 */
export const GLYPH_MAP_SKY_RADIUS_FRACTION = 0.98;

/**
 * Rings of latitude and segments of azimuth in the hemisphere.
 *
 * Deliberately COARSE. Nothing about the picture depends on the tessellation
 * being fine: the colour is computed per CELL from the interpolated world
 * position, not per vertex, so the gradient is exact at any ring count; and
 * the dome is never silhouetted against anything (it is the backdrop), so
 * its outline is never seen. What the counts do buy is the rim's smoothness,
 * and 48 segments put the chord's sagitta at `R(1 - cos(3.75 deg))` = 1.3 m
 * at a 588 m radius — 0.12 degrees seen from the centre, well under a row.
 *
 * 8 x 48 = 384 quads. The upper ring's quads are degenerate at the zenith
 * (two coincident vertices) and rasterize as triangles, the same shape the
 * parthenon's own dome ends in.
 */
export const GLYPH_MAP_SKY_RINGS = 8;
export const GLYPH_MAP_SKY_SEGMENTS = 48;

/**
 * Steps the gradient parameter is quantized into. See this file's header for
 * why banding at all; 32 puts a band at roughly 1.8 rows on the `/maps` grid
 * (a 63-row viewport over a ~35 degree vertical field), which reads as a
 * gradient and merges as flat colour.
 */
export const GLYPH_MAP_SKY_BANDS = 32;

/**
 * The glyph ramp the sky's own brightness picks from, darkest first, indexed
 * by the LUMINANCE of the colour the gradient already produced.
 *
 * Printable ASCII, and light: a sky is the background of the picture, not a
 * subject in it. Having a ramp at all (rather than one fixed glyph) is what
 * keeps the gradient legible under `useColors: false`, where the colour
 * carries nothing — the same reason the terrain has one. It deliberately
 * contains NO SPACE: a blank cell is not a dark sky, it is a hole, and at
 * the zenith (the darkest end of every one of the palettes below) that is
 * exactly where the ramp's own floor lands.
 */
export const GLYPH_MAP_SKY_RAMP = ".`:-=+*";

/** Angular radius of the sun's CORE, degrees — the saturated disc. */
export const GLYPH_MAP_SKY_SUN_DISC_DEG = 1.6;
/** Angular radius of the sun's GLOW, degrees — where the warm falloff ends. */
export const GLYPH_MAP_SKY_SUN_GLOW_DEG = 11;

/** One end-to-end sky palette: the colour at the horizon and the colour at the zenith. */
export interface GlyphMapSkyPalette {
  readonly horizon: readonly [number, number, number];
  readonly zenith: readonly [number, number, number];
}

/**
 * The three anchors the gradient is interpolated between, by sun altitude.
 *
 * `night` is what the sky is at and below {@link GLYPH_MAP_SKY_NIGHT_DEG}
 * (civil twilight), `dusk` is the sun exactly ON the horizon, and `day` is
 * the sun at or above {@link GLYPH_MAP_SKY_DAY_DEG}. Every one of them is
 * warmer at the horizon than at the zenith, which is the atmospheric fact
 * the whole gradient exists to state; `dusk` is only the case where the
 * difference is dramatic.
 */
export const GLYPH_MAP_SKY_NIGHT: GlyphMapSkyPalette = { horizon: [0x0d, 0x14, 0x26], zenith: [0x05, 0x08, 0x14] };
export const GLYPH_MAP_SKY_DUSK: GlyphMapSkyPalette = { horizon: [0xe0, 0x89, 0x4a], zenith: [0x2b, 0x4a, 0x80] };
export const GLYPH_MAP_SKY_DAY: GlyphMapSkyPalette = { horizon: [0xb5, 0xd3, 0xec], zenith: [0x2d, 0x6f, 0xbe] };

/** Sun altitude (degrees) at or below which the sky is fully {@link GLYPH_MAP_SKY_NIGHT} — civil twilight. */
export const GLYPH_MAP_SKY_NIGHT_DEG = -6;
/** Sun altitude (degrees) at or above which the sky is fully {@link GLYPH_MAP_SKY_DAY}. */
export const GLYPH_MAP_SKY_DAY_DEG = 25;

/** The dome's own polygon colour — what a reader would see if the appearance program never ran. Never visible in solid mode, where the program replaces every dome cell. */
export const GLYPH_MAP_SKY_MESH_COLOR = "#2b4a80";

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mixPalette(a: GlyphMapSkyPalette, b: GlyphMapSkyPalette, t: number): GlyphMapSkyPalette {
  return {
    horizon: [
      lerp(a.horizon[0], b.horizon[0], t),
      lerp(a.horizon[1], b.horizon[1], t),
      lerp(a.horizon[2], b.horizon[2], t),
    ],
    zenith: [
      lerp(a.zenith[0], b.zenith[0], t),
      lerp(a.zenith[1], b.zenith[1], t),
      lerp(a.zenith[2], b.zenith[2], t),
    ],
  };
}

/**
 * The sky palette for a sun at `altitudeDeg` above the walker's local
 * horizontal.
 *
 * Two segments, not one curve: night to dusk over the civil-twilight band
 * and dusk to day over the first {@link GLYPH_MAP_SKY_DAY_DEG} degrees.
 * Splitting there is what puts the warm horizon at the sun's own crossing
 * rather than smeared across the whole range — the warm band exists BECAUSE
 * the sun is on the horizon, so its peak has to be pinned to that instant.
 */
export function glyphMapSkyPalette(altitudeDeg: number): GlyphMapSkyPalette {
  if (!Number.isFinite(altitudeDeg)) return GLYPH_MAP_SKY_DAY;
  if (altitudeDeg < 0) {
    return mixPalette(GLYPH_MAP_SKY_NIGHT, GLYPH_MAP_SKY_DUSK, clamp01(1 - altitudeDeg / GLYPH_MAP_SKY_NIGHT_DEG));
  }
  return mixPalette(GLYPH_MAP_SKY_DUSK, GLYPH_MAP_SKY_DAY, clamp01(altitudeDeg / GLYPH_MAP_SKY_DAY_DEG));
}

/**
 * How far a walker may travel before the dome has to be re-centred, metres —
 * the slack between the dome's radius and the horizon it sits inside.
 *
 * Derived, not tuned: the dome's near rim moves toward the walker by exactly
 * the distance walked, so at this displacement it has reached `far` on the
 * far side and `radius - slack` on the near one, which is the last position
 * at which nothing the horizon still admits can be beyond it. At the default
 * `far` that is 12 m — a rebuild every two seconds of walking, or every
 * two thirds of a second at a run, against 384 quads.
 */
export function glyphMapSkyRecentreDistanceM(farM: number, fraction = GLYPH_MAP_SKY_RADIUS_FRACTION): number {
  return farM * (1 - fraction);
}

/** A built dome: the polygons plus the frame the appearance program needs to colour them. */
export interface GlyphMapSkyDome {
  readonly polygons: Polygon[];
  /** Where it is centred, lon/lat — what {@link glyphMapSkyRecentreDistanceM} is measured from. */
  readonly at: readonly [number, number];
  /** The dome's centre in WORLD space: the walker's own ground point. */
  readonly center: Vec3;
  /** Local up at the centre, unit length, in world space. */
  readonly up: Vec3;
  /** The radius actually used, in world units. */
  readonly radiusWorld: number;
  /** World units per TRUE metre at the centre — the same probe `poseWalkCamera` makes. */
  readonly worldPerMetre: number;
}

export interface GlyphMapSkyDomeOptions {
  readonly projection: GlyphMapProjection;
  /** Where the walker is standing. */
  readonly at: readonly [number, number];
  /** Terrain elevation under the walker, metres — the dome's rim sits on it. */
  readonly groundElevation: number;
  /** Dome radius, TRUE metres. */
  readonly radiusM: number;
  readonly rings?: number;
  readonly segments?: number;
  readonly color?: string;
}

/**
 * Build the inward hemisphere, in world space, centred on the walker's own
 * GROUND point.
 *
 * Centred on the ground rather than on the EYE so the rim sits 1.7 m BELOW
 * the horizontal instead of exactly on it. That is the seam: a rim on the
 * horizontal leaves a sliver between the last terrain the picture holds and
 * the first sky cell (flat ground at the dome's radius projects
 * `atan(eye / radius)` below the horizontal, and the dome would start at
 * zero), while a rim on the ground OVERLAPS that band by construction and
 * whichever of the two is nearer wins the ordinary depth test.
 *
 * The tangent frame is built from an arbitrary perpendicular rather than
 * from geographic east/north, and that is a choice, not a shortcut: the
 * gradient and the sun disc are both computed from world-space dot products
 * inside the appearance program, so the dome's AZIMUTHAL orientation is
 * unobservable — and an east probe would need a pole special case that buys
 * nothing.
 *
 * `up` and the metre scale are asked of the PROJECTION (the same one-true-
 * metre probe `poseWalkCamera` makes), never hardcoded as "+Z" or "radially
 * outward": walk mode admits any projection declaring
 * `cameraForCenter`/`centerForCamera`, including one this package has never
 * seen. Returns `null` when that probe fails — a projection that cannot
 * place the walker cannot place their sky either.
 */
export function glyphMapSkyDome(options: GlyphMapSkyDomeOptions): GlyphMapSkyDome | null {
  const { projection, at, groundElevation, radiusM } = options;
  const rings = options.rings ?? GLYPH_MAP_SKY_RINGS;
  const segments = options.segments ?? GLYPH_MAP_SKY_SEGMENTS;
  const color = options.color ?? GLYPH_MAP_SKY_MESH_COLOR;
  if (!(rings >= 1) || !(segments >= 3) || !(radiusM > 0)) return null;

  const [lon, lat] = at;
  const ground = projection.project(lon, lat, groundElevation);
  if (!ground.every(Number.isFinite)) return null;
  const oneMetre = glyphMapTrueScaleElevation(1, projection);
  const raised = projection.project(lon, lat, groundElevation + oneMetre);
  if (!raised.every(Number.isFinite)) return null;
  const upM: Vec3 = [raised[0] - ground[0], raised[1] - ground[1], raised[2] - ground[2]];
  const worldPerMetre = Math.hypot(upM[0], upM[1], upM[2]);
  if (!(worldPerMetre > 0) || !Number.isFinite(worldPerMetre)) return null;
  const up: Vec3 = [upM[0] / worldPerMetre, upM[1] / worldPerMetre, upM[2] / worldPerMetre];

  // Any unit vector not parallel to `up` seeds the tangent frame; picking the
  // world axis `up` leans on LEAST is what keeps the cross product
  // well-conditioned at every orientation, poles included.
  const ax = Math.abs(up[0]), ay = Math.abs(up[1]), az = Math.abs(up[2]);
  const helper: Vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const ex = helper[1] * up[2] - helper[2] * up[1];
  const ey = helper[2] * up[0] - helper[0] * up[2];
  const ez = helper[0] * up[1] - helper[1] * up[0];
  const eLen = Math.hypot(ex, ey, ez);
  if (!(eLen > 0) || !Number.isFinite(eLen)) return null;
  const east: Vec3 = [ex / eLen, ey / eLen, ez / eLen];
  // `north = up x east` makes (east, north, up) right-handed (east x north = up),
  // which is the frame the winding below is stated in.
  const north: Vec3 = [
    up[1] * east[2] - up[2] * east[1],
    up[2] * east[0] - up[0] * east[2],
    up[0] * east[1] - up[1] * east[0],
  ];

  const radiusWorld = radiusM * worldPerMetre;
  const vertex = (phi: number, azimuth: number): Vec3 => {
    const c = Math.cos(phi) * radiusWorld;
    const s = Math.sin(phi) * radiusWorld;
    const ca = Math.cos(azimuth), sa = Math.sin(azimuth);
    return [
      ground[0] + east[0] * c * ca + north[0] * c * sa + up[0] * s,
      ground[1] + east[1] * c * ca + north[1] * c * sa + up[1] * s,
      ground[2] + east[2] * c * ca + north[2] * c * sa + up[2] * s,
    ];
  };

  const polygons: Polygon[] = [];
  for (let ri = 0; ri < rings; ri++) {
    const p0 = (ri / rings) * (Math.PI / 2);
    const p1 = ((ri + 1) / rings) * (Math.PI / 2);
    for (let si = 0; si < segments; si++) {
      const a0 = (si / segments) * Math.PI * 2;
      const a1 = ((si + 1) / segments) * Math.PI * 2;
      // The order that faces INWARD, which is the only side a walker standing
      // at the centre can ever see. It is the REVERSE of the parthenon's own
      // `[v(p0,a0), v(p0,a1), v(p1,a1), v(p1,a0)]`, and the reversal is not a
      // guess: this package's world frame is the MIRROR of that page's (the
      // relief mesh already says so — `glyphMapPolygons`' `[nw, sw, se, ne]`
      // is documented as "the mirror image of `bake-globe.mjs`'s own
      // `[a, b, c, d]` order"). Measured through the real rasterizer, the
      // parthenon's order paints 0 cells here and this one paints 4,480.
      polygons.push({
        vertices: [vertex(p1, a0), vertex(p1, a1), vertex(p0, a1), vertex(p0, a0)],
        color,
      });
    }
  }
  return { polygons, at: [lon, lat], center: ground, up, radiusWorld, worldPerMetre };
}

/**
 * The sun's altitude above the local horizontal at the dome's centre,
 * degrees — the ONE number the gradient is a function of.
 *
 * `direction` is glyphcss's source-vector convention (from the surface
 * TOWARD the light), which is exactly what `getKeyLightDirection()` reports
 * and what `directionalLight.direction` holds, so the altitude is just the
 * angle it makes with the tangent plane. Not assumed unit length: a consumer
 * may have written any vector into `directionalLight`.
 */
export function glyphMapSkySunAltitude(direction: Vec3, up: Vec3): number {
  const len = Math.hypot(direction[0], direction[1], direction[2]);
  if (!(len > 0) || !Number.isFinite(len)) return Number.NaN;
  const dot = (direction[0] * up[0] + direction[1] * up[1] + direction[2] * up[2]) / len;
  return Math.asin(Math.max(-1, Math.min(1, dot))) / DEG;
}

/** Every parameter the sky program reads. Numbers only, which is what an effect layer's `params` can carry. */
export interface GlyphMapSkyParams {
  /** Dome centre, world space — the point every direction is measured from. */
  centerX: number;
  centerY: number;
  centerZ: number;
  /** Local up at the centre, unit length. */
  upX: number;
  upY: number;
  upZ: number;
  /** Unit vector toward the light, world space (source-vector convention). */
  sunX: number;
  sunY: number;
  sunZ: number;
  /** The same light's altitude above the local horizontal, degrees. Drives the gradient AND whether a disc is drawn at all. */
  altitude: number;
  /** `1` when a real WORLD sun was resolved, `0` when there is none to draw. See {@link glyphMapSkyParamsFor}. */
  hasSun: number;
}

/**
 * The params a dome carries for a given world light — or for NO world light,
 * which is a real case and not a degenerate one.
 *
 * A caller may legitimately have no sun in the world: the widget's own sun is
 * off, and the key light is a HEADLIGHT, which is a statement about the
 * viewer rather than about the world (that is the widget's own wording, and
 * the reason the sun outranks it). Drawing a disc there would glue a sun to
 * the middle of the frame and swing the sky from night to day as the reader
 * looked down and up. So `null` means DAYLIGHT WITH NO DISC: the gradient's
 * day end, and `hasSun: 0`.
 */
export function glyphMapSkyParamsFor(dome: GlyphMapSkyDome, direction: Vec3 | null): GlyphMapSkyParams {
  const len = direction ? Math.hypot(direction[0], direction[1], direction[2]) : 0;
  const real = direction !== null && len > 0 && Number.isFinite(len);
  const unit: Vec3 = real
    ? [direction![0] / len, direction![1] / len, direction![2] / len]
    : dome.up;
  return {
    centerX: dome.center[0], centerY: dome.center[1], centerZ: dome.center[2],
    upX: dome.up[0], upY: dome.up[1], upZ: dome.up[2],
    sunX: unit[0], sunY: unit[1], sunZ: unit[2],
    altitude: real ? glyphMapSkySunAltitude(unit, dome.up) : 90,
    hasSun: real ? 1 : 0,
  };
}

const COS_DISC = Math.cos(GLYPH_MAP_SKY_SUN_DISC_DEG * DEG);
const COS_GLOW = Math.cos(GLYPH_MAP_SKY_SUN_GLOW_DEG * DEG);

/**
 * The appearance program that paints the dome.
 *
 * Runs over the WHOLE grid but does work only on cells the dome won
 * (`target.coverage`), which the compositor has already reduced to the
 * dome's mesh id. Everything it needs per cell is one normalize and two dot
 * products; the sun test compares COSINES rather than taking an `acos`, so
 * the overwhelming majority of sky cells cost one dot and one compare.
 */
export const glyphMapSkyEffect = defineGlyphEffect<GlyphMapSkyParams>({
  requirements: ["worldPosition"],
  evaluate(ctx) {
    const worldPosition = ctx.base.worldPosition;
    if (!worldPosition) return;
    const cover = ctx.target.coverage;
    const p = ctx.params;
    const palette = glyphMapSkyPalette(p.altitude);
    const { horizon, zenith } = palette;
    // The sun is DRAWN only while it is above the walker's own horizontal.
    // Below it there is no disc anywhere — the afterglow is the gradient's
    // job, and it already has it.
    const sunUp = p.hasSun >= 0.5 && p.altitude >= 0;
    const bands = GLYPH_MAP_SKY_BANDS;
    const ramp = GLYPH_MAP_SKY_RAMP;
    const rampMax = ramp.length - 1;
    for (let i = 0; i < ctx.base.length; i++) {
      if (cover[i]! <= 0) continue;
      const dx = worldPosition[i * 3]! - p.centerX;
      const dy = worldPosition[i * 3 + 1]! - p.centerY;
      const dz = worldPosition[i * 3 + 2]! - p.centerZ;
      const len = Math.hypot(dx, dy, dz);
      if (!(len > 0)) continue;
      const ux = dx / len, uy = dy / len, uz = dz / len;
      // 0 at the rim, 1 at the zenith. `sqrt` narrows the horizon band: the
      // elevation's SINE spends half the hemisphere below 30 degrees, which
      // would smear a sunset across most of the frame.
      const elevation = clamp01(ux * p.upX + uy * p.upY + uz * p.upZ);
      let band = Math.floor(Math.sqrt(elevation) * bands);
      if (band > bands - 1) band = bands - 1;
      const t = (band + 0.5) / bands;
      let r = lerp(horizon[0], zenith[0], t);
      let g = lerp(horizon[1], zenith[1], t);
      let b = lerp(horizon[2], zenith[2], t);
      let disc = "";
      if (sunUp) {
        const cos = ux * p.sunX + uy * p.sunY + uz * p.sunZ;
        if (cos > COS_GLOW) {
          // 0 at the glow's edge, 1 at the centre — squared so the core reads
          // as a disc rather than as a soft blob.
          const falloff = (cos - COS_GLOW) / (1 - COS_GLOW);
          const w = falloff * falloff;
          r = lerp(r, 0xff, w);
          g = lerp(g, 0xf1, w);
          b = lerp(b, 0xc4, w * 0.7);
          disc = cos >= COS_DISC ? "@" : w > 0.45 ? "#" : w > 0.16 ? "*" : "+";
        }
      }
      // The glyph follows the LUMINANCE of the colour the sky already has,
      // not the band index, so a mono render (`useColors: false`) shows the
      // same gradient the colour render does and the sun's glow reads there
      // too. Rec. 601 weights.
      const glyph = disc || ramp[Math.min(rampMax, Math.round(((0.299 * r + 0.587 * g + 0.114 * b) / 255) * rampMax))]!;
      ctx.output.glyph[i] = glyph;
      ctx.output.color[i] = (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
      ctx.output.coverage[i] = 1;
      ctx.output.channels[i]! |= 3;
    }
  },
});
