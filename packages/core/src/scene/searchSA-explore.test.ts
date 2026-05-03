/**
 * Long SA exploration runs — multiple seeds, more iterations, analysis of
 * what the search actually changes vs the v3 baseline.
 */
import { describe, it } from "vitest";
import type { Voxel } from "../types";
import { score, simulatedAnnealing } from "./searchSA";

function buildSphereV3(radius: number): Voxel[] {
  const r = Math.max(1, Math.floor(radius));
  const r2 = r * r;
  const PAD = 1;
  const span = r * 2 + PAD * 2;
  const inside = (x: number, y: number, z: number): boolean => {
    const dx = x - PAD - r + 0.5;
    const dy = y - PAD - r + 0.5;
    const dz = z - PAD - r + 0.5;
    return dx * dx + dy * dy + dz * dz <= r2;
  };
  type Col = { botZ: number; topZ: number; hasHigher: boolean };
  const cols: (Col | null)[] = new Array(span * span).fill(null);
  for (let x = 0; x < span; x++) {
    for (let y = 0; y < span; y++) {
      let botZ = -1, topZ = -1;
      for (let z = 0; z < span; z++) {
        if (inside(x, y, z)) {
          if (botZ === -1) botZ = z;
          topZ = z;
        }
      }
      if (botZ !== -1) cols[x * span + y] = { botZ, topZ, hasHigher: false };
    }
  }
  const getTop = (x: number, y: number): number =>
    x >= 0 && x < span && y >= 0 && y < span && cols[x * span + y]
      ? cols[x * span + y]!.topZ
      : -1;
  for (let x = 0; x < span; x++) {
    for (let y = 0; y < span; y++) {
      const c = cols[x * span + y];
      if (!c) continue;
      const t = c.topZ;
      if (getTop(x + 1, y) > t || getTop(x - 1, y) > t || getTop(x, y + 1) > t || getTop(x, y - 1) > t) c.hasHigher = true;
    }
  }
  const out: Voxel[] = [];
  const cubeTop = (c: Col) => (c.hasHigher ? c.topZ : c.topZ + 1);
  const claimed = new Uint8Array(span * span);
  for (let x = 0; x < span; x++) {
    for (let y = 0; y < span; y++) {
      if (claimed[x * span + y]) continue;
      const c = cols[x * span + y];
      if (!c) continue;
      const cTop = cubeTop(c);
      if (cTop <= c.botZ) { claimed[x * span + y] = 1; continue; }
      let x2 = x + 1;
      while (x2 < span) {
        const o = cols[x2 * span + y];
        if (!o || claimed[x2 * span + y]) break;
        if (o.botZ !== c.botZ || cubeTop(o) !== cTop) break;
        x2++;
      }
      let y2 = y + 1;
      outer: while (y2 < span) {
        for (let xi = x; xi < x2; xi++) {
          const o = cols[xi * span + y2];
          if (!o || claimed[xi * span + y2]) break outer;
          if (o.botZ !== c.botZ || cubeTop(o) !== cTop) break outer;
        }
        y2++;
      }
      for (let xi = x; xi < x2; xi++) for (let yi = y; yi < y2; yi++) claimed[xi * span + yi] = 1;
      out.push({ x, y, z: c.botZ, x2, y2, z2: cTop });
    }
  }
  const cornerClaimed = new Uint8Array(span * span);
  for (let x = 0; x < span; x++) {
    for (let y = 0; y < span; y++) {
      const t = getTop(x, y);
      if (t < 0) continue;
      const tXp = getTop(x + 1, y), tXn = getTop(x - 1, y);
      const tYp = getTop(x, y + 1), tYn = getTop(x, y - 1);
      const hXp = tXp > t, hXn = tXn > t, hYp = tYp > t, hYn = tYn > t;
      const num = (hXp ? 1 : 0) + (hXn ? 1 : 0) + (hYp ? 1 : 0) + (hYn ? 1 : 0);
      if (num !== 2) continue;
      if (hXp && hXn) continue;
      if (hYp && hYn) continue;
      let rot: number;
      if (hXn && hYn) rot = 90;
      else if (hXp && hYn) rot = 0;
      else if (hXp && hYp) rot = 270;
      else rot = 180;
      const apexTop = Math.max(hXp ? tXp : -1, hXn ? tXn : -1, hYp ? tYp : -1, hYn ? tYn : -1);
      cornerClaimed[x * span + y] = 1;
      out.push({ x, y, z: t, x2: x + 1, y2: y + 1, z2: apexTop + 1, shape: "spike", rot });
    }
  }
  const RAMP_DIRS = [
    { dx: +1, dy: 0, rot: 270, perpAxis: "y" as const },
    { dx: -1, dy: 0, rot: 90, perpAxis: "y" as const },
    { dx: 0, dy: +1, rot: 180, perpAxis: "x" as const },
    { dx: 0, dy: -1, rot: 0, perpAxis: "x" as const },
  ];
  for (const dir of RAMP_DIRS) {
    const rampClaimed = new Uint8Array(span * span);
    if (dir.perpAxis === "y") {
      for (let x = 0; x < span; x++) {
        for (let y = 0; y < span; y++) {
          if (rampClaimed[x * span + y] || cornerClaimed[x * span + y]) continue;
          const t = getTop(x, y);
          if (t < 0) continue;
          const nt = getTop(x + dir.dx, y);
          if (nt <= t) continue;
          const drop = nt - t;
          let y2 = y + 1;
          while (y2 < span) {
            if (rampClaimed[x * span + y2] || cornerClaimed[x * span + y2]) break;
            const t2 = getTop(x, y2);
            const nt2 = getTop(x + dir.dx, y2);
            if (t2 !== t || nt2 - t2 !== drop) break;
            y2++;
          }
          for (let yi = y; yi < y2; yi++) rampClaimed[x * span + yi] = 1;
          out.push({ x, y, z: t, x2: x + 1, y2, z2: nt + 1, shape: "ramp", rot: dir.rot });
        }
      }
    } else {
      for (let y = 0; y < span; y++) {
        for (let x = 0; x < span; x++) {
          if (rampClaimed[x * span + y] || cornerClaimed[x * span + y]) continue;
          const t = getTop(x, y);
          if (t < 0) continue;
          const nt = getTop(x, y + dir.dy);
          if (nt <= t) continue;
          const drop = nt - t;
          let x2 = x + 1;
          while (x2 < span) {
            if (rampClaimed[x2 * span + y] || cornerClaimed[x2 * span + y]) break;
            const t2 = getTop(x2, y);
            const nt2 = getTop(x2, y + dir.dy);
            if (t2 !== t || nt2 - t2 !== drop) break;
            x2++;
          }
          for (let xi = x; xi < x2; xi++) rampClaimed[xi * span + y] = 1;
          out.push({ x, y, z: t, x2, y2: y + 1, z2: nt + 1, shape: "ramp", rot: dir.rot });
        }
      }
    }
  }
  return out;
}

function buildSphereCells(radius: number): Set<string> {
  const r = Math.max(1, Math.floor(radius));
  const r2 = r * r;
  const PAD = 1;
  const span = r * 2 + PAD * 2;
  const cells = new Set<string>();
  for (let x = 0; x < span; x++) {
    for (let y = 0; y < span; y++) {
      for (let z = 0; z < span; z++) {
        const dx = x - PAD - r + 0.5;
        const dy = y - PAD - r + 0.5;
        const dz = z - PAD - r + 0.5;
        if (dx * dx + dy * dy + dz * dz <= r2) cells.add(`${x}:${y}:${z}`);
      }
    }
  }
  return cells;
}

interface RunStats {
  seed: number;
  initial: ReturnType<typeof score>;
  final: ReturnType<typeof score>;
  voxelCount: number;
  acceptedCount: number;
}

function explore(r: number, seeds: number[], iterations: number): { best: RunStats; bestVoxels: Voxel[]; allRuns: RunStats[] } {
  const reference = buildSphereCells(r);
  const initial = buildSphereV3(r);
  const initialScore = score(initial, reference);
  let bestRun: RunStats | null = null;
  let bestVoxels: Voxel[] = initial;
  const allRuns: RunStats[] = [];
  for (const seed of seeds) {
    const result = simulatedAnnealing(initial, reference, {
      iterations,
      T0: 60,
      cooling: 0.9997,
      seed,
    });
    const stats: RunStats = {
      seed,
      initial: initialScore,
      final: result.bestScore,
      voxelCount: result.bestVoxels.length,
      acceptedCount: result.acceptedCount,
    };
    allRuns.push(stats);
    if (!bestRun || result.bestScore.total < bestRun.final.total) {
      bestRun = stats;
      bestVoxels = result.bestVoxels;
    }
  }
  return { best: bestRun!, bestVoxels, allRuns };
}

function shapeBreakdown(voxels: Voxel[]): Record<string, number> {
  const out: Record<string, number> = { cube: 0, ramp: 0, spike: 0, wedge: 0 };
  for (const v of voxels) {
    const k = v.shape ?? "cube";
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

describe("SA exploration: multi-seed runs to find best decomposition", () => {
  it("r=4: 6 seeds × 5000 iters", () => {
    const r = 4;
    const seeds = [1, 2, 3, 4, 5, 6];
    const iters = 5000;
    const { best, allRuns } = explore(r, seeds, iters);
    // eslint-disable-next-line no-console
    console.log(
      `\nr=${r}: v3 score=${allRuns[0].initial.total.toFixed(0)} ` +
        `(gaps=${allRuns[0].initial.gaps}, def=${allRuns[0].initial.geomDefects}, iou=${allRuns[0].initial.iou.toFixed(3)})`
    );
    for (const run of allRuns) {
      // eslint-disable-next-line no-console
      console.log(
        `  seed=${run.seed}: final=${run.final.total.toFixed(0)} ` +
          `(gaps=${run.final.gaps}, def=${run.final.geomDefects}, iou=${run.final.iou.toFixed(3)}, voxels=${run.voxelCount})`
      );
    }
    // eslint-disable-next-line no-console
    console.log(`  → BEST: seed=${best.seed} total=${best.final.total.toFixed(0)}`);
  }, 120_000);

  it("r=8: 6 seeds × 12000 iters", () => {
    const r = 8;
    const seeds = [1, 2, 3, 4, 5, 6];
    const iters = 12000;
    const { best, bestVoxels, allRuns } = explore(r, seeds, iters);
    // eslint-disable-next-line no-console
    console.log(
      `\nr=${r}: v3 score=${allRuns[0].initial.total.toFixed(0)} ` +
        `(gaps=${allRuns[0].initial.gaps}, def=${allRuns[0].initial.geomDefects}, iou=${allRuns[0].initial.iou.toFixed(3)})`
    );
    for (const run of allRuns) {
      // eslint-disable-next-line no-console
      console.log(
        `  seed=${run.seed}: final=${run.final.total.toFixed(0)} ` +
          `(gaps=${run.final.gaps}, def=${run.final.geomDefects}, iou=${run.final.iou.toFixed(3)}, voxels=${run.voxelCount})`
      );
    }
    // eslint-disable-next-line no-console
    console.log(`  → BEST: seed=${best.seed} total=${best.final.total.toFixed(0)}`);
    // eslint-disable-next-line no-console
    console.log(
      `  Initial v3 shape mix: ${JSON.stringify(shapeBreakdown(buildSphereV3(r)))}`
    );
    // eslint-disable-next-line no-console
    console.log(
      `  SA-best  shape mix: ${JSON.stringify(shapeBreakdown(bestVoxels))}`
    );
    // Save best voxels to a file we can inspect.
    // eslint-disable-next-line no-console
    console.log(`  best voxel set (${bestVoxels.length} voxels):`);
    // eslint-disable-next-line no-console
    console.log(`    ${JSON.stringify(bestVoxels).slice(0, 200)}…`);
  }, 600_000);
});
