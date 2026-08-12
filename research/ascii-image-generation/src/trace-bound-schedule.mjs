import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import traceContract from "../fixtures/reprojection/reference-trace-v1.json" with { type: "json" };
import { cameraFor, seeded } from "./generate-controls.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).filter((key) => key !== "contentSha256").sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const root = resolve(import.meta.dirname, "..");

export function traceBoundMotion(config) {
  const authority = config?.trajectory?.traceAuthority;
  if (!authority || authority.id !== "b39-slow-trace-32-subdivision-v1" || authority.segmentId !== "slow"
    || authority.traceModule !== "src/generate-controls.mjs") throw new Error("ASSET_CORPUS_TRACE_AUTHORITY_INVALID");
  const segment = traceContract.segments?.find((candidate) => candidate.id === authority.segmentId);
  if (!segment || segment.kind !== "slow" || segment.subdivisionsPerLeg !== 32) throw new Error("ASSET_CORPUS_TRACE_SEGMENT_DRIFT");
  const random = seeded(`${segment.sceneSeed}/${segment.kind}`);
  const endpoints = [0, 1, 2].map((index) => cameraFor(segment.kind, index, random));
  const motions = [];
  for (let leg = 0; leg < endpoints.length - 1; leg += 1) {
    const motion = (Math.abs(endpoints[leg + 1].rotX - endpoints[leg].rotX) + Math.abs(endpoints[leg + 1].rotY - endpoints[leg].rotY) + Math.abs(endpoints[leg + 1].zoom - endpoints[leg].zoom)) / segment.subdivisionsPerLeg;
    for (let step = 0; step < segment.subdivisionsPerLeg; step += 1) motions.push(motion);
  }
  const derived = { min: Math.min(...motions), max: Math.max(...motions), mean: motions.reduce((sum, value) => sum + value, 0) / motions.length };
  if (motions.length !== 64 || canonical(derived) !== canonical({ min: .1875, max: .21875, mean: .203125 })) throw new Error("ASSET_CORPUS_TRACE_MOTION_DRIFT");
  return { authority, segment, motions, ...derived };
}

export async function verifyTraceAuthority(config) {
  const trace = traceBoundMotion(config), path = resolve(root, config.trajectory.traceAuthority.path);
  const bytes = await readFile(path);
  if (sha(bytes) !== trace.authority.contentSha256) throw new Error("ASSET_CORPUS_TRACE_AUTHORITY_HASH_DRIFT");
  const contract = JSON.parse(bytes.toString("utf8"));
  if (canonical(contract) !== canonical(traceContract)) throw new Error("ASSET_CORPUS_TRACE_SEGMENT_DRIFT");
  return trace;
}

export function tracePhase(config, assetId) {
  return Number.parseInt(sha(`${config.trajectory.seed}\0${assetId}`).slice(0, 8), 16) % 360;
}

export function traceFrameBindings(config, variant) {
  const { anchors, steps, lighting } = config.trajectory;
  const trace = traceBoundMotion(config);
  if (!Array.isArray(anchors) || anchors.length < 2 || !Array.isArray(steps) || steps.length !== 2
    || steps[0]?.id !== "keyframe" || steps[0]?.role !== "keyframe" || steps[0]?.traceOffset !== 0
    || steps[1]?.id !== "adjacent" || steps[1]?.role !== "adjacent" || steps[1]?.traceOffset !== 1
    || !Array.isArray(lighting) || lighting.length !== 2) throw new Error("ASSET_CORPUS_TRACE_SCHEDULE_INVALID");
  const bindings = [];
  for (const anchor of anchors) for (const light of lighting) {
    const pairId = `pair-${anchor.id}--${light.id}`;
    for (const step of steps) bindings.push({
      id: `frame-${String(bindings.length).padStart(3, "0")}`,
      anchorId: anchor.id, trackId: `track-${anchor.id}--${light.id}`, pairId,
      role: step.role, stepId: step.id, step: step.traceOffset,
      cameraId: anchor.id, lightingId: light.id, poseId: variant.pose.id, occlusionId: variant.occlusion.id,
      traceMotionDegrees: step.traceOffset ? trace.max : 0,
    });
  }
  if (new Set(bindings.map((binding) => binding.id)).size !== bindings.length
    || new Set(bindings.map((binding) => binding.pairId)).size !== anchors.length * lighting.length
    || bindings.some((binding) => binding.traceMotionDegrees > trace.max)) throw new Error("ASSET_CORPUS_TRACE_BINDING_INVALID");
  return bindings;
}

export function assertExactPairMembership(bindings) {
  const pairs = new Map();
  for (const binding of bindings) {
    const group = pairs.get(binding.pairId) ?? []; group.push(binding); pairs.set(binding.pairId, group);
  }
  if (pairs.size * 2 !== bindings.length) throw new Error("ASSET_CORPUS_PAIR_MEMBERSHIP_INVALID");
  for (const pair of pairs.values()) {
    if (pair.length !== 2 || pair[0].anchorId !== pair[1].anchorId || pair[0].lightingId !== pair[1].lightingId
      || pair[0].trackId !== pair[1].trackId || pair[0].role !== "keyframe" || pair[1].role !== "adjacent"
      || pair[0].step !== 0 || pair[1].step !== 1 || pair[1].traceMotionDegrees <= 0) throw new Error("ASSET_CORPUS_PAIR_MEMBERSHIP_INVALID");
  }
  return [...pairs.values()];
}
