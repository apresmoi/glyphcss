import { describe, expect, it } from "vitest";
import { glyphGraphFromMermaid, glyphParseMermaid } from "./mermaid";
import { renderGlyphDiagram } from "./render";
import { computeGlyphDiagramQuality } from "./quality";
import { layoutGlyphGraph } from "./pipeline";
import { glyphDiagramRepairHint } from "./validate";

const git = (body: string, header = "gitGraph TB:") => glyphParseMermaid(`${header}\n${body}`);
const mind = (body: string) => glyphGraphFromMermaid(`mindmap\n${body}`);

describe("Mermaid gitGraph", () => {
  it("dispatches and preserves every commit attribute, branch heads and merge ancestry", () => {
    const p = git('commit id:"a" tag:"v0"; branch "feature one" order:2; commit id:"b" type:REVERSE; switch main; commit id:"c" type:HIGHLIGHT; merge "feature one" id:"m" type:NORMAL tag:"v1"');
    expect(p.lanes!.dag.nodes).toEqual([
      { id: "m", label: "", parents: ["c", "b"], marks: ["main", "tag: v1"] },
      { id: "c", label: "", parents: ["a"], marks: ["HIGHLIGHT"] },
      { id: "b", label: "", parents: ["a"], marks: ["feature one", "REVERSE"] },
      { id: "a", label: "", parents: [], marks: ["tag: v0"] },
    ]);
    expect(p.notes.map(n => n.detail?.kind)).toEqual(expect.arrayContaining(["git-types", "git-merge"]));
  });
  it("handles checkout, default merge marks, generated ids and cherry-picks without false ancestry", () => {
    const p = git('commit id:"a"; branch dev; commit id:"b"; checkout main; commit; merge dev id:"m"; branch hotfix; commit id:"h"; checkout main; cherry-pick id:"h"; branch backport; commit; cherry-pick id:"m" parent:"b"');
    const nodes = p.lanes!.dag.nodes;
    expect(new Set(nodes.map(n => n.id)).size).toBe(8);
    expect(nodes[0]!.parents).toEqual([nodes[1]!.id]);
    expect(nodes[0]!.marks).toContain("cherry-pick: m parent: b");
    expect(nodes[2]!.marks).toContain("cherry-pick: h");
    expect(nodes.find(n => n.id === "m")!.marks).toContain("merge");
  });
  it.each(["LR", "TB", "BT"])("accepts %s and maps reading order without widening lanes", async direction => {
    const p = git('commit id:"first"; commit id:"last"', `gitGraph ${direction}:`);
    expect(p.lanes!.order).toBe(direction === "BT" ? "newest-first" : "oldest-first");
    const r = await renderGlyphDiagram(`gitGraph ${direction}:\ncommit id:"first"\ncommit id:"last"`, { target: "chat", width: 72 });
    expect(r.text.indexOf("first") < r.text.indexOf("last")).toBe(direction !== "BT");
    expect(r.text).toContain("*");
    expect(r.layout.nodes).toEqual([]);
    expect(r.meta.edges).toEqual([{ from: "first", to: "last" }]);
  });
  it("reads scalar init options as data and keeps callbacks/themes inert", async () => {
    const source = `%%{init: {'gitGraph': {'mainBranchName': 'trunk', 'mainBranchOrder': 2, 'showBranches': false, 'showCommitLabel': false, 'parallelCommits': true, 'rotateCommitLabel': false}, 'theme': 'forest'}}%%
    gitGraph
    commit id:"seed" tag:"v0"
    branch dev order:1
    commit id:"work"
    checkout trunk
    merge dev id:"release"`;
    const r = await renderGlyphDiagram(source, { target: "web", width: 72 });
    expect(r.text).toContain("tag: v0"); expect(r.text).not.toContain("seed"); expect(r.text).not.toContain("trunk"); expect(r.text).not.toContain("dev");
    expect(r.html).toContain("<span style=");
    expect(r.report.ledger.map(n => n.detail?.kind)).toEqual(expect.arrayContaining(["git-config", "git-hidden-branches", "git-orientation"]));
  });
  it.each(["chat", "web"] as const)("keeps branch identity and Mermaid ordering in %s lanes", async target => {
    const cases = [
      { config: "", branches: "branch dev; commit id:feature; checkout main; commit id:prepare; merge dev id:finish", expected: [["start", "prepare", "finish"], ["feature"]] },
      { config: "mainBranchName: trunk", branches: "branch dev; commit id:feature; checkout trunk; commit id:prepare; merge dev id:finish", expected: [["start", "prepare", "finish"], ["feature"]] },
      // Unordered branches precede explicitly ordered branches, even when declared later.
      { config: "", branches: "branch late order:3; commit id:late; checkout main; branch early order:1; commit id:early; checkout main; branch free; commit id:free; checkout main; commit id:finish", expected: [["start", "finish"], ["free"], ["early"], ["late"]] },
      { config: "mainBranchName: trunk\n    mainBranchOrder: 2", branches: "branch late order:3; commit id:late; checkout trunk; branch early order:1; commit id:early; checkout trunk; branch free; commit id:free; checkout trunk; commit id:finish", expected: [["free"], ["early"], ["start", "finish"], ["late"]] },
    ];
    for (const { config, branches, expected } of cases) for (const direction of ["LR", "TB", "BT"]) {
      const source = `${config ? `---\nconfig:\n  gitGraph:\n    ${config}\n---\n` : ""}gitGraph ${direction}:\ncommit id:start; ${branches}`;
      const result = await renderGlyphDiagram(source, { target, width: 72 });
      const column = (id: string) => {
        const row = result.text.split("\n").find(row => row.includes(` ${id} `));
        expect(row, `${direction}/${id}\n${result.text}`).toBeDefined();
        return row!.indexOf("*");
      };
      const columns = expected.map(ids => {
        const positions = ids.map(column);
        expect(new Set(positions).size, `${direction}/${ids}`).toBe(1);
        return positions[0]!;
      });
      expect(columns).toEqual([...columns].sort((a, b) => a - b));
      expect(new Set(columns).size).toBe(expected.length);
      expect(columns.map(x => x - columns[0]!)).toEqual(expected.map((_, i) => 2 * i));
      expect(result.report.ledger.some(n => n.detail?.kind === "git-order")).toBe(false);
    }
  });
  it.each(["chat", "web"] as const)("starts a new branch column without a phantom incoming stem in %s", async target => {
    const result = await renderGlyphDiagram('gitGraph TB:\ncommit id:seed; branch dev; commit id:feature', { target, width: 72 });
    const rows = result.text.split("\n"), index = rows.findIndex(row => row.includes("feature"));
    const column = rows[index]!.indexOf("*");
    expect(column).toBe(rows.find(row => row.includes("seed"))!.indexOf("*") + 2);
    const connector = rows.slice(0, index).map(row => row[column]).lastIndexOf("╮");
    expect(connector).toBeGreaterThanOrEqual(0);
    expect(rows.slice(connector + 1, index).every(row => row[column] === "│")).toBe(true);
    expect(rows.slice(0, connector).every(row => row[column] === " ")).toBe(true);
  });
  it.each(["trunk # comment", '"trunk" # comment', "'trunk' # comment"])("strips YAML scalar comments from %s", async name => {
    const source = `---\nconfig:\n  gitGraph:\n    mainBranchName: ${name}\n    showBranches: true # names remain\n    showCommitLabel: false # ids hidden\n---\ngitGraph TB:\ncommit id:seed; branch dev; commit id:work; checkout trunk; merge dev id:done`;
    const result = await renderGlyphDiagram(source, { target: "chat", width: 72 });
    expect(result.text).toContain("trunk");
    expect(result.text).not.toContain("comment");
    for (const id of ["seed", "work", "done"]) expect(result.text).not.toContain(id);
    const hash = glyphParseMermaid('---\nconfig:\n  gitGraph:\n    mainBranchName: "trunk # literal" # comment\n---\ngitGraph\ncommit; branch dev; commit; checkout "trunk # literal"; merge dev');
    expect(hash.lanes!.dag.nodes[0]!.marks).toContain("trunk # literal");
  });
  it("reserves later explicit ids before generating ids", () => {
    const first = git("commit").lanes!.dag.nodes[0]!.id;
    const second = git("commit; commit").lanes!.dag.nodes[0]!.id;
    expect(first).toMatch(/^[0-9a-f]{7}$/);
    expect(second).not.toBe(first);
    expect(git(`commit; commit id:"${first}"`).lanes!.dag.nodes.map(n => n.id)).toEqual([first, second]);
  });
  it("reads YAML mainBranchName and visibility before frontmatter is discarded", () => {
    const p = glyphParseMermaid('---\nconfig:\n  gitGraph:\n    mainBranchName: trunk\n    showCommitLabel: false\n---\ngitGraph\ncommit id:"a"\nbranch dev\ncommit\ncheckout trunk\nmerge dev');
    expect(p.lanes!.ids).toBe(false); expect(p.lanes!.dag.nodes[0]!.marks).toContain("trunk");
  });
  it("preserves quoted punctuation, comments and collision-free generated ids", () => {
    const p = git('commit id:"commit-1" tag:"v; %% a" %% comment\ncommit\nbranch "merge"\ncommit id:"third"');
    const generated = git("commit").lanes!.dag.nodes[0]!.id;
    expect(p.lanes!.dag.nodes.map(n => n.id)).toEqual(["third", generated, "commit-1"]);
    expect(p.lanes!.dag.nodes[2]!.marks).toContain("tag: v; %% a");
  });
  it("accepts Mermaid's repeated commit ids as distinct annotated history nodes", () => {
    const p = git('commit id:"x"; commit id:"x"');
    const [later, first] = p.lanes!.dag.nodes;
    expect(p.lanes!.dag.nodes).toHaveLength(2);
    expect(later!.id).not.toBe("x");
    expect(first!.id).toBe("x");
    expect(later!.parents).toEqual(["x"]);
    expect(later!.marks).toContain("id: x");
    expect(p.notes.some(n => n.detail?.kind === "git-duplicate-id")).toBe(true);
  });
  it.each(['checkout missing', 'commit; merge main', 'commit; cherry-pick id:"missing"', 'commit type:BAD', 'commit; branch dev; commit id:"b"; checkout main; commit; merge dev id:"m"; branch fix; commit; cherry-pick id:"m"'])('tags invalid input: %s', body => {
    expect(() => git(body)).toThrow(expect.objectContaining({ code: "GLYPH_MERMAID_GIT_SYNTAX" }));
  });
});

describe("Mermaid mindmap", () => {
  it("uses indentation, including an unclear dedent, with undirected tree edges", () => {
    const g = mind('  Root\n    A\n        B\n      C\n    D');
    expect(g.direction).toBe("LR");
    expect(g.nodes.map(n => n.label)).toEqual(["Root", "A", "B", "C", "D"]);
    expect(g.edges.map(e => [e.from, e.to, e.endHead])).toEqual([["mindmap:0", "mindmap:1", "none"], ["mindmap:1", "mindmap:2", "none"], ["mindmap:1", "mindmap:3", "none"], ["mindmap:0", "mindmap:4", "none"]]);
  });
  it.each([['[Square]', 'rect'], ['(Rounded)', 'rounded'], ['((Circle))', 'circle'], ['))Bang((', 'rounded'], [')Cloud(', 'rounded'], ['{{Hexagon}}', 'rect']])("maps %s into an approved family", (shape, family) => {
    expect(mind(`root${shape}`).nodes[0]!.shape).toBe(family);
  });
  it("keeps repeated text nodes distinct and uses shape contents as labels", () => {
    const g = mind('  root[Root]\n    same\n    same\n    x((Other))');
    expect(g.nodes.map(n => n.label)).toEqual(["Root", "same", "same", "Other"]);
    expect(new Set(g.nodes.map(n => n.id)).size).toBe(4);
  });
  it("keeps inline and standalone icons/classes inert, without changing tree parents", () => {
    const p = glyphParseMermaid('mindmap\n  root((Plan))::icon(fa fa-home):::large urgent\n    A\n      ::icon(mdi mdi-book)\n      :::urgent large\n      B\n    c))Bang((::icon(fa fa-bolt)');
    expect(p.graph.nodes.map(n => n.label)).toEqual(["Plan", "A", "B", "Bang"]);
    expect(p.graph.edges[1]!.from).toBe("mindmap:1");
    expect(p.notes.map(n => n.detail?.kind)).toContain("mindmap-assets");
  });
  it("decodes markdown, multiline strings, entities and literal suffix text", () => {
    const g = mind('  root["`**Bold** and *soft*\nnext &amp; last`"]\n    "literal :::class ::icon(home)"\n    Reader\'s notes');
    expect(g.nodes.map(n => n.label)).toEqual(["Bold and soft\nnext & last", "literal :::class ::icon(home)", "Reader's notes"]);
  });
  it("treats apostrophes as ordinary mindmap text and still splits sibling lines", async () => {
    const source = "mindmap\n  Root\n    'Tis a plan %% comment\n    We 'ship' soon\n    Reader's notes";
    expect(glyphGraphFromMermaid(source).nodes.map(n => n.label)).toEqual(["Root", "'Tis a plan", "We 'ship' soon", "Reader's notes"]);
    for (const target of ["chat", "web"] as const) {
      const result = await renderGlyphDiagram(source, { target, width: 72 });
      for (const label of ["'Tis a plan", "We 'ship' soon", "Reader's notes"]) expect(result.text).toContain(label);
    }
  });
  it.each(["LR", "RL"] as const)("orders unequal tree children top to bottom in the general %s layout", async direction => {
    const graph = { ...mind('  Root\n    a[Build]\n      Tests\n    b(Ship)\n      Review\n      Evidence'), direction };
    const layout = await layoutGlyphGraph(graph);
    const row = (id: string) => layout.nodes.find(n => n.id === id)!.y0;
    expect(row("mindmap:1")).toBeLessThan(row("mindmap:3"));
    expect(row("mindmap:4")).toBeLessThan(row("mindmap:5"));
    const result = await renderGlyphDiagram(graph, { target: "chat", width: 72 });
    expect(computeGlyphDiagramQuality(result, { width: 72, height: 24 })).toMatchObject({ crossings: 0, droppedEdges: 0 });
  });
  it("keeps semicolons and shape-looking suffixes in quoted labels", () => {
    expect(mind('Root; planning\n  child["literal )) text :::class"]').nodes.map(n => n.label)).toEqual(["Root; planning", "literal )) text :::class"]);
  });
  it("logs shape/layout/markdown/config approximations", () => {
    const p = glyphParseMermaid('---\nconfig:\n  layout: tidy-tree\n---\nmindmap\n  root(("`**Plan**`"))\n    x))Bang((\n    y)Cloud(\n    z{{Hex}}');
    expect(p.notes.map(n => n.detail?.kind)).toEqual(expect.arrayContaining(["mindmap-config", "mindmap-bang", "mindmap-cloud", "mindmap-hexagon", "markdown", "mindmap-layout"]));
  });
  it.each(['Root\nOther', 'root[open', ''])('tags invalid structure: %s', source => {
    expect(() => mind(source)).toThrow(expect.objectContaining({ code: "GLYPH_MERMAID_MINDMAP_SYNTAX" }));
  });
  it.each(["chat", "web"] as const)("renders a connected, uncut tree at 72 columns for %s", async target => {
    const r = await renderGlyphDiagram('mindmap\n  root((Plan))\n    a[Build]\n      Tests\n    b(Ship)\n      Review', { target, width: 72 });
    for (const label of ["Plan", "Build", "Tests", "Ship", "Review"]) expect(r.text).toContain(label);
    expect(r.report.unroutable).toEqual([]); expect(r.pages).toHaveLength(1);
    expect(r.report.ledger.map(n => n.code)).not.toContain("word-cut");
    expect(r.text).not.toMatch(/[▶▼▲◀]/);
    if (target === "web") expect(r.html).toContain("<span style=");
  });
});
it("keeps unrelated headers' named unsupported errors and supplies new repair hints", () => {
  expect(() => glyphGraphFromMermaid("packet-beta\n0-3: Header")).toThrow(expect.objectContaining({ code: "GLYPH_MERMAID_UNSUPPORTED_PACKET_BETA" }));
  expect(glyphDiagramRepairHint("GLYPH_MERMAID_GIT_SYNTAX")).toContain("cherry-pick");
  expect(glyphDiagramRepairHint("GLYPH_MERMAID_MINDMAP_SYNTAX")).toContain("indentation");
});
