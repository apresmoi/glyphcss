import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "playwright/test";
import { packGlyphControlTensor, reprojectGlyphSurfaceAtlas } from "glyphcss";
import { createTensorGoldenFrame } from "./tensorGolden";
import { createReprojectionFrame } from "./reprojectionGolden";

const source = (path: string) => `/@fs${path}`;
const glyphcssSource = source("/Users/apresmoi/glyphcss/packages/glyphcss/src/index.ts");
const goldenSource = source("/Users/apresmoi/glyphcss/research/ascii-image-generation/browser/tensorGolden.ts");
const reprojectionGoldenSource = source("/Users/apresmoi/glyphcss/research/ascii-image-generation/browser/reprojectionGolden.ts");
const fixture = JSON.parse(await readFile(fileURLToPath(new URL("../fixtures/reprojection/golden-v1.json", import.meta.url)), "utf8"));

test("reprojection", async ({ page }) => {
  const sourceFrame = createTensorGoldenFrame();
  const node = reprojectGlyphSurfaceAtlas({ state: null, sourceFrame, sourceRgb: new Float32Array([.2, .4, .6, 0, 0, 0]), sourceStateVersion: 0, targetFrame: sourceFrame, targetStateVersion: 1, atlasSize: 8 });
  const nodePacked = packGlyphControlTensor(sourceFrame, { depth: { near: -2, far: 10 }, world: { min: [-4, -3, -2], max: [4, 5, 6] } }, node.temporal);
  const firstFrame = createReprojectionFrame(fixture.sourceSurfaces, fixture.sourceUv);
  const firstTrace = reprojectGlyphSurfaceAtlas({ state: null, sourceFrame: firstFrame, sourceRgb: new Float32Array(fixture.sourceRgbCellMajor), sourceStateVersion: 0, targetFrame: firstFrame, targetStateVersion: 1, atlasSize: 8 });
  const swap = createReprojectionFrame(fixture.swapSurfaces, fixture.swapUv); swap.metadata.camera.rotX = 61;
  const nodeBranch = reprojectGlyphSurfaceAtlas({ state: firstTrace.state, sourceFrame: firstFrame, sourceRgb: new Float32Array(fixture.sourceRgbCellMajor), sourceStateVersion: 1, targetFrame: swap, targetStateVersion: 2 });
  const returned = createReprojectionFrame(fixture.sourceSurfaces, fixture.sourceUv);
  const nodeReturn = reprojectGlyphSurfaceAtlas({ state: nodeBranch.state, sourceFrame: swap, sourceRgb: new Float32Array([0, 1, 0, 1, 0, 0]), sourceStateVersion: 2, targetFrame: returned, targetStateVersion: 3 });
  await page.goto((process.env.GLYPHCSS_GALLERY_URL ?? "http://127.0.0.1:43219").replace(/\/$/, "/"));
  const browser = await page.evaluate(async ({ glyphcssSource, goldenSource, reprojectionGoldenSource, fixture }) => {
    const glyphcss = await import(glyphcssSource); const golden = await import(goldenSource); const frame = golden.createTensorGoldenFrame();
    const value = glyphcss.reprojectGlyphSurfaceAtlas({ state: null, sourceFrame: frame, sourceRgb: new Float32Array([.2, .4, .6, 0, 0, 0]), sourceStateVersion: 0, targetFrame: frame, targetStateVersion: 1, atlasSize: 8 });
    const packed = glyphcss.packGlyphControlTensor(frame, { depth: { near: -2, far: 10 }, world: { min: [-4, -3, -2], max: [4, 5, 6] } }, value.temporal);
    const empty = { ...frame, coverage: new Uint8Array([0, 0]), winnerPolygon: new Int32Array([-1, -1]), surfaceId: new Int32Array([-1, -1]), depth: new Float64Array([NaN, NaN]), worldPosition: new Float32Array([NaN, NaN, NaN, NaN, NaN, NaN]), surfaceUv: new Float32Array([NaN, NaN, NaN, NaN]) };
    const reset = glyphcss.reprojectGlyphSurfaceAtlas({ state: value.state, reset: true, sourceFrame: empty, sourceRgb: new Float32Array(6), sourceStateVersion: 1, targetFrame: frame, targetStateVersion: 2 });
    let stale = false; try { glyphcss.reprojectGlyphSurfaceAtlas({ state: value.state, sourceFrame: frame, sourceRgb: new Float32Array([.2, .4, .6, 0, 0, 0]), sourceStateVersion: 0, targetFrame: frame, targetStateVersion: 2 }); } catch { stale = true; }
    const trace = await import(reprojectionGoldenSource); const first = trace.createReprojectionFrame(fixture.sourceSurfaces, fixture.sourceUv); const seeded = glyphcss.reprojectGlyphSurfaceAtlas({ state: null, sourceFrame: first, sourceRgb: new Float32Array(fixture.sourceRgbCellMajor), sourceStateVersion: 0, targetFrame: first, targetStateVersion: 1, atlasSize: 8 }); const swapped = trace.createReprojectionFrame(fixture.swapSurfaces, fixture.swapUv); swapped.metadata.camera.rotX = 61; const branch = glyphcss.reprojectGlyphSurfaceAtlas({ state: seeded.state, sourceFrame: first, sourceRgb: new Float32Array(fixture.sourceRgbCellMajor), sourceStateVersion: 1, targetFrame: swapped, targetStateVersion: 2 }); const returned = trace.createReprojectionFrame(fixture.sourceSurfaces, fixture.sourceUv); const returnedResult = glyphcss.reprojectGlyphSurfaceAtlas({ state: branch.state, sourceFrame: swapped, sourceRgb: new Float32Array([0, 1, 0, 1, 0, 0]), sourceStateVersion: 2, targetFrame: returned, targetStateVersion: 3 });
    return { rgb: Array.from(value.warpRgb), valid: Array.from(value.reprojectionValid), holes: Array.from(value.disocclusion), stateVersion: value.state.stateVersion, hash: value.state.contentSha256, packed: Array.from(new Uint8Array(packed.temporal.buffer)), resetHoles: Array.from(reset.disocclusion), stale, frozen: Object.isFrozen(value.state), branch: { rgb: Array.from(branch.warpRgb), valid: Array.from(branch.reprojectionValid), holes: Array.from(branch.disocclusion), hash: branch.state.contentSha256 }, returned: { rgb: Array.from(returnedResult.warpRgb), valid: Array.from(returnedResult.reprojectionValid), holes: Array.from(returnedResult.disocclusion), hash: returnedResult.state.contentSha256 } };
  }, { glyphcssSource, goldenSource, reprojectionGoldenSource, fixture });
  expect(browser.rgb).toEqual(Array.from(node.warpRgb)); expect(browser.valid).toEqual(Array.from(node.reprojectionValid)); expect(browser.holes).toEqual(Array.from(node.disocclusion)); expect(browser.stateVersion).toBe(1); expect(browser.hash).toBe(node.state.contentSha256); expect(browser.packed).toEqual(Array.from(new Uint8Array(nodePacked.temporal!.buffer))); expect(browser.resetHoles).toEqual([1, 0]); expect(browser.stale).toBe(true); expect(browser.frozen).toBe(true);
  const fixtureWarp = new Float32Array(fixture.expectedWarpRgbNchw);
  expect(createHash("sha256").update(new Uint8Array(fixtureWarp.buffer)).digest("hex")).toBe(fixture.expectedWarpRgbNchwSha256);
  expect(browser.branch).toEqual({ rgb: Array.from(nodeBranch.warpRgb), valid: Array.from(nodeBranch.reprojectionValid), holes: Array.from(nodeBranch.disocclusion), hash: nodeBranch.state.contentSha256 });
  expect(browser.returned).toEqual({ rgb: Array.from(nodeReturn.warpRgb), valid: Array.from(nodeReturn.reprojectionValid), holes: Array.from(nodeReturn.disocclusion), hash: nodeReturn.state.contentSha256 });
});
