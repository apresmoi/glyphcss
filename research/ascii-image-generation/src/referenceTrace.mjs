import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { packGlyphControlTensor, reprojectGlyphSurfaceAtlas } from "glyphcss";
import { buildFrame, cameraFor, expansions, framedCameraFor, generateCorpusAt, sceneFor, seeded } from "./generate-controls.mjs";
import { canonicalReferenceResult } from "./referenceResult.mjs";

const root = resolve(import.meta.dirname, "..");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => value === null || typeof value !== "object"
  ? JSON.stringify(typeof value === "number" && Number.isFinite(value) ? Number(value.toPrecision(14)) || 0 : value)
  : Array.isArray(value)
    ? `[${value.map(canonical).join(",")}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
export const hashReferenceFrame = (frame, normalization) => {
  const packed = packGlyphControlTensor(frame, normalization);
  return sha(canonical({
    metadata: frame.metadata,
    instanceLookup: frame.instanceLookup,
    surfaceLookup: frame.surfaceLookup,
    visibleAscii: frame.visibleAscii,
    semanticAscii: frame.semanticAscii,
    visibleColor: sha(Buffer.from(frame.visibleColor.buffer, frame.visibleColor.byteOffset, frame.visibleColor.byteLength)),
    semanticColor: sha(Buffer.from(frame.semanticColor.buffer, frame.semanticColor.byteOffset, frame.semanticColor.byteLength)),
    coverage: sha(Buffer.from(frame.coverage.buffer, frame.coverage.byteOffset, frame.coverage.byteLength)),
    winnerPolygon: sha(Buffer.from(frame.winnerPolygon.buffer, frame.winnerPolygon.byteOffset, frame.winnerPolygon.byteLength)),
    classId: sha(Buffer.from(frame.classId.buffer, frame.classId.byteOffset, frame.classId.byteLength)),
    instanceId: sha(Buffer.from(frame.instanceId.buffer, frame.instanceId.byteOffset, frame.instanceId.byteLength)),
    surfaceId: sha(Buffer.from(frame.surfaceId.buffer, frame.surfaceId.byteOffset, frame.surfaceId.byteLength)),
    tensorSpec: packed.spec,
    tensorKeyframe: sha(Buffer.from(packed.keyframe.buffer, packed.keyframe.byteOffset, packed.keyframe.byteLength)),
  }));
};
const rgb = (frame) => {
  const output = new Float32Array(frame.coverage.length * 3);
  for (let cell = 0; cell < frame.coverage.length; cell += 1) {
    const color = frame.semanticColor[cell] >>> 0;
    output[cell * 3] = ((color >>> 16) & 255) / 255;
    output[cell * 3 + 1] = ((color >>> 8) & 255) / 255;
    output[cell * 3 + 2] = (color & 255) / 255;
  }
  return output;
};
export const hashReferenceResult = (result) => sha(canonicalReferenceResult(result));

function interpolateCamera(left, right, t) {
  const camera = { ...left, target: [...left.target] };
  for (const key of ["rotX", "rotY", "zoom"]) camera[key] = left[key] + (right[key] - left[key]) * t;
  camera.target = left.target.map((value, index) => value + (right.target[index] - value) * t);
  return camera;
}

function segmentSteps(segment, generated, grid, framing, cameraFraming) {
  const random = seeded(`${segment.sceneSeed}/${segment.kind}`);
  const endpoints = [0, 1, 2].map((index) => cameraFraming === "unframed" ? cameraFor(segment.kind, index, random) : framedCameraFor(segment.kind, index, random, generated, grid, framing));
  const steps = [{ camera: endpoints[0], reset: true }];
  for (let leg = 0; leg < 2; leg += 1) {
    for (let sample = 1; sample <= segment.subdivisionsPerLeg; sample += 1) steps.push({ camera: interpolateCamera(endpoints[leg], endpoints[leg + 1], sample / segment.subdivisionsPerLeg), reset: false });
    if (segment.kind === "reset" && leg === 0) steps.push({ camera: endpoints[1], reset: true });
  }
  return { endpoints, steps };
}

function assertContractShape(contract, verify) {
  if (contract.schemaVersion !== "glyph-reprojection-reference-contract/v1") throw new Error("REFERENCE_TRACE_CONTRACT_SCHEMA");
  if (!Array.isArray(contract.segments) || contract.segments.length !== 5) throw new Error("REFERENCE_TRACE_SEGMENT_COUNT");
  const kinds = contract.segments.map((segment) => segment.kind).sort();
  if (canonical(kinds) !== canonical(["fast", "occlusion-swap", "reset", "reveal", "slow"])) throw new Error("REFERENCE_TRACE_EVENT_COVERAGE");
  if (verify && (![contract.expected?.inputSha256, contract.expected?.frameSha256, contract.expected?.eventSha256].every((value) => /^[a-f0-9]{64}$/.test(value)))) throw new Error("REFERENCE_TRACE_EXPECTED_HASHES_MISSING");
}

/**
 * Materialize the B39 population before a browser is launched. This uses the
 * exact B7 generator and B6 serialized maps, so the browser cannot silently
 * substitute the two-cell B24 probe or an unsealed control frame.
 */
export async function deriveReferenceTraceContract({ verify = true, enforceStructural = false, includeTransitions = false, cameraFraming = "bounds-fitted", atlasSize = 64, contract: contractOverride } = {}) {
  const contract = contractOverride ?? await json(join(root, "fixtures/reprojection/reference-trace-v1.json"));
  assertContractShape(contract, verify);
  const configPath = join(root, contract.corpus.config);
  const configBytes = await readFile(configPath);
  if (sha(configBytes) !== contract.corpus.configSha256) throw new Error("REFERENCE_TRACE_CORPUS_CONFIG_HASH_DRIFT");
  const output = await mkdtemp(join(tmpdir(), "glyphcss-reference-trace-"));
  try {
    const manifest = await generateCorpusAt(contract.corpus.config, output);
    if (!contract.corpus.manifestSha256.startsWith("PENDING") && manifest.contentSha256 !== contract.corpus.manifestSha256) throw new Error("REFERENCE_TRACE_CORPUS_MANIFEST_HASH_DRIFT");
    const dictionary = await json(join(root, "config/glyph-object-dictionary.json"));
    const config = await json(configPath);
    const normalization = await json(join(root, config.normalization));
    const events = [], inputs = [], transitions = [];
    for (const segment of contract.segments) {
      if (!manifest.scenes.some((scene) => scene.sceneSeed === segment.sceneSeed) || !manifest.trajectories.some((candidate) => candidate.kind === segment.kind)) throw new Error(`REFERENCE_TRACE_SEGMENT_NOT_IN_B7:${segment.id}`);
      const seedIndex = config.sceneSeeds.indexOf(segment.sceneSeed);
      if (seedIndex !== segment.seedIndex) throw new Error(`REFERENCE_TRACE_SEED_INDEX_DRIFT:${segment.id}`);
      const generated = sceneFor(segment.sceneSeed, dictionary, seedIndex);
      const expansion = expansions.find((candidate) => candidate.id === segment.expansionId);
      if (!expansion) throw new Error(`REFERENCE_TRACE_UNKNOWN_EXPANSION:${segment.id}`);
      const { steps } = segmentSteps(segment, generated, config.grid, config.framing, cameraFraming);
      let state = null;
      let previous = null;
      for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        const frame = buildFrame(generated, dictionary, step.camera, expansion, contract.measurementGrid);
        const target = { ...frame, id: `${segment.id}/${String(index).padStart(2, "0")}`, inputSha256: hashReferenceFrame(frame, normalization) };
        const source = step.reset ? target : previous;
        if (!source) throw new Error(`REFERENCE_TRACE_MISSING_INITIAL_RESET:${segment.id}/${index}`);
        const result = reprojectGlyphSurfaceAtlas({ state, reset: step.reset, sourceFrame: source, sourceRgb: rgb(source), sourceStateVersion: index, targetFrame: target, targetStateVersion: index + 1, atlasSize });
        const covered = Array.from(target.coverage).filter(Boolean).length;
        const valid = Array.from(result.reprojectionValid).filter(Boolean).length;
        const disoccluded = Array.from(result.disocclusion).filter(Boolean).length;
        let winnerSwapCells = 0, newlyCoveredCells = 0;
        for (let cell = 0; cell < target.coverage.length; cell += 1) {
          if (!source.coverage[cell] && target.coverage[cell]) newlyCoveredCells += 1;
          if (source.coverage[cell] && target.coverage[cell] && source.instanceId[cell] !== target.instanceId[cell]) winnerSwapCells += 1;
        }
        const cameraMotion = Math.abs(target.metadata.camera.rotX - source.metadata.camera.rotX) + Math.abs(target.metadata.camera.rotY - source.metadata.camera.rotY) + Math.abs(target.metadata.camera.zoom - source.metadata.camera.zoom);
        const event = { id: target.id, kind: segment.kind, reset: step.reset, sourceFrameId: source.id, targetFrameId: target.id, sourceInputSha256: source.inputSha256, targetInputSha256: target.inputSha256, resultSha256: hashReferenceResult(result), coveredCells: covered, validCells: valid, disoccludedCells: disoccluded, winnerSwapCells, newlyCoveredCells, cameraMotion };
        events.push(event); inputs.push({ id: event.id, sourceInputSha256: event.sourceInputSha256, targetInputSha256: event.targetInputSha256 });
        if (includeTransitions) transitions.push({ id: event.id, reset: step.reset, sourceStateVersion: index, targetStateVersion: index + 1, resultSha256: event.resultSha256, sourceFrame: source, targetFrame: target });
        state = result.state; previous = target;
      }
    }
    const observed = {
      inputSha256: sha(canonical(inputs)),
      frameSha256: sha(canonical(events.map(({ id, sourceFrameId, targetFrameId, sourceInputSha256, targetInputSha256 }) => ({ id, sourceFrameId, targetFrameId, sourceInputSha256, targetInputSha256 })))),
      eventSha256: sha(canonical(events.map(({ id, resultSha256, coveredCells, validCells, disoccludedCells, winnerSwapCells, newlyCoveredCells, cameraMotion, reset }) => ({ id, resultSha256, coveredCells, validCells, disoccludedCells, winnerSwapCells, newlyCoveredCells, cameraMotion, reset })))),
    };
    if (verify) {
      const expected = contract.expected;
      if (observed.inputSha256 !== expected.inputSha256 || observed.frameSha256 !== expected.frameSha256 || observed.eventSha256 !== expected.eventSha256) throw new Error("REFERENCE_TRACE_EXPECTED_EVENT_HASH_DRIFT");
    }
    const coverage = Math.min(...events.map((event) => event.coveredCells ? event.validCells / event.coveredCells : 1));
    const revealed = Math.max(...events.map((event) => event.coveredCells ? event.disoccludedCells / event.coveredCells : 0));
    const resetFrequency = events.filter((event) => event.reset).length / events.length;
    if (!events.some((event) => event.kind === "occlusion-swap" && event.winnerSwapCells > 0)
      || !events.some((event) => event.kind === "reveal" && event.newlyCoveredCells > 0 && event.disoccludedCells > 0)
      || !events.some((event) => event.kind === "reset" && event.reset)) throw new Error("REFERENCE_TRACE_REQUIRED_EVENT_MISSING");
    const meanMotion = (kind) => { const selected = events.filter((event) => event.kind === kind && !event.reset); return selected.reduce((sum, event) => sum + event.cameraMotion, 0) / selected.length; };
    if (!(meanMotion("fast") > meanMotion("slow"))) throw new Error("REFERENCE_TRACE_FAST_NOT_FASTER_THAN_SLOW");
    if (enforceStructural && (coverage < .9 || revealed > .2 || resetFrequency > .1)) throw new Error(`REFERENCE_TRACE_G5_STRUCTURAL_DOMAIN:${coverage}/${revealed}/${resetFrequency}`);
    return { contract, output, manifest, events, transitions, expected: observed, structural: { coverage, newlyRevealedArea: revealed, resetFrequency } };
  } catch (error) {
    await rm(output, { recursive: true, force: true });
    throw error;
  }
}

export async function materializeReferenceTrace() {
  return deriveReferenceTraceContract({ includeTransitions: true, enforceStructural: false });
}

export async function disposeReferenceTrace(trace) {
  await rm(trace.output, { recursive: true, force: true });
}
