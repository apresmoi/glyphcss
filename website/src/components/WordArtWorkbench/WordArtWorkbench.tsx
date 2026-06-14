import { useEffect, useMemo, useRef, useState } from "react";
import {
  BASE_TILE,
  GlyphMesh,
  GlyphOrthographicCamera,
  GlyphPerspectiveCamera,
  GlyphScene,
} from "@glyphcss/react";
import type { Vec3 } from "@glyphcss/react";
import type { Polygon } from "@glyphcss/react";
import GUI from "lil-gui";
import { StatsOverlay } from "../StatsOverlay";
import {
  composeText,
  listGoogleFonts,
  loadFont,
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
import "./wordart.css";

type Align = "left" | "center" | "right";
type FillType = "solid" | "gradient" | "rainbow" | "texture" | "image";
type FaceFill = "solid" | "texture" | "none";
type Bezier4 = [number, number, number, number];

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
  /** CSS background for the preset tile thumbnail (defaults to `color`). */
  thumb?: string;
}

// Left-rail style presets — each is a full "look": extrusion, layered front/back,
// and/or a baked-in WordArt warp (like the builder's shape tiles).
const PRESETS: Preset[] = [
  { label: "Gold Gradient", profile: "bevel", depth: 26, color: "#ffd23f", sideColor: "#7c4a12",
    fill: "gradient", gradA: "#ffe14d", gradB: "#ff7a1a", gradAngle: 270, thumb: "linear-gradient(#ffe14d,#ff7a1a)" },
  { label: "Grape Pop", profile: "flat", depth: 5, color: "#b14be0", sideColor: "#7a8cff", backColor: "#8aa0ff", offset: 14, layered: true,
    fill: "gradient", gradA: "#c45cf0", gradB: "#7a1fb8", gradAngle: 270, thumb: "linear-gradient(#c45cf0,#7a1fb8)" },
  { label: "Chrome", profile: "bevel", depth: 22, color: "#d7dde4", sideColor: "#3a2222",
    fill: "gradient", gradA: "#f4f8ff", gradB: "#9a4b4b", gradAngle: 270, thumb: "linear-gradient(#f4f8ff 45%,#9a4b4b)" },
  { label: "Rainbow", profile: "flat", depth: 10, color: "#ff5e3a", sideColor: "#7a2a55",
    fill: "rainbow", gradAngle: 0, thumb: "linear-gradient(90deg,#ff3b30,#ffcc00,#34c759,#007aff,#af52de)" },
  { label: "Sky Outline", profile: "flat", depth: 8, color: "#7ec8ff", sideColor: "#2b50b0",
    outline: { color: "#1838b8", width: 3 }, thumb: "#7ec8ff" },
  { label: "Grass Block", profile: "flat", depth: 18, color: "#6ab04c", sideColor: "#6b4a2b",
    fill: "texture", faceTex: "grass3", sideTex: "dirt", thumb: "url(/textures/wordart/grass3.svg) center/cover" },
  { label: "Brick Wall", profile: "bevel", depth: 22, color: "#a8432a", sideColor: "#7a2f1d",
    fill: "texture", faceTex: "brick", sideTex: "brick2", thumb: "url(/textures/wordart/brick.svg) center/cover" },
  { label: "Stone", profile: "flat", depth: 20, color: "#8d8d8d", sideColor: "#5a5a5a",
    fill: "texture", faceTex: "rock", sideTex: "rock3", thumb: "url(/textures/wordart/rock.svg) center/cover" },
  { label: "Ice", profile: "bevel", depth: 18, color: "#b9e6ff", sideColor: "#6aa9cc",
    fill: "texture", faceTex: "ice", sideTex: "ice3", thumb: "url(/textures/wordart/ice.svg) center/cover" },
  { label: "Gold Bevel", profile: "bevel", depth: 26, color: "#d4a82a", sideColor: "#7c5e16" },
  { label: "Retro Block", profile: "flat", depth: 6, color: "#ff4d6d", sideColor: "#3a0ca3", backColor: "#3a0ca3", offset: 16, layered: true, thumb: "#ff4d6d" },
  { label: "Arch Gold", profile: "bevel", depth: 22, color: "#e9b949", sideColor: "#8a5a12", warp: { shape: "arch", amount: 0.6 } },
  { label: "Wave Mint", profile: "round", depth: 24, color: "#7cffb2", sideColor: "#2f8f5e", warp: { shape: "wave", amount: 0.55 } },
  { label: "Ink Shadow", profile: "flat", depth: 4, color: "#e8edf2", sideColor: "#2b313b", backColor: "#2b313b", offset: 12, layered: true, thumb: "#e8edf2" },
];

function applyCase(text: string, mode: "as-typed" | "upper" | "lower" | "title"): string {
  if (mode === "upper") return text.toUpperCase();
  if (mode === "lower") return text.toLowerCase();
  if (mode === "title") return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return text;
}

function readable(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "#000";
  const n = parseInt(m[1], 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 150 ? "#0b0f18" : "#ffffff";
}

function fitZoom(polygons: Polygon[], stageW: number, stageH: number, scaleX = 1, scaleY = 1): number {
  if (!polygons.length) return 0.06;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of polygons) {
    for (const v of p.vertices) {
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }
  }
  // Flat text: Y = width (screen-right), X = height (screen-down), Z = depth.
  // As the mesh turntables, width swings into depth, so fit the larger of the
  // two. Scale X/Y are applied as a CSS transform on the mesh (not baked), so
  // multiply the base bounds by them here to frame the *scaled* word — the
  // camera then compensates the wrapper scale, keeping the word framed and the
  // texture ~base resolution.
  const horizontal = Math.max((maxY - minY) * scaleX, maxZ - minZ);
  const vertical = (maxX - minX) * scaleY;
  const fitW = (stageW * 0.7) / (Math.max(horizontal, 1) * BASE_TILE);
  const fitH = (stageH * 0.68) / (Math.max(vertical, 1) * BASE_TILE);
  return Math.max(0.01, Math.min(0.2, Math.min(fitW, fitH)));
}

function codePenPayload(snapshotHtml: string, title: string): string {
  const parsed = new DOMParser().parseFromString(snapshotHtml, "text/html");
  const css = Array.from(parsed.querySelectorAll("style")).map((s) => s.textContent ?? "").filter(Boolean).join("\n\n");
  const html = parsed.body.innerHTML.trim() || snapshotHtml;
  return JSON.stringify({ title, html, css, editors: "100", layout: "left" });
}


// All controls persist to the URL query string so any look is a shareable link.
const URL_SEARCH = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
const qs = (k: string, d: string) => URL_SEARCH.get(k) ?? d;
const qn = (k: string, d: number) => (URL_SEARCH.has(k) ? Number(URL_SEARCH.get(k)) : d);
const qb = (k: string, d: boolean) => (URL_SEARCH.has(k) ? URL_SEARCH.get(k) === "1" : d);

export function WordArtWorkbench() {
  const [font, setFont] = useState<ParsedFont | null>(null);
  const [catalog, setCatalog] = useState<FontEntry[]>([]);
  const [entry, setEntry] = useState<FontEntry | null>(null);
  const [familyInput, setFamilyInput] = useState(() => qs("font", ""));
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
  const [perspective, setPerspective] = useState(() => qb("persp", false));
  const [zoomScale, setZoomScale] = useState(() => qn("zoom", 1));
  const [lightIntensity, setLightIntensity] = useState(() => qn("li", 0.95));
  const [ambient, setAmbient] = useState(() => qn("amb", 0.5));
  const [lightColor, setLightColor] = useState(() => qs("lc", "#ffffff"));
  const [lightAz, setLightAz] = useState(() => qn("laz", -25));
  const [lightEl, setLightEl] = useState(() => qn("lel", 45));
  const [activePreset, setActivePreset] = useState<string | null>(null);
  // Mobile: only one floating panel is open at a time, toggled by the bottom tabs.
  const [mobilePanel, setMobilePanel] = useState<"style" | "controls" | null>(null);


  useEffect(() => {
    if (!mobilePanel) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobilePanel(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobilePanel]);

  // Default bundled font + Google catalog. If the URL named a font, select it
  // once the catalog is in.
  useEffect(() => {
    loadFont("/fonts/default.ttf").then(setFont).catch((e) => setStatus(String(e)));
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
    if (entry) p.set("font", entry.family);
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
    const search = p.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
  }, [text, entry, weight, italic, textCase, scaleX, scaleY, profile, depth, letterSpacing, lineHeight, align, underline, strike, color, sideColor, backColor, offset, curveSegments, simplify, profileSegments, warpShape, warpAmount, spin, perspective, zoomScale, lightIntensity, ambient, lightColor, lightAz, lightEl, roundConvex, bezier, fillType, gradA, gradB, gradAngle, faceTex, sideFill, sideTex, backFill, backTex, outlineOn, outlineColor, outlineWidth, layered]);

  // Load the picked Google font whenever family / weight / style changes.
  useEffect(() => {
    if (!entry) return;
    let alive = true;
    setStatus(`loading ${entry.family}…`);
    loadGoogleFont(entry, weight, italic ? "italic" : "normal")
      .then((f) => {
        if (alive) {
          setFont(f);
          setStatus(`${entry.family} ${weight}${italic ? " italic" : ""}`);
        }
      })
      .catch((e) => alive && setStatus(`couldn't load ${entry.family}: ${e}`));
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
      // Scale X/Y are NOT baked here — they're a live CSS transform on the mesh
      // wrapper (so they stretch the whole block uniformly and need no recompute).
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

  // Live "dynamic-mode" preview for the affine sliders (scale X/Y, depth): while
  // dragging, we don't recompute geometry — we set a CSS scale3d on the mesh
  // wrapper (one var per axis, like dynamic lighting) and bake the real geometry
  // only on release. {1,1,1} = identity (nothing previewing).
  const [preview, setPreview] = useState<{ sx: number; sy: number; sz: number }>({ sx: 1, sy: 1, sz: 1 });

  // Directional light direction from azimuth (left/right) + elevation (height),
  // always biased toward the front so the face stays lit.
  const lightDir = useMemo<Vec3>(() => {
    const a = (lightAz * Math.PI) / 180;
    const e = (lightEl * Math.PI) / 180;
    return [Math.sin(e), Math.sin(a) * Math.cos(e), -Math.max(0.25, Math.cos(e))];
  }, [lightAz, lightEl]);

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

  const leftValues: LeftValues = {
    weight, italic, underline, strike, textCase, align, color, sideColor, backColor,
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

  // The Profile dropdown encodes edge shape only — colors now come from the
  // axial face stops, so there's no coverage to bundle in.
  const profileMode = profile === "flat" ? "flat"
    : profile === "custom" ? "custom"
    : profile === "round" ? (roundConvex ? "roundup" : "round")
    : "bevel";
  const guiValues: GuiValues = {
    layered,
    profileMode, warp: warpShape, bend: warpAmount,
    depth, letterSpacing, lineHeight, scaleX, scaleY,
    curveSegments, simplify, profileSegments, offset,
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
      case "letterSpacing": setLetterSpacing(v as number); break;
      case "lineHeight": setLineHeight(v as number); break;
      case "scaleX": setScaleX(v as number); break;
      case "scaleY": setScaleY(v as number); break;
      case "curveSegments": setCurveSegments(v as number); break;
      case "simplify": setSimplify(v as number); break;
      case "profileSegments": setProfileSegments(v as number); break;
      case "offset": setOffset(v as number); break;
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

  return (
    <div className="wa-root">
      <StatsOverlay />
      <Stage
        polygons={polygons}
        preview={preview}
        scaleXFrac={scaleX / 100}
        scaleYFrac={scaleY / 100}
        zoomScale={zoomScale}
        setZoomScale={setZoomScale}
        perspective={perspective}
        lightDir={lightDir}
        lightIntensity={lightIntensity}
        lightColor={lightColor}
        ambient={ambient}
        spin={spin}
        status={status}
      />

      <aside
        id="wa-style-panel"
        className={`wa-card wa-left ${mobilePanel === "style" ? "is-mobile-open" : ""}`}
        aria-label="Text and presets"
      >
        <div className="wa-card__body">
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

          <LeftGuiPanel values={leftValues} set={leftSet} />

          <div className="wa-section">Presets</div>
          <div className="wa-grid">
            {PRESETS.map((p) => (
              <button key={p.label} type="button" className={`wa-tile ${activePreset === p.label ? "is-active" : ""}`} onClick={() => applyPreset(p)}>
                <span className="wa-tile__thumb" style={{ background: p.thumb ?? p.color, color: readable(p.color) }}>Aa</span>
                <span className="wa-tile__label">{p.label}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <GuiPanel
        id="wa-controls-panel"
        className={mobilePanel === "controls" ? "is-mobile-open" : ""}
        values={guiValues}
        set={guiSet}
        onPreviewAxis={(axis, ratio) => setPreview((p) => ({ ...p, [axis]: ratio }))}
        bezier={bezier}
        onBezier={setBezier}
      />

      <nav className="wa-mobile-tabs" aria-label="WordArt panels">
        <button
          type="button"
          className={`wa-mobile-tabs__button ${mobilePanel === "style" ? "is-active" : ""}`}
          aria-controls="wa-style-panel"
          aria-expanded={mobilePanel === "style"}
          onClick={() => setMobilePanel((cur) => (cur === "style" ? null : "style"))}
        >
          Style
        </button>
        <button
          type="button"
          className={`wa-mobile-tabs__button ${mobilePanel === "controls" ? "is-active" : ""}`}
          aria-controls="wa-controls-panel"
          aria-expanded={mobilePanel === "controls"}
          onClick={() => setMobilePanel((cur) => (cur === "controls" ? null : "controls"))}
        >
          Controls
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

interface StageProps {
  polygons: Polygon[];
  preview: { sx: number; sy: number; sz: number };
  scaleXFrac: number;
  scaleYFrac: number;
  zoomScale: number;
  setZoomScale: (updater: (prev: number) => number) => void;
  perspective: boolean;
  lightDir: Vec3;
  lightIntensity: number;
  lightColor: string;
  ambient: number;
  spin: boolean;
  status: string;
}

/**
 * Isolated render surface. Auto-spin / drag drive the CAMERA rotation — glyphcss
 * projects geometry to an ASCII <pre>, so there's no CSS-3D wrapper to spin like
 * polycss. Kept small so the per-frame spin re-render doesn't touch the parent's
 * controls + 2000-option font datalist.
 */
function Stage({ polygons, preview, scaleXFrac, scaleYFrac, zoomScale, setZoomScale, perspective, lightDir, lightIntensity, lightColor, ambient, spin, status }: StageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 900, h: 600 });
  const [turn, setTurn] = useState(0); // Rx — turntable around screen-vertical (text up = world X)
  const [tilt, setTilt] = useState(14); // Ry — tilt/nod around screen-horizontal (world Y)
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

  // Auto-spin advances the camera's rotY each frame (paused while dragging).
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

  // Camera `zoom` is px-per-world-unit (zoom=1 → BASE_TILE). `fitZoom` frames
  // the word to the stage; `zoomScale` is the user multiplier.
  const centered = useMemo(() => centerMesh(polygons), [polygons]);
  // Auto-fit: glyphcss's grid cell size (autoSize) is unknown up front, so fit
  // empirically — after each render, read how much of the grid the word uses and
  // nudge `fitPx` (px-per-world-unit) until it fills ~82%. Converges in 1-2 frames.
  // Analytic auto-fit: px-per-world-unit derived from the grid size + the word's
  // WORLD bounds — never from the rendered text extent. So it's independent of
  // both zoomScale (the slider) and rotation; `zoomScale` then multiplies it
  // cleanly, matching polycss (0.1 → tiny, 1 → ~82% fill).
  const [fitPx, setFitPx] = useState(0.4);
  useEffect(() => {
    const pre = stageRef.current?.querySelector("pre.glyph-output");
    if (!pre || centered.length === 0) return;
    const lines = (pre.textContent || "").split("\n");
    const rows = lines.length;
    const cols = lines.reduce((m, l) => Math.max(m, l.length), 0);
    if (!rows || !cols) return;
    let exX = 0, exY = 0; // half-extents (mesh centered on origin)
    for (const p of centered) for (const v of p.vertices) {
      const ax = Math.abs(v[0]); if (ax > exX) exX = ax;
      const ay = Math.abs(v[1]); if (ay > exY) exY = ay;
    }
    const widthY = 2 * exY || 1, heightX = 2 * exX || 1;
    const cellAspect = (stage.h * cols) / (stage.w * rows) || 2;
    // ortho projection: col-span = Yextent·zoom·cellAspect, row-span = Xextent·zoom
    const fit = Math.min((0.82 * cols) / (widthY * cellAspect), (0.82 * rows) / heightX);
    if (Number.isFinite(fit) && fit > 0) setFitPx(fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centered, stage.w, stage.h]);
  const zoom = fitPx * zoomScale;
  const Cam = perspective ? GlyphPerspectiveCamera : GlyphOrthographicCamera;

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
          style={{ width: "100%", height: "100%" }}
          directionalLight={{ direction: lightDir, intensity: lightIntensity, color: lightColor }}
          ambientLight={{ intensity: ambient }}
        >
          <GlyphMesh polygons={centered} rotation={[turn, tilt, 0]} scale={[scaleXFrac, scaleYFrac, preview.sz]} />
        </GlyphScene>
      </Cam>
      <div className="wa-stage-foot">
        {polygons.length.toLocaleString()} polygons{status ? ` · ${status}` : ""}
      </div>
    </div>
  );
}

interface GuiValues {
  layered: boolean;
  profileMode: string; warp: string; bend: number;
  depth: number; letterSpacing: number; lineHeight: number; scaleX: number; scaleY: number;
  curveSegments: number; simplify: number; profileSegments: number; offset: number;
  perspective: boolean; zoom: number; spin: boolean;
  light: number; ambient: number; az: number; el: number; lightColor: string;
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

/**
 * Right-hand control panel built with the SAME library the /gallery uses
 * (lil-gui), themed with the gallery's exact CSS variables — so the controls
 * are identical, not a CSS approximation. lil-gui is imperative, so we mount it
 * once and bridge its onChange → React, and React state → updateDisplay().
 */
function GuiPanel({ id, className = "", values, set, onPreviewAxis, bezier, onBezier }: { id?: string; className?: string; values: GuiValues; set: (k: keyof GuiValues, v: number | string | boolean) => void; onPreviewAxis: (axis: "sx" | "sy" | "sz", ratio: number) => void; bezier: Bezier4; onBezier: (b: Bezier4) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Current committed values, read inside the (mount-once) GUI callbacks so the
  // live-preview ratio is taken against the value at drag start.
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const onPreviewAxisRef = useRef(onPreviewAxis);
  onPreviewAxisRef.current = onPreviewAxis;
  // True while an affine slider is mid-drag (preview mode). The values→GUI
  // write-back below is skipped then, so it can't reset the control the user is
  // dragging back to the (not-yet-committed) value.
  const previewDragRef = useRef(false);
  const cfgRef = useRef<GuiValues>({ ...values });
  const ctrlRef = useRef<Record<string, ReturnType<GUI["add"]>>>({});
  const bezierRef = useRef(bezier);
  const onBezierRef = useRef(onBezier);
  const bezUiRef = useRef<{ wrap: HTMLElement; input: HTMLInputElement; redraw: () => void } | null>(null);

  useEffect(() => {
    const cfg = cfgRef.current;
    const c = ctrlRef.current;
    const gui = new GUI({ container: hostRef.current!, title: "Settings", width: 300 });
    const on = (k: keyof GuiValues) => (v: number | string | boolean) => set(k, v);

    // Tier-1 "dynamic mode": while dragging an affine slider, only set a CSS
    // scale3d ratio on the wrapper (no geometry recompute). On release we commit
    // the real value but DON'T reset the preview here — the mesh holds the old
    // frame until the new atlas is decoded (atomicAtlas) and fires onFrameReady,
    // which resets the preview so the swap is seamless (no backward flash).
    const previewAxis = (k: keyof GuiValues, axis: "sx" | "sy" | "sz") => (v: number | string | boolean) => {
      previewDragRef.current = true;
      const base = (valuesRef.current[k] as number) || 1;
      onPreviewAxisRef.current(axis, ((v as number) / base) || 1);
    };
    const bake = (k: keyof GuiValues) => (v: number | string | boolean) => {
      previewDragRef.current = false;
      set(k, v);
    };

    const shape = gui.addFolder("Shape");
    c.profileMode = shape.add(cfg, "profileMode", {
      "Flat (slab)": "flat",
      "Bevel": "bevel",
      "Round in": "round",
      "Round out": "roundup",
      "Custom curve": "custom",
    }).name("Profile").onChange(on("profileMode"));

    // Custom-profile curve: a CSS cubic-bezier() text field + a draggable editor
    // (shown only for the Custom profile). Both drive the `bezier` prop.
    c.bezierText = shape.add({ _: "" }, "_").name("Curve");
    {
      const widget = c.bezierText.domElement.querySelector<HTMLElement>(".widget");
      const wrap = document.createElement("div");
      wrap.className = "wa-bezwrap";
      let input = document.createElement("input");
      if (widget) {
        widget.replaceChildren();
        input.type = "text";
        input.className = "wa-input wa-bezinput";
        input.spellcheck = false;
        input.addEventListener("change", () => {
          const parsed = parseBezier(input.value);
          if (parsed) onBezierRef.current(parsed);
        });
        widget.appendChild(input);
      }
      shape.domElement.querySelector(".children")?.appendChild(wrap);
      const redraw = mountBezierEditor(wrap, () => bezierRef.current, (b) => onBezierRef.current(b));
      bezUiRef.current = { wrap, input, redraw };
    }

    c.warp = shape.add(cfg, "warp", { None: "none", "Arch up": "arch", "Arch down": "archDown", "Arc (circle)": "arc", Wave: "wave", Bulge: "bulge", "Cone (taper)": "cone", "Slant up": "slantUp", "Slant down": "slantDown" }).name("Warp").onChange(on("warp"));
    // Tier-3 (changes poly count / non-linear): no live recompute — bake on release.
    c.bend = shape.add(cfg, "bend", 0, 1, 0.02).name("Bend").onFinishChange(on("bend"));

    const layout = gui.addFolder("Layout");
    // Tier-1 (affine): live CSS scale preview while dragging, bake on release.
    c.depth = layout.add(cfg, "depth", 2, 80, 1).name("Depth").onChange(previewAxis("depth", "sz")).onFinishChange(bake("depth"));
    c.letterSpacing = layout.add(cfg, "letterSpacing", -20, 60, 1).name("Letter spacing").onFinishChange(on("letterSpacing"));
    c.lineHeight = layout.add(cfg, "lineHeight", 0.8, 2.5, 0.05).name("Line height").onFinishChange(on("lineHeight"));
    // Scale X/Y just update state → a live CSS wrapper transform (no recompute).
    c.scaleX = layout.add(cfg, "scaleX", 40, 200, 1).name("Scale X").onChange(on("scaleX"));
    c.scaleY = layout.add(cfg, "scaleY", 40, 200, 1).name("Scale Y").onChange(on("scaleY"));
    c.curveSegments = layout.add(cfg, "curveSegments", 1, 12, 1).name("Curve segments").onFinishChange(on("curveSegments"));
    c.simplify = layout.add(cfg, "simplify", 0, 8, 0.5).name("Simplify").onFinishChange(on("simplify"));
    c.profileSegments = layout.add(cfg, "profileSegments", 2, 10, 1).name("Edge segments").onFinishChange(on("profileSegments"));
    c.offset = layout.add(cfg, "offset", 0, 32, 1).name("Layer offset").onFinishChange(on("offset"));
    c.layered = layout.add(cfg, "layered").name("Flat layers").onChange(on("layered"));

    const cam = gui.addFolder("Camera");
    c.perspective = cam.add(cfg, "perspective").name("Perspective").onChange(on("perspective"));
    c.zoom = cam.add(cfg, "zoom", 0.1, 6, 0.05).name("Zoom").onChange(on("zoom"));
    c.spin = cam.add(cfg, "spin").name("Auto-spin").onChange(on("spin"));

    const lighting = gui.addFolder("Lighting");
    c.light = lighting.add(cfg, "light", 0, 2, 0.05).name("Light").onChange(on("light"));
    c.ambient = lighting.add(cfg, "ambient", 0, 1, 0.05).name("Ambient").onChange(on("ambient"));
    c.az = lighting.add(cfg, "az", -90, 90, 1).name("Angle").onChange(on("az"));
    c.el = lighting.add(cfg, "el", 0, 90, 1).name("Elev.").onChange(on("el"));
    c.lightColor = lighting.addColor(cfg, "lightColor").name("Light color").onChange(on("lightColor"));

    return () => gui.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push React state back into the GUI display + toggle conditional controllers.
  useEffect(() => {
    // Skip the write-back mid preview-drag so it can't reset the dragged control.
    if (!previewDragRef.current) {
      Object.assign(cfgRef.current, values);
      for (const ctrl of Object.values(ctrlRef.current)) ctrl?.updateDisplay();
    }
    bezierRef.current = bezier;
    onBezierRef.current = onBezier;
    const isCustom = values.profileMode.startsWith("custom");
    ctrlRef.current.bend?.[values.warp !== "none" ? "show" : "hide"]();
    ctrlRef.current.profileSegments?.[(values.profileMode.startsWith("round") || isCustom) ? "show" : "hide"]();
    ctrlRef.current.bezierText?.[isCustom ? "show" : "hide"]();
    if (bezUiRef.current) {
      bezUiRef.current.wrap.style.display = isCustom ? "" : "none";
      bezUiRef.current.redraw();
      if (document.activeElement !== bezUiRef.current.input) bezUiRef.current.input.value = bezierToCss(bezier);
    }
  });

  return <div id={id} className={`wa-gui ${className}`} ref={hostRef} />;
}

interface LeftValues {
  weight: number; italic: boolean; underline: boolean; strike: boolean;
  textCase: string; align: string; color: string; sideColor: string; backColor: string;
  fillType: string; gradA: string; gradB: string; gradAngle: number; image: string;
  faceTex: string; sideFill: string; sideTex: string; backFill: string; backTex: string;
  outlineOn: boolean; outlineColor: string; outlineWidth: number;
}

/** lil-gui typography + color panel for the left card (blends in, borderless). */
function LeftGuiPanel({ values, set }: { values: LeftValues; set: (k: keyof LeftValues, v: number | string | boolean) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cfgRef = useRef<LeftValues>({ ...values });
  const ctrlRef = useRef<Record<string, ReturnType<GUI["add"]>>>({});
  const segRef = useRef<Record<string, (v: string) => void>>({});
  const texRef = useRef<Record<string, (v: string) => void>>({});
  const texWrapRef = useRef<Record<string, HTMLElement>>({});

  useEffect(() => {
    const cfg = cfgRef.current;
    const c = ctrlRef.current;
    const gui = new GUI({ container: hostRef.current!, title: "", width: 300 });
    const on = (k: keyof LeftValues) => (v: number | string | boolean) => set(k, v);

    // Inject a segmented button-group into a lil-gui row's widget (lil-gui has
    // no native one — the gallery injects custom widgets the same way).
    const segmented = (folder: GUI, name: string, key: keyof LeftValues, options: [string, string, string][]) => {
      const ctrl = folder.add({ _: "" }, "_").name(name);
      const widget = ctrl.domElement.querySelector<HTMLElement>(".widget");
      if (!widget) return;
      widget.replaceChildren();
      widget.classList.add("wa-seg");
      const btns: Record<string, HTMLButtonElement> = {};
      for (const [value, label, title] of options) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.title = title;
        btn.addEventListener("click", () => set(key, value));
        widget.appendChild(btn);
        btns[value] = btn;
      }
      segRef.current[key] = (v: string) => {
        for (const k in btns) btns[k].classList.toggle("is-on", k === v);
      };
    };

    const type = gui.addFolder("Type");
    c.weight = type.add(cfg, "weight", [100, 200, 300, 400, 500, 600, 700, 800, 900]).name("Weight").onChange(on("weight"));
    c.italic = type.add(cfg, "italic").name("Italic").onChange(on("italic"));
    c.underline = type.add(cfg, "underline").name("Underline").onChange(on("underline"));
    c.strike = type.add(cfg, "strike").name("Strikethrough").onChange(on("strike"));
    segmented(type, "Case", "textCase", [["as-typed", "Aa", "As typed"], ["upper", "AB", "UPPERCASE"], ["lower", "ab", "lowercase"], ["title", "Ab", "Title Case"]]);
    segmented(type, "Align", "align", [["left", "L", "Left"], ["center", "C", "Center"], ["right", "R", "Right"]]);

    // Each face (front / sides / back) has its own fill-type selector that
    // generates the matching input below it.
    const col = gui.addFolder("Color");
    const colChildren = col.domElement.querySelector(".children");

    // A grid of bundled block-texture swatches injected into the folder
    // (lil-gui has no image picker). Shown only when that face is in Texture mode.
    const texGrid = (key: keyof LeftValues) => {
      const wrap = document.createElement("div");
      wrap.className = "wa-texrow";
      const grid = document.createElement("div");
      grid.className = "wa-texgrid";
      wrap.append(grid);
      const swatches: Record<string, HTMLButtonElement> = {};
      for (const t of TEXTURES) {
        const sw = document.createElement("button");
        sw.type = "button";
        sw.className = "wa-texgrid__sw";
        sw.title = t.label;
        sw.style.backgroundImage = `url(${texUrl(t.id)})`;
        sw.addEventListener("click", () => set(key, t.id));
        grid.appendChild(sw);
        swatches[t.id] = sw;
      }
      colChildren?.appendChild(wrap);
      texRef.current[key] = (v: string) => {
        for (const id in swatches) swatches[id].classList.toggle("is-on", id === v);
      };
      texWrapRef.current[key] = wrap;
    };

    // Front — the full fill set.
    c.fillType = col.add(cfg, "fillType", { Solid: "solid", Gradient: "gradient", Rainbow: "rainbow", Texture: "texture", Image: "image" }).name("Front").onChange(on("fillType"));
    c.color = col.addColor(cfg, "color").name("Color").onChange(on("color"));
    c.gradA = col.addColor(cfg, "gradA").name("Color A").onChange(on("gradA"));
    c.gradB = col.addColor(cfg, "gradB").name("Color B").onChange(on("gradB"));
    c.gradAngle = col.add(cfg, "gradAngle", 0, 360, 5).name("Angle").onChange(on("gradAngle"));
    // lil-gui has no file input — inject a "Choose image" button that reads the
    // picked file as a data URL (the renderer uses it as a background-image).
    c.image = col.add({ _: "" }, "_").name("Image");
    {
      const widget = c.image.domElement.querySelector<HTMLElement>(".widget");
      if (widget) {
        widget.replaceChildren();
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "wa-imgbtn";
        btn.textContent = "Choose image…";
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";
        input.style.display = "none";
        btn.addEventListener("click", () => input.click());
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => set("image", String(reader.result));
          reader.readAsDataURL(file);
        });
        widget.append(btn, input);
      }
    }
    texGrid("faceTex");

    // Sides — solid color or block texture.
    c.sideFill = col.add(cfg, "sideFill", { Solid: "solid", Texture: "texture", None: "none" }).name("Sides").onChange(on("sideFill"));
    c.sideColor = col.addColor(cfg, "sideColor").name("Color").onChange(on("sideColor"));
    texGrid("sideTex");

    // Back — solid color or block texture.
    c.backFill = col.add(cfg, "backFill", { Solid: "solid", Texture: "texture", None: "none" }).name("Back").onChange(on("backFill"));
    c.backColor = col.addColor(cfg, "backColor").name("Color").onChange(on("backColor"));
    texGrid("backTex");

    c.outlineOn = col.add(cfg, "outlineOn").name("Outline").onChange(on("outlineOn"));
    c.outlineColor = col.addColor(cfg, "outlineColor").name("Outline color").onChange(on("outlineColor"));
    c.outlineWidth = col.add(cfg, "outlineWidth", 0.5, 12, 0.5).name("Outline width").onChange(on("outlineWidth"));

    return () => gui.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    Object.assign(cfgRef.current, values);
    for (const ctrl of Object.values(ctrlRef.current)) ctrl?.updateDisplay();
    segRef.current.textCase?.(values.textCase);
    segRef.current.align?.(values.align);
    // Show only the input that matches each face's selected fill mode.
    const grad = values.fillType === "gradient";
    ctrlRef.current.color?.[values.fillType === "solid" ? "show" : "hide"]();
    ctrlRef.current.gradA?.[grad ? "show" : "hide"]();
    ctrlRef.current.gradB?.[grad ? "show" : "hide"]();
    ctrlRef.current.gradAngle?.[grad || values.fillType === "rainbow" ? "show" : "hide"]();
    ctrlRef.current.image?.[values.fillType === "image" ? "show" : "hide"]();
    texWrapRef.current.faceTex?.style.setProperty("display", values.fillType === "texture" ? "" : "none");
    ctrlRef.current.sideColor?.[values.sideFill === "solid" ? "show" : "hide"]();
    texWrapRef.current.sideTex?.style.setProperty("display", values.sideFill === "texture" ? "" : "none");
    ctrlRef.current.backColor?.[values.backFill === "solid" ? "show" : "hide"]();
    texWrapRef.current.backTex?.style.setProperty("display", values.backFill === "texture" ? "" : "none");
    ctrlRef.current.outlineColor?.[values.outlineOn ? "show" : "hide"]();
    ctrlRef.current.outlineWidth?.[values.outlineOn ? "show" : "hide"]();
    texRef.current.faceTex?.(values.faceTex);
    texRef.current.sideTex?.(values.sideTex);
    texRef.current.backTex?.(values.backTex);
  });

  return <div className="wa-gui wa-gui--inline" ref={hostRef} />;
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