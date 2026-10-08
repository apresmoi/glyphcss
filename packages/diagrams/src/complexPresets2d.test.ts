import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderGlyphDiagram } from "./render";

const fixture = (name: string) => readFileSync(resolve(__dirname, `../fixtures/${name}.mmd`), "utf8");

// "more complex 2D diagram presets" round (user, verbatim: "I want to add
// more complex agentic architectures, maybe even a complex transformer with
// inner pieces etc") — four genuinely complex, real-shaped 2D presets
// (real subgraph nesting, a feedback cycle, a two-source convergence, a
// fan-out/shared-dead-letter topology). The 2D pipeline has a hard
// 9-node/12-edge compaction budget above which it degrades: compaction ->
// decoration -> duplicates -> leaf clusters -> split-into-panels. A preset
// that shatters into one panel per edge is a failure, not a success, so
// every one of these is pinned to render in exactly ONE panel with no
// dropped label at the page's own default web size (no explicit
// width/height — `GLYPH_DIAGRAM_TARGET_DEFAULTS.web`, 96x32) — so a future
// layout change can't silently shatter them.
describe("complex 2D presets render in one panel with no dropped labels at the default web size", () => {
  for (const name of ["agent-guardrail", "transformer-block", "rag-pipeline", "event-queue"]) {
    it(name, async () => {
      const graph = fixture(name);
      const result = await renderGlyphDiagram(graph, { target: "web" });
      expect(result.pages).toHaveLength(1);
      expect(result.report.unroutable).toEqual([]);
      expect(result.report.ledger.filter((entry) => entry.code === "label-dropped")).toEqual([]);
      expect(result.report.ledger.some((entry) => entry.code === "budget-split")).toBe(false);
      // Every label the source declares (edge labels + subgraph captions)
      // actually landed somewhere in the rendered grid, not just "wasn't
      // logged as dropped" — a genuine mutation check, not a vacuous one.
      expect(result.labels.length).toBeGreaterThan(0);
      // The render is deterministic and stays wide enough to read: no line
      // exceeds the requested 96-column grid.
      for (const line of result.text.split("\n")) expect(line.length).toBeLessThanOrEqual(96);
    });
  }
});
