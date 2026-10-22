import styles from "./StaticWorkbench.module.css";

interface Render {
  title: string;
  text: string;
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

export function StaticWorkbench({
  heading,
  description,
  initial,
  examples = [],
  kind,
}: {
  heading: string;
  description: string;
  initial: Render;
  examples?: Render[];
  kind?: "diagram" | "chart";
}) {
  const render = (entry: Render) => (
    <section key={entry.title}>
      <h3>{entry.title}</h3>
      <pre className={styles.render} data-static-render>
        {entry.text}
      </pre>
      {entry.source && (
        <details>
          <summary>Mermaid / JSON source</summary>
          <pre className={styles.source}>
            <code>{entry.source}</code>
          </pre>
        </details>
      )}
    </section>
  );
  return (
    <main className={styles.root} data-static-workbench>
      <h2>{heading}</h2>
      <p>{description}</p>
      {render(initial)}
      {examples.length > 0 && (
        <>
          <h2>Example gallery</h2>
          {examples.map(render)}
        </>
      )}
      {kind && (
        <section>
          <h2>Use it in your project</h2>
          <pre className={styles.source}>
            <code>{`npm install @glyphcss/${kind === "diagram" ? "diagrams" : "charts"}\nnpm install -D @glyphcss/compile\nnpx glyphcss ${kind} ${kind === "diagram" ? "graph.mmd" : "chart.json"}`}</code>
          </pre>
          <p>
            For coding agents, install the{" "}
            <a href="https://github.com/apresmoi/glyphcss-diagrams#install">glyphcss-diagrams skill</a>:
          </p>
          <pre className={styles.source}>
            <code>git clone https://github.com/apresmoi/glyphcss-diagrams.git</code>
          </pre>
          <p>
            <a
              href={
                kind === "diagram"
                  ? "/guides/diagrams/"
                  : "https://github.com/apresmoi/glyphcss/tree/main/packages/charts#readme"
              }
            >
              Rendering documentation
            </a>{" "}
            · <a href="/guides/compile/">CLI and static compilation</a>
          </p>
        </section>
      )}
    </main>
  );
}
