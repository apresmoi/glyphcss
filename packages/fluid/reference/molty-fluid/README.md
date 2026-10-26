# Reference engine (tests only)

`sim.js`, `synth.js` and `render.js` are molty.uno's fluid engine, vendored unchanged
from molty-site `f2a9ef9` (MIT, © Juan Cruz Fortunatti; `synth.js`/`render.js` carry the
glyphcss MIT notice). The same step also runs as C on molty's firmware.

`reader.js` is molty's speed-reader rules (ORP, tokenizer, word delay), vendored unchanged
from molty-site `7a06b64`. The device firmware (`mole_fluid.c`) applies the same rules.

They are not shipped (`files: ["dist"]`) and nothing in `src/` imports them outside
tests: `sim.parity.test.ts`, `cells.parity.test.ts` and `reader/rules/rules.parity.test.ts`
hold the TypeScript ports to them bit for bit. Update them only together with the port.
