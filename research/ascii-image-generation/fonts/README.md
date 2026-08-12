# Conditioning font

The control-image rasterizer uses only the vendored `IBM Plex Mono Regular`
bytes in this directory. It never asks the operating system to substitute a
platform font. `SOURCE.json` pins IBM Plex release `v6.4.0` to commit
`383c681f015ed2626e919ec4e3cca16ccc204e9d`, its download URL, the file hash,
attribution, and the SHA-256 of the bundled `OFL-1.1.txt`.

`pnpm --filter @glyphcss/ascii-image-generation glyph-confusion -- --check`
is reproducible only on the pinned `darwin/arm64`, Node `v22.14.0` runner in
`config/glyph-rasterizer-provenance.json`. The check verifies the lockfile,
`@napi-rs/canvas` package, and the exact loaded Skia native binary before it
accepts the report or contact sheet.

IBM Plex Mono is licensed under the SIL Open Font License 1.1. The font remains
under that license when bundled; the generated control images are not themselves
font software. The reserved font name is `Plex`.

Glyphcss can render Unicode in its visible palettes (for example blocks,
braille, arrows, and runes). That display capability is deliberately broader
than this model vocabulary. Training input is exactly printable ASCII U+0020
through U+007E, rendered through this pinned font. The semantic dictionary is
smaller still: it is an explicit, one-way class-to-glyph mapping selected from
that printable set. Visible shade glyphs and Unicode palette glyphs never imply
an object class, and no visible-glyph-to-class reverse lookup exists.
