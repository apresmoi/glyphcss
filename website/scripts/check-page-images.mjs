import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import { websiteRoot } from "./metadata.mjs";

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory()
      ? htmlFiles(file)
      : entry.name.endsWith(".html")
        ? [file]
        : [];
  });
}

export function checkPageImages(dist, mutate = () => {}) {
  const errors = [];
  const handCards = new Map();
  let count = 0;
  for (const file of htmlFiles(dist)) {
    const route = path.relative(dist, file);
    const window = new Window();
    try {
      window.document.write(readFileSync(file, "utf8"));
      const document = window.document;
      mutate(document, route);
      const og = [...document.querySelectorAll('meta[property="og:image"]')];
      const twitter = [
        ...document.querySelectorAll('meta[name="twitter:image"]'),
      ];
      if (og.length !== 1 || twitter.length !== 1) {
        errors.push(`${route}: expected one og:image and one twitter:image`);
        continue;
      }
      count++;
      const value = og[0].getAttribute("content");
      if (twitter[0].getAttribute("content") !== value)
        errors.push(`${route}: Twitter image differs from OG image`);
      let url;
      try {
        url = new URL(value);
      } catch {
        errors.push(`${route}: invalid OG URL ${value}`);
        continue;
      }
      if (url.origin !== "https://glyphcss.com")
        errors.push(`${route}: OG image must be a local site file`);
      const local = path.resolve(dist, `.${decodeURIComponent(url.pathname)}`);
      if (
        !local.startsWith(path.resolve(dist) + path.sep) ||
        !existsSync(local) ||
        !statSync(local).isFile()
      )
        errors.push(`${route}: missing OG image ${url.pathname}`);
      {
        const previous = handCards.get(url.pathname);
        if (previous)
          errors.push(
            `${route}: shares OG image ${url.pathname} with ${previous}`,
          );
        else handCards.set(url.pathname, route);
      }
    } finally {
      window.happyDOM.abort();
    }
  }
  return { count, errors };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const dist = path.join(websiteRoot, "dist");
  const result = checkPageImages(dist);
  if (process.argv.includes("--mutation-check")) {
    assert.ok(
      checkPageImages(dist, (document) => {
        for (const meta of document.querySelectorAll(
          'meta[property="og:image"], meta[name="twitter:image"]',
        ))
          meta.setAttribute(
            "content",
            "https://glyphcss.com/og/__missing__.png",
          );
      }).errors.some((error) => error.includes("missing OG image")),
      "missing-image mutation must fail",
    );
    assert.ok(
      checkPageImages(dist, (document) => {
        for (const meta of document.querySelectorAll(
          'meta[property="og:image"], meta[name="twitter:image"]',
        ))
          meta.setAttribute("content", "https://glyphcss.com/og.png");
      }).errors.some((error) => error.includes("shares OG image")),
      "shared-card mutation must fail",
    );
    console.log("Missing-image and shared-card mutations rejected.");
  }
  if (result.errors.length) {
    console.error(result.errors.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `${result.count} built pages: local OG/Twitter images exist; hand-rolled cards are unique.`,
    );
}
