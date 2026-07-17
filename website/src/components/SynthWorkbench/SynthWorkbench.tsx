import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const FIELDS = ["radial", "linearX", "linearY", "diagonal", "angular", "spiral", "noise"] as const;
const WAVES = ["sin", "triangle", "saw", "square"] as const;
const COMBINES = ["add", "multiply", "max", "min", "difference"] as const;
const SPACES = ["auto", "surface", "scene"] as const;
const SHAPES: GlyphGeometryName[] = ["cube", "sphere", "icosahedron", "dodecahedron", "octahedron", "cylinder", "cone", "torus", "tetrahedron"];

const opts = <T extends string>(list: readonly T[]): Record<string, T> =>
  Object.fromEntries(list.map((v) => [v, v]));
const SHAPE_OPTS = opts(SHAPES);
const FIELD_OPTS = opts(FIELDS);
const WAVE_OPTS = opts(WAVES);
const COMBINE_OPTS = opts(COMBINES);
const SPACE_OPTS = opts(SPACES);

const LIGHT = { direction: [-0.4, -0.6, -0.5] as [number, number, number], intensity: 1.05 };
const AMBIENT = { intensity: 0.55 };

// Defaults minus `time` — the animation clock owns `time` via setParams.
function synthDefaults(): Params {
  const { time: _time, ...rest } = defaultGlyphEffectParams(fieldSynth) as Params;
  return rest;
}

function shapePolys(name: GlyphGeometryName) {
  return resolveGeometry(name, { size: 3 });
}

// Frame the object by setting the camera zoom so its projected bbox fills ~70%.
function frameObject(scene: GlyphSceneHandle, camera: { zoom: number; project: (v: [number, number, number], c: number, r: number, a: number) => number[] }, polys: ReturnType<typeof shapePolys>): void {
  const o = scene.getOptions();
  camera.zoom = 1;
  let minc = Infinity, maxc = -Infinity, minr = Infinity, maxr = -Infinity;
  for (const p of polys) for (const v of p.vertices) {
    const pr = camera.project(v as [number, number, number], o.cols, o.rows, o.cellAspect);
    if (!isFinite(pr[0]!) || !isFinite(pr[1]!)) continue;
    if (pr[0]! < minc) minc = pr[0]!; if (pr[0]! > maxc) maxc = pr[0]!;
    if (pr[1]! < minr) minr = pr[1]!; if (pr[1]! > maxr) maxr = pr[1]!;
  }
  const w = maxc - minc, h = maxr - minr;
  if (w > 0 && h > 0) camera.zoom = Math.min((0.7 * o.cols) / w, (0.7 * o.rows) / h);
}

// ── Live preset tile ─────────────────────────────────────────────────────────
function PresetTile({ preset, onApply }: { preset: GlyphEffectPreset<never>; onApply: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    injectGlyphBaseStyles(host.ownerDocument ?? undefined);
    const camera = createGlyphOrthographicCamera({ rotX: 58, rotY: 32, zoom: 20 });
    const scene = createGlyphScene(host, {
      camera, autoSize: true, mode: "solid", useColors: true, glyphPalette: "default",
      directionalLight: LIGHT, ambientLight: AMBIENT,
    });
    host.style.fontSize = "8px";
    const polys = shapePolys("cube");
    scene.add(polys);
    scene.fit();
    frameObject(scene, camera, polys);
    const layer = scene.addEffectLayer({ effect: fieldSynth, params: { ...synthDefaults(), ...preset.params }, blend: "replace" });
    scene.rerender();
    let last = performance.now(), t = 0, raf = 0;
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.1); last = now;
      t += dt * 0.8;
      layer.setParams({ time: t });
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); layer.dispose(); scene.destroy(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <button className="synth-tile" onClick={onApply} title={`Apply “${preset.name}”`}>
      <span className="synth-tile-scene" ref={ref} />
      <span className="synth-tile-label">{preset.name}</span>
    </button>
  );
}

// ── Dock controls ────────────────────────────────────────────────────────────
function SynthControls({
  shape, onShape, timeScale, onTimeScale, paused, onPaused, params, onParam,
}: {
  shape: GlyphGeometryName;
  onShape: (s: GlyphGeometryName) => void;
  timeScale: number;
  onTimeScale: (n: number) => void;
  paused: boolean;
  onPaused: (b: boolean) => void;
  params: Params;
  onParam: (key: string, value: ParamValue) => void;
}): null {
  const gui = useDockGui();
  const s = (k: string) => String(params[k] ?? "");
  const n = (k: string) => Number(params[k] ?? 0);

  const stage = useFolder(gui, "Stage", { open: true });
  useOption(stage, "Shape", SHAPE_OPTS, shape, (v) => onShape(v as GlyphGeometryName));
  useOption(stage, "Mapping", SPACE_OPTS, s("space"), (v) => onParam("space", v));
  useSlider(stage, "Speed", { min: 0.05, max: 8, step: 0.05 }, timeScale, onTimeScale);
  useToggle(stage, "Paused", paused, onPaused);

  const v1 = useFolder(gui, "Voice 1", { open: true });
  useOption(v1, "Field", FIELD_OPTS, s("field1"), (v) => onParam("field1", v));
  useOption(v1, "Wave", WAVE_OPTS, s("wave1"), (v) => onParam("wave1", v));
  useSlider(v1, "Freq", { min: 0, max: 24, step: 0.1 }, n("freq1"), (v) => onParam("freq1", v));
  useSlider(v1, "Speed", { min: -8, max: 8, step: 0.05 }, n("speed1"), (v) => onParam("speed1", v));
  useSlider(v1, "Amp", { min: 0, max: 2, step: 0.05 }, n("amp1"), (v) => onParam("amp1", v));

  const v2 = useFolder(gui, "Voice 2", { open: false });
  useOption(v2, "Field", FIELD_OPTS, s("field2"), (v) => onParam("field2", v));
  useOption(v2, "Wave", WAVE_OPTS, s("wave2"), (v) => onParam("wave2", v));
  useSlider(v2, "Freq", { min: 0, max: 24, step: 0.1 }, n("freq2"), (v) => onParam("freq2", v));
  useSlider(v2, "Speed", { min: -8, max: 8, step: 0.05 }, n("speed2"), (v) => onParam("speed2", v));
  useSlider(v2, "Amp", { min: 0, max: 2, step: 0.05 }, n("amp2"), (v) => onParam("amp2", v));

  const v3 = useFolder(gui, "Voice 3", { open: false });
  useOption(v3, "Field", FIELD_OPTS, s("field3"), (v) => onParam("field3", v));
  useOption(v3, "Wave", WAVE_OPTS, s("wave3"), (v) => onParam("wave3", v));
  useSlider(v3, "Freq", { min: 0, max: 24, step: 0.1 }, n("freq3"), (v) => onParam("freq3", v));
  useSlider(v3, "Speed", { min: -8, max: 8, step: 0.05 }, n("speed3"), (v) => onParam("speed3", v));
  useSlider(v3, "Amp", { min: 0, max: 2, step: 0.05 }, n("amp3"), (v) => onParam("amp3", v));

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
  return null;
}

// ── Workbench ────────────────────────────────────────────────────────────────
export default function SynthWorkbench() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<GlyphSceneHandle | null>(null);
  const cameraRef = useRef<ReturnType<typeof createGlyphOrthographicCamera> | null>(null);
  const layerRef = useRef<{ setParams: (p: Params) => void; dispose: () => void } | null>(null);
  const meshRef = useRef<{ dispose: () => void } | null>(null);

  const [shape, setShape] = useState<GlyphGeometryName>("cube");
  const [params, setParams] = useState<Params>(synthDefaults);
  const [timeScale, setTimeScale] = useState(1);
  const [paused, setPaused] = useState(false);

  const paramsRef = useRef(params); paramsRef.current = params;
  const shapeRef = useRef(shape); shapeRef.current = shape;
  const tsRef = useRef(timeScale); tsRef.current = timeScale;
  const pausedRef = useRef(paused); pausedRef.current = paused;

  // Mount the scene + effect + clock once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    injectGlyphBaseStyles(host.ownerDocument ?? undefined);
    const camera = createGlyphOrthographicCamera({ rotX: 58, rotY: 32, zoom: 46 });
    const scene = createGlyphScene(host, {
      camera, autoSize: true, mode: "solid", useColors: true, glyphPalette: "default",
      interactiveDownscale: 2, directionalLight: LIGHT, ambientLight: AMBIENT,
    });
    host.style.fontSize = "13px";
    createGlyphOrbitControls(scene, { drag: true, wheel: true });
    const polys = shapePolys(shapeRef.current);
    meshRef.current = scene.add(polys) as { dispose: () => void };
    scene.fit();
    frameObject(scene, camera, polys);
    const layer = scene.addEffectLayer({ effect: fieldSynth, params: paramsRef.current, blend: "replace" });
    layerRef.current = layer as unknown as { setParams: (p: Params) => void; dispose: () => void };
    sceneRef.current = scene;
    cameraRef.current = camera;
    scene.rerender();

    let last = performance.now(), t = 0, raf = 0;
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick);
      if (pausedRef.current) { last = now; return; }
      const dt = Math.min((now - last) / 1000, 0.1); last = now;
      t += dt * tsRef.current;
      layerRef.current?.setParams({ time: t });
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      layerRef.current?.dispose();
      scene.destroy();
      sceneRef.current = null;
    };
  }, []);

  // Push param changes to the live layer (time is owned by the clock and excluded).
  useEffect(() => { layerRef.current?.setParams(params); }, [params]);

  // Rebuild the mesh + reframe on shape change.
  useEffect(() => {
    const scene = sceneRef.current, camera = cameraRef.current;
    if (!scene || !camera) return;
    meshRef.current?.dispose();
    const polys = shapePolys(shape);
    meshRef.current = scene.add(polys) as { dispose: () => void };
    frameObject(scene, camera, polys);
    scene.rerender();
  }, [shape]);

  const onParam = useCallback((key: string, value: ParamValue) => {
    setParams((prev) => ({ ...prev, [key]: value }));
  }, []);

  const applyPreset = useCallback((preset: GlyphEffectPreset<never>) => {
    setParams({ ...synthDefaults(), ...(preset.params as Params) });
  }, []);

  const presets = useMemo(() => (fieldSynth.presets ?? []) as readonly GlyphEffectPreset<never>[], []);

  return (
    <div className="synth-shell">
      <main className="synth-main">
        <div className="synth-viewport" ref={hostRef} />
        <div className="synth-presets" role="list" aria-label="Pattern presets">
          {presets.map((p) => (
            <PresetTile key={p.name} preset={p} onApply={() => applyPreset(p)} />
          ))}
        </div>
      </main>
      <Dock id="synth-controls-panel">
        <SynthControls
          shape={shape}
          onShape={setShape}
          timeScale={timeScale}
          onTimeScale={setTimeScale}
          paused={paused}
          onPaused={setPaused}
          params={params}
          onParam={onParam}
        />
      </Dock>
    </div>
  );
}
