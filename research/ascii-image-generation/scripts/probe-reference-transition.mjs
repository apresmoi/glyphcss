import { performance } from "node:perf_hooks";
import { chromium } from "playwright";
import { disposeReferenceTrace, materializeReferenceTrace } from "../src/referenceTrace.mjs";

const chromiumPath = process.env.GLYPHCSS_REFERENCE_CHROMIUM;
if (!chromiumPath) throw new Error("GLYPHCSS_REFERENCE_CHROMIUM is required.");

const phase = async (name, operation) => {
  const started = performance.now();
  try {
    const value = await Promise.race([
      operation(),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`REFERENCE_PHASE_WATCHDOG:${name}`)), 120_000)),
    ]);
    console.log(JSON.stringify({ phase: name, elapsedMs: performance.now() - started }));
    return value;
  } catch (error) {
    console.log(JSON.stringify({ phase: name, elapsedMs: performance.now() - started, error: String(error) }));
    throw error;
  }
};

const frozen = await phase("materialize", () => materializeReferenceTrace());
const wire = (frame) => Object.fromEntries(Object.entries(frame).map(([key, value]) => ArrayBuffer.isView(value) ? [key, Array.from(value)] : [key, value]));
const first = frozen.transitions[0];
const transition = { ...first, sourceFrame: wire(first.sourceFrame), targetFrame: wire(first.targetFrame) };
console.log(JSON.stringify({ phase: "wire", id: transition.id, bytes: Buffer.byteLength(JSON.stringify(transition)) }));

const browser = await chromium.launch({
  executablePath: chromiumPath,
  headless: true,
  args: [
    "--enable-unsafe-webgpu",
    "--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan",
    "--use-angle=vulkan",
    "--use-vulkan=native",
    "--disable-vulkan-surface",
    "--ignore-gpu-blocklist",
    "--disable-gpu-sandbox",
    "--no-sandbox",
    "--disable-software-rasterizer",
  ],
});
const page = await browser.newPage();
await phase("goto", () => page.goto(process.env.GLYPHCSS_GALLERY_URL ?? "http://127.0.0.1:43219/"));
await phase("import-inflate", () => page.evaluate(async ({ transition }) => {
  const glyphcss = await import("/@fs/workspace/packages/glyphcss/src/index.ts");
  const inflate = (frame) => ({
    ...frame,
    visibleColor: new Uint32Array(frame.visibleColor),
    semanticColor: new Uint32Array(frame.semanticColor),
    coverage: new Uint8Array(frame.coverage),
    winnerPolygon: new Int32Array(frame.winnerPolygon),
    classId: new Int32Array(frame.classId),
    instanceId: new Int32Array(frame.instanceId),
    surfaceId: new Int32Array(frame.surfaceId),
    depth: new Float64Array(frame.depth),
    shade: new Float32Array(frame.shade),
    normal: new Float32Array(frame.normal),
    worldPosition: new Float32Array(frame.worldPosition),
    surfaceUv: new Float32Array(frame.surfaceUv),
  });
  const output = document.createElement("pre");
  document.body.append(output);
  window.__glyphProbe = { glyphcss, output, state: null, transition: { ...transition, sourceFrame: inflate(transition.sourceFrame), targetFrame: inflate(transition.targetFrame) } };
  return { visibility: document.visibilityState, cells: transition.sourceFrame.coverage.length };
}, { transition }));
await phase("reproject", () => page.evaluate(() => {
  const session = window.__glyphProbe;
  const sourceRgb = (frame) => {
    const output = new Float32Array(frame.coverage.length * 3);
    for (let cell = 0; cell < frame.coverage.length; cell += 1) {
      const color = frame.semanticColor[cell] >>> 0;
      output[cell * 3] = ((color >>> 16) & 255) / 255;
      output[cell * 3 + 1] = ((color >>> 8) & 255) / 255;
      output[cell * 3 + 2] = (color & 255) / 255;
    }
    return output;
  };
  const started = performance.now();
  const transition = session.transition;
  session.result = session.glyphcss.reprojectGlyphSurfaceAtlas({
    state: session.state,
    reset: transition.reset,
    sourceFrame: transition.sourceFrame,
    sourceRgb: sourceRgb(transition.sourceFrame),
    sourceStateVersion: transition.sourceStateVersion,
    targetFrame: transition.targetFrame,
    targetStateVersion: transition.targetStateVersion,
  });
  return { elapsedMs: performance.now() - started, surfaces: session.result.state.surfaces.length };
}));
await phase("text", () => page.evaluate(() => {
  const started = performance.now();
  window.__glyphProbe.output.textContent = Array.from(window.__glyphProbe.result.warpRgb).join(",");
  return { elapsedMs: performance.now() - started, length: window.__glyphProbe.output.textContent.length };
}));
await phase("raf", () => page.evaluate(async () => {
  const started = performance.now();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  return { elapsedMs: performance.now() - started, visibility: document.visibilityState };
}));
await phase("post", () => page.evaluate(async () => {
  const started = performance.now();
  const { result, transition } = window.__glyphProbe;
  const covered = Array.from(transition.targetFrame.coverage).filter(Boolean).length;
  const valid = Array.from(result.reprojectionValid).filter(Boolean).length;
  const holes = Array.from(result.disocclusion).filter(Boolean).length;
  await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({
    rgb: Array.from(result.warpRgb),
    valid: Array.from(result.reprojectionValid),
    holes: Array.from(result.disocclusion),
    state: result.state.contentSha256,
  })));
  return { elapsedMs: performance.now() - started, covered, valid, holes };
}));
await page.evaluate(() => { window.__glyphProbe.state = window.__glyphProbe.result.state; });
const limit = Number.parseInt(process.env.GLYPHCSS_REFERENCE_PROBE_TRANSITIONS ?? "326", 10);
for (let index = 1; index < Math.min(limit, frozen.transitions.length); index += 1) {
  const next = frozen.transitions[index];
  const wired = { ...next, sourceFrame: wire(next.sourceFrame), targetFrame: wire(next.targetFrame) };
  await phase(`transition:${index}:${next.id}`, () => page.evaluate(async ({ transition }) => {
    const session = window.__glyphProbe;
    const inflate = (frame) => ({
      ...frame,
      visibleColor: new Uint32Array(frame.visibleColor),
      semanticColor: new Uint32Array(frame.semanticColor),
      coverage: new Uint8Array(frame.coverage),
      winnerPolygon: new Int32Array(frame.winnerPolygon),
      classId: new Int32Array(frame.classId),
      instanceId: new Int32Array(frame.instanceId),
      surfaceId: new Int32Array(frame.surfaceId),
      depth: new Float64Array(frame.depth),
      shade: new Float32Array(frame.shade),
      normal: new Float32Array(frame.normal),
      worldPosition: new Float32Array(frame.worldPosition),
      surfaceUv: new Float32Array(frame.surfaceUv),
    });
    const sourceRgb = (frame) => {
      const output = new Float32Array(frame.coverage.length * 3);
      for (let cell = 0; cell < frame.coverage.length; cell += 1) {
        const color = frame.semanticColor[cell] >>> 0;
        output[cell * 3] = ((color >>> 16) & 255) / 255;
        output[cell * 3 + 1] = ((color >>> 8) & 255) / 255;
        output[cell * 3 + 2] = (color & 255) / 255;
      }
      return output;
    };
    const sourceFrame = inflate(transition.sourceFrame);
    const targetFrame = inflate(transition.targetFrame);
    const start = performance.now();
    const result = session.glyphcss.reprojectGlyphSurfaceAtlas({
      state: session.state,
      reset: transition.reset,
      sourceFrame,
      sourceRgb: sourceRgb(sourceFrame),
      sourceStateVersion: transition.sourceStateVersion,
      targetFrame,
      targetStateVersion: transition.targetStateVersion,
    });
    session.output.textContent = Array.from(result.warpRgb).join(",");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    session.state = result.state;
    const covered = Array.from(targetFrame.coverage).filter(Boolean).length;
    const valid = Array.from(result.reprojectionValid).filter(Boolean).length;
    const holes = Array.from(result.disocclusion).filter(Boolean).length;
    let error = 0;
    let errorValues = 0;
    const expectedRgb = sourceRgb(targetFrame);
    for (let cell = 0; cell < targetFrame.coverage.length; cell += 1) if (result.reprojectionValid[cell]) {
      for (let channel = 0; channel < 3; channel += 1) {
        error += Math.abs(result.warpRgb[channel * targetFrame.coverage.length + cell] - expectedRgb[cell * 3 + channel]);
        errorValues += 1;
      }
    }
    const resultHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({
      rgb: Array.from(result.warpRgb),
      valid: Array.from(result.reprojectionValid),
      holes: Array.from(result.disocclusion),
      state: result.state.contentSha256,
    })));
    return {
      presentationMs: performance.now() - start,
      covered,
      valid,
      holes,
      validPixelError: errorValues ? error / errorValues : 0,
      hash: Array.from(new Uint8Array(resultHash)).map((value) => value.toString(16).padStart(2, "0")).join(""),
      pageHeapBytes: performance.memory?.usedJSHeapSize ?? null,
    };
  }, { transition: wired }));
}
await browser.close();
await disposeReferenceTrace(frozen);
