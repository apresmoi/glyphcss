import type { SceneController } from "@voxcss/controller/createSceneController";
import {
  createSceneBindingProps,
  ensureSceneController,
  SCENE_HOST_CLASS,
  type SceneComponentProps
} from "@voxcss/controller/createSceneBinding";
import type { SceneBindingActionOptions } from "./bindings";

export interface SvelteSceneComponentFactoryConfig {
  getController(): SceneController | null;
}

export interface SvelteSceneComponentInstance {
  className: string;
  getBindingOptions(props: SceneComponentProps): SceneBindingActionOptions;
}

export function createSceneComponent(config: SvelteSceneComponentFactoryConfig): SvelteSceneComponentInstance {
  return {
    className: SCENE_HOST_CLASS,
    getBindingOptions: (props: SceneComponentProps) =>
      createSceneBindingProps(ensureSceneController(config.getController()), props)
  };
}

export type { SceneComponentProps };
