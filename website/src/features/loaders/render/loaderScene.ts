import { type GlyphSceneHandle, WIREFRAME_PALETTES, createGlyphOrthographicCamera } from "glyphcss";
import { type LiveEdits } from "../model/liveEdits";
import { type LoaderPreset } from "../model/loaders";

type Polys = Parameters<GlyphSceneHandle["add"]>[0];

/**
 * Braille glyphs (U+28xx) are NOT in the monospace face this page renders with,
 * so the browser serves them from a fallback font at a different advance —
 * measured 7.52px vs 6.60px for ASCII, 14% wider. field-synth at
 * `subcellRes: "2x4"` skips cells whose value hits 0, and those fall through to
 * the base plane's ASCII ramp, so a frame mixes both widths; as the pattern
 * animates the mix changes, the widest line changes, and the whole `<pre>`
 * visibly resizes frame to frame.
 *
 * Fix: when a loader renders Braille, give the BASE a blank-Braille ramp. Every
 * cell is then a U+28xx glyph on one font with one advance — U+2800 has no dots,
 * so an empty cell looks exactly like a space but measures like Braille. This is
 * the same convention drawille-style renderers use for blank Braille cells.
 */
export const BRAILLE_BLANK_PALETTE = "loaders-braille-blank";

WIREFRAME_PALETTES[BRAILLE_BLANK_PALETTE] = {
  ...WIREFRAME_PALETTES.default!,
  solid: ["\u2800"],
};

/**
 * Braille's fallback font is WIDER than the monospace face (7.52px vs 6.60px at
 * 11px), so a Braille grid occupies a bigger box than the same cols×rows in
 * ASCII and every tile jumps ~14% when you switch Subcell. Pull the advance back
 * to the ASCII cell with negative tracking, measured live rather than hardcoded
 * because both advances scale with the rendered font-size. Braille dots sit well
 * inside their em box, so tightening by the difference doesn't clip them.
 */
export function applyBrailleTracking(pre: HTMLElement): void {
  const cs = getComputedStyle(pre);
  const probe = pre.ownerDocument.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;white-space:pre;letter-spacing:normal";
  probe.style.font = cs.font;
  pre.ownerDocument.body.appendChild(probe);
  const advance = (ch: string): number => {
    probe.textContent = ch.repeat(50);
    return probe.getBoundingClientRect().width / 50;
  };
  const ascii = advance("M");
  const braille = advance("\u28FF");
  probe.remove();
  pre.style.letterSpacing = ascii > 0 && braille > 0 ? `${(ascii - braille).toFixed(3)}px` : "";
}

/**
 * The overlay is a SECOND `<pre>` stacked on the tile, not a layer composited
 * into the same grid — a grid holds one glyph per cell, so compositing would
 * REPLACE the loader's glyphs rather than overlay them. Stacking keeps the
 * loader intact underneath and lets CSS opacity do the blending.
 *
 * Its base plane uses a ramp of pure spaces so every cell the voice does not
 * reach stays empty and the render below shows through untouched.
 */
export const GHOST_BLANK_PALETTE = "loaders-ghost-blank";

WIREFRAME_PALETTES[GHOST_BLANK_PALETTE] = {
  ...WIREFRAME_PALETTES.default!,
  solid: [" "],
};

/**
 * The overlay renders the voice through field-synth's `subcellRes: "ink"` — a
 * contour map of the voice's own field, strokes oriented to the local slope.
 * Colouring a ramp by value (what this used to do) can only ever scatter marks;
 * a contour is a boundary, so it has to come from where the field CROSSES a
 * level, which only the effect can know.
 *
 * Few cuts on purpose: each level is another line through the same field, and
 * the point here is "where does this voice act", not a survey of its amplitude.
 */
export const GHOST_INK_LEVELS = 2;

/** Crest colour (value 1) and valley colour (value 0): `gradient: 1` makes
 *  field-synth interpolate between them by value, so the two lines are told
 *  apart at a glance rather than being one colour at two heights. */
export const GHOST_CREST = "#ffffff";

export const GHOST_VALLEY = "#38bdf8";

export const rendersBraille = (loader: LoaderPreset, live?: LiveEdits): boolean =>
  loader.layers.some((layer, index) => (live?.layerParams[index]?.subcellRes ?? layer.params.subcellRes) === "2x4");

// Every loader is a texture on the same head-on flat quad, so the page compares
// patterns and box shapes rather than geometry.
export function flatQuad(size: number, color: string): Polys {
  return [
    {
      vertices: [
        [-size, -size, 0],
        [size, -size, 0],
        [size, size, 0],
        [-size, size, 0],
      ],
      uvs: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      color,
    },
  ] as unknown as Polys;
}

// One rAF for the whole page. Each tile is tiny, but there are ~30 of them —
// thirty independent loops would each pay their own callback and their own clock
// drift, and a footer mini would visibly run out of phase with the stage tile
// showing the same loader.
type Tick = (t: number) => void;

const ticks = new Set<Tick>();

let clockRaf = 0;

let clockLast = 0;

let clockTime = 0;

function pumpClock(now: number): void {
  clockRaf = requestAnimationFrame(pumpClock);
  const dt = Math.min((now - clockLast) / 1000, 0.1);
  clockLast = now;
  clockTime += dt;
  for (const fn of ticks) fn(clockTime);
}

export function registerTick(fn: Tick): () => void {
  if (ticks.size === 0) {
    clockLast = performance.now();
    clockRaf = requestAnimationFrame(pumpClock);
  }
  ticks.add(fn);
  return () => {
    ticks.delete(fn);
    if (ticks.size === 0) cancelAnimationFrame(clockRaf);
  };
}

/** Zoom the head-on quad so it covers the whole cols×rows grid. Must project
 *  with the MEASURED cell (see synthKit's `frameObject` for the same rationale):
 *  the default `cellAspect` is ~20% off the real monospace cell, and a
 *  fixed-size scene has no `fitToHost` to correct it. */
export function coverGrid(
  scene: GlyphSceneHandle,
  camera: ReturnType<typeof createGlyphOrthographicCamera>,
  polys: Polys,
  overscan = 1,
): void {
  const o = scene.getOptions();
  const cols = o.cols ?? 80,
    rows = o.rows ?? 24;
  const pre = scene.host.querySelector("pre.glyph-output") as HTMLElement | null;
  let metrics: { cellWidth: number; cellHeight: number } | undefined;
  let cellAspect = o.cellAspect ?? 2;
  if (pre) {
    const r = pre.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      metrics = { cellWidth: r.width / cols, cellHeight: r.height / rows };
      cellAspect = metrics.cellHeight / metrics.cellWidth;
      scene.setOptions({ cellAspect });
    }
  }
  camera.zoom = 1;
  let minc = Infinity,
    maxc = -Infinity,
    minr = Infinity,
    maxr = -Infinity;
  for (const p of polys as unknown as { vertices: [number, number, number][] }[]) {
    for (const v of p.vertices) {
      const pr = camera.project(v, cols, rows, cellAspect, metrics);
      if (!isFinite(pr[0]!) || !isFinite(pr[1]!)) continue;
      if (pr[0]! < minc) minc = pr[0]!;
      if (pr[0]! > maxc) maxc = pr[0]!;
      if (pr[1]! < minr) minr = pr[1]!;
      if (pr[1]! > maxr) maxr = pr[1]!;
    }
  }
  const w = maxc - minc,
    h = maxr - minr;
  if (w > 0 && h > 0) camera.zoom = Math.max(cols / w, rows / h) * overscan;
}
