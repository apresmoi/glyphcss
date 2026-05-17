import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { optimizeMeshPolygons } from "@layoutit/polycss-react";
import type { Polygon } from "@layoutit/polycss-react";
import { loadPresetModel } from "../../GalleryWorkbench/helpers/loaders";
import { PRESETS } from "../../GalleryWorkbench/presets";
import { PARSER_DEFAULTS, NORMALIZED_MAX_DIM } from "../defaults";
import { meshBbox } from "../geometry/meshBbox";
import { placeMeshOnFloor } from "../geometry/placement";
import { buildGhostWireframePolygons, ghostRectFromBbox, GHOST_COLOR, rotatePolygonsAroundPivot } from "../geometry/ghost";
import type { Bbox } from "../geometry/ghost";
import { projectScreenToWorldGround } from "../geometry/screenToWorld";
import { sampleTerrain, rotationForSlope, type TerrainVertices } from "../geometry/terrain";
import type { PlacedItem, PlacementDraft, TargetMode } from "../types";
import type { SceneOptionsState } from "../../types";

export interface UsePlacementModeOptions {
  sceneOptions: SceneOptionsState;
  appendItems: (items: PlacedItem[]) => void;
  setSelectedId: (id: string | null) => void;
  placementCounter: RefObject<number>;
  updateScene: (partial: Partial<SceneOptionsState>) => void;
  /** Current heightmap vertices. Empty map ⇒ flat floor everywhere
   *  (placement falls back to z = 0, rotation = identity). */
  terrainVertices: TerrainVertices;
  /** Snap target — `face` puts the placement at the cell centre,
   *  `vertex` snaps to the nearest grid intersection. */
  targetMode: TargetMode;
}

export interface UsePlacementModeResult {
  placementDraft: PlacementDraft | null;
  setPlacementDraft: (d: PlacementDraft | null) => void;
  ghostWorld: [number, number];
  ghostPolygons: Polygon[];
  handleAddPreset: (presetId: string) => Promise<void>;
  loadingPresetId: string | null;
}

export function usePlacementMode({
  sceneOptions,
  appendItems,
  setSelectedId,
  placementCounter,
  updateScene,
  terrainVertices,
  targetMode,
}: UsePlacementModeOptions): UsePlacementModeResult {
  const [placementDraft, setPlacementDraft] = useState<PlacementDraft | null>(null);
  const [ghostWorld, setGhostWorld] = useState<[number, number]>([0, 0]);
  const [loadingPresetId, setLoadingPresetId] = useState<string | null>(null);

  // Track whether autoCenter was on before placement started, so we can
  // restore it on exit. Disabling autoCenter during placement makes
  // autoCenterOffset = [0, 0, 0], simplifying the screen-to-world math.
  const autoCenterBeforePlacement = useRef<boolean | undefined>(undefined);

  // Click in sidebar = ENTER PLACEMENT MODE (load model, arm ghost, wait for
  // floor click). The user then clicks somewhere on the floor to commit.
  const handleAddPreset = useCallback(async (presetId: string) => {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset || loadingPresetId) return;
    setLoadingPresetId(presetId);
    // Exit any existing placement mode before entering a new one.
    setPlacementDraft(null);
    try {
      const loaded = await loadPresetModel(preset, PARSER_DEFAULTS);
      const optimized = optimizeMeshPolygons(loaded.rawPolygons, {
        meshResolution: sceneOptions.meshResolution,
      });
      const bboxResult = meshBbox(optimized);
      const fitScale = bboxResult.span > 0 ? NORMALIZED_MAX_DIM / bboxResult.span : 1;
      const bbox: Bbox = {
        minX: bboxResult.minX,
        minY: bboxResult.minY,
        minZ: bboxResult.minZ,
        maxX: bboxResult.maxX,
        maxY: bboxResult.maxY,
        maxZ: bboxResult.maxZ,
      };
      // Disable autoCenter during placement so autoCenterOffset = [0, 0, 0],
      // which simplifies the inverse-projection math in screenToWorld.
      autoCenterBeforePlacement.current = sceneOptions.autoCenter;
      if (sceneOptions.autoCenter) updateScene({ autoCenter: false });
      setPlacementDraft({
        preset,
        rawPolygons: loaded.rawPolygons,
        bbox,
        meshBboxResult: bboxResult,
        fitScale,
      });
    } catch (e) {
      console.error("[builder] failed to load preset for placement", preset.id, e);
    } finally {
      setLoadingPresetId(null);
    }
  }, [loadingPresetId, sceneOptions.meshResolution, sceneOptions.autoCenter, updateScene]);

  // Commit the current placementDraft at ghostWorld, add to placedItems, exit.
  // Reads the heightmap at the placement XY so the mesh lands on top of
  // any raised terrain and tilts to match the local slope normal.
  const commitPlacement = useCallback(() => {
    if (!placementDraft) return;
    const [wx, wy] = ghostWorld;
    const { preset, rawPolygons, meshBboxResult, fitScale } = placementDraft;
    const sample = sampleTerrain(terrainVertices, sceneOptions.gridResolution, wx, wy);
    const position = placeMeshOnFloor(wx, wy, meshBboxResult, fitScale, sample.z);
    const rotation = rotationForSlope(sample.slopeX, sample.slopeY);
    const n = placementCounter.current++;
    const placed: PlacedItem = {
      id: `placed-${Date.now()}-${n}`,
      preset,
      rawPolygons,
      position,
      rotation,
      scale: 1,
      fitScale,
      worldX: wx,
      worldY: wy,
    };
    appendItems([placed]);
    setSelectedId(placed.id);
    setPlacementDraft(null);
    if (autoCenterBeforePlacement.current) updateScene({ autoCenter: true });
  }, [placementDraft, ghostWorld, appendItems, setSelectedId, placementCounter, updateScene, terrainVertices, sceneOptions.gridResolution]);

  // Ghost polygons in WORLD coords — recomputed on every cursor move
  // and re-lifted to the current terrain elevation under the cursor.
  // The slope tilt is baked into the vertices by rotating around the
  // bbox CENTRE (matching PolyMesh's transform-origin so the preview
  // and committed placement line up).
  const ghostPolygons = useMemo<Polygon[]>(() => {
    if (!placementDraft) return [];
    const sample = sampleTerrain(terrainVertices, sceneOptions.gridResolution, ghostWorld[0], ghostWorld[1]);
    const rect = ghostRectFromBbox(
      placementDraft.bbox,
      ghostWorld[0],
      ghostWorld[1],
      placementDraft.fitScale,
      sample.z,
    );
    const polys = buildGhostWireframePolygons(rect, GHOST_COLOR);
    const [rotX, rotY] = rotationForSlope(sample.slopeX, sample.slopeY);
    if (rotX === 0 && rotY === 0) return polys;
    const pivot: [number, number, number] = [
      rect.worldX,
      rect.worldY,
      sample.z + rect.height / 2,
    ];
    return rotatePolygonsAroundPivot(polys, pivot, rotX, rotY);
  }, [placementDraft, ghostWorld, terrainVertices, sceneOptions.gridResolution]);

  // ESC cancels placement mode and restores autoCenter.
  useEffect(() => {
    if (!placementDraft) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPlacementDraft(null);
        if (autoCenterBeforePlacement.current) updateScene({ autoCenter: true });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placementDraft, updateScene]);

  // Placement-mode pointer capture. Listens on the viewport in capture
  // phase so the move/click reach our handler BEFORE PolyOrbitControls or
  // PolySelect get a chance to react. We stopPropagation on click so the
  // commit doesn't double as a select / orbit-drag start.
  //
  // We attach to `.dn-viewport` (the wrapper element around <PolyScene>) so
  // events outside the viewport (over the sidebar, dock, etc.) are not
  // captured — only pointer activity over the 3D area drives placement.
  // A transparent PolyMesh catcher used to handle this, but polycss's color
  // pipeline doesn't render "transparent" colors as truly invisible (they
  // came out opaque white), so we now drive placement entirely from DOM
  // events without a catcher mesh.
  useEffect(() => {
    if (!placementDraft) return;
    const viewport = document.querySelector(".dn-viewport") as HTMLElement | null;
    const cameraEl = document.querySelector(".polycss-camera") as HTMLElement | null;
    if (!viewport || !cameraEl) return;

    const projectAt = (clientX: number, clientY: number): [number, number] | null => {
      const hit = projectScreenToWorldGround({
        clientX,
        clientY,
        cameraEl,
        sceneOptions,
        autoCenterOffset: [0, 0, 0],
      });
      if (!hit) return null;
      if (!sceneOptions.snapToGrid || sceneOptions.gridResolution <= 0) return hit;
      const step = sceneOptions.gridResolution;
      // Face target → snap to cell CENTRE (floor + ½ step). Vertex
      // target → snap to nearest grid intersection (round).
      if (targetMode === "face") {
        return [Math.floor(hit[0] / step) * step + step / 2, Math.floor(hit[1] / step) * step + step / 2];
      }
      return [Math.round(hit[0] / step) * step, Math.round(hit[1] / step) * step];
    };

    // Capture-phase events on the viewport reach every descendant first.
    // Skip clicks/moves on the floating UI overlays (tool palette,
    // camera-mode pill) so their own handlers still fire — otherwise the
    // user can't change modes while in placement mode.
    const isUiOverlay = (target: EventTarget | null): boolean => {
      const el = target as HTMLElement | null;
      if (!el || !el.closest) return false;
      return Boolean(el.closest(".builder-tool-palette, .builder-target-mode, .builder-camera-mode"));
    };

    const onMove = (e: PointerEvent) => {
      if (isUiOverlay(e.target)) return;
      const hit = projectAt(e.clientX, e.clientY);
      if (hit) setGhostWorld(hit);
    };
    const onClick = (e: MouseEvent) => {
      if (isUiOverlay(e.target)) return;
      const hit = projectAt(e.clientX, e.clientY);
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      setGhostWorld(hit);
      commitPlacement();
    };

    viewport.addEventListener("pointermove", onMove, true);
    viewport.addEventListener("click", onClick, true);
    return () => {
      viewport.removeEventListener("pointermove", onMove, true);
      viewport.removeEventListener("click", onClick, true);
    };
  }, [placementDraft, sceneOptions, commitPlacement, targetMode]);

  return {
    placementDraft,
    setPlacementDraft,
    ghostWorld,
    ghostPolygons,
    handleAddPreset,
    loadingPresetId,
  };
}
