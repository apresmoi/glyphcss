import { defineComponent, h, computed, shallowRef, ref, inject, onMounted, onBeforeUnmount, watch } from "vue";
import type { PropType } from "vue";
import type { ProjectionMode, VoxelGrid, WallsMask } from "@layoutit/voxcss-core";
import { DEFAULT_WALL_COLOR, wallMasksEqual } from "@layoutit/voxcss-core";
import { createIsometricCamera } from "@layoutit/voxcss-core";
import type { MergeVoxelsOption } from "@layoutit/voxcss-core";
import { VoxCameraContextKey } from "../camera";
import { useSceneContext } from "./useSceneContext";
import { useSliceBrushes } from "../slice";
import { injectBaseStyles } from "../styles";
import type { SceneStore } from "../store";
import { renderFloor } from "./Floor";
import { renderCeiling } from "./Ceiling";
import { renderWalls } from "./Walls";

const DIMETRIC_CLASS = "voxcss-projection--dimetric";
const GRID_DISABLE_THRESHOLD = 20;

const gridSvgCache = new Map<string, string>();

export function buildGridSvgDataUrl(width: number, height: number, alpha: number): string {
  const key = `${width}x${height}:${alpha}`;
  const cached = gridSvgCache.get(key);
  if (cached) return cached;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges"><rect x="0" y="0" width="1" height="${height}" fill="rgb(0, 0, 0)" fill-opacity="${alpha}"/><rect x="0" y="0" width="${width}" height="1" fill="rgb(0, 0, 0)" fill-opacity="${alpha}"/></svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  gridSvgCache.set(key, url);
  return url;
}

export const VoxScene = defineComponent({
  name: "VoxScene",
  props: {
    voxels: { type: Array as PropType<VoxelGrid>, required: true },
    rows: { type: Number },
    cols: { type: Number },
    depth: { type: Number },
    showFloor: { type: Boolean, default: false },
    showWalls: { type: Boolean, default: false },
    projection: { type: String as PropType<ProjectionMode>, default: "cubic" },
    mergeVoxels: { type: [String, Boolean] as PropType<MergeVoxelsOption> },
    wallColor: { type: String, default: DEFAULT_WALL_COLOR },
  },
  setup(props) {
    const cameraCtx = inject(VoxCameraContextKey);
    if (!cameraCtx) {
      throw new Error("voxcss: VoxScene must be used inside a VoxCamera.");
    }

    const { store, sceneElRef } = cameraCtx;

    // Read camera state once for initial render — transform updates go via direct DOM
    const cameraState = store.getState().cameraState;

    // Subscribe to wall mask — re-renders only when mask actually changes.
    // Use shallowRef + equality check to avoid spurious Vue reactivity triggers.
    const wallMask = shallowRef(store.getState().wallMask);
    let unsubscribe: (() => void) | null = null;

    onMounted(() => {
      unsubscribe = store.subscribe(() => {
        const next = store.getState().wallMask;
        if (!wallMasksEqual(wallMask.value, next)) {
          wallMask.value = next;
        }
      });
    });

    onBeforeUnmount(() => {
      unsubscribe?.();
      unsubscribe = null;
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

    const sceneElLocalRef = ref<HTMLElement | null>(null);

    // Sync local ref to camera context's sceneElRef
    watch(sceneElLocalRef, (el) => {
      sceneElRef.value = el;
    });

    const sceneContextOptions = computed(() => ({
      rows: props.rows,
      cols: props.cols,
      depth: props.depth,
      projection: props.projection,
      showFloor: props.showFloor,
      showWalls: props.showWalls,
      wallColor: props.wallColor,
      // Only include wallMask for non-3d modes — 3d uses NO_WALLS internally
      wallMask: props.mergeVoxels === "3d" ? undefined : wallMask.value,
      mergeVoxels: props.mergeVoxels,
    }));

    const voxelsRef = computed(() => props.voxels);
    const sceneResult = useSceneContext(voxelsRef, sceneContextOptions);

    // Stable dimensions ref — only updates when rows/cols/depth actually change,
    // NOT on every wall mask change. This prevents sceneStyle from recomputing
    // and resetting the live camera transform set by applyTransformDirect.
    const stableDimensions = computed(() => sceneResult.value.dimensions);
    let prevDims = { rows: 0, cols: 0, depth: 0 };
    const dimensions = computed(() => {
      const dims = stableDimensions.value;
      if (dims.rows === prevDims.rows && dims.cols === prevDims.cols && dims.depth === prevDims.depth) {
        return prevDims;
      }
      prevDims = { rows: dims.rows, cols: dims.cols, depth: dims.depth };
      return prevDims;
    });

    // Scene style: ONLY width/height. Transform is NEVER in Vue's style.
    // Direct DOM exclusively owns el.style.transform.
    const sceneStyle = computed(() => {
      const dims = dimensions.value;
      const tileSize = 50;
      return {
        width: `${dims.cols * tileSize}px`,
        height: `${dims.rows * tileSize}px`,
      };
    });

    // Apply transform via direct DOM whenever scene element or dimensions change.
    // This is the ONLY place transform is set — Vue never touches it.
    watch(
      [sceneElLocalRef, dimensions, () => props.projection],
      ([el, dims]) => {
        if (!el) return;
        const cam = cameraCtx.cameraRef.value;
        const handle = createIsometricCamera(cam.state);
        const camStyle = handle.getStyle({
          rows: dims.rows,
          cols: dims.cols,
          depth: dims.depth,
          dimetric: props.projection === "dimetric",
        });
        el.style.transform = camStyle.transform;
        el.dataset.voxDepthOffset = String(
          dims.depth * cam.state.depthOffset * (props.projection === "dimetric" ? 0.5 : 1)
        );
      },
      { flush: "post" }
    );

    const is3d = computed(() => props.mergeVoxels === "3d");

    const sliceLayers = computed(() => is3d.value ? sceneResult.value.layers : []);
    const sliceContext = computed(() => sceneResult.value.context);
    const sliceBrushes = useSliceBrushes(sliceLayers, sliceContext);

    const floorRef = ref<HTMLElement | null>(null);

    return () => {

      const { context, dimensions, layers } = sceneResult.value;
      const mask = wallMask.value;
      const tileSize = context.tileSize;
      const layerElevation = context.layerElevation ?? tileSize;
      // Include mask classes declaratively so they survive Vue re-renders
      let className = `voxcss-scene${props.projection === "dimetric" ? ` ${DIMETRIC_CLASS}` : ""}`;
      for (const face of ["t", "b", "bl", "br", "fl", "fr"] as const) {
        if (mask[face]) className += ` voxcss-mask-${face}`;
      }

      const disableGrid = dimensions.rows > GRID_DISABLE_THRESHOLD && dimensions.cols > GRID_DISABLE_THRESHOLD;

      const sceneChildren = [];

      // Floor + slice hosts
      sceneChildren.push(
        ...renderFloor({
          layers,
          context,
          dimensions,
          showFloor: props.showFloor,
          wallMask: mask,
          wallColor: props.wallColor,
          tileSize,
          layerElevation,
          disableGrid,
          is3d: is3d.value,
          store: store as SceneStore,
          sliceBrushes,
          floorRef,
        })
      );

      // Ceiling
      if (props.showFloor && mask.t) {
        sceneChildren.push(
          renderCeiling({
            wallColor: props.wallColor,
            dimensions,
            tileSize,
          })
        );
      }

      // Walls
      if (props.showWalls) {
        sceneChildren.push(
          ...renderWalls({
            walls: context.walls,
            wallColor: props.wallColor,
            dimensions,
            tileSize,
            disableGrid,
            layerElevation,
          })
        );
      }

      return h(
        "div",
        {
          ref: sceneElLocalRef,
          class: className,
          "data-vox-depth-offset": String(
            dimensions.depth * cameraCtx.cameraRef.value.state.depthOffset * (props.projection === "dimetric" ? 0.5 : 1)
          ),
          style: {
            ...sceneStyle.value,
            "--voxcss-rows": dimensions.rows,
            "--voxcss-cols": dimensions.cols,
          },
        },
        sceneChildren
      );
    };
  },
});
