import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { buildNativePilotDataset } from "../src/native-pilot.mjs";

const root = resolve(import.meta.dirname, "..");
const args = process.argv.slice(2);
const value = (flag) => { const index = args.indexOf(flag); return index < 0 ? null : args[index + 1]; };
const configPath = resolve(value("--config") ?? join(root, "config/pilot.json"));
const outputRoot = value("--output");
if (!outputRoot) throw new Error("USAGE: build-native-pilot.mjs --output <remote-pilot-root> [--config <path>]");
const config = JSON.parse(await readFile(configPath, "utf8"));
if (config.schemaVersion !== "glyph-pilot-config/v2") throw new Error("PILOT_NATIVE_CONFIG_INVALID");
const resolveResearch = (path) => resolve(root, path);
const built = await buildNativePilotDataset({ outputRoot, config, admissionReportPath: resolveResearch(config.admissionReport), assetCorpusRoot: config.assetCorpusRoot, assetRegistryPath: resolveResearch(config.assetRegistry) });
process.stdout.write(`${JSON.stringify({ status: built.manifest.status, records: built.manifest.records.length, reportPath: built.reportPath }, null, 2)}\n`);
