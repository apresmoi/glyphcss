import type { InjectionKey, Ref } from "vue";
import type { CameraHandle, Vec3 } from "@layoutit/polycss-core";
import type { SceneStore } from "../store";

export interface PolyCameraContextValue {
  store: SceneStore;
  cameraRef: Ref<CameraHandle>;
  sceneElRef: Ref<HTMLElement | null>;
  /**
   * Camera root element ref. Exposed so layered components like
   * <PolyControls> can attach pointer/wheel listeners.
   */
  cameraElRef: Ref<HTMLElement | null>;
  /**
   * Bbox-center of all centerable meshes in world coords, written by
   * <PolyScene> when `autoCenter` is enabled. `applyTransformDirect`
   * folds this into the innermost translate3d alongside `target` so the
   * camera orbits the model's visible center without adding a DOM wrapper.
   * Kept separate from `target` so user pan survives mesh add/remove.
   */
  autoCenterOffset: Ref<Vec3>;
  /**
   * Apply the current camera state (from cameraRef.value.state) directly
   * to sceneEl.style.transform. Layered components call this after
   * mutating cameraRef.value to make the DOM reflect the new state.
   */
  applyTransformDirect: () => void;
}

export const PolyCameraContextKey: InjectionKey<PolyCameraContextValue> = Symbol("polycss-camera");
