import { type GlyphEffectBlend } from "glyphcss";
import { STAGE_CAMERA_ROT_X, STAGE_CAMERA_ROT_Y } from "../../features/synth/model/parameters";

// The ONE blend both `scene.addEffectLayer()` calls below mount the layer
// with. The static export must read the layer's REAL blend rather than the
// effect definition's own `defaultBlend` metadata (see
// `GlyphFieldSynthStaticExportOptions.blend` doc) — sharing this constant
// keeps the exported pen from silently drifting off whatever the live scene
// actually renders with.
export const SYNTH_EFFECT_BLEND: GlyphEffectBlend = "replace";

// Default (non-flat) orbit camera angle/zoom — `STAGE_CAMERA_ROT_X/Y/ZOOM`
// from synthKit.tsx, the single source of truth `shapeTransform("pyramid")`'s
// upright reorientation is tuned against and the arbiter test in
// synthKit.test.ts projects through. Kept as local aliases so
// `applyPreset`'s stage-hint reset can restore exactly this, not a
// magic-number duplicate of it.
export const DEFAULT_CAMERA_ROT_X = STAGE_CAMERA_ROT_X;

export const DEFAULT_CAMERA_ROT_Y = STAGE_CAMERA_ROT_Y;

// Camera auto-orbit pace (user request, "screensaver, not spin cycle") at
// `orbitSpeed: 1`, the slider's default — a full yaw revolution takes a
// minute, and the pitch ping-pong's own period (~135° of travel at 4°/s, one
// way) isn't a clean multiple of the yaw period, so the combined path reads
// as a gentle Lissajous drift rather than an obviously looping tour. Pitch
// bounces between MIN and MAX instead of wrapping through the poles — a full
// -90..90 sweep would flip past looking straight down/up, which reads as a
// glitch, not a drift — but the range still dips below and rises above the
// horizontal (0°) so both the top and underside of the stage come into view.
export const ORBIT_YAW_DEG_PER_SEC = 6;

export const ORBIT_PITCH_DEG_PER_SEC = 4;

export const ORBIT_PITCH_MIN = -55;

export const ORBIT_PITCH_MAX = 80;
