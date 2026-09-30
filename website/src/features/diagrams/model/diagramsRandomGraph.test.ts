import { describe, expect, it, vi } from "vitest";
import { GLYPH_DIAGRAM_WORKBENCH_PRESETS } from "./diagramsWorkbenchState";
import { DIAGRAMS_REMOTE_GRAPH_INDEX } from "../data/remoteGraphIndex";
import { diagramsGraphSourceKey, randomDiagramsGraphPick } from "./diagramsRandomGraph";

describe("randomDiagramsGraphPick", () => {
  it("draws from the combined built-in + curated Hugging Face pool", () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const pick = randomDiagramsGraphPick();
      expect(pick).toEqual({ kind: "preset", id: GLYPH_DIAGRAM_WORKBENCH_PRESETS[0]!.id });
    } finally {
      randomSpy.mockRestore();
    }
  });

  it("never returns the excluded key across many draws", () => {
    const excludeKey = diagramsGraphSourceKey({ kind: "builtin", presetId: GLYPH_DIAGRAM_WORKBENCH_PRESETS[0]!.id });
    for (let i = 0; i < 200; i++) {
      const pick = randomDiagramsGraphPick(excludeKey);
      const key = pick.kind === "preset" ? `preset:${pick.id}` : `remote:${pick.hit.ref}`;
      expect(key).not.toBe(excludeKey);
    }
  });

  it("can land on a curated Hugging Face graph dataset, not only built-in presets", () => {
    // Deterministic: force the draw to the pool's LAST entry, which is the
    // last curated remote hit (`diagramsRandomGraph.ts`'s own pool order —
    // presets first, then `DIAGRAMS_REMOTE_GRAPH_INDEX`) — a regression
    // that dropped the remote half of the pool entirely would fail this by
    // drawing a preset instead.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0.999999);
    try {
      const pick = randomDiagramsGraphPick();
      expect(pick).toEqual({ kind: "remote", hit: DIAGRAMS_REMOTE_GRAPH_INDEX[DIAGRAMS_REMOTE_GRAPH_INDEX.length - 1] });
    } finally {
      randomSpy.mockRestore();
    }
  });
});

describe("diagramsGraphSourceKey", () => {
  it("keys a builtin and a remote source distinctly, and an absent source to the empty string", () => {
    expect(diagramsGraphSourceKey({ kind: "builtin", presetId: "chain" })).toBe("preset:chain");
    expect(diagramsGraphSourceKey({ kind: "remote", ref: "graphs-datasets/MUTAG" })).toBe("remote:graphs-datasets/MUTAG");
    expect(diagramsGraphSourceKey(undefined)).toBe("");
  });
});
