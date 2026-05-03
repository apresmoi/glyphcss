import type { CubeFace, GridContext, Voxel } from "@layoutit/voxcss-core";
import type { ShapeRenderer } from "../types";
import { CUBE_CLASS, FACE_CLASS, computeVisibleFaces, computeCubeFaceAppearance, getVoxelZBounds, computeShapeStyle } from "@layoutit/voxcss-core";

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
  const tileHalf = tile / 2;
  const spanXCells = Math.max(1, (voxel.x2 ?? voxel.x + 1) - voxel.x);
  const spanYCells = Math.max(1, (voxel.y2 ?? voxel.y + 1) - voxel.y);
  // Use the same formula as the React VoxCube: spanCells * halfTile.
  // This represents the half-extent of the container in each direction; the
  // CSS for the side faces (incl. the pre-translate fix for tall cubes) is
  // tuned for this convention.
  root.style.setProperty("--voxcss-side-offset-x", `${spanXCells * tileHalf}px`);
  root.style.setProperty("--voxcss-side-offset-y", `${spanYCells * tileHalf}px`);
  root.style.setProperty("--voxcss-fr-offset", `${spanYCells * tile}px`);

  // Apply elevation override when the cube spans multiple z layers
  // (layer-as-anchor model: one DOM element, visually extends via CSS var).
  const { z, z2: zEnd } = getVoxelZBounds(voxel);
  if (zEnd - z > 1) {
    const spanStyle = computeShapeStyle(voxel, context);
    for (const [prop, value] of Object.entries(spanStyle)) {
      root.style.setProperty(prop, value);
    }
  }

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
