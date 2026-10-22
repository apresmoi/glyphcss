---
name: glyphcss
description: Render 3D meshes, primitive shapes, Mermaid diagrams and data charts as text, ASCII, terminal ANSI or HTML with the glyphcss CLI. Use for 3D model previews, flowcharts, sequence diagrams, state diagrams, ER diagrams, Git graphs, bar charts, line charts and other Mermaid or JSON visualizations. For chat-sized charts and diagrams, prefer the dedicated glyphcss-diagrams agent skill.
---

# glyphcss — render 3D, diagrams and charts as text

`glyphcss` compiles 3D geometry, Mermaid diagrams and data charts to text. In a
terminal it defaults to **truecolor ANSI**, so the output shows in color directly.

Install once: `npm i -g @glyphcss/compile` (the command is `glyphcss`). Or run ad
hoc with `npx @glyphcss/compile <args>`.

## Render a diagram or Mermaid chart

```sh
npm install -g @glyphcss/compile
printf '%s\n' 'flowchart LR; A[Input] --> B[Parse] --> C[Render]' > flow.mmd
glyphcss diagram flow.mmd --target chat --width 48 --height 7
```

`glyphcss diagram` accepts `.mmd` Mermaid source or `.json` graph data. Mermaid
chart headers, sequences and Git graphs dispatch to their matching renderers.
Use `--color css -o diagram.html` for HTML. Graph layout options include
`--direction TB|LR|BT|RL`, `--engine dagre`, `--nodesep N`, `--ranksep N`,
`--title TEXT` and `--detail auto|faithful|balanced|simplified`. Inapplicable
options are recorded on stderr. Diagrams are 2D only.

## Render a data chart

```sh
npm install -g @glyphcss/compile
printf '%s\n' '[3, 5, 2, 8, 6, 9, 4]' > values.json
glyphcss chart values.json --target chat --charset braille --width 40 --height 8
```

`glyphcss chart` accepts JSON chart input. Use `glyphcss diagram chart.mmd` for
Mermaid charts. Both subcommands accept `--target chat|terminal|web`,
`--charset ascii|box|blocks|braille`, `--color none|ansi16|ansi256|truecolor|css`,
`--width N`, `--height N` and `-o FILE`. They print adaptation notes on stderr.
Only `chart` accepts `--3d` for a surface spec; `--camera rotX,rotY[,zoom]` and
`--style solid|wireframe|ink` require `--3d`.

For output sized for a conversation, use the dedicated
[glyphcss-diagrams agent skill](https://github.com/apresmoi/glyphcss-diagrams),
available as Claude Code and Codex plugins or through
`npx skills add apresmoi/glyphcss-diagrams --global --skill glyphcss-diagrams`.

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
- **Render** `--mode solid|wireframe|voxel|ink` `--palette default|ascii|blocks|…` `--no-colors`
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
