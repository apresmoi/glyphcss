import { describe, expect, it, vi } from "vitest";
import { runReferenceBrowserLifecycle } from "../src/referenceLifecycle.mjs";

describe("reference browser resource lifecycle", () => {
  it("detaches CDP before disposing the frozen trace", async () => {
    const order: string[] = [];
    const result = await runReferenceBrowserLifecycle(
      { cdp: { detach: async () => { order.push("detach"); } }, frozen: "trace" },
      async (trace) => { expect(trace).toBe("trace"); order.push("dispose"); },
      async () => { order.push("body"); return 4090; },
    );
    expect(result).toBe(4090);
    expect(order).toEqual(["body", "detach", "dispose"]);
  });

  it("preserves detach and disposal failures together in deterministic order", async () => {
    const detachError = new Error("detach failed");
    const disposeError = new Error("dispose failed");
    const failure = await runReferenceBrowserLifecycle(
      { cdp: { detach: async () => { throw detachError; } }, frozen: "trace" },
      async () => { throw disposeError; },
      async () => {},
    ).catch((error) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.message).toBe("REFERENCE_CLEANUP_FAILED");
    expect(failure.errors).toEqual([detachError, disposeError]);
  });

  it("preserves the primary body failure before every cleanup failure", async () => {
    const bodyError = new Error("body failed");
    const detachError = new Error("detach failed");
    const disposeError = new Error("dispose failed");
    const failure = await runReferenceBrowserLifecycle(
      { cdp: { detach: async () => { throw detachError; } }, frozen: "trace" },
      async () => { throw disposeError; },
      async () => { throw bodyError; },
    ).catch((error) => error);
    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure.message).toBe("REFERENCE_BODY_AND_CLEANUP_FAILED");
    expect(failure.errors).toEqual([bodyError, detachError, disposeError]);
  });

  it("cleans up whichever resource was acquired before setup failed", async () => {
    const detach = vi.fn(async () => {});
    const dispose = vi.fn(async () => {});
    await runReferenceBrowserLifecycle({ cdp: { detach } }, dispose, async () => {});
    expect(detach).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();
    await runReferenceBrowserLifecycle({ frozen: "trace" }, dispose, async () => {});
    expect(dispose).toHaveBeenCalledWith("trace");
  });
});
