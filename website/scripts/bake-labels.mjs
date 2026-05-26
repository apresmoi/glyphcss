// Extract country labels from the GADM geodatabase into a small JSON the
// flatmap renders as hotspot <div>s. For each country (NAME_0) we compute an
// area-weighted center of its features' bounding boxes (robust enough for a
// label anchor; avoids loading full polygon geometry) and project it to the
// same Web Mercator plane the tiles use.
//
// Usage: node website/scripts/bake-labels.mjs
//
// gdal-async is intentionally NOT a package.json dependency — it's a heavy
// native GIS lib only this one-off bake needs, and shipping it would drag it
// into every CI install. Install it transiently to run this script:
//   pnpm --dir website add -D gdal-async && node website/scripts/bake-labels.mjs

import gdal from "gdal-async";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "../..");
const GDB = path.join(REPO, "gadm_410.gdb");
const OUT = path.join(REPO, "website/public/data/flatmap/labels.json");

const MERC_MAX = 85.0511;
// lat/lon → Mercator plane (matches flatToPlane in bake-globe.mjs).
function toPlane(lat, lon) {
  const c = Math.max(-MERC_MAX, Math.min(MERC_MAX, lat));
  const mercY = Math.log(Math.tan(Math.PI / 4 + (c * Math.PI) / 360)) / Math.PI;
  return [-mercY, lon / 180];
}

const ds = gdal.open(GDB);
const layer = ds.layers.get(0);
const total = layer.features.count();
console.log(`GADM features: ${total}`);

// Per-country accumulator: area-weighted sum of true polygon CENTROIDS (not
// bbox centers — those drift toward empty corners for L-shaped / archipelago
// nations). Weighting by real polygon area pulls the label to the country's
// land center of mass.
const acc = new Map(); // GID_0 → { name, sx, sy, w }
let i = 0;
layer.features.forEach((f) => {
  i++;
  if (i % 50000 === 0) console.log(`  ${i}/${total}…`);
  const gid = f.fields.get("GID_0");
  const name = f.fields.get("NAME_0");
  if (!gid || !name) return;
  let g, c, area;
  try {
    g = f.getGeometry();
    if (!g) return;
    c = g.centroid();          // true polygon centroid (Point)
    area = Math.max(1e-9, g.getArea()); // sq degrees — weight
  } catch { return; }
  const cx = c.x, cy = c.y; // lon, lat
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
  let a = acc.get(gid);
  if (!a) { a = { name, sx: 0, sy: 0, w: 0 }; acc.set(gid, a); }
  a.sx += cx * area; a.sy += cy * area; a.w += area;
});

const labels = [];
for (const { name, sx, sy, w } of acc.values()) {
  const lon = sx / w, lat = sy / w;
  const [x, y] = toPlane(lat, lon);
  labels.push({
    name,
    // Mercator plane coords (flatmap) + raw lat/lon (globe / other projections).
    x: Math.round(x * 1e4) / 1e4,
    y: Math.round(y * 1e4) / 1e4,
    lat: Math.round(lat * 1e3) / 1e3,
    lon: Math.round(lon * 1e3) / 1e3,
    // Country size (sqrt of summed area) for label priority/zoom.
    w: Math.round(Math.sqrt(w) * 1e3) / 1e3,
  });
}
labels.sort((a, b) => b.w - a.w); // biggest countries first

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(labels));
const stat = await fs.stat(OUT);
console.log(`Wrote ${OUT} — ${labels.length} country labels, ${(stat.size / 1024).toFixed(1)} KB`);
console.log("sample:", labels.slice(0, 6).map((l) => l.name).join(", "));
