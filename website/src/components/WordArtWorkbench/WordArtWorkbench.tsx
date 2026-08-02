import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  GlyphEffectLayer,
  GlyphMesh,
  GlyphOrthographicCamera,
  GlyphPerspectiveCamera,
  GlyphScene,
  useGlyphSceneContext,
} from "@glyphcss/react";
import type { Vec3 } from "@glyphcss/react";
import type { Polygon } from "@glyphcss/react";
import type { GlyphEffectLayerHandle } from "@glyphcss/react";
import {
  compileScene,
  createGlyphOrthographicCamera,
  encodeStaticGlyphHtml,
  injectGlyphBaseStyles,
} from "glyphcss";
import type { CompileSceneResult, GlyphEffectDefinition, GlyphEffectParamSchema, RenderMode } from "glyphcss";
import type { GlyphEffectId } from "@glyphcss/effects";
import type { GUI } from "lil-gui";
import { StatsOverlay } from "../StatsOverlay";
import {
  composeText,
  listGoogleFonts,
  loadGoogleFont,
  resolveFace,
  pickWeight,
  type BackFace,
  type ExtrudeProfile,
  type Face,
  type FaceFillSpec,
  type FontEntry,
  type ParsedFont,
  type Profile,
  type WarpShape,
} from "@glyphcss/fonts";
import { Dock } from "../Dock";
import { useDockGui } from "../Dock/slots";
import { useColor, useDockSlot, useFolder, useOption, useSlider, useText, useToggle } from "../Dock/primitives";
import { EffectParameterControls, useEffectsFolder } from "../Dock/folders/useEffectsFolder";
import {
  DEFAULT_GALLERY_EFFECT_STATE,
  GALLERY_EFFECT_OPTIONS,
  createGalleryEffectState,
  galleryEffectDefaultParams,
  galleryEffectDefinition,
  galleryEffectExportName,
  sanitizeGalleryEffectParams,
  type GalleryEffectDefinition,
} from "../GalleryWorkbench/effects";
import type { GalleryEffectBlend, GalleryEffectParamValue, GalleryEffectState } from "../GalleryWorkbench/types";
import { WordArtCodePanel } from "./WordArtCodePanel";
import { buildWordArtCodepenPen } from "./wordartSnippets";
import type {
  WordArtComposeInput,
  WordArtFaceSpec,
  WordArtFontSpec,
  WordArtProfileSpec,
  WordArtSnippetInput,
} from "./wordartSnippets";
import "../GalleryWorkbench/gallery-workbench.css";
import "./wordart.css";

type Align = "left" | "center" | "right";
type FillType = "solid" | "gradient" | "rainbow" | "texture" | "image";
type FaceFill = "solid" | "texture" | "none";
type Bezier4 = [number, number, number, number];
/** Word-art has no "semantic" presentation (that's a gallery-only debug view
 *  over a dropped model's mesh), so this is the gallery's own render-mode set
 *  minus that one option — see `Dock/folders/useRenderingFolder.ts`'s
 *  `GalleryRenderPresentation` for the sibling with Semantic included. */
type WordArtRenderMode = Exclude<RenderMode, "voxel">;
type WordArtCharMode = "ascii" | "braille" | "halfblock";
/** Hidden-line removal for the wireframe path (wireframe + charMode
 *  "braille"). No-op in solid (already depth-buffered) and ink (not wired). */
type WordArtHiddenLines = "show" | "hide";
const RENDER_MODE_OPTIONS: Record<string, WordArtRenderMode> = {
  Wireframe: "wireframe",
  Solid: "solid",
  Ink: "ink",
};
const CHAR_MODE_OPTIONS: Record<string, WordArtCharMode> = {
  ASCII: "ascii",
  Braille: "braille",
  Halfblock: "halfblock",
};
const HIDDEN_LINES_OPTIONS: Record<string, WordArtHiddenLines> = {
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
function parseBezier(input: string): Bezier4 | null {
  const s = input.trim().toLowerCase();
  if (CSS_EASINGS[s]) return CSS_EASINGS[s];
  const m = /cubic-bezier\(\s*([\d.+-]+)[ ,]+([\d.+-]+)[ ,]+([\d.+-]+)[ ,]+([\d.+-]+)\s*\)/.exec(s);
  if (!m) return null;
  const p = [m[1], m[2], m[3], m[4]].map(Number) as Bezier4;
  return p.every((n) => !Number.isNaN(n)) ? p : null;
}
const bezierToCss = (b: Bezier4) => `cubic-bezier(${b.map((n) => +n.toFixed(2)).join(", ")})`;

// Bundled voxel-style block textures (Layoutit voxels set), served locally from
// public/textures/wordart so the atlas canvas stays same-origin (no CORS taint).
const TEXTURES: { id: string; label: string }[] = [
  { id: "dirt", label: "Dirt" }, { id: "dirt2", label: "Dirt 2" }, { id: "grass3", label: "Grass" },
  { id: "brick", label: "Brick" }, { id: "brick2", label: "Brick 2" }, { id: "wood", label: "Wood" },
  { id: "wood3", label: "Plank" }, { id: "rock", label: "Rock" }, { id: "rock3", label: "Rock 2" },
  { id: "ice", label: "Ice" }, { id: "ice3", label: "Ice 2" }, { id: "glass", label: "Glass" },
  { id: "sand", label: "Sand" }, { id: "cacti", label: "Cactus" }, { id: "mine", label: "Ore" }, { id: "mine4", label: "Ore 2" },
];
const texUrl = (id: string) => (id ? `/textures/wordart/${id}.svg` : "");

// Default font — a real Google font (served open-CORS from the Fontsource
// CDN by `loadGoogleFont`), so both the live page AND the export work from
// any origin, including CodePen. Hardcoded rather than looked up from
// `listGoogleFonts()` so the default mesh can start composing immediately
// on mount instead of waiting on the catalog fetch; mirrors the shape
// `listGoogleFonts()` itself returns for this exact family.
const ROBOTO_FONT_ENTRY: FontEntry = {
  id: "roboto",
  family: "Roboto",
  weights: [100, 200, 300, 400, 500, 600, 700, 800, 900],
  styles: ["normal", "italic"],
  subsets: ["cyrillic", "cyrillic-ext", "greek", "greek-ext", "latin", "latin-ext", "math", "symbols", "vietnamese"],
  defSubset: "latin",
  category: "sans-serif",
  type: "google",
};

interface Preset {
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
}

// Bottom preset row — each is a full "look": extrusion, layered front/back,
// and/or a baked-in WordArt warp (like the builder's shape tiles).
const PRESETS: Preset[] = [
  { label: "Gold Gradient", profile: "bevel", depth: 26, color: "#ffd23f", sideColor: "#7c4a12",
    fill: "gradient", gradA: "#ffe14d", gradB: "#ff7a1a", gradAngle: 270 },
  { label: "Grape Pop", profile: "flat", depth: 5, color: "#b14be0", sideColor: "#7a8cff", backColor: "#8aa0ff", offset: 14, layered: true,
    fill: "gradient", gradA: "#c45cf0", gradB: "#7a1fb8", gradAngle: 270 },
  { label: "Chrome", profile: "bevel", depth: 22, color: "#d7dde4", sideColor: "#3a2222",
    fill: "gradient", gradA: "#f4f8ff", gradB: "#9a4b4b", gradAngle: 270 },
  { label: "Rainbow", profile: "flat", depth: 10, color: "#ff5e3a", sideColor: "#7a2a55",
    fill: "rainbow", gradAngle: 0 },
  { label: "Sky Outline", profile: "flat", depth: 8, color: "#7ec8ff", sideColor: "#2b50b0",
    outline: { color: "#1838b8", width: 3 } },
  { label: "Grass Block", profile: "flat", depth: 18, color: "#6ab04c", sideColor: "#6b4a2b",
    fill: "texture", faceTex: "grass3", sideTex: "dirt" },
  { label: "Brick Wall", profile: "bevel", depth: 22, color: "#a8432a", sideColor: "#7a2f1d",
    fill: "texture", faceTex: "brick", sideTex: "brick2" },
  { label: "Stone", profile: "flat", depth: 20, color: "#8d8d8d", sideColor: "#5a5a5a",
    fill: "texture", faceTex: "rock", sideTex: "rock3" },
  { label: "Ice", profile: "bevel", depth: 18, color: "#b9e6ff", sideColor: "#6aa9cc",
    fill: "texture", faceTex: "ice", sideTex: "ice3" },
  { label: "Gold Bevel", profile: "bevel", depth: 26, color: "#d4a82a", sideColor: "#7c5e16" },
  { label: "Retro Block", profile: "flat", depth: 6, color: "#ff4d6d", sideColor: "#3a0ca3", backColor: "#3a0ca3", offset: 16, layered: true },
  { label: "Arch Gold", profile: "bevel", depth: 22, color: "#e9b949", sideColor: "#8a5a12", warp: { shape: "arch", amount: 0.6 } },
  { label: "Wave Mint", profile: "round", depth: 24, color: "#7cffb2", sideColor: "#2f8f5e", warp: { shape: "wave", amount: 0.55 } },
  { label: "Ink Shadow", profile: "flat", depth: 4, color: "#e8edf2", sideColor: "#2b313b", backColor: "#2b313b", offset: 12, layered: true },
  { label: "Sand Dune", profile: "round", depth: 16, color: "#e3c17a", sideColor: "#b8935a",
    fill: "texture", faceTex: "sand", sideTex: "dirt2", warp: { shape: "wave", amount: 0.4 } },
  { label: "Timber", profile: "bevel", depth: 20, color: "#a9713f", sideColor: "#5c3a1e",
    fill: "texture", faceTex: "wood", sideTex: "wood3" },
  { label: "Ore Vein", profile: "flat", depth: 18, color: "#c9a227", sideColor: "#3a3a3a",
    fill: "texture", faceTex: "mine", sideTex: "rock3" },
  { label: "Glass Frost", profile: "bevel", depth: 16, color: "#dff3ff", sideColor: "#7fb8d9",
    fill: "texture", faceTex: "glass", sideTex: "ice3" },
  { label: "Neon Outline", profile: "flat", depth: 6, color: "#0b0f1a", sideColor: "#0b0f1a",
    outline: { color: "#ff2fd0", width: 5 } },
  { label: "Copper Shine", profile: "bevel", depth: 24, color: "#e0813a", sideColor: "#6b2f12",
    fill: "gradient", gradA: "#ffcf8a", gradB: "#a34a12", gradAngle: 200 },
];

function applyCase(text: string, mode: "as-typed" | "upper" | "lower" | "title"): string {
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
const BASE_FONT_PX = 16;

function fitWordArtZoom(polygons: Polygon[], stageW: number, stageH: number, scaleX = 1, scaleY = 1): number {
  if (!polygons.length) return 3;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of polygons) {
    for (const v of p.vertices) {
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }
  }
  const horizontal = Math.max((maxY - minY) * scaleX, maxZ - minZ);
  const vertical = (maxX - minX) * scaleY;
  const fitW = (stageW * 0.7) / Math.max(horizontal, 1);
  const fitH = (stageH * 0.68) / Math.max(vertical, 1);
  return Math.max(0.5, Math.min(10, Math.min(fitW, fitH)));
}

// All controls persist to the URL query string so any look is a shareable link.
const URL_SEARCH = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
const qs = (k: string, d: string) => URL_SEARCH.get(k) ?? d;
const qn = (k: string, d: number) => (URL_SEARCH.has(k) ? Number(URL_SEARCH.get(k)) : d);
const qb = (k: string, d: boolean) => (URL_SEARCH.has(k) ? URL_SEARCH.get(k) === "1" : d);

/** Restore the Effects folder's selection from the URL (mirrors the gallery's
 *  `fx`/`fxb`/`fxp`/`fxs`/`fxx` shape, but folded into this page's single
 *  flat-URLSearchParams persistence pass instead of a second read-modify-write
 *  — see the big `useEffect` below, which is the only writer). */
function initialEffectState(): GalleryEffectState {
  const id = qs("fx", "");
  if (!id) return DEFAULT_GALLERY_EFFECT_STATE;
  const definition = galleryEffectDefinition(id as GlyphEffectId);
  if (!definition) return DEFAULT_GALLERY_EFFECT_STATE;
  const state = createGalleryEffectState(definition.id, {
    blend: qs("fxb", definition.defaultBlend) as GalleryEffectBlend,
    paused: qb("fxp", false),
    timeScale: qn("fxs", 1),
  });
  if (!state) return DEFAULT_GALLERY_EFFECT_STATE;
  const rawParams = qs("fxx", "");
  if (rawParams) {
    try {
      state.params = sanitizeGalleryEffectParams(definition, JSON.parse(rawParams));
    } catch {
      // Malformed/legacy `fxx` payload — keep the definition's defaults.
    }
  }
  return state;
}

export function WordArtWorkbench() {
  const [font, setFont] = useState<ParsedFont | null>(null);
  // Pinned to whichever font loads FIRST (never swapped to a later-picked
  // Google font) so the preset tiles' single-letter static renders stay
  // stable — they only need to change look, not typeface, when a preset
  // changes colors/profile.
  const [previewFont, setPreviewFont] = useState<ParsedFont | null>(null);
  const [catalog, setCatalog] = useState<FontEntry[]>([]);
  // Always a real Google font — defaults to Roboto so both the live page and
  // the export work from any origin (CodePen included). Never reset to null.
  const [entry, setEntry] = useState<FontEntry>(ROBOTO_FONT_ENTRY);
  const [familyInput, setFamilyInput] = useState(() => qs("font", "Roboto"));
  const [weight, setWeight] = useState(() => qn("weight", 700));
  const [italic, setItalic] = useState(() => qb("italic", false));
  const [status, setStatus] = useState("");

  const [text, setText] = useState(() => qs("text", "Glyph\nCSS"));
  const [textCase, setTextCase] = useState<"as-typed" | "upper" | "lower" | "title">(() => qs("case", "as-typed") as "as-typed");
  const [scaleX, setScaleX] = useState(() => qn("sx", 100));
  const [scaleY, setScaleY] = useState(() => qn("sy", 100));
  const [profile, setProfile] = useState<ExtrudeProfile>(() => qs("profile", "bevel") as ExtrudeProfile);
  const [roundConvex, setRoundConvex] = useState(() => qb("rconv", false));
  const [bezier, setBezier] = useState<Bezier4>(() => {
    const p = qs("bez", "").split(",").map(Number);
    return p.length === 4 && p.every((n) => !Number.isNaN(n)) ? (p as Bezier4) : [0.3, 0.9, 0.7, 0.1];
  });
  const [depth, setDepth] = useState(() => qn("depth", 26));
  const [letterSpacing, setLetterSpacing] = useState(() => qn("ls", 0));
  const [lineHeight, setLineHeight] = useState(() => qn("lh", 1.15));
  const [align, setAlign] = useState<Align>(() => qs("align", "center") as Align);
  const [underline, setUnderline] = useState(() => qb("ul", false));
  const [strike, setStrike] = useState(() => qb("st", false));
  const [color, setColor] = useState(() => qs("color", "#d4a82a"));
  const [sideColor, setSideColor] = useState(() => qs("side", "#7c5e16"));
  const [backColor, setBackColor] = useState(() => qs("back", "#7c5e16"));
  const [offset, setOffset] = useState(() => qn("offset", 0));
  const [curveSegments, setCurveSegments] = useState(() => qn("curve", 4));
  const [simplify, setSimplify] = useState(() => qn("simplify", 2));
  const [profileSegments, setProfileSegments] = useState(() => qn("edge", 3));
  const [warpShape, setWarpShape] = useState<WarpShape>(() => qs("warp", "none") as WarpShape);
  const [warpAmount, setWarpAmount] = useState(() => qn("bend", 0.5));
  const [spin, setSpin] = useState(() => qb("spin", true));
  // Face fill (solid / gradient / rainbow / image), outline, flat-layer shadow.
  const [fillType, setFillType] = useState<FillType>(() => qs("fill", "solid") as FillType);
  const [gradA, setGradA] = useState(() => qs("ga", "#ffd23f"));
  const [gradB, setGradB] = useState(() => qs("gb", "#ff5e3a"));
  const [gradAngle, setGradAngle] = useState(() => qn("gang", 270));
  const [fillImage, setFillImage] = useState("");
  const [faceTex, setFaceTex] = useState(() => qs("ftex", "dirt"));
  const [sideFill, setSideFill] = useState<FaceFill>(() => qs("sfill", "solid") as FaceFill);
  const [sideTex, setSideTex] = useState(() => qs("stex", "dirt"));
  const [backFill, setBackFill] = useState<FaceFill>(() => qs("bfill", "solid") as FaceFill);
  const [backTex, setBackTex] = useState(() => qs("btex", "dirt"));
  const [outlineOn, setOutlineOn] = useState(() => qb("ol", false));
  const [outlineColor, setOutlineColor] = useState(() => qs("olc", "#1a1a2e"));
  const [outlineWidth, setOutlineWidth] = useState(() => qn("olw", 3));
  const [layered, setLayered] = useState(() => qb("layer", false));
  // Camera + lighting (gallery-style)
  const [perspective, setPerspective] = useState(() => qb("persp", true));
  const [zoomScale, setZoomScale] = useState(() => qn("zoom", 1));
  // Viewing angle lives here, not in <Stage>, so the URL effect below can see
  // it. Dragging rotates the MESH (see <Stage>) — the camera stays pinned.
  const [turn, setTurn] = useState(() => qn("turn", 0));
  const [tilt, setTilt] = useState(() => qn("tilt", 14));
  // Scene-wide ASCII resolution (mirrors /synth's Density): drives the
  // GlyphScene host's font-size (BASE_FONT_PX ÷ density) — smaller cell = more
  // columns/rows in the same on-screen box (zoom is CSS px/world-unit,
  // independent of font size — see `fitWordArtZoom`). Same technique
  // `SynthWorkbench`'s `host.style.fontSize` uses, just via the React
  // `<GlyphScene style>` prop instead of an imperative host ref (glyphcss/react
  // has no scene-wide `fontSize` option — only the per-mesh detail-layer one).
  const [density, setDensity] = useState(() => qn("density", 1));
  const [renderMode, setRenderMode] = useState<WordArtRenderMode>(() => qs("mode", "solid") as WordArtRenderMode);
  const [charMode, setCharMode] = useState<WordArtCharMode>(() => qs("charmode", "ascii") as WordArtCharMode);
  const [hiddenLines, setHiddenLines] = useState<WordArtHiddenLines>(() => qs("hl", "show") as WordArtHiddenLines);
  const [lightIntensity, setLightIntensity] = useState(() => qn("li", 0.95));
  const [ambient, setAmbient] = useState(() => qn("amb", 0.5));
  const [lightColor, setLightColor] = useState(() => qs("lc", "#ffffff"));
  const [lightAz, setLightAz] = useState(() => qn("laz", -25));
  const [lightEl, setLightEl] = useState(() => qn("lel", 45));
  // Glyph Effects layer (gallery-style): same state shape, same
  // `scene.addEffectLayer`-backed `<GlyphEffectLayer>` wiring, just applied to
  // the word-art mesh instead of a dropped model.
  const [effectState, setEffectState] = useState<GalleryEffectState>(initialEffectState);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  // Mobile: only one floating panel is open at a time, toggled by the bottom tabs
  // (mirrors /synth's voices/controls/presets drawer pattern).
  const [mobilePanel, setMobilePanel] = useState<"compose" | "controls" | "presets" | "export" | null>(null);

  // ── Export (gallery/synth-style) ─────────────────────────────────────────
  // Bottom-left, always-visible "Open in CodePen" (static, zero-runtime bake
  // of the live rendered `<pre>`) + an "Export" toggle that mounts a
  // gallery-look code window (`WordArtCodePanel`) with framework tabs of
  // lib-based code that REGENERATES the mesh via `@glyphcss/fonts`'
  // `composeText` (camera + lighting + effect reconstruction mirrors the
  // gallery/synth). Mirrors `SynthWorkbench`'s own
  // `codeOpen`/`exporting`/`cameraSnapshot` trio.
  const [codeOpen, setCodeOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const stageSnapshotRef = useRef<{ rotation: Vec3; zoom: number }>({ rotation: [0, 14, 0], zoom: 3 });
  const [stageSnapshot, setStageSnapshot] = useState<{ rotation: Vec3; zoom: number }>({ rotation: [0, 14, 0], zoom: 3 });

  useEffect(() => {
    if (!mobilePanel) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobilePanel(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobilePanel]);

  // `.glyph-output` (the compiled preset tiles below use it directly, with no
  // `<glyph-scene>` ancestor) needs the base stylesheet present — the live
  // Stage's GlyphScene injects it too, but do it here explicitly so the tiles
  // don't depend on mount order.
  useEffect(() => { injectGlyphBaseStyles(); }, []);

  // Google font catalog (Roboto — `entry`'s initial state — is already
  // loading via the effect below). If the URL named a different font, select
  // it once the catalog is in.
  useEffect(() => {
    listGoogleFonts()
      .then((c) => {
        setCatalog(c);
        const wanted = qs("font", "").trim().toLowerCase();
        if (wanted) {
          const f = c.find((e) => e.family.toLowerCase() === wanted);
          if (f) setEntry(f);
        }
      })
      .catch(() => {});
  }, []);

  // Persist every control to the URL (non-defaults only, for short links).
  useEffect(() => {
    const p = new URLSearchParams();
    const ss = (k: string, v: string, d: string) => { if (v !== d) p.set(k, v); };
    const sn = (k: string, v: number, d: number) => { if (v !== d) p.set(k, String(v)); };
    p.set("text", text);
    ss("font", entry.family, "Roboto");
    sn("weight", weight, 700);
    if (italic) p.set("italic", "1");
    ss("case", textCase, "as-typed");
    sn("sx", scaleX, 100);
    sn("sy", scaleY, 100);
    ss("profile", profile, "bevel");
    if (roundConvex) p.set("rconv", "1");
    if (profile === "custom") p.set("bez", bezier.map((n) => +n.toFixed(3)).join(","));
    sn("depth", depth, 26);
    sn("ls", letterSpacing, 0);
    sn("lh", lineHeight, 1.15);
    ss("align", align, "center");
    if (underline) p.set("ul", "1");
    if (strike) p.set("st", "1");
    ss("color", color, "#d4a82a");
    ss("side", sideColor, "#7c5e16");
    ss("back", backColor, "#7c5e16");
    sn("offset", offset, 0);
    sn("curve", curveSegments, 1);
    sn("simplify", simplify, 2);
    sn("edge", profileSegments, 3);
    ss("warp", warpShape, "none");
    sn("bend", warpAmount, 0.5);
    if (!spin) p.set("spin", "0");
    if (!perspective) p.set("persp", "0");
    sn("zoom", zoomScale, 1);
    // Round to 0.1deg: a drag emits hundreds of updates and 15-digit floats
    // would bloat every shared link. `turn` is skipped while `spin` animates,
    // or the turntable would rewrite the URL on every frame.
    if (!spin) sn("turn", Math.round(turn * 10) / 10, 0);
    sn("tilt", Math.round(tilt * 10) / 10, 14);
    sn("density", density, 1);
    ss("mode", renderMode, "solid");
    ss("charmode", charMode, "ascii");
    ss("hl", hiddenLines, "show");
    sn("li", lightIntensity, 0.95);
    sn("amb", ambient, 0.5);
    ss("lc", lightColor, "#ffffff");
    sn("laz", lightAz, -25);
    sn("lel", lightEl, 45);
    ss("fill", fillType, "solid");
    ss("ga", gradA, "#ffd23f");
    ss("gb", gradB, "#ff5e3a");
    sn("gang", gradAngle, 270);
    ss("ftex", faceTex, "dirt");
    ss("sfill", sideFill, "solid");
    ss("stex", sideTex, "dirt");
    ss("bfill", backFill, "solid");
    ss("btex", backTex, "dirt");
    if (outlineOn) p.set("ol", "1");
    ss("olc", outlineColor, "#1a1a2e");
    sn("olw", outlineWidth, 3);
    if (layered) p.set("layer", "1");
    // Effects folder — folded into this same flat-URLSearchParams pass (rather
    // than a second read-modify-write like the gallery's `useEffectRouteSync`)
    // so it can't race the rest of this page's controls for the last write.
    if (effectState.effectId) {
      p.set("fx", effectState.effectId);
      const definition = galleryEffectDefinition(effectState.effectId);
      if (definition) {
        ss("fxb", effectState.blend, definition.defaultBlend);
        if (effectState.paused) p.set("fxp", "1");
        sn("fxs", effectState.timeScale, 1);
        const defaults = galleryEffectDefaultParams(definition);
        const overrides: Record<string, GalleryEffectParamValue> = {};
        for (const [name, value] of Object.entries(effectState.params)) {
          if (name === "time" || value === defaults[name]) continue;
          overrides[name] = value;
        }
        if (Object.keys(overrides).length > 0) p.set("fxx", JSON.stringify(overrides));
      }
    }
    const search = p.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
  }, [text, entry, weight, italic, textCase, scaleX, scaleY, profile, depth, letterSpacing, lineHeight, align, underline, strike, color, sideColor, backColor, offset, curveSegments, simplify, profileSegments, warpShape, warpAmount, spin, perspective, zoomScale, turn, tilt, density, renderMode, charMode, hiddenLines, lightIntensity, ambient, lightColor, lightAz, lightEl, roundConvex, bezier, fillType, gradA, gradB, gradAngle, faceTex, sideFill, sideTex, backFill, backTex, outlineOn, outlineColor, outlineWidth, layered, effectState]);

  // Load the picked Google font (Roboto by default) whenever family / weight
  // / style changes. The first font to resolve also pins `previewFont` — the
  // preset tiles' static single-letter renders.
  useEffect(() => {
    let alive = true;
    setStatus(`loading ${entry.family}…`);
    loadGoogleFont(entry, weight, italic ? "italic" : "normal")
      .then((f) => {
        if (!alive) return;
        setFont(f);
        setPreviewFont((prev) => prev ?? f);
        setStatus(`${entry.family} ${weight}${italic ? " italic" : ""}`);
      })
      .catch((e) => {
        if (!alive) return;
        console.error(`WordArt: failed to load ${entry.family} ${weight}${italic ? " italic" : ""}`, e);
        setStatus(`couldn't load ${entry.family}: ${e instanceof Error ? e.message : e}`);
      });
    return () => {
      alive = false;
    };
  }, [entry, weight, italic]);

  // Resolve each face's UI fill into a pure `Face` (gradients/rainbow → data URL
  // via resolveFace; solid/texture pass through). One key so the memo is stable.
  const TILE = 52;
  const frontKey = `${fillType}:${gradA}:${gradB}:${gradAngle}:${faceTex}:${color}:${fillImage.slice(0, 40)}`;
  const front = useMemo<Face>(() => {
    const spec: FaceFillSpec =
      fillType === "gradient" ? { kind: "gradient", color, from: gradA, to: gradB, angle: gradAngle }
      : fillType === "rainbow" ? { kind: "rainbow", color, angle: gradAngle }
      : fillType === "texture" ? { kind: "texture", color, url: texUrl(faceTex), tile: TILE }
      : fillType === "image" ? { kind: "image", color, src: fillImage }
      : { kind: "solid", color };
    return resolveFace(spec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frontKey]);

  const polygons = useMemo<Polygon[]>(() => {
    if (!font) return [];
    // "None" → no separate material for that face (it's covered by the nearest
    // active face), but the geometry still renders — no hole.
    const sides: Face | false =
      sideFill === "texture" ? resolveFace({ kind: "texture", color: sideColor, url: texUrl(sideTex), tile: TILE })
      : sideFill === "solid" ? { color: sideColor }
      : false;
    let back: BackFace | false =
      backFill === "texture" ? resolveFace({ kind: "texture", color: backColor, url: texUrl(backTex), tile: TILE })
      : backFill === "solid" ? { color: backColor }
      : false;
    if (back !== false && layered) back.offset = [offset || 12, -(offset || 12)];

    const profileObj: Profile =
      profile === "flat" ? "flat"
      : profile === "custom" ? { curve: bezier, segments: profileSegments }
      : { edge: profile, raised: roundConvex, segments: profileSegments };

    return composeText(font, applyCase(text, textCase), {
      size: 100,
      depth: layered ? 0 : depth,        // "Flat layers" = no edges (depth 0)
      profile: profileObj,
      // Scale X/Y are NOT baked here — they're applied as a per-axis mesh scale
      // in Stage, so they stretch the whole block uniformly with no rebuild.
      letterSpacing,
      lineHeight,
      align,
      underline,
      strike,
      curveSteps: curveSegments,
      simplify,
      warp: { shape: warpShape, amount: warpAmount },
      faces: { front, sides, back },
      outline: outlineOn ? { color: outlineColor, width: outlineWidth } : undefined,
    });
  }, [font, text, textCase, depth, profile, roundConvex, bezier, letterSpacing, lineHeight, align, underline, strike, sideColor, backColor, offset, curveSegments, simplify, profileSegments, warpShape, warpAmount, front, fillType, backFill, backTex, sideFill, sideTex, outlineOn, outlineColor, outlineWidth, layered]);

  // Source vector from azimuth (left/right) + elevation (height), biased toward
  // the front so the face stays lit.
  const lightDir = useMemo<Vec3>(() => {
    const a = (lightAz * Math.PI) / 180;
    const e = (lightEl * Math.PI) / 180;
    return [-Math.sin(e), -Math.sin(a) * Math.cos(e), Math.max(0.25, Math.cos(e))];
  }, [lightAz, lightEl]);

  const effectDefinition = useMemo<GalleryEffectDefinition | null>(
    () => galleryEffectDefinition(effectState.effectId),
    [effectState.effectId],
  );

  const handleEffectChange = useCallback((effectId: GlyphEffectId | null) => {
    setEffectState((current) => {
      if (!effectId) return DEFAULT_GALLERY_EFFECT_STATE;
      return createGalleryEffectState(effectId, {
        paused: current.paused,
        timeScale: current.timeScale,
      }) ?? DEFAULT_GALLERY_EFFECT_STATE;
    });
  }, []);

  const updateEffectSettings = useCallback(
    (partial: Partial<Pick<GalleryEffectState, "blend" | "paused" | "timeScale">>) => {
      setEffectState((current) => ({ ...current, ...partial }));
    },
    [],
  );

  const updateEffectParams = useCallback((partial: Record<string, GalleryEffectParamValue>) => {
    setEffectState((current) => {
      const params = { ...current.params, ...partial };
      const definition = galleryEffectDefinition(current.effectId);
      return { ...current, params: definition ? sanitizeGalleryEffectParams(definition, params) : params };
    });
  }, []);

  // ── Export (gallery/synth-style) ─────────────────────────────────────────
  const snapshotStage = useCallback(() => {
    setStageSnapshot({ ...stageSnapshotRef.current });
  }, []);
  const toggleCodeOpen = useCallback(() => {
    setCodeOpen((open) => {
      if (!open) snapshotStage();
      return !open;
    });
  }, [snapshotStage]);
  const handleMobileExportTab = useCallback(() => {
    setMobilePanel((current) => {
      if (current === "export") return null;
      snapshotStage();
      return "export";
    });
  }, [snapshotStage]);
  const closeCodePanel = useCallback(() => {
    setCodeOpen(false);
    setMobilePanel((m) => (m === "export" ? null : m));
  }, []);

  // Everything `composeText` needs to REGENERATE the mesh at export time
  // (rather than inlining the already-composed `polygons`) — mirrors the
  // `polygons` useMemo's own `front`/`sides`/`back`/`profileObj` construction
  // above, but as a serializable spec (`WordArtFaceSpec`/`WordArtProfileSpec`/
  // `WordArtFontSpec`) the exported snippet reconstructs via `resolveFace`/
  // `loadGoogleFont` instead of a resolved `Face`/`ParsedFont`. Texture URLs
  // are relative site assets, so they're baked to an ABSOLUTE URL off this
  // page's own origin here — a relative path wouldn't resolve from a CodePen
  // or a copy-pasted snippet. The font itself needs no such baking: it's
  // always a Google font (Roboto by default), fetched by `loadGoogleFont`
  // from the open-CORS Fontsource CDN, same as the live page.
  const composeInput = useMemo<WordArtComposeInput>(() => {
    const absUrl = (path: string) => (typeof window !== "undefined" ? `${window.location.origin}${path}` : path);
    const frontSpec: WordArtFaceSpec =
      fillType === "gradient" ? { kind: "gradient", color, from: gradA, to: gradB, angle: gradAngle }
      : fillType === "rainbow" ? { kind: "rainbow", color, angle: gradAngle }
      : fillType === "texture" ? { kind: "texture", color, url: absUrl(texUrl(faceTex)), tile: TILE }
      : fillType === "image" ? { kind: "image", color, src: fillImage }
      : { kind: "solid", color };
    const sidesSpec: WordArtFaceSpec | null =
      sideFill === "texture" ? { kind: "texture", color: sideColor, url: absUrl(texUrl(sideTex)), tile: TILE }
      : sideFill === "solid" ? { kind: "solid", color: sideColor }
      : null;
    const backSpec: (WordArtFaceSpec & { offset?: [number, number] }) | null =
      backFill === "texture" ? { kind: "texture", color: backColor, url: absUrl(texUrl(backTex)), tile: TILE }
      : backFill === "solid" ? { kind: "solid", color: backColor }
      : null;
    if (backSpec && layered) backSpec.offset = [offset || 12, -(offset || 12)];
    const profileSpec: WordArtProfileSpec =
      profile === "flat" ? { kind: "flat" }
      : profile === "custom" ? { kind: "curve", curve: bezier, segments: profileSegments }
      : { kind: "edge", edge: profile, raised: roundConvex, segments: profileSegments };
    const fontSpec: WordArtFontSpec = { entry, weight, style: italic ? "italic" : "normal" };
    return {
      text: applyCase(text, textCase),
      font: fontSpec,
      depth: layered ? 0 : depth,
      profile: profileSpec,
      letterSpacing,
      lineHeight,
      align,
      underline,
      strike,
      curveSteps: curveSegments,
      simplify,
      warpShape,
      warpAmount,
      front: frontSpec,
      sides: sidesSpec,
      back: backSpec,
      outline: outlineOn ? { color: outlineColor, width: outlineWidth } : null,
    };
  }, [entry, weight, italic, text, textCase, depth, profile, roundConvex, bezier, profileSegments, letterSpacing, lineHeight, align, underline, strike, curveSegments, simplify, warpShape, warpAmount, fillType, color, gradA, gradB, gradAngle, faceTex, fillImage, sideFill, sideColor, sideTex, backFill, backColor, backTex, offset, layered, outlineOn, outlineColor, outlineWidth]);

  const codeInput = useMemo<WordArtSnippetInput>(() => {
    const hasEffect = !!effectState.effectId && !!effectDefinition;
    const exportName = hasEffect ? galleryEffectExportName(effectDefinition) : null;
    const hasClock = hasEffect && effectDefinition ? "time" in effectDefinition.parameterSchema : false;
    return {
      compose: composeInput,
      scaleX: scaleX / 100,
      scaleY: scaleY / 100,
      rotation: stageSnapshot.rotation,
      perspective,
      zoom: stageSnapshot.zoom,
      lightDir,
      lightIntensity,
      lightColor,
      ambient,
      density,
      mode: renderMode,
      charMode,
      hiddenLines,
      effect: hasEffect && exportName
        ? {
            id: effectState.effectId as string,
            exportName,
            params: effectState.params,
            blend: effectState.blend,
            paused: effectState.paused,
            timeScale: effectState.timeScale,
            hasClock,
          }
        : null,
    };
  }, [composeInput, scaleX, scaleY, stageSnapshot, perspective, lightDir, lightIntensity, lightColor, ambient, density, renderMode, charMode, hiddenLines, effectState, effectDefinition]);

  /** POST a raw CodePen prefill `data` JSON payload (opens a new pen in a new tab). */
  function postCodepenForm(action: string, data: string): void {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = action;
    form.target = "_blank";
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = "data";
    input.value = data;
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    form.remove();
  }

  const exportTitle = () => `glyphcss word art — ${text.replace(/\s+/g, " ").trim().slice(0, 40) || "untitled"}`;

  // Standalone, always-visible "Open in CodePen" button (bottom-left): ships
  // the static, zero-runtime bake of whatever's currently on screen — the
  // exact rendered `<pre>` re-encoded via `encodeStaticGlyphHtml`, no
  // glyphcss import — mirrors the gallery's own static-pen builder
  // (`CodePanel.tsx`'s `buildStaticPen`) and /synth's standalone button.
  const handleExportCodepenStatic = useCallback(() => {
    const pre = document.querySelector(".wa-stage pre.glyph-output") as HTMLElement | null;
    if (!pre || !pre.innerHTML.trim()) return;
    setExporting(true);
    try {
      const cs = getComputedStyle(pre);
      const fontCss = `html,body{margin:0;height:100%;background:#07090d;display:grid;place-items:center}
.glyph-output{margin:0;white-space:pre;font-family:${cs.fontFamily};font-size:${cs.fontSize};line-height:${cs.lineHeight};color:${cs.color}}`;
      const enc = encodeStaticGlyphHtml(pre.innerHTML, "classes", { crop: true });
      postCodepenForm("https://codepen.io/pen/define", JSON.stringify({
        title: exportTitle(),
        html: enc.html,
        css: enc.css ? `${fontCss}\n${enc.css}` : fontCss,
        js: "",
        editors: "100",
      }));
    } finally {
      setExporting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  // "Export" code window's own CodePen action: a self-contained, lib-based
  // (glyphcss + @glyphcss/fonts + @glyphcss/effects from the CDN) pen that
  // REGENERATES the mesh via `composeText` at runtime (same `codeInput` the
  // code panel's tabs render from) instead of shipping a baked polygon
  // literal — mirrors the gallery/synth's `handleCodepen`/
  // `handleExportCodepenDynamic`, except orientation comes from the camera
  // (pinned rotX/rotY=0) + `<GlyphMesh rotation/scale>` exactly like the
  // live Stage, so no vertex-baking (`bakeMeshTransform`) is needed for this
  // path anymore.
  const handleExportCodepenDynamic = useCallback(() => {
    setExporting(true);
    try {
      const prefill = buildWordArtCodepenPen(codeInput, exportTitle());
      postCodepenForm(prefill.action, prefill.data);
    } finally {
      setExporting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeInput, text]);

  function pickFamily(value: string) {
    setFamilyInput(value);
    const f = catalog.find((e) => e.family.toLowerCase() === value.trim().toLowerCase());
    if (f) {
      setEntry(f);
      setWeight(pickWeight(f, weight));
    }
  }

  function applyPreset(p: Preset) {
    setProfile(p.profile);
    setDepth(p.depth);
    setColor(p.color);
    setSideColor(p.sideColor);
    setBackColor(p.backColor ?? p.color);
    setOffset(p.offset ?? 0);
    setWarpShape(p.warp?.shape ?? "none");
    setWarpAmount(p.warp?.amount ?? 0.5);
    setFillType(p.fill ?? "solid");
    if (p.gradA) setGradA(p.gradA);
    if (p.gradB) setGradB(p.gradB);
    setGradAngle(p.gradAngle ?? 270);
    if (p.faceTex) setFaceTex(p.faceTex);
    setSideFill(p.sideTex ? "texture" : "solid");
    if (p.sideTex) setSideTex(p.sideTex);
    setBackFill(p.backTex ? "texture" : "solid");
    if (p.backTex) setBackTex(p.backTex);
    setOutlineOn(!!p.outline);
    if (p.outline) { setOutlineColor(p.outline.color); setOutlineWidth(p.outline.width); }
    setLayered(!!p.layered);
    setActivePreset(p.label);
  }

  // The Profile dropdown encodes edge shape only — colors now come from the
  // axial face stops, so there's no coverage to bundle in.
  const profileMode = profile === "flat" ? "flat"
    : profile === "custom" ? "custom"
    : profile === "round" ? (roundConvex ? "roundup" : "round")
    : "bevel";
  const guiValues: GuiValues = {
    layered,
    profileMode, warp: warpShape, bend: warpAmount,
    depth, scaleX, scaleY,
    curveSegments, simplify, profileSegments, offset,
    density, renderMode, charMode, hiddenLines,
    perspective, zoom: zoomScale, spin,
    light: lightIntensity, ambient, az: lightAz, el: lightEl, lightColor,
  };
  const guiSet = (k: keyof GuiValues, v: number | string | boolean) => {
    switch (k) {
      case "layered": setLayered(v as boolean); break;
      case "profileMode": {
        const base = v as string;
        setProfile(base === "flat" ? "flat" : base === "custom" ? "custom" : base.startsWith("round") ? "round" : "bevel");
        setRoundConvex(base === "roundup");
        break;
      }
      case "warp": setWarpShape(v as WarpShape); break;
      case "bend": setWarpAmount(v as number); break;
      case "depth": setDepth(v as number); break;
      case "scaleX": setScaleX(v as number); break;
      case "scaleY": setScaleY(v as number); break;
      case "curveSegments": setCurveSegments(v as number); break;
      case "simplify": setSimplify(v as number); break;
      case "profileSegments": setProfileSegments(v as number); break;
      case "offset": setOffset(v as number); break;
      case "density": setDensity(v as number); break;
      case "renderMode": setRenderMode(v as WordArtRenderMode); break;
      case "charMode": setCharMode(v as WordArtCharMode); break;
      case "hiddenLines": setHiddenLines(v as WordArtHiddenLines); break;
      case "perspective": setPerspective(v as boolean); break;
      case "zoom": setZoomScale(v as number); break;
      case "spin": setSpin(v as boolean); break;
      case "light": setLightIntensity(v as number); break;
      case "ambient": setAmbient(v as number); break;
      case "az": setLightAz(v as number); break;
      case "el": setLightEl(v as number); break;
      case "lightColor": setLightColor(v as string); break;
    }
  };

  const leftValues: LeftValues = {
    weight, italic, underline, strike, textCase, align, letterSpacing, lineHeight,
    color, sideColor, backColor,
    fillType, gradA, gradB, gradAngle, image: fillImage, faceTex,
    sideFill, sideTex, backFill, backTex,
    outlineOn, outlineColor, outlineWidth,
  };
  const leftSet = (k: keyof LeftValues, v: number | string | boolean) => {
    switch (k) {
      case "weight": setWeight(v as number); break;
      case "italic": setItalic(v as boolean); break;
      case "underline": setUnderline(v as boolean); break;
      case "strike": setStrike(v as boolean); break;
      case "textCase": setTextCase(v as "as-typed" | "upper" | "lower" | "title"); break;
      case "align": setAlign(v as Align); break;
      case "letterSpacing": setLetterSpacing(v as number); break;
      case "lineHeight": setLineHeight(v as number); break;
      case "color": setColor(v as string); break;
      case "sideColor": setSideColor(v as string); break;
      case "backColor": setBackColor(v as string); break;
      case "fillType": setFillType(v as FillType); break;
      case "gradA": setGradA(v as string); break;
      case "gradB": setGradB(v as string); break;
      case "gradAngle": setGradAngle(v as number); break;
      case "image": setFillImage(v as string); break;
      case "faceTex": setFaceTex(v as string); break;
      case "sideFill": setSideFill(v as FaceFill); break;
      case "sideTex": setSideTex(v as string); break;
      case "backFill": setBackFill(v as FaceFill); break;
      case "backTex": setBackTex(v as string); break;
      case "outlineOn": setOutlineOn(v as boolean); break;
      case "outlineColor": setOutlineColor(v as string); break;
      case "outlineWidth": setOutlineWidth(v as number); break;
    }
  };

  // Bottom preset row — one static single-letter glyphcss render per preset,
  // computed once (memoized on the pinned preview font) with NO live scene /
  // rAF: `compileScene` is pure (geometry + camera → string), so each tile is
  // a plain `<pre>` string baked at mount and re-baked only if the bundled
  // font itself reloads.
  const presetTiles = useMemo(() => {
    if (!previewFont) return null;
    const map = new Map<string, CompileSceneResult | null>();
    for (const p of PRESETS) map.set(p.label, renderPresetTile(previewFont, p, renderMode, charMode));
    return map;
  }, [previewFont, renderMode, charMode]);

  return (
    <div className="wa-shell dn-root dn-root--wordart">
      <StatsOverlay />
      <div className="wa-body">
        <aside
          id="wa-compose-panel"
          className={`wa-rail ${mobilePanel === "compose" ? "is-mobile-open" : ""}`}
          aria-label="Text and style"
        >
          <div className="wa-rail-head"><span>Text &amp; Style</span></div>
          <div className="wa-rail-body">
            <label className="wa-field">
              <span>Text</span>
              <textarea
                className="wa-input"
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                spellCheck={false}
              />
            </label>
            <label className="wa-field">
              <span>Google font</span>
              <FontPicker catalog={catalog} value={familyInput} onPick={pickFamily} />
            </label>

            <Dock id="wa-rail-controls" className="wa-rail-dock">
              <WordArtRailControls left={leftValues} setLeft={leftSet} />
            </Dock>
          </div>
        </aside>

        <main className="wa-main">
          <Stage
            polygons={polygons}
            scaleXFrac={scaleX / 100}
            scaleYFrac={scaleY / 100}
            zoomScale={zoomScale}
            setZoomScale={setZoomScale}
            turn={turn}
            setTurn={setTurn}
            tilt={tilt}
            setTilt={setTilt}
            density={density}
            renderMode={renderMode}
            charMode={charMode}
            hiddenLines={hiddenLines}
            perspective={perspective}
            lightDir={lightDir}
            lightIntensity={lightIntensity}
            lightColor={lightColor}
            ambient={ambient}
            spin={spin}
            status={status}
            effectDefinition={effectDefinition}
            effectParams={effectState.params}
            effectBlend={effectState.blend}
            effectPaused={effectState.paused}
            effectTimeScale={effectState.timeScale}
            snapshotRef={stageSnapshotRef}
          />
          <div className="wa-export-bar">
            <button
              type="button"
              className="gw-code-panel__action gw-code-panel__action--codepen"
              onClick={handleExportCodepenStatic}
              disabled={exporting}
              title="Open the current rendered word art as a static, zero-runtime CodePen"
            >
              {exporting ? "Exporting…" : "Open in CodePen"}
            </button>
            <button
              type="button"
              className={`gw-code-panel__action${codeOpen ? " is-active" : ""}`}
              onClick={toggleCodeOpen}
              aria-expanded={codeOpen}
              title={codeOpen ? "Close export code window" : "Open export code window"}
            >
              Export
            </button>
          </div>
          {(codeOpen || mobilePanel === "export") && (
            <WordArtCodePanel
              id="wa-export-panel"
              input={codeInput}
              onCodepen={handleExportCodepenDynamic}
              exporting={exporting}
              onClose={closeCodePanel}
            />
          )}
        </main>

        <Dock id="wa-controls-panel" className={mobilePanel === "controls" ? "is-mobile-open" : ""}>
          <WordArtDock
            gui={guiValues}
            setGui={guiSet}
            bezier={bezier}
            onBezier={setBezier}
            effectState={effectState}
            effectDefinition={effectDefinition}
            onEffectChange={handleEffectChange}
            onUpdateEffectSettings={updateEffectSettings}
            onUpdateEffectParams={updateEffectParams}
          />
        </Dock>
      </div>

      <div id="wa-presets-panel" className={`wa-presets ${mobilePanel === "presets" ? "is-mobile-open" : ""}`} role="list" aria-label="Style presets">
        {PRESETS.map((p) => {
          const tile = presetTiles?.get(p.label);
          return (
            <button key={p.label} type="button" className={`wa-tile ${activePreset === p.label ? "is-active" : ""}`} onClick={() => applyPreset(p)} title={`Apply “${p.label}”`}>
              <span className="wa-tile__thumb">
                {/* `tile.html` (not `.inner`) — the `<pre class="glyph-output">` wrapper
                    carries the base stylesheet's `white-space: pre` + monospace
                    font, which the raw newline-joined grid string needs to lay out
                    as rows instead of collapsing/wrapping like normal text. */}
                {tile && <span className="wa-tile__glyph" dangerouslySetInnerHTML={{ __html: tile.html }} />}
              </span>
              <span className="wa-tile__label">{p.label}</span>
            </button>
          );
        })}
      </div>

      <nav className="dn-mobile-tabs" aria-label="WordArt panels">
        <button
          type="button"
          className={`dn-mobile-tabs__button${mobilePanel === "compose" ? " is-active" : ""}`}
          aria-controls="wa-compose-panel"
          aria-expanded={mobilePanel === "compose"}
          onClick={() => setMobilePanel((cur) => (cur === "compose" ? null : "compose"))}
        >
          Style
        </button>
        <button
          type="button"
          className={`dn-mobile-tabs__button${mobilePanel === "controls" ? " is-active" : ""}`}
          aria-controls="wa-controls-panel"
          aria-expanded={mobilePanel === "controls"}
          onClick={() => setMobilePanel((cur) => (cur === "controls" ? null : "controls"))}
        >
          Controls
        </button>
        <button
          type="button"
          className={`dn-mobile-tabs__button${mobilePanel === "presets" ? " is-active" : ""}`}
          aria-controls="wa-presets-panel"
          aria-expanded={mobilePanel === "presets"}
          onClick={() => setMobilePanel((cur) => (cur === "presets" ? null : "presets"))}
        >
          Presets
        </button>
        <button
          type="button"
          className={`dn-mobile-tabs__button${mobilePanel === "export" ? " is-active" : ""}`}
          aria-controls="wa-export-panel"
          aria-expanded={mobilePanel === "export"}
          onClick={handleMobileExportTab}
        >
          Export
        </button>
      </nav>
    </div>
  );
}

/** Center the word's bbox on the origin so the camera frames it (glyphcss has
 *  no scene-side autoCenter). NO axis swap: @glyphcss/fonts emits polygons in
 *  the same world→screen frame glyphcss projects with (X down, Y right, Z depth). */
function centerMesh(polygons: Polygon[]): Polygon[] {
  if (polygons.length === 0) return polygons;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of polygons) for (const v of p.vertices) {
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  return polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map(([x, y, z]) => [x - cx, y - cy, z - cz] as Vec3),
  }));
}

/** World-frame XYZ Euler rotation (degrees), R = Rx·Ry·Rz — the exact
 *  convention `createGlyphScene`'s internal mesh-transform applies for a
 *  `<GlyphMesh rotation>` prop. Used by the preset tiles to angle a static
 *  letter without touching the camera (whose own `rotX`/`rotY` orbits in a
 *  different, camera-specific convention). */
function rotateMeshVerticesDeg(polygons: Polygon[], [rxDeg, ryDeg, rzDeg]: Vec3): Polygon[] {
  const DEG2RAD = Math.PI / 180;
  const rx = rxDeg * DEG2RAD, ry = ryDeg * DEG2RAD, rz = rzDeg * DEG2RAD;
  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const cosZ = Math.cos(rz), sinZ = Math.sin(rz);
  function rotate([x, y, z]: Vec3): Vec3 {
    let nx = cosZ * x - sinZ * y;
    let ny = sinZ * x + cosZ * y;
    let nz = z;
    x = cosY * nx + sinY * nz;
    y = ny;
    z = -sinY * nx + cosY * nz;
    nx = x;
    ny = cosX * y - sinX * z;
    nz = sinX * y + cosX * z;
    return [nx, ny, nz];
  }
  return polygons.map((p) => ({ ...p, vertices: p.vertices.map(rotate) }));
}

interface StageProps {
  polygons: Polygon[];
  scaleXFrac: number;
  scaleYFrac: number;
  zoomScale: number;
  setZoomScale: (updater: (prev: number) => number) => void;
  turn: number;
  setTurn: (updater: (prev: number) => number) => void;
  tilt: number;
  setTilt: (updater: (prev: number) => number) => void;
  density: number;
  renderMode: WordArtRenderMode;
  charMode: WordArtCharMode;
  hiddenLines: WordArtHiddenLines;
  perspective: boolean;
  lightDir: Vec3;
  lightIntensity: number;
  lightColor: string;
  ambient: number;
  spin: boolean;
  status: string;
  effectDefinition: GalleryEffectDefinition | null;
  effectParams: Record<string, GalleryEffectParamValue>;
  effectBlend: GalleryEffectBlend;
  effectPaused: boolean;
  effectTimeScale: number;
  /** Always-fresh mesh-rotation + effective-zoom snapshot, read (not
   *  subscribed to) by the Export panel's "CodePen" action when it fires —
   *  mirrors `SynthWorkbench`'s `cameraRef`/`snapshotCamera()`, except here
   *  it's the MESH that turntables (the camera is pinned at rot 0), so what's
   *  snapshotted is `<GlyphMesh rotation>` + the fitted `zoom`, not a camera
   *  orientation. */
  snapshotRef: React.MutableRefObject<{ rotation: Vec3; zoom: number }>;
}

/**
 * Isolated render surface. Auto-spin / drag drive the MESH rotation (turntable
 * Rx + tilt Ry); the camera is pinned at rot 0. glyphcss projects geometry to an
 * ASCII <pre>, so there's no CSS-3D wrapper to spin like polycss. Kept small so
 * the per-frame spin re-render doesn't touch the parent's controls +
 * 2000-option font datalist.
 */
/**
 * `<GlyphScene autoSize>` only re-measures cols/rows via a `ResizeObserver`
 * on the HOST BOX size (`createGlyphScene`'s `fitToHost`) — changing the
 * Density slider's font-size alone doesn't resize that box, so the grid
 * would stay stale until something else (e.g. a window resize) happened to
 * trigger a refit. Mounted as a scene child (same `useGlyphSceneContext`
 * seam `GlyphMesh` itself uses) so it can call the imperative `scene.fit()`
 * + `rerender()` explicitly whenever `density` changes — mirrors
 * `SynthWorkbench`'s own density effect (`host.style.fontSize = …; scene.fit();
 * scene.rerender();`), just declared as a child instead of an imperative ref.
 */
function DensityFit({ density }: { density: number }) {
  const { sceneRef } = useGlyphSceneContext();
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.fit();
    scene.rerender();
  }, [density, sceneRef]);
  return null;
}

function Stage({ polygons, scaleXFrac, scaleYFrac, zoomScale, setZoomScale, turn, setTurn, tilt, setTilt, density, renderMode, charMode, hiddenLines, perspective, lightDir, lightIntensity, lightColor, ambient, spin, status, effectDefinition, effectParams, effectBlend, effectPaused, effectTimeScale, snapshotRef }: StageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 900, h: 600 });
  const draggingRef = useRef(false);
  const lastPtr = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStage({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Auto-spin advances the mesh turntable (turn = Rx) each frame (paused while dragging).
  useEffect(() => {
    if (!spin) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (!draggingRef.current) setTurn((t) => (t + dt * 32) % 360);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [spin]);

  const onPointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    lastPtr.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    const dx = e.clientX - lastPtr.current.x;
    const dy = e.clientY - lastPtr.current.y;
    lastPtr.current = { x: e.clientX, y: e.clientY };
    setTurn((t) => t - dx * 0.4);
    setTilt((t) => Math.max(-85, Math.min(85, t + dy * 0.4)));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };
  // Wheel drives the same zoomScale the sidebar slider does (so they agree).
  const onWheel = (e: React.WheelEvent) => {
    const factor = Math.pow(0.95, e.deltaY * 0.012);
    setZoomScale((z) => Math.max(0.1, Math.min(6, z * factor)));
  };

  const centered = useMemo(() => centerMesh(polygons), [polygons]);
  const zoom = fitWordArtZoom(centered, stage.w, stage.h, scaleXFrac, scaleYFrac) * zoomScale;
  const Cam = perspective ? GlyphPerspectiveCamera : GlyphOrthographicCamera;
  // Always-fresh — read only when the Export panel/CodePen action fires (see
  // `StageProps.snapshotRef`), never subscribed to, so this plain assignment
  // (not a `useEffect`) is fine even though `turn` changes every spin frame.
  snapshotRef.current = { rotation: [turn, tilt, 0], zoom };

  return (
    <div
      className="wa-stage"
      ref={stageRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      style={{ cursor: "grab", touchAction: "none" }}
    >
      <Cam rotX={0} rotY={0} zoom={zoom}>
        <GlyphScene
          autoSize
          mode={renderMode}
          charMode={charMode}
          hiddenLines={hiddenLines}
          style={{ width: "100%", height: "100%", fontSize: `${BASE_FONT_PX / density}px` }}
          directionalLight={{ direction: lightDir, intensity: lightIntensity, color: lightColor }}
          ambientLight={{ intensity: ambient }}
        >
          <DensityFit density={density} />
          {/* Font mesh is X-up: local X = text height (screen-down), local Y =
              text width (screen-right). The "Scale X" slider should stretch
              horizontally, so it maps to local Y; "Scale Y" maps to local X.
              Depth is baked into the geometry, so Z stays 1. */}
          <GlyphMesh polygons={centered} rotation={[turn, tilt, 0]} scale={[scaleYFrac, scaleXFrac, 1]} />
          {effectDefinition && (
            <WordArtEffectLayer
              key={effectDefinition.id}
              definition={effectDefinition}
              params={effectParams}
              blend={effectBlend}
              paused={effectPaused}
              timeScale={effectTimeScale}
            />
          )}
        </GlyphScene>
      </Cam>
      <div className="wa-stage-foot">
        {polygons.length.toLocaleString()} polygons{status ? ` · ${status}` : ""}
      </div>
    </div>
  );
}

interface WordArtEffectLayerProps {
  definition: GalleryEffectDefinition;
  params: Record<string, GalleryEffectParamValue>;
  blend: GalleryEffectBlend;
  paused: boolean;
  timeScale: number;
}

/**
 * One `@glyphcss/effects` layer applied to the word-art mesh — the
 * doc-canonical React pattern (`<GlyphEffectLayer ref>` + a `requestAnimationFrame`
 * loop mutating `ref.current.params.time` directly, bypassing React state so
 * the clock never re-renders the composition/Dock tree) mirroring the
 * gallery's own paused/timeScale-aware `configureEffect`/`startEffectLoop`
 * clock in `glyph-runtime.ts`. Effects without a `time` parameter mount with
 * no clock at all — same `"time" in parameterSchema` gate the Effects folder
 * uses to enable/disable its own Paused/Speed controls.
 */
function WordArtEffectLayer({ definition, params, blend, paused, timeScale }: WordArtEffectLayerProps) {
  const layerRef = useRef<GlyphEffectLayerHandle<Record<string, GalleryEffectParamValue>>>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const timeScaleRef = useRef(timeScale);
  timeScaleRef.current = timeScale;
  const hasTime = "time" in definition.parameterSchema;

  useEffect(() => {
    if (!hasTime) return;
    let raf = 0;
    let last: number | null = null;
    let time = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (pausedRef.current) { last = now; return; }
      const elapsed = last === null ? 0 : Math.min(Math.max(now - last, 0) / 1000, 0.1);
      last = now;
      time += elapsed * timeScaleRef.current;
      if (layerRef.current) layerRef.current.params.time = time;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [hasTime]);

  return (
    <GlyphEffectLayer
      ref={layerRef}
      effect={definition as GlyphEffectDefinition<GlyphEffectParamSchema>}
      params={params}
      target="surfaces"
      blend={blend}
    />
  );
}

interface GuiValues {
  layered: boolean;
  profileMode: string; warp: string; bend: number;
  depth: number; scaleX: number; scaleY: number;
  curveSegments: number; simplify: number; profileSegments: number; offset: number;
  density: number;
  renderMode: WordArtRenderMode; charMode: WordArtCharMode; hiddenLines: WordArtHiddenLines;
  perspective: boolean; zoom: number; spin: boolean;
  light: number; ambient: number; az: number; el: number; lightColor: string;
}

interface LeftValues {
  weight: number; italic: boolean; underline: boolean; strike: boolean;
  textCase: string; align: string; letterSpacing: number; lineHeight: number;
  color: string; sideColor: string; backColor: string;
  fillType: string; gradA: string; gradB: string; gradAngle: number; image: string;
  faceTex: string; sideFill: string; sideTex: string; backFill: string; backTex: string;
  outlineOn: boolean; outlineColor: string; outlineWidth: number;
}

// ── Preset tile static render ──────────────────────────────────────────────
// A SMALL grid of FEW, LARGE cells rendered at a comfortably legible
// font-size (`.wa-tile__glyph` in wordart.css) — not a big grid shrunk down.
// A browser can't render monospace glyphs crisply much below ~7px, so a
// denser grid forced into a small box just reads as blurred noise even
// though the underlying character data is a perfectly clean letterform
// (verified by dumping the plain-text `compileScene` output directly).
// Lowercase needs a bit more resolution than uppercase did: the "a" glyph's
// bowl/counter is a small interior hole (vs. the big triangular gap inside
// an "A"), and at the yaw this tile now uses to show the extrusion's side
// wall, a too-small grid or too-large a yaw flattens that hole into a solid
// blob — 16×11 at the rotation below is the smallest grid that keeps the
// bowl legible while still reading as a clean, un-noisy glyph.
// `cellAspect` is picked so a roughly square glyph bbox (~cap-height square,
// see `composeText`'s size:100) fills both cols and rows at close to the
// same fraction — `createGlyphOrthographicCamera`'s col axis divides by
// `BASE_TILE/cellAspect` while the row axis divides by `BASE_TILE` (see
// `project()`), so col demand scales with `cellAspect`; the library's own
// monospace-matching default (~2) is col-constrained for a square shape and
// wastes rows as blank margin.
const TILE_COLS = 16;
const TILE_ROWS = 11;
const TILE_CELL_ASPECT = 1.45;
// A little breathing room around the letter inside the grid (vs. the
// library's own 0.95 default), so the "a" doesn't touch the tile's edges.
const TILE_FRAME_FILL = 0.92;
const TILE_TEXTURE_SIZE = 20;
// Stage's own default light (lightAz -25 / lightEl 45), computed the same
// way — see the `lightDir` useMemo below — so the tile preview is lit
// exactly like the live composition's resting state.
const TILE_LIGHT_DIR: Vec3 = [-Math.sin(45 * (Math.PI / 180)), -Math.sin(-25 * (Math.PI / 180)) * Math.cos(45 * (Math.PI / 180)), Math.max(0.25, Math.cos(45 * (Math.PI / 180)))];

/** Fit `polygons` into an orthographic camera's cols×rows grid by scaling
 *  zoom linearly off a zoom=1 projection (exact for orthographic — no
 *  perspective divide to fight). Mirrors `/synth`'s `frameObject`, minus the
 *  live-DOM cell-metrics measurement (compileScene has no DOM, so it always
 *  projects with the same BASE_TILE fallback metrics this uses too). */
function frameZoomForGrid(
  camera: ReturnType<typeof createGlyphOrthographicCamera>,
  polygons: Polygon[],
  cols: number,
  rows: number,
  cellAspect: number,
  fill = 0.95,
): number {
  camera.zoom = 1;
  let minc = Infinity, maxc = -Infinity, minr = Infinity, maxr = -Infinity;
  for (const p of polygons) for (const v of p.vertices) {
    const pr = camera.project(v as Vec3, cols, rows, cellAspect);
    if (!isFinite(pr[0]!) || !isFinite(pr[1]!)) continue;
    if (pr[0]! < minc) minc = pr[0]!; if (pr[0]! > maxc) maxc = pr[0]!;
    if (pr[1]! < minr) minr = pr[1]!; if (pr[1]! > maxr) maxr = pr[1]!;
  }
  const w = maxc - minc, h = maxr - minr;
  if (!(w > 0) || !(h > 0)) return 1;
  return Math.min((fill * cols) / w, (fill * rows) / h);
}

/**
 * Render one preset as a static single-letter `<pre>` — the same face-fill /
 * profile / warp mapping `applyPreset` drives the live composition with,
 * extruded via the pinned preview font and compiled with `compileScene`
 * (pure: geometry + camera → string, no DOM, no rAF). Gradient/rainbow/
 * texture/image fills fall back to their flat `color` here — compileScene
 * has no async image decode to sample a texture sampler from (same fallback
 * the live runtime shows for one frame before its own sampler resolves).
 */
function renderPresetTile(font: ParsedFont, preset: Preset, mode: WordArtRenderMode, charMode: WordArtCharMode): CompileSceneResult | null {
  const sides: Face = preset.sideTex
    ? resolveFace({ kind: "texture", color: preset.sideColor, url: texUrl(preset.sideTex), tile: TILE_TEXTURE_SIZE })
    : { color: preset.sideColor };
  let back: BackFace = preset.backTex
    ? resolveFace({ kind: "texture", color: preset.backColor ?? preset.color, url: texUrl(preset.backTex), tile: TILE_TEXTURE_SIZE })
    : { color: preset.backColor ?? preset.color };
  if (preset.layered) back = { ...back, offset: [preset.offset ?? 12, -(preset.offset ?? 12)] };

  const front: Face = resolveFace(
    preset.fill === "gradient" ? { kind: "gradient", color: preset.color, from: preset.gradA ?? preset.color, to: preset.gradB ?? preset.color, angle: preset.gradAngle ?? 270 }
    : preset.fill === "rainbow" ? { kind: "rainbow", color: preset.color, angle: preset.gradAngle ?? 0 }
    : preset.fill === "texture" ? { kind: "texture", color: preset.color, url: texUrl(preset.faceTex ?? "dirt"), tile: TILE_TEXTURE_SIZE }
    : { kind: "solid", color: preset.color },
  );

  const profileObj: Profile = preset.profile === "flat" ? "flat"
    // No PRESETS entry uses "custom" (that needs a caller-authored bezier curve,
    // which a Preset doesn't carry) — fall back to the default easing if one ever does.
    : preset.profile === "custom" ? { curve: [0.3, 0.9, 0.7, 0.1], segments: 3 }
    : { edge: preset.profile, raised: false, segments: 3 };

  const polygons = composeText(font, "a", {
    size: 100,
    depth: preset.layered ? 0 : preset.depth,
    profile: profileObj,
    letterSpacing: 0,
    lineHeight: 1.15,
    align: "center",
    curveSteps: 3,
    simplify: 3,
    warp: { shape: preset.warp?.shape ?? "none", amount: preset.warp?.amount ?? 0.5 },
    faces: { front, sides, back },
    outline: preset.outline ? { color: preset.outline.color, width: preset.outline.width } : undefined,
  });
  if (polygons.length === 0) return null;

  // Turn + tilt the MESH (not the camera) for a 3/4 icon angle that shows a
  // strip of the extrusion's side wall (its own `sideColor`/`sideTex`, not
  // just the front face) — same convention `createGlyphScene`'s internal
  // `applyTransform` uses for a mesh's `rotation` prop (world-frame XYZ
  // Euler, R = Rx·Ry·Rz), and the same one the live Stage's
  // `<GlyphMesh rotation={[turn, tilt, 0]}>` drives. The camera's own
  // `rotX`/`rotY` is a DIFFERENT convention (orbits per voxcss's
  // `rotateVec3Voxcss`) — mixing the two produced a squashed, illegible glyph.
  // The yaw (Rx, turntable around the glyph's vertical) is kept modest: past
  // ~24° it closes up the "a" bowl's small counter into a solid blob at this
  // grid size (an "A"'s big triangular gap tolerated much more yaw).
  const tilted = rotateMeshVerticesDeg(centerMesh(polygons), [18, 10, 0]);
  const centered = centerMesh(tilted);
  const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 1 });
  camera.zoom = frameZoomForGrid(camera, centered, TILE_COLS, TILE_ROWS, TILE_CELL_ASPECT, TILE_FRAME_FILL);
  return compileScene({
    polygons: centered,
    camera,
    cols: TILE_COLS,
    rows: TILE_ROWS,
    cellAspect: TILE_CELL_ASPECT,
    mode,
    charMode,
    useColors: true,
    // Same light vector the live Stage defaults to (lightAz -25 / lightEl 45)
    // — proven to keep the front face readably lit for this exact mesh
    // convention. A guessed off-axis vector left most of the front face
    // shaded dark enough to fall to near-blank ramp glyphs, so only a thin
    // bevel highlight band was visible — illegible. Ambient is bumped a
    // little further so weakly-lit facets still render a visible glyph.
    directionalLight: { direction: TILE_LIGHT_DIR, intensity: 0.95 },
    ambientLight: { intensity: 0.7 },
  });
}

/**
 * Custom widgets injected into a Dock folder via `useDockSlot` — the same
 * portal seam `/synth`'s `SynthDock` uses for its oscilloscope, and the same
 * pattern the right-hand `WordArtDock` uses for its bezier editor. Segmented
 * button groups (Case/Align), the bundled-texture swatch grid, and the image
 * upload button have no lil-gui equivalent, so they render as plain React
 * into a slot `<div>` lil-gui reserves for arbitrary content. Kept as real
 * lil-gui folder controllers (not bespoke HTML inputs) for everything else so
 * the left rail's composition controls are pixel-identical to the right
 * Dock's — same checkbox brackets, same slider brackets, same select chevron.
 */
interface SegmentedGroup {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; title: string }[];
}

function SegmentedGroupRow({ label, value, onChange, options }: SegmentedGroup) {
  return (
    <div className="wa-seg-row">
      <span className="wa-seg-name">{label}</span>
      <div className="wa-seg" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} type="button" title={o.title} className={o.value === value ? "is-on" : ""} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Case + Align share one slot row (side by side) instead of two stacked
 *  rows — both are short segmented picks, so pairing them saves vertical
 *  space without crowding either. */
function useSegmentedDuoSlot(folder: GUI | null, a: SegmentedGroup, b: SegmentedGroup): ReactNode {
  const host = useDockSlot(folder, { position: "bottom", className: "wa-widget-slot" });
  if (!host) return null;
  return createPortal(
    <div className="wa-seg-duo">
      <SegmentedGroupRow {...a} />
      <SegmentedGroupRow {...b} />
    </div>,
    host,
  );
}

function useTextureGridSlot(folder: GUI | null, value: string, onChange: (v: string) => void, visible: boolean): ReactNode {
  const host = useDockSlot(folder, { position: "bottom", className: "wa-widget-slot" });
  if (!host) return null;
  return createPortal(
    <div className="wa-texrow" style={{ display: visible ? "" : "none" }}>
      <div className="wa-texgrid">
        {TEXTURES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`wa-texgrid__sw${t.id === value ? " is-on" : ""}`}
            title={t.label}
            style={{ backgroundImage: `url(${texUrl(t.id)})` }}
            onClick={() => onChange(t.id)}
          />
        ))}
      </div>
    </div>,
    host,
  );
}

function useImageUploadSlot(folder: GUI | null, visible: boolean, onChange: (dataUrl: string) => void): ReactNode {
  const host = useDockSlot(folder, { position: "bottom", className: "wa-widget-slot" });
  const inputRef = useRef<HTMLInputElement>(null);
  if (!host) return null;
  return createPortal(
    <div className="wa-imgrow" style={{ display: visible ? "" : "none" }}>
      <button type="button" className="wa-imgbtn" onClick={() => inputRef.current?.click()}>Choose image…</button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => onChange(String(reader.result));
          reader.readAsDataURL(file);
        }}
      />
    </div>,
    host,
  );
}

/**
 * Left rail — the word's composition: Typography (weight/style/case/align/
 * spacing) and Color (front/sides/back/outline). Mounted as its OWN `<Dock>`
 * instance (own `useGui`, own lil-gui root) inside the left rail instead of
 * the shared right-hand Dock, so it renders with the identical row styling
 * (checkbox, slider, select, color swatch) while staying visually separate
 * from the 3D/scene knobs on the right.
 */
function WordArtRailControls({ left, setLeft }: {
  left: LeftValues; setLeft: (k: keyof LeftValues, v: number | string | boolean) => void;
}): ReactNode {
  const dock = useDockGui();

  // ── Typography ────────────────────────────────────────────────────────
  const typeFolder = useFolder(dock, "Typography", { open: true });
  useOption(typeFolder, "Weight", WEIGHT_OPTS, left.weight, (v) => setLeft("weight", v));
  useToggle(typeFolder, "Italic", left.italic, (v) => setLeft("italic", v));
  useToggle(typeFolder, "Underline", left.underline, (v) => setLeft("underline", v));
  useToggle(typeFolder, "Strikethrough", left.strike, (v) => setLeft("strike", v));
  const caseAlignSlot = useSegmentedDuoSlot(
    typeFolder,
    { label: "Case", value: left.textCase, onChange: (v) => setLeft("textCase", v), options: CASE_OPTS },
    { label: "Align", value: left.align, onChange: (v) => setLeft("align", v), options: ALIGN_OPTS },
  );
  useSlider(typeFolder, "Letter spacing", { min: -20, max: 60, step: 1 }, left.letterSpacing, (v) => setLeft("letterSpacing", v));
  useSlider(typeFolder, "Line height", { min: 0.8, max: 2.5, step: 0.05 }, left.lineHeight, (v) => setLeft("lineHeight", v));

  // ── Color ─────────────────────────────────────────────────────────────
  const colorFolder = useFolder(dock, "Color", { open: true });
  useOption(colorFolder, "Front", FILL_OPTS, left.fillType, (v) => setLeft("fillType", v));
  const frontColorCtrl = useColor(colorFolder, "Color", left.color, (v) => setLeft("color", v));
  const gradACtrl = useColor(colorFolder, "Color A", left.gradA, (v) => setLeft("gradA", v));
  const gradBCtrl = useColor(colorFolder, "Color B", left.gradB, (v) => setLeft("gradB", v));
  const gradAngleCtrl = useSlider(colorFolder, "Angle", { min: 0, max: 360, step: 5 }, left.gradAngle, (v) => setLeft("gradAngle", v));
  const imageSlot = useImageUploadSlot(colorFolder, left.fillType === "image", (v) => setLeft("image", v));
  const frontTexSlot = useTextureGridSlot(colorFolder, left.faceTex, (v) => setLeft("faceTex", v), left.fillType === "texture");

  useOption(colorFolder, "Sides", FACE_FILL_OPTS, left.sideFill, (v) => setLeft("sideFill", v));
  const sideColorCtrl = useColor(colorFolder, "Side color", left.sideColor, (v) => setLeft("sideColor", v));
  const sideTexSlot = useTextureGridSlot(colorFolder, left.sideTex, (v) => setLeft("sideTex", v), left.sideFill === "texture");

  useOption(colorFolder, "Back", FACE_FILL_OPTS, left.backFill, (v) => setLeft("backFill", v));
  const backColorCtrl = useColor(colorFolder, "Back color", left.backColor, (v) => setLeft("backColor", v));
  const backTexSlot = useTextureGridSlot(colorFolder, left.backTex, (v) => setLeft("backTex", v), left.backFill === "texture");

  useToggle(colorFolder, "Outline", left.outlineOn, (v) => setLeft("outlineOn", v));
  const outlineColorCtrl = useColor(colorFolder, "Outline color", left.outlineColor, (v) => setLeft("outlineColor", v));
  const outlineWidthCtrl = useSlider(colorFolder, "Outline width", { min: 0.5, max: 12, step: 0.5 }, left.outlineWidth, (v) => setLeft("outlineWidth", v));

  // ── Conditional show/hide + enable/disable ───────────────────────────
  useEffect(() => {
    const grad = left.fillType === "gradient";
    frontColorCtrl?.setVisible(left.fillType === "solid");
    gradACtrl?.setVisible(grad);
    gradBCtrl?.setVisible(grad);
    gradAngleCtrl?.setVisible(grad || left.fillType === "rainbow");
    sideColorCtrl?.setVisible(left.sideFill === "solid");
    backColorCtrl?.setVisible(left.backFill === "solid");
    // Outline color/width stay MOUNTED (not hidden) — the "Outline" toggle
    // above them already names the section, so hiding+re-showing them under
    // a second "Outline" label would read as a redundant repeat. Grey them
    // out via the same disabled treatment lil-gui gives any dependent row.
    outlineColorCtrl?.setEnabled(left.outlineOn);
    outlineWidthCtrl?.setEnabled(left.outlineOn);
  }, [frontColorCtrl, gradACtrl, gradBCtrl, gradAngleCtrl, sideColorCtrl, backColorCtrl, outlineColorCtrl, outlineWidthCtrl, left.fillType, left.sideFill, left.backFill, left.outlineOn]);

  return (
    <>
      {caseAlignSlot}
      {imageSlot}
      {frontTexSlot}
      {sideTexSlot}
      {backTexSlot}
    </>
  );
}

/** One coordinate of a cubic Bézier P0..P3 at parameter t. */
function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const m = 1 - t;
  return m * m * m * p0 + 3 * m * m * t * p1 + 3 * m * t * t * p2 + t * t * t * p3;
}

/**
 * Mount a draggable cubic-bezier editor (the CSS easing curve) into `parent`.
 * P0=(0,0) and P3=(1,1) are fixed; the two control handles drive `setB`.
 * Returns a `redraw()` to resync the SVG when the value changes elsewhere.
 */
function mountBezierEditor(parent: HTMLElement, getB: () => Bezier4, setB: (b: Bezier4) => void): () => void {
  const NS = "http://www.w3.org/2000/svg";
  const W = 220, H = 150, pad = 16;
  const X = (x: number) => pad + x * (W - 2 * pad);
  const Y = (y: number) => (H - pad) - y * (H - 2 * pad);
  const el = (n: string, a: Record<string, string>) => {
    const e = document.createElementNS(NS, n);
    for (const k in a) e.setAttribute(k, a[k]);
    return e;
  };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "wa-bez" });
  const frame = el("rect", { x: `${X(0)}`, y: `${Y(1)}`, width: `${W - 2 * pad}`, height: `${H - 2 * pad}`, class: "wa-bez__frame" });
  const diag = el("line", { x1: `${X(0)}`, y1: `${Y(0)}`, x2: `${X(1)}`, y2: `${Y(1)}`, class: "wa-bez__diag" });
  const l1 = el("line", { class: "wa-bez__leg" });
  const l2 = el("line", { class: "wa-bez__leg" });
  const curve = el("path", { class: "wa-bez__curve" });
  const h1 = el("circle", { r: "5", class: "wa-bez__h" });
  const h2 = el("circle", { r: "5", class: "wa-bez__h" });
  svg.append(frame, diag, l1, l2, curve, h1, h2);
  parent.appendChild(svg);

  // `drawB` is the editor's live value; the SVG follows it every move (cheap),
  // but the mesh re-extrude (`setB`) is debounced so dragging stays smooth.
  let drawB: Bezier4 = getB();
  let active = 0;
  let timer = 0;
  const commit = (now: boolean) => {
    clearTimeout(timer);
    if (now) setB(drawB);
    else timer = window.setTimeout(() => setB(drawB), 130);
  };
  const render = () => {
    const [x1, y1, x2, y2] = drawB;
    let d = `M ${X(0)} ${Y(0)}`;
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      d += ` L ${X(cubicAt(0, x1, x2, 1, t))} ${Y(cubicAt(0, y1, y2, 1, t))}`;
    }
    curve.setAttribute("d", d);
    l1.setAttribute("x1", `${X(0)}`); l1.setAttribute("y1", `${Y(0)}`); l1.setAttribute("x2", `${X(x1)}`); l1.setAttribute("y2", `${Y(y1)}`);
    l2.setAttribute("x1", `${X(1)}`); l2.setAttribute("y1", `${Y(1)}`); l2.setAttribute("x2", `${X(x2)}`); l2.setAttribute("y2", `${Y(y2)}`);
    h1.setAttribute("cx", `${X(x1)}`); h1.setAttribute("cy", `${Y(y1)}`);
    h2.setAttribute("cx", `${X(x2)}`); h2.setAttribute("cy", `${Y(y2)}`);
  };

  const toData = (ev: PointerEvent): [number, number] => {
    const r = svg.getBoundingClientRect();
    const x = (((ev.clientX - r.left) / r.width) * W - pad) / (W - 2 * pad);
    const y = ((H - pad) - ((ev.clientY - r.top) / r.height) * H) / (H - 2 * pad);
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  };
  const move = (ev: PointerEvent) => {
    if (!active) return;
    const [x, y] = toData(ev);
    drawB = [...drawB] as Bezier4;
    if (active === 1) { drawB[0] = x; drawB[1] = y; } else { drawB[2] = x; drawB[3] = y; }
    render();
    commit(false);
  };
  const start = (handle: number, e: PointerEvent, target: SVGElement) => {
    active = handle;
    drawB = [...getB()] as Bezier4;
    target.setPointerCapture(e.pointerId);
  };
  h1.addEventListener("pointerdown", (e) => start(1, e as PointerEvent, h1 as SVGElement));
  h2.addEventListener("pointerdown", (e) => start(2, e as PointerEvent, h2 as SVGElement));
  svg.addEventListener("pointermove", move as EventListener);
  svg.addEventListener("pointerup", () => { if (active) { active = 0; commit(true); } });
  render();
  // External redraw (state changed elsewhere) — adopt it only when not dragging.
  return () => { if (!active) drawB = getB(); render(); };
}

// ── Dock option tables (module-level so identities are stable across renders) ──
const WEIGHT_OPTS: Record<string, number> = Object.fromEntries(
  [100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => [String(w), w]),
);
const CASE_OPTS: { value: string; label: string; title: string }[] = [
  { value: "as-typed", label: "Aa", title: "As typed" },
  { value: "upper", label: "AB", title: "UPPERCASE" },
  { value: "lower", label: "ab", title: "lowercase" },
  { value: "title", label: "Ab", title: "Title Case" },
];
const ALIGN_OPTS: { value: string; label: string; title: string }[] = [
  { value: "left", label: "L", title: "Left" },
  { value: "center", label: "C", title: "Center" },
  { value: "right", label: "R", title: "Right" },
];
const PROFILE_OPTS: Record<string, string> = {
  "Flat (slab)": "flat", Bevel: "bevel", "Round in": "round", "Round out": "roundup", "Custom curve": "custom",
};
const WARP_OPTS: Record<string, string> = {
  None: "none", "Arch up": "arch", "Arch down": "archDown", "Arc (circle)": "arc", Wave: "wave",
  Bulge: "bulge", "Cone (taper)": "cone", "Slant up": "slantUp", "Slant down": "slantDown",
};
const FILL_OPTS: Record<string, string> = { Solid: "solid", Gradient: "gradient", Rainbow: "rainbow", Texture: "texture", Image: "image" };
const FACE_FILL_OPTS: Record<string, string> = { Solid: "solid", Texture: "texture", None: "none" };

/**
 * Custom widget injected into the Shape folder via `useDockSlot` — the same
 * portal seam `/synth`'s `SynthDock` uses for its oscilloscope. The draggable
 * bezier curve editor has no lil-gui equivalent, so it renders as plain React
 * into a slot `<div>` lil-gui reserves for arbitrary content, positioned by
 * hook-call order relative to the surrounding `use*` controllers in the same
 * folder.
 */
function useBezierEditorSlot(folder: GUI | null, visible: boolean, bezier: Bezier4, onBezier: (b: Bezier4) => void): ReactNode {
  const host = useDockSlot(folder, { position: "bottom", className: "wa-widget-slot" });
  const bezierRef = useRef(bezier);
  bezierRef.current = bezier;
  const onBezierRef = useRef(onBezier);
  onBezierRef.current = onBezier;
  const redrawRef = useRef<() => void>(() => {});
  const mount = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    el.innerHTML = "";
    redrawRef.current = mountBezierEditor(el, () => bezierRef.current, (b) => onBezierRef.current(b));
  }, []);
  useEffect(() => { redrawRef.current(); }, [bezier]);
  if (!host) return null;
  return createPortal(<div className="wa-bezwrap" ref={mount} style={{ display: visible ? "" : "none" }} />, host);
}

/**
 * Right-hand Dock — 3D/scene knobs only: Shape (profile/warp), Layout
 * (extrusion + mesh geometry), Camera, Lighting. Typography and Color moved
 * to the left rail (plain React, see `RailSlider`/`RailSelect`/`SegmentedRow`
 * above) — this Dock never owned them conceptually, it just inherited the
 * old floating panel's full control set during the /synth-style restyle.
 * Built with the same `useFolder`/`useSlider`/`useOption`/`useColor`/
 * `useToggle`/`useText` primitives `/synth`'s `SynthDock` uses.
 */
function WordArtDock({
  gui, setGui, bezier, onBezier,
  effectState, effectDefinition, onEffectChange, onUpdateEffectSettings, onUpdateEffectParams,
}: {
  gui: GuiValues; setGui: (k: keyof GuiValues, v: number | string | boolean) => void;
  bezier: Bezier4; onBezier: (b: Bezier4) => void;
  effectState: GalleryEffectState;
  effectDefinition: GalleryEffectDefinition | null;
  onEffectChange: (effectId: GlyphEffectId | null) => void;
  onUpdateEffectSettings: (partial: Partial<Pick<GalleryEffectState, "blend" | "paused" | "timeScale">>) => void;
  onUpdateEffectParams: (partial: Record<string, GalleryEffectParamValue>) => void;
}): ReactNode {
  const dock = useDockGui();

  // ── Shape ─────────────────────────────────────────────────────────────
  const shapeFolder = useFolder(dock, "Shape", { open: true });
  useOption(shapeFolder, "Profile", PROFILE_OPTS, gui.profileMode, (v) => setGui("profileMode", v));
  const isCustom = gui.profileMode === "custom";
  const curveTextCtrl = useText(shapeFolder, "Curve", bezierToCss(bezier), (v) => {
    const p = parseBezier(v);
    if (p) onBezier(p);
  });
  const bezierSlot = useBezierEditorSlot(shapeFolder, isCustom, bezier, onBezier);
  useOption(shapeFolder, "Warp", WARP_OPTS, gui.warp, (v) => setGui("warp", v));
  const bendCtrl = useSlider(shapeFolder, "Bend", { min: 0, max: 1, step: 0.02 }, gui.bend, (v) => setGui("bend", v));

  // ── Layout ────────────────────────────────────────────────────────────
  const layoutFolder = useFolder(dock, "Layout", { open: true });
  useSlider(layoutFolder, "Depth", { min: 2, max: 80, step: 1 }, gui.depth, (v) => setGui("depth", v));
  useSlider(layoutFolder, "Scale X", { min: 40, max: 200, step: 1 }, gui.scaleX, (v) => setGui("scaleX", v));
  useSlider(layoutFolder, "Scale Y", { min: 40, max: 200, step: 1 }, gui.scaleY, (v) => setGui("scaleY", v));
  useSlider(layoutFolder, "Curve segments", { min: 1, max: 12, step: 1 }, gui.curveSegments, (v) => setGui("curveSegments", v));
  useSlider(layoutFolder, "Simplify", { min: 0, max: 8, step: 0.5 }, gui.simplify, (v) => setGui("simplify", v));
  const profileSegCtrl = useSlider(layoutFolder, "Edge segments", { min: 2, max: 10, step: 1 }, gui.profileSegments, (v) => setGui("profileSegments", v));
  useSlider(layoutFolder, "Layer offset", { min: 0, max: 32, step: 1 }, gui.offset, (v) => setGui("offset", v));
  useToggle(layoutFolder, "Flat layers", gui.layered, (v) => setGui("layered", v));

  // ── Render ────────────────────────────────────────────────────────────
  // Scene-wide ASCII resolution — same range/step as /synth's "Density"
  // (SynthWorkbench.tsx's `useSlider(stage, "Density", { min: 0.5, max: 4,
  // step: 0.1 }, …)`), independent of Shape/Layout's mesh geometry knobs.
  const renderFolder = useFolder(dock, "Render", { open: true });
  useOption<WordArtRenderMode>(renderFolder, "Render mode", RENDER_MODE_OPTIONS, gui.renderMode, (v) => setGui("renderMode", v));
  const charModeControl = useOption<WordArtCharMode>(renderFolder, "Character mode", CHAR_MODE_OPTIONS, gui.charMode, (v) => setGui("charMode", v));
  useEffect(() => {
    // Same gating as the gallery's Rendering folder: braille only encodes
    // wireframe mode, halfblock is the solid-mode mirror — both are a
    // documented no-op in ink, so the control dims outside wireframe/solid.
    charModeControl?.setEnabled(gui.renderMode === "wireframe" || gui.renderMode === "solid", { dim: true });
  }, [charModeControl, gui.renderMode]);
  const hiddenLinesControl = useOption<WordArtHiddenLines>(renderFolder, "Hidden lines", HIDDEN_LINES_OPTIONS, gui.hiddenLines, (v) => setGui("hiddenLines", v));
  useEffect(() => {
    // Depth-tests wireframe strokes (ASCII or braille) against a solid
    // surface prepass. No-op in solid/ink, so dim outside wireframe.
    hiddenLinesControl?.setEnabled(gui.renderMode === "wireframe", { dim: true });
  }, [hiddenLinesControl, gui.renderMode]);
  useSlider(renderFolder, "Density", { min: 0.5, max: 4, step: 0.1 }, gui.density, (v) => setGui("density", v));

  // ── Effects ───────────────────────────────────────────────────────────
  // Reuses the gallery's own Effects folder hook (`useEffectsFolder` +
  // `EffectParameterControls`, imported from `../Dock/folders/useEffectsFolder`)
  // instead of rebuilding the effect picker / auto-generated param controls.
  // Called directly (rather than via the `<DockEffects>` wrapper) so its
  // folder lands between Layout and Camera by hook-call order, matching every
  // other folder in this Dock.
  const effectsFolderInputs = {
    effectState,
    definition: effectDefinition,
    effectOptions: GALLERY_EFFECT_OPTIONS,
    onEffectChange,
    onUpdateSettings: onUpdateEffectSettings,
    onUpdateParams: onUpdateEffectParams,
  };
  const effectsFolder = useEffectsFolder(dock, effectsFolderInputs);

  // ── Camera ────────────────────────────────────────────────────────────
  const cameraFolder = useFolder(dock, "Camera", { open: false });
  useToggle(cameraFolder, "Perspective", gui.perspective, (v) => setGui("perspective", v));
  useSlider(cameraFolder, "Zoom", { min: 0.1, max: 6, step: 0.05 }, gui.zoom, (v) => setGui("zoom", v));
  useToggle(cameraFolder, "Auto-spin", gui.spin, (v) => setGui("spin", v));

  // ── Lighting ──────────────────────────────────────────────────────────
  const lightingFolder = useFolder(dock, "Lighting", { open: false });
  useSlider(lightingFolder, "Light", { min: 0, max: 2, step: 0.05 }, gui.light, (v) => setGui("light", v));
  useSlider(lightingFolder, "Ambient", { min: 0, max: 1, step: 0.05 }, gui.ambient, (v) => setGui("ambient", v));
  useSlider(lightingFolder, "Angle", { min: -90, max: 90, step: 1 }, gui.az, (v) => setGui("az", v));
  useSlider(lightingFolder, "Elev.", { min: 0, max: 90, step: 1 }, gui.el, (v) => setGui("el", v));
  useColor(lightingFolder, "Light color", gui.lightColor, (v) => setGui("lightColor", v));

  // ── Conditional show/hide (mirrors the original lil-gui .show()/.hide()) ──
  useEffect(() => {
    curveTextCtrl?.setVisible(isCustom);
    bendCtrl?.setVisible(gui.warp !== "none");
    profileSegCtrl?.setVisible(gui.profileMode.startsWith("round") || isCustom);
  }, [curveTextCtrl, bendCtrl, profileSegCtrl, isCustom, gui.warp, gui.profileMode]);

  return (
    <>
      {bezierSlot}
      <EffectParameterControls folder={effectsFolder} inputs={effectsFolderInputs} />
    </>
  );
}

/** Searchable font dropdown — filters the catalog as you type, styled list. */
function FontPicker({ catalog, value, onPick }: { catalog: FontEntry[]; value: string; onPick: (family: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setQuery(value); }, [value]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? catalog.filter((f) => f.family.toLowerCase().includes(q)) : catalog).slice(0, 80);
  }, [query, catalog]);
  useEffect(() => {
    const h = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, []);
  return (
    <div className="wa-fontpick" ref={wrapRef}>
      <input
        className="wa-input"
        type="text"
        spellCheck={false}
        placeholder={catalog.length ? `search ${catalog.length} fonts…` : "loading…"}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
      />
      {open && results.length > 0 && (
        <ul className="wa-fontpick__list">
          {results.map((f) => (
            <li
              key={f.id}
              className={`wa-fontpick__item ${f.family === value ? "is-active" : ""}`}
              onPointerDown={() => { onPick(f.family); setQuery(f.family); setOpen(false); }}
            >
              {f.family}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
