import type { InjectionKey, Ref } from "vue";
import type { CameraHandle } from "@layoutit/voxcss-core";
import type { SceneStore } from "../store";

export interface VoxCameraContextValue {
  store: SceneStore;
  cameraRef: Ref<CameraHandle>;
  sceneElRef: Ref<HTMLElement | null>;
}

export const VoxCameraContextKey: InjectionKey<VoxCameraContextValue> = Symbol("voxcss-camera");
