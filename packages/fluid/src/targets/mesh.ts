// A mesh → ink, rasterised by glyphcss itself (no WebGL). Two `compileScene` passes on a
// 2W × 2H grid, as the reference's CreatureTarget did with three.js offscreen: unlit albedo, then
// a white Lambert pass for the light term. Read back at 2 × 2 samples per cell into
// coverage, shaded colour and luminance; very dark covered cells become FEATURES (eyes,
// mouth — in a dot field dark reads as empty and would erase the face); luminance is
// auto-exposed over the covered range. The target box is an inscribed ellipse, like the
// creature's round panel.
import { compileScene, type CompileSceneOptions, type GlyphCamera, type Polygon } from "glyphcss";
import type { Vec3 } from "@glyphcss/core";
import { glyphFluidShadeInk, mergeGlyphFluidCells } from "./raster";
import { elementRect, resolveTargetOptions, type GlyphFluidCellBox, type GlyphFluidLayout, type GlyphFluidTargetImpl, type GlyphFluidTargetOptions } from "./types";
import type { GlyphFluidTargetFrame } from "./frame";

export interface GlyphFluidMeshTargetOptions extends GlyphFluidTargetOptions {
  /** The posed polygons, read every frame (animate by returning new vertices). */
  polygons: () => readonly Polygon[];
  /** Camera for both passes. */
  camera: GlyphCamera;
  /**
   * World units spanned by the target's width. When set the target owns `camera.zoom`
   * and rewrites it on every measure; omit it to keep a zoom you manage yourself
   * (the internal grid is 2 × the target's cells, at glyphcss's headless 50 px row).
   */
  extent?: number;
  /** Key light for the shading pass. Default: `compileScene`'s default light. */
  light?: { direction?: Vec3; intensity?: number };
  /** Ambient term of the shading pass. Default 0.4. */
  ambient?: number;
  /** Mark dark covered cells as solid feature blocks. Default true. */
  features?: boolean;
  /** Breathe with the background (sample slightly scaled about the centre). Default true. */
  swell?: boolean;
}

const BASE_TILE = 50;
const DEFAULT_LIGHT = { direction: [0.5, 0.7, 0.5] as Vec3, intensity: 1 };

export class GlyphFluidMeshTarget implements GlyphFluidTargetImpl {
  readonly options;
  readonly strengthOn = 0.6;
  readonly strengthOff = 0.8;
  private cellBox: GlyphFluidCellBox | null = null;
  private aspect = 1.6;
  private W = 0;
  private H = 0;
  // read-back buffers (per target cell) and the persistent local target (per target cell)
  private cov = new Float32Array(0); private lum = new Float32Array(0);
  private cr = new Float32Array(0); private cg = new Float32Array(0); private cb = new Float32Array(0); private f = new Float32Array(0);
  private T = new Float32Array(0); private TR = new Float32Array(0); private TG = new Float32Array(0); private TB = new Float32Array(0); private TF = new Float32Array(0);
  private X = new Float32Array(0); private Y = new Float32Array(0); private inside = new Uint8Array(0);
  private dirty = true;

  constructor(private el: HTMLElement, private o: GlyphFluidMeshTargetOptions) {
    this.options = resolveTargetOptions(o);
  }

  measure(layout: GlyphFluidLayout): void {
    const { cw, ch } = layout;
    const r = elementRect(this.el, layout);
    const w = Math.max(8, Math.round(r.width / cw)),
      h = Math.max(4, Math.round(r.height / ch));
    const i0 = Math.round((r.x + r.width / 2) / cw - w / 2),
      j0 = Math.round((r.y + r.height / 2) / ch - h / 2);
    this.cellBox = { i0, j0, w, h };
    this.aspect = ch / cw;
    if (w !== this.W || h !== this.H) {
      this.W = w;
      this.H = h;
      const N = w * h, F = () => new Float32Array(N);
      this.cov = F(); this.lum = F(); this.cr = F(); this.cg = F(); this.cb = F(); this.f = F();
      this.T = F(); this.TR = F(); this.TG = F(); this.TB = F(); this.TF = F();
      this.X = F(); this.Y = F(); this.inside = new Uint8Array(N);
      for (let j = 0; j < h; j++)
        for (let i = 0; i < w; i++) {
          const k = j * w + i, x = ((i + 0.5) / w) * 2 - 1, y = ((j + 0.5) / h) * 2 - 1;
          this.X[k] = x;
          this.Y[k] = y;
          this.inside[k] = x * x + y * y <= 1 && i > 0 && j > 0 && i < w - 1 && j < h - 1 ? 1 : 0;
        }
    }
    if (this.o.extent !== undefined) this.o.camera.zoom = (w * 2 * (BASE_TILE / this.aspect)) / this.o.extent;
    this.dirty = true;
  }

  box(): GlyphFluidCellBox | null {
    return this.cellBox;
  }

  private pass(polygons: Polygon[], lit: boolean) {
    const light = { ...DEFAULT_LIGHT, ...this.o.light };
    const opts: CompileSceneOptions = {
      polygons, camera: this.o.camera, cols: this.W * 2, rows: this.H * 2, cellAspect: this.aspect, mode: "solid", doubleSided: true,
      directionalLight: { direction: light.direction, intensity: lit ? light.intensity : 0 },
      ambientLight: { intensity: lit ? (this.o.ambient ?? 0.4) : 1 },
    };
    return compileScene(opts).grid!;
  }

  update(): void {
    if (!this.cellBox) return;
    this.dirty = false;
    const polys = this.o.polygons();
    const A = this.pass([...polys], false);
    const B = this.pass(polys.map((p) => ({ ...p, color: "#ffffff" })), true);
    const { W, H } = this, RW = W * 2, N = W * H;
    const rgb = (c: string | null) => (c ? parseInt(c.slice(1), 16) : 0);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        let cov = 0, cr = 0, cg = 0, cb = 0;
        for (let sy = 0; sy < 2; sy++)
          for (let sx = 0; sx < 2; sx++) {
            const q = (j * 2 + sy) * RW + i * 2 + sx;
            if (A.depth[q]! === -Infinity) continue;
            const a = rgb(A.color[q]!);
            const kk = B.depth[q]! !== -Infinity ? Math.min(1, ((rgb(B.color[q]!) >> 16) & 255) / 255) : 1;
            cov++;
            cr += ((a >> 16) / 255) * kk;
            cg += (((a >> 8) & 255) / 255) * kk;
            cb += ((a & 255) / 255) * kk;
          }
        const k = j * W + i;
        this.cov[k] = cov / 4;
        if (cov) { cr /= cov; cg /= cov; cb /= cov; }
        this.cr[k] = cr; this.cg[k] = cg; this.cb[k] = cb;
        this.lum[k] = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
      }
    const features = this.o.features ?? true;
    for (let k = 0; k < N; k++) this.f[k] = features && this.cov[k]! > 0.5 && this.lum[k]! < 0.22 ? 1 : 0;
    let lo = 1, hi = 0;
    for (let k = 0; k < N; k++) if (this.cov[k]! > 0.5) { const l = this.lum[k]!; if (l < lo) lo = l; if (l > hi) hi = l; }
    const span = Math.max(0.15, hi - lo);
    for (let k = 0; k < N; k++) this.lum[k] = Math.max(0, Math.min(1, (this.lum[k]! - lo) / span));
  }

  write(frame: GlyphFluidTargetFrame, r0: number, swell: number): void {
    if (!this.cellBox) return;
    if (this.dirty) this.update();
    const { W, H, T, TR, TG, TB, TF, X, Y, inside } = this;
    const s = this.o.swell === false ? 1 : swell;
    for (let k = 0; k < W * H; k++) {
      if (!inside[k]) { T[k] = 0; continue; }
      let fx = ((X[k]! / s + 1) / 2) * W - 0.5, fy = ((Y[k]! / s + 1) / 2) * H - 0.5;
      fx = Math.max(0, Math.min(W - 1.001, fx)); fy = Math.max(0, Math.min(H - 1.001, fy));
      const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0, q = y0 * W + x0;
      const bl = (a: Float32Array) => (a[q]! * (1 - ax) + a[q + 1]! * ax) * (1 - ay) + (a[q + W]! * (1 - ax) + a[q + W + 1]! * ax) * ay;
      const c = bl(this.cov), l = bl(this.lum);
      T[k] = glyphFluidShadeInk(c, l);
      TF[k] = this.f[Math.round(fy) * W + Math.round(fx)]!;
      // below 5 % coverage the colour keeps its last value instead of dividing noise
      if (c > 0.05) { TR[k] = bl(this.cr) / Math.max(c, 0.25); TG[k] = bl(this.cg) / Math.max(c, 0.25); TB[k] = bl(this.cb) / Math.max(c, 0.25); }
    }
    mergeGlyphFluidCells(frame, this.cellBox, r0, 0.004, T, TR, TG, TB, TF);
  }

  dispose(): void {}
}
