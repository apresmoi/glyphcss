# 2D diagram fixture credits

Every fixture is either vendored real data or explicitly labelled as a
hand-authored illustrative example.

| Preset | Fixture | Nature | Source | Licence |
|---|---|---|---|---|
| Agent + guardrail loop | `agent-guardrail.mmd` | Hand-authored EXAMPLE (labelled "example" in its own header comment) illustrating a supervisor → specialist-agents → tools/memory → guardrail pattern with a retry cycle. Not telemetry from any real running system. | glyphcss project | MIT (glyphcss project) |
| Transformer block (inner) | `transformer-block.mmd` | Hand-authored EXAMPLE (labelled "example" in its own header comment) — a single encoder block's INTERNAL structure (Q/K/V projections, attention heads' concat+project, Add & Norm, the feed-forward network's two linear projections). Architecture per A. Vaswani et al., "Attention Is All You Need," *NeurIPS*, 2017; diagram authored by the glyphcss project. | Diagram: MIT (glyphcss project). Architecture: a published description, not separately licensed data. |
| RAG pipeline | `rag-pipeline.mmd` | Hand-authored EXAMPLE (labelled "example" in its own header comment) illustrating a retrieval-augmented-generation pipeline (ingest/chunk/embed/index converging with query/embed/retrieve/rerank/generate). Not telemetry from any real running system. | glyphcss project | MIT (glyphcss project) |
| Event queue + DLQ | `event-queue.mmd` | Hand-authored EXAMPLE (labelled "example" in its own header comment) illustrating an event-driven microservice topology with a fan-out queue and a shared dead-letter path. Not telemetry from any real running system. | glyphcss project | MIT (glyphcss project) |
| Agent supervisor architecture | `agent-supervisor.mmd` | Hand-authored example illustrating a supervisor → workers pattern; retained as a 2D routing fixture. | glyphcss project | MIT (glyphcss project) |
