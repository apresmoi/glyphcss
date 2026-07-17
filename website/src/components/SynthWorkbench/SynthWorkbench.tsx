import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  createGlyphScene,
  createGlyphOrthographicCamera,
  createGlyphOrbitControls,
  injectGlyphBaseStyles,
  resolveGeometry,
  type GlyphGeometryName,
  type GlyphSceneHandle,
} from "glyphcss";
import { GlyphFieldSynthEffect as fieldSynth, defaultGlyphEffectParams } from "@glyphcss/effects";
import type { GlyphEffectPreset } from "@glyphcss/effects";
import { Dock } from "../Dock";
import { useDockGui } from "../Dock/slots";
import { useColor, useFolder, useOption, useSlider, useText, useToggle } from "../Dock/primitives";
import "../GalleryWorkbench/gallery-workbench.css";
import "./synth-workbench.css";

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

// ASCII icons for the field/wave multi-toggles (segmented control, like text-align).
const FIELD_ICONS: Record<string, string> = { radial: "◎", linearX: "→", linearY: "↓", diagonal: "↘", angular: "↻", spiral: "@", noise: "▚" };
const WAVE_ICONS: Record<string, string> = { sin: "∿", triangle: "∧", saw: "╱", square: "⊓" };
const FIELD_TOGGLE = FIELDS.map((v) => ({ value: v as string, icon: FIELD_ICONS[v], title: v }));
const WAVE_TOGGLE = WAVES.map((v) => ({ value: v as string, icon: WAVE_ICONS[v], title: v }));

function IconToggle({ options, value, onChange }: { options: { value: string; icon: string; title: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="gx-toggle" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" className={`gx-toggle-btn${o.value === value ? " is-active" : ""}`} title={o.title} onClick={() => onChange(o.value)}>{o.icon}</button>
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
function frameObject(scene: GlyphSceneHandle, camera: { zoom: number; project: (v: [number, number, number], c: number, r: number, a: number, m?: unknown) => number[] }, polys: Polys, fill = 0.72): void {
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
  if (w > 0 && h > 0) camera.zoom = Math.min((fill * o.cols) / w, (fill * o.rows) / h);
}

// Isolate one voice into osc-1 (amp 1) so a card can preview its solo contribution.
function soloParams(params: Params, slot: number): Params {
  const base = synthDefaults();
  for (let k = 1; k <= MAX_VOICES; k++) base[`amp${k}`] = 0;
  base.field1 = params[`field${slot}`]; base.wave1 = params[`wave${slot}`];
  base.freq1 = params[`freq${slot}`]; base.speed1 = params[`speed${slot}`]; base.amp1 = 1;
  base.space = params.space; base.scale = params.scale; base.glyphs = params.glyphs;
  base.color = params.color; base.colorB = params.colorB; base.gradient = params.gradient;
  base.gain = 1; base.bias = 0.5;
  return base;
}

// Small live preview on a FLAT square, viewed head-on (a plain 2D read of the field).
function useSynthPreview(host: HTMLElement | null, getParams: () => Params, deps: unknown[]): void {
  const layerRef = useRef<{ setParams: (p: Params) => void; dispose: () => void } | null>(null);
  useEffect(() => {
    if (!host) return;
    injectGlyphBaseStyles(host.ownerDocument ?? undefined);
    const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 20 });
    const scene = createGlyphScene(host, { camera, autoSize: true, mode: "solid", useColors: true, glyphPalette: "default", doubleSided: true, directionalLight: LIGHT, ambientLight: AMBIENT });
    host.style.fontSize = "8px";
    const polys = flatQuad(3);
    scene.add(polys); scene.fit(); scene.rerender();
    frameObject(scene, camera, polys, 0.98);
    const layer = scene.addEffectLayer({ effect: fieldSynth, params: getParams(), blend: "replace", target: "surfaces" });
    layerRef.current = layer as unknown as { setParams: (p: Params) => void; dispose: () => void };
    scene.rerender();
    let last = performance.now(), t = 0, raf = 0;
    const tick = (now: number): void => { raf = requestAnimationFrame(tick); const dt = Math.min((now - last) / 1000, 0.1); last = now; t += dt * 0.8; layerRef.current?.setParams({ time: t }); };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); layer.dispose(); scene.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [host]);
  useEffect(() => { layerRef.current?.setParams(getParams()); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

// ── Voice card (left rail) ────────────────────────────────────────────────────
function VoiceCard({ slot, index, params, onParam, onRemove }: {
  slot: number; index: number; params: Params;
  onParam: (key: string, value: ParamValue) => void; onRemove: () => void;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useSynthPreview(host, () => soloParams(params, slot), [params[`field${slot}`], params[`wave${slot}`], params[`freq${slot}`], params[`speed${slot}`], params.space, params.scale, params.color, params.colorB, params.gradient, params.glyphs, host]);
  const f = (k: string) => String(params[`${k}${slot}`]);
  const num = (k: string) => Number(params[`${k}${slot}`]);
  const fill = (v: number, min: number, max: number) => ({ ["--fill" as string]: `${((v - min) / (max - min)) * 100}%` } as CSSProperties);
  return (
    <div className="voice-card">
      <span className="voice-preview" ref={setHost} />
      <div className="voice-controls">
        <div className="voice-head">
          <span className="voice-title">Voice {index + 1}</span>
          <button className="voice-remove" onClick={onRemove} title="Remove voice">×</button>
        </div>
        <IconToggle options={FIELD_TOGGLE} value={f("field")} onChange={(v) => onParam(`field${slot}`, v)} />
        <IconToggle options={WAVE_TOGGLE} value={f("wave")} onChange={(v) => onParam(`wave${slot}`, v)} />
        <label className="voice-slider"><span>freq</span><input type="range" min={0} max={24} step={0.1} value={num("freq")} style={fill(num("freq"), 0, 24)} onChange={(e) => onParam(`freq${slot}`, +e.target.value)} /><b>{num("freq").toFixed(1)}</b></label>
        <label className="voice-slider"><span>speed</span><input type="range" min={-8} max={8} step={0.05} value={num("speed")} style={fill(num("speed"), -8, 8)} onChange={(e) => onParam(`speed${slot}`, +e.target.value)} /><b>{num("speed").toFixed(2)}</b></label>
        <label className="voice-slider"><span>mix</span><input type="range" min={0} max={1} step={0.02} value={num("amp")} style={fill(num("amp"), 0, 1)} onChange={(e) => onParam(`amp${slot}`, +e.target.value)} /><b>{num("amp").toFixed(2)}</b></label>
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
function SynthDock({ shape, onShape, timeScale, onTimeScale, paused, onPaused, density, onDensity, lighting, onLight, params, onParam }: {
  shape: string; onShape: (s: string) => void;
  timeScale: number; onTimeScale: (n: number) => void; paused: boolean; onPaused: (b: boolean) => void;
  density: number; onDensity: (n: number) => void;
  lighting: Lighting; onLight: (partial: Partial<Lighting>) => void;
  params: Params; onParam: (key: string, value: ParamValue) => void;
}): null {
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
  useOption(mix, "Combine", COMBINE_OPTS, s("combine"), (v) => onParam("combine", v));
  useSlider(mix, "Scale", { min: 0.1, max: 12, step: 0.1 }, n("scale"), (v) => onParam("scale", v));
  useSlider(mix, "Origin U", { min: 0, max: 1, step: 0.01 }, n("originU"), (v) => onParam("originU", v));
  useSlider(mix, "Origin V", { min: 0, max: 1, step: 0.01 }, n("originV"), (v) => onParam("originV", v));
  useSlider(mix, "Contrast", { min: 0, max: 4, step: 0.05 }, n("gain"), (v) => onParam("gain", v));
  useSlider(mix, "Brightness", { min: -1, max: 2, step: 0.05 }, n("bias"), (v) => onParam("bias", v));

  const out = useFolder(gui, "Output", { open: true });
  useText(out, "Ramp", s("glyphs"), (v) => onParam("glyphs", v));
  useColor(out, "Color", s("color"), (v) => onParam("color", v));
  useColor(out, "Color B", s("colorB"), (v) => onParam("colorB", v));
  useSlider(out, "Gradient", { min: 0, max: 1, step: 0.05 }, n("gradient"), (v) => onParam("gradient", v));

  const light = useFolder(gui, "Lighting", { open: false });
  useSlider(light, "Amount", { min: 0, max: 1, step: 0.05 }, n("lit"), (v) => onParam("lit", v));
  useSlider(light, "Azimuth", { min: 0, max: 360, step: 1 }, lighting.azimuth, (v) => onLight({ azimuth: v }));
  useSlider(light, "Elevation", { min: 0, max: 90, step: 1 }, lighting.elevation, (v) => onLight({ elevation: v }));
  useSlider(light, "Key", { min: 0, max: 2, step: 0.05 }, lighting.keyIntensity, (v) => onLight({ keyIntensity: v }));
  useColor(light, "Key color", lighting.keyColor, (v) => onLight({ keyColor: v }));
  useSlider(light, "Ambient", { min: 0, max: 1, step: 0.05 }, lighting.ambient, (v) => onLight({ ambient: v }));
  return null;
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
  const [params, setParams] = useState<Params>(() => ({ ...synthDefaults(), ...((initial?.p as Params) ?? {}) }));
  const [timeScale, setTimeScale] = useState((initial?.ts as number) ?? 1.4);
  const [paused, setPaused] = useState(false);
  const [density, setDensity] = useState((initial?.d as number) ?? 1);
  const [lighting, setLighting] = useState<Lighting>(() => ({ ...DEFAULT_LIGHTING, ...((initial?.l as Partial<Lighting>) ?? {}) }));
  const lightingRef = useRef(lighting); lightingRef.current = lighting;

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
    createGlyphOrbitControls(scene, { drag: true, wheel: true });
    const polys = shapePolys(shape);
    meshRef.current = scene.add(polys) as { dispose: () => void };
    scene.fit();
    scene.rerender(); // render once so the <pre> reflects the real cell size
    frameObject(scene, camera, polys, flat ? 0.98 : 0.72);
    scene.rerender();
    const layer = scene.addEffectLayer({ effect: fieldSynth, params: paramsRef.current, blend: "replace", target: "surfaces" });
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
    return () => { cancelAnimationFrame(raf); layerRef.current?.dispose(); scene.destroy(); sceneRef.current = null; layerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);

  useEffect(() => { layerRef.current?.setParams(params); }, [params]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setOptions(buildLighting(lighting));
    scene.rerender();
  }, [lighting]);

  // Density → render font-size, WITHOUT rescaling the view: compensate zoom for the
  // font change (like the gallery) so the object keeps its size/framing, just finer.
  useEffect(() => {
    const scene = sceneRef.current, camera = cameraRef.current, host = hostRef.current;
    if (!scene || !camera || !host) return;
    const prevFont = parseFloat(host.style.fontSize) || 13;
    const nextFont = 13 / density;
    host.style.fontSize = `${nextFont}px`;
    scene.fit();
    camera.zoom *= prevFont / nextFont;
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

  return (
    <div className="synth-shell dn-root">
      <div className="synth-body">
        <aside className="synth-voices">
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
        </main>
        <Dock id="synth-controls-panel">
          <SynthDock shape={shape} onShape={setShape} timeScale={timeScale} onTimeScale={setTimeScale} paused={paused} onPaused={setPaused} density={density} onDensity={setDensity} lighting={lighting} onLight={(partial) => setLighting((l) => ({ ...l, ...partial }))} params={params} onParam={onParam} />
        </Dock>
      </div>
      <div className="synth-presets" role="list" aria-label="Pattern presets">
        {presets.map((p) => <PresetTile key={p.name} preset={p} onApply={() => applyPreset(p)} />)}
      </div>
    </div>
  );
}
