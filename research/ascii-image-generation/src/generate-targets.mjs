import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { generateCorpusAt } from "./generate-controls.mjs";
import { admitTrajectoryTarget, CONTROL_ROLES, createMockTargetProvider, createTargetUploadManifest, generateTargetPlan, persistTargetCandidates } from "./targets/provider-core.mjs";
import { encodeControlUploadManifest } from "./targets/control-png.mjs";

const here = resolve(dirname(new URL(import.meta.url).pathname), "..");
const providerReferences = (frameId) => CONTROL_ROLES.map((role) => ({ role, fileId: `file-${role.replaceAll("-", "_")}-${frameId}` }));

export async function buildFixtureAdmissions(root) {
  const corpusRoot = join(root, "controls");
  const corpus = await generateCorpusAt("config/corpus.json", corpusRoot);
  const record = corpus.trajectories[0];
  const trajectoryId = record.trajectory.controlTrajectory.id;
  const style = { id: "style/fixture", prompt: "minimal ink illustration", license: "CC0-1.0", sourceSha256: "a".repeat(64) };
  const uploadRoot = join(root, "uploads");
  const [keyframeUploads, editUploads] = await Promise.all([
    encodeControlUploadManifest({ corpusRoot, record, frameId: "f000", outputRoot: uploadRoot, providerReferences: providerReferences("f000") }),
    encodeControlUploadManifest({ corpusRoot, record, frameId: "f001", outputRoot: uploadRoot, providerReferences: providerReferences("f001") }),
  ]);
  const keyframe = await admitTrajectoryTarget({
    corpusManifestPath: join(corpusRoot, "manifest.json"), trajectoryId, nextFrameId: "f000", style,
    controlUploadManifestPath: keyframeUploads.path, controlUploadRoot: uploadRoot, candidates: 2,
  });
  return {
    corpusRoot, corpus, record, style, uploadRoot, keyframeUploads, editUploads, keyframe,
    editFromTarget: async ({ artifactRoot, target }) => {
      const priorUploadPath = join(uploadRoot, "prior-f000.json");
      await createTargetUploadManifest({ targetMetadataPath: join(artifactRoot, target.metadataPath), artifactRoot, outputPath: priorUploadPath, providerReference: { fileId: "file-accepted-prior" } });
      return admitTrajectoryTarget({
        corpusManifestPath: join(corpusRoot, "manifest.json"), trajectoryId, nextFrameId: "f001", style,
        controlUploadManifestPath: editUploads.path, controlUploadRoot: uploadRoot,
        priorTargetUploadManifestPath: priorUploadPath, priorArtifactRoot: artifactRoot, candidates: 2,
      });
    },
  };
}

export async function runTargetFixture({ check = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), "glyphcss-targets-"));
  try {
    const fixture = await buildFixtureAdmissions(root);
    const provider = createMockTargetProvider();
    const outputRoot = join(root, "targets");
    const keyframeResult = await persistTargetCandidates({ provider, request: fixture.keyframe, outputRoot, costCeilingUsd: 1, costPerCandidateUsd: .01 });
    const first = keyframeResult.targets[0];
    const edit = await fixture.editFromTarget({ artifactRoot: outputRoot, target: first });
    const dry = await generateTargetPlan({ provider, requests: [fixture.keyframe, edit], outputRoot, costCeilingUsd: 1, inputCostPerRequestUsd: .005, costPerCandidateUsd: .01, maxConcurrent: 2, dryRun: true });
    const editResult = await persistTargetCandidates({ provider, request: edit, outputRoot, costCeilingUsd: 1, costPerCandidateUsd: .01 });
    const resumed = await persistTargetCandidates({ provider, request: edit, outputRoot, costCeilingUsd: 1, costPerCandidateUsd: .01 });
    if (dry.apiCalls !== 2 || dry.candidateCount !== 4 || dry.estimatedCostUsd !== .05 || keyframeResult.targets.length !== 2 || editResult.targets.length !== 2 || !resumed.resumed) throw new Error("B9 fixture proof failed");
    if (check) console.log(JSON.stringify({ provider: provider.id, keyframeRequestSha256: fixture.keyframe.requestSha256, editRequestSha256: edit.requestSha256, apiCalls: dry.apiCalls, candidateCount: dry.candidateCount, estimatedCostUsd: dry.estimatedCostUsd, resumed: resumed.resumed }));
    return { fixture, dry, keyframeResult, editResult, resumed };
  } finally { await rm(root, { recursive: true, force: true }); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = new Set(process.argv.slice(2));
  if (!args.has("--fixture") || !args.has("--provider") || !args.has("mock")) throw new Error("only --fixture --provider mock is enabled before B11 approves paid generation");
  await runTargetFixture({ check: args.has("--check") });
}
