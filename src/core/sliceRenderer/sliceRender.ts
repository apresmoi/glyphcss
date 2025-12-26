import type { WallsMask } from "../types";
import { DEFAULT_WALLS } from "../types";
import type { Brush, SlicePlan, SliceRendererDomState, SliceRendererSnapshot } from "./slicePlan";
import { STAMP_FACE_Z_OFFSET, formatZOffset, setCssVarIfDiff, setStyleIfDiff } from "./sliceCore";

type SliceRenderStats = {
  paintCells: number;
  paintCost: number;
  brushNodes: number;
  brushBase: number;
  brushStamp: number;
  brushCombo: number;
  brushGradient: number;
  brushSvg: number;
  pseudoLayers: number;
  pseudoArea: number;
  svgNodes: number;
  svgPaths: number;
  compositeNodes: number;
};

const normalizePaintColor = (value?: string): string | null => {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "transparent") return null;
  const rgbaMatch = raw.match(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([\d.]+)\s*\)$/i);
  if (rgbaMatch) {
    const alpha = Number(rgbaMatch[1]);
    if (Number.isFinite(alpha) && alpha <= 0) return null;
  }
  return raw;
};

const applyBrush = (
  brush: HTMLElement,
  gridArea: string,
  backgroundColor: string,
  zOffset: string
): void => {
  const state = brush as { __voxcssNewBrushState?: { className?: string; gridArea?: string; backgroundColor?: string } };
  const brushState = state.__voxcssNewBrushState ?? (state.__voxcssNewBrushState = {});
  const className = "voxcss-plane-brush";
  if (brushState.className !== className) {
    brush.className = className;
    brushState.className = className;
  }
  if (brushState.gridArea !== gridArea) {
    brush.style.gridArea = gridArea;
    brushState.gridArea = gridArea;
  }
  if (brushState.backgroundColor !== backgroundColor) {
    brush.style.backgroundColor = backgroundColor;
    brushState.backgroundColor = backgroundColor;
  }
  setCssVarIfDiff(brush, "--vox-z", zOffset);
  setStyleIfDiff(brush, "position", "relative");
  setStyleIfDiff(brush, "overflow", "visible");
  setStyleIfDiff(brush, "backgroundImage", "");
  setStyleIfDiff(brush, "backgroundRepeat", "");
  setStyleIfDiff(brush, "backgroundSize", "");
  setStyleIfDiff(brush, "backgroundPosition", "");
  setStyleIfDiff(brush, "left", "");
  setStyleIfDiff(brush, "top", "");
  setStyleIfDiff(brush, "width", "");
  setStyleIfDiff(brush, "height", "");
};

export const renderSlicePlans = (
  hosts: SliceRendererDomState,
  snapshot: SliceRendererSnapshot,
  documentRef: Document,
  plans: SlicePlan[]
): SliceRenderStats => {
  const context = snapshot.context;
  const tileSize = context.tileSize ?? 50;
  const layerElevation = context.layerElevation ?? tileSize;
  const walls: WallsMask = context.walls ?? DEFAULT_WALLS;

  let totalPaintCells = 0;
  let totalBrushNodes = 0;
  let totalBrushBase = 0;

  const axisState = {
    z: { host: hosts.zHost, pool: hosts.zPool, index: 0 },
    x: { host: hosts.xHost, pool: hosts.xPool, index: 0 },
    y: { host: hosts.yHost, pool: hosts.yPool, index: 0 }
  } as const;

  const nextBrush = (axis: "x" | "y" | "z"): HTMLElement => {
    const bucket = axisState[axis];
    const i = bucket.index++;
    let el = bucket.pool[i] as HTMLElement | undefined;
    if (!el || el.tagName.toLowerCase() !== "b") {
      if (el) el.remove();
      el = documentRef.createElement("b");
      bucket.pool[i] = el;
      bucket.host.appendChild(el);
    } else if (el.parentElement !== bucket.host) {
      bucket.host.appendChild(el);
    }
    if (el.style.display === "none") el.style.display = "";
    return el;
  };

  const getPlaneOffset = (axis: "x" | "y" | "z", plane: number): number =>
    axis === "z"
      ? plane * layerElevation
      : -1 * (plane - 1) * tileSize;

  const gridAreaFor = (row0: number, col0: number, row1: number, col1: number): string =>
    `${row0} / ${col0} / ${row1} / ${col1}`;

  for (const plan of plans) {
    const { axis, plane, face } = plan.key;
    if (walls[face]) continue;
    const planeOffset = getPlaneOffset(axis, plane);
    const stampOffset = STAMP_FACE_Z_OFFSET[face] ?? 0.12;
    const brushZ = formatZOffset(planeOffset + stampOffset);
    const originRow = plan.buffer.minRow;
    const originCol = plan.buffer.minCol;
    let planPaintedCells = 0;

    for (const brush of plan.brushes) {
      if (brush.kind !== "BASE") continue;
      const color = normalizePaintColor(brush.baseColor);
      if (!color) continue;
      const gridArea = gridAreaFor(
        originRow + brush.r0,
        originCol + brush.c0,
        originRow + brush.r1,
        originCol + brush.c1
      );
      const el = nextBrush(axis);
      applyBrush(el, gridArea, color, brushZ);
      totalBrushNodes += 1;
      totalBrushBase += 1;
      planPaintedCells += (brush.r1 - brush.r0) * (brush.c1 - brush.c0);
    }

    totalPaintCells += planPaintedCells;
  }

  for (const axis of Object.keys(axisState) as Array<keyof typeof axisState>) {
    const bucket = axisState[axis];
    for (let i = bucket.index; i < bucket.pool.length; i += 1) bucket.pool[i]?.remove();
  }

  const paintCost = totalPaintCells;
  return {
    paintCells: totalPaintCells,
    paintCost,
    brushNodes: totalBrushNodes,
    brushBase: totalBrushBase,
    brushStamp: 0,
    brushCombo: 0,
    brushGradient: 0,
    brushSvg: 0,
    pseudoLayers: 0,
    pseudoArea: 0,
    svgNodes: 0,
    svgPaths: 0,
    compositeNodes: totalBrushNodes
  };
};
