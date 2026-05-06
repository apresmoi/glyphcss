import { createContext, useContext } from "react";
import type { CameraHandle } from "@polycss/core";
import type { SceneStore } from "../store/sceneStore";

export interface PolyCameraContextValue {
  store: SceneStore;
  cameraRef: React.MutableRefObject<CameraHandle>;
  sceneElRef: React.MutableRefObject<HTMLElement | null>;
  /**
   * The host element the camera attaches to (parent of sceneEl). Exposed
   * so layered components like <PolyControls> can attach their own
   * pointer/wheel listeners.
   */
  cameraElRef: React.MutableRefObject<HTMLElement | null>;
  /**
   * Apply the current camera state (from cameraRef.current.state) directly
   * to sceneEl.style.transform — bypasses React. Used by both useCamera's
   * built-in handlers and any layered <PolyControls>. Calling it after
   * cameraRef.current.update(...) makes the DOM reflect the new state.
   */
  applyTransformDirect: () => void;
}

export const PolyCameraContext = createContext<PolyCameraContextValue | null>(null);

export function useCameraContext(): PolyCameraContextValue {
  const ctx = useContext(PolyCameraContext);
  if (!ctx) {
    throw new Error("polycss: PolyScene must be used inside a PolyCamera.");
  }
  return ctx;
}
