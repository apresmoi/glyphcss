import type { CharRamp } from "@glyphcss/core";

/** Default shading ramp — darkest → brightest. */
export const DEFAULT_RAMP: CharRamp = " .:-=+*#%@".split("");

/** Solid-mode shading ramp: 10 chars, index = floor(intensity * 9). */
export const SOLID_RAMP: CharRamp = " .:-=+*#%@".split("");

export interface WireframeGlyphTiers {
  thin: string[];
  normal: string[];
  core: string[];
  /** Solid-mode intensity ramp (darkest → brightest) for this palette. */
  solid: string[];
}

// High-detail solid ramp (dark → bright): the canonical 70-char luminance ramp
// reversed, giving ~7× the intensity levels of the 10-char default for smooth
// tonal gradation. Ramp length is free for colored output — `solidBufToString`
// coalesces runs by COLOR, not glyph, so more distinct glyphs cost nothing.
const QUAKE_DETAIL_SOLID: CharRamp =
  "$@B%8&WM#*oahkbdpqwmZO0QLCJUYXzcvunxrjft/\\|()1{}[]?-_+~<>i!lI;:,\"^`'. "
    .split("")
    .reverse();

/** Named glyph palettes — each defines wireframe tiers AND a solid ramp. */
export const WIREFRAME_PALETTES: Record<string, WireframeGlyphTiers> = {
  // Dense ASCII intensity ramp for textured/photographic solid scenes that want
  // maximum tonal detail per cell (e.g. cssQuake's ASCII world).
  detail: {
    thin: ".'".split(""),
    normal: "+*x".split(""),
    core: "#@".split(""),
    solid: QUAKE_DETAIL_SOLID,
  },
  // High-floor, printable-ASCII-only density ramp for sub-2-device-px cells:
  // when a cell is smaller than ~2 device px, glyph SHAPES can't resolve and
  // only the fraction of the cell that carries ink survives as colour — a
  // sparse glyph washes the cell to grey/black. Every step here keeps ≥ ~25%
  // ink so each cell reads as its COLOUR at any size, while the ramp still
  // shades dark → bright. Steps are ordered by MEASURED alpha-weighted ink
  // coverage in Menlo (the atlas's primary source face) at the 0.606 cell
  // aspect — the same measurement `@glyphcss/effects`'s calibrateRamp does:
  //   %24.8 $26.3 E26.9 U27.6 K28.3 H28.9 #29.4 D29.8 8'31.0 0'32.8
  //   B33.6 M34.3 @35.1 N37.3   (percent of cell inked)
  // Every glyph is printable ASCII (< 0x80) BY DESIGN: this is the ramp for a
  // consumer under a hard ASCII-only output constraint (a terminal, a fixed
  // 7-bit pipeline, `fontAtlas: GLYPH_FONT_ATLAS_ASCII`), which is also what
  // keeps every step inside the 94-glyph ASCII atlas. Do not "improve" this
  // ramp with block/Unicode characters.
  dense: {
    thin: "%$".split(""),
    normal: "KH#".split(""),
    core: "@N".split(""),
    solid: "%$EUKH#D80BM@N".split(""),
  },
  default: {
    thin: "·⋅∙˙·⋅∙".split(""),
    normal: "╋╬┼╳◆◇◊▲△▼▽◈⬡⬢∴∵⊥⊕⊗⊙⊚⊛".split(""),
    core: "✦✧✩◉⊙◎".split(""),
    solid: " .:-=+*#%@".split(""),
  },
  ascii: {
    thin: ".'".split(""),
    normal: "+*x".split(""),
    core: "#@".split(""),
    solid: " .,:;!+=*xX#@".split(""),
  },
  dots: {
    thin: "·⋅".split(""),
    normal: "•●".split(""),
    core: "◉◎".split(""),
    solid: " ·⋅∘•●◉◎⬤".split(""),
  },
  lines: {
    thin: "─│".split(""),
    normal: "═║".split(""),
    core: "█".split(""),
    solid: " ─═╬║█▓▒░".split(""),
  },
  blocks: {
    thin: "░▁".split(""),
    normal: "▒▓▌▐▀▄".split(""),
    core: "█".split(""),
    solid: " ░▒▓▌▐█▀▄■".split(""),
  },
  // Plain solid fill: EVERY covered cell is a full block, so surfaces read as
  // flat filled color (shading comes from the per-cell colour, which is already
  // baked-lit) — no dithered shade glyphs or black gaps within a surface. Empty
  // (uncovered) cells stay blank as usual. Use for a clean, low-contrast look.
  solid: {
    thin: "█".split(""),
    normal: "█".split(""),
    core: "█".split(""),
    solid: "██".split(""),
  },
  stars: {
    thin: "·⋆".split(""),
    normal: "✦✧✩✪".split(""),
    core: "✫✬✭★".split(""),
    solid: " ·⋆∗✦✧✩✪✫★".split(""),
  },
  arrows: {
    thin: "·∙".split(""),
    normal: "←↑→↓".split(""),
    core: "↖↗↘↙⤡⤢".split(""),
    solid: " ·∙↑↗→↘↓↙←↖".split(""),
  },
  braille: {
    thin: "⠁⠂⠄⠈".split(""),
    normal: "⠃⠅⠆⠉⠊⠋⠌⠍⠎⠏".split(""),
    core: "⠿⣿".split(""),
    solid: " ⠁⠃⠇⠧⠷⠿⡿⣿".split(""),
  },
  runes: {
    thin: ".·".split(""),
    normal: "ᚠᚡᚢᚣᚤᚦᚨᚱᚲᚳᚷᚹᛃᛇᛉ".split(""),
    core: "ᛞᛟᛡᛢᛣ".split(""),
    solid: " ·ᚠᚣᚤᚨᚱᚷᛞᛢ".split(""),
  },
  math: {
    thin: "∙∘".split(""),
    normal: "∑∏∫√∞≈≠≤≥⊂⊃⊆⊇".split(""),
    core: "∮∯∰∂".split(""),
    solid: " ∙∘∑∫√∞≈⊕⊗".split(""),
  },
  binary: {
    thin: "·.".split(""),
    normal: "01".split(""),
    core: "█".split(""),
    solid: " .:01██".split(""),
  },
  hex: {
    thin: "·∙".split(""),
    normal: "0123456789ABCDEF".split(""),
    core: "FFAA".split(""),
    solid: " 0123456789AF".split(""),
  },
} as const;

/** Wireframe glyph weights, matching RadiantHero's three-tier render.
 *  `thin` — spokes / inner shapes
 *  `normal` — main cage edges
 *  `core` — central sun / focal point
 */
export const WIREFRAME_GLYPHS = WIREFRAME_PALETTES.default as WireframeGlyphTiers;

/** Look up a named wireframe palette, falling back to `default`. */
export function getWireframeGlyphs(name: string): WireframeGlyphTiers {
  return WIREFRAME_PALETTES[name] ?? WIREFRAME_PALETTES.default!;
}
