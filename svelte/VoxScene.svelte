<script lang="ts">
  import type { VoxelGrid, ProjectionMode } from "@voxcss/core";
  import { sceneBinding } from "./bindings";
  import { SCENE_HOST_CLASS, type SceneComponentProps } from "@voxcss/controller/sceneBindings";

  export let voxels: VoxelGrid | undefined;
  export let rows: number | undefined;
  export let cols: number | undefined;
  export let depth: number | undefined;
  export let showWalls: boolean | undefined;
  export let showFloor: boolean | undefined;
  export let projection: ProjectionMode | undefined;

  export let controller: import("@voxcss/controller/sceneController").SceneController;

  $: bindingOptions = ({
    controller,
    voxels,
    rows,
    cols,
    depth,
    showWalls,
    showFloor,
    projection
  } satisfies SceneComponentProps);
</script>

<div use:sceneBinding={bindingOptions} class={SCENE_HOST_CLASS}></div>
