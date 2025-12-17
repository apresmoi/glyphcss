import path from "node:path";

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

export async function resolve(specifier, context, defaultResolve) {
  if (specifier.startsWith("node:")) {
    return defaultResolve(specifier, context, defaultResolve);
  }

  const isRelative =
    specifier.startsWith("./") ||
    specifier.startsWith("../") ||
    specifier.startsWith("/") ||
    specifier.startsWith("file:");
  if (!isRelative) {
    return defaultResolve(specifier, context, defaultResolve);
  }

  const withoutQuery = specifier.split("?")[0];
  const hasExtension = Boolean(withoutQuery && path.extname(withoutQuery));
  if (hasExtension) {
    return defaultResolve(specifier, context, defaultResolve);
  }

  const candidates = [];
  for (const ext of EXTENSIONS) {
    candidates.push(`${specifier}${ext}`);
  }
  for (const ext of EXTENSIONS) {
    candidates.push(`${specifier}/index${ext}`);
  }

  for (const candidate of candidates) {
    try {
      return await defaultResolve(candidate, context, defaultResolve);
    } catch {
      // keep trying
    }
  }

  return defaultResolve(specifier, context, defaultResolve);
}

