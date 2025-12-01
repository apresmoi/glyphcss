import type { ShapeRenderer } from "../types";
import {
  applyTextureBrightness,
  prepareShapeRoot,
  resolveSurfaceTexture,
  shouldRenderBottom
} from "./shapeUtils";

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
    const bottomTexture = resolveSurfaceTexture(voxel, "bottom", context);
    if (bottomTexture) {
      bottom.style.backgroundImage = `url(${bottomTexture})`;
      bottom.style.backgroundColor = "";
      applyTextureBrightness(bottom, 0);
    } else {
      bottom.style.backgroundImage = "";
      bottom.style.filter = "";
      bottom.style.backgroundColor = prepared.baseColor;
    }
    prepared.container.appendChild(bottom);
  }
  const slope = doc.createElement("div");
  slope.className = "voxcss-ramp-slope";
  slope.style.backgroundSize = "70px 50px";
  const slopeLighting = prepared.lighting.find((surface) => surface.id === "slope");
  const slopeTexture = resolveSurfaceTexture(voxel, "slope", context);
  if (slopeTexture) {
    slope.style.backgroundImage = `url(${slopeTexture})`;
    slope.style.backgroundColor = "";
    applyTextureBrightness(slope, slopeLighting?.delta ?? 0);
  } else {
    slope.style.backgroundImage = "";
    slope.style.filter = "";
    slope.style.backgroundColor = slopeLighting?.color ?? prepared.baseColor;
  }

  prepared.container.appendChild(slope);
};
