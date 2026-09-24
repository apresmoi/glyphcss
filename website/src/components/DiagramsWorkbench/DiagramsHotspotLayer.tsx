/**
 * The render's hotspot layer: one REAL element per node box and per
 * straight run of an edge's route, laid over the diagram's `<pre>` at the
 * cell boxes the render result carries (`GlyphDiagramsWorkbenchHotspot`,
 * `diagramsWorkbenchRender.ts`). Elements are the point (user: "we need to
 * use hotspots, so we can design them"): a hotspot is a page-styled
 * `<button>` with idle / hover / selected states in CSS
 * (`.diagrams-hotspot*`, `diagrams-workbench.css`), keyed by item so a
 * re-render MOVES it (a style update) rather than re-creating it, the way
 * glyphcss's own `GlyphHotspotHandle.setAt` moves an anchor without
 * touching its element.
 *
 * Page-side, deliberately: glyphcss's hotspot primitive (`addHotspot`,
 * `projectHotspots`, `.glyph-hotspot-layer`) belongs to `createGlyphScene`
 * — an anchor is a 3D point projected through the scene's camera into the
 * scene's own overlay. The 2D diagram is a cell canvas painted into a plain
 * `<pre>`: no scene, no camera, no layer to add to. Until the library
 * mounts hotspots over a canvas render, the page owns the layer and uses
 * the engine's class vocabulary (`glyph-hotspot-layer`, `glyph-hotspot`)
 * so the design carries over when it does.
 *
 * Geometry: the `<pre>` is a fixed grid, so a cell box is the content box
 * divided by the grid; measured with a ResizeObserver on the `<pre>` and
 * its host (the host's width moves the centred `<pre>`), never per frame.
 * The layer is `pointer-events: none`; only the elements take the pointer,
 * so the glyphs between nodes stay selectable text.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { diagramsSourceItemKey, type DiagramsSourceItem } from "./diagramsSourceSelection";
import type { GlyphDiagramsWorkbenchHotspot } from "./diagramsWorkbenchRender";

interface Metrics { readonly left: number; readonly top: number; readonly cellW: number; readonly cellH: number }

export function diagramsHotspotItem(hotspot: GlyphDiagramsWorkbenchHotspot): DiagramsSourceItem {
  return hotspot.kind === "node" ? { kind: "node", id: hotspot.id } : { kind: "edge", from: hotspot.from, to: hotspot.to };
}

export function DiagramsHotspotLayer({ pre, hotspots, grid, selected, onSelect, onHover }: {
  /** The rendered `<pre>` the boxes index; the layer's own parent is the positioned host both share (`.diagrams-grid-scroll`). */
  readonly pre: HTMLPreElement | null;
  readonly hotspots: readonly GlyphDiagramsWorkbenchHotspot[];
  readonly grid: { readonly cols: number; readonly rows: number };
  readonly selected: DiagramsSourceItem | null;
  readonly onSelect: (item: DiagramsSourceItem) => void;
  /** The item under the pointer, or null when it leaves — the editor marks its fields. */
  readonly onHover?: (item: DiagramsSourceItem | null) => void;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const selectedKey = diagramsSourceItemKey(selected);

  useLayoutEffect(() => {
    // The parent, not `offsetParent`: an unmeasured layer is `hidden`
    // (display none), which has no offsetParent to measure against.
    const host = layerRef.current?.parentElement;
    if (!pre || !host) return;
    const measure = () => {
      const style = getComputedStyle(pre);
      const padL = parseFloat(style.paddingLeft) || 0, padT = parseFloat(style.paddingTop) || 0;
      const width = pre.clientWidth - padL - (parseFloat(style.paddingRight) || 0);
      const height = pre.clientHeight - padT - (parseFloat(style.paddingBottom) || 0);
      if (width <= 0 || height <= 0 || grid.cols <= 0 || grid.rows <= 0) { setMetrics(null); return; }
      const preRect = pre.getBoundingClientRect(), hostRect = host.getBoundingClientRect();
      setMetrics({
        left: preRect.left - hostRect.left + host.scrollLeft + pre.clientLeft + padL,
        top: preRect.top - hostRect.top + host.scrollTop + pre.clientTop + padT,
        cellW: width / grid.cols, cellH: height / grid.rows,
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(pre);
    observer.observe(host);
    return () => observer.disconnect();
  }, [pre, grid.cols, grid.rows, hotspots]);

  // The selected item scrolls into view (a no-op when it already is), so
  // Tab-walking the fields keeps the marked node on screen.
  useEffect(() => {
    if (!selectedKey) return;
    const el = Array.from(layerRef.current?.querySelectorAll<HTMLElement>("[data-item]") ?? []).find((candidate) => candidate.dataset.item === selectedKey);
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedKey, metrics]);

  // The elements exist whether or not the `<pre>` has been measured yet (an
  // unmeasured layer is hidden, not empty), so selection state is one DOM.
  return <div ref={layerRef} className="glyph-hotspot-layer diagrams-hotspot-layer" hidden={!metrics}>
    {hotspots.map((hotspot, index) => {
      const item = diagramsHotspotItem(hotspot);
      const key = diagramsSourceItemKey(item)!;
      const label = hotspot.kind === "node" ? `Edit node ${hotspot.id}` : `Edit edge ${hotspot.from} → ${hotspot.to}`;
      return <button type="button" key={`${key}#${index}`} data-item={key}
        className={`glyph-hotspot diagrams-hotspot is-${hotspot.kind}${key === selectedKey ? " is-selected" : ""}${key === hovered ? " is-hover" : ""}`}
        aria-label={label} title={label} aria-pressed={key === selectedKey}
        style={metrics ? { left: metrics.left + hotspot.x0 * metrics.cellW, top: metrics.top + hotspot.y0 * metrics.cellH, width: (hotspot.x1 - hotspot.x0 + 1) * metrics.cellW, height: (hotspot.y1 - hotspot.y0 + 1) * metrics.cellH } : undefined}
        onMouseEnter={() => { setHovered(key); onHover?.(item); }}
        onMouseLeave={() => { setHovered((current) => (current === key ? null : current)); onHover?.(null); }}
        onFocus={() => onHover?.(item)} onBlur={() => onHover?.(null)}
        onClick={() => onSelect(item)} />;
    })}
  </div>;
}
