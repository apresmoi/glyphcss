// Text targets in a real browser: a wrapped heading, an explicit <br>, centred text and a
// nested span in another font. Every word's laid-out rect must carry ink, and no ink may
// fall outside the words (dilated by one cell).
import { GlyphFluidTargets, createGlyphFluidTargetFrame } from "@glyphcss/fluid";

const LAYOUT = { cw: 6, ch: 9.6, originX: 0, originY: 0 };
document.body.innerHTML = `
  <h1 id="a" style="width:260px;font:700 44px/1.1 sans-serif;margin:20px">liquid ascii creatures wrap here</h1>
  <p id="b" style="font:24px monospace;margin:20px">one line<br>second line</p>
  <h2 id="c" style="width:500px;text-align:center;font:600 32px serif;margin:20px">centred <span style="font:italic 32px monospace">mixed</span> words</h2>`;

function check(el: HTMLElement) {
  const impl = GlyphFluidTargets.text(el).create({ fieldColor: () => [1, 1, 1] });
  impl.measure(LAYOUT);
  const b = impl.box()!;
  const cols = b.i0 + b.w + 2, rows = b.j0 + b.h + 2;
  const f = createGlyphFluidTargetFrame(cols, rows);
  impl.write(f, 0, 1);
  const word = new Uint8Array(cols * rows);
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let words = 0, inked = 0;
  for (let n = walker.nextNode(); n; n = walker.nextNode())
    for (const m of (n.textContent ?? "").matchAll(/\S+/g)) {
      range.setStart(n, m.index!);
      range.setEnd(n, m.index! + m[0].length);
      const r = range.getClientRects()[0]!;
      const i0 = Math.floor(r.left / LAYOUT.cw), i1 = Math.ceil(r.right / LAYOUT.cw), j0 = Math.floor(r.top / LAYOUT.ch), j1 = Math.ceil(r.bottom / LAYOUT.ch);
      let ink = 0;
      for (let j = j0 - 1; j <= j1; j++) for (let i = i0 - 1; i <= i1; i++) if (i >= 0 && j >= 0 && i < cols && j < rows) {
        word[j * cols + i] = 1;
        if (j >= j0 && j < j1 && i >= i0 && i < i1) ink = Math.max(ink, f.T[j * cols + i]!);
      }
      words++;
      if (ink > 0.3) inked++;
    }
  let stray = 0;
  for (let k = 0; k < cols * rows; k++) if (f.T[k]! > 0.05 && !word[k]) stray++;
  return { id: el.id, words, inked, stray };
}

(window as unknown as Record<string, unknown>).__text = document.fonts.ready.then(() =>
  ["a", "b", "c"].map((id) => check(document.getElementById(id)!)),
);
