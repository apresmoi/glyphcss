import { isOrbitProjectionId } from "../../features/maps/model/config";
import { mapShadowCasterReason, mapSunManualFields } from "../../features/maps/model/lighting";
import { type MapCharMode, type MapColorEncoding } from "../../features/maps/services/mapsUrlState";
import { mapWalkBudgetLabel } from "../../features/maps/services/mapsWalk";
import { ActionButton } from "../ActionButton";
import { CodePanel } from "../CodePanel";
import { Dock } from "../Dock";
import {
  InstrumentBody,
  InstrumentExportBar,
  InstrumentMain,
  InstrumentMobileTabs,
  InstrumentRail,
  InstrumentViewport,
  InstrumentWorkbench,
} from "../InstrumentWorkbench";
import { StatsOverlay } from "../StatsOverlay";
import { useMapsWorkbench } from "./hooks/useMapsWorkbench";
import { LayersPanel } from "./LayersPanel";
import { MapCompass } from "./MapCompass";
import { MapCredits } from "./MapCredits";
import { MapMinimap } from "./MapMinimap";
import { MapsDockFolders } from "./MapsDockFolders";
import { MapSearchBox } from "./MapSearchBox";
import styles from "./MapsWorkbench.module.css";
import { MapWalkButton } from "./MapWalkButton";

export default function MapsWorkbench() {
  const view = useMapsWorkbench();
  if (!view) return null;
  const {
    handleCopyAscii,
    copyState,
    handleDownloadSvg,
    svgState,
    mobilePanel,
    layersFolderInputs,
    setStageHost,
    hostRef,
    providerError,
    stageHost,
    loadSearchIndex,
    flyToSearchResult,
    getSearchView,
    tilt,
    bearing,
    projectionId,
    onResetOrientation,
    walkOn,
    walkGateReason,
    setWalkOn,
    minimapOn,
    osmSource,
    centerLon,
    centerLat,
    codeOpen,
    toggleCodeOpen,
    attributions,
    mapsSnippets,
    setProjectionId,
    span,
    maxSpan,
    maxTilt,
    lod,
    degPerCell,
    onCenter,
    onSpanChange,
    onTilt,
    onBearing,
    charMode,
    charModeReason,
    wireframeJunctions,
    hiddenLines,
    solidWeightRamp,
    colorEncoding,
    atlasReason,
    density,
    dragDensity,
    useColors,
    smoothShading,
    setCharMode,
    setWireframeJunctions,
    setHiddenLines,
    setSolidWeightRamp,
    setColorEncoding,
    setDensity,
    setDragDensity,
    setUseColors,
    setSmoothShading,
    lighting,
    setLighting,
    sunMode,
    sunDay,
    sunHour,
    shadows,
    setShadows,
    extraVisible,
    showOsm,
    osmSublayers,
    setSunDay,
    setSunHour,
    setSunMode,
    setMobilePanel,
  } = view;

  // The two RENDER exports, as one element rendered in two places: the
  // desktop export bar over the viewport, and the code window's own action
  // row (which is the only one of the two that survives the mobile
  // breakpoint). One definition, so the pair can never diverge.
  const renderExportActions = (
    <>
      <ActionButton
        type="button"
        className="gw-code-panel__action"
        onClick={handleCopyAscii}
        title="Copy the rendered ASCII map to the clipboard. Text is one character grid, so this is the BASE grid — a layer rendering at its own density has a grid of its own and cannot be merged into it. Download SVG carries every layer."
      >
        {copyState === "copied" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy ASCII"}
      </ActionButton>
      <ActionButton
        type="button"
        className="gw-code-panel__action"
        onClick={handleDownloadSvg}
        title="Download the rendered map as an SVG file — every layer, each at its own density"
      >
        {svgState === "downloaded" ? "Downloaded" : svgState === "error" ? "Download failed" : "Download SVG"}
      </ActionButton>
    </>
  );

  return (
    <InstrumentWorkbench kind="synth" className={styles.root}>
      <InstrumentBody>
        <InstrumentRail id="maps-layers-panel" title="Layers" open={mobilePanel === "layers"}>
          <LayersPanel {...layersFolderInputs} />
        </InstrumentRail>
        <InstrumentMain elementRef={setStageHost}>
          <InstrumentViewport className="maps-viewport" elementRef={hostRef} />
          {providerError && <div className="maps-error">Couldn&apos;t load terrain data: {providerError}</div>}
          <StatsOverlay anchor="top-left" container={stageHost} />
          <MapSearchBox loadIndex={loadSearchIndex} onSelect={flyToSearchResult} getView={getSearchView} />
          <MapCompass
            tilt={tilt}
            bearing={bearing}
            isOrbitProjection={isOrbitProjectionId(projectionId)}
            onReset={onResetOrientation}
          />
          {/* Bottom right, the one map corner nothing else on this page
              claims — the entrance to street level, always present and
              greyed with its reason when the view is too high for it.
              `mapsKit.tsx`'s View folder carries the argument for why it is
              no longer a Dock row. */}
          <MapWalkButton walking={walkOn} reason={walkGateReason} budget={mapWalkBudgetLabel()} onToggle={setWalkOn} />
          {/* Bottom left, above the export bar — the plan view that says WHERE
              the street-level picture is. It owns a second `createGlyphMap`
              off this page's ONE OSM source, and takes its pose from the same
              rAF-throttled `syncViewState` state the Dock readouts do, gated
              by `mapsMinimap.ts`'s update rule (`MapMinimap.tsx`). */}
          <MapMinimap
            visible={minimapOn}
            walking={walkOn}
            source={osmSource}
            projectionId={projectionId}
            centerLon={centerLon}
            centerLat={centerLat}
            bearing={bearing}
          />
          <InstrumentExportBar>
            {renderExportActions}
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
          {/* One compact line naming the sources that legally have to be
              named, with the full notice (every source, licence, date and
              link) one tap behind it — `mapsCredits.ts` carries the licence
              argument and the measurements. Still derived from the mounted
              layers via `getAttributions()`. */}
          <MapCredits sources={attributions} />
          {(codeOpen || mobilePanel === "code") && (
            <CodePanel
              id="maps-code-panel"
              className={mobilePanel === "code" ? "is-mobile-open" : ""}
              snippets={mapsSnippets}
              onClose={() => {
                if (codeOpen) toggleCodeOpen();
                setMobilePanel(null);
              }}
            />
          )}
        </InstrumentMain>
        <Dock id="maps-controls-panel" className={mobilePanel === "controls" ? "is-mobile-open" : ""}>
          <MapsDockFolders
            projectionId={projectionId}
            onProjectionId={setProjectionId}
            centerLon={centerLon}
            centerLat={centerLat}
            span={span}
            maxSpan={maxSpan}
            tilt={tilt}
            maxTilt={maxTilt}
            bearing={bearing}
            lod={lod}
            degPerCell={degPerCell}
            onCenter={onCenter}
            onSpan={onSpanChange}
            onTilt={onTilt}
            onBearing={onBearing}
            charMode={charMode}
            charModeReason={charModeReason}
            wireframeJunctions={wireframeJunctions}
            hiddenLines={hiddenLines}
            solidWeightRamp={solidWeightRamp}
            colorEncoding={colorEncoding}
            atlasReason={atlasReason}
            density={density}
            dragDensity={dragDensity}
            useColors={useColors}
            smoothShading={smoothShading}
            onUpdateRendering={(partial) => {
              if (partial.charMode !== undefined) setCharMode(partial.charMode as MapCharMode);
              if (partial.wireframeJunctions !== undefined) setWireframeJunctions(partial.wireframeJunctions);
              if (partial.hiddenLines !== undefined) setHiddenLines(partial.hiddenLines);
              if (partial.solidWeightRamp !== undefined) setSolidWeightRamp(partial.solidWeightRamp);
              if (partial.colorEncoding !== undefined) setColorEncoding(partial.colorEncoding as MapColorEncoding);
              if (partial.density !== undefined) setDensity(partial.density);
              if (partial.dragDensity !== undefined) setDragDensity(partial.dragDensity);
              if (partial.useColors !== undefined) setUseColors(partial.useColors);
              if (partial.smoothShading !== undefined) setSmoothShading(partial.smoothShading);
            }}
            lighting={lighting}
            onUpdateLighting={(partial) => setLighting((l) => ({ ...l, ...partial }))}
            sunMode={sunMode}
            sunDay={sunDay}
            sunHour={sunHour}
            shadows={shadows}
            onShadows={setShadows}
            shadowCasterReason={mapShadowCasterReason(extraVisible, showOsm, osmSublayers)}
            onSunMode={(mode) => {
              // Entering manual SEEDS the day/hour from the real clock, so
              // the sun stays where it was instead of jumping to whatever
              // instant a stale slider pair happens to name.
              if (mode === "manual" && sunMode !== "manual") {
                const seeded = mapSunManualFields(Date.now());
                setSunDay(seeded.day);
                setSunHour(Math.round(seeded.hour * 4) / 4);
              }
              setSunMode(mode);
            }}
            onSunDay={setSunDay}
            onSunHour={setSunHour}
          />
        </Dock>
      </InstrumentBody>
      <InstrumentMobileTabs
        label="Maps panels"
        items={[
          {
            id: "layers",
            label: "Layers",
            controls: "maps-layers-panel",
            expanded: mobilePanel === "layers",
            onClick: () => setMobilePanel((c) => (c === "layers" ? null : "layers")),
          },
          {
            id: "controls",
            label: "Controls",
            controls: "maps-controls-panel",
            expanded: mobilePanel === "controls",
            onClick: () => setMobilePanel((c) => (c === "controls" ? null : "controls")),
          },
          {
            id: "code",
            label: "Export",
            controls: "maps-code-panel",
            expanded: mobilePanel === "code",
            onClick: () => setMobilePanel((c) => (c === "code" ? null : "code")),
          },
        ]}
      />
    </InstrumentWorkbench>
  );
}
