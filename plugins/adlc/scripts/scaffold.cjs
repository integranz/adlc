#!/usr/bin/env node
// Deterministic scaffold: renders plugin templates into a target repo according to .adlc/config.yaml.
// usage: node scaffold.cjs [--repo <dir>] [--config <path>] [--force] [--dry-run]
// Layout: templates/common/files/**            -> always
//         templates/<dimension>/<option>/files/** -> when options.<dimension> == option
//         templates/stack/<stack>/app/**        -> into each app path with that stack (context: app + root)
// A `.tmpl` suffix means "render placeholders, strip suffix"; other files are copied verbatim.
// Existing files are left untouched unless --force; .gitignore is merged line-wise.
"use strict";
const fs = require("node:fs"), path = require("node:path");
const { loadConfig, derive, PLUGIN_ROOT } = require("./lib/config.cjs");
const { render } = require("./lib/render.cjs");

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const repo = path.resolve(val("--repo", "."));
const configPath = path.resolve(val("--config", path.join(repo, ".adlc", "config.yaml")));
const force = flag("--force"), dry = flag("--dry-run");
const T = path.join(PLUGIN_ROOT, "templates");

const { config, options, errors } = loadConfig(configPath);
if (errors.length) { console.error(`config invalid (${configPath}):`); errors.forEach(e => console.error(`  - ${e}`)); process.exit(1); }
const ctx = { ...config, derived: derive(config, options) };

function walk(dir) { if (!fs.existsSync(dir)) return []; const out = []; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...walk(p)); else out.push(p); } return out; }
const plan = []; // {src, dest, context, tmpl}
const missing = [];
function addSet(srcRoot, destRoot, context, label) {
  if (!fs.existsSync(srcRoot)) { missing.push(label); return; }
  for (const src of walk(srcRoot)) {
    const rel = path.relative(srcRoot, src);
    const dest = path.join(destRoot, rel.endsWith(".tmpl") ? rel.slice(0, -5) : rel);
    plan.push({ src, dest, context, tmpl: rel.endsWith(".tmpl") });
  }
}
console.log(`scaffold ${config.project.name} -> ${repo}${dry ? " (dry run)" : ""}`);
addSet(path.join(T, "common", "files"), repo, ctx, "common");
for (const [dim, opt] of Object.entries(config.options)) addSet(path.join(T, dim, opt, "files"), repo, ctx, `${dim}=${opt}`);
for (const app of ctx.derived.apps) addSet(path.join(T, "stack", app.stack, "app"), path.join(repo, app.path), { ...ctx, app }, `stack=${app.stack} (${app.name})`);
if (missing.length) console.log(`  (no repo-side templates for: ${missing.join(", ")})`);

// Phase 1: render everything in memory. Any template error aborts before a single file is written.
const rendered = [];
for (const item of plan) {
  const relDest = path.relative(repo, item.dest);
  if (relDest.startsWith("..")) { console.error(`refusing to write outside repo: ${item.dest}`); process.exit(1); }
  let content = fs.readFileSync(item.src, "utf8");
  if (item.tmpl) {
    try { content = render(content, item.context); }
    catch (e) { console.error(`template error in ${path.relative(T, item.src)}: ${e.message}\nnothing was written`); process.exit(1); }
    if (/<%/.test(content)) { console.error(`template error in ${path.relative(T, item.src)}: unrendered '<%' left in output\nnothing was written`); process.exit(1); }
  }
  rendered.push({ ...item, relDest, content });
}

// Phase 2: write.
const summary = { written: 0, skipped: 0, merged: 0 };
for (const item of rendered) {
  const { relDest, content } = item;
  const exists = fs.existsSync(item.dest);
  if (exists && path.basename(item.dest) === ".gitignore" && !force) {
    const have = new Set(fs.readFileSync(item.dest, "utf8").split("\n").map(l => l.trim()));
    const add = content.split("\n").filter(l => l.trim() && !l.startsWith("#") && !have.has(l.trim()));
    if (add.length) { if (!dry) fs.appendFileSync(item.dest, `\n# added by adlc\n${add.join("\n")}\n`); console.log(`  merge   ${relDest} (+${add.length} lines)`); summary.merged++; }
    else { console.log(`  ok      ${relDest} (already complete)`); summary.skipped++; }
    continue;
  }
  if (exists && !force) { console.log(`  skip    ${relDest} (exists; use --force to overwrite)`); summary.skipped++; continue; }
  if (!dry) { fs.mkdirSync(path.dirname(item.dest), { recursive: true }); fs.writeFileSync(item.dest, content); if (/\.(sh|cjs|mjs)$/.test(item.dest)) fs.chmodSync(item.dest, 0o755); }
  console.log(`  ${exists ? "replace" : "write  "} ${relDest}`); summary.written++;
}
if (!dry) fs.mkdirSync(path.join(repo, ".adlc", "evidence"), { recursive: true });
console.log(`done: ${summary.written} written, ${summary.merged} merged, ${summary.skipped} skipped`);
