# 3D diagram dataset credits

Same discipline as `ChartsWorkbench/datasets/LICENSES.md`: every 3D preset
either vendors real, cited data or is explicitly labelled as a hand-authored
illustrative example — never invented data presented as real.

| Preset | Fixture | Nature | Source | Licence |
|---|---|---|---|---|
| Agent supervisor architecture | `packages/diagrams/fixtures/agent-supervisor.mmd` | Hand-authored EXAMPLE (labelled "example" in its title) illustrating a LangGraph-style supervisor → workers pattern. Not telemetry from any real running system. | glyphcss project | MIT (glyphcss project) |
| Multi-agent crew | inline in `diagramsWorkbenchState.ts`'s `GLYPH_DIAGRAM_WORKBENCH_PRESETS` (`"crew"`, "CrewAI-style crew") | Hand-authored EXAMPLE, already labelled "CrewAI-style" — reused verbatim as a 3D preset over the same source. | glyphcss project | MIT (glyphcss project) |
| Zachary's karate club | `packages/diagrams/fixtures/karate-club.mmd` | Real, vendored network data — 34 members, 78 observed friendships, and the two-faction split after the club's historical fission. | W. W. Zachary, "An Information Flow Model for Conflict and Fission in Small Groups," *Journal of Anthropological Research* 33(4), 1977. Edge list and faction assignment as commonly reproduced (e.g. NetworkX's `karate_club_graph()`). | Public domain (academic data, widely reproduced) |

The karate club preset renders with `layout: "force"` — force
layout's group-attraction spring (AGENTS.md's "Diagrams 3D") uses the two
`subgraph` blocks the fixture declares (`mr_hi`/`officer`) to pull each
faction toward its own centroid, which is what makes the historical split
visible as spatial clustering rather than a claim drawn on top of the data.
