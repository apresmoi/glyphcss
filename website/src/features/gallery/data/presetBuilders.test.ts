import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { galleryFileUrl, presetIdFromFile } from "./presetBuilders";

it("keeps ampersand filenames resolvable by the dev server without changing preset IDs", () => {
  const file = "urban/Planter & Bushes.glb";
  const url = new URL(galleryFileUrl("glb", file), "http://localhost");
  const publicDirectory = fileURLToPath(new URL("../../../../public", import.meta.url));
  expect(decodeURI(url.pathname)).toBe(`/gallery/glb/${file}`);
  expect(existsSync(publicDirectory + decodeURI(url.pathname))).toBe(true);
  expect(url.search).toBe("");
  expect(presetIdFromFile("glb", file)).toBe("glb-urban-planter-bushes");
});
