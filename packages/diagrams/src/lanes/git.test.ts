import { describe, expect, it } from "vitest";
import { glyphLaneDagFromGitLog } from "./git";

const LOG = [
  "9f2c1ab|4ab77de 2d6aa19|(HEAD -> main, tag: v2.4.0)|release: cut 2.4.0",
  "4ab77de|1c90fee 7e41b02||chore: bump deps",
  "1c90fee|7e41b02||fix(auth): refresh token race",
  "7e41b02|b83f5c7||feat(orders): partial refunds",
  "2d6aa19|b83f5c7||docs: architecture decision 014",
  "b83f5c7|||fix(http): keep-alive leak",
].join("\n");

describe("glyphLaneDagFromGitLog", () => {
  it("parses id/parents/decoration/subject lines into the agnostic IR", () => {
    const dag = glyphLaneDagFromGitLog(LOG);
    expect(dag.nodes).toHaveLength(6);
    expect(dag.nodes[0]).toEqual({ id: "9f2c1ab", label: "release: cut 2.4.0", parents: ["4ab77de", "2d6aa19"], marks: ["main", "v2.4.0"] });
    expect(dag.nodes[1]!.parents).toEqual(["1c90fee", "7e41b02"]);
  });

  it("strips \"HEAD -> \" and \"tag: \" prefixes from decoration entries into plain marks", () => {
    const dag = glyphLaneDagFromGitLog(LOG);
    expect(dag.nodes[0]!.marks).toEqual(["main", "v2.4.0"]);
  });

  it("omits marks entirely for a commit with no decoration", () => {
    const dag = glyphLaneDagFromGitLog(LOG);
    expect(dag.nodes[1]!.marks).toBeUndefined();
  });

  it("rejects a malformed line with its own syntax error code", () => {
    expect(() => glyphLaneDagFromGitLog("not-enough-fields")).toThrow(expect.objectContaining({ code: "GLYPH_LANE_GIT_SYNTAX" }));
  });

  it("rejects a parent missing from the given window with the shared unknown-parent rule, not a git-specific one", () => {
    expect(() => glyphLaneDagFromGitLog("abc|def||subject")).toThrow(expect.objectContaining({ code: "unknown-parent" }));
  });
});
