# Sub-agent profiles (goal 6)

Three role profiles in `plugins/adlc/agents/`. The parent session stays thin: it interviews, decides, delegates scoped slices, and stores evidence. Domain knowledge (Container Apps, Docker Hardened Images, GitHub Actions + OIDC, NBGV, semantic-release, Key Vault, verification recipes) lives in the model-invoked `delivery-knowledge` skill, preloaded into `execute` and `verify` via `skills:`, not in extra domain agents.

Plugin-agent constraints (docs, verified 2026-09-09): plugin agents ignore `hooks`, `mcpServers` and `permissionMode` frontmatter. Read-only behaviour is therefore enforced by `tools`/`disallowedTools` plus the plugin-wide `guard-readonly-agents.sh` hook, and MCP access comes from the plugin's `.mcp.json`.

| Profile | Job | Tools | Inputs | Outputs | Stops when | Escalates when |
|---|---|---|---|---|---|---|
| `explore` | gather facts | Read, Grep, Glob, Bash (read-only), WebFetch; no Edit/Write/Agent | decidable question(s), repo root, config | findings with `path:line` evidence, app inventory table, unknowns | every question answered or marked "not present" | a decision is needed, sources conflict, access missing |
| `execute` | make one scoped change | Read, Edit, Write, Grep, Glob, Bash; no Agent; preloads `delivery-knowledge` | target, intended outcome, acceptance command, option values | changed-file list, verbatim acceptance output, PASS/FAIL, follow-ups | acceptance passes; scope exceeded; same failure twice | a hook blocks; a new secret/resource/scope is needed |
| `verify` | test claims | Read, Grep, Glob, Bash (read-only), WebFetch; no Edit/Write/Agent; preloads `delivery-knowledge` | falsifiable claims with env/tag/URL | CONFIRMED / REFUTED / UNVERIFIABLE table with command → output | every claim has a verdict | a check needs missing credentials or resources |

`maxTurns`: explore 30, execute 60, verify 40. `model: inherit`.

## Anti-patterns these profiles prevent
- **Circular delegation**: none of the three can spawn sub-agents (`Agent` is disallowed).
- **Verification that "fixes"**: verify has no Edit/Write and the read-only hook blocks mutating shell/MCP calls.
- **Execution without proof**: execute must run the acceptance command and paste real output.
- **Exploration that guesses**: every finding needs `path:line` or a command output; unknowns are listed, not filled in.

## Run log (real workflows)
| Date | Profile | Task | Outcome |
|---|---|---|---|
| 2026-09-09 | (all) | headless check that the plugin exposes the three agents | see DECISIONS.md |
| _pending_ | explore | app discovery on `adlc-demo` during `/adlc:bootstrap` | |
| _pending_ | execute | Dockerfiles for `apps/api` and `apps/web` | |
| _pending_ | verify | post-deploy verification of the first CD run | |
