<script lang="ts">
  import {
    SCENE_HOST_CLASS,
    mountScene,
    normalizeSceneState,
    type ProjectionMode,
    type VoxelGrid,
    type MergeVoxelsOption,
    type SceneController
  } from "@layoutit/voxcss";
  import { createEventDispatcher, onDestroy } from "svelte";
  import { useControllerStore } from "./context";

  export let voxels: VoxelGrid | undefined;
  export let rows: number | undefined;
  export let cols: number | undefined;
  export let depth: number | undefined;
  export let showWalls: boolean | undefined;
  export let showFloor: boolean | undefined;
  export let projection: ProjectionMode | undefined;
  export let mergeVoxels: MergeVoxelsOption = false;

  export let controller: SceneController | undefined;

  let element: HTMLDivElement | null = null;
  const dispatch = createEventDispatcher();
  let binding: ReturnType<typeof mountScene> | null = null;
  let lastController: typeof controller | null = null;
  const controllerStore = useControllerStore();
  let resolvedController: typeof controller | null = null;
  $: resolvedController = controller ?? $controllerStore ?? null;

  $: bindingOptions = normalizeSceneState({
    voxels,
    rows,
    cols,
    depth,
    showWalls,
    showFloor,
    projection,
    mergeVoxels
  });

  // Remount when the controller instance changes so subscriptions and pointer events stay in sync.
  $: {
    if (resolvedController && lastController && resolvedController !== lastController && binding) {
      binding.destroy();
      binding = null;
    }
    if (!resolvedController && binding) {
      binding.destroy();
      binding = null;
    }
    lastController = resolvedController;
  }

  $: {
    if (!resolvedController || !element) {
      return;
    }
    if (binding) {
      binding.update(bindingOptions);
    } else if (element) {
      binding = mountScene({ element, controller: resolvedController, ...bindingOptions });
    }
  }

  onDestroy(() => {
    binding?.destroy();
    binding = null;
    dispatch("destroy");
  });
</script>

<div bind:this={element} class={SCENE_HOST_CLASS}></div>
