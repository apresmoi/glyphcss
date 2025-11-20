<script lang="ts">
  import { getContext, onMount, onDestroy } from "svelte";
  import type { SceneController, VoxelGrid, ProjectionMode } from "@voxcss/core";
  import { CONTROLLER_KEY } from "./context";
  import { createSceneSession, type SceneSessionHandle } from "@voxcss/controller/createSceneSession";
  import { DEFAULT_SCENE_FLAGS } from "@voxcss/controller/defaults";

  export let voxels: VoxelGrid = [];
  export let rows: number | undefined = undefined;
  export let cols: number | undefined = undefined;
  export let depth: number | undefined = undefined;
  export let showWalls: boolean = DEFAULT_SCENE_FLAGS.showWalls;
  export let showFloor: boolean = DEFAULT_SCENE_FLAGS.showFloor;
  export let projection: ProjectionMode | undefined = DEFAULT_SCENE_FLAGS.projection;

  const controller = getContext<SceneController>(CONTROLLER_KEY);
  if (!controller) {
    throw new Error("voxcss: VoxScene must be used inside VoxCamera.");
  }

  let container: HTMLDivElement | null = null;
  let session: SceneSessionHandle | null = null;

  function mountSession() {
    if (!controller || !container) return;
    session = createSceneSession({
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
    session.mount();
  }

  onMount(() => {
    mountSession();
  });

  onDestroy(() => {
    session?.destroy();
    session = null;
  });

  $: if (session) {
    session.setState({
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
