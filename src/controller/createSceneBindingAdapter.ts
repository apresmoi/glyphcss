import { createSceneBinding, type SceneBindingHandle, type SceneBindingOptions } from "./createSceneBinding";
import type { SceneController } from "./createSceneController";

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
  let binding: SceneBindingHandle | null = null;
  let mountedElement: HTMLElement | null = null;
  let mountedController: SceneController | null = null;

  const notify = (handle: SceneBindingHandle | null) => {
    hooks.onUpdate?.(handle);
  };

  const destroyBinding = () => {
    if (!binding) return;
    binding.destroy();
    binding = null;
    mountedElement = null;
    mountedController = null;
    notify(null);
  };

  const mountBinding = (options: Omit<SceneBindingOptions, "element">, element: HTMLElement) => {
    destroyBinding();
    binding = createSceneBinding({ ...options, element });
    binding.mount();
    mountedElement = element;
    mountedController = options.controller;
    notify(binding);
  };

  const sync = () => {
    const element = hooks.getElement();
    const options = hooks.getOptions();
    const controller = options?.controller ?? null;
    if (!element || !options || !controller) {
      destroyBinding();
      return;
    }
    if (!binding || mountedElement !== element || mountedController !== controller) {
      mountBinding(options, element);
      return;
    }
    binding.update({
      voxels: options.voxels,
      rows: options.rows,
      cols: options.cols,
      depth: options.depth,
      showWalls: options.showWalls,
      showFloor: options.showFloor,
      projection: options.projection
    });
    notify(binding);
  };

  const destroy = () => {
    destroyBinding();
  };

  const getHandle = () => binding;

  return {
    sync,
    destroy,
    getHandle
  };
}
