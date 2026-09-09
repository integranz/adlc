# adlc — Agentic Delivery Lifecycle plugin for Claude Code

Takes a repository from "code in a repo" to "versioned image running in the cloud, verified, and tracked in a ticket", driven by skills, three role sub-agents and mechanical guardrail hooks.

Status: **day 3 of 16**. Guard hooks, role sub-agents, MCP servers, option registry, config schema and the scaffold engine are in place; skills are still stubs.

## Install
```
/plugin marketplace add integranz/adlc
/plugin install adlc@adlc-marketplace
```
Local development: `claude --plugin-dir ./plugins/adlc`.

## Uninstall / rollback
`/plugin uninstall adlc@adlc-marketplace`. To roll back, install a specific version from the marketplace commit history (`git checkout vX.Y.Z` in the marketplace repo and re-add it), or pin `ref` in your own marketplace entry.

## Skills (invoked as `/adlc:<name>`)
| Skill | Kind | Purpose |
|---|---|---|
| `bootstrap` | user + model invoked | Intake interview → `.adlc/config.yaml` → classify apps → scaffold repo-side files → open ticket |
| `dockerize` | command | Write/refresh a hardened multi-stage Dockerfile for one app and prove it runs |
| `plan` | command | `terraform fmt/validate/plan` for one layer; never applies |
| `deploy` | command | Trigger CD for an immutable tag and monitor it |
| `verify` | command | Falsifiable post-deploy checks; writes `.adlc/evidence/<tag>.md` |
| `ticket` | command | Ticket lifecycle in the configured tracker |
| `delivery-knowledge` | model-invoked only | Reference knowledge per option (compute, versioning, base image, runner, secrets) |

## Data handling
The plugin reads `.adlc/config.yaml` and repository files. It sends nothing anywhere except through the MCP servers you enable (tracker, GitHub, Azure read-only) and the CLIs you already authenticate (`az`, `gh`, `terraform`, `docker`). Secrets are never written to the repo; hooks block it.

## Scripts
| Script | Purpose |
|---|---|
| `scripts/scaffold.cjs --repo <dir> [--dry-run] [--force]` | Render templates into a target repo from `.adlc/config.yaml`; refuses planned/later options; never writes a partial scaffold |
| `scripts/validate-config.cjs [config]` | Schema + option-status + cross-dimension validation |
| `scripts/options.cjs [dimension] [--json]` | Option registry for the intake interview |
| `scripts/approve-apply.sh <planfile>` | Human-only, one-shot, 10-minute approval for one `terraform apply` |

## Option matrix
See `templates/common/adlc/options.yaml`: `implemented` options are selectable and exercised end to end; `planned` options are shown but not selectable; `later` is roadmap.
