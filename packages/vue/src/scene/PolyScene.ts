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
  watchEffect,
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
import { createIsometricCamera, parseHexColor, BASE_TILE } from "@layoutit/polycss-core";
import { PolyCameraContextKey } from "../camera";
import { usePolySceneContext } from "./useSceneContext";
import { injectPolyBaseStyles } from "../styles";
import { PolySceneContextKey, type PolyShadowOptions, type PolyShadowRegistry } from "./sceneContext";
import {
  buildTextureEdgeRepairSets,
  computeTextureAtlasPlan,
  isSolidTrianglePlan,
  type TextureQuality,
  type PolyRenderStrategiesOption,
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
  /** Raster scale for generated atlas pages. `"auto"` (default) downscales to
   *  a device-appropriate memory budget (~4 MB mobile / ~16 MB desktop).
   *  Numeric values 0.1..1 force an explicit scale. */
  textureQuality?: TextureQuality;
  /** Opt out of specific render strategies. Disabled strategies fall through the chain (b→i→s, u→i→s, i→s). `<s>` cannot be disabled. */
  strategies?: PolyRenderStrategiesOption;
  /** Repairs antialiased atlas pixels at shared textured polygon edges without expanding geometry. Defaults to true. */
  experimentalTextureEdgeRepair?: boolean;
  /**
   * When `true`, rotation pivots around the mesh's bbox center instead of
   * world (0,0,0). Polygon data is not mutated — a wrapper div translates
   * the polygons so the bbox center coincides with the scene anchor (0,0,0).
   * Mirrors React's PolyScene autoCenter prop.
   */
  autoCenter?: boolean;
  /**
   * Shadow appearance for meshes with `castShadow: true`. Only applies in
   * dynamic lighting mode — baked mode does not emit shadow leaves.
   * Defaults: `{ color: "#000000", opacity: 0.25, lift: 0.05 }`.
   */
  shadow?: PolyShadowOptions;
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
    textureQuality: { type: [Number, String] as PropType<TextureQuality>, default: undefined },
    strategies: { type: Object as PropType<PolyRenderStrategiesOption>, default: undefined },
    experimentalTextureEdgeRepair: { type: Boolean as PropType<boolean>, default: true },
    autoCenter: { type: Boolean, default: false },
    shadow: { type: Object as PropType<PolyShadowOptions>, default: undefined },
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

    // Shadow registry: child PolyMesh components register their polygon
    // getters here when castShadow=true. The scene reads registered polygons
    // to compute --shadow-ground-cssz reactively without needing to enumerate
    // DOM children in JS.
    const shadowRegistryVersion = ref(0);
    const shadowRegistryMap = new Map<symbol, () => import("@layoutit/polycss-core").Polygon[]>();
    const shadowRegistry: PolyShadowRegistry = {
      register(id, getPolygons) {
        shadowRegistryMap.set(id, getPolygons);
        shadowRegistryVersion.value++;
      },
      unregister(id) {
        shadowRegistryMap.delete(id);
        shadowRegistryVersion.value++;
      },
      version: shadowRegistryVersion,
      getEntries() {
        return Array.from(shadowRegistryMap.values());
      },
    };

    // Propagate scene-level rendering options to descendants (PolyMesh /
    // helpers) so they pick up the same dynamic mode + lights as the
    // scene. Without this, a helper PolyMesh would default to baked
    // rendering while the scene's global CSS rule paints over it with
    // the dynamic calc — producing corrupt tints.
    const sceneCtxValue = computed(() => ({
      textureLighting: props.textureLighting ?? "baked",
      directionalLight: props.directionalLight,
      ambientLight: props.ambientLight,
      experimentalTextureEdgeRepair: props.experimentalTextureEdgeRepair,
      shadow: props.shadow,
      shadowRegistry,
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
    //
    // autoCenterOffset (bbox-center in world coords) is folded into the
    // innermost translate3d alongside `target`. Keeping them separate means
    // user pan survives mesh add/remove — the same split used in vanilla
    // createPolyScene.ts's buildSceneTransform.
    const sceneStyle = computed(() => {
      const s = cameraState;
      const offset = cameraCtx.autoCenterOffset.value;
      const tileSize = BASE_TILE;
      // world→CSS axis swap: world[0]→CSS Y, world[1]→CSS X, world[2]→CSS Z
      const wx = s.target[0] + offset[0];
      const wy = s.target[1] + offset[1];
      const wz = s.target[2] + offset[2];
      const cssX = wy * tileSize;
      const cssY = wx * tileSize;
      const cssZ = wz * tileSize;
      const distancePart = s.distance !== 0 ? `translateZ(${-s.distance}px) ` : "";
      const transform = `${distancePart}scale(${s.zoom}) rotateX(${s.rotX}deg) rotate(${s.rotY}deg) translate3d(${-cssX}px, ${-cssY}px, ${-cssZ}px)`;
      return { "--scene-transform": transform };
    });

    // Per-polygon context: lighting + scene units.
    const polyContext = computed(() => {
      const tileSize = 50;
      return {
        tileSize,
        layerElevation: tileSize,
        directionalLight: props.directionalLight,
        textureLighting: props.textureLighting,
        textureQuality: props.textureQuality,
        experimentalTextureEdgeRepair: props.experimentalTextureEdgeRepair,
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
      const repairEdges = buildTextureEdgeRepairSets(sceneResult.value.polygons);
      return sceneResult.value.polygons.map((p, i) =>
        computeTextureAtlasPlan(p, i, {
          tileSize: polyContext.value.tileSize,
          layerElevation: polyContext.value.layerElevation,
          directionalLight: directionalForAtlas,
          ambientLight: ambientForAtlas,
          textureEdgeRepairEdges: repairEdges[i],
          experimentalTextureEdgeRepair: props.experimentalTextureEdgeRepair,
        })
      );
    });
    const atlasTextureLighting = computed<PolyTextureLightingMode>(() => props.textureLighting ?? "baked");
    const atlasTextureQuality = computed(() => props.textureQuality);
    const atlasStrategies = computed(() => props.strategies);
    const textureAtlas = useTextureAtlas(textureAtlasPlans, atlasTextureLighting, atlasTextureQuality, atlasStrategies);

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
      // Clamp clz away from zero — the shadow projection divides by clz
      // (the up-axis component), so a near-horizontal light would project
      // shadows to infinity.
      const rawClz = lz;
      const clz = Math.sign(rawClz || 1) * Math.max(Math.abs(rawClz), 0.01);
      return {
        "--plx": lx.toFixed(4),
        "--ply": ly.toFixed(4),
        "--plz": lz.toFixed(4),
        "--clx": lx.toFixed(4),
        "--cly": ly.toFixed(4),
        "--clz": clz.toFixed(4),
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

    const DEFAULT_TILE = 50;

    // --shadow-ground-cssz: written directly to the scene element when casting
    // meshes register/unregister. A watchEffect is used instead of a computed
    // read in the render function because child PolyMesh components register
    // after the parent's first render (child setup runs during mount, not during
    // the parent's VNode creation). The watchEffect re-runs after child
    // registration because it reads shadowRegistryVersion, which the registry
    // mutates when a mesh registers or unregisters.
    watchEffect(() => {
      const el = sceneElLocalRef.value;
      if (!el) return;
      if (props.textureLighting !== "dynamic") {
        el.style.removeProperty("--shadow-ground-cssz");
        return;
      }
      void shadowRegistryVersion.value;
      const entries = shadowRegistry.getEntries();
      if (entries.length === 0) {
        el.style.removeProperty("--shadow-ground-cssz");
        return;
      }
      let minWorldZ = Infinity;
      for (const getPolygons of entries) {
        for (const poly of getPolygons()) {
          for (const v of poly.vertices) {
            if (v[2] < minWorldZ) minWorldZ = v[2];
          }
        }
      }
      if (!Number.isFinite(minWorldZ)) {
        el.style.removeProperty("--shadow-ground-cssz");
        return;
      }
      const lift = props.shadow?.lift ?? 0.05;
      el.style.setProperty("--shadow-ground-cssz", ((minWorldZ + lift) * DEFAULT_TILE).toFixed(3));
    });

    // Bbox-center of all centerable meshes in world coords. Folded into the
    // scene camera transform (alongside `target`) so the camera orbits the
    // model's visible center without adding a DOM wrapper or shifting polygon
    // coordinates. [0,0,0] when autoCenter is false or there are no polygons.
    // Written to cameraCtx.autoCenterOffset so applyTransformDirect (called
    // by orbit/map controls) picks it up on every pointer-driven camera move.
    const autoCenterOffset = computed<Vec3>(() => {
      if (!props.autoCenter) return [0, 0, 0];
      const bbox = sceneResult.value.sceneBbox;
      return [
        (bbox.min[0] + bbox.max[0]) / 2,
        (bbox.min[1] + bbox.max[1]) / 2,
        (bbox.min[2] + bbox.max[2]) / 2,
      ];
    });

    // Keep the camera context's autoCenterOffset in sync so controls that
    // call applyTransformDirect also include the bbox-center contribution.
    watchEffect(() => {
      cameraCtx.autoCenterOffset.value = autoCenterOffset.value;
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
        if (textureAtlas.useStableTriangle.value && isSolidTrianglePlan(plan)) {
          return renderTextureTrianglePoly({ entry: plan, textureLighting: ctx.textureLighting ?? "baked" });
        }
        if (textureAtlas.useBorderShape.value || textureAtlas.useFullRectSolid.value) {
          return renderTextureBorderShapePoly({ entry: plan });
        }
        return null;
      });

      const slotChildren = slots.default?.() ?? [];

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
        [...polyNodes, ...slotChildren]
      );
    };
  },
});
