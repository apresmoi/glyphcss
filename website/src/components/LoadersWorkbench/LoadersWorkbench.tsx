import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LoaderTab } from "../../features/loaders/export/loaderSnippets";
import { type LiveEdits } from "../../features/loaders/model/liveEdits";
import { DEFAULT_LOADER, findLoader, LOADER_SIZES, LOADERS } from "../../features/loaders/model/loaders";
import { slotsOf, stockPatchesOf, synthPatchOf } from "../../features/loaders/model/patches";
import { type Params, type ParamValue, MAX_VOICES } from "../../features/synth/model/parameters";
import { defaultGlyphColorEncoding } from "../../services/rendering/glyphColorEncodingDefault";
import { readUrlParam, writeUrlParam } from "../../services/url-state/history";
import { ActionButton } from "../ActionButton";
import { Dock } from "../Dock";
import {
  InstrumentBody,
  InstrumentMain,
  InstrumentMobileTabs,
  InstrumentRail,
  InstrumentWorkbench,
  PresetTray,
} from "../InstrumentWorkbench";
import { VoiceCard } from "../VoiceCard";
import { LoaderCodePanel } from "./LoaderCodePanel";
import { LoadersDock } from "./LoadersDock";
import styles from "./LoadersWorkbench.module.css";
import { LoaderThumb, LoaderTile } from "./LoaderTile";

export default function LoadersWorkbench() {
  const [loaderId, setLoaderId] = useState<string>(() => readUrlParam("l") ?? DEFAULT_LOADER);
  const loader = findLoader(loaderId);

  const [params, setParams] = useState<Params>(() => synthPatchOf(loader));
  const [stockParams, setStockParams] = useState<Record<number, Params>>(() => stockPatchesOf(loader));
  const [voiceSlots, setVoiceSlots] = useState<number[]>(() => slotsOf(synthPatchOf(loader)));
  const [timeScale, setTimeScale] = useState(1);
  const [paused, setPaused] = useState(false);
  // `colorEncoding: "atlas"` — not URL-persisted, matching every other Dock
  // control here except `loaderId` (`?l=`). `atlasReason` is the real reason
  // it isn't available right now (`null` when it is), reported by whichever
  // live size tile's `MutationObserver` last recomputed it — see
  // `useLoaderScene`'s own recompute logic.
  const [colorEncoding, setColorEncoding] = useState<"spans" | "atlas">(defaultGlyphColorEncoding);
  const [atlasReason, setAtlasReason] = useState<string | null>("Nothing rendered yet.");
  const colorEncodingRef = useRef(colorEncoding);
  colorEncodingRef.current = colorEncoding;
  const [fontSize, setFontSize] = useState(11);
  const [openSize, setOpenSize] = useState<{ cols: number; rows: number } | null>(null);
  const [lang, setLang] = useState<LoaderTab>("html");
  const [mobilePanel, setMobilePanel] = useState<string | null>(null);

  const voiceSlotsRef = useRef(voiceSlots);
  voiceSlotsRef.current = voiceSlots;
  const drive = useRef({ timeScale, paused });
  drive.current = { timeScale, paused };
  // The scope draws from its own rAF, so it needs always-fresh refs rather than
  // render-time values (same contract SynthDock passes to SynthScope).
  const paramsRef = useRef(params);
  paramsRef.current = params;
  // Hover lives in a ref, not state: the tick reads it every frame, and a
  // re-render per pointer move across 11 mounted scenes buys nothing.
  const highlight = useRef<{ slot: number | null; params: Params }>({ slot: null, params });
  highlight.current.params = params;
  const onVoiceHover = useCallback((slot: number | null) => {
    highlight.current.slot = slot;
  }, []);
  const tsRef = useRef(timeScale);
  tsRef.current = timeScale;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const first = useRef(true);

  useEffect(() => {
    // Keep the default out of the URL so a fresh visit shares a clean link.
    if (first.current) {
      first.current = false;
      if (loaderId === DEFAULT_LOADER) return;
    }
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
    for (let k = 1; k <= MAX_VOICES; k++)
      if (!slots.includes(k)) {
        slot = k;
        break;
      }
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
    loader.layers.forEach((l, i) => {
      out[i] = l.effectId === "field-synth" ? params : (stockParams[i] ?? ({} as Params));
    });
    return out;
  }, [loader, params, stockParams]);
  const live = useMemo<LiveEdits>(
    () => ({
      layerParams,
      drive,
      highlight,
      colorEncoding: colorEncodingRef,
      onAtlasAvailability: setAtlasReason,
    }),
    [layerParams],
  );

  const hasSynthLayer = loader.layers.some((l) => l.effectId === "field-synth");
  const spinners = LOADERS.filter((l) => l.kind === "spinner");
  const progress = LOADERS.filter((l) => l.kind === "progress");

  return (
    <InstrumentWorkbench embedded kind="synth" className={styles.root}>
      <InstrumentBody>
        <InstrumentRail
          id="loaders-voices-panel"
          title="Voices"
          action={
            <ActionButton
              className="voice-add"
              onClick={addVoice}
              disabled={!hasSynthLayer || voiceSlots.length >= MAX_VOICES}
            >
              + Add
            </ActionButton>
          }
          open={mobilePanel === "voices"}
        >
          {hasSynthLayer ? (
            <>
              {voiceSlots.map((slot, i) => (
                <VoiceCard
                  key={slot}
                  slot={slot}
                  index={i}
                  params={params}
                  onParam={onParam}
                  onRemove={() => removeVoice(slot)}
                  onHover={onVoiceHover}
                />
              ))}
              {voiceSlots.length === 0 && <p className="synth-empty">No voices — add one to start.</p>}
            </>
          ) : (
            // scan / ripple / matrix-rain have no oscillators at all; their
            // controls live in the right rail, generated from their schema.
            <p className="synth-empty">
              {loader.label} is a stock effect with no oscillators — its controls are in the right panel.
            </p>
          )}
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
                  onCode={() =>
                    setOpenSize((cur) =>
                      cur && cur.cols === s.cols && cur.rows === s.rows ? null : { cols: s.cols, rows: s.rows },
                    )
                  }
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
            colorEncoding={colorEncoding}
            onColorEncoding={setColorEncoding}
            atlasReason={atlasReason}
            paramsRef={paramsRef}
            tsRef={tsRef}
            pausedRef={pausedRef}
          />
        </Dock>
      </InstrumentBody>

      <PresetTray id="loaders-presets-panel" label="Loaders" open={mobilePanel === "presets"}>
        {[
          { key: "spinner", label: "Indeterminate", items: spinners },
          { key: "progress", label: "Determinate", items: progress },
        ].map((group) => (
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
      </PresetTray>

      <InstrumentMobileTabs
        label="Loader panels"
        items={[
          {
            id: "voices",
            label: "Voices",
            controls: "loaders-voices-panel",
            expanded: mobilePanel === "voices",
            onClick: () => setMobilePanel((c) => (c === "voices" ? null : "voices")),
          },
          {
            id: "controls",
            label: "Controls",
            controls: "loaders-controls-panel",
            expanded: mobilePanel === "controls",
            onClick: () => setMobilePanel((c) => (c === "controls" ? null : "controls")),
          },
          {
            id: "presets",
            label: "Loaders",
            controls: "loaders-presets-panel",
            expanded: mobilePanel === "presets",
            onClick: () => setMobilePanel((c) => (c === "presets" ? null : "presets")),
          },
        ]}
      />
    </InstrumentWorkbench>
  );
}
