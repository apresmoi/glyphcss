import type { ShapeRenderer } from "../types";
import { prepareDimetricShape, applyDimetricShapeClass } from "./dimetricUtils";

export const flatShapeRenderer: ShapeRenderer = ({ voxel, context, root }) => {
  const prepared = prepareDimetricShape({
    shape: "flat",
    voxel,
    context,
    root,
    options: { mountToRoot: true, pointerSurface: false }
  });
  if (!prepared) return;
  applyDimetricShapeClass(root, "voxcss-dimetric-flat");
  const doc = prepared.container.ownerDocument ?? document;
  const top = doc.createElement("div");
  top.className = "voxcss-flat-surface";
  top.dataset.voxFace = "t";
  top.style.pointerEvents = "auto";
  prepared.container.appendChild(top);
};
