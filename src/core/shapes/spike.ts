import type { ShapeRenderer } from "../types";
import {
  applyTextureBrightness,
  createSvgSlopeElement,
  prepareShapeRoot,
  resolveSurfaceTexture,
  shouldRenderBottom
} from "./shapeUtils";

export const spikeShapeRenderer: ShapeRenderer = ({ voxel, context, root }) => {
  const prepared = prepareShapeRoot({
    shape: "spike",
    voxel,
    context,
    root,
    options: { mountToRoot: true }
  });
  if (!prepared) return;
  root.classList.add("voxcss-spike");
  const doc = prepared.container.ownerDocument ?? document;
  if (shouldRenderBottom(voxel, context)) {
    const bottom = doc.createElement("div");
    bottom.className = "voxcss-spike-bottom";
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
  const primaryLighting = prepared.lighting.find((surface) => surface.id === "primary");
  const secondaryLighting = prepared.lighting.find((surface) => surface.id === "secondary");
  const primaryTexture = resolveSurfaceTexture(voxel, "primary", context);
  const secondaryTexture = resolveSurfaceTexture(voxel, "secondary", context);
  const primarySlope = createSvgSlopeElement(doc, prepared, {
    className: "voxcss-spike-slope voxcss-spike-slope--primary",
    surfaceId: "primary",
    path: "M480 0 L480 480 L0 480 Z"
  }, { textureUrl: primaryTexture, brightnessDelta: primaryLighting?.delta ?? 0 });
  const secondarySlope = createSvgSlopeElement(doc, prepared, {
    className: "voxcss-spike-slope voxcss-spike-slope--secondary",
    surfaceId: "secondary",
    path: "M0 0 L0 480 L480 0 Z",
    width: "50",
    height: "56"
  }, { textureUrl: secondaryTexture, brightnessDelta: secondaryLighting?.delta ?? 0 });
  prepared.container.appendChild(primarySlope);
  prepared.container.appendChild(secondarySlope);
};
