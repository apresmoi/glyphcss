/**
 * Poly — Vue 3 equivalent of React's Poly component.
 *
 * Renders one polygon as an atlas-backed DOM sprite. The atlas handles both
 * textured and solid-color faces, so normal rendering never emits SVG.
 */
import {
  computed,
  defineComponent,
  h,
} from "vue";
import type { CSSProperties, PropType } from "vue";
import type { PolyDirectionalLight, PolyTextureLightingMode, Vec2, Vec3, PolyMaterial } from "@layoutit/polycss-core";
import {
  computeTextureAtlasPlan,
  renderTextureAtlasPoly,
  useTextureAtlas,
  type AtlasScale,
  type TextureAtlasPlan,
} from "../scene/textureAtlas";

// ── Material / direct render path ────────────────────────────────────────────

/**
 * Detect whether a 4-vertex UV array forms an axis-aligned rectangle.
 * Returns {u0, u1, v0, v1} (with u0 < u1, v0 < v1) when yes, null otherwise.
 */
function isAxisAlignedRectUVs(uvs: Vec2[]): { u0: number; u1: number; v0: number; v1: number } | null {
  if (uvs.length !== 4) return null;
  const us = [...new Set(uvs.map((uv) => uv[0]))].sort((a, b) => a - b);
  const vs = [...new Set(uvs.map((uv) => uv[1]))].sort((a, b) => a - b);
  if (us.length !== 2 || vs.length !== 2) return null;
  const corners = new Set([
    `${us[0]},${vs[0]}`,
    `${us[0]},${vs[1]}`,
    `${us[1]},${vs[0]}`,
    `${us[1]},${vs[1]}`,
  ]);
  for (const uv of uvs) {
    if (!corners.has(`${uv[0]},${uv[1]}`)) return null;
  }
  return { u0: us[0], u1: us[1], v0: vs[0], v1: vs[1] };
}

function renderMaterialDirectPoly({
  plan,
  material,
  uvRect,
  className,
  style: styleProp,
  domAttrs,
  pointerEvents = "auto",
}: {
  plan: TextureAtlasPlan;
  material: PolyMaterial;
  uvRect: { u0: number; u1: number; v0: number; v1: number };
  className?: string;
  style?: CSSProperties;
  domAttrs?: Record<string, unknown>;
  pointerEvents?: "auto" | "none";
}) {
  const { u0, u1, v0, v1 } = uvRect;
  const du = u1 - u0;
  const dv = v1 - v0;
  const sourceW = plan.canvasW / du;
  const sourceH = plan.canvasH / dv;
  const vMax = Math.max(v0, v1);
  const offsetX = u0 * sourceW;
  const offsetY = (1 - vMax) * sourceH;

  const style: CSSProperties = {
    width: `${plan.canvasW}px`,
    height: `${plan.canvasH}px`,
    transform: `matrix3d(${plan.matrix})`,
    backgroundImage: `url(${material.texture})`,
    backgroundSize: `${sourceW}px ${sourceH}px`,
    backgroundPosition: `-${offsetX}px -${offsetY}px`,
    pointerEvents: pointerEvents === "none" ? "none" : undefined,
    ...styleProp,
  };

  const dataAttrs = plan.polygon.data
    ? Object.fromEntries(
        Object.entries(plan.polygon.data).map(([k, v]) => [`data-${k}`, String(v)]),
      )
    : {};
  const elementClassName = className?.trim() || undefined;

  return h("i", {
    class: elementClassName,
    style,
    ...dataAttrs,
    ...domAttrs,
  });
}

export interface PolyContext {
  tileSize?: number;
  layerElevation?: number;
  directionalLight?: PolyDirectionalLight;
  textureLighting?: PolyTextureLightingMode;
  atlasScale?: AtlasScale;
  debugShowBackfaces?: boolean;
  [key: string]: unknown;
}

export interface PolyProps {
  vertices: Vec3[];
  color?: string;
  texture?: string;
  uvs?: Vec2[];
  data?: Record<string, string | number | boolean>;
  /** Shared material. When set AND the polygon's UVs form an axis-aligned
   *  rectangle, renders via `background-image` directly — no per-polygon
   *  canvas rasterization. Falls back to the atlas path otherwise. */
  material?: PolyMaterial;
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
  context?: PolyContext;
  textureLighting?: PolyTextureLightingMode;
  /** Raster scale for generated atlas pages. `"auto"` reduces large atlases. */
  atlasScale?: AtlasScale;
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
    material: { type: Object as PropType<PolyMaterial>, default: undefined },
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: { type: [Number, Array] as unknown as PropType<number | Vec3>, default: undefined },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    textureLighting: {
      type: String as PropType<PolyTextureLightingMode>,
      default: undefined,
    },
    atlasScale: { type: [Number, String] as PropType<AtlasScale>, default: undefined },
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
    const atlasTextureLighting = computed<PolyTextureLightingMode>(
      () => props.textureLighting ?? props.context?.textureLighting ?? "baked",
    );
    const atlasScale = computed(() => props.atlasScale ?? props.context?.atlasScale);

    // material.texture takes precedence over inline texture.
    const effectiveTexture = computed(() => props.material?.texture ?? props.texture);

    const materialUvRect = computed(() =>
      props.material && props.uvs ? isAxisAlignedRectUVs(props.uvs) : null,
    );

    const atlasPlan = computed<TextureAtlasPlan | null>(() => {
      const tileSize = props.context?.tileSize ?? 50;
      return computeTextureAtlasPlan(
        {
          vertices: props.vertices,
          color: props.baseColor ?? props.color,
          texture: effectiveTexture.value,
          uvs: props.uvs,
          data: props.data,
        },
        0,
        {
          tileSize,
          layerElevation: props.context?.layerElevation ?? tileSize,
          directionalLight: props.context?.directionalLight,
        },
      );
    });

    const textureAtlasPlans = computed<Array<TextureAtlasPlan | null>>(() =>
      materialUvRect.value ? [] : [atlasPlan.value],
    );
    const textureAtlas = useTextureAtlas(textureAtlasPlans, atlasTextureLighting, atlasScale);

    return () => {
      const transformParts: string[] = [];
      if (props.position) {
        transformParts.push(
          `translate3d(${props.position[0]}px, ${props.position[1]}px, ${props.position[2]}px)`,
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

      const dataAttrs: Record<string, string> = {};
      if (props.data) {
        for (const [k, v] of Object.entries(props.data)) {
          dataAttrs[`data-${k}`] = String(v);
        }
      }

      const forwardedAttrs = { ...attrs, ...dataAttrs };
      const forwardedDomAttrs = Object.fromEntries(
        Object.entries(forwardedAttrs).filter(([k]) => k !== "class" && k !== "style"),
      );

      let front;
      if (materialUvRect.value && props.material && atlasPlan.value) {
        // Direct path: shared material texture, no atlas rasterization.
        front = renderMaterialDirectPoly({
          plan: atlasPlan.value,
          material: props.material,
          uvRect: materialUvRect.value,
          className: (forwardedAttrs.class as string) ?? undefined,
          style: forwardedAttrs.style as CSSProperties | undefined,
          domAttrs: forwardedDomAttrs,
          pointerEvents: props.pointerEvents ?? "auto",
        });
      } else {
        const atlasEntry = textureAtlas.entries.value[0];
        if (!atlasEntry) return null;
        front = renderTextureAtlasPoly({
          entry: atlasEntry,
          page: textureAtlas.pages.value[atlasEntry.pageIndex],
          textureLighting: atlasTextureLighting.value,
          className: (forwardedAttrs.class as string) ?? undefined,
          style: forwardedAttrs.style as CSSProperties | undefined,
          domAttrs: forwardedDomAttrs,
          pointerEvents: props.pointerEvents ?? "auto",
        });
      }

      if (!front) return null;
      if (!wrapperTransform) return front;

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
        [front],
      );
    };
  },
});
