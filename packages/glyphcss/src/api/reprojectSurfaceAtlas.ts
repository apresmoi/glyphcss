import { computeGlyphControlContentSha256, encodeGlyphControlCanonicalBytes, type GlyphControlFrame, type GlyphControlFrameMetadata } from "./controlFrame";
import type { GlyphTemporalControlInputs } from "./controlTensor";

/**
 * A DOM-free, surface-addressed cache for the deterministic part of temporal
 * presentation.  It deliberately stores no polygon, instance, or class IDs:
 * those are routing data in a control frame, never appearance-model inputs.
 */
export interface GlyphSurfaceAtlasState {
  readonly schemaVersion: "glyph-surface-atlas/v1";
  readonly atlasSize: number;
  readonly stateVersion: number;
  readonly provenance: GlyphSurfaceAtlasProvenance;
  readonly surfaces: readonly GlyphSurfaceAtlasSurface[];
  /** Integrity seal over provenance and every atlas byte. Mutable typed-array input fails closed. */
  readonly contentSha256: string;
}

export interface GlyphSurfaceAtlasProvenance {
  readonly sceneId: string;
  readonly sceneSha256: string;
  readonly dictionaryId: string;
  readonly dictionarySha256: string;
  readonly sourceStateVersion: number;
  readonly sourceCamera: GlyphSurfaceAtlasCamera;
}

export interface GlyphSurfaceAtlasCamera {
  readonly kind: GlyphControlFrameMetadata["camera"]["kind"];
  readonly rotX: number;
  readonly rotY: number;
  readonly center: readonly [number, number];
  readonly zoom: number;
  readonly distance: number;
  readonly perspective: number;
  readonly mat: readonly number[] | null;
  readonly useMat: boolean;
  readonly stretch: number;
  readonly fovScale: number;
  readonly target: readonly [number, number, number];
  readonly eyeMode: boolean;
}

/** One independent UV atlas.  RGB and confidence are indexed by `v * size + u`. */
export interface GlyphSurfaceAtlasSurface {
  readonly surfaceId: string;
  readonly rgb: Float32Array;
  readonly confidence: Float32Array;
}

export interface GlyphReprojectSurfaceAtlasOptions {
  /** The previous committed atlas, or null to start/reset history. */
  readonly state: GlyphSurfaceAtlasState | null;
  readonly sourceFrame: GlyphControlFrame;
  /** Source accepted image, normalized RGB in cell-major RGBRGB order. */
  readonly sourceRgb: Float32Array;
  readonly sourceStateVersion: number;
  readonly targetFrame: GlyphControlFrame;
  readonly targetStateVersion: number;
  /** Clears history before ingesting the source frame. */
  readonly reset?: boolean;
  /** UV atlas side length. Fixed once an atlas has been created. Default: 64. */
  readonly atlasSize?: number;
}

export interface GlyphReprojectSurfaceAtlasResult {
  readonly state: GlyphSurfaceAtlasState;
  /** Reprojected RGB in B32 NCHW planar order: all R, then all G, then all B. */
  readonly warpRgb: Float32Array;
  /** 1 only where the target depth winner found a texel for its own stable surface. */
  readonly reprojectionValid: Float32Array;
  /** 1 where a covered target winner is newly visible / has no safe history. */
  readonly disocclusion: Float32Array;
  readonly atlasConfidence: Float32Array;
  readonly temporal: GlyphTemporalControlInputs;
}

const HASH = /^[a-f0-9]{64}$/;
const id = (value: string, label: string) => {
  if (!/^[a-z][a-z0-9._/-]*$/.test(value)) throw new TypeError(`glyphcss: ${label} must be a stable lowercase identifier.`);
};
const finite = (value: number, label: string) => { if (!Number.isFinite(value)) throw new TypeError(`glyphcss: ${label} must be finite.`); };
const count = (frame: GlyphControlFrame) => frame.metadata.cols * frame.metadata.rows;
const camera = (metadata: GlyphControlFrameMetadata): GlyphSurfaceAtlasCamera => Object.freeze({
  kind: metadata.camera.kind, rotX: metadata.camera.rotX, rotY: metadata.camera.rotY,
  center: Object.freeze([metadata.camera.center[0], metadata.camera.center[1]]) as [number, number],
  zoom: metadata.camera.zoom, distance: metadata.camera.distance, perspective: metadata.camera.perspective,
  mat: metadata.camera.mat ? Object.freeze([...metadata.camera.mat]) : null, useMat: metadata.camera.useMat,
  stretch: metadata.camera.stretch, fovScale: metadata.camera.fovScale,
  target: Object.freeze([...metadata.camera.target]) as [number, number, number], eyeMode: metadata.camera.eyeMode,
});
const frameIdentity = (frame: GlyphControlFrame) => ({ sceneId: frame.metadata.scene.id, sceneSha256: frame.metadata.scene.contentSha256, dictionaryId: frame.metadata.dictionary.id, dictionarySha256: frame.metadata.dictionary.contentSha256 });
/** Builds checkpoint provenance from the accepted source frame. */
export const glyphSurfaceAtlasProvenanceFromFrame = (frame: GlyphControlFrame, sourceStateVersion: number): GlyphSurfaceAtlasProvenance => Object.freeze({ ...frameIdentity(frame), sourceStateVersion, sourceCamera: camera(frame.metadata) });
const cloneSurface = (surface: GlyphSurfaceAtlasSurface): GlyphSurfaceAtlasSurface => Object.freeze({ surfaceId: surface.surfaceId, rgb: new Float32Array(surface.rgb), confidence: new Float32Array(surface.confidence) });
const stateHash = (state: Omit<GlyphSurfaceAtlasState, "contentSha256">): string => computeGlyphControlContentSha256({ schemaVersion: state.schemaVersion, atlasSize: state.atlasSize, stateVersion: state.stateVersion, provenance: state.provenance, surfaces: state.surfaces.map((surface) => ({ surfaceId: surface.surfaceId, rgb: encodeGlyphControlCanonicalBytes(surface.rgb), confidence: encodeGlyphControlCanonicalBytes(surface.confidence) })) });

/** Shared validation boundary for the CPU oracle and browser-resident session. */
export function validateGlyphSurfaceAtlasFrame(frame: GlyphControlFrame, label = "control"): void {
  const n = count(frame);
  if (!Number.isInteger(frame.metadata.cols) || !Number.isInteger(frame.metadata.rows) || frame.metadata.cols <= 0 || frame.metadata.rows <= 0) throw new RangeError(`glyphcss: ${label} grid must be positive.`);
  if (frame.coverage.length !== n || frame.winnerPolygon.length !== n || frame.surfaceId.length !== n || frame.depth.length !== n || frame.surfaceUv.length !== n * 2 || frame.worldPosition.length !== n * 3) throw new RangeError(`glyphcss: ${label} control-frame dimensions are inconsistent.`);
  const identity = frameIdentity(frame); id(identity.sceneId, `${label} scene id`); id(identity.dictionaryId, `${label} dictionary id`);
  if (!HASH.test(identity.sceneSha256) || !HASH.test(identity.dictionarySha256)) throw new TypeError(`glyphcss: ${label} control-frame metadata hashes are invalid.`);
  const ids = new Set<string>(); const expected = [...frame.metadata.scene.surfaces.map((surface) => surface.id)].sort();
  if (frame.surfaceLookup.length !== expected.length) throw new RangeError(`glyphcss: ${label} surfaceLookup must exactly represent scene surfaces.`);
  for (let index = 0; index < frame.surfaceLookup.length; index++) { const surface = frame.surfaceLookup[index]!; id(surface, `${label} surfaceLookup id`); if (ids.has(surface) || surface !== expected[index]) throw new TypeError(`glyphcss: ${label} surfaceLookup must be unique lexical scene surface IDs.`); ids.add(surface); }
  for (let cell = 0; cell < n; cell++) {
    const covered = frame.coverage[cell] === 1;
    if (frame.coverage[cell] !== 0 && frame.coverage[cell] !== 1) throw new TypeError(`glyphcss: ${label} coverage must be binary.`);
    if (!covered) { if (frame.winnerPolygon[cell] !== -1 || frame.surfaceId[cell] !== -1) throw new TypeError(`glyphcss: ${label} empty cells must have empty winner and surface IDs.`); continue; }
    const winner = frame.winnerPolygon[cell]!, surfaceIndex = frame.surfaceId[cell]!;
    if (!Number.isInteger(winner) || winner < 0 || winner >= frame.metadata.scene.polygonSurfaceIds.length || !Number.isInteger(surfaceIndex) || surfaceIndex < 0 || surfaceIndex >= frame.surfaceLookup.length) throw new RangeError(`glyphcss: ${label} covered winner/surface routing is out of range.`);
    if (frame.surfaceLookup[surfaceIndex] !== frame.metadata.scene.polygonSurfaceIds[winner]) throw new TypeError(`glyphcss: ${label} covered winner/surface lineage is inconsistent.`);
  }
  const c = frame.metadata.camera;
  const cameraNumbers = [c.rotX, c.rotY, c.center[0], c.center[1], c.distance, c.perspective, c.zoom, c.stretch, c.fovScale, c.target[0], c.target[1], c.target[2], ...(c.mat ?? [])];
  if (!cameraNumbers.every(Number.isFinite) || c.center.length !== 2 || c.target.length !== 3 || (c.mat !== null && c.mat.length !== 16)) throw new TypeError(`glyphcss: ${label} camera metadata is invalid.`);
}

function uvIndex(frame: GlyphControlFrame, cell: number, size: number): number {
  const u = frame.surfaceUv[cell * 2]!, v = frame.surfaceUv[cell * 2 + 1]!;
  if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1) return -1;
  // World and depth are part of the safety boundary: an absent winner must
  // never become a valid texture sample merely because it has an old UV value.
  if (!Number.isFinite(frame.depth[cell]!) || !Number.isFinite(frame.worldPosition[cell * 3]!) || !Number.isFinite(frame.worldPosition[cell * 3 + 1]!) || !Number.isFinite(frame.worldPosition[cell * 3 + 2]!)) return -1;
  return Math.min(size - 1, Math.floor(v * size)) * size + Math.min(size - 1, Math.floor(u * size));
}

/** Validates the immutable CPU checkpoint format without projecting or mutating it. */
export function validateGlyphSurfaceAtlasState(state: GlyphSurfaceAtlasState, source: GlyphControlFrame, sourceVersion: number, size: number): void {
  if (state.schemaVersion !== "glyph-surface-atlas/v1" || !HASH.test(state.contentSha256) || !Number.isInteger(state.atlasSize) || state.atlasSize < 2 || state.atlasSize !== size || !Number.isInteger(state.stateVersion) || state.stateVersion < 0) throw new TypeError("glyphcss: invalid surface atlas state.");
  const identity = frameIdentity(source);
  const p = state.provenance;
  if (p.sceneId !== identity.sceneId || p.sceneSha256 !== identity.sceneSha256 || p.dictionaryId !== identity.dictionaryId || p.dictionarySha256 !== identity.dictionarySha256) throw new TypeError("glyphcss: stale surface atlas dependencies are rejected.");
  // The accepted source image belongs to the currently committed atlas state;
  // the target is the next state. Anything else can silently pair a frame with
  // the wrong camera/appearance and is therefore rejected.
  if (sourceVersion !== state.stateVersion) throw new RangeError("glyphcss: stale or skipped surface atlas state version is rejected.");
  const seen = new Set<string>();
  for (const surface of state.surfaces) {
    id(surface.surfaceId, "surface atlas surface id"); if (seen.has(surface.surfaceId)) throw new TypeError("glyphcss: duplicate surface atlas surface id."); seen.add(surface.surfaceId);
    if (surface.rgb.length !== size * size * 3 || surface.confidence.length !== size * size) throw new RangeError("glyphcss: invalid surface atlas dimensions.");
  }
  if (stateHash({ schemaVersion: state.schemaVersion, atlasSize: state.atlasSize, stateVersion: state.stateVersion, provenance: state.provenance, surfaces: state.surfaces }) !== state.contentSha256) throw new TypeError("glyphcss: surface atlas content hash mismatch; mutable state is rejected.");
}

/** Seals a checkpoint with the same lexical ordering and hash semantics as the CPU oracle. */
export function sealGlyphSurfaceAtlasState(raw: Omit<GlyphSurfaceAtlasState, "contentSha256">): GlyphSurfaceAtlasState {
  const surfaces = Object.freeze([...raw.surfaces].sort((left, right) => left.surfaceId.localeCompare(right.surfaceId)));
  return Object.freeze({ ...raw, surfaces, contentSha256: stateHash({ ...raw, surfaces }) });
}

/**
 * Ingest an accepted source image into persistent per-surface UV atlases, then
 * sample only the target frame's depth winners.  This is intentionally nearest
 * UV sampling: no cross-surface interpolation and no hidden projector.
 */
export function reprojectGlyphSurfaceAtlas(options: GlyphReprojectSurfaceAtlasOptions): GlyphReprojectSurfaceAtlasResult {
  const { sourceFrame, targetFrame, sourceRgb, sourceStateVersion, targetStateVersion } = options;
  validateGlyphSurfaceAtlasFrame(sourceFrame, "source"); validateGlyphSurfaceAtlasFrame(targetFrame, "target");
  if (!Number.isInteger(sourceStateVersion) || sourceStateVersion < 0 || !Number.isInteger(targetStateVersion) || targetStateVersion !== sourceStateVersion + 1) throw new RangeError("glyphcss: target state version must be exactly source state version + 1.");
  if (sourceRgb.length !== count(sourceFrame) * 3) throw new RangeError("glyphcss: sourceRgb dimensions must match the source control frame.");
  for (const value of sourceRgb) { finite(value, "sourceRgb"); if (value < 0 || value > 1) throw new RangeError("glyphcss: sourceRgb must be normalized to [0,1]."); }
  const a = options.atlasSize ?? options.state?.atlasSize ?? 64;
  if (!Number.isInteger(a) || a < 2 || a > 4096) throw new RangeError("glyphcss: atlasSize must be an integer in [2, 4096].");
  const sourceIdentity = frameIdentity(sourceFrame), targetIdentity = frameIdentity(targetFrame);
  if (sourceIdentity.sceneId !== targetIdentity.sceneId || sourceIdentity.sceneSha256 !== targetIdentity.sceneSha256 || sourceIdentity.dictionaryId !== targetIdentity.dictionaryId || sourceIdentity.dictionarySha256 !== targetIdentity.dictionarySha256) throw new TypeError("glyphcss: source and target control frames must share scene and dictionary provenance.");
  if (options.state && !options.reset) validateGlyphSurfaceAtlasState(options.state, sourceFrame, sourceStateVersion, a);
  const surfaces = new Map<string, GlyphSurfaceAtlasSurface>();
  if (options.state && !options.reset) for (const surface of options.state.surfaces) surfaces.set(surface.surfaceId, cloneSurface(surface));
  const lookup = sourceFrame.surfaceLookup;
  for (let cell = 0; cell < count(sourceFrame); cell++) {
    if (sourceFrame.coverage[cell] !== 1 || sourceFrame.winnerPolygon[cell]! < 0) continue;
    const surfaceIndex = sourceFrame.surfaceId[cell]!;
    const surfaceId = surfaceIndex < 0 ? undefined : lookup[surfaceIndex]; const texel = uvIndex(sourceFrame, cell, a);
    if (!surfaceId || texel < 0) continue;
    let atlas = surfaces.get(surfaceId);
    if (!atlas) { atlas = Object.freeze({ surfaceId, rgb: new Float32Array(a * a * 3), confidence: new Float32Array(a * a) }); surfaces.set(surfaceId, atlas); }
    const confidence = atlas.confidence[texel]!;
    const at = texel * 3;
    // A source cell is an accepted observation, not a blend of unknown history.
    atlas.rgb[at] = sourceRgb[cell * 3]!; atlas.rgb[at + 1] = sourceRgb[cell * 3 + 1]!; atlas.rgb[at + 2] = sourceRgb[cell * 3 + 2]!;
    atlas.confidence[texel] = Math.min(1, confidence + 1);
  }
  const n = count(targetFrame), warpRgb = new Float32Array(n * 3), valid = new Float32Array(n), disocclusion = new Float32Array(n), confidence = new Float32Array(n);
  for (let cell = 0; cell < n; cell++) {
    if (targetFrame.coverage[cell] !== 1 || targetFrame.winnerPolygon[cell]! < 0) continue;
    const surfaceIndex = targetFrame.surfaceId[cell]!;
    const surfaceId = surfaceIndex < 0 ? undefined : targetFrame.surfaceLookup[surfaceIndex]; const texel = uvIndex(targetFrame, cell, a);
    const atlas = surfaceId && texel >= 0 ? surfaces.get(surfaceId) : undefined;
    if (!atlas || atlas.confidence[texel]! <= 0) { disocclusion[cell] = 1; continue; }
    const at = texel * 3; warpRgb[cell] = atlas.rgb[at]!; warpRgb[n + cell] = atlas.rgb[at + 1]!; warpRgb[n * 2 + cell] = atlas.rgb[at + 2]!;
    valid[cell] = 1; confidence[cell] = atlas.confidence[texel]!;
  }
  const provenance = glyphSurfaceAtlasProvenanceFromFrame(sourceFrame, sourceStateVersion);
  const raw = { schemaVersion: "glyph-surface-atlas/v1" as const, atlasSize: a, stateVersion: targetStateVersion, provenance, surfaces: Object.freeze([...surfaces.values()].sort((left, right) => left.surfaceId.localeCompare(right.surfaceId))) };
  const state = sealGlyphSurfaceAtlasState(raw);
  const temporal: GlyphTemporalControlInputs = Object.freeze({ warpRgb, reprojectionValid: valid, disocclusion, atlasConfidence: confidence });
  return Object.freeze({ state, warpRgb, reprojectionValid: valid, disocclusion, atlasConfidence: confidence, temporal });
}

/** Deterministic nearest-cell resize for the B32 temporal prefix at model resolution. */
export function resampleGlyphTemporalInputs(inputs: GlyphTemporalControlInputs, sourceWidth: number, sourceHeight: number, targetWidth: number, targetHeight: number): GlyphTemporalControlInputs {
  if (![sourceWidth, sourceHeight, targetWidth, targetHeight].every((value) => Number.isInteger(value) && value > 0)) throw new RangeError("glyphcss: temporal resample dimensions must be positive integers.");
  const sourceN = sourceWidth * sourceHeight, targetN = targetWidth * targetHeight;
  if (inputs.warpRgb.length !== sourceN * 3 || inputs.reprojectionValid.length !== sourceN || inputs.disocclusion.length !== sourceN || inputs.atlasConfidence.length !== sourceN) throw new RangeError("glyphcss: temporal resample input dimensions are inconsistent.");
  const warpRgb = new Float32Array(targetN * 3), reprojectionValid = new Float32Array(targetN), disocclusion = new Float32Array(targetN), atlasConfidence = new Float32Array(targetN);
  for (let y = 0; y < targetHeight; y++) for (let x = 0; x < targetWidth; x++) {
    const sx = Math.min(sourceWidth - 1, Math.floor((x + .5) * sourceWidth / targetWidth)); const sy = Math.min(sourceHeight - 1, Math.floor((y + .5) * sourceHeight / targetHeight)); const source = sy * sourceWidth + sx, target = y * targetWidth + x;
    warpRgb[target] = inputs.warpRgb[source]!; warpRgb[targetN + target] = inputs.warpRgb[sourceN + source]!; warpRgb[targetN * 2 + target] = inputs.warpRgb[sourceN * 2 + source]!;
    reprojectionValid[target] = inputs.reprojectionValid[source]!; disocclusion[target] = inputs.disocclusion[source]!; atlasConfidence[target] = inputs.atlasConfidence[source]!;
  }
  return Object.freeze({ warpRgb, reprojectionValid, disocclusion, atlasConfidence });
}
