<script lang="ts">
  import { getContext } from "svelte";
  import type { SceneController, VoxelGrid, ProjectionMode } from "@voxcss/core";
  import { CONTROLLER_KEY } from "./context";
  import { sceneBinding } from "./bindings";

  export let voxels: VoxelGrid | undefined;
  export let rows: number | undefined;
  export let cols: number | undefined;
  export let depth: number | undefined;
  export let showWalls: boolean | undefined;
  export let showFloor: boolean | undefined;
  export let projection: ProjectionMode | undefined;

  const controller = getContext<SceneController>(CONTROLLER_KEY);
  if (!controller) {
    throw new Error("voxcss: VoxScene must be used inside VoxCamera.");
  }

  $: bindingOptions = {
    controller,
    voxels,
    rows,
    cols,
    depth,
    showWalls,
    showFloor,
    projection
  };
</script>

<div use:sceneBinding={bindingOptions} class="voxcss-scene-host"></div>
