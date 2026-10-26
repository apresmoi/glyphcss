// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { FLUID_DEFAULTS, FLUID_READER_DEFAULTS, FLUID_READER_LOOP_MS } from "../model/fluidWorkbench";

const fakes = vi.hoisted(() => {
  const workers: unknown[] = [];
  class FakeWorker {
    constructor() {
      workers.push(this);
    }
  }
  const fluid = {
    addTarget: vi.fn(),
    stats: vi.fn(() => ({
      fps: 60,
      pipeline: "worker",
      encoding: "atlas",
      cols: 10,
      rows: 4,
      frames: 1,
      stalls: 0,
      stepMs: 1.234,
      lit: 3,
    })),
    destroy: vi.fn(),
  };
  const listeners = new Set<(e: unknown) => void>();
  const clock = {
    index: -1,
    tokens: [{}, {}, {}],
    playing: true,
    play: vi.fn(() => void (clock.playing = true)),
    pause: vi.fn(() => void (clock.playing = false)),
    setWpm: vi.fn(),
    setText: vi.fn(),
    subscribe: vi.fn((fn: (e: unknown) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    }),
  };
  const reader = { ready: Promise.resolve(), clock, fluid, destroy: vi.fn() };
  return { FakeWorker, workers, fluid, clock, listeners, reader };
});
vi.mock("@glyphcss/fluid/worker?worker", () => ({ default: fakes.FakeWorker }));
vi.mock("@glyphcss/fluid", () => ({
  createGlyphFluid: vi.fn(() => fakes.fluid),
  GlyphFluidTargets: { text: vi.fn((el: HTMLElement, opts: unknown) => ({ kind: "text", el, opts })) },
}));
vi.mock("@glyphcss/fluid/reader", () => ({ createGlyphFluidReader: vi.fn(() => fakes.reader) }));

const fluidApi = await import("@glyphcss/fluid");
const readerApi = await import("@glyphcss/fluid/reader");
const { mountFluidField, mountFluidReader } = await import("./fluidRuntime");

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  fakes.workers.length = 0;
});

describe("mountFluidField", () => {
  it("passes the workbench settings, condenses the heading, polls stats and tears everything down", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    const heading = document.createElement("p");
    const onStats = vi.fn();
    const mount = mountFluidField(host, heading, { ...FLUID_DEFAULTS, encoding: "mono", fps: 30 }, onStats);
    const options = vi.mocked(fluidApi.createGlyphFluid).mock.calls[0]![1]!;
    expect(options).toMatchObject({
      field: { color: "#6f8f82", level: 0.18 },
      encoding: "mono",
      fps: 30,
      pointer: "host",
    });
    // The website supplies its own bundled worker: the package default URL does not exist when aliased to source.
    expect(typeof options.worker).toBe("function");
    (options.worker as () => Worker)();
    expect(fakes.workers).toHaveLength(1);
    expect(vi.mocked(fluidApi.GlyphFluidTargets.text).mock.calls[0]![0]).toBe(heading);
    expect(fakes.fluid.addTarget).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(onStats).toHaveBeenCalledTimes(2);
    mount.destroy();
    expect(fakes.fluid.destroy).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(1000);
    expect(onStats).toHaveBeenCalledTimes(2);
  });

  it("runs on the main thread when the worker is off", () => {
    mountFluidField(document.createElement("div"), document.createElement("p"), {
      ...FLUID_DEFAULTS,
      worker: false,
    }).destroy();
    expect(vi.mocked(fluidApi.createGlyphFluid).mock.calls[0]![1]!.worker).toBe(false);
  });
});

describe("mountFluidReader", () => {
  it("mounts molty's round reader and reports clock progress until destroyed", async () => {
    // The plain letters use the site's render font token, like every glyph <pre>.
    document.documentElement.style.setProperty("--gc-font-render", '"Glyph Mono", monospace');
    const onProgress = vi.fn();
    const mount = mountFluidReader(document.createElement("div"), FLUID_READER_DEFAULTS, FLUID_DEFAULTS, onProgress);
    expect(vi.mocked(readerApi.createGlyphFluidReader).mock.calls[0]![1]).toMatchObject({
      text: FLUID_READER_DEFAULTS.text,
      wpm: FLUID_READER_DEFAULTS.wpm,
      loop: FLUID_READER_LOOP_MS,
      shape: "circle",
      encoding: "atlas",
      fps: 60,
      font: '"Glyph Mono", monospace',
    });
    await Promise.resolve();
    fakes.clock.index = 1;
    for (const fn of fakes.listeners) fn({ type: "word" });
    expect(onProgress).toHaveBeenLastCalledWith({ index: 1, total: 3, playing: true });
    mount.setPlaying(false);
    expect(fakes.clock.pause).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenLastCalledWith({ index: 1, total: 3, playing: false });
    mount.setWpm(600);
    mount.setText("next words");
    expect(fakes.clock.setWpm).toHaveBeenCalledWith(600);
    expect(fakes.clock.setText).toHaveBeenCalledWith("next words");
    const calls = onProgress.mock.calls.length;
    mount.destroy();
    expect(fakes.reader.destroy).toHaveBeenCalledOnce();
    expect(fakes.listeners.size).toBe(0);
    mount.setPlaying(true);
    expect(onProgress).toHaveBeenCalledTimes(calls);
  });

  // The reader stopping at the end is the package's contract (reader.test.ts); this pins
  // the workbench's loop toggle onto the reader option in both directions.
  it("maps the loop toggle onto the reader's loop option", () => {
    mountFluidReader(
      document.createElement("div"),
      { ...FLUID_READER_DEFAULTS, loop: false },
      FLUID_DEFAULTS,
    ).destroy();
    mountFluidReader(document.createElement("div"), { ...FLUID_READER_DEFAULTS, loop: true }, FLUID_DEFAULTS).destroy();
    const calls = vi.mocked(readerApi.createGlyphFluidReader).mock.calls;
    expect(calls.at(-2)![1]!.loop).toBe(false);
    expect(calls.at(-1)![1]!.loop).toBe(FLUID_READER_LOOP_MS);
  });
});
