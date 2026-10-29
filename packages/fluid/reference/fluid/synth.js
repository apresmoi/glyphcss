// glyphcss © 2025 Layoutit, MIT License (see THIRD_PARTY_NOTICES.md).
// A 2D port of glyphcss's field synth (packages/effects/src/fieldProgram.ts + the
// fieldSynth effect in stock.ts). Same primitives, same maths, cut down to what the
// fluid needs and kept allocation-free so it ports to C line by line:
//
//   voice  = field(x,y) → synthWave(wave, raw·freq − t·speed + phase)   ∈ [−1, 1]
//            (noise bypasses the wave and returns 2·noise3 − 1, like the original)
//   fold   = mix-weight fold: first voice enters at amp·o, later voices blend the
//            running value toward combine(value, o) by their amp (foldVoices)
//   value  = clamp01(bias + gain · fold · 0.5)                       (computeFieldSynthPoint)
//   glyph  = ramp[round(value · (len−1))]; colour = lerp(colorA, colorB, value·gradient)
//
// The glyph ramps are copied verbatim from stock.ts GlyphRamps.

export const GlyphRamps = {
  Fade: ' .:-=+*#%@',
  Blocks: ' ░▒▓█',
  Shades: ' .·:;+=xX#',
  Dots: ' .·•●',
  Binary: ' 01',
  ASCII: ' .,:;i1tfLCG08@',
  Hatch: ' .-+=#',
  Stars: ' .+*✦★',
  Digital: ' .:i|1oX#',
};

const TAU = Math.PI * 2;

export function synthWave(kind, t, duty = 0.5) {
  if (kind === 'step') return t >= 0 ? 1 : -1;
  const p = t - Math.floor(t);
  switch (kind) {
    case 'triangle': return 4 * Math.abs(p - 0.5) - 1;
    case 'saw': return 2 * p - 1;
    case 'square': return p < duty ? 1 : -1;
    default: return Math.sin(t * TAU);
  }
}

function hash3(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

// time is the third lattice axis, so the pattern morphs in place instead of sliding
export function noise3(x, y, z) {
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

export function combineSynth(mode, a, b) {
  switch (mode) {
    case 'add': return a + b;
    case 'max': return Math.max(a, b);
    case 'min': return Math.min(a, b);
    case 'difference': return Math.abs(a - b);
    default: return a * b;
  }
}

/** One voice at (x, y), origin (cx, cy). x/y are in the patch's own units (×scale). */
export function sampleVoice(v, x, y, cx, cy, t) {
  let sx = x, sy = y;
  if (v.angle) {
    const a = (-v.angle * Math.PI) / 180, dx = x - cx, dy = y - cy, ca = Math.cos(a), sa = Math.sin(a);
    sx = cx + dx * ca - dy * sa; sy = cy + dx * sa + dy * ca;
  }
  if (v.field === 'noise') return 2 * noise3(sx * v.freq, sy * v.freq, t * v.speed) - 1;
  let raw;
  switch (v.field) {
    case 'linearX': raw = sx; break;
    case 'linearY': raw = sy; break;
    case 'diagonal': raw = (sx + sy) * 0.70710678; break;
    case 'angular': raw = Math.atan2(sy - cy, sx - cx) / TAU; break;
    case 'spiral': raw = Math.hypot(sx - cx, sy - cy) + Math.atan2(sy - cy, sx - cx) / TAU; break;
    default: raw = Math.hypot(sx - cx, sy - cy);
  }
  return synthWave(v.wave || 'sin', raw * v.freq - t * v.speed + (v.phase || 0), v.duty ?? 0.5);
}

/** The mix-weight fold over a voice list (foldVoices, argmax omitted). */
export function foldVoices(voices, combine, x, y, cx, cy, t) {
  let c = 0, active = 0;
  for (let k = 0; k < voices.length; k++) {
    const v = voices[k];
    if (!(v.amp > 0)) continue;
    const o = sampleVoice(v, x, y, cx + (v.ou || 0), cy + (v.ov || 0), t);
    if (active === 0) c = v.amp * o; else c += v.amp * (combineSynth(combine, c, o) - c);
    active++;
  }
  return c;
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A field-synth patch → value 0..1 at (x, y) in −1..1 stage space. */
export function patchValue(p, x, y, t) {
  const s = p.scale ?? 1;
  return clamp01((p.bias ?? 0.5) + (p.gain ?? 1) * foldVoices(p.voices, p.combine || 'add', x * s, y * s, (p.ou || 0) * s, (p.ov || 0) * s, t) * 0.5);
}

// ink strokes (stock.ts inkGlyphForField): contour tangent ⟂ gradient, 4 × 45° buckets.
// Used here for STREAMLINES instead: the stroke follows the local flow direction.
const STROKES = ['-', '\\', '|', '/'];
export function strokeFor(gx, gy) {
  let a = Math.atan2(gx, -gy);
  if (a < 0) a += Math.PI;
  return STROKES[Math.round(a / (Math.PI / 4)) % 4];
}
export function strokeAlong(vx, vy) { // direction of travel (rows grow downward)
  let a = Math.atan2(vy, vx);
  if (a < 0) a += Math.PI;
  return ['-', '\\', '|', '/'][Math.round(a / (Math.PI / 4)) % 4];
}
