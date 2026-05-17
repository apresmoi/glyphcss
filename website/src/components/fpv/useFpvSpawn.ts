import { useEffect, useRef } from "react";
import type { Polygon } from "@layoutit/polycss-react";
import type { SceneOptionsState } from "../types";

export interface UseFpvSpawnOptions {
  dragMode: SceneOptionsState["dragMode"];
  autoCenter: boolean;
  perspective: number | false;
  rotY: number;
  scenePolygons: Polygon[];
  updateScene: (partial: Partial<SceneOptionsState>) => void;
}

export function useFpvSpawn({
  dragMode,
  autoCenter,
  perspective,
  rotY,
  scenePolygons,
  updateScene,
}: UseFpvSpawnOptions): void {
  const prevDragModeRef = useRef<SceneOptionsState["dragMode"]>(dragMode);
  const fpvSavedAutoCenterRef = useRef<boolean | null>(null);
  const fpvSavedPerspectiveRef = useRef<number | false | null>(null);

  useEffect(() => {
    const prev = prevDragModeRef.current;
    const cur = dragMode;
    prevDragModeRef.current = cur;
    if (prev === cur) return;
    if (cur === "fpv") {
      fpvSavedAutoCenterRef.current = autoCenter;
      fpvSavedPerspectiveRef.current = perspective;
      // Compute mesh bbox so the spawn target lands at the model's center
      // (not at world origin which may be empty space) and so eyeHeight is
      // proportional to the model. Use minimal overrides — DON'T touch rotY
      // or zoom so the FPV view looks visually continuous with the orbit
      // view the user was just in.
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const p of scenePolygons) {
        for (const v of p.vertices) {
          if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
          if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
          if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
        }
      }
      const partial: Partial<SceneOptionsState> = {
        autoCenter: false,
      };
      if (Number.isFinite(minZ)) {
        // Three.js-style spawn: place the CAMERA ORIGIN outside the mesh,
        // looking at its center. FPV controls treat the scene's `target` as
        // the seed for cameraOrigin (via initializeOriginFromTarget), so we
        // set target to the desired camera position here. Once FPV engages,
        // it derives a new target ahead of the origin along the look
        // direction — but for this one-shot spawn we want the camera AT
        // (cx + back, cy, cz) and the controls will take care of the rest.
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;
        const cz = (minZ + maxZ) / 2;
        const span = Math.max(maxX - minX, maxY - minY, 1);
        const r = ((rotY ?? 0) * Math.PI) / 180;
        // Spawn one mesh-span behind the model along the current look
        // direction so W walks toward it. polycss-forward at rotX=90 is
        // (-cos rotY, -sin rotY, 0); we step the opposite way.
        const back = span * 2;
        const ox = cx + Math.cos(r) * back;
        const oy = cy + Math.sin(r) * back;
        partial.target = [ox, oy, cz];
        partial.fpvEyeHeight = Math.max(0.5, cz - minZ);
        partial.fpvCrouchHeight = Math.max(0.5, (cz - minZ) * 0.5);
      }
      updateScene(partial);
    } else if (prev === "fpv") {
      const restored: Partial<SceneOptionsState> = {};
      if (fpvSavedAutoCenterRef.current !== null) {
        restored.autoCenter = fpvSavedAutoCenterRef.current;
        fpvSavedAutoCenterRef.current = null;
      }
      if (fpvSavedPerspectiveRef.current !== null) {
        restored.perspective = fpvSavedPerspectiveRef.current;
        fpvSavedPerspectiveRef.current = null;
      }
      if (Object.keys(restored).length > 0) updateScene(restored);
    }
  }, [dragMode, autoCenter, scenePolygons, updateScene]);
}
