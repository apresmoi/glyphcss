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
import { renderGlyphChart3d, glyphChartSurface, type GlyphChart3dCameraOptions, type GlyphChart3dJsonInput, type GlyphChart3dReport, type GlyphChart3dStyle } from "@glyphcss/charts/3d";

export interface ChartCliOptions {
  readonly target?: GlyphChartTarget;
  readonly charset?: GlyphChartCharset;
  readonly color?: GlyphChartColorMode;
  readonly width?: number;
  readonly height?: number;
  /** `--3d` — dispatches to `renderGlyphChart3d` instead of the 2D entry; the spec file is then read as a `GlyphChart3dJsonInput` (`{ data, channels?, options? }`), not a 2D `GlyphChartSpec`. */
  readonly threeD?: boolean;
  /** `--camera rotX,rotY[,zoom]` — `--3d` only. */
  readonly camera?: GlyphChart3dCameraOptions;
  /** `--style solid|wireframe|ink` — `--3d` only; omit for auto-by-charset (fix round 2, USER FEEDBACK: braille renders a real wireframe by default). */
  readonly style?: GlyphChart3dStyle;
}

export const CHART_HELP = `glyphcss chart <spec.json> [options]

  --target chat|terminal|web   (default: terminal)
  --charset ascii|box|blocks|braille
  --color none|ansi16|ansi256|truecolor|css
  --width N  --height N
  --3d                         Render a 3D surface spec ({ data, channels?, options? })
  --camera rotX,rotY[,zoom]    --3d only; omit for auto-fit
  --style solid|wireframe|ink  --3d only; omit for auto-by-charset
  -o, --out FILE

  Output: ANSI when stdout is a TTY, plain text when piped, unless --color
  overrides it.
`;

const CHART_3D_STYLES: readonly GlyphChart3dStyle[] = ["solid", "wireframe", "ink"];

/**
 * P1-4 (codex review, round 6): `raw === undefined` here means `--style` was
 * PRESENT in argv with NO following token (`next()` ran off the end) — never
 * "the flag was omitted", since this function is only ever called from
 * inside the `--style` switch case, i.e. only once the flag has already been
 * seen. The prior cut treated that as "no style requested" and silently
 * returned `undefined`, which is how `--style` (bare, no value, no `--3d`)
 * slipped past the "3D-only flag without `--3d`" check below: that check
 * only ever looked at whether the PARSED value ended up defined, and a
 * silently-swallowed missing value can never be. Requiring a value here
 * unconditionally means `mutableOpts.style` is defined if and only if
 * `--style` was actually present and syntactically valid — exactly the
 * presence signal the post-loop check needs, with no separate "seen" flag.
 */
function parseStyleArg(raw: string | undefined): GlyphChart3dStyle {
  if (raw === undefined) {
    throw chartCliError("bad-style-arg", "--style requires a value (one of solid, wireframe, ink).");
  }
  if (!(CHART_3D_STYLES as readonly string[]).includes(raw)) {
    throw chartCliError("bad-style-arg", `--style expects one of ${CHART_3D_STYLES.join(", ")}, got ${JSON.stringify(raw)}.`);
  }
  return raw as GlyphChart3dStyle;
}

function chartCliError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * `--camera rotX,rotY[,zoom]` requires EXACTLY 2 or 3 comma-separated
 * FINITE numeric fields (fix round 1, P1-5) — the prior cut silently
 * dropped a 4th+ field (`--camera 10,20,3,4` quietly became `rotX:10,
 * rotY:20, zoom:3`) and silently built a partial camera from 1 field
 * (`--camera 10` became `{rotX:10}` with no `rotY` at all, which
 * `renderGlyphChart3d` would then reject with ITS OWN `bad-camera` for a
 * reason the reader never asked about). Both are now a `bad-camera-arg`
 * tagged rejection naming the raw value, at the CLI's own argument-parsing
 * boundary rather than surfacing several layers downstream (or not at
 * all).
 *
 * P1-4 (codex review, round 6): two further holes in that same round's own
 * fix. (1) `raw === undefined` — `--camera` PRESENT with no following token,
 * exactly `parseStyleArg`'s own case (see its doc) — used to silently
 * return `undefined`, which both dropped the "requires a value" error AND
 * broke the post-loop "3D-only flag without `--3d`" presence check the same
 * way. Now throws unconditionally, so `mutableOpts.camera` is defined iff
 * `--camera` was present and syntactically valid. (2) `Number("")` is `0`,
 * not `NaN` — `Number.isFinite` alone therefore ACCEPTED an empty field
 * (`--camera 10,` parsed as `{rotX:10, rotY:0}`, `--camera ,` as
 * `{rotX:0, rotY:0}`), silently fabricating a zero the reader never typed.
 * An explicit empty-string check runs BEFORE the numeric conversion, so an
 * empty field is caught as its own syntax error rather than laundered
 * through `Number` into a plausible-looking `0`.
 */
function parseCameraArg(raw: string | undefined): GlyphChart3dCameraOptions {
  if (raw === undefined) {
    throw chartCliError("bad-camera-arg", "--camera requires a value (rotX,rotY[,zoom]).");
  }
  const parts = raw.split(",").map((p) => p.trim());
  if (parts.length !== 2 && parts.length !== 3) {
    throw chartCliError("bad-camera-arg", `--camera expects rotX,rotY[,zoom] (2 or 3 fields), got ${parts.length}: ${JSON.stringify(raw)}.`);
  }
  if (parts.some((p) => p.length === 0)) {
    throw chartCliError("bad-camera-arg", `--camera fields must all be non-empty finite numbers, got ${JSON.stringify(raw)}.`);
  }
  const numbers = parts.map((p) => Number(p));
  if (!numbers.every((n) => Number.isFinite(n))) {
    throw chartCliError("bad-camera-arg", `--camera fields must all be finite numbers, got ${JSON.stringify(raw)}.`);
  }
  const [rotX, rotY, zoom] = numbers;
  return zoom !== undefined ? { rotX: rotX!, rotY: rotY!, zoom } : { rotX: rotX!, rotY: rotY! };
}

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
    threeD?: boolean;
    camera?: GlyphChart3dCameraOptions;
    style?: GlyphChart3dStyle;
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
      case "--3d": mutableOpts.threeD = true; break;
      case "--camera": mutableOpts.camera = parseCameraArg(next()); break;
      case "--style": mutableOpts.style = parseStyleArg(next()); break;
      case "-o": case "--out": out = next(); break;
      case "-h": case "--help": file = undefined; return { file, out, opts };
      default: if (!a.startsWith("-") && !file) file = a;
    }
  }
  // Every 3D-only flag needs `--3d` present too (fix round 1, P1-5) — today
  // that is `--camera`/`--style`, but the check is written against the FLAG
  // that was actually set (never a fixed list of names) so a future 3D-only
  // flag added here is covered automatically rather than needing its own
  // matching clause.
  if (mutableOpts.camera !== undefined && !mutableOpts.threeD) {
    throw chartCliError("bad-3d-flag", "--camera is 3D-only; pass --3d too.");
  }
  if (mutableOpts.style !== undefined && !mutableOpts.threeD) {
    throw chartCliError("bad-3d-flag", "--style is 3D-only; pass --3d too.");
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

/**
 * `--3d`'s own output resolver, mirroring `resolveChartCliOutput`: `target`
 * defaults to `terminal`, `--color` overrides the TTY-derived default. The
 * spec file is a `GlyphChart3dJsonInput` (`{ data, channels?, options? }`,
 * `renderGlyphChart3dJson`'s own shape) — `glyphChartSurface` is called
 * directly rather than going through the string-in/string-out JSON entry,
 * since the CLI already has a parsed object and a thrown, tagged error is
 * exactly what the `catch` block below wants.
 */
export function resolveChart3dCliOutput(
  input: GlyphChart3dJsonInput,
  opts: ChartCliOptions,
  env: { readonly isTTY: boolean; readonly vars?: Readonly<Record<string, string | undefined>> },
): { readonly text: string; readonly ledger: GlyphChart3dReport["ledger"] } {
  const target = opts.target ?? "terminal";
  const color = opts.color ?? (env.isTTY ? undefined : "none");
  const mark = glyphChartSurface(input.data, input.channels, input.options);
  const result = renderGlyphChart3d(mark, {
    target,
    charset: opts.charset,
    color,
    width: opts.width,
    height: opts.height,
    camera: opts.camera,
    style: opts.style,
    env: env.vars,
  });
  return { text: result.text, ledger: result.report.ledger };
}

export async function runChart(argv: string[]): Promise<void> {
  try {
    // `parseChartArgs` now throws a tagged `bad-camera-arg`/`bad-3d-flag`
    // error for a malformed `--camera` or a 3D-only flag without `--3d`
    // (fix round 1, P1-5) — moved inside `try` so that rejection reaches
    // the SAME tagged-code/exit-1 boundary every other CLI failure does,
    // rather than an unhandled throw before any error handling exists.
    const { file, out, opts } = parseChartArgs(argv);
    if (!file) {
      process.stderr.write(CHART_HELP);
      process.exit(argv.length === 0 ? 1 : 0);
      return;
    }
    const parsed = JSON.parse(await readFile(file, "utf8")) as GlyphChartInput | GlyphChart3dJsonInput;
    const { text, ledger } = opts.threeD
      ? resolveChart3dCliOutput(parsed as GlyphChart3dJsonInput, opts, { isTTY: Boolean(process.stdout.isTTY), vars: process.env })
      : resolveChartCliOutput(parsed as GlyphChartInput, opts, { isTTY: Boolean(process.stdout.isTTY), vars: process.env });
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
