# MCP integration (goal 5)

Status: in progress. Servers are declared in `plugins/adlc/.mcp.json`; the golden-path task (`/adlc:ticket create → done` on `integranz.atlassian.net`, project `DEVOPS`) is scheduled for day 8.

| Server | Transport | Auth | Used by | Write operations |
|---|---|---|---|---|
| `atlassian` = **Atlassian Rovo MCP Server** (Atlassian's official remote MCP; the name "Remote MCP Server" was replaced by "Rovo MCP Server") | HTTP `https://mcp.atlassian.com/v2/mcp` | OAuth 2.1 (`/mcp` login in an interactive session; per user); requires a Standard+ Jira Cloud plan (Premium trial on integranz.atlassian.net) | `/adlc:ticket` (parent session only) | create/edit/transition/comment on issues; `delete`/`manage` groups stay disabled |
| `github` | HTTP `https://api.githubcopilot.com/mcp/x/actions` (actions toolset) | OAuth (per user) | `/adlc:deploy` (`actions_run_trigger`), `/adlc:verify` and `explore` (`actions_get`, `get_job_logs`) | `run_workflow`, `rerun`, `cancel` — allowed only for the parent; the immutable-tag hook checks `inputs.tag` |
| `azure` | stdio `npx -y @azure/mcp@latest server start --namespace acr … --read-only` | `DefaultAzureCredential` (`az login`) | `verify`, `explore` | none (`--read-only`); infra mutations go through Terraform under the guard hooks |

## Who may do what
- `explore` and `verify` sub-agents: read tools only. Enforced by `guard-readonly-agents.sh` (blocks MCP tool names implying writes when `agent_type` is explore/verify).
- `execute`: no MCP use expected (local changes only).
- Parent session: writes via the skills that own them (`ticket`, `deploy`).

## Operational notes
- **Rovo MCP Server = Atlassian's remote MCP** (support.atlassian.com/atlassian-ai-gateway, checked 2026-09-16): endpoint `https://mcp.atlassian.com/v2/mcp` (`?tools=all` exposes every tool for gateways), OAuth 2.1, optional API-token auth. Each call **consumes Rovo credits** from the organisation's shared pool, with a per-call cap; keep ticket operations to the lifecycle actions and avoid broad JQL searches in loops.
- First use of `atlassian` and `github` requires an interactive OAuth login; headless runs (Routines, `claude -p`) reuse the stored grant or fail with "needs authorization". Document the login in the target repo's AGENTS.md (done by the template).
- `azure` warm start is a few seconds, but a cold `npx` download can exceed the MCP startup timeout; pre-warm in cloud environment setup scripts (`npx -y @azure/mcp@latest --version`).
- Error handling per skill: a missing or unauthorised server is reported with the exact command to fix it; skills never fabricate ticket keys, run ids or resource states.

## Golden path procedure (goal 5, scheduled with the user)
1. In `adlc-demo`, start an interactive session with the plugin: `claude --plugin-dir ~/personal/adlc/plugins/adlc` (or the installed plugin), accept the folder trust prompt.
2. `/mcp` → select `atlassian` → complete the OAuth login for `integranz.atlassian.net` (the plugin's server URL is the v2 endpoint; existing v1 grants do not apply). Optionally authorise `github` the same way.
3. `/adlc:ticket create` → expect a `DEVOPS-<n>` key read back from Jira, then `/adlc:ticket start DEVOPS-<n>`, `/adlc:ticket review DEVOPS-<n> --evidence .adlc/evidence/<tag>.md`, `/adlc:ticket done DEVOPS-<n> --evidence .adlc/evidence/<tag>.md`.
4. Record the issue URL and the four transitions below.

## Evidence (to be completed)
- [ ] Golden path: `/adlc:ticket create` → `start` → `review` → `done` on `DEVOPS` in a clean workspace, with issue links.
- [ ] `/adlc:deploy` triggering `cd.yml` through `actions_run_trigger` and polling to completion.
- [ ] `verify` reading ACR repositories and Container Apps through the read-only Azure server.
