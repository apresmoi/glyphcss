import type { GridContext, Voxel, CubeFace } from "../types";
import { FACE_DATA_PROP } from "../types";
import type { ShapeType, ShapeSurfaceLighting } from "../lighting";
import { computeShapeLighting } from "../lighting";

const SHAPE_INNER_CLASS = "voxcss-shape-inner";
const FACE_PROP = FACE_DATA_PROP;
const ORIENTATION_CLASS_NAMES = ["voxcss-east", "voxcss-south", "voxcss-west", "voxcss-north"];

export interface PreparedShapeResult {
  baseColor: string;
  container: HTMLElement;
  lighting: ShapeSurfaceLighting[];
}

export interface PrepareShapeOptions {
  mountToRoot?: boolean;
}

export interface PrepareShapeArgs {
  shape: ShapeType;
  voxel: Voxel;
  context: GridContext;
  root: HTMLElement;
  documentRef?: Document;
  options?: PrepareShapeOptions;
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

function getVoxelBounds(voxel: Voxel): { x2: number; y2: number } {
  return {
    x2: voxel.x2 ?? voxel.x + 1,
    y2: voxel.y2 ?? voxel.y + 1
  };
}

function findShapeInner(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(`.${SHAPE_INNER_CLASS}`) ?? null;
}

export function markElementFace(element: HTMLElement, face: CubeFace): void {
  (element as any)[FACE_PROP] = face;
}

export function prepareShapeRoot(args: PrepareShapeArgs): PreparedShapeResult | null {
  const {
    shape,
    voxel,
    context,
    root,
    documentRef = typeof document !== "undefined" ? document : undefined,
    options
  } = args;
  const mountToRoot = Boolean(options?.mountToRoot);
  const owner = documentRef ?? root.ownerDocument ?? (typeof document !== "undefined" ? document : undefined);
  if (!owner) return null;
  if (isCovered(voxel, context)) {
    root.style.display = "none";
    return null;
  }
  root.style.display = "";
  const rawRotation = Number.isFinite(voxel.rot as number) ? Number(voxel.rot) : 0;
  const rotation = normalizeRotationDegrees(rawRotation);
  const orientation = rotationToOrientation(rotation);
  for (const className of ORIENTATION_CLASS_NAMES) {
    root.classList.remove(className);
  }
  root.classList.add(`voxcss-${orientation}`);

  let container: HTMLElement;
  if (mountToRoot) {
    const existingInner = findShapeInner(root);
    if (existingInner) existingInner.remove();
    root.innerHTML = "";
    container = root;
  } else {
    let inner = findShapeInner(root);
    if (!inner) {
      inner = owner.createElement("div");
      inner.className = SHAPE_INNER_CLASS;
      root.insertBefore(inner, root.firstChild);
    } else {
      inner.className = SHAPE_INNER_CLASS;
    }
    inner.innerHTML = "";
    container = inner;
  }

  const baseColor = voxel.color ?? "#cccccc";
  const surfaceLighting = computeShapeLighting(shape, rawRotation, baseColor);

  return {
    baseColor,
    container,
    lighting: surfaceLighting
  };
}
