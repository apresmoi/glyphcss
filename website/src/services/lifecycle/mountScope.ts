/** Resources may finish loading after their React host has unmounted. */
export function createMountScope() {
  const abort = new AbortController();
  const cleanups: Array<() => void> = [];
  let disposed = false;
  const onDispose = (cleanup: () => void) => {
    if (disposed) cleanup();
    else cleanups.push(cleanup);
  };
  return {
    signal: abort.signal,
    onDispose,
    own<T>(resource: T, release: (resource: T) => void): T {
      onDispose(() => release(resource));
      return resource;
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      abort.abort();
      for (const cleanup of cleanups.reverse()) cleanup();
      cleanups.length = 0;
    },
  };
}
