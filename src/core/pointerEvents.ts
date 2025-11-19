import type { SceneController } from "../controller/createSceneController";

export function attachPointerEvents(
  element: HTMLElement,
  controller: SceneController,
  onInteraction?: () => void
): () => void {
  const handlePointerDown = (event: PointerEvent) => {
    onInteraction?.();
    controller.handlePointerDown(event);
    element.setPointerCapture?.(event.pointerId);
  };
  const handlePointerMove = (event: PointerEvent) => controller.handlePointerMove(event);
  const handlePointerUp = (event: PointerEvent) => {
    controller.handlePointerUp();
    element.releasePointerCapture?.(event.pointerId);
  };
  element.addEventListener("pointerdown", handlePointerDown);
  element.addEventListener("pointermove", handlePointerMove);
  element.addEventListener("pointerup", handlePointerUp);
  element.addEventListener("pointerleave", handlePointerUp);
  return () => {
    element.removeEventListener("pointerdown", handlePointerDown);
    element.removeEventListener("pointermove", handlePointerMove);
    element.removeEventListener("pointerup", handlePointerUp);
    element.removeEventListener("pointerleave", handlePointerUp);
  };
}
