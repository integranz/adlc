---
name: verify
description: Run falsifiable post-deployment checks for an environment and tag and write an evidence file. Delegates to the verify sub-agent.
disable-model-invocation: true
---

# /adlc:verify

Status: **stub (day 1)**. Ordered steps, constraints and the "do not" list are written on the day this skill is built (see docs/DECISIONS.md for the schedule).

## Arguments
`$0` environment; `$1` tag.

## Outline
Checks: CD run success; frontend 200; API health 200 with version == tag; running image digest == registry digest for tag == CI manifest; `terraform plan -detailed-exitcode` == 0 for the app layer; version tool agrees with the tag; no secret literals in the repo. Output `.adlc/evidence/<tag>.md`.

## Do not
- Never run `terraform apply` yourself; the guard hook blocks it and the human applies.
- Never write secrets, tfvars or state into the repository.
- Never push or deploy a mutable tag (`latest`, branch names).
