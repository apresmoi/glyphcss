# Research — agent guide

This directory holds **exploratory research**, separate from shipped code. Nothing
here is imported by the packages or the website; it's where we investigate ideas,
weigh approaches, and record findings *before* (or instead of) building them.

## The one rule

**One research direction per folder.** Each direction is a self-contained kebab-case
folder under `research/` (e.g. `images-to-3d/`) with its own `CLAUDE.md` and the
standard structure below. Don't mix two directions in one folder; don't scatter a
direction across the tree.

To start a new direction, use the **`/new-research`** skill — it scaffolds the
folder, its `CLAUDE.md`, and the structure from the templates here.

## Structure of a research direction

```
research/<direction>/
  CLAUDE.md        # context + rules specific to this direction (goal, constraints, status)
  README.md        # human-facing overview: goal, status, current best approach, subpath index
  overview.md      # the idea in full: problem, success criteria, key insight, open questions
  decisions.md     # dated decision log (ADR-style): what we chose / ruled out and why
  references.md    # bibliography — papers, repos, links, with one-line relevance notes
  ideas/
    log.md         # running, dated idea-iteration log (newest at top)
  subpaths/        # one file per candidate approach being researched
    NN-<slug>.md   # see "Subpath file" below
  experiments/     # optional throwaway prototypes / notebooks (keep tiny; link from subpaths)
```

## Conventions

- **Status lives in the README.** Every direction's `README.md` opens with a status
  line: `Status: exploring | prototyping | validated | parked | abandoned`, the
  one-line goal, and the current best approach. Keep it current — it's the index.
- **Subpaths are candidate approaches**, not tasks. Each gets a verdict
  (`promising | viable | ruled-out`) so the tree shows what's alive.
- **Be honest and cite.** Claims about feasibility, model sizes, or performance
  carry a source link (paper/repo/benchmark) or are marked `(unverified)`. Research
  that overstates is worse than none.
- **Prune, don't append-only.** When a subpath is ruled out, mark it and summarize
  *why* in `decisions.md` — don't silently leave stale enthusiasm around.
- **Convert relative dates to absolute** ("late 2025", "2026-06") so the log ages well.
- **Promotion path:** when a direction is validated and we decide to build it, the
  outcome moves into real code (a package, the website, or a spike branch) and the
  research folder keeps the rationale + references. Note the promotion in `decisions.md`.

## Subpath file shape

Each `subpaths/NN-<slug>.md` should cover: **idea** (one line), **how it works**,
**fit for our constraints** (for glyphcss-adjacent work: how tiny? how faithful?
in-browser or offline?), **pros / cons**, **key repos & references**, and a
**verdict** with status. Keep it skimmable.

## Index

See [`README.md`](./README.md) for the list of active directions.
