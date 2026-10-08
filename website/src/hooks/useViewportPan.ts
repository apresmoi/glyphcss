import { useCallback, useEffect, useState, type RefObject } from "react";

/** Pan a clipped surface without changing its cell size or exposing scrollbars. */
export function useViewportPan(
  viewportRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  resetKey: unknown,
) {
  const [canPan, setCanPan] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const resetView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  }, [viewportRef]);

  useEffect(resetView, [resetKey, resetView]);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    const overflows = () =>
      viewport.scrollWidth > viewport.clientWidth + 1 || viewport.scrollHeight > viewport.clientHeight + 1;
    const measure = () => setCanPan(overflows());
    let drag: { id: number; x: number; y: number; left: number; top: number } | undefined;
    let dragged = false;
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !overflows()) return;
      dragged = false;
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
    };
    const move = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x,
        dy = event.clientY - drag.y;
      if (!dragged && Math.hypot(dx, dy) < 4) return;
      if (!dragged) {
        dragged = true;
        viewport.setPointerCapture(event.pointerId);
        setIsPanning(true);
      }
      event.preventDefault();
      viewport.scrollLeft = drag.left - dx;
      viewport.scrollTop = drag.top - dy;
    };
    const up = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = undefined;
      if (event.type !== "pointerup") dragged = false;
      setIsPanning(false);
      if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    };
    const click = (event: MouseEvent) => {
      if (!dragged) return;
      // Dragging across an editable node must not also select it on release.
      event.preventDefault();
      event.stopPropagation();
      dragged = false;
    };
    const wheel = (event: WheelEvent) => {
      if (!overflows() || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
      viewport.scrollLeft += (event.shiftKey ? event.deltaY : event.deltaX) * unit;
      viewport.scrollTop += (event.shiftKey ? 0 : event.deltaY) * unit;
    };
    const key = (event: KeyboardEvent) => {
      if (event.target !== viewport || !overflows()) return;
      switch (event.key) {
        case "ArrowLeft":
          viewport.scrollLeft -= 40;
          break;
        case "ArrowRight":
          viewport.scrollLeft += 40;
          break;
        case "ArrowUp":
          viewport.scrollTop -= 40;
          break;
        case "ArrowDown":
          viewport.scrollTop += 40;
          break;
        case "PageUp":
          viewport.scrollTop -= viewport.clientHeight;
          break;
        case "PageDown":
          viewport.scrollTop += viewport.clientHeight;
          break;
        case "Home":
          resetView();
          break;
        case "End":
          viewport.scrollTop = viewport.scrollHeight;
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    viewport.addEventListener("pointerdown", down);
    viewport.addEventListener("pointermove", move);
    viewport.ownerDocument.addEventListener("pointerup", up, true);
    viewport.addEventListener("pointercancel", up);
    viewport.addEventListener("lostpointercapture", up);
    viewport.addEventListener("click", click, true);
    viewport.addEventListener("wheel", wheel, { passive: false });
    viewport.addEventListener("keydown", key);
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(viewport);
    observer?.observe(content);
    measure();
    return () => {
      observer?.disconnect();
      viewport.removeEventListener("pointerdown", down);
      viewport.removeEventListener("pointermove", move);
      viewport.ownerDocument.removeEventListener("pointerup", up, true);
      viewport.removeEventListener("pointercancel", up);
      viewport.removeEventListener("lostpointercapture", up);
      viewport.removeEventListener("click", click, true);
      viewport.removeEventListener("wheel", wheel);
      viewport.removeEventListener("keydown", key);
    };
  }, [viewportRef, contentRef, resetView]);

  return { canPan, isPanning, resetView };
}
