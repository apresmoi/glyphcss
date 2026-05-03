import type { GridContext, WallsMask, Voxel } from "@layoutit/voxcss-core";
import type { LayerRecord, RenderState, ShapeRenderer } from "../types";
import {
  LAYER_CLASS,
  FLOOR_CLASS,
  WALL_CLASS,
  CEILING_CLASS,
  DEFAULT_WALL_COLOR,
  DEFAULT_WALLS,
  getVoxelBounds,
  wallMasksEqual,
  computeVisibleFaces,
  shadeWallFace,
  shadeColor
} from "@layoutit/voxcss-core";
import { cubeShapeRenderer, ensureCubeDomCache, disposeCubeDom } from "../shapes";
import { rampShapeRenderer } from "../shapes/ramp";
import { wedgeShapeRenderer } from "../shapes/wedge";
import { spikeShapeRenderer } from "../shapes/spike";
import { triangleShapeRenderer } from "../shapes/triangle";
import { clearSliceRenderer, updateSliceRendererGeometry, type SliceRendererDomState } from "./sliceRenderer";

interface DomRendererState {
  renderState: RenderState;
  prevStructure: StructureSnapshot | null;
  sliceRenderer: SliceRendererDomState | null;
}

const rendererStates = new WeakMap<HTMLElement, DomRendererState>();

const DIMETRIC_PROJECTION_CLASS = "voxcss-projection--dimetric";

const FLOOR_GRID_ALPHA = 0.12;
const CEILING_GRID_ALPHA = 0.15;
const WALL_GRID_ALPHA = 0.1;
const GRID_DISABLE_THRESHOLD = 20;

const GRID_SPRITE_CACHE = new Map<string, string>();

const formatSvgNumber = (value: number): string => {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(Math.trunc(rounded)) : String(rounded);
};

const buildGridSvg = (width: number, height: number, alpha: number): string => {
  const w = formatSvgNumber(width);
  const h = formatSvgNumber(height);
  const a = formatSvgNumber(alpha);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges"><rect x="0" y="0" width="1" height="${h}" fill="rgb(0, 0, 0)" fill-opacity="${a}"/><rect x="0" y="0" width="${w}" height="1" fill="rgb(0, 0, 0)" fill-opacity="${a}"/></svg>`;
};

const getGridSpriteUrl = (documentRef: Document, width: number, height: number, alpha: number): string | null => {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const normalizedWidth = Math.round(width * 1000) / 1000;
  const normalizedHeight = Math.round(height * 1000) / 1000;
  const clampedAlpha = Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : 0;
  const normalizedAlpha = Math.round(clampedAlpha * 1000) / 1000;
  const key = `${formatSvgNumber(normalizedWidth)}x${formatSvgNumber(normalizedHeight)}:${formatSvgNumber(normalizedAlpha)}`;
  const cached = GRID_SPRITE_CACHE.get(key);
  if (cached) return cached;
  const svg = buildGridSvg(normalizedWidth, normalizedHeight, normalizedAlpha);
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const urlCtor = documentRef.defaultView?.URL ?? URL;
  const url = urlCtor.createObjectURL(blob);
  GRID_SPRITE_CACHE.set(key, url);
  return url;
};

const readCssPxValue = (documentRef: Document, element: HTMLElement, name: string, fallback: number): number => {
  const view = documentRef.defaultView;
  if (!view) return fallback;
  const raw = view.getComputedStyle(element).getPropertyValue(name);
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export interface RendererMountOptions { documentRef: Document; target: HTMLElement; }

export interface RendererHandle {
  render(snapshot: SceneSnapshot): void;
  updateStructure?(context: GridContext, depthLayers: number): void;
  destroy(): void;
}

export interface SceneSnapshot { layers: Voxel[][]; context: GridContext; renderer?: RendererMetadata; }

export type RendererFactory = (options: RendererMountOptions) => RendererHandle;

export type SceneRenderMode = "cubes" | "slice-renderer";

export interface RendererMetadata { mode: SceneRenderMode; }

export const createDomRenderer: RendererFactory = (options: RendererMountOptions): RendererHandle => {
  const { documentRef, target } = options;
  // "triangle" and "polygon" share the same renderer — triangle is just the
  // strict 3-vertex case, polygon accepts any N >= 3.
  const shapes = {
    cube: cubeShapeRenderer,
    ramp: rampShapeRenderer,
    wedge: wedgeShapeRenderer,
    spike: spikeShapeRenderer,
    triangle: triangleShapeRenderer,
    polygon: triangleShapeRenderer,
  };
  const state = ensureDomRendererState(documentRef, target);

  return {
    render: (snapshot: SceneSnapshot) => renderScene(state, snapshot, documentRef, target, shapes),
    updateStructure: (context: GridContext, depthLayers: number) => updateSceneStructure(state, documentRef, context, depthLayers),
    destroy: () => {
      const renderState = state.renderState;
      resetLayers(renderState);
      clearSliceRenderer(state.sliceRenderer);
      state.sliceRenderer = null;
      clearWalls(renderState);
      renderState.ceiling?.remove(); renderState.ceiling = null; renderState.floor.remove(); rendererStates.delete(target);
    }
  };
};

function ensureDomRendererState(documentRef: Document, root: HTMLElement): DomRendererState {
  const existing = rendererStates.get(root);
  if (existing) return existing;
  root.innerHTML = "";
  const floor = documentRef.createElement("div"); floor.className = FLOOR_CLASS; root.appendChild(floor);
  const renderState: RenderState = { root, floor, layers: new Map(), wallElements: new Map(), ceiling: null };
  const composed: DomRendererState = { renderState, prevStructure: null, sliceRenderer: null };
  return rendererStates.set(root, composed), composed;
}

function renderScene(
  state: DomRendererState,
  snapshot: SceneSnapshot,
  documentRef: Document,
  root: HTMLElement,
  shapes: Record<string, ShapeRenderer>
): void {
  const renderState = state.renderState;
  const layers = snapshot.layers;
  const context = snapshot.context;
  const renderMode: SceneRenderMode = snapshot.renderer?.mode ?? "cubes";
  const nextStructure = { rows: Math.max(context.rows, 1), cols: Math.max(context.cols, 1), depthLayers: Math.max(layers.length, 0), projection: context.projection, walls: context.walls ?? DEFAULT_WALLS, showWalls: !!context.showWalls, showFloor: !!context.showFloor, renderMode };
  const prev = state.prevStructure;
  const structureChanged = !prev || prev.rows !== nextStructure.rows || prev.cols !== nextStructure.cols || prev.depthLayers !== nextStructure.depthLayers || prev.projection !== nextStructure.projection || prev.showWalls !== nextStructure.showWalls || prev.showFloor !== nextStructure.showFloor || prev.renderMode !== nextStructure.renderMode || !wallMasksEqual(prev.walls, nextStructure.walls);
  if (structureChanged) root.classList[context.projection === "dimetric" ? "add" : "remove"](DIMETRIC_PROJECTION_CLASS), root.style.setProperty("--voxcss-rows", String(context.rows)), root.style.setProperty("--voxcss-cols", String(context.cols));
  if (renderMode === "slice-renderer") {
    renderState.layers.size && resetLayers(renderState);
    state.sliceRenderer = updateSliceRendererGeometry(renderState, state.sliceRenderer, snapshot, documentRef);
  } else {
    clearSliceRenderer(state.sliceRenderer);
    state.sliceRenderer = null;
    for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1)
      renderLayer(renderState, layerIndex, layers[layerIndex], context, shapes, documentRef);
    for (const [layerIndex, record] of Array.from(renderState.layers.entries()))
      if (layerIndex >= layers.length) removeLayerRecord(record), renderState.layers.delete(layerIndex);
  }
  if (structureChanged) syncSceneStructure(renderState, documentRef, context, layers.length), (state.prevStructure = nextStructure);
}

function updateSceneStructure(
  state: DomRendererState,
  documentRef: Document,
  context: GridContext,
  depthLayers: number
): void {
  syncSceneStructure(state.renderState, documentRef, context, depthLayers);
  const prev = state.prevStructure;
  if (prev) {
    state.prevStructure = {
      ...prev,
      rows: Math.max(context.rows, 1),
      cols: Math.max(context.cols, 1),
      depthLayers: Math.max(depthLayers, 0),
      projection: context.projection,
      walls: context.walls ?? DEFAULT_WALLS,
      showWalls: !!context.showWalls,
      showFloor: !!context.showFloor
    };
  }
}

function resetLayers(state: RenderState): void {
  state.layers.forEach(removeLayerRecord);
  state.layers.clear();
}

function renderLayer(
  state: RenderState,
  layerIndex: number,
  voxels: Voxel[] | undefined,
  context: GridContext,
  shapes: Record<string, ShapeRenderer>,
  documentRef: Document
): void {
  if (!voxels?.length) {
    const existing = state.layers.get(layerIndex);
    if (existing) clearLayerChildren(existing), (existing.lastVoxels = null);
    return;
  }
  const elevation = context.layerElevation ?? context.tileSize ?? 0;
  const transform = `translateZ(${layerIndex * elevation}px)`;
  let record = state.layers.get(layerIndex);
  if (!record) {
    const element = documentRef.createElement("div");
    element.className = LAYER_CLASS;
    record = { element, children: [], lastVoxels: null };
    state.layers.set(layerIndex, record);
    state.floor.appendChild(element);
  }
  record.element.style.transform = transform;
  const prev = record.lastVoxels;
  const sameRef = prev === voxels || (prev && prev.length === voxels.length && !prev.some((v, i) => v !== voxels[i]));
  const pool = record.children ?? (record.children = []);
  if (!sameRef) clearLayerChildren(record), (pool.length = 0);
  while (pool.length < voxels.length) {
    const element = documentRef.createElement("div");
    record.element.appendChild(element);
    pool.push(element);
  }
  while (pool.length > voxels.length) {
    const element = pool.pop();
    if (element) disposeCubeDom(element), element.remove();
  }
  for (let i = 0; i < voxels.length; i += 1) {
    const voxel = voxels[i];
    const element = pool[i];
    if (!element) continue;
    if (!voxel) {
      element.style.display = "none";
      disposeCubeDom(element);
      element.innerHTML = "";
      continue;
    }
    element.style.display = "";
    const faces = computeVisibleFaces(voxel, context);
    const clear = () => (disposeCubeDom(element), (element.innerHTML = ""));
    if (!faces.length) { element.style.display = "none"; clear(); continue; }
    const { x2, y2 } = getVoxelBounds(voxel);
    element.style.gridArea = `${voxel.x} / ${voxel.y} / ${x2} / ${y2}`;
    const shapeKey = voxel.shape || "cube", renderer = shapes[shapeKey];
    element.className = "";
    if (!renderer) { clear(); continue; }
    renderer === cubeShapeRenderer ? ensureCubeDomCache(element) : (disposeCubeDom(element), (element.innerHTML = ""));
    const produced = renderer({ voxel, context, root: element, precomputedFaces: faces });
    if (produced && produced !== element) element.appendChild(produced);
  }
  record.lastVoxels = voxels;
}

function syncSceneStructure(
  state: RenderState,
  documentRef: Document,
  context: GridContext,
  depthLayers: number
): void {
  const dimensions = { rows: Math.max(context.rows, 1), cols: Math.max(context.cols, 1), depth: Math.max(depthLayers, 1), tileSize: context.tileSize };
  const wallMask = context.walls ?? DEFAULT_WALLS;
  const disableGrid = dimensions.rows > GRID_DISABLE_THRESHOLD && dimensions.cols > GRID_DISABLE_THRESHOLD;
  const floor = state.floor, floorShouldShow = !!context.showFloor && !!wallMask.b;
  floor.style.pointerEvents = "none";
  if (floorShouldShow) {
    floor.style.removeProperty("background");
    floor.style.removeProperty("backgroundImage");
    floor.style.setProperty("--voxcss-floor-base", shadeColor(context.wallColor ?? DEFAULT_WALL_COLOR, FLOOR_BASE_DELTA));
    floor.style.setProperty("--voxcss-grid-x", `${dimensions.tileSize}px`);
    floor.style.setProperty("--voxcss-grid-y", `${dimensions.tileSize}px`);
    if (disableGrid) {
      floor.style.removeProperty("--voxcss-floor-grid");
    } else {
      const floorGridUrl = getGridSpriteUrl(documentRef, dimensions.tileSize, dimensions.tileSize, FLOOR_GRID_ALPHA);
      if (floorGridUrl) floor.style.setProperty("--voxcss-floor-grid", `url("${floorGridUrl}")`);
      else floor.style.removeProperty("--voxcss-floor-grid");
    }
  } else {
    floor.style.background = "none";
    floor.style.backgroundImage = "none";
    floor.style.removeProperty("--voxcss-floor-base");
    floor.style.removeProperty("--voxcss-grid-x");
    floor.style.removeProperty("--voxcss-grid-y");
    floor.style.removeProperty("--voxcss-floor-grid");
  }

  const ceilingShouldShow = !!context.showFloor && !!wallMask.t;
  if (!ceilingShouldShow) { state.ceiling?.remove(); state.ceiling = null; }
  else {
    let ceiling = state.ceiling;
    if (!ceiling) { ceiling = documentRef.createElement("div"); ceiling.className = CEILING_CLASS; state.ceiling = ceiling; }
    else if (ceiling.className !== CEILING_CLASS) ceiling.className = CEILING_CLASS;
    mountStructuralElement(state, ceiling);
    ceiling.style.width = `${dimensions.cols * dimensions.tileSize}px`, ceiling.style.height = `${dimensions.rows * dimensions.tileSize}px`, ceiling.style.transform = `translateZ(${dimensions.depth * dimensions.tileSize}px)`;
    ceiling.style.setProperty("--voxcss-ceiling-base", shadeColor(context.wallColor ?? DEFAULT_WALL_COLOR, CEILING_BASE_DELTA));
    ceiling.style.setProperty("--voxcss-ceiling-opacity", "0.35");
    if (disableGrid) {
      ceiling.style.removeProperty("--voxcss-ceiling-grid");
    } else {
      const ceilingGridUrl = getGridSpriteUrl(documentRef, dimensions.tileSize, dimensions.tileSize, CEILING_GRID_ALPHA);
      if (ceilingGridUrl) ceiling.style.setProperty("--voxcss-ceiling-grid", `url("${ceilingGridUrl}")`);
      else ceiling.style.removeProperty("--voxcss-ceiling-grid");
    }
  }

  if (!context.showWalls) clearWalls(state);
  else {
    const mask = wallMask;
    const tile = dimensions.tileSize,
      rows = Math.max(dimensions.rows, 1),
      cols = Math.max(dimensions.cols, 1),
      depth = Math.max(dimensions.depth, 1),
      halfTile = tile / 2,
      depthPx = depth * tile,
      rowPx = rows * tile,
      colPx = cols * tile;
    const wallElevation = readCssPxValue(documentRef, state.root, "--voxcss-layer-elevation", context.layerElevation ?? tile);
    const wallGridUrl = disableGrid ? null : getGridSpriteUrl(documentRef, tile, wallElevation, WALL_GRID_ALPHA);
    const wallGridAltUrl = disableGrid || tile === wallElevation ? wallGridUrl : getGridSpriteUrl(documentRef, wallElevation, tile, WALL_GRID_ALPHA);
    for (const [key, className, width, height, transform] of [
      ["bl", `${WALL_CLASS} ${WALL_CLASS}--backLeft`, depthPx, rowPx, `rotateY(-90deg) translateZ(${halfTile * depth}px) translateX(${halfTile * depth}px)`],
      ["fr", `${WALL_CLASS} ${WALL_CLASS}--frontRight`, depthPx, rowPx, `rotateY(-90deg) translateZ(-${halfTile * depth}px) translateX(${halfTile * depth}px)`],
      ["br", `${WALL_CLASS} ${WALL_CLASS}--backRight`, colPx, depthPx, `rotateX(90deg) translateZ(${halfTile * depth}px) translateY(${halfTile * depth}px)`],
      ["fl", `${WALL_CLASS} ${WALL_CLASS}--frontLeft`, colPx, depthPx, `rotateX(-90deg) translateZ(${halfTile * (2 * rows - depth)}px) translateY(-${halfTile * depth}px)`]
    ] as [keyof WallsMask, string, number, number, string][]) {
      if (!mask[key]) {
        const existing = state.wallElements.get(key);
        if (existing) existing.remove(), state.wallElements.delete(key);
        continue;
      }
      let wall = state.wallElements.get(key);
      if (!wall) { wall = documentRef.createElement("div"); wall.className = className; state.wallElements.set(key, wall); }
      else if (wall.className !== className) wall.className = className;
      mountStructuralElement(state, wall);
      wall.style.width = `${width}px`, wall.style.height = `${height}px`, wall.style.transform = transform;
      wall.style.backgroundColor = shadeWallFace(context.wallColor ?? DEFAULT_WALL_COLOR, key);
      const useAlt = key === "bl" || key === "fr";
      const gridUrl = useAlt ? wallGridAltUrl : wallGridUrl;
      if (gridUrl) wall.style.setProperty("--voxcss-wall-grid", `url("${gridUrl}")`);
      else wall.style.removeProperty("--voxcss-wall-grid");
    }
  }

  const elevation = context.layerElevation ?? context.tileSize ?? 0;
  for (const [layerIndex, record] of state.layers.entries())
    record.element.style.transform = `translateZ(${layerIndex * elevation}px)`;
}

function mountStructuralElement(state: RenderState, element: HTMLElement): void {
  state.root.insertBefore(element, state.floor.nextSibling);
}

const FLOOR_BASE_DELTA = 120;
const CEILING_BASE_DELTA = FLOOR_BASE_DELTA;

interface StructureSnapshot { rows: number; cols: number; depthLayers: number; projection?: GridContext["projection"]; walls: WallsMask; showWalls: boolean; showFloor: boolean; renderMode: SceneRenderMode; }

function clearWalls(state: RenderState): void {
  for (const [, element] of state.wallElements) element.remove();
  state.wallElements.clear();
}

function removeLayerRecord(record: LayerRecord): void {
  clearLayerChildren(record);
  record.element.remove();
}

function clearLayerChildren(record: LayerRecord): void {
  const children = record.children ?? (Array.from(record.element.children) as HTMLElement[]);
  for (const element of children) disposeCubeDom(element), element.remove();
  record.children = [];
  record.lastVoxels = null;
}
