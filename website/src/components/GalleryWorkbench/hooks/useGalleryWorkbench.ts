import type { GlyphEffectId } from "@glyphcss/effects";
import type { GlyphSemanticCellLineage } from "glyphcss";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GALLERY_BUCKET_ORDER,
  PRESETS,
  galleryBucketForPreset,
  galleryBucketRank,
} from "../../../features/gallery/data/index";
import {
  clearRouteEffectState,
  clearRouteSceneOptions,
  routeHasEffectState,
  routeHasSceneOptions,
  routeInitialEffectState,
  routeInitialSceneOptions,
  setRouteEffectState,
  setRoutePresetId,
  setRouteSceneOptions,
  useDroppedFiles,
  useEffectRouteSync,
  useGuiCameraSync,
  usePresetLoader,
  useRouteSync,
} from "../../../features/gallery/hooks/index";
import {
  DEFAULT_GALLERY_EFFECT_STATE,
  createGalleryEffectState,
  galleryEffectDefinition,
  sanitizeGalleryEffectParams,
} from "../../../features/gallery/model/effects";
import { gallerySemanticSceneFor } from "../../../features/gallery/model/semanticScene";
import { defaultZoomForModel } from "../../../features/gallery/model/smartDefaults";
import type {
  GalleryEffectParamValue,
  GalleryEffectState,
  PresetModel,
  SceneOptionsState,
} from "../../../features/gallery/model/types";
import { type InspectorMesh } from "../../Inspector";
import {
  ALL_PRESET_IDS,
  PRESET_PICKER_ITEMS,
  presetPickerItem,
  randomPreset,
  resolveInitialPreset,
  sceneDefaultsFor,
  sceneDefaultsForPresetId,
} from "../controllerHelpers";
import { useResponsiveViewportZoomScale } from "./useResponsiveViewportZoomScale";

export function useGalleryWorkbench() {
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

  // Real reason `colorEncoding: "atlas"` isn't available right now (`null`
  // when it is) — polled from the live runtime alongside stats (see
  // `<GlyphScene onAtlasAvailability>` below and `glyph-runtime.ts`'s
  // `getAtlasAvailability`). Never a hand-maintained guess.
  const [atlasReason, setAtlasReason] = useState<string | null>("Nothing rendered yet.");

  const [selectedAnimation, setSelectedAnimation] = useState("");

  const [animationClips, setAnimationClips] = useState<Array<{ index: number; name: string; duration: number }>>([]);

  const [modelSearch, setModelSearch] = useState("");

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

  const updateScene = useCallback(
    (partial: Partial<SceneOptionsState>) => {
      markSceneRouteDirty();
      setSceneOptions((current) => ({ ...current, ...partial }));
    },
    [markSceneRouteDirty],
  );

  const effectRouteTouchedRef = useRef(initialRouteHasEffectState);

  const [effectRouteRevision, setEffectRouteRevision] = useState(0);

  const markEffectRouteDirty = useCallback(() => {
    effectRouteTouchedRef.current = true;
    setEffectRouteRevision((revision) => revision + 1);
  }, []);

  const handleEffectChange = useCallback(
    (effectId: GlyphEffectId | null) => {
      markEffectRouteDirty();
      setEffectState((current) => {
        if (!effectId) return DEFAULT_GALLERY_EFFECT_STATE;
        return (
          createGalleryEffectState(effectId, {
            paused: current.paused,
            timeScale: current.timeScale,
          }) ?? DEFAULT_GALLERY_EFFECT_STATE
        );
      });
    },
    [markEffectRouteDirty],
  );

  const updateEffectSettings = useCallback(
    (partial: Partial<Pick<GalleryEffectState, "blend" | "paused" | "timeScale">>) => {
      markEffectRouteDirty();
      setEffectState((current) => ({ ...current, ...partial }));
    },
    [markEffectRouteDirty],
  );

  const updateEffectParams = useCallback(
    (partial: Record<string, GalleryEffectParamValue>) => {
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
    },
    [markEffectRouteDirty],
  );

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
        ...(camera.zoom !== undefined ? { zoom: camera.zoom / Math.max(responsiveZoomScale, 0.001) } : {}),
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
    () => (dropped.droppedSource ? [dropped.droppedSource.preset, ...PRESETS] : PRESETS),
    [dropped.droppedSource],
  );

  const pickerItems = useMemo(
    () =>
      dropped.droppedSource
        ? [presetPickerItem(dropped.droppedSource.preset, true), ...PRESET_PICKER_ITEMS]
        : PRESET_PICKER_ITEMS,
    [dropped.droppedSource],
  );

  const selectedPreset = availablePresets.find((preset) => preset.id === presetId) ?? PRESETS[0];

  const selectedDroppedSource = dropped.droppedSource?.id === selectedPreset.id ? dropped.droppedSource : null;

  const selectedSceneDefaults = useMemo(() => sceneDefaultsFor(selectedPreset), [selectedPreset]);

  const selectedPresetPickerCategory =
    pickerItems.find((preset) => preset.id === selectedPreset.id)?.category ?? galleryBucketForPreset(selectedPreset);

  const semanticScene = useMemo(
    () =>
      selectedPreset.kind === "primitive"
        ? gallerySemanticSceneFor(selectedPreset.id, selectedPreset.generatePolygons())
        : null,
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

  const renderPresentation: "semantic" | SceneOptionsState["renderMode"] =
    glyphOutput === "semantic" ? "semantic" : sceneOptions.renderMode;

  const handleRenderModeChange = useCallback(
    (mode: "wireframe" | "solid" | "ink" | "semantic") => {
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
    },
    [sceneOptions.renderMode, semanticAvailable, updateScene],
  );

  const trimmedModelSearch = modelSearch.trim().toLowerCase();

  const filteredPresetItems = useMemo(() => {
    if (!trimmedModelSearch) return pickerItems;
    return pickerItems.filter(
      (preset) =>
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
    const orderedCategories = Array.from(buckets.values()).sort(
      (a, b) => galleryBucketRank(a.id) - galleryBucketRank(b.id),
    );
    for (const category of orderedCategories) {
      category.models.sort((a, b) => a.label.localeCompare(b.label));
    }
    return orderedCategories;
  }, [filteredPresetItems, trimmedModelSearch]);

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

  const resetToPreset = useCallback(
    (id: string, options: { updateRoute?: boolean } = {}) => {
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
    },
    [availablePresets, dropped.droppedSource],
  );

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

  const selectedEffectDefinition = useMemo(() => galleryEffectDefinition(effectState.effectId), [effectState.effectId]);

  const runtimeEffect = useMemo(
    () =>
      selectedEffectDefinition
        ? {
            effect: selectedEffectDefinition,
            params: effectState.params,
            blend: effectState.blend,
            paused: effectState.paused,
            timeScale: effectState.timeScale,
          }
        : null,
    [selectedEffectDefinition, effectState],
  );

  const animationOptions = useMemo(() => {
    const options: Record<string, string> = { None: "" };
    for (const clip of animationClips) {
      options[`${clip.name} (${clip.duration.toFixed(2)}s)`] = String(clip.index);
    }
    return options;
  }, [animationClips]);

  const perspectiveMode: "orthographic" | "perspective" =
    sceneOptions.perspective === false ? "orthographic" : "perspective";

  const perspectivePx = sceneOptions.perspective === false ? 32000 : sceneOptions.perspective;

  // Inspector is read-only for first cut — no triangle mutations.
  const inspectorMeshes: InspectorMesh[] = [];

  // Close the mobile drawer on Escape.
  useEffect(() => {
    if (!mobilePanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobilePanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobilePanel]);
  return {
    dropped,
    mobilePanel,
    modelSearch,
    setModelSearch,
    handleRandomPreset,
    modelCategories,
    selectedPresetPickerCategory,
    presetId,
    resetToPreset,
    setMobilePanel,
    selectedPreset,
    inspectorMeshes,
    viewportRef,
    meshUrl,
    renderSceneOptions,
    handleCameraChange,
    setAtlasReason,
    setAnimationClips,
    selectedAnimation,
    sceneOptions,
    runtimeEffect,
    glyphOutput,
    semanticScene,
    setSemanticCell,
    effectState,
    selectedEffectDefinition,
    renderPresentation,
    semanticAvailable,
    atlasReason,
    handleRenderModeChange,
    updateScene,
    semanticCell,
    handleEffectChange,
    updateEffectSettings,
    updateEffectParams,
    animationOptions,
    animationClips,
    setSelectedAnimation,
    perspectiveMode,
    perspectivePx,
  };
}
