// a landing-page fluid, rebuilt on @glyphcss/fluid (the spike page on the
// `feat/fluid` branch, bench/fluid-spike, ported to the package). Headings are text
// targets, prose is quiet zones, the pool is a pool zone, and each mesh slot is a mesh
// target fed a spinning solid, re-rasterised with glyphcss every frame.
//
// Query: ?worker=0 (main thread) · ?fps=30|60 · ?meshes=off · ?hud=0
import { createGlyphFluid, GlyphFluidTargets, type GlyphFluidTarget } from "@glyphcss/fluid";
import { createGlyphOrthographicCamera, type Polygon } from "glyphcss";

const q = new URLSearchParams(location.search);
const FPS = Number(q.get("fps") ?? 60) === 30 ? 30 : 60;
const WORKER = q.get("worker") !== "0";
const MESHES = q.get("meshes") !== "off";
const FACE = q.get("face") === "universal" ? "universal" : "dots";

const host = document.getElementById("fluid")!;
const fluid = createGlyphFluid(host, {
  glue: "document",
  pointer: "window",
  fps: FPS,
  fpsFallback: false, // the bench measures the cap it asked for
  face: FACE,
  worker: WORKER ? () => new Worker("fluid-worker.bundle.js", { type: "module" }) : false,
});

for (const el of document.querySelectorAll<HTMLElement>("[data-fluid-word]"))
  fluid.addTarget(GlyphFluidTargets.text(el, { color: el.dataset.fluidColor, delay: Number(el.dataset.fluidDelay ?? 0), visibility: "viewport" }));
for (const el of document.querySelectorAll<HTMLElement>("[data-fluid-quiet]")) fluid.addZone({ el, kind: "quiet" });
for (const el of document.querySelectorAll<HTMLElement>("[data-fluid-pool]")) fluid.addZone({ el, kind: "pool" });

type V3 = [number, number, number];

/** A parametric surface as triangles: u runs around (closed), v from one pole/ring to the next. */
function surface(nu: number, nv: number, at: (u: number, v: number) => V3, closedV: boolean): V3[][] {
  const out: V3[][] = [];
  for (let i = 0; i < nu; i++)
    for (let j = 0; j < nv; j++) {
      const a = at(i / nu, j / nv), b = at((i + 1) / nu, j / nv), c = at((i + 1) / nu, (j + 1) / nv), d = at(i / nu, (j + 1) / nv);
      if (closedV || j > 0) out.push([a, b, c]);
      if (closedV || j < nv - 1) out.push([a, c, d]);
    }
  return out;
}

/** Smooth solids, so the shading has a gradient the mesh target can turn into ink. Rebuilt and spun every frame. */
const SHAPES: Record<string, V3[][]> = {
  sphere: surface(28, 18, (u, v) => {
    const t = u * Math.PI * 2, p = v * Math.PI;
    return [1.3 * Math.sin(p) * Math.cos(t), 1.3 * Math.sin(p) * Math.sin(t), 1.3 * Math.cos(p)];
  }, true),
  torus: surface(32, 16, (u, v) => {
    const t = u * Math.PI * 2, p = v * Math.PI * 2, r = 1 + 0.45 * Math.cos(p);
    return [r * Math.cos(t), r * Math.sin(t), 0.45 * Math.sin(p) + 0.3 * Math.sin(t * 2)];
  }, true),
};
const COLORS: Record<string, string> = { sphere: "#3ccf96", torus: "#f2a65a" };

/** One mesh slot: a spinning solid fed to a mesh target. */
class MeshSlot {
  camera = createGlyphOrthographicCamera({ rotX: 60, rotY: 0 });
  target: GlyphFluidTarget | null = null;
  ids: string[];
  id = "sphere";
  idx = -1;
  spin = 0;
  last = performance.now();

  constructor(private el: HTMLElement) {
    this.ids = (el.dataset.fluidMesh ?? "").split(",").filter(Boolean);
  }

  show(id: string) {
    if (this.target) this.target.remove();
    this.id = id;
    this.shape = SHAPES[id]!;
    this.target = fluid.addTarget(GlyphFluidTargets.mesh(this.el, {
      polygons: () => this.polygons(), camera: this.camera, extent: 3.6,
      light: { direction: [-0.5, 0.5, 0.7], intensity: 1 }, ambient: 0.4, features: false, visibility: "viewport",
    }));
  }
  shape = SHAPES.sphere!;

  polygons(): Polygon[] {
    const now = performance.now();
    this.spin += Math.min(1 / 30, (now - this.last) / 1000);
    this.last = now;
    const c = Math.cos(this.spin), n = Math.sin(this.spin);
    const rot = ([x, y, z]: [number, number, number]): [number, number, number] => [x * c - y * n, x * n + y * c, z];
    return this.shape.map((t) => ({ vertices: t.map(rot), color: COLORS[this.id]! }));
  }

  /** Page clock: cycle shapes (melt for the last 1.6 s of each period). */
  tick(t: number) {
    const delay = Number(this.el.dataset.fluidDelay ?? 0), every = Number(this.el.dataset.fluidEvery ?? 0);
    if (t < delay || !this.ids.length) return;
    const k = every ? (t - delay) / every : 0;
    const want = every && this.ids.length > 1 ? Math.floor(k) % this.ids.length : 0;
    const off = every > 0 && this.ids.length > 1 && k - Math.floor(k) > 1 - 1.6 / every;
    if (want !== this.idx && !off) {
      this.idx = want;
      this.show(this.ids[want]!);
    }
    if (off) this.target?.melt();
    else this.target?.condense();
  }
}

const slots = MESHES ? [...document.querySelectorAll<HTMLElement>("[data-fluid-mesh]")].map((el) => new MeshSlot(el)) : [];

// ---- bench instrumentation: drawn frames are marked from a MutationObserver on the <pre>,
// which fires at the microtask checkpoint inside the drawing rAF task
const frameTimes: number[] = [];
const t0 = performance.now();
let lastT = t0;
await fluid.ready;
const pre = host.querySelector("pre")!;
new MutationObserver(() => {
  performance.mark("fluid-draw");
  frameTimes.push(performance.now());
}).observe(pre, { childList: true, characterData: true, subtree: true });

const pageTick = (now: number) => {
  requestAnimationFrame(pageTick);
  const dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  for (const s of slots) s.tick((now - t0) / 1000);
};
requestAnimationFrame(pageTick);

const pct = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]! : 0);
function stats() {
  const s = fluid.stats();
  const iv = frameTimes.slice(1).map((t, i) => t - frameTimes[i]!);
  const span = frameTimes.length > 1 ? frameTimes[frameTimes.length - 1]! - frameTimes[0]! : 0;
  const expected = span / (1000 / FPS);
  return {
    ...s, worker: s.pipeline === "worker", drawn: frameTimes.length,
    droppedPct: expected ? Math.max(0, (1 - (frameTimes.length - 1) / expected) * 100) : 0,
    intervalP50: pct(iv, 50), intervalP95: pct(iv, 95), domNodes: document.getElementsByTagName("*").length,
  };
}
(window as unknown as Record<string, unknown>).__fluid = {
  fluid, stats,
  reset: () => {
    frameTimes.length = 0;
    performance.clearMarks();
  },
};

if (q.get("hud") !== "0") {
  const hud = document.createElement("div");
  hud.className = "hud";
  const out = document.createElement("pre");
  hud.append(out);
  document.body.append(hud);
  setInterval(() => {
    const s = stats();
    out.textContent = `${s.cols}×${s.rows} ${s.pipeline} ${s.encoding} fps ${s.fps}\nstep ${s.stepMs.toFixed(2)} ms  stalls ${s.stalls}\ninterval p50 ${s.intervalP50.toFixed(1)} p95 ${s.intervalP95.toFixed(1)}  dropped ${s.droppedPct.toFixed(1)}%\nlit ${s.lit}`;
    if (frameTimes.length > 120) frameTimes.splice(0, frameTimes.length - 120);
  }, 500);
}
