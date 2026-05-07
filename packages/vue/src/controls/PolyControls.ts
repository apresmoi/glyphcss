/**
 * <PolyControls> — Vue 3 equivalent of the vanilla createPolyControls API.
 *
 * Render-free behavior component. Sits inside <PolyCamera> (typically also
 * <PolyScene>); uses inject() to pull the PolyCameraContext, attaches
 * pointer/wheel listeners on the camera root, and runs a dt-clamped
 * animate loop.
 *
 *   <PolyCamera :rot-x="65" :rot-y="45" :zoom="1">
 *     <PolyScene>
 *       <PolyControls drag wheel :animate="{ speed: 0.3 }" />
 *       <PolyMesh :polygons="..." />
 *     </PolyScene>
 *   </PolyCamera>
 *
 * Defaults: drag on, wheel on, animate off (pass false to opt out of
 * any). Animate uses dt-clamped formula (max 50 ms per tick, 60 Hz
 * reference) so 'speed' is consistent across refresh rates.
 *
 * If you also pass `interactive` or `animate` to <PolyCamera>, you'll
 * get duplicate handlers. Use one or the other.
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
import { PolyCameraContextKey } from "../camera/context";

export interface PolyControlsAnimateOptions {
  /** Degrees per 60Hz-equivalent frame. Default 0.3 (≈ 18 deg/sec). */
  speed?: number;
  /** Rotation axis. Default "y". */
  axis?: "x" | "y";
  /** Pause animate while a pointer drag is in progress. Default true. */
  pauseOnInteraction?: boolean;
}

export interface PolyControlsCamera {
  rotX: number;
  rotY: number;
  zoom: number;
}

export interface PolyControlsProps {
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

export const PolyControls = defineComponent({
  name: "PolyControls",
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
    /**
     * Fires whenever the controls mutate camera state — pointer drag,
     * wheel zoom, or autorotate tick. Mirrors Three.js OrbitControls'
     * `change` event. Autorotate fires this every frame; throttle, or
     * use `interaction-end` instead if you only need the final position.
     */
    change: (_camera: PolyControlsCamera) => true,
    /**
     * Fires on first user gesture of an interaction (pointerdown / first
     * wheel of a burst). Carries the camera at gesture start.
     */
    "interaction-start": (_camera: PolyControlsCamera) => true,
    /**
     * Fires when the gesture concludes (pointerup / wheel idle ~150 ms),
     * with the final camera. Use this instead of `change` to commit state
     * once per gesture (avoids per-frame Vue re-renders).
     */
    "interaction-end": (_camera: PolyControlsCamera) => true,
  },
  setup(props, { emit }) {
    const cameraSnapshot = (handle: { state: { rotX: number; rotY: number; zoom: number } }): PolyControlsCamera => ({
      rotX: handle.state.rotX,
      rotY: handle.state.rotY,
      zoom: handle.state.zoom,
    });
    const fireChange = (handle: { state: { rotX: number; rotY: number; zoom: number } }): void => {
      emit("change", cameraSnapshot(handle));
    };
    const fireStart = (handle: { state: { rotX: number; rotY: number; zoom: number } }): void => {
      emit("interaction-start", cameraSnapshot(handle));
    };
    const fireEnd = (handle: { state: { rotX: number; rotY: number; zoom: number } }): void => {
      emit("interaction-end", cameraSnapshot(handle));
    };

    const ctx = inject(PolyCameraContextKey, null);
    if (!ctx) {
      // Render-only behavior; warn but stay safe (no throw — the demo
      // tree may still render fine, controls just no-op).
      if (typeof console !== "undefined") {
        console.warn("[polycss] <PolyControls> must be used inside <PolyCamera>.");
      }
      return () => null;
    }
    const { store, cameraRef, cameraElRef, applyTransformDirect } = ctx;

    let activePointerId: number | null = null;
    let pointer = { x: 0, y: 0 };
    const animationPaused = ref(false);

    let detachDrag: (() => void) | null = null;
    let detachWheel: (() => void) | null = null;
    let stopAnim: (() => void) | null = null;

    function attachDrag(): void {
      const el = cameraElRef.value;
      if (!el) return;

      const onDown = (e: PointerEvent): void => {
        if (!props.drag) return;
        if (activePointerId !== null) return;
        if (e.isPrimary === false) return;
        e.preventDefault();
        activePointerId = e.pointerId;
        pointer = { x: e.clientX, y: e.clientY };
        el.style.cursor = "grabbing";
        try {
          (e.target as Element).setPointerCapture(e.pointerId);
        } catch { /* ignore */ }
        if (props.animate && (props.animate.pauseOnInteraction ?? true)) {
          animationPaused.value = true;
        }
        fireStart(cameraRef.value);
      };

      const onMove = (e: PointerEvent): void => {
        if (activePointerId === null || e.pointerId !== activePointerId) return;
        if (!props.drag) return;
        e.preventDefault();
        const f = invertFactor(props.invert);
        const dX = ((e.clientX - pointer.x) / POINTER_DRAG_SPEED) * f;
        const dY = ((e.clientY - pointer.y) / POINTER_DRAG_SPEED) * f;
        pointer = { x: e.clientX, y: e.clientY };
        const handle = cameraRef.value;
        const s = handle.state;
        // Drag should track the pointer — visible object follows the
        // user's mouse. Both axes subtract the delta from the camera.
        const rotX = Math.max(0, Math.min(100, s.rotX - dY));
        const rotY = (((s.rotY - dX) % 360) + 360) % 360;
        handle.update({ rotX, rotY });
        applyTransformDirect();
        store.updateCameraFromRef(handle);
        fireChange(handle);
      };

      const onUp = (e: PointerEvent): void => {
        if (activePointerId !== e.pointerId) return;
        activePointerId = null;
        el.style.cursor = props.drag ? "grab" : "";
        try {
          (e.target as Element).releasePointerCapture(e.pointerId);
        } catch { /* ignore */ }
        animationPaused.value = false;
        fireEnd(cameraRef.value);
      };

      el.style.cursor = "grab";
      el.style.touchAction = "none";
      el.style.userSelect = "none";
      el.addEventListener("pointerdown", onDown);
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
      el.addEventListener("pointercancel", onUp);

      detachDrag = (): void => {
        el.removeEventListener("pointerdown", onDown);
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
        el.removeEventListener("pointercancel", onUp);
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
          fireStart(handle);
        }
        fireChange(handle);
        if (wheelIdleTimer !== null) clearTimeout(wheelIdleTimer);
        wheelIdleTimer = setTimeout(() => {
          wheelIdleTimer = null;
          wheelActive = false;
          fireEnd(cameraRef.value);
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
          const speed = a.speed ?? DEFAULT_ANIMATE_SPEED;
          const delta = speed * (dt / ANIM_FRAME_MS);
          const handle = cameraRef.value;
          const s = handle.state;
          if (a.axis === "x") {
            const rotX = (((s.rotX + delta) % 360) + 360) % 360;
            handle.update({ rotX });
          } else {
            const rotY = (((s.rotY + delta) % 360) + 360) % 360;
            handle.update({ rotY });
          }
          applyTransformDirect();
          store.updateCameraFromRef(handle);
          fireChange(handle);
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

    // Live prop reactivity for the on/off toggles. The handler bodies
    // already read the latest prop values on each event, so we only need
    // to wire/unwire on the booleans.
    watch(
      () => props.drag,
      (next) => {
        if (next && !detachDrag) attachDrag();
        if (!next && detachDrag) {
          detachDrag();
          detachDrag = null;
        }
      },
    );
    watch(
      () => props.wheel,
      (next) => {
        if (next && !detachWheel) attachWheel();
        if (!next && detachWheel) {
          detachWheel();
          detachWheel = null;
        }
      },
    );
    watch(
      () => !!props.animate,
      (next) => {
        if (next && !stopAnim) startAnim();
        if (!next && stopAnim) {
          stopAnim();
        }
      },
    );

    return () => null;
  },
});
