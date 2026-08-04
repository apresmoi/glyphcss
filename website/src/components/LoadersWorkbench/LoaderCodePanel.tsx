import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { generateLoaderSnippets, LOADER_TAB_LABEL, LOADER_TAB_ORDER, openLoaderCodepen, type LoaderTab } from "./loaderSnippets";
import type { LoaderPreset } from "./loaders";

/** Export window for one loader — same `.gw-code-panel` look as the gallery and
 *  /synth panels, with the loader's own four-language snippets. */
export function LoaderCodePanel({ loader, cols, rows, lang, onLang, onClose }: {
  loader: LoaderPreset;
  cols: number;
  rows: number;
  lang: LoaderTab;
  onLang: (tab: LoaderTab) => void;
  onClose: () => void;
}) {
  const tab = lang;
  const setTab = onLang;
  const [copied, setCopied] = useState(false);
  const root = useRef<HTMLElement | null>(null);

  // Opened from a tile that may be well above the fold — bring the code to the
  // reader rather than making them hunt for it.
  useEffect(() => { root.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [cols, rows]);
  const snippets = useMemo(() => generateLoaderSnippets(loader, cols, rows), [loader, cols, rows]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(snippets[tab]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — the code stays selectable in the panel */
    }
  }, [snippets, tab]);

  return (
    <aside className="gw-code-panel ld-code-panel" ref={root}>
      <header className="gw-code-panel__head">
        <span className="gw-code-panel__legend">[ {loader.label.toUpperCase()} · {cols}×{rows} ]</span>
        <div className="gw-code-panel__tabs">
          {LOADER_TAB_ORDER.map((t) => (
            <button
              key={t}
              type="button"
              className={`gw-code-panel__tab${tab === t ? " is-active" : ""}`}
              onClick={() => setTab(t)}
            >
              {LOADER_TAB_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="gw-code-panel__actions">
          <button
            type="button"
            className="gw-code-panel__action gw-code-panel__action--codepen"
            onClick={() => openLoaderCodepen(loader, cols, rows)}
            title="Open this loader in a new CodePen"
          >
            CodePen
          </button>
          <button type="button" className="gw-code-panel__action" onClick={handleCopy} title="Copy current snippet">
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" className="gw-code-panel__action" onClick={onClose} title="Close" aria-label="Close export panel">✕</button>
        </div>
      </header>
      <div className="gw-code-panel__body">
        <pre className="gw-code-panel__code"><code>{snippets[tab]}</code></pre>
      </div>
    </aside>
  );
}
