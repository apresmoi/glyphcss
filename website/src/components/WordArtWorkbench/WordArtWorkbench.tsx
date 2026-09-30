import { PRESETS } from "../../features/wordart/model/parameters";
import { ActionButton } from "../ActionButton";
import { Dock } from "../Dock";
import {
  InstrumentBody,
  InstrumentExportBar,
  InstrumentMain,
  InstrumentViewport,
  InstrumentMobileTabs,
  InstrumentRail,
  InstrumentWorkbench,
  PresetTray,
} from "../InstrumentWorkbench";
import { StatsOverlay } from "../StatsOverlay";
import { FontPicker } from "./FontPicker";
import { WordArtCodePanel } from "./WordArtCodePanel";
import { WordArtDock } from "./WordArtDock";
import { LiveEffectTile } from "./WordArtPresetTile";
import { WordArtRailControls } from "./WordArtRailControls";
import { Stage } from "./WordArtStage";
import styles from "./WordArtWorkbench.module.css";
import { useWordArtWorkbench } from "./hooks/useWordArtWorkbench";

export function WordArtWorkbench() {
  const view = useWordArtWorkbench();
  if (!view) return null;
  const {
    mobilePanel,
    text,
    setText,
    catalog,
    familyInput,
    pickFamily,
    leftValues,
    leftSet,
    setStageHost,
    stageHost,
    polygons,
    scaleX,
    scaleY,
    zoomScale,
    setZoomScale,
    turn,
    setTurn,
    tilt,
    setTilt,
    density,
    renderMode,
    charMode,
    hiddenLines,
    colorEncoding,
    setAtlasReason,
    perspective,
    lightDir,
    lightIntensity,
    lightColor,
    ambient,
    spin,
    effectDefinition,
    effectState,
    stageSnapshotRef,
    handleExportCodepenStatic,
    exporting,
    handleCopyAscii,
    copyState,
    handleDownloadSvg,
    svgState,
    codeOpen,
    toggleCodeOpen,
    setSpin,
    codeInput,
    handleExportCodepenDynamic,
    closeCodePanel,
    guiValues,
    guiSet,
    atlasReason,
    bezier,
    setBezier,
    handleEffectChange,
    updateEffectSettings,
    updateEffectParams,
    presetTiles,
    activePreset,
    applyPreset,
    previewFont,
    setMobilePanel,
    handleMobileExportTab,
  } = view;

  return (
    <InstrumentWorkbench kind="synth" className={`${styles.root} wa-shell dn-root--wordart`}>
      <InstrumentBody>
        <InstrumentRail id="wa-compose-panel" title="Text & Style" open={mobilePanel === "compose"}>
          <label className="wa-field">
            <span>Text</span>
            <textarea
              className="wa-input"
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
            />
          </label>
          <label className="wa-field">
            <span>Google font</span>
            <FontPicker catalog={catalog} value={familyInput} onPick={pickFamily} />
          </label>

          <Dock id="wa-rail-controls" inline>
            <WordArtRailControls left={leftValues} setLeft={leftSet} />
          </Dock>
        </InstrumentRail>

        <InstrumentMain elementRef={setStageHost}>
          {/* Anchored to the render area's top-left, clear of the left rail
              and the preset footer (it mounts imperatively, so it needs the
              host element rather than JSX placement). */}
          <StatsOverlay anchor="top-left" container={stageHost} />
          <InstrumentViewport>
            <Stage
              polygons={polygons}
              scaleXFrac={scaleX / 100}
              scaleYFrac={scaleY / 100}
              zoomScale={zoomScale}
              setZoomScale={setZoomScale}
              turn={turn}
              setTurn={setTurn}
              tilt={tilt}
              setTilt={setTilt}
              density={density}
              renderMode={renderMode}
              charMode={charMode}
              hiddenLines={hiddenLines}
              colorEncoding={colorEncoding}
              onAtlasAvailability={setAtlasReason}
              perspective={perspective}
              lightDir={lightDir}
              lightIntensity={lightIntensity}
              lightColor={lightColor}
              ambient={ambient}
              spin={spin}
              effectDefinition={effectDefinition}
              effectParams={effectState.params}
              effectBlend={effectState.blend}
              effectPaused={effectState.paused}
              effectTimeScale={effectState.timeScale}
              snapshotRef={stageSnapshotRef}
            />
          </InstrumentViewport>
          <InstrumentExportBar>
            <ActionButton
              type="button"
              className="gw-code-panel__action gw-code-panel__action--codepen"
              onClick={handleExportCodepenStatic}
              disabled={exporting}
              title="Open the current rendered word art as a static, zero-runtime CodePen"
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
            <ActionButton
              type="button"
              className={`gw-code-panel__action${!spin && turn === 0 && tilt === 0 ? " is-active" : ""}`}
              onClick={() => {
                setSpin(false);
                setTurn(0);
                setTilt(0);
              }}
              title="Stop auto-rotate and reset to a flat, front-facing view"
            >
              Still · front face
            </ActionButton>
            <ActionButton
              type="button"
              className={`gw-code-panel__action${spin ? " is-active" : ""}`}
              onClick={() => setSpin(true)}
              title="Auto-rotate the mesh"
            >
              Auto rotate
            </ActionButton>
          </InstrumentExportBar>
          {(codeOpen || mobilePanel === "export") && (
            <WordArtCodePanel
              id="wa-export-panel"
              input={codeInput}
              onCodepen={handleExportCodepenDynamic}
              exporting={exporting}
              onClose={closeCodePanel}
            />
          )}
        </InstrumentMain>

        <Dock id="wa-controls-panel" className={mobilePanel === "controls" ? "is-mobile-open" : ""}>
          <WordArtDock
            gui={guiValues}
            setGui={guiSet}
            atlasReason={atlasReason}
            bezier={bezier}
            onBezier={setBezier}
            effectState={effectState}
            effectDefinition={effectDefinition}
            onEffectChange={handleEffectChange}
            onUpdateEffectSettings={updateEffectSettings}
            onUpdateEffectParams={updateEffectParams}
          />
        </Dock>
      </InstrumentBody>

      <PresetTray id="wa-presets-panel" label="Style presets" open={mobilePanel === "presets"}>
        {PRESETS.map((p) => {
          const tile = presetTiles?.get(p.label);
          return (
            <button
              key={p.label}
              type="button"
              className={`wa-tile ${activePreset === p.label ? "is-active" : ""}`}
              onClick={() => applyPreset(p)}
              title={`Apply “${p.label}”`}
            >
              <span className="wa-tile__thumb">
                {p.effect && previewFont ? (
                  <LiveEffectTile
                    font={previewFont}
                    preset={p}
                    mode={p.mode ?? renderMode}
                    charMode={p.charMode ?? charMode}
                  />
                ) : (
                  /* `tile.html` (not `.inner`) — the `<pre class="glyph-output">` wrapper
                     carries the base stylesheet's `white-space: pre` + monospace
                     font, which the raw newline-joined grid string needs to lay out
                     as rows instead of collapsing/wrapping like normal text. */
                  tile && <span className="wa-tile__glyph" dangerouslySetInnerHTML={{ __html: tile.html }} />
                )}
              </span>
              <span className="wa-tile__label">{p.label}</span>
            </button>
          );
        })}
      </PresetTray>

      <InstrumentMobileTabs
        label="WordArt panels"
        items={[
          {
            id: "compose",
            label: "Style",
            controls: "wa-compose-panel",
            expanded: mobilePanel === "compose",
            onClick: () => setMobilePanel((cur) => (cur === "compose" ? null : "compose")),
          },
          {
            id: "controls",
            label: "Controls",
            controls: "wa-controls-panel",
            expanded: mobilePanel === "controls",
            onClick: () => setMobilePanel((cur) => (cur === "controls" ? null : "controls")),
          },
          {
            id: "presets",
            label: "Presets",
            controls: "wa-presets-panel",
            expanded: mobilePanel === "presets",
            onClick: () => setMobilePanel((cur) => (cur === "presets" ? null : "presets")),
          },
          {
            id: "export",
            label: "Export",
            controls: "wa-export-panel",
            expanded: mobilePanel === "export",
            onClick: handleMobileExportTab,
          },
        ]}
      />
    </InstrumentWorkbench>
  );
}
