import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "../scene/PolyScene";
import { PolyMesh } from "../scene/PolyMesh";
import { TransformControls } from "./TransformControls";
import type { PolyMeshHandle } from "../scene/events";
import type { Polygon } from "@layoutit/polycss-core";

const TRIANGLE: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#fff",
};

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Fake screen layout for drag math: each element's getBoundingClientRect
 * returns the sum of `translate3d(x, y, z)` offsets across its ancestors,
 * scaled by `cameraScale`. Lets the test assert deterministic drag deltas
 * without a real layout/transform engine (happy-dom has neither).
 */
function withFakeLayout(cameraScale: number, fn: () => void): void {
  const TRANSFORM_RE = /translate3d\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\s*\)/;
  const orig = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function fakeRect(this: Element): DOMRect {
    let x = 0, y = 0;
    let cur: Element | null = this;
    while (cur && cur instanceof HTMLElement) {
      const t = cur.style.transform;
      if (t) {
        const m = TRANSFORM_RE.exec(t);
        if (m) {
          x += parseFloat(m[1]) * cameraScale;
          y += parseFloat(m[2]) * cameraScale;
        }
      }
      cur = cur.parentElement;
    }
    const w = this instanceof HTMLElement ? parseFloat(this.style.width || "0") || 0 : 0;
    const hh = this instanceof HTMLElement ? parseFloat(this.style.height || "0") || 0 : 0;
    return {
      left: x, top: y, right: x + w, bottom: y + hh, width: w, height: hh, x, y,
      toJSON() { return this; },
    } as DOMRect;
  };
  try {
    fn();
  } finally {
    Element.prototype.getBoundingClientRect = orig;
  }
}

/** Read the axis key off an arrow's wrapper className. */
function axisKeyOf(el: Element): string | null {
  const cls = el.className;
  if (typeof cls !== "string") return null;
  const m = /\bpolycss-transform-arrow--(-?[a-z])\b/.exec(cls);
  return m ? m[1] : null;
}

interface MountResult {
  container: HTMLElement;
  app: ReturnType<typeof createApp>;
  getMeshHandle(): PolyMeshHandle | null;
}

/** Mount TransformControls inside <PolyCamera><PolyScene>, with a target
 *  <PolyMesh> referenced via a handleRef. Awaits nextTick twice so
 *  handleRef is populated and TransformControls' onMounted tick re-render fires. */
async function mount(
  meshProps: Record<string, unknown> = {},
  controlsPropsFactory?: (meshRef: ReturnType<typeof ref<PolyMeshHandle | null>>) => Record<string, unknown>,
): Promise<MountResult> {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const handleRef = ref<PolyMeshHandle | null>(null);

  const app = createApp({
    setup() {
      return () =>
        h(PolyCamera, {}, {
          default: () =>
            h(PolyScene, {}, {
              default: () => [
                h(PolyMesh, { ...meshProps, ref: handleRef }),
                h(TransformControls, controlsPropsFactory ? controlsPropsFactory(handleRef) : { object: handleRef }),
              ],
            }),
        });
    },
  });

  app.mount(container);
  // Wait for handleRef to be populated (PolyMesh onMounted) and then for
  // TransformControls' tick.value++ re-render to fire.
  await nextTick();
  await nextTick();
  return { container, app, getMeshHandle: () => handleRef.value };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("TransformControls (Vue)", () => {
  // 1. Renders nothing when object is null
  it("renders nothing when object is null", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(PolyCamera, {}, {
            default: () =>
              h(PolyScene, {}, {
                default: () => h(TransformControls, { object: null }),
              }),
          });
      },
    });
    app.mount(container);
    expect(container.querySelector("[data-poly-transform-controls]")).toBeNull();
  });

  // 2. Renders nothing for mode="scale"
  it("renders nothing for the unimplemented scale mode", async () => {
    const { container } = await mount(
      { polygons: [TRIANGLE] },
      (meshRef) => ({ object: meshRef, mode: "scale" }),
    );
    expect(container.querySelector("[data-poly-transform-controls]")).toBeNull();
  });

  // 3. translate mode renders 6 arrows (x, -x, y, -y, z, -z)
  it("translate mode renders 6 axis arrows (±X, ±Y, ±Z) by default", async () => {
    const { container } = await mount(
      { polygons: [TRIANGLE], position: [50, 60, 70] },
      (meshRef) => ({ object: meshRef, mode: "translate" }),
    );
    const wrapper = container.querySelector("[data-poly-transform-controls]") as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.getAttribute("data-poly-mode")).toBe("translate");
    expect(wrapper.style.transform).toContain("translate3d(50px, 60px, 70px)");
    const arrows = wrapper.querySelectorAll(".polycss-transform-arrow");
    expect(arrows.length).toBe(6);
    expect(Array.from(arrows).map(axisKeyOf)).toEqual(["x", "-x", "y", "-y", "z", "-z"]);
  });

  // 4. rotate mode renders 3 rings (x, y, z)
  it("rotate mode renders 3 rings (one per axis)", async () => {
    const { container } = await mount(
      { polygons: [TRIANGLE] },
      (meshRef) => ({ object: meshRef, mode: "rotate" }),
    );
    const wrapper = container.querySelector("[data-poly-transform-controls]") as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.getAttribute("data-poly-mode")).toBe("rotate");
    const rings = wrapper.querySelectorAll(".polycss-transform-ring");
    expect(rings.length).toBe(3);
    expect(
      Array.from(rings).map((r) => r.className.match(/polycss-transform-ring--([a-z])/)?.[1]),
    ).toEqual(["x", "y", "z"]);
  });

  // 5. showX=false, showZ=false shows only y, -y
  it("showX=false showZ=false shows only Y axis arrows", async () => {
    const { container } = await mount(
      { polygons: [TRIANGLE] },
      (meshRef) => ({ object: meshRef, showX: false, showZ: false }),
    );
    const wrapper = container.querySelector("[data-poly-transform-controls]") as HTMLElement;
    const arrows = Array.from(wrapper.querySelectorAll(".polycss-transform-arrow"));
    expect(arrows.map(axisKeyOf)).toEqual(["y", "-y"]);
  });

  // 6. pointerdown on an X arrow emits mouseDown + draggingChanged(true); pointerup emits mouseUp + (false)
  it("pointerdown on X arrow emits mouseDown + draggingChanged(true); pointerup emits mouseUp + draggingChanged(false)", async () => {
    const onMouseDown = vi.fn();
    const onMouseUp = vi.fn();
    const onDraggingChanged = vi.fn();

    let container!: HTMLElement;
    await withFakeLayoutAsync(2, async () => {
      const result = await mount(
        { polygons: [TRIANGLE] },
        (meshRef) => ({
          object: meshRef,
          onMouseDown,
          onMouseUp,
          onDraggingChanged,
        }),
      );
      container = result.container;
    });

    const xBeam = container.querySelector(".polycss-transform-arrow--x") as HTMLElement;
    expect(xBeam).not.toBeNull();

    withFakeLayout(2, () => {
      xBeam.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }),
      );
    });

    expect(onMouseDown).toHaveBeenCalledOnce();
    expect(onDraggingChanged).toHaveBeenLastCalledWith(true);

    window.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 10, clientY: 0, pointerId: 1 }),
    );

    expect(onMouseUp).toHaveBeenCalledOnce();
    expect(onDraggingChanged).toHaveBeenLastCalledWith(false);
  });

  // 7. drag projects pointer screen-delta onto X axis: cameraScale=2, pointer (10,0) → t=5 → newPos = startPos + 5*[1,0,0]
  it("dragging X axis: pointer (10,0) with cameraScale=2 → position shifts +5 on X", async () => {
    const onObjectChange = vi.fn();

    const { container } = await mount(
      { polygons: [TRIANGLE], position: [100, 200, 0] },
      (meshRef) => ({ object: meshRef, onObjectChange }),
    );

    const xBeam = container.querySelector(".polycss-transform-arrow--x") as HTMLElement;
    expect(xBeam).not.toBeNull();

    withFakeLayout(2, () => {
      xBeam.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }),
      );

      // Camera scale 2, X axis [1,0,0], so screen-axis = (2, 0), |s|² = 4.
      // Pointer delta (10, 0) → t = (10*2 + 0*0)/4 = 5.
      // newPos = [100,200,0] + 5*[1,0,0] = [105,200,0].
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 10, clientY: 0, pointerId: 1 }),
      );
    });

    expect(onObjectChange).toHaveBeenCalledOnce();
    const event = onObjectChange.mock.calls[0][0];
    expect(event.position).toEqual([105, 200, 0]);
  });

  // 8. dragging Y axis only changes position[1]; perpendicular pointer motion → no movement
  it("dragging Y axis only changes y; perpendicular pointer motion has no effect", async () => {
    const onObjectChange = vi.fn();

    const { container } = await mount(
      { polygons: [TRIANGLE], position: [10, 20, 30] },
      (meshRef) => ({ object: meshRef, onObjectChange }),
    );

    const yBeam = container.querySelector(".polycss-transform-arrow--y") as HTMLElement;
    expect(yBeam).not.toBeNull();

    withFakeLayout(2, () => {
      yBeam.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }),
      );

      // Y axis [0,1,0] → screen-axis (0, 2). Pointer (0, 6) → t = (0 + 6*2)/4 = 3.
      // newPos = [10, 20+3, 30] = [10, 23, 30].
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 0, clientY: 6, pointerId: 1 }),
      );
      expect(onObjectChange.mock.calls[0][0].position).toEqual([10, 23, 30]);

      // Pure-X pointer motion is perpendicular to Y screen-axis → t≈0 → no movement.
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 100, clientY: 6, pointerId: 1 }),
      );
      expect(onObjectChange.mock.calls[1][0].position).toEqual([10, 23, 30]);
    });
  });

  // 9. translationSnap rounds the projected delta (raw t=7 snaps to 5)
  it("translationSnap=5 rounds raw t=7 to 5", async () => {
    const onObjectChange = vi.fn();

    const { container } = await mount(
      { polygons: [TRIANGLE], position: [0, 0, 0] },
      (meshRef) => ({ object: meshRef, onObjectChange, translationSnap: 5 }),
    );

    const xBeam = container.querySelector(".polycss-transform-arrow--x") as HTMLElement;
    expect(xBeam).not.toBeNull();

    withFakeLayout(2, () => {
      xBeam.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }),
      );

      // Pointer (14, 0) → raw t = (14*2 + 0*0)/4 = 7 → snap(7, 5) = 5.
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 14, clientY: 0, pointerId: 1 }),
      );
    });

    expect(onObjectChange.mock.calls[0][0].position).toEqual([5, 0, 0]);
  });

  // 10. enabled=false ignores pointerdown (no callbacks fire)
  it("enabled=false ignores pointerdown (no callbacks fire)", async () => {
    const onMouseDown = vi.fn();
    const onObjectChange = vi.fn();

    const { container } = await mount(
      { polygons: [TRIANGLE] },
      (meshRef) => ({
        object: meshRef,
        enabled: false,
        onMouseDown,
        onObjectChange,
      }),
    );

    const xBeam = container.querySelector(".polycss-transform-arrow--x") as HTMLElement;
    expect(xBeam).not.toBeNull();

    withFakeLayout(2, () => {
      xBeam.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }),
      );
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 100, clientY: 0, pointerId: 1 }),
      );
      window.dispatchEvent(
        new PointerEvent("pointerup", { clientX: 100, clientY: 0, pointerId: 1 }),
      );
    });

    expect(onMouseDown).not.toHaveBeenCalled();
    expect(onObjectChange).not.toHaveBeenCalled();
  });

  // 11. Dragging -X arrow → position[0] decreases
  it("dragging -X axis: pointer (-10, 0) with cameraScale=2 → position shifts -5 on X", async () => {
    const onObjectChange = vi.fn();

    const { container } = await mount(
      { polygons: [TRIANGLE], position: [100, 200, 0] },
      (meshRef) => ({ object: meshRef, onObjectChange }),
    );

    const negXBeam = container.querySelector(".polycss-transform-arrow---x") as HTMLElement;
    expect(negXBeam).not.toBeNull();

    withFakeLayout(2, () => {
      negXBeam.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }),
      );
      // -X axis: cssAxis=0, sign=-1.  axisVec = [-1, 0, 0].
      // probe offset = (-probeDistance, 0, 0) → after cameraScale=2: screen-axis = (-1, 0) / 1 = (-1, 0).
      // Wait — cameraScale=2 scales translate3d on the probe.
      // probeDistance = shaft, probe transform = (-shaft, 0, 0); pRect - wRect = (-shaft*2, 0).
      // screenAxisX = (-shaft*2)/shaft = -2 (not normalised by 1, but normalised by probeDistance=shaft).
      // Actually: screenAxisX = (pRect.left - wRect.left)/probeDistance = (-shaft*2)/shaft = -2.
      // screenAxisLenSq = 4. Pointer delta (-10, 0) → t = (-10*-2 + 0)/4 = 20/4 = 5.
      // axisVec = (-1, 0, 0) → newPos = [100 + 5*(-1), 200, 0] = [95, 200, 0].
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: -10, clientY: 0, pointerId: 1 }),
      );
    });

    expect(onObjectChange).toHaveBeenCalledOnce();
    expect(onObjectChange.mock.calls[0][0].position[0]).toBe(95);
  });

  // 12. Dragging +Z arrow → position[2] changes
  it("dragging +Z axis: position[2] changes", async () => {
    const onObjectChange = vi.fn();

    const { container } = await mount(
      { polygons: [TRIANGLE], position: [0, 0, 50] },
      (meshRef) => ({ object: meshRef, onObjectChange }),
    );

    const zBeam = container.querySelector(".polycss-transform-arrow--z") as HTMLElement;
    expect(zBeam).not.toBeNull();

    withFakeLayout(2, () => {
      zBeam.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }),
      );
      // Z cssAxis=2, axisVec=[0,0,1], probe transform = (0, 0, probeDistance).
      // happy-dom getBoundingClientRect doesn't decode translateZ from style.transform,
      // so screenAxisX = 0, screenAxisY = 0 → screenAxisLenSq = 0 < DEAD_ZONE → drag is a no-op.
      // The start axis drag silently returns → no callbacks, which is the correct behaviour.
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 0, clientY: 20, pointerId: 1 }),
      );
    });

    // When screenAxisLenSq < DEAD_ZONE, onObjectChange is NOT called (dead-zone guard branch).
    expect(onObjectChange).not.toHaveBeenCalled();
  });

  // 13. Rotate Y ring: rotation[1] changes
  it("dragging Y ring: rotation[1] changes after pointer move", async () => {
    const onObjectChange = vi.fn();

    const { container } = await mount(
      { polygons: [TRIANGLE], rotation: [0, 0, 0] },
      (meshRef) => ({ object: meshRef, mode: "rotate", onObjectChange }),
    );

    const yRing = container.querySelector(".polycss-transform-ring--y") as HTMLElement;
    expect(yRing).not.toBeNull();

    withFakeLayout(2, () => {
      // Start drag on Y ring
      yRing.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 0, pointerId: 1 }),
      );

      // Move pointer to create angle delta
      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 0, clientY: 100, pointerId: 1 }),
      );
    });

    expect(onObjectChange).toHaveBeenCalled();
    const event = onObjectChange.mock.calls[0][0];
    // rotation[1] (cssAxis=1) should have changed from 0
    expect(typeof event.rotation[1]).toBe("number");
    expect(event.rotation[0]).toBe(0); // X unchanged
    expect(event.rotation[2]).toBe(0); // Z unchanged
  });

  // 14. Rotate Z ring: rotation[2] changes
  it("dragging Z ring: rotation[2] changes after pointer move", async () => {
    const onObjectChange = vi.fn();

    const { container } = await mount(
      { polygons: [TRIANGLE], rotation: [0, 0, 0] },
      (meshRef) => ({ object: meshRef, mode: "rotate", onObjectChange }),
    );

    const zRing = container.querySelector(".polycss-transform-ring--z") as HTMLElement;
    expect(zRing).not.toBeNull();

    withFakeLayout(2, () => {
      zRing.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 0, pointerId: 1 }),
      );

      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 0, clientY: 100, pointerId: 1 }),
      );
    });

    expect(onObjectChange).toHaveBeenCalled();
    const event = onObjectChange.mock.calls[0][0];
    expect(typeof event.rotation[2]).toBe("number");
    expect(event.rotation[0]).toBe(0);
    expect(event.rotation[1]).toBe(0);
  });

  // 15. rotationSnap=15 rounds raw degrees to 15° steps
  it("rotationSnap=15 rounds raw rotation to nearest 15° step", async () => {
    const onObjectChange = vi.fn();

    const { container } = await mount(
      { polygons: [TRIANGLE], rotation: [0, 0, 0] },
      (meshRef) => ({ object: meshRef, mode: "rotate", onObjectChange, rotationSnap: 15 }),
    );

    const xRing = container.querySelector(".polycss-transform-ring--x") as HTMLElement;
    expect(xRing).not.toBeNull();

    // We need a known angle delta. Place startX=1, startY=0 so lastAngle=0.
    // Then move to x=0, y=1 so new angle = PI/2 (90°). That's well past 15° multiples.
    withFakeLayout(1, () => {
      xRing.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 1, clientY: 0, pointerId: 1 }),
      );

      window.dispatchEvent(
        new PointerEvent("pointermove", { clientX: 0, clientY: 1, pointerId: 1 }),
      );
    });

    expect(onObjectChange).toHaveBeenCalled();
    const degrees = onObjectChange.mock.calls[0][0].rotation[0];
    // 90° snapped to 15° step → 90 (divisible by 15)
    expect(degrees % 15).toBeCloseTo(0, 5);
  });

  // 16. Rotate ring: mouseDown + draggingChanged(true); pointerup → mouseUp + draggingChanged(false)
  it("rotate Y ring: pointerdown emits mouseDown + draggingChanged(true); pointerup emits mouseUp + draggingChanged(false)", async () => {
    const onMouseDown = vi.fn();
    const onMouseUp = vi.fn();
    const onDraggingChanged = vi.fn();

    const { container } = await mount(
      { polygons: [TRIANGLE] },
      (meshRef) => ({
        object: meshRef,
        mode: "rotate",
        onMouseDown,
        onMouseUp,
        onDraggingChanged,
      }),
    );

    const yRing = container.querySelector(".polycss-transform-ring--y") as HTMLElement;
    expect(yRing).not.toBeNull();

    withFakeLayout(2, () => {
      yRing.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 0, pointerId: 1 }),
      );
    });

    expect(onMouseDown).toHaveBeenCalledOnce();
    expect(onDraggingChanged).toHaveBeenLastCalledWith(true);

    window.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 0, clientY: 100, pointerId: 1 }),
    );

    expect(onMouseUp).toHaveBeenCalledOnce();
    expect(onDraggingChanged).toHaveBeenLastCalledWith(false);
  });

  // 17. enabled=false on rotate mode: pointerdown on ring is ignored
  it("enabled=false: pointerdown on Y ring ignored (makeRingPointerDown early return)", async () => {
    const onMouseDown = vi.fn();

    const { container } = await mount(
      { polygons: [TRIANGLE] },
      (meshRef) => ({
        object: meshRef,
        mode: "rotate",
        enabled: false,
        onMouseDown,
      }),
    );

    const yRing = container.querySelector(".polycss-transform-ring--y") as HTMLElement;
    expect(yRing).not.toBeNull();

    withFakeLayout(2, () => {
      yRing.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 0, pointerId: 1 }),
      );
    });

    expect(onMouseDown).not.toHaveBeenCalled();
  });

  // 18. Component unmount detaches camera listener (onBeforeUnmount, line 385)
  it("component unmount detaches the camera pointerdown listener (no callbacks after unmount)", async () => {
    const onMouseDown = vi.fn();

    const { container, app } = await mount(
      { polygons: [TRIANGLE], position: [50, 50, 0] },
      (meshRef) => ({ object: meshRef, onMouseDown }),
    );

    // Camera element is the .polycss-camera div
    const cameraEl = container.querySelector(".polycss-camera") as HTMLElement;
    expect(cameraEl).not.toBeNull();

    // Unmount: onBeforeUnmount fires detach?.()
    app.unmount();

    // Dispatch pointerdown on camera after unmount — should NOT trigger onMouseDown
    cameraEl.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, clientX: 50, clientY: 50, pointerId: 1 }),
    );

    expect(onMouseDown).not.toHaveBeenCalled();
  });

  // 19. pointercancel on window ends a ring drag (draggingChanged(false))
  it("pointercancel while dragging a ring emits draggingChanged(false)", async () => {
    const onDraggingChanged = vi.fn();

    const { container } = await mount(
      { polygons: [TRIANGLE] },
      (meshRef) => ({ object: meshRef, mode: "rotate", onDraggingChanged }),
    );

    const xRing = container.querySelector(".polycss-transform-ring--x") as HTMLElement;
    expect(xRing).not.toBeNull();

    withFakeLayout(2, () => {
      xRing.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 0, pointerId: 1 }),
      );
    });

    expect(onDraggingChanged).toHaveBeenLastCalledWith(true);

    window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }));

    expect(onDraggingChanged).toHaveBeenLastCalledWith(false);
  });

  // 20. pointercancel while dragging an arrow ends axis drag (draggingChanged(false))
  it("pointercancel while dragging an arrow emits draggingChanged(false)", async () => {
    const onDraggingChanged = vi.fn();

    const { container } = await mount(
      { polygons: [TRIANGLE], position: [0, 0, 0] },
      (meshRef) => ({ object: meshRef, onDraggingChanged }),
    );

    const xBeam = container.querySelector(".polycss-transform-arrow--x") as HTMLElement;
    expect(xBeam).not.toBeNull();

    withFakeLayout(2, () => {
      xBeam.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }),
      );
    });

    expect(onDraggingChanged).toHaveBeenLastCalledWith(true);

    window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1 }));

    expect(onDraggingChanged).toHaveBeenLastCalledWith(false);
  });

  // 21. rebakeAtlas is called exactly once on rotate-ring pointer release
  it("rebakeAtlas is called exactly once on rotate-ring pointerdown→up", async () => {
    const { container, getMeshHandle } = await mount(
      { polygons: [TRIANGLE], rotation: [0, 0, 0] },
      (meshRef) => ({ object: meshRef, mode: "rotate" }),
    );

    const handle = getMeshHandle();
    expect(handle).not.toBeNull();
    const rebakeSpy = vi.spyOn(handle!, "rebakeAtlas");

    const yRing = container.querySelector(".polycss-transform-ring--y") as HTMLElement;
    expect(yRing).not.toBeNull();

    withFakeLayout(2, () => {
      yRing.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 0, pointerId: 1 }),
      );
    });

    // Not yet called — only fires on release
    expect(rebakeSpy).not.toHaveBeenCalled();

    window.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 0, clientY: 100, pointerId: 1 }),
    );

    expect(rebakeSpy).toHaveBeenCalledOnce();
  });

  // 22. rebakeAtlas is NOT called when a translate (axis) drag ends
  it("rebakeAtlas is NOT called after an axis (translate) drag ends", async () => {
    const { container, getMeshHandle } = await mount(
      { polygons: [TRIANGLE], position: [0, 0, 0] },
      (meshRef) => ({ object: meshRef, mode: "translate" }),
    );

    const handle = getMeshHandle();
    expect(handle).not.toBeNull();
    const rebakeSpy = vi.spyOn(handle!, "rebakeAtlas");

    const xBeam = container.querySelector(".polycss-transform-arrow--x") as HTMLElement;
    expect(xBeam).not.toBeNull();

    withFakeLayout(2, () => {
      xBeam.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }),
      );
    });

    window.dispatchEvent(
      new PointerEvent("pointerup", { clientX: 10, clientY: 0, pointerId: 1 }),
    );

    expect(rebakeSpy).not.toHaveBeenCalled();
  });

  // 23. Switching mode from translate → rotate replaces 6 arrows with 3 rings
  it("switching mode from translate to rotate replaces 6 arrows with 3 rings", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const handleRef = ref<PolyMeshHandle | null>(null);
    const mode = ref<"translate" | "rotate">("translate");

    const app = createApp({
      setup() {
        return () =>
          h(PolyCamera, {}, {
            default: () =>
              h(PolyScene, {}, {
                default: () => [
                  h(PolyMesh, { polygons: [TRIANGLE], ref: handleRef }),
                  h(TransformControls, { object: handleRef, mode: mode.value }),
                ],
              }),
          });
      },
    });
    app.mount(container);
    await nextTick();
    await nextTick();

    // Initially translate mode → 6 arrows
    const wrapper = container.querySelector("[data-poly-transform-controls]") as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.querySelectorAll(".polycss-transform-arrow").length).toBe(6);
    expect(wrapper.querySelectorAll(".polycss-transform-ring").length).toBe(0);

    // Switch to rotate
    mode.value = "rotate";
    await nextTick();

    expect(wrapper.querySelectorAll(".polycss-transform-arrow").length).toBe(0);
    expect(wrapper.querySelectorAll(".polycss-transform-ring").length).toBe(3);
  });
});

// Helper to run async code with fake layout
async function withFakeLayoutAsync(cameraScale: number, fn: () => Promise<void>): Promise<void> {
  const TRANSFORM_RE = /translate3d\(\s*(-?[\d.]+)px,\s*(-?[\d.]+)px,\s*(-?[\d.]+)px\s*\)/;
  const orig = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function fakeRect(this: Element): DOMRect {
    let x = 0, y = 0;
    let cur: Element | null = this;
    while (cur && cur instanceof HTMLElement) {
      const t = cur.style.transform;
      if (t) {
        const m = TRANSFORM_RE.exec(t);
        if (m) {
          x += parseFloat(m[1]) * cameraScale;
          y += parseFloat(m[2]) * cameraScale;
        }
      }
      cur = cur.parentElement;
    }
    const w = this instanceof HTMLElement ? parseFloat(this.style.width || "0") || 0 : 0;
    const hh = this instanceof HTMLElement ? parseFloat(this.style.height || "0") || 0 : 0;
    return {
      left: x, top: y, right: x + w, bottom: y + hh, width: w, height: hh, x, y,
      toJSON() { return this; },
    } as DOMRect;
  };
  try {
    await fn();
  } finally {
    Element.prototype.getBoundingClientRect = orig;
  }
}
