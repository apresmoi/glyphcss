import { useEffect, useState, type RefObject } from "react";

/** A measured element's CONTENT-BOX pixel size — no padding, no border,
 *  no scrollbar (`ResizeObserver`'s own `contentRect`/`contentBoxSize`
 *  contract). */
export interface ElementPixelSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Tracks an element's live content-box pixel size via `ResizeObserver` —
 * the website-layer analogue of `createGlyphScene({ autoSize: true })`
 * (AGENTS.md's own "How `/maps`, `/synth` and `/gallery` size their
 * scenes to the viewport" precedent): those pages hand a host element
 * straight to a live glyphcss scene, which measures it internally; a 2D
 * chart/diagram has no live scene of its own to `autoSize` (`renderGlyphChart`/
 * `renderGlyphDiagram` take explicit `width`/`height` in CELLS, not a DOM
 * node), so this hook is the website's own equivalent seam — its caller
 * converts the returned pixel box into a cell count itself
 * (`glyphMonoMetrics.ts`'s `glyphMonoWebGridSize`).
 *
 * `null` before the first real measurement (SSR, initial mount, or no
 * `ResizeObserver` in this environment — happy-dom's own test DOM has no
 * layout engine at all, AGENTS.md's own testing note, so every mounted-
 * component test that needs a measured size DRIVES this hook's observer
 * callback directly rather than expecting a real layout to produce one).
 */
export function useElementSize<T extends HTMLElement>(ref: RefObject<T | null>): ElementPixelSize | null {
  const [size, setSize] = useState<ElementPixelSize | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const box = entry.contentBoxSize?.[0];
      const width = box ? box.inlineSize : entry.contentRect.width;
      const height = box ? box.blockSize : entry.contentRect.height;
      // Keeps the PREVIOUS object (referentially) on a no-op refire — a
      // `ResizeObserver` fires at least once on `observe()` regardless of
      // whether anything changed, and diagrams' own render is an ASYNC
      // dagre layout pass keyed on this value's identity
      // (`DiagramsWorkbench.tsx`), so a spurious identical measurement must
      // not restart it.
      setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
    // `ref` (a `useRef` object) is stable for the component's lifetime —
    // this observes whatever DOM node is attached the moment the effect
    // runs (after the ref-bearing element has already committed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return size;
}
