<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import type { SceneController } from "@voxcss/controller/sceneController";
  import type { AutoRotateOption } from "@voxcss/core/camera";
  import { CAMERA_HOST_CLASS, type CameraComponentProps, type CameraSlotProps } from "@voxcss/controller/domBindings";
  import { mountCameraBinding } from "@voxcss/controller/domBindings";

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
  let controller: SceneController | null = null;
  let slotProps: CameraSlotProps | null = null;
  let cursor = "default";
  let teardown: ReturnType<typeof mountCameraBinding> | null = null;

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

  function cleanup() {
    teardown?.destroy();
    teardown = null;
    controller = null;
    slotProps = null;
    cursor = "default";
  }

  onMount(() => {
    if (!cameraElement) return;
    const props = currentProps();
    teardown = mountCameraBinding(
      cameraElement,
      props,
      (snapshot) => {
        if (!snapshot) {
          controller = null;
          slotProps = null;
          cursor = "default";
          return;
        }
        controller = snapshot.controller;
        slotProps = {
          boxStyle: snapshot.boxStyle,
          cursor: snapshot.cursor,
          walls: snapshot.walls,
          camera: snapshot.camera,
          controller: snapshot.controller
        };
        cursor = snapshot.cursor;
      },
      (nextCursor) => {
        cursor = nextCursor;
      }
    );
    return cleanup;
  });

  $: teardown?.update(currentProps());

  export function startAutoRotate(value?: AutoRotateOption) {
    teardown?.startAutoRotate(value);
  }

  export function stopAutoRotate() {
    teardown?.stopAutoRotate();
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
