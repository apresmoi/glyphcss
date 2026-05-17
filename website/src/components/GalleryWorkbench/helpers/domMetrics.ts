import type { DomMetrics } from "../../types";

export const EMPTY_METRICS: DomMetrics = {
  measuredAt: 0,
  nodeCount: 0,
  sprites: 0,
  rects: 0,
  triangles: 0,
  irregular: 0,
};

export function measureDom(root: HTMLElement | null): DomMetrics {
  if (!root) return EMPTY_METRICS;
  const modelScopes = Array.from(root.querySelectorAll<HTMLElement>(".dn-model-mesh"));
  if (modelScopes.length === 0) return EMPTY_METRICS;
  const scopes = modelScopes;
  const countInScopes = (selector: string): number =>
    scopes.reduce((sum, scope) => sum + scope.querySelectorAll(selector).length, 0);
  const nodeCount = scopes.reduce((sum, scope) => sum + 1 + scope.querySelectorAll("*").length, 0);

  return {
    measuredAt: performance.now(),
    nodeCount,
    sprites: countInScopes("s"),
    rects: countInScopes("b"),
    triangles: countInScopes("u"),
    irregular: countInScopes("i"),
  };
}

export function domMetricCountsEqual(a: DomMetrics, b: DomMetrics): boolean {
  return (
    a.nodeCount === b.nodeCount &&
    a.sprites === b.sprites &&
    a.rects === b.rects &&
    a.triangles === b.triangles &&
    a.irregular === b.irregular
  );
}
