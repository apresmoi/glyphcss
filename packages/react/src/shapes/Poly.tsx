import { useEffect, useRef } from "react";
import type React from "react";
import type { PolyProps } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Module-level image cache so multiple textured polygons sharing the same
 * texture URL only download / decode it once. Each cache entry is the
 * Promise of an HTMLImageElement — late-arriving consumers `.then(img)` and
 * draw onto their canvas as soon as the bitmap is available.
 */
const TEXTURE_IMAGE_CACHE = new Map<string, Promise<HTMLImageElement>>();
function loadTextureImage(url: string): Promise<HTMLImageElement> {
  let p = TEXTURE_IMAGE_CACHE.get(url);
  if (!p) {
    p = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`texture load failed: ${url}`));
      img.src = url;
    });
    TEXTURE_IMAGE_CACHE.set(url, p);
  }
  return p;
}

// Defaults for polygon Lambert shading. Direction is in scene-
// local CSS-pixel coords: +X = right, +Y = down (CSS), +Z = toward viewer.
// "Upper-front-right" key light. Override per-scene via PolyScene's
// `directionalLight` prop.
const DEFAULT_LIGHT_DIR: [number, number, number] = [0.4, -0.7, 0.59];
const DEFAULT_LIGHT_COLOR = "#ffffff";
const DEFAULT_AMBIENT_COLOR = "#ffffff";
const DEFAULT_AMBIENT = 0.45;

interface RGB { r: number; g: number; b: number; }
interface RGBFactors { r: number; g: number; b: number; }

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
function shadePolygon(
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

function textureTintFactors(
  lambert: number,
  lightColor: string,
  ambientColor: string,
  ambientStrength: number,
): RGBFactors {
  const light = parseHex(lightColor);
  const amb = parseHex(ambientColor);
  return {
    r: (amb.r / 255) * ambientStrength + (light.r / 255) * lambert,
    g: (amb.g / 255) * ambientStrength + (light.g / 255) * lambert,
    b: (amb.b / 255) * ambientStrength + (light.b / 255) * lambert,
  };
}

function tintToCss({ r, g, b }: RGBFactors): string {
  const f = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255);
  return `rgb(${f(r)} ${f(g)} ${f(b)})`;
}

function applyTextureTint(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  tint: RGBFactors,
): void {
  if (
    Math.abs(tint.r - 1) < 0.001 &&
    Math.abs(tint.g - 1) < 0.001 &&
    Math.abs(tint.b - 1) < 0.001
  ) {
    return;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = tintToCss(tint);
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  width: number,
  height: number,
): void {
  const srcW = img.naturalWidth || img.width || 1;
  const srcH = img.naturalHeight || img.height || 1;
  const scale = Math.max(width / srcW, height / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  ctx.drawImage(img, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
}

/**
 * Poly — renders an arbitrary 3D polygon from `vertices`.
 *
 * Public API: `{ vertices: Vec3[], color?, texture?, uvs?, data? }`.
 * Also accepts DOM passthrough props (className, style, onClick, etc.) —
 * this is the polycss DOM-native pitch: every polygon is a real DOM node
 * that CSS, event handlers, and accessibility hooks can target directly.
 *
 * Implementation: builds an ORTHONORMAL coordinate frame from the polygon's
 * own geometry (x-axis along v1-v0, y-axis perpendicular within the plane,
 * z-axis = plane normal) and uses CSS matrix3d to map the SVG's flat 2D
 * content onto that frame. SVG path coords are computed in the polygon's
 * own 2D plane, so the output is always exactly the polygon described.
 *
 * Transforms (position, scale, rotation) are accepted as props per the
 * Phase 4 design; in Phase 3 they are accepted but not applied — the
 * rendered transform is computed from vertices in scene-root space.
 * Phase 4 wires these into matrix3d composition with parent PolyMesh.
 */
export function Poly({
  // Polygon fields
  vertices,
  color,
  texture,
  uvs,
  data,
  // Transform props — composed into a wrapper div per §Design.4c (nested DOM,
  // not flat-baked). When all defaults, the wrapper is skipped for perf and
  // the SVG/img renders directly with the polycss-poly class.
  position,
  scale,
  rotation,
  // DOM passthrough props
  className,
  style: styleProp,
  id,
  onClick,
  onDoubleClick,
  onMouseEnter,
  onMouseLeave,
  onMouseMove,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  onKeyDown,
  tabIndex,
  role,
  "aria-label": ariaLabel,
  "aria-hidden": ariaHidden,
  pointerEvents: pointerEventsProp,
  // Scene context (forwarded from PolyScene)
  context,
  textureLighting: textureLightingProp,
  baseColor: baseColorProp,
  ...dataAttrs
}: PolyProps) {
  const tile = context?.tileSize ?? 50;
  const elev = context?.layerElevation ?? 50;
  const baseColor = baseColorProp ?? color ?? "#cccccc";
  const textureLighting = textureLightingProp ?? context?.textureLighting ?? "baked";

  // POLYCSS PHASE 3.0 — vertices are interpreted as scene-root world space
  // (not cell-relative). The wrapper element no longer sits at a CSS Grid
  // cell origin; it sits at scene-root (0,0,0) and matrix3d carries the full
  // translation to the polygon's actual scene position.
  //
  // Polycss world-space convention: +X right, +Y forward, +Z up.
  // CSS pixel space: +X right (horizontal), +Y down (depth into page in
  // perspective), +Z toward viewer. The renderer maps world(y) → css(x) and
  // world(x) → css(y), preserving the swap that makes polycss's "forward"
  // axis line up with CSS's depth axis. Z scales by elevation independent
  // of the tile size.
  const toCss = (v: [number, number, number]): [number, number, number] => [
    v[1] * tile, // world-Y → CSS-x (horizontal)
    v[0] * tile, // world-X → CSS-y (depth)
    v[2] * elev, // world-Z → CSS-z (elevation)
  ];
  const pts = vertices.map(toCss);
  const p0 = pts[0];
  const p1 = pts[1];
  const p2 = pts[2];

  // Edge vectors in 3D CSS-pixel space — first two edges define the plane.
  const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  const L01 = Math.hypot(e1[0], e1[1], e1[2]);
  if (L01 === 0) return null;

  // Orthonormal basis of the polygon's plane.
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

  // Per-polygon directional lighting. Pull config from the scene context
  // (set by PolyScene's `directionalLight` prop) with sane defaults.
  // Computed once at render — no per-frame work, no GPU shaders. As the
  // user rotates the scene, different polygons become visible (others get
  // backface-culled), each with the brightness it was assigned at mount.
  const lightCfg = context?.directionalLight;
  const lightDir = lightCfg?.direction ?? DEFAULT_LIGHT_DIR;
  const lightColor = lightCfg?.color ?? DEFAULT_LIGHT_COLOR;
  const ambientColor = lightCfg?.ambientColor ?? DEFAULT_AMBIENT_COLOR;
  const ambient = lightCfg?.ambient ?? DEFAULT_AMBIENT;
  const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const lx = lightDir[0] / lLen, ly = lightDir[1] / lLen, lz = lightDir[2] / lLen;
  const direct = Math.max(0, 1 - ambient);
  const lambert = direct * Math.max(0, nx * lx + ny * ly + nz * lz);
  const shadedColor = shadePolygon(baseColor, lambert, lightColor, ambientColor, ambient);

  // Same matrix3d but with the normal flipped — represents the BACK face.
  // We render it as a second sibling SVG when debugShowBackfaces is on, so
  // when the camera looks at the back of the polygon (where the front SVG
  // gets backface-hidden), this one comes into view tinted in a debug color.
  const backMatrix = [
    xAxis[0], xAxis[1], xAxis[2], 0,
    yAxis[0], yAxis[1], yAxis[2], 0,
    -nx, -ny, -nz, 0,
    tx, ty, tz, 1,
  ].join(",");

  // Optional texture handling. Two paths:
  //
  // 1. UV-mapped (uvs supplied): compute a 2D affine that maps
  //    UV-space [u, 1-v] → polygon-local SVG coords. Render the image
  //    in a 1×1 unit box transformed by that affine, clipped to the
  //    polygon. The atlas's per-polygon region lands in the right
  //    place — works for proper textured meshes (parseObj output, etc.).
  //
  // 2. Single-tile fill (no UVs): draw the image cover-style across the
  //    polygon's bbox. The image gets stamped on the face without UV
  //    awareness.
  //
  // Lighting is either baked into the off-DOM canvas before it becomes an
  // <img>, or left unbaked and applied via CSS brightness() for comparison.
  const textureUrl = texture;
  const textureTint = textureTintFactors(lambert, lightColor, ambientColor, ambient);
  const textureTintKey = `${textureTint.r.toFixed(4)},${textureTint.g.toFixed(4)},${textureTint.b.toFixed(4)}`;
  const textureBakeKey = textureLighting === "baked" ? textureTintKey : "filter";
  const textureBrightness = ambient + lambert;
  const textureFilter = textureLighting === "filter"
    ? `brightness(${textureBrightness.toFixed(3)})`
    : undefined;

  // UV affine: solve for (a, b, c, d, e, f) such that
  //   s_i.x = a·u_i + b·(1-v_i) + e
  //   s_i.y = c·u_i + d·(1-v_i) + f
  // for the first three (vertex, uv) pairs. Three pairs uniquely determine
  // the affine; for polygons with N>3 verts we trust that all UVs are
  // consistent with the same affine (true for OBJ-exported coplanar polys).
  // Affine matrix (a, b, c, d, e, f) maps UV-space `[u, 1-v]` → polygon-
  // local SVG coords. Used both by the canvas rasterizer (option 3 path)
  // and the SVG fallback (single-tile pattern; `uvAffine` ignored there).
  let uvAffine: { a: number; b: number; c: number; d: number; e: number; f: number } | null = null;
  if (textureUrl && uvs && uvs.length >= 3 && uvs.length === vertices.length) {
    const [uv0, uv1, uv2] = uvs;
    const sx0 = local2D[0][0] + shiftX, sy0 = local2D[0][1] + shiftY;
    const sx1 = local2D[1][0] + shiftX, sy1 = local2D[1][1] + shiftY;
    const sx2 = local2D[2][0] + shiftX, sy2 = local2D[2][1] + shiftY;
    // OBJ vt has v=0 at bottom; SVG image-space y points down. Flip v.
    const u0 = uv0[0], V0 = 1 - uv0[1];
    const u1 = uv1[0], V1 = 1 - uv1[1];
    const u2 = uv2[0], V2 = 1 - uv2[1];
    const du1 = u1 - u0, dV1 = V1 - V0;
    const du2 = u2 - u0, dV2 = V2 - V0;
    const det = du1 * dV2 - du2 * dV1;
    if (Math.abs(det) > 1e-9) {
      const dx1 = sx1 - sx0, dx2 = sx2 - sx0;
      const dy1 = sy1 - sy0, dy2 = sy2 - sy0;
      const a = (dx1 * dV2 - dx2 * dV1) / det;
      const b = (du1 * dx2 - du2 * dx1) / det;
      const c = (dy1 * dV2 - dy2 * dV1) / det;
      const d = (du1 * dy2 - du2 * dy1) / det;
      const e = sx0 - a * u0 - b * V0;
      const f = sy0 - c * u0 - d * V0;
      uvAffine = { a, b, c, d, e, f };
    }
  }

  // Texturing pipeline:
  //   1. Create an off-DOM canvas
  //   2. Draw the polygon clip + UV-transformed or cover texture into it
  //   3. In baked mode, multiply by the per-face light tint while still off-DOM
  //   4. canvas.toBlob → URL.createObjectURL → set as src on a real <img>
  //   5. Drop the canvas (GC reclaims its CPU buffer)
  //   6. Browser composites the <img> in 3D via the same matrix3d
  //
  // Why <img> instead of <canvas> in the DOM: a canvas keeps its CPU pixel
  // buffer alive as long as it's mounted (so getContext can read it back).
  // An <img> only needs the decoded GPU texture once the browser is done
  // with it — roughly half the per-element memory footprint, which matters
  // a lot for high-poly UV-mapped meshes (cat = ~35k textured polygons).
  const imgRef = useRef<HTMLImageElement>(null);
  const blobUrlRef = useRef<string | null>(null);
  const screenPts: number[] = [];
  for (const [x, y] of local2D) screenPts.push(x + shiftX, y + shiftY);
  const screenPtsKey = screenPts.join(",");
  const affineKey = uvAffine
    ? `${uvAffine.a},${uvAffine.b},${uvAffine.c},${uvAffine.d},${uvAffine.e},${uvAffine.f}`
    : "";
  const canvasW = Math.max(1, Math.ceil(w));
  const canvasH = Math.max(1, Math.ceil(h));

  useEffect(() => {
    if (!textureUrl) return;
    let cancelled = false;

    loadTextureImage(textureUrl).then((srcImg) => {
      if (cancelled) return;
      // Off-DOM canvas — never inserted into the document. GC reclaims it
      // once we drop the reference at the end of this then-callback.
      const canvas = document.createElement("canvas");
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.beginPath();
      for (let i = 0; i < screenPts.length; i += 2) {
        const x = screenPts[i], y = screenPts[i + 1];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.clip();

      if (uvAffine) {
        // Affine: image pixel (px, py) → canvas pixel.
        //   canvas_x = (a/imgW)·px + (b/imgH)·py + e
        //   canvas_y = (c/imgW)·px + (d/imgH)·py + f
        // setTransform(a, b, c, d, e, f) is column-major: [a c e; b d f]
        ctx.setTransform(
          uvAffine.a / srcImg.naturalWidth, uvAffine.c / srcImg.naturalWidth,
          uvAffine.b / srcImg.naturalHeight, uvAffine.d / srcImg.naturalHeight,
          uvAffine.e, uvAffine.f,
        );
        ctx.drawImage(srcImg, 0, 0);
      } else {
        drawImageCover(ctx, srcImg, canvasW, canvasH);
      }
      if (textureLighting === "baked") {
        applyTextureTint(ctx, canvasW, canvasH, textureTint);
      }

      canvas.toBlob((blob) => {
        if (cancelled || !blob) return;
        const url = URL.createObjectURL(blob);
        // Revoke any previous blob URL we'd assigned — otherwise a re-render
        // (e.g. texture URL change) would leak the old one. Set the new URL
        // BEFORE assigning to img.src so a tiny race window doesn't show the
        // old src after revoke.
        const prev = blobUrlRef.current;
        blobUrlRef.current = url;
        if (imgRef.current) imgRef.current.src = url;
        if (prev) URL.revokeObjectURL(prev);
      }, "image/png");
    }).catch(() => { /* texture failed; img stays blank */ });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textureUrl, affineKey, screenPtsKey, canvasW, canvasH, textureBakeKey]);

  // Final cleanup: revoke the active blob URL when the component unmounts.
  useEffect(() => {
    return () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, []);

  // Stroke is helpful for solid-color polygons (visual debug of mesh
  // structure). Textured polygons render as <img>, so no stroke path.
  const stroke = "rgba(0,0,0,0.15)";
  const strokeWidth = 1;

  // DOM passthrough event handlers to forward to the rendered element.
  // Typed as React.DOMAttributes<Element> so the same object can be spread
  // onto both <img> (HTMLImageElement) and <svg> (SVGSVGElement) without
  // TypeScript complaining about element-specific handler signatures.
  const domEventHandlers: React.DOMAttributes<Element> = {
    onClick: onClick as React.MouseEventHandler<Element> | undefined,
    onDoubleClick: onDoubleClick as React.MouseEventHandler<Element> | undefined,
    onMouseEnter: onMouseEnter as React.MouseEventHandler<Element> | undefined,
    onMouseLeave: onMouseLeave as React.MouseEventHandler<Element> | undefined,
    onMouseMove: onMouseMove as React.MouseEventHandler<Element> | undefined,
    onPointerDown: onPointerDown as React.PointerEventHandler<Element> | undefined,
    onPointerUp: onPointerUp as React.PointerEventHandler<Element> | undefined,
    onPointerEnter: onPointerEnter as React.PointerEventHandler<Element> | undefined,
    onPointerLeave: onPointerLeave as React.PointerEventHandler<Element> | undefined,
    onFocus: onFocus as React.FocusEventHandler<Element> | undefined,
    onBlur: onBlur as React.FocusEventHandler<Element> | undefined,
    onKeyDown: onKeyDown as React.KeyboardEventHandler<Element> | undefined,
  };

  const domAttrs = {
    id,
    tabIndex,
    role,
    "aria-label": ariaLabel,
    "aria-hidden": ariaHidden,
    // Forward data-* attributes passed directly as props
    ...Object.fromEntries(
      Object.entries(dataAttrs).filter(([k]) => k.startsWith("data-"))
    ),
    // Also reflect polygon's data field as data-* attributes
    ...(data
      ? Object.fromEntries(
          Object.entries(data).map(([k, v]) => [`data-${k}`, String(v)])
        )
      : {}),
  };

  // Resolved pointerEvents — default "auto" (DOM-native pitch: polygons
  // receive pointer events by default). Pass `pointerEvents="none"` as an
  // opt-out escape hatch for purely decorative polygons.
  const resolvedPointerEvents = pointerEventsProp ?? "auto";

  // Build the per-Poly wrapper transform from position/scale/rotation. Per
  // §Design.4c the wrapper is a real DOM element (not a flat-baked matrix)
  // so CSS preserve-3d composes its transform with the inner matrix3d AND
  // any ancestor PolyMesh/PolyScene transforms automatically.
  const transformParts: string[] = [];
  if (position) {
    transformParts.push(
      `translate3d(${position[0]}px, ${position[1]}px, ${position[2]}px)`
    );
  }
  if (scale !== undefined) {
    if (typeof scale === "number") {
      if (scale !== 1) transformParts.push(`scale3d(${scale}, ${scale}, ${scale})`);
    } else {
      transformParts.push(`scale3d(${scale[0]}, ${scale[1]}, ${scale[2]})`);
    }
  }
  if (rotation) {
    if (rotation[0]) transformParts.push(`rotateX(${rotation[0]}deg)`);
    if (rotation[1]) transformParts.push(`rotateY(${rotation[1]}deg)`);
    if (rotation[2]) transformParts.push(`rotateZ(${rotation[2]}deg)`);
  }
  const wrapperTransform = transformParts.length > 0 ? transformParts.join(" ") : undefined;

  // Textured polygon: render an <img> whose src is set imperatively from the
  // offscreen-canvas blob. ONE element per polygon, no SVG, no clip-path.
  // In filter mode, lighting is applied here with CSS brightness().
  const front = textureUrl ? (
    <img
      ref={imgRef}
      alt=""
      width={canvasW}
      height={canvasH}
      className={["polycss-poly", "polycss-poly-textured", className].filter(Boolean).join(" ")}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: canvasW,
        height: canvasH,
        transformOrigin: "0 0",
        transform: `matrix3d(${matrix})`,
        backfaceVisibility: "hidden",
        pointerEvents: resolvedPointerEvents,
        filter: textureFilter,
        ...styleProp,
      }}
      {...domEventHandlers}
      {...domAttrs}
    />
  ) : (
    <svg
      xmlns={SVG_NS}
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      preserveAspectRatio="none"
      className={[
        "polycss-poly",
        className,
      ].filter(Boolean).join(" ")}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        overflow: "visible",
        transformOrigin: "0 0",
        transform: `matrix3d(${matrix})`,
        // Hide the back side. Without this, polycss renders BOTH sides of every
        // polygon — so when a face is back-facing the camera, you still see a
        // mirrored copy of it overlapping front faces from other angles.
        backfaceVisibility: "hidden",
        pointerEvents: resolvedPointerEvents,
        ...styleProp,
      }}
      {...domEventHandlers}
      {...domAttrs}
    >
      <path d={pathStr} fill={shadedColor} stroke={stroke} strokeWidth={strokeWidth} vectorEffect="non-scaling-stroke" />
    </svg>
  );

  const debugBackface = context?.debugShowBackfaces ? (
    <svg
      xmlns={SVG_NS}
      viewBox={`0 0 ${w} ${h}`}
      width={w}
      height={h}
      preserveAspectRatio="none"
      className="polycss-poly polycss-debug-backface"
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
  ) : null;

  // No transforms → render the leaf element(s) directly. Skips the wrapper
  // div for the common case (most polygons in a parsed mesh have identity
  // transforms — the mesh's wrapper carries the positioning).
  if (!wrapperTransform) {
    if (!debugBackface) return front;
    return (
      <>
        {front}
        {debugBackface}
      </>
    );
  }

  // Wrapped: an extra div carries the per-Poly transform. The inner SVG/img
  // keeps its vertex-derived matrix3d unchanged; preserve-3d composes them.
  return (
    <div
      className="polycss-poly-wrapper"
      style={{
        position: "absolute",
        transformStyle: "preserve-3d",
        transform: wrapperTransform,
      }}
    >
      {front}
      {debugBackface}
    </div>
  );
}
