/**
 * The inertial glide's step law, a function of elapsed time alone.
 *
 * Speed decays as `exp(-t / tau)` and the glide ends when it falls below the
 * floor, so the distance it covers and the moment it stops are fixed at the
 * throw. Summing per-frame `v * dt` (Euler) made both depend on the frame
 * timings, which nothing can predict; the closed form lands on the same offset
 * however the frames fall, which is what lets the pose it ends at be prepared
 * for while it is still moving.
 */
export interface GlideLaw {
  readonly vx: number;
  readonly vy: number;
  readonly tau: number;
  /** Time at which speed reaches the floor and the glide stops. */
  readonly duration: number;
}

/** `null` when the throw is already at or under the floor. */
export function glideLaw(vx: number, vy: number, tau: number, floor: number): GlideLaw | null {
  const speed = Math.hypot(vx, vy);
  return speed > floor ? { vx, vy, tau, duration: tau * Math.log(speed / floor) } : null;
}

/** Cumulative offset in px after `t` ms, clamped at the end of the glide. */
export function glideOffset(law: GlideLaw, t: number): readonly [number, number] {
  const reach = law.tau * (1 - Math.exp(-Math.min(t, law.duration) / law.tau));
  return [law.vx * reach, law.vy * reach];
}
