// Mochi 2 — the Route-2 Mochi rebuilt on the cute kit (the old one stays in proc.js).
// One squashy blob that is all head (the head pivot sits on the floor so tilts rock
// the whole body), nub arms and feet, low wide eyes, a leaf sprout.

import { defineCreature } from './kit.js';

defineCreature({
  id: 'cute-mochi2', name: 'Mochi 2', archetype: 'Blobby', roster: 'Starter #1 — Mochi on the kit',
  palette: { body: '#f6b8c8', accent: '#fff3ec', nub: '#f2a5b9', cheek: '#ff9cb6', eye: '#2a1d26' },
  head: { size: [0.42, 0.4, 0.4], at: [0, 0.4, 0], seg: [12, 8] },
  eyes: { x: 0.37, y: -0.1, r: 0.07 },
  mouth: { type: 'smile', y: -0.32, w: 0.036 },
  cheeks: { x: 0.6, y: -0.3, r: 0.042 },
  motion: 'wiggle',
  items: { head: 'leaf sprout' },
  parts: [
    { name: 'arm', type: 'ellipsoid', at: 'arm', size: [0.06, 0.05, 0.055], pos: [0.02, 0, 0.05], color: 'nub', seg: [6, 4] },
    { name: 'foot', type: 'ellipsoid', at: 'foot', size: [0.08, 0.04, 0.07], pos: [0, 0.03, 0.02], color: 'nub', seg: [6, 4] },
  ],
});
