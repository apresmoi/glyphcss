<script lang="ts">
  import { getContext, onDestroy, onMount } from "svelte";
  import { createSceneHost } from "@voxcss/controller/createSceneHost";
  import { wallMasksEqual, inferGridDimensions } from "@voxcss/core";
  import type { SceneHost, SceneController, VoxelGrid, WallsMask, ProjectionMode } from "@voxcss/core";
  import { CONTROLLER_KEY } from "./context";

  export let voxels: VoxelGrid = [];
  export let rows: number | undefined = undefined;
  export let cols: number | undefined = undefined;
  export let depth: number | undefined = undefined;
  export let showWalls = false;
  export let showFloor = false;
  export let projection: ProjectionMode | undefined = undefined;
  export let dimetric = false;

  const controller = getContext<SceneController>(CONTROLLER_KEY);
  if (!controller) {
    throw new Error("voxcss: VoxScene must be used inside VoxCamera.");
  }

  let host: SceneHost | null = null;
  let container: HTMLDivElement | null = null;
  let lastVoxels: VoxelGrid = voxels;
  let walls: WallsMask = controller.getWalls();
  let boxStyle = controller.getBoxStyle();
  const unsubscribeStyle = controller.subscribeBoxStyle((style) => {
    boxStyle = style;
  });

  const unsubscribeCamera = controller.subscribeCamera(() => {
    const nextWalls = controller.getWalls();
    if (wallMasksEqual(walls, nextWalls)) {
      return;
    }
    walls = nextWalls;
  });

  onDestroy(() => {
    unsubscribeCamera?.();
    unsubscribeStyle?.();
    host?.destroy();
    host = null;
  });

  onMount(() => {
    host = createSceneHost();
    if (container) {
      host.mount(container, voxels, buildContext());
    }
    lastVoxels = voxels;
    return () => {
      host?.destroy();
      host = null;
    };
  });

  function buildContext() {
    const inferred = inferGridDimensions(voxels);
    const depthValue = typeof depth === "number" ? depth : inferred.depth;
    const rowValue = typeof rows === "number" ? rows : inferred.rows;
    const colValue = typeof cols === "number" ? cols : inferred.cols;
    const projectionMode: ProjectionMode | undefined = dimetric ? "dimetric" : projection;
    controller.setProjection?.(projectionMode);
    return {
      rows: rowValue,
      cols: colValue,
      depth: depthValue,
      showWalls,
      showFloor,
      projection: projectionMode,
      walls,
      resolveTexture(name: string, face: string) {
        if (!name || name.startsWith("#")) return undefined;
        if (
          name.startsWith("/") ||
          name.startsWith("./") ||
          name.startsWith("../") ||
          name.startsWith("http://") ||
          name.startsWith("https://") ||
          name.includes(".")
        ) {
          return name;
        }
        return `textures/${name}/${name}-${face}.svg`;
      }
    };
  }

  function updateHost() {
    if (!host) return;
    const context = buildContext();
    if (lastVoxels !== voxels) {
      lastVoxels = voxels;
      host.update(voxels, context);
    } else {
      host.updateContext(context);
    }
  }

  $: inferredDims = inferGridDimensions(voxels);
  $: depthValue = typeof depth === "number" ? depth : inferredDims.depth;
  $: (() => {
    const rowValue = typeof rows === "number" ? rows : inferredDims.rows;
    const colValue = typeof cols === "number" ? cols : inferredDims.cols;
    controller.setDimensions({ rows: rowValue, cols: colValue, depth: depthValue });
  })();
  $: projection, updateHost();
  $: dimetric, updateHost();
</script>

<div
  bind:this={container}
  style={Object.entries(boxStyle)
    .map(([key, value]) => `${key}:${value}`)
    .join(";")}
>
</div>
