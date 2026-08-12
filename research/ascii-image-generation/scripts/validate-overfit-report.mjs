import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

const reportPath = process.argv[2];
if (!reportPath) throw new Error("B12_REPORT_PATH_REQUIRED");
const root = resolve(new URL("..", import.meta.url).pathname);
const [schema, report] = await Promise.all([
  readFile(resolve(root, "schema/overfit-keyframe-report.schema.json"), "utf8").then(JSON.parse),
  readFile(resolve(reportPath), "utf8").then(JSON.parse),
]);
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);
if (!validate(report)) throw new Error(`B12_REPORT_SCHEMA:${JSON.stringify(validate.errors)}`);
console.log("B12_REPORT_SCHEMA_VALID");
