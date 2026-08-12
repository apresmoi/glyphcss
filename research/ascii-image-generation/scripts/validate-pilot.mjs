import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateNativePilotDataset } from "../src/native-pilot.mjs";

const args = process.argv.slice(2);
const [datasetRoot, ...rest] = args;
const reportIndex = rest.indexOf("--report");
if (!datasetRoot || reportIndex < 0 || !rest[reportIndex + 1] || !rest.includes("--check")) throw new Error("usage: validate-pilot.mjs <remote-root> --report <manifest> --check");
const root = resolve(import.meta.dirname, "..");
const config = JSON.parse(await readFile(join(root, "config/pilot.json"), "utf8"));
if (config.schemaVersion !== "glyph-pilot-config/v2") throw new Error("PILOT_NATIVE_CONFIG_INVALID");
const result = await validateNativePilotDataset({ datasetRoot, reportPath: resolve(rest[reportIndex + 1]), config });
process.stdout.write(`${JSON.stringify({ status: "complete", ...result }, null, 2)}\n`);
