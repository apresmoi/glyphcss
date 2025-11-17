import type { ShapeRenderer, GridContext, Voxel, CubeFace } from "../types";
import { CUBE_CLASS, FACE_CLASS } from "../types";
import { computeVisibleFaces } from "../visibility";
import { shadeCubeFace } from "../lighting";

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
  const faces = precomputedFaces ?? computeVisibleFaces(voxel, context);
  if (!faces.length) {
    root.style.display = "none";
    disposeCubeDom(root);
    return;
  }

  root.style.display = "";
  root.classList.add(CUBE_CLASS);

  const cachedFaces = ensureCubeDomCache(root);

  const half = context.layerElevation / 2;
  const size = `${context.tileSize}px`;

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
  const textureKey = voxel.texture;

  if (textureKey) {
    const textureUrl =
      context.resolveTexture?.(textureKey, face) ??
      (textureKey.includes("/") ? textureKey : undefined);
    if (textureUrl) {
      el.style.backgroundImage = `url(${textureUrl})`;
      el.style.backgroundColor = "";
      return;
    }
  }
  let customImageApplied = false;
  let customColorApplied = false;
  const custom = context.lighting?.(voxel, face);
  if (custom) {
    if (custom.backgroundImage !== undefined) {
      el.style.backgroundImage = custom.backgroundImage ?? "";
      customImageApplied = true;
    }
    if (custom.backgroundColor !== undefined) {
      el.style.backgroundColor = custom.backgroundColor ?? "";
      customColorApplied = true;
    }
  }
  if (!customImageApplied) {
    el.style.backgroundImage = "";
  }
  if (customColorApplied) {
    return;
  }
  const baseColor = voxel.color ?? "#cccccc";
  const shaded = shadeCubeFace(baseColor, face);
  el.style.backgroundColor = shaded;
}
