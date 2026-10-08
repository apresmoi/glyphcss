import { type GlyphMapKeyLightMode } from "@glyphcss/maps";
import { type MapProjectionId, type MapSunMode, isOrbitProjectionId } from "./config";

// ── Lighting (mirrors SynthWorkbench's `Lighting`/`buildLighting`, adapted
//    to DockLighting's exact field names so the folder is reusable as-is). ──

export interface MapLighting {
  lightAzimuth: number;
  lightElevation: number;
  lightIntensity: number;
  lightColor: string;
  ambientIntensity: number;
  ambientColor: string;
}

export const DEFAULT_MAP_LIGHTING: MapLighting = {
  lightAzimuth: 50,
  lightElevation: 50,
  lightIntensity: 1.15,
  lightColor: "#ffffff",
  ambientIntensity: 0.45,
  ambientColor: "#ffffff",
};

/**
 * `ownedDirection` (from `map.getKeyLightDirection()`) REPLACES the azimuth/
 * elevation direction whenever the WIDGET owns the key light's direction —
 * the real sun on an orbit projection, or a `keyLight: "headlight"` (the
 * page's "Full" sun mode on a globe). It is deliberately the same value the
 * widget itself writes, read fresh at the moment of the write, so the page
 * and the widget can never disagree: whichever writes last writes the same
 * answer. `null` (nobody owns it — a sheet projection outside a headlight, a
 * `setProjection` blend mid-flight) falls back to the sliders, unchanged.
 *
 * Reading `getSunDirection()` here instead would be a real bug now, not a
 * naming quibble: it answers `null` while a headlight is on, so the page
 * would clobber the headlight with its own slider vector on every lighting
 * or projection change.
 */
export function buildMapLighting(
  l: MapLighting,
  ownedDirection?: readonly [number, number, number] | null,
): {
  directionalLight: { direction: [number, number, number]; intensity: number; color: string };
  ambientLight: { intensity: number; color: string };
} {
  const a = (l.lightAzimuth * Math.PI) / 180;
  const e = (l.lightElevation * Math.PI) / 180;
  const direction: [number, number, number] = ownedDirection
    ? [ownedDirection[0], ownedDirection[1], ownedDirection[2]]
    : [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)];
  return {
    directionalLight: {
      direction,
      intensity: l.lightIntensity,
      color: l.lightColor,
    },
    ambientLight: { intensity: l.ambientIntensity, color: l.ambientColor },
  };
}

// ── Sun mode — three buttons in the Dock's own Lighting folder ────────────
//
// The mode enum is `@glyphcss/maps`' own `GlyphMapSunMode`, not a second
// page-local copy: "Full" is the widget's `"off"`, "Real time" is
// `"realtime"`, "Manual" is `"manual"`.
//
// "FULL" IS NOT "NO SUN". The label promises everything lit — a globo
// terráqueo — and turning the sun off does not deliver that on its own: the
// azimuth/elevation key light is still a FIXED direction, so a globe still
// has a lit half and a dark half, just one that no longer tracks the clock.
// What Full actually means is `keyLight: "headlight"` (see
// `mapKeyLightForSunMode`): the key light points along the camera's own view
// axis, so the whole visible face is lit with no terminator anywhere, while
// Lambert still varies per face so terrain relief stays legible. Pure ambient
// would also remove the terminator, and was rejected because it gives every
// face the same shade and erases the relief the terrain layer exists to show
// (rendered and pinned in `@glyphcss/maps`' `widget.headlight.test.ts`).
//
// A REAL-TIME sun keeps moving on the widget's own wall-clock timer
// (`GLYPH_MAP_SUN_TICK_MS`, 30 s — the subsolar point moves 0.25 deg of
// longitude per minute, so a tick is 0.125 deg, about a twelfth of a cell at
// a world view, and costs two re-renders a minute on an idle map). A MANUAL
// sun is pinned to the day/hour the two rows below set.

export const SUN_MODE_LABELS: Record<MapSunMode, string> = {
  off: "Full",
  realtime: "Real time",
  manual: "Manual",
};

/**
 * A manual sun's `(day-of-year, UTC hour)` as an instant. The YEAR is the
 * current UTC one rather than a persisted field: solar declination for a
 * given day-of-year moves by hundredths of a degree between years — far below
 * a glyph cell — so pinning it would buy nothing and cost a URL token.
 */
/**
 * Which `keyLight` mode the widget should be in, given the sun mode and the
 * live projection.
 *
 * ORBIT ONLY, and that is the point rather than a shortcut. The defect Full
 * fixes is a dark HEMISPHERE, which only a sphere has: a sheet projection's
 * faces all point roughly `+Z`, so a fixed key light there produces
 * hillshading, never a terminator — everything on it is already lit. Aiming
 * that light down the view axis anyway would buy nothing and would silently
 * take away the one control (Azimuth/Elev) that does real work on a flat
 * map. Same shape as every other projection-dependent choice on this page
 * and in the widget: a CAPABILITY question, answered once.
 *
 * With the sun ON, the sun owns the direction on an orbit projection and the
 * sheet's terminator is a per-cell term — either way a headlight would be
 * fighting it, so it stays off.
 *
 * SHADOWS OUTRANK THE HEADLIGHT, and not as a preference. Shadows fall along
 * the key light, and a headlight IS the camera's view axis; an orthographic
 * camera's screen position is the component of a world point PERPENDICULAR to
 * that axis, so displacing a caster along it moves the shadow zero columns and
 * zero rows. Every shadow lands in its own caster's cells, hidden behind the
 * thing that threw it — measured at 27 surviving fringe cells against 535 for
 * the same scene under a fixed light (`widget.shadow.test.ts` pins the
 * order of magnitude). That is why the /maps page could turn shadows on at its
 * defaults — globe projection, Sun "Full" — and see nothing anywhere, and no
 * depth bias or receiver set can recover it. Asking for shadows therefore
 * gives the direction back to the Azimuth/Elev sliders, which the Dock then
 * un-dims: an evenly lit globe and cast shadows are mutually exclusive, and
 * the reader gets whichever they asked for last.
 */
export function mapKeyLightForSunMode(
  mode: MapSunMode,
  projection: MapProjectionId,
  shadows = false,
): GlyphMapKeyLightMode {
  if (shadows) return "fixed";
  return mode === "off" && isOrbitProjectionId(projection) ? "headlight" : "fixed";
}

/**
 * Whether the Dock's Azimuth/Elev rows are dimmed — true in EXACTLY the cases
 * where something other than those two sliders is aiming the key light.
 *
 * Derived from {@link mapKeyLightForSunMode} and the sun's own rule rather
 * than restated as a second condition, because a live-looking slider that
 * changes nothing (and a dimmed one that was the only thing left aiming the
 * light) are the two failure modes this row has. `mapsKit.sun.test.ts` pins
 * the equivalence across every mode/projection/shadow combination.
 */
export function mapDirectionLocked(projection: MapProjectionId, mode: MapSunMode, shadows = false): boolean {
  const headlightOwns = mapKeyLightForSunMode(mode, projection, shadows) === "headlight";
  // The sun writes a real `directionalLight.direction` only on an orbit
  // projection; on a sheet its terminator is a per-cell colour term that
  // leaves the key light alone.
  const sunOwns = mode !== "off" && isOrbitProjectionId(projection);
  return headlightOwns || sunOwns;
}

export function mapSunManualInstant(dayOfYear: number, utcHour: number, year = new Date().getUTCFullYear()): number {
  return Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86_400_000 + utcHour * 3_600_000;
}

/** The inverse — used to SEED the manual rows from the real clock when the user switches into manual, so the sun does not jump. */
export function mapSunManualFields(at: number): { day: number; hour: number } {
  const d = new Date(at);
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 1);
  const day = Math.floor((at - startOfYear) / 86_400_000) + 1;
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60;
  return { day, hour };
}

/**
 * Why the Shadows toggle would draw NOTHING right now, or `null` when it
 * would draw something. The reader's own layer state is the whole input.
 *
 * A shadow needs a layer that stands UP off the ground
 * (`GLYPH_MAP_SHADOW_CASTERS` — `fill-extrusion` and `model`), and the page's
 * DEFAULT layer set has none: terrain never casts by design (the relief
 * system keeps a global floor tier mounted, so 256 shadow-map texels would
 * span the Earth) and borders are stamped strokes that own no mesh. So a
 * reader on the default map who turns Shadows on gets an extra pass and no
 * pixel of difference — the exact dead control the Azimuth/Elev rows already
 * dim themselves for (`mapDirectionLocked`), stated the same way: not by
 * disabling the toggle, which would hide the feature from someone about to
 * mount a caster, but by saying what is missing.
 *
 * A per-layer DENSITY is deliberately NOT part of this. It used to switch the
 * feature off silently (glyphcss's shadow map was built per output grid, so a
 * layer separated by its own density stopped casting AND receiving); the
 * shadow map is now built from every caster in the scene and shared across
 * the frame's passes, so a density is orthogonal again and there is nothing
 * to warn about.
 *
 * Pure, so it is testable without mounting the Dock.
 */
export function mapShadowCasterReason(
  extraVisible: Readonly<Record<string, boolean>>,
  osmOn: boolean,
  osmSublayers: Readonly<Record<string, boolean>>,
): string | null {
  if (extraVisible["fill-extrusion"] === true) return null;
  if (extraVisible.model === true) return null;
  if (osmOn && osmSublayers["omt-buildings"] === true) return null;
  return "Nothing mounted casts: turn on OpenStreetMap → Buildings, or the Extrusion or Model layer. Terrain never casts, and borders own no mesh.";
}
