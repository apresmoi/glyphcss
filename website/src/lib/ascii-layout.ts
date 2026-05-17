// Responsive ASCII layout primitives.
//
// Each composition is a `Renderable` — a function `({ cols }) => string[]` that
// produces lines for a given character-column width. Parents pass `cols` down
// to children, so the same tree reflows when the viewport changes.
//
// Ported from clanknslop-old's `@asciss/ui-core` package, trimmed to what the
// landing actually uses.

export type Rows = readonly string[];
export interface RenderProps {
  cols: number;
}
export type Renderable = (p: RenderProps) => Rows;

// East-Asian wide chars count as 2 cells; PUA sentinels (used for invisible
// post-processing markers in clanknslop) count as 0. The landing doesn't
// currently use either, but keeping the table makes the primitives drop-in
// safe for future content.
const ZERO_WIDTH = /[-]/g;
const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/g;

export function cellWidth(s: string): number {
  const zw = s.match(ZERO_WIDTH);
  const wide = s.match(WIDE);
  return s.length - (zw ? zw.length : 0) + (wide ? wide.length : 0);
}

export function truncate(s: string, cols: number, ellipsis = "…"): string {
  if (cols <= 0) return "";
  const w = cellWidth(s);
  if (w <= cols) return s;
  const ew = cellWidth(ellipsis);
  if (cols <= ew) return ellipsis.slice(0, cols);
  return s.slice(0, cols - ew) + ellipsis;
}

export function pad(
  s: string,
  cols: number,
  align: "left" | "center" | "right" = "left",
): string {
  if (cols <= 0) return "";
  const w = cellWidth(s);
  if (w === cols) return s;
  if (w > cols) return truncate(s, cols);
  const extra = cols - w;
  if (align === "left") return s + " ".repeat(extra);
  if (align === "right") return " ".repeat(extra) + s;
  const left = Math.floor(extra / 2);
  const right = extra - left;
  return " ".repeat(left) + s + " ".repeat(right);
}

export function wrapText(s: string, cols: number, mode: "word" | "char"): string[] {
  if (cols <= 0) return [];
  if (s === "") return [""];
  if (mode === "char") return wrapChar(s, cols);

  const lines: string[] = [];
  const paragraphs = s.split("\n");
  for (const para of paragraphs) {
    if (para.trim() === "") {
      lines.push("");
      continue;
    }
    const words = para.split(/\s+/).filter(Boolean);
    let current = "";
    for (const word of words) {
      if (cellWidth(word) >= cols) {
        if (current !== "") {
          lines.push(current);
          current = "";
        }
        const wrapped = wrapChar(word, cols);
        for (let i = 0; i < wrapped.length - 1; i++) lines.push(wrapped[i]);
        current = wrapped[wrapped.length - 1] ?? "";
        continue;
      }
      const candidate = current === "" ? word : current + " " + word;
      if (cellWidth(candidate) <= cols) current = candidate;
      else {
        if (current !== "") lines.push(current);
        current = word;
      }
    }
    if (current !== "") lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

function wrapChar(s: string, cols: number): string[] {
  const lines: string[] = [];
  let i = 0;
  while (i < s.length) {
    lines.push(s.slice(i, i + cols));
    i += cols;
  }
  return lines.length > 0 ? lines : [""];
}

export interface TextOpts {
  align?: "left" | "center" | "right";
  wrap?: "word" | "char" | "none";
  maxRows?: number;
}

export function Text(content: string, opts: TextOpts = {}): Renderable {
  const { align = "left", wrap = "word", maxRows } = opts;
  return ({ cols }) => {
    if (cols <= 0) return [];
    let lines: string[];
    if (wrap === "none") lines = content.split("\n").map((l) => truncate(l, cols));
    else lines = content.split("\n").flatMap((para) => wrapText(para, cols, wrap));
    if (maxRows !== undefined && lines.length > maxRows) {
      lines = lines.slice(0, maxRows);
      const last = lines[maxRows - 1] ?? "";
      lines[maxRows - 1] = truncate(pad(last, cols, align), cols);
    }
    return lines.map((l) => pad(l, cols, align));
  };
}

export interface RowOpts {
  weights?: number[];
  gap?: number;
  divider?: string;
}

export function Row(children: Renderable[], opts: RowOpts = {}): Renderable {
  const { weights, gap = 0, divider } = opts;
  return ({ cols }) => {
    if (cols <= 0) return [];
    if (children.length === 0) return [" ".repeat(cols)];

    const n = children.length;
    const dividerWidth = divider !== undefined ? cellWidth(divider) : 0;
    const between = n - 1;
    const separatorCols = between * (gap + dividerWidth + gap);
    const available = Math.max(0, cols - separatorCols);
    const colWidths = allocateWeights(weights ?? Array(n).fill(1), available, n);

    const rendered = children.map((c, i) => c({ cols: colWidths[i] }));
    const height = Math.max(...rendered.map((r) => r.length), 0);

    const rows: string[] = [];
    for (let row = 0; row < height; row++) {
      let line = "";
      for (let ci = 0; ci < n; ci++) {
        const childRows = rendered[ci];
        const w = colWidths[ci];
        const cell = row < childRows.length ? childRows[row] : " ".repeat(w);
        line += cell;
        if (ci < n - 1) {
          line += " ".repeat(gap);
          if (divider !== undefined) line += divider;
          line += " ".repeat(gap);
        }
      }
      rows.push(line);
    }
    if (rows.length === 0) rows.push(" ".repeat(cols));
    return rows;
  };
}

function allocateWeights(weights: number[], available: number, n: number): number[] {
  const total = weights.reduce((a, b) => a + b, 0) || n;
  let remaining = available;
  const widths: number[] = [];
  for (let i = 0; i < n; i++) {
    if (i === n - 1) widths.push(Math.max(0, remaining));
    else {
      const w = Math.max(0, Math.floor((weights[i] / total) * available));
      widths.push(w);
      remaining -= w;
    }
  }
  return widths;
}

export interface ColumnOpts {
  gap?: number;
  divider?: Renderable | string;
}

export function Column(children: Renderable[], opts: ColumnOpts = {}): Renderable {
  const { gap = 0, divider } = opts;
  return ({ cols }) => {
    if (cols <= 0) return [];
    if (children.length === 0) return [];
    const dividerRenderable: Renderable | undefined =
      divider === undefined
        ? undefined
        : typeof divider === "string"
        ? Rule({ char: divider })
        : divider;

    const rows: string[] = [];
    for (let i = 0; i < children.length; i++) {
      if (i > 0) {
        for (let g = 0; g < gap; g++) rows.push(" ".repeat(cols));
        if (dividerRenderable !== undefined) rows.push(...dividerRenderable({ cols }));
      }
      rows.push(...children[i]({ cols }));
    }
    return rows;
  };
}

const BORDERS = {
  single: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
  double: { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" },
  thick: { tl: "┏", tr: "┓", bl: "┗", br: "┛", h: "━", v: "┃" },
  ascii: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" },
} as const;

export interface BoxOpts {
  border?: "single" | "double" | "thick" | "ascii";
  title?: string;
}

export function Box(child: Renderable, opts: BoxOpts = {}): Renderable {
  const { border = "single", title } = opts;
  const b = BORDERS[border];
  return ({ cols }) => {
    if (cols < 2) return child({ cols });
    const innerCols = cols - 2;
    const innerRows = child({ cols: innerCols });

    let topBorder: string;
    if (title !== undefined && title.length > 0) {
      const maxTitleWidth = innerCols - 2;
      const titleStr = maxTitleWidth > 0 ? truncate(title, maxTitleWidth) : "";
      const fillLeft = Math.floor((innerCols - cellWidth(titleStr) - 2) / 2);
      const fillRight = innerCols - cellWidth(titleStr) - 2 - fillLeft;
      topBorder =
        b.tl +
        b.h.repeat(Math.max(0, fillLeft)) +
        " " +
        titleStr +
        " " +
        b.h.repeat(Math.max(0, fillRight)) +
        b.tr;
    } else {
      topBorder = b.tl + b.h.repeat(innerCols) + b.tr;
    }
    const bottomBorder = b.bl + b.h.repeat(innerCols) + b.br;
    return [topBorder, ...innerRows.map((row) => b.v + row + b.v), bottomBorder];
  };
}

export function Spacer(rows = 1): Renderable {
  return ({ cols }) => {
    if (cols <= 0) return [];
    return Array(rows).fill(" ".repeat(cols));
  };
}

export interface RuleOpts {
  char?: string;
  label?: string;
  labelAlign?: "left" | "center" | "right";
}

export function Rule(opts: RuleOpts = {}): Renderable {
  const { char = "─", label, labelAlign = "center" } = opts;
  return ({ cols }) => {
    if (cols <= 0) return [];
    if (label === undefined || label === "") return [char.repeat(cols)];
    const inner = ` ${label} `;
    const innerW = cellWidth(inner);
    if (innerW >= cols) return [truncate(inner, cols)];
    const remaining = cols - innerW;
    if (labelAlign === "left") return [inner + char.repeat(remaining)];
    if (labelAlign === "right") return [char.repeat(remaining) + inner];
    const left = Math.floor(remaining / 2);
    const right = remaining - left;
    return [char.repeat(left) + inner + char.repeat(right)];
  };
}

export function Empty(): Renderable {
  return () => [];
}

// Measure how many monospace character cells fit in `el`'s content box, using
// a hidden probe span styled with the same font. The probe is detached after
// measurement; it must be inside `el` (not document.body) because cell width
// depends on the inherited font-size, font-family, and letter-spacing.
//
// Container width is clamped to the viewport's visible width along the
// element's left edge. Without this, a parent that has been pushed wider than
// the viewport (e.g. by an overflowing sibling like a scene strip) leaks its
// width into the cols calculation, and the rendered text overflows the
// viewport on the right.
export function measureCols(el: HTMLElement): number {
  const probe = document.createElement("span");
  probe.textContent = "M".repeat(100);
  probe.style.cssText =
    "position:absolute;visibility:hidden;display:inline-block;white-space:pre;font-family:inherit;font-size:inherit;letter-spacing:inherit;";
  el.appendChild(probe);
  const cellW = probe.getBoundingClientRect().width / 100;
  el.removeChild(probe);
  if (cellW <= 0) return 0;

  const r = el.getBoundingClientRect();
  const viewportW = document.documentElement.clientWidth;
  const visibleRight = viewportW - Math.max(0, r.left);
  const containerW = Math.min(r.width, Math.max(0, visibleRight));
  return Math.max(0, Math.floor(containerW / cellW));
}

// Render a Renderable into `el` and re-render on resize. Returns a cleanup
// function. The element is treated as a <pre> sink — its textContent is
// replaced with the joined lines.
export function mountAsciiArt(
  el: HTMLElement,
  renderable: Renderable,
  opts: { minCols?: number; maxCols?: number } = {},
): () => void {
  const { minCols = 1, maxCols = Infinity } = opts;
  let lastCols = -1;

  const render = () => {
    const raw = measureCols(el);
    const cols = Math.max(minCols, Math.min(maxCols, raw));
    if (cols === lastCols) return;
    lastCols = cols;
    const lines = renderable({ cols });
    el.textContent = lines.join("\n");
  };

  // ResizeObserver catches parent-driven resizes (e.g. sidebars opening).
  // window 'resize' catches viewport-driven resizes when the parent's width
  // doesn't change (e.g. an overflowing parent that stays wider than the
  // viewport while the viewport itself shrinks — measureCols clamps to the
  // viewport, so the cols value changes even though the parent's width
  // doesn't, and ResizeObserver wouldn't fire).
  const ro = new ResizeObserver(render);
  ro.observe(el);
  window.addEventListener("resize", render);
  render();
  return () => {
    ro.disconnect();
    window.removeEventListener("resize", render);
  };
}
