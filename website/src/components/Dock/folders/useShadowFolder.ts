/**
 * Shadow folder — enable toggle + opacity, lift/bias, color, cast/receive.
 */
import type { GUI } from "lil-gui";
import type { SceneOptionsState } from "../../GalleryWorkbench/types";
import { useColor, useFolder, useSlider, useToggle } from "../primitives";

export interface ShadowFolderInputs {
  shadowEnabled: boolean;
  shadowOpacity: number;
  shadowLift: number;
  shadowColor: string;
  shadowCast: boolean;
  shadowReceive: boolean;
  shadowFloor: boolean;
  onUpdateScene: (partial: Partial<Pick<SceneOptionsState,
    | "shadowEnabled"
    | "shadowOpacity"
    | "shadowLift"
    | "shadowColor"
    | "shadowCast"
    | "shadowReceive"
    | "shadowFloor"
  >>) => void;
}

export function useShadowFolder(parent: GUI | null, inputs: ShadowFolderInputs): void {
  const {
    shadowEnabled,
    shadowOpacity,
    shadowLift,
    shadowColor,
    shadowCast,
    shadowReceive,
    shadowFloor,
    onUpdateScene,
  } = inputs;

  const folder = useFolder(parent, "Shadow", { open: false });

  useToggle(folder, "Enable", shadowEnabled, (value) =>
    onUpdateScene({ shadowEnabled: value }),
  );
  useSlider(folder, "Opacity", { min: 0, max: 1, step: 0.01 }, shadowOpacity, (value) =>
    onUpdateScene({ shadowOpacity: value }),
  );
  useSlider(folder, "Lift/bias", { min: 0, max: 0.5, step: 0.005 }, shadowLift, (value) =>
    onUpdateScene({ shadowLift: value }),
  );
  useColor(folder, "Color", shadowColor, (value) => onUpdateScene({ shadowColor: value }));
  useToggle(folder, "Cast", shadowCast, (value) =>
    onUpdateScene({ shadowCast: value }),
  );
  useToggle(folder, "Receive", shadowReceive, (value) =>
    onUpdateScene({ shadowReceive: value }),
  );
  useToggle(folder, "Floor", shadowFloor, (value) =>
    onUpdateScene({ shadowFloor: value }),
  );
}
