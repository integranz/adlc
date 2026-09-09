---
name: dockerize
description: Write or refresh the hardened multi-stage Dockerfile for one app from the stack template, build it with the version build-arg, run it locally and check the health endpoint.
disable-model-invocation: true
---

# /adlc:dockerize

Status: **stub (day 1)**. Ordered steps, constraints and the "do not" list are written on the day this skill is built (see docs/DECISIONS.md for the schedule).

## Arguments
`$0` app path (e.g. `apps/api`); `--stack` to override the stack from config.

## Outline
1. Read app entry from config; pick `templates/stack/<stack>/Dockerfile` for the configured base image.
2. Render, build with `--build-arg VERSION=dev`, run, curl the health path, report image size and OCI labels.

## Do not
- Never run `terraform apply` yourself; the guard hook blocks it and the human applies.
- Never write secrets, tfvars or state into the repository.
- Never push or deploy a mutable tag (`latest`, branch names).
