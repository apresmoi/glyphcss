import { useCallback, useMemo, useState } from "react";
import { generateSynthSnippets, type SynthSnippetInput, type SynthTab } from "./synthSnippets";

const TAB_LABEL: Record<SynthTab, string> = { html: "HTML", vanilla: "JS", react: "React", vue: "Vue" };
const TAB_ORDER: SynthTab[] = ["html", "vanilla", "react", "vue"];

interface SynthCodePanelProps {
  id?: string;
  className?: string;
  input: SynthSnippetInput;
  onCodepen: () => void;
  exporting: boolean;
  onClose: () => void;
  /** Copies the rendered ASCII art itself (distinct from `handleCopy` below,
   *  which copies the generated CODE snippet). Mounted here too so the
   *  action stays reachable once `.synth-export-bar` hides under 760px —
   *  see instrument-workbench.css's mobile export rule. */
  onCopyAscii: () => void;
  copyAsciiState: "idle" | "copied" | "error";
}

/**
 * Gallery-style export code window for /synth — same look (`.gw-code-panel`
 * header/tabs/actions/code classes from `gallery-workbench.css`, imported by
 * this page) as `GalleryWorkbench/CodePanel.tsx`, generating framework
 * snippets tailored to the synth's shape + camera + live field-synth patch
 * instead of the gallery's model/preset/interaction state. Visibility is
 * owned by the parent (`SynthWorkbench`'s `codeOpen` / mobile "Export" tab) —
 * this component only mounts while shown, unlike the gallery's panel which
 * stays mounted and merely collapses its body.
 */
export function SynthCodePanel({ id, className, input, onCodepen, exporting, onClose, onCopyAscii, copyAsciiState }: SynthCodePanelProps) {
  const [tab, setTab] = useState<SynthTab>("react");
  const [copied, setCopied] = useState(false);
  const snippets = useMemo(() => generateSynthSnippets(input), [input]);

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
    <aside id={id} className={`gw-code-panel synth-code-panel${className ? ` ${className}` : ""}`}>
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
            title="Compile the current patch into a new CodePen"
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
