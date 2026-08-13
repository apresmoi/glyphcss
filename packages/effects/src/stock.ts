import {
  GlyphEffectNoColor,
  GlyphEffectOutputChannel,
  parseGlyphEffectColor,
  type GlyphEffectBlend,
  type GlyphEffectDefinition,
  type GlyphEffectEvaluateContext,
  type GlyphEffectParamSchema,
  type GlyphEffectParamValues,
} from "glyphcss";

export interface GlyphEffectPreset<Schema extends GlyphEffectParamSchema> {
  readonly name: string;
  readonly params: Partial<GlyphEffectParamValues<Schema>>;
}

export interface GlyphStockEffectDefinition<
  Schema extends GlyphEffectParamSchema = GlyphEffectParamSchema,
> extends GlyphEffectDefinition<Schema> {
  readonly label: string;
  readonly description: string;
  readonly defaultBlend: GlyphEffectBlend;
  /** Curated named parameter sets — quick nice-looking starting points. */
  readonly presets?: readonly GlyphEffectPreset<Schema>[];
}

// Exported (alongside a handful of coordinate-resolution internals below) so
// `staticExport.ts`'s build-time baker can construct the same evaluate()
// context shape and reuse the real surface-basis math instead of copying it.
export type AnyParams = Record<string, number | string | boolean>;
export type AnyContext<P extends AnyParams> = GlyphEffectEvaluateContext<P, undefined>;

const GLYPH = GlyphEffectOutputChannel.Glyph;
const COLOR = GlyphEffectOutputChannel.Color;

export interface SurfaceMetricAccumulator {
  count: number;
  sumX: number;
  sumY: number;
  sumXX: number;
  sumXY: number;
  sumYY: number;
  sumU: number;
  sumV: number;
  sumXU: number;
  sumYU: number;
  sumXV: number;
  sumYV: number;
  dxDu: number;
  dyDu: number;
  dxDv: number;
  dyDv: number;
  // Covered-cell bounds in the group's own (unfitted) u/v — fieldSynth maps
  // originU/originV into these so origin lands on the visible face instead of
  // an arbitrary world-plane offset. Independent of the fitted dxDu/dyDu
  // metric above (which matrixRain uses for flow direction); adding these
  // does not change any value matrixRain reads.
  minU: number;
  maxU: number;
  minV: number;
  maxV: number;
}

export interface GeneratedSurfaceField {
  readonly normal: object;
  readonly cols: number;
  readonly rows: number;
  readonly worldToSceneScale: number | undefined;
  readonly coordinate: Float32Array;
  readonly groupIndex: Uint32Array;
  readonly groups: readonly SurfaceMetricAccumulator[];
}

// Exported so a build-time exporter (see `staticExport.ts`) can resolve the
// SAME domain coordinate a mounted effect layer's `evaluate()` reads, instead
// of re-deriving the surface-basis / coplanar-group math by hand.
export type EffectSpace = "auto" | "surface" | "scene" | "object";

// Triplanar blend sharpness for the "object"-space 2D fallback (`scan`,
// `wipe`-adjacent, `flow-text`). Each covered cell projects onto whichever of
// the three axis-aligned planes its face normal most faces, blended by
// `normalize(|n|^TRIPLANAR_K)`. K=4 is the conventional starting point for
// triplanar blending (id-tech/Sequoia-style shaders): K=1 blends across a
// wide band around each 45°-ish normal transition (visible double-vision
// "mush" where two projections disagree), while a much higher K collapses
// toward a hard per-axis seam (the K→∞ limit is a discontinuous 3-way
// nearest-axis pick). K=4 keeps the transition narrow — most cells commit
// fully to one plane — while still blending the handful of cells whose
// normal sits close to a plane diagonal, so there is no visible seam line.
const TRIPLANAR_K = 4;
type EffectDirection = "down" | "up" | "right" | "left";
const GENERATED_SURFACE_PITCH = 4;
const generatedSurfaceFieldCache = new WeakMap<object, GeneratedSurfaceField>();

function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function hash2(a: number, b: number): number {
  let hash = Math.imul((a | 0) + 1, -1640531527) ^ Math.imul((b | 0) + 1, -2048144789);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function hashUnit(a: number, b: number): number {
  return hash2(a, b) / 0x1_0000_0000;
}

const glyphPatternCache = new Map<string, string[]>();
const NON_CELL_CODE_POINT = /[\p{Cc}\p{Cf}\p{M}\p{Zl}\p{Zp}]/u;

function isWideBmpCodePoint(code: number): boolean {
  return code >= 0x1100 && (
    code <= 0x115f || code === 0x2329 || code === 0x232a ||
    (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

function parseGlyphPattern(value: string): string[] {
  const cached = glyphPatternCache.get(value);
  if (cached) return cached;
  const glyphs = Array.from(value).filter((glyph) => {
    if (glyph.length !== 1 || NON_CELL_CODE_POINT.test(glyph)) return false;
    const code = glyph.charCodeAt(0);
    return code !== 0x20 && !isWideBmpCodePoint(code);
  });
  if (glyphPatternCache.size >= 64) glyphPatternCache.clear();
  glyphPatternCache.set(value, glyphs);
  return glyphs;
}

function glyphPattern(value: string): string[] {
  const glyphs = parseGlyphPattern(value);
  return glyphs.length > 0 ? glyphs : ["?"];
}

const glyphRampCache = new Map<string, string[]>();

// Ramp consumers index by intensity, so a space is a meaningful "blank" band —
// unlike parseGlyphPattern's random glyph SET, it must not be stripped here.
function parseGlyphRamp(value: string): string[] {
  const cached = glyphRampCache.get(value);
  if (cached) return cached;
  const glyphs = Array.from(value).filter((glyph) => {
    if (glyph.length !== 1 || NON_CELL_CODE_POINT.test(glyph)) return false;
    return !isWideBmpCodePoint(glyph.charCodeAt(0));
  });
  if (glyphRampCache.size >= 64) glyphRampCache.clear();
  glyphRampCache.set(value, glyphs);
  return glyphs;
}

function glyphRamp(value: string): string[] {
  const glyphs = parseGlyphRamp(value);
  return glyphs.length > 0 ? glyphs : ["?"];
}

// Callers only truth-test the result as an "authored UVs are usable" gate —
// no caller reads bound values, so this returns the gate directly instead of
// a bounds struct.
export function findUvBounds<P extends AnyParams>(context: AnyContext<P>): boolean {
  const uv = context.base.uv0;
  if (!uv) return false;
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (let i = 0; i < context.base.length; i++) {
    if (context.target.coverage[i]! <= 0) continue;
    const u = uv[i * 2]!;
    const v = uv[i * 2 + 1]!;
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  const spanU = maxU - minU;
  const spanV = maxV - minV;
  return Number.isFinite(spanU) && Number.isFinite(spanV) && Math.max(spanU, spanV) >= 1e-6;
}

function sceneCoordinate<P extends AnyParams>(context: AnyContext<P>, index: number): [number, number] {
  const col = index % context.base.cols;
  const row = (index / context.base.cols) | 0;
  const [a, b, c, d, e, f] = context.coordinates.cellToSceneGrid;
  const x = col + 0.5;
  const y = row + 0.5;
  return [a * x + c * y + e, b * x + d * y + f];
}

interface SurfaceBasisSample {
  readonly u: number;
  readonly v: number;
  readonly nx: number;
  readonly ny: number;
  readonly nz: number;
  readonly horizontalX: number;
  readonly horizontalY: number;
  readonly horizontalZ: number;
  readonly verticalX: number;
  readonly verticalY: number;
  readonly verticalZ: number;
  readonly planeOffset: number;
  readonly worldToSceneScale: number;
}

// Split from the group-key string so the domainCoordinate fallback (flowText,
// scan, fieldSynth) — which only ever reads u/v — doesn't pay for a
// per-cell, per-frame template-string allocation it immediately discards.
// generatedSurfaceField still needs the key to group cells into coplanar
// surfaces, so it calls surfaceGroupKey directly on the basis it already has.
function surfaceBasisSample<P extends AnyParams>(
  context: AnyContext<P>,
  index: number,
): SurfaceBasisSample | null {
  const position = context.base.worldPosition;
  const normal = context.base.normal;
  if (!position || !normal) return null;

  const offset = index * 3;
  const px = position[offset]!;
  const py = position[offset + 1]!;
  const pz = position[offset + 2]!;
  let nx = normal[offset]!;
  let ny = normal[offset + 1]!;
  let nz = normal[offset + 2]!;
  if (![px, py, pz, nx, ny, nz].every(Number.isFinite)) return null;

  const normalLength = Math.hypot(nx, ny, nz);
  if (normalLength < 1e-6) return null;
  nx /= normalLength;
  ny /= normalLength;
  nz /= normalLength;

  const absX = Math.abs(nx);
  const absY = Math.abs(ny);
  const absZ = Math.abs(nz);
  const dominant = absX >= absY && absX >= absZ ? nx : absY >= absZ ? ny : nz;
  const canonicalSign = dominant < 0 ? -1 : 1;
  if (canonicalSign < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }

  const authoredScale = context.coordinates.worldToSceneScale;
  const worldToSceneScale = authoredScale !== undefined && Number.isFinite(authoredScale) && authoredScale > 0
    ? authoredScale / GENERATED_SURFACE_PITCH
    : 1 / GENERATED_SURFACE_PITCH;

  let verticalX = nz * nx;
  let verticalY = nz * ny;
  let verticalZ = nz * nz - 1;
  const verticalLength = Math.hypot(verticalX, verticalY, verticalZ);
  let verticalCoordinate: number;

  if (verticalLength < 1e-4) {
    let tangentX = absX < 0.9 ? 1 : 0;
    let tangentY = absX < 0.9 ? 0 : 1;
    let tangentZ = 0;
    const tangentDot = tangentX * nx + tangentY * ny + tangentZ * nz;
    tangentX -= nx * tangentDot;
    tangentY -= ny * tangentDot;
    tangentZ -= nz * tangentDot;
    const tangentLength = Math.hypot(tangentX, tangentY, tangentZ);
    tangentX /= tangentLength;
    tangentY /= tangentLength;
    tangentZ /= tangentLength;

    const bitangentX = ny * tangentZ - nz * tangentY;
    const bitangentY = nz * tangentX - nx * tangentZ;
    const bitangentZ = nx * tangentY - ny * tangentX;
    const planeOffset = px * nx + py * ny + pz * nz;
    const normalHash = hash2(
      hash2(Math.round(nx * 32_767), Math.round(ny * 32_767)),
      Math.round(nz * 32_767),
    );
    const orientation = hash2(normalHash, Math.round(planeOffset * 1_024));
    const sign = orientation & 2 ? -1 : 1;
    if (orientation & 1) {
      verticalX = bitangentX * sign;
      verticalY = bitangentY * sign;
      verticalZ = bitangentZ * sign;
    } else {
      verticalX = tangentX * sign;
      verticalY = tangentY * sign;
      verticalZ = tangentZ * sign;
    }
    verticalCoordinate = px * verticalX + py * verticalY + pz * verticalZ;
  } else {
    verticalX /= verticalLength;
    verticalY /= verticalLength;
    verticalZ /= verticalLength;
    verticalCoordinate = px * verticalX + py * verticalY + pz * verticalZ;
  }

  // `verticalX/Y/Z` above is world -Z projected into the tangent plane —
  // quadratic in `nx/ny/nz`, so it is unaffected by the `canonicalSign` flip
  // above (a whole-normal sign flip leaves nz*nx, nz*ny, nz*nz-1 unchanged).
  // `horizontal = vertical × normal` is *linear* in the normal, so it does
  // NOT share that invariance: it silently flips sign every time a rotating
  // mesh's normal crosses the dominant-axis canonicalization boundary, while
  // `vertical` stays continuous — an asymmetric flip a viewer reads as "down"
  // staying put while "right" reverses mid-rotation. Re-apply `canonicalSign`
  // here (only for this non-degenerate branch — the exact-perpendicular
  // fallback below already derives its own basis straight from the
  // canonicalized normal and must not be touched) to undo that propagated
  // flip, so `horizontal` is computed as if from the raw, un-canonicalized
  // normal and stays continuous across the same boundary as `vertical`.
  const horizontalSign = verticalLength < 1e-4 ? 1 : canonicalSign;
  const horizontalX = (verticalY * nz - verticalZ * ny) * horizontalSign;
  const horizontalY = (verticalZ * nx - verticalX * nz) * horizontalSign;
  const horizontalZ = (verticalX * ny - verticalY * nx) * horizontalSign;
  const planeOffset = px * nx + py * ny + pz * nz;
  return {
    u: (px * horizontalX + py * horizontalY + pz * horizontalZ) * worldToSceneScale,
    v: verticalCoordinate * worldToSceneScale,
    nx,
    ny,
    nz,
    horizontalX,
    horizontalY,
    horizontalZ,
    verticalX,
    verticalY,
    verticalZ,
    planeOffset,
    worldToSceneScale,
  };
}

function surfaceGroupKey(basis: SurfaceBasisSample): string {
  return `${Math.round(basis.nx * 4096)},${Math.round(basis.ny * 4096)},${Math.round(basis.nz * 4096)},${Math.round(basis.planeOffset * basis.worldToSceneScale * 1024)},${Math.round(basis.horizontalX * 4096)},${Math.round(basis.horizontalY * 4096)},${Math.round(basis.horizontalZ * 4096)},${Math.round(basis.verticalX * 4096)},${Math.round(basis.verticalY * 4096)},${Math.round(basis.verticalZ * 4096)}`;
}

function generatedSurfaceSample<P extends AnyParams>(
  context: AnyContext<P>,
  index: number,
): readonly [number, number] | null {
  const basis = surfaceBasisSample(context, index);
  return basis ? [basis.u, basis.v] : null;
}

function createSurfaceMetricAccumulator(): SurfaceMetricAccumulator {
  return {
    count: 0,
    sumX: 0,
    sumY: 0,
    sumXX: 0,
    sumXY: 0,
    sumYY: 0,
    sumU: 0,
    sumV: 0,
    sumXU: 0,
    sumYU: 0,
    sumXV: 0,
    sumYV: 0,
    dxDu: 1,
    dyDu: 0,
    dxDv: 0,
    dyDv: 1,
    minU: Infinity,
    maxU: -Infinity,
    minV: Infinity,
    maxV: -Infinity,
  };
}

function solveSurfaceMetric(group: SurfaceMetricAccumulator): void {
  if (group.count < 3) return;
  const invCount = 1 / group.count;
  const varianceX = group.sumXX - group.sumX * group.sumX * invCount;
  const varianceY = group.sumYY - group.sumY * group.sumY * invCount;
  const covarianceXY = group.sumXY - group.sumX * group.sumY * invCount;
  const covarianceUX = group.sumXU - group.sumU * group.sumX * invCount;
  const covarianceUY = group.sumYU - group.sumU * group.sumY * invCount;
  const covarianceVX = group.sumXV - group.sumV * group.sumX * invCount;
  const covarianceVY = group.sumYV - group.sumV * group.sumY * invCount;
  const covarianceDeterminant = varianceX * varianceY - covarianceXY * covarianceXY;
  if (Math.abs(covarianceDeterminant) < 1e-8) return;

  const duDx = (covarianceUX * varianceY - covarianceUY * covarianceXY) / covarianceDeterminant;
  const duDy = (covarianceUY * varianceX - covarianceUX * covarianceXY) / covarianceDeterminant;
  const dvDx = (covarianceVX * varianceY - covarianceVY * covarianceXY) / covarianceDeterminant;
  const dvDy = (covarianceVY * varianceX - covarianceVX * covarianceXY) / covarianceDeterminant;
  const derivativeDeterminant = duDx * dvDy - duDy * dvDx;
  if (Math.abs(derivativeDeterminant) < 1e-8) return;

  const inverseDeterminant = 1 / derivativeDeterminant;
  const dxDu = dvDy * inverseDeterminant;
  const dyDu = -dvDx * inverseDeterminant;
  const dxDv = -duDy * inverseDeterminant;
  const dyDv = duDx * inverseDeterminant;
  const uLength = Math.hypot(dxDu, dyDu);
  const vLength = Math.hypot(dxDv, dyDv);
  if (!(uLength > 0) || !(vLength > 0) || !Number.isFinite(uLength) || !Number.isFinite(vLength)) return;
  const uScale = Math.min(8, Math.max(0.125, uLength)) / uLength;
  const vScale = Math.min(8, Math.max(0.125, vLength)) / vLength;
  group.dxDu = dxDu * uScale;
  group.dyDu = dyDu * uScale;
  group.dxDv = dxDv * vScale;
  group.dyDv = dyDv * vScale;
}

export function generatedSurfaceField<P extends AnyParams>(context: AnyContext<P>): GeneratedSurfaceField | null {
  const position = context.base.worldPosition;
  const normal = context.base.normal;
  if (!position || !normal || typeof position !== "object" || typeof normal !== "object") return null;

  const cached = generatedSurfaceFieldCache.get(position as object);
  const worldToSceneScale = context.coordinates.worldToSceneScale;
  if (
    cached
    && cached.normal === normal
    && cached.cols === context.base.cols
    && cached.rows === context.base.rows
    && cached.worldToSceneScale === worldToSceneScale
  ) {
    return cached;
  }

  const coordinate = new Float32Array(context.base.length * 2);
  coordinate.fill(Number.NaN);
  const groupIndex = new Uint32Array(context.base.length);
  groupIndex.fill(0xffff_ffff);
  const groups: SurfaceMetricAccumulator[] = [];
  const groupByKey = new Map<string, number>();

  for (let i = 0; i < context.base.length; i++) {
    const basis = surfaceBasisSample(context, i);
    if (!basis) continue;
    const { u, v } = basis;
    coordinate[i * 2] = u;
    coordinate[i * 2 + 1] = v;
    const key = surfaceGroupKey(basis);
    let index = groupByKey.get(key);
    if (index === undefined) {
      index = groups.length;
      groupByKey.set(key, index);
      groups.push(createSurfaceMetricAccumulator());
    }
    groupIndex[i] = index;
    const group = groups[index]!;
    const x = i % context.base.cols + 0.5;
    const y = ((i / context.base.cols) | 0) + 0.5;
    group.count++;
    group.sumX += x;
    group.sumY += y;
    group.sumXX += x * x;
    group.sumXY += x * y;
    group.sumYY += y * y;
    group.sumU += u;
    group.sumV += v;
    group.sumXU += x * u;
    group.sumYU += y * u;
    group.sumXV += x * v;
    group.sumYV += y * v;
    if (u < group.minU) group.minU = u;
    if (u > group.maxU) group.maxU = u;
    if (v < group.minV) group.minV = v;
    if (v > group.maxV) group.maxV = v;
  }

  for (const group of groups) solveSurfaceMetric(group);

  const field: GeneratedSurfaceField = {
    normal: normal as object,
    cols: context.base.cols,
    rows: context.base.rows,
    worldToSceneScale,
    coordinate,
    groupIndex,
    groups,
  };
  generatedSurfaceFieldCache.set(position as object, field);
  return field;
}

// `space: "object"` triplanar fallback for the 2D-domain effects (`scan`,
// `flow-text`) — see the `TRIPLANAR_K` comment for the blend rationale.
// Blends the axis-plane 2D COORDINATES (not a sampled scalar): the caller
// only ever reads a coordinate out of `domainCoordinate`, so this is the
// cheap "triplanar UV" approximation rather than full triplanar texture
// blending. `matrix-rain` does NOT go through this path — it has a natural
// 3D form (falling strands) and uses the volumetric object-space
// formulation directly in its own `evaluate()` instead.
function triplanarObjectCoordinate<P extends AnyParams>(
  context: AnyContext<P>,
  index: number,
  scale: number,
): readonly [number, number, number, number, number, number] | null {
  const op = context.base.objectPosition;
  if (!op) return null;
  const x = op[index * 3]!, y = op[index * 3 + 1]!, z = op[index * 3 + 2]!;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  const nrm = context.base.normal;
  let nx = 0, ny = 0, nz = 1;
  if (nrm) {
    const rnx = nrm[index * 3]!, rny = nrm[index * 3 + 1]!, rnz = nrm[index * 3 + 2]!;
    if (Number.isFinite(rnx) && Number.isFinite(rny) && Number.isFinite(rnz)) { nx = rnx; ny = rny; nz = rnz; }
  }
  const wxRaw = Math.pow(Math.abs(nx), TRIPLANAR_K);
  const wyRaw = Math.pow(Math.abs(ny), TRIPLANAR_K);
  const wzRaw = Math.pow(Math.abs(nz), TRIPLANAR_K);
  const wSum = wxRaw + wyRaw + wzRaw;
  const wx = wSum > 1e-9 ? wxRaw / wSum : 1 / 3;
  const wy = wSum > 1e-9 ? wyRaw / wSum : 1 / 3;
  const wz = wSum > 1e-9 ? wzRaw / wSum : 1 / 3;
  // X-facing plane reads (y, z); Y-facing reads (x, z); Z-facing reads (x, y).
  const u = (wx * y + wy * x + wz * x) * scale;
  const v = (wx * z + wy * z + wz * y) * scale;
  return [u, v, 1, 0, 0, 1];
}

function domainCoordinate<P extends AnyParams>(
  context: AnyContext<P>,
  index: number,
  space: EffectSpace,
  uvBounds: boolean,
  scale: number,
  generatedSurface?: GeneratedSurfaceField | null,
): readonly [number, number, number, number, number, number] | null {
  if (space !== "scene") {
    if (space === "object") {
      const triplanar = triplanarObjectCoordinate(context, index, scale);
      if (triplanar) return triplanar;
      // No objectPosition on this cell (wireframe/voxel mode, or empty cell):
      // degrade to the same generated-surface / scene fallback `"surface"`
      // already uses when its own optional inputs are unavailable.
    }
    if (space === "auto" && uvBounds && context.base.uv0) {
      const u = context.base.uv0[index * 2]!;
      const v = context.base.uv0[index * 2 + 1]!;
      if (Number.isFinite(u) && Number.isFinite(v)) {
        const [sceneCols, sceneRows] = context.coordinates.sceneGridSize;
        return [
          u * sceneCols * scale,
          v * sceneRows * scale,
          1,
          0,
          0,
          1,
        ];
      }
    }
    if (generatedSurface) {
      const u = generatedSurface.coordinate[index * 2]!;
      const v = generatedSurface.coordinate[index * 2 + 1]!;
      const group = generatedSurface.groups[generatedSurface.groupIndex[index]!];
      if (Number.isFinite(u) && Number.isFinite(v) && group) {
        return [
          u * scale,
          v * scale,
          group.dxDu,
          group.dyDu,
          group.dxDv,
          group.dyDv,
        ];
      }
    } else if (generatedSurface === undefined) {
      const generated = generatedSurfaceSample(context, index);
      if (generated) return [generated[0] * scale, generated[1] * scale, 1, 0, 0, 1];
    }
  }
  const [x, y] = sceneCoordinate(context, index);
  return [x * scale, y * scale, 1, 0, 0, 1];
}

function directed(x: number, y: number, direction: EffectDirection): [number, number] {
  if (direction === "up") return [-y, x];
  if (direction === "right") return [x, y];
  if (direction === "left") return [-x, y];
  return [y, x];
}

function projectedSurfaceDirection(
  coordinate: readonly [number, number, number, number, number, number],
  direction: EffectDirection,
): [number, number] {
  const [u, v, dxDu, dyDu, dxDv, dyDv] = coordinate;
  const horizontal = direction === "right" || direction === "left";
  let flowX = horizontal ? dxDu : dxDv;
  let flowY = horizontal ? dyDu : dyDv;
  const laneX = horizontal ? dxDv : dxDu;
  const laneY = horizontal ? dyDv : dyDu;
  const flowLength = Math.hypot(flowX, flowY);
  if (flowLength < 1e-6) return directed(u, v, direction);
  flowX /= flowLength;
  flowY /= flowLength;
  const laneProjection = laneX * flowX + laneY * flowY;
  let acrossX = laneX - flowX * laneProjection;
  let acrossY = laneY - flowY * laneProjection;
  const acrossLength = Math.hypot(acrossX, acrossY);
  if (acrossLength < 1e-6) {
    acrossX = -flowY;
    acrossY = flowX;
  } else {
    acrossX /= acrossLength;
    acrossY /= acrossLength;
  }
  const screenX = dxDu * u + dxDv * v;
  const screenY = dyDu * u + dyDv * v;
  const reverse = direction === "up" || direction === "left" ? -1 : 1;
  return [
    (screenX * flowX + screenY * flowY) * reverse,
    screenX * acrossX + screenY * acrossY,
  ];
}

function setGlyph<P extends AnyParams>(context: AnyContext<P>, index: number, glyph: string): void {
  context.output.glyph[index] = glyph;
  context.output.channels[index] |= GLYPH;
}

function setColor<P extends AnyParams>(context: AnyContext<P>, index: number, packed: number): void {
  context.output.color[index] = packed;
  context.output.channels[index] |= COLOR;
}

function scalePackedColor(packed: number, intensity: number): number {
  const scale = clamp01(intensity);
  const red = Math.round(((packed >>> 16) & 0xff) * scale);
  const green = Math.round(((packed >>> 8) & 0xff) * scale);
  const blue = Math.round((packed & 0xff) * scale);
  return (red << 16) | (green << 8) | blue;
}

function validateGlyphs(params: Readonly<{ glyphs: string }>): void {
  if (parseGlyphPattern(params.glyphs).length === 0) {
    throw new TypeError("glyphcss effect glyphs must contain at least one printable single-cell character");
  }
}

function validateGlyphRamp(params: Readonly<{ glyphs: string }>): void {
  if (parseGlyphRamp(params.glyphs).length === 0) {
    throw new TypeError("glyphcss effect glyphs must contain at least one printable single-cell character");
  }
}

function validatePositiveScale(params: Readonly<{ scale: number }>): void {
  if (!(params.scale > 0)) throw new RangeError("glyphcss effect scale must be greater than zero");
}

const timeSpec = {
  kind: "number",
  default: 0,
  unit: "s",
  animation: "continuous",
  hidden: true,
} as const;

const spaceSpec = {
  kind: "string",
  default: "auto",
  values: ["auto", "surface", "scene", "object"],
  animation: "discrete",
  label: "Mapping",
} as const;

const directionSpec = {
  kind: "string",
  default: "down",
  values: ["down", "up", "right", "left"],
  animation: "discrete",
  label: "Direction",
} as const;

const scaleSpec = {
  kind: "number",
  default: 1,
  min: 0.01,
  max: 5,
  step: 0.05,
  label: "Pattern scale",
} as const;

const matrixRainSchema = {
  time: timeSpec,
  glyphs: { kind: "string", default: "HOLA", animation: "discrete", label: "Glyphs" },
  direction: directionSpec,
  // Matrix rain defaults to the volumetric object-space field (unlike
  // flow-text/scan, which keep `spaceSpec`'s "auto" default): a strand
  // falling through the mesh's own volume, agreeing across faces with no
  // per-face UV seam, is matrix rain's natural form (see AGENTS.md's
  // `space: "object"` volumetric formulation) and reads better as the
  // out-of-the-box look than the 2D-domain "auto" fallback most other
  // effects want. `scale` means a DIFFERENT thing under "object" (a 3D
  // field, not a 2D UV) than under "auto"/"surface" — existing saved
  // URLs/presets that relied on the old "auto" default and set a
  // non-default `scale` may look different after this change (see the
  // word-art/gallery/synth preset audit in the same change).
  space: { ...spaceSpec, default: "object" },
  scale: scaleSpec,
  speedMin: { kind: "number", default: 5, min: 0, max: 40, step: 0.25, unit: "cells/s", label: "Min speed" },
  speedMax: { kind: "number", default: 12, min: 0, max: 40, step: 0.25, unit: "cells/s", label: "Max speed" },
  trail: { kind: "number", default: 14, min: 1, max: 64, step: 1, unit: "cells", label: "Trail" },
  density: { kind: "number", default: 0.55, min: 0.02, max: 1, step: 0.01, label: "Streams" },
  seed: { kind: "number", default: 1, min: 0, max: 9999, step: 1, label: "Seed" },
  colorMode: {
    kind: "string",
    default: "original",
    values: ["original", "monochrome"],
    animation: "discrete",
    label: "Color mode",
  },
  color: { kind: "color", default: "#00ff66", label: "Monochrome color" },
  headColor: { kind: "color", default: "#d8ffe4", label: "Original head color" },
} as const satisfies GlyphEffectParamSchema;

// Volumetric `space: "object"` formulation for matrix rain: the pattern
// fills the mesh's own 3D volume — `f(x, z, y - t)` — instead of painting
// per-face UVs, so faces are just windows into the same body of rain and
// rotating the mesh turns the object through a field that stays put
// relative to it. "down"/"up" fall along the mesh's own Y (lanes keyed by
// X, Z); "left"/"right" fall along X (lanes keyed by Y, Z), so the same
// volumetric field also reads correctly on a mesh authored sideways. A cap
// cell and an adjacent wall cell sample the SAME (x, y, z) at their shared
// edge, so they agree by construction — no per-face seam, no UV-gradient
// blowup on a face turned edge-on to the camera.
// Fraction of a lane's width, on either side of its integer boundary, that
// fades out instead of committing hard to one lane's `hash2` bucket. Sized
// from a measured rotation sweep (packages/effects/src/stock.test.ts,
// "matrix-rain volumetric lane-boundary stability"): the rasterizer's
// depth-winning object-position sample for a given output cell is chosen
// per-subcell (nearest COVERED subcell to the cell's screen-space center —
// see AGENTS.md's Retained Glyph Effects section), and that pick can jump to
// a DIFFERENT subcell — a different point on the surface, up to roughly half
// an output cell's object-space footprint away — as the mesh rotates and
// coverage shifts within the cell, even with the effect clock paused. A hard
// `Math.floor` lane boundary turns that small, genuine positional jitter into
// a full swap to an unrelated `hash2` bucket (different phase/speed/glyph
// offset), which reads as a strand popping in or out. 0.18 was picked as the
// smallest margin that drove the measured sweep's "visible" churn (both the
// pre- and post-step sample solidly inside the faded band, i.e. an actual
// hard pop rather than a graceful fade) to zero on that sweep without fading
// a large fraction of each lane's interior at rest.
const OBJECT_LANE_EDGE_MARGIN = 0.18;

// Exported for direct regression testing (packages/effects/src/stock.test.ts
// pins this against a real rasterized rotating mesh) — see `generatedSurfaceField`
// above for the same "internal helper, exported for test/build reuse" convention.
export function objectVolumetricAlongLane<P extends AnyParams>(
  context: AnyContext<P>,
  index: number,
  direction: EffectDirection,
  scale: number,
): { along: number; lane: number; edgeFade: number } | null {
  const op = context.base.objectPosition;
  if (!op) return null;
  const x = op[index * 3]!, y = op[index * 3 + 1]!, z = op[index * 3 + 2]!;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  // Object frame is Z-up (X = extrusion depth, Y = width, Z = height), matching
  // glyphcss's world convention — see AGENTS.md. Vertical flow therefore runs
  // along Z (down = decreasing height) and horizontal flow along Y; the lane key
  // is the two axes perpendicular to that, always including depth (X) so cells
  // at different depths on the same column share a strand.
  const horizontal = direction === "left" || direction === "right";
  const along = (horizontal ? (direction === "right" ? y : -y) : (direction === "down" ? -z : z)) * scale;
  const lane0 = (horizontal ? z : y) * scale;
  const lane1 = x * scale;
  const f0 = lane0 - Math.floor(lane0);
  const f1 = lane1 - Math.floor(lane1);
  // Distance from the nearest lane boundary, in EITHER key axis (a crossing
  // in either flips the combined hash) — 0 exactly on a boundary, 0.5 at a
  // lane's center.
  const edgeDistance = Math.min(Math.min(f0, 1 - f0), Math.min(f1, 1 - f1));
  const edgeFade = smoothstep(0, OBJECT_LANE_EDGE_MARGIN, edgeDistance);
  // Combine the 2D lane key (the two axes perpendicular to flow) into the
  // single integer `hash2(lane, seed)` below expects.
  const lane = hash2(Math.floor(lane0), Math.floor(lane1)) | 0;
  return { along, lane, edgeFade };
}

export const matrixRain: GlyphStockEffectDefinition<typeof matrixRainSchema> = {
  id: "matrix-rain",
  version: 1,
  label: "Matrix rain",
  description: "Deterministic text strands that flow over visible surfaces.",
  defaultBlend: "replace",
  parameterSchema: matrixRainSchema,
  program: {
    optionalRequirements: ["baseShade", "normal", "worldPosition", "objectPosition", "uv0"],
    validateParams(params) {
      validateGlyphs(params);
      validatePositiveScale(params);
      if (params.speedMax < params.speedMin) throw new RangeError("speedMax must be greater than or equal to speedMin");
      if (!(params.trail >= 1)) throw new RangeError("trail must be at least one cell");
    },
    evaluate(context) {
      const { params } = context;
      const glyphs = glyphPattern(params.glyphs);
      const uvBounds = findUvBounds(context);
      const trail = Math.max(1, Math.round(params.trail));
      const period = Math.max(trail + 1, trail * 3);
      const parsedHead = parseGlyphEffectColor(params.headColor);
      const parsedColor = parseGlyphEffectColor(params.color);
      const monochrome = params.colorMode === "monochrome";
      // Volumetric branch is all-or-nothing per render: `objectPosition` is
      // either retained for every solid-mode cell or entirely absent (any
      // other mode). Skip building the costly generated-surface fit when the
      // volumetric path will actually be used — it only exists as this
      // effect's degrade-to-`"surface"` path for wireframe/voxel modes.
      const volumetric = params.space === "object" && !!context.base.objectPosition;
      const generatedSurface = !volumetric && params.space !== "scene" && !(params.space === "auto" && uvBounds)
        ? generatedSurfaceField(context)
        : undefined;
      const fittedSurface = generatedSurface !== undefined && generatedSurface !== null;
      const direction = params.direction as EffectDirection;
      for (let i = 0; i < context.base.length; i++) {
        if (context.target.coverage[i]! <= 0) continue;
        let along: number;
        let lane: number;
        let glyphsPerPatternCell: number;
        // Only the volumetric (`space: "object"`) path softens near a lane
        // boundary — see `OBJECT_LANE_EDGE_MARGIN`. The 2D domain paths below
        // sample a stable per-cell UV/surface coordinate, not a
        // supersample-quantized object position, so they don't exhibit the
        // same rotation-driven pop and stay at full strength (edgeFade 1).
        let edgeFade = 1;
        if (volumetric) {
          const v = objectVolumetricAlongLane(context, i, direction, params.scale);
          if (!v) continue;
          along = v.along;
          lane = v.lane;
          edgeFade = v.edgeFade;
          if (edgeFade <= 0) continue;
          glyphsPerPatternCell = 1 / params.scale;
        } else {
          const coordinate = domainCoordinate(
            context,
            i,
            params.space as EffectSpace,
            uvBounds,
            params.scale,
            generatedSurface,
          );
          if (!coordinate) continue;
          const [alongC, acrossC] = fittedSurface
            ? projectedSurfaceDirection(coordinate, direction)
            : directed(coordinate[0], coordinate[1], direction);
          along = alongC;
          lane = Math.floor(acrossC);
          glyphsPerPatternCell = fittedSurface ? 1 / params.scale : 1;
        }
        const seed = hash2(lane, Math.floor(params.seed));
        if ((seed & 0xffff) / 0x1_0000 >= params.density) continue;
        const speedUnit = ((seed >>> 16) & 0xffff) / 0xffff;
        const speed = params.speedMin + speedUnit * (params.speedMax - params.speedMin);
        const head = params.time * speed + (seed % period);
        const behind = positiveMod(head - along, period);
        if (behind >= trail) continue;
        const glyphIndex = positiveMod(
          ((seed >>> 8) % glyphs.length) - Math.floor(behind * glyphsPerPatternCell),
          glyphs.length,
        );
        setGlyph(context, i, glyphs[glyphIndex]!);
        if (monochrome) {
          // Matrix signature: a bright leading head that fades to a dark tail.
          // `behind` is 0 at the head and grows toward the tail — light the
          // head cell toward `headColor` and fall the body off toward black so
          // each strand glows at its tip and trails away, instead of every cell
          // sharing one flat green. Surface shade still modulates so lit faces
          // read brighter than faces turned away from the light.
          const shade = context.base.shade?.[i];
          const surfaceLit = shade !== undefined && Number.isFinite(shade) ? shade : 1;
          const headSpan = 1 / glyphsPerPatternCell;
          if (behind < headSpan && parsedHead.opacity > 0) {
            setColor(context, i, scalePackedColor(parsedHead.packed, 0.6 + 0.4 * surfaceLit));
          } else {
            const fade = Math.pow(1 - behind / trail, 1.6);
            const intensity = (0.12 + 0.88 * fade) * (0.5 + 0.5 * surfaceLit);
            setColor(context, i, scalePackedColor(parsedColor.packed, intensity));
          }
          context.output.coverage[i] = parsedColor.opacity * edgeFade;
        } else {
          context.output.coverage[i] = edgeFade;
          if (behind < 1 / glyphsPerPatternCell && parsedHead.opacity > 0) {
            setColor(context, i, parsedHead.packed);
            context.output.coverage[i] = parsedHead.opacity * edgeFade;
          }
        }
      }
    },
  },
};

const flowTextSchema = {
  time: timeSpec,
  glyphs: { kind: "string", default: "HOLA", animation: "discrete", label: "Text" },
  direction: { ...directionSpec, default: "right" },
  space: spaceSpec,
  scale: scaleSpec,
  speed: { kind: "number", default: 6, min: -40, max: 40, step: 0.25, unit: "cells/s", label: "Speed" },
} as const satisfies GlyphEffectParamSchema;

export const flowText: GlyphStockEffectDefinition<typeof flowTextSchema> = {
  id: "flow-text",
  version: 1,
  label: "Flow text",
  description: "Repeats a word and moves it continuously across the surface domain.",
  defaultBlend: "replace",
  parameterSchema: flowTextSchema,
  program: {
    optionalRequirements: ["normal", "worldPosition", "objectPosition", "uv0"],
    validateParams(params) {
      validateGlyphs(params);
      validatePositiveScale(params);
    },
    evaluate(context) {
      const { params } = context;
      const glyphs = glyphPattern(params.glyphs);
      const uvBounds = findUvBounds(context);
      const offset = Math.floor(params.time * params.speed);
      for (let i = 0; i < context.base.length; i++) {
        if (context.target.coverage[i]! <= 0) continue;
        const coordinate = domainCoordinate(context, i, params.space as EffectSpace, uvBounds, params.scale);
        if (!coordinate) continue;
        const [along] = directed(coordinate[0], coordinate[1], params.direction as EffectDirection);
        setGlyph(context, i, glyphs[positiveMod(Math.floor(along) - offset, glyphs.length)]!);
        context.output.coverage[i] = 1;
      }
    },
  },
};

const scanSchema = {
  time: timeSpec,
  direction: directionSpec,
  space: spaceSpec,
  scale: scaleSpec,
  speed: { kind: "number", default: 10, min: -40, max: 40, step: 0.25, unit: "cells/s", label: "Speed" },
  width: { kind: "number", default: 3, min: 0.25, max: 24, step: 0.25, unit: "cells", label: "Width" },
  spacing: { kind: "number", default: 28, min: 2, max: 100, step: 1, unit: "cells", label: "Spacing" },
  color: { kind: "color", default: "#ffffff", label: "Color" },
} as const satisfies GlyphEffectParamSchema;

export const scan: GlyphStockEffectDefinition<typeof scanSchema> = {
  id: "scan",
  version: 1,
  label: "Scan",
  description: "A luminous scan band moving through the rendered surfaces.",
  defaultBlend: "over",
  parameterSchema: scanSchema,
  program: {
    optionalRequirements: ["normal", "worldPosition", "objectPosition", "uv0"],
    validateParams(params) { validatePositiveScale(params); },
    evaluate(context) {
      const { params } = context;
      const uvBounds = findUvBounds(context);
      const parsed = parseGlyphEffectColor(params.color);
      const spacing = Math.max(params.width, params.spacing);
      for (let i = 0; i < context.base.length; i++) {
        if (context.target.coverage[i]! <= 0) continue;
        const coordinate = domainCoordinate(context, i, params.space as EffectSpace, uvBounds, params.scale);
        if (!coordinate) continue;
        const [along] = directed(coordinate[0], coordinate[1], params.direction as EffectDirection);
        const distance = Math.abs(positiveMod(along - params.time * params.speed + spacing / 2, spacing) - spacing / 2);
        const strength = 1 - smoothstep(params.width * 0.25, params.width, distance);
        if (strength <= 0) continue;
        setColor(context, i, parsed.packed);
        context.output.coverage[i] = strength * parsed.opacity;
      }
    },
  },
};

const wipeSchema = {
  progress: { kind: "number", default: 0.5, min: 0, max: 1, step: 0.01, animation: "continuous", label: "Progress" },
  softness: { kind: "number", default: 0.04, min: 0, max: 0.5, step: 0.005, label: "Softness" },
  direction: { ...directionSpec, default: "right" },
  invert: { kind: "boolean", default: false, animation: "discrete", label: "Invert" },
} as const satisfies GlyphEffectParamSchema;

export const wipe: GlyphStockEffectDefinition<typeof wipeSchema> = {
  id: "wipe",
  version: 1,
  label: "Wipe",
  description: "A directional reveal mask suitable for direct progress animation.",
  defaultBlend: "replace",
  parameterSchema: wipeSchema,
  program: {
    evaluate(context) {
      const { params } = context;
      const [cols, rows] = context.coordinates.sceneGridSize;
      for (let i = 0; i < context.base.length; i++) {
        if (context.target.coverage[i]! <= 0) continue;
        const [x, y] = sceneCoordinate(context, i);
        let position: number;
        if (params.direction === "left") position = 1 - x / cols;
        else if (params.direction === "down") position = y / rows;
        else if (params.direction === "up") position = 1 - y / rows;
        else position = x / cols;
        let coverage = 1 - smoothstep(params.progress - params.softness, params.progress + params.softness, position);
        if (params.invert) coverage = 1 - coverage;
        context.output.coverage[i] = coverage;
      }
    },
  },
};

const scrambleSchema = {
  time: timeSpec,
  glyphs: { kind: "string", default: "@#$%&*+=?", animation: "discrete", label: "Glyphs" },
  amount: { kind: "number", default: 0.35, min: 0, max: 1, step: 0.01, label: "Amount" },
  rate: { kind: "number", default: 10, min: 0, max: 60, step: 0.5, unit: "frames/s", label: "Rate" },
  seed: { kind: "number", default: 1, min: 0, max: 9999, step: 1, label: "Seed" },
} as const satisfies GlyphEffectParamSchema;

export const scramble: GlyphStockEffectDefinition<typeof scrambleSchema> = {
  id: "scramble",
  version: 1,
  label: "Scramble",
  description: "Randomly substitutes glyphs while retaining the model silhouette and shading.",
  defaultBlend: "over",
  parameterSchema: scrambleSchema,
  program: {
    validateParams: validateGlyphs,
    evaluate(context) {
      const { params } = context;
      const glyphs = glyphPattern(params.glyphs);
      const frame = Math.floor(params.time * params.rate);
      for (let i = 0; i < context.base.length; i++) {
        if (context.target.coverage[i]! <= 0) continue;
        const random = hashUnit(i + Math.floor(params.seed), frame);
        if (random < params.amount) {
          const choice = hash2(frame, i + Math.floor(params.seed)) % glyphs.length;
          setGlyph(context, i, glyphs[choice]!);
          context.output.coverage[i] = 1;
        }
      }
    },
  },
};

const glitchSchema = {
  time: timeSpec,
  glyphs: { kind: "string", default: "#%/=+!?", animation: "discrete", label: "Glyphs" },
  amount: { kind: "number", default: 0.28, min: 0, max: 1, step: 0.01, label: "Amount" },
  rate: { kind: "number", default: 12, min: 0, max: 60, step: 0.5, unit: "frames/s", label: "Rate" },
  bandSize: { kind: "number", default: 4, min: 1, max: 24, step: 1, unit: "rows", label: "Band size" },
  seed: { kind: "number", default: 1, min: 0, max: 9999, step: 1, label: "Seed" },
  color: { kind: "color", default: "#ff4fd8", label: "Glitch color" },
} as const satisfies GlyphEffectParamSchema;

export const glitch: GlyphStockEffectDefinition<typeof glitchSchema> = {
  id: "glitch",
  version: 1,
  label: "Glitch",
  description: "Bursts of deterministic banded glyph corruption and color.",
  defaultBlend: "over",
  parameterSchema: glitchSchema,
  program: {
    validateParams: validateGlyphs,
    evaluate(context) {
      const { params } = context;
      const glyphs = glyphPattern(params.glyphs);
      const parsed = parseGlyphEffectColor(params.color);
      const frame = Math.floor(params.time * params.rate);
      const bandSize = Math.max(1, Math.round(params.bandSize));
      for (let i = 0; i < context.base.length; i++) {
        if (context.target.coverage[i]! <= 0) continue;
        const row = (i / context.base.cols) | 0;
        const band = Math.floor(row / bandSize);
        const bandActive = hashUnit(band + Math.floor(params.seed), frame) < params.amount;
        if (!bandActive || hashUnit(i, frame + band) > 0.72) continue;
        setGlyph(context, i, glyphs[hash2(i + frame, band) % glyphs.length]!);
        setColor(context, i, parsed.packed);
        context.output.coverage[i] = parsed.opacity;
      }
    },
  },
};

const noiseDissolveSchema = {
  progress: { kind: "number", default: 0.5, min: 0, max: 1, step: 0.01, animation: "continuous", label: "Progress" },
  softness: { kind: "number", default: 0.08, min: 0, max: 0.5, step: 0.005, label: "Softness" },
  scale: { kind: "number", default: 0.22, min: 0.02, max: 2, step: 0.01, label: "Noise scale" },
  seed: { kind: "number", default: 1, min: 0, max: 9999, step: 1, label: "Seed" },
} as const satisfies GlyphEffectParamSchema;

export const noiseDissolve: GlyphStockEffectDefinition<typeof noiseDissolveSchema> = {
  id: "noise-dissolve",
  version: 1,
  label: "Noise dissolve",
  description: "A stable procedural dissolve that can be scrubbed with one progress value.",
  defaultBlend: "replace",
  parameterSchema: noiseDissolveSchema,
  program: {
    validateParams(params) {
      if (!(params.scale > 0)) throw new RangeError("noise scale must be greater than zero");
    },
    evaluate(context) {
      const { params } = context;
      for (let i = 0; i < context.base.length; i++) {
        if (context.target.coverage[i]! <= 0) continue;
        const [x, y] = sceneCoordinate(context, i);
        const cellX = Math.floor(x * params.scale);
        const cellY = Math.floor(y * params.scale);
        const noise = hashUnit(cellX + Math.floor(params.seed), cellY);
        context.output.coverage[i] = smoothstep(
          params.progress - params.softness,
          params.progress + params.softness,
          noise,
        );
      }
    },
  },
};

const rippleSchema = {
  time: timeSpec,
  glyphs: { kind: "string", default: "*+", animation: "discrete", label: "Glyphs" },
  speed: { kind: "number", default: 6, min: -30, max: 30, step: 0.25, unit: "cells/s", label: "Speed" },
  frequency: { kind: "number", default: 0.5, min: 0.05, max: 3, step: 0.05, label: "Frequency" },
  width: { kind: "number", default: 0.18, min: 0.01, max: 1, step: 0.01, label: "Width" },
  amount: { kind: "number", default: 0.85, min: 0, max: 1, step: 0.01, label: "Amount" },
  color: { kind: "color", default: "#72d9ff", label: "Color" },
} as const satisfies GlyphEffectParamSchema;

export const ripple: GlyphStockEffectDefinition<typeof rippleSchema> = {
  id: "ripple",
  version: 1,
  label: "Ripple",
  description: "Concentric glyph and color waves in canonical scene coordinates.",
  defaultBlend: "over",
  parameterSchema: rippleSchema,
  program: {
    validateParams: validateGlyphs,
    evaluate(context) {
      const { params } = context;
      const glyphs = glyphPattern(params.glyphs);
      const parsed = parseGlyphEffectColor(params.color);
      const [cols, rows] = context.coordinates.sceneGridSize;
      const cx = cols * 0.5;
      const cy = rows * 0.5;
      for (let i = 0; i < context.base.length; i++) {
        if (context.target.coverage[i]! <= 0) continue;
        const [x, y] = sceneCoordinate(context, i);
        const phase = Math.hypot(x - cx, y - cy) * params.frequency - params.time * params.speed;
        const distance = Math.abs(Math.sin(phase));
        const strength = (1 - smoothstep(0, params.width, distance)) * params.amount;
        if (strength <= 0) continue;
        setGlyph(context, i, glyphs[positiveMod(Math.floor(phase), glyphs.length)]!);
        setColor(context, i, parsed.packed);
        context.output.coverage[i] = strength * parsed.opacity;
      }
    },
  },
};

// ── Field synth ────────────────────────────────────────────────────────────
// A small modular synth: up to SYNTH_VOICES oscillators, each a spatial FIELD
// sampled through a WAVEFORM, combined into one scalar field that maps to a
// glyph ramp + color. Composing/interfering the oscillators is where emergent
// patterns (moiré, plaid, sonar, lattices) come from. Runs over surfaces via
// `space`.

// Exported so `staticExport.ts` can enumerate voices / validate field-wave-
// combine names against the same lists the schema uses, instead of a second
// hardcoded copy that could drift.
export const SYNTH_VOICES = 6;
export const SYNTH_FIELDS = ["radial", "linearX", "linearY", "diagonal", "angular", "spiral", "noise"] as const;
export const SYNTH_WAVES = ["sin", "triangle", "saw", "square"] as const;
export const SYNTH_COMBINES = ["add", "multiply", "max", "min", "difference", "argmax"] as const;

// Exported so consumers (e.g. the website's `/synth` waveform trendlines) can
// plot the exact same shape+phase math the engine evaluates, instead of a
// second copy that could drift.
export function synthWave(kind: string, t: number): number {
  const p = t - Math.floor(t); // 0..1
  switch (kind) {
    case "triangle": return 4 * Math.abs(p - 0.5) - 1;
    case "saw": return 2 * p - 1;
    case "square": return p < 0.5 ? 1 : -1;
    default: return Math.sin(t * Math.PI * 2); // sin
  }
}

function synthHash3(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

// Time is a third lattice axis (not an x-translation), so the pattern morphs
// in place — trilinear interpolation between the z and z+1 lattice frames —
// instead of sliding sideways as `time` advances.
function synthNoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const a000 = synthHash3(xi, yi, zi), a100 = synthHash3(xi + 1, yi, zi);
  const a010 = synthHash3(xi, yi + 1, zi), a110 = synthHash3(xi + 1, yi + 1, zi);
  const a001 = synthHash3(xi, yi, zi + 1), a101 = synthHash3(xi + 1, yi, zi + 1);
  const a011 = synthHash3(xi, yi + 1, zi + 1), a111 = synthHash3(xi + 1, yi + 1, zi + 1);
  const frame0 = (a000 * (1 - u) + a100 * u) * (1 - v) + (a010 * (1 - u) + a110 * u) * v;
  const frame1 = (a001 * (1 - u) + a101 * u) * (1 - v) + (a011 * (1 - u) + a111 * u) * v;
  return frame0 * (1 - w) + frame1 * w; // 0..1
}

// One oscillator → value in ~[-amp, amp].
function synthOsc(field: string, wave: string, freq: number, speed: number, amp: number, x: number, y: number, cx: number, cy: number, time: number, angle = 0): number {
  if (amp === 0) return 0;
  if (angle !== 0) {
    // Rotate the SAMPLE about this voice's own centre rather than rotating the
    // field: radial/spiral then stay anchored where they were, and a linear
    // field becomes a plane wave at `angle`.
    const a = (-angle * Math.PI) / 180;
    const dx = x - cx;
    const dy = y - cy;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    x = cx + dx * ca - dy * sa;
    y = cy + dx * sa + dy * ca;
  }
  if (field === "noise") {
    return amp * (2 * synthNoise3(x * freq, y * freq, time * speed) - 1);
  }
  let raw: number;
  switch (field) {
    case "linearX": raw = x; break;
    case "linearY": raw = y; break;
    case "diagonal": raw = (x + y) * 0.70710678; break;
    // atan2/(2π) jumps by 1 crossing the -x ray; a wave sampled at raw*freq
    // is seamless there only when freq lands on an integer number of cycles
    // per revolution. Non-integer freq leaves a visible seam along that ray —
    // topological to the angular coordinate, not fixable by clamping freq.
    case "angular": raw = Math.atan2(y - cy, x - cx) / (Math.PI * 2); break;
    case "spiral": raw = Math.hypot(x - cx, y - cy) + Math.atan2(y - cy, x - cx) / (Math.PI * 2); break;
    default: raw = Math.hypot(x - cx, y - cy); // radial
  }
  return amp * synthWave(wave, raw * freq - time * speed);
}

function lerpPacked(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

const fieldSynthSchema = {
  time: timeSpec,
  space: spaceSpec,
  // 0.1 → 100 is exactly three decades, and the dial is logarithmic, so
  // 0.1–1, 1–10 and 10–100 each get precisely a third of the track.
  scale: { kind: "number", default: 2, min: 0.1, max: 100, step: 0.1, label: "Pattern scale" },
  originU: { kind: "number", default: 0.5, min: 0, max: 1, step: 0.01, label: "Origin U" },
  originV: { kind: "number", default: 0.5, min: 0, max: 1, step: 0.01, label: "Origin V" },
  field1: { kind: "string", default: "radial", values: SYNTH_FIELDS, animation: "discrete", label: "Osc 1 field" },
  wave1: { kind: "string", default: "sin", values: SYNTH_WAVES, animation: "discrete", label: "Osc 1 wave" },
  freq1: { kind: "number", default: 3, min: 0, max: 96, step: 0.1, label: "Osc 1 freq" },
  speed1: { kind: "number", default: 0.4, min: -8, max: 8, step: 0.05, unit: "cyc/s", label: "Osc 1 speed" },
  amp1: { kind: "number", default: 1, min: 0, max: 1, step: 0.05, label: "Osc 1 amp" },
  angle1: { kind: "number", default: 0, min: -180, max: 180, step: 1, unit: "°", label: "Osc 1 angle" },
  originU1: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 1 origin U" },
  originV1: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 1 origin V" },
  field2: { kind: "string", default: "angular", values: SYNTH_FIELDS, animation: "discrete", label: "Osc 2 field" },
  wave2: { kind: "string", default: "saw", values: SYNTH_WAVES, animation: "discrete", label: "Osc 2 wave" },
  freq2: { kind: "number", default: 5, min: 0, max: 96, step: 0.1, label: "Osc 2 freq" },
  speed2: { kind: "number", default: 0.4, min: -8, max: 8, step: 0.05, unit: "cyc/s", label: "Osc 2 speed" },
  amp2: { kind: "number", default: 1, min: 0, max: 1, step: 0.05, label: "Osc 2 amp" },
  angle2: { kind: "number", default: 0, min: -180, max: 180, step: 1, unit: "°", label: "Osc 2 angle" },
  originU2: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 2 origin U" },
  originV2: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 2 origin V" },
  field3: { kind: "string", default: "linearX", values: SYNTH_FIELDS, animation: "discrete", label: "Osc 3 field" },
  wave3: { kind: "string", default: "sin", values: SYNTH_WAVES, animation: "discrete", label: "Osc 3 wave" },
  freq3: { kind: "number", default: 4, min: 0, max: 96, step: 0.1, label: "Osc 3 freq" },
  speed3: { kind: "number", default: 0.4, min: -8, max: 8, step: 0.05, unit: "cyc/s", label: "Osc 3 speed" },
  amp3: { kind: "number", default: 0, min: 0, max: 1, step: 0.05, label: "Osc 3 amp" },
  angle3: { kind: "number", default: 0, min: -180, max: 180, step: 1, unit: "°", label: "Osc 3 angle" },
  originU3: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 3 origin U" },
  originV3: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 3 origin V" },
  field4: { kind: "string", default: "linearY", values: SYNTH_FIELDS, animation: "discrete", label: "Osc 4 field" },
  wave4: { kind: "string", default: "sin", values: SYNTH_WAVES, animation: "discrete", label: "Osc 4 wave" },
  freq4: { kind: "number", default: 4, min: 0, max: 96, step: 0.1, label: "Osc 4 freq" },
  speed4: { kind: "number", default: 0.4, min: -8, max: 8, step: 0.05, unit: "cyc/s", label: "Osc 4 speed" },
  amp4: { kind: "number", default: 0, min: 0, max: 1, step: 0.05, label: "Osc 4 amp" },
  angle4: { kind: "number", default: 0, min: -180, max: 180, step: 1, unit: "°", label: "Osc 4 angle" },
  originU4: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 4 origin U" },
  originV4: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 4 origin V" },
  field5: { kind: "string", default: "diagonal", values: SYNTH_FIELDS, animation: "discrete", label: "Osc 5 field" },
  wave5: { kind: "string", default: "sin", values: SYNTH_WAVES, animation: "discrete", label: "Osc 5 wave" },
  freq5: { kind: "number", default: 6, min: 0, max: 96, step: 0.1, label: "Osc 5 freq" },
  speed5: { kind: "number", default: 0.4, min: -8, max: 8, step: 0.05, unit: "cyc/s", label: "Osc 5 speed" },
  amp5: { kind: "number", default: 0, min: 0, max: 1, step: 0.05, label: "Osc 5 amp" },
  angle5: { kind: "number", default: 0, min: -180, max: 180, step: 1, unit: "°", label: "Osc 5 angle" },
  originU5: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 5 origin U" },
  originV5: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 5 origin V" },
  field6: { kind: "string", default: "noise", values: SYNTH_FIELDS, animation: "discrete", label: "Osc 6 field" },
  wave6: { kind: "string", default: "sin", values: SYNTH_WAVES, animation: "discrete", label: "Osc 6 wave" },
  freq6: { kind: "number", default: 5, min: 0, max: 96, step: 0.1, label: "Osc 6 freq" },
  speed6: { kind: "number", default: 0.4, min: -8, max: 8, step: 0.05, unit: "cyc/s", label: "Osc 6 speed" },
  amp6: { kind: "number", default: 0, min: 0, max: 1, step: 0.05, label: "Osc 6 amp" },
  angle6: { kind: "number", default: 0, min: -180, max: 180, step: 1, unit: "°", label: "Osc 6 angle" },
  originU6: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 6 origin U" },
  originV6: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 6 origin V" },
  combine: { kind: "string", default: "multiply", values: SYNTH_COMBINES, animation: "discrete", label: "Combine" },
  gain: { kind: "number", default: 1, min: 0, max: 4, step: 0.05, label: "Contrast" },
  bias: { kind: "number", default: 0.5, min: -1, max: 2, step: 0.05, label: "Brightness" },
  glyphs: { kind: "string", default: " .:-=+*#%@", animation: "discrete", label: "Ramp" },
  // "2x4" swaps the ramp-indexed glyph for a synthesized Braille pattern
  // character (U+2800 + dot bitmask), one 2×4 dot grid sampled and thresholded
  // per cell — still exactly one glyph per cell, so the renderer's
  // single-glyph-per-cell contract is unaffected. Subcell coordinates outside
  // `space: "scene"` are reconstructed by finite-differencing neighboring
  // cells' resolved coordinates (a local-affine approximation), so dots shear
  // on genuinely curved generated-surface/UV mappings; `space: "scene"` is exact.
  subcellRes: { kind: "string", default: "1x1", values: ["1x1", "2x4", "ink"], animation: "discrete", label: "Subcell resolution" },
  // "ink" reads the field's SHAPE rather than its level: see `inkGlyphForField`.
  // How many evenly spaced cuts through the amplitude axis to contour — a
  // topographic map of the field, not a single iso-line.
  inkLevels: { kind: "number", default: 4, min: 1, max: 12, step: 1, label: "Ink levels" },
  color: { kind: "color", default: "#7df9ff", label: "Color" },
  colorB: { kind: "color", default: "#ff4fa3", label: "Color B" },
  gradient: { kind: "number", default: 0, min: 0, max: 1, step: 0.05, label: "Gradient" },
  lit: { kind: "number", default: 1, min: 0, max: 1, step: 0.05, label: "Lighting" },
  // Per-voice colors: when on, each cell's color is the contribution-weighted blend
  // of the active voices' colors (composes colors through the mix). Off keeps the
  // single color/colorB gradient (so existing presets are unchanged).
  voiceColors: { kind: "boolean", default: false, animation: "discrete", label: "Per-voice colors" },
  color1: { kind: "color", default: "#7df9ff", label: "Voice 1 color" },
  color2: { kind: "color", default: "#ff4fa3", label: "Voice 2 color" },
  color3: { kind: "color", default: "#8affc1", label: "Voice 3 color" },
  color4: { kind: "color", default: "#ffcf5a", label: "Voice 4 color" },
  color5: { kind: "color", default: "#c78bff", label: "Voice 5 color" },
  color6: { kind: "color", default: "#ff7a45", label: "Voice 6 color" },
} as const satisfies GlyphEffectParamSchema;

// Guards the per-voice literal accessors in fieldSynth's evaluate() below: if
// SYNTH_VOICES ever changes without the schema following, this fails loudly at
// module load instead of silently reading `undefined` through a stale cast.
for (let voice = 1; voice <= SYNTH_VOICES; voice++) {
  for (const prefix of ["field", "wave", "freq", "speed", "amp", "color"] as const) {
    if (!(`${prefix}${voice}` in fieldSynthSchema)) {
      throw new Error(`glyphcss: field-synth schema is missing "${prefix}${voice}" for ${SYNTH_VOICES} voices.`);
    }
  }
}

interface SynthVoice {
  readonly field: string;
  readonly wave: string;
  readonly freq: number;
  readonly speed: number;
  readonly amp: number;
  readonly color: string;
  /** Degrees. Rotates this voice's sampling frame about its own origin, which
   *  turns the three fixed linear fields into one continuously steerable plane
   *  wave — the continuum where fine moiré lives. Radial is invariant to it. */
  readonly angle: number;
  /** Offset from the global origin, in the same normalized domain units, so two
   *  radial voices can sit on DIFFERENT centres (the textbook interference
   *  figure, unreachable at any voice count while the centre was shared). */
  readonly originU: number;
  readonly originV: number;
}

// Generated world-surface coordinates (space "surface", or "auto" without a
// usable UV) are already isotropic metric units on the face plane — dividing
// them by sceneCols/sceneRows would make the pattern viewport-size-dependent
// and shear radial/spiral/angular fields into ellipses whenever cols≠rows. UV
// and scene-grid domains stay normalized by grid size, as before.
//
// On the generated-surface branch, origin/scale are unrelated to the UV and
// scene branches: `originU*scale` is a fixed point in unbounded world-plane
// units, which usually falls off whatever face is on screen. So this branch
// maps origin into the current cell's group's own covered u/v bounds instead
// (via the retained generatedSurfaceField grouping — same coordinate values
// matrixRain reads, just with min/max also tracked), returning a per-cell
// (cx, cy) alongside (x, y). UV and scene branches keep the original
// origin*scale center untouched.
export function fieldSynthCoordinate<P extends AnyParams>(
  context: AnyContext<P>,
  index: number,
  space: EffectSpace,
  uvBounds: boolean,
  scale: number,
  originU: number,
  originV: number,
  sceneCols: number,
  sceneRows: number,
  generatedSurface: GeneratedSurfaceField | null | undefined,
): readonly [number, number, number, number] | null {
  if (space !== "scene") {
    if (space === "auto" && uvBounds && context.base.uv0) {
      const u = context.base.uv0[index * 2]!;
      const v = context.base.uv0[index * 2 + 1]!;
      if (Number.isFinite(u) && Number.isFinite(v)) {
        return [u * scale, v * scale, originU * scale, originV * scale];
      }
    }
    if (generatedSurface) {
      const u = generatedSurface.coordinate[index * 2]!;
      const v = generatedSurface.coordinate[index * 2 + 1]!;
      const group = generatedSurface.groups[generatedSurface.groupIndex[index]!];
      if (Number.isFinite(u) && Number.isFinite(v) && group) {
        const cx = (group.minU + originU * (group.maxU - group.minU)) * scale;
        const cy = (group.minV + originV * (group.maxV - group.minV)) * scale;
        return [u * scale, v * scale, cx, cy];
      }
    } else if (generatedSurface === undefined) {
      const generated = generatedSurfaceSample(context, index);
      if (generated) return [generated[0] * scale, generated[1] * scale, originU * scale, originV * scale];
    }
  }
  const [x, y] = sceneCoordinate(context, index);
  return [(x / sceneCols) * scale, (y / sceneRows) * scale, originU * scale, originV * scale];
}

// Braille block (U+2800..U+28FF) dot bit weights, indexed [dotCol][dotRow].
// This is the block's actual bit layout, NOT raster order: column 0 runs
// 0x01,0x02,0x04 top-to-bottom then jumps to 0x40 for its bottom dot; column 1
// mirrors that at 0x08,0x10,0x20,0x80.
const BRAILLE_DOT_BITS: readonly (readonly [number, number, number, number])[] = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
];

// Same voice-fold as the main evaluate() loop below, minus the color
// bookkeeping the main loop needs — used to resample the scalar field at each
// of a cell's 8 Braille subcell offsets, where only the scalar matters.
/**
 * Evaluate the whole voice stack at one point. `winner` is only meaningful under
 * `combine: "argmax"`, where the output is CATEGORICAL — which voice won, not
 * how much it won by. Every other mode folds values as before and reports -1.
 *
 * argmax is what makes hard-edged tilings possible: the pairwise ops all return
 * a value, so a region's shading keeps varying inside it, whereas selecting by
 * identity gives each region one flat level (and, with per-voice colors, the
 * winning voice's own colour).
 */
function evaluateVoices(
  voices: readonly SynthVoice[],
  combine: string,
  x: number,
  y: number,
  cx: number,
  cy: number,
  time: number,
): { combined: number; winner: number; active: number } {
  let combined = 0;
  let active = 0;
  let best = -Infinity;
  let winner = -1;
  let winnerOrder = -1;
  const argmax = combine === "argmax";
  for (let k = 0; k < SYNTH_VOICES; k++) {
    const voice = voices[k]!;
    if (!(voice.amp > 0)) continue;
    const vcx = cx + voice.originU;
    const vcy = cy + voice.originV;
    const o = synthOsc(voice.field, voice.wave, voice.freq, voice.speed, 1, x, y, vcx, vcy, time, voice.angle);
    if (argmax) {
      const contribution = voice.amp * o;
      if (contribution > best) { best = contribution; winner = k; winnerOrder = active; }
    } else if (active === 0) {
      combined = voice.amp * o;
    } else {
      combined += voice.amp * (combineSynth(combine, combined, o) - combined);
    }
    active++;
  }
  if (argmax) {
    // Evenly spaced flat levels across the range, one per ACTIVE voice, so the
    // ramp (or ink) reads each region as a single constant tone.
    combined = active > 1 ? (2 * winnerOrder + 1) / active - 1 : 0;
  }
  return { combined, winner, active };
}

function subcellFieldValue(
  voices: readonly SynthVoice[],
  combine: string,
  x: number,
  y: number,
  cx: number,
  cy: number,
  time: number,
): number {
  return evaluateVoices(voices, combine, x, y, cx, cy, time).combined;
}

// Reconstructs the per-cell coordinate gradient (change in resolved (x, y)
// per full cell step, right and down) by finite-differencing
// `fieldSynthCoordinate` at the neighboring cell indices. Exact for
// `space: "scene"` (the domain coordinate is affine in col/row there); a
// local-affine approximation everywhere else, matching the assumption the
// static field-synth exporter's affine-fit already relies on for the common
// flat-surface case. Falls back to the opposite neighbor at a grid edge, and
// to a zero gradient (all 8 subcells collapse to the cell-center sample) when
// a neighbor's coordinate is unavailable.
function fieldSynthSubcellGradient<P extends AnyParams>(
  context: AnyContext<P>,
  index: number,
  space: EffectSpace,
  uvBounds: boolean,
  scale: number,
  originU: number,
  originV: number,
  sceneCols: number,
  sceneRows: number,
  generatedSurface: GeneratedSurfaceField | null | undefined,
  x: number,
  y: number,
): readonly [number, number, number, number] {
  const cols = context.base.cols;
  const rows = context.base.rows;
  const col = index % cols;
  const row = (index / cols) | 0;
  let dxCol = 0, dyCol = 0, dxRow = 0, dyRow = 0;
  if (cols > 1) {
    const hasRight = col + 1 < cols;
    const rightIndex = hasRight ? index + 1 : index - 1;
    const right = fieldSynthCoordinate(context, rightIndex, space, uvBounds, scale, originU, originV, sceneCols, sceneRows, generatedSurface);
    if (right) {
      const sign = hasRight ? 1 : -1;
      dxCol = (right[0] - x) * sign;
      dyCol = (right[1] - y) * sign;
    }
  }
  if (rows > 1) {
    const hasDown = row + 1 < rows;
    const downIndex = hasDown ? index + cols : index - cols;
    const down = fieldSynthCoordinate(context, downIndex, space, uvBounds, scale, originU, originV, sceneCols, sceneRows, generatedSurface);
    if (down) {
      const sign = hasDown ? 1 : -1;
      dxRow = (down[0] - x) * sign;
      dyRow = (down[1] - y) * sign;
    }
  }
  return [dxCol, dyCol, dxRow, dyRow];
}

// Exported for the same reason as `synthWave` above — reuse the exact
// per-voice mix-weight fold instead of re-deriving it.
export function combineSynth(mode: string, a: number, b: number): number {
  switch (mode) {
    // Pairwise, argmax can only report the winning VALUE; the winning identity
    // is resolved by `evaluateVoices`, which sees the whole stack at once.
    case "argmax": return Math.max(a, b);
    case "add": return a + b;
    case "max": return Math.max(a, b);
    case "min": return Math.min(a, b);
    case "difference": return Math.abs(a - b);
    default: return a * b; // multiply
  }
}

const fieldSynthPresets: readonly GlyphEffectPreset<typeof fieldSynthSchema>[] = [
  // Three plane waves 60° apart, selected by IDENTITY: argmax gives each region
  // one flat tone, which is what turns a lattice into the rhombille/cube
  // tessellation. No value-combining op can express it — inside a region a
  // folded value keeps varying, and the illusion needs constants. Per-voice
  // colours paint the three cube faces; the ramp keeps it readable unlit too.
  // argmax regions traced as contours rather than shaded: an angular voice cuts
  // the plane into wedges while two counter-rotating radials fight over them, so
  // the winning region — and therefore the outline — keeps reorganising.
  { name: "Ink cells", params: { combine: "argmax", subcellRes: "ink", inkLevels: 1,
    scale: 0.9, gain: 1, bias: 0.4,
    field1: "angular", wave1: "triangle", freq1: 8, speed1: 0.65, amp1: 1,
    field2: "radial", wave2: "sin", freq2: 7, speed2: 1.3, amp2: 1,
    field3: "radial", wave3: "sin", freq3: 4, speed3: -0.65, amp3: 0.7,
    amp4: 0, amp5: 0, amp6: 0,
    voiceColors: true, color: "#ff5aa8", colorB: "#48f7ff", gradient: 1, lit: 1 } },
  { name: "Cube tiles", params: { combine: "argmax", scale: 12, gain: 3, bias: 1,
    // Drift, not shear: a rigid translation needs each wave's phase rate to be
    // its own normal projected on the drift direction, `speed = freq * (n · v)`.
    // For normals at 0°/60°/120° moving along +x that ratio is 1 : 0.5 : -0.5 —
    // equal speeds would pump the cells' areas instead of sliding the lattice.
    field1: "linearX", wave1: "triangle", freq1: 1, speed1: 0.6, amp1: 1, angle1: 0,
    field2: "linearX", wave2: "triangle", freq2: 1, speed2: 0.3, amp2: 1, angle2: 60,
    field3: "linearX", wave3: "triangle", freq3: 1, speed3: -0.3, amp3: 1, angle3: 120,
    // Exactly one glyph per region: with three voices the flat levels land on
    // 0.167/0.5/0.833, and a ramp with a leading space puts the lowest of those
    // on an exact .5 rounding boundary that floats to " " and punches holes.
    amp4: 0, amp5: 0, amp6: 0, glyphs: "░▒█", voiceColors: true,
    color1: "#f4f4f4", color2: "#d0d0d0", color3: "#6b6b6b", gradient: 0 } },
  { name: "Sunburst", params: { field1: "radial", wave1: "sin", freq1: 4, speed1: 0.6, amp1: 1, field2: "angular", wave2: "saw", freq2: 6, speed2: 0.3, amp2: 1, amp3: 0, combine: "multiply", scale: 2, glyphs: " .:-=+*#%@", color: "#ffcf5a", colorB: "#ff4fa3", gradient: 0.6 } },
  { name: "Ring pulse", params: { field1: "radial", wave1: "sin", freq1: 6, speed1: 0.5, amp1: 1, originU: 0.35, field2: "radial", wave2: "sin", freq2: 6, speed2: -0.5, amp2: 1, amp3: 0, combine: "add", scale: 2.5, glyphs: " ·:+*oO0", color: "#7df9ff", gradient: 0 } },
  { name: "Plaid weave", params: { field1: "linearX", wave1: "square", freq1: 5, speed1: 0.4, amp1: 1, field2: "linearY", wave2: "square", freq2: 5, speed2: 0.4, amp2: 1, amp3: 0, combine: "multiply", scale: 2, glyphs: " ▏▎▍▌▋▊▉█", color: "#8affc1", colorB: "#3a6df0", gradient: 1 } },
  { name: "Sonar ping", params: { field1: "radial", wave1: "sin", freq1: 10, speed1: 1.6, amp1: 1, amp2: 0, amp3: 0, combine: "add", scale: 2, gain: 1.6, bias: 0.2, glyphs: "  ·:+#", color: "#2effb0", gradient: 0 } },
  { name: "Lattice", params: { field1: "linearX", wave1: "sin", freq1: 6, speed1: 0.3, amp1: 1, field2: "linearY", wave2: "sin", freq2: 6, speed2: 0.4, amp2: 1, field3: "diagonal", wave3: "sin", freq3: 6, speed3: 0.2, amp3: 1, combine: "add", scale: 2, glyphs: " .-+*#", color: "#c78bff", colorB: "#00e5ff", gradient: 0.8 } },
  { name: "Vortex", params: { field1: "spiral", wave1: "saw", freq1: 5, speed1: 0.8, amp1: 1, field2: "angular", wave2: "sin", freq2: 3, speed2: -0.5, amp2: 0.7, amp3: 0, combine: "add", scale: 2, glyphs: " .:/\\|=+*", color: "#ff7a45", colorB: "#ffd24a", gradient: 0.7 } },
  { name: "Lava", params: { field1: "noise", wave1: "sin", freq1: 3, speed1: 0.5, amp1: 1, field2: "radial", wave2: "sin", freq2: 2, speed2: 0.3, amp2: 0.6, amp3: 0, combine: "add", scale: 2.5, gain: 1.3, glyphs: " .:-=+*#%@", color: "#ff3b1f", colorB: "#ffd24a", gradient: 1 } },
  { name: "Static rain", params: { field1: "noise", wave1: "sin", freq1: 8, speed1: 3, amp1: 1, field2: "linearY", wave2: "saw", freq2: 12, speed2: 2, amp2: 0.5, amp3: 0, combine: "multiply", scale: 3, glyphs: " .:i|1oX#", color: "#5affa0", gradient: 0 } },
  { name: "Moiré rings", params: { field1: "radial", wave1: "sin", freq1: 12, speed1: 0.4, amp1: 1, originU: 0.4, field2: "radial", wave2: "sin", freq2: 12.6, speed2: -0.4, amp2: 1, originV: 0.6, amp3: 0, combine: "multiply", scale: 2.5, glyphs: " .·:+*#", color: "#9df", gradient: 0.5 } },
  { name: "Checkerboard", params: { field1: "linearX", wave1: "square", freq1: 6, speed1: 0.2, amp1: 1, field2: "linearY", wave2: "square", freq2: 6, speed2: 0.2, amp2: 1, amp3: 0, combine: "difference", scale: 2, glyphs: " █", color: "#ffe08a", gradient: 0 } },
  { name: "Warp core", params: { field1: "radial", wave1: "saw", freq1: 8, speed1: 2, amp1: 1, field2: "angular", wave2: "sin", freq2: 8, speed2: 0.5, amp2: 0.8, amp3: 0, combine: "multiply", scale: 2, gain: 1.4, glyphs: " .:-=+*oO0#", color: "#00e5ff", colorB: "#c78bff", gradient: 1 } },
  { name: "Bubbles", params: { field1: "noise", wave1: "sin", freq1: 4, speed1: 0.4, amp1: 1, field2: "radial", wave2: "sin", freq2: 9, speed2: 0.9, amp2: 0.7, amp3: 0, combine: "max", scale: 3, gain: 1.5, bias: 0.1, glyphs: "  .oO0@", color: "#5ad1ff", gradient: 0 } },
  { name: "Aurora", params: { field1: "linearX", wave1: "sin", freq1: 2, speed1: 0.3, amp1: 1, field2: "noise", wave2: "sin", freq2: 3, speed2: 0.5, amp2: 0.8, field3: "linearY", wave3: "sin", freq3: 1.5, speed3: 0.2, amp3: 0.6, combine: "add", scale: 2.5, glyphs: " .:-=+*#", color: "#2effb0", colorB: "#7b5cff", gradient: 1 } },
  { name: "Zebra", params: { field1: "diagonal", wave1: "square", freq1: 8, speed1: 0.6, amp1: 1, amp2: 0, amp3: 0, combine: "add", scale: 2, glyphs: " █", color: "#f4f4f4", gradient: 0 } },
  { name: "Kaleidoscope", params: { field1: "angular", wave1: "triangle", freq1: 8, speed1: 0.4, amp1: 1, field2: "radial", wave2: "sin", freq2: 7, speed2: -0.3, amp2: 1, field3: "spiral", wave3: "sin", freq3: 4, speed3: 0.5, amp3: 0.7, combine: "multiply", scale: 2, glyphs: " .:-=+*#%@", color: "#ff5aa8", colorB: "#48f7ff", gradient: 1 } },
  { name: "Halftone", params: { field1: "radial", wave1: "sin", freq1: 14, speed1: 0.3, amp1: 1, field2: "linearX", wave2: "sin", freq2: 14, speed2: 0.3, amp2: 1, amp3: 0, combine: "min", scale: 2.5, gain: 2, glyphs: "  .oO@", color: "#ffffff", gradient: 0 } },
  { name: "Weave", params: { field1: "linearX", wave1: "triangle", freq1: 7, speed1: 0.4, amp1: 1, field2: "linearY", wave2: "triangle", freq2: 7, speed2: -0.4, amp2: 1, amp3: 0, combine: "add", scale: 2, glyphs: " ░▒▓█", color: "#8affc1", colorB: "#3a6df0", gradient: 1 } },
  { name: "Pulse grid", params: { field1: "linearX", wave1: "sin", freq1: 8, speed1: 1, amp1: 1, field2: "linearY", wave2: "sin", freq2: 8, speed2: 1, amp2: 1, amp3: 0, combine: "multiply", scale: 2, gain: 1.5, glyphs: "  ·:+#@", color: "#ffcf5a", gradient: 0 } },
  { name: "Nebula", params: { field1: "noise", wave1: "sin", freq1: 2, speed1: 0.2, amp1: 1, field2: "noise", wave2: "sin", freq2: 5, speed2: 0.4, amp2: 0.6, field3: "radial", wave3: "sin", freq3: 1.5, speed3: 0.1, amp3: 0.5, combine: "add", scale: 3, glyphs: " .:-=+*#%@", color: "#6a3cff", colorB: "#ff4fa3", gradient: 1 } },
];


/**
 * `subcellRes: "ink"` — contour the field instead of shading by its level, the
 * same way `mode: "ink"` outlines geometry instead of filling it. Like that
 * mode, it draws ONLY lines: interiors and plateaus stay empty, because an
 * outline of a flat region is not a fill, it is the region's edges — and a step
 * (a square wave) already presents those edges as an abrupt gradient the
 * crossing test picks up on its own.
 *
 * `inkLevels` cuts the amplitude axis into that many evenly spaced levels and
 * contours each, so one pass reads like a topographic map rather than a single
 * iso-line. A cell is inked when a level falls BETWEEN it and a neighbour (a
 * real crossing, not "this cell is near a level" — that is what makes a
 * continuous line rather than a scatter of marks). The stroke is then oriented
 * perpendicular to the local gradient, quantized into the same four 45° buckets
 * the geometry ink path uses.
 *
 * Glyphs are deliberately plain ASCII: box-drawing and Braille are missing from
 * common monospace faces and get served from a fallback at a DIFFERENT advance,
 * which desynchronizes the character grid (see the Braille notes in AGENTS.md).
 */
const INK_STROKES = ["-", "\\", "|", "/"] as const;
function inkGlyphForField(gx: number, gy: number): string {
  // Contour tangent is perpendicular to the gradient. Rows grow downward, so a
  // tangent heading right-and-down reads as "\".
  let angle = Math.atan2(gx, -gy);
  if (angle < 0) angle += Math.PI;
  const bucket = Math.round(angle / (Math.PI / 4)) % 4;
  return INK_STROKES[bucket]!;
}

export const fieldSynth: GlyphStockEffectDefinition<typeof fieldSynthSchema> = {
  id: "field-synth",
  version: 1,
  label: "Field synth",
  description: "Composable oscillators (field × waveform) combined into an animated glyph pattern over a surface.",
  defaultBlend: "replace",
  parameterSchema: fieldSynthSchema,
  presets: fieldSynthPresets,
  program: {
    optionalRequirements: ["normal", "worldPosition", "uv0", "baseShade"],
    validateParams(params) {
      validateGlyphRamp(params);
      validatePositiveScale(params);
    },
    evaluate(context) {
      const { params } = context;
      const shade = context.base.shade;
      const glyphs = glyphRamp(params.glyphs);
      const uvBounds = findUvBounds(context);
      const [sceneCols, sceneRows] = context.coordinates.sceneGridSize;
      const scale = params.scale;
      const generatedSurface = params.space !== "scene" && !(params.space === "auto" && uvBounds)
        ? generatedSurfaceField(context)
        : undefined;
      const cA = parseGlyphEffectColor(params.color);
      const cB = parseGlyphEffectColor(params.colorB);
      const useVoiceColors = params.voiceColors;
      const voices: readonly SynthVoice[] = [
        { field: params.field1, wave: params.wave1, freq: params.freq1, speed: params.speed1, amp: params.amp1, color: params.color1, angle: params.angle1, originU: params.originU1, originV: params.originV1 },
        { field: params.field2, wave: params.wave2, freq: params.freq2, speed: params.speed2, amp: params.amp2, color: params.color2, angle: params.angle2, originU: params.originU2, originV: params.originV2 },
        { field: params.field3, wave: params.wave3, freq: params.freq3, speed: params.speed3, amp: params.amp3, color: params.color3, angle: params.angle3, originU: params.originU3, originV: params.originV3 },
        { field: params.field4, wave: params.wave4, freq: params.freq4, speed: params.speed4, amp: params.amp4, color: params.color4, angle: params.angle4, originU: params.originU4, originV: params.originV4 },
        { field: params.field5, wave: params.wave5, freq: params.freq5, speed: params.speed5, amp: params.amp5, color: params.color5, angle: params.angle5, originU: params.originU5, originV: params.originV5 },
        { field: params.field6, wave: params.wave6, freq: params.freq6, speed: params.speed6, amp: params.amp6, color: params.color6, angle: params.angle6, originU: params.originU6, originV: params.originV6 },
      ];
      const parsedVoiceColors = useVoiceColors ? voices.map((voice) => parseGlyphEffectColor(voice.color)) : undefined;
      const time = params.time;
      const rampMax = glyphs.length - 1;
      for (let i = 0; i < context.base.length; i++) {
        if (context.target.coverage[i]! <= 0) continue;
        const coord = fieldSynthCoordinate(
          context,
          i,
          params.space as EffectSpace,
          uvBounds,
          scale,
          params.originU,
          params.originV,
          sceneCols,
          sceneRows,
          generatedSurface,
        );
        if (!coord) continue;
        const [x, y, cx, cy] = coord;
        // One evaluator for the whole stack (see `evaluateVoices`) so the
        // scalar here, the 2x4 subcell probes and the ink gradient probes can
        // never disagree about what the patch sounds like. `amp` is a MIX
        // WEIGHT, not a signal gain: the first voice enters at its weight, each
        // later voice blends the result toward `combine(result, voice)` by its
        // amp. So amp 0 = no effect, amp 1 = full combine, low amp gently mixes
        // instead of `multiply` crushing the field to zero.
        const stack = evaluateVoices(voices, params.combine, x, y, cx, cy, time);
        const combined = stack.combined;
        const active = stack.active;
        // Two weight sums: `cw` (amp * |osc|) is the true per-cell contribution
        // and drives the normal blend; `caw` (amp alone) is always > 0 for an
        // active voice and only feeds the fallback below, for cells where every
        // voice sits on a zero-crossing.
        let cr = 0, cg = 0, cbv = 0, cw = 0, co = 0;
        let car = 0, cag = 0, cabv = 0, cao = 0, caw = 0;
        if (parsedVoiceColors) {
          if (stack.winner >= 0) {
            // argmax is categorical: the region belongs to ONE voice, so it
            // takes that voice's colour flat rather than a blend of all of them.
            const c = parsedVoiceColors[stack.winner]!;
            cr = (c.packed >> 16) & 0xff; cg = (c.packed >> 8) & 0xff; cbv = c.packed & 0xff;
            co = c.opacity; cw = 1;
            car = cr; cag = cg; cabv = cbv; cao = co; caw = 1;
          } else {
            for (let k = 0; k < SYNTH_VOICES; k++) {
              const voice = voices[k]!;
              if (!(voice.amp > 0)) continue;
              const o = synthOsc(
                voice.field, voice.wave, voice.freq, voice.speed, 1,
                x, y, cx + voice.originU, cy + voice.originV, time, voice.angle,
              );
              const w = voice.amp * Math.abs(o);
              const c = parsedVoiceColors[k]!;
              const r = (c.packed >> 16) & 0xff, g = (c.packed >> 8) & 0xff, b = c.packed & 0xff;
              cr += r * w; cg += g * w; cbv += b * w; co += c.opacity * w; cw += w;
              car += r * voice.amp; cag += g * voice.amp; cabv += b * voice.amp;
              cao += c.opacity * voice.amp; caw += voice.amp;
            }
          }
        }
        if (active === 0) continue;
        const value = clamp01(params.bias + params.gain * combined * 0.5);
        const inkMode = params.subcellRes === "ink";
        // A contour cell can sit BELOW the level — it is one side of a crossing.
        // Dropping it here would draw only the inner edge of every contour.
        if (!inkMode && value <= 0) continue;
        if (inkMode) {
          const [dxCol, dyCol, dxRow, dyRow] = fieldSynthSubcellGradient(
            context, i, params.space as EffectSpace, uvBounds, scale, params.originU, params.originV,
            sceneCols, sceneRows, generatedSurface, x, y,
          );
          const sample = (ox: number, oy: number): number =>
            clamp01(params.bias + params.gain * subcellFieldValue(voices, params.combine, x + ox, y + oy, cx, cy, time) * 0.5);
          const right = sample(dxCol, dyCol);
          const down = sample(dxRow, dyRow);
          const gx = right - value;
          const gy = down - value;
          // Contour every level, not just one: `n / (levels + 1)` spreads the
          // cuts across the interior of the range so neither extreme (a flat
          // floor or a saturated ceiling) gets a degenerate line of its own.
          const levels = Math.max(1, Math.round(params.inkLevels));
          let crosses = false;
          for (let n = 1; n <= levels && !crosses; n++) {
            const level = n / (levels + 1);
            const side = value >= level;
            crosses = side !== (right >= level) || side !== (down >= level);
          }
          if (!crosses) continue;
          setGlyph(context, i, inkGlyphForField(gx, gy));
        } else if (params.subcellRes === "2x4") {
          const [dxCol, dyCol, dxRow, dyRow] = fieldSynthSubcellGradient(
            context, i, params.space as EffectSpace, uvBounds, scale, params.originU, params.originV,
            sceneCols, sceneRows, generatedSurface, x, y,
          );
          let mask = 0;
          for (let dotCol = 0; dotCol < 2; dotCol++) {
            const fx = dotCol === 0 ? -0.25 : 0.25;
            for (let dotRow = 0; dotRow < 4; dotRow++) {
              const fy = (dotRow + 0.5) / 4 - 0.5;
              const subX = x + fx * dxCol + fy * dxRow;
              const subY = y + fx * dyCol + fy * dyRow;
              const subCombined = subcellFieldValue(voices, params.combine, subX, subY, cx, cy, time);
              const subValue = clamp01(params.bias + params.gain * subCombined * 0.5);
              if (subValue > 0.5) mask |= BRAILLE_DOT_BITS[dotCol]![dotRow]!;
            }
          }
          setGlyph(context, i, String.fromCharCode(0x2800 + mask));
        } else {
          setGlyph(context, i, glyphs[Math.min(rampMax, Math.max(0, Math.round(value * rampMax)))]!);
        }
        let packed: number;
        let resolvedOpacity: number;
        if (parsedVoiceColors && cw > 0) {
          packed = (Math.round(cr / cw) << 16) | (Math.round(cg / cw) << 8) | Math.round(cbv / cw);
          resolvedOpacity = co / cw;
        } else if (parsedVoiceColors && caw > 0) {
          packed = (Math.round(car / caw) << 16) | (Math.round(cag / caw) << 8) | Math.round(cabv / caw);
          resolvedOpacity = cao / caw;
        } else {
          packed = params.gradient > 0 ? lerpPacked(cA.packed, cB.packed, clamp01(value * params.gradient)) : cA.packed;
          resolvedOpacity = cA.opacity;
        }
        // Modulate by the surface's Lambert shade so lighting reads through the
        // texture (lit=1 → full shading, lit=0 → flat/unlit).
        if (params.lit > 0 && shade) {
          const sh = shade[i]!;
          if (Number.isFinite(sh)) packed = scalePackedColor(packed, 1 - params.lit * (1 - clamp01(sh)));
        }
        setColor(context, i, packed);
        // Shaded modes fade a cell by its level; an inked cell is a decision, not
        // a level — half a contour lies BELOW the iso-level and would render
        // almost invisible if its coverage were scaled by it.
        context.output.coverage[i] = inkMode ? resolvedOpacity : value * resolvedOpacity;
      }
    },
  },
};

// Named glyph ramps (dark → dense) for effects that map a scalar to a character.
export const GlyphRamps: Record<string, string> = {
  Fade: " .:-=+*#%@",
  Blocks: " ░▒▓█",
  Shades: " .·:;+=xX#",
  Dots: " .·•●",
  Binary: " 01",
  ASCII: " .,:;i1tfLCG08@",
  Hatch: " .-+=#",
  Stars: " .+*✦★",
  Digital: " .:i|1oX#",
};

export const GlyphEffects = {
  matrixRain,
  flowText,
  scan,
  wipe,
  scramble,
  glitch,
  noiseDissolve,
  ripple,
  fieldSynth,
} as const;

export const GlyphEffectCatalog = Object.freeze(Object.values(GlyphEffects));

export type GlyphEffectId = (typeof GlyphEffectCatalog)[number]["id"];
export type GlyphStockEffect = (typeof GlyphEffectCatalog)[number];

const registry = new Map<string, GlyphStockEffect>(
  GlyphEffectCatalog.map((effect) => [effect.id, effect]),
);

export function getGlyphEffect(id: string): GlyphStockEffect | undefined {
  return registry.get(id);
}

export function defaultGlyphEffectParams<Schema extends GlyphEffectParamSchema>(
  definition: GlyphStockEffectDefinition<Schema>,
): GlyphEffectParamValues<Schema> {
  const params: Record<string, number | string | boolean> = {};
  for (const [key, spec] of Object.entries(definition.parameterSchema)) params[key] = spec.default;
  return params as GlyphEffectParamValues<Schema>;
}

export function glyphEffectHasColor(definition: GlyphStockEffectDefinition): boolean {
  return Object.values(definition.parameterSchema).some((spec) => spec.kind === "color");
}

export { GlyphEffectNoColor };
