import {
  bakeSolidTextureSamples,
  parseGltf,
  parseMtl,
  parseObj,
  parseVox,
} from "@layoutit/polycss";
import type { ObjParseOptions } from "@layoutit/polycss";
import type {
  DroppedModelSource,
  LoadedModel,
  ParserOptionsState,
  PresetModel,
} from "../types";
import { mergeParserOptions } from "./parserOptions";

/**
 * Find every .mtl file referenced by an OBJ via its `mtllib` directives.
 * Returns dropped File objects that match (case-insensitive basename).
 */
function findDroppedMtlFiles(
  objText: string,
  droppedFiles: File[],
  index: Map<string, File>,
): File[] {
  const refs = extractObjMtllibRefs(objText);
  const out: File[] = [];
  for (const ref of refs) {
    const match = findDroppedFile(index, ref);
    if (match) out.push(match);
  }
  return out;
}

function extractObjMtllibRefs(objText: string): string[] {
  const refs = new Set<string>();
  for (const line of objText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("mtllib")) continue;
    const tokens = trimmed.slice(6).trim().split(/\s+/).filter(Boolean);
    for (const t of tokens) refs.add(t);
  }
  return [...refs];
}

function buildDroppedFileIndex(files: File[]): Map<string, File> {
  const map = new Map<string, File>();
  for (const f of files) {
    const name = f.name.toLowerCase();
    if (!map.has(name)) map.set(name, f);
  }
  return map;
}

function findDroppedFile(index: Map<string, File>, path: string): File | undefined {
  const basename = path.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  return index.get(basename);
}

export async function loadPresetModel(
  model: PresetModel,
  parser: ParserOptionsState,
): Promise<LoadedModel> {
  const started = performance.now();
  if (model.kind === "obj") {
    const [objText, mtlText] = await Promise.all([
      fetch(model.url).then((res) => {
        if (!res.ok) throw new Error(`fetch ${model.url} -> ${res.status}`);
        return res.text();
      }),
      model.mtlUrl
        ? fetch(model.mtlUrl).then((res) => (res.ok ? res.text() : null))
        : Promise.resolve(null),
    ]);

    const mtl = mtlText ? parseMtl(mtlText) : { colors: {}, textures: {} };
    const resolvedTextures: Record<string, string> = {};
    for (const [name, path] of Object.entries(mtl.textures)) {
      resolvedTextures[name] = model.mtlUrl
        ? new URL(path, new URL(model.mtlUrl, window.location.href)).href
        : path;
    }

    const options = mergeParserOptions(model.options, parser);
    const parsedObj = parseObj(objText, {
      ...options,
      materialColors: {
        ...mtl.colors,
        ...((model.options as ObjParseOptions | undefined)?.materialColors ?? {}),
      },
      materialTextures: {
        ...resolvedTextures,
        ...((model.options as ObjParseOptions | undefined)?.materialTextures ?? {}),
      },
    });
    const parsed = await bakeSolidTextureSamples(parsedObj);
    return {
      label: model.label,
      kind: "obj",
      rawPolygons: parsed.polygons,
      polygons: parsed.polygons,
      sourcePolygons: parsed.polygons.length,
      sourceBytes: objText.length + (mtlText?.length ?? 0),
      warnings: parsed.warnings ?? [],
      parseMs: performance.now() - started,
      dispose: parsed.dispose,
    };
  }

  const buf = await fetch(model.url).then((res) => {
    if (!res.ok) throw new Error(`fetch ${model.url} -> ${res.status}`);
    return res.arrayBuffer();
  });

  if (model.kind === "vox") {
    const parsed = parseVox(buf, mergeParserOptions(model.options, parser));
    return {
      label: model.label,
      kind: "vox",
      rawPolygons: parsed.polygons,
      polygons: parsed.polygons,
      sourcePolygons: parsed.polygons.length,
      sourceBytes: buf.byteLength,
      warnings: parsed.warnings ?? [],
      parseMs: performance.now() - started,
      dispose: parsed.dispose,
    };
  }

  const parsedGltf = parseGltf(buf, {
    ...mergeParserOptions(model.options, parser),
    baseUrl: new URL(model.url, window.location.href).href,
  });
  const parsed = await bakeSolidTextureSamples(parsedGltf);
  return {
    label: model.label,
    kind: model.kind,
    rawPolygons: parsed.polygons,
    polygons: parsed.polygons,
    sourcePolygons: parsed.polygons.length,
    sourceBytes: buf.byteLength,
    warnings: parsed.warnings ?? [],
    parseMs: performance.now() - started,
    dispose: parsed.dispose,
    animation: parsed.animation,
  };
}

export async function loadDroppedModel(
  source: DroppedModelSource,
  parser: ParserOptionsState,
): Promise<LoadedModel> {
  const started = performance.now();
  const options = mergeParserOptions(source.preset.options, parser);
  const sourceBytes = source.files.reduce((sum, file) => sum + file.size, 0);

  if (source.kind === "obj") {
    const objText = await source.primaryFile.text();
    const index = buildDroppedFileIndex(source.files);
    const mtllibRefs = extractObjMtllibRefs(objText);
    const mtlFiles = findDroppedMtlFiles(objText, source.files, index);
    const warnings: string[] = [];
    const objectUrls: string[] = [];

    if (mtllibRefs.length > 0 && mtlFiles.length === 0) {
      warnings.push(`OBJ references ${mtllibRefs.join(", ")} but no matching .mtl file was dropped.`);
    }

    const materialColors: Record<string, string> = {};
    const materialTextures: Record<string, string> = {};
    for (const mtlFile of mtlFiles) {
      const mtl = parseMtl(await mtlFile.text());
      Object.assign(materialColors, mtl.colors);
      for (const [materialName, texturePath] of Object.entries(mtl.textures)) {
        const textureFile = findDroppedFile(index, texturePath);
        if (!textureFile) {
          warnings.push(`MTL texture "${texturePath}" was not dropped.`);
          continue;
        }
        if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
          warnings.push(`MTL texture "${texturePath}" cannot be loaded because object URLs are unavailable.`);
          continue;
        }
        const textureUrl = URL.createObjectURL(textureFile);
        objectUrls.push(textureUrl);
        materialTextures[materialName] = textureUrl;
      }
    }

    const presetOptions = source.preset.options as ObjParseOptions | undefined;
    const parsedObj = parseObj(objText, {
      ...options,
      materialColors: {
        ...materialColors,
        ...(presetOptions?.materialColors ?? {}),
      },
      materialTextures: {
        ...materialTextures,
        ...(presetOptions?.materialTextures ?? {}),
      },
    });
    const parsed = await bakeSolidTextureSamples(parsedObj);
    let disposed = false;
    return {
      label: source.label,
      kind: "obj",
      rawPolygons: parsed.polygons,
      polygons: parsed.polygons,
      sourcePolygons: parsed.polygons.length,
      sourceBytes,
      warnings: [...(parsed.warnings ?? []), ...warnings],
      parseMs: performance.now() - started,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        parsed.dispose();
        for (const url of objectUrls) URL.revokeObjectURL(url);
      },
    };
  }

  const buf = await source.primaryFile.arrayBuffer();

  if (source.kind === "vox") {
    const parsed = parseVox(buf, options);
    return {
      label: source.label,
      kind: "vox",
      rawPolygons: parsed.polygons,
      polygons: parsed.polygons,
      sourcePolygons: parsed.polygons.length,
      sourceBytes,
      warnings: parsed.warnings ?? [],
      parseMs: performance.now() - started,
      dispose: parsed.dispose,
    };
  }

  const parsedGltf = parseGltf(buf, options);
  const parsed = await bakeSolidTextureSamples(parsedGltf);
  return {
    label: source.label,
    kind: "glb",
    rawPolygons: parsed.polygons,
    polygons: parsed.polygons,
    sourcePolygons: parsed.polygons.length,
    sourceBytes,
    warnings: parsed.warnings ?? [],
    parseMs: performance.now() - started,
    dispose: parsed.dispose,
    animation: parsed.animation,
  };
}
