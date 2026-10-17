# Frozen diagram-quality benchmark

This is an offline observation tool, not a new fitting objective. `src/quality.ts`
is internal and is not imported by the renderer or exported by `src/index.ts`.
The slow corpus is outside Vitest's `src/**/*.test.ts` gate; the small quality
unit tests remain in that gate.

```sh
pnpm install --frozen-lockfile
pnpm --filter @glyphcss/diagrams bench --time-cap-ms 180000
```

`--filter SUBSTRING` selects fixtures; `--output FILE` writes elsewhere. The
default run overwrites `baseline.json`. Run comparisons into a separate file
to preserve this frozen baseline. Each source/options pair gets a fresh worker;
the parent terminates a timed-out worker even if routing blocks its event loop.
Timeouts and errors are recorded and make the command exit nonzero. An atomic
checkpoint after each render preserves completed records if a later run stops.
`complete` means every selected render was attempted, not that every render
succeeded; inspect each record's `status`.

The worker bundle aliases diagrams, glyphcss and core to workspace **source**.
Timing covers `renderGlyphDiagram` (including its parsing), excluding worker
startup, a preliminary node/edge inventory, and quality computation. `elapsedMs`
includes startup and measurements; the time cap applies to this entire worker
operation. The baseline records Node/platform, git revision, bundle SHA-256,
source SHA-256, actual page sizes, ledger, effective options and per-edge metrics.
The bundle hash includes uncommitted source; the git revision alone is not its
identity. Timings are observations from one run, not latency guarantees.

## Corpus provenance

Extraction inspected `~/.claude/projects/*cssEarth*/*.jsonl`, parsed actual
`tool_use` command blocks, deduplicated tool-use IDs, paired `tool_result` IDs,
and recovered literal Mermaid stdin from quoted heredocs and `printf` strings.
Transcript shell commands were never executed. The shell loop's three literal
sources and multi-command blocks each contribute separate renders.

Inventory: **24 render executions, 23 distinct sources across two chat
sessions**. The repeated `telescope-explore-edge-labels` source is stored once
with both invocations. Every `.mmd` has a `.json` sidecar with its SHA-256,
effective options and execution index. `toolResultErrorCodes` refers to
the whole paired tool result (which may cover several renders); it is not a
per-render verdict. Missing diagnostics in a shell command that redirected
stderr are not evidence of success.

All recorded executions used chat defaults: 72×24, `charset: "box"`,
`color: "none"`, `autoDirection: true`, `detail: "faithful"`, `overflow: "expand"`.
`galaxy-sources-h60` explicitly requests height 60. These effective defaults
come from the skill's `runtime/common.mjs` and `runtime/diagrams.mjs`, listed in
`manifest.json`, and agree with the installed renderer's CLI wrapper.
The raw Mermaid text (including authored direction, words and missing edges)
is retained. The benchmark deliberately records label losses the skill would
reject; it measures the library result without applying skill postprocessing.

`targets/` holds **eight** hand drawings drawn by an agent in the same
chat, verbatim. Three other fenced pictures in that evidence paste paired
renderer output and are excluded. Targets are editorial structure references,
never renderer inputs or promises of equivalent graph content/viewport fit.

## Metric definitions

- `wordCuts`: sum of word occurrences in `word-cut` ledger entries, not count
  of affected nodes. The renderer's already-deduplicated ledger is authoritative.
- `crossings`: cells where different routes traverse straight interior segments
  on perpendicular axes; one cell per page. Endpoints, shared corners and
  parallel overlaps are not crossings. No glyph counting is involved.
- `bends`: direction changes at interior route cells, with total/max and a
  record for every rendered edge instance (including repeats across pages).
- `detourRatio`: literal route-cell count divided by Manhattan distance between
  the route's **escape ports**, because routes exclude border anchors. A d-step
  straight walk scores `(d+1)/d`. Coincident ports produce `null` and are excluded
  from mean/max; empty aggregates are zero. Fixed self-loops are included.
- `maxArrowheadsOnSide`: largest count of routed, directed target heads on a
  node/side in one page. Undirected/unrouted edges do not count; point fan-in
  joins to one painted head. Separate pages are never merged.
- `expansionRatio`: sum of all page canvas areas divided by **one** requested
  width×height budget. Two exact-size pages score 2; `pages` exposes pagination.
- `whitespaceFraction`: literal space cells in all canvas grids divided by total
  area, including blank node interiors, gutters and dotted-edge gaps. It is
  weighted by page area and does not inspect encoded text/ANSI/HTML.
- `droppedEdges`: distinct union of reported `unroutable` IDs, ledger
  `unroutable` IDs, and canonical original metadata edges absent from all routes.
  Intermediate `routing-attempt` entries do not count.
- `droppedLabels`: number of `label-dropped` entries in the final deduplicated
  ledger. This is reported loss, not a reconstruction of unreported decoration
  removal or identical losses collapsed by ledger deduplication.
- `pages`: result page count, including a blank dropped panel if returned.

`quality.test.ts` uses small explicit routes/ports plus one tiny real render.
