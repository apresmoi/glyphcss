// Prepare the four STATIC datasets `/maps`'s Datasets card mounts, from a
// local checkout of https://github.com/bilawalsidhu/gods-eye-view.
//
//   node website/scripts/prepare-static-datasets.mjs --source /path/to/gods-eye-view
//
// Output goes to `website/public/data/{datacenters,dams,submarine-cables,
// natural-earth}/`. Every file is COMMITTED, for the reason `.gitignore`
// spells out for `geo-tiles/`: nothing bakes data at deploy time, so a
// gitignored dataset is a 404.
//
// ── WHY THESE FILES LIVE UNDER `website/`, AND NOT UNDER `packages/` ───────
//
// `submarine-cables/` is TeleGeography's Submarine Cable Map under
// **CC BY-NC-SA 3.0** — NON-COMMERCIAL and SHARE-ALIKE. Every package in this
// monorepo is MIT and published to npm; a CC BY-NC-SA file inside one would
// re-license under terms the package cannot grant and would put a
// non-commercial restriction on a commercially-usable library. It therefore
// never enters `packages/`, and its directory carries its OWN `LICENSE` and
// `README.md` so the repo-root MIT cannot be read as covering it. The other
// three are here for symmetry rather than obligation: the ODbL sets could
// live anywhere, and Natural Earth is public domain.
//
// Nothing in `@glyphcss/maps` is touched by any of this. The four datasets
// mount through the widget's EXISTING static-source path
// (`GlyphMapVectorFeatureCollection`, `vector/types.ts`) — points, lines and
// polygons in shapes the `circle`, `symbol`, `line` and `fill` layers already
// render. No package machinery was added, so there is nothing package-side
// for a licence to leak into.
//
// ── WHAT EACH DATASET IS TURNED INTO, AND WHY ─────────────────────────────
//
// **Datacenters and dams are COLLAPSED TO POINTS.** Both arrive as OSM
// extracts that are overwhelmingly BUILDING FOOTPRINTS — 3,509 of 4,351
// datacenters and 688 of 704 dams are `Polygon`. A footprint is a few dozen
// metres across; at `/maps`'s widest span one output cell is ~2.6 degrees,
// i.e. ~290 km, so every one of those polygons is four orders of magnitude
// below one character and renders as nothing at all. Even at a city span
// (0.06 degrees over 140 columns, ~48 m/cell) a data hall is one or two
// cells. The thing a reader can actually see is a MARKER, so each feature is
// reduced to one representative point — the area-weighted centroid of its
// largest ring — and mounts as `circle`/`symbol`. It is also what makes the
// files small: 2.56 MB of footprints become ~4,351 coordinates.
//
// **Cables keep their real geometry.** A submarine cable is a line thousands
// of kilometres long; it is legible at every span the page offers and is the
// one dataset here whose shape IS the point of it.
//
// **Natural Earth regions keep their polygons**, at the curation the upstream
// snapshot already applied (0.01-degree Douglas-Peucker, 3 decimals, outer
// rings only — recorded in each source file's own `meta.curation`). They are
// NOT re-simplified here: that would be this script's judgement against the
// source's, with no measurement of what it costs, and the layer's own cost
// lever is that the row is off by default and the file is fetched only when
// it is switched on.
//
// ── COORDINATE PRECISION ──────────────────────────────────────────────────
//
// The OSM extracts carry up to 9 decimals and TeleGeography up to 15 — raw
// float64 export artefacts, not measurements. Points are written at 4 (~11 m,
// which places a marker inside its own building) and lines at 3 (~110 m, the
// precision Natural Earth itself curated to, and ~1/25th of a cell at a 1-
// degree span). Rounding is applied BEFORE the duplicate-vertex drop below,
// so a line that was oversampled collapses rather than carrying repeated
// identical vertices.
//
// ── THE ANTIMERIDIAN ──────────────────────────────────────────────────────
//
// A polyline whose consecutive vertices jump the seam is a 360-degree-wide
// bar sweeping the whole world backwards when read as a planar segment, which
// is what the stroke stamper does (`@glyphcss/maps`' `glyphMapSplitAtAnti-
// meridian` documents the failure and the sources that produce it). The bake
// pipeline splits at bake time; a STATIC collection has no bake, so the split
// happens HERE, through that same exported helper rather than a second
// implementation of the same rule. Cables span the full +/-180 range, so this
// is load-bearing rather than defensive.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { glyphMapSplitAtAntimeridian } from "@glyphcss/maps";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_ROOT = path.resolve(HERE, "../public/data");

const args = process.argv.slice(2);
const sourceArg = args.indexOf("--source");
const SOURCE = path.resolve(
  sourceArg >= 0 && args[sourceArg + 1]
    ? args[sourceArg + 1]
    : process.env.GODS_EYE_VIEW ?? "../gods-eye-view",
);
const LOCAL = path.join(SOURCE, "src/data/local_data");

/** Points at ~11 m, lines and polygons at ~110 m — see the precision note above. */
const POINT_DECIMALS = 4;
const LINE_DECIMALS = 3;

const round = (v, decimals) => Number(v.toFixed(decimals));

/**
 * Round a ring/line and drop vertices the rounding made identical to their
 * predecessor. A two-point result is kept (a real segment); anything shorter
 * is dropped by the caller.
 */
function quantize(points, decimals) {
  const out = [];
  for (const [lon, lat] of points) {
    const p = [round(lon, decimals), round(lat, decimals)];
    const prev = out[out.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    out.push(p);
  }
  return out;
}

/**
 * The area-weighted centroid of a closed ring, falling back to the vertex
 * mean when the ring's signed area is zero (a degenerate footprint traced as
 * a line, which OSM does contain).
 *
 * Computed in raw lon/lat. A building footprint spans well under a
 * thousandth of a degree, so the difference between this and a proper
 * equal-area projection of it is far below the 4 decimals it is written at —
 * whereas projecting would need a per-feature choice of projection this
 * script has no reason to make.
 */
function ringCentroid(ring) {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    twiceArea += cross;
    x += (ring[j][0] + ring[i][0]) * cross;
    y += (ring[j][1] + ring[i][1]) * cross;
  }
  if (twiceArea !== 0) return [x / (3 * twiceArea), y / (3 * twiceArea)];
  let sx = 0;
  let sy = 0;
  for (const [lon, lat] of ring) {
    sx += lon;
    sy += lat;
  }
  return [sx / ring.length, sy / ring.length];
}

/** |signed area| of a ring, only ever used to pick the biggest one. */
function ringArea(ring) {
  let twice = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    twice += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return Math.abs(twice) / 2;
}

/**
 * One representative point for ANY GeoJSON geometry.
 *
 * A `MultiPolygon`/`Polygon` answers with the centroid of its LARGEST outer
 * ring rather than of all its parts together: a campus recorded as three
 * detached halls has no meaningful joint centroid, and the largest hall is a
 * place that exists. A line answers with its middle vertex, a point with
 * itself. `null` for a geometry with no coordinates at all, which the caller
 * drops.
 */
function representativePoint(geometry) {
  if (!geometry) return null;
  const { type, coordinates } = geometry;
  if (type === "Point") return coordinates;
  if (type === "MultiPoint") return coordinates[0] ?? null;
  if (type === "LineString") return coordinates[Math.floor(coordinates.length / 2)] ?? null;
  if (type === "MultiLineString") {
    const longest = coordinates.reduce((a, b) => (b.length > a.length ? b : a), coordinates[0] ?? []);
    return longest[Math.floor(longest.length / 2)] ?? null;
  }
  if (type === "Polygon") return coordinates[0]?.length ? ringCentroid(coordinates[0]) : null;
  if (type === "MultiPolygon") {
    let best = null;
    let bestArea = -1;
    for (const poly of coordinates) {
      const outer = poly[0];
      if (!outer?.length) continue;
      const area = ringArea(outer);
      if (area > bestArea) {
        bestArea = area;
        best = outer;
      }
    }
    return best ? ringCentroid(best) : null;
  }
  return null;
}

// ── THE WIRE FORMAT ───────────────────────────────────────────────────────
//
// Not GeoJSON, and not `GlyphMapVectorFeatureCollection` written out
// verbatim either. Both spend most of their bytes repeating the same keys
// once per feature: written literally, a datacenter is
// `{"properties":{"name":"AWS","operator":"Amazon Web Services"},
// "geometryType":"point","rings":[[[-77.4875,39.0437]]]}` — 110 bytes of
// which 55 are the four key names and the ring nesting, repeated 4,351
// times. Measured on the real sets, the literal form is 476 KiB for the
// datacenters and 3,945 KiB for the land regions against 226 KiB and
// 2,022 KiB here, i.e. this halves the whole payload for one small decoder
// (`mapsDatasets.ts`'s `decodeGlyphMapDataset`) and one test.
//
// The shape is POSITIONAL: `columns` names the properties once for the whole
// file, and each feature is `[values, geometry]` in that order. Geometry is
// a bare `[lon, lat]` for a point set and a list of rings otherwise, decided
// once by the file's own `geometry` field rather than per feature — every
// one of these datasets is homogeneous, and a mixed file would be two rows
// on the card anyway.
//
// It is a WIRE format and nothing else: the decoder's output is the ordinary
// `GlyphMapVectorFeatureCollection` the widget already consumes, so no layer,
// no renderer and no package knows this exists.
function pointFeature(values, lonLat) {
  return [values, [round(lonLat[0], POINT_DECIMALS), round(lonLat[1], POINT_DECIMALS)]];
}

const readJson = async (rel) => JSON.parse(await fs.readFile(path.join(LOCAL, rel), "utf8"));

async function readJsonLines(rel) {
  const text = await fs.readFile(path.join(LOCAL, rel), "utf8");
  return text.split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line));
}

async function writeDataset(dir, name, payload) {
  const target = path.join(OUT_ROOT, dir);
  await fs.mkdir(target, { recursive: true });
  const file = path.join(target, name);
  await fs.writeFile(file, JSON.stringify(payload));
  const { size } = await fs.stat(file);
  return size;
}

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;

/**
 * A provenance note beside every dataset, not only beside the one whose
 * licence forbids something.
 *
 * The cables' `LICENSE` is an obligation; these are so that a reader who
 * finds one of these directories — in a clone, in a deploy, in a search
 * result — can tell what the data is and what its terms are without having to
 * find this script first. The ODbL pair carry a real share-alike term on the
 * derived database, so the note is not purely informational there either.
 */
async function writeDatasetReadme(dir, { title, source, sourceUrl, license, licenseUrl, attribution, note, files }) {
  const target = path.join(OUT_ROOT, dir);
  await fs.mkdir(target, { recursive: true });
  await fs.writeFile(
    path.join(target, "README.md"),
    [
      `# ${title}`,
      "",
      "| | |",
      "|---|---|",
      `| Source | [${source}](${sourceUrl}) |`,
      "| Obtained via | [gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) |",
      `| Licence | ${licenseUrl ? `[${license}](${licenseUrl})` : license} |`,
      `| Attribution | ${attribution} |`,
      `| Files | ${files} |`,
      "",
      note,
      "",
      "## Regenerating",
      "",
      "```sh",
      "node website/scripts/prepare-static-datasets.mjs --source /path/to/gods-eye-view",
      "```",
      "",
      "The attribution the `/maps` page displays is NOT read from these files:",
      "it is a constant in",
      "`website/src/components/MapsWorkbench/mapsDatasets.ts` that rides the",
      "mounted layer into `map.getAttributions()`, so the credit cannot be lost",
      "by editing the data.",
      "",
    ].join("\n"),
  );
}

// ── Datacenters ───────────────────────────────────────────────────────────
//
// `tags.name` is the label a reader wants and it is not universal in the
// extract, so a feature without one falls back to its OPERATOR (which is the
// more useful of the two anyway for the unnamed halls: "Equinix", "Digital
// Realty") and only then to the generic word. `operator` is kept as its own
// property beside the name so a future filter can group by it without
// re-parsing the label.
async function prepareDatacenters() {
  const raw = await readJsonLines("datacenters/datacenters.geojsonl");
  const features = [];
  for (const f of raw) {
    const at = representativePoint(f.geometry);
    if (!at || !Number.isFinite(at[0]) || !Number.isFinite(at[1])) continue;
    const tags = f.properties?.tags ?? f.tags ?? {};
    const operator = tags.operator ?? tags["operator:short"] ?? "";
    const name = tags.name ?? operator ?? "";
    features.push(pointFeature([name, operator], at));
  }
  const size = await writeDataset("datacenters", "datacenters.json", {
    meta: {
      source: "OpenStreetMap (telecom=data_center), via God's Eye View",
      url: "https://github.com/bilawalsidhu/gods-eye-view",
      license: "ODbL 1.0",
      note: "polygon footprints reduced to representative points",
    },
    geometry: "point",
    columns: ["name", "operator"],
    features,
  });
  await writeDatasetReadme("datacenters", {
    title: "Data centres (OpenStreetMap)",
    source: "OpenStreetMap `telecom=data_center`",
    sourceUrl: "https://www.openstreetmap.org",
    license: "ODbL 1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    attribution: "\u00a9 OpenStreetMap contributors",
    files: "`datacenters.json` \u2014 4,351 points",
    note: [
      "OpenStreetMap records most data centres as BUILDING FOOTPRINTS, which are",
      "four orders of magnitude below one character at a world view. Each feature",
      "here is the centroid of its own largest ring, at 4 decimal places (~11 m).",
      "",
      "ODbL's share-alike applies to the DATA; the repository's own MIT licence",
      "applies to its source code. Redistributing a modified version of this",
      "database means offering it under ODbL.",
    ].join("\n"),
  });
  return { label: "datacenters", count: features.length, size };
}

// ── Dams ──────────────────────────────────────────────────────────────────
//
// `output` (installed electrical capacity, as OSM writes it — "330KW",
// "14000 MW") is kept because it is the one magnitude this dataset carries
// and it is what makes a label worth reading. It is NOT normalized into a
// number here: OSM's units are free text and a wrong parse would be a
// confident wrong number, where the raw string is at least what the mapper
// said. The card labels dams with `name` alone; `output` rides along for a
// reader inspecting the data and for any later magnitude control.
async function prepareDams() {
  const collection = await readJson("dams/dams.geojson");
  const features = [];
  for (const f of collection.features) {
    const at = representativePoint(f.geometry);
    if (!at || !Number.isFinite(at[0]) || !Number.isFinite(at[1])) continue;
    const props = f.properties ?? {};
    const name = props.name ?? props.tags?.name ?? "";
    const output = props.output ?? "";
    features.push(pointFeature([name, output], at));
  }
  const size = await writeDataset("dams", "dams.json", {
    meta: {
      source: "Open Infrastructure Map / OpenStreetMap, via God's Eye View",
      url: "https://openinframap.org",
      license: "ODbL 1.0",
      note: "polygon footprints reduced to representative points",
    },
    geometry: "point",
    columns: ["name", "output"],
    features,
  });
  await writeDatasetReadme("dams", {
    title: "Dams and hydroelectric plants (Open Infrastructure Map / OpenStreetMap)",
    source: "Open Infrastructure Map",
    sourceUrl: "https://openinframap.org",
    license: "ODbL 1.0",
    licenseUrl: "https://opendatacommons.org/licenses/odbl/1-0/",
    attribution: "\u00a9 OpenStreetMap contributors, via Open Infrastructure Map",
    files: "`dams.json` \u2014 704 points",
    note: [
      "Footprints reduced to representative points, as for the data centres.",
      "`output` is OpenStreetMap's own free-text installed capacity string",
      "(\"330KW\", \"14000 MW\") and is carried through unparsed: the units are",
      "free text and a wrong parse would be a confident wrong number.",
      "",
      "ODbL's share-alike applies to the DATA, not to this repository's code.",
    ].join("\n"),
  });
  return { label: "dams", count: features.length, size };
}

// ── Submarine cables ──────────────────────────────────────────────────────
//
// Every feature is a `MultiLineString`; each part becomes one entry in
// `rings`, after the antimeridian split (a trans-Pacific cable has parts on
// both sides of the seam and this is where the wrap segment is dropped).
// `color` is TeleGeography's own per-cable hue and is carried through so a
// future per-feature colour has something real to read; the card paints one
// colour for the layer today.
async function prepareCables() {
  const collection = await readJson("telegeography_submarine_cables/cable-geo.json");
  const features = [];
  let parts = 0;
  let vertices = 0;
  for (const f of collection.features) {
    const rings = [];
    for (const part of f.geometry?.coordinates ?? []) {
      for (const piece of glyphMapSplitAtAntimeridian(quantize(part, LINE_DECIMALS), false)) {
        if (piece.length < 2) continue;
        rings.push(piece);
        vertices += piece.length;
      }
    }
    if (rings.length === 0) continue;
    parts += rings.length;
    features.push([[f.properties?.name ?? "", f.properties?.color ?? ""], rings]);
  }
  const size = await writeDataset("submarine-cables", "cables.json", {
    meta: {
      source: "TeleGeography Submarine Cable Map",
      url: "https://www.submarinecablemap.com",
      license: "CC BY-NC-SA 3.0",
      note: "multilinestring, split at the antimeridian",
    },
    geometry: "line",
    columns: ["name", "color"],
    features,
  });
  await writeCableLicence();
  return { label: "submarine cables", count: features.length, size, extra: `${parts} parts, ${vertices} vertices` };
}

/**
 * The cables' own licence, beside the data. The repo root is MIT and every
 * package under it is published under MIT; without this file the only licence
 * statement covering this directory would be one that TeleGeography never
 * granted.
 */
async function writeCableLicence() {
  const dir = path.join(OUT_ROOT, "submarine-cables");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "LICENSE"),
    [
      "Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported",
      "(CC BY-NC-SA 3.0)",
      "",
      "https://creativecommons.org/licenses/by-nc-sa/3.0/",
      "",
      "The data file in this directory (cables.json) is derived from the",
      "TeleGeography Submarine Cable Map (https://www.submarinecablemap.com)",
      "and is licensed under CC BY-NC-SA 3.0. It is NOT covered by the MIT",
      "licence at the root of this repository, which applies to this project's",
      "own source code.",
      "",
      "You may share and adapt this data for NON-COMMERCIAL purposes, provided",
      "you credit TeleGeography and distribute any adaptation under these same",
      "terms. Commercial use requires a licence from TeleGeography.",
      "",
      "Attribution: (c) TeleGeography - www.submarinecablemap.com",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(dir, "README.md"),
    [
      "# Submarine cables (TeleGeography)",
      "",
      "**Licence: CC BY-NC-SA 3.0 — non-commercial, share-alike.**",
      "See `LICENSE` in this directory. This is the one dataset in this",
      "repository that the root MIT licence does not cover.",
      "",
      "| | |",
      "|---|---|",
      "| Source | [TeleGeography Submarine Cable Map](https://www.submarinecablemap.com) |",
      "| Obtained via | [gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) |",
      "| Licence | [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) |",
      "| Attribution | © TeleGeography — submarinecablemap.com |",
      "",
      "## Why it is here and not in a package",
      "",
      "Every package in this monorepo is MIT and is published to npm. A",
      "non-commercial, share-alike file inside one would impose terms the",
      "package cannot grant. It lives under `website/` only, where a free",
      "documentation site is a non-commercial use, and `@glyphcss/maps` needed",
      "no change to render it — the `/maps` page mounts it through the widget's",
      "existing static `GlyphMapVectorFeatureCollection` source.",
      "",
      "## Regenerating",
      "",
      "```sh",
      "node website/scripts/prepare-static-datasets.mjs --source /path/to/gods-eye-view",
      "```",
      "",
      "The attribution the page displays is NOT read from this file: it is a",
      "constant in `website/src/components/MapsWorkbench/mapsDatasets.ts` that",
      "rides the mounted layer into `map.getAttributions()`, so the credit",
      "cannot be lost by editing the data.",
      "",
    ].join("\n"),
  );
}

// ── Natural Earth physical regions ────────────────────────────────────────
//
// The source is NOT GeoJSON: `{ meta, features: [{ name, featurecla,
// polygons }] }` where `polygons` is a bare coordinate array. `featurecla` is
// the feature CLASS ("Island", "Range/mtn", "Desert" on land; "sea", "gulf",
// "bay" at sea) and is kept, because it is the only axis anyone would filter
// these on.
//
// The two files are kept SEPARATE — land regions and marine areas are two
// Natural Earth source files, they answer different questions, and a reader
// wanting the seas named does not necessarily want every mountain range
// shaded. That is also why they are two rows on the card rather than one.
async function prepareNaturalEarth(file, out, kind) {
  const source = await readJson(`natural_earth/${file}`);
  const features = [];
  let rings = 0;
  let vertices = 0;
  for (const f of source.features) {
    const groups = [];
    // The source's `polygons` is a flat list of OUTER RINGS, one per part —
    // its own `meta.curation.outerRingsOnly` is why there are no holes to
    // own, and it is verified rather than assumed: every entry in both files
    // nests exactly two levels deep (a ring), never three (a group).
    for (const ring of f.polygons ?? []) {
      const q = quantize(ring, LINE_DECIMALS);
      // A ring must survive the antimeridian rule too: Natural Earth writes a
      // seam-spanning polygon as ONE ring carrying vertices on both sides,
      // and the longest surviving piece is the part of it that is actually a
      // shape.
      const pieces = glyphMapSplitAtAntimeridian(q, true);
      const kept = pieces.reduce((a, b) => (b.length > a.length ? b : a), pieces[0] ?? []);
      if (kept.length < 4) continue;
      const closed = kept[0][0] === kept[kept.length - 1][0] && kept[0][1] === kept[kept.length - 1][1]
        ? kept
        : [...kept, kept[0]];
      groups.push(closed);
      vertices += closed.length;
      rings += 1;
    }
    if (groups.length === 0) continue;
    features.push([[f.name ?? "", f.featurecla ?? ""], groups]);
  }
  const size = await writeDataset("natural-earth", out, {
    meta: {
      source: source.meta?.source ?? `Natural Earth 10m physical vectors (${kind})`,
      url: source.meta?.url ?? "https://www.naturalearthdata.com",
      license: "Public domain",
      curation: source.meta?.curation,
    },
    geometry: "polygon",
    columns: ["name", "featurecla"],
    features,
  });
  await writeDatasetReadme("natural-earth", {
    title: "Physical geography regions (Natural Earth)",
    source: "Natural Earth 10m physical vectors",
    sourceUrl: "https://www.naturalearthdata.com",
    license: "Public domain",
    licenseUrl: "https://www.naturalearthdata.com/about/terms-of-use/",
    attribution: "Made with Natural Earth (courtesy \u2014 no permission needed)",
    files: "`regions.json` \u2014 1,046 land features; `marine.json` \u2014 292 marine features",
    note: [
      "Named PHYSICAL features, not administrative ones: islands and island",
      "groups, mountain ranges, plateaus, deserts, capes, plains and continents on",
      "land; oceans, seas, gulfs, bays, straits, sounds and fjords at sea. There is",
      "no parent-country key, because these are not subdivisions of anything.",
      "",
      "Geometry is at the upstream snapshot's own curation (0.01-degree",
      "Douglas-Peucker, 3 decimals, outer rings only) and is NOT re-simplified",
      "here. Natural Earth is public domain, so the credit is courtesy rather",
      "than a term \u2014 it is shown anyway.",
    ].join("\n"),
  });
  return { label: `natural earth ${kind}`, count: features.length, size, extra: `${rings} rings, ${vertices} vertices` };
}

async function main() {
  try {
    await fs.access(LOCAL);
  } catch {
    console.error(
      `prepare-static-datasets: no God's Eye View checkout at ${SOURCE}.\n` +
      `Clone https://github.com/bilawalsidhu/gods-eye-view and pass --source <path>.`,
    );
    process.exitCode = 1;
    return;
  }
  const results = [
    await prepareDatacenters(),
    await prepareDams(),
    await prepareCables(),
    await prepareNaturalEarth("regions.json", "regions.json", "land regions"),
    await prepareNaturalEarth("marine.json", "marine.json", "marine areas"),
  ];
  let total = 0;
  for (const r of results) {
    total += r.size;
    console.log(`${r.label.padEnd(26)} ${String(r.count).padStart(6)} features  ${kib(r.size).padStart(11)}${r.extra ? `  (${r.extra})` : ""}`);
  }
  console.log(`${"total".padEnd(26)} ${" ".repeat(6)}           ${kib(total).padStart(11)}`);
}

await main();
