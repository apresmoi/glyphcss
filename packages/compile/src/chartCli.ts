/**
 * `glyphcss chart <spec.json>` — split out of `cli.ts` (rather than kept
 * inline) specifically so it can be imported for testing WITHOUT triggering
 * `cli.ts`'s own trailing `main().catch(...)` module-load side effect (that
 * top-level call reads the real `process.argv`, which under a test runner
 * is the test runner's own argv, not a chart spec path — importing `cli.ts`
 * from a test therefore actually ran the mesh-CLI's help/exit path as an
 * unhandled rejection). `cli.ts` imports `runChart` from here and calls it;
 * nothing here touches `process.argv` at module load.
 */
import { readFile, writeFile } from "node:fs/promises";
import { renderGlyphChart, type GlyphChartCharset, type GlyphChartColorMode, type GlyphChartInput, type GlyphChartLedgerEntry, type GlyphChartTarget } from "@glyphcss/charts";

export interface ChartCliOptions {
  readonly target?: GlyphChartTarget;
  readonly charset?: GlyphChartCharset;
  readonly color?: GlyphChartColorMode;
  readonly width?: number;
  readonly height?: number;
}

export const CHART_HELP = `glyphcss chart <spec.json> [options]

  --target chat|terminal|web   (default: terminal)
  --charset ascii|box|blocks|braille
  --color none|ansi16|ansi256|truecolor|css
  --width N  --height N
  -o, --out FILE

  Output: ANSI when stdout is a TTY, plain text when piped, unless --color
  overrides it.
`;

export function parseChartArgs(argv: string[]): { file?: string; out?: string; opts: ChartCliOptions } {
  let file: string | undefined;
  let out: string | undefined;
  const opts: ChartCliOptions = {};
  const mutableOpts = opts as {
    target?: GlyphChartTarget;
    charset?: GlyphChartCharset;
    color?: GlyphChartColorMode;
    width?: number;
    height?: number;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string | undefined => argv[++i];
    switch (a) {
      case "--target": mutableOpts.target = next() as GlyphChartTarget; break;
      case "--charset": mutableOpts.charset = next() as GlyphChartCharset; break;
      case "--color": mutableOpts.color = next() as GlyphChartColorMode; break;
      case "--width": mutableOpts.width = Number(next()); break;
      case "--height": mutableOpts.height = Number(next()); break;
      case "-o": case "--out": out = next(); break;
      case "-h": case "--help": file = undefined; return { file, out, opts };
      default: if (!a.startsWith("-") && !file) file = a;
    }
  }
  return { file, out, opts };
}

/**
 * Pure — takes the spec and an explicit `isTTY`/`env` rather than reading
 * `process.stdout.isTTY`/`process.env` itself, so the "TTY -> ANSI, pipe ->
 * text" default is a unit-testable function (`chartCli.test.ts` exercises
 * both branches directly, no pty needed) instead of something only a real
 * terminal proves. `--color` always overrides the TTY-derived default,
 * exactly like `-f` overrides format detection on the mesh CLI path.
 */
export function resolveChartCliOutput(
  input: GlyphChartInput,
  opts: ChartCliOptions,
  env: { readonly isTTY: boolean; readonly vars?: Readonly<Record<string, string | undefined>> },
): { readonly text: string; readonly ledger: readonly GlyphChartLedgerEntry[] } {
  const target = opts.target ?? "terminal";
  const color = opts.color ?? (env.isTTY ? undefined : "none");
  const result = renderGlyphChart(input, {
    target,
    charset: opts.charset,
    color,
    width: opts.width,
    height: opts.height,
    env: env.vars,
  });
  return { text: result.text, ledger: result.report.ledger };
}

export async function runChart(argv: string[]): Promise<void> {
  const { file, out, opts } = parseChartArgs(argv);
  if (!file) {
    process.stderr.write(CHART_HELP);
    process.exit(argv.length === 0 ? 1 : 0);
    return;
  }
  try {
    const spec = JSON.parse(await readFile(file, "utf8")) as GlyphChartInput;
    const { text, ledger } = resolveChartCliOutput(spec, opts, { isTTY: Boolean(process.stdout.isTTY), vars: process.env });
    if (out) {
      await writeFile(out, text, "utf8");
      process.stderr.write(`glyphcss: wrote ${out}\n`);
    } else {
      process.stdout.write(text + "\n");
    }
    // Final-gate-2 review (both P2 #5/#10): the diagram CLI already prints
    // its fidelity ledger to stderr; the chart CLI discarded `report`
    // entirely, so `glyphcss chart` was the ONLY place `report.ledger`
    // (AGENTS.md's "the structured ledger is for the CLI and agents reading
    // `report`, not the page") could never actually be read by a
    // non-programmatic caller. Same format as `diagramCli.ts`.
    for (const entry of ledger) process.stderr.write(`glyphcss: ${entry.code}: ${entry.message}\n`);
  } catch (error) {
    // Chart rule ids must survive the CLI boundary so callers can repair JSON or flags without parsing prose.
    const code = error instanceof Error && "code" in error ? `${String(error.code)}: ` : "";
    process.stderr.write(`glyphcss: ${code}${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
