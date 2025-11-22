import type { SceneBindingOptions } from "@voxcss/controller/sceneBindings";
import { createSceneBindingManager } from "@voxcss/controller/sceneBindings";

export type SceneBindingActionOptions = Omit<SceneBindingOptions, "element">;

export function sceneBinding(node: HTMLElement, options: SceneBindingActionOptions) {
  const manager = createSceneBindingManager({
    getElement: () => node,
    getOptions: () => options
  });
  manager.mount(node);
  manager.update(options);
  return {
    update(next: SceneBindingActionOptions) {
      manager.update(next);
    },
    destroy() {
      manager.destroy();
    }
  };
}
