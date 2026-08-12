import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sha256, stableJson } from "./retrieval.mjs";

function mismatch(label, expected, actual) {
  return expected === actual ? null : `${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`;
}

export function nativeTeacherCompatibility(request, capture) {
  // TODO(P3): broaden native capture/retrieval population beyond the three pinned keyframes.
  const control = capture.authority.control;
  // The website adds face-local UVs to the same cube vertices. Those UVs change
  // B5 scene identity but not the depth image consumed by this native capture
  // or any plane consumed by the coarse student.
  const equivalentSceneSha256 = new Set([
    control.scene.contentSha256,
    "38201f4a7604dd864d228e9ecd5ed208db3c2b864502e0d770412ba4d69a65f5",
  ]);
  const expected = {
    prompt: capture.authority.prompt.text,
    styleId: capture.authority.prompt.styleId,
    seed: capture.authority.noise.initialSeed,
    geometry: "cube",
    sceneId: control.scene.id,
    sceneSha256: control.scene.contentSha256,
    tensorContractSha256: control.tensor.contractSha256,
    camera: control.camera,
  };
  const checks = [
    mismatch("prompt", expected.prompt, request?.prompt),
    mismatch("styleId", expected.styleId, request?.styleId),
    mismatch("seed", expected.seed, request?.seed),
    mismatch("controls.geometry", expected.geometry, request?.controls?.geometry),
    mismatch("controls.sceneId", expected.sceneId, request?.controls?.sceneId),
    equivalentSceneSha256.has(request?.controls?.sceneSha256)
      ? null
      : mismatch("controls.sceneSha256", [...equivalentSceneSha256], request?.controls?.sceneSha256),
    mismatch("controls.tensorContractSha256", expected.tensorContractSha256, request?.controls?.tensorContractSha256),
    mismatch("controls.camera", stableJson(expected.camera), stableJson(request?.controls?.camera)),
  ].filter(Boolean);
  return {
    compatible: checks.length === 0,
    reason: checks.length === 0 ? null : "native-keyframe-unavailable",
    mismatches: checks,
    expected,
  };
}

export async function loadNativeTeacherCapture(researchRoot) {
  const manifestPath = resolve(researchRoot, "reports/coarse-native-teacher.json");
  const captureBytes = await readFile(manifestPath);
  const capture = JSON.parse(captureBytes.toString("utf8"));
  if (capture.schemaVersion !== "glyph-native-teacher-latent/v1") throw new Error("Native teacher schema mismatch.");
  const branchImages = new Map();
  for (const branch of capture.branches) {
    const path = resolve(researchRoot, "review/coarse-teacher-native", branch.decodedPreview.path);
    const bytes = await readFile(path);
    if (sha256(bytes) !== branch.decodedPreview.sha256) throw new Error(`Native branch image hash mismatch: ${branch.id}`);
    branchImages.set(branch.id, { bytes, path, ...branch.decodedPreview });
  }
  return {
    capture,
    captureBytes,
    manifestPath,
    fileSha256: sha256(captureBytes),
    branchImages,
  };
}

export function createNativeTeacherKeyframe(rawRequest, authority, library) {
  const compatibility = nativeTeacherCompatibility(rawRequest, authority.capture);
  if (!compatibility.compatible) {
    const error = new Error("The pinned native teacher has no captured keyframe for this exact request.");
    error.code = "NATIVE_KEYFRAME_UNAVAILABLE";
    error.details = compatibility;
    throw error;
  }
  const request = structuredClone(rawRequest);
  const requestSha256 = sha256(stableJson(request));
  const selected = authority.capture.branches[request.seed % authority.capture.branches.length];
  const preview = authority.branchImages.get(selected.id);
  if (!preview) throw new Error(`Native branch preview is missing: ${selected.id}`);
  const base = {
    id: `native/${authority.capture.id}/${selected.id}`,
    label: `Pinned native teacher ${selected.id}`,
    image: {
      mimeType: preview.mimeType,
      width: preview.width,
      height: preview.height,
      sha256: preview.sha256,
    },
    prompt: { text: request.prompt, tags: request.prompt.toLowerCase().match(/[a-z0-9]+/g) ?? [] },
    styleIds: [request.styleId],
    camera: request.controls.camera,
    controls: { geometry: request.controls.geometry, sceneId: request.controls.sceneId },
    provenance: {
      kind: "native-diffusion-intermediate",
      captureId: authority.capture.id,
      captureContentSha256: authority.capture.contentSha256,
      captureFileSha256: authority.fileSha256,
      branchId: selected.id,
      requestSha256,
      requiredRuntime: "gpu-4090",
    },
  };
  return {
    response: {
      schemaVersion: "glyph-coarse-keyframe-response/v1",
      status: "native-pinned-keyframe",
      requestSha256,
      library: { id: library.id, contentSha256: library.contentSha256 },
      confidence: 1,
      selection: {
        base,
        confidence: 1,
        promptAffinity: 1,
        camera: { rotXDelta: 0, rotYDelta: 0, zoomRelativeDelta: 0 },
      },
      teacher: {
        backend: {
          kind: "native-diffusion-intermediate",
          claim: "Actual pinned SDXL + depth-ControlNet continuation captured on gpu-4090.",
        },
        runId: authority.capture.id,
        runSha256: authority.fileSha256,
        manifestContentSha256: authority.capture.contentSha256,
        anchorLatentSha256: authority.capture.anchor.latent.sha256,
        selectedBranchId: selected.id,
        branches: authority.capture.branches.map((branch) => ({
          id: branch.id,
          seed: branch.seed,
          latentSha256: branch.startLatent.sha256,
          decodedPreviewSha256: branch.decodedPreview.sha256,
        })),
      },
    },
    selected,
    preview,
  };
}

export async function persistNativeTeacherKeyframe(bundle, authority, artifactRoot) {
  const runDirectory = join(artifactRoot, authority.capture.id.replaceAll("/", "--"));
  const previewDirectory = join(runDirectory, "previews");
  await mkdir(previewDirectory, { recursive: true });
  await writeFile(join(runDirectory, "manifest.json"), authority.captureBytes);
  for (const branch of authority.capture.branches) {
    const image = authority.branchImages.get(branch.id);
    await writeFile(join(previewDirectory, branch.decodedPreview.path), image.bytes);
  }
  const pointer = {
    schemaVersion: "glyph-native-keyframe-pointer/v1",
    requestSha256: bundle.response.requestSha256,
    selectedBranchId: bundle.selected.id,
    captureManifest: authority.manifestPath,
    captureContentSha256: authority.capture.contentSha256,
    captureFileSha256: authority.fileSha256,
  };
  await writeFile(join(runDirectory, "request-pointer.json"), `${JSON.stringify(pointer, null, 2)}\n`);
  return runDirectory;
}
