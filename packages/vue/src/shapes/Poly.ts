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
import type { DirectionalLight, TextureLightingMode, Vec2, Vec3 } from "@polycss/core";
import {
  computeTextureAtlasPlan,
  renderTextureAtlasPoly,
  useTextureAtlas,
  type TextureAtlasPlan,
} from "../scene/textureAtlas";

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
    const atlasTextureLighting = computed<TextureLightingMode>(
      () => props.textureLighting ?? props.context?.textureLighting ?? "baked",
    );

    const textureAtlasPlans = computed<Array<TextureAtlasPlan | null>>(() => {
      const tileSize = props.context?.tileSize ?? 50;
      return [
        computeTextureAtlasPlan(
          {
            vertices: props.vertices,
            color: props.baseColor ?? props.color,
            texture: props.texture,
            uvs: props.uvs,
            data: props.data,
          },
          0,
          {
            tileSize,
            layerElevation: props.context?.layerElevation ?? tileSize,
            directionalLight: props.context?.directionalLight,
          },
        ),
      ];
    });
    const textureAtlas = useTextureAtlas(textureAtlasPlans, atlasTextureLighting);

    return () => {
      const atlasEntry = textureAtlas.entries.value[0];
      if (!atlasEntry) return null;

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

      const front = renderTextureAtlasPoly({
        entry: atlasEntry,
        page: textureAtlas.pages.value[atlasEntry.pageIndex],
        textureLighting: atlasTextureLighting.value,
        className: (forwardedAttrs.class as string) ?? undefined,
        style: forwardedAttrs.style as CSSProperties | undefined,
        domAttrs: forwardedDomAttrs,
        pointerEvents: props.pointerEvents ?? "auto",
      });

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
