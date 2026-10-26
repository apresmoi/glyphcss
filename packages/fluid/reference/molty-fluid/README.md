# Reference engine (tests only)

`sim.js`, `synth.js` and `render.js` are molty.uno's fluid engine, vendored unchanged
from molty-site `f2a9ef9` (MIT, © Juan Cruz Fortunatti; `synth.js`/`render.js` carry the
glyphcss MIT notice). The same step also runs as C on molty's firmware.

They are not shipped (`files: ["dist"]`) and nothing in `src/` imports them outside
tests: `sim.parity.test.ts` and `cells.parity.test.ts` hold the TypeScript port to them
bit for bit. Update them only together with the port.
