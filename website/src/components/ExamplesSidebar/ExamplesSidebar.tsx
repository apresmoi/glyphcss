import styles from "./ExamplesSidebar.module.css";
export type ExampleId = "world" | "flatmap" | "city-lab" | "image" | "parthenon" | "loaders";
const examples: readonly { id: ExampleId; label: string; description: string }[] = [
  { id: "world", label: "World", description: "Globe · ETOPO1" },
  { id: "flatmap", label: "Flat Map", description: "Iso · Web Mercator" },
  { id: "city-lab", label: "City Lab", description: "Procedural · Endless" },
  { id: "image", label: "Image", description: "Drop a photo · ASCII" },
  { id: "parthenon", label: "Parthenon", description: "Matrix · Greek temple" },
  { id: "loaders", label: "Loaders", description: "Spinners · Progress bars" },
];
export function ExamplesSidebar({ active }: { active: ExampleId }) {
  return (
    <aside className={styles.sidebar}>
      <div className={styles.heading}>[ EXAMPLES ]</div>
      <nav className={styles.navigation} aria-label="Examples">
        {examples.map((item) => (
          <a
            key={item.id}
            href={item.id === active ? undefined : `/examples/${item.id}/`}
            aria-current={item.id === active ? "page" : undefined}
            title={item.description}
          >
            <span aria-hidden="true">{item.id === active ? "[ " : "> "}</span>
            {item.label}
            <span aria-hidden="true">{item.id === active ? " ]" : ""}</span>
          </a>
        ))}
      </nav>
    </aside>
  );
}
