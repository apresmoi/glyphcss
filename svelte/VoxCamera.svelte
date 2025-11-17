<script lang="ts">
  import { onDestroy, setContext } from "svelte";
  import { createSceneController } from "@voxcss/controller/createSceneController";
  import type { SceneController, WallsMask } from "@voxcss/core";
  import { CONTROLLER_KEY } from "./context";

  export let zoom: number = 0.65;
  export let pan: number = 0;
  export let tilt: number = 0;
  export let rotX: number = 65;
  export let rotY: number = 45;
  export let invert: boolean | number = false;
  export let perspective: number | boolean = 8000;
  export let interactive: boolean = false;

  const DEFAULT_INVERT_MULTIPLIER = 1;
  const DEFAULT_PERSPECTIVE = 8000;

  const resolveInvertMultiplier = (value: boolean | number): number => {
    if (typeof value === "number") {
      return value < 0 ? -1 : 1;
    }
    return value ? -1 : 1;
  };

  const resolvePerspectiveValue = (value: number | boolean): string => {
    if (value === false) return "none";
    const numeric = typeof value === "number" ? value : DEFAULT_PERSPECTIVE;
    return `${numeric}px`;
  };

  const controller: SceneController = createSceneController({
    camera: { zoom: 0.65, pan: 0, tilt: 0, rotX: 65, rotY: 45 },
    controls: { invert: DEFAULT_INVERT_MULTIPLIER }
  });

  setContext(CONTROLLER_KEY, controller);

  let boxStyle = controller.getBoxStyle();
  const unsubscribeStyle = controller.subscribeBoxStyle((style) => {
    boxStyle = style;
  });

  onDestroy(() => {
    unsubscribeStyle?.();
  });

  $: controller.updateCamera({ zoom, pan, tilt, rotX, rotY });
  $: controller.setControls({ invert: resolveInvertMultiplier(invert) });

  function handlePointerDown(event: PointerEvent) {
    if (!interactive) return;
    controller.handlePointerDown(event);
    (event.target as HTMLElement)?.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    if (!interactive) return;
    controller.handlePointerMove(event);
  }

  function handlePointerUp(event: PointerEvent) {
    if (!interactive) return;
    controller.handlePointerUp();
    (event.target as HTMLElement)?.releasePointerCapture?.(event.pointerId);
  }

  $: controllerCursor = controller.getCursor();
  $: cursor = interactive ? controllerCursor : "default";
  $: walls = controller.getWalls();
  $: cameraState = controller.getCameraState();
  $: boxStyleAttr = Object.entries(boxStyle)
    .map(([key, value]) => `${key}:${value}`)
    .join(";");
  $: sceneStyleAttr = `cursor:${cursor};perspective:${resolvePerspectiveValue(perspective)}`;
</script>

<div
  class="voxcss-scene"
  style={sceneStyleAttr}
  on:pointerdown={handlePointerDown}
  on:pointermove={handlePointerMove}
  on:pointerup={handlePointerUp}
  on:pointerleave={handlePointerUp}
>
  <slot boxStyle={boxStyle} cursor={cursor} walls={walls} controller={controller} camera={cameraState} />
</div>
