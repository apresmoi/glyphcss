import { useState } from "react";
import { type LoaderTab, generateLoaderSnippets } from "../../../features/loaders/export/loaderSnippets";
import { type LiveEdits } from "../../../features/loaders/model/liveEdits";
import { type LoaderPreset } from "../../../features/loaders/model/loaders";
import { useGhostScene, useLoaderScene } from "../hooks/useLoaderScene";

export function LoaderTile({
  loader,
  cols,
  rows,
  label,
  lang,
  live,
  fontSize,
  onCode,
}: {
  loader: LoaderPreset;
  cols: number;
  rows: number;
  label: string;
  lang: LoaderTab;
  live: LiveEdits;
  fontSize: number;
  onCode: () => void;
}) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [ghost, setGhost] = useState<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  useLoaderScene(host, loader, cols, rows, live);
  useGhostScene(ghost, cols, rows, live);

  // Each example is its own exportable size, so its snippet states THIS grid.
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(generateLoaderSnippets(loader, cols, rows)[lang]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — the panel keeps the code selectable */
    }
  };

  return (
    // Header/footer rather than one meta ROW: a 6-wide render is ~40px, and a
    // single row of label + dims + two buttons forced the tile to ~184px, so
    // narrow loaders sat in mostly-empty boxes.
    <figure className="ld-size">
      <figcaption className="ld-size__head">
        <span className="ld-size__label">{label}</span>
        <span className="ld-size__dims">
          {cols}×{rows}
        </span>
      </figcaption>
      <div className="ld-size__stack" style={{ fontSize: `${fontSize}px` }}>
        <div className="ld-size__view" ref={setHost} />
        <div className="ld-size__ghost" ref={setGhost} aria-hidden="true" />
      </div>
      <div className="ld-size__foot">
        <button
          type="button"
          className="ld-mini"
          onClick={onCode}
          title={`Code for ${cols}×${rows}`}
          aria-label={`Code for ${cols}×${rows}`}
        >
          {"</>"}
        </button>
        <button
          type="button"
          className="ld-mini"
          onClick={copy}
          title={`Copy ${lang.toUpperCase()} for ${cols}×${rows}`}
          aria-label={`Copy ${cols}×${rows}`}
        >
          {copied ? "✓" : "⧉"}
        </button>
      </div>
    </figure>
  );
}

export function LoaderThumb({ loader }: { loader: LoaderPreset }) {
  const [host, setHost] = useState<HTMLSpanElement | null>(null);
  useLoaderScene(host, loader, 16, 6);
  return (
    <span className="ld-tile__thumb">
      <span className="ld-tile__glyph" ref={setHost} />
    </span>
  );
}
