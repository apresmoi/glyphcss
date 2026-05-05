/**
 * Poly — Vue 3 equivalent of React's Poly component.
 *
 * Renders an arbitrary 3D polygon from `vertices` as a positioned SVG or <img>
 * using CSS matrix3d in scene-root world space (§Design.4c).
 *
 * DOM passthrough: Vue attribute fallthrough is disabled (inheritAttrs: false)
 * so we forward attrs manually to the inner SVG/img element — same surface as
 * React's DOM passthrough props (onClick, className, style, aria-*, data-*).
 */
import {
  defineComponent,
  h,
  ref,
  onMounted,
  onBeforeUnmount,
  watch,
  computed,
} from "vue";
import type { PropType, CSSProperties } from "vue";
import type { Vec2, Vec3, DirectionalLight, TextureLightingMode } from "@polycss/core";

const SVG_NS = "http://www.w3.org/2000/svg";

// Module-level texture image cache — same strategy as React's Poly.
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

// Defaults for directional lighting
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

export interface PolyContext {
  tileSize?: number;
  layerElevation?: number;
  directionalLight?: DirectionalLight;
  textureLighting?: TextureLightingMode;
  debugShowBackfaces?: boolean;
  [key: string]: unknown;
}

export interface PolyProps {
  vertices: Vec3[];
  color?: string;
  texture?: string;
  uvs?: Vec2[];
  data?: Record<string, string | number | boolean>;
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
  context?: PolyContext;
  textureLighting?: TextureLightingMode;
  baseColor?: string;
  pointerEvents?: "auto" | "none";
}

export const Poly = defineComponent({
  name: "Poly",
  inheritAttrs: false,
  props: {
    vertices: { type: Array as PropType<Vec3[]>, required: true },
    color: { type: String },
    texture: { type: String },
    uvs: { type: Array as PropType<Vec2[]>, default: undefined },
    data: { type: Object as PropType<Record<string, string | number | boolean>>, default: undefined },
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    textureLighting: {
      type: String as PropType<TextureLightingMode>,
      default: undefined,
    },
    context: {
      type: Object as PropType<PolyContext>,
      default: undefined,
    },
    baseColor: { type: String },
    pointerEvents: {
      type: String as PropType<"auto" | "none">,
      default: "auto",
    },
  },
  setup(props, { attrs }) {
    const imgRef = ref<HTMLImageElement | null>(null);
    const blobUrlRef = ref<string | null>(null);

    // Compute all the geometry in a computed (memoized) block.
    const geo = computed(() => {
      const tile = props.context?.tileSize ?? 50;
      const elev = props.context?.layerElevation ?? 50;
      const vertices = props.vertices;

      const toCss = (v: [number, number, number]): [number, number, number] => [
        v[1] * tile,
        v[0] * tile,
        v[2] * elev,
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

      const backMatrix = [
        xAxis[0], xAxis[1], xAxis[2], 0,
        yAxis[0], yAxis[1], yAxis[2], 0,
        -nx, -ny, -nz, 0,
        tx, ty, tz, 1,
      ].join(",");

      // Lighting
      const lightCfg = props.context?.directionalLight;
      const lightDir = lightCfg?.direction ?? DEFAULT_LIGHT_DIR;
      const lightColor = lightCfg?.color ?? DEFAULT_LIGHT_COLOR;
      const ambientColor = lightCfg?.ambientColor ?? DEFAULT_AMBIENT_COLOR;
      const ambient = lightCfg?.ambient ?? DEFAULT_AMBIENT;
      const lLen = Math.hypot(lightDir[0], lightDir[1], lightDir[2]) || 1;
      const lx = lightDir[0] / lLen, ly = lightDir[1] / lLen, lz = lightDir[2] / lLen;
      const direct = Math.max(0, 1 - ambient);
      const lambert = direct * Math.max(0, nx * lx + ny * ly + nz * lz);
      const baseColor = props.baseColor ?? props.color ?? "#cccccc";
      const shadedColor = shadePolygon(baseColor, lambert, lightColor, ambientColor, ambient);
      const textureLighting = props.textureLighting ?? props.context?.textureLighting ?? "baked";
      const textureTint = textureTintFactors(lambert, lightColor, ambientColor, ambient);
      const textureTintKey = `${textureTint.r.toFixed(4)},${textureTint.g.toFixed(4)},${textureTint.b.toFixed(4)}`;
      const textureBrightness = ambient + lambert;

      // UV affine
      const textureUrl = props.texture;
      let uvAffine: { a: number; b: number; c: number; d: number; e: number; f: number } | null = null;
      const uvs = props.uvs;
      if (textureUrl && uvs && uvs.length >= 3 && uvs.length === vertices.length) {
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

      const screenPts: number[] = [];
      for (const [x, y] of local2D) screenPts.push(x + shiftX, y + shiftY);

      return {
        matrix, backMatrix, pathStr, w, h, shadedColor,
        textureLighting, textureTint, textureTintKey, textureBrightness,
        textureUrl, uvAffine, shiftX, shiftY, local2D,
        canvasW: Math.max(1, Math.ceil(w)),
        canvasH: Math.max(1, Math.ceil(h)),
        screenPts,
        screenPtsKey: screenPts.join(","),
        affineKey: uvAffine
          ? `${uvAffine.a},${uvAffine.b},${uvAffine.c},${uvAffine.d},${uvAffine.e},${uvAffine.f}`
          : "",
        nx, ny, nz,
        xAxis, yAxis, p0,
      };
    });

    // Textured polygons: canvas → baked light tint → blob → img.src
    watch(
      () => {
        const g = geo.value;
        if (!g) return null;
        const bakeKey = g.textureLighting === "baked" ? g.textureTintKey : "filter";
        return `${g.textureUrl}||${g.affineKey}||${g.screenPtsKey}||${g.canvasW}x${g.canvasH}||${bakeKey}`;
      },
      () => {
        const g = geo.value;
        if (!g || !g.textureUrl) return;
        let cancelled = false;

        loadTextureImage(g.textureUrl).then((srcImg) => {
          if (cancelled) return;
          const canvas = document.createElement("canvas");
          canvas.width = g.canvasW;
          canvas.height = g.canvasH;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          ctx.beginPath();
          for (let i = 0; i < g.screenPts.length; i += 2) {
            const x = g.screenPts[i], y = g.screenPts[i + 1];
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.clip();

          if (g.uvAffine) {
            ctx.setTransform(
              g.uvAffine.a / srcImg.naturalWidth, g.uvAffine.c / srcImg.naturalWidth,
              g.uvAffine.b / srcImg.naturalHeight, g.uvAffine.d / srcImg.naturalHeight,
              g.uvAffine.e, g.uvAffine.f,
            );
            ctx.drawImage(srcImg, 0, 0);
          } else {
            drawImageCover(ctx, srcImg, g.canvasW, g.canvasH);
          }
          if (g.textureLighting === "baked") {
            applyTextureTint(ctx, g.canvasW, g.canvasH, g.textureTint);
          }

          canvas.toBlob((blob) => {
            if (cancelled || !blob) return;
            const url = URL.createObjectURL(blob);
            const prev = blobUrlRef.value;
            blobUrlRef.value = url;
            if (imgRef.value) imgRef.value.src = url;
            if (prev) URL.revokeObjectURL(prev);
          }, "image/png");
        }).catch(() => { /* texture failed; img stays blank */ });

        return () => { cancelled = true; };
      },
      { immediate: true }
    );

    onBeforeUnmount(() => {
      if (blobUrlRef.value) {
        URL.revokeObjectURL(blobUrlRef.value);
        blobUrlRef.value = null;
      }
    });

    return () => {
      const g = geo.value;
      if (!g) return null;

      const resolvedPointerEvents = props.pointerEvents ?? "auto";
      const stroke = g.textureUrl ? "none" : "rgba(0,0,0,0.15)";
      const strokeWidth = g.textureUrl ? 0 : 1;
      const textureFilter = g.textureLighting === "filter"
        ? `brightness(${g.textureBrightness.toFixed(3)})`
        : undefined;

      // Build wrapper transform from position/scale/rotation
      const transformParts: string[] = [];
      if (props.position) {
        transformParts.push(
          `translate3d(${props.position[0]}px, ${props.position[1]}px, ${props.position[2]}px)`
        );
      }
      if (props.scale !== undefined) {
        if (typeof props.scale === "number") {
          if (props.scale !== 1) transformParts.push(`scale3d(${props.scale}, ${props.scale}, ${props.scale})`);
        } else {
          transformParts.push(`scale3d(${props.scale[0]}, ${props.scale[1]}, ${props.scale[2]})`);
        }
      }
      if (props.rotation) {
        if (props.rotation[0]) transformParts.push(`rotateX(${props.rotation[0]}deg)`);
        if (props.rotation[1]) transformParts.push(`rotateY(${props.rotation[1]}deg)`);
        if (props.rotation[2]) transformParts.push(`rotateZ(${props.rotation[2]}deg)`);
      }
      const wrapperTransform = transformParts.length > 0 ? transformParts.join(" ") : undefined;

      // Build data-* attrs from props.data
      const dataAttrs: Record<string, string> = {};
      if (props.data) {
        for (const [k, v] of Object.entries(props.data)) {
          dataAttrs[`data-${k}`] = String(v);
        }
      }

      // Forwarded attrs (className → class in Vue, style, event handlers, aria-*, data-*)
      const forwardedAttrs = { ...attrs, ...dataAttrs };

      // Front element — textured (img) or solid color (svg)
      const front = g.textureUrl
        ? h("img", {
            ref: imgRef,
            alt: "",
            width: g.canvasW,
            height: g.canvasH,
            class: ["polycss-poly", "polycss-poly-textured", (forwardedAttrs.class as string) ?? ""].filter(Boolean).join(" "),
            style: {
              position: "absolute",
              left: 0,
              top: 0,
              width: `${g.canvasW}px`,
              height: `${g.canvasH}px`,
              transformOrigin: "0 0",
              transform: `matrix3d(${g.matrix})`,
              backfaceVisibility: "hidden",
              pointerEvents: resolvedPointerEvents,
              filter: textureFilter,
              ...(forwardedAttrs.style as CSSProperties | undefined),
            } as CSSProperties,
            ...Object.fromEntries(
              Object.entries(forwardedAttrs).filter(([k]) => k !== "class" && k !== "style")
            ),
          })
        : h(
            "svg",
            {
              xmlns: SVG_NS,
              viewBox: `0 0 ${g.w} ${g.h}`,
              width: g.w,
              height: g.h,
              preserveAspectRatio: "none",
              class: [
                "polycss-poly",
                (forwardedAttrs.class as string) ?? "",
              ].filter(Boolean).join(" "),
              style: {
                position: "absolute",
                left: 0,
                top: 0,
                overflow: "visible",
                transformOrigin: "0 0",
                transform: `matrix3d(${g.matrix})`,
                backfaceVisibility: "hidden",
                pointerEvents: resolvedPointerEvents,
                ...(forwardedAttrs.style as CSSProperties | undefined),
              } as CSSProperties,
              ...Object.fromEntries(
                Object.entries(forwardedAttrs).filter(([k]) => k !== "class" && k !== "style")
              ),
            },
            [
              h("path", {
                d: g.pathStr,
                fill: g.shadedColor,
                stroke,
                "stroke-width": strokeWidth,
                "vector-effect": "non-scaling-stroke",
              }),
            ]
          );

      // Debug backface overlay
      const debugBackface = props.context?.debugShowBackfaces
        ? h(
            "svg",
            {
              xmlns: SVG_NS,
              viewBox: `0 0 ${g.w} ${g.h}`,
              width: g.w,
              height: g.h,
              preserveAspectRatio: "none",
              class: "polycss-poly polycss-debug-backface",
              style: {
                position: "absolute",
                left: 0,
                top: 0,
                overflow: "visible",
                transformOrigin: "0 0",
                transform: `matrix3d(${g.backMatrix})`,
                backfaceVisibility: "hidden",
                pointerEvents: "none",
              } as CSSProperties,
            },
            [
              h("path", {
                d: g.pathStr,
                fill: "rgba(249, 115, 22, 0.55)",
                stroke: "rgba(249, 115, 22, 0.9)",
                "stroke-width": 1,
                "stroke-dasharray": "3,2",
                "vector-effect": "non-scaling-stroke",
              }),
            ]
          )
        : null;

      // No per-Poly transform → render leaves directly
      if (!wrapperTransform) {
        if (!debugBackface) return front;
        return h("fragment", null, [front, debugBackface]);
      }

      // With transform → wrap in a preserve-3d div
      return h(
        "div",
        {
          class: "polycss-poly-wrapper",
          style: {
            position: "absolute",
            transformStyle: "preserve-3d",
            transform: wrapperTransform,
          } as CSSProperties,
        },
        [front, ...(debugBackface ? [debugBackface] : [])]
      );
    };
  },
});
