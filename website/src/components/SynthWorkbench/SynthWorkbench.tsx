import { MAX_LAYERS, MAX_VOICES } from "../../features/synth/model/parameters";
import { ActionButton } from "../ActionButton";
import { Dock } from "../Dock";
import { IconToggle } from "../IconToggle";
import {
  InstrumentBody,
  InstrumentExportBar,
  InstrumentMain,
  InstrumentMobileTabs,
  InstrumentRail,
  InstrumentViewport,
  InstrumentWorkbench,
  PresetTray,
} from "../InstrumentWorkbench";
import { StatsOverlay } from "../StatsOverlay";
import { VOICE_MODE_TOGGLE, VoiceCard, type VoiceDisplayMode } from "../VoiceCard";
import { ColorStackSection } from "./ColorStackSection";
import { useSynthWorkbench } from "./hooks/useSynthWorkbench";
import { LayerGroup } from "./LayerGroup";
import { PresetTile } from "./PresetTile";
import { SynthCodePanel } from "./SynthCodePanel";
import { SynthDock } from "./SynthDock";

export default function SynthWorkbench() {
  const view = useSynthWorkbench();
  if (!view) return null;
  const {
    voiceMode,
    setAllVoiceModes,
    addVoice,
    voiceSlots,
    mobilePanel,
    params,
    onParam,
    addVoiceToLayer,
    removeVoice,
    shape,
    voiceModeOverrides,
    setVoiceCardMode,
    setStageHost,
    hostRef,
    stageHost,
    handleExportCodepenStatic,
    exporting,
    staticExportSupported,
    staticExportUnsupportedReason,
    handleCopyAscii,
    copyState,
    handleDownloadSvg,
    svgState,
    codeOpen,
    toggleCodeOpen,
    codeInput,
    handleExportCodepenDynamic,
    closeCodePanel,
    setShape,
    timeScale,
    setTimeScale,
    paused,
    setPaused,
    orbitAuto,
    setOrbitAuto,
    orbitSpeed,
    setOrbitSpeed,
    density,
    setDensity,
    colorTolerance,
    setColorTolerance,
    colorEncoding,
    setColorEncoding,
    atlasReason,
    lighting,
    setLighting,
    paramsRef,
    tsRef,
    pausedRef,
    presets,
    applyPreset,
    setMobilePanel,
    handleMobileExportTab,
  } = view;

  return (
    <InstrumentWorkbench kind="synth">
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
              <ActionButton className="voice-add" onClick={addVoice} disabled={voiceSlots.length >= MAX_VOICES}>
                + Add
              </ActionButton>
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
              <LayerGroup
                key={layer}
                layer={layer}
                params={params}
                onParam={onParam}
                onAddVoice={addVoiceToLayer}
                canAddVoice={voiceSlots.length < MAX_VOICES}
              >
                {slots.map((slot) => (
                  <VoiceCard
                    key={slot}
                    slot={slot}
                    index={voiceSlots.indexOf(slot)}
                    params={params}
                    onParam={onParam}
                    onRemove={() => removeVoice(slot)}
                    stageShape={shape}
                    hoverToAnimate
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
          <InstrumentExportBar>
            <ActionButton
              type="button"
              className="gw-code-panel__action gw-code-panel__action--codepen"
              onClick={handleExportCodepenStatic}
              disabled={exporting || !staticExportSupported}
              title={
                staticExportUnsupportedReason === null
                  ? "Open the current rendered patch as a static, zero-runtime CodePen"
                  : `Can't export a static, zero-runtime CodePen: ${staticExportUnsupportedReason} Use "Export" instead, which ships a live effect from the CDN.`
              }
            >
              {exporting ? "Exporting…" : "Open in CodePen"}
            </ActionButton>
            <ActionButton
              type="button"
              className="gw-code-panel__action"
              onClick={handleCopyAscii}
              title="Copy the rendered ASCII art to the clipboard"
            >
              {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy ASCII"}
            </ActionButton>
            <ActionButton
              type="button"
              className="gw-code-panel__action"
              onClick={handleDownloadSvg}
              title="Download the rendered glyph output as an SVG file"
            >
              {svgState === "downloaded" ? "Downloaded" : svgState === "error" ? "Download failed" : "Download SVG"}
            </ActionButton>
            <ActionButton
              data-export-trigger
              type="button"
              className={`gw-code-panel__action${codeOpen ? " is-active" : ""}`}
              onClick={toggleCodeOpen}
              aria-expanded={codeOpen}
              title={codeOpen ? "Close export code window" : "Open export code window"}
            >
              Export
            </ActionButton>
          </InstrumentExportBar>
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
          <SynthDock
            shape={shape}
            onShape={setShape}
            timeScale={timeScale}
            onTimeScale={setTimeScale}
            paused={paused}
            onPaused={setPaused}
            orbitAuto={orbitAuto}
            onOrbitAuto={setOrbitAuto}
            orbitSpeed={orbitSpeed}
            onOrbitSpeed={setOrbitSpeed}
            density={density}
            onDensity={setDensity}
            colorTolerance={colorTolerance}
            onColorTolerance={setColorTolerance}
            colorEncoding={colorEncoding}
            onColorEncoding={setColorEncoding}
            atlasReason={atlasReason}
            lighting={lighting}
            onLight={(partial) => setLighting((l) => ({ ...l, ...partial }))}
            params={params}
            onParam={onParam}
            paramsRef={paramsRef}
            tsRef={tsRef}
            pausedRef={pausedRef}
            hostRef={hostRef}
          />
        </Dock>
      </InstrumentBody>
      <PresetTray id="synth-presets-panel" label="Pattern presets" open={mobilePanel === "presets"}>
        {presets.map((p) => (
          <PresetTile key={p.name} preset={p} onApply={() => applyPreset(p)} />
        ))}
      </PresetTray>
      <InstrumentMobileTabs
        label="Synth panels"
        items={[
          {
            id: "voices",
            label: "Voices",
            controls: "synth-voices-panel",
            expanded: mobilePanel === "voices",
            onClick: () => setMobilePanel((current) => (current === "voices" ? null : "voices")),
          },
          {
            id: "controls",
            label: "Controls",
            controls: "synth-controls-panel",
            expanded: mobilePanel === "controls",
            onClick: () => setMobilePanel((current) => (current === "controls" ? null : "controls")),
          },
          {
            id: "presets",
            label: "Presets",
            controls: "synth-presets-panel",
            expanded: mobilePanel === "presets",
            onClick: () => setMobilePanel((current) => (current === "presets" ? null : "presets")),
          },
          {
            id: "export",
            label: "Export",
            controls: "synth-export-panel",
            expanded: mobilePanel === "export",
            onClick: handleMobileExportTab,
          },
        ]}
      />
    </InstrumentWorkbench>
  );
}
