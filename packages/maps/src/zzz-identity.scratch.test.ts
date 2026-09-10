/** SCRATCH: proves the new settle condition renders the same bytes as the old 600 ms sleep. */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const MODE = process.env.IDENTITY_MODE ?? "new";
const OUT = process.env.IDENTITY_OUT!;

describe("identity", () => {
  it("hashes the four render scenarios", async () => {
    const mod = await import("./zzz-oceanDrape-harness.scratch");
    const hashes = await mod.scenarios();
    writeFileSync(OUT, JSON.stringify(hashes, null, 2));
    expect(Object.keys(hashes).length).toBe(4);
  }, 300000);
});
