import type { ShapeRenderer } from "../types";
import { prepareShapeRoot, createSvgSlopeElement } from "./shapeUtils";

export const wedgeShapeRenderer: ShapeRenderer = ({ voxel, context, root }) => {
  const prepared = prepareShapeRoot({
    shape: "wedge",
    voxel,
    context,
    root,
    options: { mountToRoot: true }
  });
  if (!prepared) return;
  root.classList.add("voxcss-wedge");
  const doc = prepared.container.ownerDocument ?? document;
  const primarySlope = createSvgSlopeElement(doc, prepared, {
    className: "voxcss-wedge-slope voxcss-wedge-slope--primary",
    surfaceId: "primary",
    path: "M0 0 L480 0 L0 480 Z"
  });
  const secondarySlope = createSvgSlopeElement(doc, prepared, {
    className: "voxcss-wedge-slope voxcss-wedge-slope--secondary",
    surfaceId: "secondary",
    path: "M480 480 L0 480 L480 0 Z",
    width: "50",
    height: "56"
  });
  prepared.container.appendChild(primarySlope);
  prepared.container.appendChild(secondarySlope);
};
