---
name: ticket
description: Create, transition or comment on the tracking ticket in the configured tracker (Jira via the Atlassian MCP) with a structured description and evidence links.
disable-model-invocation: true
---

# /adlc:ticket

Status: **stub (day 1)**. Ordered steps, constraints and the "do not" list are written on the day this skill is built (see docs/DECISIONS.md for the schedule).

## Arguments
`$0` action: `create|start|review|done|comment`; `$1` issue key (not for create); `--evidence <file>`.

## Outline
Structured description: Objective, Scope, Acceptance criteria, Evidence. Transitions come from `jira.transitions` in config.

## Do not
- Never run `terraform apply` yourself; the guard hook blocks it and the human applies.
- Never write secrets, tfvars or state into the repository.
- Never push or deploy a mutable tag (`latest`, branch names).
