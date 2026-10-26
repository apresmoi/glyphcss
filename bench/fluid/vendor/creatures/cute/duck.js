// Pip the duck — the cute kit's reference creature (rubber-ducky cute).
// Round yellow body, bigger head, orange flat bill whose lower half opens when
// speaking, tiny wings that flap when happy, waddling orange feet, a tail flick.

import { defineCreature } from './kit.js';

defineCreature({
  id: 'cute-duck', name: 'Duck', archetype: 'Bird', roster: 'Cute kit reference',
  palette: { body: '#ffdf5a', accent: '#ff9a3c', wing: '#ffc63d', bill: '#ff9a3c', billLow: '#f0832a', eye: '#2a1f1d', cheek: '#ff9fb4', mouth: '#7a2e1f' },
  body: { size: [0.32, 0.245, 0.36], at: [0, 0.265, -0.05], seg: [8, 6] },
  head: { size: [0.32, 0.3, 0.3], at: [0, 0.63, 0.06] },
  eyes: { x: 0.41, y: 0.0, r: 0.08, shape: 'tall' },
  mouth: { type: 'jaw', y: -0.42, open: 0.7 },
  cheeks: { x: 0.64, y: -0.24, r: 0.045 },
  motion: 'waddle',
  parts: [
    // bill: upper half on the head, lower half on the jaw socket (opens with pose.mouth)
    { name: 'bill', type: 'ellipsoid', at: 'head', size: [0.13, 0.038, 0.1], pos: [0, -0.085, 0.27], rot: [-0.08, 0, 0], color: 'bill', seg: [9, 4] },
    { name: 'gape', type: 'ellipsoid', at: 'head', size: [0.08, 0.03, 0.06], pos: [0, -0.12, 0.24], color: 'mouth' },
    { name: 'billLow', type: 'ellipsoid', at: 'jaw', size: [0.095, 0.024, 0.07], pos: [0, -0.004, 0.02], color: 'billLow', seg: [7, 3] },
    // head tuft
    { name: 'tuft', type: 'teardrop', at: 'top', size: [0.03, 0.06, 0.03], pos: [0.012, 0.035, 0], rot: [0, 0, -0.55], color: 'body', seg: [5, 3] },
    { name: 'tuft', type: 'teardrop', at: 'top', size: [0.026, 0.05, 0.026], pos: [-0.016, 0.03, -0.01], rot: [0, 0, 0.5], color: 'body', seg: [5, 3] },
    // tiny wings (side sockets are paired: this part is mirrored automatically)
    { name: 'wing', type: 'teardrop', at: 'wing', size: [0.045, 0.12, 0.1], pos: [0.0, -0.02, -0.04], rot: [-1.3, 0, 0.1], color: 'wing' },
    // webbed feet
    { name: 'foot', type: 'ellipsoid', at: 'foot', size: [0.075, 0.024, 0.1], pos: [0, 0.022, 0.03], rot: [0, 0.3, 0], color: 'accent', seg: [7, 3] },
    // tail flick
    { name: 'tail', type: 'teardrop', at: 'tail', size: [0.06, 0.11, 0.045], pos: [0, 0.02, 0], rot: [-0.9, 0, 0], color: 'body' },
  ],
});
