# website — agent guide

Astro + Starlight docs site plus the interactive workbenches. Not published. General rules are in the root `AGENTS.md`.

## Map

- `src/content/docs/**` — user docs. Update them with any user-visible package change.
- `src/components/InstrumentWorkbench/` — the shared workbench shell (Dock folders, `IconToggle`, `ColorSwatch`, `RangeSlider`, folder-title resets, `Instrument3DEffectsFolder`, `useElementSize`). Reuse these; never fork a second copy. The left rail's width is the one per-page knob: a page sets `--synth-rail-basis` on its own shell class (`/diagrams` does) rather than widening the shared rule.
- `src/components/{Charts,Diagrams,Maps,Synth,Gallery}Workbench/` — one per page. Package contracts behind each page are in `packages/{charts,diagrams,maps}/AGENTS.md`.
- `src/components/TargetPreview/` — frames a render per target (web / terminal / chat).
- `src/lib/` — page-side helpers (URL-state envelopes, dataset search and load, the tabular pipeline, Glyph Mono metrics).

## Invariants

- Pages show only the render, controls, tray and export bar. No ledger readout; feedback lives on the controls. A locked or unavailable control is dimmed with its reason (the `mapDirectionLocked` idiom), never hidden or shown as a note inside the viewport.
- URL state (`?c=`, `?d=`, maps tokens) is **append-only**: new fields are optional, a malformed field degrades to absent, and only an incompatible reshape bumps the version prefix.
- Shipped dataset ids are frozen public identifiers. A rename goes through an alias map.
- Every glyph `<pre>` sets the Glyph Mono font stack and `line-height: 1` explicitly (never `inherit`). A live 3D viewport's `.glyph-output` rule needs a three-class selector to beat glyphcss's runtime-injected styles.
- Every glyph a canvas tier can emit must exist in the Glyph Mono subset. This is gated by `TargetPreview/glyphMonoCmap.test.ts`.
- Copy ASCII/ANSI reads a separate logical render, never the dense preview grid, and never includes preview-only effects.
