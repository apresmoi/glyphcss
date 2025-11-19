<script lang="ts">
  import { onMount, onDestroy, setContext } from "svelte";
  import { createCamera } from "@voxcss/core";
  import type { SceneController, WallsMask } from "@voxcss/core";
  import type { AutoRotateOption, CameraState } from "@voxcss/core/camera";
  import type { HeadlessCameraHandle } from "@voxcss/core/headless";
  import { resolveInvertMultiplier, normalizePerspectiveValue } from "@voxcss/controller/utils";
  import { CONTROLLER_KEY } from "./context";

  export let zoom: number = 0.65;
  export let pan: number = 0;
  export let tilt: number = 0;
  export let rotX: number = 65;
  export let rotY: number = 45;
  export let invert: boolean | number = false;
  export let perspective: number | boolean = 8000;
  export let interactive: boolean = false;
  export let animate: AutoRotateOption = false;

  let container: HTMLDivElement | null = null;
  let controller: SceneController | null = null;
  let cameraHandle: HeadlessCameraHandle | null = null;
  let boxStyle: Record<string, string> = {};
  let walls: WallsMask | null = null;
  let cameraState: CameraState | null = null;
  let cursor = "default";
  let unsubscribeStyle: (() => void) | null = null;
  let unsubscribeCamera: (() => void) | null = null;

  function syncSnapshot() {
    if (!controller) return;
    boxStyle = controller.getBoxStyle();
    cameraState = controller.getCameraState();
    walls = controller.getWalls();
    cursor = interactive ? controller.getCursor() : "default";
  }

  onMount(() => {
    if (!container) return;
    const handle = createCamera({
      element: container,
      interactive,
      perspective: normalizePerspectiveValue(perspective),
      zoom,
      pan,
      tilt,
      rotX,
      rotY,
      invert,
      animate
    });
    cameraHandle = handle;
    controller = handle.controller;
    setContext(CONTROLLER_KEY, controller);
    syncSnapshot();
    unsubscribeStyle = controller.subscribeBoxStyle((style) => {
      boxStyle = style;
    });
    unsubscribeCamera = controller.subscribeCamera((state) => {
      cameraState = state;
      walls = controller?.getWalls() ?? null;
      cursor = interactive && controller ? controller.getCursor() : "default";
    });
  });

  onDestroy(() => {
    unsubscribeStyle?.();
    unsubscribeCamera?.();
    cameraHandle?.destroy();
    cameraHandle = null;
    controller = null;
  });

  $: if (cameraHandle) {
    cameraHandle.controller.updateCamera({ zoom, pan, tilt, rotX, rotY });
  }

  $: if (controller) {
    controller.setControls({ invert: resolveInvertMultiplier(invert) });
  }

  $: cameraHandle?.setInteractive(interactive);
  $: cameraHandle?.setPerspective(normalizePerspectiveValue(perspective));
  $: cameraHandle?.setAnimate(animate);

  export function startAutoRotate(value?: AutoRotateOption) {
    cameraHandle?.setAnimate(value ?? animate);
  }

  export function stopAutoRotate() {
    cameraHandle?.setAnimate(false);
  }
</script>

<div bind:this={container} class="voxcss-camera" style={`cursor:${cursor}`}>
  {#if controller}
    <slot boxStyle={boxStyle} cursor={cursor} walls={walls} controller={controller} camera={cameraState} />
  {/if}
</div>
