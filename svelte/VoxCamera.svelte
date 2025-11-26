<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { createControllerStore, provideControllerStore } from "./context";
  import {
    CAMERA_HOST_CLASS,
    mountCameraBinding,
    type AutoRotateOption,
    type CameraComponentProps,
    type CameraSlotProps
  } from "@layoutit/voxcss";

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
  let slotProps: CameraSlotProps | null = null;
  let cursor = "default";
  let teardown: ReturnType<typeof mountCameraBinding> | null = null;
  const controllerStore = createControllerStore();
  provideControllerStore(controllerStore);

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

  onMount(() => {
    if (!cameraElement) return;
    const props = currentProps();
    teardown = mountCameraBinding(
      cameraElement,
      props,
      (snapshot) => {
        slotProps = snapshot;
        controllerStore.set(snapshot?.controller ?? null);
        cursor = snapshot?.cursor ?? "default";
      },
      (nextCursor) => {
        cursor = nextCursor;
      }
    );
    return () => {
      teardown?.destroy();
      teardown = null;
      slotProps = null;
      controllerStore.set(null);
      cursor = "default";
    };
  });

  $: teardown?.update(currentProps());

  export function startAutoRotate(value?: AutoRotateOption) {
    teardown?.startAutoRotate(value);
  }

  export function stopAutoRotate() {
    teardown?.stopAutoRotate();
  }

  onDestroy(() => {
    teardown?.destroy();
    teardown = null;
    slotProps = null;
    cursor = "default";
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
