import { runCorpus } from "../src/generate-controls.mjs";

const args = process.argv.slice(2);
const index = args.indexOf("--config");
if (index < 0 || !args[index + 1]) throw new Error("generate:controls requires --config <path>");
const manifest = await runCorpus(args[index + 1], { fixture: args.includes("--fixture"), check: args.includes("--check") });
process.stdout.write(`${JSON.stringify({ id: manifest.id, contentSha256: manifest.contentSha256 })}\n`);
