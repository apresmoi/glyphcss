import { createContext, useContext } from "react";
import type { CameraHandle } from "@polycss/core";
import type { SceneStore } from "../store/sceneStore";

export interface PolyCameraContextValue {
  store: SceneStore;
  cameraRef: React.MutableRefObject<CameraHandle>;
  sceneElRef: React.MutableRefObject<HTMLElement | null>;
}

export const PolyCameraContext = createContext<PolyCameraContextValue | null>(null);

export function useCameraContext(): PolyCameraContextValue {
  const ctx = useContext(PolyCameraContext);
  if (!ctx) {
    throw new Error("polycss: PolyScene must be used inside a PolyCamera.");
  }
  return ctx;
}
