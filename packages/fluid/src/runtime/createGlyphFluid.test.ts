import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphOrthographicCamera } from "glyphcss";
import { createGlyphFluid, type GlyphFluidOptions } from "./createGlyphFluid";
import { GlyphFluidTargets } from "../targets/index";

function sizedHost(w = 400, h = 240): HTMLElement {
  const host = document.createElement("div");
  Object.defineProperty(host, "clientWidth", { value: w });
  Object.defineProperty(host, "clientHeight", { value: h });
  document.body.append(host);
  return host;
}

/** Count assignments to the fluid <pre>'s textContent. */
function spyWrites(host: HTMLElement) {
  const pre = host.querySelector("pre")!;
  let proto: object | null = pre;
  let desc: PropertyDescriptor | undefined;
  while (proto && !(desc = Object.getOwnPropertyDescriptor(proto, "textContent"))) proto = Object.getPrototypeOf(proto);
  const spy = { writes: 0 };
  Object.defineProperty(pre, "textContent", {
    get() { return desc!.get!.call(this); },
    set(v: string) { spy.writes++; desc!.set!.call(this, v); },
  });
  return spy;
}

async function make(opts: GlyphFluidOptions = {}, host = sizedHost()) {
  const fluid = createGlyphFluid(host, { clock: "manual", worker: false, ...opts });
  await fluid.ready;
  return { fluid, host };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("createGlyphFluid", () => {
  it("mounts one <pre> and writes its textContent exactly once per frame", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fluid, host } = await make();
    expect(host.querySelectorAll("pre")).toHaveLength(1);
    const spy = spyWrites(host);
    for (let i = 0; i < 10; i++) fluid.step(1 / 60);
    expect(spy.writes).toBe(10);
    const s = fluid.stats();
    expect(s.pipeline).toBe("main");
    expect(s.frames).toBe(10);
    expect(s.cols).toBeGreaterThan(0);
    const text = host.querySelector("pre")!.textContent!;
    expect(text.split("\n")).toHaveLength(s.rows);
    expect(s.lit).toBeGreaterThan(0); // the field floor is always lit somewhere
    fluid.destroy();
  });

  it("sizes the grid from the host: cells are host width / cols, rows cover the height", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fluid } = await make({ grid: { targetCols: 50, minCellPx: 1, maxCellPx: 100 } }, sizedHost(500, 320));
    const s = fluid.stats();
    expect(s.cols).toBe(50);
    expect(s.rows).toBe(Math.ceil(320 / (10 * 1.6)));
    fluid.destroy();
  });

  it("destroy() removes the DOM, listeners and host styles it added, and stops drawing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const host = sizedHost();
    const { fluid } = await make({ pointer: "host" }, host);
    expect(host.style.position).toBe("relative");
    const removed = vi.spyOn(host, "removeEventListener");
    fluid.destroy();
    expect(host.children).toHaveLength(0);
    expect(host.style.position).toBe("");
    expect(host.style.overflow).toBe("");
    expect(removed.mock.calls.map((c) => c[0]).sort()).toEqual(["pointerdown", "pointermove"]);
    fluid.step(1 / 60);
    expect(fluid.stats().frames).toBe(0);
    fluid.destroy();
  });

  it("falls back to the main thread when the worker factory throws or the worker errors", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = await make({ worker: () => { throw new Error("no workers here"); } });
    expect(a.fluid.stats().pipeline).toBe("main");
    a.fluid.destroy();

    vi.stubGlobal("Worker", class {});
    let fake: { onerror: ((e: unknown) => void) | null; postMessage(): void; terminate(): void } | null = null;
    const b = await make({
      worker: () => (fake = { onerror: null, onmessage: null, postMessage() {}, terminate() {} } as never) as unknown as Worker,
    });
    expect(b.fluid.stats().pipeline).toBe("worker");
    fake!.onerror!(new Event("error"));
    expect(b.fluid.stats().pipeline).toBe("main");
    const spy = spyWrites(b.host);
    b.fluid.step(1 / 60);
    expect(spy.writes).toBe(1);
    b.fluid.destroy();
  });

  it("under prefers-reduced-motion draws one settled frame and redraws only when something changes", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
    const { fluid, host } = await make({ worker: "auto" });
    expect(fluid.stats().pipeline).toBe("main");
    const spy = spyWrites(host);
    for (let i = 0; i < 5; i++) fluid.step(1 / 60);
    expect(spy.writes).toBe(1);
    fluid.impulse(10, 10); // no motion: ignored
    fluid.step(1 / 60);
    expect(spy.writes).toBe(1);
    const zone = fluid.addZone({ el: host, kind: "quiet" });
    fluid.step(1 / 60);
    expect(spy.writes).toBe(2);
    zone.remove();
    fluid.step(1 / 60);
    expect(spy.writes).toBe(3);
    fluid.destroy();
  });

  it("under prefers-reduced-motion a settled idle frame rasterises no target", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce"), addEventListener() {}, removeEventListener() {} }));
    const { fluid, host } = await make({ worker: "auto" });
    const slot = document.createElement("div");
    slot.getBoundingClientRect = () => ({ left: 100, top: 40, right: 260, bottom: 200, width: 160, height: 160, x: 100, y: 40, toJSON() {} }) as DOMRect;
    host.append(slot);
    const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0 });
    const spec = GlyphFluidTargets.mesh(slot, {
      polygons: () => [{ vertices: [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]], color: "#f0e0d0" }], camera, extent: 3,
    });
    let updates = 0;
    const target = fluid.addTarget({
      ...spec,
      create: (ctx) => {
        const impl = spec.create(ctx);
        const update = impl.update.bind(impl);
        impl.update = (dt) => {
          updates++;
          update(dt);
        };
        return impl;
      },
    });
    fluid.step(1 / 60);
    const settled = updates;
    expect(settled).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) fluid.step(1 / 60);
    expect(updates).toBe(settled);
    // A real change still reaches the target.
    target.melt();
    fluid.step(1 / 60);
    target.condense();
    fluid.step(1 / 60);
    fluid.step(1 / 60);
    expect(updates).toBeGreaterThan(settled);
    fluid.destroy();
  });

  it("condense/melt toggle a target and each transition kicks the fluid", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fluid, host } = await make();
    const slot = document.createElement("div");
    slot.getBoundingClientRect = () => ({ left: 100, top: 40, right: 260, bottom: 200, width: 160, height: 160, x: 100, y: 40, toJSON() {} }) as DOMRect;
    host.append(slot);
    const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0 });
    const t = fluid.addTarget(GlyphFluidTargets.mesh(slot, {
      polygons: () => [{ vertices: [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]], color: "#f0e0d0" }], camera, extent: 3,
    }));
    for (let i = 0; i < 30; i++) fluid.step(1 / 30);
    const litOn = fluid.stats().lit;
    expect(t.enabled).toBe(true);
    t.melt();
    expect(t.enabled).toBe(false);
    for (let i = 0; i < 90; i++) fluid.step(1 / 30);
    expect(fluid.stats().lit).toBeLessThan(litOn);
    t.remove();
    fluid.destroy();
  });

  it("relayout() after destroy() starts nothing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("Worker", class {});
    let width = 400, created = 0;
    const host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", { get: () => width });
    Object.defineProperty(host, "clientHeight", { value: 240 });
    document.body.append(host);
    const { fluid } = await make({
      worker: () => (created++, { onerror: null, onmessage: null, postMessage() {}, terminate() {} }) as unknown as Worker,
    }, host);
    expect(created).toBe(1);
    fluid.destroy();
    width = 800;
    fluid.relayout();
    expect(created).toBe(1);
    expect(host.children).toHaveLength(0);
  });

  it("rejects a malformed field colour at the API edge", () => {
    expect(() => createGlyphFluid(sizedHost(), { field: { color: "green" } })).toThrow(TypeError);
  });
});

describe("letter probes", () => {
  it("hands each target the probe results of the letters it submitted, one frame late on the worker", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("Worker", class {});
    const { handleGlyphFluidWorkerMessage } = await import("./protocol");
    const state = { core: null, gen: -1 };
    const w = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      onerror: null,
      postMessage(msg: never, transfer: Transferable[] = []) {
        const got = structuredClone(msg, { transfer });
        queueMicrotask(() => handleGlyphFluidWorkerMessage(state, got, (reply, tr) => {
          const back = structuredClone(reply, { transfer: tr });
          queueMicrotask(() => w.onmessage?.({ data: back } as MessageEvent));
        }));
      },
      terminate() {},
    };
    let frame = 0;
    const got: Array<{ key: unknown; n: number; drawnAt: number }> = [];
    const { fluid, host } = await make({ worker: () => w as unknown as Worker });
    const spy = spyWrites(host);
    fluid.addTarget({
      kind: "reader",
      create: () => ({
        options: { delay: 0, visibility: "always" },
        strengthOn: 0, strengthOff: 0,
        measure() {}, box: () => ({ i0: 0, j0: 0, w: 4, h: 4 }), update() {}, write() {}, dispose() {},
        // frame f submits f + 1 letters, keyed by f
        probes: () => ({ data: new Float64Array(7 * (frame + 1)).fill(2), key: frame }),
        readProbes: (values: Float64Array, key: unknown) => got.push({ key, n: values.length / 4, drawnAt: spy.writes }),
      }),
    });
    for (frame = 0; frame < 6; frame++) {
      fluid.step(1 / 60);
      for (let i = 0; i < 4; i++) await Promise.resolve();
    }
    expect(fluid.stats().pipeline).toBe("worker");
    expect(got.length).toBeGreaterThanOrEqual(4);
    for (const g of got) {
      expect(g.n).toBe((g.key as number) + 1); // results paired with the letters they sampled
      expect(g.drawnAt).toBe((g.key as number) + 1); // delivered with the frame drawn from them
    }
  });
});

describe("document glue", () => {
  it("places the layer at the row origin of the frame it drew, not the newest one (worker, one frame late)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("Worker", class {});
    const { handleGlyphFluidWorkerMessage } = await import("./protocol");
    let sy = 0;
    Object.defineProperty(window, "scrollY", { configurable: true, get: () => sy });
    // the sim's row origin per step, from the scroll ops the runtime actually posted
    const state = { core: null, gen: -1 };
    let cum = 0, delivered = -1;
    const cumAt = new Map<number, number>();
    const w = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      onerror: null,
      postMessage(msg: { kind: string; id: number; input: { ops: Array<[string, number]> } }, transfer: Transferable[] = []) {
        if (msg.kind === "step") {
          for (const op of msg.input.ops) if (op[0] === "scroll") cum += op[1];
          cumAt.set(msg.id, cum);
        }
        const got = structuredClone(msg, { transfer }) as never;
        queueMicrotask(() => handleGlyphFluidWorkerMessage(state, got, (reply, tr) => {
          const back = structuredClone(reply, { transfer: tr });
          queueMicrotask(() => {
            delivered = back.id;
            w.onmessage?.({ data: back } as MessageEvent);
          });
        }));
      },
      terminate() {},
    };
    try {
      const { fluid, host } = await make({ glue: "document", worker: () => w as unknown as Worker });
      const pre = host.querySelector("pre")!;
      const ch = parseFloat(pre.style.lineHeight);
      const r00 = -4; // floor(0 / ch) - MARGIN
      const layerY = () => Number(/translate3d\(0,? ?([-\d.]+)px/.exec(pre.parentElement!.style.transform)![1]);
      let shown = -1, checked = 0;
      for (let f = 0; f < 12; f++) {
        sy += 2.5 * ch; // crosses a row boundary every frame
        window.dispatchEvent(new Event("scroll"));
        if (shown >= 0) expect(layerY()).toBeCloseTo((r00 + cumAt.get(shown)!) * ch - sy, 1);
        const pending = delivered, before = fluid.stats().frames;
        fluid.step(1 / 30);
        if (fluid.stats().frames > before) {
          shown = pending;
          expect(layerY()).toBeCloseTo((r00 + cumAt.get(shown)!) * ch - sy, 1);
          checked++;
        }
        for (let i = 0; i < 4; i++) await Promise.resolve();
      }
      expect(fluid.stats().pipeline).toBe("worker");
      expect(cum).toBeGreaterThan(20);
      expect(checked).toBeGreaterThanOrEqual(8);
      fluid.destroy();
    } finally {
      delete (window as { scrollY?: number }).scrollY;
    }
  });
});
