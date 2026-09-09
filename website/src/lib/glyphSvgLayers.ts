/**
 * SVG export for a scene that renders into MORE THAN ONE `<pre>`.
 *
 * `glyphSvgExport.ts` exports one `<pre>` — right for /synth, /wordart and
 * /gallery, which have exactly one. /maps does not: glyphcss pops a mesh into
 * its own silhouette-fitted, CSS-translated `<pre>` whenever it declares a
 * `density`, its own `mode`, a `glyphPalette`, `transparent` or an
 * `ambientIntensity` (AGENTS.md, "Per-mesh detail layers"), and `@glyphcss/
 * maps` uses that for every stroke overlay and every OSM layer with a density
 * of its own. Measured on the built page with the OSM card on and the
 * per-layer densities the Layers rail offers: ELEVEN `<pre>` elements, at
 * font sizes from 4.2px to 13px.
 *
 * So "Download SVG" was exporting the terrain and dropping the roads, the
 * borders, the contours and the buildings — everything the reader had
 * switched on. This composites them.
 *
 * ## Why SVG can do this and "Copy ASCII" cannot
 *
 * The layers do not share a grid. The base is 140x63 at 13px; a 2.9x OSM
 * layer is 201 rows at 4.2px, translated by a fraction of a cell. There is no
 * character grid that holds both, so there is no text file that is the
 * composite — "Copy ASCII" is the base grid by construction, not by
 * oversight, and it says so on the button.
 *
 * SVG has no such problem: it is pixel space. Each `<pre>` is emitted as its
 * own `<g>` at its own font size, translated by its own offset from the base
 * `<pre>`'s top-left — the same offset the browser is already applying — so
 * the file is the picture on screen.
 */
import { glyphExportGridFromPre } from "./glyphExportGrid";
import { buildGlyphSvg, measureGlyphSvgMetrics, type GlyphSvgMetrics, type SvgGrid } from "./glyphSvgExport";

export interface GlyphSvgLayer {
  readonly grid: SvgGrid;
  readonly metrics: GlyphSvgMetrics;
  /** Offset from the composite's origin, CSS px. */
  readonly dx: number;
  readonly dy: number;
}

/** Pull one `<g>` body (and its background rect, if any) out of a single-layer SVG. */
function innerOf(svg: string): { readonly body: string; readonly bg: string } {
  const gStart = svg.indexOf("<g ");
  const gEnd = svg.lastIndexOf("</g>");
  if (gStart < 0 || gEnd < 0) return { body: "", bg: "" };
  return { body: svg.slice(gStart, gEnd + 4), bg: svg.slice(svg.indexOf(">", svg.indexOf("<svg")) + 1, gStart) };
}

/**
 * Composite pre-measured layers into one SVG.
 *
 * The FIRST layer is the base: it supplies the background and the canvas
 * size, because that is what the reader sees behind everything else and what
 * the map's own viewport is. A detail layer is silhouette-fitted, so it can
 * legitimately be larger than the base and hang outside it; it is emitted at
 * its own offset and clipped by the viewBox exactly as the browser clips it
 * to the viewport.
 */
export function buildGlyphSvgLayers(layers: readonly GlyphSvgLayer[]): string | null {
  if (layers.length === 0) return null;
  const base = layers[0]!;
  const baseSvg = buildGlyphSvg(base.grid, base.metrics);
  if (layers.length === 1) return baseSvg;

  const width = base.grid.reduce((m, r) => Math.max(m, r.length), 0) * base.metrics.cellWidthPx;
  const height = base.grid.length * base.metrics.cellHeightPx;
  const round = (n: number) => Math.round(n * 1000) / 1000;

  const parts: string[] = [];
  const { bg } = innerOf(baseSvg);
  parts.push(bg);
  for (const layer of layers) {
    // Each layer is built with NO background of its own — only the base's
    // opaque ground belongs in the file; a detail layer painting its own
    // would erase everything under it.
    const svg = buildGlyphSvg(layer.grid, { ...layer.metrics, background: undefined });
    const { body } = innerOf(svg);
    if (!body) continue;
    parts.push(
      layer.dx === 0 && layer.dy === 0
        ? body
        : `<g transform="translate(${round(layer.dx)} ${round(layer.dy)})">${body}</g>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${round(width)} ${round(height)}" width="${round(width)}" height="${round(height)}">`
    + parts.join("")
    + `</svg>`
  );
}

/**
 * Measure every rendered `<pre>` in DOM order and composite them.
 *
 * `null` when nothing is rendered — the same contract `glyphSvgFromPre` has.
 * A `<pre>` with an empty grid (a detail layer whose mesh is off screen) is
 * skipped rather than contributing an empty `<g>`.
 */
export function glyphSvgFromPres(pres: readonly HTMLElement[]): string | null {
  const measured: GlyphSvgLayer[] = [];
  let origin: DOMRect | null = null;
  for (const pre of pres) {
    const grid = glyphExportGridFromPre(pre);
    if (!grid || grid.every((r) => r.length === 0)) continue;
    const rect = pre.getBoundingClientRect();
    if (!origin) origin = rect;
    measured.push({
      grid,
      metrics: measureGlyphSvgMetrics(pre, grid),
      dx: rect.left - origin.left,
      dy: rect.top - origin.top,
    });
  }
  return buildGlyphSvgLayers(measured);
}

/** "Download SVG" for a multi-`<pre>` scene. `false` when there was nothing to export. */
export function downloadGlyphSvgLayers(pres: readonly HTMLElement[], filename: string): boolean {
  const svg = glyphSvgFromPres(pres);
  if (svg === null) return false;
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
