/**
 * Run simulated annealing on the v3 sphere voxelizer's output and report
 * whether the search finds a lower-defect decomposition.
 *
 * The buildSphereV3 logic is duplicated from manifoldCheck.test.ts to keep
 * this test self-contained.
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
      if (getTop(x + 1, y) > t || getTop(x - 1, y) > t || getTop(x, y + 1) > t || getTop(x, y - 1) > t) {
        c.hasHigher = true;
      }
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
        if (dx * dx + dy * dy + dz * dz <= r2) {
          cells.add(`${x}:${y}:${z}`);
        }
      }
    }
  }
  return cells;
}

function runOne(r: number, iterations: number, seed: number): void {
  const initial = buildSphereV3(r);
  const reference = buildSphereCells(r);
  const result = simulatedAnnealing(initial, reference, {
    iterations,
    T0: 50,
    cooling: 0.9995,
    seed,
    onProgress: (iter, best, current) => {
      if (iter % Math.max(1, Math.floor(iterations / 10)) === 0) {
        // eslint-disable-next-line no-console
        console.log(
          `  r=${r} iter ${iter}: best=${best.total.toFixed(0)} ` +
            `(gaps=${best.gaps}, def=${best.geomDefects}, iou=${best.iou.toFixed(3)}) ` +
            `cur=${current.total.toFixed(0)}`
        );
      }
    },
  });
  // eslint-disable-next-line no-console
  console.log(
    `r=${r}: v3 score=${result.initialScore.total.toFixed(0)} ` +
      `(gaps=${result.initialScore.gaps}, def=${result.initialScore.geomDefects}, ` +
      `iou=${result.initialScore.iou.toFixed(3)}, voxels=${initial.length})`
  );
  // eslint-disable-next-line no-console
  console.log(
    `r=${r}: SA score=${result.bestScore.total.toFixed(0)} ` +
      `(gaps=${result.bestScore.gaps}, def=${result.bestScore.geomDefects}, ` +
      `iou=${result.bestScore.iou.toFixed(3)}, voxels=${result.bestVoxels.length})  ` +
      `accept=${result.acceptedCount}/${result.iterations}\n`
  );
}

describe("simulated annealing on sphere v3", () => {
  it("r=4: SA improves over v3 (3000 iters)", () => {
    runOne(4, 3000, 1);
  }, 60_000);
  it("r=8: SA improves over v3 (5000 iters)", () => {
    runOne(8, 5000, 1);
  }, 180_000);
});
