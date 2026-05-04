/**
 * Minimal glTF 2.0 / GLB loader — extracts triangle meshes (positions +
 * indices + per-material color) into polycss polygons. Skips animations,
 * skins, skeletons, PBR-extras textures: the goal is to render the static
 * surface, not be a complete glTF runtime.
 *
 * Supports both .glb (binary container with magic "glTF") and .gltf (JSON
 * with separate .bin) — for .gltf the caller must supply the buffers via
 * the `resolveBuffer` callback.
 *
 * For each mesh primitive we:
 *   1. Read the POSITION accessor → Vec3[] of vertex positions.
 *   2. Read the indices accessor → triangle index array.
 *   3. Pick the material's pbrMetallicRoughness.baseColorFactor as a
 *      sRGB color, fall back to the override or palette if missing.
 *   4. Emit one triangle Polygon per (i, i+1, i+2).
 *
 * After parsing, the mesh is uniformly scaled to fit `targetSize` units
 * and the y/z axes are cyclically permuted (so glTF's +Y-up becomes
 * polycss's +Z-up without inverting handedness — a single y↔z swap would
 * flip every triangle's winding and break backface culling).
 */
import type { Polygon, Vec2, Vec3 } from "../types";
import type { ParseResult } from "./types";

export interface GltfParseOptions {
  /** Largest mesh extent (units). Mesh is uniformly scaled to fit. Default 60. */
  targetSize?: number;
  /** Padding offset (avoids coordinate "0"). Default 1. */
  gridShift?: number;
  /** Color used when a primitive has no material or no baseColorFactor. */
  defaultColor?: string;
  /**
   * Override map: glTF material name → CSS color string. Falls back to the
   * material's `pbrMetallicRoughness.baseColorFactor` if not in this map.
   */
  materialColors?: Record<string, string>;
  /**
   * Which axis is "up" in the source mesh.
   *  - "y" (default, glTF spec): cyclic permutation (x,y,z) → (z,x,y) so
   *    +Y ends up on polycss's +Z (elevation).
   *  - "z" (Blender-style, FBX2glTF often emits this): identity, no swap.
   * Pick "z" if the model lands on its side / lies down instead of
   * standing.
   */
  upAxis?: "y" | "z";
  /**
   * For .gltf (non-binary) — resolve a glTF buffer URI to its bytes. The
   * built-in parser handles GLB binary chunks natively; .gltf files with
   * external .bin files need this.
   */
  resolveBuffer?: (uri: string) => Promise<Uint8Array> | Uint8Array;
  /**
   * Base URL the source file lives at. Used to resolve external image URIs
   * (`doc.images[i].uri = "Textures/foo.png"`) against the GLB/glTF's
   * location. Without this, relative URIs would resolve against the page,
   * which 404s. Pass the same URL you fetched the file from.
   */
  baseUrl?: string;
}

const GLB_MAGIC = 0x46546c67; // "glTF" little-endian
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENT_BYTES: Record<number, number> = {
  5120: 1, // BYTE
  5121: 1, // UNSIGNED_BYTE
  5122: 2, // SHORT
  5123: 2, // UNSIGNED_SHORT
  5125: 4, // UNSIGNED_INT
  5126: 4, // FLOAT
};

const TYPE_COUNT: Record<string, number> = {
  SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16,
};

interface GltfAccessor {
  bufferView: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
}
interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}
interface GltfTextureInfo {
  index: number; // index into doc.textures[]
}
interface GltfMaterial {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    baseColorTexture?: GltfTextureInfo;
  };
}
interface GltfImage {
  uri?: string;
  bufferView?: number;
  mimeType?: string;
}
interface GltfTexture {
  source?: number; // index into doc.images[]
}
interface GltfPrimitive {
  attributes: { POSITION: number;[k: string]: number };
  indices?: number;
  material?: number;
  /** glTF mode: 4 = TRIANGLES, 5 = TRIANGLE_STRIP, 6 = TRIANGLE_FAN. We only handle 4. */
  mode?: number;
}
interface GltfMesh {
  name?: string;
  primitives: GltfPrimitive[];
}
interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  /** TRS — polycss reads either matrix or these three components. */
  matrix?: number[];
  translation?: number[];
  rotation?: number[]; // quaternion (x, y, z, w)
  scale?: number[];
}
interface GltfScene {
  nodes?: number[];
}
interface GltfDoc {
  scene?: number;
  scenes?: GltfScene[];
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  materials?: GltfMaterial[];
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  buffers?: { byteLength: number; uri?: string }[];
  images?: GltfImage[];
  textures?: GltfTexture[];
}

function decodeUtf8(bytes: Uint8Array): string {
  const Decoder = (globalThis as unknown as { TextDecoder: new () => { decode: (a: Uint8Array) => string } }).TextDecoder;
  return new Decoder().decode(bytes);
}

/**
 * Decode a base64-encoded `data:` URI to bytes. glTF JSON files often embed
 * the buffer this way (`data:application/octet-stream;base64,...`).
 */
function dataUriToBytes(uri: string): Uint8Array {
  const comma = uri.indexOf(",");
  if (comma < 0) throw new Error("parseGltf: malformed data: URI");
  const meta = uri.slice(5, comma); // strip "data:"
  const payload = uri.slice(comma + 1);
  if (!meta.includes(";base64")) {
    const text = decodeURIComponent(payload);
    const out = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
    return out;
  }
  const bin = (globalThis as unknown as { atob: (s: string) => string }).atob(payload);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function resolveJsonBuffer(
  doc: GltfDoc,
  resolveBuffer?: (uri: string) => Uint8Array | Promise<Uint8Array>,
): Uint8Array {
  const buf = doc.buffers?.[0];
  if (!buf) throw new Error("parseGltf: JSON doc has no buffers[0]");
  const uri = buf.uri;
  if (!uri) throw new Error("parseGltf: JSON doc buffer has no uri (and there's no GLB BIN chunk)");
  if (uri.startsWith("data:")) return dataUriToBytes(uri);
  if (resolveBuffer) {
    const result = resolveBuffer(uri);
    if (result instanceof Uint8Array) return result;
    throw new Error("parseGltf: resolveBuffer returned a Promise; use parseGltf via async if your buffers are external");
  }
  throw new Error(`parseGltf: external buffer URI "${uri}" — provide options.resolveBuffer`);
}

function parseGlbContainer(buf: ArrayBuffer): { doc: GltfDoc; bin: Uint8Array | null } {
  const view = new DataView(buf);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error("parseGltf: not a GLB (bad magic)");
  const version = view.getUint32(4, true);
  if (version !== 2) throw new Error(`parseGltf: only glTF v2 supported (got v${version})`);

  let offset = 12;
  let doc: GltfDoc | null = null;
  let bin: Uint8Array | null = null;
  while (offset < buf.byteLength) {
    const len = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === CHUNK_JSON) {
      const bytes = new Uint8Array(buf, start, len);
      doc = JSON.parse(decodeUtf8(bytes));
    } else if (type === CHUNK_BIN) {
      bin = new Uint8Array(buf, start, len);
    }
    offset = start + len;
  }
  if (!doc) throw new Error("parseGltf: no JSON chunk in GLB");
  return { doc, bin };
}

function readAccessor(doc: GltfDoc, bin: Uint8Array, accessorIdx: number): {
  array: Float32Array | Uint16Array | Uint32Array | Uint8Array;
  count: number;
  componentCount: number;
} {
  const acc = doc.accessors?.[accessorIdx];
  const view = doc.bufferViews?.[acc?.bufferView ?? -1];
  if (!acc || !view) throw new Error(`parseGltf: bad accessor/bufferView ${accessorIdx}`);
  const bytesPerComponent = COMPONENT_BYTES[acc.componentType];
  const componentCount = TYPE_COUNT[acc.type];
  if (!bytesPerComponent || !componentCount) {
    throw new Error(`parseGltf: unsupported accessor type ${acc.type}/${acc.componentType}`);
  }
  const offset = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const elements = acc.count * componentCount;
  const slice = bin.buffer.slice(bin.byteOffset + offset, bin.byteOffset + offset + elements * bytesPerComponent);

  let array: Float32Array | Uint16Array | Uint32Array | Uint8Array;
  switch (acc.componentType) {
    case 5126: array = new Float32Array(slice); break;
    case 5123: array = new Uint16Array(slice); break;
    case 5125: array = new Uint32Array(slice); break;
    case 5121: array = new Uint8Array(slice); break;
    default: throw new Error(`parseGltf: unhandled componentType ${acc.componentType}`);
  }
  return { array, count: acc.count, componentCount };
}

function extractImageUrls(
  doc: GltfDoc,
  bin: Uint8Array,
  baseUrl?: string,
): { urls: string[]; objectUrls: string[] } {
  const urls: string[] = [];
  const objectUrls: string[] = [];
  const g = globalThis as unknown as {
    Blob: new (parts: ArrayLike<number>[] | Uint8Array[], opts?: { type?: string }) => unknown;
    URL: { createObjectURL: (b: unknown) => string; new (u: string, base?: string): { href: string } };
  };
  for (const img of doc.images ?? []) {
    if (img.uri) {
      if (baseUrl && !img.uri.startsWith("data:")) {
        try {
          urls.push(new g.URL(img.uri, baseUrl).href);
        } catch {
          urls.push(img.uri);
        }
      } else {
        urls.push(img.uri);
      }
      continue;
    }
    if (img.bufferView !== undefined) {
      const bv = doc.bufferViews?.[img.bufferView];
      if (!bv) { urls.push(""); continue; }
      const offset = bv.byteOffset ?? 0;
      const bytes = bin.subarray(offset, offset + bv.byteLength);
      const mime = img.mimeType ?? "image/png";
      const blob = new g.Blob([bytes], { type: mime });
      const url = g.URL.createObjectURL(blob);
      urls.push(url);
      objectUrls.push(url);
    } else {
      urls.push("");
    }
  }
  return { urls, objectUrls };
}

function buildMaterialTextureMap(doc: GltfDoc, imageUrls: string[]): Map<number, string> {
  const out = new Map<number, string>();
  const mats = doc.materials ?? [];
  for (let i = 0; i < mats.length; i++) {
    const texIdx = mats[i].pbrMetallicRoughness?.baseColorTexture?.index;
    if (texIdx === undefined) continue;
    const sourceIdx = doc.textures?.[texIdx]?.source;
    if (sourceIdx === undefined) continue;
    const url = imageUrls[sourceIdx];
    if (url) out.set(i, url);
  }
  return out;
}

function colorFromMaterial(mat: GltfMaterial | undefined, fallback: string): string {
  const c = mat?.pbrMetallicRoughness?.baseColorFactor;
  if (!c || c.length < 3) return fallback;
  const to = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, "0");
  return `#${to(c[0])}${to(c[1])}${to(c[2])}`;
}

// ── Node transform math ─────────────────────────────────────────────────

type Mat4 = number[]; // length 16, column-major like glTF

const IDENTITY4: Mat4 = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];

function mulMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array(16) as Mat4;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      out[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8]  * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9]  * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

function trsToMat4(t?: number[], r?: number[], s?: number[]): Mat4 {
  const tx = t?.[0] ?? 0, ty = t?.[1] ?? 0, tz = t?.[2] ?? 0;
  const qx = r?.[0] ?? 0, qy = r?.[1] ?? 0, qz = r?.[2] ?? 0, qw = r?.[3] ?? 1;
  const sx = s?.[0] ?? 1, sy = s?.[1] ?? 1, sz = s?.[2] ?? 1;

  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;

  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx,       (xz - wy) * sx,       0,
    (xy - wz) * sy,       (1 - (xx + zz)) * sy, (yz + wx) * sy,       0,
    (xz + wy) * sz,       (yz - wx) * sz,       (1 - (xx + yy)) * sz, 0,
    tx,                   ty,                   tz,                   1,
  ];
}

function nodeLocalMatrix(n: GltfNode): Mat4 {
  if (n.matrix && n.matrix.length === 16) return n.matrix.slice() as Mat4;
  return trsToMat4(n.translation, n.rotation, n.scale);
}

export function parseGltf(input: ArrayBuffer | Uint8Array, options?: GltfParseOptions): ParseResult {
  const targetSize = options?.targetSize ?? 60;
  const gridShift = options?.gridShift ?? 1;
  const defaultColor = options?.defaultColor ?? "#888888";
  const materialOverrides = options?.materialColors ?? {};

  const buf: ArrayBuffer = input instanceof Uint8Array
    ? input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer
    : input;
  const sourceBytes = buf.byteLength;

  let doc: GltfDoc;
  let bin: Uint8Array;
  if (buf.byteLength >= 4 && new DataView(buf).getUint32(0, true) === GLB_MAGIC) {
    const parsed = parseGlbContainer(buf);
    doc = parsed.doc;
    if (!parsed.bin) throw new Error("parseGltf: GLB has no binary chunk");
    bin = parsed.bin;
  } else {
    doc = JSON.parse(decodeUtf8(new Uint8Array(buf)));
    bin = resolveJsonBuffer(doc, options?.resolveBuffer);
  }

  const { urls: imageUrls, objectUrls } = extractImageUrls(doc, bin, options?.baseUrl);
  const matTexMap = buildMaterialTextureMap(doc, imageUrls);

  interface RawTri { v0: Vec3; v1: Vec3; v2: Vec3; color: string; texture?: string; uvs?: Vec2[]; }
  const rawTris: RawTri[] = [];
  const meshNames: string[] = (doc.meshes ?? []).map((m, i) => m.name ?? `mesh_${i}`);
  const materialNames: string[] = (doc.materials ?? []).map((m, i) => m.name ?? `material_${i}`);

  function emitMesh(meshIdx: number, world: Mat4): void {
    const mesh = doc.meshes?.[meshIdx];
    if (!mesh) return;
    for (const prim of mesh.primitives) {
      const mode = prim.mode ?? 4;
      if (mode !== 4) continue;

      const matName = prim.material !== undefined ? doc.materials?.[prim.material]?.name : undefined;
      const matOverride = matName ? materialOverrides[matName] : undefined;
      const color = matOverride ?? colorFromMaterial(
        prim.material !== undefined ? doc.materials?.[prim.material] : undefined,
        defaultColor
      );
      const texture = prim.material !== undefined ? matTexMap.get(prim.material) : undefined;

      const { array: posArr, count: vertCount } = readAccessor(doc, bin!, prim.attributes.POSITION);
      if (!(posArr instanceof Float32Array)) continue;
      const positions: Vec3[] = [];
      for (let i = 0; i < vertCount; i++) {
        const local: Vec3 = [posArr[i * 3], posArr[i * 3 + 1], posArr[i * 3 + 2]];
        positions.push(transformPoint(world, local));
      }

      let uvs: Vec2[] | null = null;
      const uvAccIdx = prim.attributes.TEXCOORD_0;
      if (texture && uvAccIdx !== undefined) {
        const { array: uvArr, count: uvCount } = readAccessor(doc, bin!, uvAccIdx);
        uvs = [];
        let scale = 1;
        if (uvArr instanceof Uint8Array) scale = 1 / 255;
        else if (uvArr instanceof Uint16Array) scale = 1 / 65535;
        for (let i = 0; i < uvCount; i++) {
          const u = uvArr[i * 2] * scale;
          const v = uvArr[i * 2 + 1] * scale;
          uvs.push([u, 1 - v]);
        }
      }

      let indices: number[];
      if (prim.indices !== undefined) {
        const { array: idxArr, count: idxCount } = readAccessor(doc, bin!, prim.indices);
        indices = [];
        for (let i = 0; i < idxCount; i++) indices.push(Number(idxArr[i]));
      } else {
        indices = positions.map((_, i) => i);
      }

      for (let i = 0; i + 2 < indices.length; i += 3) {
        const v0 = positions[indices[i]];
        const v1 = positions[indices[i + 1]];
        const v2 = positions[indices[i + 2]];
        if (!v0 || !v1 || !v2) continue;
        let triUvs: Vec2[] | undefined;
        if (uvs && texture) {
          const u0 = uvs[indices[i]], u1 = uvs[indices[i + 1]], u2 = uvs[indices[i + 2]];
          if (u0 && u1 && u2) triUvs = [u0, u1, u2];
        }
        rawTris.push({ v0, v1, v2, color, texture, uvs: triUvs });
      }
    }
  }

  function walkNode(nodeIdx: number, parentWorld: Mat4): void {
    const node = doc.nodes?.[nodeIdx];
    if (!node) return;
    const world = mulMat4(parentWorld, nodeLocalMatrix(node));
    if (typeof node.mesh === "number") emitMesh(node.mesh, world);
    for (const child of node.children ?? []) walkNode(child, world);
  }

  const sceneIdx = doc.scene ?? 0;
  const sceneRoots = doc.scenes?.[sceneIdx]?.nodes;
  if (sceneRoots && sceneRoots.length > 0) {
    for (const r of sceneRoots) walkNode(r, IDENTITY4);
  } else {
    for (let i = 0; i < (doc.meshes?.length ?? 0); i++) emitMesh(i, IDENTITY4);
  }

  const dispose = makeDispose(objectUrls);

  if (rawTris.length === 0) {
    return {
      polygons: [],
      objectUrls,
      dispose,
      warnings: [],
      metadata: {
        triangleCount: 0,
        meshes: meshNames,
        materials: materialNames,
        sourceBytes,
      },
    };
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const t of rawTris) {
    for (const v of [t.v0, t.v1, t.v2]) {
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }
  }
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  const scale = maxDim > 0 ? targetSize / maxDim : 1;

  const round = (n: number) => Math.round(n * 1000) / 1000;
  const upAxis = options?.upAxis ?? "y";
  const project: (v: Vec3) => Vec3 = upAxis === "z"
    ? ([x, y, z]) => [
        round((x - minX) * scale + gridShift),
        round((y - minY) * scale + gridShift),
        round((z - minZ) * scale + gridShift),
      ]
    : ([x, y, z]) => [
        round((z - minZ) * scale + gridShift),
        round((x - minX) * scale + gridShift),
        round((y - minY) * scale + gridShift),
      ];

  const polygons: Polygon[] = [];
  for (const t of rawTris) {
    const v0 = project(t.v0);
    const v1 = project(t.v1);
    const v2 = project(t.v2);
    if (
      (v0[0] === v1[0] && v0[1] === v1[1] && v0[2] === v1[2]) ||
      (v0[0] === v2[0] && v0[1] === v2[1] && v0[2] === v2[2]) ||
      (v1[0] === v2[0] && v1[1] === v2[1] && v1[2] === v2[2])
    ) continue;
    const p: Polygon = {
      vertices: [v0, v1, v2],
      color: t.color,
    };
    if (t.texture) p.texture = t.texture;
    if (t.uvs) p.uvs = t.uvs;
    polygons.push(p);
  }

  return {
    polygons,
    objectUrls,
    dispose,
    warnings: [],
    metadata: {
      triangleCount: polygons.length,
      meshes: meshNames,
      materials: materialNames,
      sourceBytes,
    },
  };
}

/**
 * Build an idempotent disposer that revokes each minted blob URL exactly
 * once. Subsequent calls are no-ops, so component unmount paths can call
 * `dispose()` defensively without worrying about double-revoke errors.
 */
function makeDispose(objectUrls: string[]): () => void {
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const URL = (globalThis as unknown as { URL?: { revokeObjectURL?: (url: string) => void } }).URL;
    if (!URL?.revokeObjectURL) return;
    for (const url of objectUrls) {
      try { URL.revokeObjectURL(url); } catch { /* swallow — best effort */ }
    }
  };
}
