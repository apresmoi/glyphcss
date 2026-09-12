import { readFile, writeFile } from "node:fs/promises";
import {
  glyphGraphFromJson, parseGlyphDiagramJson, renderGlyphDiagram,
  type GlyphDiagramRenderOptions, type GlyphGraph,
} from "@glyphcss/diagrams";

export type GlyphDiagramCliOptions = Omit<GlyphDiagramRenderOptions, "env">;

export const GLYPH_DIAGRAM_CLI_HELP = `glyphcss diagram <file.mmd|graph.json> [options]

  --target chat|terminal|web   (default: terminal)
  --charset ascii|box|blocks|braille
  --color none|ansi16|ansi256|truecolor|css
  --width N  --height N
  --direction TB|LR|BT|RL
  --engine dagre  --nodesep N  --ranksep N
  --title TEXT  --detail auto|faithful|balanced|simplified
  -o, --out FILE

  Output: ANSI when stdout is a TTY, plain text when piped, unless --color
  overrides it. CSS colour emits HTML. Fidelity ledger entries go to stderr.
`;

function argumentError(message: string): never {
  throw Object.assign(new TypeError(`glyphcss: bad-options: ${message}`), { code: "bad-options" });
}

export function parseGlyphDiagramArgs(argv: readonly string[]): { file?: string; out?: string; opts: GlyphDiagramCliOptions } {
  let file: string | undefined;
  let out: string | undefined;
  const opts: { -readonly [Key in keyof GlyphDiagramCliOptions]: GlyphDiagramCliOptions[Key] } = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!;
    const next = (): string => {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--")) argumentError(`${argument} requires a value.`);
      return value;
    };
    const choice = <T extends string>(values: readonly T[]): T => {
      const value = next();
      if (!values.includes(value as T)) argumentError(`${argument} must be ${values.join(" / ")}.`);
      return value as T;
    };
    switch (argument) {
      case "--target": opts.target = choice(["chat", "terminal", "web"]); break;
      case "--charset": opts.charset = choice(["ascii", "box", "blocks", "braille"]); break;
      case "--color": opts.color = choice(["none", "ansi16", "ansi256", "truecolor", "css"]); break;
      case "--width": opts.width = Number(next()); break;
      case "--height": opts.height = Number(next()); break;
      case "--direction": opts.direction = choice(["TB", "LR", "BT", "RL"]); break;
      case "--engine": opts.engine = choice(["dagre"]); break;
      case "--nodesep": opts.nodesep = Number(next()); break;
      case "--ranksep": opts.ranksep = Number(next()); break;
      case "--title": opts.title = next(); break;
      case "--detail": opts.detail = choice(["auto", "faithful", "balanced", "simplified"]); break;
      case "-o": case "--out": out = next(); break;
      case "-h": case "--help": return { file: undefined, out, opts };
      default:
        if (argument.startsWith("-")) argumentError(`Unknown diagram option ${argument}.`);
        if (file !== undefined) argumentError(`Only one diagram input file is accepted; got ${argument}.`);
        file = argument;
    }
  }
  return { file, out, opts };
}

function renderCli(input: string | GlyphGraph, options: GlyphDiagramCliOptions, output: { readonly isTTY: boolean; readonly vars?: Readonly<Record<string, string | undefined>> }) {
  return renderGlyphDiagram(input, {
    ...options,
    target: options.target ?? "terminal",
    color: options.color ?? (output.isTTY ? undefined : "none"),
    env: output.vars,
  });
}

export async function resolveGlyphDiagramCliOutput(
  input: string | GlyphGraph,
  options: GlyphDiagramCliOptions,
  output: { readonly isTTY: boolean; readonly vars?: Readonly<Record<string, string | undefined>> },
): Promise<string> {
  const result = await renderCli(input, options, output);
  return result.html ?? result.text;
}

export async function runGlyphDiagram(argv: readonly string[]): Promise<void> {
  try {
    const { file, out, opts } = parseGlyphDiagramArgs(argv);
    if (!file) {
      process.stderr.write(GLYPH_DIAGRAM_CLI_HELP);
      process.exit(argv.length === 0 ? 1 : 0);
      return;
    }
    if (!/\.(?:mmd|json)$/i.test(file)) argumentError("Use a .mmd Mermaid file or a .json graph file.");
    const source = await readFile(file, "utf8");
    const input = /\.json$/i.test(file) ? glyphGraphFromJson(parseGlyphDiagramJson(source)) : source;
    const result = await renderCli(input, opts, { isTTY: Boolean(process.stdout.isTTY), vars: process.env });
    const output = result.html ?? result.text;
    for (const entry of result.report.ledger) process.stderr.write(`glyphcss: ${entry}\n`);
    if (out) {
      await writeFile(out, output, "utf8");
      process.stderr.write(`glyphcss: wrote ${out}\n`);
    } else process.stdout.write(output + "\n");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? `${String(error.code)}: ` : "";
    process.stderr.write(`glyphcss: ${code}${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
