import { useCallback, useEffect, useRef, type RefObject } from "react";
import { optimizeMeshPolygons } from "@layoutit/polycss-react";
import type { MeshResolution, PolyFirstPersonControlsHandle, Vec3 } from "@layoutit/polycss-react";
import type { PresetModel } from "../../GalleryWorkbench/types";
import { loadPresetModel } from "../../GalleryWorkbench/helpers/loaders";
import { PARSER_DEFAULTS, NORMALIZED_MAX_DIM } from "../defaults";
import { meshBbox } from "../geometry/meshBbox";
import { placeMeshOnFloor } from "../geometry/placement";
import { SCENE_PRESETS } from "../scenes";
import { PRESETS } from "../../GalleryWorkbench/presets";
import type { PlacedItem } from "../types";
import type { SceneOptionsState } from "../../types";
import type { DragMode } from "../../types";

export interface UseSceneLoaderOptions {
  placedItems: PlacedItem[];
  appendItems: (items: PlacedItem[]) => void;
  updateItem: (id: string, partial: Partial<PlacedItem>) => void;
  buildPlacement: (
    preset: PresetModel,
    worldX: number,
    worldY: number,
    opts?: { rotation?: Vec3; scale?: number },
  ) => Promise<PlacedItem | null>;
  placementCounter: RefObject<number>;
  dragMode: DragMode;
  fpvRenderDistance: number;
  targetWorld: Vec3;
  fpvControlsRef: RefObject<PolyFirstPersonControlsHandle | null>;
  meshResolution: MeshResolution;
  updateScene: (partial: Partial<SceneOptionsState>) => void;
}

export interface UseSceneLoaderResult {
  handleAddScene: (sceneId: string) => void;
}

export function useSceneLoader({
  placedItems,
  appendItems,
  updateItem,
  placementCounter,
  dragMode,
  fpvRenderDistance,
  targetWorld,
  fpvControlsRef,
  meshResolution,
  updateScene,
}: UseSceneLoaderOptions): UseSceneLoaderResult {
  const meshResolutionRef = useRef(meshResolution);
  meshResolutionRef.current = meshResolution;

  // Dedupe in-flight loads so the same item can't kick off twice between
  // the setState callback and the next effect tick.
  const loadingItemIdsRef = useRef<Set<string>>(new Set());

  // Scene click = batch ADD as PENDING placeholders. Each scene item
  // becomes a PlacedItem with `rawPolygons: null` and a placeholder
  // `position`/`fitScale`; the proximity loader below promotes them to
  // loaded items when the camera comes within `fpvRenderDistance * 2`
  // world units. This avoids fetching + parsing every asset upfront on a
  // dense scene (Medieval Village = 38 placements) — most assets only
  // load if the player actually walks near them.
  const handleAddScene = useCallback((sceneId: string) => {
    const scene = SCENE_PRESETS.find((s) => s.id === sceneId);
    if (!scene) return;
    if (scene.defaultSceneOptions) {
      updateScene(scene.defaultSceneOptions);
    }
    const baseId = Date.now();
    const pending: PlacedItem[] = scene.items
      .map((item, i): PlacedItem | null => {
        const preset = PRESETS.find((p) => p.id === item.presetId);
        if (!preset) {
          console.warn("[builder] scene references unknown preset", item.presetId);
          return null;
        }
        return {
          id: `placed-${baseId}-${placementCounter.current++}-${i}`,
          preset,
          rawPolygons: null,
          position: [0, 0, 0],
          rotation: item.rotation ?? [0, 0, 0],
          scale: item.scale ?? 1,
          fitScale: 1,
          worldX: item.position[0],
          worldY: item.position[1],
        };
      })
      .filter((p): p is PlacedItem => p !== null);
    if (pending.length === 0) return;
    appendItems(pending);
  }, [appendItems, placementCounter, updateScene]);

  // Proximity-driven lazy loader: promotes pending items (`rawPolygons`
  // null) to loaded items when the camera comes within `loadDistance`
  // world units. `loadDistance` is twice the render distance so models
  // load BEFORE they pop into the visible cull set — no visible "popping
  // in" right at the edge.
  //
  // Origin source: FPV camera origin when in FPV, otherwise the orbit
  // camera target (so orbiting around the scene also pulls nearby items
  // in). The effect resubscribes when the mode changes; in FPV it
  // listens for "change" events to keep loading as the player walks.
  useEffect(() => {
    const loadDistance = fpvRenderDistance > 0
      ? fpvRenderDistance * 2
      : Infinity;
    const ld2 = loadDistance * loadDistance;

    const loadOne = async (item: PlacedItem): Promise<void> => {
      try {
        const loaded = await loadPresetModel(item.preset, PARSER_DEFAULTS);
        const optimized = optimizeMeshPolygons(loaded.rawPolygons, {
          meshResolution: meshResolutionRef.current,
        });
        const bbox = meshBbox(optimized);
        const fitScale = bbox.span > 0 ? NORMALIZED_MAX_DIM / bbox.span : 1;
        const placement = placeMeshOnFloor(item.worldX, item.worldY, bbox, fitScale);
        updateItem(item.id, { rawPolygons: loaded.rawPolygons, fitScale, position: placement });
      } catch (e) {
        console.error("[builder] lazy load failed", item.preset.id, e);
      } finally {
        loadingItemIdsRef.current.delete(item.id);
      }
    };

    const checkAndLoad = (ox: number, oy: number): void => {
      for (const item of placedItems) {
        if (item.rawPolygons !== null) continue;
        if (loadingItemIdsRef.current.has(item.id)) continue;
        const dx = item.worldX - ox;
        const dy = item.worldY - oy;
        if (dx * dx + dy * dy > ld2) continue;
        loadingItemIdsRef.current.add(item.id);
        void loadOne(item);
      }
    };

    const ctrl = fpvControlsRef.current;
    const inFpv = dragMode === "fpv" && !!ctrl;
    if (inFpv && ctrl) {
      const [ox, oy] = ctrl.getOrigin();
      checkAndLoad(ox, oy);
      const onChange = (): void => {
        const [nx, ny] = ctrl.getOrigin();
        checkAndLoad(nx, ny);
      };
      ctrl.addEventListener("change", onChange);
      return () => ctrl.removeEventListener("change", onChange);
    } else {
      // Fallback origin: orbit camera target. Loads what's near the
      // viewpoint when not in FPV (e.g. scene-add lands the user at
      // target = [0,0,0] so center-of-scene items load first).
      checkAndLoad(targetWorld[0], targetWorld[1]);
    }
  }, [placedItems, dragMode, fpvRenderDistance, targetWorld, fpvControlsRef, updateItem]);

  return { handleAddScene };
}
