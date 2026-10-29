// Dot geometry: the reference's canvas dots vs the fluid's two atlas faces as real DOM text, in the
// fluid's cell (aspect 1.6, font-size chosen so one advance = one cell, line-height = one
// cell), exactly as createGlyphFluid lays its <pre> out. Three panels, two rows each (the
// second row repeats the first, so ⣿ over ⣿ in column 0 shows the cross-cell spacing):
//   canvas    the reference's render.js rectangles (0.26 × 0.15 cell at 0.3|0.7, 0.14 + 0.24·row)
//   universal core's universal atlas (Menlo/DejaVu braille)
//   dots      core's braille-dots atlas (the fluid's default face)
// dots.mjs screenshots each panel element and hands the PNGs back to window.__analyse.
import {
  ensureGlyphAtlasFontFaceStyles,
  glyphAtlasCodePoint,
  buildGlyphAtlasFontPaletteValuesCss,
  GLYPH_FONT_ATLAS,
  GLYPH_FONT_ATLAS_BRAILLE_DOTS,
  type GlyphFontAtlas,
} from "glyphcss";

const CW = 30, CH = CW * 1.6, ROWS = 2;
const MASKS = [0xff, 0x01, 0x02, 0x04, 0x40, 0x08, 0x80, 0x55, 0xaa, 0x0f, 0xf0, 0x47, 0xb8, 0x3c];
// columns holding ONE left dot each (rows 0..3): a line-shaped face's bottom row spills into
// the next cell and merges with its top row under ⣿, so spacing is read from these
const SINGLE_LEFT = [1, 2, 3, 4];
const DOT = { w: 0.26, h: 0.15 };
const UBITS: Array<[number, number, number]> = [[0x01, 0, 0], [0x02, 0, 1], [0x04, 0, 2], [0x40, 0, 3], [0x08, 1, 0], [0x10, 1, 1], [0x20, 1, 2], [0x80, 1, 3]];
const INK = "#3ccf96";
const DPR = devicePixelRatio;

function canvasPanel(): HTMLCanvasElement {
  const cv = document.createElement("canvas");
  cv.width = CW * MASKS.length * DPR;
  cv.height = CH * ROWS * DPR;
  cv.style.cssText = `width:${CW * MASKS.length}px;height:${CH * ROWS}px;display:block`;
  const g = cv.getContext("2d")!;
  g.scale(DPR, DPR);
  g.fillStyle = "#000";
  g.fillRect(0, 0, CW * MASKS.length, CH * ROWS);
  g.fillStyle = INK;
  for (let r = 0; r < ROWS; r++)
    MASKS.forEach((m, c) => {
      for (const [bit, col, row] of UBITS)
        if (m & bit) {
          const w = DOT.w * CW, h = DOT.h * CH;
          g.fillRect(c * CW + (col ? 0.7 : 0.3) * CW - w / 2, r * CH + (0.14 + 0.24 * row) * CH - h / 2, w, h);
        }
    });
  return cv;
}

function advanceEm(atlas: GlyphFontAtlas): number {
  const s = document.createElement("span");
  s.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:100px "${atlas.family}"`;
  s.textContent = String.fromCodePoint(glyphAtlasCodePoint("⣿", 0, atlas)!).repeat(20);
  document.body.append(s);
  const w = s.getBoundingClientRect().width / 2000;
  s.remove();
  return w;
}

/** The fluid's <pre> for one face: font-size = cell / advance, line-height = cell. */
function domPanel(atlas: GlyphFontAtlas, palette: string): { pre: HTMLPreElement; advance: number } {
  const advance = advanceEm(atlas);
  const pre = document.createElement("pre");
  pre.style.cssText = `margin:0;background:#000;white-space:pre;font-family:"${atlas.family}";font-palette:${palette};font-size:${CW / advance}px;line-height:${CH}px;width:${CW * MASKS.length}px;height:${CH * ROWS}px;font-kerning:none;font-variant-ligatures:none;letter-spacing:0;overflow:hidden`;
  const row = MASKS.map((m) => String.fromCodePoint(glyphAtlasCodePoint(String.fromCharCode(0x2800 + m), 0, atlas)!)).join("");
  pre.textContent = Array(ROWS).fill(row).join("\n");
  return { pre, advance };
}

type Blob = { cx: number; cy: number; w: number; h: number; top: number; bottom: number };

/** Ink blobs (green > 128) of an RGBA image region, in cell units relative to the region. */
function blobs(data: Uint8ClampedArray, W: number, x0: number, x1: number, H: number, scale: number): Blob[] {
  const ink = (x: number, y: number) => data[(y * W + x) * 4 + 1]! > 128;
  const seen = new Uint8Array(W * H), out: Blob[] = [];
  for (let y = 0; y < H; y++)
    for (let x = x0; x < x1; x++) {
      if (seen[y * W + x] || !ink(x, y)) continue;
      let minX = x, maxX = x, minY = y, maxY = y;
      const stack = [[x, y]];
      seen[y * W + x] = 1;
      while (stack.length) {
        const [px, py] = stack.pop()!;
        minX = Math.min(minX, px!); maxX = Math.max(maxX, px!); minY = Math.min(minY, py!); maxY = Math.max(maxY, py!);
        for (const [qx, qy] of [[px! - 1, py!], [px! + 1, py!], [px!, py! - 1], [px!, py! + 1]])
          if (qx! >= x0 && qx! < x1 && qy! >= 0 && qy! < H && !seen[qy! * W + qx!] && ink(qx!, qy!)) (seen[qy! * W + qx!] = 1), stack.push([qx!, qy!]);
      }
      const cwPx = CW * scale, chPx = CH * scale;
      out.push({
        cx: (minX - x0 + maxX - x0 + 1) / 2 / cwPx, cy: (minY + maxY + 1) / 2 / chPx,
        w: (maxX - minX + 1) / cwPx, h: (maxY - minY + 1) / chPx,
        top: minY / chPx, bottom: (maxY + 1) / chPx,
      });
    }
  return out.sort((a, b) => (Math.round(a.cx * 4) - Math.round(b.cx * 4)) || a.cy - b.cy);
}

async function decode(png: string): Promise<ImageData> {
  const img = new Image();
  img.src = `data:image/png;base64,${png}`;
  await img.decode();
  const cv = document.createElement("canvas");
  cv.width = img.width;
  cv.height = img.height;
  const g = cv.getContext("2d")!;
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, img.width, img.height);
}

/**
 * Dot pitch (centre to centre) and edge gap between vertical neighbours inside a cell vs
 * across the cell boundary, from the single-dot columns' top-cell dots (rows 0..3); the
 * next cell's row 0 is row 0 plus one cell.
 */
function spacing(img: ImageData, scale: number) {
  const rows = SINGLE_LEFT.map((c) => {
    const x0 = Math.round(c * CW * scale), x1 = Math.round((c + 1) * CW * scale);
    return blobs(img.data, img.width, x0, x1, img.height, scale).sort((a, b) => a.cy - b.cy)[0]!;
  });
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  return {
    inCellPitch: mean([1, 2, 3].map((r) => rows[r]!.cy - rows[r - 1]!.cy)),
    crossPitch: rows[0]!.cy + 1 - rows[3]!.cy,
    inCellGap: mean([1, 2, 3].map((r) => rows[r]!.top - rows[r - 1]!.bottom)),
    crossGap: rows[0]!.top + 1 - rows[3]!.bottom,
  };
}

async function analyse(pngs: Record<string, string>) {
  const images = Object.fromEntries(await Promise.all(Object.entries(pngs).map(async ([k, v]) => [k, await decode(v)] as const)));
  const ref = images.canvas!;
  const scale = ref.width / (CW * MASKS.length);
  const result: Record<string, unknown> = { scale };
  for (const [name, img] of Object.entries(images)) {
    const cell0 = blobs(img.data, img.width, 0, Math.round(CW * scale), img.height, scale);
    const entry: Record<string, unknown> = { size: [img.width, img.height], dots: cell0, spacing: spacing(img, scale) };
    if (name !== "canvas") {
      // binarised ink per device pixel vs the canvas panel
      let both = 0, either = 0, diff = 0;
      const n = Math.min(img.width * img.height, ref.width * ref.height);
      for (let p = 0; p < n; p++) {
        const a = ref.data[p * 4 + 1]! > 128, b = img.data[p * 4 + 1]! > 128;
        if (a && b) both++;
        if (a || b) either++;
        if (a !== b) diff++;
      }
      entry.pixels = { sameSize: img.width === ref.width && img.height === ref.height, iou: both / either, differing: diff, inked: either };
    }
    result[name] = entry;
  }
  return result;
}

async function main() {
  const ok = await Promise.all([ensureGlyphAtlasFontFaceStyles(document, GLYPH_FONT_ATLAS), ensureGlyphAtlasFontFaceStyles(document, GLYPH_FONT_ATLAS_BRAILLE_DOTS)]);
  if (!ok.every(Boolean)) throw new Error(`atlas fonts unavailable: ${ok}`);
  const style = document.createElement("style");
  style.textContent = buildGlyphAtlasFontPaletteValuesCss("--uni", [INK], GLYPH_FONT_ATLAS) + buildGlyphAtlasFontPaletteValuesCss("--dots", [INK], GLYPH_FONT_ATLAS_BRAILLE_DOTS);
  document.head.append(style);

  const wrap = document.createElement("div");
  wrap.style.cssText = "display:flex;flex-direction:column;gap:10px;padding:16px;background:#000;width:max-content";
  const panel = (label: string, el: HTMLElement) => {
    const box = document.createElement("div");
    box.style.cssText = "display:flex;gap:16px;align-items:center";
    const t = document.createElement("div");
    t.style.cssText = "color:#9cb8ac;font:12px monospace;width:300px";
    t.textContent = label;
    box.append(t, el);
    wrap.append(box);
  };
  const cv = canvasPanel();
  cv.id = "canvas";
  const uni = domPanel(GLYPH_FONT_ATLAS, "--uni");
  uni.pre.id = "universal";
  const dots = domPanel(GLYPH_FONT_ATLAS_BRAILLE_DOTS, "--dots");
  dots.pre.id = "dots";
  panel("reference canvas (render.js rects)", cv);
  panel(`DOM, universal atlas (adv ${uni.advance.toFixed(3)} em)`, uni.pre);
  panel(`DOM, braille-dots atlas (adv ${dots.advance.toFixed(3)} em)`, dots.pre);
  const note = document.createElement("div");
  note.style.cssText = "color:#9cb8ac;font:12px monospace";
  note.textContent = `cell ${CW} × ${CH} px (aspect 1.6), two rows; font-size = cell / advance, line-height = cell`;
  wrap.append(note);
  document.body.append(wrap);
  await document.fonts.ready;
  const w = window as unknown as Record<string, unknown>;
  w.__analyse = analyse;
  w.__dots = { advance: { universal: uni.advance, dots: dots.advance }, cell: { w: CW, h: CH }, dpr: DPR };
}
(window as unknown as Record<string, unknown>).__dotsReady = main();
