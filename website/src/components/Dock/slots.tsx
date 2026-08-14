/**
 * Dock slot components — one per folder. Each reads the lil-gui instance from
 * `DockGuiContext` and delegates to its corresponding folder hook. Pages
 * compose the Dock by listing the slots they want as children of `<Dock>`.
 */
import { createContext, useContext, useEffect } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { GUI } from "lil-gui";

import { useModelFolder, type ModelFolderInputs } from "./folders/useModelFolder";
import { useRenderingFolder, type RenderingFolderInputs } from "./folders/useRenderingFolder";
import { useAnimationFolder, type AnimationFolderInputs } from "./folders/useAnimationFolder";
import { useCameraFolder, type CameraFolderInputs } from "./folders/useCameraFolder";
import { useLightingFolder, type LightingFolderInputs } from "./folders/useLightingFolder";
import { useShadowFolder, type ShadowFolderInputs } from "./folders/useShadowFolder";
import {
  EffectParameterControls,
  useEffectsFolder,
  type EffectsFolderInputs,
} from "./folders/useEffectsFolder";

export const DockGuiContext = createContext<GUI | null>(null);

export function useDockGui(): GUI | null {
  return useContext(DockGuiContext);
}

export function DockModel(inputs: ModelFolderInputs): null {
  useModelFolder(useDockGui(), inputs);
  return null;
}

export function DockRendering(inputs: RenderingFolderInputs & { semanticDetails?: React.ReactNode }) {
  const folder = useRenderingFolder(useDockGui(), inputs);
  useEffect(() => {
    if (!folder || !inputs.semanticDetails) return;
    // lil-gui owns this folder's DOM lifetime. Render the read-only gallery
    // details to a single owned node so closing/destroying the folder cannot
    // race React portal cleanup.
    const host = document.createElement("div");
    host.innerHTML = renderToStaticMarkup(inputs.semanticDetails);
    folder.domElement.appendChild(host);
    return () => host.remove();
  }, [folder, inputs.semanticDetails]);
  return null;
}

export function DockAnimation(inputs: AnimationFolderInputs): null {
  useAnimationFolder(useDockGui(), inputs);
  return null;
}

export function DockEffects(inputs: EffectsFolderInputs) {
  const folder = useEffectsFolder(useDockGui(), inputs);
  return <EffectParameterControls folder={folder} inputs={inputs} />;
}

export function DockCamera(inputs: CameraFolderInputs): null {
  useCameraFolder(useDockGui(), inputs);
  return null;
}

export function DockLighting(inputs: LightingFolderInputs): null {
  useLightingFolder(useDockGui(), inputs);
  return null;
}

export function DockShadow(inputs: ShadowFolderInputs): null {
  useShadowFolder(useDockGui(), inputs);
  return null;
}
