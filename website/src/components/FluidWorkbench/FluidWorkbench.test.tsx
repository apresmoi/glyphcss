// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { FluidReaderProgress, FluidSettings } from "../../features/fluid/model/fluidWorkbench";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const runtime = vi.hoisted(() => {
  const fields: { settings: FluidSettings; destroy: ReturnType<typeof vi.fn>; onStats?: (s: unknown) => void }[] = [];
  const readers: {
    settings: { text: string; wpm: number; loop: boolean };
    onProgress?: (p: FluidReaderProgress) => void;
    setPlaying: ReturnType<typeof vi.fn>;
    setWpm: ReturnType<typeof vi.fn>;
    setText: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }[] = [];
  return {
    fields,
    readers,
    mountFluidField: vi.fn((_host: HTMLElement, _heading: HTMLElement, settings: FluidSettings, onStats?: (s: unknown) => void) => {
      const mount = { settings, onStats, destroy: vi.fn(), fluid: {} };
      fields.push(mount);
      return mount;
    }),
    mountFluidReader: vi.fn(
      (_host: HTMLElement, settings: { text: string; wpm: number; loop: boolean }, _s: unknown, onProgress?: (p: FluidReaderProgress) => void) => {
        const mount = { settings, onProgress, setPlaying: vi.fn(), setWpm: vi.fn(), setText: vi.fn(), destroy: vi.fn(), reader: {} };
        readers.push(mount);
        return mount;
      },
    ),
  };
});
vi.mock("../../features/fluid/services/fluidRuntime", () => runtime);

const { FluidWorkbench } = await import("./index");

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
afterEach(async () => {
  await unmount();
  document.body.replaceChildren();
  runtime.fields.length = 0;
  runtime.readers.length = 0;
  vi.clearAllMocks();
});

async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<StrictMode><FluidWorkbench /></StrictMode>));
  return host;
}
const live = <T extends { destroy: ReturnType<typeof vi.fn> }>(mounts: T[]) => mounts.filter((m) => !m.destroy.mock.calls.length);
const click = async (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());

it("owns one field and one reader through StrictMode replay and destroys both on unmount", async () => {
  const host = await mount();
  expect(live(runtime.fields)).toHaveLength(1);
  expect(live(runtime.readers)).toHaveLength(1);
  const heading = host.querySelector(".fluid-heading")!;
  expect(heading.textContent).toBe("fluid");
  expect(runtime.mountFluidField.mock.calls.at(-1)![1]).toBe(heading);
  expect(runtime.mountFluidReader.mock.calls.at(-1)![0]).toBe(host.querySelector(".fluid-reader"));
  await unmount();
  expect(live(runtime.fields)).toHaveLength(0);
  expect(live(runtime.readers)).toHaveLength(0);
});

it("remounts the fluids on constructor options and drives the reader clock in place", async () => {
  const host = await mount();
  const [field] = live(runtime.fields);
  const [reader] = live(runtime.readers);
  await click(host.querySelector('[aria-label="Encoding: Mono"]'));
  expect(field!.destroy).toHaveBeenCalledOnce();
  expect(reader!.destroy).toHaveBeenCalledOnce();
  expect(live(runtime.fields)[0]!.settings.encoding).toBe("mono");

  const current = live(runtime.readers)[0]!;
  await click(host.querySelector('[aria-label="Words per minute: 600 wpm"]'));
  expect(current.setWpm).toHaveBeenCalledWith(600);
  expect(current.destroy).not.toHaveBeenCalled();

  const textarea = host.querySelector("textarea")!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    set.call(textarea, "Three short words");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
  expect(current.setText).toHaveBeenCalledWith("Three short words");
  expect(current.destroy).not.toHaveBeenCalled();

  // The loop is a reader constructor option: it remounts with the edited text and wpm.
  await click(host.querySelector(".fluid-row--check input"));
  expect(current.destroy).toHaveBeenCalledOnce();
  expect(live(runtime.readers)[0]!.settings).toEqual({ text: "Three short words", wpm: 600, loop: false });
});

it("shows reader progress and stats readouts and toggles play from the progress it reports", async () => {
  const host = await mount();
  const reader = live(runtime.readers)[0]!;
  await act(async () => reader.onProgress!({ index: 2, total: 17, playing: true }));
  expect(host.querySelector("[data-fluid-reader-word]")!.textContent).toBe("3 / 17");
  await click([...host.querySelectorAll("button")].find((b) => b.textContent === "Pause"));
  expect(reader.setPlaying).toHaveBeenCalledWith(false);
  const field = live(runtime.fields)[0]!;
  await act(async () =>
    field.onStats!({ fps: 30, pipeline: "worker", encoding: "atlas", cols: 144, rows: 90, frames: 9, stalls: 0, stepMs: 4.2, lit: 1 }),
  );
  const rows = Object.fromEntries(
    [...host.querySelectorAll("#fluid-stats-panel .controller")].map((c) => [c.querySelector(".name")!.textContent, (c.querySelector("input") as HTMLInputElement).value]),
  );
  expect(rows).toEqual({ fps: "30", pipeline: "worker", "cols × rows": "144 × 90", "step ms": "4.20" });
});

it("exports the vanilla API only, with the reasons the bindings are unavailable", async () => {
  const host = await mount();
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
