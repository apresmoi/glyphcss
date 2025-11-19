import type { ShapeRenderer } from "../types";
import { prepareShapeRoot, markElementFace } from "./shapeUtils";

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
  const svgNS = "http://www.w3.org/2000/svg";
  const slopePrimary = doc.createElement("div");
  slopePrimary.className = "voxcss-wedge-slope voxcss-wedge-slope--primary";
  const svgPrimary = doc.createElementNS(svgNS, "svg");
  svgPrimary.setAttribute("viewBox", "0 0 480 480");
  svgPrimary.setAttribute("width", "56");
  svgPrimary.setAttribute("height", "50");
  svgPrimary.setAttribute("preserveAspectRatio", "none");
  svgPrimary.setAttribute("xmlns", svgNS);
  svgPrimary.setAttribute("aria-hidden", "true");
  svgPrimary.setAttribute("focusable", "false");
  svgPrimary.style.position = "absolute";
  svgPrimary.style.inset = "0";
  svgPrimary.style.width = "100%";
  svgPrimary.style.height = "100%";
  svgPrimary.style.display = "block";
  svgPrimary.style.pointerEvents = "none";
  const pathPrimary = doc.createElementNS(svgNS, "path");
  pathPrimary.setAttribute("d", "M0 0 L480 0 L0 480 Z");
  const primaryColor =
    prepared.lighting.find((surface) => surface.id === "primary")?.color ?? "#cccccc";
  pathPrimary.setAttribute("fill", primaryColor);
  pathPrimary.setAttribute("stroke", "rgba(0, 0, 0, 0.1)");
  pathPrimary.setAttribute("stroke-width", "1");
  pathPrimary.setAttribute("vector-effect", "non-scaling-stroke");
  svgPrimary.appendChild(pathPrimary);
  slopePrimary.appendChild(svgPrimary);

  const slopeSecondary = doc.createElement("div");
  slopeSecondary.className = "voxcss-wedge-slope voxcss-wedge-slope--secondary";
  const svgSecondary = doc.createElementNS(svgNS, "svg");
  svgSecondary.setAttribute("viewBox", "0 0 480 480");
  svgSecondary.setAttribute("width", "50");
  svgSecondary.setAttribute("height", "56");
  svgSecondary.setAttribute("preserveAspectRatio", "none");
  svgSecondary.setAttribute("xmlns", svgNS);
  svgSecondary.setAttribute("aria-hidden", "true");
  svgSecondary.setAttribute("focusable", "false");
  svgSecondary.style.position = "absolute";
  svgSecondary.style.inset = "0";
  svgSecondary.style.width = "100%";
  svgSecondary.style.height = "100%";
  svgSecondary.style.display = "block";
  svgSecondary.style.pointerEvents = "none";
  const pathSecondary = doc.createElementNS(svgNS, "path");
  pathSecondary.setAttribute("d", "M480 480 L0 480 L480 0 Z");
  const secondaryColor =
    prepared.lighting.find((surface) => surface.id === "secondary")?.color ?? "#cccccc";
  pathSecondary.setAttribute("fill", secondaryColor);
  pathSecondary.setAttribute("stroke", "rgba(0, 0, 0, 0.1)");
  pathSecondary.setAttribute("stroke-width", "1");
  pathSecondary.setAttribute("vector-effect", "non-scaling-stroke");
  svgSecondary.appendChild(pathSecondary);
  slopeSecondary.appendChild(svgSecondary);

  markElementFace(slopePrimary, "t");
  markElementFace(slopeSecondary, "t");

  prepared.container.appendChild(slopePrimary);
  prepared.container.appendChild(slopeSecondary);
};
