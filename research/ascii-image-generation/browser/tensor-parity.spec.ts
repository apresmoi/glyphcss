import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { expect, test } from "playwright/test";
import { packGlyphControlTensor } from "glyphcss";
import { createTensorGoldenFrame, createTensorGoldenTemporal, tensorGoldenNormalization } from "./tensorGolden";

const source = (path: string) => `/@fs${path}`;
const repoRoot = resolve(import.meta.dirname, "../../..");
const glyphcssSource = source(resolve(repoRoot, "packages/glyphcss/src/index.ts"));
const goldenSource = source(resolve(import.meta.dirname, "tensorGolden.ts"));
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const contractSha256 = "a1e8600ad64f63b119e2113711b235a3007b28416ae03c38c2440eb6ed1c7a3f";

test("tensor-parity", async ({ page }) => {
  const node = packGlyphControlTensor(createTensorGoldenFrame(), tensorGoldenNormalization, createTensorGoldenTemporal());
  const expectedKeyframe = new Uint8Array(node.keyframe.buffer, node.keyframe.byteOffset, node.keyframe.byteLength);
  const expectedTemporal = new Uint8Array(node.temporal!.buffer, node.temporal!.byteOffset, node.temporal!.byteLength);
  await page.goto((process.env.GLYPHCSS_GALLERY_URL ?? "http://127.0.0.1:43219").replace(/\/$/, "/"));
  const chromium = await page.evaluate(async ({ glyphcssSource, goldenSource }) => {
    const glyphcss = await import(glyphcssSource);
    const golden = await import(goldenSource);
    const packed = glyphcss.packGlyphControlTensor(golden.createTensorGoldenFrame(), golden.tensorGoldenNormalization, golden.createTensorGoldenTemporal());
    const digest = async (values: Float32Array) => {
      const bytes = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
      const raw = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(raw).set(bytes);
      return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", raw)));
    };
    return {
      keyframe: Array.from(new Uint8Array(packed.keyframe.buffer, packed.keyframe.byteOffset, packed.keyframe.byteLength)),
      temporal: Array.from(new Uint8Array(packed.temporal.buffer, packed.temporal.byteOffset, packed.temporal.byteLength)),
      keyframeSha256: Array.from(await digest(packed.keyframe)).map((value) => value.toString(16).padStart(2, "0")).join(""),
      temporalSha256: Array.from(await digest(packed.temporal!)).map((value) => value.toString(16).padStart(2, "0")).join(""),
      contractSha256: packed.spec.contract.contentSha256,
      specSha256: packed.spec.contentSha256,
      frozen: Object.isFrozen(packed.spec) && Object.isFrozen(packed.spec.contract) && Object.isFrozen(packed.spec.instance),
    };
  }, { glyphcssSource, goldenSource });
  expect(Uint8Array.from(chromium.keyframe)).toEqual(expectedKeyframe);
  expect(Uint8Array.from(chromium.temporal)).toEqual(expectedTemporal);
  expect(chromium.keyframeSha256).toBe(sha256(expectedKeyframe));
  expect(chromium.temporalSha256).toBe(sha256(expectedTemporal));
  expect(node.spec.contract.contentSha256).toBe(contractSha256);
  expect(chromium.contractSha256).toBe(node.spec.contract.contentSha256);
  expect(chromium.specSha256).toBe(node.spec.contentSha256);
  expect(chromium.frozen).toBe(true);
});
