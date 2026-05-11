import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ParseResult, Polygon } from "@layoutit/polycss-core";
import { createPolyScene, type PolySceneHandle, type PolyMeshHandle } from "./createPolyScene";
import { createSelect, type PolySelectionHandle } from "./createSelect";

const TRIANGLE: Polygon = {
  vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  color: "#fff",
};

function parseResult(polygons: Polygon[] = [TRIANGLE]): ParseResult {
  return { polygons, objectUrls: [], warnings: [], dispose: () => {} };
}

function clickMesh(host: HTMLElement, id: string, init: MouseEventInit = {}): void {
  const mesh = host.querySelector(`.polycss-mesh[data-poly-mesh-id="${id}"]`) as HTMLElement;
  expect(mesh, `expected mesh #${id}`).not.toBeNull();
  mesh.dispatchEvent(new MouseEvent("click", { bubbles: true, ...init }));
}

function clickHost(host: HTMLElement): void {
  host.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 0, clientY: 0 }));
}

describe("createSelect", () => {
  let host: HTMLElement;
  let scene: PolySceneHandle;
  let sel: PolySelectionHandle | null = null;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    scene = createPolyScene(host);
  });
  afterEach(() => {
    sel?.destroy();
    sel = null;
    scene.destroy();
    if (host.parentNode) host.parentNode.removeChild(host);
  });

  it("clicking a mesh selects it (single mode replaces)", () => {
    scene.add(parseResult(), { id: "a" });
    scene.add(parseResult(), { id: "b" });
    const onChange = vi.fn();
    sel = createSelect(scene, { onChange });

    clickMesh(host, "a");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
    expect(onChange.mock.calls[0][0][0].id).toBe("a");

    clickMesh(host, "b");
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0][0].id).toBe("b");
  });

  it("re-clicking the only-selected mesh toggles it off (single mode)", () => {
    scene.add(parseResult(), { id: "a" });
    const onChange = vi.fn();
    sel = createSelect(scene, { onChange });

    clickMesh(host, "a");
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
    clickMesh(host, "a");
    expect(onChange.mock.calls[1][0]).toEqual([]);
  });

  it("multiple + shift-click adds; shift-click again removes", () => {
    scene.add(parseResult(), { id: "a" });
    scene.add(parseResult(), { id: "b" });
    scene.add(parseResult(), { id: "c" });
    const onChange = vi.fn();
    sel = createSelect(scene, { multiple: true, onChange });

    clickMesh(host, "a");
    clickMesh(host, "b", { shiftKey: true });
    clickMesh(host, "c", { shiftKey: true });
    let last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last.map((m: PolyMeshHandle) => m.id)).toEqual(["a", "b", "c"]);

    clickMesh(host, "b", { shiftKey: true });
    last = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(last.map((m: PolyMeshHandle) => m.id)).toEqual(["a", "c"]);
  });

  it("background click clears selection by default (clearOnMiss=true)", () => {
    scene.add(parseResult(), { id: "a" });
    const onChange = vi.fn();
    sel = createSelect(scene, { onChange });

    clickMesh(host, "a");
    expect(onChange.mock.calls[0][0]).toHaveLength(1);
    clickHost(host);
    expect(onChange.mock.calls[1][0]).toEqual([]);
  });

  it("clearOnMiss=false keeps selection on background click", () => {
    scene.add(parseResult(), { id: "a" });
    const onChange = vi.fn();
    const onPointerMissed = vi.fn();
    sel = createSelect(scene, { clearOnMiss: false, onChange, onPointerMissed });

    clickMesh(host, "a");
    clickHost(host);
    expect(onChange).toHaveBeenCalledTimes(1); // selection unchanged
    expect(onPointerMissed).toHaveBeenCalledTimes(1);
  });

  it("filter is applied on every selection change", () => {
    scene.add(parseResult(), { id: "a" });
    scene.add(parseResult(), { id: "b" });
    const onChange = vi.fn();
    // Drop meshes named "b".
    sel = createSelect(scene, {
      multiple: true,
      filter: (meshes) => meshes.filter((m) => m.id !== "b"),
      onChange,
    });

    clickMesh(host, "b");
    expect(onChange.mock.calls[0][0]).toEqual([]);
    clickMesh(host, "a");
    expect(onChange.mock.calls[1][0].map((m: PolyMeshHandle) => m.id)).toEqual(["a"]);
  });

  it("skips meshes tagged as transform-controls gizmo content", () => {
    const meshA = scene.add(parseResult(), { id: "a" });
    // Tag the mesh wrapper with the shared gizmo class — createSelect
    // skips these during both the bubbled-target check (.closest)
    // and the JS bbox fallback (classList.contains).
    meshA.element.classList.add("polycss-transform-gizmo");

    const onChange = vi.fn();
    sel = createSelect(scene, { onChange });
    clickMesh(host, "a");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("imperative api: set / add / remove / toggle / clear / has", () => {
    const a = scene.add(parseResult(), { id: "a" });
    const b = scene.add(parseResult(), { id: "b" });
    const onChange = vi.fn();
    sel = createSelect(scene, { multiple: true, onChange });

    sel.set([a, b]);
    expect(sel.selected.map((m) => m.id)).toEqual(["a", "b"]);
    expect(sel.has(a)).toBe(true);

    sel.remove(a);
    expect(sel.selected.map((m) => m.id)).toEqual(["b"]);

    sel.toggle(a);
    expect(sel.selected.map((m) => m.id)).toEqual(["b", "a"]);

    sel.toggle(a);
    expect(sel.selected.map((m) => m.id)).toEqual(["b"]);

    sel.add(a);
    expect(sel.selected.map((m) => m.id)).toEqual(["b", "a"]);

    sel.clear();
    expect(sel.selected).toEqual([]);
  });

  it("destroy removes the host listener", () => {
    scene.add(parseResult(), { id: "a" });
    const onChange = vi.fn();
    sel = createSelect(scene, { onChange });
    sel.destroy();
    sel = null;
    clickMesh(host, "a");
    expect(onChange).not.toHaveBeenCalled();
  });
});
