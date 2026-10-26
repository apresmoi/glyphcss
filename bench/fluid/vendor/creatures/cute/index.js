// Cute-kit registry. Each creature file calls defineCreature() on import; the order
// of these imports is the order of the cards in the picker. One file per owner, so
// parallel agents never edit the same file — do NOT add creatures here.

import './duck.js';
import './mochi2.js';
import './pack-a.js';
import './pack-b.js';
import './pack-c.js';
import './pack-d.js';
import { cuteEntries } from './kit.js';

export const CUTE_CATALOG = cuteEntries();
