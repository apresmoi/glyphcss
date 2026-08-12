import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildFixtureAdmissions } from "../generate-targets.mjs";
import {
  admitTrajectoryTarget,
  contentSha256,
  createMockTargetProvider,
  createTargetUploadManifest,
  persistTargetCandidates,
  validateTargetRecord,
} from "../targets/provider-core.mjs";
import { validateControlUploadManifest } from "../targets/control-png.mjs";
import { canonical, sha256 } from "./admission.mjs";

const hash = (character) => character.repeat(64);
const requestHash = (request) => {
  const raw = structuredClone(request);
  delete raw.requestSha256;
  return contentSha256(raw);
};
const result = (id, kind, failed, setupAssertions, evidence) => ({
  id,
  kind,
  expectedPass: kind === "good",
  expectedFailMetric: kind === "good" ? null : "provenance-corruption",
  setup: setupAssertions.every((assertion) => assertion.pass),
  setupAssertions,
  failed,
  metrics: {
    "provenance-corruption": {
      value: failed.includes("provenance-corruption") ? 1 : 0,
      threshold: 0,
      pass: !failed.includes("provenance-corruption"),
    },
  },
  trace: {
    provenance: evidence,
    frames: [
      { id: `${id}/source`, controls: evidence.source ?? evidence, lineage: evidence.lineage ?? evidence },
      { id: `${id}/candidate`, controls: evidence.candidate ?? evidence, lineage: evidence.lineage ?? evidence },
    ],
  },
});
async function rejects(run) {
  try {
    await run();
    return false;
  } catch {
    return true;
  }
}

export async function evaluateB9Provenance() {
  const root = await mkdtemp(join(tmpdir(), "glyph-b10-provenance-"));
  try {
    const fixture = await buildFixtureAdmissions(root);
    const targetRoot = join(root, "targets");
    const publication = await persistTargetCandidates({
      provider: createMockTargetProvider(),
      request: fixture.keyframe,
      outputRoot: targetRoot,
      costCeilingUsd: 1,
      costPerCandidateUsd: 0,
    });
    const targetRef = publication.targets[0];
    const targetPath = join(targetRoot, targetRef.metadataPath);
    const target = JSON.parse(await readFile(targetPath, "utf8"));
    const image = await readFile(join(targetRoot, target.imagePath));
    const validUpload = await validateControlUploadManifest(fixture.keyframeUploads.path, fixture.uploadRoot);
    await validateTargetRecord(target);
    const validAssertions = [
      { id: "control-upload-v1-valid", pass: validUpload.contentSha256 === contentSha256(validUpload) },
      { id: "target-v2-valid", pass: target.schemaVersion === "glyph-image-target/v2" },
      { id: "target-image-bytes-bound", pass: sha256(image) === target.imageSha256 },
      { id: "target-request-bound", pass: canonical(target.request) === canonical(fixture.keyframe) },
    ];
    const cases = [result("valid-b9-target-control-upload", "good", [], validAssertions, {
      target: { id: target.targetId, contentSha256: target.contentSha256, imageSha256: target.imageSha256 },
      controlUpload: { contentSha256: validUpload.contentSha256, controls: validUpload.controls.map(({ role, sourceSha256, pngSha256 }) => ({ role, sourceSha256, pngSha256 })) },
    })];

    const pngControl = validUpload.controls[0];
    const pngPath = join(fixture.uploadRoot, pngControl.pngPath);
    const pngBytes = await readFile(pngPath);
    const mutatedPng = Buffer.concat([pngBytes, Buffer.from([0])]);
    await writeFile(pngPath, mutatedPng);
    const pngRejected = await rejects(() => validateControlUploadManifest(fixture.keyframeUploads.path, fixture.uploadRoot));
    await writeFile(pngPath, pngBytes);
    cases.push(result("corrupted-control-png-bytes", "adversarial", pngRejected ? ["provenance-corruption"] : [], [
      { id: "png-bytes-changed", pass: sha256(mutatedPng) !== pngControl.pngSha256 },
      { id: "hash-validator-rejected-mutated-bytes", pass: pngRejected },
    ], { role: pngControl.role, expectedPngSha256: pngControl.pngSha256, mutation: "appended-byte-before-validation" }));

    const rebound = structuredClone(validUpload);
    rebound.controls[0].sourceSha256 = hash("f");
    rebound.contentSha256 = contentSha256(rebound);
    const reboundPath = join(root, "rebound-control-upload.json");
    await writeFile(reboundPath, `${JSON.stringify(rebound)}\n`);
    const reboundRejected = await rejects(() => admitTrajectoryTarget({
      corpusManifestPath: join(fixture.corpusRoot, "manifest.json"),
      trajectoryId: fixture.keyframe.trajectory.trajectoryId,
      nextFrameId: "f000",
      style: fixture.style,
      controlUploadManifestPath: reboundPath,
      controlUploadRoot: fixture.uploadRoot,
    }));
    cases.push(result("rehashed-control-source-rebind", "adversarial", reboundRejected ? ["provenance-corruption"] : [], [
      { id: "manifest-content-hash-recomputed", pass: rebound.contentSha256 === contentSha256(rebound) },
      { id: "source-binding-differs", pass: rebound.controls[0].sourceSha256 !== validUpload.controls[0].sourceSha256 },
      { id: "admission-rejected-rebound-source", pass: reboundRejected },
    ], { originalSourceSha256: validUpload.controls[0].sourceSha256, reboundSourceSha256: rebound.controls[0].sourceSha256, manifestSha256: rebound.contentSha256 }));

    const reboundTarget = structuredClone(target);
    reboundTarget.request.controls[0].sourceSha256 = hash("e");
    reboundTarget.lineage.controls[0].sourceSha256 = hash("e");
    reboundTarget.request.requestSha256 = requestHash(reboundTarget.request);
    reboundTarget.requestSha256 = reboundTarget.request.requestSha256;
    reboundTarget.contentSha256 = contentSha256(reboundTarget);
    const targetInternallyValid = !(await rejects(() => validateTargetRecord(reboundTarget)));
    const targetBound = canonical(reboundTarget.request) === canonical(fixture.keyframe)
      && reboundTarget.imageSha256 === sha256(image);
    cases.push(result("rehashed-target-lineage-rebind", "adversarial", !targetBound ? ["provenance-corruption"] : [], [
      { id: "target-all-internal-hashes-recomputed", pass: reboundTarget.contentSha256 === contentSha256(reboundTarget) && reboundTarget.requestSha256 === requestHash(reboundTarget.request) },
      { id: "target-schema-remains-valid", pass: targetInternallyValid },
      { id: "admitted-request-binding-rejected", pass: !targetBound },
    ], { admittedRequestSha256: fixture.keyframe.requestSha256, reboundRequestSha256: reboundTarget.requestSha256, targetContentSha256: reboundTarget.contentSha256 }));

    const uploadPath = join(root, "target-upload.json");
    const upload = await createTargetUploadManifest({
      targetMetadataPath: targetPath,
      artifactRoot: targetRoot,
      outputPath: uploadPath,
      providerReference: { fileId: "file-b10-target" },
    });
    const reboundUpload = structuredClone(upload);
    reboundUpload.targetContentSha256 = hash("c");
    reboundUpload.contentSha256 = contentSha256(reboundUpload);
    const uploadBound = reboundUpload.targetId === target.targetId
      && reboundUpload.targetContentSha256 === target.contentSha256
      && reboundUpload.imageSha256 === target.imageSha256;
    cases.push(result("rehashed-target-upload-rebind", "adversarial", !uploadBound ? ["provenance-corruption"] : [], [
      { id: "upload-content-hash-recomputed", pass: reboundUpload.contentSha256 === contentSha256(reboundUpload) },
      { id: "target-upload-binding-rejected", pass: !uploadBound },
    ], { targetContentSha256: target.contentSha256, reboundTargetContentSha256: reboundUpload.targetContentSha256, uploadContentSha256: reboundUpload.contentSha256 }));

    const mutatedImage = Buffer.concat([image, Buffer.from("mutated")]);
    cases.push(result("corrupted-target-image-bytes", "adversarial", sha256(mutatedImage) !== target.imageSha256 ? ["provenance-corruption"] : [], [
      { id: "image-bytes-changed", pass: !mutatedImage.equals(image) },
      { id: "target-image-hash-rejected", pass: sha256(mutatedImage) !== target.imageSha256 },
    ], { expectedImageSha256: target.imageSha256, mutatedImageSha256: sha256(mutatedImage) }));
    return cases;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
