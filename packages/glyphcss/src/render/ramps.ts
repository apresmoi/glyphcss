import type { CharRamp } from "@layoutit/polycss-core";

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

/** Named glyph palettes — each defines wireframe tiers AND a solid ramp. */
export const WIREFRAME_PALETTES: Record<string, WireframeGlyphTiers> = {
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
