/**
 * polyDOM — framework-agnostic DOM renderer for a single Polygon.
 *
 * Mirrors React's `Poly.tsx` math (vertex-frame matrix3d + Lambert shading +
 * UV-affine canvas blob for textured polygons) and emits real DOM elements
 * (<svg> or <img>) the caller can mount under any container.
 *
 * The vanilla `polycss` package keeps this local copy on purpose: extracting
 * to `@polycss/core` would require duplicating the render contract across
 * packages, and Phase 5b is explicitly scoped to NOT restructure core. We
 * can deduplicate later if a third consumer needs the same math.
 */
import type { DirectionalLight, Polygon, Vec3 } from "@polycss/core";

const SVG_NS = "http://www.w3.org/2000/svg";
const DEFAULT_TILE = 50;
const DEFAULT_ELEV = 50;

const DEFAULT_LIGHT_DIR: Vec3 = [0.4, -0.7, 0.59];
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
 * Module-level texture image cache so multiple polygons sharing the same
 * texture URL only download / decode once. Same idea as React's `Poly.tsx`.
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

export interface RenderPolyOptions {
  /** Scene tile size in CSS pixels per world unit (X/Y axes). */
  tileSize?: number;
  /** Scene elevation size in CSS pixels per world unit (Z axis). */
  layerElevation?: number;
  /** Per-scene directional light. */
  directionalLight?: DirectionalLight;
}

export interface RenderedPoly {
  /** The leaf element (`<svg>` for color polys, `<img>` for UV-textured). */
  element: SVGSVGElement | HTMLImageElement;
  /** Idempotent cleanup — revokes any blob URLs minted for this polygon. */
  dispose(): void;
}

/**
 * Build the DOM element(s) for a single Polygon. Returns the leaf element +
 * a `dispose()` to clean up texture blob URLs minted by the UV pipeline.
 *
 * Caller mounts `element` wherever they want — directly under a `.polycss-mesh`
 * wrapper (preserve-3d composes the matrix3d with mesh + scene transforms)
 * or under any custom DOM tree.
 */
export function renderPoly(
  polygon: Polygon,
  options: RenderPolyOptions = {},
): RenderedPoly | null {
  const { vertices, color, texture, uvs, data } = polygon;
  if (!vertices || vertices.length < 3) return null;

  const tile = options.tileSize ?? DEFAULT_TILE;
  const elev = options.layerElevation ?? DEFAULT_ELEV;
  const baseColor = color ?? "#cccccc";

  // World → CSS axis swap (matches Poly.tsx convention).
  const toCss = (v: Vec3): Vec3 => [
    v[1] * tile, // world-Y → CSS-x
    v[0] * tile, // world-X → CSS-y
    v[2] * elev, // world-Z → CSS-z
  ];
  const pts = vertices.map(toCss);
  const p0 = pts[0];
  const p1 = pts[1];
  const p2 = pts[2];

  const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
  const L01 = Math.hypot(e1[0], e1[1], e1[2]);
  if (L01 === 0) return null;

  const xAxis = [e1[0] / L01, e1[1] / L01, e1[2] / L01];
  let nx = -(e1[1] * e2[2] - e1[2] * e2[1]);
  let ny = -(e1[2] * e2[0] - e1[0] * e2[2]);
  let nz = -(e1[0] * e2[1] - e1[1] * e2[0]);
  const nLen = Math.hypot(nx, ny, nz);
  if (nLen === 0) return null;
  nx /= nLen; ny /= nLen; nz /= nLen;
  const yAxis = [
    ny * xAxis[2] - nz * xAxis[1],
    nz * xAxis[0] - nx * xAxis[2],
    nx * xAxis[1] - ny * xAxis[0],
  ];

  const local2D = pts.map((p): [number, number] => {
    const dx = p[0] - p0[0], dy = p[1] - p0[1], dz = p[2] - p0[2];
    return [
      dx * xAxis[0] + dy * xAxis[1] + dz * xAxis[2],
      dx * yAxis[0] + dy * yAxis[1] + dz * yAxis[2],
    ];
  });

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

  const tx = p0[0] - shiftX * xAxis[0] - shiftY * yAxis[0];
  const ty = p0[1] - shiftX * xAxis[1] - shiftY * yAxis[1];
  const tz = p0[2] - shiftX * xAxis[2] - shiftY * yAxis[2];

  const matrix = [
    xAxis[0], xAxis[1], xAxis[2], 0,
    yAxis[0], yAxis[1], yAxis[2], 0,
    nx, ny, nz, 0,
    tx, ty, tz, 1,
  ].join(",");

  // Lighting.
  const lightCfg = options.directionalLight;
  const lightDir = lightCfg?.direction ?? DEFAULT_LIGHT_DIR;
  const lightColor = lightCfg?.color ?? DEFAULT_LIGHT_COLOR;
  const ambientColor = lightCfg?.ambientColor ?? DEFAULT_AMBIENT_COLOR;
  const ambient = lightCfg?.ambient ?? DEFAULT_AMBIENT;
  const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
  const lx = lightDir[0] / lLen, ly = lightDir[1] / lLen, lz = lightDir[2] / lLen;
  const direct = Math.max(0, 1 - ambient);
  const lambert = direct * Math.max(0, nx * lx + ny * ly + nz * lz);
  const shadedColor = shadePolygon(baseColor, lambert, lightColor, ambientColor, ambient);
  const textureBrightness = ambient + lambert;

  // UV-affine for textured polygons.
  let uvAffine: { a: number; b: number; c: number; d: number; e: number; f: number } | null = null;
  if (texture && uvs && uvs.length >= 3 && uvs.length === vertices.length) {
    const [uv0, uv1, uv2] = uvs;
    const sx0 = local2D[0][0] + shiftX, sy0 = local2D[0][1] + shiftY;
    const sx1 = local2D[1][0] + shiftX, sy1 = local2D[1][1] + shiftY;
    const sx2 = local2D[2][0] + shiftX, sy2 = local2D[2][1] + shiftY;
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

  const doc =
    typeof document !== "undefined"
      ? document
      : (null as unknown as Document);
  if (!doc) return null;

  let element: SVGSVGElement | HTMLImageElement;
  let blobUrl: string | null = null;
  let cancelled = false;

  if (texture && uvAffine) {
    // UV-mapped textured polygon: <img> with src set imperatively from an
    // off-DOM canvas blob. One element per polygon; no SVG.
    const canvasW = Math.max(1, Math.ceil(w));
    const canvasH = Math.max(1, Math.ceil(h));
    const img = doc.createElement("img");
    img.alt = "";
    img.width = canvasW;
    img.height = canvasH;
    const classes = ["polycss-poly", "polycss-poly-textured"];
    img.className = classes.join(" ");
    img.style.position = "absolute";
    img.style.left = "0";
    img.style.top = "0";
    img.style.width = `${canvasW}px`;
    img.style.height = `${canvasH}px`;
    img.style.transformOrigin = "0 0";
    img.style.transform = `matrix3d(${matrix})`;
    img.style.backfaceVisibility = "hidden";
    img.style.filter = `brightness(${textureBrightness.toFixed(3)})`;

    const screenPts: number[] = [];
    for (const [x, y] of local2D) screenPts.push(x + shiftX, y + shiftY);

    loadTextureImage(texture).then((srcImg) => {
      if (cancelled) return;
      const canvas = doc.createElement("canvas");
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

      ctx.setTransform(
        uvAffine!.a / srcImg.naturalWidth, uvAffine!.c / srcImg.naturalWidth,
        uvAffine!.b / srcImg.naturalHeight, uvAffine!.d / srcImg.naturalHeight,
        uvAffine!.e, uvAffine!.f,
      );
      ctx.drawImage(srcImg, 0, 0);

      canvas.toBlob((blob) => {
        if (cancelled || !blob) return;
        const url = URL.createObjectURL(blob);
        const prev = blobUrl;
        blobUrl = url;
        img.src = url;
        if (prev) URL.revokeObjectURL(prev);
      }, "image/png");
    }).catch(() => { /* texture failed; img stays blank */ });

    element = img;
  } else {
    // Solid color (or texture without UVs) → SVG with shaded fill.
    const stroke = texture ? "none" : "rgba(0,0,0,0.15)";
    const strokeWidth = texture ? 0 : 1;

    const svg = doc.createElementNS(SVG_NS, "svg") as SVGSVGElement;
    svg.setAttribute("xmlns", SVG_NS);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    svg.setAttribute("preserveAspectRatio", "none");
    const classes = ["polycss-poly"];
    if (texture) classes.push("polycss-poly-textured");
    svg.setAttribute("class", classes.join(" "));
    svg.style.position = "absolute";
    svg.style.left = "0";
    svg.style.top = "0";
    svg.style.overflow = "visible";
    svg.style.transformOrigin = "0 0";
    svg.style.transform = `matrix3d(${matrix})`;
    svg.style.backfaceVisibility = "hidden";
    if (texture) {
      svg.style.filter = `brightness(${textureBrightness.toFixed(3)})`;
    }

    if (texture) {
      // Single-tile pattern fill (no UV mapping).
      const patternId = `polycss-pattern-${Math.random().toString(36).slice(2, 10)}`;
      const defs = doc.createElementNS(SVG_NS, "defs");
      const pattern = doc.createElementNS(SVG_NS, "pattern");
      pattern.setAttribute("id", patternId);
      pattern.setAttribute("patternUnits", "userSpaceOnUse");
      pattern.setAttribute("width", String(w));
      pattern.setAttribute("height", String(h));
      const image = doc.createElementNS(SVG_NS, "image");
      image.setAttributeNS(
        "http://www.w3.org/1999/xlink",
        "xlink:href",
        texture,
      );
      image.setAttribute("href", texture);
      image.setAttribute("width", String(w));
      image.setAttribute("height", String(h));
      image.setAttribute("preserveAspectRatio", "xMidYMid slice");
      pattern.appendChild(image);
      defs.appendChild(pattern);
      svg.appendChild(defs);

      const path = doc.createElementNS(SVG_NS, "path");
      path.setAttribute("d", pathStr);
      path.setAttribute("fill", `url(#${patternId})`);
      path.setAttribute("stroke", stroke);
      path.setAttribute("stroke-width", String(strokeWidth));
      path.setAttribute("vector-effect", "non-scaling-stroke");
      svg.appendChild(path);
    } else {
      const path = doc.createElementNS(SVG_NS, "path");
      path.setAttribute("d", pathStr);
      path.setAttribute("fill", shadedColor);
      path.setAttribute("stroke", stroke);
      path.setAttribute("stroke-width", String(strokeWidth));
      path.setAttribute("vector-effect", "non-scaling-stroke");
      svg.appendChild(path);
    }

    element = svg;
  }

  // Reflect polygon.data as data-* attributes.
  if (data) {
    for (const [k, v] of Object.entries(data)) {
      element.setAttribute(`data-${k}`, String(v));
    }
  }

  return {
    element,
    dispose() {
      cancelled = true;
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        blobUrl = null;
      }
    },
  };
}
