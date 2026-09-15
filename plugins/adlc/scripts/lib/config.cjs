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
// Deterministic build defaults per stack; repoRoot is needed to detect the .NET project file.
function buildDefaults(app, repoRoot) {
  const b = { ...(app.build || {}) };
  if (app.stack === "dotnet8-api") {
    b.dotnet_version = b.dotnet_version || "8.0";
    if (!b.project && repoRoot) {
      const dir = path.join(repoRoot, app.path);
      const found = [];
      const walk = (d, depth) => { if (depth > 4 || !fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) { if (!/^(bin|obj|node_modules|\.git)$/.test(e.name)) walk(path.join(d, e.name), depth + 1); }
        else if (e.name.endsWith(".csproj") && !/test/i.test(path.relative(dir, path.join(d, e.name)))) found.push(path.relative(dir, path.join(d, e.name))); } };
      walk(dir, 0);
      if (found.length === 1) b.project = found[0].split(path.sep).join("/");
      else if (found.length > 1) b.error = `apps.${app.name}: several .csproj candidates (${found.join(", ")}); set build.project in .adlc/config.yaml`;
      else b.error = `apps.${app.name}: no .csproj found under ${app.path}; set build.project in .adlc/config.yaml`;
    }
    if (!b.assembly && b.project) b.assembly = path.basename(b.project, ".csproj");
    b.project_dir = b.project ? path.dirname(b.project) : ".";
  }
  if (app.stack === "react-vite" || app.stack === "node-ts-api") { b.node_version = b.node_version || "22"; b.dist_dir = b.dist_dir || "dist"; }
  if (app.stack === "react-vite") b.nginx_version = b.nginx_version || "1.29";
  return b;
}

function derive(config, options, repoRoot) {
  const registryHost = config.options.registry === "acr" ? `${config.azure.acr_name}.azurecr.io`
    : config.options.registry === "ghcr" ? "ghcr.io" : "<registry>";
  const byName = Object.fromEntries(config.apps.map(a => [a.name, a]));
  // Upstream reachability differs per compute: on Container Apps every app is reachable as http://<app-name> (port 80,
  // through the environment proxy); in local docker compose the service name resolves and the container port is used.
  const apps = config.apps.map((a, i) => {
    const upstreams = (a.upstreams || []).map(n => ({ name: n, port: byName[n]?.port || 8080, path_prefix: "/api/",
      url_cloud: config.options.compute === "aca" ? `http://${n}` : `http://${n}:${byName[n]?.port || 8080}`,
      url_local: `http://${n}:${byName[n]?.port || 8080}` }));
    return { ...a, image: `${registryHost}/${a.image_repository}`, image_local: `${config.project.name}/${a.name}`, local_port: 8080 + i,
      is_node: a.stack === "react-vite" || a.stack === "node-ts-api", is_dotnet: a.stack.startsWith("dotnet"),
      build: buildDefaults(a, repoRoot), upstream_list: upstreams, primary_upstream: upstreams[0] || null };
  });
  return {
    env: config.environments[0],
    plugin_version: pluginVersion(),
    marketplace: { name: options.distribution.marketplace, repo: options.distribution.repo, plugin: options.distribution.plugin },
    registry_host: registryHost,
    apps,
    has_frontend: apps.some(a => a.kind === "frontend"),
    has_dotnet: apps.some(a => a.stack.startsWith("dotnet")),
    has_node: apps.some(a => a.stack === "react-vite" || a.stack === "node-ts-api"),
    has_worker: apps.some(a => a.kind === "worker"),
    option_labels: Object.fromEntries(Object.entries(config.options).map(([dim, v]) => [dim, options.dimensions[dim].options[v]?.label || v])),
    option_rows: Object.entries(config.options).map(([dim, v]) => ({ dimension: dim, option: v, label: options.dimensions[dim].options[v]?.label || v, status: options.dimensions[dim].options[v]?.status || "unknown" })),
  };
}

module.exports = { PLUGIN_ROOT, OPTIONS_PATH, loadYaml, loadOptions, loadConfig, checkConfig, derive, pluginVersion };
