/**
 * PolyScene — Vue 3 equivalent of React's PolyScene.
 * Must be used inside a <PolyCamera>.
 *
 * Renders a polycss-scene wrapper containing all polygons and children.
 * Transform (position/scale/rotation) compose with PolyCamera's camera
 * transform via CSS preserve-3d nested DOM (§Design.4c).
 */
import {
  defineComponent,
  h,
  inject,
  provide,
  computed,
  ref,
  watch,
  onMounted,
  onBeforeUnmount,
} from "vue";
import type { PropType } from "vue";
import type {
  Polygon,
  PolyDirectionalLight,
  PolyAmbientLight,
  PolyTextureLightingMode,
  Vec3,
} from "@layoutit/polycss-core";
import { createIsometricCamera, parseHexColor } from "@layoutit/polycss-core";
import { PolyCameraContextKey } from "../camera";
import { usePolySceneContext } from "./useSceneContext";
import { injectPolyBaseStyles } from "../styles";
import { PolySceneContextKey } from "./sceneContext";
import {
  computeTextureAtlasPlan,
  isSolidTrianglePlan,
  type AtlasScale,
  renderTextureBorderShapePoly,
  renderTextureAtlasPoly,
  renderTextureTrianglePoly,
  useTextureAtlas,
} from "./textureAtlas";

export interface PolySceneProps {
  polygons?: Polygon[];
  perspective?: number;
  rotX?: number;
  rotY?: number;
  zoom?: number;
  directionalLight?: PolyDirectionalLight;
  ambientLight?: PolyAmbientLight;
  textureLighting?: PolyTextureLightingMode;
  /** Raster scale for generated atlas pages. `"auto"` reduces large atlases. */
  atlasScale?: AtlasScale;
  /**
   * When `true`, rotation pivots around the mesh's bbox center instead of
   * world (0,0,0). Polygon data is not mutated — a wrapper div translates
   * the polygons so the bbox center coincides with the scene anchor (0,0,0).
   * Mirrors React's PolyScene autoCenter prop.
   */
  autoCenter?: boolean;
  class?: string;
  // TransformProps
  position?: Vec3;
  scale?: number | Vec3;
  rotation?: Vec3;
  // Debug
  debugShowLabels?: boolean;
  debugShowBackfaces?: boolean;
}

export const PolyScene = defineComponent({
  name: "PolyScene",
  inheritAttrs: false,
  props: {
    polygons: { type: Array as PropType<Polygon[]>, default: undefined },
    perspective: { type: Number },
    rotX: { type: Number },
    rotY: { type: Number },
    zoom: { type: Number },
    directionalLight: {
      type: Object as PropType<PolyDirectionalLight>,
      default: undefined,
    },
    ambientLight: {
      type: Object as PropType<PolyAmbientLight>,
      default: undefined,
    },
    textureLighting: {
      type: String as PropType<PolyTextureLightingMode>,
      default: "baked",
    },
    atlasScale: { type: [Number, String] as PropType<AtlasScale>, default: undefined },
    autoCenter: { type: Boolean, default: false },
    class: { type: String },
    position: { type: Array as unknown as PropType<Vec3>, default: undefined },
    scale: {
      type: [Number, Array] as unknown as PropType<number | Vec3>,
      default: undefined,
    },
    rotation: { type: Array as unknown as PropType<Vec3>, default: undefined },
    debugShowLabels: { type: Boolean },
    debugShowBackfaces: { type: Boolean },
  },
  setup(props, { slots, attrs }) {
    const cameraCtx = inject(PolyCameraContextKey);
    if (!cameraCtx) {
      throw new Error("polycss: PolyScene must be used inside a PolyCamera.");
    }

    const { store, sceneElRef } = cameraCtx;

    // Propagate scene-level rendering options to descendants (PolyMesh /
    // helpers) so they pick up the same dynamic mode + lights as the
    // scene. Without this, a helper PolyMesh would default to baked
    // rendering while the scene's global CSS rule paints over it with
    // the dynamic calc — producing corrupt tints.
    const sceneCtxValue = computed(() => ({
      textureLighting: props.textureLighting ?? "baked",
      directionalLight: props.directionalLight,
      ambientLight: props.ambientLight,
    }));
    provide(PolySceneContextKey, sceneCtxValue);

    // Read camera state once for initial render — transform updates go via direct DOM
    const cameraState = store.getState().cameraState;

    const sceneElLocalRef = ref<HTMLElement | null>(null);

    // Sync local ref to camera context's sceneElRef
    watch(sceneElLocalRef, (el) => {
      sceneElRef.value = el;
    });

    // Inject base styles once
    let injected = false;
    onMounted(() => {
      if (injected) return;
      if (typeof document !== "undefined") {
        injectPolyBaseStyles(document);
        injected = true;
      }
    });

    // Retain the debug class for external tooling. The atlas renderer no
    // longer emits separate backface elements.
    watch(
      () => props.debugShowBackfaces,
      (val) => {
        const el = sceneElLocalRef.value;
        if (!el) return;
        el.classList.toggle("polycss-debug-show-backfaces", !!val);
      }
    );

    const inputPolygons = computed(() => props.polygons ?? []);

    const sceneContextOptions = computed(() => ({
      directionalLight: props.directionalLight,
    }));

    const sceneResult = usePolySceneContext(inputPolygons, sceneContextOptions);

    // Scene element is a 0×0 anchor at world (0,0,0). Pinning to top:50%/
    // left:50% places that point at the visible center of .polycss-camera —
    // mirrors React's PolyScene anchor pattern.
    const sceneStyle = computed(() => {
      const handle = createIsometricCamera(cameraState);
      const cameraStyle = handle.getStyle();
      return {
        "--scene-transform": cameraStyle.transform,
      };
    });

    // Per-polygon context: lighting + scene units.
    const polyContext = computed(() => {
      const tileSize = 50;
      return {
        tileSize,
        layerElevation: tileSize,
        directionalLight: props.directionalLight,
        textureLighting: props.textureLighting,
        atlasScale: props.atlasScale,
      };
    });

    // In dynamic mode the atlas is light-independent (CSS does the
    // shading), so we deliberately drop both lights from the plan inputs
    // — that prevents the atlas from rebuilding (and the polygons from
    // blanking) every time the user moves a light slider.
    const textureAtlasPlans = computed(() => {
      const dynamic = props.textureLighting === "dynamic";
      const directionalForAtlas = dynamic ? undefined : props.directionalLight;
      const ambientForAtlas = dynamic ? undefined : props.ambientLight;
      return sceneResult.value.polygons.map((p, i) =>
        computeTextureAtlasPlan(p, i, {
          tileSize: polyContext.value.tileSize,
          layerElevation: polyContext.value.layerElevation,
          directionalLight: directionalForAtlas,
          ambientLight: ambientForAtlas,
        })
      );
    });
    const atlasTextureLighting = computed<PolyTextureLightingMode>(() => props.textureLighting ?? "baked");
    const atlasScale = computed(() => props.atlasScale);
    const textureAtlas = useTextureAtlas(textureAtlasPlans, atlasTextureLighting, atlasScale);

    // Dynamic mode plumbing: emit normalized light direction + light/ambient
    // color/intensity as CSS custom properties on the scene root. They cascade
    // into every polygon, where a per-element calc resolves the Lambert dot
    // product and tints via background-blend-mode.
    const dynamicLightVars = computed<Record<string, string> | null>(() => {
      if (props.textureLighting !== "dynamic") return null;
      const dir = props.directionalLight?.direction ?? [0.4, -0.7, 0.59];
      const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
      const lx = dir[0] / len, ly = dir[1] / len, lz = dir[2] / len;
      const lightRgb = parseHexColor(props.directionalLight?.color ?? "#ffffff")?.rgb ?? [255, 255, 255];
      const ambRgb = parseHexColor(props.ambientLight?.color ?? "#ffffff")?.rgb ?? [255, 255, 255];
      const lightIntensity = props.directionalLight?.intensity ?? 1;
      const ambientIntensity = props.ambientLight?.intensity ?? 0.4;
      const ch = (n: number) => (n / 255).toFixed(4);
      return {
        "--plx": lx.toFixed(4),
        "--ply": ly.toFixed(4),
        "--plz": lz.toFixed(4),
        "--plr": ch(lightRgb[0]),
        "--plg": ch(lightRgb[1]),
        "--plb": ch(lightRgb[2]),
        "--pli": lightIntensity.toFixed(4),
        "--par": ch(ambRgb[0]),
        "--pag": ch(ambRgb[1]),
        "--pab": ch(ambRgb[2]),
        "--pai": ambientIntensity.toFixed(4),
      };
    });

    // autoCenter wrapper transform: translate3d that brings the mesh's
    // bbox center to the scene element's own (0,0,0). Mirrors React's
    // autoCenterTransform useMemo.
    const autoCenterTransform = computed<string | undefined>(() => {
      if (!props.autoCenter) return undefined;
      const bbox = sceneResult.value.sceneBbox;
      const ctx = polyContext.value;
      const cssX = ((bbox.min[1] + bbox.max[1]) / 2) * ctx.tileSize;
      const cssY = ((bbox.min[0] + bbox.max[0]) / 2) * ctx.tileSize;
      const cssZ = ((bbox.min[2] + bbox.max[2]) / 2) * ctx.layerElevation;
      return `translate3d(${-cssX}px, ${-cssY}px, ${-cssZ}px)`;
    });

    // Cleanup hook placeholder — nothing to unsubscribe in PolyScene currently.
    onBeforeUnmount(() => {
      // no-op: reserved for future store subscriptions
    });

    return () => {
      const computedClass = `polycss-scene${props.class ? ` ${props.class}` : ""}`;

      const ctx = polyContext.value;

      const polyNodes = textureAtlas.entries.value.map((entry, index) => {
        if (entry) {
          return renderTextureAtlasPoly({
            entry,
            page: textureAtlas.pages.value[entry.pageIndex],
            textureLighting: ctx.textureLighting ?? "baked",
          });
        }
        const plan = textureAtlasPlans.value[index];
        if (!plan || plan.texture) return null;
        return isSolidTrianglePlan(plan)
          ? renderTextureTrianglePoly({ entry: plan, textureLighting: ctx.textureLighting ?? "baked" })
          : renderTextureBorderShapePoly({ entry: plan });
      });

      const slotChildren = slots.default?.() ?? [];

      const innerChildren = autoCenterTransform.value
        ? [
            h(
              "div",
              {
                class: "polycss-offset",
                style: {
                  "--offset-transform": autoCenterTransform.value,
                },
              },
              [...polyNodes, ...slotChildren]
            ),
          ]
        : [...polyNodes, ...slotChildren];

      return h(
        "div",
        {
          ref: sceneElLocalRef,
          class: computedClass,
          "data-polycss-lighting": ctx.textureLighting ?? "baked",
          "aria-hidden": "true",
          style: {
            ...sceneStyle.value,
            ...(dynamicLightVars.value ?? null),
            ...(attrs.style as Record<string, unknown> | undefined),
          },
          ...Object.fromEntries(
            Object.entries(attrs).filter(([k]) => k !== "style" && k !== "class")
          ),
        },
        innerChildren
      );
    };
  },
});
