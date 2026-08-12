import { readFileSync } from "node:fs";
import { parseFont } from "../../../../packages/fonts/src/parseFont.ts";
import { dedupeContour, groupShapes, simplifyContour, signedArea, type Pt } from "../../../../packages/fonts/src/extrude.ts";

const fontPath = process.argv[2] ?? __dirname + "/roboto-700.ttf";
const bytes = readFileSync(fontPath);
const font = parseFont(new Uint8Array(bytes));

for (const ch of ["h", "p", "y", "o"]) {
  const cp = ch.codePointAt(0)!;
  const g = font.glyph(cp, 4);
  console.log(`\n'${ch}': raw contours=${g.contours.length}`);
  g.contours.forEach((c, i) => console.log(`  contour[${i}] points=${c.length} area=${signedArea(c as Pt[]).toFixed(1)}`));

  const scale = 100 / font.unitsPerEm;
  const placed = g.contours.map((c) => dedupeContour(c.map(([x, y]): Pt => [x * scale, y * scale])));
  placed.forEach((c, i) => console.log(`  dedupe[${i}] points=${c.length}`));

  const shapes = groupShapes(placed);
  console.log(`  groupShapes -> ${shapes.length} shape(s)`);
  shapes.forEach((s, i) => console.log(`    shape[${i}] outer=${s.outer.length} holes=${s.holes.map((h) => h.length)}`));

  for (const s of shapes) {
    if (s.holes.length === 0) {
      const simp = simplifyContour(s.outer, 2);
      console.log(`    simplify(outer len ${s.outer.length}) -> ${simp.length}`);
    }
  }
}
