/**
 * GlyphSceneStatic — render a scene to its `<pre>` ASCII with **no runtime**.
 *
 * `compileScene` is pure, so this renders the same string on the server (SSR /
 * SSG) and on the client with no hydration mismatch and no WebGL. Use it for
 * static 3D-as-text: a hero, a thumbnail, an OG image source — anything that
 * doesn't need interaction. For an orbit/zoom/FPV scene, use `GlyphScene`.
 */
import { useMemo } from "react";
import type { CSSProperties } from "react";
import { compileScene } from "glyphcss";
import type { CompileSceneOptions } from "glyphcss";

export interface GlyphSceneStaticProps extends CompileSceneOptions {
  className?: string;
  style?: CSSProperties;
}

export function GlyphSceneStatic({ className, style, ...compileOptions }: GlyphSceneStaticProps) {
  const inner = useMemo(() => compileScene(compileOptions).inner, [
    // Re-compile when any compile input changes. Polygons/camera are reference-compared.
    compileOptions.polygons,
    compileOptions.camera,
    compileOptions.autoCenter,
    compileOptions.cols,
    compileOptions.rows,
    compileOptions.cellAspect,
    compileOptions.mode,
    compileOptions.glyphPalette,
    compileOptions.charMode,
    compileOptions.hiddenLines,
    compileOptions.solidWeightRamp,
    compileOptions.colorTolerance,
    compileOptions.colorEncoding,
    compileOptions.atlasPalette,
    compileOptions.fontAtlas,
    compileOptions.useColors,
    compileOptions.smoothShading,
    compileOptions.creaseAngle,
    compileOptions.doubleSided,
    compileOptions.supersample,
    compileOptions.glyphOutput,
    compileOptions.sceneManifest,
    compileOptions.dictionary,
  ]);

  const cls = className ? `glyph-output ${className}` : "glyph-output";
  return <pre className={cls} style={style} dangerouslySetInnerHTML={{ __html: inner }} />;
}
