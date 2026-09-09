// Validates templates/common/adlc/config.example.yaml against config.schema.json.
import fs from "node:fs";
import yaml from "js-yaml";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
const base = "plugins/adlc/templates/common/adlc";
const schema = JSON.parse(fs.readFileSync(`${base}/config.schema.json`, "utf8"));
const data = yaml.load(fs.readFileSync(`${base}/config.example.yaml`, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const ok = ajv.validate(schema, data);
if (!ok) { console.error(JSON.stringify(ajv.errors, null, 2)); process.exit(1); }
console.log("config.example.yaml is valid against config.schema.json");
