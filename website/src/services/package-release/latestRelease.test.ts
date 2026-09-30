import { afterEach, expect, it, vi } from "vitest";
import { latestRelease } from "./latestRelease";
afterEach(() => vi.unstubAllGlobals());
it("reads the published version and forwards cancellation", async () => {
  const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ version: "2.3.4" }) });
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  expect(await latestRelease(signal)).toBe("2.3.4");
  expect(fetcher).toHaveBeenCalledWith("https://registry.npmjs.org/glyphcss/latest", { signal });
});
it.each([null, {}, { version: "not a version" }])("does not invent a version for invalid metadata %j", async (value) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => value }));
  expect(await latestRelease()).toBeNull();
});
it("degrades to the package link when npm cannot be reached", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  expect(await latestRelease()).toBeNull();
});
