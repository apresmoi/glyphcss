<script lang="ts">
  import { setContext, onDestroy, onMount } from "svelte";
  import type { SceneController } from "@voxcss/controller/sceneController";
  import type { AutoRotateOption } from "@voxcss/core/camera";
  import { createCamera, type HeadlessCameraHandle } from "@voxcss/core/headless";
  import {
    CAMERA_HOST_CLASS,
    normalizeCameraOptions,
    syncCameraOptions,
    type CameraComponentProps,
    type CameraSlotProps,
    type NormalizedCameraOptions
  } from "@voxcss/controller/cameraBindings";
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

  let cameraElement: HTMLDivElement | null = null;
  let handle: HeadlessCameraHandle | null = null;
  let controller: SceneController | null = null;
  let slotProps: CameraSlotProps | null = null;
  let cursor = "default";
  let optionsState: NormalizedCameraOptions | null = null;
  let unsubscribers: Array<() => void> = [];

  const currentProps = (): CameraComponentProps => ({
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

  function applySnapshot() {
    if (!handle) return;
    const currentController = handle.controller;
    const nextCursor = handle.interactive ? currentController.getCursor() : "default";
    controller = currentController;
    slotProps = {
      boxStyle: currentController.getBoxStyle(),
      cursor: nextCursor,
      walls: currentController.getWalls(),
      camera: currentController.getCameraState(),
      controller: currentController
    };
    cursor = nextCursor;
  }

  function cleanup() {
    unsubscribers.forEach((dispose) => dispose());
    unsubscribers = [];
    handle?.destroy();
    handle = null;
    controller = null;
    slotProps = null;
    cursor = "default";
    optionsState = null;
  }

  onMount(() => {
    if (!cameraElement) return;
    const props = currentProps();
    optionsState = normalizeCameraOptions(props);
    handle = createCamera({ ...props, element: cameraElement });
    controller = handle.controller;
    setContext(CONTROLLER_KEY, controller);
    applySnapshot();
    unsubscribers = [
      controller.subscribeBoxStyle(applySnapshot),
      controller.subscribeCamera(applySnapshot),
      controller.subscribeWalls(applySnapshot),
      controller.subscribeCursor(applySnapshot)
    ];
    return cleanup;
  });

  $: if (handle && optionsState) {
    optionsState = syncCameraOptions(handle, optionsState, currentProps());
    applySnapshot();
  }

  export function startAutoRotate(value?: AutoRotateOption) {
    if (!handle || !optionsState) return;
    optionsState = syncCameraOptions(handle, optionsState, { animate: value });
    applySnapshot();
  }

  export function stopAutoRotate() {
    if (!handle || !optionsState) return;
    optionsState = syncCameraOptions(handle, optionsState, { animate: false });
    applySnapshot();
  }

  onDestroy(() => {
    cleanup();
  });
</script>

<div bind:this={cameraElement} class={CAMERA_HOST_CLASS} style={`cursor:${cursor}`}>
  {#if slotProps}
    <slot
      boxStyle={slotProps.boxStyle}
      cursor={slotProps.cursor}
      walls={slotProps.walls}
      controller={slotProps.controller}
      camera={slotProps.camera}
    />
  {/if}
</div>
