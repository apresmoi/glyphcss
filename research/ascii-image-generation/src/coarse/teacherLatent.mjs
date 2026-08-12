import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  contentSha256,
  createDeterministicFallbackBase,
  sha256,
  stableJson
} from "./retrieval.mjs";

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 0x1_0000_0000;
  };
}

function latentBytes(seed, count, anchor = null) {
  const random = mulberry32(seed);
  const values = new Float32Array(count);
  for (let index = 0; index < values.length; index++) {
    const base = anchor ? anchor[index] * 0.82 : 0;
    values[index] = base + (random() * 2 - 1) * (anchor ? 0.18 : 1);
  }
  return { values, bytes: Buffer.from(values.buffer) };
}

export function createCoarseTeacherBranches(rawRequest, branchCount, teacher, library) {
  if (!Number.isInteger(branchCount) || branchCount < 1 || branchCount > teacher.branching.maximumCount) {
    throw new RangeError(`branchCount must be in [1,${teacher.branching.maximumCount}].`);
  }
  const request = structuredClone(rawRequest);
  const requestSha256 = sha256(stableJson(request));
  const shape = teacher.fallbackBackend.latent.shape;
  const count = shape.reduce((product, value) => product * value, 1);
  const anchor = latentBytes(request.seed ^ Number.parseInt(requestSha256.slice(0, 8), 16), count);
  const anchorSha256 = sha256(anchor.bytes);
  const branches = [];
  const previewFiles = [];
  const latentFiles = [{ name: `latents/${anchorSha256}.f32`, bytes: anchor.bytes }];

  for (let index = 0; index < branchCount; index++) {
    const seed = (request.seed + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
    const branchLatent = latentBytes(seed, count, anchor.values);
    const latentSha256 = sha256(branchLatent.bytes);
    const branchRequest = { ...request, seed };
    const decoded = createDeterministicFallbackBase(branchRequest, library);
    const previewSha256 = decoded.response.selection.base.image.sha256;
    latentFiles.push({ name: `latents/${latentSha256}.f32`, bytes: branchLatent.bytes });
    previewFiles.push({ name: `previews/${previewSha256}.svg`, bytes: decoded.bytes, sha256: previewSha256 });
    branches.push({
      id: `branch-${String(index).padStart(2, "0")}`,
      seed,
      latent: {
        path: `latents/${latentSha256}.f32`,
        sha256: latentSha256,
        dtype: teacher.fallbackBackend.latent.dtype,
        shape
      },
      decodedPreview: {
        path: `previews/${previewSha256}.svg`,
        sha256: previewSha256,
        mimeType: "image/svg+xml",
        width: decoded.response.selection.base.image.width,
        height: decoded.response.selection.base.image.height
      },
      trajectory: {
        sourceAnchorSha256: anchorSha256,
        continuationSeed: seed,
        remainingTimesteps: teacher.fallbackBackend.scheduler.remainingTimesteps,
        promptSha256: sha256(request.prompt),
        controlSceneSha256: request.controls.sceneSha256
      },
      base: decoded.response.selection.base
    });
  }

  const manifestBase = {
    schemaVersion: "glyph-teacher-latent/v1",
    id: `teacher-run/${requestSha256}`,
    contentSha256: "",
    backend: {
      kind: teacher.fallbackBackend.kind,
      claim: teacher.fallbackBackend.claim
    },
    authority: {
      model: teacher.fallbackBackend.model,
      vae: teacher.fallbackBackend.vae,
      scheduler: teacher.fallbackBackend.scheduler,
      timestep: {
        index: teacher.fallbackBackend.scheduler.resumeTimestepIndex,
        value: teacher.fallbackBackend.scheduler.resumeTimestep,
        totalSteps: teacher.fallbackBackend.scheduler.steps
      },
      scaling: {
        latentScalingFactor: teacher.fallbackBackend.latent.scalingFactor,
        dtype: teacher.fallbackBackend.latent.dtype,
        shape
      },
      prompt: {
        text: request.prompt,
        sha256: sha256(request.prompt),
        styleId: request.styleId
      },
      control: {
        requestSha256,
        sceneId: request.controls.sceneId,
        sceneSha256: request.controls.sceneSha256,
        tensorContractSha256: request.controls.tensorContractSha256,
        geometry: request.controls.geometry,
        camera: request.controls.camera,
        coverageRatio: request.controls.coverageRatio
      },
      noise: {
        algorithm: teacher.fallbackBackend.noise.algorithm,
        anchorSeed: request.seed,
        branchSeeds: branches.map((branch) => branch.seed)
      }
    },
    anchor: {
      latent: {
        path: `latents/${anchorSha256}.f32`,
        sha256: anchorSha256,
        dtype: teacher.fallbackBackend.latent.dtype,
        shape
      },
      resume: {
        schedulerId: teacher.fallbackBackend.scheduler.id,
        timestepIndex: teacher.fallbackBackend.scheduler.resumeTimestepIndex,
        timestep: teacher.fallbackBackend.scheduler.resumeTimestep,
        remainingTimesteps: teacher.fallbackBackend.scheduler.remainingTimesteps
      }
    },
    branches: branches.map(({ base: _base, ...branch }) => branch)
  };
  const manifest = { ...manifestBase, contentSha256: contentSha256(manifestBase) };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const runSha256 = sha256(manifestBytes);
  const selectedBranch = branches[request.seed % branches.length];
  const response = {
    schemaVersion: "glyph-coarse-keyframe-response/v1",
    status: "generated-fallback",
    requestSha256,
    library: { id: library.id, contentSha256: library.contentSha256 },
    confidence: 1,
    selection: {
      base: selectedBranch.base,
      confidence: 1,
      promptAffinity: 1,
      camera: { rotXDelta: 0, rotYDelta: 0, zoomRelativeDelta: 0 }
    },
    fallback: { required: false, reason: null },
    teacher: {
      backend: manifest.backend,
      runId: manifest.id,
      runSha256,
      manifestContentSha256: manifest.contentSha256,
      anchorLatentSha256: anchorSha256,
      selectedBranchId: selectedBranch.id,
      branches: manifest.branches.map((branch) => ({
        id: branch.id,
        seed: branch.seed,
        latentSha256: branch.latent.sha256,
        decodedPreviewSha256: branch.decodedPreview.sha256
      }))
    }
  };
  return {
    manifest,
    manifestBytes,
    runSha256,
    latentFiles,
    previewFiles,
    response
  };
}

export async function persistCoarseTeacherBranches(bundle, artifactRoot) {
  const runDirectory = join(artifactRoot, bundle.runSha256);
  await mkdir(join(runDirectory, "latents"), { recursive: true });
  await mkdir(join(runDirectory, "previews"), { recursive: true });
  for (const file of [...bundle.latentFiles, ...bundle.previewFiles]) {
    await writeFile(join(runDirectory, file.name), file.bytes, { flag: "wx" }).catch((error) => {
      if (error?.code !== "EEXIST") throw error;
    });
  }
  await writeFile(join(runDirectory, "manifest.json"), bundle.manifestBytes, { flag: "wx" }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  return runDirectory;
}
