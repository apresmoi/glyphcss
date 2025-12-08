import type { ShapeRenderer, GridContext, Voxel, CubeFace } from "../types";
import { CUBE_CLASS, FACE_CLASS } from "../types";
import { computeVisibleFaces } from "../visibility";
import { shadeCubeFace, getCubeFaceLightDelta } from "../lighting";

const cubeDomCache = new WeakMap<HTMLElement, Map<CubeFace, HTMLElement>>();

export function ensureCubeDomCache(root: HTMLElement): Map<CubeFace, HTMLElement> {
  let faces = cubeDomCache.get(root);
  if (!faces) {
    root.innerHTML = "";
    faces = new Map();
    cubeDomCache.set(root, faces);
  }
  return faces;
}

export function disposeCubeDom(root: HTMLElement): void {
  const faces = cubeDomCache.get(root);
  if (!faces) return;
  for (const face of faces.values()) {
    face.remove();
  }
  faces.clear();
  cubeDomCache.delete(root);
  root.innerHTML = "";
}

export const cubeShapeRenderer: ShapeRenderer = ({
  voxel,
  context,
  root,
  precomputedFaces
}) => {
  const tile = context.tileSize ?? 50;
  const layer = context.layerElevation ?? tile;
  const spanX = Math.max(1, (voxel.x2 ?? voxel.x + 1) - voxel.x) * tile;
  const spanY = Math.max(1, (voxel.y2 ?? voxel.y + 1) - voxel.y) * tile;
  const tileHalf = tile / 2;
  const offsetSpanX = spanX > tile ? spanX - tileHalf : tileHalf;
  const offsetSpanY = spanY > tile ? spanY - tileHalf : tileHalf;
  root.style.setProperty("--voxcss-side-offset-x", `${offsetSpanX}px`);
  root.style.setProperty("--voxcss-side-offset-y", `${offsetSpanY}px`);
  root.style.setProperty("--voxcss-fr-offset", `${spanY}px`);
  const faces = precomputedFaces ?? computeVisibleFaces(voxel, context);
  if (!faces.length) {
    root.style.display = "none";
    disposeCubeDom(root);
    return;
  }

  root.style.display = "";
  root.classList.add(CUBE_CLASS);

  const cachedFaces = ensureCubeDomCache(root);

  const visibleSet = new Set(faces);
  for (const [face, faceEl] of Array.from(cachedFaces.entries())) {
    if (!visibleSet.has(face)) {
      faceEl.remove();
      cachedFaces.delete(face);
    }
  }

  for (const face of faces) {
    let faceEl = cachedFaces.get(face);
    if (!faceEl) {
      faceEl = root.ownerDocument?.createElement("div") ?? document.createElement("div");
      faceEl.className = `${FACE_CLASS} ${FACE_CLASS}--${face}`;
      root.appendChild(faceEl);
      cachedFaces.set(face, faceEl);
    } else if (faceEl.parentElement !== root) {
      root.appendChild(faceEl);
    }
    applyFaceAppearance(faceEl, face, voxel, context);
  }
};

function applyFaceAppearance(
  el: HTMLElement,
  face: CubeFace,
  voxel: Voxel,
  context: GridContext
): void {
  const textureUrl = resolveTextureUrl(voxel, face, context);
  const hasTexture = Boolean(textureUrl);

  if (hasTexture && textureUrl) {
    el.style.backgroundImage = `url(${textureUrl})`;
  } else {
    el.style.backgroundImage = "";
  }

  let customColorApplied = false;
  let customFilterApplied = false;
  const custom = context.lighting?.(voxel, face);
  if (custom) {
    if (custom.backgroundImage !== undefined) {
      el.style.backgroundImage = custom.backgroundImage ?? "";
    }
    if (custom.backgroundColor !== undefined) {
      el.style.backgroundColor = custom.backgroundColor ?? "";
      customColorApplied = true;
    }
    if (custom.filter !== undefined) {
      el.style.filter = custom.filter ?? "";
      customFilterApplied = true;
    }
  }

  if (hasTexture && !customFilterApplied) {
    applyTextureLighting(el, face);
  } else if (!customFilterApplied) {
    el.style.filter = "";
  }

  if (!customColorApplied) {
    if (hasTexture) {
      el.style.backgroundColor = "";
    } else {
      const baseColor = voxel.color ?? "#cccccc";
      const shaded = shadeCubeFace(baseColor, face);
      el.style.backgroundColor = shaded;
    }
  }
}

function resolveTextureUrl(
  voxel: Voxel,
  face: CubeFace,
  context: GridContext
): string | undefined {
  const textureKey = voxel.texture;
  if (!textureKey || textureKey.startsWith("#")) return undefined;
  const resolved = context.resolveTexture?.(textureKey, face);
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

function applyTextureLighting(el: HTMLElement, face: CubeFace): void {
  const delta = getCubeFaceLightDelta(face);
  const brightness = Math.max(0, 1 + delta / 200);
  if (Math.abs(brightness - 1) < 0.001) {
    el.style.filter = "";
  } else {
    const rounded = Math.round(brightness * 1000) / 1000;
    el.style.filter = `brightness(${rounded})`;
  }
}
