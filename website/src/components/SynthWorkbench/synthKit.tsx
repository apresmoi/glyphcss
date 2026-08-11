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
  type GlyphSceneHandle,
} from "glyphcss";
import {
  GlyphFieldSynthEffect as fieldSynth,
  buildGlyphFieldSynthStaticExport,
  calibrateGlyphRamp,
  combineSynth,
  defaultGlyphEffectParams,
  GlyphRamps,
  measureGlyphInkCoverage,
  synthWave,
} from "@glyphcss/effects";
import type { GlyphEffectPreset, GlyphFieldSynthStaticExportResult } from "@glyphcss/effects";
import { Dock } from "../Dock";
import { useDockGui } from "../Dock/slots";
import { useColor, useDockSlot, useFolder, useOption, useSlider, useText, useToggle } from "../Dock/primitives";


import type { Lighting } from "./synthUrlState";
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

export const MAX_VOICES = 6;
export const FIELDS = ["radial", "linearX", "linearY", "diagonal", "angular", "spiral", "noise"] as const;
export const WAVES = ["sin", "triangle", "saw", "square"] as const;
export const COMBINES = ["add", "multiply", "max", "min", "difference"] as const;
export const SPACES = ["auto", "surface", "scene"] as const;
export const SUBCELL_RES = ["1x1", "2x4"] as const;
export const SHAPES: string[] = ["plane", "cube", "sphere", "icosahedron", "dodecahedron", "octahedron", "cylinder", "cone", "torus", "tetrahedron"];

export const opts = <T extends string>(list: readonly T[] | string[]): Record<string, T> => Object.fromEntries(list.map((v) => [v, v])) as Record<string, T>;
export const SHAPE_OPTS = opts(SHAPES), COMBINE_OPTS = opts(COMBINES), SPACE_OPTS = opts(SPACES);
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
};

export const FIELD_ICONS: Record<string, ReactNode> = {
  radial: (
    <ToggleIcon strokeWidth={1.3}>
      <circle cx="8" cy="8" r="2" />
      <circle cx="8" cy="8" r="4.3" />
      <circle cx="8" cy="8" r="6.5" />
    </ToggleIcon>
  ),
  linearX: <ToggleIcon><path d="M2 8 H12 M9 5 L12 8 L9 11" /></ToggleIcon>,
  linearY: <ToggleIcon><path d="M8 2 V12 M5 9 L8 12 L11 9" /></ToggleIcon>,
  diagonal: <ToggleIcon><path d="M3 3 L13 13 M9 13 H13 V9" /></ToggleIcon>,
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
};
// Short, concrete per-option hover copy — each button's `title` names the
// shape AND says what it does, so a voice card is self-explanatory without
// leaving the page (see `AGENTS.md`'s field-synth section for the source
// semantics: `fieldN` is the spatial domain, `waveN` is the oscillator shape
// sampled across it).
export const FIELD_DESCRIPTIONS: Record<string, string> = {
  radial: "distance from a center point — concentric rings",
  linearX: "sweeps left to right across the field",
  linearY: "sweeps bottom to top across the field",
  diagonal: "sweeps along the diagonal",
  angular: "angle around a center point — rotational bands",
  spiral: "winds outward from a center point",
  noise: "randomized, non-repeating — no directional structure",
};
export const WAVE_DESCRIPTIONS: Record<string, string> = {
  sin: "smooth, rounded oscillation",
  triangle: "linear ramp up, then down",
  saw: "linear ramp up, then a hard snap back down",
  square: "hard on/off, no ramp",
};
export const FIELD_TOGGLE = FIELDS.map((v) => ({ value: v as string, icon: FIELD_ICONS[v], label: v, desc: FIELD_DESCRIPTIONS[v] }));
export const WAVE_TOGGLE = WAVES.map((v) => ({ value: v as string, icon: WAVE_ICONS[v], label: v, desc: WAVE_DESCRIPTIONS[v] }));

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
};
export const SUBCELL_TOGGLE = SUBCELL_RES.map((v) => ({
  value: v as string,
  icon: SUBCELL_ICONS[v],
  label: v,
  desc: v === "1x1" ? "one glyph per cell, picked from the ramp" : "braille dot matrix per cell — finer apparent grain, ignores the ramp",
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
export function shapePolys(name: string): Polys {
  return name === "plane" ? flatQuad(3) : withFaceUvs(resolveGeometry(name as GlyphGeometryName, { size: 3 }));
}
export const isFlat = (name: string) => name === "plane";

// Frame the object by setting the camera zoom so its projected bbox fills ~`fill`
// of the grid. MUST project with the same MEASURED cell metrics the renderer uses
// (`metrics`), else the default cell (BASE_TILE/cellAspect) is ~4× off and the zoom
// massively overshoots. Call after a render so the <pre> reflects the real cell.
// `cover`: fit the SMALLER axis exactly at `fill` and overscan the larger one
// (like CSS `background-size: cover`) instead of the default `contain` behaviour
// (fit the LARGER axis, margin on the smaller one). Used for the fullscreen plane
// so its texture reaches every edge of a non-square viewport instead of framing
// with letterbox bars.
export function frameObject(scene: GlyphSceneHandle, camera: { zoom: number; project: (v: [number, number, number], c: number, r: number, a: number, m?: unknown) => number[] }, polys: Polys, fill = 0.72, cover = false): void {
  const o = scene.getOptions();
  const pre = scene.host.querySelector("pre.glyph-output") as HTMLElement | null;
  let metrics: { cellWidth: number; cellHeight: number } | undefined;
  if (pre) {
    const r = pre.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) metrics = { cellWidth: r.width / o.cols, cellHeight: r.height / o.rows };
  }
  camera.zoom = 1;
  let minc = Infinity, maxc = -Infinity, minr = Infinity, maxr = -Infinity;
  for (const p of polys) for (const v of p.vertices) {
    const pr = camera.project(v as [number, number, number], o.cols, o.rows, o.cellAspect, metrics);
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
  base.freq1 = params[`freq${slot}`]; base.speed1 = params[`speed${slot}`]; base.amp1 = 1;
  base.space = params.space; base.scale = params.scale; base.glyphs = params.glyphs;
  base.voiceColors = params.voiceColors === true;
  base.color1 = params[`color${slot}`];
  base.color = params.color; base.colorB = params.colorB; base.gradient = params.gradient;
  base.gain = 1; base.bias = 0.5;
  return base;
}

// Small live preview on a FLAT square, viewed head-on (a plain 2D read of the field).
// `onTick` (if given) fires every frame alongside the layer's own time update, with
// the SAME `t` — so a waveform trendline drawn from it stays exactly in sync with
// what the adjacent preview square renders, using this loop instead of a second one.
export function useSynthPreview(host: HTMLElement | null, getParams: () => Params, deps: unknown[], onTick?: (t: number) => void): void {
  const layerRef = useRef<{ setParams: (p: Params) => void; dispose: () => void } | null>(null);
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  useEffect(() => {
    if (!host) return;
    injectGlyphBaseStyles(host.ownerDocument ?? undefined);
    const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 20 });
    const scene = createGlyphScene(host, { camera, autoSize: true, mode: "solid", useColors: true, glyphPalette: "default", doubleSided: true, directionalLight: LIGHT, ambientLight: AMBIENT });
    host.style.fontSize = "8px";
    const polys = flatQuad(3);
    scene.add(polys); scene.fit(); scene.rerender();
    frameObject(scene, camera, polys, 0.98);
    const layer = scene.addEffectLayer({ effect: fieldSynth, params: getParams(), blend: SYNTH_EFFECT_BLEND, target: "surfaces" });
    layerRef.current = layer as unknown as { setParams: (p: Params) => void; dispose: () => void };
    scene.rerender();
    let last = performance.now(), t = 0, raf = 0;
    const tick = (now: number): void => { raf = requestAnimationFrame(tick); const dt = Math.min((now - last) / 1000, 0.1); last = now; t += dt * 0.8; layerRef.current?.setParams({ time: t }); onTickRef.current?.(t); };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); layer.dispose(); scene.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);
  useEffect(() => { layerRef.current?.setParams(getParams()); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ── Waveform trendlines (per-voice + combined) ────────────────────────────────
// Read the voice params as a literal 1D read of the same shape+phase math the
// field synth evaluates spatially: `raw*freq - time*speed` fed through
// `synthWave`, with `raw` swept 0..1 across the plot (a "linearX"-style read —
// `field` itself only has meaning in 2D, so it isn't part of this projection).
export const WAVE_SAMPLES = 72;

export function buildWavePathD(wave: string, freq: number, speed: number, amp: number, time: number, width: number, height: number): string {
  const midY = height / 2;
  const halfH = midY - 2;
  let d = "";
  for (let i = 0; i < WAVE_SAMPLES; i++) {
    const raw = i / (WAVE_SAMPLES - 1);
    const value = amp * synthWave(wave, raw * freq - time * speed);
    const x = raw * width;
    const y = midY - value * halfH;
    d += `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)} `;
  }
  return d;
}

export interface CombinedVoice { readonly wave: string; readonly freq: number; readonly speed: number; readonly amp: number; }

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
      const o = synthWave(voice.wave, raw * voice.freq - time * voice.speed);
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
  const voicePathRefs = useRef<(SVGPathElement | null)[]>([null, null, null, null, null, null]);
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
        const voice: CombinedVoice = { wave: String(p[`wave${slot}`]), freq: Number(p[`freq${slot}`]), speed: Number(p[`speed${slot}`]), amp };
        active.push(voice);
        if (path) {
          path.setAttribute("d", buildWavePathD(voice.wave, voice.freq, voice.speed, voice.amp, t, width, height));
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
        {[0, 1, 2, 3, 4, 5].map((k) => (
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
export const freqFromSlider = (pos: number, max: number): number => {
  const v = max * Math.pow(Math.min(1, Math.max(0, pos)), FREQ_TAPER);
  // Finer quantization down low, where the taper hands you the resolution: a
  // flat 0.1 step would throw that resolution away exactly where it was bought.
  return v < 2 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10;
};
export const freqToSlider = (value: number, max: number): number =>
  Math.pow(Math.min(1, Math.max(0, value / max)), 1 / FREQ_TAPER);

export function VoiceCard({ slot, index, params, onParam, onRemove, onHover }: {
  slot: number; index: number; params: Params;
  onParam: (key: string, value: ParamValue) => void; onRemove: () => void;
  /** Fires this card's slot while the pointer is on it (and null when it
   *  leaves), so a host can highlight that voice's contribution in the render.
   *  Optional — /synth doesn't use it. Pointer-over covers dragging too, since
   *  the pointer stays on the card for the whole drag. */
  onHover?: (slot: number | null) => void;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const f = (k: string) => String(params[`${k}${slot}`]);
  const num = (k: string) => Number(params[`${k}${slot}`]);
  // Always-fresh ref (not a dep) — the trendline reads it from inside the
  // preview's own rAF tick, which must stay mounted across param changes.
  const trendRef = useRef({ wave: f("wave"), freq: num("freq"), speed: num("speed"), amp: num("amp") });
  trendRef.current = { wave: f("wave"), freq: num("freq"), speed: num("speed"), amp: num("amp") };
  const pathRef = useRef<SVGPathElement | null>(null);
  const onTick = useCallback((t: number) => {
    const path = pathRef.current;
    if (!path) return;
    const v = trendRef.current;
    path.setAttribute("d", buildWavePathD(v.wave, v.freq, v.speed, v.amp, t, 100, 30));
  }, []);
  useSynthPreview(host, () => soloParams(params, slot), [params[`field${slot}`], params[`wave${slot}`], params[`freq${slot}`], params[`speed${slot}`], params[`color${slot}`], params.voiceColors, params.space, params.scale, params.color, params.colorB, params.gradient, params.glyphs, host], onTick);
  const fill = (v: number, min: number, max: number) => ({ ["--fill" as string]: `${((v - min) / (max - min)) * 100}%` } as CSSProperties);
  return (
    <div className="voice-card" onPointerEnter={() => onHover?.(slot)} onPointerLeave={() => onHover?.(null)}>
      <div className="voice-left">
        <svg className="voice-trend" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1="15" x2="100" y2="15" className="voice-trend-mid" />
          <path ref={pathRef} className="voice-trend-line" style={{ stroke: f("color") }} vectorEffect="non-scaling-stroke" fill="none" />
        </svg>
        <span className="voice-preview" ref={setHost} />
      </div>
      <div className="voice-controls">
        <div className="voice-head">
          <span className="voice-title">Voice {index + 1}</span>
          <span className="voice-head-right">
            <input type="color" className="voice-color" value={f("color")} onChange={(e) => onParam(`color${slot}`, e.target.value)} title="Voice color" />
            <button className="voice-remove" onClick={onRemove} title="Remove voice">×</button>
          </span>
        </div>
        <IconToggle groupTitle="Wave — the oscillator shape sampled across this voice's field (hover a button for its shape)" options={WAVE_TOGGLE} value={f("wave")} onChange={(v) => onParam(`wave${slot}`, v)} />
        <IconToggle groupTitle="Field — how this voice's value varies spatially across the surface (hover a button for its shape)" options={FIELD_TOGGLE} value={f("field")} onChange={(v) => onParam(`field${slot}`, v)} />
        <label className="voice-slider" title="Freq — spatial frequency: how many oscillation cycles this voice packs across the surface. Higher = tighter, more repetitions. The dial is tapered, so the low end where patterns actually live gets most of the travel."><span>freq</span><span className="voice-slider-track"><input type="range" min={0} max={1} step={0.001} value={freqToSlider(num("freq"), 24)} style={fill(freqToSlider(num("freq"), 24), 0, 1)} onChange={(e) => onParam(`freq${slot}`, freqFromSlider(+e.target.value, 24))} /></span><b>{num("freq") < 2 ? num("freq").toFixed(2) : num("freq").toFixed(1)}</b></label>
        <label className="voice-slider" title="Speed — how fast this voice's phase animates over time. Negative reverses the direction of travel."><span>speed</span><span className="voice-slider-track"><input type="range" min={-8} max={8} step={0.05} value={num("speed")} style={fill(num("speed"), -8, 8)} onChange={(e) => onParam(`speed${slot}`, +e.target.value)} /></span><b>{num("speed").toFixed(2)}</b></label>
        <label className="voice-slider" title="Mix — a MIX WEIGHT, not a volume: blends the running result toward combine(result, this voice) by this amount. 0 skips the voice entirely; a low value still shows up gently instead of a mode like multiply collapsing the whole field to flat."><span>mix</span><span className="voice-slider-track"><input type="range" min={0} max={1} step={0.02} value={num("amp")} style={fill(num("amp"), 0, 1)} onChange={(e) => onParam(`amp${slot}`, +e.target.value)} /></span><b>{num("amp").toFixed(2)}</b></label>
      </div>
    </div>
  );
}

// ── Live preset tile (flat square) ────────────────────────────────────────────
export function PresetTile({ preset, onApply }: { preset: GlyphEffectPreset<never>; onApply: () => void }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useSynthPreview(host, () => ({ ...synthDefaults(), ...(preset.params as Params) }), [host]);
  return (
    <button className="synth-tile" onClick={onApply} title={`Apply “${preset.name}”`}>
      <span className="synth-tile-scene" ref={setHost} />
      <span className="synth-tile-label">{preset.name}</span>
    </button>
  );
}

// ── Right dock controls (stage / mix / output) ────────────────────────────────
export function SynthDock({ shape, onShape, timeScale, onTimeScale, paused, onPaused, density, onDensity, lighting, onLight, params, onParam, paramsRef, tsRef, pausedRef, hostRef }: {
  shape: string; onShape: (s: string) => void;
  timeScale: number; onTimeScale: (n: number) => void; paused: boolean; onPaused: (b: boolean) => void;
  density: number; onDensity: (n: number) => void;
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

  const stage = useFolder(gui, "Stage", { open: true });
  useOption(stage, "Shape", SHAPE_OPTS, shape, (v) => onShape(v));
  useOption(stage, "Mapping", SPACE_OPTS, s("space"), (v) => onParam("space", v));
  useSlider(stage, "Density", { min: 0.5, max: 4, step: 0.1 }, density, onDensity);
  useSlider(stage, "Speed", { min: 0.05, max: 8, step: 0.05 }, timeScale, onTimeScale);
  useToggle(stage, "Paused", paused, onPaused);

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
  useSlider(mix, "Scale", { min: 0.1, max: 12, step: 0.1 }, n("scale"), (v) => onParam("scale", v));
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
  useEffect(() => {
    rampCtrl?.setEnabled(!subcellIs2x4, { dim: true });
    charsCtrl?.setEnabled(!subcellIs2x4, { dim: true });
  }, [rampCtrl, charsCtrl, subcellIs2x4]);
  const voiceColorsOn = params.voiceColors === true;
  useToggle(out, "Per-voice colors", voiceColorsOn, (v) => onParam("voiceColors", v));
  const colorCtrl = useColor(out, "Color", s("color"), (v) => onParam("color", v));
  const colorBCtrl = useColor(out, "Color B", s("colorB"), (v) => onParam("colorB", v));
  const gradientCtrl = useSlider(out, "Gradient", { min: 0, max: 1, step: 0.05 }, n("gradient"), (v) => onParam("gradient", v));
  // Color/Color B/Gradient only drive output when per-voice colors is OFF — each
  // voice's own color wins over them once it's on (see `fieldSynth`'s evaluate()).
  // Grey them out via the same `DockController.setEnabled` every Dock primitive
  // already exposes, rather than adding a bespoke disabled prop.
  useEffect(() => {
    colorCtrl?.setEnabled(!voiceColorsOn);
    colorBCtrl?.setEnabled(!voiceColorsOn);
    gradientCtrl?.setEnabled(!voiceColorsOn);
  }, [colorCtrl, colorBCtrl, gradientCtrl, voiceColorsOn]);

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
          disabledReason={subcellIs2x4 ? "Subcell = 2x4 renders a Braille dot pattern, not the ramp — Ramp/Chars have no effect. Contrast/Brightness set the dot threshold instead." : undefined}
        />,
        rampDensitySlot,
      )}
    </>
  );
}

