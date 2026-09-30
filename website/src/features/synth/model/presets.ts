import type { GlyphEffectPreset } from "@glyphcss/effects";
import {
  GlyphBreathingGyroidPreset,
  GlyphCssGraphicsMengerPreset,
  GlyphCubeTilesPreset,
  GlyphSierpinskiPyramidPreset,
} from "@glyphcss/effects";
import { type Params } from "./parameters";

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
