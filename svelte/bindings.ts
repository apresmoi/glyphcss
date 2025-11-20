import type { SceneBindingOptions } from "@voxcss/controller/createSceneBinding";
import { createSceneBindingAdapter } from "@voxcss/controller/createSceneBindingAdapter";
import { createBindingLifecycle } from "@voxcss/controller/bindingLifecycle";

export type SceneBindingActionOptions = Omit<SceneBindingOptions, "element">;

export function sceneBinding(node: HTMLElement, options: SceneBindingActionOptions) {
  const lifecycle = createBindingLifecycle((hooks) =>
    createSceneBindingAdapter({
      getElement: () => hooks.getElement(),
      getOptions: () => hooks.getOptions()
    })
  );
  lifecycle.setOptions(options);
  lifecycle.setElement(node);
  return {
    update(next: SceneBindingActionOptions) {
      lifecycle.setOptions(next);
    },
    destroy() {
      lifecycle.destroy();
    }
  };
}
