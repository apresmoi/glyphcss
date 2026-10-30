# Reference engine (tests only)

`sim.js`, `synth.js` and `render.js` are the reference fluid engine and `reader.js` the
reference speed-reader rules (ORP, tokenizer, word delay), all vendored unchanged
(MIT, © Juan Cruz Fortunatti; `synth.js`/`render.js` carry the glyphcss MIT notice).

They are not shipped (`files: ["dist"]`) and nothing in `src/` imports them outside
tests: `sim.parity.test.ts`, `cells.parity.test.ts` and `reader/rules/rules.parity.test.ts`
hold the TypeScript ports to them bit for bit. Update them only together with the port.
