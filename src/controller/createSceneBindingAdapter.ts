import { createSceneBinding, type SceneBindingHandle, type SceneBindingOptions } from "./createSceneBinding";
import { createElementBindingAdapter } from "./bindingAdapters";
import { extractSceneState } from "./sceneOptions";
import { createBindingLifecycle } from "./bindingLifecycle";

export interface SceneBindingAdapterHooks {
  getElement(): HTMLElement | null;
  getOptions(): Omit<SceneBindingOptions, "element"> | null;
}

export interface SceneBindingAdapter {
  sync(): void;
  destroy(): void;
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
        return binding;
      },
      update(binding, options) {
        binding.update(extractSceneState(options));
      },
      destroy(binding) {
        binding.destroy();
      },
      shouldRemount(previous, next) {
        return previous.options.controller !== next.options.controller;
      }
    }
  );

  return {
    sync: () => adapter.sync(),
    destroy: () => adapter.destroy()
  };
}
export interface SceneBindingManagerInit<TOptions> {
  getElement(): HTMLElement | null;
  getOptions(): TOptions | null;
}

export interface SceneBindingManager<TOptions> {
  mount(element: HTMLElement): void;
  update(options?: TOptions): void;
  destroy(): void;
}

export function createSceneBindingManager<TOptions extends Omit<SceneBindingOptions, "element">>(
  init: SceneBindingManagerInit<TOptions>
): SceneBindingManager<TOptions> {
  const lifecycle = createBindingLifecycle<SceneBindingAdapter, TOptions | null>((hooks) =>
    createSceneBindingAdapter({
      getElement: () => hooks.getElement(),
      getOptions: () => hooks.getOptions()
    })
  );

  return {
    mount(element: HTMLElement) {
      lifecycle.setOptions(init.getOptions() ?? null);
      lifecycle.setElement(element);
    },
    update(options?: TOptions) {
      const next = options ?? init.getOptions();
      lifecycle.setOptions(next ?? null);
    },
    destroy() {
      lifecycle.destroy();
    }
  };
}
