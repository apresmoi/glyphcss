/**
 * Run the manifold edge check on the v3 sphere voxelizer output.
 *
 * Reports every line in the polygon mesh whose edge coverage isn't exactly 2.
 * Coverage 1 = open edge = visible gap. Coverage 3+ = non-manifold (likely
 * a polygon-model bug or a true overlap).
 *
 * The buildSphereV3 logic is duplicated here from the website's SphereTest
 * to keep this test self-contained without cross-package imports.
 */
import { describe, it, expect } from "vitest";
import type { Voxel } from "../types";
import { voxelToPolygons } from "./polygonModel";
import { findGaps } from "./manifoldCheck";
import { extractExteriorSurface } from "./exteriorSurface";
import { findGeometricDefects } from "./geometricCheck";

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

describe("manifold check on a single cube (sanity)", () => {
  it("cube has no gaps", () => {
    const polys = voxelToPolygons({ x: 0, y: 0, z: 0 });
    const gaps = findGaps(polys);
    expect(gaps).toEqual([]);
  });
  it("multi-cell cube has no gaps", () => {
    const polys = voxelToPolygons({ x: 0, y: 0, z: 0, x2: 4, y2: 3, z2: 2 });
    const gaps = findGaps(polys);
    expect(gaps).toEqual([]);
  });
  it("cube with one face removed → 4 open edges (gap)", () => {
    // Drop the top face. Each of its 4 edges should now appear in only ONE
    // polygon (the side face it adjoined), so all 4 should report coverage 1.
    const polys = voxelToPolygons({ x: 0, y: 0, z: 0 }).filter((p) => p.face !== "top");
    const gaps = findGaps(polys);
    expect(gaps.length).toBe(4);
    for (const g of gaps) expect(g.coverage).toBe(1);
  });
});

describe("focused: r=8 sphere, the (8,15) ramp + tri-A region", () => {
  it("traces edge coverage on x=8, z=13 line near y=15..16", () => {
    const voxels = buildSphereV3(8);
    const allPolys: ReturnType<typeof voxelToPolygons> = [];
    for (const v of voxels) allPolys.push(...voxelToPolygons(v));
    const polys = extractExteriorSurface(allPolys);
    // Find every polygon with at least one edge on the line x=8, z=13.
    const onLine: { polyIdx: number; from: typeof polys[number]["v"][number]; to: typeof polys[number]["v"][number]; face: string }[] = [];
    for (let pi = 0; pi < polys.length; pi++) {
      const p = polys[pi];
      const n = p.v.length;
      for (let i = 0; i < n; i++) {
        const a = p.v[i], b = p.v[(i + 1) % n];
        if (a[0] === 8 && b[0] === 8 && a[2] === 13 && b[2] === 13) {
          onLine.push({ polyIdx: pi, from: a, to: b, face: `${p.voxelKey}/${p.face}` });
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`Edges on x=8, z=13, y-axis line: ${onLine.length}`);
    for (const e of onLine) {
      // eslint-disable-next-line no-console
      console.log(`  y ${e.from[1]} → ${e.to[1]} from ${e.face}`);
    }
  });
});

describe("geometric continuity check on sphere v3", () => {
  for (const r of [4, 8]) {
    it(`r=${r}: report inward-facing exposed walls`, () => {
      const voxels = buildSphereV3(r);
      const defects = findGeometricDefects(voxels);
      // eslint-disable-next-line no-console
      console.log(`r=${r}: ${voxels.length} voxels, ${defects.length} geometric defects`);
      // Group defects by which voxel emitted the misoriented face.
      const byEmitter: Record<string, number> = {};
      for (const d of defects) {
        byEmitter[d.polygon.voxelKey] = (byEmitter[d.polygon.voxelKey] ?? 0) + 1;
      }
      const sorted = Object.entries(byEmitter).sort((a, b) => b[1] - a[1]).slice(0, 8);
      for (const [voxKey, count] of sorted) {
        // eslint-disable-next-line no-console
        console.log(`  voxel ${voxKey}: ${count} inward-facing wall cell(s)`);
      }
    });
  }
});

describe("manifold check on sphere v3 (exterior surface only)", () => {
  for (const r of [4, 8]) {
    it(`r=${r}: report gaps`, () => {
      const voxels = buildSphereV3(r);
      const allPolys: ReturnType<typeof voxelToPolygons> = [];
      for (const v of voxels) allPolys.push(...voxelToPolygons(v));
      // Strip interior polygons (faces hidden by an anti-normal partner) so
      // findGaps sees only the visible exterior surface — that's what the
      // user actually perceives.
      const polys = extractExteriorSurface(allPolys);
      const gaps = findGaps(polys);
      const byKind: Record<string, number> = {};
      for (const g of gaps) {
        const k = g.coverage === 1 ? "OPEN_EDGE" : `OVERCOVERED_${g.coverage}`;
        byKind[k] = (byKind[k] ?? 0) + 1;
      }
      // eslint-disable-next-line no-console
      console.log(
        `r=${r}: ${voxels.length} voxels, ${polys.length} polygons, gaps: ${JSON.stringify(byKind)}`
      );
      // Sample first 6 of each kind for a flavor.
      const seen: Record<string, number> = {};
      for (const g of gaps) {
        const k = g.coverage === 1 ? "OPEN_EDGE" : `OVERCOVERED_${g.coverage}`;
        seen[k] = (seen[k] ?? 0) + 1;
        if (seen[k] <= 6) {
          const [a, b] = g.segment;
          // eslint-disable-next-line no-console
          console.log(
            `  [${k}] dir=(${g.direction.join(",")}) ` +
              `from (${a.join(",")}) to (${b.join(",")}), ` +
              `voxels: ${[...new Set(g.contributors)].join(", ")}`
          );
        }
      }
    });
  }
});
