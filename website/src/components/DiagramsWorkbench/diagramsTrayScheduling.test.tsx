// @vitest-environment happy-dom
import "../../test/dom";
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderGlyphDiagram } from "@glyphcss/diagrams";
import { renderGlyphSequence } from "@glyphcss/diagrams/sequence";
import { renderGlyphLaneDag } from "@glyphcss/diagrams/lanes";
import GlyphDiagramsWorkbench from "./DiagramsWorkbench";
import { useDiagramsTrayThumbnails } from "./hooks/useDiagramsTrayThumbnails";
import {
  createGlyphDiagramsWorkbenchState,
  GLYPH_DIAGRAMS_TRAY,
} from "../../features/diagrams/model/diagramsWorkbenchState";

vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
vi.mock("../../services/rendering/calibratedPalette", () => ({
  CALIBRATED_PALETTE_NAME: "calibrated",
  ensureCalibratedPalette: () => {},
}));
vi.mock("@glyphcss/diagrams", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/diagrams")>();
  return {
    ...actual,
    renderGlyphDiagram: vi.fn((source, options) =>
      options?.width === 60
        ? Promise.resolve({ text: `graph:${options.target}:${source}` })
        : actual.renderGlyphDiagram(source, options),
    ),
  };
});
vi.mock("@glyphcss/diagrams/sequence", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@glyphcss/diagrams/sequence")>();
  return {
    ...actual,
    renderGlyphSequence: vi.fn((source, options) =>
      Promise.resolve({ text: `sequence:${options.target}:${source}` }),
    ),
  };
});
vi.mock("@glyphcss/diagrams/lanes", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@glyphcss/diagrams/lanes")>();
  return {
    ...actual,
    renderGlyphLaneDag: vi.fn((source, options) =>
      Promise.resolve({
        text: `lanes:${options.target}:${JSON.stringify(source)}`,
      }),
    ),
  };
});
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let observers: VisibilityObserver[];
class VisibilityObserver {
  readonly elements = new Set<Element>();
  constructor(readonly callback: IntersectionObserverCallback) {
    observers.push(this);
  }
  observe(element: Element) {
    this.elements.add(element);
  }
  disconnect() {
    this.elements.clear();
  }
  show(elements: Element[], visible = true) {
    this.callback(
      elements.map((target) => ({
        target,
        isIntersecting: visible,
      })) as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver,
    );
  }
}
let slices: Map<number, IdleRequestCallback>;
let nextSlice: number;
let idleDescriptor: PropertyDescriptor | undefined;
let cancelDescriptor: PropertyDescriptor | undefined;
let observerDescriptor: PropertyDescriptor | undefined;
let host: HTMLDivElement;
let root: Root | undefined;
const thumbnailCalls = () =>
  [
    ...vi.mocked(renderGlyphDiagram).mock.calls,
    ...vi.mocked(renderGlyphSequence).mock.calls,
    ...vi.mocked(renderGlyphLaneDag).mock.calls,
  ].filter(([, options]) => options?.width === 60);
const tiles = () =>
  Array.from(host.querySelectorAll<HTMLElement>("[data-thumbnail-key]"));
const observer = () =>
  observers.findLast((observer) => observer.elements.size > 0)!;
async function mount(target: "web" | "chat", strict = false) {
  root = createRoot(host);
  const initial = createGlyphDiagramsWorkbenchState();
  const view = (
    <GlyphDiagramsWorkbench
      initialState={{ ...initial, controls: { ...initial.controls, target } }}
    />
  );
  await act(async () =>
    root!.render(strict ? <StrictMode>{view}</StrictMode> : view),
  );
  await vi.waitFor(
    async () => {
      await act(async () => {
        await vi.dynamicImportSettled();
      });
      expect(
        host.querySelector('.diagrams-preview[aria-busy="false"]'),
      ).not.toBeNull();
      expect(observer()).toBeDefined();
    },
    { timeout: 10_000 },
  );
}
async function slice() {
  const [id, callback] = [...slices][0]!;
  slices.delete(id);
  await act(async () => {
    callback({ didTimeout: false, timeRemaining: () => 50 });
  });
}
async function unmount() {
  await act(async () => root?.unmount());
  root = undefined;
}

beforeEach(() => {
  observers = [];
  slices = new Map();
  nextSlice = 0;
  vi.clearAllMocks();
  observerDescriptor = Object.getOwnPropertyDescriptor(window, "IntersectionObserver");
  Object.defineProperty(window, "IntersectionObserver", { configurable: true, value: VisibilityObserver });
  idleDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "requestIdleCallback",
  );
  cancelDescriptor = Object.getOwnPropertyDescriptor(
    window,
    "cancelIdleCallback",
  );
  Object.defineProperty(window, "requestIdleCallback", {
    configurable: true,
    value: (callback: IdleRequestCallback) => {
      const id = ++nextSlice;
      slices.set(id, callback);
      return id;
    },
  });
  Object.defineProperty(window, "cancelIdleCallback", {
    configurable: true,
    value: (id: number) => {
      slices.delete(id);
    },
  });
  window.history.replaceState(null, "", "/diagrams");
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  await unmount();
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (observerDescriptor) Object.defineProperty(window, "IntersectionObserver", observerDescriptor);
  else Reflect.deleteProperty(window, "IntersectionObserver");
  if (idleDescriptor)
    Object.defineProperty(window, "requestIdleCallback", idleDescriptor);
  else Reflect.deleteProperty(window, "requestIdleCallback");
  if (cancelDescriptor)
    Object.defineProperty(window, "cancelIdleCallback", cancelDescriptor);
  else Reflect.deleteProperty(window, "cancelIdleCallback");
});

describe("diagram tray scheduling", () => {
  it("mounts and remounts the main diagram before rendering any batch; visible tiles settle one per slice and reuse their target cache", async () => {
    await mount("web");
    expect(thumbnailCalls()).toHaveLength(0);
    expect(slices.size).toBe(0);
    expect(tiles()).toHaveLength(GLYPH_DIAGRAMS_TRAY.length);
    const [first, second] = tiles();
    observer().show([first!, second!]);
    expect(thumbnailCalls()).toHaveLength(0);
    expect(slices.size).toBe(1);
    await slice();
    expect(thumbnailCalls()).toHaveLength(1);
    expect(first!.querySelector("pre")!.getAttribute("aria-busy")).toBe(
      "false",
    );
    expect(first!.textContent).toContain("graph:web:");
    expect(second!.querySelector("pre")!.getAttribute("aria-busy")).toBe(
      "true",
    );
    observer().show([second!], false);
    await slice();
    expect(thumbnailCalls()).toHaveLength(1);
    observer().show([second!]);
    expect(slices.size).toBe(1);
    await unmount();
    expect(slices.size).toBe(0);
    expect(observers.every((observer) => observer.elements.size === 0)).toBe(
      true,
    );

    await mount("web");
    expect(thumbnailCalls()).toHaveLength(1);
    observer().show(tiles());
    await slice();
    expect(thumbnailCalls()).toHaveLength(1);
    for (let turn = 0; slices.size && turn <= GLYPH_DIAGRAMS_TRAY.length; turn++) await slice();
    expect(slices.size).toBe(0);
    expect(thumbnailCalls()).toHaveLength(GLYPH_DIAGRAMS_TRAY.length);
    await vi.waitFor(
      () => {
        expect(
          tiles().every(
            (tile) =>
              tile.querySelector("pre")!.getAttribute("aria-busy") === "false",
          ),
        ).toBe(true);
      },
      { timeout: 1000 },
    );
    expect(
      tiles().every(
        (tile) => tile.querySelector("pre")!.textContent!.trim().length > 0,
      ),
    ).toBe(true);
    expect(
      thumbnailCalls().every(
        ([, options]) => options?.height === 24 && options.target === "web",
      ),
    ).toBe(true);
    await unmount();
    await mount("web");
    observer().show(tiles());
    for (let turn = 0; slices.size && turn <= GLYPH_DIAGRAMS_TRAY.length; turn++) await slice();
    expect(slices.size).toBe(0);
    expect(thumbnailCalls()).toHaveLength(GLYPH_DIAGRAMS_TRAY.length);
  });

  it("survives StrictMode replay and keeps chat previews separate from cached web previews", async () => {
    await mount("chat", true);
    expect(thumbnailCalls()).toHaveLength(0);
    observer().show(tiles());
    await slice();
    expect(thumbnailCalls()).toHaveLength(1);
    expect(tiles()[0]!.querySelector("pre")!.textContent).toContain(
      "graph:chat:",
    );
    await unmount();
    expect(slices.size).toBe(0);
    expect(observers.every((observer) => observer.elements.size === 0)).toBe(
      true,
    );
  });

  it("defers the no-observer fallback until the main render is ready, and cancels after an in-flight entry", async () => {
    Object.defineProperty(window, "IntersectionObserver", { configurable: true, value: undefined });
    Object.defineProperty(window, "requestIdleCallback", {
      configurable: true,
      value: undefined,
    });
    const tasks = new Map<number, () => void>();
    const timerWindow: Pick<Window, "setTimeout" | "clearTimeout"> = window;
    vi.spyOn(timerWindow, "setTimeout").mockImplementation((callback) => {
      const id = ++nextSlice;
      tasks.set(id, callback as () => void);
      return id;
    });
    vi.spyOn(timerWindow, "clearTimeout").mockImplementation((id) => {
      if (id !== undefined) tasks.delete(id);
    });
    function Tray({ ready }: { ready: boolean }) {
      const { trayRef, thumbnails } = useDiagramsTrayThumbnails(
        "terminal",
        ready,
      );
      return (
        <section ref={trayRef}>
          {GLYPH_DIAGRAMS_TRAY.map((entry) => {
            const key = `${entry.kind}:${entry.preset.id}`;
            return (
              <button key={key} data-thumbnail-key={key}>
                <pre aria-busy={thumbnails[key] === undefined}>
                  {thumbnails[key] ?? ""}
                </pre>
              </button>
            );
          })}
        </section>
      );
    }
    root = createRoot(host);
    await act(async () => root!.render(<Tray ready={false} />));
    expect(tasks.size).toBe(0);
    expect(thumbnailCalls()).toHaveLength(0);
    await act(async () => root!.render(<Tray ready />));
    expect(tasks.size).toBe(1);
    let finish!: (
      result: Awaited<ReturnType<typeof renderGlyphDiagram>>,
    ) => void;
    vi.mocked(renderGlyphDiagram).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const [id, task] = [...tasks][0]!;
    tasks.delete(id);
    await act(async () => {
      task();
    });
    expect(thumbnailCalls()).toHaveLength(1);
    expect(tasks.size).toBe(0);
    await unmount();
    await act(async () => {
      finish({ text: "finished after cleanup" } as Awaited<
        ReturnType<typeof renderGlyphDiagram>
      >);
    });
    expect(tasks.size).toBe(0);
    expect(host.textContent).toBe("");
    root = createRoot(host);
    await act(async () => root!.render(<Tray ready />));
    expect(tasks.size).toBe(1);
    await unmount();
    expect(tasks.size).toBe(0);
  });
});
