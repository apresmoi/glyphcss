import type { Polygon, RenderMode, TextureSampler } from "@glyphcss/core";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera, type GlyphCamera } from "./createGlyphCamera";
import type { RasterizeContextOptions } from "./rasterizeContext";
import { buildRasterizeContext } from "./rasterizeContext";
import { rasterizeToCells } from "../render/rasterize";
import { isSingleCellGlyph } from "../render/cells";
import type { GlyphAmbientLight, GlyphDirectionalLight, GlyphShadowOptions } from "./types";

/** Immutable authored object-class vocabulary used by semantic control frames. */
export interface GlyphObjectDictionary {
  readonly schemaVersion: string;
  readonly id: string;
  readonly contentSha256: string;
  readonly font: {
    readonly id: string;
    readonly version: string;
    readonly sha256: string;
  };
  readonly classes: readonly GlyphObjectDictionaryClass[];
}

export interface GlyphObjectDictionaryClass {
  readonly id: number;
  readonly name: string;
  readonly semanticGlyph: string;
  readonly controlColor: string;
}

/** Immutable polygon → surface → instance → class lineage for one polygon order. */
export interface GlyphControlSceneManifest {
  readonly schemaVersion: string;
  readonly id: string;
  readonly dictionaryId: string;
  readonly dictionarySha256: string;
  readonly geometrySha256: string;
  readonly polygonOrderSha256: string;
  readonly contentSha256: string;
  readonly instances: readonly GlyphControlInstance[];
  readonly surfaces: readonly GlyphControlSurface[];
  /** Positional source-polygon mapping. Its length must exactly equal `polygons.length`. */
  readonly polygonSurfaceIds: readonly string[];
}

export interface GlyphControlInstance {
  readonly id: string;
  readonly classId: number;
}

export interface GlyphControlSurface {
  readonly id: string;
  readonly instanceId: string;
}

/** Solid-render options accepted by {@link buildGlyphControlFrame}. */
export interface GlyphControlFrameOptions {
  readonly polygons: readonly Polygon[];
  readonly scene: GlyphControlSceneManifest;
  readonly dictionary: GlyphObjectDictionary;
  readonly camera: GlyphCamera;
  readonly grid: { cols: number; rows: number; cellAspect: number; cellWidth?: number; cellHeight?: number; centerCol?: number; centerRow?: number };
  readonly mode?: RenderMode;
  readonly directionalLight?: GlyphDirectionalLight;
  readonly ambientLight?: GlyphAmbientLight;
  readonly glyphPalette?: string;
  readonly smoothShading?: boolean;
  readonly creaseAngle?: number;
  readonly doubleSided?: boolean;
  readonly supersample?: number;
  readonly shadow?: GlyphShadowOptions;
  readonly castShadowFlags?: readonly boolean[];
  readonly receiveShadowFlags?: readonly boolean[];
  readonly depthBiases?: readonly number[];
  readonly depthEpsilon?: number;
  /** Decoded texture pixels for the existing per-cell texture rasterizer. */
  readonly textureSamplers?: Map<string, TextureSampler> | null;
}

export interface GlyphControlFrameMetadata {
  readonly scene: GlyphControlSceneManifest;
  readonly dictionary: Pick<GlyphObjectDictionary, "schemaVersion" | "id" | "contentSha256" | "font">;
  readonly camera: GlyphControlCameraMetadata;
  readonly cols: number;
  readonly rows: number;
  readonly cellAspect: number;
  readonly supersample: number;
}

export interface GlyphControlCameraMetadata {
  readonly kind: GlyphCamera["kind"];
  readonly rotX: number;
  readonly rotY: number;
  readonly center: readonly [number, number];
  readonly mat: readonly number[] | null;
  readonly useMat: boolean;
  readonly distance: number;
  readonly perspective: number;
  readonly zoom: number;
  readonly stretch: number;
  readonly fovScale: number;
  readonly target: readonly [number, number, number];
  readonly eyeMode: boolean;
}

/**
 * Durable, aligned control output from one real solid rasterization.
 *
 * `visibleAscii` and `semanticAscii` are always raw `textContent` strings.
 * HTML is deliberately separate so downstream code cannot accidentally train
 * on `<span>` markup. Packed colors are `0xRRGGBB`; zero is the empty sentinel.
 */
export interface GlyphControlFrame {
  readonly visibleAscii: string;
  readonly semanticAscii: string;
  /** `0xAARRGGBB`; zero is empty and every covered color is opaque. */
  readonly visibleColor: Uint32Array;
  /** Final lit RGB from the same depth-winning subcell; zero is empty. */
  readonly targetRgb: Uint32Array;
  /** Unlit albedo (texture × authored base-color factor) from that same subcell. */
  readonly albedoRgb: Uint32Array;
  readonly semanticColor: Uint32Array;
  readonly coverage: Uint8Array;
  readonly winnerPolygon: Int32Array;
  readonly classId: Int32Array;
  readonly instanceId: Int32Array;
  readonly surfaceId: Int32Array;
  /** Lexical IDs only; empty cells use `-1` in `instanceId`. */
  readonly instanceLookup: readonly string[];
  /** Lexical IDs only; empty cells use `-1` in `surfaceId`. */
  readonly surfaceLookup: readonly string[];
  readonly depth: Float64Array;
  readonly shade: Float32Array;
  readonly normal: Float32Array;
  readonly worldPosition: Float32Array;
  readonly surfaceUv: Float32Array;
  readonly metadata: GlyphControlFrameMetadata;
}

export interface GlyphControlPolygonLineage {
  readonly classId: number;
  readonly instanceIndex: number;
  readonly surfaceIndex: number;
  readonly semanticGlyph: string;
  readonly controlColor: string;
}

export interface GlyphControlGeometryHashes {
  /** Hash of all render-relevant polygons after lexical canonical ordering. */
  readonly geometrySha256: string;
  /** Hash of the exact polygon array order used by rasterization. */
  readonly polygonOrderSha256: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[a-z][a-z0-9._/-]*$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const PRINTABLE_ASCII = /^[!-~]$/;

function assertHash(value: string, label: string): void {
  if (!SHA256.test(value)) throw new TypeError(`glyphcss: ${label} must be a lowercase SHA-256 hash.`);
}

function assertIdentifier(value: string, label: string): void {
  if (!IDENTIFIER.test(value)) throw new TypeError(`glyphcss: ${label} must be a stable lowercase identifier.`);
}

function assertExactRecord(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object") throw new TypeError(`glyphcss: ${label} must be a plain object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`glyphcss: ${label} must be a plain object.`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !Object.prototype.propertyIsEnumerable.call(value, key)) || actual.some((key) => !keys.includes(key))) {
    throw new TypeError(`glyphcss: ${label} must contain exactly ${keys.join(", ")}.`);
  }
}

function uniqueById<T extends { readonly id: string }>(values: readonly T[], label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    assertIdentifier(value.id, `${label} id`);
    if (result.has(value.id)) throw new TypeError(`glyphcss: duplicate ${label} id ${value.id}.`);
    result.set(value.id, value);
  }
  return result;
}

function packedColor(color: string | null | undefined): number {
  if (!color) return 0;
  return (0xff000000 | Number.parseInt(color.slice(1), 16)) >>> 0;
}

const canonicalByteArrays = new WeakSet<object>();
type GlyphControlCanonicalBytes = { readonly bytes: Uint8Array };

/** @internal */
export function encodeGlyphControlCanonicalBytes(value: { readonly buffer: ArrayBufferLike; readonly byteOffset: number; readonly byteLength: number }): object {
  const encoded: GlyphControlCanonicalBytes = Object.freeze({ bytes: new Uint8Array(value.buffer, value.byteOffset, value.byteLength) });
  canonicalByteArrays.add(encoded);
  return encoded;
}

function canonicalJson(value: unknown, omitContentHash = false): string {
  if (value === null) return "null";
  if (typeof value === "object" && canonicalByteArrays.has(value)) return `[${(value as GlyphControlCanonicalBytes).bytes.join(",")}]`;
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("glyphcss: control manifests and geometry must contain finite numbers.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) throw new TypeError("glyphcss: control manifests and geometry must contain dense arrays.");
    }
    if (value.every((entry) => typeof entry === "number" && Number.isFinite(entry))) return JSON.stringify(value);
    return `[${value.map((entry) => canonicalJson(entry, omitContentHash)).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined && (!omitContentHash || key !== "contentSha256")).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], omitContentHash)}`).join(",")}}`;
  }
  throw new TypeError("glyphcss: control manifests and geometry must be JSON values.");
}

function canonicalGeometryJson(value: unknown): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("glyphcss: control manifests and geometry must contain finite numbers.");
    const normalized = Number(value.toPrecision(15));
    return JSON.stringify(Object.is(normalized, -0) ? 0 : normalized);
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) throw new TypeError("glyphcss: control manifests and geometry must contain dense arrays.");
    }
    return `[${value.map(canonicalGeometryJson).join(",")}]`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter((key) => record[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalGeometryJson(record[key])}`).join(",")}}`;
  }
  throw new TypeError("glyphcss: control geometry must contain only JSON values.");
}

function utf8(value: string): Uint8Array {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(value);
  const bytes: number[] = [];
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | code >> 6, 0x80 | code & 0x3f);
    else if (code < 0x10000) bytes.push(0xe0 | code >> 12, 0x80 | code >> 6 & 0x3f, 0x80 | code & 0x3f);
    else bytes.push(0xf0 | code >> 18, 0x80 | code >> 12 & 0x3f, 0x80 | code >> 6 & 0x3f, 0x80 | code & 0x3f);
  }
  return new Uint8Array(bytes);
}

/** Synchronous SHA-256 for deterministic browser-side manifest verification. */
function sha256(value: string): string {
  const bytes = utf8(value); const bitLength = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6); padded.set(bytes); padded[bytes.length] = 0x80;
  const length = BigInt(bitLength); for (let i = 0; i < 8; i++) padded[padded.length - 1 - i] = Number((length >> BigInt(i * 8)) & 0xffn);
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  let h0=1779033703,h1=3144134277,h2=1013904242,h3=2773480762,h4=1359893119,h5=2600822924,h6=528734635,h7=1541459225;
  const w = new Uint32Array(64); const rotr = (n: number, x: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) { for (let i=0;i<16;i++) w[i] = (padded[offset+i*4]<<24)|(padded[offset+i*4+1]<<16)|(padded[offset+i*4+2]<<8)|padded[offset+i*4+3]; for (let i=16;i<64;i++) { const a=w[i-15], b=w[i-2]; w[i] = (((rotr(7,a)^rotr(18,a)^(a>>>3)) + w[i-16]) + ((rotr(17,b)^rotr(19,b)^(b>>>10)) + w[i-7])) >>> 0; } let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7; for (let i=0;i<64;i++) { const s1=rotr(6,e)^rotr(11,e)^rotr(25,e), ch=(e&f)^(~e&g), t1=(h+s1+ch+k[i]+w[i])>>>0, s0=rotr(2,a)^rotr(13,a)^rotr(22,a), maj=(a&b)^(a&c)^(b&c), t2=(s0+maj)>>>0; h=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0; } h0=(h0+a)>>>0;h1=(h1+b)>>>0;h2=(h2+c)>>>0;h3=(h3+d)>>>0;h4=(h4+e)>>>0;h5=(h5+f)>>>0;h6=(h6+g)>>>0;h7=(h7+h)>>>0; }
  return [h0,h1,h2,h3,h4,h5,h6,h7].map((word) => word.toString(16).padStart(8,"0")).join("");
}

/** Canonical manifest hash defined by B31: sorted JSON keys excluding `contentSha256`. */
export function computeGlyphControlContentSha256(value: object): string { return sha256(canonicalJson(value, true)); }

/** Hash every render-relevant Polygon field, both order-sensitive and order-independent. */
export function computeGlyphControlGeometryHashes(polygons: readonly Polygon[]): GlyphControlGeometryHashes {
  for (let index = 0; index < polygons.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(polygons, index)) throw new TypeError("glyphcss: control manifests and geometry must contain dense arrays.");
  }
  const serialized = polygons.map((polygon) => canonicalGeometryJson(polygon));
  return { polygonOrderSha256: sha256(`[${serialized.join(",")}]`), geometrySha256: sha256(`[${[...serialized].sort().join(",")}]`) };
}

function rawAscii(chars: readonly string[], cols: number, rows: number): string {
  const lines = new Array<string>(rows);
  for (let row = 0; row < rows; row++) lines[row] = chars.slice(row * cols, (row + 1) * cols).join("");
  return lines.join("\n");
}

function copyCamera(camera: GlyphCamera): GlyphControlCameraMetadata {
  return {
    kind: camera.kind,
    rotX: camera.rotX,
    rotY: camera.rotY,
    center: [camera.center[0], camera.center[1]],
    mat: camera.mat ? [...camera.mat] : null,
    useMat: camera.useMat,
    distance: camera.distance,
    perspective: camera.perspective,
    zoom: camera.zoom,
    stretch: camera.stretch,
    fovScale: camera.fovScale,
    target: [camera.target[0], camera.target[1], camera.target[2]],
    eyeMode: camera.eyeMode,
  };
}

function isolateCamera(camera: GlyphCamera): GlyphCamera {
  const common = { rotX: camera.rotX, rotY: camera.rotY, zoom: camera.zoom, center: [...camera.center] as [number, number], mat: camera.mat ? [...camera.mat] : undefined, useMat: camera.useMat };
  const isolated = camera.kind === "perspective"
    ? createGlyphPerspectiveCamera({ ...common, distance: camera.distance, perspective: camera.perspective, stretch: camera.stretch, fovScale: camera.fovScale })
    : createGlyphOrthographicCamera(common);
  // Orthographic factories intentionally expose these as mutable interface fields
  // even though some do not affect their projection. Preserve all of them so a
  // capture is a true snapshot of the caller's camera state.
  isolated.distance = camera.distance;
  isolated.perspective = camera.perspective;
  isolated.stretch = camera.stretch;
  isolated.fovScale = camera.fovScale;
  isolated.target = [...camera.target] as [number, number, number];
  isolated.eyeMode = camera.eyeMode;
  return isolated;
}

function cloneManifest(scene: GlyphControlSceneManifest): GlyphControlSceneManifest {
  return {
    ...scene,
    instances: scene.instances.map((instance) => ({ ...instance })),
    surfaces: scene.surfaces.map((surface) => ({ ...surface })),
    polygonSurfaceIds: [...scene.polygonSurfaceIds],
  };
}

/**
 * Validate immutable control metadata and resolve every source polygon to its
 * semantic dictionary entry. Scene renderers use this before their one real
 * projection, so semantic output never needs a second projector.
 */
export function resolveGlyphControlLineage(
  polygons: readonly Polygon[],
  scene: GlyphControlSceneManifest,
  dictionary: GlyphObjectDictionary,
): { lineage: GlyphControlPolygonLineage[]; instanceLookup: string[]; surfaceLookup: string[] } {
  validateGlyphControlMetadata(scene, dictionary);
  const geometry = computeGlyphControlGeometryHashes(polygons);
  if (scene.geometrySha256 !== geometry.geometrySha256 || scene.polygonOrderSha256 !== geometry.polygonOrderSha256) {
    throw new TypeError("glyphcss: scene geometry hashes do not match the supplied polygons.");
  }
  if (scene.polygonSurfaceIds.length !== polygons.length) {
    throw new RangeError("glyphcss: scene polygonSurfaceIds must exactly match the polygon array length.");
  }

  const instances = uniqueById(scene.instances, "instance");
  const surfaces = uniqueById(scene.surfaces, "surface");
  const classes = new Map<number, GlyphObjectDictionaryClass>();
  for (const entry of dictionary.classes) classes.set(entry.id, entry);
  const instanceLookup = [...instances.keys()].sort();
  const surfaceLookup = [...surfaces.keys()].sort();
  const instanceIndices = new Map(instanceLookup.map((id, index) => [id, index]));
  const surfaceIndices = new Map(surfaceLookup.map((id, index) => [id, index]));
  const lineage = scene.polygonSurfaceIds.map((surfaceId) => {
    const surface = surfaces.get(surfaceId);
    if (!surface) throw new TypeError(`glyphcss: polygon references unknown surface ${surfaceId}.`);
    const instance = instances.get(surface.instanceId)!;
    const entry = classes.get(instance.classId)!;
    return {
      classId: instance.classId,
      instanceIndex: instanceIndices.get(instance.id)!,
      surfaceIndex: surfaceIndices.get(surface.id)!,
      semanticGlyph: entry.semanticGlyph,
      controlColor: entry.controlColor,
    };
  });
  return { lineage, instanceLookup, surfaceLookup };
}

/** Validate a scene/dictionary pair before a runtime scene creates DOM. */
export function validateGlyphControlMetadata(
  scene: GlyphControlSceneManifest,
  dictionary: GlyphObjectDictionary,
): void {
  assertExactRecord(dictionary, ["schemaVersion", "id", "contentSha256", "font", "classes"], "dictionary");
  assertExactRecord(dictionary.font, ["id", "version", "sha256"], "dictionary font");
  for (const entry of dictionary.classes) assertExactRecord(entry, ["id", "name", "semanticGlyph", "controlColor"], "dictionary class");
  assertExactRecord(scene, ["schemaVersion", "id", "dictionaryId", "dictionarySha256", "geometrySha256", "polygonOrderSha256", "contentSha256", "instances", "surfaces", "polygonSurfaceIds"], "scene");
  for (const instance of scene.instances) assertExactRecord(instance, ["id", "classId"], "scene instance");
  for (const surface of scene.surfaces) assertExactRecord(surface, ["id", "instanceId"], "scene surface");
  if (scene.schemaVersion !== "control-scene/v1") throw new TypeError("glyphcss: scene schemaVersion must be control-scene/v1.");
  if (dictionary.schemaVersion !== "glyph-object-dictionary/v2") throw new TypeError("glyphcss: dictionary schemaVersion must be glyph-object-dictionary/v2.");
  assertIdentifier(scene.id, "scene id");
  assertIdentifier(scene.dictionaryId, "scene dictionary id");
  assertHash(scene.dictionarySha256, "scene dictionarySha256");
  assertHash(scene.geometrySha256, "scene geometrySha256");
  assertHash(scene.polygonOrderSha256, "scene polygonOrderSha256");
  assertHash(scene.contentSha256, "scene contentSha256");
  if (scene.dictionaryId !== dictionary.id || scene.dictionarySha256 !== dictionary.contentSha256) {
    throw new TypeError("glyphcss: scene dictionary identity does not match the supplied dictionary.");
  }
  assertIdentifier(dictionary.id, "dictionary id");
  assertHash(dictionary.contentSha256, "dictionary contentSha256");
  assertIdentifier(dictionary.font.id, "dictionary font id");
  assertHash(dictionary.font.sha256, "dictionary font sha256");
  if (!dictionary.font.version) throw new TypeError("glyphcss: dictionary font version must be nonempty.");
  if (dictionary.contentSha256 !== computeGlyphControlContentSha256(dictionary)) {
    throw new TypeError("glyphcss: dictionary contentSha256 does not match canonical content.");
  }
  if (scene.contentSha256 !== computeGlyphControlContentSha256(scene)) {
    throw new TypeError("glyphcss: scene contentSha256 does not match canonical content.");
  }
  if (scene.instances.length < 1 || scene.surfaces.length < 1) {
    throw new RangeError("glyphcss: control scenes require nonempty instances and surfaces.");
  }
  if (dictionary.classes.length < 1) throw new RangeError("glyphcss: dictionaries require at least one class.");

  const instances = uniqueById(scene.instances, "instance");
  const surfaces = uniqueById(scene.surfaces, "surface");
  const classes = new Map<number, GlyphObjectDictionaryClass>();
  const classNames = new Set<string>(); const classGlyphs = new Set<string>(); const classColors = new Set<string>();
  for (const entry of dictionary.classes) {
    if (!Number.isInteger(entry.id) || entry.id < 1 || classes.has(entry.id)) {
      throw new TypeError("glyphcss: dictionary class IDs must be unique positive integers.");
    }
    if (!isSingleCellGlyph(entry.semanticGlyph) || !PRINTABLE_ASCII.test(entry.semanticGlyph)) {
      throw new TypeError(`glyphcss: dictionary class ${entry.id} must have one non-space semantic glyph.`);
    }
    if (!COLOR.test(entry.controlColor)) {
      throw new TypeError(`glyphcss: dictionary class ${entry.id} must have a #rrggbb control color.`);
    }
    assertIdentifier(entry.name, `dictionary class ${entry.id} name`);
    if (classNames.has(entry.name) || classGlyphs.has(entry.semanticGlyph) || classColors.has(entry.controlColor.toLowerCase())) {
      throw new TypeError("glyphcss: dictionary class names, semantic glyphs, and control colors must be unique.");
    }
    classNames.add(entry.name); classGlyphs.add(entry.semanticGlyph); classColors.add(entry.controlColor.toLowerCase());
    classes.set(entry.id, entry);
  }

  for (const surface of surfaces.values()) {
    const instance = instances.get(surface.instanceId);
    if (!instance) throw new TypeError(`glyphcss: surface ${surface.id} references unknown instance ${surface.instanceId}.`);
    if (!classes.has(instance.classId)) throw new TypeError(`glyphcss: instance ${instance.id} references unknown class ${instance.classId}.`);
  }

  for (const surfaceId of scene.polygonSurfaceIds) {
    const surface = surfaces.get(surfaceId);
    if (!surface) throw new TypeError(`glyphcss: polygon references unknown surface ${surfaceId}.`);
  }
}

/**
 * Capture visible and semantic control representations from the same winning
 * cells. This function is pure, browser-safe, and never changes default render
 * allocation because it requests the winner buffer only for this invocation.
 */
export function buildGlyphControlFrame(opts: GlyphControlFrameOptions): GlyphControlFrame {
  const mode = opts.mode ?? "solid";
  if (mode !== "solid") throw new RangeError("glyphcss: control frames require solid mode.");
  const { lineage, instanceLookup, surfaceLookup } = resolveGlyphControlLineage(opts.polygons, opts.scene, opts.dictionary);
  const ctxOptions: RasterizeContextOptions = {
    camera: isolateCamera(opts.camera),
    grid: { ...opts.grid },
    polygons: [...opts.polygons],
    mode,
    directionalLight: opts.directionalLight,
    ambientLight: opts.ambientLight,
    glyphPalette: opts.glyphPalette,
    useColors: true,
    smoothShading: opts.smoothShading,
    creaseAngle: opts.creaseAngle,
    doubleSided: opts.doubleSided,
    supersample: opts.supersample,
    shadow: opts.shadow,
    castShadowFlags: opts.castShadowFlags ? [...opts.castShadowFlags] : undefined,
    receiveShadowFlags: opts.receiveShadowFlags ? [...opts.receiveShadowFlags] : undefined,
    depthBiases: opts.depthBiases ? [...opts.depthBiases] : undefined,
    depthEpsilon: opts.depthEpsilon,
    textureSamplers: opts.textureSamplers,
    retainShade: true,
    retainWorldPosition: true,
    retainNormal: true,
    retainWinnerPolygon: true,
    retainAlbedoRgb: true,
    retainTargetRgb: true,
  };
  const cells = rasterizeToCells(buildRasterizeContext(ctxOptions));
  const n = cells.cols * cells.rows;
  const winners = cells.winnerPolygon ?? new Int32Array(n).fill(-1);
  const semanticChars = new Array<string>(n).fill(" ");
  const visibleColor = new Uint32Array(n);
  const targetRgb = cells.targetRgb ? new Uint32Array(cells.targetRgb) : new Uint32Array(n);
  const albedoRgb = cells.albedoRgb ? new Uint32Array(cells.albedoRgb) : new Uint32Array(n);
  const semanticColor = new Uint32Array(n);
  const coverage = new Uint8Array(n);
  const classId = new Int32Array(n).fill(-1);
  const instanceId = new Int32Array(n).fill(-1);
  const surfaceId = new Int32Array(n).fill(-1);
  for (let index = 0; index < n; index++) {
    const winner = winners[index]!;
    if (winner < 0) continue;
    // Visible color remains the presentation color. `targetRgb` is captured
    // independently in the same depth win so dim/dithered glyphs cannot erase
    // or tint the texture target.
    visibleColor[index] = packedColor(cells.color[index]);
    const resolved = lineage[winner];
    if (!resolved) throw new RangeError(`glyphcss: raster winner ${winner} is outside the immutable polygon lineage.`);
    coverage[index] = 1;
    classId[index] = resolved.classId;
    instanceId[index] = resolved.instanceIndex;
    surfaceId[index] = resolved.surfaceIndex;
    semanticChars[index] = resolved.semanticGlyph;
    semanticColor[index] = packedColor(resolved.controlColor);
  }
  const metadata: GlyphControlFrameMetadata = {
    scene: cloneManifest(opts.scene),
    dictionary: {
      schemaVersion: opts.dictionary.schemaVersion,
      id: opts.dictionary.id,
      contentSha256: opts.dictionary.contentSha256,
      font: { ...opts.dictionary.font },
    },
    camera: copyCamera(opts.camera),
    cols: cells.cols,
    rows: cells.rows,
    cellAspect: opts.grid.cellAspect,
    supersample: opts.supersample ?? 1,
  };
  return {
    visibleAscii: rawAscii(cells.char, cells.cols, cells.rows),
    semanticAscii: rawAscii(semanticChars, cells.cols, cells.rows),
    visibleColor,
    targetRgb,
    albedoRgb,
    semanticColor,
    coverage,
    winnerPolygon: new Int32Array(winners),
    classId,
    instanceId,
    surfaceId,
    instanceLookup,
    surfaceLookup,
    depth: new Float64Array(cells.depth),
    shade: cells.shade ? new Float32Array(cells.shade) : new Float32Array(n).fill(NaN),
    normal: cells.normal ? new Float32Array(cells.normal) : new Float32Array(n * 3).fill(NaN),
    worldPosition: cells.worldPosition ? new Float32Array(cells.worldPosition) : new Float32Array(n * 3).fill(NaN),
    surfaceUv: cells.surfaceUv ? new Float32Array(cells.surfaceUv) : new Float32Array(n * 2).fill(NaN),
    metadata,
  };
}
