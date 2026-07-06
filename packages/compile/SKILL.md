---
name: glyphcss
description: Render a 3D mesh, a primitive shape (cube, sphere, icosahedron, torus, cone…), or custom polygons to ASCII art — in the terminal (truecolor ANSI) or as HTML. Use when asked to render, preview, or visualize a 3D model or shape as text/ASCII.
---

# glyphcss — render 3D to ASCII

`glyphcss` is a CLI that compiles 3D geometry to ASCII and prints it. In a
terminal it defaults to **truecolor ANSI**, so the output shows in color directly.

Install once: `npm i -g @glyphcss/compile` (the command is `glyphcss`). Or run ad
hoc with `npx @glyphcss/compile <args>`.

## Render a primitive shape

```sh
glyphcss cube --auto-center            # color ASCII cube in the terminal
glyphcss sphere --auto-center
glyphcss icosahedron --rot-x 60 --rot-y 30 --auto-center
```

A bare name with no file extension is treated as a shape. Available shapes:
`tetrahedron cube octahedron dodecahedron icosahedron sphere cylinder cone torus
pyramid prism antiprism bipyramid trapezohedron cuboctahedron icosidodecahedron`
and the Archimedean/Catalan/Kepler-Poinsot solids (truncated*, snub*, rhombic*,
triakis*, deltoidal*, great*/small* …).

## Render a mesh file

```sh
glyphcss model.obj --auto-center       # .obj/.glb/.gltf/.vox/.stl
glyphcss model.glb -f full -o out.html # write an HTML document
```
OBJ companion `.mtl` is auto-detected (or `--mtl FILE`); PNG/JPG textures are
decoded and baked to per-face color.

## Render custom polygons

```sh
glyphcss --polygons-json '[{"vertices":[[0,0,0],[2,0,0],[1,2,0]],"color":"#ff0000"}]'
glyphcss --polygons shape.json --auto-center
```
JSON is an array (or `{ "polygons": [...] }`) of `{ vertices: [[x,y,z] ×3+], color?: "#rgb" }`.

## Key options

- **Output** `-f, --format` `ansi` | `text` | `html` | `full` (default: terminal→ansi, `-o` file→html, pipe→text)
- **Frame** `--auto-center` recenters; with no `--cols`/`--rows` it auto-fits the grid to the content (or `--fit N` cols; give one of `--cols`/`--rows` and the other adapts)
- **Camera** `--rot-x N` `--rot-y N` `--zoom N` `--ortho`
- **Render** `--mode solid|wireframe|voxel` `--palette default|ascii|blocks|…` `--no-colors`
- **Output to file** `-o FILE`
- `glyphcss --help` lists everything.

## Writing glyphcss code

For app code, use `glyphcss`, `@glyphcss/react`, or `@glyphcss/vue`. When porting
a Three.js scene or generating Three-shaped code, prefer the parity subpaths:
`glyphcss/three`, `@glyphcss/react/three`, or `@glyphcss/vue/three`. They provide
Three-like `PerspectiveCamera`, `OrthographicCamera`, `Object3D`, `Vector3`,
`lookAt`, radians, Y-up authoring, and Three-like light color/intensity/direction
conversion. Directional lights convert to glyphcss's native source vector from
the shaded surface toward the light. Everything still renders through glyphcss.
Full docs: https://glyphcss.com/docs/api/three-parity.md

## Recipe: show a shape in the console

```sh
glyphcss cube --auto-center
```
That prints a centered, colored ASCII cube. Swap `cube` for any shape, a file, or
`--polygons-json`. Use `-f text` for plain (no color), `-f full -o x.html` for a page.
