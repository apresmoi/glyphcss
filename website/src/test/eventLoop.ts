import { setImmediate } from "node:timers/promises";
import { afterEach } from "vitest";

// Happy-dom's WeakRef caches keep detached DOM alive until the current JS job
// ends. Vitest's microtask-only test succession otherwise retains whole suites.
afterEach(async () => {
  await setImmediate();
});
