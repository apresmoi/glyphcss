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
  computed,
  ref,
  watch,
  onMounted,
  onBeforeUnmount,
} from "vue";
import type { PropType } from "vue";
import type {
  Polygon,
  DirectionalLight,
  AutoRotateOption,
  Vec3,
} from "@polycss/core";
import { createIsometricCamera } from "@polycss/core";
import { PolyCameraContextKey } from "../camera";
import { useSceneContext } from "./useSceneContext";
import { injectBaseStyles } from "../styles";
import { Poly } from "../shapes/Poly";

export interface PolySceneProps {
  polygons?: Polygon[];
  perspective?: number;
  rotX?: number;
  rotY?: number;
  zoom?: number;
  directionalLight?: DirectionalLight;
  /** Mesh post-processing — `"auto"` runs `mergePolygons`, `"off"` passes through. */
  merge?: "off" | "auto";
  /**
   * When `true`, rotation pivots around the mesh's bbox center instead of
   * world (0,0,0). Polygon data is not mutated — a wrapper div translates
   * the polygons so the bbox center coincides with the scene anchor (0,0,0).
   * Mirrors React's PolyScene autoCenter prop.
   */
  autoCenter?: boolean;
  autoRotate?: AutoRotateOption;
  interactive?: boolean;
  invert?: boolean;
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
      type: Object as PropType<DirectionalLight>,
      default: undefined,
    },
    merge: {
      type: String as PropType<"off" | "auto">,
      default: "off",
    },
    autoCenter: { type: Boolean, default: false },
    autoRotate: {
      type: [Boolean, Number, Object] as PropType<AutoRotateOption>,
      default: undefined,
    },
    interactive: { type: Boolean },
    invert: { type: Boolean },
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
        injectBaseStyles(document);
        injected = true;
      }
    });

    // Toggle debugShowBackfaces class directly on the scene element
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
      merge: props.merge,
      directionalLight: props.directionalLight,
    }));

    const sceneResult = useSceneContext(inputPolygons, sceneContextOptions);

    // Scene element is a 0×0 anchor at world (0,0,0). Pinning to top:50%/
    // left:50% places that point at the visible center of .polycss-camera —
    // mirrors React's PolyScene anchor pattern.
    const sceneStyle = computed(() => {
      const handle = createIsometricCamera(cameraState);
      return {
        ...handle.getStyle(),
        top: "50%",
        left: "50%",
      };
    });

    // Per-polygon context: lighting + debug + scene units.
    const polyContext = computed(() => {
      const tileSize = 50;
      return {
        tileSize,
        layerElevation: tileSize,
        directionalLight: props.directionalLight,
        debugShowBackfaces: props.debugShowBackfaces,
      };
    });

    // depthOffset was a voxcss-era hack; centered meshes don't need it.
    const depthOffset = 0;

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

      const polygons = sceneResult.value.polygons;
      const ctx = polyContext.value;

      const polyNodes = polygons.map((p, i) =>
        h(Poly, {
          key: i,
          vertices: p.vertices,
          color: p.color,
          texture: p.texture,
          uvs: p.uvs,
          data: p.data,
          context: ctx,
        })
      );

      const slotChildren = slots.default?.() ?? [];

      const innerChildren = autoCenterTransform.value
        ? [
            h(
              "div",
              {
                style: {
                  transform: autoCenterTransform.value,
                  transformStyle: "preserve-3d",
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
          "data-polycss-depth-offset": String(depthOffset),
          style: {
            ...sceneStyle.value,
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
