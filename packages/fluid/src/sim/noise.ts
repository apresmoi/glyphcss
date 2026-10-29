// Value noise from the reference's field synth (`reference/fluid/synth.js`). The sim's
// background floor and curl-noise eddies read it once per cell per step, so its exact
// float sequence is part of the sim's parity contract: keep the arithmetic order.

function hash3(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

/** Trilinear value noise in [0, 1); time is the third lattice axis. */
export function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const a000 = hash3(xi, yi, zi), a100 = hash3(xi + 1, yi, zi);
  const a010 = hash3(xi, yi + 1, zi), a110 = hash3(xi + 1, yi + 1, zi);
  const a001 = hash3(xi, yi, zi + 1), a101 = hash3(xi + 1, yi, zi + 1);
  const a011 = hash3(xi, yi + 1, zi + 1), a111 = hash3(xi + 1, yi + 1, zi + 1);
  const f0 = (a000 * (1 - u) + a100 * u) * (1 - v) + (a010 * (1 - u) + a110 * u) * v;
  const f1 = (a001 * (1 - u) + a101 * u) * (1 - v) + (a011 * (1 - u) + a111 * u) * v;
  return f0 * (1 - w) + f1 * w;
}
