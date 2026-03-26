import type { CubeFace, GridContext, Voxel } from "@layoutit/voxcss-core";
import type { ShapeRenderer } from "../types";
import { CUBE_CLASS, FACE_CLASS, computeVisibleFaces, computeCubeFaceAppearance } from "@layoutit/voxcss-core";

function applyCubeFaceAppearance(
  el: HTMLElement,
  face: CubeFace,
  voxel: Voxel,
  context: GridContext
): void {
  const appearance = computeCubeFaceAppearance(voxel, face, context);
  el.style.backgroundImage = appearance.backgroundImage;
  el.style.backgroundColor = appearance.backgroundColor;
  el.style.filter = appearance.filter;
}

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
    applyCubeFaceAppearance(faceEl, face, voxel, context);
  }
};
