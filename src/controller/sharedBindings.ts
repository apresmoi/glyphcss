import { createSceneBinding, type SceneBindingHandle, type SceneBindingOptions } from "./sceneBindings";
import type { SceneController } from "./sceneController";

export type AttachSceneBindingOptions = Omit<SceneBindingOptions, "element" | "controller"> & {
  controller: SceneController | null;
  element: HTMLElement | null;
};

export function attachSceneBinding(options: AttachSceneBindingOptions): SceneBindingHandle | null {
  const { controller, element, ...rest } = options;
  if (!controller || !element) return null;
  return createSceneBinding({ controller, element, ...rest });
}
