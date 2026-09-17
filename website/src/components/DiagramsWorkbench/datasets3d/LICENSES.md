# 3D diagram dataset credits

Same discipline as `ChartsWorkbench/datasets/LICENSES.md`: every 3D preset
either vendors real, cited data or is explicitly labelled as a hand-authored
illustrative example — never invented data presented as real.

| Preset | Fixture | Nature | Source | Licence |
|---|---|---|---|---|
| LeNet-5 CNN | `packages/diagrams/fixtures/lenet5-cnn.json` | Hand-authored EXAMPLE (labelled "example" in its title) — layer shapes/sizes are a DESCRIPTION of a published architecture, not real training telemetry or vendored data. | Architecture per Y. LeCun, L. Bottou, Y. Bengio, P. Haffner, "Gradient-Based Learning Applied to Document Recognition," *Proceedings of the IEEE* 86(11), 1998. Diagram authored by the glyphcss project. | Diagram: MIT (glyphcss project). Architecture: a published description, not separately licensed data. |
| Transformer encoder | `packages/diagrams/fixtures/transformer-encoder.json` | Hand-authored EXAMPLE (labelled "example" in its title) — a single encoder block's layer shapes are a DESCRIPTION of a published architecture, not real training telemetry or vendored data. | Architecture per A. Vaswani et al., "Attention Is All You Need," *NeurIPS*, 2017. Diagram authored by the glyphcss project. | Diagram: MIT (glyphcss project). Architecture: a published description, not separately licensed data. |
| Agent supervisor architecture | `packages/diagrams/fixtures/agent-supervisor.mmd` | Hand-authored EXAMPLE (labelled "example" in its title) illustrating a LangGraph-style supervisor → workers pattern. Not telemetry from any real running system. | glyphcss project | MIT (glyphcss project) |
| Multi-agent crew | inline in `diagramsWorkbenchState.ts`'s `GLYPH_DIAGRAM_WORKBENCH_PRESETS` (`"crew"`, "CrewAI-style crew") | Hand-authored EXAMPLE, already labelled "CrewAI-style" — reused verbatim as a 3D preset over the same source. | glyphcss project | MIT (glyphcss project) |
| Fan-out / join / split | `packages/diagrams/fixtures/fan-join-split.mmd` | Hand-authored EXAMPLE (labelled "example" in its title) illustrating a fan-out/join/split topology — not telemetry from any real running system. Added D2 round 7 (coordinator's own follow-up) specifically to exercise the layered layout's triangulated ring placement (a 3-way fan reading as a triangle, `Merge`/`Side` reading as one front/one back feeding `Output`). | glyphcss project | MIT (glyphcss project) |
| CI pipeline DAG | `packages/diagrams/fixtures/ci-pipeline-dag.json` | Hand-authored EXAMPLE (labelled "example" in its title) illustrating a generic CI/build dependency graph (checkout → parallel lint/typecheck/builds → per-target unit/integration/e2e tests → a security gate → packaging → publish/deploy → notify) — not telemetry or configuration from any real running pipeline. Added for the "better diagrams" round (user, verbatim: "I want some really interesting diagrams") to exercise a genuinely wide fan-out/fan-in shape (19 nodes / 31 edges) neither the earlier, mostly-linear presets nor a small fan-out/join topology reach. | glyphcss project | MIT (glyphcss project) |

D2 round 6 retired the Zachary's karate club preset (real vendored network
data, `layout: "force"`) — an old `?d=` link naming it degrades to the
first 3D preset (`diagramsUrlState.ts`'s own fallback) rather than
throwing.
