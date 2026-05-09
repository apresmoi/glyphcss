/**
 * <PolyMapControls> — map-style camera controls for polycss.
 *
 * Same as PolyOrbitControls but with left/right swapped:
 * Left-drag: pans target along world ground plane.
 * Right-drag or Shift+left-drag: rotates rotX/rotY (orbit).
 * Wheel: zooms (wheel up = zoom in).
 *
 *   <PolyCamera rotX={30} rotY={0} zoom={0.12}>
 *     <PolyScene>
 *       <PolyMapControls />
 *       <PolyMesh polygons={...} />
 *     </PolyScene>
 *   </PolyCamera>
 */
import { useEffect, useRef } from "react";
import { useCameraContext } from "../camera/context";
import {
  buildOrbitControls,
  type SharedControlsProps,
  type PolyControlsCamera,
} from "./sharedControls";
import { makeWheelEffect, makeAnimateEffect } from "./controlsEffects";

export type { PolyControlsCamera as PolyMapControlsCamera };
export interface PolyMapControlsProps extends SharedControlsProps {}

export function PolyMapControls({
  drag = true,
  wheel = true,
  invert = false,
  zoom,
  animate = false,
  onChange,
  onInteractionStart,
  onInteractionEnd,
}: PolyMapControlsProps): null {
  const { store, cameraRef, cameraElRef, applyTransformDirect } = useCameraContext();

  const dragRef = useRef(drag);
  const wheelRef = useRef(wheel);
  const invertRef = useRef(invert);
  const zoomMinRef = useRef(zoom?.min ?? 0.1);
  const zoomMaxRef = useRef(zoom?.max ?? 10);
  const animateRef = useRef(animate);
  const onChangeRef = useRef(onChange);
  const onInteractionStartRef = useRef(onInteractionStart);
  const onInteractionEndRef = useRef(onInteractionEnd);
  useEffect(() => {
    dragRef.current = drag;
    wheelRef.current = wheel;
    invertRef.current = invert;
    zoomMinRef.current = zoom?.min ?? 0.1;
    zoomMaxRef.current = zoom?.max ?? 10;
    animateRef.current = animate;
    onChangeRef.current = onChange;
    onInteractionStartRef.current = onInteractionStart;
    onInteractionEndRef.current = onInteractionEnd;
  });

  const cameraSnapshot = (): PolyControlsCamera => {
    const s = cameraRef.current.state;
    return { rotX: s.rotX, rotY: s.rotY, zoom: s.zoom, target: s.target };
  };
  const fireChange = (): void => {
    const fn = onChangeRef.current;
    if (!fn) return;
    try { fn(cameraSnapshot()); } catch (err) { console.error("[polycss/react] PolyMapControls onChange threw:", err); }
  };
  const fireStart = (): void => {
    const fn = onInteractionStartRef.current;
    if (!fn) return;
    try { fn(cameraSnapshot()); } catch (err) { console.error("[polycss/react] PolyMapControls onInteractionStart threw:", err); }
  };
  const fireEnd = (): void => {
    const fn = onInteractionEndRef.current;
    if (!fn) return;
    try { fn(cameraSnapshot()); } catch (err) { console.error("[polycss/react] PolyMapControls onInteractionEnd threw:", err); }
  };

  const animationPausedShared = useRef({ value: false }).current;

  // ── Pointer drag: left=pan, right/shift+left=orbit ─────────────────────
  useEffect(() => {
    if (!drag) return;
    const el = cameraElRef.current;
    if (!el) return;

    let activePointerId: number | null = null;
    let pointer = { x: 0, y: 0 };
    let animationPaused = false;
    let rightDragActive = false;
    let rightPointer = { x: 0, y: 0 };

    const onDown = (e: PointerEvent): void => {
      if (!dragRef.current) return;
      if (activePointerId !== null) return;
      if (e.isPrimary === false) return;
      e.preventDefault();
      activePointerId = e.pointerId;
      pointer = { x: e.clientX, y: e.clientY };
      el.style.cursor = "grabbing";
      try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const a = animateRef.current;
      if (a && (a as { pauseOnInteraction?: boolean }).pauseOnInteraction !== false) {
        animationPaused = true;
        animationPausedShared.value = true;
      }
      fireStart();
    };

    const onMove = (e: PointerEvent): void => {
      if (activePointerId === null || e.pointerId !== activePointerId) return;
      if (!dragRef.current) return;
      e.preventDefault();
      const dx = e.clientX - pointer.x;
      const dy = e.clientY - pointer.y;
      pointer = { x: e.clientX, y: e.clientY };
      const handle = cameraRef.current;
      if (e.shiftKey) {
        // Shift+left = orbit
        buildOrbitControls.applyOrbit(dx, dy, handle.state, handle, invertRef.current);
      } else {
        // Left = pan (map convention)
        buildOrbitControls.applyPan(dx, dy, handle.state, handle, invertRef.current);
      }
      applyTransformDirect();
      store.updateCameraFromRef(handle);
      fireChange();
    };

    const onUp = (e: PointerEvent): void => {
      if (activePointerId !== e.pointerId) return;
      activePointerId = null;
      el.style.cursor = dragRef.current ? "grab" : "";
      try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      if (animationPaused) {
        animationPaused = false;
        animationPausedShared.value = false;
      }
      fireEnd();
    };

    const onContextMenu = (e: Event): void => { e.preventDefault(); };

    // Right-drag = orbit
    const onMouseDown = (e: MouseEvent): void => {
      if (e.button !== 2) return;
      rightDragActive = true;
      rightPointer = { x: e.clientX, y: e.clientY };
    };
    const onMouseMove = (e: MouseEvent): void => {
      if (!rightDragActive || !dragRef.current) return;
      const dx = e.clientX - rightPointer.x;
      const dy = e.clientY - rightPointer.y;
      rightPointer = { x: e.clientX, y: e.clientY };
      const handle = cameraRef.current;
      buildOrbitControls.applyOrbit(dx, dy, handle.state, handle, invertRef.current);
      applyTransformDirect();
      store.updateCameraFromRef(handle);
      fireChange();
    };
    const onMouseUp = (e: MouseEvent): void => {
      if (e.button !== 2) return;
      if (rightDragActive) { rightDragActive = false; fireEnd(); }
    };

    el.style.cursor = "grab";
    el.style.touchAction = "none";
    el.style.userSelect = "none";
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    el.addEventListener("contextmenu", onContextMenu);
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("mousemove", onMouseMove);
    el.addEventListener("mouseup", onMouseUp);

    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      el.removeEventListener("contextmenu", onContextMenu);
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("mousemove", onMouseMove);
      el.removeEventListener("mouseup", onMouseUp);
      el.style.cursor = "";
      el.style.touchAction = "";
      el.style.userSelect = "";
    };
  }, [drag, applyTransformDirect, cameraElRef, cameraRef, store]);

  // ── Wheel zoom ─────────────────────────────────────────────────────────
  useEffect(
    () => makeWheelEffect({ wheel, wheelRef, zoomMinRef, zoomMaxRef, cameraElRef, cameraRef, applyTransformDirect, store, fireStart, fireChange, fireEnd }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wheel, applyTransformDirect, cameraElRef, cameraRef, store]
  );

  // ── Animate (autorotate) ────────────────────────────────────────────────
  useEffect(
    () => makeAnimateEffect({ animateOn: !!animate, animateRef, animationPausedShared, applyTransformDirect, cameraRef, store, fireChange }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [!!animate, animationPausedShared, applyTransformDirect, cameraRef, store]
  );

  return null;
}
