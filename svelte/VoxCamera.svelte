<script lang="ts">
  import { onMount, onDestroy, setContext } from "svelte";
  import type { SceneController, WallsMask } from "@voxcss/core";
  import type { AutoRotateOption, CameraState } from "@voxcss/core/camera";
  import { resolveInvertMultiplier } from "@voxcss/controller/cameraUtils";
  import { DEFAULT_CAMERA_PROPS } from "@voxcss/controller/defaults";
  import {
    createCameraBinding,
    type CameraBindingHandle,
    type CameraRenderSnapshot
  } from "@voxcss/controller/createCameraBinding";
  import { CONTROLLER_KEY } from "./context";

  export let zoom: number = DEFAULT_CAMERA_PROPS.zoom;
  export let pan: number = DEFAULT_CAMERA_PROPS.pan;
  export let tilt: number = DEFAULT_CAMERA_PROPS.tilt;
  export let rotX: number = DEFAULT_CAMERA_PROPS.rotX;
  export let rotY: number = DEFAULT_CAMERA_PROPS.rotY;
  export let invert: boolean | number = DEFAULT_CAMERA_PROPS.invert;
  export let perspective: number | boolean = DEFAULT_CAMERA_PROPS.perspective as number;
  export let interactive: boolean = DEFAULT_CAMERA_PROPS.interactive;
  export let animate: AutoRotateOption = (DEFAULT_CAMERA_PROPS.animate as AutoRotateOption) ?? false;

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
    cameraBinding.updateCamera({ zoom, pan, tilt, rotX, rotY });
  }

  $: if (cameraBinding) {
    cameraBinding.setControls({ invert: resolveInvertMultiplier(invert) });
  }

  $: cameraBinding?.setInteractive(interactive);
  $: cameraBinding?.setPerspective(perspective);
  $: cameraBinding?.setAnimate(animate);

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
