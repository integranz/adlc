---
name: plan
description: Run terraform fmt, validate and plan for one infrastructure layer and summarise the changes. Never applies.
disable-model-invocation: true
---

# /adlc:plan

Status: **stub (day 1)**. Ordered steps, constraints and the "do not" list are written on the day this skill is built (see docs/DECISIONS.md for the schedule).

## Arguments
`$0` environment (default `dev`); `--layer foundation|app` (default `foundation`).

## Outline
1. `terraform init -backend-config` from config; `fmt -check`; `validate`; `plan -out=tfplan.<env>`.
2. Summarise add/change/destroy and tell the user the exact apply command they may run (foundation only).

## Do not
- Never run `terraform apply` yourself; the guard hook blocks it and the human applies.
- Never write secrets, tfvars or state into the repository.
- Never push or deploy a mutable tag (`latest`, branch names).
