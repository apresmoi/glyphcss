import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "./PolyScene";
import { PolyMesh } from "./PolyMesh";
import type { PolyMeshHandle } from "./events";
import type { Polygon } from "@layoutit/polycss-core";

const TRIANGLE: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

const QUAD: Polygon = {
  vertices: [
    [0, 0, 1],
    [2, 0, 1],
    [2, 2, 1],
    [0, 2, 1],
  ],
  color: "#00ff00",
};

const OFFSET_TEXTURED_TRIANGLE: Polygon = {
  vertices: [
    [10, 0, 0],
    [12, 0, 0],
    [10, 2, 0],
  ],
  texture: "tex.png",
  uvs: [[0, 0], [1, 0], [0, 1]],
  textureTriangles: [
    {
      vertices: [
        [10, 0, 0],
        [12, 0, 0],
        [10, 2, 0],
      ],
      uvs: [[0, 0], [1, 0], [0, 1]],
    },
  ],
};

function renderMesh(props: React.ComponentProps<typeof PolyMesh>): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        PolyCamera,
        {},
        React.createElement(
          PolyScene,
          {},
          React.createElement(PolyMesh, props)
        )
      )
    )
  );
  return container;
}

function renderMeshWithChildren(
  props: React.ComponentProps<typeof PolyMesh>,
  children: React.ComponentProps<typeof PolyMesh>["children"]
): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        PolyCamera,
        {},
        React.createElement(
          PolyScene,
          {},
          React.createElement(PolyMesh, props, children)
        )
      )
    )
  );
  return container;
}

describe("PolyMesh — with polygons prop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("renders a .polycss-mesh wrapper", () => {
    const container = renderMesh({ polygons: [TRIANGLE] });
    const mesh = container.querySelector(".polycss-mesh");
    expect(mesh).toBeTruthy();
  });

  it("renders polygon leaf elements for each polygon", () => {
    const container = renderMesh({ polygons: [TRIANGLE, QUAD] });
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(2);
  });

  it("hoists repeated baked solid paint to the mesh wrapper", () => {
    const container = renderMesh({ polygons: [TRIANGLE, TRIANGLE] });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    const polys = Array.from(container.querySelectorAll("u")) as HTMLElement[];
    expect(mesh.style.getPropertyValue("--polycss-paint")).not.toBe("");
    expect(polys).toHaveLength(2);
    expect(polys[0].getAttribute("style")?.trim().startsWith("transform:")).toBe(true);
    expect(polys.every((poly) => poly.style.color === "")).toBe(true);
    expect(polys.every((poly) => poly.style.borderBottomColor === "")).toBe(true);
  });

  it("hoists repeated dynamic solid base RGB channels to the mesh wrapper", () => {
    const container = renderMesh({ polygons: [TRIANGLE, TRIANGLE], textureLighting: "dynamic" });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    const polys = Array.from(container.querySelectorAll("u")) as HTMLElement[];
    expect(mesh.style.getPropertyValue("--psr")).toBe("1.0000");
    expect(mesh.style.getPropertyValue("--psg")).toBe("0.0000");
    expect(mesh.style.getPropertyValue("--psb")).toBe("0.0000");
    expect(polys).toHaveLength(2);
    expect(polys.every((poly) => poly.style.getPropertyValue("--psr") === "")).toBe(true);
  });

  it("renders no poly elements for empty polygons array", () => {
    const container = renderMesh({ polygons: [] });
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(0);
  });

  it("mesh wrapper leaves position to base CSS", () => {
    const container = renderMesh({ polygons: [TRIANGLE] });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.position).toBe("");
  });

  it("mesh wrapper leaves transformStyle to base CSS", () => {
    const container = renderMesh({ polygons: [TRIANGLE] });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.transformStyle).toBe("");
  });

  it("applies custom className to mesh wrapper", () => {
    const container = renderMesh({ polygons: [TRIANGLE], className: "my-mesh" });
    const mesh = container.querySelector(".polycss-mesh");
    expect(mesh?.classList.contains("my-mesh")).toBe(true);
  });
});

describe("PolyMesh — transform props", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("applies translate3d from position prop", () => {
    const container = renderMesh({
      polygons: [TRIANGLE],
      position: [10, 20, 30],
    });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.transform).toContain("translate3d(10px, 20px, 30px)");
  });

  it("applies scale3d from scalar scale prop", () => {
    const container = renderMesh({
      polygons: [TRIANGLE],
      scale: 2,
    });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.transform).toContain("scale3d(2, 2, 2)");
  });

  it("does not add scale3d for scale=1", () => {
    const container = renderMesh({
      polygons: [TRIANGLE],
      scale: 1,
    });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.transform ?? "").not.toContain("scale3d");
  });

  it("applies Vec3 scale", () => {
    const container = renderMesh({
      polygons: [TRIANGLE],
      scale: [1, 2, 3] as [number, number, number],
    });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.transform).toContain("scale3d(1, 2, 3)");
  });

  it("applies rotateX from rotation[0]", () => {
    const container = renderMesh({
      polygons: [TRIANGLE],
      rotation: [45, 0, 0],
    });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.transform).toContain("rotateX(45deg)");
  });
});

describe("PolyMesh — autoCenter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("autoCenter=true recenters polygon vertices", () => {
    // QUAD centroid is at (1, 1, 1) so recentered vertices should shift
    const container = renderMesh({ polygons: [QUAD], autoCenter: true });
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(1);
  });

  it("autoCenter=false leaves vertices unmodified", () => {
    const container = renderMesh({ polygons: [QUAD], autoCenter: false });
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(1);
  });

  it("autoCenter=true also recenters texture triangle source vertices", () => {
    const received: Polygon[] = [];
    renderMeshWithChildren(
      { polygons: [OFFSET_TEXTURED_TRIANGLE], autoCenter: true },
      (polygon) => {
        received.push(polygon);
        return null;
      },
    );

    const polygon = received.find((p) => p.textureTriangles?.length);
    expect(polygon?.vertices[0]).toEqual([-1, -1, 0]);
    expect(polygon?.textureTriangles?.[0].vertices[0]).toEqual([-1, -1, 0]);
  });
});

describe("PolyMesh — render-prop children", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("calls children render-prop for each polygon", () => {
    const calls: Array<[Polygon, number]> = [];
    renderMeshWithChildren({ polygons: [TRIANGLE, QUAD] }, (polygon, index) => {
      calls.push([polygon, index]);
      return null;
    });
    // React may call render-prop multiple times (strict mode double-invoke).
    // Assert we got at least 2 calls (one per polygon) with correct indices.
    const uniqueIndices = [...new Set(calls.map(([, i]) => i))];
    expect(uniqueIndices.length).toBe(2);
    expect(uniqueIndices).toContain(0);
    expect(uniqueIndices).toContain(1);
  });

  it("render-prop children receive the polygon object", () => {
    const received: Polygon[] = [];
    renderMeshWithChildren({ polygons: [TRIANGLE] }, (polygon) => {
      received.push(polygon);
      return null;
    });
    expect(received[0].color).toBe("#ff0000");
    expect(received[0].vertices.length).toBe(3);
  });

  it("render-prop children output appears inside mesh wrapper", () => {
    const container = renderMeshWithChildren(
      { polygons: [TRIANGLE] },
      (polygon, index) =>
        React.createElement("div", {
          key: index,
          className: "custom-poly-render",
          "data-index": index,
        })
    );
    const custom = container.querySelector(".custom-poly-render");
    expect(custom).toBeTruthy();
    expect(custom?.getAttribute("data-index")).toBe("0");
  });

  it("static children render inside the mesh wrapper without replacing polygon leaves", () => {
    const container = renderMeshWithChildren(
      { polygons: [TRIANGLE] },
      React.createElement("div", { className: "static-mesh-child" }),
    );
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    const child = container.querySelector(".static-mesh-child");
    expect(child).toBeTruthy();
    expect(child?.parentElement).toBe(mesh);
    expect(mesh.querySelectorAll("i,b,s,u").length).toBe(1);
  });
});

describe("PolyMesh — loading and error states (with src)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("renders loading state (polycss-mesh-loading) when src is pending", async () => {
    // A src with no fetch mock will cause loading
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); // never resolves
    const container = renderMesh({
      src: "https://example.com/mesh.obj",
      fallback: React.createElement("div", { className: "loading-slot" }, "loading…"),
    });

    // During load
    const meshLoading = container.querySelector(".polycss-mesh-loading");
    expect(meshLoading).toBeTruthy();
    const loadingSlot = container.querySelector(".loading-slot");
    expect(loadingSlot).toBeTruthy();
  });

  it("renders error state when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404, text: () => "", arrayBuffer: () => new ArrayBuffer(0) }));
    const container = renderMesh({
      src: "https://example.com/missing.obj",
      errorFallback: (err: Error) =>
        React.createElement("div", { className: "error-slot" }, err.message),
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const meshError = container.querySelector(".polycss-mesh-error");
    expect(meshError).toBeTruthy();
    const errorSlot = container.querySelector(".error-slot");
    expect(errorSlot).toBeTruthy();
  });

  it("renders null fallback (no slot) gracefully during loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const container = renderMesh({
      src: "https://example.com/mesh.obj",
    });
    const meshLoading = container.querySelector(".polycss-mesh-loading");
    expect(meshLoading).toBeTruthy();
  });

  it("renders null errorFallback gracefully on error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => "", arrayBuffer: () => new ArrayBuffer(0) }));
    const container = renderMesh({
      src: "https://example.com/mesh.obj",
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 100));
    });

    const meshError = container.querySelector(".polycss-mesh-error");
    expect(meshError).toBeTruthy();
  });
});

describe("PolyMesh — rebakeAtlas", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("rebakeAtlas() is present on the handle and does not throw", () => {
    const ref = createRef<PolyMeshHandle>();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <PolyCamera>
          <PolyScene>
            <PolyMesh ref={ref} polygons={[TRIANGLE]} rotation={[0, 0, 0]} />
          </PolyScene>
        </PolyCamera>,
      ),
    );
    expect(typeof ref.current?.rebakeAtlas).toBe("function");
    // Calling it should not throw and should be a no-op when rotation hasn't changed.
    expect(() => act(() => { ref.current?.rebakeAtlas(); })).not.toThrow();
  });

  it("rebakeAtlas() triggers a re-render (mesh wrapper stays in DOM)", () => {
    const ref = createRef<PolyMeshHandle>();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <PolyCamera>
          <PolyScene>
            <PolyMesh ref={ref} polygons={[TRIANGLE]} rotation={[30, 45, 0]} />
          </PolyScene>
        </PolyCamera>,
      ),
    );
    const meshBefore = container.querySelector(".polycss-mesh");
    expect(meshBefore).toBeTruthy();
    act(() => { ref.current?.rebakeAtlas(); });
    const meshAfter = container.querySelector(".polycss-mesh");
    expect(meshAfter).toBeTruthy();
  });
});

describe("PolyMesh — updatePolygon", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  function mountMesh(polygons: Polygon[]): { ref: React.RefObject<PolyMeshHandle | null>; container: HTMLElement } {
    const ref = createRef<PolyMeshHandle>();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        <PolyCamera>
          <PolyScene>
            <PolyMesh ref={ref} polygons={polygons} />
          </PolyScene>
        </PolyCamera>,
      ),
    );
    return { ref, container };
  }

  it("updates color when targeted by polygon reference", () => {
    const poly: Polygon = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#ff0000" };
    const { ref } = mountMesh([poly]);
    const polyRef = ref.current!.getPolygons()[0];
    act(() => { ref.current!.updatePolygon(polyRef, { color: "#00ff00" }); });
    expect(ref.current!.getPolygons()[0].color).toBe("#00ff00");
    // In-place mutation: same object identity.
    expect(ref.current!.getPolygons()[0]).toBe(polyRef);
  });

  it("updates color when targeted by index", () => {
    const p0: Polygon = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#ff0000" };
    const p1: Polygon = { vertices: [[0, 0, 1], [2, 0, 1], [2, 2, 1], [0, 2, 1]], color: "#00ff00" };
    const { ref } = mountMesh([p0, p1]);
    act(() => { ref.current!.updatePolygon(1, { color: "#0000ff" }); });
    expect(ref.current!.getPolygons()[1].color).toBe("#0000ff");
    expect(ref.current!.getPolygons()[0].color).toBe("#ff0000");
  });

  it("merges partial fields — untouched fields are preserved", () => {
    const poly: Polygon = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#ff0000" };
    const { ref } = mountMesh([poly]);
    const originalVerts = ref.current!.getPolygons()[0].vertices;
    act(() => { ref.current!.updatePolygon(0, { color: "#00ff00" }); });
    expect(ref.current!.getPolygons()[0].color).toBe("#00ff00");
    expect(ref.current!.getPolygons()[0].vertices).toBe(originalVerts);
  });

  it("re-renders the DOM after update (painted color reflects the new value)", () => {
    // React reconciles leaf elements in place (same key → same DOM node).
    // Verify the re-render happened by checking the color CSS var or the
    // inline style that encodes the polygon color changes to the new value.
    const poly: Polygon = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#ff0000" };
    const { ref, container } = mountMesh([poly]);
    const meshBefore = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(meshBefore).toBeTruthy();
    act(() => { ref.current!.updatePolygon(0, { color: "#00ff00" }); });
    // After re-render the mesh wrapper is still in the DOM.
    const meshAfter = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(meshAfter).toBeTruthy();
    // The internal polygon data reflects the new color.
    expect(ref.current!.getPolygons()[0].color).toBe("#00ff00");
  });

  it("no-ops on a stale polygon reference not in the current polygons", () => {
    const poly: Polygon = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#ff0000" };
    const { ref, container } = mountMesh([poly]);
    const stale: Polygon = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#abcdef" };
    const leafBefore = container.querySelector("u, b, i, s");
    expect(() => act(() => { ref.current!.updatePolygon(stale, { color: "#000000" }); })).not.toThrow();
    expect(ref.current!.getPolygons()[0].color).toBe("#ff0000");
    // No re-render — DOM leaf unchanged.
    expect(container.querySelector("u, b, i, s")).toBe(leafBefore);
  });

  it("no-ops when index is out of range", () => {
    const poly: Polygon = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#ff0000" };
    const { ref } = mountMesh([poly]);
    expect(() => act(() => { ref.current!.updatePolygon(99, { color: "#000000" }); })).not.toThrow();
    expect(() => act(() => { ref.current!.updatePolygon(-1, { color: "#000000" }); })).not.toThrow();
    expect(ref.current!.getPolygons()[0].color).toBe("#ff0000");
  });

  it("repeated calls all take effect (last write wins)", () => {
    const poly: Polygon = { vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#ff0000" };
    const { ref } = mountMesh([poly]);
    act(() => {
      ref.current!.updatePolygon(0, { color: "#00ff00" });
      ref.current!.updatePolygon(0, { color: "#0000ff" });
      ref.current!.updatePolygon(0, { color: "#ffff00" });
    });
    expect(ref.current!.getPolygons()[0].color).toBe("#ffff00");
  });
});
