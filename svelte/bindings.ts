import type { SceneBindingOptions } from "@voxcss/controller/sceneBindings";
import { createSceneBinding, type SceneBindingHandle } from "@voxcss/controller/sceneBindings";

export type SceneBindingActionOptions = Omit<SceneBindingOptions, "element">;

export function sceneBinding(node: HTMLElement, options: SceneBindingActionOptions) {
  let binding: SceneBindingHandle | null = createSceneBinding({ ...options, element: node });
  return {
    update(next: SceneBindingActionOptions) {
      options = next;
      binding?.update(next);
    },
    destroy() {
      binding?.destroy();
      binding = null;
    }
  };
}
