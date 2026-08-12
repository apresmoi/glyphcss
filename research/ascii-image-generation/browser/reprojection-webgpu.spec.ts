import { expect, test } from "playwright/test";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const source = (path: string) => `/@fs${path}`;
const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const glyphcssSource = source(resolve(root, "packages/glyphcss/src/index.ts"));
const goldenSource = source(resolve(root, "research/ascii-image-generation/browser/reprojectionGolden.ts"));

test("reprojection-webgpu", async ({ page }) => {
  await page.goto((process.env.GLYPHCSS_GALLERY_URL ?? "http://127.0.0.1:43219").replace(/\/$/, "/"));
  const result = await page.evaluate(async ({ glyphcssSource, goldenSource }) => {
    const gpu = (navigator as any).gpu;
    if (!gpu) return { available: false };
    const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) return { available: false };
    const timestampQuery = adapter.features.has("timestamp-query");
    const device = await adapter.requestDevice({ requiredFeatures: timestampQuery ? ["timestamp-query"] : [] });
    const glyphcss = await import(glyphcssSource), golden = await import(goldenSource);
    const canvas = document.createElement("canvas"); canvas.width = 2; canvas.height = 1; document.body.append(canvas);
    const dispatchLimitRejected = (() => {
      const impossible = document.createElement("canvas");
      try { glyphcss.createGlyphSurfaceAtlasWebGpuSession({ device, canvas: impossible, atlasSize: 512, surfaceCapacity: 32 }); return false; } catch { return true; }
    })();
    const session = glyphcss.createGlyphSurfaceAtlasWebGpuSession({ device, canvas, atlasSize: 8, surfaceCapacity: 4, capturePresentation: true });
    const sourceFrame = golden.createReprojectionFrame(["surface/a", "surface/a"], [[.5, .5], [.5, .5]]);
    const targetFrame = golden.createReprojectionFrame(["surface/a", "surface/a"], [[.5, .5], [.9, .1]]);
    // Same texel collision: the last source cell (green) must win exactly as
    // the ordered CPU oracle does. The second target cell is a deliberate reveal.
    const rgb = new Float32Array([1, 0, 0, 0, 1, 0]);
    const cpu = glyphcss.reprojectGlyphSurfaceAtlas({ state: null, sourceFrame, sourceRgb: rgb, sourceStateVersion: 0, targetFrame, targetStateVersion: 1, atlasSize: 8 });
    const invalidVersions = [
      { sourceStateVersion: -1, targetStateVersion: 0 },
      { sourceStateVersion: .5, targetStateVersion: 1.5 },
    ].every((versions) => {
      try { session.submit({ sourceFrame, sourceRgb: rgb, targetFrame, ...versions }); return false; } catch { return true; }
    });
    session.submit({ sourceFrame, sourceRgb: rgb, sourceStateVersion: 0, targetFrame, targetStateVersion: 1 });
    await device.queue.onSubmittedWorkDone();
    const gpuResult = await session.readback();
    const checkpointBefore = await session.checkpoint();
    const overflowFrame = golden.createReprojectionFrame(["surface/a", "surface/b", "surface/c", "surface/d", "surface/e"], [[.1, .1], [.2, .2], [.3, .3], [.4, .4], [.5, .5]]);
    const capacityRejected = (() => {
      try { session.submit({ reset: true, sourceFrame: overflowFrame, sourceRgb: new Float32Array(15), sourceStateVersion: 1, targetFrame: overflowFrame, targetStateVersion: 2 }); return false; } catch { return true; }
    })();
    const checkpointAfter = await session.checkpoint();
    const gpuAfterCapacityFailure = await session.readback();
    const profileCanvas = document.createElement("canvas"); profileCanvas.width = 2; profileCanvas.height = 1; document.body.append(profileCanvas);
    const profiledSession = glyphcss.createGlyphSurfaceAtlasWebGpuSession({ device, canvas: profileCanvas, atlasSize: 8, surfaceCapacity: 4 });
    const profile = await profiledSession.submitProfiled({ sourceFrame, sourceRgb: rgb, sourceStateVersion: 0, targetFrame, targetStateVersion: 1 });
    profiledSession.destroy();
    const canvasContext = canvas.getContext("webgpu");
    const stale = (() => { try { session.submit({ sourceFrame, sourceRgb: rgb, sourceStateVersion: 0, targetFrame, targetStateVersion: 1 }); return false; } catch { return true; } })();
    device.destroy();
    await device.lost;
    await Promise.resolve();
    const lostSubmitRejected = (() => { try { session.submit({ sourceFrame, sourceRgb: rgb, sourceStateVersion: 1, targetFrame, targetStateVersion: 2 }); return false; } catch { return true; } })();
    const lostAsyncRejected = await Promise.all([
      session.readback().then(() => false, () => true),
      session.checkpoint().then(() => false, () => true),
      session.readPresentation().then(() => false, () => true),
    ]);
    session.destroy();
    const destroyedRejected = await session.readback().then(() => false, () => true);
    return { available: true, adapter: adapter.info ? { vendor: adapter.info.vendor, device: adapter.info.device } : null, canvasPersistent: !!canvasContext, dispatchLimitRejected, invalidVersions, capacityRejected, capacityTransactional: checkpointAfter.contentSha256 === checkpointBefore.contentSha256 && Array.from(gpuAfterCapacityFailure.warpRgb).every((value, index) => value === gpuResult.warpRgb[index]), profile, timestampQuery, stale, lostSubmitRejected, lostAsyncRejected, destroyedRejected, cpu: { warp: Array.from(cpu.warpRgb), valid: Array.from(cpu.reprojectionValid), holes: Array.from(cpu.disocclusion), confidence: Array.from(cpu.atlasConfidence) }, gpu: { warp: Array.from(gpuResult.warpRgb), valid: Array.from(gpuResult.reprojectionValid), holes: Array.from(gpuResult.disocclusion), confidence: Array.from(gpuResult.atlasConfidence) } };
  }, { glyphcssSource, goldenSource });
  test.skip(!result.available, "WebGPU is not available in this browser");
  expect(result.canvasPersistent).toBe(true);
  expect(result.dispatchLimitRejected).toBe(true);
  expect(result.invalidVersions).toBe(true);
  expect(result.capacityRejected).toBe(true);
  expect(result.capacityTransactional).toBe(true);
  expect(Object.values(result.profile.cpu).every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)).toBe(true);
  expect(result.profile.gpu.timestampQuery).toBe(result.timestampQuery);
  if (result.timestampQuery) {
    expect([result.profile.gpu.computeNs, result.profile.gpu.renderNs, result.profile.gpu.totalNs].every((value) => Number.isFinite(value) && value! >= 0)).toBe(true);
    expect(result.profile.gpu.totalNs).toBe(result.profile.gpu.computeNs! + result.profile.gpu.renderNs!);
  }
  else expect(result.profile.gpu).toMatchObject({ computeNs: null, renderNs: null, totalNs: null });
  expect(result.stale).toBe(true);
  expect(result.lostSubmitRejected).toBe(true);
  expect(result.lostAsyncRejected).toEqual([true, true, true]);
  expect(result.destroyedRejected).toBe(true);
  expect(result.gpu).toEqual(result.cpu);
});
