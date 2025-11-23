import type { SceneController } from "@voxcss/controller/sceneController";
import { ensureSceneController, SCENE_HOST_CLASS, type SceneComponentProps } from "@voxcss/controller/sceneBindings";
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
    getBindingOptions: (props: SceneComponentProps) => ({
      controller: ensureSceneController(config.getController()),
      ...props
    })
  };
}

export type { SceneComponentProps };
