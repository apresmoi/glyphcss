// @vitest-environment node
import { queryObjects } from "node:v8";
vi.hoisted(async () => {
  const { Window } = await import("happy-dom");
  const window = new Window({ url: "http://localhost/charts" });
  const removeChild = window.Node.prototype.removeChild;
  window.Node.prototype.removeChild = function (child) {
    try {
      return removeChild.call(this, child);
    } catch (error) {
      if (error instanceof window.DOMException && error.message.includes("removeChild"))
        throw new window.DOMException(error.message, "NotFoundError");
      throw error;
    }
  };
  for (const key of [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "HTMLInputElement",
    "Element",
    "Event",
    "MouseEvent",
    "KeyboardEvent",
    "DOMException",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ] as const) {
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: key === "window" ? window : window[key],
    });
  }
});
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
import ChartsWorkbench from "./ChartsWorkbench";
import { createChartsWorkbenchState } from "../../features/charts/model/chartsSpec";

// happy-dom has no canvas; this unused gallery palette calibrates at Dock import time.
vi.mock("../../services/rendering/calibratedPalette", () => ({
  CALIBRATED_PALETTE_NAME: "calibrated",
  ensureCalibratedPalette: () => {},
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ChartsWorkbench mount retention", () => {
  let baseline: number;
  beforeAll(() => {
    baseline = queryObjects(window.HTMLPreElement);
  });

  // Counting live DOM instances forces GC without a heap-size threshold or a
  // Node heap flag. A detached preview also retains its ancestor workbench.
  for (let cycle = 0; cycle < 8; cycle++) {
    it(`releases the previous mount before cycle ${cycle + 1}`, () => {
      expect(queryObjects(window.HTMLPreElement)).toBe(baseline);
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      try {
        act(() => root.render(<ChartsWorkbench initialState={createChartsWorkbenchState()} />));
        expect(container.querySelector("pre.glyph-output")?.textContent).toBeTruthy();
      } finally {
        act(() => root.unmount());
        container.remove();
      }
    });
  }
  it("releases the last mount", () => {
    expect(queryObjects(window.HTMLPreElement)).toBe(baseline);
  });
});
