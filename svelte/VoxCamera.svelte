<script lang="ts">
  import { setContext, onDestroy } from "svelte";
  import type { SceneController } from "@voxcss/controller/createSceneController";
  import type { AutoRotateOption } from "@voxcss/core/camera";
  import { CONTROLLER_KEY } from "./context";
  import { createCameraComponent } from "./createCameraComponent";

  export let zoom: number | undefined;
  export let pan: number | undefined;
  export let tilt: number | undefined;
  export let rotX: number | undefined;
  export let rotY: number | undefined;
  export let invert: boolean | number | undefined;
  export let perspective: number | boolean | undefined;
  export let interactive: boolean | undefined;
  export let animate: AutoRotateOption | undefined;

  const cameraComponent = createCameraComponent({
    onControllerReady(controller: SceneController) {
      setContext(CONTROLLER_KEY, controller);
    }
  });

  let cameraElement: HTMLDivElement | null = null;

  $: cameraComponent.setProps({
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

  $: cameraComponent.setElement(cameraElement);
  $: slotProps = cameraComponent.getSlotProps();
  $: cursor = cameraComponent.getCursor();

  onDestroy(() => {
    cameraComponent.destroy();
  });

  export function startAutoRotate(value?: AutoRotateOption) {
    cameraComponent.startAutoRotate(value);
  }

  export function stopAutoRotate() {
    cameraComponent.stopAutoRotate();
  }
</script>

<div bind:this={cameraElement} class={cameraComponent.className} style={`cursor:${cursor}`}>
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
