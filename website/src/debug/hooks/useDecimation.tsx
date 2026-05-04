import { useMemo, useState } from "react";
import type { Polygon } from "@polycss/react";
import { DebugSection } from "../DebugSection";
import { Row, Slider, Pills } from "../controls";
import { decimateClustering, decimateEdgeLength, decimateQEM } from "../decimation";

type Method = "none" | "clustering" | "edge-length" | "qem";

const METHOD_OPTIONS: { value: Method; label: string }[] = [
  { value: "none", label: "none" },
  { value: "clustering", label: "cluster" },
  { value: "edge-length", label: "edge" },
  { value: "qem", label: "QEM" },
];

const METHOD_DESCRIPTIONS: Record<Method, { name: string; body: string }> = {
  none: {
    name: "No decimation",
    body: "Renders the full source mesh as-is. Use as a baseline to compare against the other methods.",
  },
  clustering: {
    name: "Vertex clustering",
    body:
      "Snap every vertex to a grid of size N, then drop triangles whose two snapped endpoints coincide. Cheap and uniform — collapses fine detail and flat regions equally.",
  },
  "edge-length": {
    name: "Shortest-edge collapse",
    body:
      "Iteratively merge the two endpoints of the shortest edge into their midpoint until the target triangle count is reached. Preserves silhouette better than clustering.",
  },
  qem: {
    name: "Quadric edge collapse (QEM)",
    body:
      "Garland-Heckbert: each vertex carries a quadratic error matrix summed from its incident face planes. Best shape preservation at low triangle counts; slowest of the three.",
  },
};

export interface UseDecimationResult {
  voxels: Polygon[];
  method: Method;
  reduction: number;
  panel: React.ReactNode;
}

export function useDecimation(source: Polygon[]): UseDecimationResult {
  const [method, setMethod] = useState<Method>("none");
  const [snap, setSnap] = useState(0);
  const [ratio, setRatio] = useState(1);

  const voxels = useMemo(() => {
    if (method === "clustering") return decimateClustering(source as any, snap) as any as Polygon[];
    if (method === "edge-length") return decimateEdgeLength(source as any, ratio) as any as Polygon[];
    if (method === "qem") return decimateQEM(source as any, ratio) as any as Polygon[];
    return source;
  }, [source, method, snap, ratio]);

  const reduction = source.length === 0
    ? 0
    : Math.round((1 - voxels.length / source.length) * 100);

  const desc = METHOD_DESCRIPTIONS[method];
  const panel = (
    <DebugSection title="Decimation">
      <div className="debug-help">
        Decimation reduces a mesh's triangle count while preserving its silhouette — useful for cutting DOM cost on heavy mesh imports.
      </div>
      <Row label="Method">
        <Pills<Method> value={method} onChange={setMethod} options={METHOD_OPTIONS} />
      </Row>
      <div className="debug-help">
        <div className="debug-help__title">{desc.name}</div>
        <div>{desc.body}</div>
      </div>
      {method === "clustering" && (
        <Row label="Snap">
          <Slider value={snap} onChange={setSnap} min={0} max={8} step={0.25} format={(v) => v.toFixed(2)} />
        </Row>
      )}
      {(method === "edge-length" || method === "qem") && (
        <Row label="Keep">
          <Slider value={ratio} onChange={setRatio} min={0.01} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} />
        </Row>
      )}
    </DebugSection>
  );

  return { voxels, method, reduction, panel };
}
