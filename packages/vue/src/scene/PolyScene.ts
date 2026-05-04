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
  ProjectionMode,
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

const DIMETRIC_CLASS = "polycss-projection--dimetric";

export interface PolySceneProps {
  polygons?: Polygon[];
  perspective?: number;
  rotX?: number;
  rotY?: number;
  zoom?: number;
  projection?: ProjectionMode;
  directionalLight?: DirectionalLight;
  /** Mesh post-processing — `"auto"` runs `mergePolygons`, `"off"` passes through. */
  merge?: "off" | "auto";
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
    projection: {
      type: String as PropType<ProjectionMode>,
      default: "cubic",
    },
    directionalLight: {
      type: Object as PropType<DirectionalLight>,
      default: undefined,
    },
    merge: {
      type: String as PropType<"off" | "auto">,
      default: "off",
    },
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
      projection: props.projection,
      merge: props.merge,
      directionalLight: props.directionalLight,
    }));

    const sceneResult = useSceneContext(inputPolygons, sceneContextOptions);

    // Compute camera style (transform + sizing) from the scene bbox.
    const sceneStyle = computed(() => {
      const handle = createIsometricCamera(cameraState);
      const bbox = sceneResult.value.sceneBbox;
      const sizeX = bbox.max[0] - bbox.min[0];
      const sizeY = bbox.max[1] - bbox.min[1];
      const sizeZ = bbox.max[2] - bbox.min[2];
      return handle.getStyle({
        rows: Math.max(1, Math.ceil(sizeX)),
        cols: Math.max(1, Math.ceil(sizeY)),
        depth: Math.max(1, Math.ceil(sizeZ)),
        dimetric: props.projection === "dimetric",
      });
    });

    const depthOffset = computed(() => {
      const bbox = sceneResult.value.sceneBbox;
      const sizeZ = bbox.max[2] - bbox.min[2];
      return sizeZ * cameraState.depthOffset * (props.projection === "dimetric" ? 0.5 : 1);
    });

    const polyContext = computed(() => ({
      directionalLight: props.directionalLight,
      debugShowBackfaces: props.debugShowBackfaces,
    }));

    // Cleanup hook placeholder — nothing to unsubscribe in PolyScene currently.
    onBeforeUnmount(() => {
      // no-op: reserved for future store subscriptions
    });

    return () => {
      const projection = props.projection ?? "cubic";
      const computedClass = `polycss-scene${
        projection === "dimetric" ? ` ${DIMETRIC_CLASS}` : ""
      }${props.class ? ` ${props.class}` : ""}`;

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

      return h(
        "div",
        {
          ref: sceneElLocalRef,
          class: computedClass,
          "data-polycss-depth-offset": String(depthOffset.value),
          style: {
            ...sceneStyle.value,
            ...(attrs.style as Record<string, unknown> | undefined),
          },
          ...Object.fromEntries(
            Object.entries(attrs).filter(([k]) => k !== "style" && k !== "class")
          ),
        },
        [...polyNodes, ...(slots.default?.() ?? [])]
      );
    };
  },
});
