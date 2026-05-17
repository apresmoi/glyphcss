/**
 * Dock slot components — one per folder. Each reads the lil-gui instance from
 * `DockGuiContext` and delegates to its corresponding folder hook. Pages
 * compose the Dock by listing the slots they want as children of `<Dock>`.
 */
import { createContext, useContext } from "react";
import type { GUI } from "lil-gui";

import { useModelFolder, type ModelFolderInputs } from "./folders/useModelFolder";
import { useRenderingFolder, type RenderingFolderInputs } from "./folders/useRenderingFolder";
import { useAnimationFolder, type AnimationFolderInputs } from "./folders/useAnimationFolder";
import { useCameraFolder, type CameraFolderInputs } from "./folders/useCameraFolder";
import { useLightingFolder, type LightingFolderInputs } from "./folders/useLightingFolder";

export const DockGuiContext = createContext<GUI | null>(null);

export function useDockGui(): GUI | null {
  return useContext(DockGuiContext);
}

export function DockModel(inputs: ModelFolderInputs): null {
  useModelFolder(useDockGui(), inputs);
  return null;
}

export function DockRendering(inputs: RenderingFolderInputs): null {
  useRenderingFolder(useDockGui(), inputs);
  return null;
}

export function DockAnimation(inputs: AnimationFolderInputs): null {
  useAnimationFolder(useDockGui(), inputs);
  return null;
}

export function DockCamera(inputs: CameraFolderInputs): null {
  useCameraFolder(useDockGui(), inputs);
  return null;
}

export function DockLighting(inputs: LightingFolderInputs): null {
  useLightingFolder(useDockGui(), inputs);
  return null;
}
