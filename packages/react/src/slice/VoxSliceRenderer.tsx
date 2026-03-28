import { useMemo, useRef, useLayoutEffect, useEffect } from "react";
import type { Voxel, GridContext, WallsMask } from "@layoutit/voxcss-core";
import {
  type PlaneAxis,
  type FaceData,
  type SlicePlan,
  buildSlicePlan,
  buildFaceDataFromSnapshot,
  NEXT_LAYER_STEP,
} from "@layoutit/voxcss-core";

export interface VoxSliceRendererProps {
  layers: Voxel[][];
  context: GridContext;
  dimensions: { rows: number; cols: number; depth: number };
}

export interface SliceBrushData {
  plans: SlicePlan[];
}

const BRUSH_CLASS = "voxcss-brush";

function applyBrush(
  el: HTMLElement,
  gridArea: string,
  backgroundColor: string,
  zOffset: string
): void {
  const state = ((el as any).__voxBrush ??= {} as Record<string, string>);
  if (state.className !== BRUSH_CLASS) {
    el.className = BRUSH_CLASS;
    state.className = BRUSH_CLASS;
  }
  if (state.gridArea !== gridArea) {
    el.style.gridArea = gridArea;
    state.gridArea = gridArea;
  }
  if (state.backgroundColor !== backgroundColor) {
    el.style.backgroundColor = backgroundColor;
    state.backgroundColor = backgroundColor;
  }
  if (state.zOffset !== zOffset) {
    el.style.setProperty("--vox-z", zOffset);
    state.zOffset = zOffset;
  }
}

function renderBrushesToHost(
  host: HTMLElement,
  pool: HTMLElement[],
  plans: SlicePlan[],
  walls: WallsMask,
  tileSize: number,
  layerElevation: number,
  axes: Set<PlaneAxis>,
): number {
  const doc = host.ownerDocument;
  let poolIndex = 0;

  for (const plan of plans) {
    const { axis, plane, face } = plan.key;
    if (!axes.has(axis)) continue;
    if (walls[face]) continue;

    const planeOffset = axis === "z"
      ? plane * layerElevation
      : -1 * (plane - 1) * tileSize;
    const brushZ = `${planeOffset}px`;
    const originRow = plan.buffer.minRow;
    const originCol = plan.buffer.minCol;

    for (const brush of plan.brushes) {
      const gridArea = `${originRow + brush.r0} / ${originCol + brush.c0} / ${originRow + brush.r1} / ${originCol + brush.c1}`;
      let el = pool[poolIndex];
      if (!el) {
        el = doc.createElement("b");
        pool[poolIndex] = el;
      }
      if (el.parentElement !== host) {
        host.appendChild(el);
      }
      applyBrush(el, gridArea, brush.baseColor, brushZ);
      poolIndex++;
    }
  }

  // Remove excess from DOM (keep in pool)
  for (let i = poolIndex; i < pool.length; i++) {
    pool[i]?.remove();
  }

  return poolIndex;
}

export function useSliceBrushes(
  layers: Voxel[][],
  context: GridContext,
): SliceBrushData {
  const tileSize = context.tileSize ?? 50;
  const layerElevation = context.layerElevation ?? tileSize;

  const plans = useMemo(() => {
    const faces = buildFaceDataFromSnapshot({ layers, context });
    const faceIndex = new Map<string, FaceData>();
    for (const face of faces) {
      faceIndex.set(`${face.key.axis}:${face.key.plane}:${face.key.face}`, face);
    }
    const result: SlicePlan[] = [];
    for (const face of faces) {
      const nextPlane = face.key.plane + NEXT_LAYER_STEP[face.key.face];
      const nextKey = `${face.key.axis}:${nextPlane}:${face.key.face}`;
      const nextFace = faceIndex.get(nextKey);
      const nextBuffer = nextFace?.buffer ?? null;
      result.push(buildSlicePlan(face, nextBuffer));
    }
    return result;
  }, [layers, context, tileSize, layerElevation]);

  return { plans };
}

const Z_SET = new Set<PlaneAxis>(["z"]);
const X_SET = new Set<PlaneAxis>(["x"]);
const Y_SET = new Set<PlaneAxis>(["y"]);

import type { SceneStore } from "../store/sceneStore";

/**
 * Imperatively renders brushes into a host element.
 * Subscribes directly to the scene store for wall mask changes —
 * bypasses React reconciliation entirely for face visibility toggling.
 */
export function useImperativeBrushRenderer(
  plans: SlicePlan[],
  store: SceneStore,
  tileSize: number,
  layerElevation: number,
  axisSet: Set<PlaneAxis>,
  hostRef: React.RefObject<HTMLElement | null>,
) {
  const poolRef = useRef<HTMLElement[]>([]);
  const plansRef = useRef(plans);
  plansRef.current = plans;

  // Initial render + plan changes
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const walls = store.getState().wallMask;
    renderBrushesToHost(host, poolRef.current, plans, walls, tileSize, layerElevation, axisSet);
  }, [plans, tileSize, layerElevation, axisSet, hostRef, store]);

  // Subscribe to store for wall mask changes — direct DOM, no React
  useEffect(() => {
    return store.subscribe(() => {
      const host = hostRef.current;
      if (!host) return;
      const walls = store.getState().wallMask;
      renderBrushesToHost(host, poolRef.current, plansRef.current, walls, tileSize, layerElevation, axisSet);
    });
  }, [store, tileSize, layerElevation, axisSet, hostRef]);
}

/**
 * Z-axis brushes — renders directly into the floor div via ref.
 * Does NOT create a wrapper div.
 */
export function SliceZBrushes({ floorRef, plans, store, tileSize, layerElevation }: {
  floorRef: React.RefObject<HTMLElement | null>;
  plans: SlicePlan[];
  store: SceneStore;
  tileSize: number;
  layerElevation: number;
}) {
  useImperativeBrushRenderer(plans, store, tileSize, layerElevation, Z_SET, floorRef);
  return null; // No React elements — brushes managed imperatively
}

/**
 * Axis host for x/y brushes. React owns the wrapper div, brushes are imperative.
 */
export function SliceAxisHost({ className, style, plans, store, tileSize, layerElevation, axes }: {
  className: string;
  style: React.CSSProperties;
  plans: SlicePlan[];
  store: SceneStore;
  tileSize: number;
  layerElevation: number;
  axes: Set<PlaneAxis>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  useImperativeBrushRenderer(plans, store, tileSize, layerElevation, axes, hostRef);

  if (plans.length === 0) return null;
  return <div ref={hostRef} className={className} style={style} />;
}
