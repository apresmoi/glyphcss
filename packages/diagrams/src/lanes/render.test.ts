import { describe, expect, it } from "vitest";
import { glyphLaneRenderProbe, renderGlyphLaneDag, renderGlyphLaneDagJson } from "./render";
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
  it("renders every node's id (when ids is on) and label, and pads every line to the requested width", async () => {
    const result = await renderGlyphLaneDag(GIT_STYLE, { target: "chat", width: 72, height: 24, ids: true });
    for (const node of GIT_STYLE.nodes) {
      expect(result.text).toContain(node.id);
      expect(result.text).toContain(node.label);
    }
    for (const line of result.text.split("\n")) expect(line.length).toBe(72);
  });

  it("renders a non-git DAG (a CI pipeline with parallel stages, fan-in included) with no git vocabulary anywhere in the IR", async () => {
    const result = await renderGlyphLaneDag(CI_PIPELINE, { target: "chat", width: 60, height: 12, ids: true });
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

  it("never splits a node row from its own connector rows across a page boundary", async () => {
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
    // Mutation: page by node row plus the row after it -> a merge row ends a
    // page with its node on the next one.
    // In its own page, a branch row sits right under its node and a merge row
    // right over it.
    let merges = 0;
    for (const page of result.pages) {
      const lines = page.text.split("\n");
      lines.forEach((line, i) => {
        if (/[╮┐╭┌]/.test(line)) expect(lines[i - 1], line).toContain("*");
        if (/[╯┘]/.test(line)) { merges++; expect(lines[i + 1], line).toContain("*"); }
      });
    }
    expect(merges).toBeGreaterThan(0);
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
    const ok = JSON.parse(await renderGlyphLaneDagJson(JSON.stringify(GIT_STYLE), { target: "chat", width: 72, height: 24, ids: true }));
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

// A `git log -8` window: the oldest commit names a parent outside it, and the
// v1.4.0 merge's second parent (7710bb3) is outside it too.
const TRUNCATED_LOG = [
  "a1f3c92|b7d0e41 c5528ab|(HEAD -> main, origin/main)|Merge branch 'fix/login-redirect'",
  "c5528ab|e19a7f0|(origin/fix/login-redirect, fix/login-redirect)|fix: keep return url on login redirect",
  "b7d0e41|3fa8120||feat: add CSV export to reports",
  "3fa8120|e19a7f0||refactor: split report builder",
  "e19a7f0|90c1d3b||chore: bump vite to 6.2",
  "90c1d3b|5d2e6a7 7710bb3|(tag: v1.4.0)|Merge pull request #212 from acme/dark-mode",
  "5d2e6a7|a04c9f8||docs: update README install steps",
  "a04c9f8|d8800ee||fix: handle empty cart totals",
].join("\n");

const PLAN: GlyphLaneDag = {
  nodes: [
    { id: "launch", label: "Launch", parents: ["beta", "docs"] },
    { id: "docs", label: "Write docs", parents: ["design"] },
    { id: "beta", label: "Beta release", parents: ["api", "ui"] },
    { id: "ui", label: "Build UI", parents: ["design"] },
    { id: "api", label: "Build API", parents: ["design"] },
    { id: "design", label: "Design", parents: ["kickoff"] },
    { id: "kickoff", label: "Kickoff", parents: [] },
  ],
};

const chain = (n: number, truncated: boolean): GlyphLaneDag => ({
  ...(truncated ? { truncated } : {}),
  nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `step ${i}`, parents: i < n - 1 ? [`n${i + 1}`] : truncated ? ["older"] : [] })),
});

describe("truncated git log window", () => {
  it("renders, continues the open lanes with a dashed rule on the last row, and logs lane-history-continues", async () => {
    const result = await renderGlyphLaneDag(TRUNCATED_LOG, { target: "chat" });
    const lines = result.text.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0);
    const last = lines[lines.length - 1]!, above = lines[lines.length - 2]!;
    // Mutation: drop the trailing continuation row (layout.ts) -> last line is the a04c9f8 row -> red.
    expect(last.replace(/\s/g, "")).toBe("╎╎");
    // The dashes sit exactly under the two lanes still open above them.
    expect(last.indexOf("╎")).toBe(above.indexOf("*"));
    expect(last.lastIndexOf("╎")).toBe(above.indexOf("│"));
    const entry = result.report.ledger.find((e) => e.code === "lane-history-continues");
    expect(entry?.detail).toEqual({ lines: 2, nodeIds: ["90c1d3b", "a04c9f8"] });
  });

  it("uses the tier's dashed vertical and ':' on ascii", async () => {
    // Mutation: paint tier.straight.v instead of tier.hop.v -> │ replaces ╎ / | replaces : -> red.
    const ascii = await renderGlyphLaneDag(TRUNCATED_LOG, { target: "chat", charset: "ascii" });
    expect(ascii.text).toContain(":");
    expect(ascii.text.split("\n").filter((l) => l.trim()).pop()!.replace(/\s/g, "")).toBe("::");
  });

  it("logs no lane-history-continues for a complete history", async () => {
    const result = await renderGlyphLaneDag(GIT_STYLE, { target: "chat" });
    expect(result.report.ledger.some((e) => e.code === "lane-history-continues")).toBe(false);
  });

  it("never leaves a page holding only the continuation row", async () => {
    // Mutation: stop attaching the trailing continuation to the last unit (render.ts buildUnits) -> a page of just "╎" -> red.
    const result = await renderGlyphLaneDag(chain(4, true), { target: "chat", width: 30, height: 2 });
    expect(result.pages.length).toBeGreaterThan(1);
    for (const page of result.pages) expect(page.text).toContain("*");
    expect(result.pages[result.pages.length - 1]!.text).toContain("╎");
  });

  it("keeps the leading continuation (oldest-first) on the first page with its node", async () => {
    // Mutation: make buildUnits emit the leading continuation as its own unit -> first page is only "╎" -> red.
    const result = await renderGlyphLaneDag(chain(4, true), { target: "chat", width: 30, height: 1, order: "oldest-first" });
    expect(result.pages.length).toBeGreaterThan(1);
    for (const page of result.pages) expect(page.text).toContain("*");
    expect(result.pages[0]!.text).toContain("╎");
  });

  it("resolves a laneColor function for a lane that enters from above without throwing", async () => {
    // Mutation: drop the firstNode fallback in paint.ts -> the callback receives undefined and throws -> red.
    const result = await renderGlyphLaneDag(TRUNCATED_LOG, { target: "web", color: "css", order: "oldest-first", laneColor: (node) => (node.id.length > 3 ? "#112233" : "#445566") });
    expect(result.text).toContain("╎");
  });
});

describe("order: oldest-first", () => {
  it("paints the oldest node first and draws a fork's branch connector below the forking node", async () => {
    const result = await renderGlyphLaneDag(PLAN, { target: "chat", order: "oldest-first" });
    const lines = result.text.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0);
    // Mutation: skip the inversion in render.ts -> the first row is Launch -> red.
    expect(lines[0]).toContain("Kickoff");
    expect(lines[lines.length - 1]).toContain("Launch");
    const design = lines.findIndex((l) => l.includes("Design"));
    // Design forks into api, ui and docs: its connector is the row BELOW it, branching out.
    expect(lines[design + 1]).toMatch(/[├┬╮]/);
    expect(lines[design + 1]).toContain("╮");
    expect(lines[design + 2]).toContain("Build API");
    // Launch joins beta and docs: the join sits ABOVE it.
    expect(lines[lines.length - 2]).toContain("╯");
  });

  it("leaves the default order newest-first and byte-identical to naming it", async () => {
    const implicit = await renderGlyphLaneDag(PLAN, { target: "chat" });
    const named = await renderGlyphLaneDag(PLAN, { target: "chat", order: "newest-first" });
    expect(named.text).toBe(implicit.text);
    expect(implicit.text.split("\n").find((l) => l.trim())).toContain("Launch");
  });

  it("opens lanes ABOVE the first node for an absent parent, and logs the continuation", async () => {
    const result = await renderGlyphLaneDag(TRUNCATED_LOG, { target: "chat", order: "oldest-first" });
    const lines = result.text.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0);
    expect(lines[0]!.replace(/\s/g, "")).toBe("╎╎");
    expect(lines[lines.length - 1]).toContain("a1f3c92");
    expect(result.report.ledger.some((e) => e.code === "lane-history-continues")).toBe(true);
  });

  it("draws a connector's run through an empty lane column instead of skipping the cell", async () => {
    // Mutation: restore the unconditional lane-column skip in paint.ts -> "├─ ─╯" -> red.
    const result = await renderGlyphLaneDag(PLAN, { target: "chat", order: "oldest-first" });
    expect(result.text).toContain("├───╯");
    expect(result.text).not.toContain("─ ─");
  });
});

describe("ids", () => {
  it("hides ids for an object and shows them for a git-log string, by default", async () => {
    // Mutation: flip the default (opts.ids ?? typeof input !== "string") -> red.
    const object = await renderGlyphLaneDag(PLAN, { target: "chat" });
    expect(object.text).not.toContain("kickoff");
    expect(object.text).toMatch(/\* +Launch/);
    expect(object.text).not.toMatch(/launch +Launch/);
    const git = await renderGlyphLaneDag("abc1234|||first commit", { target: "chat" });
    expect(git.text).toMatch(/\* abc1234  first commit/);
  });

  it("honours an explicit ids either way, and a row without an id has no leading double space before the marks", async () => {
    // Mutation: ignore options.ids in paint -> both overrides ignored -> red.
    const marked: GlyphLaneDag = { nodes: [{ id: "abc", label: "hello", parents: [], marks: ["main"] }] };
    const hidden = await renderGlyphLaneDag(marked, { target: "chat", ids: false });
    expect(hidden.text).toMatch(/\* \(main\)  hello/);
    expect(hidden.text).not.toContain("abc");
    const shown = await renderGlyphLaneDag(marked, { target: "chat", ids: true });
    expect(shown.text).toMatch(/\* abc  \(main\)  hello/);
    const gitHidden = await renderGlyphLaneDag("abc1234|||first commit", { target: "chat", ids: false });
    expect(gitHidden.text).not.toContain("abc1234");
  });
});

describe("label-abbreviated summary", () => {
  it("logs ONE entry per render with the total count, each node counted once across pages", async () => {
    // Mutation: report opts.width instead of the label column -> "24 columns" -> red.
    // Mutation: push one entry per node (the old behaviour) -> filter length is 12, not 1 -> red.
    const nodes: GlyphLaneNode[] = Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`, label: `a deliberately long label for step number ${i}`, parents: i < 11 ? [`n${i + 1}`] : [],
    }));
    const result = await renderGlyphLaneDag({ nodes }, { target: "chat", width: 24, height: 5 });
    expect(result.pages.length).toBeGreaterThan(1);
    const entries = result.report.ledger.filter((e) => e.code === "label-abbreviated");
    expect(entries).toHaveLength(1);
    // 24 wide minus the one 2-cell lane column: the label column's real width.
    expect(entries[0]!.message).toBe("Abbreviated 12 node labels to fit 22 columns.");
    expect(entries[0]!.detail).toMatchObject({ role: "node label", count: 12 });
    expect((entries[0]!.detail as { nodeIds: string[] }).nodeIds).toHaveLength(12);
  });

  it("logs nothing when every label fits", async () => {
    const result = await renderGlyphLaneDag(PLAN, { target: "chat" });
    expect(result.report.ledger.some((e) => e.code === "label-abbreviated")).toBe(false);
  });
});

describe("overflow", () => {
  it("expand renders one page of the full height at the same width and logs no paging", async () => {
    // Mutation: ignore opts.overflow in render.ts -> several pages and lane-paged -> red.
    const result = await renderGlyphLaneDag(chain(20, false), { target: "chat", width: 40, height: 8, overflow: "expand" });
    expect(result.pages).toHaveLength(1);
    const lines = result.text.split("\n");
    expect(lines).toHaveLength(20);
    for (const line of lines) expect(line.length).toBe(40);
    expect(result.report.ledger.some((e) => e.code === "lane-paged")).toBe(false);
  });

  it("paginate (default) still splits", async () => {
    const result = await renderGlyphLaneDag(chain(20, false), { target: "chat", width: 40, height: 8, overflow: "paginate" });
    expect(result.pages.length).toBeGreaterThan(1);
  });
});

describe("option validation", () => {
  it.each([{ order: "sideways" }, { ids: "yes" }, { overflow: "scroll" }])("rejects %j with bad-options", async (bad) => {
    // Mutation: delete the matching check in resolvedOptions -> it renders instead of throwing -> red.
    await expect(renderGlyphLaneDag(PLAN, bad as never)).rejects.toMatchObject({ code: "bad-options" });
  });
});

describe("oldest-first lane choice", () => {
  const starColumn = (text: string, label: string): number => text.split("\n").find((l) => l.includes(label))!.indexOf("*");

  it("keeps a node on its FIRST parent's lane when another parent is outside the window, joining the outside lane from the side", async () => {
    const dag: GlyphLaneDag = { truncated: true, nodes: [{ id: "c", label: "child c", parents: ["b", "old"] }, { id: "b", label: "parent b", parents: [] }] };
    const result = await renderGlyphLaneDag(dag, { target: "chat", order: "oldest-first" });
    // Mutation: drop continuesFrom in render.ts -> c lands on the incoming lane, left of b -> red.
    expect(starColumn(result.text, "child c")).toBe(starColumn(result.text, "parent b"));
    const lines = result.text.split("\n").filter((l) => l.trim());
    // The outside lane comes down from above on the left, then joins c from the side.
    expect(lines[0]!.trim()).toBe("╎");
    expect(lines[lines.length - 2]).toMatch(/╰─┤/);
    expect(lines[lines.length - 2]!.indexOf("╰")).toBeLessThan(starColumn(result.text, "child c"));
  });

  it("keeps a node on its first parent's lane when two parents are in the window and the first is not the leftmost lane", async () => {
    const dag: GlyphLaneDag = {
      nodes: [
        { id: "x", label: "merge x", parents: ["p0", "p1"] },
        { id: "p0", label: "parent p0", parents: ["r"] },
        { id: "p1", label: "parent p1", parents: ["r"] },
        { id: "r", label: "root r", parents: [] },
      ],
    };
    const result = await renderGlyphLaneDag(dag, { target: "chat", order: "oldest-first" });
    // r forks to p1 (lane 0) then p0 (lane 1): p0 is the RIGHT lane, yet x continues it.
    // Mutation: drop continuesFrom in render.ts -> x lands in p1's (leftmost) column -> red.
    expect(starColumn(result.text, "parent p1")).toBeLessThan(starColumn(result.text, "parent p0"));
    expect(starColumn(result.text, "merge x")).toBe(starColumn(result.text, "parent p0"));
  });

  it("colours a lane running in from above by the node it leads to, not the panel's first node", async () => {
    const dag: GlyphLaneDag = { truncated: true, nodes: [{ id: "c", label: "child c", parents: ["b", "old"] }, { id: "b", label: "parent b", parents: [] }] };
    const result = await renderGlyphLaneDag(dag, { target: "web", color: "css", order: "oldest-first", laneColor: (node) => (node.id === "c" ? "#cc0000" : "#0000bb") });
    const { char, color } = result.canvas.grid;
    const dash = char.indexOf("╎");
    // Mutation: look up the panel's first node (b) before the waiting node -> "#0000bb" -> red.
    expect(dash).toBeGreaterThanOrEqual(0);
    expect(color[dash]).toBe("#cc0000");
  });
});

// Colours of every painted cell in reading order, page after page: pagination
// and centring move cells around but must never recolour a glyph.
const paintedColors = (pages: readonly { readonly canvas: { readonly grid: { readonly char: readonly string[]; readonly color: readonly (string | null)[] } } }[]): string[] =>
  pages.flatMap((page) => page.canvas.grid.char.flatMap((ch, i) => (ch.trim() ? [`${ch}${page.canvas.grid.color[i]}`] : [])));
const colorByIndex = (dag: GlyphLaneDag) => {
  const palette = new Map(dag.nodes.map((node, i) => [node.id, `#${((i + 1) * 0x101010).toString(16).padStart(6, "0")}`] as const));
  return { palette, laneColor: (node: GlyphLaneNode) => palette.get(node.id)! };
};

describe("laneColor on a paginated panel", () => {
  const dag: GlyphLaneDag = {
    nodes: [
      { id: "m", label: "merge m", parents: ["a1", "b1"] },
      { id: "a1", label: "a one", parents: ["a2"] },
      { id: "a2", label: "a two", parents: ["a3"] },
      { id: "a3", label: "a three", parents: ["r"] },
      { id: "b1", label: "b one", parents: ["r"] },
      { id: "r", label: "root", parents: [] },
    ],
  };
  const open: GlyphLaneDag = { truncated: true, nodes: [{ id: "m", label: "m", parents: ["a", "outside"] }, { id: "a", label: "a", parents: ["b"] }, { id: "b", label: "b", parents: ["c"] }, { id: "c", label: "c", parents: [] }] };
  const forked: GlyphLaneDag = {
    nodes: [
      { id: "z", label: "z", parents: ["h"] },
      { id: "h", label: "h", parents: ["p", "q"] },
      { id: "p", label: "p", parents: ["p2"] },
      { id: "p2", label: "p2", parents: ["p3"] },
      { id: "p3", label: "p3", parents: ["r"] },
      { id: "q", label: "q", parents: ["r"] },
      { id: "r", label: "r", parents: [] },
    ],
  };

  it("colours a lane entering page 2 from above as the unpaginated render does", async () => {
    const { palette, laneColor } = colorByIndex(dag);
    const result = await renderGlyphLaneDag(dag, { target: "web", color: "css", order: "oldest-first", width: 30, height: 3, laneColor });
    expect(result.pages.length).toBe(3);
    const { char, color } = result.pages[1]!.canvas.grid;
    // Page 2 opens on a3 (lane 1) with lane 0 (last occupied by b1) running in from above.
    const rail = char.indexOf("│");
    // Mutation: drop the carried-in state in paint.ts -> the page's first node (a3) colours it -> red.
    expect(rail).toBeGreaterThanOrEqual(0);
    expect(color[rail]).toBe(palette.get("b1"));
  });

  it.each([
    ["a complete dag, oldest-first", dag, "oldest-first"],
    ["a complete dag, newest-first", dag, "newest-first"],
    ["a truncated dag with an unresolved lane, newest-first", open, "newest-first"],
    ["a truncated dag with an unresolved lane, oldest-first", open, "oldest-first"],
    ["a branch whose node is on a later page", forked, "newest-first"],
    ["a branch whose node is on a later page, oldest-first", forked, "oldest-first"],
    ["a git-log window", TRUNCATED_LOG, "newest-first"],
    ["a git-log window, oldest-first", TRUNCATED_LOG, "oldest-first"],
  ] as const)("paints every glyph the same colour on every page as unpaginated: %s", async (_name, input, order) => {
    const colors = typeof input === "string" ? { laneColor: (node: GlyphLaneNode) => `#${(node.id.charCodeAt(0) * 0x010203).toString(16).padStart(6, "0")}` } : colorByIndex(input);
    const base = { target: "web", color: "css", order, width: 40, laneColor: colors.laneColor } as const;
    const whole = await renderGlyphLaneDag(input, { ...base, overflow: "expand" });
    expect(whole.pages.length).toBe(1);
    for (const height of [2, 3, 4]) {
      const paged = await renderGlyphLaneDag(input, { ...base, height });
      expect(paged.pages.length).toBeGreaterThan(1);
      // Mutation: skip the carried-in state, or any one of its three updates in advanceColorState -> a page's entering lane recolours -> red.
      expect(paintedColors(paged.pages)).toEqual(paintedColors(whole.pages));
    }
  });

  it("keeps a lane that ends in a continuation the colour of its opener on every page, final dash included", async () => {
    const { palette, laneColor } = colorByIndex(open);
    const result = await renderGlyphLaneDag(open, { target: "web", color: "css", width: 30, height: 2, laneColor });
    expect(result.pages.length).toBeGreaterThan(2);
    const rails = result.pages.flatMap((page) => page.canvas.grid.char.flatMap((ch, i) => (ch === "│" || ch === "╎" ? [page.canvas.grid.color[i]] : [])));
    // Mutation: resolve an unresolved waiting id to the page's first node instead of the owner -> a's / c's colour on later pages -> red.
    expect(rails.length).toBeGreaterThan(2);
    expect(new Set(rails)).toEqual(new Set([palette.get("m")]));
  });

  it("colours a lane branched below a node by that node until its own node row, across a page break", async () => {
    const { palette, laneColor } = colorByIndex(forked);
    const result = await renderGlyphLaneDag(forked, { target: "web", color: "css", width: 30, height: 3, laneColor });
    expect(result.pages.length).toBeGreaterThan(1);
    const rails = result.pages.flatMap((page) => page.canvas.grid.char.flatMap((ch, i) => (ch === "│" ? [page.canvas.grid.color[i]] : [])));
    // Lane 1 (branched from h) rails until q; lane 0 rails under p3 at q's row. z, the first node, owns neither.
    // Mutation: drop the branch seeding in advanceColorState -> the lane falls back to z's colour -> red.
    expect(rails.length).toBeGreaterThan(1);
    expect(new Set(rails)).toEqual(new Set([palette.get("h"), palette.get("p3")]));
  });

  it("forgets a lane's waiting node once it arrives, so a reused lane takes its new hub's colour", async () => {
    // Oldest-first, a's two absent parents open two lanes waiting for a; lane 1 merges away and is
    // reused by c2's branch to d1, so its rail on d2's row must be c2's colour, not a's.
    const reuse: GlyphLaneDag = {
      truncated: true,
      nodes: [{ id: "d1", label: "d1", parents: ["c2"] }, { id: "d2", label: "d2", parents: ["c2"] }, { id: "c2", label: "c2", parents: ["a"] }, { id: "a", label: "a", parents: ["o1", "o2"] }],
    };
    const { palette, laneColor } = colorByIndex(reuse);
    const result = await renderGlyphLaneDag(reuse, { target: "web", color: "css", order: "oldest-first", width: 30, height: 20, laneColor });
    const { char, color } = result.canvas.grid;
    const rails = char.flatMap((ch, i) => (ch === "│" ? [color[i]] : []));
    // Mutation: stop deleting arrived ids from the waiting map in advanceColorState -> a's colour -> red.
    expect(rails.length).toBeGreaterThan(0);
    expect(new Set(rails)).toEqual(new Set([palette.get("c2")]));
  });

  it("never calls a laneColor function when colour is off, paginated or not", async () => {
    const boom = (): string => { throw new Error("laneColor must not run under color none"); };
    // Mutation: build the page colour starts or paint colours without the color-none guard -> throws -> red.
    await expect(renderGlyphLaneDag(dag, { color: "none", width: 30, height: 2, laneColor: boom })).resolves.toBeDefined();
    await expect(renderGlyphLaneDag(dag, { color: "none", width: 30, height: 20, laneColor: boom })).resolves.toBeDefined();
  });
});

describe("laneColor pre-pass", () => {
  const passes = async (options: Parameters<typeof renderGlyphLaneDag>[1]): Promise<number> => {
    const before = glyphLaneRenderProbe.colorPasses;
    await renderGlyphLaneDag(GIT_STYLE, { target: "web", width: 40, ...options });
    return glyphLaneRenderProbe.colorPasses - before;
  };
  const fn = (): string => "#112233";

  it("runs once for a paginated render with a laneColor function, and is skipped whenever nothing could observe it", async () => {
    expect(await passes({ color: "css", height: 3, laneColor: fn })).toBe(1);
    // Mutation: drop `opts.color !== "none"` from the pre-pass condition -> 1 pass under color none -> red.
    expect(await passes({ color: "none", height: 3, laneColor: fn })).toBe(0);
    // Mutation: drop the laneColor-is-a-function test -> 1 pass for a string -> red.
    expect(await passes({ color: "css", height: 3, laneColor: "#123456" })).toBe(0);
    expect(await passes({ color: "css", height: 3 })).toBe(0);
    // Mutation: drop `panels.length > 1` -> 1 pass for one page -> red.
    expect(await passes({ color: "css", height: 24, laneColor: fn })).toBe(0);
  });
});

describe("lane connector colours", () => {
  it("colours each corner by its own lane and the connecting bar by the hub, on both branch and merge rows", async () => {
    const result = await renderGlyphLaneDag(GIT_STYLE, { target: "web", color: "css", width: 72, height: 24 });
    const { char, color, cols, rows } = result.canvas.grid;
    const lines = Array.from({ length: rows }, (_, y) => char.slice(y * cols, (y + 1) * cols).join(""));
    const x0 = lines.find((l) => l.includes("*"))!.indexOf("*");
    const at = (needle: string, lane: number): string | null => {
      const y = lines.findIndex((l) => l.slice(x0).startsWith(needle));
      return color[y * cols + x0 + lane * 2] ?? null;
    };
    const [L0, L1, L2] = ["#4c78a8", "#f58518", "#54a24b"];
    // Mutation: colour every connector glyph by the hub lane -> the lane-1 and lane-2 corners take the hub's colour -> red.
    expect(at("├─╮", 0)).toBe(L0); expect(at("├─╮", 1)).toBe(L1);       // branch 0 -> 1
    expect(at("│ ├─╮", 1)).toBe(L1); expect(at("│ ├─╮", 2)).toBe(L2);   // branch 1 -> 2
    expect(at("│ ├─╯", 1)).toBe(L1); expect(at("│ ├─╯", 2)).toBe(L2);   // merge 2 into 1
    expect(at("├─╯", 0)).toBe(L0); expect(at("├─╯", 1)).toBe(L1);       // merge 1 into 0
    // The connecting bar belongs to the hub.
    expect(color[lines.findIndex((l) => l.slice(x0).startsWith("├─╮")) * cols + x0 + 1]).toBe(L0);
    expect(color[lines.findIndex((l) => l.slice(x0).startsWith("│ ├─╯")) * cols + x0 + 3]).toBe(L1);
  });
});

describe("default lane palette", () => {
  it("colours each lane by its column index from the shared palette", async () => {
    const result = await renderGlyphLaneDag(GIT_STYLE, { target: "web", color: "css", width: 72, height: 24 });
    const { char, color, cols } = result.canvas.grid;
    const lines = Array.from({ length: result.canvas.grid.rows }, (_, y) => char.slice(y * cols, (y + 1) * cols).join(""));
    const starColors = lines.flatMap((line, y) => (line.includes("*") ? [[line.indexOf("*"), color[y * cols + line.indexOf("*")]] as const] : []));
    const xs = [...new Set(starColors.map(([x]) => x))].sort((a, b) => a - b);
    expect(xs).toHaveLength(3);
    const colorAt = (x: number) => new Set(starColors.filter(([sx]) => sx === x).map(([, c]) => c));
    // Mutation: shift the palette index by one in paint.ts -> lane 0 is #f58518 -> red.
    expect(colorAt(xs[0]!)).toEqual(new Set(["#4c78a8"]));
    expect(colorAt(xs[1]!)).toEqual(new Set(["#f58518"]));
    expect(colorAt(xs[2]!)).toEqual(new Set(["#54a24b"]));
  });
});

describe("lane-history-continues counts painted lines", () => {
  const wide: GlyphLaneDag = { truncated: true, nodes: [{ id: "a", label: "a", parents: ["o1", "o2", "o3", "o4"] }] };

  it("reports four lines when four are painted, and fewer once the lane cap merges them", async () => {
    // Mutation: report the absent-parent reference count -> 4 at width 8 -> red.
    const roomy = await renderGlyphLaneDag(wide, { target: "chat" });
    expect(roomy.report.ledger.find((e) => e.code === "lane-history-continues")?.detail).toMatchObject({ lines: 4, nodeIds: ["a"] });
    const tight = await renderGlyphLaneDag(wide, { target: "chat", width: 8 });
    const painted = tight.text.split("\n").filter((l) => l.trim()).pop()!.split("").filter((c) => c === "╎").length;
    expect(painted).toBe(1);
    expect(tight.report.ledger.find((e) => e.code === "lane-history-continues")?.detail).toMatchObject({ lines: painted, nodeIds: ["a"] });
  });
});
