import { useEffect, useMemo, useRef } from "react";
import {
  generateLoaderSnippets,
  openLoaderCodepen,
  type LoaderTab,
} from "../../features/loaders/export/loaderSnippets";
import type { LoaderPreset } from "../../features/loaders/model/loaders";
import { CodePanel } from "../CodePanel";

export function LoaderCodePanel({
  loader,
  cols,
  rows,
  lang,
  onLang,
  onClose,
}: {
  loader: LoaderPreset;
  cols: number;
  rows: number;
  lang: LoaderTab;
  onLang: (tab: LoaderTab) => void;
  onClose: () => void;
}) {
  const root = useRef<HTMLElement | null>(null);

  // Opened from a tile that may be well above the fold — bring the code to the
  // reader rather than making them hunt for it.
  useEffect(() => {
    root.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [cols, rows]);
  const snippets = useMemo(() => generateLoaderSnippets(loader, cols, rows), [loader, cols, rows]);

  return (
    <CodePanel
      inline
      ref={root}
      title={`Export · ${loader.label} · ${cols}×${rows}`}
      snippets={snippets}
      format={lang}
      onFormatChange={(tab) => onLang(tab as LoaderTab)}
      onClose={onClose}
      codepen={{ onClick: () => openLoaderCodepen(loader, cols, rows) }}
    />
  );
}
