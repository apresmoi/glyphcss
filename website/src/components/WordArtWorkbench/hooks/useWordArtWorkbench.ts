import type { GlyphEffectId } from "@glyphcss/effects";
import {
  type BackFace,
  type ExtrudeProfile,
  type Face,
  type FaceFillSpec,
  type FontEntry,
  type ParsedFont,
  type Profile,
  type WarpShape,
  composeText,
  listGoogleFonts,
  loadGoogleFont,
  pickWeight,
  resolveFace,
} from "@glyphcss/fonts";
import type { Polygon, Vec3 } from "@glyphcss/react";
import type { CompileSceneResult } from "glyphcss";
import { encodeStaticGlyphHtml, injectGlyphBaseStyles } from "glyphcss";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type GalleryEffectDefinition,
  DEFAULT_GALLERY_EFFECT_STATE,
  createGalleryEffectState,
  galleryEffectDefinition,
  galleryEffectExportName,
  sanitizeGalleryEffectParams,
} from "../../../features/gallery/model/effects";
import type { GalleryEffectParamValue, GalleryEffectState } from "../../../features/gallery/model/types";
import type {
  WordArtComposeInput,
  WordArtFaceSpec,
  WordArtFontSpec,
  WordArtProfileSpec,
  WordArtSnippetInput,
} from "../../../features/wordart/export/wordartSnippets";
import { buildWordArtCodepenPen } from "../../../features/wordart/export/wordartSnippets";
import {
  type Align,
  type Bezier4,
  type FaceFill,
  type FillType,
  type GuiValues,
  type LeftValues,
  type Preset,
  type WordArtCharMode,
  type WordArtHiddenLines,
  type WordArtRenderMode,
  PRESETS,
  ROBOTO_FONT_ENTRY,
  applyCase,
  texUrl,
} from "../../../features/wordart/model/parameters";
import { type WordArtUrlState, WORD_ART_DEFAULTS } from "../../../features/wordart/model/urlState";
import { wordArtEffectStateFromUrlState } from "../../../features/wordart/services/effectsState";
import { initialWordArtState, qs } from "../../../features/wordart/services/initialState";
import { writeWordArtUrlState } from "../../../features/wordart/services/wordartUrlState";
import { extractAsciiFromPre } from "../../../services/export/asciiClipboard";
import { downloadGlyphSvg } from "../../../services/export/glyphSvgExport";
import { renderPresetTile } from "../WordArtPresetTile";

export function useWordArtWorkbench() {
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

  const [familyInput, setFamilyInput] = useState(() => qs("font"));

  const [weight, setWeight] = useState(() => qs("weight"));

  const [italic, setItalic] = useState(() => qs("italic"));

  const [text, setText] = useState(() => qs("text"));

  const [textCase, setTextCase] = useState<"as-typed" | "upper" | "lower" | "title">(() => qs("textCase"));

  const [scaleX, setScaleX] = useState(() => qs("scaleX"));

  const [scaleY, setScaleY] = useState(() => qs("scaleY"));

  const [profile, setProfile] = useState<ExtrudeProfile>(() => qs("profile"));

  const [roundConvex, setRoundConvex] = useState(() => qs("roundConvex"));

  const [bezier, setBezier] = useState<Bezier4>(() => qs("bezier"));

  const [depth, setDepth] = useState(() => qs("depth"));

  const [letterSpacing, setLetterSpacing] = useState(() => qs("letterSpacing"));

  const [lineHeight, setLineHeight] = useState(() => qs("lineHeight"));

  const [align, setAlign] = useState<Align>(() => qs("align"));

  const [underline, setUnderline] = useState(() => qs("underline"));

  const [strike, setStrike] = useState(() => qs("strike"));

  const [color, setColor] = useState(() => qs("color"));

  const [sideColor, setSideColor] = useState(() => qs("sideColor"));

  const [backColor, setBackColor] = useState(() => qs("backColor"));

  const [offset, setOffset] = useState(() => qs("offset"));

  const [curveSegments, setCurveSegments] = useState(() => qs("curveSegments"));

  const [simplify, setSimplify] = useState(() => qs("simplify"));

  const [profileSegments, setProfileSegments] = useState(() => qs("profileSegments"));

  const [warpShape, setWarpShape] = useState<WarpShape>(() => qs("warpShape"));

  const [warpAmount, setWarpAmount] = useState(() => qs("warpAmount"));

  const [spin, setSpin] = useState(() => qs("spin"));

  // Face fill (solid / gradient / rainbow / image), outline, flat-layer shadow.
  const [fillType, setFillType] = useState<FillType>(() => qs("fillType"));

  const [gradA, setGradA] = useState(() => qs("gradA"));

  const [gradB, setGradB] = useState(() => qs("gradB"));

  const [gradAngle, setGradAngle] = useState(() => qs("gradAngle"));

  const [fillImage, setFillImage] = useState("");

  const [faceTex, setFaceTex] = useState(() => qs("faceTex"));

  const [sideFill, setSideFill] = useState<FaceFill>(() => qs("sideFill"));

  const [sideTex, setSideTex] = useState(() => qs("sideTex"));

  const [backFill, setBackFill] = useState<FaceFill>(() => qs("backFill"));

  const [backTex, setBackTex] = useState(() => qs("backTex"));

  const [outlineOn, setOutlineOn] = useState(() => qs("outlineOn"));

  const [outlineColor, setOutlineColor] = useState(() => qs("outlineColor"));

  const [outlineWidth, setOutlineWidth] = useState(() => qs("outlineWidth"));

  const [layered, setLayered] = useState(() => qs("layered"));

  // Camera + lighting (gallery-style)
  const [perspective, setPerspective] = useState(() => qs("perspective"));

  const [zoomScale, setZoomScale] = useState(() => qs("zoomScale"));

  // State, not a ref: StatsOverlay mounts imperatively into this element, and
  // a ref mutation would not re-run its effect.
  const [stageHost, setStageHost] = useState<HTMLElement | null>(null);

  // Viewing angle lives here, not in <Stage>, so the URL effect below can see
  // it. Dragging rotates the MESH (see <Stage>) — the camera stays pinned.
  const [turn, setTurn] = useState(() => qs("turn"));

  const [tilt, setTilt] = useState(() => qs("tilt"));

  // Scene-wide ASCII resolution (mirrors /synth's Density): drives the
  // GlyphScene host's font-size (BASE_FONT_PX ÷ density) — smaller cell = more
  // columns/rows in the same on-screen box (zoom is CSS px/world-unit,
  // independent of font size — see `fitWordArtZoom`). Same technique
  // `SynthWorkbench`'s `host.style.fontSize` uses, just via the React
  // `<GlyphScene style>` prop instead of an imperative host ref (glyphcss/react
  // has no scene-wide `fontSize` option — only the per-mesh detail-layer one).
  const [density, setDensity] = useState(() => qs("density"));

  const [renderMode, setRenderMode] = useState<WordArtRenderMode>(() => qs("renderMode"));

  const [charMode, setCharMode] = useState<WordArtCharMode>(() => qs("charMode"));

  const [hiddenLines, setHiddenLines] = useState<WordArtHiddenLines>(() => qs("hiddenLines"));

  // `colorEncoding: "atlas"` (zero-`<span>` colour-font output). The user's
  // on/off preference is persisted; `atlasReason` is NOT — it's derived at
  // runtime from the live rendered output (see `AtlasAvailabilityWatcher`
  // below). The palette itself is never page state: `createGlyphScene`
  // derives and pools it internally.
  const [colorEncoding, setColorEncoding] = useState<"spans" | "atlas">(() => qs("colorEncoding"));

  const [atlasReason, setAtlasReason] = useState<string | null>("Nothing rendered yet.");

  const [lightIntensity, setLightIntensity] = useState(() => qs("lightIntensity"));

  const [ambient, setAmbient] = useState(() => qs("ambient"));

  const [lightColor, setLightColor] = useState(() => qs("lightColor"));

  const [lightAz, setLightAz] = useState(() => qs("lightAz"));

  const [lightEl, setLightEl] = useState(() => qs("lightEl"));

  // Glyph Effects layer (gallery-style): same state shape, same
  // `scene.addEffectLayer`-backed `<GlyphEffectLayer>` wiring, just applied to
  // the word-art mesh instead of a dropped model.
  const [effectState, setEffectState] = useState<GalleryEffectState>(() =>
    wordArtEffectStateFromUrlState(initialWordArtState),
  );

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

  const [stageSnapshot, setStageSnapshot] = useState<{ rotation: Vec3; zoom: number }>({
    rotation: [0, 14, 0],
    zoom: 3,
  });

  // "Copy ASCII" (bottom-left export bar, next to "Open in CodePen"/"Export")
  // copies the rendered ART ITSELF as plain text — distinct from
  // `WordArtCodePanel`'s own "Copy" button, which copies a generated CODE
  // snippet. Same `.wa-stage pre.glyph-output` scoping
  // `handleExportCodepenStatic` already uses below (the preset tiles render
  // their own `pre.glyph-output` outside `.wa-stage`, so this selector can't
  // pick one of those up). `extractAsciiFromPre` reads `textContent` (no
  // `<span>` markup) and trims each line's trailing grid-padding while
  // preserving the art's own leading offset. Mirrors `SynthWorkbench`'s
  // `copyState` idiom, including the explicit "error" state for a denied
  // clipboard permission.
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const handleCopyAscii = useCallback(async () => {
    const pre = document.querySelector(".wa-stage pre.glyph-output") as HTMLElement | null;
    const text = extractAsciiFromPre(pre);
    if (text === null) {
      setCopyState("error");
      setTimeout(() => setCopyState("idle"), 1500);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 1500);
  }, []);

  // "Download SVG" (bottom-left export bar, next to "Copy ASCII") ships the
  // currently rendered glyph output as a standalone SVG file — one <text>
  // element per colour run (via `glyphSvgExport.ts`, shared with /synth),
  // not a screenshot. Same scoping/idiom as `handleCopyAscii` above,
  // including the explicit "error" state.
  const [svgState, setSvgState] = useState<"idle" | "downloaded" | "error">("idle");

  const handleDownloadSvg = useCallback(() => {
    const pre = document.querySelector(".wa-stage pre.glyph-output") as HTMLElement | null;
    const slug =
      text
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "")
        .slice(0, 40) || "untitled";
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const ok = downloadGlyphSvg(pre, `glyphcss-wordart-${slug}-${stamp}.svg`);
    setSvgState(ok ? "downloaded" : "error");
    setTimeout(() => setSvgState("idle"), 1500);
  }, [text]);

  useEffect(() => {
    if (!mobilePanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobilePanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobilePanel]);

  // `.glyph-output` (the compiled preset tiles below use it directly, with no
  // `<glyph-scene>` ancestor) needs the base stylesheet present — the live
  // Stage's GlyphScene injects it too, but do it here explicitly so the tiles
  // don't depend on mount order.
  useEffect(() => {
    injectGlyphBaseStyles();
  }, []);

  // Google font catalog (Roboto — `entry`'s initial state — is already
  // loading via the effect below). If the URL named a different font, select
  // it once the catalog is in.
  useEffect(() => {
    listGoogleFonts()
      .then((c) => {
        setCatalog(c);
        const wanted = qs("font").trim().toLowerCase();
        if (wanted && wanted !== "roboto") {
          const f = c.find((e) => e.family.toLowerCase() === wanted);
          if (f) setEntry(f);
        }
      })
      .catch(() => {});
  }, []);

  // Persist every control to a single packed `?w=` param (non-defaults only,
  // for short links) — see wordartUrlState.ts (shared codec).
  useEffect(() => {
    const state: WordArtUrlState = {
      text,
      font: entry.family,
      weight,
      italic,
      textCase,
      scaleX,
      scaleY,
      profile,
      roundConvex,
      bezier,
      depth,
      letterSpacing,
      lineHeight,
      align,
      underline,
      strike,
      color,
      sideColor,
      backColor,
      offset,
      curveSegments,
      simplify,
      profileSegments,
      warpShape,
      warpAmount,
      spin,
      perspective,
      zoomScale,
      // `turn` is skipped while `spin` animates (falls back to the default so
      // it's omitted from the packed state), or the turntable would rewrite
      // the URL every frame. Rounded to 0.1deg — a drag emits hundreds of
      // updates and full float precision would bloat every shared link.
      turn: spin ? WORD_ART_DEFAULTS.turn : Math.round(turn * 10) / 10,
      tilt: Math.round(tilt * 10) / 10,
      density,
      renderMode,
      charMode,
      hiddenLines,
      colorEncoding,
      lightIntensity,
      ambient,
      lightColor,
      lightAz,
      lightEl,
      fillType,
      gradA,
      gradB,
      gradAngle,
      faceTex,
      sideFill,
      sideTex,
      backFill,
      backTex,
      outlineOn,
      outlineColor,
      outlineWidth,
      layered,
      // Placeholders — writeWordArtUrlState folds in the real effect fields
      // from `effectState` below (mirrors the gallery's `fx*` shape).
      effectId: "",
      effectBlend: "replace",
      effectPaused: false,
      effectTimeScale: 1,
      effectParams: "",
    };
    writeWordArtUrlState(state, effectState);
  }, [
    text,
    entry,
    weight,
    italic,
    textCase,
    scaleX,
    scaleY,
    profile,
    depth,
    letterSpacing,
    lineHeight,
    align,
    underline,
    strike,
    color,
    sideColor,
    backColor,
    offset,
    curveSegments,
    simplify,
    profileSegments,
    warpShape,
    warpAmount,
    spin,
    perspective,
    zoomScale,
    turn,
    tilt,
    density,
    renderMode,
    charMode,
    hiddenLines,
    colorEncoding,
    lightIntensity,
    ambient,
    lightColor,
    lightAz,
    lightEl,
    roundConvex,
    bezier,
    fillType,
    gradA,
    gradB,
    gradAngle,
    faceTex,
    sideFill,
    sideTex,
    backFill,
    backTex,
    outlineOn,
    outlineColor,
    outlineWidth,
    layered,
    effectState,
  ]);

  // Load the picked Google font (Roboto by default) whenever family / weight
  // / style changes. The first font to resolve also pins `previewFont` — the
  // preset tiles' static single-letter renders.
  useEffect(() => {
    let alive = true;
    loadGoogleFont(entry, weight, italic ? "italic" : "normal")
      .then((f) => {
        if (!alive) return;
        setFont(f);
        setPreviewFont((prev) => prev ?? f);
      })
      .catch((e) => {
        if (!alive) return;
        console.error(`WordArt: failed to load ${entry.family} ${weight}${italic ? " italic" : ""}`, e);
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
      fillType === "gradient"
        ? { kind: "gradient", color, from: gradA, to: gradB, angle: gradAngle }
        : fillType === "rainbow"
          ? { kind: "rainbow", color, angle: gradAngle }
          : fillType === "texture"
            ? { kind: "texture", color, url: texUrl(faceTex), tile: TILE }
            : fillType === "image"
              ? { kind: "image", color, src: fillImage }
              : { kind: "solid", color };
    return resolveFace(spec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frontKey]);

  const polygons = useMemo<Polygon[]>(() => {
    if (!font) return [];
    // "None" → no separate material for that face (it's covered by the nearest
    // active face), but the geometry still renders — no hole.
    const sides: Face | false =
      sideFill === "texture"
        ? resolveFace({ kind: "texture", color: sideColor, url: texUrl(sideTex), tile: TILE })
        : sideFill === "solid"
          ? { color: sideColor }
          : false;
    let back: BackFace | false =
      backFill === "texture"
        ? resolveFace({ kind: "texture", color: backColor, url: texUrl(backTex), tile: TILE })
        : backFill === "solid"
          ? { color: backColor }
          : false;
    if (back !== false && layered) back.offset = [offset || 12, -(offset || 12)];

    const profileObj: Profile =
      profile === "flat"
        ? "flat"
        : profile === "custom"
          ? { curve: bezier, segments: profileSegments }
          : { edge: profile, raised: roundConvex, segments: profileSegments };

    return composeText(font, applyCase(text, textCase), {
      size: 100,
      depth: layered ? 0 : depth, // "Flat layers" = no edges (depth 0)
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
  }, [
    font,
    text,
    textCase,
    depth,
    profile,
    roundConvex,
    bezier,
    letterSpacing,
    lineHeight,
    align,
    underline,
    strike,
    sideColor,
    backColor,
    offset,
    curveSegments,
    simplify,
    profileSegments,
    warpShape,
    warpAmount,
    front,
    fillType,
    backFill,
    backTex,
    sideFill,
    sideTex,
    outlineOn,
    outlineColor,
    outlineWidth,
    layered,
  ]);

  // Source vector from azimuth (left/right) + elevation (height), biased toward
  // the front so the face stays lit. The front cap faces world X now (extrusion
  // depth moved off Z, see extrude.ts), so the "stays lit" floor applies to the
  // X component instead of Z.
  const lightDir = useMemo<Vec3>(() => {
    const a = (lightAz * Math.PI) / 180;
    const e = (lightEl * Math.PI) / 180;
    return [Math.max(0.25, Math.cos(e)), -Math.sin(a) * Math.cos(e), -Math.sin(e)];
  }, [lightAz, lightEl]);

  const effectDefinition = useMemo<GalleryEffectDefinition | null>(
    () => galleryEffectDefinition(effectState.effectId),
    [effectState.effectId],
  );

  const handleEffectChange = useCallback((effectId: GlyphEffectId | null) => {
    setEffectState((current) => {
      if (!effectId) return DEFAULT_GALLERY_EFFECT_STATE;
      return (
        createGalleryEffectState(effectId, {
          paused: current.paused,
          timeScale: current.timeScale,
        }) ?? DEFAULT_GALLERY_EFFECT_STATE
      );
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
      fillType === "gradient"
        ? { kind: "gradient", color, from: gradA, to: gradB, angle: gradAngle }
        : fillType === "rainbow"
          ? { kind: "rainbow", color, angle: gradAngle }
          : fillType === "texture"
            ? { kind: "texture", color, url: absUrl(texUrl(faceTex)), tile: TILE }
            : fillType === "image"
              ? { kind: "image", color, src: fillImage }
              : { kind: "solid", color };
    const sidesSpec: WordArtFaceSpec | null =
      sideFill === "texture"
        ? { kind: "texture", color: sideColor, url: absUrl(texUrl(sideTex)), tile: TILE }
        : sideFill === "solid"
          ? { kind: "solid", color: sideColor }
          : null;
    const backSpec: (WordArtFaceSpec & { offset?: [number, number] }) | null =
      backFill === "texture"
        ? { kind: "texture", color: backColor, url: absUrl(texUrl(backTex)), tile: TILE }
        : backFill === "solid"
          ? { kind: "solid", color: backColor }
          : null;
    if (backSpec && layered) backSpec.offset = [offset || 12, -(offset || 12)];
    const profileSpec: WordArtProfileSpec =
      profile === "flat"
        ? { kind: "flat" }
        : profile === "custom"
          ? { kind: "curve", curve: bezier, segments: profileSegments }
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
  }, [
    entry,
    weight,
    italic,
    text,
    textCase,
    depth,
    profile,
    roundConvex,
    bezier,
    profileSegments,
    letterSpacing,
    lineHeight,
    align,
    underline,
    strike,
    curveSegments,
    simplify,
    warpShape,
    warpAmount,
    fillType,
    color,
    gradA,
    gradB,
    gradAngle,
    faceTex,
    fillImage,
    sideFill,
    sideColor,
    sideTex,
    backFill,
    backColor,
    backTex,
    offset,
    layered,
    outlineOn,
    outlineColor,
    outlineWidth,
  ]);

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
      effect:
        hasEffect && exportName
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
  }, [
    composeInput,
    scaleX,
    scaleY,
    stageSnapshot,
    perspective,
    lightDir,
    lightIntensity,
    lightColor,
    ambient,
    density,
    renderMode,
    charMode,
    hiddenLines,
    effectState,
    effectDefinition,
  ]);

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
      postCodepenForm(
        "https://codepen.io/pen/define",
        JSON.stringify({
          title: exportTitle(),
          html: enc.html,
          css: enc.css ? `${fontCss}\n${enc.css}` : fontCss,
          js: "",
          editors: "100",
        }),
      );
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
    if (p.outline) {
      setOutlineColor(p.outline.color);
      setOutlineWidth(p.outline.width);
    }
    setLayered(!!p.layered);
    if (p.density !== undefined) setDensity(p.density);
    if (p.zoom !== undefined) setZoomScale(() => p.zoom!);
    // Render mode / char mode / hidden lines are OPTIONAL on a preset — only
    // touch state the preset actually specifies, so a style-only preset (the
    // original 20) never resets a render mode the user already has dialed
    // in. These are the user's own VIEWING choice; staying put is useful.
    if (p.mode) setRenderMode(p.mode);
    if (p.charMode) setCharMode(p.charMode);
    if (p.hiddenLines) setHiddenLines(p.hiddenLines);
    // Effect is deliberately NOT sticky, unlike mode/charMode/hiddenLines
    // above: a preset is a whole LOOK, and an effect (Matrix rain, a scan
    // sweep, …) is part of that look, not a standalone viewing preference. A
    // preset always determines the effect — present means "mount this one",
    // absent means "this look has no effect", so clicking a style-only
    // preset after "Matrix Fall" clears the rain instead of leaving it
    // running over an unrelated style. Do not "fix" this back into the
    // absent-means-untouched rule mode/charMode/hiddenLines use above — the
    // asymmetry is intentional (reported bug: effect stuck across presets).
    if (p.effect) {
      const definition = galleryEffectDefinition(p.effect.id);
      const state = definition ? createGalleryEffectState(definition.id, { blend: p.effect.blend }) : null;
      if (state) {
        state.params = sanitizeGalleryEffectParams(definition!, { ...state.params, ...p.effect.params });
        if (p.effect.timeScale !== undefined) state.timeScale = p.effect.timeScale;
        setEffectState(state);
      } else {
        setEffectState(DEFAULT_GALLERY_EFFECT_STATE);
      }
    } else {
      setEffectState(DEFAULT_GALLERY_EFFECT_STATE);
    }
    setActivePreset(p.label);
  }

  // The Profile dropdown encodes edge shape only — colors now come from the
  // axial face stops, so there's no coverage to bundle in.
  const profileMode =
    profile === "flat"
      ? "flat"
      : profile === "custom"
        ? "custom"
        : profile === "round"
          ? roundConvex
            ? "roundup"
            : "round"
          : "bevel";

  const guiValues: GuiValues = {
    layered,
    profileMode,
    warp: warpShape,
    bend: warpAmount,
    depth,
    scaleX,
    scaleY,
    curveSegments,
    simplify,
    profileSegments,
    offset,
    density,
    renderMode,
    charMode,
    hiddenLines,
    colorEncoding,
    perspective,
    zoom: zoomScale,
    spin,
    light: lightIntensity,
    ambient,
    az: lightAz,
    el: lightEl,
    lightColor,
  };

  const guiSet = (k: keyof GuiValues, v: number | string | boolean) => {
    switch (k) {
      case "layered":
        setLayered(v as boolean);
        break;
      case "profileMode": {
        const base = v as string;
        setProfile(
          base === "flat" ? "flat" : base === "custom" ? "custom" : base.startsWith("round") ? "round" : "bevel",
        );
        setRoundConvex(base === "roundup");
        break;
      }
      case "warp":
        setWarpShape(v as WarpShape);
        break;
      case "bend":
        setWarpAmount(v as number);
        break;
      case "depth":
        setDepth(v as number);
        break;
      case "scaleX":
        setScaleX(v as number);
        break;
      case "scaleY":
        setScaleY(v as number);
        break;
      case "curveSegments":
        setCurveSegments(v as number);
        break;
      case "simplify":
        setSimplify(v as number);
        break;
      case "profileSegments":
        setProfileSegments(v as number);
        break;
      case "offset":
        setOffset(v as number);
        break;
      case "density":
        setDensity(v as number);
        break;
      case "renderMode":
        setRenderMode(v as WordArtRenderMode);
        break;
      case "charMode":
        setCharMode(v as WordArtCharMode);
        break;
      case "hiddenLines":
        setHiddenLines(v as WordArtHiddenLines);
        break;
      case "colorEncoding":
        setColorEncoding(v as "spans" | "atlas");
        break;
      case "perspective":
        setPerspective(v as boolean);
        break;
      case "zoom":
        setZoomScale(v as number);
        break;
      case "spin":
        setSpin(v as boolean);
        break;
      case "light":
        setLightIntensity(v as number);
        break;
      case "ambient":
        setAmbient(v as number);
        break;
      case "az":
        setLightAz(v as number);
        break;
      case "el":
        setLightEl(v as number);
        break;
      case "lightColor":
        setLightColor(v as string);
        break;
    }
  };

  const leftValues: LeftValues = {
    weight,
    italic,
    underline,
    strike,
    textCase,
    align,
    letterSpacing,
    lineHeight,
    color,
    sideColor,
    backColor,
    fillType,
    gradA,
    gradB,
    gradAngle,
    image: fillImage,
    faceTex,
    sideFill,
    sideTex,
    backFill,
    backTex,
    outlineOn,
    outlineColor,
    outlineWidth,
  };

  const leftSet = (k: keyof LeftValues, v: number | string | boolean) => {
    switch (k) {
      case "weight":
        setWeight(v as number);
        break;
      case "italic":
        setItalic(v as boolean);
        break;
      case "underline":
        setUnderline(v as boolean);
        break;
      case "strike":
        setStrike(v as boolean);
        break;
      case "textCase":
        setTextCase(v as "as-typed" | "upper" | "lower" | "title");
        break;
      case "align":
        setAlign(v as Align);
        break;
      case "letterSpacing":
        setLetterSpacing(v as number);
        break;
      case "lineHeight":
        setLineHeight(v as number);
        break;
      case "color":
        setColor(v as string);
        break;
      case "sideColor":
        setSideColor(v as string);
        break;
      case "backColor":
        setBackColor(v as string);
        break;
      case "fillType":
        setFillType(v as FillType);
        break;
      case "gradA":
        setGradA(v as string);
        break;
      case "gradB":
        setGradB(v as string);
        break;
      case "gradAngle":
        setGradAngle(v as number);
        break;
      case "image":
        setFillImage(v as string);
        break;
      case "faceTex":
        setFaceTex(v as string);
        break;
      case "sideFill":
        setSideFill(v as FaceFill);
        break;
      case "sideTex":
        setSideTex(v as string);
        break;
      case "backFill":
        setBackFill(v as FaceFill);
        break;
      case "backTex":
        setBackTex(v as string);
        break;
      case "outlineOn":
        setOutlineOn(v as boolean);
        break;
      case "outlineColor":
        setOutlineColor(v as string);
        break;
      case "outlineWidth":
        setOutlineWidth(v as number);
        break;
    }
  };

  // Bottom preset row — one static single-letter glyphcss render per
  // style-only preset, computed once (memoized on the pinned preview font)
  // with NO live scene / rAF: `compileScene` is pure (geometry + camera →
  // string), so each tile is a plain `<pre>` string baked at mount and
  // re-baked only if the bundled font itself reloads. The (currently 2)
  // presets that carry an `effect` are excluded here and rendered live by
  // `LiveEffectTile` instead (see the preset row below) — a static bake
  // can't show a running effect.
  const presetTiles = useMemo(() => {
    if (!previewFont) return null;
    const map = new Map<string, CompileSceneResult | null>();
    // A preset's own `mode`/`charMode` (when it specifies one) wins over the
    // current workbench state, so e.g. the Braille Wire tile always previews
    // as braille wireframe regardless of what mode the user is currently in.
    // Style-only presets (no `mode`/`charMode`) keep the prior behaviour of
    // following the live workbench state.
    for (const p of PRESETS) {
      if (p.effect) continue;
      map.set(p.label, renderPresetTile(previewFont, p, p.mode ?? renderMode, p.charMode ?? charMode));
    }
    return map;
  }, [previewFont, renderMode, charMode]);
  return {
    mobilePanel,
    text,
    setText,
    catalog,
    familyInput,
    pickFamily,
    leftValues,
    leftSet,
    setStageHost,
    stageHost,
    polygons,
    scaleX,
    scaleY,
    zoomScale,
    setZoomScale,
    turn,
    setTurn,
    tilt,
    setTilt,
    density,
    renderMode,
    charMode,
    hiddenLines,
    colorEncoding,
    setAtlasReason,
    perspective,
    lightDir,
    lightIntensity,
    lightColor,
    ambient,
    spin,
    effectDefinition,
    effectState,
    stageSnapshotRef,
    handleExportCodepenStatic,
    exporting,
    handleCopyAscii,
    copyState,
    handleDownloadSvg,
    svgState,
    codeOpen,
    toggleCodeOpen,
    setSpin,
    codeInput,
    handleExportCodepenDynamic,
    closeCodePanel,
    guiValues,
    guiSet,
    atlasReason,
    bezier,
    setBezier,
    handleEffectChange,
    updateEffectSettings,
    updateEffectParams,
    presetTiles,
    activePreset,
    applyPreset,
    previewFont,
    setMobilePanel,
    handleMobileExportTab,
  };
}
