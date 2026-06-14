/**
 * STL parser. STL is a triangle mesh format only: no standard units,
 * materials, textures, UVs, object hierarchy, or authored up-axis metadata.
 *
 * Supports:
 *  - Binary STL: 80-byte header + uint32 triangle count + 50 bytes/triangle.
 *  - ASCII STL: `facet normal ... outer loop ... vertex ... endfacet`.
 *
 * Triangle connectivity is used to repair inconsistent winding. Closed
 * manifold components are oriented outward; open components with a strong,
 * consistent supplied-normal signal are oriented to those normals before
 * polygons are emitted.
 */
import type { Polygon, Vec3 } from "../types";
import type { ParseResult, ParseStlColor, ParseStlSolid } from "./types";

export interface StlParseOptions {
  /** Largest mesh extent (units). Mesh is uniformly scaled to fit. Default: 60. */
  targetSize?: number;
  /** Padding offset added after scaling. Default: 1. */
  gridShift?: number;
  /** Solid color assigned to every STL triangle. Default: "#888888". */
  defaultColor?: string;
  /**
   * Which axis is "up" in the source mesh.
   *  - "z" (default): identity axes, matching common CAD/3D-print STL exports.
   *  - "y": cyclic permutation (x,y,z) → (z,x,y), matching OBJ/glTF's +Y-up path.
   */
  upAxis?: "z" | "y";
}

interface RawFacet {
  vertices: [Vec3, Vec3, Vec3];
  normal: Vec3 | null;
  color?: string;
  solidName?: string;
  hasIgnoredNormal?: boolean;
  hasIgnoredAttribute?: boolean;
}

interface ParsedStl {
  format: "ascii" | "binary";
  facets: RawFacet[];
  binaryHeader?: string;
  color?: ParseStlColor;
}

const DEFAULT_COLOR = "#888888";
const NORMAL_EPS = 1e-8;
const NORMAL_DOT_TOLERANCE = 0.95;
const WINDING_VOLUME_EPS = 1e-10;
const SUPPLIED_NORMAL_ORIENT_MIN_FACETS = 8;
const SUPPLIED_NORMAL_ORIENT_MIN_COVERAGE = 0.75;
const SUPPLIED_NORMAL_ORIENT_RATIO = 0.9;
const ASCII_NUMBER_RE = /^[+-]?(?:(?:\d+\.?\d*)|(?:\.\d+))(?:[eE][+-]?\d+)?$/;
const MAGICS_COLOR_MARKER = "COLOR=";

function finiteNumberOption(name: string, value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved)) throw new Error(`parseStl: ${name} must be finite`);
  return resolved;
}

function positiveNumberOption(name: string, value: number | undefined, fallback: number): number {
  const resolved = finiteNumberOption(name, value, fallback);
  if (resolved <= 0) throw new Error(`parseStl: ${name} must be greater than 0`);
  return resolved;
}

function upAxisOption(value: StlParseOptions["upAxis"] | undefined): "z" | "y" {
  if (value === undefined || value === "z" || value === "y") return value ?? "z";
  throw new Error('parseStl: upAxis must be "z" or "y"');
}

function colorOption(value: string | undefined): string {
  const resolved = value ?? DEFAULT_COLOR;
  if (typeof resolved !== "string" || resolved.trim().length === 0) {
    throw new Error("parseStl: defaultColor must be a non-empty string");
  }
  return resolved;
}

function sourceToBytes(source: ArrayBuffer | Uint8Array | string): Uint8Array | null {
  if (typeof source === "string") return null;
  if (source instanceof Uint8Array) {
    return new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
  }
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  throw new Error("parseStl: source must be an ArrayBuffer, Uint8Array, or ASCII string");
}

function decodeUtf8(bytes: Uint8Array): string {
  const Decoder = (globalThis as unknown as { TextDecoder: new () => { decode: (a: Uint8Array) => string } }).TextDecoder;
  return new Decoder().decode(bytes);
}

function readVec3(view: DataView, offset: number): Vec3 {
  return [
    view.getFloat32(offset, true),
    view.getFloat32(offset + 4, true),
    view.getFloat32(offset + 8, true),
  ];
}

function isFiniteVec3(v: Vec3): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

function parseNumberTriple(text: string): Vec3 | null {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  if (!parts.every((part) => ASCII_NUMBER_RE.test(part))) return null;
  const value: Vec3 = [
    Number(parts[0]),
    Number(parts[1]),
    Number(parts[2]),
  ];
  return isFiniteVec3(value) ? value : null;
}

function decodeBinaryHeader(bytes: Uint8Array): string | undefined {
  let text = "";
  for (const byte of bytes) {
    if (byte === 0) continue;
    text += byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : " ";
  }
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed || undefined;
}

function hexByte(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}

function cssColorFromBytes(r: number, g: number, b: number, alphaByte = 255): string {
  if (alphaByte >= 255) return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
  const alpha = Math.round((alphaByte / 255) * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function fiveBitToByte(value: number): number {
  return Math.round((value / 31) * 255);
}

interface MagicsColorHeader {
  defaultColor: string;
  alpha: number;
  alphaByte: number;
}

function parseMagicsColorHeader(view: DataView): MagicsColorHeader | null {
  for (let offset = 0; offset < 80 - MAGICS_COLOR_MARKER.length - 4; offset += 1) {
    let matched = true;
    for (let index = 0; index < MAGICS_COLOR_MARKER.length; index += 1) {
      if (view.getUint8(offset + index) !== MAGICS_COLOR_MARKER.charCodeAt(index)) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    const r = view.getUint8(offset + MAGICS_COLOR_MARKER.length);
    const g = view.getUint8(offset + MAGICS_COLOR_MARKER.length + 1);
    const b = view.getUint8(offset + MAGICS_COLOR_MARKER.length + 2);
    const alphaByte = view.getUint8(offset + MAGICS_COLOR_MARKER.length + 3);
    return {
      defaultColor: cssColorFromBytes(r, g, b, alphaByte),
      alpha: Math.round((alphaByte / 255) * 1000) / 1000,
      alphaByte,
    };
  }
  return null;
}

function magicsFacetColor(attributeByteCount: number, header: MagicsColorHeader): {
  color: string;
  usesDefaultColor: boolean;
} {
  if ((attributeByteCount & 0x8000) !== 0) {
    return { color: header.defaultColor, usesDefaultColor: true };
  }
  const r = fiveBitToByte(attributeByteCount & 0x1f);
  const g = fiveBitToByte((attributeByteCount >> 5) & 0x1f);
  const b = fiveBitToByte((attributeByteCount >> 10) & 0x1f);
  return {
    color: cssColorFromBytes(r, g, b, header.alphaByte),
    usesDefaultColor: false,
  };
}

interface SolidEvent {
  index: number;
  kind: "start" | "end";
  name?: string;
}

function collectAsciiSolidEvents(text: string): SolidEvent[] {
  const events: SolidEvent[] = [];
  const solidRe = /^\s*solid(?:\s+([^\r\n]*?))?\s*$/gim;
  const endSolidRe = /^\s*endsolid\b[^\r\n]*$/gim;
  let match: RegExpExecArray | null;
  while ((match = solidRe.exec(text))) {
    events.push({
      index: match.index,
      kind: "start",
      name: (match[1] ?? "").trim(),
    });
  }
  while ((match = endSolidRe.exec(text))) {
    events.push({ index: match.index, kind: "end" });
  }
  return events.sort((a, b) => a.index - b.index || (a.kind === "end" ? -1 : 1));
}

interface BinaryStlLayout {
  triangleCount: number;
  declaredTriangleCount: number;
  trailingBytes: number;
}

function hasBinaryPayload(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.byteLength, 1024);
  for (let index = 84; index < end; index += 1) {
    const byte = bytes[index];
    if (byte === 0 || (byte < 9 || (byte > 13 && byte < 32) || byte > 126)) return true;
  }
  return false;
}

function looksAsciiStl(bytes: Uint8Array): boolean {
  const prefix = decodeUtf8(bytes.subarray(0, Math.min(bytes.byteLength, 512))).trimStart().toLowerCase();
  if (!prefix.startsWith("solid") && !prefix.startsWith("facet")) return false;
  return !hasBinaryPayload(bytes);
}

function binaryStlLayout(bytes: Uint8Array): BinaryStlLayout | null {
  if (bytes.byteLength < 84) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declaredTriangleCount = view.getUint32(80, true);
  const declaredBytes = 84 + declaredTriangleCount * 50;
  if (declaredBytes === bytes.byteLength) {
    return { triangleCount: declaredTriangleCount, declaredTriangleCount, trailingBytes: 0 };
  }
  if (looksAsciiStl(bytes)) return null;
  if (declaredBytes < bytes.byteLength) {
    return {
      triangleCount: declaredTriangleCount,
      declaredTriangleCount,
      trailingBytes: bytes.byteLength - declaredBytes,
    };
  }
  const completePayloadBytes = bytes.byteLength - 84;
  if (completePayloadBytes > 0 && completePayloadBytes % 50 === 0) {
    return {
      triangleCount: completePayloadBytes / 50,
      declaredTriangleCount,
      trailingBytes: 0,
    };
  }
  return null;
}

function parseBinaryStl(bytes: Uint8Array, layout: BinaryStlLayout, warnings: string[]): ParsedStl {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { triangleCount, declaredTriangleCount, trailingBytes } = layout;
  if (declaredTriangleCount !== triangleCount) {
    warnings.push(
      `parseStl: binary STL declared ${declaredTriangleCount} triangles but contains ${triangleCount} complete triangle record${triangleCount === 1 ? "" : "s"}`,
    );
  }
  if (trailingBytes > 0) {
    warnings.push(`parseStl: ignored ${trailingBytes} trailing binary byte${trailingBytes === 1 ? "" : "s"}`);
  }

  const binaryHeader = decodeBinaryHeader(bytes.subarray(0, 80));
  const magicsColor = parseMagicsColorHeader(view);
  let coloredTriangleCount = 0;
  let defaultColorTriangleCount = 0;
  const facets: RawFacet[] = [];
  for (let index = 0, offset = 84; index < triangleCount; index += 1, offset += 50) {
    const normal = readVec3(view, offset);
    const vertices: [Vec3, Vec3, Vec3] = [
      readVec3(view, offset + 12),
      readVec3(view, offset + 24),
      readVec3(view, offset + 36),
    ];
    if (!vertices.every(isFiniteVec3)) {
      throw new Error(`parseStl: non-finite coordinate in binary triangle ${index}`);
    }
    const attributeByteCount = view.getUint16(offset + 48, true);
    const magicsColorResult = magicsColor ? magicsFacetColor(attributeByteCount, magicsColor) : null;
    if (magicsColorResult) {
      if (magicsColorResult.usesDefaultColor) defaultColorTriangleCount += 1;
      else coloredTriangleCount += 1;
    }
    facets.push({
      normal: isFiniteVec3(normal) ? normal : null,
      hasIgnoredNormal: !isFiniteVec3(normal),
      color: magicsColorResult?.color,
      vertices,
      hasIgnoredAttribute: !magicsColor && attributeByteCount !== 0,
    });
  }

  return {
    format: "binary",
    facets,
    binaryHeader,
    color: magicsColor
      ? {
        format: "magics",
        defaultColor: magicsColor.defaultColor,
        alpha: magicsColor.alpha,
        coloredTriangleCount,
        defaultColorTriangleCount,
      }
      : undefined,
  };
}

function parseAsciiStl(text: string, warnings: string[]): ParsedStl {
  const facets: RawFacet[] = [];
  const facetRe = /^\s*facet\s+normal\s+([^\r\n]+)([\s\S]*?)^\s*endfacet\b[^\r\n]*$/gim;
  const vertexRe = /^\s*vertex\s+([^\r\n]+)/gim;
  const facetStartRe = /^\s*facet\s+normal\b/gim;
  const solidEvents = collectAsciiSolidEvents(text);
  let solidEventCursor = 0;
  let currentSolidName: string | undefined;
  let declaredFacetCount = 0;
  while (facetStartRe.exec(text)) declaredFacetCount += 1;

  let matchedFacetCount = 0;
  let malformedFacetCount = 0;
  let ignoredNormalCount = 0;
  let match: RegExpExecArray | null;
  while ((match = facetRe.exec(text))) {
    matchedFacetCount += 1;
    while (solidEventCursor < solidEvents.length && solidEvents[solidEventCursor].index < match.index) {
      const event = solidEvents[solidEventCursor];
      currentSolidName = event.kind === "start" ? event.name : undefined;
      solidEventCursor += 1;
    }
    const normal = parseNumberTriple(match[1]);
    if (!normal) ignoredNormalCount += 1;
    const vertices: Vec3[] = [];
    let malformedFacet = false;
    vertexRe.lastIndex = 0;
    let vertexMatch: RegExpExecArray | null;
    while ((vertexMatch = vertexRe.exec(match[2]))) {
      const vertex = parseNumberTriple(vertexMatch[1]);
      if (!vertex) {
        malformedFacet = true;
        break;
      }
      vertices.push(vertex);
    }
    if (malformedFacet || vertices.length !== 3) {
      malformedFacetCount += 1;
      continue;
    }
    facets.push({
      normal,
      hasIgnoredNormal: !normal,
      solidName: currentSolidName,
      vertices: [vertices[0], vertices[1], vertices[2]],
    });
  }

  malformedFacetCount += Math.max(0, declaredFacetCount - matchedFacetCount);
  if (malformedFacetCount > 0) {
    warnings.push(`parseStl: skipped ${malformedFacetCount} malformed ASCII facet${malformedFacetCount === 1 ? "" : "s"}`);
  }
  if (ignoredNormalCount > 0) {
    warnings.push(`parseStl: ignored ${ignoredNormalCount} malformed ASCII facet normal${ignoredNormalCount === 1 ? "" : "s"}`);
  }

  return { format: "ascii", facets };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function isDegenerate(vertices: [Vec3, Vec3, Vec3]): boolean {
  const areaNormal = cross(sub(vertices[1], vertices[0]), sub(vertices[2], vertices[0]));
  return length(areaNormal) <= NORMAL_EPS;
}

function normalizeVector(v: Vec3): Vec3 | null {
  const len = length(v);
  if (len <= NORMAL_EPS) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function vertexKey(v: Vec3): string {
  const clean = (n: number): number => (Object.is(n, -0) ? 0 : n);
  return `${clean(v[0])},${clean(v[1])},${clean(v[2])}`;
}

function edgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

interface EdgeOccurrence {
  facetIndex: number;
  from: string;
  to: string;
}

interface WindingComponent {
  facets: number[];
  conflicts: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  flippedOutward: boolean;
  flippedToSuppliedNormals: boolean;
}

function verticesForFacet(facet: RawFacet, flipped: boolean): [Vec3, Vec3, Vec3] {
  return flipped
    ? [facet.vertices[0], facet.vertices[2], facet.vertices[1]]
    : facet.vertices;
}

function signedComponentVolume(facets: RawFacet[], component: WindingComponent, flips: boolean[]): number {
  let volume = 0;
  for (const facetIndex of component.facets) {
    const [a, b, c] = verticesForFacet(facets[facetIndex], flips[facetIndex]);
    volume += dot(a, cross(b, c)) / 6;
  }
  return volume;
}

function suppliedNormalOrientation(facets: RawFacet[], component: WindingComponent, flips: boolean[]): "aligned" | "opposed" | null {
  if (component.facets.length < SUPPLIED_NORMAL_ORIENT_MIN_FACETS) return null;

  let aligned = 0;
  let opposed = 0;
  for (const facetIndex of component.facets) {
    const facet = facets[facetIndex];
    const supplied = facet.normal ? normalizeVector(facet.normal) : null;
    if (!supplied) continue;

    const vertices = verticesForFacet(facet, flips[facetIndex]);
    const computed = normalizeVector(cross(sub(vertices[1], vertices[0]), sub(vertices[2], vertices[0])));
    if (!computed) continue;

    const normalDot = dot(computed, supplied);
    if (normalDot >= NORMAL_DOT_TOLERANCE) aligned += 1;
    else if (normalDot <= -NORMAL_DOT_TOLERANCE) opposed += 1;
  }

  const usable = aligned + opposed;
  if (usable / component.facets.length < SUPPLIED_NORMAL_ORIENT_MIN_COVERAGE) return null;
  if (opposed / usable >= SUPPLIED_NORMAL_ORIENT_RATIO) return "opposed";
  if (aligned / usable >= SUPPLIED_NORMAL_ORIENT_RATIO) return "aligned";
  return null;
}

function repairStlWinding(facets: RawFacet[]): {
  facets: RawFacet[];
  repairedCount: number;
  componentCount: number;
  outwardComponentCount: number;
  suppliedNormalComponentCount: number;
  conflictCount: number;
  nonManifoldEdgeCount: number;
} {
  const edgeMap = new Map<string, EdgeOccurrence[]>();
  const adjacency: Array<Array<{ to: number; flipDiffers: boolean }>> = facets.map(() => []);

  for (let facetIndex = 0; facetIndex < facets.length; facetIndex += 1) {
    const keys = facets[facetIndex].vertices.map(vertexKey);
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex += 1) {
      const from = keys[edgeIndex];
      const to = keys[(edgeIndex + 1) % 3];
      const key = edgeKey(from, to);
      const occurrences = edgeMap.get(key);
      const occurrence = { facetIndex, from, to };
      if (occurrences) occurrences.push(occurrence);
      else edgeMap.set(key, [occurrence]);
    }
  }

  let nonManifoldEdgeCount = 0;
  for (const occurrences of edgeMap.values()) {
    if (occurrences.length > 2) nonManifoldEdgeCount += 1;
    if (occurrences.length < 2) continue;
    const [anchor, ...rest] = occurrences;
    for (const occurrence of rest) {
      const sameDirection = anchor.from === occurrence.from && anchor.to === occurrence.to;
      adjacency[anchor.facetIndex].push({ to: occurrence.facetIndex, flipDiffers: sameDirection });
      adjacency[occurrence.facetIndex].push({ to: anchor.facetIndex, flipDiffers: sameDirection });
    }
  }

  const flips = new Array<boolean>(facets.length).fill(false);
  const componentIds = new Array<number>(facets.length).fill(-1);
  const components: WindingComponent[] = [];
  let conflictCount = 0;

  for (let start = 0; start < facets.length; start += 1) {
    if (componentIds[start] >= 0) continue;
    const componentId = components.length;
    const component: WindingComponent = {
      facets: [],
      conflicts: 0,
      boundaryEdges: 0,
      nonManifoldEdges: 0,
      flippedOutward: false,
      flippedToSuppliedNormals: false,
    };
    components.push(component);
    componentIds[start] = componentId;
    const queue = [start];

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const facetIndex = queue[cursor];
      component.facets.push(facetIndex);
      for (const edge of adjacency[facetIndex]) {
        const expectedFlip = flips[facetIndex] !== edge.flipDiffers;
        if (componentIds[edge.to] < 0) {
          componentIds[edge.to] = componentId;
          flips[edge.to] = expectedFlip;
          queue.push(edge.to);
        } else if (flips[edge.to] !== expectedFlip && facetIndex < edge.to) {
          component.conflicts += 1;
          conflictCount += 1;
        }
      }
    }
  }

  for (const occurrences of edgeMap.values()) {
    const component = components[componentIds[occurrences[0].facetIndex]];
    if (occurrences.length === 1) component.boundaryEdges += 1;
    else if (occurrences.length > 2) component.nonManifoldEdges += 1;
  }

  for (const component of components) {
    if (component.nonManifoldEdges > 0 || component.conflicts > 0) {
      for (const facetIndex of component.facets) flips[facetIndex] = false;
      continue;
    }
    if (component.boundaryEdges > 0) {
      if (suppliedNormalOrientation(facets, component, flips) === "opposed") {
        for (const facetIndex of component.facets) flips[facetIndex] = !flips[facetIndex];
        component.flippedToSuppliedNormals = true;
      }
      continue;
    }
    const volume = signedComponentVolume(facets, component, flips);
    if (volume < -WINDING_VOLUME_EPS) {
      for (const facetIndex of component.facets) flips[facetIndex] = !flips[facetIndex];
      component.flippedOutward = true;
    }
  }

  let repairedCount = 0;
  const repaired = facets.map((facet, facetIndex): RawFacet => {
    if (!flips[facetIndex]) return facet;
    repairedCount += 1;
    return {
      ...facet,
      vertices: verticesForFacet(facet, true),
    };
  });

  return {
    facets: repaired,
    repairedCount,
    componentCount: components.length,
    outwardComponentCount: components.filter((component) => component.flippedOutward).length,
    suppliedNormalComponentCount: components.filter((component) => component.flippedToSuppliedNormals).length,
    conflictCount,
    nonManifoldEdgeCount,
  };
}

function transformVertex(v: Vec3, min: Vec3, scale: number, gridShift: number, upAxis: "z" | "y"): Vec3 {
  const round = (n: number) => Math.round(n * 1000) / 1000;
  if (upAxis === "y") {
    return [
      round((v[2] - min[2]) * scale + gridShift),
      round((v[0] - min[0]) * scale + gridShift),
      round((v[1] - min[1]) * scale + gridShift),
    ];
  }
  return [
    round((v[0] - min[0]) * scale + gridShift),
    round((v[1] - min[1]) * scale + gridShift),
    round((v[2] - min[2]) * scale + gridShift),
  ];
}

function buildStlSolids(facets: RawFacet[]): ParseStlSolid[] | undefined {
  if (facets.every((facet) => facet.solidName === undefined)) return undefined;
  const solids: ParseStlSolid[] = [];
  let activeName = facets[0]?.solidName ?? "";
  let activeStart = 0;
  for (let index = 1; index <= facets.length; index += 1) {
    const nextName = facets[index]?.solidName ?? "";
    if (index < facets.length && nextName === activeName) continue;
    solids.push({
      name: activeName,
      start: activeStart,
      count: index - activeStart,
    });
    activeName = nextName;
    activeStart = index;
  }
  return solids;
}

function uniqueSolidNames(solids: ParseStlSolid[] | undefined): string[] | undefined {
  if (!solids) return undefined;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const solid of solids) {
    if (!solid.name || seen.has(solid.name)) continue;
    seen.add(solid.name);
    names.push(solid.name);
  }
  return names.length > 0 ? names : undefined;
}

export function parseStl(source: ArrayBuffer | Uint8Array | string, options?: StlParseOptions): ParseResult {
  const targetSize = positiveNumberOption("targetSize", options?.targetSize, 60);
  const gridShift = finiteNumberOption("gridShift", options?.gridShift, 1);
  const defaultColor = colorOption(options?.defaultColor);
  const upAxis = upAxisOption(options?.upAxis);
  const warnings: string[] = [];

  const bytes = sourceToBytes(source);
  const sourceBytes = typeof source === "string" ? source.length : bytes!.byteLength;
  if (sourceBytes === 0 || (typeof source === "string" && source.trim().length === 0)) {
    throw new Error("parseStl: empty input");
  }

  const binaryLayout = bytes ? binaryStlLayout(bytes) : null;
  const parsed = typeof source === "string"
    ? parseAsciiStl(source, warnings)
    : binaryLayout
      ? parseBinaryStl(bytes!, binaryLayout, warnings)
      : parseAsciiStl(decodeUtf8(bytes!), warnings);

  let ignoredAttributeCount = 0;
  let ignoredNormalCount = 0;
  let degenerateCount = 0;
  const validFacets: RawFacet[] = [];

  for (const facet of parsed.facets) {
    if (facet.hasIgnoredAttribute) ignoredAttributeCount += 1;
    if (facet.hasIgnoredNormal && parsed.format === "binary") ignoredNormalCount += 1;
    if (isDegenerate(facet.vertices)) {
      degenerateCount += 1;
      continue;
    }

    validFacets.push(facet);
  }

  const winding = repairStlWinding(validFacets);
  let normalMismatchCount = 0;
  for (const facet of winding.facets) {
    const computed = normalizeVector(cross(sub(facet.vertices[1], facet.vertices[0]), sub(facet.vertices[2], facet.vertices[0])));
    const supplied = facet.normal ? normalizeVector(facet.normal) : null;
    if (computed && supplied && dot(computed, supplied) < NORMAL_DOT_TOLERANCE) {
      normalMismatchCount += 1;
    }
  }

  if (ignoredAttributeCount > 0) {
    warnings.push(`parseStl: ignored non-zero binary attribute byte count on ${ignoredAttributeCount} triangle${ignoredAttributeCount === 1 ? "" : "s"}`);
  }
  if (ignoredNormalCount > 0) {
    warnings.push(`parseStl: ignored ${ignoredNormalCount} non-finite binary normal${ignoredNormalCount === 1 ? "" : "s"}`);
  }
  if (degenerateCount > 0) {
    warnings.push(`parseStl: skipped ${degenerateCount} degenerate triangle${degenerateCount === 1 ? "" : "s"}`);
  }
  if (winding.repairedCount > 0) {
    warnings.push(`parseStl: repaired winding on ${winding.repairedCount} triangle${winding.repairedCount === 1 ? "" : "s"}`);
  }
  if (winding.outwardComponentCount > 0) {
    warnings.push(`parseStl: oriented ${winding.outwardComponentCount} closed component${winding.outwardComponentCount === 1 ? "" : "s"} outward`);
  }
  if (winding.suppliedNormalComponentCount > 0) {
    warnings.push(`parseStl: oriented ${winding.suppliedNormalComponentCount} open component${winding.suppliedNormalComponentCount === 1 ? "" : "s"} from supplied normals`);
  }
  if (winding.conflictCount > 0) {
    warnings.push(`parseStl: found ${winding.conflictCount} inconsistent shared-edge winding constraint${winding.conflictCount === 1 ? "" : "s"}`);
  }
  if (winding.nonManifoldEdgeCount > 0) {
    warnings.push(`parseStl: found ${winding.nonManifoldEdgeCount} non-manifold shared edge${winding.nonManifoldEdgeCount === 1 ? "" : "s"}`);
  }
  if (normalMismatchCount > 0) {
    warnings.push(`parseStl: ${normalMismatchCount} supplied normal${normalMismatchCount === 1 ? " disagrees" : "s disagree"} with triangle winding`);
  }
  if (validFacets.length === 0) {
    if (parsed.facets.length === 0) throw new Error(`parseStl: no valid ${parsed.format} facets`);
    throw new Error("parseStl: no valid facets after filtering");
  }

  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const facet of winding.facets) {
    for (const vertex of facet.vertices) {
      for (let axis = 0; axis < 3; axis += 1) {
        if (vertex[axis] < min[axis]) min[axis] = vertex[axis];
        if (vertex[axis] > max[axis]) max[axis] = vertex[axis];
      }
    }
  }
  const maxDim = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const scale = maxDim > 0 ? targetSize / maxDim : 1;
  const stlSolids = buildStlSolids(winding.facets);
  const meshes = uniqueSolidNames(stlSolids);

  const polygons: Polygon[] = winding.facets.map((facet) => ({
    vertices: facet.vertices.map((vertex) => transformVertex(vertex, min, scale, gridShift, upAxis)),
    color: facet.color ?? defaultColor,
  }));

  return {
    polygons,
    objectUrls: [],
    dispose: () => { /* no-op: parseStl has no minted blob URLs */ },
    warnings,
    metadata: {
      triangleCount: polygons.length,
      meshes,
      materials: [],
      sourceBytes,
      stlHeader: parsed.binaryHeader,
      stlColor: parsed.color,
      stlSolids,
      stlTopology: {
        componentCount: winding.componentCount,
        repairedTriangleCount: winding.repairedCount,
        outwardComponentCount: winding.outwardComponentCount,
        suppliedNormalComponentCount: winding.suppliedNormalComponentCount,
        inconsistentSharedEdgeCount: winding.conflictCount,
        nonManifoldSharedEdgeCount: winding.nonManifoldEdgeCount,
      },
    },
  };
}
