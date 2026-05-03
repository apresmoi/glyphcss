import type { ShapeInnerProps } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";

// Defaults for triangle/polygon Lambert shading. Direction is in scene-
// local CSS-pixel coords: +X = right, +Y = down (CSS), +Z = toward viewer.
// "Upper-front-right" key light. Override per-scene via VoxScene's
// `directionalLight` prop.
const DEFAULT_LIGHT_DIR: [number, number, number] = [0.4, -0.7, 0.59];
const DEFAULT_LIGHT_COLOR = "#ffffff";
const DEFAULT_AMBIENT_COLOR = "#ffffff";
const DEFAULT_AMBIENT = 0.45;

interface RGB { r: number; g: number; b: number; }

function parseHex(hex: string): RGB {
  const c = hex.startsWith("#") ? hex.slice(1) : hex;
  if (c.length !== 6) return { r: 255, g: 255, b: 255 };
  return {
    r: parseInt(c.slice(0, 2), 16),
    g: parseInt(c.slice(2, 4), 16),
    b: parseInt(c.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }: RGB): string {
  const f = (n: number) =>
    Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${f(r)}${f(g)}${f(b)}`;
}

/**
 * Shade `baseColor` by the Lambert factor, modulated by separate light /
 * ambient tints. Each channel is multiplied independently so a warm light
 * (#ffe4a8) on a blue surface (#0080ff) produces the natural muted tone
 * you'd expect — not just a brightness scale.
 *
 *   shaded = (ambientStrength · ambientColor + lambert · lightColor) · base
 */
function shadeTriangle(
  baseColor: string,
  lambert: number,
  lightColor: string,
  ambientColor: string,
  ambientStrength: number,
): string {
  const base = parseHex(baseColor);
  const light = parseHex(lightColor);
  const amb = parseHex(ambientColor);
  // Both light and ambient contribute as channel-wise multipliers in [0, 1].
  // Compose the effective tint and apply to the base color.
  const tintR = (amb.r / 255) * ambientStrength + (light.r / 255) * lambert;
  const tintG = (amb.g / 255) * ambientStrength + (light.g / 255) * lambert;
  const tintB = (amb.b / 255) * ambientStrength + (light.b / 255) * lambert;
  return rgbToHex({
    r: base.r * tintR,
    g: base.g * tintG,
    b: base.b * tintB,
  });
}

/**
 * Triangle shape — renders an arbitrary 3D triangle from `voxel.vertices`.
 *
 * Public API: `{ shape: "triangle", vertices: [v0, v1, v2], color }`.
 * The bbox (x, y, z, x2, y2, z2) is auto-computed from vertex extents and
 * is what voxcss uses to position the wrapper element via CSS Grid.
 *
 * Implementation: builds an ORTHONORMAL coordinate frame from the triangle's
 * own geometry (x-axis along v1-v0, y-axis perpendicular within the plane,
 * z-axis = plane normal) and uses CSS matrix3d to map the SVG's flat 2D
 * content onto that frame. SVG path coords are computed in the triangle's
 * own 2D plane, so the output is always exactly the triangle described.
 */
export function Triangle({ voxel, context, baseColor }: ShapeInnerProps) {
  if (!voxel.vertices || voxel.vertices.length < 3) return null;
  const tile = context.tileSize ?? 50;
  const elev = context.layerElevation ?? 50;

  // Voxcss's CSS Grid puts voxel.x at row (CSS-y axis), voxel.y at column
  // (CSS-x axis). So when converting voxel-coord vertices to CSS pixels
  // (relative to the wrapper, which sits at the bbox-min corner), we swap.
  const toCss = (v: [number, number, number]): [number, number, number] => [
    (v[1] - voxel.y) * tile, // voxel.y → CSS-x (horizontal)
    (v[0] - voxel.x) * tile, // voxel.x → CSS-y (depth)
    (v[2] - voxel.z) * elev, // voxel.z → CSS-z (elevation)
  ];
  const pts = voxel.vertices.map(toCss);
  const p0 = pts[0];
  const p1 = pts[1];
  const p2 = pts[2];

  // Edge vectors in 3D CSS-pixel space — first two edges define the plane.
  const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  const L01 = Math.hypot(e1[0], e1[1], e1[2]);
  if (L01 === 0) return null;

  // Orthonormal basis of the triangle's plane.
  const xAxis = [e1[0] / L01, e1[1] / L01, e1[2] / L01];
  // Plane normal: -(e1 × e2). Right-hand cross product on a CCW-in-voxel-space
  // polygon gives a normal in the WRONG direction once we map to CSS coords —
  // CSS is left-handed (y is down), so the swap voxel.x↔voxel.y inverts
  // handedness. Negating recovers the true outward normal, which is what
  // CSS backface-visibility needs to determine "front" vs "back".
  let nx = -(e1[1] * e2[2] - e1[2] * e2[1]);
  let ny = -(e1[2] * e2[0] - e1[0] * e2[2]);
  let nz = -(e1[0] * e2[1] - e1[1] * e2[0]);
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen === 0) return null;
  nx /= nLen; ny /= nLen; nz /= nLen;
  // y-axis perpendicular to x-axis within the plane: y = n × x.
  const yAxis = [
    ny * xAxis[2] - nz * xAxis[1],
    nz * xAxis[0] - nx * xAxis[2],
    nx * xAxis[1] - ny * xAxis[0],
  ];

  // Project every vertex onto the (xAxis, yAxis) plane. v0 sits at origin
  // (0,0), v1 at (L01, 0), v2..vN computed via dot products. This works for
  // any N ≥ 3 — triangles, quads, pentagons, arbitrary convex polygons —
  // as long as the input vertices are coplanar.
  const local2D = pts.map((p): [number, number] => {
    const dx = p[0] - p0[0], dy = p[1] - p0[1], dz = p[2] - p0[2];
    return [
      dx * xAxis[0] + dy * xAxis[1] + dz * xAxis[2],
      dx * yAxis[0] + dy * yAxis[1] + dz * yAxis[2],
    ];
  });

  // SVG viewBox must enclose the polygon. Shift so all coords ≥ 0.
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const [x, y] of local2D) {
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
  }
  const shiftX = -xMin;
  const shiftY = -yMin;
  const w = xMax - xMin;
  const h = yMax - yMin;
  const pathParts: string[] = [];
  for (let i = 0; i < local2D.length; i++) {
    const [x, y] = local2D[i];
    pathParts.push(`${i === 0 ? "M" : "L"} ${x + shiftX} ${y + shiftY}`);
  }
  pathParts.push("Z");
  const pathStr = pathParts.join(" ");

  // Matrix3d translation = world position of SVG-local (0, 0):
  //   p0 - shiftX * xAxis - shiftY * yAxis
  // (Subtracting the shift so the shifted-origin corner lands at p0 + ...
  // when we then add the shifted local coords.)
  const tx = p0[0] - shiftX * xAxis[0] - shiftY * yAxis[0];
  const ty = p0[1] - shiftX * xAxis[1] - shiftY * yAxis[1];
  const tz = p0[2] - shiftX * xAxis[2] - shiftY * yAxis[2];

  const matrix = [
    xAxis[0], xAxis[1], xAxis[2], 0,
    yAxis[0], yAxis[1], yAxis[2], 0,
    nx, ny, nz, 0,
    tx, ty, tz, 1,
  ].join(",");

  // Per-triangle directional lighting. Pull config from the scene context
  // (set by VoxScene's `directionalLight` prop) with sane defaults.
  // Computed once at render — no per-frame work, no GPU shaders. As the
  // user rotates the scene, different triangles become visible (others get
  // backface-culled), each with the brightness it was assigned at mount.
  const lightCfg = context.directionalLight;
  const lightDir = lightCfg?.direction ?? DEFAULT_LIGHT_DIR;
  const lightColor = lightCfg?.color ?? DEFAULT_LIGHT_COLOR;
  const ambientColor = lightCfg?.ambientColor ?? DEFAULT_AMBIENT_COLOR;
  const ambient = lightCfg?.ambient ?? DEFAULT_AMBIENT;
  const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const lx = lightDir[0] / lLen, ly = lightDir[1] / lLen, lz = lightDir[2] / lLen;
  const direct = Math.max(0, 1 - ambient);
  const lambert = direct * Math.max(0, nx * lx + ny * ly + nz * lz);
  const shadedColor = shadeTriangle(baseColor, lambert, lightColor, ambientColor, ambient);

  // Same matrix3d but with the normal flipped — represents the BACK face.
  // We render it as a second sibling SVG when debugShowBackfaces is on, so
  // when the camera looks at the back of the triangle (where the front SVG
  // gets backface-hidden), this one comes into view tinted in a debug color.
  const backMatrix = [
    xAxis[0], xAxis[1], xAxis[2], 0,
    yAxis[0], yAxis[1], yAxis[2], 0,
    -nx, -ny, -nz, 0,
    tx, ty, tz, 1,
  ].join(",");

  const front = (
    <svg
      xmlns={SVG_NS}
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        overflow: "visible",
        transformOrigin: "0 0",
        transform: `matrix3d(${matrix})`,
        // Hide the back side. Without this, voxcss renders BOTH sides of every
        // triangle — so when a face is back-facing the camera, you still see a
        // mirrored copy of it overlapping front faces from other angles.
        backfaceVisibility: "hidden",
        pointerEvents: "none",
      }}
    >
      <path
        d={pathStr}
        fill={shadedColor}
        stroke="rgba(0,0,0,0.15)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );

  if (!context.debugShowBackfaces) return front;

  return (
    <>
      {front}
      <svg
        xmlns={SVG_NS}
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
        preserveAspectRatio="none"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          overflow: "visible",
          transformOrigin: "0 0",
          transform: `matrix3d(${backMatrix})`,
          backfaceVisibility: "hidden",
          pointerEvents: "none",
        }}
      >
        <path
          d={pathStr}
          fill="rgba(249, 115, 22, 0.55)"
          stroke="rgba(249, 115, 22, 0.9)"
          strokeWidth={1}
          strokeDasharray="3,2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </>
  );
}
