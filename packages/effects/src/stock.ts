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
import {
  buildGlyphFieldDistanceOracle,
  combineSynth,
  effectiveVoiceFinestFreq,
  evaluateFieldProgram,
  fieldStepCount,
  integrateField,
  marchField,
  marchGlyphFieldSphere,
  sampleFieldVoice,
  validateGlyphFieldProgram,
  SYNTH_COMBINES,
  SYNTH_FIELDS,
  SYNTH_WAVES,
  synthWave,
  type FieldLayer,
  type FieldProgram,
  type FieldVoice,
} from "./fieldProgram";

// Re-exported so `staticExport.ts` and the wider `@glyphcss/effects` public
// surface keep importing these names from "./stock" unchanged — the field
// program IR (voices, layers, `evaluateFieldProgram`, `marchField`) now lives
// in `fieldProgram.ts`, but these three predate the IR split and have
// external consumers.
export { combineSynth, SYNTH_COMBINES, SYNTH_FIELDS, SYNTH_WAVES, synthWave };

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

// Stable rule identifiers for every `fieldSynth.program.validateParams` throw
// site (VOLUMETRIC-2.md §4 P2 fix). The website's URL hydration repair table
// used to mirror these throw sites by hand — a manually maintained list whose
// own "completeness" test asserted its length against itself, catching
// nothing. Tagging each thrown error's `code` with one of these ids, and
// exporting the id list, gives the website a REAL cross-package contract: it
// can key its repair table by id and assert every exported id is covered,
// so a validator added here without a matching website row/coercion entry
// fails the website test via this array, not a hand-mirror.
//
// `validatePositiveScale` is shared by matrixRain/flowText/scan too — tagging
// its thrown error with `"non-positive-scale"` is harmless there (those
// effects never read `.code`) and keeps the tag in exactly one place instead
// of duplicated per call site.
export const GLYPH_FIELD_SYNTH_VALIDATION_RULES = [
  "empty-glyphs",
  "non-positive-scale",
  "multi-layer-argmax",
  "carve-requires-object-space",
  "xray-subcell-unsupported",
] as const;
export type GlyphFieldSynthValidationRuleId = typeof GLYPH_FIELD_SYNTH_VALIDATION_RULES[number];

export interface GlyphFieldSynthValidationError extends Error {
  readonly code: GlyphFieldSynthValidationRuleId;
}

function taggedValidationError<E extends Error>(error: E, code: GlyphFieldSynthValidationRuleId): E {
  return Object.assign(error, { code });
}

function validateGlyphs(params: Readonly<{ glyphs: string }>): void {
  if (parseGlyphPattern(params.glyphs).length === 0) {
    throw new TypeError("glyphcss effect glyphs must contain at least one printable single-cell character");
  }
}

function validateGlyphRamp(params: Readonly<{ glyphs: string }>): void {
  if (parseGlyphRamp(params.glyphs).length === 0) {
    throw taggedValidationError(
      new TypeError("glyphcss effect glyphs must contain at least one printable single-cell character"),
      "empty-glyphs",
    );
  }
}

function validatePositiveScale(params: Readonly<{ scale: number }>): void {
  if (!(params.scale > 0)) {
    throw taggedValidationError(new RangeError("glyphcss effect scale must be greater than zero"), "non-positive-scale");
  }
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
// `space`. The actual evaluation (voices, layers, waveform/noise primitives)
// lives in `fieldProgram.ts` as the field-program IR (see VOLUMETRIC.md's
// "The field program IR"); this module compiles the flat schema down to that
// IR once per `evaluate()` call and re-exports a few of its pieces that
// already have external consumers (`staticExport.ts`, the website).

// `SYNTH_VOICES` caps the flat SCHEMA only — see fieldProgram.ts's module doc
// for why the IR/evaluator stay uncapped. 6 -> 9 (VOLUMETRIC-3.md §4): voices
// 7-9's key families are appended at the schema TAIL (see `fieldSynthSchema`
// below), never interleaved into the voice1..6 blocks — append-only ordering
// is load-bearing for the /synth URL codec's positional decode.
export const SYNTH_VOICES = 9;

// Voice layers (VOLUMETRIC.md's Step 3) cap the flat SCHEMA at 3 layer slots
// — the IR's `FieldProgram.layers` itself is length-free, same relationship
// `SYNTH_VOICES` has to the voice IR.
export const SYNTH_LAYERS = 3;

// `subcellRes: "ink"`'s contour count. Shared by the schema bound below AND
// the evaluate-path clamp (see `inkLevels` usage in `computeFieldSynthPoint`'s
// caller) so a hostile URL that sets `inkLevels` far past the schema's own
// slider max (e.g. 5e6) can't turn the per-cell level-crossing loop into a
// tab-hanging scan — the repair gate only catches enum/string violations,
// never a numeric range, so the evaluate path must clamp itself.
export const INK_LEVELS_MAX = 12;

// `layerBlendL` (how a layer's shaped output enters the stack) has no
// "argmax" value — layers are value-folded, not selected by identity (see
// `FieldLayer.blend`'s doc in fieldProgram.ts). `layerCombineL` (the
// intra-layer VOICE fold) reuses this same non-argmax set plus "inherit",
// which resolves to the patch-level `combine` at compile time — the only way
// a layer's resolved combine becomes "argmax" is by inheriting a
// patch-level `combine: "argmax"`, never by an explicit per-layer override.
// This is what keeps `validateFieldSynthLayers` simple (see below).
const LAYER_VALUE_OPS = ["add", "multiply", "max", "min", "difference"] as const;
const LAYER_COMBINE_VALUES = [...LAYER_VALUE_OPS, "inherit"] as const;

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
  inkLevels: { kind: "number", default: 4, min: 1, max: INK_LEVELS_MAX, step: 1, label: "Ink levels" },
  color: { kind: "color", default: "#7df9ff", label: "Color" },
  colorB: { kind: "color", default: "#ff4fa3", label: "Color B" },
  gradient: { kind: "number", default: 0, min: 0, max: 1, step: 0.05, label: "Gradient" },
  lit: { kind: "number", default: 1, min: 0, max: 1, step: 0.05, label: "Lighting" },
  // Per-voice colors: when on, each cell's color is the contribution-weighted blend
  // of the active voices' colors (composes colors through the mix). Off keeps the
  // single color/colorB gradient (so existing presets are unchanged).
  // Documented no-op under render: "xray" (VOLUMETRIC-2.md §1) — xray's
  // brightness comes from an absorption integral over the WHOLE chord, not a
  // single winning voice/point, so there is no coherent per-voice color to
  // report; it always uses the plain color/colorB gradient. The UI hides the
  // toggle under xray (a website concern, not enforced here).
  voiceColors: { kind: "boolean", default: false, animation: "discrete", label: "Per-voice colors" },
  color1: { kind: "color", default: "#7df9ff", label: "Voice 1 color" },
  color2: { kind: "color", default: "#ff4fa3", label: "Voice 2 color" },
  color3: { kind: "color", default: "#8affc1", label: "Voice 3 color" },
  color4: { kind: "color", default: "#ffcf5a", label: "Voice 4 color" },
  color5: { kind: "color", default: "#c78bff", label: "Voice 5 color" },
  color6: { kind: "color", default: "#ff7a45", label: "Voice 6 color" },
  // Appended after every pre-existing key (VOLUMETRIC.md's Step 2: append-
  // only ordering is load-bearing for the /synth URL codec's positional
  // decode). Defaults reproduce today's behavior exactly: duty 0.5 is the
  // pre-duty `p < 0.5` square split, phase 0 adds nothing to the wave
  // argument, originW 0 leaves the volumetric branch's Z origin untouched.
  duty1: { kind: "number", default: 0.5, min: 0, max: 1, step: 0.01, label: "Osc 1 duty" },
  duty2: { kind: "number", default: 0.5, min: 0, max: 1, step: 0.01, label: "Osc 2 duty" },
  duty3: { kind: "number", default: 0.5, min: 0, max: 1, step: 0.01, label: "Osc 3 duty" },
  duty4: { kind: "number", default: 0.5, min: 0, max: 1, step: 0.01, label: "Osc 4 duty" },
  duty5: { kind: "number", default: 0.5, min: 0, max: 1, step: 0.01, label: "Osc 5 duty" },
  duty6: { kind: "number", default: 0.5, min: 0, max: 1, step: 0.01, label: "Osc 6 duty" },
  // Cycles. Schema min/max/step are UI hints, not validation — a preset value
  // like -1/3 (the Menger middle-third selector) is carried at full float
  // precision regardless of `step`.
  phase1: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, unit: "cyc", label: "Osc 1 phase" },
  phase2: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, unit: "cyc", label: "Osc 2 phase" },
  phase3: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, unit: "cyc", label: "Osc 3 phase" },
  phase4: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, unit: "cyc", label: "Osc 4 phase" },
  phase5: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, unit: "cyc", label: "Osc 5 phase" },
  phase6: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, unit: "cyc", label: "Osc 6 phase" },
  // Volumetric-branch-only third origin component (see "Domain" in
  // VOLUMETRIC.md's Step 2) — a no-op in the 2D branch.
  originW1: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 1 origin W" },
  originW2: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 2 origin W" },
  originW3: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 3 origin W" },
  originW4: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 4 origin W" },
  originW5: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 5 origin W" },
  originW6: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 6 origin W" },
  // Appended after every pre-existing key (VOLUMETRIC.md's Step 3: voice
  // layers). Default 1 for every voice's layer assignment means "layer 1,
  // shaping off" — a single-layer stack whose fold is exactly today's flat
  // fold (structural backward compatibility; see `compileFieldSynthProgram`).
  layer1: { kind: "number", default: 1, min: 1, max: SYNTH_LAYERS, step: 1, label: "Osc 1 layer" },
  layer2: { kind: "number", default: 1, min: 1, max: SYNTH_LAYERS, step: 1, label: "Osc 2 layer" },
  layer3: { kind: "number", default: 1, min: 1, max: SYNTH_LAYERS, step: 1, label: "Osc 3 layer" },
  layer4: { kind: "number", default: 1, min: 1, max: SYNTH_LAYERS, step: 1, label: "Osc 4 layer" },
  layer5: { kind: "number", default: 1, min: 1, max: SYNTH_LAYERS, step: 1, label: "Osc 5 layer" },
  layer6: { kind: "number", default: 1, min: 1, max: SYNTH_LAYERS, step: 1, label: "Osc 6 layer" },
  // Default "inherit" resolves to the patch-level `combine` at compile time —
  // a single populated layer (today's shape) folds exactly like `combine`
  // always has.
  layerCombine1: { kind: "string", default: "inherit", values: LAYER_COMBINE_VALUES, animation: "discrete", label: "Layer 1 combine" },
  layerCombine2: { kind: "string", default: "inherit", values: LAYER_COMBINE_VALUES, animation: "discrete", label: "Layer 2 combine" },
  layerCombine3: { kind: "string", default: "inherit", values: LAYER_COMBINE_VALUES, animation: "discrete", label: "Layer 3 combine" },
  layerThresholdOn1: { kind: "boolean", default: false, animation: "discrete", label: "Layer 1 threshold on" },
  layerThresholdOn2: { kind: "boolean", default: false, animation: "discrete", label: "Layer 2 threshold on" },
  layerThresholdOn3: { kind: "boolean", default: false, animation: "discrete", label: "Layer 3 threshold on" },
  // Range -3..3: an add-fold of three amp-1 voices spans +-3 (VOLUMETRIC.md's
  // Step 3 — a +-1..1 range could not express "all three axes mid").
  layerThreshold1: { kind: "number", default: 0, min: -3, max: 3, step: 0.05, label: "Layer 1 threshold" },
  layerThreshold2: { kind: "number", default: 0, min: -3, max: 3, step: 0.05, label: "Layer 2 threshold" },
  layerThreshold3: { kind: "number", default: 0, min: -3, max: 3, step: 0.05, label: "Layer 3 threshold" },
  layerInvert1: { kind: "boolean", default: false, animation: "discrete", label: "Layer 1 invert" },
  layerInvert2: { kind: "boolean", default: false, animation: "discrete", label: "Layer 2 invert" },
  layerInvert3: { kind: "boolean", default: false, animation: "discrete", label: "Layer 3 invert" },
  layerBlend1: { kind: "string", default: "multiply", values: LAYER_VALUE_OPS, animation: "discrete", label: "Layer 1 blend" },
  layerBlend2: { kind: "string", default: "multiply", values: LAYER_VALUE_OPS, animation: "discrete", label: "Layer 2 blend" },
  layerBlend3: { kind: "string", default: "multiply", values: LAYER_VALUE_OPS, animation: "discrete", label: "Layer 3 blend" },
  layerAmp1: { kind: "number", default: 1, min: 0, max: 1, step: 0.05, label: "Layer 1 amp" },
  layerAmp2: { kind: "number", default: 1, min: 0, max: 1, step: 0.05, label: "Layer 2 amp" },
  layerAmp3: { kind: "number", default: 1, min: 0, max: 1, step: 0.05, label: "Layer 3 amp" },
  // Appended after every pre-existing key (VOLUMETRIC.md's Carve mode /
  // VOLUMETRIC-2.md's "March view modes": append-only ordering is load-
  // bearing for the /synth URL codec's positional decode). "paint" (default)
  // reproduces today's behavior exactly; "carve" and "xray" both require the
  // volumetric branch (`validateFieldSynthRender` below) — carve raymarches
  // for the first interior hit, xray integrates transmittance along the
  // whole chord instead of shading the entry surface.
  render: { kind: "string", default: "paint", values: ["paint", "carve", "xray"], animation: "discrete", label: "Render" },
  // Minimum march step count; the implementation raises this per cell via a
  // Nyquist floor (`ceil(2 * chordLength * finestActiveFreq)`) so thin solid
  // walls don't skip past the sampling grid. `bench/carve-march.mjs` measures
  // the depth-2 Menger recipe over a 120x48/half-covered grid: 32 steps ~2.5ms,
  // 48 ~3.3ms, 96 ~5.3ms per evaluate() call (Node, M-series laptop) — 48 stays
  // well under a 16.6ms/60fps budget for one layer while resolving the recipe's
  // finest (1/9-domain) features comfortably; see bench/carve-march.md. xray
  // reads this as its minimum step floor too, but resolves ONE step count for
  // the whole evaluate() pass (see the `xrayActive` block below), not a
  // per-cell one.
  marchSteps: { kind: "number", default: 48, min: 1, max: 256, step: 1, label: "March steps" },
  // Domain units; `exp(-marchFade * distance)` fades an interior hit's color
  // toward black with depth. 0 disables the falloff (factor stays 1). Carve
  // only — xray has its own `xrayGain` (see below for why the two can't share
  // one knob).
  marchFade: { kind: "number", default: 1, min: 0, max: 8, step: 0.05, label: "March fade" },
  // Appended after every pre-existing key (VOLUMETRIC-2.md §1 "March view
  // modes" — append-only ordering is load-bearing for the /synth URL codec's
  // positional decode). xray's own absorption gain, deliberately NOT
  // `marchFade`: at `marchFade`'s default of 1 a fully solid unit chord only
  // reaches brightness ~0.63 and a typical preset domain (span ~1) never
  // saturates, and `0` means opposite things in the two modes (no fade in
  // carve vs. fully invisible in xray).
  xrayGain: { kind: "number", default: 4, min: 0, max: 16, step: 0.05, label: "Xray gain" },
  // Appended after every pre-existing key (VOLUMETRIC-2.md §2: append-only
  // ordering is load-bearing for the /synth URL codec's positional decode).
  // Menger/Sierpinski recursion depth; every other field ignores it. Capped
  // at 4 because carve/xray's march resolution caps at 256 steps — menger
  // iter 4 needs ~162 steps on a unit chord and fits, iter 5 needs ~486 and
  // would render guaranteed false holes (see `effectiveVoiceFinestFreq`,
  // fieldProgram.ts). Default 3 matches `clampSdfIter`'s own fallback there,
  // so a hand-built IR voice that omits `iter` behaves identically to a
  // schema voice at its default.
  iter1: { kind: "number", default: 3, min: 1, max: 4, step: 1, label: "Osc 1 iterations" },
  iter2: { kind: "number", default: 3, min: 1, max: 4, step: 1, label: "Osc 2 iterations" },
  iter3: { kind: "number", default: 3, min: 1, max: 4, step: 1, label: "Osc 3 iterations" },
  iter4: { kind: "number", default: 3, min: 1, max: 4, step: 1, label: "Osc 4 iterations" },
  iter5: { kind: "number", default: 3, min: 1, max: 4, step: 1, label: "Osc 5 iterations" },
  iter6: { kind: "number", default: 3, min: 1, max: 4, step: 1, label: "Osc 6 iterations" },
  // Appended after every pre-existing key (VOLUMETRIC-3.md §2: append-only
  // ordering is load-bearing for the /synth URL codec's positional decode).
  // Ink-over-carve's contour spacing, in ABSOLUTE domain units — deliberately
  // NOT a fraction of the observed depth range (that would make contours
  // crawl frame-to-frame under orbit, differ across output grids, and
  // degenerate on a flat wall). Documented no-op under 2D `subcellRes: "ink"`
  // (that path keeps `inkLevels`) and under any non-carve render.
  inkSpacing: { kind: "number", default: 0.25, min: 0.05, max: 4, step: 0.05, label: "Ink spacing" },
  // Appended after every pre-existing key (VOLUMETRIC-3.md §4: SYNTH_VOICES
  // 6 -> 9 — append-only ordering is load-bearing for the /synth URL codec's
  // positional decode). ALL 14 per-voice key families for the three new
  // voices, grouped by FAMILY (not by voice) — every family's voice7/8/9
  // triple together, in the same family order the module-load guard below
  // checks. amp7/8/9 default 0 (like voice3-6) so an untouched patch's fold
  // is unaffected by the new voices existing.
  field7: { kind: "string", default: "spiral", values: SYNTH_FIELDS, animation: "discrete", label: "Osc 7 field" },
  field8: { kind: "string", default: "diagonal", values: SYNTH_FIELDS, animation: "discrete", label: "Osc 8 field" },
  field9: { kind: "string", default: "noise", values: SYNTH_FIELDS, animation: "discrete", label: "Osc 9 field" },
  wave7: { kind: "string", default: "sin", values: SYNTH_WAVES, animation: "discrete", label: "Osc 7 wave" },
  wave8: { kind: "string", default: "sin", values: SYNTH_WAVES, animation: "discrete", label: "Osc 8 wave" },
  wave9: { kind: "string", default: "sin", values: SYNTH_WAVES, animation: "discrete", label: "Osc 9 wave" },
  freq7: { kind: "number", default: 6, min: 0, max: 96, step: 0.1, label: "Osc 7 freq" },
  freq8: { kind: "number", default: 7, min: 0, max: 96, step: 0.1, label: "Osc 8 freq" },
  freq9: { kind: "number", default: 8, min: 0, max: 96, step: 0.1, label: "Osc 9 freq" },
  speed7: { kind: "number", default: 0.4, min: -8, max: 8, step: 0.05, unit: "cyc/s", label: "Osc 7 speed" },
  speed8: { kind: "number", default: 0.4, min: -8, max: 8, step: 0.05, unit: "cyc/s", label: "Osc 8 speed" },
  speed9: { kind: "number", default: 0.4, min: -8, max: 8, step: 0.05, unit: "cyc/s", label: "Osc 9 speed" },
  amp7: { kind: "number", default: 0, min: 0, max: 1, step: 0.05, label: "Osc 7 amp" },
  amp8: { kind: "number", default: 0, min: 0, max: 1, step: 0.05, label: "Osc 8 amp" },
  amp9: { kind: "number", default: 0, min: 0, max: 1, step: 0.05, label: "Osc 9 amp" },
  angle7: { kind: "number", default: 0, min: -180, max: 180, step: 1, unit: "°", label: "Osc 7 angle" },
  angle8: { kind: "number", default: 0, min: -180, max: 180, step: 1, unit: "°", label: "Osc 8 angle" },
  angle9: { kind: "number", default: 0, min: -180, max: 180, step: 1, unit: "°", label: "Osc 9 angle" },
  originU7: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 7 origin U" },
  originU8: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 8 origin U" },
  originU9: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 9 origin U" },
  originV7: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 7 origin V" },
  originV8: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 8 origin V" },
  originV9: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 9 origin V" },
  originW7: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 7 origin W" },
  originW8: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 8 origin W" },
  originW9: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, label: "Osc 9 origin W" },
  duty7: { kind: "number", default: 0.5, min: 0, max: 1, step: 0.01, label: "Osc 7 duty" },
  duty8: { kind: "number", default: 0.5, min: 0, max: 1, step: 0.01, label: "Osc 8 duty" },
  duty9: { kind: "number", default: 0.5, min: 0, max: 1, step: 0.01, label: "Osc 9 duty" },
  phase7: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, unit: "cyc", label: "Osc 7 phase" },
  phase8: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, unit: "cyc", label: "Osc 8 phase" },
  phase9: { kind: "number", default: 0, min: -1, max: 1, step: 0.01, unit: "cyc", label: "Osc 9 phase" },
  iter7: { kind: "number", default: 3, min: 1, max: 4, step: 1, label: "Osc 7 iterations" },
  iter8: { kind: "number", default: 3, min: 1, max: 4, step: 1, label: "Osc 8 iterations" },
  iter9: { kind: "number", default: 3, min: 1, max: 4, step: 1, label: "Osc 9 iterations" },
  layer7: { kind: "number", default: 1, min: 1, max: SYNTH_LAYERS, step: 1, label: "Osc 7 layer" },
  layer8: { kind: "number", default: 1, min: 1, max: SYNTH_LAYERS, step: 1, label: "Osc 8 layer" },
  layer9: { kind: "number", default: 1, min: 1, max: SYNTH_LAYERS, step: 1, label: "Osc 9 layer" },
  color7: { kind: "color", default: "#5ad1ff", label: "Voice 7 color" },
  color8: { kind: "color", default: "#ffb454", label: "Voice 8 color" },
  color9: { kind: "color", default: "#ff5da2", label: "Voice 9 color" },
} as const satisfies GlyphEffectParamSchema;

// Every per-voice key family fieldSynth's evaluate() (via `SynthVoice`/
// `buildFieldSynthVoices`) and the field-program IR (`FieldVoice`) dereference
// — 14 total. Exported so a mutation test can exercise the checker below
// against a deliberately incomplete fake schema without needing to break the
// real module-load guard to prove it actually checks all 14 (VOLUMETRIC-3.md
// §4 acceptance 6: the guard used to check only 7 of 14, letting a future
// voice-count bump ship a partial block silently).
export const FIELD_SYNTH_VOICE_KEY_FAMILIES = [
  "field", "wave", "freq", "speed", "amp", "angle",
  "originU", "originV", "originW", "duty", "phase", "iter", "layer", "color",
] as const;

// Guards the per-voice literal accessors in fieldSynth's evaluate() below: if
// SYNTH_VOICES ever changes without the schema following, this fails loudly at
// module load instead of silently reading `undefined` through a stale cast.
// Exported (alongside `FIELD_SYNTH_VOICE_KEY_FAMILIES`) so the mutation test
// can call the SAME checker the module-load guard below invokes, rather than
// a parallel reimplementation that could drift from what's actually enforced.
export function assertFieldSynthVoiceSchemaComplete(
  schema: Readonly<Record<string, unknown>>,
  voiceCount: number,
): void {
  for (let voice = 1; voice <= voiceCount; voice++) {
    for (const prefix of FIELD_SYNTH_VOICE_KEY_FAMILIES) {
      if (!(`${prefix}${voice}` in schema)) {
        throw new Error(`glyphcss: field-synth schema is missing "${prefix}${voice}" for ${voiceCount} voices.`);
      }
    }
  }
}
assertFieldSynthVoiceSchemaComplete(fieldSynthSchema, SYNTH_VOICES);
for (let layer = 1; layer <= SYNTH_LAYERS; layer++) {
  for (const prefix of ["layerCombine", "layerThresholdOn", "layerThreshold", "layerInvert", "layerBlend", "layerAmp"] as const) {
    if (!(`${prefix}${layer}` in fieldSynthSchema)) {
      throw new Error(`glyphcss: field-synth schema is missing "${prefix}${layer}" for ${SYNTH_LAYERS} layers.`);
    }
  }
}

export interface SynthVoice {
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
  /** Volumetric-branch-only third origin component; unused in 2D. */
  readonly originW: number;
  /** Square wave's high fraction; other wave kinds ignore it. Default 0.5. */
  readonly duty: number;
  /** Cycles, added to the wave argument for every field/wave kind. Default 0. */
  readonly phase: number;
  /** Which of the (up to `SYNTH_LAYERS`) layers this voice folds into. Default 1. */
  readonly layer: number;
  /** Menger/Sierpinski recursion depth (schema range 1..4, default 3); every other field ignores it. */
  readonly iter: number;
}

// Reads field-synth's flat field1..6/layer1..6 params into the SynthVoice
// frontend shape (VOLUMETRIC.md's "The flat param schema is a frontend that
// compiles to the IR"). Exported so `evaluate()` below and the static
// exporter (`staticExport.ts`) build this list from the exact same code —
// the whole reason the static exporter's older port silently diverged on
// `angleN`/per-voice origins was a hand-copied second construction of this
// list that fell out of sync; a shared source makes that class of bug
// impossible.
export function buildFieldSynthVoices(params: AnyParams): readonly SynthVoice[] {
  const voices: SynthVoice[] = [];
  for (let k = 1; k <= SYNTH_VOICES; k++) {
    voices.push({
      field: params[`field${k}`] as string,
      wave: params[`wave${k}`] as string,
      freq: params[`freq${k}`] as number,
      speed: params[`speed${k}`] as number,
      amp: params[`amp${k}`] as number,
      color: params[`color${k}`] as string,
      angle: params[`angle${k}`] as number,
      originU: params[`originU${k}`] as number,
      originV: params[`originV${k}`] as number,
      originW: params[`originW${k}`] as number,
      duty: params[`duty${k}`] as number,
      phase: params[`phase${k}`] as number,
      layer: params[`layer${k}`] as number,
      iter: params[`iter${k}`] as number,
    });
  }
  return voices;
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
// mirrors that at 0x08,0x10,0x20,0x80. Exported so the static exporter's
// bake-time affine-fit safety check (`affineDecisionsMatch` in
// staticExport.ts) can verify a `subcellRes: "2x4"` patch's dot mask the
// exact same way this live path does, instead of a second, driftable copy.
export const BRAILLE_DOT_BITS: readonly (readonly [number, number, number, number])[] = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
];

// A compiled voice retains its schema-authored `layer` assignment alongside
// the IR's own `FieldVoice` shape — `compileFieldSynthProgram` groups by it,
// and the voiceColors fallback loop in `evaluate()` reads the FLAT list (see
// that function) so per-voice color contribution is never affected by which
// layer a voice happens to fold into.
export type CompiledFieldVoice = FieldVoice & { readonly layer: number };

// Voice origins are pre-scaled here (`* scale`) so `evaluateFieldProgram`
// never needs to know about `scale` at all — it only combines a voice's
// relative origin with the call-level origin it's given. Exported alongside
// `resolveFieldSynthLayerShapes`/`compileFieldSynthProgram` so the static
// exporter (`staticExport.ts`) compiles the SAME IR the live evaluator runs,
// instead of a second, driftable compile step (VOLUMETRIC.md: "the static
// exporter ports the IR evaluator, not the schema").
export function compileFieldVoices(voices: readonly SynthVoice[], scale: number): readonly CompiledFieldVoice[] {
  return voices.map((voice, sourceIndex) => ({
    field: voice.field,
    wave: voice.wave,
    freq: voice.freq,
    speed: voice.speed,
    amp: voice.amp,
    phase: voice.phase,
    duty: voice.duty,
    angle: voice.angle,
    origin: { u: voice.originU * scale, v: voice.originV * scale, w: voice.originW * scale },
    color: voice.color,
    layer: voice.layer,
    iter: voice.iter,
    // Flat position in `voices` (field-synth's voice1..6 order), the same
    // order `parsedVoiceColors` is indexed by — carried through so an argmax
    // winner reported by `evaluateFieldProgram` always identifies the
    // original voice, not its position within whichever layer it folded
    // into (see `FieldVoice.sourceIndex`'s doc).
    sourceIndex,
  }));
}

// Per-layer shaping, resolved once per `evaluate()` call from flat params
// (VOLUMETRIC.md's Step 3): `combine: "inherit"` (the schema default) resolves
// to the patch-level `combine`, which is what keeps a single-layer stack
// (today's shape, before layers existed) folding exactly like `combine`
// always has, including when `combine` is `"argmax"` (see
// `validateFieldSynthLayers` below for why an EXPLICIT per-layer override can
// never be `"argmax"` — the schema's `layerCombineL` values exclude it).
export interface FieldLayerShape {
  readonly combine: string;
  readonly thresholdOn: boolean;
  readonly threshold: number;
  readonly invert: boolean;
  readonly blend: string;
  readonly amp: number;
}

export function resolveFieldSynthLayerShapes(params: AnyParams): readonly FieldLayerShape[] {
  const patchCombine = params.combine as string;
  const shapes: FieldLayerShape[] = [];
  for (let l = 1; l <= SYNTH_LAYERS; l++) {
    const combineRaw = params[`layerCombine${l}`] as string;
    shapes.push({
      combine: combineRaw === "inherit" ? patchCombine : combineRaw,
      thresholdOn: params[`layerThresholdOn${l}`] as boolean,
      threshold: params[`layerThreshold${l}`] as number,
      invert: params[`layerInvert${l}`] as boolean,
      blend: params[`layerBlend${l}`] as string,
      amp: params[`layerAmp${l}`] as number,
    });
  }
  return shapes;
}

// Compiles field-synth's flat per-voice/per-layer params into the field
// program IR — the frontend→IR compile step (VOLUMETRIC.md's "The field
// program IR" and Step 3), called once per `evaluate()` call. A single
// populated layer with threshold/invert off and amp 1 (every voice's default
// `layer` is 1, every layer's default shape is that no-op) folds to exactly
// `combine`'s own output (see `evaluateFieldProgram`'s doc), which is what
// keeps every pre-layers preset byte-identical. Layers with no voices
// assigned are still emitted (not omitted) — `evaluateFieldProgram` already
// skips a layer with zero ACTIVE (amp > 0) voices at fold time, exactly like
// an amp-0 voice, so compile doesn't need to duplicate that logic.
export function compileFieldSynthProgram(
  compiledVoices: readonly CompiledFieldVoice[],
  layerShapes: readonly FieldLayerShape[],
  volumetric: boolean,
): FieldProgram {
  const layers: FieldLayer[] = layerShapes.map((shape, li) => ({
    voices: compiledVoices.filter((voice) => voice.layer === li + 1),
    combine: shape.combine,
    thresholdOn: shape.thresholdOn,
    threshold: shape.threshold,
    invert: shape.invert,
    blend: shape.blend,
    amp: shape.amp,
  }));
  return { domain: volumetric ? "3d" : "2d", layers };
}

// Effective-argmax validation (VOLUMETRIC.md's Step 3, "argmax and voice
// colors"): argmax stays categorical and single-layer. A patch is invalid
// when argmax is EFFECTIVE (a populated layer's resolved combine — its
// override, else the inherited patch-level `combine` — is "argmax") in more
// than one populated layer's worth of context, i.e. while MORE THAN ONE layer
// is populated. Because `layerCombineL`'s schema values exclude "argmax"
// entirely (see `LAYER_COMBINE_VALUES`), the only way a layer's resolved
// combine becomes "argmax" is by inheriting a patch-level `combine: "argmax"`
// — so a multi-layer patch whose every populated layer overrides to an
// explicit value op is valid regardless of the (then dead) patch-level
// `combine`, deliberately not validated. A single populated layer stays valid
// exactly as today, whatever it resolves to.
function validateFieldSynthLayers(params: AnyParams): void {
  const patchCombine = params.combine as string;
  const populated: boolean[] = new Array(SYNTH_LAYERS).fill(false) as boolean[];
  for (let k = 1; k <= SYNTH_VOICES; k++) {
    if (!((params[`amp${k}`] as number) > 0)) continue;
    const layer = params[`layer${k}`] as number;
    if (layer >= 1 && layer <= SYNTH_LAYERS) populated[layer - 1] = true;
  }
  if (populated.filter(Boolean).length <= 1) return; // single-layer argmax stays exactly as today
  for (let l = 1; l <= SYNTH_LAYERS; l++) {
    if (!populated[l - 1]) continue;
    const combineRaw = params[`layerCombine${l}`] as string;
    const resolved = combineRaw === "inherit" ? patchCombine : combineRaw;
    if (resolved === "argmax") {
      throw taggedValidationError(
        new TypeError(
          `glyphcss field-synth: layer ${l} resolves to combine "argmax" while more than one layer is populated — `
          + "argmax is categorical and stays single-layer (VOLUMETRIC.md's Step 3). Give it an explicit non-argmax "
          + `layerCombine${l} override, or reduce the patch to a single populated layer.`,
        ),
        "multi-layer-argmax",
      );
    }
  }
}

// Carve/xray march modes (VOLUMETRIC.md's "Carve mode (hollowness)",
// VOLUMETRIC-2.md §1 "March view modes"): both require the volumetric
// branch. In wireframe/voxel modes carve/xray degrade to paint at RUNTIME
// (no `objectPosition`/`objectExit` retained, same optional-requirement
// degradation `space: "object"` already uses) — that degradation can't be
// validated here, since `validateParams` never sees the render mode, only
// params.
//
// `subcellRes` rejection (VOLUMETRIC-3.md §2): carve+ink and carve+2x4 are
// now legal — carve's own march loop computes both directly (see
// `fieldSynth`'s `evaluate()`: the ink post-pass and the braille sub-ray
// probe). xray still rejects both: an accumulated transmittance integral has
// no per-cell hit point/depth for the ink/braille neighbor probes to read,
// unlike carve's first-hit search. This used to share `carve-subcell-
// unsupported` with carve's own (now-removed) rejection of the same pair —
// splitting the rule id keeps a valid carve+ink/2x4 URL from being
// "repaired" back to `1x1` by a repair-table row that no longer applies to
// carve (VOLUMETRIC-3.md §2, reviewer-caught).
function validateFieldSynthRender(params: AnyParams): void {
  if (params.render !== "carve" && params.render !== "xray") return;
  const mode = params.render as string;
  if (params.space !== "object") {
    throw taggedValidationError(
      new TypeError(
        `glyphcss field-synth: render: "${mode}" requires space: "object" (the volumetric branch) — ${mode} marches `
        + "objectPosition -> objectExit, which only exist for a volumetric patch.",
      ),
      "carve-requires-object-space",
    );
  }
  if (mode === "xray" && (params.subcellRes === "2x4" || params.subcellRes === "ink")) {
    throw taggedValidationError(
      new TypeError(
        `glyphcss field-synth: render: "xray" does not support subcellRes: "${params.subcellRes as string}" — an `
        + "accumulated transmittance integral has no per-cell hit point for the ink/braille neighbor probes to "
        + 'read. Use subcellRes: "1x1" with xray, or render: "carve" for a volumetric ink/braille outline.',
      ),
      "xray-subcell-unsupported",
    );
  }
}

// Reconstructs the per-cell coordinate gradient (change in resolved (x, y)
// per full cell step, right and down) by finite-differencing
// `fieldSynthCoordinate` at the neighboring cell indices. Exact for
// `space: "scene"` (the domain coordinate is affine in col/row there); a
// local-affine approximation everywhere else, matching the assumption the
// static field-synth exporter's affine-fit already relies on for the common
// flat-surface case. Falls back to the opposite neighbor at a grid edge, and
// to a zero gradient (all 8 subcells collapse to the cell-center sample) when
// a neighbor's coordinate is unavailable. Exported (2D-only — the exporter
// never reaches the volumetric branch, `space: "object"` is rejected before
// `bake()` runs) so `staticExport.ts` can bake the SAME gradient the live
// `subcellRes: "2x4"`/`"ink"` path reads, instead of a second, driftable
// derivation.
export function fieldSynthSubcellGradient<P extends AnyParams>(
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

// The volumetric-branch counterpart to `fieldSynthSubcellGradient`: the
// resolved coordinate is `objectPosition * scale` directly (see fieldSynth's
// `evaluate()`), so the neighbor probe finite-differences `objectPosition`
// itself instead of re-deriving it through `fieldSynthCoordinate` — same
// local-affine approximation, now in 3D (VOLUMETRIC.md's "Subcell modes").
function fieldSynthVolumetricSubcellGradient<P extends AnyParams>(
  context: AnyContext<P>,
  index: number,
  scale: number,
  x: number,
  y: number,
  z: number,
): readonly [number, number, number, number, number, number] {
  const cols = context.base.cols;
  const rows = context.base.rows;
  const col = index % cols;
  const row = (index / cols) | 0;
  const op = context.base.objectPosition!;
  let dxCol = 0, dyCol = 0, dzCol = 0, dxRow = 0, dyRow = 0, dzRow = 0;
  if (cols > 1) {
    const hasRight = col + 1 < cols;
    const rightIndex = hasRight ? index + 1 : index - 1;
    const rx = op[rightIndex * 3]!, ry = op[rightIndex * 3 + 1]!, rz = op[rightIndex * 3 + 2]!;
    if (Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(rz)) {
      const sign = hasRight ? 1 : -1;
      dxCol = (rx * scale - x) * sign;
      dyCol = (ry * scale - y) * sign;
      dzCol = (rz * scale - z) * sign;
    }
  }
  if (rows > 1) {
    const hasDown = row + 1 < rows;
    const downIndex = hasDown ? index + cols : index - cols;
    const dxp = op[downIndex * 3]!, dyp = op[downIndex * 3 + 1]!, dzp = op[downIndex * 3 + 2]!;
    if (Number.isFinite(dxp) && Number.isFinite(dyp) && Number.isFinite(dzp)) {
      const sign = hasDown ? 1 : -1;
      dxRow = (dxp * scale - x) * sign;
      dyRow = (dyp * scale - y) * sign;
      dzRow = (dzp * scale - z) * sign;
    }
  }
  return [dxCol, dyCol, dzCol, dxRow, dyRow, dzRow];
}

// Dispatches to the 2D or volumetric subcell gradient probe and normalizes
// both to the same 6-component (col, row) x/y/z shape — the 2D probe has no
// z gradient, so it pads with 0 in the correct (not spread-appended) slots.
function fieldSynthAnySubcellGradient<P extends AnyParams>(
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
  z: number,
  volumetric: boolean,
): readonly [number, number, number, number, number, number] {
  if (volumetric) return fieldSynthVolumetricSubcellGradient(context, index, scale, x, y, z);
  const [dxCol, dyCol, dxRow, dyRow] = fieldSynthSubcellGradient(
    context, index, space, uvBounds, scale, originU, originV, sceneCols, sceneRows, generatedSurface, x, y,
  );
  return [dxCol, dyCol, 0, dxRow, dyRow, 0];
}

// Per-cell result of evaluating the field program and (when `voiceColors` is
// on) its per-voice color contribution at one point — shared between the
// plain-ramp paint path and carve's hit-point emission (see `fieldSynth`'s
// `evaluate()`: `computeFieldSynthPoint`/`applyFieldSynthColor`), which is
// what makes carve's t=0 (an everywhere-solid field, or a degenerate-segment
// fallback) literally reuse paint's own code path rather than a hand-copied
// parallel implementation (VOLUMETRIC.md's Carve section: "the no-op
// equivalence test is derivable, not asserted").
interface FieldSynthPointSample {
  readonly active: number;
  readonly value: number;
  readonly cr: number;
  readonly cg: number;
  readonly cbv: number;
  readonly cw: number;
  readonly co: number;
  readonly car: number;
  readonly cag: number;
  readonly cabv: number;
  readonly cao: number;
  readonly caw: number;
}

// P1-B (VOLUMETRIC-2.md §3 fix review): these four presets are consumed
// elsewhere by OBJECT IDENTITY, not by display name — the website's
// `STAGE_HINTS` table (synthKit.tsx) needs a stable reference to "the Menger
// sponge preset" that survives a future rename of its `.name`. A name-keyed
// lookup at module load (`fieldSynthPresets.find(p => p.name === "...")`)
// would throw at import time the moment this file's `name` string and that
// lookup's string drift apart — not rename-proof, just rename-brittle at a
// different layer. Exporting the actual objects is the fix: importers hold
// the same reference `fieldSynthPresets` below reuses, so there is no name
// string to keep in sync and no lookup that can fail.
export const cubeTilesPreset: GlyphEffectPreset<typeof fieldSynthSchema> = {
  name: "Cube tiles", params: { combine: "argmax", scale: 12, gain: 3, bias: 1,
    // Drift, not shear: a rigid translation needs each wave's phase rate to be
    // its own normal projected on the drift direction, `speed = freq * (n · v)`.
    // For normals at 0°/60°/120° moving along +x that ratio is 1 : 0.5 : -0.5 —
    // equal speeds would pump the cells' areas instead of sliding the lattice.
    field1: "linearX", wave1: "triangle", freq1: 1, speed1: 0.6, amp1: 1, angle1: 0,
    field2: "linearX", wave2: "triangle", freq2: 1, speed2: 0.3, amp2: 1, angle2: 60,
    field3: "linearX", wave3: "triangle", freq3: 1, speed3: -0.3, amp3: 1, angle3: 120,
    // At gain 3 / bias 1 the three argmax levels clamp to {0, 1, 1}: the two lit
    // faces paint solid blocks in their voice colour, and the third lands on 0
    // and is skipped — the unpainted cells ARE the cube's shadowed face, which
    // is why this looks right despite ~a third of the grid staying blank. The
    // level sits exactly on the `value <= 0` boundary, so it is deliberate but
    // fragile; bias 0.95 would push it clearly negative for the same picture.
    amp4: 0, amp5: 0, amp6: 0, glyphs: "░▒█", voiceColors: true,
    color1: "#f4f4f4", color2: "#d0d0d0", color3: "#6b6b6b", gradient: 0 },
};

// The driving example from VOLUMETRIC.md: a Menger sponge carved out of a
// plain cube mesh, with no sponge geometry and no prepared playback. Recipe
// verbatim from the acceptance tests (stock.test.ts's `mengerParams(2)` /
// VOLUMETRIC.md's "The acceptance pattern: Menger membership"): per scale
// k, three axis voices (linearX/Y/Z), wave square, freq 3^(k-1), duty 1/3,
// phase -1/3 select that scale's middle third; each layer folds its three
// axes with add, thresholds at 0, inverts (solid = +1), and layers
// min-blend across scales — the ±1 AND: solid overall iff every scale says
// solid. `scale: 1/3` remaps the /synth page's centered size-3 cube
// (extent 3, -1.5..1.5) onto the one unit-domain period this recipe
// assumes; the square wave is exactly periodic in that domain, so a plain
// multiplicative scale (no offset) is enough to fill the cube with one
// full sponge regardless of where the domain's origin sits.
export const mengerSpongePreset: GlyphEffectPreset<typeof fieldSynthSchema> = {
  name: "Menger sponge", params: {
    space: "object", scale: 1 / 3, render: "carve", subcellRes: "1x1",
    field1: "linearX", wave1: "square", freq1: 1, speed1: 0, amp1: 1, duty1: 1 / 3, phase1: -1 / 3, layer1: 1,
    field2: "linearY", wave2: "square", freq2: 1, speed2: 0, amp2: 1, duty2: 1 / 3, phase2: -1 / 3, layer2: 1,
    field3: "linearZ", wave3: "square", freq3: 1, speed3: 0, amp3: 1, duty3: 1 / 3, phase3: -1 / 3, layer3: 1,
    layerCombine1: "add", layerThresholdOn1: true, layerThreshold1: 0, layerInvert1: true, layerBlend1: "min", layerAmp1: 1,
    field4: "linearX", wave4: "square", freq4: 3, speed4: 0, amp4: 1, duty4: 1 / 3, phase4: -1 / 3, layer4: 2,
    field5: "linearY", wave5: "square", freq5: 3, speed5: 0, amp5: 1, duty5: 1 / 3, phase5: -1 / 3, layer5: 2,
    field6: "linearZ", wave6: "square", freq6: 3, speed6: 0, amp6: 1, duty6: 1 / 3, phase6: -1 / 3, layer6: 2,
    layerCombine2: "add", layerThresholdOn2: true, layerThreshold2: 0, layerInvert2: true, layerBlend2: "min", layerAmp2: 1,
    glyphs: " .:-=+*#%@", color: "#8affc1", colorB: "#3a6df0", gradient: 0.4, lit: 1,
    // Raised from the schema default (1) — VOLUMETRIC-2.md §3's "menger
    // invisible at the oblique camera" backlog item. The /synth stage hint
    // table (SynthWorkbench) now points the camera at a face-on-ish angle
    // for this preset, but a shallower angle alone still reads as a flat,
    // evenly-lit texture — the carved holes need a depth cue independent of
    // viewing angle. A stronger `exp(-marchFade * distance)` interior falloff
    // supplies that: near (shallow) carved walls stay bright, walls several
    // recursion levels deep fade toward black, so the sponge's actual 3D
    // recursive structure pops even head-on.
    marchFade: 2.5,
  },
};

// The base-2 sibling of the Menger recipe above (VOLUMETRIC-2.md's
// addendum: "at every binary scale, at most one axis is in its upper
// half" — the corner-tetra Sierpinski rule), reusing the exact same
// per-scale shape (three axis voices, `add` fold, threshold at 0, invert,
// `min`-blend across scales) with base-2 constants instead of base-3:
// `duty 1/2`/`phase -1/2` select each axis's upper half instead of its
// middle third, and `freq 2^(k-1)` (1, then 2) doubles the lattice each
// scale instead of tripling it. Reviewer-verified numerically (see this
// file's header comment / VOLUMETRIC-2.md's addendum) and pinned against
// `sierpinskiSolidRef` (a hand-derived first-principles reference,
// independent of this recipe) in fieldProgram.test.ts and stock.test.ts.
//
// `scale: 1/3` mirrors the Menger preset's own domain-normalizing pin: the
// /synth `pyramid` stage's corner tetra is authored at `s = 3` (matching
// every other stage's `size: 3` footprint — see synthKit.tsx), so
// `1/scale = 3` remaps `objectPosition`'s `[0,3]^3` authoring box onto the
// `[0,1]^3` window this recipe's `phase -1/2` selectors assume. That
// window's own corner must sit at the domain origin (not centered) for the
// upper-half selectors to land in the right octants — the `pyramid` stage
// is authored uncentered for exactly this reason (see its vertices in
// synthKit.tsx).
export const sierpinskiPyramidPreset: GlyphEffectPreset<typeof fieldSynthSchema> = {
  name: "Sierpinski pyramid", params: {
    space: "object", scale: 1 / 3, render: "carve", subcellRes: "1x1",
    field1: "linearX", wave1: "square", freq1: 1, speed1: 0, amp1: 1, duty1: 1 / 2, phase1: -1 / 2, layer1: 1,
    field2: "linearY", wave2: "square", freq2: 1, speed2: 0, amp2: 1, duty2: 1 / 2, phase2: -1 / 2, layer2: 1,
    field3: "linearZ", wave3: "square", freq3: 1, speed3: 0, amp3: 1, duty3: 1 / 2, phase3: -1 / 2, layer3: 1,
    layerCombine1: "add", layerThresholdOn1: true, layerThreshold1: 0, layerInvert1: true, layerBlend1: "min", layerAmp1: 1,
    field4: "linearX", wave4: "square", freq4: 2, speed4: 0, amp4: 1, duty4: 1 / 2, phase4: -1 / 2, layer4: 2,
    field5: "linearY", wave5: "square", freq5: 2, speed5: 0, amp5: 1, duty5: 1 / 2, phase5: -1 / 2, layer5: 2,
    field6: "linearZ", wave6: "square", freq6: 2, speed6: 0, amp6: 1, duty6: 1 / 2, phase6: -1 / 2, layer6: 2,
    layerCombine2: "add", layerThresholdOn2: true, layerThreshold2: 0, layerInvert2: true, layerBlend2: "min", layerAmp2: 1,
    glyphs: " .:-=+*#%@", color: "#ffb454", colorB: "#ff5da2", gradient: 0.4, lit: 1,
    // A sane, moderate depth cue — same rationale as the Menger retrofit
    // above, at a lower value: the corner-tetra's own uncentered geometry
    // (mass concentrated toward one corner rather than spread through a
    // centered cube) already reads its recursive structure more readily
    // than a centered sponge does, so it needs less compensating fade.
    marchFade: 2,
  },
};

// A single `gyroid` voice, absorption-mode xray (VOLUMETRIC-2.md §1's own
// rationale: an oscillating field integrates to ~`bias` per unit length —
// "structure averages into fog" — unless shaped near-binary first).
// Thresholding the layer (not raising `gain`/`bias`) is the more literal
// fix: it turns the gyroid's continuous implicit into an exact two-level
// read of "which labyrinth half" at every point, at the SCHEMA's default
// bias/gain (0.5/1) — so absorbing through a hole-dominated chord and a
// solid-dominated chord land at genuinely different brightness levels
// (~0.53 vs ~0.90 at the tuned `xrayGain` below) instead of both washing
// out toward the same mid-gray fog average.
// `xrayGain: 1.5` (below the schema default of 4) is deliberate: at 4,
// even a hole-dominated chord's much weaker 0.25 density already
// integrates to near-total absorption over a couple of domain units,
// flattening the whole image to solid white and hiding exactly the
// structure this preset exists to show. 1.5 keeps both halves' brightness
// visibly distinct across the cube stage's typical chord lengths.
export const gyroidXrayPreset: GlyphEffectPreset<typeof fieldSynthSchema> = {
  name: "Gyroid xray", params: {
    space: "object", scale: 1, render: "xray", xrayGain: 1.5,
    field1: "gyroid", wave1: "sin", freq1: 2, speed1: 0, amp1: 1, phase1: 0,
    amp2: 0, amp3: 0,
    layerThresholdOn1: true, layerThreshold1: 0, layerInvert1: false,
    glyphs: " .:-=+*#%@", color: "#8fd8ff", colorB: "#c9a6ff", gradient: 0.6, lit: 1,
  },
};

// The sphere-tracing oracle's own fixtures (VOLUMETRIC-3.md §3): a genuine
// `field: "menger"`/`"sierpinski"` SDF voice, not the linear-voice recipe
// `mengerSpongePreset`/`sierpinskiPyramidPreset` use — those recipes can
// never qualify (`buildGlyphFieldDistanceOracle` only reads the SDF voice
// family), so no shipped preset exercised the sphere-tracing path before
// these two. Every condition of the qualifying predicate is met: one
// populated layer, `wave: "step"`, `amp1: 1`, `combine: "min"` (needed even
// with a single voice — the predicate checks it literally, VOLUMETRIC-3.md
// §3), `layerThresholdOn1` at its schema default `false`, and `bias`/`gain`
// left at their schema defaults (0.5/1), which already sit inside the
// step-selective regime (`0.5+0.5=1>0`, `0.5-0.5=0<=0`) — no preset-level
// override needed for that half of the predicate.
//
// `iter1: 3` is the task's requested depth (also the schema default) —
// deep enough to need many fixed-step samples per cell (matching the bench
// scenario below) while staying inside the 256-step cap comfortably at
// these frequencies.

// `field: "menger"` has no periodic reduction (VOLUMETRIC-2.md §2: a single
// fixed instance of the fractal, unlike the linear recipe's periodic square
// waves), so — unlike `mengerSpongePreset` — a plain multiplicative `scale`
// isn't enough to align it with the /synth cube stage's CENTERED authoring
// box (extent 3, -1.5..1.5): the fractal's own lattice domain is [0,1]^3,
// not periodic, so it must be explicitly translated to overlap the visible
// cube. The origin needed to left-align the cube's `-1.5` edge with lattice
// `0` is exactly `-1.5` in raw objectPosition units (independent of `scale`
// or `freq` — the two cancel), but the schema's combined origin range
// (`originU` 0..1 plus a voice's own `originU1` -1..1) only reaches `-1`.
// `originU1`/`originV1`/`originW1` at their schema minimum (-1, with the
// patch-level `originU`/`originV` pinned to 0, overriding the 0.5 default)
// is the closest achievable alignment — `freq1: 0.4` then lands the cube's
// `+1.5` edge exactly on the lattice's own right boundary (`fx = 1` at
// `objX = 1.5`, verified numerically), leaving a small empty margin at the
// opposite edge rather than clipping the fractal's own detail. `scale: 1`
// (objectPosition read directly, no rescale) keeps that derivation in one
// step instead of two compounding ones.
export const mengerSdfPreset: GlyphEffectPreset<typeof fieldSynthSchema> = {
  name: "Menger SDF", params: {
    space: "object", scale: 1, render: "carve",
    combine: "min", originU: 0, originV: 0,
    field1: "menger", wave1: "step", freq1: 0.4, speed1: 0, amp1: 1, iter1: 3,
    originU1: -1, originV1: -1, originW1: -1,
    amp2: 0, amp3: 0,
    glyphs: " .:-=+*#%@", color: "#6affc9", colorB: "#2f7bff", gradient: 0.4, lit: 1,
    marchFade: 2.5,
  },
};

// `field: "sierpinski"`'s sibling fixture, aimed at the `pyramid` stage
// exactly like the linear-recipe `sierpinskiPyramidPreset` — and, unlike the
// Menger fixture above, needs NO origin correction: the pyramid stage's own
// corner tetra is authored UNCENTERED, spanning objectPosition [0,3]^3 with
// its own corner already at the domain origin (see
// `sierpinskiPyramidPreset`'s doc), so `scale: 1/3` alone maps it exactly
// onto the SDF family's own [0,1]^3 lattice domain — the same alignment
// that recipe's comment describes, just without that recipe's periodicity
// making it forgiving of a bad origin. `originU`/`originV` are still pinned
// to 0 (overriding the 0.5 schema default) because the SDF voice family
// reads origin as a real translation, unlike the linear voices the schema
// default was chosen around.
export const sierpinskiSdfPreset: GlyphEffectPreset<typeof fieldSynthSchema> = {
  name: "Sierpinski SDF", params: {
    space: "object", scale: 1 / 3, render: "carve",
    combine: "min", originU: 0, originV: 0,
    field1: "sierpinski", wave1: "step", freq1: 1, speed1: 0, amp1: 1, iter1: 3,
    amp2: 0, amp3: 0,
    glyphs: " .:-=+*#%@", color: "#ffb454", colorB: "#ff5da2", gradient: 0.4, lit: 1,
    marchFade: 2,
  },
};

// The depth-3 sibling of `mengerSpongePreset`'s linear-recipe construction
// (VOLUMETRIC-3.md §4) — a third scale layer (freq 9 = 3^2, same duty 1/3 /
// phase -1/3 middle-third selector, `min`-blended into the two-layer stack so
// solid now means "solid at every one of the three scales"), needing exactly
// the 9 voices this slice's `SYNTH_VOICES` bump makes available. Previously
// unshippable at the flat-schema level even though the IR itself was already
// depth-unbounded (fieldProgram.test.ts's hand-built 3-layer IR test proved
// that back in VOLUMETRIC.md) — the frontend's 6-voice cap was the actual
// ceiling.
//
// Safe to ship now for a second reason, not just voice count: the OLD
// `effectiveVoiceFinestFreq` read a square voice's finest frequency as its
// bare `freq` (ignoring `duty`), which under-reported this recipe's finest
// band by 3x (duty 1/3 means the narrow high band is a THIRD of a `1/freq`
// cycle, needing `freq/  (1/3) = 3*freq` to resolve — see that function's own
// doc) — corrected in this same slice. With the fix, this preset's finest
// band (duty 1/3 at freq 9) resolves to `9 / (1/3) = 27`; at this preset's
// `scale: 1/3` mapping onto the cube stage's body diagonal (domain-unit chord
// length `sqrt(3) * 3 * (1/3) ≈ 1.732`), the Nyquist floor is
// `ceil(2 * 1.732 * 27) = 94` steps — comfortably inside the 256-step cap.
// Gated on an EMPIRICAL ground-truth march comparison
// (stock.test.ts), not formula trust alone — a thresholded multi-layer fold
// can in principle produce thinner walls than any single voice's own
// frequency bound guarantees.
export const mengerSpongeDepth3Preset: GlyphEffectPreset<typeof fieldSynthSchema> = {
  name: "Menger sponge (depth 3)", params: {
    space: "object", scale: 1 / 3, render: "carve", subcellRes: "1x1",
    field1: "linearX", wave1: "square", freq1: 1, speed1: 0, amp1: 1, duty1: 1 / 3, phase1: -1 / 3, layer1: 1,
    field2: "linearY", wave2: "square", freq2: 1, speed2: 0, amp2: 1, duty2: 1 / 3, phase2: -1 / 3, layer2: 1,
    field3: "linearZ", wave3: "square", freq3: 1, speed3: 0, amp3: 1, duty3: 1 / 3, phase3: -1 / 3, layer3: 1,
    layerCombine1: "add", layerThresholdOn1: true, layerThreshold1: 0, layerInvert1: true, layerBlend1: "min", layerAmp1: 1,
    field4: "linearX", wave4: "square", freq4: 3, speed4: 0, amp4: 1, duty4: 1 / 3, phase4: -1 / 3, layer4: 2,
    field5: "linearY", wave5: "square", freq5: 3, speed5: 0, amp5: 1, duty5: 1 / 3, phase5: -1 / 3, layer5: 2,
    field6: "linearZ", wave6: "square", freq6: 3, speed6: 0, amp6: 1, duty6: 1 / 3, phase6: -1 / 3, layer6: 2,
    layerCombine2: "add", layerThresholdOn2: true, layerThreshold2: 0, layerInvert2: true, layerBlend2: "min", layerAmp2: 1,
    field7: "linearX", wave7: "square", freq7: 9, speed7: 0, amp7: 1, duty7: 1 / 3, phase7: -1 / 3, layer7: 3,
    field8: "linearY", wave8: "square", freq8: 9, speed8: 0, amp8: 1, duty8: 1 / 3, phase8: -1 / 3, layer8: 3,
    field9: "linearZ", wave9: "square", freq9: 9, speed9: 0, amp9: 1, duty9: 1 / 3, phase9: -1 / 3, layer9: 3,
    layerCombine3: "add", layerThresholdOn3: true, layerThreshold3: 0, layerInvert3: true, layerBlend3: "min", layerAmp3: 1,
    glyphs: " .:-=+*#%@", color: "#8affc1", colorB: "#3a6df0", gradient: 0.4, lit: 1,
    marchFade: 2.5,
  },
};

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
  cubeTilesPreset,
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
  mengerSpongePreset,
  mengerSpongeDepth3Preset,
  sierpinskiPyramidPreset,
  gyroidXrayPreset,
  mengerSdfPreset,
  sierpinskiSdfPreset,
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
// Exported for the same reason as `BRAILLE_DOT_BITS` — the static exporter's
// `affineDecisionsMatch` reuses this exact bucket function to verify a
// `subcellRes: "ink"` patch's stroke direction, not a re-derivation.
export function inkGlyphForField(gx: number, gy: number): string {
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
    // See VOLUMETRIC.md's "Params-aware requirement gating": objectPosition
    // is retained only for patches actually using the volumetric branch, and
    // objectExit only for patches actually carving or x-raying (most mounted
    // patches are 2D and pay for neither).
    dynamicRequirements(params) {
      if (params.space !== "object") return [];
      return params.render === "carve" || params.render === "xray" ? ["objectPosition", "objectExit"] : ["objectPosition"];
    },
    // Program-as-data (VOLUMETRIC-3.md §4): packages/glyphcss's compositor
    // calls this at mount, once, when a layer's `program` option is present
    // — glyphcss itself never interprets the payload (it's opaque data to
    // that package), so this definition owns validating its own shape.
    // Reuses `@glyphcss/effects`'s own `validateGlyphFieldProgram` (the
    // same validator a caller building a program by hand should run
    // directly) rather than a second, driftable check.
    validateProgram(program) {
      validateGlyphFieldProgram(program);
    },
    // Structural enforcement, not just a test convention: any throw from the
    // four validators below that isn't tagged with a registered
    // `GLYPH_FIELD_SYNTH_VALIDATION_RULES` id surfaces as THIS distinct
    // "unregistered rule id" error instead of propagating untagged — so a new
    // throw site added to one of those validators without also registering
    // its rule id fails the moment it's exercised, not silently.
    validateParams(params) {
      try {
        validateGlyphRamp(params);
        validatePositiveScale(params);
        validateFieldSynthLayers(params as unknown as AnyParams);
        validateFieldSynthRender(params as unknown as AnyParams);
      } catch (error) {
        const code = error instanceof Error ? (error as Partial<GlyphFieldSynthValidationError>).code : undefined;
        if (!code || !(GLYPH_FIELD_SYNTH_VALIDATION_RULES as readonly string[]).includes(code)) {
          throw new Error(
            `glyphcss field-synth: validation error with no registered rule id (message: "${(error as Error).message}"). `
            + "Tag it via taggedValidationError(..., code) and add the code to GLYPH_FIELD_SYNTH_VALIDATION_RULES.",
          );
        }
        throw error;
      }
    },
    evaluate(context) {
      const { params } = context;
      const shade = context.base.shade;
      const glyphs = glyphRamp(params.glyphs);
      const uvBounds = findUvBounds(context);
      const [sceneCols, sceneRows] = context.coordinates.sceneGridSize;
      const scale = params.scale;
      // Guarded exactly like matrixRain's own volumetric branch: `space:
      // "object"` with a retained objectPosition buffer (solid mode only —
      // wireframe/voxel degrade to the 2D surface/scene fallback below).
      const volumetric = params.space === "object" && !!context.base.objectPosition;
      const generatedSurface = !volumetric && params.space !== "scene" && !(params.space === "auto" && uvBounds)
        ? generatedSurfaceField(context)
        : undefined;
      const cA = parseGlyphEffectColor(params.color);
      const cB = parseGlyphEffectColor(params.colorB);
      const useVoiceColors = params.voiceColors;
      // Program-as-data (VOLUMETRIC-3.md §4): when a layer mounts with a
      // `program` option, packages/glyphcss plumbs it onto the evaluate
      // context unchanged (opaque to glyphcss itself — this definition owns
      // the shape, validated at mount via `validateProgram` below). Its
      // presence REPLACES the flat voice/layer params as the field
      // definition entirely — every per-voice/per-layer param (field1..9,
      // layer1..9, layerCombine*, etc.) is ignored — while `params` still
      // governs space/render/march/output mapping (scale, origin, render
      // mode, march steps, ramp, lighting, ...), exactly as before.
      const programOption = context.program as FieldProgram | undefined;
      // Compile once per evaluate() call, from params only (VOLUMETRIC.md's
      // "The field program IR" and Step 3) — the per-cell loop below only
      // ever calls the IR evaluator, never touches `params.field1`-style flat
      // accessors again. `flatVoices` is the FLAT, unfiltered, original-
      // voice-order list (pre-scaled origins for the flat-params path; a
      // program's own voices, already in its own units, when one is
      // present) — the voiceColors fallback loop below indexes it by
      // original voice number regardless of which layer a voice folds into
      // (VOLUMETRIC.md's Step 3: "voiceColors keeps its current
      // definition... across ALL active voices regardless of layer"), and
      // reads `.color` from EACH voice — `FieldVoice.color` for a program
      // (never the ignored `colorN` params), the flat schema-compiled
      // voices' own `.color` otherwise. `fieldProgram` is either the
      // program option directly, or the same flat voices grouped into
      // `FieldLayer`s for the evaluator — both come from the same source so
      // they can never disagree.
      let fieldProgram: FieldProgram;
      let flatVoices: readonly FieldVoice[];
      if (programOption) {
        fieldProgram = programOption;
        flatVoices = programOption.layers.flatMap((layer) => layer.voices);
      } else {
        const voices = buildFieldSynthVoices(params as unknown as AnyParams);
        const compiledVoices = compileFieldVoices(voices, scale);
        const layerShapes = resolveFieldSynthLayerShapes(params as unknown as AnyParams);
        fieldProgram = compileFieldSynthProgram(compiledVoices, layerShapes, volumetric);
        flatVoices = compiledVoices;
      }
      const parsedVoiceColors = useVoiceColors ? flatVoices.map((voice) => parseGlyphEffectColor(voice.color)) : undefined;
      const time = params.time;
      const rampMax = glyphs.length - 1;
      // Global pattern origin: same `originU/originV * scale` resolution the
      // 2D "scene"/"auto"-without-UV path already uses (see
      // `fieldSynthCoordinate`). The volumetric branch has no schema-level Z
      // origin control (only each voice's own `originW`), so cz is always 0.
      const volumetricOriginX = params.originU * scale;
      const volumetricOriginY = params.originV * scale;

      // Carve/xray require the volumetric branch AND a retained objectExit
      // buffer (`dynamicRequirements` above asks for it when render is
      // "carve" or "xray"; it degrades to absent in wireframe/voxel, same as
      // `objectPosition` already does for `volumetric` — see VOLUMETRIC.md's
      // "Semantics and limits"). Gating on both here, not just `params.render`,
      // is what makes carve/xray degrade to the ordinary paint loop below
      // instead of throwing.
      const carveActive = params.render === "carve" && volumetric && !!context.base.objectExit;
      const xrayActive = params.render === "xray" && volumetric && !!context.base.objectExit;
      // Sphere tracing for carve (VOLUMETRIC-3.md §3): built once per
      // evaluate() call from the SAME compiled `fieldProgram` carve's own
      // march already reads — never for xray (excluded above at the
      // `carveActive` gate; xray's transmittance integral has no first-hit
      // concept to accelerate). `null` for any non-qualifying program (the
      // overwhelming majority — every recipe-based preset, every non-SDF
      // patch), in which case the fixed-step `marchField` path below runs
      // byte-identically to before this option existed.
      const distanceOracle = carveActive ? buildGlyphFieldDistanceOracle(fieldProgram, params, time) : null;
      // The Nyquist floor's f_finest (VOLUMETRIC.md's Carve section): the
      // highest ACTIVE (amp > 0) voice frequency across every layer, computed
      // once per evaluate() call — `marchField`/`integrateField` raise the
      // step count to `ceil(2 * chordLength * finestFreq)` so a thin solid
      // wall isn't stepped over. 0 when no voice is active (no Nyquist floor
      // to apply). Reads each voice's own EFFECTIVE finest frequency
      // (VOLUMETRIC-2.md §2), not the raw `freq` param: a menger/sierpinski
      // voice's finest feature is `iter` recursion levels finer than `freq`
      // alone would suggest, and a gyroid voice's implicit is twice as fine
      // — see `effectiveVoiceFinestFreq` (fieldProgram.ts) for the exact
      // per-field multipliers. Reads from `flatVoices` — the program's own
      // voices when one is present, never the ignored flat params
      // (VOLUMETRIC-3.md §4: "carve/xray finest-frequency comes from the
      // PROGRAM's voices").
      let finestFreq = 0;
      for (const voice of flatVoices) {
        if (voice.amp > 0) {
          const voiceFinestFreq = effectiveVoiceFinestFreq(voice);
          if (voiceFinestFreq > finestFreq) finestFreq = voiceFinestFreq;
        }
      }

      // Shared by carve's march and xray's integral — both sample the SAME
      // clamp01(bias + gain*v*0.5) density mapping paint itself uses (see
      // `computeFieldSynthPoint` below), at the fixed volumetric-branch
      // origin (cx, cy, cz) every carve/xray cell shares (unlike the 2D
      // branch's per-cell origin).
      const densitySample = (mx: number, my: number, mz: number, mt: number): number => clamp01(
        params.bias + params.gain * evaluateFieldProgram(fieldProgram, mx, my, mz, mt, volumetricOriginX, volumetricOriginY, 0).combined * 0.5,
      );

      // xray computes ONE step count for the whole evaluate() pass, from the
      // MAX chord over every covered cell — not a per-cell
      // Nyquist floor the way carve uses. A per-cell count would let
      // neighboring cells' `ceil()` step-count flip by +-1 or +-2 steps,
      // which carve's first-hit search tolerates (the error is a sub-step
      // shift in WHERE the hit lands) but an accumulated integral does not:
      // two neighboring cells integrating the same density over a
      // near-identical chord at slightly different step counts can read up
      // to ~20% apart in brightness, which is visible as per-cell speckle
      // (VOLUMETRIC-2.md §1 "Uniform step count per evaluate"). This costs a
      // first pass over every covered cell before the shading pass below.
      let xrayUniformSteps = 0;
      if (xrayActive) {
        const op = context.base.objectPosition!;
        const exitBuf = context.base.objectExit!;
        let maxChord = 0;
        for (let i = 0; i < context.base.length; i++) {
          if (context.target.coverage[i]! <= 0) continue;
          const px = op[i * 3]!, py = op[i * 3 + 1]!, pz = op[i * 3 + 2]!;
          if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue;
          const exx = exitBuf[i * 3]!, exy = exitBuf[i * 3 + 1]!, exz = exitBuf[i * 3 + 2]!;
          if (!Number.isFinite(exx) || !Number.isFinite(exy) || !Number.isFinite(exz)) continue;
          const chordLength = Math.hypot((exx - px) * scale, (exy - py) * scale, (exz - pz) * scale);
          if (chordLength > maxChord && Number.isFinite(chordLength)) maxChord = chordLength;
        }
        xrayUniformSteps = fieldStepCount(maxChord, { steps: params.marchSteps, maxSteps: 256, finestFreq });
      }

      // One evaluator for the whole program (see `evaluateFieldProgram`) so
      // the scalar here, the 2x4 subcell probes, the ink gradient probes, and
      // carve's march can never disagree about what the patch sounds like.
      // `amp` is a MIX WEIGHT, not a signal gain: the first voice enters at
      // its weight, each later voice blends the result toward
      // `combine(result, voice)` by its amp. So amp 0 = no effect, amp 1 =
      // full combine, low amp gently mixes instead of `multiply` crushing the
      // field to zero.
      //
      // Shared by the plain-ramp paint path and carve's hit-point emission
      // (see `FieldSynthPointSample`'s doc) — evaluates the program and the
      // voiceColors contribution at one point, without deciding whether that
      // point actually emits (the caller applies the ink/non-ink skip rule).
      function computeFieldSynthPoint(x: number, y: number, z: number, cx: number, cy: number, cz: number): FieldSynthPointSample {
        const stack = evaluateFieldProgram(fieldProgram, x, y, z, time, cx, cy, cz);
        // Two weight sums: `cw` (amp * |osc|) is the true per-cell contribution
        // and drives the normal blend; `caw` (amp alone) is always > 0 for an
        // active voice and only feeds the fallback below, for cells where every
        // voice sits on a zero-crossing.
        let cr = 0, cg = 0, cbv = 0, cw = 0, co = 0;
        let car = 0, cag = 0, cabv = 0, cao = 0, caw = 0;
        if (parsedVoiceColors) {
          // Bounds-checked regardless of source (VOLUMETRIC-3.md §4): a
          // program's `sourceIndex` is trusted authoring data (a hand-built
          // IR, not necessarily built through `buildGlyphFieldProgram`) and
          // can exceed `parsedVoiceColors.length` — an out-of-range winner
          // degrades to the mixed-fallback loop below (the same path an
          // unresolved winner already takes) instead of an unchecked
          // `parsedVoiceColors[stack.winner]` TypeError.
          if (stack.winner >= 0 && stack.winner < parsedVoiceColors.length) {
            // argmax is categorical: the region belongs to ONE voice, so it
            // takes that voice's colour flat rather than a blend of all of them.
            const c = parsedVoiceColors[stack.winner]!;
            cr = (c.packed >> 16) & 0xff; cg = (c.packed >> 8) & 0xff; cbv = c.packed & 0xff;
            co = c.opacity; cw = 1;
            car = cr; cag = cg; cabv = cbv; cao = co; caw = 1;
          } else {
            for (let k = 0; k < flatVoices.length; k++) {
              const voice = flatVoices[k]!;
              if (!(voice.amp > 0)) continue;
              const o = sampleFieldVoice(
                voice, x, y, z,
                cx + voice.origin.u, cy + voice.origin.v, cz + voice.origin.w,
                time, volumetric,
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
        const value = clamp01(params.bias + params.gain * stack.combined * 0.5);
        return { active: stack.active, value, cr, cg, cbv, cw, co, car, cag, cabv, cao, caw };
      }

      // Shared color-compose + lit-shade tail — factored out of
      // `applyFieldSynthColor` (VOLUMETRIC-3.md §2) so the ink-over-carve
      // resolve pass can compute and STORE a cell's fully-resolved packed
      // color/opacity in its own hit-record buffer (for a rim cell to borrow
      // from a neighbor later) without writing to `context.output` itself —
      // `applyFieldSynthColor` below still does exactly what it always did,
      // now via this shared helper, so every non-ink call site is
      // byte-identical. `colorFactor` is carve's `exp(-marchFade * distance)`
      // falloff (1 for every non-carve call, and for a carve hit at distance
      // 0 — an everywhere-solid field, or a degenerate-segment fallback — so
      // those cases multiply by exactly 1, reproducing plain paint output
      // bit-for-bit).
      function resolveFieldSynthColor(i: number, point: FieldSynthPointSample, colorFactor: number): { packed: number; resolvedOpacity: number } {
        let packed: number;
        let resolvedOpacity: number;
        if (parsedVoiceColors && point.cw > 0) {
          packed = (Math.round(point.cr / point.cw) << 16) | (Math.round(point.cg / point.cw) << 8) | Math.round(point.cbv / point.cw);
          resolvedOpacity = point.co / point.cw;
        } else if (parsedVoiceColors && point.caw > 0) {
          packed = (Math.round(point.car / point.caw) << 16) | (Math.round(point.cag / point.caw) << 8) | Math.round(point.cabv / point.caw);
          resolvedOpacity = point.cao / point.caw;
        } else {
          packed = params.gradient > 0 ? lerpPacked(cA.packed, cB.packed, clamp01(point.value * params.gradient)) : cA.packed;
          resolvedOpacity = cA.opacity;
        }
        // Modulate by the surface's Lambert shade so lighting reads through the
        // texture (lit=1 → full shading, lit=0 → flat/unlit). Carve applies this
        // unchanged for an interior hit too (VOLUMETRIC.md: "the surface lit/
        // shade term applies via the same paint path evaluated at the hit") —
        // there is no separate per-hit-point shadow term (v1 shading contract).
        if (params.lit > 0 && shade) {
          const sh = shade[i]!;
          if (Number.isFinite(sh)) packed = scalePackedColor(packed, 1 - params.lit * (1 - clamp01(sh)));
        }
        if (colorFactor !== 1) packed = scalePackedColor(packed, colorFactor);
        return { packed, resolvedOpacity };
      }

      // Shared set-output tail, also part of the shared t=0 emission path
      // (see `FieldSynthPointSample`'s doc).
      function applyFieldSynthColor(i: number, point: FieldSynthPointSample, coverageIsLevelScaled: boolean, colorFactor: number): void {
        const { packed, resolvedOpacity } = resolveFieldSynthColor(i, point, colorFactor);
        setColor(context, i, packed);
        // Shaded modes fade a cell by its level; an inked cell is a decision, not
        // a level — half a contour lies BELOW the iso-level and would render
        // almost invisible if its coverage were scaled by it.
        context.output.coverage[i] = coverageIsLevelScaled ? point.value * resolvedOpacity : resolvedOpacity;
      }

      // ---- Ink-over-carve (VOLUMETRIC-3.md §2) --------------------------
      //
      // Outlines carve's march instead of shading every hit cell. Two passes
      // over per-evaluate local buffers (plain per-evaluate() allocations,
      // never compositor scratch — v1, per the spec): pass 1 runs carve's
      // own march at every cell and records a classification (`hitState`)
      // plus, for a genuine hit, its absolute-domain-unit `sampleDistance`
      // and fully-resolved output color; pass 2 reads ONLY those buffers
      // (never re-marches) to decide which cells ink and how.
      //
      // `hitState` collapses the spec's four neighbor categories (hit / hole
      // / uncovered / non-target) to three: OUT covers both "no geometry
      // here" (uncovered) and "geometry here, but from a mesh outside this
      // layer's target set" (non-target) — both behave identically for a
      // rim/contour decision, since the compositor's own `targetCoverage`
      // weighting already discards whatever a non-target OUT cell emits
      // here, so folding it in with "uncovered" changes nothing observable.
      //
      // A DIFFERENT winner mesh between two HIT cells (VOLUMETRIC-3.md
      // Phase 2 P1 fix) is its own case, tracked via `context.base.winnerMesh`
      // (read-only, populated whenever `objectExit` retention is active —
      // every carve layer qualifies, see `GlyphEffectFrameView.winnerMesh`'s
      // doc comment): two coplanar, same-normal, globally-targeted meshes at
      // different depths both resolve to `CARVE_INK_HIT` with no state
      // difference between them, so relying on `hitState` alone (as v1 did)
      // let a contour/interior-edge decision bridge straight across a real
      // mesh seam instead of rimming it. `meshBoundary` below treats two
      // HIT neighbors with different, both-known mesh ids as a boundary —
      // same as a `hitState` flip — for both the rim/contour classification
      // and the rim orientation mask; when mesh data is unavailable (`-1`
      // sentinel) it never fires, so a scene rendered before mesh-boundary
      // data existed (or a non-carve/no-effect fallback) keeps this file's
      // pre-fix behavior exactly.
      const CARVE_INK_OUT = 0;
      const CARVE_INK_HOLE = 1;
      const CARVE_INK_HIT = 2;

      // Rule (c)'s interior-edge threshold, in ADDITION to the raw
      // `inkSpacing` — VOLUMETRIC-3.md's oblique-angle vanishing-hole bug
      // (instrumented on the depth-3 Menger preset, real-scene, camera
      // rotX 45/rotY 30): rim (a) only fires for a TRUE through-hole, which
      // is angle-dependent — an oblique face-hole ray that used to exit
      // clean instead clips an interior wall, turning a HOLE neighbor into a
      // same-mesh HIT one cell over. That leaves rule (c) as the only
      // remaining catcher, but depth-3's finest recursion level is a
      // 1/finestFreq-deep step (measured ~1/9 and ~1/27 domain units at this
      // preset's `finestFreq` of 9/27), almost always well under the
      // absolute default `inkSpacing` (0.25) — so the hole silently
      // stops rendering. Confirmed empirically: at the reproducing oblique
      // angle NO cell ever reads `CARVE_INK_HOLE` at all (rays that would
      // have been true misses head-on instead clip a shallow interior wall
      // obliquely), while 250+ HIT-HIT neighbor pairs carry a nonzero,
      // sub-`inkSpacing` depth delta.
      //
      // The fix scales rule (c)'s own threshold down to the program's own
      // finest resolvable feature size instead of leaving it pinned to the
      // user-facing `inkSpacing` knob alone — the same "self-resolving like
      // the Nyquist floor" idea `finestFreq` already drives for march step
      // count. `marchField`/`integrateField` size their step count so a
      // step is `~= 1 / (2 * finestFreq)` domain units (Nyquist: >=2 samples
      // per finest feature) — that step size is this rule's real noise
      // floor, and the finest feature genuinely present in the field is
      // `>= 1 / finestFreq` by the very definition of `finestFreq`. Those
      // two bounds sit a factor of 2 apart regardless of scene/chord length
      // (both derive from the same `finestFreq`), so a fixed fraction
      // between them is a stable, scene-independent choice:
      // `CARVE_INK_EDGE_FREQ_SCALE = 0.75` sits above the ~1x-step-size
      // quantization noise floor (measured: sub-0.02 deltas at finestFreq
      // 27, where 1 step ~= 0.0185) with margin and below the ~1x-feature-
      // size real minimum (1/27 ~= 0.037) with margin, so a genuinely flat,
      // camera-facing wall's near-zero deltas still don't cross it (the
      // pinned "flat wall = rim only" invariant), while depth-3's shallow
      // steps now do. This only ever SHRINKS the effective threshold below
      // whatever `inkSpacing` the user set (`Math.min`) — a low-frequency
      // patch (`finestFreq` small) is unaffected, and rule (b)'s own
      // contour-multiple spacing (the user-facing "Ink spacing" knob) is
      // untouched, so it stays exactly the absolute, non-crawling density
      // control VOLUMETRIC-3.md's "Contour spacing is ABSOLUTE" design
      // requires.
      const CARVE_INK_EDGE_FREQ_SCALE = 0.75;

      function runCarveInkResolve(): void {
        const length = context.base.length;
        const winnerMeshBuf = context.base.winnerMesh;
        function meshAt(idx: number): number {
          return idx < 0 || !winnerMeshBuf ? -1 : winnerMeshBuf[idx]!;
        }
        // Two HIT cells only count as a mesh boundary when BOTH ids are
        // known (`>= 0`) and differ — an unknown/missing id never manufactures
        // a boundary that wasn't there before this fix.
        function meshBoundary(selfState: number, selfMesh: number, nState: number, nMesh: number): boolean {
          return selfState === CARVE_INK_HIT && nState === CARVE_INK_HIT && selfMesh >= 0 && nMesh >= 0 && selfMesh !== nMesh;
        }
        const hitState = new Uint8Array(length);
        const hitDistance = new Float32Array(length);
        const hitPacked = new Uint32Array(length);
        const hitOpacity = new Float32Array(length);

        for (let i = 0; i < length; i++) {
          if (context.target.coverage[i]! <= 0) { hitState[i] = CARVE_INK_OUT; continue; }
          const op = context.base.objectPosition!;
          const px = op[i * 3]!, py = op[i * 3 + 1]!, pz = op[i * 3 + 2]!;
          if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) { hitState[i] = CARVE_INK_OUT; continue; }
          const entryX = px * scale, entryY = py * scale, entryZ = pz * scale;
          const cx = volumetricOriginX, cy = volumetricOriginY, cz = 0;

          const exitBuf = context.base.objectExit!;
          const exx = exitBuf[i * 3]!, exy = exitBuf[i * 3 + 1]!, exz = exitBuf[i * 3 + 2]!;
          const hasExit = Number.isFinite(exx) && Number.isFinite(exy) && Number.isFinite(exz);
          let hitX = entryX, hitY = entryY, hitZ = entryZ, distance = 0;
          if (hasExit) {
            const exitX = exx * scale, exitY = exy * scale, exitZ = exz * scale;
            const chordLength = Math.hypot(exitX - entryX, exitY - entryY, exitZ - entryZ);
            if (chordLength > 0 && Number.isFinite(chordLength)) {
              const result = marchField(
                [entryX, entryY, entryZ], [exitX, exitY, exitZ], densitySample,
                { steps: params.marchSteps, maxSteps: 256, finestFreq, time },
              );
              if (!result.hit) { hitState[i] = CARVE_INK_HOLE; continue; }
              distance = result.sampleDistance;
              hitX = result.sampleX; hitY = result.sampleY; hitZ = result.sampleZ;
            }
          }
          // Degenerate/absent chord: fall back to surface sampling at the
          // TRUE entry (`hitX/Y/Z` still default to `entryX/Y/Z`, `distance`
          // to 0) — carve's fallback emits only when that entry is solid;
          // silhouette closure comes from rule (a) below, not this fallback.
          const point = computeFieldSynthPoint(hitX, hitY, hitZ, cx, cy, cz);
          if (point.active === 0 || point.value <= 0) { hitState[i] = CARVE_INK_HOLE; continue; }
          hitState[i] = CARVE_INK_HIT;
          hitDistance[i] = distance;
          const resolved = resolveFieldSynthColor(i, point, Math.exp(-params.marchFade * distance));
          hitPacked[i] = resolved.packed;
          hitOpacity[i] = resolved.resolvedOpacity;
        }

        const cols = context.base.cols;
        const rows = context.base.rows;
        const spacing = params.inkSpacing > 0 ? params.inkSpacing : 0.25;
        // Rule (c) only — see `CARVE_INK_EDGE_FREQ_SCALE`'s doc above. `0`
        // `finestFreq` (no active voice) divides to `Infinity`, so `Math.min`
        // degrades to plain `spacing` with no special case.
        const edgeSpacing = Math.min(spacing, CARVE_INK_EDGE_FREQ_SCALE / finestFreq);
        function neighborOf(i: number, dir: 0 | 1 | 2 | 3): number {
          // 0 right, 1 left, 2 down, 3 up. Off-grid reads back as OUT via
          // `stateAt` below (a grid edge behaves like leaving the visible
          // world — background, not a special case).
          const col = i % cols, row = (i / cols) | 0;
          if (dir === 0) return col + 1 < cols ? i + 1 : -1;
          if (dir === 1) return col - 1 >= 0 ? i - 1 : -1;
          if (dir === 2) return row + 1 < rows ? i + cols : -1;
          return row - 1 >= 0 ? i - cols : -1;
        }
        function stateAt(idx: number): number {
          return idx < 0 ? CARVE_INK_OUT : hitState[idx]!;
        }

        for (let i = 0; i < length; i++) {
          const self = hitState[i]!;
          if (self === CARVE_INK_OUT) continue;
          const rIdx = neighborOf(i, 0), lIdx = neighborOf(i, 1), dIdx = neighborOf(i, 2), uIdx = neighborOf(i, 3);
          const rState = stateAt(rIdx), lState = stateAt(lIdx), dState = stateAt(dIdx), uState = stateAt(uIdx);
          const selfMesh = meshAt(i);
          const rMesh = meshAt(rIdx), lMesh = meshAt(lIdx), dMesh = meshAt(dIdx), uMesh = meshAt(uIdx);
          // Rule (a): ANY neighbor in a different category, OR (Phase 2 P1
          // fix) a same-category HIT neighbor with a DIFFERENT winner mesh
          // — always inked, regardless of what `self` itself is (a hole/OUT
          // cell right next to a hit is rimmed too, so a rim cell with no
          // hit of its own can borrow a color below).
          const isRim = self !== rState || self !== lState || self !== dState || self !== uState
            || meshBoundary(self, selfMesh, rState, rMesh) || meshBoundary(self, selfMesh, lState, lMesh)
            || meshBoundary(self, selfMesh, dState, dMesh) || meshBoundary(self, selfMesh, uState, uMesh);

          let gx = 0, gy = 0;
          let inked = isRim;
          if (isRim) {
            // Rim orientation: the screen-space gradient of the hit/no-hit
            // COVERAGE MASK — a depth gradient is undefined against a
            // sentinel (non-hit) neighbor, and the naive depth-everywhere
            // fallback renders every rim cell as "-" (the pinned all-dashes
            // counter-case). A HIT neighbor on a DIFFERENT winner mesh reads
            // as "not my surface" here too (mask 0), same reasoning: the
            // mesh seam is exactly as undefined a depth reference as a
            // sentinel non-hit neighbor is.
            const maskOf = (s: number, nMesh: number): number => (s === CARVE_INK_HIT && !meshBoundary(self, selfMesh, s, nMesh)) ? 1 : 0;
            gx = maskOf(rState, rMesh) - maskOf(lState, lMesh);
            gy = maskOf(dState, dMesh) - maskOf(uState, uMesh);
          } else if (self === CARVE_INK_HIT) {
            // Rule (a) didn't fire, so every EXISTING neighbor already
            // shares `self`'s state (CARVE_INK_HIT) AND, per `meshBoundary`
            // above, its winner mesh too — rules (b)/(c): a multiple of
            // `inkSpacing` between two hit depths (contour), or too great a
            // depth jump (interior edge), are only ever compared WITHIN one
            // mesh's own surface. A missing (off-grid) neighbor contributes
            // 0 (defaults to `self`'s own depth), the same edge-mirroring
            // convention the rest of this file's subcell gradient probes use.
            const selfDist = hitDistance[i]!;
            const rDist = rIdx >= 0 ? hitDistance[rIdx]! : selfDist;
            const lDist = lIdx >= 0 ? hitDistance[lIdx]! : selfDist;
            const dDist = dIdx >= 0 ? hitDistance[dIdx]! : selfDist;
            const uDist = uIdx >= 0 ? hitDistance[uIdx]! : selfDist;
            let crosses = false;
            for (const other of [rDist, lDist, dDist, uDist]) {
              const lo = Math.min(selfDist, other), hi = Math.max(selfDist, other);
              if (Math.floor(lo / spacing) !== Math.floor(hi / spacing) || hi - lo > edgeSpacing) { crosses = true; break; }
            }
            if (crosses) {
              inked = true;
              // Contour/edge orientation: the depth gradient (both sides are
              // real hits here, so this is well-defined, unlike the rim case).
              gx = rDist - lDist;
              gy = dDist - uDist;
            }
          }
          if (!inked) continue;

          setGlyph(context, i, inkGlyphForField(gx, gy));
          let packed: number;
          let opacity: number;
          if (self === CARVE_INK_HIT) {
            packed = hitPacked[i]!;
            opacity = hitOpacity[i]!;
          } else {
            // A rim cell with no hit of its own borrows its nearest inked
            // (i.e. any) hit neighbor's color; with none, the layer's base
            // color (no field sample exists here to gradient/voice-blend).
            let borrowed = -1;
            if (rIdx >= 0 && rState === CARVE_INK_HIT) borrowed = rIdx;
            else if (lIdx >= 0 && lState === CARVE_INK_HIT) borrowed = lIdx;
            else if (dIdx >= 0 && dState === CARVE_INK_HIT) borrowed = dIdx;
            else if (uIdx >= 0 && uState === CARVE_INK_HIT) borrowed = uIdx;
            if (borrowed >= 0) {
              packed = hitPacked[borrowed]!;
              opacity = hitOpacity[borrowed]!;
            } else {
              packed = cA.packed;
              opacity = cA.opacity;
            }
          }
          setColor(context, i, packed);
          // Inked cells get full coverage, not level-scaled — an inked cell
          // is a decision, not a level (same precedent as 2D `subcellRes:
          // "ink"`'s own coverage line above).
          context.output.coverage[i] = opacity;
        }
      }

      // ---- Braille-over-carve (VOLUMETRIC-3.md §2) -----------------------
      //
      // `subcellRes: "2x4"` under carve marches 8 sub-rays per covered cell,
      // each with its own interpolated entry/exit chord, sharing ONE step
      // count sized from the longest chord among them (xray's own
      // rationale — VOLUMETRIC-2.md §1 "Uniform step count per evaluate" —
      // applied per-cell here instead of per-evaluate: a per-subray count
      // would let neighboring dots inside the SAME cell disagree about how
      // finely a thin feature is resolved).
      interface CarveCellGeometry {
        readonly ex: number; readonly ey: number; readonly ez: number;
        readonly xx: number; readonly xy: number; readonly xz: number;
        readonly nx: number; readonly ny: number; readonly nz: number;
        readonly mesh: number;
      }

      // A covered, in-target cell's own (already scale-applied) entry/exit
      // chord, geometric face normal, and winner mesh id — `null` when this
      // cell has no finite chord to march at all (mirrors the 1x1 path's
      // own skip). `mesh` is `-1` when no winner-mesh data is retained
      // (never populates without `objectExit` retention — see
      // `GlyphEffectFrameView.winnerMesh`'s doc comment — so this is a
      // theoretical fallback, not an expected runtime path for carve).
      function carveCellGeometry(idx: number): CarveCellGeometry | null {
        if (context.target.coverage[idx]! <= 0) return null;
        const op = context.base.objectPosition!;
        const px = op[idx * 3]!, py = op[idx * 3 + 1]!, pz = op[idx * 3 + 2]!;
        if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return null;
        const exitBuf = context.base.objectExit!;
        const exx = exitBuf[idx * 3]!, exy = exitBuf[idx * 3 + 1]!, exz = exitBuf[idx * 3 + 2]!;
        if (!Number.isFinite(exx) || !Number.isFinite(exy) || !Number.isFinite(exz)) return null;
        let nx = 0, ny = 0, nz = 1;
        const nrm = context.base.normal;
        if (nrm) {
          const rnx = nrm[idx * 3]!, rny = nrm[idx * 3 + 1]!, rnz = nrm[idx * 3 + 2]!;
          if (Number.isFinite(rnx) && Number.isFinite(rny) && Number.isFinite(rnz)) { nx = rnx; ny = rny; nz = rnz; }
        }
        const winnerMeshBuf = context.base.winnerMesh;
        const mesh = winnerMeshBuf ? winnerMeshBuf[idx]! : -1;
        return { ex: px * scale, ey: py * scale, ez: pz * scale, xx: exx * scale, xy: exy * scale, xz: exz * scale, nx, ny, nz, mesh };
      }

      // Strict neighbor eligibility: finite entry AND exit (via
      // `carveCellGeometry`'s own null check), the SAME winner mesh
      // (VOLUMETRIC-3.md Phase 2 P1 fix — an agreeing normal alone is not
      // enough: two adjacent, coplanar, same-normal meshes previously
      // passed this gate and interpolated a sub-ray's endpoint off the
      // near mesh's own surface toward the far mesh's unrelated position;
      // both ids known-and-different is required to REJECT, so unknown
      // mesh data — `-1` — never blocks eligibility it didn't block before
      // this fix), AND the geometric normals agree (dot > 0.9) — a finite
      // neighbor on a different cube FACE of the SAME mesh interpolates
      // endpoints off the surface too, breaking every visible crease-edge
      // column without this second gate.
      function eligibleCarveNeighbor(selfGeom: CarveCellGeometry, idx: number): CarveCellGeometry | null {
        if (idx < 0) return null;
        const g = carveCellGeometry(idx);
        if (!g) return null;
        if (selfGeom.mesh >= 0 && g.mesh >= 0 && selfGeom.mesh !== g.mesh) return null;
        const dot = g.nx * selfGeom.nx + g.ny * selfGeom.ny + g.nz * selfGeom.nz;
        return dot > 0.9 ? g : null;
      }

      function runCarveBrailleCell(i: number): void {
        const selfGeom = carveCellGeometry(i);
        if (!selfGeom) return; // no finite chord — emits nothing, matching the 1x1 path's own skip
        const cols = context.base.cols, rows = context.base.rows;
        const col = i % cols, row = (i / cols) | 0;
        const rIdx = col + 1 < cols ? i + 1 : -1;
        const lIdx = col - 1 >= 0 ? i - 1 : -1;
        const dIdx = row + 1 < rows ? i + cols : -1;
        const uIdx = row - 1 >= 0 ? i - cols : -1;
        const rG = eligibleCarveNeighbor(selfGeom, rIdx);
        const lG = eligibleCarveNeighbor(selfGeom, lIdx);
        const dG = eligibleCarveNeighbor(selfGeom, dIdx);
        const uG = eligibleCarveNeighbor(selfGeom, uIdx);

        // Otherwise: cell-center sub-rays (fallback) — when NEITHER side of
        // an axis has an eligible neighbor, that axis's gradient stays 0 and
        // every sub-ray collapses to this cell's own (entry, exit) chord.
        let entryDxCol = 0, entryDyCol = 0, entryDzCol = 0, exitDxCol = 0, exitDyCol = 0, exitDzCol = 0;
        if (rG) {
          entryDxCol = rG.ex - selfGeom.ex; entryDyCol = rG.ey - selfGeom.ey; entryDzCol = rG.ez - selfGeom.ez;
          exitDxCol = rG.xx - selfGeom.xx; exitDyCol = rG.xy - selfGeom.xy; exitDzCol = rG.xz - selfGeom.xz;
        } else if (lG) {
          entryDxCol = selfGeom.ex - lG.ex; entryDyCol = selfGeom.ey - lG.ey; entryDzCol = selfGeom.ez - lG.ez;
          exitDxCol = selfGeom.xx - lG.xx; exitDyCol = selfGeom.xy - lG.xy; exitDzCol = selfGeom.xz - lG.xz;
        }
        let entryDxRow = 0, entryDyRow = 0, entryDzRow = 0, exitDxRow = 0, exitDyRow = 0, exitDzRow = 0;
        if (dG) {
          entryDxRow = dG.ex - selfGeom.ex; entryDyRow = dG.ey - selfGeom.ey; entryDzRow = dG.ez - selfGeom.ez;
          exitDxRow = dG.xx - selfGeom.xx; exitDyRow = dG.xy - selfGeom.xy; exitDzRow = dG.xz - selfGeom.xz;
        } else if (uG) {
          entryDxRow = selfGeom.ex - uG.ex; entryDyRow = selfGeom.ey - uG.ey; entryDzRow = selfGeom.ez - uG.ez;
          exitDxRow = selfGeom.xx - uG.xx; exitDyRow = selfGeom.xy - uG.xy; exitDzRow = selfGeom.xz - uG.xz;
        }

        const cx = volumetricOriginX, cy = volumetricOriginY, cz = 0;

        function marchSubray(
          ex: number, ey: number, ez: number, xx: number, xy: number, xz: number, steps: number,
        ): { packed: number; value: number; resolvedOpacity: number } | null {
          const chordLength = Math.hypot(xx - ex, xy - ey, xz - ez);
          if (chordLength > 0 && Number.isFinite(chordLength)) {
            const result = marchField([ex, ey, ez], [xx, xy, xz], densitySample, { steps, maxSteps: steps, finestFreq: 0, time });
            if (!result.hit) return null;
            const point = computeFieldSynthPoint(result.sampleX, result.sampleY, result.sampleZ, cx, cy, cz);
            if (point.active === 0 || point.value <= 0) return null;
            const resolved = resolveFieldSynthColor(i, point, Math.exp(-params.marchFade * result.sampleDistance));
            return { packed: resolved.packed, value: point.value, resolvedOpacity: resolved.resolvedOpacity };
          }
          // Degenerate sub-ray chord: sample directly at its (shared) entry
          // point, same t=0 fallback the 1x1/ink paths use.
          const point = computeFieldSynthPoint(ex, ey, ez, cx, cy, cz);
          if (point.active === 0 || point.value <= 0) return null;
          const resolved = resolveFieldSynthColor(i, point, 1);
          return { packed: resolved.packed, value: point.value, resolvedOpacity: resolved.resolvedOpacity };
        }

        let maxChord = Math.hypot(selfGeom.xx - selfGeom.ex, selfGeom.xy - selfGeom.ey, selfGeom.xz - selfGeom.ez);
        const subrayEndpoints: Array<readonly [number, number, number, number, number, number]> = [];
        for (let dotCol = 0; dotCol < 2; dotCol++) {
          const fx = dotCol === 0 ? -0.25 : 0.25;
          for (let dotRow = 0; dotRow < 4; dotRow++) {
            const fy = (dotRow + 0.5) / 4 - 0.5;
            const ex = selfGeom.ex + fx * entryDxCol + fy * entryDxRow;
            const ey = selfGeom.ey + fx * entryDyCol + fy * entryDyRow;
            const ez = selfGeom.ez + fx * entryDzCol + fy * entryDzRow;
            const xx = selfGeom.xx + fx * exitDxCol + fy * exitDxRow;
            const xy = selfGeom.xy + fx * exitDyCol + fy * exitDyRow;
            const xz = selfGeom.xz + fx * exitDzCol + fy * exitDzRow;
            subrayEndpoints.push([ex, ey, ez, xx, xy, xz]);
            const chord = Math.hypot(xx - ex, xy - ey, xz - ez);
            if (Number.isFinite(chord) && chord > maxChord) maxChord = chord;
          }
        }
        const steps = fieldStepCount(maxChord, { steps: params.marchSteps, maxSteps: 256, finestFreq });

        const centerHit = marchSubray(selfGeom.ex, selfGeom.ey, selfGeom.ez, selfGeom.xx, selfGeom.xy, selfGeom.xz, steps);
        let mask = 0;
        let firstHit: { packed: number; value: number; resolvedOpacity: number } | null = null;
        let dotIndex = 0;
        for (let dotCol = 0; dotCol < 2; dotCol++) {
          for (let dotRow = 0; dotRow < 4; dotRow++) {
            const [ex, ey, ez, xx, xy, xz] = subrayEndpoints[dotIndex]!;
            dotIndex++;
            const hit = marchSubray(ex, ey, ez, xx, xy, xz, steps);
            if (hit) {
              mask |= BRAILLE_DOT_BITS[dotCol]![dotRow]!;
              if (!firstHit) firstHit = hit;
            }
          }
        }

        // One color per cell: the center sub-ray's hit color if it hit,
        // else the first hitting sub-ray's (scan order), else no emission.
        const chosen = centerHit ?? firstHit;
        if (!chosen) return;
        setGlyph(context, i, String.fromCharCode(0x2800 + mask));
        setColor(context, i, chosen.packed);
        context.output.coverage[i] = chosen.value * chosen.resolvedOpacity;
      }

      const carveInkActive = carveActive && params.subcellRes === "ink";
      if (carveInkActive) {
        runCarveInkResolve();
        return;
      }

      for (let i = 0; i < context.base.length; i++) {
        if (context.target.coverage[i]! <= 0) continue;

        if (carveActive) {
          if (params.subcellRes === "2x4") {
            runCarveBrailleCell(i);
            continue;
          }
          const op = context.base.objectPosition!;
          const px = op[i * 3]!, py = op[i * 3 + 1]!, pz = op[i * 3 + 2]!;
          if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue;
          const entryX = px * scale, entryY = py * scale, entryZ = pz * scale;
          const cx = volumetricOriginX, cy = volumetricOriginY, cz = 0;

          const exitBuf = context.base.objectExit!;
          const exx = exitBuf[i * 3]!, exy = exitBuf[i * 3 + 1]!, exz = exitBuf[i * 3 + 2]!;
          const hasExit = Number.isFinite(exx) && Number.isFinite(exy) && Number.isFinite(exz);
          let hitX = entryX, hitY = entryY, hitZ = entryZ, hitDistance = 0;
          if (hasExit) {
            const exitX = exx * scale, exitY = exy * scale, exitZ = exz * scale;
            const chordLength = Math.hypot(exitX - entryX, exitY - entryY, exitZ - entryZ);
            // A degenerate/non-finite ray (grazing silhouette: entry === exit)
            // has no chord to march — `marchField` itself already misses this
            // case, but the CALLER must not read that miss as a hole: it falls
            // back to surface sampling at the TRUE entry, which shares paint's
            // own emission path unchanged.
            if (chordLength > 0 && Number.isFinite(chordLength)) {
              // Sphere tracing (VOLUMETRIC-3.md §3): a qualifying program
              // (`distanceOracle` non-null) marches by distance-stepping
              // against the oracle instead of the fixed grid below — same
              // `FieldMarchResult` shape either way, so every line after
              // this call is unchanged regardless of which marcher ran.
              const result = distanceOracle
                ? marchGlyphFieldSphere(
                    [entryX, entryY, entryZ], [exitX, exitY, exitZ], distanceOracle, densitySample,
                    { time, originX: cx, originY: cy, originZ: cz, steps: params.marchSteps, maxSteps: 256, finestFreq },
                  )
                : marchField(
                    [entryX, entryY, entryZ], [exitX, exitY, exitZ], densitySample,
                    { steps: params.marchSteps, maxSteps: 256, finestFreq, time },
                  );
              // No solid sample anywhere along a genuine (non-degenerate) chord:
              // a real hole. The cell emits nothing — ordinary compositor
              // semantics (VOLUMETRIC.md's Carve section) — not a fallback to
              // the entry point.
              if (!result.hit) continue;
              // Emit at the CONFIRMED-solid raw grid sample, not the
              // interpolated `result.x/y/z`: `marchField`'s secant refinement
              // is exact for an affine field, but a hard-thresholded field
              // (every voice/layer boundary in the Menger recipe, or any
              // square-wave voice) has a plateau at 0 under the ramp's own
              // clamp01(bias+gain*v*0.5) mapping, so the interpolated position
              // can land exactly on that plateau's edge and resample non-solid
              // (see `marchField`'s doc). `sampleX/Y/Z` is guaranteed to
              // resample > 0 by construction — it IS the raw sample that
              // triggered this hit. `hitDistance` must describe that SAME
              // point: pairing the emission point with the interpolated
              // `distance` instead fades the point as if it sat wherever the
              // secant root landed, which is a different position whenever
              // the crossing isn't already bracket-exact (VOLUMETRIC.md's
              // Carve section — "hit at parameter t evaluates the paint
              // pipeline at the hit point"). `sampleDistance` is `marchField`'s
              // own `sampleT * chordLength` along the marched chord.
              hitDistance = result.sampleDistance;
              hitX = result.sampleX; hitY = result.sampleY; hitZ = result.sampleZ;
            }
          }
          // else: no finite exit for this cell (should not happen once
          // objectExit is retained for a covered cell, but degrades the same
          // way — surface sampling at the entry point).

          const point = computeFieldSynthPoint(hitX, hitY, hitZ, cx, cy, cz);
          // This is the plain `subcellRes: "1x1"` carve path — "ink" and
          // "2x4" both branch out above (carveInkActive / runCarveBrailleCell)
          // before this loop body runs, so the skip rule here is the plain,
          // non-ink one; `marchField`'s own solid test already used this same
          // clamp01(bias+gain*v*0.5) mapping, so this should already hold at
          // the hit point — checked again anyway, since the degenerate-segment
          // fallback never went through that test.
          if (point.active === 0 || point.value <= 0) continue;
          setGlyph(context, i, glyphs[Math.min(rampMax, Math.max(0, Math.round(point.value * rampMax)))]!);
          // `distance` (absolute domain units), NOT the chord-normalized `t` —
          // two cells with different chord lengths must shade the same interior
          // wall identically; normalizing by chord would paint a spurious
          // silhouette-tracking gradient (VOLUMETRIC.md's Carve section).
          applyFieldSynthColor(i, point, true, Math.exp(-params.marchFade * hitDistance));
          continue;
        }

        if (xrayActive) {
          const op = context.base.objectPosition!;
          const px = op[i * 3]!, py = op[i * 3 + 1]!, pz = op[i * 3 + 2]!;
          if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue;
          const exitBuf = context.base.objectExit!;
          const exx = exitBuf[i * 3]!, exy = exitBuf[i * 3 + 1]!, exz = exitBuf[i * 3 + 2]!;
          // Unlike carve, xray has NO surface-sampling fallback for a
          // degenerate/absent chord: this deliberately differs from carve's
          // paint-at-entry fallback (VOLUMETRIC-2.md §1 "Degenerate chord") —
          // brightness of a zero-length chord is 0 (no material to absorb
          // through), and a full-strength rim ring around a transmittance
          // volume would contradict the mode. The cell just emits nothing.
          if (!Number.isFinite(exx) || !Number.isFinite(exy) || !Number.isFinite(exz)) continue;

          const mEntry: readonly [number, number, number] = [px * scale, py * scale, pz * scale];
          const mExit: readonly [number, number, number] = [exx * scale, exy * scale, exz * scale];
          const chordLength = Math.hypot(mExit[0] - mEntry[0], mExit[1] - mEntry[1], mExit[2] - mEntry[2]);
          if (!(chordLength > 0) || !Number.isFinite(chordLength)) continue; // degenerate -> emits nothing, see above

          const integral = integrateField(mEntry, mExit, densitySample, {
            steps: xrayUniformSteps, maxSteps: xrayUniformSteps, finestFreq: 0, time,
          });
          const transmittance = Math.exp(-params.xrayGain * integral.sum);
          const brightness = 1 - transmittance;
          // The `subcellRes: "ink"` full-coverage precedent: a cell that
          // emits at all gets full coverage (not level-scaled) — half a
          // transmittance value is still a real, visible brightness, and
          // fractional-coverage dither would drown the look. Cells under the
          // 1/255 threshold don't emit at all (VOLUMETRIC-2.md §1 "Output
          // mapping").
          if (brightness < 1 / 255) continue;

          setGlyph(context, i, glyphs[Math.min(rampMax, Math.max(0, Math.round(brightness * rampMax)))]!);
          // `voiceColors` is inert under xray (documented no-op on the
          // schema's `voiceColors` key): an all-zero-weight point makes
          // `applyFieldSynthColor`'s voiceColors branches fall through to the
          // plain color/colorB gradient unconditionally, regardless of
          // `params.voiceColors`.
          applyFieldSynthColor(i, {
            active: 1, value: brightness,
            cr: 0, cg: 0, cbv: 0, cw: 0, co: 0,
            car: 0, cag: 0, cabv: 0, cao: 0, caw: 0,
          }, false, 1);
          // `applyFieldSynthColor`'s shared coverage line folds the resolved
          // color's alpha into coverage — correct for paint/ink, where alpha
          // IS the intended coverage. xray's contract is different (checked
          // above, "full-coverage precedent"): coverage is 1 for any B >=
          // 1/255 regardless of color alpha, which may still tint the RGB
          // output (unchanged above) but must never thin the glyph itself —
          // a translucent xray color is a color choice, not a transmittance
          // signal. Overriding here (rather than a coverage-forcing flag
          // threaded through the shared helper) keeps carve/paint's own
          // alpha-as-coverage behavior untouched.
          context.output.coverage[i] = 1;
          continue;
        }

        let x: number, y: number, z: number, cx: number, cy: number, cz: number;
        if (volumetric) {
          const op = context.base.objectPosition!;
          const px = op[i * 3]!, py = op[i * 3 + 1]!, pz = op[i * 3 + 2]!;
          if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue;
          x = px * scale; y = py * scale; z = pz * scale;
          cx = volumetricOriginX; cy = volumetricOriginY; cz = 0;
        } else {
          const coord = fieldSynthCoordinate(
            context, i, params.space as EffectSpace, uvBounds, scale,
            params.originU, params.originV, sceneCols, sceneRows, generatedSurface,
          );
          if (!coord) continue;
          x = coord[0]; y = coord[1]; cx = coord[2]; cy = coord[3]; z = 0; cz = 0;
        }
        const point = computeFieldSynthPoint(x, y, z, cx, cy, cz);
        if (point.active === 0) continue;
        const value = point.value;
        const inkMode = params.subcellRes === "ink";
        // A contour cell can sit BELOW the level — it is one side of a crossing.
        // Dropping it here would draw only the inner edge of every contour.
        if (!inkMode && value <= 0) continue;
        if (inkMode) {
          const [dxCol, dyCol, dzCol, dxRow, dyRow, dzRow] = fieldSynthAnySubcellGradient(
            context, i, params.space as EffectSpace, uvBounds, scale, params.originU, params.originV,
            sceneCols, sceneRows, generatedSurface, x, y, z, volumetric,
          );
          const sample = (ox: number, oy: number, oz: number): number =>
            clamp01(params.bias + params.gain * evaluateFieldProgram(
              fieldProgram, x + ox, y + oy, z + oz, time, cx, cy, cz,
            ).combined * 0.5);
          const right = sample(dxCol, dyCol, dzCol);
          const down = sample(dxRow, dyRow, dzRow);
          const gx = right - value;
          const gy = down - value;
          // Contour every level, not just one: `n / (levels + 1)` spreads the
          // cuts across the interior of the range so neither extreme (a flat
          // floor or a saturated ceiling) gets a degenerate line of its own.
          // Clamp past the schema max (not just floor it) — a crafted URL
          // can set `inkLevels` to an arbitrary number (e.g. 5e6), bypassing
          // the slider's own bound, and this loop runs once per level per
          // cell: unclamped, that hangs the tab (pre-existing hostile-URL
          // hole; see `INK_LEVELS_MAX`'s doc).
          const levels = Math.min(INK_LEVELS_MAX, Math.max(1, Math.round(params.inkLevels)));
          let crosses = false;
          for (let n = 1; n <= levels && !crosses; n++) {
            const level = n / (levels + 1);
            const side = value >= level;
            crosses = side !== (right >= level) || side !== (down >= level);
          }
          if (!crosses) continue;
          setGlyph(context, i, inkGlyphForField(gx, gy));
        } else if (params.subcellRes === "2x4") {
          const [dxCol, dyCol, dzCol, dxRow, dyRow, dzRow] = fieldSynthAnySubcellGradient(
            context, i, params.space as EffectSpace, uvBounds, scale, params.originU, params.originV,
            sceneCols, sceneRows, generatedSurface, x, y, z, volumetric,
          );
          let mask = 0;
          for (let dotCol = 0; dotCol < 2; dotCol++) {
            const fx = dotCol === 0 ? -0.25 : 0.25;
            for (let dotRow = 0; dotRow < 4; dotRow++) {
              const fy = (dotRow + 0.5) / 4 - 0.5;
              const subX = x + fx * dxCol + fy * dxRow;
              const subY = y + fx * dyCol + fy * dyRow;
              const subZ = z + fx * dzCol + fy * dzRow;
              const subCombined = evaluateFieldProgram(fieldProgram, subX, subY, subZ, time, cx, cy, cz).combined;
              const subValue = clamp01(params.bias + params.gain * subCombined * 0.5);
              if (subValue > 0.5) mask |= BRAILLE_DOT_BITS[dotCol]![dotRow]!;
            }
          }
          setGlyph(context, i, String.fromCharCode(0x2800 + mask));
        } else {
          setGlyph(context, i, glyphs[Math.min(rampMax, Math.max(0, Math.round(value * rampMax)))]!);
        }
        applyFieldSynthColor(i, point, !inkMode, 1);
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
