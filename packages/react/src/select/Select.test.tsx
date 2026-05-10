import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "../scene/PolyScene";
import { PolyMesh } from "../scene/PolyMesh";
import { PolySelect, usePolySelect, usePolySelectionApi } from "./Select";
import { registerMeshElement, unregisterMeshElement, type PolyMeshHandle } from "../scene/events";
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

function clickMesh(container: HTMLElement, id: string, init: MouseEventInit = {}): void {
  const mesh = container.querySelector(`.polycss-mesh[data-poly-mesh-id="${id}"]`) as HTMLElement;
  expect(mesh, `expected mesh #${id}`).not.toBeNull();
  act(() => {
    mesh.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
  });
}

function clickBackground(container: HTMLElement): void {
  const wrapper = container.querySelector("[data-poly-select]") as HTMLElement;
  expect(wrapper, "expected Select wrapper").not.toBeNull();
  act(() => {
    wrapper.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("<PolySelect> + usePolySelect", () => {
  it("clicking a mesh selects it (single mode replaces)", () => {
    const onChange = vi.fn();
    const container = mount(
      <PolyCamera>
        <PolyScene>
          <PolySelect onChange={onChange}>
            <PolyMesh id="a" polygons={[TRIANGLE]} />
            <PolyMesh id="b" polygons={[TRIANGLE]} />
          </PolySelect>
        </PolyScene>
      </PolyCamera>,
    );
    clickMesh(container, "a");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
    expect(onChange.mock.calls[0][0][0].id).toBe("a");

    clickMesh(container, "b");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0]).toHaveLength(1);
    expect(onChange.mock.calls[1][0][0].id).toBe("b");
  });

  it("clicking the currently-selected mesh toggles it off (single mode)", () => {
    const onChange = vi.fn();
    const container = mount(
      <PolyCamera>
        <PolyScene>
          <PolySelect onChange={onChange}>
            <PolyMesh id="a" polygons={[TRIANGLE]} />
          </PolySelect>
        </PolyScene>
      </PolyCamera>,
    );
    clickMesh(container, "a");
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
    clickMesh(container, "a");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0]).toEqual([]);
  });

  it("multiple + shift-click adds to selection; shift-click again removes", () => {
    const onChange = vi.fn();
    const container = mount(
      <PolyCamera>
        <PolyScene>
          <PolySelect multiple onChange={onChange}>
            <PolyMesh id="a" polygons={[TRIANGLE]} />
            <PolyMesh id="b" polygons={[TRIANGLE]} />
            <PolyMesh id="c" polygons={[TRIANGLE]} />
          </PolySelect>
        </PolyScene>
      </PolyCamera>,
    );
    clickMesh(container, "a");
    clickMesh(container, "b", { shiftKey: true });
    clickMesh(container, "c", { shiftKey: true });
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last.map((h: { id: string }) => h.id)).toEqual(["a", "b", "c"]);

    clickMesh(container, "b", { shiftKey: true });
    const after = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(after.map((h: { id: string }) => h.id)).toEqual(["a", "c"]);
  });

  it("clicking the background clears selection by default", () => {
    const onChange = vi.fn();
    const container = mount(
      <PolyCamera>
        <PolyScene>
          <PolySelect onChange={onChange}>
            <PolyMesh id="a" polygons={[TRIANGLE]} />
          </PolySelect>
        </PolyScene>
      </PolyCamera>,
    );
    clickMesh(container, "a");
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
    clickBackground(container);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0]).toHaveLength(0);
  });

  it("clearOnMiss=false keeps selection on background click; onPointerMissed still fires", () => {
    const onChange = vi.fn();
    const onPointerMissed = vi.fn();
    const container = mount(
      <PolyCamera>
        <PolyScene>
          <PolySelect onChange={onChange} clearOnMiss={false} onPointerMissed={onPointerMissed}>
            <PolyMesh id="a" polygons={[TRIANGLE]} />
          </PolySelect>
        </PolyScene>
      </PolyCamera>,
    );
    clickMesh(container, "a");
    clickBackground(container);
    expect(onChange).toHaveBeenCalledTimes(1); // selection unchanged
    expect(onPointerMissed).toHaveBeenCalledTimes(1);
  });

  it("PolyMesh onClick still fires alongside Select (escape-hatch design note)", () => {
    // Trade-off: <PolySelect> attaches its click listener to the parent
    // .polycss-camera element, because polycss polygons render via the
    // CSS `border-shape` property which clips hit-testing to the
    // visible polygon shape — clicks frequently target cameraEl
    // directly, never bubbling through any descendant. The cameraEl
    // listener fires during native bubble, BEFORE React's root-level
    // synthetic dispatch — so calling stopPropagation in a PolyMesh
    // synthetic handler can't unwind the selection that already fired
    // upstream. PolyMesh.onClick still fires; it just can't veto Select.
    const onChange = vi.fn();
    const meshClick = vi.fn();
    const container = mount(
      <PolyCamera>
        <PolyScene>
          <PolySelect onChange={onChange}>
            <PolyMesh id="a" polygons={[TRIANGLE]} onClick={meshClick} />
          </PolySelect>
        </PolyScene>
      </PolyCamera>,
    );
    clickMesh(container, "a");
    expect(meshClick).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("usePolySelect returns the current selection inside the tree", () => {
    let observed: string[] = [];
    function Inner() {
      const sel = usePolySelect();
      useEffect(() => {
        observed = sel.map((h) => h.id ?? "?");
      });
      return null;
    }
    const container = mount(
      <PolyCamera>
        <PolyScene>
          <PolySelect multiple>
            <PolyMesh id="a" polygons={[TRIANGLE]} />
            <PolyMesh id="b" polygons={[TRIANGLE]} />
            <Inner />
          </PolySelect>
        </PolyScene>
      </PolyCamera>,
    );
    clickMesh(container, "a");
    expect(observed).toEqual(["a"]);
    clickMesh(container, "b", { shiftKey: true });
    expect(observed).toEqual(["a", "b"]);
  });

  it("usePolySelectionApi exposes set/add/remove/toggle/clear/has", () => {
    let api: ReturnType<typeof usePolySelectionApi> | null = null;
    function Capture() {
      api = usePolySelectionApi();
      return null;
    }
    const container = mount(
      <PolyCamera>
        <PolyScene>
          <PolySelect multiple>
            <PolyMesh id="a" polygons={[TRIANGLE]} />
            <PolyMesh id="b" polygons={[TRIANGLE]} />
            <Capture />
          </PolySelect>
        </PolyScene>
      </PolyCamera>,
    );
    expect(api).not.toBeNull();
    const meshA = container.querySelector('[data-poly-mesh-id="a"]') as HTMLElement;
    const meshB = container.querySelector('[data-poly-mesh-id="b"]') as HTMLElement;
    // Resolve handles via click-once, then snapshot.
    clickMesh(container, "a");
    const handleA = api!.selected[0];
    clickMesh(container, "b");
    const handleB = api!.selected[0];

    act(() => api!.set([handleA, handleB]));
    expect(api!.selected.map((h) => h.id)).toEqual(["a", "b"]);
    expect(api!.has(handleA)).toBe(true);

    act(() => api!.remove(handleA));
    expect(api!.selected.map((h) => h.id)).toEqual(["b"]);
    expect(api!.has(handleA)).toBe(false);

    act(() => api!.toggle(handleA));
    expect(api!.selected.map((h) => h.id)).toEqual(["b", "a"]);

    act(() => api!.clear());
    expect(api!.selected).toHaveLength(0);
  });

  it("usePolySelect outside <PolySelect> returns []", () => {
    let observed: unknown = null;
    function Inner() {
      observed = usePolySelect();
      return null;
    }
    mount(<Inner />);
    expect(observed).toEqual([]);
  });

  it("usePolySelectionApi outside <PolySelect> throws", () => {
    function Inner() {
      usePolySelectionApi();
      return null;
    }
    // Suppress React's error logging.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => mount(<Inner />)).toThrow(/usePolySelectionApi/);
    errorSpy.mockRestore();
  });

  it("filter is applied on every selection change", () => {
    const onChange = vi.fn();
    // Filter that drops meshes with id 'b'.
    const filter = (meshes: { id?: string }[]) => meshes.filter((m) => m.id !== "b");
    const container = mount(
      <PolyCamera>
        <PolyScene>
          <PolySelect
            multiple
            filter={filter as (m: import("../scene/events").PolyMeshHandle[]) => import("../scene/events").PolyMeshHandle[]}
            onChange={onChange}
          >
            <PolyMesh id="a" polygons={[TRIANGLE]} />
            <PolyMesh id="b" polygons={[TRIANGLE]} />
          </PolySelect>
        </PolyScene>
      </PolyCamera>,
    );
    clickMesh(container, "b");
    expect(onChange.mock.calls[0][0]).toEqual([]);
    clickMesh(container, "a");
    expect(onChange.mock.calls[1][0].map((h: { id: string }) => h.id)).toEqual(["a"]);
  });
});

// ── handleClick fallback path (no <PolyCamera> ancestor) ────────────────────
// When <PolySelect> is used outside <PolyCamera>, cameraCtx is null and the
// React wrapper's onClick is the only event path. This exercises lines
// 263-266 (miss → onPointerMissed + clearOnMiss) and 268-273 (multiple
// shift-click toggle / single deselect / single select).
describe("<PolySelect> handleClick fallback (no PolyCamera)", () => {
  // Build a fake PolyMeshHandle that looks like a real mesh element
  function makeFakeHandle(el: HTMLElement, id: string): PolyMeshHandle {
    return {
      element: el as HTMLDivElement,
      id,
      getPosition: () => undefined,
      getRotation: () => undefined,
      getScale: () => undefined,
      getPolygons: () => [],
    };
  }

  it("click background fires onPointerMissed and clears selection (clearOnMiss default)", () => {
    const onChange = vi.fn();
    const onPointerMissed = vi.fn();
    const container = mount(
      <PolySelect onChange={onChange} onPointerMissed={onPointerMissed}>
        <div />
      </PolySelect>,
    );
    const wrapper = container.querySelector("[data-poly-select]") as HTMLElement;
    act(() => {
      wrapper.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPointerMissed).toHaveBeenCalledOnce();
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("click background with clearOnMiss=false calls onPointerMissed but does not clear", () => {
    const onChange = vi.fn();
    const onPointerMissed = vi.fn();
    mount(
      <PolySelect onChange={onChange} onPointerMissed={onPointerMissed} clearOnMiss={false}>
        <div />
      </PolySelect>,
    );
    // No mesh under pointer, no cameraCtx
    const wrapper = document.querySelector("[data-poly-select]") as HTMLElement;
    act(() => {
      wrapper.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onPointerMissed).toHaveBeenCalledOnce();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("click on a registered mesh element selects it", () => {
    const onChange = vi.fn();
    const container = mount(
      <PolySelect onChange={onChange}>
        <div className="polycss-mesh" data-poly-mesh-id="m1" />
      </PolySelect>,
    );
    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    const handle = makeFakeHandle(meshEl, "m1");
    registerMeshElement(meshEl, handle);
    try {
      act(() => {
        meshEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onChange).toHaveBeenCalledWith([handle]);
    } finally {
      unregisterMeshElement(meshEl);
    }
  });

  it("clicking already-selected mesh deselects it (toggle off)", () => {
    const onChange = vi.fn();
    const container = mount(
      <PolySelect onChange={onChange}>
        <div className="polycss-mesh" data-poly-mesh-id="m2" />
      </PolySelect>,
    );
    const meshEl = container.querySelector(".polycss-mesh") as HTMLElement;
    const handle = makeFakeHandle(meshEl, "m2");
    registerMeshElement(meshEl, handle);
    try {
      // Select it first
      act(() => {
        meshEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onChange).toHaveBeenLastCalledWith([handle]);
      // Click again — should deselect
      act(() => {
        meshEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      expect(onChange).toHaveBeenLastCalledWith([]);
    } finally {
      unregisterMeshElement(meshEl);
    }
  });

  it("multiple + shiftKey toggles mesh into/out of selection", () => {
    const onChange = vi.fn();
    const container = mount(
      <PolySelect multiple onChange={onChange}>
        <div className="polycss-mesh" data-poly-mesh-id="ma" />
        <div className="polycss-mesh" data-poly-mesh-id="mb" />
      </PolySelect>,
    );
    const meshElA = container.querySelector('[data-poly-mesh-id="ma"]') as HTMLElement;
    const meshElB = container.querySelector('[data-poly-mesh-id="mb"]') as HTMLElement;
    const handleA = makeFakeHandle(meshElA, "ma");
    const handleB = makeFakeHandle(meshElB, "mb");
    registerMeshElement(meshElA, handleA);
    registerMeshElement(meshElB, handleB);
    try {
      // Select A
      act(() => {
        meshElA.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      // Shift+click B to add
      act(() => {
        meshElB.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
      });
      const last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
      expect(last).toContain(handleA);
      expect(last).toContain(handleB);
    } finally {
      unregisterMeshElement(meshElA);
      unregisterMeshElement(meshElB);
    }
  });
});
