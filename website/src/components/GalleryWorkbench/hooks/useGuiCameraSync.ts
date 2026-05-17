import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { SceneOptionsState } from "../types";

export interface UseGuiCameraSyncOptions {
  setSceneOptions: Dispatch<SetStateAction<SceneOptionsState>>;
}

export function useGuiCameraSync({ setSceneOptions }: UseGuiCameraSyncOptions) {
  // Mirror controls-driven camera changes (drag/wheel) back into React state.
  // Without this, the lil-gui sliders don't track the live drag and a
  // subsequent scene option change reads the stale slider value.
  const handleCameraChange = useCallback((camera: { rotX: number; rotY: number; zoom: number; target?: [number, number, number] }) => {
    setSceneOptions((current) => {
      const nextTarget = camera.target ?? current.target;
      if (
        current.rotX === camera.rotX &&
        current.rotY === camera.rotY &&
        current.zoom === camera.zoom &&
        current.target[0] === nextTarget[0] &&
        current.target[1] === nextTarget[1] &&
        current.target[2] === nextTarget[2]
      ) return current;
      return {
        ...current,
        rotX: camera.rotX,
        rotY: camera.rotY,
        zoom: camera.zoom,
        target: [nextTarget[0], nextTarget[1], nextTarget[2]],
      };
    });
  }, [setSceneOptions]);

  return { handleCameraChange };
}
