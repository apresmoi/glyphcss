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
   * When omitted, lossy evaluates isolated-pair and small plane-group
   * strategies, then chooses the lowest render-cost result with a near-cost
   * preference for candidates that reduce detected internal gaps.
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
  vertexMoves: VertexPositionMove[];
  score: number;
}

interface VertexPositionMove {
  key: string;
  target: Vec3;
}

interface PairCandidateRank {
  degree: number;
  score: number;
  index: number;
}

interface PolygonPairCandidate {
  a: number;
  b: number;
  vertexMoves: VertexPositionMove[];
  score: number;
}

interface PolygonPairMergeResult {
  polygons: Polygon[];
  origins: Map<string, Vec3[]>;
}

interface PlanePatchCandidate {
  indices: number[];
  source: Polygon[];
  projected: Polygon[];
  vertexMoves: VertexPositionMove[];
  score: number;
}

interface PlaneGroupReplacements {
  polygons: Map<number, Polygon>;
  vertexMoves: VertexPositionMove[];
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

interface CrackMetricSample {
  metrics: CrackMetrics;
  tolerance: number;
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

interface LossyQualityCandidate {
  polygons: Polygon[];
  cost: number;
  maxBoundaryDisplacement: number;
  metrics?: CrackMetrics;
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
  maxBoundaryDisplacement: 0.0725,
  isolatedPairs: true,
};

const LOSSY_BUDGET_SWEEP: Array<Required<Omit<ApproximateMergeOptions, "isolatedPairs">>> = [
  {
    maxAngleDeg: 15,
    maxPlaneDisplacement: 0.35,
    maxBoundaryDisplacement: 0.02,
  },
  {
    maxAngleDeg: 15,
    maxPlaneDisplacement: 0.35,
    maxBoundaryDisplacement: 0.0725,
  },
  {
    maxAngleDeg: 45,
    maxPlaneDisplacement: 1,
    maxBoundaryDisplacement: 0.0725,
  },
];

const LOSSY_COLOR_QUANTIZE_STEPS = [2, 4, 6, 8, 12] as const;
const LOSSY_RECTANGULATED_MIN_POLYGONS = 300;
const LOSSY_RECTANGULATED_MAX_TRIANGLE_RATIO = 0.3;
const LOSSY_AUTOMATIC_GROUP_MAX_POLYGONS = 300;
const LOSSY_CRACK_COST_SLACK = 16;
const LOSSY_CRACK_RELATIVE_COST_SLACK = 0.015;
const LOSSY_CRACK_QUALITY_SEARCH_MULTIPLIER = 2.6;
const LOSSY_POLYGON_PAIR_MAX_PASSES = 3;
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
  let best = baseline;
  let bestCost = polygonRenderCost(baseline);
  const acceptCandidate = (candidate: Polygon[], cost = polygonRenderCost(candidate)): boolean => {
    if (cost >= bestCost) return false;
    best = candidate;
    bestCost = cost;
    return true;
  };

  const rectCovered = applyRectCoverCandidate(baseline, options.rectCover);
  if (rectCovered !== baseline) acceptCandidate(rectCovered);

  if (meshResolution === "lossy" && options.approximateMerge !== false) {
    const crackSource = createCrackSourceContext(polygons);
    const qualityCandidates: LossyQualityCandidate[] = [];
    const referenceCracks = candidateCrackQualityMetrics(
      crackSource,
      best,
      DEFAULT_LOSSY_APPROXIMATE_OPTIONS.maxBoundaryDisplacement,
    ).metrics;
    const automaticApproximate = options.approximateMerge === undefined || options.approximateMerge === true;
    const passesLossyCrackBudget = (
      sample: CrackMetricSample,
      allowReferenceCracks = true,
    ): boolean => !crackMetricsExceed(
      crackSource,
      sample.metrics,
      sample.tolerance,
      allowReferenceCracks ? referenceCracks : null,
    );
    const acceptLossyCandidate = (
      candidate: Polygon[],
      cost: number,
    ): void => {
      acceptCandidate(candidate, cost);
    };
    const considerQualityCandidate = (
      candidate: Polygon[],
      cost: number,
      maxBoundaryDisplacement = DEFAULT_LOSSY_APPROXIMATE_OPTIONS.maxBoundaryDisplacement,
    ): void => {
      if (!automaticApproximate || cost > bestCost + lossyCrackCostSlack(bestCost)) return;
      qualityCandidates.push({
        polygons: candidate,
        cost,
        maxBoundaryDisplacement,
      });
    };
    const approximateCandidates = lossyApproximateCandidates(
      options.approximateMerge,
      automaticApproximate ? baseline : undefined,
    );
    for (let approximateIndex = 0; approximateIndex < approximateCandidates.length; approximateIndex++) {
      const approximateOptions = approximateCandidates[approximateIndex];
      const approximate = preprocessModelPolygons(polygons, approximateOptions, preprocessCache);
      const approximateCost = polygonRenderCost(approximate);
      let approximateCracks: CrackMetricSample | null = null;
      const sampleApproximateCracks = (): CrackMetricSample => {
        approximateCracks ??= candidateCrackQualityMetrics(
          crackSource,
          approximate,
          approximateOptions.maxBoundaryDisplacement,
        );
        return approximateCracks;
      };
      let approximatePassesCrackBudget = true;
      if (automaticApproximate || approximateOptions.guard) {
        const sample = sampleApproximateCracks();
        approximatePassesCrackBudget = passesLossyCrackBudget(sample, !!approximateOptions.allowReferenceCracks);
      }
      if (!approximatePassesCrackBudget && approximateCost < bestCost) {
        continue;
      }
      if (approximatePassesCrackBudget) {
        acceptLossyCandidate(approximate, approximateCost);
        considerQualityCandidate(approximate, approximateCost, approximateOptions.maxBoundaryDisplacement);
      }
      const coveredApproximate = applyRectCoverCandidate(approximate, options.rectCover);
      const coveredApproximateCost = polygonRenderCost(coveredApproximate);
      let coveredApproximateCracks: CrackMetricSample | null = null;
      const sampleCoveredApproximateCracks = (): CrackMetricSample => {
        coveredApproximateCracks ??= candidateCrackQualityMetrics(
          crackSource,
          coveredApproximate,
          approximateOptions.maxBoundaryDisplacement,
        );
        return coveredApproximateCracks;
      };
      if (coveredApproximate !== approximate && coveredApproximateCost < bestCost) {
        let coveredPassesCrackGuard = true;
        if (automaticApproximate || approximateOptions.guard) {
          coveredPassesCrackGuard = passesLossyCrackBudget(
            sampleCoveredApproximateCracks(),
            !!approximateOptions.allowReferenceCracks,
          );
        }
        if (coveredPassesCrackGuard) {
          acceptLossyCandidate(coveredApproximate, coveredApproximateCost);
          considerQualityCandidate(coveredApproximate, coveredApproximateCost, approximateOptions.maxBoundaryDisplacement);
        }
      }

    }

    if (automaticApproximate) {
      for (const colorPolygons of lossyColorQuantizeCandidates(polygons)) {
        const colorCache: PreprocessCache = {
          baseline: mergePolygons(cullInteriorPolygons(colorPolygons)),
        };
        const colorCost = polygonRenderCost(colorCache.baseline);
        let colorPassesCrackBudget = true;
        let colorCracks: CrackMetricSample | null = null;
        const sampleColorCracks = (): CrackMetricSample => {
          colorCracks ??= candidateCrackQualityMetrics(
            crackSource,
            colorCache.baseline,
            DEFAULT_LOSSY_APPROXIMATE_OPTIONS.maxBoundaryDisplacement,
          );
          return colorCracks;
        };
        if (colorCost < bestCost) colorPassesCrackBudget = passesLossyCrackBudget(sampleColorCracks());
        if (colorPassesCrackBudget) {
          acceptLossyCandidate(colorCache.baseline, colorCost);
          considerQualityCandidate(colorCache.baseline, colorCost);
        }
        const coveredColor = applyRectCoverCandidate(colorCache.baseline, options.rectCover);
        if (coveredColor !== colorCache.baseline) {
          const coveredColorCost = polygonRenderCost(coveredColor);
          if (
            coveredColorCost >= bestCost ||
            passesLossyCrackBudget(candidateCrackQualityMetrics(
              crackSource,
              coveredColor,
              DEFAULT_LOSSY_APPROXIMATE_OPTIONS.maxBoundaryDisplacement,
            ))
          ) {
            acceptLossyCandidate(coveredColor, coveredColorCost);
            considerQualityCandidate(coveredColor, coveredColorCost);
          }
        }

        for (const approximateOptions of lossyApproximateCandidates(
          options.approximateMerge,
          colorCache.baseline,
        )) {
          const approximate = preprocessModelPolygons(colorPolygons, approximateOptions, colorCache);
          const approximateCost = polygonRenderCost(approximate);
          let approximateCracks: CrackMetricSample | null = null;
          const sampleApproximateCracks = (): CrackMetricSample => {
            approximateCracks ??= candidateCrackQualityMetrics(
              crackSource,
              approximate,
              approximateOptions.maxBoundaryDisplacement,
            );
            return approximateCracks;
          };
          let approximatePassesCrackBudget = true;
          if (automaticApproximate || approximateOptions.guard) {
            const sample = sampleApproximateCracks();
            approximatePassesCrackBudget = passesLossyCrackBudget(sample, !!approximateOptions.allowReferenceCracks);
          }
          if (!approximatePassesCrackBudget && approximateCost < bestCost) {
            continue;
          }
          if (approximatePassesCrackBudget) {
            acceptLossyCandidate(approximate, approximateCost);
            considerQualityCandidate(approximate, approximateCost, approximateOptions.maxBoundaryDisplacement);
          }
          const coveredApproximate = applyRectCoverCandidate(approximate, options.rectCover);
          const coveredApproximateCost = polygonRenderCost(coveredApproximate);
          let coveredApproximateCracks: CrackMetricSample | null = null;
          const sampleCoveredApproximateCracks = (): CrackMetricSample => {
            coveredApproximateCracks ??= candidateCrackQualityMetrics(
              crackSource,
              coveredApproximate,
              approximateOptions.maxBoundaryDisplacement,
            );
            return coveredApproximateCracks;
          };
          if (coveredApproximate !== approximate && coveredApproximateCost < bestCost) {
            let coveredPassesCrackGuard = true;
            if (automaticApproximate || approximateOptions.guard) {
              coveredPassesCrackGuard = passesLossyCrackBudget(
                sampleCoveredApproximateCracks(),
                !!approximateOptions.allowReferenceCracks,
              );
            }
            if (coveredPassesCrackGuard) {
              acceptLossyCandidate(coveredApproximate, coveredApproximateCost);
              considerQualityCandidate(coveredApproximate, coveredApproximateCost, approximateOptions.maxBoundaryDisplacement);
            }
          }
        }
      }
    }

    if (automaticApproximate) {
      for (const budget of LOSSY_BUDGET_SWEEP) {
        const polygonPairOptions = resolveNormalizeOptions({ ...budget, isolatedPairs: true });
        const polygonPaired = mergeAdjacentApproximatePolygonPairs(best, polygonPairOptions);
        if (polygonPaired === best) continue;
        const polygonPairCost = polygonRenderCost(polygonPaired);
        if (polygonPairCost >= bestCost) continue;
        const polygonPairCracks = candidateCrackQualityMetrics(
          crackSource,
          polygonPaired,
          polygonPairOptions.maxBoundaryDisplacement,
        );
        if (!passesLossyCrackBudget(polygonPairCracks)) continue;
        acceptLossyCandidate(polygonPaired, polygonPairCost);
        considerQualityCandidate(
          polygonPaired,
          polygonPairCost,
          polygonPairOptions.maxBoundaryDisplacement,
        );
      }

    }

    const qualityBest = chooseLossyQualityCandidate(
      qualityCandidates,
      best,
      bestCost,
      (candidate) => {
        candidate.metrics ??= candidateCrackQualityMetrics(
          crackSource,
          candidate.polygons,
          candidate.maxBoundaryDisplacement,
        ).metrics;
        return candidate.metrics;
      },
      () => candidateCrackQualityMetrics(
        crackSource,
        best,
        DEFAULT_LOSSY_APPROXIMATE_OPTIONS.maxBoundaryDisplacement,
      ).metrics,
    );
    if (qualityBest) {
      best = qualityBest.polygons;
      bestCost = qualityBest.cost;
    }
  }

  return best;
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
  const isolatedPairModes = baseline && baseline.length > LOSSY_AUTOMATIC_GROUP_MAX_POLYGONS
    ? [true]
    : [true, false];
  for (let budgetIndex = 0; budgetIndex < LOSSY_BUDGET_SWEEP.length; budgetIndex++) {
    const budget = LOSSY_BUDGET_SWEEP[budgetIndex];
    for (const isolatedPairs of isolatedPairModes) {
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

function lossyCrackCostSlack(cost: number): number {
  return Math.max(LOSSY_CRACK_COST_SLACK, cost * LOSSY_CRACK_RELATIVE_COST_SLACK);
}

function chooseLossyQualityCandidate(
  candidates: LossyQualityCandidate[],
  best: Polygon[],
  bestCost: number,
  candidateMetrics: (candidate: LossyQualityCandidate) => CrackMetrics,
  bestMetrics: () => CrackMetrics,
): LossyQualityCandidate | null {
  if (candidates.length === 0) return null;

  const slack = lossyCrackCostSlack(bestCost);
  const currentCandidate = candidates.find((candidate) => candidate.polygons === best);
  let currentMetrics: CrackMetrics | null = null;
  let selected: LossyQualityCandidate | null = null;
  let selectedMetrics: CrackMetrics | null = null;

  for (const candidate of candidates) {
    if (candidate.polygons === best || candidate.cost > bestCost + slack) continue;
    const metrics = candidateMetrics(candidate);
    currentMetrics ??= currentCandidate ? candidateMetrics(currentCandidate) : bestMetrics();
    if (!crackMetricsMateriallyBetter(metrics, currentMetrics)) continue;
    if (!selected || !selectedMetrics || compareLossyQualityCandidates(candidate, metrics, selected, selectedMetrics) < 0) {
      selected = candidate;
      selectedMetrics = metrics;
    }
  }

  return selected;
}

function compareLossyQualityCandidates(
  a: LossyQualityCandidate,
  aMetrics: CrackMetrics,
  b: LossyQualityCandidate,
  bMetrics: CrackMetrics,
): number {
  return (
    aMetrics.maxGap - bMetrics.maxGap ||
    aMetrics.internalBoundaryLength - bMetrics.internalBoundaryLength ||
    aMetrics.excessBoundaryLength - bMetrics.excessBoundaryLength ||
    a.cost - b.cost
  );
}

function crackMetricsMateriallyBetter(candidate: CrackMetrics, current: CrackMetrics): boolean {
  const gapSlack = Math.max(0.0005, current.maxGap * 0.02);
  if (candidate.maxGap < current.maxGap - gapSlack) return true;
  if (candidate.maxGap > current.maxGap + gapSlack) return false;

  const lengthSlack = Math.max(8, current.internalBoundaryLength * 0.01);
  if (candidate.internalBoundaryLength < current.internalBoundaryLength - lengthSlack) return true;
  if (candidate.internalBoundaryLength > current.internalBoundaryLength + lengthSlack) return false;

  const excessSlack = Math.max(8, current.excessBoundaryLength * 0.01);
  return candidate.excessBoundaryLength < current.excessBoundaryLength - excessSlack;
}

function crackMetricsExceed(
  source: CrackSourceContext,
  metrics: CrackMetrics,
  tolerance: number,
  reference: CrackMetrics | null = null,
): boolean {
  if (!reference) {
    return metrics.internalBoundaryLength > 0 || metrics.excessBoundaryLength > tolerance;
  }

  const gapSlack = Math.max(tolerance * 0.1, 1e-6);
  const referenceGapLimit = reference.maxGap + gapSlack;
  const gapLimit = tolerance <= 0.08
    ? Math.max(referenceGapLimit, Math.min(tolerance * 0.75, 0.04))
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
  searchTolerance = crackToleranceForSource(source, maxBoundaryDisplacement),
): CrackMetricSample {
  const sourceEdges = source.edges;
  const candidateEdges = collectEdgeStats(candidate);
  const tolerance = crackToleranceForSource(source, maxBoundaryDisplacement);
  const internalIndex = searchTolerance > 0
    ? internalSegmentIndexForSource(source, searchTolerance)
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
    const gap = internalIndex ? indexedInternalEdgeGap(edge, internalIndex, searchTolerance) : null;
    if (gap !== null) {
      metrics.maxGap = Math.max(metrics.maxGap, gap);
      metrics.internalBoundaryLength += distanceVec(edge.a, edge.b);
    }
  }
  return { metrics, tolerance };
}

function candidateCrackQualityMetrics(
  source: CrackSourceContext,
  candidate: Polygon[],
  maxBoundaryDisplacement = 0,
): CrackMetricSample {
  return candidateCrackMetrics(
    source,
    candidate,
    maxBoundaryDisplacement,
    crackQualitySearchToleranceForSource(source, maxBoundaryDisplacement),
  );
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

function crackQualitySearchToleranceForSource(source: CrackSourceContext, maxBoundaryDisplacement = 0): number {
  return Math.max(
    crackToleranceForSource(source, maxBoundaryDisplacement),
    source.baseTolerance * LOSSY_CRACK_QUALITY_SEARCH_MULTIPLIER,
    maxBoundaryDisplacement * LOSSY_CRACK_QUALITY_SEARCH_MULTIPLIER,
  );
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
  const vertexMoves = averagedVertexPositionMoves(selected.flatMap((candidate) => candidate.vertexMoves));
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
  return vertexMoves.size > 0 ? applyVertexPositionMoves(output, vertexMoves) : output;
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
  const live = new Array(candidates.length).fill(true);
  const liveIncidentCount = new Map<number, number>();
  const heap = new PairCandidateRankHeap();

  for (const [polygon, list] of incident) liveIncidentCount.set(polygon, list.length);
  const liveDegree = (candidate: PairCandidate): number =>
    (liveIncidentCount.get(candidate.a) ?? 0) + (liveIncidentCount.get(candidate.b) ?? 0);
  const pushRank = (index: number): void => {
    const candidate = candidates[index];
    heap.push({
      degree: liveDegree(candidate),
      score: candidate.score,
      index,
    });
  };
  const invalidate = (index: number, changedPolygons: Set<number>): void => {
    if (!live[index]) return;
    live[index] = false;
    const candidate = candidates[index];
    for (const polygon of [candidate.a, candidate.b]) {
      liveIncidentCount.set(polygon, (liveIncidentCount.get(polygon) ?? 0) - 1);
      changedPolygons.add(polygon);
    }
  };

  for (let i = 0; i < candidates.length; i++) pushRank(i);

  while (heap.size() > 0) {
    const rank = heap.pop()!;
    if (!live[rank.index]) continue;

    const candidate = candidates[rank.index];
    const degree = liveDegree(candidate);
    if (degree !== rank.degree) {
      pushRank(rank.index);
      continue;
    }

    selected.push(candidate);

    const changedPolygons = new Set<number>();
    for (const polygon of [candidate.a, candidate.b]) {
      for (const index of incident.get(polygon) ?? []) {
        invalidate(index, changedPolygons);
      }
    }

    for (const polygon of changedPolygons) {
      for (const index of incident.get(polygon) ?? []) {
        if (live[index]) pushRank(index);
      }
    }
  }
  return selected;
}

class PairCandidateRankHeap {
  private items: PairCandidateRank[] = [];

  size(): number {
    return this.items.length;
  }

  push(item: PairCandidateRank): void {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (comparePairCandidateRanks(this.items[parent], this.items[index]) <= 0) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  pop(): PairCandidateRank | null {
    if (this.items.length === 0) return null;
    const top = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length > 0) {
      this.items[0] = last;
      let index = 0;
      for (;;) {
        const left = index * 2 + 1;
        const right = left + 1;
        let best = index;
        if (left < this.items.length && comparePairCandidateRanks(this.items[left], this.items[best]) < 0) best = left;
        if (right < this.items.length && comparePairCandidateRanks(this.items[right], this.items[best]) < 0) best = right;
        if (best === index) break;
        [this.items[index], this.items[best]] = [this.items[best], this.items[index]];
        index = best;
      }
    }
    return top;
  }
}

function comparePairCandidateRanks(a: PairCandidateRank, b: PairCandidateRank): number {
  return a.degree - b.degree || a.score - b.score || a.index - b.index;
}

function mergeAdjacentApproximatePolygonPairs(
  polygons: Polygon[],
  options: ResolvedGeometryNormalizeOptions,
): Polygon[] {
  let current = polygons;
  let currentCost = polygonRenderCost(current);
  let origins = vertexOriginsForPolygons(current);

  for (let pass = 0; pass < LOSSY_POLYGON_PAIR_MAX_PASSES; pass++) {
    const result = mergeAdjacentApproximatePolygonPairPass(current, options, origins);
    if (!result) break;
    const nextCost = polygonRenderCost(result.polygons);
    if (nextCost >= currentCost) break;
    current = result.polygons;
    currentCost = nextCost;
    origins = result.origins;
  }

  return current === polygons ? polygons : current;
}

function mergeAdjacentApproximatePolygonPairPass(
  polygons: Polygon[],
  options: ResolvedGeometryNormalizeOptions,
  origins: Map<string, Vec3[]>,
): PolygonPairMergeResult | null {
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
  const edgeOwners = new Map<string, Array<{ polygon: number; edge: number }>>();
  for (let i = 0; i < polygons.length; i++) {
    const polygon = polygons[i];
    if (!metas[i] || polygon.vertices.length < 3) continue;
    for (let edge = 0; edge < polygon.vertices.length; edge++) {
      const key = edgeKey(polygon.vertices[edge], polygon.vertices[(edge + 1) % polygon.vertices.length]);
      const owners = edgeOwners.get(key);
      if (owners) owners.push({ polygon: i, edge });
      else edgeOwners.set(key, [{ polygon: i, edge }]);
    }
  }

  const candidates: PolygonPairCandidate[] = [];
  for (const owners of edgeOwners.values()) {
    if (owners.length !== 2) continue;
    const [a, b] = owners;
    const candidate = approximatePolygonPairCandidate(a.polygon, a.edge, b.polygon, b.edge, polygons, metas, options);
    if (candidate) candidates.push(candidate);
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  const used = new Set<number>();
  const selected: PolygonPairCandidate[] = [];
  for (const candidate of candidates) {
    if (used.has(candidate.a) || used.has(candidate.b)) continue;
    used.add(candidate.a);
    used.add(candidate.b);
    selected.push(candidate);
  }
  if (selected.length === 0) return null;

  const vertexMoves = averagedVertexPositionMoves(selected.flatMap((candidate) => candidate.vertexMoves));
  if (!vertexPositionMovesWithinOriginBudget(vertexMoves, origins, options.maxBoundaryDisplacement)) {
    return null;
  }

  const moved = applyVertexPositionMoves(polygons, vertexMoves);
  const movedOrigins = applyVertexPositionMovesToOrigins(polygons, vertexMoves, origins);
  const merged = mergePolygons(moved);
  return polygonRenderCost(merged) < polygonRenderCost(polygons)
    ? { polygons: merged, origins: pruneVertexOriginsToPolygons(merged, movedOrigins) }
    : null;
}

function approximatePolygonPairCandidate(
  aIndex: number,
  aEdge: number,
  bIndex: number,
  bEdge: number,
  polygons: Polygon[],
  metas: Array<PlaneNormalizeMeta | null>,
  options: ResolvedGeometryNormalizeOptions,
): PolygonPairCandidate | null {
  const a = polygons[aIndex];
  const b = polygons[bIndex];
  const aMeta = metas[aIndex];
  const bMeta = metas[bIndex];
  if (!aMeta || !bMeta) return null;
  if (a.vertices.length === 3 && b.vertices.length === 3) return null;
  if (!canApproximatePairMerge(a, b, aMeta, bMeta)) return null;

  const normalDot = Math.abs(dotVec(aMeta.normal, bMeta.normal));
  const minNormalDot = Math.cos((options.maxAngleDeg * Math.PI) / 180);
  if (normalDot < minNormalDot) return null;

  const ring = boundaryRingForAdjacentPair(a, b, aEdge) ?? boundaryRingForAdjacentPair(b, a, bEdge);
  if (!ring || ring.length < 4 || ring.length > 10) return null;
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

  const projected = ring.map((vertex) => projectVecToPlane(vertex, fit));
  if (!isConvexPolygon(projected, fit.normal)) return null;
  const projectedPlane = planeOfPolygon({ vertices: projected });
  if (
    !projectedPlane ||
    dotVec(projectedPlane.normal, aMeta.normal) < 0.2 ||
    dotVec(projectedPlane.normal, bMeta.normal) < 0.2
  ) {
    return null;
  }

  const vertexMoves = [
    ...ring.map((vertex, index) => ({
      key: vertexKey(vertex),
      target: projected[index],
    })),
    ...textureTriangleVertexProjectionMoves([a, b], fit),
  ];
  const projectedPair = applyVertexPositionMoves([a, b], averagedVertexPositionMoves(vertexMoves));
  const sourceCost = polygonRenderCost([a, b]);
  const projectedCost = polygonRenderCost(mergePolygons(projectedPair));
  if (projectedCost >= sourceCost) return null;

  const score = sourceCost - projectedCost - (squaredDistance / ring.length + maxDistance * 0.25 + (1 - normalDot) * 0.1);
  if (score <= 0) return null;
  return {
    a: aIndex,
    b: bIndex,
    vertexMoves,
    score,
  };
}

function boundaryRingForAdjacentPair(a: Polygon, b: Polygon, aEdge: number): Vec3[] | null {
  const aVertices = a.vertices;
  const bVertices = b.vertices;
  const a0 = aVertices[aEdge];
  const a1 = aVertices[(aEdge + 1) % aVertices.length];
  let bEdge = -1;
  for (let i = 0; i < bVertices.length; i++) {
    if (eqVec(bVertices[i], a1) && eqVec(bVertices[(i + 1) % bVertices.length], a0)) {
      bEdge = i;
      break;
    }
  }
  if (bEdge < 0) return null;

  const ring: Vec3[] = [];
  let index = (aEdge + 1) % aVertices.length;
  ring.push(aVertices[index]);
  while (index !== aEdge) {
    index = (index + 1) % aVertices.length;
    ring.push(aVertices[index]);
  }

  index = (bEdge + 2) % bVertices.length;
  while (index !== bEdge) {
    const vertex = bVertices[index];
    if (!eqVec(vertex, ring[ring.length - 1])) ring.push(vertex);
    index = (index + 1) % bVertices.length;
  }
  if (ring.length > 1 && eqVec(ring[0], ring[ring.length - 1])) ring.pop();
  return ring;
}

function vertexPositionMovesWithinOriginBudget(
  moves: Map<string, Vec3>,
  origins: Map<string, Vec3[]>,
  budget: number,
): boolean {
  for (const [key, target] of moves) {
    const fallback = vertexFromKey(key);
    const candidates = origins.get(key) ?? (fallback ? [fallback] : []);
    if (candidates.length === 0) return false;
    for (const source of candidates) {
      if (distanceVec(source, target) > budget + 1e-6) return false;
    }
  }
  return true;
}

function vertexOriginsForPolygons(polygons: Polygon[]): Map<string, Vec3[]> {
  const origins = new Map<string, Vec3[]>();
  for (const polygon of polygons) {
    for (const vertex of polygon.vertices) {
      addVertexOrigin(origins, vertexKey(vertex), vertex);
    }
    for (const triangle of polygon.textureTriangles ?? []) {
      for (const vertex of triangle.vertices) {
        addVertexOrigin(origins, vertexKey(vertex), vertex);
      }
    }
  }
  return origins;
}

function applyVertexPositionMovesToOrigins(
  polygons: Polygon[],
  moves: Map<string, Vec3>,
  origins: Map<string, Vec3[]>,
): Map<string, Vec3[]> {
  const moved = new Map<string, Vec3[]>();
  for (const polygon of polygons) {
    const vertices = [
      ...polygon.vertices,
      ...(polygon.textureTriangles ?? []).flatMap((triangle) => triangle.vertices),
    ];
    for (const vertex of vertices) {
      const sourceKey = vertexKey(vertex);
      const target = moves.get(sourceKey) ?? vertex;
      const targetKey = vertexKey(target);
      for (const origin of origins.get(sourceKey) ?? [vertex]) {
        addVertexOrigin(moved, targetKey, origin);
      }
    }
  }
  return moved;
}

function pruneVertexOriginsToPolygons(
  polygons: Polygon[],
  origins: Map<string, Vec3[]>,
): Map<string, Vec3[]> {
  const pruned = new Map<string, Vec3[]>();
  for (const polygon of polygons) {
    const vertices = [
      ...polygon.vertices,
      ...(polygon.textureTriangles ?? []).flatMap((triangle) => triangle.vertices),
    ];
    for (const vertex of vertices) {
      const key = vertexKey(vertex);
      for (const origin of origins.get(key) ?? [vertex]) {
        addVertexOrigin(pruned, key, origin);
      }
    }
  }
  return pruned;
}

function addVertexOrigin(origins: Map<string, Vec3[]>, key: string, origin: Vec3): void {
  const values = origins.get(key);
  if (!values) {
    origins.set(key, [origin]);
    return;
  }
  const originKey = vertexKey(origin);
  if (!values.some((value) => vertexKey(value) === originKey)) values.push(origin);
}

function vertexFromKey(key: string): Vec3 | null {
  const parts = key.split(",").map(Number);
  return parts.length === 3 && parts.every(Number.isFinite)
    ? [parts[0], parts[1], parts[2]]
    : null;
}

function averagedVertexPositionMoves(moves: VertexPositionMove[]): Map<string, Vec3> {
  const totals = new Map<string, { x: number; y: number; z: number; count: number }>();
  for (const move of moves) {
    const total = totals.get(move.key);
    if (total) {
      total.x += move.target[0];
      total.y += move.target[1];
      total.z += move.target[2];
      total.count += 1;
    } else {
      totals.set(move.key, {
        x: move.target[0],
        y: move.target[1],
        z: move.target[2],
        count: 1,
      });
    }
  }

  const averaged = new Map<string, Vec3>();
  for (const [key, total] of totals) {
    averaged.set(key, [
      total.x / total.count,
      total.y / total.count,
      total.z / total.count,
    ]);
  }
  return averaged;
}

function vertexPositionMovesForProjection(source: Polygon[], projected: Polygon[]): VertexPositionMove[] {
  const moves: VertexPositionMove[] = [];
  for (let i = 0; i < source.length; i++) {
    const sourceVertices = source[i].vertices;
    const projectedVertices = projected[i]?.vertices;
    if (!projectedVertices || projectedVertices.length !== sourceVertices.length) continue;
    for (let j = 0; j < sourceVertices.length; j++) {
      moves.push({
        key: vertexKey(sourceVertices[j]),
        target: projectedVertices[j],
      });
    }
    const sourceTriangles = source[i].textureTriangles ?? [];
    const projectedTriangles = projected[i]?.textureTriangles ?? [];
    for (let j = 0; j < sourceTriangles.length; j++) {
      const projectedTriangle = projectedTriangles[j];
      if (!projectedTriangle) continue;
      for (let k = 0; k < sourceTriangles[j].vertices.length; k++) {
        moves.push({
          key: vertexKey(sourceTriangles[j].vertices[k]),
          target: projectedTriangle.vertices[k],
        });
      }
    }
  }
  return moves;
}

function textureTriangleVertexProjectionMoves(polygons: Polygon[], fit: PlaneFit): VertexPositionMove[] {
  const moves: VertexPositionMove[] = [];
  for (const polygon of polygons) {
    for (const triangle of polygon.textureTriangles ?? []) {
      for (const vertex of triangle.vertices) {
        moves.push({
          key: vertexKey(vertex),
          target: projectVecToPlane(vertex, fit),
        });
      }
    }
  }
  return moves;
}

function applyVertexPositionMoves(polygons: Polygon[], moves: Map<string, Vec3>): Polygon[] {
  return polygons.map((polygon) => {
    let changed = false;
    const moveVertex = (vertex: Vec3): Vec3 => {
      const target = moves.get(vertexKey(vertex));
      if (!target) return vertex;
      changed = true;
      return target;
    };
    const vertices = polygon.vertices.map(moveVertex);
    const textureTriangles = mapTextureTriangleVertices(polygon.textureTriangles, moveVertex);
    return changed ? {
      ...polygon,
      vertices,
      ...(textureTriangles ? { textureTriangles } : {}),
    } : polygon;
  });
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
  if (!canApproximatePairMerge(a, b, aMeta, bMeta)) return null;

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

  const projected = ring.map((vertex) => projectVecToPlane(vertex, fit));
  if (!isConvexPolygon(projected, fit.normal)) return null;
  const projectedPlane = planeOfPolygon({ vertices: projected });
  if (
    !projectedPlane ||
    dotVec(projectedPlane.normal, aMeta.normal) < 0.2 ||
    dotVec(projectedPlane.normal, bMeta.normal) < 0.2
  ) {
    return null;
  }
  const polygon: Polygon = {
    vertices: ring,
    color: a.color,
    ...(a.data ? { data: { ...a.data } } : {}),
  };
  if (canUseTexturedLossyMerge(a, b) && a.uvs && b.uvs && a.texture) {
    polygon.texture = a.texture;
    polygon.uvs = [
      [...a.uvs[ai1]] as Vec2,
      [...a.uvs[aThird]] as Vec2,
      [...a.uvs[ai0]] as Vec2,
      [...b.uvs[bThird]] as Vec2,
    ];
    const textureTriangles = textureTrianglesForPolygons([a, b]);
    if (textureTriangles?.length) polygon.textureTriangles = textureTriangles;
  }

  return {
    a: aIndex,
    b: bIndex,
    polygon,
    vertexMoves: [
      ...ring.map((vertex, index) => ({
        key: vertexKey(vertex),
        target: projected[index],
      })),
      ...textureTriangleVertexProjectionMoves([a, b], fit),
    ],
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
  const vertexMoves: VertexPositionMove[] = [];
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
    vertexMoves.push(...replacements.vertexMoves);
    for (const index of group) {
      writeOutput(index, replacements.polygons.get(index) ?? snapped[index]);
    }
  }

  const projected = output.flatMap((polygon) => polygon ? [polygon] : []);
  const moved = vertexMoves.length > 0
    ? applyVertexPositionMoves(projected, averagedVertexPositionMoves(vertexMoves))
    : projected;
  return snapGeometryForMerge(moved);
}

function snapGeometryForMerge(polygons: Polygon[]): Polygon[] {
  const geometryEpsilon = geometrySnapEpsilon(polygons);
  const uvEpsilon = 1e-4;
  if (geometryEpsilon <= 0) return polygons;

  const vertices = createVec3Snapper(geometryEpsilon);
  const uvs = createVec2Snapper(uvEpsilon);

  return polygons.map((polygon) => {
    const snapVertex = (vertex: Vec3): Vec3 => vertices.snap(vertex);
    const snappedVertices = polygon.vertices.map(snapVertex);
    const snappedUvs = polygon.uvs && polygon.uvs.length === polygon.vertices.length
      ? polygon.uvs.map((uv) => uvs.snap(uv))
      : undefined;
    const snappedTextureTriangles = mapTextureTriangleVertices(polygon.textureTriangles, snapVertex);
    const snappedPolygon: Polygon = {
      ...polygon,
      vertices: snappedVertices,
      ...(snappedUvs ? { uvs: snappedUvs } : {}),
      ...(snappedTextureTriangles ? { textureTriangles: snappedTextureTriangles } : {}),
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
  if (polygon.textureTriangles?.length) return cloneTextureTriangles(polygon.textureTriangles);
  if (polygon.uvs && polygon.uvs.length === polygon.vertices.length) {
    return fanTextureTriangles(polygon.vertices, polygon.uvs);
  }
  return undefined;
}

function textureTrianglesForPolygons(polygons: Polygon[]): TextureTriangle[] | undefined {
  const triangles = polygons.flatMap((polygon) => textureTrianglesForPolygon(polygon) ?? []);
  return triangles.length > 0 ? triangles : undefined;
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

function mapTextureTriangleVertices(
  triangles: TextureTriangle[] | undefined,
  mapVertex: (vertex: Vec3) => Vec3,
): TextureTriangle[] | undefined {
  if (!triangles?.length) return undefined;
  return triangles.map((triangle) => ({
    vertices: triangle.vertices.map(mapVertex) as [Vec3, Vec3, Vec3],
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
): PlaneGroupReplacements {
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
): PlaneGroupReplacements {
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
  const vertexMoves: VertexPositionMove[] = [];
  for (const candidate of candidates) {
    if (candidate.indices.some((index) => used.has(index))) continue;
    vertexMoves.push(...candidate.vertexMoves);
    for (let i = 0; i < candidate.indices.length; i++) {
      const index = candidate.indices[i];
      used.add(index);
      replacements.set(index, polygons[index]);
    }
  }
  return { polygons: replacements, vertexMoves };
}

function replacementsForPlanePatch(candidate: PlanePatchCandidate): PlaneGroupReplacements {
  const replacements = new Map<number, Polygon>();
  for (let i = 0; i < candidate.indices.length; i++) {
    replacements.set(candidate.indices[i], candidate.source[i]);
  }
  return { polygons: replacements, vertexMoves: candidate.vertexMoves };
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
    source,
    projected,
    vertexMoves: vertexPositionMovesForProjection(source, projected),
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
  if (hasTextureMergeState(a) || hasTextureMergeState(b)) return canUseTexturedLossyMerge(a, b);
  if (!a.uvs || !b.uvs) return true;

  const shared = sharedEdgeIndices(a, b);
  if (!shared) return false;
  const [ai0, ai1, bi0, bi1] = shared;
  return eqUv(a.uvs[ai0], b.uvs[bi0]) && eqUv(a.uvs[ai1], b.uvs[bi1]);
}

function canApproximatePairMerge(
  a: Polygon,
  b: Polygon,
  aMeta: PlaneNormalizeMeta,
  bMeta: PlaneNormalizeMeta,
): boolean {
  if (aMeta.materialKey !== bMeta.materialKey) return false;
  if (hasTextureMergeState(a) || hasTextureMergeState(b)) return canUseTexturedLossyMerge(a, b);
  return !a.uvs && !b.uvs && !a.textureTriangles?.length && !b.textureTriangles?.length;
}

function hasTextureMergeState(polygon: Polygon): boolean {
  return Boolean(polygon.texture || polygon.material?.texture || polygon.textureTriangles?.length);
}

function canUseTexturedLossyMerge(a: Polygon, b: Polygon): boolean {
  if (!a.texture || !b.texture || a.texture !== b.texture) return false;
  if (a.material?.texture || b.material?.texture) return false;
  if (!a.uvs || !b.uvs) return false;
  if (a.uvs.length !== a.vertices.length || b.uvs.length !== b.vertices.length) return false;

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
  const projectVertex = (vertex: Vec3): Vec3 => projectVecToPlane(vertex, fit);
  const textureTriangles = mapTextureTriangleVertices(polygon.textureTriangles, projectVertex);
  return {
    ...polygon,
    vertices: polygon.vertices.map(projectVertex),
    ...(textureTriangles ? { textureTriangles } : {}),
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
