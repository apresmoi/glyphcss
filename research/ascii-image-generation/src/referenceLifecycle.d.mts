export function runReferenceBrowserLifecycle<T>(
  resources: {
    cdp?: { detach(): Promise<void> };
    frozen?: unknown;
  },
  disposeTrace: (trace: unknown) => Promise<void>,
  body: () => Promise<T>,
): Promise<T>;
