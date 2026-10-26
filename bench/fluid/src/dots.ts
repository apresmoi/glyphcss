// Dot geometry: molty's canvas dots vs core's braille atlas glyphs, in the fluid's cell
// (aspect 1.6, font-size chosen so one advance = one cell, line-height = one cell).
// Left: the canvas renderer's rectangles. Right: the atlas glyphs as DOM text in a <pre>.
// window.__dots reports, per dot of ⣿, the centre and size as cell fractions for both.
import { ensureGlyphAtlasFontFaceStyles, glyphAtlasCodePoint, GLYPH_FONT_ATLAS, buildGlyphAtlasFontPaletteValuesCss } from "glyphcss";

const CW = 30, CH = CW * 1.6;
const MASKS = [0xff, 0x01, 0x08, 0x40, 0x80, 0x55, 0xaa, 0x0f, 0xf0, 0x47, 0xb8, 0x3c];
const DOT = { w: 0.26, h: 0.15 };
const UBITS: Array<[number, number, number]> = [[0x01, 0, 0], [0x02, 0, 1], [0x04, 0, 2], [0x40, 0, 3], [0x08, 1, 0], [0x10, 1, 1], [0x20, 1, 2], [0x80, 1, 3]];
const FAMILY = GLYPH_FONT_ATLAS.family;

function canvasPanel(): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = CW * MASKS.length;
  cv.height = CH;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#000";
  g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = "#3ccf96";
  MASKS.forEach((m, c) => {
    for (const [bit, col, row] of UBITS)
      if (m & bit) {
        const w = DOT.w * CW, h = DOT.h * CH;
        g.fillRect(c * CW + (col ? 0.7 : 0.3) * CW - w / 2, (0.14 + 0.24 * row) * CH - h / 2, w, h);
      }
  });
  return cv;
}

function advanceEm(): number {
  const s = document.createElement("span");
  s.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:100px "${FAMILY}"`;
  s.textContent = String.fromCodePoint(glyphAtlasCodePoint("⣿", 0)!).repeat(20);
  document.body.append(s);
  const w = s.getBoundingClientRect().width / 2000;
  s.remove();
  return w;
}

/** Bounding boxes of the ink blobs in a 1-cell canvas, as cell fractions, sorted by column then row. */
function blobs(cv: HTMLCanvasElement, x0: number) {
  const g = cv.getContext("2d")!;
  const { data } = g.getImageData(x0, 0, CW, CH);
  const seen = new Uint8Array(CW * CH), out: Array<{ cx: number; cy: number; w: number; h: number }> = [];
  const ink = (i: number) => data[i * 4 + 1]! > 60;
  for (let i = 0; i < CW * CH; i++) {
    if (seen[i] || !ink(i)) continue;
    let minX = CW, minY = CH, maxX = 0, maxY = 0;
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!, x = p % CW, y = (p / CW) | 0;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const q of [p - 1, p + 1, p - CW, p + CW]) if (q >= 0 && q < CW * CH && !seen[q] && ink(q) && Math.abs((q % CW) - x) <= 1) (seen[q] = 1), stack.push(q);
    }
    out.push({ cx: (minX + maxX + 1) / 2 / CW, cy: (minY + maxY + 1) / 2 / CH, w: (maxX - minX + 1) / CW, h: (maxY - minY + 1) / CH });
  }
  return out.sort((a, b) => (Math.round(a.cx * 4) - Math.round(b.cx * 4)) || a.cy - b.cy);
}

async function main() {
  await ensureGlyphAtlasFontFaceStyles(document, GLYPH_FONT_ATLAS);
  await document.fonts.load(`20px "${FAMILY}"`, String.fromCodePoint(GLYPH_FONT_ATLAS.puaStart));
  const adv = advanceEm(), fs = CW / adv;
  const style = document.createElement("style");
  style.textContent = buildGlyphAtlasFontPaletteValuesCss("--dots", ["#3ccf96"]);
  document.head.append(style);

  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:24px;align-items:flex-start;padding:16px;background:#000";
  const left = canvasPanel();
  const pre = document.createElement("pre");
  pre.style.cssText = `margin:0;background:#000;font-family:"${FAMILY}";font-palette:--dots;font-size:${fs}px;line-height:${CH}px;width:${CW * MASKS.length}px;height:${CH}px;font-kerning:none;letter-spacing:0`;
  pre.textContent = MASKS.map((m) => String.fromCodePoint(glyphAtlasCodePoint(String.fromCharCode(0x2800 + m), 0)!)).join("");
  // the same glyphs into a canvas on the CSS line box (half-leading), for blob measurement
  const right = document.createElement("canvas");
  right.width = CW;
  right.height = CH;
  const g = right.getContext("2d")!;
  g.font = `${fs}px "${FAMILY}"`;
  const m = g.measureText(String.fromCodePoint(glyphAtlasCodePoint("⣿", 0)!));
  const asc = m.fontBoundingBoxAscent, desc = m.fontBoundingBoxDescent;
  g.fillStyle = "#000";
  g.fillRect(0, 0, CW, CH);
  g.fillText(String.fromCodePoint(glyphAtlasCodePoint("⣿", 0)!), 0, (CH - (asc + desc)) / 2 + asc);
  const labels = document.createElement("div");
  labels.style.cssText = "color:#9cb8ac;font:12px monospace;padding:0 16px;background:#000";
  labels.textContent = "left: molty canvas dots (0.26 × 0.15 cell rects)   right: glyphcss atlas braille as DOM text — cell 30 × 48 px (aspect 1.6)";
  row.append(left, pre);
  document.body.append(labels, row);
  const canvasDots = blobs(left, 0), atlasDots = blobs(right, 0);
  (window as unknown as Record<string, unknown>).__dots = {
    advanceEm: adv, fontSize: fs, lineBox: (asc + desc) / fs, cell: { w: CW, h: CH },
    canvas: canvasDots, atlas: atlasDots,
  };
}
(window as unknown as Record<string, unknown>).__dotsReady = main();
