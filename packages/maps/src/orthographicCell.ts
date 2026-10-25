import type { GlyphCamera } from "glyphcss";

/** The grid fields `camera.project` reads when handed a complete scene grid. */
export interface OrthographicCellGrid {
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly centerCol: number;
  readonly centerRow: number;
}

/** One projected point, left in place for the next call to overwrite. */
export interface OrthographicCellProjector {
  col: number;
  row: number;
  depth: number;
  to(x: number, y: number, z: number): void;
}

const DEG = Math.PI / 180;

/**
 * `createGlyphOrthographicCamera().project(v, cols, rows, aspect, grid)` with
 * the camera state read once and no allocation per point: the stock call
 * builds three arrays, which a stroke stamp pays for every vertex it drapes.
 *
 * It restates that camera's arithmetic operation for operation, because the
 * stamps compare these doubles against the surface depth buffer and a last-bit
 * disagreement would move ink. `orthographicCell.test.ts` pins it to the real
 * camera bit for bit, so a change to the camera's formula turns that red
 * rather than drifting here.
 *
 * `null` where the stock call would fall back on a default this does not
 * restate (a grid without usable cell metrics); the caller keeps `camera.project`.
 */
export function createGlyphMapOrthographicProjector(camera: GlyphCamera, grid: OrthographicCellGrid): OrthographicCellProjector | null {
  const cellPxW = grid.cellWidth, cellPxH = grid.cellHeight;
  if (!(cellPxW > 0) || !(cellPxH > 0) || typeof grid.centerCol !== "number" || typeof grid.centerRow !== "number") return null;
  const [tx, ty, tz] = camera.target;
  const { zoom, fovScale } = camera, { centerCol, centerRow } = grid;
  const mat = camera.useMat && camera.mat ? Array.from(camera.mat) : null;
  const cosY = Math.cos(camera.rotY * DEG), sinY = Math.sin(camera.rotY * DEG);
  const cosX = Math.cos(camera.rotX * DEG), sinX = Math.sin(camera.rotX * DEG);
  const out: OrthographicCellProjector = {
    col: 0, row: 0, depth: 0,
    to(x, y, z) {
      // Axis swap shared by both rotation paths: world[1] is CSS x, world[0] is CSS y.
      const vx = y - ty, vy = x - tx, vz = z - tz;
      let r0: number, r1: number, r2: number;
      if (mat) {
        r0 = mat[0]! * vx + mat[1]! * vy + mat[2]! * vz;
        r1 = mat[3]! * vx + mat[4]! * vy + mat[5]! * vz;
        r2 = mat[6]! * vx + mat[7]! * vy + mat[8]! * vz;
      } else {
        const ry = vx * sinY + vy * cosY;
        r0 = vx * cosY - vy * sinY;
        r1 = ry * cosX - vz * sinX;
        r2 = ry * sinX + vz * cosX;
      }
      out.col = centerCol + (r0 * zoom) / cellPxW * fovScale;
      out.row = centerRow + (r1 * zoom) / cellPxH * fovScale;
      out.depth = r2;
    },
  };
  return out;
}
