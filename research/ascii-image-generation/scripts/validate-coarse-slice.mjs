#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { contentSha256, retrieveBase, sha256, stableJson } from "../src/coarse/retrieval.mjs";
import {
  createNativeTeacherKeyframe,
  loadNativeTeacherCapture,
  nativeTeacherCompatibility,
} from "../src/coarse/nativeTeacher.mjs";

const researchRoot = resolve(new URL("..", import.meta.url).pathname);
async function json(path) {
  return JSON.parse(await readFile(resolve(researchRoot, path), "utf8"));
}
async function fileSha(path) {
  return sha256(await readFile(resolve(researchRoot, path)));
}
const [library, librarySchema, refiner, refinerSchema, teacher, request, native] = await Promise.all([
  json("config/coarse-base-library.json"),
  json("schema/coarse-base-library.schema.json"),
  json("browser/coarse-refiner-v1.json"),
  json("schema/coarse-refiner.schema.json"),
  json("config/coarse-teacher.json"),
  json("fixtures/coarse/native-teacher-control/request.json"),
  loadNativeTeacherCapture(researchRoot),
]);
const ajv = new Ajv2020({ allErrors: true, strict: false });
function validate(schema, value, label) {
  const validator = ajv.compile(schema);
  if (!validator(value)) throw new Error(`${label}: ${ajv.errorsText(validator.errors)}`);
}
validate(librarySchema, library, "coarse base library");
validate(refinerSchema, refiner, "coarse refiner");
if (contentSha256(library) !== library.contentSha256) throw new Error("Library content hash mismatch.");
if (contentSha256(refiner) !== refiner.contentSha256) throw new Error("Refiner content hash mismatch.");
if (contentSha256(teacher) !== teacher.contentSha256) throw new Error("Teacher contract content hash mismatch.");
for (const base of library.bases) {
  if (await fileSha(base.image.path) !== base.image.sha256) throw new Error(`Base image hash mismatch: ${base.id}`);
}
const blue = retrieveBase(library, {
  ...request,
  prompt: "weathered blue industrial box in a quiet studio",
  styleId: "style A",
  controls: { ...request.controls, camera: { ...request.controls.camera, rotY: 38 } },
});
const wood = retrieveBase(library, {
  ...request,
  prompt: "warm wooden rustic crate",
  styleId: "style B",
  controls: { ...request.controls, camera: { ...request.controls.camera, rotY: 38 } },
});
const divergent = retrieveBase(library, request);
if (blue.selection?.base.id !== "base/cube-blue-box-v1") throw new Error("Prompt/style intervention did not select blue box.");
if (wood.selection?.base.id !== "base/cube-wood-crate-v1") throw new Error("Prompt/style intervention did not select wood crate.");
if (divergent.status !== "fallback-required" || divergent.fallback.reason !== "camera-divergence") throw new Error("Camera divergence did not request a fallback.");
const nativeBundle = createNativeTeacherKeyframe(request, native, library);
const incompatible = nativeTeacherCompatibility({
  ...request,
  controls: { ...request.controls, camera: { ...request.controls.camera, rotY: 71 } },
}, native.capture);
if (incompatible.compatible) throw new Error("Uncaptured native request was accepted.");
if (refiner.training.nativeManifestContentSha256 !== native.capture.contentSha256) throw new Error("Student native manifest binding drift.");
if (refiner.training.nativeManifestFileSha256 !== native.fileSha256) throw new Error("Student native file binding drift.");
if (stableJson(refiner.training.decodedPreviewSha256) !== stableJson(native.capture.branches.map((branch) => branch.decodedPreview.sha256))) {
  throw new Error("Student native branch binding drift.");
}
const parameterCount = refiner.weights.reduce((sum, row) => sum + row.length, 0) + refiner.bias.length;
if (parameterCount !== refiner.architecture.parameterCount) throw new Error("Refiner parameter count drift.");

const reportBase = {
  schemaVersion: "glyph-coarse-slice-report/v2",
  id: "glyphcss/coarse-slice-b57-native-v2",
  contentSha256: "",
  status: "coarse-end-to-end-review-ready",
  scope: "Local library retrieval, exact-capture native keyframes, browser student correction, and hash/contract integration. No native-reference quality or WebGPU performance claim.",
  artifacts: {
    library: { contentSha256: library.contentSha256, fileSha256: await fileSha("config/coarse-base-library.json"), bases: library.bases.length },
    teacherContract: { contentSha256: teacher.contentSha256, fileSha256: await fileSha("config/coarse-teacher.json"), backend: teacher.backend.kind },
    nativeCapture: {
      id: native.capture.id,
      contentSha256: native.capture.contentSha256,
      fileSha256: native.fileSha256,
      branches: native.capture.branches.length,
      runtime: native.capture.runtime.gpu,
    },
    refiner: {
      contentSha256: refiner.contentSha256,
      fileSha256: await fileSha("browser/coarse-refiner-v1.json"),
      parameterCount,
      samples: refiner.training.sampleCount,
    },
  },
  checks: {
    schemas: true,
    contentHashes: true,
    imageHashes: true,
    retrievalPromptAndStyleIntervention: {
      first: blue.selection.base.id,
      second: wood.selection.base.id,
      changed: blue.selection.base.id !== wood.selection.base.id,
    },
    cameraFallback: { status: divergent.status, reason: divergent.fallback.reason },
    nativeKeyframe: {
      selectedBranchId: nativeBundle.response.teacher.selectedBranchId,
      backend: nativeBundle.response.teacher.backend.kind,
      uncapturedRequestRejected: true,
    },
    resumeParity: native.capture.resumeParity,
    studentNativeBinding: {
      sourceBackend: refiner.training.sourceBackend,
      nativeManifestContentSha256: refiner.training.nativeManifestContentSha256,
      nativeManifestFileSha256: refiner.training.nativeManifestFileSha256,
      sampleCount: refiner.training.sampleCount,
      meanSquaredError: refiner.training.meanSquaredError,
    },
  },
  claims: {
    nativeDiffusionTeacherExercised: true,
    nativeReferenceQualityPassed: false,
    trainedOnNativeDiffusionPreviews: true,
    exactResumePreviewParity: false,
    browserPerformanceGatePassed: false,
    note: "The pinned gpu-4090 continuation is the sole active teacher authority. Its public Diffusers fp16 resume path is hash-bound and measured, but decoded replay is not byte-exact (mean absolute RGB8 0.411678; maximum 56). Uncaptured requests fail with HTTP 409.",
  },
  validatorEntryPoints: {
    service: "pnpm --dir research/ascii-image-generation coarse:serve -- --artifact-root <writable-path>",
    integrity: "pnpm --dir research/ascii-image-generation validate:coarse",
    studentExport: "node research/ascii-image-generation/scripts/train-coarse-refiner.mjs --check",
    focusedTests: "pnpm --dir research/ascii-image-generation exec vitest run tests/coarse-refiner.test.ts tests/coarse-service.test.ts tests/website-generative.test.ts",
  },
  remainingRefinements: [
    "P2: export and benchmark the real native-trained student with the frozen WebGPU runtime",
    "P3: capture more prompt/style/geometry/camera neighborhoods before widening the native keyframe compatibility policy",
    "P4: compare a larger browser student only after these coarse contract bytes are independently accepted",
  ],
};
const report = { ...reportBase, contentSha256: contentSha256(reportBase) };
const expectedPath = resolve(researchRoot, "reports/coarse-slice.json");
if (process.argv.includes("--write")) await writeFile(expectedPath, `${JSON.stringify(report, null, 2)}\n`);
if (process.argv.includes("--check")) {
  const expected = JSON.parse(await readFile(expectedPath, "utf8"));
  if (stableJson(expected) !== stableJson(report)) throw new Error("Committed coarse-slice report drift.");
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
