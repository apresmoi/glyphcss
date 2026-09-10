/**
 * Real solar position — the SUBSOLAR POINT (the lon/lat where the sun is
 * directly overhead) and the two ways a glyph map can turn it into light.
 *
 * Everything here is PURE and clock-free: the caller passes the instant. That
 * is what makes "the terminator advances with wall-clock time" testable —
 * `createGlyphMap`'s own timer (see `widget.ts`'s sun block) is the only
 * thing in the package that reads `Date.now()`, and a test drives these
 * functions with two injected instants instead.
 *
 * **Algorithm**: NOAA's solar-position spreadsheet formulation (the usual
 * reference implementation) — geometric mean longitude/anomaly, the
 * equation of centre, apparent longitude with the nutation term, corrected
 * obliquity, then declination and the equation of time. Accurate to a few
 * hundredths of a degree over the modern era, far finer than a glyph cell.
 * The equation of time is NOT optional here and is deliberately not
 * approximated away: it reaches ±16 minutes, i.e. ~±4° of longitude — several
 * cells wide at any world view, and the difference between a terminator that
 * tracks the real sun and one that is visibly ahead of it for months at a
 * time.
 *
 * **Two mechanisms, one concept, selected by projection CAPABILITY** (never
 * by `projection.id` — the same rule every other projection-aware branch in
 * this package follows):
 *
 * - An ORBIT projection (the globe — `cameraForCenter` present) is a real
 *   sphere in world space, so the sun is a real DIRECTIONAL LIGHT: the
 *   direction to the sun is the outward unit vector at the subsolar point,
 *   which for a sphere centred on the origin is exactly
 *   `normalize(projection.project(subLon, subLat, 0))`. Lambert shading then
 *   produces the terminator for free, with the correct seasonal tilt, and
 *   relief hillshading comes from the same sun. That is
 *   {@link glyphMapSunDirection}.
 * - A SHEET projection (no `cameraForCenter`) has ONE surface normal
 *   everywhere, so a directional light cannot express a terminator at all —
 *   every cell would receive the identical Lambert term and the whole map
 *   would simply dim. The honest equivalent there is a post-raster day/night
 *   term computed per cell from that cell's OWN lon/lat against the subsolar
 *   point: {@link stampGlyphMapNight}, stamped through the same
 *   `transformCells` seam `line`/`contour` layers already use. It darkens
 *   colour only — it never rewrites a glyph, because the glyph is carrying
 *   terrain shape and relief hillshading, which night does not change.
 */
import type { CellGrid, Vec3 } from "glyphcss";
import type { GlyphMapProjection } from "./projection";

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/** Unix epoch as a Julian Day Number — `2440587.5` is 1970-01-01T00:00:00Z. */
const JD_UNIX_EPOCH = 2440587.5;
const MS_PER_DAY = 86_400_000;
/** J2000.0, the epoch NOAA's series are expanded about. */
const JD_J2000 = 2451545.0;
const DAYS_PER_JULIAN_CENTURY = 36525;

/** Sun altitude (degrees) at which day fades fully to night, and at which it is fully day — civil twilight, the band a human eye actually reads as dusk. */
export const GLYPH_MAP_SUN_TWILIGHT_DEG = 6;

/** How far a fully-dark cell is blended toward {@link GlyphMapNightOptions.nightColor}. Deliberately below 1: a night side that goes to pure black stops reading as a map. */
export const GLYPH_MAP_NIGHT_OPACITY = 0.72;

export interface GlyphMapSolarPosition {
  /** Subsolar longitude, degrees, normalized to `-180..180`. */
  readonly lon: number;
  /** Subsolar latitude, degrees — identical to {@link declinationDeg}, named for the geographic reading. */
  readonly lat: number;
  /** Solar declination, degrees (`±23.44` at the solstices, `~0` at the equinoxes). */
  readonly declinationDeg: number;
  /** Equation of time, MINUTES (apparent solar time minus mean solar time). Roughly `-14.2` in mid-February and `+16.4` in early November. */
  readonly equationOfTimeMin: number;
}

function normalizeLon(lon: number): number {
  return ((lon + 180) % 360 + 360) % 360 - 180;
}

function toMillis(date: Date | number): number {
  return typeof date === "number" ? date : date.getTime();
}

/**
 * The subsolar point at `date` (a `Date` or an epoch-millisecond number).
 *
 * Subsolar longitude is `-15 * (UTC_hours + equationOfTime_minutes / 60 - 12)`:
 * apparent solar time is `UTC + equationOfTime + 4 min per degree of east
 * longitude`, so the meridian where the sun is at apparent noon right now is
 * exactly that. It therefore moves west at 15°/hour — 0.25° per minute — which
 * is what makes a real-time terminator advance on its own.
 */
export function glyphMapSubsolarPoint(date: Date | number): GlyphMapSolarPosition {
  const ms = toMillis(date);
  if (!Number.isFinite(ms)) {
    throw new RangeError("glyphcss/maps: glyphMapSubsolarPoint — date must be a finite instant.");
  }
  const jd = ms / MS_PER_DAY + JD_UNIX_EPOCH;
  const t = (jd - JD_J2000) / DAYS_PER_JULIAN_CENTURY;

  // Geometric mean longitude and mean anomaly of the sun (degrees).
  const l0 = ((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360 + 360) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  // Equation of centre -> true longitude.
  const c = Math.sin(m * DEG) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * m * DEG) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * m * DEG) * 0.000289;
  const trueLong = l0 + c;

  // Apparent longitude: aberration plus the dominant nutation term.
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG);

  // Mean obliquity of the ecliptic, arc-minute series, plus its nutation correction.
  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliqCorr = meanObliq + 0.00256 * Math.cos(omega * DEG);

  const declinationDeg = Math.asin(Math.sin(obliqCorr * DEG) * Math.sin(appLong * DEG)) * RAD;

  const varY = Math.tan((obliqCorr / 2) * DEG) ** 2;
  const equationOfTimeMin = 4 * RAD * (
    varY * Math.sin(2 * l0 * DEG)
    - 2 * e * Math.sin(m * DEG)
    + 4 * e * varY * Math.sin(m * DEG) * Math.cos(2 * l0 * DEG)
    - 0.5 * varY * varY * Math.sin(4 * l0 * DEG)
    - 1.25 * e * e * Math.sin(2 * m * DEG)
  );

  const utcHours = ((ms % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY / 3_600_000;
  const lon = normalizeLon(-15 * (utcHours + equationOfTimeMin / 60 - 12));

  return { lon, lat: declinationDeg, declinationDeg, equationOfTimeMin };
}

/**
 * The unit vector from a lit surface TOWARD the sun, in the projection's own
 * world frame — glyphcss's `GlyphDirectionalLight.direction` convention
 * exactly (AGENTS.md "Numeric conventions": the source vector, from the
 * shaded surface toward the distant light).
 *
 * Returns `null` for any projection that is not navigated by orbiting a fixed
 * body — i.e. any projection without `cameraForCenter` (the capability check,
 * never `projection.id`), and also for the strictly-interior blend of a
 * `setProjection` transition, which deliberately exposes no such capability.
 * A sheet has one normal everywhere, so a directional light there is a
 * uniform brightness change, not a terminator; {@link stampGlyphMapNight} is
 * the sheet mechanism instead.
 */
export function glyphMapSunDirection(projection: GlyphMapProjection, date: Date | number): Vec3 | null {
  if (!projection.cameraForCenter) return null;
  const sun = glyphMapSubsolarPoint(date);
  const p = projection.project(sun.lon, sun.lat, 0);
  const len = Math.hypot(p[0], p[1], p[2]);
  if (!Number.isFinite(len) || len < 1e-9) return null;
  return [p[0] / len, p[1] / len, p[2] / len];
}

/**
 * `sin(solar altitude)` at `(lon, lat)` — equivalently the cosine of the
 * angular distance from the subsolar point, which is the Lambert term a
 * sphere would produce at that point. `> 0` is day, `0` is the terminator,
 * `< 0` is night.
 */
export function glyphMapSolarAltitudeSin(lon: number, lat: number, sun: GlyphMapSolarPosition): number {
  const phi = lat * DEG;
  const dec = sun.declinationDeg * DEG;
  const h = (lon - sun.lon) * DEG;
  return Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(h);
}

/**
 * Daylight fraction at `(lon, lat)`: `1` in full day, `0` in full night, and a
 * smooth ramp across the twilight band (`±twilightDeg` of solar altitude).
 * Smoothstepped rather than linear so the terminator has no visible hard
 * banding edge on either side of the ramp.
 */
export function glyphMapDaylightFactor(
  lon: number,
  lat: number,
  sun: GlyphMapSolarPosition,
  twilightDeg: number = GLYPH_MAP_SUN_TWILIGHT_DEG,
): number {
  const altitudeDeg = Math.asin(Math.max(-1, Math.min(1, glyphMapSolarAltitudeSin(lon, lat, sun)))) * RAD;
  const band = Math.max(twilightDeg, 1e-6);
  const x = Math.max(0, Math.min(1, (altitudeDeg + band) / (2 * band)));
  return x * x * (3 - 2 * x);
}

/**
 * How many discrete darkness levels the terminator ramp is quantized to.
 *
 * This is a PERFORMANCE constant, not a look knob, and it is load-bearing.
 * A continuous ramp gives almost every cell its own `#rrggbb`, which
 * collapses `encodeGlyphBuffers`' same-colour run merging: measured on a
 * 160x64 /maps sheet render of the WHOLE WORLD at an equinox — the worst
 * case, because near the poles the sun stays inside the twilight band all
 * the way around, so those rows are one long gradient — an unquantized night
 * term cost **11.2 ms per render** against **0.44 ms** for the arithmetic
 * itself: the other ~10 ms was 1,481 `<span>`s where the same scene without
 * a sun emits 123. Measured span count and total cost against this constant
 * on that view (baseline, no sun: 123 spans / 1.14 ms):
 *
 * | levels | spans | ms/render |
 * |---|---|---|
 * | 1 (hard edge) | 245 | 1.93 |
 * | 2 | 365 | 2.37 |
 * | 3 | 484 | 2.88 |
 * | **4** | **604** | **3.32** |
 * | 6 | 844 | 4.51 |
 * | 8 | 1037 | 5.37 |
 * | 24 | 1679 | 9.40 |
 *
 * 4 still reads as a gradient (day, three shades, night) rather than the one
 * hard step `levels: 1` gives, at a third of a continuous ramp's cost.
 * Nothing here is paid on an ORBIT projection (whose terminator is a real
 * directional light, so the hook is not even installed) or with the sun off.
 */
export const GLYPH_MAP_NIGHT_LEVELS = 4;

export interface GlyphMapNightOptions {
  /** Solar-altitude half-width of the twilight ramp, degrees. Default {@link GLYPH_MAP_SUN_TWILIGHT_DEG}. */
  readonly twilightDeg?: number;
  /** How far a fully-dark cell is blended toward {@link nightColor}, `0..1`. Default {@link GLYPH_MAP_NIGHT_OPACITY}. */
  readonly nightOpacity?: number;
  /** `#rrggbb` a fully-dark cell is blended toward. Default `"#000000"`. */
  readonly nightColor?: string;
  /** Discrete darkness levels. Default {@link GLYPH_MAP_NIGHT_LEVELS} — see its doc for why this exists. */
  readonly levels?: number;
}

function parseHex(color: string): readonly [number, number, number] | null {
  if (color.length !== 7 || color[0] !== "#") return null;
  const v = Number.parseInt(color.slice(1), 16);
  if (!Number.isFinite(v)) return null;
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function toHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Darken every covered, coloured cell of `grid` by its own day/night term —
 * the SHEET-projection terminator (see this file's header for why a flat map
 * cannot get one from a directional light).
 *
 * `lonLatAt` is the caller's cell → geographic inverse (`createGlyphMap`
 * hoists its own sheet unproject for this). It returns `null` for a cell
 * that has no geographic answer at all — off the projection's domain, or for
 * the whole duration of a `setProjection` blend, whose inverse deliberately
 * does not exist — and such a cell is left exactly as rasterized rather than
 * guessed at.
 *
 * COLOUR ONLY, by design: the glyph at a cell encodes terrain shape and the
 * scene's own relief hillshading, which nightfall does not change, and
 * rewriting it would destroy the map's readability on the dark side for no
 * physical reason. The consequence, stated rather than hidden: under
 * `useColors: false` this is invisible.
 */
export function stampGlyphMapNight(
  grid: CellGrid,
  lonLatAt: (col: number, row: number) => readonly [number, number] | null,
  sun: GlyphMapSolarPosition,
  opts: GlyphMapNightOptions = {},
): void {
  const twilightDeg = opts.twilightDeg ?? GLYPH_MAP_SUN_TWILIGHT_DEG;
  const nightOpacity = Math.max(0, Math.min(1, opts.nightOpacity ?? GLYPH_MAP_NIGHT_OPACITY));
  const night = parseHex(opts.nightColor ?? "#000000") ?? [0, 0, 0];
  const levels = Math.max(1, Math.round(opts.levels ?? GLYPH_MAP_NIGHT_LEVELS));
  if (nightOpacity === 0) return;

  // `(source colour, darkness level) -> darkened colour`, for the pass. A map
  // render has a handful of source colours (one per elevation band) and
  // `levels` darkness steps, so this turns per-cell hex parse/format into a
  // few hundred lookups — and, more importantly, hands the encoder the SAME
  // string for every cell in a band, which is what lets same-colour runs
  // merge again (see GLYPH_MAP_NIGHT_LEVELS).
  const cache = new Map<string, string>();

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const idx = row * grid.cols + col;
      // An empty cell is page background, not a lit surface.
      if (!Number.isFinite(grid.depth[idx])) continue;
      const color = grid.color[idx];
      if (!color) continue;
      const ll = lonLatAt(col, row);
      if (!ll) continue;
      const day = glyphMapDaylightFactor(ll[0], ll[1], sun, twilightDeg);
      // Quantize the DARKNESS FRACTION, not the final blend amount, so that
      // full night is exactly `nightOpacity` (level `levels`) and full day is
      // exactly untouched (level 0) — quantizing the product would round the
      // requested opacity itself to the nearest step.
      const level = Math.round((1 - day) * levels);
      if (level <= 0) continue;
      const key = `${color}|${level}`;
      let darkened = cache.get(key);
      if (darkened === undefined) {
        const rgb = parseHex(color);
        if (!rgb) continue;
        const a = (level / levels) * nightOpacity;
        darkened = toHex(
          rgb[0] + (night[0] - rgb[0]) * a,
          rgb[1] + (night[1] - rgb[1]) * a,
          rgb[2] + (night[2] - rgb[2]) * a,
        );
        cache.set(key, darkened);
      }
      grid.color[idx] = darkened;
    }
  }
}
