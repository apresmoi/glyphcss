import type { Voxel, VoxelGrid } from "../types";
import { getVoxelBounds, getVoxelZBounds } from "../scene/context";

interface CellEntry {
  sig: string;
  voxel: Voxel;
}

function buildSignature(voxel: Voxel): string {
  const color = voxel.color ?? "";
  const texture = voxel.texture ?? "";
  return `${color}|${texture}`;
}

function isMergeable(voxel: Voxel): boolean {
  const shape = voxel.shape ?? "cube";
  if (shape !== "cube") return false;
  return true;
}

function sortByPosition(a: Voxel, b: Voxel): number {
  const az = Math.floor(a.z ?? 0);
  const bz = Math.floor(b.z ?? 0);
  if (az !== bz) return az - bz;
  if (a.x !== b.x) return a.x - b.x;
  if (a.y !== b.y) return a.y - b.y;
  return 0;
}

export function mergeVoxels(grid: VoxelGrid): VoxelGrid {
  const byLayer = new Map<number, Voxel[]>();
  for (const voxel of grid ?? []) {
    if (!voxel) continue;
    const { z: zStart, z2 } = getVoxelZBounds(voxel);
    const hasZSpan = typeof voxel.z2 === "number" && Number.isFinite(voxel.z2) && Math.floor(voxel.z2) > zStart + 1;
    if (!hasZSpan) {
      const normalized = voxel.z === zStart ? voxel : { ...voxel, z: zStart };
      const bucket = byLayer.get(zStart);
      if (bucket) {
        bucket.push(normalized);
      } else {
        byLayer.set(zStart, [normalized]);
      }
      continue;
    }
    for (let z = zStart; z < z2; z += 1) {
      const normalized: Voxel = { ...voxel, z, z2: undefined };
      const bucket = byLayer.get(z);
      if (bucket) {
        bucket.push(normalized);
      } else {
        byLayer.set(z, [normalized]);
      }
    }
  }

  const output: Voxel[] = [];

  for (const [z, voxels] of byLayer.entries()) {
    const mergeable: Voxel[] = [];
    const passthrough: Voxel[] = [];
    const blocked = new Set<string>();

    for (const voxel of voxels) {
      const bounds = getVoxelBounds(voxel);
      if (!isMergeable(voxel)) {
        passthrough.push(voxel);
        for (let x = voxel.x; x < bounds.x2; x += 1) {
          if (x < 0) continue;
          for (let y = voxel.y; y < bounds.y2; y += 1) {
            if (y < 0) continue;
            blocked.add(`${x}:${y}`);
          }
        }
        continue;
      }
      mergeable.push(voxel);
    }

    mergeable.sort(sortByPosition);

    const cells = new Map<string, CellEntry>();
    for (const voxel of mergeable) {
      const sig = buildSignature(voxel);
      const bounds = getVoxelBounds(voxel);
      for (let x = voxel.x; x < bounds.x2; x += 1) {
        if (x < 0) continue;
        for (let y = voxel.y; y < bounds.y2; y += 1) {
          if (y < 0) continue;
          const key = `${x}:${y}`;
          if (blocked.has(key)) continue;
          if (!cells.has(key)) {
            cells.set(key, { sig, voxel });
          }
        }
      }
    }

    const coords: Array<{ x: number; y: number }> = Array.from(cells.keys()).map((key) => {
      const [xs, ys] = key.split(":");
      return { x: Number(xs), y: Number(ys) };
    });
    coords.sort((a, b) => (a.y !== b.y ? a.y - b.y : a.x - b.x));

    const visited = new Set<string>();

    const matches = (x: number, y: number, sig: string): boolean => {
      const key = `${x}:${y}`;
      if (visited.has(key)) return false;
      const entry = cells.get(key);
      if (!entry) return false;
      return entry.sig === sig;
    };

    for (const coord of coords) {
      const startKey = `${coord.x}:${coord.y}`;
      if (visited.has(startKey)) continue;
      const entry = cells.get(startKey);
      if (!entry) continue;
      const sig = entry.sig;

      let width = 1;
      while (matches(coord.x + width, coord.y, sig)) {
        width += 1;
      }

      let height = 1;
      let canGrow = true;
      while (canGrow) {
        const nextY = coord.y + height;
        for (let dx = 0; dx < width; dx += 1) {
          if (!matches(coord.x + dx, nextY, sig)) {
            canGrow = false;
            break;
          }
        }
        if (canGrow) {
          height += 1;
        }
      }

      for (let dx = 0; dx < width; dx += 1) {
        for (let dy = 0; dy < height; dy += 1) {
          visited.add(`${coord.x + dx}:${coord.y + dy}`);
        }
      }

      output.push({
        ...entry.voxel,
        x: coord.x,
        y: coord.y,
        z,
        x2: coord.x + width,
        y2: coord.y + height
      });
    }

    output.push(...passthrough);
  }

  output.sort(sortByPosition);
  return output;
}
