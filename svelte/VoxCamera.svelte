<script lang="ts">
  import { onMount, onDestroy, setContext } from "svelte";
  import type { SceneController, WallsMask } from "@voxcss/core";
  import type { AutoRotateOption, CameraState } from "@voxcss/core/camera";
  import {
    createCameraBinding,
    type CameraBindingHandle,
    type CameraRenderSnapshot
  } from "@voxcss/controller/createCameraBinding";
  import { CONTROLLER_KEY } from "./context";

  export let zoom: number | undefined;
  export let pan: number | undefined;
  export let tilt: number | undefined;
  export let rotX: number | undefined;
  export let rotY: number | undefined;
  export let invert: boolean | number | undefined;
  export let perspective: number | boolean | undefined;
  export let interactive: boolean | undefined;
  export let animate: AutoRotateOption | undefined;

  let container: HTMLDivElement | null = null;
  let controller: SceneController | null = null;
  let cameraBinding: CameraBindingHandle | null = null;
  let boxStyle: Record<string, string> = {};
  let walls: WallsMask | null = null;
  let cameraState: CameraState | null = null;
  let cursor = "default";
  let unsubscribeSnapshot: (() => void) | null = null;

  function applySnapshot(next: CameraRenderSnapshot) {
    boxStyle = next.boxStyle;
    cameraState = next.camera;
    walls = next.walls;
    cursor = next.cursor;
  }

  onMount(() => {
    if (!container) return;
    const handle = createCameraBinding({
      element: container,
      interactive,
      perspective,
      zoom,
      pan,
      tilt,
      rotX,
      rotY,
      invert,
      animate
    });
    cameraBinding = handle;
    controller = handle.controller;
    setContext(CONTROLLER_KEY, controller);
    applySnapshot(handle.getSnapshot());
    unsubscribeSnapshot = handle.subscribe((next) => applySnapshot(next));
  });

  onDestroy(() => {
    unsubscribeSnapshot?.();
    cameraBinding?.destroy();
    cameraBinding = null;
    controller = null;
  });

  $: if (cameraBinding) {
    cameraBinding.setOptions({
      zoom,
      pan,
      tilt,
      rotX,
      rotY,
      invert,
      interactive,
      perspective,
      animate
    });
  }

  export function startAutoRotate(value?: AutoRotateOption) {
    cameraBinding?.setAnimate(value ?? animate);
  }

  export function stopAutoRotate() {
    cameraBinding?.setAnimate(false);
  }
</script>

<div bind:this={container} class="voxcss-camera" style={`cursor:${cursor}`}>
  {#if controller}
    <slot boxStyle={boxStyle} cursor={cursor} walls={walls} controller={controller} camera={cameraState} />
  {/if}
</div>
