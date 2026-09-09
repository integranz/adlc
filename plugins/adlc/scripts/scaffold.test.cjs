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
  assert.doesNotMatch(agents, /\{\{/, "unrendered placeholder left in AGENTS.md");
  assert.match(read(repo, "CLAUDE.md"), /^@AGENTS\.md/);
  const settings = JSON.parse(read(repo, ".claude/settings.json"));
  assert.deepEqual(settings.extraKnownMarketplaces["adlc-marketplace"].source, { source: "github", repo: "integranz/adlc" });
  assert.equal(settings.enabledPlugins["adlc@adlc-marketplace"], true);
  for (const rule of ["terraform", "pipelines", "docker", "versioning", "branching"]) {
    const txt = read(repo, `.claude/rules/${rule}.md`);
    const fm = txt.match(/^---\n([\s\S]*?)\n---\n/); assert.ok(fm, `${rule}.md has no frontmatter`);
    assert.ok(Array.isArray(yaml.load(fm[1]).paths), `${rule}.md paths: is not a list`);
    assert.doesNotMatch(txt, /\{\{/, `unrendered placeholder in ${rule}.md`);
  }
  assert.match(read(repo, ".claude/rules/versioning.md"), /version\.json.*single version source/);
  assert.doesNotMatch(read(repo, ".claude/rules/versioning.md"), /Conventional Commits/);
  assert.match(read(repo, ".claude/rules/branching.md"), /trunk-based/);
  assert.match(r.stdout, /no repo-side templates for: .*stack=dotnet8-api/); // stack templates arrive on day 5
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

test("semantic-release option renders its versioning rule", () => {
  const repo = mkRepo(c => { c.options.versioning = "semantic-release"; });
  const r = run(["--repo", repo], repo); assert.equal(r.status, 0, r.stderr);
  const v = read(repo, ".claude/rules/versioning.md");
  assert.match(v, /Conventional Commits/); assert.doesNotMatch(v, /version\.json/);
});

test("validate-config reports OK for the example", () => {
  const v = validate(EXAMPLE); assert.equal(v.status, 0, v.stderr); assert.match(v.stdout, /valid \(2 app\(s\)/);
});
