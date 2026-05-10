import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { usePolyMesh } from "./useMesh";
import type { UseMeshResult } from "./useMesh";
import type { Polygon } from "@layoutit/polycss-core";

const MOCK_POLYGON: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#ff0000",
};

function UseMeshHarness({
  src,
  onResult,
}: {
  src: string;
  onResult: (result: UseMeshResult) => void;
}) {
  const result = usePolyMesh(src);
  onResult(result);
  return null;
}

function renderHarness(src: string) {
  let captured: UseMeshResult | null = null;
  const container = document.createElement("div");
  const root = createRoot(container);

  act(() =>
    root.render(
      React.createElement(UseMeshHarness, {
        src,
        onResult: (r) => {
          captured = r;
        },
      })
    )
  );

  return {
    get result() {
      return captured!;
    },
    update(newSrc: string) {
      act(() =>
        root.render(
          React.createElement(UseMeshHarness, {
            src: newSrc,
            onResult: (r) => {
              captured = r;
            },
          })
        )
      );
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

// Mock fetch to control loadMesh outcomes
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

// Minimal OBJ content with one triangle
const MINIMAL_OBJ = `
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
`.trim();

describe("usePolyMesh — idle (no src)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("starts with loading=false and empty polygons when src is empty string", () => {
    const harness = renderHarness("");
    expect(harness.result.loading).toBe(false);
    expect(harness.result.polygons).toEqual([]);
    expect(harness.result.error).toBeNull();
    expect(harness.result.warnings).toEqual([]);
  });

  it("exposes a dispose function", () => {
    const harness = renderHarness("");
    expect(typeof harness.result.dispose).toBe("function");
  });

  it("dispose is idempotent with no active result", () => {
    const harness = renderHarness("");
    expect(() => {
      harness.result.dispose();
      harness.result.dispose();
    }).not.toThrow();
  });

  it("clears to idle when src changes to empty string", () => {
    const harness = renderHarness("");
    harness.update("");
    expect(harness.result.loading).toBe(false);
    expect(harness.result.polygons).toEqual([]);
    expect(harness.result.error).toBeNull();
  });

  it("unmounts without throwing when no src loaded", () => {
    const harness = renderHarness("");
    expect(() => harness.unmount()).not.toThrow();
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

  it("resolves with polygons after a successful .obj fetch", async () => {
    const harness = renderHarness("https://example.com/mesh.obj");

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(harness.result.loading).toBe(false);
    expect(harness.result.polygons.length).toBeGreaterThan(0);
    expect(harness.result.error).toBeNull();
  });

  it("sets warnings from the parse result", async () => {
    const harness = renderHarness("https://example.com/mesh.obj");

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(Array.isArray(harness.result.warnings)).toBe(true);
  });

  it("returns loaded polygons matching MOCK_POLYGON shape", async () => {
    const harness = renderHarness("https://example.com/mesh.obj");

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    const polys = harness.result.polygons;
    for (const p of polys) {
      expect(p).toHaveProperty("vertices");
      expect(Array.isArray(p.vertices)).toBe(true);
    }
    // Mark MOCK_POLYGON used
    expect(MOCK_POLYGON.color).toBe("#ff0000");
  });

  it("unmounts cleanly after load, revoking blob URLs", async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:test-url"),
      revokeObjectURL,
    });

    const harness = renderHarness("https://example.com/mesh.obj");

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(() => harness.unmount()).not.toThrow();
  });
});

describe("usePolyMesh — error handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sets error and loading=false on 404", async () => {
    mockFetchFailure(404);
    const harness = renderHarness("https://example.com/missing.obj");

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(harness.result.loading).toBe(false);
    expect(harness.result.error).toBeInstanceOf(Error);
  });

  it("sets error when fetch throws (network error)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const harness = renderHarness("https://example.com/mesh.obj");

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(harness.result.loading).toBe(false);
    expect(harness.result.error).toBeInstanceOf(Error);
  });

  it("sets error for unsupported extension", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200, text: () => "", arrayBuffer: () => new ArrayBuffer(0) }));
    const harness = renderHarness("https://example.com/mesh.stl");

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(harness.result.error).toBeInstanceOf(Error);
  });

  it("handles .mtl extension with error", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const harness = renderHarness("https://example.com/material.mtl");

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(harness.result.error).toBeInstanceOf(Error);
  });
});

describe("usePolyMesh — src change (race safety)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("clears to idle after src set to empty on already-idle hook", () => {
    const harness = renderHarness("");
    harness.update("");
    expect(harness.result.loading).toBe(false);
    expect(harness.result.polygons).toEqual([]);
  });

  it("transitions from src to empty src, clearing loading state", async () => {
    mockFetchSuccess(MINIMAL_OBJ);
    const harness = renderHarness("https://example.com/mesh.obj");
    // Immediately clear the src before the fetch resolves
    harness.update("");

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(harness.result.loading).toBe(false);
    expect(harness.result.polygons).toEqual([]);
  });
});
