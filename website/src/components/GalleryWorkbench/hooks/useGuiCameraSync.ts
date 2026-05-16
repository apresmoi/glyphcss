import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { Vec3 as ReactVec3 } from "@layoutit/polycss-react";
import type { SceneOptionsState } from "../../types";

export interface UseGuiCameraSyncOptions {
  setSceneOptions: Dispatch<SetStateAction<SceneOptionsState>>;
}

export function useGuiCameraSync({ setSceneOptions }: UseGuiCameraSyncOptions) {
  // Mirror controls-driven camera changes (drag/wheel/autorotate) back into
  // React state. Without this, the sliders don't track the live drag and a
  // subsequent scene rebuild (baked → dynamic, mesh swap, etc.) reads the
  // stale slider value and resets the user's camera.
  const handleCameraChange = useCallback((camera: { rotX: number; rotY: number; zoom: number; target?: ReactVec3 }) => {
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
