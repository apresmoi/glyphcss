import { CHARTS_3D_REMOTE_DATASET_INDEX } from "../../features/charts/data/chart3dRemoteIndex";
import { type ChartsWorkbenchState, CHART_PRESETS } from "../../features/charts/model/chartsSpec";
import { CHARTS_3D_DATASETS } from "../../features/charts/model/chartsWorkbenchState";
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
  PresetTray,
} from "../InstrumentWorkbench";
import { TargetPreview } from "../TargetPreview";
import { Charts3dViewport } from "./Charts3dViewport";
import { ChartsDataFolder } from "./ChartsDataFolder";
import { ChartsDataOverlay } from "./ChartsDataOverlay";
import { ChartsDock } from "./ChartsDock";
import { ChartsMarkCard } from "./ChartsMarkCard";
import styles from "./ChartsWorkbench.module.css";
import { EXPORT_FORMATS } from "./controllerHelpers";
import { useChartsWorkbench } from "./hooks/useChartsWorkbench";
import { useChartsWorkbenchInner } from "./hooks/useChartsWorkbenchInner";

export default function ChartsWorkbench({ initialState }: { initialState?: ChartsWorkbenchState } = {}) {
  const view = useChartsWorkbench({ initialState });
  if (!view) return null;
  const { resolved, notice, remoteRef } = view;

  return <ChartsWorkbenchInner initialState={resolved} initialNotice={notice} initialRemoteRef={remoteRef} />;
}

function ChartsWorkbenchInner({
  initialState,
  initialNotice,
  initialRemoteRef,
}: {
  initialState: ChartsWorkbenchState;
  initialNotice?: string;
  initialRemoteRef?: string;
}) {
  const view = useChartsWorkbenchInner({ initialState, initialNotice, initialRemoteRef });
  if (!view) return null;
  const {
    is3d,
    chart3dResolvedLive,
    logicalRendered,
    copy,
    copyAsciiState,
    resolvedControls,
    state,
    copyAnsiState,
    copyLink,
    copyLinkState,
    isWeb3d,
    rendered,
    download,
    downloadState,
    railTitle,
    mobilePanel,
    omittedNote,
    chart3dResolved,
    remoteLoadingTitle,
    datasetNotice,
    markTypeFits,
    markTypeThumbnails,
    seriesPreview,
    colorDisabled,
    chart3dMarkType,
    chart3dFits,
    dispatch,
    chartsViewportRef,
    chart3dSceneOptions,
    chart3dViewportRef,
    chart3dViewportHandleRef,
    isViewportStale,
    isRemoteLoading,
    preRef,
    chart3dDisplay,
    displayRendered,
    densityStyle,
    activeDatasetId,
    overlayDispatch,
    loadRemote3dDataset,
    loadRemoteDataset,
    handleRandomDataset,
    codeOpen,
    setMobilePanel,
    setCodeOpen,
    snippets,
    thumbnails,
    thumbnails3d,
    togglePanel,
  } = view;

  const exportActions = (
    <>
      {/* `chart3dResolvedLive.ok` is the same cheap (no-rasterize) check the
       *  live viewport itself gates its own mount on (this file's own JSX,
       *  below) — good enough to decide whether Copy CAN plausibly build
       *  something, without paying for the build just to draw a button;
       *  `copy()`'s own doc above covers the rare click that still fails. */}
      <ActionButton
        type="button"
        className="gw-code-panel__action"
        disabled={is3d ? !chart3dResolvedLive.ok : !logicalRendered.ok}
        onClick={() => void copy("ascii")}
      >
        {copyAsciiState === "copied" ? "Copied" : copyAsciiState === "error" ? "Copy failed" : "Copy ASCII"}
      </ActionButton>
      {/* Hidden on `chat` (CHARTS-RESEARCH `DIAGNOSIS-target-matrix.md` C3):
       *  a chat paste shows SGR escapes as literal `\x1b[38;2;…m` text, so
       *  offering this export on a target that can never consume it is a
       *  trap, not a convenience — Copy ASCII (above) is the honest export
       *  there. Gated on `logicalRendered` (not `rendered`) since that is
       *  what `copy("ansi")` actually reads — colour mode, not density,
       *  decides whether ANSI text exists, so the two agree in practice.
       *  3D mirrors the same colour-mode condition the removed
       *  `chart3dCopyAnsi` memo used to gate its own build on. */}
      {(is3d
        ? chart3dResolvedLive.ok && resolvedControls.color !== "none" && resolvedControls.color !== "css"
        : logicalRendered.ok && logicalRendered.ansi !== undefined) &&
        state.controls.target !== "chat" && (
          <ActionButton type="button" className="gw-code-panel__action" onClick={() => void copy("ansi")}>
            {copyAnsiState === "copied" ? "Copied" : copyAnsiState === "error" ? "Copy failed" : "Copy ANSI"}
          </ActionButton>
        )}
      <ActionButton type="button" className="gw-code-panel__action" onClick={() => void copyLink()}>
        {copyLinkState === "copied"
          ? "Copied"
          : copyLinkState === "error"
            ? "Copy failed"
            : copyLinkState === "toolarge"
              ? "Too large"
              : "Copy link"}
      </ActionButton>
      {/* SVG export reads `preRef`, which only the 2D `<pre>`/static-frame
       *  `TargetPreview` is wired to — the live 3D scene writes its own
       *  separate `<pre>` inside `Charts3dViewport` with no ref for this to
       *  reach; Copy ASCII/ANSI (above) are the 3D export. */}
      {!isWeb3d && (
        <ActionButton type="button" className="gw-code-panel__action" disabled={!rendered.ok} onClick={download}>
          {downloadState === "downloaded"
            ? "Downloaded"
            : downloadState === "error"
              ? "Download failed"
              : "Download SVG"}
        </ActionButton>
      )}
    </>
  );

  return (
    <InstrumentWorkbench kind="synth" className={`${styles.root} charts-shell`}>
      <InstrumentBody>
        {/* Data is this page's own "model" (AGENTS.md's "Charts" — "Data
         *  layer"): the rail carries the dataset CARD (title, description,
         *  source credit, a read-only "View data" disclosure) as its own
         *  first thing, then the Marks section — no add/remove-mark
         *  controls, this is a showcase of one chart at a time, not a
         *  builder. The dataset SEARCH box, the stock `<select>` and
         *  "Random" moved OFF this rail and onto the chart VIEWPORT as one
         *  overlay bar (`ChartsDataOverlay`, below) — the same chrome-on-
         *  the-render idiom `/maps` uses for its own place search. Picking a
         *  dataset from either control REPLACES the chart immediately
         *  (`select-dataset`/`select-remote-dataset`), no separate Apply
         *  step. */}
        <InstrumentRail
          id="charts-data-panel"
          title={
            railTitle && (
              <span className="charts-data-title" title={railTitle}>
                {railTitle}
              </span>
            )
          }
          open={mobilePanel === "data"}
        >
          <ChartsDataFolder
            data={state.data}
            marks={state.marks}
            omittedNote={omittedNote}
            dimension={state.dimension}
            chart3dSource={state.chart3d.source}
            chart3d={
              chart3dResolved.ok
                ? {
                    title: chart3dResolved.resolved.title,
                    description: chart3dResolved.resolved.description,
                    source: chart3dResolved.resolved.source,
                  }
                : null
            }
            loadingTitle={remoteLoadingTitle}
            notice={datasetNotice}
            renderError={!rendered.ok ? rendered.error : undefined}
          />
          <div className="charts-marks-section">
            {state.marks.map((mark, index) => (
              <ChartsMarkCard
                key={mark.id}
                mark={mark}
                index={index}
                markCount={state.marks.length}
                typeFits={markTypeFits[index]!}
                typeThumbnails={markTypeThumbnails[index]}
                series={seriesPreview}
                colorDisabled={colorDisabled}
                dimension={index === 0 ? state.dimension : undefined}
                chart3dMarkType={index === 0 ? chart3dMarkType : undefined}
                chart3dFits={index === 0 ? chart3dFits : undefined}
                chart3d={index === 0 && state.dimension === "3d" ? state.chart3d : undefined}
                dispatch={dispatch}
              />
            ))}
          </div>
        </InstrumentRail>
        <InstrumentMain>
          <InstrumentViewport inset className="charts-viewport" elementRef={chartsViewportRef}>
            <div className="charts-preview">
              {isWeb3d ? (
                // The live orbitable scene (web only, AGENTS.md's "Charts 3D"
                // export boundary) — colour honoured through
                // `chart3dSceneOptions` (`useColors`); the viewport itself
                // never shows a note about an unsupported charset (C3 fix
                // round 2 — that reason lives on the Dock's own dimmed
                // Charset toggle instead, "the viewport holds only the
                // render" below). `chart3dResolvedLive`, not `chart3dResolved`,
                // supplies the mark — its own `shading: "auto"` resolution
                // reads the LIVE scene's `useColors`, see that memo's doc.
                chart3dResolvedLive.ok ? (
                  <Charts3dViewport
                    mark={chart3dResolvedLive.resolved.mark}
                    camera={state.chart3d.camera}
                    orbitMode={state.chart3d.orbitMode}
                    charset={resolvedControls.charset}
                    sceneOptions={chart3dSceneOptions}
                    effectId={state.effect3d.effectId}
                    effectTargetId={state.effect3d.targetId}
                    onCameraChange={(camera) => dispatch({ type: "set-3d-camera", camera })}
                    viewportRef={chart3dViewportRef}
                    handleRef={chart3dViewportHandleRef}
                  />
                ) : (
                  <div className="charts-3d-viewport charts-3d-error">{chart3dResolvedLive.error}</div>
                )
              ) : (
                // The viewport holds only the render; feedback lives on the
                // buttons and in the rail (the user's own words: "it
                // shouldn't be in the rendering area — it moves the chart").
                // While the live render is bad or a remote dataset is
                // loading, this stays on the LAST GOOD render, dimmed
                // (`is-stale`) — pulsing too (`is-loading`) only while
                // something is actually in flight, so the frame never
                // collapses or shifts. In 3D off `web`, this shows the SAME
                // static frame `renderGlyphChart3d` produces for Copy.
                <div
                  className={`charts-grid-scroll${!is3d && isViewportStale ? " is-stale" : ""}${isRemoteLoading ? " is-loading" : ""}`}
                >
                  <TargetPreview
                    ref={preRef}
                    target={state.controls.target}
                    commandTitle={is3d ? "glyphcss chart --3d …" : "glyphcss chart …"}
                    isHtml={is3d ? Boolean(chart3dDisplay?.isHtml) : Boolean(displayRendered?.isHtml)}
                    text={is3d ? (chart3dDisplay?.text ?? "") : (displayRendered?.text ?? "")}
                    html={
                      is3d
                        ? chart3dDisplay?.isHtml
                          ? chart3dDisplay.display
                          : undefined
                        : displayRendered?.isHtml
                          ? displayRendered.display
                          : undefined
                    }
                    ansi={is3d ? chart3dDisplay?.ansi : displayRendered?.ansi}
                    charsetDowngraded={is3d ? false : displayRendered?.charsetDowngraded}
                    style={is3d ? undefined : densityStyle}
                    ariaLabel={
                      (is3d ? chart3dResolved.ok && chart3dResolved.resolved.title : state.chart.title) ||
                      "Chart preview"
                    }
                    ariaDescription={
                      (is3d ? chart3dResolved.ok && chart3dResolved.resolved.description : state.chart.description) ||
                      undefined
                    }
                  />
                </div>
              )}
            </div>
          </InstrumentViewport>
          {/* Sibling of `<InstrumentViewport>`, exactly where `MapSearchBox`
           *  sits on `/maps` — the same overlay idiom, three controls in one
           *  bar instead of one. */}
          <ChartsDataOverlay
            activeDatasetId={activeDatasetId}
            dispatch={overlayDispatch}
            onSelectRemote={(hit) => void (is3d ? loadRemote3dDataset(hit) : loadRemoteDataset(hit))}
            onRandom={handleRandomDataset}
            remoteSuggestions={is3d ? CHARTS_3D_REMOTE_DATASET_INDEX : undefined}
          />
          <InstrumentExportBar>
            {exportActions}
            <ActionButton
              data-export-trigger
              type="button"
              className={`gw-code-panel__action${codeOpen ? " is-active" : ""}`}
              aria-controls="charts-export-panel"
              aria-expanded={codeOpen}
              onClick={() => {
                setMobilePanel(null);
                setCodeOpen((current) => !current);
              }}
            >
              Export
            </ActionButton>
          </InstrumentExportBar>
          {(codeOpen || mobilePanel === "export") && (
            <CodePanel
              id="charts-export-panel"
              className={mobilePanel === "export" ? "is-mobile-open" : ""}
              snippets={snippets ?? {}}
              formats={EXPORT_FORMATS}
              defaultFormat="typescript"
              unavailableReason={
                state.dimension === "3d"
                  ? "3D chart code export is not available yet."
                  : !snippets
                    ? "Fix the chart errors to export code."
                    : undefined
              }
              onClose={() => {
                setCodeOpen(false);
                setMobilePanel(null);
              }}
            />
          )}
        </InstrumentMain>
        <Dock id="charts-controls-panel" className={mobilePanel === "controls" ? "is-mobile-open" : ""}>
          <ChartsDock
            state={state}
            dispatch={dispatch}
            rendered={rendered}
            chart3dViewportHandleRef={chart3dViewportHandleRef}
            chart3dResolved={chart3dResolved}
          />
        </Dock>
      </InstrumentBody>
      <PresetTray id="charts-presets-panel" label="Chart presets" open={mobilePanel === "presets"}>
        {CHART_PRESETS.map((preset, index) => (
          <button
            type="button"
            className="synth-tile"
            key={preset.id}
            title={`Apply “${preset.label}”`}
            aria-label={`Apply ${preset.label}`}
            onClick={() => dispatch({ type: "apply-preset", id: preset.id })}
          >
            <span className="synth-tile-scene charts-tile-preview" aria-hidden="true">
              <pre>{thumbnails[index]}</pre>
            </span>
            <span className="synth-tile-label">{preset.label}</span>
          </button>
        ))}
        {/* A labelled divider rather than interleaving (AGENTS.md's "Charts
         *  3D" "Website" "Tray" doc): a 3D tile changes what the viewport IS,
         *  not just which chart it draws. */}
        <div className="charts-tray-3d-divider" role="separator" aria-label="3D charts">
          3D
        </div>
        {CHARTS_3D_DATASETS.map((dataset, index) => (
          <button
            type="button"
            className="synth-tile"
            key={dataset.id}
            title={`View “${dataset.title}” in 3D`}
            aria-label={`View ${dataset.title} in 3D`}
            onClick={() => dispatch({ type: "select-3d-dataset", id: dataset.id })}
          >
            <span className="synth-tile-scene charts-tile-preview" aria-hidden="true">
              <pre>{thumbnails3d[index]}</pre>
            </span>
            <span className="synth-tile-label">{dataset.title}</span>
          </button>
        ))}
      </PresetTray>
      <InstrumentMobileTabs
        label="Charts panels"
        items={(["data", "controls", "presets", "export"] as const).map((panel) => ({
          id: panel,
          label: panel[0]!.toUpperCase() + panel.slice(1),
          controls: `charts-${panel}-panel`,
          expanded: mobilePanel === panel,
          onClick: () => togglePanel(panel),
        }))}
      />
    </InstrumentWorkbench>
  );
}
