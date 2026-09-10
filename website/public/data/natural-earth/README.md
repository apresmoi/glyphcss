# Physical geography regions (Natural Earth)

| | |
|---|---|
| Source | [Natural Earth 10m physical vectors](https://www.naturalearthdata.com) |
| Obtained via | [gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) |
| Licence | [Public domain](https://www.naturalearthdata.com/about/terms-of-use/) |
| Attribution | Made with Natural Earth (courtesy — no permission needed) |
| Files | `regions.json` — 1,046 land features; `marine.json` — 292 marine features |

Named PHYSICAL features, not administrative ones: islands and island
groups, mountain ranges, plateaus, deserts, capes, plains and continents on
land; oceans, seas, gulfs, bays, straits, sounds and fjords at sea. There is
no parent-country key, because these are not subdivisions of anything.

Geometry is at the upstream snapshot's own curation (0.01-degree
Douglas-Peucker, 3 decimals, outer rings only) and is NOT re-simplified
here. Natural Earth is public domain, so the credit is courtesy rather
than a term — it is shown anyway.

## Regenerating

```sh
node website/scripts/prepare-static-datasets.mjs --source /path/to/gods-eye-view
```

The attribution the `/maps` page displays is NOT read from these files:
it is a constant in
`website/src/components/MapsWorkbench/mapsDatasets.ts` that rides the
mounted layer into `map.getAttributions()`, so the credit cannot be lost
by editing the data.
