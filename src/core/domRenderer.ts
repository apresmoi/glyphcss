import { diffScenes } from "./diff";
import type { SceneSnapshot } from "./state";
import type {
  RendererFactory,
  RendererHandle,
  RendererMountOptions,
  ScenePatch,
  AddVoxelPatch,
  UpdateVoxelPatch,
  RemoveVoxelPatch,
  LayerMetaPatch,
  WallsMetaPatch,
  FloorMetaPatch,
  PointerRegionPatch
} from "./renderer";
import type {
  GridContext,
  LayerRecord,
  PointerEventPayload,
  RenderState,
  WallsMask,
  Voxel,
  ShapeRenderer,
  VoxcssHooks,
  CubeFace
} from "./types";
import {
  LAYER_CLASS,
  VOXEL_CLASS,
  FLOOR_CLASS,
  FACE_CLASS,
  WALL_CLASS,
  WALL_CONTAINER_CLASS,
  DEFAULT_WALL_COLOR
} from "./types";
import { getVoxelBounds, makeVoxelKey, wallMasksEqual } from "./context";
import { computeVisibleFaces } from "./visibility";
import { cubeShapeRenderer, ensureCubeDomCache, disposeCubeDom } from "./shapes";
import { shadeWallFace } from "./lighting";

interface DomRendererState {
  renderState: RenderState;
  context: GridContext | null;
  layerMeta: Map<number, LayerMetaPatch>;
}

const rendererStates = new WeakMap<HTMLElement, DomRendererState>();

const noopRenderer: ShapeRenderer = () => {};

export const createDomRenderer: RendererFactory = (options: RendererMountOptions): RendererHandle => {
  const { documentRef, target, shapes, hooks } = options;
  const state = ensureDomRendererState(documentRef, target);

  function applyInitial(snapshot: SceneSnapshot): void {
    state.context = { ...snapshot.context };
    const diff = diffScenes(null, snapshot);
    applyPatchSet(state, snapshot, diff.patches, documentRef, target, shapes, hooks);
  }

  function applyPatches(snapshot: SceneSnapshot, patches: ScenePatch[]): void {
    state.context = { ...snapshot.context };
    applyPatchSet(state, snapshot, patches, documentRef, target, shapes, hooks);
  }

  function destroy(): void {
    const renderState = state.renderState;
    for (const [, record] of renderState.layers) {
      removeLayerRecord(record);
    }
    renderState.layers.clear();
    renderState.floor.remove();
    renderState.wallsContainer?.remove();
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
    context: null,
    layerMeta: new Map()
  };
  rendererStates.set(root, composed);
  return composed;
}

function createRenderState(documentRef: Document, root: HTMLElement): RenderState {
  root.innerHTML = "";
  const floor = appendFloor(documentRef, root);
  return {
    floor,
    layers: new Map(),
    wallsContainer: null,
    wallElements: new Map(),
    lastWallsMask: null,
    lastShowWalls: undefined,
    lastWallDimensions: null,
    lastShowFloor: undefined,
    lastWallColor: undefined
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
  shapes: Record<string, ShapeRenderer>,
  hooks?: VoxcssHooks
): void {
  if (!patches.length) return;
  const renderState = state.renderState;
  const context = state.context ?? snapshot.context;
  root.style.setProperty("--voxcss-rows", String(context.rows));
  root.style.setProperty("--voxcss-cols", String(context.cols));

  const pointerUpdates = new Set<number>();

  for (const patch of patches) {
    switch (patch.type) {
      case "layerMeta":
        state.layerMeta.set(patch.layerIndex, patch);
        applyLayerMetaPatch(renderState, patch, context, documentRef);
        break;
      case "addVoxel":
        applyAddVoxelPatch(renderState, patch, context, shapes, hooks, documentRef);
        pointerUpdates.add(patch.layerIndex);
        break;
      case "updateVoxel":
        applyUpdateVoxelPatch(renderState, patch, context, shapes, hooks, documentRef);
        pointerUpdates.add(patch.layerIndex);
        break;
      case "removeVoxel":
        applyRemoveVoxelPatch(renderState, patch);
        pointerUpdates.add(patch.layerIndex);
        break;
      case "wallsMeta":
        applyWallsMetaPatch(renderState, patch, documentRef, root, context, snapshot.layers.length);
        break;
      case "floorMeta":
        applyFloorMetaPatch(renderState, patch, context);
        break;
      case "pointerRegion":
        // pointer metadata is informational for now; delegation wiring happens elsewhere.
        break;
    }
  }

  for (const layerIndex of pointerUpdates) {
    const record = renderState.layers.get(layerIndex);
    if (record) {
      updateDelegatedPointerHandlers(record, hooks?.onPointer);
    }
  }
}

function applyLayerMetaPatch(
  state: RenderState,
  patch: LayerMetaPatch,
  context: GridContext,
  documentRef: Document
): void {
  const record = ensureLayerRecord(state, patch.layerIndex, documentRef, undefined);
  const layer = record.element;
  const cols = Math.max(patch.cols, 1);
  const rows = Math.max(patch.rows, 1);
  layer.style.transform = `translateZ(${patch.layerIndex * patch.elevation}px)`;
  if (layer.parentNode !== state.floor) {
    state.floor.appendChild(layer);
  }
  context.rows = patch.rows;
  context.cols = patch.cols;
  context.tileSize = patch.tileSize;
  context.layerElevation = patch.elevation;
}

function applyAddVoxelPatch(
  state: RenderState,
  patch: AddVoxelPatch,
  context: GridContext,
  shapes: Record<string, ShapeRenderer>,
  hooks: VoxcssHooks | undefined,
  documentRef: Document
): void {
  const record = ensureLayerRecord(state, patch.layerIndex, documentRef, hooks);
  const layer = record.element;

  let voxelRoot = record.voxels.get(patch.voxelKey);
  if (!voxelRoot) {
    voxelRoot = documentRef.createElement("div");
    voxelRoot.className = VOXEL_CLASS;
    record.voxels.set(patch.voxelKey, voxelRoot);
  }
  if (voxelRoot.parentNode !== layer) {
    layer.appendChild(voxelRoot);
  }
  syncVoxelElement(voxelRoot, patch.voxel);
  renderVoxel({
    voxel: patch.voxel,
    faces: patch.faces,
    context,
    root: voxelRoot,
    shapes
  });
}

function applyUpdateVoxelPatch(
  state: RenderState,
  patch: UpdateVoxelPatch,
  context: GridContext,
  shapes: Record<string, ShapeRenderer>,
  hooks: VoxcssHooks | undefined,
  documentRef: Document
): void {
  const record = ensureLayerRecord(state, patch.layerIndex, documentRef, hooks);
  const element = record.voxels.get(patch.voxelKey);
  if (!element) {
    const addPatch: AddVoxelPatch = {
      type: "addVoxel",
      layerIndex: patch.layerIndex,
      voxelKey: patch.voxelKey,
      voxel: patch.voxel,
      faces: patch.faces ?? computeVisibleFaces(patch.voxel, context)
    };
    applyAddVoxelPatch(state, addPatch, context, shapes, hooks, documentRef);
    return;
  }
  syncVoxelElement(element, patch.voxel);
  renderVoxel({
    voxel: patch.voxel,
    faces: patch.faces ?? computeVisibleFaces(patch.voxel, context),
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
  delete (element as any).__voxelData;
  element.remove();
  record.voxels.delete(patch.voxelKey);
}

function applyWallsMetaPatch(
  state: RenderState,
  patch: WallsMetaPatch,
  documentRef: Document,
  root: HTMLElement,
  context: GridContext,
  depthLayers: number
): void {
  context.showWalls = patch.showWalls;
  context.walls = { ...patch.mask };
  updateWallsContainer(state, documentRef, root, context, depthLayers);
}

function applyFloorMetaPatch(state: RenderState, patch: FloorMetaPatch, context: GridContext): void {
  const showFloor = patch.showFloor;
  const floor = state.floor;
  floor.style.pointerEvents = "none";
  if (!showFloor) {
    floor.style.background = "none";
    floor.style.backgroundImage = "none";
  } else {
    floor.style.background = "";
    floor.style.backgroundImage = "";
  }
  context.showFloor = showFloor;
  state.lastShowFloor = showFloor;
}

function syncVoxelElement(element: HTMLElement, voxel: Voxel): void {
  const { x2, y2 } = getVoxelBounds(voxel);
  element.style.gridArea = `${voxel.x} / ${voxel.y} / ${x2} / ${y2}`;
  (element as any).__voxelData = voxel;
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
  hooks?: VoxcssHooks
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
    hooks?.onLayerMount?.(layerIndex, element);
  }
  return record;
}

function updateWallsContainer(
  state: RenderState,
  documentRef: Document,
  root: HTMLElement,
  context: GridContext,
  depthLayers: number
): void {
  const showWallsChanged = state.lastShowWalls !== context.showWalls;
  const maskChanged =
    context.showWalls &&
    (!state.lastWallsMask || !wallMasksEqual(state.lastWallsMask, context.walls));
  const nextDimensions = snapshotWallDimensions(context, depthLayers);
  const geometryChanged =
    context.showWalls && !wallDimensionsEqual(state.lastWallDimensions, nextDimensions);
  const wallColorChanged = (state.lastWallColor ?? DEFAULT_WALL_COLOR) !== context.wallColor;

  if (!context.showWalls) {
    if (state.wallsContainer) {
      state.wallsContainer.remove();
      state.wallsContainer = null;
      state.wallElements.clear();
    }
    state.lastShowWalls = false;
    state.lastWallsMask = null;
    state.lastWallDimensions = null;
    state.lastWallColor = undefined;
    return;
  }

  if (
    !showWallsChanged &&
    !maskChanged &&
    !geometryChanged &&
    !wallColorChanged &&
    state.wallsContainer
  ) {
    return;
  }

  const container = ensureWallsRoot(state, documentRef, root);
  const definitions = computeWallDefinitions(context, depthLayers);
  const activeKeys = new Set<keyof WallsMask>();

  for (const def of definitions) {
    const visible = context.walls?.[def.key];
    const existing = state.wallElements.get(def.key);
    if (!visible) {
      if (existing) {
        existing.remove();
        state.wallElements.delete(def.key);
      }
      continue;
    }
    activeKeys.add(def.key);
    let wall = existing;
    if (!wall) {
      wall = documentRef.createElement("div");
      wall.className = def.className;
      state.wallElements.set(def.key, wall);
      container.appendChild(wall);
    } else if (wall.className !== def.className) {
      wall.className = def.className;
    }
    applyWallDefinitionStyles(wall, def);
    applyWallLighting(wall, def.key, context);
  }

  for (const [key, element] of Array.from(state.wallElements.entries())) {
    if (!activeKeys.has(key)) {
      element.remove();
      state.wallElements.delete(key);
    }
  }

  state.lastWallsMask = { ...context.walls };
  state.lastShowWalls = true;
  state.lastWallDimensions = nextDimensions;
  state.lastWallColor = context.wallColor;
}

function ensureWallsRoot(
  state: RenderState,
  documentRef: Document,
  root: HTMLElement
): HTMLElement {
  if (state.wallsContainer && root.contains(state.wallsContainer)) {
    return state.wallsContainer;
  }
  const container = documentRef.createElement("div");
  container.className = WALL_CONTAINER_CLASS;
  root.insertBefore(container, state.floor);
  state.wallsContainer = container;
  state.wallElements.clear();
  return container;
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
  const dataset = el.dataset;
  if (dataset.voxWallWidth !== width) {
    el.style.width = width;
    dataset.voxWallWidth = width;
  }
  if (dataset.voxWallHeight !== height) {
    el.style.height = height;
    dataset.voxWallHeight = height;
  }
  if (dataset.voxWallTransform !== def.transform) {
    el.style.transform = def.transform;
    dataset.voxWallTransform = def.transform;
  }
}

function applyWallLighting(el: HTMLElement, key: keyof WallsMask, context: GridContext): void {
  if (key !== "fr" && key !== "fl" && key !== "bl" && key !== "br") return;
  const dataset = el.dataset;
  const base = context.wallColor ?? DEFAULT_WALL_COLOR;
  if (dataset.voxWallBaseColor !== base) {
    dataset.voxWallBaseColor = base;
  }
  const shaded = shadeWallFace(base, key);
  if (dataset.voxWallShade !== shaded) {
    el.style.backgroundColor = shaded;
    dataset.voxWallShade = shaded;
  }
}

function snapshotWallDimensions(context: GridContext, depthLayers: number) {
  return {
    rows: Math.max(context.rows, 1),
    cols: Math.max(context.cols, 1),
    depth: Math.max(depthLayers, 1),
    tileSize: context.tileSize
  };
}

function wallDimensionsEqual(
  previous: RenderState["lastWallDimensions"],
  next: ReturnType<typeof snapshotWallDimensions>
): boolean {
  if (!previous) return false;
  return (
    previous.rows === next.rows &&
    previous.cols === next.cols &&
    previous.depth === next.depth &&
    previous.tileSize === next.tileSize
  );
}

function computeWallDefinitions(context: GridContext, depthLayers: number): WallDefinition[] {
  const tile = context.tileSize;
  const rows = Math.max(context.rows, 1);
  const cols = Math.max(context.cols, 1);
  const depth = Math.max(depthLayers, 1);
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
  detachDelegatedPointerHandlers(record);
  for (const [, element] of record.voxels) {
    disposeCubeDom(element);
    delete (element as any).__voxelData;
    element.remove();
  }
  record.voxels.clear();
  record.element.remove();
}

function updateDelegatedPointerHandlers(
  record: LayerRecord,
  emitPointer?: (payload: PointerEventPayload) => void
): void {
  const currentHandler = (record.element as any).__voxPointerHandler as ((event: PointerEvent) => void) | undefined;
  const currentEmit = (record.element as any).__voxPointerEmit as typeof emitPointer | undefined;

  if (!emitPointer) {
    if (currentHandler) {
      detachDelegatedPointerHandlers(record);
      delete (record.element as any).__voxPointerEmit;
    }
    return;
  }

  if (currentHandler && currentEmit === emitPointer) {
    return;
  }

  if (currentHandler) {
    detachDelegatedPointerHandlers(record);
  }

  const handler = (event: PointerEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const faceEl = target.closest<HTMLElement>(`.${FACE_CLASS}`);
    if (!faceEl) return;
    const faceClass = Array.from(faceEl.classList).find((cls) => cls.startsWith(`${FACE_CLASS}--`));
    const face = faceClass ? (faceClass.slice(`${FACE_CLASS}--`.length) as CubeFace) : undefined;
    if (!face) return;
    const voxelContainer = faceEl.closest<HTMLElement>(`.${VOXEL_CLASS}`);
    if (!voxelContainer) return;
    const voxel = (voxelContainer as any).__voxelData as Voxel | undefined;
    if (!voxel) return;
    emitPointer({
      voxelKey: makeVoxelKey(voxel),
      voxel,
      face,
      type: event.type,
      event
    });
  };
  (record.element as any).__voxPointerHandler = handler;
  (record.element as any).__voxPointerEmit = emitPointer;
  record.element.addEventListener("pointerdown", handler);
  record.element.addEventListener("pointerover", handler);
  record.element.addEventListener("pointerup", handler);
}

function detachDelegatedPointerHandlers(record: LayerRecord): void {
  const handler = (record.element as any).__voxPointerHandler;
  if (!handler) return;
  record.element.removeEventListener("pointerdown", handler);
  record.element.removeEventListener("pointerover", handler);
  record.element.removeEventListener("pointerup", handler);
  delete (record.element as any).__voxPointerHandler;
  delete (record.element as any).__voxPointerEmit;
}
