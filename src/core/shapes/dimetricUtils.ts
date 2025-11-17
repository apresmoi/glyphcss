import type { GridContext, OffsetMap, Voxel } from "../types";
import { FACE_CLASS } from "../types";
import type { DimetricShapeType, DimetricSurfaceLighting } from "../lighting";
import { computeDimetricLighting } from "../lighting";

const SHAPE_CLASSNAMES = [
  "voxcss-dimetric-flat",
  "voxcss-dimetric-ramp",
  "voxcss-dimetric-wedge",
  "voxcss-dimetric-spike"
];

type PointerSurface = HTMLElement & { __voxPointer?: true };

interface PreparedShape {
  rotation: number;
  baseColor: string;
  pointer: HTMLElement;
  orientation: string;
  container: HTMLElement;
  lighting: DimetricSurfaceLighting[];
}

interface PrepareShapeOptions {
  mountToRoot?: boolean;
  pointerSurface?: boolean;
}

function normalizeRotationDegrees(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0;
  const snapped = Math.round((value as number) / 90) * 90;
  return ((snapped % 360) + 360) % 360;
}

function rotationToOrientation(rotation: number): string {
  const normalized = normalizeRotationDegrees(rotation);
  const mapping: Record<number, string> = {
    0: "east",
    90: "south",
    180: "west",
    270: "north"
  };
  return mapping[normalized] ?? "east";
}

export function applyDimetricShapeClass(root: HTMLElement, className: string): void {
  for (const name of SHAPE_CLASSNAMES) {
    root.classList.remove(name);
  }
  root.classList.add(className);
}

function isCovered(voxel: Voxel, context: GridContext): boolean {
  const { x2, y2 } = getVoxelBounds(voxel);
  const layerIndex = Math.max(0, Math.floor((voxel.z ?? 0) + 1));
  for (let row = voxel.x; row < x2; row += 1) {
    for (let col = voxel.y; col < y2; col += 1) {
      if (context.getVoxel(row, col, layerIndex)) {
        return true;
      }
    }
  }
  return false;
}

function hasNeighborOnFace(
  voxel: Voxel,
  context: GridContext,
  face: keyof OffsetMap
): boolean {
  const offsets = context.offsets?.[face];
  if (!offsets) return false;
  const [dx, dy, dz] = offsets;
  const neighbor = context.getVoxel(voxel.x + dx, voxel.y + dy, Math.floor((voxel.z ?? 0) + dz));
  return Boolean(neighbor);
}

function getVoxelBounds(voxel: Voxel): { x2: number; y2: number } {
  return {
    x2: voxel.x2 ?? voxel.x + 1,
    y2: voxel.y2 ?? voxel.y + 1
  };
}

function ensurePointerSurface(root: HTMLElement, doc: Document): PointerSurface {
  const existing = Array.from(root.childNodes).find(
    (node) => (node as PointerSurface).__voxPointer
  ) as PointerSurface | undefined;
  if (existing) return existing;
  const surface = doc.createElement("div") as PointerSurface;
  surface.__voxPointer = true;
  surface.className = `${FACE_CLASS} voxcss-dimetric-pointer-surface`;
  surface.dataset.voxFace = "t";
  surface.style.position = "absolute";
  surface.style.inset = "0";
  surface.style.pointerEvents = "auto";
  surface.style.background = "transparent";
  surface.style.backfaceVisibility = "hidden";
  surface.style.transformStyle = "preserve-3d";
  root.appendChild(surface);
  return surface;
}

export function prepareDimetricShape(args: {
  shape: DimetricShapeType;
  voxel: Voxel;
  context: GridContext;
  root: HTMLElement;
  documentRef?: Document;
  options?: PrepareShapeOptions;
}): PreparedShape | null {
  const {
    shape,
    voxel,
    context,
    root,
    documentRef = typeof document !== "undefined" ? document : undefined,
    options
  } = args;
  const mountToRoot = Boolean(options?.mountToRoot);
  const pointerSurface = options?.pointerSurface ?? true;
  const owner = documentRef ?? root.ownerDocument ?? (typeof document !== "undefined" ? document : undefined);
  if (!owner) return null;
  if (isCovered(voxel, context)) {
    root.style.display = "none";
    return null;
  }
  root.style.display = "";
  root.classList.add("voxcss-dimetric-shape");
  root.style.transformStyle = "preserve-3d";
  root.style.backfaceVisibility = "hidden";
  root.style.pointerEvents = "none";

  const rawRotation = Number.isFinite(voxel.rot as number) ? Number(voxel.rot) : 0;
  const rotation = normalizeRotationDegrees(rawRotation);
  root.style.setProperty("--tile-elevation", `${context.layerElevation}px`);
  root.style.setProperty("--tile-half-elevation", `${context.layerElevation / 2}px`);
  root.style.setProperty("--tile-rotation", `${rotation}deg`);
  const orientation = rotationToOrientation(rotation);
  const previousOrientation = root.dataset.voxOrientation;
  if (previousOrientation) {
    root.classList.remove(`voxcss-rot-${previousOrientation}`);
  }
  root.dataset.voxOrientation = orientation;
  root.classList.add(`voxcss-rot-${orientation}`);

  let container: HTMLElement;
  if (mountToRoot) {
    const existingInner = root.querySelector<HTMLElement>(".voxcss-dimetric-inner");
    if (existingInner) existingInner.remove();
    root.innerHTML = "";
    container = root;
  } else {
    let inner = root.querySelector<HTMLElement>(".voxcss-dimetric-inner");
    if (!inner) {
      inner = owner.createElement("div");
      inner.className = "voxcss-dimetric-inner";
      root.insertBefore(inner, root.firstChild);
    }
    inner.innerHTML = "";
    container = inner;
  }

  const baseColor = voxel.color ?? "#63c74d";
  root.style.setProperty("--voxcss-dim-color", baseColor);
  const surfaceLighting = computeDimetricLighting(shape, rawRotation, baseColor);
  for (const surface of surfaceLighting) {
    root.style.setProperty(`--voxcss-dim-surface-${surface.id}`, surface.color);
  }

  let pointer: HTMLElement | null = null;
  if (pointerSurface && owner) {
    pointer = ensurePointerSurface(root, owner);
    pointer.style.transform = `translateZ(${context.layerElevation}px)`;
  } else if (!pointerSurface) {
    const existingPointer = root.querySelector<PointerSurface>(".voxcss-dimetric-pointer-surface");
    if (existingPointer) {
      existingPointer.remove();
    }
  }

  const neighborFaces: Array<keyof OffsetMap> = ["fr", "fl", "br", "bl"];
  for (const face of neighborFaces) {
    const neighborClass = `voxcss-neighbor-${face}`;
    if (hasNeighborOnFace(voxel, context, face)) {
      root.classList.add(neighborClass);
    } else {
      root.classList.remove(neighborClass);
    }
  }

  return {
    rotation,
    baseColor,
    pointer: pointer ?? container,
    orientation,
    container,
    lighting: surfaceLighting
  };
}
