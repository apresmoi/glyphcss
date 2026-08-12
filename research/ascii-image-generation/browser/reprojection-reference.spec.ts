import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { expect, test } from "playwright/test";
import { disposeReferenceTrace, materializeReferenceTrace } from "../src/referenceTrace.mjs";
import { buildReferenceSignals } from "../src/referenceSignals.mjs";
import { wireReferenceFrame } from "../src/referenceWire.mjs";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const contractPath = fileURLToPath(new URL("../fixtures/reprojection/reference-trace-v1.json", import.meta.url));
const source = (path: string) => `/@fs${path}`;
const glyphcssSource = source(resolve(root, "packages/glyphcss/src/index.ts"));
const referenceWireSource = source(resolve(root, "research/ascii-image-generation/src/referenceWire.mjs"));
const referenceResultSource = source(resolve(root, "research/ascii-image-generation/src/referenceResult.mjs"));
const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`
    : JSON.stringify(value);
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const expectedResultChainSha256 = "a804bbdb657fb2d66b263c7681ef2ade4688674070d3c491d9ba2fd2b6ff6297";

test.skip(!process.env.GLYPHCSS_REFERENCE_CHROMIUM, "B37 is remote-only and requires the pinned Chrome-for-Testing binary");

test("reprojection-reference", async ({ page, browser }, testInfo) => {
  const output = process.env.GLYPHCSS_REFERENCE_OUTPUT;
  expect(output).toBeTruthy();
  expect(process.env.GLYPHCSS_WEBGPU_PRESENTATION).toBe("1");
  const gpuIdentityPath = process.env.GLYPHCSS_REFERENCE_GPU_IDENTITY;
  expect(gpuIdentityPath).toBeTruthy();
  const environmentManifestPath = process.env.GLYPHCSS_REFERENCE_ENVIRONMENT_MANIFEST;
  expect(environmentManifestPath).toBeTruthy();
  const environmentManifestBytes = await readFile(environmentManifestPath!);
  const environmentManifest = JSON.parse(environmentManifestBytes.toString());
  expect(environmentManifest.schemaVersion).toBe("glyph-reprojection-reference-environment/v1");
  const gpuIdentityText = (await readFile(gpuIdentityPath!, "utf8")).trim();
  const gpuIdentityParts = gpuIdentityText.split(",").map((value) => value.trim());
  expect(gpuIdentityParts).toHaveLength(4);
  const [gpuModel, gpuDriver, gpuMemory, gpuUuid] = gpuIdentityParts;
  expect(gpuModel).toBe("NVIDIA GeForce RTX 4090 Laptop GPU");
  expect(gpuDriver).toMatch(/^[0-9]+\.[0-9]+(?:\.[0-9]+)?$/);
  expect(gpuMemory).toBe("16376 MiB");
  expect(gpuUuid).toMatch(/^GPU-[a-f0-9-]+$/i);
  await page.goto((process.env.GLYPHCSS_GALLERY_URL ?? "http://127.0.0.1:43219").replace(/\/$/, "/"));
  const cdp = await browser.newBrowserCDPSession();
  const frozen = await materializeReferenceTrace();
  try {
    expect(frozen.transitions).toHaveLength(326);
    const browserVersion = await browser.version();
    expect(browserVersion).toBe("140.0.7339.80");
    // Chromium 140's ANGLE/Vulkan SystemInfo payload no longer exposes the
    // old `active` bit. The single enumerated ANGLE device plus its exact
    // NVIDIA identity and enabled Vulkan/WebGPU path is the CDP proof here;
    // the page below independently requests the non-fallback adapter.
    const gpuInfo = await cdp.send("SystemInfo.getInfo") as unknown as { gpu: { devices: Array<{ vendorId: number, deviceId: number, vendorString: string, deviceString: string }>, auxAttributes: Record<string, unknown>, featureStatus: Record<string, unknown> } };
    const devices = gpuInfo.gpu.devices.map(({ vendorId, deviceId, vendorString, deviceString }) => ({ vendorId, deviceId, vendorString, deviceString }));
    const cdpIdentity = JSON.stringify(devices).toLowerCase();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ vendorString: "Google Inc. (NVIDIA)" });
    expect(devices[0]?.deviceString).toContain("NVIDIA GeForce RTX 4090 Laptop GPU");
    expect(cdpIdentity).toContain("nvidia");
    expect(cdpIdentity).not.toMatch(/swiftshader|llvmpipe|software|cpu|mesa/);
    expect(gpuInfo.gpu.featureStatus.webgpu).toBe("enabled");
    expect(gpuInfo.gpu.featureStatus.vulkan).toBe("enabled_on");
    expect(gpuInfo.gpu.auxAttributes.displayType).toBe("ANGLE_VULKAN");
    expect(gpuInfo.gpu.auxAttributes.hardwareSupportsVulkan).toBe(true);
    expect(gpuInfo.gpu.auxAttributes.glImplementationParts).toBe("(gl=egl-angle,angle=vulkan)");
    expect(String(gpuInfo.gpu.auxAttributes.glRenderer)).toContain("NVIDIA GeForce RTX 4090 Laptop GPU");
    const frames = new Map<string, Record<string, unknown>>();
    for (const transition of frozen.transitions) { frames.set(transition.sourceFrame.id, transition.sourceFrame); frames.set(transition.targetFrame.id, transition.targetFrame); }
    const descriptors = frozen.transitions.map(({ sourceFrame, targetFrame, ...transition }: any) => ({ ...transition, sourceFrameId: sourceFrame.id, targetFrameId: targetFrame.id }));
    const chunks: Array<Array<Record<string, unknown>>> = [];
    for (const [index, frame] of [...frames.values()].map(wireReferenceFrame).entries()) {
      if (index % 16 === 0) chunks.push([]);
      chunks.at(-1)!.push(frame);
    }
    const initialized = await page.evaluate(async ({ glyphcssSource, referenceWireSource, referenceResultSource }) => {
      const gpu = (navigator as any).gpu; if (!gpu) throw new Error("WEBGPU_UNAVAILABLE");
      const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" }); if (!adapter) throw new Error("WEBGPU_ADAPTER_UNAVAILABLE");
      const info = adapter.info ? { vendor: adapter.info.vendor ?? "", architecture: adapter.info.architecture ?? "", device: adapter.info.device ?? "", description: adapter.info.description ?? "" } : null;
      const identity = JSON.stringify(info ?? {}).toLowerCase();
      if (!identity.includes("nvidia") || /swiftshader|llvmpipe|software|cpu|mesa/.test(identity) || adapter.isFallbackAdapter === true) throw new Error(`WEBGPU_ADAPTER_REJECTED:${identity}`);
      const features = [...adapter.features].sort();
      const device = await adapter.requestDevice({ requiredFeatures: features.includes("timestamp-query") ? ["timestamp-query"] : [] });
      const canvas = document.createElement("canvas"); canvas.id = "glyph-b37-webgpu-canvas"; canvas.width = 80; canvas.height = 24; canvas.style.cssText = "display:block;width:80px;height:24px;image-rendering:pixelated"; document.body.append(canvas);
      const [glyphcss, wire, referenceResult] = await Promise.all([import(glyphcssSource), import(referenceWireSource), import(referenceResultSource)]);
      const uncaptured: string[] = [], losses: string[] = [];
      device.addEventListener("uncapturederror", (event: any) => uncaptured.push(String(event.error?.message ?? event.error)));
      device.lost.then((event: any) => losses.push(`${event.reason}:${event.message}`));
      (window as any).__glyphB37 = { glyphcss, wire, referenceResult, device, canvas, frames: new Map(), uncaptured, losses };
      return { adapter: info, isFallbackAdapter: adapter.isFallbackAdapter === true, features, canvasPersistent: canvas.getContext("webgpu") !== null };
    }, { glyphcssSource, referenceWireSource, referenceResultSource });
    expect(initialized.canvasPersistent).toBe(true);
    for (const chunk of chunks) await page.evaluate(({ chunk }) => {
      const state = (window as any).__glyphB37;
      for (const frame of chunk) { const value = state.wire.inflateReferenceFrame(frame); state.frames.set(value.id, value); }
      return state.frames.size;
    }, { chunk });

    // Exact state/output proof is intentionally one untimed diagnostic pass.
    const oracle = await page.evaluate(async ({ descriptors }) => {
      const state = (window as any).__glyphB37;
      const rgb = (frame: any) => { const output = new Float32Array(frame.coverage.length * 3); for (let i = 0; i < frame.coverage.length; i += 1) { const color = frame.semanticColor[i] >>> 0; output[i * 3] = ((color >>> 16) & 255) / 255; output[i * 3 + 1] = ((color >>> 8) & 255) / 255; output[i * 3 + 2] = (color & 255) / 255; } return output; };
      const digest = async (bytes: Uint8Array) => {
        const input = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
        return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", input))).map((entry) => entry.toString(16).padStart(2, "0")).join("");
      };
      const hex = async (value: unknown) => digest(new TextEncoder().encode(state.referenceResult.canonicalReferenceResult(value)));
      const session = state.glyphcss.createGlyphSurfaceAtlasWebGpuSession({ device: state.device, canvas: state.canvas, atlasSize: 64, surfaceCapacity: 32, capturePresentation: true });
      const hashes: string[] = [], metrics: any[] = [], proofs: any[] = []; let cpuState: any = null;
      for (const transition of descriptors) {
        const sourceFrame = state.frames.get(transition.sourceFrameId), targetFrame = state.frames.get(transition.targetFrameId); if (!sourceFrame || !targetFrame) throw new Error(`B37_FRAME_MISSING:${transition.id}`);
        const sourceRgb = rgb(sourceFrame);
        const cpu = state.glyphcss.reprojectGlyphSurfaceAtlas({ state: cpuState, reset: transition.reset, sourceFrame, sourceRgb, sourceStateVersion: transition.sourceStateVersion, targetFrame, targetStateVersion: transition.targetStateVersion, atlasSize: 64 });
        session.submit({ reset: transition.reset, sourceFrame, sourceRgb, sourceStateVersion: transition.sourceStateVersion, targetFrame, targetStateVersion: transition.targetStateVersion });
        await state.device.queue.onSubmittedWorkDone();
        const [gpu, checkpoint, presentation] = await Promise.all([session.readback(), session.checkpoint(), session.readPresentation()]);
        const equal = (a: any, b: any) => a.length === b.length && a.every((value: number, index: number) => Object.is(value, b[index]));
        if (!equal(gpu.warpRgb, cpu.warpRgb) || !equal(gpu.reprojectionValid, cpu.reprojectionValid) || !equal(gpu.disocclusion, cpu.disocclusion) || !equal(gpu.atlasConfidence, cpu.atlasConfidence) || checkpoint.contentSha256 !== cpu.state.contentSha256) throw new Error(`B37_ORACLE_MISMATCH:${transition.id}`);
        const hash = await hex({ ...gpu, state: checkpoint }); if (hash !== transition.resultSha256) throw new Error(`B37_RESULT_HASH_MISMATCH:${transition.id}:${hash}`);
        const width = targetFrame.metadata.cols, height = targetFrame.metadata.rows, cellCount = width * height;
        if (presentation.width !== width || presentation.height !== height || presentation.bytesPerRow < width * 4) throw new Error(`B37_PRESENTATION_SHAPE:${transition.id}`);
        const compact = new Uint8Array(cellCount * 4); let presentationMismatches = 0;
        for (let row = 0; row < height; row += 1) for (let col = 0; col < width; col += 1) {
          const cell = row * width + col, sourceAt = row * presentation.bytesPerRow + col * 4, targetAt = cell * 4;
          const expected = [
            Math.round(cpu.warpRgb[cellCount * 2 + cell] * 255),
            Math.round(cpu.warpRgb[cellCount + cell] * 255),
            Math.round(cpu.warpRgb[cell] * 255),
            255,
          ];
          for (let channel = 0; channel < 4; channel += 1) {
            const actual = presentation.bgra[sourceAt + channel];
            compact[targetAt + channel] = actual;
            if (actual !== expected[channel]) presentationMismatches += 1;
          }
        }
        if (presentationMismatches !== 0) throw new Error(`B37_PRESENTATION_MISMATCH:${transition.id}:${presentationMismatches}`);
        const expectedRgb = rgb(targetFrame); let validError = 0, validValues = 0, coveredCells = 0, validCells = 0, disoccludedCells = 0;
        for (let cell = 0; cell < targetFrame.coverage.length; cell += 1) {
          if (targetFrame.coverage[cell]) coveredCells += 1;
          if (gpu.reprojectionValid[cell]) {
            validCells += 1;
            for (let channel = 0; channel < 3; channel += 1) { validError += Math.abs(gpu.warpRgb[channel * targetFrame.coverage.length + cell] - expectedRgb[cell * 3 + channel]); validValues += 1; }
          }
          if (gpu.disocclusion[cell]) disoccludedCells += 1;
        }
        hashes.push(hash);
        metrics.push({ frame: transition.id, coveredCells, validCells, disoccludedCells, validPixelError: validValues ? validError / validValues : 0 });
        proofs.push({ frame: transition.id, reset: transition.reset, readbackExact: true, checkpointExact: true, presentationExact: true, resultSha256: hash, checkpointContentSha256: checkpoint.contentSha256, presentationSha256: await digest(compact), presentationBytes: compact.byteLength, presentationMismatchBytes: presentationMismatches });
        cpuState = cpu.state;
      }
      session.destroy(); return { hashes, metrics, proofs, readbackCount: descriptors.length, checkpointCount: descriptors.length, presentationReadbackCount: descriptors.length };
    }, { descriptors });
    expect(sha(canonical(oracle.hashes))).toBe(expectedResultChainSha256);

    const timed = await page.evaluate(async ({ descriptors }) => {
      const state = (window as any).__glyphB37;
      const rgb = (frame: any) => { const output = new Float32Array(frame.coverage.length * 3); for (let i = 0; i < frame.coverage.length; i += 1) { const color = frame.semanticColor[i] >>> 0; output[i * 3] = ((color >>> 16) & 255) / 255; output[i * 3 + 1] = ((color >>> 8) & 255) / 255; output[i * 3 + 2] = (color & 255) / 255; } return output; };
      const spans: any[] = [];
      for (let run = 0; run < 40; run += 1) {
        const session = state.glyphcss.createGlyphSurfaceAtlasWebGpuSession({ device: state.device, canvas: state.canvas, atlasSize: 64, surfaceCapacity: 32 });
        for (const transition of descriptors) {
          const sourceFrame = state.frames.get(transition.sourceFrameId), targetFrame = state.frames.get(transition.targetFrameId); if (!sourceFrame || !targetFrame) throw new Error(`B37_TIMED_FRAME_MISSING:${transition.id}`);
          const sourceRgb = rgb(sourceFrame); const start = performance.now(); session.submit({ reset: transition.reset, sourceFrame, sourceRgb, sourceStateVersion: transition.sourceStateVersion, targetFrame, targetStateVersion: transition.targetStateVersion }); const submitEnd = performance.now();
          await state.device.queue.onSubmittedWorkDone();
          const gpuEnd = performance.now();
          await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); const end = performance.now();
          spans.push({ sampleId: `${String(run).padStart(2, "0")}:${transition.id}`, run, frame: transition.id, reset: transition.reset, presentationMs: end - start, submitEnqueueMs: submitEnd - start, gpuCompletionMs: gpuEnd - submitEnd, compositorPresentationMs: end - gpuEnd, timedInvariant: { readback: false, checkpoint: false, hash: false, fullStateSerialization: false, cpuReprojection: false, evidenceDigest: false, preTextContent: false, persistentCanvas: true } });
        }
        session.destroy();
      }
      return { spans, uncaptured: state.uncaptured, losses: state.losses, canvasCount: document.querySelectorAll("#glyph-b37-webgpu-canvas").length };
    }, { descriptors });
    expect(timed.spans).toHaveLength(40 * 326);
    expect(timed.canvasCount).toBe(1); expect(timed.uncaptured).toEqual([]); expect(timed.losses).toEqual([]);
    const oracleMetrics = new Map(oracle.metrics.map((metric: any) => [metric.frame, metric]));
    const spans = timed.spans.map((span: any) => ({ ...span, ...oracleMetrics.get(span.frame) }));
    const signals = buildReferenceSignals(spans, 326, 40);
    const tracingComplete = new Promise<any>((resolveTracing) => cdp.once("Tracing.tracingComplete", resolveTracing));
    await cdp.send("Tracing.start", { categories: "blink.user_timing,cc,gpu,benchmark,devtools.timeline,disabled-by-default-devtools.timeline.frame,disabled-by-default-gpu.service", options: "record-as-much-as-possible", transferMode: "ReturnAsStream" });
    const profiled = await page.evaluate(async ({ descriptors }) => {
      const state = (window as any).__glyphB37;
      const rgb = (frame: any) => { const output = new Float32Array(frame.coverage.length * 3); for (let i = 0; i < frame.coverage.length; i += 1) { const color = frame.semanticColor[i] >>> 0; output[i * 3] = ((color >>> 16) & 255) / 255; output[i * 3 + 1] = ((color >>> 8) & 255) / 255; output[i * 3 + 2] = (color & 255) / 255; } return output; };
      const session = state.glyphcss.createGlyphSurfaceAtlasWebGpuSession({ device: state.device, canvas: state.canvas, atlasSize: 64, surfaceCapacity: 32 });
      const profiles: any[] = [];
      for (let index = 0; index < 8; index += 1) {
        const transition = descriptors[index], sourceFrame = state.frames.get(transition.sourceFrameId), targetFrame = state.frames.get(transition.targetFrameId);
        const profileId = `profile-${String(index).padStart(2, "0")}`;
        performance.mark(`b37-profile/${profileId}/${transition.id}/start`);
        const profile = await session.submitProfiled({ reset: transition.reset, sourceFrame, sourceRgb: rgb(sourceFrame), sourceStateVersion: transition.sourceStateVersion, targetFrame, targetStateVersion: transition.targetStateVersion });
        const compositorStart = performance.now();
        await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const compositorPresentationMs = performance.now() - compositorStart;
        performance.mark(`b37-profile/${profileId}/${transition.id}/end`);
        profiles.push({ profileId, index, frame: transition.id, reset: transition.reset, compositorPresentationMs, ...profile });
      }
      session.destroy();
      return profiles;
    }, { descriptors });
    await cdp.send("Tracing.end");
    const traceComplete = await tracingComplete;
    let cdpTraceText = "";
    for (;;) {
      const chunk = await cdp.send("IO.read", { handle: traceComplete.stream });
      cdpTraceText += chunk.data;
      if (chunk.eof) break;
    }
    await cdp.send("IO.close", { handle: traceComplete.stream });
    const cdpEvents = JSON.parse(cdpTraceText).traceEvents as Array<{ name?: string, cat?: string, ts?: number }>;
    const presentationNames = /^(?:DrawFrame|Display::FrameDisplayed|SubmitCompositorFrame|SwapBuffers|FramePresented)$/;
    const correlations = profiled.map((profile: any, index: number) => {
      const start = cdpEvents.find((event) => event.name === `b37-profile/${profile.profileId}/${profile.frame}/start`);
      const end = cdpEvents.find((event) => event.name === `b37-profile/${profile.profileId}/${profile.frame}/end`);
      const presentation = start && end ? cdpEvents.find((event) => typeof event.ts === "number" && event.ts >= start.ts! && event.ts <= end.ts! && presentationNames.test(event.name ?? "") && !event.cat?.includes("user_timing")) : undefined;
      return { profileId: profile.profileId, index, frame: profile.frame, startTs: start?.ts ?? null, endTs: end?.ts ?? null, presentationEvent: presentation?.name ?? null, presentationTs: presentation?.ts ?? null };
    });
    expect(correlations.every((entry) => entry.startTs !== null && entry.endTs !== null && entry.presentationEvent !== null)).toBe(true);
    const cdpTracePath = `${output!}.cdp-profile.json`;
    await writeFile(cdpTracePath, cdpTraceText);
    const trace = { schemaVersion: "glyph-reprojection-webgpu-benchmark/v2", test: testInfo.title, browser: { version: browserVersion, userAgent: await page.evaluate(() => navigator.userAgent) }, provenance: { environmentManifestPath, environmentManifestSha256: sha(environmentManifestBytes) }, hardware: { nvidiaSmi: { model: gpuModel, driver: gpuDriver, memory: gpuMemory, uuid: gpuUuid } }, webgpu: { adapter: initialized.adapter, isFallbackAdapter: initialized.isFallbackAdapter, features: initialized.features, cdp: { devices, auxAttributes: gpuInfo.gpu.auxAttributes, featureStatus: gpuInfo.gpu.featureStatus } }, frozenTrace: { contract: "fixtures/reprojection/reference-trace-v1.json", contractSha256: sha(await readFile(contractPath)), inputSha256: frozen.expected.inputSha256, frameSha256: frozen.expected.frameSha256, eventSha256: frozen.expected.eventSha256, measurementContractSha256: "122b3a42d75f9e9a0b473c9c2c38814cce3dc4239d27bb935af183c7e9fd43e9", g5SignatureSha256: "0fee24a6ca7019f5a92974476e606b89eb990695b240a1cdfbab437d92e8885e", resultChainSha256: expectedResultChainSha256, runs: 40, framesPerRun: 326, oracle: { exact: true, readbackCount: oracle.readbackCount, checkpointCount: oracle.checkpointCount, presentationReadbackCount: oracle.presentationReadbackCount, resultHashes: oracle.hashes, metrics: oracle.metrics, proofs: oracle.proofs } }, spans, signals, profile: { boundedTransitions: profiled.length, timestampQueryExposed: initialized.features.includes("timestamp-query"), transitions: profiled, cdp: { path: cdpTracePath, sha256: sha(cdpTraceText), correlations } }, benchmark: { presentation: "GPU completion plus two compositor frames on one persistent WebGPU canvas", timedPath: "uninstrumented B47 GPU-resident atlas submit", neural: { value: null, reason: "B37 has no keyframe or asynchronous refinement implementation." } } };
    await writeFile(output!, `${canonical(trace)}\n`);
  } finally { await disposeReferenceTrace(frozen); await cdp.detach(); }
});
