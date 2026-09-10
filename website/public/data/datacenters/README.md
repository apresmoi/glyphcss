# Data centres (OpenStreetMap)

| | |
|---|---|
| Source | [OpenStreetMap `telecom=data_center`](https://www.openstreetmap.org) |
| Obtained via | [gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) |
| Licence | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) |
| Attribution | © OpenStreetMap contributors |
| Files | `datacenters.json` — 4,351 points |

OpenStreetMap records most data centres as BUILDING FOOTPRINTS, which are
four orders of magnitude below one character at a world view. Each feature
here is the centroid of its own largest ring, at 4 decimal places (~11 m).

ODbL's share-alike applies to the DATA; the repository's own MIT licence
applies to its source code. Redistributing a modified version of this
database means offering it under ODbL.

## Regenerating

```sh
node website/scripts/prepare-static-datasets.mjs --source /path/to/gods-eye-view
```

The attribution the `/maps` page displays is NOT read from these files:
it is a constant in
`website/src/components/MapsWorkbench/mapsDatasets.ts` that rides the
mounted layer into `map.getAttributions()`, so the credit cannot be lost
by editing the data.
