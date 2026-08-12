# Subpath 04 — Solid of revolution (structure from symmetry)

**Idea:** For a radially-symmetric object, one 2D image *is* the full 3D: take the
per-row silhouette half-width as a radius profile and revolve it around the vertical
axis → a real 3D solid from a single image. The cheapest "first test" of recovering
structure from a known symmetry.

## How it works
1. Extract a per-row radius profile from the image silhouette (background threshold).
2. Revolve: for each row (height) and angle, place a ring vertex; build quads between
   rings → a lathe mesh. Color each vertex by sampling the source image.
3. Render in glyphcss; front-on reproduces the source silhouette, tilt reveals the 3D.

## Fit for our constraints
- **Tiny?** ✅✅ pure geometry — no model at all, runs anywhere instantly.
- **Faithful?** ✅ for radially-symmetric objects (vases, bottles, cups, lamps, wheels);
  ❌ for asymmetric ones.
- **Where?** In-browser, trivially.

## Validation (`experiments/revolution/`)
Works. Built a silhouette **IoU + flip-search + diff overlay** (the pixel-diff loop),
which caught three issues as the score climbed 28% → 42% → 63%:
- glyphcss is **Z-up** → axis must be Z (revolving around Y rendered it on its side);
- **doubleSided: true** to stop the shell being backface-culled (crescent holes);
- display **cellAspect** (line-height 2× font) or the tall object renders squished.
Front-on matches the source vase; tilting shows a true solid (elliptical rim).

IoU is a rough proxy (~63%) — bbox-square normalization + bright camera-facing cells
reading as empty leave a hollow-center artifact. TODO: fill silhouette holes + count
bright cells as occupied.

## Verdict
**validated + highest value-per-effort.** No ML, instant, and genuinely 3D for the
large class of lathe-symmetric objects. Natural extensions: detect the symmetry axis
automatically; combine with Tier-1 depth (subpath 01) for the asymmetric parts;
mirror-symmetry (bilateral) as a second cheap prior.
