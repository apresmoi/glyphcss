/**
 * Programmatic debugging for sphere v3 voxelizer output.
 *
 * Categorizes geometric issues without needing visual inspection:
 *   - PROTRUSION: voxel emission extends above the actual sphere boundary
 *   - GAP: sphere boundary is taller than any voxel at that (x, y)
 *   - SNAP_CANDIDATE: column has 2+ higher neighbors all at SAME height,
 *     producing a tiny spike that visually "should" be a cube extension
 *
 * Run with `pnpm test v3-verify` and read the console output.
 */
import { describe, it } from "vitest";
import type { Voxel } from "../types";

// Inline copy of buildSphereV3 to avoid pulling in website-only code.
// Mirrors website/src/components/SphereTest.tsx::buildSphereV3.
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
  // Corner spikes.
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
  // Ramps.
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

interface Issue {
  kind: string;
  x: number;
  y: number;
  detail: string;
}

function verifySphere(voxels: Voxel[], radius: number): Issue[] {
  const r = radius, PAD = 1;
  const span = r * 2 + PAD * 2;
  const r2 = r * r;
  const inside = (x: number, y: number, z: number): boolean => {
    const dx = x - PAD - r + 0.5;
    const dy = y - PAD - r + 0.5;
    const dz = z - PAD - r + 0.5;
    return dx * dx + dy * dy + dz * dz <= r2;
  };

  // Sphere boundary: column top (cell index) per (x, y).
  const sphereTop = new Int32Array(span * span).fill(-1);
  for (let x = 0; x < span; x++) {
    for (let y = 0; y < span; y++) {
      for (let z = span - 1; z >= 0; z--) {
        if (inside(x, y, z)) { sphereTop[x * span + y] = z; break; }
      }
    }
  }

  // Voxel max top per (x, y) — the highest z2 - 1 of any voxel covering this cell.
  const voxelTop = new Int32Array(span * span).fill(-1);
  for (const v of voxels) {
    const x2 = v.x2 ?? v.x + 1;
    const y2 = v.y2 ?? v.y + 1;
    const z2 = v.z2 ?? v.z + 1;
    for (let x = v.x; x < x2; x++) {
      for (let y = v.y; y < y2; y++) {
        const last = z2 - 1;
        if (last > voxelTop[x * span + y]) voxelTop[x * span + y] = last;
      }
    }
  }

  const issues: Issue[] = [];
  for (let x = 0; x < span; x++) {
    for (let y = 0; y < span; y++) {
      const sTop = sphereTop[x * span + y];
      const vTop = voxelTop[x * span + y];
      if (sTop < 0 && vTop < 0) continue;
      if (sTop >= 0 && vTop < 0) {
        issues.push({ kind: "GAP", x, y, detail: `sphere top z=${sTop} but no voxel covers (${x},${y})` });
        continue;
      }
      if (vTop > sTop) {
        issues.push({ kind: "PROTRUSION", x, y, detail: `voxel top z=${vTop} > sphere top z=${sTop} (extends ${vTop - sTop} cell(s) above sphere)` });
      } else if (vTop < sTop) {
        issues.push({ kind: "GAP", x, y, detail: `voxel top z=${vTop} < sphere top z=${sTop}` });
      }
    }
  }

  // Snap candidates: column with 2+ adjacent higher neighbors all at the SAME
  // height (≥ this column.top + 1). These produce isolated 1-cell spikes that
  // visually would be cleaner as a cube extension into the neighbor's height.
  for (let x = 0; x < span; x++) {
    for (let y = 0; y < span; y++) {
      const t = sphereTop[x * span + y];
      if (t < 0) continue;
      const tXp = x + 1 < span ? sphereTop[(x + 1) * span + y] : -1;
      const tXn = x > 0 ? sphereTop[(x - 1) * span + y] : -1;
      const tYp = y + 1 < span ? sphereTop[x * span + (y + 1)] : -1;
      const tYn = y > 0 ? sphereTop[x * span + (y - 1)] : -1;
      const higher: number[] = [];
      if (tXp > t) higher.push(tXp);
      if (tXn > t) higher.push(tXn);
      if (tYp > t) higher.push(tYp);
      if (tYn > t) higher.push(tYn);
      if (higher.length < 2) continue;
      const allEqual = higher.every((h) => h === higher[0]);
      if (allEqual) {
        issues.push({
          kind: "SNAP_CANDIDATE",
          x,
          y,
          detail: `column top z=${t}, ${higher.length} higher neighbors all at z=${higher[0]} — would be cleaner snapped to z=${higher[0]}`,
        });
      }
    }
  }

  return issues;
}

/**
 * Quantify slope/spike protrusion *volume* — out-of-sphere cells the voxels
 * actually fill. Slopes legitimately rise above the column top to meet a
 * neighbor's column top; we count how much they go ABOVE the local envelope
 * (max neighbor sphere top), which is the part that's actually "wrong".
 */
function measureProtrusion(voxels: Voxel[], radius: number): {
  outOfSphere: number;
  aboveEnvelope: number;
} {
  const r = radius, PAD = 1;
  const span = r * 2 + PAD * 2;
  const r2 = r * r;
  const inside = (x: number, y: number, z: number): boolean => {
    const dx = x - PAD - r + 0.5;
    const dy = y - PAD - r + 0.5;
    const dz = z - PAD - r + 0.5;
    return dx * dx + dy * dy + dz * dz <= r2;
  };
  const sphereTop = new Int32Array(span * span).fill(-1);
  for (let x = 0; x < span; x++) for (let y = 0; y < span; y++) {
    for (let z = span - 1; z >= 0; z--) {
      if (inside(x, y, z)) { sphereTop[x * span + y] = z; break; }
    }
  }
  // Local envelope: max sphere top of (x, y) and its 4 cardinal neighbors.
  const envelope = new Int32Array(span * span).fill(-1);
  for (let x = 0; x < span; x++) for (let y = 0; y < span; y++) {
    let m = sphereTop[x * span + y];
    if (x + 1 < span) m = Math.max(m, sphereTop[(x + 1) * span + y]);
    if (x > 0) m = Math.max(m, sphereTop[(x - 1) * span + y]);
    if (y + 1 < span) m = Math.max(m, sphereTop[x * span + (y + 1)]);
    if (y > 0) m = Math.max(m, sphereTop[x * span + (y - 1)]);
    envelope[x * span + y] = m;
  }
  let outOfSphere = 0;
  let aboveEnvelope = 0;
  for (const v of voxels) {
    const x2 = v.x2 ?? v.x + 1;
    const y2 = v.y2 ?? v.y + 1;
    const z2 = v.z2 ?? v.z + 1;
    for (let x = v.x; x < x2; x++) {
      for (let y = v.y; y < y2; y++) {
        for (let z = v.z; z < z2; z++) {
          if (!inside(x, y, z)) outOfSphere++;
          if (z > envelope[x * span + y]) aboveEnvelope++;
        }
      }
    }
  }
  return { outOfSphere, aboveEnvelope };
}

describe("v3 sphere geometry verification", () => {
  for (const r of [4, 8, 12]) {
    it(`r=${r}`, () => {
      const voxels = buildSphereV3(r);
      const issues = verifySphere(voxels, r);
      const byKind: Record<string, number> = {};
      for (const i of issues) byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
      const protrusion = measureProtrusion(voxels, r);
      // eslint-disable-next-line no-console
      console.log(
        `r=${r}: ${voxels.length} voxels, issues: ${JSON.stringify(byKind)}, ` +
          `out-of-sphere cells filled: ${protrusion.outOfSphere}, ` +
          `cells above local envelope: ${protrusion.aboveEnvelope}`
      );
      const seen: Record<string, number> = {};
      for (const i of issues) {
        seen[i.kind] = (seen[i.kind] ?? 0) + 1;
        if (i.kind === "SNAP_CANDIDATE" && seen[i.kind] <= 6) {
          // eslint-disable-next-line no-console
          console.log(`  [${i.kind}] (${i.x},${i.y}): ${i.detail}`);
        }
      }
    });
  }
});
