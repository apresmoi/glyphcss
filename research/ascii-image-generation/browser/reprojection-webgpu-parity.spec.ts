import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { expect, test } from "playwright/test";
import { disposeReferenceTrace, materializeReferenceTrace } from "../src/referenceTrace.mjs";
import { wireReferenceFrame } from "../src/referenceWire.mjs";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const source = (path: string) => `/@fs${path}`;
const glyphcssSource = source(resolve(root, "packages/glyphcss/src/index.ts"));
const referenceResultSource = source(resolve(root, "research/ascii-image-generation/src/referenceResult.mjs"));
const referenceWireSource = source(resolve(root, "research/ascii-image-generation/src/referenceWire.mjs"));
const webGpuSessionSource = `${source(resolve(root, "packages/glyphcss/src/api/reprojectSurfaceAtlasWebGpu.ts"))}?raw`;
const expectedResultChainSha256 = "a804bbdb657fb2d66b263c7681ef2ade4688674070d3c491d9ba2fd2b6ff6297";

const canonical = (value: unknown): string => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value as Record<string, unknown>).sort().filter((key) => (value as Record<string, unknown>)[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`
    : value === undefined ? "null" : JSON.stringify(value);

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

test.skip(!process.env.GLYPHCSS_REFERENCE_CHROMIUM, "the parity lane is remote-only and requires pinned Chromium");

test("reprojection-webgpu-parity", async ({ page, browser }) => {
  const output = process.env.GLYPHCSS_WEBGPU_PARITY_OUTPUT;
  expect(output).toBeTruthy();
  expect(process.env.GLYPHCSS_REFERENCE_CHROMIUM).toBeTruthy();
  await page.goto((process.env.GLYPHCSS_GALLERY_URL ?? "http://127.0.0.1:43219").replace(/\/$/, "/"));

  const cdp = await browser.newBrowserCDPSession();
  try {
    const gpuInfo = await cdp.send("SystemInfo.getInfo") as unknown as { gpu: { devices: Array<{ vendorId: number, deviceId: number, vendorString: string, deviceString: string, active: boolean }>, auxAttributes: Record<string, unknown>, featureStatus: Record<string, unknown> } };
    const browserVersion = await browser.version();
    expect(browserVersion).toBe("140.0.7339.80");
    const devices = gpuInfo.gpu.devices.map((device) => ({ vendorId: device.vendorId, deviceId: device.deviceId, vendorString: device.vendorString, deviceString: device.deviceString, active: device.active }));
    const cdpIdentity = JSON.stringify(devices).toLowerCase();
    expect(cdpIdentity).toContain("nvidia");
    expect(cdpIdentity).not.toMatch(/swiftshader|llvmpipe|software|cpu|mesa/);

    const frozen = await materializeReferenceTrace();
    try {
      expect(frozen.transitions).toHaveLength(326);
      const uniqueFrames = new Map<string, Record<string, unknown>>();
      for (const transition of frozen.transitions) {
        uniqueFrames.set(transition.sourceFrame.id, transition.sourceFrame);
        uniqueFrames.set(transition.targetFrame.id, transition.targetFrame);
      }
      const frameChunks: Array<Array<Record<string, unknown>>> = [];
      const frames = [...uniqueFrames.values()].map((frame) => wireReferenceFrame(frame));
      for (let index = 0; index < frames.length; index += 16) frameChunks.push(frames.slice(index, index + 16));
      const transitions = frozen.transitions.map(({ sourceFrame, targetFrame, ...transition }: { sourceFrame: { id: string }, targetFrame: { id: string }, [key: string]: unknown }) => ({ ...transition, sourceFrameId: sourceFrame.id, targetFrameId: targetFrame.id }));

      const initialized = await page.evaluate(async ({ glyphcssSource, referenceResultSource, referenceWireSource, webGpuSessionSource }) => {
        const gpu = (navigator as any).gpu;
        if (!gpu) throw new Error("WEBGPU_UNAVAILABLE");
        const adapter = await gpu.requestAdapter({ powerPreference: "high-performance" });
        if (!adapter) throw new Error("WEBGPU_ADAPTER_UNAVAILABLE");
        const rawInfo = adapter.info as { vendor?: string, architecture?: string, device?: string, description?: string } | undefined;
        const info = rawInfo ? { vendor: rawInfo.vendor ?? "", architecture: rawInfo.architecture ?? "", device: rawInfo.device ?? "", description: rawInfo.description ?? "" } : null;
        const adapterIdentity = JSON.stringify(info ?? {}).toLowerCase();
        if (!adapterIdentity.includes("nvidia") || /swiftshader|llvmpipe|software|cpu|mesa/.test(adapterIdentity)) throw new Error(`WEBGPU_ADAPTER_REJECTED:${adapterIdentity}`);
        if (adapter.isFallbackAdapter === true) throw new Error("WEBGPU_FALLBACK_ADAPTER_REJECTED");
        const device = await adapter.requestDevice();
        const sourceModule = await import(webGpuSessionSource) as { default: string };
        const shader = sourceModule.default.match(/const shader = \/\* wgsl \*\/`([\s\S]*?)`;/)?.[1];
        if (!shader) throw new Error("WEBGPU_SHADER_SOURCE_EXTRACT_FAILED");
        const shaderModule = device.createShaderModule({ code: shader });
        const shaderDiagnostics = (await shaderModule.getCompilationInfo()).messages.map((message: any) => ({ type: message.type, line: message.lineNum, column: message.linePos, message: message.message }));
        const shaderErrors = shaderDiagnostics.filter((message: { type: string }) => message.type === "error");
        if (shaderErrors.length) throw new Error(`WEBGPU_SHADER_COMPILE:${JSON.stringify(shaderErrors)}`);
        const glyphcss = await import(glyphcssSource);
        const referenceResult = await import(referenceResultSource);
        const referenceWire = await import(referenceWireSource);
        const canvas = document.createElement("canvas");
        canvas.id = "glyph-webgpu-parity-canvas";
        canvas.width = 80; canvas.height = 24;
        canvas.style.cssText = "display:block;width:80px;height:24px;image-rendering:pixelated";
        canvas.dataset.glyphWebgpuParity = "true";
        document.body.append(canvas);
        const validationErrors: string[] = [], uncapturedErrors: string[] = [], losses: string[] = [];
        device.addEventListener("uncapturederror", (event: any) => uncapturedErrors.push(String(event.error?.message ?? event.error)));
        device.lost.then((info: any) => losses.push(`${info.reason}:${info.message}`));
        const limitNames = ["maxTextureDimension1D", "maxTextureDimension2D", "maxTextureDimension3D", "maxTextureArrayLayers", "maxBindGroups", "maxBindingsPerBindGroup", "maxDynamicUniformBuffersPerPipelineLayout", "maxDynamicStorageBuffersPerPipelineLayout", "maxSampledTexturesPerShaderStage", "maxSamplersPerShaderStage", "maxStorageBuffersPerShaderStage", "maxStorageTexturesPerShaderStage", "maxUniformBuffersPerShaderStage", "maxUniformBufferBindingSize", "maxStorageBufferBindingSize", "minUniformBufferOffsetAlignment", "minStorageBufferOffsetAlignment", "maxVertexBuffers", "maxBufferSize", "maxVertexAttributes", "maxVertexBufferArrayStride", "maxInterStageShaderComponents", "maxColorAttachments", "maxColorAttachmentBytesPerSample", "maxComputeWorkgroupStorageSize", "maxComputeInvocationsPerWorkgroup", "maxComputeWorkgroupSizeX", "maxComputeWorkgroupSizeY", "maxComputeWorkgroupSizeZ", "maxComputeWorkgroupsPerDimension"];
        const limits = Object.fromEntries(limitNames.map((name) => [name, (adapter.limits as any)[name]]).filter(([, value]) => value !== undefined));
        (window as any).__glyphWebGpuParity = { glyphcss, referenceResult, inflateReferenceFrame: referenceWire.inflateReferenceFrame, device, canvas, frames: new Map(), session: null, validationErrors, uncapturedErrors, losses };
        return { adapterInfo: info ?? null, isFallbackAdapter: adapter.isFallbackAdapter === true, features: [...adapter.features].sort(), limits, shaderDiagnostics };
      }, { glyphcssSource, referenceResultSource, referenceWireSource, webGpuSessionSource });
      const adapterIdentity = JSON.stringify(initialized.adapterInfo ?? {}).toLowerCase();
      expect(adapterIdentity).toContain("nvidia");
      expect(adapterIdentity).not.toMatch(/swiftshader|llvmpipe|software|cpu|mesa/);

      for (const chunk of frameChunks) {
        await page.evaluate(({ chunk }) => {
          const parity = (window as any).__glyphWebGpuParity;
          for (const frame of chunk) {
            const inflated = parity.inflateReferenceFrame(frame);
            parity.frames.set(inflated.id, inflated);
          }
          return parity.frames.size;
        }, { chunk });
      }
      expect(await page.evaluate(() => (window as any).__glyphWebGpuParity.frames.size)).toBe(uniqueFrames.size);

      const result = await page.evaluate(async ({ transitions }) => {
        const parity = (window as any).__glyphWebGpuParity;
        const sourceRgb = (frame: { coverage: Uint8Array, semanticColor: Uint32Array }) => {
          const output = new Float32Array(frame.coverage.length * 3);
          for (let cell = 0; cell < frame.coverage.length; cell += 1) {
            const color = frame.semanticColor[cell]! >>> 0;
            output[cell * 3] = ((color >>> 16) & 255) / 255;
            output[cell * 3 + 1] = ((color >>> 8) & 255) / 255;
            output[cell * 3 + 2] = (color & 255) / 255;
          }
          return output;
        };
        const hex = async (text: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))).map((value) => value.toString(16).padStart(2, "0")).join("");
        parity.session = parity.glyphcss.createGlyphSurfaceAtlasWebGpuSession({ device: parity.device, canvas: parity.canvas, atlasSize: 64, surfaceCapacity: 32, capturePresentation: true });
        if (parity.session.atlasSize !== 64) throw new Error("WEBGPU_ATLAS_SIZE_DRIFT");
        const hashes: string[] = [], checkpoints: string[] = [];
        let finalReadback: any = null, finalDimensions: { cols: number, rows: number } | null = null;
        let cpuState: any = null;
        const firstDifference = (left: Float32Array, right: Float32Array, label: string) => {
          for (let index = 0; index < left.length; index += 1) if (!Object.is(left[index], right[index])) return `${label}[${index}]=${left[index]}/${right[index]}`;
          return null;
        };
        const stateDifference = (gpu: any, cpu: any) => {
          const provenance = JSON.stringify(gpu.provenance) === JSON.stringify(cpu.provenance) ? null : { gpu: gpu.provenance, cpu: cpu.provenance };
          const gpuOrder = gpu.surfaces.map((surface: any) => surface.surfaceId), cpuOrder = cpu.surfaces.map((surface: any) => surface.surfaceId);
          if (JSON.stringify(gpuOrder) !== JSON.stringify(cpuOrder)) return { provenance, order: { gpu: gpuOrder, cpu: cpuOrder } };
          for (let index = 0; index < gpu.surfaces.length; index += 1) {
            const gpuSurface = gpu.surfaces[index], cpuSurface = cpu.surfaces[index];
            const rgb = firstDifference(gpuSurface.rgb, cpuSurface.rgb, "rgb"), confidence = firstDifference(gpuSurface.confidence, cpuSurface.confidence, "confidence");
            if (rgb || confidence) return { provenance, surface: gpuSurface.surfaceId, rgb, confidence };
          }
          return provenance;
        };
        const binaryHash = async (value: Float32Array) => { const bytes = new Uint8Array(value.byteLength); bytes.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)); return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer))).map((entry) => entry.toString(16).padStart(2, "0")).join(""); };
        for (const transition of transitions) {
          const sourceFrame = parity.frames.get(transition.sourceFrameId), targetFrame = parity.frames.get(transition.targetFrameId);
          if (!sourceFrame || !targetFrame) throw new Error(`WEBGPU_PARITY_FRAME_MISSING:${transition.id}`);
          const acceptedRgb = sourceRgb(sourceFrame);
          const cpu = parity.glyphcss.reprojectGlyphSurfaceAtlas({ state: cpuState, reset: transition.reset, sourceFrame, sourceRgb: acceptedRgb, sourceStateVersion: transition.sourceStateVersion, targetFrame, targetStateVersion: transition.targetStateVersion, atlasSize: 64 });
          parity.device.pushErrorScope("validation");
          parity.session.submit({ reset: transition.reset, sourceFrame, sourceRgb: acceptedRgb, sourceStateVersion: transition.sourceStateVersion, targetFrame, targetStateVersion: transition.targetStateVersion });
          await parity.device.queue.onSubmittedWorkDone();
          const validation = await parity.device.popErrorScope();
          if (validation) {
            const message = String(validation.message ?? validation);
            parity.validationErrors.push(`${transition.id}:${message}`);
            throw new Error(`WEBGPU_VALIDATION_ERROR:${transition.id}:${message}`);
          }
          // This boundary is deliberately outside B37 timing. It proves the GPU
          // state and output against every B39 transition before measurement.
          const readback = await parity.session.readback();
          const state = await parity.session.checkpoint();
          const mismatch = firstDifference(readback.warpRgb, cpu.warpRgb, "warpRgb")
            ?? firstDifference(readback.reprojectionValid, cpu.reprojectionValid, "reprojectionValid")
            ?? firstDifference(readback.disocclusion, cpu.disocclusion, "disocclusion")
            ?? firstDifference(readback.atlasConfidence, cpu.atlasConfidence, "atlasConfidence")
            ?? (state.contentSha256 === cpu.state.contentSha256 ? null : `state=${state.contentSha256}/${cpu.state.contentSha256}`);
          if (mismatch) {
            const hashes = await Promise.all([readback.warpRgb, cpu.warpRgb, readback.reprojectionValid, cpu.reprojectionValid, readback.disocclusion, cpu.disocclusion, readback.atlasConfidence, cpu.atlasConfidence].map(binaryHash));
            throw new Error(`WEBGPU_CPU_PARITY_MISMATCH:${transition.id}:${mismatch}:${JSON.stringify({ outputHashes: { warpRgb: [hashes[0], hashes[1]], reprojectionValid: [hashes[2], hashes[3]], disocclusion: [hashes[4], hashes[5]], atlasConfidence: [hashes[6], hashes[7]] }, state: stateDifference(state, cpu.state) })}`);
          }
          const hash = await hex(parity.referenceResult.canonicalReferenceResult({ ...readback, state }));
          if (hash !== transition.resultSha256) throw new Error(`WEBGPU_RESULT_HASH_MISMATCH:${transition.id}:${hash}:${transition.resultSha256}`);
          hashes.push(hash); checkpoints.push(state.contentSha256); cpuState = cpu.state; finalReadback = readback; finalDimensions = { cols: targetFrame.metadata.cols, rows: targetFrame.metadata.rows };
        }
        if (!finalReadback || !finalDimensions) throw new Error("WEBGPU_PARITY_FINAL_OUTPUT_MISSING");
        const target = await parity.session.readPresentation();
        let targetMismatches = 0;
        for (let row = 0; row < target.height; row += 1) for (let col = 0; col < target.width; col += 1) for (let channel = 0; channel < 3; channel += 1) {
          const cell = row * target.width + col, actual = target.bgra[row * target.bytesPerRow + col * 4 + (2 - channel)]!, expected = Math.round(finalReadback.warpRgb[channel * target.width * target.height + cell]! * 255);
          if (actual !== expected) targetMismatches += 1;
        }
        if (targetMismatches !== 0) throw new Error(`WEBGPU_RENDER_TARGET_MISMATCH:${targetMismatches}`);
        return { hashes, checkpoints, validationErrors: parity.validationErrors, uncapturedErrors: parity.uncapturedErrors, losses: parity.losses, presentation: { width: finalDimensions.cols, height: finalDimensions.rows, warpRgb: Array.from(finalReadback.warpRgb) } };
      }, { transitions });

      // The copy in submit() proves the exact GPU texture.  Two compositor
      // frames make the separately captured browser presentation observable
      // without conflating its colour-management path with that authoritative
      // target proof.
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      const screenshot = await page.locator("#glyph-webgpu-parity-canvas").screenshot({ scale: "css" });
      const screenshotResult = await page.evaluate(async ({ png, presentation }) => {
        const image = new Image(); image.src = `data:image/png;base64,${png}`; await image.decode();
        const surface = document.createElement("canvas"); surface.width = image.width; surface.height = image.height;
        const context = surface.getContext("2d"); if (!context) throw new Error("WEBGPU_SCREENSHOT_2D_CONTEXT_UNAVAILABLE"); context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, image.width, image.height).data;
        if (image.width !== presentation.width || image.height !== presentation.height) throw new Error(`WEBGPU_SCREENSHOT_SIZE_MISMATCH:${image.width}x${image.height}`);
        let exactMismatches = 0, mismatches = 0, maxError = 0;
        const firstMismatches: Array<{ cell: number, channel: number, actual: number, expected: number, error: number }> = [];
        for (let cell = 0; cell < presentation.width * presentation.height; cell += 1) for (let channel = 0; channel < 3; channel += 1) {
          const actual = pixels[cell * 4 + channel]!;
          const expected = Math.round(Number(presentation.warpRgb[channel * presentation.width * presentation.height + cell]) * 255);
          const error = Math.abs(actual - expected);
          maxError = Math.max(maxError, error);
          if (error !== 0) exactMismatches += 1;
          if (error > 1) {
            mismatches += 1;
            if (firstMismatches.length < 8) firstMismatches.push({ cell, channel, actual, expected, error });
          }
        }
        const session = (window as any).__glyphWebGpuParity.session; session.destroy();
        let readbackRejected = false, checkpointRejected = false, presentationRejected = false;
        try { await session.readback(); } catch { readbackRejected = true; }
        try { await session.checkpoint(); } catch { checkpointRejected = true; }
        try { await session.readPresentation(); } catch { presentationRejected = true; }
        return { exactMismatches, mismatches, maxError, firstMismatches, readbackRejected, checkpointRejected, presentationRejected };
      }, { png: screenshot.toString("base64"), presentation: result.presentation });

      expect(result.validationErrors).toEqual([]);
      expect(result.uncapturedErrors).toEqual([]);
      expect(result.losses).toEqual([]);
      expect(screenshotResult.readbackRejected).toBe(true);
      expect(screenshotResult.checkpointRejected).toBe(true);
      expect(screenshotResult.presentationRejected).toBe(true);
      const expectedHashes = frozen.events.map((event: { resultSha256: string }) => event.resultSha256);
      expect(result.hashes).toEqual(expectedHashes);
      const resultChainSha256 = sha(canonical(result.hashes));
      expect(resultChainSha256).toBe(expectedResultChainSha256);

      const report = {
        schemaVersion: "glyph-webgpu-parity-diagnostic/v2",
        diagnosticOnly: true,
        acceptance: false,
        browser: { version: browserVersion },
        webgpu: { adapter: initialized.adapterInfo, isFallbackAdapter: initialized.isFallbackAdapter, features: initialized.features, limits: initialized.limits, shaderDiagnostics: initialized.shaderDiagnostics, cdp: { devices, auxAttributes: gpuInfo.gpu.auxAttributes, featureStatus: gpuInfo.gpu.featureStatus } },
        frozenTrace: { transitions: transitions.length, atlasSize: 64, inputSha256: frozen.expected.inputSha256, frameSha256: frozen.expected.frameSha256, eventSha256: frozen.expected.eventSha256, expectedResultChainSha256, resultChainSha256, matchedEveryTransition: true },
        checkpoints: { count: result.checkpoints.length, chainSha256: sha(canonical(result.checkpoints)) },
        webgpuErrors: { validation: result.validationErrors, uncaptured: result.uncapturedErrors, deviceLoss: result.losses },
        cleanup: { readbackRejectedAfterDestroy: screenshotResult.readbackRejected, checkpointRejectedAfterDestroy: screenshotResult.checkpointRejected, presentationRejectedAfterDestroy: screenshotResult.presentationRejected },
        canvas: { screenshotMismatchesAboveTolerance: screenshotResult.mismatches, screenshotExactMismatches: screenshotResult.exactMismatches, screenshotTolerance: 1, screenshotMaxError: screenshotResult.maxError, screenshotFirstMismatches: screenshotResult.firstMismatches },
      };
      const text = `${canonical(report)}\n`;
      await writeFile(output!, text);
      await writeFile(`${output!}.sha256`, `${sha(text)}  ${output!}\n`);
      expect(screenshotResult.mismatches).toBe(0);
    } finally {
      await disposeReferenceTrace(frozen);
    }
  } finally {
    await cdp.detach();
  }
});
