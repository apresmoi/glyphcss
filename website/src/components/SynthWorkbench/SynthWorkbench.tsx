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
  glyphFieldSynthStaticExportUnsupportedReason,
  measureGlyphInkCoverage,
  synthWave,
} from "@glyphcss/effects";
import type { GlyphEffectPreset, GlyphFieldSynthStaticExportResult } from "@glyphcss/effects";
import { Dock } from "../Dock";
import { useDockGui } from "../Dock/slots";
import { useColor, useDockSlot, useFolder, useOption, useSlider, useText, useToggle } from "../Dock/primitives";
import { SynthCodePanel } from "./SynthCodePanel";
import { extractAsciiFromPre } from "../../lib/asciiClipboard";
import { StatsOverlay } from "../StatsOverlay";
import type { SynthSnippetInput } from "./synthSnippets";
import { SYNTH_PARAM, decodeSynthUrlStateAsync, readInitialSynthState, writeSynthUrlState, type Lighting } from "./synthUrlState";
import { readUrlParam } from "../../lib/urlState";
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

// Default (non-flat) orbit camera angle/zoom — `STAGE_CAMERA_ROT_X/Y/ZOOM`
// from synthKit.tsx, the single source of truth `shapeTransform("pyramid")`'s
// upright reorientation is tuned against and the arbiter test in
// synthKit.test.ts projects through. Kept as local aliases so
// `applyPreset`'s stage-hint reset can restore exactly this, not a
// magic-number duplicate of it.
const DEFAULT_CAMERA_ROT_X = STAGE_CAMERA_ROT_X;
const DEFAULT_CAMERA_ROT_Y = STAGE_CAMERA_ROT_Y;

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
  STAGE_CAMERA_ROT_X,
  STAGE_CAMERA_ROT_Y,
  STAGE_CAMERA_ZOOM,
  STAGE_HINTS,
  buildLighting,
  synthDefaults,
  shapePolys,
  shapeTransform,
  isFlat,
  computeSynthTickPlan,
  wrapDrivenTime,
  frameObject,
  LayerGroup,
  VoiceCard,
  ColorStackSection,
  PresetTile,
  SynthDock,
  IconToggle,
  VOICE_MODE_TOGGLE,
  type ParamValue,
  type Params,
  type VoiceDisplayMode,
} from "./synthKit";

// ── URL persistence (everything the synth is configured to, in ?s=) ───────────
// See synthUrlState.ts: a single packed `?s=` param built on the shared codec
// (website/src/lib/urlState.ts), replacing the old base64url(JSON) payload —
// base64 inflates a short packed string by ~33% for nothing, so a schema-
// packed value round-trips through the SAME `?s=` key smaller, not bigger.

// ── Workbench ────────────────────────────────────────────────────────────────
export default function SynthWorkbench() {
  const initial = useMemo(() => readInitialSynthState(), []);
  // Captured once, in the SAME memo pass as `initial` above — i.e. before
  // any effect (including the URL-persistence effect below) has a chance to
  // overwrite `?s=` — so the async catch-up effect a few lines down always
  // decodes the link the page actually loaded with, not whatever state has
  // since been written back.
  const initialRawParam = useMemo(() => readUrlParam(SYNTH_PARAM), []);
  const hostRef = useRef<HTMLDivElement | null>(null);
  // State, not a ref: StatsOverlay mounts imperatively into this element,
  // and a ref mutation would not re-run its effect (same pattern as
  // /wordart's own `stageHost`).
  const [stageHost, setStageHost] = useState<HTMLElement | null>(null);
  const sceneRef = useRef<GlyphSceneHandle | null>(null);
  const cameraRef = useRef<ReturnType<typeof createGlyphOrthographicCamera> | null>(null);
  const layerRef = useRef<{ setParams: (p: Params) => void; dispose: () => void } | null>(null);
  const meshRef = useRef<{ dispose: () => void } | null>(null);

  const [shape, setShape] = useState<string>(initial.shape);
  const [params, setParams] = useState<Params>(initial.params as Params);
  const [timeScale, setTimeScale] = useState(initial.timeScale);
  const [paused, setPaused] = useState(false);
  const [density, setDensity] = useState(initial.density);
  // Run-extension colour-merge tolerance (COLOR-TOLERANCE.md Phase 4) — a
  // SCENE option (`scene.setOptions({ colorTolerance })` below), not a
  // field-synth param, so it's page state alongside `density` rather than
  // living in `params`. Replaces the removed `colorQuantize` effect param as
  // the page's one performance lever (see synthKit.tsx's Output-folder
  // slider doc) and is URL-persisted the same way `density` is — a shared
  // link should reproduce the performance/visual profile the sharer had.
  const [colorTolerance, setColorTolerance] = useState(initial.colorTolerance);
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
  // A preset's own `STAGE_HINTS` entry (for a one-way animation arc, like a
  // `wave: "step"` SDF voice's erosion, that should replay instead of
  // playing once and sitting at its end state — see `SynthStageHint
  // .loopSeconds`'s own doc) — read fresh by the tick loop below, same
  // "not React state, no re-render needed" rationale as `cameraAnglesRef`.
  // Always reset on `applyPreset` (never carried over from a previous
  // preset — see that callback), so an un-hinted preset is unaffected.
  const loopSecondsRef = useRef<number | null>(null);

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
  const colorToleranceRef = useRef(colorTolerance); colorToleranceRef.current = colorTolerance;

  // Build (or rebuild) the whole scene for the current shape. A fresh scene is the
  // reliable way to give the effect layer the new geometry's retained coverage —
  // swapping the mesh under a mounted layer leaves it with the old surface's fill.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    injectGlyphBaseStyles(host.ownerDocument ?? undefined);
    const flat = isFlat(shape);
    const camera = createGlyphOrthographicCamera({ rotX: flat ? 0 : cameraAnglesRef.current.rotX, rotY: flat ? 0 : cameraAnglesRef.current.rotY, zoom: STAGE_CAMERA_ZOOM });
    // interactiveDownscale > 1 renders at 1/n resolution WHILE a control is
    // actively dragging (same on-screen size, coarser cell) and restores
    // full detail on release — createGlyphOrbitControls already drives
    // scene.setInteracting() itself on drag start/end (the shared
    // emitInteraction registry, controls/common.ts), so enabling it here is
    // the only change needed. This was previously pinned at 1 (off), which
    // meant orbiting a heavy volumetric carve patch (a deep-recursion SDF
    // voice, ~140ms/evaluate at this viewport) re-evaluated the effect at FULL
    // resolution on every drag frame — 2 (÷4 cells) matches the loaders
    // gallery's own default (glyph-runtime.ts's `parseInteractiveDownscale`).
    const scene = createGlyphScene(host, { camera, autoSize: true, mode: "solid", useColors: true, glyphPalette: "default", doubleSided: flat, interactiveDownscale: 2, colorTolerance: colorToleranceRef.current, ...buildLighting(lightingRef.current) });
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
    const meshTransform = shapeTransform(shape);
    meshRef.current = scene.add(polys, meshTransform) as { dispose: () => void };
    scene.fit();
    scene.rerender(); // render once so the <pre> reflects the real cell size
    // `cover` + slight overscan (fill > 1) so the plane reaches every edge of a
    // non-square viewport instead of "contain"-fitting with letterbox margins.
    // Pass `meshTransform` so the fitted bbox is the actually-rendered
    // (world-space) silhouette, not the shape's untransformed local geometry —
    // load-bearing for the pyramid stage, whose transform rotates+translates it.
    frameObject(scene, camera, polys, flat ? 1.02 : 0.72, flat, meshTransform);
    scene.rerender();
    const layer = scene.addEffectLayer({ effect: fieldSynth, params: paramsRef.current, blend: SYNTH_EFFECT_BLEND, target: "surfaces" });
    layerRef.current = layer as unknown as { setParams: (p: Params) => void; dispose: () => void };
    sceneRef.current = scene; cameraRef.current = camera;
    let last = performance.now(), t = 0, raf = 0;
    const tick = (now: number): void => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.1); last = now;
      // Mesh spin (`paused`) and camera auto-orbit (`orbitAuto`) are
      // independent: pausing one must not pause the other. `computeSynthTickPlan`
      // is the single pure decision point for both — see its own doc for why
      // this is one function and not two inline `if`s (a perf change gating
      // `time` advancement behind `isTimeInvariantPatch` must never fold the
      // orbit branch under the same guard).
      const plan = computeSynthTickPlan({
        paused: pausedRef.current,
        timeScale: tsRef.current,
        params: paramsRef.current,
        flat,
        orbitAuto: orbitAutoRef.current,
        orbitDragging,
      });
      if (plan.advanceTime) {
        t += dt * tsRef.current;
        // `t` itself keeps growing monotonically (simplest accumulator, no
        // precision concerns from re-deriving it). A preset whose
        // `STAGE_HINTS` entry declares `loopSeconds` (for a one-way
        // animation arc that never returns to its start on its own, see
        // that hint's own doc in synthKit.tsx) instead gets the WRAPPED
        // value here, so the driven `time` cycles back to 0 and replays the
        // arc instead of settling at its end state forever.
        layerRef.current?.setParams({ time: wrapDrivenTime(t, loopSecondsRef.current) });
      }
      if (plan.orbit) {
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
        frameObject(scene, camera, polys, 1.02, true, meshTransform);
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

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setOptions({ colorTolerance });
    scene.rerender();
  }, [colorTolerance]);

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

  // Voice card display mode (crowding fix, VoiceCard's own `mode` prop) —
  // viewer preference, deliberately NOT part of `writeSynthUrlState` above
  // (a shared link's bytes must not change with how densely the RECEIVER
  // likes to view their own sidebar). `voiceMode` is the global default every
  // card without its own override reads; a per-card `[bsc|adv]` toggle
  // (`voiceModeOverrides`) can diverge from it afterwards. Defaults to
  // "basic" — the whole point of this control is to declutter a multi-voice
  // patch by default, not to open every card and ask the viewer to close them.
  const [voiceMode, setVoiceMode] = useState<VoiceDisplayMode>("basic");
  const [voiceModeOverrides, setVoiceModeOverrides] = useState<Record<number, VoiceDisplayMode>>({});
  // The ONE global control (sidebar header) — sets every card at once by
  // clearing any per-card override, so a stale override can't leave one card
  // silently un-affected by the next global click.
  const setAllVoiceModes = useCallback((next: VoiceDisplayMode) => { setVoiceMode(next); setVoiceModeOverrides({}); }, []);
  const setVoiceCardMode = useCallback((slot: number, next: VoiceDisplayMode) => {
    setVoiceModeOverrides((prev) => ({ ...prev, [slot]: next }));
  }, []);

  // Async catch-up for a compressed ('z') `?s=` link: `readInitialSynthState`
  // above is synchronous and can only ever read the 'p' (raw packed) format
  // — a link past the compaction threshold (~400 packed chars, routine once
  // a preset touches many voices/colour-stack keys) decodes to schema
  // defaults on that path with no signal at all. This resolves it the moment
  // native decompression finishes (typically well under a frame) and applies
  // the real patch over whatever defaults were rendered first. No-op (the
  // promise resolves to `null`) for the overwhelmingly common 'p'-tagged or
  // absent-param case — see `decodeSynthUrlStateAsync`'s doc.
  useEffect(() => {
    let cancelled = false;
    void decodeSynthUrlStateAsync(initialRawParam).then((state) => {
      if (cancelled || !state) return;
      setShape(state.shape);
      setParams(state.params as Params);
      setTimeScale(state.timeScale);
      setDensity(state.density);
      setColorTolerance(state.colorTolerance);
      setLighting(state.lighting);
      setVoiceSlots(state.voiceSlots);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialRawParam]);

  // Persist everything to the single packed `?s=` param so a reload/share
  // restores the patch (see synthUrlState.ts).
  useEffect(() => {
    writeSynthUrlState({ shape, params, timeScale, density, colorTolerance, lighting, voiceSlots });
  }, [params, shape, timeScale, density, colorTolerance, voiceSlots, lighting]);

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
    // Always reset (never carried over from a previous preset, unlike
    // density/paused above): a loop period belongs to the specific one-way
    // animation that needed it, not to "whatever the user had before".
    loopSecondsRef.current = hint?.loopSeconds ?? null;
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

  // "Copy ASCII" (bottom-left export bar, next to "Open in CodePen"/"Export")
  // copies the rendered ART ITSELF as plain text — distinct from
  // `SynthCodePanel`'s own "Copy" button, which copies a generated CODE
  // snippet. `extractAsciiFromPre` reads `textContent` (colored output's
  // `<span>`s carry no markup through that) and trims each line's trailing
  // grid-padding while preserving the art's own leading offset. A transient
  // `copyState` mirrors `WordArtCodePanel`'s `copied` idiom, plus an explicit
  // "error" state so a denied clipboard permission fails visibly instead of
  // silently no-op-ing.
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const handleCopyAscii = useCallback(async () => {
    const pre = hostRef.current?.querySelector("pre.glyph-output") as HTMLElement | null;
    const text = extractAsciiFromPre(pre);
    if (text === null) {
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 1500);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 1500);
  }, []);

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

  /**
   * Open a blank, NAMED tab synchronously, inside the click gesture itself —
   * before either export handler below does its (potentially multi-second,
   * see `buildSynthExport`'s doc) synchronous bake. Chrome's transient user
   * activation for a `target="_blank"` form POST expires a few seconds after
   * the click; claiming the window up front sidesteps that entirely, since
   * navigating an ALREADY-open window by name isn't a new-popup request and
   * isn't subject to that limit — the standard pattern for slow popup work.
   * Returns `null` only when the browser blocks even a same-gesture
   * `window.open` (popups fully disabled for this origin); callers must tell
   * the user, not fail silently the way a blocked `target="_blank"` POST did.
   */
  function openCodepenTab(name: string): Window | null {
    const tab = window.open("", name);
    if (tab) {
      try {
        tab.document.title = "Preparing CodePen…";
        tab.document.body.textContent = "Building your pen…";
        tab.document.body.style.cssText = "font:14px system-ui,sans-serif;color:#666;padding:2rem;";
      } catch {
        // Same-origin `about:blank` write can't actually throw here, but a
        // future browser restriction on scripting a freshly opened window
        // shouldn't take the tab (already open and about to navigate) down.
      }
    }
    return tab;
  }

  /** POST a raw CodePen prefill `data` JSON payload into the tab `openCodepenTab` already opened. */
  function postCodepenForm(action: string, data: string, targetName: string): void {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = action;
    form.target = targetName;
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
  // `linearZ` voice, a nonzero `originW` on an active voice (both 3D-only
  // semantics with no meaning in the 2D branch this exporter ports), and
  // `colorStackOn: true` (the colour voice stack has no inlined-runtime
  // port). `glyphFieldSynthStaticExportUnsupportedReason` is the exporter's
  // OWN predicate (from `@glyphcss/effects`, mirroring
  // `assertStaticExportSupported`'s real throw sites, not a hand-mirrored
  // condition list next to this button — reported bug: the disabled tooltip
  // used to hard-code only the volumetric/linearZ/originW wording, so
  // toggling the colour stack disabled the button but the tooltip kept
  // naming reasons that didn't apply) — reading it here means this button
  // (and its tooltip) can never drift out of sync with what the exporter
  // actually rejects. The static "Open in CodePen" button below is disabled
  // whenever this is non-null, instead of letting the exporter's throw reach
  // the user; the "Export" code window's OWN CodePen action
  // (`handleExportCodepenDynamic`) is unaffected — it mounts a LIVE effect
  // at runtime from the CDN, which handles every one of these cases fine.
  const staticExportUnsupportedReason = useMemo(() => glyphFieldSynthStaticExportUnsupportedReason(params), [params]);
  const staticExportSupported = staticExportUnsupportedReason === null;

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
      // The SAME measured cell metrics `frameObject` (synthKit.tsx) used to
      // fit `camera.zoom` against this exact `cols`/`rows` — without these,
      // `bake()` reprojects that zoom onto its own headless BASE_TILE-derived
      // cell size instead, baking a silhouette that covers the wrong
      // fraction of the grid (see `GlyphFieldSynthStaticExportOptions`'s
      // `cellWidthPx`/`cellHeightPx` doc).
      cellWidthPx: rect.width > 0 && cols > 0 ? rect.width / cols : undefined,
      cellHeightPx: rect.height > 0 && rows > 0 ? rect.height / rows : undefined,
      directionalLight: buildLighting(lighting).directionalLight,
      ambientLight: buildLighting(lighting).ambientLight,
      title: `glyphcss field synth — ${shape}`,
    });
  }, [shape, params, lighting, timeScale, staticExportSupported]);

  // Standalone, always-visible "Open in CodePen" button (bottom-left): ships
  // the static, zero-lib baked pen (the ASCII the page currently renders +
  // a pure-CSS loop) — no glyphcss/effects runtime.
  //
  // `buildSynthExport` (via `buildGlyphFieldSynthStaticExport`) bakes every
  // covered cell's field-synth coordinate and can run into the seconds on a
  // dense stage (measured ~4.2s at the live 202x78 default, worse at higher
  // Density) — a plain synchronous call here would both freeze the page with
  // no feedback AND risk losing Chrome's transient user activation before
  // `postCodepenForm`'s POST fires, which is exactly "the button cannot be
  // clicked" (the window silently never opens). `openCodepenTab` claims the
  // destination tab FIRST, synchronously in the gesture, so the eventual POST
  // is a same-window navigation, not a new-popup request, and can't be
  // blocked by how long the bake takes. The `requestAnimationFrame` yield
  // lets the "Exporting…" label actually paint before that synchronous bake
  // begins, so the freeze that follows isn't silent.
  const handleExportCodepenStatic = useCallback(() => {
    const tab = openCodepenTab("glyphcss-codepen-static");
    if (!tab) {
      window.alert("Your browser blocked the new tab for this export. Allow popups for this site and try again.");
      return;
    }
    setExporting(true);
    requestAnimationFrame(() => {
      try {
        const result = buildSynthExport();
        if (!result) { tab.close(); return; }
        postCodepenForm(
          "https://codepen.io/pen/define",
          JSON.stringify({ title: `glyphcss field synth — ${shape}`, ...result.pen, editors: "110" }),
          "glyphcss-codepen-static",
        );
      } finally {
        setExporting(false);
      }
    });
  }, [buildSynthExport, shape]);

  // "Export" code window's own CodePen action (and each framework tab):
  // compiles the current shape + camera + field-synth patch into a
  // self-contained, lib-based (glyphcss + @glyphcss/effects from the CDN)
  // CodePen — mirrors the gallery's `handleCodepen`. `buildGlyphInteractiveExport`
  // is far cheaper than the static bake above (it decimates a polygon list,
  // it doesn't march a cell grid), but it shares the same `postCodepenForm`
  // popup-timing hazard, so it gets the same open-tab-first treatment for
  // the same reason, not because it's independently been measured slow.
  const handleExportCodepenDynamic = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera) return;
    const tab = openCodepenTab("glyphcss-codepen-dynamic");
    if (!tab) {
      window.alert("Your browser blocked the new tab for this export. Allow popups for this site and try again.");
      return;
    }
    setExporting(true);
    requestAnimationFrame(() => {
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
        postCodepenForm(prefill.action, prefill.data, "glyphcss-codepen-dynamic");
      } finally {
        setExporting(false);
      }
    });
  }, [shape, params, paused, timeScale]);

  return (
    <InstrumentShell kind="synth">
      <InstrumentBody>
        <InstrumentRail
          id="synth-voices-panel"
          title="Voices"
          action={
            <span className="synth-voices-head-actions">
              <span className="voice-mode-toggle">
                <IconToggle
                  groupTitle="Set every voice card to Basic or Advanced at once. A card's own [bsc|adv] toggle can still override this afterwards."
                  options={VOICE_MODE_TOGGLE}
                  value={voiceMode}
                  onChange={(v) => setAllVoiceModes(v as VoiceDisplayMode)}
                />
              </span>
              <button className="voice-add" onClick={addVoice} disabled={voiceSlots.length >= MAX_VOICES}>+ Add</button>
            </span>
          }
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
                    <VoiceCard
                      key={slot} slot={slot} index={voiceSlots.indexOf(slot)} params={params} onParam={onParam}
                      onRemove={() => removeVoice(slot)} stageShape={shape} hoverToAnimate
                      mode={voiceModeOverrides[slot] ?? voiceMode}
                      onModeChange={(next) => setVoiceCardMode(slot, next)}
                    />
                  ))}
                </LayerGroup>
              ))}
            {voiceSlots.length === 0 && <p className="synth-empty">No voices — add one to start.</p>}
            {/* Colour voice stack (VOLUMETRIC-4.md §1) — below the geometry
                layer groups, since it's a second, independent voice program
                (colour only, no occupancy/glyph say) rather than another
                layer of them. */}
            <ColorStackSection params={params} onParam={onParam} stageShape={shape} />
        </InstrumentRail>
        <InstrumentMain elementRef={setStageHost}>
          <InstrumentViewport elementRef={hostRef} />
          <StatsOverlay anchor="top-left" container={stageHost} />
          <div className="synth-export-bar">
            <button
              type="button"
              className="gw-code-panel__action gw-code-panel__action--codepen"
              onClick={handleExportCodepenStatic}
              disabled={exporting || !staticExportSupported}
              title={staticExportUnsupportedReason === null
                ? "Open the current rendered patch as a static, zero-runtime CodePen"
                : `Can't export a static, zero-runtime CodePen: ${staticExportUnsupportedReason} Use "Export" instead, which ships a live effect from the CDN.`}
            >
              {exporting ? "Exporting…" : "Open in CodePen"}
            </button>
            <button
              type="button"
              className="gw-code-panel__action"
              onClick={handleCopyAscii}
              title="Copy the rendered ASCII art to the clipboard"
            >
              {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy ASCII"}
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
              onCopyAscii={handleCopyAscii}
              copyAsciiState={copyState}
            />
          )}
        </InstrumentMain>
        <Dock id="synth-controls-panel" className={mobilePanel === "controls" ? "is-mobile-open" : ""}>
          <SynthDock shape={shape} onShape={setShape} timeScale={timeScale} onTimeScale={setTimeScale} paused={paused} onPaused={setPaused} orbitAuto={orbitAuto} onOrbitAuto={setOrbitAuto} orbitSpeed={orbitSpeed} onOrbitSpeed={setOrbitSpeed} density={density} onDensity={setDensity} colorTolerance={colorTolerance} onColorTolerance={setColorTolerance} lighting={lighting} onLight={(partial) => setLighting((l) => ({ ...l, ...partial }))} params={params} onParam={onParam} paramsRef={paramsRef} tsRef={tsRef} pausedRef={pausedRef} hostRef={hostRef} />
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
