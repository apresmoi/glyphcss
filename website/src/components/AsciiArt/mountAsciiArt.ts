import { type Renderable } from "../../utils/ascii-layout/layout";
import styles from "./AsciiArt.module.css";

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
  probe.className = styles.probe;
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
