import { cullInteriorPolygons } from "../cull/cullInteriorPolygons";
import type { MeshResolution, Polygon, TextureTriangle, Vec2, Vec3 } from "../types";
import { coverPlanarPolygons, type CoverPlanarPolygonsOptions } from "./coverPlanarPolygons";
import { mergePolygons } from "./mergePolygons";

const NORMALIZE_MAX_ANGLE_DEG = 3;
const NORMALIZE_MAX_PLANE_DISPLACEMENT = 0.03;
const NORMALIZE_MAX_BOUNDARY_DISPLACEMENT = 0.02;

export interface ApproximateMergeOptions {
  maxAngleDeg?: number;
  maxPlaneDisplacement?: number;
  maxBoundaryDisplacement?: number;
  isolatedPairs?: boolean;
}

export interface OptimizeMeshPolygonsOptions {
  /** Public quality/resolution intent. Defaults to "lossless". */
  meshResolution?: MeshResolution;
  /**
   * Run the planar cover pass as an exact candidate for untextured coplanar
   * regions. Defaults to true.
   */
  rectCover?: boolean | CoverPlanarPolygonsOptions;
  /**
   * Lossy approximate merge settings. Ignored for lossless resolution.
   * When omitted, lossy evaluates both isolated-pair and plane-group
   * strategies and chooses the lowest render-cost result that does not
   * expose internal source edges as cracks.
   */
  approximateMerge?: boolean | ApproximateMergeOptions;
}

interface ResolvedGeometryNormalizeOptions {
  maxAngleDeg: number;
  maxPlaneDisplacement: number;
  maxBoundaryDisplacement: number;
  isolatedPairs: boolean;
}

interface LossyApproximateCandidate extends ApproximateMergeOptions {
  guard: boolean;
  allowReferenceCracks?: boolean;
}

interface PlaneNormalizeMeta {
  polygon: Polygon;
  normal: Vec3;
  area: number;
  materialKey: string;
}

interface PlaneFit {
  normal: Vec3;
  point: Vec3;
}

interface PairCandidate {
  a: number;
  b: number;
  polygon: Polygon;
  score: number;
}

interface PlanePatchCandidate {
  indices: number[];
  projected: Polygon[];
  score: number;
}

interface PreprocessCache {
  baseline: Polygon[];
  snapped?: Polygon[];
  snappedInterior?: Polygon[];
}

interface Segment3 {
  a: Vec3;
  b: Vec3;
}

interface SegmentIndex {
  cellSize: number;
  cells: Map<string, Segment3[]>;
}

interface EdgeStats {
  boundaryKeys: Set<string>;
  internalKeys: Set<string>;
  boundarySegments: Segment3[];
  internalSegments: Segment3[];
  boundaryLength: number;
}

interface CrackSourceContext {
  edges: EdgeStats;
  baseTolerance: number;
  polygonCount: number;
  indexes: Map<string, SegmentIndex>;
}

interface CrackMetrics {
  maxGap: number;
  internalBoundaryLength: number;
  excessBoundaryLength: number;
}

const DEFAULT_NORMALIZE_OPTIONS: ResolvedGeometryNormalizeOptions = {
  maxAngleDeg: NORMALIZE_MAX_ANGLE_DEG,
  maxPlaneDisplacement: NORMALIZE_MAX_PLANE_DISPLACEMENT,
  maxBoundaryDisplacement: NORMALIZE_MAX_BOUNDARY_DISPLACEMENT,
  isolatedPairs: false,
};

const DEFAULT_LOSSY_APPROXIMATE_OPTIONS: Required<ApproximateMergeOptions> = {
  maxAngleDeg: 15,
  maxPlaneDisplacement: 0.35,
  maxBoundaryDisplacement: 0.075,
  isolatedPairs: true,
};

const LOSSY_BUDGET_SWEEP: Array<Required<Omit<ApproximateMergeOptions, "isolatedPairs">>> = [
  {
    maxAngleDeg: 15,
    maxPlaneDisplacement: 0.35,
    maxBoundaryDisplacement: 0.075,
  },
  {
    maxAngleDeg: 45,
    maxPlaneDisplacement: 1,
    maxBoundaryDisplacement: 0.075,
  },
  {
    maxAngleDeg: 60,
    maxPlaneDisplacement: 1.5,
    maxBoundaryDisplacement: 0.075,
  },
  {
    maxAngleDeg: 22.5,
    maxPlaneDisplacement: 0.5,
    maxBoundaryDisplacement: 0.11,
  },
  {
    maxAngleDeg: 30,
    maxPlaneDisplacement: 0.75,
    maxBoundaryDisplacement: 0.16,
  },
];

const LOSSY_COLOR_QUANTIZE_STEPS = [2, 4, 6, 8, 12] as const;
const LOSSY_SWEEP_MIN_TRIANGLES = 32;
const LOSSY_RECTANGULATED_MIN_POLYGONS = 300;
const LOSSY_RECTANGULATED_MAX_TRIANGLE_RATIO = 0.3;
const RECT_COVER_MOSTLY_QUAD_TRIANGLE_LIMIT = 96;

const DEFAULT_RECT_COVER_OPTIONS: CoverPlanarPolygonsOptions = {
  minGroupPolygons: 2,
  maxCandidateAxes: 24,
};

const EMPTY_CRACK_METRICS: CrackMetrics = {
  maxGap: 0,
  internalBoundaryLength: 0,
  excessBoundaryLength: 0,
};

export function optimizeMeshPolygons(
  polygons: Polygon[],
  options: OptimizeMeshPolygonsOptions = {},
): Polygon[] {
  const meshResolution = options.meshResolution ?? "lossless";
  const baseline = preprocessModelPolygons(polygons, false);
  const preprocessCache: PreprocessCache = { baseline };
  const candidates = [baseline];

  const rectCovered = applyRectCoverCandidate(baseline, options.rectCover);
  if (rectCovered !== baseline) candidates.push(rectCovered);

  if (meshResolution === "lossy" && options.approximateMerge !== false) {
    const crackSource = createCrackSourceContext(polygons);
    let referenceCracks: CrackMetrics | null = null;
    const automaticApproximate = options.approximateMerge === undefined || options.approximateMerge === true;
    const approximateCandidates = lossyApproximateCandidates(
      options.approximateMerge,
      automaticApproximate ? baseline : undefined,
    );
    for (let approximateIndex = 0; approximateIndex < approximateCandidates.length; approximateIndex++) {
      const approximateOptions = approximateCandidates[approximateIndex];
      const approximate = preprocessModelPolygons(polygons, approximateOptions, preprocessCache);
      if (!approximateOptions.guard && approximateOptions.isolatedPairs === true && referenceCracks === null) {
        referenceCracks = candidateCrackMetrics(
          crackSource,
          approximate,
          approximateOptions.maxBoundaryDisplacement,
        ).metrics;
      }
      if (
        approximateOptions.guard &&
        candidateHasCracks(
          crackSource,
          approximate,
          approximateOptions.maxBoundaryDisplacement,
          approximateOptions.allowReferenceCracks ? referenceCracks : null,
        )
      ) {
        continue;
      }
      candidates.push(approximate);
      const coveredApproximate = applyRectCoverCandidate(approximate, options.rectCover);
      if (
        coveredApproximate !== approximate &&
        (
          !(automaticApproximate || approximateOptions.guard) ||
          !candidateHasCracks(
            crackSource,
            coveredApproximate,
            approximateOptions.maxBoundaryDisplacement,
            approximateOptions.allowReferenceCracks ? referenceCracks : null,
          )
        )
      ) {
        candidates.push(coveredApproximate);
      }

      if (
        automaticApproximate &&
        approximateIndex === 1 &&
        shouldStopLossyBudgetSweep(bestCandidate(candidates))
      ) {
        break;
      }
    }

    if (automaticApproximate) {
      for (const colorPolygons of lossyColorQuantizeCandidates(polygons)) {
        const colorCache: PreprocessCache = {
          baseline: mergePolygons(cullInteriorPolygons(colorPolygons)),
        };
        candidates.push(colorCache.baseline);
        const coveredColor = applyRectCoverCandidate(colorCache.baseline, options.rectCover);
        if (coveredColor !== colorCache.baseline) candidates.push(coveredColor);

        for (const approximateOptions of lossyApproximateCandidates(
          options.approximateMerge,
          colorCache.baseline,
        )) {
          const approximate = preprocessModelPolygons(colorPolygons, approximateOptions, colorCache);
          if (
            approximateOptions.guard &&
            candidateHasCracks(
              crackSource,
              approximate,
              approximateOptions.maxBoundaryDisplacement,
              approximateOptions.allowReferenceCracks ? referenceCracks : null,
            )
          ) {
            continue;
          }
          candidates.push(approximate);
          const coveredApproximate = applyRectCoverCandidate(approximate, options.rectCover);
          if (
            coveredApproximate !== approximate &&
            (
              !(automaticApproximate || approximateOptions.guard) ||
              !candidateHasCracks(
                crackSource,
                coveredApproximate,
                approximateOptions.maxBoundaryDisplacement,
                approximateOptions.allowReferenceCracks ? referenceCracks : null,
              )
            )
          ) {
            candidates.push(coveredApproximate);
          }
        }
      }
    }
  }

  return candidates.reduce((best, candidate) =>
    polygonRenderCost(candidate) < polygonRenderCost(best) ? candidate : best,
  );
}

function bestCandidate(candidates: Polygon[][]): Polygon[] {
  return candidates.reduce((best, candidate) =>
    polygonRenderCost(candidate) < polygonRenderCost(best) ? candidate : best,
  );
}

function shouldStopLossyBudgetSweep(candidate: Polygon[]): boolean {
  let triangles = 0;
  for (const polygon of candidate) {
    if (polygon.vertices.length === 3) triangles += 1;
    if (triangles > LOSSY_SWEEP_MIN_TRIANGLES) return false;
  }
  return true;
}

function lossyColorQuantizeCandidates(polygons: Polygon[]): Polygon[][] {
  const profile = solidHexColorProfile(polygons);
  if (profile.eligiblePolygons < 24 || profile.colorCount < 8) return [];

  const candidates: Polygon[][] = [];
  const seen = new Set<string>();
  for (const step of LOSSY_COLOR_QUANTIZE_STEPS) {
    const quantized = quantizeSolidHexColors(polygons, step, profile.colorCount);
    if (!quantized) continue;
    const signature = colorSignature(quantized);
    if (seen.has(signature)) continue;
    seen.add(signature);
    candidates.push(quantized);
  }
  return candidates;
}

function solidHexColorProfile(polygons: Polygon[]): { eligiblePolygons: number; colorCount: number } {
  const colors = new Set<string>();
  let eligiblePolygons = 0;
  for (const polygon of polygons) {
    if (polygon.texture || polygon.material?.texture || polygon.uvs || polygon.textureTriangles?.length) {
      continue;
    }
    if (!parseHexColor(polygon.color)) continue;
    eligiblePolygons += 1;
    colors.add(polygon.color ?? "#cccccc");
  }
  return { eligiblePolygons, colorCount: colors.size };
}

function quantizeSolidHexColors(polygons: Polygon[], step: number, originalColorCount: number): Polygon[] | null {
  let changed = false;
  const quantizedColors = new Set<string>();
  const output = polygons.map((polygon) => {
    if (polygon.texture || polygon.material?.texture || polygon.uvs || polygon.textureTriangles?.length) {
      return polygon;
    }
    const color = parseHexColor(polygon.color);
    if (!color) return polygon;

    const nextColor = formatHexColor([
      Math.round(color[0] / step) * step,
      Math.round(color[1] / step) * step,
      Math.round(color[2] / step) * step,
    ]);
    quantizedColors.add(nextColor);
    if (nextColor === polygon.color) return polygon;
    changed = true;
    return { ...polygon, color: nextColor };
  });

  if (!changed || quantizedColors.size >= originalColorCount) return null;
  return output;
}

function parseHexColor(color: string | undefined): [number, number, number] | null {
  const value = color ?? "#cccccc";
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) {
    return [
      parseInt(short[1] + short[1], 16),
      parseInt(short[2] + short[2], 16),
      parseInt(short[3] + short[3], 16),
    ];
  }
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value);
  if (!full) return null;
  return [
    parseInt(full[1], 16),
    parseInt(full[2], 16),
    parseInt(full[3], 16),
  ];
}

function formatHexColor(color: [number, number, number]): string {
  return `#${color.map((channel) =>
    Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0")
  ).join("")}`;
}

function colorSignature(polygons: Polygon[]): string {
  return polygons.map((polygon) => polygon.color ?? "").join("|");
}

function lossyApproximateCandidates(
  setting: OptimizeMeshPolygonsOptions["approximateMerge"],
  baseline?: Polygon[],
): LossyApproximateCandidate[] {
  if (setting && setting !== true) {
    if (typeof setting.isolatedPairs === "boolean") {
      return [{ ...setting, guard: setting.isolatedPairs === false }];
    }
    return [
      { ...setting, isolatedPairs: true, guard: false },
      { ...setting, isolatedPairs: false, guard: true },
    ];
  }

  if (baseline && shouldUseRectangulatedLossyPath(baseline)) {
    return [{
      ...LOSSY_BUDGET_SWEEP[0],
      isolatedPairs: true,
      guard: false,
      allowReferenceCracks: true,
    }];
  }

  const candidates: LossyApproximateCandidate[] = [];
  const seen = new Set<string>();
  for (let budgetIndex = 0; budgetIndex < LOSSY_BUDGET_SWEEP.length; budgetIndex++) {
    const budget = LOSSY_BUDGET_SWEEP[budgetIndex];
    for (const isolatedPairs of [true, false]) {
      const candidate: LossyApproximateCandidate = {
        ...budget,
        isolatedPairs,
        guard: budgetIndex > 0 || isolatedPairs === false,
        allowReferenceCracks: true,
      };
      const key = [
        candidate.maxAngleDeg,
        candidate.maxPlaneDisplacement,
        candidate.maxBoundaryDisplacement,
        candidate.isolatedPairs,
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(candidate);
    }
  }

  if (candidates.length === 0) {
    return [{ ...DEFAULT_LOSSY_APPROXIMATE_OPTIONS, guard: false }];
  }
  return candidates;
}

function shouldUseRectangulatedLossyPath(baseline: Polygon[]): boolean {
  if (baseline.length < LOSSY_RECTANGULATED_MIN_POLYGONS) return false;
  const triangles = polygonTriangleCount(baseline);
  return triangles / baseline.length <= LOSSY_RECTANGULATED_MAX_TRIANGLE_RATIO;
}

function polygonRenderCost(polygons: Polygon[]): number {
  let cost = 0;
  for (const polygon of polygons) {
    const vertexCount = polygon.vertices.length;
    const irregularPenalty = vertexCount <= 4 ? 0 : Math.min(4, vertexCount - 4) * 0.12;
    const texturePenalty = polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length ? 0.15 : 0;
    cost += 1 + irregularPenalty + texturePenalty;
  }
  return cost;
}

function candidateHasCracks(
  source: CrackSourceContext,
  candidate: Polygon[],
  maxBoundaryDisplacement = 0,
  reference: CrackMetrics | null = null,
): boolean {
  const { metrics, tolerance } = candidateCrackMetrics(source, candidate, maxBoundaryDisplacement);
  if (!reference) {
    return metrics.internalBoundaryLength > 0 || metrics.excessBoundaryLength > tolerance;
  }

  const gapSlack = Math.max(tolerance * 0.1, 1e-6);
  const referenceGapLimit = reference.maxGap + gapSlack;
  const gapLimit = source.polygonCount <= 500 && tolerance <= 0.08
    ? Math.max(referenceGapLimit, tolerance * 0.95)
    : referenceGapLimit;
  const lengthSlack = Math.max(tolerance * 2, reference.internalBoundaryLength * 0.15);
  const excessSlack = Math.max(tolerance * 2, reference.excessBoundaryLength * 0.15);
  return (
    metrics.maxGap > gapLimit ||
    metrics.internalBoundaryLength > reference.internalBoundaryLength + lengthSlack ||
    metrics.excessBoundaryLength > reference.excessBoundaryLength + excessSlack
  );
}

function candidateCrackMetrics(
  source: CrackSourceContext,
  candidate: Polygon[],
  maxBoundaryDisplacement = 0,
): { metrics: CrackMetrics; tolerance: number } {
  const sourceEdges = source.edges;
  const candidateEdges = collectEdgeStats(candidate);
  const tolerance = crackToleranceForSource(source, maxBoundaryDisplacement);
  const internalIndex = tolerance > 0
    ? internalSegmentIndexForSource(source, tolerance)
    : null;
  const metrics: CrackMetrics = {
    ...EMPTY_CRACK_METRICS,
    excessBoundaryLength: Math.max(0, candidateEdges.boundaryLength - sourceEdges.boundaryLength),
  };

  for (const edge of candidateEdges.boundarySegments) {
    const key = edgeKey(edge.a, edge.b);
    if (sourceEdges.boundaryKeys.has(key)) continue;
    if (sourceEdges.internalKeys.has(key)) {
      metrics.internalBoundaryLength += distanceVec(edge.a, edge.b);
      continue;
    }
    const gap = internalIndex ? indexedInternalEdgeGap(edge, internalIndex, tolerance) : null;
    if (gap !== null) {
      metrics.maxGap = Math.max(metrics.maxGap, gap);
      metrics.internalBoundaryLength += distanceVec(edge.a, edge.b);
    }
  }
  return { metrics, tolerance };
}

function createCrackSourceContext(polygons: Polygon[]): CrackSourceContext {
  const diagonal = modelDiagonal(polygons);
  const baseTolerance = diagonal > 0
    ? Math.min(0.08, Math.max(0.001, diagonal * 0.001))
    : 0;
  return {
    edges: collectEdgeStats(polygons),
    baseTolerance,
    polygonCount: polygons.length,
    indexes: new Map(),
  };
}

function crackToleranceForSource(source: CrackSourceContext, maxBoundaryDisplacement = 0): number {
  return Math.max(source.baseTolerance, maxBoundaryDisplacement * 1.05);
}

function internalSegmentIndexForSource(source: CrackSourceContext, tolerance: number): SegmentIndex {
  const key = tolerance.toFixed(6);
  const current = source.indexes.get(key);
  if (current) return current;
  const index = buildSegmentIndex(source.edges.internalSegments, tolerance);
  source.indexes.set(key, index);
  return index;
}

function collectEdgeStats(polygons: Polygon[]): EdgeStats {
  const edges = new Map<string, { count: number; a: Vec3; b: Vec3 }>();
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.vertices.length; i++) {
      const a = polygon.vertices[i];
      const b = polygon.vertices[(i + 1) % polygon.vertices.length];
      const key = edgeKey(a, b);
      const current = edges.get(key);
      if (current) current.count += 1;
      else edges.set(key, { count: 1, a, b });
    }
  }

  const boundaryKeys = new Set<string>();
  const internalKeys = new Set<string>();
  const boundarySegments: Segment3[] = [];
  const internalSegments: Segment3[] = [];
  let boundaryLength = 0;
  for (const [key, edge] of edges) {
    const segment = { a: edge.a, b: edge.b };
    if (edge.count === 1) {
      boundaryKeys.add(key);
      boundarySegments.push(segment);
      boundaryLength += distanceVec(segment.a, segment.b);
    } else {
      internalKeys.add(key);
      internalSegments.push(segment);
    }
  }
  return { boundaryKeys, internalKeys, boundarySegments, internalSegments, boundaryLength };
}

function modelDiagonal(polygons: Polygon[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const polygon of polygons) {
    for (const [x, y, z] of polygon.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }
  return Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) : 0;
}

function buildSegmentIndex(segments: Segment3[], tolerance: number): SegmentIndex {
  const cellSize = Math.max(tolerance * 2, 1e-6);
  const cells = new Map<string, Segment3[]>();
  for (const segment of segments) {
    const [cx, cy, cz] = segmentCell(segment, cellSize);
    const key = cellKey(cx, cy, cz);
    const bucket = cells.get(key);
    if (bucket) bucket.push(segment);
    else cells.set(key, [segment]);
  }
  return { cellSize, cells };
}

function indexedInternalEdgeGap(
  segment: Segment3,
  index: SegmentIndex,
  tolerance: number,
): number | null {
  const [cx, cy, cz] = segmentCell(segment, index.cellSize);
  let best: number | null = null;
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = index.cells.get(cellKey(cx + dx, cy + dy, cz + dz));
        if (!bucket) continue;
        for (const candidate of bucket) {
          const gap = segmentEndpointGap(segment, candidate);
          if (gap <= tolerance) best = best === null ? gap : Math.min(best, gap);
        }
      }
    }
  }
  return best;
}

function segmentCell(segment: Segment3, cellSize: number): [number, number, number] {
  return [
    Math.floor(((segment.a[0] + segment.b[0]) / 2) / cellSize),
    Math.floor(((segment.a[1] + segment.b[1]) / 2) / cellSize),
    Math.floor(((segment.a[2] + segment.b[2]) / 2) / cellSize),
  ];
}

function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function segmentEndpointGap(a: Segment3, b: Segment3): number {
  return Math.min(
    Math.max(distanceVec(a.a, b.a), distanceVec(a.b, b.b)),
    Math.max(distanceVec(a.a, b.b), distanceVec(a.b, b.a)),
  );
}

function applyRectCoverCandidate(
  polygons: Polygon[],
  setting: OptimizeMeshPolygonsOptions["rectCover"],
): Polygon[] {
  if (setting === false) return polygons;
  const options = resolveRectCoverOptions(polygons, setting);
  if (!options) return polygons;
  const covered = coverPlanarPolygons(polygons, options);
  return covered.length < polygons.length ? covered : polygons;
}

function resolveRectCoverOptions(
  polygons: Polygon[],
  setting: OptimizeMeshPolygonsOptions["rectCover"],
): CoverPlanarPolygonsOptions | null {
  if (setting && setting !== true) return setting;

  const polygonCount = polygons.length;
  if (polygonCount > 2200) return null;
  if (polygonCount > 1200) {
    return {
      ...DEFAULT_RECT_COVER_OPTIONS,
      maxCandidateAxes: Math.min(DEFAULT_RECT_COVER_OPTIONS.maxCandidateAxes ?? 24, 2),
    };
  }
  if (polygonCount > 300 && polygonTriangleCount(polygons) <= RECT_COVER_MOSTLY_QUAD_TRIANGLE_LIMIT) {
    return {
      ...DEFAULT_RECT_COVER_OPTIONS,
      maxCandidateAxes: Math.min(DEFAULT_RECT_COVER_OPTIONS.maxCandidateAxes ?? 24, 2),
    };
  }
  if (polygonCount > 900) {
    return {
      ...DEFAULT_RECT_COVER_OPTIONS,
      maxCandidateAxes: Math.min(DEFAULT_RECT_COVER_OPTIONS.maxCandidateAxes ?? 24, 4),
    };
  }
  return DEFAULT_RECT_COVER_OPTIONS;
}

function polygonTriangleCount(polygons: Polygon[]): number {
  let triangles = 0;
  for (const polygon of polygons) {
    if (polygon.vertices.length === 3) triangles += 1;
  }
  return triangles;
}

function preprocessModelPolygons(
  polygons: Polygon[],
  normalizeGeometry: boolean | ApproximateMergeOptions,
  cache?: PreprocessCache,
): Polygon[] {
  const baseline = cache?.baseline ?? mergePolygons(cullInteriorPolygons(polygons));
  if (!normalizeGeometry) return baseline;

  const options = normalizeGeometry === true
    ? DEFAULT_NORMALIZE_OPTIONS
    : resolveNormalizeOptions(normalizeGeometry);
  if (options.isolatedPairs) {
    const paired = mergeIsolatedTrianglePairs(snappedInteriorPolygonsForMerge(polygons, cache), options);
    const mergedPaired = mergePolygons(paired);
    return mergedPaired.length < baseline.length ? mergedPaired : baseline;
  }
  const normalized = mergePolygons(cullInteriorPolygons(normalizeGeometryForMerge(polygons, options, cache)));
  return normalized.length < baseline.length ? normalized : baseline;
}

function snappedPolygonsForMerge(polygons: Polygon[], cache?: PreprocessCache): Polygon[] {
  if (!cache) return snapGeometryForMerge(polygons);
  if (!cache.snapped) cache.snapped = snapGeometryForMerge(polygons);
  return cache.snapped;
}

function snappedInteriorPolygonsForMerge(polygons: Polygon[], cache?: PreprocessCache): Polygon[] {
  if (!cache) return cullInteriorPolygons(snapGeometryForMerge(polygons));
  if (!cache.snappedInterior) {
    cache.snappedInterior = cullInteriorPolygons(snappedPolygonsForMerge(polygons, cache));
  }
  return cache.snappedInterior;
}

function resolveNormalizeOptions(options: ApproximateMergeOptions): ResolvedGeometryNormalizeOptions {
  return {
    maxAngleDeg: options.maxAngleDeg ?? DEFAULT_NORMALIZE_OPTIONS.maxAngleDeg,
    maxPlaneDisplacement: options.maxPlaneDisplacement ?? DEFAULT_NORMALIZE_OPTIONS.maxPlaneDisplacement,
    maxBoundaryDisplacement: options.maxBoundaryDisplacement ?? DEFAULT_NORMALIZE_OPTIONS.maxBoundaryDisplacement,
    isolatedPairs: options.isolatedPairs ?? DEFAULT_NORMALIZE_OPTIONS.isolatedPairs,
  };
}

function mergeIsolatedTrianglePairs(
  polygons: Polygon[],
  options: ResolvedGeometryNormalizeOptions,
): Polygon[] {
  const metas = polygons.map((polygon): PlaneNormalizeMeta | null => {
    const plane = planeOfPolygon(polygon);
    if (!plane) return null;
    return {
      polygon,
      normal: plane.normal,
      area: plane.area,
      materialKey: materialKeyForPolygon(polygon),
    };
  });
  const edgeOwners = new Map<string, number[]>();
  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    if (polygon.vertices.length !== 3 || !metas[i]) continue;
    for (let j = 0; j < polygon.vertices.length; j++) {
      const key = edgeKey(polygon.vertices[j], polygon.vertices[(j + 1) % polygon.vertices.length]);
      const owners = edgeOwners.get(key);
      if (owners) owners.push(i);
      else edgeOwners.set(key, [i]);
    }
  }

  const candidates: PairCandidate[] = [];
  for (const owners of edgeOwners.values()) {
    if (owners.length !== 2) continue;
    const [a, b] = owners;
    const candidate = approximateTrianglePairCandidate(a, b, polygons, metas, options);
    if (candidate) candidates.push(candidate);
  }
  const used = new Set<number>();
  const replacements = new Map<number, Polygon>();
  const skipped = new Set<number>();
  const selected = choosePairCandidates(candidates);
  for (const candidate of selected) {
    used.add(candidate.a);
    used.add(candidate.b);
    const outputIndex = Math.min(candidate.a, candidate.b);
    replacements.set(outputIndex, candidate.polygon);
    skipped.add(Math.max(candidate.a, candidate.b));
  }

  const output: Polygon[] = [];
  for (let i = 0; i < polygons.length; i++) {
    const replacement = replacements.get(i);
    if (replacement) {
      output.push(replacement);
      continue;
    }
    if (skipped.has(i)) continue;
    output.push(polygons[i]);
  }
  return output;
}

function choosePairCandidates(candidates: PairCandidate[]): PairCandidate[] {
  if (candidates.length > 3000) return choosePairCandidatesStatic(candidates);
  return choosePairCandidatesDynamic(candidates);
}

function choosePairCandidatesStatic(candidates: PairCandidate[]): PairCandidate[] {
  const pairDegrees = new Map<number, number>();
  for (const candidate of candidates) {
    pairDegrees.set(candidate.a, (pairDegrees.get(candidate.a) ?? 0) + 1);
    pairDegrees.set(candidate.b, (pairDegrees.get(candidate.b) ?? 0) + 1);
  }

  const sorted = [...candidates].sort((a, b) => {
    const degreeA = (pairDegrees.get(a.a) ?? 0) + (pairDegrees.get(a.b) ?? 0);
    const degreeB = (pairDegrees.get(b.a) ?? 0) + (pairDegrees.get(b.b) ?? 0);
    return degreeA - degreeB || a.score - b.score;
  });

  const used = new Set<number>();
  const selected: PairCandidate[] = [];
  for (const candidate of sorted) {
    if (used.has(candidate.a) || used.has(candidate.b)) continue;
    used.add(candidate.a);
    used.add(candidate.b);
    selected.push(candidate);
  }
  return selected;
}

function choosePairCandidatesDynamic(candidates: PairCandidate[]): PairCandidate[] {
  const incident = new Map<number, number[]>();
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    const aIncident = incident.get(candidate.a);
    if (aIncident) aIncident.push(i);
    else incident.set(candidate.a, [i]);
    const bIncident = incident.get(candidate.b);
    if (bIncident) bIncident.push(i);
    else incident.set(candidate.b, [i]);
  }

  const selected: PairCandidate[] = [];
  const used = new Set<number>();
  const liveDegree = (polygon: number): number => {
    let degree = 0;
    for (const index of incident.get(polygon) ?? []) {
      const candidate = candidates[index];
      if (!used.has(candidate.a) && !used.has(candidate.b)) degree += 1;
    }
    return degree;
  };

  for (;;) {
    let best: PairCandidate | null = null;
    let bestDegree = Infinity;
    for (const candidate of candidates) {
      if (used.has(candidate.a) || used.has(candidate.b)) continue;
      const degree = liveDegree(candidate.a) + liveDegree(candidate.b);
      if (
        !best ||
        degree < bestDegree ||
        (degree === bestDegree && candidate.score < best.score)
      ) {
        best = candidate;
        bestDegree = degree;
      }
    }
    if (!best) break;
    selected.push(best);
    used.add(best.a);
    used.add(best.b);
  }
  return selected;
}

function approximateTrianglePairCandidate(
  aIndex: number,
  bIndex: number,
  polygons: Polygon[],
  metas: Array<PlaneNormalizeMeta | null>,
  options: ResolvedGeometryNormalizeOptions,
): PairCandidate | null {
  const a = polygons[aIndex];
  const b = polygons[bIndex];
  const aMeta = metas[aIndex];
  const bMeta = metas[bIndex];
  if (!aMeta || !bMeta) return null;
  if (a.vertices.length !== 3 || b.vertices.length !== 3) return null;
  if (a.texture || b.texture || a.uvs || b.uvs || a.textureTriangles || b.textureTriangles) return null;
  if (aMeta.materialKey !== bMeta.materialKey) return null;

  const shared = sharedEdgeIndices(a, b);
  if (!shared) return null;
  const [ai0, ai1, bi0, bi1] = shared;
  const bGoesSameDirection = (bi0 + 1) % b.vertices.length === bi1;
  if (bGoesSameDirection) return null;

  const normalDot = Math.abs(dotVec(aMeta.normal, bMeta.normal));
  const minNormalDot = Math.cos((options.maxAngleDeg * Math.PI) / 180);
  if (normalDot < minNormalDot) return null;

  const aThird = (ai1 + 1) % a.vertices.length;
  const bThird = 3 - bi0 - bi1;
  const ring = [
    a.vertices[ai1],
    a.vertices[aThird],
    a.vertices[ai0],
    b.vertices[bThird],
  ];
  const fit = fitPlaneForVertices(ring);
  if (!fit) return null;

  let maxDistance = 0;
  let squaredDistance = 0;
  for (const vertex of ring) {
    const distance = Math.abs(signedPlaneDistance(vertex, fit));
    maxDistance = Math.max(maxDistance, distance);
    squaredDistance += distance * distance;
  }
  if (maxDistance > Math.min(options.maxPlaneDisplacement, options.maxBoundaryDisplacement)) return null;

  const vertices = ring.map((vertex) => projectVecToPlane(vertex, fit));
  if (!isConvexPolygon(vertices, fit.normal)) return null;
  const projectedPlane = planeOfPolygon({ vertices });
  if (
    !projectedPlane ||
    dotVec(projectedPlane.normal, aMeta.normal) < 0.2 ||
    dotVec(projectedPlane.normal, bMeta.normal) < 0.2
  ) {
    return null;
  }
  return {
    a: aIndex,
    b: bIndex,
    polygon: {
      vertices,
      color: a.color,
      ...(a.data ? { data: { ...a.data } } : {}),
    },
    score: squaredDistance / ring.length + maxDistance * 0.25 + (1 - normalDot) * 0.1,
  };
}

function fitPlaneForVertices(vertices: Vec3[]): PlaneFit | null {
  if (vertices.length < 3) return null;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  for (let i = 0; i < vertices.length; i++) {
    const current = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    nx += (current[1] - next[1]) * (current[2] + next[2]);
    ny += (current[2] - next[2]) * (current[0] + next[0]);
    nz += (current[0] - next[0]) * (current[1] + next[1]);
    px += current[0];
    py += current[1];
    pz += current[2];
  }
  const normal = normalizeVec([nx, ny, nz]);
  if (!normal) return null;
  return {
    normal,
    point: [px / vertices.length, py / vertices.length, pz / vertices.length],
  };
}

function isConvexPolygon(vertices: Vec3[], normal: Vec3): boolean {
  let sign = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const c = vertices[(i + 2) % vertices.length];
    const turn = dotVec(crossVec(subVec(b, a), subVec(c, b)), normal);
    if (Math.abs(turn) <= 1e-9) continue;
    const nextSign = turn > 0 ? 1 : -1;
    if (sign === 0) sign = nextSign;
    else if (sign !== nextSign) return false;
  }
  return true;
}

function normalizeGeometryForMerge(
  polygons: Polygon[],
  options: ResolvedGeometryNormalizeOptions,
  cache?: PreprocessCache,
): Polygon[] {
  const snapped = snappedPolygonsForMerge(polygons, cache);
  const planeEpsilon = planeFitEpsilon(snapped, options);
  if (planeEpsilon <= 0) return snapped;

  const metas = snapped.map((polygon): PlaneNormalizeMeta | null => {
    const plane = planeOfPolygon(polygon);
    if (!plane) return null;
    return {
      polygon,
      normal: plane.normal,
      area: plane.area,
      materialKey: materialKeyForPolygon(polygon),
    };
  });
  const adjacency = buildMergeAdjacency(snapped, metas);
  const assigned = new Set<number>();
  const output: Array<Polygon | undefined> = Array(snapped.length);
  const writeOutput = (index: number, polygon: Polygon): void => {
    output[index] = polygon;
  };

  for (let i = 0; i < snapped.length; i++) {
    const meta = metas[i];
    if (assigned.has(i)) continue;
    if (!meta) {
      writeOutput(i, snapped[i]);
      continue;
    }

    const group = growPlaneGroup(i, metas, adjacency, assigned, planeEpsilon, options);
    for (const index of group) assigned.add(index);
    if (group.length < 2) {
      writeOutput(i, snapped[i]);
      continue;
    }

    const replacements = choosePlaneGroupReplacements(group, snapped, metas, adjacency, planeEpsilon, options);
    for (const index of group) {
      writeOutput(index, replacements.get(index) ?? snapped[index]);
    }
  }

  const projected = output.flatMap((polygon) => polygon ? [polygon] : []);
  return snapGeometryForMerge(projected);
}

function snapGeometryForMerge(polygons: Polygon[]): Polygon[] {
  const geometryEpsilon = geometrySnapEpsilon(polygons);
  const uvEpsilon = 1e-4;
  if (geometryEpsilon <= 0) return polygons;

  const vertices = createVec3Snapper(geometryEpsilon);
  const uvs = createVec2Snapper(uvEpsilon);

  return polygons.map((polygon) => {
    const snappedVertices = polygon.vertices.map((vertex) => vertices.snap(vertex));
    const snappedUvs = polygon.uvs && polygon.uvs.length === polygon.vertices.length
      ? polygon.uvs.map((uv) => uvs.snap(uv))
      : undefined;
    const snappedPolygon: Polygon = {
      ...polygon,
      vertices: snappedVertices,
      ...(snappedUvs ? { uvs: snappedUvs } : {}),
    };
    return {
      ...snappedPolygon,
      ...(snappedPolygon.texture
        ? { textureTriangles: textureTrianglesForPolygon(snappedPolygon) }
        : {}),
    };
  });
}

function textureTrianglesForPolygon(polygon: Polygon): TextureTriangle[] | undefined {
  if (!polygon.texture) return undefined;
  if (polygon.uvs && polygon.uvs.length === polygon.vertices.length) {
    return fanTextureTriangles(polygon.vertices, polygon.uvs);
  }
  if (polygon.textureTriangles?.length) return cloneTextureTriangles(polygon.textureTriangles);
  return undefined;
}

function fanTextureTriangles(vertices: Vec3[], uvs: Vec2[]): TextureTriangle[] {
  const triangles: TextureTriangle[] = [];
  for (let i = 1; i < vertices.length - 1; i++) {
    triangles.push({
      vertices: [
        [...vertices[0]] as Vec3,
        [...vertices[i]] as Vec3,
        [...vertices[i + 1]] as Vec3,
      ],
      uvs: [
        [...uvs[0]] as Vec2,
        [...uvs[i]] as Vec2,
        [...uvs[i + 1]] as Vec2,
      ],
    });
  }
  return triangles;
}

function cloneTextureTriangles(triangles: TextureTriangle[]): TextureTriangle[] {
  return triangles.map((triangle) => ({
    vertices: triangle.vertices.map((vertex) => [...vertex] as Vec3) as [Vec3, Vec3, Vec3],
    uvs: triangle.uvs.map((uv) => [...uv] as Vec2) as [Vec2, Vec2, Vec2],
  }));
}

function choosePlaneGroupReplacements(
  group: number[],
  polygons: Polygon[],
  metas: Array<PlaneNormalizeMeta | null>,
  adjacency: Map<number, Set<number>>,
  planeEpsilon: number,
  options: ResolvedGeometryNormalizeOptions,
): Map<number, Polygon> {
  const fullGroup = projectedPlanePatchCandidate(group, polygons, metas, planeEpsilon, options);
  if (fullGroup) return replacementsForPlanePatch(fullGroup);
  return splitPlaneGroupIntoWinningPatches(group, polygons, metas, adjacency, planeEpsilon, options);
}

function splitPlaneGroupIntoWinningPatches(
  group: number[],
  polygons: Polygon[],
  metas: Array<PlaneNormalizeMeta | null>,
  adjacency: Map<number, Set<number>>,
  planeEpsilon: number,
  options: ResolvedGeometryNormalizeOptions,
): Map<number, Polygon> {
  const groupSet = new Set(group);
  const candidates: PlanePatchCandidate[] = [];
  for (const a of group) {
    for (const b of adjacency.get(a) ?? []) {
      if (a >= b || !groupSet.has(b)) continue;
      const candidate = projectedPlanePatchCandidate([a, b], polygons, metas, planeEpsilon, options);
      if (candidate) candidates.push(candidate);
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const used = new Set<number>();
  const replacements = new Map<number, Polygon>();
  for (const candidate of candidates) {
    if (candidate.indices.some((index) => used.has(index))) continue;
    for (let i = 0; i < candidate.indices.length; i++) {
      const index = candidate.indices[i];
      used.add(index);
      replacements.set(index, candidate.projected[i]);
    }
  }
  return replacements;
}

function replacementsForPlanePatch(candidate: PlanePatchCandidate): Map<number, Polygon> {
  const replacements = new Map<number, Polygon>();
  for (let i = 0; i < candidate.indices.length; i++) {
    replacements.set(candidate.indices[i], candidate.projected[i]);
  }
  return replacements;
}

function projectedPlanePatchCandidate(
  group: number[],
  polygons: Polygon[],
  metas: Array<PlaneNormalizeMeta | null>,
  planeEpsilon: number,
  options: ResolvedGeometryNormalizeOptions,
): PlanePatchCandidate | null {
  const fit = fitPlaneForGroup(group, metas);
  if (!fit || !groupWithinPlaneBudget(group, metas, fit, planeEpsilon, options)) return null;

  const source = group.map((index) => polygons[index]);
  const projected = source.map((polygon) => projectPolygonToPlane(polygon, fit));
  const sourceCost = polygonRenderCost(mergePolygons(source));
  const projectedCost = polygonRenderCost(mergePolygons(projected));
  if (projectedCost >= sourceCost) return null;
  return {
    indices: group,
    projected,
    score: sourceCost - projectedCost,
  };
}

function planeFitEpsilon(
  polygons: Polygon[],
  options: ResolvedGeometryNormalizeOptions,
): number {
  const geometryEpsilon = geometrySnapEpsilon(polygons);
  if (geometryEpsilon <= 0) return 0;
  return options.maxPlaneDisplacement;
}

function geometrySnapEpsilon(polygons: Polygon[]): number {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const polygon of polygons) {
    for (const [x, y, z] of polygon.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }

  if (!Number.isFinite(minX)) return 0;
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  if (diagonal <= 0) return 0;
  return Math.min(0.025, Math.max(0.0001, diagonal * 0.00025));
}

function createVec3Snapper(epsilon: number) {
  const buckets = new Map<string, Vec3[]>();
  const cell = (value: number) => Math.floor(value / epsilon);
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

  return {
    snap(input: Vec3): Vec3 {
      const cx = cell(input[0]);
      const cy = cell(input[1]);
      const cz = cell(input[2]);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const bucket = buckets.get(key(cx + dx, cy + dy, cz + dz));
            if (!bucket) continue;
            for (const candidate of bucket) {
              if (distanceVec(input, candidate) <= epsilon) {
                return [candidate[0], candidate[1], candidate[2]];
              }
            }
          }
        }
      }

      const snapped: Vec3 = [input[0], input[1], input[2]];
      const bucketKey = key(cx, cy, cz);
      const bucket = buckets.get(bucketKey);
      if (bucket) bucket.push(snapped);
      else buckets.set(bucketKey, [snapped]);
      return snapped;
    },
  };
}

function createVec2Snapper(epsilon: number) {
  const buckets = new Map<string, Vec2[]>();
  const cell = (value: number) => Math.floor(value / epsilon);
  const key = (x: number, y: number) => `${x},${y}`;

  return {
    snap(input: Vec2): Vec2 {
      const cx = cell(input[0]);
      const cy = cell(input[1]);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const bucket = buckets.get(key(cx + dx, cy + dy));
          if (!bucket) continue;
          for (const candidate of bucket) {
            if (Math.hypot(input[0] - candidate[0], input[1] - candidate[1]) <= epsilon) {
              return [candidate[0], candidate[1]];
            }
          }
        }
      }

      const snapped: Vec2 = [input[0], input[1]];
      const bucketKey = key(cx, cy);
      const bucket = buckets.get(bucketKey);
      if (bucket) bucket.push(snapped);
      else buckets.set(bucketKey, [snapped]);
      return snapped;
    },
  };
}

function materialKeyForPolygon(polygon: Polygon): string {
  return `${polygon.color ?? "#cccccc"}|${polygon.texture ?? ""}|${polygon.uvs ? "uv" : "plain"}`;
}

function planeOfPolygon(polygon: Polygon): { normal: Vec3; area: number } | null {
  const vertices = polygon.vertices;
  if (!vertices || vertices.length < 3) return null;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  const origin = vertices[0];
  for (let i = 1; i < vertices.length - 1; i++) {
    const a = subVec(vertices[i], origin);
    const b = subVec(vertices[i + 1], origin);
    const cross = crossVec(a, b);
    nx += cross[0];
    ny += cross[1];
    nz += cross[2];
  }

  const len = Math.hypot(nx, ny, nz);
  if (len <= 1e-10) return null;
  return {
    normal: [nx / len, ny / len, nz / len],
    area: len / 2,
  };
}

function buildMergeAdjacency(
  polygons: Polygon[],
  metas: Array<PlaneNormalizeMeta | null>,
): Map<number, Set<number>> {
  const edgeOwners = new Map<string, number[]>();
  const adjacency = new Map<number, Set<number>>();

  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    if (!metas[i] || polygon.vertices.length < 3) continue;
    for (let j = 0; j < polygon.vertices.length; j++) {
      const key = edgeKey(polygon.vertices[j], polygon.vertices[(j + 1) % polygon.vertices.length]);
      const owners = edgeOwners.get(key);
      if (owners) owners.push(i);
      else edgeOwners.set(key, [i]);
    }
  }

  for (const owners of edgeOwners.values()) {
    for (let a = 0; a < owners.length; a++) {
      for (let b = a + 1; b < owners.length; b++) {
        const ai = owners[a];
        const bi = owners[b];
        if (canShareMergePatch(polygons[ai], polygons[bi], metas[ai], metas[bi])) {
          addAdjacency(adjacency, ai, bi);
          addAdjacency(adjacency, bi, ai);
        }
      }
    }
  }

  return adjacency;
}

function canShareMergePatch(
  a: Polygon,
  b: Polygon,
  aMeta: PlaneNormalizeMeta | null,
  bMeta: PlaneNormalizeMeta | null,
): boolean {
  if (!aMeta || !bMeta) return false;
  if (aMeta.materialKey !== bMeta.materialKey) return false;
  if (!!a.uvs !== !!b.uvs) return false;
  if (a.texture || b.texture) return !!a.uvs && !!b.uvs;
  if (!a.uvs || !b.uvs) return true;

  const shared = sharedEdgeIndices(a, b);
  if (!shared) return false;
  const [ai0, ai1, bi0, bi1] = shared;
  return eqUv(a.uvs[ai0], b.uvs[bi0]) && eqUv(a.uvs[ai1], b.uvs[bi1]);
}

function addAdjacency(adjacency: Map<number, Set<number>>, from: number, to: number): void {
  const values = adjacency.get(from);
  if (values) values.add(to);
  else adjacency.set(from, new Set([to]));
}

function growPlaneGroup(
  seed: number,
  metas: Array<PlaneNormalizeMeta | null>,
  adjacency: Map<number, Set<number>>,
  assigned: Set<number>,
  planeEpsilon: number,
  options: ResolvedGeometryNormalizeOptions,
): number[] {
  const group = [seed];
  const queued = new Set([seed]);
  const queue = [seed];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (assigned.has(next) || queued.has(next)) continue;
      const nextMeta = metas[next];
      const seedMeta = metas[seed];
      if (!nextMeta || !seedMeta) continue;
      if (nextMeta.materialKey !== seedMeta.materialKey) continue;
      if (!canJoinPlaneGroup([...group, next], metas, planeEpsilon, options)) continue;
      group.push(next);
      queued.add(next);
      queue.push(next);
    }
  }

  return group;
}

function canJoinPlaneGroup(
  group: number[],
  metas: Array<PlaneNormalizeMeta | null>,
  planeEpsilon: number,
  options: ResolvedGeometryNormalizeOptions,
): boolean {
  const fit = fitPlaneForGroup(group, metas);
  return !!fit && groupWithinPlaneBudget(group, metas, fit, planeEpsilon, options);
}

function fitPlaneForGroup(
  group: number[],
  metas: Array<PlaneNormalizeMeta | null>,
): PlaneFit | null {
  const seed = metas[group[0]];
  if (!seed) return null;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let px = 0;
  let py = 0;
  let pz = 0;
  let weightSum = 0;

  for (const index of group) {
    const meta = metas[index];
    if (!meta) return null;
    const direction = dotVec(seed.normal, meta.normal) < 0 ? -1 : 1;
    const weight = Math.max(meta.area, 1e-6);
    nx += meta.normal[0] * direction * weight;
    ny += meta.normal[1] * direction * weight;
    nz += meta.normal[2] * direction * weight;
    for (const vertex of meta.polygon.vertices) {
      px += vertex[0];
      py += vertex[1];
      pz += vertex[2];
      weightSum += 1;
    }
  }

  const normal = normalizeVec([nx, ny, nz]);
  if (!normal || weightSum === 0) return null;
  const boundaryVertices = groupBoundaryVertexKeys(group, metas);
  const boundaryD = planeOffsetRangeForVertices(group, metas, normal, boundaryVertices);
  if (boundaryD) {
    const d = (boundaryD.min + boundaryD.max) / 2;
    return {
      normal,
      point: [normal[0] * d, normal[1] * d, normal[2] * d],
    };
  }

  return {
    normal,
    point: [px / weightSum, py / weightSum, pz / weightSum],
  };
}

function planeOffsetRangeForVertices(
  group: number[],
  metas: Array<PlaneNormalizeMeta | null>,
  normal: Vec3,
  vertexKeys: Set<string>,
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;

  for (const index of group) {
    const meta = metas[index];
    if (!meta) continue;
    for (const vertex of meta.polygon.vertices) {
      if (!vertexKeys.has(vertexKey(vertex))) continue;
      const d = dotVec(vertex, normal);
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
  }

  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

function groupWithinPlaneBudget(
  group: number[],
  metas: Array<PlaneNormalizeMeta | null>,
  fit: PlaneFit,
  planeEpsilon: number,
  options: ResolvedGeometryNormalizeOptions,
): boolean {
  const normalDotMin = Math.cos((options.maxAngleDeg * Math.PI) / 180);
  const boundaryVertices = groupBoundaryVertexKeys(group, metas);
  for (const index of group) {
    const meta = metas[index];
    if (!meta) return false;
    if (Math.abs(dotVec(meta.normal, fit.normal)) < normalDotMin) return false;
    for (const vertex of meta.polygon.vertices) {
      const limit = boundaryVertices.has(vertexKey(vertex))
        ? options.maxBoundaryDisplacement
        : planeEpsilon;
      if (Math.abs(signedPlaneDistance(vertex, fit)) > limit) return false;
    }
  }
  return true;
}

function groupBoundaryVertexKeys(
  group: number[],
  metas: Array<PlaneNormalizeMeta | null>,
): Set<string> {
  const edgeCounts = new Map<string, { count: number; a: Vec3; b: Vec3 }>();

  for (const index of group) {
    const meta = metas[index];
    if (!meta) continue;
    const vertices = meta.polygon.vertices;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i];
      const b = vertices[(i + 1) % vertices.length];
      const key = edgeKey(a, b);
      const current = edgeCounts.get(key);
      if (current) current.count += 1;
      else edgeCounts.set(key, { count: 1, a, b });
    }
  }

  const boundary = new Set<string>();
  for (const edge of edgeCounts.values()) {
    if (edge.count !== 1) continue;
    boundary.add(vertexKey(edge.a));
    boundary.add(vertexKey(edge.b));
  }
  return boundary;
}

function projectPolygonToPlane(polygon: Polygon, fit: PlaneFit): Polygon {
  return {
    ...polygon,
    vertices: polygon.vertices.map((vertex) => projectVecToPlane(vertex, fit)),
  };
}

function sharedEdgeIndices(a: Polygon, b: Polygon): [number, number, number, number] | null {
  for (let ai0 = 0; ai0 < a.vertices.length; ai0++) {
    const ai1 = (ai0 + 1) % a.vertices.length;
    for (let bi0 = 0; bi0 < b.vertices.length; bi0++) {
      const bi1 = (bi0 + 1) % b.vertices.length;
      if (eqVec(a.vertices[ai0], b.vertices[bi0]) && eqVec(a.vertices[ai1], b.vertices[bi1])) {
        return [ai0, ai1, bi0, bi1];
      }
      if (eqVec(a.vertices[ai0], b.vertices[bi1]) && eqVec(a.vertices[ai1], b.vertices[bi0])) {
        return [ai0, ai1, bi1, bi0];
      }
    }
  }
  return null;
}

function edgeKey(a: Vec3, b: Vec3): string {
  const ak = vertexKey(a);
  const bk = vertexKey(b);
  return ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
}

function vertexKey(vertex: Vec3): string {
  return `${vertex[0]},${vertex[1]},${vertex[2]}`;
}

function eqVec(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function eqUv(a: Vec2, b: Vec2): boolean {
  return Math.abs(a[0] - b[0]) <= 1e-4 && Math.abs(a[1] - b[1]) <= 1e-4;
}

function subVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dotVec(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function distanceVec(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function normalizeVec(value: Vec3): Vec3 | null {
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length <= 1e-10) return null;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function signedPlaneDistance(vertex: Vec3, fit: PlaneFit): number {
  return dotVec(subVec(vertex, fit.point), fit.normal);
}

function projectVecToPlane(vertex: Vec3, fit: PlaneFit): Vec3 {
  const distance = signedPlaneDistance(vertex, fit);
  return [
    vertex[0] - fit.normal[0] * distance,
    vertex[1] - fit.normal[1] * distance,
    vertex[2] - fit.normal[2] * distance,
  ];
}
