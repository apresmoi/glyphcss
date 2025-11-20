<script lang="ts">
  import { getContext, onMount, onDestroy } from "svelte";
  import type { SceneController, VoxelGrid, ProjectionMode } from "@voxcss/core";
  import { CONTROLLER_KEY } from "./context";
  import { createSceneBinding, type SceneBindingHandle } from "@voxcss/controller/createSceneBinding";

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

  let container: HTMLDivElement | null = null;
  let binding: SceneBindingHandle | null = null;

  function mountBinding() {
    if (!controller || !container) return;
    binding = createSceneBinding({
      controller,
      element: container,
      voxels,
      rows,
      cols,
      depth,
      showWalls,
      showFloor,
      projection
    });
    binding.mount();
  }

  onMount(() => {
    mountBinding();
  });

  onDestroy(() => {
    binding?.destroy();
    binding = null;
  });

  $: if (binding) {
    binding.update({
      voxels,
      rows,
      cols,
      depth,
      showWalls,
      showFloor,
      projection
    });
  }
</script>

<div bind:this={container} class="voxcss-scene-host"></div>
