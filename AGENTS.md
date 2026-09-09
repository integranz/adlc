# AGENTS.md — start here (adlc marketplace repo)

This repo is the source of the **adlc** Claude Code plugin and its marketplace. It is also a "repo in scope" for the Q3 2026 upskilling goals, so it follows its own rules.

## Structure
| Path | What |
|---|---|
| `.claude-plugin/marketplace.json` | Marketplace manifest; one plugin entry pointing at `./plugins/adlc` |
| `plugins/adlc/` | The plugin: `skills/`, `agents/`, `hooks/`, `.mcp.json`, `templates/`, `scripts/` |
| `plugins/adlc/templates/common/adlc/options.yaml` | Option registry: what the interview offers and what is implemented |
| `plugins/adlc/templates/common/adlc/config.schema.json` | Schema for a target repo's `.adlc/config.yaml` |
| `docs/` | Evidence documents for the nine goals (catalog, hooks, rules audit, MCP, sub-agents, tiers, clean install, review packet) |
| `.releaserc.json`, `.github/workflows/release.yml` | This repo versions itself with semantic-release (Conventional Commits) |

## I want to…
- **work on a skill** → `plugins/adlc/skills/<name>/SKILL.md`; test with `claude --plugin-dir ./plugins/adlc`
- **change a guardrail** → `plugins/adlc/hooks/`; run `plugins/adlc/hooks/test-hooks.sh` before committing
- **add a platform option** → add it to `options.yaml` with `status`, add enum value to `config.schema.json`, add `templates/<dimension>/<option>/`, add `skills/delivery-knowledge/references/<dimension>-<option>.md`
- **release** → merge to `main` with Conventional Commit messages; semantic-release tags and updates `plugins/adlc/CHANGELOG.md`

## Skills available
<available_skills>
- adlc:bootstrap — intake interview, app classification, scaffold, ticket
- adlc:dockerize — hardened multi-stage Dockerfile for one app
- adlc:plan — terraform fmt/validate/plan for one layer (never applies)
- adlc:deploy — trigger and monitor CD for an immutable tag
- adlc:verify — falsifiable post-deploy checks, evidence file
- adlc:ticket — tracker lifecycle
- adlc:delivery-knowledge — reference knowledge (model-invoked)
</available_skills>

## Rules and precedence
Non-negotiables live in `CLAUDE.md`; path-scoped rules live in `.claude/rules/` (added day 3). Precedence: managed policy > user > project > path rules > local. Hooks are mechanical and cannot be relaxed by a local setting.

## Commit convention
Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`; `!` or `BREAKING CHANGE:` for majors). The release version is derived from them.

## Multi-repo
Open this repo alone when changing the plugin. Open `adlc-demo` alone when exercising the plugin on a target. Cross-cutting changes (templates, schema) are owned here.
