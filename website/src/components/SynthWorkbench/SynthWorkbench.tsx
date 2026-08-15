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
  isGlyphFieldSynthStaticExportSupported,
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

// Default (non-flat) orbit camera angle — matches the scene-rebuild effect's
// own literals below. Kept as a named pair so `applyPreset`'s stage-hint
// reset can restore exactly this, not a magic-number duplicate of it.
const DEFAULT_CAMERA_ROT_X = 58;
const DEFAULT_CAMERA_ROT_Y = 32;

// Camera auto-orbit pace (user request, "screensaver, not spin cycle") at
// `orbitSpeed: 1`, the slider's default — a full yaw revolution takes a
// minute, and the pitch ping-pong's own period (~135° of travel at 4°/s, one
// way) isn't a clean multiple of the yaw period, so the combined path reads
// as a gentle Lissajous drift rather than an obviously looping tour. Pitch
// bounces between MIN and MAX instead of wrapping through the poles — a full
// -90..90 sweep would flip past looking straight down/up, which reads as a
// glitch, not a drift — but the range still dips below and rises above the
// horizontal (0°) so both the top and underside of the stage come into view.
const ORBIT_YAW_DEG_PER_SEC = 6;
const ORBIT_PITCH_DEG_PER_SEC = 4;
const ORBIT_PITCH_MIN = -55;
const ORBIT_PITCH_MAX = 80;

import {
  MAX_LAYERS,
  MAX_VOICES,
  STAGE_HINTS,
  buildLighting,
  synthDefaults,
  shapePolys,
  shapeTransform,
  isFlat,
  frameObject,
  LayerGroup,
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
  // Camera auto-orbit (user request, separate from `paused`/mesh-spin): a
  // gentle screensaver-style two-axis drift of the CAMERA itself, independent
  // of the Stage folder's existing Speed/Paused (which spins the MESH about
  // one axis). Page state only — camera angles aren't URL-persisted today
  // (see `cameraAnglesRef`'s own doc above), so neither is this.
  const [orbitAuto, setOrbitAuto] = useState(false);
  const [orbitSpeed, setOrbitSpeed] = useState(1);
  const orbitAutoRef = useRef(orbitAuto); orbitAutoRef.current = orbitAuto;
  const orbitSpeedRef = useRef(orbitSpeed); orbitSpeedRef.current = orbitSpeed;
  // Camera orbit angle for the NEXT scene rebuild (a stage-hint's rotX/rotY —
  // VOLUMETRIC-2.md §3 — or the plain default). Not React state: nothing
  // needs to re-render off it, and it must be read fresh by the scene-rebuild
  // effect below without adding itself as a dependency (that would tear the
  // scene down and rebuild it on every orbit drag).
  const cameraAnglesRef = useRef<{ rotX: number; rotY: number }>({ rotX: DEFAULT_CAMERA_ROT_X, rotY: DEFAULT_CAMERA_ROT_Y });

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
    const camera = createGlyphOrthographicCamera({ rotX: flat ? 0 : cameraAnglesRef.current.rotX, rotY: flat ? 0 : cameraAnglesRef.current.rotY, zoom: 46 });
    const scene = createGlyphScene(host, { camera, autoSize: true, mode: "solid", useColors: true, glyphPalette: "default", doubleSided: flat, interactiveDownscale: 1, ...buildLighting(lightingRef.current) });
    host.style.fontSize = `${13 / densityRef.current}px`;
    // The plane is a fullscreen-shader-style backdrop: camera stays locked head-on,
    // so no orbit controls for it. Every other shape keeps orbit exactly as before.
    // Handle captured (not discarded) so the auto-orbit tick below can listen for
    // drag start/end and pause/resume around it — see `orbitDragging`.
    const orbitControls = flat ? null : createGlyphOrbitControls(scene, { drag: true, wheel: true });
    let orbitDragging = false;
    orbitControls?.addEventListener("start", () => { orbitDragging = true; });
    orbitControls?.addEventListener("end", () => { orbitDragging = false; });
    let orbitPitchDir: 1 | -1 = 1;
    const polys = shapePolys(shape);
    meshRef.current = scene.add(polys, shapeTransform(shape)) as { dispose: () => void };
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
      const dt = Math.min((now - last) / 1000, 0.1); last = now;
      // Mesh spin (`paused`) and camera auto-orbit (`orbitAuto`) are
      // independent: pausing one must not pause the other.
      if (!pausedRef.current) {
        t += dt * tsRef.current;
        layerRef.current?.setParams({ time: t });
      }
      if (!flat && orbitAutoRef.current && !orbitDragging) {
        camera.rotY = camera.rotY + ORBIT_YAW_DEG_PER_SEC * dt * orbitSpeedRef.current;
        // Ping-pong pitch off the current rotX — not a stored/absolute phase —
        // so a user drag, a preset's stage hint, or resuming after the pointer
        // lifts all continue the drift from wherever the camera actually is.
        let nextPitch = camera.rotX + orbitPitchDir * ORBIT_PITCH_DEG_PER_SEC * dt * orbitSpeedRef.current;
        if (nextPitch >= ORBIT_PITCH_MAX) { nextPitch = ORBIT_PITCH_MAX; orbitPitchDir = -1; }
        else if (nextPitch <= ORBIT_PITCH_MIN) { nextPitch = ORBIT_PITCH_MIN; orbitPitchDir = 1; }
        camera.rotX = nextPitch;
        scene.rerender();
      }
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
    return () => { cancelAnimationFrame(raf); resizeObserver?.disconnect(); orbitControls?.destroy(); layerRef.current?.dispose(); scene.destroy(); sceneRef.current = null; layerRef.current = null; };
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
  // Stage presentation (density, camera angle, shape, paused) is STAGE
  // state, not part of the patch, so a `GlyphEffectPreset` cannot carry it —
  // the same preset has to work on a loader tile, a mesh face and this
  // viewport. A few patterns only read correctly with a particular hint
  // though (VOLUMETRIC-2.md §3), so the page keeps ONE consolidated table
  // (`STAGE_HINTS`, keyed by preset object identity — synthKit.tsx) and
  // applies it alongside the params. Fields the hint doesn't specify are
  // left exactly as the user had them (this preserves the old
  // `PRESET_DENSITY` behavior of "everything else keeps whatever density you
  // were already on", extended to angle/paused too).
  const applyPreset = useCallback((preset: GlyphEffectPreset<never>) => {
    const next = { ...synthDefaults(), ...(preset.params as Params) };
    setParams(next);
    setVoiceSlots(Array.from({ length: MAX_VOICES }, (_, i) => i + 1).filter((k) => Number(next[`amp${k}`]) > 0));
    const hint = STAGE_HINTS.get(preset);
    if (hint?.density !== undefined) setDensity(hint.density);
    if (hint?.paused !== undefined) setPaused(hint.paused);
    // `hint.shape` overrides the plain `space`-derived stage default (a
    // volumetric preset needs SOME 3D stage to render meaningfully, and a 2D
    // preset needs the fullscreen plane back) — otherwise a non-cube
    // volumetric preset like the pyramid-stage Sierpinski one would land on
    // the cube (VOLUMETRIC-2.md §3).
    const nextShape = hint?.shape ?? (next.space === "object" ? "cube" : "plane");
    const shapeChanging = nextShape !== shape;
    if (hint?.rotX !== undefined || hint?.rotY !== undefined) {
      cameraAnglesRef.current = { rotX: hint.rotX ?? cameraAnglesRef.current.rotX, rotY: hint.rotY ?? cameraAnglesRef.current.rotY };
    } else if (shapeChanging) {
      // No angle hint: a stage rebuild (triggered below) would otherwise
      // inherit whatever a PREVIOUS preset's hint left in the ref — reset to
      // the plain default so an un-hinted preset always starts from the
      // same angle a fresh stage always used to, before hints existed.
      cameraAnglesRef.current = { rotX: DEFAULT_CAMERA_ROT_X, rotY: DEFAULT_CAMERA_ROT_Y };
    }
    setShape(nextShape);
    if (!shapeChanging && (hint?.rotX !== undefined || hint?.rotY !== undefined) && !isFlat(nextShape)) {
      // No shape change means the scene-rebuild effect (keyed on `[shape]`)
      // won't fire to pick up the new angle from the ref — apply it to the
      // already-live camera directly instead.
      const camera = cameraRef.current;
      if (camera) { camera.rotX = cameraAnglesRef.current.rotX; camera.rotY = cameraAnglesRef.current.rotY; sceneRef.current?.rerender(); }
    }
  }, [shape]);

  // Adds a voice assigned to `layer` (VOLUMETRIC-2.md §4's LayerGroup "+ Add
  // to layer N" affordance). Every voice's `layerN` schema default is
  // already 1 (packages/effects/src/stock.ts), so the GLOBAL "+ Add" button
  // (the rail header's own action, used for layer 1 / the empty state) is
  // just this same function called with `1` — one add path, not two.
  const addVoiceToLayer = useCallback((layer: number) => {
    const slots = voiceSlotsRef.current;
    let slot = 0;
    for (let k = 1; k <= MAX_VOICES; k++) if (!slots.includes(k)) { slot = k; break; }
    if (!slot) return;
    setVoiceSlots([...slots, slot].sort((a, b) => a - b));
    setParams((p) => ({ ...p, [`amp${slot}`]: 1, [`layer${slot}`]: layer }));
  }, []);
  const addVoice = useCallback(() => addVoiceToLayer(1), [addVoiceToLayer]);
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

  // `buildGlyphFieldSynthStaticExport` explicitly REJECTS several patch
  // shapes it can't bake: volumetric/carve (a march per cell per frame is a
  // different export design — see AGENTS.md's "Static export"), an active
  // `linearZ` voice, and a nonzero `originW` on an active voice (both
  // 3D-only semantics with no meaning in the 2D branch this exporter ports).
  // `isGlyphFieldSynthStaticExportSupported` is the exporter's OWN predicate (from
  // `@glyphcss/effects`, mirroring `assertStaticExportSupported` exactly) —
  // reading it here instead of duplicating the condition list means this
  // button can never drift out of sync with what the exporter actually
  // rejects (a URL-loaded patch can carry either of the latter two without
  // being volumetric/carve, and used to slip past a narrower local check).
  // The static "Open in CodePen" button below is disabled whenever this is
  // false, instead of letting the exporter's throw reach the user; the
  // "Export" code window's OWN CodePen action (`handleExportCodepenDynamic`)
  // is unaffected — it mounts a LIVE effect at runtime from the CDN, which
  // handles every one of these cases fine.
  const staticExportSupported = useMemo(() => isGlyphFieldSynthStaticExportSupported(params), [params]);

  // Builds the SAME static (zero-lib) export `buildGlyphFieldSynthStaticExport`
  // bakes for the standalone "Open in CodePen" button — reads the mesh, the
  // current patch, the camera, the density-driven grid, and the blend the
  // layer is ACTUALLY mounted with (SYNTH_EFFECT_BLEND), so the pen matches
  // what's on screen. `loopSeconds` scales inversely with the live time-scale
  // so a faster-animating patch doesn't wrap after an unreasonably long
  // wall-clock wait, and vice-versa; the exported clock is otherwise
  // independent — it starts fresh from `time=0` on load.
  const buildSynthExport = useCallback((): GlyphFieldSynthStaticExportResult | null => {
    if (!staticExportSupported) return null;
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
            {/* Grouped by layer (VOLUMETRIC-2.md §4's LayerGroup rewrite) — a
                group renders only when it has at least one voice card; every
                EXISTING voice slot lives in exactly one group (moving a voice
                via its own 1/2/3 layer buttons re-renders it into a different
                group, since this is derived straight from `layerN`, not a
                separate list). The global "+ Add" above always lands on
                layer 1 (every `layerN` schema default is 1), so an
                all-empty page needs no special-cased empty group here. */}
            {Array.from({ length: MAX_LAYERS }, (_, i) => i + 1)
              .map((layer) => ({
                layer,
                slots: voiceSlots.filter((slot) => Math.round(Number(params[`layer${slot}`] ?? 1)) === layer),
              }))
              .filter(({ slots }) => slots.length > 0)
              .map(({ layer, slots }) => (
                <LayerGroup key={layer} layer={layer} params={params} onParam={onParam} onAddVoice={addVoiceToLayer} canAddVoice={voiceSlots.length < MAX_VOICES}>
                  {slots.map((slot) => (
                    <VoiceCard key={slot} slot={slot} index={voiceSlots.indexOf(slot)} params={params} onParam={onParam} onRemove={() => removeVoice(slot)} stageShape={shape} hoverToAnimate />
                  ))}
                </LayerGroup>
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
              disabled={exporting || !staticExportSupported}
              title={staticExportSupported
                ? "Open the current rendered patch as a static, zero-runtime CodePen"
                : "This patch can't bake to a static, zero-runtime CodePen — volumetric/carve (a march can't be prebaked per cell per frame), an active linearZ voice, or a nonzero origin W on an active voice all have no meaning in the baked 2D evaluator. Use \"Export\" instead, which ships a live effect from the CDN."}
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
          <SynthDock shape={shape} onShape={setShape} timeScale={timeScale} onTimeScale={setTimeScale} paused={paused} onPaused={setPaused} orbitAuto={orbitAuto} onOrbitAuto={setOrbitAuto} orbitSpeed={orbitSpeed} onOrbitSpeed={setOrbitSpeed} density={density} onDensity={setDensity} lighting={lighting} onLight={(partial) => setLighting((l) => ({ ...l, ...partial }))} params={params} onParam={onParam} paramsRef={paramsRef} tsRef={tsRef} pausedRef={pausedRef} hostRef={hostRef} />
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
