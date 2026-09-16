---
name: verify
description: Verify a deployment independently: run the deterministic verification script for an environment and tag, have the verify sub-agent re-check anything refuted or unverifiable, and record the evidence file under .slipway/evidence/<tag>.md.
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Write, Edit, Agent, Bash(node ${CLAUDE_PLUGIN_ROOT}/scripts/*), Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/*), Bash(az account *), Bash(az containerapp show *), Bash(az containerapp revision list *), Bash(az acr repository show *), Bash(az acr repository show-tags *), Bash(gh auth status *), Bash(gh run list *), Bash(gh run view *), Bash(gh run download *), Bash(gh api repos/*), Bash(terraform -chdir=infra/app init *), Bash(terraform -chdir=infra/app plan *), Bash(terraform -chdir=infra/app output *), Bash(git status *), Bash(git ls-files *), Bash(curl *)
---

# /slipway:verify — prove a deployment, never fix it

Arguments: `$0` environment (default `github.cd_environment`), `$1` image tag (default: the `image_tag` output of the latest CD run for that environment, found via the `deploy-evidence-<env>-<tag>` artifacts). Flags: `--no-write` (do not touch `.slipway/evidence/`), `--json`.

## Preconditions
`.slipway/config.yaml` validates; `az account show` works and points at the configured subscription (`az account set --subscription $ARM_SUBSCRIPTION_ID` if not); `gh auth status` succeeds (otherwise the CD-run claims are UNVERIFIABLE, say so).

## Step 1 — Deterministic checks
Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/verify.cjs" <env> <tag> --repo .` (add `--no-write` if asked). It prints a Markdown table with one row per claim and writes `.slipway/evidence/<tag>.md`. Claims it checks (option-aware):
- CD run for the tag succeeded, a human approved the environment, the evidence artifact exists, `image_tag` output equals the tag;
- per app: health URL 200 with `version == tag` (APIs) or bundle carries the tag (frontends), upstream proxy answers with the upstream's version, HTTP → HTTPS redirect;
- per app on Container Apps: active revision runs `<registry>/<repo>:<tag>`, Healthy/Running at 100 % traffic, the registry holds the tag;
- app layer has no drift (`terraform plan -detailed-exitcode`, lock-free, read-only);
- working tree clean, no state/plan/tfvars/key files tracked.
Exit codes: 0 all confirmed, 2 something refuted, 3 only unverifiable items.

## Step 2 — Second opinion on anything not CONFIRMED
For every REFUTED or UNVERIFIABLE row, delegate to the `verify` sub-agent with the exact claim and the evidence line, asking it to re-check with a different method (for example `az containerapp show … --query properties.configuration.ingress.fqdn` when the artifact was missing, or `docker manifest inspect` for a digest). It may only upgrade a verdict with a positive observation; it never repairs anything. Merge its findings into the table (keep both evidences).

## Step 3 — Record
Confirm `.slipway/evidence/<tag>.md` exists and matches the final table (edit it only to add the sub-agent's second-opinion lines). Do not commit; tell the user the file is ready to commit. If any claim stays REFUTED, say what is broken in one sentence and which skill fixes it (`/slipway:deploy` for a wrong tag, CI for a missing image, `/slipway:plan` for drift); do not run them.

## Output
```
## slipway verify: <project> <env> <tag>
Result: <n> confirmed / <n> refuted / <n> unverifiable   (evidence: .slipway/evidence/<tag>.md)
Refuted: <claim → evidence> | none
URLs: <app>: <url> …
Next: /slipway:ticket done <KEY> --evidence .slipway/evidence/<tag>.md   (or the fix skill named above)
```

## Do not
- Do not deploy, re-run workflows, apply Terraform, restart revisions or edit application code to make a check pass.
- Do not report CONFIRMED without a positive observation; absence of an error is not evidence.
- Do not soften a REFUTED verdict; the human decides what to do with it.
