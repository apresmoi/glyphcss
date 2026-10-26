import type { InstrumentSnapshot } from "../InstrumentWorkbench";
import { FLUID_HEADING } from "../../features/fluid/model/fluidWorkbench";
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
import { FluidControls } from "./FluidControls";
import { FluidDockFolders } from "./FluidDockFolders";
import styles from "./FluidWorkbench.module.css";
import { useFluidWorkbench } from "./hooks/useFluidWorkbench";

const EXPORT_FORMATS = [
  { id: "vanilla", label: "JS" },
  { id: "react", label: "React", unavailableReason: "@glyphcss/fluid has no React binding; use the JS API." },
  { id: "vue", label: "Vue", unavailableReason: "@glyphcss/fluid has no Vue binding; use the JS API." },
];

export default function FluidWorkbench({ snapshot }: { snapshot?: InstrumentSnapshot } = {}) {
  const view = useFluidWorkbench();
  const { mobilePanel, setMobilePanel, codeOpen, toggleCodeOpen } = view;
  const tab = (id: "controls" | "stats" | "code") => () => setMobilePanel((current) => (current === id ? null : id));

  return (
    <InstrumentWorkbench kind="synth" className={styles.root}>
      <InstrumentBody>
        <InstrumentRail id="fluid-controls-panel" title="Controls" open={mobilePanel === "controls"}>
          <FluidControls
            settings={view.settings}
            onSettings={view.updateSettings}
            reader={view.reader}
            onText={view.setText}
            onWpm={view.setWpm}
            onLoop={view.setLoop}
            progress={view.progress}
            onTogglePlaying={view.togglePlaying}
          />
        </InstrumentRail>
        <InstrumentMain>
          <InstrumentViewport className="fluid-viewport">
            {snapshot ? (
              snapshot.viewport
            ) : (
              <div className="fluid-stage" ref={view.fieldHostRef}>
                <p className="fluid-heading" ref={view.headingRef} aria-hidden="true">
                  {FLUID_HEADING}
                </p>
                <div
                  className="fluid-reader"
                  ref={view.readerHostRef}
                  role="img"
                  aria-label={`Speed reader: ${view.reader.text}`}
                />
              </div>
            )}
          </InstrumentViewport>
          <InstrumentExportBar>
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
          {(codeOpen || mobilePanel === "code") && (
            <CodePanel
              id="fluid-code-panel"
              className={mobilePanel === "code" ? "is-mobile-open" : ""}
              snippets={view.snippets}
              formats={EXPORT_FORMATS}
              defaultFormat="vanilla"
              onClose={view.closeCode}
            />
          )}
        </InstrumentMain>
        <Dock
          staticContent={snapshot?.controls}
          id="fluid-stats-panel"
          className={mobilePanel === "stats" ? "is-mobile-open" : ""}
        >
          <FluidDockFolders stats={view.stats} />
        </Dock>
      </InstrumentBody>
      <InstrumentMobileTabs
        label="Fluid panels"
        items={[
          {
            id: "controls",
            label: "Controls",
            controls: "fluid-controls-panel",
            expanded: mobilePanel === "controls",
            onClick: tab("controls"),
          },
          {
            id: "stats",
            label: "Stats",
            controls: "fluid-stats-panel",
            expanded: mobilePanel === "stats",
            onClick: tab("stats"),
          },
          {
            id: "code",
            label: "Export",
            controls: "fluid-code-panel",
            expanded: mobilePanel === "code",
            onClick: tab("code"),
          },
        ]}
      />
    </InstrumentWorkbench>
  );
}
