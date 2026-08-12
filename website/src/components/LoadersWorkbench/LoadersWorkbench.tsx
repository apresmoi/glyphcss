import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createGlyphScene,
  createGlyphOrthographicCamera,
  injectGlyphBaseStyles,
  type GlyphEffectDefinition,
  type GlyphEffectParamSchema,
  WIREFRAME_PALETTES,
  type GlyphSceneHandle,
} from "glyphcss";
import { getGlyphEffect } from "@glyphcss/effects";
import { readUrlParam, writeUrlParam } from "../../lib/urlState";
import { MAX_VOICES, VoiceCard, soloParams, synthDefaults, type Params, type ParamValue } from "../SynthWorkbench/synthKit";
import { Dock } from "../Dock";
import {
  InstrumentBody,
  InstrumentMain,
  InstrumentMobileTabs,
  InstrumentRail,
  InstrumentShell,
  InstrumentTray,
} from "../InstrumentWorkbench/InstrumentWorkbench";
import { DEFAULT_LOADER, findLoader, LOADERS, LOADER_SIZES, type LoaderLayer, type LoaderPreset } from "./loaders";
import { LoadersDock } from "./LoadersDock";
import { LoaderCodePanel } from "./LoaderCodePanel";
import { generateLoaderSnippets, type LoaderTab } from "./loaderSnippets";
import "../GalleryWorkbench/gallery-workbench.css";
import "./loaders.css";

type Polys = Parameters<GlyphSceneHandle["add"]>[0];

/**
 * Braille glyphs (U+28xx) are NOT in the monospace face this page renders with,
 * so the browser serves them from a fallback font at a different advance —
 * measured 7.52px vs 6.60px for ASCII, 14% wider. field-synth at
 * `subcellRes: "2x4"` skips cells whose value hits 0, and those fall through to
 * the base plane's ASCII ramp, so a frame mixes both widths; as the pattern
 * animates the mix changes, the widest line changes, and the whole `<pre>`
 * visibly resizes frame to frame.
 *
 * Fix: when a loader renders Braille, give the BASE a blank-Braille ramp. Every
 * cell is then a U+28xx glyph on one font with one advance — U+2800 has no dots,
 * so an empty cell looks exactly like a space but measures like Braille. This is
 * the same convention drawille-style renderers use for blank Braille cells.
 */
const BRAILLE_BLANK_PALETTE = "loaders-braille-blank";
WIREFRAME_PALETTES[BRAILLE_BLANK_PALETTE] = {
  ...WIREFRAME_PALETTES.default!,
  solid: ["\u2800"],
};
/**
 * Braille's fallback font is WIDER than the monospace face (7.52px vs 6.60px at
 * 11px), so a Braille grid occupies a bigger box than the same cols×rows in
 * ASCII and every tile jumps ~14% when you switch Subcell. Pull the advance back
 * to the ASCII cell with negative tracking, measured live rather than hardcoded
 * because both advances scale with the rendered font-size. Braille dots sit well
 * inside their em box, so tightening by the difference doesn't clip them.
 */
function applyBrailleTracking(pre: HTMLElement): void {
  const cs = getComputedStyle(pre);
  const probe = pre.ownerDocument.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;letter-spacing:normal";
  probe.style.font = cs.font;
  pre.ownerDocument.body.appendChild(probe);
  const advance = (ch: string): number => {
    probe.textContent = ch.repeat(50);
    return probe.getBoundingClientRect().width / 50;
  };
  const ascii = advance("M");
  const braille = advance("\u28FF");
  probe.remove();
  pre.style.letterSpacing = ascii > 0 && braille > 0 ? `${(ascii - braille).toFixed(3)}px` : "";
}

/**
 * The overlay is a SECOND `<pre>` stacked on the tile, not a layer composited
 * into the same grid — a grid holds one glyph per cell, so compositing would
 * REPLACE the loader's glyphs rather than overlay them. Stacking keeps the
 * loader intact underneath and lets CSS opacity do the blending.
 *
 * Its base plane uses a ramp of pure spaces so every cell the voice does not
 * reach stays empty and the render below shows through untouched.
 */
const GHOST_BLANK_PALETTE = "loaders-ghost-blank";
WIREFRAME_PALETTES[GHOST_BLANK_PALETTE] = {
  ...WIREFRAME_PALETTES.default!,
  solid: [" "],
};
/**
 * The overlay renders the voice through field-synth's `subcellRes: "ink"` — a
 * real iso-contour of the voice's own field, with strokes oriented to the local
 * slope and flat crests filled as blocks. Colouring the ramp by value (what this
 * used to do) can only ever scatter marks; a contour is a boundary, so it has to
 * come from where the field CROSSES a level, which only the effect can know.
 */
// Near the peak on purpose: a mid-level iso crosses an oscillating field on
// almost every cell (measured 305/384 at 0.6 for a freq-6 voice), which is
// truthful but unreadable. Contouring close to the crest marks the peaks only.
const GHOST_INK_LEVEL = 0.88;
/** Crest colour (value 1) and valley colour (value 0): `gradient: 1` makes
 *  field-synth interpolate between them by value, so the two lines are told
 *  apart at a glance rather than being one colour at two heights. */
const GHOST_CREST = "#ffffff";
const GHOST_VALLEY = "#38bdf8";

const rendersBraille = (loader: LoaderPreset, live?: LiveEdits): boolean =>
  loader.layers.some((layer, index) =>
    (live?.layerParams[index]?.subcellRes ?? layer.params.subcellRes) === "2x4");

// Every loader is a texture on the same head-on flat quad, so the page compares
// patterns and box shapes rather than geometry.
function flatQuad(size: number, color: string): Polys {
  return [{
    vertices: [[-size, -size, 0], [size, -size, 0], [size, size, 0], [-size, size, 0]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    color,
  }] as unknown as Polys;
}

// One rAF for the whole page. Each tile is tiny, but there are ~30 of them —
// thirty independent loops would each pay their own callback and their own clock
// drift, and a footer mini would visibly run out of phase with the stage tile
// showing the same loader.
type Tick = (t: number) => void;
const ticks = new Set<Tick>();
let clockRaf = 0;
let clockLast = 0;
let clockTime = 0;
function pumpClock(now: number): void {
  clockRaf = requestAnimationFrame(pumpClock);
  const dt = Math.min((now - clockLast) / 1000, 0.1);
  clockLast = now;
  clockTime += dt;
  for (const fn of ticks) fn(clockTime);
}
function registerTick(fn: Tick): () => void {
  if (ticks.size === 0) { clockLast = performance.now(); clockRaf = requestAnimationFrame(pumpClock); }
  ticks.add(fn);
  return () => {
    ticks.delete(fn);
    if (ticks.size === 0) cancelAnimationFrame(clockRaf);
  };
}

/** Zoom the head-on quad so it covers the whole cols×rows grid. Must project
 *  with the MEASURED cell (see synthKit's `frameObject` for the same rationale):
 *  the default `cellAspect` is ~20% off the real monospace cell, and a
 *  fixed-size scene has no `fitToHost` to correct it. */
function coverGrid(scene: GlyphSceneHandle, camera: ReturnType<typeof createGlyphOrthographicCamera>, polys: Polys, overscan = 1): void {
  const o = scene.getOptions();
  const cols = o.cols ?? 80, rows = o.rows ?? 24;
  const pre = scene.host.querySelector("pre.glyph-output") as HTMLElement | null;
  let metrics: { cellWidth: number; cellHeight: number } | undefined;
  let cellAspect = o.cellAspect ?? 2;
  if (pre) {
    const r = pre.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      metrics = { cellWidth: r.width / cols, cellHeight: r.height / rows };
      cellAspect = metrics.cellHeight / metrics.cellWidth;
      scene.setOptions({ cellAspect });
    }
  }
  camera.zoom = 1;
  let minc = Infinity, maxc = -Infinity, minr = Infinity, maxr = -Infinity;
  for (const p of polys as unknown as { vertices: [number, number, number][] }[]) {
    for (const v of p.vertices) {
      const pr = camera.project(v, cols, rows, cellAspect, metrics);
      if (!isFinite(pr[0]!) || !isFinite(pr[1]!)) continue;
      if (pr[0]! < minc) minc = pr[0]!; if (pr[0]! > maxc) maxc = pr[0]!;
      if (pr[1]! < minr) minr = pr[1]!; if (pr[1]! > maxr) maxr = pr[1]!;
    }
  }
  const w = maxc - minc, h = maxr - minr;
  if (w > 0 && h > 0) camera.zoom = Math.max(cols / w, rows / h) * overscan;
}

/** Live edit state pushed into an already-mounted scene. Absent for the footer
 *  thumbnails, which stay canonical so the catalog is a stable reference. */
interface LiveEdits {
  layerParams: Record<number, Params>;
  drive: { current: { timeScale: number; paused: boolean } };
  /** Which voice the pointer is on, if any — drives the solo overlay below. */
  highlight: { current: { slot: number | null; params: Params } };
}


/** Mount one live loader at an exact cols×rows. Fixed grid (no `autoSize`) is
 *  the whole point — the box shape is the variable under test. */
function useLoaderScene(host: HTMLElement | null, loader: LoaderPreset, cols: number, rows: number, live?: LiveEdits): void {
  const mountedRef = useRef<{ layer: ReturnType<GlyphSceneHandle["addEffectLayer"]>; spec: LoaderLayer }[]>([]);
  const liveRef = useRef(live);
  liveRef.current = live;
  // Switching Subcell live changes which ramp the BASE must use, and the ramp is
  // fixed at scene creation — so this one edit re-mounts, unlike every other
  // param which is pushed into the running scene.
  const braille = rendersBraille(loader, live);

  useEffect(() => {
    if (!host) return;
    injectGlyphBaseStyles(host.ownerDocument ?? undefined);
    const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 20 });
    const scene = createGlyphScene(host, {
      camera, cols, rows, autoSize: false, mode: "solid", useColors: true,
      glyphPalette: braille ? BRAILLE_BLANK_PALETTE : "default",
      // No `charMode` here on purpose: a mounted effect installs the scene's
      // `transformCells` hook (createGlyphScene.ts), and `wantsHalfblockSolid`/
      // `wantsQuadrantSolid` require that hook to be ABSENT — so halfblock and
      // quadrant are structurally unreachable for an effect-driven loader.
      // Sub-cell detail comes from field-synth's own `subcellRes: "2x4"`
      // (braille dots), which the Braille preset uses.
      doubleSided: true,
      directionalLight: { direction: [0.2, 0.3, 0.93], intensity: 0.85 },
      ambientLight: { intensity: 0.45 },
    });
    const polys = flatQuad(3, "#243244");
    scene.add(polys);
    scene.rerender();
    // Before framing: tracking changes the cell width, and coverGrid measures
    // the real cell to derive cellAspect and the zoom.
    const pre = scene.host.querySelector("pre.glyph-output") as HTMLElement | null;
    if (pre && braille) {
      applyBrailleTracking(pre);
      // Tracking is calibrated for the Braille advance, so any cell the effect
      // does NOT cover — a wipe-masked progress bar's empty half, say — is an
      // ASCII space that measures narrower, and the box would grow as the fill
      // sweeps in. Pin the width to the ASCII grid (`ch` is the "0" advance, so
      // it tracks the Cell size slider) and coverage can no longer move it.
      // Masked-out runs are contiguous and blank, so the sub-pixel drift inside
      // them is invisible.
      pre.style.width = `${cols}ch`;
    }
    // Braille overscans a touch so no edge cell is left uncovered: an empty cell
    // is an ASCII space, and the negative tracking above is calibrated for the
    // Braille advance, so a stray space would measure narrow and pull the line
    // back out of alignment with the ASCII grid.
    coverGrid(scene, camera, polys, braille ? 1.2 : 1);
    scene.rerender();

    const mounted = loader.layers.map((spec, index) => {
      const definition = getGlyphEffect(spec.effectId);
      if (!definition) return null;
      const layer = scene.addEffectLayer({
        effect: definition as GlyphEffectDefinition<GlyphEffectParamSchema>,
        params: { ...spec.params, ...(liveRef.current?.layerParams[index] ?? {}) },
        // Braille needs EVERY cell to be a U+28xx glyph or the line mixes two
        // font advances (see BRAILLE_BLANK_PALETTE). Under `replace` a cell the
        // effect skips gets coverage 0 and the compositor forces a hard " ";
        // under `over` it falls through to the base's blank-Braille glyph, which
        // has no dots and so looks identical while measuring like Braille.
        blend: braille && spec.effectId === "field-synth" ? "over" : spec.blend,
        target: "surfaces",
      });
      return { layer, spec };
    }).filter(Boolean) as { layer: ReturnType<GlyphSceneHandle["addEffectLayer"]>; spec: LoaderLayer }[];
    mountedRef.current = mounted;


    scene.rerender();

    let clock = 0;
    let previous: number | null = null;
    const stop = registerTick((t) => {
      // A paused loader holds its frame: advance our own accumulator only while
      // running, so unpausing resumes instead of jumping forward by the gap.
      const drive = liveRef.current?.drive.current;
      if (previous !== null && !(drive?.paused ?? false)) clock += (t - previous) * (drive?.timeScale ?? 1);
      previous = t;
      for (const { layer, spec } of mounted) {
        const next: Record<string, number> = {};
        if (spec.timeScale) next.time = clock * spec.timeScale;
        // A determinate loader's sweep is just another driven param — the page
        // owns the clock, the effect owns the shape. Ramp over the first
        // `1 - hold` of the loop, then rest at 1.0: a bar that snaps straight
        // from full back to empty reads as a glitch, not as completion.
        if (spec.progress) {
          const { param, cycle, hold = 0 } = spec.progress;
          const phase = (clock % cycle) / cycle;
          const ramp = 1 - hold;
          next[param] = ramp <= 0 ? 1 : Math.min(1, phase / ramp);
        }
        if (Object.keys(next).length > 0) layer.setParams(next);
      }
    });
    return () => {
      stop();
      mountedRef.current = [];
      for (const { layer } of mounted) layer.dispose();
      scene.destroy();
    };
  }, [host, cols, rows, loader, braille]);

  // Push edits without remounting — re-creating the scene per slider tick would
  // restart every animation mid-drag.
  const edits = live?.layerParams;
  useEffect(() => {
    if (!edits) return;
    mountedRef.current.forEach(({ layer }, index) => {
      const patch = edits[index];
      if (patch) layer.setParams(patch);
    });
  }, [edits]);
}


/**
 * The hover overlay: its own scene writing its own `<pre>`, stacked over the
 * tile. Always mounted so a pointer move never pays a scene mount, but it only
 * renders while a voice is hovered — with no highlight it neither updates
 * params nor writes, and CSS hides it.
 */
function useGhostScene(host: HTMLElement | null, cols: number, rows: number, live: LiveEdits): void {
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    if (!host) return;
    injectGlyphBaseStyles(host.ownerDocument ?? undefined);
    const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 20 });
    const scene = createGlyphScene(host, {
      camera, cols, rows, autoSize: false, mode: "solid", useColors: true,
      glyphPalette: GHOST_BLANK_PALETTE, doubleSided: true,
      directionalLight: { direction: [0.2, 0.3, 0.93], intensity: 0.85 },
      ambientLight: { intensity: 0.45 },
    });
    const polys = flatQuad(3, "#000000");
    scene.add(polys);
    scene.rerender();
    coverGrid(scene, camera, polys);
    scene.rerender();

    const definition = getGlyphEffect("field-synth");
    const layer = definition
      ? scene.addEffectLayer({
        effect: definition as GlyphEffectDefinition<GlyphEffectParamSchema>,
        params: { ...synthDefaults(), subcellRes: "ink" },
        blend: "over",
        target: "surfaces",
      })
      : null;
    if (!layer) { scene.destroy(); return; }

    let shownSlot: number | null = null;
    let clock = 0;
    let previous: number | null = null;
    const stop = registerTick((t) => {
      const drive = liveRef.current.drive.current;
      if (previous !== null && !drive.paused) clock += (t - previous) * drive.timeScale;
      previous = t;
      const { slot, params } = liveRef.current.highlight.current;
      if (slot !== shownSlot) {
        shownSlot = slot;
        host.style.opacity = slot === null ? "0" : "1";
        if (slot !== null) {
          layer.setParams({
            ...soloParams(params, slot),
            subcellRes: "ink",
            inkLevel: GHOST_INK_LEVEL,
            inkArea: 0.02,
            gain: 1,
            bias: 0.5,
            voiceColors: false,
            color: GHOST_CREST,
            colorB: GHOST_VALLEY,
            gradient: 1,
            lit: 0,
          });
        }
      }
      if (slot !== null) layer.setParams({ time: clock });
    });
    return () => { stop(); layer.dispose(); scene.destroy(); };
  }, [host, cols, rows]);
}

function LoaderTile({ loader, cols, rows, label, lang, live, fontSize, onCode }: {
  loader: LoaderPreset;
  cols: number;
  rows: number;
  label: string;
  lang: LoaderTab;
  live: LiveEdits;
  fontSize: number;
  onCode: () => void;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [ghost, setGhost] = useState<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  useLoaderScene(host, loader, cols, rows, live);
  useGhostScene(ghost, cols, rows, live);

  // Each example is its own exportable size, so its snippet states THIS grid.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(generateLoaderSnippets(loader, cols, rows)[lang]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — the panel keeps the code selectable */
    }
  };

  return (
    // Header/footer rather than one meta ROW: a 6-wide render is ~40px, and a
    // single row of label + dims + two buttons forced the tile to ~184px, so
    // narrow loaders sat in mostly-empty boxes.
    <figure className="ld-size">
      <figcaption className="ld-size__head">
        <span className="ld-size__label">{label}</span>
        <span className="ld-size__dims">{cols}×{rows}</span>
      </figcaption>
      <div className="ld-size__stack" style={{ fontSize: `${fontSize}px` }}>
        <div className="ld-size__view" ref={setHost} />
        <div className="ld-size__ghost" ref={setGhost} aria-hidden="true" />
      </div>
      <div className="ld-size__foot">
        <button type="button" className="ld-mini" onClick={onCode} title={`Code for ${cols}×${rows}`} aria-label={`Code for ${cols}×${rows}`}>{"</>"}</button>
        <button type="button" className="ld-mini" onClick={copy} title={`Copy ${lang.toUpperCase()} for ${cols}×${rows}`} aria-label={`Copy ${cols}×${rows}`}>
          {copied ? "✓" : "⧉"}
        </button>
      </div>
    </figure>
  );
}

function LoaderThumb({ loader }: { loader: LoaderPreset }) {
  const [host, setHost] = useState<HTMLSpanElement | null>(null);
  useLoaderScene(host, loader, 16, 6);
  return <span className="ld-tile__thumb"><span className="ld-tile__glyph" ref={setHost} /></span>;
}

/** The loader's field-synth layer as a full patch — merged over the schema
 *  defaults so every voice key the cards read exists. */
function synthPatchOf(loader: LoaderPreset): Params {
  const layer = loader.layers.find((l) => l.effectId === "field-synth");
  return { ...synthDefaults(), ...(layer?.params ?? {}) } as Params;
}
function stockPatchesOf(loader: LoaderPreset): Record<number, Params> {
  const out: Record<number, Params> = {};
  loader.layers.forEach((l, i) => { if (l.effectId !== "field-synth") out[i] = { ...l.params } as Params; });
  return out;
}
const slotsOf = (params: Params): number[] =>
  Array.from({ length: MAX_VOICES }, (_, i) => i + 1).filter((k) => Number(params[`amp${k}`]) > 0);

export default function LoadersWorkbench() {
  const [loaderId, setLoaderId] = useState<string>(() => readUrlParam("l") ?? DEFAULT_LOADER);
  const loader = findLoader(loaderId);

  const [params, setParams] = useState<Params>(() => synthPatchOf(loader));
  const [stockParams, setStockParams] = useState<Record<number, Params>>(() => stockPatchesOf(loader));
  const [voiceSlots, setVoiceSlots] = useState<number[]>(() => slotsOf(synthPatchOf(loader)));
  const [timeScale, setTimeScale] = useState(1);
  const [paused, setPaused] = useState(false);
  const [fontSize, setFontSize] = useState(11);
  const [openSize, setOpenSize] = useState<{ cols: number; rows: number } | null>(null);
  const [lang, setLang] = useState<LoaderTab>("html");
  const [mobilePanel, setMobilePanel] = useState<string | null>(null);

  const voiceSlotsRef = useRef(voiceSlots); voiceSlotsRef.current = voiceSlots;
  const drive = useRef({ timeScale, paused });
  drive.current = { timeScale, paused };
  // The scope draws from its own rAF, so it needs always-fresh refs rather than
  // render-time values (same contract SynthDock passes to SynthScope).
  const paramsRef = useRef(params); paramsRef.current = params;
  // Hover lives in a ref, not state: the tick reads it every frame, and a
  // re-render per pointer move across 11 mounted scenes buys nothing.
  const highlight = useRef<{ slot: number | null; params: Params }>({ slot: null, params });
  highlight.current.params = params;
  const onVoiceHover = useCallback((slot: number | null) => { highlight.current.slot = slot; }, []);
  const tsRef = useRef(timeScale); tsRef.current = timeScale;
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const first = useRef(true);

  useEffect(() => {
    // Keep the default out of the URL so a fresh visit shares a clean link.
    if (first.current) { first.current = false; if (loaderId === DEFAULT_LOADER) return; }
    writeUrlParam("l", loaderId === DEFAULT_LOADER ? null : loaderId);
  }, [loaderId]);

  // Selecting a preset re-seeds every editable surface from it.
  const selectLoader = useCallback((id: string) => {
    const next = findLoader(id);
    setLoaderId(id);
    const patch = synthPatchOf(next);
    setParams(patch);
    setStockParams(stockPatchesOf(next));
    setVoiceSlots(slotsOf(patch));
    setOpenSize(null);
  }, []);

  const onParam = useCallback((key: string, value: ParamValue) => setParams((p) => ({ ...p, [key]: value })), []);
  const onLayerParam = useCallback((index: number, key: string, value: ParamValue) => {
    setStockParams((all) => ({ ...all, [index]: { ...(all[index] ?? {}), [key]: value } }));
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

  // What the stage renders: the edited field-synth patch plus each edited stock
  // layer, addressed by layer index.
  const layerParams = useMemo(() => {
    const out: Record<number, Params> = {};
    loader.layers.forEach((l, i) => { out[i] = l.effectId === "field-synth" ? params : (stockParams[i] ?? ({} as Params)); });
    return out;
  }, [loader, params, stockParams]);
  const live = useMemo<LiveEdits>(() => ({ layerParams, drive, highlight }), [layerParams]);

  const hasSynthLayer = loader.layers.some((l) => l.effectId === "field-synth");
  const spinners = LOADERS.filter((l) => l.kind === "spinner");
  const progress = LOADERS.filter((l) => l.kind === "progress");

  return (
    <InstrumentShell kind="synth">
      <InstrumentBody>
        <InstrumentRail
          id="loaders-voices-panel"
          title="Voices"
          action={<button className="voice-add" onClick={addVoice} disabled={!hasSynthLayer || voiceSlots.length >= MAX_VOICES}>+ Add</button>}
          open={mobilePanel === "voices"}
        >
          {hasSynthLayer
            ? <>
              {voiceSlots.map((slot, i) => (
                <VoiceCard key={slot} slot={slot} index={i} params={params} onParam={onParam} onRemove={() => removeVoice(slot)} onHover={onVoiceHover} />
              ))}
              {voiceSlots.length === 0 && <p className="synth-empty">No voices — add one to start.</p>}
            </>
            // scan / ripple / matrix-rain have no oscillators at all; their
            // controls live in the right rail, generated from their schema.
            : <p className="synth-empty">{loader.label} is a stock effect with no oscillators — its controls are in the right panel.</p>}
        </InstrumentRail>

        <InstrumentMain>
          <div className="ld-stage">
            <header className="ld-stage__head">
              <div className="ld-stage__titlerow">
                <h1 className="ld-stage__title">{loader.label}</h1>
                <span className="ld-stage__kind">{loader.kind === "progress" ? "determinate" : "indeterminate"}</span>
              </div>
            </header>

            <div className="ld-sizes">
              {LOADER_SIZES.map((s) => (
                <LoaderTile
                  key={`${loader.id}-${s.cols}x${s.rows}`}
                  loader={loader}
                  cols={s.cols}
                  rows={s.rows}
                  label={s.label}
                  lang={lang}
                  live={live}
                  fontSize={fontSize}
                  onCode={() => setOpenSize((cur) => (cur && cur.cols === s.cols && cur.rows === s.rows ? null : { cols: s.cols, rows: s.rows }))}
                />
              ))}
            </div>

            {openSize && (
              <LoaderCodePanel
                loader={loader}
                cols={openSize.cols}
                rows={openSize.rows}
                lang={lang}
                onLang={setLang}
                onClose={() => setOpenSize(null)}
              />
            )}
          </div>
        </InstrumentMain>

        <Dock id="loaders-controls-panel" className={mobilePanel === "controls" ? "is-mobile-open" : ""}>
          <LoadersDock
            loader={loader}
            params={params}
            onParam={onParam}
            layerParams={stockParams}
            onLayerParam={onLayerParam}
            timeScale={timeScale}
            onTimeScale={setTimeScale}
            paused={paused}
            onPaused={setPaused}
            density={fontSize}
            onDensity={setFontSize}
            paramsRef={paramsRef}
            tsRef={tsRef}
            pausedRef={pausedRef}
          />
        </Dock>
      </InstrumentBody>

      <InstrumentTray id="loaders-presets-panel" label="Loaders" open={mobilePanel === "presets"}>
        {[{ key: "spinner", label: "Indeterminate", items: spinners }, { key: "progress", label: "Determinate", items: progress }].map((group) => (
          <section className="ld-group" key={group.key}>
            <h2 className="ld-group__label">{group.label}</h2>
            <div className="ld-group__items">
              {group.items.map((l) => (
                <div key={l.id} className={`ld-tile${l.id === loader.id ? " is-active" : ""}`}>
                  <button
                    type="button"
                    className="ld-tile__pick"
                    aria-pressed={l.id === loader.id}
                    onClick={() => selectLoader(l.id)}
                  >
                    <LoaderThumb loader={l} />
                    <span className="ld-tile__label">{l.label}</span>
                  </button>
                </div>
              ))}
            </div>
          </section>
        ))}
      </InstrumentTray>

      <InstrumentMobileTabs label="Loader panels" items={[
        { id: "voices", label: "Voices", controls: "loaders-voices-panel", expanded: mobilePanel === "voices", onClick: () => setMobilePanel((c) => c === "voices" ? null : "voices") },
        { id: "controls", label: "Controls", controls: "loaders-controls-panel", expanded: mobilePanel === "controls", onClick: () => setMobilePanel((c) => c === "controls" ? null : "controls") },
        { id: "presets", label: "Loaders", controls: "loaders-presets-panel", expanded: mobilePanel === "presets", onClick: () => setMobilePanel((c) => c === "presets" ? null : "presets") },
      ]} />
    </InstrumentShell>
  );
}
