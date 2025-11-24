<script lang="ts">
  import type { VoxelGrid, ProjectionMode } from "@voxcss/core/types";
  import { SCENE_HOST_CLASS, type SceneComponentProps, type SceneState, mountScene } from "@voxcss/controller/sceneBindings";
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

  const resolveState = (input: SceneComponentProps): SceneState => ({
    voxels: input.voxels ?? [],
    rows: input.rows,
    cols: input.cols,
    depth: input.depth,
    showWalls: input.showWalls ?? false,
    showFloor: input.showFloor ?? false,
    projection: input.projection ?? "cubic"
  });

  $: bindingOptions = resolveState({
    voxels,
    rows,
    cols,
    depth,
    showWalls,
    showFloor,
    projection
  });

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
