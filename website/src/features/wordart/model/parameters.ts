import type { GlyphEffectId } from "@glyphcss/effects";
import { type ExtrudeProfile, type FontEntry, type WarpShape } from "@glyphcss/fonts";
import type { Polygon } from "@glyphcss/react";
import type { RenderMode } from "glyphcss";
import type { GalleryEffectBlend, GalleryEffectParamValue } from "../../gallery/model/types";

export type Align = "left" | "center" | "right";

export type FillType = "solid" | "gradient" | "rainbow" | "texture" | "image";

export type FaceFill = "solid" | "texture" | "none";

export type Bezier4 = [number, number, number, number];

/** Word-art has no "semantic" presentation (that's a gallery-only debug view
 *  over a dropped model's mesh), so this is the gallery's own render-mode set
 *  minus that one option — see `Dock/folders/useRenderingFolder.ts`'s
 *  `GalleryRenderPresentation` for the sibling with Semantic included. */
export type WordArtRenderMode = Exclude<RenderMode, "voxel">;

export type WordArtCharMode = "ascii" | "braille" | "halfblock" | "quadrant";

/** Hidden-line removal for the wireframe path (wireframe + charMode
 *  "braille"). No-op in solid (already depth-buffered) and ink (not wired). */
export type WordArtHiddenLines = "show" | "hide";

export const RENDER_MODE_OPTIONS: Record<string, WordArtRenderMode> = {
  Wireframe: "wireframe",
  Solid: "solid",
  Ink: "ink",
};

export const CHAR_MODE_OPTIONS: Record<string, WordArtCharMode> = {
  ASCII: "ascii",
  Braille: "braille",
  Halfblock: "halfblock",
  Quadrant: "quadrant",
};

export const HIDDEN_LINES_OPTIONS: Record<string, WordArtHiddenLines> = {
  Show: "show",
  Hide: "hide",
};

// Named CSS easings → cubic-bezier control points, for the custom edge profile.
const CSS_EASINGS: Record<string, Bezier4> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

/** Parse a CSS easing string (`cubic-bezier(...)` or a keyword) to 4 controls. */
export function parseBezier(input: string): Bezier4 | null {
  const s = input.trim().toLowerCase();
  if (CSS_EASINGS[s]) return CSS_EASINGS[s];
  const m = /cubic-bezier\(\s*([\d.+-]+)[ ,]+([\d.+-]+)[ ,]+([\d.+-]+)[ ,]+([\d.+-]+)\s*\)/.exec(s);
  if (!m) return null;
  const p = [m[1], m[2], m[3], m[4]].map(Number) as Bezier4;
  return p.every((n) => !Number.isNaN(n)) ? p : null;
}

export const bezierToCss = (b: Bezier4) => `cubic-bezier(${b.map((n) => +n.toFixed(2)).join(", ")})`;

// Bundled voxel-style block textures (Layoutit voxels set), served locally from
// public/textures/wordart so the atlas canvas stays same-origin (no CORS taint).
export const TEXTURES: { id: string; label: string }[] = [
  { id: "dirt", label: "Dirt" },
  { id: "dirt2", label: "Dirt 2" },
  { id: "grass3", label: "Grass" },
  { id: "brick", label: "Brick" },
  { id: "brick2", label: "Brick 2" },
  { id: "wood", label: "Wood" },
  { id: "wood3", label: "Plank" },
  { id: "rock", label: "Rock" },
  { id: "rock3", label: "Rock 2" },
  { id: "ice", label: "Ice" },
  { id: "ice3", label: "Ice 2" },
  { id: "glass", label: "Glass" },
  { id: "sand", label: "Sand" },
  { id: "cacti", label: "Cactus" },
  { id: "mine", label: "Ore" },
  { id: "mine4", label: "Ore 2" },
];

export const texUrl = (id: string) => (id ? `/textures/wordart/${id}.svg` : "");

// Default font — a real Google font (served open-CORS from the Fontsource
// CDN by `loadGoogleFont`), so both the live page AND the export work from
// any origin, including CodePen. Hardcoded rather than looked up from
// `listGoogleFonts()` so the default mesh can start composing immediately
// on mount instead of waiting on the catalog fetch; mirrors the shape
// `listGoogleFonts()` itself returns for this exact family.
export const ROBOTO_FONT_ENTRY: FontEntry = {
  id: "roboto",
  family: "Roboto",
  weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
  styles: ["normal", "italic"],
  subsets: ["cyrillic", "cyrillic-ext", "greek", "greek-ext", "latin", "latin-ext", "math", "symbols", "vietnamese"],
  defSubset: "latin",
  category: "sans-serif",
  type: "google",
};

export interface Preset {
  label: string;
  profile: ExtrudeProfile;
  depth: number;
  color: string;
  sideColor: string;
  /** Back-face color (layered look when different + offset > 0). */
  backColor?: string;
  /** Diagonal back offset for the layered block (down-right). */
  offset?: number;
  warp?: { shape: WarpShape; amount: number };
  /** Face fill (defaults to solid `color`). */
  fill?: FillType;
  gradA?: string;
  gradB?: string;
  gradAngle?: number;
  /** Block-texture ids for the front / sides / back faces. */
  faceTex?: string;
  sideTex?: string;
  backTex?: string;
  outline?: { color: string; width: number };
  /** Flat two-layer drop shadow (no extrusion walls). */
  layered?: boolean;
  /** Stage zoom, paired with `density`: density alone changes cell size, so an
      effect preset that raises it also needs its framing back. */
  zoom?: number;
  /** Scene glyph density. Effect presets need real cell resolution to read —
      matrix rain at the default density 1 is ~440 cells of confetti; at 3.4 it
      is ~4900 and the word reads as letterforms filled with falling code. */
  density?: number;
  /** Render mode this preset wants. Optional: absent means "don't touch the
   *  current render mode" — `applyPreset` never resets a style-only preset's
   *  target back to whatever mode the user happened to be in. */
  mode?: WordArtRenderMode;
  /** Character encoding this preset wants (braille is wireframe-only,
   *  halfblock is solid-only — see AGENTS.md). Same absent-means-untouched rule as `mode`. */
  charMode?: WordArtCharMode;
  /** Hidden-line removal this preset wants (wireframe/ink only). Same absent-means-untouched rule as `mode`. */
  hiddenLines?: WordArtHiddenLines;
  /** A stock `@glyphcss/effects` layer to mount with this preset. `params` are
   *  merged over the effect's own schema defaults (not the current live
   *  effect's params). Unlike `mode`/`charMode`/`hiddenLines`, absent means
   *  "this look has no effect" — applying ANY preset without one CLEARS the
   *  active effect layer (see `applyPreset`). An effect is part of the whole
   *  look, not a standalone viewing choice that should survive preset changes. */
  effect?: { id: GlyphEffectId; blend?: GalleryEffectBlend; params?: Partial<Record<string, GalleryEffectParamValue>> };
}

// Bottom preset row — each is a full "look": extrusion, layered front/back,
// and/or a baked-in WordArt warp (like the builder's shape tiles).
export const PRESETS: Preset[] = [
  {
    label: "Gold Gradient",
    profile: "bevel",
    depth: 26,
    color: "#ffd23f",
    sideColor: "#7c4a12",
    fill: "gradient",
    gradA: "#ffe14d",
    gradB: "#ff7a1a",
    gradAngle: 270,
  },
  {
    label: "Grape Pop",
    profile: "flat",
    depth: 5,
    color: "#b14be0",
    sideColor: "#7a8cff",
    backColor: "#8aa0ff",
    offset: 14,
    layered: true,
    fill: "gradient",
    gradA: "#c45cf0",
    gradB: "#7a1fb8",
    gradAngle: 270,
  },
  {
    label: "Chrome",
    profile: "bevel",
    depth: 22,
    color: "#d7dde4",
    sideColor: "#3a2222",
    fill: "gradient",
    gradA: "#f4f8ff",
    gradB: "#9a4b4b",
    gradAngle: 270,
  },
  {
    label: "Rainbow",
    profile: "flat",
    depth: 10,
    color: "#ff5e3a",
    sideColor: "#7a2a55",
    fill: "rainbow",
    gradAngle: 0,
  },
  {
    label: "Sky Outline",
    profile: "flat",
    depth: 8,
    color: "#7ec8ff",
    sideColor: "#2b50b0",
    outline: { color: "#1838b8", width: 3 },
  },
  {
    label: "Grass Block",
    profile: "flat",
    depth: 18,
    color: "#6ab04c",
    sideColor: "#6b4a2b",
    fill: "texture",
    faceTex: "grass3",
    sideTex: "dirt",
  },
  {
    label: "Brick Wall",
    profile: "bevel",
    depth: 22,
    color: "#a8432a",
    sideColor: "#7a2f1d",
    fill: "texture",
    faceTex: "brick",
    sideTex: "brick2",
  },
  {
    label: "Stone",
    profile: "flat",
    depth: 20,
    color: "#8d8d8d",
    sideColor: "#5a5a5a",
    fill: "texture",
    faceTex: "rock",
    sideTex: "rock3",
  },
  {
    label: "Ice",
    profile: "bevel",
    depth: 18,
    color: "#b9e6ff",
    sideColor: "#6aa9cc",
    fill: "texture",
    faceTex: "ice",
    sideTex: "ice3",
  },
  { label: "Gold Bevel", profile: "bevel", depth: 26, color: "#d4a82a", sideColor: "#7c5e16" },
  {
    label: "Retro Block",
    profile: "flat",
    depth: 6,
    color: "#ff4d6d",
    sideColor: "#3a0ca3",
    backColor: "#3a0ca3",
    offset: 16,
    layered: true,
  },
  {
    label: "Arch Gold",
    profile: "bevel",
    depth: 22,
    color: "#e9b949",
    sideColor: "#8a5a12",
    warp: { shape: "arch", amount: 0.6 },
  },
  {
    label: "Wave Mint",
    profile: "round",
    depth: 24,
    color: "#7cffb2",
    sideColor: "#2f8f5e",
    warp: { shape: "wave", amount: 0.55 },
  },
  {
    label: "Ink Shadow",
    profile: "flat",
    depth: 4,
    color: "#e8edf2",
    sideColor: "#2b313b",
    backColor: "#2b313b",
    offset: 12,
    layered: true,
  },
  {
    label: "Sand Dune",
    profile: "round",
    depth: 16,
    color: "#e3c17a",
    sideColor: "#b8935a",
    fill: "texture",
    faceTex: "sand",
    sideTex: "dirt2",
    warp: { shape: "wave", amount: 0.4 },
  },
  {
    label: "Timber",
    profile: "bevel",
    depth: 20,
    color: "#a9713f",
    sideColor: "#5c3a1e",
    fill: "texture",
    faceTex: "wood",
    sideTex: "wood3",
  },
  {
    label: "Ore Vein",
    profile: "flat",
    depth: 18,
    color: "#c9a227",
    sideColor: "#3a3a3a",
    fill: "texture",
    faceTex: "mine",
    sideTex: "rock3",
  },
  {
    label: "Glass Frost",
    profile: "bevel",
    depth: 16,
    color: "#dff3ff",
    sideColor: "#7fb8d9",
    fill: "texture",
    faceTex: "glass",
    sideTex: "ice3",
  },
  {
    label: "Neon Outline",
    profile: "flat",
    depth: 6,
    color: "#0b0f1a",
    sideColor: "#0b0f1a",
    outline: { color: "#ff2fd0", width: 5 },
  },
  {
    label: "Copper Shine",
    profile: "bevel",
    depth: 24,
    color: "#e0813a",
    sideColor: "#6b2f12",
    fill: "gradient",
    gradA: "#ffcf8a",
    gradB: "#a34a12",
    gradAngle: 200,
  },
  // ── Render-mode showcase presets ──────────────────────────────────────
  // These four exercise render modes/char modes/effects the other 20 never
  // touch. Each sets `mode`/`charMode`/`hiddenLines`/`effect` explicitly so
  // clicking the tile shows the feature, not whatever mode the user was
  // already in — see `applyPreset`'s absent-means-untouched contract above.
  {
    label: "Ink Silhouette",
    profile: "bevel",
    depth: 24,
    color: "#39ff14",
    sideColor: "#0f4d0f",
    mode: "ink",
    hiddenLines: "hide",
  },
  {
    label: "Braille Wire",
    profile: "bevel",
    depth: 34,
    color: "#7ec8ff",
    sideColor: "#1838b8",
    mode: "wireframe",
    charMode: "braille",
    hiddenLines: "hide",
  },
  // Tuned by looking at it: the first pass used a near-black base under a
  // `replace` blend at density 0.6, which left the letterform unreadable —
  // ~111 inked cells of scattered confetti. A readable green base under an
  // `over` blend at density 0.99 gives ~4900 cells and the word actually reads
  // as letterforms filled with falling code.
  {
    label: "Matrix Fall",
    profile: "flat",
    depth: 20,
    color: "#1d6b3a",
    sideColor: "#0f3a20",
    backColor: "#0f3a20",
    mode: "solid",
    density: 2.5,
    hiddenLines: "hide",
    effect: {
      id: "matrix-rain",
      blend: "over",
      timeScale: 2.5,
      params: {
        glyphs: "GLYPH01",
        direction: "down",
        space: "object",
        scale: 1.01,
        speedMin: 5.25,
        speedMax: 25.25,
        trail: 45,
        density: 0.88,
        seed: 306,
        colorMode: "monochrome",
        color: "#00d149",
        headColor: "#baffd6",
      },
    },
  },
  {
    label: "Scan Pulse",
    profile: "bevel",
    depth: 20,
    color: "#161b22",
    sideColor: "#0b0f1a",
    mode: "ink",
    hiddenLines: "hide",
    effect: {
      id: "scan",
      blend: "over",
      params: {
        direction: "down",
        space: "auto",
        scale: 1,
        speed: 12,
        width: 4,
        spacing: 30,
        color: "#5ad1ff",
      },
    },
  },
];

export function applyCase(text: string, mode: "as-typed" | "upper" | "lower" | "title"): string {
  if (mode === "upper") return text.toUpperCase();
  if (mode === "lower") return text.toLowerCase();
  if (mode === "title") return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return text;
}

// The Density slider's baseline cell size (px) at density=1 — the same value
// the stage otherwise inherits by default from the page's base font-size, so
// density=1 reproduces the pre-Density-slider look. `<pre class="glyph-output">`
// has no font-size of its own (see the base stylesheet `injectGlyphBaseStyles`
// ships), so it cascades from whatever this Stage host sets explicitly.
export const BASE_FONT_PX = 16;

export function fitWordArtZoom(polygons: Polygon[], stageW: number, stageH: number, scaleX = 1, scaleY = 1): number {
  if (!polygons.length) return 3;
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const p of polygons) {
    for (const v of p.vertices) {
      if (v[0] < minX) minX = v[0];
      if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1];
      if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2];
      if (v[2] > maxZ) maxZ = v[2];
    }
  }
  const horizontal = Math.max((maxY - minY) * scaleX, maxX - minX);
  const vertical = (maxZ - minZ) * scaleY;
  const fitW = (stageW * 0.7) / Math.max(horizontal, 1);
  const fitH = (stageH * 0.68) / Math.max(vertical, 1);
  return Math.max(0.5, Math.min(10, Math.min(fitW, fitH)));
}

export interface GuiValues {
  layered: boolean;
  profileMode: string;
  warp: string;
  bend: number;
  depth: number;
  scaleX: number;
  scaleY: number;
  curveSegments: number;
  simplify: number;
  profileSegments: number;
  offset: number;
  density: number;
  renderMode: WordArtRenderMode;
  charMode: WordArtCharMode;
  hiddenLines: WordArtHiddenLines;
  colorEncoding: "spans" | "atlas";
  perspective: boolean;
  zoom: number;
  spin: boolean;
  light: number;
  ambient: number;
  az: number;
  el: number;
  lightColor: string;
}

export interface LeftValues {
  weight: number;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  textCase: string;
  align: string;
  letterSpacing: number;
  lineHeight: number;
  color: string;
  sideColor: string;
  backColor: string;
  fillType: string;
  gradA: string;
  gradB: string;
  gradAngle: number;
  image: string;
  faceTex: string;
  sideFill: string;
  sideTex: string;
  backFill: string;
  backTex: string;
  outlineOn: boolean;
  outlineColor: string;
  outlineWidth: number;
}
