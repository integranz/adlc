#!/usr/bin/env node
// Deterministic post-deployment verification for adlc (cloud=azure, compute=aca, runner=github-actions).
// usage: node verify.cjs <env> <tag> [--repo <dir>] [--json] [--evidence <path>]
// Every claim is a literal comparison with the command that produced the evidence. Exit 0 = all CONFIRMED,
// 2 = at least one REFUTED, 3 = only UNVERIFIABLE issues. Nothing here mutates anything.
"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { execFileSync, spawnSync } = require("node:child_process");
const { loadConfig } = require("./lib/config.cjs");

const args = process.argv.slice(2); const flag = n => args.includes(n); const val = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const [env, tag] = args.filter(a => !a.startsWith("--") && ![val("--repo"), val("--evidence")].includes(a));
if (!env || !tag) { console.error("usage: verify.cjs <env> <tag> [--repo <dir>] [--json] [--evidence <path>]"); process.exit(1); }
const repo = path.resolve(val("--repo", "."));
const { config, errors } = loadConfig(path.join(repo, ".adlc", "config.yaml"));
if (errors.length) { console.error("config invalid:\n  " + errors.join("\n  ")); process.exit(1); }
if (!config.environments.includes(env)) { console.error(`environment '${env}' is not in .adlc/config.yaml`); process.exit(1); }
if (!/^[0-9]+\.[0-9]+\.[0-9]+/.test(tag)) { console.error(`'${tag}' is not a semver tag`); process.exit(1); }

const claims = [];
const record = (claim, verdict, evidence) => claims.push({ claim, verdict, evidence: String(evidence).replace(/\s+/g, " ").trim().slice(0, 400) });
const sh = (cmd, cmdArgs, opts = {}) => { const r = spawnSync(cmd, cmdArgs, { encoding: "utf8", timeout: opts.timeout || 120000, cwd: opts.cwd || repo, env: { ...process.env, ...(opts.env || {}) } }); return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim(), status: r.status }; };
const have = cmd => spawnSync(cmd, ["--version"], { encoding: "utf8" }).status === 0;
async function http(url, { timeout = 20000 } = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try { const r = await fetch(url, { redirect: "manual", signal: ctl.signal }); const body = await r.text(); return { status: r.status, body, location: r.headers.get("location") }; }
  catch (e) { return { status: 0, body: String(e), location: null }; } finally { clearTimeout(t); }
}

(async () => {
  const owner = config.github?.owner, repoName = config.github?.repo, ghRepo = `${owner}/${repoName}`;
  const acr = config.azure?.acr_name, rg = config.azure?.resource_group;
  // ---- 1. CD run and evidence artifact ----
  let outputs = null, runId = null;
  if (have("gh")) {
    const a = sh("gh", ["api", `repos/${ghRepo}/actions/artifacts?name=deploy-evidence-${env}-${tag}&per_page=5`, "--jq", ".artifacts | sort_by(.created_at) | last | \"\\(.workflow_run.id) \\(.name) \\(.created_at)\""]);
    if (a.ok && a.out && !a.out.startsWith("null")) {
      runId = a.out.split(" ")[0];
      const run = sh("gh", ["run", "view", "-R", ghRepo, runId, "--json", "conclusion,jobs", "--jq", "\"\\(.conclusion) | \" + ([.jobs[] | \"\\(.name)=\\(.conclusion)\"] | join(\", \"))"]);
      record(`CD run for ${tag} → ${env} succeeded`, run.ok && run.out.startsWith("success") ? "CONFIRMED" : "REFUTED", `gh run view ${runId} → ${run.out || run.err}`);
      const ap = sh("gh", ["api", `repos/${ghRepo}/actions/runs/${runId}/approvals`, "--jq", ".[] | \"\\(.state) by \\(.user.login) for \\([.environments[].name]|join(\",\"))\""]);
      record(`Deployment was approved by a human on environment '${env}'`, ap.ok && /approved by \S+/.test(ap.out) ? "CONFIRMED" : "UNVERIFIABLE", `run approvals → ${ap.out || "(none)"}`);
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "adlc-verify-"));
      const dl = sh("gh", ["run", "download", "-R", ghRepo, runId, "-n", `deploy-evidence-${env}-${tag}`, "-D", tmp]);
      if (dl.ok && fs.existsSync(path.join(tmp, "outputs.json"))) { outputs = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(path.join(tmp, "outputs.json"), "utf8"))).map(([k, v]) => [k, v.value])); record("Deploy evidence artifact present with Terraform outputs", "CONFIRMED", `artifact deploy-evidence-${env}-${tag}: ${Object.keys(outputs).length} outputs`); }
      else record("Deploy evidence artifact present with Terraform outputs", "REFUTED", dl.err || dl.out);
    } else record(`CD run for ${tag} → ${env} exists (artifact deploy-evidence-${env}-${tag})`, "REFUTED", a.err || `no artifact deploy-evidence-${env}-${tag} in ${ghRepo}`);
  } else record("CD run lookup", "UNVERIFIABLE", "gh CLI not available");
  if (!outputs) {
    // fall back to live Terraform outputs (read-only) when the artifact is missing
    const o = sh("terraform", ["-chdir=infra/app", "output", "-json"], { env: { TF_IN_AUTOMATION: "1" } });
    if (o.ok) { try { outputs = Object.fromEntries(Object.entries(JSON.parse(o.out)).map(([k, v]) => [k, v.value])); } catch {} }
  }
  if (outputs && outputs.image_tag !== undefined) record("Deployed image_tag output equals the requested tag", outputs.image_tag === tag ? "CONFIRMED" : "REFUTED", `outputs.image_tag=${outputs.image_tag}`);

  // ---- 2. HTTP checks per app ----
  for (const app of config.apps) {
    if (app.kind === "worker") continue;
    const url = outputs?.[`${app.name}_url`]; if (!url) { record(`${app.name}: URL known`, "UNVERIFIABLE", "no <app>_url output"); continue; }
    const health = outputs[`${app.name}_health_url`] || url + (app.health_path || "/");
    const r = await http(health);
    if (r.status !== 200) { record(`${app.name}: ${health} answers 200`, "REFUTED", `HTTP ${r.status} ${r.body.slice(0, 80)}`); continue; }
    if (r.body.trim().startsWith("{")) { let v = null; try { v = JSON.parse(r.body).version; } catch {} record(`${app.name}: health reports version ${tag}`, v === tag ? "CONFIRMED" : "REFUTED", `GET ${health} → 200 version=${v}`); }
    else {
      record(`${app.name}: ${health} answers 200`, "CONFIRMED", `GET ${health} → 200`);
      const m = r.body.match(/assets\/index-[A-Za-z0-9_-]+\.js/); if (m) { const js = await http(url + "/" + m[0]); const n = (js.body.match(new RegExp(tag.replace(/\./g, "\\."), "g")) || []).length; record(`${app.name}: bundle carries version ${tag}`, n > 0 ? "CONFIRMED" : "REFUTED", `${m[0]}: ${n} occurrence(s)`); }
    }
    for (const up of app.upstreams || []) { const upApp = config.apps.find(a => a.name === up); const px = await http(url + "/api" + (upApp?.health_path || "/health")); let v = null; try { v = JSON.parse(px.body).version; } catch {} record(`${app.name} → ${up}: proxied ${"/api" + (upApp?.health_path || "/health")} answers with version ${tag}`, px.status === 200 && v === tag ? "CONFIRMED" : "REFUTED", `GET ${url}/api${upApp?.health_path || "/health"} → ${px.status} version=${v}`); }
    const plain = await http(url.replace(/^https:/, "http:") + (app.health_path || "/"));
    record(`${app.name}: HTTP redirects to HTTPS`, [301, 302, 307, 308].includes(plain.status) && /^https:/.test(plain.location || "") ? "CONFIRMED" : "REFUTED", `GET http → ${plain.status} ${plain.location || ""}`);
  }

  // ---- 3. Azure: revisions, images, registry digests ----
  if (have("az") && config.options.compute === "aca") {
    for (const app of config.apps) {
      const rev = sh("az", ["containerapp", "revision", "list", "-n", app.name, "-g", rg, "--query", "[?properties.active] | [0].{name:name,image:properties.template.containers[0].image,traffic:properties.trafficWeight,health:properties.healthState,running:properties.runningState}", "-o", "json"]);
      if (!rev.ok || !rev.out || rev.out === "null") { record(`${app.name}: active revision`, "UNVERIFIABLE", rev.err.split("\n")[0] || "no active revision found"); continue; }
      const j = JSON.parse(rev.out); const expected = `${acr}.azurecr.io/${app.image_repository}:${tag}`;
      record(`${app.name}: active revision runs ${expected}`, j.image === expected ? "CONFIRMED" : "REFUTED", `revision ${j.name} image=${j.image}`);
      record(`${app.name}: active revision Healthy/Running with 100 % traffic`, j.health === "Healthy" && j.running === "Running" && j.traffic === 100 ? "CONFIRMED" : "REFUTED", `health=${j.health} running=${j.running} traffic=${j.traffic}`);
      const dig = sh("az", ["acr", "repository", "show", "-n", acr, "--image", `${app.image_repository}:${tag}`, "--query", "digest", "-o", "tsv"]);
      record(`${app.name}: registry holds ${app.image_repository}:${tag}`, dig.ok && /^sha256:/.test(dig.out) ? "CONFIRMED" : "REFUTED", dig.ok && dig.out ? `az acr repository show → digest ${dig.out.slice(0, 23)}…` : (dig.err.split("\n")[0] || "no digest returned"));
    }
  } else record("Azure revision checks", "UNVERIFIABLE", "az CLI not available or compute is not aca");

  // ---- 4. No drift (read-only plan) ----
  if (have("terraform") && fs.existsSync(path.join(repo, "infra", "app"))) {
    const init = sh("terraform", ["-chdir=infra/app", "init", "-input=false", "-no-color"], { timeout: 240000, env: { TF_IN_AUTOMATION: "1" } });
    if (init.ok) {
      const planFile = path.join(os.tmpdir(), `adlc-verify-${process.pid}.plan`);
      const p = sh("terraform", ["-chdir=infra/app", "plan", "-input=false", "-no-color", "-detailed-exitcode", "-lock=false", "-var", `image_tag=${tag}`, `-out=${planFile}`], { timeout: 300000, env: { TF_IN_AUTOMATION: "1" } });
      if (p.status === 0) record("App layer has no drift (terraform plan -detailed-exitcode)", "CONFIRMED", "exit 0: No changes");
      else if (p.status === 2) {
        // exit 2 covers output-only refreshes too; drift means a resource would change
        const show = sh("terraform", ["-chdir=infra/app", "show", "-json", planFile], { timeout: 120000, env: { TF_IN_AUTOMATION: "1" } });
        let resChanges = null, outChanges = [];
        try { const j = JSON.parse(show.out); resChanges = (j.resource_changes || []).filter(r => r.change.actions.join("/") !== "no-op").map(r => `${r.address} (${r.change.actions.join("/")})`); outChanges = Object.entries(j.output_changes || {}).filter(([, v]) => v.actions.join("/") !== "no-op").map(([k]) => k); } catch {}
        if (resChanges && resChanges.length === 0) record("App layer has no drift (no resource changes; outputs refresh only)", "CONFIRMED", `plan exit 2 with 0 resource changes; outputs to refresh: ${outChanges.join(", ") || "none listed"}`);
        else record("App layer has no drift (terraform plan -detailed-exitcode)", "REFUTED", resChanges ? `resource changes pending: ${resChanges.join("; ")}` : (p.out.match(/^Plan:.*$/m) || ["changes pending"])[0]);
      } else record("App layer has no drift", "UNVERIFIABLE", p.err.split("\n")[0] || "plan error");
      try { fs.unlinkSync(planFile); } catch {}
    }
    else record("App layer has no drift", "UNVERIFIABLE", `terraform init failed: ${init.err.split("\n").find(l => /Error|error/.test(l)) || init.err.slice(0, 120)}`);
  }

  // ---- 5. Repo hygiene ----
  const st = sh("git", ["status", "--porcelain"]);
  const dirty = st.out.split("\n").filter(l => l.trim() && !/\s\.adlc\/evidence\//.test(l)); // the verifier's own evidence files are committed afterwards
  record("Working tree clean apart from .adlc/evidence (no state/plan/secret files staged)", st.ok && dirty.length === 0 ? "CONFIRMED" : "REFUTED", dirty.length ? dirty.slice(0, 3).join("; ") : "git status --porcelain → nothing outside .adlc/evidence");
  const tracked = sh("git", ["ls-files"]); const bad = tracked.out.split("\n").filter(f => /(^|\/)(\.env(\..*)?|.*\.tfstate(\..*)?|.*\.tfvars|tfplan.*|.*\.pem|.*\.key)$/.test(f) && !/\.example$/.test(f));
  record("No state, plan, tfvars or key files are tracked in git", bad.length === 0 ? "CONFIRMED" : "REFUTED", bad.length ? bad.join(", ") : "git ls-files → none matched");

  // ---- report ----
  const counts = { CONFIRMED: 0, REFUTED: 0, UNVERIFIABLE: 0 }; for (const c of claims) counts[c.verdict]++;
  const date = new Date().toISOString().slice(0, 10);
  const md = [`# Verification: ${env} ${tag} (${date})`, "", runId ? `Deployment: https://github.com/${ghRepo}/actions/runs/${runId}` : "Deployment run: not found", "",
    "| # | Claim | Verdict | Evidence |", "|---|---|---|---|", ...claims.map((c, i) => `| ${i + 1} | ${c.claim} | ${c.verdict} | ${c.evidence.replace(/\|/g, "\\|")} |`), "",
    `Result: ${counts.CONFIRMED} confirmed / ${counts.REFUTED} refuted / ${counts.UNVERIFIABLE} unverifiable`,
    ...(outputs ? ["", ...Object.entries(outputs).filter(([k]) => k.endsWith("_url") && !k.endsWith("_health_url")).map(([k, v]) => `- ${k}: ${v}`)] : [])].join("\n") + "\n";
  const evidencePath = val("--evidence", path.join(repo, ".adlc", "evidence", `${tag}.md`));
  if (!flag("--no-write")) { fs.mkdirSync(path.dirname(evidencePath), { recursive: true }); fs.writeFileSync(evidencePath, md); }
  if (flag("--json")) console.log(JSON.stringify({ env, tag, run_id: runId, counts, claims, evidence: evidencePath }, null, 2)); else { console.log(md); console.log(`evidence written: ${path.relative(repo, evidencePath)}`); }
  process.exit(counts.REFUTED ? 2 : counts.UNVERIFIABLE ? 3 : 0);
})();
