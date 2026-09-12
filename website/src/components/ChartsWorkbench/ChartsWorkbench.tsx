/**
 * `/charts` — the Phase 1 "early page" (PLAN.md: "something visible as soon
 * as possible"). Deliberately NOT `MapsWorkbench`'s full `InstrumentShell`
 * (rails, preset tray, Dock, atlas-decoded copy) — that machinery exists for
 * a LIVE `createGlyphScene` DOM element, and a chart render is a plain
 * string/HTML value with no scene, no atlas, nothing to orbit. The page
 * itself mirrors `maps.astro`'s own shell (full-bleed dark page, no
 * Starlight sidebar, `DocsHeader` on top) — see `charts.astro`. Grows into a
 * real workbench (URL codec and orbit) in Phase 5.
 */
import { useMemo, useState } from "react";
import {
  GLYPH_CHART_TARGET_DEFAULTS,
  renderGlyphChart,
  glyphChartArc,
  glyphChartArea,
  glyphChartBar,
  glyphChartDot,
  glyphChartLine,
  glyphChartPlot,
  glyphChartRule,
  type GlyphChartCharset,
  type GlyphChartColorMode,
  type GlyphChartInput,
  type GlyphChartTarget,
} from "@glyphcss/charts";

const SAMPLE = [
  { t: 0, v: 3 }, { t: 1, v: 5 }, { t: 2, v: 2 }, { t: 3, v: 8 },
  { t: 4, v: 6 }, { t: 5, v: 9 }, { t: 6, v: 4 },
];

const DEFAULT_SPEC = glyphChartPlot({
  marks: [
    glyphChartLine(SAMPLE, { x: "t", y: "v" }),
    glyphChartDot(SAMPLE, { x: "t", y: "v" }),
    glyphChartRule([0]),
  ],
  title: "line + dot + rule",
});

interface Preset {
  readonly label: string;
  readonly build: () => GlyphChartInput;
}

const PRESETS: readonly Preset[] = [
  { label: "line", build: () => glyphChartPlot({ marks: [glyphChartLine(SAMPLE, { x: "t", y: "v" })], title: "line" }) },
  { label: "bar", build: () => glyphChartPlot({ marks: [glyphChartBar(SAMPLE, { x: "t", y: "v" })], title: "bar" }) },
  { label: "dot", build: () => glyphChartPlot({ marks: [glyphChartDot(SAMPLE, { x: "t", y: "v" })], title: "dot" }) },
  { label: "area", build: () => glyphChartPlot({ marks: [glyphChartArea(SAMPLE, { x: "t", y: "v" })], title: "area" }) },
  { label: "arc", build: () => glyphChartPlot({ marks: [glyphChartArc(SAMPLE.map((d) => d.v))], title: "arc" }) },
];

const TARGETS: readonly GlyphChartTarget[] = ["chat", "terminal", "web"];
const CHARSETS: readonly GlyphChartCharset[] = ["ascii", "box", "blocks", "braille"];
const COLORS: readonly GlyphChartColorMode[] = ["none", "ansi16", "ansi256", "truecolor", "css"];

type GlyphChartsWorkbenchOverrides = {
  charset?: GlyphChartCharset;
  color?: GlyphChartColorMode;
  width?: number;
  height?: number;
};

export interface GlyphChartsWorkbenchControls {
  readonly target: GlyphChartTarget;
  readonly overrides: GlyphChartsWorkbenchOverrides;
}

type GlyphChartsWorkbenchAction =
  | { type: "target"; value: GlyphChartTarget }
  | { type: "charset"; value: GlyphChartCharset }
  | { type: "color"; value: GlyphChartColorMode }
  | { type: "width" | "height"; value: number }
  | { type: "reset" };

/** An explicit choice stays an override even when it equals today's default. */
export function reduceGlyphChartsWorkbenchControls(
  state: GlyphChartsWorkbenchControls,
  action: GlyphChartsWorkbenchAction,
): GlyphChartsWorkbenchControls {
  if (action.type === "target") return { ...state, target: action.value };
  if (action.type === "reset") return { target: state.target, overrides: {} };
  return { ...state, overrides: { ...state.overrides, [action.type]: action.value } };
}

export function resolveGlyphChartsWorkbenchControls(state: GlyphChartsWorkbenchControls) {
  return { target: state.target, ...GLYPH_CHART_TARGET_DEFAULTS[state.target], ...state.overrides };
}

/** Raw cells preserve the painted picture without inserting terminal control bytes into the browser or clipboard's plain-text exit. */
export function renderChartsWorkbenchSpec(
  specJson: string,
  opts: { target: GlyphChartTarget; charset: GlyphChartCharset; color: GlyphChartColorMode; width: number; height: number },
): { ok: true; display: string; isHtml: boolean; text: string; ansi?: string } | { ok: false; error: string; code?: string } {
  let input: GlyphChartInput;
  try {
    input = JSON.parse(specJson) as GlyphChartInput;
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  try {
    const result = renderGlyphChart(input, opts);
    const text = Array.from({ length: result.grid.rows }, (_, row) =>
      result.grid.char.slice(row * result.grid.cols, (row + 1) * result.grid.cols).join("")
    ).join("\n");
    const isHtml = opts.color === "css" && result.html !== undefined;
    const ansi = opts.color === "ansi16" || opts.color === "ansi256" || opts.color === "truecolor"
      ? result.text : undefined;
    return { ok: true, display: isHtml ? result.html! : text, isHtml, text, ansi };
  } catch (e) {
    const error = e as Error & { code?: string };
    return { ok: false, error: error.code ? `${error.code}: ${error.message}` : error.message, code: error.code };
  }
}

const fieldStyle: React.CSSProperties = {
  display: "flex", flexDirection: "column", gap: 4, fontSize: 12,
};
const selectStyle: React.CSSProperties = {
  background: "#11151c", color: "rgba(255,232,184,0.94)", border: "1px solid rgba(255,232,184,0.3)",
  padding: "4px 6px", fontFamily: "inherit", fontSize: 12,
};

export default function ChartsWorkbench() {
  const [specText, setSpecText] = useState(() => JSON.stringify(DEFAULT_SPEC, null, 2));
  const [controls, setControls] = useState<GlyphChartsWorkbenchControls>({ target: "chat", overrides: {} });
  const { target, charset, color, width, height } = resolveGlyphChartsWorkbenchControls(controls);
  const updateControl = (action: GlyphChartsWorkbenchAction) => {
    setControls((state) => reduceGlyphChartsWorkbenchControls(state, action));
    setCopied(null);
  };
  const [copied, setCopied] = useState<"text" | "ansi" | null>(null);

  const rendered = useMemo(
    () => renderChartsWorkbenchSpec(specText, { target, charset, color, width, height }),
    [specText, target, charset, color, width, height],
  );
  const copy = async (encoding: "text" | "ansi") => {
    if (!rendered.ok) return;
    const content = encoding === "text" ? rendered.text : rendered.ansi;
    if (content === undefined) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(encoding);
    } catch {
      // The preview remains selectable if clipboard permission is denied.
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: 16, gap: 12, boxSizing: "border-box", overflow: "auto" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => setSpecText(JSON.stringify(p.build(), null, 2))}
            style={{ background: "rgba(56,189,248,0.12)", color: "rgba(255,232,184,0.94)", border: "1px solid rgba(56,189,248,0.4)", padding: "4px 10px", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <label style={fieldStyle}>target
          <select style={selectStyle} value={target} onChange={(e) => updateControl({ type: "target", value: e.target.value as GlyphChartTarget })}>
            {TARGETS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label style={fieldStyle}>charset
          <select style={selectStyle} value={charset} onChange={(e) => updateControl({ type: "charset", value: e.target.value as GlyphChartCharset })}>
            {CHARSETS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={fieldStyle}>color
          <select style={selectStyle} value={color} onChange={(e) => updateControl({ type: "color", value: e.target.value as GlyphChartColorMode })}>
            {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={fieldStyle}>width
          <input style={selectStyle} type="number" min={1} step={1} max={240} value={width} onChange={(e) => updateControl({ type: "width", value: Number(e.target.value) })} />
        </label>
        <label style={fieldStyle}>height
          <input style={selectStyle} type="number" min={1} step={1} max={120} value={height} onChange={(e) => updateControl({ type: "height", value: Number(e.target.value) })} />
        </label>
        <button type="button" onClick={() => updateControl({ type: "reset" })} style={{ ...selectStyle, alignSelf: "flex-end", cursor: "pointer" }}>
          Reset to target defaults
        </button>
        <button
          type="button"
          disabled={!rendered.ok}
          onClick={() => copy("text")}
          style={{ alignSelf: "flex-end", background: "rgba(255,232,184,0.12)", color: "rgba(255,232,184,0.94)", border: "1px solid rgba(255,232,184,0.3)", padding: "4px 10px", fontFamily: "inherit", fontSize: 12, cursor: "pointer" }}
        >
          {copied === "text" ? "Copied text!" : "Copy as text"}
        </button>
        {rendered.ok && rendered.ansi !== undefined && (
          <button type="button" onClick={() => copy("ansi")} style={{ ...selectStyle, alignSelf: "flex-end", cursor: "pointer" }}>
            {copied === "ansi" ? "Copied ANSI!" : "Copy ANSI"}
          </button>
        )}
      </div>

      <textarea
        value={specText}
        onChange={(e) => setSpecText(e.target.value)}
        spellCheck={false}
        style={{
          width: "100%", height: 180, background: "#11151c", color: "rgba(226,232,240,0.9)",
          border: "1px solid rgba(255,232,184,0.2)", fontFamily: "inherit", fontSize: 12, padding: 8, boxSizing: "border-box", resize: "vertical",
        }}
      />

      {rendered.ok && rendered.ansi !== undefined && (
        <p role="status" style={{ margin: 0, fontSize: 12 }}>Preview shows plain text. ANSI escapes are included only with Copy ANSI.</p>
      )}
      <div style={{ flex: 1, minHeight: 200, border: "1px solid rgba(255,232,184,0.2)", padding: 8, overflow: "auto", background: "#07090d" }}>
        {rendered.ok
          ? rendered.isHtml
            ? <pre className="glyph-output" style={{ margin: 0 }} dangerouslySetInnerHTML={{ __html: rendered.display }} />
            : <pre className="glyph-output" style={{ margin: 0, color: "rgba(226,232,240,0.95)" }}>{rendered.display}</pre>
          : <div style={{ color: "#f87171", fontSize: 13 }}>{rendered.error}</div>}
      </div>
    </div>
  );
}
