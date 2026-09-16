const { test } = require("node:test"); const assert = require("node:assert/strict");
const path = require("node:path"), fs = require("node:fs"), os = require("node:os"); const { spawnSync, execFileSync } = require("node:child_process");
const yaml = require("./lib/js-yaml.min.js");
const V = path.join(__dirname, "verify.cjs"); const EXAMPLE = path.join(__dirname, "..", "templates", "common", "slipway", "config.example.yaml");
function repo() { const r = fs.mkdtempSync(path.join(os.tmpdir(), "slipway-verify-")); execFileSync("git", ["init", "-q", "-b", "main", r]); fs.mkdirSync(path.join(r, ".slipway")); fs.writeFileSync(path.join(r, ".slipway", "config.yaml"), yaml.dump(yaml.load(fs.readFileSync(EXAMPLE, "utf8")))); return r; }
test("verify.cjs refuses bad arguments before touching anything", () => {
  const r = repo();
  let x = spawnSync(process.execPath, [V], { encoding: "utf8", cwd: r }); assert.equal(x.status, 1); assert.match(x.stderr, /usage/);
  x = spawnSync(process.execPath, [V, "prod", "0.1.0", "--repo", r], { encoding: "utf8" }); assert.equal(x.status, 1); assert.match(x.stderr, /environment 'prod' is not in/);
  x = spawnSync(process.execPath, [V, "dev", "latest", "--repo", r], { encoding: "utf8" }); assert.equal(x.status, 1); assert.match(x.stderr, /not a semver tag/);
  assert.ok(!fs.existsSync(path.join(r, ".slipway", "evidence", "latest.md")), "must not write evidence for invalid input");
});
test("verify.cjs --no-write leaves the repo untouched and reports per claim", () => {
  const r = repo(); const env = { ...process.env, PATH: "/nonexistent" }; // no gh/az/terraform: everything unverifiable/refuted but well-formed
  const x = spawnSync(process.execPath, [V, "dev", "0.1.0", "--repo", r, "--no-write", "--json"], { encoding: "utf8", env, timeout: 120000 });
  assert.ok([2, 3].includes(x.status), `exit ${x.status}: ${x.stderr}`);
  const j = JSON.parse(x.stdout); assert.equal(j.env, "dev"); assert.equal(j.tag, "0.1.0"); assert.ok(j.claims.length >= 3);
  for (const c of j.claims) assert.ok(["CONFIRMED", "REFUTED", "UNVERIFIABLE"].includes(c.verdict));
  assert.ok(!fs.existsSync(path.join(r, ".slipway", "evidence", "0.1.0.md")));
});
