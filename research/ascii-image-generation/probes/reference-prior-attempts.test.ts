import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const exec = promisify(execFile);
const script = resolve(import.meta.dirname, "../scripts/reproduce-prior-reference-attempt.mjs");

describe("prior reference attempts", () => {
  it("binds the preserved red image identity through its sealed run manifest", async () => {
    const audit = await readFile(resolve(import.meta.dirname, "../scripts/audit-red-reference.sh"), "utf8");
    expect(audit).toContain('manifest?.image?.id !== "sha256:3a034dd9275e3451e190e0df50da9891e8fee611c5092aa0034a1de9d206148f"');
    expect(audit).toContain('"$root/run-manifest.json"');
    expect(audit).not.toContain('find "$root" -type f -print0 | xargs -0 sha256sum');
  });

  for (const [id, coverage, newlyRevealedArea] of [
    ["b7-unframed-public-80x24", 0, 1],
    ["b40-bounds-fitted-atlas8", 0.6551724137931034, 0.3448275862068966],
  ] as const) {
    it(`reproduces ${id} from runnable Node inputs`, async () => {
      const { stdout } = await exec(process.execPath, [script, id]);
      expect(JSON.parse(stdout)).toMatchObject({ id, coverage, newlyRevealedArea });
    }, 120_000);
  }
});
