/**
 * The chunk boundary, asserted against the BUILT output rather than the source.
 *
 * Source-level review cannot see this: `tsup`'s `splitting` flag, a stray
 * static `import "./fontAtlasPayload"` / `"./fontAtlasAsciiPayload"`, or a
 * bundler change can each silently merge a ~45KB base64 WOFF2 back into
 * `dist/index.js`, and every other test in this package would still pass. So
 * this reads `dist/` directly, once per shipped atlas variant — the split is a
 * per-payload guarantee, and a universal-only probe stays green while the
 * ASCII payload is merged.
 *
 * It SKIPS when `dist/` is absent (a bare `pnpm test` on a clean checkout) —
 * `pnpm build` is a mandatory gate before a PR, and CI runs both, so the check
 * always executes where it matters. It never rebuilds: a test that shells out
 * to a bundler is a build step wearing a test's clothes.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

// vitest runs with the package root as cwd. The payload JSONs are read rather
// than imported on purpose: each `render/fontAtlas*Payload.ts` must stay the
// ONE module in this package that imports its own `*-font.json`, and a test
// import would quietly break that grep-checkable invariant.
const ROOT = resolve(process.cwd());
const DIST = join(ROOT, "dist");

// Every shipped atlas variant's payload, each its own chunk. Both are checked:
// the guarantee is per-payload, so a stray static import of only the ASCII one
// would merge ~45KB into `dist/index.js` with a universal-only probe still green.
const PAYLOADS = [
  { name: "universal", asset: "assets/glyph-atlas/atlas-font.json", chunk: "fontAtlasPayload-" },
  { name: "ascii", asset: "assets/glyph-atlas/ascii-atlas-font.json", chunk: "fontAtlasAsciiPayload-" },
] as const;

const built = existsSync(join(DIST, "index.js")) && PAYLOADS.every((p) => existsSync(join(ROOT, p.asset)));

// Long enough that it cannot occur by chance, short enough to survive any
// minifier string handling.
function probeOf(asset: string): string {
  return (JSON.parse(readFileSync(join(ROOT, asset), "utf8")) as { woff2Base64: string }).woff2Base64.slice(0, 128);
}
const PROBES: Record<string, string> = built
  ? Object.fromEntries(PAYLOADS.map((p) => [p.name, probeOf(p.asset)]))
  : {};


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

describe.skipIf(!built)("built bundle — no atlas payload is in the main chunk", () => {
  it("gives each atlas variant a distinguishable probe", () => {
    // The variants share a source face, so a too-short base64 prefix could
    // match both — which would make every per-chunk assertion below vacuous.
    expect(new Set(Object.values(PROBES)).size).toBe(PAYLOADS.length);
  });

  describe.each(PAYLOADS)("$name payload", ({ name, chunk }) => {
    const probe = () => PROBES[name]!;

    it("puts the base64 WOFF2 in exactly one file per format, and it is not an entry point", () => {
      const carriers = bundleFiles().filter((f) => readFileSync(join(DIST, f), "utf8").includes(probe()));
      expect(carriers.length).toBeGreaterThan(0);
      for (const file of carriers) expect(file.startsWith(chunk)).toBe(true);
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
          expect(readFileSync(join(DIST, file), "utf8").includes(probe()), `${entry} -> ${file} carries the atlas base64`).toBe(false);
        }
      },
    );

    it("reaches the payload chunk only through a dynamic import()", () => {
      const payloadChunk = bundleFiles().find((f) => f.startsWith(chunk) && f.endsWith(".js"))!;
      expect(payloadChunk).toBeDefined();
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
});
