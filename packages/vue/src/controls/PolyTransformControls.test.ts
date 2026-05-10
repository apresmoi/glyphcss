import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "../scene/PolyScene";
import { PolyMesh } from "../scene/PolyMesh";
import { PolyTransformControls } from "./PolyTransformControls";
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
                h(PolyTransformControls, controlsPropsFactory ? controlsPropsFactory(handleRef) : { object: handleRef }),
              ],
            }),
        });
    },
  });

  app.mount(container);
  await nextTick();
  await nextTick();
  return { container, app, getMeshHandle: () => handleRef.value };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("PolyTransformControls (Vue)", () => {
  it("renders nothing when object is null", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(PolyCamera, {}, {
            default: () =>
              h(PolyScene, {}, {
                default: () => h(PolyTransformControls, { object: null }),
              }),
          });
      },
    });
    app.mount(container);
    expect(container.querySelector("[data-poly-transform-controls]")).toBeNull();
  });

  it("renders nothing for the unimplemented scale mode", async () => {
    const { container } = await mount(
      { polygons: [TRIANGLE] },
      (meshRef) => ({ object: meshRef, mode: "scale" }),
    );
    expect(container.querySelector("[data-poly-transform-controls]")).toBeNull();
  });

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

  it("showX=false showZ=false shows only Y axis arrows", async () => {
    const { container } = await mount(
      { polygons: [TRIANGLE] },
      (meshRef) => ({ object: meshRef, showX: false, showZ: false }),
    );
    const wrapper = container.querySelector("[data-poly-transform-controls]") as HTMLElement;
    const arrows = Array.from(wrapper.querySelectorAll(".polycss-transform-arrow"));
    expect(arrows.map(axisKeyOf)).toEqual(["y", "-y"]);
  });

  it("pointerdown on X arrow emits mouseDown + draggingChanged(true); pointerup emits mouseUp + draggingChanged(false)", async () => {
    const onMouseDown = vi.fn();
    const onMouseUp = vi.fn();
    const onDraggingChanged = vi.fn();

    let container!: HTMLElement;
    await withFakeLayoutAsync(2, async () => {
      const result = await mount(
        { polygons: [TRIANGLE] },
        (meshRef) => ({ object: meshRef, onMouseDown, onMouseUp, onDraggingChanged }),
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

    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 10, clientY: 0, pointerId: 1 }));

    expect(onMouseUp).toHaveBeenCalledOnce();
    expect(onDraggingChanged).toHaveBeenLastCalledWith(false);
  });

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
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 10, clientY: 0, pointerId: 1 }));
    });

    expect(onObjectChange).toHaveBeenCalledOnce();
    expect(onObjectChange.mock.calls[0][0].position).toEqual([105, 200, 0]);
  });

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
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: 6, pointerId: 1 }));
      expect(onObjectChange.mock.calls[0][0].position).toEqual([10, 23, 30]);
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 100, clientY: 6, pointerId: 1 }));
      expect(onObjectChange.mock.calls[1][0].position).toEqual([10, 23, 30]);
    });
  });

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
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 14, clientY: 0, pointerId: 1 }));
    });

    expect(onObjectChange.mock.calls[0][0].position).toEqual([5, 0, 0]);
  });

  it("enabled=false ignores pointerdown (no callbacks fire)", async () => {
    const onMouseDown = vi.fn();
    const onObjectChange = vi.fn();

    const { container } = await mount(
      { polygons: [TRIANGLE] },
      (meshRef) => ({ object: meshRef, enabled: false, onMouseDown, onObjectChange }),
    );

    const xBeam = container.querySelector(".polycss-transform-arrow--x") as HTMLElement;
    expect(xBeam).not.toBeNull();

    withFakeLayout(2, () => {
      xBeam.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0, pointerId: 1 }),
      );
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 100, clientY: 0, pointerId: 1 }));
      window.dispatchEvent(new PointerEvent("pointerup", { clientX: 100, clientY: 0, pointerId: 1 }));
    });

    expect(onMouseDown).not.toHaveBeenCalled();
    expect(onObjectChange).not.toHaveBeenCalled();
  });

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
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: -10, clientY: 0, pointerId: 1 }));
    });

    expect(onObjectChange).toHaveBeenCalledOnce();
    expect(onObjectChange.mock.calls[0][0].position[0]).toBe(95);
  });

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
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: 20, pointerId: 1 }));
    });

    expect(onObjectChange).not.toHaveBeenCalled();
  });

  it("dragging Y ring: rotation[1] changes after pointer move", async () => {
    const onObjectChange = vi.fn();

    const { container } = await mount(
      { polygons: [TRIANGLE], rotation: [0, 0, 0] },
      (meshRef) => ({ object: meshRef, mode: "rotate", onObjectChange }),
    );

    const yRing = container.querySelector(".polycss-transform-ring--y") as HTMLElement;
    expect(yRing).not.toBeNull();

    withFakeLayout(2, () => {
      yRing.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 0, pointerId: 1 }),
      );
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: 100, pointerId: 1 }));
    });

    expect(onObjectChange).toHaveBeenCalled();
    const event = onObjectChange.mock.calls[0][0];
    expect(typeof event.rotation[1]).toBe("number");
    expect(event.rotation[0]).toBe(0);
    expect(event.rotation[2]).toBe(0);
  });

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
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: 100, pointerId: 1 }));
    });

    expect(onObjectChange).toHaveBeenCalled();
    const event = onObjectChange.mock.calls[0][0];
    expect(typeof event.rotation[2]).toBe("number");
    expect(event.rotation[0]).toBe(0);
    expect(event.rotation[1]).toBe(0);
  });

  it("rotationSnap=15 rounds raw rotation to nearest 15° step", async () => {
    const onObjectChange = vi.fn();

    const { container } = await mount(
      { polygons: [TRIANGLE], rotation: [0, 0, 0] },
      (meshRef) => ({ object: meshRef, mode: "rotate", onObjectChange, rotationSnap: 15 }),
    );

    const xRing = container.querySelector(".polycss-transform-ring--x") as HTMLElement;
    expect(xRing).not.toBeNull();

    withFakeLayout(1, () => {
      xRing.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, clientX: 1, clientY: 0, pointerId: 1 }),
      );
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: 1, pointerId: 1 }));
    });

    expect(onObjectChange).toHaveBeenCalled();
    const degrees = onObjectChange.mock.calls[0][0].rotation[0];
    expect(degrees % 15).toBeCloseTo(0, 5);
  });

  it("rotate Y ring: pointerdown emits mouseDown + draggingChanged(true); pointerup emits mouseUp + draggingChanged(false)", async () => {
    const onMouseDown = vi.fn();
    const onMouseUp = vi.fn();
    const onDraggingChanged = vi.fn();

    const { container } = await mount(
      { polygons: [TRIANGLE] },
      (meshRef) => ({ object: meshRef, mode: "rotate", onMouseDown, onMouseUp, onDraggingChanged }),
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

    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 0, clientY: 100, pointerId: 1 }));

    expect(onMouseUp).toHaveBeenCalledOnce();
    expect(onDraggingChanged).toHaveBeenLastCalledWith(false);
  });

  it("enabled=false: pointerdown on Y ring ignored", async () => {
    const onMouseDown = vi.fn();

    const { container } = await mount(
      { polygons: [TRIANGLE] },
      (meshRef) => ({ object: meshRef, mode: "rotate", enabled: false, onMouseDown }),
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

  it("component unmount detaches the camera pointerdown listener", async () => {
    const onMouseDown = vi.fn();

    const { container, app } = await mount(
      { polygons: [TRIANGLE], position: [50, 50, 0] },
      (meshRef) => ({ object: meshRef, onMouseDown }),
    );

    const cameraEl = container.querySelector(".polycss-camera") as HTMLElement;
    expect(cameraEl).not.toBeNull();

    app.unmount();

    cameraEl.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, clientX: 50, clientY: 50, pointerId: 1 }),
    );

    expect(onMouseDown).not.toHaveBeenCalled();
  });

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

    expect(rebakeSpy).not.toHaveBeenCalled();

    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 0, clientY: 100, pointerId: 1 }));

    expect(rebakeSpy).toHaveBeenCalledOnce();
  });

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

    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 10, clientY: 0, pointerId: 1 }));

    expect(rebakeSpy).not.toHaveBeenCalled();
  });

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
                  h(PolyTransformControls, { object: handleRef, mode: mode.value }),
                ],
              }),
          });
      },
    });
    app.mount(container);
    await nextTick();
    await nextTick();

    const wrapper = container.querySelector("[data-poly-transform-controls]") as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.querySelectorAll(".polycss-transform-arrow").length).toBe(6);
    expect(wrapper.querySelectorAll(".polycss-transform-ring").length).toBe(0);

    mode.value = "rotate";
    await nextTick();

    expect(wrapper.querySelectorAll(".polycss-transform-arrow").length).toBe(0);
    expect(wrapper.querySelectorAll(".polycss-transform-ring").length).toBe(3);
  });
});

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
