import type { ShapeRenderer } from "../types";
import { prepareDimetricShape, applyDimetricShapeClass } from "./dimetricUtils";

export const rampShapeRenderer: ShapeRenderer = ({ voxel, context, root }) => {
  const prepared = prepareDimetricShape({
    shape: "ramp",
    voxel,
    context,
    root,
    options: { mountToRoot: true, pointerSurface: false }
  });
  if (!prepared) return;
  applyDimetricShapeClass(root, "voxcss-dimetric-ramp");
  const doc = prepared.container.ownerDocument ?? document;
  const slope = doc.createElement("div");
  slope.className = "voxcss-ramp-slope";
  slope.dataset.voxFace = "t";
  slope.style.pointerEvents = "auto";

  prepared.container.appendChild(slope);
};
