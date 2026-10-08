import { describe, expect, it } from "vitest";
import { parseDatasetHitFromQuery } from "../../../services/datasets/datasetSearch";
import { CHARTS_REMOTE_DATASET_INDEX } from "./remoteIndex";

/** Shape/uniqueness checks only — this file's own header comment records
 *  that every id was verified to actually load through `loadDatasetRows`
 *  at the time it was written (a real HTTP round trip, done once as a
 *  script, not re-run per test). See the task report for the recorded
 *  smoke-test results. */
describe("CHARTS_REMOTE_DATASET_INDEX", () => {
  it("has roughly 30 curated suggestions, each a valid Hugging Face hit", () => {
    expect(CHARTS_REMOTE_DATASET_INDEX.length).toBeGreaterThanOrEqual(20);
    expect(CHARTS_REMOTE_DATASET_INDEX.length).toBeLessThanOrEqual(40);
    for (const hit of CHARTS_REMOTE_DATASET_INDEX) {
      expect(hit.kind).toBe("hf");
      expect(hit.ref).toMatch(/^[\w.-]+\/[\w.-]+$/);
      expect(hit.id).toBe(hit.ref);
      expect(hit.title.length).toBeGreaterThan(0);
      expect(hit.url).toBe(`https://huggingface.co/datasets/${hit.ref}`);
      // Every curated ref must itself parse back as a bare HF id — proves
      // the search box's "paste a bare org/name" path recognizes every
      // suggestion it also offers by click.
      expect(parseDatasetHitFromQuery(hit.ref)).toMatchObject({ kind: "hf", ref: hit.ref });
    }
  });

  it("every id is unique", () => {
    const ids = CHARTS_REMOTE_DATASET_INDEX.map((h) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // P2-3 (REVIEW-arc-density-search-opus.md): three ids loaded fine and
  // then silently charted nothing (every real column categorical/boolean —
  // `recommendChart` has no numeric/date column to build from). Dropped
  // rather than kept as a dead-end click.
  it("does not curate an all-categorical dataset with no chartable column (mushroom/car/tic-tac-toe)", () => {
    const ids = CHARTS_REMOTE_DATASET_INDEX.map((h) => h.id);
    expect(ids).not.toContain("mstz/mushroom");
    expect(ids).not.toContain("mstz/car");
    expect(ids).not.toContain("mstz/tic_tac_toe");
  });

  // P3-13: the header/design-doc claim that `scikit-learn/iris` rounds out
  // the list used to be false — it wasn't in the array at all.
  it("curates scikit-learn/iris, as this file's own header claims", () => {
    expect(CHARTS_REMOTE_DATASET_INDEX.map((h) => h.id)).toContain("scikit-learn/iris");
  });
});
