/**
 * <PolyFirstPersonControls> (Vue) tests — mounts/unmounts the underlying
 * createPolyFirstPersonControls, forwards prop changes via update(), and
 * exposes getOrigin/setOrigin/lock/unlock via template ref.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createApp,
  defineComponent,
  h,
  inject,
  nextTick,
  ref,
  type App,
} from "vue";
import type { CameraHandle } from "@layoutit/polycss-core";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "../scene/PolyScene";
import { PolyCameraContextKey } from "../camera/context";
import { PolyFirstPersonControls } from "./PolyFirstPersonControls";
import type { PolyFirstPersonControlsHandle } from "./PolyFirstPersonControls";

// ── rAF shim ────────────────────────────────────────────────────────────────

let rafQueue: Array<(now: number) => void> = [];
let rafId = 0;

function installManualRaf(): void {
  rafQueue = [];
  rafId = 0;
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return ++rafId;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {
    rafQueue = [];
  });
}

function flushRaf(advanceMs = 16.67): void {
  const frames = rafQueue;
  rafQueue = [];
  for (const f of frames) f(advanceMs);
}

// ── Pointer-lock shim ────────────────────────────────────────────────────────

function shimPointerLock(): void {
  Object.defineProperty(document, "pointerLockElement", {
    writable: true,
    configurable: true,
    value: null,
  });
  HTMLElement.prototype.requestPointerLock = function (this: HTMLElement) {
    (document as unknown as Record<string, unknown>).pointerLockElement = this;
    document.dispatchEvent(new Event("pointerlockchange"));
  };
  document.exitPointerLock = function () {
    (document as unknown as Record<string, unknown>).pointerLockElement = null;
    document.dispatchEvent(new Event("pointerlockchange"));
  };
}

// ── Mount helper ─────────────────────────────────────────────────────────────

interface MountResult {
  container: HTMLElement;
  app: App;
  cameraRef: { value: CameraHandle };
  fpvRef: { value: PolyFirstPersonControlsHandle | null };
  findCameraEl(): HTMLElement;
}

function mount(
  fpvProps: Record<string, unknown> = {},
  cameraProps: Record<string, unknown> = {},
): MountResult {
  const container = document.createElement("div");
  document.body.appendChild(container);

  let captured: { value: CameraHandle } | null = null;
  const fpvRef = ref<PolyFirstPersonControlsHandle | null>(null);

  const ContextProbe = defineComponent({
    setup() {
      const ctx = inject(PolyCameraContextKey);
      if (ctx) captured = ctx.cameraRef;
      return () => null;
    },
  });

  const app = createApp({
    setup() {
      return () =>
        h(PolyCamera, cameraProps, {
          default: () =>
            h(PolyScene, {}, {
              default: () => [
                h(PolyFirstPersonControls, { ...fpvProps, ref: fpvRef }),
                h(ContextProbe),
              ],
            }),
        });
    },
  });

  app.mount(container);

  if (!captured) throw new Error("ContextProbe never captured camera context");

  return {
    container,
    app,
    cameraRef: captured,
    fpvRef: fpvRef as unknown as { value: PolyFirstPersonControlsHandle | null },
    findCameraEl() {
      const el = container.querySelector(".polycss-camera") as HTMLElement | null;
      if (!el) throw new Error("no .polycss-camera found");
      return el;
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("PolyFirstPersonControls (Vue)", () => {
  let mounted: MountResult | null = null;

  beforeEach(() => {
    installManualRaf();
    shimPointerLock();
  });

  afterEach(() => {
    if (mounted) {
      mounted.app.unmount();
      mounted.container.remove();
      mounted = null;
    }
    vi.restoreAllMocks();
  });

  // ── Mounting ────────────────────────────────────────────────────────────

  it("renders nothing visible (returns null)", () => {
    mounted = mount();
    expect(mounted.container.querySelectorAll("[data-polyfpv]").length).toBe(0);
  });

  it("starts the rAF tick loop on mount", () => {
    mounted = mount();
    // FPV controls use requestAnimationFrame for WASD/jump/gravity.
    expect(rafQueue.length).toBeGreaterThan(0);
  });

  it("sets crosshair cursor on the camera element when lookEnabled=true", () => {
    mounted = mount({ lookEnabled: true });
    const cameraEl = mounted.findCameraEl();
    expect(cameraEl.style.cursor).toBe("crosshair");
  });

  it("does not set crosshair cursor when lookEnabled=false", () => {
    mounted = mount({ lookEnabled: false });
    const cameraEl = mounted.findCameraEl();
    expect(cameraEl.style.cursor).toBe("");
  });

  // ── Cleanup ──────────────────────────────────────────────────────────────

  it("cancels the rAF loop and clears cursor on unmount", () => {
    mounted = mount();
    const cameraEl = mounted.findCameraEl();
    expect(rafQueue.length).toBeGreaterThan(0);
    mounted.app.unmount();
    expect(rafQueue.length).toBe(0);
    expect(cameraEl.style.cursor).toBe("");
    mounted.container.remove();
    mounted = null;
  });

  // ── Prop forwarding via update() ─────────────────────────────────────────

  it("flipping lookEnabled false→true changes cursor to crosshair", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const lookEnabled = ref(false);
    const app = createApp({
      setup() {
        return () =>
          h(PolyCamera, {}, {
            default: () =>
              h(PolyScene, {}, {
                default: () =>
                  h(PolyFirstPersonControls, { lookEnabled: lookEnabled.value }),
              }),
          });
      },
    });
    app.mount(container);
    const cameraEl = container.querySelector(".polycss-camera") as HTMLElement;
    expect(cameraEl.style.cursor).toBe("");

    lookEnabled.value = true;
    await nextTick();
    expect(cameraEl.style.cursor).toBe("crosshair");

    app.unmount();
    container.remove();
  });

  it("flipping lookEnabled true→false clears cursor", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const lookEnabled = ref(true);
    const app = createApp({
      setup() {
        return () =>
          h(PolyCamera, {}, {
            default: () =>
              h(PolyScene, {}, {
                default: () =>
                  h(PolyFirstPersonControls, { lookEnabled: lookEnabled.value }),
              }),
          });
      },
    });
    app.mount(container);
    const cameraEl = container.querySelector(".polycss-camera") as HTMLElement;
    expect(cameraEl.style.cursor).toBe("crosshair");

    lookEnabled.value = false;
    await nextTick();
    expect(cameraEl.style.cursor).toBe("");

    app.unmount();
    container.remove();
  });

  it("enabled=false still shows crosshair cursor (lookEnabled controls the cursor, not enabled)", () => {
    mounted = mount({ enabled: false });
    const cameraEl = mounted.findCameraEl();
    // Cursor is driven by lookEnabled (default true), not by the master enabled flag.
    // The vanilla controls behave the same way.
    expect(cameraEl.style.cursor).toBe("crosshair");
  });

  // ── exposed getOrigin / setOrigin ────────────────────────────────────────

  it("exposes getOrigin() returning a [x,y,z] tuple", () => {
    mounted = mount({ groundZ: 0, eyeHeight: 1.7 });
    const origin = mounted.fpvRef.value?.getOrigin();
    expect(Array.isArray(origin)).toBe(true);
    expect(origin?.length).toBe(3);
    // Initial Z = groundZ + eyeHeight = 1.7
    expect(origin?.[2]).toBeCloseTo(1.7, 4);
  });

  it("setOrigin() teleports the camera and re-derives scene target", () => {
    mounted = mount({});
    mounted.fpvRef.value?.setOrigin([10, 20, 5]);
    const origin = mounted.fpvRef.value?.getOrigin();
    expect(origin?.[0]).toBeCloseTo(10, 4);
    expect(origin?.[1]).toBeCloseTo(20, 4);
    expect(origin?.[2]).toBeCloseTo(5, 4);
    // Target must differ from origin (offset along look direction).
    const target = mounted.cameraRef.value.state.target;
    expect(
      target[0] !== 10 || target[1] !== 20 || target[2] !== 5,
    ).toBe(true);
  });

  // ── exposed lock / unlock / isLocked ────────────────────────────────────

  it("isLocked() returns false before any lock call", () => {
    mounted = mount();
    expect(mounted.fpvRef.value?.isLocked()).toBe(false);
  });

  it("lock() acquires pointer lock and isLocked() returns true", () => {
    mounted = mount({ enabled: true, lookEnabled: true });
    const cameraEl = mounted.findCameraEl();
    cameraEl.click(); // user gesture shim
    expect(document.pointerLockElement).toBe(cameraEl);
    expect(mounted.fpvRef.value?.isLocked()).toBe(true);
  });

  it("unlock() releases pointer lock", () => {
    mounted = mount({ enabled: true, lookEnabled: true });
    const cameraEl = mounted.findCameraEl();
    cameraEl.click();
    expect(mounted.fpvRef.value?.isLocked()).toBe(true);
    mounted.fpvRef.value?.unlock();
    expect(mounted.fpvRef.value?.isLocked()).toBe(false);
  });

  // ── WASD tick moves target ────────────────────────────────────────────────

  it("WASD tick with moveEnabled=true updates the camera target", () => {
    mounted = mount({ moveEnabled: true });
    const targetBefore = [...mounted.cameraRef.value.state.target];

    // Simulate W key held
    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }),
    );
    flushRaf(100); // 100 ms of movement

    window.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyW", bubbles: true }),
    );

    const targetAfter = mounted.cameraRef.value.state.target;
    const moved =
      Math.abs(targetAfter[0] - targetBefore[0]) > 0.001 ||
      Math.abs(targetAfter[1] - targetBefore[1]) > 0.001;
    expect(moved).toBe(true);
  });

  it("WASD tick with moveEnabled=false does not move the target", () => {
    mounted = mount({ moveEnabled: false });
    const targetBefore = [...mounted.cameraRef.value.state.target];

    window.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }),
    );
    flushRaf(100);
    window.dispatchEvent(
      new KeyboardEvent("keyup", { code: "KeyW", bubbles: true }),
    );

    const targetAfter = mounted.cameraRef.value.state.target;
    expect(targetAfter[0]).toBeCloseTo(targetBefore[0], 4);
    expect(targetAfter[1]).toBeCloseTo(targetBefore[1], 4);
  });

  // ── warn without PolyCamera ───────────────────────────────────────────────

  it("warns and no-ops when used outside <PolyCamera>", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const app = createApp({
      setup() {
        return () => h(PolyFirstPersonControls);
      },
    });
    app.mount(container);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("PolyFirstPersonControls"),
    );
    // No rAF started
    expect(rafQueue.length).toBe(0);
    app.unmount();
    container.remove();
  });

  // ── interaction events ────────────────────────────────────────────────────

  it("emits interaction-start / interaction-end on pointer-lock acquire / release", () => {
    const onInteractionStart = vi.fn();
    const onInteractionEnd = vi.fn();
    mounted = mount({
      onInteractionStart,
      onInteractionEnd,
      enabled: true,
      lookEnabled: true,
    });
    const cameraEl = mounted.findCameraEl();

    cameraEl.click(); // acquire lock → start
    expect(onInteractionStart).toHaveBeenCalledTimes(1);

    mounted.fpvRef.value?.unlock(); // release → end
    expect(onInteractionEnd).toHaveBeenCalledTimes(1);

    const [origin] = onInteractionStart.mock.calls[0] as [[number, number, number]];
    expect(Array.isArray(origin)).toBe(true);
    expect(origin.length).toBe(3);
  });

  // ── Origin/target identity ───────────────────────────────────────────────
  // The cameraOrigin model exists so polycss's perspective viewer coincides
  // with `cameraOrigin` in world space. Invariant:
  //   target = origin + lookDir(rotX, rotY) * (perspective_css / BASE_TILE)
  // Mouselook must rotate target around the FIXED origin. These pin both
  // properties as hard assertions.
  describe("origin/target identity", () => {
    const TILE = 50;
    function forwardDir(rotXDeg: number, rotYDeg: number): [number, number, number] {
      const rx = (rotXDeg * Math.PI) / 180;
      const ry = (rotYDeg * Math.PI) / 180;
      return [
        -Math.sin(rx) * Math.cos(ry),
        -Math.sin(rx) * Math.sin(ry),
        -Math.cos(rx),
      ];
    }

    it("target = origin + lookDir * (perspective/tile) after setOrigin", () => {
      mounted = mount({}, { perspective: 2000, rotX: 90, rotY: 0 });
      mounted.fpvRef.value?.setOrigin([5, 10, 2]);
      const origin = mounted.fpvRef.value?.getOrigin() ?? [0, 0, 0];
      const target = mounted.cameraRef.value.state.target;
      const persp = parseFloat(getComputedStyle(mounted.findCameraEl()).perspective || "2000");
      const off = persp / TILE;
      const f = forwardDir(90, 0);
      expect(target[0]).toBeCloseTo(origin[0] + f[0] * off, 2);
      expect(target[1]).toBeCloseTo(origin[1] + f[1] * off, 2);
      expect(target[2]).toBeCloseTo(origin[2] + f[2] * off, 2);
    });

    it("|target - origin| equals perspective/tile across perspective values", () => {
      for (const persp of [500, 2000, 16000]) {
        if (mounted) {
          mounted.app.unmount();
          mounted.container.remove();
          mounted = null;
        }
        mounted = mount({}, { perspective: persp, rotX: 90, rotY: 0 });
        mounted.fpvRef.value?.setOrigin([0, 0, 0]);
        const origin = mounted.fpvRef.value?.getOrigin() ?? [0, 0, 0];
        const target = mounted.cameraRef.value.state.target;
        const dist = Math.hypot(
          target[0] - origin[0],
          target[1] - origin[1],
          target[2] - origin[2],
        );
        // The host's CSS perspective drives lookOffset. In jsdom-style tests
        // without the gallery's `--fpv-perspective` CSS var, the camera
        // element's computed perspective is whatever PolyCamera sets it to.
        const got = parseFloat(getComputedStyle(mounted.findCameraEl()).perspective || `${persp}`);
        expect(dist).toBeCloseTo(got / TILE, 1);
      }
    });
  });
});
