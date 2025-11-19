import type { ShapeRenderer } from "../types";
import { prepareShapeRoot, createSvgSlopeElement } from "./shapeUtils";

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
  const primarySlope = createSvgSlopeElement(doc, prepared, {
    className: "voxcss-spike-slope voxcss-spike-slope--primary",
    surfaceId: "primary",
    path: "M480 0 L480 480 L0 480 Z"
  });
  const secondarySlope = createSvgSlopeElement(doc, prepared, {
    className: "voxcss-spike-slope voxcss-spike-slope--secondary",
    surfaceId: "secondary",
    path: "M0 0 L0 480 L480 0 Z",
    width: "50",
    height: "56"
  });
  prepared.container.appendChild(primarySlope);
  prepared.container.appendChild(secondarySlope);
};
