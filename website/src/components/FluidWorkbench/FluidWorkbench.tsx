import { useMemo, useState, type CSSProperties } from "react";
import type { InstrumentSnapshot } from "../InstrumentWorkbench";
import { FLUID_EXAMPLES, type FluidExample } from "../../features/fluid/model/fluidExamples";
import { FLUID_HEADING } from "../../features/fluid/model/fluidWorkbench";
import { ActionButton } from "../ActionButton";
import { CodePanel } from "../CodePanel";
import { Dock } from "../Dock";
import {
  InstrumentBody,
  InstrumentExportBar,
  InstrumentMain,
  InstrumentMobileTabs,
  InstrumentViewport,
  InstrumentWorkbench,
} from "../InstrumentWorkbench";
import { ModelsSidebar, type ModelCategory } from "../ModelsSidebar";
import { StatsOverlay } from "../StatsOverlay";
import { FluidDockFolders } from "./FluidDockFolders";
import styles from "./FluidWorkbench.module.css";
import { useFluidWorkbench } from "./hooks/useFluidWorkbench";

const EXPORT_FORMATS = [
  { id: "vanilla", label: "JS" },
  { id: "react", label: "React", unavailableReason: "@glyphcss/fluid has no React binding; use the JS API." },
  { id: "vue", label: "Vue", unavailableReason: "@glyphcss/fluid has no Vue binding; use the JS API." },
];

const PROSE =
  "Zones shape the field instead of adding ink. A quiet zone dims the fluid under prose so the text over it stays readable; a pool deepens it into a well. Move the pointer across the stage to stir it, and click to send a ring.";

function exampleCategories(search: string): ModelCategory[] {
  const query = search.trim().toLowerCase();
  const categories: ModelCategory[] = [];
  for (const example of FLUID_EXAMPLES) {
    if (query && !`${example.label} ${example.category}`.toLowerCase().includes(query)) continue;
    let category = categories.find((c) => c.id === example.category);
    if (!category) categories.push((category = { id: example.category, label: example.category, models: [] }));
    category.models.push({ id: example.id, label: example.label });
  }
  return categories;
}

/** What the active example puts on the stage for the fluid to read. */
function Subject({
  example,
  subjectRef,
  readerHostRef,
  circle,
  text,
}: {
  example: FluidExample;
  subjectRef: { current: HTMLElement | null };
  readerHostRef: { current: HTMLDivElement | null };
  circle: boolean;
  text: string;
}) {
  const setSubject = (el: HTMLElement | null) => {
    subjectRef.current = el;
  };
  switch (example.kind) {
    case "text":
      return (
        <p className="fluid-heading" ref={setSubject} aria-hidden="true">
          {FLUID_HEADING}
        </p>
      );
    case "image":
      return (
        <figure
          className="fluid-box fluid-box--image"
          ref={setSubject}
          role="img"
          aria-label={example.label}
          style={{ ["--fluid-box-aspect" as string]: example.aspect } as CSSProperties}
        />
      );
    case "mesh":
      return <figure className="fluid-box fluid-box--mesh" ref={setSubject} role="img" aria-label={example.label} />;
    case "zones":
      return (
        <article className="fluid-zone" ref={setSubject}>
          <p>{PROSE}</p>
        </article>
      );
    case "reader":
      return (
        <div
          className={`fluid-reader${circle ? " fluid-reader--circle" : ""}`}
          ref={(el) => {
            readerHostRef.current = el;
          }}
          role="img"
          aria-label={`Speed reader: ${text}`}
        />
      );
  }
}

export default function FluidWorkbench({ snapshot }: { snapshot?: InstrumentSnapshot } = {}) {
  const view = useFluidWorkbench();
  const { mobilePanel, setMobilePanel, codeOpen, toggleCodeOpen } = view;
  const [stageHost, setStageHost] = useState<HTMLElement | null>(null);
  const categories = useMemo(() => exampleCategories(view.search), [view.search]);
  const tab = (id: "examples" | "controls" | "code") => () => setMobilePanel((current) => (current === id ? null : id));

  return (
    <InstrumentWorkbench kind="synth" className={styles.root}>
      <InstrumentBody>
        <ModelsSidebar
          id="fluid-examples-panel"
          title="Examples"
          className={mobilePanel === "examples" ? "is-mobile-open" : ""}
          modelSearch={view.search}
          onModelSearchChange={view.setSearch}
          onRandomPreset={view.randomExample}
          modelCategories={categories}
          activeCategoryId={view.example.category}
          presetId={view.example.id}
          onPresetClick={view.selectExample}
          attribution={view.attribution}
          showCredit={view.example.kind === "mesh"}
        />
        <InstrumentMain elementRef={setStageHost}>
          <InstrumentViewport className="fluid-viewport">
            {snapshot ? (
              snapshot.viewport
            ) : (
              <div className="fluid-stage" ref={view.stageRef} data-fluid-example={view.example.id}>
                <Subject
                  example={view.example}
                  subjectRef={view.subjectRef}
                  readerHostRef={view.readerHostRef}
                  circle={view.config.shape === "circle"}
                  text={view.config.text}
                />
              </div>
            )}
          </InstrumentViewport>
          <StatsOverlay anchor="top-left" container={stageHost} />
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
          id="fluid-controls-panel"
          className={mobilePanel === "controls" ? "is-mobile-open" : ""}
          loadError={view.error}
        >
          <FluidDockFolders
            example={view.example}
            config={view.config}
            update={view.update}
            reset={view.reset}
            tuningValues={view.tuningValues}
            tuningDefaults={view.tuningDefaults}
            onTuning={view.updateTuning}
            onResetTuning={view.resetTuning}
            progress={view.progress}
            onTogglePlaying={view.togglePlaying}
            onRipple={view.ripple}
            onStep={view.stepFrame}
            stats={view.stats}
            lit={view.lit}
          />
        </Dock>
      </InstrumentBody>
      <InstrumentMobileTabs
        label="Fluid panels"
        items={[
          {
            id: "examples",
            label: "Examples",
            controls: "fluid-examples-panel",
            expanded: mobilePanel === "examples",
            onClick: tab("examples"),
          },
          {
            id: "random",
            label: "Random",
            controls: "fluid-examples-panel",
            expanded: false,
            onClick: view.randomExample,
          },
          {
            id: "controls",
            label: "Controls",
            controls: "fluid-controls-panel",
            expanded: mobilePanel === "controls",
            onClick: tab("controls"),
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
