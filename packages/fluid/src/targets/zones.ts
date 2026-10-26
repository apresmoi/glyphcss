// Zones shape the background floor (BGM) instead of adding ink: `quiet` dims the field
// under prose so text over it stays readable; `pool` deepens it into an elliptical well.
import type { GlyphFluidTargetFrame } from "./frame";
import { elementRect, type GlyphFluidLayout } from "./types";

export interface GlyphFluidZoneOptions {
  el: HTMLElement;
  kind: "quiet" | "pool";
  /** Floor multiplier inside the zone. Default 0.12 (quiet) / 3.2 (pool). */
  level?: number;
}

/** A zone's extent in content cells (inclusive ends). */
export interface GlyphFluidZoneBox {
  pool: boolean;
  level: number;
  i0: number;
  i1: number;
  j0: number;
  j1: number;
}

export function measureGlyphFluidZone(z: GlyphFluidZoneOptions, layout: GlyphFluidLayout): GlyphFluidZoneBox {
  const r = elementRect(z.el, layout), { cw, ch } = layout;
  const pool = z.kind === "pool";
  return {
    pool, level: z.level ?? (pool ? 3.2 : 0.12),
    i0: Math.floor(r.x / cw), i1: Math.ceil((r.x + r.width) / cw), j0: Math.floor(r.y / ch), j1: Math.ceil((r.y + r.height) / ch),
  };
}

const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** Reset BGM to 1 and apply every zone (later zones over earlier ones). */
export function writeGlyphFluidZones(frame: GlyphFluidTargetFrame, zones: readonly GlyphFluidZoneBox[], r0: number): void {
  const { cols: W, rows: H, BGM } = frame;
  BGM.fill(1);
  for (const z of zones) {
    if (z.pool) {
      const ci = (z.i0 + z.i1) / 2, cj = (z.j0 + z.j1) / 2, ri = (z.i1 - z.i0) / 2, rj = (z.j1 - z.j0) / 2;
      for (let jd = z.j0; jd <= z.j1; jd++) {
        const j = jd - r0;
        if (j < 0 || j >= H) continue;
        for (let i = Math.max(0, z.i0); i <= Math.min(W - 1, z.i1); i++) {
          const d = Math.hypot((i - ci) / ri, (jd - cj) / rj);
          if (d < 1) BGM[j * W + i] = 1 + (z.level - 1) * smooth((1 - d) / 0.7);
        }
      }
      continue;
    }
    // quiet: the level inside, half-way on a one-cell rim so the edge is soft
    for (let jd = z.j0 - 1; jd <= z.j1; jd++) {
      const j = jd - r0;
      if (j < 0 || j >= H) continue;
      const edgeY = jd < z.j0 || jd === z.j1;
      for (let i = Math.max(0, z.i0 - 1); i <= Math.min(W - 1, z.i1); i++) {
        const edge = edgeY || i < z.i0 || i === z.i1;
        const k = j * W + i;
        BGM[k] = edge ? (BGM[k]! + z.level) / 2 : z.level;
      }
    }
  }
}
