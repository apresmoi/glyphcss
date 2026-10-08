import { diagramsSourceSnippets } from "../../features/diagrams/model/diagramsSourceAid";
import {
  type GlyphDiagramsWorkbenchState,
  GLYPH_DIAGRAM_WORKBENCH_PRESETS,
  GLYPH_DIAGRAMS_TRAY,
} from "../../features/diagrams/model/diagramsWorkbenchState";
import { ActionButton } from "../ActionButton";
import { CodePanel } from "../CodePanel";
import { Dock } from "../Dock";
import { ChoiceButton, ChoiceGroup } from "../IconToggle";
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
import { EXPORT_FORMATS } from "./controllerHelpers";
import { DiagramsDataOverlay } from "./DiagramsDataOverlay";
import { GlyphDiagramsDock } from "./DiagramsDock";
import { DiagramsGraphSourceCard } from "./DiagramsGraphSourceCard";
import { DiagramsHotspotLayer } from "./DiagramsHotspotLayer";
import { DiagramsSourceEditor } from "./DiagramsSourceEditor";
import styles from "./DiagramsWorkbench.module.css";
import { useDiagramsWorkbench } from "./hooks/useDiagramsWorkbench";
import { useDiagramsWorkbenchInner } from "./hooks/useDiagramsWorkbenchInner";

export default function GlyphDiagramsWorkbench({ initialState }: { initialState?: GlyphDiagramsWorkbenchState } = {}) {
  const view = useDiagramsWorkbench({ initialState });
  if (!view) return null;
  const { resolved, initialRemoteGraph } = view;

  return <GlyphDiagramsWorkbenchInner initialState={resolved} initialRemoteGraph={initialRemoteGraph} />;
}

function GlyphDiagramsWorkbenchInner({
  initialState,
  initialRemoteGraph,
}: {
  readonly initialState: GlyphDiagramsWorkbenchState;
  readonly initialRemoteGraph?: {
    readonly ref: string;
    readonly rowIdx: number;
    readonly title: string;
    readonly description?: string;
    readonly licence?: string;
  };
}) {
  const view = useDiagramsWorkbenchInner({ initialState, initialRemoteGraph });
  if (!view) return null;
  const {
    currentRendered,
    copy,
    copyTextState,
    state,
    copyAnsiState,
    copyLink,
    copyLinkState,
    download,
    downloadState,
    railTitle,
    mobilePanel,
    rail,
    remoteGraphLoadingTitle,
    graphNotice,
    parsedGraph,
    editorRef,
    sourceError,
    editorIds,
    shapePreviews,
    setSelection,
    hovered,
    dispatch,
    loadRemoteGraph,
    handleRandomGraph,
    diagramsViewportRef,
    panViewportRef,
    panContentRef,
    canPan,
    isPanning,
    resetView,
    isPending,
    isViewportStale,
    rendered,
    renderedViewportPx,
    attachPre,
    displayResult,
    previewStyle,
    hotspotResult,
    preEl,
    selection,
    setHovered,
    codeOpen,
    setMobilePanel,
    setCodeOpen,
    snippets,
    thumbnails,
  } = view;

  const exportActions = (
    <>
      <ActionButton
        type="button"
        className="gw-code-panel__action"
        disabled={!currentRendered?.ok}
        onClick={() => void copy("text")}
      >
        {copyTextState === "copied" ? "Copied" : copyTextState === "error" ? "Copy failed" : "Copy as text"}
      </ActionButton>
      {/* Hidden on `chat` (CHARTS-RESEARCH `DIAGNOSIS-target-matrix.md` C3,
       *  mirrored from `ChartsWorkbench.tsx`'s own export bar): a chat paste
       *  shows SGR escapes as literal `\x1b[38;2;…m` text, so Copy as text
       *  (above) is the honest export there. */}
      {currentRendered?.ok && currentRendered.ansi !== undefined && state.controls.target !== "chat" && (
        <ActionButton type="button" className="gw-code-panel__action" onClick={() => void copy("ansi")}>
          {copyAnsiState === "copied" ? "Copied" : copyAnsiState === "error" ? "Copy failed" : "Copy ANSI"}
        </ActionButton>
      )}
      <ActionButton type="button" className="gw-code-panel__action" onClick={() => void copyLink()}>
        {copyLinkState === "copied" ? "Copied" : copyLinkState === "error" ? "Copy failed" : "Copy link"}
      </ActionButton>
      <ActionButton type="button" className="gw-code-panel__action" disabled={!currentRendered?.ok} onClick={download}>
        {downloadState === "downloaded" ? "Downloaded" : downloadState === "error" ? "Download failed" : "Download SVG"}
      </ActionButton>
    </>
  );

  return (
    <InstrumentWorkbench kind="synth" className={`${styles.root} diagrams-shell`}>
      <InstrumentBody>
        <InstrumentRail
          size="editor"
          id="diagrams-source-panel"
          title={railTitle}
          open={mobilePanel === "source"}
          action={
            <ChoiceGroup className="gx-toggle diagrams-source-tabs" role="tablist" aria-label={rail.tablist}>
              {rail.tabs.map((tab) => (
                <ChoiceButton
                  type="button"
                  key={tab.id}
                  id={`${rail.idPrefix}-${tab.id}-tab`}
                  role="tab"
                  aria-selected={rail.editor === tab.id}
                  aria-controls={`${rail.idPrefix}-${tab.id}-editor`}
                  className={`gx-toggle-btn gx-toggle-text${rail.editor === tab.id ? " is-active" : ""}`}
                  onClick={() => rail.setEditor(tab.id)}
                >
                  {tab.label}
                </ChoiceButton>
              ))}
            </ChoiceGroup>
          }
        >
          {/* The rail IS the editor (user feedback: "too much borders and
           *  boxes... that mermaid editor can basically fill the whole
           *  sidebar"): no card, no disclosure — the dialect tabs share the
           *  header row with the title ("mermaid/json could be next to
           *  graph"), then the insert toolbar, the editor filling the
           *  remaining height, and its own error strip. The only thing above
           *  it is the remote graph's provenance (title, credit, licence,
           *  node cap), which a Hugging Face pick genuinely owes its source;
           *  a tray preset names itself in the rail header instead. A render
           *  error names itself INSIDE the editor, on its line — never over
           *  the render, which keeps showing the last diagram that actually
           *  laid out. No syntax note under the editor: what a dialect
           *  accepts is what the error strip says when it does not. */}
          {state.form === "graph" && (
            <DiagramsGraphSourceCard
              graphSource={state.graphSource}
              loadingTitle={remoteGraphLoadingTitle}
              notice={graphNotice}
              nodeCount={parsedGraph?.nodes.length}
              edgeCount={parsedGraph?.edges.length}
            />
          )}
          <div
            role="tabpanel"
            id={`${rail.idPrefix}-${rail.editor}-editor`}
            aria-labelledby={`${rail.idPrefix}-${rail.editor}-tab`}
            className="diagrams-source-panel"
          >
            <DiagramsSourceEditor
              ref={editorRef}
              id={`${rail.idPrefix}-${rail.editor}-source`}
              form={state.form}
              dialect={rail.editor}
              label={rail.label}
              value={rail.value}
              onChange={rail.onChange}
              error={sourceError}
              ids={editorIds}
              snippets={diagramsSourceSnippets(state.form, rail.editor)}
              previews={state.form === "graph" ? shapePreviews : undefined}
              onSelectionChange={setSelection}
              highlight={hovered}
            />
          </div>
        </InstrumentRail>
        <InstrumentMain>
          {/* Search + Random, floating over the viewport — the SAME overlay
           *  shape `ChartsWorkbench.tsx`'s own `<ChartsDataOverlay>` uses,
           *  a sibling of `<InstrumentViewport>` (packet D5). Graph-only —
           *  sequence has no remote search/random today (this file's own rail
           *  doc above). */}
          {state.form === "graph" && (
            <DiagramsDataOverlay
              loadedTitle={
                state.graphSource?.kind === "remote"
                  ? state.graphSource.title
                  : (GLYPH_DIAGRAM_WORKBENCH_PRESETS.find(
                      (p) => state.graphSource?.kind === "builtin" && p.id === state.graphSource.presetId,
                    )?.label ?? "")
              }
              onSelectBuiltIn={(id) => dispatch({ type: "apply-preset", id })}
              onSelectRemote={(hit) =>
                void loadRemoteGraph(hit.ref, "random", {
                  title: hit.title,
                  description: hit.description,
                  licence: hit.licence,
                })
              }
              onRandom={handleRandomGraph}
            />
          )}
          <InstrumentViewport inset className="diagrams-viewport" elementRef={diagramsViewportRef}>
            <div
              className="diagrams-preview"
              ref={panViewportRef}
              role="region"
              aria-label="Diagram viewport"
              aria-description={canPan ? "Drag to pan, or use arrow keys and Page Up or Page Down." : undefined}
              tabIndex={canPan ? 0 : undefined}
              data-pannable={canPan}
              data-panning={isPanning}
              aria-busy={isPending}
              data-viewport-width={renderedViewportPx?.width}
              data-viewport-height={renderedViewportPx?.height}
            >
              {/* The viewport holds only the render; feedback lives on the
               *  buttons and in the rail. `is-stale` (a config error or a
               *  layout still in flight) dims the LAST GOOD diagram instead
               *  of collapsing the frame; `is-loading` (in flight only) also
               *  pulses it — the page's own animation, never the render's. */}
              <div
                ref={panContentRef}
                className={`diagrams-grid-scroll${isViewportStale ? " is-stale" : ""}${isPending ? " is-loading" : ""}${rendered?.ok && rendered.hotspots?.length ? " has-hotspots" : ""}`}
              >
                <TargetPreview
                  ref={attachPre}
                  style={previewStyle}
                  target={state.controls.target}
                  commandTitle="glyphcss diagram …"
                  isHtml={Boolean(displayResult?.isHtml)}
                  text={displayResult?.text ?? ""}
                  html={displayResult?.isHtml ? displayResult.display : undefined}
                  ansi={displayResult?.ansi}
                  charsetDowngraded={displayResult?.charsetDowngraded}
                  ariaLabel={state.diagram.title || "Diagram preview"}
                  ariaDescription={displayResult?.meta.description}
                />
                {hotspotResult && (
                  <DiagramsHotspotLayer
                    pre={preEl}
                    hotspots={hotspotResult.hotspots!}
                    grid={hotspotResult.grid!}
                    selected={selection}
                    onSelect={(item) => {
                      editorRef.current?.selectItem(item);
                    }}
                    onHover={setHovered}
                  />
                )}
              </div>
            </div>
          </InstrumentViewport>
          <InstrumentExportBar>
            <ActionButton onClick={resetView} disabled={!canPan}>
              Reset view
            </ActionButton>
            {exportActions}
            <ActionButton
              data-export-trigger
              type="button"
              className={`gw-code-panel__action${codeOpen ? " is-active" : ""}`}
              aria-controls="diagrams-export-panel"
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
              id="diagrams-export-panel"
              className={mobilePanel === "export" ? "is-mobile-open" : ""}
              snippets={snippets ?? {}}
              formats={EXPORT_FORMATS}
              defaultFormat="typescript"
              unavailableReason={
                !snippets
                  ? isPending
                    ? "Updating diagram layout…"
                    : "Fix the diagram errors to export code."
                  : undefined
              }
              onClose={() => {
                setCodeOpen(false);
                setMobilePanel(null);
              }}
            />
          )}
        </InstrumentMain>
        <Dock id="diagrams-controls-panel" className={mobilePanel === "controls" ? "is-mobile-open" : ""}>
          <GlyphDiagramsDock state={state} dispatch={dispatch} />
        </Dock>
      </InstrumentBody>
      <PresetTray id="diagrams-presets-panel" label="Diagram presets" open={mobilePanel === "presets"}>
        {GLYPH_DIAGRAMS_TRAY.map((entry, index) => {
          const key = `${entry.kind}:${entry.preset.id}`;
          const previous = GLYPH_DIAGRAMS_TRAY[index - 1];
          const divider = entry.section && entry.section !== previous?.section ? entry.section : null;
          return [
            divider && (
              <span
                key={`${key}-divider`}
                className="diagrams-tray-divider"
                role="separator"
                aria-label={`${divider} presets`}
              >
                {divider}
              </span>
            ),
            <button
              type="button"
              className="synth-tile"
              key={key}
              title={`Apply “${entry.preset.label}”`}
              aria-label={`Apply ${entry.preset.label}`}
              onClick={() =>
                dispatch(
                  entry.kind === "sequence"
                    ? { type: "apply-sequence-preset", id: entry.preset.id }
                    : entry.kind === "lanes"
                      ? { type: "apply-lanes-preset", id: entry.preset.id }
                      : { type: "apply-preset", id: entry.preset.id },
                )
              }
            >
              <span className="synth-tile-scene diagrams-tile-preview" aria-hidden="true">
                <pre>{thumbnails[key] ?? ""}</pre>
              </span>
              <span className="synth-tile-label">{entry.preset.label}</span>
            </button>,
          ];
        })}
      </PresetTray>
      <InstrumentMobileTabs
        label="Diagrams panels"
        items={(["source", "controls", "presets", "export"] as const).map((panel) => ({
          id: panel,
          label: panel[0]!.toUpperCase() + panel.slice(1),
          controls: `diagrams-${panel}-panel`,
          expanded: mobilePanel === panel,
          onClick: () => {
            setCodeOpen(false);
            setMobilePanel((current) => (current === panel ? null : panel));
          },
        }))}
      />
    </InstrumentWorkbench>
  );
}
