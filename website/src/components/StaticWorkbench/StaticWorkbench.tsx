import { GalleryWorkbench } from "../GalleryWorkbench";
import { SynthWorkbench } from "../SynthWorkbench";
import { MapsWorkbench } from "../MapsWorkbench";
import { WordArtWorkbench } from "../WordArtWorkbench";
import { LoadersWorkbench } from "../LoadersWorkbench";
import { ChartsWorkbench } from "../ChartsWorkbench";
import { DiagramsWorkbench } from "../DiagramsWorkbench";
import { FluidWorkbench } from "../FluidWorkbench";
import { createChartsWorkbenchState } from "../../features/charts/model/chartsSpec";
import { createGlyphDiagramsWorkbenchState } from "../../features/diagrams/model/diagramsWorkbenchState";
import type { InstrumentSnapshot } from "../InstrumentWorkbench";
import { StaticPanels, StaticWordArtRail, type StaticWorkbenchPage } from "./StaticPanels";
import styles from "./StaticWorkbench.module.css";

export interface StaticRender {
  title: string;
  text: string;
  html: string;
  source?: string;
}

export function StaticWorkbenchIntro({ heading, description }: { heading: string; description: string }) {
  return (
    <div className={styles.intro}>
      <h1>{heading}</h1>
      <p>{description}</p>
    </div>
  );
}

export function StaticWorkbenchRender({ entry }: { entry: StaticRender }) {
  return (
    <pre
      className={`glyph-output ${styles.render}`}
      data-static-render
      aria-label={entry.title}
      dangerouslySetInnerHTML={{ __html: entry.html }}
    />
  );
}

export function StaticWorkbench({
  page,
  heading,
  description,
  initial,
  examples = [],
  tiles = {},
  kind,
}: {
  page: StaticWorkbenchPage;
  heading: string;
  description: string;
  initial: StaticRender;
  examples?: StaticRender[];
  tiles?: Record<string, StaticRender>;
  kind?: "diagram" | "chart";
}) {
  const viewport = (
    <div className={`${styles.stage} ${styles[page] ?? ""}`} data-static-stage>
      <StaticWorkbenchRender entry={initial} />
    </div>
  );
  const gallery = kind ? (
    <details className={styles.examples}>
      <summary>{heading}: examples and installation</summary>
      <p>{description}</p>
      {[initial, ...examples].map((entry, index) => (
        <section key={`${index}-${entry.title}`}>
          <h2>{entry.title}</h2>
          <StaticWorkbenchRender entry={entry} />
          {entry.source && (
            <details>
              <summary>Mermaid / JSON source</summary>
              <pre className={styles.source}>
                <code>{entry.source}</code>
              </pre>
            </details>
          )}
        </section>
      ))}
      <section>
        <h2>Use it in your project</h2>
        <pre className={styles.source}>
          <code>{`npm install @glyphcss/${kind === "diagram" ? "diagrams" : "charts"}\nnpm install -D @glyphcss/compile\nnpx glyphcss ${kind} ${kind === "diagram" ? "graph.mmd" : "chart.json"}`}</code>
        </pre>
        <p>
          For coding agents, <a href="/coding-agents/install/">install the glyphcss-diagrams skill</a>.
        </p>
        <p>
          <a href={kind === "diagram" ? "/diagrams/overview/" : "/charts/overview/"}>Rendering documentation</a> ·{" "}
          <a href="/guides/compile/">CLI and static compilation</a>
        </p>
      </section>
    </details>
  ) : undefined;
  const snapshot: InstrumentSnapshot = {
    viewport,
    examples: gallery,
    controls: <StaticPanels page={page} />,
    railControls: <StaticWordArtRail />,
    tiles: Object.fromEntries(
      Object.entries(tiles).map(([size, entry]) => [size, <StaticWorkbenchRender key={size} entry={entry} />]),
    ),
  };
  const workbench = {
    gallery: () => <GalleryWorkbench snapshot={snapshot} />,
    synth: () => <SynthWorkbench snapshot={snapshot} />,
    maps: () => <MapsWorkbench snapshot={snapshot} />,
    wordart: () => <WordArtWorkbench snapshot={snapshot} />,
    loaders: () => <LoadersWorkbench snapshot={snapshot} />,
    charts: () => <ChartsWorkbench initialState={createChartsWorkbenchState()} snapshot={snapshot} />,
    diagrams: () => <DiagramsWorkbench initialState={createGlyphDiagramsWorkbenchState()} snapshot={snapshot} />,
    fluid: () => <FluidWorkbench snapshot={snapshot} />,
  }[page];
  return (
    <div className={styles.root} data-static-workbench={page}>
      {workbench()}
    </div>
  );
}
