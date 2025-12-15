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
  WALL_CLASS,
  CEILING_CLASS,
  DEFAULT_WALL_COLOR,
  DEFAULT_WALLS,
  CUBE_FACES
} from "./types";
import { getVoxelBounds } from "./context";
import { computeVisibleFaces } from "./visibility";
import { cubeShapeRenderer, ensureCubeDomCache, disposeCubeDom } from "./shapes";
import { rampShapeRenderer } from "./shapes/ramp";
import { wedgeShapeRenderer } from "./shapes/wedge";
import { spikeShapeRenderer } from "./shapes/spike";
import { shadeWallFace, shadeColor } from "./lighting";
import { wallMasksEqual } from "./context";
import { applyCubeFaceAppearance, getCubeFaceAppearanceSignature } from "./cubeFaceAppearance";

interface DomRendererState {
  renderState: RenderState;
  prevStructure: StructureSnapshot | null;
  planeShell: PlaneShellDomState | null;
}

const rendererStates = new WeakMap<HTMLElement, DomRendererState>();

const noopRenderer: ShapeRenderer = () => {};
const DIMETRIC_PROJECTION_CLASS = "voxcss-projection--dimetric";
const PLANE_SHELL_RENDERER_CLASS = "voxcss-renderer--plane-shell";

export interface RendererMountOptions {
  documentRef: Document;
  target: HTMLElement;
}

export interface RendererHandle {
  render(snapshot: SceneSnapshot): void;
  destroy(): void;
}

export interface SceneSnapshot {
  layers: Voxel[][];
  context: GridContext;
  renderer?: RendererMetadata;
}

export type RendererFactory = (options: RendererMountOptions) => RendererHandle;

export type SceneRenderMode = "cubes" | "plane-shell";

export interface RendererMetadata {
  mode: SceneRenderMode;
  mergeApplies: boolean;
  rawVoxelCount: number;
  cubeOnly: boolean;
  planeShellEligible: boolean;
}

export const createDomRenderer: RendererFactory = (options: RendererMountOptions): RendererHandle => {
  const { documentRef, target } = options;
  const shapes = {
    cube: cubeShapeRenderer,
    ramp: rampShapeRenderer,
    wedge: wedgeShapeRenderer,
    spike: spikeShapeRenderer
  };
  const state = ensureDomRendererState(documentRef, target);

  function render(snapshot: SceneSnapshot): void {
    renderScene(state, snapshot, documentRef, target, shapes);
  }

  function destroy(): void {
    const renderState = state.renderState;
    resetLayers(renderState);
    clearPlaneShell(state);
    clearWalls(renderState);
    renderState.ceiling?.remove();
    renderState.ceiling = null;
    renderState.floor.remove();
    rendererStates.delete(target);
  }

  return {
    render,
    destroy
  };
};

function ensureDomRendererState(documentRef: Document, root: HTMLElement): DomRendererState {
  const existing = rendererStates.get(root);
  if (existing) return existing;
  root.innerHTML = "";
  const floor = appendFloor(documentRef, root);
  const renderState: RenderState = {
    root,
    floor,
    layers: new Map(),
    wallElements: new Map(),
    ceiling: null
  };
  const composed: DomRendererState = { renderState, prevStructure: null, planeShell: null };
  rendererStates.set(root, composed);
  return composed;
}

function appendFloor(documentRef: Document, root: HTMLElement): HTMLElement {
  const floor = documentRef.createElement("div");
  floor.className = FLOOR_CLASS;
  root.appendChild(floor);
  return floor;
}

function renderScene(
  state: DomRendererState,
  snapshot: SceneSnapshot,
  documentRef: Document,
  root: HTMLElement,
  shapes: Record<string, ShapeRenderer>
): void {
  const renderState = state.renderState;
  const context = snapshot.context;
  const renderMode: SceneRenderMode = snapshot.renderer?.mode ?? "cubes";
  const nextStructure = snapshotStructure(context, snapshot.layers.length, renderMode);
  const structureChanged = !structureEqual(state.prevStructure, nextStructure);
  if (structureChanged) {
    updateProjectionClass(root, context);
    updateRenderModeClass(root, renderMode);
    root.style.setProperty("--voxcss-rows", String(context.rows));
    root.style.setProperty("--voxcss-cols", String(context.cols));
  }

  if (renderMode === "plane-shell") {
    if (renderState.layers.size) {
      resetLayers(renderState);
    }
    renderPlaneShell(state, snapshot, documentRef);
  } else {
    clearPlaneShell(state);
    renderLayers(renderState, snapshot.layers, context, shapes, documentRef);
  }
  if (structureChanged) {
    syncSceneStructure(renderState, documentRef, context, snapshot.layers.length);
    state.prevStructure = nextStructure;
  }
}

function updateProjectionClass(root: HTMLElement, context: GridContext): void {
  if (context.projection === "dimetric") {
    root.classList.add(DIMETRIC_PROJECTION_CLASS);
  } else {
    root.classList.remove(DIMETRIC_PROJECTION_CLASS);
  }
}

function updateRenderModeClass(root: HTMLElement, mode: SceneRenderMode): void {
  if (mode === "plane-shell") {
    root.classList.add(PLANE_SHELL_RENDERER_CLASS);
  } else {
    root.classList.remove(PLANE_SHELL_RENDERER_CLASS);
  }
}

function resetLayers(state: RenderState): void {
  for (const [, record] of state.layers) {
    removeLayerRecord(record);
  }
  state.layers.clear();
}

interface PlaneShellDomState {
  container: HTMLElement;
}

function ensurePlaneShellContainer(state: DomRendererState, documentRef: Document): HTMLElement {
  const existing = state.planeShell?.container;
  const floor = state.renderState.floor;
  if (existing) {
    if (existing.parentElement !== floor) {
      floor.appendChild(existing);
    }
    return existing;
  }
  const container = documentRef.createElement("div");
  container.className = "voxcss-shell";
  floor.appendChild(container);
  state.planeShell = { container };
  return container;
}

function clearPlaneShell(state: DomRendererState): void {
  state.planeShell?.container.remove();
  state.planeShell = null;
}

function renderPlaneShell(state: DomRendererState, snapshot: SceneSnapshot, documentRef: Document): void {
  const container = ensurePlaneShellContainer(state, documentRef);
  container.innerHTML = "";

  const context = snapshot.context;
  const tileSize = context.tileSize ?? 50;
  const layerElevation = context.layerElevation ?? tileSize;
  const rows = Math.max(context.rows, 1);
  const cols = Math.max(context.cols, 1);
  const depth = Math.max(snapshot.layers.length, 0);

  const occupied = new Map<number, Voxel>();
  const strideXY = rows * cols;
  const toKey = (x: number, y: number, z: number) => z * strideXY + x * cols + y;

  for (let z = 0; z < snapshot.layers.length; z += 1) {
    const layer = snapshot.layers[z];
    if (!layer?.length) continue;
    for (const voxel of layer) {
      if (!voxel) continue;
      const { x2, y2 } = getVoxelBounds(voxel);
      for (let x = voxel.x; x < x2; x += 1) {
        if (x < 0 || x >= rows) continue;
        for (let y = voxel.y; y < y2; y += 1) {
          if (y < 0 || y >= cols) continue;
          occupied.set(toKey(x, y, z), voxel);
        }
      }
    }
  }

  const sheets = new Map<string, HTMLElement>();

  const ensureSheet = (axis: "x" | "y" | "z", k: number): HTMLElement => {
    const key = `${axis}:${k}`;
    const existing = sheets.get(key);
    if (existing) return existing;

    const sheet = documentRef.createElement("div");
    sheet.className = `voxcss-shell-sheet voxcss-shell-sheet--${axis}`;

    if (axis === "z") {
      sheet.style.width = "100%";
      sheet.style.height = "100%";
      sheet.style.gridTemplateColumns = `repeat(${cols}, ${tileSize}px)`;
      sheet.style.gridTemplateRows = `repeat(${rows}, ${tileSize}px)`;
      sheet.style.transform = `translateZ(${k * layerElevation}px)`;
    } else if (axis === "y") {
      sheet.style.width = `${depth * layerElevation}px`;
      sheet.style.height = `${rows * tileSize}px`;
      sheet.style.gridTemplateColumns = `repeat(${depth}, ${layerElevation}px)`;
      sheet.style.gridTemplateRows = `repeat(${rows}, ${tileSize}px)`;
      sheet.style.transform = `translateX(${(k - 1) * tileSize}px) rotateY(-90deg)`;
    } else {
      sheet.style.width = `${cols * tileSize}px`;
      sheet.style.height = `${depth * layerElevation}px`;
      sheet.style.gridTemplateColumns = `repeat(${cols}, ${tileSize}px)`;
      sheet.style.gridTemplateRows = `repeat(${depth}, ${layerElevation}px)`;
      sheet.style.transform = `translateY(${(k - 1) * tileSize}px) rotateX(90deg)`;
    }

    container.appendChild(sheet);
    sheets.set(key, sheet);
    return sheet;
  };

  const offsets = context.offsets;
  const walls = context.walls;

  type FaceSignatureMap = Partial<Record<CubeFace, string>>;
  const signatureCache = new WeakMap<Voxel, FaceSignatureMap>();
  const getSignature = (voxel: Voxel, face: CubeFace): string => {
    let cached = signatureCache.get(voxel);
    if (!cached) {
      cached = {};
      signatureCache.set(voxel, cached);
    }
    const existing = cached[face];
    if (existing !== undefined) return existing;
    const sig = getCubeFaceAppearanceSignature(voxel, face, context);
    cached[face] = sig;
    return sig;
  };

  interface FaceCellGroup {
    face: CubeFace;
    voxel: Voxel;
    cells: Set<string>;
  }

  const groupsBySheet = new Map<string, Map<string, FaceCellGroup>>();

  const addFaceCell = (
    axis: "x" | "y" | "z",
    plane: number,
    face: CubeFace,
    voxel: Voxel,
    x: number,
    y: number
  ): void => {
    const sheetKey = `${axis}:${plane}`;
    let groups = groupsBySheet.get(sheetKey);
    if (!groups) {
      groups = new Map<string, FaceCellGroup>();
      groupsBySheet.set(sheetKey, groups);
    }
    const sig = getSignature(voxel, face);
    const groupKey = `${face}\n${sig}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { face, voxel, cells: new Set<string>() };
      groups.set(groupKey, group);
    }
    group.cells.add(`${x}:${y}`);
  };

  for (const [key, voxel] of occupied.entries()) {
    const z = Math.floor(key / strideXY);
    const rem = key - z * strideXY;
    const x = Math.floor(rem / cols);
    const y = rem - x * cols;

    for (const face of CUBE_FACES) {
      if (walls[face]) continue;
      const delta = offsets[face];
      if (!delta) continue;
      const [dx, dy, dz] = delta;
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const hasNeighbor =
        nx >= 0 && nx < rows && ny >= 0 && ny < cols && nz >= 0 && nz < depth && occupied.has(toKey(nx, ny, nz));
      if (hasNeighbor) continue;

      if (face === "t" || face === "b") {
        const plane = face === "b" ? z : z + 1;
        addFaceCell("z", plane, face, voxel, x, y);
        continue;
      }

      if (face === "bl" || face === "fr") {
        const plane = face === "bl" ? y : y + 1;
        addFaceCell("y", plane, face, voxel, x, z + 1);
        continue;
      }

      const plane = face === "br" ? x : x + 1;
      addFaceCell("x", plane, face, voxel, z + 1, y);
    }
  }

  interface Rect {
    x: number;
    y: number;
    x2: number;
    y2: number;
  }

  const mergeCellKeys = (cells: Set<string>): Rect[] => {
    const coords: Array<{ x: number; y: number }> = Array.from(cells.values()).map((cellKey) => {
      const [xs, ys] = cellKey.split(":");
      return { x: Number(xs), y: Number(ys) };
    });
    coords.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));

    const visited = new Set<string>();
    const hasCell = (x: number, y: number): boolean => {
      const key = `${x}:${y}`;
      if (visited.has(key)) return false;
      return cells.has(key);
    };

    const rects: Rect[] = [];

    for (const coord of coords) {
      const startKey = `${coord.x}:${coord.y}`;
      if (visited.has(startKey)) continue;
      if (!cells.has(startKey)) continue;

      let width = 1;
      while (hasCell(coord.x + width, coord.y)) {
        width += 1;
      }

      let height = 1;
      let canGrow = true;
      while (canGrow) {
        const nextY = coord.y + height;
        for (let dx = 0; dx < width; dx += 1) {
          if (!hasCell(coord.x + dx, nextY)) {
            canGrow = false;
            break;
          }
        }
        if (canGrow) {
          height += 1;
        }
      }

      for (let dx = 0; dx < width; dx += 1) {
        for (let dy = 0; dy < height; dy += 1) {
          visited.add(`${coord.x + dx}:${coord.y + dy}`);
        }
      }

      rects.push({
        x: coord.x,
        y: coord.y,
        x2: coord.x + width,
        y2: coord.y + height
      });
    }

    return rects;
  };

  for (const [sheetKey, groups] of groupsBySheet.entries()) {
    const [axisRaw, planeRaw] = sheetKey.split(":");
    const axis = axisRaw as "x" | "y" | "z";
    const plane = Number(planeRaw);
    const sheet = ensureSheet(axis, plane);

    for (const group of groups.values()) {
      const rects = mergeCellKeys(group.cells);
      for (const rect of rects) {
        const quad = documentRef.createElement("div");
        quad.className = `voxcss-shell-face voxcss-cube-face voxcss-cube-face--${group.face}`;
        quad.style.gridArea = `${rect.x} / ${rect.y} / ${rect.x2} / ${rect.y2}`;
        applyCubeFaceAppearance(quad, group.face, group.voxel, context);
        sheet.appendChild(quad);
      }
    }
  }
}

function renderLayers(
  state: RenderState,
  layers: Voxel[][],
  context: GridContext,
  shapes: Record<string, ShapeRenderer>,
  documentRef: Document
): void {
  const activeLayers = new Set<number>();
  for (let layerIndex = 0; layerIndex < layers.length; layerIndex += 1) {
    renderLayer(state, layerIndex, layers[layerIndex], context, shapes, documentRef);
    activeLayers.add(layerIndex);
  }
  // Remove any excess layers from previous renders.
  for (const [layerIndex, record] of Array.from(state.layers.entries())) {
    if (!activeLayers.has(layerIndex)) {
      removeLayerRecord(record);
      state.layers.delete(layerIndex);
    }
  }
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
    if (existing) {
      clearLayerChildren(existing);
      existing.lastVoxels = null;
    }
    return;
  }
  const record = ensureLayerRecord(state, layerIndex, documentRef, context);
  const sameRef = voxelArraysEqual(record.lastVoxels, voxels);
  if (!record.children) {
    record.children = [];
  }
  if (!sameRef) {
    clearLayerChildren(record);
    record.children = [];
  }
  const pool = record.children;
  while (pool.length < voxels.length) {
    const element = documentRef.createElement("div");
    record.element.appendChild(element);
    pool.push(element);
  }
  while (pool.length > voxels.length) {
    const element = pool.pop();
    if (element) {
      disposeCubeDom(element);
      element.remove();
    }
  }
  for (let i = 0; i < voxels.length; i += 1) {
    const voxel = voxels[i];
    if (!voxel) continue;
    const element = pool[i];
    if (!element) continue;
    element.style.display = "";
    const faces = computeVisibleFaces(voxel, context);
    if (!faces.length) {
      element.style.display = "none";
      disposeCubeDom(element);
      element.innerHTML = "";
      continue;
    }
    syncVoxelElement(element, voxel);
    renderVoxelElement(record, voxel, faces, context, shapes, documentRef, element);
  }
  record.children = pool;
  record.lastVoxels = voxels;
}

function voxelArraysEqual(a?: Voxel[] | null, b?: Voxel[] | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function renderVoxelElement(
  record: LayerRecord,
  voxel: Voxel,
  faces: CubeFace[],
  context: GridContext,
  shapes: Record<string, ShapeRenderer>,
  documentRef: Document,
  element?: HTMLElement
): void {
  const host = element ?? documentRef.createElement("div");
  if (!element) {
    record.element.appendChild(host);
  }
  syncVoxelElement(host, voxel);
  renderVoxel({
    voxel,
    faces,
    context,
    root: host,
    shapes
  });
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

function createLayerRecord(
  state: RenderState,
  layerIndex: number,
  documentRef: Document,
  context: GridContext
): LayerRecord {
  const element = documentRef.createElement("div");
  element.className = LAYER_CLASS;
  const record: LayerRecord = {
    element,
    children: [],
    lastVoxels: null
  };
  state.layers.set(layerIndex, record);
  const parent = state.floor;
  parent.appendChild(element);
  const elevation = context.layerElevation ?? context.tileSize ?? 0;
  element.style.transform = `translateZ(${layerIndex * elevation}px)`;
  return record;
}

function ensureLayerRecord(
  state: RenderState,
  layerIndex: number,
  documentRef: Document,
  context: GridContext
): LayerRecord {
  const existing = state.layers.get(layerIndex);
  if (existing) {
    // Keep the element but update elevation in case projection/layerElevation changed.
    const elevation = context.layerElevation ?? context.tileSize ?? 0;
    existing.element.style.transform = `translateZ(${layerIndex * elevation}px)`;
    return existing;
  }
  return createLayerRecord(state, layerIndex, documentRef, context);
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
    clearWalls(state);
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

interface StructureSnapshot {
  rows: number;
  cols: number;
  depthLayers: number;
  projection?: GridContext["projection"];
  walls: WallsMask;
  showWalls: boolean;
  showFloor: boolean;
  renderMode: SceneRenderMode;
}

function snapshotStructure(context: GridContext, depthLayers: number, renderMode: SceneRenderMode): StructureSnapshot {
  return {
    rows: Math.max(context.rows, 1),
    cols: Math.max(context.cols, 1),
    depthLayers: Math.max(depthLayers, 0),
    projection: context.projection,
    walls: context.walls ?? DEFAULT_WALLS,
    showWalls: !!context.showWalls,
    showFloor: !!context.showFloor,
    renderMode
  };
}

function structureEqual(a: StructureSnapshot | null, b: StructureSnapshot | null): boolean {
  if (!a || !b) return false;
  return (
    a.rows === b.rows &&
    a.cols === b.cols &&
    a.depthLayers === b.depthLayers &&
    a.projection === b.projection &&
    a.showWalls === b.showWalls &&
    a.showFloor === b.showFloor &&
    a.renderMode === b.renderMode &&
    wallMasksEqual(a.walls, b.walls)
  );
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

function clearWalls(state: RenderState): void {
  for (const [, element] of state.wallElements) {
    element.remove();
  }
  state.wallElements.clear();
}

function removeLayerRecord(record: LayerRecord): void {
  clearLayerChildren(record);
  record.element.remove();
}

function clearLayerChildren(record: LayerRecord): void {
  const children = record.children ?? (Array.from(record.element.children) as HTMLElement[]);
  for (const element of children) {
    disposeCubeDom(element);
    element.remove();
  }
  record.children = [];
  record.lastVoxels = null;
}
