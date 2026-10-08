import type { GUI } from "lil-gui";
import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TEXTURES, texUrl, type Bezier4, type LeftValues } from "../../../features/wordart/model/parameters";
import { ActionButton } from "../../ActionButton";
import { useColor, useDockGui, useDockSlot, useFolder, useOption, useSlider, useToggle } from "../../Dock";
import { IconToggle } from "../../IconToggle";
import { ALIGN_OPTS, CASE_OPTS, FACE_FILL_OPTS, FILL_OPTS, WEIGHT_OPTS } from "../options";

/**
 * Custom widgets injected into a Dock folder via `useDockSlot` — the same
 * portal seam `/synth`'s `SynthDock` uses for its oscilloscope, and the same
 * pattern the right-hand `WordArtDock` uses for its bezier editor. Segmented
 * button groups (Case/Align), the bundled-texture swatch grid, and the image
 * upload button have no lil-gui equivalent, so they render as plain React
 * into a slot `<div>` lil-gui reserves for arbitrary content. Kept as real
 * lil-gui folder controllers (not bespoke HTML inputs) for everything else so
 * the left rail's composition controls are pixel-identical to the right
 * Dock's — same checkbox brackets, same slider brackets, same select chevron.
 */
interface SegmentedGroup {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; title: string }[];
}

function SegmentedGroupRow({ label, value, onChange, options }: SegmentedGroup) {
  return (
    <div className="dock-toggle-row">
      <span className="dock-toggle-row-label">{label}</span>
      <IconToggle
        groupLabel={label}
        value={value}
        onChange={onChange}
        options={options.map((option) => ({ value: option.value, icon: option.label, label: option.title }))}
      />
    </div>
  );
}

/** Both segmented fields share the standard Dock label and control columns. */
function useSegmentedDuoSlot(folder: GUI | null, a: SegmentedGroup, b: SegmentedGroup): ReactNode {
  const host = useDockSlot(folder, { position: "bottom", className: "wa-widget-slot" });
  if (!host) return null;
  return createPortal(
    <div className="wa-seg-duo">
      <SegmentedGroupRow {...a} />
      <SegmentedGroupRow {...b} />
    </div>,
    host,
  );
}

function useTextureGridSlot(
  folder: GUI | null,
  value: string,
  onChange: (v: string) => void,
  visible: boolean,
): ReactNode {
  const host = useDockSlot(folder, { position: "bottom", className: "wa-widget-slot" });
  if (!host) return null;
  return createPortal(
    <div className="wa-texrow" hidden={!visible}>
      <div className="wa-texgrid">
        {TEXTURES.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`wa-texgrid__sw${t.id === value ? " is-on" : ""}`}
            title={t.label}
            style={{ backgroundImage: `url(${texUrl(t.id)})` }}
            onClick={() => onChange(t.id)}
          />
        ))}
      </div>
    </div>,
    host,
  );
}

function useImageUploadSlot(folder: GUI | null, visible: boolean, onChange: (dataUrl: string) => void): ReactNode {
  const host = useDockSlot(folder, { position: "bottom", className: "wa-widget-slot" });
  const inputRef = useRef<HTMLInputElement>(null);
  if (!host) return null;
  return createPortal(
    <div className="wa-imgrow" hidden={!visible}>
      <ActionButton type="button" className="wa-imgbtn" onClick={() => inputRef.current?.click()}>
        Choose image…
      </ActionButton>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => onChange(String(reader.result));
          reader.readAsDataURL(file);
        }}
      />
    </div>,
    host,
  );
}

/**
 * Left rail — the word's composition: Typography (weight/style/case/align/
 * spacing) and Color (front/sides/back/outline). Mounted as its OWN `<Dock>`
 * instance (own `useGui`, own lil-gui root) inside the left rail instead of
 * the shared right-hand Dock, so it renders with the identical row styling
 * (checkbox, slider, select, color swatch) while staying visually separate
 * from the 3D/scene knobs on the right.
 */
export function WordArtRailControls({
  left,
  setLeft,
}: {
  left: LeftValues;
  setLeft: (k: keyof LeftValues, v: number | string | boolean) => void;
}): ReactNode {
  const dock = useDockGui();

  // ── Typography ────────────────────────────────────────────────────────
  const typeFolder = useFolder(dock, "Typography", { open: true });
  useOption(typeFolder, "Weight", WEIGHT_OPTS, left.weight, (v) => setLeft("weight", v));
  useToggle(typeFolder, "Italic", left.italic, (v) => setLeft("italic", v));
  useToggle(typeFolder, "Underline", left.underline, (v) => setLeft("underline", v));
  useToggle(typeFolder, "Strikethrough", left.strike, (v) => setLeft("strike", v));
  const caseAlignSlot = useSegmentedDuoSlot(
    typeFolder,
    { label: "Case", value: left.textCase, onChange: (v) => setLeft("textCase", v), options: CASE_OPTS },
    { label: "Align", value: left.align, onChange: (v) => setLeft("align", v), options: ALIGN_OPTS },
  );
  useSlider(typeFolder, "Letter spacing", { min: -20, max: 60, step: 1 }, left.letterSpacing, (v) =>
    setLeft("letterSpacing", v),
  );
  useSlider(typeFolder, "Line height", { min: 0.8, max: 2.5, step: 0.05 }, left.lineHeight, (v) =>
    setLeft("lineHeight", v),
  );

  // ── Color ─────────────────────────────────────────────────────────────
  const colorFolder = useFolder(dock, "Color", { open: true });
  useOption(colorFolder, "Front", FILL_OPTS, left.fillType, (v) => setLeft("fillType", v));
  const frontColorCtrl = useColor(colorFolder, "Color", left.color, (v) => setLeft("color", v));
  const gradACtrl = useColor(colorFolder, "Color A", left.gradA, (v) => setLeft("gradA", v));
  const gradBCtrl = useColor(colorFolder, "Color B", left.gradB, (v) => setLeft("gradB", v));
  const gradAngleCtrl = useSlider(colorFolder, "Angle", { min: 0, max: 360, step: 5 }, left.gradAngle, (v) =>
    setLeft("gradAngle", v),
  );
  const imageSlot = useImageUploadSlot(colorFolder, left.fillType === "image", (v) => setLeft("image", v));
  const frontTexSlot = useTextureGridSlot(
    colorFolder,
    left.faceTex,
    (v) => setLeft("faceTex", v),
    left.fillType === "texture",
  );

  useOption(colorFolder, "Sides", FACE_FILL_OPTS, left.sideFill, (v) => setLeft("sideFill", v));
  const sideColorCtrl = useColor(colorFolder, "Side color", left.sideColor, (v) => setLeft("sideColor", v));
  const sideTexSlot = useTextureGridSlot(
    colorFolder,
    left.sideTex,
    (v) => setLeft("sideTex", v),
    left.sideFill === "texture",
  );

  useOption(colorFolder, "Back", FACE_FILL_OPTS, left.backFill, (v) => setLeft("backFill", v));
  const backColorCtrl = useColor(colorFolder, "Back color", left.backColor, (v) => setLeft("backColor", v));
  const backTexSlot = useTextureGridSlot(
    colorFolder,
    left.backTex,
    (v) => setLeft("backTex", v),
    left.backFill === "texture",
  );

  useToggle(colorFolder, "Outline", left.outlineOn, (v) => setLeft("outlineOn", v));
  const outlineColorCtrl = useColor(colorFolder, "Outline color", left.outlineColor, (v) => setLeft("outlineColor", v));
  const outlineWidthCtrl = useSlider(
    colorFolder,
    "Outline width",
    { min: 0.5, max: 12, step: 0.5 },
    left.outlineWidth,
    (v) => setLeft("outlineWidth", v),
  );

  // ── Conditional show/hide + enable/disable ───────────────────────────
  useEffect(() => {
    const grad = left.fillType === "gradient";
    frontColorCtrl?.setVisible(left.fillType === "solid");
    gradACtrl?.setVisible(grad);
    gradBCtrl?.setVisible(grad);
    gradAngleCtrl?.setVisible(grad || left.fillType === "rainbow");
    sideColorCtrl?.setVisible(left.sideFill === "solid");
    backColorCtrl?.setVisible(left.backFill === "solid");
    // Outline color/width stay MOUNTED (not hidden) — the "Outline" toggle
    // above them already names the section, so hiding+re-showing them under
    // a second "Outline" label would read as a redundant repeat. Grey them
    // out via the same disabled treatment lil-gui gives any dependent row.
    outlineColorCtrl?.setEnabled(left.outlineOn);
    outlineWidthCtrl?.setEnabled(left.outlineOn);
  }, [
    frontColorCtrl,
    gradACtrl,
    gradBCtrl,
    gradAngleCtrl,
    sideColorCtrl,
    backColorCtrl,
    outlineColorCtrl,
    outlineWidthCtrl,
    left.fillType,
    left.sideFill,
    left.backFill,
    left.outlineOn,
  ]);

  return (
    <>
      {caseAlignSlot}
      {imageSlot}
      {frontTexSlot}
      {sideTexSlot}
      {backTexSlot}
    </>
  );
}

/** One coordinate of a cubic Bézier P0..P3 at parameter t. */
function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const m = 1 - t;
  return m * m * m * p0 + 3 * m * m * t * p1 + 3 * m * t * t * p2 + t * t * t * p3;
}

/**
 * Mount a draggable cubic-bezier editor (the CSS easing curve) into `parent`.
 * P0=(0,0) and P3=(1,1) are fixed; the two control handles drive `setB`.
 * Returns a `redraw()` to resync the SVG when the value changes elsewhere.
 */
function mountBezierEditor(parent: HTMLElement, getB: () => Bezier4, setB: (b: Bezier4) => void): () => void {
  const NS = "http://www.w3.org/2000/svg";
  const W = 220,
    H = 150,
    pad = 16;
  const X = (x: number) => pad + x * (W - 2 * pad);
  const Y = (y: number) => H - pad - y * (H - 2 * pad);
  const el = (n: string, a: Record<string, string>) => {
    const e = document.createElementNS(NS, n);
    for (const k in a) e.setAttribute(k, a[k]);
    return e;
  };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "wa-bez" });
  const frame = el("rect", {
    x: `${X(0)}`,
    y: `${Y(1)}`,
    width: `${W - 2 * pad}`,
    height: `${H - 2 * pad}`,
    class: "wa-bez__frame",
  });
  const diag = el("line", { x1: `${X(0)}`, y1: `${Y(0)}`, x2: `${X(1)}`, y2: `${Y(1)}`, class: "wa-bez__diag" });
  const l1 = el("line", { class: "wa-bez__leg" });
  const l2 = el("line", { class: "wa-bez__leg" });
  const curve = el("path", { class: "wa-bez__curve" });
  const h1 = el("circle", { r: "5", class: "wa-bez__h" });
  const h2 = el("circle", { r: "5", class: "wa-bez__h" });
  svg.append(frame, diag, l1, l2, curve, h1, h2);
  parent.appendChild(svg);

  // `drawB` is the editor's live value; the SVG follows it every move (cheap),
  // but the mesh re-extrude (`setB`) is debounced so dragging stays smooth.
  let drawB: Bezier4 = getB();
  let active = 0;
  let timer = 0;
  const commit = (now: boolean) => {
    clearTimeout(timer);
    if (now) setB(drawB);
    else timer = window.setTimeout(() => setB(drawB), 130);
  };
  const render = () => {
    const [x1, y1, x2, y2] = drawB;
    let d = `M ${X(0)} ${Y(0)}`;
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      d += ` L ${X(cubicAt(0, x1, x2, 1, t))} ${Y(cubicAt(0, y1, y2, 1, t))}`;
    }
    curve.setAttribute("d", d);
    l1.setAttribute("x1", `${X(0)}`);
    l1.setAttribute("y1", `${Y(0)}`);
    l1.setAttribute("x2", `${X(x1)}`);
    l1.setAttribute("y2", `${Y(y1)}`);
    l2.setAttribute("x1", `${X(1)}`);
    l2.setAttribute("y1", `${Y(1)}`);
    l2.setAttribute("x2", `${X(x2)}`);
    l2.setAttribute("y2", `${Y(y2)}`);
    h1.setAttribute("cx", `${X(x1)}`);
    h1.setAttribute("cy", `${Y(y1)}`);
    h2.setAttribute("cx", `${X(x2)}`);
    h2.setAttribute("cy", `${Y(y2)}`);
  };

  const toData = (ev: PointerEvent): [number, number] => {
    const r = svg.getBoundingClientRect();
    const x = (((ev.clientX - r.left) / r.width) * W - pad) / (W - 2 * pad);
    const y = (H - pad - ((ev.clientY - r.top) / r.height) * H) / (H - 2 * pad);
    return [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y))];
  };
  const move = (ev: PointerEvent) => {
    if (!active) return;
    const [x, y] = toData(ev);
    drawB = [...drawB] as Bezier4;
    if (active === 1) {
      drawB[0] = x;
      drawB[1] = y;
    } else {
      drawB[2] = x;
      drawB[3] = y;
    }
    render();
    commit(false);
  };
  const start = (handle: number, e: PointerEvent, target: SVGElement) => {
    active = handle;
    drawB = [...getB()] as Bezier4;
    target.setPointerCapture(e.pointerId);
  };
  h1.addEventListener("pointerdown", (e) => start(1, e as PointerEvent, h1 as SVGElement));
  h2.addEventListener("pointerdown", (e) => start(2, e as PointerEvent, h2 as SVGElement));
  svg.addEventListener("pointermove", move as EventListener);
  svg.addEventListener("pointerup", () => {
    if (active) {
      active = 0;
      commit(true);
    }
  });
  render();
  // External redraw (state changed elsewhere) — adopt it only when not dragging.
  return () => {
    if (!active) drawB = getB();
    render();
  };
}

/**
 * Custom widget injected into the Shape folder via `useDockSlot` — the same
 * portal seam `/synth`'s `SynthDock` uses for its oscilloscope. The draggable
 * bezier curve editor has no lil-gui equivalent, so it renders as plain React
 * into a slot `<div>` lil-gui reserves for arbitrary content, positioned by
 * hook-call order relative to the surrounding `use*` controllers in the same
 * folder.
 */
export function useBezierEditorSlot(
  folder: GUI | null,
  visible: boolean,
  bezier: Bezier4,
  onBezier: (b: Bezier4) => void,
): ReactNode {
  const host = useDockSlot(folder, { position: "bottom", className: "wa-widget-slot" });
  const bezierRef = useRef(bezier);
  bezierRef.current = bezier;
  const onBezierRef = useRef(onBezier);
  onBezierRef.current = onBezier;
  const redrawRef = useRef<() => void>(() => {});
  const mount = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    el.innerHTML = "";
    redrawRef.current = mountBezierEditor(
      el,
      () => bezierRef.current,
      (b) => onBezierRef.current(b),
    );
  }, []);
  useEffect(() => {
    redrawRef.current();
  }, [bezier]);
  if (!host) return null;
  return createPortal(<div className="wa-bezwrap" ref={mount} hidden={!visible} />, host);
}
