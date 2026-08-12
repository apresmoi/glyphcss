# 03 — Per-render-mode curve decimation

**Idea.** `curveSteps` / `simplify` should not be one global setting: fill and
outline want opposite values.

**How it works.** Solid fill hides curve error, so coarse steps are fine and cheap.
An outline exposes every flat segment, so it wants finer steps — while needing no
interior geometry at all. Resolve the decimation per render mode (or expose it),
rather than tuning one number for both.

**Fit.** This is a QUALITY subpath, not a cost one, and it is the most likely to be
visible to a user: it is why text reads acceptably filled and chunky in outline at
identical settings.

**Pros / cons.**
- Pro: cheapest to prototype (change a number per mode, render, compare).
- Pro: independent of 01/02 — pays off even if both are ruled out.
- Con: touches a public option's semantics; per AGENTS.md that needs approval.
- Con: risks making outline modes slower unless paired with 01.

**References.** `composeText` options in `packages/fonts/src`; the /wordart tile
helper's tuned `curveSteps: 3`, `simplify: 3`.

**Verdict.** RULED OUT (2026-08-01). Measured: curveSteps 3->12 doubles geometry and
costs +34% time for +3% inked cells, and the finer render is arguably noisier. The
glyph grid, not curve sampling, is the limiting resolution at normal cell sizes.
See `../decisions.md`.
