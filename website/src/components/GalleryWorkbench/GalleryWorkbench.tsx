import { useCallback, useMemo, useState, useRef } from "react";
import { Inspector, type InspectorMesh } from "../Inspector";
import { GlyphcssScene } from "../GlyphcssScene";
import {
  Dock,
  DockModel,
  DockRendering,
  DockAnimation,
  DockCamera,
  DockLighting,
} from "../Dock";
import { ModelsSidebar } from "../ModelsSidebar";
import { DropOverlay } from "../DropOverlay";
import { StatsOverlay } from "../StatsOverlay";
import type { GlyphcssMetrics, SceneOptionsState } from "./types";
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
} from "./hooks";
import type { PresetModel } from "./types";

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
    const strip = document.querySelector(".glyphcss-demo__strip") as HTMLElement | null;
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
  interactive: true,
  showAxes: false,
  showLight: false,
  showGround: false,
  zoom: 0.25,
  rotX: 65,
  rotY: 45,
  perspective: false,
  lightAzimuth: 50,
  lightElevation: 45,
  lightIntensity: 1,
  lightColor: "#ffffff",
  ambientIntensity: 0.4,
  ambientColor: "#ffffff",
  target: [0, 0, 0],
  renderMode: "solid",
  featureEdges: 30,
  glyphPalette: "default",
  lineHeight: 1.0,
  useColors: true,
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
};

const EMPTY_METRICS: GlyphcssMetrics = {
  measuredAt: 0,
  cells: 0,
  edges: 0,
  triangles: 0,
  vertices: 0,
  frames: 60,
  bakeMs: 0,
};

function sceneDefaultsFor(model: PresetModel): SceneOptionsState {
  return {
    ...DEFAULT_SCENE,
    zoom: model.zoom ?? DEFAULT_SCENE.zoom,
    rotX: model.rotX ?? DEFAULT_SCENE.rotX,
    rotY: model.rotY ?? DEFAULT_SCENE.rotY,
  };
}

function randomPreset(): PresetModel {
  return PRESETS[Math.floor(Math.random() * PRESETS.length)] ?? PRESETS[0];
}

function resolveInitialPreset(): PresetModel {
  const id = routeInitialPresetId(ALL_PRESET_IDS);
  return (id ? PRESETS.find((p) => p.id === id) : null) ?? randomPreset();
}

export default function GalleryWorkbench() {
  const [initialPreset] = useState<PresetModel>(resolveInitialPreset);
  // Initialize from DEFAULT_SCENE so sliders always start at documented defaults.
  // usePresetLoader fires on first render and applies per-preset overrides,
  // so the preset's zoom/rotX/rotY still win — but only after the first tick.
  const [sceneOptions, setSceneOptions] = useState<SceneOptionsState>(DEFAULT_SCENE);
  const [presetId, setPresetId] = useState(initialPreset.id);
  const [meshUrl, setMeshUrl] = useState(initialPreset.url);
  const [metrics, setMetrics] = useState<GlyphcssMetrics>(EMPTY_METRICS);
  const [selectedAnimation, setSelectedAnimation] = useState("");
  const [animationClips, setAnimationClips] = useState<Array<{ index: number; name: string; duration: number }>>([]);
  const [modelSearch, setModelSearch] = useState("");
  const [openModelCategory, setOpenModelCategory] = useState<string | null>(null);
  const autoZoomPresetRef = useRef<string | null>(null);

  const updateScene = useCallback((partial: Partial<SceneOptionsState>) => {
    setSceneOptions((current) => ({ ...current, ...partial }));
  }, []);

  const { handleCameraChange } = useGuiCameraSync({ setSceneOptions });

  const dropped = useDroppedFiles({
    onDroppedSource: (source) => {
      autoZoomPresetRef.current = null;
      setRoutePresetId(null);
      setPresetId(source.id);
      setSelectedAnimation("");
      setSceneOptions((current) => ({
        ...current,
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
  const selectedPresetPickerCategory =
    pickerItems.find((preset) => preset.id === selectedPreset.id)?.category ??
    galleryBucketForPreset(selectedPreset);

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
  });

  const animationOptions = useMemo(() => {
    const options: Record<string, string> = { None: "" };
    for (const clip of animationClips) {
      options[`${clip.name} (${clip.duration.toFixed(2)}s)`] = String(clip.index);
    }
    return options;
  }, [animationClips]);

  const perspectiveMode = sceneOptions.perspective === false ? "orthographic" : "perspective";
  const perspectivePx = sceneOptions.perspective === false ? 8000 : sceneOptions.perspective;

  // Inspector is read-only for first cut — no triangle mutations.
  const inspectorMeshes: InspectorMesh[] = [];

  return (
    <div
      className={`dn-root${dropped.dropActive ? " dn-root--drop-active" : ""}`}
      onDragEnter={dropped.handleDragEnter}
      onDragOver={dropped.handleDragOver}
      onDragLeave={dropped.handleDragLeave}
      onDrop={dropped.handleDrop}
    >
      <ModelsSidebar
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
        onPresetClick={(id) => resetToPreset(id, { updateRoute: true })}
        attribution={selectedPreset.attribution}
      />

      <Inspector
        meshes={inspectorMeshes}
        onColorChange={() => {}}
      />

      <main className="dn-main">
        <div className="dn-viewport">
          <GlyphcssScene
            meshUrl={meshUrl}
            options={sceneOptions}
            onBuild={(ms) => setMetrics((m) => ({ ...m, bakeMs: ms }))}
            onCameraChange={handleCameraChange}
            onStatsChange={setMetrics}
            onAnimationInfoChange={({ clips }) => {
              setAnimationClips(clips);
            }}
            selectedAnimation={selectedAnimation}
            animationPaused={sceneOptions.animationPaused}
            animationTimeScale={sceneOptions.animationTimeScale}
          />
          <CopySceneButton />
        </div>
        <DropOverlay active={dropped.dropActive} />
      </main>

      <StatsOverlay />

      <Dock>
        <DockModel metrics={metrics} />
        <DockRendering
          renderMode={sceneOptions.renderMode}
          featureEdges={sceneOptions.featureEdges}
          glyphPalette={sceneOptions.glyphPalette}
          lineHeight={sceneOptions.lineHeight}
          useColors={sceneOptions.useColors}
          onUpdateScene={updateScene}
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
          showAxes={sceneOptions.showAxes}
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
          showGround={sceneOptions.showGround}
          showLight={sceneOptions.showLight}
          lightAzimuth={sceneOptions.lightAzimuth}
          lightElevation={sceneOptions.lightElevation}
          lightIntensity={sceneOptions.lightIntensity}
          lightColor={sceneOptions.lightColor}
          ambientIntensity={sceneOptions.ambientIntensity}
          ambientColor={sceneOptions.ambientColor}
          onUpdateScene={updateScene}
        />
      </Dock>

    </div>
  );
}
