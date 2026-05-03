import { describe, it } from "vitest";
import type { Voxel } from "../types";
import { precomputeOcclusion } from "./occlusion";
import {
  directionVectorFromBin,
  OCCLUSION_DIR_BINS,
} from "./occlusionDirection";

/** Build a solid filled sphere as cubes, no shapes. */
function buildSphere(r: number): Voxel[] {
  const voxels: Voxel[] = [];
  const dim = r * 2 + 2;
  const cc = dim / 2;
  for (let x = 0; x < dim; x++) {
    for (let y = 0; y < dim; y++) {
      for (let z = 0; z < dim; z++) {
        const dx = x - cc + 0.5;
        const dy = y - cc + 0.5;
        const dz = z - cc + 0.5;
        if (dx * dx + dy * dy + dz * dz <= r * r) {
          voxels.push({ x, y, z });
        }
      }
    }
  }
  return voxels;
}

/**
 * Slow but mathematically correct: for each voxel, ray-march toward camera.
 * If any other cube cell is hit before scene boundary → occluded.
 */
function groundTruth(
  voxels: Voxel[],
  cameraDir: [number, number, number]
): Set<string> {
  const [cdx, cdy, cdz] = cameraDir;
  const cubes = new Set<string>();
  for (const v of voxels) {
    if (!v.shape || v.shape === "cube") {
      cubes.add(`${v.x}:${v.y}:${v.z}`);
    }
  }
  const occluded = new Set<string>();
  const STEP = 0.25; // sub-cell resolution to catch near-grazing intersections
  const MAX = 500;
  for (const v of voxels) {
    const ox = v.x + 0.5;
    const oy = v.y + 0.5;
    const oz = v.z + 0.5;
    let t = STEP;
    let blocked = false;
    let lastFx = v.x, lastFy = v.y, lastFz = v.z;
    while (t < MAX) {
      const fx = Math.floor(ox + t * cdx);
      const fy = Math.floor(oy + t * cdy);
      const fz = Math.floor(oz + t * cdz);
      if (fx === lastFx && fy === lastFy && fz === lastFz) {
        t += STEP;
        continue;
      }
      lastFx = fx; lastFy = fy; lastFz = fz;
      if (fx === v.x && fy === v.y && fz === v.z) {
        t += STEP;
        continue;
      }
      if (cubes.has(`${fx}:${fy}:${fz}`)) {
        blocked = true;
        break;
      }
      t += STEP;
    }
    if (blocked) occluded.add(`${v.x}:${v.y}:${v.z}`);
  }
  return occluded;
}

describe("occlusion: fast bbox-bin vs ground-truth raycast", () => {
  // Run for a small sphere first; bigger if r=4 is clean.
  const radii = [8];
  // Sample ALL direction bins to find worst cases.
  const dirBinsToTest = Array.from({ length: OCCLUSION_DIR_BINS }, (_, i) => i);

  for (const r of radii) {
    for (const dirBin of dirBinsToTest) {
      it(`r=${r} dirBin=${dirBin}: fast matches ground truth`, () => {
        const voxels = buildSphere(r);
        const fast = precomputeOcclusion(voxels);
        const cameraDir = directionVectorFromBin(dirBin);
        const truth = groundTruth(voxels, cameraDir);

        // Extract fast's occluded set for this direction bin.
        const fastOccluded = new Set<string>();
        for (const [key, dirs] of fast.byKey) {
          if (dirs.split(" ").map(Number).includes(dirBin)) {
            fastOccluded.add(key);
          }
        }

        // Diff.
        const falsePositives = [...fastOccluded].filter((k) => !truth.has(k));
        const falseNegatives = [...truth].filter((k) => !fastOccluded.has(k));

        const total = voxels.length;
        const fpRate = (falsePositives.length / total) * 100;
        const fnRate = (falseNegatives.length / total) * 100;

        // Log diff stats; don't assert yet so we see all bins' shape.
        // eslint-disable-next-line no-console
        console.log(
          `r=${r} bin=${dirBin} dir=(${cameraDir.map((n) => n.toFixed(2)).join(",")}): ` +
            `truth=${truth.size}/${total}, fast=${fastOccluded.size}/${total}, ` +
            `FP=${falsePositives.length} (${fpRate.toFixed(1)}%), ` +
            `FN=${falseNegatives.length} (${fnRate.toFixed(1)}%)`
        );
        if (falsePositives.length > 0) {
          // eslint-disable-next-line no-console
          console.log(`  FP examples: ${falsePositives.slice(0, 5).join(", ")}`);
        }
        if (falseNegatives.length > 0) {
          // eslint-disable-next-line no-console
          console.log(`  FN examples: ${falseNegatives.slice(0, 5).join(", ")}`);
        }
      });
    }
  }
});
