# Cell-canvas byte-identity check (CHARTS-RESEARCH Phase 0)

`render-fixtures.mjs` renders five representative fixtures through PURE,
existing render paths (built `dist`, not source) and prints a SHA-256 digest
of each, plus a combined digest:

1. `icosahedron-solid-perspective-colors` — solid perspective with colour.
2. `cube-solid-perspective-different-camera` — a different camera/mesh.
3. `icosahedron-braille-wireframe` — braille wireframe mode.
4. `maps-compileGlyphMap-small-band` — `@glyphcss/maps`'s `compileGlyphMap`
   on the SAME small-band fixture `packages/maps/src/compile.test.ts`'s
   "returns `{ html, css? }`" test uses. Genuinely different package and
   pure render path (`source → sample → field → classify → bands →
   compile`, no polygons/camera at all) from 1-3 — the first `@glyphcss/maps`
   render this script actually exercises, closing the gap the
   three-`compileScene`-fixture-only version left (opus review P3-7: the
   ground rule cites "every fidelity digest in `bench/maps-render`").
5. `rasterizeToCells-with-transformCells-hook` — `glyphcss`'s
   `rasterizeToCells` on a small coloured scene, with a `transformCells`
   hook supplied in the `RasterizeContext` (the shape a real caller uses;
   `rasterizeToCells` overrides it internally with its own capturing hook,
   so the supplied one never runs — see the script's own comment). Digested
   as `grid.char.join("") + "\0" + grid.color.join(",")` since this fixture
   returns a `CellGrid`, not a string.

The cell canvas (`packages/glyphcss/src/render/canvas/`) is a new, isolated
module that nothing in the existing render path imports, so adding it (and
fixing every finding in `CHARTS-RESEARCH/REVIEW-phase0-opus.md` and
`CHARTS-RESEARCH/REVIEW-phase0-codex-astra.raw.md`) must not change a single
byte of any of these five outputs. This is that byte comparison, run once on
`origin/main` (`1da31f9c`, `chore(release): v0.2.0`, in a temporary `git
worktree` under `/tmp`) and once on this branch with the fixed canvas module
present.

## Digests

| Fixture | `origin/main` (`1da31f9c`) | this branch (post-fix) |
|---|---|---|
| `icosahedron-solid-perspective-colors` | `fa8c7cce36784c7d` | `fa8c7cce36784c7d` |
| `cube-solid-perspective-different-camera` | `c9743c2f4572518c` | `c9743c2f4572518c` |
| `icosahedron-braille-wireframe` | `427f21a0eca83383` | `427f21a0eca83383` |
| `maps-compileGlyphMap-small-band` | `0c49444c02c64003` | `0c49444c02c64003` |
| `rasterizeToCells-with-transformCells-hook` | `0fa0c5f59263e7c2` | `0fa0c5f59263e7c2` |
| combined | `4a84a27c798ec233` | `4a84a27c798ec233` |

Identical in both directions, across all five fixtures — the cell canvas
(including every Phase 0 review fix: node-aware junctions, spans-only HTML,
paint-time colour validation, `bg`-on-blank cells, grapheme-aware text
folding, tier-tabled diagonals, integer-only `fillRect`, corrected
`NO_COLOR`/`FORCE_COLOR` semantics, and the row-major `sub` fill order)
changes no existing render output, in either `glyphcss` or `@glyphcss/maps`.

## Reproducing

```
pnpm --filter @glyphcss/core build
pnpm --filter glyphcss build
pnpm --filter @glyphcss/maps build
node bench/canvas-identity/render-fixtures.mjs
```

Run once on this branch, then once more inside a throwaway worktree of
`origin/main` (`git worktree add /tmp/glyphcss-main origin/main`, `pnpm
install --frozen-lockfile`, copy `bench/canvas-identity/render-fixtures.mjs`
into it since `main` doesn't have this directory, repeat the three builds
and the script, `git worktree remove --force` when done) to reproduce the
comparison above.
