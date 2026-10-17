import { renderGlyphDiagram } from "@glyphcss/diagrams";
import { glyphLaneDagFromGitLog, renderGlyphLaneDag, validateGlyphLaneDag } from "@glyphcss/diagrams/lanes";
import { renderGlyphSequence } from "@glyphcss/diagrams/sequence";
import { useEffect, useRef, useState } from "react";
import {
  GLYPH_DIAGRAMS_TRAY,
  type GlyphDiagramsWorkbenchControls,
} from "../../../features/diagrams/model/diagramsWorkbenchState";

type Target = GlyphDiagramsWorkbenchControls["target"];
type Entry = (typeof GLYPH_DIAGRAMS_TRAY)[number];
type Thumbnails = Readonly<Record<string, string>>;
const trayThumbnailCache = new Map<Target, Map<string, Promise<string>>>();
const completeTrayCache = new Map<Target, Promise<Thumbnails>>();
const keyOf = (entry: Entry) => `${entry.kind}:${entry.preset.id}`;

function thumbnail(target: Target, entry: Entry): Promise<string> {
  let cache = trayThumbnailCache.get(target);
  if (!cache) {
    cache = new Map();
    trayThumbnailCache.set(target, cache);
  }
  const key = keyOf(entry);
  let result = cache.get(key);
  if (!result) {
    result = renderThumbnail(target, entry);
    cache.set(key, result);
  }
  return result;
}

async function renderThumbnail(target: Target, entry: Entry): Promise<string> {
  const color = entry.kind === "mermaid" ? { color: "none" as const } : {};
  const options = { target, width: 60, height: 24, ...color };
  try {
    if (entry.kind === "sequence" || (entry.kind === "mermaid" && entry.preset.type === "sequenceDiagram")) {
      return (await renderGlyphSequence(entry.preset.source, options)).text;
    }
    if (entry.kind === "lanes") {
      const dag =
        entry.preset.sourceKind === "gitlog"
          ? glyphLaneDagFromGitLog(entry.preset.source)
          : validateGlyphLaneDag(JSON.parse(entry.preset.source));
      return (await renderGlyphLaneDag(dag, options)).text;
    }
    return (await renderGlyphDiagram(entry.preset.source, options)).text;
  } catch {
    return "Preview unavailable";
  }
}

// Explicit whole-tray readiness for verification; the mounted UI only asks
// for visible entries and shares these same per-target, per-preset promises.
export function glyphDiagramsTrayThumbnails(target: Target): Promise<Thumbnails> {
  let result = completeTrayCache.get(target);
  if (!result) {
    result = Promise.all(GLYPH_DIAGRAMS_TRAY.map(async (entry) => [keyOf(entry), await thumbnail(target, entry)])).then(
      (pairs) => Object.fromEntries(pairs),
    );
    completeTrayCache.set(target, result);
  }
  return result;
}

export function useDiagramsTrayThumbnails(target: Target, enabled: boolean) {
  const trayRef = useRef<HTMLElement | null>(null);
  const [completed, setCompleted] = useState<{
    target: Target;
    thumbnails: Thumbnails;
  }>({ target, thumbnails: {} });
  useEffect(() => {
    const tray = trayRef.current;
    if (!enabled || !tray) return;
    let current = true;
    let running = false;
    let cancelSlice: (() => void) | undefined;
    const visible = new Set<string>();
    const done = new Set<string>();

    function schedule() {
      if (!current || running || cancelSlice || ![...visible].some((key) => !done.has(key))) return;
      const run = () => {
        cancelSlice = undefined;
        if (!current) return;
        const entry = GLYPH_DIAGRAMS_TRAY.find((entry) => visible.has(keyOf(entry)) && !done.has(keyOf(entry)));
        if (!entry) return;
        running = true;
        void thumbnail(target, entry).then((text) => {
          if (!current) return;
          const key = keyOf(entry);
          done.add(key);
          setCompleted((previous) => ({
            target,
            thumbnails: {
              ...(previous.target === target ? previous.thumbnails : {}),
              [key]: text,
            },
          }));
          running = false;
          schedule();
        });
      };
      // A new browser task between entries lets the committed main preview
      // paint and user input run, even when a renderer resolves synchronously.
      if (typeof window.requestIdleCallback === "function") {
        const id = window.requestIdleCallback(run, { timeout: 1000 });
        cancelSlice = () => window.cancelIdleCallback(id);
      } else {
        const id = window.setTimeout(run, 0);
        cancelSlice = () => window.clearTimeout(id);
      }
    }

    const tiles = tray.querySelectorAll<HTMLElement>("[data-thumbnail-key]");
    const observer =
      typeof window.IntersectionObserver === "function"
        ? new window.IntersectionObserver((entries) => {
            for (const entry of entries) {
              const key = (entry.target as HTMLElement).dataset.thumbnailKey!;
              if (entry.isIntersecting) visible.add(key);
              else visible.delete(key);
            }
            schedule();
          })
        : undefined;
    for (const tile of tiles) {
      if (observer) observer.observe(tile);
      else visible.add(tile.dataset.thumbnailKey!);
    }
    schedule();
    return () => {
      current = false;
      cancelSlice?.();
      observer?.disconnect();
    };
  }, [target, enabled]);
  return {
    trayRef,
    thumbnails: completed.target === target ? completed.thumbnails : {},
  };
}
