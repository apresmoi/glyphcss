import { useMemo } from "react";
import { optimizeMeshPolygons } from "@layoutit/polycss-react";
import type { Polygon } from "@layoutit/polycss-react";
import type { LoadedModel } from "../types";
import { interiorFillPolygons as buildInteriorFillPolygons } from "../helpers/interiorFill";

export interface UseScenePolygonsOptions {
  loaded: LoadedModel | null;
  hasActiveAnimation: boolean;
  meshResolution: "lossy" | "lossless";
  renderer: "react" | "vanilla";
  reactAnimatedPolygons: Polygon[] | null;
  meshInteriorFill: boolean;
}

export interface UseScenePolygonsResult {
  modelPolygons: Polygon[];
  interiorFillPolygons: Polygon[];
  scenePolygons: Polygon[];
  helperBbox: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } | null;
  helperScale: number;
  helperTarget: [number, number, number];
}

export function useScenePolygons({
  loaded,
  hasActiveAnimation,
  meshResolution,
  renderer,
  reactAnimatedPolygons,
  meshInteriorFill,
}: UseScenePolygonsOptions): UseScenePolygonsResult {
  const modelPolygons = useMemo(() => {
    if (!loaded) return [];
    if (hasActiveAnimation) {
      return renderer === "react" && reactAnimatedPolygons
        ? reactAnimatedPolygons
        : loaded.rawPolygons;
    }
    return optimizeMeshPolygons(loaded.rawPolygons, {
      meshResolution,
    });
  }, [
    loaded,
    hasActiveAnimation,
    meshResolution,
    renderer,
    reactAnimatedPolygons,
  ]);

  const interiorFillPolygons = useMemo(() => {
    if (hasActiveAnimation || !meshInteriorFill) {
      return [];
    }
    return buildInteriorFillPolygons(modelPolygons);
  }, [
    hasActiveAnimation,
    modelPolygons,
    meshInteriorFill,
  ]);

  const scenePolygons = useMemo(
    () => interiorFillPolygons.length > 0
      ? [...modelPolygons, ...interiorFillPolygons]
      : modelPolygons,
    [modelPolygons, interiorFillPolygons],
  );

  const helperBbox = useMemo(() => {
    const polygons = scenePolygons;
    if (polygons.length === 0) return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const polygon of polygons) {
      for (const v of polygon.vertices) {
        if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
        if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
      }
    }
    return { minX, minY, minZ, maxX, maxY, maxZ };
  }, [scenePolygons]);

  const helperScale = useMemo(() => {
    if (!helperBbox) return 30;
    return Math.max(
      helperBbox.maxX - helperBbox.minX,
      helperBbox.maxY - helperBbox.minY,
      helperBbox.maxZ - helperBbox.minZ,
      1,
    );
  }, [helperBbox]);

  const helperTarget = useMemo<[number, number, number]>(() => {
    if (!helperBbox) return [0, 0, 0];
    return [
      (helperBbox.minX + helperBbox.maxX) / 2,
      (helperBbox.minY + helperBbox.maxY) / 2,
      (helperBbox.minZ + helperBbox.maxZ) / 2,
    ];
  }, [helperBbox]);

  return { modelPolygons, interiorFillPolygons, scenePolygons, helperBbox, helperScale, helperTarget };
}
