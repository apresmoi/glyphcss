import type { GridContext } from "./core/types";
import type { FacePlan, PlaneShellAxis } from "./core/shellRenderer/types";

type SampleStats = {
  count: number;
  sum: number;
  mean: number;
  min: number;
  max: number;
  p50: number;
  p90: number;
  p99: number;
};

type AxisRenderStats = {
  idealCells: number;
  paintCells: number;
  paintedCells: number;
  pseudoArea: number;
  pseudoLayers: number;
  brushNodes: number;
  svgNodes: number;
  svgArea: number;
  overdrawCells: number;
  overdrawRatio: number;
  paintScore: number;
};

type PlaneShellStats = {
  idealCells: number;
  paintCells: number;
  paintedCells: number;
  overdrawCells: number;
  overdrawRatio: number;
  paintScore: number;
  brushNodes: number;
  pseudoLayers: number;
  pseudoArea: number;
  svgNodes: number;
  svgPaths: number;
  svgWrapNodes: number;
  compositeNodes: number;
  axis: Record<PlaneShellAxis, AxisRenderStats>;
  brushModes: { base: number; stamp: number; combo: number; total: number };
  pairing: { absorbedParents: number; absorbRects: number; nestedParents: number; childBrushes: number };
  pseudoRects: { brushes: number; before: number; after: number };
  pseudoAreaStats: SampleStats;
  brushAreaStats: SampleStats;
  svgAreaStats: SampleStats;
  svgFallback: { total: number; invalidDetail: number; rectThreshold: number };
};

type PlaneShellReportInput = {
  stats: PlaneShellStats;
  context: GridContext;
  plans: FacePlan[];
  reasons: string[];
  planCacheNote: string;
};

let lastReportKey = "";

const formatRatio = (value: number, digits: number): number =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : 0;

const formatSampleStats = (stats: SampleStats): SampleStats => ({
  count: stats.count,
  sum: Math.round(stats.sum),
  mean: formatRatio(stats.mean, 2),
  min: Math.round(stats.min),
  max: Math.round(stats.max),
  p50: Math.round(stats.p50),
  p90: Math.round(stats.p90),
  p99: Math.round(stats.p99)
});

const formatAxisStats = (axis: Record<PlaneShellAxis, AxisRenderStats>): Record<PlaneShellAxis, AxisRenderStats> => {
  const formatAxis = (stats: AxisRenderStats): AxisRenderStats => ({
    idealCells: Math.round(stats.idealCells),
    paintCells: Math.round(stats.paintCells),
    paintedCells: Math.round(stats.paintedCells),
    pseudoArea: Math.round(stats.pseudoArea),
    pseudoLayers: stats.pseudoLayers,
    brushNodes: stats.brushNodes,
    svgNodes: stats.svgNodes,
    svgArea: Math.round(stats.svgArea),
    overdrawCells: Math.round(stats.overdrawCells),
    overdrawRatio: formatRatio(stats.overdrawRatio, 3),
    paintScore: formatRatio(stats.paintScore, 3)
  });
  return {
    x: formatAxis(axis.x),
    y: formatAxis(axis.y),
    z: formatAxis(axis.z)
  };
};

const getRectArea = (rect: { width?: number; height?: number; r0?: number; r1?: number; c0?: number; c1?: number }): number => {
  const width = "width" in rect ? rect.width ?? 0 : (rect.c1 ?? 0) - (rect.c0 ?? 0);
  const height = "height" in rect ? rect.height ?? 0 : (rect.r1 ?? 0) - (rect.r0 ?? 0);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
};

export const reportPlaneShellStats = ({
  stats,
  context,
  plans,
  reasons,
  planCacheNote
}: PlaneShellReportInput): void => {
  const walls = context.walls ?? {};
  const renderedPlans = plans.filter((plan) => !walls[plan.key.face]);
  const axisCounts = { x: 0, y: 0, z: 0 };
  let fallbackPlans = 0;
  let hostCount = 0;
  let detailHostCount = 0;
  let detailPathCount = 0;
  let detailRectCount = 0;
  let hostArea = 0;
  let detailHostArea = 0;
  let detailRectArea = 0;
  let detailTransparentArea = 0;
  for (const plan of renderedPlans) {
    axisCounts[plan.key.axis] += 1;
    if (plan.fallback) fallbackPlans += 1;
    hostCount += plan.hosts.length;
    for (const host of plan.hosts) {
      const hostAreaCells = Math.max(0, host.c1 - host.c0) * Math.max(0, host.r1 - host.r0);
      hostArea += hostAreaCells;
      if (host.details.length) {
        detailHostCount += 1;
        detailHostArea += hostAreaCells;
      }
      detailPathCount += host.details.length;
      for (const detail of host.details) {
        const rects = detail.rectsCache ?? detail.rects;
        if (!rects) continue;
        detailRectCount += rects.length;
        for (const rect of rects) {
          const area = getRectArea(rect);
          if (!area) continue;
          detailRectArea += area;
          if ("transparent" in rect && rect.transparent) detailTransparentArea += area;
        }
      }
    }
  }
  const key = [
    renderedPlans.length,
    stats.idealCells,
    stats.paintCells,
    stats.pseudoArea,
    stats.brushNodes,
    stats.svgNodes,
    detailRectCount
  ].join(":");
  if (key === lastReportKey) return;
  lastReportKey = key;

  const report = {
    tag: "VoxCSS PlaneShell report",
    reason: reasons.join("+"),
    planCache: planCacheNote,
    grid: {
      rows: context.rows,
      cols: context.cols,
      depth: context.depth ?? plans.length,
      tileSize: Math.round(context.tileSize ?? 50),
      layerElevation: Math.round(context.layerElevation ?? context.tileSize ?? 50)
    },
    faces: {
      total: renderedPlans.length,
      axis: axisCounts,
      fallback: fallbackPlans
    },
    hosts: {
      total: hostCount,
      detailHosts: detailHostCount,
      detailPaths: detailPathCount,
      detailRects: detailRectCount
    },
    areas: {
      hostCells: Math.round(hostArea),
      detailHostCells: Math.round(detailHostArea),
      detailRectCells: Math.round(detailRectArea),
      detailCoverage: formatRatio(detailHostArea ? detailRectArea / detailHostArea : 0, 3),
      transparentDetailCells: Math.round(detailTransparentArea)
    },
    paint: {
      idealCells: Math.round(stats.idealCells),
      paintCells: Math.round(stats.paintCells),
      pseudoArea: Math.round(stats.pseudoArea),
      paintedCells: Math.round(stats.paintedCells),
      overdrawCells: Math.round(stats.overdrawCells),
      overdrawRatio: formatRatio(stats.overdrawRatio, 3),
      paintScore: formatRatio(stats.paintScore, 3),
      pseudoLayers: stats.pseudoLayers
    },
    axis: formatAxisStats(stats.axis),
    brushes: {
      modes: stats.brushModes,
      pairing: stats.pairing,
      pseudoRects: stats.pseudoRects
    },
    samples: {
      brushArea: formatSampleStats(stats.brushAreaStats),
      pseudoArea: formatSampleStats(stats.pseudoAreaStats),
      svgArea: formatSampleStats(stats.svgAreaStats)
    },
    dom: {
      brushNodes: stats.brushNodes,
      svgNodes: stats.svgNodes,
      svgPaths: stats.svgPaths,
      svgWrapNodes: stats.svgWrapNodes,
      compositeNodes: stats.compositeNodes
    },
    svgFallback: stats.svgFallback
  };
  if (typeof globalThis !== "undefined") {
    (globalThis as { __voxcssLastPlaneShellReport?: unknown }).__voxcssLastPlaneShellReport = report;
  }
  console.log(report);
};
