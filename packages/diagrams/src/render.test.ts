import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderGlyphDiagram, renderGlyphDiagramJson } from "./render";
import { glyphDiagramRectsOverlap } from "./labels";
import { glyphGraphFromMermaid } from "./mermaid";
import { GLYPH_CANVAS_TIERS, GLYPH_CANVAS_QUADRANT_GLYPHS } from "glyphcss";

const fixture = (name: string) => readFileSync(resolve(__dirname, `../fixtures/${name}.mmd`), "utf8");
// 80x32 exercises the plain-fit path with generous headroom — every one of
// these five fixtures renders with an EMPTY ledger there (no degrade-ladder
// rung ever engages), so this loop is the baseline layout/paint check with
// no compaction/decoration in the picture at all. It stays distinct from
// the loop below.
for (const name of ["chain", "diamond", "fan-out", "cycle", "subgraph"]) for (const charset of ["box", "ascii"] as const) {
  it(`${name} ${charset} matches its checked-in cell snapshot`, async () => {
    const options = { target: "chat" as const, width: 80, height: 32, charset };
    const result = await renderGlyphDiagram(fixture(name), options);
    expect(result.pages).toHaveLength(1); expect(result.report.unroutable).toEqual([]);
    expect(result.routes).toHaveLength(result.meta.edges.length);
    await expect(result.text).toMatchFileSnapshot(resolve(__dirname, `../fixtures/expected/${name}.${charset}.txt`));
    expect((await renderGlyphDiagram(fixture(name), options)).text).toBe(result.text);
    if (charset === "ascii") expect(result.text).toMatch(/^[\x20-\x7e\n]*$/);
  });
}
// REVIEW-diagrams-fanout-opus.md P3-4: no CHECKED-IN snapshot rendered at
// chat's own real default (72x24, `GLYPH_DIAGRAM_TARGET_DEFAULTS.chat`) —
// exactly the size at which the compaction rung engages for `diamond`
// (P1-1's regression) and could engage for any fixture the target defaults
// change under. No `width`/`height` override, so a change to
// `GLYPH_DIAGRAM_TARGET_DEFAULTS.chat` moves this loop with it.
for (const name of ["chain", "diamond", "fan-out", "cycle", "subgraph"]) for (const charset of ["box", "ascii"] as const) {
  it(`${name} ${charset} matches its checked-in cell snapshot at chat's real default size`, async () => {
    const options = { target: "chat" as const, charset };
    const result = await renderGlyphDiagram(fixture(name), options);
    expect(result.pages).toHaveLength(1); expect(result.report.unroutable).toEqual([]);
    expect(result.routes).toHaveLength(result.meta.edges.length);
    // Mutation (P1-1): restore the unconditional decoration rung ->
    // `diamond` loses its two edge labels here and this count changes.
    expect(result.labels.length).toBe(name === "diamond" ? 2 : name === "cycle" || name === "subgraph" ? 1 : 0);
    await expect(result.text).toMatchFileSnapshot(resolve(__dirname, `../fixtures/expected/${name}.${charset}.chat72x24.txt`));
    if (charset === "ascii") expect(result.text).toMatch(/^[\x20-\x7e\n]*$/);
  });
}

describe("render contracts", () => {
  it("final-gate-2 codex #8 / Opus P3: a bare renderGlyphDiagram call defaults to target web (96x32 braille/css, HTML present), mirroring renderGlyphChart", async () => {
    // Mutation: restore `options.target ?? "chat"` in `resolvedOptions` ->
    // a bare call returns 72x24 with no `html` -> red.
    const result = await renderGlyphDiagram("graph LR; A --> B");
    expect(result.canvas.grid.cols).toBe(96);
    expect(result.canvas.grid.rows).toBe(32);
    expect(result.html).toBeDefined();
    const json = JSON.parse(await renderGlyphDiagramJson(JSON.stringify({ nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }] })));
    expect(json.html).toBeDefined();
  });
  it("uses vertical glyphs on single-cell box sides", async () => {
    const result = await renderGlyphDiagram("graph LR; A[Alpha] --> B[[Beta]]", { charset: "ascii" });
    for (const n of result.layout.nodes) {
      const target = result.layout.ports.some((p) => p.end === "to" && p.anchor.x === n.x0 && p.anchor.y === n.y0 + 1);
      expect(result.canvas.grid.char[(n.y0 + 1) * result.canvas.grid.cols + n.x0]).toBe(target ? ">" : "|");
      expect(result.canvas.grid.char[(n.y0 + 1) * result.canvas.grid.cols + n.x1]).toBe("|");
    }
  });
  it("renders the LangGraph agent fixture in one chat 60x20 panel", async () => {
    const result = await renderGlyphDiagram(fixture("langgraph"), { target: "chat", width: 60, height: 20 });
    expect(result.pages).toHaveLength(1); expect(result.routes).toHaveLength(4);
    expect(result.report.unroutable).toEqual([]);
    expect(result.text.split("\n")).toHaveLength(20);
    expect(result.text.split("\n").every((line) => line.length === 60)).toBe(true);
    expect(result.text).toContain("__start__"); expect(result.text).toContain("__end__");
    await expect(result.text).toMatchFileSnapshot(resolve(__dirname, "../fixtures/expected/langgraph.chat60x20.txt"));
  });
  it("all fixtures remain 7-bit under the ASCII policy, including non-ASCII authored text", async () => {
    for (const name of ["chain", "diamond", "fan-out", "cycle", "subgraph", "langgraph", "six-port"]) {
      const result = await renderGlyphDiagram(fixture(name), { charset: "ascii", width: 120, height: 50 });
      expect(result.text).toMatch(/^[\x20-\x7e\n]*$/);
    }
    const result = await renderGlyphDiagram('graph LR; A["café 漢字"] -->|"−…"| B["< & >"]', { charset: "ascii" });
    expect(result.text).toMatch(/^[\x20-\x7e\n]*$/); expect(result.report.ledger.some((entry) => entry.code === "label-folded")).toBe(true);
  });
  // Mutation: resolve junctions after arrowheads -> every destination loses its tip.
  it.each(["TB", "BT", "LR", "RL"] as const)("paints %s arrowheads on the target border after junction resolution and node fills", async (direction) => {
    const result = await renderGlyphDiagram(`graph ${direction}; A --> B`, { width: 60, height: 20, charset: "ascii" });
    expect(result.routes).toHaveLength(1);
    const last = result.layout.ports.find((p) => p.end === "to")!.anchor;
    const side = { TB: "s", BT: "n", LR: "e", RL: "w" }[direction] as "n" | "e" | "s" | "w";
    expect(result.canvas.grid.char[last.y * result.canvas.grid.cols + last.x]).toBe(GLYPH_CANVAS_TIERS.ascii.arrow[side]);
  });
  // Mutation: pass no obstacles into paint's label layout or paint node fills after labels -> red.
  it("real edge labels stay disjoint from painted nodes, routes and each other", async () => {
    for (const input of [fixture("diamond"), "graph TB; A -->|a label| B"]) {
      const result = await renderGlyphDiagram(input, { width: 80, height: 32 });
      expect(result.labels.some((label) => label.id.startsWith("edge:"))).toBe(true);
      const obstacles = [...result.layout.nodes, ...result.routes.flatMap((r) => r.cells.map((p) => ({ x0: p.x, y0: p.y, x1: p.x, y1: p.y })))];
      result.labels.forEach((label, i) => {
        [...obstacles, ...result.labels.slice(0, i)].forEach((rect) => expect(glyphDiagramRectsOverlap(label, rect)).toBe(false));
        expect(result.canvas.grid.char.slice(label.y * result.canvas.grid.cols + label.x, label.y * result.canvas.grid.cols + label.x + label.text.length).join("")).toBe(label.text);
      });
    }
  });
  it("uses fresh canvas storage for every render and retains prior results", async () => {
    const a = await renderGlyphDiagram(fixture("cycle"), { width: 80, height: 32 });
    const before = a.canvas.grid.char.join("");
    const b = await renderGlyphDiagram("graph LR; X", { width: 80, height: 32 });
    expect(b.canvas.grid).not.toBe(a.canvas.grid); expect(a.canvas.grid.char.join("")).toBe(before);
    expect(b.text).not.toContain("▼"); expect(b.text).toContain("X");
  });
  it("has separate raw, escaped HTML and explicit-environment ANSI exits", async () => {
    const input = 'graph LR; A["<tag> & text"]';
    const raw = await renderGlyphDiagram(input, { color: "none" });
    const html = await renderGlyphDiagram(input, { color: "css" });
    expect(raw.text).toContain("<tag> & text"); expect(html.text).toBe(raw.text);
    expect(html.html).toContain("&lt;tag&gt;"); expect(html.html).toContain("&amp;"); expect(html.html).not.toContain("<tag>");
    const ansi = await renderGlyphDiagram(input, { target: "terminal", color: "ansi16" });
    expect(ansi.text).toContain("\x1b[");
    expect((await renderGlyphDiagram(input, { target: "terminal", env: { NO_COLOR: "0" } })).text).not.toContain("\x1b[");
    expect((await renderGlyphDiagram(input, { target: "terminal", env: { NO_COLOR: "1", FORCE_COLOR: "0" } })).text).toContain("\x1b[");
  });
  it("reports only final unroutable edges after successful split recovery", async () => {
    const graph = glyphGraphFromMermaid("graph TB; A --> B --> C --> D --> E");
    const result = await renderGlyphDiagram(graph, { width: 60, height: 20, detail: "faithful" });
    expect(result.pages.length).toBeGreaterThan(1);
    expect(result.pages.flatMap((p) => p.routes)).toHaveLength(4);
    expect(result.report.unroutable).toEqual([]);
    expect(result.report.ledger.some((entry) => entry.code === "unroutable")).toBe(false);
  });
  it("places interleaved compound groups without enclosing an unrelated node", async () => {
    const graph = glyphGraphFromMermaid("graph LR; subgraph G1[Group 1]; A; C; end; subgraph G2[Group 2]; B; D; end; A --> B; C --> D");
    const result = await renderGlyphDiagram(graph, { width: 120, height: 60 });
    expect(result.pages).toHaveLength(1);
    for (const group of result.layout.groups) {
      const members = result.layout.nodes.filter((node) => group.members.includes(node.id));
      const bounds = { x0: Math.min(...members.map((n) => n.x0)) - 2, x1: Math.max(...members.map((n) => n.x1)) + 2, y0: Math.min(...members.map((n) => n.y0)) - 2, y1: Math.max(...members.map((n) => n.y1)) + 2 };
      const nonmembers = result.layout.nodes.filter((node) => !group.members.includes(node.id));
      // Mutation: drop the unsafe-enclosure guard in paint.ts -> a compact
      // compound layout could still draw a group box around an unrelated node.
      // Unconditional (not gated on `.some`), so this always actually runs.
      expect(nonmembers.every((node) => !glyphDiagramRectsOverlap(node, bounds))).toBe(true);
    }
  });
  it("falls back to an explicit member list, never a false enclosure, when group membership genuinely overlaps", async () => {
    const graph = {
      nodes: [{ id: "A", label: "A" }, { id: "B", label: "B" }, { id: "C", label: "C" }],
      edges: [{ from: "A", to: "B" }, { from: "B", to: "C" }],
      groups: [{ id: "G1", members: ["A", "B"] }, { id: "G2", members: ["B", "C"] }],
      direction: "TB" as const,
    };
    const result = await renderGlyphDiagram(graph, { width: 60, height: 30 });
    expect(result.pages).toHaveLength(1);
    // Mutation: only run this check for geometric overlap, ignoring partial
    // group-membership overlap -> the ledger message never fires and this fails.
    expect(result.report.ledger).toContainEqual(expect.objectContaining({ code: "group-member-list", detail: expect.objectContaining({ groupId: "G1", reason: "unrelated-nodes" }) }));
    expect(result.report.ledger).toContainEqual(expect.objectContaining({ code: "group-member-list", detail: expect.objectContaining({ groupId: "G2", reason: "unrelated-nodes" }) }));
  });
  // Mutation: drop `subcell: false` from the box top/bottom `canvas.line`
  // calls in paint.ts -> the border falls back to the tier's own subcell
  // default and paints a dotted/quadrant edge instead of a flat rule.
  it.each(["braille", "blocks"] as const)("keeps diagram box borders whole-cell under %s, with no sub-cell glyph anywhere in the render", async (charset) => {
    const result = await renderGlyphDiagram("graph LR; A[Alpha] --> B[Beta]", { charset, width: 36, height: 9 });
    // U+2800 is braille's own BLANK pattern (its whole-cell space glyph, used
    // for ordinary label padding) -- everything past it is an actual dot
    // pattern, which a whole-cell border must never contain.
    expect(result.text).not.toMatch(/[⠁-⣿]/);
    for (const glyph of GLYPH_CANVAS_QUADRANT_GLYPHS) if (glyph !== " " && glyph !== "█") expect(result.text.includes(glyph)).toBe(false);
  });
  it("returns repairable JSON errors and validates render bounds", async () => {
    // Mutation: parse malformed JSON with a bare JSON.parse instead of the
    // tagged parseGlyphDiagramJson -> code regresses to null.
    expect(JSON.parse(await renderGlyphDiagramJson("{"))).toMatchObject({ code: "GLYPH_DIAGRAM_BAD_JSON" });
    expect(JSON.parse(await renderGlyphDiagramJson('{"nodes":[],"edges":[]}'))).toMatchObject({ code: "empty-nodes" });
    await expect(renderGlyphDiagram("graph LR; A", { width: 20.5 })).rejects.toMatchObject({ code: "bad-size" });
    await expect(renderGlyphDiagram("graph LR; A", { ranksep: 0 })).rejects.toMatchObject({ code: "bad-options" });
  });

  describe("no-leak guarantee: the exact key set, never canvas/grid/layout/routes/labels/pages", () => {
    // P2-b (codex gpt-5.6-sol review, F1 fix round 1) — mirrors
    // json.test.ts's own guarantee for `@glyphcss/charts`: `renderGlyphDiagramJson`
    // builds its own explicit `{ text, html?, meta, report }` object rather
    // than spreading `renderGlyphDiagram`'s result, so `canvas` (a live
    // `GlyphCanvas`, never JSON-representable) and the page fields
    // (`layout`/`routes`/`labels`/`pages`) must never leak through. Asserting
    // the exact key set is what a leak actually reddens.
    const graph = JSON.stringify({ nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: [{ from: "a", to: "b" }] });
    it("no html (color: none): exactly { text, meta, report }", async () => {
      const out = JSON.parse(await renderGlyphDiagramJson(graph, { target: "chat", color: "none" }));
      expect(Object.keys(out).sort()).toEqual(["meta", "report", "text"]);
    });
    it("with html (color: css): exactly { text, html, meta, report }", async () => {
      const out = JSON.parse(await renderGlyphDiagramJson(graph, { target: "web", color: "css" }));
      expect(Object.keys(out).sort()).toEqual(["html", "meta", "report", "text"]);
    });
  });
});

// DIAGNOSIS-diagrams-fanout.md: no fixture had two LR siblings in one rank,
// every fixture render overrode chat's real 72x24 default to 80x32, and none
// had 4 ranks -- the exact gaps that let RC1/RC2/RC3/RC4 ship unnoticed.
describe("RC1-RC4: LR fan-out/fan-in at the real chat size", () => {
  for (const name of ["fan-out-lr", "fan-2"]) {
    it(`${name} renders in one panel at chat's real default 72x24 and at 96x32, every edge routed`, async () => {
      const graph = fixture(name);
      for (const options of [{ target: "chat" as const }, { width: 96, height: 32 }]) {
        const result = await renderGlyphDiagram(graph, options);
        // Mutation: drop `edgesep: 1` from pipeline.ts's `setGraph` call ->
        // dagre's own default (20) spaces LR siblings ~15x too far apart and
        // this splits into 7 panels at both sizes.
        expect(result.pages).toHaveLength(1);
        expect(result.report.unroutable).toEqual([]);
        expect(result.routes).toHaveLength(result.meta.edges.length);
        expect(result.report.ledger.some((entry) => entry.code === "routing-attempt")).toBe(false);
        expect(result.layout.width).toBeLessThanOrEqual(result.canvas.grid.cols);
        expect(result.layout.height).toBeLessThanOrEqual(result.canvas.grid.rows);
      }
    });
  }

  it("a 4-rank TB graph renders in one panel at chat's 72x24 via compaction, with a budget-compaction ledger entry", async () => {
    // The same fan-out/fan-in graph, read as TB: O; {T,S,D}; M; R is 4 ranks,
    // whose default-spacing height (4*3 + 3*4 + 2*margin = 26) overflows
    // chat's 24 rows by exactly the 2 rows `margin: 0` recovers (RC2).
    const result = await renderGlyphDiagram(fixture("fan-out-lr"), { target: "chat", direction: "TB" });
    expect(result.pages).toHaveLength(1);
    expect(result.report.unroutable).toEqual([]);
    expect(result.routes).toHaveLength(result.meta.edges.length);
    expect(result.report.ledger.some((entry) => entry.code === "budget-compaction")).toBe(true);
    // Mutation: remove the compaction rung -> this falls through straight to
    // `split` (no rung can shrink a fan's HEIGHT except leaf-clusters, which
    // deletes the fan) and renders as 7 panels instead of 1.
    expect(result.report.ledger.some((entry) => entry.code === "routing-attempt")).toBe(false);
    // P2-3: a diagram compaction rescues must never still report
    // `layout-overflow` (the honest pre-compaction report retracted once
    // compaction makes it fit). Mutation: push `overflowOrRoutingAttempt`
    // BEFORE the compaction rung -> this goes red.
    expect(result.report.ledger.some((entry) => entry.code === "layout-overflow")).toBe(false);
  });

  it("reports a size overflow as layout-overflow, never a misreported routing-attempt, even when it still reaches split", async () => {
    const result = await renderGlyphDiagram(fixture("fan-out-lr"), { width: 10, height: 6 });
    expect(result.pages.length).toBeGreaterThan(1);
    expect(result.report.ledger.some((entry) => entry.code === "layout-overflow")).toBe(true);
    expect(result.report.ledger.some((entry) => entry.code === "budget-split")).toBe(true);
    // Mutation: revert `overflowOrRoutingAttempt` to always log
    // `routing-attempt` off out-of-bounds ports -> this goes red, since every
    // one of these entries came from a layout too large for the viewport,
    // never from an A* failure inside a layout that fit.
    expect(result.report.ledger.some((entry) => entry.code === "routing-attempt")).toBe(false);
    const overflow = result.report.ledger.find((entry) => entry.code === "layout-overflow")!;
    // P3-3: `layout-overflow`'s own laid-out size and `split-panel-dropped`'s
    // requested size used to share the bare `width`/`height` keys for two
    // different meanings. Both entries now use `requestedWidth`/
    // `requestedHeight` for the SAME concept (the size actually asked for),
    // and `layout-overflow` names its own addition `layoutWidth`/
    // `layoutHeight` instead of the collision-prone bare pair.
    expect(overflow.detail).toMatchObject({ requestedWidth: 10, requestedHeight: 6 });
    expect(overflow.detail).toHaveProperty("layoutWidth");
    expect(overflow.detail).toHaveProperty("layoutHeight");
    expect(overflow.detail).not.toHaveProperty("width");
    expect(overflow.detail).not.toHaveProperty("height");
    const dropped = result.report.ledger.find((entry) => entry.code === "split-panel-dropped")!;
    expect(dropped.detail).toMatchObject({ requestedWidth: 10, requestedHeight: 6 });
    expect(dropped.detail).not.toHaveProperty("width");
    expect(dropped.detail).not.toHaveProperty("height");
  });
});

// REVIEW-diagrams-fanout-opus.md: the compaction rung's own rescue was
// immediately undone by an unconditional decoration rung (P1-1), its
// spacing floor was a degree-3 measurement generalized to a universal
// constant that is unreachable at the library's own defaults (P2-1/P2-2),
// and its pre-compaction `layout-overflow` entry was never retracted when
// compaction went on to succeed (P2-3, gated above in "RC1-RC4").
describe("P1-1/P2-1/P2-2: compaction keeps content, and its floor scales with the graph", () => {
  it("P1-1: a compaction rescue keeps every label — diamond at chat's real 72x24 renders identically to faithful (2 labels, no budget-decoration)", async () => {
    const auto = await renderGlyphDiagram(fixture("diamond"), { target: "chat" });
    const faithful = await renderGlyphDiagram(fixture("diamond"), { target: "chat", detail: "faithful" });
    expect(auto.pages).toHaveLength(1);
    expect(auto.report.ledger.some((entry) => entry.code === "budget-compaction")).toBe(true);
    // Mutation: restore the unconditional decoration rung (run it whenever
    // `opts.detail !== "faithful"`, regardless of `current.okay`) -> both
    // labels ("yes"/"no") are dropped and this count goes to 0.
    expect(auto.report.ledger.every((entry) => entry.code !== "budget-decoration")).toBe(true);
    expect(auto.labels).toHaveLength(2);
    expect(auto.labels).toHaveLength(faithful.labels.length);
  });

  it("P1-1: `simplified` still drops decoration even once compaction alone would have fit", async () => {
    const result = await renderGlyphDiagram(fixture("diamond"), { target: "chat", detail: "simplified" });
    expect(result.pages).toHaveLength(1);
    // Mutation: gate decoration on `!current.okay` alone (drop the
    // `opts.detail === "simplified"` disjunct) -> a diagram compaction
    // alone already rescues keeps its labels under `simplified` too,
    // breaking the mode's own contract.
    expect(result.report.ledger.some((entry) => entry.code === "budget-decoration")).toBe(true);
    expect(result.labels).toHaveLength(0);
  });

  it("P2-1/P2-2: a degree-4 fan at 44x20 with nodesep/ranksep 6 reaches the intermediate sep-5 candidate the old constant-jump list skipped, one panel, all 8 edges routed", async () => {
    // REVIEW-diagrams-fanout-opus.md P2-1: `O -> {4 kids} -> M`, the exact
    // construction the review measured. The old floor (a flat 4) jumped
    // straight past the one spacing that actually works (5) to one that
    // routes 0 of 8; this graph's own floor is now derived as
    // `glyphDiagramCompactionFloor` = maxDegree(4) + 1 = 5, so the
    // step-down search's LAST candidate is exactly the one that fits and
    // routes.
    const nodes = [{ id: "O", label: "O" }, ...Array.from({ length: 4 }, (_, i) => ({ id: `K${i}`, label: `K${i}` })), { id: "M", label: "M" }];
    const edges = [...Array.from({ length: 4 }, (_, i) => ({ from: "O", to: `K${i}` })), ...Array.from({ length: 4 }, (_, i) => ({ from: `K${i}`, to: "M" }))];
    const graph = { direction: "TB" as const, nodes, edges };
    const result = await renderGlyphDiagram(graph, { width: 44, height: 20, nodesep: 6, ranksep: 6, detail: "faithful" });
    // Mutation: revert to the old constant `GLYPH_DIAGRAM_COMPACT_SPACING_FLOOR
    // = 4` with no step-down search -> the single candidate at sep 4 routes
    // 0/8 and this falls through to split (8 panels).
    expect(result.pages).toHaveLength(1);
    expect(result.report.unroutable).toEqual([]);
    expect(result.routes).toHaveLength(8);
    expect(result.report.ledger.some((entry) => entry.code === "budget-compaction")).toBe(true);
  });

  it("P2-2: the floor is reachable at the library's own default spacing (4/4), rescuing subgraph.mmd read as TB at chat's real 72x24", async () => {
    // REVIEW-diagrams-fanout-opus.md P2-2: at the default nodesep/ranksep
    // (4), the old `> GLYPH_DIAGRAM_COMPACT_SPACING_FLOOR` guard was `4 > 4`
    // = false, so the second compaction candidate never ran for ANY default
    // render — this fixture split into 3 panels (1 of 3 edges) instead of
    // rendering whole. Its own floor here is 3 (max degree 1, clamped to
    // the validated minimum), one below the default, so the step-down
    // search must reach it.
    const result = await renderGlyphDiagram(fixture("subgraph"), { target: "chat", direction: "TB" });
    // Mutation: keep the `nodesep > FLOOR || ranksep > FLOOR` guard around
    // the step-down loop -> `4 > 4` is false, no candidate below margin-0
    // is ever tried, and this renders as 3 panels with 1 of 3 edges routed.
    expect(result.pages).toHaveLength(1);
    expect(result.report.unroutable).toEqual([]);
    expect(result.routes).toHaveLength(3);
    expect(result.report.ledger.some((entry) => entry.code === "budget-compaction")).toBe(true);
  });
});
