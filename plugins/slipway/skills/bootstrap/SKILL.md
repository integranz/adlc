---
name: bootstrap
description: Use when the user asks to onboard, containerise, "set up delivery", CI/CD, deployment or infrastructure for a repository, to run the ADLC intake, or to change delivery options (cloud, compute, registry, runner, versioning, branching, tracker, secret store, base image). Interviews the user for the options that shape generated files, classifies the apps with the explore sub-agent, writes .slipway/config.yaml, scaffolds the repo-side files deterministically and opens a tracking ticket.
allowed-tools: Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*), Read, Glob, Grep, Write, Edit, Agent, AskUserQuestion, Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/options.cjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-config.cjs" *), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/scaffold.cjs" *), Bash(git status *), Bash(git rev-parse *), Bash(git remote *), Bash(git diff *)
---

# /slipway:bootstrap — intake, classification, scaffold, ticket

Turns a repository into an slipway-managed repository: `.slipway/config.yaml` (single source of truth), `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json`, path-scoped rules, and the per-option files (workflows, infra, Dockerfiles as those options ship). Everything generated comes from templates rendered by a script; you never hand-write generated files.

Arguments: `$ARGUMENTS` may contain `--cloud`, `--compute`, `--registry`, `--runner`, `--versioning`, `--branching`, `--tracker`, `--secret-store`, `--base-image` (pre-answer an interview question), `--stack <app>=<stack>` (override a detected stack), `--yes` (accept detections and defaults without asking; requires that every needed value is present or defaulted), `--no-ticket`, `--force` (overwrite generated files).

## Preconditions (check, do not assume)
1. You are at a git repository root: `git rev-parse --show-toplevel` equals the working directory. If not, stop and say which directory to open.
2. Plugin scripts are reachable: `node "${CLAUDE_PLUGIN_ROOT}/scripts/options.cjs" --json` prints the option registry. If it fails, stop; the plugin install is broken, do not improvise a scaffold.
3. Decide the mode:
   - **New**: no `.slipway/config.yaml` → full interview.
   - **Update**: `.slipway/config.yaml` exists → validate it, show the current options table, ask only what the user wants to change (or nothing if `--yes`), then re-scaffold. Never re-ask questions whose answers are already in the file.
   - **Non-interactive** (`--yes`, or a session with no prompt UI such as a Routine or cloud run): use the existing config, or detections plus the *defaults defined below*; if any value without a default is missing, print the list of missing values and **stop before Step 3 with nothing written**. `templates/common/slipway/config.example.yaml` is a **shape reference only**; its values (names, owner, site, keys) are never defaults.

### What has a default and what does not
| Value | Default | Source |
|---|---|---|
| `project.name` | repository directory name, lower-cased, kebab-case | filesystem |
| `options.*` | first `implemented` option of each dimension, filtered by `depends_on` | `options.cjs --json` |
| `environments` | `[dev]` | fixed |
| `github.owner` / `github.repo` | parsed from `git remote get-url origin` **only if** the host is `github.com`; otherwise none | git |
| `github.default_branch` | current default branch | git |
| `apps[*]` | explore agent detections **only** where kind, stack, port and health path all have evidence | Step 1 |
| `azure.location`, `azure.resource_group`, `azure.acr_name`, `azure.key_vault_name`, `azure.identity_name`, `azure.state.*` | **none** | interview |
| `jira.site_url`, `jira.project_key` (or the equivalent block for another tracker) | **none** | interview |
| `azure.subscription_id`, `azure.tenant_id` | omitted (env vars at runtime) | — |

## Step 1 — Discover the apps (explore sub-agent)
Delegate to the `explore` sub-agent with this brief, verbatim except for the repo path:

> Inventory the deployable applications in `<repo root>`. For each, report: path (directory containing the project/manifest), kind (`api` = serves HTTP for other systems, `frontend` = browser UI, `worker` = no ingress) with the evidence for the kind, stack (`dotnet8-api`, `react-vite`, `node-ts-api`, `python-api`, or "other: <what you see>"), exposed port and where it is declared, health path if any route like `/health`, `/healthz`, `/ready` exists, and the test command that actually works from the repo root. Also report: existing `Dockerfile*`, `.github/workflows/*`, `infra/**/*.tf`, `version.json`, `.releaserc*`, and the default branch. Return the App inventory table and the Unknowns list; do not guess ports or health paths.

Treat the result as a proposal. Anything under "Unknowns" becomes an interview question.

## Step 2 — Interview (only what changes generated files)
Load the registry with `node "${CLAUDE_PLUGIN_ROOT}/scripts/options.cjs" --json`. Rules:
- Offer **only options with `status: implemented`** as selectable. List `planned` and `later` options in the question text as "planned, not selectable yet" so the user knows the roadmap; if they insist on one, refuse politely and record the request in the ticket.
- Honour `depends_on`: filter compute/registry/secret_store options by the chosen cloud.
- Pre-fill from arguments, then from detections (e.g. a `version.json` → `nbgv`, a `.releaserc` → `semantic-release`, `*.csproj` → `dotnet8-api`), then from the defaults table above. Ask only where a real choice remains, the detection is uncertain, or the value has no default. Never invent cloud resource names, tracker sites or project keys.
- Ask with `AskUserQuestion`, at most four questions per call, grouping: (a) platform options, (b) cloud identifiers and resource names, (c) apps to confirm (kind, port, health path, test command per app), (d) tracker details and environments.
- Resource names must satisfy the schema patterns (see `templates/common/slipway/config.schema.json`): ACR 5–50 alphanumerics, Key Vault 3–24 chars starting with a letter, storage account 3–24 lowercase alphanumerics, project name lowercase kebab-case. Propose compliant names derived from the project name; the user can override.
- Cloud subscription and tenant ids are **optional** in the file; prefer leaving them out of a public repo and relying on `ARM_SUBSCRIPTION_ID`/`AZURE_*` variables. Say so when asking.

## Step 3 — Write and validate the config
1. Write `.slipway/config.yaml` following `templates/common/slipway/config.example.yaml` exactly in shape (`schema_version: 1`, `project`, `options`, cloud block, `github`, tracker block, `environments`, `apps`, `cursor_mirror`). Each app needs `name`, `path`, `kind`, `stack`, `image_repository` (`<project>/<app>`), and for `api`/`frontend` also `port` and `health_path`; add `upstreams` for a frontend that proxies to an API.
2. Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-config.cjs" .slipway/config.yaml`. On any error, fix the file and re-run; never proceed with an invalid file and never edit the schema or registry to make it pass.
3. Show the user the resulting options table and app table and ask for a one-word confirmation unless `--yes`.

## Step 4 — Scaffold (execute sub-agent optional)
Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/scaffold.cjs" --repo . --dry-run`, show the file list, then run it without `--dry-run` (add `--force` only if the user asked for it). The script is two-phase: if it prints a template error, nothing was written; report the error verbatim and stop. If it reports "no repo-side templates for" some options, that is expected while those option templates are still being built; say which files will appear later (workflows, infra, Dockerfiles).

Do not edit generated files by hand afterwards. If something is wrong in a generated file, the fix belongs in the plugin's templates.

## Step 5 — Verify (verify sub-agent)
Delegate to the `verify` sub-agent these claims: `.slipway/config.yaml` validates (`validate-config.cjs` exit 0); `AGENTS.md`, `CLAUDE.md`, `.claude/settings.json`, `.claude/rules/precedence.md` exist and contain no `<%`; `.claude/settings.json` is valid JSON naming the marketplace and plugin; every `.claude/rules/*.md` other than `precedence.md` has a `paths:` list in its frontmatter; `.gitignore` contains `.slipway/approvals/`, `*.tfvars` and `tfplan*`. Report the verdict table to the user.

## Step 6 — Ticket
Unless `--no-ticket`, call `/slipway:ticket create` with title `Onboard <project> to slipway delivery` and a description containing the options table, the app table and the list of generated files. Record the issue key in the summary. If the tracker MCP is not connected, say so and give the exact command to run later; do not fake a key.

## Output (always end with this)
```
## slipway bootstrap: <project> (<new|update>)
Options: <dimension=option, …>
Apps: <name (kind, stack, port, health)>, …
Generated: <n> files written, <n> skipped, <n> merged  |  Pending option templates: <list or none>
Verification: <n> confirmed / <n> refuted / <n> unverifiable
Ticket: <KEY-123 | not created: reason>
Next: /slipway:dockerize <first app path>
```

## Do not
- Do not select a `planned` or `later` option, and do not silently substitute another option; explain and stop.
- Do not guess a port, health path, app kind, resource name, tracker site or project key that the explore agent or the user did not confirm; the example config is not a source of values.
- Do not hand-write or patch generated files; do not edit `options.yaml`, the schema or templates from a target repo.
- Do not commit, push, apply infrastructure, build or push images here; those are separate skills with their own guards.
- Do not put subscription ids, tenant ids, tokens or secrets into `.slipway/config.yaml` when the repo is public unless the user explicitly asks.
