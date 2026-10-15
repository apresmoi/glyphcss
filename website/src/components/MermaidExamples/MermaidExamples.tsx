import { useEffect, useState } from "react";
import { GLYPH_MERMAID_EXAMPLES, renderGlyphMermaidExample } from "../../features/mermaid/render/renderMermaidExample";
import { ActionButton } from "../ActionButton";
import { BracketSelect } from "../BracketSelect";
import { TargetPreview } from "../TargetPreview";
import styles from "./MermaidExamples.module.css";

export function GlyphMermaidExamples({ owner }: { readonly owner: "charts" | "diagrams" }) {
  const examples = GLYPH_MERMAID_EXAMPLES.filter((example) => example.owner === owner);
  const [selected, setSelected] = useState(examples[0]!.type);
  const [open, setOpen] = useState(false);
  const [rendered, setRendered] = useState<{
    text: string;
    html?: string;
    notes: string;
  }>();
  const [error, setError] = useState("");
  const example = examples.find((item) => item.type === selected)!;
  useEffect(() => {
    if (!open) return;
    let active = true;
    setRendered(undefined);
    setError("");
    void renderGlyphMermaidExample(example).then(
      (result) => {
        if (active)
          setRendered({
            text: result.text,
            html: result.html,
            notes: result.report.ledger.map((entry) => `${entry.code}: ${entry.message}`).join("\n"),
          });
      },
      (failure: Error) => {
        if (active) setError(failure.message);
      },
    );
    return () => {
      active = false;
    };
  }, [example, open]);
  return (
    <details className={styles.root} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Mermaid examples</summary>
      <label>
        Type{" "}
        <BracketSelect
          aria-label={`${owner} Mermaid example`}
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          {examples.map((item) => (
            <option key={item.type} value={item.type}>
              {item.type}
            </option>
          ))}
        </BracketSelect>
      </label>
      <textarea
        className={styles.source}
        aria-label="Mermaid example source"
        value={example.source}
        readOnly
        rows={7}
      />
      {error && <p role="alert">{error}</p>}
      <div className={styles.preview} aria-busy={open && !rendered && !error}>
        {rendered && (
          <TargetPreview
            target="web"
            commandTitle="glyphcss diagram example.mmd"
            isHtml={Boolean(rendered.html)}
            text={rendered.text}
            html={rendered.html}
            ariaLabel={`${selected} Mermaid web example`}
          />
        )}
      </div>
      <div className={styles.actions}>
        <ActionButton
          type="button"
          disabled={!rendered}
          onClick={() => void navigator.clipboard.writeText(rendered!.text)}
        >
          Copy render
        </ActionButton>
        <ActionButton type="button" onClick={() => void navigator.clipboard.writeText(example.source)}>
          Copy Mermaid
        </ActionButton>
        <span title={rendered?.notes}>
          72 columns · web · braille
          {rendered?.notes ? " · adaptation notes" : ""}
        </span>
      </div>
    </details>
  );
}
