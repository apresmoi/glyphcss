/**
 * <poly-mesh> custom element tests — locates the nearest <poly-scene>,
 * fetches & parses src, registers polygons via scene.add(), fires
 * polycss:loaded and polycss:error, cleans up on disconnect.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Polygon } from "@layoutit/polycss-core";
import { PolyMeshElement } from "./PolyMeshElement";
import { PolySceneElement } from "./PolySceneElement";

beforeAll(() => {
  if (!customElements.get("poly-scene")) {
    customElements.define("poly-scene", PolySceneElement);
  }
  if (!customElements.get("poly-mesh")) {
    customElements.define("poly-mesh", PolyMeshElement);
  }
});

// Simple OBJ fixture: one triangle. parseObj picks this up.
const TRIANGLE_OBJ = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
const TEXTURED_QUAD_OBJ = [
  "v 0 0 0",
  "v 1 0 0",
  "v 1 1 0",
  "v 0 1 0",
  "vt 0 0",
  "vt 1 0",
  "vt 1 1",
  "vt 0 1",
  "usemtl Swatch",
  "f 1/1 2/2 3/3 4/4",
  "",
].join("\n");
const TEXTURED_QUAD_MTL = "newmtl Swatch\nmap_Kd swatch.png\n";

function mockFetch(text: string, ok = true): typeof globalThis.fetch {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 404,
    text: async () => text,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  })) as unknown as typeof globalThis.fetch;
}

describe("PolyMeshElement", () => {
  let host: HTMLElement;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
  });

  afterEach(() => {
    if (host.parentNode) host.parentNode.removeChild(host);
    globalThis.fetch = originalFetch;
  });

  describe("registration", () => {
    it("is registered as <poly-mesh>", () => {
      expect(customElements.get("poly-mesh")).toBe(PolyMeshElement);
    });

    it("includes the documented observed attributes", () => {
      const observed = PolyMeshElement.observedAttributes;
      expect(observed).toContain("src");
      expect(observed).toContain("position");
      expect(observed).toContain("scale");
      expect(observed).toContain("rotation");
      expect(observed).toContain("auto-center");
    });
  });

  describe("ancestor lookup", () => {
    it("finds the nearest <poly-scene> ancestor and registers a mesh", async () => {
      globalThis.fetch = mockFetch(TRIANGLE_OBJ);
      const scene = document.createElement("poly-scene") as PolySceneElement;
      const mesh = document.createElement("poly-mesh") as PolyMeshElement;
      mesh.setAttribute("src", "tri.obj");
      scene.appendChild(mesh);
      host.appendChild(scene);

      // Wait for the async load
      await vi.waitFor(() => {
        expect(scene.querySelectorAll("i,b,s,u").length).toBeGreaterThan(0);
      });
    });

    it("noop when no <poly-scene> ancestor exists", async () => {
      globalThis.fetch = mockFetch(TRIANGLE_OBJ);
      const mesh = document.createElement("poly-mesh") as PolyMeshElement;
      mesh.setAttribute("src", "tri.obj");
      host.appendChild(mesh);
      // Just verify no throw — give some time for the async load to settle.
      await new Promise((r) => setTimeout(r, 10));
      expect(host.querySelector("i,b,s,u")).toBeNull();
    });

    it("noop when src is missing", async () => {
      const scene = document.createElement("poly-scene") as PolySceneElement;
      const mesh = document.createElement("poly-mesh") as PolyMeshElement;
      scene.appendChild(mesh);
      host.appendChild(scene);
      await new Promise((r) => setTimeout(r, 10));
      expect(scene.querySelector("i,b,s,u")).toBeNull();
    });
  });

  describe("events", () => {
    it("fires polycss:loaded with polygon list on success", async () => {
      globalThis.fetch = mockFetch(TRIANGLE_OBJ);
      const scene = document.createElement("poly-scene") as PolySceneElement;
      const mesh = document.createElement("poly-mesh") as PolyMeshElement;
      mesh.setAttribute("src", "tri.obj");

      let loadedDetail: { polygons: unknown[] } | null = null;
      mesh.addEventListener("polycss:loaded", (e: Event) => {
        loadedDetail = (e as CustomEvent).detail as { polygons: unknown[] };
      });

      scene.appendChild(mesh);
      host.appendChild(scene);

      await vi.waitFor(() => {
        expect(loadedDetail).not.toBeNull();
      });
      expect(loadedDetail!.polygons.length).toBeGreaterThan(0);
    });

    it("auto-center keeps texture triangle vertices aligned with recentered polygons", async () => {
      globalThis.fetch = vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        text: async () => url.endsWith(".mtl") ? TEXTURED_QUAD_MTL : TEXTURED_QUAD_OBJ,
        arrayBuffer: async () => new ArrayBuffer(0),
      })) as unknown as typeof globalThis.fetch;

      const OriginalImage = globalThis.Image;
      globalThis.Image = class MockImage {
        decoding = "";
        naturalWidth = 0;
        naturalHeight = 0;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          queueMicrotask(() => this.onerror?.());
        }
      } as unknown as typeof Image;

      try {
        const scene = document.createElement("poly-scene") as PolySceneElement;
        const mesh = document.createElement("poly-mesh") as PolyMeshElement;
        mesh.setAttribute("src", "house.obj");
        mesh.setAttribute("mtl", "house.mtl");
        mesh.setAttribute("auto-center", "");

        let loadedDetail: { polygons: Polygon[] } | null = null;
        mesh.addEventListener("polycss:loaded", (e: Event) => {
          loadedDetail = (e as CustomEvent).detail as { polygons: Polygon[] };
        });

        scene.appendChild(mesh);
        host.appendChild(scene);

        await vi.waitFor(() => {
          expect(loadedDetail).not.toBeNull();
        });

        const polygon = loadedDetail!.polygons.find((p) => p.textureTriangles?.length);
        expect(polygon).toBeDefined();
        const polygonYs = polygon!.vertices.map((v) => v[1]);
        const triangleYs = polygon!.textureTriangles!.flatMap((triangle) =>
          triangle.vertices.map((v) => v[1])
        );
        expect(Math.min(...triangleYs)).toBeCloseTo(Math.min(...polygonYs), 6);
        expect(Math.max(...triangleYs)).toBeCloseTo(Math.max(...polygonYs), 6);
      } finally {
        globalThis.Image = OriginalImage;
      }
    });

    it("fires polycss:error when fetch fails", async () => {
      globalThis.fetch = vi.fn(async () => {
        throw new Error("network failure");
      }) as unknown as typeof globalThis.fetch;

      const scene = document.createElement("poly-scene") as PolySceneElement;
      const mesh = document.createElement("poly-mesh") as PolyMeshElement;
      mesh.setAttribute("src", "tri.obj");

      let errored = false;
      mesh.addEventListener("polycss:error", () => {
        errored = true;
      });
      scene.appendChild(mesh);
      host.appendChild(scene);

      await vi.waitFor(() => {
        expect(errored).toBe(true);
      });
    });
  });

  describe("disconnect cleanup", () => {
    it("removes the mesh from the scene on disconnect", async () => {
      globalThis.fetch = mockFetch(TRIANGLE_OBJ);
      const scene = document.createElement("poly-scene") as PolySceneElement;
      const mesh = document.createElement("poly-mesh") as PolyMeshElement;
      mesh.setAttribute("src", "tri.obj");
      scene.appendChild(mesh);
      host.appendChild(scene);

      await vi.waitFor(() => {
        expect(scene.querySelectorAll("i,b,s,u").length).toBeGreaterThan(0);
      });

      scene.removeChild(mesh);
      // After disconnect the mesh wrapper should be gone.
      expect(scene.querySelectorAll(".polycss-mesh").length).toBe(0);
    });
  });

  describe("attribute changes", () => {
    it("re-loads on src change", async () => {
      let fetchedUrls: string[] = [];
      globalThis.fetch = vi.fn(async (url: string) => {
        fetchedUrls.push(url);
        return {
          ok: true,
          status: 200,
          text: async () => TRIANGLE_OBJ,
          arrayBuffer: async () =>
            new TextEncoder().encode(TRIANGLE_OBJ).buffer,
        };
      }) as unknown as typeof globalThis.fetch;

      const scene = document.createElement("poly-scene") as PolySceneElement;
      const mesh = document.createElement("poly-mesh") as PolyMeshElement;
      mesh.setAttribute("src", "tri-a.obj");
      scene.appendChild(mesh);
      host.appendChild(scene);

      await vi.waitFor(() => {
        expect(fetchedUrls).toContain("tri-a.obj");
      });

      mesh.setAttribute("src", "tri-b.obj");
      await vi.waitFor(() => {
        expect(fetchedUrls).toContain("tri-b.obj");
      });
    });

    it("noop for transform attribute changes when not yet loaded", () => {
      const mesh = document.createElement("poly-mesh") as PolyMeshElement;
      // Not connected; calling attributeChangedCallback shouldn't throw.
      expect(() =>
        mesh.attributeChangedCallback("position", null, "1,2,3"),
      ).not.toThrow();
    });

    it("noop when oldValue === newValue", () => {
      const mesh = document.createElement("poly-mesh") as PolyMeshElement;
      expect(() =>
        mesh.attributeChangedCallback("src", "x.obj", "x.obj"),
      ).not.toThrow();
    });
  });

  describe("auto-center", () => {
    it("recenters polygons when auto-center is set", async () => {
      globalThis.fetch = mockFetch(TRIANGLE_OBJ);
      const scene = document.createElement("poly-scene") as PolySceneElement;
      const mesh = document.createElement("poly-mesh") as PolyMeshElement;
      mesh.setAttribute("src", "tri.obj");
      mesh.setAttribute("auto-center", "");
      scene.appendChild(mesh);
      host.appendChild(scene);

      await vi.waitFor(() => {
        expect(scene.querySelectorAll("i,b,s,u").length).toBeGreaterThan(0);
      });
    });
  });
});
