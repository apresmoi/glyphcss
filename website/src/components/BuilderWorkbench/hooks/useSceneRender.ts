import { useMemo, type RefObject } from "react";
import { optimizeMeshPolygons } from "@layoutit/polycss-react";
import type { PolyFirstPersonControlsHandle, Polygon } from "@layoutit/polycss-react";
import { interiorFillPolygons } from "../../GalleryWorkbench/helpers/interiorFill";
import { useFpvHost, useFpvCull } from "../../fpv";
import type { SceneOptionsState } from "../../types";
import { buildGridPolygons } from "../geometry/grid";
import type { TerrainVertices } from "../geometry/terrain";
import type { PlacedItem } from "../types";

export interface UseSceneRenderOptions {
  placedItems: PlacedItem[];
  selectedId: string | null;
  sceneOptions: SceneOptionsState;
  fpvControlsRef: RefObject<PolyFirstPersonControlsHandle | null>;
  updateScene: (partial: Partial<SceneOptionsState>) => void;
  /** Heightmap. Drives the grid's per-cell segment elevation so the
   *  floor grid is unified with the terrain — raised vertices bend
   *  the grid lines instead of leaving a separate fill mesh on top. */
  terrainVertices: TerrainVertices;
}

export interface UseSceneRenderResult {
  renderedPolygonsById: Map<string, Polygon[]>;
  renderItems: Array<PlacedItem & { rawPolygons: Polygon[] }>;
  gridPolygons: Polygon[];
}

export function useSceneRender({
  placedItems,
  selectedId,
  sceneOptions,
  fpvControlsRef,
  updateScene,
  terrainVertices,
}: UseSceneRenderOptions): UseSceneRenderResult {
  const renderedPolygonsById = useMemo(() => {
    const out = new Map<string, Polygon[]>();
    for (const it of placedItems) {
      if (it.rawPolygons === null) continue;
      const optimized = optimizeMeshPolygons(it.rawPolygons, {
        meshResolution: sceneOptions.meshResolution,
      });
      out.set(it.id, sceneOptions.meshInteriorFill ? [...optimized, ...interiorFillPolygons(optimized)] : optimized);
    }
    return out;
  }, [placedItems, sceneOptions.meshResolution, sceneOptions.meshInteriorFill]);

  // World-space polygons for FPV bbox sampling. `useFpvHost` only reads
  // vertex extents when `dragMode` transitions to "fpv".
  const worldPolygons = useMemo<Polygon[]>(() => {
    const out: Polygon[] = [];
    for (const it of placedItems) {
      const polys = renderedPolygonsById.get(it.id);
      if (!polys) continue;
      const s = it.scale * it.fitScale;
      const [px, py, pz] = it.position;
      for (const polygon of polys) {
        out.push({
          ...polygon,
          vertices: polygon.vertices.map(([x, y, z]) => [px + x * s, py + y * s, pz + z * s]),
        });
      }
    }
    return out;
  }, [placedItems, renderedPolygonsById]);

  useFpvHost({
    dragMode: sceneOptions.dragMode,
    autoCenter: sceneOptions.autoCenter,
    perspective: sceneOptions.perspective,
    rotY: sceneOptions.rotY,
    scenePolygons: worldPolygons,
    updateScene,
  });

  const visibleIds = useFpvCull({
    controlsRef: fpvControlsRef,
    items: placedItems,
    renderDistance: sceneOptions.fpvRenderDistance,
    enabled: sceneOptions.dragMode === "fpv" && sceneOptions.fpvRenderDistance > 0,
    alwaysIncludeId: selectedId,
  });

  const renderItems = useMemo(() => {
    const loaded = placedItems.filter(
      (it): it is PlacedItem & { rawPolygons: Polygon[] } => it.rawPolygons !== null,
    );
    return visibleIds === null ? loaded : loaded.filter((it) => visibleIds.has(it.id));
  }, [placedItems, visibleIds]);

  const gridPolygons = useMemo(
    () => buildGridPolygons({ spacing: sceneOptions.gridResolution, vertices: terrainVertices }),
    [sceneOptions.gridResolution, terrainVertices],
  );

  return { renderedPolygonsById, renderItems, gridPolygons };
}
