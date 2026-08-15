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
import { SynthCodePanel } from "./SynthCodePanel";
import type { SynthSnippetInput } from "./synthSnippets";
import { readInitialSynthState, writeSynthUrlState, type Lighting } from "./synthUrlState";
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
const SYNTH_EFFECT_BLEND: GlyphEffectBlend = "replace";

/** Stage density a preset wants, by name. Only for patterns whose read depends
 *  on cell size — everything else keeps whatever density you were already on. */
const PRESET_DENSITY: Record<string, number> = {
  "Cube tiles": 1.5,
};

import {
  MAX_VOICES,
  buildLighting,
  synthDefaults,
  shapePolys,
  isFlat,
  frameObject,
  VoiceCard,
  PresetTile,
  SynthDock,
  type ParamValue,
  type Params,
} from "./synthKit";

// ── URL persistence (everything the synth is configured to, in ?s=) ───────────
// See synthUrlState.ts: a single packed `?s=` param built on the shared codec
// (website/src/lib/urlState.ts), replacing the old base64url(JSON) payload —
// base64 inflates a short packed string by ~33% for nothing, so a schema-
// packed value round-trips through the SAME `?s=` key smaller, not bigger.

// ── Workbench ────────────────────────────────────────────────────────────────
export default function SynthWorkbench() {
  const initial = useMemo(() => readInitialSynthState(), []);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<GlyphSceneHandle | null>(null);
  const cameraRef = useRef<ReturnType<typeof createGlyphOrthographicCamera> | null>(null);
  const layerRef = useRef<{ setParams: (p: Params) => void; dispose: () => void } | null>(null);
  const meshRef = useRef<{ dispose: () => void } | null>(null);

  const [shape, setShape] = useState<string>(initial.shape);
  const [params, setParams] = useState<Params>(initial.params as Params);
  const [timeScale, setTimeScale] = useState(initial.timeScale);
  const [paused, setPaused] = useState(false);
  const [density, setDensity] = useState(initial.density);
  const [lighting, setLighting] = useState<Lighting>(initial.lighting);
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
  const [voiceSlots, setVoiceSlots] = useState<number[]>(initial.voiceSlots);
  const voiceSlotsRef = useRef(voiceSlots); voiceSlotsRef.current = voiceSlots;

  // Persist everything to the single packed `?s=` param so a reload/share
  // restores the patch (see synthUrlState.ts).
  useEffect(() => {
    writeSynthUrlState({ shape, params, timeScale, density, lighting, voiceSlots });
  }, [params, shape, timeScale, density, voiceSlots, lighting]);

  const onParam = useCallback((key: string, value: ParamValue) => setParams((p) => ({ ...p, [key]: value })), []);
  // Density is STAGE state, not part of the patch, so a `GlyphEffectPreset`
  // cannot carry it — the same preset has to work on a loader tile, a mesh face
  // and this viewport. A few patterns only read correctly at a particular cell
  // size though, so the page keeps its own hint per preset name and applies it
  // alongside the params.
  const applyPreset = useCallback((preset: GlyphEffectPreset<never>) => {
    const next = { ...synthDefaults(), ...(preset.params as Params) };
    setParams(next);
    setVoiceSlots(Array.from({ length: MAX_VOICES }, (_, i) => i + 1).filter((k) => Number(next[`amp${k}`]) > 0));
    const stageDensity = PRESET_DENSITY[preset.name];
    if (stageDensity !== undefined) setDensity(stageDensity);
    // A preset's own `space` fully determines its mode (same rule the 2D/3D
    // toggle applies manually — see synthKit.tsx's `ModeToggle`): a
    // volumetric preset needs the cube stage to render meaningfully, and a
    // 2D preset needs the fullscreen plane back, regardless of whichever
    // stage was active before applying it.
    setShape(next.space === "object" ? "cube" : "plane");
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

  // `buildGlyphFieldSynthStaticExport` explicitly REJECTS a volumetric/carve
  // patch (baking a march per cell per frame is a different export design —
  // see AGENTS.md's "Static export"). The static "Open in CodePen" button
  // below is disabled for exactly this condition instead of letting that
  // throw reach the user; the "Export" code window's OWN CodePen action
  // (`handleExportCodepenDynamic`) is unaffected — it mounts a LIVE effect at
  // runtime from the CDN, which handles carve fine.
  const isVolumetricPatch = params.space === "object" || params.render === "carve";

  // Builds the SAME static (zero-lib) export `buildGlyphFieldSynthStaticExport`
  // bakes for the standalone "Open in CodePen" button — reads the mesh, the
  // current patch, the camera, the density-driven grid, and the blend the
  // layer is ACTUALLY mounted with (SYNTH_EFFECT_BLEND), so the pen matches
  // what's on screen. `loopSeconds` scales inversely with the live time-scale
  // so a faster-animating patch doesn't wrap after an unreasonably long
  // wall-clock wait, and vice-versa; the exported clock is otherwise
  // independent — it starts fresh from `time=0` on load.
  const buildSynthExport = useCallback((): GlyphFieldSynthStaticExportResult | null => {
    if (isVolumetricPatch) return null;
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
    <InstrumentShell kind="synth">
      <InstrumentBody>
        <InstrumentRail
          id="synth-voices-panel"
          title="Voices"
          action={<button className="voice-add" onClick={addVoice} disabled={voiceSlots.length >= MAX_VOICES}>+ Add</button>}
          open={mobilePanel === "voices"}
        >
            {voiceSlots.map((slot, i) => (
              <VoiceCard key={slot} slot={slot} index={i} params={params} onParam={onParam} onRemove={() => removeVoice(slot)} />
            ))}
            {voiceSlots.length === 0 && <p className="synth-empty">No voices — add one to start.</p>}
        </InstrumentRail>
        <InstrumentMain>
          <InstrumentViewport elementRef={hostRef} />
          <div className="synth-export-bar">
            <button
              type="button"
              className="gw-code-panel__action gw-code-panel__action--codepen"
              onClick={handleExportCodepenStatic}
              disabled={exporting || isVolumetricPatch}
              title={isVolumetricPatch
                ? "Volumetric/carve patches can't bake to a static, zero-runtime CodePen — a march can't be prebaked per cell per frame. Use \"Export\" instead, which ships a live effect from the CDN."
                : "Open the current rendered patch as a static, zero-runtime CodePen"}
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
        </InstrumentMain>
        <Dock id="synth-controls-panel" className={mobilePanel === "controls" ? "is-mobile-open" : ""}>
          <SynthDock shape={shape} onShape={setShape} timeScale={timeScale} onTimeScale={setTimeScale} paused={paused} onPaused={setPaused} density={density} onDensity={setDensity} lighting={lighting} onLight={(partial) => setLighting((l) => ({ ...l, ...partial }))} params={params} onParam={onParam} paramsRef={paramsRef} tsRef={tsRef} pausedRef={pausedRef} hostRef={hostRef} />
        </Dock>
      </InstrumentBody>
      <InstrumentTray id="synth-presets-panel" label="Pattern presets" open={mobilePanel === "presets"}>
        {presets.map((p) => <PresetTile key={p.name} preset={p} onApply={() => applyPreset(p)} />)}
      </InstrumentTray>
      <InstrumentMobileTabs label="Synth panels" items={[
        { id: "voices", label: "Voices", controls: "synth-voices-panel", expanded: mobilePanel === "voices", onClick: () => setMobilePanel((current) => current === "voices" ? null : "voices") },
        { id: "controls", label: "Controls", controls: "synth-controls-panel", expanded: mobilePanel === "controls", onClick: () => setMobilePanel((current) => current === "controls" ? null : "controls") },
        { id: "presets", label: "Presets", controls: "synth-presets-panel", expanded: mobilePanel === "presets", onClick: () => setMobilePanel((current) => current === "presets" ? null : "presets") },
        { id: "export", label: "Export", controls: "synth-export-panel", expanded: mobilePanel === "export", onClick: handleMobileExportTab },
      ]} />
    </InstrumentShell>
  );
}
