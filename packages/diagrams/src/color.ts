import { glyphDiagramError } from "./validate";

/**
 * Colour surface shared by every 2D diagram form — root graph, `./sequence`,
 * `./lanes` — mirroring `@glyphcss/charts`' own `GLYPH_CHART_3D_SERIES_PALETTE`
 * role: a small, fixed, categorical default a caller gets before supplying
 * a `nodeColor`/`edgeColor`/`laneColor`/`participantColor` override. Kept
 * LOCAL to this package (never imported from `@glyphcss/charts`) — that
 * package's own doc on its palette says the same about the root package's:
 * a different vocabulary, a different consumer. Cycled by index (never
 * picked by name), so a lane/participant's colour is a pure function of its
 * position.
 */
export const GLYPH_DIAGRAM_PALETTE: readonly string[] = [
  "#4c78a8", "#f58518", "#54a24b", "#e45756", "#72b7b2", "#eeca3b", "#b279a2", "#ff9da6",
];

/** Cycles `GLYPH_DIAGRAM_PALETTE` by an arbitrary (possibly negative) index. */
export function glyphDiagramPaletteColor(index: number): string {
  const n = GLYPH_DIAGRAM_PALETTE.length;
  return GLYPH_DIAGRAM_PALETTE[((index % n) + n) % n]!;
}

/**
 * Mirrors `glyphcss`'s own cell-canvas contract exactly (`CANVAS_CANONICAL_HEX`
 * in `packages/glyphcss/src/render/canvas/canvas.ts`, and `@glyphcss/charts`'
 * own `CANONICAL_HEX_COLOR` in `src/validate.ts`) — canonical lowercase
 * `#rrggbb`. Checked here, before a resolved colour ever reaches
 * `canvas.text`/`fillRect`/`arrowhead`, so an invalid `nodeColor`/`edgeColor`/
 * `laneColor`/`participantColor` throws this package's own tagged `bad-color`
 * error (a `GLYPH_*_VALIDATION_RULES` entry with its own repair hint in every
 * form's `validate.ts`) instead of the canvas's untagged `TypeError`.
 */
const GLYPH_DIAGRAM_CANONICAL_HEX = /^#[0-9a-f]{6}$/;
export function isGlyphDiagramCanonicalHexColor(value: unknown): value is string {
  return typeof value === "string" && GLYPH_DIAGRAM_CANONICAL_HEX.test(value);
}

/**
 * Resolves a `string | ((item) => string)` colour option against ITEM,
 * returning the raw override — `undefined` when the option itself is unset.
 * Deliberately never applies a fallback itself: a caller may need a
 * DIFFERENT fallback at different paint sites that otherwise share one
 * override once given (the 2D graph form's `edgeColor` covers both a
 * route's cells and its arrowhead/label, but the two kept different prior
 * defaults — see `paint.ts`'s own doc). `field` names the option in the
 * thrown message (`"nodeColor"`, `"laneColor"`, ...) so a bad value is
 * traceable to its source.
 */
export function resolveGlyphDiagramColorOption<T>(option: string | ((item: T) => string) | undefined, item: T, field: string): string | undefined {
  const resolved = typeof option === "function" ? option(item) : option;
  if (resolved !== undefined && !isGlyphDiagramCanonicalHexColor(resolved)) {
    glyphDiagramError("bad-color", `${field} must resolve to a canonical lowercase #rrggbb string, got ${JSON.stringify(resolved)}.`);
  }
  return resolved;
}

/**
 * `resolveGlyphDiagramColorOption` plus a fallback applied when the option
 * is unset, shared
 * here so every 2D form shares one resolution rule instead of near-identical
 * copies.
 */
export function resolveGlyphDiagramColor<T>(option: string | ((item: T) => string) | undefined, item: T, fallback: string, field: string): string {
  return resolveGlyphDiagramColorOption(option, item, field) ?? fallback;
}
