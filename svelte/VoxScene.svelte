<script lang="ts">
  import { getContext } from "svelte";
  import type { VoxelGrid, ProjectionMode } from "@voxcss/core";
  import type { SceneController } from "@voxcss/controller/createSceneController";
  import { CONTROLLER_KEY } from "./context";
  import { sceneBinding } from "./bindings";
  import { createSceneComponent } from "./createSceneComponent";

  export let voxels: VoxelGrid | undefined;
  export let rows: number | undefined;
  export let cols: number | undefined;
  export let depth: number | undefined;
  export let showWalls: boolean | undefined;
  export let showFloor: boolean | undefined;
  export let projection: ProjectionMode | undefined;

  const controller = getContext<SceneController>(CONTROLLER_KEY);
  const sceneComponent = createSceneComponent({
    getController: () => controller
  });

  $: bindingOptions = sceneComponent.getBindingOptions({
    voxels,
    rows,
    cols,
    depth,
    showWalls,
    showFloor,
    projection
  });
</script>

<div use:sceneBinding={bindingOptions} class={sceneComponent.className}></div>
