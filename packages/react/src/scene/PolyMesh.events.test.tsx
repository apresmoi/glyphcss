import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "./PolyScene";
import { PolyMesh } from "./PolyMesh";
import { findPolyMeshHandle, type PolyMeshHandle } from "./events";
import type { Polygon } from "@layoutit/polycss-core";

const TRIANGLE: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(node: React.ReactNode): HTMLDivElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return container;
}

describe("PolyMesh — pointer events", () => {
  it("forwardRef exposes a stable PolyMeshHandle with id, element, and getters", () => {
    const ref = createRef<PolyMeshHandle>();
    mount(
      <PolyCamera>
        <PolyScene>
          <PolyMesh
            ref={ref}
            id="cube-a"
            polygons={[TRIANGLE]}
            position={[10, 20, 30]}
            rotation={[5, 6, 7]}
            scale={2}
          />
        </PolyScene>
      </PolyCamera>,
    );
    const handle = ref.current;
    expect(handle).not.toBeNull();
    expect(handle!.id).toBe("cube-a");
    expect(handle!.element).toBeInstanceOf(HTMLDivElement);
    expect(handle!.element?.classList.contains("polycss-mesh")).toBe(true);
    expect(handle!.getPosition()).toEqual([10, 20, 30]);
    expect(handle!.getRotation()).toEqual([5, 6, 7]);
    expect(handle!.getScale()).toBe(2);
    expect(handle!.getPolygons()).toEqual([TRIANGLE]);
  });

  it("reflects id as data-poly-mesh-id and registers element in mesh registry", () => {
    const container = mount(
      <PolyCamera>
        <PolyScene>
          <PolyMesh id="cube-a" polygons={[TRIANGLE]} />
        </PolyScene>
      </PolyCamera>,
    );
    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(meshEl.getAttribute("data-poly-mesh-id")).toBe("cube-a");
    const handle = findPolyMeshHandle(meshEl);
    expect(handle?.id).toBe("cube-a");
    expect(handle?.element).toBe(meshEl);
  });

  it("findPolyMeshHandle walks up from a polygon child to its mesh wrapper", () => {
    const container = mount(
      <PolyCamera>
        <PolyScene>
          <PolyMesh id="cube-a" polygons={[TRIANGLE]} />
        </PolyScene>
      </PolyCamera>,
    );
    const polygonEl = container.querySelector(".polycss-mesh i") as HTMLElement;
    expect(polygonEl).not.toBeNull();
    const handle = findPolyMeshHandle(polygonEl);
    expect(handle?.id).toBe("cube-a");
  });

  it("unregisters element on unmount", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <PolyCamera>
          <PolyScene>
            <PolyMesh id="cube-a" polygons={[TRIANGLE]} />
          </PolyScene>
        </PolyCamera>,
      ),
    );
    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(findPolyMeshHandle(meshEl)).not.toBeNull();
    act(() => root.unmount());
    expect(findPolyMeshHandle(meshEl)).toBeNull();
  });

  it("onClick fires with PolyPointerEvent payload (object/eventObject/nativeEvent/stopPropagation)", () => {
    const onClick = vi.fn();
    const container = mount(
      <PolyCamera>
        <PolyScene>
          <PolyMesh id="cube-a" polygons={[TRIANGLE]} onClick={onClick} />
        </PolyScene>
      </PolyCamera>,
    );
    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    act(() => {
      meshEl.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 100, clientY: 50 }));
    });
    expect(onClick).toHaveBeenCalledOnce();
    const event = onClick.mock.calls[0][0];
    expect(event.eventObject.id).toBe("cube-a");
    expect(event.object.id).toBe("cube-a");
    expect(event.nativeEvent).toBeInstanceOf(MouseEvent);
    expect(typeof event.stopPropagation).toBe("function");
    expect(typeof event.delta).toBe("number");
    expect(event.pointer).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
    expect(Array.isArray(event.intersections)).toBe(true);
  });

  it("onPointerOver fires on enter, onPointerOut on leave (DOM enter/leave semantics)", () => {
    const onPointerOver = vi.fn();
    const onPointerOut = vi.fn();
    const container = mount(
      <PolyCamera>
        <PolyScene>
          <PolyMesh
            id="cube-a"
            polygons={[TRIANGLE]}
            onPointerOver={onPointerOver}
            onPointerOut={onPointerOut}
          />
        </PolyScene>
      </PolyCamera>,
    );
    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    // React's synthetic onPointerEnter / onPointerLeave are derived from
    // the bubbling pointerover/pointerout events (it tracks relatedTarget
    // and synthesizes enter/leave). Dispatching pointerover with no
    // relatedTarget = entering the mesh from outside.
    act(() => {
      meshEl.dispatchEvent(
        new PointerEvent("pointerover", { bubbles: true, relatedTarget: null }),
      );
    });
    expect(onPointerOver).toHaveBeenCalledOnce();
    expect(onPointerOut).not.toHaveBeenCalled();
    act(() => {
      meshEl.dispatchEvent(
        new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }),
      );
    });
    expect(onPointerOut).toHaveBeenCalledOnce();
  });

  it("delta is 0 on pointerdown and reports pixel distance on subsequent move/up", () => {
    const downEvent = vi.fn();
    const moveEvent = vi.fn();
    const upEvent = vi.fn();
    const container = mount(
      <PolyCamera>
        <PolyScene>
          <PolyMesh
            polygons={[TRIANGLE]}
            onPointerDown={downEvent}
            onPointerMove={moveEvent}
            onPointerUp={upEvent}
          />
        </PolyScene>
      </PolyCamera>,
    );
    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    act(() => {
      meshEl.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 100 }));
    });
    expect(downEvent.mock.calls[0][0].delta).toBe(0);
    act(() => {
      meshEl.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 103, clientY: 104 }));
    });
    expect(moveEvent.mock.calls[0][0].delta).toBeCloseTo(5, 5); // hypot(3,4) = 5
    act(() => {
      meshEl.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 110, clientY: 100 }));
    });
    expect(upEvent.mock.calls[0][0].delta).toBe(10);
  });

  it("delta resets to 0 after pointerup so the next gesture starts fresh", () => {
    const moveEvent = vi.fn();
    const downEvent = vi.fn();
    const container = mount(
      <PolyCamera>
        <PolyScene>
          <PolyMesh polygons={[TRIANGLE]} onPointerDown={downEvent} onPointerMove={moveEvent} />
        </PolyScene>
      </PolyCamera>,
    );
    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    act(() => {
      meshEl.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 50, clientY: 50 }));
      meshEl.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 60, clientY: 50 }));
      meshEl.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 60, clientY: 50 }));
    });
    expect(moveEvent.mock.calls[0][0].delta).toBe(10);
    // After pointerup, delta tracking is cleared. A subsequent move with no
    // active pointerdown reports 0.
    act(() => {
      meshEl.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 200, clientY: 200 }));
    });
    expect(moveEvent.mock.calls[1][0].delta).toBe(0);
  });

  it("does not attach onClick listener when no handler is provided (zero-overhead default)", () => {
    const container = mount(
      <PolyCamera>
        <PolyScene>
          <PolyMesh polygons={[TRIANGLE]} />
        </PolyScene>
      </PolyCamera>,
    );
    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    // No throw, no React error — just a quiet click that nobody listens to.
    expect(() => {
      meshEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }).not.toThrow();
  });

  it("calling stopPropagation in handler blocks React-tree ancestor handler", () => {
    const ancestorClick = vi.fn();
    const meshClick = vi.fn((e: { stopPropagation(): void }) => e.stopPropagation());
    const container = mount(
      <div onClick={ancestorClick}>
        <PolyCamera>
          <PolyScene>
            <PolyMesh polygons={[TRIANGLE]} onClick={meshClick} />
          </PolyScene>
        </PolyCamera>
      </div>,
    );
    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    act(() => {
      meshEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(meshClick).toHaveBeenCalledOnce();
    expect(ancestorClick).not.toHaveBeenCalled();
  });

  it("handle getters reflect latest props after re-render", () => {
    const ref = createRef<PolyMeshHandle>();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <PolyCamera>
          <PolyScene>
            <PolyMesh ref={ref} polygons={[TRIANGLE]} position={[1, 2, 3]} />
          </PolyScene>
        </PolyCamera>,
      ),
    );
    expect(ref.current!.getPosition()).toEqual([1, 2, 3]);
    act(() =>
      root.render(
        <PolyCamera>
          <PolyScene>
            <PolyMesh ref={ref} polygons={[TRIANGLE]} position={[100, 200, 300]} />
          </PolyScene>
        </PolyCamera>,
      ),
    );
    expect(ref.current!.getPosition()).toEqual([100, 200, 300]);
  });
});
