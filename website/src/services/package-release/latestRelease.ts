export const PACKAGE_URL = "https://www.npmjs.com/package/glyphcss";

/** Read the published dist-tag, which can change independently of a website deploy. */
export async function latestRelease(signal?: AbortSignal): Promise<string | null> {
  try {
    const response = await fetch("https://registry.npmjs.org/glyphcss/latest", { signal });
    if (!response.ok) return null;
    const release: unknown = await response.json();
    if (!release || typeof release !== "object" || !("version" in release)) return null;
    return typeof release.version === "string" && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(release.version)
      ? release.version
      : null;
  } catch {
    return null;
  }
}
