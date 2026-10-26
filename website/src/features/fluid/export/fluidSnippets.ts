import {
  FLUID_DEFAULTS,
  FLUID_HEADING_COLOR,
  FLUID_READER_LOOP_MS,
  type FluidReaderSettings,
  type FluidSettings,
} from "../model/fluidWorkbench";

// The package has no React/Vue bindings, so the export panel offers the vanilla API only.

function fluidOptions(settings: FluidSettings, indent: string): string[] {
  const lines: string[] = [];
  if (settings.fieldColor !== FLUID_DEFAULTS.fieldColor || settings.fieldLevel !== FLUID_DEFAULTS.fieldLevel)
    lines.push(`field: { color: ${JSON.stringify(settings.fieldColor)}, level: ${settings.fieldLevel} },`);
  if (settings.encoding !== FLUID_DEFAULTS.encoding) lines.push(`encoding: ${JSON.stringify(settings.encoding)},`);
  if (settings.fps !== FLUID_DEFAULTS.fps) lines.push(`fps: ${settings.fps},`);
  if (!settings.worker) lines.push("worker: false,");
  return lines.map((line) => indent + line);
}

export function buildFluidSnippet(settings: FluidSettings, reader: FluidReaderSettings): string {
  const options = fluidOptions(settings, "  ");
  const readerShared = fluidOptions(
    { ...settings, fieldColor: FLUID_DEFAULTS.fieldColor, fieldLevel: FLUID_DEFAULTS.fieldLevel },
    "  ",
  );
  return [
    `import { createGlyphFluid, GlyphFluidTargets } from "@glyphcss/fluid";`,
    `import { createGlyphFluidReader } from "@glyphcss/fluid/reader";`,
    ``,
    `// A fluid filling #stage; the heading stays in the page (color: transparent)`,
    `// and its text condenses out of the field. Move the pointer to stir it.`,
    `const fluid = createGlyphFluid(document.querySelector("#stage")${options.length ? `, {\n${options.join("\n")}\n}` : ""});`,
    `fluid.addTarget(GlyphFluidTargets.text(document.querySelector("#stage h1"), { color: ${JSON.stringify(FLUID_HEADING_COLOR)} }));`,
    ``,
    `// molty's speed reader on a round host, one word at a time with its ORP letter accented.`,
    `const reader = createGlyphFluidReader(document.querySelector("#reader"), {`,
    `  text: ${JSON.stringify(reader.text)},`,
    `  wpm: ${reader.wpm},`,
    `  loop: ${reader.loop ? FLUID_READER_LOOP_MS : "false"},`,
    `  shape: "circle",`,
    ...readerShared,
    `});`,
    ``,
    `// reader.clock.pause(); reader.clock.setWpm(600);`,
    `// fluid.destroy(); reader.destroy();`,
    ``,
  ].join("\n");
}
