// molty.uno's landing-page fluid, rebuilt on @glyphcss/fluid (the spike page on the
// `feat/fluid` branch, bench/fluid-spike, ported to the package). Headings are text
// targets, prose is quiet zones, the pool is a pool zone, and each Molty slot is a mesh
// target fed by the cute kit's three.js rig (three is only the animation rig here: the
// package rasterises the posed triangles with glyphcss).
//
// Query: ?worker=0 (main thread) · ?fps=30|60 · ?moltys=off · ?hud=0
import * as THREE from "three";
import { createGlyphFluid, GlyphFluidTargets, type GlyphFluidTarget } from "@glyphcss/fluid";
import { createGlyphOrthographicCamera, type Polygon } from "glyphcss";
import { CuteCreature } from "../vendor/creatures/cute/kit.js";
import { CUTE_CATALOG } from "../vendor/creatures/cute/index.js";
import { MoodEngine } from "../vendor/creatures/mood.js";

const q = new URLSearchParams(location.search);
const FPS = Number(q.get("fps") ?? 60) === 30 ? 30 : 60;
const WORKER = q.get("worker") !== "0";
const MOLTYS = q.get("moltys") !== "off";
const DANCE: Array<[string, number]> = [["idle", 1.6], ["happy", 3.2], ["idle", 1.8], ["surprised", 1.0], ["happy", 3.6], ["listening", 1.8]];

const host = document.getElementById("fluid")!;
const fluid = createGlyphFluid(host, {
  glue: "document",
  pointer: "window",
  fps: FPS,
  fpsFallback: false, // the bench measures the cap it asked for
  worker: WORKER ? () => new Worker("fluid-worker.bundle.js", { type: "module" }) : false,
});

for (const el of document.querySelectorAll<HTMLElement>("[data-fluid-word]"))
  fluid.addTarget(GlyphFluidTargets.text(el, { color: el.dataset.fluidColor, delay: Number(el.dataset.fluidDelay ?? 0), visibility: "viewport" }));
for (const el of document.querySelectorAll<HTMLElement>("[data-fluid-quiet]")) fluid.addZone({ el, kind: "quiet" });
for (const el of document.querySelectorAll<HTMLElement>("[data-fluid-pool]")) fluid.addZone({ el, kind: "pool" });

/** One Molty slot: the cute-kit rig posed by a MoodEngine, framed like molty's CreatureTarget. */
class MoltySlot {
  creature: CuteCreature | null = null;
  engine = new MoodEngine();
  cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 100);
  camera = createGlyphOrthographicCamera({ useMat: true, mat: [1, 0, 0, 0, 1, 0, 0, 0, 1] });
  keyDir: [number, number, number];
  target: GlyphFluidTarget | null = null;
  ids: string[];
  idx = -1;
  last = performance.now();
  danceI = 0;
  danceT = 0;
  hopT = 0;
  half = 1;
  private v = new THREE.Vector3();

  constructor(private el: HTMLElement) {
    this.ids = (el.dataset.fluidMolty ?? "").split(",").filter(Boolean);
    const d = new THREE.Vector3(0.5, 1, 1).normalize();
    this.keyDir = [d.x, d.y, d.z];
  }

  show(id: string) {
    const entry = CUTE_CATALOG.find((c: { id: string }) => c.id === id);
    if (!entry) return;
    this.creature?.dispose();
    this.creature = new CuteCreature(entry);
    this.frame(this.creature.envelope);
    this.danceI = 0;
    this.danceT = 0;
    this.engine.set(DANCE[0]![0]);
    const extent = 2 * this.half;
    if (this.target) this.target.remove();
    this.target = fluid.addTarget(GlyphFluidTargets.mesh(this.el, {
      polygons: () => this.polygons(), camera: this.camera, extent,
      light: { direction: this.keyDir, intensity: 1 }, ambient: 0.4, visibility: "viewport",
    }));
  }

  /** molty's CreatureTarget._frame: fit the motion envelope's hull into the round panel. */
  frame(env: { min: THREE.Vector3; max: THREE.Vector3; rise?: number }) {
    const STD = { min: [-0.36, 0, -0.36], max: [0.36, 1.26, 0.36] };
    const lo = [Math.min(env.min.x, STD.min[0]!), 0, Math.min(env.min.z, STD.min[2]!)];
    const hi = [Math.max(env.max.x, STD.max[0]!), Math.max(env.max.y, STD.max[1]!), Math.max(env.max.z, STD.max[2]!)];
    const rx = Math.max(-lo[0]!, hi[0]!), rz = Math.max(-lo[2]!, hi[2]!), restTop = hi[1]! - (env.rise || 0), pts: THREE.Vector3[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, cx = Math.cos(a) * rx, cz = Math.sin(a) * rz;
      for (const [y, r] of [[lo[1]!, 0.75], [restTop * 0.55, 1], [hi[1]!, 0.55]]) pts.push(new THREE.Vector3(cx * r!, y, cz * r!));
    }
    const dir = new THREE.Vector3(0.38, 0.28, 1).normalize();
    const target = new THREE.Vector3(0, (lo[1]! + hi[1]!) / 2 - 0.03, 0);
    this.cam.position.copy(target).addScaledVector(dir, 10);
    this.cam.lookAt(target);
    this.cam.updateMatrixWorld();
    const inv = this.cam.matrixWorldInverse, vt = target.clone().applyMatrix4(inv), v = new THREE.Vector3();
    let half = 0;
    for (const c of pts) {
      v.copy(c).applyMatrix4(inv).sub(vt);
      half = Math.max(half, Math.hypot(v.x, v.y));
    }
    this.half = half * 0.98;
    // three's view rotation as a glyphcss useMat camera; useMat applies `mat` to
    // (v.y, v.x, v.z) — glyphcss.c's axis swap — so columns 0/1 swap, and screen y is down
    const m = this.cam.matrixWorldInverse.elements;
    this.camera.mat = [m[4]!, m[0]!, m[8]!, -m[5]!, -m[1]!, -m[9]!, m[6]!, m[2]!, m[10]!];
    this.camera.target = [target.x, target.y, target.z];
  }

  polygons(): Polygon[] {
    const now = performance.now(), dt = Math.min(1 / 30, (now - this.last) / 1000);
    this.last = now;
    const c = this.creature!;
    c.update(dt, this.engine.update(dt));
    const out: Polygon[] = [], v = this.v;
    c.root.updateMatrixWorld(true);
    c.root.traverseVisible((o: THREE.Object3D) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const color = "#" + (mesh.material as THREE.MeshLambertMaterial).color.getHexString();
      const pos = mesh.geometry.getAttribute("position"), idx = mesh.geometry.getIndex();
      const n = idx ? idx.count : pos.count;
      const at = (i: number): [number, number, number] => {
        v.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
        return [v.x, v.y, v.z];
      };
      for (let i = 0; i + 2 < n; i += 3) out.push({ vertices: [at(i), at(i + 1), at(i + 2)], color });
    });
    return out;
  }

  /** Page clock: cycle creatures (melt for the last 1.6 s of each period), dance, hop. */
  tick(t: number, dt: number) {
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
    this.danceT += dt;
    if (this.danceT > DANCE[this.danceI]![1]) {
      this.danceI = (this.danceI + 1) % DANCE.length;
      this.danceT = 0;
      this.engine.set(DANCE[this.danceI]![0]);
    }
    if (DANCE[this.danceI]![0] !== "happy" || off) return;
    this.hopT += dt;
    if (this.hopT > 0.476) {
      this.hopT = 0;
      const r = this.el.getBoundingClientRect();
      fluid.impulse(r.left + r.width / 2, r.top + r.height * 0.81, { strength: 0.55, radius: 0.03 });
    }
  }
}

const slots = MOLTYS ? [...document.querySelectorAll<HTMLElement>("[data-fluid-molty]")].map((el) => new MoltySlot(el)) : [];

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
  for (const s of slots) s.tick((now - t0) / 1000, dt);
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
