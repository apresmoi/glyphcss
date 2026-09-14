import { readFile, writeFile } from "node:fs/promises";
import {
  glyphGraphFromJson, parseGlyphDiagramJson, renderGlyphDiagram,
  type GlyphDiagramRenderOptions, type GlyphGraph,
} from "@glyphcss/diagrams";
import {
  renderGlyphDiagram3d,
  type GlyphDiagram3dCamera, type GlyphDiagram3dRenderOptions,
} from "@glyphcss/diagrams/3d";

/**
 * `--3d` (packet D2, PLAN-3d.md §11) dispatches to `renderGlyphDiagram3d`
 * instead of the 2D pipeline — a STATIC FRAME at the resolved (or
 * auto-fit) camera, the export boundary the user approved: no live orbit,
 * no turntable, no effects, here or anywhere else outside `/diagrams`'
 * own web page (D3). `layout3d`/`camera3d` are 3D-only and rejected on the
 * 2D path by `parseGlyphDiagramArgs` never setting them there; every other
 * option (`target`/`charset`/`color`/`width`/`height`/`direction`/`title`)
 * is shared verbatim between both pipelines.
 */
export type GlyphDiagramCliOptions = Omit<GlyphDiagramRenderOptions, "env"> & {
  is3d?: boolean;
  layout3d?: "layered" | "force";
  camera3d?: GlyphDiagram3dCamera;
};

export const GLYPH_DIAGRAM_CLI_HELP = `glyphcss diagram <file.mmd|graph.json> [options]

  --target chat|terminal|web   (default: terminal)
  --charset ascii|box|blocks|braille
  --color none|ansi16|ansi256|truecolor|css
  --width N  --height N
  --direction TB|LR|BT|RL
  --engine dagre  --nodesep N  --ranksep N
  --title TEXT  --detail auto|faithful|balanced|simplified
  --3d  --layout layered|force  --camera rotX,rotY[,zoom]
  -o, --out FILE

  Output: ANSI when stdout is a TTY, plain text when piped, unless --color
  overrides it. CSS colour emits HTML. Fidelity ledger entries go to stderr.

  --3d renders a STATIC FRAME of the same graph in 3D (a live orbit view and
  turntable export stay web-only, on the /diagrams page) — --layout picks
  the 3D layout (default layered) and --camera pins rotX,rotY and,
  optionally, zoom (omitted zoom auto-fits every node label on screen).
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
      case "--3d": opts.is3d = true; break;
      case "--layout": opts.layout3d = choice(["layered", "force"]); break;
      case "--camera": {
        const raw = next();
        const parts = raw.split(",").map((s) => Number(s.trim()));
        if (parts.length < 2 || parts.length > 3 || parts.some((n) => !Number.isFinite(n))) argumentError("--camera must be rotX,rotY[,zoom] (numbers).");
        opts.camera3d = { rotX: parts[0], rotY: parts[1], ...(parts.length === 3 ? { zoom: parts[2] } : {}) };
        break;
      }
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

interface GlyphDiagramCliResult { readonly text: string; readonly html?: string; readonly report: { readonly ledger: readonly { readonly code: string; readonly message: string }[] } }

function renderCli(input: string | GlyphGraph, options: GlyphDiagramCliOptions, output: { readonly isTTY: boolean; readonly vars?: Readonly<Record<string, string | undefined>> }): Promise<GlyphDiagramCliResult> {
  const target = options.target ?? "terminal";
  const color = options.color ?? (output.isTTY ? undefined : "none");
  if (options.is3d) {
    const opts3d: GlyphDiagram3dRenderOptions = {
      target, charset: options.charset, color, width: options.width, height: options.height,
      direction: options.direction, title: options.title, env: output.vars,
      layout: options.layout3d, camera: options.camera3d,
    };
    return renderGlyphDiagram3d(input, opts3d);
  }
  return renderGlyphDiagram(input, { ...options, target, color, env: output.vars });
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
    for (const entry of result.report.ledger) process.stderr.write(`glyphcss: ${entry.code}: ${entry.message}\n`);
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
