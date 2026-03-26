import type { GridContext, Voxel, ShapeType, ShapeSurfaceLighting } from "@layoutit/voxcss-core";
import { computeShapeLighting, getVoxelBounds } from "@layoutit/voxcss-core";

const SHAPE_INNER_CLASS = "voxcss-shape-inner";
const ORIENTATION_CLASS_NAMES = ["voxcss-east", "voxcss-south", "voxcss-west", "voxcss-north"];

export interface PreparedShapeResult {
  baseColor: string;
  container: HTMLElement;
  lighting: ShapeSurfaceLighting[];
}

export function getSurfaceColor(prepared: PreparedShapeResult, surfaceId: string): string {
  return prepared.lighting.find((surface) => surface.id === surfaceId)?.color ?? prepared.baseColor;
}

export function resolveSurfaceTexture(
  voxel: Voxel,
  surfaceId: string,
  context: GridContext
): string | undefined {
  const textureKey = voxel.texture;
  if (!textureKey || textureKey.startsWith("#")) return undefined;
  const resolved = context.resolveTexture?.(textureKey, surfaceId);
  if (resolved) return resolved;
  if (
    textureKey.startsWith("/") ||
    textureKey.startsWith("./") ||
    textureKey.startsWith("../") ||
    textureKey.startsWith("http://") ||
    textureKey.startsWith("https://") ||
    textureKey.startsWith("data:") ||
    textureKey.includes(".")
  ) {
    return textureKey;
  }
  return undefined;
}

export function applyTextureBrightness(el: HTMLElement, delta: number): void {
  const brightness = Math.max(0, 1 + delta / 200);
  if (Math.abs(brightness - 1) < 0.001) {
    el.style.filter = "";
    return;
  }
  const rounded = Math.round(brightness * 1000) / 1000;
  el.style.filter = `brightness(${rounded})`;
}

export function isBottomOccluded(voxel: Voxel, context: GridContext): boolean {
  const targetZ = Math.floor((voxel.z ?? 0) - 1);
  if (targetZ < 0) return false;
  const { x2, y2 } = getVoxelBounds(voxel);
  for (let x = voxel.x; x < x2; x += 1) {
    for (let y = voxel.y; y < y2; y += 1) {
      if (!context.getVoxel(x, y, targetZ)) {
        return false;
      }
    }
  }
  return true;
}

export function shouldRenderBottom(voxel: Voxel, context: GridContext): boolean {
  if (context.walls?.b) return false;
  return !isBottomOccluded(voxel, context);
}

const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
let slopePatternId = 0;

export interface SvgSlopeDefinition {
  className: string;
  surfaceId: string;
  path: string;
  viewBox?: string;
  width?: string;
  height?: string;
}

export interface SvgSlopeOptions {
  textureUrl?: string;
  brightnessDelta?: number;
}

export function createSvgSlopeElement(
  doc: Document,
  prepared: PreparedShapeResult,
  definition: SvgSlopeDefinition,
  options: SvgSlopeOptions = {}
): HTMLElement {
  const { className, surfaceId, path, viewBox = "0 0 480 480", width = "56", height = "50" } = definition;
  const { textureUrl, brightnessDelta = 0 } = options;
  const slope = doc.createElement("div");
  slope.className = className;
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", viewBox);
  svg.setAttribute("width", width);
  svg.setAttribute("height", height);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.display = "block";
  svg.style.pointerEvents = "none";
  if (textureUrl) {
    applyTextureBrightness(slope, brightnessDelta);
  } else {
    slope.style.filter = "";
  }
  const defs = textureUrl ? doc.createElementNS(SVG_NS, "defs") : null;
  let fillValue = getSurfaceColor(prepared, surfaceId);
  if (textureUrl && defs) {
    const pattern = doc.createElementNS(SVG_NS, "pattern");
    const patternId = `voxcss-slope-texture-${(slopePatternId += 1)}`;
    pattern.setAttribute("id", patternId);
    pattern.setAttribute("patternUnits", "objectBoundingBox");
    pattern.setAttribute("patternContentUnits", "objectBoundingBox");
    pattern.setAttribute("width", "1");
    pattern.setAttribute("height", "1");
    const image = doc.createElementNS(SVG_NS, "image");
    image.setAttribute("width", "1");
    image.setAttribute("height", "1");
    image.setAttribute("preserveAspectRatio", "xMidYMid slice");
    image.setAttribute("href", textureUrl);
    image.setAttributeNS(XLINK_NS, "xlink:href", textureUrl);
    pattern.appendChild(image);
    defs.appendChild(pattern);
    svg.appendChild(defs);
    fillValue = `url(#${patternId})`;
  }
  const pathEl = doc.createElementNS(SVG_NS, "path");
  pathEl.setAttribute("d", path);
  pathEl.setAttribute("fill", fillValue);
  pathEl.setAttribute("stroke", "rgba(0, 0, 0, 0.1)");
  pathEl.setAttribute("stroke-width", "1");
  pathEl.setAttribute("vector-effect", "non-scaling-stroke");
  svg.appendChild(pathEl);
  slope.appendChild(svg);
  return slope;
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

function findShapeInner(root: HTMLElement): HTMLElement | null {
  return root.querySelector<HTMLElement>(`.${SHAPE_INNER_CLASS}`) ?? null;
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
