import type { ShapeRenderer } from "../types";
import { prepareShapeRoot, shouldRenderBottom } from "./shapeUtils";

export const rampShapeRenderer: ShapeRenderer = ({ voxel, context, root }) => {
  const prepared = prepareShapeRoot({
    shape: "ramp",
    voxel,
    context,
    root,
    options: { mountToRoot: true }
  });
  if (!prepared) return;
  root.classList.add("voxcss-ramp");
  const doc = prepared.container.ownerDocument ?? document;
  if (shouldRenderBottom(voxel, context)) {
    const bottom = doc.createElement("div");
    bottom.className = "voxcss-ramp-bottom";
    bottom.style.background = prepared.baseColor;
    prepared.container.appendChild(bottom);
  }
  const slope = doc.createElement("div");
  slope.className = "voxcss-ramp-slope";
  const slopeLighting = prepared.lighting.find((surface) => surface.id === "slope");
  slope.style.background = slopeLighting?.color ?? prepared.baseColor;

  prepared.container.appendChild(slope);
};
