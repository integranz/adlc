---
name: bootstrap
description: Use when the user asks to onboard, containerise, set up delivery, CI/CD or deployment for a repository, or asks to run the ADLC intake. Interviews the user for platform options, classifies the apps, writes .adlc/config.yaml, scaffolds repo-side files and opens a tracking ticket.
---

# /adlc:bootstrap

Status: **stub (day 1)**. Ordered steps, constraints and the "do not" list are written on the day this skill is built (see docs/DECISIONS.md for the schedule).

## Arguments
`$ARGUMENTS` optional overrides: `--cloud`, `--compute`, `--runner`, `--versioning`, `--tracker`, `--stack <app>=<stack>`.

## Outline
1. Detect existing config; if present, offer to update instead of re-interview.
2. Delegate app discovery to the `explore` sub-agent (projects, ports, health paths, test commands).
3. Interview only the dimensions that change generated files, offering options from `templates/common/adlc/options.yaml`; reject `planned`/`later` choices with a clear message.
4. Write `.adlc/config.yaml`; validate against `config.schema.json`.
5. Run `scripts/scaffold.sh` through the `execute` sub-agent; confirm results with the `verify` sub-agent.
6. Create the tracking ticket via `/adlc:ticket create`.

## Do not
- Never run `terraform apply` yourself; the guard hook blocks it and the human applies.
- Never write secrets, tfvars or state into the repository.
- Never push or deploy a mutable tag (`latest`, branch names).
