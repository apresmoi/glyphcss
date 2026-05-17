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

/**
 * Floating "Copy" button overlaid on the viewport. Grabs the rendered ASCII
 * text from the strip and writes it to the clipboard. Reads the strip's
 * `innerText` (HTML stripped) so spans-with-color come out as plain glyphs.
 */
function CopySceneButton() {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    const strip = document.querySelector(".glyphcss-demo__strip") as HTMLElement | null;
    if (!strip) return;
    try {
      await navigator.clipboard.writeText(strip.innerText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard write rejected (permissions, insecure origin, etc.). No-op.
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
