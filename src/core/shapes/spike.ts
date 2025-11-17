import type { ShapeRenderer } from "../types";
import { prepareDimetricShape, applyDimetricShapeClass } from "./dimetricUtils";

export const spikeShapeRenderer: ShapeRenderer = ({ voxel, context, root }) => {
  const prepared = prepareDimetricShape({
    shape: "spike",
    voxel,
    context,
    root,
    options: { mountToRoot: true, pointerSurface: false }
  });
  if (!prepared) return;
  applyDimetricShapeClass(root, "voxcss-dimetric-spike");
  const doc = prepared.container.ownerDocument ?? document;
  const svgNS = "http://www.w3.org/2000/svg";
  const slopePrimary = doc.createElement("div");
  slopePrimary.className = "voxcss-spike-slope voxcss-spike-slope--primary";
  slopePrimary.dataset.voxFace = "t";
  slopePrimary.style.pointerEvents = "auto";
  slopePrimary.style.background = "transparent";
  const svg = doc.createElementNS(svgNS, "svg");
  svg.setAttribute("viewBox", "0 0 480 480");
  svg.setAttribute("width", "56");
  svg.setAttribute("height", "50");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("xmlns", svgNS);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.display = "block";
  svg.style.pointerEvents = "none";
  const path = doc.createElementNS(svgNS, "path");
  path.setAttribute("d", "M480 0 L480 480 L0 480 Z");
  path.setAttribute(
    "fill",
    "var(--voxcss-dim-surface-primary, var(--voxcss-dim-color, #63c74d))"
  );
  path.setAttribute("stroke", "rgba(0, 0, 0, 0.1)");
  path.setAttribute("stroke-width", "1");
  path.setAttribute("vector-effect", "non-scaling-stroke");
  svg.appendChild(path);
  slopePrimary.appendChild(svg);

  const slopeSecondary = doc.createElement("div");
  slopeSecondary.className = "voxcss-spike-slope voxcss-spike-slope--secondary";
  slopeSecondary.dataset.voxFace = "t";
  slopeSecondary.style.pointerEvents = "auto";
  slopeSecondary.style.background = "transparent";
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
  pathSecondary.setAttribute("d", "M0 0 L0 480 L480 0 Z");
  pathSecondary.setAttribute(
    "fill",
    "var(--voxcss-dim-surface-secondary, var(--voxcss-dim-color, #63c74d))"
  );
  pathSecondary.setAttribute("stroke", "rgba(0, 0, 0, 0.1)");
  pathSecondary.setAttribute("stroke-width", "1");
  pathSecondary.setAttribute("vector-effect", "non-scaling-stroke");
  svgSecondary.appendChild(pathSecondary);
  slopeSecondary.appendChild(svgSecondary);

  prepared.container.appendChild(slopePrimary);
  prepared.container.appendChild(slopeSecondary);
};
