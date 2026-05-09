import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import type { VNode } from "vue";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "./PolyScene";
import { PolyMesh } from "./PolyMesh";
import { findMeshHandle, type PolyMeshHandle } from "./events";
import type { Polygon } from "@polycss/core";

const TRIANGLE: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

// Mount a PolyMesh component inside the required PolyCamera > PolyScene context.
// Returns the container element and a `getHandle()` that resolves the exposed
// PolyMeshHandle via a parent template ref.
function mountMesh(
  meshProps: Record<string, unknown> = {},
  slots: Record<string, () => VNode | VNode[]> = {},
): { container: HTMLElement; app: ReturnType<typeof createApp>; getHandle(): PolyMeshHandle | null } {
  const container = document.createElement("div");
  document.body.appendChild(container);

  const handleRef = ref<PolyMeshHandle | null>(null);

  const app = createApp({
    setup() {
      return () =>
        h(PolyCamera, {}, {
          default: () =>
            h(PolyScene, {}, {
              default: () =>
                h(PolyMesh, { ...meshProps, ref: handleRef }, slots),
            }),
        });
    },
  });

  app.mount(container);

  return {
    container,
    app,
    getHandle: () => handleRef.value,
  };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── 1. Exposed handle shape ───────────────────────────────────────────────
describe("PolyMesh (Vue) — exposed handle", () => {
  it("exposes a PolyMeshHandle with id, element, and all getter methods", () => {
    const { getHandle } = mountMesh({
      id: "cube-a",
      polygons: [TRIANGLE],
      position: [10, 20, 30],
      rotation: [5, 6, 7],
      scale: 2,
    });

    const handle = getHandle();
    expect(handle).not.toBeNull();
    expect(handle!.id).toBe("cube-a");
    expect(handle!.element).toBeInstanceOf(HTMLDivElement);
    expect(handle!.element?.classList.contains("polycss-mesh")).toBe(true);
    expect(typeof handle!.getPosition).toBe("function");
    expect(typeof handle!.getRotation).toBe("function");
    expect(typeof handle!.getScale).toBe("function");
    expect(typeof handle!.getPolygons).toBe("function");
    expect(handle!.getPosition()).toEqual([10, 20, 30]);
    expect(handle!.getRotation()).toEqual([5, 6, 7]);
    expect(handle!.getScale()).toBe(2);
    expect(handle!.getPolygons()).toEqual([TRIANGLE]);
  });
});

// ── 2. data-poly-mesh-id attribute ───────────────────────────────────────
describe("PolyMesh (Vue) — data-poly-mesh-id", () => {
  it("sets data-poly-mesh-id on the wrapper when id prop is provided", () => {
    const { container } = mountMesh({ id: "mesh-42", polygons: [TRIANGLE] });
    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(meshEl.getAttribute("data-poly-mesh-id")).toBe("mesh-42");
  });

  it("does not set data-poly-mesh-id when id prop is omitted", () => {
    const { container } = mountMesh({ polygons: [TRIANGLE] });
    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(meshEl.hasAttribute("data-poly-mesh-id")).toBe(false);
  });
});

// ── 3. MESH_REGISTRY: wrapper element is registered ──────────────────────
describe("PolyMesh (Vue) — mesh registry", () => {
  it("registers the wrapper element so findMeshHandle resolves on the wrapper itself", () => {
    const { container } = mountMesh({ id: "cube-a", polygons: [TRIANGLE] });
    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    const handle = findMeshHandle(meshEl);
    expect(handle).not.toBeNull();
    expect(handle!.id).toBe("cube-a");
    expect(handle!.element).toBe(meshEl);
  });

  // ── 4. findMeshHandle walks up from a polygon <i> child ──────────────
  it("findMeshHandle walks up from a polygon <i> child to the registered mesh handle", () => {
    const { container } = mountMesh({ id: "cube-b", polygons: [TRIANGLE] });
    const polygonEl = container.querySelector(".polycss-mesh i") as HTMLElement;
    expect(polygonEl).not.toBeNull();
    const handle = findMeshHandle(polygonEl);
    expect(handle?.id).toBe("cube-b");
  });

  // ── 5. unregister on unmount ──────────────────────────────────────────
  it("unregisters the element on unmount so findMeshHandle returns null", () => {
    const { container, app } = mountMesh({ id: "cube-c", polygons: [TRIANGLE] });
    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(findMeshHandle(meshEl)).not.toBeNull();
    app.unmount();
    expect(findMeshHandle(meshEl)).toBeNull();
  });
});

// ── 6. onClick payload ────────────────────────────────────────────────────
describe("PolyMesh (Vue) — onClick", () => {
  it("fires onClick with a PolyPointerEvent containing object/eventObject/nativeEvent/intersections/stopPropagation/delta/pointer", () => {
    const onClick = vi.fn();
    const { container } = mountMesh({ id: "cube-a", polygons: [TRIANGLE], onClick });

    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    meshEl.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 100, clientY: 50 }));

    expect(onClick).toHaveBeenCalledOnce();
    const event = onClick.mock.calls[0][0];
    expect(event.eventObject.id).toBe("cube-a");
    expect(event.object).toBeDefined();
    expect(event.nativeEvent).toBeInstanceOf(MouseEvent);
    expect(typeof event.stopPropagation).toBe("function");
    expect(typeof event.delta).toBe("number");
    // happy-dom returns 0×0 rects → NDC computation falls back to (0,0).
    // Real-DOM behavior is verified in the next test with a faked cameraEl rect.
    expect(event.pointer).toEqual({ x: 0, y: 0 });
    expect(Array.isArray(event.intersections)).toBe(true);
  });

  it("computes NDC pointer from cameraEl bounding rect when PolyCamera is present", () => {
    const onClick = vi.fn();
    const { container } = mountMesh({ id: "cube-a", polygons: [TRIANGLE], onClick });

    const cameraEl = container.querySelector(".polycss-camera") as HTMLElement;
    cameraEl.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, x: 0, y: 0, toJSON() { return this; } }) as DOMRect;

    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    // Click at (150, 25) inside a 200×100 viewport →
    //   x = (150/200)*2 - 1 = 0.5
    //   y = -((25/100)*2 - 1) = 0.5
    meshEl.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 150, clientY: 25 }));

    expect(onClick).toHaveBeenCalledOnce();
    expect(onClick.mock.calls[0][0].pointer).toEqual({ x: 0.5, y: 0.5 });
  });

  it("does not throw when no onClick handler is provided (zero-overhead default)", () => {
    const { container } = mountMesh({ polygons: [TRIANGLE] });
    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(() => {
      meshEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }).not.toThrow();
  });
});

// ── 7. onPointerOver / onPointerOut via enter/leave ──────────────────────
describe("PolyMesh (Vue) — onPointerOver / onPointerOut", () => {
  it("fires onPointerOver on pointerenter, onPointerOut on pointerleave", () => {
    const onPointerOver = vi.fn();
    const onPointerOut = vi.fn();
    const { container } = mountMesh({
      id: "cube-a",
      polygons: [TRIANGLE],
      onPointerOver,
      onPointerOut,
    });

    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;

    // The source maps onPointerOver/Over to pointerenter and onPointerOut/Leave
    // to pointerleave on the wrapper div.
    meshEl.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false }));
    expect(onPointerOver).toHaveBeenCalledOnce();
    expect(onPointerOut).not.toHaveBeenCalled();

    meshEl.dispatchEvent(new PointerEvent("pointerleave", { bubbles: false }));
    expect(onPointerOut).toHaveBeenCalledOnce();
  });

  it("fires onPointerEnter alongside onPointerOver on the same pointerenter event", () => {
    const onPointerOver = vi.fn();
    const onPointerEnter = vi.fn();
    const { container } = mountMesh({
      polygons: [TRIANGLE],
      onPointerOver,
      onPointerEnter,
    });

    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    meshEl.dispatchEvent(new PointerEvent("pointerenter", { bubbles: false }));

    expect(onPointerOver).toHaveBeenCalledOnce();
    expect(onPointerEnter).toHaveBeenCalledOnce();
  });
});

// ── 8. delta tracking ─────────────────────────────────────────────────────
describe("PolyMesh (Vue) — delta tracking", () => {
  it("delta is 0 on pointerdown and reports pixel distance on subsequent move/up", () => {
    const downEvent = vi.fn();
    const moveEvent = vi.fn();
    const upEvent = vi.fn();
    const { container } = mountMesh({
      polygons: [TRIANGLE],
      onPointerDown: downEvent,
      onPointerMove: moveEvent,
      onPointerUp: upEvent,
    });

    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;

    meshEl.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }));
    expect(downEvent.mock.calls[0][0].delta).toBe(0);

    meshEl.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 103, clientY: 104 }));
    expect(moveEvent.mock.calls[0][0].delta).toBeCloseTo(5, 5); // hypot(3,4) = 5

    meshEl.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 110, clientY: 100 }));
    expect(upEvent.mock.calls[0][0].delta).toBe(10);
  });

  it("delta resets after pointerup so a subsequent move without active down reports 0", () => {
    const moveEvent = vi.fn();
    const { container } = mountMesh({
      polygons: [TRIANGLE],
      onPointerMove: moveEvent,
    });

    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;

    meshEl.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 50, clientY: 50 }));
    meshEl.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 60, clientY: 50 }));
    meshEl.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 60, clientY: 50 }));

    expect(moveEvent.mock.calls[0][0].delta).toBe(10);

    // After pointerup, pointerDownAt is null — move delta is 0.
    meshEl.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 200, clientY: 200 }));
    expect(moveEvent.mock.calls[1][0].delta).toBe(0);
  });

  it("pointercancel also resets delta tracking", () => {
    const cancelEvent = vi.fn();
    const moveEvent = vi.fn();
    const { container } = mountMesh({
      polygons: [TRIANGLE],
      onPointerCancel: cancelEvent,
      onPointerMove: moveEvent,
    });

    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;

    meshEl.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 0 }));
    meshEl.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, clientX: 0, clientY: 0 }));

    expect(cancelEvent).toHaveBeenCalledOnce();

    meshEl.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 100, clientY: 100 }));
    // delta should be 0 since pointerDownAt was cleared by cancel
    expect(moveEvent.mock.calls[0][0].delta).toBe(0);
  });
});

// ── 9. stopPropagation in handler blocks DOM ancestor ─────────────────────
describe("PolyMesh (Vue) — stopPropagation", () => {
  it("calling stopPropagation in onClick blocks DOM ancestor click handler", () => {
    const ancestorClick = vi.fn();
    const meshClick = vi.fn((e: { stopPropagation(): void }) => e.stopPropagation());

    const container = document.createElement("div");
    document.body.appendChild(container);

    container.addEventListener("click", ancestorClick);

    const app = createApp({
      setup() {
        return () =>
          h(PolyCamera, {}, {
            default: () =>
              h(PolyScene, {}, {
                default: () =>
                  h(PolyMesh, { polygons: [TRIANGLE], onClick: meshClick }),
              }),
          });
      },
    });
    app.mount(container);

    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    meshEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(meshClick).toHaveBeenCalledOnce();
    expect(ancestorClick).not.toHaveBeenCalled();
  });
});

// ── 10. handle getters reflect latest props after re-render ──────────────
describe("PolyMesh (Vue) — handle reflects latest props", () => {
  it("handle getters return updated values after reactive prop change", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    const position = ref<[number, number, number]>([1, 2, 3]);
    const handleRef = ref<PolyMeshHandle | null>(null);

    const app = createApp({
      setup() {
        return () =>
          h(PolyCamera, {}, {
            default: () =>
              h(PolyScene, {}, {
                default: () =>
                  h(PolyMesh, {
                    ref: handleRef,
                    polygons: [TRIANGLE],
                    position: position.value,
                  }),
              }),
          });
      },
    });
    app.mount(container);

    expect(handleRef.value!.getPosition()).toEqual([1, 2, 3]);

    position.value = [100, 200, 300];
    await nextTick();

    expect(handleRef.value!.getPosition()).toEqual([100, 200, 300]);
  });
});

// ── 11. rebakeAtlas smoke test ────────────────────────────────────────────
describe("PolyMesh (Vue) — rebakeAtlas", () => {
  it("exposes rebakeAtlas as a function on the handle", () => {
    const { getHandle } = mountMesh({ polygons: [TRIANGLE], rotation: [0, 45, 0] });
    const handle = getHandle();
    expect(handle).not.toBeNull();
    expect(typeof handle!.rebakeAtlas).toBe("function");
  });

  it("calling rebakeAtlas() does not throw", () => {
    const { getHandle } = mountMesh({ polygons: [TRIANGLE], rotation: [10, 20, 30] });
    const handle = getHandle();
    expect(() => handle!.rebakeAtlas()).not.toThrow();
  });

  it("calling rebakeAtlas() with no rotation prop does not throw", () => {
    const { getHandle } = mountMesh({ polygons: [TRIANGLE] });
    const handle = getHandle();
    expect(() => handle!.rebakeAtlas()).not.toThrow();
  });
});
