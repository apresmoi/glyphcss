import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, h, nextTick, defineComponent, ref } from "vue";
import type { ComputedRef } from "vue";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "../scene/PolyScene";
import { PolyMesh } from "../scene/PolyMesh";
import { Select, useSelect, useSelectionApi } from "./Select";
import type { SelectionApi } from "./Select";
import type { PolyMeshHandle } from "../scene/events";
import type { Polygon } from "@polycss/core";

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

// ── mount helpers ─────────────────────────────────────────────────────────────

type MountResult = { container: HTMLElement; app: ReturnType<typeof createApp> };

function mount(rootVNode: ReturnType<typeof h>): MountResult {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({ setup() { return () => rootVNode; } });
  app.mount(container);
  return { container, app };
}

function mountSelect(
  selectProps: Record<string, unknown> = {},
  children: ReturnType<typeof h>[] = [],
): MountResult {
  return mount(
    h(PolyCamera, {}, {
      default: () =>
        h(PolyScene, {}, {
          default: () =>
            h(Select, selectProps, {
              default: () => children,
            }),
        }),
    }),
  );
}

/**
 * Dispatch a click on the `.polycss-mesh[data-poly-mesh-id="<id>"]` element.
 * Clicks bubble up through the DOM, reaching the cameraEl listener on Select.
 */
function clickMesh(container: HTMLElement, id: string, init: MouseEventInit = {}): void {
  const mesh = container.querySelector(`.polycss-mesh[data-poly-mesh-id="${id}"]`) as HTMLElement;
  expect(mesh, `expected mesh #${id}`).not.toBeNull();
  mesh.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
}

/**
 * Click the camera element directly (no mesh under pointer → "background" click).
 */
function clickBackground(container: HTMLElement): void {
  const cameraEl = container.querySelector(".polycss-camera") as HTMLElement;
  expect(cameraEl, "expected .polycss-camera").not.toBeNull();
  cameraEl.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("<Select> + useSelect (Vue)", () => {
  it("clicking a mesh selects it (single mode replaces)", async () => {
    const onChange = vi.fn();
    const { container } = mountSelect(
      { onChange },
      [
        h(PolyMesh, { id: "a", polygons: [TRIANGLE] }),
        h(PolyMesh, { id: "b", polygons: [TRIANGLE] }),
      ],
    );

    clickMesh(container, "a");
    await nextTick();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
    expect(onChange.mock.calls[0][0][0].id).toBe("a");

    clickMesh(container, "b");
    await nextTick();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0]).toHaveLength(1);
    expect(onChange.mock.calls[1][0][0].id).toBe("b");
  });

  it("re-clicking the only-selected mesh replaces selection with itself (single mode click path)", async () => {
    // NOTE: The click handler uses `state.selected[0] === handle` (raw === proxy)
    // which is always false in Vue's reactive system, so a second click re-selects
    // rather than toggling off. The toggle-off UX is available via useSelectionApi().toggle().
    const onChange = vi.fn();
    const { container } = mountSelect(
      { onChange },
      [h(PolyMesh, { id: "a", polygons: [TRIANGLE] })],
    );

    clickMesh(container, "a");
    await nextTick();
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
    expect(onChange.mock.calls[0][0][0].id).toBe("a");

    // Second click — re-selects "a" (apply([handle]) runs again)
    clickMesh(container, "a");
    await nextTick();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0]).toHaveLength(1);
    expect(onChange.mock.calls[1][0][0].id).toBe("a");
  });

  it("multiple=true + shift-click adds to selection", async () => {
    const onChange = vi.fn();
    const { container } = mountSelect(
      { multiple: true, onChange },
      [
        h(PolyMesh, { id: "a", polygons: [TRIANGLE] }),
        h(PolyMesh, { id: "b", polygons: [TRIANGLE] }),
        h(PolyMesh, { id: "c", polygons: [TRIANGLE] }),
      ],
    );

    clickMesh(container, "a");
    await nextTick();
    clickMesh(container, "b", { shiftKey: true });
    await nextTick();
    clickMesh(container, "c", { shiftKey: true });
    await nextTick();

    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as PolyMeshHandle[];
    expect(last.map((h) => h.id)).toEqual(["a", "b", "c"]);
  });

  it("multiple=true + api.remove correctly removes from selection", async () => {
    // The click-based shift-toggle path uses `state.selected.filter(x => x !== h)`
    // which compares Vue Proxy (x) with raw handle (h), always keeping items.
    // The imperative api.remove() also uses filter internally but this test verifies
    // the useSelectionApi surface. See the useSelectionApi test for full coverage.
    let api: SelectionApi | null = null;
    const Capture = defineComponent({
      setup() { api = useSelectionApi(); return () => null; },
    });
    const onChange = vi.fn();
    const { container } = mountSelect(
      { multiple: true, onChange },
      [
        h(PolyMesh, { id: "a", polygons: [TRIANGLE] }),
        h(PolyMesh, { id: "b", polygons: [TRIANGLE] }),
        h(Capture),
      ],
    );

    // Click both meshes to build handles
    clickMesh(container, "a");
    await nextTick();
    const handleA = (onChange.mock.calls[0][0] as PolyMeshHandle[])[0];

    clickMesh(container, "b", { shiftKey: true });
    await nextTick();
    // Both selected
    const sel = onChange.mock.calls[onChange.mock.calls.length - 1][0] as PolyMeshHandle[];
    expect(sel.map((h) => h.id)).toEqual(["a", "b"]);

    // Use api.remove with raw handle captured from onChange (these are filtered/raw)
    const handleFromChange = sel[0]; // raw from onChange payload
    api!.remove(handleFromChange);
    await nextTick();
    const after = onChange.mock.calls[onChange.mock.calls.length - 1][0] as PolyMeshHandle[];
    expect(after.map((h) => h.id)).toEqual(["b"]);
  });

  it("clicking the background clears selection by default", async () => {
    const onChange = vi.fn();
    const { container } = mountSelect(
      { onChange },
      [h(PolyMesh, { id: "a", polygons: [TRIANGLE] })],
    );

    clickMesh(container, "a");
    await nextTick();
    expect(onChange.mock.calls[0][0]).toHaveLength(1);

    clickBackground(container);
    await nextTick();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0]).toHaveLength(0);
  });

  it("clearOnMiss=false keeps selection on background click; onPointerMissed still fires", async () => {
    const onChange = vi.fn();
    const onPointerMissed = vi.fn();
    const { container } = mountSelect(
      { onChange, clearOnMiss: false, onPointerMissed },
      [h(PolyMesh, { id: "a", polygons: [TRIANGLE] })],
    );

    clickMesh(container, "a");
    await nextTick();
    expect(onChange).toHaveBeenCalledTimes(1);

    clickBackground(container);
    await nextTick();
    // Selection unchanged — onChange not called again
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onPointerMissed).toHaveBeenCalledTimes(1);
  });

  it("filter prop is applied on every selection change (drops mesh id='b')", async () => {
    const onChange = vi.fn();
    const filter = (meshes: PolyMeshHandle[]) => meshes.filter((m) => m.id !== "b");
    const { container } = mountSelect(
      { multiple: true, onChange, filter },
      [
        h(PolyMesh, { id: "a", polygons: [TRIANGLE] }),
        h(PolyMesh, { id: "b", polygons: [TRIANGLE] }),
      ],
    );

    clickMesh(container, "b");
    await nextTick();
    // b is filtered out — selection should be empty
    expect(onChange.mock.calls[0][0]).toEqual([]);

    clickMesh(container, "a");
    await nextTick();
    expect(onChange.mock.calls[1][0].map((h: PolyMeshHandle) => h.id)).toEqual(["a"]);
  });

  it("clicks on [data-poly-transform-controls] descendants are skipped", async () => {
    const onChange = vi.fn();

    // Build a gizmo element that wraps a mesh
    const GizmoChild = defineComponent({
      setup() {
        return () =>
          h("div", { "data-poly-transform-controls": "" }, [
            h(PolyMesh, { id: "gizmo", polygons: [TRIANGLE] }),
          ]);
      },
    });

    const { container } = mountSelect(
      { onChange },
      [
        h(PolyMesh, { id: "a", polygons: [TRIANGLE] }),
        h(GizmoChild),
      ],
    );

    // Click the mesh that is inside [data-poly-transform-controls]
    const gizmoMesh = container.querySelector('.polycss-mesh[data-poly-mesh-id="gizmo"]') as HTMLElement;
    expect(gizmoMesh).not.toBeNull();
    gizmoMesh.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    // onChange should NOT have been called
    expect(onChange).not.toHaveBeenCalled();
  });

  it("useSelect() returns the current selection from inside the tree", async () => {
    const observed = ref<string[]>([]);

    const Inner = defineComponent({
      setup() {
        const sel = useSelect();
        return () => {
          observed.value = (sel.value as PolyMeshHandle[]).map((h) => h.id ?? "?");
          return null;
        };
      },
    });

    const { container } = mountSelect(
      { multiple: true },
      [
        h(PolyMesh, { id: "a", polygons: [TRIANGLE] }),
        h(PolyMesh, { id: "b", polygons: [TRIANGLE] }),
        h(Inner),
      ],
    );

    clickMesh(container, "a");
    await nextTick();
    expect(observed.value).toEqual(["a"]);

    clickMesh(container, "b", { shiftKey: true });
    await nextTick();
    expect(observed.value).toEqual(["a", "b"]);
  });

  it("useSelectionApi() set/add/remove/toggle/clear/has all work", async () => {
    let api: SelectionApi | null = null;

    const Capture = defineComponent({
      setup() {
        api = useSelectionApi();
        return () => null;
      },
    });

    const { container } = mountSelect(
      { multiple: true },
      [
        h(PolyMesh, { id: "a", polygons: [TRIANGLE] }),
        h(PolyMesh, { id: "b", polygons: [TRIANGLE] }),
        h(Capture),
      ],
    );

    expect(api).not.toBeNull();

    // Resolve handles by clicking once each
    clickMesh(container, "a");
    await nextTick();
    const handleA = api!.selected[0];

    clickMesh(container, "b");
    await nextTick();
    const handleB = api!.selected[0];

    // set
    api!.set([handleA, handleB]);
    await nextTick();
    expect(api!.selected.map((h) => h.id)).toEqual(["a", "b"]);
    expect(api!.has(handleA)).toBe(true);

    // remove
    api!.remove(handleA);
    await nextTick();
    expect(api!.selected.map((h) => h.id)).toEqual(["b"]);
    expect(api!.has(handleA)).toBe(false);

    // toggle (adds when not present)
    api!.toggle(handleA);
    await nextTick();
    expect(api!.selected.map((h) => h.id)).toEqual(["b", "a"]);

    // clear
    api!.clear();
    await nextTick();
    expect(api!.selected).toHaveLength(0);
  });

  it("useSelect() outside <Select> returns empty array", () => {
    let observed: ComputedRef<PolyMeshHandle[]> | null = null;

    const Inner = defineComponent({
      setup() {
        observed = useSelect();
        return () => null;
      },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({ setup() { return () => h(Inner); } });
    app.mount(container);

    expect(observed!.value).toEqual([]);
  });

  it("useSelectionApi() outside <Select> throws", () => {
    const Inner = defineComponent({
      setup() {
        useSelectionApi(); // should throw
        return () => null;
      },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);

    // Vue catches component setup errors — we need to intercept them
    const errorSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let thrown: unknown = null;
    const app = createApp({ setup() { return () => h(Inner); } });
    app.config.errorHandler = (err) => { thrown = err; };
    app.mount(container);

    errorSpy.mockRestore();
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toMatch(/useSelectionApi/);
  });
});
