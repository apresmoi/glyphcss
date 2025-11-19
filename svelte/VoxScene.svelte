<script lang="ts">
  import { getContext } from "svelte";
  import type { SceneController, VoxelGrid, ProjectionMode } from "@voxcss/core";
  import { CONTROLLER_KEY } from "./context";
  import { sceneHost } from "./sceneHost";

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

  $: hostOptions = {
    controller,
    voxels,
    rows,
    cols,
    depth,
    showWalls,
    showFloor,
    projection,
    dimetric
  };
</script>

<div use:sceneHost={hostOptions} class="voxcss-scene-host"></div>
