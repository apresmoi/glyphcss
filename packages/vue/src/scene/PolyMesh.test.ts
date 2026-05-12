import { describe, it, expect, vi, afterEach } from "vitest";
import { createApp, h, nextTick } from "vue";
import type { VNode } from "vue";
import { PolyCamera } from "../camera/PolyCamera";
import { PolyScene } from "./PolyScene";
import { PolyMesh } from "./PolyMesh";
import type { Polygon } from "@layoutit/polycss-core";

const TRIANGLE: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

const TEXTURED_TRIANGLE: Polygon = {
  vertices: TRIANGLE.vertices,
  texture: "https://example.com/tex.png",
  uvs: [[0, 0], [1, 0], [0, 1]],
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

function renderMesh(
  meshProps: Record<string, unknown> = {},
  slots: Record<string, () => VNode | VNode[]> = {}
): { container: HTMLElement; app: ReturnType<typeof createApp> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const app = createApp({
    setup() {
      return () =>
        h(PolyCamera, {}, {
          default: () =>
            h(PolyScene, {}, {
              default: () => h(PolyMesh, meshProps, slots),
            }),
        });
    },
  });
  app.mount(container);
  return { container, app };
}

describe("PolyMesh (Vue) — with polygons prop", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("renders a .polycss-mesh wrapper", () => {
    const { container } = renderMesh({ polygons: [TRIANGLE] });
    const mesh = container.querySelector(".polycss-mesh");
    expect(mesh).toBeTruthy();
  });

  it("renders polygon leaf elements for each polygon", () => {
    const { container } = renderMesh({ polygons: [TRIANGLE, QUAD] });
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(2);
  });

  it("renders textured polygons as polygon s elements", () => {
    const { container } = renderMesh({ polygons: [TEXTURED_TRIANGLE] });
    const poly = container.querySelector("s");
    expect(poly).toBeTruthy();
    expect(poly?.tagName.toLowerCase()).toBe("s");
  });

  it("renders no poly elements for empty polygons", () => {
    const { container } = renderMesh({ polygons: [] });
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(0);
  });

  it("mesh wrapper leaves position to base CSS", () => {
    const { container } = renderMesh({ polygons: [TRIANGLE] });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.position).toBe("");
  });

  it("mesh wrapper leaves transformStyle to base CSS", () => {
    const { container } = renderMesh({ polygons: [TRIANGLE] });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.transformStyle).toBe("");
  });

  it("applies custom class to mesh wrapper", () => {
    const { container } = renderMesh({ polygons: [TRIANGLE], class: "my-mesh" });
    const mesh = container.querySelector(".polycss-mesh");
    expect(mesh?.classList.contains("my-mesh")).toBe(true);
  });
});

describe("PolyMesh (Vue) — transform props", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("applies translate3d from position prop", () => {
    const { container } = renderMesh({
      polygons: [TRIANGLE],
      position: [10, 20, 30],
    });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.transform).toContain("translate3d(10px, 20px, 30px)");
  });

  it("applies scale3d from scalar scale", () => {
    const { container } = renderMesh({
      polygons: [TRIANGLE],
      scale: 2,
    });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.transform).toContain("scale3d(2, 2, 2)");
  });

  it("does not add scale3d for scale=1", () => {
    const { container } = renderMesh({
      polygons: [TRIANGLE],
      scale: 1,
    });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.transform ?? "").not.toContain("scale3d");
  });

  it("applies Vec3 scale", () => {
    const { container } = renderMesh({
      polygons: [TRIANGLE],
      scale: [1, 2, 3],
    });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.transform).toContain("scale3d(1, 2, 3)");
  });

  it("applies rotateX from rotation[0]", () => {
    const { container } = renderMesh({
      polygons: [TRIANGLE],
      rotation: [45, 0, 0],
    });
    const mesh = container.querySelector(".polycss-mesh") as HTMLElement;
    expect(mesh.style.transform).toContain("rotateX(45deg)");
  });
});

describe("PolyMesh (Vue) — autoCenter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("autoCenter=true still renders polygons (vertices recentered)", () => {
    const { container } = renderMesh({ polygons: [QUAD], autoCenter: true });
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(1);
  });

  it("autoCenter=false renders polygons unmodified", () => {
    const { container } = renderMesh({ polygons: [QUAD], autoCenter: false });
    const polys = container.querySelectorAll("i,b,s,u");
    expect(polys.length).toBe(1);
  });
});

describe("PolyMesh (Vue) — scoped slot 'polygon'", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("calls the polygon scoped slot for each polygon", () => {
    const calls: Array<{ polygon: Polygon; index: number }> = [];
    renderMesh(
      { polygons: [TRIANGLE, QUAD] },
      {
        polygon: ({ polygon, index }: { polygon: Polygon; index: number }) => {
          calls.push({ polygon, index });
          return h("div", { class: "slot-polygon", "data-index": index });
        },
      }
    );
    // Vue may call the slot function multiple times (render calls); use unique indices
    const uniqueIndices = [...new Set(calls.map((c) => c.index))];
    expect(uniqueIndices).toContain(0);
    expect(uniqueIndices).toContain(1);
  });

  it("slot polygon receives the polygon object with vertices and color", () => {
    const received: Polygon[] = [];
    renderMesh(
      { polygons: [TRIANGLE] },
      {
        polygon: ({ polygon }: { polygon: Polygon }) => {
          received.push(polygon);
          return h("div");
        },
      }
    );
    expect(received.length).toBeGreaterThan(0);
    expect(received[0].color).toBe("#ff0000");
    expect(received[0].vertices.length).toBe(3);
  });

  it("slot polygon has index 0 for first polygon", () => {
    const indices: number[] = [];
    renderMesh(
      { polygons: [TRIANGLE] },
      {
        polygon: ({ index }: { index: number }) => {
          indices.push(index);
          return h("div");
        },
      }
    );
    expect(indices).toContain(0);
  });
});

describe("PolyMesh (Vue) — loading and error states", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("renders loading state (polycss-mesh-loading) when src fetch is pending", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); // never resolves
    const { container } = renderMesh(
      { src: "https://example.com/mesh.obj" },
      {
        fallback: () => h("div", { class: "loading-slot" }, "loading…"),
      }
    );

    const meshLoading = container.querySelector(".polycss-mesh-loading");
    expect(meshLoading).toBeTruthy();
    const slot = container.querySelector(".loading-slot");
    expect(slot).toBeTruthy();
  });

  it("renders error state when fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve(""),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }));

    const { container } = renderMesh(
      { src: "https://example.com/missing.obj" },
      {
        error: ({ error }: { error: Error }) =>
          h("div", { class: "error-slot" }, error.message),
      }
    );

    await nextTick();
    await new Promise((r) => setTimeout(r, 100));
    await nextTick();

    const meshError = container.querySelector(".polycss-mesh-error");
    expect(meshError).toBeTruthy();
    const errorSlot = container.querySelector(".error-slot");
    expect(errorSlot).toBeTruthy();
  });

  it("renders loading state without a fallback slot (graceful)", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { container } = renderMesh({ src: "https://example.com/mesh.obj" });
    const meshLoading = container.querySelector(".polycss-mesh-loading");
    expect(meshLoading).toBeTruthy();
  });

  it("renders error state without error slot (graceful)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve(""),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
    }));

    const { container } = renderMesh({ src: "https://example.com/mesh.obj" });

    await nextTick();
    await new Promise((r) => setTimeout(r, 100));
    await nextTick();

    const meshError = container.querySelector(".polycss-mesh-error");
    expect(meshError).toBeTruthy();
  });
});
