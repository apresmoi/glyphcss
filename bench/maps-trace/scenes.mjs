/**
 * The scenes `mapsTrace.mjs` traces.
 *
 * A scene is a PAGE STATE plus a MOTION. Everything here is reached through
 * the page's own `window.__glyphMapsBench` seam or through the widget's own
 * public handle — never through a private hook — so a scene is a configuration
 * a reader could reproduce by clicking, and its cost is the cost they pay.
 *
 * The two exceptions, both deliberate and both exactly what the page's own
 * React effect does (`MapsWorkbench.tsx`, the `[shadows]` effect):
 *   `map.setShadow({} | null)` and `map.setKeyLight(mode)`.
 * The Dock's shadow row is an `IconToggle` inside a collapsible folder, and
 * clicking it through the DOM is a fixture, not a measurement; the two calls
 * below are the same two calls that toggle makes.
 *
 * WHY THE KEY LIGHT IS NAMED ON EVERY SCENE. `mapKeyLightForSunMode("off",
 * "globe", false)` is `"headlight"`, so the page's own DEFAULT aims the key
 * light down the camera's view axis and rewrites it whenever the camera moves
 * — which invalidates glyphcss's per-triangle shade cache every frame. That is
 * a first-order cost in a scenario whose whole point is a moving camera, so no
 * scene here is allowed to leave it implicit.
 */

/** Zürich centre — where `bench/maps-render`'s own `walk` scenario stands. */
export const ZURICH = [8.5417, 47.3769];

/**
 * Every OpenStreetMap row the page offers, by the id `setOsmSublayers` takes
 * (`GLYPH_MAP_OPENMAPTILES_LAYERS`). A street-level reader has these on; that
 * is the reported case, so it is the default set here.
 */
export const OSM_ALL = [
  "omt-landcover", "omt-landuse", "omt-water", "omt-waterways", "omt-roads",
  "omt-buildings", "omt-boundaries", "omt-places", "omt-peaks", "omt-pois",
  "omt-parks", "omt-aeroways", "omt-water-labels",
];

/** The page's own demo layer cards, by the id `setDemoLayer` takes. */
export const DEMO_ALL = ["fill", "symbol", "circle", "heatmap", "fill-extrusion", "model"];

/** The page's own LIVE feed rows, by the id `setLiveFeeds` takes. */
export const LIVE_ALL = ["quakes", "disasters", "launches", "satellites"];

/**
 * @typedef {object} TraceScene
 * @property {string} id
 * @property {string} what                 One line: what a reader would call this.
 * @property {[number,number]} viewport
 * @property {string} expectGrid           `CxR` — a GATE, exactly as in `bench/maps-render`.
 * @property {[number,number,number]} [at] `lon,lat,span` to sit at before the motion.
 * @property {string[]} [osm]              OSM row ids to switch on (`[]` = card off).
 * @property {string[]} [demo]             Demo layer card ids to switch on.
 * @property {string[]} [live]             Live feed row ids to switch on.
 * @property {boolean} [shadows]           `map.setShadow({})`.
 * @property {"fixed"|"headlight"} keyLight
 * @property {boolean} [walk]              Enter the page's own walk mode.
 * @property {boolean} [sky]               Walk mode's sky dome (default true).
 * @property {"walk"|"pan"|"orbit"} motion
 * @property {number} [frames]             Displayed frames of motion.
 * @property {number} [tilt]               Pitch for a non-walk scene. `"max"` uses `getMaxTilt()`.
 */

/** @type {TraceScene[]} */
export const SCENES = [
  {
    // ── THE REPORTED CASE. ────────────────────────────────────────────────
    id: "walk-city",
    what: "Zürich street level, walking, every OSM row, shadows on, sky up",
    viewport: [1440, 900], expectGrid: "140x63",
    at: [ZURICH[0], ZURICH[1], 0.02],
    osm: OSM_ALL, shadows: true, keyLight: "fixed",
    walk: true, sky: true, motion: "walk", frames: 260,
  },
  {
    // Same scene, same place, ORTHOGRAPHIC camera. This is the comparison
    // that isolates the perspective camera: walk mode's camera is
    // `GlyphPerspectiveCamera`, and glyphcss's pre-projection BACK-FACE run
    // rejection DISABLES ITSELF for a non-affine camera (`deriveFacingGradient`
    // verifies affinity by probing at two base points and refuses to run when
    // they disagree). The pan below moves the ground at the walker's own
    // `GLYPH_MAP_WALK_SPEED_M_PER_S`, so the two differ in camera, not in how
    // fast the world goes by.
    id: "orbit-city",
    what: "The same Zürich block in orbit at the page's own tilt, panned at walking speed",
    viewport: [1440, 900], expectGrid: "140x63",
    // The WALKER'S OWN span, `glyphMapWalkSpan(GLYPH_MAP_WALK_FAR_M)` =
    // `2 * 600 / 111320`, so the two scenes stand on the same footprint and
    // mount the same buildings. At `0.02` the orbit scene mounted 4.5x the
    // extrusion polygons and the comparison would have been about how much
    // city was on screen.
    at: [ZURICH[0], ZURICH[1], (2 * 600) / 111320],
    osm: OSM_ALL, shadows: true, keyLight: "fixed",
    // NO explicit tilt — the page's own, which at this view is 32.44 deg.
    // `getMaxTilt()` answers 85 here and every value above ~40 renders a
    // UNIFORM FIELD OF `@` with not one triangle on the grid: `tilt` ADDS to
    // `cameraForCenter`'s own pitch (42.62 deg at this view), so rotX passes
    // 90 — the camera tips past vertical — while the ceiling, which is
    // derived from the horizon angle alone, never notices. Measured: tilt 45
    // -> rotX 87.6, tilt 50 -> rotX 92.6, tilt 70 -> rotX 112.6, and 80/85
    // render 8,820 of 8,820 cells BLANK. That is a real defect and it is
    // reported rather than worked around; a picture with no geometry in it is
    // fast and worthless, so the comparison sits at the pose the page ships.
    walk: false, motion: "pan", frames: 260,
  },
  {
    // The page's own default aim for the key light, everything else identical
    // to `walk-city`. Prices the headlight's shade-cache invalidation.
    id: "walk-city-headlight",
    what: "walk-city with the page's default camera-following key light",
    viewport: [1440, 900], expectGrid: "140x63",
    at: [ZURICH[0], ZURICH[1], 0.02],
    osm: OSM_ALL, shadows: false, keyLight: "headlight",
    walk: true, sky: true, motion: "walk", frames: 260,
  },
  {
    // Ablations, one option each, against `walk-city`.
    id: "walk-city-noshadow",
    what: "walk-city with the shadow pass off",
    viewport: [1440, 900], expectGrid: "140x63",
    at: [ZURICH[0], ZURICH[1], 0.02],
    osm: OSM_ALL, shadows: false, keyLight: "fixed",
    walk: true, sky: true, motion: "walk", frames: 260,
  },
  {
    id: "walk-city-nosky",
    what: "walk-city with no sky dome",
    viewport: [1440, 900], expectGrid: "140x63",
    at: [ZURICH[0], ZURICH[1], 0.02],
    osm: OSM_ALL, shadows: true, keyLight: "fixed",
    walk: true, sky: false, motion: "walk", frames: 260,
  },
  {
    id: "walk-city-nobuildings",
    what: "walk-city with the buildings row off — the terrain-only street",
    viewport: [1440, 900], expectGrid: "140x63",
    at: [ZURICH[0], ZURICH[1], 0.02],
    osm: OSM_ALL.filter((id) => id !== "omt-buildings"), shadows: true, keyLight: "fixed",
    walk: true, sky: true, motion: "walk", frames: 260,
  },
  {
    id: "walk-city-terrain-only",
    what: "walk-city with the whole OSM card off — terrain, borders and sky alone",
    viewport: [1440, 900], expectGrid: "140x63",
    at: [ZURICH[0], ZURICH[1], 0.02],
    osm: [], shadows: true, keyLight: "fixed",
    walk: true, sky: true, motion: "walk", frames: 260,
  },
  {
    // Cell count changes the balance between geometry (per polygon) and
    // scan-fill / string build / DOM (per cell), so the reported case is
    // traced at both shapes `bench/maps-render` reports at.
    id: "walk-city-2560",
    what: "walk-city at 2560x1440 — 29,715 cells instead of 8,820",
    viewport: [2560, 1440], expectGrid: "283x105",
    at: [ZURICH[0], ZURICH[1], 0.02],
    osm: OSM_ALL, shadows: true, keyLight: "fixed",
    walk: true, sky: true, motion: "walk", frames: 260,
  },
  {
    // Everything the bench seam can switch on, over the globe. The heaviest
    // geometry the page can be asked for.
    id: "world-max",
    what: "Globe overview with every layer the seam reaches: terrain, borders, all OSM rows, all demo layers, all live feeds",
    viewport: [1440, 900], expectGrid: "140x63",
    at: [0, 20, 140],
    osm: OSM_ALL, demo: DEMO_ALL, live: LIVE_ALL, shadows: true, keyLight: "fixed",
    walk: false, motion: "orbit", frames: 260,
  },
];

/** @param {string} id */
export function sceneById(id) {
  const scene = SCENES.find((s) => s.id === id);
  if (!scene) throw new Error(`mapsTrace: unknown scene "${id}". Known: ${SCENES.map((s) => s.id).join(", ")}`);
  return scene;
}
