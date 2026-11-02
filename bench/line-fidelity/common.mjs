// Shared paths, faces and small helpers for the line-fidelity bench.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "../..");
export const CACHE = path.join(HERE, ".cache");
fs.mkdirSync(CACHE, { recursive: true });

// Raster resolution: 16 CSS px font at devicePixelRatio 4 → a 64 device-px em.
// line-height: 1 (glyphcss's `.glyph-output` rule), so cell height = em.
export const CSS_FONT_PX = 16;
export const DPR = 4;
export const EM = CSS_FONT_PX * DPR;

// Mask canvas padding around the cell box, so ink that overflows the cell
// (box-drawing verticals reach past line-height 1) is kept, aligned to the
// cell origin. Whole device px.
export const PAD_X = 24;
export const PAD_Y = 40;

/**
 * The two faces glyphcss actually draws lines in on the site.
 * - atlas: `colorEncoding: "atlas"` — the Chromium default for scenes and
 *   /maps (`defaultGlyphColorEncoding` → atlas when COLR font-palette works).
 *   Every cell is a PUA code point in the GlyphCssAtlas COLR font
 *   (Menlo outlines + DejaVu fallbacks baked at Menlo's advance).
 * - mono: `"spans"` text in "Glyph Mono" (a Cascadia Code subset shipped in
 *   website/public/fonts) — /charts and /diagrams (encodeGlyphCanvasHtml) and
 *   the spans fallback everywhere else.
 */
export const FACES = {
  atlas: { family: "GlyphCssAtlas", label: "GlyphCssAtlas (atlas encoding)" },
  mono: { family: "Glyph Mono", label: "Glyph Mono (spans)" },
};

export function fontFaceCss() {
  const atlas = JSON.parse(fs.readFileSync(path.join(ROOT, "packages/glyphcss/assets/glyph-atlas/atlas-font.json"), "utf8")).woff2Base64;
  const mono = fs.readFileSync(path.join(ROOT, "website/public/fonts/glyph-mono.woff2")).toString("base64");
  return `@font-face{font-family:"GlyphCssAtlas";src:url(data:font/woff2;base64,${atlas}) format("woff2");font-display:block;}
@font-face{font-family:"Glyph Mono";src:url(data:font/woff2;base64,${mono}) format("woff2");font-display:block;}`;
}

export const atlasJson = () => JSON.parse(fs.readFileSync(path.join(ROOT, "packages/glyphcss/assets/glyph-atlas/atlas.json"), "utf8"));

/** Deterministic PRNG (mulberry32) — the wireframe tiers draw `Math.random()`. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function withSeededRandom(seed, fn) {
  const orig = Math.random;
  Math.random = mulberry32(seed);
  try { return fn(); } finally { Math.random = orig; }
}

export const cp = (g) => "U+" + g.codePointAt(0).toString(16).toUpperCase().padStart(4, "0");

export function writeJson(file, obj) { fs.writeFileSync(file, JSON.stringify(obj)); }
export function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
