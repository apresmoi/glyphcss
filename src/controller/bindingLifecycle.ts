import type { ElementBindingHooks } from "./bindingAdapters";

export interface BindingLifecycleAdapterHooks<TOptions> extends ElementBindingHooks<TOptions> {}

export interface BindingLifecycle<TAdapter extends { sync(): void; destroy(): void }, TOptions> {
  setElement(element: HTMLElement | null): void;
  setOptions(options: TOptions | null): void;
  sync(): void;
  destroy(): void;
  getAdapter(): TAdapter | null;
}

export function createBindingLifecycle<TAdapter extends { sync(): void; destroy(): void }, TOptions>(
  factory: (hooks: BindingLifecycleAdapterHooks<TOptions | null>) => TAdapter
): BindingLifecycle<TAdapter, TOptions> {
  let destroyed = false;
  let element: HTMLElement | null = null;
  let options: TOptions | null = null;

  const adapter = factory({
    getElement: () => element,
    getOptions: () => options
  });

  const sync = () => {
    if (!destroyed) {
      adapter.sync();
    }
  };

  return {
    setElement(next) {
      element = next;
      sync();
    },
    setOptions(next) {
      options = next;
      sync();
    },
    sync,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      adapter.destroy();
      element = null;
      options = null;
    },
    getAdapter() {
      return destroyed ? null : adapter;
    }
  };
}
