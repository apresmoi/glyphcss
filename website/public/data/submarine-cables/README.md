# Submarine cables (TeleGeography)

**Licence: CC BY-NC-SA 3.0 — non-commercial, share-alike.**
See `LICENSE` in this directory. This is the one dataset in this
repository that the root MIT licence does not cover.

| | |
|---|---|
| Source | [TeleGeography Submarine Cable Map](https://www.submarinecablemap.com) |
| Obtained via | [gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) |
| Licence | [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/) |
| Attribution | © TeleGeography — submarinecablemap.com |

## Why it is here and not in a package

Every package in this monorepo is MIT and is published to npm. A
non-commercial, share-alike file inside one would impose terms the
package cannot grant. It lives under `website/` only, where a free
documentation site is a non-commercial use, and `@glyphcss/maps` needed
no change to render it — the `/maps` page mounts it through the widget's
existing static `GlyphMapVectorFeatureCollection` source.

## Regenerating

```sh
node website/scripts/prepare-static-datasets.mjs --source /path/to/gods-eye-view
```

The attribution the page displays is NOT read from this file: it is a
constant in `website/src/components/MapsWorkbench/mapsDatasets.ts` that
rides the mounted layer into `map.getAttributions()`, so the credit
cannot be lost by editing the data.
