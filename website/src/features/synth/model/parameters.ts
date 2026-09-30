import {
  GlyphRamps,
  SYNTH_COLOR_VOICES,
  defaultGlyphEffectParams,
  GlyphFieldSynthEffect as fieldSynth,
} from "@glyphcss/effects";
import { type GlyphEffectBlend, resolveGeometry } from "glyphcss";
import { type Lighting, MAX_VOICES, sanitizeCarveRenderForSpace } from "./urlState";

// Re-exported so existing consumers of `synthKit.tsx`'s own `MAX_VOICES`
// (SynthWorkbench.tsx et al.) keep importing it from here — the value
// itself now comes from `@glyphcss/effects`'s `SYNTH_VOICES` via
// `synthUrlState.ts` (VOLUMETRIC-3.md §4), not an independent `= 9` literal
// duplicated in this file too.
export { MAX_VOICES };

// The colour voice stack's own sibling cap (VOLUMETRIC-4.md §1) — imported
// directly from `@glyphcss/effects` rather than derived from a schema
// param's own `max` the way `MAX_LAYERS`/`MAX_VOICES` are: there's no
// `clayerN` count param whose `max` equals 3 to read it off of (colour
// voices don't have layer assignment — single layer in v1).
export const MAX_COLOR_VOICES = SYNTH_COLOR_VOICES;

// The ONE blend both `scene.addEffectLayer()` calls below mount the layer
// with. The static export must read the layer's REAL blend rather than the
// effect definition's own `defaultBlend` metadata (see
// `GlyphFieldSynthStaticExportOptions.blend` doc) — sharing this constant
// keeps the exported pen from silently drifting off whatever the live scene
// actually renders with.
export const SYNTH_EFFECT_BLEND: GlyphEffectBlend = "replace";

export type ParamValue = number | string | boolean;

export type Params = Record<string, ParamValue>;

export type Polys = ReturnType<typeof resolveGeometry>;

export const FIELDS = ["radial", "linearX", "linearY", "diagonal", "angular", "spiral", "noise"] as const;

// `linearZ` only has meaning under the volumetric (`space: "object"`) branch
// (see AGENTS.md's field-synth section — the 2D branch falls through to
// radial for it) — kept out of `FIELDS`/`FIELD_TOGGLE` so a 2D patch never
// offers a field that silently degrades, and offered instead via
// `FIELDS_3D`/`FIELD_TOGGLE_3D` only while a voice card is in 3D mode.
// SDF voice family (gyroid/menger/sierpinski, VOLUMETRIC-2.md §2) is offered
// only in the 3D field toggle — like `linearZ`, appended here rather than to
// the base `FIELDS` list, so a 2D patch's field toggle never advertises a
// primitive whose UI selection path is volumetric-only. Order matches
// `SYNTH_FIELDS` in packages/effects/src/fieldProgram.ts (append-only, the
// /synth URL codec encodes field by index).
export const FIELDS_3D = [...FIELDS, "linearZ", "gyroid", "menger", "sierpinski"] as const;

// `step` (VOLUMETRIC-2.md §2) is legal on every field, in both 2D and 3D —
// unlike the field list above, the wave toggle has no 2D/3D split.
export const WAVES = ["sin", "triangle", "saw", "square", "step"] as const;

export const COMBINES = ["add", "multiply", "max", "min", "difference", "argmax"] as const;

// "object" is the volumetric branch (VOLUMETRIC.md's Step 2) — reachable
// directly from this dropdown, the SOLE control for `space` since
// VOLUMETRIC-2.md §4 removed the 2D/3D toggle (Mapping duplicated it).
export const SPACES = ["auto", "surface", "scene", "object"] as const;

export const SUBCELL_RES = ["1x1", "2x4", "ink"] as const;

// SDF fields, per `sampleFieldVoice` in packages/effects/src/fieldProgram.ts
// (VOLUMETRIC-2.md §2): a dedicated branch like `noise`, not a linear-field
// wave projection. `iter` (recursion depth) only means anything for the two
// fractal-union fields, not the smooth `gyroid` implicit.
export const isSdfIterField = (field: string): boolean => field === "menger" || field === "sierpinski";

export const isSdfField = (field: string): boolean => field === "gyroid" || isSdfIterField(field);

// Append-only (VOLUMETRIC-2.md §3): the /synth URL codec encodes `shape` by
// index into this array (see synthUrlState.ts's own duplicate of this list —
// keep both in sync), so a new entry must go at the END, never inserted.
export const SHAPES: string[] = [
  "plane",
  "cube",
  "sphere",
  "icosahedron",
  "dodecahedron",
  "octahedron",
  "cylinder",
  "cone",
  "torus",
  "tetrahedron",
  "pyramid",
];

// Layer shaping ops (VOLUMETRIC.md's Step 3) — mirrors `LAYER_COMBINE_VALUES`/
// `LAYER_VALUE_OPS` in packages/effects/src/stock.ts (not publicly exported,
// so re-declared here the same way `COMBINES`/`FIELDS`/`WAVES` above already
// mirror their schema-internal counterparts rather than importing them).
export const LAYER_VALUE_OPS = ["add", "multiply", "max", "min", "difference"] as const;

export const LAYER_COMBINE_VALUES = [...LAYER_VALUE_OPS, "inherit"] as const;

// "xray" (VOLUMETRIC-2.md §1) appended — order matches the `render` schema
// enum in packages/effects/src/stock.ts (append-only).
export const RENDER_MODES = ["paint", "carve", "xray"] as const;

// The volumetric `pyramid` stage's own authoring size — matches every other
// stage's `size: 3` footprint below (an edge length of 3, same as the
// cube's), matching the recipe's own domain-normalizing `scale: 1/STAGE_SIZE`
// pin (see `sierpinskiPyramidPreset`'s doc in stock.ts — the shipped
// preset's own `scale` is a later stylistic retune away from that pin, not
// the pin itself).
export const PYRAMID_STAGE_SIZE = 3;

// The main stage's default (non-flat) orbit camera angle/zoom — single
// source of truth for `SynthWorkbench.tsx`'s scene-rebuild effect AND the
// arbiter test below, so neither can drift from what the page actually
// renders with. `shapeTransform("pyramid")`'s upright reorientation
// (`alignCornerTetraApexEuler` above) is tuned against exactly this camera.
export const STAGE_CAMERA_ROT_X = 58;

export const STAGE_CAMERA_ROT_Y = 32;

export const STAGE_CAMERA_ZOOM = 46;

export const opts = <T extends string>(list: readonly T[] | string[]): Record<string, T> =>
  Object.fromEntries(list.map((v) => [v, v])) as Record<string, T>;

export const SHAPE_OPTS = opts(SHAPES),
  COMBINE_OPTS = opts(COMBINES),
  SPACE_OPTS = opts(SPACES);

export const LAYER_COMBINE_OPTS = opts(LAYER_COMBINE_VALUES),
  LAYER_BLEND_OPTS = opts(LAYER_VALUE_OPS),
  RENDER_OPTS = opts(RENDER_MODES);

// "Calibrated" measures the VIEWER'S actual resolved font (not an authored
// guess) at pick time — see `useRampCalibration` below. Its result is a
// plain ramp string, same as any `GlyphRamps` entry, so it writes into
// `glyphs`/the `?s=` URL exactly like any other ramp: self-contained, no
// symbolic name that could fall back silently in a fresh environment.
export const CALIBRATED_RAMP_NAME = "Calibrated";

export const RAMP_OPTS: Record<string, string> = {
  ...Object.fromEntries(Object.keys(GlyphRamps).map((k) => [k, k])),
  [CALIBRATED_RAMP_NAME]: CALIBRATED_RAMP_NAME,
  Custom: "Custom",
};

// `calibratedRamp` lets a currently-applied calibrated ramp keep reading back
// as "Calibrated" in the picker instead of immediately falling to "Custom" —
// purely a display nicety; the underlying fallback (an edited/typed ramp, or
// one applied before calibration finished) still resolves to "Custom" exactly
// as before.
export const matchRamp = (glyphs: string, calibratedRamp?: string | null): string => {
  if (calibratedRamp && glyphs === calibratedRamp) return CALIBRATED_RAMP_NAME;
  return Object.entries(GlyphRamps).find(([, v]) => v === glyphs)?.[0] ?? "Custom";
};

export const FIELD_DESCRIPTIONS: Record<string, string> = {
  radial: "distance from a center point — concentric rings",
  linearX: "horizontal bands, stacked top to bottom",
  linearY: "vertical bands, side by side",
  diagonal: "diagonal bands, bottom-left to top-right",
  angular: "angle around a center point — rotational bands",
  spiral: "winds outward from a center point",
  noise: "randomized, non-repeating — no directional structure",
  linearZ: "sweeps along the third (depth) axis — volumetric (3D) only",
  gyroid: "triply-periodic labyrinth implicit — a smooth surface, not a wave layer",
  menger: "signed distance to a depth-limited box fractal (Menger sponge)",
  sierpinski: "signed distance to a depth-limited corner-tetra fractal (Sierpinski)",
  normalX: "object-space face normal's X component — one value per cell, not spatial. Colour voice only",
  normalY: "object-space face normal's Y component — one value per cell, not spatial. Colour voice only",
  normalZ: "object-space face normal's Z component — one value per cell, not spatial. Colour voice only",
  incidence: "1 − |normal · view direction| — 0 face-on, 1 at grazing angles (fresnel/rim lighting). Colour voice only",
};

export const WAVE_DESCRIPTIONS: Record<string, string> = {
  sin: "smooth, rounded oscillation",
  triangle: "linear ramp up, then down",
  saw: "linear ramp up, then a hard snap back down",
  square: "hard on/off, no ramp",
  step: "a single hard edge, non-periodic — +1 past the crossing, -1 before it",
};

// Normal-derived field sources (VOLUMETRIC-4.md §1) — legal ONLY on a
// colour voice (`packages/effects/src/stock.ts`'s
// `validateFieldSynthGeometryNormalFields` rejects them on an active
// geometry voice, on or off the colour stack). Order matches `SYNTH_FIELDS`'
// own append order (strictly after `sierpinski`). Mirror #1 of the six the
// field list is hand-copied into (see the `Object.assign(FIELD_ICONS, …)`
// block above for #2/#3).
export const FIELDS_NORMAL = ["normalX", "normalY", "normalZ", "incidence"] as const;

export const NORMAL_DERIVED_SYNTH_FIELDS: ReadonlySet<string> = new Set(FIELDS_NORMAL);

// ── Space-change validity guard ───────────────────────────────────────────
// Every `space` write — the "Mapping" dropdown, the SOLE control for `space`
// now that VOLUMETRIC-2.md §4 removed the 2D/3D toggle (it duplicated this
// dropdown; `space` IS the semantic switch) — must route through this, or a
// direct write can leave the patch outside `validateParams`: `render:
// "carve"`/`"xray"` are only valid under `space: "object"`, so writing
// `space` directly from {space:"object", render:"carve"} to any other space
// persists an invalid {space:"surface", render:"carve"}. Pure so it's
// testable without mounting the Dock (lil-gui needs a real DOM element).
//
// Leaving "object" forcing `render` back to "paint" is VALIDITY-required —
// covers `render: "carve"` AND `render: "xray"` (the literal "carve" passed
// to `sanitizeCarveRenderForSpace` below is not a narrowing: that helper
// itself checks BOTH values, and this call already only runs when
// `nextSpace !== "object"`, so it unconditionally resolves to "paint"
// regardless of which volumetric render mode was active — one guard, shared
// with the URL decode gate in synthUrlState.ts, not two that could drift).
// Entering "object" forcing the stage to the cube shape is not a validity
// requirement (shape has no bearing on `validateParams`) but mirrors the
// established space -> shape convention already used elsewhere (`applyPreset`
// in SynthWorkbench.tsx) — a flat plane has zero depth and can't preview the
// volumetric branch meaningfully. Leaving "object" deliberately does NOT
// force shape back to "plane" here: `space: "surface"/"scene"` is valid on
// any shape (that's the whole point of generated-surface mapping), so
// forcing "plane" on every dropdown pick that merely selects among the 2D
// mappings would erase whatever 3D shape the user was already looking at.
export function resolveSpaceChange(nextSpace: string): { shape?: string; render?: string } {
  return nextSpace === "object" ? { shape: "cube" } : { render: sanitizeCarveRenderForSpace(nextSpace, "carve") };
}

// ── Render-change validity guard ──────────────────────────────────────────
// Sibling to `resolveSpaceChange` above, same convention: a pure function the
// live "Render" dropdown (Volume folder) routes every `render` write through,
// so a direct write can't leave the patch outside `validateParams`.
//
// Of the two `validateFieldSynthRender` rejections in packages/effects/src/
// stock.ts, only `"xray-subcell-unsupported"` (render: "xray" +
// subcellRes: "2x4"/"ink") is actually reachable by a Render-only change: the
// Volume folder that hosts this dropdown is hidden whenever `space !==
// "object"` (see `volume.hide()` below), so by the time this callback can
// fire at all, `space` is already `"object"` and `"carve-requires-object-
// space"` can never newly trigger from here — that rule stays owned entirely
// by `resolveSpaceChange`/`sanitizeCarveRenderForSpace` on the Mapping side.
// `"empty-glyphs"`, `"non-positive-scale"`, `"multi-layer-argmax"`, and
// `"normal-field-requires-color-stack"` don't depend on `render` at all, so
// no render value can trigger or clear them.
//
// Falling back to `subcellRes: "1x1"` (not e.g. disabling the "xray" option)
// mirrors `resolveSpaceChange`'s own preference for resetting the dependent
// key over blocking the pick — the user can always reach xray and simply
// loses the incompatible subcell mode, matching `SYNTH_REPAIR_TABLE`'s
// `"xray-subcell-unsupported"` row, which resets to the same default.
export function resolveRenderChange(nextRender: string, subcellRes: string): { subcellRes?: string } {
  return nextRender === "xray" && (subcellRes === "2x4" || subcellRes === "ink") ? { subcellRes: "1x1" } : {};
}

// The Output folder's two ink-mode-only rows are mutually exclusive, not
// simultaneously relevant: `inkLevels` is 2D field-synth ink's own knob (how
// many cuts through the field's OWN OBSERVED VALUE RANGE to contour) and is
// a documented no-op under carve-ink, which instead reads `inkSpacing` — an
// ABSOLUTE domain-unit contour interval (VOLUMETRIC-3.md §2; carve
// deliberately never normalizes against an observed range — see
// `packages/effects/src/stock.ts`'s "Contour spacing is ABSOLUTE" doc). Only
// `subcellRes: "ink"` makes either relevant at all, and `render: "xray"`
// always rejects `subcellRes: "ink"` at validation, so the two rows swap in
// place on `render` exactly like the Volume folder's "March fade"/"Xray
// gain" pair already does for two knobs that only ever apply to one render
// mode each. Pure so the swap rule is testable without mounting the Dock
// (lil-gui needs a real DOM element) — same precedent as `resolveSpaceChange`.
export function resolveInkControlVisibility(
  subcellRes: string,
  render: string,
): { showInkLevels: boolean; showInkSpacing: boolean } {
  const isInk = subcellRes === "ink";
  const isCarve = render === "carve";
  return { showInkLevels: isInk && !isCarve, showInkSpacing: isInk && isCarve };
}

export const LIGHT = { direction: [-0.4, -0.6, -0.5] as [number, number, number], intensity: 1.05 };

export const AMBIENT = { intensity: 0.6 };

export function buildLighting(l: Lighting): {
  directionalLight: { direction: [number, number, number]; intensity: number; color: string };
  ambientLight: { intensity: number };
} {
  const a = (l.azimuth * Math.PI) / 180,
    e = (l.elevation * Math.PI) / 180;
  return {
    directionalLight: {
      direction: [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)],
      intensity: l.keyIntensity,
      color: l.keyColor,
    },
    ambientLight: { intensity: l.ambient },
  };
}

export function synthDefaults(): Params {
  const { time: _time, ...rest } = defaultGlyphEffectParams(fieldSynth) as Params;
  return rest;
}

// Fixed representative time for a STATIC (non-animating) preview — picked
// well inside the range the old always-on loop already passed through every
// couple of seconds (`t += dt * 0.8`), so it's not an exotic value, just a
// frozen point on the same trajectory. Nonzero so a `speed: 0`-agnostic wave
// (sin/triangle/saw/square all read `raw - t*speed + phase`) doesn't preview
// at its own degenerate `t = 0` frame, which for several wave/phase
// combinations is a flat or symmetric-looking snapshot that hides the
// pattern's actual character.
export const PREVIEW_STATIC_TIME = 1.2;

/** Same rule for the pattern scale: bounds come from the schema, never a copy. */
const scaleSpecOf = (fieldSynth.parameterSchema as unknown as Record<string, { min?: number; max?: number }>).scale;

export const SCALE_MIN = Number(scaleSpecOf?.min ?? 0.1);

export const SCALE_MAX = Number(scaleSpecOf?.max ?? 12);

/** Same rule for the voice layer count. */
export const MAX_LAYERS = Number(
  (fieldSynth.parameterSchema as unknown as Record<string, { max?: number }>).layer1?.max ?? 3,
);

/** Same rule for march steps' upper bound. */
export const MARCH_STEPS_MAX = Number(
  (fieldSynth.parameterSchema as unknown as Record<string, { max?: number }>).marchSteps?.max ?? 256,
);

// ── Editable slider readout ───────────────────────────────────────────────
/**
 * A voice's `angle` and origin live nowhere in its waveform — a 1D trace has no
 * spatial axis, so rotating a field or moving its centre leaves it identical.
 * This annotates the voice's own preview square with WHERE it sits and WHICH
 * WAY it runs.
 *
 * Drawn per field family, because "direction" means something different in each:
 * a linear field gets an arrow along its propagation direction with a tick for
 * the wavefronts it pushes; radial gets a ring (it is angle-invariant — rotating
 * it changes nothing, and the map should say so); angular/spiral get a ray,
 * since their phase reference does turn with `angle`.
 */
/**
 * Rotation only means something for a field that is not symmetric about its own
 * centre. `radial` is `hypot(x - cx, y - cy)` — turning the sample frame leaves
 * it identical — so its angle control is hidden rather than left as a knob that
 * provably does nothing. Every other field responds: `angular`/`spiral` shift
 * their phase reference, `noise` is sampled at rotated coordinates, and the
 * linear family is the whole point of having the control.
 */
// `linearZ` is likewise invariant: `angle` is always a rotation about Z (see
// AGENTS.md), which leaves the Z axis itself unchanged — `sampleFieldVoice`'s
// volumetric branch reads `raw = z` directly, untouched by the angle-rotated
// sample coordinates linearX/Y read.
//
// The four normal-derived kinds (VOLUMETRIC-4.md §1, colour voice only) are
// invariant for a stronger reason than either of the above: `sampleFieldVoice`
// resolves them through `FieldVoiceRawOverride`, which returns BEFORE
// `rotateVoiceSample`/the origin-translated domain point are ever computed
// (packages/effects/src/fieldProgram.ts) — not just angle, but Origin U/V/W
// too, are complete no-ops, unlike every other field kind where at least
// origin (if not angle) does something. Mirror #5 of the six the field list
// is hand-copied into.
export const angleApplies = (field: string): boolean =>
  field !== "radial" && field !== "linearZ" && !NORMAL_DERIVED_SYNTH_FIELDS.has(field);

// Placement (angle AND origin U/V/W) is a no-op end to end for a
// normal-derived field — see `angleApplies`'s doc above. Colour voice cards
// use this to hide the whole "▸ placement" disclosure for those four kinds,
// rather than opening onto rows that provably do nothing.
export const fieldHasPlacement = (field: string): boolean => !NORMAL_DERIVED_SYNTH_FIELDS.has(field);

// Which mark shape `VoiceFieldMap` draws for a field, factored out as a pure
// function so the per-field branching is testable directly (mirror #6 of the
// six the field list is hand-copied into: this switch, like the other five,
// must stay exhaustive over every field the colour toggle can offer, not
// just the geometry ones it was written against — the "hardcoded-N latent
// bug" class VOLUMETRIC-4.md calls out). `baseAngle`'s keys ARE the "linear"
// case's field set (kept as one object below so the map and this function
// can't independently drift on which fields count as "linear").
// Screen-space angles (0 = along +x/right, 90 = along +y/down in this SVG's
// own coordinate frame), not domain-space. `linearX` reads as vertical
// on-screen gradient / horizontal bands (world X maps to on-screen Y via the
// voxcss camera convention — see AGENTS.md), `linearY` the reverse; `diagonal`
// is a fixed point of that swap (45 either way), unchanged.
export const VOICE_FIELD_MAP_BASE_ANGLE: Record<string, number> = { linearX: 90, linearY: 0, diagonal: 45 };

export type VoiceFieldMapKind = "linear" | "ring" | "no-direction" | "generic";

export function voiceFieldMapKind(field: string): VoiceFieldMapKind {
  if (field in VOICE_FIELD_MAP_BASE_ANGLE) return "linear";
  if (field === "radial" || field === "noise") return "ring";
  if (field === "linearZ" || NORMAL_DERIVED_SYNTH_FIELDS.has(field)) return "no-direction";
  return "generic";
}

// ── Colour voice stack (VOLUMETRIC-4.md §1) ───────────────────────────────
// A second, independent voice program that drives COLOUR only, decoupled
// from the geometry stack above (which drives occupancy + glyph choice) but
// sampled at the SAME point the geometry stack found (§1's "The split").
// `ColorVoiceCard` below deliberately does NOT reuse `VoiceCard` itself —
// that component is threaded with geometry-only concepts a colour voice
// doesn't have (layer assignment, a per-voice `color${slot}` swatch used for
// `voiceColors` blending, `soloParams`' own geometry-solo preview) — but it
// DOES reuse its markup/CSS (`.voice-card`, `.voice-slider`, `IconToggle`,
// `VoiceFieldMap`) so a colour voice card reads as the same idiom, not a
// second bespoke design.

// Isolates one COLOUR voice into `c*1` (camp1) so a card can preview its
// solo spatial contribution — mirroring `soloParams`' geometry solo above,
// but painting it through the colour stack (`colorStackOn: true`) onto a
// flat, otherwise-featureless geometry backdrop (`field1: "radial", freq1:
// 0` — a constant raw value, so every cell reads the SAME glyph and the only
// thing that varies across the preview square is colour) instead of soloing
// a geometry voice's own occupancy/glyph contribution.
export function soloColorParams(params: Params, slot: number): Params {
  const base = synthDefaults();
  for (let k = 1; k <= MAX_VOICES; k++) base[`amp${k}`] = 0;
  base.field1 = "radial";
  base.freq1 = 0;
  base.amp1 = 1;
  base.space = params.space;
  base.scale = params.scale;
  base.glyphs = params.glyphs;
  base.voiceColors = false;
  base.colorStackOn = true;
  base.colorCombine = params.colorCombine;
  base.colorMode = params.colorMode;
  base.hueOffset = params.hueOffset;
  base.hueRange = params.hueRange;
  base.hueSat = params.hueSat;
  base.hueLight = params.hueLight;
  base.color = params.color;
  base.colorB = params.colorB;
  base.gradient = params.gradient;
  for (let k = 1; k <= MAX_COLOR_VOICES; k++) base[`camp${k}`] = 0;
  base.cfield1 = params[`cfield${slot}`];
  base.cwave1 = params[`cwave${slot}`];
  base.cangle1 = params[`cangle${slot}`];
  base.coriginU1 = params[`coriginU${slot}`];
  base.coriginV1 = params[`coriginV${slot}`];
  base.coriginW1 = params[`coriginW${slot}`];
  base.cduty1 = params[`cduty${slot}`];
  base.cphase1 = params[`cphase${slot}`];
  base.cfreq1 = params[`cfreq${slot}`];
  base.cspeed1 = params[`cspeed${slot}`];
  base.camp1 = 1;
  base.citer1 = params[`citer${slot}`];
  base.gain = 1;
  base.bias = 0.5;
  return base;
}

// A fixed accent for colour-voice-only UI (trendline stroke, placement map
// fallback mark) — colour voices have no per-voice swatch of their own (see
// `ColorVoiceCard`'s doc above), unlike a geometry voice's `color${slot}`,
// so there's no per-voice value to read here. Distinct from the geometry
// rail's cyan (`#38bdf8`) so a colour voice card is visually legible as
// belonging to the OTHER stack even before reading its label.
export const COLOR_VOICE_ACCENT = "#f472b6";

// First slot 1..max not present in `existing` — 0 if all `max` slots are
// occupied (the caller then no-ops, matching the "Add" button's own
// `disabled` state at the cap). Shared by `ColorStackSection`'s "+ Add
// colour voice" (max = `MAX_COLOR_VOICES`) — exported so the cap is
// testable as a pure function, the same precedent as
// `resolveInkControlVisibility`/`resolveSpaceChange` below.
export function nextFreeVoiceSlot(existing: readonly number[], max: number): number {
  for (let k = 1; k <= max; k++) if (!existing.includes(k)) return k;
  return 0;
}

// ── Precedence table (VOLUMETRIC-4.md §1, verbatim) — pure so it's testable
// without mounting the Dock or the sidebar, same precedent as
// `resolveInkControlVisibility`/`resolveSpaceChange` above:
//
// | `colorStackOn` | Behaviour |
// |---|---|
// | off | today exactly — `voiceColors` toggle live (right Dock), `color`/`colorB`/`gradient`
// |     | its endpoints (right Dock). |
// | on  | `voiceColors` toggle HIDES from the Dock (ignored by the engine). `color`/`colorB`/
// |     | `gradient` move to the left sidebar's `ColorStackSection` and stay visible there under
// |     | `colorMode: "gradient"` (repurposed as its endpoints); under `"hue"` they hide and the
// |     | hue params (offset/range/sat/light) show there instead. Either way, once the stack is
// |     | on the Dock gives up all five rows outright — see `SynthDock`'s own `!colorStackOn`
// |     | gate on Color/Color B/Gradient, and the fact it never creates a Hue* row at all. Each
// |     | geometry `VoiceCard`'s own per-voice `color${slot}` swatch (`.voice-color`) hides too —
// |     | it drives `voiceColors` blending, whose own toggle is already hidden as meaningless in
// |     | this state; the stored value is untouched (display-only), and the card's trendline/solo
// |     | preview keep reading `color${slot}` directly rather than through the swatch. |
export function resolveColorStackVisibility(
  colorStackOn: boolean,
  colorMode: string,
): {
  showVoiceColorsToggle: boolean;
  showGradientColors: boolean;
  showHueControls: boolean;
  showVoiceColorSwatch: boolean;
} {
  return {
    showVoiceColorsToggle: !colorStackOn,
    showGradientColors: !colorStackOn || colorMode === "gradient",
    showHueControls: colorStackOn && colorMode === "hue",
    showVoiceColorSwatch: !colorStackOn,
  };
}
