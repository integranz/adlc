---
name: deploy
description: Trigger the CD workflow for an immutable image tag, wait for the environment approval, and monitor the run to completion.
disable-model-invocation: true
---

# /adlc:deploy

Status: **stub (day 1)**. Ordered steps, constraints and the "do not" list are written on the day this skill is built (see docs/DECISIONS.md for the schedule).

## Arguments
`$0` image tag (default: tag of the latest green CI run on the default branch); `$1` environment (default `dev`).

## Outline
1. Confirm the tag exists in the registry. 2. Trigger `cd.yml` via the GitHub MCP with `tag` and `environment`. 3. Poll; on failure fetch failed job logs. 4. Move the ticket to review.

## Do not
- Never run `terraform apply` yourself; the guard hook blocks it and the human applies.
- Never write secrets, tfvars or state into the repository.
- Never push or deploy a mutable tag (`latest`, branch names).
