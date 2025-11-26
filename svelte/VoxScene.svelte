<script lang="ts">
  import type { VoxelGrid, ProjectionMode } from "@voxcss/core/types";
  import { SCENE_HOST_CLASS, mountScene, normalizeSceneState } from "@voxcss/controller/sceneBindings";
  import { createEventDispatcher, onDestroy } from "svelte";

  export let voxels: VoxelGrid | undefined;
  export let rows: number | undefined;
  export let cols: number | undefined;
  export let depth: number | undefined;
  export let showWalls: boolean | undefined;
  export let showFloor: boolean | undefined;
  export let projection: ProjectionMode | undefined;

  export let controller: import("@voxcss/controller/sceneController").SceneController;

  let element: HTMLDivElement | null = null;
  const dispatch = createEventDispatcher();
  let binding: ReturnType<typeof mountScene> | null = null;
  let lastController: typeof controller | null = null;

  $: bindingOptions = normalizeSceneState({
    voxels,
    rows,
    cols,
    depth,
    showWalls,
    showFloor,
    projection
  });

  // Remount when the controller instance changes so subscriptions and pointer events stay in sync.
  $: {
    if (controller && lastController && controller !== lastController && binding) {
      binding.destroy();
      binding = null;
    }
    lastController = controller;
  }

  $: {
    if (binding) {
      binding.update(bindingOptions);
    } else if (element && controller) {
      binding = mountScene({ element, controller, ...bindingOptions });
    }
  }

  onDestroy(() => {
    binding?.destroy();
    binding = null;
    dispatch("destroy");
  });
</script>

<div bind:this={element} class={SCENE_HOST_CLASS}></div>
