/**
 * Simulated annealing search for shape decompositions.
 *
 * Treats voxel-set construction as an optimization problem: starting from
 * some initial state (e.g. the v3 voxelizer's output), apply random local
 * edits and accept improvements (always) or worse states (with decreasing
 * probability). Score combines:
 *   - Topological gaps (open edges in the exterior surface)
 *   - Geometric defects (axis-aligned walls facing into solid neighbors)
 *   - Volumetric mismatch (IoU between bbox-claimed cells and reference cells)
 *
 * The point isn't to ship the SA output as a production voxelizer — it's to
 * let the search find shape combinations a hand-coded rule wouldn't, then
 * inspect what worked and extract general principles.
 */
import type { Voxel } from "../types";
import { voxelToPolygons } from "./polygonModel";
import { findGaps } from "./manifoldCheck";
import { findGeometricDefects } from "./geometricCheck";

export interface ScoreBreakdown {
  gaps: number;
  geomDefects: number;
  iou: number;
  /** Lower is better. */
  total: number;
}

export interface SAOptions {
  iterations?: number;
  /** Initial annealing temperature; controls how often worse moves are accepted. */
  T0?: number;
  /** Per-iteration multiplier applied to T (T = T * cooling). 0.999 ≈ slow cooling. */
  cooling?: number;
  /** Seed for the deterministic RNG. */
  seed?: number;
  /** Called every progressInterval iterations with the current best score. */
  onProgress?: (iter: number, best: ScoreBreakdown, current: ScoreBreakdown) => void;
  progressInterval?: number;
}

export interface SAResult {
  bestVoxels: Voxel[];
  bestScore: ScoreBreakdown;
  initialScore: ScoreBreakdown;
  iterations: number;
  acceptedCount: number;
}

/** Cell-set produced by walking each voxel's bbox. Same logic findGeometricDefects uses. */
function claimedCells(voxels: Voxel[]): Set<string> {
  const out = new Set<string>();
  for (const v of voxels) {
    const x2 = v.x2 ?? v.x + 1;
    const y2 = v.y2 ?? v.y + 1;
    const z2 = v.z2 ?? v.z + 1;
    for (let x = v.x; x < x2; x++) {
      for (let y = v.y; y < y2; y++) {
        for (let z = v.z; z < z2; z++) {
          out.add(`${x}:${y}:${z}`);
        }
      }
    }
  }
  return out;
}

export function score(voxels: Voxel[], referenceCells: Set<string>): ScoreBreakdown {
  const polys: ReturnType<typeof voxelToPolygons> = [];
  for (const v of voxels) polys.push(...voxelToPolygons(v));
  const gaps = findGaps(polys);
  const defects = findGeometricDefects(voxels);

  const claimed = claimedCells(voxels);
  let intersection = 0;
  for (const c of claimed) if (referenceCells.has(c)) intersection++;
  const unionSize = claimed.size + referenceCells.size - intersection;
  const iou = unionSize === 0 ? 1 : intersection / unionSize;

  // Score weights — keep IoU strongly dominant so SA can't "win" by deleting
  // voxels (which would zero defects but turn the sphere into nothing).
  // Per-cell penalties are split: missing sphere cells (under-covered) cost
  // 5× more than extra cells (over-protrusion), since a missing cell is a
  // visible hole while an extra cell just makes the silhouette blockier.
  const missing = referenceCells.size - intersection;
  const extra = claimed.size - intersection;
  const total = 100 * gaps.length + 20 * defects.length + 50 * missing + 10 * extra;
  return { gaps: gaps.length, geomDefects: defects.length, iou, total };
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROTATIONS = [0, 90, 180, 270];

/**
 * Generate a candidate next state by applying one random local edit.
 * Returns null if the chosen edit isn't applicable (caller will retry).
 */
function mutate(voxels: Voxel[], rng: () => number): Voxel[] | null {
  if (voxels.length === 0) return null;
  const i = Math.floor(rng() * voxels.length);
  const v = voxels[i];
  const z = v.z, z2 = v.z2 ?? v.z + 1;

  // 7 mutation types, equal weight. If the chosen one is invalid for this
  // voxel, we just return null and the SA loop tries again next iteration.
  const choice = Math.floor(rng() * 7);
  switch (choice) {
    case 0: // shrink z2 by 1 (only if it leaves the voxel non-degenerate)
      if (z2 > z + 1) {
        return voxels.map((w, j) => (j === i ? { ...w, z2: z2 - 1 } : w));
      }
      return null;
    case 1: // grow z2 by 1
      return voxels.map((w, j) => (j === i ? { ...w, z2: z2 + 1 } : w));
    case 2: // convert ramp/spike to plain cube of same bbox
      if (v.shape && v.shape !== "cube") {
        return voxels.map((w, j) => {
          if (j !== i) return w;
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { shape, rot, ...rest } = w;
          return rest;
        });
      }
      return null;
    case 3: // delete this voxel
      return voxels.filter((_, j) => j !== i);
    case 4: // change rotation (ramps/spikes only)
      if (v.shape === "ramp" || v.shape === "spike") {
        const newRot = ROTATIONS[Math.floor(rng() * 4)];
        if (newRot === v.rot) return null;
        return voxels.map((w, j) => (j === i ? { ...w, rot: newRot } : w));
      }
      return null;
    case 5: // grow z (lower the bottom by 1)
      return voxels.map((w, j) => (j === i ? { ...w, z: z - 1 } : w));
    case 6: { // duplicate this voxel as a unit-cube neighbor in a random axis direction
      const axis = Math.floor(rng() * 3);
      const dir = rng() < 0.5 ? -1 : +1;
      const x2v = v.x2 ?? v.x + 1;
      const y2v = v.y2 ?? v.y + 1;
      const z2v = v.z2 ?? v.z + 1;
      let newX = v.x, newY = v.y, newZ = v.z;
      if (axis === 0) newX = dir > 0 ? x2v : v.x - 1;
      else if (axis === 1) newY = dir > 0 ? y2v : v.y - 1;
      else newZ = dir > 0 ? z2v : v.z - 1;
      const neighbor: Voxel = { x: newX, y: newY, z: newZ };
      return [...voxels, neighbor];
    }
  }
  return null;
}

export function simulatedAnnealing(
  initialVoxels: Voxel[],
  referenceCells: Set<string>,
  options: SAOptions = {}
): SAResult {
  const iterations = options.iterations ?? 5000;
  const T0 = options.T0 ?? 50;
  const cooling = options.cooling ?? 0.9995;
  const seed = options.seed ?? 42;
  const progressInterval = options.progressInterval ?? Math.max(1, Math.floor(iterations / 20));

  const rng = mulberry32(seed);
  let current = [...initialVoxels];
  let currentScore = score(current, referenceCells);
  const initialScore = currentScore;
  let best = current;
  let bestScore = currentScore;
  let T = T0;
  let accepted = 0;

  for (let i = 0; i < iterations; i++) {
    const proposal = mutate(current, rng);
    if (!proposal) {
      T *= cooling;
      continue;
    }
    const propScore = score(proposal, referenceCells);
    const delta = propScore.total - currentScore.total;
    const accept = delta < 0 || rng() < Math.exp(-delta / T);
    if (accept) {
      current = proposal;
      currentScore = propScore;
      accepted++;
      if (currentScore.total < bestScore.total) {
        best = current;
        bestScore = currentScore;
      }
    }
    T *= cooling;
    if (options.onProgress && (i % progressInterval === 0 || i === iterations - 1)) {
      options.onProgress(i, bestScore, currentScore);
    }
  }

  return {
    bestVoxels: best,
    bestScore,
    initialScore,
    iterations,
    acceptedCount: accepted,
  };
}
