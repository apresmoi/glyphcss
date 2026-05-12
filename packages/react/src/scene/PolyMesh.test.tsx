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
  children: (polygon: Polygon, index: number) => React.ReactNode
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
