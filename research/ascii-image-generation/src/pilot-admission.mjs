import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { canonical, evaluateAdmissionFixture, sha256 as canonicalSha256 } from "./eval/admission.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const map = (bytes, Type) => Array.from(new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT));
const noNewlines = (value) => value.replaceAll("\n", "");

/**
 * The deterministic provider is an offline test oracle, not an image-understanding
 * substitute. It reconstructs the B7 control candidate and exercises B10's actual
 * evaluator; live providers must supply a real image evaluator instead.
 */
export async function evaluateMockTargetThroughB10({ target, corpusRoot, record, frameId }) {
  if (target.provider.id !== "mock-deterministic/v2") throw new Error("PILOT_LIVE_IMAGE_ADMISSION_EVALUATOR_REQUIRED");
  const frameRoot = join(corpusRoot, record.visibleBundle, "frames", frameId);
  const [dictionary, lookups, visibleAscii, semanticAscii, coverage, classId, instanceId, surfaceId, worldPosition, semanticColor, baselineText, contract, derivation] = await Promise.all([
    readJson(join(root, "config/glyph-object-dictionary.json")), readJson(join(frameRoot, "index-lookups.json")), readFile(join(frameRoot, "visible.txt"), "utf8"), readFile(join(frameRoot, "semantic.txt"), "utf8"), readFile(join(frameRoot, "coverage-u8.bin")), readFile(join(frameRoot, "class-id-i32.bin")), readFile(join(frameRoot, "instance-id-i32.bin")), readFile(join(frameRoot, "surface-id-i32.bin")), readFile(join(frameRoot, "world-position-f32.bin")), readFile(join(frameRoot, "semantic-color-argb.bin")), readFile(join(root, "reports/eval-baseline.json"), "utf8"), readJson(join(root, "config/measurement-gates.json")), readJson(join(root, "config/derivations/admission-v1.json")),
  ]);
  const classes = Object.fromEntries(dictionary.classes.map((entry) => [entry.semanticGlyph, entry.id]));
  const covered = Array.from(coverage, Boolean), surfaces = map(surfaceId, Int32Array), instances = map(instanceId, Int32Array);
  const rgb = [];
  for (const value of map(semanticColor, Uint32Array)) rgb.push(((value >>> 16) & 255) / 255, ((value >>> 8) & 255) / 255, (value & 255) / 255);
  const sourceSurface = surfaces.map((id) => id < 0 ? -1 : id);
  const reference = {
    visibleAscii, semanticAscii, coverage: covered, classId: map(classId, Int32Array), instanceId: instances, surfaceId: surfaces,
    worldPosition: map(worldPosition, Float32Array), camera: { viewProjection: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
    style: [0], crossViewIds: instances, stateVersion: 0, reprojectionValid: covered, disocclusion: covered.map(() => false), warpRgb: rgb, targetRgb: rgb, correctedRgb: rgb, sampleSourceSurfaceId: sourceSurface,
  };
  const fixture = { id: "pilot-mock-b10/v1", dictionary: classes, thresholds: derivation.thresholds, reference, cases: [{ id: target.targetId, kind: "good", candidate: {} }] };
  const result = evaluateAdmissionFixture(fixture), evaluated = result.cases[0];
  if (!result.passed || !evaluated.setup || evaluated.failed.length) throw new Error("PILOT_MOCK_B10_REJECTED");
  return {
    schemaVersion: "glyph-pilot-target-admission/v1", targetId: target.targetId, targetContentSha256: target.contentSha256, targetImageSha256: target.imageSha256,
    b10: { evaluator: "admission-v1", contractVersion: "v3", contractSha256: canonicalSha256(contract), baselineSha256: sha256(baselineText), accepted: true, metrics: Object.fromEntries(Object.entries(evaluated.metrics).map(([id, value]) => [id, value.value])) },
  };
}

export const pilotAcceptanceSha256 = (acceptance) => sha256(`${JSON.stringify(acceptance, null, 2)}\n`);
