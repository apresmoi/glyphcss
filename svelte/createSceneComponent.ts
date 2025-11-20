import type { SceneController } from "@voxcss/controller/createSceneController";
import {
  createSceneBindingProps,
  SCENE_HOST_CLASS,
  type SceneComponentProps
} from "@voxcss/controller/createSceneComponentCore";
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
    getBindingOptions: (props: SceneComponentProps) => createSceneBindingProps(config.getController(), props)
  };
}

export type { SceneComponentProps };
