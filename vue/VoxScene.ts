import {
  defineComponent,
  h,
  inject,
  onMounted,
  onBeforeUnmount,
  ref,
  watch,
  type PropType
} from "vue";
import { createSceneHost } from "@voxcss/controller/createSceneHost";
import type { SceneHost } from "@voxcss/controller/createSceneHost";
import type { SceneController } from "@voxcss/controller/createSceneController";
import { inferGridDimensions, wallMasksEqual } from "@voxcss/core";
import type { SceneDimensions, VoxelGrid, WallsMask, ProjectionMode } from "@voxcss/core";
import { CONTROLLER_KEY } from "./VoxCamera";

function shouldResolveTexture(name: string): boolean {
  return !(
    name.startsWith("/") ||
    name.startsWith("./") ||
    name.startsWith("../") ||
    name.startsWith("http://") ||
    name.startsWith("https://") ||
    name.includes(".")
  );
}

export default defineComponent({
  name: "VoxScene",
  props: {
    voxels: { type: Array, default: () => [] },
    rows: { type: Number, default: undefined },
    cols: { type: Number, default: undefined },
    depth: { type: Number, default: undefined },
    showWalls: { type: Boolean, default: false },
    showFloor: { type: Boolean, default: false },
    projection: { type: String as PropType<ProjectionMode | undefined>, default: undefined },
    dimetric: { type: Boolean, default: false }
  },
  setup(props) {
    const hostElement = ref<HTMLElement | null>(null);
    const host = ref<SceneHost | null>(null);
    const injectedController = inject<SceneController | null>(CONTROLLER_KEY, null);

    if (!injectedController) {
      throw new Error("voxcss: VoxScene must be rendered inside a VoxCamera.");
    }
    const controller = injectedController;

    const wallsSnapshot = ref<WallsMask | null>(controller.getWalls());
    const boxStyle = ref<Record<string, string>>(controller.getBoxStyle());
    let stopCamera: (() => void) | null = controller.subscribeCamera(() => handleCameraUpdate());
    let stopBoxStyle: (() => void) | null = controller.subscribeBoxStyle((style) => {
      boxStyle.value = style;
    });

    function handleCameraUpdate() {
      if (!controller) return;
      const nextWalls = controller.getWalls();
      if (wallsSnapshot.value && wallMasksEqual(wallsSnapshot.value, nextWalls)) {
        return;
      }
      wallsSnapshot.value = nextWalls;
      host.value?.updateContext(buildContext());
    }

    function syncDimensions() {
      const inferred = inferGridDimensions(props.voxels as VoxelGrid);
      const rows = typeof props.rows === "number" ? props.rows : inferred.rows;
      const cols = typeof props.cols === "number" ? props.cols : inferred.cols;
      const depth = typeof props.depth === "number" ? props.depth : inferred.depth;
      const dimensions: SceneDimensions = { rows, cols, depth };
      controller.setDimensions(dimensions);
    }

    function syncDepth() {
      const inferred = inferGridDimensions(props.voxels as VoxelGrid);
      const depth = typeof props.depth === "number" ? props.depth : inferred.depth;
      controller.setDimensions({ depth });
    }

    function buildContext() {
      const inferred = inferGridDimensions(props.voxels as VoxelGrid);
      const rows = typeof props.rows === "number" ? props.rows : inferred.rows;
      const cols = typeof props.cols === "number" ? props.cols : inferred.cols;
      const depth = typeof props.depth === "number" ? props.depth : inferred.depth;
      const projectionMode = props.dimetric ? "dimetric" : (props.projection as ProjectionMode | undefined);
      controller.setProjection?.(projectionMode);
      return {
        rows,
        cols,
        depth,
        rotX: controller.getCameraState().rotX ?? 65,
        rotY: controller.getCameraState().rotY ?? 45,
        showWalls: props.showWalls,
        showFloor: props.showFloor,
        projection: projectionMode,
        walls: wallsSnapshot.value ?? controller.getWalls(),
        resolveTexture(name: string, face: string) {
          if (!name || name.startsWith("#")) return undefined;
          if (shouldResolveTexture(name)) {
            return `textures/${name}/${name}-${face}.svg`;
          }
          return name;
        }
      };
    }

    onMounted(() => {
      host.value = createSceneHost();
      if (!hostElement.value) return;
      host.value.mount(hostElement.value, props.voxels as VoxelGrid, buildContext());
      syncDimensions();
    });

    onBeforeUnmount(() => {
      host.value?.destroy();
      host.value = null;
      stopCamera?.();
      stopCamera = null;
      stopBoxStyle?.();
      stopBoxStyle = null;
    });

    watch(
      () => props.voxels,
      (next) => {
        host.value?.update(next as VoxelGrid, buildContext());
        syncDepth();
      }
    );

    watch(
      () => [props.rows, props.cols, props.depth, props.showWalls, props.showFloor, props.projection, props.dimetric],
      () => {
        host.value?.updateContext(buildContext());
        syncDimensions();
      }
    );

    return () =>
      h("div", {
        ref: hostElement,
        style: boxStyle.value
      });
  }
});
