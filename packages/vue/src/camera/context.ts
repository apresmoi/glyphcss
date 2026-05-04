import type { InjectionKey, Ref } from "vue";
import type { CameraHandle } from "@polycss/core";
import type { SceneStore } from "../store";

export interface PolyCameraContextValue {
  store: SceneStore;
  cameraRef: Ref<CameraHandle>;
  sceneElRef: Ref<HTMLElement | null>;
}

export const PolyCameraContextKey: InjectionKey<PolyCameraContextValue> = Symbol("polycss-camera");
