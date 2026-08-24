import { useCallback, useMemo, useState } from "react";
import { generateWordArtSnippets, type WordArtSnippetInput, type WordArtTab } from "./wordartSnippets";

const TAB_LABEL: Record<WordArtTab, string> = { html: "HTML", vanilla: "JS", react: "React", vue: "Vue" };
const TAB_ORDER: WordArtTab[] = ["html", "vanilla", "react", "vue"];

interface WordArtCodePanelProps {
  id?: string;
  className?: string;
  input: WordArtSnippetInput;
  onCodepen: () => void;
  exporting: boolean;
  onClose: () => void;
  /** Copies the rendered ASCII art itself (distinct from `handleCopy` below,
   *  which copies the generated CODE snippet). Mounted here too so the
   *  action stays reachable once `.wa-export-bar` hides under 760px — see
   *  wordart.css's mobile export rule. */
  onCopyAscii: () => void;
  copyAsciiState: "idle" | "copied" | "error";
}

/**
 * Gallery-style export code window for /wordart — same look (`.gw-code-panel`
 * header/tabs/actions/code classes from `gallery-workbench.css`, imported by
 * `WordArtWorkbench.tsx`) as `GalleryWorkbench/CodePanel.tsx` and
 * `SynthWorkbench/SynthCodePanel.tsx`, generating framework snippets tailored
 * to the live extruded-text mesh + camera + lighting + Glyph Effects layer.
 * Visibility is owned by the parent (`WordArtWorkbench`'s `codeOpen` / mobile
 * "Export" tab) — this component only mounts while shown.
 */
export function WordArtCodePanel({ id, className, input, onCodepen, exporting, onClose, onCopyAscii, copyAsciiState }: WordArtCodePanelProps) {
  const [tab, setTab] = useState<WordArtTab>("react");
  const [copied, setCopied] = useState(false);
  const snippets = useMemo(() => generateWordArtSnippets(input), [input]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(snippets[tab]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* no-op */
    }
  }, [snippets, tab]);

  return (
    <aside id={id} className={`gw-code-panel wa-code-panel${className ? ` ${className}` : ""}`}>
      <header className="gw-code-panel__head">
        <span className="gw-code-panel__legend">[ CODE ]</span>
        <div className="gw-code-panel__tabs">
          {TAB_ORDER.map((t) => (
            <button
              key={t}
              type="button"
              className={`gw-code-panel__tab${tab === t ? " is-active" : ""}`}
              onClick={() => setTab(t)}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="gw-code-panel__actions">
          <button
            type="button"
            className="gw-code-panel__action gw-code-panel__action--codepen"
            onClick={onCodepen}
            disabled={exporting}
            title="Compile the current word art into a new CodePen"
          >
            {exporting ? "Exporting…" : "CodePen"}
          </button>
          <button type="button" className="gw-code-panel__action" onClick={handleCopy} title="Copy current snippet">
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            className="gw-code-panel__action"
            onClick={onCopyAscii}
            title="Copy the rendered ASCII art to the clipboard"
          >
            {copyAsciiState === "copied" ? "Copied" : copyAsciiState === "error" ? "Copy failed" : "Copy ASCII"}
          </button>
          <button
            type="button"
            className="gw-code-panel__action"
            onClick={onClose}
            title="Close export panel"
            aria-label="Close export panel"
          >
            ✕
          </button>
        </div>
      </header>
      <div className="gw-code-panel__body">
        <pre className="gw-code-panel__code"><code>{snippets[tab]}</code></pre>
      </div>
    </aside>
  );
}
