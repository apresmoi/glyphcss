import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref, nextTick } from "vue";
import { createApp, h } from "vue";
import { usePolyMesh } from "./useMesh";
import type { UseMeshResult } from "./useMesh";

// Minimal OBJ with one triangle
const MINIMAL_OBJ = `
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
`.trim();

function mockFetchSuccess(text: string) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: () => Promise.resolve(text),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  }));
}

function mockFetchFailure(status = 404) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve("Not Found"),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  }));
}

function captureMesh(initialSrc: string): {
  result: UseMeshResult;
  srcRef: ReturnType<typeof ref<string>>;
  app: ReturnType<typeof createApp>;
} {
  const srcRef = ref(initialSrc);
  let captured!: UseMeshResult;
  const container = document.createElement("div");
  const app = createApp({
    setup() {
      captured = usePolyMesh(srcRef);
      return () => h("div");
    },
  });
  app.mount(container);
  return { result: captured!, srcRef, app };
}

describe("usePolyMesh — idle (empty src)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts with loading=false and empty polygons", () => {
    const { result } = captureMesh("");
    expect(result.loading.value).toBe(false);
    expect(result.polygons.value).toEqual([]);
    expect(result.error.value).toBeNull();
    expect(result.warnings.value).toEqual([]);
  });

  it("exposes a dispose function", () => {
    const { result } = captureMesh("");
    expect(typeof result.dispose).toBe("function");
  });

  it("dispose is idempotent with no active result", () => {
    const { result } = captureMesh("");
    expect(() => {
      result.dispose();
      result.dispose();
    }).not.toThrow();
  });
});

describe("usePolyMesh — successful load", () => {
  beforeEach(() => {
    mockFetchSuccess(MINIMAL_OBJ);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("resolves polygons after a successful .obj fetch", async () => {
    const { result } = captureMesh("https://example.com/mesh.obj");
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();

    expect(result.loading.value).toBe(false);
    expect(result.polygons.value.length).toBeGreaterThan(0);
    expect(result.error.value).toBeNull();
  });

  it("result polygons have vertices arrays", async () => {
    const { result } = captureMesh("https://example.com/mesh.obj");
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();

    for (const p of result.polygons.value) {
      expect(p).toHaveProperty("vertices");
      expect(Array.isArray(p.vertices)).toBe(true);
    }
  });

  it("warnings is an array after load", async () => {
    const { result } = captureMesh("https://example.com/mesh.obj");
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();

    expect(Array.isArray(result.warnings.value)).toBe(true);
  });

  it("unmounts cleanly after load", async () => {
    const { result: _result, app } = captureMesh("https://example.com/mesh.obj");
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    expect(() => app.unmount()).not.toThrow();
  });
});

describe("usePolyMesh — error handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sets error and loading=false on 404", async () => {
    mockFetchFailure(404);
    const { result } = captureMesh("https://example.com/missing.obj");
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();

    expect(result.loading.value).toBe(false);
    expect(result.error.value).toBeInstanceOf(Error);
  });

  it("sets error when fetch throws (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const { result } = captureMesh("https://example.com/mesh.obj");
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();

    expect(result.loading.value).toBe(false);
    expect(result.error.value).toBeInstanceOf(Error);
  });

  it("sets error for unsupported extension", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => "", arrayBuffer: () => new ArrayBuffer(0) }));
    const { result } = captureMesh("https://example.com/mesh.stl");
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();

    expect(result.error.value).toBeInstanceOf(Error);
  });

  it("sets error for .mtl extension", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const { result } = captureMesh("https://example.com/material.mtl");
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();

    expect(result.error.value).toBeInstanceOf(Error);
  });
});

describe("usePolyMesh — reactive src ref", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("clears to idle when src changes to empty string", async () => {
    mockFetchSuccess(MINIMAL_OBJ);
    const { result, srcRef } = captureMesh("https://example.com/mesh.obj");

    // Immediately set empty before the fetch resolves
    srcRef.value = "";
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    await nextTick();

    expect(result.loading.value).toBe(false);
    expect(result.polygons.value).toEqual([]);
  });

  it("starts with loading=true when src is set and fetch pending", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {}))); // never resolves
    const { result } = captureMesh("https://example.com/mesh.obj");
    expect(result.loading.value).toBe(true);
  });

  it("reactive loading changes when src changes from empty to a URL", async () => {
    mockFetchSuccess(MINIMAL_OBJ);
    const { result, srcRef } = captureMesh("");

    expect(result.loading.value).toBe(false);
    srcRef.value = "https://example.com/mesh.obj";
    await nextTick();
    // Should be loading now
    expect(result.loading.value).toBe(true);
  });
});

describe("usePolyMesh — unmount cleanup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("unmounts without throwing when idle", () => {
    const { app } = captureMesh("");
    expect(() => app.unmount()).not.toThrow();
  });

  it("unmounts without throwing during pending load", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    const { app } = captureMesh("https://example.com/mesh.obj");
    expect(() => app.unmount()).not.toThrow();
  });
});
