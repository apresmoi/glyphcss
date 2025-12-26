import type { GridContext, WallsMask } from "../types";
import { DEFAULT_WALLS } from "../types";
import type { Brush, SlicePlan, SliceRendererDomState, SliceRendererSnapshot } from "./types";
import {
  SVG_NS,
  STAMP_FACE_Z_OFFSET,
  clearCssVar,
  clearPlaneDetailVars,
  formatZOffset,
  setAttrIfDiff,
  setCssVarIfDiff,
  setStyleIfDiff
} from "../shellRenderer/types";
import { buildBrushPairing, type AbsorbPlan, type BrushPairing, type PackedBrush } from "../shellRenderer/render";

type BrushRect = { x: number; y: number; w: number; h: number; color: string; area: number; id: number };

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

const sliceToggle = (key: string, fallback: boolean): boolean => {
  if (typeof globalThis === "undefined") return fallback;
  const value = (globalThis as Record<string, unknown>)[key];
  if (value === true) return true;
  if (value === false) return false;
  return fallback;
};

const SLICE_ENABLE_PSEUDOS = sliceToggle("__voxcssSliceEnablePseudos", false);

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

const buildGradientCss = (brush: Brush): string | null => {
  const axis = brush.gradientAxis;
  const stops = brush.gradientStops;
  if (!axis || !stops?.length) return null;
  const size = axis === "y" ? brush.r1 - brush.r0 : brush.c1 - brush.c0;
  if (size <= 0) return null;
  const formatPos = (value: number): string => `${((value / size) * 100).toFixed(3)}%`;
  const parts = stops.map((stop) => `${stop.color} ${formatPos(stop.start)} ${formatPos(stop.end)}`);
  const direction = axis === "y" ? "to bottom" : "to right";
  return `linear-gradient(${direction}, ${parts.join(", ")})`;
};

const applyGradientBrush = (
  target: HTMLElement,
  brush: Brush,
  gridArea: string,
  zOffset: string
): void => {
  const baseColor = brush.baseColor ?? "";
  clearPlaneDetailVars(target);
  applyBrush(target, gridArea, baseColor, zOffset);
  setStyleIfDiff(target, "transform", "");
  const gradientCss = buildGradientCss(brush);
  if (gradientCss) {
    setStyleIfDiff(target, "backgroundImage", gradientCss);
    setStyleIfDiff(target, "backgroundRepeat", "no-repeat");
    setStyleIfDiff(target, "backgroundSize", "100% 100%");
    setStyleIfDiff(target, "backgroundPosition", "0 0");
  }
};

const paintRectToBrushRect = (rect: { r0: number; c0: number; r1: number; c1: number; color: string }): BrushRect => ({
  x: rect.c0,
  y: rect.r0,
  w: rect.c1 - rect.c0,
  h: rect.r1 - rect.r0,
  color: rect.color,
  area: Math.max(0, rect.c1 - rect.c0) * Math.max(0, rect.r1 - rect.r0),
  id: -1
});

const getBrushPaintedCells = (brush: PackedBrush): number => {
  const baseColor = normalizePaintColor(brush.baseColor);
  const baseW = brush.c1 - brush.c0;
  const baseH = brush.r1 - brush.r0;
  const baseArea = baseColor && baseW > 0 && baseH > 0 ? baseW * baseH : 0;
  if (baseArea) return baseArea;
  const before = brush.before && normalizePaintColor(brush.before.color) ? brush.before : null;
  const after = brush.after && normalizePaintColor(brush.after.color) ? brush.after : null;
  const beforeArea = before && before.w > 0 && before.h > 0 ? before.w * before.h : 0;
  const afterArea = after && after.w > 0 && after.h > 0 ? after.w * after.h : 0;
  if (!beforeArea) return afterArea;
  if (!afterArea) return beforeArea;
  const ix0 = Math.max(before.x, after.x);
  const iy0 = Math.max(before.y, after.y);
  const ix1 = Math.min(before.x + before.w, after.x + after.w);
  const iy1 = Math.min(before.y + before.h, after.y + after.h);
  const overlap = ix1 > ix0 && iy1 > iy0 ? (ix1 - ix0) * (iy1 - iy0) : 0;
  return beforeArea + afterArea - overlap;
};

const getGradientPaintedCells = (brush: Brush): number => {
  const width = brush.c1 - brush.c0;
  const height = brush.r1 - brush.r0;
  return width > 0 && height > 0 ? width * height : 0;
};

const toPackedBrushes = (brushes: Brush[]): { packed: PackedBrush[]; svg: Brush[]; gradient: Brush[] } => {
  const packed: PackedBrush[] = [];
  const svg: Brush[] = [];
  const gradient: Brush[] = [];
  let rectId = 0;
  for (const brush of brushes) {
    if (brush.kind === "SVG") {
      svg.push(brush);
      continue;
    }
    if (brush.kind === "GRADIENT") {
      gradient.push(brush);
      continue;
    }
    const before = brush.before
      ? { x: brush.before.x, y: brush.before.y, w: brush.before.w, h: brush.before.h, color: brush.before.color, area: brush.before.w * brush.before.h, id: rectId++ }
      : undefined;
    const after = brush.after
      ? { x: brush.after.x, y: brush.after.y, w: brush.after.w, h: brush.after.h, color: brush.after.color, area: brush.after.w * brush.after.h, id: rectId++ }
      : undefined;
    packed.push({
      mode: brush.kind,
      r0: brush.r0,
      c0: brush.c0,
      r1: brush.r1,
      c1: brush.c1,
      baseColor: brush.baseColor ?? "",
      before,
      after
    });
  }
  return { packed, svg, gradient };
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
  let totalBrushStamp = 0;
  let totalBrushCombo = 0;
  let totalBrushGradient = 0;
  let totalBrushSvg = 0;
  let totalPseudoLayers = 0;
  let totalPseudoArea = 0;
  let totalSvgNodes = 0;
  let totalSvgPaths = 0;

  const axisState = {
    z: { host: hosts.zHost, pool: hosts.zPool, index: 0 },
    x: { host: hosts.xHost, pool: hosts.xPool, index: 0 },
    y: { host: hosts.yHost, pool: hosts.yPool, index: 0 }
  } as const;

  const nextElement = (axis: "x" | "y" | "z", tag: "b" | "svg" | "div"): Element => {
    const bucket = axisState[axis];
    const i = bucket.index++;
    let el = bucket.pool[i];
    const wantsSvg = tag === "svg";
    const wantsDiv = tag === "div";
    if (el) {
      const tagName = el.tagName.toLowerCase();
      if ((wantsSvg && tagName !== "svg") || (wantsDiv && tagName !== "div") || (!wantsSvg && !wantsDiv && tagName !== "b")) {
        el.remove();
        el = undefined;
      }
    }
    if (!el) {
      el = wantsSvg
        ? documentRef.createElementNS(SVG_NS, "svg")
        : wantsDiv
          ? documentRef.createElement("div")
          : documentRef.createElement("b");
      bucket.pool[i] = el;
      bucket.host.appendChild(el);
    } else if (el.parentElement !== bucket.host) {
      bucket.host.appendChild(el);
    }
    if (typeof HTMLElement !== "undefined" && el instanceof HTMLElement && el.style.display === "none") el.style.display = "";
    return el;
  };

  const nextBrush = (axis: "x" | "y" | "z"): HTMLElement => nextElement(axis, "b") as HTMLElement;
  const nextSvgWrap = (axis: "x" | "y" | "z"): HTMLElement => nextElement(axis, "div") as HTMLElement;

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
    const cellWidthPx = axis === "y" ? layerElevation : tileSize;
    const cellHeightPx = axis === "x" ? layerElevation : tileSize;
    const originRow = plan.buffer.minRow;
    const originCol = plan.buffer.minCol;
    const { packed, svg, gradient } = toPackedBrushes(plan.brushes);
    const pairing: BrushPairing = buildBrushPairing(packed);
    const paintedCells = packed.map(getBrushPaintedCells);

    const countPseudoLayers = (brush: PackedBrush, absorbPlans?: AbsorbPlan[]): number => {
      if (!SLICE_ENABLE_PSEUDOS) return 0;
      let hasBefore = !!brush.before;
      let hasAfter = !!brush.after;
      if (absorbPlans) {
        for (const absorb of absorbPlans) {
          if (absorb.slot === "before") hasBefore = true;
          else if (absorb.slot === "after") hasAfter = true;
        }
      }
      return (hasBefore ? 1 : 0) + (hasAfter ? 1 : 0);
    };

    const getPseudoArea = (brush: PackedBrush, absorbPlans?: AbsorbPlan[]): number => {
      if (!SLICE_ENABLE_PSEUDOS) return 0;
      let beforeRect = brush.before;
      let afterRect = brush.after;
      if (absorbPlans) {
        for (const absorb of absorbPlans) {
          if (absorb.slot === "before") beforeRect = paintRectToBrushRect(absorb.rect);
          else if (absorb.slot === "after") afterRect = paintRectToBrushRect(absorb.rect);
        }
      }
      let area = 0;
      if (beforeRect && normalizePaintColor(beforeRect.color)) {
        area += Math.max(0, beforeRect.w) * Math.max(0, beforeRect.h);
      }
      if (afterRect && normalizePaintColor(afterRect.color)) {
        area += Math.max(0, afterRect.w) * Math.max(0, afterRect.h);
      }
      return area;
    };

    const applyPseudoRect = (
      target: HTMLElement,
      contentVar: "before" | "after",
      rect: BrushRect,
      bbox: PackedBrush
    ): void => {
      const prefix = contentVar === "before" ? "--vox-b" : "--vox-a";
      const leftPx = (rect.x - bbox.c0) * cellWidthPx;
      const topPx = (rect.y - bbox.r0) * cellHeightPx;
      const widthPx = rect.w * cellWidthPx;
      const heightPx = rect.h * cellHeightPx;
      setCssVarIfDiff(target, `${prefix}c`, "''");
      setCssVarIfDiff(target, `${prefix}l`, `${leftPx}px`);
      setCssVarIfDiff(target, `${prefix}t`, `${topPx}px`);
      setCssVarIfDiff(target, `${prefix}w`, `${widthPx}px`);
      setCssVarIfDiff(target, `${prefix}h`, `${heightPx}px`);
      setCssVarIfDiff(target, `${prefix}col`, rect.color);
      setCssVarIfDiff(target, "--vox-z", brushZ);
    };

    const disablePseudo = (target: HTMLElement, contentVar: "before" | "after"): void => {
      const varName = contentVar === "before" ? "--vox-bc" : "--vox-ac";
      setCssVarIfDiff(target, varName, "none");
    };

    const resolvePseudoRects = (brush: PackedBrush, absorbPlans?: AbsorbPlan[]): { before?: BrushRect; after?: BrushRect } => {
      let beforeRect = brush.before;
      let afterRect = brush.after;
      if (absorbPlans) {
        for (const absorb of absorbPlans) {
          if (absorb.slot === "before") beforeRect = paintRectToBrushRect(absorb.rect);
          else if (absorb.slot === "after") afterRect = paintRectToBrushRect(absorb.rect);
        }
      }
      if (beforeRect && afterRect) {
        const beforeArea = beforeRect.w * beforeRect.h;
        const afterArea = afterRect.w * afterRect.h;
        if (beforeArea <= afterArea) {
          const swap = afterRect;
          afterRect = beforeRect;
          beforeRect = swap;
        }
      }
      if (!afterRect && beforeRect) {
        afterRect = beforeRect;
        beforeRect = undefined;
      }
      return { before: beforeRect, after: afterRect };
    };

    const renderDetailBrush = (rect: BrushRect): void => {
      const color = normalizePaintColor(rect.color);
      if (!color || rect.w <= 0 || rect.h <= 0) return;
      const gridArea = gridAreaFor(
        originRow + rect.y,
        originCol + rect.x,
        originRow + rect.y + rect.h,
        originCol + rect.x + rect.w
      );
      const brush = nextBrush(axis);
      applyBrush(brush, gridArea, color, brushZ);
      totalBrushNodes += 1;
      totalBrushBase += 1;
      planPaintedCells += rect.w * rect.h;
    };

    const applyBrushWithPlacement = (
      target: HTMLElement,
      brush: PackedBrush,
      gridArea: string,
      absorbPlans?: AbsorbPlan[]
    ): void => {
      const pseudoRects = SLICE_ENABLE_PSEUDOS ? resolvePseudoRects(brush, absorbPlans) : { before: undefined, after: undefined };
      clearPlaneDetailVars(target);
      applyBrush(target, gridArea, brush.baseColor, brushZ);
      setStyleIfDiff(target, "transform", "");
      if (pseudoRects.before) applyPseudoRect(target, "before", pseudoRects.before, brush);
      else disablePseudo(target, "before");
      if (pseudoRects.after) applyPseudoRect(target, "after", pseudoRects.after, brush);
      else disablePseudo(target, "after");
    };

    let planPaintedCells = 0;
    const brushOrder: number[] = [];
    for (let i = 0; i < packed.length; i += 1) {
      if (pairing.children.has(i)) continue;
      brushOrder.push(i);
    }
    brushOrder.sort((a, b) => {
      const areaA = paintedCells[a] ?? 0;
      const areaB = paintedCells[b] ?? 0;
      if (areaA !== areaB) return areaB - areaA;
      return a - b;
    });

    for (const i of brushOrder) {
      const packedBrush = packed[i];
      if (!packedBrush) continue;
      const gridArea = gridAreaFor(
        originRow + packedBrush.r0,
        originCol + packedBrush.c0,
        originRow + packedBrush.r1,
        originCol + packedBrush.c1
      );
      const brushPaintedCells = paintedCells[i] ?? getBrushPaintedCells(packedBrush);
      if (brushPaintedCells <= 0) continue;
      const brush = nextBrush(axis);
      const absorbPlans = pairing.absorbed.get(i);
      const resolvedPseudos = SLICE_ENABLE_PSEUDOS ? null : resolvePseudoRects(packedBrush, absorbPlans);
      applyBrushWithPlacement(brush, packedBrush, gridArea, absorbPlans);
      totalBrushNodes += 1;
      const brushPseudoLayers = countPseudoLayers(packedBrush, absorbPlans);
      if (packedBrush.mode === "BASE") totalBrushBase += 1;
      else if (packedBrush.mode === "STAMP") totalBrushStamp += 1;
      else if (packedBrush.mode === "COMBO") totalBrushCombo += 1;
      totalPseudoLayers += brushPseudoLayers;
      totalPseudoArea += getPseudoArea(packedBrush, absorbPlans);
      planPaintedCells += brushPaintedCells;
      if (!SLICE_ENABLE_PSEUDOS && resolvedPseudos) {
        if (resolvedPseudos.before) renderDetailBrush(resolvedPseudos.before);
        if (resolvedPseudos.after) renderDetailBrush(resolvedPseudos.after);
      }
    }

    for (const gradientBrush of gradient) {
      const gridArea = gridAreaFor(
        originRow + gradientBrush.r0,
        originCol + gradientBrush.c0,
        originRow + gradientBrush.r1,
        originCol + gradientBrush.c1
      );
      const brushPaintedCells = getGradientPaintedCells(gradientBrush);
      if (brushPaintedCells <= 0) continue;
      const brush = nextBrush(axis);
      applyGradientBrush(brush, gradientBrush, gridArea, brushZ);
      totalBrushNodes += 1;
      totalBrushGradient += 1;
      planPaintedCells += brushPaintedCells;
    }

    for (const svgBrush of svg) {
      if (!svgBrush.svgPaths?.length) continue;
      const gridArea = gridAreaFor(
        originRow + svgBrush.r0,
        originCol + svgBrush.c0,
        originRow + svgBrush.r1,
        originCol + svgBrush.c1
      );
      const wrap = nextSvgWrap(axis);
      const wrapState = wrap as { __voxcssSliceSvg?: SVGSVGElement };
      wrap.className = "voxcss-plane-brush";
      setStyleIfDiff(wrap, "position", "relative");
      setStyleIfDiff(wrap, "width", "100%");
      setStyleIfDiff(wrap, "height", "100%");
      setStyleIfDiff(wrap, "display", "block");
      setStyleIfDiff(wrap, "pointerEvents", "none");
      setStyleIfDiff(wrap, "gridArea", gridArea);
      setStyleIfDiff(wrap, "transform", `translateZ(${brushZ})`);
      let svgNode = wrapState.__voxcssSliceSvg;
      if (!svgNode) {
        svgNode = documentRef.createElementNS(SVG_NS, "svg");
        wrapState.__voxcssSliceSvg = svgNode;
      }
      if (svgNode.parentElement !== wrap) {
        wrap.appendChild(svgNode);
      }
      svgNode.setAttribute("preserveAspectRatio", "none");
      setAttrIfDiff(svgNode, "shape-rendering", "geometricPrecision");
      svgNode.setAttribute("aria-hidden", "true");
      svgNode.setAttribute("focusable", "false");
      setStyleIfDiff(svgNode, "position", "relative");
      setStyleIfDiff(svgNode, "width", "100%");
      setStyleIfDiff(svgNode, "height", "100%");
      setStyleIfDiff(svgNode, "display", "block");
      setStyleIfDiff(svgNode, "pointerEvents", "none");
      const viewBox = svgBrush.svgViewBox ?? `0 0 ${svgBrush.c1 - svgBrush.c0} ${svgBrush.r1 - svgBrush.r0}`;
      setAttrIfDiff(svgNode, "viewBox", viewBox);
      svgNode.innerHTML = "";
      for (const pathDef of svgBrush.svgPaths) {
        const path = documentRef.createElementNS(SVG_NS, "path");
        setAttrIfDiff(path, "d", pathDef.path);
        setAttrIfDiff(path, "fill", pathDef.color);
        svgNode.appendChild(path);
        totalSvgPaths += 1;
      }
      totalSvgNodes += 1;
      totalBrushNodes += 1;
      totalBrushSvg += 1;
      planPaintedCells += (svgBrush.r1 - svgBrush.r0) * (svgBrush.c1 - svgBrush.c0);
    }

    totalPaintCells += planPaintedCells;
  }

  for (const axis of Object.keys(axisState) as Array<keyof typeof axisState>) {
    const bucket = axisState[axis];
    for (let i = bucket.index; i < bucket.pool.length; i += 1) bucket.pool[i]?.remove();
  }

  const paintCost = totalPaintCells + totalPseudoArea;
  return {
    paintCells: totalPaintCells,
    paintCost,
    brushNodes: totalBrushNodes,
    brushBase: totalBrushBase,
    brushStamp: totalBrushStamp,
    brushCombo: totalBrushCombo,
    brushGradient: totalBrushGradient,
    brushSvg: totalBrushSvg,
    pseudoLayers: totalPseudoLayers,
    pseudoArea: totalPseudoArea,
    svgNodes: totalSvgNodes,
    svgPaths: totalSvgPaths,
    compositeNodes: totalBrushNodes + totalSvgNodes
  };
};
