import { diffScenes } from "./diff";
import type { SceneSnapshot } from "./state";
import type {
  RendererFactory,
  RendererHandle,
  RendererMountOptions,
  ScenePatch,
  AddVoxelPatch,
  UpdateVoxelPatch,
  RemoveVoxelPatch
} from "./renderer";
import type {
  GridContext,
  LayerRecord,
  RenderState,
  WallsMask,
  WallDimensionsSnapshot,
  Voxel,
  ShapeRenderer,
  CubeFace
} from "./types";
import {
  LAYER_CLASS,
  FLOOR_CLASS,
  FACE_CLASS,
  WALL_CLASS,
  CEILING_CLASS,
  DEFAULT_WALL_COLOR,
  DEFAULT_WALLS
} from "./types";
import { getVoxelBounds, wallMasksEqual } from "./context";
import { computeVisibleFaces } from "./visibility";
import { cubeShapeRenderer, ensureCubeDomCache, disposeCubeDom } from "./shapes";
import { defaultShapes } from "./shapes/registry";
import { shadeWallFace, shadeColor } from "./lighting";

interface DomRendererState {
  renderState: RenderState;
  context: GridContext | null;
}

const rendererStates = new WeakMap<HTMLElement, DomRendererState>();

const noopRenderer: ShapeRenderer = () => {};
const DIMETRIC_PROJECTION_CLASS = "voxcss-projection--dimetric";

export const createDomRenderer: RendererFactory = (options: RendererMountOptions): RendererHandle => {
  const { documentRef, target } = options;
  const shapes = defaultShapes;
  const state = ensureDomRendererState(documentRef, target);

  function applyInitial(snapshot: SceneSnapshot): void {
    state.context = { ...snapshot.context };
    const diff = diffScenes(null, snapshot);
    applyPatchSet(state, snapshot, diff.patches, documentRef, target, shapes);
  }

  function applyPatches(snapshot: SceneSnapshot, patches: ScenePatch[]): void {
    state.context = { ...snapshot.context };
    applyPatchSet(state, snapshot, patches, documentRef, target, shapes);
  }

  function destroy(): void {
    const renderState = state.renderState;
    for (const [, record] of renderState.layers) {
      removeLayerRecord(record);
    }
    renderState.layers.clear();
    for (const [, element] of renderState.wallElements) {
      element.remove();
    }
    renderState.wallElements.clear();
    renderState.ceiling?.remove();
    renderState.ceiling = null;
    renderState.floor.remove();
    rendererStates.delete(target);
  }

  return {
    applyInitial,
    applyPatches,
    destroy
  };
};

function ensureDomRendererState(documentRef: Document, root: HTMLElement): DomRendererState {
  const existing = rendererStates.get(root);
  if (existing) return existing;
  const renderState = createRenderState(documentRef, root);
  const composed: DomRendererState = {
    renderState,
    context: null
  };
  rendererStates.set(root, composed);
  return composed;
}

function createRenderState(documentRef: Document, root: HTMLElement): RenderState {
  root.innerHTML = "";
  const floor = appendFloor(documentRef, root);
  return {
    root,
    floor,
    layers: new Map(),
    wallElements: new Map(),
    ceiling: null
  };
}

function appendFloor(documentRef: Document, root: HTMLElement): HTMLElement {
  const floor = documentRef.createElement("div");
  floor.className = FLOOR_CLASS;
  root.appendChild(floor);
  return floor;
}

function applyPatchSet(
  state: DomRendererState,
  snapshot: SceneSnapshot,
  patches: ScenePatch[],
  documentRef: Document,
  root: HTMLElement,
  shapes: Record<string, ShapeRenderer>
): void {
  const renderState = state.renderState;
  const context = state.context ?? snapshot.context;
  updateProjectionClass(root, context);
  root.style.setProperty("--voxcss-rows", String(context.rows));
  root.style.setProperty("--voxcss-cols", String(context.cols));
  syncSceneStructure(renderState, documentRef, context, snapshot.layers.length);
  if (!patches.length) return;

  for (const patch of patches) {
    switch (patch.type) {
      case "addVoxel":
        applyVoxelUpsertPatch(renderState, patch.layerIndex, patch.voxelKey, patch.voxel, patch.faces, context, shapes, documentRef);
        break;
      case "updateVoxel":
        applyVoxelUpsertPatch(
          renderState,
          patch.layerIndex,
          patch.voxelKey,
          patch.voxel,
          patch.faces ?? computeVisibleFaces(patch.voxel, context),
          context,
          shapes,
          documentRef
        );
        break;
      case "removeVoxel":
        applyRemoveVoxelPatch(renderState, patch);
        break;
    }
  }
}

function updateProjectionClass(root: HTMLElement, context: GridContext): void {
  if (context.projection === "dimetric") {
    root.classList.add(DIMETRIC_PROJECTION_CLASS);
  } else {
    root.classList.remove(DIMETRIC_PROJECTION_CLASS);
  }
}

function applyVoxelUpsertPatch(
  state: RenderState,
  layerIndex: number,
  voxelKey: string,
  voxel: Voxel,
  faces: CubeFace[],
  context: GridContext,
  shapes: Record<string, ShapeRenderer>,
  documentRef: Document
): void {
  const record = ensureLayerRecord(state, layerIndex, documentRef, context);
  const layer = record.element;
  let element = record.voxels.get(voxelKey);
  if (!element) {
    element = documentRef.createElement("div");
    record.voxels.set(voxelKey, element);
  }
  if (element.parentNode !== layer) {
    layer.appendChild(element);
  }
  syncVoxelElement(element, voxel);
  renderVoxel({
    voxel,
    faces,
    context,
    root: element,
    shapes
  });
}

function applyRemoveVoxelPatch(state: RenderState, patch: RemoveVoxelPatch): void {
  const record = state.layers.get(patch.layerIndex);
  if (!record) return;
  const element = record.voxels.get(patch.voxelKey);
  if (!element) return;
  disposeCubeDom(element);
  element.remove();
  record.voxels.delete(patch.voxelKey);
}

function syncVoxelElement(element: HTMLElement, voxel: Voxel): void {
  const { x2, y2 } = getVoxelBounds(voxel);
  element.style.gridArea = `${voxel.x} / ${voxel.y} / ${x2} / ${y2}`;
}

function renderVoxel(args: {
  voxel: Voxel;
  faces: CubeFace[];
  context: GridContext;
  root: HTMLElement;
  shapes: Record<string, ShapeRenderer>;
}): void {
  const { voxel, faces, context, root, shapes } = args;
  const shapeKey = voxel.shape || "cube";
  const renderer = shapes[shapeKey] ?? (shapeKey === "cube" ? cubeShapeRenderer : noopRenderer);
  root.className = "";
  if (renderer === noopRenderer) {
    disposeCubeDom(root);
    root.innerHTML = "";
    return;
  }
  if (renderer === cubeShapeRenderer) {
    ensureCubeDomCache(root);
  } else {
    disposeCubeDom(root);
    root.innerHTML = "";
  }
  const produced = renderer({
    voxel,
    context,
    root,
    precomputedFaces: faces
  });
  if (produced && produced !== root) {
    root.appendChild(produced);
  }
}

function ensureLayerRecord(
  state: RenderState,
  layerIndex: number,
  documentRef: Document,
  context: GridContext
): LayerRecord {
  let record = state.layers.get(layerIndex);
  if (!record) {
    const element = documentRef.createElement("div");
    element.className = LAYER_CLASS;
    record = {
      element,
      voxels: new Map()
    };
    state.layers.set(layerIndex, record);
  }
  const layer = record.element;
  const parent = state.floor;
  if (layer.parentNode !== parent) {
    parent.appendChild(layer);
  }
  const elevation = context.layerElevation ?? context.tileSize ?? 0;
  layer.style.transform = `translateZ(${layerIndex * elevation}px)`;
  return record;
}
function syncSceneStructure(
  state: RenderState,
  documentRef: Document,
  context: GridContext,
  depthLayers: number
): void {
  syncFloor(state, context);
  syncCeiling(state, documentRef, context, depthLayers);
  syncWalls(state, documentRef, context, depthLayers);
  syncLayerElevations(state, context);
}

function syncFloor(state: RenderState, context: GridContext): void {
  const floor = state.floor;
  floor.style.pointerEvents = "none";
  const mask = context.walls ?? DEFAULT_WALLS;
  const shouldShow = !!context.showFloor && !!mask.b;
  if (shouldShow) {
    applyFloorAppearance(floor, context.wallColor ?? DEFAULT_WALL_COLOR);
  } else {
    resetFloorAppearance(floor);
  }
}

function syncCeiling(
  state: RenderState,
  documentRef: Document,
  context: GridContext,
  depthLayers: number
): void {
  const mask = context.walls ?? DEFAULT_WALLS;
  const shouldShow = !!context.showFloor && !!mask.t;
  if (!shouldShow) {
    if (state.ceiling) {
      state.ceiling.remove();
      state.ceiling = null;
    }
    return;
  }
  const dimensions = snapshotWallDimensions(context, depthLayers);
  let ceiling = state.ceiling;
  if (!ceiling) {
    ceiling = documentRef.createElement("div");
    ceiling.className = CEILING_CLASS;
    state.ceiling = ceiling;
  } else if (ceiling.className !== CEILING_CLASS) {
    ceiling.className = CEILING_CLASS;
  }
  mountStructuralElement(state, ceiling);
  const def: WallDefinition = {
    key: "t",
    className: CEILING_CLASS,
    width: dimensions.cols * dimensions.tileSize,
    height: dimensions.rows * dimensions.tileSize,
    transform: `translateZ(${dimensions.depth * dimensions.tileSize}px)`
  };
  applyWallDefinitionStyles(ceiling, def);
  applyCeilingAppearance(ceiling, context.wallColor ?? DEFAULT_WALL_COLOR);
}

function syncWalls(
  state: RenderState,
  documentRef: Document,
  context: GridContext,
  depthLayers: number
): void {
  if (!context.showWalls) {
    for (const [, element] of state.wallElements) {
      element.remove();
    }
    state.wallElements.clear();
    return;
  }
  const mask = context.walls ?? DEFAULT_WALLS;
  const dimensions = snapshotWallDimensions(context, depthLayers);
  const definitions = computeWallDefinitions(dimensions);
  const activeKeys = new Set<keyof WallsMask>();
  for (const def of definitions) {
    if (!mask[def.key]) {
      const existing = state.wallElements.get(def.key);
      if (existing) {
        existing.remove();
        state.wallElements.delete(def.key);
      }
      continue;
    }
    activeKeys.add(def.key);
    let wall = state.wallElements.get(def.key);
    if (!wall) {
      wall = documentRef.createElement("div");
      wall.className = def.className;
      state.wallElements.set(def.key, wall);
    } else if (wall.className !== def.className) {
      wall.className = def.className;
    }
    mountStructuralElement(state, wall);
    applyWallDefinitionStyles(wall, def);
    applyWallLighting(wall, def.key, context);
  }
  for (const [key, element] of Array.from(state.wallElements.entries())) {
    if (!activeKeys.has(key)) {
      element.remove();
      state.wallElements.delete(key);
    }
  }
}

function mountStructuralElement(state: RenderState, element: HTMLElement): void {
  const parent = state.root;
  const reference = state.floor.nextSibling;
  parent.insertBefore(element, reference);
}

const FLOOR_BASE_DELTA = 120;
const CEILING_BASE_DELTA = FLOOR_BASE_DELTA;

function applyFloorAppearance(floor: HTMLElement, baseColor: string): void {
  const floorBase = shadeColor(baseColor, FLOOR_BASE_DELTA);
  floor.style.removeProperty("background");
  floor.style.removeProperty("backgroundImage");
  floor.style.setProperty("--voxcss-floor-base", floorBase);
}

function resetFloorAppearance(floor: HTMLElement): void {
  floor.style.background = "none";
  floor.style.backgroundImage = "none";
  floor.style.removeProperty("--voxcss-floor-base");
}

function applyCeilingAppearance(ceiling: HTMLElement, baseColor: string): void {
  ceiling.style.setProperty("--voxcss-ceiling-base", shadeColor(baseColor, CEILING_BASE_DELTA));
  ceiling.style.setProperty("--voxcss-ceiling-opacity", "0.35");
}

interface WallDefinition {
  key: keyof WallsMask;
  className: string;
  width: number;
  height: number;
  transform: string;
}

function applyWallDefinitionStyles(el: HTMLElement, def: WallDefinition): void {
  const width = `${def.width}px`;
  const height = `${def.height}px`;
  el.style.width = width;
  el.style.height = height;
  el.style.transform = def.transform;
}

function applyWallLighting(el: HTMLElement, key: keyof WallsMask, context: GridContext): void {
  if (key !== "fr" && key !== "fl" && key !== "bl" && key !== "br") return;
  const base = context.wallColor ?? DEFAULT_WALL_COLOR;
  const shaded = shadeWallFace(base, key);
  el.style.backgroundColor = shaded;
}

function syncLayerElevations(state: RenderState, context: GridContext): void {
  const elevation = context.layerElevation ?? context.tileSize ?? 0;
  for (const [layerIndex, record] of state.layers.entries()) {
    record.element.style.transform = `translateZ(${layerIndex * elevation}px)`;
  }
}

function snapshotWallDimensions(context: GridContext, depthLayers: number): WallDimensionsSnapshot {
  return {
    rows: Math.max(context.rows, 1),
    cols: Math.max(context.cols, 1),
    depth: Math.max(depthLayers, 1),
    tileSize: context.tileSize
  };
}

function computeWallDefinitions(dimensions: WallDimensionsSnapshot): WallDefinition[] {
  const tile = dimensions.tileSize;
  const rows = Math.max(dimensions.rows, 1);
  const cols = Math.max(dimensions.cols, 1);
  const depth = Math.max(dimensions.depth, 1);
  const halfTile = tile / 2;
  const depthPx = depth * tile;
  const rowPx = rows * tile;
  const colPx = cols * tile;

  return [
    {
      key: "bl",
      className: `${WALL_CLASS} ${WALL_CLASS}--backLeft`,
      width: depthPx,
      height: rowPx,
      transform: `rotateY(-90deg) translateZ(${halfTile * depth}px) translateX(${halfTile * depth}px)`
    },
    {
      key: "fr",
      className: `${WALL_CLASS} ${WALL_CLASS}--frontRight`,
      width: depthPx,
      height: rowPx,
      transform: `rotateY(-90deg) translateZ(-${halfTile * depth}px) translateX(${halfTile * depth}px)`
    },
    {
      key: "br",
      className: `${WALL_CLASS} ${WALL_CLASS}--backRight`,
      width: colPx,
      height: depthPx,
      transform: `rotateX(90deg) translateZ(${halfTile * depth}px) translateY(${halfTile * depth}px)`
    },
    {
      key: "fl",
      className: `${WALL_CLASS} ${WALL_CLASS}--frontLeft`,
      width: colPx,
      height: depthPx,
      transform: `rotateX(-90deg) translateZ(${halfTile * (2 * rows - depth)}px) translateY(-${halfTile * depth}px)`
    }
  ];
}

function removeLayerRecord(record: LayerRecord): void {
  for (const [, element] of record.voxels) {
    disposeCubeDom(element);
    element.remove();
  }
  record.voxels.clear();
  record.element.remove();
}
