// Grid compositing: place each cell's measured mask at its cell offset, sum,
// clamp to 1. Glyph x positions are fractional device px (advances like
// 38.53); each mask was captured at PHASES sub-pixel phases, and a cell uses
// the phase nearest its own fractional offset — what Chromium itself does.

/** Mask top-left (device px) and phase index for cell (col,row). */
export function cellPlacement(fm, col, row, originX, originY) {
  const x = originX + col * fm.cellW;
  let base = Math.floor(x);
  let phase = Math.round((x - base) * fm.nPhases);
  if (phase === fm.nPhases) { phase = 0; base += 1; }
  return [base - fm.padX, Math.round(originY + row * fm.cellH) - fm.padY, phase];
}

/** cells: iterable of {col,row,glyph}. Returns { img: Float32Array (clamped), W, H }. */
export function compositeCells(fm, cells, { originX, originY, W, H }) {
  const img = new Float32Array(W * H);
  for (const { col, row, glyph } of cells) {
    if (glyph === " ") continue;
    const m = fm.masks.get(glyph);
    if (!m) throw new Error(`no mask for ${JSON.stringify(glyph)} in ${fm.face}`);
    const [x0, y0, phase] = cellPlacement(fm, col, row, originX, originY);
    const a = m.phases[phase];
    for (let y = 0; y < m.H; y++) {
      const iy = y0 + y;
      if (iy < 0 || iy >= H) continue;
      const mrow = y * m.W, irow = iy * W;
      for (let x = 0; x < m.W; x++) {
        const v = a[mrow + x];
        if (v === 0) continue;
        const ix = x0 + x;
        if (ix < 0 || ix >= W) continue;
        img[irow + ix] += v;
      }
    }
  }
  for (let i = 0; i < img.length; i++) if (img[i] > 1) img[i] = 1;
  return { img, W, H };
}

export function compositeGrid(fm, grid, frame) {
  const cells = [];
  grid.forEach((r, row) => r.forEach((glyph, col) => cells.push({ col, row, glyph })));
  return compositeCells(fm, cells, frame);
}
