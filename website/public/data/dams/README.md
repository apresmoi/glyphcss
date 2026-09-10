# Dams and hydroelectric plants (Open Infrastructure Map / OpenStreetMap)

| | |
|---|---|
| Source | [Open Infrastructure Map](https://openinframap.org) |
| Obtained via | [gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) |
| Licence | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/) |
| Attribution | © OpenStreetMap contributors, via Open Infrastructure Map |
| Files | `dams.json` — 704 points |

Footprints reduced to representative points, as for the data centres.
`output` is OpenStreetMap's own free-text installed capacity string
("330KW", "14000 MW") and is carried through unparsed: the units are
free text and a wrong parse would be a confident wrong number.

ODbL's share-alike applies to the DATA, not to this repository's code.

## Regenerating

```sh
node website/scripts/prepare-static-datasets.mjs --source /path/to/gods-eye-view
```

The attribution the `/maps` page displays is NOT read from these files:
it is a constant in
`website/src/components/MapsWorkbench/mapsDatasets.ts` that rides the
mounted layer into `map.getAttributions()`, so the credit cannot be lost
by editing the data.
