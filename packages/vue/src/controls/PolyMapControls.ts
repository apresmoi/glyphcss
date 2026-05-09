/**
 * <PolyMapControls> — Vue 3 map-style camera controls for polycss.
 *
 * Same as PolyOrbitControls but with left/right swapped:
 * Left-drag: pans target along world ground plane.
 * Right-drag or Shift+left-drag: rotates rotX/rotY (orbit).
 * Wheel: zooms (wheel up = zoom in).
 *
 *   <PolyCamera :rot-x="30" :rot-y="0" :zoom="0.12">
 *     <PolyScene>
 *       <PolyMapControls />
 *       <PolyMesh :polygons="..." />
 *     </PolyScene>
 *   </PolyCamera>
 */
import {
  defineComponent,
  inject,
  onMounted,
  onBeforeUnmount,
  watch,
  ref,
} from "vue";
import type { PropType } from "vue";
import { BASE_TILE } from "@layoutit/polycss-core";
import type { Vec3 } from "@layoutit/polycss-core";
import { PolyCameraContextKey } from "../camera/context";
import type { PolyControlsAnimateOptions } from "./PolyOrbitControls";

export type { PolyControlsAnimateOptions };

export interface PolyMapControlsCamera {
  rotX: number;
  rotY: number;
  zoom: number;
  target: Vec3;
}

export interface PolyMapControlsProps {
  drag?: boolean;
  wheel?: boolean;
  invert?: boolean | number;
  zoom?: { min?: number; max?: number };
  animate?: false | PolyControlsAnimateOptions;
}

const WHEEL_IDLE_END_MS = 150;
const POINTER_DRAG_SPEED = 4;
const ZOOM_STEP = 0.0008;
const ANIM_FRAME_MS = 16.67;
const ANIM_DT_CLAMP_MS = 50;
const DEFAULT_ZOOM_MIN = 0.1;
const DEFAULT_ZOOM_MAX = 10;
const DEFAULT_ANIMATE_SPEED = 0.3;

function invertFactor(invert: boolean | number | undefined): number {
  if (invert === true) return -1;
  if (invert === undefined || invert === false) return 1;
  return invert;
}

function applyOrbit(
  dx: number, dy: number,
  rotX: number, rotY: number,
  invert: boolean | number | undefined,
): { rotX: number; rotY: number } {
  const f = invertFactor(invert);
  const dX = (dx / POINTER_DRAG_SPEED) * f;
  const dY = (dy / POINTER_DRAG_SPEED) * f;
  return {
    rotX: Math.max(0, Math.min(100, rotX - dY)),
    rotY: (((rotY - dX) % 360) + 360) % 360,
  };
}

function applyPanDelta(
  dx: number, dy: number,
  zoom: number, rotX: number, rotY: number,
): { dWorldX: number; dWorldY: number } {
  const z = Math.max(0.01, zoom);
  const cosRotX = Math.max(0.1, Math.cos((rotX * Math.PI) / 180));
  const dWorldY = -dx / (z * BASE_TILE);
  const dWorldX = -dy / (z * BASE_TILE * cosRotX);
  const a = (-rotY * Math.PI) / 180;
  const cosA = Math.cos(a);
  const sinA = Math.sin(a);
  return {
    dWorldX: dWorldX * cosA - dWorldY * sinA,
    dWorldY: dWorldX * sinA + dWorldY * cosA,
  };
}

export const PolyMapControls = defineComponent({
  name: "PolyMapControls",
  props: {
    drag: { type: Boolean, default: true },
    wheel: { type: Boolean, default: true },
    invert: { type: [Boolean, Number] as PropType<boolean | number>, default: false },
    zoom: { type: Object as PropType<{ min?: number; max?: number }>, default: undefined },
    animate: {
      type: [Boolean, Object] as PropType<false | PolyControlsAnimateOptions>,
      default: false,
    },
  },
  emits: {
    change: (_camera: PolyMapControlsCamera) => true,
    "interaction-start": (_camera: PolyMapControlsCamera) => true,
    "interaction-end": (_camera: PolyMapControlsCamera) => true,
  },
  setup(props, { emit }) {
    const ctx = inject(PolyCameraContextKey, null);
    if (!ctx) {
      if (typeof console !== "undefined") {
        console.warn("[polycss] <PolyMapControls> must be used inside <PolyCamera>.");
      }
      return () => null;
    }
    const { store, cameraRef, cameraElRef, applyTransformDirect } = ctx;

    const cameraSnapshot = (): PolyMapControlsCamera => ({
      rotX: cameraRef.value.state.rotX,
      rotY: cameraRef.value.state.rotY,
      zoom: cameraRef.value.state.zoom,
      target: cameraRef.value.state.target,
    });
    const fireChange = (): void => { emit("change", cameraSnapshot()); };
    const fireStart = (): void => { emit("interaction-start", cameraSnapshot()); };
    const fireEnd = (): void => { emit("interaction-end", cameraSnapshot()); };

    let activePointerId: number | null = null;
    let pointer = { x: 0, y: 0 };
    const animationPaused = ref(false);

    let detachDrag: (() => void) | null = null;
    let detachWheel: (() => void) | null = null;
    let stopAnim: (() => void) | null = null;

    function attachDrag(): void {
      const el = cameraElRef.value;
      if (!el) return;

      let rightDragActive = false;
      let rightPointer = { x: 0, y: 0 };

      const onDown = (e: PointerEvent): void => {
        if (!props.drag) return;
        if (activePointerId !== null) return;
        if (e.isPrimary === false) return;
        e.preventDefault();
        activePointerId = e.pointerId;
        pointer = { x: e.clientX, y: e.clientY };
        el.style.cursor = "grabbing";
        try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* ignore */ }
        if (props.animate && (props.animate as PolyControlsAnimateOptions).pauseOnInteraction !== false) {
          animationPaused.value = true;
        }
        fireStart();
      };

      const onMove = (e: PointerEvent): void => {
        if (activePointerId === null || e.pointerId !== activePointerId) return;
        if (!props.drag) return;
        e.preventDefault();
        const dx = e.clientX - pointer.x;
        const dy = e.clientY - pointer.y;
        pointer = { x: e.clientX, y: e.clientY };
        const handle = cameraRef.value;
        const s = handle.state;
        if (e.shiftKey) {
          // Shift+left = orbit
          const { rotX, rotY } = applyOrbit(dx, dy, s.rotX, s.rotY, props.invert);
          handle.update({ rotX, rotY });
        } else {
          // Left = pan (map convention)
          const { dWorldX, dWorldY } = applyPanDelta(dx, dy, s.zoom, s.rotX, s.rotY);
          handle.update({ target: [s.target[0] + dWorldX, s.target[1] + dWorldY, s.target[2]] });
        }
        applyTransformDirect();
        store.updateCameraFromRef(handle);
        fireChange();
      };

      const onUp = (e: PointerEvent): void => {
        if (activePointerId !== e.pointerId) return;
        activePointerId = null;
        el.style.cursor = props.drag ? "grab" : "";
        try { (e.target as Element).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
        animationPaused.value = false;
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
        if (!rightDragActive || !props.drag) return;
        const dx = e.clientX - rightPointer.x;
        const dy = e.clientY - rightPointer.y;
        rightPointer = { x: e.clientX, y: e.clientY };
        const handle = cameraRef.value;
        const s = handle.state;
        const { rotX, rotY } = applyOrbit(dx, dy, s.rotX, s.rotY, props.invert);
        handle.update({ rotX, rotY });
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

      detachDrag = (): void => {
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
    }

    function attachWheel(): void {
      const el = cameraElRef.value;
      if (!el) return;
      let wheelActive = false;
      let wheelIdleTimer: ReturnType<typeof setTimeout> | null = null;
      const onWheel = (e: WheelEvent): void => {
        if (!props.wheel) return;
        e.preventDefault();
        const lineFactor = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 800 : 1;
        const factor = Math.exp(-e.deltaY * lineFactor * ZOOM_STEP);
        const handle = cameraRef.value;
        const minZ = props.zoom?.min ?? DEFAULT_ZOOM_MIN;
        const maxZ = props.zoom?.max ?? DEFAULT_ZOOM_MAX;
        const next = Math.max(minZ, Math.min(maxZ, handle.state.zoom * factor));
        handle.update({ zoom: next });
        applyTransformDirect();
        store.updateCameraFromRef(handle);
        if (!wheelActive) {
          wheelActive = true;
          fireStart();
        }
        fireChange();
        if (wheelIdleTimer !== null) clearTimeout(wheelIdleTimer);
        wheelIdleTimer = setTimeout(() => {
          wheelIdleTimer = null;
          wheelActive = false;
          fireEnd();
        }, WHEEL_IDLE_END_MS);
      };
      el.addEventListener("wheel", onWheel, { passive: false });
      detachWheel = (): void => {
        el.removeEventListener("wheel", onWheel);
        if (wheelIdleTimer !== null) clearTimeout(wheelIdleTimer);
      };
    }

    function startAnim(): void {
      let rafId: number | null = null;
      let stopped = false;
      let lastTime = 0;
      const tick = (now: number): void => {
        if (stopped) return;
        const a = props.animate;
        if (!a) {
          rafId = requestAnimationFrame(tick);
          return;
        }
        if (!animationPaused.value) {
          const dt = Math.min(ANIM_DT_CLAMP_MS, lastTime ? now - lastTime : ANIM_FRAME_MS);
          lastTime = now;
          const speed = (a as PolyControlsAnimateOptions).speed ?? DEFAULT_ANIMATE_SPEED;
          const delta = speed * (dt / ANIM_FRAME_MS);
          const handle = cameraRef.value;
          const s = handle.state;
          if ((a as PolyControlsAnimateOptions).axis === "x") {
            const rotX = (((s.rotX + delta) % 360) + 360) % 360;
            handle.update({ rotX });
          } else {
            const rotY = (((s.rotY + delta) % 360) + 360) % 360;
            handle.update({ rotY });
          }
          applyTransformDirect();
          store.updateCameraFromRef(handle);
          fireChange();
        } else {
          lastTime = now;
        }
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
      stopAnim = (): void => {
        stopped = true;
        if (rafId !== null) cancelAnimationFrame(rafId);
        stopAnim = null;
      };
    }

    onMounted(() => {
      if (props.drag) attachDrag();
      if (props.wheel) attachWheel();
      if (props.animate) startAnim();
    });

    onBeforeUnmount(() => {
      detachDrag?.();
      detachWheel?.();
      stopAnim?.();
      detachDrag = null;
      detachWheel = null;
    });

    watch(() => props.drag, (next) => {
      if (next && !detachDrag) attachDrag();
      if (!next && detachDrag) { detachDrag(); detachDrag = null; }
    });
    watch(() => props.wheel, (next) => {
      if (next && !detachWheel) attachWheel();
      if (!next && detachWheel) { detachWheel(); detachWheel = null; }
    });
    watch(() => !!props.animate, (next) => {
      if (next && !stopAnim) startAnim();
      if (!next && stopAnim) { stopAnim(); }
    });

    return () => null;
  },
});
