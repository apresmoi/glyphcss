import { setImmediate } from "node:timers/promises";
import { afterEach } from "vitest";

// Long synchronous fit tests otherwise run back to back without a macrotask
// turn, starving the worker's RPC channel ("Timeout calling onTaskUpdate" on CI).
afterEach(async () => {
  await setImmediate();
});
