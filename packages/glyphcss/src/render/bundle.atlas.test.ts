/**
 * The chunk boundary, asserted against the BUILT output rather than the source.
 *
 * Source-level review cannot see this: `tsup`'s `splitting` flag, a stray
 * static `import "./fontAtlasPayload"`, or a bundler change can each silently
 * merge the ~44KB base64 WOFF2 back into `dist/index.js`, and every other test
 * in this package would still pass. So this reads `dist/` directly.
 *
 * It SKIPS when `dist/` is absent (a bare `pnpm test` on a clean checkout) —
 * `pnpm build` is a mandatory gate before a PR, and CI runs both, so the check
 * always executes where it matters. It never rebuilds: a test that shells out
 * to a bundler is a build step wearing a test's clothes.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// vitest runs with the package root as cwd. The payload JSON is read rather
// than imported on purpose: `render/fontAtlasPayload.ts` must stay the ONE
// module in this package that imports `atlas-font.json`, and a test import
// would quietly break that grep-checkable invariant.
const ROOT = resolve(process.cwd());
const DIST = join(ROOT, "dist");
const ASSET = join(ROOT, "assets/glyph-atlas/atlas-font.json");
const built = existsSync(join(DIST, "index.js")) && existsSync(ASSET);

// Long enough that it cannot occur by chance, short enough to survive any
// minifier string handling.
const PROBE = built ? (JSON.parse(readFileSync(ASSET, "utf8")) as { woff2Base64: string }).woff2Base64.slice(0, 128) : "";

function bundleFiles(): string[] {
  return readdirSync(DIST).filter((f) => f.endsWith(".js") || f.endsWith(".cjs"));
}

/** Transitive closure over STATIC imports only — what a consumer's bundler pulls in. */
function staticClosure(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file) || !existsSync(join(DIST, file))) continue;
    seen.add(file);
    const src = readFileSync(join(DIST, file), "utf8");
    for (const m of src.matchAll(/(?:^|[;}\s])(?:import|export)\b(?:[^"';]*?from)?\s*["']\.\/([^"']+)["']/g)) {
      queue.push(m[1]!);
    }
    // esbuild's CJS lowering of `import()` is `Promise.resolve().then(() => require(...))`;
    // only a `require` NOT inside such a `.then(` is a static dependency.
    for (const m of src.matchAll(/require\(["']\.\/([^"']+)["']\)/g)) {
      const before = src.slice(Math.max(0, m.index! - 60), m.index!);
      if (!/\.then\(\s*\(\s*\)\s*=>\s*$|\.then\(\s*\(\s*\)\s*=>\s*\w+\($/.test(before)) queue.push(m[1]!);
    }
  }
  return [...seen];
}

describe.skipIf(!built)("built bundle — the atlas payload is not in the main chunk", () => {
  it("puts the base64 WOFF2 in exactly one file per format, and it is not an entry point", () => {
    const carriers = bundleFiles().filter((f) => readFileSync(join(DIST, f), "utf8").includes(PROBE));
    expect(carriers.length).toBeGreaterThan(0);
    for (const file of carriers) expect(file).toMatch(/^fontAtlasPayload-/);
    // One ESM chunk + one CJS chunk, nothing else.
    expect(carriers.filter((f) => f.endsWith(".js")).length).toBe(1);
    expect(carriers.filter((f) => f.endsWith(".cjs")).length).toBe(1);
  });

  it.each(["index.js", "index.cjs", "elements.js", "elements.cjs", "three.js", "three.cjs"])(
    "%s pulls in no atlas base64 through its static import graph",
    (entry) => {
      if (!existsSync(join(DIST, entry))) return;
      const closure = staticClosure(entry);
      // The closure must be real — a regex that matched nothing would make this
      // assertion vacuous for a single self-contained bundle.
      expect(closure).toContain(entry);
      for (const file of closure) {
        expect(readFileSync(join(DIST, file), "utf8").includes(PROBE), `${entry} -> ${file} carries the atlas base64`).toBe(false);
      }
    },
  );

  it("reaches the payload chunk only through a dynamic import()", () => {
    const payloadChunk = bundleFiles().find((f) => f.startsWith("fontAtlasPayload-") && f.endsWith(".js"))!;
    const referrers = bundleFiles().filter((f) => f !== payloadChunk && readFileSync(join(DIST, f), "utf8").includes(payloadChunk));
    expect(referrers.length).toBeGreaterThan(0);
    for (const file of referrers) {
      const src = readFileSync(join(DIST, file), "utf8");
      expect(src).toContain(`import("./${payloadChunk}")`);
      // ...and never as a static one.
      expect(src).not.toMatch(new RegExp(`(?:^|[;}\\s])(?:import|export)\\b[^"';]*?from\\s*["']\\./${payloadChunk.replace(/[.*+?^$()|[\]\\]/g, "\\$&")}["']`));
    }
  });
});
