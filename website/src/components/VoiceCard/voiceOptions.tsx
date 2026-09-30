import { type ReactNode } from "react";
import {
  FIELDS,
  FIELDS_3D,
  FIELDS_NORMAL,
  FIELD_DESCRIPTIONS,
  MAX_LAYERS,
  SUBCELL_RES,
  WAVES,
  WAVE_DESCRIPTIONS,
} from "../../features/synth/model/parameters";
import { ToggleIcon } from "../IconToggle/index";

// Each shape is tuned at actual button size (~15px), not just eyeballed bigger and
// shrunk: round joins blur short segments into blobs at this size, so `saw` and
// `square` use square caps/miter joins to keep their corners crisp, and `square`'s
// plateaus are widened relative to its drop so they don't get swallowed by the cap.
export const WAVE_ICONS: Record<string, ReactNode> = {
  sin: (
    <ToggleIcon>
      <path d="M2 8 C4 2 6 2 8 8 C10 14 12 14 14 8" />
    </ToggleIcon>
  ),
  triangle: (
    <ToggleIcon>
      <path d="M2 12 L5 4 L8 12 L11 4 L14 12" />
    </ToggleIcon>
  ),
  saw: (
    <ToggleIcon strokeLinecap="square" strokeLinejoin="miter">
      <path d="M2 13 L8 3 L8 13 L14 3" />
    </ToggleIcon>
  ),
  square: (
    <ToggleIcon strokeWidth={1.4} strokeLinecap="square" strokeLinejoin="miter">
      <path d="M2 6 H6 V11 H10 V6 H14" />
    </ToggleIcon>
  ),
  // A SINGLE riser (flat, then one hard edge up, then flat) — deliberately
  // distinct from `square`'s repeated up-down plateaus, since `step` is
  // non-periodic (VOLUMETRIC-2.md §2): one edge, not a repeating pulse.
  step: (
    <ToggleIcon strokeWidth={1.4} strokeLinecap="square" strokeLinejoin="miter">
      <path d="M2 12 H7 V4 H14" />
    </ToggleIcon>
  ),
};

export const FIELD_ICONS: Record<string, ReactNode> = {
  radial: (
    <ToggleIcon strokeWidth={1.3}>
      <circle cx="8" cy="8" r="2" />
      <circle cx="8" cy="8" r="4.3" />
      <circle cx="8" cy="8" r="6.5" />
    </ToggleIcon>
  ),
  // Level-set icons, matching the convention `radial`/`angular` already use:
  // each shows what you'll actually SEE on screen, not the domain-space
  // sweep axis. The camera's voxcss convention maps world X to on-screen
  // Y (see AGENTS.md's numeric-conventions section + `rotateVec3Voxcss`),
  // so `linearX` reads as HORIZONTAL bands and `linearY` as VERTICAL bands
  // on the rendered field — the opposite of a naive domain-space reading.
  linearX: (
    <ToggleIcon>
      <path d="M2 4 H14 M2 8 H14 M2 12 H14" />
    </ToggleIcon>
  ),
  linearY: (
    <ToggleIcon>
      <path d="M4 2 V14 M8 2 V14 M12 2 V14" />
    </ToggleIcon>
  ),
  // `diagonal`'s bands run "/" (anti-diagonal, bottom-left to top-right) on
  // screen — SVG y is down, so this is drawn as three parallel segments
  // with dx > 0, dy < 0.
  diagonal: (
    <ToggleIcon>
      <path d="M1 9 L9 1 M4 12 L12 4 M7 15 L15 7" />
    </ToggleIcon>
  ),
  angular: (
    <ToggleIcon>
      <path d="M13 6 A6 6 0 1 1 6.2 2.3" />
      <path d="M9.5 1.3 L6.2 2.3 L7.6 5.3" fill="currentColor" stroke="none" />
    </ToggleIcon>
  ),
  // Archimedean spiral (2.2 turns), sampled to a fixed polyline — a hand-drawn
  // nested-arc "snail shell" path read as a crown/W at icon size, this reads
  // unambiguously as a spiral.
  spiral: (
    <ToggleIcon strokeWidth={1.3}>
      <path d="M8.50 8.00 L8.58 8.22 L8.57 8.49 L8.42 8.76 L8.15 8.98 L7.77 9.10 L7.34 9.05 L6.92 8.83 L6.58 8.44 L6.39 7.91 L6.40 7.31 L6.66 6.71 L7.13 6.21 L7.80 5.90 L8.57 5.84 L9.36 6.07 L10.05 6.60 L10.53 7.37 L10.71 8.30 L10.55 9.28 L10.03 10.18 L9.20 10.86 L8.13 11.22 L6.96 11.19 L5.84 10.72 L4.93 9.87 L4.35 8.71 L4.21 7.37 L4.55 6.03 L5.37 4.86 L6.59 4.03 L8.06 3.66 L9.61 3.84 L11.04 4.56 L12.15 5.77 L12.79 7.34 L12.84 9.08 L12.27 10.76 L11.12 12.17 L9.51 13.11 L7.63 13.44 L5.71 13.09 L3.99 12.06 L2.72 10.47 L2.07 8.49 L2.15 6.36 L2.98 4.36" />
    </ToggleIcon>
  ),
  noise: (
    <ToggleIcon fill="currentColor" stroke="none">
      <circle cx="3" cy="5" r="0.9" />
      <circle cx="6.5" cy="3" r="0.9" />
      <circle cx="10" cy="4.5" r="0.9" />
      <circle cx="13" cy="6.5" r="0.9" />
      <circle cx="4" cy="10" r="0.9" />
      <circle cx="8" cy="8.5" r="0.9" />
      <circle cx="12" cy="11.5" r="0.9" />
      <circle cx="6" cy="13" r="0.9" />
    </ToggleIcon>
  ),
  // Third-axis (depth) sweep — only meaningful in the volumetric branch, so
  // this reads as "into the screen" rather than another in-plane direction:
  // two receding squares joined by a diagonal, the classic isometric depth cue.
  linearZ: (
    <ToggleIcon strokeWidth={1.3}>
      <rect x="2.5" y="2.5" width="6" height="6" />
      <rect x="7.5" y="7.5" width="6" height="6" />
      <line x1="8.5" y1="8.5" x2="5.5" y2="5.5" />
    </ToggleIcon>
  ),
  // SDF voice family (VOLUMETRIC-2.md §2) — 3D-only, so these three only ever
  // appear in `FIELD_TOGGLE_3D`.
  // Gyroid: a triply-periodic labyrinth, not built from wave layers — two
  // interleaved wavy strands suggest the woven implicit surface.
  gyroid: (
    <ToggleIcon strokeWidth={1.2}>
      <path d="M1 5 C3 1 5 1 7 5 C9 9 11 9 13 5 C15 1 15 1 15 1" />
      <path d="M1 11 C3 7 5 7 7 11 C9 15 11 15 13 11" opacity={0.55} />
    </ToggleIcon>
  ),
  // Menger: 2D carpet motif — four corner blocks, a cross-shaped hole where
  // the middle row/column were removed (the first-iteration cross-section).
  menger: (
    <ToggleIcon fill="currentColor" stroke="none">
      <rect x="2" y="2" width="4.5" height="4.5" />
      <rect x="9.5" y="2" width="4.5" height="4.5" />
      <rect x="2" y="9.5" width="4.5" height="4.5" />
      <rect x="9.5" y="9.5" width="4.5" height="4.5" />
    </ToggleIcon>
  ),
  // Sierpinski: the classic depth-1 gasket silhouette — three corner
  // triangles, hollow middle.
  sierpinski: (
    <ToggleIcon fill="currentColor" stroke="none">
      <path d="M8 2 L11 7 L5 7 Z" />
      <path d="M2 13 L5 8 L8 13 Z" />
      <path d="M8 13 L11 8 L14 13 Z" />
    </ToggleIcon>
  ),
};

// Short, concrete per-option hover copy — each button's `title` names the
// shape AND says what it does, so a voice card is self-explanatory without
// leaving the page (see `AGENTS.md`'s field-synth section for the source
// semantics: `fieldN` is the spatial domain, `waveN` is the oscillator shape
// sampled across it).
// Normal-derived field sources (VOLUMETRIC-4.md §1) — icons + descriptions
// live in the SAME `FIELD_ICONS`/`FIELD_DESCRIPTIONS` records every other
// field kind uses (mirror #2/#3 of the six the field list is hand-copied
// into — see `FIELDS_COLOR`/`FIELDS_COLOR_3D` below for #1). Not referenced
// by `FIELD_TOGGLE`/`FIELD_TOGGLE_3D` (geometry voices reject these four —
// `validateFieldSynthGeometryNormalFields` in packages/effects/src/stock.ts),
// only by the colour-voice toggles.
Object.assign(FIELD_ICONS, {
  // A face viewed edge-on (the line runs perpendicular to X, so it appears
  // as a vertical stroke from the side) with an arrow along +X — "this
  // component of the face's own outward normal".
  normalX: (
    <ToggleIcon strokeWidth={1.3}>
      <line x1="8" y1="3" x2="8" y2="13" />
      <line x1="8" y1="8" x2="13" y2="8" />
      <path d="M10.3 5.7 L13 8 L10.3 10.3" />
    </ToggleIcon>
  ),
  normalY: (
    <ToggleIcon strokeWidth={1.3}>
      <line x1="3" y1="8" x2="13" y2="8" />
      <line x1="8" y1="8" x2="8" y2="3" />
      <path d="M5.7 5.7 L8 3 L10.3 5.7" />
    </ToggleIcon>
  ),
  // Z points at the viewer for a face viewed face-on — the standard
  // "vector out of the page" dot-in-circle notation.
  normalZ: (
    <ToggleIcon strokeWidth={1.3}>
      <circle cx="8" cy="8" r="5.2" />
      <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
    </ToggleIcon>
  ),
  // A ray meeting a surface at a shallow angle, with the angle itself
  // marked — "how grazing is this view of the surface".
  incidence: (
    <ToggleIcon strokeWidth={1.3}>
      <line x1="1.5" y1="12.5" x2="14.5" y2="12.5" />
      <path d="M3 3 L12 11" />
      <path d="M9.3 9.9 L12 11 L11.4 8.1" />
      <path d="M4.3 10.7 A4 4 0 0 1 6.6 8.9" strokeDasharray="1.5 1.3" />
    </ToggleIcon>
  ),
});

export const FIELD_TOGGLE = FIELDS.map((v) => ({
  value: v as string,
  icon: FIELD_ICONS[v],
  label: v,
  desc: FIELD_DESCRIPTIONS[v],
}));

export const FIELD_TOGGLE_3D = FIELDS_3D.map((v) => ({
  value: v as string,
  icon: FIELD_ICONS[v],
  label: v,
  desc: FIELD_DESCRIPTIONS[v],
}));

export const WAVE_TOGGLE = WAVES.map((v) => ({
  value: v as string,
  icon: WAVE_ICONS[v],
  label: v,
  desc: WAVE_DESCRIPTIONS[v],
}));

// A colour voice's field toggle is the SAME set a geometry voice sees for the
// current `space` (2D vs. volumetric — normal fields don't gate on this,
// they only need `colorStackOn`, see `evaluate()`'s "REGARDLESS of space"
// doc in stock.ts) plus the four normal-derived kinds, always offered
// regardless of `space`. Mirror #4 (`FIELD_TOGGLE`/`FIELD_TOGGLE_3D`'s own
// colour-voice sibling).
const FIELD_TOGGLE_NORMAL = FIELDS_NORMAL.map((v) => ({
  value: v as string,
  icon: FIELD_ICONS[v],
  label: v,
  desc: FIELD_DESCRIPTIONS[v],
}));

export const FIELD_TOGGLE_COLOR = [...FIELD_TOGGLE, ...FIELD_TOGGLE_NORMAL];

export const FIELD_TOGGLE_COLOR_3D = [...FIELD_TOGGLE_3D, ...FIELD_TOGGLE_NORMAL];

// Single filled cell (one glyph per cell, ramp-based) vs. a braille-style
// 2x4 dot grid (the synthesized dot mask `subcellRes: "2x4"` renders instead)
// — reads at a glance instead of the raw "1x1"/"2x4" strings.
export const SUBCELL_ICONS: Record<string, ReactNode> = {
  "1x1": (
    <ToggleIcon fill="currentColor" stroke="none">
      <rect x="4" y="4" width="8" height="8" />
    </ToggleIcon>
  ),
  "2x4": (
    <ToggleIcon fill="currentColor" stroke="none">
      <circle cx="5.3" cy="3.3" r="1.05" />
      <circle cx="10.7" cy="3.3" r="1.05" />
      <circle cx="5.3" cy="6.4" r="1.05" />
      <circle cx="10.7" cy="6.4" r="1.05" />
      <circle cx="5.3" cy="9.5" r="1.05" />
      <circle cx="10.7" cy="9.5" r="1.05" />
      <circle cx="5.3" cy="12.6" r="1.05" />
      <circle cx="10.7" cy="12.6" r="1.05" />
    </ToggleIcon>
  ),
  // A contour line rather than a fill — what the mode actually draws.
  ink: (
    <ToggleIcon fill="none" stroke="currentColor">
      <path d="M2 11 C5 11, 5 5, 8 5 C11 5, 11 11, 14 11" strokeWidth="1.6" />
    </ToggleIcon>
  ),
};

export const SUBCELL_TOGGLE = SUBCELL_RES.map((v) => ({
  value: v as string,
  icon: SUBCELL_ICONS[v],
  label: v,
  desc:
    v === "1x1"
      ? "one glyph per cell, picked from the ramp"
      : v === "2x4"
        ? "braille dot matrix per cell — finer apparent grain, ignores the ramp"
        : "iso-contour: trace where the field crosses a level, oriented to the slope; flat crests fill as blocks. Ignores the ramp",
}));

/** Per-voice layer assignment (VOLUMETRIC.md's Step 3) — a compact numbered
 *  segmented control, reusing `IconToggle`'s markup with a text label instead
 *  of a shape icon (a layer has no natural glyph the way a field/wave does). */
export const LAYER_TOGGLE = Array.from({ length: MAX_LAYERS }, (_, i) => {
  const n = i + 1;
  return {
    value: String(n),
    icon: <span className="gx-toggle-text">{n}</span>,
    label: `Layer ${n}`,
    desc: `assigns this voice to layer ${n} — voices on the same layer fold together before layers combine`,
  };
});

/** A `VoiceCard`'s own display density — viewer preference, never persisted
 *  to the `?s=` URL (patch content and display density are independent; a
 *  shared link's bytes must not change with this). `undefined`/omitted on
 *  the card itself means "unmanaged": every existing caller (the loaders
 *  gallery) that never passes `mode` keeps the full original layout, object
 *  preview included, byte-for-byte — this is an opt-in per card, not a
 *  default that changes existing callers. */
export type VoiceDisplayMode = "basic" | "advanced";

/** Basic/Advanced segmented toggle — reuses `IconToggle`'s markup with a text
 *  label instead of a shape icon, same technique as `LAYER_TOGGLE` above (a
 *  display mode has no natural glyph either). Two consumers: a `VoiceCard`'s
 *  own per-card toggle, and one global toggle in the voice sidebar header
 *  that sets every card at once. */
export const VOICE_MODE_TOGGLE = (["basic", "advanced"] as const).map((v) => ({
  value: v as string,
  icon: <span className="gx-toggle-text">{v === "basic" ? "bsc" : "adv"}</span>,
  label: v === "basic" ? "Basic" : "Advanced",
  desc:
    v === "basic"
      ? "wave, field, freq, speed, and any conditional params (duty, iter) — the compact view"
      : "basic plus mix, phase, layer assignment, and placement (angle/origin)",
}));
