/**
 * Feature-level tests for the glyphcss Vue useGlyphAnimation composable.
 * Tests use a thin consumer component to exercise observable behavior.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createApp, defineComponent, h, nextTick } from "vue";
import { GlyphScene } from "../scene/GlyphScene";
import { useGlyphAnimation } from "./useGlyphAnimation";
import type { GlyphAnimationClip, ParseAnimationController, GlyphAnimationTarget } from "@glyphcss/core";

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
function makeConsumer(
  clips?: GlyphAnimationClip[],
  controller?: ParseAnimationController,
) {
  return defineComponent({
    name: "AnimationConsumer",
    setup() {
      const { names, clips: resolvedClips } = useGlyphAnimation(clips, controller);
      return () =>
        h("div", {
          class: "animation-consumer",
          "data-clip-count": resolvedClips.value.length,
          "data-names": names.value.join(","),
        });
    },
  });
}

describe("useGlyphAnimation (Vue) — no clips", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders consumer without throwing when no clips provided", () => {
    const Consumer = makeConsumer();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphScene, {}, { default: () => h(Consumer) });
      },
    });
    expect(() => app.mount(container)).not.toThrow();
    app.unmount();
  });

  it("consumer is in the DOM when no clips provided", async () => {
    const Consumer = makeConsumer();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphScene, {}, { default: () => h(Consumer) });
      },
    });
    app.mount(container);
    await nextTick();
    expect(container.querySelector(".animation-consumer")).toBeTruthy();
    app.unmount();
  });

  it("clip count is 0 when no clips provided", async () => {
    const Consumer = makeConsumer();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphScene, {}, { default: () => h(Consumer) });
      },
    });
    app.mount(container);
    await nextTick();
    const consumer = container.querySelector(".animation-consumer");
    expect(consumer?.getAttribute("data-clip-count")).toBe("0");
    app.unmount();
  });

  it("names is empty string when no clips", async () => {
    const Consumer = makeConsumer();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphScene, {}, { default: () => h(Consumer) });
      },
    });
    app.mount(container);
    await nextTick();
    const consumer = container.querySelector(".animation-consumer");
    expect(consumer?.getAttribute("data-names")).toBe("");
    app.unmount();
  });
});

describe("useGlyphAnimation (Vue) — with clips", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("renders consumer with clips without throwing", () => {
    const Consumer = makeConsumer([CLIP], CONTROLLER);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphScene, {}, { default: () => h(Consumer) });
      },
    });
    expect(() => app.mount(container)).not.toThrow();
    app.unmount();
  });

  it("clip count reflects provided clips", async () => {
    const Consumer = makeConsumer([CLIP], CONTROLLER);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphScene, {}, { default: () => h(Consumer) });
      },
    });
    app.mount(container);
    await nextTick();
    const consumer = container.querySelector(".animation-consumer");
    expect(consumer?.getAttribute("data-clip-count")).toBe("1");
    app.unmount();
  });

  it("names reflects clip name", async () => {
    const Consumer = makeConsumer([CLIP], CONTROLLER);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphScene, {}, { default: () => h(Consumer) });
      },
    });
    app.mount(container);
    await nextTick();
    const consumer = container.querySelector(".animation-consumer");
    expect(consumer?.getAttribute("data-names")).toBe("idle");
    app.unmount();
  });

  it("unmounts cleanly", async () => {
    const Consumer = makeConsumer([CLIP], CONTROLLER);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphScene, {}, { default: () => h(Consumer) });
      },
    });
    app.mount(container);
    await nextTick();
    app.unmount();
    expect(container.querySelector(".animation-consumer")).toBeFalsy();
  });
});

describe("useGlyphAnimation (Vue) — ref is exposed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("ref starts null before a target is attached", async () => {
    const RefConsumer = defineComponent({
      name: "RefConsumer",
      setup() {
        const { ref: animRef } = useGlyphAnimation(undefined, undefined);
        return () =>
          h("div", {
            class: "ref-consumer",
            "data-attached": animRef.value !== null ? "true" : "false",
          });
      },
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const app = createApp({
      setup() {
        return () =>
          h(GlyphScene, {}, { default: () => h(RefConsumer) });
      },
    });
    app.mount(container);
    await nextTick();
    const consumer = container.querySelector(".ref-consumer");
    expect(consumer?.getAttribute("data-attached")).toBe("false");
    app.unmount();
  });
});
