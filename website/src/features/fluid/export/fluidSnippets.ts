import {
  FLUID_CONFIG_DEFAULTS,
  fluidExamplePreset,
  type FluidConfig,
  type FluidConfigKey,
  type FluidExample,
  type FluidTuning,
} from "../model/fluidExamples";
import { FLUID_READER_LOOP_MS } from "../model/fluidWorkbench";

// The package has no React/Vue bindings, so the export panel offers the vanilla API only.

const json = (value: unknown) => JSON.stringify(value);

/** `createGlyphFluid` options that differ from the package's defaults (`base`). */
function fluidOptionLines(config: FluidConfig, base: FluidConfig, tuning: FluidTuning): string[] {
  const lines: string[] = [];
  const changed = (key: FluidConfigKey) => config[key] !== base[key];
  for (const key of [
    "glue",
    "shape",
    "encoding",
    "face",
    "fps",
    "fpsFallback",
    "clock",
    "reducedMotion",
    "pointer",
    "shimmer",
  ] as const)
    if (changed(key)) lines.push(`${key}: ${json(config[key])},`);
  if (!config.worker) lines.push("worker: false,");
  if (changed("fieldColor") || changed("fieldLevel"))
    lines.push(`field: { color: ${json(config.fieldColor)}, level: ${config.fieldLevel} },`);
  const grid = (["cellAspect", "targetCols", "minCellPx", "maxCellPx", "maxCols"] as const).filter(changed);
  if (grid.length) lines.push(`grid: { ${grid.map((key) => `${key}: ${config[key]}`).join(", ")} },`);
  if (Object.keys(tuning).length) lines.push(`tuning: ${json(tuning).replace(/"(\w+)":/g, "$1: ")},`);
  return lines;
}

const shownLines = (config: FluidConfig) => [
  ...(config.delay !== FLUID_CONFIG_DEFAULTS.delay ? [`delay: ${config.delay}`] : []),
  ...(config.visibility !== FLUID_CONFIG_DEFAULTS.visibility ? [`visibility: ${json(config.visibility)}`] : []),
];

function targetLines(example: FluidExample, config: FluidConfig): string[] {
  const melt = config.condensed ? [] : ["target.melt();   // target.condense() flows it back in"];
  switch (example.kind) {
    case "text":
      return [
        `// The heading stays in the page (color: transparent); its text condenses out of the field.`,
        `const target = fluid.addTarget(GlyphFluidTargets.text(document.querySelector("#stage h1"), { ${[`color: ${json(config.color)}`, ...shownLines(config)].join(", ")} }));`,
        ...melt,
      ];
    case "image":
      return [
        `const img = new Image();`,
        `img.src = ${json(example.src)};`,
        `await img.decode();`,
        `const target = fluid.addTarget(GlyphFluidTargets.image(img, document.querySelector("#stage figure"), { ${[`ink: ${json(config.ink)}`, ...shownLines(config)].join(", ")} }));`,
        ...melt,
      ];
    case "mesh": {
      const preset = fluidExamplePreset(example);
      const source =
        preset?.kind === "primitive"
          ? `resolveGeometry(${json(preset.id.replace(/^primitive-/, ""))}, { size: 50 })`
          : `(await loadMesh(${json(preset?.url ?? "model.obj")})).polygons`;
      return [
        `const polygons = ${source};`,
        `// Frame the model: orbit its bounding-box centre, size the box to its diagonal.`,
        `const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];`,
        `for (const p of polygons) for (const v of p.vertices) for (let i = 0; i < 3; i++) (lo[i] = Math.min(lo[i], v[i])), (hi[i] = Math.max(hi[i], v[i]));`,
        `const camera = createGlyphOrthographicCamera({ rotX: ${config.meshRotX}, rotY: ${config.meshRotY} });`,
        `camera.target = lo.map((v, i) => (v + hi[i]) / 2);`,
        `const t0 = performance.now();`,
        `const target = fluid.addTarget(GlyphFluidTargets.mesh(document.querySelector("#stage figure"), {`,
        `  // read every frame: turning the camera spins the model`,
        `  polygons: () => ((camera.rotY = ${config.meshRotY} + ${config.meshSpin} * (performance.now() - t0) / 1000), polygons),`,
        `  camera,`,
        `  extent: ${config.meshExtent} * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]),`,
        `  ambient: ${config.meshAmbient},`,
        ...(config.meshFeatures ? [] : [`  features: false,`]),
        ...(config.meshSwell ? [] : [`  swell: false,`]),
        ...shownLines(config).map((line) => `  ${line},`),
        `}));`,
        ...melt,
      ];
    }
    case "zones":
      return [
        `// Move the pointer to stir; the zone reshapes the field's floor under the prose.`,
        `fluid.addZone({ el: document.querySelector("#stage article"), kind: ${json(config.zoneKind)}, level: ${config.zoneLevel} });`,
      ];
    default:
      return [];
  }
}

const IMPORTS: Record<FluidExample["kind"], string[]> = {
  text: [`import { createGlyphFluid, GlyphFluidTargets } from "@glyphcss/fluid";`],
  image: [`import { createGlyphFluid, GlyphFluidTargets } from "@glyphcss/fluid";`],
  mesh: [
    `import { createGlyphFluid, GlyphFluidTargets } from "@glyphcss/fluid";`,
    `import { createGlyphOrthographicCamera } from "glyphcss";`,
    `import { loadMesh, resolveGeometry } from "@glyphcss/core";`,
  ],
  zones: [`import { createGlyphFluid } from "@glyphcss/fluid";`],
  reader: [`import { createGlyphFluidReader } from "@glyphcss/fluid/reader";`],
};

/** The active example as vanilla code, with every option that differs from the package's defaults. */
export function buildFluidSnippet(
  example: FluidExample,
  config: FluidConfig,
  defaults: FluidConfig,
  tuning: FluidTuning,
): string {
  const ripple =
    config.impulseStrength !== FLUID_CONFIG_DEFAULTS.impulseStrength ||
    config.impulseRadius !== FLUID_CONFIG_DEFAULTS.impulseRadius
      ? `, { strength: ${config.impulseStrength}, radius: ${config.impulseRadius} }`
      : "";
  if (example.kind === "reader") {
    // The reader sizes its own grid and starts round.
    const base = { ...defaults, shape: "rect" as const };
    const options = [
      `text: ${json(config.text)},`,
      `wpm: ${config.wpm},`,
      `loop: ${config.loop ? FLUID_READER_LOOP_MS : "false"},`,
      `look: ${json(config.look)},`,
      ...(config.look === "plain"
        ? [`// font: "…",   // the plain letters' CSS font-family; default is the system ui-monospace stack`]
        : []),
      ...(config.leadIn !== FLUID_CONFIG_DEFAULTS.leadIn ? [`leadIn: ${config.leadIn},`] : []),
      ...(config.ariaLive !== FLUID_CONFIG_DEFAULTS.ariaLive ? [`ariaLive: ${json(config.ariaLive)},`] : []),
      ...(config.ripple !== FLUID_CONFIG_DEFAULTS.ripple ? [`ripple: ${config.ripple},`] : []),
      ...(config.readerColor !== FLUID_CONFIG_DEFAULTS.readerColor ? [`color: ${json(config.readerColor)},`] : []),
      ...fluidOptionLines(config, base, tuning).filter((line) => !line.startsWith("glue:")),
    ];
    return [
      ...IMPORTS.reader,
      ``,
      `// A speed reader, one word at a time with its ORP letter accented.`,
      `const reader = createGlyphFluidReader(document.querySelector("#reader"), {`,
      ...options.map((line) => `  ${line}`),
      `});`,
      ``,
      `// reader.clock.pause(); reader.clock.setWpm(600); reader.clock.setText("…");`,
      `// reader.fluid.impulse(x, y${ripple});`,
      `// reader.destroy();`,
      ``,
    ].join("\n");
  }
  const options = fluidOptionLines(config, FLUID_CONFIG_DEFAULTS, tuning).map((line) => `  ${line}`);
  return [
    ...IMPORTS[example.kind],
    ``,
    `// A fluid filling #stage. Move the pointer to stir it; a click sends a ring.`,
    `const fluid = createGlyphFluid(document.querySelector("#stage")${options.length ? `, {\n${options.join("\n")}\n}` : ""});`,
    ...targetLines(example, config),
    ``,
    `// fluid.impulse(x, y${ripple});`,
    ...(config.clock === "manual"
      ? [`// fluid.step(1 / ${config.fps});   // clock: "manual" draws only on step()`]
      : []),
    `// fluid.destroy();`,
    ``,
  ].join("\n");
}
