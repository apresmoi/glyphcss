/**
 * Charset tiers for the cell canvas (CHARTS-RESEARCH Phase 0).
 *
 * A tier is a table, never a code branch: every painter looks up the glyph
 * it needs from `GLYPH_CANVAS_TIERS[canvas.tier]` instead of switching on the
 * tier name inline. That is what makes "switching tiers" a pure data swap —
 * the same sequence of `fillRect`/`line`/`connect` calls against a different
 * tier produces a structurally comparable grid whose differences are
 * confined to table-driven cells (the "tier swap" gate).
 *
 * The four tiers carry the SAME keys (the "tier parity" gate) so a consumer
 * can be generic over which one is active. `ascii` and `box` fill shaded
 * areas from `shadeRamp` (a 1-D intensity ramp); `blocks` and `braille`
 * instead derive their fill glyph from the canvas-owned `sub` occupancy
 * buffer (see `canvas.ts`), so their `shadeRamp` is carried for parity and
 * for a caller that wants a linear ramp regardless of tier, but is not
 * consulted by `fillRect` for those two.
 */

import { WIREFRAME_PALETTES } from "../ramps";

/**
 * N/E/S/W side bits a `connect()` mask is built from — the same 4-bit
 * convention `rasterize.ts`'s internal wireframe-junction pass uses
 * (independently re-declared here: nothing in the existing render path is
 * imported by this module, and nothing here is imported by it).
 */
export const GLYPH_CANVAS_DIRECTION_BITS = Object.freeze({ n: 1, e: 2, s: 4, w: 8 } as const);

export interface GlyphCanvasStraightGlyphs {
  readonly h: string;
  readonly v: string;
}

export interface GlyphCanvasArrowGlyphs {
  readonly n: string;
  readonly e: string;
  readonly s: string;
  readonly w: string;
}

/**
 * `line()`'s diagonal (non-axis-aligned) glyph vocabulary, keyed by the
 * RAW box-tier glyph `inkGlyphForTangent` (`../rasterize`) can return for a
 * sloped run — `‾ ▔ ▏ ▕ / \ - | _`, the same nine the existing `ink` render
 * mode uses for a smoothed contour tangent (AGENTS.md's render-modes table).
 * Every tier maps each of these nine keys to ITS OWN vocabulary, so a
 * diagonal `line()` call is table-driven exactly like every other painter —
 * an `ascii` canvas never emits `‾`/`▔`/`▕`/`▏`, which are outside
 * `0x20-0x7e`. The degenerate zero-length case (`inkGlyphForTangent`'s `·`)
 * is not a member of this table: it reuses `dot` directly, since `·` IS
 * `box`'s own `dot` glyph and every tier already has one.
 */
export type GlyphCanvasDiagonalKey = "‾" | "▔" | "▏" | "▕" | "/" | "\\" | "-" | "|" | "_";
export type GlyphCanvasDiagonalGlyphs = Readonly<Record<GlyphCanvasDiagonalKey, string>>;

export interface GlyphCanvasTier {
  /** Plain axis-aligned run glyphs, style `"solid"`. */
  readonly straight: GlyphCanvasStraightGlyphs;
  /**
   * N/E/S/W bit-combination (1..15) → box-drawing glyph. Single-bit entries
   * (a stub/endpoint) resolve to the same glyph as the matching pair (a lone
   * `N` stub reads as a vertical rule, same as `N|S`) — a dangling endpoint
   * still needs to look like a rule, not a blank.
   */
  readonly junction: Readonly<Record<number, string>>;
  /**
   * The glyph a crossing cell renders when the winning edge's own path is a
   * plain straight transit (`E|W` or `N|S`) — oriented to the WINNER's own
   * axis (see `junctions.ts`'s `resolveGlyphCanvasJunctions`), so the mark
   * reads as "the winner's line, with a dashed break here" rather than a
   * perpendicular symbol that looks like a hole punched through it. A
   * winning stub or corner keeps its own `junction` glyph instead — this
   * table is consulted only for the plain-transit case.
   */
  readonly hop: GlyphCanvasStraightGlyphs;
  /** Orientation-agnostic dotted-line glyph. */
  readonly dot: string;
  /** Double-line run glyphs, style `"double"`. */
  readonly double: GlyphCanvasStraightGlyphs;
  /** Arrowhead tip glyphs. */
  readonly arrow: GlyphCanvasArrowGlyphs;
  /** See {@link GlyphCanvasDiagonalGlyphs}. */
  readonly diagonal: GlyphCanvasDiagonalGlyphs;
  /**
   * Dark → bright shading ramp consulted by `fillRect` for `ascii`/`box`;
   * present (and real) on all four tiers for parity, but `blocks`/`braille`
   * derive their fill glyph from sub-cell occupancy instead of this ramp.
   */
  readonly shadeRamp: readonly string[];
  /**
   * Whether `fillRect` derives this tier's fill glyph from the canvas-owned
   * `sub` occupancy buffer (`true`, `blocks`/`braille`) rather than
   * `shadeRamp` (`false`, `ascii`/`box`). A DATA flag, not a tier name — the
   * painter branches on THIS, never on `canvas.tier === "blocks"`, which is
   * what keeps "every painter reads its glyph from the active tier's own
   * table" true of the sub-cell path too.
   */
  readonly subcell: boolean;
  /**
   * Present only when `subcell` is `true`: the 8-bit `sub` occupancy mask →
   * this tier's own single-cell glyph. `blocks` groups the 8 dot bits into
   * 4 quadrants and looks up `GLYPH_CANVAS_QUADRANT_GLYPHS`; `braille` uses
   * the mask directly as a Unicode braille pattern offset. Carrying this as
   * a per-tier function (rather than a `canvas.ts` branch on `tier ===
   * "braille"`) means the CALLER never chooses between the two encodings by
   * name either.
   */
  readonly subGlyph?: (mask: number) => string;
  /**
   * Present only when `subcell` is `true`: overrides `subGlyph` for
   * `fillRect` SPECIFICALLY (never `line()`/dots, which always consult
   * `subGlyph` itself) — `undefined` means "same as `subGlyph`" (`blocks`,
   * where the two are already identical). `braille` is the one tier where
   * they diverge: a filled bar/area/heatmap cell reads as a solid block
   * (`█`, with `blocks`' own quadrant glyphs for partial coverage) rather
   * than a braille dot pattern (`⣿`), because a fill is DENSITY, not a
   * curve — and reusing `blocks`' own table (not a parallel one) is what
   * keeps a braille chart's bars/areas pixel-identical to a `blocks` chart's,
   * while `line()`'s actual curves stay genuine braille dots so a line chart
   * still reads at braille's real sub-cell resolution.
   */
  readonly fillSubGlyph?: (mask: number) => string;
}

export type GlyphCanvasTierName = "ascii" | "box" | "blocks" | "braille";

const { n: N, e: E, s: S, w: W } = GLYPH_CANVAS_DIRECTION_BITS;

/**
 * Box-drawing line/junction/hop/dot/double/arrow/diagonal glyphs, shared by
 * `box`, `blocks` and `braille`. These three still draw ROUTES (`edge()`/
 * `route()`/`resolveJunctions()`) and ARROWHEADS identically — that line art
 * has no sub-cell analogue worth inventing (a route is a graph, an
 * arrowhead a fixed tip shape, neither a geometric slope to rasterise
 * finer). `line()` itself is the exception: in `braille`/`blocks` it
 * bypasses this table's `straight`/`diagonal`/`double`/`dot` entries
 * entirely and rasterises at sub-cell (dot) resolution into `sub` instead
 * (`canvas.ts`'s `paintSubcellLine`) — those four entries stay on this
 * table only for the tier-parity gate's shape, exactly as `shadeRamp`
 * already does for `fillRect`.
 */
const BOX_LINE_GLYPHS = {
  straight: { h: "─", v: "│" },
  junction: {
    [N]: "│", [S]: "│", [N | S]: "│",
    [E]: "─", [W]: "─", [E | W]: "─",
    [N | E]: "└", [N | W]: "┘", [S | E]: "┌", [S | W]: "┐",
    [N | E | S]: "├", [N | S | W]: "┤", [E | S | W]: "┬", [N | E | W]: "┴",
    [N | E | S | W]: "┼",
  },
  // U+254C/U+254E "BOX DRAWINGS LIGHT DOUBLE DASH HORIZONTAL/VERTICAL" —
  // already read as "a broken rule" independent of this feature, which is
  // exactly the visual a contested straight transit needs: it stays on the
  // WINNER's own axis, so it reads as the winner's own line with a dash in
  // it, not a foreign mark crossing it.
  hop: { h: "╌", v: "╎" },
  dot: "·",
  double: { h: "═", v: "║" },
  arrow: { n: "▲", e: "▶", s: "▼", w: "◀" },
  // The box tier's diagonal glyphs ARE `inkGlyphForTangent`'s own raw
  // vocabulary — no remapping needed, this table is the identity.
  diagonal: {
    "‾": "‾", "▔": "▔", "▏": "▏", "▕": "▕",
    "/": "/", "\\": "\\", "-": "-", "|": "|", "_": "_",
  },
} satisfies Omit<GlyphCanvasTier, "shadeRamp" | "subcell" | "subGlyph">;

/**
 * Pure-ASCII line/junction/hop/dot/double/arrow/diagonal glyphs for the
 * `ascii` tier. Box-drawing has no ASCII equivalent for a T/cross join, so
 * every 2+-bit combination collapses to `+` (the traditional ASCII
 * box-drawing convention — see any `--dry-run` diff/tree renderer). The
 * sub-cell vertical-offset detail in `‾`/`▔`/`-`/`_` and the horizontal
 * detail in `▏`/`|`/`▕` collapse to plain `-`/`|` — ASCII has no fractional
 * ink glyphs at all, so the offset information is simply lost, not
 * approximated by an out-of-set character.
 */
const ASCII_LINE_GLYPHS = {
  straight: { h: "-", v: "|" },
  junction: {
    [N]: "|", [S]: "|", [N | S]: "|",
    [E]: "-", [W]: "-", [E | W]: "-",
    [N | E]: "+", [N | W]: "+", [S | E]: "+", [S | W]: "+",
    [N | E | S]: "+", [N | S | W]: "+", [E | S | W]: "+", [N | E | W]: "+",
    [N | E | S | W]: "+",
  },
  hop: { h: "~", v: ":" },
  dot: ".",
  // ASCII has no dedicated double-line glyphs; "=" reads as a doubled rule
  // and "#" as a doubled upright, both staying inside 0x20-0x7e.
  double: { h: "=", v: "#" },
  arrow: { n: "^", e: ">", s: "v", w: "<" },
  diagonal: {
    "‾": "-", "▔": "-", "▏": "|", "▕": "|",
    "/": "/", "\\": "\\", "-": "-", "|": "|", "_": "_",
  },
} satisfies Omit<GlyphCanvasTier, "shadeRamp" | "subcell" | "subGlyph">;

/**
 * 4-bit quadrant mask (bit0 top-left, bit1 top-right, bit2 bottom-left, bit3
 * bottom-right) → the matching Unicode quadrant/half/full block glyph. Used
 * by the `blocks` tier's own {@link GlyphCanvasTier.subGlyph} to derive a
 * fill glyph from the shared `sub` occupancy buffer (see `canvas.ts`'s
 * `GlyphCanvas.sub` doc for the bit layout `quadrantMaskFromSub` reads).
 */
export const GLYPH_CANVAS_QUADRANT_GLYPHS: readonly string[] = [
  " ", "▘", "▝", "▀",
  "▖", "▌", "▞", "▛",
  "▗", "▚", "▐", "▜",
  "▄", "▙", "▟", "█",
];

// Groups the 8 braille-dot bits into the four quadrant halves
// GLYPH_CANVAS_QUADRANT_GLYPHS is keyed on (bit0 TL, bit1 TR, bit2 BL, bit3
// BR) — see `GlyphCanvas.sub`'s doc (`canvas.ts`) for the dot layout these
// masks reference. Lives here, not in `canvas.ts`, so `blocks.subGlyph` can
// close over it directly instead of `fillRect` branching on the tier name.
function quadrantMaskFromSub(sub: number): number {
  let q = 0;
  if (sub & (1 | 2)) q |= 1; // top-left: dots at (col0,row0)=bit0, (col0,row1)=bit1
  if (sub & (8 | 16)) q |= 2; // top-right: (col1,row0)=bit3, (col1,row1)=bit4
  if (sub & (4 | 64)) q |= 4; // bottom-left: (col0,row2)=bit2, (col0,row3)=bit6
  if (sub & (32 | 128)) q |= 8; // bottom-right: (col1,row2)=bit5, (col1,row3)=bit7
  return q;
}

/**
 * `ascii`'s own shading ramp — never `WIREFRAME_PALETTES.dense.solid`
 * (`"%$EUKH#D80BM@N"`), which is a calibrated ink ramp for photographic
 * WIREFRAME scenes and includes letters (`E`, `U`, `K`, `H`, `D`, `B`, `M`,
 * `N`). A `fillRect({ fill: "solid" })` bar in an ASCII chart must never
 * read as text, so this ramp is dedicated: 8 steps, blank at `shade: 0`,
 * `#` at `shade: 1` (also what `fill: "solid"` resolves to, since it maps
 * to `shade: 1` — see `resolveFillShade` in `canvas.ts`).
 */
const ASCII_SHADE_RAMP = " .:-=+*#".split("");

/**
 * `box`'s own shading ramp is likewise blank at `shade: 0` — a leading
 * blank entry, so `shade: 0` reads as "nothing painted" on every tier that
 * derives fill from `shadeRamp`, the same property `ascii`'s ramp already
 * had. Without it, `box` painted `"░"` (light shade) at `shade: 0` while
 * `ascii`/`blocks`/`braille` all painted nothing — a heatmap or a
 * zero-valued stacked bar gained visible ink purely from switching tiers,
 * even though "switching tiers is a data swap" is the whole point of this
 * table (see the module doc).
 */
const BOX_SHADE_RAMP = " ░▒▓█".split("");

// `subGlyph` is assigned explicitly (even where `undefined`) on every tier —
// never simply omitted for ascii/box — so `Object.keys()` sees the SAME key
// set on all four tiers. Omitting it there would desync the tier-parity
// gate (which walks own-enumerable keys at every depth) for a key that is
// genuinely part of the table's shape, not merely absent from two of it.
// Shared by `blocks`' own `subGlyph` and `braille`'s `fillSubGlyph` — see
// both fields' doc comments on `GlyphCanvasTier`.
const quadrantSubGlyph = (mask: number): string => GLYPH_CANVAS_QUADRANT_GLYPHS[quadrantMaskFromSub(mask)]!;

export const GLYPH_CANVAS_TIERS: Readonly<Record<GlyphCanvasTierName, GlyphCanvasTier>> = Object.freeze({
  ascii: { ...ASCII_LINE_GLYPHS, shadeRamp: ASCII_SHADE_RAMP, subcell: false, subGlyph: undefined, fillSubGlyph: undefined },
  box: { ...BOX_LINE_GLYPHS, shadeRamp: BOX_SHADE_RAMP, subcell: false, subGlyph: undefined, fillSubGlyph: undefined },
  blocks: {
    ...BOX_LINE_GLYPHS,
    shadeRamp: WIREFRAME_PALETTES.blocks!.solid,
    subcell: true,
    subGlyph: quadrantSubGlyph,
    fillSubGlyph: undefined,
  },
  braille: {
    ...BOX_LINE_GLYPHS,
    shadeRamp: WIREFRAME_PALETTES.braille!.solid,
    subcell: true,
    subGlyph: (mask) => String.fromCodePoint(0x2800 + mask),
    // fillRect only (packet "Braille-tier fills") — line()/dots keep real
    // braille dots via `subGlyph` above.
    fillSubGlyph: quadrantSubGlyph,
  },
});
