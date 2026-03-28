import { createContext, useContext } from "react";
import type { CameraHandle } from "@layoutit/voxcss-core";
import type { SceneStore } from "../store/sceneStore";

export interface VoxCameraContextValue {
  store: SceneStore;
  cameraRef: React.MutableRefObject<CameraHandle>;
  sceneElRef: React.MutableRefObject<HTMLElement | null>;
}

export const VoxCameraContext = createContext<VoxCameraContextValue | null>(null);

export function useCameraContext(): VoxCameraContextValue {
  const ctx = useContext(VoxCameraContext);
  if (!ctx) {
    throw new Error("voxcss: VoxScene must be used inside a VoxCamera.");
  }
  return ctx;
}
