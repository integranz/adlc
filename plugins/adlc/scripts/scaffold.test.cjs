// Integration tests for scaffold.cjs / validate-config.cjs against a temporary repo.
const { test } = require("node:test"); const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { execFileSync, spawnSync } = require("node:child_process");
const yaml = require("./lib/js-yaml.min.js");
const HERE = __dirname, EXAMPLE = path.join(HERE, "..", "templates", "common", "adlc", "config.example.yaml");

function mkRepo(mutate) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "adlc-scaffold-"));
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  const cfg = yaml.load(fs.readFileSync(EXAMPLE, "utf8")); if (mutate) mutate(cfg);
  fs.mkdirSync(path.join(repo, ".adlc"), { recursive: true });
  fs.mkdirSync(path.join(repo, "apps/api/src/Api"), { recursive: true }); fs.writeFileSync(path.join(repo, "apps/api/src/Api/Api.csproj"), "<Project/>");
  fs.mkdirSync(path.join(repo, "apps/api/tests/Api.Tests"), { recursive: true }); fs.writeFileSync(path.join(repo, "apps/api/tests/Api.Tests/Api.Tests.csproj"), "<Project/>");
  fs.mkdirSync(path.join(repo, "apps/web"), { recursive: true }); fs.writeFileSync(path.join(repo, "apps/web/package.json"), "{}");
  fs.writeFileSync(path.join(repo, ".adlc", "config.yaml"), yaml.dump(cfg));
  return repo;
}
const run = (args, cwd) => spawnSync("node", [path.join(HERE, "scaffold.cjs"), ...args], { cwd, encoding: "utf8" });
const validate = (cfgPath) => spawnSync("node", [path.join(HERE, "validate-config.cjs"), cfgPath], { encoding: "utf8" });
const read = (repo, rel) => fs.readFileSync(path.join(repo, rel), "utf8");

test("scaffold renders the common set for the example config", () => {
  const repo = mkRepo();
  const r = run(["--repo", repo], repo);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  for (const f of ["AGENTS.md", "CLAUDE.md", ".claude/settings.json", ".claude/rules/precedence.md", ".claude/rules/terraform.md",
                   ".claude/rules/pipelines.md", ".claude/rules/docker.md", ".claude/rules/versioning.md", ".claude/rules/branching.md", ".gitignore", ".dockerignore", ".adlc/evidence"]) {
    assert.ok(fs.existsSync(path.join(repo, f)), `missing ${f}`);
  }
  const agents = read(repo, "AGENTS.md");
  assert.match(agents, /\| `api` \| `apps\/api` \| api \| dotnet8-api \| 8080 \| `\/health` \|/);
  assert.match(agents, /\| `web` \| `apps\/web` \| frontend \| react-vite \| 8080 \| `\/` \|/);
  assert.match(agents, /\| compute \| `aca` — Azure Container Apps \|/);
  assert.match(agents, /acradlcdemo\.azurecr\.io/);
  assert.doesNotMatch(agents, /<%/, "unrendered placeholder left in AGENTS.md");
  assert.match(read(repo, "CLAUDE.md"), /^@AGENTS\.md/);
  const settings = JSON.parse(read(repo, ".claude/settings.json"));
  assert.deepEqual(settings.extraKnownMarketplaces["adlc-marketplace"].source, { source: "github", repo: "integranz/adlc" });
  assert.equal(settings.enabledPlugins["adlc@adlc-marketplace"], true);
  for (const rule of ["terraform", "pipelines", "docker", "versioning", "branching"]) {
    const txt = read(repo, `.claude/rules/${rule}.md`);
    const fm = txt.match(/^---\n([\s\S]*?)\n---\n/); assert.ok(fm, `${rule}.md has no frontmatter`);
    assert.ok(Array.isArray(yaml.load(fm[1]).paths), `${rule}.md paths: is not a list`);
    assert.doesNotMatch(txt, /<%/, `unrendered placeholder in ${rule}.md`);
  }
  assert.match(read(repo, ".claude/rules/versioning.md"), /version\.json.*single version source/);
  assert.doesNotMatch(read(repo, ".claude/rules/versioning.md"), /Conventional Commits/);
  assert.match(read(repo, ".claude/rules/branching.md"), /trunk-based/);
  const setup = read(repo, ".adlc/SETUP.md");
  for (const n of ["AZURE_CLIENT_ID", "AZURE_TENANT_ID", "AZURE_SUBSCRIPTION_ID", "DOCKERHUB_TOKEN", "DOCKERHUB_USERNAME",
                   "repo:integranz/adlc-demo:ref:refs/heads/main", "repo:integranz/adlc-demo:environment:dev",
                   "stadlctfstate", "rg-adlc-tfstate", "--allow-shared-key-access false", "api://AzureADTokenExchange"]) {
    assert.ok(setup.includes(n), `SETUP.md missing ${n}`);
  }
  assert.doesNotMatch(setup, /<%/, "unrendered placeholder in SETUP.md");
  const script = read(repo, ".adlc/setup-azure.sh");
  assert.doesNotMatch(script, /<%/, "unrendered placeholder in setup-azure.sh");
  for (const n of ['RG="rg-adlc-demo-dev"', 'STATE_SA="stadlctfstate"', 'GH_OWNER="integranz"', "sp-${PROJECT}-github", "environment:${GH_ENV}", "--allow-shared-key-access false"]) assert.ok(script.includes(n), `setup-azure.sh missing ${n}`);
  assert.equal(spawnSync("bash", ["-n", path.join(repo, ".adlc", "setup-azure.sh")]).status, 0, "setup-azure.sh has a bash syntax error");
  assert.ok((fs.statSync(path.join(repo, ".adlc", "setup-azure.sh")).mode & 0o111) !== 0, "setup-azure.sh should be executable");
  const api = read(repo, "apps/api/Dockerfile"), web = read(repo, "apps/web/Dockerfile"), ng = read(repo, "apps/web/nginx.conf"), ngl = read(repo, "apps/web/nginx.local.conf");
  for (const s of [api, web, ng, ngl, read(repo, "compose.yaml")]) assert.doesNotMatch(s, /<%/, "unrendered placeholder in a stack template");
  assert.match(api, /FROM dhi\.io\/dotnet:\$\{DOTNET_VERSION\}-sdk AS build/); assert.match(api, /ARG DOTNET_VERSION=8\.0/);
  assert.match(api, /dotnet restore src\/Api\/Api\.csproj/); assert.match(api, /ENTRYPOINT \["dotnet", "Api\.dll"\]/); assert.match(api, /USER 65532/);
  assert.match(api, /org\.opencontainers\.image\.source="https:\/\/github\.com\/integranz\/adlc-demo"/);
  assert.match(web, /FROM dhi\.io\/node:\$\{NODE_VERSION\}-dev AS build/); assert.match(web, /FROM dhi\.io\/nginx:\$\{NGINX_VERSION\} AS runtime/); assert.match(web, /VITE_APP_VERSION=\$\{VERSION\}/);
  assert.match(ng, /location \/api\/ \{[\s\S]*proxy_pass\s+http:\/\/api;/, "cloud nginx must proxy to http://api (Container Apps app name, port 80)");
  assert.match(ngl, /proxy_pass\s+http:\/\/api:8080;/, "local nginx must proxy to the api container port");
  assert.doesNotMatch(ng, /proxy_set_header\s+Host/, "Host must stay $proxy_host for Container Apps routing");
  assert.ok(fs.existsSync(path.join(repo, "apps/api/.dockerignore")) && fs.existsSync(path.join(repo, "apps/web/.dockerignore")));
  const compose = read(repo, "compose.yaml"); assert.match(compose, /"8080:8080"/); assert.match(compose, /"8081:8080"/); assert.match(compose, /nginx\.local\.conf:\/etc\/nginx\/conf\.d\/default\.conf:ro/);
});

test("re-run skips existing files; --force replaces; .gitignore merges", () => {
  const repo = mkRepo();
  fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\ncustom-thing/\n");
  let r = run(["--repo", repo], repo); assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /merge\s+\.gitignore/);
  const gi = read(repo, ".gitignore");
  assert.match(gi, /custom-thing\//); assert.match(gi, /\.adlc\/approvals\//); assert.equal(gi.match(/node_modules\//g).length, 1);
  r = run(["--repo", repo], repo); assert.equal(r.status, 0);
  assert.match(r.stdout, /skip\s+AGENTS\.md \(exists/); assert.match(r.stdout, /0 written/);
  fs.writeFileSync(path.join(repo, "AGENTS.md"), "stale");
  r = run(["--repo", repo, "--force"], repo); assert.equal(r.status, 0);
  assert.match(r.stdout, /replace AGENTS\.md/); assert.match(read(repo, "AGENTS.md"), /start here \(adlc-demo\)/);
  assert.match(read(repo, ".gitignore"), /custom-thing\//, "--force must not drop the repo's own .gitignore rules");
  assert.match(r.stdout, /ok\s+\.gitignore \(already complete\)/);
});

test("--dry-run writes nothing", () => {
  const repo = mkRepo();
  const r = run(["--repo", repo, "--dry-run"], repo); assert.equal(r.status, 0);
  assert.ok(!fs.existsSync(path.join(repo, "AGENTS.md")));
  assert.match(r.stdout, /dry run/);
});

test("planned or later options are rejected before anything is written", () => {
  for (const [mutate, msg] of [
    [c => { c.options.compute = "aci"; }, /compute=aci is 'planned'/],
    [c => { c.options.branching = "gitflow"; }, /branching=gitflow is 'planned'/],
    [c => { c.options.cloud = "aws"; }, /cloud=aws is 'later'/],
    [c => { c.apps[0].stack = "node-ts-api"; }, /stack=node-ts-api is 'planned'/],
    [c => { c.apps[1].upstreams = ["nope"]; }, /'nope' is not an app/],
    [c => { c.apps[0].kind = "frontend"; }, /supports kinds \[api, worker\]/],
  ]) {
    const repo = mkRepo(mutate);
    const r = run(["--repo", repo], repo);
    assert.equal(r.status, 1); assert.match(r.stderr, msg);
    assert.ok(!fs.existsSync(path.join(repo, "AGENTS.md")), "must not write a partial scaffold");
    const v = validate(path.join(repo, ".adlc", "config.yaml")); assert.equal(v.status, 1); assert.match(v.stderr, msg);
  }
});

test("foundation layer renders and passes terraform fmt/validate", () => {
  const repo = mkRepo();
  const r = run(["--repo", repo], repo); assert.equal(r.status, 0, r.stderr);
  const dir = path.join(repo, "infra", "foundation");
  for (const f of ["versions.tf", "providers.tf", "locals.tf", "main.tf", "outputs.tf", "README.md"]) assert.ok(fs.existsSync(path.join(dir, f)), `missing infra/foundation/${f}`);
  const versions = read(repo, "infra/foundation/versions.tf"), locals = read(repo, "infra/foundation/locals.tf");
  assert.doesNotMatch(versions + locals, /<%/);
  assert.match(versions, /key\s+= "adlc-demo\/foundation\/dev\.tfstate"/); assert.match(versions, /storage_account_name = "stadlctfstate"/); assert.match(versions, /use_azuread_auth\s+= true/);
  assert.match(locals, /acr_name\s+= "acradlcdemo"/); assert.match(locals, /key_vault_name\s+= "kv-adlc-demo-dev"/); assert.match(locals, /cicd_principal_name\s+= "sp-adlc-demo-github"/);
  const tf = spawnSync("terraform", ["version"], { encoding: "utf8" });
  if (tf.status !== 0) { console.log("  (terraform not installed: fmt/validate skipped)"); return; }
  const fmt = spawnSync("terraform", ["-chdir=" + dir, "fmt", "-check", "-recursive"], { encoding: "utf8" }); assert.equal(fmt.status, 0, `terraform fmt -check: ${fmt.stdout}${fmt.stderr}`);
  const init = spawnSync("terraform", ["-chdir=" + dir, "init", "-backend=false", "-input=false"], { encoding: "utf8", timeout: 240000 });
  if (init.status !== 0) { console.log("  (terraform init -backend=false failed, likely offline: validate skipped)"); return; }
  const val = spawnSync("terraform", ["-chdir=" + dir, "validate", "-no-color"], { encoding: "utf8" }); assert.equal(val.status, 0, `terraform validate: ${val.stdout}${val.stderr}`);
});

test("ci.yml renders for nbgv and for semantic-release and parses as YAML", () => {
  for (const [versioning, must, mustNot] of [["nbgv", ["dotnet/nbgv@v0.5.2", "nbgv tag", "SemVer2"], ["semantic-release"]], ["semantic-release", ["npx semantic-release --dry-run", "npx semantic-release"], ["dotnet/nbgv"]]]) {
    const repo = mkRepo(c => { c.options.versioning = versioning; });
    const r = run(["--repo", repo], repo); assert.equal(r.status, 0, r.stderr);
    const ci = read(repo, ".github/workflows/ci.yml");
    assert.doesNotMatch(ci, /<%/, "unrendered placeholder in ci.yml");
    const doc = yaml.load(ci); // must parse
    assert.deepEqual(Object.keys(doc.jobs), ["version", "test", "images", "release"]);
    for (const s of must) assert.ok(ci.includes(s), `${versioning}: ci.yml missing ${s}`);
    for (const s of mustNot) assert.ok(!ci.includes(s), `${versioning}: ci.yml must not contain ${s}`);
    for (const s of ["registry: dhi.io", "azure/login@v3", "az acr login --name acradlcdemo", "provenance: false", "acradlcdemo.azurecr.io", "dotnet test apps/api", "npm --prefix apps/web test", "- app: api", "- app: web", "id-token: write"]) assert.ok(ci.includes(s), `ci.yml missing ${s}`);
    assert.doesNotMatch(ci, /:latest/, "no mutable tags in ci.yml");
    if (spawnSync("actionlint", ["--version"]).status === 0) { const al = spawnSync("actionlint", [path.join(repo, ".github/workflows/ci.yml")], { encoding: "utf8" }); assert.equal(al.status, 0, al.stdout + al.stderr); }
  }
});

test("--app renders only that app's stack templates", () => {
  const repo = mkRepo();
  const r = run(["--repo", repo, "--app", "web"], repo); assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(repo, "apps/web/Dockerfile"))); assert.ok(!fs.existsSync(path.join(repo, "apps/api/Dockerfile"))); assert.ok(!fs.existsSync(path.join(repo, "AGENTS.md")));
  const bad = run(["--repo", repo, "--app", "nope"], repo); assert.equal(bad.status, 1); assert.match(bad.stderr, /no such app/);
});

test("dotnet app without a detectable csproj fails before writing", () => {
  const repo = mkRepo(); fs.rmSync(path.join(repo, "apps/api/src"), { recursive: true });
  const r = run(["--repo", repo], repo); assert.equal(r.status, 1); assert.match(r.stderr, /no \.csproj found under apps\/api/);
  assert.ok(!fs.existsSync(path.join(repo, "AGENTS.md")));
});

test("semantic-release option renders its versioning rule", () => {
  const repo = mkRepo(c => { c.options.versioning = "semantic-release"; });
  const r = run(["--repo", repo], repo); assert.equal(r.status, 0, r.stderr);
  const v = read(repo, ".claude/rules/versioning.md");
  assert.match(v, /Conventional Commits/); assert.doesNotMatch(v, /version\.json/);
});

test("validate-config reports OK for the example", () => {
  const v = validate(EXAMPLE); assert.equal(v.status, 0, v.stderr); assert.match(v.stdout, /valid \(2 app\(s\)/);
});
