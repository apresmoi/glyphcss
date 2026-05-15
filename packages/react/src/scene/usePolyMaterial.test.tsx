import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { usePolyMaterial } from "./usePolyMaterial";
import type { PolyMaterial } from "@layoutit/polycss-core";

function Harness({
  texture,
  matKey,
  onResult,
}: {
  texture: string;
  matKey?: string;
  onResult: (result: PolyMaterial) => void;
}) {
  const material = usePolyMaterial({ texture, key: matKey });
  onResult(material);
  return null;
}

function render(props: { texture: string; matKey?: string }) {
  let captured: PolyMaterial | null = null;
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(Harness, {
        ...props,
        onResult: (r) => {
          captured = r;
        },
      }),
    ),
  );
  return {
    get result() {
      return captured!;
    },
    update(next: { texture: string; matKey?: string }) {
      act(() =>
        root.render(
          React.createElement(Harness, {
            ...next,
            onResult: (r) => {
              captured = r;
            },
          }),
        ),
      );
    },
    unmount() {
      act(() => root.unmount());
    },
  };
}

describe("usePolyMaterial", () => {
  it("returns a material with the requested texture", () => {
    const h = render({ texture: "https://example.com/wood.png" });
    expect(h.result.texture).toBe("https://example.com/wood.png");
    h.unmount();
  });

  it("returns the same object reference when inputs are unchanged across renders", () => {
    const h = render({ texture: "https://example.com/a.png" });
    const first = h.result;
    h.update({ texture: "https://example.com/a.png" });
    expect(h.result).toBe(first);
    h.unmount();
  });

  it("returns a new reference when texture changes", () => {
    const h = render({ texture: "https://example.com/a.png" });
    const first = h.result;
    h.update({ texture: "https://example.com/b.png" });
    expect(h.result).not.toBe(first);
    expect(h.result.texture).toBe("https://example.com/b.png");
    h.unmount();
  });

  it("returns a new reference when key changes (forces re-keyed materials)", () => {
    const h = render({ texture: "https://example.com/a.png", matKey: "v1" });
    const first = h.result;
    h.update({ texture: "https://example.com/a.png", matKey: "v2" });
    expect(h.result).not.toBe(first);
    expect(h.result.key).toBe("v2");
    h.unmount();
  });
});
