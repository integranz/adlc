---
name: deploy
description: Trigger the CD workflow for one immutable image tag and one environment, wait for the human approval on the GitHub environment, monitor the run to completion and report the deployed URLs.
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/validate-config.cjs" *), Bash(gh run list *), Bash(gh run view *), Bash(gh run watch *), Bash(gh run download *), Bash(gh workflow run *), Bash(gh api repos/*), Bash(az acr manifest show *), Bash(az acr repository show-tags *), Bash(az account show *), Bash(git rev-parse *), Bash(curl -fsS *)
---

# /adlc:deploy — deploy one tag to one environment

Arguments: `$0` image tag (semver from CI). Default: the version of the latest successful CI run on the default branch. `$1` environment (default: `github.cd_environment` from `.adlc/config.yaml`). Flags: `--no-wait` (trigger and return the run URL), `--no-ticket`.

## Preconditions
1. `.adlc/config.yaml` validates; `.github/workflows/cd.yml` and `infra/app/` exist (otherwise: run the scaffold, commit, push).
2. GitHub access: the GitHub MCP server (`actions_run_trigger`, `actions_get`, `get_job_logs`) or an authenticated `gh` CLI. Azure read access for the tag check (`az account show`).

## Step 1 — Resolve the tag
- If `$0` is given: it must match `^[0-9]+\.[0-9]+\.[0-9]+` and must not be `latest` or a branch name (the guard hook enforces this too).
- Otherwise: `gh run list --workflow ci --branch <default_branch> --status success --limit 1 --json databaseId` → `gh api repos/<owner>/<repo>/actions/runs/<id>/artifacts --jq '.artifacts[].name'` → the `release-manifest-<version>` artifact gives the version. Tell the user which tag was chosen and from which run.
- Confirm every app image exists: `az acr manifest show -r <acr> -n <image_repository>:<tag> --query digest -o tsv` for each app in the config. Missing image → stop; suggest `/adlc:plan` is not the fix, the CI release is.

## Step 2 — Trigger CD
Preferred: GitHub MCP `actions_run_trigger` with `method: run_workflow`, `workflow_id: cd.yml`, `ref: <default_branch>`, `inputs: { tag, environment }`. Fallback: `gh workflow run cd.yml -R <owner>/<repo> -f tag=<tag> -f environment=<env>`. The guard hook rejects a dispatch without an immutable `tag` input. Find the run id: `gh run list --workflow cd --limit 1 --json databaseId,url`.

## Step 3 — Watch and hand over the approval
1. Poll (`gh run watch <id>` or `actions_get` every 15 s). The `plan` job publishes the plan summary; the `apply` job then **waits for a human** on the `<env>` environment.
2. As soon as the run reaches "waiting", tell the user: the plan summary URL, the exact resource changes (`Plan: x to add, y to change, z to destroy`), and where to approve (`https://github.com/<owner>/<repo>/actions/runs/<id>`). Never approve it yourself; you cannot and must not.
3. After approval, keep polling until completion. On failure: `gh run view <id> --log-failed` (or `get_job_logs` with `failed_only`), quote the first failing lines, and stop; do not retry automatically.
4. On success: download `deploy-evidence-<env>-<tag>` and read `outputs.json` (`<app>_url`, `<app>_health_url`) and `smoke.txt`.

## Step 4 — Ticket
Unless `--no-ticket`, `/adlc:ticket review <KEY> --evidence <path>` with the run URL and the deployed URLs (if the ticket skill or MCP is unavailable, say so and print the command).

## Output
```
## adlc deploy: <project> <tag> → <env>
Run: <url> (plan: +a ~c -d | apply: <Apply complete line>)
Approval: <who, when> | Smoke: <n> confirmed / <n> refuted
URLs: <app>: <url>  …
Next: /adlc:verify <env> <tag>
```

## Do not
- Do not deploy `latest`, branch names or a tag whose images are missing.
- Do not run `terraform apply` locally for `infra/app`; the hook blocks it and the state belongs to the CD identity.
- Do not approve, bypass or re-request the environment review; do not re-run a failed apply without a human decision.
- Do not deploy to an environment that is not listed in `.adlc/config.yaml`.
