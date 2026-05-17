/**
 * Single-stop FPV side effect for a workbench root.
 *
 * Runs `useFpvSpawn`: when `dragMode` flips to `"fpv"`, places the camera
 * origin one mesh-span behind the scene bbox along the current look
 * direction, sets eyeHeight proportional to the model, and flips
 * `autoCenter` off. Restores prior values when leaving FPV.
 *
 * The perspective context FPV needs is owned by the library:
 * `PolyFirstPersonControls` toggles `.polycss-fpv-host` on its host
 * element on attach (see `polycss/src/styles/styles.ts`), so pages
 * don't need to provide perspective CSS.
 */
import type { Polygon } from "@layoutit/polycss-react";
import type { SceneOptionsState } from "../types";
import { useFpvSpawn } from "./useFpvSpawn";

export interface UseFpvHostOptions {
  dragMode: SceneOptionsState["dragMode"];
  autoCenter: boolean;
  perspective: number | false;
  rotY: number;
  /** World-space polygons used to compute the spawn bbox. Caller is
   *  responsible for applying per-mesh transforms (position/scale) before
   *  passing in — builder flattens its placed items, gallery uses the
   *  scene polygons directly. */
  scenePolygons: Polygon[];
  updateScene: (partial: Partial<SceneOptionsState>) => void;
}

export function useFpvHost(options: UseFpvHostOptions): void {
  useFpvSpawn({
    dragMode: options.dragMode,
    autoCenter: options.autoCenter,
    perspective: options.perspective,
    rotY: options.rotY,
    scenePolygons: options.scenePolygons,
    updateScene: options.updateScene,
  });
}
