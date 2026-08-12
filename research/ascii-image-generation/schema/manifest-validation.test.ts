import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const directory = dirname(fileURLToPath(import.meta.url));

describe("B2 schema fixtures", () => {
  it("accepts golden records and rejects each adversarial fixture", () => {
    const output = execFileSync(process.execPath, [resolve(directory, "../scripts/validate-manifest.mjs"), "--fixtures"], {
      cwd: resolve(directory, ".."),
      encoding: "utf8",
    });

    expect(output).toMatch(/Validated 1 valid and \d+ invalid schema fixtures\./);
  });
});
