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
import { computeCubeFaceAppearance, getCubeFaceAppearanceSignature } from "./cubeFaceAppearance";
import { rgbaToPngBlob, rgbToPngBlob } from "./png";

interface DomRendererState {
  renderState: RenderState;
  prevStructure: StructureSnapshot | null;
  planeShell: PlaneShellDomState | null;
}

const rendererStates = new WeakMap<HTMLElement, DomRendererState>();

const noopRenderer: ShapeRenderer = () => {};
const DIMETRIC_PROJECTION_CLASS = "voxcss-projection--dimetric";

const PLANE_SHELL_MASK_LAYER_EPSILON_PX = 0.1;
const PLANE_SHELL_MASK_BASE_DETAIL_MIN_BASE_FRACTION = 0.7;
const PLANE_SHELL_MASK_BASE_DETAIL_MAX_DETAIL_BBOX_RATIO = 0.5;
const PLANE_SHELL_MASK_BASE_DETAIL_MAX_BASE_RECTS = 16;
const PLANE_SHELL_MASK_BASE_SPRITE_MIN_BASE_RECTS = 4;
const PLANE_SHELL_MASK_FULL_SPRITE_REPLACE_MIN_TOTAL_RECTS = 16;
const PLANE_SHELL_MASK_OPAQUE_HOLES_MAX_RECTS = 16;
const PLANE_SHELL_MASK_TILE_TARGET_PX = 768;
const PLANE_SHELL_MASK_DOM_QUAD_PENALTY_FACTOR = 0.12;
const PLANE_SHELL_MASK_TILING_MARGIN_PENALTY_FRACTION = 0.25;
const PLANE_SHELL_MASK_ALPHA_TAX_HOLES_FACTOR = 0.5;
const PLANE_SHELL_MASK_TILING_MIN_AREA_CELLS = 4_096;
const PLANE_SHELL_MASK_TILE_MIN_CELLS = 8;
const PLANE_SHELL_MASK_TILE_MAX_CELLS = 64;
const PLANE_SHELL_MASK_FULL_SPRITE_TILE_MAX_FILL_RATIO_Z = 0.55;
const PLANE_SHELL_MASK_FULL_SPRITE_TILE_MAX_FILL_RATIO_XY = 0.65;
const PLANE_SHELL_MASK_FULL_SPRITE_TILE_MAX_COUNT_Z = 24;
const PLANE_SHELL_MASK_FULL_SPRITE_TILE_MAX_COUNT_XY = 32;
const PLANE_SHELL_MASK_FULL_SPRITE_TILE_MAX_FILLED_CELLS = 200_000;
const PLANE_SHELL_MASK_DETAIL_SPRITE_TILE_MAX_COUNT_Z = 32;
const PLANE_SHELL_MASK_DETAIL_SPRITE_TILE_MAX_COUNT_XY = 64;

function computeDomQuadPenaltyPx(): number {
  return Math.round(PLANE_SHELL_MASK_TILE_TARGET_PX * PLANE_SHELL_MASK_TILE_TARGET_PX * PLANE_SHELL_MASK_DOM_QUAD_PENALTY_FACTOR);
}

function applyPlaneShellHostGrid(
  hosts: Pick<PlaneShellDomState, "zHost" | "xHost" | "yHost">,
  layout: { rows: number; cols: number; depth: number; tileSize: number; layerElevation: number }
): void {
  const { rows, cols, depth, tileSize, layerElevation } = layout;
  hosts.xHost.style.width = `${cols * tileSize}px`;
  hosts.xHost.style.height = `${depth * layerElevation}px`;
  hosts.yHost.style.width = `${depth * layerElevation}px`;
  hosts.yHost.style.height = `${rows * tileSize}px`;

  hosts.zHost.style.display = "grid";
  hosts.zHost.style.gridTemplateColumns = `repeat(${cols}, ${tileSize}px)`;
  hosts.zHost.style.gridTemplateRows = `repeat(${rows}, ${tileSize}px)`;

  hosts.xHost.style.display = "grid";
  hosts.xHost.style.gridTemplateColumns = `repeat(${cols}, ${tileSize}px)`;
  hosts.xHost.style.gridTemplateRows = `repeat(${depth}, ${layerElevation}px)`;

  hosts.yHost.style.display = "grid";
  hosts.yHost.style.gridTemplateColumns = `repeat(${depth}, ${layerElevation}px)`;
  hosts.yHost.style.gridTemplateRows = `repeat(${rows}, ${tileSize}px)`;
}

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

export type SceneRenderMode = "cubes" | "plane-shell-mask";

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
    root.style.setProperty("--voxcss-rows", String(context.rows));
    root.style.setProperty("--voxcss-cols", String(context.cols));
  }

  if (renderMode === "plane-shell-mask") {
    if (renderState.layers.size) {
      resetLayers(renderState);
    }
    renderPlaneShellMask(state, snapshot, documentRef);
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

function resetLayers(state: RenderState): void {
  for (const [, record] of state.layers) {
    removeLayerRecord(record);
  }
  state.layers.clear();
}

interface PlaneShellDomState {
  zHost: HTMLElement;
  xHost: HTMLElement;
  yHost: HTMLElement;
  zMaskAnchor: Comment;
  xMaskAnchor: Comment;
  yMaskAnchor: Comment;
  zPool: HTMLElement[];
  xPool: HTMLElement[];
  yPool: HTMLElement[];
  zMaskPool: HTMLElement[];
  xMaskPool: HTMLElement[];
  yMaskPool: HTMLElement[];
  meshLayers: Voxel[][] | null;
  mesh: PlaneShellMesh | null;
  maskLayers: Voxel[][] | null;
  maskLighting: GridContext["lighting"] | null;
  maskTileSize: number;
  maskLayerElevation: number;
  maskRows: number;
  maskCols: number;
  maskDepth: number;
  maskUnsupported: boolean;
  mask: PlaneShellMaskMesh | null;
}

interface FaceCellGroup {
  face: CubeFace;
  voxel: Voxel;
  cells: Set<number>;
}

interface Rect {
  x: number;
  y: number;
  x2: number;
  y2: number;
}

interface PlaneShellMeshGroup {
  face: CubeFace;
  voxel: Voxel;
  rects: Rect[];
}

interface PlaneShellMeshPlane {
  axis: "x" | "y" | "z";
  plane: number;
  groups: PlaneShellMeshGroup[];
}

interface PlaneShellMesh {
  rows: number;
  cols: number;
  depth: number;
  planes: PlaneShellMeshPlane[];
}

interface PlaneShellMaskMeshFace {
  face: CubeFace;
  layer?: number;
  url: string | null;
  backgroundImage: string;
  backgroundColor: string;
  gridArea: string;
  rowStart: number;
  colStart: number;
  rowEnd: number;
  colEnd: number;
  tiles: Array<{ gridArea: string; offsetRow: number; offsetCol: number }>;
}

interface PlaneShellMaskMeshPlane {
  axis: "x" | "y" | "z";
  plane: number;
  faces: PlaneShellMaskMeshFace[];
}

interface PlaneShellMaskMesh {
  rows: number;
  cols: number;
  depth: number;
  planes: PlaneShellMaskMeshPlane[];
}

function ensurePlaneShellMaskAnchors(hosts: PlaneShellDomState): void {
  const ensure = (
    host: HTMLElement,
    anchor: Comment,
    maskPool: HTMLElement[]
  ): void => {
    if (anchor.parentNode === host) return;
    if (anchor.parentNode) anchor.remove();
    const firstMask = maskPool.find((quad) => quad?.parentElement === host) ?? null;
    if (firstMask) host.insertBefore(anchor, firstMask);
    else host.appendChild(anchor);
  };
  ensure(hosts.zHost, hosts.zMaskAnchor, hosts.zMaskPool);
  ensure(hosts.xHost, hosts.xMaskAnchor, hosts.xMaskPool);
  ensure(hosts.yHost, hosts.yMaskAnchor, hosts.yMaskPool);
}

function ensurePlaneShellHosts(state: DomRendererState, documentRef: Document): PlaneShellDomState {
  const existing = state.planeShell;
  const root = state.renderState.root;
  const floor = state.renderState.floor;
  if (existing) {
    if (existing.xHost.parentElement !== root) {
      root.appendChild(existing.xHost);
    }
    if (existing.yHost.parentElement !== root) {
      root.appendChild(existing.yHost);
    }
    if (existing.zHost !== floor) {
      existing.zHost = floor;
    }
    ensurePlaneShellMaskAnchors(existing);
    return existing;
  }

  const xHost = documentRef.createElement("div");
  xHost.className = "voxcss-floor-x";

  const yHost = documentRef.createElement("div");
  yHost.className = "voxcss-floor-y";

  root.appendChild(xHost);
  root.appendChild(yHost);

  const zMaskAnchor = documentRef.createComment("voxcss:plane-shell-mask-anchor:z");
  const xMaskAnchor = documentRef.createComment("voxcss:plane-shell-mask-anchor:x");
  const yMaskAnchor = documentRef.createComment("voxcss:plane-shell-mask-anchor:y");
  floor.appendChild(zMaskAnchor);
  xHost.appendChild(xMaskAnchor);
  yHost.appendChild(yMaskAnchor);

  const composed: PlaneShellDomState = {
    zHost: floor,
    xHost,
    yHost,
    zMaskAnchor,
    xMaskAnchor,
    yMaskAnchor,
    zPool: [],
    xPool: [],
    yPool: [],
    zMaskPool: [],
    xMaskPool: [],
    yMaskPool: [],
    meshLayers: null,
    mesh: null,
    maskLayers: null,
    maskLighting: null,
    maskTileSize: 0,
    maskLayerElevation: 0,
    maskRows: 0,
    maskCols: 0,
    maskDepth: 0,
    maskUnsupported: false,
    mask: null
  };
  state.planeShell = composed;
  return composed;
}

function resetPlaneShellHostGrid(host: HTMLElement): void {
  host.style.removeProperty("display");
  host.style.removeProperty("grid-template-columns");
  host.style.removeProperty("grid-template-rows");
}

function clearPlaneShell(state: DomRendererState): void {
  const planeShell = state.planeShell;
  if (!planeShell) return;
  disposePlaneShellMask(planeShell);
  planeShell.zPool.length = 0;
  planeShell.xPool.length = 0;
  planeShell.yPool.length = 0;
  planeShell.zMaskPool.length = 0;
  planeShell.xMaskPool.length = 0;
  planeShell.yMaskPool.length = 0;
  planeShell.zHost.innerHTML = "";
  resetPlaneShellHostGrid(planeShell.zHost);
  planeShell.xHost.remove();
  planeShell.yHost.remove();
  state.planeShell = null;
}

function disposePlaneShellMask(hosts: PlaneShellDomState): void {
  if (!hosts.mask) {
    hosts.maskUnsupported = false;
    return;
  }
  if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
    for (const plane of hosts.mask.planes) {
      for (const face of plane.faces) {
        if (face.url) URL.revokeObjectURL(face.url);
      }
    }
  }
  hosts.mask = null;
  hosts.maskUnsupported = false;
}

function getAppearanceColorKey(
  voxel: Voxel,
  face: CubeFace,
  context: GridContext
): { key: string; r: number; g: number; b: number; alpha: number } | null {
  const appearance = computeCubeFaceAppearance(voxel, face, context);
  if (appearance.backgroundImage) return null;
  const brightness = parseBrightnessFilter(appearance.filter);
  if (brightness === null) return null;
  const parsed = parseColor(appearance.backgroundColor);
  if (!parsed) return null;
  const alpha = clampByte(parsed.alpha * 255);
  const r = clampByte(parsed.r * brightness);
  const g = clampByte(parsed.g * brightness);
  const b = clampByte(parsed.b * brightness);
  return { key: `${r},${g},${b},${alpha}`, r, g, b, alpha };
}

function renderPlaneShellMask(state: DomRendererState, snapshot: SceneSnapshot, documentRef: Document): void {
  const hosts = ensurePlaneShellHosts(state, documentRef);

  const rows = Math.max(snapshot.context.rows, 1);
  const cols = Math.max(snapshot.context.cols, 1);
  const depth = Math.max(snapshot.layers.length, 0);
  const lighting = snapshot.context.lighting ?? null;
  const tileSize = snapshot.context.tileSize ?? 50;
  const layerElevation = snapshot.context.layerElevation ?? tileSize;

  const meshNeedsRebuild =
    !hosts.mesh ||
    hosts.meshLayers !== snapshot.layers ||
    hosts.mesh.rows !== rows ||
    hosts.mesh.cols !== cols ||
    hosts.mesh.depth !== depth;
  let sharedGroupsResult: PlaneShellGroupsResult | null = null;
  if (meshNeedsRebuild) {
    sharedGroupsResult = buildPlaneShellGroups(snapshot);
    hosts.mesh = buildPlaneShellMeshFromGroups(sharedGroupsResult);
    hosts.meshLayers = snapshot.layers;
  }
  const mesh = hosts.mesh;
  if (!mesh) return;

  const overlayFaces = new Set<string>();
  const overlayBaseKeyByFace = new Map<string, string>();
  const overlayBaseRectCountByFace = new Map<string, number>();
  const totalRectCountByFace = new Map<string, number>();
  const unsupportedFaces = new Set<string>();

  for (const plane of mesh.planes) {
    const axis = plane.axis;
    const planeIndex = plane.plane;
    const faceTotals = new Map<CubeFace, number>();
    const faceBbox = new Map<CubeFace, { minRow: number; minCol: number; maxRow: number; maxCol: number }>();
    const faceColorCounts = new Map<CubeFace, Map<string, number>>();
    const faceColorRectCounts = new Map<CubeFace, Map<string, number>>();
    const faceColorBboxes = new Map<CubeFace, Map<string, { minRow: number; minCol: number; maxRow: number; maxCol: number }>>();
    const faceAllOpaque = new Map<CubeFace, boolean>();

    for (const group of plane.groups) {
      const faceKey = `${axis}:${planeIndex}:${group.face}`;
      const keyInfo = getAppearanceColorKey(group.voxel, group.face, snapshot.context);
      if (!keyInfo) {
        unsupportedFaces.add(faceKey);
        continue;
      }
      const { key, alpha } = keyInfo;
      if (alpha !== 255) {
        faceAllOpaque.set(group.face, false);
      } else if (!faceAllOpaque.has(group.face)) {
        faceAllOpaque.set(group.face, true);
      }

      let area = 0;
      let rectCount = 0;
      for (const rect of group.rects) {
        area += (rect.x2 - rect.x) * (rect.y2 - rect.y);
        rectCount += 1;
        const bbox = faceBbox.get(group.face);
        if (!bbox) {
          faceBbox.set(group.face, { minRow: rect.x, minCol: rect.y, maxRow: rect.x2, maxCol: rect.y2 });
        } else {
          if (rect.x < bbox.minRow) bbox.minRow = rect.x;
          if (rect.y < bbox.minCol) bbox.minCol = rect.y;
          if (rect.x2 > bbox.maxRow) bbox.maxRow = rect.x2;
          if (rect.y2 > bbox.maxCol) bbox.maxCol = rect.y2;
        }
        let perColor = faceColorBboxes.get(group.face);
        if (!perColor) {
          perColor = new Map();
          faceColorBboxes.set(group.face, perColor);
        }
        const colorBox = perColor.get(key);
        if (!colorBox) {
          perColor.set(key, { minRow: rect.x, minCol: rect.y, maxRow: rect.x2, maxCol: rect.y2 });
        } else {
          if (rect.x < colorBox.minRow) colorBox.minRow = rect.x;
          if (rect.y < colorBox.minCol) colorBox.minCol = rect.y;
          if (rect.x2 > colorBox.maxRow) colorBox.maxRow = rect.x2;
          if (rect.y2 > colorBox.maxCol) colorBox.maxCol = rect.y2;
        }
      }

      if (area <= 0) continue;
      faceTotals.set(group.face, (faceTotals.get(group.face) ?? 0) + area);
      totalRectCountByFace.set(faceKey, (totalRectCountByFace.get(faceKey) ?? 0) + rectCount);
      let colorCounts = faceColorCounts.get(group.face);
      if (!colorCounts) {
        colorCounts = new Map();
        faceColorCounts.set(group.face, colorCounts);
      }
      colorCounts.set(key, (colorCounts.get(key) ?? 0) + area);

      let colorRectCounts = faceColorRectCounts.get(group.face);
      if (!colorRectCounts) {
        colorRectCounts = new Map();
        faceColorRectCounts.set(group.face, colorRectCounts);
      }
      colorRectCounts.set(key, (colorRectCounts.get(key) ?? 0) + rectCount);
    }

    for (const [face, total] of faceTotals.entries()) {
      if (total <= 0) continue;
      if (faceAllOpaque.get(face) !== true) continue;
      const colorCounts = faceColorCounts.get(face);
      const colorRectCounts = faceColorRectCounts.get(face);
      const bbox = faceBbox.get(face);
      const perColorBboxes = faceColorBboxes.get(face);
      if (!colorCounts || colorCounts.size <= 1 || !bbox || !perColorBboxes || !colorRectCounts) continue;

      let baseKey: string | null = null;
      let baseCount = 0;
      for (const [key, count] of colorCounts.entries()) {
        if (!baseKey || count > baseCount || (count === baseCount && key < baseKey)) {
          baseKey = key;
          baseCount = count;
        }
      }
      if (!baseKey) continue;
      const baseFraction = baseCount / total;
      if (baseFraction < PLANE_SHELL_MASK_BASE_DETAIL_MIN_BASE_FRACTION) continue;
      const baseRectCount = colorRectCounts.get(baseKey) ?? 0;

      let detailMinRow = Number.POSITIVE_INFINITY;
      let detailMinCol = Number.POSITIVE_INFINITY;
      let detailMaxRow = -1;
      let detailMaxCol = -1;
      let detailHasAny = false;
      for (const [key, box] of perColorBboxes.entries()) {
        if (key === baseKey) continue;
        detailHasAny = true;
        if (box.minRow < detailMinRow) detailMinRow = box.minRow;
        if (box.minCol < detailMinCol) detailMinCol = box.minCol;
        if (box.maxRow > detailMaxRow) detailMaxRow = box.maxRow;
        if (box.maxCol > detailMaxCol) detailMaxCol = box.maxCol;
      }
      if (!detailHasAny) continue;
      if (!Number.isFinite(detailMinRow) || !Number.isFinite(detailMinCol) || detailMaxRow <= 0 || detailMaxCol <= 0) {
        continue;
      }
      const faceBBoxArea = (bbox.maxRow - bbox.minRow) * (bbox.maxCol - bbox.minCol);
      const detailBBoxArea = (detailMaxRow - detailMinRow) * (detailMaxCol - detailMinCol);
      if (faceBBoxArea <= 0 || detailBBoxArea <= 0) continue;
      const detailRatio = detailBBoxArea / faceBBoxArea;
      if (detailRatio > PLANE_SHELL_MASK_BASE_DETAIL_MAX_DETAIL_BBOX_RATIO) continue;

      const faceKey = `${axis}:${planeIndex}:${face}`;
      if (unsupportedFaces.has(faceKey)) continue;
      overlayFaces.add(faceKey);
      overlayBaseKeyByFace.set(faceKey, baseKey);
      overlayBaseRectCountByFace.set(faceKey, baseRectCount);
    }
  }

  const replaceFaces = new Set<string>();
  for (const [faceKey, rectCount] of totalRectCountByFace.entries()) {
    if (rectCount >= PLANE_SHELL_MASK_FULL_SPRITE_REPLACE_MIN_TOTAL_RECTS && !unsupportedFaces.has(faceKey)) {
      replaceFaces.add(faceKey);
    }
  }

  const overlayOnlyFaces = new Set<string>();
  const overlayBaseKeyByFaceEffective = new Map<string, string>();
  const overlayBaseRectCountByFaceEffective = new Map<string, number>();
  for (const faceKey of overlayFaces) {
    if (replaceFaces.has(faceKey)) continue;
    overlayOnlyFaces.add(faceKey);
    const baseKey = overlayBaseKeyByFace.get(faceKey);
    if (baseKey) overlayBaseKeyByFaceEffective.set(faceKey, baseKey);
    overlayBaseRectCountByFaceEffective.set(faceKey, overlayBaseRectCountByFace.get(faceKey) ?? 0);
  }

  const depsChanged =
    hosts.maskLayers !== snapshot.layers ||
    hosts.maskLighting !== lighting ||
    hosts.maskTileSize !== tileSize ||
    hosts.maskLayerElevation !== layerElevation ||
    hosts.maskRows !== rows ||
    hosts.maskCols !== cols ||
    hosts.maskDepth !== depth;
  if (depsChanged) {
    disposePlaneShellMask(hosts);
    hosts.maskLayers = snapshot.layers;
    hosts.maskLighting = lighting;
    hosts.maskTileSize = tileSize;
    hosts.maskLayerElevation = layerElevation;
    hosts.maskRows = rows;
    hosts.maskCols = cols;
    hosts.maskDepth = depth;
    hosts.maskUnsupported = false;
  }

  const needsMaskFaces = overlayOnlyFaces.size > 0 || replaceFaces.size > 0;
  if (!needsMaskFaces) {
    disposePlaneShellMask(hosts);
    renderPlaneShellAxisHost(hosts, mesh, snapshot, documentRef);
    renderPlaneShellAxisHostMask(hosts, null, snapshot, documentRef);
    return;
  }

  const baseSpriteFaces = new Set<string>();
  const detailOnlyFaces = new Set<string>();
  for (const faceKey of overlayOnlyFaces) {
    const baseRectCount = overlayBaseRectCountByFaceEffective.get(faceKey) ?? 0;
    if (baseRectCount >= PLANE_SHELL_MASK_BASE_SPRITE_MIN_BASE_RECTS) {
      baseSpriteFaces.add(faceKey);
    } else {
      detailOnlyFaces.add(faceKey);
    }
  }

  const skipBaseFaces = new Set<string>([...replaceFaces, ...baseSpriteFaces]);
  renderPlaneShellAxisHost(hosts, mesh, snapshot, documentRef, skipBaseFaces, overlayBaseKeyByFaceEffective);

  if (!hosts.mask && !hosts.maskUnsupported) {
    const maskFaces = new Set<string>([...replaceFaces, ...overlayOnlyFaces]);
    const built = buildPlaneShellMaskMesh(snapshot, {
      onlyFaces: maskFaces,
      detailOnlyFaces,
      baseKeyByFace: overlayBaseKeyByFaceEffective,
      baseAsSpriteFaces: baseSpriteFaces,
      groupsResult: sharedGroupsResult ?? undefined
    });
    if (built && built.planes.length) {
      hosts.mask = built;
    } else {
      hosts.maskUnsupported = true;
    }
  }

  if (hosts.mask) {
    renderPlaneShellAxisHostMask(hosts, hosts.mask, snapshot, documentRef);
  } else {
    renderPlaneShellAxisHostMask(hosts, null, snapshot, documentRef);
  }
}

function packCellKey(x: number, y: number, stride: number): number {
  return x * stride + y;
}

function mergePackedCells(cells: Set<number>, stride: number): Rect[] {
  const keys = Array.from(cells.values());
  keys.sort((a, b) => {
    const ay = a % stride;
    const by = b % stride;
    if (ay !== by) return ay - by;
    return Math.floor(a / stride) - Math.floor(b / stride);
  });

  const visited = new Set<number>();
  const hasCell = (x: number, y: number): boolean => {
    const key = packCellKey(x, y, stride);
    if (visited.has(key)) return false;
    return cells.has(key);
  };

  const rects: Rect[] = [];

  for (const startKey of keys) {
    if (visited.has(startKey)) continue;
    if (!cells.has(startKey)) continue;
    const x = Math.floor(startKey / stride);
    const y = startKey - x * stride;

    let width = 1;
    while (hasCell(x + width, y)) {
      width += 1;
    }

    let height = 1;
    let canGrow = true;
    while (canGrow) {
      const nextY = y + height;
      for (let dx = 0; dx < width; dx += 1) {
        if (!hasCell(x + dx, nextY)) {
          canGrow = false;
          break;
        }
      }
      if (canGrow) {
        height += 1;
      }
    }

    for (let dx = 0; dx < width; dx += 1) {
      const rowBase = (x + dx) * stride;
      for (let dy = 0; dy < height; dy += 1) {
        visited.add(rowBase + (y + dy));
      }
    }

    rects.push({
      x,
      y,
      x2: x + width,
      y2: y + height
    });
  }

  return rects;
}

function mergeAdjacentRects(rects: Rect[]): Rect[] {
  if (rects.length <= 1) return rects;

  const mergeByKey = (
    input: Rect[],
    keyFor: (rect: Rect) => string,
    compare: (a: Rect, b: Rect) => number,
    canMerge: (current: Rect, next: Rect) => boolean,
    mergeInto: (current: Rect, next: Rect) => void
  ): Rect[] => {
    const grouped = new Map<string, Rect[]>();
    for (const rect of input) {
      const key = keyFor(rect);
      const bucket = grouped.get(key);
      if (bucket) bucket.push(rect);
      else grouped.set(key, [rect]);
    }

    const merged: Rect[] = [];
    for (const bucket of grouped.values()) {
      bucket.sort(compare);
      let current = bucket[0];
      for (let i = 1; i < bucket.length; i += 1) {
        const next = bucket[i];
        if (current && next && canMerge(current, next)) {
          mergeInto(current, next);
          continue;
        }
        if (current) merged.push(current);
        current = next;
      }
      if (current) merged.push(current);
    }
    return merged;
  };

  let merged = rects.slice();
  let changed = true;
  while (changed) {
    changed = false;
    const before = merged.length;
    merged = mergeByKey(
      merged,
      (rect) => `${rect.y}:${rect.y2}`,
      (a, b) => (a.x !== b.x ? a.x - b.x : a.x2 - b.x2),
      (current, next) => current.x2 === next.x,
      (current, next) => {
        current.x2 = next.x2;
      }
    );
    if (merged.length !== before) changed = true;

    const beforeVertical = merged.length;
    merged = mergeByKey(
      merged,
      (rect) => `${rect.x}:${rect.x2}`,
      (a, b) => (a.y !== b.y ? a.y - b.y : a.y2 - b.y2),
      (current, next) => current.y2 === next.y,
      (current, next) => {
        current.y2 = next.y2;
      }
    );
    if (merged.length !== beforeVertical) changed = true;
  }

  merged.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));
  return merged;
}

function buildPlaneShellGroups(snapshot: SceneSnapshot): {
  context: GridContext;
  tileSize: number;
  layerElevation: number;
  rows: number;
  cols: number;
  depth: number;
  groupsByPlane: Map<string, Map<string, FaceCellGroup>>;
} {
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

  const offsets = context.offsets;

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

  const groupsByPlane = new Map<string, Map<string, FaceCellGroup>>();
  const strideByAxis: Record<"x" | "y" | "z", number> = {
    z: cols + 1,
    x: cols + 1,
    y: depth + 1
  };

  const addFaceCell = (
    axis: "x" | "y" | "z",
    plane: number,
    face: CubeFace,
    voxel: Voxel,
    x: number,
    y: number
  ): void => {
    const planeKey = `${axis}:${plane}`;
    let groups = groupsByPlane.get(planeKey);
    if (!groups) {
      groups = new Map<string, FaceCellGroup>();
      groupsByPlane.set(planeKey, groups);
    }
    const sig = getSignature(voxel, face);
    const groupKey = `${face}\n${sig}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { face, voxel, cells: new Set<number>() };
      groups.set(groupKey, group);
    }
    group.cells.add(packCellKey(x, y, strideByAxis[axis]));
  };

  for (const [key, voxel] of occupied.entries()) {
    const z = Math.floor(key / strideXY);
    const rem = key - z * strideXY;
    const x = Math.floor(rem / cols);
    const y = rem - x * cols;

    for (const face of CUBE_FACES) {
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

  return { context, tileSize, layerElevation, rows, cols, depth, groupsByPlane };
}

type PlaneShellGroupsResult = ReturnType<typeof buildPlaneShellGroups>;

function buildPlaneShellMeshFromGroups({ rows, cols, depth, groupsByPlane }: PlaneShellGroupsResult): PlaneShellMesh {
  const planeKeys = Array.from(groupsByPlane.keys());
  planeKeys.sort((a, b) => {
    const [axisA, planeA] = a.split(":");
    const [axisB, planeB] = b.split(":");
    if (axisA !== axisB) return axisA < axisB ? -1 : 1;
    return Number(planeA) - Number(planeB);
  });

  const planes: PlaneShellMeshPlane[] = [];

  for (const planeKey of planeKeys) {
    const groups = groupsByPlane.get(planeKey);
    if (!groups) continue;
    const [axisRaw, planeRaw] = planeKey.split(":");
    const axis = axisRaw as "x" | "y" | "z";
    const plane = Number(planeRaw);
    const groupKeys = Array.from(groups.keys());
    groupKeys.sort();
    const planeGroups: PlaneShellMeshGroup[] = [];
    for (const groupKey of groupKeys) {
      const group = groups.get(groupKey);
      if (!group) continue;
      const stride = axis === "y" ? depth + 1 : cols + 1;
      let rects = mergePackedCells(group.cells, stride);
      if (rects.length >= 32) {
        rects = mergeAdjacentRects(rects);
      }
      planeGroups.push({ face: group.face, voxel: group.voxel, rects });
    }
    planes.push({ axis, plane, groups: planeGroups });
  }

  return { rows, cols, depth, planes };
}

type ParsedColor = { r: number; g: number; b: number; alpha: number };

function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 255) return 255;
  return Math.round(value);
}

function parseBrightnessFilter(value: string): number | null {
  const raw = value.trim();
  if (!raw) return 1;
  const match = raw.match(/^brightness\(\s*([^)]+)\s*\)$/i);
  if (!match) return null;
  const body = (match[1] ?? "").trim();
  if (!body) return null;
  if (body.endsWith("%")) {
    const pct = Number(body.slice(0, -1));
    if (!Number.isFinite(pct)) return null;
    return pct / 100;
  }
  const factor = Number(body);
  if (!Number.isFinite(factor)) return null;
  return factor;
}

function parseColor(value: string): ParsedColor | null {
  const raw = value.trim();
  if (!raw) return null;
  if (raw === "transparent") return { r: 0, g: 0, b: 0, alpha: 0 };

  if (raw.startsWith("#")) {
    const hex = raw.slice(1);
    const hexByte = (pair: string): number | null => {
      if (pair.length !== 2) return null;
      const parsed = Number.parseInt(pair, 16);
      if (!Number.isFinite(parsed)) return null;
      return Math.max(0, Math.min(255, parsed));
    };
    const hexNibble = (ch: string): number | null => {
      if (ch.length !== 1) return null;
      const parsed = Number.parseInt(ch, 16);
      if (!Number.isFinite(parsed)) return null;
      return Math.max(0, Math.min(15, parsed));
    };

    if (hex.length === 3 || hex.length === 4) {
      const r = hexNibble(hex[0] ?? "");
      const g = hexNibble(hex[1] ?? "");
      const b = hexNibble(hex[2] ?? "");
      if (r === null || g === null || b === null) return null;
      const a = hex.length === 4 ? hexNibble(hex[3] ?? "") : 15;
      if (a === null) return null;
      return { r: r * 17, g: g * 17, b: b * 17, alpha: a / 15 };
    }

    if (hex.length === 6 || hex.length === 8) {
      const r = hexByte(hex.slice(0, 2));
      const g = hexByte(hex.slice(2, 4));
      const b = hexByte(hex.slice(4, 6));
      if (r === null || g === null || b === null) return null;
      let alpha = 1;
      if (hex.length === 8) {
        const a = hexByte(hex.slice(6, 8));
        if (a === null) return null;
        alpha = a / 255;
      }
      return { r, g, b, alpha };
    }
  }

  const rgba = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+)\s*)?\)$/i);
  if (rgba) {
    const r = Number(rgba[1]);
    const g = Number(rgba[2]);
    const b = Number(rgba[3]);
    const aRaw = rgba[4] !== undefined ? Number(rgba[4]) : 1;
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b) || !Number.isFinite(aRaw)) return null;
    const alpha = Math.max(0, Math.min(1, aRaw));
    return { r: clampByte(r), g: clampByte(g), b: clampByte(b), alpha };
  }

  return null;
}

function buildPlaneShellMaskMesh(
  snapshot: SceneSnapshot,
  options?: {
    onlyFaces?: Set<string>;
    detailOnly?: boolean;
    detailOnlyFaces?: Set<string>;
    baseKeyByFace?: Map<string, string>;
    baseAsSpriteFaces?: Set<string>;
    groupsResult?: PlaneShellGroupsResult;
  }
): PlaneShellMaskMesh | null {
  if (typeof Blob === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
    return null;
  }

  const onlyFaces = options?.onlyFaces ?? null;
  const detailOnly = options?.detailOnly ?? false;
  const detailOnlyFaces = options?.detailOnlyFaces ?? null;
  const baseKeyByFace = options?.baseKeyByFace ?? null;
  const baseAsSpriteFaces = options?.baseAsSpriteFaces ?? null;

  const groupsResult = options?.groupsResult ?? buildPlaneShellGroups(snapshot);
  const { rows, cols, depth, groupsByPlane } = groupsResult;
  const planeKeys = Array.from(groupsByPlane.keys());
  planeKeys.sort((a, b) => {
    const [axisA, planeA] = a.split(":");
    const [axisB, planeB] = b.split(":");
    if (axisA !== axisB) return axisA < axisB ? -1 : 1;
    return Number(planeA) - Number(planeB);
  });

  const context = snapshot.context;
  const planes: PlaneShellMaskMeshPlane[] = [];
  const urls: string[] = [];

  const fail = (): null => {
    if (typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
      for (const url of urls) URL.revokeObjectURL(url);
    }
    return null;
  };

  for (const planeKey of planeKeys) {
    const groups = groupsByPlane.get(planeKey);
    if (!groups) continue;
    const [axisRaw, planeRaw] = planeKey.split(":");
    const axis = axisRaw as "x" | "y" | "z";
    const plane = Number(planeRaw);

    const stride = axis === "y" ? depth + 1 : cols + 1;
    const width = axis === "z" || axis === "x" ? cols : depth;
    const height = axis === "z" || axis === "y" ? rows : depth;
    if (width <= 0 || height <= 0) continue;

    const groupsByFace = new Map<CubeFace, FaceCellGroup[]>();
    for (const group of groups.values()) {
      if (!group) continue;
      const bucket = groupsByFace.get(group.face);
      if (bucket) {
        bucket.push(group);
      } else {
        groupsByFace.set(group.face, [group]);
      }
    }

    const faces = Array.from(groupsByFace.keys());
    faces.sort();

    const faceSprites: PlaneShellMaskMeshFace[] = [];

    for (const face of faces) {
      const faceKey = `${axis}:${plane}:${face}`;
      if (onlyFaces && !onlyFaces.has(faceKey)) continue;
      const isDetailOnly = detailOnlyFaces ? detailOnlyFaces.has(faceKey) : detailOnly;
      const baseAsSprite = Boolean(baseAsSpriteFaces?.has(faceKey));
      const faceGroups = groupsByFace.get(face);
      if (!faceGroups?.length) continue;

      type PaintGroup = { cells: Set<number>; r: number; g: number; b: number; alpha: number };
      const paintGroups: PaintGroup[] = [];
      let allOpaque = true;
      let faceSupported = true;

      for (const group of faceGroups) {
        const appearance = computeCubeFaceAppearance(group.voxel, face, context);
        if (appearance.backgroundImage) {
          faceSupported = false;
          break;
        }
        const brightness = parseBrightnessFilter(appearance.filter);
        if (brightness === null) {
          faceSupported = false;
          break;
        }
        const parsed = parseColor(appearance.backgroundColor);
        if (!parsed) {
          faceSupported = false;
          break;
        }
        const alpha = clampByte(parsed.alpha * 255);
        if (alpha <= 0) continue;
        if (alpha !== 255) allOpaque = false;
        const r = clampByte(parsed.r * brightness);
        const g = clampByte(parsed.g * brightness);
        const b = clampByte(parsed.b * brightness);
        paintGroups.push({ cells: group.cells, r, g, b, alpha });
      }

      if (!faceSupported) continue;
      if (!paintGroups.length) continue;

      let minRow = Number.POSITIVE_INFINITY;
      let minCol = Number.POSITIVE_INFINITY;
      let maxRow = -1;
      let maxCol = -1;
      let fillCount = 0;
      const colorCounts = new Map<string, number>();
      const maxOpaqueMaskCells = PLANE_SHELL_MASK_FULL_SPRITE_TILE_MAX_FILLED_CELLS;
      let opaqueCells: Set<number> | null = allOpaque ? new Set<number>() : null;

      for (const group of paintGroups) {
        const colorKey = `${group.r},${group.g},${group.b},${group.alpha}`;
        for (const cellKey of group.cells) {
          if (cellKey < 0) continue;
          const row = Math.floor(cellKey / stride);
          const col = cellKey - row * stride;
          if (row <= 0 || col <= 0) continue;
          if (row > height || col > width) continue;
          fillCount += 1;
          colorCounts.set(colorKey, (colorCounts.get(colorKey) ?? 0) + 1);
          if (opaqueCells) {
            opaqueCells.add(cellKey);
            if (opaqueCells.size > maxOpaqueMaskCells) {
              opaqueCells = null;
            }
          }
          if (row < minRow) minRow = row;
          if (col < minCol) minCol = col;
          if (row > maxRow) maxRow = row;
          if (col > maxCol) maxCol = col;
        }
      }

      if (!Number.isFinite(minRow) || !Number.isFinite(minCol) || maxRow < 0 || maxCol < 0) continue;
      if (maxRow < minRow || maxCol < minCol) continue;

      const rowStart = minRow;
      const colStart = minCol;
      const rowEnd = maxRow + 1;
      const colEnd = maxCol + 1;

      const cropWidth = maxCol - minCol + 1;
      const cropHeight = maxRow - minRow + 1;
      if (cropWidth <= 0 || cropHeight <= 0) continue;
      const bboxArea = cropWidth * cropHeight;
      if (bboxArea <= 0) continue;
      const isFullyFilled = fillCount === bboxArea;

      if (isFullyFilled && colorCounts.size === 1) {
        const group = paintGroups[0];
        if (!group) continue;
        const alpha = group.alpha;
        const cssColor =
          alpha === 255
            ? `rgb(${group.r}, ${group.g}, ${group.b})`
            : `rgba(${group.r}, ${group.g}, ${group.b}, ${Math.round((alpha / 255) * 1000) / 1000})`;
        faceSprites.push({
          face,
          url: null,
          backgroundImage: "",
          backgroundColor: cssColor,
          gridArea: `${rowStart} / ${colStart} / ${rowEnd} / ${colEnd}`,
          rowStart,
          colStart,
          rowEnd,
          colEnd,
          tiles: [{ gridArea: `${rowStart} / ${colStart} / ${rowEnd} / ${colEnd}`, offsetRow: 0, offsetCol: 0 }]
        });
        continue;
      }

      if (allOpaque && colorCounts.size === 1 && !isFullyFilled && opaqueCells && !isDetailOnly) {
        const group = paintGroups[0];
        if (group) {
          let rects = mergePackedCells(opaqueCells, stride);
          rects = mergeAdjacentRects(rects);
          if (rects.length > 0 && rects.length <= PLANE_SHELL_MASK_OPAQUE_HOLES_MAX_RECTS) {
            let rectAreaCells = 0;
            for (const rect of rects) {
              rectAreaCells += (rect.x2 - rect.x) * (rect.y2 - rect.y);
            }

            const tileSize = context.tileSize ?? 50;
            const layerElevation = context.layerElevation ?? tileSize;
            const cellWidthPx = axis === "y" ? layerElevation : tileSize;
            const cellHeightPx = axis === "x" ? layerElevation : tileSize;
            const bboxPx = bboxArea * cellWidthPx * cellHeightPx;
            const rectPx = rectAreaCells * cellWidthPx * cellHeightPx;

            const fillRatio = bboxArea > 0 ? rectAreaCells / bboxArea : 1;
            const domQuadPenaltyPx = computeDomQuadPenaltyPx();
            const alphaTax = 1 + (1 - fillRatio) * PLANE_SHELL_MASK_ALPHA_TAX_HOLES_FACTOR;
            const scoreSprite = bboxPx * alphaTax + domQuadPenaltyPx;
            const scoreRects = rectPx + rects.length * domQuadPenaltyPx;

            const minOpaqueHolesBboxCells = 256;
            const shouldUseRects =
              bboxArea >= minOpaqueHolesBboxCells &&
              scoreRects + Math.round(domQuadPenaltyPx * PLANE_SHELL_MASK_TILING_MARGIN_PENALTY_FRACTION) < scoreSprite;

            if (shouldUseRects) {
              const tiles = rects.map((rect) => ({
                gridArea: `${rect.x} / ${rect.y} / ${rect.x2} / ${rect.y2}`,
                offsetRow: 0,
                offsetCol: 0
              }));
              const cssColor = `rgb(${group.r}, ${group.g}, ${group.b})`;
              faceSprites.push({
                face,
                url: null,
                backgroundImage: "",
                backgroundColor: cssColor,
                gridArea: `${rowStart} / ${colStart} / ${rowEnd} / ${colEnd}`,
                rowStart,
                colStart,
                rowEnd,
                colEnd,
                tiles
              });
              continue;
            }
          }
        }
      }

      if (allOpaque && colorCounts.size > 1 && opaqueCells) {
        let baseKey: string | null = baseKeyByFace?.get(faceKey) ?? null;
        let baseCount = 0;
        if (!baseKey) {
          for (const [key, count] of colorCounts.entries()) {
            if (!baseKey || count > baseCount || (count === baseCount && key < baseKey)) {
              baseKey = key;
              baseCount = count;
            }
          }
        } else {
          baseCount = colorCounts.get(baseKey) ?? 0;
        }
        const baseFraction = fillCount > 0 ? baseCount / fillCount : 0;
        const detailCount = fillCount - baseCount;
        let shouldHybrid =
          Boolean(baseKey) && detailCount > 0 && baseFraction >= PLANE_SHELL_MASK_BASE_DETAIL_MIN_BASE_FRACTION;

        type DetailPaint = { row: number; col: number; r: number; g: number; b: number; alpha: number };
        const detailPaint: DetailPaint[] = [];
        let detailMinRow = Number.POSITIVE_INFINITY;
        let detailMinCol = Number.POSITIVE_INFINITY;
        let detailMaxRow = -1;
        let detailMaxCol = -1;

        if (shouldHybrid && baseKey) {
          for (const group of paintGroups) {
            const colorKey = `${group.r},${group.g},${group.b},${group.alpha}`;
            if (colorKey === baseKey) continue;
            const { r, g, b, alpha } = group;
            for (const cellKey of group.cells) {
              if (cellKey < 0) continue;
              const row = Math.floor(cellKey / stride);
              const col = cellKey - row * stride;
              if (row <= 0 || col <= 0) continue;
              if (row > height || col > width) continue;
              detailPaint.push({ row, col, r, g, b, alpha });
              if (row < detailMinRow) detailMinRow = row;
              if (col < detailMinCol) detailMinCol = col;
              if (row > detailMaxRow) detailMaxRow = row;
              if (col > detailMaxCol) detailMaxCol = col;
            }
          }
          if (!detailPaint.length) {
            shouldHybrid = false;
          }
        }

        if (
          shouldHybrid &&
          baseKey &&
          Number.isFinite(detailMinRow) &&
          Number.isFinite(detailMinCol) &&
          detailMaxRow >= 0 &&
          detailMaxCol >= 0
        ) {
          const detailCropWidth = detailMaxCol - detailMinCol + 1;
          const detailCropHeight = detailMaxRow - detailMinRow + 1;
          const detailBBoxArea = detailCropWidth * detailCropHeight;
          const detailBBoxRatio = bboxArea > 0 ? detailBBoxArea / bboxArea : 1;
          if (detailCropWidth <= 0 || detailCropHeight <= 0 || detailBBoxArea <= 0) {
            shouldHybrid = false;
          } else if (detailBBoxRatio > PLANE_SHELL_MASK_BASE_DETAIL_MAX_DETAIL_BBOX_RATIO) {
            shouldHybrid = false;
          } else {
            const baseParts = baseKey.split(",").map((value) => Number(value));
            const baseR = baseParts[0] ?? 0;
            const baseG = baseParts[1] ?? 0;
            const baseB = baseParts[2] ?? 0;
            const baseColor = `rgb(${baseR}, ${baseG}, ${baseB})`;

            if (!isDetailOnly) {
              if (baseAsSprite) {
                let baseSpriteWritten = false;
                let baseMinRow = Number.POSITIVE_INFINITY;
                let baseMinCol = Number.POSITIVE_INFINITY;
                let baseMaxRow = -1;
                let baseMaxCol = -1;
                type Cell = { row: number; col: number };
                const baseCells: Cell[] = [];
                for (const group of paintGroups) {
                  const colorKey = `${group.r},${group.g},${group.b},${group.alpha}`;
                  if (colorKey !== baseKey) continue;
                  for (const cellKey of group.cells) {
                    if (cellKey < 0) continue;
                    const row = Math.floor(cellKey / stride);
                    const col = cellKey - row * stride;
                    if (row <= 0 || col <= 0) continue;
                    if (row > height || col > width) continue;
                    baseCells.push({ row, col });
                    if (row < baseMinRow) baseMinRow = row;
                    if (col < baseMinCol) baseMinCol = col;
                    if (row > baseMaxRow) baseMaxRow = row;
                    if (col > baseMaxCol) baseMaxCol = col;
                  }
                }
                if (
                  baseCells.length > 0 &&
                  Number.isFinite(baseMinRow) &&
                  Number.isFinite(baseMinCol) &&
                  baseMaxRow >= 0 &&
                  baseMaxCol >= 0
                ) {
                  const baseRowStart = baseMinRow;
                  const baseColStart = baseMinCol;
                  const baseRowEnd = baseMaxRow + 1;
                  const baseColEnd = baseMaxCol + 1;
                  const baseCropWidth = baseMaxCol - baseMinCol + 1;
                  const baseCropHeight = baseMaxRow - baseMinRow + 1;
                  if (baseCropWidth > 0 && baseCropHeight > 0) {
                    const pixels = new Uint8Array(baseCropWidth * baseCropHeight * 4);
                    for (const cell of baseCells) {
                      const x = cell.col - baseColStart;
                      const y = cell.row - baseRowStart;
                      if (x < 0 || y < 0 || x >= baseCropWidth || y >= baseCropHeight) continue;
                      const idx = (y * baseCropWidth + x) * 4;
                      pixels[idx] = baseR;
                      pixels[idx + 1] = baseG;
                      pixels[idx + 2] = baseB;
                      pixels[idx + 3] = 255;
	                    }
	                    try {
	                      const blob = rgbaToPngBlob(pixels, baseCropWidth, baseCropHeight);
	                      const url = URL.createObjectURL(blob);
	                      urls.push(url);
	                      faceSprites.push({
                        face,
                        layer: 0,
                        url,
                        backgroundImage: `url("${url}")`,
                        backgroundColor: "",
                        gridArea: `${baseRowStart} / ${baseColStart} / ${baseRowEnd} / ${baseColEnd}`,
                        rowStart: baseRowStart,
                        colStart: baseColStart,
                        rowEnd: baseRowEnd,
                        colEnd: baseColEnd,
                        tiles: [
                          {
                            gridArea: `${baseRowStart} / ${baseColStart} / ${baseRowEnd} / ${baseColEnd}`,
                            offsetRow: 0,
                            offsetCol: 0
                          }
                        ]
                      });
                      baseSpriteWritten = true;
                    } catch {
                      return fail();
                    }
                  }
                }
                if (!baseSpriteWritten) {
                  shouldHybrid = false;
                }
              } else {
                let baseRects = mergePackedCells(opaqueCells, stride);
                baseRects = mergeAdjacentRects(baseRects);
                if (baseRects.length > 0 && baseRects.length <= PLANE_SHELL_MASK_BASE_DETAIL_MAX_BASE_RECTS) {
                  const baseTiles = baseRects.map((rect) => ({
                    gridArea: `${rect.x} / ${rect.y} / ${rect.x2} / ${rect.y2}`,
                    offsetRow: 0,
                    offsetCol: 0
                  }));
                  faceSprites.push({
                    face,
                    layer: 0,
                    url: null,
                    backgroundImage: "",
                    backgroundColor: baseColor,
                    gridArea: `${rowStart} / ${colStart} / ${rowEnd} / ${colEnd}`,
                    rowStart,
                    colStart,
                    rowEnd,
                    colEnd,
                    tiles: baseTiles
                  });
                } else {
                  shouldHybrid = false;
                }
              }
            }

            if (!shouldHybrid) {
              // fall through to full sprite path below
            } else {
              const detailRowStart = detailMinRow;
              const detailColStart = detailMinCol;
              const detailRowEnd = detailMaxRow + 1;
              const detailColEnd = detailMaxCol + 1;
              const isDetailFullyFilled = detailPaint.length === detailBBoxArea;
              const maxOpaqueDetailPrefillCheckCells = 65_536;
              const detailBboxFullyCovered =
                !isDetailFullyFilled &&
                detailBBoxArea <= maxOpaqueDetailPrefillCheckCells &&
                (() => {
                  for (let row = detailRowStart; row < detailRowEnd; row += 1) {
                    const rowBase = row * stride;
                    for (let col = detailColStart; col < detailColEnd; col += 1) {
                      if (!opaqueCells.has(rowBase + col)) return false;
                    }
                  }
                  return true;
                })();

              const useRgbDetailSprite = isDetailFullyFilled || detailBboxFullyCovered;
              const rgbaPixels = useRgbDetailSprite ? null : new Uint8Array(detailCropWidth * detailCropHeight * 4);
              const rgbPixels = useRgbDetailSprite ? new Uint8Array(detailCropWidth * detailCropHeight * 3) : null;

              if (detailBboxFullyCovered && rgbPixels) {
                for (let i = 0; i < rgbPixels.length; i += 3) {
                  rgbPixels[i] = baseR;
                  rgbPixels[i + 1] = baseG;
                  rgbPixels[i + 2] = baseB;
                }
              }
              const tiles: Array<{ gridArea: string; offsetRow: number; offsetCol: number }> = [];
              const cellWidthPx = axis === "y" ? (context.layerElevation ?? context.tileSize ?? 50) : (context.tileSize ?? 50);
              const cellHeightPx = axis === "x" ? (context.layerElevation ?? context.tileSize ?? 50) : (context.tileSize ?? 50);
              const cellPxMax = Math.max(cellWidthPx, cellHeightPx);
              const tileTargetPx = PLANE_SHELL_MASK_TILE_TARGET_PX;
              const domQuadPenaltyPx = computeDomQuadPenaltyPx();
              const tileMinCells = PLANE_SHELL_MASK_TILE_MIN_CELLS;
              const tileMaxCells = PLANE_SHELL_MASK_TILE_MAX_CELLS;
              let tileCells = tileMinCells;
              while (!isDetailFullyFilled && tileCells < tileMaxCells && tileCells * cellPxMax < tileTargetPx) {
                tileCells *= 2;
              }
              type TileBounds = { minX: number; minY: number; maxX: number; maxY: number };
              let tileBounds = new Map<number, TileBounds>();

              for (const detail of detailPaint) {
                const x = detail.col - detailColStart;
                const y = detail.row - detailRowStart;
                if (x < 0 || y < 0 || x >= detailCropWidth || y >= detailCropHeight) continue;
                if (rgbPixels) {
                  const idx = (y * detailCropWidth + x) * 3;
                  rgbPixels[idx] = detail.r;
                  rgbPixels[idx + 1] = detail.g;
                  rgbPixels[idx + 2] = detail.b;
                } else if (rgbaPixels) {
                  const idx = (y * detailCropWidth + x) * 4;
                  rgbaPixels[idx] = detail.r;
                  rgbaPixels[idx + 1] = detail.g;
                  rgbaPixels[idx + 2] = detail.b;
                  rgbaPixels[idx + 3] = detail.alpha;
                }

                if (!isDetailFullyFilled) {
                  const tileX = Math.floor(x / tileCells);
                  const tileY = Math.floor(y / tileCells);
                  if (tileX >= 0 && tileY >= 0 && tileX <= 0xffff && tileY <= 0xffff) {
                    const tileKey = (tileY << 16) | tileX;
                    const bounds = tileBounds.get(tileKey);
                    if (!bounds) {
                      tileBounds.set(tileKey, { minX: x, minY: y, maxX: x, maxY: y });
                    } else {
                      if (x < bounds.minX) bounds.minX = x;
                      if (y < bounds.minY) bounds.minY = y;
                      if (x > bounds.maxX) bounds.maxX = x;
                      if (y > bounds.maxY) bounds.maxY = y;
                    }
                  }
                }
              }

              if (isDetailFullyFilled) {
                tiles.push({
                  gridArea: `${detailRowStart} / ${detailColStart} / ${detailRowEnd} / ${detailColEnd}`,
                  offsetRow: 0,
                  offsetCol: 0
                });
              } else {
                const fillRatio = detailPaint.length / detailBBoxArea;
                const tileMinArea = PLANE_SHELL_MASK_TILING_MIN_AREA_CELLS;
                const tileMaxFillRatio =
                  axis === "z" ? PLANE_SHELL_MASK_FULL_SPRITE_TILE_MAX_FILL_RATIO_Z : PLANE_SHELL_MASK_FULL_SPRITE_TILE_MAX_FILL_RATIO_XY;
                const tileMaxCount =
                  axis === "z" ? PLANE_SHELL_MASK_DETAIL_SPRITE_TILE_MAX_COUNT_Z : PLANE_SHELL_MASK_DETAIL_SPRITE_TILE_MAX_COUNT_XY;
                const snapTilesToGrid = axis === "z";
                const canTile = detailBBoxArea >= tileMinArea && fillRatio <= tileMaxFillRatio && tileBounds.size >= 2;

                if (canTile) {
                  while (tileCells < tileMaxCells && tileBounds.size > tileMaxCount) {
                    const nextBounds = new Map<number, TileBounds>();
                    for (const [key, bounds] of tileBounds.entries()) {
                      const tx = key & 0xffff;
                      const ty = key >>> 16;
                      const nextKey = ((ty >>> 1) << 16) | (tx >>> 1);
                      const merged = nextBounds.get(nextKey);
                      if (!merged) {
                        nextBounds.set(nextKey, { ...bounds });
                      } else {
                        if (bounds.minX < merged.minX) merged.minX = bounds.minX;
                        if (bounds.minY < merged.minY) merged.minY = bounds.minY;
                        if (bounds.maxX > merged.maxX) merged.maxX = bounds.maxX;
                        if (bounds.maxY > merged.maxY) merged.maxY = bounds.maxY;
                      }
                    }
                    tileBounds = nextBounds;
                    tileCells *= 2;
                  }
                }

                const allowTiling = canTile && tileBounds.size <= tileMaxCount;
                if (allowTiling) {
                  const tileKeys = Array.from(tileBounds.keys());
                  tileKeys.sort((a, b) => a - b);
                  const tileRects: Rect[] = [];
                  for (const tileKey of tileKeys) {
                    const bounds = tileBounds.get(tileKey);
                    if (!bounds) continue;
                    const tileX = tileKey & 0xffff;
                    const tileY = tileKey >>> 16;
                    const minX = snapTilesToGrid ? tileX * tileCells : bounds.minX;
                    const minY = snapTilesToGrid ? tileY * tileCells : bounds.minY;
                    const maxX = snapTilesToGrid ? Math.min(minX + tileCells - 1, detailCropWidth - 1) : bounds.maxX;
                    const maxY = snapTilesToGrid ? Math.min(minY + tileCells - 1, detailCropHeight - 1) : bounds.maxY;
                    const tileRowStart = detailRowStart + minY;
                    const tileRowEnd = detailRowStart + maxY + 1;
                    const tileColStart = detailColStart + minX;
                    const tileColEnd = detailColStart + maxX + 1;
                    if (tileRowEnd <= tileRowStart || tileColEnd <= tileColStart) continue;
                    tileRects.push({ x: tileRowStart, y: tileColStart, x2: tileRowEnd, y2: tileColEnd });
                  }
                  const merged = mergeAdjacentRects(tileRects);

                  let tileAreaCells = 0;
                  for (const rect of merged) {
                    tileAreaCells += (rect.x2 - rect.x) * (rect.y2 - rect.y);
                  }
                  const bboxPx = detailBBoxArea * cellWidthPx * cellHeightPx;
                  const tiledPx = tileAreaCells * cellWidthPx * cellHeightPx;
                  const scoreSingle = bboxPx + domQuadPenaltyPx;
                  const scoreTiled = tiledPx + merged.length * domQuadPenaltyPx;

                  if (merged.length >= 2 && scoreTiled < scoreSingle) {
                    for (const rect of merged) {
                      tiles.push({
                        gridArea: `${rect.x} / ${rect.y} / ${rect.x2} / ${rect.y2}`,
                        offsetRow: rect.x - detailRowStart,
                        offsetCol: rect.y - detailColStart
                      });
                    }
                  }
                }

                if (!tiles.length) {
                  tiles.push({
                    gridArea: `${detailRowStart} / ${detailColStart} / ${detailRowEnd} / ${detailColEnd}`,
                    offsetRow: 0,
                    offsetCol: 0
                  });
                }
              }

              try {
                const blob = (() => {
                  if (rgbPixels) {
                    return rgbToPngBlob(rgbPixels, detailCropWidth, detailCropHeight);
                  }
                  if (!rgbaPixels) {
                    throw new Error("voxcss: missing detail sprite pixel buffer.");
                  }
                  return rgbaToPngBlob(rgbaPixels, detailCropWidth, detailCropHeight);
                })();
                const url = URL.createObjectURL(blob);
                urls.push(url);
                faceSprites.push({
                  face,
                  layer: 1,
                  url,
                  backgroundImage: `url("${url}")`,
                  backgroundColor: "",
                  gridArea: `${detailRowStart} / ${detailColStart} / ${detailRowEnd} / ${detailColEnd}`,
                  rowStart: detailRowStart,
                  colStart: detailColStart,
                  rowEnd: detailRowEnd,
                  colEnd: detailColEnd,
                  tiles
                });
                continue;
              } catch {
                return fail();
              }
            }
          }
        }
      }

      if (isDetailOnly) {
        continue;
      }

      const pixels = new Uint8Array(cropWidth * cropHeight * 4);
      let wroteAny = false;

      const fillRatio = bboxArea > 0 ? fillCount / bboxArea : 1;
      const tileTargetPx = PLANE_SHELL_MASK_TILE_TARGET_PX;
      const domQuadPenaltyPx = computeDomQuadPenaltyPx();
      const tileMinArea = PLANE_SHELL_MASK_TILING_MIN_AREA_CELLS;
      const tileMaxFillRatio =
        axis === "z" ? PLANE_SHELL_MASK_FULL_SPRITE_TILE_MAX_FILL_RATIO_Z : PLANE_SHELL_MASK_FULL_SPRITE_TILE_MAX_FILL_RATIO_XY;
      const tileMaxCount = axis === "z" ? PLANE_SHELL_MASK_FULL_SPRITE_TILE_MAX_COUNT_Z : PLANE_SHELL_MASK_FULL_SPRITE_TILE_MAX_COUNT_XY;
      const snapTilesToGrid = axis === "z";
      const maxSpriteTilingCells = PLANE_SHELL_MASK_FULL_SPRITE_TILE_MAX_FILLED_CELLS;
      const shouldConsiderTiling =
        bboxArea >= tileMinArea && fillRatio <= tileMaxFillRatio && fillCount <= maxSpriteTilingCells;

      const tileSizePx = context.tileSize ?? 50;
      const layerElevationPx = context.layerElevation ?? tileSizePx;
      const cellWidthPx = axis === "y" ? layerElevationPx : tileSizePx;
      const cellHeightPx = axis === "x" ? layerElevationPx : tileSizePx;
      const cellPxMax = Math.max(cellWidthPx, cellHeightPx);
      const tileMinCells = PLANE_SHELL_MASK_TILE_MIN_CELLS;
      const tileMaxCells = PLANE_SHELL_MASK_TILE_MAX_CELLS;
      let tileCells = tileMinCells;
      while (tileCells < tileMaxCells && tileCells * cellPxMax < tileTargetPx) {
        tileCells *= 2;
      }

      type TileBounds = { minX: number; minY: number; maxX: number; maxY: number };
      let tileBounds: Map<number, TileBounds> | null = shouldConsiderTiling ? new Map() : null;

      for (const group of paintGroups) {
        const { r, g, b, alpha } = group;
        for (const cellKey of group.cells) {
          if (cellKey < 0) continue;
          const row = Math.floor(cellKey / stride);
          const col = cellKey - row * stride;
          if (row < minRow || col < minCol || row > maxRow || col > maxCol) continue;
          const x = col - minCol;
          const y = row - minRow;
          if (x < 0 || y < 0 || x >= cropWidth || y >= cropHeight) continue;
          const idx = (y * cropWidth + x) * 4;
          pixels[idx] = r;
          pixels[idx + 1] = g;
          pixels[idx + 2] = b;
          pixels[idx + 3] = alpha;
          wroteAny = true;

          if (tileBounds) {
            const tileX = Math.floor(x / tileCells);
            const tileY = Math.floor(y / tileCells);
            if (tileX >= 0 && tileY >= 0 && tileX <= 0xffff && tileY <= 0xffff) {
              const tileKey = (tileY << 16) | tileX;
              const bounds = tileBounds.get(tileKey);
              if (!bounds) {
                tileBounds.set(tileKey, { minX: x, minY: y, maxX: x, maxY: y });
              } else {
                if (x < bounds.minX) bounds.minX = x;
                if (y < bounds.minY) bounds.minY = y;
                if (x > bounds.maxX) bounds.maxX = x;
                if (y > bounds.maxY) bounds.maxY = y;
              }
            }
          }
        }
      }

      if (!wroteAny) continue;

      let tiles: Array<{ gridArea: string; offsetRow: number; offsetCol: number }> = [
        { gridArea: `${rowStart} / ${colStart} / ${rowEnd} / ${colEnd}`, offsetRow: 0, offsetCol: 0 }
      ];

      if (tileBounds && tileBounds.size >= 2) {
        while (tileCells < tileMaxCells && tileBounds.size > tileMaxCount) {
          const nextBounds = new Map<number, TileBounds>();
          for (const [key, bounds] of tileBounds.entries()) {
            const tx = key & 0xffff;
            const ty = key >>> 16;
            const nextKey = ((ty >>> 1) << 16) | (tx >>> 1);
            const merged = nextBounds.get(nextKey);
            if (!merged) {
              nextBounds.set(nextKey, { ...bounds });
            } else {
              if (bounds.minX < merged.minX) merged.minX = bounds.minX;
              if (bounds.minY < merged.minY) merged.minY = bounds.minY;
              if (bounds.maxX > merged.maxX) merged.maxX = bounds.maxX;
              if (bounds.maxY > merged.maxY) merged.maxY = bounds.maxY;
            }
          }
          tileBounds = nextBounds;
          tileCells *= 2;
        }

        if (tileBounds.size <= tileMaxCount) {
          const tileKeys = Array.from(tileBounds.keys());
          tileKeys.sort((a, b) => a - b);
          const tileRects: Rect[] = [];
          for (const tileKey of tileKeys) {
            const bounds = tileBounds.get(tileKey);
            if (!bounds) continue;
            const tileX = tileKey & 0xffff;
            const tileY = tileKey >>> 16;
            const minX = snapTilesToGrid ? tileX * tileCells : bounds.minX;
            const minY = snapTilesToGrid ? tileY * tileCells : bounds.minY;
            const maxX = snapTilesToGrid ? Math.min(minX + tileCells - 1, cropWidth - 1) : bounds.maxX;
            const maxY = snapTilesToGrid ? Math.min(minY + tileCells - 1, cropHeight - 1) : bounds.maxY;
            const tileRowStart = rowStart + minY;
            const tileRowEnd = rowStart + maxY + 1;
            const tileColStart = colStart + minX;
            const tileColEnd = colStart + maxX + 1;
            if (tileRowEnd <= tileRowStart || tileColEnd <= tileColStart) continue;
            tileRects.push({ x: tileRowStart, y: tileColStart, x2: tileRowEnd, y2: tileColEnd });
          }

          const merged = mergeAdjacentRects(tileRects);
          if (merged.length >= 2 && merged.length <= tileMaxCount) {
            let mergedTileAreaCells = 0;
            for (const rect of merged) {
              mergedTileAreaCells += (rect.x2 - rect.x) * (rect.y2 - rect.y);
            }

            const bboxPx = bboxArea * cellWidthPx * cellHeightPx;
            const tiledPx = mergedTileAreaCells * cellWidthPx * cellHeightPx;
            const fillRatioSingle = fillRatio;
            const fillRatioTiled =
              mergedTileAreaCells > 0 ? Math.min(1, Math.max(0, fillCount / mergedTileAreaCells)) : 1;
            const alphaTaxSingle = 1 + (1 - fillRatioSingle) * PLANE_SHELL_MASK_ALPHA_TAX_HOLES_FACTOR;
            const alphaTaxTiled = 1 + (1 - fillRatioTiled) * PLANE_SHELL_MASK_ALPHA_TAX_HOLES_FACTOR;
            const scoreSingle = bboxPx * alphaTaxSingle + domQuadPenaltyPx;
            const scoreTiled = tiledPx * alphaTaxTiled + merged.length * domQuadPenaltyPx;

            if (scoreTiled + Math.round(domQuadPenaltyPx * PLANE_SHELL_MASK_TILING_MARGIN_PENALTY_FRACTION) < scoreSingle) {
              tiles = merged.map((rect) => ({
                gridArea: `${rect.x} / ${rect.y} / ${rect.x2} / ${rect.y2}`,
                offsetRow: rect.x - rowStart,
                offsetCol: rect.y - colStart
              }));
            }
          }
        }
      }

      try {
        const isRgbSprite = allOpaque && isFullyFilled;
        const blob = (() => {
          if (isRgbSprite) {
            const rgb = new Uint8Array(cropWidth * cropHeight * 3);
            for (let src = 0, dst = 0; src < pixels.length; src += 4) {
              rgb[dst++] = pixels[src] ?? 0;
              rgb[dst++] = pixels[src + 1] ?? 0;
              rgb[dst++] = pixels[src + 2] ?? 0;
            }
            return rgbToPngBlob(rgb, cropWidth, cropHeight);
          }
          return rgbaToPngBlob(pixels, cropWidth, cropHeight);
        })();

        const url = URL.createObjectURL(blob);
        urls.push(url);
        faceSprites.push({
          face,
          url,
          backgroundImage: `url("${url}")`,
          backgroundColor: "",
          gridArea: `${rowStart} / ${colStart} / ${rowEnd} / ${colEnd}`,
          rowStart,
          colStart,
          rowEnd,
          colEnd,
          tiles
        });
      } catch {
        return fail();
      }
    }

    if (!faceSprites.length) continue;
    planes.push({ axis, plane, faces: faceSprites });
  }

  return { rows, cols, depth, planes };
}

function renderPlaneShellAxisHost(
  hosts: PlaneShellDomState,
  mesh: PlaneShellMesh,
  snapshot: SceneSnapshot,
  documentRef: Document,
  skipFaces: Set<string> | null = null,
  baseKeyByFace: Map<string, string> | null = null
): void {
  const context = snapshot.context;
  const tileSize = context.tileSize ?? 50;
  const layerElevation = context.layerElevation ?? tileSize;
  const rows = mesh.rows;
  const cols = mesh.cols;
  const depth = mesh.depth;

  applyPlaneShellHostGrid(hosts, { rows, cols, depth, tileSize, layerElevation });

  const transformCache = new Map<string, string>();
  const resolveTransform = (axis: "x" | "y" | "z", plane: number): string => {
    const key = `${axis}:${plane}`;
    const existing = transformCache.get(key);
    if (existing) return existing;
    const computed =
      axis === "z"
        ? `translateZ(${plane * layerElevation}px)`
        : `translateZ(${-1 * (plane - 1) * tileSize}px)`;
    transformCache.set(key, computed);
    return computed;
  };

  const ensureQuad = (axis: "x" | "y" | "z", index: number): HTMLElement => {
    const pool = axis === "z" ? hosts.zPool : axis === "x" ? hosts.xPool : hosts.yPool;
    const parent = axis === "z" ? hosts.zHost : axis === "x" ? hosts.xHost : hosts.yHost;
    const anchor = axis === "z" ? hosts.zMaskAnchor : axis === "x" ? hosts.xMaskAnchor : hosts.yMaskAnchor;
    let quad = pool[index];
    if (!quad) {
      quad = documentRef.createElement("div");
      parent.insertBefore(quad, anchor);
      pool[index] = quad;
    } else if (quad.parentElement !== parent) {
      parent.insertBefore(quad, anchor);
    }
    if (quad.style.display === "none") {
      quad.style.display = "";
    }
    return quad;
  };

  const removeUnused = (pool: HTMLElement[], used: number): void => {
    for (let i = used; i < pool.length; i += 1) {
      const quad = pool[i];
      if (!quad) continue;
      quad.remove();
    }
  };
  const walls = context.walls ?? DEFAULT_WALLS;

  let zIndex = 0;
  let xIndex = 0;
  let yIndex = 0;

  for (const plane of mesh.planes) {
    const axis = plane.axis;
    const transform = resolveTransform(axis, plane.plane);
    for (const group of plane.groups) {
      if (walls[group.face]) continue;
      const faceKey = `${axis}:${plane.plane}:${group.face}`;
      if (skipFaces?.has(faceKey)) continue;
      if (baseKeyByFace?.has(faceKey)) {
        const targetKey = baseKeyByFace.get(faceKey);
        if (targetKey) {
          const keyInfo = getAppearanceColorKey(group.voxel, group.face, context);
          if (keyInfo && keyInfo.key !== targetKey) continue;
        }
      }
      const appearance = computeCubeFaceAppearance(group.voxel, group.face, context);
      const baked = getAppearanceColorKey(group.voxel, group.face, context);
      for (const rect of group.rects) {
        const nextIndex = axis === "z" ? zIndex++ : axis === "x" ? xIndex++ : yIndex++;
        const quad = ensureQuad(axis, nextIndex);
        quad.className = `voxcss-plane-face voxcss-plane-face--${group.face}`;
        quad.style.gridArea = `${rect.x} / ${rect.y} / ${rect.x2} / ${rect.y2}`;
        quad.style.transform = transform;
        if (baked) {
          quad.style.backgroundImage = "";
          quad.style.backgroundColor =
            baked.alpha === 255
              ? `rgb(${baked.r}, ${baked.g}, ${baked.b})`
              : `rgba(${baked.r}, ${baked.g}, ${baked.b}, ${Math.round((baked.alpha / 255) * 1000) / 1000})`;
          quad.style.filter = "";
        } else {
          quad.style.backgroundImage = appearance.backgroundImage;
          quad.style.backgroundColor = appearance.backgroundColor;
          quad.style.filter = appearance.filter;
        }
      }
    }
  }

  removeUnused(hosts.zPool, zIndex);
  removeUnused(hosts.xPool, xIndex);
  removeUnused(hosts.yPool, yIndex);
}

function renderPlaneShellAxisHostMask(
  hosts: PlaneShellDomState,
  mask: PlaneShellMaskMesh | null,
  snapshot: SceneSnapshot,
  documentRef: Document
): void {
  const removeUnused = (pool: HTMLElement[], used: number): void => {
    for (let i = used; i < pool.length; i += 1) {
      const quad = pool[i];
      if (!quad) continue;
      quad.remove();
    }
    pool.length = used;
  };

  const planes = mask?.planes ?? [];
  if (!planes.length) {
    removeUnused(hosts.zMaskPool, 0);
    removeUnused(hosts.xMaskPool, 0);
    removeUnused(hosts.yMaskPool, 0);
    return;
  }

  const context = snapshot.context;
  const tileSize = context.tileSize ?? 50;
  const layerElevation = context.layerElevation ?? tileSize;

  const transformCache = new Map<string, string>();
  const resolveTransform = (axis: "x" | "y" | "z", plane: number): string => {
    const key = `${axis}:${plane}`;
    const existing = transformCache.get(key);
    if (existing) return existing;
    const computed =
      axis === "z" ? `translateZ(${plane * layerElevation}px)` : `translateZ(${-1 * (plane - 1) * tileSize}px)`;
    transformCache.set(key, computed);
    return computed;
  };

  const faceTransformCache = new Map<string, string>();
  const resolveFaceTransform = (axis: "x" | "y" | "z", plane: number, face: CubeFace, layer: number): string => {
    if (!Number.isFinite(layer) || layer <= 0) return resolveTransform(axis, plane);
    const key = `${axis}:${plane}:${face}:${layer}`;
    const existing = faceTransformCache.get(key);
    if (existing) return existing;
    const sign = face === "fl" || face === "fr" || face === "b" ? -1 : 1;
    const computed = `${resolveTransform(axis, plane)} translateZ(${sign * layer * PLANE_SHELL_MASK_LAYER_EPSILON_PX}px)`;
    faceTransformCache.set(key, computed);
    return computed;
  };

  const ensureQuad = (axis: "x" | "y" | "z", index: number): HTMLElement => {
    const pool = axis === "z" ? hosts.zMaskPool : axis === "x" ? hosts.xMaskPool : hosts.yMaskPool;
    const parent = axis === "z" ? hosts.zHost : axis === "x" ? hosts.xHost : hosts.yHost;
    let quad = pool[index];
    if (!quad) {
      quad = documentRef.createElement("div");
      parent.appendChild(quad);
      pool[index] = quad;
    } else if (quad.parentElement !== parent) {
      parent.appendChild(quad);
    }
    if (quad.style.display === "none") {
      quad.style.display = "";
    }
    return quad;
  };

  const walls = context.walls ?? DEFAULT_WALLS;
  const backgroundRepeat = "no-repeat";
  const imageRendering = "pixelated";

  let zIndex = 0;
  let xIndex = 0;
  let yIndex = 0;

  for (const plane of planes) {
    const axis = plane.axis;
    const cellWidthPx = axis === "y" ? layerElevation : tileSize;
    const cellHeightPx = axis === "x" ? layerElevation : tileSize;
    for (const faceSprite of plane.faces) {
      if (walls[faceSprite.face]) continue;
      const layer = faceSprite.layer ?? 0;
      const transform = resolveFaceTransform(axis, plane.plane, faceSprite.face, layer);
      const tiles =
        faceSprite.tiles.length > 0
          ? faceSprite.tiles
          : [{ gridArea: faceSprite.gridArea, offsetRow: 0, offsetCol: 0 }];
      const spriteWidthPx = faceSprite.backgroundImage ? (faceSprite.colEnd - faceSprite.colStart) * cellWidthPx : 0;
      const spriteHeightPx = faceSprite.backgroundImage ? (faceSprite.rowEnd - faceSprite.rowStart) * cellHeightPx : 0;

      for (const tile of tiles) {
        const nextIndex = axis === "z" ? zIndex++ : axis === "x" ? xIndex++ : yIndex++;
        const quad = ensureQuad(axis, nextIndex);
        quad.className = `voxcss-plane-face voxcss-plane-face--${faceSprite.face}`;
        quad.style.gridArea = tile.gridArea;
        quad.style.transform = transform;
        quad.style.backgroundImage = faceSprite.backgroundImage;
        quad.style.backgroundColor = faceSprite.backgroundColor;
        quad.style.filter = "";

        if (faceSprite.backgroundImage) {
          quad.style.backgroundSize = `${spriteWidthPx}px ${spriteHeightPx}px`;
          quad.style.backgroundRepeat = backgroundRepeat;
          quad.style.backgroundPosition = `${-tile.offsetCol * cellWidthPx}px ${-tile.offsetRow * cellHeightPx}px`;
          quad.style.setProperty("image-rendering", imageRendering);
        } else {
          quad.style.backgroundSize = "";
          quad.style.backgroundRepeat = "";
          quad.style.backgroundPosition = "";
          quad.style.removeProperty("image-rendering");
        }
      }
    }
  }

  removeUnused(hosts.zMaskPool, zIndex);
  removeUnused(hosts.xMaskPool, xIndex);
  removeUnused(hosts.yMaskPool, yIndex);
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
