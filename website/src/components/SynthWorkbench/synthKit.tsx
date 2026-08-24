import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type SVGProps } from "react";
import { createPortal } from "react-dom";
import {
  createGlyphScene,
  createGlyphOrthographicCamera,
  createGlyphOrbitControls,
  injectGlyphBaseStyles,
  resolveGeometry,
  buildGlyphInteractiveExport,
  glyphCodepenPrefill,
  type GlyphEffectBlend,
  type GlyphGeometryName,
  type GlyphMeshTransform,
  type GlyphSceneHandle,
} from "glyphcss";
import {
  GlyphFieldSynthEffect as fieldSynth,
  GlyphBreathingGyroidPreset,
  GlyphCssGraphicsMengerPreset,
  GlyphCubeTilesPreset,
  GlyphSierpinskiPyramidPreset,
  buildGlyphFieldSynthStaticExport,
  calibrateGlyphRamp,
  combineSynth,
  defaultGlyphEffectParams,
  GlyphRamps,
  measureGlyphInkCoverage,
  SYNTH_COLOR_VOICES,
  synthWave,
} from "@glyphcss/effects";
import type { GlyphEffectPreset, GlyphFieldSynthStaticExportResult } from "@glyphcss/effects";
import { Dock } from "../Dock";
import { useDockGui } from "../Dock/slots";
import { useColor, useDockSlot, useFolder, useOption, useSlider, useText, useToggle } from "../Dock/primitives";


import { sanitizeCarveRenderForSpace, MAX_VOICES, type Lighting } from "./synthUrlState";
import {
  InstrumentBody,
  InstrumentMain,
  InstrumentMobileTabs,
  InstrumentRail,
  InstrumentShell,
  InstrumentTray,
  InstrumentViewport,
} from "../InstrumentWorkbench/InstrumentWorkbench";
import "../GalleryWorkbench/gallery-workbench.css";
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
export const SHAPES: string[] = ["plane", "cube", "sphere", "icosahedron", "dodecahedron", "octahedron", "cylinder", "cone", "torus", "tetrahedron", "pyramid"];
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

export const opts =<T extends string>(list: readonly T[] | string[]): Record<string, T> => Object.fromEntries(list.map((v) => [v, v])) as Record<string, T>;
export const SHAPE_OPTS = opts(SHAPES), COMBINE_OPTS = opts(COMBINES), SPACE_OPTS = opts(SPACES);
export const LAYER_COMBINE_OPTS = opts(LAYER_COMBINE_VALUES), LAYER_BLEND_OPTS = opts(LAYER_VALUE_OPS), RENDER_OPTS = opts(RENDER_MODES);
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

export const RAMP_CALIBRATION_STEPS = 10;

export interface RampCalibrationState {
  /** Font-calibrated ramp, darkest → densest. `null` until measured. */
  ramp: string | null;
  /** Per-glyph measured ink coverage (0..1) for every ramp option, keyed by
   *  its `RAMP_OPTS` name (authored ramps AND `CALIBRATED_RAMP_NAME`). Empty
   *  until the font is ready and measurement completes. */
  coverageByOption: Record<string, number[]>;
}

// Measures the PAGE's actual resolved render font (read live off the mounted
// `<pre class="glyph-output">`, not a hardcoded guess) and produces both a
// calibrated ramp and a density table for every ramp option, for the density
// bars in the picker. `document.fonts.ready` is awaited FIRST — canvas glyph
// measurement races webfont loading, so measuring before it resolves can
// silently measure a fallback font's metrics instead of the real one.
export function useRampCalibration(hostRef: { current: HTMLElement | null }): RampCalibrationState {
  const [state, setState] = useState<RampCalibrationState>({ ramp: null, coverageByOption: {} });
  useEffect(() => {
    if (typeof document === "undefined") return;
    let cancelled = false;
    document.fonts.ready.then(() => {
      if (cancelled) return;
      const font = getRenderFont(hostRef.current);
      const calibrated = calibrateGlyphRamp({ font, steps: RAMP_CALIBRATION_STEPS });
      const coverageByOption: Record<string, number[]> = { [CALIBRATED_RAMP_NAME]: calibrated.steps.map((step) => step.coverage) };
      for (const [name, glyphs] of Object.entries(GlyphRamps)) {
        coverageByOption[name] = glyphs.split("").map((glyph) => measureGlyphInkCoverage(glyph, { font }));
      }
      if (!cancelled) setState({ ramp: calibrated.ramp, coverageByOption });
    });
    return () => { cancelled = true; };
  }, [hostRef]);
  return state;
}

// Reads the page's actual resolved render font off the mounted
// `<pre class="glyph-output">` (not a hardcoded guess) — shared by ramp
// calibration and the live "Custom" swatch measurement below.
export function getRenderFont(host: HTMLElement | null): { family: string; size: number; weight?: string } {
  const pre = host?.querySelector("pre.glyph-output") as HTMLElement | null;
  const cs = pre ? getComputedStyle(pre) : null;
  return { family: cs?.fontFamily || "monospace", size: cs ? parseFloat(cs.fontSize) || 16 : 16, weight: cs?.fontWeight };
}

// Measures the CURRENTLY TYPED `glyphs` string (not a preset) so the density
// illustration keeps describing what's actually rendering when the ramp
// doesn't match any `GlyphRamps` preset. Debounced 250ms: canvas glyph
// measurement runs per character, so re-measuring on every keystroke would
// paint a fresh <canvas> per key while the user is mid-edit — 250ms lands
// after a typing pause without reading as laggy.
export const CUSTOM_RAMP_MEASURE_DEBOUNCE_MS = 250;
export function useCustomRampCoverage(hostRef: { current: HTMLElement | null }, glyphs: string): number[] {
  const [coverage, setCoverage] = useState<number[]>([]);
  useEffect(() => {
    if (typeof document === "undefined") return;
    let cancelled = false;
    const chars = Array.from(glyphs);
    if (chars.length === 0) { setCoverage([]); return; }
    const timer = window.setTimeout(() => {
      document.fonts.ready.then(() => {
        if (cancelled) return;
        const font = getRenderFont(hostRef.current);
        setCoverage(chars.map((glyph) => measureGlyphInkCoverage(glyph, { font })));
      });
    }, CUSTOM_RAMP_MEASURE_DEBOUNCE_MS);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [hostRef, glyphs]);
  return coverage;
}

// Small measured-coverage density bar per ramp option — darkest glyph's bar
// is shortest, densest glyph's bar is tallest, using the SAME per-font
// measurement `useRampCalibration` produces (so "Calibrated"'s bars and the
// authored ramps' bars are directly comparable, real ink coverage, not a
// synthetic index-based ramp). `disabledReason`, when set, replaces the
// swatches with a visible explanation instead of just dimming them (2x4
// subcell mode renders Braille dots and never reads the ramp at all).
export function RampDensityRow({ names, coverageByOption, selected, onSelect, disabledReason }: {
  names: string[]; coverageByOption: Record<string, number[]>; selected: string; onSelect: (name: string) => void;
  disabledReason?: string;
}) {
  if (disabledReason) {
    return <p className="dock-ramp-density-reason">{disabledReason}</p>;
  }
  return (
    <div className="dock-ramp-density" role="listbox" aria-label="Ramp density preview">
      {names.map((name) => {
        const coverage = coverageByOption[name];
        return (
          <button
            key={name}
            type="button"
            role="option"
            aria-selected={name === selected}
            className={`dock-ramp-density-item${name === selected ? " is-active" : ""}`}
            onClick={() => onSelect(name)}
            title={name === CALIBRATED_RAMP_NAME ? "Font-calibrated — measured from the viewer's actual font stack" : name}
          >
            <span className="dock-ramp-density-bars">
              {coverage
                ? coverage.map((c, i) => <span key={i} className="dock-ramp-density-bar" style={{ height: `${Math.max(6, c * 100)}%` }} />)
                : <span className="dock-ramp-density-pending">…</span>}
            </span>
            <span className="dock-ramp-density-label">{name}</span>
          </button>
        );
      })}
    </div>
  );
}

// Inline SVG icons for the field/wave multi-toggles (segmented control, like
// text-align). `stroke`/`fill: currentColor` so each icon inherits the button's
// text color for free — dim when inactive, cyan when `.is-active` (see
// `.gx-toggle-btn` / `.gx-toggle-btn.is-active` in the shared apparatus CSS).
export function ToggleIcon({ children, ...rest }: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

// Each shape is tuned at actual button size (~15px), not just eyeballed bigger and
// shrunk: round joins blur short segments into blobs at this size, so `saw` and
// `square` use square caps/miter joins to keep their corners crisp, and `square`'s
// plateaus are widened relative to its drop so they don't get swallowed by the cap.
export const WAVE_ICONS: Record<string, ReactNode> = {
  sin: <ToggleIcon><path d="M2 8 C4 2 6 2 8 8 C10 14 12 14 14 8" /></ToggleIcon>,
  triangle: <ToggleIcon><path d="M2 12 L5 4 L8 12 L11 4 L14 12" /></ToggleIcon>,
  saw: <ToggleIcon strokeLinecap="square" strokeLinejoin="miter"><path d="M2 13 L8 3 L8 13 L14 3" /></ToggleIcon>,
  square: <ToggleIcon strokeWidth={1.4} strokeLinecap="square" strokeLinejoin="miter"><path d="M2 6 H6 V11 H10 V6 H14" /></ToggleIcon>,
  // A SINGLE riser (flat, then one hard edge up, then flat) — deliberately
  // distinct from `square`'s repeated up-down plateaus, since `step` is
  // non-periodic (VOLUMETRIC-2.md §2): one edge, not a repeating pulse.
  step: <ToggleIcon strokeWidth={1.4} strokeLinecap="square" strokeLinejoin="miter"><path d="M2 12 H7 V4 H14" /></ToggleIcon>,
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
  linearX: <ToggleIcon><path d="M2 4 H14 M2 8 H14 M2 12 H14" /></ToggleIcon>,
  linearY: <ToggleIcon><path d="M4 2 V14 M8 2 V14 M12 2 V14" /></ToggleIcon>,
  // `diagonal`'s bands run "/" (anti-diagonal, bottom-left to top-right) on
  // screen — SVG y is down, so this is drawn as three parallel segments
  // with dx > 0, dy < 0.
  diagonal: <ToggleIcon><path d="M1 9 L9 1 M4 12 L12 4 M7 15 L15 7" /></ToggleIcon>,
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
export const FIELD_TOGGLE = FIELDS.map((v) => ({ value: v as string, icon: FIELD_ICONS[v], label: v, desc: FIELD_DESCRIPTIONS[v] }));
export const FIELD_TOGGLE_3D = FIELDS_3D.map((v) => ({ value: v as string, icon: FIELD_ICONS[v], label: v, desc: FIELD_DESCRIPTIONS[v] }));
export const WAVE_TOGGLE = WAVES.map((v) => ({ value: v as string, icon: WAVE_ICONS[v], label: v, desc: WAVE_DESCRIPTIONS[v] }));

// Normal-derived field sources (VOLUMETRIC-4.md §1) — legal ONLY on a
// colour voice (`packages/effects/src/stock.ts`'s
// `validateFieldSynthGeometryNormalFields` rejects them on an active
// geometry voice, on or off the colour stack). Order matches `SYNTH_FIELDS`'
// own append order (strictly after `sierpinski`). Mirror #1 of the six the
// field list is hand-copied into (see the `Object.assign(FIELD_ICONS, …)`
// block above for #2/#3).
export const FIELDS_NORMAL = ["normalX", "normalY", "normalZ", "incidence"] as const;
export const NORMAL_DERIVED_SYNTH_FIELDS: ReadonlySet<string> = new Set(FIELDS_NORMAL);
// A colour voice's field toggle is the SAME set a geometry voice sees for the
// current `space` (2D vs. volumetric — normal fields don't gate on this,
// they only need `colorStackOn`, see `evaluate()`'s "REGARDLESS of space"
// doc in stock.ts) plus the four normal-derived kinds, always offered
// regardless of `space`. Mirror #4 (`FIELD_TOGGLE`/`FIELD_TOGGLE_3D`'s own
// colour-voice sibling).
const FIELD_TOGGLE_NORMAL = FIELDS_NORMAL.map((v) => ({ value: v as string, icon: FIELD_ICONS[v], label: v, desc: FIELD_DESCRIPTIONS[v] }));
export const FIELD_TOGGLE_COLOR = [...FIELD_TOGGLE, ...FIELD_TOGGLE_NORMAL];
export const FIELD_TOGGLE_COLOR_3D = [...FIELD_TOGGLE_3D, ...FIELD_TOGGLE_NORMAL];

// Single filled cell (one glyph per cell, ramp-based) vs. a braille-style
// 2x4 dot grid (the synthesized dot mask `subcellRes: "2x4"` renders instead)
// — reads at a glance instead of the raw "1x1"/"2x4" strings.
export const SUBCELL_ICONS: Record<string, ReactNode> = {
  "1x1": <ToggleIcon fill="currentColor" stroke="none"><rect x="4" y="4" width="8" height="8" /></ToggleIcon>,
  "2x4": (
    <ToggleIcon fill="currentColor" stroke="none">
      <circle cx="5.3" cy="3.3" r="1.05" /><circle cx="10.7" cy="3.3" r="1.05" />
      <circle cx="5.3" cy="6.4" r="1.05" /><circle cx="10.7" cy="6.4" r="1.05" />
      <circle cx="5.3" cy="9.5" r="1.05" /><circle cx="10.7" cy="9.5" r="1.05" />
      <circle cx="5.3" cy="12.6" r="1.05" /><circle cx="10.7" cy="12.6" r="1.05" />
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
  desc: v === "1x1"
    ? "one glyph per cell, picked from the ramp"
    : v === "2x4"
      ? "braille dot matrix per cell — finer apparent grain, ignores the ramp"
      : "iso-contour: trace where the field crosses a level, oriented to the slope; flat crests fill as blocks. Ignores the ramp",
}));

export function IconToggle({ options, value, onChange, groupTitle }: {
  options: { value: string; icon: ReactNode; label: string; desc?: string }[]; value: string; onChange: (v: string) => void; groupTitle?: string;
}) {
  return (
    <div className="gx-toggle" role="group" title={groupTitle}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`gx-toggle-btn${o.value === value ? " is-active" : ""}`}
          title={o.desc ? `${o.label} — ${o.desc}` : o.label}
          aria-label={o.label}
          onClick={() => onChange(o.value)}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}

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
export function resolveInkControlVisibility(subcellRes: string, render: string): { showInkLevels: boolean; showInkSpacing: boolean } {
  const isInk = subcellRes === "ink";
  const isCarve = render === "carve";
  return { showInkLevels: isInk && !isCarve, showInkSpacing: isInk && isCarve };
}

export const LIGHT = { direction: [-0.4, -0.6, -0.5] as [number, number, number], intensity: 1.05 };
export const AMBIENT = { intensity: 0.6 };

export function buildLighting(l: Lighting): { directionalLight: { direction: [number, number, number]; intensity: number; color: string }; ambientLight: { intensity: number } } {
  const a = (l.azimuth * Math.PI) / 180, e = (l.elevation * Math.PI) / 180;
  return {
    directionalLight: { direction: [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)], intensity: l.keyIntensity, color: l.keyColor },
    ambientLight: { intensity: l.ambient },
  };
}

export function synthDefaults(): Params {
  const { time: _time, ...rest } = defaultGlyphEffectParams(fieldSynth) as Params;
  return rest;
}

// A flat square in the world XY plane with 0..1 UVs — a clean 2D surface for
// previews and the scene-filling "plane" shape.
export function flatQuad(size: number): Polys {
  const p = {
    vertices: [[-size, -size, 0], [size, -size, 0], [size, size, 0], [-size, size, 0]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
  };
  return [p] as unknown as Polys;
}
// Give each face its own local 0..1 UV (project onto the face plane, normalize to
// the face's bbox) so surface effects map PER-FACE — each face reads like its own
// plane, patterns centre on it — instead of a world-continuous wrap.
export type V3 = [number, number, number];
export const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vcross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vdot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vnorm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export function withFaceUvs(polys: Polys): Polys {
  return (polys as unknown as { vertices: V3[] }[]).map((p) => {
    const vs = p.vertices;
    if (vs.length < 3) return p;
    const n = vnorm(vcross(vsub(vs[1], vs[0]), vsub(vs[2], vs[0])));
    const u = vnorm(vsub(vs[1], vs[0]));
    const v = vcross(n, u);
    const proj = vs.map((w) => { const d = vsub(w, vs[0]); return [vdot(d, u), vdot(d, v)] as [number, number]; });
    let mnu = Infinity, mxu = -Infinity, mnv = Infinity, mxv = -Infinity;
    for (const [pu, pv] of proj) { if (pu < mnu) mnu = pu; if (pu > mxu) mxu = pu; if (pv < mnv) mnv = pv; if (pv > mxv) mxv = pv; }
    const su = (mxu - mnu) || 1, sv = (mxv - mnv) || 1;
    return { ...p, uvs: proj.map(([pu, pv]) => [(pu - mnu) / su, (pv - mnv) / sv]) };
  }) as unknown as Polys;
}
// The `pyramid` stage: an UNCENTERED corner tetrahedron, object-space
// vertices EXACTLY (0,0,0), (s,0,0), (0,s,0), (0,0,s) — NOT recentered on
// the mesh's own centroid the way `resolveGeometry`'s other shapes center on
// `center`. This is a binding contract, not a cosmetic choice
// (VOLUMETRIC-2.md §3): the Sierpinski recipe's uniform `phase: -1/2`
// selectors pick each axis's UPPER half of a `[0,1]`-aligned window, and
// that only lands in the right octants when the window's own corner sits AT
// the domain origin. A centered window (this shape's own bounding-box
// centroid at the origin, like every other stage here) would put the solid
// mass in the wrong octants — and a linear field has no origin-shift knob
// that could compensate; `originU/V/W` are ignored by linear fields
// entirely (see AGENTS.md's field-synth section). Presentation — framing,
// centering on screen, picking a flattering angle — is the CAMERA's job via
// the stage hint table below, never these vertices.
//
// Each face is wound CCW-from-outside (outward normal away from the solid's
// interior), matching every hand-authored geometry helper in
// `packages/core/src/helpers` (e.g. `tetrahedronPolygons`/`cubePolygons`).
function cornerTetraPolygons(s: number): Polys {
  const O: V3 = [0, 0, 0], A: V3 = [s, 0, 0], B: V3 = [0, s, 0], C: V3 = [0, 0, s];
  const faces: V3[][] = [
    [A, B, C], // opposite O
    [O, B, A], // opposite C (z=0 plane)
    [O, C, B], // opposite A (x=0 plane)
    [O, A, C], // opposite B (y=0 plane)
  ];
  return faces.map((vertices) => ({ vertices })) as unknown as Polys;
}

export function shapePolys(name: string): Polys {
  if (name === "plane") return flatQuad(3);
  if (name === "pyramid") return withFaceUvs(cornerTetraPolygons(PYRAMID_STAGE_SIZE));
  return withFaceUvs(resolveGeometry(name as GlyphGeometryName, { size: 3 }));
}
export const isFlat = (name: string) => name === "plane";

// A field-synth patch's output depends on `time` ONLY through each active
// voice's own `speed` (see fieldProgram.ts's `synthWave`/SDF-oracle `c =
// phase - speed*time` derivation — no other param reads raw time). So a
// patch where every voice with `amp > 0` also has `speed === 0` renders the
// SAME output at every `time` value: driving `time` forward for such a
// patch buys nothing and only pays for a wasted effect recompute every
// frame (perf packet: a static SDF/carve patch with every `speedN` left at
// its schema default of `0` is exactly this case). Layers have no
// time-varying knob of their own, so checking every voice slot regardless
// of layer assignment is sufficient.
export function isTimeInvariantPatch(params: Params): boolean {
  for (let k = 1; k <= MAX_VOICES; k++) {
    if (Number(params[`amp${k}`] ?? 0) > 0 && Number(params[`speed${k}`] ?? 0) !== 0) return false;
  }
  return true;
}

// A preset's `STAGE_HINTS.loopSeconds` (for a one-way animation arc, like a
// `wave: "step"` SDF voice's erosion) wraps the monotonically-accumulated
// tick clock back into a repeating cycle instead of letting the driven
// `time` grow forever — see `SynthStageHint.loopSeconds`'s own doc.
// `((t % p) + p) % p`, not a bare
// `t % p`: JS `%` is remainder (sign-preserving), not mathematical modulo,
// so a bare `t % p` would return a negative value for negative `t` — `t`
// only grows in practice (the tick loop's own accumulator), but this stays
// correct regardless. `loopSeconds` absent/undefined/non-positive is a
// no-op (today's plain monotonic `time`, byte-identical).
export function wrapDrivenTime(t: number, loopSeconds: number | null | undefined): number {
  if (!loopSeconds || loopSeconds <= 0) return t;
  return ((t % loopSeconds) + loopSeconds) % loopSeconds;
}

/**
 * SynthWorkbench's per-frame tick has two independent jobs: advance/push the
 * field-synth `time` param (mesh spin — gated by `paused`/`timeScale` and,
 * since `isTimeInvariantPatch` above, by whether the current patch actually
 * reads time), and step the camera auto-orbit (gated by `orbitAuto`, a flat
 * stage having no orbit, and an in-progress drag). These two must stay
 * decidable independently: orbiting rotates the CAMERA, which forces
 * `scene.rerender()` to re-rasterize and re-evaluate the effect regardless of
 * `time`, so a time-invariant patch (e.g. the shipped "Sierpinski pyramid"
 * preset, every `speedN: 0`) still needs to visibly orbit even though its own `time`
 * advance is skipped for perf. Folding both branches under one shared guard
 * — e.g. nesting the orbit step inside the `!isTimeInvariantPatch` check —
 * would silently freeze auto-orbit for every time-invariant preset. Kept as
 * one pure function (not two inline `if`s in the tick loop) specifically so
 * that coupling is a change to THIS function's shape, not something a future
 * tick-loop edit can reintroduce unnoticed; `SynthWorkbench.tsx`'s tick calls
 * this once per frame and reads both fields off the single returned plan.
 */
export function computeSynthTickPlan(input: {
  paused: boolean;
  timeScale: number;
  params: Params;
  flat: boolean;
  orbitAuto: boolean;
  orbitDragging: boolean;
}): { advanceTime: boolean; orbit: boolean } {
  return {
    advanceTime: !input.paused && input.timeScale !== 0 && !isTimeInvariantPatch(input.params),
    orbit: !input.flat && input.orbitAuto && !input.orbitDragging,
  };
}

// Duplicates `createGlyphScene.ts`'s `applyTransform` rotation math exactly
// (Rz first on the point, then Ry, then Rx — matrix product Rx*Ry*Rz) so the
// bbox math below previews the SAME rotated shape the renderer will actually
// produce. There is no exported rotate-only utility to reuse; this is
// deliberately kept in lockstep with that function's composition order, not
// a generic decomposition assumption.
function rotateOnly([vx, vy, vz]: V3, [rxDeg, ryDeg, rzDeg]: V3): V3 {
  const DEG2RAD = Math.PI / 180;
  const rx = rxDeg * DEG2RAD, ry = ryDeg * DEG2RAD, rz = rzDeg * DEG2RAD;
  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const cosZ = Math.cos(rz), sinZ = Math.sin(rz);
  let x = vx, y = vy, z = vz;
  let nx = cosZ * x - sinZ * y;
  let ny = sinZ * x + cosZ * y;
  let nz = z;
  x = cosY * nx + sinY * nz;
  y = ny;
  z = -sinY * nx + cosY * nz;
  nx = x;
  ny = cosX * y - sinX * z;
  nz = sinX * y + cosX * z;
  return [nx, ny, nz];
}

// The corner tetra's O -> centroid(A,B,C) axis is the (1,1,1) direction — the
// classic Sierpinski look wants the OPPOSITE of that as "up": apex (O) above
// a base (face ABC) parallel to the ground, i.e. the direction FROM the base
// TOWARD the apex, centroid(ABC) -> O, mapped onto world +Z.
//
// +Z (not +Y) is the correct target, and this is a claim about the REAL
// runtime camera, not the unused `project()` in
// packages/core/src/math/projection.ts (that function is exported from
// `@glyphcss/core` but nothing in the render path — `createGlyphScene`,
// `compileScene`, `rasterize` — ever calls it; a prior version of this file
// cited its `row = rows*cy - v[1]*r*persp` formula as "glyphcss's native
// vertical axis", which does not describe what actually renders). The camera
// every mesh here is actually projected through is
// `createGlyphOrthographicCamera` (packages/glyphcss/src/api/
// createGlyphCamera.ts, vendored from voxcss): it axis-swaps world into a
// CSS-like frame, then applies `rotateZ(rotY)` (yaw) followed by
// `rotateX(rotX)` (pitch) — see `rotateVec3Voxcss` there. Under that
// composition, world Z is untouched by the yaw step (the Z-rotation only
// mixes world X/Y) and only gets foreshortened by pitch afterward, so its
// projected column is IDENTICALLY zero and its row is a clean
// `-sin(rotX)`/`cos(rotX)` split for every yaw angle — the one world axis
// whose screen reading never drifts sideways as the camera orbits. World Y
// has no such invariance (it mixes into both screen axes once rotY != 0),
// so aligning to it left the corner tetra's three base corners scattered
// above and below the apex under the page's actual default camera (rotX 58,
// rotY 32) instead of forming a clean base band beneath it — confirmed by
// projecting this shape's actual committed world vertices through the real
// `createGlyphOrthographicCamera` (not a hand-reproduced formula): two of
// the three base corners landed at a SMALLER row than the apex, i.e. above
// it on screen. This also matches `cubePolygons`' own `[4,5,6,7], // +Z
// (top)` face comment and AGENTS.md's "`+Z` = up, matching every native
// primitive's `+Z (top)` convention" (the fonts-package doc this appears
// in) — `+Y` was never the right target. `conePolygons`/`pyramidPolygons`
// happen to use Y as their own local height parameter, but that is an
// unrelated per-helper authoring choice that stays invisible for a
// rotationally symmetric shape (a cone's visible silhouette still reads
// "pointy end up" from most angles no matter which axis is nominally
// "up"); it only breaks visibly for an asymmetric 4-vertex shape like this
// one, where "upright" is a strict per-vertex ordering, not just a
// silhouette impression.
//
// That base->apex direction is -(1,1,1)/sqrt(3), regardless of the tetra's
// size `s` (a pure direction). Solved as the minimal (shortest-arc)
// axis-angle rotation from that source vector to +Z via Rodrigues' formula,
// then decomposed into the XYZ Euler triple `applyTransform` actually
// composes (R = Rx*Ry*Rz applied to the point): ry = asin(R02), rx =
// atan2(-R12, R22), rz = atan2(-R01, R00) — the standard closed-form
// extraction for this exact matrix layout, valid here since asin's
// principal branch keeps cos(ry) >= 0 (no gimbal-lock special case needed
// for this particular source/target pair). Numerically verified (see
// synthKit.test.ts): apex ends up above the base plane, the base is
// parallel to the ground, rebuilding R from the returned angles reproduces
// the same target vector, AND — the arbiter that actually matters —
// projecting the resulting world vertices through the real
// `createGlyphOrthographicCamera` at the page's default camera angle puts
// the apex at a strictly smaller row than all three base corners.
function alignCornerTetraApexEuler(): V3 {
  const source = vnorm([-1, -1, -1]);
  const target: V3 = [0, 0, 1];
  const axis = vcross(source, target);
  const axisLen = Math.hypot(axis[0], axis[1], axis[2]);
  const cosAngle = Math.min(1, Math.max(-1, vdot(source, target)));
  const angle = Math.acos(cosAngle);
  const [ux, uy, uz] = axisLen > 1e-12 ? vnorm(axis) : [1, 0, 0];
  const c = Math.cos(angle), s = Math.sin(angle), t = 1 - c;
  const r00 = t * ux * ux + c, r01 = t * ux * uy - s * uz, r02 = t * ux * uz + s * uy;
  const r12 = t * uy * uz - s * ux;
  const r22 = t * uz * uz + c;
  const RAD2DEG = 180 / Math.PI;
  const ry = Math.asin(Math.min(1, Math.max(-1, r02)));
  const rx = Math.atan2(-r12, r22);
  const rz = Math.atan2(-r01, r00);
  return [rx * RAD2DEG, ry * RAD2DEG, rz * RAD2DEG];
}
const CORNER_TETRA_APEX_EULER: V3 = alignCornerTetraApexEuler();

// The pyramid stage's corner tetra is deliberately UNCENTERED in object
// space (see `cornerTetraPolygons` above — a binding contract for the
// Sierpinski recipe's `[0,1]^3` window, not to be touched). Left alone it
// also renders lying on one of its right-angle faces, off-center, and
// spinning about an off-axis, off-center pivot — not the classic Sierpinski
// "apex up" look. Fixed entirely in WORLD space, via the mesh's transform
// (`createGlyphScene`'s `applyTransform` captures `objectVertices` BEFORE
// this transform is applied, so the field recipe never sees it): rotate by
// `CORNER_TETRA_APEX_EULER` so the apex sits above a ground-parallel base,
// then translate ONLY ALONG THAT SAME AXIS (world Z) to center the shape
// vertically.
//
// Two prior versions both translated OFF that axis and both wobbled under
// orbit:
//   - 529a09e centered the 4 rotated corners' 3D world-space AABB.
//   - 783fa79 centered the rotated shape's screen-PROJECTED silhouette
//     bbox, but only at ONE fixed camera pose (rotX 58, rotY 32) — exact at
//     that pose, confirmed via Playwright, but the solved translation has
//     nonzero world X/Y components (a tetrahedron's 4-vertex bbox isn't
//     centered on its own 3-fold symmetry axis).
//
// The corner tetra has a 3-fold symmetry axis running apex (O, always at
// local/world (0,0,0) — `rotateOnly` fixes the origin) through the base
// centroid; `alignCornerTetraApexEuler`'s rotation puts that axis exactly
// on world Z (the base corners A/B/C land 120° apart around it, same
// height — see `alignCornerTetraApexEuler`'s doc). `createGlyphOrthographicCamera`'s
// camera orbits around its `target`, which this stage never sets (default
// world origin) — so ANY translation off the object's own symmetry axis
// moves that axis off the camera's pivot, and the object's screen position
// then swings through a circle/ellipse as rotY (yaw, i.e. spin/orbit)
// varies — the live "eccentric rotation" bug. A translation ALONG the axis
// (pure world Z) leaves the axis exactly where it was (still the line
// x=0,y=0 through the pivot), so it is invariant to camera rotation: for
// ANY rotX/rotY, `rotateVec3Voxcss` sends a pure-Z world vector to a
// rotated vector whose first (CSS-Y/col) component is IDENTICALLY zero
// (rotateZ(rotY) leaves cz alone; rotateX(rotX) only ever mixes cy/cz, not
// cx) — verified in synthKit.test.ts. Centering along Z therefore holds
// simultaneously for every camera angle, not just the one it's solved at.
//
// `dz` is still solved against the real camera (not reproduced by hand) at
// the page's default pose, matching 783fa79's approach for the ONE degree
// of freedom that pose can determine (vertical placement) — the resulting
// row offset from a pure-Z translation is independent of rotY, so this
// single-pose solve is exact for every yaw, and only rotX (pitch) — which
// orbit ping-pongs within a bounded range, not through a full spin — moves
// the row bbox at all, and only by the shape's own bounded vertical extent.
function solveVerticalCenteringZ(rotatedCorners: V3[]): number {
  const camera = createGlyphOrthographicCamera({ rotX: STAGE_CAMERA_ROT_X, rotY: STAGE_CAMERA_ROT_Y, zoom: 1 });
  // Unit cell metrics, zero screen center: `project` then returns the raw
  // rotated vector [rx, ry, rz] with nothing else (grid size, cell size,
  // center) mixed in — exactly the camera's rotation matrix applied to `v`.
  const metrics = { cellWidth: 1, cellHeight: 1, centerCol: 0, centerRow: 0 };
  const projRaw = (v: V3): V3 => {
    const [c, r, d] = camera.project(v, 2, 2, 1, metrics);
    return [c, r, d ?? 0];
  };
  let minRow = Infinity, maxRow = -Infinity;
  for (const v of rotatedCorners) {
    const [, row] = projRaw(v);
    if (row < minRow) minRow = row; if (row > maxRow) maxRow = row;
  }
  const rowCenter = (minRow + maxRow) / 2;
  // A world-Z translation of `dz` shifts every corner's projected row by
  // `dz * projRaw([0,0,1])[1]` (linearity) and its col by exactly 0 (see
  // doc above) — solve for the `dz` that zeroes the row bbox center.
  const rowPerZ = projRaw([0, 0, 1])[1];
  return -rowCenter / rowPerZ;
}

const PYRAMID_STAGE_ROTATED_CORNERS: V3[] = (() => {
  const s = PYRAMID_STAGE_SIZE;
  return ([[0, 0, 0], [s, 0, 0], [0, s, 0], [0, 0, s]] as V3[]).map((v) => rotateOnly(v, CORNER_TETRA_APEX_EULER));
})();
const PYRAMID_STAGE_POSITION: V3 = [0, 0, solveVerticalCenteringZ(PYRAMID_STAGE_ROTATED_CORNERS)];

export function shapeTransform(name: string): GlyphMeshTransform {
  if (name === "pyramid") return { rotation: CORNER_TETRA_APEX_EULER, position: PYRAMID_STAGE_POSITION };
  return {};
}

// Applies a `GlyphMeshTransform` to one point exactly like `createGlyphScene`'s
// (unexported) `applyTransform`: scale, then rotate Rz->Ry->Rx (`rotateOnly`
// above), then translate. `frameObject` needs this so its projected bbox
// matches what actually renders for a mesh with a non-identity transform
// (e.g. the pyramid stage) — projecting the mesh's own untransformed local
// vertices there measures the WRONG silhouette (wrong size, and for a
// shape whose transform includes rotation, a differently-shaped one too).
function applyMeshTransformPoint(v: V3, transform: GlyphMeshTransform): V3 {
  const [sx, sy, sz] = transform.scale === undefined ? [1, 1, 1]
    : typeof transform.scale === "number" ? [transform.scale, transform.scale, transform.scale]
    : transform.scale;
  const rotated = transform.rotation ? rotateOnly([v[0] * sx, v[1] * sy, v[2] * sz], transform.rotation as V3) : [v[0] * sx, v[1] * sy, v[2] * sz];
  const [px, py, pz] = (transform.position as V3 | undefined) ?? [0, 0, 0];
  return [rotated[0] + px, rotated[1] + py, rotated[2] + pz];
}

// Frame the object by setting the camera zoom so its projected bbox fills ~`fill`
// of the grid. MUST project with the same MEASURED cell metrics the renderer uses
// (`metrics`), else the default cell (BASE_TILE/cellAspect) is ~4× off and the zoom
// massively overshoots. Call after a render so the <pre> reflects the real cell.
// `transform`: the SAME `GlyphMeshTransform` passed to `scene.add()` for these
// `polys` — required so the projected bbox measures the actually-rendered
// (world-space) mesh, not its untransformed local geometry (see
// `applyMeshTransformPoint`'s doc; every non-pyramid stage has an identity
// transform today, so this is a no-op for them).
// `cover`: fit the SMALLER axis exactly at `fill` and overscan the larger one
// (like CSS `background-size: cover`) instead of the default `contain` behaviour
// (fit the LARGER axis, margin on the smaller one). Used for the fullscreen plane
// so its texture reaches every edge of a non-square viewport instead of framing
// with letterbox bars.
export function frameObject(scene: GlyphSceneHandle, camera: { zoom: number; project: (v: [number, number, number], c: number, r: number, a: number, m?: unknown) => number[] }, polys: Polys, fill = 0.72, cover = false, transform: GlyphMeshTransform = {}): void {
  const o = scene.getOptions();
  const pre = scene.host.querySelector("pre.glyph-output") as HTMLElement | null;
  let metrics: { cellWidth: number; cellHeight: number } | undefined;
  if (pre) {
    const r = pre.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) metrics = { cellWidth: r.width / o.cols, cellHeight: r.height / o.rows };
  }
  camera.zoom = 1;
  let minc = Infinity, maxc = -Infinity, minr = Infinity, maxr = -Infinity;
  for (const p of polys) for (const rawV of p.vertices) {
    const v = applyMeshTransformPoint(rawV as V3, transform);
    const pr = camera.project(v, o.cols, o.rows, o.cellAspect, metrics);
    if (!isFinite(pr[0]!) || !isFinite(pr[1]!)) continue;
    if (pr[0]! < minc) minc = pr[0]!; if (pr[0]! > maxc) maxc = pr[0]!;
    if (pr[1]! < minr) minr = pr[1]!; if (pr[1]! > maxr) maxr = pr[1]!;
  }
  const w = maxc - minc, h = maxr - minr;
  if (w > 0 && h > 0) {
    const zc = (fill * o.cols) / w, zr = (fill * o.rows) / h;
    camera.zoom = cover ? Math.max(zc, zr) : Math.min(zc, zr);
  }
}

// Isolate one voice into osc-1 (amp 1) so a card can preview its solo contribution.
// Colored through the SAME path the real render uses: when per-voice colors is
// ON, osc-1 carries the voice's own `color{slot}` and `voiceColors: true`, so
// `fieldSynth`'s evaluate() resolves the preview's color from that single active
// voice (matching the trendline, which already reads `color{slot}`) — no CSS
// override needed. When OFF, it falls back to the main `color`/`colorB`/`gradient`,
// same as the rest of the scene.
export function soloParams(params: Params, slot: number): Params {
  const base = synthDefaults();
  for (let k = 1; k <= MAX_VOICES; k++) base[`amp${k}`] = 0;
  base.field1 = params[`field${slot}`]; base.wave1 = params[`wave${slot}`];
  base.angle1 = params[`angle${slot}`]; base.originU1 = params[`originU${slot}`]; base.originV1 = params[`originV${slot}`];
  base.originW1 = params[`originW${slot}`];
  base.duty1 = params[`duty${slot}`]; base.phase1 = params[`phase${slot}`];
  base.freq1 = params[`freq${slot}`]; base.speed1 = params[`speed${slot}`]; base.amp1 = 1;
  // The menger/sierpinski recursion depth is per-voice (`iter${slot}`), not
  // covered by any of the field/wave/freq copies above — omitted, a solo
  // preview always showed the schema default (3) regardless of the voice's
  // own `iter` knob.
  base.iter1 = params[`iter${slot}`];
  // The solo voice always lands on layer 1 (a solo preview is always a
  // single active voice, and layer 1 is the only populated layer) — but its
  // SOURCE layer's shaping must come along, or a thresholded/inverted layer
  // previews as if it were the flat, unshaped default (repro: a voice on
  // `layer2: 3` with threshold+invert solos as `layer1: 1` with none of that
  // shaping active, discarding it entirely). Copying the source layer's
  // combine/threshold/invert/blend/amp onto layer 1's own shaping slot
  // reproduces exactly how that voice folds in the real patch.
  base.layer1 = 1;
  const sourceLayer = Math.round(Number(params[`layer${slot}`] ?? 1));
  base.layerCombine1 = params[`layerCombine${sourceLayer}`] ?? base.layerCombine1;
  base.layerThresholdOn1 = params[`layerThresholdOn${sourceLayer}`] ?? base.layerThresholdOn1;
  base.layerThreshold1 = params[`layerThreshold${sourceLayer}`] ?? base.layerThreshold1;
  base.layerInvert1 = params[`layerInvert${sourceLayer}`] ?? base.layerInvert1;
  base.layerBlend1 = params[`layerBlend${sourceLayer}`] ?? base.layerBlend1;
  base.layerAmp1 = params[`layerAmp${sourceLayer}`] ?? base.layerAmp1;
  base.space = params.space; base.scale = params.scale; base.glyphs = params.glyphs;
  base.voiceColors = params.voiceColors === true;
  base.color1 = params[`color${slot}`];
  base.color = params.color; base.colorB = params.colorB; base.gradient = params.gradient;
  base.gain = 1; base.bias = 0.5;
  return base;
}

// Fixed representative time for a STATIC (non-animating) preview — picked
// well inside the range the old always-on loop already passed through every
// couple of seconds (`t += dt * 0.8`), so it's not an exotic value, just a
// frozen point on the same trajectory. Nonzero so a `speed: 0`-agnostic wave
// (sin/triangle/saw/square all read `raw - t*speed + phase`) doesn't preview
// at its own degenerate `t = 0` frame, which for several wave/phase
// combinations is a flat or symmetric-looking snapshot that hides the
// pattern's actual character.
const PREVIEW_STATIC_TIME = 1.2;

// Small live preview. Head-on on a FLAT square by default (a plain 2D read of
// the field). `previewShape !== "plane"` (a voice/preset's `space ===
// "object"`) swaps that for a small tilted `shapePolys(previewShape)` mesh
// instead — a flat quad has zero depth, so entry and exit coincide
// everywhere and a volumetric/carve patch would preview as a degenerate
// point-sample rather than the 3D structure it actually renders (see
// AGENTS.md's "Note preset gallery previews" precedent). `previewShape`
// defaults to "cube" was the old hardcoded behavior; callers that care which
// volumetric mesh actually reads (the live stage shape, or a preset's own
// stage hint — VOLUMETRIC-2.md §3, "a pyramid-stage voice preview would
// lie") now pass it explicitly. `onTick` (if given) fires every frame
// alongside the layer's own time update, with the SAME `t` — so a waveform
// trendline drawn from it stays exactly in sync with what the adjacent
// preview square renders, using this loop instead of a second one. Defaults
// to "plane" (flat, non-volumetric) — the same default the old `volumetric =
// false` parameter had — so an omitted 5th argument still previews flat.
//
// `animate` (default `true`, preserving every existing call's behavior
// unchanged) gates the continuous rAF loop: with dozens of voice-card/preset
// previews mountable at once, each running its own `createGlyphScene` render
// loop wrecks page performance (glyphcss's own gallery of loaders + a full
// voice sidebar can easily reach 20+ concurrently mounted previews). Callers
// that want hover-to-animate (see `VoiceCard`'s `hoverToAnimate` prop and
// `PresetTile` below) drive this from local pointer-enter/leave state; a
// `false` value renders exactly ONE frame at `PREVIEW_STATIC_TIME` and stops
// the loop — no requestAnimationFrame runs until `animate` flips back to
// `true`, at which point the loop resumes counting up from that same fixed
// point (not from wherever a previous hover session left off), so a
// non-animating preview always looks identical, deterministic across
// mounts/hovers. `onTick` still fires once per static (re-)render, so a
// dependent trendline (VoiceCard's own waveform SVG) stays in sync with
// param edits made while NOT hovering, instead of going stale until the next
// hover starts.
export function useSynthPreview(host: HTMLElement | null, getParams: () => Params, deps: unknown[], onTick?: (t: number) => void, previewShape = "plane", animate = true): void {
  const layerRef = useRef<{ setParams: (p: Params) => void; dispose: () => void } | null>(null);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const animateRef = useRef(animate);
  animateRef.current = animate;
  const volumetric = previewShape !== "plane";
  // Imperative start/stop/freeze for the CURRENT scene's rAF loop — a ref
  // (not state) because toggling it must not itself trigger a re-render or
  // recreate the scene. Set by the mount effect below; read by both the
  // deps-effect (static-mode re-renders on param change) and the
  // `animate`-effect (hover start/stop) that follow it.
  const loopRef = useRef<{ start: () => void; stop: () => void; renderStatic: () => void } | null>(null);

  useEffect(() => {
    if (!host) return;
    injectGlyphBaseStyles(host.ownerDocument ?? undefined);
    const camera = createGlyphOrthographicCamera(volumetric ? { rotX: 58, rotY: 32, zoom: 16 } : { rotX: 0, rotY: 0, zoom: 20 });
    const scene = createGlyphScene(host, { camera, autoSize: true, mode: "solid", useColors: true, glyphPalette: "default", doubleSided: !volumetric, directionalLight: LIGHT, ambientLight: AMBIENT });
    host.style.fontSize = "6px";
    const polys = volumetric ? shapePolys(previewShape) : flatQuad(3);
    const meshTransform = volumetric ? shapeTransform(previewShape) : {};
    scene.add(polys, meshTransform); scene.fit(); scene.rerender();
    frameObject(scene, camera, polys, volumetric ? 0.8 : 0.98, false, meshTransform);
    const layer = scene.addEffectLayer({ effect: fieldSynth, params: getParams(), blend: SYNTH_EFFECT_BLEND, target: "surfaces" });
    layerRef.current = layer as unknown as { setParams: (p: Params) => void; dispose: () => void };
    scene.rerender();
    let last = performance.now(), t = PREVIEW_STATIC_TIME, raf = 0;
    const tick = (now: number): void => { raf = requestAnimationFrame(tick); const dt = Math.min((now - last) / 1000, 0.1); last = now; t += dt * 0.8; layerRef.current?.setParams({ time: t }); onTickRef.current?.(t); };
    const start = (): void => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const stop = (): void => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const renderStatic = (): void => {
      stop(); // freezing means the loop must actually stop, not just repaint once
      t = PREVIEW_STATIC_TIME;
      layerRef.current?.setParams({ time: t });
      onTickRef.current?.(t);
    };
    loopRef.current = { start, stop, renderStatic };
    // Establishes the initial frame itself (rather than deferring entirely to
    // the `animate`-effect below) so a scene remount — a shape/stage change,
    // which re-runs THIS effect but not necessarily the `animate`-effect,
    // since `animate`'s own value may not have changed — still lands on the
    // right frame instead of the schema's own degenerate `t = 0` default.
    // The `animate`-effect fires too (same commit, same initial mount, or on
    // every later toggle) and may redundantly repeat this exact call; that's
    // a harmless one-time extra `onTick` at rest, never a second running loop.
    if (animateRef.current) start(); else renderStatic();
    // `layerRef.current = null` here (not just `loopRef.current`) matters:
    // this cleanup and the deps-effect below run in DECLARATION order on the
    // SAME commit whenever `host` changes (React runs each effect's
    // cleanup-then-body before moving to the next). A caller whose own
    // `host` can go from a real element back to null while the component
    // STAYS MOUNTED — `ColorVoiceCard`'s "no preview" state for a
    // normal-derived field (VOLUMETRIC-4.md §1), toggled by conditionally
    // rendering the `ref={setHost}` span — hits exactly that: this cleanup
    // disposes `layer`, then the deps-effect's `layerRef.current?.setParams`
    // ran against the STALE (now-disposed) reference and threw "glyphcss:
    // effect layer is disposed" (found live via the Playwright smoke pass).
    // Every existing caller (`VoiceCard`, `PresetTile`) never re-triggers
    // this effect without also fully unmounting, so it never observed this.
    return () => { stop(); loopRef.current = null; layerRef.current = null; layer.dispose(); scene.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host, volumetric, previewShape]);
  useEffect(() => {
    layerRef.current?.setParams(getParams());
    // Not animating: the rAF loop that would otherwise pick up these new
    // params on its next frame isn't running, so re-render the static frame
    // explicitly (and re-fire `onTick`, keeping a dependent trendline SVG in
    // sync with the edit) instead of going stale until the next hover.
    if (!animateRef.current) loopRef.current?.renderStatic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    if (animate) loopRef.current?.start(); else loopRef.current?.renderStatic();
  }, [animate]);
}

// Drives a per-voice waveform trendline SVG on its own rAF clock, with no
// mounted glyphcss scene at all — a managed `VoiceCard` (the /synth sidebar,
// crowding fix) drops its live mini-preview square entirely, but the
// trendline is a pure function of `t` + the voice's own wave params
// (`buildWavePathD`), so it never needed a scene to animate. Same
// tick/start/stop/renderStatic shape as `useSynthPreview` above (so the
// static-until-hovered convention every card preview in this file follows
// stays identical), just without the `host`/scene half of that hook.
// `enabled` gates the whole hook off (a no-op) for a caller passing an
// unmanaged card (`mode` omitted) that still gets its ticks from a real
// mounted `useSynthPreview` scene instead — the two are mutually exclusive
// per card, never both driving the same `onTick`.
function useTrendlineClock(onTick: (t: number) => void, deps: unknown[], animate: boolean, enabled: boolean): void {
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const animateRef = useRef(animate);
  animateRef.current = animate;
  const loopRef = useRef<{ start: () => void; stop: () => void; renderStatic: () => void } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let last = performance.now(), t = PREVIEW_STATIC_TIME, raf = 0;
    const tick = (now: number): void => { raf = requestAnimationFrame(tick); const dt = Math.min((now - last) / 1000, 0.1); last = now; t += dt * 0.8; onTickRef.current(t); };
    const start = (): void => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const stop = (): void => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
    const renderStatic = (): void => {
      stop();
      t = PREVIEW_STATIC_TIME;
      onTickRef.current(t);
    };
    loopRef.current = { start, stop, renderStatic };
    if (animateRef.current) start(); else renderStatic();
    return () => { stop(); loopRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
  useEffect(() => {
    if (!enabled) return;
    if (!animateRef.current) loopRef.current?.renderStatic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
  useEffect(() => {
    if (!enabled) return;
    if (animate) loopRef.current?.start(); else loopRef.current?.renderStatic();
  }, [animate, enabled]);
}

// ── Waveform trendlines (per-voice + combined) ────────────────────────────────
// Read the voice params as a literal 1D read of the same shape+phase math the
// field synth evaluates spatially: `raw*freq - time*speed` fed through
// `synthWave`, with `raw` swept 0..1 across the plot (a "linearX"-style read —
// `field` itself only has meaning in 2D, so it isn't part of this projection).
export const WAVE_SAMPLES = 72;

// `step` (VOLUMETRIC-2.md §2) is non-periodic: its argument sweep must not
// scale with `freq` the way every periodic wave's does (`raw * freq`, which
// shows exactly `freq` cycles across the plot). A `0..1` sweep puts the
// argument's zero crossing — the only place a non-periodic wave's edge is
// visible at all — at `raw = -(-time*speed+phase)/freq`, which sits AT or
// OUTSIDE the window's edge for every default (time 0, phase 0, freq > 0:
// crossing at raw 0 exactly), previewing as a constant line rather than a
// step. A symmetric window centered on 0 keeps the crossing near the middle
// of the plot for the common case instead.
function isNonPeriodicWave(wave: string): boolean {
  return wave === "step";
}

export function buildWavePathD(wave: string, freq: number, speed: number, amp: number, time: number, width: number, height: number, duty = 0.5, phase = 0): string {
  const midY = height / 2;
  const halfH = midY - 2;
  const nonPeriodic = isNonPeriodicWave(wave);
  let d = "";
  for (let i = 0; i < WAVE_SAMPLES; i++) {
    const t = i / (WAVE_SAMPLES - 1); // 0..1, always the ON-SCREEN sweep fraction
    const raw = nonPeriodic ? t - 0.5 : t; // symmetric -0.5..0.5 window for non-periodic waves
    const value = amp * synthWave(wave, raw * freq - time * speed + phase, duty);
    const x = t * width;
    const y = midY - value * halfH;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d;
}

export interface CombinedVoice {
  readonly wave: string; readonly freq: number; readonly speed: number; readonly amp: number;
  /** Default 0.5/0 — byte-identical to a voice that never set them. */
  readonly duty?: number; readonly phase?: number;
}

// Folds active voices exactly like `fieldSynth`'s evaluate loop: each oscillator
// samples at amp=1 (`synthOsc`'s own amp is fixed to 1 there), the first active
// voice enters at its mix weight, and every later voice blends the running result
// toward `combineSynth(mode, result, voice)` by its weight — so two close
// frequencies visibly beat instead of just averaging out.
export function buildCombinedPathD(voices: readonly CombinedVoice[], combineMode: string, time: number, width: number, height: number): string {
  const midY = height / 2;
  const halfH = midY - 3;
  const range = 1.5; // headroom past ±1 for `add`/`difference` without clipping the common multiply/max/min case
  let d = "";
  for (let i = 0; i < WAVE_SAMPLES; i++) {
    const raw = i / (WAVE_SAMPLES - 1);
    let combined = 0;
    let active = 0;
    for (const voice of voices) {
      const o = synthWave(voice.wave, raw * voice.freq - time * voice.speed + (voice.phase ?? 0), voice.duty ?? 0.5);
      if (active === 0) combined = voice.amp * o;
      else combined += voice.amp * (combineSynth(combineMode, combined, o) - combined);
      active++;
    }
    const clamped = Math.max(-range, Math.min(range, combined));
    const x = raw * width;
    const y = midY - (clamped / range) * halfH;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d;
}

// Combined-waveform oscilloscope, portaled into the right Dock's MIX folder
// (above Combine — see `useDockSlot(mix, { position: "top" })` in `SynthDock`):
// each active voice's raw wave faint in its own color, the real mixed result
// bold on top — the fastest way to SEE interference (two close frequencies
// drifting in and out of phase = a visible beating envelope). One shared rAF
// loop for the whole strip (not one per voice), driven by the SAME
// paused/time-scale refs that drive the actual mounted scene, so it tracks
// what's on screen rather than free-running on its own clock.
export function SynthScope({ paramsRef, tsRef, pausedRef }: {
  paramsRef: { current: Params }; tsRef: { current: number }; pausedRef: { current: boolean };
}) {
  const voicePathRefs = useRef<(SVGPathElement | null)[]>(Array.from({ length: MAX_VOICES }, () => null));
  const mixPathRef = useRef<SVGPathElement | null>(null);
  const width = 200, height = 56;
  useEffect(() => {
    let raf = 0, last = performance.now(), t = 0;
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick);
      if (!pausedRef.current) t += Math.min((now - last) / 1000, 0.1) * tsRef.current;
      last = now;
      const p = paramsRef.current;
      const combineMode = String(p.combine ?? "multiply");
      const active: CombinedVoice[] = [];
      for (let k = 0; k < MAX_VOICES; k++) {
        const slot = k + 1;
        const amp = Number(p[`amp${slot}`] ?? 0);
        const path = voicePathRefs.current[k];
        if (!(amp > 0)) { path?.setAttribute("d", ""); continue; }
        const voice: CombinedVoice = {
          wave: String(p[`wave${slot}`]), freq: Number(p[`freq${slot}`]), speed: Number(p[`speed${slot}`]), amp,
          duty: Number(p[`duty${slot}`] ?? 0.5), phase: Number(p[`phase${slot}`] ?? 0),
        };
        active.push(voice);
        if (path) {
          path.setAttribute("d", buildWavePathD(voice.wave, voice.freq, voice.speed, voice.amp, t, width, height, voice.duty, voice.phase));
          path.style.stroke = String(p[`color${slot}`] ?? "#7df9ff");
        }
      }
      mixPathRef.current?.setAttribute("d", active.length > 0 ? buildCombinedPathD(active, combineMode, t, width, height) : "");
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paramsRef, tsRef, pausedRef]);
  return (
    <div className="dock-scope" aria-hidden="true">
      <span className="dock-scope-label">Scope</span>
      <svg className="dock-scope-plot" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} className="dock-scope-mid" />
        {Array.from({ length: MAX_VOICES }, (_, k) => (
          <path key={k} ref={(el) => { voicePathRefs.current[k] = el; }} className="dock-scope-voice" vectorEffect="non-scaling-stroke" fill="none" />
        ))}
        <path ref={mixPathRef} className="dock-scope-mix" vectorEffect="non-scaling-stroke" fill="none" />
      </svg>
    </div>
  );
}

// ── Voice card (left rail) ────────────────────────────────────────────────────
/**
 * Frequency taper. `freq` is linear 0..24 in the schema, but every authored
 * preset in this repo lives between 0.5 and 14 and the loaders never exceed 6.7
 * — on a linear dial the whole useful range is squeezed into the bottom third
 * while half the travel is spent above 12. A cubic taper spends travel by RATIO
 * instead of by unit, so 0..1 gets ~35% of the dial and 0..10 gets ~75%, and
 * unlike a true log it represents 0 exactly (log(0) is undefined and `freq: 0`
 * is a legal, meaningful value — a voice with no spatial variation).
 */
const FREQ_TAPER = 3;
/** Read from the schema rather than repeated here: the dial and the parameter
 *  must agree, and a hardcoded copy silently clamps the control the moment the
 *  effect's range changes. */
export const FREQ_MAX = Number(
  (fieldSynth.parameterSchema as unknown as Record<string, { max?: number }>).freq1?.max ?? 24,
);
/** A colour voice's own `cfreqN` runs 0..96 (packages/effects/src/stock.ts) —
 *  4x the geometry `freqN` ceiling, so it needs its own schema-read max
 *  rather than sharing `FREQ_MAX`; `freqFromSlider`/`freqToSlider` below
 *  already take `max` as a parameter, so the SAME taper functions serve both. */
export const CFREQ_MAX = Number(
  (fieldSynth.parameterSchema as unknown as Record<string, { max?: number }>).cfreq1?.max ?? 96,
);
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
/** Per-voice layer assignment (VOLUMETRIC.md's Step 3) — a compact numbered
 *  segmented control, reusing `IconToggle`'s markup with a text label instead
 *  of a shape icon (a layer has no natural glyph the way a field/wave does). */
export const LAYER_TOGGLE = Array.from({ length: MAX_LAYERS }, (_, i) => {
  const n = i + 1;
  return { value: String(n), icon: <span className="gx-toggle-text">{n}</span>, label: `Layer ${n}`, desc: `assigns this voice to layer ${n} — voices on the same layer fold together before layers combine` };
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
  desc: v === "basic"
    ? "wave, field, freq, speed, and any conditional params (duty, iter) — the compact view"
    : "basic plus mix, phase, layer assignment, and placement (angle/origin)",
}));
export const freqFromSlider = (pos: number, max: number): number => {
  const v = max * Math.pow(Math.min(1, Math.max(0, pos)), FREQ_TAPER);
  // Finer quantization down low, where the taper hands you the resolution: a
  // flat 0.1 step would throw that resolution away exactly where it was bought.
  return v < 2 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10;
};
export const freqToSlider = (value: number, max: number): number =>
  Math.pow(Math.min(1, Math.max(0, value / max)), 1 / FREQ_TAPER);


/**
 * A dock row whose slider is LOGARITHMIC — equal travel per doubling.
 *
 * Used for `scale`, a pure multiplier: on a linear 0.1..12 dial every authored
 * value in this repo sits below 3, so three quarters of the travel does nothing
 * while the interesting octaves are crushed into the first quarter. A true log
 * works here (unlike the voice `freq` dial, which needs a power taper because it
 * must reach exactly 0).
 *
 * It renders through a dock SLOT because lil-gui's slider is linear over
 * [min,max] and displays the raw proxy value — driving that controller in
 * position space would show 0..1 instead of the real number. To stay visually
 * identical to every other dock row it reproduces lil-gui's own row markup
 * (`.controller.number.hasSlider > .name + .widget > .slider > .fill`, plus the
 * text input), so the dock's stylesheet dresses it exactly like a native row.
 */
export function LogSliderRow({ label, title, value, min, max, onChange }: {
  label: string;
  title: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  const span = Math.log(max / min);
  const clamp = (v: number): number => Math.min(max, Math.max(min, v));
  const toPos = (v: number): number => Math.log(clamp(v) / min) / span;
  const toValue = (pos: number): number => {
    const v = min * Math.exp(Math.min(1, Math.max(0, pos)) * span);
    // Finer quantization down low, where the log hands you the resolution.
    return v < 1 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10;
  };
  const track = useRef<HTMLDivElement | null>(null);
  const [text, setText] = useState<string | null>(null);

  const setFromPointer = useCallback((clientX: number) => {
    const el = track.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    onChange(toValue((clientX - r.left) / r.width));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChange, min, max]);

  return (
    <div className="controller number hasSlider" title={title}>
      <div className="name">{label}</div>
      <div className="widget">
        <div
          className="slider"
          ref={track}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            setFromPointer(e.clientX);
          }}
          onPointerMove={(e) => { if (e.buttons === 1) setFromPointer(e.clientX); }}
        >
          <div className="fill" style={{ width: `${toPos(value) * 100}%` }} />
        </div>
        <input
          type="text"
          value={text ?? (value < 1 ? value.toFixed(2) : value.toFixed(1))}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (text !== null) {
              const parsed = Number.parseFloat(text);
              if (Number.isFinite(parsed)) onChange(clamp(parsed));
              setText(null);
            }
          }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        />
      </div>
    </div>
  );
}

// ── Editable slider readout ───────────────────────────────────────────────
/**
 * The `<b>` value column beside every `.voice-slider` track, made
 * type-to-set — the ONE place this renders, shared by every geometry-voice,
 * colour-voice, palette, and layer-group row that uses `.voice-slider`'s
 * shape (call sites just swap in this component for their old `<b>…</b>`).
 * Several values here are effectively unreachable by dragging: the shipped
 * Menger recipe depends on `duty: 0.333`/`phase: -0.333`, and `freq` runs
 * through a TAPERED dial (`freqToSlider`/`freqFromSlider` above), so slider
 * position isn't linear in the value at all.
 *
 * `input[type="text"]`, not `type="number"` — spinners fight this page's
 * aesthetic and native `number` brings step/locale quirks; the Dock's own
 * `LogSliderRow` text input above already set this precedent on this page.
 *
 * `value`/`min`/`max` are always the REAL param value/range. For the
 * tapered freq row that means `[0, FREQ_MAX]` (or `CFREQ_MAX`), never the
 * `[0, 1]` slider-POSITION range the `<input type="range">` itself uses —
 * a typed number commits straight to the real param via `onCommit`,
 * bypassing `freqToSlider`/`freqFromSlider` entirely (those only shape
 * where the DRAG handle sits; the range `<input>`'s own `value=` already
 * re-derives its position from the real param on every render, so typing
 * a new real value moves the handle for free).
 *
 * Local `draft` state holds the in-progress text only while focused — the
 * live param can be animating underneath (e.g. a nonzero `speed`), and
 * rendering `value={draft ?? format(value)}` means the field only ever
 * reads the live prop while UNfocused, so a re-render mid-typing can't
 * clobber keystrokes. Enter or blur commits (clamped to `[min, max]`,
 * rounded when `integer`); an unparseable or empty entry reverts instead of
 * committing `NaN`. Escape reverts too, via a synchronous ref flag: calling
 * `.blur()` from the keydown handler fires the blur handler SYNCHRONOUSLY,
 * before React has applied any `setDraft` from this same handler, so a
 * plain state flag can't distinguish "cancel" from "commit" inside that one
 * shared blur handler — a ref can, since ref writes are immediate.
 */
export function EditableReadout({ value, min, max, format, onCommit, integer = false, disabled = false }: {
  value: number;
  min: number;
  max: number;
  /** Formats the live value for display while unfocused — keep each call
   *  site's existing precision/units (e.g. angle's trailing `°`). */
  format: (v: number) => string;
  onCommit: (next: number) => void;
  /** Rounds a committed value to the nearest integer (e.g. `iter`). */
  integer?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelledRef = useRef(false);
  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(max, Math.max(min, parsed));
      onCommit(integer ? Math.round(clamped) : clamped);
    }
    setDraft(null);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      className="voice-slider-readout"
      disabled={disabled}
      value={draft ?? format(value)}
      onFocus={() => setDraft(format(value))}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (cancelledRef.current) { cancelledRef.current = false; setDraft(null); return; }
        commit(draft ?? format(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          cancelledRef.current = true;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

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
const angleApplies = (field: string): boolean =>
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

export function VoiceFieldMap({ params, slot, keyPrefix = "", fallbackColor = "#7df9ff" }: {
  params: Params; slot: number;
  /** `"c"` for a colour voice (`cfield${slot}`/`corigin…${slot}`/…) — see
   *  `ColorVoiceCard` below. Defaults to `""` (geometry voice keys), every
   *  existing caller's behavior unchanged. */
  keyPrefix?: string;
  /** Colour voices have no per-voice `color${slot}` param of their own (the
   *  combined colour comes from `colorMode`, not an individual swatch) — this
   *  is the mark colour to fall back to when `${keyPrefix}color${slot}`
   *  doesn't exist in `params`. Unused by the default geometry-voice call
   *  (`color${slot}` always exists there). */
  fallbackColor?: string;
}) {
  const size = 100;
  const marks: ReactNode[] = [];
  {
    const field = String(params[`${keyPrefix}field${slot}`]);
    const color = String(params[`${keyPrefix}color${slot}`] ?? fallbackColor);
    const ox = (0.5 + Number(params[`${keyPrefix}originU${slot}`] ?? 0)) * size;
    const oy = (0.5 + Number(params[`${keyPrefix}originV${slot}`] ?? 0)) * size;
    const deg = Number(params[`${keyPrefix}angle${slot}`] ?? 0) + (VOICE_FIELD_MAP_BASE_ANGLE[field] ?? 0);
    const rad = (deg * Math.PI) / 180;
    const dx = Math.cos(rad), dy = Math.sin(rad);
    const key = `v${slot}`;
    const kind = voiceFieldMapKind(field);
    if (kind === "linear") {
      const L = 30;
      marks.push(
        <g key={key} stroke={color} fill={color}>
          <line x1={ox - dx * L} y1={oy - dy * L} x2={ox + dx * L} y2={oy + dy * L} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
          {/* wavefront tick: perpendicular to travel */}
          <line x1={ox - dy * 9} y1={oy + dx * 9} x2={ox + dy * 9} y2={oy - dx * 9} strokeWidth={1} opacity={0.55} vectorEffect="non-scaling-stroke" />
          <circle cx={ox + dx * L} cy={oy + dy * L} r={2.6} stroke="none" />
        </g>,
      );
    } else if (kind === "ring") {
      marks.push(
        <g key={key} stroke={color} fill="none">
          <circle cx={ox} cy={oy} r={16} strokeWidth={1.2} strokeDasharray={field === "noise" ? "3 3" : undefined} vectorEffect="non-scaling-stroke" />
          <circle cx={ox} cy={oy} r={2.6} fill={color} stroke="none" />
        </g>,
      );
    } else if (kind === "no-direction") {
      // A genuinely out-of-plane axis (`linearZ`) or a per-cell, non-spatial
      // value (the four normal-derived kinds — `fieldHasPlacement` above is
      // `false` for these, so a live colour voice card never actually opens
      // this map on one; kept here so this switch stays exhaustive rather
      // than silently mishandling a field it doesn't recognize, the same
      // "hardcoded-N latent bug" class VOLUMETRIC-4.md calls out) has no 2D
      // direction to draw — mark the centre and label it instead.
      marks.push(
        <g key={key}>
          <circle cx={ox} cy={oy} r={2.6} fill={color} stroke="none" />
          <text x={ox + 6} y={oy + 3} fontSize="9" fill={color}>{field === "linearZ" ? "Z" : "n"}</text>
        </g>,
      );
    } else {
      const L = 30;
      marks.push(
        <g key={key} stroke={color} fill="none">
          <path d={`M ${ox} ${oy} L ${ox + dx * L} ${oy + dy * L}`} strokeWidth={1.4} vectorEffect="non-scaling-stroke" />
          <circle cx={ox} cy={oy} r={9} strokeWidth={1} opacity={0.55} vectorEffect="non-scaling-stroke" />
          <circle cx={ox} cy={oy} r={2.6} fill={color} stroke="none" />
        </g>,
      );
    }
  }
  // Its own diagram, sitting beside the waveform in the card's left column.
  // The waveform is a dedicated read of freq/speed/mix; this is the same idea
  // for angle/u/v. Painted OVER the rendered field it just fought the render —
  // two different kinds of picture stacked on one another.
  return (
    <svg className="voice-fieldmap" viewBox={`0 0 ${size} ${size}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1={size / 2} y1={0} x2={size / 2} y2={size} className="voice-fieldmap-axis" />
      <line x1={0} y1={size / 2} x2={size} y2={size / 2} className="voice-fieldmap-axis" />
      {marks}
    </svg>
  );
}

export function VoiceCard({ slot, index, params, onParam, onRemove, onHover, stageShape = "cube", hoverToAnimate = false, mode, onModeChange }: {
  slot: number; index: number; params: Params;
  onParam: (key: string, value: ParamValue) => void; onRemove: () => void;
  /** Fires this card's slot while the pointer is on it (and null when it
   *  leaves), so a host can highlight that voice's contribution in the render.
   *  Optional — /synth doesn't use it. Pointer-over covers dragging too, since
   *  the pointer stays on the card for the whole drag. */
  onHover?: (slot: number | null) => void;
  /** The page's CURRENT stage mesh (VOLUMETRIC-2.md §3) — used only for this
   *  card's own volumetric preview, so e.g. a voice edited on the `pyramid`
   *  stage previews on a pyramid too, not a hardcoded cube. Callers with no
   *  stage concept of their own (the loaders gallery) omit it and keep the
   *  old cube preview. */
  stageShape?: string;
  /** When `true`, this card's own mini preview (and trendline) only animates
   *  while the pointer is over the card — otherwise it renders one static,
   *  representative frame and stays there (perf: a voice sidebar can mount
   *  many of these at once, each with its own render loop). Default `false`
   *  keeps every EXISTING caller's continuous-animation behavior unchanged
   *  (the loaders gallery mounts a card per loader and has never gated this
   *  on hover) — `/synth`'s own sidebar opts in explicitly. */
  hoverToAnimate?: boolean;
  /** Display density (crowding fix) — `undefined` (the default, every
   *  EXISTING caller) keeps the full original card: every param row, the
   *  live mini scene preview (soloed on `stageShape`), no mode toggle.
   *  Passing `"basic"`/`"advanced"` opts a card into the managed layout:
   *  `"basic"` hides `mix`/`phase`/the layer selector/placement (the
   *  conditional `duty`/`iter` rows still show when they apply — those
   *  aren't display-mode params) AND the mini scene preview, showing only
   *  the waveform trendline at full height. `"advanced"` shows everything
   *  `"basic"` does plus those, and re-mounts the mini scene preview below
   *  the trendline — but always soloed on a flat `"plane"`, never
   *  `stageShape`, even on a volumetric patch: the point is to see the
   *  voice's own PATTERN in isolation, not the object it happens to be
   *  painted on (the object preview was removed at the user's request —
   *  see `1d1e2cd`). Either mode shows the per-card `[bsc|adv]` toggle.
   *  Viewer preference only — never read from or written to the `?s=` URL;
   *  `/synth`'s own sidebar is the only caller that passes this today. */
  mode?: VoiceDisplayMode;
  /** Required alongside `mode` for the per-card `[bsc|adv]` toggle to render
   *  (an unmanaged card has nothing to call this with). */
  onModeChange?: (mode: VoiceDisplayMode) => void;
}) {
  const managed = mode !== undefined;
  const showAdvanced = !managed || mode === "advanced";
  // Colour stack precedence table (`resolveColorStackVisibility`'s doc
  // above) — this card's own swatch drives `voiceColors` blending, whose
  // toggle is already hidden once the colour stack owns colour instead.
  const { showVoiceColorSwatch } = resolveColorStackVisibility(params.colorStackOn === true, String(params.colorMode ?? ""));
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const f = (k: string) => String(params[`${k}${slot}`]);
  const num = (k: string) => Number(params[`${k}${slot}`]);
  const volumetric = params.space === "object";
  // Always-fresh ref (not a dep) — the trendline reads it from inside the
  // preview's own rAF tick, which must stay mounted across param changes.
  const trendRef = useRef({ wave: f("wave"), freq: num("freq"), speed: num("speed"), amp: num("amp"), duty: num("duty"), phase: num("phase") });
  trendRef.current = { wave: f("wave"), freq: num("freq"), speed: num("speed"), amp: num("amp"), duty: num("duty"), phase: num("phase") };
  const pathRef = useRef<SVGPathElement | null>(null);
  const onTick = useCallback((t: number) => {
    const path = pathRef.current;
    if (!path) return;
    const v = trendRef.current;
    path.setAttribute("d", buildWavePathD(v.wave, v.freq, v.speed, v.amp, t, 100, 30, v.duty, v.phase));
  }, []);
  // `soloParams` also copies the SOURCE layer's shaping (see its own doc) and
  // the voice's own `iter${slot}` — so the deps list below must track the
  // voice's `layer${slot}` assignment, `iter${slot}`, and every layer's
  // combine/threshold/invert/blend/amp, or an edit to any of those leaves
  // this card's preview and trendline rendering a stale patch.
  const layerShapingDeps = Array.from({ length: MAX_LAYERS }, (_, i) => i + 1).flatMap((l) => [
    params[`layerCombine${l}`], params[`layerThresholdOn${l}`], params[`layerThreshold${l}`],
    params[`layerInvert${l}`], params[`layerBlend${l}`], params[`layerAmp${l}`],
  ]);
  const animate = hoverToAnimate ? hovered : true;
  // An unmanaged card (`mode` omitted — the loaders gallery) mounts its own
  // live mini scene, soloed on `stageShape` when the patch is volumetric,
  // which drives the trendline via `onTick` as a byproduct. A managed card
  // (`/synth`) only renders the `host` span below (see `voice-preview`) in
  // `"advanced"` mode, and always solos on a flat `"plane"` regardless of
  // `stageShape` — showing the voice's own pattern, never the object it's
  // painted on. In `"basic"` mode `host` stays null so this call is a no-op
  // and the decoupled clock below drives the trendline instead; the two
  // never fire the same `onTick` at once for a given card.
  useSynthPreview(host, () => soloParams(params, slot), [params[`field${slot}`], params[`wave${slot}`], params[`freq${slot}`], params[`speed${slot}`], params[`color${slot}`], params[`angle${slot}`], params[`originU${slot}`], params[`originV${slot}`], params[`originW${slot}`], params[`duty${slot}`], params[`phase${slot}`], params[`iter${slot}`], params[`layer${slot}`], ...layerShapingDeps, params.voiceColors, params.space, params.scale, params.color, params.colorB, params.gradient, params.glyphs, host, stageShape], onTick, managed ? "plane" : (volumetric ? stageShape : "plane"), animate);
  useTrendlineClock(onTick, [f("wave"), num("freq"), num("speed"), num("amp"), num("duty"), num("phase")], animate, managed && !showAdvanced);
  const fill = (v: number, min: number, max: number) => ({ ["--fill" as string]: `${((v - min) / (max - min)) * 100}%` } as CSSProperties);
  // Placement (angle/u/v) is the exception rather than the rule, so it folds
  // away — but a patch that USES it should show it without being asked. The
  // check spans the whole patch, not just this voice: Cube tiles leaves voice 1
  // at 0° while turning 2 and 3, and one open card beside two shut ones reads
  // as a glitch rather than a state.
  const patchUsesPlacement = Array.from({ length: MAX_VOICES }, (_, k) => k + 1).some((v) =>
    Number(params[`amp${v}`] ?? 0) > 0
    && ((angleApplies(String(params[`field${v}`])) && Number(params[`angle${v}`] ?? 0) !== 0)
      || Number(params[`originU${v}`] ?? 0) !== 0 || Number(params[`originV${v}`] ?? 0) !== 0
      || Number(params[`originW${v}`] ?? 0) !== 0));
  const [placementOverride, setPlacementOverride] = useState<boolean | null>(null);
  // Applying a preset flips `patchUsesPlacement`; clear any manual choice so the
  // new patch decides, instead of a stale click hiding what it configured.
  useEffect(() => { setPlacementOverride(null); }, [patchUsesPlacement]);
  const placementOpen = placementOverride ?? patchUsesPlacement;
  return (
    <div
      className="voice-card"
      onPointerEnter={() => { onHover?.(slot); if (hoverToAnimate) setHovered(true); }}
      onPointerLeave={() => { onHover?.(null); if (hoverToAnimate) setHovered(false); }}
    >
      <div className="voice-left">
        <svg className="voice-trend" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="15" x2="100" y2="15" className="voice-trend-mid" />
          <path ref={pathRef} className="voice-trend-line" style={{ stroke: f("color") }} vectorEffect="non-scaling-stroke" fill="none" />
        </svg>
        {/* Managed cards (`/synth`) drop the live mini scene preview in
            `"basic"` mode (user: "the object rendering below the wave could
            disappear") — not just hidden, never rendered, so `host` stays
            null and `useSynthPreview` above stays a no-op. `"advanced"`
            re-mounts it, always soloed on a flat plane (see the
            `useSynthPreview` call above) — a pattern, not the object. */}
        {showAdvanced && <span className="voice-preview" ref={setHost} />}
      </div>
      <div className="voice-controls">
        <div className="voice-head">
          <span className="voice-title">Voice {index + 1}</span>
          <span className="voice-head-right">
            {showVoiceColorSwatch && (
              <input type="color" className="voice-color" value={f("color")} onChange={(e) => onParam(`color${slot}`, e.target.value)} title="Voice color" />
            )}
            {managed && (
              <span className="voice-mode-toggle">
                <IconToggle
                  groupTitle="Basic/Advanced — Basic shows wave, field, freq, speed, and any conditional params (duty, iter). Advanced adds mix, phase, layer assignment, and placement."
                  options={VOICE_MODE_TOGGLE}
                  value={mode as string}
                  onChange={(v) => onModeChange?.(v as VoiceDisplayMode)}
                />
              </span>
            )}
            <button className="voice-remove" onClick={onRemove} title="Remove voice">×</button>
          </span>
        </div>
        <IconToggle groupTitle="Wave — the oscillator shape sampled across this voice's field (hover a button for its shape)" options={WAVE_TOGGLE} value={f("wave")} onChange={(v) => onParam(`wave${slot}`, v)} />
        <IconToggle groupTitle="Field — how this voice's value varies spatially across the surface (hover a button for its shape)" options={volumetric ? FIELD_TOGGLE_3D : FIELD_TOGGLE} value={f("field")} onChange={(v) => onParam(`field${slot}`, v)} />
        <label className="voice-slider" title="Freq — spatial frequency: how many oscillation cycles this voice packs across the surface. Higher = tighter, more repetitions. The dial is tapered, so the low end where patterns actually live gets most of the travel."><span>freq</span><span className="voice-slider-track"><input type="range" min={0} max={1} step={0.001} value={freqToSlider(num("freq"), FREQ_MAX)} style={fill(freqToSlider(num("freq"), FREQ_MAX), 0, 1)} onChange={(e) => onParam(`freq${slot}`, freqFromSlider(+e.target.value, FREQ_MAX))} /></span><EditableReadout value={num("freq")} min={0} max={FREQ_MAX} format={(v) => (v < 2 ? v.toFixed(2) : v.toFixed(1))} onCommit={(v) => onParam(`freq${slot}`, v)} /></label>
        <label className="voice-slider" title="Speed — how fast this voice's phase animates over time. Negative reverses the direction of travel."><span>speed</span><span className="voice-slider-track"><input type="range" min={-8} max={8} step={0.05} value={num("speed")} style={fill(num("speed"), -8, 8)} onChange={(e) => onParam(`speed${slot}`, +e.target.value)} /></span><EditableReadout value={num("speed")} min={-8} max={8} format={(v) => v.toFixed(2)} onCommit={(v) => onParam(`speed${slot}`, v)} /></label>
        {showAdvanced && <label className="voice-slider" title="Mix — a MIX WEIGHT, not a volume: blends the running result toward combine(result, this voice) by this amount. 0 skips the voice entirely; a low value still shows up gently instead of a mode like multiply collapsing the whole field to flat."><span>mix</span><span className="voice-slider-track"><input type="range" min={0} max={1} step={0.02} value={num("amp")} style={fill(num("amp"), 0, 1)} onChange={(e) => onParam(`amp${slot}`, +e.target.value)} /></span><EditableReadout value={num("amp")} min={0} max={1} format={(v) => v.toFixed(2)} onCommit={(v) => onParam(`amp${slot}`, v)} /></label>}
        {f("wave") === "square" && <label className="voice-slider" title="Duty — the square wave's high fraction. 0.5 (default) is an even on/off split; a smaller value selects a narrower high band (e.g. 1/3 for a middle-third selector)."><span>duty</span><span className="voice-slider-track"><input type="range" min={0} max={1} step={0.01} value={num("duty")} style={fill(num("duty"), 0, 1)} onChange={(e) => onParam(`duty${slot}`, +e.target.value)} /></span><EditableReadout value={num("duty")} min={0} max={1} format={(v) => v.toFixed(2)} onCommit={(v) => onParam(`duty${slot}`, v)} /></label>}
        {showAdvanced && <label className="voice-slider" title="Phase — added to this voice's wave argument, in cycles. Shifts the wave itself, unlike Origin U/V (which linear fields ignore entirely) — the only way to phase-shift a linear voice. For a menger/sierpinski voice, phase is an ISO-LEVEL offset instead — it erodes/dilates the solid, not a translation."><span>phase</span><span className="voice-slider-track"><input type="range" min={-1} max={1} step={0.01} value={num("phase")} style={fill(num("phase"), -1, 1)} onChange={(e) => onParam(`phase${slot}`, +e.target.value)} /></span><EditableReadout value={num("phase")} min={-1} max={1} format={(v) => v.toFixed(2)} onCommit={(v) => onParam(`phase${slot}`, v)} /></label>}
        {isSdfIterField(f("field")) && <label className="voice-slider" title="Iterations — recursion depth of the box (menger) / corner-tetra (sierpinski) fractal. Capped at 4: carve/xray's march resolution caps at 256 steps, and iteration 5 would need ~486 and render guaranteed false holes."><span>iter</span><span className="voice-slider-track"><input type="range" min={1} max={4} step={1} value={num("iter")} style={fill(num("iter"), 1, 4)} onChange={(e) => onParam(`iter${slot}`, +e.target.value)} /></span><EditableReadout value={num("iter")} min={1} max={4} integer format={(v) => String(v)} onCommit={(v) => onParam(`iter${slot}`, v)} /></label>}
        {showAdvanced && (
          <div className="voice-layer-row" title="Layer — which of up to 3 groups this voice folds into before layers combine. All voices default to layer 1, which folds exactly like today's flat mix.">
            <span className="voice-layer-label">layer</span>
            <IconToggle groupTitle="Layer assignment" options={LAYER_TOGGLE} value={String(num("layer"))} onChange={(v) => onParam(`layer${slot}`, Number(v))} />
          </div>
        )}
        {showAdvanced && (
          <button
            type="button"
            className={`voice-placement-toggle${placementOpen ? " is-open" : ""}`}
            onClick={() => setPlacementOverride(!placementOpen)}
            title="Placement — where this voice's field is centred and which way it runs. Hidden until used, since most patches leave it alone."
          >
            {placementOpen ? "▾" : "▸"} placement
          </button>
        )}
        {showAdvanced && placementOpen && (
          <div className="voice-placement">
            <VoiceFieldMap params={params} slot={slot} />
            <div className="voice-placement-rows">
        {angleApplies(f("field")) && <label className="voice-slider" title="Angle — rotates this voice's sampling frame about its own origin, in degrees. Turns the linear fields into a steerable plane wave; radial is invariant to it (its level sets are circles)."><span>angle</span><span className="voice-slider-track"><input type="range" min={-180} max={180} step={1} value={num("angle")} style={fill(num("angle"), -180, 180)} onChange={(e) => onParam(`angle${slot}`, +e.target.value)} /></span><EditableReadout value={num("angle")} min={-180} max={180} format={(v) => `${v.toFixed(0)}°`} onCommit={(v) => onParam(`angle${slot}`, v)} /></label>}
        <label className="voice-slider" title="Origin U — offsets THIS voice's centre from the global origin. Two radial voices on different centres is the classic interference figure."><span>u</span><span className="voice-slider-track"><input type="range" min={-1} max={1} step={0.01} value={num("originU")} style={fill(num("originU"), -1, 1)} onChange={(e) => onParam(`originU${slot}`, +e.target.value)} /></span><EditableReadout value={num("originU")} min={-1} max={1} format={(v) => v.toFixed(2)} onCommit={(v) => onParam(`originU${slot}`, v)} /></label>
        <label className="voice-slider" title="Origin V — as Origin U, on the other axis."><span>v</span><span className="voice-slider-track"><input type="range" min={-1} max={1} step={0.01} value={num("originV")} style={fill(num("originV"), -1, 1)} onChange={(e) => onParam(`originV${slot}`, +e.target.value)} /></span><EditableReadout value={num("originV")} min={-1} max={1} format={(v) => v.toFixed(2)} onCommit={(v) => onParam(`originV${slot}`, v)} /></label>
        {(volumetric || isSdfField(f("field"))) && <label className="voice-slider" title="Origin W — as Origin U/V, on the third (depth) axis. No effect on a 2D linear/angular/radial/noise field, but an SDF voice (gyroid/menger/sierpinski) reads it even in 2D — the field is evaluated as a z=0 slice, and Origin W moves that slice through the volume."><span>w</span><span className="voice-slider-track"><input type="range" min={-1} max={1} step={0.01} value={num("originW")} style={fill(num("originW"), -1, 1)} onChange={(e) => onParam(`originW${slot}`, +e.target.value)} /></span><EditableReadout value={num("originW")} min={-1} max={1} format={(v) => v.toFixed(2)} onCommit={(v) => onParam(`originW${slot}`, v)} /></label>}
            </div>
          </div>
        )}

      </div>
    </div>
  );
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
  base.field1 = "radial"; base.freq1 = 0; base.amp1 = 1;
  base.space = params.space; base.scale = params.scale; base.glyphs = params.glyphs;
  base.voiceColors = false;
  base.colorStackOn = true;
  base.colorCombine = params.colorCombine;
  base.colorMode = params.colorMode;
  base.hueOffset = params.hueOffset; base.hueRange = params.hueRange;
  base.hueSat = params.hueSat; base.hueLight = params.hueLight;
  base.color = params.color; base.colorB = params.colorB; base.gradient = params.gradient;
  for (let k = 1; k <= MAX_COLOR_VOICES; k++) base[`camp${k}`] = 0;
  base.cfield1 = params[`cfield${slot}`]; base.cwave1 = params[`cwave${slot}`];
  base.cangle1 = params[`cangle${slot}`]; base.coriginU1 = params[`coriginU${slot}`]; base.coriginV1 = params[`coriginV${slot}`];
  base.coriginW1 = params[`coriginW${slot}`];
  base.cduty1 = params[`cduty${slot}`]; base.cphase1 = params[`cphase${slot}`];
  base.cfreq1 = params[`cfreq${slot}`]; base.cspeed1 = params[`cspeed${slot}`]; base.camp1 = 1;
  base.citer1 = params[`citer${slot}`];
  base.gain = 1; base.bias = 0.5;
  return base;
}

// A fixed accent for colour-voice-only UI (trendline stroke, placement map
// fallback mark) — colour voices have no per-voice swatch of their own (see
// `ColorVoiceCard`'s doc above), unlike a geometry voice's `color${slot}`,
// so there's no per-voice value to read here. Distinct from the geometry
// rail's cyan (`#38bdf8`) so a colour voice card is visually legible as
// belonging to the OTHER stack even before reading its label.
const COLOR_VOICE_ACCENT = "#f472b6";

export function ColorVoiceCard({ slot, index, params, onParam, onRemove, stageShape = "cube", hoverToAnimate = false, mode, onModeChange }: {
  slot: number; index: number; params: Params;
  onParam: (key: string, value: ParamValue) => void; onRemove: () => void;
  stageShape?: string;
  hoverToAnimate?: boolean;
  /** Display density (crowding fix) — mirrors `VoiceCard`'s own `mode` prop
   *  exactly (see its doc comment): `undefined` (the default) keeps the full
   *  original card, every param row shown. `"basic"`/`"advanced"` opts a
   *  card into the managed layout: `"basic"` hides `camp` (mix), `cphase`,
   *  and placement (`cangle`/`coriginU/V/W`) — the conditional `cduty`
   *  (square wave) / `citer` (SDF field) rows still show when they apply,
   *  same as geometry. Unlike a geometry voice, a colour voice has no layer
   *  selector at all (AGENTS.md: "layers have no color model of their
   *  own") — there's nothing to gate for that concept here. Viewer
   *  preference only — never read from or written to the `?s=` URL. */
  mode?: VoiceDisplayMode;
  /** Required alongside `mode` for the per-card `[bsc|adv]` toggle to render. */
  onModeChange?: (mode: VoiceDisplayMode) => void;
}) {
  const managed = mode !== undefined;
  const showAdvanced = !managed || mode === "advanced";
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const f = (k: string) => String(params[`c${k}${slot}`]);
  const num = (k: string) => Number(params[`c${k}${slot}`]);
  const field = f("field");
  const isNormalDerived = NORMAL_DERIVED_SYNTH_FIELDS.has(field);
  const volumetric = params.space === "object";
  const trendRef = useRef({ wave: f("wave"), freq: num("freq"), speed: num("speed"), amp: num("amp"), duty: num("duty"), phase: num("phase") });
  trendRef.current = { wave: f("wave"), freq: num("freq"), speed: num("speed"), amp: num("amp"), duty: num("duty"), phase: num("phase") };
  const pathRef = useRef<SVGPathElement | null>(null);
  const onTick = useCallback((t: number) => {
    const path = pathRef.current;
    if (!path) return;
    const v = trendRef.current;
    path.setAttribute("d", buildWavePathD(v.wave, v.freq, v.speed, v.amp, t, 100, 30, v.duty, v.phase));
  }, []);
  const animate = hoverToAnimate ? hovered : true;
  // Managed (`/synth`) cards drop the mini scene preview in "basic" mode,
  // same rule `VoiceCard` applies (`c6591a2`) — the decoupled clock below
  // drives the trendline instead, and the two never fire the same `onTick`
  // at once. This is the SAME RULE as the geometry card, not the same
  // pinned shape: geometry always solos on a flat "plane" in advanced mode
  // because the point there is the voice's own occupancy PATTERN in
  // isolation from the object it's painted on. A colour voice's solo
  // (`soloColorParams`) already isolates colour a different way — it forces
  // the GEOMETRY stack flat (`field1: "radial", freq1: 0`, constant
  // occupancy) so glyph choice never varies and only colour does; the
  // preview MESH shape is left free to track `stageShape` on a volumetric
  // patch, because several colour fields (the four normal-derived kinds,
  // and any `space: "object"` field) are genuine reads of the real 3D
  // surface/normal and are meaningless on a flat plane — pinning to "plane"
  // here would defeat the same fields the "no preview" state below already
  // exists to handle. So: same basic/advanced RULE (mini preview only in
  // advanced), different shape policy, because the two solos isolate
  // different things.
  useSynthPreview(
    host,
    () => soloColorParams(params, slot),
    [
      params[`cfield${slot}`], params[`cwave${slot}`], params[`cfreq${slot}`], params[`cspeed${slot}`],
      params[`cangle${slot}`], params[`coriginU${slot}`], params[`coriginV${slot}`], params[`coriginW${slot}`],
      params[`cduty${slot}`], params[`cphase${slot}`], params[`citer${slot}`],
      params.colorCombine, params.colorMode, params.hueOffset, params.hueRange, params.hueSat, params.hueLight,
      params.color, params.colorB, params.gradient, params.space, params.scale, params.glyphs, host, stageShape,
    ],
    onTick,
    volumetric ? stageShape : "plane",
    animate,
  );
  useTrendlineClock(onTick, [f("wave"), num("freq"), num("speed"), num("amp"), num("duty"), num("phase")], animate, managed && !showAdvanced);
  const fill = (v: number, min: number, max: number) => ({ ["--fill" as string]: `${((v - min) / (max - min)) * 100}%` } as CSSProperties);
  const canPlace = fieldHasPlacement(field);
  const [placementOverride, setPlacementOverride] = useState(false);
  // A field switch that loses placement (into a normal-derived kind) must
  // close the panel rather than leave it open on now-hidden rows.
  useEffect(() => { if (!canPlace) setPlacementOverride(false); }, [canPlace]);
  const placementOpen = canPlace && placementOverride;
  return (
    <div
      className="voice-card"
      onPointerEnter={() => { if (hoverToAnimate) setHovered(true); }}
      onPointerLeave={() => { if (hoverToAnimate) setHovered(false); }}
    >
      <div className="voice-left">
        <svg className="voice-trend" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="15" x2="100" y2="15" className="voice-trend-mid" />
          <path ref={pathRef} className="voice-trend-line" style={{ stroke: COLOR_VOICE_ACCENT }} vectorEffect="non-scaling-stroke" fill="none" />
        </svg>
        {showAdvanced && (
          isNormalDerived ? (
            <span
              className="voice-preview voice-preview-none"
              title="No 2D preview — this field is a per-cell surface normal read (VOLUMETRIC-4.md §1), which a flat preview plane can't show (its normal never varies). Apply it and look at the real stage."
            >
              no preview
            </span>
          ) : (
            <span className="voice-preview" ref={setHost} />
          )
        )}
      </div>
      <div className="voice-controls">
        <div className="voice-head">
          <span className="voice-title">Voice {index + 1}</span>
          <span className="voice-head-right">
            {managed && (
              <span className="voice-mode-toggle">
                <IconToggle
                  groupTitle="Basic/Advanced — Basic shows wave, field, freq, speed, and any conditional params (duty, iter). Advanced adds mix, phase, and placement."
                  options={VOICE_MODE_TOGGLE}
                  value={mode as string}
                  onChange={(v) => onModeChange?.(v as VoiceDisplayMode)}
                />
              </span>
            )}
            <button className="voice-remove" onClick={onRemove} title="Remove colour voice">×</button>
          </span>
        </div>
        <IconToggle groupTitle="Wave — the oscillator shape sampled across this colour voice's field (hover a button for its shape)" options={WAVE_TOGGLE} value={f("wave")} onChange={(v) => onParam(`cwave${slot}`, v)} />
        <IconToggle
          groupTitle="Field — how this colour voice's value varies (hover a button for its shape). The four normal-derived kinds at the end (VOLUMETRIC-4.md §1) read the surface's own geometric normal — one value per cell, not a spatial pattern."
          options={volumetric ? FIELD_TOGGLE_COLOR_3D : FIELD_TOGGLE_COLOR}
          value={field}
          onChange={(v) => onParam(`cfield${slot}`, v)}
        />
        <label className="voice-slider" title="Freq — spatial frequency: how many oscillation cycles this voice packs across the surface."><span>freq</span><span className="voice-slider-track"><input type="range" min={0} max={1} step={0.001} value={freqToSlider(num("freq"), CFREQ_MAX)} style={fill(freqToSlider(num("freq"), CFREQ_MAX), 0, 1)} onChange={(e) => onParam(`cfreq${slot}`, freqFromSlider(+e.target.value, CFREQ_MAX))} /></span><EditableReadout value={num("freq")} min={0} max={CFREQ_MAX} format={(v) => (v < 2 ? v.toFixed(2) : v.toFixed(1))} onCommit={(v) => onParam(`cfreq${slot}`, v)} /></label>
        <label className="voice-slider" title="Speed — how fast this voice's phase animates over time. Negative reverses the direction of travel."><span>speed</span><span className="voice-slider-track"><input type="range" min={-8} max={8} step={0.05} value={num("speed")} style={fill(num("speed"), -8, 8)} onChange={(e) => onParam(`cspeed${slot}`, +e.target.value)} /></span><EditableReadout value={num("speed")} min={-8} max={8} format={(v) => v.toFixed(2)} onCommit={(v) => onParam(`cspeed${slot}`, v)} /></label>
        {showAdvanced && <label className="voice-slider" title="Mix — a MIX WEIGHT, not a volume: blends the running colour-stack result toward combine(result, this voice) by this amount. 0 skips the voice entirely."><span>mix</span><span className="voice-slider-track"><input type="range" min={0} max={1} step={0.02} value={num("amp")} style={fill(num("amp"), 0, 1)} onChange={(e) => onParam(`camp${slot}`, +e.target.value)} /></span><EditableReadout value={num("amp")} min={0} max={1} format={(v) => v.toFixed(2)} onCommit={(v) => onParam(`camp${slot}`, v)} /></label>}
        {f("wave") === "square" && <label className="voice-slider" title="Duty — the square wave's high fraction."><span>duty</span><span className="voice-slider-track"><input type="range" min={0} max={1} step={0.01} value={num("duty")} style={fill(num("duty"), 0, 1)} onChange={(e) => onParam(`cduty${slot}`, +e.target.value)} /></span><EditableReadout value={num("duty")} min={0} max={1} format={(v) => v.toFixed(2)} onCommit={(v) => onParam(`cduty${slot}`, v)} /></label>}
        {showAdvanced && <label className="voice-slider" title="Phase — added to this voice's wave argument, in cycles."><span>phase</span><span className="voice-slider-track"><input type="range" min={-1} max={1} step={0.01} value={num("phase")} style={fill(num("phase"), -1, 1)} onChange={(e) => onParam(`cphase${slot}`, +e.target.value)} /></span><EditableReadout value={num("phase")} min={-1} max={1} format={(v) => v.toFixed(2)} onCommit={(v) => onParam(`cphase${slot}`, v)} /></label>}
        {isSdfIterField(field) && <label className="voice-slider" title="Iterations — recursion depth of the box (menger) / corner-tetra (sierpinski) fractal."><span>iter</span><span className="voice-slider-track"><input type="range" min={1} max={4} step={1} value={num("iter")} style={fill(num("iter"), 1, 4)} onChange={(e) => onParam(`citer${slot}`, +e.target.value)} /></span><EditableReadout value={num("iter")} min={1} max={4} integer format={(v) => String(v)} onCommit={(v) => onParam(`citer${slot}`, v)} /></label>}
        {showAdvanced && canPlace && (
          <button
            type="button"
            className={`voice-placement-toggle${placementOpen ? " is-open" : ""}`}
            onClick={() => setPlacementOverride((o) => !o)}
            title="Placement — where this colour voice's field is centred and which way it runs."
          >
            {placementOpen ? "▾" : "▸"} placement
          </button>
        )}
        {showAdvanced && placementOpen && (
          <div className="voice-placement">
            <VoiceFieldMap params={params} slot={slot} keyPrefix="c" fallbackColor={COLOR_VOICE_ACCENT} />
            <div className="voice-placement-rows">
              {angleApplies(field) && <label className="voice-slider" title="Angle — rotates this voice's sampling frame about its own origin, in degrees."><span>angle</span><span className="voice-slider-track"><input type="range" min={-180} max={180} step={1} value={num("angle")} style={fill(num("angle"), -180, 180)} onChange={(e) => onParam(`cangle${slot}`, +e.target.value)} /></span><EditableReadout value={num("angle")} min={-180} max={180} format={(v) => `${v.toFixed(0)}°`} onCommit={(v) => onParam(`cangle${slot}`, v)} /></label>}
              <label className="voice-slider" title="Origin U — offsets THIS voice's centre from the global origin."><span>u</span><span className="voice-slider-track"><input type="range" min={-1} max={1} step={0.01} value={num("originU")} style={fill(num("originU"), -1, 1)} onChange={(e) => onParam(`coriginU${slot}`, +e.target.value)} /></span><EditableReadout value={num("originU")} min={-1} max={1} format={(v) => v.toFixed(2)} onCommit={(v) => onParam(`coriginU${slot}`, v)} /></label>
              <label className="voice-slider" title="Origin V — as Origin U, on the other axis."><span>v</span><span className="voice-slider-track"><input type="range" min={-1} max={1} step={0.01} value={num("originV")} style={fill(num("originV"), -1, 1)} onChange={(e) => onParam(`coriginV${slot}`, +e.target.value)} /></span><EditableReadout value={num("originV")} min={-1} max={1} format={(v) => v.toFixed(2)} onCommit={(v) => onParam(`coriginV${slot}`, v)} /></label>
              {(volumetric || isSdfField(field)) && <label className="voice-slider" title="Origin W — as Origin U/V, on the third (depth) axis."><span>w</span><span className="voice-slider-track"><input type="range" min={-1} max={1} step={0.01} value={num("originW")} style={fill(num("originW"), -1, 1)} onChange={(e) => onParam(`coriginW${slot}`, +e.target.value)} /></span><EditableReadout value={num("originW")} min={-1} max={1} format={(v) => v.toFixed(2)} onCommit={(v) => onParam(`coriginW${slot}`, v)} /></label>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

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
export function resolveColorStackVisibility(colorStackOn: boolean, colorMode: string): {
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

// The voice sidebar's own colour section — below the geometry layer groups
// (VOLUMETRIC-4.md §1 Phase 4: "voices are composed in the sidebar, and
// colour voices are voices", not a dock-only afterthought). Collapses to
// just its enable toggle when `colorStackOn` is off — the toggle's own
// bracket-checkbox reads `[x]`/`[ ]`, the SAME idiom `LayerGroup`'s
// threshold/invert checkboxes use (`.layer-group-check` in
// instrument-workbench.css) — and every param underneath stays untouched in
// `params` while collapsed (same "retained but inert" contract
// `voiceColors`' own toggle already established), so re-enabling restores
// exactly what was there.
export function ColorStackSection({ params, onParam, stageShape }: {
  params: Params; onParam: (key: string, value: ParamValue) => void; stageShape: string;
}) {
  const colorStackOn = params.colorStackOn === true;
  const colorMode = String(params.colorMode ?? "gradient");
  // Which palette controls this section owns right now — same precedence
  // table `SynthDock` reads (`resolveColorStackVisibility`'s doc above): with
  // the stack on, gradient's Color/Color B/Gradient and hue's four sliders
  // are mutually exclusive on `colorMode`, and the Dock gives them up
  // entirely (see that function's call site in `SynthDock` below) — a
  // control lives in exactly one of the two places, never both.
  const { showGradientColors, showHueControls } = resolveColorStackVisibility(colorStackOn, colorMode);
  const fill = (v: number, min: number, max: number) => ({ ["--fill" as string]: `${((v - min) / (max - min)) * 100}%` } as CSSProperties);
  // Existence == `campN > 0` (VOLUMETRIC-4.md §1: "far less structure" than
  // the fractal geometry voices), unlike the geometry rail's independent
  // `voiceSlots` state (SynthWorkbench.tsx), which lets a MUTED voice keep
  // its card. A colour voice has no equivalent "silence but keep editing"
  // use case worth a second piece of state, and there's no URL-persisted
  // slot mask for it either — the whole patch, colour params included,
  // already round-trips through the generic packed `?s=` schema codec (see
  // synthUrlState.ts), so deriving existence straight from `camp` keeps a
  // shared/preset link's colour voices exactly as populated as the patch
  // that produced it.
  const colorVoiceSlots = Array.from({ length: MAX_COLOR_VOICES }, (_, i) => i + 1)
    .filter((slot) => Number(params[`camp${slot}`] ?? 0) > 0);
  const addColorVoice = useCallback(() => {
    const slot = nextFreeVoiceSlot(colorVoiceSlots, MAX_COLOR_VOICES);
    if (!slot) return;
    onParam(`camp${slot}`, 1);
  }, [colorVoiceSlots, onParam]);
  const removeColorVoice = useCallback((slot: number) => onParam(`camp${slot}`, 0), [onParam]);
  // Per-card display density (crowding fix, mirroring `VoiceCard`'s own
  // `mode`/`onModeChange`) — deliberately its OWN state, not shared with the
  // geometry sidebar's `voiceMode` (SynthWorkbench.tsx): the colour stack is
  // documented throughout this file as "a second, independent voice program
  // ... decoupled from the geometry voices" (VOLUMETRIC-4.md §1), and its
  // slot numbers (1..MAX_COLOR_VOICES) overlap the geometry rail's own
  // (1..MAX_VOICES) — a shared override map keyed only by slot number would
  // silently cross-apply an override from one stack's card to the other's
  // same-numbered card. Viewer preference only — never URL-persisted, same
  // contract as the geometry rail's `voiceMode`.
  //
  // No section-wide "set every card at once" toggle here (unlike the
  // geometry rail's `voiceMode`, which manages up to `MAX_VOICES` = 9 cards)
  // — `MAX_COLOR_VOICES` = 3, so a global toggle next to "+ Add colour
  // voice" was managing at most three per-card `[bsc|adv]` toggles it sat
  // nowhere near (user report: "why do we have bsc/adv next to the add
  // colour voice? shouldn't that only be next to color voice 1?"). Each
  // card's own toggle is the only control now; default "basic" per card.
  const [colorVoiceModeByCard, setColorVoiceModeByCard] = useState<Record<number, VoiceDisplayMode>>({});
  const setColorVoiceCardMode = useCallback((slot: number, next: VoiceDisplayMode) => {
    setColorVoiceModeByCard((prev) => ({ ...prev, [slot]: next }));
  }, []);
  return (
    <div className="color-stack">
      {/* Header ROW: the enable checkbox (its own `<label>`, click target for
          the checkbox only) plus combine/mode selects as flex SIBLINGS — not
          children of the label, which would hijack a select click into
          toggling the checkbox (the same conflict `LayerGroup`'s header hit
          in `7ca4496`, and the same fix: split the click target out). The
          selects only render while `colorStackOn`, same as the body below. */}
      <div className="color-stack-head">
        <label
          className="color-stack-check"
          title="Colour voice stack — a second, independent voice program that drives colour only, decoupled from the geometry voices above (VOLUMETRIC-4.md §1). Params are retained while off, so toggling never loses work."
        >
          <input type="checkbox" checked={colorStackOn} onChange={(e) => onParam("colorStackOn", e.target.checked)} />
          <span>Colour</span>
        </label>
        {colorStackOn && (
          <>
            <label className="gx-select color-stack-head-select" title="Combine — how the colour voices fold together.">
              <select value={String(params.colorCombine ?? "multiply")} onChange={(e) => onParam("colorCombine", e.target.value)}>
                {COMBINES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <label className="gx-select color-stack-head-select" title="Mode — gradient exposes Color / Color B / Gradient below as its endpoints; hue exposes Hue offset/range/saturation/lightness instead — the iridescence mode.">
              <select value={String(params.colorMode ?? "gradient")} onChange={(e) => onParam("colorMode", e.target.value)}>
                <option value="gradient">gradient</option>
                <option value="hue">hue</option>
              </select>
            </label>
          </>
        )}
      </div>
      {colorStackOn && (
        <div className="color-stack-body">
          {/* Palette — the mode-appropriate colour endpoints, moved in from the
              right Dock's Output folder (which gives them up entirely while
              the stack owns them — see `SynthDock`'s own `!colorStackOn` gate
              below) so "how do I pick the gradient colours" has an answer
              right next to the voices that feed them. `showGradientColors`/
              `showHueControls` are mutually exclusive whenever `colorStackOn`
              is true (`colorMode` is a two-value enum), so exactly one of
              the two blocks below renders. */}
          <div className="color-stack-palette">
            {showGradientColors && (
              <>
                <div className="color-stack-swatches">
                  <label className="color-stack-swatch" title="Color — the gradient's start endpoint.">
                    <input type="color" className="voice-color" value={String(params.color ?? "#7df9ff")} onChange={(e) => onParam("color", e.target.value)} />
                    <span>Color</span>
                  </label>
                  <label className="color-stack-swatch" title="Color B — the gradient's end endpoint.">
                    <input type="color" className="voice-color" value={String(params.colorB ?? "#ff4fa3")} onChange={(e) => onParam("colorB", e.target.value)} />
                    <span>Color B</span>
                  </label>
                </div>
                <label className="voice-slider" title="Gradient — interpolation position between Color and Color B.">
                  <span>grad</span>
                  <span className="voice-slider-track"><input type="range" min={0} max={1} step={0.05} value={Number(params.gradient ?? 0)} style={fill(Number(params.gradient ?? 0), 0, 1)} onChange={(e) => onParam("gradient", +e.target.value)} /></span>
                  <EditableReadout value={Number(params.gradient ?? 0)} min={0} max={1} format={(v) => v.toFixed(2)} onCommit={(v) => onParam("gradient", v)} />
                </label>
              </>
            )}
            {showHueControls && (
              <>
                <label className="voice-slider" title="Hue offset — rotates the hue wheel, in cycles (a whole-wheel rotation is 1 regardless of Hue range).">
                  <span>hue</span>
                  <span className="voice-slider-track"><input type="range" min={-1} max={1} step={0.01} value={Number(params.hueOffset ?? 0)} style={fill(Number(params.hueOffset ?? 0), -1, 1)} onChange={(e) => onParam("hueOffset", +e.target.value)} /></span>
                  <EditableReadout value={Number(params.hueOffset ?? 0)} min={-1} max={1} format={(v) => v.toFixed(2)} onCommit={(v) => onParam("hueOffset", v)} />
                </label>
                <label className="voice-slider" title="Hue range — how much of the wheel the sweep covers, in degrees.">
                  <span>range</span>
                  <span className="voice-slider-track"><input type="range" min={0} max={360} step={1} value={Number(params.hueRange ?? 360)} style={fill(Number(params.hueRange ?? 360), 0, 360)} onChange={(e) => onParam("hueRange", +e.target.value)} /></span>
                  <EditableReadout value={Number(params.hueRange ?? 360)} min={0} max={360} format={(v) => `${v.toFixed(0)}°`} onCommit={(v) => onParam("hueRange", v)} />
                </label>
                <label className="voice-slider" title="Hue saturation — fixed saturation for every hue in the sweep.">
                  <span>sat</span>
                  <span className="voice-slider-track"><input type="range" min={0} max={100} step={1} value={Number(params.hueSat ?? 70)} style={fill(Number(params.hueSat ?? 70), 0, 100)} onChange={(e) => onParam("hueSat", +e.target.value)} /></span>
                  <EditableReadout value={Number(params.hueSat ?? 70)} min={0} max={100} format={(v) => `${v.toFixed(0)}%`} onCommit={(v) => onParam("hueSat", v)} />
                </label>
                <label className="voice-slider" title="Hue lightness — fixed lightness for every hue in the sweep.">
                  <span>light</span>
                  <span className="voice-slider-track"><input type="range" min={0} max={100} step={1} value={Number(params.hueLight ?? 55)} style={fill(Number(params.hueLight ?? 55), 0, 100)} onChange={(e) => onParam("hueLight", +e.target.value)} /></span>
                  <EditableReadout value={Number(params.hueLight ?? 55)} min={0} max={100} format={(v) => `${v.toFixed(0)}%`} onCommit={(v) => onParam("hueLight", v)} />
                </label>
              </>
            )}
          </div>
          <div className="color-stack-voices">
            {colorVoiceSlots.map((slot) => (
              <ColorVoiceCard
                key={slot} slot={slot} index={colorVoiceSlots.indexOf(slot)} params={params} onParam={onParam}
                onRemove={() => removeColorVoice(slot)} stageShape={stageShape} hoverToAnimate
                mode={colorVoiceModeByCard[slot] ?? "basic"}
                onModeChange={(next) => setColorVoiceCardMode(slot, next)}
              />
            ))}
          </div>
          {colorVoiceSlots.length === 0 && <p className="synth-empty">No colour voices — add one to start.</p>}
          <div className="color-stack-voices-actions">
            <button type="button" className="layer-group-add" onClick={addColorVoice} disabled={colorVoiceSlots.length >= MAX_COLOR_VOICES} title="Add a colour voice">
              + Add colour voice
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Stage hints (VOLUMETRIC-2.md §3) ──────────────────────────────────────────
// Presentation hints per shipped preset: which stage mesh/camera angle makes
// it actually read. Density was the only such hint before this — it's now
// folded into the SAME table instead of its own separate `PRESET_DENSITY`
// map. Keyed by the imported preset OBJECT's identity, not its display name
// (a `Map`, not a `Record<string, …>`): looking a preset up by name would
// silently drop the hint the moment someone renames a preset.
//
// P1-B (VOLUMETRIC-2.md §3 fix review): the map used to be built by finding
// each preset in `fieldSynth.presets` by its `.name` string AT MODULE LOAD
// (a `shippedPreset(name)` helper that THREW if the name didn't match) —
// object identity only after construction, but a name-string lookup to GET
// there. Renaming a shipped preset in `stock.ts` without updating that
// string here crashed module evaluation itself (the whole page, not just a
// preset). `GlyphCubeTilesPreset` etc. are the SAME objects
// `fieldSynth.presets` already holds (stock.ts constructs both from one
// const) — importing them directly removes the lookup (and its throw path)
// entirely: there is no name string to keep in sync anymore.
export interface SynthStageHint {
  /** Overrides `applyPreset`'s `space`-derived stage default (otherwise a
   *  non-cube volumetric preset — e.g. the pyramid-stage Sierpinski preset —
   *  would land on the cube). */
  shape?: string;
  rotX?: number;
  rotY?: number;
  paused?: boolean;
  /** Stage render font-size hint — same meaning as the old `PRESET_DENSITY`
   *  map this table absorbs. */
  density?: number;
  /**
   * Wrap the driven `params.time` modulo this many seconds instead of
   * letting it grow monotonically. For a preset whose animation is a
   * one-way arc that never returns to its start (e.g. a `wave: "step"` SDF
   * voice, which can only ever ERODE over time — a periodic wave would
   * restore looping but drop the voice out of
   * `buildGlyphFieldDistanceOracle`'s sphere-tracing-eligible predicate),
   * an un-hinted monotonic `time`
   * plays the arc once and then sits at its fully-dissolved end state
   * forever — reading as broken, not as "finished". Undefined (the
   * default) keeps today's plain monotonic `time`, byte-identical for
   * every preset that doesn't declare this.
   */
  loopSeconds?: number;
}

export const STAGE_HINTS: ReadonlyMap<GlyphEffectPreset<never>, SynthStageHint> = new Map([
  [GlyphCubeTilesPreset as GlyphEffectPreset<never>, { density: 1.5 }],
  // The reoriented corner tetra (`shapeTransform`/`alignCornerTetraApexEuler`
  // above) has exact 3-fold rotational symmetry about world Z, so its
  // rendered silhouette cycles every 120° of yaw (rotY) — confirmed by
  // measurement, not assumption: a full-circle sweep at the shared default
  // pitch (rotX 58) reproduces the identical taper at every yaw 120° apart.
  // Within one 120° period only part of the range reads as a pyramid (apex
  // narrow, widening monotonically to a wide base); the rest reads as a
  // rhombus/diamond (narrow at both ends, wide in the middle) because the
  // camera is looking at the tetra corner-on rather than down one of its
  // sloped faces. The PREVIOUS entry omitted a custom angle and fell back to
  // the default isometric camera (rotX 58, rotY 32) on the reasoning that it
  // was "visually verified centered and well-framed" — it is centered, but
  // rotY 32 lands squarely in the corner-on part of the cycle: measured
  // per-row filled-span width is pointed at both ends and widest in the
  // middle (rows 11-41, topAvg 56, botAvg 28, max 94, taper 0.51 — taper < 1
  // means WIDENING toward the top-middle then narrowing again, the diamond
  // the user reported, not a pyramid).
  //
  // rotY 225 (pitch unchanged at 58, so the module-level vertical-centering
  // solve — calibrated at this exact pitch, see `solveVerticalCenteringZ`'s
  // doc above — stays exact) lands on the sweet spot: per-row filled-span
  // width grows by a constant 4 cells every single row from the apex down
  // (rows 11-34: 2, 6, 10, ... 94 — perfectly monotonic, topAvg 16, botAvg
  // 80, taper 5), col bbox exactly centered (0.0% offset), row bbox off by
  // -6.7% (smaller than changing pitch away from 58 produces, and smaller
  // than the ~4.4-4.8% col residual this table's own doc already accepts
  // for this shape), and not clipped. The Stage folder's auto-orbit
  // (VOLUMETRIC-2.md §4) still cycles the azimuth through the diamond part
  // of the cycle too — inherent to a 3-fold-symmetric solid rotating in
  // place, the same way a spinning cube shows different face combinations —
  // but the preset now LOADS on a clean pyramid read instead of the
  // corner-on one.
  [GlyphSierpinskiPyramidPreset as GlyphEffectPreset<never>, { shape: "pyramid", rotX: 58, rotY: 225 }],
  // Time-animation preset (VOLUMETRIC-3.md, "we don't have any animation for
  // the volumetric ones") — the gyroid xray recipe with `speedN` turned on
  // (stock.ts). `paused` is deliberately left unset (default `false`): it
  // also stops field-synth's own `time` clock (`SynthScope` in this file),
  // which would silently disable the very animation this preset exists to
  // show.
  [GlyphBreathingGyroidPreset as GlyphEffectPreset<never>, { shape: "cube" }],
  // "Menger (cssGraphics)" — its own camera, retuned from the base Menger
  // membership recipe's shared `rotX:15, rotY:40` specifically to even out
  // its three visible faces' hue spacing (measured ~120° apart at
  // `rotX:32.5, rotY:19` vs. the default camera's >100°-uneven spread — see
  // `cssGraphicsMengerPreset`'s own doc in stock.ts for the full measurement).
  // `density: 3.5` — user hand-tuned this on the live page and asked their
  // settings become the defaults (see the preset's own doc in stock.ts for
  // the geometry-param side of that same retune); density is a STAGE
  // property (render font-size), not an effect param, so it lives here
  // rather than in `cssGraphicsMengerPreset.params`.
  [GlyphCssGraphicsMengerPreset as GlyphEffectPreset<never>, { shape: "cube", rotX: 32.5, rotY: 19, density: 3.5 }],
]);

/** The stage mesh a preset should preview/apply on: its own hint's `shape`
 *  if it has one, else the same `space`-derived default `applyPreset` uses. */
export function stagePreviewShape(preset: GlyphEffectPreset<never>): string {
  return STAGE_HINTS.get(preset)?.shape ?? ((preset.params as Params).space === "object" ? "cube" : "plane");
}

// ── Live preset tile (flat square) ────────────────────────────────────────────
// Hover-to-animate, unconditionally (this component has no other caller —
// unlike `VoiceCard`, there's no LoadersWorkbench-style shared usage to
// preserve): the preset tray can hold a couple dozen tiles, each mounting its
// own `createGlyphScene` render loop, so animating all of them at once was
// the bulk of the perf problem this fixed.
export function PresetTile({ preset, onApply }: { preset: GlyphEffectPreset<never>; onApply: () => void }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [hovered, setHovered] = useState(false);
  useSynthPreview(host, () => ({ ...synthDefaults(), ...(preset.params as Params) }), [host], undefined, stagePreviewShape(preset), hovered);
  return (
    <button
      className="synth-tile"
      onClick={onApply}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      title={`Apply “${preset.name}”`}
    >
      <span className="synth-tile-scene" ref={setHost} />
      <span className="synth-tile-label">{preset.name}</span>
    </button>
  );
}

// ── Layer group (VOLUMETRIC-2.md §4, a rewrite of the old lil-gui
// LayerSection above — not a relocation): the voice sidebar is React, and
// this component now OWNS both the group's own shaping controls AND the
// nested voice cards, replacing the dock's separate "Layers" lil-gui folder
// entirely (that folder held only the shaping knobs; the cards lived in a
// flat list elsewhere — two places for one concept).
//
// Header compression: `.layer-group-head` is a flex ROW (not, as originally
// shipped, a single click-to-toggle `<button>` spanning the whole row) —
// `.layer-group-toggle` is the actual button (caret + "Layer N", the
// collapse/expand click target), and `combine`/`blend` sit beside it as
// their own compact `<select>`s. Splitting the click target out of the
// button this way is what lets a `<select>` live on the header row at all:
// nested inside the toggle button it would fight that button's own click
// handler (a native `<select>` inside a `<button>` either can't open or
// double-fires the parent's onClick, browser-dependent) — as siblings, each
// owns its own input events cleanly. The body below keeps only what doesn't
// fit the header: "mix" (`layerAmpL` — same label as a voice's own "mix" on
// purpose: group opacity vs. element opacity), threshold toggle + value, and
// invert — mix/threshold-toggle/invert share one row, and the threshold
// VALUE slider only renders its own row when the toggle is on, since most
// layers leave it off (VOLUMETRIC.md's Step 3 default).
//
// `layerCombineL` (how the layer's OWN voices fold together before the layer
// blends into the stack) went uneditable in the original rewrite —
// VOLUMETRIC-2.md §4's header list omitted it, a spec defect: Menger/
// Sierpinski-membership-style multi-layer recipes (see
// `GlyphSierpinskiPyramidPreset` in packages/effects/src/stock.ts) set a
// non-default `layerCombineL`, so a live control is needed to actually
// tune those patches rather than only read/write them via preset/URL. It
// resolves BEFORE the layer's blended output exists, so it sits left of
// `blend` on the header row.
export function LayerGroup({ layer, params, onParam, onAddVoice, canAddVoice, children }: {
  layer: number; params: Params; onParam: (key: string, value: ParamValue) => void;
  onAddVoice: (layer: number) => void; canAddVoice: boolean; children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const s = (k: string) => String(params[`${k}${layer}`] ?? "");
  const n = (k: string) => Number(params[`${k}${layer}`] ?? 0);
  const b = (k: string) => params[`${k}${layer}`] === true;
  const thresholdOn = b("layerThresholdOn");
  const fill = (v: number, min: number, max: number) => ({ ["--fill" as string]: `${((v - min) / (max - min)) * 100}%` } as CSSProperties);
  return (
    <div className="layer-group">
      <div className="layer-group-head">
        <button type="button" className="layer-group-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open} title={`Layer ${layer} — collapse/expand its own group`}>
          <span className="layer-group-caret">{open ? "▾" : "▸"}</span>
          <span className="layer-group-title">Layer {layer}</span>
        </button>
        {/* Combine/blend live on the title row (not inside the toggle button
            above — a <select> inside a click-to-toggle button would fight
            that click target), compact but still a real <select> so their
            value and every option stay readable/changeable, not just a
            glyph. Each stays a `<label title="Combine…"/"Blend…">` (not a
            bare `<span>`) so the house tooltip idiom holds AND
            `LayerGroup.test.tsx`'s `label[title^="Combine"] select` query
            keeps matching. */}
        <label className="gx-select layer-group-head-select" title="Combine — how this layer's OWN voices fold together, before the layer's blended output joins the stack. &quot;inherit&quot; follows the patch-level Combine (Mix folder).">
          <select value={s("layerCombine")} onChange={(e) => onParam(`layerCombine${layer}`, e.target.value)}>
            {LAYER_COMBINE_VALUES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="gx-select layer-group-head-select" title="Blend — how this layer's shaped output folds into the running result across layers.">
          <select value={s("layerBlend")} onChange={(e) => onParam(`layerBlend${layer}`, e.target.value)}>
            {LAYER_VALUE_OPS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
      </div>
      {open && (
        <div className="layer-group-body">
          <div className="layer-group-controls">
            <div className="layer-group-row2">
              <label className="layer-group-check layer-group-check--compact" title="Invert — flips which side of the layer's result counts as solid.">
                <span>inv</span>
                <input type="checkbox" checked={b("layerInvert")} onChange={(e) => onParam(`layerInvert${layer}`, e.target.checked)} />
              </label>
              <label className="voice-slider layer-group-mix" title="Mix — this LAYER's own opacity into the stack (same idea as a voice's own mix, one level up: group opacity vs. element opacity).">
                <span>mix</span>
                <span className="voice-slider-track"><input type="range" min={0} max={1} step={0.05} value={n("layerAmp")} style={fill(n("layerAmp"), 0, 1)} onChange={(e) => onParam(`layerAmp${layer}`, +e.target.value)} /></span>
                <EditableReadout value={n("layerAmp")} min={0} max={1} format={(v) => v.toFixed(2)} onCommit={(v) => onParam(`layerAmp${layer}`, v)} />
              </label>
            </div>
            {/* Stable row — the slider is always mounted (user report: toggling
                threshold used to insert/remove a whole row and jump the layout).
                The checkbox sits directly in front of it and stays the enable/
                disable control; the slider itself goes `disabled` and dims when
                off, but its value stays readable either way. */}
            <div className="layer-group-row2">
              <label className="layer-group-check layer-group-check--compact" title="Threshold — cuts the layer's combined value at a level instead of shading it continuously.">
                <span>thr</span>
                <input type="checkbox" checked={thresholdOn} onChange={(e) => onParam(`layerThresholdOn${layer}`, e.target.checked)} />
              </label>
              <label
                className={`voice-slider layer-group-mix layer-group-threshold-slider${thresholdOn ? "" : " layer-group-threshold-slider--off"}`}
                title="Threshold value — the level the layer's combined value is cut against. A thresholded layer's folded value maps to ±1, so this range spans the ±1 signal's usable extent. Only active while the checkbox is on."
              >
                <span className="voice-slider-track"><input type="range" min={-3} max={3} step={0.05} disabled={!thresholdOn} value={n("layerThreshold")} style={fill(n("layerThreshold"), -3, 3)} onChange={(e) => onParam(`layerThreshold${layer}`, +e.target.value)} /></span>
                <EditableReadout value={n("layerThreshold")} min={-3} max={3} disabled={!thresholdOn} format={(v) => v.toFixed(2)} onCommit={(v) => onParam(`layerThreshold${layer}`, v)} />
              </label>
            </div>
          </div>
          <div className="layer-group-voices">{children}</div>
          <button type="button" className="layer-group-add" onClick={() => onAddVoice(layer)} disabled={!canAddVoice} title={`Add a voice assigned to layer ${layer}`}>
            + Add to layer {layer}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Right dock controls (stage / mix / output) ────────────────────────────────
export function SynthDock({ shape, onShape, timeScale, onTimeScale, paused, onPaused, orbitAuto, onOrbitAuto, orbitSpeed, onOrbitSpeed, density, onDensity, colorTolerance, onColorTolerance, lighting, onLight, params, onParam, paramsRef, tsRef, pausedRef, hostRef }: {
  shape: string; onShape: (s: string) => void;
  timeScale: number; onTimeScale: (n: number) => void; paused: boolean; onPaused: (b: boolean) => void;
  /** Camera auto-orbit (user request) — independent of `paused`/`timeScale`,
   *  which drive the MESH's own spin; this drifts the CAMERA. */
  orbitAuto: boolean; onOrbitAuto: (b: boolean) => void;
  orbitSpeed: number; onOrbitSpeed: (n: number) => void;
  density: number; onDensity: (n: number) => void;
  /** Run-extension colour-merge tolerance (COLOR-TOLERANCE.md Phase 4) — a
   *  SCENE option, not a field-synth param, so it's a sibling of `density`
   *  here rather than living in `params`/`onParam`. */
  colorTolerance: number; onColorTolerance: (n: number) => void;
  lighting: Lighting; onLight: (partial: Partial<Lighting>) => void;
  params: Params; onParam: (key: string, value: ParamValue) => void;
  paramsRef: { current: Params }; tsRef: { current: number }; pausedRef: { current: boolean };
  hostRef: { current: HTMLElement | null };
}): ReactNode {
  const gui = useDockGui();
  const s = (k: string) => String(params[k] ?? "");
  const n = (k: string) => Number(params[k] ?? 0);
  // At "2x4" subcell resolution, field-synth emits a synthesized Braille dot
  // mask and never reads the `glyphs` ramp at all (the ramp branch is the
  // `1x1`-only else in fieldSynth's evaluate()) — Ramp/Chars/the density row
  // are dimmed and the reason is spelled out below, and `gain`/`bias`
  // (Contrast/Brightness) instead become the per-dot threshold cutoff.
  const subcellIs2x4 = s("subcellRes") === "2x4";
  // Ink synthesizes contour strokes for the same reason: it reads the field's
  // shape, never the ramp. Both modes therefore dim Ramp/Chars.
  const subcellIsInk = s("subcellRes") === "ink";
  const ramplessSubcell = subcellIs2x4 || subcellIsInk;
  // Single source of truth for "is this patch volumetric" — the Mapping
  // dropdown (the sole `space` control, VOLUMETRIC-2.md §4) and the
  // Volume folder below both read this same derived flag, so neither can
  // desync from `params.space`.
  const volumetric = s("space") === "object";
  // The one guard the Mapping dropdown routes every `space` write through
  // (see `resolveSpaceChange`'s doc above).
  const applySpace = useCallback((nextSpace: string) => {
    const change = resolveSpaceChange(nextSpace);
    if (change.shape) onShape(change.shape);
    if (change.render) onParam("render", change.render);
    onParam("space", nextSpace);
  }, [onShape, onParam]);

  const stage = useFolder(gui, "Stage", { open: true });
  useOption(stage, "Shape", SHAPE_OPTS, shape, (v) => onShape(v));
  useOption(stage, "Mapping", SPACE_OPTS, s("space"), applySpace);
  useSlider(stage, "Density", { min: 0.5, max: 4, step: 0.1 }, density, onDensity);
  useSlider(stage, "Speed", { min: 0.05, max: 8, step: 0.05 }, timeScale, onTimeScale);
  useToggle(stage, "Paused", paused, onPaused);
  // Camera auto-orbit: independent of Speed/Paused above (those spin the
  // MESH about one axis; this drifts the CAMERA's rotX/rotY). The flat plane
  // keeps its camera locked head-on (no drag-orbit either — see the
  // scene-rebuild effect), so the toggle hides there rather than offering a
  // control with nothing to move. "Orbit speed" hides unless orbit is on,
  // same show-only-when-relevant idiom as the Volume folder's render-mode
  // rows below.
  const flatStage = isFlat(shape);
  const orbitCtrl = useToggle(stage, "Orbit", orbitAuto, onOrbitAuto);
  const orbitSpeedCtrl = useSlider(stage, "Orbit speed", { min: 0.1, max: 4, step: 0.05 }, orbitSpeed, onOrbitSpeed);
  useEffect(() => { orbitCtrl?.setVisible(!flatStage); }, [orbitCtrl, flatStage]);
  useEffect(() => { orbitSpeedCtrl?.setVisible(!flatStage && orbitAuto); }, [orbitSpeedCtrl, flatStage, orbitAuto]);

  const mix = useFolder(gui, "Mix", { open: true });
  // Scope goes first so `useDockSlot`'s insertBefore(…, firstChild) lands it
  // above every controller subsequently added to this folder (Combine, Scale, …).
  const scopeHost = useDockSlot(mix, { position: "top", className: "dock-scope-slot" });
  const combineCtrl = useOption(mix, "Combine", COMBINE_OPTS, s("combine"), (v) => onParam("combine", v));
  // `DockController.raw` is the underlying lil-gui `Controller`, whose `$name`
  // is a public DOM element (see `primitives.tsx`) — setting its native
  // `title` attribute reuses the SAME hover-tooltip convention already used
  // everywhere else on this page (IconToggle buttons, the ramp density
  // swatches, the voice color/remove buttons) instead of inventing a second
  // tooltip system for lil-gui rows.
  useEffect(() => {
    if (combineCtrl) combineCtrl.raw.$name.title = "Combine — how each active voice after the first folds into the running result: add, multiply, max, min, or difference.";
  }, [combineCtrl]);
  const scaleSlot = useDockSlot(mix, { position: "bottom", className: "dock-logrow-slot" });
  useSlider(mix, "Origin U", { min: 0, max: 1, step: 0.01 }, n("originU"), (v) => onParam("originU", v));
  useSlider(mix, "Origin V", { min: 0, max: 1, step: 0.01 }, n("originV"), (v) => onParam("originV", v));
  const gainCtrl = useSlider(mix, "Contrast", { min: 0, max: 4, step: 0.05 }, n("gain"), (v) => onParam("gain", v));
  const biasCtrl = useSlider(mix, "Brightness", { min: -1, max: 2, step: 0.05 }, n("bias"), (v) => onParam("bias", v));
  // Relabel in place at 2x4 — same two sliders, different meaning: they set
  // the dot-density / line-weight threshold each subcell's value is cut
  // against (`subValue > 0.5` in fieldSynth's Braille branch) instead of the
  // ramp index.
  useEffect(() => {
    gainCtrl?.raw.name(subcellIs2x4 ? "Contrast (dot threshold)" : "Contrast");
    biasCtrl?.raw.name(subcellIs2x4 ? "Brightness (dot threshold)" : "Brightness");
  }, [gainCtrl, biasCtrl, subcellIs2x4]);

  // Volumetric-only render controls (VOLUMETRIC.md's Carve mode, extended by
  // VOLUMETRIC-2.md §1 with xray): the whole folder hides in 2D rather than
  // unmounting, same show/hide-not-destroy discipline as every other
  // conditional row on this page. Within it, individual rows hide per render
  // mode: March fade is carve's own falloff, Xray gain is xray's own
  // absorption gain (the two can't share a knob — see VOLUMETRIC-2.md §1),
  // March steps applies to both.
  const volume = useFolder(gui, "Volume", { open: true });
  useEffect(() => { if (volume) (volumetric ? volume.show() : volume.hide()); }, [volume, volumetric]);
  const renderMode = s("render");
  const showMarchSteps = renderMode === "carve" || renderMode === "xray";
  useOption(volume, "Render", RENDER_OPTS, renderMode, (v) => onParam("render", v));
  const marchStepsCtrl = useSlider(volume, "March steps", { min: 1, max: MARCH_STEPS_MAX, step: 1 }, n("marchSteps"), (v) => onParam("marchSteps", v));
  const marchFadeCtrl = useSlider(volume, "March fade", { min: 0, max: 8, step: 0.05 }, n("marchFade"), (v) => onParam("marchFade", v));
  const xrayGainCtrl = useSlider(volume, "Xray gain", { min: 0, max: 16, step: 0.05 }, n("xrayGain"), (v) => onParam("xrayGain", v));
  useEffect(() => {
    marchStepsCtrl?.setVisible(showMarchSteps);
    marchFadeCtrl?.setVisible(renderMode === "carve");
    xrayGainCtrl?.setVisible(renderMode === "xray");
  }, [marchStepsCtrl, marchFadeCtrl, xrayGainCtrl, showMarchSteps, renderMode]);

  const out = useFolder(gui, "Output", { open: true });
  // Subcell GATES Ramp/Chars/density below it (2x4 never reads the ramp — see
  // `subcellIs2x4` above), so it must render as the parent choice, ABOVE the
  // controls it disables. Requested first (before any other `use*` call on
  // `out`) so `useDockSlot`'s insertBefore(…, firstChild) lands it above
  // Ramp. A segmented icon control (reusing the SAME `IconToggle` component
  // and `.gx-toggle`/`.gx-toggle-btn` CSS the voice cards already use for
  // field/wave) instead of a dropdown — "1x1"/"2x4" read as a filled cell vs.
  // a braille dot grid instead of code-ish strings.
  const subcellSlot = useDockSlot(out, { position: "top", className: "dock-subcell-slot" });
  const calibration = useRampCalibration(hostRef);
  // Selecting "Calibrated" before the font-ready measurement lands (rare —
  // `document.fonts.ready` is usually already resolved by the time the Dock
  // is interactive) queues the apply instead of silently no-op'ing.
  const pendingCalibratedRef = useRef(false);
  const selectedRamp = matchRamp(s("glyphs"), calibration.ramp);
  // "Custom" only gets its own swatch once the current ramp is actually
  // custom (typed/edited, not a preset) — otherwise the density row would
  // carry a permanently-empty "Custom" entry.
  const customCoverage = useCustomRampCoverage(hostRef, s("glyphs"));
  const rampNames = useMemo(
    () => (selectedRamp === "Custom" ? [...Object.keys(GlyphRamps), CALIBRATED_RAMP_NAME, "Custom"] : [...Object.keys(GlyphRamps), CALIBRATED_RAMP_NAME]),
    [selectedRamp],
  );
  const coverageByOption = useMemo(
    () => (selectedRamp === "Custom" ? { ...calibration.coverageByOption, Custom: customCoverage } : calibration.coverageByOption),
    [calibration.coverageByOption, selectedRamp, customCoverage],
  );
  const selectRamp = useCallback((name: string) => {
    if (name === CALIBRATED_RAMP_NAME) {
      if (calibration.ramp) onParam("glyphs", calibration.ramp);
      else pendingCalibratedRef.current = true;
      return;
    }
    if (name !== "Custom" && GlyphRamps[name]) onParam("glyphs", GlyphRamps[name]);
  }, [calibration.ramp, onParam]);
  useEffect(() => {
    if (pendingCalibratedRef.current && calibration.ramp) {
      onParam("glyphs", calibration.ramp);
      pendingCalibratedRef.current = false;
    }
  }, [calibration.ramp, onParam]);
  // Created before Ramp so lil-gui appends it directly under the Subcell
  // toggle — the mode's own knob belongs next to the mode, not buried at the
  // bottom of the folder.
  // Created ALWAYS and merely hidden when not in ink: lil-gui appends a
  // controller at creation time, so building it only once ink is selected would
  // append it after the colours. Creating it here — before Ramp — pins it
  // directly under the Subcell toggle, where the mode's own knob belongs.
  const inkLevelsCtrl = useSlider(out, "Ink levels", { min: 1, max: 12, step: 1 }, Number(params.inkLevels ?? 4), (v) => onParam("inkLevels", v));
  // Carve-ink's own knob (VOLUMETRIC-3.md §2's `inkSpacing`, absolute
  // domain-unit contour interval — NOT the 2D ink mode's `inkLevels`, which
  // is a documented no-op under carve-ink and reads the field's own
  // observed value range instead of a domain-unit distance). Bounds mirror
  // `packages/effects/src/stock.ts`'s `inkSpacing` schema entry exactly.
  // Created here, right after Ink levels, so the two occupy the SAME row in
  // the folder and swap in place rather than one appearing above/below a
  // gap — the same mutually-exclusive show/hide-in-place idiom the Volume
  // folder's "March fade"/"Xray gain" pair above already uses for two knobs
  // that only ever apply to one render mode each.
  const inkSpacingCtrl = useSlider(out, "Ink spacing", { min: 0.05, max: 4, step: 0.05 }, Number(params.inkSpacing ?? 0.25), (v) => onParam("inkSpacing", v));
  const rampCtrl = useOption(out, "Ramp", RAMP_OPTS, selectedRamp, selectRamp);
  const rampDensitySlot = useDockSlot(out, { position: "bottom", className: "dock-ramp-density-slot" });
  // `isValid` rejects an empty ramp before it ever reaches `onParam`/the
  // mounted effect layer's `setParams` — fieldSynth's `validateParams` (see
  // `packages/effects/src/stock.ts`, `validateGlyphRamp`) intentionally
  // THROWS on an empty ramp (deliberate authoring-time validation, distinct
  // from `glyphRamp()`'s safe `["?"]` render-time fallback), and this text
  // field is the one path that can hand it an empty string live. Reverts the
  // field to its last non-empty value instead of clearing it.
  const charsCtrl = useText(out, "Chars", s("glyphs"), (v) => onParam("glyphs", v), (next) => next.length > 0);
  // Ramp/Chars/the density row do nothing at 2x4 (see `subcellIs2x4` above) —
  // dim them AND say why, rather than leaving live-looking controls that
  // silently no-op.
  const { showInkLevels, showInkSpacing } = resolveInkControlVisibility(s("subcellRes"), renderMode);
  useEffect(() => {
    // 2x4 DIMS the ramp rows (Contrast/Brightness change meaning there, so the
    // relationship is worth keeping on screen). Ink simply has no ramp concept
    // at all, so its rows are hidden outright rather than left as dead weight.
    if (rampCtrl) { subcellIsInk ? rampCtrl.raw.hide() : rampCtrl.raw.show(); rampCtrl.setEnabled(!ramplessSubcell, { dim: true }); }
    if (charsCtrl) { subcellIsInk ? charsCtrl.raw.hide() : charsCtrl.raw.show(); charsCtrl.setEnabled(!ramplessSubcell, { dim: true }); }
    if (rampDensitySlot) rampDensitySlot.style.display = subcellIsInk ? "none" : "";
    if (inkLevelsCtrl) { showInkLevels ? inkLevelsCtrl.raw.show() : inkLevelsCtrl.raw.hide(); }
    if (inkSpacingCtrl) { showInkSpacing ? inkSpacingCtrl.raw.show() : inkSpacingCtrl.raw.hide(); }
  }, [rampCtrl, charsCtrl, rampDensitySlot, inkLevelsCtrl, inkSpacingCtrl, ramplessSubcell, subcellIsInk, showInkLevels, showInkSpacing]);
  // How many cuts through the amplitude axis to contour — only meaningful in
  // ink, so it appears with the mode rather than sitting inert.
  const voiceColorsOn = params.voiceColors === true;
  const colorStackOn = params.colorStackOn === true;
  const colorMode = s("colorMode") || "gradient";
  // Precedence table (VOLUMETRIC-4.md §1) — see `resolveColorStackVisibility`'s
  // own doc above, shared by this dock and (indirectly, via the same param
  // shape) the sidebar's `ColorStackSection`. Only `showVoiceColorsToggle` is
  // read here now — `showGradientColors`/`showHueControls` used to gate this
  // dock's own Color/Color B/Gradient/Hue* rows, but those rows moved into
  // `ColorStackSection` (the left sidebar) entirely; see the Color/Color
  // B/Gradient block below for the dock's own (simpler) visibility rule.
  const { showVoiceColorsToggle } = resolveColorStackVisibility(colorStackOn, colorMode);
  // `voiceColors` is inert under `render: "xray"` (xray reads only the
  // absorbed density, not per-voice color — VOLUMETRIC-2.md §1) AND while the
  // colour stack is on (its own precedence rule: "voiceColors is ignored" —
  // `showVoiceColorsToggle` above) — hidden in either case rather than left
  // as a live-looking control that silently no-ops, the same duty-only-for-
  // square precedent used elsewhere on this page.
  const voiceColorsCtrl = useToggle(out, "Per-voice colors", voiceColorsOn, (v) => onParam("voiceColors", v));
  useEffect(() => { voiceColorsCtrl?.setVisible(s("render") !== "xray" && showVoiceColorsToggle); }, [voiceColorsCtrl, params.render, showVoiceColorsToggle]);
  const colorCtrl = useColor(out, "Color", s("color"), (v) => onParam("color", v));
  const colorBCtrl = useColor(out, "Color B", s("colorB"), (v) => onParam("colorB", v));
  const gradientCtrl = useSlider(out, "Gradient", { min: 0, max: 1, step: 0.05 }, n("gradient"), (v) => onParam("gradient", v));
  // Color/Color B/Gradient live here ONLY while the colour stack is off —
  // `ColorStackSection` (the left sidebar) owns these same params outright
  // once the stack is on, including under `colorMode: "gradient"` where
  // they're repurposed as its endpoints (VOLUMETRIC-4.md §1's precedence
  // table): a param lives in exactly one visible control, never a second,
  // disconnected copy in both places at once. Hue offset/range/saturation/
  // lightness moved there too and have no row here anymore at all — they're
  // only ever reachable via `colorMode: "hue"`, which only exists while the
  // stack owns the palette, so a Dock row for them would never be visible.
  // Per-voice colors still wins when it's on (the stack being on already
  // forces `voiceColors` inert — hidden above — so this dimming only matters
  // in the stack-off case these controls are now exclusively shown in).
  useEffect(() => {
    colorCtrl?.setVisible(!colorStackOn); colorCtrl?.setEnabled(!voiceColorsOn);
    colorBCtrl?.setVisible(!colorStackOn); colorBCtrl?.setEnabled(!voiceColorsOn);
    gradientCtrl?.setVisible(!colorStackOn); gradientCtrl?.setEnabled(!voiceColorsOn);
  }, [colorCtrl, colorBCtrl, gradientCtrl, voiceColorsOn, colorStackOn]);
  // `colorTolerance` (COLOR-TOLERANCE.md Phase 4) replaces the removed
  // `colorQuantize`: it's a SCENE option (`scene.setOptions({ colorTolerance
  // })`, wired through the `colorTolerance`/`onColorTolerance` props below),
  // not a field-synth param — the shared cross-mode run-extension merge
  // tolerance (`colorRunExtends`, packages/glyphcss/src/render/cells.ts)
  // rather than anything `resolveFieldSynthColor` computes, so it lives
  // outside `params`/`onParam` the same way `density` does. Never hidden,
  // same rationale as the removed row: it acts on whatever colour path is
  // active, not one specific mode. Redmean's full range is 0..765
  // (black<->white is 764.83 — COLOR-TOLERANCE.md), but the useful range
  // saturates almost immediately: live-tested at density 3.5 on the Menger
  // preset, tolerance 32 already reaches 25.2 of the 28.8 fps ceiling
  // (bench/color-tolerance.md's live-FPS table) — going 32 -> 256 cuts spans
  // ~10x further for only 3.6 more fps, and both 128 and 256 visibly degrade
  // color fidelity on real presets. The slider is capped at 96 (default 32)
  // so the whole useful range is reachable instead of three quarters of the
  // travel sitting on settings nobody wants; the underlying scene option
  // itself stays unbounded (including +Infinity) — this is a UI range only,
  // set with `setOptions({ colorTolerance: … })` above 96 still works and
  // still round-trips through the URL's "c" token.
  useSlider(out, "Color tolerance", { min: 0, max: 96, step: 1 }, colorTolerance, onColorTolerance);

  const light = useFolder(gui, "Lighting", { open: false });
  useSlider(light, "Amount", { min: 0, max: 1, step: 0.05 }, n("lit"), (v) => onParam("lit", v));
  useSlider(light, "Azimuth", { min: 0, max: 360, step: 1 }, lighting.azimuth, (v) => onLight({ azimuth: v }));
  useSlider(light, "Elevation", { min: 0, max: 90, step: 1 }, lighting.elevation, (v) => onLight({ elevation: v }));
  useSlider(light, "Key", { min: 0, max: 2, step: 0.05 }, lighting.keyIntensity, (v) => onLight({ keyIntensity: v }));
  useColor(light, "Key color", lighting.keyColor, (v) => onLight({ keyColor: v }));
  useSlider(light, "Ambient", { min: 0, max: 1, step: 0.05 }, lighting.ambient, (v) => onLight({ ambient: v }));

  return (
    <>
      {scopeHost && createPortal(<SynthScope paramsRef={paramsRef} tsRef={tsRef} pausedRef={pausedRef} />, scopeHost)}
      {scaleSlot && createPortal(
        <LogSliderRow
          label="Scale"
          title="Pattern scale — a multiplier on the sampled domain, so its effect is per RATIO, not per unit. The dial is logarithmic: equal travel per doubling."
          value={n("scale")}
          min={SCALE_MIN}
          max={SCALE_MAX}
          onChange={(v) => onParam("scale", v)}
        />,
        scaleSlot,
      )}
      {subcellSlot && createPortal(
        <div className="dock-subcell">
          <span className="dock-subcell-label">Subcell</span>
          <IconToggle
            groupTitle="Subcell — cell resolution. 1x1 picks one glyph per cell from the Ramp below; 2x4 renders a synthesized braille dot matrix per cell instead and ignores the ramp entirely."
            options={SUBCELL_TOGGLE}
            value={s("subcellRes")}
            onChange={(v) => onParam("subcellRes", v)}
          />
        </div>,
        subcellSlot,
      )}
      {rampDensitySlot && createPortal(
        <RampDensityRow
          names={rampNames}
          coverageByOption={coverageByOption}
          selected={selectedRamp}
          onSelect={selectRamp}
          disabledReason={subcellIs2x4
            ? "Subcell = 2x4 renders a Braille dot pattern, not the ramp — Ramp/Chars have no effect. Contrast/Brightness set the dot threshold instead."
            : undefined}
        />,
        rampDensitySlot,
      )}
    </>
  );
}

