import { attachSceneBinding, type AttachSceneBindingOptions } from "@voxcss/controller/sharedBindings";

export type SceneBindingActionOptions = Omit<AttachSceneBindingOptions, "element">;

export function sceneBinding(node: HTMLElement, options: SceneBindingActionOptions) {
  let binding = attachSceneBinding({ ...options, element: node });
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
