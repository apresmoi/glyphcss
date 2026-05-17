import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PolyFirstPersonControlsHandle,
  PolyMeshHandle,
  PolyTransformControlsObjectChangeEvent,
} from "@layoutit/polycss-react";
import { directionalFromOptions, ambientFromOptions } from "../GalleryWorkbench/helpers/lighting";
import { PRESETS } from "../GalleryWorkbench/presets";
import type { SceneOptionsState } from "../types";
import { ModelsSidebar } from "../ModelsSidebar";
import { StatsOverlay } from "../StatsOverlay";
import "../GalleryWorkbench/gallery-workbench.css";
import "./builder-workbench.css";
import { SCENE_PRESET_ID_PREFIX } from "./scenes";
import { DEFAULT_SCENE } from "./defaults";
import { usePlacements } from "./hooks/usePlacements";
import { useSceneLoader } from "./hooks/useSceneLoader";
import { usePlacementMode } from "./hooks/usePlacementMode";
import { useCameraShortcuts } from "./hooks/useCameraShortcuts";
import { useSceneRender } from "./hooks/useSceneRender";
import { useSidebarItems } from "./hooks/useSidebarItems";
import { useTerrain } from "./hooks/useTerrain";
import { meshBbox } from "./geometry/meshBbox";
import { placeMeshOnFloor } from "./geometry/placement";
import { sampleTerrain, rotationForSlope, type TerrainVertices } from "./geometry/terrain";
import { BuilderScene } from "./components/BuilderScene";
import { BuilderSceneOutliner } from "./components/BuilderSceneOutliner";
import { BuilderCameraModePill } from "./components/BuilderCameraModePill";
import { BuilderToolPalette } from "./components/BuilderToolPalette";
import { BuilderTargetMode } from "./components/BuilderTargetMode";
import { BuilderDock } from "./components/BuilderDock";
import type { PlacedItem, TargetMode, ToolMode } from "./types";

/** Re-anchor a placed item to the current terrain at its (worldX, worldY):
 *  recomputes Z so the mesh's bottom sits on the sampled surface (with
 *  the COMBINED scale fitScale × scale, so user-scaling preserves the
 *  floor anchor) and rotation so the mesh tilts to match the local slope.
 *  Items without `rawPolygons` (scene-preset placeholders before lazy
 *  load) are passed through unchanged. */
function snapPlacement(
  item: PlacedItem,
  terrainVertices: TerrainVertices,
  gridResolution: number,
): PlacedItem {
  if (!item.rawPolygons) return item;
  const bbox = meshBbox(item.rawPolygons);
  const sample = sampleTerrain(terrainVertices, gridResolution, item.worldX, item.worldY);
  const position = placeMeshOnFloor(item.worldX, item.worldY, bbox, item.fitScale * item.scale, sample.z);
  const rotation = rotationForSlope(sample.slopeX, sample.slopeY);
  return { ...item, position, rotation };
}

export default function BuilderWorkbench() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Imperative handle for PolyFirstPersonControls — read by useFpvCull to
  // pull the live camera origin without round-tripping through React state.
  const fpvControlsRef = useRef<PolyFirstPersonControlsHandle | null>(null);

  const [sceneOptions, setSceneOptions] = useState<SceneOptionsState>(() => ({ ...DEFAULT_SCENE }));
  const updateScene = useCallback((partial: Partial<SceneOptionsState>) => {
    setSceneOptions((prev) => ({ ...prev, ...partial }));
  }, []);

  const [gizmoDragging, setGizmoDragging] = useState(false);
  const [gizmoMode, setGizmoMode] = useState<"translate" | "rotate">("translate");
  const [toolMode, setToolMode] = useState<ToolMode>("pointer");
  // Default to "face" — raising a face turns the whole cell into a
  // flat plateau, which reads more naturally as "stamping geometry"
  // than vertex-target tent-shapes. The user can flip to vertex for
  // finer control.
  const [targetMode, setTargetMode] = useState<TargetMode>("face");

  const {
    placedItems,
    selectedId,
    setSelectedId,
    placementCounter,
    buildPlacement,
    appendItems,
    updateItem,
    mapItems,
    handleDeleteItem,
    meshHandlesRef,
    getMeshRefCallback,
    selectedIdRef,
    handleDeleteSelectedRef,
  } = usePlacements({ meshResolution: sceneOptions.meshResolution });

  const { handleAddScene } = useSceneLoader({
    placedItems,
    appendItems,
    updateItem,
    buildPlacement,
    placementCounter,
    dragMode: sceneOptions.dragMode,
    fpvRenderDistance: sceneOptions.fpvRenderDistance,
    targetWorld: sceneOptions.target,
    fpvControlsRef,
    meshResolution: sceneOptions.meshResolution,
    updateScene,
  });

  // Terrain editor — engaged when toolMode is anything other than "pointer".
  // Declared BEFORE usePlacementMode because placement reads the
  // heightmap to land meshes on raised terrain with the local slope
  // tilt. The grid polygons in useSceneRender also consume this so the
  // floor grid bends with the terrain — there's no separate solid-fill
  // mesh anymore, the grid IS the terrain.
  const { hoverPolygons, vertices: terrainVertices } = useTerrain({ toolMode, targetMode, sceneOptions });

  const {
    placementDraft,
    ghostPolygons,
    handleAddPreset,
    loadingPresetId,
  } = usePlacementMode({
    sceneOptions,
    appendItems,
    setSelectedId,
    placementCounter,
    updateScene,
    terrainVertices,
    targetMode,
  });

  useCameraShortcuts({ dragMode: sceneOptions.dragMode, updateScene });

  // Terrain-follow: when the heightmap changes, re-snap every placed
  // item to the current surface at its (worldX, worldY). Note: this
  // overwrites any user-applied gizmo rotation on the next terrain
  // edit, which mirrors what the original placement does on commit —
  // keep terrain shape stable when fine-tuning rotation.
  useEffect(() => {
    mapItems((it) => snapPlacement(it, terrainVertices, sceneOptions.gridResolution));
  }, [terrainVertices, mapItems, sceneOptions.gridResolution]);

  const { renderedPolygonsById, renderItems, gridPolygons } = useSceneRender({
    placedItems,
    selectedId,
    sceneOptions,
    fpvControlsRef,
    updateScene,
    terrainVertices,
  });

  const { modelSearch, setModelSearch, modelCategories, modelTreeId, isCategoryOpen, handleToggleCategory } =
    useSidebarItems();

  // Derived lighting + perspective mode for Dock + scene rendering.
  const directionalLight = useMemo(
    () => directionalFromOptions(sceneOptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sceneOptions.lightAzimuth, sceneOptions.lightElevation, sceneOptions.lightIntensity, sceneOptions.lightColor],
  );
  const ambientLight = useMemo(
    () => ambientFromOptions(sceneOptions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sceneOptions.ambientIntensity, sceneOptions.ambientColor],
  );
  const perspectiveMode = sceneOptions.perspective === false ? "orthographic" : "perspective";
  const perspectivePx = sceneOptions.perspective === false ? 8000 : sceneOptions.perspective;

  const selected = useMemo(
    () => placedItems.find((it) => it.id === selectedId) ?? null,
    [placedItems, selectedId],
  );

  const handleSidebarClick = useCallback((id: string) => {
    if (id.startsWith(SCENE_PRESET_ID_PREFIX)) {
      void handleAddScene(id);
    } else {
      void handleAddPreset(id);
    }
  }, [handleAddPreset, handleAddScene]);

  // Delete (or Backspace on Mac) removes the selected item. Ignored while
  // focus is in a text input so it doesn't fire when typing in the search box.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!selectedIdRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        handleDeleteSelectedRef.current?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleSelectionChange = useCallback((handles: PolyMeshHandle[]) => {
    const first = handles[0] ?? null;
    if (!first) { setSelectedId(null); return; }
    const id = (first as unknown as { id?: string }).id;
    if (typeof id === "string") setSelectedId(id);
  }, [setSelectedId]);

  const handleGizmoObjectChange = useCallback((event: PolyTransformControlsObjectChangeEvent) => {
    if (!selected) return;
    const nextPosition = event.position;
    if (nextPosition) {
      const TILE = 50;
      const dxCss = nextPosition[1] - selected.position[1];
      const dyCss = nextPosition[0] - selected.position[0];
      // Translate via the gizmo updates (worldX, worldY); the Z and tilt
      // are re-derived from the terrain at the new XY so the dragged
      // mesh follows the surface instead of floating off it. The Z arm
      // of the gizmo therefore has no effect on a floor-anchored item —
      // intentional (use scale to grow upward; floor stays the floor).
      const newWorldX = selected.worldX + dxCss / TILE;
      const newWorldY = selected.worldY + dyCss / TILE;
      const snapped = snapPlacement(
        { ...selected, worldX: newWorldX, worldY: newWorldY },
        terrainVertices,
        sceneOptions.gridResolution,
      );
      updateItem(selected.id, {
        worldX: newWorldX,
        worldY: newWorldY,
        position: snapped.position,
        rotation: snapped.rotation,
      });
    } else if (event.rotation) {
      updateItem(selected.id, { rotation: event.rotation });
    }
  }, [selected, updateItem, terrainVertices, sceneOptions.gridResolution]);

  // Scale slider — apply new scale AND re-anchor the bottom of the mesh
  // to the surface. Without this, scaling around the bbox centre would
  // make the item sink into / lift off the floor.
  const handleScaleSelected = useCallback((scale: number) => {
    mapItems((it) =>
      it.id === selectedIdRef.current
        ? snapPlacement({ ...it, scale }, terrainVertices, sceneOptions.gridResolution)
        : it,
    );
  }, [mapItems, terrainVertices, sceneOptions.gridResolution, selectedIdRef]);

  const sceneFolderContent = (
    <BuilderSceneOutliner
      placedItems={placedItems}
      selectedId={selectedId}
      gizmoMode={gizmoMode}
      onSelectItem={setSelectedId}
      onDeleteItem={handleDeleteItem}
      onGizmoModeChange={setGizmoMode}
    />
  );

  return (
    <div className={`dn-root${placementDraft ? " is-placement-mode" : ""}`}>
      <ModelsSidebar
        modelSearch={modelSearch}
        onModelSearchChange={setModelSearch}
        onImportClick={() => fileInputRef.current?.click()}
        fileInputRef={fileInputRef}
        onFileInputChange={() => {/* Drag-import not supported yet */}}
        onRandomPreset={() => {
          const rnd = PRESETS[Math.floor(Math.random() * PRESETS.length)];
          handleAddPreset(rnd.id);
        }}
        modelCategories={modelCategories}
        isCategoryOpen={isCategoryOpen}
        onToggleCategory={handleToggleCategory}
        modelTreeId={modelTreeId}
        presetId={loadingPresetId ?? ""}
        onPresetClick={handleSidebarClick}
      />

      <main className="dn-main">
        <div className={`dn-viewport${placementDraft ? " is-placement-mode" : ""}`}>
          <BuilderScene
            sceneOptions={sceneOptions}
            updateScene={updateScene}
            directionalLight={directionalLight}
            ambientLight={ambientLight}
            gridPolygons={gridPolygons}
            ghostPolygons={ghostPolygons}
            terrainHoverPolygons={hoverPolygons}
            placementDraft={!!placementDraft}
            renderItems={renderItems}
            renderedPolygonsById={renderedPolygonsById}
            selectedId={selectedId}
            gizmoMode={gizmoMode}
            gizmoDragging={gizmoDragging}
            meshHandlesRef={meshHandlesRef}
            getMeshRefCallback={getMeshRefCallback}
            fpvControlsRef={fpvControlsRef}
            onSelectionChange={handleSelectionChange}
            onGizmoDraggingChanged={setGizmoDragging}
            onGizmoObjectChange={handleGizmoObjectChange}
            selected={selected}
          />
          <BuilderToolPalette toolMode={toolMode} onChange={setToolMode} />
          <BuilderTargetMode targetMode={targetMode} onChange={setTargetMode} />
          <BuilderCameraModePill dragMode={sceneOptions.dragMode} updateScene={updateScene} />
        </div>
      </main>

      <BuilderDock
        sceneOptions={sceneOptions}
        updateScene={updateScene}
        placedItems={placedItems}
        selectedId={selectedId}
        selectedScale={selected?.scale ?? 1}
        onScaleChange={handleScaleSelected}
        perspectiveMode={perspectiveMode}
        perspectivePx={perspectivePx}
        sceneFolderContent={sceneFolderContent}
      />

      <StatsOverlay />
    </div>
  );
}
