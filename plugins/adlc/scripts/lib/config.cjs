"use strict";
const fs = require("node:fs"), path = require("node:path");
const yaml = require("./js-yaml.min.js");
const validateSchema = require("./validate-config.generated.cjs");

const PLUGIN_ROOT = path.resolve(__dirname, "..", "..");
const OPTIONS_PATH = path.join(PLUGIN_ROOT, "templates", "common", "adlc", "options.yaml");

function loadYaml(file) { return yaml.load(fs.readFileSync(file, "utf8")); }
function loadOptions() { return loadYaml(OPTIONS_PATH); }
function pluginVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8")).version || "0.0.0"; }
  catch { return "0.0.0"; }
}

// Returns a list of human-readable errors (empty = valid).
function checkConfig(config, options) {
  const errors = [];
  if (!validateSchema(config)) {
    for (const e of validateSchema.errors) errors.push(`schema: ${e.instancePath || "/"} ${e.message}`);
    return errors; // shape errors first; option checks assume a valid shape
  }
  const dims = options.dimensions;
  const implemented = (dim) => Object.entries(dims[dim].options).filter(([, o]) => o.status === "implemented").map(([k]) => k);
  for (const [dim, value] of Object.entries(config.options)) {
    const d = dims[dim];
    if (!d) { errors.push(`options.${dim}: unknown dimension`); continue; }
    const opt = d.options[value];
    if (!opt) { errors.push(`options.${dim}=${value}: unknown option. Implemented: ${implemented(dim).join(", ")}`); continue; }
    if (opt.status !== "implemented") {
      errors.push(`options.${dim}=${value} is '${opt.status}' and not selectable yet${opt.note ? ` (${opt.note})` : ""}. Implemented: ${implemented(dim).join(", ")}`);
    }
    if (opt.cloud && opt.cloud !== config.options.cloud) {
      errors.push(`options.${dim}=${value} requires cloud=${opt.cloud} but cloud=${config.options.cloud}`);
    }
  }
  // per-app stack checks
  const stackOpts = dims.stack.options;
  const names = new Set();
  for (const app of config.apps) {
    if (names.has(app.name)) errors.push(`apps: duplicate app name '${app.name}'`); names.add(app.name);
    const s = stackOpts[app.stack];
    if (!s) { errors.push(`apps.${app.name}.stack=${app.stack}: unknown stack`); continue; }
    if (s.status !== "implemented") errors.push(`apps.${app.name}.stack=${app.stack} is '${s.status}' and not selectable yet. Implemented: ${Object.entries(stackOpts).filter(([, o]) => o.status === "implemented").map(([k]) => k).join(", ")}`);
    if (s.kinds && !s.kinds.includes(app.kind)) errors.push(`apps.${app.name}: stack ${app.stack} supports kinds [${s.kinds.join(", ")}], not '${app.kind}'`);
  }
  for (const app of config.apps) for (const up of app.upstreams || []) {
    if (!names.has(up)) errors.push(`apps.${app.name}.upstreams: '${up}' is not an app in this config`);
  }
  const envs = config.environments; if (new Set(envs).size !== envs.length) errors.push("environments: duplicate names");
  if (config.options.branching === "gitflow" && !envs.includes("dev")) errors.push("branching=gitflow expects a 'dev' environment for the develop branch");
  return errors;
}

function loadConfig(file) {
  if (!fs.existsSync(file)) throw new Error(`config not found: ${file}`);
  const config = loadYaml(file);
  const options = loadOptions();
  const errors = checkConfig(config, options);
  return { config, options, errors };
}

// Values derived from config used by templates.
function derive(config, options) {
  const registryHost = config.options.registry === "acr" ? `${config.azure.acr_name}.azurecr.io`
    : config.options.registry === "ghcr" ? "ghcr.io" : "<registry>";
  const apps = config.apps.map(a => ({ ...a, image: `${registryHost}/${a.image_repository}` }));
  return {
    plugin_version: pluginVersion(),
    marketplace: { name: options.distribution.marketplace, repo: options.distribution.repo, plugin: options.distribution.plugin },
    registry_host: registryHost,
    apps,
    has_frontend: apps.some(a => a.kind === "frontend"),
    has_worker: apps.some(a => a.kind === "worker"),
    option_labels: Object.fromEntries(Object.entries(config.options).map(([dim, v]) => [dim, options.dimensions[dim].options[v]?.label || v])),
    option_rows: Object.entries(config.options).map(([dim, v]) => ({ dimension: dim, option: v, label: options.dimensions[dim].options[v]?.label || v, status: options.dimensions[dim].options[v]?.status || "unknown" })),
  };
}

module.exports = { PLUGIN_ROOT, OPTIONS_PATH, loadYaml, loadOptions, loadConfig, checkConfig, derive, pluginVersion };
