import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PolyMeshHandle as ReactPolyMeshHandle,
  Polygon,
  Vec3 as ReactVec3,
} from "@layoutit/polycss-react";
import type {
  PolyMeshHandle as VanillaPolyMeshHandle,
} from "@layoutit/polycss";
import {
  Inspector as InspectorPanel,
  type InspectorColorGroup,
  type InspectorMesh,
} from "../Inspector";
import { VanillaScene } from "../VanillaScene";
import { ReactScene } from "../ReactScene";
import { Dock } from "../Dock";
import { ModelsSidebar } from "../ModelsSidebar";
import { DropOverlay } from "../DropOverlay";
import { StatsOverlay } from "../StatsOverlay";
import type { GizmoMode, SceneOptionsState, DomMetrics } from "../types";
import "./gallery-workbench.css";
import type {
  PresetModel,
  LoadedModel,
  ParserOptionsState,
} from "./types";
import {
  PRESETS,
  GALLERY_BUCKET_ORDER,
  galleryBucketForPreset,
  galleryBucketRank,
  labelFromFile,
  stripParenthesizedText,
} from "./presets";
import {
  DOM_OVERPAINT_CACHE_EVENT,
  EMPTY_METRICS,
  measureDom,
} from "./helpers/domMetrics";
import {
  applyDebugMatrixPrecision,
  applyDebugBorderShapePrecision,
  applyDebugTriangleBrushPrecision,
  applyDebugSolidColorHex,
  applyDebugInlineStyleOrder,
  applyDebugInlineStyleMinify,
} from "./helpers/debugPrecision";
import { defaultZoomForModel } from "./helpers/smartDefaults";
import { directionalFromOptions, ambientFromOptions } from "./helpers/lighting";
import {
  useDroppedFiles,
  usePresetLoader,
  useScenePolygons,
  useAnimationFrames,
  useFpvSpawn,
  useRouteSync,
  useGuiCameraSync,
  setRoutePresetId,
  routeInitialPresetId,
} from "./hooks";
import type { ObjParseOptions, GltfParseOptions, VoxParseOptions } from "@layoutit/polycss";

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
  renderer: "vanilla",
  animationPaused: false,
  animationTimeScale: 1,
  autoCenter: true,
  interactive: true,
  animate: false,
  showAxes: false,
  selection: false,
  hoverEffects: false,
  showLight: false,
  zoom: PRESETS[0].zoom ?? 0.35,
  rotX: PRESETS[0].rotX ?? 65,
  rotY: PRESETS[0].rotY ?? 45,
  perspective: false,
  lightAzimuth: 50,
  lightElevation: 45,
  lightIntensity: 1,
  lightColor: "#ffffff",
  ambientIntensity: 0.4,
  ambientColor: "#ffffff",
  textureLighting: "baked",
  textureQuality: "auto",
  experimentalTextureEdgeRepair: true,
  matrixPrecision: "exact",
  borderShapePrecision: "exact",
  meshResolution: "lossy",
  meshInteriorFill: false,
  outlinePolygons: false,
  dragMode: "orbit",
  target: [0, 0, 0],
  disableStrategies: [],
  castShadow: false,
  showGround: false,
  fpvLook: true,
  fpvMove: true,
  fpvJump: true,
  fpvCrouch: true,
  fpvMoveSpeed: 30,
  fpvJumpVelocity: 25,
  fpvGravity: 60,
  fpvEyeHeight: 6,
  fpvCrouchHeight: 3,
  fpvLookSensitivity: 0.15,
  fpvInvertY: false,
};

const DEFAULT_PARSER: ParserOptionsState = {
  targetSize: 60,
  gridShift: 1,
  defaultColor: "#8b95a1",
};

function parserDefaultsFor(model: PresetModel): Partial<ParserOptionsState> {
  const options = model.options as (ObjParseOptions & GltfParseOptions & VoxParseOptions) | undefined;
  return {
    ...(typeof options?.targetSize === "number" ? { targetSize: options.targetSize } : {}),
    ...(typeof options?.gridShift === "number" ? { gridShift: options.gridShift } : {}),
    ...(typeof options?.defaultColor === "string" ? { defaultColor: options.defaultColor } : {}),
  };
}

function randomPreset(): PresetModel {
  return PRESETS[Math.floor(Math.random() * PRESETS.length)] ?? PRESETS[0];
}

function sceneDefaultsFor(model: PresetModel): SceneOptionsState {
  return {
    ...DEFAULT_SCENE,
    zoom: model.zoom ?? DEFAULT_SCENE.zoom,
    rotX: model.rotX ?? DEFAULT_SCENE.rotX,
    rotY: model.rotY ?? DEFAULT_SCENE.rotY,
  };
}

function parserStateFor(model: PresetModel): ParserOptionsState {
  return {
    ...DEFAULT_PARSER,
    ...parserDefaultsFor(model),
  };
}

function resolveInitialPreset(): PresetModel {
  const id = routeInitialPresetId(ALL_PRESET_IDS);
  return (id ? PRESETS.find((p) => p.id === id) : null) ?? randomPreset();
}

export default function GalleryWorkbench() {
  const [initialPreset] = useState<PresetModel>(resolveInitialPreset);
  const [sceneOptions, setSceneOptions] = useState<SceneOptionsState>(() => sceneDefaultsFor(initialPreset));
  const [parserOptions, setParserOptions] = useState<ParserOptionsState>(() => parserStateFor(initialPreset));
  const [presetId, setPresetId] = useState(initialPreset.id);
  const [loaded, setLoaded] = useState<LoadedModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedAnimation, setSelectedAnimation] = useState("");
  const [metrics, setMetrics] = useState<DomMetrics>(EMPTY_METRICS);
  const [vanillaBuildMs, setVanillaBuildMs] = useState(0);
  const [modelSearch, setModelSearch] = useState("");
  const [openModelCategory, setOpenModelCategory] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const autoZoomPresetRef = useRef<string | null>(null);
  const autoAmbientPresetRef = useRef<string | null>(null);
  const autoKeyPresetRef = useRef<string | null>(null);

  // Selection + drag state for the React renderer's <PolyMesh> wrapper.
  // Lives at this level so a model swap can reset both — the gizmo
  // shouldn't follow a stale handle, and a freshly loaded mesh should
  // sit at its authored origin.
  const meshRef = useRef<ReactPolyMeshHandle>(null);
  const [meshPosition, setMeshPosition] = useState<ReactVec3>([0, 0, 0]);
  const [meshRotation, setMeshRotation] = useState<ReactVec3>([0, 0, 0]);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>("translate");
  const [selectedMeshes, setSelectedMeshes] = useState<ReactPolyMeshHandle[]>([]);
  // Mirror of PolyTransformControls' drag state — three.js convention is to
  // disable OrbitControls while a transform gizmo is being dragged so
  // the camera doesn't co-rotate. Same idea here: gate PolyOrbitControls'
  // drag/wheel on this flag.
  const [gizmoDragging, setGizmoDragging] = useState(false);
  // Hover state for the mesh — wired the r3f / three.js way via
  // onPointerOver / onPointerOut on <PolyMesh>. Demonstrates the
  // mesh-event API (events.ts → InteractionProps) — same shape as
  // r3f, no raycasting needed because polycss uses DOM events.
  const [hoveredMeshId, setHoveredMeshId] = useState<string | null>(null);
  // Mesh handle for the currently rendered model (vanilla path only). The
  // Inspector folder uses this to push color-group edits back into the
  // scene via setPolygons. Set by VanillaScene's onMeshHandleChange.
  const activeMeshHandleRef = useRef<VanillaPolyMeshHandle | null>(null);
  // Vanilla selection state — kept separate from React's
  // `selectedMeshes` because vanilla MeshHandles aren't comparable to
  // React PolyMeshHandles. Stored as IDs since that's what both paths
  // can agree on for the toolbar display.
  const [vanillaSelectedIds, setVanillaSelectedIds] = useState<string[]>([]);

  const updateScene = useCallback((partial: Partial<SceneOptionsState>) => {
    setSceneOptions((current) => ({ ...current, ...partial }));
  }, []);

  const { handleCameraChange } = useGuiCameraSync({ setSceneOptions });

  const dropped = useDroppedFiles({
    onDroppedSource: (source) => {
      autoZoomPresetRef.current = null;
      autoAmbientPresetRef.current = null;
      autoKeyPresetRef.current = null;
      setRoutePresetId(null);
      setPresetId(source.id);
      setSelectedAnimation("");
      setParserOptions((current) => ({
        ...current,
        ...parserDefaultsFor(source.preset),
      }));
      setSceneOptions((current) => ({
        ...current,
        rotX: source.preset.rotX ?? current.rotX,
        rotY: source.preset.rotY ?? current.rotY,
      }));
    },
    onDropError: (message) => setLoadError(message),
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
      galleryBucketRank(a.id) - galleryBucketRank(b.id)
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
    return modelCategories.map((category) => `debug-model-cat-${slug(category.id) || "category"}`);
  }, [modelCategories]);

  useEffect(() => {
    if (trimmedModelSearch) {
      return;
    }
    setOpenModelCategory((prev) => (prev === selectedPresetPickerCategory ? prev : selectedPresetPickerCategory));
  }, [trimmedModelSearch, selectedPresetPickerCategory]);

  usePresetLoader({
    selectedPreset,
    selectedDroppedSource,
    parserOptions,
    onLoaded: setLoaded,
    onLoadError: (msg) => {
      setLoaded(null);
      setLoadError(msg || null);
    },
    onLoadingChange: setLoading,
    onSceneDefaults: (zoom, ambientIntensity, lightIntensity) => {
      setSceneOptions((current) => {
        const nextZoom = zoom ?? current.zoom;
        const nextAmbient = ambientIntensity ?? current.ambientIntensity;
        const nextKey = lightIntensity ?? current.lightIntensity;
        if (
          current.zoom === nextZoom &&
          current.ambientIntensity === nextAmbient &&
          current.lightIntensity === nextKey
        ) return current;
        return { ...current, zoom: nextZoom, ambientIntensity: nextAmbient, lightIntensity: nextKey };
      });
    },
    autoZoomPresetRef,
    autoAmbientPresetRef,
    autoKeyPresetRef,
  });

  // Drop selection + reset gizmo position when the model changes. The
  // PolyMesh wrapper persists across model swaps, so without this the
  // user would inherit the previous model's drag offset.
  useEffect(() => {
    setSelectedMeshes([]);
    setVanillaSelectedIds([]);
    setMeshPosition([0, 0, 0]);
    setMeshRotation([0, 0, 0]);
  }, [loaded?.label]);

  const directionalLight = useMemo(
    () => directionalFromOptions(sceneOptions),
    [
      sceneOptions.lightAzimuth,
      sceneOptions.lightElevation,
      sceneOptions.lightColor,
      sceneOptions.lightIntensity,
    ],
  );
  const ambientLight = useMemo(
    () => ambientFromOptions(sceneOptions),
    [sceneOptions.ambientColor, sceneOptions.ambientIntensity],
  );
  const textureQuality = sceneOptions.textureQuality;

  const animationClips = loaded?.animation?.clips ?? [];
  const hasAnimation = animationClips.length > 0;
  const activeAnimation = useMemo(
    () => animationClips.find((clip) => String(clip.index) === selectedAnimation) ?? null,
    [animationClips, selectedAnimation],
  );
  const hasActiveAnimation = activeAnimation !== null;

  const animation = useAnimationFrames({
    loaded,
    activeAnimation,
    renderer: sceneOptions.renderer,
    animationPaused: sceneOptions.animationPaused,
    animationTimeScale: sceneOptions.animationTimeScale,
  });

  const { scenePolygons, helperScale, helperTarget } = useScenePolygons({
    loaded,
    hasActiveAnimation,
    meshResolution: sceneOptions.meshResolution,
    renderer: sceneOptions.renderer,
    reactAnimatedPolygons: animation.reactAnimatedPolygons,
    meshInteriorFill: sceneOptions.meshInteriorFill,
  });

  useFpvSpawn({
    dragMode: sceneOptions.dragMode,
    autoCenter: sceneOptions.autoCenter,
    perspective: sceneOptions.perspective,
    rotY: sceneOptions.rotY,
    scenePolygons,
    updateScene,
  });

  const resetToPreset = useCallback((id: string, options: { updateRoute?: boolean } = {}) => {
    const next = availablePresets.find((preset) => preset.id === id);
    autoZoomPresetRef.current = null;
    autoAmbientPresetRef.current = null;
    autoKeyPresetRef.current = null;
    setPresetId(id);
    setSelectedAnimation("");
    animation.setReactAnimatedPolygons(null);
    if (!next) return;
    if (options.updateRoute) {
      if (dropped.droppedSource?.id === next.id) setRoutePresetId(null);
      else setRoutePresetId(next.id);
    }
    setParserOptions((current) => ({
      ...current,
      ...parserDefaultsFor(next),
    }));
    setSceneOptions((current) => ({
      ...current,
      rotX: next.rotX ?? current.rotX,
      rotY: next.rotY ?? current.rotY,
    }));
  }, [availablePresets, dropped.droppedSource, animation.setReactAnimatedPolygons]);

  const handleRandomPreset = useCallback(() => {
    const next = randomPreset();
    resetToPreset(next.id, { updateRoute: true });
  }, [resetToPreset]);

  useRouteSync({
    presetId,
    presetIds: ALL_PRESET_IDS,
    resetToPreset,
  });

  useEffect(() => {
    const root = viewportRef.current;
    if (!root) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      setMetrics(measureDom(root));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    window.addEventListener(DOM_OVERPAINT_CACHE_EVENT, schedule);
    return () => {
      observer.disconnect();
      window.removeEventListener(DOM_OVERPAINT_CACHE_EVENT, schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    const root = viewportRef.current;
    if (!root) return;
    let raf = 0;
    const apply = () => {
      raf = 0;
      applyDebugMatrixPrecision(root, sceneOptions.matrixPrecision);
      applyDebugBorderShapePrecision(root, sceneOptions.borderShapePrecision);
      applyDebugTriangleBrushPrecision(root);
      applyDebugSolidColorHex(root);
      applyDebugInlineStyleOrder(root);
      applyDebugInlineStyleMinify(root);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style"],
    });
    return () => {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [
    sceneOptions.matrixPrecision,
    sceneOptions.borderShapePrecision,
    sceneOptions.renderer,
    sceneOptions.textureLighting,
    sceneOptions.textureQuality,
    scenePolygons,
    vanillaBuildMs,
  ]);

  const rendererDebugKey = useMemo(
    () => [
      sceneOptions.renderer,
      sceneOptions.matrixPrecision,
      sceneOptions.borderShapePrecision,
      sceneOptions.textureLighting,
      sceneOptions.textureQuality,
      sceneOptions.experimentalTextureEdgeRepair ? "edge-repair" : "no-edge-repair",
      sceneOptions.autoCenter,
      sceneOptions.perspective === false ? "none" : sceneOptions.perspective,
      loaded?.label ?? "none",
    ].join(":"),
    [
      sceneOptions.renderer,
      sceneOptions.matrixPrecision,
      sceneOptions.borderShapePrecision,
      sceneOptions.textureLighting,
      sceneOptions.textureQuality,
      sceneOptions.experimentalTextureEdgeRepair,
      sceneOptions.autoCenter,
      sceneOptions.perspective,
      loaded?.label,
    ],
  );

  const animationOptions = useMemo(() => {
    const options: Record<string, string> = { None: "" };
    for (const clip of animationClips) {
      options[`${clip.name} (${clip.duration.toFixed(2)}s)`] = String(clip.index);
    }
    return options;
  }, [animationClips]);
  const perspectiveMode = sceneOptions.perspective === false ? "orthographic" : "perspective";
  const perspectivePx = sceneOptions.perspective === false ? 8000 : sceneOptions.perspective;

  // Inspector data — grouped by mesh, then by polygon color. Recomputed
  // when scenePolygons or the loaded model change. Mutations to a
  // polygon's color via the picker do NOT change the scenePolygons
  // reference, so this memo doesn't re-fire on each tweak and the swatch
  // local state stays in sync.
  const inspectorMeshes = useMemo<InspectorMesh[]>(() => {
    if (scenePolygons.length === 0) return [];
    const colorGroups = new Map<string, Polygon[]>();
    const textured: Polygon[] = [];
    for (const p of scenePolygons) {
      if (p.texture) {
        textured.push(p);
        continue;
      }
      if (!p.color) continue;
      let arr = colorGroups.get(p.color);
      if (!arr) {
        arr = [];
        colorGroups.set(p.color, arr);
      }
      arr.push(p);
    }
    if (colorGroups.size === 0 && textured.length === 0) return [];
    const sortedColors = [...colorGroups.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([color, polys]) => ({
        color,
        count: polys.length,
        editable: true,
        polygons: polys,
      }));
    const groups: InspectorColorGroup[] = sortedColors;
    if (textured.length > 0) {
      groups.push({
        color: "textured",
        count: textured.length,
        editable: false,
        polygons: textured,
      });
    }
    const label = loaded?.label ?? "model";
    return [{ id: label, label, groups }];
  }, [scenePolygons, loaded?.label]);

  const handleInspectorColorChange = useCallback(
    (
      _mesh: InspectorMesh,
      group: InspectorColorGroup,
      next: string,
    ) => {
      for (const p of group.polygons) p.color = next;
      const handle = activeMeshHandleRef.current;
      // Pass the *source* polygons (pre-merge) — the renderer holds a
      // merged copy that doesn't see in-place edits. setPolygons without
      // an explicit merge flag reuses the mesh's current merge setting
      // (true for static models, false during animation playback).
      if (handle) handle.setPolygons(scenePolygons);
    },
    [scenePolygons],
  );

  return (
    <div
      className={`dn-root${dropped.dropActive ? " dn-root--drop-active" : ""}`}
      data-camera-mode={sceneOptions.dragMode}
      style={{
        // FPV: host's CSS perspective must match the scene's perspective so
        // the FPV controls' lookOffset (perspective/tile) and the host viewer
        // plane agree on where the camera "eye" lives in CSS space. Without
        // this, raising the scene perspective swings target on a longer lever
        // arm while the host's plane stays at 2000px → the scene visibly
        // jumps in Z and pitches dramatically on mouselook.
        ["--fpv-perspective" as const]: typeof sceneOptions.perspective === "number"
          ? `${sceneOptions.perspective}px`
          : "2000px",
      }}
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

      <InspectorPanel
        meshes={inspectorMeshes}
        onColorChange={handleInspectorColorChange}
      />

      <main className="dn-main">
        <div
          className={`dn-viewport${sceneOptions.outlinePolygons ? " dn-viewport--outline-polygons" : ""}`}
          ref={viewportRef}
        >
          {sceneOptions.renderer === "vanilla" ? (
            <VanillaScene
              key={rendererDebugKey}
              polygons={scenePolygons}
              options={sceneOptions}
              directionalLight={directionalLight}
              ambientLight={ambientLight}
              showAxes={sceneOptions.showAxes}
              showLight={sceneOptions.showLight}
              showGround={sceneOptions.showGround}
              helperScale={helperScale}
              helperTarget={helperTarget}
              mergePolygonsForMesh={!hasActiveAnimation}
              stableDomForMesh={hasActiveAnimation}
              animationKey={activeAnimation ? `${selectedAnimation}:${loaded?.label ?? ""}` : undefined}
              animationFrameFactory={animation.vanillaAnimationFrameFactory}
              onBuild={setVanillaBuildMs}
              onCameraChange={handleCameraChange}
              enableSelection={sceneOptions.selection}
              meshId={loaded?.label ?? "model"}
              onSelectionChange={setVanillaSelectedIds}
              gizmoMode={gizmoMode}
              enableHover={sceneOptions.hoverEffects}
              onHoverChange={setHoveredMeshId}
              onMeshHandleChange={(h) => { activeMeshHandleRef.current = h; }}
            />
          ) : (
            <ReactScene
              rendererDebugKey={rendererDebugKey}
              sceneOptions={sceneOptions}
              scenePolygons={scenePolygons}
              directionalLight={directionalLight}
              ambientLight={ambientLight}
              textureQuality={textureQuality}
              gizmoDragging={gizmoDragging}
              setGizmoDragging={setGizmoDragging}
              handleCameraChange={handleCameraChange}
              loaded={loaded}
              selectedMeshes={selectedMeshes}
              setSelectedMeshes={setSelectedMeshes}
              meshRef={meshRef}
              meshPosition={meshPosition}
              setMeshPosition={setMeshPosition}
              meshRotation={meshRotation}
              setMeshRotation={setMeshRotation}
              hoveredMeshId={hoveredMeshId}
              setHoveredMeshId={setHoveredMeshId}
              gizmoMode={gizmoMode}
              helperScale={helperScale}
              helperTarget={helperTarget}
            />
          )}
        </div>
        <DropOverlay active={dropped.dropActive} />
      </main>

      <StatsOverlay />

      <Dock
        sceneOptions={sceneOptions}
        metrics={metrics}
        selectedAnimation={selectedAnimation}
        selectedPreset={selectedPreset}
        loaded={loaded}
        animationOptions={animationOptions}
        animationClipCount={animationClips.length}
        hasActiveAnimation={hasActiveAnimation}
        activeAnimation={activeAnimation !== null}
        perspectivePx={perspectivePx}
        perspectiveMode={perspectiveMode}
        gizmoMode={gizmoMode}
        defaultZoomForModel={defaultZoomForModel}
        onUpdateScene={updateScene}
        onAnimationChange={setSelectedAnimation}
        onResetAnimatedPolygons={() => animation.setReactAnimatedPolygons(null)}
        onGizmoModeChange={setGizmoMode}
        onSelectAnimationClear={() => setSelectedAnimation("")}
        loading={loading}
        loadError={loadError}
      />
    </div>
  );
}
