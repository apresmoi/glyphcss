import { createSceneBinding, type SceneBindingHandle, type SceneBindingOptions } from "./createSceneBinding";
import { createElementBindingAdapter } from "./bindingAdapters";
import { extractSceneState } from "./sceneOptions";

export interface SceneBindingAdapterHooks {
  getElement(): HTMLElement | null;
  getOptions(): Omit<SceneBindingOptions, "element"> | null;
  onUpdate?(handle: SceneBindingHandle | null): void;
}

export interface SceneBindingAdapter {
  sync(): void;
  destroy(): void;
  getHandle(): SceneBindingHandle | null;
}

export function createSceneBindingAdapter(hooks: SceneBindingAdapterHooks): SceneBindingAdapter {
  const adapter = createElementBindingAdapter<SceneBindingHandle, Omit<SceneBindingOptions, "element">>(
    {
      getElement: () => hooks.getElement(),
      getOptions: () => hooks.getOptions()
    },
    {
      mount(element, options) {
        const binding = createSceneBinding({ ...options, element });
        binding.mount();
        hooks.onUpdate?.(binding);
        return binding;
      },
      update(binding, options) {
        binding.update(extractSceneState(options));
        hooks.onUpdate?.(binding);
      },
      destroy(binding, _reason) {
        binding.destroy();
        hooks.onUpdate?.(null);
      },
      shouldRemount(previous, next) {
        return previous.options.controller !== next.options.controller;
      }
    }
  );

  return {
    sync: () => adapter.sync(),
    destroy: () => adapter.destroy(),
    getHandle: () => adapter.getHandle()
  };
}
