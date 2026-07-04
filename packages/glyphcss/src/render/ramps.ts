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
