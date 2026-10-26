// Procedural mood layer. Pure JS (no three.js) so it can be unit-checked in node.
//
// A mood is a function of time that returns an additive POSE. The engine adds the
// always-on layers from the moodboard's twelve aliveness rules on top:
//   1/2 blink + double blink, 3 micro-saccades, 4 eyes→head→body lag (springs),
//   5 constant-volume breathing, 6 anticipation dip on every state change,
//   7 overshoot / follow-through (underdamped springs), 8 resting asymmetry,
//   9 4–5 Hz speech pulse from a fake TTS envelope, 10 eye-shape vocabulary,
//   11 ±10–20% jitter + 0.5–1 s crossfade, 12 quiet initiative (autopilot, main.js).
//
// Pose fields (all neutral at 0):
//   pos {x,y,z}  body offset, in units of creature height
//   rot {x,y,z}  body euler (x = pitch forward/down, y = yaw, z = roll)
//   head {x,y,z} head euler, same convention, applied to head/neck bones (or blended into body)
//   spine {x,y,z} lean, applied to spine/torso bone (or blended into body)
//   squash       constant-volume scale: sy = 1+squash, sx = sz = 1/sqrt(sy)
//   lid          0 open … 1 closed (blink is added on top)
//   look {x,y}   eye offset in −1…1 (x right, y up)
//   mouth        0…1 open
//   eye          eye-shape word: normal | wide | happy | sleepy | squint
//   emote        floating glyph ('' | '?' | '!' | 'zZz' | '♪' | '…')

export const MOODS = ['idle', 'listening', 'thinking', 'speaking', 'happy', 'sleepy', 'surprised'];

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const jit = (p = 0.15) => 1 + rand(-p, p); // rule 11

export function zeroPose() {
  return {
    pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 },
    head: { x: 0, y: 0, z: 0 }, spine: { x: 0, y: 0, z: 0 },
    squash: 0, lid: 0, look: { x: 0, y: 0 }, mouth: 0, eye: 'normal', emote: '',
  };
}

function lerpPose(a, b, w) {
  const o = zeroPose();
  for (const k of ['pos', 'rot', 'head', 'spine']) for (const c of ['x', 'y', 'z']) o[k][c] = a[k][c] + (b[k][c] - a[k][c]) * w;
  for (const k of ['squash', 'lid', 'mouth']) o[k] = a[k] + (b[k] - a[k]) * w;
  o.look.x = a.look.x + (b.look.x - a.look.x) * w;
  o.look.y = a.look.y + (b.look.y - a.look.y) * w;
  o.eye = w < 0.5 ? a.eye : b.eye;
  o.emote = w < 0.5 ? a.emote : b.emote;
  return o;
}

// ---------- fake TTS amplitude envelope (rule 9) ----------
// Syllables at 4–5 Hz, grouped into phrases of 1.2–3 s separated by 0.25–0.7 s pauses.
export class SpeechEnvelope {
  constructor() { this.t = 0; this.phraseEnd = rand(1.2, 3); this.pauseEnd = 0; this.rate = rand(4, 5); this.phase = 0; this.value = 0; this.onSyllable = null; this._lastPeak = 0; this.syllAmp = 1; }
  update(dt) {
    this.t += dt;
    if (this.t > this.phraseEnd && this.pauseEnd === 0) { this.pauseEnd = this.t + rand(0.25, 0.7); }
    if (this.pauseEnd && this.t > this.pauseEnd) { this.pauseEnd = 0; this.phraseEnd = this.t + rand(1.2, 3); this.rate = rand(4, 5); }
    const speaking = this.pauseEnd === 0;
    const prev = this.phase;
    this.phase += dt * this.rate;
    if (Math.floor(this.phase) !== Math.floor(prev)) { this.syllAmp = rand(0.45, 1); if (speaking && this.onSyllable) this.onSyllable(this.syllAmp); }
    const s = Math.max(0, Math.sin(TAU * this.phase));
    const target = speaking ? Math.pow(s, 0.7) * this.syllAmp : 0;
    // attack fast, release slower, like an RMS follower
    const k = target > this.value ? 1 - Math.exp(-dt * 40) : 1 - Math.exp(-dt * 14);
    this.value += (target - this.value) * k;
    return this.value;
  }
}

// ---------- the per-mood pose generators ----------
// Each gets (t since mood entry, j jitter record, env amplitude) and fills a pose.
const GEN = {
  idle(p, t, j) {
    p.head.z = 0.05 * j.a;                         // rule 8: asymmetric resting tilt
    p.head.y = 0.08 * Math.sin(TAU * t / (9 * j.f)); // lazy look-around
    p.rot.z = 0.015 * Math.sin(TAU * t / (6 * j.f));
  },
  listening(p, t, j) {
    p.spine.x = 0.14 * j.a; p.rot.x = 0.05;          // lean in toward the viewer
    p.pos.z = 0.05;
    p.head.z = 0.22 * j.a * j.side;                    // attentive head tilt
    p.head.x = -0.06 + 0.05 * Math.max(0, Math.sin(TAU * t / (2.6 * j.f))) ; // small acknowledging nods
    p.eye = 'wide'; p.look.y = 0.1;
  },
  thinking(p, t, j) {
    p.rot.z = 0.07 * Math.sin(TAU * t / (3.2 * j.f));   // slow sway
    p.pos.y = 0.015 * Math.sin(TAU * t / (2.4 * j.f));  // slow bob
    p.head.x = -0.28 * j.a;                             // look up…
    p.head.y = 0.32 * j.side;                           // …and to the side
    p.head.z = 0.1 * j.side;
    p.look.x = 0.7 * j.side; p.look.y = 0.7;
    p.emote = t % 4 < 2.5 ? '?' : '…';
  },
  speaking(p, t, j, env) {
    p.squash = 0.06 * env;                       // pulse with the envelope (rule 9)
    p.pos.y = 0.018 * env;
    p.head.x = -0.05 * env + 0.03 * Math.sin(TAU * t / 1.7);
    p.head.z = 0.06 * Math.sin(TAU * t / (3.3 * j.f));
    p.mouth = env;
    // rule 4: glance away every 3–8 s while speaking
    if (t > j.nextGlance) { j.glanceUntil = t + rand(0.5, 0.9); j.nextGlance = t + rand(3, 8); j.glanceDir = Math.random() < 0.5 ? -1 : 1; }
    if (t < j.glanceUntil) { p.look.x = 0.8 * j.glanceDir; p.head.y = 0.12 * j.glanceDir; }
  },
  happy(p, t, j) {
    const f = 2.1 * j.f;
    const hop = Math.abs(Math.sin(Math.PI * f * t));        // 0 at ground contact
    p.pos.y = 0.13 * j.a * hop;
    p.squash = hop < 0.25 ? -0.12 * (1 - hop / 0.25) : 0.05 * hop; // squash on landing, stretch in air
    p.head.z = 0.12 * Math.sin(TAU * f * 0.5 * t);
    p.rot.y = 0.1 * Math.sin(TAU * f * 0.25 * t);
    p.eye = 'happy'; p.mouth = 0.35; p.emote = '♪';
  },
  sleepy(p, t, j) {
    p.head.x = 0.32 * j.a;  p.spine.x = 0.08; p.rot.x = 0.06; // droop
    p.pos.y = -0.025;
    // nod off and catch (every ~7 s)
    const c = (t % (7 * j.f)) / (7 * j.f);
    if (c > 0.75) { const q = (c - 0.75) / 0.25; p.head.x += 0.25 * Math.sin(Math.PI * q) * (q < 0.8 ? 1 : -0.5); }
    p.lid = 0.72 + 0.18 * (0.5 + 0.5 * Math.sin(TAU * t / 6)); // 70–90 % lids (rule 10)
    p.eye = 'sleepy'; p.emote = 'zZz';
  },
  surprised(p, t, j) {
    // one-shot pop, then an alert hold
    if (t < 0.12) { p.squash = -0.14 * Math.sin(Math.PI * t / 0.12) ; }          // anticipation crouch
    else if (t < 0.6) { const q = (t - 0.12) / 0.48; p.pos.y = 0.17 * Math.sin(Math.PI * q); p.squash = 0.16 * (1 - q) - 0.04; }
    else { const q = Math.min(1, (t - 0.6) / 0.6); p.squash = -0.04 * (1 - q); }
    p.spine.x = -0.1; p.rot.x = -0.05; p.head.x = -0.1;  // lean back
    p.eye = 'wide'; p.mouth = 0.55; p.emote = '!';
  },
};

// Underdamped spring: overshoot + follow-through (rule 7).
class Spring {
  constructor(k, d) { this.k = k; this.d = d; this.x = 0; this.v = 0; }
  step(target, dt) { const a = this.k * (target - this.x) - this.d * this.v; this.v += a * dt; this.x += this.v * dt; return this.x; }
}

export class MoodEngine {
  constructor() {
    this.mood = 'idle'; this.prev = null; this.t = 0; this.prevT = 0; this.fade = 1; this.fadeDur = 0.7;
    this.j = this._jitter(); this.pj = this.j;
    this.env = new SpeechEnvelope();
    this.blink = { next: rand(2, 6), phase: -1, double: false, value: 0 };
    this.saccade = { next: rand(0.2, 0.6), x: 0, y: 0 };
    this.anticip = 0;
    this.time = 0;
    this.attention = { x: 0, y: 0, active: false }; // set by the stage (pointer gaze)
    this.springs = {};
    for (const k of ['hx', 'hy', 'hz', 'bx', 'by', 'bz', 'py', 'sq']) this.springs[k] = new Spring(k[0] === 'h' ? 90 : 45, k[0] === 'h' ? 9 : 7);
    this.springs.sq = new Spring(160, 9);
    this.springs.py = new Spring(220, 14);
    this.envValue = 0;
  }
  _jitter() { return { a: jit(0.15), f: jit(0.15), side: Math.random() < 0.5 ? -1 : 1, nextGlance: rand(3, 8), glanceUntil: 0, glanceDir: 1 }; }
  set(mood) {
    if (!GEN[mood] || mood === this.mood) return;
    this.prev = this.mood; this.pj = this.j; this.prevT = this.t;
    this.mood = mood; this.t = 0; this.fade = 0; this.fadeDur = rand(0.5, 1.0); // rule 11
    this.j = this._jitter();
    this.anticip = 0.0001; // rule 6: start the anticipation dip
  }
  update(dt) {
    dt = Math.min(dt, 0.05);
    this.time += dt; this.t += dt; this.prevT += dt;
    this.envValue = this.mood === 'speaking' || this.prev === 'speaking' ? this.env.update(dt) : 0;

    const cur = zeroPose(); GEN[this.mood](cur, this.t, this.j, this.envValue);
    let p = cur;
    if (this.fade < 1) {
      this.fade = Math.min(1, this.fade + dt / this.fadeDur);
      const old = zeroPose(); GEN[this.prev](old, this.prevT, this.pj, this.envValue);
      const w = this.fade * this.fade * (3 - 2 * this.fade);
      p = lerpPose(old, cur, w);
    }

    // rule 5: breathing never stops (slower + deeper when sleepy)
    const sleepy = this.mood === 'sleepy';
    const period = sleepy ? 5 * this.j.f : 3.5 * this.j.f;
    const amp = sleepy ? 0.04 : 0.025;
    p.squash += amp * Math.sin(TAU * this.time / period);

    // rule 6: anticipation — a quick counter-dip before the new state lands
    if (this.anticip > 0) {
      this.anticip += dt; const q = this.anticip / 0.18;
      if (q >= 1) this.anticip = 0; else { p.squash -= 0.07 * Math.sin(Math.PI * q); p.head.x += 0.08 * Math.sin(Math.PI * q); }
    }

    // rule 4: eyes lead (snap), head follows (spring), body last (slow spring, partial)
    let ax = 0, ay = 0;
    if (this.attention.active) { ax = this.attention.x; ay = this.attention.y; }
    const s = this.springs;
    p.head.y += 0.55 * ax; p.head.x += -0.3 * ay;
    p.head.x = s.hx.step(p.head.x, dt); p.head.y = s.hy.step(p.head.y, dt); p.head.z = s.hz.step(p.head.z, dt);
    p.rot.y += 0.25 * ax;
    p.rot.x = s.bx.step(p.rot.x, dt); p.rot.y = s.by.step(p.rot.y, dt); p.rot.z = s.bz.step(p.rot.z, dt);
    p.pos.y = s.py.step(p.pos.y, dt);
    p.squash = s.sq.step(p.squash, dt);

    // rule 3: micro-saccades, snapped, every 200–600 ms
    this.saccade.next -= dt;
    if (this.saccade.next <= 0) { this.saccade.next = rand(0.2, 0.6); this.saccade.x = rand(-0.08, 0.08); this.saccade.y = rand(-0.06, 0.06); }
    p.look.x = clamp(p.look.x + ax * 0.9 + this.saccade.x, -1, 1);
    p.look.y = clamp(p.look.y + ay * 0.7 + this.saccade.y, -1, 1);

    // rules 1/2: blink every 2–6 s (2–4 engaged, 4–7 idle), 80 ms close / 50–100 hold / 150 open; 1 in 8 doubles
    const b = this.blink; b.next -= dt;
    if (b.phase < 0 && b.next <= 0) { b.phase = 0; b.hold = rand(0.05, 0.1); b.double = !b.second && Math.random() < 1 / 8; b.second = false; }
    if (b.phase >= 0) {
      b.phase += dt; const c = 0.08, h = c + b.hold, o = h + 0.15;
      b.value = b.phase < c ? b.phase / c : b.phase < h ? 1 : b.phase < o ? 1 - (b.phase - h) / 0.15 : 0;
      if (b.phase >= o) {
        b.phase = -1; b.value = 0;
        const engaged = this.mood === 'listening' || this.mood === 'speaking';
        b.next = b.double ? rand(0.2, 0.4) : engaged ? rand(2, 4) : rand(4, 7);
        if (b.double) { b.double = false; b.second = true; }
      }
    }
    p.lid = clamp(Math.max(p.lid, 0) + b.value * (1 - p.lid), 0, 1);
    p.env = this.envValue;
    p.mood = this.mood; // lets rigs with their own vocabulary (cute kit) key off the state
    return p;
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
