import template from "./controlTensorContract.json";
import { computeGlyphControlContentSha256, type GlyphControlFrame } from "./controlFrame";

export type GlyphControlTensorChannelSource = "visibleGlyph" | "semanticGlyph" | "semanticColor" | "depth" | "normal" | "worldPosition" | "surfaceUv" | "surfaceUvValid" | "coverage" | "shade" | "warpRgb" | "reprojectionValid" | "disocclusion" | "atlasConfidence";
export interface GlyphControlTensorChannel { readonly id: string; readonly source: GlyphControlTensorChannelSource; readonly width: number; readonly encoding: string; readonly scaling: string; readonly clamp: readonly [number, number]; readonly emptySentinel: number; readonly inputPolicy: "clamp" | "reject"; readonly causalityAblation: string; }
export interface GlyphControlTensorContract { readonly schemaVersion: "glyph-control-tensor-contract/v2"; readonly id: "glyph-control-tensor-contract/mvp-v2"; readonly dtype: "float32"; readonly layout: "NCHW"; readonly glyphVocabulary: "ascii-printable-v1"; readonly keyframeWidth: 17; readonly temporalWidth: 23; readonly keyframeChannels: readonly GlyphControlTensorChannel[]; readonly temporalPrefixChannels: readonly GlyphControlTensorChannel[]; readonly contentSha256: string; }
export interface GlyphControlTensorNormalization { readonly depth: { readonly near: number; readonly far: number }; readonly world: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] }; }
export interface GlyphControlTensorInstance { readonly schemaVersion: "glyph-control-tensor-instance/v2"; readonly id: "glyph-control-tensor-instance/mvp-v2"; readonly contractId: GlyphControlTensorContract["id"]; readonly contractSha256: string; readonly scene: { readonly id: string; readonly sha256: string }; readonly font: { readonly id: string; readonly version: string; readonly sha256: string }; readonly dictionary: { readonly id: string; readonly sha256: string }; readonly normalization: GlyphControlTensorNormalization; readonly contentSha256: string; }
export interface GlyphControlTensorSpec { readonly schemaVersion: "glyph-control-tensor-spec/v2"; readonly id: "glyph-control-tensor-spec/mvp-v2"; readonly contract: GlyphControlTensorContract; readonly contractSha256: string; readonly instance: GlyphControlTensorInstance; readonly contentSha256: string; }
export interface GlyphTemporalControlInputs { readonly warpRgb: Float32Array; readonly reprojectionValid: Float32Array; readonly disocclusion: Float32Array; readonly atlasConfidence: Float32Array; }
export interface GlyphPackedControlTensors { readonly spec: GlyphControlTensorSpec; readonly keyframe: Float32Array; readonly temporal: Float32Array | null; readonly width: number; readonly height: number; }

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as object)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function clone<T>(value: T): T { return structuredClone(value); }
function canonicalHash(value: object): string { return computeGlyphControlContentSha256(value); }
function seal<T extends object>(value: T): T & { readonly contentSha256: string } {
  return deepFreeze({ ...value, contentSha256: canonicalHash(value) });
}

const templateWithoutHash = clone(template) as unknown as Omit<GlyphControlTensorContract, "contentSha256">;
export const GLYPH_CONTROL_TENSOR_CONTRACT: GlyphControlTensorContract = seal(templateWithoutHash) as GlyphControlTensorContract;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const unit = (value: number) => Math.min(1, Math.max(0, value));
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9._/-]*$/;
const own = (value: unknown, keys: readonly string[], label: string): value is Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`glyphcss: ${label} must be an object.`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !Object.prototype.propertyIsEnumerable.call(value, key)) || actual.some((key) => !keys.includes(key))) throw new TypeError(`glyphcss: ${label} must contain exactly ${keys.join(", ")}.`);
  return true;
};
function finite(value: number, label: string): void { if (!Number.isFinite(value)) throw new TypeError(`glyphcss: ${label} must be finite.`); }
function exactId(value: string, label: string): void { if (!ID.test(value)) throw new TypeError(`glyphcss: ${label} must be a stable lowercase identifier.`); }
function exactHash(value: string, label: string): void { if (!SHA256.test(value)) throw new TypeError(`glyphcss: ${label} must be a lowercase SHA-256 hash.`); }
function normalizationValid(normalization: GlyphControlTensorNormalization): void {
  own(normalization, ["depth", "world"], "tensor normalization");
  own(normalization.depth, ["near", "far"], "tensor depth normalization");
  finite(normalization.depth.near, "depth near"); finite(normalization.depth.far, "depth far");
  if (!(normalization.depth.far > normalization.depth.near)) throw new RangeError("glyphcss: tensor depth normalization must have far > near.");
  own(normalization.world, ["min", "max"], "tensor world normalization");
  if (normalization.world.min.length !== 3 || normalization.world.max.length !== 3) throw new RangeError("glyphcss: tensor world normalization must have three axes.");
  for (let axis = 0; axis < 3; axis++) {
    finite(normalization.world.min[axis]!, "world min"); finite(normalization.world.max[axis]!, "world max");
    if (!(normalization.world.max[axis]! > normalization.world.min[axis]!)) throw new RangeError("glyphcss: tensor world normalization must have max > min.");
  }
}
function exactContract(value: GlyphControlTensorContract): void {
  own(value, ["schemaVersion", "id", "dtype", "layout", "glyphVocabulary", "keyframeWidth", "temporalWidth", "keyframeChannels", "temporalPrefixChannels", "contentSha256"], "control tensor contract");
  if (!same({ ...value, contentSha256: undefined }, { ...GLYPH_CONTROL_TENSOR_CONTRACT, contentSha256: undefined }) || value.contentSha256 !== GLYPH_CONTROL_TENSOR_CONTRACT.contentSha256) throw new TypeError("glyphcss: control tensor contract must exactly match the frozen B32 template.");
}
function exactInstance(instance: GlyphControlTensorInstance, frame?: Pick<GlyphControlFrame, "metadata">): void {
  own(instance, ["schemaVersion", "id", "contractId", "contractSha256", "scene", "font", "dictionary", "normalization", "contentSha256"], "control tensor instance");
  if (instance.schemaVersion !== "glyph-control-tensor-instance/v2" || instance.id !== "glyph-control-tensor-instance/mvp-v2" || instance.contractId !== GLYPH_CONTROL_TENSOR_CONTRACT.id || instance.contractSha256 !== GLYPH_CONTROL_TENSOR_CONTRACT.contentSha256) throw new TypeError("glyphcss: unsupported control tensor instance.");
  own(instance.scene, ["id", "sha256"], "control tensor instance scene"); own(instance.font, ["id", "version", "sha256"], "control tensor instance font"); own(instance.dictionary, ["id", "sha256"], "control tensor instance dictionary");
  exactId(instance.scene.id, "scene id"); exactHash(instance.scene.sha256, "scene hash"); exactId(instance.font.id, "font id"); if (!instance.font.version) throw new TypeError("glyphcss: font version must be non-empty."); exactHash(instance.font.sha256, "font hash"); exactId(instance.dictionary.id, "dictionary id"); exactHash(instance.dictionary.sha256, "dictionary hash");
  normalizationValid(instance.normalization);
  if (canonicalHash({ ...instance, contentSha256: undefined }) !== instance.contentSha256) throw new TypeError("glyphcss: control tensor instance contentSha256 mismatch.");
  if (frame && (instance.scene.id !== frame.metadata.scene.id || instance.scene.sha256 !== frame.metadata.scene.contentSha256 || !same(instance.font, frame.metadata.dictionary.font) || instance.dictionary.id !== frame.metadata.dictionary.id || instance.dictionary.sha256 !== frame.metadata.dictionary.contentSha256)) throw new TypeError("glyphcss: control tensor dictionary/font/scene dependency mismatch.");
}

/** Exact validation prevents a training/exporter drift from silently changing tensor meaning. */
export function validateGlyphControlTensorSpec(spec: GlyphControlTensorSpec, frame?: Pick<GlyphControlFrame, "metadata">, normalization?: GlyphControlTensorNormalization): void {
  own(spec, ["schemaVersion", "id", "contract", "contractSha256", "instance", "contentSha256"], "control tensor spec");
  if (spec.schemaVersion !== "glyph-control-tensor-spec/v2" || spec.id !== "glyph-control-tensor-spec/mvp-v2" || spec.contractSha256 !== GLYPH_CONTROL_TENSOR_CONTRACT.contentSha256) throw new TypeError("glyphcss: unsupported control tensor spec.");
  exactContract(spec.contract); exactInstance(spec.instance, frame);
  if (normalization && !same(spec.instance.normalization, normalization)) throw new TypeError("glyphcss: control tensor normalization dependency mismatch.");
  if (canonicalHash({ ...spec, contentSha256: undefined }) !== spec.contentSha256) throw new TypeError("glyphcss: control tensor spec contentSha256 mismatch.");
}

function instanceFor(frame: GlyphControlFrame, normalization: GlyphControlTensorNormalization): GlyphControlTensorInstance {
  const raw = {
    schemaVersion: "glyph-control-tensor-instance/v2" as const,
    id: "glyph-control-tensor-instance/mvp-v2" as const,
    contractId: GLYPH_CONTROL_TENSOR_CONTRACT.id,
    contractSha256: GLYPH_CONTROL_TENSOR_CONTRACT.contentSha256,
    scene: { id: frame.metadata.scene.id, sha256: frame.metadata.scene.contentSha256 },
    font: { ...frame.metadata.dictionary.font },
    dictionary: { id: frame.metadata.dictionary.id, sha256: frame.metadata.dictionary.contentSha256 },
    normalization: { depth: { ...normalization.depth }, world: { min: [...normalization.world.min] as [number, number, number], max: [...normalization.world.max] as [number, number, number] } },
  };
  return seal(raw) as GlyphControlTensorInstance;
}
function specFor(frame: GlyphControlFrame, normalization: GlyphControlTensorNormalization): GlyphControlTensorSpec {
  const raw = { schemaVersion: "glyph-control-tensor-spec/v2" as const, id: "glyph-control-tensor-spec/mvp-v2" as const, contract: GLYPH_CONTROL_TENSOR_CONTRACT, contractSha256: GLYPH_CONTROL_TENSOR_CONTRACT.contentSha256, instance: instanceFor(frame, normalization) };
  return seal(raw) as GlyphControlTensorSpec;
}
function glyph(ascii: string, index: number, label: string): number { const char = [...ascii.replace(/\n/g, "")][index] ?? " "; if (char === " ") return 0; const code = char.codePointAt(0)!; if (code < 33 || code > 126) throw new RangeError(`glyphcss: ${label} contains ${JSON.stringify(char)}, outside ascii-printable-v1.`); return (code - 32) / 94; }
function sized(values: Float32Array, count: number, label: string): void { if (values.length !== count) throw new RangeError(`glyphcss: ${label} has ${values.length} values; expected ${count}.`); }
function temporalUnit(values: Float32Array, label: string, binary = false): void { for (const value of values) if (!Number.isFinite(value) || value < 0 || value > 1 || (binary && value !== 0 && value !== 1)) throw new RangeError(`glyphcss: ${label} must contain ${binary ? "binary" : "finite [0,1]"} values.`); }

export function packGlyphControlTensor(frame: GlyphControlFrame, normalization: GlyphControlTensorNormalization, temporal?: GlyphTemporalControlInputs): GlyphPackedControlTensors {
  const n = frame.metadata.cols * frame.metadata.rows;
  if (frame.coverage.length !== n || frame.depth.length !== n || frame.normal.length !== n * 3 || frame.worldPosition.length !== n * 3 || frame.surfaceUv.length !== n * 2 || frame.shade.length !== n) throw new RangeError("glyphcss: control frame dimensions are inconsistent.");
  normalizationValid(normalization); for (const value of frame.coverage) if (value !== 0 && value !== 1) throw new RangeError("glyphcss: coverage must be binary.");
  const spec = specFor(frame, normalization); validateGlyphControlTensorSpec(spec, frame, normalization);
  const result = new Float32Array(GLYPH_CONTROL_TENSOR_CONTRACT.keyframeWidth * n); let plane = 0; const covered = (index: number) => frame.coverage[index] === 1;
  const write = (count: number, fn: (index: number, component: number) => number) => { for (let component = 0; component < count; component++) for (let index = 0; index < n; index++) result[(plane + component) * n + index] = fn(index, component); plane += count; };
  write(1, (i) => covered(i) ? glyph(frame.visibleAscii, i, "visibleAscii") : 0); write(1, (i) => covered(i) ? glyph(frame.semanticAscii, i, "semanticAscii") : 0);
  write(3, (i, c) => covered(i) ? ((frame.semanticColor[i]! >>> ((2 - c) * 8)) & 255) / 255 : 0);
  write(1, (i) => !covered(i) ? 0 : (finite(frame.depth[i]!, "covered depth"), unit((frame.depth[i]! - normalization.depth.near) / (normalization.depth.far - normalization.depth.near))));
  write(3, (i, c) => !covered(i) ? 0 : (finite(frame.normal[i * 3 + c]!, "covered normal"), unit((frame.normal[i * 3 + c]! + 1) / 2)));
  write(3, (i, c) => !covered(i) ? 0 : (finite(frame.worldPosition[i * 3 + c]!, "covered world position"), unit((frame.worldPosition[i * 3 + c]! - normalization.world.min[c]!) / (normalization.world.max[c]! - normalization.world.min[c]!))));
  write(2, (i, c) => {
    if (!covered(i)) return 0;
    const value = frame.surfaceUv[i * 2 + c]!;
    // Covered flat-color faces may legitimately have no authored UVs. The
    // control frame preserves that absence as NaN; the tensor stores zero in
    // the value planes and distinguishes it from a real (0,0) corner through
    // the adjacent surface-uv-valid plane.
    return Number.isFinite(value) ? unit(value) : 0;
  });
  write(1, (i) => covered(i) && Number.isFinite(frame.surfaceUv[i * 2]) && Number.isFinite(frame.surfaceUv[i * 2 + 1]) ? 1 : 0);
  write(1, (i) => covered(i) ? 1 : 0); write(1, (i) => !covered(i) ? 0 : (finite(frame.shade[i]!, "covered shade"), unit(frame.shade[i]!)));
  let packed: Float32Array | null = null;
  if (temporal) {
    sized(temporal.warpRgb, n * 3, "warpRgb"); sized(temporal.reprojectionValid, n, "reprojectionValid"); sized(temporal.disocclusion, n, "disocclusion"); sized(temporal.atlasConfidence, n, "atlasConfidence");
    temporalUnit(temporal.warpRgb, "warpRgb"); temporalUnit(temporal.reprojectionValid, "reprojectionValid", true); temporalUnit(temporal.disocclusion, "disocclusion", true); temporalUnit(temporal.atlasConfidence, "atlasConfidence");
    packed = new Float32Array(GLYPH_CONTROL_TENSOR_CONTRACT.temporalWidth * n); packed.set(result, 6 * n); packed.set(temporal.warpRgb, 0); packed.set(temporal.reprojectionValid, 3 * n); packed.set(temporal.disocclusion, 4 * n); packed.set(temporal.atlasConfidence, 5 * n);
  }
  return Object.freeze({ spec, keyframe: result, temporal: packed, width: frame.metadata.cols, height: frame.metadata.rows });
}
