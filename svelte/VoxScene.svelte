<script lang="ts">
  import type { VoxelGrid, ProjectionMode } from "@voxcss/core";
  import { SCENE_HOST_CLASS, type SceneComponentProps } from "@voxcss/controller/sceneBindings";
  import { createEventDispatcher, onDestroy } from "svelte";
  import { attachSceneBinding } from "@voxcss/controller/domBindings";

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
  let binding: ReturnType<typeof attachSceneBinding> | null = null;

  $: bindingOptions = ({
    voxels,
    rows,
    cols,
    depth,
    showWalls,
    showFloor,
    projection
  } satisfies SceneComponentProps);

  $: {
    if (binding) {
      binding.update(bindingOptions);
    } else if (element && controller) {
      binding = attachSceneBinding({ element, controller, ...bindingOptions });
    }
  }

  onDestroy(() => {
    binding?.destroy();
    binding = null;
    dispatch("destroy");
  });
</script>

<div bind:this={element} class={SCENE_HOST_CLASS}></div>
