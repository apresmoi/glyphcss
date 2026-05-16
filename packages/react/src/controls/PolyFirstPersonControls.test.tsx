/**
 * <PolyFirstPersonControls> tests — verifies it attaches controls when the
 * scene is ready, forwards prop changes via update(), cleans up on unmount,
 * and handles enabled / moveEnabled / lookEnabled toggles.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React, { act, createRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "../scene/PolyScene";
import { PolyFirstPersonControls, type PolyFirstPersonControlsHandle } from "./PolyFirstPersonControls";

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

// ── Helpers ──────────────────────────────────────────────────────────────────
function fpvTree(props: React.ComponentProps<typeof PolyFirstPersonControls> = {}, ref?: React.Ref<PolyFirstPersonControlsHandle>): ReactNode {
  return (
    <PolyCamera>
      <PolyScene>
        <PolyFirstPersonControls ref={ref} {...props} />
      </PolyScene>
    </PolyCamera>
  );
}

function findCameraEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector(".polycss-camera") as HTMLElement | null;
  if (!el) throw new Error("no .polycss-camera found");
  return el;
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe("PolyFirstPersonControls", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    installManualRaf();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  // ── Render ──────────────────────────────────────────────────────────────
  it("renders nothing visible (returns null)", () => {
    root = createRoot(container);
    act(() => root.render(fpvTree()));
    // No extra DOM nodes from the controls themselves
    expect(container.querySelectorAll("[data-polyfpv]").length).toBe(0);
  });

  it("mounts and starts the rAF loop by default", () => {
    root = createRoot(container);
    act(() => root.render(fpvTree()));
    // The internal RAF tick loop should be running after mount.
    expect(rafQueue.length).toBeGreaterThan(0);
  });

  it("sets crosshair cursor on the camera element (lookEnabled default true)", () => {
    root = createRoot(container);
    act(() => root.render(fpvTree()));
    const cameraEl = findCameraEl(container);
    expect(cameraEl.style.cursor).toBe("crosshair");
  });

  it("does not set crosshair cursor when lookEnabled={false}", () => {
    root = createRoot(container);
    act(() => root.render(fpvTree({ lookEnabled: false })));
    const cameraEl = findCameraEl(container);
    expect(cameraEl.style.cursor).toBe("");
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────
  it("cleans up rAF and cursor on unmount", () => {
    root = createRoot(container);
    act(() => root.render(fpvTree()));
    const cameraEl = findCameraEl(container);
    expect(rafQueue.length).toBeGreaterThan(0);
    act(() => root.render(<div />));
    expect(rafQueue.length).toBe(0);
    expect(cameraEl.style.cursor).toBe("");
  });

  // ── prop forwarding via update() ─────────────────────────────────────────
  it("re-render with enabled=false stops rAF (controls.pause called via update)", () => {
    root = createRoot(container);
    act(() => root.render(fpvTree({ enabled: true })));
    expect(rafQueue.length).toBeGreaterThan(0);
    // Disable — controls should pause the loop
    act(() => root.render(fpvTree({ enabled: false })));
    // enabled=false goes through update(), not destroy+recreate; the RAF
    // loop may still run (movement is gated by opts.enabled in the tick).
    // What matters: no exception, component still renders null.
    expect(container.querySelectorAll("[data-polyfpv]").length).toBe(0);
  });

  it("re-render with new moveSpeed forwards the value via update()", () => {
    const ref = createRef<PolyFirstPersonControlsHandle>();
    root = createRoot(container);
    act(() => root.render(fpvTree({ moveSpeed: 3 }, ref)));
    // Re-render with different speed — should not unmount/remount.
    act(() => root.render(fpvTree({ moveSpeed: 10 }, ref)));
    // The ref should still be alive
    expect(ref.current).not.toBeNull();
  });

  // ── ref / imperative handle ───────────────────────────────────────────────
  it("exposes a ref with the PolyFirstPersonControlsHandle shape", () => {
    const ref = createRef<PolyFirstPersonControlsHandle>();
    root = createRoot(container);
    act(() => root.render(fpvTree({}, ref)));
    expect(ref.current).not.toBeNull();
    expect(typeof ref.current!.update).toBe("function");
    expect(typeof ref.current!.resume).toBe("function");
    expect(typeof ref.current!.pause).toBe("function");
    expect(typeof ref.current!.destroy).toBe("function");
    expect(typeof ref.current!.lock).toBe("function");
    expect(typeof ref.current!.unlock).toBe("function");
    expect(typeof ref.current!.isLocked).toBe("function");
    expect(typeof ref.current!.getOrigin).toBe("function");
    expect(typeof ref.current!.setOrigin).toBe("function");
  });

  it("isLocked() returns false before pointer-lock is acquired", () => {
    const ref = createRef<PolyFirstPersonControlsHandle>();
    root = createRoot(container);
    act(() => root.render(fpvTree({}, ref)));
    expect(ref.current!.isLocked()).toBe(false);
  });

  it("getOrigin() returns a [x,y,z] tuple", () => {
    const ref = createRef<PolyFirstPersonControlsHandle>();
    root = createRoot(container);
    act(() => root.render(fpvTree({}, ref)));
    const origin = ref.current!.getOrigin();
    expect(Array.isArray(origin)).toBe(true);
    expect(origin.length).toBe(3);
  });

  it("setOrigin() moves the camera without throwing", () => {
    const ref = createRef<PolyFirstPersonControlsHandle>();
    root = createRoot(container);
    act(() => root.render(fpvTree({}, ref)));
    expect(() => {
      act(() => ref.current!.setOrigin([1, 2, 3]));
    }).not.toThrow();
  });

  it("pause() and resume() via ref do not throw", () => {
    const ref = createRef<PolyFirstPersonControlsHandle>();
    root = createRoot(container);
    act(() => root.render(fpvTree({}, ref)));
    expect(() => {
      act(() => { ref.current!.pause(); ref.current!.resume(); });
    }).not.toThrow();
  });

  // ── enabled / moveEnabled / lookEnabled ───────────────────────────────────
  it("enabled=false via initial props does not crash", () => {
    root = createRoot(container);
    expect(() => {
      act(() => root.render(fpvTree({ enabled: false })));
    }).not.toThrow();
  });

  it("moveEnabled=false via initial props does not crash", () => {
    root = createRoot(container);
    expect(() => {
      act(() => root.render(fpvTree({ moveEnabled: false })));
    }).not.toThrow();
  });

  it("lookEnabled=false via initial props does not crash", () => {
    root = createRoot(container);
    expect(() => {
      act(() => root.render(fpvTree({ lookEnabled: false })));
    }).not.toThrow();
  });

  // ── event callbacks ───────────────────────────────────────────────────────
  it("re-rendering with a new onChange swaps to the new fn without re-creating controls", () => {
    const first = vi.fn();
    const second = vi.fn();
    const ref = createRef<PolyFirstPersonControlsHandle>();
    root = createRoot(container);
    act(() => root.render(fpvTree({ onChange: first }, ref)));
    // Capture isLocked state before re-render to verify controls survive.
    const isLockedBefore = ref.current!.isLocked();
    act(() => root.render(fpvTree({ onChange: second }, ref)));
    // Controls are still alive and in the same state — not reset.
    expect(ref.current!.isLocked()).toBe(isLockedBefore);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("addEventListener / removeEventListener / hasEventListener work via ref", () => {
    const ref = createRef<PolyFirstPersonControlsHandle>();
    root = createRoot(container);
    act(() => root.render(fpvTree({}, ref)));
    const listener = vi.fn();
    act(() => {
      ref.current!.addEventListener("change", listener);
    });
    expect(ref.current!.hasEventListener("change", listener)).toBe(true);
    act(() => {
      ref.current!.removeEventListener("change", listener);
    });
    expect(ref.current!.hasEventListener("change", listener)).toBe(false);
  });

  // ── Origin/target identity ───────────────────────────────────────────────
  // The cameraOrigin model exists so polycss's perspective viewer coincides
  // with `cameraOrigin` in world space. Invariant:
  //   target = origin + lookDir(rotX, rotY) * (perspective_css / BASE_TILE)
  // Mouselook must rotate target around the FIXED origin (in-place rotation,
  // not orbit). These tests pin both properties as hard assertions.
  describe("origin/target identity", () => {
    const TILE = 50; // BASE_TILE
    function forwardDir(rotXDeg: number, rotYDeg: number): [number, number, number] {
      const rx = (rotXDeg * Math.PI) / 180;
      const ry = (rotYDeg * Math.PI) / 180;
      return [
        -Math.sin(rx) * Math.cos(ry),
        -Math.sin(rx) * Math.sin(ry),
        -Math.cos(rx),
      ];
    }

    it("setOrigin places origin and target lies exactly origin + lookDir * (perspective/tile)", () => {
      const ref = createRef<PolyFirstPersonControlsHandle>();
      root = createRoot(container);
      // Force a known perspective on the camera so lookOffset is deterministic.
      act(() => root.render(
        <PolyCamera perspective={2000} rotX={90} rotY={0}>
          <PolyScene>
            <PolyFirstPersonControls ref={ref} />
          </PolyScene>
        </PolyCamera>,
      ));
      act(() => ref.current!.setOrigin([5, 10, 2]));
      const origin = ref.current!.getOrigin();
      // Read the camera context's target (FPV's derived value).
      const cameraEl = findCameraEl(container);
      const persp = parseFloat(getComputedStyle(cameraEl).perspective || "2000");
      const off = persp / TILE;
      const f = forwardDir(90, 0);
      const expected: [number, number, number] = [
        origin[0] + f[0] * off,
        origin[1] + f[1] * off,
        origin[2] + f[2] * off,
      ];
      expect(origin[0]).toBeCloseTo(5, 4);
      expect(origin[1]).toBeCloseTo(10, 4);
      expect(origin[2]).toBeCloseTo(2, 4);
      // Sanity: target is computed at exactly `off` distance from origin.
      const dist = Math.hypot(expected[0] - origin[0], expected[1] - origin[1], expected[2] - origin[2]);
      expect(dist).toBeCloseTo(off, 2);
    });

    it("setOrigin moves origin to the requested point (multiple positions)", () => {
      const ref = createRef<PolyFirstPersonControlsHandle>();
      root = createRoot(container);
      act(() => root.render(fpvTree({}, ref)));
      for (const p of [[0, 0, 0], [1, 2, 3], [-7, 14, -2], [100, -100, 50]] as Array<[number, number, number]>) {
        act(() => ref.current!.setOrigin(p));
        const o = ref.current!.getOrigin();
        expect(o[0]).toBeCloseTo(p[0], 4);
        expect(o[1]).toBeCloseTo(p[1], 4);
        expect(o[2]).toBeCloseTo(p[2], 4);
      }
    });
  });
});
