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
  combineSynth,
  defaultGlyphEffectParams,
  GlyphRamps,
  synthWave,
} from "@glyphcss/effects";
import type { GlyphEffectPreset, GlyphFieldSynthStaticExportResult } from "@glyphcss/effects";
import { Dock } from "../Dock";
import { useDockGui } from "../Dock/slots";
import { useColor, useDockSlot, useFolder, useOption, useSlider, useText, useToggle } from "../Dock/primitives";
import { SynthCodePanel } from "./SynthCodePanel";
import type { SynthSnippetInput } from "./synthSnippets";
import "../GalleryWorkbench/gallery-workbench.css";
import "./synth-workbench.css";

// The ONE blend both `scene.addEffectLayer()` calls below mount the layer
// with. The static export must read the layer's REAL blend rather than the
// effect definition's own `defaultBlend` metadata (see
// `GlyphFieldSynthStaticExportOptions.blend` doc) — sharing this constant
// keeps the exported pen from silently drifting off whatever the live scene
// actually renders with.
const SYNTH_EFFECT_BLEND: GlyphEffectBlend = "replace";

type ParamValue = number | string | boolean;
type Params = Record<string, ParamValue>;
type Polys = ReturnType<typeof resolveGeometry>;

const MAX_VOICES = 6;
const FIELDS = ["radial", "linearX", "linearY", "diagonal", "angular", "spiral", "noise"] as const;
const WAVES = ["sin", "triangle", "saw", "square"] as const;
const COMBINES = ["add", "multiply", "max", "min", "difference"] as const;
const SPACES = ["auto", "surface", "scene"] as const;
const SHAPES: string[] = ["plane", "cube", "sphere", "icosahedron", "dodecahedron", "octahedron", "cylinder", "cone", "torus", "tetrahedron"];

const opts = <T extends string>(list: readonly T[] | string[]): Record<string, T> => Object.fromEntries(list.map((v) => [v, v])) as Record<string, T>;
const SHAPE_OPTS = opts(SHAPES), COMBINE_OPTS = opts(COMBINES), SPACE_OPTS = opts(SPACES);
const RAMP_OPTS: Record<string, string> = { ...Object.fromEntries(Object.keys(GlyphRamps).map((k) => [k, k])), Custom: "Custom" };
const matchRamp = (glyphs: string): string => Object.entries(GlyphRamps).find(([, v]) => v === glyphs)?.[0] ?? "Custom";

// Inline SVG icons for the field/wave multi-toggles (segmented control, like
// text-align). `stroke`/`fill: currentColor` so each icon inherits the button's
// text color for free — dim when inactive, cyan when `.is-active` (see
// `.gx-toggle-btn` / `.gx-toggle-btn.is-active` in synth-workbench.css).
function ToggleIcon({ children, ...rest }: SVGProps<SVGSVGElement>) {
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
const WAVE_ICONS: Record<string, ReactNode> = {
  sin: <ToggleIcon><path d="M2 8 C4 2 6 2 8 8 C10 14 12 14 14 8" /></ToggleIcon>,
  triangle: <ToggleIcon><path d="M2 12 L5 4 L8 12 L11 4 L14 12" /></ToggleIcon>,
  saw: <ToggleIcon strokeLinecap="square" strokeLinejoin="miter"><path d="M2 13 L8 3 L8 13 L14 3" /></ToggleIcon>,
  square: <ToggleIcon strokeWidth={1.4} strokeLinecap="square" strokeLinejoin="miter"><path d="M2 6 H6 V11 H10 V6 H14" /></ToggleIcon>,
};

const FIELD_ICONS: Record<string, ReactNode> = {
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
const FIELD_TOGGLE = FIELDS.map((v) => ({ value: v as string, icon: FIELD_ICONS[v], title: v }));
const WAVE_TOGGLE = WAVES.map((v) => ({ value: v as string, icon: WAVE_ICONS[v], title: v }));

function IconToggle({ options, value, onChange }: { options: { value: string; icon: ReactNode; title: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="gx-toggle" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" className={`gx-toggle-btn${o.value === value ? " is-active" : ""}`} title={o.title} aria-label={o.title} onClick={() => onChange(o.value)}>{o.icon}</button>
      ))}
    </div>
  );
}

const LIGHT = { direction: [-0.4, -0.6, -0.5] as [number, number, number], intensity: 1.05 };
const AMBIENT = { intensity: 0.6 };

interface Lighting { azimuth: number; elevation: number; keyIntensity: number; keyColor: string; ambient: number; }
const DEFAULT_LIGHTING: Lighting = { azimuth: 40, elevation: 38, keyIntensity: 1.1, keyColor: "#ffffff", ambient: 0.5 };
function buildLighting(l: Lighting): { directionalLight: { direction: [number, number, number]; intensity: number; color: string }; ambientLight: { intensity: number } } {
  const a = (l.azimuth * Math.PI) / 180, e = (l.elevation * Math.PI) / 180;
  return {
    directionalLight: { direction: [Math.cos(e) * Math.cos(a), Math.cos(e) * Math.sin(a), Math.sin(e)], intensity: l.keyIntensity, color: l.keyColor },
    ambientLight: { intensity: l.ambient },
  };
}

function synthDefaults(): Params {
  const { time: _time, ...rest } = defaultGlyphEffectParams(fieldSynth) as Params;
  return rest;
}

// A flat square in the world XY plane with 0..1 UVs — a clean 2D surface for
// previews and the scene-filling "plane" shape.
function flatQuad(size: number): Polys {
  const p = {
    vertices: [[-size, -size, 0], [size, -size, 0], [size, size, 0], [-size, size, 0]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
  };
  return [p] as unknown as Polys;
}
// Give each face its own local 0..1 UV (project onto the face plane, normalize to
// the face's bbox) so surface effects map PER-FACE — each face reads like its own
// plane, patterns centre on it — instead of a world-continuous wrap.
type V3 = [number, number, number];
const vsub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vcross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vdot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const vnorm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function withFaceUvs(polys: Polys): Polys {
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
function shapePolys(name: string): Polys {
  return name === "plane" ? flatQuad(3) : withFaceUvs(resolveGeometry(name as GlyphGeometryName, { size: 3 }));
}
const isFlat = (name: string) => name === "plane";

// Frame the object by setting the camera zoom so its projected bbox fills ~`fill`
// of the grid. MUST project with the same MEASURED cell metrics the renderer uses
// (`metrics`), else the default cell (BASE_TILE/cellAspect) is ~4× off and the zoom
// massively overshoots. Call after a render so the <pre> reflects the real cell.
// `cover`: fit the SMALLER axis exactly at `fill` and overscan the larger one
// (like CSS `background-size: cover`) instead of the default `contain` behaviour
// (fit the LARGER axis, margin on the smaller one). Used for the fullscreen plane
// so its texture reaches every edge of a non-square viewport instead of framing
// with letterbox bars.
function frameObject(scene: GlyphSceneHandle, camera: { zoom: number; project: (v: [number, number, number], c: number, r: number, a: number, m?: unknown) => number[] }, polys: Polys, fill = 0.72, cover = false): void {
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
function soloParams(params: Params, slot: number): Params {
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
function useSynthPreview(host: HTMLElement | null, getParams: () => Params, deps: unknown[], onTick?: (t: number) => void): void {
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
const WAVE_SAMPLES = 72;

function buildWavePathD(wave: string, freq: number, speed: number, amp: number, time: number, width: number, height: number): string {
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

interface CombinedVoice { readonly wave: string; readonly freq: number; readonly speed: number; readonly amp: number; }

// Folds active voices exactly like `fieldSynth`'s evaluate loop: each oscillator
// samples at amp=1 (`synthOsc`'s own amp is fixed to 1 there), the first active
// voice enters at its mix weight, and every later voice blends the running result
// toward `combineSynth(mode, result, voice)` by its weight — so two close
// frequencies visibly beat instead of just averaging out.
function buildCombinedPathD(voices: readonly CombinedVoice[], combineMode: string, time: number, width: number, height: number): string {
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
function SynthScope({ paramsRef, tsRef, pausedRef }: {
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
function VoiceCard({ slot, index, params, onParam, onRemove }: {
  slot: number; index: number; params: Params;
  onParam: (key: string, value: ParamValue) => void; onRemove: () => void;
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
    <div className="voice-card">
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
        <IconToggle options={WAVE_TOGGLE} value={f("wave")} onChange={(v) => onParam(`wave${slot}`, v)} />
        <IconToggle options={FIELD_TOGGLE} value={f("field")} onChange={(v) => onParam(`field${slot}`, v)} />
        <label className="voice-slider"><span>freq</span><span className="voice-slider-track"><input type="range" min={0} max={24} step={0.1} value={num("freq")} style={fill(num("freq"), 0, 24)} onChange={(e) => onParam(`freq${slot}`, +e.target.value)} /></span><b>{num("freq").toFixed(1)}</b></label>
        <label className="voice-slider"><span>speed</span><span className="voice-slider-track"><input type="range" min={-8} max={8} step={0.05} value={num("speed")} style={fill(num("speed"), -8, 8)} onChange={(e) => onParam(`speed${slot}`, +e.target.value)} /></span><b>{num("speed").toFixed(2)}</b></label>
        <label className="voice-slider"><span>mix</span><span className="voice-slider-track"><input type="range" min={0} max={1} step={0.02} value={num("amp")} style={fill(num("amp"), 0, 1)} onChange={(e) => onParam(`amp${slot}`, +e.target.value)} /></span><b>{num("amp").toFixed(2)}</b></label>
      </div>
    </div>
  );
}

// ── Live preset tile (flat square) ────────────────────────────────────────────
function PresetTile({ preset, onApply }: { preset: GlyphEffectPreset<never>; onApply: () => void }) {
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
function SynthDock({ shape, onShape, timeScale, onTimeScale, paused, onPaused, density, onDensity, lighting, onLight, params, onParam, paramsRef, tsRef, pausedRef }: {
  shape: string; onShape: (s: string) => void;
  timeScale: number; onTimeScale: (n: number) => void; paused: boolean; onPaused: (b: boolean) => void;
  density: number; onDensity: (n: number) => void;
  lighting: Lighting; onLight: (partial: Partial<Lighting>) => void;
  params: Params; onParam: (key: string, value: ParamValue) => void;
  paramsRef: { current: Params }; tsRef: { current: number }; pausedRef: { current: boolean };
}): ReactNode {
  const gui = useDockGui();
  const s = (k: string) => String(params[k] ?? "");
  const n = (k: string) => Number(params[k] ?? 0);

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
  useOption(mix, "Combine", COMBINE_OPTS, s("combine"), (v) => onParam("combine", v));
  useSlider(mix, "Scale", { min: 0.1, max: 12, step: 0.1 }, n("scale"), (v) => onParam("scale", v));
  useSlider(mix, "Origin U", { min: 0, max: 1, step: 0.01 }, n("originU"), (v) => onParam("originU", v));
  useSlider(mix, "Origin V", { min: 0, max: 1, step: 0.01 }, n("originV"), (v) => onParam("originV", v));
  useSlider(mix, "Contrast", { min: 0, max: 4, step: 0.05 }, n("gain"), (v) => onParam("gain", v));
  useSlider(mix, "Brightness", { min: -1, max: 2, step: 0.05 }, n("bias"), (v) => onParam("bias", v));

  const out = useFolder(gui, "Output", { open: true });
  useOption(out, "Ramp", RAMP_OPTS, matchRamp(s("glyphs")), (name) => { if (name !== "Custom" && GlyphRamps[name]) onParam("glyphs", GlyphRamps[name]); });
  useText(out, "Chars", s("glyphs"), (v) => onParam("glyphs", v));
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

  return scopeHost ? createPortal(<SynthScope paramsRef={paramsRef} tsRef={tsRef} pausedRef={pausedRef} />, scopeHost) : null;
}

// ── URL persistence (everything the synth is configured to, in ?s=) ───────────
function encodeSynthState(state: unknown): string {
  try { return btoa(unescape(encodeURIComponent(JSON.stringify(state)))).replace(/=+$/, ""); } catch { return ""; }
}
function decodeSynthState(s: string): Record<string, unknown> | null {
  try { return JSON.parse(decodeURIComponent(escape(atob(s)))) as Record<string, unknown>; } catch { return null; }
}
function readSynthUrl(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  const s = new URLSearchParams(window.location.search).get("s");
  return s ? decodeSynthState(s) : null;
}
function slotsFromParams(p: Params): number[] {
  return Array.from({ length: MAX_VOICES }, (_, i) => i + 1).filter((k) => Number(p[`amp${k}`]) > 0);
}

// ── Workbench ────────────────────────────────────────────────────────────────
export default function SynthWorkbench() {
  const initial = useMemo(() => readSynthUrl(), []);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<GlyphSceneHandle | null>(null);
  const cameraRef = useRef<ReturnType<typeof createGlyphOrthographicCamera> | null>(null);
  const layerRef = useRef<{ setParams: (p: Params) => void; dispose: () => void } | null>(null);
  const meshRef = useRef<{ dispose: () => void } | null>(null);

  const [shape, setShape] = useState<string>((initial?.sh as string) ?? "plane");
  const [params, setParams] = useState<Params>(() => ({ ...synthDefaults(), voiceColors: true, ...((initial?.p as Params) ?? {}) }));
  const [timeScale, setTimeScale] = useState((initial?.ts as number) ?? 1.4);
  const [paused, setPaused] = useState(false);
  const [density, setDensity] = useState((initial?.d as number) ?? 1);
  const [lighting, setLighting] = useState<Lighting>(() => ({ ...DEFAULT_LIGHTING, ...((initial?.l as Partial<Lighting>) ?? {}) }));
  const lightingRef = useRef(lighting); lightingRef.current = lighting;

  // Mobile-only: which panel is open as a bottom drawer (null = viewport only).
  // Mirrors the gallery's `mobilePanel` pattern (same tab-bar/drawer mechanism,
  // same 760px breakpoint) so the two pages feel consistent on small screens.
  const [mobilePanel, setMobilePanel] = useState<"voices" | "controls" | "presets" | "export" | null>(null);
  useEffect(() => {
    if (!mobilePanel) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobilePanel(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobilePanel]);

  const paramsRef = useRef(params); paramsRef.current = params;
  const tsRef = useRef(timeScale); tsRef.current = timeScale;
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const densityRef = useRef(density); densityRef.current = density;

  // Build (or rebuild) the whole scene for the current shape. A fresh scene is the
  // reliable way to give the effect layer the new geometry's retained coverage —
  // swapping the mesh under a mounted layer leaves it with the old surface's fill.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    injectGlyphBaseStyles(host.ownerDocument ?? undefined);
    const flat = isFlat(shape);
    const camera = createGlyphOrthographicCamera({ rotX: flat ? 0 : 58, rotY: flat ? 0 : 32, zoom: 46 });
    const scene = createGlyphScene(host, { camera, autoSize: true, mode: "solid", useColors: true, glyphPalette: "default", doubleSided: flat, interactiveDownscale: 1, ...buildLighting(lightingRef.current) });
    host.style.fontSize = `${13 / densityRef.current}px`;
    // The plane is a fullscreen-shader-style backdrop: camera stays locked head-on,
    // so no orbit controls for it. Every other shape keeps orbit exactly as before.
    if (!flat) createGlyphOrbitControls(scene, { drag: true, wheel: true });
    const polys = shapePolys(shape);
    meshRef.current = scene.add(polys) as { dispose: () => void };
    scene.fit();
    scene.rerender(); // render once so the <pre> reflects the real cell size
    // `cover` + slight overscan (fill > 1) so the plane reaches every edge of a
    // non-square viewport instead of "contain"-fitting with letterbox margins.
    frameObject(scene, camera, polys, flat ? 1.02 : 0.72, flat);
    scene.rerender();
    const layer = scene.addEffectLayer({ effect: fieldSynth, params: paramsRef.current, blend: SYNTH_EFFECT_BLEND, target: "surfaces" });
    layerRef.current = layer as unknown as { setParams: (p: Params) => void; dispose: () => void };
    sceneRef.current = scene; cameraRef.current = camera;
    let last = performance.now(), t = 0, raf = 0;
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick);
      if (pausedRef.current) { last = now; return; }
      const dt = Math.min((now - last) / 1000, 0.1); last = now;
      t += dt * tsRef.current;
      layerRef.current?.setParams({ time: t });
    };
    raf = requestAnimationFrame(tick);
    // Camera.zoom is CSS px per world unit, independent of host size — resizing
    // the viewport doesn't grow the plane's on-screen footprint on its own. Only
    // the fullscreen plane needs to re-cover on resize; framed 3D shapes keep
    // their fixed on-screen size exactly as before (untouched by this observer).
    let resizeObserver: ResizeObserver | null = null;
    if (flat && typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        scene.fit();
        scene.rerender();
        frameObject(scene, camera, polys, 1.02, true);
        scene.rerender();
      });
      resizeObserver.observe(host);
    }
    return () => { cancelAnimationFrame(raf); resizeObserver?.disconnect(); layerRef.current?.dispose(); scene.destroy(); sceneRef.current = null; layerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  useEffect(() => { layerRef.current?.setParams(params); }, [params]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setOptions(buildLighting(lighting));
    scene.rerender();
  }, [lighting]);

  // Density → render font-size only. The renderer projects with the MEASURED cell,
  // so on-screen size is ≈ worldSpan × zoom (font-independent): changing the font
  // keeps the object the same size, just finer glyphs. No zoom compensation.
  useEffect(() => {
    const scene = sceneRef.current, host = hostRef.current;
    if (!scene || !host) return;
    host.style.fontSize = `${13 / density}px`;
    scene.fit();
    scene.rerender();
  }, [density]);

  // Which oscillator slots have a CARD (exist), independent of their amp. Muting a
  // voice (amp 0) keeps its card; only Remove (×) deletes it.
  const [voiceSlots, setVoiceSlots] = useState<number[]>(() => (initial?.v as number[]) ?? slotsFromParams(params));
  const voiceSlotsRef = useRef(voiceSlots); voiceSlotsRef.current = voiceSlots;

  // Persist everything to the URL (?s=…) so a reload/share restores the patch.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const s = encodeSynthState({ p: params, sh: shape, ts: timeScale, d: density, v: voiceSlots, l: lighting });
    const url = new URL(window.location.href);
    url.searchParams.set("s", s);
    window.history.replaceState(null, "", url.toString());
  }, [params, shape, timeScale, density, voiceSlots, lighting]);

  const onParam = useCallback((key: string, value: ParamValue) => setParams((p) => ({ ...p, [key]: value })), []);
  const applyPreset = useCallback((preset: GlyphEffectPreset<never>) => {
    const next = { ...synthDefaults(), ...(preset.params as Params) };
    setParams(next);
    setVoiceSlots(Array.from({ length: MAX_VOICES }, (_, i) => i + 1).filter((k) => Number(next[`amp${k}`]) > 0));
  }, []);

  const addVoice = useCallback(() => {
    const slots = voiceSlotsRef.current;
    let slot = 0;
    for (let k = 1; k <= MAX_VOICES; k++) if (!slots.includes(k)) { slot = k; break; }
    if (!slot) return;
    setVoiceSlots([...slots, slot].sort((a, b) => a - b));
    setParams((p) => ({ ...p, [`amp${slot}`]: 1 }));
  }, []);
  const removeVoice = useCallback((slot: number) => {
    setVoiceSlots((slots) => slots.filter((s) => s !== slot));
    setParams((p) => ({ ...p, [`amp${slot}`]: 0 }));
  }, []);

  const presets = useMemo(() => (fieldSynth.presets ?? []) as readonly GlyphEffectPreset<never>[], []);

  // ── Export ───────────────────────────────────────────────────────────────
  // A standard, always-visible "Open in CodePen" button (static, zero-lib —
  // ships the currently-rendered ASCII as-is, no glyphcss/effects runtime)
  // plus an "Export" toggle that mounts a gallery-look code window
  // (`SynthCodePanel`, mirroring `GalleryWorkbench`'s `CodePanel`): framework
  // tabs of lib-based code (imports glyphcss + @glyphcss/effects from a CDN,
  // mounts the field-synth layer + a time clock) with its OWN CodePen action
  // that ships that dynamic version. The `codeOpen` desktop toggle and the
  // mobile `mobilePanel === "export"` tab share one code window;
  // `cameraSnapshot` captures the live (imperative, non-React-state) camera
  // orientation at the moment the window opens, since orbiting doesn't trigger
  // a re-render otherwise.
  const [codeOpen, setCodeOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [cameraSnapshot, setCameraSnapshot] = useState({ rotX: 0, rotY: 0, zoom: 46 });

  const snapshotCamera = useCallback(() => {
    const camera = cameraRef.current;
    if (camera) setCameraSnapshot({ rotX: camera.rotX, rotY: camera.rotY, zoom: camera.zoom });
  }, []);
  const toggleCodeOpen = useCallback(() => {
    setCodeOpen((open) => { if (!open) snapshotCamera(); return !open; });
  }, [snapshotCamera]);
  const handleMobileExportTab = useCallback(() => {
    setMobilePanel((current) => {
      if (current === "export") return null;
      snapshotCamera();
      return "export";
    });
  }, [snapshotCamera]);
  const closeCodePanel = useCallback(() => {
    setCodeOpen(false);
    setMobilePanel((m) => (m === "export" ? null : m));
  }, []);

  const codeInput = useMemo<SynthSnippetInput>(() => ({
    shape,
    params: params as Record<string, number | string | boolean>,
    timeScale,
    paused,
    density,
    lighting,
    camera: cameraSnapshot,
  }), [shape, params, timeScale, paused, density, lighting, cameraSnapshot]);

  /** POST a raw CodePen prefill `data` JSON payload (opens a new pen in a new tab). */
  function postCodepenForm(action: string, data: string): void {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = action;
    form.target = "_blank";
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "data";
    input.value = data;
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    form.remove();
  }

  // Builds the SAME static (zero-lib) export `buildGlyphFieldSynthStaticExport`
  // bakes for the standalone "Open in CodePen" button — reads the mesh, the
  // current patch, the camera, the density-driven grid, and the blend the
  // layer is ACTUALLY mounted with (SYNTH_EFFECT_BLEND), so the pen matches
  // what's on screen. `loopSeconds` scales inversely with the live time-scale
  // so a faster-animating patch doesn't wrap after an unreasonably long
  // wall-clock wait, and vice-versa; the exported clock is otherwise
  // independent — it starts fresh from `time=0` on load.
  const buildSynthExport = useCallback((): GlyphFieldSynthStaticExportResult | null => {
    const scene = sceneRef.current, camera = cameraRef.current, host = hostRef.current;
    if (!scene || !camera || !host) return null;
    const pre = host.querySelector("pre.glyph-output") as HTMLElement | null;
    if (!pre) return null;
    const rect = pre.getBoundingClientRect();
    const lines = (pre.textContent ?? "").replace(/\s+$/, "").split("\n");
    const rows = Math.max(1, lines.length);
    const cols = Math.max(1, lines.reduce((m, l) => Math.max(m, l.length), 1));
    const cs = getComputedStyle(pre);
    const fontSizePx = parseFloat(cs.fontSize) || 13;
    const lineHeightPx = cs.lineHeight === "normal" ? fontSizePx * 1.2 : (parseFloat(cs.lineHeight) || fontSizePx);
    const { cellAspect } = scene.getOptions();
    const loopSeconds = Math.max(4, 40 / Math.max(0.05, timeScale));
    return buildGlyphFieldSynthStaticExport(shapePolys(shape), {
      params,
      blend: SYNTH_EFFECT_BLEND,
      loopSeconds,
      cols,
      rows,
      cellAspect,
      mode: "solid",
      useColors: true,
      rotX: camera.rotX,
      rotY: camera.rotY,
      zoom: camera.zoom,
      projection: "orthographic",
      fontSizePx,
      lineHeightPx: rect.height > 0 && rows > 0 ? rect.height / rows : lineHeightPx,
      directionalLight: buildLighting(lighting).directionalLight,
      ambientLight: buildLighting(lighting).ambientLight,
      title: `glyphcss field synth — ${shape}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape, params, lighting, timeScale]);

  // Standalone, always-visible "Open in CodePen" button (bottom-left): ships
  // the static, zero-lib baked pen (the ASCII the page currently renders +
  // a pure-CSS loop) — no glyphcss/effects runtime.
  const handleExportCodepenStatic = useCallback(() => {
    const result = buildSynthExport();
    if (!result) return;
    setExporting(true);
    try {
      postCodepenForm("https://codepen.io/pen/define", JSON.stringify({ title: `glyphcss field synth — ${shape}`, ...result.pen, editors: "110" }));
    } finally {
      setExporting(false);
    }
  }, [buildSynthExport, shape]);

  // "Export" code window's own CodePen action (and each framework tab):
  // compiles the current shape + camera + field-synth patch into a
  // self-contained, lib-based (glyphcss + @glyphcss/effects from the CDN)
  // CodePen — mirrors the gallery's `handleCodepen`.
  const handleExportCodepenDynamic = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    setExporting(true);
    try {
      const flat = isFlat(shape);
      const result = buildGlyphInteractiveExport(shapePolys(shape), {
        interactions: flat ? [] : ["orbit"],
        rotX: camera.rotX,
        rotY: camera.rotY,
        zoom: camera.zoom,
        projection: "orthographic",
        mode: "solid",
        useColors: true,
        effect: {
          id: fieldSynth.id,
          params: params as Record<string, number | string | boolean>,
          blend: SYNTH_EFFECT_BLEND,
          timeScale: paused ? 0 : timeScale,
        },
      });
      const prefill = glyphCodepenPrefill(result, `glyphcss field synth — ${shape}`);
      postCodepenForm(prefill.action, prefill.data);
    } finally {
      setExporting(false);
    }
  }, [shape, params, paused, timeScale]);

  return (
    <div className="synth-shell dn-root dn-root--synth">
      <div className="synth-body">
        <aside id="synth-voices-panel" className={`synth-voices${mobilePanel === "voices" ? " is-mobile-open" : ""}`}>
          <div className="synth-voices-head">
            <span>Voices</span>
            <button className="voice-add" onClick={addVoice} disabled={voiceSlots.length >= MAX_VOICES}>+ Add</button>
          </div>
          <div className="synth-voices-list">
            {voiceSlots.map((slot, i) => (
              <VoiceCard key={slot} slot={slot} index={i} params={params} onParam={onParam} onRemove={() => removeVoice(slot)} />
            ))}
            {voiceSlots.length === 0 && <p className="synth-empty">No voices — add one to start.</p>}
          </div>
        </aside>
        <main className="synth-main">
          <div className="synth-viewport" ref={hostRef} />
          <div className="synth-export-bar">
            <button
              type="button"
              className="gw-code-panel__action gw-code-panel__action--codepen"
              onClick={handleExportCodepenStatic}
              disabled={exporting}
              title="Open the current rendered patch as a static, zero-runtime CodePen"
            >
              {exporting ? "Exporting…" : "Open in CodePen"}
            </button>
            <button
              type="button"
              className={`gw-code-panel__action${codeOpen ? " is-active" : ""}`}
              onClick={toggleCodeOpen}
              aria-expanded={codeOpen}
              title={codeOpen ? "Close export code window" : "Open export code window"}
            >
              Export
            </button>
          </div>
          {(codeOpen || mobilePanel === "export") && (
            <SynthCodePanel
              id="synth-export-panel"
              input={codeInput}
              onCodepen={handleExportCodepenDynamic}
              exporting={exporting}
              onClose={closeCodePanel}
            />
          )}
        </main>
        <Dock id="synth-controls-panel" className={mobilePanel === "controls" ? "is-mobile-open" : ""}>
          <SynthDock shape={shape} onShape={setShape} timeScale={timeScale} onTimeScale={setTimeScale} paused={paused} onPaused={setPaused} density={density} onDensity={setDensity} lighting={lighting} onLight={(partial) => setLighting((l) => ({ ...l, ...partial }))} params={params} onParam={onParam} paramsRef={paramsRef} tsRef={tsRef} pausedRef={pausedRef} />
        </Dock>
      </div>
      <div id="synth-presets-panel" className={`synth-presets${mobilePanel === "presets" ? " is-mobile-open" : ""}`} role="list" aria-label="Pattern presets">
        {presets.map((p) => <PresetTile key={p.name} preset={p} onApply={() => applyPreset(p)} />)}
      </div>
      <nav className="dn-mobile-tabs" aria-label="Synth panels">
        <button
          type="button"
          className={`dn-mobile-tabs__button${mobilePanel === "voices" ? " is-active" : ""}`}
          aria-controls="synth-voices-panel"
          aria-expanded={mobilePanel === "voices"}
          onClick={() => setMobilePanel((current) => current === "voices" ? null : "voices")}
        >
          Voices
        </button>
        <button
          type="button"
          className={`dn-mobile-tabs__button${mobilePanel === "controls" ? " is-active" : ""}`}
          aria-controls="synth-controls-panel"
          aria-expanded={mobilePanel === "controls"}
          onClick={() => setMobilePanel((current) => current === "controls" ? null : "controls")}
        >
          Controls
        </button>
        <button
          type="button"
          className={`dn-mobile-tabs__button${mobilePanel === "presets" ? " is-active" : ""}`}
          aria-controls="synth-presets-panel"
          aria-expanded={mobilePanel === "presets"}
          onClick={() => setMobilePanel((current) => current === "presets" ? null : "presets")}
        >
          Presets
        </button>
        <button
          type="button"
          className={`dn-mobile-tabs__button${mobilePanel === "export" ? " is-active" : ""}`}
          aria-controls="synth-export-panel"
          aria-expanded={mobilePanel === "export"}
          onClick={handleMobileExportTab}
        >
          Export
        </button>
      </nav>
    </div>
  );
}
