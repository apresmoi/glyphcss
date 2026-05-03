import type { ShapeRenderer } from "../types";
import { prepareShapeRoot } from "./shapeUtils";

const SVG_NS = "http://www.w3.org/2000/svg";
const REF = 100; // arbitrary SVG-local reference size; the matrix3d scales it.

/**
 * Triangle shape — renders an arbitrary 3D triangle from 3 vertices.
 *
 * The voxel must specify `shape: "triangle"` and `vertices: [v0, v1, v2]`
 * where each vertex is integer-grid (or float) cell-space coordinates.
 *
 * Approach: create a flat SVG triangle at local 2D coords (0,0)-(REF,0)-(0,REF),
 * then apply CSS matrix3d so that local-(0,0) maps to v0, local-(REF,0) to v1,
 * and local-(0,REF) to v2 — all relative to the voxel's bbox-min corner where
 * voxcss has already placed the root container.
 */
export const triangleShapeRenderer: ShapeRenderer = ({ voxel, context, root }) => {
  const prepared = prepareShapeRoot({
    shape: "triangle" as never,
    voxel,
    context,
    root,
    options: { mountToRoot: true }
  });
  if (!prepared) return;
  if (!voxel.vertices || voxel.vertices.length !== 3) return;

  root.classList.add("voxcss-triangle");
  // 3D transforms on the SVG child only render correctly when the parent has
  // preserve-3d. Voxcss's .voxcss-cube class sets this implicitly; for triangle
  // we have to set it on the voxel root ourselves.
  root.style.transformStyle = "preserve-3d";
  root.style.overflow = "visible";
  const doc = prepared.container.ownerDocument ?? document;

  const tile = context.tileSize ?? 50;
  const elev = context.layerElevation ?? 50;

  const [v0, v1, v2] = voxel.vertices;

  // Vertex positions in CSS pixel coords, relative to the voxel root which
  // voxcss has placed at the bbox-min corner. Voxcss's CSS Grid puts voxel.x
  // at row (CSS-y axis), voxel.y at column (CSS-x axis), so we swap.
  const px = (v: [number, number, number]) => [
    (v[1] - voxel.y) * tile,  // voxel.y → CSS-x (horizontal)
    (v[0] - voxel.x) * tile,  // voxel.x → CSS-y (depth)
    (v[2] - voxel.z) * elev,  // voxel.z → CSS-z (elevation)
  ];
  const p0 = px(v0);
  const p1 = px(v1);
  const p2 = px(v2);

  // Build matrix3d that maps SVG-local 2D coords to 3D world positions:
  //   local (0,    0)   → p0
  //   local (REF,  0)   → p1
  //   local (0,    REF) → p2
  // Columns 1-2 are the per-local-unit basis vectors (in pixels).
  // Column 3 is the surface normal (used for backface-visibility).
  // Column 4 is the translation (p0 in pixels).
  const u = [(p1[0] - p0[0]) / REF, (p1[1] - p0[1]) / REF, (p1[2] - p0[2]) / REF];
  const v = [(p2[0] - p0[0]) / REF, (p2[1] - p0[1]) / REF, (p2[2] - p0[2]) / REF];
  // Negate the right-hand cross product: CSS is left-handed (y is down) and the
  // voxel.x↔voxel.y swap above inverts handedness. Negating recovers the true
  // outward normal so backface-visibility hides the correct side.
  let nx = -(u[1] * v[2] - u[2] * v[1]);
  let ny = -(u[2] * v[0] - u[0] * v[2]);
  let nz = -(u[0] * v[1] - u[1] * v[0]);
  const nlen = Math.hypot(nx, ny, nz) || 1;
  nx /= nlen; ny /= nlen; nz /= nlen;

  // CSS matrix3d is column-major: (m11, m12, m13, m14, m21, m22, m23, m24,
  // m31, m32, m33, m34, m41, m42, m43, m44).
  const matrix = [
    u[0], u[1], u[2], 0,
    v[0], v[1], v[2], 0,
    nx, ny, nz, 0,
    p0[0], p0[1], p0[2], 1,
  ];

  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${REF} ${REF}`);
  svg.setAttribute("width", String(REF));
  svg.setAttribute("height", String(REF));
  svg.setAttribute("preserveAspectRatio", "none");
  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.overflow = "visible";
  svg.style.transformOrigin = "0 0";
  svg.style.transform = `matrix3d(${matrix.join(",")})`;
  // Hide the back side. Without this, voxcss renders BOTH sides of every
  // triangle — so when a face is back-facing the camera, you still see a
  // mirrored copy of it overlapping front faces from other angles.
  svg.style.backfaceVisibility = "hidden";
  svg.style.pointerEvents = "none";

  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", `M 0 0 L ${REF} 0 L 0 ${REF} Z`);
  path.setAttribute("fill", prepared.baseColor);
  path.setAttribute("stroke", "rgba(0,0,0,0.15)");
  path.setAttribute("stroke-width", "1");
  path.setAttribute("vector-effect", "non-scaling-stroke");
  svg.appendChild(path);

  prepared.container.appendChild(svg);

  // Optional debug: render a back-face sibling SVG with reversed normal,
  // tinted in a debug color. Visible only when the camera looks at the back
  // (the front SVG is backface-hidden from that side).
  if (context.debugShowBackfaces) {
    const backMatrix = [
      u[0], u[1], u[2], 0,
      v[0], v[1], v[2], 0,
      -nx, -ny, -nz, 0,
      p0[0], p0[1], p0[2], 1,
    ];
    const backSvg = doc.createElementNS(SVG_NS, "svg");
    backSvg.setAttribute("viewBox", `0 0 ${REF} ${REF}`);
    backSvg.setAttribute("width", String(REF));
    backSvg.setAttribute("height", String(REF));
    backSvg.setAttribute("preserveAspectRatio", "none");
    backSvg.style.position = "absolute";
    backSvg.style.left = "0";
    backSvg.style.top = "0";
    backSvg.style.overflow = "visible";
    backSvg.style.transformOrigin = "0 0";
    backSvg.style.transform = `matrix3d(${backMatrix.join(",")})`;
    backSvg.style.backfaceVisibility = "hidden";
    backSvg.style.pointerEvents = "none";
    const backPath = doc.createElementNS(SVG_NS, "path");
    backPath.setAttribute("d", `M 0 0 L ${REF} 0 L 0 ${REF} Z`);
    backPath.setAttribute("fill", "rgba(249, 115, 22, 0.55)");
    backPath.setAttribute("stroke", "rgba(249, 115, 22, 0.9)");
    backPath.setAttribute("stroke-width", "1");
    backPath.setAttribute("stroke-dasharray", "3,2");
    backPath.setAttribute("vector-effect", "non-scaling-stroke");
    backSvg.appendChild(backPath);
    prepared.container.appendChild(backSvg);
  }
};
