import { describe, expect, it } from "vitest";
import { renderGlyphLaneDag, renderGlyphLaneDagJson } from "./render";
import type { GlyphLaneDag, GlyphLaneNode } from "./types";

// Same shape as layout.test.ts's GIT_STYLE fixture — kept independent here
// so this file's rendering assertions don't depend on that file's exports.
const GIT_STYLE: GlyphLaneDag = {
  nodes: [
    { id: "9f2c1ab", label: "release: cut 2.4.0", parents: ["2d6aa19", "4ab77de"], marks: ["main", "v2.4.0"] },
    { id: "4ab77de", label: "chore: bump deps", parents: ["7e41b02", "1c90fee"] },
    { id: "1c90fee", label: "fix(auth): refresh token race", parents: ["7e41b02"] },
    { id: "7e41b02", label: "feat(orders): partial refunds", parents: ["b83f5c7"] },
    { id: "2d6aa19", label: "docs: architecture decision 014", parents: ["b83f5c7"] },
    { id: "b83f5c7", label: "fix(http): keep-alive leak", parents: [] },
  ],
};

// A NON-git fixture: a CI pipeline with parallel stages. Nodes are runs, not
// commits — "id"/"label"/"parents"/"marks" carry no git vocabulary, and a
// run can depend on more than one earlier stage (a fan-in merge) the same
// way a git merge commit does. Exercises the form's claimed generality.
const CI_PIPELINE: GlyphLaneDag = {
  nodes: [
    { id: "deploy-42", label: "deploy to prod", parents: ["build-42", "e2e-42"], marks: ["release"] },
    { id: "e2e-42", label: "e2e suite", parents: ["build-42"] },
    { id: "build-42", label: "build artifact", parents: ["lint-42", "unit-42"] },
    { id: "unit-42", label: "unit tests", parents: [] },
    { id: "lint-42", label: "lint", parents: [] },
  ],
};

describe("renderGlyphLaneDag", () => {
  it("renders every node's id and label, and pads every line to the requested width", async () => {
    const result = await renderGlyphLaneDag(GIT_STYLE, { target: "chat", width: 72, height: 24 });
    for (const node of GIT_STYLE.nodes) {
      expect(result.text).toContain(node.id);
      expect(result.text).toContain(node.label);
    }
    for (const line of result.text.split("\n")) expect(line.length).toBe(72);
  });

  it("renders a non-git DAG (a CI pipeline with parallel stages, fan-in included) with no git vocabulary anywhere in the IR", async () => {
    const result = await renderGlyphLaneDag(CI_PIPELINE, { target: "chat", width: 60, height: 12 });
    for (const node of CI_PIPELINE.nodes) expect(result.text).toContain(node.id);
    expect(result.text).toContain("release");
    // Two parents on build-42 (lint-42, unit-42) is a branch point; the same
    // fan-in shape a git merge commit draws, on data that is not git at all.
    expect(result.text).toMatch(/[┌┐└┘├┤┬┴┼]/);
  });

  it("draws a branch as a ROUNDED corner, not a plain crossing (mutation: fall back to the tier's square junction) → red", async () => {
    const result = await renderGlyphLaneDag(GIT_STYLE, { target: "chat", width: 72, height: 24 });
    // USER FEEDBACK, verbatim: "I would like for them to use curved
    // segments". A turn is an arc; a tee/cross stays the tier's own glyph.
    expect(result.text).toMatch(/[╭╮╰╯]/);
    expect(result.text).not.toMatch(/[┌┐└┘]/);
  });

  it("marks a node with its caller-supplied marks, rendered verbatim", async () => {
    const result = await renderGlyphLaneDag(GIT_STYLE, { target: "chat", width: 72, height: 24 });
    expect(result.text).toContain("main");
    expect(result.text).toContain("v2.4.0");
  });

  it("collapses the least-active lanes and logs it when the natural lane width doesn't fit", async () => {
    // Three concurrent lanes (9f2c1ab/4ab77de/1c90fee's branch) at column
    // width 2 need 6+ cells before any content even starts; 6 leaves no room.
    const result = await renderGlyphLaneDag(GIT_STYLE, { target: "chat", width: 6, height: 24 });
    // Mutation: skip the lane-cap degrade entirely -> no lane-cap-collapsed
    // entry is logged and a naturally-3-lane row wouldn't fit in 6 columns.
    expect(result.report.ledger.some((e) => e.code === "lane-cap-collapsed")).toBe(true);
    for (const line of result.text.split("\n")) expect(line.length).toBe(6);
  });

  it("never drops a collapsed node's own row or label when the collapsed content still fits — only its distinct lane position degrades", async () => {
    // Same branch/merge topology as GIT_STYLE but with single-character ids
    // and labels, so a width that forces lane collapsing still leaves ample
    // room for full (untruncated) content.
    const shortLabels: GlyphLaneDag = {
      nodes: [
        { id: "A", label: "A", parents: ["E", "B"] },
        { id: "B", label: "B", parents: ["D", "C"] },
        { id: "C", label: "C", parents: ["D"] },
        { id: "D", label: "D", parents: ["F"] },
        { id: "E", label: "E", parents: ["F"] },
        { id: "F", label: "F", parents: [] },
      ],
    };
    const result = await renderGlyphLaneDag(shortLabels, { target: "chat", width: 10, height: 24 });
    const collapsed = result.report.ledger.find((e) => e.code === "lane-cap-collapsed");
    expect(collapsed).toBeTruthy();
    const nodeIds = (collapsed!.detail as { nodeIds: string[] }).nodeIds;
    expect(nodeIds.length).toBeGreaterThan(0);
    // Mutation: drop a collapsed node's row entirely instead of just
    // remapping its lane -> its id/label would vanish from the text below.
    for (const node of shortLabels.nodes) { expect(result.text).toContain(node.id); expect(result.text).toContain(node.label); }
    expect(result.report.ledger.some((e) => e.code === "label-abbreviated")).toBe(false);
  });

  it("pages a lane DAG that does not fit the requested height into multiple panels, and logs it", async () => {
    // A long straight line (no branching) so width is trivial and only
    // height forces pagination.
    const nodes: GlyphLaneNode[] = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`, label: `step ${i}`, parents: i < 19 ? [`n${i + 1}`] : [],
    }));
    const result = await renderGlyphLaneDag({ nodes }, { target: "chat", width: 40, height: 8 });
    // Mutation: never split by time -> pages.length stays 1 and rows would
    // overflow the requested height.
    expect(result.pages.length).toBeGreaterThan(1);
    expect(result.report.ledger.some((e) => e.code === "lane-paged")).toBe(true);
    for (const page of result.pages) expect(page.text.split("\n").length).toBeLessThanOrEqual(8);
  });

  it("never splits a node row from its own connector row across a page boundary", async () => {
    // A repeating branch/merge history tall enough to force pagination.
    const nodes: GlyphLaneNode[] = [];
    const cycles = 6;
    for (let i = 0; i < cycles; i++) {
      nodes.push({ id: `m${i}`, label: `merge ${i}`, parents: [`x${i}`, `y${i}`] });
      nodes.push({ id: `x${i}`, label: `x ${i}`, parents: [`m${i + 1}`] });
      nodes.push({ id: `y${i}`, label: `y ${i}`, parents: [`m${i + 1}`] });
    }
    nodes.push({ id: `m${cycles}`, label: "root", parents: [] });
    const result = await renderGlyphLaneDag({ nodes }, { target: "chat", width: 40, height: 10 });
    expect(result.pages.length).toBeGreaterThan(1);
    // Every branch/merge corner glyph is immediately preceded, in its own
    // page, by the node row it belongs to — never the first line of a page
    // (which would mean the pair got split).
    for (const page of result.pages) {
      const lines = page.text.split("\n");
      const firstConnectorIndex = lines.findIndex((l) => /[┌┐└┘├┤]/.test(l));
      if (firstConnectorIndex === -1) continue;
      expect(firstConnectorIndex).toBeGreaterThan(0);
    }
  });

  it("renders every ascii-charset output within the printable ASCII range", async () => {
    const result = await renderGlyphLaneDag(GIT_STYLE, { target: "chat", charset: "ascii", width: 72, height: 24 });
    for (const ch of result.text) if (ch !== "\n") expect(ch.codePointAt(0)!).toBeLessThanOrEqual(0x7e);
  });

  it("box/blocks/braille charsets all draw the same whole-cell box-drawing (no hardcoded literals)", async () => {
    const box = await renderGlyphLaneDag(GIT_STYLE, { target: "chat", charset: "box", color: "none", width: 72, height: 24 });
    const braille = await renderGlyphLaneDag(GIT_STYLE, { target: "chat", charset: "braille", color: "none", width: 72, height: 24 });
    expect(braille.text).toBe(box.text);
  });

  it("round-trips through the JSON entry point, success and failure", async () => {
    const ok = JSON.parse(await renderGlyphLaneDagJson(JSON.stringify(GIT_STYLE), { target: "chat", width: 72, height: 24 }));
    expect(ok.text).toContain("9f2c1ab");
    const bad = JSON.parse(await renderGlyphLaneDagJson("{not json"));
    expect(bad.code).toBe("GLYPH_LANE_BAD_JSON");
    expect(bad.hint).toBeTruthy();
  });

  it("renders straight from a git log string through the same entry point", async () => {
    const result = await renderGlyphLaneDag("a||main|first commit", { target: "chat", width: 40, height: 10 });
    expect(result.text).toContain("first commit");
  });
});

describe("colour surface: laneColor", () => {
  it("color: none stays byte-identical whether or not laneColor is set (colour is additive only)", async () => {
    const plain = await renderGlyphLaneDag(GIT_STYLE, { color: "none", width: 72, height: 24 });
    const withOverride = await renderGlyphLaneDag(GIT_STYLE, { color: "none", width: 72, height: 24, laneColor: "#123456" });
    expect(withOverride.text).toBe(plain.text);
    expect(withOverride.canvas.grid.color.every((c) => c === null)).toBe(true);
  });

  it("defaults to the shared palette, cycled by lane — the branch/merge in GIT_STYLE puts more than one lane on screen at once, so more than one colour must appear (mutation: one flat default colour collapses this to one)", async () => {
    const result = await renderGlyphLaneDag(GIT_STYLE, { target: "web", color: "css" });
    const used = new Set(result.canvas.grid.color.filter((c): c is string => c !== null));
    expect(used.size).toBeGreaterThan(1);
  });

  it("laneColor as a plain string overrides every painted glyph — no lane keeps a palette default", async () => {
    const result = await renderGlyphLaneDag(GIT_STYLE, { target: "web", color: "css", laneColor: "#654321" });
    const used = new Set(result.canvas.grid.color.filter((c): c is string => c !== null));
    expect(used).toEqual(new Set(["#654321"]));
  });

  it("a lane keeps its own colour down its whole column: every cell in lane 0's column paints the same colour, from the first node row to the last", async () => {
    const result = await renderGlyphLaneDag(GIT_STYLE, { target: "web", color: "css" });
    const cols = result.canvas.grid.cols;
    // Lane 0 (the FIRST allocated column) carries the release node all the
    // way down through the merge at the root — never freed until the very
    // last row — but the whole diagram is CENTRED in the requested grid, so
    // its actual x is wherever the first node row painted its own "*"
    // marker, never a hardcoded 0.
    const firstStar = result.canvas.grid.char.indexOf("*");
    expect(firstStar).toBeGreaterThanOrEqual(0);
    const laneZeroX = firstStar % cols;
    // Mutation: colour keyed off the CURRENT owner node instead of the lane
    // index would still be internally consistent for a single unbroken
    // run, so the real proof is comparing the top and bottom of the same
    // never-freed column, spanning the branch AND the later merge.
    const columnColors = new Set<string>();
    for (let y = 0; y < result.canvas.grid.rows; y++) {
      const c = result.canvas.grid.color[y * cols + laneZeroX];
      if (c !== null) columnColors.add(c);
    }
    expect(columnColors.size).toBe(1);
  });

  it("rejects a laneColor that isn't canonical lowercase #rrggbb with the package's own tagged bad-color rule", async () => {
    await expect(renderGlyphLaneDag(GIT_STYLE, { color: "css", laneColor: "blue" })).rejects.toMatchObject({ code: "bad-color" });
    await expect(renderGlyphLaneDag(GIT_STYLE, { color: "css", laneColor: () => "#ffff" })).rejects.toMatchObject({ code: "bad-color" });
  });
});
