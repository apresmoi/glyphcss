<script lang="ts">
  import { setContext } from "svelte";
  import type { SceneController, WallsMask } from "@voxcss/core";
  import type { AutoRotateOption, CameraState } from "@voxcss/core/camera";
  import type { CameraBindingHandle, CameraRenderSnapshot } from "@voxcss/controller/createCameraBinding";
  import { CONTROLLER_KEY } from "./context";
  import { cameraBinding } from "./bindings";

  export let zoom: number | undefined;
  export let pan: number | undefined;
  export let tilt: number | undefined;
  export let rotX: number | undefined;
  export let rotY: number | undefined;
  export let invert: boolean | number | undefined;
  export let perspective: number | boolean | undefined;
  export let interactive: boolean | undefined;
  export let animate: AutoRotateOption | undefined;

  let controller: SceneController | null = null;
  let bindingHandle: CameraBindingHandle | null = null;
  let boxStyle: Record<string, string> = {};
  let walls: WallsMask | null = null;
  let cameraState: CameraState | null = null;
  let cursor = "default";

  function applySnapshot(next: CameraRenderSnapshot) {
    boxStyle = next.boxStyle;
    cameraState = next.camera;
    walls = next.walls;
    cursor = next.cursor;
  }

  function handleController(next: SceneController | null) {
    controller = next;
    if (next) {
      setContext(CONTROLLER_KEY, next);
    }
  }

  function handleHandle(next: CameraBindingHandle | null) {
    bindingHandle = next;
  }

  $: bindingOptions = {
    zoom,
    pan,
    tilt,
    rotX,
    rotY,
    invert,
    interactive,
    perspective,
    animate,
    onSnapshot: applySnapshot,
    onController: handleController,
    onHandle: handleHandle
  };

  export function startAutoRotate(value?: AutoRotateOption) {
    bindingHandle?.setAnimate(value ?? animate);
  }

  export function stopAutoRotate() {
    bindingHandle?.setAnimate(false);
  }
</script>

<div use:cameraBinding={bindingOptions} class="voxcss-camera" style={`cursor:${cursor}`}>
  {#if controller}
    <slot boxStyle={boxStyle} cursor={cursor} walls={walls} controller={controller} camera={cameraState} />
  {/if}
</div>
