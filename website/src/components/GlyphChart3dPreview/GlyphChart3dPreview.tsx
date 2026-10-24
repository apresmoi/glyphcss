import {
  GLYPH_CHART_3D_DEFAULT_CAMERA,
  renderGlyphChart3d,
  type GlyphChart3dMark,
  type GlyphChart3dRenderOptions,
} from "@glyphcss/charts/3d";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import styles from "./GlyphChart3dPreview.module.css";

// Degrees of orbit per CSS pixel dragged.
const DRAG_DEGREES = 0.5;

/** Re-renders the docs example's static frame at the dragged turntable angle.
 *  Re-running the same `renderGlyphChart3d` call as the build keeps size,
 *  axis labels and colour key identical to the no-JS frame at every angle;
 *  a live scene would project with measured cells and drop the key. */
/** HTML for one frame; `color: "none"` frames carry text only. */
export function glyphChart3dFrameHtml(result: { html?: string; text: string }) {
  return result.html ?? result.text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function GlyphChart3dPreview({
  mark,
  options,
  crop,
  initialHtml,
}: {
  mark: GlyphChart3dMark;
  options: GlyphChart3dRenderOptions;
  /** Ink bounds over a full turn: rows are sliced here, columns cropped in CSS. */
  crop: { top: number; bottom: number; indent: number; cols: number };
  initialHtml: string;
}) {
  const [html, setHtml] = useState(initialHtml);
  const start = useRef(options.camera ?? GLYPH_CHART_3D_DEFAULT_CAMERA);
  const angle = useRef({ rotX: start.current.rotX ?? 0, rotY: start.current.rotY ?? 0 });
  const drag = useRef<{ x: number; y: number; rotX: number; rotY: number } | undefined>(undefined);
  const frame = useRef(0);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  function paint() {
    frame.current = 0;
    // The build resolves one zoom that fits every angle; keep it so the size holds.
    const camera = { ...options.camera, rotX: angle.current.rotX, rotY: angle.current.rotY };
    const next = glyphChart3dFrameHtml(renderGlyphChart3d(mark, { ...options, camera }));
    setHtml(next.split("\n").slice(crop.top, crop.bottom).join("\n"));
  }
  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, ...angle.current };
  }
  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const from = drag.current;
    if (!from) return;
    // Turntable: the tilt stays where the chart was authored.
    angle.current = { rotX: from.rotX, rotY: from.rotY + (event.clientX - from.x) * DRAG_DEGREES };
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  }
  function onPointerUp() {
    drag.current = undefined;
  }

  return (
    <div
      className={styles.root}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="img"
      aria-label="3D chart; drag to rotate"
    >
      <div className={styles.crop} style={{ "--ink-cols": crop.cols, "--ink-indent": crop.indent } as CSSProperties}>
        <pre className="glyph-docs-output" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      <p className={styles.hint}>drag to rotate</p>
    </div>
  );
}
