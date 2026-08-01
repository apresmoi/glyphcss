import { useCallback, useEffect, useMemo, useState, useRef, type RefObject } from "react";
import { Inspector, type InspectorMesh } from "../Inspector";
import { GlyphScene } from "../GlyphScene";
import { CodePanel } from "./CodePanel";
import {
  Dock,
  DockModel,
  DockRendering,
  DockEffects,
  DockAnimation,
  DockCamera,
  DockLighting,
  DockShadow,
} from "../Dock";
import { ModelsSidebar } from "../ModelsSidebar";
import { DropOverlay } from "../DropOverlay";
import { StatsOverlay } from "../StatsOverlay";
import type {
  GalleryEffectParamValue,
  GalleryEffectState,
  GlyphMetrics,
  SceneOptionsState,
} from "./types";
import "./gallery-workbench.css";
import {
  PRESETS,
  GALLERY_BUCKET_ORDER,
  galleryBucketForPreset,
  galleryBucketRank,
  labelFromFile,
  stripParenthesizedText,
} from "./presets";
import {
  useDroppedFiles,
  usePresetLoader,
  useRouteSync,
  useGuiCameraSync,
  setRoutePresetId,
  routeInitialPresetId,
  routeInitialSceneOptions,
  routeHasSceneOptions,
  setRouteSceneOptions,
  clearRouteSceneOptions,
  clearRouteEffectState,
  routeHasEffectState,
  routeInitialEffectState,
  setRouteEffectState,
  useEffectRouteSync,
} from "./hooks";
import type { PresetModel } from "./types";
import { defaultZoomForModel } from "./helpers/smartDefaults";
import {
  createGalleryEffectState,
  DEFAULT_GALLERY_EFFECT_STATE,
  GALLERY_EFFECT_OPTIONS,
  galleryEffectDefinition,
  sanitizeGalleryEffectParams,
} from "./effects";
import type { GlyphEffectId } from "@glyphcss/effects";
import type { GlyphSemanticCellLineage } from "glyphcss";
import { gallerySemanticSceneFor } from "./semanticScene";

type AsciiCell = { ch: string; color?: string };
type TrimmedStrip = { rows: AsciiCell[][]; left: number; right: number; top: number; bottom: number };

/** Walk the strip's DOM, collect (char, color) cells per row, then compute the
 * trim bounds (leading/trailing empty rows, common left/right padding). */
function parseStripCells(strip: HTMLElement): TrimmedStrip | null {
  const rows: AsciiCell[][] = [[]];
  let row = rows[0]!;
  const visit = (node: Node, color?: string): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.nodeValue ?? "";
      for (const ch of t) {
        if (ch === "\n") {
          row = [];
          rows.push(row);
        } else {
          row.push(color ? { ch, color } : { ch });
        }
      }
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const next = el.style?.color || color;
      el.childNodes.forEach((c) => visit(c, next));
    }
  };
  strip.childNodes.forEach((c) => visit(c));

  let top = 0;
  let bottom = rows.length - 1;
  const rowEmpty = (r: AsciiCell[]) => r.every((c) => c.ch === " ");
  while (top <= bottom && rowEmpty(rows[top]!)) top++;
  while (bottom >= top && rowEmpty(rows[bottom]!)) bottom--;
  if (bottom < top) return null;

  let left = Infinity;
  let right = 0;
  for (let i = top; i <= bottom; i++) {
    const r = rows[i]!;
    let first = -1;
    let last = -1;
    for (let j = 0; j < r.length; j++) {
      if (r[j]!.ch !== " ") {
        if (first === -1) first = j;
        last = j + 1;
      }
    }
    if (first === -1) continue;
    if (first < left) left = first;
    if (last > right) right = last;
  }
  if (!Number.isFinite(left) || right === 0) return null;
  return { rows, top, bottom, left, right };
}

/** Render the trimmed strip as plain text + inline-color HTML. */
function renderHtmlAndText(strip: TrimmedStrip): { text: string; html: string } {
  const { rows, top, bottom, left, right } = strip;

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const textLines: string[] = [];
  const htmlLines: string[] = [];
  for (let i = top; i <= bottom; i++) {
    const r = rows[i]!;
    const slice = r.slice(left, right);
    while (slice.length < right - left) slice.push({ ch: " " });
    textLines.push(slice.map((c) => c.ch).join(""));

    let html = "";
    let buf = "";
    let cur: string | undefined;
    const flush = () => {
      if (!buf) return;
      // Cells with a color render as solid blocks of that color (background
      // matches the glyph color, so the glyph itself disappears) — yields
      // a clean colored silhouette of the mesh when pasted into rich-text
      // editors. Plain cells stay bare so empty padding inherits the paste
      // target's background.
      html += cur
        ? `<span style="color:${cur};background:${cur}">${esc(buf)}</span>`
        : esc(buf);
      buf = "";
    };
    for (const cell of slice) {
      if (cell.color !== cur) {
        flush();
        cur = cell.color;
      }
      buf += cell.ch;
    }
    flush();
    htmlLines.push(html);
  }
  const text = textLines.join("\n");
  // Background + default color intentionally omitted so the paste target's
  // theme (Docs/Notion white, terminals dark) shows through. Per-cell colors
  // still survive via inline span styles.
  const html = `<pre style="font-family:ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace;white-space:pre;line-height:1.05;margin:0">${htmlLines.join("\n")}</pre>`;
  return { text, html };
}

/**
 * Floating "Copy" button overlaid on the viewport. Grabs the rendered ASCII
 * (trimmed to the mesh bounding box) and writes both plain text and HTML to
 * the clipboard so color is preserved in rich-text editors.
 */
function CopySceneButton() {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    const strip = document.querySelector(".glyph-output") as HTMLElement | null;
    if (!strip) return;
    const parsed = parseStripCells(strip);
    if (!parsed) return;
    const { text, html } = renderHtmlAndText(parsed);
    try {
      const ClipboardItemCtor = (globalThis as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (ClipboardItemCtor && navigator.clipboard?.write) {
        const item = new ClipboardItemCtor({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        });
        await navigator.clipboard.write([item]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      } catch {
        // No-op.
      }
    }
  }, []);

  return (
    <button
      type="button"
      className="dn-copy-scene"
      onClick={handleCopy}
      title="Copy rendered ASCII to clipboard"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function presetPickerItem(preset: PresetModel, local = false) {
  return {
    id: preset.id,
    label: local ? `Dropped: ${stripParenthesizedText(preset.label)}` : stripParenthesizedText(preset.label),
    category: galleryBucketForPreset(preset),
  };
}

const PRESET_PICKER_ITEMS = PRESETS.map((preset) => presetPickerItem(preset));
const ALL_PRESET_IDS = PRESETS.map((p) => p.id);

const DEFAULT_SCENE: SceneOptionsState = {
  animationPaused: false,
  animationTimeScale: 1,
  autoCenter: true,
  autoRotate: false,
  interactive: true,
  zoom: PRESETS[0].zoom ?? 0.35,
  rotX: PRESETS[0].rotX ?? 65,
  rotY: PRESETS[0].rotY ?? 45,
  perspective: 32000,
  lightAzimuth: 50,
  lightElevation: 7,
  lightIntensity: 0.95,
  lightColor: "#ffffff",
  ambientIntensity: 0.75,
  ambientColor: "#ffffff",
  target: [0, 0, 0],
  renderMode: "solid",
  featureEdges: 30,
  glyphPalette: "default",
  charMode: "ascii",
  wireframeJunctions: false,
  lineHeight: 1.0,
  density: 1.0,
  dragDensity: 1,
  useColors: true,
  smoothShading: false,
  creaseAngle: 60,
  dragMode: "orbit",
  fpvLook: true,
  fpvMove: true,
  fpvJump: true,
  fpvCrouch: true,
  fpvMoveSpeed: 1,
  fpvJumpVelocity: 0.7,
  fpvGravity: 1.8,
  fpvEyeHeight: 0.2,
  fpvCrouchHeight: 0.1,
  fpvLookSensitivity: 0.15,
  fpvInvertY: false,
  // Shadow — ON by default with cast+receive so every model self-shadows out
  // of the box. Floor OFF: self-shadowing only, no ground plane.
  shadowEnabled: true,
  shadowOpacity: 0.25,
  shadowLift: 0.05,
  shadowColor: "#000000",
  shadowCast: true,
  shadowReceive: true,
  shadowFloor: false,
};

const RESPONSIVE_ZOOM_BREAKPOINT = 900;
const RESPONSIVE_ZOOM_BOTTOM_RESERVE = 72;
const RESPONSIVE_ZOOM_MIN_SCALE = 0.42;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function responsiveZoomScaleForViewport(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1;
  }
  const effectiveHeight = Math.max(1, height - RESPONSIVE_ZOOM_BOTTOM_RESERVE);
  const widthScale = width < RESPONSIVE_ZOOM_BREAKPOINT
    ? width / RESPONSIVE_ZOOM_BREAKPOINT
    : 1;
  const heightScale = effectiveHeight < RESPONSIVE_ZOOM_BREAKPOINT
    ? effectiveHeight / RESPONSIVE_ZOOM_BREAKPOINT
    : 1;
  return clamp(Math.min(widthScale, heightScale), RESPONSIVE_ZOOM_MIN_SCALE, 1);
}

function initialResponsiveZoomScale(): number {
  if (typeof window === "undefined") return 1;
  return responsiveZoomScaleForViewport(window.innerWidth, window.innerHeight);
}

function useResponsiveViewportZoomScale(
  viewportRef: RefObject<HTMLDivElement | null>,
): number {
  const [scale, setScale] = useState(initialResponsiveZoomScale);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateScale = (width: number, height: number): void => {
      const next = responsiveZoomScaleForViewport(width, height);
      setScale((current) => Math.abs(current - next) < 0.005 ? current : next);
    };
    const readScale = (): void => {
      const rect = viewport.getBoundingClientRect();
      updateScale(rect.width, rect.height);
    };

    readScale();
    window.addEventListener("resize", readScale);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver((entries) => {
        const rect = entries[0]?.contentRect;
        if (rect) updateScale(rect.width, rect.height);
        else readScale();
      });
      observer.observe(viewport);
    }

    return () => {
      window.removeEventListener("resize", readScale);
      observer?.disconnect();
    };
  }, [viewportRef]);

  return scale;
}

const EMPTY_METRICS: GlyphMetrics = {
  measuredAt: 0,
  cols: 0,
  rows: 0,
  glyphs: 0,
  textChars: 0,
  colorSpans: 0,
  domNodes: 0,
  layers: 0,
  bakeMs: 0,
};

function sceneDefaultsFor(model: PresetModel): SceneOptionsState {
  return {
    ...DEFAULT_SCENE,
    zoom: defaultZoomForModel(model),
    rotX: model.rotX ?? DEFAULT_SCENE.rotX,
    rotY: model.rotY ?? DEFAULT_SCENE.rotY,
  };
}

function sceneDefaultsForPresetId(id: string): SceneOptionsState {
  const model = PRESETS.find((p) => p.id === id);
  return model ? sceneDefaultsFor(model) : DEFAULT_SCENE;
}

function randomPreset(): PresetModel {
  return PRESETS[Math.floor(Math.random() * PRESETS.length)] ?? PRESETS[0];
}

function resolveInitialPreset(): PresetModel {
  const id = routeInitialPresetId(ALL_PRESET_IDS);
  return (id ? PRESETS.find((p) => p.id === id) : null) ?? randomPreset();
}

export default function GalleryWorkbench() {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const responsiveZoomScale = useResponsiveViewportZoomScale(viewportRef);
  const [initialPreset] = useState<PresetModel>(resolveInitialPreset);
  // Sidebar options restored from the URL `scene` param (empty when absent).
  const [initialRouteSceneOptions] = useState(routeInitialSceneOptions);
  const [initialRouteHasSceneOptions] = useState(routeHasSceneOptions);
  const [initialRouteEffectState] = useState(routeInitialEffectState);
  const [initialRouteHasEffectState] = useState(routeHasEffectState);
  // Start from the preset's defaults, then layer any URL-restored overrides on
  // top. When the route already carries scene options, usePresetLoader is told
  // (via autoZoomPresetRef seeded below) not to re-stomp camera defaults with the
  // preset defaults on first paint.
  const [sceneOptions, setSceneOptions] = useState<SceneOptionsState>(() => ({
    ...sceneDefaultsFor(initialPreset),
    ...initialRouteSceneOptions,
  }));
  const [effectState, setEffectState] = useState<GalleryEffectState>(initialRouteEffectState);
  const [presetId, setPresetId] = useState(initialPreset.id);
  const [meshUrl, setMeshUrl] = useState(initialPreset.kind !== "primitive" ? initialPreset.url : "");
  const [metrics, setMetrics] = useState<GlyphMetrics>(EMPTY_METRICS);
  const [selectedAnimation, setSelectedAnimation] = useState("");
  const [animationClips, setAnimationClips] = useState<Array<{ index: number; name: string; duration: number }>>([]);
  const [modelSearch, setModelSearch] = useState("");
  const [openModelCategory, setOpenModelCategory] = useState<string | null>(null);
  // Mobile-only: which panel is open as a bottom drawer (null = canvas only).
  const [mobilePanel, setMobilePanel] = useState<"models" | "controls" | "code" | null>(null);
  const [glyphOutput, setGlyphOutput] = useState<"visible" | "semantic">("visible");
  const [semanticCell, setSemanticCell] = useState<GlyphSemanticCellLineage | null>(null);
  const ordinaryRenderModeRef = useRef<SceneOptionsState["renderMode"]>(sceneOptions.renderMode);
  // Seed the loader ref to the initial preset when the URL already restored
  // scene options, so it skips applying preset rotX/rotY over the URL values.
  const autoZoomPresetRef = useRef<string | null>(initialRouteHasSceneOptions ? initialPreset.id : null);

  // The URL `scene` param is only written once the user actually touches a
  // control (or orbits the camera) — never from initial auto-fit / preset load.
  const sceneRouteTouchedRef = useRef(initialRouteHasSceneOptions);
  const [sceneRouteRevision, setSceneRouteRevision] = useState(0);
  const markSceneRouteDirty = useCallback(() => {
    sceneRouteTouchedRef.current = true;
    setSceneRouteRevision((revision) => revision + 1);
  }, []);

  const updateScene = useCallback((partial: Partial<SceneOptionsState>) => {
    markSceneRouteDirty();
    setSceneOptions((current) => ({ ...current, ...partial }));
  }, [markSceneRouteDirty]);

  const effectRouteTouchedRef = useRef(initialRouteHasEffectState);
  const [effectRouteRevision, setEffectRouteRevision] = useState(0);
  const markEffectRouteDirty = useCallback(() => {
    effectRouteTouchedRef.current = true;
    setEffectRouteRevision((revision) => revision + 1);
  }, []);

  const handleEffectChange = useCallback((effectId: GlyphEffectId | null) => {
    markEffectRouteDirty();
    setEffectState((current) => {
      if (!effectId) return DEFAULT_GALLERY_EFFECT_STATE;
      return createGalleryEffectState(effectId, {
        paused: current.paused,
        timeScale: current.timeScale,
      }) ?? DEFAULT_GALLERY_EFFECT_STATE;
    });
  }, [markEffectRouteDirty]);

  const updateEffectSettings = useCallback((partial: Partial<Pick<GalleryEffectState, "blend" | "paused" | "timeScale">>) => {
    markEffectRouteDirty();
    setEffectState((current) => ({ ...current, ...partial }));
  }, [markEffectRouteDirty]);

  const updateEffectParams = useCallback((partial: Record<string, GalleryEffectParamValue>) => {
    markEffectRouteDirty();
    setEffectState((current) => {
      const params = { ...current.params, ...partial };
      const speedMin = params.speedMin;
      const speedMax = params.speedMax;
      if (typeof speedMin === "number" && typeof speedMax === "number" && speedMin > speedMax) {
        if ("speedMin" in partial) params.speedMax = speedMin;
        else params.speedMin = speedMax;
      }
      const definition = galleryEffectDefinition(current.effectId);
      return {
        ...current,
        params: definition ? sanitizeGalleryEffectParams(definition, params) : params,
      };
    });
  }, [markEffectRouteDirty]);

  const { handleCameraChange: handleCameraChangeRaw } = useGuiCameraSync({ setSceneOptions });
  const renderSceneOptions = useMemo<SceneOptionsState>(() => {
    if (responsiveZoomScale === 1) return sceneOptions;
    return {
      ...sceneOptions,
      zoom: sceneOptions.zoom * responsiveZoomScale,
    };
  }, [sceneOptions, responsiveZoomScale]);

  const handleCameraChange = useCallback(
    (camera: Parameters<typeof handleCameraChangeRaw>[0]) => {
      markSceneRouteDirty();
      handleCameraChangeRaw({
        ...camera,
        ...(camera.zoom !== undefined
          ? { zoom: camera.zoom / Math.max(responsiveZoomScale, 0.001) }
          : {}),
      });
    },
    [handleCameraChangeRaw, markSceneRouteDirty, responsiveZoomScale],
  );

  const dropped = useDroppedFiles({
    onDroppedSource: (source) => {
      autoZoomPresetRef.current = null;
      setRoutePresetId(null);
      // A dropped local file can't be reconstructed from a URL, so don't keep
      // a stale `scene` param pointing at the previous model.
      clearRouteSceneOptions();
      clearRouteEffectState();
      setPresetId(source.id);
      setSelectedAnimation("");
      setSceneOptions((current) => ({
        ...current,
        zoom: defaultZoomForModel(source.preset),
        rotX: source.preset.rotX ?? current.rotX,
        rotY: source.preset.rotY ?? current.rotY,
      }));
    },
    onDropError: (message) => console.warn("[GalleryWorkbench] drop error:", message),
  });

  const availablePresets = useMemo(
    () => dropped.droppedSource ? [dropped.droppedSource.preset, ...PRESETS] : PRESETS,
    [dropped.droppedSource],
  );
  const pickerItems = useMemo(
    () => dropped.droppedSource ? [presetPickerItem(dropped.droppedSource.preset, true), ...PRESET_PICKER_ITEMS] : PRESET_PICKER_ITEMS,
    [dropped.droppedSource],
  );
  const selectedPreset = availablePresets.find((preset) => preset.id === presetId) ?? PRESETS[0];
  const selectedDroppedSource = dropped.droppedSource?.id === selectedPreset.id ? dropped.droppedSource : null;
  const selectedSceneDefaults = useMemo(() => sceneDefaultsFor(selectedPreset), [selectedPreset]);
  const selectedPresetPickerCategory =
    pickerItems.find((preset) => preset.id === selectedPreset.id)?.category ??
    galleryBucketForPreset(selectedPreset);
  const semanticScene = useMemo(
    () => selectedPreset.kind === "primitive" ? gallerySemanticSceneFor(selectedPreset.id, selectedPreset.generatePolygons()) : null,
    [selectedPreset],
  );
  const semanticAvailable = semanticScene !== null;
  useEffect(() => {
    if (!semanticAvailable && glyphOutput === "semantic") {
      setGlyphOutput("visible");
      updateScene({ renderMode: ordinaryRenderModeRef.current });
    }
    setSemanticCell(null);
  }, [glyphOutput, semanticAvailable, updateScene]);

  const renderPresentation = glyphOutput === "semantic" ? "semantic" : sceneOptions.renderMode;
  const handleRenderModeChange = useCallback((mode: "wireframe" | "solid" | "ink" | "semantic") => {
    if (mode === "semantic") {
      if (semanticAvailable) {
        ordinaryRenderModeRef.current = sceneOptions.renderMode;
        // Semantic is a gallery presentation mode. Its renderer transaction is
        // still the public solid mode plus glyphOutput: semantic.
        updateScene({ renderMode: "solid" });
        setGlyphOutput("semantic");
      }
      return;
    }
    ordinaryRenderModeRef.current = mode;
    setGlyphOutput("visible");
    updateScene({ renderMode: mode });
  }, [sceneOptions.renderMode, semanticAvailable, updateScene]);

  const trimmedModelSearch = modelSearch.trim().toLowerCase();
  const filteredPresetItems = useMemo(() => {
    if (!trimmedModelSearch) return pickerItems;
    return pickerItems.filter((preset) =>
      preset.label.toLowerCase().includes(trimmedModelSearch) ||
      preset.category.toLowerCase().includes(trimmedModelSearch),
    );
  }, [pickerItems, trimmedModelSearch]);

  const modelCategories = useMemo(() => {
    const buckets = new Map<string, { id: string; label: string; models: typeof PRESET_PICKER_ITEMS }>();
    if (!trimmedModelSearch) {
      for (const category of GALLERY_BUCKET_ORDER) {
        buckets.set(category, { id: category, label: category, models: [] as typeof PRESET_PICKER_ITEMS });
      }
    }
    for (const preset of filteredPresetItems) {
      const category = preset.category || "Other";
      if (!buckets.has(category)) {
        buckets.set(category, { id: category, label: category, models: [] as typeof PRESET_PICKER_ITEMS });
      }
      buckets.get(category)!.models.push(preset);
    }
    const orderedCategories = Array.from(buckets.values()).sort((a, b) =>
      galleryBucketRank(a.id) - galleryBucketRank(b.id),
    );
    for (const category of orderedCategories) {
      category.models.sort((a, b) => a.label.localeCompare(b.label));
    }
    return orderedCategories;
  }, [filteredPresetItems, trimmedModelSearch]);

  const defaultCategoryId = modelCategories.find((category) => category.models.length > 0)?.id ?? modelCategories[0]?.id;
  const isCategoryOpen = useCallback(
    (categoryId: string): boolean => {
      if (trimmedModelSearch) return true;
      if (openModelCategory !== null) return categoryId === openModelCategory;
      return categoryId === selectedPresetPickerCategory || categoryId === defaultCategoryId;
    },
    [trimmedModelSearch, openModelCategory, selectedPresetPickerCategory, defaultCategoryId],
  );
  const handleToggleCategory = useCallback((categoryId: string) => {
    setOpenModelCategory((prev) => (prev === categoryId ? null : categoryId));
  }, []);
  const modelTreeId = useMemo(() => {
    const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "");
    return modelCategories.map((category) => `gallery-model-cat-${slug(category.id) || "category"}`);
  }, [modelCategories]);

  usePresetLoader({
    selectedPreset,
    selectedDroppedSource,
    onMeshUrl: setMeshUrl,
    onSceneDefaults: (zoom, rotX, rotY) => {
      setSceneOptions((current) => ({
        ...current,
        zoom: zoom ?? current.zoom,
        rotX: rotX ?? current.rotX,
        rotY: rotY ?? current.rotY,
      }));
    },
    autoZoomPresetRef,
  });

  const resetToPreset = useCallback((id: string, options: { updateRoute?: boolean } = {}) => {
    const next = availablePresets.find((preset) => preset.id === id);
    autoZoomPresetRef.current = null;
    setPresetId(id);
    setSelectedAnimation("");
    if (!next) return;
    if (options.updateRoute) {
      if (dropped.droppedSource?.id === next.id) setRoutePresetId(null);
      else setRoutePresetId(next.id);
    }
    setSceneOptions((current) => ({
      ...current,
      zoom: defaultZoomForModel(next),
      rotX: next.rotX ?? current.rotX,
      rotY: next.rotY ?? current.rotY,
    }));
  }, [availablePresets, dropped.droppedSource]);

  const handleRandomPreset = useCallback(() => {
    const next = randomPreset();
    resetToPreset(next.id, { updateRoute: true });
  }, [resetToPreset]);

  useRouteSync({
    presetId,
    presetIds: ALL_PRESET_IDS,
    resetToPreset,
    sceneDefaultsForPreset: sceneDefaultsForPresetId,
    setSceneOptions,
  });
  useEffectRouteSync(setEffectState);

  // Persist the sidebar options to the URL `scene` param (diffed against the
  // active preset's defaults) once the user has touched a control. Dropped
  // local models can't be shared by URL, so their scene param is cleared.
  useEffect(() => {
    if (!sceneRouteTouchedRef.current) return;
    if (selectedDroppedSource) {
      clearRouteSceneOptions();
      return;
    }
    setRouteSceneOptions({
      sceneOptions,
      sceneDefaults: selectedSceneDefaults,
      presetId: selectedPreset.id,
    });
  }, [sceneOptions, sceneRouteRevision, selectedDroppedSource, selectedPreset.id, selectedSceneDefaults]);

  useEffect(() => {
    if (!effectRouteTouchedRef.current) return;
    if (selectedDroppedSource) {
      clearRouteEffectState();
      return;
    }
    setRouteEffectState(effectState);
  }, [effectState, effectRouteRevision, selectedDroppedSource]);

  const selectedEffectDefinition = useMemo(
    () => galleryEffectDefinition(effectState.effectId),
    [effectState.effectId],
  );
  const runtimeEffect = useMemo(() => selectedEffectDefinition ? {
    effect: selectedEffectDefinition,
    params: effectState.params,
    blend: effectState.blend,
    paused: effectState.paused,
    timeScale: effectState.timeScale,
  } : null, [selectedEffectDefinition, effectState]);

  const animationOptions = useMemo(() => {
    const options: Record<string, string> = { None: "" };
    for (const clip of animationClips) {
      options[`${clip.name} (${clip.duration.toFixed(2)}s)`] = String(clip.index);
    }
    return options;
  }, [animationClips]);

  const perspectiveMode = sceneOptions.perspective === false ? "orthographic" : "perspective";
  const perspectivePx = sceneOptions.perspective === false ? 32000 : sceneOptions.perspective;

  // Inspector is read-only for first cut — no triangle mutations.
  const inspectorMeshes: InspectorMesh[] = [];

  // Close the mobile drawer on Escape.
  useEffect(() => {
    if (!mobilePanel) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobilePanel(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobilePanel]);

  return (
    <div
      className={`dn-root dn-root--gallery${dropped.dropActive ? " dn-root--drop-active" : ""}`}
      onDragEnter={dropped.handleDragEnter}
      onDragOver={dropped.handleDragOver}
      onDragLeave={dropped.handleDragLeave}
      onDrop={dropped.handleDrop}
    >
      <ModelsSidebar
        id="gallery-models-panel"
        className={mobilePanel === "models" ? "is-mobile-open" : ""}
        modelSearch={modelSearch}
        onModelSearchChange={setModelSearch}
        onImportClick={() => dropped.fileInputRef.current?.click()}
        fileInputRef={dropped.fileInputRef}
        onFileInputChange={dropped.handleFileInputChange}
        onRandomPreset={handleRandomPreset}
        modelCategories={modelCategories}
        isCategoryOpen={isCategoryOpen}
        onToggleCategory={handleToggleCategory}
        modelTreeId={modelTreeId}
        presetId={presetId}
        onPresetClick={(id) => { resetToPreset(id, { updateRoute: true }); setMobilePanel(null); }}
        attribution={selectedPreset.attribution}
      />

      <Inspector
        meshes={inspectorMeshes}
        onColorChange={() => {}}
      />

      <main className="dn-main">
        <div className="dn-viewport" ref={viewportRef}>
          <GlyphScene
            meshUrl={meshUrl}
            selectedPreset={selectedPreset}
            options={renderSceneOptions}
            onBuild={(ms) => setMetrics((m) => ({ ...m, bakeMs: ms }))}
            onCameraChange={handleCameraChange}
            onStatsChange={setMetrics}
            onAnimationInfoChange={({ clips }) => {
              setAnimationClips(clips);
            }}
            selectedAnimation={selectedAnimation}
            animationPaused={sceneOptions.animationPaused}
            animationTimeScale={sceneOptions.animationTimeScale}
            effect={runtimeEffect}
            semanticOutput={glyphOutput === "semantic" ? semanticScene : null}
            onSemanticCellLineage={setSemanticCell}
          />
          <CopySceneButton />
          <CodePanel
            id="gallery-code-panel"
            meshUrl={meshUrl}
            options={renderSceneOptions}
            selectedPreset={selectedPreset}
            className={mobilePanel === "code" ? "is-mobile-open" : ""}
            effectState={effectState}
            effectDefinition={selectedEffectDefinition}
          />
        </div>
        <DropOverlay active={dropped.dropActive} />
      </main>

      <StatsOverlay />

      <Dock
        id="gallery-controls-panel"
        className={mobilePanel === "controls" ? "is-mobile-open" : ""}
      >
        <DockModel metrics={metrics} />
        <DockRendering
          renderMode={renderPresentation}
          semanticAvailable={semanticAvailable}
          featureEdges={sceneOptions.featureEdges}
          glyphPalette={sceneOptions.glyphPalette}
          charMode={sceneOptions.charMode}
          wireframeJunctions={sceneOptions.wireframeJunctions}
          density={sceneOptions.density}
          dragDensity={sceneOptions.dragDensity}
          useColors={sceneOptions.useColors}
          smoothShading={sceneOptions.smoothShading}
          creaseAngle={sceneOptions.creaseAngle}
          onRenderModeChange={handleRenderModeChange}
          onUpdateScene={updateScene}
          semanticDetails={<section className="gallery-semantic-details" aria-label="Semantic rendering details">
            {glyphOutput === "semantic" && semanticScene ? <>
              <p className="gallery-semantic-details__note">Immutable class labels for this authored cube fixture.</p>
              <ul className="gallery-semantic-details__legend" aria-label="Semantic dictionary legend">
                {semanticScene.dictionary.classes.map((entry) => <li key={entry.id}><i style={{ backgroundColor: entry.controlColor }} /><code>{entry.semanticGlyph}</code><span>{entry.name}</span></li>)}
              </ul>
              <p className="gallery-semantic-details__lineage">{semanticCell ? <>polygon {semanticCell.polygonIndex} → {semanticCell.surfaceId} → {semanticCell.instanceId} → {semanticCell.className}</> : "Select a rendered semantic cell to inspect its depth-winning lineage."}</p>
            </> : <p className="gallery-semantic-details__note">{semanticAvailable ? "Select Semantic to inspect the cube's immutable class labels." : "Semantic labels are available for the authored Cube fixture. This model stays usable in its selected visible render mode."}</p>}
          </section>}
        />
        <DockEffects
          effectState={effectState}
          definition={selectedEffectDefinition}
          effectOptions={GALLERY_EFFECT_OPTIONS}
          onEffectChange={handleEffectChange}
          onUpdateSettings={updateEffectSettings}
          onUpdateParams={updateEffectParams}
        />
        <DockAnimation
          selectedAnimation={selectedAnimation}
          animationOptions={animationOptions}
          animationPaused={sceneOptions.animationPaused}
          animationTimeScale={sceneOptions.animationTimeScale}
          animationClipCount={animationClips.length}
          onAnimationChange={setSelectedAnimation}
          onSelectAnimationClear={() => setSelectedAnimation("")}
          onUpdateScene={updateScene}
        />
        <DockCamera
          autoCenter={sceneOptions.autoCenter}
          autoRotate={sceneOptions.autoRotate}
          interactive={sceneOptions.interactive}
          dragMode={sceneOptions.dragMode}
          fpvLook={sceneOptions.fpvLook}
          fpvMove={sceneOptions.fpvMove}
          fpvJump={sceneOptions.fpvJump}
          fpvCrouch={sceneOptions.fpvCrouch}
          fpvMoveSpeed={sceneOptions.fpvMoveSpeed}
          fpvJumpVelocity={sceneOptions.fpvJumpVelocity}
          fpvGravity={sceneOptions.fpvGravity}
          fpvEyeHeight={sceneOptions.fpvEyeHeight}
          fpvCrouchHeight={sceneOptions.fpvCrouchHeight}
          fpvLookSensitivity={sceneOptions.fpvLookSensitivity}
          fpvInvertY={sceneOptions.fpvInvertY}
          perspectiveMode={perspectiveMode}
          perspectivePx={perspectivePx}
          perspective={sceneOptions.perspective}
          zoom={sceneOptions.zoom}
          rotX={sceneOptions.rotX}
          rotY={sceneOptions.rotY}
          target={sceneOptions.target}
          selectedPreset={selectedPreset}
          onUpdateScene={updateScene}
        />
        <DockLighting
          lightAzimuth={sceneOptions.lightAzimuth}
          lightElevation={sceneOptions.lightElevation}
          lightIntensity={sceneOptions.lightIntensity}
          lightColor={sceneOptions.lightColor}
          ambientIntensity={sceneOptions.ambientIntensity}
          ambientColor={sceneOptions.ambientColor}
          onUpdateScene={updateScene}
        />
        <DockShadow
          shadowEnabled={sceneOptions.shadowEnabled}
          shadowOpacity={sceneOptions.shadowOpacity}
          shadowLift={sceneOptions.shadowLift}
          shadowColor={sceneOptions.shadowColor}
          shadowCast={sceneOptions.shadowCast}
          shadowReceive={sceneOptions.shadowReceive}
          shadowFloor={sceneOptions.shadowFloor}
          onUpdateScene={updateScene}
        />
      </Dock>

      <nav className="dn-mobile-tabs" aria-label="Gallery panels">
        <button
          type="button"
          className={`dn-mobile-tabs__button${mobilePanel === "models" ? " is-active" : ""}`}
          aria-controls="gallery-models-panel"
          aria-expanded={mobilePanel === "models"}
          onClick={() => setMobilePanel((current) => current === "models" ? null : "models")}
        >
          Models
        </button>
        <button
          type="button"
          className="dn-mobile-tabs__button dn-mobile-tabs__button--random"
          aria-label="Load random model"
          onClick={() => { handleRandomPreset(); setMobilePanel(null); }}
        >
          Random
        </button>
        <button
          type="button"
          className={`dn-mobile-tabs__button${mobilePanel === "controls" ? " is-active" : ""}`}
          aria-controls="gallery-controls-panel"
          aria-expanded={mobilePanel === "controls"}
          onClick={() => setMobilePanel((current) => current === "controls" ? null : "controls")}
        >
          Controls
        </button>
        <button
          type="button"
          className={`dn-mobile-tabs__button${mobilePanel === "code" ? " is-active" : ""}`}
          aria-controls="gallery-code-panel"
          aria-expanded={mobilePanel === "code"}
          onClick={() => setMobilePanel((current) => current === "code" ? null : "code")}
        >
          Code
        </button>
      </nav>
    </div>
  );
}
