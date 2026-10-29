// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FluidConfig } from "../../features/fluid/model/fluidExamples";
import type { FluidReaderProgress } from "../../features/fluid/model/fluidWorkbench";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const runtime = vi.hoisted(() => {
  const fakeFluid = () => ({
    stats: vi.fn(() => ({ fps: 30, pipeline: "worker", encoding: "atlas", cols: 144, rows: 90, frames: 9, stalls: 0, stepMs: 4.2, lit: 77 })),
    step: vi.fn(),
    destroy: vi.fn(),
  });
  type Fluid = ReturnType<typeof fakeFluid>;
  const surfaces: { config: FluidConfig; tuning: unknown; fluid: Fluid; destroy: ReturnType<typeof vi.fn> }[] = [];
  const targets: { example: { id: string }; el: HTMLElement; config: FluidConfig; setCondensed: ReturnType<typeof vi.fn>; setMeshView: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[] = [];
  const zones: { config: FluidConfig; destroy: ReturnType<typeof vi.fn> }[] = [];
  const readers: {
    config: FluidConfig;
    onProgress: (p: FluidReaderProgress) => void;
    fluid: Fluid;
    setPlaying: ReturnType<typeof vi.fn>;
    setWpm: ReturnType<typeof vi.fn>;
    setText: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }[] = [];
  return {
    surfaces,
    targets,
    zones,
    readers,
    mountFluidSurface: vi.fn((_host: HTMLElement, config: FluidConfig, tuning: unknown) => {
      const fluid = fakeFluid();
      surfaces.push({ config, tuning, fluid, destroy: fluid.destroy });
      return fluid;
    }),
    mountFluidExampleTarget: vi.fn((_fluid: unknown, example: { id: string }, el: HTMLElement, config: FluidConfig) => {
      const mount = { example, el, config, setCondensed: vi.fn(), setMeshView: vi.fn(), destroy: vi.fn() };
      targets.push(mount);
      return mount;
    }),
    mountFluidZone: vi.fn((_fluid: unknown, _el: HTMLElement, config: FluidConfig) => {
      const zone = { config, destroy: vi.fn() };
      zones.push(zone);
      return { remove: zone.destroy };
    }),
    mountFluidReaderExample: vi.fn((_host: HTMLElement, config: FluidConfig, _t: unknown, onProgress: (p: FluidReaderProgress) => void) => {
      const fluid = fakeFluid();
      const mount = { config, onProgress, fluid, setPlaying: vi.fn(), setWpm: vi.fn(), setText: vi.fn(), destroy: vi.fn() };
      readers.push(mount);
      return mount;
    }),
    rippleFluid: vi.fn(),
  };
});
vi.mock("../../features/fluid/services/fluidExampleRuntime", () => runtime);
// stats-js draws into a 2D canvas, which happy-dom lacks; the mount itself is what's checked.
const stats = vi.hoisted(() => ({ StatsOverlay: vi.fn((_props: { anchor?: string; container?: HTMLElement | null }) => null) }));
vi.mock("../StatsOverlay", () => stats);

const { FluidWorkbench } = await import("./index");
const { encodeFluidConfig } = await import("../../features/fluid/model/fluidUrlState");
const { findFluidExample, fluidExampleDefaults } = await import("../../features/fluid/model/fluidExamples");

let root: Root | undefined;
// happy-dom names lil-gui's parent-first `removeChild` failure plain `DOMException`, not
// `NotFoundError`, so the Dock's own guard misses it and act() rethrows it after every other
// cleanup has run (mapsKit.viewFolder.test.tsx documents the same harness quirk).
async function unmount() {
  try {
    await act(async () => root?.unmount());
  } catch (error) {
    if (!(error instanceof AggregateError && error.errors.every((e) => /removeChild/.test(String(e))))) throw error;
  }
  root = undefined;
}
beforeEach(() => window.history.replaceState(null, "", "/fluid/"));
afterEach(async () => {
  await unmount();
  document.body.replaceChildren();
  runtime.surfaces.length = 0;
  runtime.targets.length = 0;
  runtime.zones.length = 0;
  runtime.readers.length = 0;
  vi.clearAllMocks();
});

async function mount(search = "") {
  window.history.replaceState(null, "", `/fluid/${search}`);
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<StrictMode><FluidWorkbench /></StrictMode>));
  return host;
}
const live = <T extends { destroy: ReturnType<typeof vi.fn> }>(mounts: T[]) => mounts.filter((m) => !m.destroy.mock.calls.length);
const click = async (el: Element | null | undefined) => {
  expect(el).toBeTruthy();
  await act(async () => (el as HTMLElement).click());
};
const controller = (host: Element, name: string) =>
  [...host.querySelectorAll("#fluid-controls-panel .controller")].find((c) => c.querySelector(".name")?.textContent === name);
const params = () => new URLSearchParams(window.location.search);

it("owns one fluid and one target through StrictMode replay and destroys both on unmount", async () => {
  const host = await mount();
  expect(live(runtime.surfaces)).toHaveLength(1);
  expect(live(runtime.targets)).toHaveLength(1);
  expect(live(runtime.targets)[0]!.el).toBe(host.querySelector(".fluid-heading"));
  expect(host.querySelector(".fluid-heading")!.textContent).toBe("fluid");
  expect(host.querySelector('#fluid-examples-panel button[aria-label="Heading"]')!.getAttribute("aria-pressed")).toBe("true");
  // The FPS / memory overlay pins to the render area like the other workbenches'.
  expect(stats.StatsOverlay.mock.calls.at(-1)![0]).toEqual({ anchor: "top-left", container: host.querySelector(".synth-main") });
  await unmount();
  expect(live(runtime.surfaces)).toHaveLength(0);
  expect(live(runtime.targets)).toHaveLength(0);
});

it("switches examples from the list and writes the choice to the URL", async () => {
  const host = await mount();
  await click(host.querySelector('button[aria-label="Expand Meshes"]'));
  await click(host.querySelector('#fluid-examples-panel button[aria-label="Teapot"]'));
  expect(live(runtime.surfaces)).toHaveLength(1);
  const [target] = live(runtime.targets);
  expect(target!.example.id).toBe("mesh-teapot");
  expect(target!.el).toBe(host.querySelector(".fluid-box--mesh"));
  expect(params().get("example")).toBe("mesh-teapot");
  // The mesh's pose defaults come from the gallery preset; the live view follows them.
  expect(target!.setMeshView).toHaveBeenLastCalledWith(expect.objectContaining({ rotX: 65, rotY: 45 }));
  expect(host.querySelector(".model-credit")!.textContent).toContain("Source:");

  await click(host.querySelector('button[aria-label="Expand Reader"]'));
  await click(host.querySelector('#fluid-examples-panel button[aria-label="Reader · glyph"]'));
  expect(live(runtime.surfaces)).toHaveLength(0);
  expect(live(runtime.targets)).toHaveLength(0);
  const [reader] = live(runtime.readers);
  expect(reader!.config).toMatchObject({ look: "glyph", shape: "circle", targetCols: 52 });
  expect(host.querySelector(".fluid-reader--circle")).not.toBeNull();
  expect(host.querySelector(".model-credit")).toBeNull();
  expect(params().get("example")).toBe("reader-glyph");

  await click(host.querySelector('button[aria-label="Expand Pointer"]'));
  await click(host.querySelector('#fluid-examples-panel button[aria-label="Stir & zones"]'));
  expect(live(runtime.readers)).toHaveLength(0);
  expect(live(runtime.zones)).toHaveLength(1);
  expect(live(runtime.zones)[0]!.config.zoneKind).toBe("quiet");
});

it("restores the example and options from a link, and ignores a malformed one", async () => {
  const example = findFluidExample("reader-plain")!;
  const defaults = fluidExampleDefaults(example);
  const f = encodeFluidConfig({ ...defaults, wpm: 600, encoding: "mono" }, defaults)!;
  await mount(`?example=reader-plain&f=${encodeURIComponent(f)}`);
  expect(live(runtime.readers)[0]!.config).toMatchObject({ look: "plain", wpm: 600, encoding: "mono" });
  await unmount();
  runtime.readers.length = 0;

  await mount("?example=nope&f=garbage&sim=xx");
  expect(live(runtime.readers)).toHaveLength(0);
  expect(live(runtime.surfaces)[0]!.config).toEqual(fluidExampleDefaults(findFluidExample("heading")!));
  expect(live(runtime.surfaces)[0]!.tuning).toEqual({});
});

it("applies Dock options: construction options rebuild the fluid, target options stay live", async () => {
  const host = await mount();
  const [surface] = live(runtime.surfaces);
  const [target] = live(runtime.targets);
  await click(host.querySelector('[aria-label="Encoding: Mono"]'));
  expect(surface!.destroy).toHaveBeenCalledOnce();
  expect(live(runtime.surfaces)[0]!.config.encoding).toBe("mono");
  expect(params().get("f")).toBeTruthy();

  const current = live(runtime.surfaces)[0]!;
  const nextTarget = live(runtime.targets)[0]!;
  expect(target!.destroy).toHaveBeenCalled();
  await click(controller(host, "Condensed")!.querySelector("input"));
  expect(nextTarget.setCondensed).toHaveBeenLastCalledWith(false);
  expect(current.destroy).not.toHaveBeenCalled();
  expect(nextTarget.destroy).not.toHaveBeenCalled();

  // Folder reset drops the fluid overrides back to the example's defaults.
  await click(
    [...host.querySelectorAll(".dock-folder-title-reset-button")].find((b) => b.getAttribute("title")?.includes("fluid options")),
  );
  expect(live(runtime.surfaces)[0]!.config.encoding).toBe("atlas");
});

it("drives the reader clock in place and shows its progress and the stats readouts", async () => {
  const host = await mount("?example=reader-plain");
  const reader = live(runtime.readers)[0]!;
  await act(async () => reader.onProgress({ index: 2, total: 17, playing: true }));
  const value = (name: string) => (controller(host, name)!.querySelector("input") as HTMLInputElement);
  expect(value("Word").value).toBe("3 / 17");
  await click(value("Playing"));
  expect(reader.setPlaying).toHaveBeenCalledWith(false);
  expect(reader.destroy).not.toHaveBeenCalled();

  // The readouts poll the fluid's own stats; await them rather than a fixed delay.
  await vi.waitFor(
    () => {
      const rows = Object.fromEntries(
        ["fps", "pipeline", "cols × rows", "step ms", "lit"].map((name) => [name, value(name).value]),
      );
      expect(rows).toEqual({ fps: "30", pipeline: "worker", "cols × rows": "144 × 90", "step ms": "4.20", lit: "77" });
    },
    { timeout: 5000 },
  );
});

it("keeps the running reader's text and speed on the resolved config, including after a folder reset", async () => {
  const example = findFluidExample("reader-plain")!;
  const defaults = fluidExampleDefaults(example);
  const f = encodeFluidConfig({ ...defaults, wpm: 600, text: "edited words here" }, defaults)!;
  const host = await mount(`?example=reader-plain&f=${encodeURIComponent(f)}`);
  const reader = live(runtime.readers)[0]!;
  // Construction already carries the link's values; nothing is re-pushed.
  expect(reader.config).toMatchObject({ wpm: 600, text: "edited words here" });
  expect(reader.setWpm).not.toHaveBeenCalled();
  expect(reader.setText).not.toHaveBeenCalled();

  await click(
    [...host.querySelectorAll(".dock-folder-title-reset-button")].find((b) => b.getAttribute("title")?.includes("reader options")),
  );
  expect(reader.destroy).not.toHaveBeenCalled();
  expect(reader.setWpm).toHaveBeenLastCalledWith(defaults.wpm);
  expect(reader.setText).toHaveBeenLastCalledWith(defaults.text);
});

it("exports the active example with the vanilla API only", async () => {
  const host = await mount("?example=reader-plain");
  await click(host.querySelector("[data-export-trigger]"));
  const panel = host.querySelector("#fluid-code-panel")!;
  expect(panel.textContent).toContain("createGlyphFluidReader");
  const options = [...panel.querySelectorAll("option")];
  expect(options.find((o) => o.value === "vanilla")!.disabled).toBe(false);
  expect(options.filter((o) => o.disabled).map((o) => o.title)).toEqual([
    "@glyphcss/fluid has no React binding; use the JS API.",
    "@glyphcss/fluid has no Vue binding; use the JS API.",
  ]);
});
