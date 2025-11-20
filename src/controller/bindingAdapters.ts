export interface ElementBindingHooks<TOptions> {
  getElement(): HTMLElement | null;
  getOptions(): TOptions | null;
}

export interface ElementBindingDriver<THandle, TOptions> {
  mount(element: HTMLElement, options: TOptions): THandle;
  update(handle: THandle, options: TOptions): void;
  destroy(handle: THandle, reason: "teardown" | "remount"): void;
  shouldRemount?(
    previous: { element: HTMLElement; options: TOptions; handle: THandle },
    next: { element: HTMLElement; options: TOptions }
  ): boolean;
}

export interface ElementBindingAdapter<THandle> {
  sync(): void;
  destroy(): void;
  getHandle(): THandle | null;
}

export function createElementBindingAdapter<THandle, TOptions>(
  hooks: ElementBindingHooks<TOptions>,
  driver: ElementBindingDriver<THandle, TOptions>
): ElementBindingAdapter<THandle> {
  let handle: THandle | null = null;
  let mountedElement: HTMLElement | null = null;
  let mountedOptions: TOptions | null = null;

  const teardown = (reason: "teardown" | "remount") => {
    if (!handle) return;
    driver.destroy(handle, reason);
    handle = null;
    mountedElement = null;
    mountedOptions = null;
  };

  const mount = (element: HTMLElement, options: TOptions) => {
    teardown("remount");
    handle = driver.mount(element, options);
    mountedElement = element;
    mountedOptions = options;
  };

  const sync = () => {
    const element = hooks.getElement();
    const options = hooks.getOptions();
    if (!element || !options) {
      teardown("teardown");
      return;
    }
    if (
      !handle ||
      mountedElement !== element ||
      (driver.shouldRemount &&
        driver.shouldRemount(
          { element: mountedElement, options: mountedOptions as TOptions, handle: handle },
          { element, options }
        ))
    ) {
      mount(element, options);
      return;
    }
    mountedOptions = options;
    driver.update(handle, options);
  };

  return {
    sync,
    destroy: () => {
      teardown("teardown");
    },
    getHandle: () => handle
  };
}
