/**
 * PLAN-3d.md §2.2 / AGENTS.md's "Charts 3D": the root `@glyphcss/charts`
 * entry stays camera-free and rasterizer-free, so a 2D/chat/CLI consumer
 * pulls in none of `./3d`'s scene-object code. `./3d` is free to import
 * FROM the root (it shares the 2D vocabulary on purpose); this gate is
 * ONE-DIRECTIONAL (P2-8).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const SRC_DIR = path.join(__dirname);
const IMPORT_FROM_3D = /from\s+["']\.\/3d(\/|["'])|from\s+["']\.\.\/3d(\/|["'])/;

function rootSourceFiles(): string[] {
  return readdirSync(SRC_DIR)
    .filter((name) => (name.endsWith(".ts") || name.endsWith(".tsx")) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx"))
    .map((name) => path.join(SRC_DIR, name));
}

describe("root-entry isolation (P2-8)", () => {
  it("no root-level source file imports from ./3d", () => {
    const offenders: string[] = [];
    for (const file of rootSourceFiles()) {
      const text = readFileSync(file, "utf8");
      if (IMPORT_FROM_3D.test(text)) offenders.push(path.basename(file));
    }
    expect(offenders).toEqual([]);
  });

  it("MUTATION: the scan itself actually catches a ./3d import (a broken regex would pass vacuously)", () => {
    const fixture = 'import { glyphChartObject } from "./3d/object";\n';
    expect(IMPORT_FROM_3D.test(fixture)).toBe(true);
  });
});
