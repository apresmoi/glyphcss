/**
 * Feature-level tests for the glyphcss useGlyphAnimation re-export.
 * Tests use a thin consumer component to exercise observable behavior.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { GlyphScene } from "../scene/GlyphScene";
import { GlyphPerspectiveCamera } from "../camera/GlyphPerspectiveCamera";
import { GlyphMesh } from "../scene/GlyphMesh";
import { useGlyphAnimation } from "./useGlyphAnimation";
import type { Polygon, GlyphAnimationClip, ParseAnimationController, GlyphAnimationTarget } from "@glyphcss/core";

const POLYGON: Polygon = {
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
  color: "#00ff00",
};

// A minimal animation clip for testing
const CLIP: GlyphAnimationClip = {
  name: "idle",
  duration: 1,
  tracks: [],
};

// A minimal parse animation controller stub
const CONTROLLER: ParseAnimationController = {
  parse: (_clip: GlyphAnimationClip, _target: GlyphAnimationTarget) => ({
    play: () => {},
    stop: () => {},
    reset: () => {},
    update: () => {},
  }),
} as unknown as ParseAnimationController;

/**
 * Consumer component that calls useGlyphAnimation and renders
 * observable state as data attributes.
 */
function AnimationConsumer({
  clips,
  controller,
}: {
  clips?: GlyphAnimationClip[];
  controller?: ParseAnimationController;
}): React.ReactElement {
  const { names, clips: resolvedClips } = useGlyphAnimation(clips, controller);
  return React.createElement("div", {
    className: "animation-consumer",
    "data-clip-count": resolvedClips.length,
    "data-names": names.join(","),
  });
}

function renderWithAnimation(
  animProps: { clips?: GlyphAnimationClip[]; controller?: ParseAnimationController } = {},
): { container: HTMLElement; root: ReturnType<typeof createRoot> } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      React.createElement(
        GlyphPerspectiveCamera,
        {},
        React.createElement(
          GlyphScene,
          {},
          React.createElement(GlyphMesh, { polygons: [POLYGON] }),
          React.createElement(AnimationConsumer, animProps),
        ),
      ),
    ),
  );
  return { container, root };
}

describe("useGlyphAnimation (glyphcss re-export) — no clips", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders consumer without throwing when no clips provided", () => {
    expect(() => renderWithAnimation()).not.toThrow();
  });

  it("consumer is in the DOM when no clips provided", () => {
    const { container } = renderWithAnimation();
    expect(container.querySelector(".animation-consumer")).toBeTruthy();
  });

  it("clip count is 0 when no clips provided", () => {
    const { container } = renderWithAnimation();
    const consumer = container.querySelector(".animation-consumer");
    expect(consumer?.getAttribute("data-clip-count")).toBe("0");
  });

  it("names is empty string when no clips", () => {
    const { container } = renderWithAnimation();
    const consumer = container.querySelector(".animation-consumer");
    expect(consumer?.getAttribute("data-names")).toBe("");
  });
});

describe("useGlyphAnimation (glyphcss re-export) — with clips", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders consumer with clips without throwing", () => {
    expect(() =>
      renderWithAnimation({ clips: [CLIP], controller: CONTROLLER }),
    ).not.toThrow();
  });

  it("clip count reflects provided clips", () => {
    const { container } = renderWithAnimation({ clips: [CLIP], controller: CONTROLLER });
    const consumer = container.querySelector(".animation-consumer");
    expect(consumer?.getAttribute("data-clip-count")).toBe("1");
  });

  it("names reflects clip name", () => {
    const { container } = renderWithAnimation({ clips: [CLIP], controller: CONTROLLER });
    const consumer = container.querySelector(".animation-consumer");
    expect(consumer?.getAttribute("data-names")).toBe("idle");
  });

  it("unmounts cleanly", () => {
    const { container, root } = renderWithAnimation({ clips: [CLIP], controller: CONTROLLER });
    act(() => root.unmount());
    expect(container.querySelector(".animation-consumer")).toBeFalsy();
  });
});

describe("useGlyphAnimation — ref attachment pattern", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  /**
   * Consumer that attaches the animation ref to a GlyphMesh handle to
   * simulate real usage.
   */
  function RefAttachConsumer(): React.ReactElement {
    const { ref, names } = useGlyphAnimation(undefined, undefined);
    const attached = ref.current !== null;
    return React.createElement("div", {
      className: "ref-consumer",
      "data-attached": attached ? "true" : "false",
      "data-names": names.join(","),
    });
  }

  it("ref starts unattached when no explicit root", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() =>
      root.render(
        React.createElement(
          GlyphPerspectiveCamera,
          {},
          React.createElement(
            GlyphScene,
            {},
            React.createElement(RefAttachConsumer, null),
          ),
        ),
      ),
    );
    const consumer = container.querySelector(".ref-consumer");
    // ref.current is null until the caller attaches it — this is expected behavior
    expect(consumer?.getAttribute("data-attached")).toBe("false");
    act(() => root.unmount());
  });
});
