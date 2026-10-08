import { describe, expect, it } from "vitest";
import { parseDatasetHitFromQuery } from "../../../services/datasets/datasetSearch";
import { DIAGRAMS_REMOTE_GRAPH_INDEX } from "./remoteGraphIndex";

/** Shape/uniqueness checks only — this file's own header comment records
 *  that every id was verified to actually load, live, at the time it was
 *  written (see the task report for the recorded round trips). */
describe("DIAGRAMS_REMOTE_GRAPH_INDEX", () => {
  it("curates exactly the molecule/ego-net/discussion/collaboration spread the brief named", () => {
    expect(DIAGRAMS_REMOTE_GRAPH_INDEX.length).toBe(7);
    for (const hit of DIAGRAMS_REMOTE_GRAPH_INDEX) {
      expect(hit.kind).toBe("hf");
      expect(hit.ref).toMatch(/^graphs-datasets\/[\w.-]+$/);
      expect(hit.id).toBe(hit.ref);
      expect(hit.title.length).toBeGreaterThan(0);
      expect(hit.description && hit.description.length).toBeGreaterThan(0);
      expect(hit.url).toBe(`https://huggingface.co/datasets/${hit.ref}`);
      expect(hit.licence && hit.licence.length).toBeGreaterThan(0);
      // Every curated ref must itself parse back as a bare HF id — proves
      // the search box's "paste a bare org/name" path recognizes every
      // suggestion it also offers by click.
      expect(parseDatasetHitFromQuery(hit.ref)).toMatchObject({ kind: "hf", ref: hit.ref });
    }
  });

  it("every id is unique", () => {
    const ids = DIAGRAMS_REMOTE_GRAPH_INDEX.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("records AIDS's licence honestly as not stated on its card, distinct from MUTAG/ZINC's own explicit 'unknown'", () => {
    const aids = DIAGRAMS_REMOTE_GRAPH_INDEX.find((h) => h.id === "graphs-datasets/AIDS");
    const mutag = DIAGRAMS_REMOTE_GRAPH_INDEX.find((h) => h.id === "graphs-datasets/MUTAG");
    expect(aids?.licence).toBe("not stated");
    expect(mutag?.licence).toBe("unknown");
  });
});
