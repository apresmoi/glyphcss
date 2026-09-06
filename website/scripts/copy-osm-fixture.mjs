// Copy the vendored Protomaps/OpenStreetMap extract into public/ so it is
// served at /data/osm/ (single source of truth: packages/maps/fixtures/
// pmtiles/, the same convention copy-skill.mjs uses for the CLI skill).
//
// It is copied rather than committed under public/ because the repo's
// .gitignore carves out exactly ONE place a `.pmtiles` file may live, so that
// nobody commits a multi-gigabyte archive by accident.
//
// SELF-HOSTING IS THE POINT: Protomaps ask people to host their own tiles
// rather than read from the project's buckets, and the public demo bucket
// 404s. The page therefore reads this copy, never a third-party URL.
import { copyFileSync, mkdirSync } from "node:fs";
const src = "../packages/maps/fixtures/pmtiles/zurich-z12.pmtiles";
const destDir = "public/data/osm";
const dest = `${destDir}/zurich-z12.pmtiles`;
mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`copied ${src} → website/${dest}`);
